// Test plan for src/github/git-operations.ts
// checkoutExistingBranch(owner, repo, branch):
// 1. Authenticates the remote with an embedded token, then fetches, checks out, and
//    pulls the given branch, in that order.
//
// changedFilesWithContent(baseBranch?):
// 2. Lists the name-only diff against the default base branch (origin/main).
// 3. Returns each changed file's current content under a "### <path>" header.
// 4. Annotates a file over the per-file cap as truncated instead of inlining it.
// 5. Marks a deleted file (no HEAD blob) instead of throwing.
// 6. Returns a placeholder when nothing changed against the base branch.
// 7. Accepts a custom base branch.
//
// pushFollowUpCommit(taskSummary, commitMetadata?):
// 8. Returns false and does not add/commit/push when there are no changes.
// 9. Commits and pushes to HEAD (not a new branch) when there are changes.
// 10. Falls back to the chore(agent) commit message without commitMetadata.
//
// execFileSync is invoked with an argument array (never a single interpolated string)
// for every git subcommand — the command-injection guard git() exists to enforce.

import { execFileSync } from "node:child_process";
import { changedFilesWithContent, checkoutExistingBranch, pushFollowUpCommit } from "~/github/git-operations";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/github/client", () => ({
  getInstallationToken: vi.fn().mockResolvedValue("test-installation-token")
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("checkoutExistingBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = "/workspace";
  });

  test("authenticates the remote, then fetches, checks out and pulls the given branch", async () => {
    await checkoutExistingBranch("acme", "widgets", "test/add-x-tests-abc123");

    const commands = mockedExecFileSync.mock.calls.map(([, args]) => (args as Array<string>)[0]);
    expect(commands).toEqual(["remote", "fetch", "checkout", "pull"]);
    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["remote", "set-url", "origin", "https://x-access-token:test-installation-token@github.com/acme/widgets.git"],
      { cwd: "/workspace" }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["fetch", "origin", "test/add-x-tests-abc123"],
      expect.anything()
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["checkout", "test/add-x-tests-abc123"], expect.anything());
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["pull", "origin", "test/add-x-tests-abc123"],
      expect.anything()
    );
  });
});

describe("changedFilesWithContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = "/workspace";
  });

  // Helper: name-only list from the first `git diff --name-only` call, then
  // `git show HEAD:<path>` for each named file, keyed by path.
  function mockGit(names: Array<string>, contentByPath: Record<string, string | Error>) {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "diff" && argv[1] === "--name-only") {
        return names.join("\n");
      }
      if (argv[0] === "show") {
        const path = argv[1].replace(/^HEAD:/, "");
        const value = contentByPath[path];
        if (value instanceof Error) throw value;
        return value ?? "";
      }
      return "";
    });
  }

  test("lists the name-only diff against the default base branch (origin/main)", () => {
    mockGit(["a.ts"], { "a.ts": "export const a = 1;\n" });

    changedFilesWithContent();

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "origin/main...HEAD"],
      expect.anything()
    );
  });

  test("returns each changed file's current content under a path header", () => {
    mockGit(["a.ts", "b.ts"], { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n" });

    const result = changedFilesWithContent();

    expect(result).toContain("### a.ts");
    expect(result).toContain("export const a = 1;");
    expect(result).toContain("### b.ts");
    expect(result).toContain("export const b = 2;");
  });

  test("annotates a file over the per-file cap as truncated instead of inlining it", () => {
    mockGit(["big.ts"], { "big.ts": "x".repeat(25000) });

    const result = changedFilesWithContent();

    expect(result).toContain("### big.ts");
    expect(result).toContain("[truncated — Read the file for full content]");
    expect(result).not.toContain("x".repeat(25000));
  });

  test("marks a deleted file (no HEAD blob) instead of throwing", () => {
    mockGit(["gone.ts"], { "gone.ts": new Error("fatal: path 'gone.ts' does not exist in 'HEAD'") });

    const result = changedFilesWithContent();

    expect(result).toContain("### gone.ts");
    expect(result).toContain("(deleted)");
  });

  test("returns a placeholder when nothing changed against the base branch", () => {
    mockGit([], {});

    expect(changedFilesWithContent()).toBe("(no files changed against the base branch yet)");
  });

  test("accepts a custom base branch", () => {
    mockGit(["a.ts"], { "a.ts": "x" });

    changedFilesWithContent("develop");

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "develop...HEAD"],
      expect.anything()
    );
  });
});

describe("pushFollowUpCommit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = "/workspace";
  });

  test("returns false and does not add/commit/push when there are no changes", () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return "";
      return "";
    });

    const pushed = pushFollowUpCommit("Original task");

    expect(pushed).toBe(false);
    const commands = mockedExecFileSync.mock.calls.map(([, args]) => (args as Array<string>)[0]);
    expect(commands).toEqual(["status"]);
  });

  test("commits and pushes to HEAD (not a new branch) when there are changes", () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M src/foo.ts\n";
      return "";
    });

    const pushed = pushFollowUpCommit("Original task", {
      type: "fix",
      subject: "address review feedback",
      branchSlug: "add-x-tests"
    });

    expect(pushed).toBe(true);
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["add", "-A"], expect.anything());
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "fix: address review feedback"],
      expect.anything()
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["push", "origin", "HEAD"], expect.anything());
  });

  test("falls back to the chore(agent) commit message without commitMetadata", () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M src/foo.ts\n";
      return "";
    });

    pushFollowUpCommit("Original task");

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "chore(agent): Original task"],
      expect.anything()
    );
  });
});
