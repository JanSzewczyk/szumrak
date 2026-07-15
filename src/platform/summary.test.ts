import { appendFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn()
}));

const mockedAppendFileSync = vi.mocked(appendFileSync);

describe("writeStepSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_STEP_SUMMARY;
  });

  test("appends a markdown failure line to GITHUB_STEP_SUMMARY when set", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/step-summary.md";
    const { writeStepSummary } = await import("~/platform/summary");

    writeStepSummary("Task did not complete successfully");

    expect(mockedAppendFileSync).toHaveBeenCalledWith(
      "/tmp/step-summary.md",
      "❌ **Szumrak** — Task did not complete successfully\n"
    );
  });

  test("does nothing when GITHUB_STEP_SUMMARY is unset", async () => {
    const { writeStepSummary } = await import("~/platform/summary");

    writeStepSummary("Task did not complete successfully");

    expect(mockedAppendFileSync).not.toHaveBeenCalled();
  });

  test("swallows appendFileSync errors without throwing", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/step-summary.md";
    mockedAppendFileSync.mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });
    const { writeStepSummary } = await import("~/platform/summary");

    expect(() => writeStepSummary("boom")).not.toThrow();
  });

  test("uses a custom icon when provided", async () => {
    process.env.GITHUB_STEP_SUMMARY = "/tmp/step-summary.md";
    const { writeStepSummary } = await import("~/platform/summary");

    writeStepSummary("Skipped — an open PR already exists", "ℹ️");

    expect(mockedAppendFileSync).toHaveBeenCalledWith(
      "/tmp/step-summary.md",
      "ℹ️ **Szumrak** — Skipped — an open PR already exists\n"
    );
  });
});
