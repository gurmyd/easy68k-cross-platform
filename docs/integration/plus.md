# The stage of additions: integration record

Owner: NI (ARCHITECTURE-PLUS P5 "NI - Integration", P6.4). The record of every merge into the
branch `plus` and of the integration pass. Started at the gate that made the packages N0 to N8 pass
together (2026-11-22). Later merges and the integration pass add sections below.

The stage is built alongside the last work on the faithful port (the owner's decision of
2026-11-21): where P6 says "the 1.0.0 tag", read the last commit of `main` merged into `plus`.
There is one first public release and it contains the additions (the owner's decision of
2026-11-22): the last point of P6.4 (version 1.1.0, tag `v1.1.0`) is void; no version and no tag
is set. Nothing of `plus` is on `main` or on the public preview; no `v*` tag is set on `plus`.
The integration pass of P6.4 is section 5.

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
| `ac1e9af` | 2026-11-22 14:10 | the gate, second round (section 3), as built |
| `57331da` | 2026-11-22 14:19 | merge of `main` 12d69b1 |
| `28291d8` | 2026-11-22 16:52 | N10: the guide, the differences, the manual list |
| `823d791` | 2026-11-22 16:52 | N9: the end-to-end tests of the stage (`tests/e2e/plus`) |
| `d90cfcb` | 2026-11-22 17:17 | N9: a two-window test that can fail, split and lock |
| `f6d5491` | 2026-11-22 17:33 | the gate, third round (section 3.4) |
| `82da145` | 2026-11-22 17:35 | merge of `main` dccb717 (a clearer message for a storage that does not answer, a time limit for the drafts database, two repairs of test oracles and documents) |
| (this pass) | 2026-11-22 | the gate, fourth round, and the integration pass (sections 3.5 and 5), committed after this record |

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

The gate had four rounds. In each, the engineers repaired the packages they own (layout: N1, N2,
N6; foundation: N0 and the contracts, kit, shell, CI, in the first two rounds; history: N3, N4, N7;
files: N5, N8; documents: N10, in the fourth); their errata are in `docs/porting/errata/N0.md` to
`N10.md`. Then one engineer (NI) closed the round alone, and independent reviewers followed. The
first two rounds are described here, the third and fourth in 3.4 and 3.5; the fourth round's
closing pass is the integration pass (section 5).

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

### 3.1 What ran at the second round, on Windows 11 (this machine), against the working copy

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

### 3.2 P1.1 across the stage (second round)

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

### 3.3 The production build (second round)

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

### 3.4 The third round (`f6d5491`)

Built on the architect's decisions D-a to D-e (each in the errata of its package): Import into an
opened folder that is itself a `.git` folder is not refused (P1.1 rule 2 as written; the other
commands of the stage stay refused there); the questions that cannot be undone (Delete for Good,
Empty Trash, Delete History and Trash, Delete Earlier Versions, a Trash restore that replaces
without a copy) have No as their default; the viewer puts its document back when its frame is sent
elsewhere; no deltas for the history in the first release (D4); a copy moving back from the Trash
prunes nothing when it is not kept. Repairs: a folder Rename while a file is moved out no longer
leaves a duplicate; the history's model places an opened folder; FlexLayout's measuring element is
hidden from screen readers. The cause of the second round's major Tab defect was established (the
Files panel's `scrollIntoView` at every render) but not repaired, because the file is N5's
(`docs/requests/N1-files-row-in-view.md`).

The round's independent review (not passed) found: that Tab defect still there (major); two new
texts of N5 that the design did not have (major); a gap of the rename repair, the Move and Copy
replace question with Yes as its default outside "ready", a PDF frame sent to `about:blank` left
empty, WebKit's one extra Shift+Tab stop at `New Folder...`, and `gitStoreRefused` no longer true
(minor). The end-to-end tests of N9 then found that a document opened while a viewer's tab is in
front stays hidden behind it (O-1).

### 3.5 The fourth round

The architect's decisions D-f to D-j (22 November 2026), and the repairs, each recorded in the
errata of its package:

