import { appendFileSync } from "node:fs";

const LOG_PATH = process.env.AGENT_LOG_PATH ?? "/workspace/agent-run.jsonl";

export function log(event: string, data: Record<string, unknown> = {}) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
  console.log(entry);
  try {
    appendFileSync(LOG_PATH, entry + "\n");
  } catch {
    // brak zapisu do pliku nie powinien wywalać agenta
  }
}
