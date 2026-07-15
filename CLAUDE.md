# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Szumrak is the **engine** of an autonomous agent. It runs the Claude Agent SDK against a
**separate target repository** (mounted at `WORKSPACE_PATH`, default `/workspace`), lets the
model make edits, then commits/pushes and opens a labelled PR — unless `DRY_RUN=true`, which
leaves changes on disk only.

The critical distinction to hold in mind: **this repo never operates on itself.** It is a tool
that acts on some other repo. `src/` is the engine; `target-repo-templates/` are files meant to
be copied *into the target repo* (its `CLAUDE.md`, `.claude/agent-permissions.json`,
`.github/workflows/szumrak.yml`), not consumed here.

Deployment model is "Option A" (see Notion): Szumrak stays a separate repo and is built locally
from source (`docker build`) inside the target repo's CI, rather than published as an image.

## Commands

```bash
npm start           # tsx src/index.ts — runs the agent (no compile step)
npm run typecheck   # tsc --noEmit (tsconfig is noEmit; Bundler resolution, extensionless imports)
npm test            # vitest run — unit tests for src/**/*.test.ts
npm run build       # docker build -t szumrak -f docker/Dockerfile . — the CI "build" check
npm run dev:run     # docker run against $TARGET_REPO_PATH mounted at /workspace (DRY_RUN on) — local only
npm run biome:check # Biome lint+format check (biome:fix to autofix)
```

`build` (not `dev:build`) on purpose: it is meant to run in the GH Actions PR-checks workflow, not
just locally — the image is this repo's only build artifact (no `tsc` compile step exists).
`dev:run` stays `dev:`-prefixed since it mounts `$TARGET_REPO_PATH` and is local-only.

There is **no compile/build step for the source itself**: the TypeScript is run directly via
**tsx** (locally and in Docker), so there is no `dist/`. `tsc` is typecheck-only (`noEmit`). There
**is** a Vitest suite (`src/**/*.test.ts`, run via `npm test`) — verification for a change is
`npm run typecheck && npm test && npm run biome:check`. Tests set `SKIP_ENV_VALIDATION=true`
(`vitest.config.ts`) so modules that import `env` don't need every required var set or risk the
fail-fast `process.exit(1)` in `env.ts`. Lint/format is **Biome** — it strips `.js` extensions from
relative imports, which is why the tsconfig uses `module: "ESNext"` + `moduleResolution: "Bundler"`;
do not reintroduce NodeNext or `.js` import extensions (they fight Biome and break the build).

Running the agent locally (Level 1, fastest loop — see README for Levels 2/3):

```bash
WORKSPACE_PATH=/path/to/target-repo TASK="..." DRY_RUN=true ANTHROPIC_API_KEY=sk-ant-... npm start
```

## Execution flow

`src/` is organized by concern, not as a flat bag of files:
- **`src/types/`** holds types/enums shared across layers — e.g. `types/mode.ts` defines the
  `Mode` const enum (`Mode.RUNNER` / `Mode.REVIEW_FOLLOWUP`) that `MODE` is validated against
  everywhere, the single source of truth for that value (never a raw string literal). It lives
  outside `flows/` on purpose: `platform/env.ts` needs it too, and `platform/` importing from
  `flows/` would invert the intended dependency direction (flows depend on platform, not the
  other way round).
- **`src/flows/`** — one folder per orchestration flow. `flows/registry.ts` exports
  `flowRegistry: Record<Mode, (ctx) => Promise<FlowResult>>`, the only place `index.ts` dispatches
  through; because it's typed as `Record<Mode, ...>`, adding a value to `Mode` without a matching
  registry entry is a compile error. `flows/types.ts` holds the shared `FlowResult` contract
  (`{ succeeded: boolean }`) every flow returns.
- **`src/agent/`** and **`src/github/`** are reusable building blocks every flow composes — the
  Claude Agent SDK wrapper and the git/GitHub integration, respectively — not flow-specific logic.
- **`src/platform/`** is cross-cutting infra with no flow or GitHub awareness: env validation,
  JSONL logging, CI step summaries.

`src/index.ts` (entrypoint, reads env) branches on `MODE`:
- **`Mode.RUNNER`** (`MODE=runner`, default) — `flows/runner/run-runner-flow.ts`:
  `runAgent(task)` → on success and not `DRY_RUN`, `commitAndOpenPR(...)`.
