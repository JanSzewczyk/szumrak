import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { runAgent } from "~/agent/run-agent";
import { log } from "~/platform/logger";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

const mockedQuery = vi.mocked(query);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedLog = vi.mocked(log);

const CONFIG_PATH = join("/workspace", ".claude", "agent-config.json");

/** Puts a single agent-config/permissions file "on disk" for the fs mocks. */
function configOnDisk(path: string, content: unknown) {
  mockedExistsSync.mockImplementation((candidate) => candidate === path);
  mockedReadFileSync.mockImplementation((candidate) => {
    if (candidate === path) {
      return typeof content === "string" ? content : JSON.stringify(content);
    }
    throw new Error(`unexpected read: ${String(candidate)}`);
  });
}

/**
 * Builds a minimal async generator that yields the given messages, mimicking
 * the shape of the SDK's `Query` (AsyncGenerator<SDKMessage, void>).
 */
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
        /**
         * 'project' only — the target repo's committed .claude/ tier, which
         * is what makes the SDK discover its `.claude/skills/` (and load its
         * CLAUDE.md + settings.json hooks). See the comment in run-agent.ts.
         */
        settingSources: ["project"],
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
        /** A result without a string `result` field should not overwrite finalMessage. */
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

  test("passes permissions.allow/deny from .claude/agent-config.json as allowedTools/disallowedTools", async () => {
    configOnDisk(CONFIG_PATH, { permissions: { allow: ["Read", "Edit"], deny: ["Bash(rm -rf*)"] } });
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

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

  test("leaves allowedTools/disallowedTools undefined when the config file is invalid JSON", async () => {
    configOnDisk(CONFIG_PATH, "not json");
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ allowedTools: expect.anything() })
      })
    );
  });

  test("passes the skills whitelist from agent-config.json through to the SDK", async () => {
    configOnDisk(CONFIG_PATH, { skills: "all" });
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ skills: "all" })
      })
    );
  });

  test("omits the skills option entirely when the target repo doesn't opt in", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ skills: expect.anything() })
      })
    );
  });

  test("never registers hooks of its own — quality control is entirely the target repo's settings.json", async () => {
    configOnDisk(CONFIG_PATH, { verify: ["npm run lint"] });
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ hooks: expect.anything() })
      })
    );
  });

  test("sets includeHookEvents so the target repo's own hooks surface in the message stream", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage()]) as never);

    await runAgent("task");

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ includeHookEvents: true })
      })
    );
  });

  test("logs the target repo's hook lifecycle messages with their name, event, and output", async () => {
    const hookResponse = {
      type: "system",
      subtype: "hook_response",
      hook_id: "hook-1",
      hook_name: "format-prettier",
      hook_event: "PostToolUse",
      stdout: "formatted 1 file",
      stderr: "",
      exit_code: 0,
      outcome: "success"
    };
    mockedQuery.mockReturnValue(streamOf([hookResponse, resultMessage()]) as never);

    await runAgent("task");

    expect(mockedLog).toHaveBeenCalledWith(
      "hook_event",
      expect.objectContaining({
        subtype: "hook_response",
        hookName: "format-prettier",
        hookEvent: "PostToolUse",
        stdout: "formatted 1 file",
        outcome: "success"
      })
    );
  });

  test("wires a trailing commit block into result.commitMetadata and strips it from finalMessage", async () => {
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

  test("leaves commitMetadata undefined when there is no commit block", async () => {
    mockedQuery.mockReturnValue(streamOf([resultMessage({ result: "All done, no fenced block here." })]) as never);

    const result = await runAgent("task");

    expect(result.commitMetadata).toBeUndefined();
    expect(result.finalMessage).toBe("All done, no fenced block here.");
  });
});
