import { env } from "./env";
import { checkoutExistingBranch, diffAgainstBase, pushFollowUpCommit } from "./git";
import { octokit } from "./lib/github";
import { log } from "./lib/logger";
import { writeStepSummary } from "./lib/summary";
import { runAgent } from "./run-agent";

// Hard cap on automatic review rounds per PR (Notion page 9) — without it, an
// endless review -> fix -> new objections -> fix loop is possible. Tracked as
// a `review-round-N` label on the PR itself, since the container is ephemeral
// and has nowhere else convenient to persist state between runs.
const MAX_REVIEW_ROUNDS = 3;
const ROUND_LABEL_PATTERN = /^review-round-(\d+)$/;

// Mirrors the PR body format written by index.ts: "Task:\n<TASK>\n\nGenerated
// automatically by Szumrak.\n\n...". This is the only record of the original
// task once the initial run's process has exited.
const ORIGINAL_TASK_PATTERN = /^Task:\n([\s\S]*?)\n\nGenerated automatically by Szumrak\./;

function extractOriginalTask(prBody: string): string {
  return prBody.match(ORIGINAL_TASK_PATTERN)?.[1] ?? "(original task unavailable — see PR description)";
}

function getRoundCount(labels: Array<{ name?: string }>): number {
  for (const label of labels) {
    const match = label.name?.match(ROUND_LABEL_PATTERN);
    if (match) {
      return Number(match[1]);
    }
  }
  return 0;
}

function buildFollowUpTask(branch: string, originalTask: string, diff: string, feedback: string): string {
  return `You are continuing earlier work on branch ${branch}. Do not start over — modify the existing changes to address the feedback below.

Original task:
${originalTask}

Current diff against main:
${diff}

Code review feedback you must address:
${feedback}`;
}

async function updateRoundLabel(owner: string, repo: string, prNumber: number, previousRound: number): Promise<void> {
  if (previousRound > 0) {
    await octokit.issues
      .removeLabel({ owner, repo, issue_number: prNumber, name: `review-round-${previousRound}` })
      .catch(() => {
        // the label may already be gone; round tracking is best-effort, not load-bearing
      });
  }
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: [`review-round-${previousRound + 1}`]
  });
}

export interface ReviewFollowUpResult {
  succeeded: boolean;
}

export async function runReviewFollowUp(
  owner: string,
  repo: string,
  prNumber: number,
  feedback: string
): Promise<ReviewFollowUpResult> {
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
  const diff = diffAgainstBase();
  const followUpTask = buildFollowUpTask(branch, originalTask, diff, feedback);

  const result = await runAgent(followUpTask);
  if (!result.succeeded) {
    log("review_followup_failed", { prNumber, finalMessage: result.finalMessage });
    writeStepSummary(
      `Follow-up for PR #${prNumber} did not complete successfully: ${result.finalMessage.slice(0, 300)}`
    );
    return { succeeded: false };
  }

  if (env.DRY_RUN) {
    log("dry_run_active", { note: "Follow-up changes left on disk; no commit or push." });
    return { succeeded: true };
  }

  const pushed = pushFollowUpCommit(originalTask, result.commitMetadata);
  if (!pushed) {
    log("review_followup_no_changes", { prNumber });
    return { succeeded: true };
  }

  await updateRoundLabel(owner, repo, prNumber, round);
  return { succeeded: true };
}
