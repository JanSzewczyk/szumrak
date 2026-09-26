import { listInputPlaceholders, renderSkillArgs } from "~/flows/skill-workflow/skill-args";

describe("listInputPlaceholders", () => {
  test("returns every referenced input name, tolerating whitespace inside the braces", () => {
    expect(listInputPlaceholders("{{inputs.ticket}} --hint {{ inputs.hint }}")).toEqual(["ticket", "hint"]);
  });

  test("ignores text that is not an input placeholder", () => {
    expect(listInputPlaceholders("{{secrets.TOKEN}} {inputs.ticket} plain")).toEqual([]);
  });
});

describe("renderSkillArgs", () => {
  test("fills declared placeholders and tolerates whitespace inside the braces", () => {
    expect(renderSkillArgs("{{inputs.ticket}} --hint {{ inputs.hint }}", { ticket: "PROJ-1", hint: "x" })).toBe(
      "PROJ-1 --hint x"
    );
  });

  test("renders an absent optional input as an empty string", () => {
    expect(renderSkillArgs("{{inputs.ticket}} {{inputs.hint}}", { ticket: "PROJ-1" })).toBe("PROJ-1");
  });
});
