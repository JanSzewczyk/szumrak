# Integrating Szumrak with a target repository

This document walks through the **entire process** of connecting the Szumrak
engine (this repository) to any target repository on GitHub — from scratch,
step by step: GitHub App, secrets, template files, first run, and
troubleshooting common issues.

Audience: someone who has a target repository (e.g. `owner/my-app`) and wants
Szumrak to be able to autonomously perform tasks in it, open PRs, and answer
questions about the code.

> A condensed overview of the architecture and `MODE` flags lives in the main
> [`README.md`](../README.md). This document is the operational
> runbook — "what to click/copy/set", not a description of the internal
> architecture.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Step 1 — create a GitHub App](#step-1--create-a-github-app)
3. [Step 2 — install the App on the target repository](#step-2--install-the-app-on-the-target-repository)
4. [Step 3 — set secrets on the target repository](#step-3--set-secrets-on-the-target-repository)
5. [Step 4 — copy the template files](#step-4--copy-the-template-files)
6. [Step 5 — customize `CLAUDE.md` and `agent-config.json`](#step-5--customize-claudemd-and-agent-configjson)
7. [Step 6 — check hook executable bits](#step-6--check-hook-executable-bits)
8. [Step 7 — first run](#step-7--first-run)
9. [Versioning: `uses:@ref` vs `szumrakEngineVersion`](#versioning-usesref-vs-szumrakengineversion)
10. [Full environment variable / secret reference](#full-environment-variable--secret-reference)
11. [Troubleshooting](#troubleshooting)

---

## 1. Prerequisites

- Owner/admin access to the target repository (to install the GitHub App and
  add secrets under **Settings → Secrets and variables → Actions**).
- Permission to create a GitHub App on the account/organization that will act
  as the "bot" opening PRs (this can be a personal account if the target
  repository belongs to the same owner).
- An [Anthropic API key](https://console.anthropic.com/) (`ANTHROPIC_API_KEY`).
- The target repository must have GitHub Actions enabled.

---

## Step 1 — create a GitHub App

Szumrak does **not** use `GITHUB_TOKEN` or a personal PAT to push and open
PRs — it authenticates as a dedicated **GitHub App** (e.g. named
`szumrak-bot`), so PRs show up authored by `szumrak-bot[bot]` rather than a
specific user.

1. Go to `https://github.com/settings/apps/new` (for a personal account) or
   `https://github.com/organizations/<org>/settings/apps/new` (for an
   organization).
2. **GitHub App name**: any unique name, e.g. `szumrak-bot`.
3. **Homepage URL**: can point at this repo (`https://github.com/JanSzewczyk/szumrak`).
4. **Webhook**: uncheck "Active" — Szumrak doesn't use webhooks.
5. **Repository permissions** — set exactly these three:
   - **Contents**: `Read and write` — to push commits/branches.
   - **Pull requests**: `Read and write` — to open PRs and apply labels.
   - **Workflows**: `Read and write` — **required** if the target
     repository has any files under `.github/workflows/` (and it will, since
     that's exactly where you're about to paste the Szumrak template).
     Without this permission, GitHub rejects *every* push made by the agent
     with:
     ```
     ! [remote rejected] <branch> -> <branch> (refusing to allow a GitHub App
       to create or update workflow `.github/workflows/szumrak-worker.yml`
       without `workflows` permission)
     ```
     This restriction applies to the whole set of commits being pushed by the
     App, not just commits that actually change a workflow file — so it's
     effectively required at all times, even when the agent's task has
     nothing to do with CI.
6. Save the App (**Create GitHub App**).
7. On the App's settings page, note the **App ID** (shown near the top) —
   this is the value for the `GH_APP_ID` secret.
8. Under **Private keys**, click **Generate a private key** — this downloads
   a `.pem` file. Its **full contents** (including the
   `-----BEGIN/END RSA PRIVATE KEY-----` lines) is the value for the
   `GH_APP_PRIVATE_KEY` secret.

---

## Step 2 — install the App on the target repository

1. On the App's settings page, click **Install App** (left sidebar).
2. Pick the account/organization and **Only select repositories** → select
   the target repository (e.g. `owner/my-app`).
3. After installing, open the installation URL — it looks like
   `https://github.com/settings/installations/<installation_id>` (for a
   personal account) or the organization-settings equivalent. The trailing
   number is the **Installation ID** — the value for
   `GH_APP_INSTALLATION_ID`.

> **Important — accepting permission updates.** If you ever change the
> App's permissions (e.g. add `Workflows: Read and write` after the fact),
> changing the App's settings alone is **not enough**. Every installation
> must separately **accept the new permissions** — go to
> `https://github.com/settings/installations` (or the organization
> equivalent), find the App, and click **Review request** /
> **Accept new permissions**. Without this step the token keeps operating
> under the old permissions despite the App settings change — it shows the
> exact same `without 'workflows' permission` error as not having the
> permission at all.

---

## Step 3 — set secrets on the target repository

In the target repository: **Settings → Secrets and variables → Actions →
New repository secret**. Add four secrets:

| Secret name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | key from [console.anthropic.com](https://console.anthropic.com/) |
| `GH_APP_ID` | App ID from step 1.7 |
| `GH_APP_PRIVATE_KEY` | full contents of the `.pem` file from step 1.8 |
| `GH_APP_INSTALLATION_ID` | Installation ID from step 2.3 |

Via CLI (`gh`), from the target repository:

```bash
gh secret set ANTHROPIC_API_KEY --body "sk-ant-..."
gh secret set GH_APP_ID --body "123456"
gh secret set GH_APP_PRIVATE_KEY < path/to/private-key.pem
gh secret set GH_APP_INSTALLATION_ID --body "78901234"
```

These four names are **fixed** — the reusable workflows in this repo
(`_worker-run.yml`, `_worker-review-followup.yml`, `_holmes.yml`) expect
exactly these keys in their `secrets:` block. If a secret is named
differently in the target repository (e.g. you already have
`ANTHROPIC_KEY` for another reason), pass it explicitly instead of using
`secrets: inherit` — see [Step 4](#step-4--copy-the-template-files).

---

## Step 4 — copy the template files

Every file that ends up in the target repository lives in this repo under
[`target-repo-templates/`](../target-repo-templates/) — nothing under `src/`
is needed there (that's the engine, built in the target repo's own CI, not
copied).

```bash
# from the local checkout of the target repository
mkdir -p .github/workflows .claude
cp /path/to/szumrak/target-repo-templates/.github/workflows/szumrak-worker.yml .github/workflows/
cp /path/to/szumrak/target-repo-templates/.github/workflows/szumrak-holmes.yml .github/workflows/
cp /path/to/szumrak/target-repo-templates/.claude/agent-config.json .claude/
cp /path/to/szumrak/target-repo-templates/CLAUDE.md ./CLAUDE.md   # only if the repo doesn't already have one
```

What each file does:

- **`.github/workflows/szumrak-worker.yml`** — a thin caller for the
  `workflow_dispatch` trigger (`task` input), plus `pull_request_review` and
  `pull_request_review_comment` (`review-followup` mode). All the actual
  logic (checkout, image build, running the agent) is hosted in this repo as
  a reusable workflow (`_worker-run.yml` / `_worker-review-followup.yml`) —
  see [README → Level 3](../README.md#level-3--full-cycle-in-github-actions).
- **`.github/workflows/szumrak-holmes.yml`** — a thin caller for `MODE=ask`
  (`_holmes.yml`), a read-only mode with no commits/PRs.
- **`.claude/agent-config.json`** — opt-in configuration: agent permissions,
  skill whitelist, `verify` commands, engine version pin. Covered in detail
  in [Step 5](#step-5--customize-claudemd-and-agent-configjson).
- **`CLAUDE.md`** — project instructions for the agent (architecture,
  conventions). If the target repository **already has** a `CLAUDE.md` used
  by interactive Claude Code sessions, leave it as is — Szumrak reads that
  same existing `CLAUDE.md`; there's nothing extra to do.

**Customize the triggers in `szumrak-worker.yml`** if you want a different
model or timeout — see the examples below and the
[Target Repo Configuration](../README.md#-target-repo-configuration) section
in the README.

---

## Step 5 — customize `CLAUDE.md` and `agent-config.json`

### `CLAUDE.md`

Fill it in with the real architecture of the target repository — the
"Architecture", "Where to start looking", "Strict import boundaries",
"Stack", "Conventions", and "How to verify your work" sections in the copied
file are placeholders meant to be replaced. The better the `CLAUDE.md`, the
more accurate the agent's changes — it's the same file a human would read in
an interactive Claude Code session (`settingSources: ['project']` loads it
automatically; Szumrak does nothing extra here).

### `.claude/agent-config.json`

```jsonc
{
  "permissions": {
    "allow": ["Read", "Edit", "Grep", "Glob", "Bash(npm run test:*)"],
    "deny": ["Read(.env*)", "Edit(.env*)", "Bash(git push --force*)", "Bash(rm -rf*)"]
  },
  "skills": "all", // or a whitelist: ["clerk-nextjs-patterns", "clerk-setup"]
  "verify": ["npm run type-check"], // re-run after the agent's session, before opening a PR
  "szumrakEngineVersion": "main" // or a specific tag, e.g. "v1.13.0"
}
```

All fields are optional — a missing file or invalid JSON just means "no
extra restriction, no skills, no verify" (it never throws). Detailed
description of each field:
[README → Target Repo Configuration](../README.md#-target-repo-configuration).

**Recommendation for a first setup:** start with a restrictive `deny` list
(blocking `.env*`, `middleware.ts`, `git push --force`, `rm -rf`) and a
`verify` entry for the most important command (typecheck/lint) — it's easier
to loosen than to discover a problem after the fact.

---

## Step 6 — check hook executable bits

If the target repository has its own hooks under `.claude/hooks/*.sh`
(run by `settings.json`, e.g. a formatter after `Edit`), make sure the
executable bit is set **in the git index**, not just on disk:

```bash
git ls-files --stage .claude/hooks/*.sh
```

Mode `100644` instead of `100755` means the hook will fail with
`Permission denied` (exit 126) the first time it runs on a Linux CI runner —
a common side effect of committing from a Windows checkout, where the
filesystem doesn't preserve the executable bit. Fix and commit:

```bash
git update-index --chmod=+x .claude/hooks/type-check.sh
git commit -m "fix(hooks): mark type-check.sh as executable"
```

This doesn't block the agent's session (hooks run best-effort, and the
failure is only logged to `agent-run.jsonl`), but without this fix that
particular quality check silently does nothing instead of actually running.

---

## Step 7 — first run

1. Commit and push the files from Steps 4–6 to the default branch (`main`).
2. Trigger a manual run via `workflow_dispatch`:

   ```bash
   gh workflow run szumrak-worker.yml -f task="Add a unit test for the formatDate helper"
   ```

   or from the GitHub UI: **Actions → Szumrak Worker 👷‍♂️ → Run workflow**.

   The run is blocked for everyone except the repo owner
   (`github.actor == github.repository_owner`) — another collaborator with
   write access can't trigger it by accident and burn your API tokens.

3. Watch the run:

   ```bash
   gh run watch --exit-status
   ```

4. On success, check the opened PR (`gh pr list`) — it should carry the
   `ai-generated` label, be authored by `<app-name>[bot]`, and its
   description should contain the original task plus a cost summary.
5. Test the read-only mode too:

   ```bash
   gh workflow run szumrak-holmes.yml -f question="How is the src/ directory organized?"
   ```

   The answer lands in that run's **Summary** tab (`GITHUB_STEP_SUMMARY`),
   never in a PR or commit.

---

## Versioning: `uses:@ref` vs `szumrakEngineVersion`

These are two **independent** versioning axes — easy to conflate:

| What | Where | What it controls |
| --- | --- | --- |
| `uses: JanSzewczyk/szumrak/.github/workflows/_worker-run.yml@<ref>` | `szumrak-worker.yml` in the target repo | which version of the **workflow YAML logic** (steps, checkout, build) runs |
| `szumrakEngineVersion` in `.claude/agent-config.json` | target repo | which **engine release** (the Docker image with the agent code) is built inside that logic |

By default both point at `main` — the latest changes on either layer reach
the target repository automatically on every run, with no action needed on
your part. To freeze behavior and upgrade deliberately:

```yaml
# szumrak-worker.yml
uses: JanSzewczyk/szumrak/.github/workflows/_worker-run.yml@v1.13.0
```

```jsonc
// .claude/agent-config.json
{ "szumrakEngineVersion": "v1.13.0" }
```

You can pin one axis while leaving the other on `main` — they don't need to
match.

---

## Full environment variable / secret reference

The table below combines two contexts: **GitHub repository secrets** (Step 3,
always required for real runs through Actions) and the reusable workflows'
**inputs** (optional, overridable in the target repo's
`szumrak-worker.yml`/`szumrak-holmes.yml` via `with:`).

### GitHub Secrets (target repo → Settings → Secrets and variables → Actions)

| Secret | Required | Where to get it |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | always | [console.anthropic.com](https://console.anthropic.com/) |
| `GH_APP_ID` | always | GitHub App settings page |
| `GH_APP_PRIVATE_KEY` | always | generated `.pem` file (full contents) |
| `GH_APP_INSTALLATION_ID` | always | the App's installation page URL |

Passed to the reusable workflow via `secrets: inherit` in
`szumrak-worker.yml`/`szumrak-holmes.yml` — see Step 4. If a secret is named
differently in the target repo, replace `secrets: inherit` with explicit
mapping:

```yaml
uses: JanSzewczyk/szumrak/.github/workflows/_worker-run.yml@main
with:
  task: ${{ github.event.inputs.task }}
secrets:
  ANTHROPIC_API_KEY: ${{ secrets.MY_OTHER_KEY_NAME }}
  GH_APP_ID: ${{ secrets.GH_APP_ID }}
  GH_APP_PRIVATE_KEY: ${{ secrets.GH_APP_PRIVATE_KEY }}
  GH_APP_INSTALLATION_ID: ${{ secrets.GH_APP_INSTALLATION_ID }}
```

### Reusable workflow inputs (`with:` in the target repo)

| Input | Reusable workflow | Required | Default | Overridable in target repo? |
| --- | --- | --- | --- | --- |
| `task` | `_worker-run.yml` | yes | — | yes, typically `${{ github.event.inputs.task }}` |
| `pr_number` | `_worker-review-followup.yml` | yes | — | yes, typically `${{ github.event.pull_request.number }}` |
| `review_feedback` | `_worker-review-followup.yml` | yes | — | yes, built from `github.event.review.body` / an inline comment |
| `question` | `_holmes.yml` | yes | — | yes, typically `${{ github.event.inputs.question }}` |
| `agent_model` | all three | no | `haiku` | yes — e.g. `sonnet` for harder tasks |
| `timeout_minutes` | all three | no | `20` | yes — e.g. `45` for larger repos/tasks |

Variables that are **not** inputs (computed inside the reusable workflow,
with no way to override them from `with:`): `SZUMRAK_REF` (derived from
`szumrakEngineVersion` in `agent-config.json` — see the section above),
`REPO` (always `${{ github.repository }}` of the target repo).

### Engine environment variables (local development only, Levels 1/2 from the README)

Full list in [README → Environment Variables](../README.md#-environment-variables)
and [`.env.example`](../.env.example) — these apply to running Szumrak
directly (`npm start`) or in a local container (`npm run dev:run`), not to
the GitHub Actions integration described in this document.

---

## Troubleshooting

### `refusing to allow a GitHub App to create or update workflow ... without 'workflows' permission`

The GitHub App is missing the **Workflows: Read and write** permission, or
has it declared but the installation on this repo/account hasn't accepted
the permission update yet. See [Step 1](#step-1--create-a-github-app) and the
note in [Step 2](#step-2--install-the-app-on-the-target-repository) about
accepting new permissions at
`https://github.com/settings/installations`.

### A hook fails with `Permission denied` (exit 126) in `agent-run.jsonl`

The hook script's executable bit was lost when committing from Windows —
see [Step 6](#step-6--check-hook-executable-bits).

### `workflow_dispatch` doesn't trigger for a collaborator

Expected behavior — the `github.actor == github.repository_owner` guard in
both templates blocks the run for anyone but the repo owner (see Step 7.2).
To allow other people, change the `if:` condition in the copied
`szumrak-worker.yml`/`szumrak-holmes.yml` — deliberately, since every run
burns real `ANTHROPIC_API_KEY` tokens.

### `Unknown skill: ...` despite `"skills": "all"` in `agent-config.json`

`skills` only *filters* skills already discovered by the SDK — discovery
depends on the target repo's `.claude/` being loaded at all
(`settingSources: ['project']`, hardcoded in the engine). Make sure the
skills actually live at `.claude/skills/<name>/SKILL.md` in the target repo.

### Checking out `szumrak-src` fails on a nonexistent tag

`szumrakEngineVersion` in `agent-config.json` points at a tag that doesn't
exist in [this repo's releases](https://github.com/JanSzewczyk/szumrak/releases).
Fix the tag, or remove the field to fall back to `main`.

### The PR doesn't open despite a successful agent session

Check the `Run Szumrak` step in the GitHub Actions log
(`gh run view <id> --log-failed`) — the most common causes are a missing or
incorrect secret (`GH_APP_*`), missing `workflows` permission (see above), or
a failure returned by `verify` (the agent's session ends successfully, but
the post-run `verify` from `agent-config.json` blocks the PR).