- **`Mode.REVIEW_FOLLOWUP`** (`MODE=review-followup`) — `flows/review-followup/run-review-followup-flow.ts`:
  `runReviewFollowUp(owner, repo, PR_NUMBER, REVIEW_FEEDBACK)`. Addresses code-review feedback on
  an *existing* PR's branch instead of opening a new one: reads the round count off a
  `review-round-N` PR label (hard cap `MAX_REVIEW_ROUNDS = 3`, defined in
  `flows/review-followup/review-rounds.ts` alongside the round-label and original-task-parsing
  helpers; past the cap it writes a warning `writeStepSummary` and stops without touching the
  agent), `checkoutExistingBranch`s the PR's head ref *before* calling `runAgent` (the agent must
  see the branch's current state, not `main`), builds the prompt from the original task (parsed
  back out of the PR body via `Task:\n<task>\n\nGenerated automatically by Szumrak.`),
  `changedFilesWithContent()`, and the review feedback text, then `pushFollowUpCommit`s straight to
  that branch (no new branch, no new PR — GitHub updates the existing PR when a commit lands on its
  branch) and bumps the round label. `TASK` is not required in this mode; `PR_NUMBER` +
  `REVIEW_FEEDBACK` are, instead.

- **`agent/run-agent.ts`** wraps the SDK `query()` stream. `permissionMode: "acceptEdits"`,
  `maxTurns` from `env`, **no `skills` option** (the agent runs without skills — see below). It
  walks the message stream: assistant tool-use/text blocks live under `message.message.content`;
  the final outcome is a `type: "result"` message where success is `subtype === "success" &&
  !is_error` and the summary text is `message.result`. A wall-clock guard throws past
  `maxDurationMs`. Before calling `query()`, it reads `<WORKSPACE_PATH>/.claude/agent-permissions.json`
  (if the target repo committed one) and passes its `allow`/`deny` arrays through as the SDK's
  `allowedTools`/`disallowedTools`. This file is intentionally **not** the target repo's own
  `.claude/settings.json` — that one governs interactive Claude Code sessions (hooks, personal
  permissions) for a human working in that repo, and doubling it as the unattended agent's
  sandbox would leak agent restrictions into the human's session and vice versa. A missing or
  invalid permissions file just means "no extra restriction beyond `acceptEdits`" — it never
  throws.
- **`agent/commit-metadata.ts`** has the agent end its final response with a fenced ` ```commit `
  block (Conventional Commits type/scope/subject/branch), appended to `run-agent.ts`'s system
  prompt via `COMMIT_METADATA_INSTRUCTIONS`. `parseCommitMetadata()` extracts it (with a fallback
  for the model collapsing `type:`/`subject:` onto one line) and `run-agent.ts` strips it from the
  human-facing `finalMessage`. This exists so the target repo's semantic-release parses a real
  commit type, not an always-`chore` placeholder.
- **`github/pull-requests.ts`** does branch → commit → push → PR create (via the Octokit client
  from `github/client.ts`) → add `ai-generated` label. The agent itself never runs git; all git/PR
  work happens here, in Node, *after* the run. Branch name and commit message are driven by the
  agent's own self-reported `CommitMetadata` (type/scope/subject/branch) when present — see above —
  falling back to `chore(agent): <task text>` when it's missing or unparsable.
- **`github/repo.ts`** exports `parseRepo` (shared `REPO` → `{owner, repo}` split, used by
  `index.ts`/`dedup.ts`/`pull-requests.ts` too).
- **`github/git-operations.ts`** holds the low-level git primitives: the `git()` `execFileSync`
  wrapper, `configureGitRemoteAuth`, and the review-followup-only trio `checkoutExistingBranch`/
  `changedFilesWithContent`/`pushFollowUpCommit`. `configureGitRemoteAuth`/`checkoutExistingBranch`/
  `commitAndOpenPR` (in `pull-requests.ts`) are `async` because embedding a fresh token in the git
  remote URL requires awaiting `getInstallationToken()` first — see below.
- **`github/client.ts`** authenticates as a **GitHub App** (`szumrak-bot`, via `@octokit/auth-app`),
  not a personal PAT — this is what makes PRs show `szumrak-bot[bot]` as author instead of whoever
  owns the token. `octokit` is constructed with `authStrategy: createAppAuth`, which transparently
  handles the JWT → installation token exchange and refresh on every request; no manual token
  lifecycle code needed for API calls. `getInstallationToken()` is a second, separate
  `createAppAuth` instance that returns the raw token string — needed because `git push` embeds the
  token directly in the remote URL, which Octokit's internal auth strategy doesn't expose.
- **`platform/env.ts`** is the single source of validated configuration: `@t3-oss/env-core` + Zod
  parse `process.env` at import time (`emptyStringAsUndefined: true` so Docker/CI empty vars fall
  back to defaults). Invalid config prints a readable list and `process.exit(1)` before the agent
  runs, so a bad env never wastes an API turn. Import `env` from here — there is no `config.ts`.
- **`platform/logger.ts`** appends JSONL events to `<WORKSPACE_PATH>/agent-run.jsonl` (uploaded as a
  CI artifact) — see the secret-redaction invariant below.
- **`platform/summary.ts`** (`writeStepSummary`) writes failure-only lines to `GITHUB_STEP_SUMMARY`
  when set, so a failed run is visible on the target repo's GH Actions job summary page without an
  `issue_comment` trigger to post a PR/issue comment against (see Notion page 14 vs. the current
  `workflow_dispatch`-only trigger). Success stays a silent `ai-generated` PR + label.

Config is entirely env-var driven and validated in `platform/env.ts`: `TASK` (required only for
`MODE=runner`), `MODE` (`runner` default | `review-followup`, backed by `types/mode.ts`'s `Mode`
enum), `PR_NUMBER`/`REVIEW_FEEDBACK` (required only for `MODE=review-followup`), `WORKSPACE_PATH`,
`REPO` (`owner/repo`), `GH_APP_ID`/`GH_APP_PRIVATE_KEY`/`GH_APP_INSTALLATION_ID` (GitHub App
credentials — see below), `ANTHROPIC_API_KEY`, `DRY_RUN`, `AGENT_MODEL`, `MAX_TURNS`,
`MAX_DURATION_MS`, `AGENT_LOG_PATH`, `TARGET_REPO_PATH` (local-only, used by `dev:run`),
`GITHUB_STEP_SUMMARY` (read by `platform/summary.ts`). See README table and `.env.example`.
`REPO`/the App credentials are optional in the schema but required for real (non-`DRY_RUN`) runs —
`index.ts` guards that upfront, alongside the `MODE`-specific requirements above.

## Invariants — do not regress these

- **SDK typings are ground truth, not the online docs.** Verify the Claude Agent SDK API against
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` before changing `agent/run-agent.ts`. The
  public docs summary has been wrong about message/result shapes (e.g. claiming flat
  `message.content` or a `status` field — neither exists in the installed version).
