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
| `2f1d29a` | 2026-11-22 09:40 | the gate, first round (section 3) |
| `d28d7b1` | 2026-11-22 09:41 | merge of `main` b247e17 (Help offline in Safari's engine, the Files panel's storage notice, the null device, the drawing of unusual text, a run command kept during a load) |
| (the gate) | 2026-11-22 | the gate, second round (section 3), committed after this record |

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

The gate had two rounds. In each, four engineers repaired the packages they own (layout: N1, N2,
N6; foundation: N0 and the contracts, kit, shell, CI; history: N3, N4, N7; files: N5, N8); their
errata are in `docs/porting/errata/N0.md` to `N8.md`. Then one engineer (NI) closed the round
alone, and two independent reviewers followed.

What the second round repaired:

- layout (N1, erratum N1 entry 25): with Lock Layout on, the splitters and shown tab strips take
  main's places in the Tab order and the reading order (`ui/dock/order.ts`, slots in the content
  layer); each tab's `aria-controls` names the element that really is its tab panel, the viewer's
  tabs included. `check-dock.mjs` compares the Tab order with main's, both directions.
- history (N3, N4, N7; errata N3, N4 entry 16, N7 entry 15): every change of the history is tried
  up to three times; `moved`, `dropTrash`, `clearVersions` and `deleteAll` reject with "The history
  could not be changed (...). Your files are not affected." instead of leaving a file's history
  behind (14 of the 30 failing seeds of the model test were this defect, 16 were gaps in the model);
  the Trash and Port Additions dialogs show that message. The model test replays its regression
  seeds again (a fault choice drawn from its own random stream), and 32 seeds are named cases.
- files (N5, errata N5 entries 18 to 20): Rename and Undo Rename of a folder copy, check and remove
  per file (`features/files/rename.ts`), so a file changed during the copy is never lost; an opened
  folder that is itself `.git` refuses every command; main's storage notice works with the stage's
  selection and keys.
- foundation (N0, erratum N0 entries 5 and 11): `tools/check-frame-policy.mjs` (Help, a PDF and a
  picture under the production policy, offline, and the frames refusing every other address); the CI
  job `history-model` runs seeds 1 to 2,000 on runners of their own, `npm test` 200.

The closing engineer of the first round:

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

The closing engineer of the second round made one change of code: the test of "Open the containing
folder..." (`features/files-fsaccess/controller.test.ts`) now requires the reopen to ask for text
(P3.4.1); it fails when `{ asText: true }` is taken out of `controller.ts`.

### 3.1 What ran, on Windows 11 (this machine), against the working copy

The closing pass of the second round, on the working copy of `d28d7b1` with the round's repairs:

