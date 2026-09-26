import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadAgentConfig } from "~/agent/agent-config";
import { runAgent } from "~/agent/run-agent";
import { createScopedInstallationToken } from "~/github/client";
import { configureGitRemoteAuth } from "~/github/git-operations";
import { parseRepo } from "~/github/repo";
import { env } from "~/platform/env";
import { log, registerSecretValues } from "~/platform/logger";
import { writeStepSummary } from "~/platform/summary";
import { skillFilePath, TargetRepoPath } from "~/platform/target-repo-layout";
import type { FlowResult } from "~/types/flow-result";
import { GitHubAccess } from "~/types/github-access";
import { SkillWorkflowConfigError, SkillWorkflowSetupError } from "./errors";
import { resolveSkillWorkflowInputs, resolveSkillWorkflowSecrets } from "./inputs";
import {
  buildSkillWorkflowInstructions,
  buildSkillWorkflowPrompt,
  parseSkillWorkflowResult,
  SKILL_WORKFLOW_OUTPUT_FORMAT,
  SkillWorkflowStatus
} from "./instructions";
import { loadSkillWorkflowManifest } from "./manifest";
import type { SkillWorkflowManifest } from "./manifest-schema";
import { resolveMcpServers } from "./mcp-servers";
import { runSkillWorkflowSetup } from "./setup";
import { renderSkillArgs } from "./skill-args";

export interface SkillWorkflowFlowInput {
  name: string;
  rawInputs: string;
  rawSecrets?: string;
}

/**
 * Enforced by Szumrak regardless of the manifest: the agent must not be able
 * to rewrite the configuration that decides what it's allowed to do.
 */
const PROTECTED_CONFIG_DENY = [`Edit(${TargetRepoPath.SZUMRAK_DIR}/**)`, `Write(${TargetRepoPath.SZUMRAK_DIR}/**)`];

/**
 * Best-effort guardrails for whatever the skill does with git. Prefix matching
 * can't cover every way to spell a push, so the real guard for the default
 * branch is GitHub branch protection — this only stops the obvious forms.
 */
const GIT_SAFETY_DENY = [
  "Bash(git push --force*)",
  "Bash(git push -f*)",
  "Bash(git push origin main*)",
  "Bash(git push origin master*)",
  "Bash(gh pr merge*)"
];

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
 * Mints the agent's own GitHub credentials, only when the manifest asks for
 * `github.permissions`: a token scoped to this repo and to exactly those
 * permissions, exported as GH_TOKEN/GITHUB_TOKEN for `gh` and embedded in the
 * git remote for `git push`. None in a dry run.
 */
async function prepareGitHubAccess(manifest: SkillWorkflowManifest): Promise<Record<string, string>> {
  const permissions = manifest.github?.permissions;
  if (!permissions || env.DRY_RUN) {
    return {};
  }

  const { owner, repo } = parseRepo(env.REPO);
  const token = await createScopedInstallationToken(repo, permissions);
  registerSecretValues([token]);
  if (permissions.contents === GitHubAccess.WRITE) {
    await configureGitRemoteAuth(owner, repo, token);
  }
  log("skill_workflow_github_token", { permissions });
  return { GH_TOKEN: token, GITHUB_TOKEN: token };
}

/**
 * The skill-workflow flow (`MODE=skill-workflow`): runs a skill that lives in
 * the target repo end to end, described by
 * `.szumrak/skill-workflows/<name>.json`. The skill owns the whole
 * process — including whether it opens a PR, comments on a ticket or produces
 * nothing outside the session. Szumrak only orchestrates: it prepares exactly
 * the environment the manifest declares (inputs, secrets, setup commands, MCP
 * servers, GitHub permissions), runs the skill under its guardrails, and
 * reports the skill's own completed/blocked result.
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
    inputs = resolveSkillWorkflowInputs(manifest.inputs, rawInputs);
    secrets = resolveSkillWorkflowSecrets(manifest.secrets, rawSecrets);
    registerSecretValues(Object.values(secrets));

    if (!existsSync(join(env.WORKSPACE_PATH, skillFilePath(manifest.skill)))) {
      throw new SkillWorkflowConfigError(`Skill "${manifest.skill}" not found at ${skillFilePath(manifest.skill)}`);
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
    inputs: Object.keys(inputs),
    secrets: manifest.secrets,
    agentEnv: manifest.agentEnv,
    mcpServers: Object.keys(mcpServers),
    setup: manifest.setup.length
  });

  try {
    runSkillWorkflowSetup(manifest.setup, env.WORKSPACE_PATH);
  } catch (err) {
    if (err instanceof SkillWorkflowSetupError) {
      return fail(`Skill workflow **${name}** setup failed: ${err.message}`, "skill_workflow_setup_failed");
    }
    throw err;
  }

  const agentEnv: Record<string, string> = {
    ...Object.fromEntries(manifest.agentEnv.map((secretName) => [secretName, secrets[secretName]])),
    ...(await prepareGitHubAccess(manifest)),
    /** No TTY in CI: a credential or confirmation prompt must fail fast, not hang until MAX_DURATION_MS. */
    GH_PROMPT_DISABLED: "1",
    GIT_TERMINAL_PROMPT: "0"
  };

  const result = await runAgent(
    buildSkillWorkflowPrompt(manifest.skill, renderSkillArgs(manifest.args ?? "", inputs), inputs),
    {
      systemPromptAppend: buildSkillWorkflowInstructions(env.DRY_RUN),
      model: manifest.model,
      maxTurns: manifest.maxTurns,
      maxDurationMs: manifest.maxDurationMinutes !== undefined ? manifest.maxDurationMinutes * 60 * 1000 : undefined,
      maxBudgetUsd: manifest.maxBudgetUsd,
      env: agentEnv,
      permissions: {
        allow: manifest.permissions?.allow,
        deny: [...PROTECTED_CONFIG_DENY, ...GIT_SAFETY_DENY, ...(manifest.permissions?.deny ?? [])]
      },
      skills: withEntrySkill(manifest.skills ?? loadAgentConfig(env.WORKSPACE_PATH).skills, manifest.skill),
      mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
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

  log("skill_workflow_completed", { name });
  const dryRunNote = env.DRY_RUN ? " (dry run)" : "";
  writeStepSummary(`Skill workflow **${name}** completed${dryRunNote}.\n\n${workflowResult.summary}`, "✅");
  return { succeeded: true };
}
