// Test plan for src/run-agent.ts — runAgent(task)
// 1. Calls query() with the task as `prompt` and cwd/permissionMode/maxTurns from env.
// 2. Collects `tool_use` content blocks from assistant messages into `toolCalls`
//    ({ name, input }), in stream order.
// 3. `text` content blocks from assistant messages set/overwrite `finalMessage`.
// 4. A `result` message with subtype "success" and is_error: false sets
//    succeeded: true, uses message.result as the final message, and captures
//    total_cost_usd.
// 5. A `result` message with an error subtype (or is_error: true) leaves
//    succeeded: false and does not overwrite finalMessage from message.result.
// 6. Non-assistant, non-result message types (e.g. "system") are ignored for
//    toolCalls/finalMessage/succeeded but don't break iteration.
// 7. Exceeding env.MAX_DURATION_MS mid-stream throws "Agent exceeded max duration".

import { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "~/run-agent";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn()
}));

vi.mock("~/lib/logger", () => ({
  log: vi.fn()
}));

const mockedQuery = vi.mocked(query);

// Builds a minimal async generator that yields the given messages, mimicking
// the shape of the SDK's `Query` (AsyncGenerator<SDKMessage, void>).
async function* streamOf(messages: unknown[]) {
  for (const message of messages) {
    yield message as never;
  }
}

function assistantMessage(content: unknown[]) {
  return { type: "assistant", message: { content } };
}

function resultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    total_cost_usd: 0.05,
    num_turns: 3,
    ...overrides
  };
}

describe("runAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = "/workspace";
    process.env.MAX_TURNS = "30";
    process.env.MAX_DURATION_MS = String(15 * 60 * 1000);
  });

  test("calls query with the task prompt and options derived from env", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("Fix the flaky test");

    expect(mockedQuery).toHaveBeenCalledWith({
      prompt: "Fix the flaky test",
      options: {
        cwd: "/workspace",
        permissionMode: "acceptEdits",
        maxTurns: "30"
      }
    });
  });

  test("collects tool_use blocks into toolCalls in stream order", async () => {
    mockedQuery.mockReturnValue(
      streamOf([
        assistantMessage([
          { type: "tool_use", name: "Read", input: { path: "a.ts" } },
          { type: "tool_use", name: "Edit", input: { path: "b.ts" } }
        ]),
        resultMessage()
      ]) as never
    );

    const result = await runAgent("task");

    expect(result.toolCalls).toEqual([
      { name: "Read", input: { path: "a.ts" } },
      { name: "Edit", input: { path: "b.ts" } }
    ]);
  });

  test("text blocks from assistant messages become finalMessage, later blocks overwrite earlier ones", async () => {
    mockedQuery.mockReturnValue(
      streamOf([
        assistantMessage([{ type: "text", text: "first thought" }]),
        assistantMessage([{ type: "text", text: "second thought" }]),
        // result without a string `result` field should not overwrite finalMessage
        { type: "result", subtype: "error_during_execution", is_error: true, num_turns: 1 }
      ]) as never
    );

    const result = await runAgent("task");

    expect(result.finalMessage).toBe("second thought");
  });

  test("a successful result message sets succeeded true and uses message.result as finalMessage", async () => {
    mockedQuery.mockReturnValue(
      streamOf([
        assistantMessage([{ type: "text", text: "in progress" }]),
        resultMessage({ result: "All done, tests pass.", total_cost_usd: 0.12 })
      ]) as never
    );

    const result = await runAgent("task");

    expect(result.succeeded).toBe(true);
    expect(result.finalMessage).toBe("All done, tests pass.");
    expect(result.totalCostUsd).toBe(0.12);
  });

  test.each([
    ["error subtype", { subtype: "error_max_turns", is_error: true }],
    ["is_error true with success subtype", { subtype: "success", is_error: true, result: "partial" }]
  ])("a result message with %s leaves succeeded false", async (_label, overrides) => {
    mockedQuery.mockReturnValue(streamOf([resultMessage(overrides)]) as never);

    const result = await runAgent("task");

    expect(result.succeeded).toBe(false);
  });

  test("ignores message types other than assistant/result without breaking iteration", async () => {
    mockedQuery.mockReturnValue(
      streamOf([{ type: "system", subtype: "init" }, resultMessage({ result: "finished" })]) as never
    );

    const result = await runAgent("task");

    expect(result.succeeded).toBe(true);
    expect(result.finalMessage).toBe("finished");
  });

  test("throws when the run exceeds MAX_DURATION_MS", async () => {
    process.env.MAX_DURATION_MS = "10";
    const startedAt = Date.now();
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(startedAt) // runAgent's own startedAt capture
      .mockReturnValue(startedAt + 1000); // every subsequent Date.now() call is "later"

    mockedQuery.mockReturnValue(streamOf([assistantMessage([{ type: "text", text: "slow" }])]) as never);

    await expect(runAgent("task")).rejects.toThrow("Agent exceeded max duration");
  });
});
