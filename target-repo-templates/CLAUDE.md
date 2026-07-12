# Target repo — agent instructions

> Starter template to adapt to the real stack and conventions of the target
> repository. Fill in the sections below with the actual architecture before the
> first Szumrak run.

## Architecture

Feature-driven layered architecture. Each feature lives in `src/features/<name>/`
with its own: components, server actions, db layer, and types.

## Where to start looking

- UI components: `src/features/<name>/components/`
- Server actions: `src/features/<name>/server/actions/`
- Database queries: `src/features/<name>/server/db/`
- Shared code: `src/shared/`

## Strict import boundaries

- Feature A MUST NOT import directly from `features/B/internal/*`
- Import only through `features/B/index.ts` (the feature's public API)
- Shared code → `src/shared/`

## Stack

Next.js, React, TypeScript. Adjust to the target repo's actual dependencies.

## Conventions

- Commit messages: semantic-release (feat:/fix:/chore:)
- Never modify: `.env*`, `middleware.ts`, auth configuration

## How to verify your work

```
npm run typecheck && npm run lint && npm run test
```
