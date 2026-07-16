import type { AgentRunResult } from "~/agent/run-agent";
import { runAgent } from "~/agent/run-agent";
import { octokit } from "~/github/client";
import { changedFilesWithContent, checkoutExistingBranch, pushFollowUpCommit } from "~/github/git-operations";
import { postPrComment } from "~/github/pull-requests";
import { appendRunInfo, parseSzumrakMeta, type SzumrakMeta } from "~/github/run-info";
import { env } from "~/platform/env";
import { log } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import type { FlowResult } from "../types";
import {
  buildFollowUpTask,
  extractOriginalTask,
  getRoundCount,
  MAX_REVIEW_ROUNDS,
  updateRoundLabel
} from "./review-rounds";

export interface ReviewFollowUpFlowInput {
  owner: string;
  repo: string;
  prNumber: number;
  reviewFeedback: string;
}

/**
 * Best-effort — losing this metadata only means the cost/round table in the
 * PR body won't show this round, not that the round itself fails. Mirrors the
 * label removal's own `.catch(() => {})` in review-rounds.ts.
 */
async function updateSzumrakMeta(
  owner: string,
  repo: string,
  prNumber: number,
  prBody: string,
  previousMeta: SzumrakMeta | undefined,
  round: number,
  result: AgentRunResult
): Promise<void> {
  const body = appendRunInfo(prBody, previousMeta, round, {
    totalCostUsd: result.totalCostUsd,
    numTurns: result.numTurns
  });
  await octokit.pulls.update({ owner, repo, pull_number: prNumber, body }).catch((err) => {
    log("szumrak_meta_update_failed", { prNumber, error: String(err) });
  });
}

/**
 * The review-followup flow: given feedback on an existing PR, continue the
 * agent's work on that PR's branch instead of starting over. This is the flow
 * behind `MODE=review-followup` (`env.MODE === Mode.REVIEW_FOLLOWUP`).
 *
 * Takes a single input object (not four positional args) so
 * flows/registry.ts can assign it directly into the registry without
 * wrapping/casting anything.
 */
export async function runReviewFollowUp({
  owner,
  repo,
  prNumber,
  reviewFeedback: feedback
}: ReviewFollowUpFlowInput): Promise<FlowResult> {
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  const round = getRoundCount(pr.labels);

  if (round >= MAX_REVIEW_ROUNDS) {
    log("review_round_limit_exceeded", { prNumber, round });
    writeStepSummary(`PR #${prNumber} hit the ${MAX_REVIEW_ROUNDS}-round automatic review limit — needs a human.`, "⚠️");
    return { succeeded: false };
  }

  const branch = pr.head.ref;
  await checkoutExistingBranch(owner, repo, branch);

  const originalTask = extractOriginalTask(pr.body ?? "");
  const filesContent = changedFilesWithContent();
  const followUpTask = buildFollowUpTask(branch, originalTask, filesContent, feedback);

  /**
   * Each round rebuilds context from the flattened original task + current
   * changed-file content + feedback. (SDK session resume was tried and
   * dropped: every review-followup round runs in a fresh `docker run --rm`
   * container, so there's no local session state to resume — it always
   * failed and fell back to this anyway.) parseSzumrakMeta is still read,
   * but only to carry the cost/round table forward across rounds.
   */
  const previousMeta = parseSzumrakMeta(pr.body ?? "");
  const result = await runAgent(followUpTask);
  if (!result.succeeded) {
    log("review_followup_failed", { prNumber, finalMessage: result.finalMessage });
    writeStepSummary(
      `Follow-up for PR #${prNumber} did not complete successfully: ${result.finalMessage.slice(0, 300)}`
    );
    if (result.loopDetected) {
      await postPrComment(
        owner,
        repo,
        prNumber,
        `Szumrak stopped this follow-up round after repeating the same "${result.loopDetected.toolName}" call ${result.loopDetected.occurrences} times in a row and appears stuck.`
      ).catch((err) => {
        log("post_pr_comment_failed", { prNumber, error: String(err) });
      });
    }
    return { succeeded: false };
  }

  if (env.DRY_RUN) {
    log("dry_run_active", { note: "Follow-up changes left on disk; no commit or push." });
    return { succeeded: true };
  }

  await updateSzumrakMeta(owner, repo, prNumber, pr.body ?? "", previousMeta, round + 1, result);

  const pushed = pushFollowUpCommit(originalTask, result.commitMetadata);
  if (!pushed) {
    log("review_followup_no_changes", { prNumber });
    return { succeeded: true };
  }

  await updateRoundLabel(owner, repo, prNumber, round);
  return { succeeded: true };
}
