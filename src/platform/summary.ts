import { appendFileSync } from "node:fs";
import { env } from "~/platform/env";

/**
 * `GITHUB_STEP_SUMMARY` is a GH Actions-provided file path rendered as
 * markdown on the job's summary page — the closest equivalent we have today
 * to the "postStatusComment" design in Notion page 14, which posts to the
 * issue that triggered the run. That design assumes an `issue_comment`
 * trigger; the current workflow is `workflow_dispatch` only, so there is no
 * issue to comment on. A successful run is already visible as the
 * "ai-generated" PR itself, so this is normally reserved for failures
 * (default icon); the dedup skip path in flows/runner/run-runner-flow.ts
 * passes "ℹ️" instead. Best-effort: the env var is unset outside CI
 * (local/dev runs), and a missing/unmounted file must never crash the agent.
 */
export function writeStepSummary(message: string, icon = "❌"): void {
  const summaryPath = env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  try {
    appendFileSync(summaryPath, `${icon} **Szumrak** — ${message}\n`);
  } catch {
    /** Failing to write the summary must never crash the agent. */
  }
}
