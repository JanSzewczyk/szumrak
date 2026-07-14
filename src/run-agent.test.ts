// Test plan for src/run-agent.ts — runAgent(task)
// 1. Calls query() with the task as `prompt` and cwd/permissionMode/maxTurns from env,
//    settingSources: [] (never load the target repo's settings.json/hooks), and a
//    systemPrompt preset with commit-metadata instructions appended.
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
// 8. When `<WORKSPACE_PATH>/.claude/agent-permissions.json` exists, its `allow`/`deny`
//    arrays are passed through as `allowedTools`/`disallowedTools`.
// 9. When the file is missing or invalid JSON, allowedTools/disallowedTools stay
//    undefined instead of throwing.
// 10. A trailing ```commit fenced block in the final message is parsed into
//     commitMetadata and stripped from the returned finalMessage.
// 11. A missing, malformed, or invalid-type commit block leaves commitMetadata
//     undefined and finalMessage unchanged.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "~/run-agent";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn()
}));

vi.mock("~/lib/logger", () => ({
  log: vi.fn()
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

const mockedQuery = vi.mocked(query);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

// Builds a minimal async generator that yields the given messages, mimicking
// the shape of the SDK's `Query` (AsyncGenerator<SDKMessage, void>).
async function* streamOf(messages: Array<unknown>) {
  for (const message of messages) {
    yield message as never;
  }
}

function assistantMessage(content: Array<unknown>) {
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
    mockedExistsSync.mockReturnValue(false);
  });

  test("calls query with the task prompt and options derived from env", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("Fix the flaky test");

    expect(mockedQuery).toHaveBeenCalledWith({
      prompt: "Fix the flaky test",
      options: expect.objectContaining({
        cwd: "/workspace",
        permissionMode: "acceptEdits",
        maxTurns: "30",
        // Never load the target repo's settings.json/settings.local.json —
        // see the comment in run-agent.ts on why hooks written for
        // interactive sessions are unsafe to run unattended.
        settingSources: [],
        systemPrompt: expect.objectContaining({ type: "preset", preset: "claude_code" })
      })
    });
  });

  test("sets excludeDynamicSections so the static system-prompt prefix stays cross-run cacheable", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.objectContaining({ excludeDynamicSections: true })
        })
      })
    );
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

  test("passes allow/deny from .claude/agent-permissions.json as allowedTools/disallowedTools", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ allow: ["Read", "Edit"], deny: ["Bash(rm -rf*)"] }));
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedExistsSync).toHaveBeenCalledWith(join("/workspace", ".claude", "agent-permissions.json"));
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          allowedTools: ["Read", "Edit"],
          disallowedTools: ["Bash(rm -rf*)"]
        })
      })
    );
  });

  test("leaves allowedTools/disallowedTools undefined when the permissions file is absent", async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedReadFileSync).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ allowedTools: expect.anything() })
      })
    );
  });

  test("leaves allowedTools/disallowedTools undefined when the permissions file is invalid JSON", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("not json");
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ allowedTools: expect.anything() })
      })
    );
  });

  test("parses a trailing commit block into commitMetadata and strips it from finalMessage", async () => {
    const finalText = [
      "I added a test file covering the edge cases.",
      "",
      "```commit",
      "type: test",
      "scope: search-params",
      "subject: add unit tests for parseSearchParams",
      "branch: add-search-params-tests",
      "```"
    ].join("\n");
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: finalText })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toEqual({
      type: "test",
      scope: "search-params",
      subject: "add unit tests for parseSearchParams",
      branchSlug: "add-search-params-tests"
    });
    expect(result.finalMessage).toBe("I added a test file covering the edge cases.");
  });

  test("tolerates the model collapsing 'type: <type>' and 'subject: ...' into one line", async () => {
    const finalText = [
      "```commit",
      "test: add unit tests for getInitials function in utils/users.test.ts",
      "branch: add-users-getinitials-tests",
      "```"
    ].join("\n");
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: finalText })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toEqual({
      type: "test",
      scope: undefined,
      subject: "add unit tests for getInitials function in utils/users.test.ts".slice(0, 50),
      branchSlug: "add-users-getinitials-tests"
    });
  });

  test("parses a commit block without a scope, omitting scope from commitMetadata", async () => {
    const finalText = [
      "```commit",
      "type: docs",
      "subject: clarify setup instructions",
      "branch: clarify-setup-docs",
      "```"
    ].join("\n");
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: finalText })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toEqual({
      type: "docs",
      scope: undefined,
      subject: "clarify setup instructions",
      branchSlug: "clarify-setup-docs"
    });
  });

  test("leaves commitMetadata undefined when there is no commit block", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: "All done, no fenced block here." })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toBeUndefined();
    expect(result.finalMessage).toBe("All done, no fenced block here.");
  });

  test("leaves commitMetadata undefined when the commit block has an invalid type", async () => {
    const finalText = [
      "```commit",
      "type: not-a-real-type",
      "subject: something",
      "branch: something-slug",
      "```"
    ].join("\n");
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: finalText })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toBeUndefined();
  });
});
