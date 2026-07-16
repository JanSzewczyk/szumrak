# Tasks: Agent Reliability Improvements

**Spec:** `specs/agent-reliability-improvements/spec.md`
**Plan:** `specs/agent-reliability-improvements/plan.md`

## Epic: Agent Reliability Improvements

### Story S1: Repeated-action loop detection + review-followup PR comment

`agent/run-agent.ts` gains repeated-action detection first (test-first: red, then green), then a
thin `postPrComment` wrapper in `github/pull-requests.ts`, then `review-followup` is wired to use
both. Zero behavior change for `runner`/`ask` beyond what their existing `!result.succeeded`
branches already handle.

```yaml
- id: T1.1
  title: Test repeated-action loop detection in runAgent
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New cases in src/agent/run-agent.test.ts: (a) feeding 3 consecutive assistant messages with an
    identical tool_use block (same name + same input) makes runAgent resolve with
    succeeded: false and result.loopDetected populated as
    { toolName, input, occurrences: 3 }, and finalMessage names the repeated tool; (b) only 2
    identical repeats followed by a differing tool call does NOT set loopDetected and the run
    completes normally via its result message; (c) once loopDetected fires, no further messages
    from the mocked stream are consumed (assert via a stream that would throw/fail an assertion if
    read past the 3rd repeat). Tests fail (red): the repeat-tracking logic doesn't exist in
    run-agent.ts yet, so cases (a)/(c) fail on real assertions (wrong succeeded/loopDetected value),
    not compile errors — TypeScript already tolerates an unread optional field.
  files: [src/agent/run-agent.test.ts]

- id: T1.2
  title: Implement repeated-action loop detection in runAgent
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    AgentRunResult gains loopDetected?: { toolName: string; input: Record<string, unknown>;
    occurrences: number }. Inside the existing tool_use handling in the stream loop, track the last
    tool-call signature (name + JSON.stringify(input)) and a repeat counter (REPEATED_ACTION_LIMIT
    = 3, reset whenever the signature changes). On the 3rd consecutive repeat: log
    "repeated_action_loop_detected" with {toolName, input, occurrences}, stop consuming the stream,
    set succeeded = false and finalMessage to a message naming the repeated tool, populate
    loopDetected, and return through the function's existing single return statement (toolCalls,
    commitMetadata parsing, and agent_end logging all still run on this path). All T1.1 tests pass;
    npm run typecheck passes. Existing MAX_DURATION_MS throw-based behavior is untouched (spec.md
    Edge cases: the two guards are independent).
  files: [src/agent/run-agent.ts]

- id: T1.3
  title: Test postPrComment
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New case(s) in src/github/pull-requests.test.ts asserting postPrComment(owner, repo, prNumber,
    body) calls octokit.issues.createComment with { owner, repo, issue_number: prNumber, body }.
    Tests fail (red): stub postPrComment in pull-requests.ts to throw "not implemented" so the
    suite compiles and fails on the real assertion.
  files: [src/github/pull-requests.test.ts, src/github/pull-requests.ts]

- id: T1.4
  title: Implement postPrComment
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    src/github/pull-requests.ts exports postPrComment(owner: string, repo: string, prNumber:
    number, body: string): Promise<void>, calling octokit.issues.createComment({ owner, repo,
    issue_number: prNumber, body }), matching this file's existing plain-object Octokit call
    convention (see commitAndOpenPR). All T1.3 tests pass; npm run typecheck passes.
  files: [src/github/pull-requests.ts]

- id: T1.5
  title: Test review-followup posts a PR comment when a loop is detected
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New cases in src/flows/review-followup/run-review-followup-flow.test.ts: (a) given
    agentRunResultBuilder.one({ traits: "failed", overrides: { loopDetected: { toolName: "Bash",
    input: {...}, occurrences: 3 } } }), assert mocked postPrComment (vi.mock
    "~/github/pull-requests") is called with the PR's owner/repo/prNumber and a body naming the
    stuck tool; (b) given a plain failure (agentRunResultBuilder.one({ traits: "failed" }), no
    loopDetected), assert postPrComment is NOT called. Tests fail (red): runReviewFollowUp doesn't
    check result.loopDetected yet.
  files: [src/flows/review-followup/run-review-followup-flow.test.ts]

- id: T1.6
  title: Wire the loopDetected branch into runReviewFollowUp
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    Inside the existing `if (!result.succeeded) { ... }` block in run-review-followup-flow.ts, add:
    when result.loopDetected is set, await postPrComment(owner, repo, prNumber, <message naming the
    stuck tool and occurrence count>) before the existing log/writeStepSummary/return
    { succeeded: false }. All T1.5 tests pass; npm run typecheck passes. No change to the
    runner/ask flows (spec.md AC4 — no PR exists yet at their failure point).
  files: [src/flows/review-followup/run-review-followup-flow.ts]
```

