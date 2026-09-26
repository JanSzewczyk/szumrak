import { z } from "zod";
import { GitHubAccess } from "~/types/github-access";
import { SkillWorkflowInputDefinition } from "./inputs";
import { McpServerEntrySchema } from "./mcp-servers";
import { listInputPlaceholders } from "./skill-args";

/**
 * Szumrak's own credentials. A manifest listing one of these could forward it
 * to the agent via `agentEnv` (or into an MCP server), defeating the scoped
 * token and the env allowlist entirely.
 */
const RESERVED_SECRET_NAMES = new Set([
  "GH_APP_ID",
  "GH_APP_PRIVATE_KEY",
  "GH_APP_INSTALLATION_ID",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN"
]);

const SECRET_NAME = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/, "secret names must be UPPER_SNAKE_CASE")
  .refine((name) => !RESERVED_SECRET_NAMES.has(name), "is reserved for Szumrak's own credentials");

const GitHubAccessSchema = z.enum([GitHubAccess.READ, GitHubAccess.WRITE]);

/**
 * `.claude/szumrak/skill-workflows/<name>.json` in the target repo. JSON — like
 * agent-config.json — so the engine needs no YAML parser and the reusable
 * workflow can read `secrets` with plain `jq`.
 *
 * Strict objects on purpose: a misspelled key (`maxturns`, `secret`) is a
 * validation error, not a silently ignored setting.
 */
export const SkillWorkflowManifestSchema = z
  .strictObject({
    $schema: z.string().optional(),
    description: z.string().optional(),
    /** Name of the entry skill in the target repo's `.claude/skills/<skill>/SKILL.md`. */
    skill: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "skill must be a skill directory name"),
    /** Argument string for the skill; `{{inputs.<name>}}` placeholders are filled from the inputs. */
    args: z.string().max(2000).optional(),
    inputs: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), SkillWorkflowInputDefinition).default({}),
    model: z.string().min(1).optional(),
    maxTurns: z.number().int().positive().max(500).optional(),
    maxDurationMinutes: z.number().int().positive().max(360).optional(),
    maxBudgetUsd: z.number().positive().optional(),
    /** Overrides agent-config.json's `skills`; the entry skill is always added. */
    skills: z.union([z.literal("all"), z.array(z.string().min(1))]).optional(),
    /** Every secret the run may use. The reusable workflow forwards exactly these, nothing else. */
    secrets: z.array(SECRET_NAME).default([]),
    /**
     * Secrets exposed to the agent as plain env vars (for CLIs that read their
     * credentials from the environment). The agent can read these through
     * Bash — prefer MCP servers, which get secrets only via `${VAR}` in `.mcp.json`.
     */
    agentEnv: z.array(SECRET_NAME).default([]),
    /**
     * Every MCP server the run gets, each one required to connect. The value
     * is either an inline definition or `".mcp.json"` to take that server's
     * definition from the target repo's `.mcp.json`.
     */
    mcpServers: z.record(z.string().min(1), McpServerEntrySchema).default({}),
    /**
     * Shell commands run before the agent starts — install the CLIs the skill
     * needs (`apt-get install -y jq`, `npm install -g @acme/cli`). They run in
     * the workspace with the same allowlisted environment as the agent but
     * without any secrets, and they come only from the manifest: inputs are
     * never interpolated into them.
     */
    setup: z.array(z.string().min(1)).default([]),
    github: z
      .strictObject({
        permissions: z.strictObject({
          contents: GitHubAccessSchema.optional(),
          pull_requests: GitHubAccessSchema.optional(),
          issues: GitHubAccessSchema.optional(),
          /**
           * Opt-in only, never a default: together with `contents: write` it
           * lets the agent push a branch carrying a new workflow file, and
           * that workflow would run with every repository secret.
           */
          workflows: GitHubAccessSchema.optional()
        })
      })
      .optional(),
    permissions: z
      .strictObject({
        allow: z.array(z.string().min(1)).optional(),
        deny: z.array(z.string().min(1)).optional()
      })
      .optional()
  })
  .superRefine((manifest, ctx) => {
    for (const name of manifest.agentEnv) {
      if (!manifest.secrets.includes(name)) {
        ctx.addIssue({ code: "custom", path: ["agentEnv"], message: `${name} is not listed in secrets` });
      }
    }
    for (const name of listInputPlaceholders(manifest.args ?? "")) {
      if (!(name in manifest.inputs)) {
        ctx.addIssue({ code: "custom", path: ["args"], message: `{{inputs.${name}}} is not a declared input` });
      }
    }
  });

export type SkillWorkflowManifest = z.infer<typeof SkillWorkflowManifestSchema>;
