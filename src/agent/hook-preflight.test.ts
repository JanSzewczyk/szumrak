import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkHookHealth } from "~/agent/hook-preflight";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExecFileSync = vi.mocked(execFileSync);

const WORKSPACE = "/workspace";
const SETTINGS_PATH = join(WORKSPACE, ".claude", "settings.json");

function fileOnDisk(path: string, content: unknown) {
  mockedExistsSync.mockImplementation((candidate) => candidate === path);
  mockedReadFileSync.mockImplementation((candidate) => {
    if (candidate === path) {
      return typeof content === "string" ? content : JSON.stringify(content);
    }
    throw new Error(`unexpected read: ${String(candidate)}`);
  });
}

function settingsWithHooks(commands: Record<string, Array<string>>) {
  const hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> = {};
  for (const [event, eventCommands] of Object.entries(commands)) {
    hooks[event] = [{ hooks: eventCommands.map((command) => ({ type: "command", command })) }];
  }
  return { hooks };
}

describe("checkHookHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  test("returns total 0 and no failures when settings.json does not exist", () => {
    expect(checkHookHealth(WORKSPACE)).toEqual({ total: 0, failed: [] });
    expect(mockedReadFileSync).not.toHaveBeenCalled();
    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("returns no failures when every hook command is syntactically valid", () => {
    fileOnDisk(
      SETTINGS_PATH,
      settingsWithHooks({
        PostToolUse: ["bash .claude/hooks/lint.sh", "bash .claude/hooks/format.sh"]
      })
    );
    mockedExecFileSync.mockReturnValue(Buffer.from(""));

    expect(checkHookHealth(WORKSPACE)).toEqual({ total: 2, failed: [] });
  });

  test("reports the one broken hook among several valid ones", () => {
    fileOnDisk(
      SETTINGS_PATH,
      settingsWithHooks({
        PostToolUse: ["bash .claude/hooks/lint.sh", "bash .claude/hooks/broken.sh"],
        PreToolUse: ["bash .claude/hooks/guard.sh"]
      })
    );
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[argv.length - 1]?.includes("broken.sh")) {
        throw new Error("syntax error near unexpected token `[['");
      }
      return Buffer.from("");
    });

    expect(checkHookHealth(WORKSPACE)).toEqual({
      total: 3,
      failed: [{ event: "PostToolUse", command: "bash .claude/hooks/broken.sh" }]
    });
  });

  test("reports every hook as failed when all are broken", () => {
    fileOnDisk(
      SETTINGS_PATH,
      settingsWithHooks({
        PostToolUse: ["bash .claude/hooks/broken-1.sh", "bash .claude/hooks/broken-2.sh"]
      })
    );
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("syntax error");
    });

    expect(checkHookHealth(WORKSPACE)).toEqual({
      total: 2,
      failed: [
        { event: "PostToolUse", command: "bash .claude/hooks/broken-1.sh" },
        { event: "PostToolUse", command: "bash .claude/hooks/broken-2.sh" }
      ]
    });
  });
});
