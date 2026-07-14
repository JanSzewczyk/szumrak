import { appendFileSync } from "node:fs";

// GITHUB_STEP_SUMMARY is a GH Actions-provided file path rendered as markdown
// on the job's summary page — the closest equivalent we have today to the
// "postStatusComment" design in Notion page 14, which posts to the issue that
// triggered the run. That design assumes an `issue_comment` trigger; the
// current workflow is `workflow_dispatch` only, so there is no issue to
// comment on. Only failures are written here — a successful run is already
// visible as the "ai-generated" PR itself. Best-effort: the env var is unset
// outside CI (local/dev runs), and a missing/unmounted file must never crash
// the agent.
export function writeStepSummary(message: string): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  try {
    appendFileSync(summaryPath, `❌ **Szumrak** — ${message}\n`);
  } catch {
    // failing to write the summary must never crash the agent
  }
}
