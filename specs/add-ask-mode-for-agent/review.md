# Review: Add Ask Mode For Agent

**Branch:** feat/add-ask-mode-for-agent
**Date:** 2026-07-16
**Verdict:** GO

## Spec compliance (spec-guard)

- Satisfied AC: 9/9 (AC1-AC9)
- Missing: none
- Out of scope: none
- Note: an initial per-feature spec-guard pass flagged FR5 (decline off-topic questions) and FR7
  (Markdown answer with `file_path:line_number` citations, exact code excerpts on request) as
  present in the flow/tests but never actually instructed to the model anywhere. Fixed by adding
  `src/agent/ask-instructions.ts` (`ASK_MODE_INSTRUCTIONS`), appended to the system prompt instead
  of `COMMIT_METADATA_INSTRUCTIONS` whenever `runAgent` is called with `{ readOnly: true }`. A
  second, final spec-guard pass confirmed `satisfied: true` with all 9 ACs covered.
- Mid-review scope change: the user requested a dedicated, single-purpose workflow
  (`szumrak-holmes.yml`) for `MODE=ask` instead of the originally-planned shared-workflow
  mode-selection guard inside `szumrak.yml` (T3.3). `spec.md`/`plan.md`/`tasks.md` were updated
  (new FR11, new Story S4: T4.1-T4.3), `szumrak.yml` was reverted to its exact pre-feature shape
  (`git diff main -- target-repo-templates/.github/workflows/szumrak.yml` is empty), and the new
  workflow file was added and spec-guard-checked on its own before the final feature-wide pass.

## Drift (drift-detector)

- 14 items aligned (every FR/AC has a plan.md entry, a tasks.md task, and a code counterpart with
  test coverage).
- 1 item found and fixed: `src/agent/ask-instructions.ts` wasn't listed in plan.md's file-by-file
  list or in any task's `files:` array (the prompt-instructions string was factored into its own
  module, a reasonable implementation choice, but undocumented). Fixed: added to plan.md and to
  T1.2's `files:` array in tasks.md.
- 0 critical items.

## Domain-specific audits

- No `.tsx`/`.jsx`/UI files in this diff (szumrak has no frontend) — react-doctor, accessibility-audit,
  and ui-critic all skipped per `specs/capabilities.md`'s stack profile (standalone CLI/engine, no
  UI).

## Test coverage

- Unit (Vitest): 126/126 passing across 15 test files, including:
  - `src/agent/run-agent.test.ts` — 22 tests (3 new: readOnly `allowedTools`/`permissionMode`
    lockdown, config-merge rejection, ask-mode system-prompt swap).
  - `src/flows/ask/run-ask-flow.test.ts` — 4 tests (success, long-answer wrapping, off-topic
    decline, failure — all asserting `commitAndOpenPR` is never called).
- `npm run typecheck` — clean.
- `npm run biome:check` — clean (51 files).
- Integration/E2E: the one live, real-`ANTHROPIC_API_KEY`/`WORKSPACE_PATH` end-to-end verification
  called for in T3.1's acceptance text (`DRY_RUN=true MODE=ask` against a real target repo,
  confirming exit 0 / an answer written / clean `git status`) was explicitly deferred — no API key
  or target repo checkout was available in this session. This is a manual follow-up for the human,
  not a code defect (static code inspection + the unit suite confirm the dispatch path is wired
  correctly).

## Verdict

- ✅ **GO** — all checks green. One deferred manual step: run a real end-to-end `MODE=ask` verification
  against a live target repo before or shortly after merge, per T3.1's acceptance text.
