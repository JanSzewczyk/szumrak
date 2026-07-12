---
name: storybook-testing
description: Użyj gdy zadanie dotyczy dodania lub edycji testów Storybook
  dla komponentu React — "dodaj testy do komponentu", "napisz story",
  "testy wizualne komponentu". Nie używaj do testów logiki biznesowej (użyj
  vitest-unit-testing) ani do samego tworzenia komponentu bez testów.
---

# Storybook Testing w CraftFlow

> ⚠️ PLACEHOLDER — do uzupełnienia przed pierwszym uruchomieniem (Faza 2 planu wdrożenia).
> Treść tego pliku MUSI zostać wyekstrahowana z 2-3 realnych `.stories.tsx` z repo
> CraftFlow, nie napisana teoretycznie z ogólnej wiedzy o Storybooku — inaczej agent
> nie będzie trzymał się rzeczywistych konwencji projektu (decyzja z dokumentacji,
> strona 4 i 6 planu).

## Konwencja plików

Story żyje obok komponentu: `ComponentName.stories.tsx`

## Wzorzec

[TODO: wkleić 1-2 konkretne przykłady wyekstrahowane z realnego kodu CraftFlow —
struktura `Meta`/`StoryObj`, sposób mockowania danych, użycie `play` function]

## Checklist przed zakończeniem

- [ ] Story pokrywa default state + edge case
- [ ] Użyto `play` function jeśli komponent ma interakcję
- [ ] `npm run storybook:test` przechodzi (dostosuj nazwę skryptu do realnego `package.json`)
