# Szumrak

An autonomous agent that performs narrow, highly verifiable tasks on target
repositories, built on top of the Claude Agent SDK. For the full concept and
architectural decisions, see the Notion documentation, page "Rollout plan —
phases, requirements, priorities".

## Status

Skeleton stage of the rollout plan. The engine runs locally and in a container.
The agent currently runs **without any skills** — CI integration and an optional
skills layer are later steps.

## Structure

```
szumrak/
├── docker/Dockerfile
├── src/
│   ├── index.ts        # entrypoint
│   ├── run-agent.ts     # wrapper around the Claude Agent SDK
│   ├── git.ts          # commit/push/PR
│   ├── config.ts       # limits, constants
│   └── logger.ts       # structured logging to JSONL
└── target-repo-templates/  # files to copy INTO the target repo
    ├── CLAUDE.md
    └── .claude/
        └── settings.json
```

## Required environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Claude API key |
| `TASK` | yes | the task for the agent |
| `WORKSPACE_PATH` | no (default `/workspace`) | path to the target repository |
| `REPO` | yes when opening a PR | `owner/repo` of the target repository |
| `GH_TOKEN` | yes when opening a PR | PAT with minimal scope |
| `DRY_RUN` | no | `true` skips commit/push/PR, changes stay on disk only |
| `MAX_TURNS` | no (default 30) | agent turn limit |
| `MAX_DURATION_MS` | no (default 900000) | run duration limit |
| `AGENT_LOG_PATH` | no (default `<WORKSPACE_PATH>/agent-run.jsonl`) | JSONL log path |

## Local testing — three levels

Don't wait for GitHub Actions to check whether the agent correctly reads the
target repo's `CLAUDE.md`. Recommended order of work:

### Level 1 — directly on the host (no Docker)

The fastest feedback loop, for debugging the agent logic itself. `npm start` runs
the TypeScript source directly with tsx — no build step.

```bash
WORKSPACE_PATH=/path/to/local/target-repo \
TASK="Add a unit test for the formatDate helper" \
DRY_RUN=true \
ANTHROPIC_API_KEY=sk-ant-... \
npm start
```

### Level 2 — in a locally built container

Validates environment isolation (missing binaries, paths, permissions).

```bash
npm run dev:build

TARGET_REPO_PATH=/path/to/local/target-repo \
TASK="Add a unit test for the formatDate helper" \
npm run dev:run
```

The local checkout of the target repo is mounted as a volume — changes are
visible immediately via `git diff` in that repo. `DRY_RUN=true` is set by default
in the `dev:run` script, so there is no risk of spamming the repo with test PRs.

### Level 3 — full cycle in GitHub Actions

Only once the logic works at Level 1 and Level 2 — see `.github/workflows/agent.yml`
in the target repo (a later rollout phase, not yet implemented in this repo).

## Note on the SDK dependency

`@anthropic-ai/claude-agent-sdk` is updated frequently. Before making larger
changes in `src/run-agent.ts`, verify the current API shape directly in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — the online docs can lag
behind the actually published version.
