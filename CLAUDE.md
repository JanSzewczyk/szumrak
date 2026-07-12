# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Szumrak is the **engine** of an autonomous agent. It runs the Claude Agent SDK against a
**separate target repository** (mounted at `WORKSPACE_PATH`, default `/workspace`), lets the
model make edits, then commits/pushes and opens a labelled PR — unless `DRY_RUN=true`, which
leaves changes on disk only.

The critical distinction to hold in mind: **this repo never operates on itself.** It is a tool
that acts on some other repo. `src/` is the engine; `target-repo-templates/` are files meant to
be copied *into the target repo* (its `CLAUDE.md`, `.claude/settings.json`), not consumed here.

Deployment model is "Option A" (see Notion): Szumrak stays a separate repo and is built locally
from source (`docker build`) inside the target repo's CI, rather than published as an image.

## Commands

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm start           # node dist/index.js  (build first)
npm run dev:build   # build + docker build -t szumrak -f docker/Dockerfile .
npm run dev:run     # docker run against $TARGET_REPO_PATH mounted at /workspace (DRY_RUN on)
```

There is **no test suite and no linter configured** — do not invent `npm test`/`npm run lint`
commands for this repo. Verification is `npm run typecheck` + `npm run build`.

Running the agent locally (Level 1, fastest loop — see README for Levels 2/3):

```bash
npm run build
WORKSPACE_PATH=/path/to/target-repo TASK="..." DRY_RUN=true ANTHROPIC_API_KEY=sk-ant-... npm start
```

## Execution flow

`src/index.ts` (entrypoint, reads env) → `runAgent(task)` → on success and not `DRY_RUN`,
`commitAndOpenPR(...)`.

- **`runAgent.ts`** wraps the SDK `query()` stream. `permissionMode: "acceptEdits"`, `maxTurns`
  from config, **no `skills` option** (the agent runs without skills — see below). It walks the
  message stream: assistant tool-use/text blocks live under `message.message.content`; the final
  outcome is a `type: "result"` message where success is `subtype === "success" && !is_error` and
  the summary text is `message.result`. A wall-clock guard throws past `maxDurationMs`.
- **`git.ts`** does branch → commit → push → `octokit` PR create → add `ai-generated` label. The
  agent itself never runs git; all git/PR work happens here, in Node, *after* the run.
- **`config.ts`** centralises env-driven limits/constants. **`logger.ts`** appends JSONL events to
  `<WORKSPACE_PATH>/agent-run.jsonl` (this file is uploaded as a CI artifact).

Config is entirely env-var driven: `TASK`, `WORKSPACE_PATH`, `REPO` (`owner/repo`), `GH_TOKEN`,
`ANTHROPIC_API_KEY`, `DRY_RUN`, `MAX_TURNS`, `MAX_DURATION_MS`, `AGENT_LOG_PATH`. See README table.

## Invariants — do not regress these

- **SDK typings are ground truth, not the online docs.** Verify the Claude Agent SDK API against
  `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` before changing `runAgent.ts`. The public
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
