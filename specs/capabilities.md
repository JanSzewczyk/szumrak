# Project Capabilities

> This file is auto-populated by `/sdd:doctor init` (auto-detect installed plugins
> plus project type detection). Sections marked `<!-- user-override -->` are NEVER
> overwritten on re-init — safe place for customizations.

## Specialist agents (delegate implementation work)

<!-- auto-generated -->
- **claude-code-guide** (built-in) — questions about Claude Code CLI, Claude Agent SDK, Claude API, Claude Tag
- **code-quality:code-reviewer** (szum-tech) — comprehensive code review for Next.js/React/TypeScript code
- **code-quality:library-updater** (szum-tech) — update npm packages, investigate breaking changes, execute migrations
- **code-quality:performance-analyzer** (szum-tech) — analyze app performance, bundle size, React rendering, slow queries
- **code-simplifier:code-simplifier** (claude-plugins-official) — simplifies/refines code for clarity and maintainability
- **nextjs:nextjs-backend-engineer** (szum-tech) — server actions, route handlers, API endpoints, DB operations, auth flows
- **react:frontend-expert** (szum-tech) — UI components, Tailwind styling, design-system integration, React fixes
- **sdd:drift-detector** (spec-driven-development) — detects drift between spec/plan/tasks and current code
- **sdd:reviewer** (spec-driven-development) — final quality audit before PR, orchestrates audit skills + tests
- **sdd:spec-guard** (spec-driven-development) — verifies a diff satisfies spec.md acceptance criteria, flags out-of-scope changes
- **sdd:ui-critic** (spec-driven-development) — visual review of UI components via browser MCP screenshots
- **statusline-setup** (built-in) — configures the Claude Code status line
- **testing:storybook-tester** (szum-tech) — Storybook stories and interaction tests for React components
- **testing:testing-strategist** (szum-tech) — plans test strategies, analyzes coverage
- **testing:unit-tester** (szum-tech) — Vitest unit tests for TypeScript logic (utilities, schemas, hooks, server actions)

Note: this project (szumrak) is a Node.js/TypeScript CLI engine with no UI — the React/Next.js/design
agents above are installed globally but not expected to be routed to for this repo's own work (see
Stack profile below). They remain available if a task genuinely needs them (e.g. editing
`target-repo-templates/`).

## Skills (load into context on demand)

