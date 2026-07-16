import { faker } from "@faker-js/faker";
import type { CommitMetadata } from "~/agent/commit-metadata";
import { runAgent } from "~/agent/run-agent";
import { runReviewFollowUp } from "~/flows/review-followup/run-review-followup-flow";
import { octokit } from "~/github/client";
import { changedFilesWithContent, checkoutExistingBranch, pushFollowUpCommit } from "~/github/git-operations";
import { postPrComment } from "~/github/pull-requests";
import { writeStepSummary } from "~/platform/summary";
import { agentRunResultBuilder } from "~/test/builders/agent-run-result.builder";
import { commitMetadataBuilder } from "~/test/builders/commit-metadata.builder";
import {
  buildReviewFollowUpPrBody,
  reviewFollowUpPullRequestBuilder
} from "~/test/builders/review-followup-pull-request.builder";

vi.mock("~/github/git-operations", () => ({
  checkoutExistingBranch: vi.fn(),
  changedFilesWithContent: vi.fn(),
  pushFollowUpCommit: vi.fn()
}));

vi.mock("~/github/client", () => ({
  octokit: {
    pulls: { get: vi.fn(), update: vi.fn() },
    issues: { addLabels: vi.fn(), removeLabel: vi.fn() }
  }
}));

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/github/pull-requests", () => ({
  postPrComment: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

vi.mock("~/platform/summary", () => ({
  writeStepSummary: vi.fn()
}));

const mockedPullsGet = vi.mocked(octokit.pulls.get);
const mockedPullsUpdate = vi.mocked(octokit.pulls.update);
const mockedAddLabels = vi.mocked(octokit.issues.addLabels);
const mockedRemoveLabel = vi.mocked(octokit.issues.removeLabel);
const mockedCheckoutExistingBranch = vi.mocked(checkoutExistingBranch);
const mockedChangedFilesWithContent = vi.mocked(changedFilesWithContent);
const mockedPushFollowUpCommit = vi.mocked(pushFollowUpCommit);
const mockedRunAgent = vi.mocked(runAgent);
const mockedPostPrComment = vi.mocked(postPrComment);
const mockedWriteStepSummary = vi.mocked(writeStepSummary);