### Story S2: Engine version pinning

Purely a CI/workflow-template concern — no change to `agent/agent-config.ts`'s TypeScript
`AgentConfig` type (per plan.md's High-level approach: this field is read by the workflow YAML
before the Docker image is even built, never by the Node process).

```yaml
- id: T2.1
  title: Resolve and pin the Szumrak engine ref in szumrak-worker.yml
  type: generic
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    In both jobs (work, review-followup) of
    target-repo-templates/.github/workflows/szumrak-worker.yml: a new step "Resolve Szumrak engine
    ref", placed after "Checkout target repo" and before "Checkout szumrak", reads
    workspace/.claude/agent-config.json's szumrakEngineVersion field with jq, falling back to
    "main" when the file, field, or jq itself is missing/fails (never fails the job over this).
    Exports the resolved value via $GITHUB_ENV as SZUMRAK_REF. The "Checkout szumrak" step in both
    jobs gains ref: ${{ env.SZUMRAK_REF }}. The top-of-file comment is updated to no longer imply
    "Checkout szumrak" always resolves to main. Manually verified: a target repo with no
    szumrakEngineVersion field builds from main (unchanged default, AC6); a target repo with
    szumrakEngineVersion set to a real Szumrak release tag builds from that tag (AC5).
  files: [target-repo-templates/.github/workflows/szumrak-worker.yml]

- id: T2.2
  title: Resolve and pin the Szumrak engine ref in szumrak-holmes.yml
  type: generic
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    Same "Resolve Szumrak engine ref" step and ref: ${{ env.SZUMRAK_REF }} addition applied to
    target-repo-templates/.github/workflows/szumrak-holmes.yml's single job, for consistency with
    szumrak-worker.yml (both templates have an identical "Checkout szumrak" step; leaving one
    unpinned while the other is pinned would be a drift between the two templates).
  files: [target-repo-templates/.github/workflows/szumrak-holmes.yml]

- id: T2.3
  title: Document szumrakEngineVersion in README
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    README.md's "Target Repo Configuration" section documents the szumrakEngineVersion
    agent-config.json field: purpose, that it must be a real GitHub release tag of
    JanSzewczyk/szumrak, and that omitting it keeps today's default (build from main).
  files: [README.md]
```

### Story S3: Target-repo hook pre-flight check

New `agent/hook-preflight.ts` module, called once at the top of `runAgent()` for every mode
(including `readOnly`), before `query()` is ever invoked.

