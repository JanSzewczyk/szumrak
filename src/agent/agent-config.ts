import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "~/platform/logger";

export interface AgentPermissions {
  allow?: Array<string>;
  deny?: Array<string>;
}

/**
 * Per-target-repo agent configuration, committed by the target repo as
 * `.claude/agent-config.json`. Deliberately separate from the repo's own
 * `.claude/settings.json`, which governs interactive Claude Code sessions
 * (hooks, personal permissions) and isn't meant to double as the unattended
 * agent's sandbox.
 *
 * - `permissions.allow`/`permissions.deny` → SDK `allowedTools`/`disallowedTools`.
 * - `skills` → SDK `skills` option: `"all"` enables every skill discovered in
 *   the target repo, an array whitelists by name. The model picks skills
 *   autonomously from their SKILL.md name/description — this field only
 *   controls which are visible.
 * - `verify` → shell-free commands (see agent/verify.ts) run by the Stop hook
 *   in run-agent.ts and the final gate in the runner flow.
 */
export interface AgentConfig {
  permissions?: AgentPermissions;
  skills?: Array<string> | "all";
  verify?: Array<string>;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    log("agent_config_invalid", { path, error: String(err) });
    return undefined;
  }
}

function asStringArray(value: unknown): Array<string> | undefined {
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as Array<string>;
  }
  return undefined;
}

function asPermissions(value: unknown): AgentPermissions | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const { allow, deny } = value as Record<string, unknown>;
  const permissions: AgentPermissions = { allow: asStringArray(allow), deny: asStringArray(deny) };
  return permissions.allow || permissions.deny ? permissions : undefined;
}

function asSkills(value: unknown): Array<string> | "all" | undefined {
  if (value === "all") {
    return "all";
  }
  return asStringArray(value);
}

/**
 * Loads the target repo's `.claude/agent-config.json` (see {@link AgentConfig}).
 * A missing or invalid file means "no extra restriction beyond permissionMode,
 * no skills, no verify commands" — it never throws.
 */
export function loadAgentConfig(workspacePath: string): AgentConfig {
  const configPath = join(workspacePath, ".claude", "agent-config.json");
  if (!existsSync(configPath)) {
    return {};
  }
  const raw = readJson(configPath);
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const { permissions, skills, verify } = raw as Record<string, unknown>;
  return {
    permissions: asPermissions(permissions),
    skills: asSkills(skills),
    verify: asStringArray(verify)
  };
}
