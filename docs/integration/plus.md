# The stage of additions: integration record

Owner: NI (ARCHITECTURE-PLUS P5 "NI - Integration", P6.4). The record of every merge into the
branch `plus` and of the integration pass. Started at the gate that made the packages N0 to N8 pass
together (2026-11-22). Later merges and the integration pass add sections below.

The stage is built alongside the last work on the faithful port (the owner's decision of
2026-11-21): where P6 says "the 1.0.0 tag", read the last commit of `main` merged into `plus`.
Nothing of `plus` is on `main` or on the public preview; no `v*` tag is set on `plus`.

## 1. Merges into `plus`

| Commit | Date (UTC-5) | What |
|---|---|---|
| `847b61a` | 2026-11-22 00:12 | N0: foundation (dependencies, contracts, command tables, configuration), on `main` 191e768 |
| `034acaf` | 2026-11-22 00:15 | merge of `main` f17e78a |
| `7bb9425` | 2026-11-22 00:38 | check-wave2 allows the stage's commands without a handler while disabled (removed again at the gate) |
| `5fb89b3` | 2026-11-22 01:42 | merge of `main` 314d35e (the simulator's end-to-end suites, the parity matrix) |
| `67ad283` | 2026-11-22 02:47 | snapshot of N1, N2, N3 and N6 in progress |
| `67a3e7f` | 2026-11-22 02:47 | merge of `main` 4bd5f68 (second round before the release candidate) |
| `6c97dfb` | 2026-11-22 07:53 | N1 to N8 as built and independently verified |
| (the gate) | 2026-11-22 | the repairs of the gate, section 3 |

The packages were built side by side in one working copy and committed together (P6.2 as the
owner's decision of 2026-11-21 reads it), not merged one by one.

## 2. The packages and their independent verification

From the builders' and verifiers' papers (`build/plus/*.json`, not tracked). "Met" counts the
acceptance items the last round found met; the rest were "partly" or "could not check" and are
taken up in sections 3 and 4.

| Package | What | Rounds | Last round | Defects of the last round | Acceptance met / not fully met |
|---|---|---|---|---|---|
| N0 | foundation | 2 | pass | 3 minor | 22 / 1 (the empty `build/golden-local`: `main`'s defect, fixed on `main` in a31a677) |
| N1 | dock layout | 1 | pass | 2 minor | 21 / 1 (every suite with N1: see section 4) |
| N2 | editor split, document tabs | 1 | pass | 3 minor | 10 / 1 (shared checks red from other packages then) |
| N3 | history store | 1 | pass | 4 minor | 13 / several (the model test's time on ubuntu-latest: section 5) |
| N4 | history and Trash dialogs, recording | 1 | pass | 4 minor | 28 / several (a folder's real name, No as default: repaired at the gate) |
| N5 | Files panel | 2 | not passed | 2 major, 4 minor | 20 / several (Export fixture, `.git` rename: repaired at the gate) |
| N6 | viewer, documents' hooks | 1 | pass | 4 minor | 21 / 1 (shared checks red from other packages then) |
| N7 | Port Additions dialog | 1 | pass | 2 minor | 11 / 1 (the desktop texts: Electron not started) |
| N8 | real folders, place names, Git folders | 1 | pass | 4 minor | 11 / 1 (the folder's place text: repaired at the gate) |

## 3. The gate (2026-11-22)

Four engineers repaired the packages they own in this round (layout: N1, N2, N6; foundation: N0
and the contracts, kit, shell, CI; history: N3, N4, N7; files: N5, N8); their errata are in
`docs/porting/errata/N0.md` to `N8.md`. Then the closing engineer (NI) alone:

- applied `docs/requests/N6-include-as-text.md`: `features/assemble/assemble.ts` (the include files
  of the assembler's error rows) and `features/files-fsaccess/controller.ts` (the reopen after
  "Open the containing folder...") call `documents.open(path, { asText: true })`; N6's
  `callers.test.ts` lists them as `text`, and its include case is an ordinary test that passes with
  the real assembler;
- implemented `DocumentService.newSourceWithText` in `core/documents/service.ts`
  (`docs/requests/N4-history-ui.md` item 1), with a unit test, so that Open as New Document no
  longer needs the editor-extension fallback;
- made the history store refuse an opened folder that is itself a `.git` folder (N5's report:
  no segment of its paths says `.git`): nothing is recorded there and `guard` rejects every path
  before `act` (errata N3, last entry; test in `history-db.test.ts`);
- wrote `tools/diff-menus.mjs` (P6.4): compares the resolved menus and the native menu of `main`
  and `plus` for the three modes, the three key maps, browser and desktop, with and without open
  documents, and the key table `commands/tables/keys.ts`.

### 3.1 What ran, on Windows 11 (this machine), against the working copy

RESULTS

### 3.2 P1.1 across the stage

MENUS

### 3.3 The production build

BUILD

## 4. Still open, and whose it is

OPEN

## 5. New packages and licences

`node tools/lockfile-licences.mjs --base 4bd5f68` (the last commit of `main` in `plus`):

```
package-lock.json against 4bd5f68:
added    node_modules/@codemirror/merge  6.12.3  MIT
added    node_modules/flexlayout-react  0.11.1  MIT
2 packages added or changed, 0 not MIT, BSD or ISC, 0 with an install script
```

No other entry of `package-lock.json` differs from `main`'s. Neither package is Apache-2.0 or
GPL-incompatible, and neither has an install script (P2.4, P6.4). Pinned versions and why:
`docs/requests/N0.md` section 1.
