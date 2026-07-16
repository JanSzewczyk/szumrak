# Tasks: Add Ask Mode For Agent

**Spec:** `specs/add-ask-mode-for-agent/spec.md`
**Plan:** `specs/add-ask-mode-for-agent/plan.md`

## Epic: Add Ask Mode For Agent

### Story S1: Read-only agent option

`agent/run-agent.ts` gains the `readOnly` branch first since both the ask flow (S2) and its tests
depend on `RunAgentOptions` existing and being honored. Zero behavior change for the two existing
call sites (`runAgent(task)` unmodified).

```yaml
- id: T1.1
  title: Test the readOnly branch of runAgent
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New/extended cases in src/agent/run-agent.test.ts assert that calling
    runAgent(task, { readOnly: true }) makes the query() call receive
    allowedTools: ["Read", "Grep", "Glob"], permissionMode: "default" (never
    "acceptEdits"), and that loadAgentConfig()'s permissions.allow/deny are not
    merged into allowedTools/disallowedTools. A case calling runAgent(task)
    (no options) still asserts the existing acceptEdits/config-permissions
    behavior is unchanged. Tests fail (red) since RunAgentOptions/readOnly
    branch don't exist yet.
  files: [src/agent/run-agent.test.ts]

- id: T1.2
  title: Implement RunAgentOptions readOnly branch
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    runAgent(task: string, options?: RunAgentOptions) where
    RunAgentOptions = { readOnly?: boolean }, defaulting to false. When
    readOnly === true: loadAgentConfig()'s permissions.allow/deny are ignored
    entirely (not merged/extended), allowedTools is hardcoded to
    ["Read", "Grep", "Glob"] with no disallowedTools, and permissionMode is
    "default". Existing call sites (runRunnerFlow, runReviewFollowUp) keep
    calling runAgent(task) unmodified. Also appends src/agent/ask-instructions.ts's
    ASK_MODE_INSTRUCTIONS to the system prompt instead of
    COMMIT_METADATA_INSTRUCTIONS when readOnly (decline off-topic questions,
    cite file_path:line_number, quote exact code on request — FR5/FR7).
    All T1.1 tests pass; npm run typecheck passes.
  files: [src/agent/run-agent.ts, src/agent/ask-instructions.ts]
```

### Story S2: Ask flow + Mode/env plumbing

Adds `Mode.ASK`, the `QUESTION` env var, and the new `flows/ask/` flow itself, wired into the
`Record<Mode, ...>` registry.

