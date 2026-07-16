# Review: Agent Reliability Improvements

**Branch:** feat/agent-reliability-improvements
**Date:** 2026-07-16
**Verdict:** GO

## Spec compliance (spec-guard)
- Satisfied AC: 9/9 (AC1–AC9)
- Missing: none
- Out of scope: none

## Drift (drift-detector)
- 2 minor doc-drift items found, both fixed before this review:
  - `CLAUDE.md` was missing the planned invariant note about `hook-preflight.ts`'s `sh -n -c`
    dry-run-only guarantee — added under "Invariants — do not regress these".
  - `plan.md` named the pre-flight result type `HookPreflightResult`; the actual export is
    `HookHealthReport` — plan.md corrected to match the code.
- No critical drift.

## Security audit (reviewer)
- `hook-preflight.ts`'s `execFileSync("/bin/sh", ["-n", "-c", command])` verified safe: argument
  array (no shell interpolation) + `-n` (parse-only, never executes) — confirmed empirically that
  neither direct commands nor `$(...)` substitutions execute.
- Secret redaction respected (`hook-preflight.ts` logs only through `platform/logger`'s `log()`).
- `postPrComment` uses parameterized Octokit calls, no string interpolation into the API surface.
- Hardening applied during review: the "Resolve Szumrak engine ref" workflow step now validates
  the resolved tag against `^[A-Za-z0-9._/-]+$` before writing it to `$GITHUB_ENV`, closing a
  low-risk newline-injection vector flagged by the reviewer (target repo config is a trust
  boundary even under the owner-only `workflow_dispatch` gate).

## Test coverage
- Unit + integration: 141/141 passed (16 test files)
- Typecheck: clean (`tsc --noEmit`)
- Lint/format: clean (`biome check .`, 53 files)
- AC → test mapping:
  - AC1/AC2/AC4 → `src/agent/run-agent.test.ts` ("repeated-action loop detection")
  - AC3 → `src/flows/review-followup/run-review-followup-flow.test.ts` + `src/github/pull-requests.test.ts`
  - AC5/AC6 → `target-repo-templates/.github/workflows/szumrak-worker.yml` + `szumrak-holmes.yml` (verified by inspection/manual jq simulation; not unit-testable, CI YAML)
  - AC7/AC8/AC9 → `src/agent/hook-preflight.test.ts` + `src/agent/run-agent.test.ts` ("hook pre-flight check")
- E2E: not applicable — no UI, CLI engine.
- A11y: not applicable — no UI.

## Verdict
- ✅ GO — all checks green. No blockers. One optional hardening note was applied inline
  (workflow tag validation) rather than left open.
