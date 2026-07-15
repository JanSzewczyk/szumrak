import { octokit } from "~/github/client";

// Hard cap on automatic review rounds per PR (Notion page 9) — without it, an
// endless review -> fix -> new objections -> fix loop is possible. Tracked as
// a `review-round-N` label on the PR itself, since the container is ephemeral
// and has nowhere else convenient to persist state between runs.
export const MAX_REVIEW_ROUNDS = 3;
const ROUND_LABEL_PATTERN = /^review-round-(\d+)$/;

export function getRoundCount(labels: Array<{ name?: string }>): number {
  for (const label of labels) {
    const match = label.name?.match(ROUND_LABEL_PATTERN);
    if (match) {
      return Number(match[1]);
    }
  }
  return 0;
}

export async function updateRoundLabel(
  owner: string,
  repo: string,
  prNumber: number,
  previousRound: number
): Promise<void> {
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

// Mirrors the PR body format written by flows/runner/run-runner-flow.ts:
// "Task:\n<TASK>\n\nGenerated automatically by Szumrak.\n\n...". This is the
// only record of the original task once the initial run's process has exited.
const ORIGINAL_TASK_PATTERN = /^Task:\n([\s\S]*?)\n\nGenerated automatically by Szumrak\./;

export function extractOriginalTask(prBody: string): string {
  return prBody.match(ORIGINAL_TASK_PATTERN)?.[1] ?? "(original task unavailable — see PR description)";
}

export function buildFollowUpTask(
  branch: string,
  originalTask: string,
  filesContent: string,
  feedback: string
): string {
  return `You are continuing earlier work on branch ${branch}. Do not start over — modify the existing changes to address the feedback below.

Original task:
${originalTask}

Current full content of the files you changed (do not re-read these unless a file is marked truncated):
${filesContent}

Code review feedback you must address:
${feedback}`;
}
