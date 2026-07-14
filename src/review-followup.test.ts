// Test plan for src/review-followup.ts — runReviewFollowUp(owner, repo, prNumber, feedback)
// 1. Round limit: when the PR's "review-round-N" label already reads the max (3),
//    skips entirely (no checkout, no runAgent call), writes a warning step summary,
//    and returns { succeeded: false }.
// 2. Happy path: checks out the PR's head branch, builds a follow-up prompt from the
//    original task (parsed from the PR body), the diff against main, and the feedback;
//    runs the agent; pushes the follow-up commit; and bumps the round label
//    (removing review-round-N, adding review-round-N+1).
// 3. No prior round label: treated as round 0, follow-up succeeds and adds
//    "review-round-1" without attempting to remove a nonexistent label.
// 4. Agent failure: runAgent succeeding=false short-circuits before checkout... no,
//    checkout happens before runAgent (the agent needs the branch checked out first);
//    a failed run skips the push/label step and returns { succeeded: false } with a
//    step-summary write.
// 5. DRY_RUN: skips pushFollowUpCommit and the round-label update entirely.
// 6. No changes to push: pushFollowUpCommit returning false skips the round-label
//    update but still resolves succeeded: true.
// 7. Missing/unparsable original task in the PR body: falls back to a placeholder
//    string instead of throwing.

import { checkoutExistingBranch, diffAgainstBase, pushFollowUpCommit } from "~/git";
import { octokit } from "~/lib/github";
import { runReviewFollowUp } from "~/review-followup";
import { runAgent } from "~/run-agent";

vi.mock("~/git", () => ({
  checkoutExistingBranch: vi.fn(),
  diffAgainstBase: vi.fn(),
  pushFollowUpCommit: vi.fn()
}));

vi.mock("~/lib/github", () => ({
  octokit: {
    pulls: { get: vi.fn(), update: vi.fn() },
    issues: { addLabels: vi.fn(), removeLabel: vi.fn() }
  }
}));

vi.mock("~/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/lib/logger", () => ({
  log: vi.fn()
}));

vi.mock("~/lib/summary", () => ({
  writeStepSummary: vi.fn()
}));

const mockedPullsGet = vi.mocked(octokit.pulls.get);
const mockedPullsUpdate = vi.mocked(octokit.pulls.update);
const mockedAddLabels = vi.mocked(octokit.issues.addLabels);
const mockedRemoveLabel = vi.mocked(octokit.issues.removeLabel);
const mockedCheckoutExistingBranch = vi.mocked(checkoutExistingBranch);
const mockedDiffAgainstBase = vi.mocked(diffAgainstBase);
const mockedPushFollowUpCommit = vi.mocked(pushFollowUpCommit);
const mockedRunAgent = vi.mocked(runAgent);

function pr(overrides: Record<string, unknown> = {}) {
  return {
    head: { ref: "test/add-x-tests-abc123" },
    body: "Task:\nAdd unit tests for parseSearchParams\n\nGenerated automatically by Szumrak.\n\nModel summary:\ndone",
    labels: [],
    ...overrides
  };
}

