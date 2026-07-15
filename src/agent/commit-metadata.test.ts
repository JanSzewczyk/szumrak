import { parseCommitMetadata } from "~/agent/commit-metadata";

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

describe("parseCommitMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("parses a trailing commit block into CommitMetadata", () => {
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

    expect(parseCommitMetadata(finalText)).toEqual({
      type: "test",
      scope: "search-params",
      subject: "add unit tests for parseSearchParams",
      branchSlug: "add-search-params-tests"
    });
  });

  test("tolerates the model collapsing 'type: <type>' and 'subject: ...' into one line", () => {
    const finalText = [
      "```commit",
      "test: add unit tests for getInitials function in utils/users.test.ts",
      "branch: add-users-getinitials-tests",
      "```"
    ].join("\n");

    expect(parseCommitMetadata(finalText)).toEqual({
      type: "test",
      scope: undefined,
      subject: "add unit tests for getInitials function in utils/users.test.ts".slice(0, 50),
      branchSlug: "add-users-getinitials-tests"
    });
  });

  test("parses a commit block without a scope, omitting scope from CommitMetadata", () => {
    const finalText = [
      "```commit",
      "type: docs",
      "subject: clarify setup instructions",
      "branch: clarify-setup-docs",
      "```"
    ].join("\n");

    expect(parseCommitMetadata(finalText)).toEqual({
      type: "docs",
      scope: undefined,
      subject: "clarify setup instructions",
      branchSlug: "clarify-setup-docs"
    });
  });

  test("returns undefined when there is no commit block", () => {
    expect(parseCommitMetadata("All done, no fenced block here.")).toBeUndefined();
  });

  test("returns undefined when the commit block has an invalid type", () => {
    const finalText = [
      "```commit",
      "type: not-a-real-type",
      "subject: something",
      "branch: something-slug",
      "```"
    ].join("\n");

    expect(parseCommitMetadata(finalText)).toBeUndefined();
  });
});
