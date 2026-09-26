import { type McpServerConfig, type OutputFormat, query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { SZUMRAK_VERSION } from "~/platform/version";
import { resolveAgentAuth } from "./agent-auth";
import { type AgentPermissions, loadAgentConfig } from "./agent-config";
import { ASK_MODE_INSTRUCTIONS } from "./ask-instructions";
import {
  COMMIT_BLOCK_PATTERN,
  COMMIT_METADATA_INSTRUCTIONS,
  type CommitMetadata,
  parseCommitMetadata
} from "./commit-metadata";
import { checkHookHealth } from "./hook-preflight";

export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentRunResult {
  toolCalls: Array<AgentToolCall>;
  finalMessage: string;
  succeeded: boolean;
  totalCostUsd?: number;
  commitMetadata?: CommitMetadata;
  numTurns?: number;
  loopDetected?: { toolName: string; input: Record<string, unknown>; occurrences: number };
  /** The SDK's `structured_output`, present only when `RunAgentOptions.outputFormat` was set. */
  structuredOutput?: unknown;
}

/**
 * Per-run overrides a flow can layer on top of the env-driven defaults. Every
 * field is optional and an absent field keeps today's behavior, so the
 * runner/review-followup/ask flows pass nothing (or only `readOnly`).
 */
export interface RunAgentOptions {
  readOnly?: boolean;
  /** Replaces COMMIT_METADATA_INSTRUCTIONS as the system prompt addendum of a write run. */
  systemPromptAppend?: string;
  model?: string;
  maxTurns?: number;
  maxDurationMs?: number;
  maxBudgetUsd?: number;
  /** Added on top of the allowlisted subprocess env from agent/agent-auth.ts. */
  env?: Record<string, string>;
  /** Merged into (never replacing) the target repo's agent-config.json permissions. */
  permissions?: AgentPermissions;
  /** Replaces agent-config.json's `skills` for this run. */
  skills?: Array<string> | "all";
  /**
   * Passed with `strictMcpConfig: true`, so these are the *only* MCP servers
   * the session gets — the target repo's `.mcp.json` is not loaded on its
   * own. Every server listed here is required: one that reports
   * failed/needs-auth at session init aborts the run before any real work.
   */
  mcpServers?: Record<string, McpServerConfig>;
  outputFormat?: OutputFormat;
}

const READ_ONLY_ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

const HOOK_SUBTYPES = new Set(["hook_started", "hook_progress", "hook_response"]);

const REPEATED_ACTION_LIMIT = 3;

/** MCP init statuses that mean the server will never serve tools this session. */
const MCP_UNUSABLE_STATUSES = new Set(["failed", "needs-auth", "disabled"]);

type McpServerState = { name: string; status: string };

function mergeList(base: Array<string> | undefined, extra: Array<string> | undefined): Array<string> | undefined {
  if (!base && !extra) {
    return undefined;
  }
  return [...(base ?? []), ...(extra ?? [])];
}

/**
 * The required MCP servers that can't be used, given the `mcp_servers` array
 * of the SDK's init message. A server absent from that array is unusable too.
 */
function findUnusableMcpServers(
  required: Array<string>,
  reported: Array<McpServerState> | undefined
): Array<McpServerState> {
  return required
    .map((name) => ({ name, status: reported?.find((server) => server.name === name)?.status ?? "missing" }))
    .filter((server) => server.status === "missing" || MCP_UNUSABLE_STATUSES.has(server.status));
}

/**
 * The agent edits files through the SDK's built-in tools (Read/Edit/Grep/Glob).
 * Commit/push/PR happens separately in github/ after the run finishes — the
 * agent never runs `git push`/`gh pr create` itself, so permissionMode
 * "acceptEdits" (auto-accept file edits) is enough without opening up Bash.
 *
 * `options.readOnly` is a Szumrak-enforced guarantee for ask mode: the target
 * repo's agent-config.json permissions are ignored entirely (not merged) so a
 * repo-owned config file can never widen tool access beyond Read/Grep/Glob.
 */
export async function runAgent(task: string, options?: RunAgentOptions): Promise<AgentRunResult> {
  const hookHealth = checkHookHealth(env.WORKSPACE_PATH);
  if (hookHealth.total > 0 && hookHealth.failed.length === hookHealth.total) {
    log("hook_preflight_all_failed", { failed: hookHealth.failed });
    return {
      toolCalls: [],
      finalMessage:
        "Every hook command in this repo's .claude/settings.json failed a syntax pre-flight check — aborting before the agent starts.",
      succeeded: false
    };
  }
  if (hookHealth.failed.length > 0) {
    log("hook_preflight_warning", { failed: hookHealth.failed });
  }

  const toolCalls: Array<AgentToolCall> = [];
  let finalMessage = "";
  let succeeded = false;
  let totalCostUsd: number | undefined;
  let numTurns: number | undefined;
  const startedAt = Date.now();

  const readOnly = options?.readOnly ?? false;
  const auth = resolveAgentAuth();
  const model = options?.model ?? env.AGENT_MODEL;
  const maxTurns = options?.maxTurns ?? env.MAX_TURNS;
  const maxDurationMs = options?.maxDurationMs ?? env.MAX_DURATION_MS;
  const requiredMcpServers = Object.keys(options?.mcpServers ?? {});

  log("agent_start", {
    authMethod: auth.method,
    szumrakVersion: SZUMRAK_VERSION,
    mode: env.MODE,
    readOnly,
    dryRun: env.DRY_RUN,
    repo: env.REPO,
    task,
    workspacePath: env.WORKSPACE_PATH,
    requestedModel: model,
    maxTurns,
    maxDurationMs,
    maxBudgetUsd: options?.maxBudgetUsd,
    mcpServers: requiredMcpServers,
    structuredOutput: options?.outputFormat !== undefined,
    nodeVersion: process.version
  });

  let lastToolCallSignature: string | undefined;
  let repeatedToolCallCount = 0;
  let loopDetected: AgentRunResult["loopDetected"];
  let unusableMcpServers: Array<McpServerState> = [];
  let structuredOutput: unknown;

  const config = readOnly ? undefined : loadAgentConfig(env.WORKSPACE_PATH);
  const skills = options?.skills ?? config?.skills;

  const stream = query({
    prompt: task,
    options: {
      cwd: env.WORKSPACE_PATH,
      /** Carries exactly one auth credential — see agent/agent-auth.ts. */
      env: { ...auth.subprocessEnv, ...options?.env },
      permissionMode: readOnly ? "default" : "acceptEdits",
      maxTurns,
      model,
      ...(options?.maxBudgetUsd !== undefined ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
      allowedTools: readOnly
        ? READ_ONLY_ALLOWED_TOOLS
        : mergeList(config?.permissions?.allow, options?.permissions?.allow),
      disallowedTools: readOnly ? undefined : mergeList(config?.permissions?.deny, options?.permissions?.deny),
      /**
       * Skills whitelisted by the target repo's agent-config.json (`"all"` or
       * a name list). Discovery happens in the target repo's own
       * `.claude/skills/`; the model then invokes them autonomously based on
       * each SKILL.md's name/description. Omitted entirely when the target
       * repo doesn't opt in.
       */
      ...(skills !== undefined ? { skills } : {}),
      ...(options?.mcpServers !== undefined ? { mcpServers: options.mcpServers, strictMcpConfig: true } : {}),
      ...(options?.outputFormat !== undefined ? { outputFormat: options.outputFormat } : {}),
      /**
       * 'project' — and only 'project': the target repo's committed
       * .claude/ directory, never the machine-local 'user'/'local' tiers
       * (a developer's personal settings must not steer an unattended CI
       * run). This single value is what makes the SDK discover the target
       * repo's `.claude/skills/` — without it `skills` above is inert, since
       * it filters discovered skills rather than discovering them, and every
       * Skill call fails with "Unknown skill". It also pulls in CLAUDE.md
       * (hence no manual read here) and the repo's settings.json wholesale:
       * its hooks (per-edit formatters/linters) and its MCP autostart flags.
       * Quality control during the session is entirely the target repo's own
       * hooks — Szumrak registers no hooks of its own; see `includeHookEvents`
       * below for observing them.
       */
      settingSources: ["project"],
      /**
       * Surfaces `hook_started`/`hook_progress`/`hook_response` system
       * messages for the target repo's own settings.json hooks (PostToolUse
       * formatters/linters, etc.) in the message stream below, so their
       * execution is visible in agent-run.jsonl instead of running silently
       * in the SDK subprocess.
       */
      includeHookEvents: true,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: readOnly ? ASK_MODE_INSTRUCTIONS : (options?.systemPromptAppend ?? COMMIT_METADATA_INSTRUCTIONS),
        /**
         * Strips per-run dynamic sections (cwd, git status, auto-memory
         * path) out of the system prompt and re-injects them as the first
         * user message instead, so the static prefix (CLAUDE.md +
         * commit-metadata instructions) is byte-identical across
         * independent runs and can hit Anthropic's prompt cache
         * cross-session — not just across turns within one run, which
         * already share a stable prefix regardless. Free to enable: on a
         * cache miss this behaves exactly as before.
         */
        excludeDynamicSections: true
      }
    }
  });

  messageLoop: for await (const message of stream) {
    if (message.type === "assistant") {
      const textBlocks: Array<string> = [];
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolCall = { name: block.name, input: block.input as Record<string, unknown> };
          toolCalls.push(toolCall);
          log("tool_call", toolCall);

          const signature = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
          if (signature === lastToolCallSignature) {
            repeatedToolCallCount += 1;
          } else {
            lastToolCallSignature = signature;
            repeatedToolCallCount = 1;
          }

          if (repeatedToolCallCount >= REPEATED_ACTION_LIMIT) {
            loopDetected = { toolName: toolCall.name, input: toolCall.input, occurrences: repeatedToolCallCount };
            log("repeated_action_loop_detected", loopDetected);
            break messageLoop;
          }
        }
        if (block.type === "text") {
          finalMessage = block.text;
          textBlocks.push(block.text);
        }
      }
      log("agent_message", { type: message.type, text: textBlocks.join("\n") || undefined });
    } else if (message.type === "user") {
      log("agent_message", { type: message.type, content: message.message.content });
    } else if (message.type === "system" && "subtype" in message && HOOK_SUBTYPES.has(message.subtype)) {
      const hookMessage = message as unknown as {
        subtype: string;
        hook_id: string;
        hook_name: string;
        hook_event: string;
        stdout?: string;
        stderr?: string;
        exit_code?: number;
        outcome?: string;
      };
      log("hook_event", {
        subtype: hookMessage.subtype,
        hookId: hookMessage.hook_id,
        hookName: hookMessage.hook_name,
        hookEvent: hookMessage.hook_event,
        stdout: hookMessage.stdout,
        stderr: hookMessage.stderr,
        exitCode: hookMessage.exit_code,
        outcome: hookMessage.outcome
      });
    } else if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      log("agent_init", {
        model: message.model,
        claudeCodeVersion: message.claude_code_version,
        apiKeySource: message.apiKeySource,
        permissionMode: message.permissionMode,
        cwd: message.cwd,
        toolCount: message.tools?.length,
        /**
         * Names, not just the count: without them a run where the agent never
         * calls a skill is ambiguous — "Skill absent from the session" and
         * "Skill available but the model chose not to use it" look identical.
         */
        tools: message.tools,
        mcpServers: message.mcp_servers,
        sessionId: message.session_id
      });

      unusableMcpServers = findUnusableMcpServers(requiredMcpServers, message.mcp_servers);
      if (unusableMcpServers.length > 0) {
        log("required_mcp_unavailable", { servers: unusableMcpServers });
        break;
      }
    } else {
      log("agent_message", { type: message.type, ...("subtype" in message ? { subtype: message.subtype } : {}) });
    }

    if (message.type === "result") {
      succeeded = message.subtype === "success" && !message.is_error;
      totalCostUsd = message.total_cost_usd;
      numTurns = message.num_turns;
      if ("structured_output" in message) {
        structuredOutput = message.structured_output;
      }
      if ("result" in message && typeof message.result === "string") {
        finalMessage = message.result;
      }
      log("agent_result", {
        subtype: message.subtype,
        isError: message.is_error,
        totalCostUsd: message.total_cost_usd,
        numTurns: message.num_turns,
        result: "result" in message ? message.result : undefined
      });
    }

    if (Date.now() - startedAt > maxDurationMs) {
      log("agent_timeout", { elapsedMs: Date.now() - startedAt });
      throw new Error("Agent exceeded max duration");
    }
  }

  if (unusableMcpServers.length > 0) {
    succeeded = false;
    finalMessage = `Required MCP server(s) unavailable, aborted before the agent did any work: ${unusableMcpServers
      .map((server) => `${server.name} (${server.status})`)
      .join(", ")}.`;
  }

  if (loopDetected) {
    succeeded = false;
    finalMessage = `Agent appears stuck repeating the same "${loopDetected.toolName}" call with input ${JSON.stringify(loopDetected.input)} ${loopDetected.occurrences} times in a row and was stopped.`;
  }

  const commitMetadata = parseCommitMetadata(finalMessage);
  /**
   * Strip the machine-readable block from the human-facing summary (DRY_RUN
   * console output, PR body) now that it's been parsed out.
   */
  const displayMessage = finalMessage.replace(COMMIT_BLOCK_PATTERN, "").trim();

  log("agent_end", { toolCallCount: toolCalls.length, succeeded, finalMessage: displayMessage, commitMetadata });

  return {
    toolCalls,
    finalMessage: displayMessage,
    succeeded,
    totalCostUsd,
    commitMetadata,
    numTurns,
    loopDetected,
    structuredOutput
  };
}
