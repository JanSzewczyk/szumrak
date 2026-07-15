import { loadAgentConfig } from "~/agent/agent-config";
import type { CommitMetadata } from "~/agent/commit-metadata";
import { runAgent } from "~/agent/run-agent";
import { runVerifyCommands } from "~/agent/verify";
import { runRunnerFlow } from "~/flows/runner/run-runner-flow";
import { findOpenPRForTask } from "~/github/dedup";
import { commitAndOpenPR } from "~/github/pull-requests";
import { agentRunResultBuilder } from "~/test/builders/agent-run-result.builder";
import { commitMetadataBuilder } from "~/test/builders/commit-metadata.builder";

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/agent/agent-config", () => ({
  loadAgentConfig: vi.fn()
}));

vi.mock("~/agent/verify", () => ({
  runVerifyCommands: vi.fn()
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
const mockedLoadAgentConfig = vi.mocked(loadAgentConfig);
const mockedRunVerifyCommands = vi.mocked(runVerifyCommands);

describe("runRunnerFlow", () => {
  let defaultCommitMetadata: CommitMetadata;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DRY_RUN;
    process.env.REPO = "acme/widgets";
    mockedFindOpenPRForTask.mockResolvedValue(null);
    defaultCommitMetadata = commitMetadataBuilder.one({
      overrides: { type: "feat", subject: "add the feature", branchSlug: "add-the-feature" }
    });
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        overrides: { finalMessage: "Added the feature", commitMetadata: defaultCommitMetadata }
      })
    );
    mockedCommitAndOpenPR.mockResolvedValue("https://github.com/acme/widgets/pull/1");
    mockedLoadAgentConfig.mockReturnValue({});
  });

  test("skips the agent and reports success when an open PR already exists for the task", async () => {
    mockedFindOpenPRForTask.mockResolvedValue("https://github.com/acme/widgets/pull/9");

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: true });
    expect(mockedRunAgent).not.toHaveBeenCalled();
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("skips the dedup check entirely under DRY_RUN", async () => {
    process.env.DRY_RUN = "true";

    await runRunnerFlow({ task: "Add a feature" });

    expect(mockedFindOpenPRForTask).not.toHaveBeenCalled();
  });

  test("returns failure without opening a PR when the agent run fails", async () => {
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({ traits: "failed", overrides: { finalMessage: "Could not complete the task" } })
    );

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: false });
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("DRY_RUN: runs the agent but never opens a PR", async () => {
    process.env.DRY_RUN = "true";

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: true });
    expect(mockedRunAgent).toHaveBeenCalledWith("Add a feature");
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("opens a PR with a body built from the task and agent summary, truncating the title to 72 chars", async () => {
    const longTask = "A".repeat(100);

    const result = await runRunnerFlow({ task: longTask });

    expect(result).toEqual({ succeeded: true });
    expect(mockedCommitAndOpenPR).toHaveBeenCalledWith(
      "A".repeat(72),
      expect.stringContaining(`Task:\n${longTask}`),
      defaultCommitMetadata
    );
  });

  test("fails without opening a PR when the final verify gate fails", async () => {
    mockedLoadAgentConfig.mockReturnValue({ verify: ["npm run typecheck"] });
    mockedRunVerifyCommands.mockReturnValue({ passed: false, report: "$ npm run typecheck\nerror TS2322" });

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: false });
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
    expect(mockedRunVerifyCommands).toHaveBeenCalledWith(["npm run typecheck"], expect.any(String));
  });

  test("opens a PR when the final verify gate passes", async () => {
    mockedLoadAgentConfig.mockReturnValue({ verify: ["npm run typecheck"] });
    mockedRunVerifyCommands.mockReturnValue({ passed: true, report: "" });

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: true });
    expect(mockedCommitAndOpenPR).toHaveBeenCalled();
  });

  test("skips the verify gate entirely when the target repo configures no verify commands", async () => {
    await runRunnerFlow({ task: "Add a feature" });

    expect(mockedRunVerifyCommands).not.toHaveBeenCalled();
  });

  test("the verify gate also fails a DRY_RUN so broken changes aren't reported as clean", async () => {
    process.env.DRY_RUN = "true";
    mockedLoadAgentConfig.mockReturnValue({ verify: ["npm run lint"] });
    mockedRunVerifyCommands.mockReturnValue({ passed: false, report: "lint error" });

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: false });
  });

  test("reports success even when there were no changes to commit", async () => {
    mockedCommitAndOpenPR.mockResolvedValue(null);

    const result = await runRunnerFlow({ task: "Add a feature" });

    expect(result).toEqual({ succeeded: true });
  });
});
