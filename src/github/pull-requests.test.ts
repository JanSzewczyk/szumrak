import { execFileSync } from "node:child_process";
import { octokit } from "~/github/client";
import { commitAndOpenPR, postPrComment } from "~/github/pull-requests";
import { parseRepo } from "~/github/repo";
import { commitMetadataBuilder } from "~/test/builders/commit-metadata.builder";
import { pullsCreateResponseBuilder } from "~/test/builders/pulls-create-response.builder";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/github/client", () => ({
  octokit: {
    pulls: { create: vi.fn() },
    issues: { addLabels: vi.fn(), createComment: vi.fn() }
  },
  getInstallationToken: vi.fn().mockResolvedValue("test-installation-token")
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedExecFileSync = vi.mocked(execFileSync);
const mockedPullsCreate = vi.mocked(octokit.pulls.create);
const mockedAddLabels = vi.mocked(octokit.issues.addLabels);
const mockedCreateComment = vi.mocked(octokit.issues.createComment);

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
    const pullsCreateResponse = pullsCreateResponseBuilder.one();
    mockedPullsCreate.mockResolvedValue(pullsCreateResponse as never);
    mockedAddLabels.mockResolvedValue({} as never);

    const result = await commitAndOpenPR("Fix the annoying bug", "PR body");

    expect(result).toBe(pullsCreateResponse.data.html_url);

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
      issue_number: pullsCreateResponse.data.number,
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
    mockedPullsCreate.mockResolvedValue(pullsCreateResponseBuilder.one() as never);
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
    const pullsCreateResponse = pullsCreateResponseBuilder.one();
    mockedPullsCreate.mockResolvedValue(pullsCreateResponse as never);
    mockedAddLabels.mockResolvedValue({} as never);

    const result = await commitAndOpenPR(
      "Add tests for search params",
      "PR body",
      commitMetadataBuilder.one({
        overrides: {
          type: "test",
          scope: "search-params",
          subject: "add unit tests for parseSearchParams",
          branchSlug: "add-search-params-tests"
        }
      })
    );

    expect(result).toBe(pullsCreateResponse.data.html_url);
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
    mockedPullsCreate.mockResolvedValue(pullsCreateResponseBuilder.one() as never);
    mockedAddLabels.mockResolvedValue({} as never);

    await commitAndOpenPR(
      "Update docs",
      "PR body",
      commitMetadataBuilder.one({
        overrides: {
          type: "docs",
          subject: "clarify setup instructions",
          branchSlug: "clarify-setup-docs",
          scope: undefined
        }
      })
    );

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

describe("postPrComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("posts a comment via octokit.issues.createComment", async () => {
    mockedCreateComment.mockResolvedValue({} as never);

    await postPrComment("acme", "widgets", 42, "Stuck in a loop on Bash.");

    expect(mockedCreateComment).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      body: "Stuck in a loop on Bash."
    });
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
