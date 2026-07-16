<div align="center">

# 🤖 Szumrak

[![GitHub stars](https://img.shields.io/github/stars/JanSzewczyk/szumrak?style=social)](https://github.com/JanSzewczyk/szumrak/stargazers)
[![CI](https://github.com/JanSzewczyk/szumrak/actions/workflows/pr-check.yml/badge.svg)](https://github.com/JanSzewczyk/szumrak/actions/workflows/pr-check.yml)
[![CodeQL](https://github.com/JanSzewczyk/szumrak/actions/workflows/codeql.yml/badge.svg)](https://github.com/JanSzewczyk/szumrak/actions/workflows/codeql.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

**Autonomous agent that runs Claude against a target repo and opens a reviewed PR**

[Features](#-features) • [Getting Started](#-getting-started) • [Usage](#-usage) • [Testing](#-testing)

</div>

---

## 👋 Hello there!

Szumrak is the **engine** of an autonomous coding agent. It runs the
[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview) against a **separate
target repository** — mounted at `WORKSPACE_PATH`, never itself — lets the model make edits,
then commits, pushes, and opens a labelled, reviewable pull request. Every run is bounded by
turn and time limits, every configuration is validated before a single API call is made, and
every git operation is hardened against command injection since the triggering task can
originate from an untrusted source (a GitHub issue/PR comment).

It ships as a Docker image with a `tsx`-run TypeScript source (no compile step) and is designed
to be built from source inside a target repository's own CI, rather than published — see
[`CLAUDE.md`](./CLAUDE.md) for the full architecture rationale.

## ✨ Features

### 🤖 Agent Engine

- **Repo-agnostic** — points at any target repository via `WORKSPACE_PATH`; nothing in the engine is tied to a specific codebase
- **Env-validated configuration** — a [Zod](https://zod.dev/) schema via [T3 Env](https://env.t3.gg/) fails fast with a readable error list, never wasting an API call on bad config
- **Bounded runs** — `MAX_TURNS` and `MAX_DURATION_MS` guards prevent a runaway agent loop
- **`DRY_RUN` safety mode** — inspect changes left on disk before anything is ever committed, pushed, or opened as a PR

### 🧩 Target Repo Integration

- **Skill discovery** — the agent autonomously discovers and invokes the target repo's own `.claude/skills/`, choosing when to use them based on each `SKILL.md`'s name/description; no per-task mapping to configure
- **The target repo's own hooks run** — `settings.json` PostToolUse hooks (formatters, linters, etc.) fire during the agent's session exactly as they would in an interactive Claude Code session; Szumrak registers no hooks of its own
- **Opt-in `agent-config.json`** — the target repo declares its own tool permissions, skill whitelist, and post-run `verify` commands in one committed file; a missing file just means "no extra restriction, no skills, no verify"
- **Hook lifecycle logging** — every hook the target repo runs is captured in `agent-run.jsonl` (name, event, stdout/stderr, exit code), so a formatter or linter that silently fails is visible instead of running unobserved in the SDK subprocess

### 🔒 Safety & Git Integration

- **Command-injection-hardened git operations** — every git call goes through `execFileSync` with an argument array, never a shell-interpolated string, because the triggering task text is untrusted input
- **Automatic PR creation** — commits, pushes a branch, opens a PR via the GitHub API ([Octokit](https://github.com/octokit/rest.js)), and labels it `ai-generated`
- **Post-run verify gate** — before a PR opens, the target repo's declared `verify` commands (e.g. `npm run type-check`) are re-run as a final quality check; a failure blocks the PR instead of shipping broken code
- **Structured JSONL run logs** — every tool call and result is recorded to `agent-run.jsonl`, ready to upload as a CI artifact

### 🧪 Quality & DX

- **Full Vitest unit test suite** — 100% statement/branch coverage on the core engine modules
- **Three-level local testing loop** — host (`tsx`), a locally built Docker container, then full CI, so you never have to wait on GitHub Actions just to iterate
- **CI on every PR** — [GitHub Actions](https://github.com/features/actions) run the Docker build, [Biome](https://biomejs.dev/) lint/format, TypeScript check, tests with coverage, and a dependency review

---

## 📖 Table of Contents

- [✨ Features](#-features)
- [🎯 Getting Started](#-getting-started)
- [🚀 Usage](#-usage)
- [🔀 Flows](#-flows)
- [🧩 Target Repo Configuration](#-target-repo-configuration)
- [🔐 Environment Variables](#-environment-variables)
- [🧪 Testing](#-testing)
- [📁 Project Structure](#-project-structure)
- [🧰 Tech Stack](#-tech-stack)
- [🤝 Contributing](#-contributing)
- [📜 License](#-license)
- [📧 Contact & Support](#-contact--support)

---

## 🎯 Getting Started

### 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 24.x or higher (matches `docker/Dockerfile`'s `node:24-slim` base image)
- **npm** (this repo commits `package-lock.json`)
- **Git**
- **Docker** — optional, only needed for [Level 2 local testing](#-usage)
- An [Anthropic API key](https://console.anthropic.com/) and, for real (non-`DRY_RUN`) runs, a GitHub PAT with minimal scope

### 📦 Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/JanSzewczyk/szumrak.git
cd szumrak
```

#### 2. Install Dependencies

```bash
npm ci
```

#### 3. Configure Environment

```bash
cp .env.example .env
```

Fill in `ANTHROPIC_API_KEY` and `TASK` at minimum. See [Environment Variables](#-environment-variables)
for the full list.

#### 4. Run the Agent

```bash
DRY_RUN=true npm start
```

`DRY_RUN=true` is strongly recommended for a first run — see [Usage](#-usage) below.

---

## 🚀 Usage

Don't wait for GitHub Actions to check whether the agent behaves correctly. Three levels, from
fastest feedback to closest-to-production:

### Level 1 — Directly on the Host (No Docker)

The fastest feedback loop, for debugging the agent logic itself. `npm start` runs the
TypeScript source directly with `tsx` — no build step.

```bash
WORKSPACE_PATH=/path/to/local/target-repo \
TASK="Add a unit test for the formatDate helper" \
DRY_RUN=true \
ANTHROPIC_API_KEY=sk-ant-... \
npm start
```

### Level 2 — In a Locally Built Container

Validates environment isolation (missing binaries, paths, permissions).

```bash
npm run build

TARGET_REPO_PATH=/path/to/local/target-repo \
TASK="Add a unit test for the formatDate helper" \
npm run dev:run
```

`npm run build` builds the Docker image — it's also the check the `pr-check.yml` CI workflow
runs to verify the image still builds (there is no `tsc` compile step; the image is this repo's
only build artifact). The local checkout of the target repo is mounted as a volume, so changes
are visible immediately via `git diff` in that repo. `DRY_RUN=true` is set by default in the
`dev:run` script, so there is no risk of spamming the target repo with test PRs.

### Level 3 — Full Cycle in GitHub Actions

Only once the logic works at Level 1 and Level 2 — driven by a `.github/workflows/szumrak-worker.yml`
in the **target** repository (not this one), which checks out both repos and builds the image
from source. See `target-repo-templates/.github/workflows/szumrak-worker.yml` for a reference copy.

`MODE=ask` has its own dedicated, single-purpose workflow instead —
`target-repo-templates/.github/workflows/szumrak-holmes.yml` ("Szumrak Holmes 🕵️"). It takes a
single `question` input (no `task`, no mode-selection guard) and never commits, pushes, or opens
a PR, so it's kept separate from `szumrak-worker.yml`'s `runner`/`review-followup` jobs rather than
sharing their `workflow_dispatch` inputs.

Both `workflow_dispatch`-triggered jobs (`run-szumrak` in `szumrak-worker.yml`, `run-szumrak-holmes` in
`szumrak-holmes.yml`) are gated on `github.actor == github.repository_owner` — every run costs
real `ANTHROPIC_API_KEY` tokens, so a collaborator with write access (but not the repo owner)
triggering one of these workflows is blocked before the job even starts, not just discouraged.
This is on top of GitHub's own requirement that triggering `workflow_dispatch` at all needs write
access to the repo — the guard narrows that further to the owner specifically.

---

## 🔀 Flows

`MODE` selects which flow the agent runs (`src/flows/`; dispatched via `flowRegistry`,
`src/flows/registry.ts`). Three flows exist today:

- **`runner`** (`MODE=runner`, default) — runs `TASK` from scratch against a fresh checkout and,
  on success, opens a new PR. Skips the run entirely if an open PR already exists for the same
  task text (dedup).
- **`review-followup`** (`MODE=review-followup`) — continues an *existing* PR instead of starting
  over: checks out that PR's branch, re-runs the agent with the original task + current diff +
  reviewer feedback, and pushes a follow-up commit to the same branch (no new PR). Capped at 3
  automatic rounds per PR via a `review-round-N` label.
- **`ask`** (`MODE=ask`) — answers `QUESTION` about the target repository in a hard-enforced
  read-only session (no file/git writes, regardless of the target repo's own
  `.claude/agent-config.json` permissions) and writes the Markdown answer to
  `GITHUB_STEP_SUMMARY`. Never commits, pushes, or opens a PR; independent of `runner`'s `verify`
  gate. A question unrelated to the repository still succeeds — the agent declines explicitly
  instead of answering off-topic.

```text
MODE=runner              checkout main → run agent → commit → open new PR
MODE=review-followup     checkout PR branch → run agent → commit → push to same PR
MODE=ask                 run agent read-only → write answer to GITHUB_STEP_SUMMARY (no PR)
```

---

## 🧩 Target Repo Configuration

The target repository opts into agent-specific behavior via a single committed file:
`.claude/agent-config.json` (see `target-repo-templates/.claude/agent-config.json` for a starter
copy). All three fields are optional — a missing or invalid file just means "no extra
restriction beyond the default permission mode, no skills, no verify"; it never throws.

```jsonc
{
  "permissions": {
    "allow": ["Read", "Edit", "Grep", "Glob", "Bash(npm run test:*)"],
    "deny": ["Read(.env*)", "Edit(.env*)", "Bash(git push --force*)", "Bash(rm -rf*)"]
  },
  "skills": "all", // or a whitelist: ["clerk-nextjs-patterns", "clerk-setup"]
  "verify": ["npm run type-check"] // re-run after the agent finishes, before a PR opens
}
```

- **`permissions.allow` / `permissions.deny`** — map directly to the SDK's `allowedTools` /
  `disallowedTools`.
- **`skills`** — `"all"` or a name whitelist. Enables the SDK's `Skill` tool and lets the agent
  autonomously invoke whatever it finds in the target repo's own `.claude/skills/`, choosing
  based on each `SKILL.md`'s name/description — nothing to map per task. Skill *discovery* itself
  is not driven by this field; it's the target repo's `.claude/` directory being loaded at all
  (see below), which `skills` then filters.
- **`verify`** — shell-free commands (`execFileSync`, whitespace-split — no pipes/quoting) re-run
  once, after the agent's session ends, as the last gate before a PR is opened. A failure blocks
  the PR; the changes stay uncommitted. This is deliberately the *only* quality gate Szumrak
  itself runs — see below for why mid-session enforcement is left entirely to the target repo.

### Skills and hooks both come from the target repo's own `.claude/`

Szumrak loads the target repo's `.claude/settings.json` and `CLAUDE.md` during the agent's run
(`settingSources: ['project']` in the SDK). This one setting is what makes skill discovery work
at all — without it, every `Skill` call fails with `Unknown skill: ...` even when `skills: "all"`
is set, since `skills` only *filters* discovered skills rather than discovering them itself.

The same setting also means the target repo's own hooks (`settings.json`'s `PreToolUse` /
`PostToolUse` / etc.) fire during the agent's session exactly as they would in an interactive
Claude Code session — a `PostToolUse` hook running a formatter or linter after every `Edit`, for
example. **Szumrak registers no hooks of its own.** Quality control *during* a run is entirely
the target repo's own tooling; Szumrak's role is limited to the post-run `verify` gate above.
Every hook's execution — name, event, stdout/stderr, exit code — is captured in `agent-run.jsonl`
so a hook that silently fails (a script missing its executable bit, for instance) is visible
instead of running unobserved in the SDK subprocess.

> **Note:** committing a hook script from a Windows checkout can strip its executable bit
> (`git ls-files -s` showing `100644` instead of `100755`), which makes it fail with
> `Permission denied` (exit 126) the first time it runs on a Linux CI runner. Fix with
> `git update-index --chmod=+x <script>` and commit.

---

## 🔐 Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `TASK` | yes when `MODE=runner` | the task for the agent, in natural language |
| `MODE` | no (default `runner`) | `runner` runs `TASK` and opens a new PR; `review-followup` addresses review feedback on `PR_NUMBER`'s existing branch instead; `ask` answers `QUESTION` read-only |
| `PR_NUMBER` | yes when `MODE=review-followup` | PR number to follow up on |
| `REVIEW_FEEDBACK` | yes when `MODE=review-followup` | reviewer's feedback text to address |
| `QUESTION` | yes when `MODE=ask` | question for the agent to answer about the target repository, in natural language (max 1000 characters) |
| `WORKSPACE_PATH` | no (default `/workspace`) | path to the target repository |
| `REPO` | yes when opening a PR | `owner/repo` of the target repository |
| `GH_APP_ID` | yes when opening a PR | GitHub App ID |
| `GH_APP_PRIVATE_KEY` | yes when opening a PR | GitHub App private key (PEM contents) |
| `GH_APP_INSTALLATION_ID` | yes when opening a PR | GitHub App installation ID for the target repo |
| `DRY_RUN` | no | `true` skips commit/push/PR, changes stay on disk only |
| `AGENT_MODEL` | no (default: SDK default model) | Claude model alias (`haiku`, `sonnet`, `opus`) or full model ID |
| `MAX_TURNS` | no (default `30`) | agent turn limit |
| `MAX_DURATION_MS` | no (default `900000`) | run duration limit |
| `AGENT_LOG_PATH` | no (default `<WORKSPACE_PATH>/agent-run.jsonl`) | JSONL log path |
| `GITHUB_STEP_SUMMARY` | no | GH Actions-provided step summary file path; read by `src/platform/summary.ts` for failure/skip notices |

All variables are validated at startup by [`src/platform/env.ts`](./src/platform/env.ts) — an invalid or missing
required variable prints a readable error list and exits before any API call is made. See
[`.env.example`](./.env.example) for a ready-to-copy template with inline descriptions.

---

## 🧪 Testing

```bash
npm test            # vitest run — single pass, what CI runs
npm run test:watch  # vitest — interactive watch mode
npm run test:coverage # vitest run --coverage
```

Tests are colocated with source (`src/foo.ts` → `src/foo.test.ts`) and mock every external
effect — no real git commands, GitHub API calls, Claude API calls, or filesystem writes happen
while running the suite. `src/platform/env.ts` and `src/index.ts` are excluded from coverage on
purpose: `env.ts` validates and can `process.exit(1)` at import time, and `index.ts` is a thin
entrypoint that calls `main()` immediately on import rather than holding testable logic itself.

---

## 📃 Scripts Overview

| Script | Description |
| --- | --- |
| `npm start` | Run the agent (`tsx src/index.ts`, no compile step) |
| `npm run build` | Build the Docker image — also the CI "build" check |
| `npm run dev:run` | Run the built image against `$TARGET_REPO_PATH` (local only, `DRY_RUN` on) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `vitest run` — single pass, what CI runs |
| `npm run test:watch` | `vitest` — interactive watch mode |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run biome:check` | Biome lint + format check |
| `npm run biome:fix` | Biome lint + format, writing fixes |
| `npm run biome:lint` | Biome lint only |
| `npm run biome:lint:fix` | Biome lint only, writing fixes |
| `npm run biome:format` | Biome format check only |
| `npm run biome:format:fix` | Biome format only, writing fixes |
| `npm run biome:ci` | Biome check with the GitHub Actions reporter (used in CI) |

---

## 📁 Project Structure

```text
szumrak/
├── .github/
│   ├── workflows/            # CI: build, Biome, typecheck, tests+coverage, dependency review, CodeQL
│   └── dependabot.yml
├── .claude/
│   └── rules/                 # synced code-style conventions (function keyword, no arrow-fn declarations)
├── docker/
│   └── Dockerfile              # tsx entrypoint — no compile step, no dist/
├── src/
│   ├── index.ts                 # entrypoint — guards required env, dispatches to a flow by MODE
│   ├── types/                     # types/enums shared across layers (flows AND platform need them)
│   │   └── mode.ts                  # const Mode { RUNNER, REVIEW_FOLLOWUP, ASK } — single source of truth for MODE
│   ├── flows/                     # one flow per orchestration path, each in its own folder
│   │   ├── registry.ts               # Record<Mode, runner> — the only place index.ts dispatches through
│   │   ├── types.ts                   # shared FlowResult contract
│   │   ├── runner/                     # MODE=runner — run TASK from scratch and open a new PR
│   │   ├── review-followup/             # MODE=review-followup — continue an existing PR's branch
│   │   └── ask/                          # MODE=ask — answer QUESTION read-only, no PR
│   ├── agent/                       # reusable Claude Agent SDK wrapper, used by every flow
│   │   ├── run-agent.ts               # wraps the SDK query() stream; hook/skill/CLAUDE.md loading lives here
│   │   ├── agent-config.ts             # loads the target repo's .claude/agent-config.json
│   │   ├── verify.ts                    # runs the target repo's `verify` commands (post-run gate)
│   │   └── commit-metadata.ts            # Conventional Commits type/scope/subject parsing
│   ├── github/                      # everything that touches git/GitHub, used by every flow
│   │   ├── client.ts                  # Octokit client (GitHub App auth)
│   │   ├── git-operations.ts           # git() CLI wrapper, checkout/diff/push
│   │   ├── pull-requests.ts             # commitAndOpenPR
│   │   ├── repo.ts                       # parseRepo("owner/repo")
│   │   ├── dedup.ts                       # skip re-running a task with an already-open PR
│   │   └── run-info.ts                     # cost/round table appended to the PR body
│   └── platform/                    # cross-cutting infra: env, logging, CI step summaries
│       ├── env.ts                     # Zod + T3 Env — the single source of validated configuration
│       ├── logger.ts                   # structured JSONL logging
│       └── summary.ts                   # GITHUB_STEP_SUMMARY writer
├── target-repo-templates/         # files meant to be copied INTO the target repo, not consumed here
│   ├── CLAUDE.md
│   ├── .claude/agent-config.json    # permissions / skills / verify — see Target Repo Configuration
│   └── .github/workflows/
│       ├── szumrak-worker.yml          # runner + review-followup jobs
│       └── szumrak-holmes.yml          # MODE=ask only — single `question` input, no PR/commit
├── biome.json
├── vitest.config.ts
├── tsconfig.json
└── .env.example
```

### Key Directories

- **`src/types/`** — types/enums shared across layers, e.g. `Mode`, needed by both `flows/` and
  `platform/env.ts`; kept out of `flows/` so `platform/` doesn't have to import from a "higher"
  layer to validate `MODE`
- **`src/flows/`** — one folder per orchestration flow (`runner`, `review-followup`, ...); adding a
  new flow means adding a folder here plus a `Mode` value and a `flowRegistry` entry, without
  touching existing flows
- **`src/agent/`** and **`src/github/`** — reusable building blocks every flow composes: the SDK
  wrapper and the git/GitHub integration, respectively
- **`src/platform/`** — env validation, logging, and CI summaries; no flow-specific logic
- **`target-repo-templates/`** — starter `CLAUDE.md` / `.claude/agent-config.json` /
  `.github/workflows/szumrak-worker.yml` for the *target* repository the agent will operate on, not for
  this repo

See [`CLAUDE.md`](./CLAUDE.md) for the full execution flow through these modules.

### Important Configuration Files

- **`src/platform/env.ts`** — validated runtime configuration (see [Environment Variables](#-environment-variables))
- **`vitest.config.ts`** — test runner config, including the `~/*` path alias resolution tests need
- **`docker/Dockerfile`** — the only build artifact this repo produces

---

## 🧰 Tech Stack

**Core**

[![Claude Agent SDK](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/@anthropic-ai/claude-agent-sdk?label=Claude%20Agent%20SDK)](https://docs.claude.com/en/api/agent-sdk/overview)
[![Octokit](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/@octokit/rest?logo=github&logoColor=white&label=Octokit)](https://github.com/octokit/rest.js)
[![T3 Env](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/@t3-oss/env-core?label=T3%20Env)](https://env.t3.gg/)
[![Zod](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/zod?logo=zod&logoColor=white&label=Zod)](https://zod.dev/)
[![tsx](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/tsx?label=tsx)](https://tsx.is/)

**Dev & Quality**

[![TypeScript](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/dev/typescript?logo=typescript&logoColor=white&label=TypeScript)](https://www.typescriptlang.org/)
[![Biome](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/dev/@biomejs/biome?logo=biome&logoColor=white&label=Biome)](https://biomejs.dev/)
[![Vitest](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/dev/vitest?logo=vitest&logoColor=white&label=Vitest)](https://vitest.dev/)
[![Vitest Coverage](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/dev/@vitest/coverage-v8?logo=vitest&logoColor=white&label=Vitest%20Coverage)](https://vitest.dev/guide/coverage)
[![@types/node](https://img.shields.io/github/package-json/dependency-version/JanSzewczyk/szumrak/dev/@types/node?label=%40types%2Fnode)](https://www.npmjs.com/package/@types/node)

---

## 🤝 Contributing

This is a private (`package.json#private: true`), single-maintainer project — it isn't set up
to accept outside forks. If you're working in this repo:

1. Follow the conventions in [`.claude/rules/code-style.md`](../claude-plugins/plugins/shared-rules/skills/sync-rules/rules/code-style.md) and [`CLAUDE.md`](./CLAUDE.md)
2. Before opening a PR, run `npm run typecheck`, `npm run biome:check`, and `npm test` locally — the same checks CI runs
3. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`/`fix:`/`chore:`)

---

## 📜 License

No `LICENSE` file is present in this repository, and `package.json` declares `"private": true`.
No license is granted for reuse or redistribution — do not assume MIT or any other license applies.

---

## 📧 Contact & Support

- 🐛 [Open an issue](https://github.com/JanSzewczyk/szumrak/issues)
- ⭐ [Star this repository](https://github.com/JanSzewczyk/szumrak)
- 👨‍💻 Check out the maintainer's [GitHub profile](https://github.com/JanSzewczyk)

---

<div align="center">

**Made with ❤️ by [JanSzewczyk](https://github.com/JanSzewczyk)**

[⬆ Back to Top](#-szumrak)

</div>
