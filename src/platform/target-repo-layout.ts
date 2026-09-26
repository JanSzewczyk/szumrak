/**
 * Where Szumrak finds things in the target repo, relative to its root and
 * always `/`-separated — the same strings serve `join()`, SDK permission rules
 * (`Edit(.claude/agent-config.json)`) and text shown to the model. Every
 * reference to these files goes through here: a path that drifted between
 * the loader and the deny list protecting it would fail silently.
 */
export const TargetRepoPath = {
  AGENT_CONFIG: ".claude/agent-config.json",
  SETTINGS: ".claude/settings.json",
  SKILLS_DIR: ".claude/skills",
  SZUMRAK_DIR: ".claude/szumrak",
  SKILL_WORKFLOWS_DIR: ".claude/szumrak/skill-workflows",
  MCP_JSON: ".mcp.json"
} as const;

/** `.claude/skills/<skill>/SKILL.md` — the file whose presence makes `<skill>` invocable. */
export function skillFilePath(skill: string): string {
  return `${TargetRepoPath.SKILLS_DIR}/${skill}/SKILL.md`;
}

/** `.claude/szumrak/skill-workflows/<name>.json` — a skill workflow's manifest. */
export function skillWorkflowManifestPath(name: string): string {
  return `${TargetRepoPath.SKILL_WORKFLOWS_DIR}/${name}.json`;
}
