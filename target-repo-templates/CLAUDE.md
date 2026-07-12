# CraftFlow — instrukcje dla agenta

> Szablon startowy do dostosowania pod rzeczywisty stack i konwencje CraftFlow.
> Uzupełnij sekcje poniżej realną architekturą repo docelowego przed pierwszym uruchomieniem Szumraka.

## Architektura

Feature-driven layered architecture. Każda feature w `src/features/<nazwa>/`
ma własne: components, server-actions, db (Drizzle schema/queries), types.

## Gdzie zacząć szukać

- Komponenty UI: `src/features/<nazwa>/components/`
- Server actions: `src/features/<nazwa>/server/actions/`
- Zapytania do bazy: `src/features/<nazwa>/server/db/`
- Kod współdzielony: `src/shared/`

## Strict import boundaries

- Feature A NIE może importować bezpośrednio z `features/B/internal/*`
- Import tylko przez `features/B/index.ts` (public API feature'a)
- Współdzielony kod → `src/shared/`

## Stack

Next.js, React, TypeScript, Drizzle ORM + Supabase, Clerk, Resend.
Testy: Vitest (unit), Storybook (component), Playwright (e2e).

## Konwencje

- UI strings po polsku
- Commit messages: semantic-release (feat:/fix:/chore:)
- Nigdy nie modyfikuj: `.env*`, `middleware.ts`, konfiguracji Clerk

## Jak weryfikować pracę

```
npm run typecheck && npm run lint && npm run test
```
