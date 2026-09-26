import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadSkillWorkflowManifest,
  renderSkillArgs,
  SkillWorkflowConfigError,
  SkillWorkflowDelivery
} from "~/flows/skill-workflow/manifest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const MANIFEST_PATH = join("/workspace", ".claude", "szumrak", "skill-workflows", "do-ticket.json");

function manifestOnDisk(content: unknown) {
  mockedExistsSync.mockImplementation((candidate) => candidate === MANIFEST_PATH);
  mockedReadFileSync.mockReturnValue(typeof content === "string" ? content : JSON.stringify(content));
}

const VALID_MANIFEST = {
  skill: "do-ticket",
  args: "{{inputs.ticket}}",
  inputs: { ticket: { required: true, pattern: "[A-Z]+-\\d+" } },
  delivery: SkillWorkflowDelivery.AGENT,
  secrets: ["JIRA_API_TOKEN"],
  mcpServers: ["atlassian"]
};

describe("loadSkillWorkflowManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns the parsed manifest with defaults applied", () => {
    manifestOnDisk(VALID_MANIFEST);

    const manifest = loadSkillWorkflowManifest("/workspace", "do-ticket");

    expect(manifest).toMatchObject({
      skill: "do-ticket",
      delivery: SkillWorkflowDelivery.AGENT,
      agentEnv: [],
      inputs: { ticket: { required: true, maxLength: 500 } }
    });
  });

  test("throws a config error naming the path when the manifest is missing", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(() => loadSkillWorkflowManifest("/workspace", "do-ticket")).toThrow(SkillWorkflowConfigError);
    expect(() => loadSkillWorkflowManifest("/workspace", "do-ticket")).toThrow(/do-ticket\.json/);
  });

  test("throws a config error for invalid JSON", () => {
    manifestOnDisk("{ not json");

    expect(() => loadSkillWorkflowManifest("/workspace", "do-ticket")).toThrow(/not valid JSON/);
  });

  test.each([
    ["an unknown key", { ...VALID_MANIFEST, maxturns: 10 }],
    ["a missing delivery", { ...VALID_MANIFEST, delivery: undefined }],
    ["an agentEnv entry not listed in secrets", { ...VALID_MANIFEST, agentEnv: ["GH_ENTERPRISE_TOKEN"] }],
    ["an args placeholder for an undeclared input", { ...VALID_MANIFEST, args: "{{inputs.project}}" }],
    ["an invalid input pattern", { ...VALID_MANIFEST, inputs: { ticket: { pattern: "[" } } }],
    ["a lowercase secret name", { ...VALID_MANIFEST, secrets: ["jira_token"] }],
    ["Szumrak's own App key as a secret", { ...VALID_MANIFEST, secrets: ["GH_APP_PRIVATE_KEY"] }],
    ["the Claude credential as a secret", { ...VALID_MANIFEST, secrets: ["ANTHROPIC_API_KEY"] }]
  ])("rejects a manifest with %s", (_, manifest) => {
    manifestOnDisk(manifest);

    expect(() => loadSkillWorkflowManifest("/workspace", "do-ticket")).toThrow(SkillWorkflowConfigError);
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
