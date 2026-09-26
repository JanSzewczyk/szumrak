// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal `${VAR}` is the .mcp.json expansion syntax
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent } from "~/agent/run-agent";
import { runVerifyCommands } from "~/agent/verify";
import { SkillWorkflowStatus } from "~/flows/skill-workflow/instructions";
import { SkillWorkflowDelivery } from "~/flows/skill-workflow/manifest";
import { buildDedupMarker, runSkillWorkflowFlow, withEntrySkill } from "~/flows/skill-workflow/run-skill-workflow-flow";
import { createScopedInstallationToken, octokit } from "~/github/client";
import { findOpenPRWithMarker } from "~/github/dedup";
import { configureGitRemoteAuth } from "~/github/git-operations";
import { commitAndOpenPR } from "~/github/pull-requests";
import { registerSecretValues } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import { agentRunResultBuilder } from "~/test/builders/agent-run-result.builder";
import { GitHubAccess } from "~/types/github-access";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

vi.mock("~/agent/run-agent", () => ({
  runAgent: vi.fn()
}));

vi.mock("~/agent/verify", () => ({
  runVerifyCommands: vi.fn()
}));

vi.mock("~/github/client", () => ({
  createScopedInstallationToken: vi.fn(),
  octokit: {
    pulls: { get: vi.fn(), update: vi.fn() },
    issues: { addLabels: vi.fn() }
  }
}));

vi.mock("~/github/dedup", () => ({
  findOpenPRWithMarker: vi.fn()
}));

vi.mock("~/github/git-operations", () => ({
  configureGitRemoteAuth: vi.fn()
}));

