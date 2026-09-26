import { skillFilePath, skillWorkflowManifestPath, TargetRepoPath } from "~/platform/target-repo-layout";

describe("TargetRepoPath", () => {
  test("keeps skill workflow manifests under the Szumrak directory the agent is denied from editing", () => {
    expect(TargetRepoPath.SKILL_WORKFLOWS_DIR.startsWith(`${TargetRepoPath.SZUMRAK_DIR}/`)).toBe(true);
  });

  test("uses only forward slashes, so paths are valid inside SDK permission rules", () => {
    expect(Object.values(TargetRepoPath).filter((path) => path.includes("\\"))).toEqual([]);
  });
});

describe("skillFilePath", () => {
  test("points at the skill's SKILL.md inside the skills directory", () => {
    expect(skillFilePath("do-ticket")).toBe(".claude/skills/do-ticket/SKILL.md");
  });
});

describe("skillWorkflowManifestPath", () => {
  test("points at the named JSON manifest inside the skill workflows directory", () => {
    expect(skillWorkflowManifestPath("do-ticket")).toBe(".claude/szumrak/skill-workflows/do-ticket.json");
  });
});
