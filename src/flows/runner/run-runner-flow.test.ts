// Test plan for src/flows/runner/run-runner-flow.ts — runRunnerFlow(task)
// 1. Dedup: when an open PR already exists for the task (and not DRY_RUN), skips the
//    agent entirely, writes an info step summary, and resolves { succeeded: true }.
// 2. Dedup is skipped entirely under DRY_RUN (findOpenPRForTask is never called).
// 3. Agent failure: runAgent succeeding=false skips commitAndOpenPR, writes a failure
//    step summary, and resolves { succeeded: false }.
// 4. DRY_RUN happy path: runs the agent but never calls commitAndOpenPR, resolves
//    { succeeded: true }.
// 5. Non-DRY_RUN happy path: builds the PR body via appendRunInfo (task + agent summary)
//    and opens a PR via commitAndOpenPR with the task truncated to 72 chars and the
//    agent's commitMetadata; resolves { succeeded: true } whether or not a PR was
//    actually opened (no changes to commit is not a failure).

import { runAgent } from "~/agent/run-agent";
import { runRunnerFlow } from "~/flows/runner/run-runner-flow";
import { findOpenPRForTask } from "~/github/dedup";
import { commitAndOpenPR } from "~/github/pull-requests";

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/github/dedup", () => ({
  findOpenPRForTask: vi.fn()
}));

vi.mock("~/github/pull-requests", () => ({
  commitAndOpenPR: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

vi.mock("~/platform/summary", () => ({
  writeStepSummary: vi.fn()
}));

const mockedRunAgent = vi.mocked(runAgent);
const mockedFindOpenPRForTask = vi.mocked(findOpenPRForTask);
const mockedCommitAndOpenPR = vi.mocked(commitAndOpenPR);

describe("runRunnerFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRY_RUN;
    process.env.REPO = "acme/widgets";
    mockedFindOpenPRForTask.mockResolvedValue(null);
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Added the feature",
      succeeded: true,
      totalCostUsd: 0.1,
      numTurns: 4,
      commitMetadata: { type: "feat", subject: "add the feature", branchSlug: "add-the-feature" }
    });
    mockedCommitAndOpenPR.mockResolvedValue("https://github.com/acme/widgets/pull/1");
  });

  test("skips the agent and reports success when an open PR already exists for the task", async () => {
    mockedFindOpenPRForTask.mockResolvedValue("https://github.com/acme/widgets/pull/9");

    const result = await runRunnerFlow("Add a feature");

    expect(result).toEqual({ succeeded: true });
    expect(mockedRunAgent).not.toHaveBeenCalled();
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("skips the dedup check entirely under DRY_RUN", async () => {
    process.env.DRY_RUN = "true";

    await runRunnerFlow("Add a feature");

    expect(mockedFindOpenPRForTask).not.toHaveBeenCalled();
  });

  test("returns failure without opening a PR when the agent run fails", async () => {
    mockedRunAgent.mockResolvedValue({
      toolCalls: [],
      finalMessage: "Could not complete the task",
      succeeded: false
    });

    const result = await runRunnerFlow("Add a feature");

    expect(result).toEqual({ succeeded: false });
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("DRY_RUN: runs the agent but never opens a PR", async () => {
    process.env.DRY_RUN = "true";

    const result = await runRunnerFlow("Add a feature");

    expect(result).toEqual({ succeeded: true });
    expect(mockedRunAgent).toHaveBeenCalledWith("Add a feature");
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("opens a PR with a body built from the task and agent summary, truncating the title to 72 chars", async () => {
    const longTask = "A".repeat(100);

    const result = await runRunnerFlow(longTask);

    expect(result).toEqual({ succeeded: true });
    expect(mockedCommitAndOpenPR).toHaveBeenCalledWith("A".repeat(72), expect.stringContaining(`Task:\n${longTask}`), {
      type: "feat",
      subject: "add the feature",
      branchSlug: "add-the-feature"
    });
  });

  test("reports success even when there were no changes to commit", async () => {
    mockedCommitAndOpenPR.mockResolvedValue(null);

    const result = await runRunnerFlow("Add a feature");

    expect(result).toEqual({ succeeded: true });
  });
});