vi.mock("~/github/pull-requests", () => ({
  commitAndOpenPR: vi.fn()
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
const mockedRunVerifyCommands = vi.mocked(runVerifyCommands);
const mockedCreateScopedToken = vi.mocked(createScopedInstallationToken);
const mockedFindOpenPRWithMarker = vi.mocked(findOpenPRWithMarker);
const mockedConfigureGitRemoteAuth = vi.mocked(configureGitRemoteAuth);
const mockedCommitAndOpenPR = vi.mocked(commitAndOpenPR);
const mockedRegisterSecretValues = vi.mocked(registerSecretValues);
const mockedWriteStepSummary = vi.mocked(writeStepSummary);
const mockedPullsGet = vi.mocked(octokit.pulls.get);
const mockedPullsUpdate = vi.mocked(octokit.pulls.update);
const mockedAddLabels = vi.mocked(octokit.issues.addLabels);

const WORKSPACE = "/workspace";
const MANIFEST_PATH = join(WORKSPACE, ".claude", "szumrak", "skill-workflows", "do-ticket.json");
const SKILL_PATH = join(WORKSPACE, ".claude", "skills", "do-ticket", "SKILL.md");
const MCP_PATH = join(WORKSPACE, ".mcp.json");
const AGENT_CONFIG_PATH = join(WORKSPACE, ".claude", "agent-config.json");

const PR_URL = "https://github.com/acme/app/pull/7";
const INPUTS = JSON.stringify({ ticket: "PROJ-1" });
const SECRETS = JSON.stringify({ JIRA_API_TOKEN: "jira-t0ken", JIRA_CLI_TOKEN: "cli-t0ken" });

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
    delivery: SkillWorkflowDelivery.AGENT,
    secrets: ["JIRA_API_TOKEN", "JIRA_CLI_TOKEN"],
    agentEnv: ["JIRA_CLI_TOKEN"],
    mcpServers: ["atlassian"],
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

function completedRun(output: Record<string, unknown> = {}) {
  return agentRunResultBuilder.one({
    overrides: {
      structuredOutput: { status: SkillWorkflowStatus.COMPLETED, summary: "Implemented PROJ-1", ...output }
    }
  });
}

function pullRequest(overrides: { headRef?: string; headRepo?: string } = {}) {
  return {
    data: {
      html_url: PR_URL,
      body: "Implements PROJ-1",
      head: { ref: overrides.headRef ?? "feat/proj-1", repo: { full_name: overrides.headRepo ?? "acme/app" } },
      base: { repo: { default_branch: "main", full_name: "acme/app" } }
    }
  } as never;
}

describe("runSkillWorkflowFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WORKSPACE_PATH = WORKSPACE;
    process.env.REPO = "acme/app";
    delete process.env.DRY_RUN;
    mockedFindOpenPRWithMarker.mockResolvedValue(null);
    mockedCreateScopedToken.mockResolvedValue("ghs_scopedtoken");
    mockedPullsGet.mockResolvedValue(pullRequest());
    mockedPullsUpdate.mockResolvedValue({} as never);
    mockedAddLabels.mockResolvedValue({} as never);
    mockedRunVerifyCommands.mockReturnValue({ passed: true, report: "" });
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
        { ...standardFiles(), [SKILL_PATH]: undefined },
        INPUTS,
        SECRETS,
        /Skill "do-ticket" not found/
      ]
    ])("fails without running the agent when %s", async (_, files, rawInputs, rawSecrets, message) => {
      filesOnDisk(Object.fromEntries(Object.entries(files).filter(([, content]) => content !== undefined)));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs, rawSecrets });

      expect(result).toEqual({ succeeded: false });
      expect(mockedRunAgent).not.toHaveBeenCalled();
      expect(mockedWriteStepSummary).toHaveBeenCalledWith(expect.stringMatching(message));
    });
  });

  describe("agent run setup", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
      mockedRunAgent.mockResolvedValue(completedRun({ pullRequestUrl: PR_URL }));
    });

    test("registers every secret and the scoped token for log redaction", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRegisterSecretValues).toHaveBeenCalledWith(["jira-t0ken", "cli-t0ken"]);
      expect(mockedRegisterSecretValues).toHaveBeenCalledWith(["ghs_scopedtoken"]);
    });

    test("mints a repo-scoped token with the default agent-delivery permissions and wires it into git", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).toHaveBeenCalledWith("app", {
        contents: GitHubAccess.WRITE,
        pull_requests: GitHubAccess.WRITE
      });
      expect(mockedConfigureGitRemoteAuth).toHaveBeenCalledWith("acme", "app", "ghs_scopedtoken");
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

    test("gives the MCP server its secret and requests structured output", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      const options = mockedRunAgent.mock.calls[0][1];
      expect(options?.mcpServers).toEqual({ atlassian: { command: "npx", env: { JIRA_API_TOKEN: "jira-t0ken" } } });
      expect(options?.outputFormat?.type).toBe("json_schema");
    });

    test("always denies edits to Szumrak's own configuration and adds agent-delivery guardrails", async () => {
      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      const deny = mockedRunAgent.mock.calls[0][1]?.permissions?.deny;
      expect(deny).toEqual(
        expect.arrayContaining([
          "Edit(.claude/szumrak/**)",
          "Edit(.claude/agent-config.json)",
          "Bash(git push --force*)"
        ])
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

    test("skips the run when an open PR already carries the dedup marker", async () => {
      mockedFindOpenPRWithMarker.mockResolvedValue(PR_URL);

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
      expect(mockedRunAgent).not.toHaveBeenCalled();
      expect(mockedCreateScopedToken).not.toHaveBeenCalled();
    });

    test("mints no token and checks no duplicates in a dry run", async () => {
      process.env.DRY_RUN = "true";

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedFindOpenPRWithMarker).not.toHaveBeenCalled();
      expect(mockedCreateScopedToken).not.toHaveBeenCalled();
      expect(mockedRunAgent.mock.calls[0][1]?.env).not.toHaveProperty("GH_TOKEN");
    });
  });

  describe("outcome", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
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

  describe("agent delivery", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles());
    });

    test("labels the reported PR and appends the dedup marker and run info to its body", async () => {
      mockedRunAgent.mockResolvedValue(completedRun({ pullRequestUrl: PR_URL }));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
      expect(mockedAddLabels).toHaveBeenCalledWith(
        expect.objectContaining({ issue_number: 7, labels: ["ai-generated"] })
      );
      const body = mockedPullsUpdate.mock.calls[0][0]?.body;
      expect(body).toContain("Implements PROJ-1");
      expect(body).toContain(buildDedupMarker("do-ticket", { ticket: "PROJ-1" }));
    });

    test("succeeds without touching GitHub when the skill opened no PR", async () => {
      mockedRunAgent.mockResolvedValue(completedRun());

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
      expect(mockedPullsGet).not.toHaveBeenCalled();
    });

    test("rejects a PR URL that points at another repository", async () => {
      mockedRunAgent.mockResolvedValue(completedRun({ pullRequestUrl: "https://github.com/evil/app/pull/7" }));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedPullsGet).not.toHaveBeenCalled();
    });

    test.each([
      ["whose head is the default branch", { headRef: "main" }],
      ["whose head lives in a fork", { headRepo: "someone/app" }]
    ])("rejects a PR %s", async (_, overrides) => {
      mockedRunAgent.mockResolvedValue(completedRun({ pullRequestUrl: PR_URL }));
      mockedPullsGet.mockResolvedValue(pullRequest(overrides));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedAddLabels).not.toHaveBeenCalled();
    });

    test("still succeeds when labelling the PR fails", async () => {
      mockedRunAgent.mockResolvedValue(completedRun({ pullRequestUrl: PR_URL }));
      mockedAddLabels.mockRejectedValue(new Error("label API down"));

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
    });
  });

  describe("engine delivery", () => {
    beforeEach(() => {
      filesOnDisk(standardFiles({ delivery: SkillWorkflowDelivery.ENGINE }));
    });

    test("denies the skill its own git/PR delivery steps", async () => {
      mockedRunAgent.mockResolvedValue(completedRun());
      mockedCommitAndOpenPR.mockResolvedValue(PR_URL);

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedRunAgent.mock.calls[0][1]?.permissions?.deny).toEqual(
        expect.arrayContaining(["Bash(git commit*)", "Bash(git push*)", "Bash(gh pr create*)"])
      );
    });

    test("does not mint an agent token when no GitHub permissions are declared", async () => {
      mockedRunAgent.mockResolvedValue(completedRun());
      mockedCommitAndOpenPR.mockResolvedValue(PR_URL);

      await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(mockedCreateScopedToken).not.toHaveBeenCalled();
    });

    test("opens the PR itself with a review-followup-compatible body and the agent's commit metadata", async () => {
      mockedRunAgent.mockResolvedValue(
        completedRun({ commit: { type: "feat", subject: "add ticket view", branch: "ticket-view" } })
      );
      mockedCommitAndOpenPR.mockResolvedValue(PR_URL);

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: true });
      const [, body, commitMetadata] = mockedCommitAndOpenPR.mock.calls[0];
      expect(body).toMatch(/^Task:\n[\s\S]*\n\nGenerated automatically by Szumrak\./);
      expect(body).toContain(buildDedupMarker("do-ticket", { ticket: "PROJ-1" }));
      expect(commitMetadata).toMatchObject({ type: "feat", branchSlug: "ticket-view" });
    });

    test("does not open a PR when the verify gate fails", async () => {
      mockedRunAgent.mockResolvedValue(completedRun());
      mockedRunVerifyCommands.mockReturnValue({ passed: false, report: "$ npm run lint\nerror" });

      const result = await runSkillWorkflowFlow({ name: "do-ticket", rawInputs: INPUTS, rawSecrets: SECRETS });

      expect(result).toEqual({ succeeded: false });
      expect(mockedCommitAndOpenPR).not.toHaveBeenCalled();
    });
  });
});

describe("buildDedupMarker", () => {
  test("is independent of input key order", () => {
    expect(buildDedupMarker("x", { a: "1", b: "2" })).toBe(buildDedupMarker("x", { b: "2", a: "1" }));
  });

  test("never embeds raw input text in the HTML comment", () => {
    const marker = buildDedupMarker("x", { ticket: "--> <script>" });

    expect(marker).not.toContain("script");
    expect(marker).toMatch(/^<!-- szumrak-skill-workflow:x:[0-9a-f]{16} -->$/);
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
