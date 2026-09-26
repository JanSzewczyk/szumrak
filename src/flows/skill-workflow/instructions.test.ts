import {
  buildSkillWorkflowInstructions,
  buildSkillWorkflowPrompt,
  parseSkillWorkflowResult,
  SkillWorkflowStatus
} from "~/flows/skill-workflow/instructions";

describe("parseSkillWorkflowResult", () => {
  test("parses a completed result", () => {
    const result = parseSkillWorkflowResult({
      status: SkillWorkflowStatus.COMPLETED,
      summary: "Implemented PROJ-1 in https://github.com/acme/app/pull/7"
    });

    expect(result).toEqual({
      status: SkillWorkflowStatus.COMPLETED,
      summary: "Implemented PROJ-1 in https://github.com/acme/app/pull/7"
    });
  });

  test.each([
    ["no output", undefined],
    ["an unknown status", { status: "done", summary: "x" }],
    ["a missing summary", { status: SkillWorkflowStatus.BLOCKED }]
  ])("returns undefined for %s", (_, output) => {
    expect(parseSkillWorkflowResult(output)).toBeUndefined();
  });
});

describe("buildSkillWorkflowInstructions", () => {
  test("adds git guardrails without telling the skill to open a pull request", () => {
    const instructions = buildSkillWorkflowInstructions(false);

    expect(instructions).toContain("never commit or push to the default branch");
    expect(instructions).not.toMatch(/open the pull request/i);
    expect(instructions).not.toContain("DRY RUN");
  });

  test("adds dry-run rules in a dry run", () => {
    expect(buildSkillWorkflowInstructions(true)).toContain("DRY RUN");
  });
});

describe("buildSkillWorkflowPrompt", () => {
  test("names the skill, its arguments and the inputs as data", () => {
    const prompt = buildSkillWorkflowPrompt("do-ticket", "PROJ-1", { ticket: "PROJ-1" });

    expect(prompt).toContain("`do-ticket` skill");
    expect(prompt).toContain("Skill arguments: PROJ-1");
    expect(prompt).toContain('"ticket": "PROJ-1"');
  });
});
