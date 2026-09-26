import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { TargetRepoPath } from "~/platform/target-repo-layout";
import { SkillWorkflowConfigError } from "./errors";

/** Value of a `mcpServers` entry that takes the server's definition from the target repo's `.mcp.json`. */
const MCP_JSON_REFERENCE = TargetRepoPath.MCP_JSON;

const McpTransport = {
  STDIO: "stdio",
  HTTP: "http",
  SSE: "sse"
} as const;

const StringMap = z.record(z.string(), z.string());

/**
 * An MCP server defined inline in the manifest, for repos without a `.mcp.json`
 * (or when the workflow needs a server developers don't use interactively).
 * The same shapes as `.mcp.json` entries — process (stdio) or remote (http/sse)
 * servers; `${VAR}` in any string is expanded from declared secrets only.
 */
const InlineMcpServerSchema = z.union([
  z.strictObject({
    type: z.literal(McpTransport.STDIO).optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: StringMap.optional()
  }),
  z.strictObject({
    type: z.enum([McpTransport.HTTP, McpTransport.SSE]),
    url: z.string().min(1),
    headers: StringMap.optional()
  })
]);

/** One entry of a manifest's `mcpServers`: an inline definition or a reference to `.mcp.json`. */
export const McpServerEntrySchema = z.union([z.literal(MCP_JSON_REFERENCE), InlineMcpServerSchema]);
type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

/** `${VAR}` or `${VAR:-default}`, the same expansion syntax Claude Code supports in `.mcp.json`. */
const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

function expandString(value: string, secrets: Record<string, string>, unresolved: Set<string>): string {
  return value.replace(VARIABLE_PATTERN, (_, name: string, fallback: string | undefined) => {
    if (name in secrets) {
      return secrets[name];
    }
    if (fallback !== undefined) {
      return fallback;
    }
    unresolved.add(name);
    return "";
  });
}

function expandValue(value: unknown, secrets: Record<string, string>, unresolved: Set<string>): unknown {
  if (typeof value === "string") {
    return expandString(value, secrets, unresolved);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandValue(entry, secrets, unresolved));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, expandValue(entry, secrets, unresolved)])
    );
  }
  return value;
}

function isServerConfig(value: unknown): value is McpServerConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const config = value as Record<string, unknown>;
  return typeof config.command === "string" || typeof config.url === "string";
}

function loadMcpJsonServers(workspacePath: string, referenced: Array<string>): Record<string, unknown> {
  const mcpPath = join(workspacePath, TargetRepoPath.MCP_JSON);
  if (!existsSync(mcpPath)) {
    throw new SkillWorkflowConfigError(
      `MCP servers ${referenced.join(", ")} are taken from .mcp.json, but the file is missing — define them inline in the manifest instead`
    );
  }
  try {
    const parsed = JSON.parse(readFileSync(mcpPath, "utf-8")) as { mcpServers?: Record<string, unknown> };
    return parsed.mcpServers ?? {};
  } catch (err) {
    throw new SkillWorkflowConfigError(`.mcp.json is not valid JSON: ${String(err)}`);
  }
}

/**
 * Resolves the manifest's `mcpServers`: inline definitions are used as they
 * are, `".mcp.json"` entries are picked out of the target repo's `.mcp.json`
 * (the same file a developer's interactive session uses). A developer's
 * global/user-level MCP config is never consulted — a CI run doesn't have it,
 * and machine-local settings must not steer an unattended run.
 *
 * `${VAR}` references are expanded from the skill workflow's declared secrets
 * only. Neither the host environment nor undeclared variables are consulted:
 * a secret reaches an MCP server only if the manifest declares it and the
 * server's config asks for it.
 *
 * The result goes to the SDK with `strictMcpConfig: true` (agent/run-agent.ts),
 * so secrets land in each server's own `env`/`headers` instead of the agent's
 * Bash environment.
 */
export function resolveMcpServers(
  workspacePath: string,
  definitions: Record<string, McpServerEntry>,
  secrets: Record<string, string>
): Record<string, McpServerConfig> {
  const referenced = Object.keys(definitions).filter((name) => definitions[name] === MCP_JSON_REFERENCE);
  const mcpJsonServers = referenced.length > 0 ? loadMcpJsonServers(workspacePath, referenced) : {};

  const servers: Record<string, McpServerConfig> = {};
  for (const [name, definition] of Object.entries(definitions)) {
    const config = definition === MCP_JSON_REFERENCE ? mcpJsonServers[name] : definition;
    if (!isServerConfig(config)) {
      throw new SkillWorkflowConfigError(`MCP server "${name}" is not defined in .mcp.json`);
    }
    const unresolved = new Set<string>();
    const expanded = expandValue(config, secrets, unresolved);
    if (unresolved.size > 0) {
      throw new SkillWorkflowConfigError(
        `MCP server "${name}" references ${[...unresolved].join(", ")}, which the skill workflow does not declare in secrets`
      );
    }
    servers[name] = expanded as McpServerConfig;
  }
  return servers;
}
