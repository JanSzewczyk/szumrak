import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAgentConfig } from "~/agent/agent-config";
import { type AgentRunResult, runAgent } from "~/agent/run-agent";
import { runVerifyCommands } from "~/agent/verify";
import { createScopedInstallationToken, octokit } from "~/github/client";
import { findOpenPRWithMarker } from "~/github/dedup";
import { configureGitRemoteAuth } from "~/github/git-operations";
import { commitAndOpenPR } from "~/github/pull-requests";
import { parseRepo } from "~/github/repo";
import { appendRunInfo } from "~/github/run-info";
import { env } from "~/platform/env";
import { log, registerSecretValues } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import { GitHubAccess, type ScopedTokenPermissions } from "~/types/github-access";
import type { FlowResult } from "../types";
import { resolveSkillWorkflowInputs, resolveSkillWorkflowSecrets } from "./inputs";
import {
  buildSkillWorkflowInstructions,
  buildSkillWorkflowPrompt,
  parseSkillWorkflowResult,
  SKILL_WORKFLOW_OUTPUT_FORMAT,
  type SkillWorkflowResult,
  SkillWorkflowStatus
} from "./instructions";
import {
  loadSkillWorkflowManifest,
  renderSkillArgs,
  SkillWorkflowConfigError,
  SkillWorkflowDelivery,
  type SkillWorkflowManifest
} from "./manifest";
import { resolveMcpServers } from "./mcp-servers";

export interface SkillWorkflowFlowInput {
  name: string;
  rawInputs: string;
  rawSecrets?: string;
}

/**
 * Enforced by Szumrak regardless of the manifest: the agent must not be able
 * to rewrite the configuration that decides what it's allowed to do.
 */
const PROTECTED_CONFIG_DENY = [
  "Edit(.claude/agent-config.json)",
  "Write(.claude/agent-config.json)",
  "Edit(.claude/szumrak/**)",
  "Write(.claude/szumrak/**)"
];

/**
 * Best-effort guardrails for `delivery: agent`. Prefix matching can't cover
 * every way to spell a push, so the real guard for the default branch is
 * GitHub branch protection — this only stops the obvious forms.
 */
const AGENT_DELIVERY_DENY = [
  "Bash(git push --force*)",
  "Bash(git push -f*)",
  "Bash(git push origin main*)",
  "Bash(git push origin master*)",
  "Bash(gh pr merge*)"
];

/**
 * With `delivery: engine` Szumrak commits the working tree afterwards; a
 * commit the skill made on its own would leave that tree clean and silently
 * produce no PR, so the delivery steps are denied outright, not just
 * discouraged in the prompt.
 */
const ENGINE_DELIVERY_DENY = [
  "Bash(git commit*)",
  "Bash(git push*)",
  "Bash(git checkout -b*)",
  "Bash(git switch -c*)",
  "Bash(gh pr create*)"
];

const AGENT_DELIVERY_DEFAULT_PERMISSIONS: ScopedTokenPermissions = {
  contents: GitHubAccess.WRITE,
  pull_requests: GitHubAccess.WRITE
};

const PULL_REQUEST_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

/**
 * Invisible marker Szumrak appends to every PR a skill workflow produces, so a
 * re-run with the same inputs (e.g. the same ticket) is skipped while that PR
 * is still open. Hashed so untrusted input text never lands in the HTML
 * comment itself (a `-->` in an input would otherwise end it early).
 */
export function buildDedupMarker(name: string, inputs: Record<string, string>): string {
  const sortedInputs = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
  const hash = createHash("sha256").update(JSON.stringify(sortedInputs)).digest("hex").slice(0, 16);
  return `<!-- szumrak-skill-workflow:${name}:${hash} -->`;
}

export function withEntrySkill(skills: Array<string> | "all" | undefined, entrySkill: string): Array<string> | "all" {
  if (skills === "all") {
    return "all";
  }
  if (skills?.includes(entrySkill)) {
    return skills;
  }
  return [...(skills ?? []), entrySkill];
}

function fail(message: string, event: string, data: Record<string, unknown> = {}): FlowResult {
  log(event, { ...data, message });
  console.error(message);
  writeStepSummary(message);
  return { succeeded: false };
}

/**
 * Mints the agent's own GitHub credentials: a token scoped to this repo and to
 * the manifest's permissions, exported as GH_TOKEN/GITHUB_TOKEN for `gh` and
 * embedded in the git remote for `git push`. None in a dry run — there is
 * nothing the agent may deliver then.
 */
async function prepareGitHubAccess(
  manifest: SkillWorkflowManifest,
  owner: string,
  repo: string
): Promise<Record<string, string>> {
  const permissions =
    manifest.github?.permissions ??
    (manifest.delivery === SkillWorkflowDelivery.AGENT ? AGENT_DELIVERY_DEFAULT_PERMISSIONS : undefined);
  if (!permissions || env.DRY_RUN) {
    return {};
  }

  const token = await createScopedInstallationToken(repo, permissions);
  registerSecretValues([token]);
  if (permissions.contents === GitHubAccess.WRITE) {
    await configureGitRemoteAuth(owner, repo, token);
  }
  log("skill_workflow_github_token", { permissions });
  return { GH_TOKEN: token, GITHUB_TOKEN: token };
}