describe("runReviewFollowUp", () => {
  let originalTask: string;
  let defaultCommitMetadata: CommitMetadata;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRY_RUN;
    originalTask = faker.lorem.sentence();
    defaultCommitMetadata = commitMetadataBuilder.one({
      overrides: { type: "fix", subject: "address review feedback", branchSlug: "add-x-tests" }
    });
    mockedChangedFilesWithContent.mockReturnValue("### utils/foo.ts\n```\nexport const foo = 1;\n```");
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        overrides: { finalMessage: "Addressed the feedback", commitMetadata: defaultCommitMetadata }
      })
    );
    mockedPushFollowUpCommit.mockReturnValue(true);
    mockedAddLabels.mockResolvedValue({} as never);
    mockedRemoveLabel.mockResolvedValue({} as never);
    mockedPullsUpdate.mockResolvedValue({} as never);
    mockedPostPrComment.mockResolvedValue(undefined);
  });

  test("skips entirely once the PR already hit the round limit", async () => {
    mockedPullsGet.mockResolvedValue({
      data: reviewFollowUpPullRequestBuilder.one({ overrides: { labels: [{ name: "review-round-3" }] } })
    } as never);

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "Please add error handling"
    });

    expect(result).toEqual({ succeeded: false });
    expect(mockedCheckoutExistingBranch).not.toHaveBeenCalled();
    expect(mockedRunAgent).not.toHaveBeenCalled();
  });

  test("checks out the PR branch, runs the agent, pushes, and bumps the round label", async () => {
    const branch = faker.git.branch();
    mockedPullsGet.mockResolvedValue({
      data: reviewFollowUpPullRequestBuilder.one({
        overrides: {
          head: { ref: branch },
          body: buildReviewFollowUpPrBody(originalTask),
          labels: [{ name: "review-round-1" }]
        }
      })
    } as never);

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "Please add error handling"
    });

    expect(result).toEqual({ succeeded: true });
    expect(mockedCheckoutExistingBranch).toHaveBeenCalledWith("acme", "widgets", branch);

    const followUpTask = mockedRunAgent.mock.calls[0]?.[0] as string;
    expect(followUpTask).toContain(branch);
    expect(followUpTask).toContain(originalTask);
    expect(followUpTask).toContain("### utils/foo.ts");
    expect(followUpTask).toContain("export const foo = 1;");
    expect(followUpTask).toContain("Please add error handling");

    expect(mockedPushFollowUpCommit).toHaveBeenCalledWith(originalTask, defaultCommitMetadata);
    expect(mockedRemoveLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      name: "review-round-1"
    });
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-2"]
    });
  });

  test("treats a PR with no round label as round 0, adding review-round-1 without removing anything", async () => {
    mockedPullsGet.mockResolvedValue({
      data: reviewFollowUpPullRequestBuilder.one({ overrides: { labels: [] } })
    } as never);

    await runReviewFollowUp({ owner: "acme", repo: "widgets", prNumber: 42, reviewFeedback: "feedback" });

    expect(mockedRemoveLabel).not.toHaveBeenCalled();
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-1"]
    });
  });

  test("returns failure without pushing or bumping the label when the agent run fails", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        traits: "failed",
        overrides: { finalMessage: "Could not resolve the merge conflict" }
      })
    );

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: false });
    expect(mockedPushFollowUpCommit).not.toHaveBeenCalled();
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("posts a PR comment naming the stuck tool when the agent run fails due to a detected loop", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        traits: "failed",
        overrides: {
          finalMessage: 'Agent appears stuck repeating the same "Bash" call and was stopped.',
          loopDetected: { toolName: "Bash", input: { command: "npm test" }, occurrences: 3 }
        }
      })
    );

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: false });
    expect(mockedPostPrComment).toHaveBeenCalledWith("acme", "widgets", 42, expect.stringContaining("Bash"));
  });

  test("still writes the step summary and returns failure when postPrComment itself rejects", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        traits: "failed",
        overrides: {
          finalMessage: 'Agent appears stuck repeating the same "Bash" call and was stopped.',
          loopDetected: { toolName: "Bash", input: { command: "npm test" }, occurrences: 3 }
        }
      })
    );
    mockedPostPrComment.mockRejectedValue(new Error("GitHub API error"));

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: false });
    expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("did not complete successfully"));
  });

  test("does not post a PR comment on a plain failure without a detected loop", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(agentRunResultBuilder.one({ traits: "failed" }));

    await runReviewFollowUp({ owner: "acme", repo: "widgets", prNumber: 42, reviewFeedback: "feedback" });

    expect(mockedPostPrComment).not.toHaveBeenCalled();
  });

  test("DRY_RUN skips pushing the commit and updating the round label", async () => {
    process.env.DRY_RUN = "true";
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: true });
    expect(mockedPushFollowUpCommit).not.toHaveBeenCalled();
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("skips the round-label update when there were no changes to push", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedPushFollowUpCommit.mockReturnValue(false);

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: true });
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder when the original task can't be parsed from the PR body", async () => {
    mockedPullsGet.mockResolvedValue({
      data: reviewFollowUpPullRequestBuilder.one({ overrides: { body: "This PR body has no Task: marker." } })
    } as never);

    await runReviewFollowUp({ owner: "acme", repo: "widgets", prNumber: 42, reviewFeedback: "feedback" });

    const followUpTask = mockedRunAgent.mock.calls[0]?.[0] as string;
    expect(followUpTask).toContain("original task unavailable");
  });

  test("writes the cost/round table back to the PR body via pulls.update after a successful round", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        overrides: {
          finalMessage: "Addressed the feedback",
          totalCostUsd: 0.12,
          numTurns: 4,
          commitMetadata: defaultCommitMetadata
        }
      })
    );

    await runReviewFollowUp({ owner: "acme", repo: "widgets", prNumber: 42, reviewFeedback: "feedback" });

    expect(mockedPullsUpdate).toHaveBeenCalledTimes(1);
    const updateBody = mockedPullsUpdate.mock.calls[0]?.[0]?.body as string;
    expect(updateBody).toMatch(/^Task:\n[\s\S]*?\n\nGenerated automatically by Szumrak\./);
    expect(updateBody).toContain("**Szumrak run info**");
    expect(updateBody).toContain('"totalCostUsd":0.12');
  });

  test("does not fail the round when pulls.update rejects", async () => {
    mockedPullsGet.mockResolvedValue({ data: reviewFollowUpPullRequestBuilder.one() } as never);
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        overrides: {
          finalMessage: "Addressed the feedback",
          totalCostUsd: 0.12,
          numTurns: 4,
          commitMetadata: defaultCommitMetadata
        }
      })
    );
    mockedPullsUpdate.mockRejectedValue(new Error("API hiccup"));

    const result = await runReviewFollowUp({
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      reviewFeedback: "feedback"
    });

    expect(result).toEqual({ succeeded: true });
  });
});
