# Feature: {{feature_title}}

**Branch:** {{type}}/{{feature_slug}}
**Status:** draft  <!-- lifecycle: draft → clarified → planned → in-progress → done; advanced automatically by each /sdd command -->
**Type:** {{type}}  <!-- feat | fix | chore | refactor | docs -->
**Owner:** {{author}}
**Created:** {{date}}

---

## Summary (business)

<!-- What problem are we solving and for whom. DO NOT write HOW. -->

## User stories

- As a **<role>**, I want **<what>**, so that **<why>**.

## Functional requirements

- [ ] FR1: ...
- [ ] FR2: ...

## Acceptance criteria

<!-- Concrete, measurable. Each AC maps to one test. -->

- [ ] AC1: given input X → produces output Y
- [ ] AC2: ...

## Edge cases

<!-- What if: no network, race condition, invalid input, concurrent users, ... -->

- ?

## Non-goals (out of scope)

<!-- What this feature does NOT do. Protects against scope creep. -->

- ...

## Open questions

<!-- The /sdd:clarify phase fills these in. The owner answers them BEFORE /plan. -->

- ?

## Testing guidelines

<!-- Test framework, test file locations, what to test at each layer -->

- **TDD strategy** (technology-neutral; test-first is the default):
  - **Test-first (default)** → write the failing test first, then the implementation. If a missing symbol stops the test compiling, add a trivial stub so it fails on a real assertion. Use for anything whose deliverable is behavior.
  - **Contract-first (exception, 3 phases)** → use only when the unit's deliverable *is itself a public interface/contract* other code references by shape (a UI component's props, a typed service interface, an API/RPC schema): define the contract first, then the failing tests, then the implementation. When in doubt, choose test-first.
- Unit:
- Integration:
- E2E:
- A11y (if UI):

## Dependencies & prerequisites

<!-- What must be ready beforehand (other features, env vars, infra). -->

- ...

## Notes

<!-- Links to Figma, design docs, ADRs -->
