// Test plan for src/git.ts — commitAndOpenPR(taskSummary, body, commitMetadata?)
// 1. "no changes" path: `git status --porcelain` returns empty output → returns null,
//    no add/commit/push/PR calls happen (remote auth + branch checkout still run).
// 2. "has changes" happy path: full flow (remote auth, checkout, status, add, commit,
//    push, PR create, add label) runs in order and resolves to pr.data.html_url.
// 3. execFileSync is invoked with an argument array (never a single interpolated
//    string) for every git subcommand — this is the command-injection guard the repo
//    explicitly calls out; assert the exact argv shapes.
// 4. Without commitMetadata: falls back to "chore(agent): <taskSummary, truncated to
//    72 chars>" for both the commit message and PR title (title == commit message,
//    since GitHub squash-merge uses the PR title as the final commit that
//    semantic-release parses).
// 5. With commitMetadata: branch is <type>/<slug>-<suffix>, commit message and
//    PR title are "<type>(<scope>): <subject>" (scope omitted when absent).
// 6. The remote is reauthenticated via an embedded token (`configureGitRemoteAuth`)
//    before anything else, and that call is never routed through the logging git()
//    wrapper (the token must never reach agent-run.jsonl).
// 7. env.REPO validation: throws a clear error when REPO is missing or not in
//    "owner/repo" format, before any git or Octokit call happens.
// 8. octokit.pulls.create is called with the correct owner/repo/head/base/title/body,
//    and octokit.issues.addLabels is called with the "ai-generated" label for the
//    created PR's issue_number.

import { execFileSync } from "node:child_process";
import { changedFilesWithContent, checkoutExistingBranch, commitAndOpenPR, parseRepo, pushFollowUpCommit } from "~/git";
import { octokit } from "~/lib/github";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/lib/github", () => ({
  octokit: {
    pulls: { create: vi.fn() },
    issues: { addLabels: vi.fn() }
  },
  getInstallationToken: vi.fn().mockResolvedValue("test-installation-token")
}));