async function deliverByAgent(
  name: string,
  workflowResult: SkillWorkflowResult,
  runResult: AgentRunResult,
  marker: string
): Promise<FlowResult> {
  if (env.DRY_RUN) {
    log("dry_run_active", { note: "Skill workflow ran with delivery disabled." });
    writeStepSummary(`Skill workflow **${name}** finished (dry run).\n\n${workflowResult.summary}`, "✅");
    return { succeeded: true };
  }

  if (!workflowResult.pullRequestUrl) {
    log("skill_workflow_no_pull_request", { name });
    writeStepSummary(
      `Skill workflow **${name}** completed without opening a pull request.\n\n${workflowResult.summary}`,
      "ℹ️"
    );
    return { succeeded: true };
  }

  const { owner, repo } = parseRepo(env.REPO);
  const match = workflowResult.pullRequestUrl.match(PULL_REQUEST_URL_PATTERN);
  if (!match || match[1].toLowerCase() !== owner.toLowerCase() || match[2].toLowerCase() !== repo.toLowerCase()) {
    return fail(
      `Skill workflow **${name}** reported a pull request outside ${owner}/${repo}: ${workflowResult.pullRequestUrl}`,
      "skill_workflow_foreign_pull_request"
    );
  }

  const pullNumber = Number(match[3]);
  const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: pullNumber });
  if (pr.head.ref === pr.base.repo.default_branch || pr.head.repo?.full_name !== pr.base.repo.full_name) {
    return fail(
      `Skill workflow **${name}** reported pull request #${pullNumber}, but its head branch is not a branch of this repo other than the default branch`,
      "skill_workflow_unexpected_pull_request"
    );
  }

  /**
   * Best-effort: the PR already exists and is the real deliverable, so failing
   * to label it or to append the cost table must not fail the run.
   */
  await octokit.issues
    .addLabels({ owner, repo, issue_number: pullNumber, labels: ["ai-generated"] })
    .catch((err) => log("skill_workflow_label_failed", { pullNumber, error: String(err) }));
  const body = appendRunInfo(`${pr.body ?? ""}\n\n${marker}`, undefined, 0, {
    totalCostUsd: runResult.totalCostUsd,
    numTurns: runResult.numTurns
  });
  await octokit.pulls
    .update({ owner, repo, pull_number: pullNumber, body })
    .catch((err) => log("skill_workflow_pr_body_update_failed", { pullNumber, error: String(err) }));

  log("skill_workflow_delivered", { name, url: pr.html_url });
  writeStepSummary(`Skill workflow **${name}** opened ${pr.html_url}\n\n${workflowResult.summary}`, "✅");
  return { succeeded: true };
}

async function deliverByEngine(
  name: string,
  manifest: SkillWorkflowManifest,
  inputs: Record<string, string>,
  workflowResult: SkillWorkflowResult,
  runResult: AgentRunResult,
  marker: string
): Promise<FlowResult> {
  const { verify } = loadAgentConfig(env.WORKSPACE_PATH);
  if (verify && verify.length > 0) {
    const outcome = runVerifyCommands(verify, env.WORKSPACE_PATH);
    if (!outcome.passed) {
      log("verify_gate_failed", { report: outcome.report });
      writeStepSummary(`Verification failed after the agent run:\n\n\`\`\`\n${outcome.report.slice(0, 1500)}\n\`\`\``);
      return { succeeded: false };
    }
  }

  if (env.DRY_RUN) {
    log("dry_run_active", { note: "Changes are left on disk; no PR will be created." });
    writeStepSummary(`Skill workflow **${name}** finished (dry run).\n\n${workflowResult.summary}`, "✅");
    return { succeeded: true };
  }

  /**
   * Keeps the "Task:\n...\n\nGenerated automatically by Szumrak." prefix that
   * flows/review-followup parses the original task back out of, so review
   * follow-ups on this PR get the same context as on a MODE=runner PR.
   */
  const task = `Run skill workflow "${name}" (skill "${manifest.skill}") with inputs:\n${JSON.stringify(inputs, null, 2)}`;
  const body = appendRunInfo(
    `Task:\n${task}\n\nGenerated automatically by Szumrak.\n\nModel summary:\n${workflowResult.summary}\n\n${marker}`,
    undefined,
    0,
    { totalCostUsd: runResult.totalCostUsd, numTurns: runResult.numTurns }
  );

  const prUrl = await commitAndOpenPR(`skill workflow ${name}`, body, workflowResult.commit);
  if (!prUrl) {
    writeStepSummary(`Skill workflow **${name}** completed with no file changes.\n\n${workflowResult.summary}`, "ℹ️");
    return { succeeded: true };
  }

  writeStepSummary(`Skill workflow **${name}** opened ${prUrl}\n\n${workflowResult.summary}`, "✅");
  return { succeeded: true };
}

