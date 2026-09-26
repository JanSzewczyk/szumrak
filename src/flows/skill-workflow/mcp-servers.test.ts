// biome-ignore-all lint/suspicious/noTemplateCurlyInString: literal `${VAR}` is the .mcp.json expansion syntax under test
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SkillWorkflowConfigError } from "~/flows/skill-workflow/manifest";
import { resolveMcpServers } from "~/flows/skill-workflow/mcp-servers";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

const MCP_PATH = join("/workspace", ".mcp.json");

function mcpJsonOnDisk(mcpServers: Record<string, unknown>) {
  mockedExistsSync.mockImplementation((candidate) => candidate === MCP_PATH);
  mockedReadFileSync.mockReturnValue(JSON.stringify({ mcpServers }));
}

describe("resolveMcpServers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns nothing and reads no file when no servers are required", () => {
    expect(resolveMcpServers("/workspace", [], {})).toEqual({});
    expect(mockedExistsSync).not.toHaveBeenCalled();
  });

  test("picks only the named servers and expands declared secrets", () => {
    mcpJsonOnDisk({
      atlassian: {
        command: "npx",
        args: ["-y", "mcp-atlassian", "--url", "${JIRA_URL}"],
        env: { JIRA_API_TOKEN: "${JIRA_API_TOKEN}", LOG_LEVEL: "${LOG_LEVEL:-warn}" }
      },
      unrelated: { command: "other" }
    });

    const servers = resolveMcpServers("/workspace", ["atlassian"], {
      JIRA_URL: "https://acme.atlassian.net",
      JIRA_API_TOKEN: "t0ken"
    });

    expect(servers).toEqual({
      atlassian: {
        command: "npx",
        args: ["-y", "mcp-atlassian", "--url", "https://acme.atlassian.net"],
        env: { JIRA_API_TOKEN: "t0ken", LOG_LEVEL: "warn" }
      }
    });
  });

  test("expands variables in an HTTP server's headers", () => {
    mcpJsonOnDisk({
      remote: { type: "http", url: "https://mcp.example.com", headers: { Authorization: "Bearer ${TOKEN}" } }
    });

    const servers = resolveMcpServers("/workspace", ["remote"], { TOKEN: "abc123" });

    expect(servers.remote).toMatchObject({ headers: { Authorization: "Bearer abc123" } });
  });

  test("refuses a reference to a variable the manifest does not declare", () => {
    mcpJsonOnDisk({ atlassian: { command: "npx", env: { TOKEN: "${GH_APP_PRIVATE_KEY}" } } });

    expect(() => resolveMcpServers("/workspace", ["atlassian"], {})).toThrow(/GH_APP_PRIVATE_KEY/);
  });

  test.each([
    ["the .mcp.json file is missing", () => mockedExistsSync.mockReturnValue(false), /\.mcp\.json is missing/],
    ["the server is not defined", () => mcpJsonOnDisk({ other: { command: "x" } }), /"atlassian" is not defined/],
    [
      ".mcp.json is not valid JSON",
      () => {
        mockedExistsSync.mockReturnValue(true);
        mockedReadFileSync.mockReturnValue("{");
      },
      /not valid JSON/
    ]
  ])("throws a config error when %s", (_, arrange, message) => {
    arrange();

    expect(() => resolveMcpServers("/workspace", ["atlassian"], {})).toThrow(SkillWorkflowConfigError);
    expect(() => resolveMcpServers("/workspace", ["atlassian"], {})).toThrow(message);
  });
});