- **`github/git-operations.ts` uses `execFileSync` with an argument array on purpose — never
  `execSync` on an interpolated string.** `TASK` is untrusted input (in CI it comes from a GitHub
  comment body), so string interpolation into a shell command is a command-injection vector.
- **The agent runs without any skills right now, by design.** The SDK `skills` option is omitted
  and there is no skill-validation code. `storybook-testing` seen in the Notion history was only a
  planning example; don't reintroduce a skills layer unless explicitly asked.
- **`platform/logger.ts` redacts secret patterns and truncates long strings before anything is
  written.** `agent-run.jsonl` is uploaded as a CI artifact readable by anyone with repo/Actions
  access, so `sanitizeValue()` (regexes for `sk-ant-`, `AKIA`, `ghp_`/`github_pat_`, Google/Slack
  keys, PEM blocks; 500-char truncation) runs on every logged value. Don't bypass `log()` with a
  raw `console.log`/`appendFileSync` for tool inputs/outputs, and don't remove this when touching
  the logger — it's the only thing standing between a hardcoded key the agent reads and a
  public-ish CI artifact.
- **Every env var is read through `env` from `platform/env.ts` — never `process.env.X` directly in
  application code.** Add new vars to the Zod schema in `platform/env.ts` first (with a
  `.describe()`), then import `env` wherever it's needed. This is what makes a missing/malformed
  var fail fast with a readable message before the agent runs, instead of surfacing as an obscure
  `undefined` deep in a run. Exceptions: `vitest.config.ts` (bootstraps env before `platform/env.ts`
  is ever imported) and test files (`*.test.ts`) setting `process.env` to simulate config for the
  module under test.
- **`Mode` (`types/mode.ts`) is the single source of truth for the `MODE` value — never compare
  `env.MODE` against a raw string literal.** `platform/env.ts`'s Zod schema, `index.ts`'s dispatch,
  and `flows/registry.ts` all read/compare through `Mode.RUNNER`/`Mode.REVIEW_FOLLOWUP`. Adding a
  flow means adding a value to `Mode` and a matching `flowRegistry` entry — the registry's
  `Record<Mode, ...>` typing turns a missed entry into a compile error instead of a silent runtime
  no-op.

## Docs & language

The design source of truth is the Notion workspace "Szumrak — Autonomiczny Agent dla Repozytoriów"
(pages are in Polish; page 17 is the rollout plan). **Repo code and docs are English**; keep new
code English. When repo behaviour diverges from Notion, the repo is authoritative — update the
relevant Notion page's "Aktualny stan" callout rather than letting them drift.