```yaml
- id: T3.1
  title: Test checkHookHealth
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New src/agent/hook-preflight.test.ts covering checkHookHealth(workspacePath): (a) no
    .claude/settings.json on disk → { total: 0, failed: [] }; (b) a settings.json with only
    syntactically valid hook commands → { total: N, failed: [] }; (c) one broken hook command
    (e.g. unescaped bash-only `[[ ... ]]` syntax, the exact class of bug diagnosed live in
    craft-flow on 2026-07-16) among several valid ones → { total: N, failed: [thatOne] }; (d) every
    hook command broken → { total: N, failed: <all N> }. Mocks node:fs the same way
    agent-config.test.ts does; mocks node:child_process's execFileSync to simulate a shell
    syntax-check failure (non-zero exit / thrown error) vs success. Tests fail (red): stub
    checkHookHealth in hook-preflight.ts to throw "not implemented" so the suite compiles and fails
    on real assertions.
  files: [src/agent/hook-preflight.test.ts, src/agent/hook-preflight.ts]

- id: T3.2
  title: Implement checkHookHealth
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    src/agent/hook-preflight.ts exports checkHookHealth(workspacePath: string): { total: number;
    failed: Array<{ event: string; command: string }> }. Reads
    <workspacePath>/.claude/settings.json with the same existsSync/readFileSync/try-catch
    tolerance as agent-config.ts's readJson (missing or invalid file → { total: 0, failed: [] },
    never throws). Walks every hooks.<Event>[].hooks[].command string found and dry-run-checks
    each with execFileSync("/bin/sh", ["-n", "-c", command]) in a try/catch (non-zero exit or
    thrown error → failed). Never actually executes a hook command (sh -n parses without running).
    All T3.1 tests pass; npm run typecheck passes.
  files: [src/agent/hook-preflight.ts]

- id: T3.3
  title: Test runAgent's integration with the hook pre-flight check
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New cases in src/agent/run-agent.test.ts (mocking ~/agent/hook-preflight): (a) checkHookHealth
    returns { total: 3, failed: <all 3> } (every hook broken) → runAgent resolves with succeeded:
    false and query() (the SDK mock) is never called; (b) checkHookHealth returns { total: 3,
    failed: [one] } (partial failure) → query() IS called and the run proceeds normally, but a
    "hook_preflight_warning" log call happens; (c) checkHookHealth returns { total: 0, failed: [] }
    (no hooks configured) → query() IS called, no warning logged. Applies to a readOnly: true call
    too (ask mode also gets the check). Tests fail (red): runAgent doesn't call checkHookHealth yet.
  files: [src/agent/run-agent.test.ts]

- id: T3.4
  title: Wire checkHookHealth into runAgent
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    runAgent calls checkHookHealth(env.WORKSPACE_PATH) at the very top of the function, before
    building the query() options object, for every mode (readOnly included). When total > 0 and
    every hook fails → log("hook_preflight_all_failed", { failed }), return { succeeded: false,
    finalMessage: <clear reason>, toolCalls: [], ... } immediately without calling query() (AC7).
    When some (not all) hooks fail → log("hook_preflight_warning", { failed }), proceed normally
    (AC8). When total is 0 or no hooks fail → proceed silently, no warning (AC9, spec.md Edge
    cases: zero hooks is not treated as all-failed). All T3.3 tests pass; npm run typecheck passes.
  files: [src/agent/run-agent.ts]
```

## Summary

| ID | Title | Type | Agent | Model | Status |
|----|-------|------|-------|-------|--------|
| T1.1 | Test repeated-action loop detection in runAgent | unit-test | testing:unit-tester | sonnet | done |
| T1.2 | Implement repeated-action loop detection in runAgent | implementation | orchestrator | sonnet | done |
| T1.3 | Test postPrComment | unit-test | testing:unit-tester | sonnet | done |
| T1.4 | Implement postPrComment | implementation | orchestrator | sonnet | done |
| T1.5 | Test review-followup posts a PR comment when a loop is detected | unit-test | testing:unit-tester | sonnet | done |
| T1.6 | Wire the loopDetected branch into runReviewFollowUp | implementation | orchestrator | sonnet | done |
| T2.1 | Resolve and pin the Szumrak engine ref in szumrak-worker.yml | generic | orchestrator | sonnet | done |
| T2.2 | Resolve and pin the Szumrak engine ref in szumrak-holmes.yml | generic | orchestrator | sonnet | done |
| T2.3 | Document szumrakEngineVersion in README | generic | orchestrator | haiku | done |
| T3.1 | Test checkHookHealth | unit-test | testing:unit-tester | sonnet | done |
| T3.2 | Implement checkHookHealth | implementation | orchestrator | sonnet | done |
| T3.3 | Test runAgent's integration with the hook pre-flight check | unit-test | testing:unit-tester | sonnet | done |
| T3.4 | Wire checkHookHealth into runAgent | implementation | orchestrator | sonnet | done |