| Command | Result |
|---|---|
| `npm run typecheck` | app, desktop and tests ok |
| `npm run lint` | eslint clean; lint tests 208 passed, 1 skipped |
| `npm run format:check` | all files in Prettier's style |
| `npm run check:docs` | 14 of 14 |
| `npm test -- --maxWorkers=4` (`EASY68K_REQUIRE_ENGINES=1`) | 249 files passed, 1 skipped; 5,006 tests passed, 61 skipped |
| `npm run test:conformance -- --maxWorkers=4` | 40 files passed, 1 skipped; 1,279 passed, 142 skipped (3.2) |
| `npm run test:integration` | 2 files; 21 passed, 2 skipped |
| `npm run test:e2e` (both browsers, 4 workers, a production build of the working copy) | 616 tests: 612 passed, 3 skipped, 1 failed: WebKit `editor/editing.spec.ts:100`, "page.goto: Failed sending data to the peer" (the browser's connection, before the page loaded); the file then passed 140 of 140 (5 repetitions) |
| `tests/e2e/app/chords.spec.ts:85`, 30 repetitions per browser | Chromium 29 of 30, WebKit 30 of 30 (section 4) |

Every `check:*` script of the root `package.json`, one after the other, in Chromium and WebKit
(`--browser all`; `check:engine-browsers` runs both itself, `check:docs` is Node):

| Script | Checks | Script | Checks |
|---|---|---|---|
| gallery | 254 of 254 | sim-files | 80 of 80 |
| shell | 385 of 385 | breakpoints | 74 of 74 |
| engine-browsers | 24 of 24 tests | log | 144 of 144 |
| editor | 168 of 168 | wave2 | 185 of 185 |
| highlight | 58 of 58 | examples | 309 of 309 |
| files | 379 of 379 | desktop-devices | 36 of 36 |
| documents | 76 of 76 | a11y | 1,488 of 1,488 |
| help | 164 of 164 | perf | 46 of 46 |
| surface | 28 of 28 | docs | 14 of 14 |
| easybin | 174 of 174 | dock | 476 of 476 |
| memory-stack | 172 of 172 | history | 56 of 56 |
| text | 78 of 78 | history-ui | 176 of 176 |
| output | 567 of 567 | viewer | 196 of 196 |
| hardware | 74 of 74 | status | 32 of 32 |
| stop-buttons | 20 of 20 | additions | 88 of 88 |
| run | 142 of 142 | frame-policy | 74 of 74 |
| sim-main | 178 of 178 | pwa | 114 of 114 |
| wave1 | 268 of 268 | options | 122 of 122 |
| find | 70 of 70 | print | 52 of 52 |
| fsaccess | 90 of 90 | assemble | 98 of 98 |
| audio | 47 of 47 | | |

All 41 exited 0. The lines of `check:examples`, without their times, are those of main's last two
runs on this machine, line for line.

On GitHub (read-only), the push of `d28d7b1` (run 45034214633) failed only in the accessibility
job on macOS (section 4); the push of `2f1d29a` (45034123000) also failed `perf (ubuntu, webkit)`
and the simulator group of `browser-checks` on Ubuntu and macOS, which passed in the run of
`d28d7b1`.

### 3.2 P1.1 across the stage

Against `main` at b247e17, the last commit of `main` in `plus`:

- **Menus and keys.** `node tools/diff-menus.mjs --main b247e17`: 330 of 330 comparisons passed.
  The tool loads both sides' own `commands/menus.ts`, `native-menu.ts` and `tables/keys.ts` and
  resolves the menu bar for the three modes, the three key maps, browser and desktop, with and
  without three open documents, and the native Mac menu; main's items come first and unchanged in
  every menu and submenu, and the stage's items follow after a separator (in the Editor's Window
  menu after the document list, in the native Window menu before Minimize and Zoom). No entry of
  `keys.ts` is added, changed or removed. What the stage adds: File (Earlier Versions..., Trash...),
  Options (Port Additions...), the Editor's Window menu (Move Panel To..., Split Editor Right, Split
  Editor Down, Close Split; Lock Layout, Reset Layout) and the Simulator's View menu (Move Panel
  To..., Lock Layout, Reset Layout). The tool compares with every command enabled and none checked,
  so it does not compare when an item is enabled.
- **Engines.** `engine/dist/asm68k.wasm` (136,962 bytes) and `sim68k.wasm` (160,422 bytes) are byte
  for byte main's (SHA-256 equal), and so are the copies in the production build.
  `git diff b247e17` shows no change in `engine/`, `tests/conformance`, `tests/oracle`,
  `tests/perf`, `app/src/engine`, `app/src/core/sim-host` or `commands/tables/keys.ts`.
- **Conformance.** `npm run test:conformance` (4 workers, `EASY68K_REQUIRE_ENGINES=1`, main's local
  corpora in `build/`): 40 files passed, 1 skipped; 1,279 tests passed, 142 skipped. Main's last
  result is 1,280 and 141. The one test more that skips is `tests/oracle/native-twin/sim-script.test.mjs`
  "the built twin gives the same transcript": it needs a native twin built from this tree's exact
  sources, and none is built here (main's twin was built after b27ae56 changed one line of
  `engine/asm/PATCHES.md`, so it is stale for b247e17). Every other skip is main's.
- **Programs and text.** `check:examples` and `check:text` in Chromium and WebKit: see 3.1. Every
  digest of `check:text` is main's (text a79ef195, text-outline 5dd6da56, text-outline-zero
  6c1d06c8, text-outline-glyphs 0e1f5fbb, text-control ca729b7d, text-path f854b921,
  text-path-euro 6c015f90, text-path-formfeed 8245a757; scenarios 35872d6e, 8703d622, 2c5e1a00,
  b8d2be7a).

### 3.3 The production build

`npx vite build` of this working copy and of b247e17 (the same engines and dependencies):

| | `main` b247e17 | `plus` | Increase | P2.4's estimate |
|---|---|---|---|---|
| JS and CSS loaded at start, gzip -9 | 396.5 kB | 505.4 kB | 108.9 kB (JS 103.7, CSS 5.1) | about 80 kB (55 layout, 25 own code) |
| All JS and CSS, gzip -9 | 452.3 kB | 572.4 kB | 120.1 kB | about 100 kB |
| The merge view (on demand) | - | 10.4 kB | 10.4 kB | about 20 kB |
| Files of the build | 437 | 439 | 2 | |

