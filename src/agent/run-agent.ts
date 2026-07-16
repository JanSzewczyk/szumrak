import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { loadAgentConfig } from "./agent-config";
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
}

export interface RunAgentOptions {
  readOnly?: boolean;
}

const READ_ONLY_ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

const HOOK_SUBTYPES = new Set(["hook_started", "hook_progress", "hook_response"]);

const REPEATED_ACTION_LIMIT = 3;

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

  log("agent_start", {
    task,
    workspacePath: env.WORKSPACE_PATH,
    requestedModel: env.AGENT_MODEL ?? "default",
    maxTurns: env.MAX_TURNS,
    maxDurationMs: env.MAX_DURATION_MS,
    nodeVersion: process.version
  });

  let lastToolCallSignature: string | undefined;
  let repeatedToolCallCount = 0;
  let loopDetected: AgentRunResult["loopDetected"];

  const readOnly = options?.readOnly ?? false;
  const config = readOnly ? undefined : loadAgentConfig(env.WORKSPACE_PATH);

  const stream = query({
    prompt: task,
    options: {
      cwd: env.WORKSPACE_PATH,
      permissionMode: readOnly ? "default" : "acceptEdits",
      maxTurns: env.MAX_TURNS,
      model: env.AGENT_MODEL,
      allowedTools: readOnly ? READ_ONLY_ALLOWED_TOOLS : config?.permissions?.allow,
      disallowedTools: readOnly ? undefined : config?.permissions?.deny,
      /**
       * Skills whitelisted by the target repo's agent-config.json (`"all"` or
       * a name list). Discovery happens in the target repo's own
       * `.claude/skills/`; the model then invokes them autonomously based on
       * each SKILL.md's name/description. Omitted entirely when the target
       * repo doesn't opt in.
       */
      ...(config?.skills !== undefined ? { skills: config.skills } : {}),
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
        append: readOnly ? ASK_MODE_INSTRUCTIONS : COMMIT_METADATA_INSTRUCTIONS,
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
    } else {
      log("agent_message", { type: message.type, ...("subtype" in message ? { subtype: message.subtype } : {}) });
    }

    if (message.type === "result") {
      succeeded = message.subtype === "success" && !message.is_error;
      totalCostUsd = message.total_cost_usd;
      numTurns = message.num_turns;
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

    if (Date.now() - startedAt > env.MAX_DURATION_MS) {
      log("agent_timeout", { elapsedMs: Date.now() - startedAt });
      throw new Error("Agent exceeded max duration");
    }
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

  return { toolCalls, finalMessage: displayMessage, succeeded, totalCostUsd, commitMetadata, numTurns, loopDetected };
}
