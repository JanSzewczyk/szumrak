import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SkillWorkflowConfigError } from "~/flows/skill-workflow/errors";
import { loadSkillWorkflowManifest } from "~/flows/skill-workflow/manifest";

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
  secrets: ["JIRA_API_TOKEN"],
  mcpServers: {
    atlassian: ".mcp.json",
    sentry: { type: "http", url: "https://mcp.sentry.dev/mcp", headers: { Authorization: "Bearer token" } },
    local: { command: "npx", args: ["-y", "some-mcp"] }
  },
  setup: ["npm install -g @acme/cli"]
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
    ["a delivery setting, which no longer exists", { ...VALID_MANIFEST, delivery: "agent" }],
    ["an MCP server reference other than .mcp.json", { ...VALID_MANIFEST, mcpServers: { atlassian: "atlassian" } }],
    ["an MCP server with neither command nor url", { ...VALID_MANIFEST, mcpServers: { broken: { args: ["x"] } } }],
    ["a remote MCP server without a transport type", { ...VALID_MANIFEST, mcpServers: { r: { url: "https://x" } } }],
    ["an empty setup command", { ...VALID_MANIFEST, setup: [""] }],
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
