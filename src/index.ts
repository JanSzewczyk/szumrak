import { env } from "./env";
import { commitAndOpenPR, parseRepo } from "./git";
import { findOpenPRForTask } from "./lib/dedup";
import { log } from "./lib/logger";
import { appendRunInfo } from "./lib/run-info";
import { writeStepSummary } from "./lib/summary";
import { runReviewFollowUp } from "./review-followup";
import { runAgent } from "./run-agent";

async function main() {
  // When not a dry run we need REPO + the GitHub App credentials to talk to
  // GitHub at all — check upfront so a misconfigured run fails before
  // spending an API turn rather than after.
  if (!env.DRY_RUN && (!env.REPO || !env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY || !env.GH_APP_INSTALLATION_ID)) {
    console.error("REPO, GH_APP_ID, GH_APP_PRIVATE_KEY, and GH_APP_INSTALLATION_ID are required unless DRY_RUN=true.");
    process.exit(1);
  }

  // TASK is only required for a fresh (MODE=initial) run; review-followup
  // gets its task from the PR body instead, via PR_NUMBER + REVIEW_FEEDBACK.
  if (env.MODE === "review-followup") {
    if (!env.PR_NUMBER || !env.REVIEW_FEEDBACK) {
      console.error("PR_NUMBER and REVIEW_FEEDBACK are required when MODE=review-followup.");
      process.exit(1);
    }
  } else if (!env.TASK) {
    console.error("TASK is required when MODE=initial.");
    process.exit(1);
  }

  try {
    if (env.MODE === "review-followup") {
      const { owner, repo } = parseRepo(env.REPO);
      const result = await runReviewFollowUp(owner, repo, env.PR_NUMBER as number, env.REVIEW_FEEDBACK as string);
      if (!result.succeeded) {
        process.exit(1);
      }
      return;
    }

    const task = env.TASK as string;

    // Deduplication needs REPO + GitHub App credentials to list PRs, all
    // guaranteed present by the guard above whenever DRY_RUN is off.
    if (!env.DRY_RUN) {
      const { owner, repo } = parseRepo(env.REPO);
      const existingPRUrl = await findOpenPRForTask(owner, repo, task);
      if (existingPRUrl) {
        console.log(`An open PR already exists for this task, skipping: ${existingPRUrl}`);
        writeStepSummary(`Skipped — an open PR already exists for this task: ${existingPRUrl}`, "ℹ️");
        return;
      }
    }

    const result = await runAgent(task);

    if (!result.succeeded) {
      log("agent_run_failed", { finalMessage: result.finalMessage });
      console.error("The agent did not complete the task successfully.");
      writeStepSummary(`Task did not complete successfully: ${result.finalMessage.slice(0, 300)}`);
      process.exit(1);
    }

    if (env.DRY_RUN) {
      log("dry_run_active", { note: "Changes are left on disk; no PR will be created." });
      console.log("DRY_RUN=true — changes left on disk, no commit or PR.");
      console.log(`\nAgent result:\n${result.finalMessage}`);
      return;
    }

    // Adds a visible "Szumrak run info" cost/round table (plus a trailing,
    // invisible szumrak-meta comment carrying the same data as JSON) so a
    // reviewer can see at a glance what each round cost — see lib/run-info.ts.
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
  } catch (err) {
    log("fatal_error", { error: String(err) });
    console.error(err);
    writeStepSummary(`Fatal error: ${String(err).slice(0, 300)}`);
    process.exit(1);
  }
}

main();
