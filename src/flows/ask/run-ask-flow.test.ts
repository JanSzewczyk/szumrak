/**
 * Test plan for runAskFlow (FR3/FR6/FR8, AC2/AC3):
 *
 * 1. Success path — short answer → { succeeded: true }, writeStepSummary
 *    called with the answer text and "✅" icon. (FR6)
 * 2. Long-answer path — 15+ line answer → writeStepSummary called with a
 *    string wrapped in <details><summary>Answer</summary>...</details>. (FR6)
 * 3. Decline/off-topic path — agent succeeds with an off-topic decline
 *    message → runAskFlow still resolves { succeeded: true }, no special
 *    casing needed. (AC2)
 * 4. Failure path — agent run fails → { succeeded: false }, both log(...)
 *    and writeStepSummary(...) called. (FR6)
 * 5. Never touches PR/commit path — commitAndOpenPR is never called in any
 *    of the above scenarios. (FR8/AC3)
 */

import { runAgent } from "~/agent/run-agent";
import { runAskFlow } from "~/flows/ask/run-ask-flow";
import { commitAndOpenPR } from "~/github/pull-requests";
import { log } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import { agentRunResultBuilder } from "~/test/builders/agent-run-result.builder";

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
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
const mockedCommitAndOpenPR = vi.mocked(commitAndOpenPR);
const mockedLog = vi.mocked(log);
const mockedWriteStepSummary = vi.mocked(writeStepSummary);

describe("runAskFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns success and writes the answer to the step summary with a success icon", async () => {
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({ overrides: { finalMessage: "The project uses Vitest for unit tests." } })
    );

    const result = await runAskFlow({ question: "What test runner does this project use?" });

    expect(result).toEqual({ succeeded: true });
    expect(mockedWriteStepSummary).toHaveBeenCalledWith(
      expect.stringContaining("The project uses Vitest for unit tests."),
      "✅"
    );
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("wraps a long answer in a collapsible <details> block", async () => {
    const longAnswer = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of the explanation.`).join("\n");
    mockedRunAgent.mockResolvedValue(agentRunResultBuilder.one({ overrides: { finalMessage: longAnswer } }));

    const result = await runAskFlow({ question: "Explain the whole architecture in detail." });

    expect(result).toEqual({ succeeded: true });
    expect(mockedWriteStepSummary).toHaveBeenCalledWith(
      expect.stringContaining("<details><summary>Answer</summary>"),
      "✅"
    );
    expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("</details>"), "✅");
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("still succeeds when the agent declines an off-topic question", async () => {
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({
        overrides: { finalMessage: "This question isn't related to this project." }
      })
    );

    const result = await runAskFlow({ question: "What's the best pizza topping?" });

    expect(result).toEqual({ succeeded: true });
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });

  test("returns failure and logs/reports when the agent run fails", async () => {
    mockedRunAgent.mockResolvedValue(
      agentRunResultBuilder.one({ traits: "failed", overrides: { finalMessage: "Could not answer the question" } })
    );

    const result = await runAskFlow({ question: "What does this repo do?" });

    expect(result).toEqual({ succeeded: false });
    expect(mockedLog).toHaveBeenCalled();
    expect(mockedWriteStepSummary).toHaveBeenCalled();
    expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
  });
});
