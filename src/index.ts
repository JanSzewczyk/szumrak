import { flowRegistry } from "./flows/registry";
import { parseRepo } from "./github/repo";
import { env } from "./platform/env";
import { log } from "./platform/logger";
import { writeStepSummary } from "./platform/summary";
import { Mode } from "./types/mode";

/** Entrypoint — reads validated env, logs the run, and dispatches to a flow by `MODE`. */
async function main() {
  /**
   * First thing logged, before any guard can exit — records how this run was
   * invoked (mode + the non-secret parameters that shape it) even if it goes
   * on to fail a guard below. Never logs TASK/REVIEW_FEEDBACK content or any
   * credential; log() would redact/truncate them anyway (platform/logger.ts),
   * but keeping secrets out of the call entirely is the safer default.
   * env.TASK/PR_NUMBER/REVIEW_FEEDBACK only exist on one branch of env's
   * MODE-discriminated type each (see platform/env.ts) — `in` narrows per
   * branch, and also reflects runtime truth: Zod strips keys the matched
   * branch doesn't declare, so e.g. "TASK" in env is false, not just
   * unnarrowed, on the review-followup branch.
   */
  log("run_started", {
    mode: env.MODE,
    dryRun: env.DRY_RUN,
    workspacePath: env.WORKSPACE_PATH,
    repo: env.REPO,
    hasTask: "TASK" in env,
    prNumber: "PR_NUMBER" in env ? env.PR_NUMBER : undefined,
    hasReviewFeedback: "REVIEW_FEEDBACK" in env,
    hasQuestion: "QUESTION" in env,
    agentModel: env.AGENT_MODEL,
    maxTurns: env.MAX_TURNS,
    maxDurationMs: env.MAX_DURATION_MS,
    nodeVersion: process.version
  });

  try {
    /**
     * No manual guards here for TASK/PR_NUMBER/REVIEW_FEEDBACK
     * (MODE-dependent) or REPO/GH_APP_* (DRY_RUN-dependent) —
     * platform/env.ts's schema already guarantees all of them; a run
     * missing any of them never gets past the `env` import in the first
     * place.
     */
    if (env.MODE === Mode.REVIEW_FOLLOWUP) {
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
      const result = await flowRegistry[Mode.RUNNER]({ task: env.TASK });
      if (!result.succeeded) {
        process.exit(1);
      }
      return;
    }

    if (env.MODE === Mode.ASK) {
      const result = await flowRegistry[Mode.ASK]({ question: env.QUESTION });
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
