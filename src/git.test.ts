// Test plan for src/git.ts — commitAndOpenPR(taskSummary, body)
// 1. "no changes" path: `git status --porcelain` returns empty output → returns null,
//    no add/commit/push/PR calls happen (branch checkout still runs).
// 2. "has changes" happy path: full flow (checkout, status, add, commit, push, PR
//    create, add label) runs in order and the function resolves to pr.data.html_url.
// 3. execFileSync is invoked with an argument array (never a single interpolated
//    string) for every git subcommand — this is the command-injection guard the repo
//    explicitly calls out; assert the exact argv shapes.
// 4. taskSummary is truncated to 72 chars in both the commit message and the PR title.
// 5. env.REPO validation: throws a clear error when REPO is missing or not in
//    "owner/repo" format, and this happens AFTER push (per current source order) but
//    BEFORE any Octokit call.
// 6. octokit.pulls.create is called with the correct owner/repo/head/base/title/body,
//    and octokit.issues.addLabels is called with the "ai-generated" label for the
//    created PR's issue_number.

import { execFileSync } from "node:child_process";
import { commitAndOpenPR } from "~/git";
import { octokit } from "~/lib/github";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/lib/github", () => ({
  octokit: {
    pulls: { create: vi.fn() },
    issues: { addLabels: vi.fn() }
  }
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
    expect(commands).toEqual(["checkout", "status"]);
  });

  test("checks out a branch and checks status before deciding whether to commit", async () => {
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "checkout") {
        expect(argv[1]).toBe("-b");
        expect(argv[2]).toMatch(/^agent\/\d+$/);
      }
      if (argv[0] === "status") return "";
      return "";
    });

    await commitAndOpenPR("Fix the bug", "body text");

    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["checkout", "-b"]),
      expect.objectContaining({ cwd: "/workspace", encoding: "utf-8" })
    );
  });

  test("commits, pushes and opens a PR when there are changes", async () => {
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
    expect(commands).toEqual(["checkout", "status", "add", "commit", "push"]);

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
        title: "[agent] Fix the annoying bug",
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

  test("truncates taskSummary to 72 characters in the commit message and PR title", async () => {
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
    expect(mockedPullsCreate).toHaveBeenCalledWith(expect.objectContaining({ title: `[agent] ${truncated}` }));
  });

  test.each([
    ["undefined", undefined],
    ["missing slash", "not-a-valid-repo"],
    ["empty string", ""]
  ])("throws when REPO is %s", async (_label, repoValue) => {
    if (repoValue === undefined) {
      delete process.env.REPO;
    } else {
      process.env.REPO = repoValue;
    }
    mockedExecFileSync.mockImplementation((_cmd, args) => {
      const argv = args as Array<string>;
      if (argv[0] === "status") return " M src/foo.ts\n";
      return "";
    });

    await expect(commitAndOpenPR("Fix the bug", "body")).rejects.toThrow(
      "The REPO environment variable must be in 'owner/repo' format"
    );
    expect(mockedPullsCreate).not.toHaveBeenCalled();
  });
});
