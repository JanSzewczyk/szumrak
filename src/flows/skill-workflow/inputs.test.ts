import { SkillWorkflowConfigError } from "~/flows/skill-workflow/errors";
import { resolveSkillWorkflowInputs, resolveSkillWorkflowSecrets } from "~/flows/skill-workflow/inputs";

const INPUT_DEFINITIONS = {
  ticket: { required: true, pattern: "[A-Z]+-\\d+", maxLength: 20 },
  hint: { required: false, maxLength: 10 }
};

describe("resolveSkillWorkflowInputs", () => {
  test("returns declared inputs as strings", () => {
    const inputs = resolveSkillWorkflowInputs(INPUT_DEFINITIONS, JSON.stringify({ ticket: "PROJ-12", hint: 42 }));

    expect(inputs).toEqual({ ticket: "PROJ-12", hint: "42" });
  });

  test("treats an empty string as not given", () => {
    const inputs = resolveSkillWorkflowInputs(INPUT_DEFINITIONS, JSON.stringify({ ticket: "PROJ-12", hint: "" }));

    expect(inputs).toEqual({ ticket: "PROJ-12" });
  });

  test.each([
    ["a missing required input", { hint: "x" }, /"ticket" is required/],
    ["an undeclared input", { ticket: "PROJ-1", extra: "x" }, /unknown input "extra"/],
    ["a value not matching the whole pattern", { ticket: "PROJ-1; rm -rf /" }, /does not match/],
    ["a value over maxLength", { ticket: "PROJ-1", hint: "12345678901" }, /exceeds 10 characters/],
    ["a non-scalar value", { ticket: ["PROJ-1"] }, /must be a string, number or boolean/]
  ])("rejects %s", (_, given, message) => {
    expect(() => resolveSkillWorkflowInputs(INPUT_DEFINITIONS, JSON.stringify(given))).toThrow(message);
  });

  test.each([
    ["invalid JSON", "{ticket"],
    ["a JSON array", "[]"]
  ])("rejects %s", (_, raw) => {
    expect(() => resolveSkillWorkflowInputs(INPUT_DEFINITIONS, raw)).toThrow(SkillWorkflowConfigError);
  });
});

describe("resolveSkillWorkflowSecrets", () => {
  test("returns only the declared secrets", () => {
    const declared = ["JIRA_API_TOKEN"];

    const secrets = resolveSkillWorkflowSecrets(declared, JSON.stringify({ JIRA_API_TOKEN: "t0ken", OTHER: "x" }));

    expect(secrets).toEqual({ JIRA_API_TOKEN: "t0ken" });
  });

  test("names missing or empty secrets without leaking any value", () => {
    const declared = ["JIRA_API_TOKEN", "JIRA_EMAIL"];

    expect(() => resolveSkillWorkflowSecrets(declared, JSON.stringify({ JIRA_API_TOKEN: "" }))).toThrow(
      /JIRA_API_TOKEN, JIRA_EMAIL/
    );
  });

  test("accepts an unset secrets variable when nothing is declared", () => {
    expect(resolveSkillWorkflowSecrets([], undefined)).toEqual({});
  });
});