describe("runReviewFollowUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRY_RUN;
    mockedDiffAgainstBase.mockReturnValue("diff --git a/foo.ts b/foo.ts\n+added line\n");
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Addressed the feedback",
      succeeded: true,
      commitMetadata: { type: "fix", subject: "address review feedback", branchSlug: "add-x-tests" }
    });
    mockedPushFollowUpCommit.mockReturnValue(true);
    mockedAddLabels.mockResolvedValue({} as never);
    mockedRemoveLabel.mockResolvedValue({} as never);
    mockedPullsUpdate.mockResolvedValue({} as never);
  });

  test("skips entirely once the PR already hit the round limit", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr({ labels: [{ name: "review-round-3" }] }) } as never);

    const result = await runReviewFollowUp("acme", "widgets", 42, "Please add error handling");

    expect(result).toEqual({ succeeded: false });
    expect(mockedCheckoutExistingBranch).not.toHaveBeenCalled();
    expect(mockedRunAgent).not.toHaveBeenCalled();
  });

  test("checks out the PR branch, runs the agent, pushes, and bumps the round label", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr({ labels: [{ name: "review-round-1" }] }) } as never);

    const result = await runReviewFollowUp("acme", "widgets", 42, "Please add error handling");

    expect(result).toEqual({ succeeded: true });
    expect(mockedCheckoutExistingBranch).toHaveBeenCalledWith("acme", "widgets", "test/add-x-tests-abc123");

    const followUpTask = mockedRunAgent.mock.calls[0]?.[0] as string;
    expect(followUpTask).toContain("test/add-x-tests-abc123");
    expect(followUpTask).toContain("Add unit tests for parseSearchParams");
    expect(followUpTask).toContain("diff --git a/foo.ts b/foo.ts");
    expect(followUpTask).toContain("Please add error handling");

    expect(mockedPushFollowUpCommit).toHaveBeenCalledWith("Add unit tests for parseSearchParams", {
      type: "fix",
      subject: "address review feedback",
      branchSlug: "add-x-tests"
    });
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
    mockedPullsGet.mockResolvedValue({ data: pr({ labels: [] }) } as never);

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(mockedRemoveLabel).not.toHaveBeenCalled();
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-1"]
    });
  });

  test("returns failure without pushing or bumping the label when the agent run fails", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Could not resolve the merge conflict",
      succeeded: false
    });

    const result = await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(result).toEqual({ succeeded: false });
    expect(mockedPushFollowUpCommit).not.toHaveBeenCalled();
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("DRY_RUN skips pushing the commit and updating the round label", async () => {
    process.env.DRY_RUN = "true";
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);

    const result = await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(result).toEqual({ succeeded: true });
    expect(mockedPushFollowUpCommit).not.toHaveBeenCalled();
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("skips the round-label update when there were no changes to push", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);
    mockedPushFollowUpCommit.mockReturnValue(false);

    const result = await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(result).toEqual({ succeeded: true });
    expect(mockedAddLabels).not.toHaveBeenCalled();
  });

  test("falls back to a placeholder when the original task can't be parsed from the PR body", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr({ body: "This PR body has no Task: marker." }) } as never);

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    const followUpTask = mockedRunAgent.mock.calls[0]?.[0] as string;
    expect(followUpTask).toContain("original task unavailable");
  });

  test("resumes the stored SDK session when the PR body has a szumrak-meta comment", async () => {
    mockedPullsGet.mockResolvedValue({
      data: pr({ body: `${pr().body}\n\n<!-- szumrak-meta:{"v":1,"lastSessionId":"session-123","rounds":[]} -->` })
    } as never);

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(mockedRunAgent.mock.calls[0]?.[1]).toEqual({ resume: "session-123" });
  });

  test("omits resume when the PR body has no szumrak-meta comment", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(mockedRunAgent.mock.calls[0]?.[1]).toEqual({ resume: undefined });
  });

  test("omits resume without throwing when the szumrak-meta comment is malformed", async () => {
    mockedPullsGet.mockResolvedValue({
      data: pr({ body: `${pr().body}\n\n<!-- szumrak-meta:not-json -->` })
    } as never);

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(mockedRunAgent.mock.calls[0]?.[1]).toEqual({ resume: undefined });
  });

  test("writes the new session id back to the PR body via pulls.update after a successful round", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Addressed the feedback",
      succeeded: true,
      sessionId: "session-456",
      commitMetadata: { type: "fix", subject: "address review feedback", branchSlug: "add-x-tests" }
    });

    await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(mockedPullsUpdate).toHaveBeenCalledTimes(1);
    const updateBody = mockedPullsUpdate.mock.calls[0]?.[0]?.body as string;
    expect(updateBody).toMatch(/^Task:\n[\s\S]*?\n\nGenerated automatically by Szumrak\./);
    expect(updateBody).toContain('"lastSessionId":"session-456"');
  });

  test("does not fail the round when pulls.update rejects", async () => {
    mockedPullsGet.mockResolvedValue({ data: pr() } as never);
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Addressed the feedback",
      succeeded: true,
      sessionId: "session-456",
      commitMetadata: { type: "fix", subject: "address review feedback", branchSlug: "add-x-tests" }
    });
    mockedPullsUpdate.mockRejectedValue(new Error("API hiccup"));

    const result = await runReviewFollowUp("acme", "widgets", 42, "feedback");

    expect(result).toEqual({ succeeded: true });
  });
});
