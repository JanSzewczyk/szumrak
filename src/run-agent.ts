import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { env } from "./env";
import { log } from "./lib/logger";

export interface AgentToolCall {
  name: string;
  input: Record<string, unknown>;
}

const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "chore",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "revert"
] as const;
type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

export interface CommitMetadata {
  type: ConventionalCommitType;
  scope?: string;
  subject: string;
  branchSlug: string;
}

export interface AgentRunResult {
  toolCalls: Array<AgentToolCall>;
  finalMessage: string;
  succeeded: boolean;
  totalCostUsd?: number;
  commitMetadata?: CommitMetadata;
  sessionId?: string;
  numTurns?: number;
}

export interface AgentRunOptions {
  // SDK session id to resume, so a review-followup round can continue the
  // actual prior conversation instead of rebuilding context from a flattened
  // task/diff/feedback prompt alone. Omitted (or invalid/expired session-side)
  // is a no-op — the SDK just starts a fresh session, so this is purely additive.
  resume?: string;
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

// Appended to the system prompt so the agent — the one that actually knows
// what it changed and why — produces the commit metadata itself, instead of
// git.ts guessing a commit type from the raw task text (which used to always
// commit as "chore(agent): ...", regardless of the real change; craft-flow's
// semantic-release parses commit type for versioning, so a wrong type is a
// real bug, not just cosmetic). Runs in the same turn as the edits, so it
// costs no extra API call.
const COMMIT_METADATA_INSTRUCTIONS = `
When you have finished making all edits for this task, end your final response with exactly one fenced block using these four field names literally, each on its own line. Keep "type" and "subject" as separate lines — do not collapse them into one "type: subject" line the way a real commit message reads.

\`\`\`commit
type: <feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert — pick exactly one>
scope: <short kebab-case scope, or delete this line if there is none>
subject: <imperative mood, lowercase, no trailing period, at most 50 characters>
branch: <kebab-case slug describing the change, at most 40 characters, no type prefix>
\`\`\`

Example, for a change that added tests for a search-params helper:

\`\`\`commit
type: test
scope: search-params
subject: add unit tests for parseSearchParams
branch: add-search-params-tests
\`\`\`

Describe the change you actually made, not the wording of the task. If you made no changes, omit this block entirely.
`.trim();

const COMMIT_BLOCK_PATTERN = /```commit\s*\n([\s\S]*?)```/;

function parseCommitMetadata(finalMessage: string): CommitMetadata | undefined {
  const match = finalMessage.match(COMMIT_BLOCK_PATTERN);
  if (!match) {
    return undefined;
  }

  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const fieldMatch = line.match(/^(type|scope|subject|branch):\s*(.+)$/);
    if (fieldMatch) {
      fields[fieldMatch[1]] = fieldMatch[2].trim();
    }
  }

  // Tolerate the model collapsing "type: <type>" and "subject: <subject>"
  // into a single conventional-commit-style line (e.g. a bare
  // "test: add unit tests..." line instead of separate "type:"/"subject:"
  // lines) — an easy mistake since that's what the final commit message is
  // supposed to look like. Neither "type" nor "subject" matches the strict
  // field regex above in that case, so scan every line for one that starts
  // with a valid conventional commit type.
  if (!fields.type || !CONVENTIONAL_COMMIT_TYPES.includes(fields.type as ConventionalCommitType)) {
    for (const line of match[1].split("\n")) {
      const collapsed = line.match(/^(\w+):\s*(.+)$/);
      if (collapsed && CONVENTIONAL_COMMIT_TYPES.includes(collapsed[1] as ConventionalCommitType)) {
        fields.type = collapsed[1];
        fields.subject ??= collapsed[2];
        break;
      }
    }
  }

  const type = fields.type as ConventionalCommitType;
  if (!CONVENTIONAL_COMMIT_TYPES.includes(type) || !fields.subject || !fields.branch) {
    log("commit_metadata_invalid", { fields });
    return undefined;
  }

  const branchSlug = fields.branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!branchSlug) {
    log("commit_metadata_invalid", { fields });
    return undefined;
  }

  return { type, scope: fields.scope || undefined, subject: fields.subject.slice(0, 50), branchSlug };
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

// Runs one query() stream to completion. Split out of runAgent() so a resume
// that the SDK rejects outright (see runAgent's retry below) can be retried
// as a fresh session without duplicating the whole message-loop.
async function executeQuery(task: string, resume: string | undefined): Promise<AgentRunResult> {
  const toolCalls: Array<AgentToolCall> = [];
  let finalMessage = "";
  let succeeded = false;
  let totalCostUsd: number | undefined;
  let sessionId: string | undefined;
  let numTurns: number | undefined;
  const startedAt = Date.now();

  const permissions = loadAgentPermissions(env.WORKSPACE_PATH);
  const claudeMd = loadClaudeMd(env.WORKSPACE_PATH);

  const stream = query({
    prompt: task,
    options: {
      cwd: env.WORKSPACE_PATH,
      permissionMode: "acceptEdits",
      maxTurns: env.MAX_TURNS,
      model: env.AGENT_MODEL,
      resume,
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
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: claudeMd ? `${claudeMd}\n\n${COMMIT_METADATA_INSTRUCTIONS}` : COMMIT_METADATA_INSTRUCTIONS,
        // Strips per-run dynamic sections (cwd, git status, auto-memory path)
        // out of the system prompt and re-injects them as the first user
        // message instead, so the static prefix (CLAUDE.md + commit-metadata
        // instructions) is byte-identical across independent runs and can hit
        // Anthropic's prompt cache cross-session — not just across turns
        // within one run, which already share a stable prefix regardless.
        // Free to enable: on a cache miss this behaves exactly as before.
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
      sessionId = message.session_id;
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
      sessionId = message.session_id ?? sessionId;
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
  // Strip the machine-readable block from the human-facing summary (DRY_RUN
  // console output, PR body) now that it's been parsed out.
  const displayMessage = finalMessage.replace(COMMIT_BLOCK_PATTERN, "").trim();

  log("agent_end", { toolCallCount: toolCalls.length, succeeded, finalMessage: displayMessage, commitMetadata });

  return { toolCalls, finalMessage: displayMessage, succeeded, totalCostUsd, commitMetadata, sessionId, numTurns };
}

// The agent edits files through the SDK's built-in tools (Read/Edit/Grep/Glob).
// Commit/push/PR happens separately in git.ts after the run finishes — the agent
// never runs `git push`/`gh pr create` itself, so permissionMode "acceptEdits"
// (auto-accept file edits) is enough without opening up Bash.
export async function runAgent(task: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
  log("agent_start", {
    task,
    workspacePath: env.WORKSPACE_PATH,
    requestedModel: env.AGENT_MODEL ?? "default",
    maxTurns: env.MAX_TURNS,
    maxDurationMs: env.MAX_DURATION_MS,
    nodeVersion: process.version
  });

  try {
    return await executeQuery(task, options.resume);
  } catch (err) {
    // A stored session id from an earlier round is only ever a local-storage
    // reference (see the SDK's own conversation-history model) — it doesn't
    // survive into a *different* container, which is exactly what every
    // review-followup round runs in (`docker run --rm` per job, no shared
    // volume across runs). The SDK doesn't degrade this to a fresh session on
    // its own; it throws instead. Retry once as a brand-new session rather
    // than letting a resume that was only ever a nice-to-have take down the
    // whole round — a resume failure must never be a new failure mode.
    if (!options.resume) {
      throw err;
    }
    log("resume_failed_retrying_fresh_session", { error: String(err) });
    return await executeQuery(task, undefined);
  }
}
