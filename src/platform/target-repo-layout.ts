/**
 * Where Szumrak finds things in the target repo, relative to its root and
 * always `/`-separated — the same strings serve `join()`, SDK permission rules
 * (`Edit(.szumrak/config.json)`) and text shown to the model. Every
 * reference to these files goes through here: a path that drifted between
 * the loader and the deny list protecting it would fail silently.
 *
 * Szumrak's own configuration lives entirely under `.szumrak/`; only files
 * Claude Code itself reads (`.claude/settings.json`, `.claude/skills/`,
 * `.mcp.json`) stay where the SDK expects them.
 */
export const TargetRepoPath = {
  SZUMRAK_DIR: ".szumrak",
  AGENT_CONFIG: ".szumrak/config.json",
  SKILL_WORKFLOWS_DIR: ".szumrak/skill-workflows",
  SETTINGS: ".claude/settings.json",
  SKILLS_DIR: ".claude/skills",
  MCP_JSON: ".mcp.json"
} as const;

/** `.claude/skills/<skill>/SKILL.md` — the file whose presence makes `<skill>` invocable. */
export function skillFilePath(skill: string): string {
  return `${TargetRepoPath.SKILLS_DIR}/${skill}/SKILL.md`;
}

/** `.szumrak/skill-workflows/<name>.json` — a skill workflow's manifest. */
export function skillWorkflowManifestPath(name: string): string {
  return `${TargetRepoPath.SKILL_WORKFLOWS_DIR}/${name}.json`;
}
