// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal `${VAR}` is the .mcp.json expansion syntax
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent } from "~/agent/run-agent";
import { SkillWorkflowSetupError } from "~/flows/skill-workflow/errors";
import { SkillWorkflowStatus } from "~/flows/skill-workflow/instructions";
import { runSkillWorkflowFlow, withEntrySkill } from "~/flows/skill-workflow/run-skill-workflow-flow";
import { runSkillWorkflowSetup } from "~/flows/skill-workflow/setup";
import { createScopedInstallationToken } from "~/github/client";
import { configureGitRemoteAuth } from "~/github/git-operations";
import { registerSecretValues } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import { TargetRepoPath } from "~/platform/target-repo-layout";
import { agentRunResultBuilder } from "~/test/builders/agent-run-result.builder";
import { GitHubAccess } from "~/types/github-access";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/flows/skill-workflow/setup", () => ({
  runSkillWorkflowSetup: vi.fn()
}));

vi.mock("~/github/client", () => ({
  createScopedInstallationToken: vi.fn()
}));

vi.mock("~/github/git-operations", () => ({
  configureGitRemoteAuth: vi.fn()
}));

vi.mock("~/platform/logger", () => ({
  log: vi.fn(),
  registerSecretValues: vi.fn()
}));

vi.mock("~/platform/summary", () => ({
  writeStepSummary: vi.fn()
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedRunAgent = vi.mocked(runAgent);
const mockedRunSetup = vi.mocked(runSkillWorkflowSetup);
const mockedCreateScopedToken = vi.mocked(createScopedInstallationToken);
const mockedConfigureGitRemoteAuth = vi.mocked(configureGitRemoteAuth);
const mockedRegisterSecretValues = vi.mocked(registerSecretValues);
const mockedWriteStepSummary = vi.mocked(writeStepSummary);

const WORKSPACE = "/workspace";
const MANIFEST_PATH = join(WORKSPACE, ".szumrak", "skill-workflows", "do-ticket.json");
const SKILL_PATH = join(WORKSPACE, ".claude", "skills", "do-ticket", "SKILL.md");
const MCP_PATH = join(WORKSPACE, ".mcp.json");
const AGENT_CONFIG_PATH = join(WORKSPACE, ".szumrak", "config.json");

const INPUTS = JSON.stringify({ ticket: "PROJ-1" });
const SECRETS = JSON.stringify({ JIRA_API_TOKEN: "jira-t0ken", JIRA_CLI_TOKEN: "cli-t0ken" });
const WRITE_PERMISSIONS = { contents: GitHubAccess.WRITE, pull_requests: GitHubAccess.WRITE };
const SUMMARY = "Implemented PROJ-1 in https://github.com/acme/app/pull/7";

type Files = Record<string, unknown>;

function filesOnDisk(files: Files) {
  mockedExistsSync.mockImplementation((candidate) => String(candidate) in files);
  mockedReadFileSync.mockImplementation((candidate) => {
    const content = files[String(candidate)];
    if (content === undefined) {
      throw new Error(`unexpected read: ${String(candidate)}`);
    }
    return typeof content === "string" ? content : JSON.stringify(content);
  });
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    skill: "do-ticket",
    args: "{{inputs.ticket}}",
    inputs: { ticket: { required: true, pattern: "[A-Z]+-\\d+" } },
    secrets: ["JIRA_API_TOKEN", "JIRA_CLI_TOKEN"],
    agentEnv: ["JIRA_CLI_TOKEN"],
    mcpServers: { atlassian: ".mcp.json" },
    github: { permissions: WRITE_PERMISSIONS },
    setup: ["npm install -g jira-cli"],
    ...overrides
  };
}

function standardFiles(manifestOverrides: Record<string, unknown> = {}): Files {
  return {
    [MANIFEST_PATH]: manifest(manifestOverrides),
    [SKILL_PATH]: "---\nname: do-ticket\n---",
    [MCP_PATH]: { mcpServers: { atlassian: { command: "npx", env: { JIRA_API_TOKEN: "${JIRA_API_TOKEN}" } } } },
    [AGENT_CONFIG_PATH]: { skills: ["clerk-setup"], verify: ["npm run lint"] }
  };
}

function withoutFile(files: Files, path: string): Files {
  return Object.fromEntries(Object.entries(files).filter(([candidate]) => candidate !== path));
}

function completedRun() {
  return agentRunResultBuilder.one({
    overrides: { structuredOutput: { status: SkillWorkflowStatus.COMPLETED, summary: SUMMARY } }
  });
}

describe("runSkillWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = WORKSPACE;
    process.env.REPO = "acme/app";
    delete process.env.DRY_RUN;
    mockedCreateScopedToken.mockResolvedValue("ghs_scopedtoken");
  });

  afterEach(() => {
    delete process.env.REPO;
    delete process.env.DRY_RUN;
  });

  describe("configuration errors", () => {
    test.each([
      ["the manifest is missing", {}, INPUTS, SECRETS, /manifest not found/],
      ["a required input is missing", standardFiles(), "{}", SECRETS, /"ticket" is required/],
      ["a declared secret is missing", standardFiles(), INPUTS, "{}", /Missing secrets/],
      [
        "the entry skill does not exist",
        withoutFile(standardFiles(), SKILL_PATH),
        INPUTS,
        SECRETS,
        /Skill "do-ticket" not found/
      ],
      [
        "an MCP server is taken from a missing .mcp.json",
        withoutFile(standardFiles(), MCP_PATH),
        INPUTS,
        SECRETS,
        /define them inline/
      ]
    ])("fails without running setup or the agent when %s", async (_, files, rawInputs, rawSecrets, message) => {
      filesOnDisk(files);

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs, rawSecrets });

      expect(result).toEqual({ succeeded: false });
      expect(mockedRunSetup).not.toHaveBeenCalled();
      expect(mockedRunAgent).not.toHaveBeenCalled();
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringMatching(message));
    });
  });

  describe("setup", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
      mockedRunAgent.mockResolvedValue(completedRun());
    });

    test("runs the manifest's setup commands in the workspace before the agent", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunSetup).toHaveBeenCalledWith(["npm install -g jira-cli"], WORKSPACE);
      expect(mockedRunSetup.mock.invocationCallOrder[0]).toBeLessThan(mockedRunAgent.mock.invocationCallOrder[0]);
    });

    test("fails without running the agent when a setup command fails", async () => {
      mockedRunSetup.mockImplementationOnce(() => {
        throw new SkillWorkflowSetupError("Setup command `npm install -g jira-cli` failed:\nE404");
      });

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedRunAgent).not.toHaveBeenCalled();
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("setup failed"));
    });
  });

  describe("agent environment", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
      mockedRunAgent.mockResolvedValue(completedRun());
    });

    test("registers every secret and the scoped token for log redaction", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRegisterSecretValues).toHaveBeenCalledWith(["jira-t0ken", "cli-t0ken"]);
      expect(mockedRegisterSecretValues).toHaveBeenCalledWith(["ghs_scopedtoken"]);
    });

    test("mints a repo-scoped token with the manifest's permissions and wires it into git", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).toHaveBeenCalledWith("app", WRITE_PERMISSIONS);
      expect(mockedConfigureGitRemoteAuth).toHaveBeenCalledWith("acme", "app", "ghs_scopedtoken");
    });

    test("mints no token when the manifest declares no GitHub permissions", async () => {
      filesOnDisk(standardFiles({ github: undefined }));

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).not.toHaveBeenCalled();
      expect(mockedConfigureGitRemoteAuth).not.toHaveBeenCalled();
      expect(mockedRunAgent.mock.calls[0][1]?.env).not.toHaveProperty("GH_TOKEN");
    });

    test("leaves the git remote alone when the token has no contents write access", async () => {
      filesOnDisk(standardFiles({ github: { permissions: { issues: GitHubAccess.WRITE } } }));

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).toHaveBeenCalledWith("app", { issues: GitHubAccess.WRITE });
      expect(mockedConfigureGitRemoteAuth).not.toHaveBeenCalled();
    });

    test("mints no token in a dry run", async () => {
      process.env.DRY_RUN = "true";

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).not.toHaveBeenCalled();
      expect(mockedRunAgent.mock.calls[0][1]?.env).not.toHaveProperty("GH_TOKEN");
    });

    test("passes only agentEnv secrets and the scoped token into the agent environment", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      const options = mockedRunAgent.mock.calls[0][1];
      expect(options?.env).toMatchObject({
        JIRA_CLI_TOKEN: "cli-t0ken",
        GH_TOKEN: "ghs_scopedtoken",
        GITHUB_TOKEN: "ghs_scopedtoken"
      });
      expect(options?.env).not.toHaveProperty("JIRA_API_TOKEN");
    });

    test("gives a .mcp.json server its secret and requests structured output", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      const options = mockedRunAgent.mock.calls[0][1];
      expect(options?.mcpServers).toEqual({ atlassian: { command: "npx", env: { JIRA_API_TOKEN: "jira-t0ken" } } });
      expect(options?.outputFormat?.type).toBe("json_schema");
    });

    test("uses an inline MCP server when the repo has no .mcp.json", async () => {
      filesOnDisk(
        withoutFile(
          standardFiles({ mcpServers: { atlassian: { command: "npx", args: ["-y", "mcp-atlassian"] } } }),
          MCP_PATH
        )
      );

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.mcpServers).toEqual({
        atlassian: { command: "npx", args: ["-y", "mcp-atlassian"] }
      });
    });

    test("passes no MCP servers when the manifest declares none", async () => {
      filesOnDisk(standardFiles({ mcpServers: undefined }));

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.mcpServers).toBeUndefined();
    });

    test("always denies edits to Szumrak's own configuration and adds git guardrails", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.permissions?.deny).toEqual(
        expect.arrayContaining([
          "Edit(.szumrak/**)",
          "Write(.szumrak/**)",
          "Bash(git push --force*)",
          "Bash(gh pr merge*)"
        ])
      );
    });

    test("denies both Edit and Write on the Szumrak directory holding every configuration file", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.permissions?.deny).toEqual(
        expect.arrayContaining([`Edit(${TargetRepoPath.SZUMRAK_DIR}/**)`, `Write(${TargetRepoPath.SZUMRAK_DIR}/**)`])
      );
    });

    test("adds the entry skill to the agent-config skills whitelist", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.skills).toEqual(["clerk-setup", "do-ticket"]);
    });

    test("prompts the agent to invoke the entry skill with rendered arguments", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][0]).toContain("Skill arguments: PROJ-1");
    });
  });

  describe("outcome", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
    });

    test("succeeds and reports the skill's own summary when it completes", async () => {
      mockedRunAgent.mockResolvedValue(completedRun());

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining(SUMMARY), "✅");
    });

    test("marks the summary of a dry run", async () => {
      process.env.DRY_RUN = "true";
      mockedRunAgent.mockResolvedValue(completedRun());

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("(dry run)"), "✅");
    });

    test("fails when the agent run fails", async () => {
      mockedRunAgent.mockResolvedValue(agentRunResultBuilder.one({ traits: "failed" }));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
    });

    test("fails when the run ends without a structured result", async () => {
      mockedRunAgent.mockResolvedValue(agentRunResultBuilder.one({ overrides: { structuredOutput: undefined } }));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("without a structured result"));
    });

    test("reports a blocked skill as a failure that needs a human", async () => {
      mockedRunAgent.mockResolvedValue(
        agentRunResultBuilder.one({
          overrides: { structuredOutput: { status: SkillWorkflowStatus.BLOCKED, summary: "Ticket has no specs" } }
        })
      );

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringContaining("Ticket has no specs"), "⚠️");
    });
  });
});

describe("withEntrySkill", () => {
  test.each([
    ["keeps 'all'", "all" as const, "all"],
    ["appends the entry skill to a whitelist", ["a"], ["a", "do-ticket"]],
    ["keeps a whitelist that already has it", ["do-ticket"], ["do-ticket"]],
    ["whitelists only the entry skill when none is configured", undefined, ["do-ticket"]]
  ])("%s", (_, skills, expected) => {
    expect(withEntrySkill(skills, "do-ticket")).toEqual(expected);
  });
});
