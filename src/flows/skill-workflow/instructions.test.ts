import {
  buildSkillWorkflowInstructions,
  buildSkillWorkflowPrompt,
  parseSkillWorkflowResult,
  SkillWorkflowStatus
} from "~/flows/skill-workflow/instructions";
import { SkillWorkflowDelivery } from "~/flows/skill-workflow/manifest";

describe("parseSkillWorkflowResult", () => {
  test("parses a completed result with a pull request URL", () => {
    const result = parseSkillWorkflowResult({
      status: SkillWorkflowStatus.COMPLETED,
      summary: "Implemented PROJ-1",
      pullRequestUrl: "https://github.com/acme/app/pull/7"
    });

    expect(result).toEqual({
      status: SkillWorkflowStatus.COMPLETED,
      summary: "Implemented PROJ-1",
      pullRequestUrl: "https://github.com/acme/app/pull/7",
      commit: undefined
    });
  });

  test("normalizes commit fields into commit metadata", () => {
    const result = parseSkillWorkflowResult({
      status: SkillWorkflowStatus.COMPLETED,
      summary: "done",
      commit: { type: "feat", scope: "tickets", subject: "add ticket view", branch: "Add Ticket View!" }
    });

    expect(result?.commit).toEqual({
      type: "feat",
      scope: "tickets",
      subject: "add ticket view",
      branchSlug: "add-ticket-view"
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
  test("lets the skill deliver the PR itself for agent delivery", () => {
    const instructions = buildSkillWorkflowInstructions(SkillWorkflowDelivery.AGENT, false);

    expect(instructions).toContain("The skill owns delivery");
    expect(instructions).not.toContain("DRY RUN");
  });

  test("forbids git delivery steps for engine delivery", () => {
    expect(buildSkillWorkflowInstructions(SkillWorkflowDelivery.ENGINE, false)).toContain("Szumrak owns delivery");
  });

  test("adds dry-run rules in a dry run", () => {
    expect(buildSkillWorkflowInstructions(SkillWorkflowDelivery.AGENT, true)).toContain("DRY RUN");
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
