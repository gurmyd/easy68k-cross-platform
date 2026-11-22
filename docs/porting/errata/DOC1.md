# Errata of DOC1 (Documentation and release notes)

What DOC1 found while writing `README.md`, `CHANGELOG.md`, `docs/USER-GUIDE.md`,
`docs/DIFFERENCES.md`, `docs/CONTRIBUTING.md` and `docs/MANUAL-TEST-MAC.md`, and while merging the
errata into the documents (ARCHITECTURE.md 9.6, the DOC1 entry; section 8, "Corrections to the
specs"). No entry concerns `app/src/contracts/`, so there is no **Contract** section.

## 1. Files outside DOC1's paths that the package's own tasks change

- **`docs/ARCHITECTURE.md`** belongs to the architect (section 8), and the specs under `docs/porting/`
  to their authors. Section 8 ("DOC1 merges the errata into the specs at the end of each wave") and
  the task give the merge to DOC1, so DOC1 edited them, each change marked "erratum <ID> <n>".
- **`docs/porting/errata/<ID>.md`** of all 38 packages that had written one before wave three ended
  (every file of the folder but this one): one status line under the title (`Merge status
  (DOC1, ...)`) gives the disposition of every entry, as the task asks ("each erratum marked as
  merged"). Nothing else in those files was changed.
- **`app/public/help/Port/differences.htm`** belongs to H1. Its erratum 5 asks whoever writes
  `docs/DIFFERENCES.md` to run `npm run import:help` and commit the result. DOC1 ran the import into
  `build/DOC1/help` (not over `app/public/help`, which other engineers' servers were reading) and
  copied the one file that changed; the other 241 files of the import were byte-identical to the
  committed ones.

## 2. The release notes template is DV3's code

- Says: 9.6, "the Gatekeeper instructions of section 11 are in the README and in the release notes
  template"; section 8 gives DOC1 `README.md` and `CHANGELOG.md`.
- Is: the release notes are written by `desktop/scripts/release.mjs` (`releaseNotes()`, owner DV3),
  which copies the part of `docs/differences/DV3.md` between `<!-- first-start:begin -->` and
  `<!-- first-start:end -->`. That part already carries the steps of section 11 for a person who
  has never seen the warning.
- Does: the README carries the same section between the same marks, word for word, with a short
  explanation of the warning before it, and DOC1's test (`check-docs.test.mjs`, see the request
  `docs/requests/DOC1-docs-check.md`) fails when the two differ and checks that the generated notes
  contain the steps. A change to the steps is made in `docs/differences/DV3.md` and copied to the
  README.

## 3. "A clean macOS runner": which CI steps stand for it, and what they do not prove

- Says: 9.6 acceptance, "a new contributor can build and test from the README alone on the three
  operating systems (checked in a clean container and on a clean macOS runner)".
- Is: no CI job follows the README on macOS from start to end. `engines.yml` builds the engines on
  Ubuntu only; every macOS job downloads that build (`engine-dist`). So on GitHub's clean macOS
  runners these README steps are run, in `ci.yml`:
  - job `unit (macos-latest)`: steps "Install dependencies" (`npm ci`), "Assembler engine tests",
    "Simulator engine tests", "Unit tests" (`npm test`), "Integration scenarios under Node (I1)";
  - job `conformance (macos-latest)`: step "Conformance tests against the committed goldens"
    (`npm run test:conformance`);
  - jobs `e2e (macos-latest, chromium)` and `e2e (macos-latest, webkit)`: steps "Install chromium"
    / "Install webkit" (`npx playwright install --with-deps <browser>`, only when the cache misses),
    "Production build" (`npm run build`), "End-to-end tests" (`npm run test:e2e`);
  - job `desktop-dev (macos-15)`: `npm ci`, `npm run build`, `npm run desktop:test -- dev`.
  Not run on macOS by any job: `git clone` as written (the checkout action is used),
  `npm run setup:emsdk`, `npm run build:engines`, `npm run typecheck`, `npm run lint` (these two run
  on Ubuntu only, in the job `check`). The same holds for Windows (`unit (windows-latest)`, `e2e
  (windows-latest, ...)`).
- Request: `docs/requests/DOC1-docs-check.md` item 3 asks for a job that runs the README's commands
  literally on `macos-latest` and `windows-latest`.

## 4. Two clean-container findings for other packages

Following the README in a clean `node:24` container (Debian 12, 6 CPUs; section 6 of the result):

- **As root**, `npm test` fails two tests of DV2: `src/fs/disk-backend.test.ts > DiskBackend >
  reports a read-only file` ("promise resolved "undefined" instead of rejecting") and
  `src/fs/sync/disk.test.ts > DiskSyncFiles > reports read-only files and cannot write them`
  ("expected true to be false"). Root may write a read-only file. As an ordinary user with `sudo`
  (the second run) both pass: 193 of 194 test files passed, one skipped. For DV2: skip these two
  when `process.getuid?.() === 0`, or say so in the test.
- **As root**, `npm run test:e2e` failed one test in WebKit:
  `tests/e2e/editor/editing.spec.ts:212` "Undo reverses typing, a paste and a comment ..." with
  `Expected: "base PASTED"`, `Received: " PASTEDbase"` (the paste landed before the text after
  Save As), on its retry too; 332 passed, 1 skipped. Owner of the test: X1; of the behaviour: E2.
  The second run, as an ordinary user with `sudo`, failed the same test in **Chromium** (same
  `Received: " PASTEDbase"`), so it is not a root effect: after `app.saveAs()` the caret is at the
  start of the document in a fresh Debian 12 container, in either browser. It also failed
  `tests/e2e/app/a11y.spec.ts:185` in WebKit on its 120 s time limit, while this PC was running the
  whole unit suite at the same time (load, probably). 331 passed, 1 skipped, 2 failed (19.4 min).

## 5. Gaps the documents had to describe as they are

- **R-10** (10.1) recommends a one-time notice in Safari about the seven-day deletion and the Dock
  app's separate storage, with `Export everything...`. No such notice exists in
  `app/src/features/files` today (no text mentions Safari, the Dock or seven days). The user guide
  therefore explains both facts itself, and the manual list checks them (W2, W4). For I3.
- **Serial and network tasks in the Mac app** (1.1) are DV4's work of this wave. The README, the user
  guide and the changelog say "being completed" / "meant to offer" until DV4 is done.
- **`npm run fetch:engines`** needs a published release with `engine-dist.zip`; none exists, so the
  README builds the engines with Emscripten and CONTRIBUTING says why.

## 6. Merge of the errata into the documents: done for every entry, with a few items left open

**First round** (the package's first delivery): about 75 entries of 22 files, those with a proposed
text or a plain correction, merged into `ARCHITECTURE.md` and four specs. The verifier rightly found
that this was not the merge the task asks for.

**Repair round 1.** Every entry of all 38 errata files (every file of `docs/porting/errata/` but this
one; the wave-three packages DV4, DV5 and X2 work on branches of their own and have no file here
yet) was read, and each one has a disposition in the status line at the top of its file:

- **Merged** (about 490 entries): the document now says what the erratum found, at the section the
  erratum names. Where a sentence of a document was wrong, the sentence itself was corrected and
  marked "(corrected, erratum <ID> <n>)" or "(erratum <ID> <n>)" (for example ARCHITECTURE.md 1.3.8,
  now the rows of easybin.md 21.4; 2.7's dialog ids; 2.11; 3.4 rules 10 and 13; the task 95 rule of
  3.5.1; 3.8.4's write buffering and reads; 4.8's Close row; sim-ui 12.2's `Count = 00`). Where the
  document was silent or a statement needed the details the code settled, a paragraph
  `> **Corrected (erratum <ID> <n>).** ...` was added at the end of that section's own text.
  Documents changed: `ARCHITECTURE.md` (150 such paragraphs), `editor-ui.md` (25), `sim-ui.md` (13),
  `trap15-tasks-60-up.md` (8), `trap15-tasks-0-59.md` (5), `assembler.md` (4), `hardware.md` (2),
  `official-oracle.md` (2), `ground-truth.md` (1), `sim-core.md` (1). Notes 1.4 and the list 1.5 were
  not changed, so `docs/DIFFERENCES.md` and the help page built from it are unchanged.
- **Nothing to merge** (about 190 entries): records of tests, browser checks and gate rounds; notes
  addressed to other packages; requests; contract entries, for which `app/src/contracts/` is the
  authority (the head of ARCHITECTURE.md section 3 says so); and entries that confirm a document as
  written. Each such entry is named in its file's status line with the reason.
- **Open** (listed below): items an erratum leaves to a decision or a measurement that has not been
  made. DOC1 merged the facts and did not choose.

The tools of this round are in `build/DOC1/merge/` on the machine where DOC1 ran (`notes.mjs` adds
the paragraphs, idempotently; `apply.mjs` makes exact replacements; `ledger.json` and `status.mjs`
write the status lines). They are scratch tools, not part of the repository.

### Where two errata disagree (for the orchestrator)

None of these needed DOC1 to choose: in each case a later entry or the code settles it, and the
document now says what the code does. They are listed so that the owners can bring their own
errata up to date.

1. **Task 58, Save mode: SH6 E2 against W4 15.** SH6 E2 says the engine (`shim/simio.cpp`)
   reproduces the two defects of the Save branch and asks the document to say which holds; W4 15
   (gate I2) says W4 removed them, as ARCHITECTURE.md 3.8.4 always said, with a test. The document
   keeps "not reproduced" and names both entries. **For SH6:** E2 describes the state before W4's
   repair.
2. **The repaint counters: U2 C2 against W1 11 and SH8 24, 33.** U2 C2 says `AppState.sim` has only
   `viewRevision`; since gate I1 the contract has the optional `AppState.sim.repaint` with a counter
   per panel. 4.6 says so and calls U2 C2 superseded. **For U2:** C2 is stale.
3. **Timer periods: SH7 6 against SH8 26.** SH7 6 first said a Windows timer keeps its period (20
   ticks in 10 s); SH8 measured 19 on Windows 11, and SH7 withdrew its statement in the same entry.
   4.5.3 is unchanged. Nothing to do.
4. **Task 53 with a wrapping count: SH6 E1 against T3 F4 and W4 14.** SH6 E1 first expected D0.W = 0
   and D2 = 10 from trap15-a's text; T3 measured D2 unchanged and nothing read, and SH6 E1 itself
   records that the measurement was adopted. trap15-a task 53 now says so. Nothing to do.
5. **`Count = 00`: sim-ui 12.2 and 18 against sim-core 7.3** (two specs, reported by U3 1). The
   source agrees with sim-core; sim-ui was corrected.

### Open items (decisions or measurements nobody has made)

- **P1 5:** whether the threshold of 6.9 item 9 (200 million instructions in 10 s at `Maximum`) or
  the share of a frame at `Maximum` (4.1) changes; the architect's decision (numbers in
  `docs/porting/speed.md`).
- **P1 9:** P1's proposal to SH8 to bound a sub-slice by the remaining frame budget (4.2).
- **W2 7:** SR Backspace: sim-ui 4.4 ("types a `0` at the caret") against what the VCL may do
  (clear the position before the caret); for T3 to measure under Wine. sim-ui 4.4 names it.
- **T3 F7 (with SH6's question 10):** reads and writes without a seek between them behave
  differently in the Borland run-time; measured under Wine, unconfirmed until it runs on Windows.
  3.8.4 names it as a known difference.
- **T3 F6 (trap15-b V8):** drawing modes 18-23; Wine and the binary's table disagree; for the run on
  Windows. trap15-b 5.4 names it.
- **T2 1.3:** outline atlases at 48 and 72 pt are not stored (the provider resamples the 36 pt
  atlas); T2 left it to gate I1 and SH3 26 says its reviewer proposed to accept it. 3.5.1 now says
  what is done; whether the sentence "at 24, 36, 48, 72 pt" itself changes is the architect's.
- **DV1 6 / 12, FS2 13:** the installed web app's file handlers wait for a contract member
  (`docs/requests/DV1-launch-files.md`). 5.7 says so.
- **SH5 section 7, items 5 and 6:** a manual check of a loop after SIMHALT and of task 77 on a
  looping slot needs a test program that nobody has written and tried; the manual list says they
  are not in it.

## 7. Round before gate I3 (one engineer for wave three and the desktop app)

- **Review of DOC1:** the coverage table of `docs/MANUAL-TEST-MAC.md` named B8 (the long session)
  for the browser shortcut table on Windows, which is B10: corrected, and a test was added to the
  docs check (`tools/check-docs.test.mjs`, "every section the coverage table names is about the
  topic of its row"; it fails when B8 is put back). A second new test holds the manual list's copy
  of the first-start steps to DV3's text. The configuration engineer adopted the scripts
  (`check:docs` in the job `check`; request `docs/requests/DOC1-docs-check.md`).
- **`docs/DIFFERENCES.md`** rebuilt from the fragments: W1's (case-sensitive Mac disks) and DV4's
  are in it; the stale U4 row was already gone from U4's fragment. The introduction mentions the
  case-sensitive disks; a hand-written **part 5, "Known limitations"**, lists what the project
  knows and has not repaired or proven: nobody has used the port on a real Mac; Firefox, ChromeOS
  and phones are not tested; a folder with a large `.git` can crowd a program's files out of the
  2,000-file limit in the web version (ARCHITECTURE-PLUS.md P3.3.10, package N8); Safari's storage
  notice (R-10) is missing; the `Maximum` speed and the 120 Hz frame figures of 6.9 item 9; no
  screen reader tried; no real serial adapter. The six accessibility findings are not listed there
  (their owners repair them in this round; the engineer who closes the round rebuilds the file).
  The help page `Port/differences.htm` (H1's path) must be renewed with `npm run import:help`.
- **`docs/MANUAL-TEST-MAC.md`:** part A (twenty minutes) is the core; parts B and C are marked
  optional. Every "not verified" item of the last round that a person can settle is in it: the
  Gatekeeper first-start steps themselves (copied from DV3's fragment, B3), the Serial Ports dialog
  and a real USB serial adapter (D9, N1), a TCP connection that never answers (N4), a halt and
  `Current Log Stopped.` announced, the keyboard-only walk-through in real Safari with its Tab
  setting, the Output panel's focus frame (V6-V9), NVDA (X4), the README's build steps on a Mac
  (B12), and on Windows the host name `255.255.255.255` (C4), the pending TCP connection (C5),
  whole-program pictures against the original (C6) and Backspace in the SR field (C7, item W2 7
  above). The coverage table names each source.
- **README:** Firefox is not tested; the tests run in Playwright's engines, not in Safari itself;
  the known limitations and `docs/integration/rc.md` are linked. **USER-GUIDE:** no claim about
  browser versions or ChromeOS; the Mac app's serial and network tasks and Options > Serial
  Ports...; the default speed is an estimate (P1's note); what `Not available to the program` means.
- **ARCHITECTURE.md:** 1.5 has the row `Serial Ports...` (`sim.options.serialPorts`; item 3 of
  `docs/requests/DV4-serial-ports-command.md`, which names 1.3 but means the added commands); 5.9
  names the flush at task 55 (erratum DV5 2); the note under 4.7.1 says what "changed" includes
  (erratum SH8 38). 4.8's Close row and 7.4's `e2e-stability` line were already merged.
- **Open items of entry 6:** P1 9 is taken up by SH8 (errata SH8.md entry 40). W2 7 cannot be
  measured with the Wine oracle, whose recipes do not drive the simulator's window; it is check C7
  of the manual list now. The others stand.