The total is 20 % over the estimate, the start-up part 36 %. Where it goes (the start chunk's
minified bytes attributed by its source map, gzip in proportion): `flexlayout-react` about 60 kB
(the estimate's 55 kB for FlexLayout and our layout code together), `ui/dock` about 15 kB, the
history store and dialogs (`fs/history*`, `core/history`, `features/history`) about 17 kB, Port
Additions, viewer and layout commands about 5 kB, and the stage's part of the Files panel. The
merge view is half its estimate. So the excess is our own code (the dock with the locked Tab order,
the history store's retries and checks), not a dependency; no dependency was added beyond P2.4's
two.

Content Security Policy: the built page carries main's policy with only `frame-src 'self' blob:`
added. A probe (Chromium and WebKit, the build served by `tests/e2e/fixtures/serve.mjs`) dropped a
PDF and a PNG into the Editor (each shown in a viewer tab), opened Help with F1, and switched to
Simulator, EASyBIN and back to Editor with them open: 41 of 41 checks, no
`securitypolicyviolation` in the page or any frame (Help's, the viewers'), no console error.
`npm run check:frame-policy` (offline, service worker in control): see 3.1.

## 4. Still open, and whose it is

- **Merge `main` b27ae56 into `plus`** (orchestrator). It brings main's repair of
  `tests/a11y/lib/walk.mjs` ("the typed answer reaches the program": the check read the run phase
  before the store had it; it fails on GitHub's macOS runner, runs 45034123000 and 45034214633 of
  `plus`, and on main) and the rewrite of `oracle.yml` (actionlint's SC2016 in the job `propose`).
  Until then the accessibility job of `plus` fails on macOS.
- **`tests/e2e/app/chords.spec.ts:85` is flaky, on `main` as here** (X1, on `main`). Measured: in
  Chromium only (1 of 30 here, 0 of 30 in WebKit; 6 of 12 under the first round's load). The chord
  missed is always Ctrl+F, right after Ctrl+P, in the editor and in the Files panel. Ctrl+P makes
  `platform/web.ts` add the hidden print frame, which on `load` calls `focus()` on its window and
  `print()`; the frame takes the focus about 30 ms after the key, and the fixture's recording
  `print()` sends `afterprint` with `setTimeout(0)`, which removes the frame about 15 ms later.
  `pressAll` waits for neither, so Ctrl+F goes to the frame: a listener in the frame saw "keydown
  ControlLeft, keydown KeyF", the page saw none. After the frame is removed the page has
  `document.hasFocus()` false and the focus on `body`. Repair of the test: after a chord that
  prints, wait until no print frame is left and the page has the focus again. The same evidence
  shows a question for `platform/web.ts` (W3): `printDocument` does not give the focus back to the
  element that had it before printing.
- **D4, the typical student's history: decided** (by the architect, 22 November 2026, D-d). Deltas
  are not built for the first release: the budget B bounds the storage in any case, and stress run
  (a)'s typical student (39.33 MB at B = 64 MB) stays inside it. The owner may ask for deltas later;
  the figure and the options are in erratum N3 "The typical-student figure".
- **The model test's time** (orchestrator, after the commit): read "history model: 1000 seeds in 4
  processes in <s> s" in the new CI job `history-model` on ubuntu-latest (P5 N3: 5 minutes). Inside
  `npm test` the 2,000 seeds took 472 s on Ubuntu, 416 s on Windows and 776 s on macOS; `npm test`
  now runs 200.
- **Decisions asked of the owner:** an opened folder that is itself `.git` refuses Import too,
  against the letter of P1.1 rule 2 (erratum N5 entry 19); before a service worker controls the
  page, the PDF frame can be navigated to the application's page and shows a copy of it inside the
  frame (erratum N0 entry 11; it needs the page's own code or a click on a link in the PDF; not tried
  in the desktop app); whether admission should first check that a copy moving back from the Trash
  can fit at all (seed 4063, P3.3.4).
- **Not run here:** anything on macOS or Linux before the next push; WebKit's opened-folder passes
  of `check-files` and `check-history` (Playwright's WebKit on Windows has no origin private file
  system); the desktop app with a window (none may be opened on this machine); a real screen reader
  on the slots of the locked layout; Safari's "Tab does not stop at buttons" on a real Mac.
- **A test gap** (N3 and N5): the model of `fs/history-model.ts` places no `/folder` path
  (`placeOf` without the root's id), so `features/files/files-model.test.ts` cannot mount an opened
  folder. The opened folder is covered by `check-files` and `check-history` in Chromium.

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
