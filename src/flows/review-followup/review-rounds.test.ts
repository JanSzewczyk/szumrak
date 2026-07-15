import {
  buildFollowUpTask,
  extractOriginalTask,
  getRoundCount,
  updateRoundLabel
} from "~/flows/review-followup/review-rounds";
import { octokit } from "~/github/client";

vi.mock("~/github/client", () => ({
  octokit: {
    issues: { addLabels: vi.fn(), removeLabel: vi.fn() }
  }
}));

const mockedAddLabels = vi.mocked(octokit.issues.addLabels);
const mockedRemoveLabel = vi.mocked(octokit.issues.removeLabel);

describe("getRoundCount", () => {
  test("returns the round number from a review-round-N label", () => {
    expect(getRoundCount([{ name: "review-round-2" }])).toBe(2);
  });

  test("returns 0 when there is no round label", () => {
    expect(getRoundCount([{ name: "ai-generated" }])).toBe(0);
    expect(getRoundCount([])).toBe(0);
  });
});

describe("updateRoundLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAddLabels.mockResolvedValue({} as never);
    mockedRemoveLabel.mockResolvedValue({} as never);
  });

  test("adds review-round-1 without removing anything when previousRound is 0", async () => {
    await updateRoundLabel("acme", "widgets", 42, 0);

    expect(mockedRemoveLabel).not.toHaveBeenCalled();
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-1"]
    });
  });

  test("removes the previous round label and adds the next one", async () => {
    await updateRoundLabel("acme", "widgets", 42, 1);

    expect(mockedRemoveLabel).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      name: "review-round-1"
    });
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-2"]
    });
  });

  test("still adds the next round label when removing the previous one fails", async () => {
    mockedRemoveLabel.mockRejectedValue(new Error("label already gone"));

    await expect(updateRoundLabel("acme", "widgets", 42, 1)).resolves.toBeUndefined();
    expect(mockedAddLabels).toHaveBeenCalledWith({
      owner: "acme",
      repo: "widgets",
      issue_number: 42,
      labels: ["review-round-2"]
    });
  });
});

describe("extractOriginalTask", () => {
  test("extracts the task text written by the runner flow's PR body", () => {
    const body =
      "Task:\nAdd unit tests for parseSearchParams\n\nGenerated automatically by Szumrak.\n\nModel summary:\ndone";

    expect(extractOriginalTask(body)).toBe("Add unit tests for parseSearchParams");
  });

  test("falls back to a placeholder when the marker isn't present", () => {
    expect(extractOriginalTask("This PR body has no Task: marker.")).toBe(
      "(original task unavailable — see PR description)"
    );
  });
});

describe("buildFollowUpTask", () => {
  test("includes the branch, original task, file content, and feedback", () => {
    const task = buildFollowUpTask(
      "test/add-x-tests-abc123",
      "Add unit tests for parseSearchParams",
      "### utils/foo.ts\n```\nexport const foo = 1;\n```",
      "Please add error handling"
    );

    expect(task).toContain("test/add-x-tests-abc123");
    expect(task).toContain("Add unit tests for parseSearchParams");
    expect(task).toContain("### utils/foo.ts");
    expect(task).toContain("export const foo = 1;");
    expect(task).toContain("Please add error handling");
  });
});
