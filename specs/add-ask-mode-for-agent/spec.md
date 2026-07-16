# Feature: Add Ask Mode For Agent

**Branch:** feat/add-ask-mode-for-agent
**Status:** done  <!-- lifecycle: draft → clarified → planned → in-progress → done; advanced automatically by each /sdd command -->
**Type:** feat  <!-- feat | fix | chore | refactor | docs -->
**Owner:** JanSzewczyk
**Created:** 2026-07-16

---

## Summary (business)

Give the agent a mode where, instead of editing the target repository and opening a PR, it researches the target repository in response to a question and returns a written answer about the project.

## User stories

- As a **maintainer**, I want to trigger an "ask" mode via `workflow_dispatch` on a **dedicated reusable workflow** (`szumrak-holmes.yml`, single-purpose — a `question` input only, no task/mode selection), so that I can ask a question about the target repository without the agent touching any files, and without a shared workflow's mode-selection guard step in the way.
- As a **maintainer**, I want the agent to decline questions unrelated to the repository, so that ask-mode answers stay scoped and trustworthy instead of turning into a general-purpose chatbot.
- As a **maintainer**, I want the answer written in Markdown with citations (and exact code when I ask for it), so that I can verify the agent's claims against the actual source.

## Functional requirements

- [ ] FR1: Add `Mode.ASK` to `types/mode.ts`'s `Mode` const enum, alongside the existing `RUNNER` and `REVIEW_FOLLOWUP` values.
- [ ] FR2: Add a new env var, `QUESTION`, to `platform/env.ts`'s schema, required only when `MODE=ask` — validated the same way `TASK` is required only for `runner` and `PR_NUMBER`/`REVIEW_FEEDBACK` only for `review-followup`.
- [ ] FR3: Add a new flow folder `flows/ask/` (own orchestration flow, following the shape of `flows/runner/` and `flows/review-followup/`) and register it in `flows/registry.ts`'s `Record<Mode, ...>`.
- [ ] FR4: In ask mode, the agent session must be **read-only** — no file/git writes of any kind, regardless of what the underlying SDK default permission mode allows in other modes.
- [ ] FR5: The agent must decline to answer when the question is not related to the target repository, and say so explicitly instead of answering off-topic.
- [ ] FR6: The agent's answer is written to the GitHub Actions run's summary (`GITHUB_STEP_SUMMARY`, via `writeStepSummary` or an ask-mode-specific equivalent) — not as a PR/issue comment. PR/issue comment delivery is explicitly out of scope for now (see Non-goals).
- [ ] FR7: The answer format is Markdown, citing the source files/paths it draws from **including line numbers** (`file_path:line_number`, matching this repo's existing citation convention); when the question asks for exact code, the answer includes the exact source excerpt (not a paraphrase).
- [ ] FR8: Ask mode never commits, pushes, or opens a PR, and is entirely independent of the `runner` flow's verify/PR gate — no shared state or ordering dependency between the two.
- [ ] FR9: If `TASK` is set alongside `MODE=ask`, it is silently ignored — `MODE=ask` determines that `QUESTION` is the required input, not `TASK`, so an incidentally-set `TASK` value changes nothing.
- [ ] FR10: `QUESTION` has a maximum length of 1000 characters, enforced by `platform/env.ts`'s Zod schema.
- [ ] FR11: Ask mode is triggered via its own dedicated reusable workflow template,
      `target-repo-templates/.github/workflows/szumrak-holmes.yml` (name: "Szumrak Holmes 🕵️"),
      separate from `szumrak.yml`'s `runner`/`review-followup` jobs — its `workflow_dispatch` has a
      single `question` input (no `task` input, no mode-selection guard step needed since the
      trigger itself is single-purpose). `szumrak.yml`'s `run-szumrak` job goes back to
      `task`-only/`required: true`, exactly as it was before this feature (no `question` input,
      no guard step) — that mode-selection-guard approach from the original plan is superseded by
      this dedicated-workflow approach.

## Acceptance criteria

<!-- Concrete, measurable. Each AC maps to one test. -->

- [ ] AC1: given `MODE=ask` and `QUESTION="What does flows/registry.ts do?"` → agent responds with a Markdown answer describing the file; the target repo's working tree is unchanged (no commit, branch, or PR created).
- [ ] AC2: given `MODE=ask` and a `QUESTION` unrelated to the repo (e.g. "What's the weather today?") → the run still succeeds (not treated as a failure); `GITHUB_STEP_SUMMARY` contains a short message stating the question isn't related to this project, nothing more.
- [ ] AC3: given `MODE=ask` → no branch, commit, or PR is created under any circumstance (verified by asserting `github/pull-requests.ts`'s commit/PR path is never invoked from the ask flow).
- [ ] AC4: given `MODE=ask` and a question asking for exact code (e.g. "show me the implementation of `runAgent`") → the answer includes the exact source excerpt, not a summary.
- [ ] AC5: given `MODE=ask` and `QUESTION` missing or empty → env validation fails fast (`process.exit(1)`) before the agent runs, same fail-fast behavior as other mode-specific required vars.
- [ ] AC6: given a completed ask-mode run → the answer text is present in `GITHUB_STEP_SUMMARY` of the workflow run.
- [ ] AC7: given `MODE=ask` and a `QUESTION` longer than 1000 characters → env validation fails fast (`process.exit(1)`) before the agent runs.
- [ ] AC8: given `MODE=ask`, `TASK` set to some value, and a valid `QUESTION` → the run proceeds normally using `QUESTION`; the `TASK` value has no effect on behavior.
- [ ] AC9: given a citation-worthy answer → citations are formatted as `file_path:line_number`, not bare file paths.

## Edge cases

<!-- What if: no network, race condition, invalid input, concurrent users, ... -->

- Question is unrelated to the repository → run still succeeds; `GITHUB_STEP_SUMMARY` gets a short "not related to this project" message, no error status (FR5 / AC2).
- Question asks about code/behavior that doesn't exist in the repo → agent should say it can't find it rather than invent an answer.
- Question is very broad or ambiguous → agent stays within the existing `maxTurns`/`maxDurationMs` guards already enforced in `agent/run-agent.ts`; no new guard is introduced by this feature.
- `DRY_RUN` is set in ask mode → silently ignored (no-op): ask mode never writes/commits regardless of `DRY_RUN`, so the flag has no effect and does not need to be rejected or warned about.
- `TASK` is set alongside `MODE=ask` → silently ignored; `QUESTION` is the only input that matters in this mode (FR9 / AC8).
- `QUESTION` exceeds 1000 characters → rejected at env validation, before the agent runs (FR10 / AC7).

## Non-goals (out of scope)

<!-- What this feature does NOT do. Protects against scope creep. -->

- No PR or issue comment output — the answer only lands in the GitHub Actions run summary for now.
- No file or git writes to the target repository under any circumstance, including "harmless" ones (e.g. writing a scratch note).
- Not integrated with the `runner` flow's `verify`/PR gate — ask mode is fully independent, per the answers above.

## Open questions

<!-- The /sdd:clarify phase fills these in. The owner answers them BEFORE /plan. -->

- none — both prior open questions resolved: env var name is `QUESTION`; `DRY_RUN=true` is silently ignored in ask mode.

## Testing guidelines

<!-- Test framework, test file locations, what to test at each layer -->

- **TDD strategy** (technology-neutral; test-first is the default):
  - **Test-first (default)** → write the failing test first, then the implementation. If a missing symbol stops the test compiling, add a trivial stub so it fails on a real assertion. Use for anything whose deliverable is behavior.
  - **Contract-first (exception, 3 phases)** → use only when the unit's deliverable *is itself a public interface/contract* other code references by shape (a UI component's props, a typed service interface, an API/RPC schema): define the contract first, then the failing tests, then the implementation. When in doubt, choose test-first.
- Unit: new `flows/ask/run-ask-flow.test.ts` (Vitest), following the pattern of the existing `flows/runner`/`flows/review-followup` tests — mock the SDK `query()` to verify (a) the flow never calls the git/PR commit path, (b) the off-topic-question decline path, (c) the read-only tool restriction is actually passed to the SDK call.
- Integration: local `DRY_RUN`-style run against a real `WORKSPACE_PATH` target repo, asking a real question and inspecting the returned answer + confirming `git status` is clean afterward.
- E2E: not applicable — no UI, no PR surface for this mode.
- A11y (if UI): not applicable.

## Dependencies & prerequisites

<!-- What must be ready beforehand (other features, env vars, infra). -->

- `types/mode.ts` (`Mode` const enum) must be extended with `Mode.ASK`.
- `platform/env.ts` (Zod schema) must be extended with the new `QUESTION` var and its `MODE=ask`-conditional requirement.
- `flows/registry.ts`'s `Record<Mode, ...>` must gain an `ask` entry (compile-time enforced).
- `platform/summary.ts` (`writeStepSummary`) is reused (or extended) to publish the answer, rather than only failure lines as it does today for `runner`/`review-followup`.
- No new external service dependency — reuses the already-configured Claude Agent SDK and GitHub App credentials.
- `target-repo-templates/.github/workflows/szumrak-holmes.yml` (new, dedicated workflow template for `MODE=ask`, mirroring `szumrak.yml`'s `run-szumrak` job shape — checkout, Node setup, build image, run container — but with a single `question` input and no mode-selection guard).

## Notes

<!-- Links to Figma, design docs, ADRs -->
