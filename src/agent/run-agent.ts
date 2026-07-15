import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type HookCallbackMatcher, query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { loadAgentConfig } from "./agent-config";
import {
  COMMIT_BLOCK_PATTERN,
  COMMIT_METADATA_INSTRUCTIONS,
  type CommitMetadata,
  parseCommitMetadata
} from "./commit-metadata";
import { runVerifyCommands } from "./verify";

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
}

/**
 * How many times the Stop hook may push the agent back to work over failing
 * verify commands within a single run. Past the cap the session is allowed to
 * end (the runner flow's final gate still catches the unresolved failure) —
 * without a cap a failure the agent can't fix would burn turns until
 * MAX_TURNS/MAX_DURATION_MS.
 */
const MAX_VERIFY_BLOCKS = 2;

/**
 * Builds the programmatic Stop hook that runs the target repo's `verify`
 * commands whenever the agent tries to finish, feeding failures back so it
 * fixes them autonomously in the same session. In-process callbacks on
 * purpose: they carry none of the interactive-shell assumptions that make the
 * target repo's own settings.json hooks unsafe to run unattended (which is
 * why `settingSources: []` below excludes them).
 */
function buildVerifyStopHook(verifyCommands: Array<string>): Partial<Record<"Stop", Array<HookCallbackMatcher>>> {
  let blocks = 0;
  return {
    Stop: [
      {
        hooks: [
          async function verifyOnStop() {
            if (blocks >= MAX_VERIFY_BLOCKS) {
              log("verify_cap_reached", { blocks });
              return {};
            }
            const outcome = runVerifyCommands(verifyCommands, env.WORKSPACE_PATH);
            if (outcome.passed) {
              log("verify_passed", { commands: verifyCommands });
              return {};
            }
            blocks += 1;
            log("verify_failed", { round: blocks, report: outcome.report });
            return {
              decision: "block" as const,
              reason: `The repository's verification commands failed after your changes. Fix the reported problems before finishing:\n\n${outcome.report}`
            };
          }
        ]
      }
    ]
  };
}

/**
 * Read manually because `settingSources` below excludes 'project', which is
 * what normally makes the SDK discover CLAUDE.md. See {@link runAgent} for
 * why.
 */
function loadClaudeMd(workspacePath: string): string | undefined {
  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    return undefined;
  }
  try {
    return readFileSync(claudeMdPath, "utf-8");
  } catch (err) {
    log("claude_md_unreadable", { claudeMdPath, error: String(err) });
    return undefined;
  }
}

/**
 * The agent edits files through the SDK's built-in tools (Read/Edit/Grep/Glob).
 * Commit/push/PR happens separately in github/ after the run finishes — the
 * agent never runs `git push`/`gh pr create` itself, so permissionMode
 * "acceptEdits" (auto-accept file edits) is enough without opening up Bash.
 */
export async function runAgent(task: string): Promise<AgentRunResult> {
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

  const config = loadAgentConfig(env.WORKSPACE_PATH);
  const claudeMd = loadClaudeMd(env.WORKSPACE_PATH);
  const verifyCommands = config.verify ?? [];

  const stream = query({
    prompt: task,
    options: {
      cwd: env.WORKSPACE_PATH,
      permissionMode: "acceptEdits",
      maxTurns: env.MAX_TURNS,
      model: env.AGENT_MODEL,
      allowedTools: config.permissions?.allow,
      disallowedTools: config.permissions?.deny,
      /**
       * Skills whitelisted by the target repo's agent-config.json (`"all"` or
       * a name list). Discovery happens in the target repo's own
       * `.claude/skills/`; the model then invokes them autonomously based on
       * each SKILL.md's name/description. Omitted entirely when the target
       * repo doesn't opt in.
       */
      ...(config.skills !== undefined ? { skills: config.skills } : {}),
      ...(verifyCommands.length > 0 ? { hooks: buildVerifyStopHook(verifyCommands) } : {}),
      /**
       * Never load the target repo's .claude/settings.json or
       * settings.local.json (the SDK default is to load everything it
       * finds). Those files are written for interactive Claude Code
       * sessions — hooks in particular tend to assume an interactive shell
       * and can hard-loop or crash an unattended run (e.g. a PreToolUse
       * hook using bash-only `[[ ]]` syntax fails under this image's
       * /bin/sh and blocks every tool call). Tool restrictions for the
       * agent come only from agent-config.json above. CLAUDE.md is
       * loaded manually via systemPrompt.append instead, since 'project' is
       * what would normally pull it in alongside the hooks we're excluding.
       */
      settingSources: [],
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: claudeMd ? `${claudeMd}\n\n${COMMIT_METADATA_INSTRUCTIONS}` : COMMIT_METADATA_INSTRUCTIONS,
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

  for await (const message of stream) {
    if (message.type === "assistant") {
      const textBlocks: Array<string> = [];
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolCall = { name: block.name, input: block.input as Record<string, unknown> };
          toolCalls.push(toolCall);
          log("tool_call", toolCall);
        }
        if (block.type === "text") {
          finalMessage = block.text;
          textBlocks.push(block.text);
        }
      }
      log("agent_message", { type: message.type, text: textBlocks.join("\n") || undefined });
    } else if (message.type === "user") {
      log("agent_message", { type: message.type, content: message.message.content });
    } else if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      log("agent_init", {
        model: message.model,
        claudeCodeVersion: message.claude_code_version,
        apiKeySource: message.apiKeySource,
        permissionMode: message.permissionMode,
        cwd: message.cwd,
        toolCount: message.tools?.length,
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

  const commitMetadata = parseCommitMetadata(finalMessage);
  /**
   * Strip the machine-readable block from the human-facing summary (DRY_RUN
   * console output, PR body) now that it's been parsed out.
   */
  const displayMessage = finalMessage.replace(COMMIT_BLOCK_PATTERN, "").trim();

  log("agent_end", { toolCallCount: toolCalls.length, succeeded, finalMessage: displayMessage, commitMetadata });

  return { toolCalls, finalMessage: displayMessage, succeeded, totalCostUsd, commitMetadata, numTurns };
}