```yaml
- id: T2.1
  title: Add Mode.ASK to the Mode const enum
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    types/mode.ts's Mode const enum gains ASK: "ask" alongside RUNNER and
    REVIEW_FOLLOWUP. npm run typecheck passes.
  files: [src/types/mode.ts]

- id: T2.2
  title: Add QUESTION env var and AskModeEnv to platform/env.ts
  type: generic
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    server schema gains QUESTION: z.string().min(1).max(1000).optional()
    (describing it's required only when MODE=ask). MODE's z.enum(...) list
    includes Mode.ASK. A new AskModeEnv = z.object({ MODE: z.literal(Mode.ASK),
    QUESTION: z.string().min(1).max(1000) }) is added and included in
    createFinalSchema's discriminatedUnion("MODE", [...]) array; QUESTION is
    destructured out into `common` alongside TASK/PR_NUMBER/REVIEW_FEEDBACK.
    process.env.MODE default-to-runner logic is untouched (MODE=ask stays
    always-explicit). npm run typecheck passes. Manually verified: env with
    MODE=ask and no QUESTION (or QUESTION over 1000 chars) fails validation
    (process.exit(1)); MODE=ask with a valid QUESTION passes and env.QUESTION
    is typed as string (AC5, AC7).
  files: [src/platform/env.ts]

- id: T2.3
  title: Test flows/ask/run-ask-flow
  type: unit-test
  agent: testing:unit-tester
  skills: [testing:unit-testing]
  model: sonnet
  status: done
  acceptance: |
    New src/flows/ask/run-ask-flow.test.ts, mirroring
    flows/runner/run-runner-flow.test.ts's mocking shape (vi.mock
    "~/agent/run-agent", "~/platform/summary", "~/platform/logger", plus
    "~/github/pull-requests" to assert commitAndOpenPR is never called).
    Covers: (a) success path — runAgent resolves via agentRunResultBuilder,
    runAskFlow returns { succeeded: true } and writeStepSummary is called with
    the answer and a success icon; (b) long-answer path — an answer beyond a
    handful of lines gets wrapped in a <details><summary>Answer</summary>...
    block passed to writeStepSummary; (c) decline/off-topic path — agent
    succeeds with an off-topic decline message, runAskFlow still returns
    { succeeded: true }; (d) failure path — agentRunResultBuilder.one({
    traits: "failed" }), runAskFlow returns { succeeded: false }, log(...) and
    writeStepSummary(...) are called, commitAndOpenPR is never called in any
    case. Tests fail (red): stub an empty flows/ask/run-ask-flow.ts exporting
    AskFlowInput { question: string } and a runAskFlow that throws
    "not implemented" so the suite compiles and fails on real assertions.
  files: [src/flows/ask/run-ask-flow.test.ts, src/flows/ask/run-ask-flow.ts]

- id: T2.4
  title: Implement runAskFlow
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    flows/ask/run-ask-flow.ts exports AskFlowInput { question: string } and
    runAskFlow(input: AskFlowInput): Promise<FlowResult>. Calls
    runAgent(question, { readOnly: true }); on failure logs, calls
    writeStepSummary(...), returns { succeeded: false }; on success formats
    the answer as Markdown (wrapped in <details><summary>Answer</summary>...
    </details> once it exceeds a handful of lines) and calls
    writeStepSummary(formatted, "✅"), returning { succeeded: true }. No dedup
    check, no verify gate, no PR/branch/commit call anywhere in the file. All
    T2.3 tests pass; npm run typecheck passes.
  files: [src/flows/ask/run-ask-flow.ts]

- id: T2.5
  title: Register Mode.ASK in flows/registry.ts
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    FlowInputByMode gains [Mode.ASK]: AskFlowInput (imported from
    flows/ask/run-ask-flow.ts), and flowRegistry gains
    [Mode.ASK]: runAskFlow. npm run typecheck passes with no missing-entry
    error on the Record<Mode, ...> mapped type.
  files: [src/flows/registry.ts]
```

### Story S3: Entry point wiring, docs, and CI template

Wires `MODE=ask` into `index.ts`'s dispatch and updates the human-facing surfaces (README, the
target repo's reusable workflow template) — no new runtime logic beyond the dispatch branch.

```yaml
- id: T3.1
  title: Dispatch MODE=ask in index.ts
  type: implementation
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    main() gains an `if (env.MODE === Mode.ASK)` branch calling
    flowRegistry[Mode.ASK]({ question: env.QUESTION }) and process.exit(1) on
    !result.succeeded, matching the existing RUNNER/REVIEW_FOLLOWUP branches'
    shape. The run_started log payload gains
    hasQuestion: "QUESTION" in env, alongside hasTask/hasReviewFeedback.
    npm run typecheck passes. Manually verified end-to-end with
    DRY_RUN=true, MODE=ask, a real WORKSPACE_PATH, and a real QUESTION: the
    run exits 0, prints/writes an answer, and `git status` in the workspace
    is clean afterward (AC1, AC3).
  files: [src/index.ts]

- id: T3.2
  title: Document MODE=ask and QUESTION in README
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    README.md's env-var table/section documents MODE=ask and QUESTION
    (purpose, required-when-MODE=ask, 1000-char max), per the project's
    constitution rule that README must track behavior changes.
  files: [README.md]

- id: T3.3
  title: "[SUPERSEDED by S4] Add question input and mode-selection guard to the workflow template"
  type: generic
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    SUPERSEDED — the shared-workflow mode-selection-guard approach was reverted:
    target-repo-templates/.github/workflows/szumrak.yml goes back to its
    pre-feature shape (task required: true, no question input, no guard
    step, env/docker run -e stay TASK-only). See Story S4: MODE=ask gets its
    own dedicated workflow template (szumrak-holmes.yml) instead of sharing
    szumrak.yml's run-szumrak job.
  files: [target-repo-templates/.github/workflows/szumrak.yml]
```

