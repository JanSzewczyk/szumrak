import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "./env";
import { log } from "./lib/logger";

export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface AgentRunResult {
  toolCalls: Array<AgentToolCall>;
  finalMessage: string;
  succeeded: boolean;
  totalCostUsd?: number;
}

interface AgentPermissions {
  allow?: Array<string>;
  deny?: Array<string>;
}

// Target repos opt into an agent-specific tool whitelist/denylist by committing
// `.claude/agent-permissions.json`. Deliberately separate from the repo's own
// `.claude/settings.json`, which governs interactive Claude Code sessions (hooks,
// personal permissions) and isn't meant to double as the unattended agent's
// sandbox — see Notion page 17, Faza 2/6. A missing file means "no extra
// restriction beyond permissionMode", not a hard failure.
function loadAgentPermissions(workspacePath: string): AgentPermissions {
  const permissionsPath = join(workspacePath, ".claude", "agent-permissions.json");
  if (!existsSync(permissionsPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(permissionsPath, "utf-8")) as AgentPermissions;
  } catch (err) {
    log("agent_permissions_invalid", { permissionsPath, error: String(err) });
    return {};
  }
}

// Read manually because `settingSources` below excludes 'project', which is
// what normally makes the SDK discover CLAUDE.md. See runAgent() for why.
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

// The agent edits files through the SDK's built-in tools (Read/Edit/Grep/Glob).
// Commit/push/PR happens separately in git.ts after the run finishes — the agent
// never runs `git push`/`gh pr create` itself, so permissionMode "acceptEdits"
// (auto-accept file edits) is enough without opening up Bash.
export async function runAgent(task: string): Promise<AgentRunResult> {
  const toolCalls: Array<AgentToolCall> = [];
  let finalMessage = "";
  let succeeded = false;
  let totalCostUsd: number | undefined;
  const startedAt = Date.now();

  log("agent_start", {
    task,
    workspacePath: env.WORKSPACE_PATH,
    requestedModel: env.AGENT_MODEL ?? "default",
    maxTurns: env.MAX_TURNS,
    maxDurationMs: env.MAX_DURATION_MS,
    nodeVersion: process.version
  });

  const permissions = loadAgentPermissions(env.WORKSPACE_PATH);
  const claudeMd = loadClaudeMd(env.WORKSPACE_PATH);

  const stream = query({
    prompt: task,
    options: {
      cwd: env.WORKSPACE_PATH,
      permissionMode: "acceptEdits",
      maxTurns: env.MAX_TURNS,
      model: env.AGENT_MODEL,
      allowedTools: permissions.allow,
      disallowedTools: permissions.deny,
      // Never load the target repo's .claude/settings.json or
      // settings.local.json (the SDK default is to load everything it finds).
      // Those files are written for interactive Claude Code sessions — hooks
      // in particular tend to assume an interactive shell and can hard-loop
      // or crash an unattended run (e.g. a PreToolUse hook using bash-only
      // `[[ ]]` syntax fails under this image's /bin/sh and blocks every tool
      // call). Tool restrictions for the agent come only from
      // agent-permissions.json above. CLAUDE.md is loaded manually via
      // systemPrompt.append instead, since 'project' is what would normally
      // pull it in alongside the hooks we're excluding.
      settingSources: [],
      systemPrompt: claudeMd
        ? { type: "preset", preset: "claude_code", append: claudeMd }
        : { type: "preset", preset: "claude_code" }
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

  log("agent_end", { toolCallCount: toolCalls.length, succeeded, finalMessage });

  return { toolCalls, finalMessage, succeeded, totalCostUsd };
}
