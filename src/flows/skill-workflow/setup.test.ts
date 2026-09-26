import { execFileSync } from "node:child_process";
import { SkillWorkflowSetupError } from "~/flows/skill-workflow/errors";
import { runSkillWorkflowSetup } from "~/flows/skill-workflow/setup";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn()
}));

const mockedExecFileSync = vi.mocked(execFileSync);

function commandFailure(stderr: string) {
  return Object.assign(new Error("Command failed"), { stdout: Buffer.from(""), stderr: Buffer.from(stderr) });
}

describe("runSkillWorkflowSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExecFileSync.mockReturnValue(Buffer.from("ok"));
  });

  afterEach(() => {
    delete process.env.JIRA_API_TOKEN;
  });

  test("runs nothing when there are no setup commands", () => {
    runSkillWorkflowSetup([], "/workspace");

    expect(mockedExecFileSync).not.toHaveBeenCalled();
  });

  test("runs every command through sh in the workspace, in order", () => {
    runSkillWorkflowSetup(["apt-get install -y jq", "npm install -g @acme/cli"], "/workspace");

    expect(mockedExecFileSync.mock.calls.map(([file, args]) => [file, args])).toEqual([
      ["sh", ["-c", "apt-get install -y jq"]],
      ["sh", ["-c", "npm install -g @acme/cli"]]
    ]);
    expect(mockedExecFileSync.mock.calls[0][2]).toMatchObject({ cwd: "/workspace" });
  });

  test("runs commands without any credentials in their environment", () => {
    process.env.JIRA_API_TOKEN = "secret";

    runSkillWorkflowSetup(["true"], "/workspace");

    const options = mockedExecFileSync.mock.calls[0][2] as { env: Record<string, string | undefined> };
    expect(options.env).not.toHaveProperty("JIRA_API_TOKEN");
    expect(options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(options.env).not.toHaveProperty("GH_APP_PRIVATE_KEY");
  });

  test("stops at the first failing command", () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw commandFailure("E: Unable to locate package nope");
    });

    expect(() => runSkillWorkflowSetup(["apt-get install -y nope", "echo later"], "/workspace")).toThrow(
      SkillWorkflowSetupError
    );
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  test("names the failing command and includes its stderr in the error", () => {
    mockedExecFileSync.mockImplementationOnce(() => {
      throw commandFailure("E: Unable to locate package nope");
    });

    expect(() => runSkillWorkflowSetup(["apt-get install -y nope"], "/workspace")).toThrow(
      /`apt-get install -y nope` failed:\nE: Unable to locate package nope/
    );
  });
});