<!-- auto-generated -->
- **testing:unit-testing** (szum-tech) — Vitest unit tests: mocking, async testing, parameterized tests, server actions, coverage
- **testing:coverage-gaps** (szum-tech) — identify undertested code paths
- **testing:api-test** (szum-tech) — API endpoint testing
- **code-quality:update-deps** (szum-tech) — safe, batched npm dependency updates with verification
- **code-quality:performance-optimization** (szum-tech) — bundle analysis, rendering, query optimization, Core Web Vitals
- **code-quality:repository-documentation** (szum-tech) — generate/update README.md + GitHub description/topics
- **code-quality:skill-ab-optimizer** (szum-tech) — A/B test and improve Claude Code skills
- **claude-md-management:revise-claude-md** (claude-plugins-official) — update CLAUDE.md with session learnings
- **claude-md-management:claude-md-improver** (claude-plugins-official) — audit/improve CLAUDE.md files
- **code-review:code-review** (claude-plugins-official) — review a PR
- **frontend-design:frontend-design** (claude-plugins-official) — distinctive visual design guidance for new/reshaped UI
- **skill-creator:skill-creator** (claude-plugins-official) — create/modify/optimize skills
- **shared-rules:sync-rules** (szum-tech) — pull canonical `.claude/rules/` from the shared-rules source of truth
- **claude-api** (built-in) — Claude API/Anthropic SDK reference (models, pricing, streaming, tool use, MCP)
- **verify** (built-in) — exercise a code change end-to-end to confirm it does what it should
- **code-review** (built-in) — review the current diff for correctness bugs and cleanups
- **simplify** (built-in) — review changed code for reuse/simplification/efficiency, then apply fixes
- **run** (built-in) — launch and drive the project's app to see a change working
- **security-review** (built-in) — security-focused review
- **dataviz** (built-in) — data visualization design guidance
- **artifact-design** / **artifact-capabilities** (built-in) — Artifact design and runtime capabilities guidance
- **update-config** (built-in) — configure the Claude Code harness via settings.json
- **fewer-permission-prompts** (built-in) — reduce permission prompts via a scanned allowlist
- **loop** / **schedule** (built-in) — recurring or scheduled agent runs
- (design-system, nextjs, react, obsidian-second-brain, printing-press, sdd skill families also
  installed — see the full listing surfaced by the harness; omitted here as not relevant to this
  repo's stack)

## Stack profile

<!-- auto-generated -->
- **language**: TypeScript (strict), run via `tsx` (no compile step / no `dist/`)
- **runtime**: Node.js >= 24
- **package manager**: npm
- **monorepo**: no
- **typecheck**: `npm run typecheck` (`tsc --noEmit`)
- **lint/format**: `npm run biome:check` (Biome; `biome:fix` to autofix)
- **test**: `npm test` (Vitest, `src/**/*.test.ts`)
- **build artifact**: Docker image (`npm run build` → `docker build -f docker/Dockerfile .`), no local `dist/`
- **project type**: standalone CLI/engine (no frontend, no database)

## Task type → routing rules

<!-- user-override -->
<!-- These are technology-neutral defaults. `/sdd:tasks` picks a task `type` from this table and
     `/sdd:implement` routes the task to the listed agent + skills, on the listed model tier.
     Add stack-specific types (and their agents/skills/model) below or in "Custom routing rules".

     Model = an ADVISORY cost tier for the executing session/subagent, NOT a hard switch (a slash
     command cannot change the session model itself). Reserve `opus` for judgement-heavy REASONING
     phases run at the session level (/sdd:spec, /sdd:clarify, /sdd:plan, /sdd:review); keep the
     mechanical implement-phase task tiers cheap. `haiku` for trivial/mechanical work, `sonnet` for
     normal test + implementation work. -->
| Task type           | Specialist agent          | Skills to load                          | Model   |
|---------------------|---------------------------|-----------------------------------------|---------|
| contract            | (orchestrator)            | —                                       | sonnet  |
| contract-test       | (orchestrator)            | —                                       | sonnet  |
| unit-test           | (orchestrator)            | —                                       | sonnet  |
| integration-test    | (orchestrator)            | —                                       | sonnet  |
| e2e-test            | (orchestrator)            | —                                       | sonnet  |
| implementation      | (orchestrator)            | —                                       | sonnet  |
| refactor            | (orchestrator)            | —                                       | haiku   |
| generic             | (orchestrator)            | —                                       | haiku   |

## Custom routing rules

<!-- user-override -->
<!-- Add your own task types and routing rules. /sdd:tasks uses these alongside the defaults above. -->

| Task type       | Specialist agent | Skills to load  | Model  |
|-----------------|-------------------|-----------------|--------|
| unit-test       | testing:unit-tester | testing:unit-testing | sonnet |

## Generated / out-of-band paths

<!-- user-override -->
<!-- Glob patterns for files that are GENERATED or otherwise not hand-authored (regenerated API
     clients, mocks, schemas, snapshots, lockfiles). SDD's diff-consuming agents (spec-guard,
     drift-detector, reviewer, /sdd:analyze) EXCLUDE these from any `git diff` they pull into
     context and NEVER flag them as out-of-scope or drift. Tailor the list to your project. -->
- `**/*.msw.ts`
- `**/*.schemas.ts`
- `**/*.generated.*`
- `**/generated/**`
- `**/__snapshots__/**`
- `**/*.snap`
- `**/package-lock.json`
- `**/yarn.lock`
- `**/pnpm-lock.yaml`
