import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "~/platform/env";

/**
 * Derived from WORKSPACE_PATH by default (not hardcoded to "/workspace"):
 * otherwise, in Level 1 testing (no Docker, WORKSPACE_PATH pointing at a
 * local checkout), the write would fail silently in the try/catch below and
 * drop the logs in exactly the scenario they are meant to serve.
 */
const LOG_PATH = env.AGENT_LOG_PATH ?? join(env.WORKSPACE_PATH, "agent-run.jsonl");

/**
 * agent-run.jsonl is uploaded as a CI artifact (readable by anyone with
 * repo/Actions access), so it must never carry a live credential even if the
 * agent-config.json permissions denylist fails to keep the agent away from one
 * (e.g. a key hardcoded in application code rather than an env file).
 * Matches the common vendor token shapes, not a generic entropy heuristic —
 * see Notion page 12.
 */
const SECRET_PATTERNS: Array<RegExp> = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[oprsu]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g
];

/**
 * Full file contents (e.g. a Write tool's `content` input, or a Read tool's
 * result) dwarf this length; paths and diff-sized edits stay intact.
 */
const MAX_STRING_LENGTH = 500;

function redactSecrets(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function truncate(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}... [truncated, ${value.length} chars total]`;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return truncate(redactSecrets(value));
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, sanitizeValue(value)]));
}

export function log(event: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...sanitizeObject(data) });
  console.log(entry);
  try {
    appendFileSync(LOG_PATH, `${entry}\n`);
  } catch {
    /** Failing to write the file must never crash the agent. */
  }
}