/**
 * The skill-workflow flow (`MODE=skill-workflow`): runs a skill that lives in
 * the target repo end to end — e.g. "fetch a Jira ticket, implement it, open
 * a PR" — described by `.claude/szumrak/skill-workflows/<name>.json`. The
 * manifest says what the run needs (inputs, secrets, MCP servers, GitHub
 * permissions) and who delivers the result (`delivery`); Szumrak prepares
 * exactly that environment, runs the skill, and checks the outcome.
 */
export async function runSkillWorkflowFlow({
  name,
  rawInputs,
  rawSecrets
}: SkillWorkflowFlowInput): Promise<FlowResult> {
  let manifest: SkillWorkflowManifest;
  let inputs: Record<string, string>;
  let secrets: Record<string, string>;
  let mcpServers: ReturnType<typeof resolveMcpServers>;
  try {
    manifest = loadSkillWorkflowManifest(env.WORKSPACE_PATH, name);
    inputs = resolveSkillWorkflowInputs(manifest, rawInputs);
    secrets = resolveSkillWorkflowSecrets(manifest, rawSecrets);
    registerSecretValues(Object.values(secrets));
    if (!existsSync(join(env.WORKSPACE_PATH, ".claude", "skills", manifest.skill, "SKILL.md"))) {
      throw new SkillWorkflowConfigError(
        `Skill "${manifest.skill}" not found at .claude/skills/${manifest.skill}/SKILL.md`
      );
    }
    mcpServers = resolveMcpServers(env.WORKSPACE_PATH, manifest.mcpServers, secrets);
  } catch (err) {
    if (err instanceof SkillWorkflowConfigError) {
      return fail(`Skill workflow **${name}** is misconfigured: ${err.message}`, "skill_workflow_config_invalid");
    }
    throw err;
  }

  log("skill_workflow_start", {
    name,
    skill: manifest.skill,
    delivery: manifest.delivery,
    inputs: Object.keys(inputs),
    secrets: manifest.secrets,
    agentEnv: manifest.agentEnv,
    mcpServers: manifest.mcpServers
  });

  const marker = buildDedupMarker(name, inputs);
  const githubEnv: Record<string, string> = {};
  if (!env.DRY_RUN) {
    const { owner, repo } = parseRepo(env.REPO);
    const existingPRUrl = await findOpenPRWithMarker(owner, repo, marker);
    if (existingPRUrl) {
      writeStepSummary(`Skipped — an open PR already exists for these inputs: ${existingPRUrl}`, "ℹ️");
      return { succeeded: true };
    }
    Object.assign(githubEnv, await prepareGitHubAccess(manifest, owner, repo));
  }

  const agentEnv: Record<string, string> = {
    ...Object.fromEntries(manifest.agentEnv.map((secretName) => [secretName, secrets[secretName]])),
    ...githubEnv,
    /** No TTY in CI: a credential or confirmation prompt must fail fast, not hang until MAX_DURATION_MS. */
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0"
  };

  const result = await runAgent(
    buildSkillWorkflowPrompt(manifest.skill, renderSkillArgs(manifest.args ?? "", inputs), inputs),
    {
      systemPromptAppend: buildSkillWorkflowInstructions(manifest.delivery, env.DRY_RUN),
      model: manifest.model,
      maxTurns: manifest.maxTurns,
      maxDurationMs: manifest.maxDurationMinutes !== undefined ? manifest.maxDurationMinutes * 60 * 1000 : undefined,
      maxBudgetUsd: manifest.maxBudgetUsd,
      env: agentEnv,
      permissions: {
        allow: manifest.permissions?.allow,
        deny: [
          ...PROTECTED_CONFIG_DENY,
          ...(manifest.delivery === SkillWorkflowDelivery.AGENT ? AGENT_DELIVERY_DENY : ENGINE_DELIVERY_DENY),
          ...(manifest.permissions?.deny ?? [])
        ]
      },
      skills: withEntrySkill(manifest.skills ?? loadAgentConfig(env.WORKSPACE_PATH).skills, manifest.skill),
      mcpServers: manifest.mcpServers.length > 0 ? mcpServers : undefined,
      outputFormat: SKILL_WORKFLOW_OUTPUT_FORMAT
    }
  );

  if (!result.succeeded) {
    return fail(
      `Skill workflow **${name}** did not complete successfully: ${result.finalMessage.slice(0, 300)}`,
      "agent_run_failed"
    );
  }

  const workflowResult = parseSkillWorkflowResult(result.structuredOutput);
  if (!workflowResult) {
    return fail(`Skill workflow **${name}** finished without a structured result.`, "skill_workflow_result_missing");
  }
  log("skill_workflow_result", { ...workflowResult });

  if (workflowResult.status === SkillWorkflowStatus.BLOCKED) {
    log("skill_workflow_blocked", { name });
    writeStepSummary(`Skill workflow **${name}** is blocked and needs a human:\n\n${workflowResult.summary}`, "⚠️");
    return { succeeded: false };
  }

  if (manifest.delivery === SkillWorkflowDelivery.AGENT) {
    return deliverByAgent(name, workflowResult, result, marker);
  }
  return deliverByEngine(name, manifest, inputs, workflowResult, result, marker);
}
