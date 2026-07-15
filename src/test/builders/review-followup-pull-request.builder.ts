import { faker } from "@faker-js/faker";
import { build } from "mimicry-js";

export interface ReviewFollowUpPullRequest {
  head: { ref: string };
  body: string;
  labels: Array<{ name?: string }>;
}

// Mirrors the PR body format flows/runner/run-runner-flow.ts writes and
// flows/review-followup/review-rounds.ts's extractOriginalTask() parses back
// out: "Task:\n<task>\n\nGenerated automatically by Szumrak.\n\n...".
export function buildReviewFollowUpPrBody(task: string): string {
  return `Task:\n${task}\n\nGenerated automatically by Szumrak.\n\nModel summary:\ndone`;
}

/**
 * Builds the minimal shape `flows/review-followup/run-review-followup-flow.ts`
 * reads off an `octokit.pulls.get` response (`head.ref`, `body`, `labels`) —
 * not a full Octokit PR type, just what this flow actually touches.
 *
 * @example
 * reviewFollowUpPullRequestBuilder.one();
 * reviewFollowUpPullRequestBuilder.one({ overrides: { labels: [{ name: "review-round-1" }] } });
 * reviewFollowUpPullRequestBuilder.one({ overrides: { body: buildReviewFollowUpPrBody("Add tests") } });
 */
export const reviewFollowUpPullRequestBuilder = build<ReviewFollowUpPullRequest>({
  fields: {
    head: () => ({ ref: faker.git.branch() }),
    body: () => buildReviewFollowUpPrBody(faker.lorem.sentence()),
    labels: []
  }
});
