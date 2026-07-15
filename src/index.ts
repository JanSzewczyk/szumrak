import { flowRegistry } from "./flows/registry";
import { parseRepo } from "./github/repo";
import { env } from "./platform/env";
import { log } from "./platform/logger";
import { writeStepSummary } from "./platform/summary";
import { Mode } from "./types/mode";

async function main() {
  // First thing logged, before any guard can exit — records how this run was
  // invoked (mode + the non-secret parameters that shape it) even if it goes
  // on to fail a guard below. Never logs TASK/REVIEW_FEEDBACK content or any
  // credential; log() would redact/truncate them anyway (platform/logger.ts),
  // but keeping secrets out of the call entirely is the safer default.
  log("run_started", {
    mode: env.MODE,
    dryRun: env.DRY_RUN,
    workspacePath: env.WORKSPACE_PATH,
    repo: env.REPO,
    hasTask: Boolean(env.TASK),
    prNumber: env.PR_NUMBER,
    hasReviewFeedback: Boolean(env.REVIEW_FEEDBACK),
    agentModel: env.AGENT_MODEL ?? "default",
    maxTurns: env.MAX_TURNS,
    maxDurationMs: env.MAX_DURATION_MS,
    nodeVersion: process.version
  });

  // When not a dry run we need REPO + the GitHub App credentials to talk to
  // GitHub at all — check upfront so a misconfigured run fails before
  // spending an API turn rather than after.
  if (!env.DRY_RUN && (!env.REPO || !env.GH_APP_ID || !env.GH_APP_PRIVATE_KEY || !env.GH_APP_INSTALLATION_ID)) {
    console.error("REPO, GH_APP_ID, GH_APP_PRIVATE_KEY, and GH_APP_INSTALLATION_ID are required unless DRY_RUN=true.");
    process.exit(1);
  }

  try {
    // Each mode validates only the env it needs, right next to where it
    // dispatches — review-followup gets its task from the PR body instead of
    // TASK, so it never needs TASK required, and vice versa for PR_NUMBER/
    // REVIEW_FEEDBACK.
    if (env.MODE === Mode.REVIEW_FOLLOWUP) {
      if (!env.PR_NUMBER || !env.REVIEW_FEEDBACK) {
        console.error("PR_NUMBER and REVIEW_FEEDBACK are required when MODE=review-followup.");
        process.exit(1);
      }

      const { owner, repo } = parseRepo(env.REPO);
      const result = await flowRegistry[Mode.REVIEW_FOLLOWUP]({
        owner,
        repo,
        prNumber: env.PR_NUMBER,
        reviewFeedback: env.REVIEW_FEEDBACK
      });
      if (!result.succeeded) {
        process.exit(1);
      }
      return;
    }

    if (env.MODE === Mode.RUNNER) {
      if (!env.TASK) {
        console.error("TASK is required when MODE=runner.");
        process.exit(1);
      }

      const result = await flowRegistry[Mode.RUNNER]({ task: env.TASK });
      if (!result.succeeded) {
        process.exit(1);
      }
    }
  } catch (err) {
    log("fatal_error", { error: String(err) });
    console.error(err);
    writeStepSummary(`Fatal error: ${String(err).slice(0, 300)}`);
    process.exit(1);
  }
}

main();
