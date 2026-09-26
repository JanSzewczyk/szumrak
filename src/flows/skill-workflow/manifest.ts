import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { GitHubAccess } from "~/types/github-access";

export const SkillWorkflowDelivery = {
  /** The skill itself creates the branch, commits, pushes and opens the PR (e.g. via `gh`). */
  AGENT: "agent",
  /** The skill only edits files; Szumrak commits, pushes and opens the PR afterwards, like MODE=runner. */
  ENGINE: "engine"
} as const;

export type SkillWorkflowDelivery = (typeof SkillWorkflowDelivery)[keyof typeof SkillWorkflowDelivery];

/** Relative to the target repo root. */
const SKILL_WORKFLOWS_DIR = join(".claude", "szumrak", "skill-workflows");

const INPUT_PLACEHOLDER_PATTERN = /\{\{\s*inputs\.([a-z][a-z0-9_]*)\s*\}\}/g;

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

function isValidRegExp(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

const SkillWorkflowInputDefinition = z.strictObject({
  description: z.string().optional(),
  required: z.boolean().default(false),
  /** Matched against the whole value (implicitly anchored). */
  pattern: z.string().refine(isValidRegExp, "pattern must be a valid regular expression").optional(),
  maxLength: z.number().int().positive().max(10_000).default(500)
});

const GitHubAccessSchema = z.enum([GitHubAccess.READ, GitHubAccess.WRITE]);

/**
 * `.claude/szumrak/skill-workflows/<name>.json` in the target repo. JSON — like
 * agent-config.json — so the engine needs no YAML parser and the reusable
 * workflow can read `secrets` with plain `jq`.
 *
 * Strict objects on purpose: a misspelled key (`maxturns`, `secret`) is a
 * validation error, not a silently ignored setting.
 */
const SkillWorkflowManifestSchema = z
  .strictObject({
    $schema: z.string().optional(),
    description: z.string().optional(),
    /** Name of the entry skill in the target repo's `.claude/skills/<skill>/SKILL.md`. */
    skill: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "skill must be a skill directory name"),
    /** Argument string for the skill; `{{inputs.<name>}}` placeholders are filled from the inputs. */
    args: z.string().max(2000).optional(),
    inputs: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), SkillWorkflowInputDefinition).default({}),
    delivery: z.enum([SkillWorkflowDelivery.AGENT, SkillWorkflowDelivery.ENGINE]),
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
    /** Server names from the target repo's `.mcp.json`; each one is required to connect. */
    mcpServers: z.array(z.string().min(1)).default([]),
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
    for (const match of (manifest.args ?? "").matchAll(INPUT_PLACEHOLDER_PATTERN)) {
      if (!(match[1] in manifest.inputs)) {
        ctx.addIssue({ code: "custom", path: ["args"], message: `{{inputs.${match[1]}}} is not a declared input` });
      }
    }
  });

export type SkillWorkflowManifest = z.infer<typeof SkillWorkflowManifestSchema>;
export type SkillWorkflowInputDefinition = z.infer<typeof SkillWorkflowInputDefinition>;

export class SkillWorkflowConfigError extends Error {
  override name = "SkillWorkflowConfigError";
}

/**
 * Loads and validates the named manifest. Unlike agent-config.json (where a
 * missing/broken file just means "no extra config"), a skill workflow run
 * can't do anything sensible without its manifest, so every problem throws a
 * {@link SkillWorkflowConfigError} with a readable message.
 *
 * `name` is already restricted to a slug by platform/env.ts, so it can't
 * escape {@link SKILL_WORKFLOWS_DIR}.
 */
export function loadSkillWorkflowManifest(workspacePath: string, name: string): SkillWorkflowManifest {
  const relativePath = join(SKILL_WORKFLOWS_DIR, `${name}.json`);
  const manifestPath = join(workspacePath, relativePath);
  if (!existsSync(manifestPath)) {
    throw new SkillWorkflowConfigError(`Skill workflow manifest not found: ${relativePath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    throw new SkillWorkflowConfigError(`${relativePath} is not valid JSON: ${String(err)}`);
  }

  const parsed = SkillWorkflowManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SkillWorkflowConfigError(`${relativePath} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** `{{inputs.<name>}}` → value; an optional input that wasn't given renders as an empty string. */
export function renderSkillArgs(template: string, inputs: Record<string, string>): string {
  return template.replace(INPUT_PLACEHOLDER_PATTERN, (_, name: string) => inputs[name] ?? "").trim();
}