vi.mock("~/lib/logger", () => ({
  log: vi.fn()
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedPullsCreate = vi.mocked(octokit.pulls.create);
const mockedAddLabels = vi.mocked(octokit.issues.addLabels);

describe("commitAndOpenPR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = "/workspace";
    process.env.REPO = "acme/widgets";
  });

  test("returns null and does not commit/push/open a PR when there are no changes", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return "";
      return "";
    });

    const result = await commitAndOpenPR("Fix the bug", "body text");

    expect(result).toBeNull();
    expect(mockedPullsCreate).not.toHaveBeenCalled();
    expect(mockedAddLabels).not.toHaveBeenCalled();

    const commands = mockedExecFileSync.mock.calls.map(([, args]) => (args as Array<string>)[0]);
    expect(commands).toEqual(["remote", "checkout", "status"]);
  });

  test("authenticates the remote with an embedded token before checking out a branch", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "checkout") {
        expect(argv[1]).toBe("-b");
        expect(argv[2]).toMatch(/^[a-z0-9]+$/);
      }
      if (argv[0] === "status") return "";
      return "";
    });

    await commitAndOpenPR("Fix the bug", "body text");

    expect(mockedExecFileSync).toHaveBeenNthCalledWith(
      1,
      "git",
      ["remote", "set-url", "origin", "https://x-access-token:test-installation-token@github.com/acme/widgets.git"],
      { cwd: "/workspace" }
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["checkout", "-b"]),
      expect.objectContaining({ cwd: "/workspace", encoding: "utf-8" })
    );
  });

  test("without commitMetadata: commits, pushes and opens a PR titled with the chore(agent) fallback", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M src/foo.ts\n";
      return "";
    });
    mockedPullsCreate.mockResolvedValue({
      data: { number: 42, html_url: "https://github.com/acme/widgets/pull/42" }
    } as never);
    mockedAddLabels.mockResolvedValue({} as never);

    const result = await commitAndOpenPR("Fix the annoying bug", "PR body");

    expect(result).toBe("https://github.com/acme/widgets/pull/42");

    const commands = mockedExecFileSync.mock.calls.map(([, args]) => (args as Array<string>)[0]);
    expect(commands).toEqual(["remote", "checkout", "status", "add", "commit", "push"]);

    expect(mockedExecFileSync).toHaveBeenCalledWith("git", ["add", "-A"], expect.anything());
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "chore(agent): Fix the annoying bug"],
      expect.anything()
    );
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["push", "origin"]),
      expect.anything()
    );

    expect(mockedPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        title: "chore(agent): Fix the annoying bug",
        body: "PR body",
        base: "main"
      })
    );
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["ai-generated"]
    });
  });

  test("truncates taskSummary to 72 characters in the fallback commit message and PR title", async () => {
    const longSummary = "A".repeat(100);
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M src/foo.ts\n";
      return "";
    });
    mockedPullsCreate.mockResolvedValue({
      data: { number: 1, html_url: "https://github.com/acme/widgets/pull/1" }
    } as never);
    mockedAddLabels.mockResolvedValue({} as never);

    await commitAndOpenPR(longSummary, "body");

    const truncated = "A".repeat(72);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", `chore(agent): ${truncated}`],
      expect.anything()
    );
    expect(mockedPullsCreate).toHaveBeenCalledWith(expect.objectContaining({ title: `chore(agent): ${truncated}` }));
  });

  test("with commitMetadata: branch, commit message and PR title use the agent-derived type/scope/subject", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "checkout") {
        expect(argv[2]).toMatch(/^test\/add-search-params-tests-[a-z0-9]+$/);
      }
      if (argv[0] === "status") return " M utils/search-params.test.ts\n";
      return "";
    });
    mockedPullsCreate.mockResolvedValue({
      data: { number: 7, html_url: "https://github.com/acme/widgets/pull/7" }
    } as never);
    mockedAddLabels.mockResolvedValue({} as never);

    const result = await commitAndOpenPR("Add tests for search params", "PR body", {
      type: "test",
      scope: "search-params",
      subject: "add unit tests for parseSearchParams",
      branchSlug: "add-search-params-tests"
    });

    expect(result).toBe("https://github.com/acme/widgets/pull/7");
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "test(search-params): add unit tests for parseSearchParams"],
      expect.anything()
    );
    expect(mockedPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "test(search-params): add unit tests for parseSearchParams" })
    );
  });

  test("with commitMetadata but no scope: omits the parenthesized scope from commit message and title", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M README.md\n";
      return "";
    });
    mockedPullsCreate.mockResolvedValue({
      data: { number: 8, html_url: "https://github.com/acme/widgets/pull/8" }
    } as never);
    mockedAddLabels.mockResolvedValue({} as never);

    await commitAndOpenPR("Update docs", "PR body", {
      type: "docs",
      subject: "clarify setup instructions",
      branchSlug: "clarify-setup-docs"
    });

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      ["commit", "-m", "docs: clarify setup instructions"],
      expect.anything()
    );
    expect(mockedPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ title: "docs: clarify setup instructions" })
    );
  });

  test.each([
    ["undefined", undefined],
    ["missing slash", "not-a-valid-repo"],
    ["empty string", ""]
  ])("throws when REPO is %s, before any git or Octokit call", async (_label, repoValue) => {
    if (repoValue === undefined) {
      delete process.env.REPO;
    } else {
      process.env.REPO = repoValue;
    }

    await expect(commitAndOpenPR("Fix the bug", "body")).rejects.toThrow(
      "The REPO environment variable must be in 'owner/repo' format"
    );
    expect(mockedExecFileSync).not.toHaveBeenCalled();
    expect(mockedPullsCreate).not.toHaveBeenCalled();
  });
});

describe("parseRepo", () => {
  test("splits a valid 'owner/repo' string", () => {
    expect(parseRepo("acme/widgets")).toEqual({ owner: "acme", repo: "widgets" });
  });

  test.each([
    ["undefined", undefined],
    ["missing slash", "not-a-valid-repo"],
    ["empty string", ""]
  ])("throws when repo is %s", (_label, repoValue) => {
    expect(() => parseRepo(repoValue)).toThrow("The REPO environment variable must be in 'owner/repo' format");
  });
});

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
    mockGit(["big.ts"], { "big.ts": "x".repeat(9000) });

    const result = changedFilesWithContent();

    expect(result).toContain("### big.ts");
    expect(result).toContain("[truncated — Read the file for full content]");
    expect(result).not.toContain("x".repeat(9000));
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
