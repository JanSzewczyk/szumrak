import { runAgent } from "~/agent/run-agent";
import { findOpenPRForTask } from "~/github/dedup";
import { commitAndOpenPR } from "~/github/pull-requests";
import { parseRepo } from "~/github/repo";
import { appendRunInfo } from "~/github/run-info";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import type { FlowResult } from "../types";

export interface RunnerFlowInput {
  task: string;
}

/**
 * The runner flow: given a natural-language task, run the agent against
 * `WORKSPACE_PATH` and (unless `DRY_RUN`) open a PR with the result. This is
 * the flow behind `MODE=runner` (`env.MODE === Mode.RUNNER`) — the "do this
 * task from scratch" entry point, as opposed to flows/review-followup which
 * continues work on an existing PR.
 *
 * Takes a single input object (not a positional `task: string`) so
 * flows/registry.ts can assign it directly into the registry without
 * wrapping/casting anything.
 */
export async function runRunnerFlow({ task }: RunnerFlowInput): Promise<FlowResult> {
  /**
   * Deduplication needs REPO + GitHub App credentials to list PRs, both
   * guaranteed present by platform/env.ts's schema whenever DRY_RUN is off.
   */
  if (!env.DRY_RUN) {
    const { owner, repo } = parseRepo(env.REPO);
    const existingPRUrl = await findOpenPRForTask(owner, repo, task);
    if (existingPRUrl) {
      console.log(`An open PR already exists for this task, skipping: ${existingPRUrl}`);
      writeStepSummary(`Skipped — an open PR already exists for this task: ${existingPRUrl}`, "ℹ️");
      return { succeeded: true };
    }
  }

  const result = await runAgent(task);

  if (!result.succeeded) {
    log("agent_run_failed", { finalMessage: result.finalMessage });
    console.error("The agent did not complete the task successfully.");
    writeStepSummary(`Task did not complete successfully: ${result.finalMessage.slice(0, 300)}`);
    return { succeeded: false };
  }

  if (env.DRY_RUN) {
    log("dry_run_active", { note: "Changes are left on disk; no PR will be created." });
    console.log("DRY_RUN=true — changes left on disk, no commit or PR.");
    console.log(`\nAgent result:\n${result.finalMessage}`);
    return { succeeded: true };
  }

  /**
   * Adds a visible "Szumrak run info" cost/round table (plus a trailing,
   * invisible szumrak-meta comment carrying the same data as JSON) so a
   * reviewer can see at a glance what each round cost — see
   * github/run-info.ts.
   */
  const body = appendRunInfo(
    `Task:\n${task}\n\nGenerated automatically by Szumrak.\n\nModel summary:\n${result.finalMessage}`,
    undefined,
    0,
    { totalCostUsd: result.totalCostUsd, numTurns: result.numTurns }
  );

  const prUrl = await commitAndOpenPR(task.slice(0, 72), body, result.commitMetadata);

  if (prUrl) {
    console.log(`PR created: ${prUrl}`);
  } else {
    console.log("No changes to commit.");
  }

  return { succeeded: true };
}
