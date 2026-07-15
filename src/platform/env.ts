import type { StandardSchemaV1 } from "@t3-oss/env-core";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { Mode } from "~/types/mode";

/**
 * Fail fast with a readable message instead of a raw stack trace when the
 * environment is misconfigured. This runs at import time — before the agent
 * starts — so a bad configuration never wastes an API run.
 */
function reportInvalidEnv(issues: ReadonlyArray<StandardSchemaV1.Issue>): never {
  console.error("❌ Invalid environment configuration:");
  for (const issue of issues) {
    const path = issue.path?.map((segment) => (typeof segment === "object" ? segment.key : segment)).join(".");
    console.error(`  - ${path || "(env)"}: ${issue.message}`);
  }
  return process.exit(1);
}

/**
 * `MODE` decides which other vars are required — `TASK` for `runner`,
 * `PR_NUMBER` + `REVIEW_FEEDBACK` for `review-followup`. A discriminated
 * union on `MODE` (not a flat optional field on each) so this is enforced
 * *and* narrows `env`'s TypeScript type: inside `if (env.MODE ===
 * Mode.RUNNER)`, `env.TASK` is `string`, not `string | undefined` cast away
 * at every call site; on the review-followup branch `TASK` doesn't exist on
 * the type at all, and vice versa for `PR_NUMBER`/`REVIEW_FEEDBACK`. See
 * `createFinalSchema` below for how this plugs into `createEnv`.
 */
const RunnerModeEnv = z.object({
  MODE: z.literal(Mode.RUNNER),
  TASK: z.string().min(1).describe("Natural-language task for the agent to perform")
});

const ReviewFollowUpModeEnv = z.object({
  MODE: z.literal(Mode.REVIEW_FOLLOWUP),
  PR_NUMBER: z.coerce.number().int().positive().describe("PR number to follow up on"),
  REVIEW_FEEDBACK: z.string().min(1).describe("Reviewer's feedback text to address")
});

/**
 * The single source of validated configuration — read through this exported
 * `env` object everywhere, never `process.env.X` directly. See the inline
 * comments below for the reasoning behind each option.
 */
export const env = createEnv({
  server: {
    ANTHROPIC_API_KEY: z.string().min(1).describe("Claude API key, read by the Claude Agent SDK"),
    /**
     * TASK/MODE/PR_NUMBER/REVIEW_FEEDBACK stay declared here too, loosely
     * (optional) — this dictionary is also what .env.example-style tooling
     * would read via .describe(). The actual per-MODE requiredness and
     * env's exported type come from RunnerModeEnv/ReviewFollowUpModeEnv
     * above, via createFinalSchema below, not from these individual field
     * schemas.
     */
    TASK: z
      .string()
      .min(1)
      .optional()
      .describe("Natural-language task for the agent to perform; required when MODE=runner"),
    MODE: z
      .enum([Mode.RUNNER, Mode.REVIEW_FOLLOWUP])
      .default(Mode.RUNNER)
      .describe(
        "runner: run TASK and open a new PR. review-followup: address review feedback on PR_NUMBER's existing branch instead."
      ),
    PR_NUMBER: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("PR number to follow up on; required when MODE=review-followup"),
    REVIEW_FEEDBACK: z
      .string()
      .min(1)
      .optional()
      .describe("Reviewer's feedback text to address; required when MODE=review-followup"),
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
    GH_APP_ID: z.string().min(1).optional().describe("GitHub App ID; required unless DRY_RUN=true"),
    GH_APP_PRIVATE_KEY: z
      .string()
      .min(1)
      .optional()
      .describe("GitHub App private key (PEM); required unless DRY_RUN=true"),
    GH_APP_INSTALLATION_ID: z.coerce
      .number()
      .int()
      .positive()
      .optional()
      .describe("GitHub App installation ID for the target repo; required unless DRY_RUN=true"),
    DRY_RUN: z
      .string()
      .optional()
      .transform((value) => value === "true")
      .describe('When "true", skip commit/push/PR and leave changes on disk only'),
    AGENT_MODEL: z
      .string()
      .min(1)
      .default("default")
      .describe("Claude model alias (e.g. 'haiku', 'sonnet', 'opus') or full model ID for the agent to use"),
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
      .describe("Path for the JSONL run log; defaults to <WORKSPACE_PATH>/agent-run.jsonl"),
    TARGET_REPO_PATH: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Local checkout of the target repository, mounted as /workspace by `npm run dev:run` (Level 2 Docker testing). Not used by the agent itself."
      ),
    GITHUB_STEP_SUMMARY: z
      .string()
      .min(1)
      .optional()
      .describe(
        "GH Actions-provided path to the job's step summary file; unset outside CI. Read by src/platform/summary.ts."
      )
  },
  /**
   * The literal `process.env` reference, not a copy — with skipValidation
   * (see below) t3-env returns this object as-is, and tests rely on that
   * reference equality to mutate `process.env.X` after import and still see
   * it through `env.X`. Do not replace this with a spread/snapshot.
   */
  runtimeEnv: process.env,
  /**
   * Docker/CI often pass unset vars as an empty string (`-e VAR=`); treat
   * those as absent so defaults and `.optional()` apply instead of failing
   * `.min(1)`.
   */
  emptyStringAsUndefined: true,
  onValidationError: reportInvalidEnv,
  /**
   * Lets unit tests import modules that transitively pull in `env`
   * (github/git-operations.ts, agent/run-agent.ts, platform/logger.ts)
   * without setting every required var or risking the process.exit(1)
   * above. Set by vitest.config.ts; never set this in a real run — it
   * defeats the whole point of validating configuration.
   */
  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",
  /**
   * Rebuilds the final schema as an intersection of the common fields with a
   * MODE-discriminated union, instead of the flat z.object(shape) t3-env
   * would build by default — see the comment on RunnerModeEnv above for why.
   * The trailing superRefine enforces REPO/GH_APP_* unless DRY_RUN=true —
   * this used to be a manual `if` in index.ts, checked *after* env had
   * already been validated; it belongs here so every configuration error
   * (MODE-dependent or DRY_RUN-dependent) surfaces the same way, at import
   * time, before the agent burns an API turn on a run that can't ever push.
   */
  createFinalSchema: (shape) => {
    const { MODE, TASK, PR_NUMBER, REVIEW_FEEDBACK, ...common } = shape;
    return z
      .object(common)
      .and(z.discriminatedUnion("MODE", [RunnerModeEnv, ReviewFollowUpModeEnv]))
      .superRefine((env, ctx) => {
        if (env.DRY_RUN) {
          return;
        }
        for (const field of ["REPO", "GH_APP_ID", "GH_APP_PRIVATE_KEY", "GH_APP_INSTALLATION_ID"] as const) {
          if (!env[field]) {
            ctx.addIssue({ code: "custom", path: [field], message: `${field} is required unless DRY_RUN=true` });
          }
        }
      });
  }
});