- **Layout (N1, N6; errata N1 28, N6 14 and 15).** O-1: a document opened, chosen or reloaded while
  a viewer's tab is in front of the Editor's brings the Editor's tab forward
  (`DocumentService`'s optional hook `shown`, `DockEngine.documentShown`); the focus stays where
  main leaves it, and goes to the editor only when it was inside the viewer just hidden. D-j: in
  Chromium a PDF frame sent to `about:blank` after its own address was seen gets its document back;
  in WebKit, which never shows the document's address, the gap is recorded (N6 14).
- **Files (N5, N8; errata N5 18 to 24).** O-7, the major Tab defect: the Files panel scrolls its
  tree itself, and only when the focused row changes or a command reveals one; `check-dock.mjs`
  passes in full. D-g: the Move and Copy replace question has No as its default outside "ready".
  D-h: `gitStoreRefused` ends `Nothing was changed in it.` D-i: the strip and the selection count
  line are one element before the tree, so WebKit's Shift+Tab walk equals main's; the
  integration pass removed `check-dock.mjs`'s allowance for it (section 5.6). D-f: the two new texts
  are accepted. The rename gap: a removal that finds nothing counts as a source that is gone, in
  rename, move and Undo of a move; the zero-width window where a save lands between the last check
  and the removal is a known limit (N5 18). O-2: the store's messages and the Open dialog's note say
  "the Export button of the Files panel"; the storage notice keeps `Export...`, which names its own
  button.
- **History (N3; errata N3 "A slow open").** O-4: a history store that does not open within 5 s is
  unavailable only until the browser answers that open; then it becomes ready by itself, with no
  reload.
- **Documents (N10; errata N10 5, 7, 8).** O-3: the guide, the fragments, `docs/DIFFERENCES.md`, the
  manual list (V11 at any width, the new E5) and the change log say what the third and fourth
  rounds made true; `tools/check-guide-strings.mjs` accepts for a `${...}` only what the code puts
  there.

## 4. Still open, and whose it is

- **Done: `main` b27ae56 is merged** (it is in `57331da`), with main's repair of
  `tests/a11y/lib/walk.mjs` and the rewrite of `oracle.yml`.
- **`tests/e2e/app/chords.spec.ts:85`: repaired on `main`** (in dccb717: `tests/e2e/fixtures/printing.ts`,
  `chords.spec.ts` and `platform/web.ts` changed; merged in `82da145`). The second round's finding, kept for the record: in
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
- **Decided since (third round):** Import into an opened `.git` folder is not refused (D-a); the
  PDF frame sent elsewhere gets its document back (D-c, and D-j for `about:blank` in Chromium);
  admission prunes nothing for a copy that is not kept (D-e). The test gap of the second round (the
  history's model placed no `/folder` path) was repaired in the third round.
- **Not run here:** anything on macOS or Linux before the next push; WebKit's opened-folder passes
  of `check-files` and `check-history` (Playwright's WebKit on Windows has no origin private file
  system); the desktop app with a window (none may be opened on this machine); a real screen reader
  on the slots of the locked layout; Safari's "Tab does not stop at buttons" on a real Mac.
- **Known limits accepted at the fourth round, recorded in errata:** in WebKit a PDF frame sent to
  `about:blank` stays empty (WebKit never shows the document's own address, so an empty address
  decides nothing there; N6 14, D-j; the guide says so); a save that lands in the zero-width window
  between the last check of a Rename or Move and its removal of the source is lost from the store
  (no backend has a compare-and-remove; N5 18).
- **For the orchestrator:** the files engineer edited `docs/differences/N5.md` (N10's file) in the
  fourth round, and N10 kept and completed the edit; confirm the ownership.
- **For main's owner of `fs/fsaccess-backend.ts` (FS2), not the stage's:** its text `Open the
  folder or the file again (File > Open), and allow access when the browser asks.` named a menu item
  the build calls `Open File...`. The integration pass left it; the repairs after the fourth round
  corrected it to `(File > Open File...)` (erratum N8), with a test that compares it with the
  caption of `ed.file.open`.
- **For N6, information:** in a WebKit walk-through the documents engineer saw the page error
  `ResizeObserver loop completed with undelivered notifications` after the viewport was resized
  with a viewer open; no check of this pass saw it.
- **On GitHub after the push** (section 5.8): everything of P6.4 that this PC cannot show.

## 5. The integration pass (P6.4), 22 November 2026

On the working copy of `82da145` with the fourth round's repairs, Windows 11 (this machine), Node
24. "main" is `dccb717`, the last commit of `main` merged into `plus`. The production build is
`npx vite build --outDir c:\easy64k\build\ni4-plus\dist` (from `app/`); main's for comparison is the
same command in a tree at `dccb717`. Each point of P6.4:

### 5.1 Every unit test, check script and end-to-end suite

| Command | Result |
|---|---|
| `npm test -- --maxWorkers=4` (`EASY68K_REQUIRE_ENGINES=1`) | 253 files passed, 1 skipped; 5,105 tests passed, 61 skipped; 57 s |
| `npm run typecheck` | app, desktop and tests ok |
| `npm run lint` | eslint clean; lint tests 211 passed, 1 skipped (the guard of `docs/requests/N10-check-guide.md` passes since this pass: 5.7) |
| `npm run test:integration` | 2 files; 21 passed, 2 skipped |
| `npm run test:e2e` (both browsers, `--workers=4`, `E2E_DIST` = the build above) | 650 tests: 647 passed, 3 skipped, 0 failed (8.4 min); `tests/e2e/plus` 17 tests per browser, the long scenario's step 3 included |
| the same, `tests/e2e/plus --repeat-each=5` | 170 of 170 passed (4.5 min) |

Every `check:*` script of the root `package.json`, one after the other, with `--browser all` (the
scripts that start no browser as written), each into a log of its own
(`c:\easy64k\build\ni4-plus\checks`, script `run-checks.mjs`, not tracked); all 43 exited 0:

| Script | Checks | Script | Checks |
|---|---|---|---|
| gallery | 254 of 254 | sim-files | 80 of 80 |
| shell | 385 of 385 | breakpoints | 74 of 74 |
| engine-browsers | 24 of 24 tests | log | 144 of 144 |
| editor | 168 of 168 | wave2 | 185 of 185 |
| highlight | 58 of 58 | examples | 309 of 309 |
| files | 437 of 437 | desktop-devices | 36 of 36 |
| documents | 96 of 96 | a11y | 1,488 of 1,488 |
| help | 164 of 164 | perf | 46 of 46 |
| surface | 28 of 28 | docs | 14 of 14 tests |
| easybin | 174 of 174 | guide | 146 of 146 quotes; 10 of 10 tests |
| memory-stack | 172 of 172 | dock | 642 of 642 |
| text | 78 of 78 | history | 68 of 68 |
| output | 567 of 567 | history-ui | 254 of 254 |
| hardware | 74 of 74 | viewer | 251 of 251 |
| stop-buttons | 20 of 20 | status | 32 of 32 |
| run | 144 of 144 | additions | 96 of 96 |
| sim-main | 178 of 178 | frame-policy | 86 of 86 |
| pwa | 114 of 114 | options | 122 of 122 |
| wave1 | 268 of 268 | find | 70 of 70 |
| print | 122 of 122 | fsaccess | 90 of 90 |
| assemble | 98 of 98 | audio | 47 of 47 |
| rc | no item "does not hold" (after 5.7) | | |

`check:rc` first exited 1 (items 5 and 12); both causes were in its judges, not in the product, and
are repaired (5.7); run again, it exits 0. `check:dock` ran with the allowance of errata N1 26
removed (5.7).

Not shown on this PC, **on GitHub** after the push: every suite above on Ubuntu and macOS (the jobs
`unit`, `e2e`, `browser-checks`, `history-model`, `perf`, `check` of `ci.yml` on the three systems);
the desktop tests on the macOS runner (`desktop-dev`; no window may be opened here); the stability
run of 6.9 item 10 (5.7); WebKit's opened-folder passes of `check-files` and `check-history` (no
origin private file system in Playwright's WebKit on Windows).

### 5.2 The fidelity suites (main §6.9 items 1 to 4)

- `git diff dccb717` shows no change in `engine/`, `tests/conformance`, `tests/oracle`,
  `tests/perf`, `app/src/engine`, `app/src/core/sim-host` or `app/src/commands/tables/keys.ts`, and
  nothing untracked there.
- `engine/dist/asm68k.wasm` (136,962 bytes, SHA-256 `1965d8b1...`) and `sim68k.wasm` (166,783 bytes,
  `44370c8a...`) are byte for byte main's (`c:\easy64k\engine\dist`), and so are the hashed copies in
  the production build.
- `npm run test:conformance -- --maxWorkers=4` with `EASY68K_REQUIRE_ENGINES=1` and main's local site
  set in `build/corpus-local`: 40 files passed, 1 skipped; 1,300 tests passed, 142 skipped, 0 failed.
  The test files of the run are main's (no change since `dccb717`); against the second round's 1,279
  the 21 more are main's (simulator 12, the Wine oracles 9). The 142 skips: the single-step suite
  (126, not fetched, as on main), the native twin's transcript (needs a twin built from this
  tree's sources), and main's own skips of the assembler and simulator comparisons.
- Simulator (item 2): `node tests/integration/rc/item-02-sim-evidence.mjs` on this run's comparison
  prints, line for line, main's report at `dccb717` (`c:\easy64k\build\gate3\sim-now\item02.txt`)
  but for the file names and times: 220 programs, 244 artifacts compared, 240 equal, 4 measured
  differences (all listed); 305 passed, 4 skipped of 309; 188 self-reporting programs, 185
  byte-identical, none counted against the item; 32 of 32 execution logs, 31 byte-identical
  (126,427 of 126,432 instructions).
- Assembler (item 1): `node tests/integration/rc/item-01-asm-evidence.mjs` prints, line for line,
  what it prints on main's reports in the main tree but for the times: corpus 481 runs (361
  identical, 120 masked, 0 differ), checklist 320 runs (293, 23, 4 known), the fixed subset 240 of
  240.
- Drawing (item 3): `check:text` gives main's digests in both browsers (text a79ef195, text-outline
  5dd6da56, text-outline-zero 6c1d06c8, text-outline-glyphs 0e1f5fbb, text-control ca729b7d,
  text-path f854b921, text-path-euro 6c015f90, text-path-formfeed 8245a757; scenarios 35872d6e,
  8703d622, 2c5e1a00, b8d2be7a); the 309 lines of `check:examples`, without their times, are those
  of the second round, which were main's; `tests/conformance/gdi` 90 of 90.
- Twins (item 4): `tests/oracle/native-twin` 23 passed, 3 skipped, as in the second round; the
  twins themselves run in the job `windows-oracles` (on GitHub).

### 5.3 Content Security Policy

`npm run check:frame-policy` (Help, a PDF and a picture under the production policy, offline, the
frames refusing every other address): 86 of 86 in Chromium and WebKit. The probe of the second
round (`c:\easy64k\build\ni4-plus\csp-probe.mjs`, not tracked; the build served by
`tests/e2e/fixtures/serve.mjs`): a PDF and a PNG dropped and shown in viewer tabs, Help opened with
F1, in Editor, Simulator, EASyBIN and Editor again: 41 of 41, no `securitypolicyviolation` in the
page or any frame, no console error. The page carries main's policy with only `frame-src 'self'
blob:` added. The screenshots were looked at.

### 5.4 New packages and licences

Section 6: two packages, both MIT, no install script; no other entry of the lockfile differs from
main's.

### 5.5 The size of the build

| | `main` dccb717 | `plus` | Increase | P2.4's estimate |
|---|---|---|---|---|
| JS and CSS loaded at start, gzip -9 | 398.0 kB | 508.6 kB | 110.5 kB | about 80 kB |
| All JS and CSS, gzip -9 | 453.7 kB | 575.6 kB | 121.8 kB | about 100 kB |
| The merge view (on demand) | - | 10.4 kB | 10.4 kB | about 20 kB |
| Files of the build | 437 | 439 | 2 | |

The total is 22 % over the estimate, the start-up part 38 %: outside the 20 % rule, so explained.
It is the second round's increase (3.3) plus 1.7 kB of the third and fourth rounds' repairs; the excess is our
own code (the dock with the locked Tab order about 15 kB, the history store, its retries and dialogs
about 17 kB), not a dependency: `flexlayout-react` takes about 60 kB, the estimate's 55 kB for
FlexLayout and our layout code together, and no dependency was added beyond P2.4's two.

### 5.6 The menus

`node tools/diff-menus.mjs --main dccb717`: 330 of 330 comparisons passed (the three modes, the
three key maps, browser and desktop, with and without open documents, and the native Mac menu):
main's items first and unchanged, the stage's after a separator (the Editor's Window menu after
the document list), and no entry of `keys.ts` added, changed or removed. The additions are those
of 3.2.

### 5.7 What this pass changed

- **CI (O-5).** `ci.yml`: the step `Guide texts (N10)` (`npm run check:guide`) in the job `check`
  after `Documents (DOC1)`; `tests/lint/ci-workflow.test.ts` leaves the tools that start no browser
  out of the browser-check table and checks that their root script and step exist
  (`docs/requests/N10-check-guide.md`, done). Already in place from the earlier rounds and checked
  again: the job `history-model` (`docs/requests/N3-model-test-ci.md`), the stage's seven check
  scripts in `browser-checks` on the three systems, and `tests/e2e/plus` inside the job `e2e` (its
  `npm run test:e2e` runs all of `tests/e2e`). actionlint 1.7.12: no finding.
- **The stability shards.** Measured here, `tests/e2e/plus` adds 11.8 % to WebKit's test time
  (139 s on 1,176 s) and 10.2 % to Chromium's (62 s on 607 s). Main's longest shards in run
  45034021673 took 50.6 min (WebKit) and 60.5 min (Chromium), so about 57 and 67 min are expected:
  under 60 % of the shards' 120 min, so the six shards stay (and `item-10-stability.mjs`, which
  reads the shard count from the logs, needs no change). The estimate is written beside the job.
- **`check-dock.mjs`:** the one WebKit allowance of errata N1 26 is removed, since D-i made the walk
  equal main's; the full run passed 642 of 642 without it.
- **The release-candidate check (I3's files, unchanged since `main`):** `rc.mjs` passed a bare
  `--config vitest.config.ts` to `npx`, which runs in the nearest folder with a `package.json`
  (`tests/`), so the unit run of `tests/conformance/examples` failed to start and item 5 found its
  entry absent (a defect on `main` too); it now passes the config's full path.
  `item-12-manual-coverage.mjs` knows the sixteenth item of 6.8 (the PDF viewer, errata N10 2).
- **Texts (O-2, step 3).** `docs/differences/FS1.md` says "Use the Export button of the Files panel
  to take it out again" (`docs/DIFFERENCES.md` and the help page made again); the quote in
  `docs/ARCHITECTURE.md` 3.8.1 is the code's text. `npm run check:guide`: 146 of 146. A search of
  every message of `app/src` that names a control, checked against the production build by a probe
  (`names-probe.mjs`, 12 of 12 in both browsers): the Files panel's buttons are `New Folder...`,
  `Import...`, `Export all of My Programs as My Programs.zip`, `Delete` and `Trash...`; Options has
  `Port Additions...`; File has `Earlier Versions...` and `Trash...`. Every text of the stage names
  them so; the storage notice's `Export...` is its own button. One text of main names another
  (section 4, FS2).
- **Request status lines:** `N10-check-guide.md` and `N1-files-row-in-view.md` say done.

### 5.8 What P6.4 still needs, and where it is shown

- On GitHub after the push of this branch: every suite on Ubuntu and macOS in both browsers, the
  desktop tests on the macOS runner, the job `history-model` (read its time against P5 N3's 5
  minutes), and a manual run with `e2e_stability` (twenty repetitions, six shards).
- For a person: the manual list's B15 (E1 to E5) and V10, V11 on a real Mac.
- Void by the owner's decision: version 1.1.0 and the tag `v1.1.0`; none is set.

## 6. New packages and licences

`node tools/lockfile-licences.mjs --base dccb717` (the last commit of `main` in `plus`; the
integration pass; the gate's first round gave the same against 4bd5f68):

```
package-lock.json against dccb717:
added    node_modules/@codemirror/merge  6.12.3  MIT
added    node_modules/flexlayout-react  0.11.1  MIT
2 packages added or changed, 0 not MIT, BSD or ISC, 0 with an install script
```

No other entry of `package-lock.json` differs from `main`'s. Neither package is Apache-2.0 or
GPL-incompatible, and neither has an install script (P2.4, P6.4). Pinned versions and why:
`docs/requests/N0.md` section 1.
