# Feature: Agent Reliability Improvements

**Branch:** feat/agent-reliability-improvements
**Status:** done  <!-- lifecycle: draft → clarified → planned → in-progress → done; advanced automatically by each /sdd command -->
**Type:** feat  <!-- feat | fix | chore | refactor | docs -->
**Owner:** JanSzewczyk
**Created:** 2026-07-16

---

## Summary (business)

Make Szumrak fail fast and predictably instead of silently looping on a stuck action, or building
an unpinned, always-latest engine version that a maintainer hasn't reviewed yet.

## User stories

- As a **maintainer**, I want an agent run (any mode) to stop itself early when it's clearly stuck
  repeating the same action, so that I don't pay for and wait through a run that has already failed.
- As a **maintainer**, I want a stuck review-follow-up run to leave a comment on the PR it was
  working on (not just the CI job summary), so that I notice it needs a human without having to
  check GitHub Actions.
- As a **maintainer**, I want to pin a target repo to a specific released version of the Szumrak
  engine, so that an engine change on `main` doesn't unexpectedly alter behavior in a repo I
  haven't reviewed against that change yet.
- As a **maintainer**, I want to be warned when the target repo's own hooks are broken before the
  agent starts working, so I'm not surprised by a run that fails for reasons unrelated to the
  actual task.
- As a **maintainer**, I want a run to abort immediately (before the agent starts) when the target
  repo's hooks are so broken that nothing can ever pass, so I don't pay for a session that can
  never succeed.

## Functional requirements

- [ ] FR1: In any agent run (`MODE=runner`, `review-followup`, or `ask`), the system must detect
      when the agent invokes the same tool with the same input three times in a row, and terminate
      the run immediately at that point rather than continuing until `MAX_TURNS`/`MAX_DURATION_MS`.
- [ ] FR2: A run terminated by FR1 must be reported as a failed run, with a clear, human-readable
      diagnostic message — naming the repeated tool and input — written to `GITHUB_STEP_SUMMARY`.
- [ ] FR3: When FR1 triggers during a `MODE=review-followup` run specifically, the system must, in
      addition to FR2's step-summary message, post a comment on the pull request being followed up
      on, stating that the automatic follow-up got stuck and needs a human. (`MODE=runner` and
      `MODE=ask` have no PR yet to comment on at that point, so FR2's step-summary message is the
      only signal for them.)
