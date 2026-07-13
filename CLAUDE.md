# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Szumrak is the **engine** of an autonomous agent. It runs the Claude Agent SDK against a
**separate target repository** (mounted at `WORKSPACE_PATH`, default `/workspace`), lets the
model make edits, then commits/pushes and opens a labelled PR — unless `DRY_RUN=true`, which
leaves changes on disk only.

The critical distinction to hold in mind: **this repo never operates on itself.** It is a tool
that acts on some other repo. `src/` is the engine; `target-repo-templates/` are files meant to
be copied *into the target repo* (its `CLAUDE.md`, `.claude/agent-permissions.json`), not
consumed here.

Deployment model is "Option A" (see Notion): Szumrak stays a separate repo and is built locally
from source (`docker build`) inside the target repo's CI, rather than published as an image.

## Commands

```bash
npm start           # tsx src/index.ts — runs the agent (no compile step)
npm run typecheck   # tsc --noEmit (tsconfig is noEmit; Bundler resolution, extensionless imports)
npm run build       # docker build -t szumrak -f docker/Dockerfile . — the CI "build" check
npm run dev:run     # docker run against $TARGET_REPO_PATH mounted at /workspace (DRY_RUN on) — local only
npm run biome:check # Biome lint+format check (biome:fix to autofix)
```

`build` (not `dev:build`) on purpose: it is meant to run in the GH Actions PR-checks workflow, not
just locally — the image is this repo's only build artifact (no `tsc` compile step exists).
`dev:run` stays `dev:`-prefixed since it mounts `$TARGET_REPO_PATH` and is local-only.

There is **no build step and no test suite**: the TypeScript source is run directly via
**tsx** (locally and in Docker), so there is no `dist/`. `tsc` is typecheck-only (`noEmit`).
Lint/format is **Biome** — it strips `.js` extensions from relative imports, which is why the
tsconfig uses `module: "ESNext"` + `moduleResolution: "Bundler"`; do not reintroduce NodeNext or
`.js` import extensions (they fight Biome and break the build). Verification is `npm run typecheck`.

Running the agent locally (Level 1, fastest loop — see README for Levels 2/3):

```bash
WORKSPACE_PATH=/path/to/target-repo TASK="..." DRY_RUN=true ANTHROPIC_API_KEY=sk-ant-... npm start
```

## Execution flow

`src/index.ts` (entrypoint, reads env) → `runAgent(task)` → on success and not `DRY_RUN`,
`commitAndOpenPR(...)`.

- **`run-agent.ts`** wraps the SDK `query()` stream. `permissionMode: "acceptEdits"`, `maxTurns`
  from `env`, **no `skills` option** (the agent runs without skills — see below). It walks the
  message stream: assistant tool-use/text blocks live under `message.message.content`; the final
  outcome is a `type: "result"` message where success is `subtype === "success" && !is_error` and
  the summary text is `message.result`. A wall-clock guard throws past `maxDurationMs`.
  Before calling `query()`, it reads `<WORKSPACE_PATH>/.claude/agent-permissions.json` (if the
  target repo committed one) and passes its `allow`/`deny` arrays through as the SDK's
  `allowedTools`/`disallowedTools`. This file is intentionally **not** the target repo's own
  `.claude/settings.json` — that one governs interactive Claude Code sessions (hooks, personal
  permissions) for a human working in that repo, and doubling it as the unattended agent's
  sandbox would leak agent restrictions into the human's session and vice versa. A missing or
  invalid permissions file just means "no extra restriction beyond `acceptEdits`" — it never
  throws.
- **`git.ts`** does branch → commit → push → PR create (via the Octokit client from
  `src/lib/github.ts`) → add `ai-generated` label. The agent itself never runs git; all git/PR
  work happens here, in Node, *after* the run.
- **`env.ts`** is the single source of validated configuration: `@t3-oss/env-core` + Zod parse
  `process.env` at import time (`emptyStringAsUndefined: true` so Docker/CI empty vars fall back to
  defaults). Invalid config prints a readable list and `process.exit(1)` before the agent runs, so
  a bad env never wastes an API turn. Import `env` from here — there is no `config.ts`.
- **`src/lib/logger.ts`** appends JSONL events to `<WORKSPACE_PATH>/agent-run.jsonl` (uploaded as a
  CI artifact).

Config is entirely env-var driven and validated in `env.ts`: `TASK`, `WORKSPACE_PATH`, `REPO`
(`owner/repo`), `GH_TOKEN`, `ANTHROPIC_API_KEY`, `DRY_RUN`, `MAX_TURNS`, `MAX_DURATION_MS`,
`AGENT_LOG_PATH`. See README table and `.env.example`. `REPO`/`GH_TOKEN` are optional in the schema
but required for real (non-`DRY_RUN`) runs — `index.ts` guards that upfront.

## Invariants — do not regress these

- **SDK typings are ground truth, not the online docs.** Verify the Claude Agent SDK API against
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` before changing `run-agent.ts`. The public
  docs summary has been wrong about message/result shapes (e.g. claiming flat `message.content` or
  a `status` field — neither exists in the installed version).
- **`git.ts` uses `execFileSync` with an argument array on purpose — never `execSync` on an
  interpolated string.** `TASK` is untrusted input (in CI it comes from a GitHub comment body), so
  string interpolation into a shell command is a command-injection vector.
- **The agent runs without any skills right now, by design.** The SDK `skills` option is omitted
  and there is no skill-validation code. `storybook-testing` seen in the Notion history was only a
  planning example; don't reintroduce a skills layer unless explicitly asked.

## Docs & language

The design source of truth is the Notion workspace "Szumrak — Autonomiczny Agent dla Repozytoriów"
(pages are in Polish; page 17 is the rollout plan). **Repo code and docs are English**; keep new
code English. When repo behaviour diverges from Notion, the repo is authoritative — update the
relevant Notion page's "Aktualny stan" callout rather than letting them drift.
