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

### 🔒 Safety & Git Integration

- **Command-injection-hardened git operations** — every git call goes through `execFileSync` with an argument array, never a shell-interpolated string, because the triggering task text is untrusted input
- **Automatic PR creation** — commits, pushes a branch, opens a PR via the GitHub API ([Octokit](https://github.com/octokit/rest.js)), and labels it `ai-generated`
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

Only once the logic works at Level 1 and Level 2 — driven by a `.github/workflows/szumrak.yml`
in the **target** repository (not this one), which checks out both repos and builds the image
from source. See `target-repo-templates/.github/workflows/szumrak.yml` for a reference copy.

---

## 🔐 Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `TASK` | yes | the task for the agent, in natural language |
| `WORKSPACE_PATH` | no (default `/workspace`) | path to the target repository |
| `REPO` | yes when opening a PR | `owner/repo` of the target repository |
| `GH_TOKEN` | yes when opening a PR | PAT with minimal scope |
| `DRY_RUN` | no | `true` skips commit/push/PR, changes stay on disk only |
| `AGENT_MODEL` | no (default: SDK default model) | Claude model alias (`haiku`, `sonnet`, `opus`) or full model ID |
| `MAX_TURNS` | no (default `30`) | agent turn limit |
| `MAX_DURATION_MS` | no (default `900000`) | run duration limit |
| `AGENT_LOG_PATH` | no (default `<WORKSPACE_PATH>/agent-run.jsonl`) | JSONL log path |

All variables are validated at startup by [`src/env.ts`](./src/env.ts) — an invalid or missing
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
while running the suite. `src/env.ts` and `src/index.ts` are excluded from coverage on purpose:
`env.ts` validates and can `process.exit(1)` at import time, and `index.ts` is a thin entrypoint
that calls `main()` immediately on import rather than holding testable logic itself.

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
│   ├── index.ts                 # entrypoint — guards required env, runs the agent, opens the PR
│   ├── run-agent.ts             # wraps the Claude Agent SDK query() stream
│   ├── git.ts                    # branch → commit → push → PR (commitAndOpenPR)
│   ├── env.ts                     # Zod + T3 Env — the single source of validated configuration
│   ├── *.test.ts                  # colocated Vitest suites
│   └── lib/
│       ├── github.ts               # Octokit client
│       └── logger.ts                # structured JSONL logging
├── target-repo-templates/         # files meant to be copied INTO the target repo, not consumed here
│   ├── CLAUDE.md
│   └── .claude/settings.json
├── biome.json
├── vitest.config.ts
├── tsconfig.json
└── .env.example
```

### Key Directories

- **`src/`** — the agent engine itself; see [`CLAUDE.md`](./CLAUDE.md) for the full execution flow
- **`target-repo-templates/`** — starter `CLAUDE.md` / `.claude/settings.json` for the *target*
  repository the agent will operate on, not for this repo

### Important Configuration Files

- **`src/env.ts`** — validated runtime configuration (see [Environment Variables](#-environment-variables))
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

1. Follow the conventions in [`.claude/rules/code-style.md`](./.claude/rules/code-style.md) and [`CLAUDE.md`](./CLAUDE.md)
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
