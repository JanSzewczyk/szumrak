// Test plan for src/github/dedup.ts — findOpenPRForTask(owner, repo, task)
// 1. Returns the html_url of an open PR whose body contains "Task:\n<task>".
// 2. Returns null when no open PR's body contains that text.
// 3. Returns null when an open PR has no body at all.
// 4. Calls octokit.pulls.list with { owner, repo, state: "open" }.

import { octokit } from "~/github/client";
import { findOpenPRForTask } from "~/github/dedup";

vi.mock("~/github/client", () => ({
  octokit: {
    pulls: { list: vi.fn() }
  }
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedPullsList = vi.mocked(octokit.pulls.list);

describe("findOpenPRForTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns the URL of an open PR whose body contains the task text", async () => {
    mockedPullsList.mockResolvedValue({
      data: [
        {
          body: "Task:\nAdd a unit test\n\nGenerated automatically.",
          html_url: "https://github.com/acme/widgets/pull/5"
        }
      ]
    } as never);

    const result = await findOpenPRForTask("acme", "widgets", "Add a unit test");

    expect(result).toBe("https://github.com/acme/widgets/pull/5");
    expect(mockedPullsList).toHaveBeenCalledWith({ owner: "acme", repo: "widgets", state: "open" });
  });

  test("returns null when no open PR matches the task", async () => {
    mockedPullsList.mockResolvedValue({
      data: [{ body: "Task:\nSome other task", html_url: "https://github.com/acme/widgets/pull/6" }]
    } as never);

    const result = await findOpenPRForTask("acme", "widgets", "Add a unit test");

    expect(result).toBeNull();
  });

  test("returns null when there are no open PRs, including ones with no body", async () => {
    mockedPullsList.mockResolvedValue({
      data: [{ body: null, html_url: "https://github.com/acme/widgets/pull/7" }]
    } as never);

    const result = await findOpenPRForTask("acme", "widgets", "Add a unit test");

    expect(result).toBeNull();
  });
});
