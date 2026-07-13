import type { StandardSchemaV1 } from "@t3-oss/env-core";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Fail fast with a readable message instead of a raw stack trace when the
// environment is misconfigured. This runs at import time — before the agent
// starts — so a bad configuration never wastes an API run.
function reportInvalidEnv(issues: readonly StandardSchemaV1.Issue[]): never {
  console.error("❌ Invalid environment configuration:");
  for (const issue of issues) {
    const path = issue.path?.map((segment) => (typeof segment === "object" ? segment.key : segment)).join(".");
    console.error(`  - ${path || "(env)"}: ${issue.message}`);
  }
  return process.exit(1);
}

export const env = createEnv({
  server: {
    ANTHROPIC_API_KEY: z.string().min(1).describe("Claude API key, read by the Claude Agent SDK"),
    TASK: z.string().min(1).describe("Natural-language task for the agent to perform"),
    WORKSPACE_PATH: z
      .string()
      .min(1)
      .default("/workspace")
      .describe("Path to the target repository the agent operates on"),
    REPO: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, "REPO must be in 'owner/repo' format")
      .optional()
      .describe("Target repository (owner/repo) — required only when opening a PR"),
    GH_TOKEN: z.string().min(1).optional().describe("GitHub PAT used to push the branch and open the PR"),
    DRY_RUN: z
      .string()
      .optional()
      .transform((value) => value === "true")
      .describe('When "true", skip commit/push/PR and leave changes on disk only'),
    MAX_TURNS: z.coerce
      .number()
      .int()
      .positive()
      .default(30)
      .describe("Max agent turns (API round-trips) before stopping"),
    MAX_DURATION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000)
      .describe("Max wall-clock run duration in milliseconds before aborting"),
    AGENT_LOG_PATH: z
      .string()
      .min(1)
      .optional()
      .describe("Path for the JSONL run log; defaults to <WORKSPACE_PATH>/agent-run.jsonl")
  },
  runtimeEnv: process.env,
  // Docker/CI often pass unset vars as an empty string (`-e VAR=`); treat those
  // as absent so defaults and `.optional()` apply instead of failing `.min(1)`.
  emptyStringAsUndefined: true,
  onValidationError: reportInvalidEnv
});