- [ ] FR4: A target repo must be able to declare, in its `.claude/agent-config.json`, which version
      of the Szumrak engine to build/run against. The declared value must be a specific GitHub
      release tag of the Szumrak repository. When the field is absent, the engine continues to
      build from the `main` branch, exactly as it does today (no behavior change for repos that
      don't opt in).
- [ ] FR5: Before an agent run starts, the system must check whether the target repo's own
      `.claude/settings.json` hook commands are at least syntactically executable, and log a
      diagnostic warning identifying any hook command that is not — without blocking the run over
      a partial failure.
- [ ] FR6: If every hook command in the target repo's configuration fails the check in FR5, the run
      must abort before the agent starts, with a clear reason reported to `GITHUB_STEP_SUMMARY` —
      running a session where no hook can ever succeed is treated as pointless, not merely risky.

## Acceptance criteria

<!-- Concrete, measurable. Each AC maps to one test. -->

- [ ] AC1: given an agent run (any mode) that calls the same tool with the same input 3 times
      consecutively → the run stops immediately after the 3rd repeat and is reported as failed.
- [ ] AC2: given AC1's failure → `GITHUB_STEP_SUMMARY` names the specific tool and input that
      repeated.
- [ ] AC3: given repeated-action detection fires during `MODE=review-followup` → a comment is
      posted on the PR being followed up on, stating the run got stuck and needs a human.
- [ ] AC4: given repeated-action detection fires during `MODE=runner` or `MODE=ask` → no PR comment
      is attempted (there is no PR yet); only the `GITHUB_STEP_SUMMARY` message from AC2 applies.
- [ ] AC5: given a target repo's `agent-config.json` specifies a Szumrak engine release tag → the
      workflow builds the engine from that tag rather than `main`.
- [ ] AC6: given a target repo's `agent-config.json` has no engine-version field → the workflow
      builds from `main` (current default, unchanged).
- [ ] AC7: given a target repo where every hook command is syntactically broken → the run aborts
      before the agent starts, with a clear message in `GITHUB_STEP_SUMMARY`.
- [ ] AC8: given a target repo where some (but not all) hook commands are broken → the run
      proceeds, and a warning identifying the broken hook(s) is logged.
- [ ] AC9: given a target repo where all hook commands are syntactically valid → no warning is
      logged and the run proceeds exactly as today.

## Edge cases

<!-- What if: no network, race condition, invalid input, concurrent users, ... -->

- The 3-repeat threshold (FR1) and `MAX_TURNS`/`MAX_DURATION_MS` are independent guards — whichever
  condition is hit first ends the run; FR1 does not replace or disable the existing limits.
- A target repo's `agent-config.json` declares an engine version tag that doesn't exist in the
  Szumrak repository — the checkout step fails clearly rather than silently falling back to `main`.
- A target repo has zero hooks configured at all in `.claude/settings.json` — FR5/FR6 have nothing
  to check and must not treat "no hooks" the same as "all hooks broken" (the run proceeds normally).
- `MODE=review-followup`'s PR-comment step (FR3) itself fails (e.g. GitHub API error) — the
  `GITHUB_STEP_SUMMARY` message from FR2 must still have been written first, so the failure isn't
  silent even if the PR comment doesn't land.

## Non-goals (out of scope)

<!-- What this feature does NOT do. Protects against scope creep. -->

- Propagating reference-template updates to already-installed target repos — explicitly dropped
  from this feature (only one target repo, `craft-flow`, exists today; not enough repos yet to
  justify the tooling).
- Any dedup, rate-limiting, or spend cap for `MODE=ask` — explicitly rejected; ask mode must not
  restrict or throttle questions based on content, frequency, or cost.
- Failure notifications to Slack/Discord/email (point 6 from the original analysis) — explicitly
  excluded by the owner from the start.
- Pinning the engine version via a `workflow_dispatch` input — the only supported mechanism is the
  `agent-config.json` field (FR4); no per-run override.
- Hooks that intentionally block a dangerous command (e.g. `rm -rf /`, force-push) are correct,
  working hooks — FR5/FR6 only target hooks that fail to execute at all (a shell syntax error),
  never hooks that execute successfully and choose to block something.

## Open questions

<!-- The /sdd:clarify phase fills these in. The owner answers them BEFORE /plan. -->

- none — all open questions from the first clarify round were resolved (template-sync story
  dropped; ask-mode cost-safety mechanism dropped entirely, no replacement needed).

## Testing guidelines

<!-- Test framework, test file locations, what to test at each layer -->

- **TDD strategy** (technology-neutral; test-first is the default):
  - **Test-first (default)** → write the failing test first, then the implementation. If a missing symbol stops the test compiling, add a trivial stub so it fails on a real assertion. Use for anything whose deliverable is behavior.
  - **Contract-first (exception, 3 phases)** → use only when the unit's deliverable *is itself a public interface/contract* other code references by shape (a UI component's props, a typed service interface, an API/RPC schema): define the contract first, then the failing tests, then the implementation. When in doubt, choose test-first.
- Unit: Vitest, `src/**/*.test.ts` — repeated-action detection logic in `agent/run-agent.ts`, the
  engine-version field parsing in `agent/agent-config.ts`, and the hook syntax pre-flight checker.
- Integration: `flows/review-followup/` test coverage for the new PR-comment-on-stuck-loop path.
- E2E: not applicable — no UI.
- A11y (if UI): not applicable.

## Dependencies & prerequisites

<!-- What must be ready beforehand (other features, env vars, infra). -->

- `agent/agent-config.ts` (loads `.claude/agent-config.json`) — FR4 adds a new field here.
- `github/pull-requests.ts` / the GitHub App client — FR3's PR comment needs the same
  authenticated GitHub API access the rest of the review-followup flow already uses.
- `target-repo-templates/.github/workflows/szumrak-worker.yml` — FR4's engine-version field changes
  how the "Checkout szumrak" step resolves its `ref`.
- No new external service dependency.

## Notes

<!-- Links to Figma, design docs, ADRs -->

This feature originally bundled 5 points from the 2026-07-16 project-analysis discussion. Two were
dropped during clarification (see Non-goals): propagating template updates to installed target
repos (only one repo exists today), and any ask-mode dedup/rate-limit/spend-cap mechanism
(explicitly rejected — ask mode must stay unrestricted). Point 6 (failure notifications) was
excluded by the owner before this spec was written. The three remaining points map to Stories
S1 (loop/stuck detection, FR1-FR3), S2 (engine version pinning, FR4), and S3 (hook pre-flight
check, FR5-FR6) for `/sdd:tasks`.