# neukreativ Fork-Workflow

Kanonical fork: [github.com/neukreativ/instatic](https://github.com/neukreativ/instatic) (GitHub-Fork von CoreBunch/Instatic).

Lokal: `~/Dev/instatic`

| Remote     | Repo                  | Zweck                               |
| ---------- | --------------------- | ----------------------------------- |
| `origin`   | `neukreativ/instatic` | Push/Pull — eigene Entwicklung      |
| `upstream` | `corebunch/instatic`  | Core lesen — Spiegel für `main`     |

## Branch-Modell

| Branch | Inhalt |
| ------ | ------ |
| **`main`** | **1:1-Spiegel von Core** (`upstream/main`). Keine neukreativ-eigenen Commits. |
| **`neukreativ/fork-tooling`** | Fork-Scripts + diese Doku. Nicht an Core mergen. |
| **`feat/…` / `fix/…`** | Ein Feature pro Branch → optional Draft-PR an Core. |

Workflow-Scripts liegen nur auf `neukreativ/fork-tooling`:

```sh
cd ~/Dev/instatic
git checkout neukreativ/fork-tooling
```

---

## Agent-Befehle (Kurzform)

| Du schreibst (sinngemäß) | Befehl |
| ------------------------ | ------ |
| **„Hol die neue Version von Core und prüfe ob unsere Features kompatibel sind“** | `git checkout neukreativ/fork-tooling && ./scripts/check-core-compat.sh` |
| Nur Core holen, Features unangetastet | `./scripts/sync-upstream.sh` |
| Schnellcheck ohne Rebase | `./scripts/check-core-compat.sh --dry-run` |
| Nach erfolgreichem Check pushen | `./scripts/check-core-compat.sh --push` |
| Draft-PRs an Core (nach manuellem QA) | `./scripts/create-upstream-draft-prs.sh` |

---

## Upstream — nicht automatisch

`upstream` ist nur ein zweites Remote. Nichts passiert von allein.

### `./scripts/sync-upstream.sh`

1. `git fetch upstream`
2. `main` hard-reset auf `upstream/main` (identisch mit Core)
3. `git push origin main --force-with-lease`

**Feature-Branches werden nicht angefasst.**

### `./scripts/check-core-compat.sh`

1. Führt `sync-upstream.sh` aus (Core → `main` → `origin/main`)
2. Rebasiert jeden Feature-Branch auf das neue `main`
3. Führt `bun test` pro Branch aus
4. Meldet Konflikte / Test-Fails

Ohne `--push` bleiben Rebase-Ergebnisse **lokal** — sicher zum Inspizieren. Mit `--push` gehen rebased Branches nach `origin`.

### Risiko „Features zerschießen“?

| Aktion | Risiko |
| ------ | ------ |
| `sync-upstream.sh` | Keins für Feature-Branches |
| `check-core-compat.sh` ohne `--push` | Rebase lokal; bei Konflikt bricht das Script ab (`rebase --abort`) |
| `check-core-compat.sh --push` | Überschreibt Remote-Feature-Branches (nur nach grünem Test) |
| Feature-Branch nie rebasen | Kein Datenverlust — Branch bleibt auf altem Core-Stand |

---

## Editor-Features (Stand Juni 2026)

**Inline-Text-Edit auf dem Canvas ist bereits Core** (`docs/editor.md`, `inlineEditSlice`, Doppelklick/Enter). Kein eigener Fork-PR dafür.

Jedes **neukreativ-eigene** Feature = **eigener Branch** auf `origin`. Alles zusammen testen: **`feat/all-editor-qa`**.

| Branch | Reihenfolge Core-PR | Kurzbeschreibung | Manueller Test |
| ------ | ------------------- | ---------------- | -------------- |
| `feat/preserve-style-search-across-selectors` | 1 | Style-Suche bleibt bei Selector-Pill-Wechsel | Style-Panel: suchen, Selector-Pill wechseln |
| `feat/editor-canvas-text-click-selects-content` | 2 | Canvas-Text-Klick → Text-Modul | Text anklicken → Modul selektiert |
| `fix/editor-breakpoint-style-cascade-panel` | parallel zu 2 | Breakpoint-CSS-Kaskade im Panel | Breakpoint + Vererbung prüfen |
| `feat/editor-active-expanded-property-sections` | 3 (nach Style-Search) | „Active“ Property-Sections | Modus umschalten, Auswahl wechseln |

Verworfen / nicht an Core: `feat/editor-inline-text-edit-canvas` (Duplikat zu Core).

Referenz (historisch): `wip/all-editor-improvements`

### Feature manuell testen

```sh
cd ~/Dev/instatic
git fetch origin
git checkout feat/<branch>
bun install && bun test && bun run dev
# Admin → Site-Editor, Checkliste oben
```

Nach Core-Update zuerst compat-Check, dann manuell:

```sh
git checkout neukreativ/fork-tooling
./scripts/check-core-compat.sh
# bei Erfolg optional:
./scripts/check-core-compat.sh --push
git checkout feat/<branch> && bun run dev
```

### Core-PRs (Draft, nach QA)

```sh
git checkout neukreativ/fork-tooling
./scripts/create-upstream-draft-prs.sh
# oder einzeln:
./scripts/open-upstream-draft-pr.sh feat/preserve-style-search-across-selectors "title" -
```

Ziel: `CoreBunch/instatic` ← `neukreativ/instatic:<branch>`

---

## Typischer Rhythmus

```text
Core released ──► sync-upstream.sh (main spiegeln)
                      │
                      ▼
              check-core-compat.sh (rebase + bun test)
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
     alles grün              Konflikt / Fail
          │                       │
          ▼                       ▼
  manuell im Editor QA      Konflikt lösen, erneut testen
          │
          ▼
  create-upstream-draft-prs.sh (Draft an Core)
```

## Kundenprojekte

- Deploys von `origin/main` (Core-Stand) oder release-Tags auf neukreativ-Fork.
- Kunden-Features: Branch von `main` → merge in Kunden-Branch / Tag — Core-PR optional.
