import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAgentConfig } from "~/agent/agent-config";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const WORKSPACE = "/workspace";
const CONFIG_PATH = join(WORKSPACE, ".claude", "agent-config.json");

function fileOnDisk(path: string, content: unknown) {
  mockedExistsSync.mockImplementation((candidate) => candidate === path);
  mockedReadFileSync.mockImplementation((candidate) => {
    if (candidate === path) {
      return typeof content === "string" ? content : JSON.stringify(content);
    }
    throw new Error(`unexpected read: ${String(candidate)}`);
  });
}

describe("loadAgentConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  test("returns an empty config when neither file exists", () => {
    expect(loadAgentConfig(WORKSPACE)).toEqual({});
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  test("loads permissions, skills list, and verify commands from agent-config.json", () => {
    fileOnDisk(CONFIG_PATH, {
      permissions: { allow: ["Read", "Edit"], deny: ["Bash(rm -rf*)"] },
      skills: ["pdf", "storybook-testing"],
      verify: ["npm run typecheck", "npm run lint"]
    });

    expect(loadAgentConfig(WORKSPACE)).toEqual({
      permissions: { allow: ["Read", "Edit"], deny: ["Bash(rm -rf*)"] },
      skills: ["pdf", "storybook-testing"],
      verify: ["npm run typecheck", "npm run lint"]
    });
  });

  test('accepts skills: "all"', () => {
    fileOnDisk(CONFIG_PATH, { skills: "all" });

    expect(loadAgentConfig(WORKSPACE).skills).toBe("all");
  });

  test.each([
    ["a number", 42],
    ["a non-string array", ["ok", 1]],
    ["an arbitrary string", "some"]
  ])("drops skills when it is %s", (_label, skills) => {
    fileOnDisk(CONFIG_PATH, { skills });

    expect(loadAgentConfig(WORKSPACE).skills).toBeUndefined();
  });

  test("drops malformed permissions/verify instead of passing them through", () => {
    fileOnDisk(CONFIG_PATH, { permissions: { allow: "Read" }, verify: "npm run lint" });

    expect(loadAgentConfig(WORKSPACE)).toEqual({});
  });

  test("returns an empty config for invalid JSON in agent-config.json", () => {
    fileOnDisk(CONFIG_PATH, "not json");

    expect(loadAgentConfig(WORKSPACE)).toEqual({});
  });
});
