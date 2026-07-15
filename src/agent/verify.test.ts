import { execFileSync } from "node:child_process";
import { runVerifyCommands } from "~/agent/verify";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

const mockedExecFileSync = vi.mocked(execFileSync);

/** Mimics the error execFileSync throws for a non-zero exit, with captured output. */
function commandFailure(stdout: string, stderr = "") {
  const err = new Error("Command failed");
  Object.assign(err, { stdout, stderr });
  return err;
}

describe("runVerifyCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes when every command exits cleanly, executing each without a shell", () => {
    const outcome = runVerifyCommands(["npm run typecheck", "npm run lint"], "/workspace");

    expect(outcome).toEqual({ passed: true, report: "" });
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
    expect(mockedExecFileSync).toHaveBeenCalledWith(
      "npm",
      ["run", "typecheck"],
      expect.objectContaining({ cwd: "/workspace" })
    );
    /** Argument-array form (no `shell: true`) is the command-injection invariant. */
    expect(mockedExecFileSync).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ shell: true })
    );
  });

  test("collects a failing command's output into the report and keeps running later commands", () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw commandFailure("src/a.ts(3,1): error TS2322", "");
    });

    const outcome = runVerifyCommands(["npm run typecheck", "npm run lint"], "/workspace");

    expect(outcome.passed).toBe(false);
    expect(outcome.report).toContain("$ npm run typecheck");
    expect(outcome.report).toContain("error TS2322");
    expect(mockedExecFileSync).toHaveBeenCalledTimes(2);
  });

  test("aggregates multiple failures separated per command", () => {
    mockedExecFileSync
      .mockImplementationOnce(() => {
        throw commandFailure("", "boom");
      })
      .mockImplementationOnce(() => {
        throw commandFailure("", "boom");
      });

    const outcome = runVerifyCommands(["npm run typecheck", "npm run lint"], "/workspace");

    expect(outcome.report).toContain("$ npm run typecheck");
    expect(outcome.report).toContain("$ npm run lint");
  });

  test("falls back to the error message when the command produced no output", () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw new Error("spawn npm ENOENT");
    });

    const outcome = runVerifyCommands(["npm run lint"], "/workspace");

    expect(outcome.passed).toBe(false);
    expect(outcome.report).toContain("spawn npm ENOENT");
  });

  test("skips blank command entries instead of executing them", () => {
    const outcome = runVerifyCommands(["   ", "npm run lint"], "/workspace");

    expect(outcome.passed).toBe(true);
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });
});