### Story S4: Dedicated "Szumrak Holmes" workflow for ask mode

Supersedes T3.3's shared-workflow mode-guard approach: `MODE=ask` gets its own single-purpose
reusable workflow template instead of a `task`/`question` guard step inside `szumrak.yml`'s
`run-szumrak` job. `szumrak.yml` reverts to its pre-feature shape (`task`-only, `required: true`).

```yaml
- id: T4.1
  title: Revert szumrak.yml to its pre-feature (task-only) shape
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    target-repo-templates/.github/workflows/szumrak.yml's run-szumrak job:
    `task` input back to required: true, no `question` input, no
    mode-selection guard step, "Run Szumrak" step's env/docker run -e lists
    back to TASK-only (MODE/QUESTION removed). review-followup job
    untouched.
  files: [target-repo-templates/.github/workflows/szumrak.yml]

- id: T4.2
  title: Add target-repo-templates/.github/workflows/szumrak-holmes.yml
  type: generic
  agent: orchestrator
  skills: []
  model: sonnet
  status: done
  acceptance: |
    New workflow file, name "Szumrak Holmes 🕵️". workflow_dispatch with a
    single `question` input (required: true) — no `task` input, no mode
    guard. One job (e.g. run-szumrak-holmes) mirroring szumrak.yml's
    run-szumrak job structure (checkout target repo, Node setup + npm ci,
    checkout szumrak, build the image) with its own concurrency group
    (szumrak-holmes-${{ github.repository }}, separate from szumrak.yml's
    group). Runs the container with MODE=ask,
    QUESTION: ${{ github.event.inputs.question }}, plus the same
    ANTHROPIC_API_KEY/GH_APP_*/REPO/AGENT_MODEL secrets/env as szumrak.yml
    (unchanged env.ts REPO/GH_APP_* requirement unless DRY_RUN). Uploads
    agent-run.jsonl as an artifact on completion, same as the other jobs.
  files: [target-repo-templates/.github/workflows/szumrak-holmes.yml]

- id: T4.3
  title: Update README and spec docs for the dedicated Holmes workflow
  type: generic
  agent: orchestrator
  skills: []
  model: haiku
  status: done
  acceptance: |
    README.md documents szumrak-holmes.yml as the trigger for MODE=ask
    (separate from szumrak.yml's runner/review-followup jobs), replacing any
    text implying MODE=ask shares szumrak.yml's workflow_dispatch inputs.
  files: [README.md]
```

## Summary

| ID | Title | Type | Agent | Model | Status |
|----|-------|------|-------|-------|--------|
| T1.1 | Test the readOnly branch of runAgent | unit-test | testing:unit-tester | sonnet | review |
| T1.2 | Implement RunAgentOptions readOnly branch | implementation | orchestrator | sonnet | review |
| T2.1 | Add Mode.ASK to the Mode const enum | generic | orchestrator | haiku | review |
| T2.2 | Add QUESTION env var and AskModeEnv | generic | orchestrator | sonnet | review |
| T2.3 | Test flows/ask/run-ask-flow | unit-test | testing:unit-tester | sonnet | review |
| T2.4 | Implement runAskFlow | implementation | orchestrator | sonnet | review |
| T2.5 | Register Mode.ASK in flows/registry.ts | generic | orchestrator | haiku | review |
| T3.1 | Dispatch MODE=ask in index.ts | implementation | orchestrator | sonnet | review |
| T3.2 | Document MODE=ask and QUESTION in README | generic | orchestrator | haiku | review |
| T3.3 | [SUPERSEDED by S4] Workflow template: question input + mode guard | generic | orchestrator | sonnet | done |
| T4.1 | Revert szumrak.yml to its pre-feature (task-only) shape | generic | orchestrator | haiku | review |
| T4.2 | Add szumrak-holmes.yml dedicated workflow | generic | orchestrator | sonnet | review |
| T4.3 | Update README and spec docs for the dedicated Holmes workflow | generic | orchestrator | haiku | review |
