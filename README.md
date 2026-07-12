# Szumrak

Autonomiczny agent wykonujący wąskie, wysoko-weryfikowalne zadania na repozytoriach
docelowych (np. CraftFlow), oparty na Claude Agent SDK. Pełna koncepcja i decyzje
architektoniczne — patrz dokumentacja Notion, strona "Plan wdrożenia — fazy,
wymagania, priorytety".

## Status

Faza 0–1–2 (szkielet) planu wdrożenia. Silnik uruchamia się lokalnie i w
kontenerze; integracja CI (Faza 5) i realne skille (Faza 9) — kolejne kroki.

## Struktura

```
szumrak/
├── docker/Dockerfile
├── src/
│   ├── index.ts        # entrypoint
│   ├── runAgent.ts      # wrapper na Claude Agent SDK
│   ├── validation.ts    # post-hoc check użycia skilli
│   ├── git.ts            # commit/push/PR
│   ├── config.ts         # limity, stałe
│   └── logger.ts         # structured logging do JSONL
└── target-repo-templates/  # pliki do skopiowania DO repo docelowego
    ├── CLAUDE.md
    └── .claude/
        ├── settings.json
        └── skills/storybook-testing/SKILL.md
```

## Wymagane zmienne środowiskowe

| Zmienna | Wymagana | Opis |
|---|---|---|
| `ANTHROPIC_API_KEY` | tak | klucz do Claude API |
| `TASK` | tak | treść zadania dla agenta |
| `WORKSPACE_PATH` | nie (domyślnie `/workspace`) | ścieżka do repo docelowego |
| `REPO` | tak przy tworzeniu PR | `owner/repo` repozytorium docelowego |
| `GH_TOKEN` | tak przy tworzeniu PR | PAT z minimalnym scope |
| `DRY_RUN` | nie | `true` pomija commit/push/PR, zmiany zostają tylko na dysku |
| `MAX_TURNS` | nie (domyślnie 30) | limit tur agenta |
| `MAX_DURATION_MS` | nie (domyślnie 900000) | limit czasu runu |
| `AGENT_LOG_PATH` | nie (domyślnie `/workspace/agent-run.jsonl`) | ścieżka logu JSONL |

## Testowanie lokalne — trzy poziomy

Nie czekaj na GitHub Actions żeby sprawdzić, czy agent poprawnie czyta
`CLAUDE.md` i skille docelowego repo. Zalecana kolejność pracy:

### Poziom 1 — bezpośrednio na hoście (bez Dockera)

Najszybsza pętla feedbacku, do debugowania samej logiki agenta.

```bash
npm run build
WORKSPACE_PATH=/ścieżka/do/lokalnego/craftflow \
TASK="Dodaj testy Storybook do komponentu InvoiceCard" \
DRY_RUN=true \
ANTHROPIC_API_KEY=sk-ant-... \
npm start
```

### Poziom 2 — w kontenerze, lokalnie zbudowanym

Waliduje izolację środowiskową (brakujące binarki, ścieżki, uprawnienia).

```bash
npm run dev:build

CRAFTFLOW_PATH=/ścieżka/do/lokalnego/craftflow \
TASK="Dodaj testy Storybook do komponentu InvoiceCard" \
npm run dev:run
```

Montowany jest lokalny checkout repo docelowego jako wolumen — zmiany widoczne
od razu przez `git diff` w tamtym repo. `DRY_RUN=true` jest domyślnie ustawiony
w skrypcie `dev:run`, więc nie trzeba się martwić o spam PR-ami testowymi.

### Poziom 3 — pełny cykl w GitHub Actions

Dopiero gdy logika działa w Poziomie 1 i 2 — patrz `.github/workflows/agent.yml`
w repo docelowym (Faza 5 planu wdrożenia, jeszcze nie zaimplementowana w tym repo).

## Uwaga o zależności SDK

`@anthropic-ai/claude-agent-sdk` bywa aktualizowane często. Przed większymi
zmianami w `src/runAgent.ts` warto zweryfikować aktualny kształt API
bezpośrednio w `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` —
dokumentacja bywa nieaktualna względem realnie opublikowanej wersji.
