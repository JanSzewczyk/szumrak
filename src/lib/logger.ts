import { appendFileSync } from "node:fs";
import { join } from "node:path";

// Derived from WORKSPACE_PATH by default (not hardcoded to "/workspace"):
// otherwise, in Level 1 testing (no Docker, WORKSPACE_PATH pointing at a local
// checkout), the write would fail silently in the try/catch below and drop the
// logs in exactly the scenario they are meant to serve.
const LOG_PATH =
  process.env.AGENT_LOG_PATH ?? join(process.env.WORKSPACE_PATH ?? "/workspace", "agent-run.jsonl");

export function log(event: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  console.log(entry);
  try {
    appendFileSync(LOG_PATH, entry + "\n");
  } catch {
    // failing to write the file must never crash the agent
  }
}
