# Release candidate

This file belongs to I3 (ARCHITECTURE.md 8, 9.6), except the section "Q1 - accessibility and
keyboard audit" at the end, which is Q1's (9.6 Q1: "defect entries in `docs/integration/rc.md`").

It records the check of the twelve conditions of `docs/ARCHITECTURE.md` 6.9, under which version
1.0.0 may be tagged, with the evidence for each. The correction notes printed under that list
(errata X1 8, P1 1, P1 13, T1 26, T3 14 and U2 S6) are part of the items, and so are the notes
under 6.5.3 and 6.8. **No version has been tagged and no release exists.** Not all conditions hold:
see the table and "Before version 1.0.0 may be tagged".

- **Date of the check**: 22 November 2026.
- **Commit**: `b247e17` on `main` ("Documents against the evidence, safeguards of the Help frame, a
  run key during a load"). The local runs were made on its working tree with this step's changes
  to `tests/integration/rc` and the repairs listed under "Repaired in this step", while other
  engineers' repairs of the failures named under item 6 were in the tree and not yet committed.
- **Machine for the local runs**: Windows 11, Node 24, the pinned Playwright Chromium and WebKit,
  `engine/dist` as built on this PC.
- **CI runs read** (repository `gurmyd/easy68k-cross-platform`, all of commit `b247e17`, all
  finished when this was written):
  - `ci.yml` run 45034018006, the push to `main`: 31 of 36 jobs passed, 3 failed, 2 skipped (the
    stability job, which runs only by hand, and the readme job);
  - `ci.yml` run 45034021673, by hand (the six shards of the twenty-repetition job, the performance
    jobs with their thresholds, the readme jobs): 41 of 42 jobs passed, 1 failed;
  - `release.yml` run 45034019734, by hand without a draft release (the packaged macOS app on
    Apple Silicon and Intel): 4 of 7 passed, `mac-arm64` failed, `checksums` and `publish (draft)`
    skipped;
  - `oracle.yml` run 45034017858, by hand (the Wine reference on GitHub): 2 of 4 passed, `wine` and
    `propose the regenerated goldens` failed.
- **How to run it again**: `npm run check:rc`, and with the CI logs
  `node tests/integration/rc/fetch-ci.mjs build/rc-logs` then `npm run check:rc -- --logs
  build/rc-logs --browsers` (`tests/integration/rc/README.md` says what proves each item and how to
  run each part alone). On this check it printed every verdict of the table below and exited 1
  (items 2 and 6 do not hold).

## The twelve items

| # | What it asks | Verdict | The evidence in one line |
|---|---|---|---|
| 1 | Assembler: every file of the four sets and a fixed 30-file subset with each option, byte-identical with the Wine goldens; every exception in DIFFERENCES.md | Holds | 10/10, 41/42, 121/124 and 134/134 default runs with an official result equal (4 runs without one, each named with its cause); 240 of 240 subset runs equal; 10 of 10 exceptions named; the `site` set re-run on GitHub "every run equals the manifest" |
| 2 | Simulator: at least 150 self-reporting programs, coverage, 20 logs of 100,000 instructions, checklists | **Does not hold** | 178 programs, 172 equal, 2 accepted, 2 unconfirmed, **2 against the item (a51, a52)**; 31 logs with 126,427 identical instructions; 86 of 87 table entries plus LINE_1010 as DC.W; every non-interactive task; checklists 60/60, 37/37, 16/16 |
| 3 | Drawing: the thresholds of 6.5 | Holds | 26,826 of 26,826 primitive cases; ellipses 8,192/8,192, 3,000/3,000; text 16,902 of 16,902 required cases as decided under 6.5.3; check:text 78/78 and check:examples 309/309 in CI |
| 4 | Twins: zero differences | Holds | windows-oracles of run 45034018006: 935 runs per assembler twin, 1,114 of 1,114 simulator twin runs, "No unexpected differences." |
| 5 | Parity: every row of 1.3 in the matrix; web-e2e, desktop-e2e and unit entries pass; manual entries signed off | Holds except the part a person must do | 179 of 179 rows; 325 of 325 web-e2e entries in each browser over the six e2e jobs; 17 of 17 desktop-e2e; **15 manual entries (8 items) not signed off** |
| 6 | Platforms: the CI matrix of 7.4 green; the packaged-app checks on arm64 and Intel | **Does not hold** | Push run: `e2e (macos-latest, chromium)` failed; release run: check 7 failed on arm64; oracle run: `wine` and `propose` failed; three more red jobs beyond 7.4 |
| 7 | Offline: the offline test passes; the app installs in Chromium | Holds except the part a person must do | offline.spec.ts 4 of 4 in all six e2e jobs; check:pwa 114/114 on three systems; the offline walk 27/27 here; installing from a real Chrome not done by a person |
| 8 | Accessibility: no serious automated finding; the manual list signed off | Holds except the part a person must do | 324 of 324 axe checks in each of the three audit jobs, no serious or critical finding; a11y.spec.ts 16/16 in all six e2e jobs; **the manual list not signed off** (one keyboard-walk check red on macOS: item 6) |
| 9 | Performance in Chromium on ubuntu-latest | Holds | Run 45034021673, `perf (ubuntu-latest, chromium)`: 7 of 7 verdicts; TaskDuration 1.11 s; p95 17.5 ms and 9.1 ms; Maximum 143,009,668 (needs 139,480,070); assembly 258 and 270 ms |
| 10 | Stability: the e2e suites 20 times in a row in each browser | Holds | Run 45034021673, six shards: Chromium 6,140 of 6,140 passed, WebKit 6,080 passed and 60 skipped of 6,140, 0 failed, 0 flaky, 307 tests per repetition as in the checkout |
| 11 | Open verification items: confirmed, or listed under "not yet confirmed" with the port's behaviour | Holds | 108 occurrences of UNVERIFIED accounted for; 25 items confirmed; 56 open items each a row of part 4 of DIFFERENCES.md with the port's behaviour; 0 in neither place |
| 12 | Manual: MANUAL-TEST-MAC.md completed for the release candidate | **Open: a person must do it** | The manual covers 6.8 (34 of 34 checks) and part A can be followed as written (71 of 71 browser checks); nobody has worked through it on a Mac, and part B3 needs a downloadable build, which does not exist |

## Item 1 - Assembler

**Holds.**

`node tests/integration/rc/item-01-asm-evidence.mjs` on this PC, after `npm run test:conformance`
with the `site` set fetched (`build/corpus-local`; reports written 22 November 2026 at 15:09 UTC,
after the commit), exit 0. Default options, per set (files / with a default run / with an official
result / identical / identical after masking undefined symbols / a known difference / no official
result):

| Set | Files | Default run | Official result | Identical | Masked | Known difference | No official result |
|---|---|---|---|---|---|---|---|
| official | 10 | 10 | 10 | 10 | 0 | 0 | 0 |
| github-mit | 42 | 42 | 41 | 24 | 17 | 0 | 1 (`GFX.X68`) |
| conformance | 124 | 124 | 121 | 112 | 6 | 3 | 3 (`macro-10`, `macro-13`, `s21`) |
| site | 134 | 134 | 134 | 95 | 39 | 0 | 0 |

- The fixed subset `tests/corpus/option-subset.json`: 30 files, each with one run per option
  switched alone: **240 of 240 runs equal** to the official result (byte for byte, or after masking
  undefined symbols), 0 not shown.
- Every run with an official result (800) was judged by the last conformance report; 0 not judged.
- Exceptions, all named in `docs/DIFFERENCES.md` (part T1) with their cause: the three accepted
  differences `dir-11`, `macro-09`, `stc-03`; the 143 runs equal only after masking undefined
  symbols; the six runs without an official result (`GFX.X68` default and expanded,
  `ALLGAMES4.1.X68` expanded, `macro-10` and `macro-13`, where the official program crashes with a
  stack overflow, and `s21`, where it stops at a message box). By the correction note of 6.9 (erratum
  T1 26) a run without an official result is an exception like any other.
- CI: `conformance (ubuntu-latest)` and `conformance (macos-latest)` of run 45034018006 both printed
  "320 runs compared with the official assembler: 293 identical, 23 identical after masking
  undefined symbols, 4 differ" (the four are the known differences) and "214 runs compared ...: 172
  identical, 42 identical after masking undefined symbols, 0 differ" (CI has no `site` set).
- The official assembler on GitHub, `oracle.yml` run 45034017858, job `wine`: the site set fetched
  (77 archives, 330 files) and run again through `EDIT68K.exe` under Wine: "267 runs with a result, 1
  without" and "**every run equals the manifest**"; the conformance tests there compared 801 runs:
  "320 ...: 293 identical, 23 identical after masking undefined symbols, 4 differ" and "481 ...: 361
  identical, 120 identical after masking undefined symbols, 0 differ". Its regeneration found "1 run
  differ from the manifest: `richedit/s03_long_line_4000.X68` (default): status: manifest failed,
  now ok": the official editor writes the same `.L68` and `.S68` there and then ends differently on
  different hosts (erratum T1 27); the port's output equals those files either way.
- What changed in the judge: a run without an official result fails only when DIFFERENCES.md does
  not name it; the option part is judged cell by cell on the 30 listed files; a run with an official
  result that the last report did not judge fails. Shown to fail: with a copy of DIFFERENCES.md
  without `macro-10`, it exits 1 ("1 of 10 exceptions are not named in docs/DIFFERENCES.md").

## Item 2 - Simulator

**Does not hold.** Two self-reporting programs, `trap15-a/a51-files-read-after-write` and
`trap15-a/a52-files-write-after-read`, give other results than the official simulator, and the
port is at fault (a read right after a write on one file, or a write right after a read, without a
seek between them; part 5 of `docs/DIFFERENCES.md`). A repair of the simulator engine exists on
the branch `gate3/stdio`; it can be merged only after its model has been measured in the official
program under Wine. That needs Docker on the development PC, which was hung and may be restarted
only by the project's owner; at the end of this check Docker answered again (Docker 29.5.3), so the
measurement can now be made. Everything else of the item holds.

`node tests/integration/rc/item-02-sim-evidence.mjs`, exit 1:

- Self-reporting programs: **178** (at least 150): exceptions 16, hardware 10, instructions 62,
  quirks 10, trap15-a 60, trap15-b 20; all 178 have an official result; **172** write the golden
  result file byte for byte.
- Sorted by the correction note of 6.9 item 2 (erratum T3 14), from
  `tests/conformance/sim/known-differences.json`: accepted (named in DIFFERENCES.md with their
  cause, not counted): `b06`, `b20` (and, outside the result files, the output log of `a55` and the
  execution log `l14`); unconfirmed (part 4 of DIFFERENCES.md, open items of item 11, not counted):
  `a53`, `b19`; **counted against the item: `a51`, `a52`**. 176 of 178 produce the golden or an
  accepted or unconfirmed difference.
- Execution logs: 32 runs with an official log, 126,432 instructions; **31 identical runs with
  126,427 instructions** after masking the date (at least 20 runs and 100,000 instructions); `l14`
  is the accepted one.
- sim-core 3.16: 86 of 87 table entries are executed as instructions by self-reporting programs;
  the 87th, `LINE_1010`, has no mnemonic and is executed as `DC.W` words by `e07` and `e16`
  (erratum T3 10).
- TRAP #15: 80 tasks; interactive by erratum T3 11 after its review (2, 4, 5, 10, 18, 58, 61, 100,
  101): 9; every other task, and every sub-task of task 32, has at least one self-reporting program.
- Checklists, `node tests/integration/rc/item-02-checklists.mjs`, exit 0: trap15-a §13 60 of 60,
  hardware §13 37 of 37, sim-ui §19 (affects program results) 16 of 16 proved; every proof is a
  program with an official result or a test found by its exact title. The mapping is T3's reviewed
  one (`build/T3/item-02-checklists-mapping-review.json`, errata T3 12 and 13): every reviewed entry
  is in the list with its verdict and proofs; Q19 is "proved" where the review left "partial",
  because its last clause (no live update at address 0) is a deliberate difference by the
  architect's decision (erratum U2 S6), as the review said it would be.
- That every program not listed equals its golden is the sim project of `npm run
  test:conformance`: in run 45034018006, `conformance (ubuntu-latest)` and `(macos-latest)` passed
  ("Test Files 40 passed | 1 skipped", "Tests 1011 passed | 410 skipped"); the unit jobs on three
  systems "Tests 4230 passed | 61 skipped".
- The goldens on GitHub (`oracle.yml` run 45034017858): the official `SIM68K.exe` was run again for
  every program; every result file came out as committed, and one other file changed
  (`a55-task0-negative-count-first.OutLog.txt`, the residue byte of an accepted difference). The job
  then failed only at "MISMATCHES.md is what this run writes", because it compared the committed
  report with the regenerated golden (item 6; erratum T1 27).
- What changed in the judges: the three classes of the correction note (an entry neither accepted
  nor unconfirmed counts against the item; an accepted one must be named in DIFFERENCES.md, an
  unconfirmed one in its part 4); the interactive tasks of erratum T3 11 after its review; T3's
  reviewed mapping of the checklists; a proof is found by its exact title (a template's `${...}`
  matches any text), not as a substring of the file. Shown to fail: with a copy of
  `known-differences.json` without `a53`'s `unconfirmed` field, `a53` is counted against the item
  (exit 1); with a checklist proof whose title lost its last six characters, "has no test titled
  exactly" (exit 1).

Open for a person: the Windows session (`docs/porting/windows-confirmation.md`, decision O-2) would
settle `a53` and `b19`; it needs the owner's permission. It is not required by item 2.

## Item 3 - Drawing

**Holds.**

`npx vitest run --config tests/integration/rc/item-03-vitest.config.ts --silent=false` on this PC:
6 of 6 tests passed.

- 6.5.1: lines 10,000/10,000, polylines 300/300, wide lines 2,000/2,000 (widths 2 to 14),
  wide-line ties 180/180, rectangles 10,000/10,000 (filled 5,008 and unfilled 4,992, widths 0 to 12),
  pens 1,736/1,736, flood fills 1,000/1,000, modes 480/480 and 238/238 (the 16 raster operations on
  each of pixel, line, rectangle, unfilled rectangle, ellipse, unfilled ellipse, flood fill), pixels
  500/500 (374 outside the surface), colours 49/49, clipping 343/343: **26,826 of 26,826** every pixel
  and pen equal. The 28 system colours follow the Windows theme and are not judged (erratum T2 17).
- 6.5.2: 8,192 of 8,192 small ellipses; 3,000 of 3,000 large ones (100 %; none beyond 0.5 % of its
  outline); wide pens 496 of 500 (reported; the baseline of `docs/porting/gdi-deviations.md`).
- 6.5.3, by the architect's decision under 6.5.3, on the port's own text screen and fonts:
  (1) raster faces off the text path 2,132/2,132; outline faces: cells and pens 198/198
  (fixed-pitch), 88/88 (the proportional substitute at sizes with an atlas), 336/336 and 72/72
  (zero-width bytes and `$7F`), 177/177 (italic), pens 75/75 (visible glyphs); (2) `text-path`
  10,459/10,459 and `text-control` without a fallback byte or `$80` 132/132, every pixel and pen;
  (3) the euro sign where its pen is the same in every history: `text-control` 21/21 and
  `text-path-euro` 986/986 (pen and every pixel outside the glyph), the 1,125 pinned pens 1,125/1,125;
  "@" in Courier 1,000/1,000 pinned pens; the fallback-font bytes: pens 85/85 where both captured
  Windows agree, every pixel 16/16 where they draw the same. **16,902 of 16,902 required cases.**
  Reported, not required: the 74 fallback-byte texts the two Windows draw differently,
  `text-path-formfeed` (pens 400 of 640) and `text-path-fallback` (0 of 480), the history-dependent
  euro texts (9 and 414, all equal to the committed capture), and the proportional substitute at
  sizes without an atlas (12 of 32; widths estimated, recorded in part SH3).
- 6.5.4: `tests/conformance/examples/golden/surfaces.json` holds the 10 official examples, 20
  conformance programs and 4 scenes.
- CI, run 45034018006: `check:text` "78 of 78 checks passed" and `check:examples` "309 of 309" in
  `browser-checks (<os>, simulator)` on ubuntu, windows and macOS; `check:surface` "28 of 28" in the
  interface jobs on ubuntu, windows and macOS; the unit jobs on three systems "ellipses: 8192 of
  8192", "ellipses-large: 3000 of 3000", "ellipses-wide: 496 of 500".
- The second Windows build (Windows Server 10.0.26100, job windows-oracles 137243681219, step "GDI
  capture, regenerate and compare (T2)"): "56 of 56 outputs equal the committed references (3 byte
  for byte; 24 apart from the other-font bytes)"; and, for the suites captured on one build only:
  "text-path-euro: 1400 of 1400 pens equal the committed references; of the 986 pinned in
  golden/text-path-euro-pens.json, 986 equal"; "text-path-fallback: 0 of 480 pens equal the
  committed references"; "text-path-formfeed: 400 of 640 pens equal the committed references". By
  erratum T2 29: the euro pens pinned as history-stable are the same on the second build, so they
  are required, and the port gives them (986/986 above); the pens of `text-path-fallback` and of
  `$0C` on the text path differ between the two builds, so the rule requires none of them and no
  defect follows.
- What changed in the judge: `text-path` counted under 6.5.3; `text-control`, `text-path-euro`
  and the pinned pens judged as item3d's report says; the listed differences reported with their
  numbers. Shown to fail: with one `text-path` pen moved by a pixel (`EASY68K_RC_SPOIL=text-path`),
  "10458 of 10459 equal - 1 DIFFER" and exit 1.

## Item 4 - Twins

**Holds.**

`node tests/integration/rc/item-04-twins.mjs --report <log of windows-oracles 137243681219>`, run
45034018006, exit 0: assembler 95 engine test runs and 420 programs x 2 option sets = 935 runs per
twin; patched `/O2` and `/Od` 935 same, unpatched 862 same and 73 that differ where a patch applies
(expected), 0 failed; the tracked programs today are 420, all in the report; simulator "557
scripts; transcripts identical: 1114 of 1114 twin runs"; the 68000 single-step baseline "124 files,
1000060 tests, 285116 deviate from the real 68000; matches tests/conformance/cpu/baseline.json";
"**No unexpected differences.**" The twins were not run on this PC (they take 11 to 25 minutes and
write T4's folder); the CI job is the evidence.

## Item 5 - Parity

**Holds, except the part a person must do: the 15 manual entries (8 items) are not signed off.**

- `node tests/integration/rc/item-05-parity.mjs`: 179 rows of 1.3 in the document, 179 matrix
  entries, per section 30/13/37/35/24/7/13/20 on both sides; 0 without an entry, 0 without a row,
  0 duplicated; every named file and test exists. Entries of 1.3 by kind: web-e2e 308, manual 15,
  desktop-e2e 13, unit 10, browser-check 4 (350); 1.5 adds 23.
- With the logs of run 45034018006: web-e2e **325 of 325** entries passed in Chromium and 325 of 325
  in WebKit, over the three e2e jobs of each browser (ubuntu Chromium 137243681278 "307 passed",
  ubuntu WebKit 137243681322 "3 skipped, 304 passed", windows Chromium 137243681315 "307 passed",
  windows WebKit 137243681280 "3 skipped, 304 passed", macOS Chromium 137243681307 "1 failed, 1
  skipped, 305 passed", macOS WebKit 137243681348 "4 skipped, 303 passed"; the one failure,
  `chords.spec.ts` "Editor mode: every chord of 2.9.3 is cancelled...", is named by no row, see
  item 6). desktop-e2e **17 of 17** (desktop-dev 137243681239 and the two release jobs). unit: the
  files the entries name passed in the unit and conformance jobs.
- The manual entries (8 items of 6.8: printing; paste, twice; the browser shortcut table; full
  screen; the keyboard of a real MacBook; sound; serial and network) each open a row of the
  manual's table "Which check covers which item of the plan", whose checks exist. **No person has
  signed any of them off; no person has tried the application on a Mac.**
- What changed in the judge: a result line whose duration is in minutes ("(1.2m)") is read. Shown
  to fail: a copy of the ubuntu Chromium log in which one named test
  (`documents.spec.ts` "File > New X68 Source File opens untitled2.x68 with the template, not
  modified") has a red cross: "324 of 325", exit 1.

## Item 6 - Platforms

**Does not hold.** `node tests/integration/rc/item-06-platforms.mjs --run ci=<push> --run
ci=<manual> --run release=<release> --run oracle=<oracle> --mac arm64=<log> --mac x64=<log>`: 7
problems (the jobs of 7.4 below; the failed `browser-checks` jobs are beyond 7.4 and printed as
notes).

- The workflows against 7.4, alone: 0 problems (every job and trigger of 7.4 is there, every action
  pinned by commit, `contents: read` by default). The job `propose` of `oracle.yml` opens no pull
  request itself since erratum T1 27 (the repository does not let GitHub Actions create one); it
  pushes the branch and names the address at which a person opens it, which the judge accepts
  (erratum I3 2). Shown to fail on a copy of the workflows with the e2e, unit and windows-oracles
  jobs on another runner: 4 problems, exit 1.
- `ci.yml` run 45034018006 (push): every job of 7.4 passed except **`e2e (macos-latest,
  chromium)`** (137243681307): `tests/e2e/app/chords.spec.ts:85` "Editor mode: every chord of 2.9.3
  is cancelled, in the editor and in the Files panel" received `["Ctrl+F ([])"]` (no key event was
  recorded for that chord with the focus on the Files tree); it passed on ubuntu and windows in this
  run, and 20 times in Chromium on ubuntu in the stability shards (item 10). Beyond 7.4:
  **`browser-checks (windows-latest, integration)`** (137243681460): `check:wave2` passed every
  scenario and then did not exit; "The action 'Integration scenario in the browser (I2)' has timed
  out after 15 minutes"; **`browser-checks (macos-latest, accessibility)`** (137243681484): "629 of
  630 checks passed, 1 failed": "chromium/windows walk-run: the typed answer reaches the program (D1
  = 42) and it goes on running - D1 = 42, phase waitInput".
- `ci.yml` run 45034021673 (by hand): the six stability shards, the six perf jobs and both readme
  jobs passed. **`browser-checks (windows-latest, interface)`** (137252708316) failed in
  `check:files`: "124 of 125 checks passed, 1 failed": "webkit: the pass ran to the end - Error:
  webkit, a page killed in the middle of a write: did not finish within 360 s; last step: delay 2
  ms: reading the files in the new page". The same job passed in the push run; this is a failure of its own, not the hang of
  `check:wave2`.
- `release.yml` run 45034019734: version, engines, web and **mac-x64** passed ("59 passed (52.4s)",
  x86_64, macOS 15.7.9; checks 1 to 8 of 6.7). **mac-arm64 failed** (arm64, macOS 15.8.2: "1 failed,
  58 passed (41.9s)"): check 7 "Execute and Run: the message area and the surface hash equal the
  headless harness" read the Output panel's text mirror once, right after the canvas matched; the
  mirror follows at most twice a second (2.11), so the read came too early. `checksums` was skipped
  because a job it needs failed. Both jobs print, for information, that Apple's distribution check
  rejects the bundle ("Notary Ticket Missing"): the build is signed for testing only and not
  notarized, which part B3 of the manual covers.
- `oracle.yml` run 45034017858: engines and "single-step CPU suites (frozen baseline)" passed; the
  **wine** job failed at "MISMATCHES.md is what this run writes" (the job compared the committed
  report with goldens it had just regenerated; see items 1 and 2 for what it showed); **propose the
  regenerated goldens** failed: "GitHub Actions is not permitted to create or approve pull requests"
  (erratum T1 27).
- `pages.yml` run 45034018111 (push of b247e17): success.
- Repairs in the working tree, made by other engineers during this check, not reviewed here and not
  yet shown by a run: check 7 waits for the Output panel's text mirror
  (`tests/desktop/packaged/programs/checks.ts`, erratum DV5 14); the print feature returns the focus
  after printing (`app/src/features/print`, the suspected cause of the chord not seen); every
  `check-*.mjs` script closes its browsers and servers in a guarded ending (the hang of
  `check:wave2`); the walk-run check waits for the phase that the next display frame publishes
  (`tests/a11y/lib/walk.mjs`, erratum SH8 49); the oracle workflow runs the conformance tests against
  the committed and against the regenerated goldens, and a person opens its pull request (erratum
  T1 27). `check:files` in WebKit on Windows has no repair yet.

## Item 7 - Offline

**Holds, except the part a person must do.**

- `tests/e2e/app/offline.spec.ts`: 4 of 4 in each of the six e2e jobs of run 45034018006 (the
  offline reload, Help offline, the manifest an installation needs, the file handlers).
- `check:pwa`: "114 of 114 checks passed" in the three `browser-checks (<os>, simulator)` jobs ("432
  files, 18056656 bytes precached" on ubuntu and macOS, 18058081 on Windows; all 432 served offline
  in Chromium and WebKit; Chromium parses the manifest without errors).
- This PC: `node tests/integration/rc/item-07-check-offline.mjs --browser all --dist <production
  build of the tree>`: "27 of 27 checks passed" (load, service worker, network off, reload, then
  check A1 of the manual offline in Chromium and WebKit: tutorial1.X68 assembles and prints its four
  lines; Help shows its text in WebKit).
- "Installs in Chromium" is shown by Chromium's own reading of the manifest (no installability
  error) and the worker that controls the page; automation cannot press Install. Open for a person:
  installing from a real Chrome (manual B13), Safari's offline reload and Add to Dock (B2).

## Item 8 - Accessibility

**Holds, except the part a person must do: the manual list is not signed off.**

- The lists of erratum X1 8: `node tests/integration/rc/item-08-a11y-lists.mjs`: `ALLOWED` in
  `tests/e2e/app/a11y.spec.ts` holds exactly its one entry (colour contrast of the original's
  syntax colours); `KNOWN` and `KNOWN_CHECKS` of the audit are empty; Q1-1 to Q1-6 are marked
  repaired below.
- With the three audit logs and the six e2e logs of run 45034018006: "60 of 60 checks passed". The
  automated scan: **324 of 324 axe checks** in each of `browser-checks (ubuntu-latest,
  accessibility)`, `(windows-latest, ...)` and `(macos-latest, ...)`, no serious or critical finding;
  the check of each of Q1-1 to Q1-6 passes in both browsers; `a11y.spec.ts` 16 passed, 0 failed in
  each of the six e2e jobs.
- One check of the audit beyond the scan failed on macOS: the keyboard walk named under item 6. It
  makes that job red, which item 6 counts; it is no finding of the scan (erratum I3 1). Shown to
  fail: a copy of the ubuntu audit log with one axe check marked FAIL: "323 of 324 axe checks ok",
  exit 1.
- Open for a person: `docs/MANUAL-TEST-MAC.md` B7 (VoiceOver, the keyboard alone in Safari with both
  Tab settings, the focus frame in both themes) and X4. Nobody has done them.

## Item 9 - Performance

**Holds.**

`node tests/integration/rc/item-09-perf-verdict.mjs <log of perf (ubuntu-latest, chromium)
137252708197> --require-ubuntu`, run 45034021673 (image ubuntu-26.04 as `ubuntu-latest`, `node
tests/perf/check-perf.mjs --browser chromium --judge auto`), exit 0, "7 of 7 verdicts hold":

- TaskDuration over 30 s of `spin.X68` at the default speed: 1.11 s with the 60 Hz frame source
  (needs < 4.5 s); 1.15 s with 120 Hz, printed.
- Frame intervals while `draw.X68` runs, 95th percentile: 17.5 ms at 60 Hz (needs < 20 ms), 9.1 ms
  at 120 Hz (needs < 12 ms).
- At `Maximum`, by the rule of the document with its correction note (erratum P1 13): the engine
  alone 32,818,840 instructions per second, so 164,094,200 in 5 s, 85 % of that 139,480,070;
  `engine.stepCount` in 10 s **143,009,668** with the 60 Hz frame source (needs at least 100,000,000
  and at least 139,480,070: holds, by 3.5 million); 161,540,473 with 120 Hz, printed. The figure as
  printed before the note (200 million) is missed by 56,990,332, for information only.
- Assembling the largest corpus file under Node: `GFX.X68` alone 258 ms, `MAIN.X68` with its
  includes 270 ms (needs < 1 s).

What changed in the judge: the corrected rule is the document's rule (`--rule document`, the
default); the figure of 200 million is printed for information only; the engine-alone figure is
read from "the engine alone, the best of N blocks of 5 s". Shown to fail: on a copy of the log with
a smaller Maximum count, and on one without the engine-alone line, "6 of 7 verdicts hold", exit 1.

## Item 10 - Stability

**Holds** on commit `b247e17`.

`node tests/integration/rc/item-10-stability.mjs --current <the six shard logs>`, run 45034021673,
exit 0, "problems: 0":

- Chromium, `--repeat-each=20`, shards 1 and 2 of 2 (137252708204, 137252708203): 6,140 tests run =
  307 x 20; **6,140 passed, 0 failed, 0 flaky**, 0 skipped.
- WebKit, shards 1 to 4 of 4 (137252708212, 137252708164, 137252708168, 137252708162): 6,140 tests
  run = 307 x 20; **6,080 passed, 0 failed, 0 flaky**, 60 skipped (3 tests that the suites skip in
  WebKit by design, 20 times each).
- The checkout lists 307 tests in each browser (e2e/app 47, e2e/editor 119, e2e/fixtures 13,
  e2e/sim 128), as many as the logs ran per repetition.

The item reads "on `main`": the commit that is tagged needs its own twenty-repetition run, because
the repairs named under item 6 change tests that these suites run.

## Item 11 - Open verification items

**Holds.**

`node tests/integration/rc/item-11-unverified.mjs`, exit 0: 108 occurrences of UNVERIFIED in
`docs/porting` and its errata, each accounted for (11 define the marker, 16 inside a spec's list,
65 carried by a list item, 13 errata about one, 2 settled where they stand, 1 superseded, 0 in no
list); 83 list items, of which 2 are decisions, **25 confirmed** (by the GDI capture or by the
official programs under Wine; none still a row of part 4) and **56 open, each a row of its own in
part 4 of `docs/DIFFERENCES.md`** ("Not yet confirmed against the original") whose third cell says
what the port does; 0 in neither place. The unconfirmed conformance programs `a53` and `b19` are
among the 56.

What changed in the judge: an open item needs a row of its own in part 4 with the port's chosen
behaviour (before, a mention of its list was enough); a confirmed item must have left part 4; the
ten statements the old table held as "in no list" now point to their rows; erratum E1 2 and
trap15-b V8 (b06) are confirmed. Shown to fail: with a copy of DIFFERENCES.md without the row of
`b19`, "open and in NEITHER place: 1" and exit 1.

Open for a person, not required by the item: the Windows session would confirm many of the 56.

## Item 12 - Manual

**Open: only a person can do it, and nobody has.** Part B3 cannot start, because no downloadable
build of the Mac app exists (no release and no pre-release).

- `node tests/integration/rc/item-12-manual-coverage.mjs`: 34 of 34: every bullet of 6.8 has a
  row in the table of checks, every check named there exists, the shortcut table has the 15 macOS
  and 10 Windows chords the page cancels, the texts the manual quotes are the application's (the
  storage notices, the paste message, the Caution box), the first-start text of B3 equals the
  README's.
- `node tests/integration/rc/item-12-check-part-a.mjs --browser all --dist <production build of
  the tree>` (macOS key map): "71 of 71 checks passed" in Chromium and WebKit. The walk follows the
  manual's wording: Help > Examples... shows the folder selected but closed; a click on its arrow
  opens it; F9, Execute, F9 give the four lines and Halted; the three test programs assemble and
  run, and after the Caution box the walk waits for the new program's listing before F9 (echo "You
  typed:   HELLO", keys "A down: FF" then "A down: 0", fonts "Sum: B4818F4C").
- Shown to fail: with a copy of the manual without the Caution box's text, "34 of 36 checks passed,
  2 failed".
- Open for a person: parts A and B on a real Mac for the release candidate, including the shortcut
  table in Safari, Chrome and Edge; B3 (Gatekeeper and first start on Apple Silicon and Intel) once
  a downloadable build exists; part C on real Windows only with the owner's permission (O-2).

## Before version 1.0.0 may be tagged

In order; each with who must act.

1. **Item 2: repair a51 and a52** (the file streams after a read right after a write, or a write
   right after a read). Docker answers again on the development PC; the engineer of the simulator
   engine's repair on the branch `gate3/stdio` (with SH6 for the file part) measures its model in
   the official program under Wine, merges the repair, removes the two entries from
   `known-differences.json` and part 5 of DIFFERENCES.md, and `item-02-sim-evidence.mjs` then exits
   0.
2. **Item 6: commit the repairs in the tree, then one more.** The orchestrator commits the repairs
   listed under item 6 (print focus for `chords.spec.ts:85`; the guarded ending of every
   `check-*.mjs` for `check:wave2` on Windows; walk-run and the phase `waitInput`; check 7 on arm64;
   the oracle workflow, erratum T1 27) once they are reviewed. Still open, for an engineer of FS1: `check:files` in WebKit on
   `windows-latest`, "a page killed in the middle of a write: did not finish within 360 s" (run
   45034021673, job 137252708316): find why the new page's read of the files did not finish, and
   make the pass end within its limit.
3. **Items 6, 9 and 10: the runs of the commit to be tagged.** The orchestrator, after the push of
   that commit: read the push run of `ci.yml` (every job green; in particular `e2e (macos-latest,
   chromium)`, `browser-checks (windows-latest, integration)`, `browser-checks (macos-latest,
   accessibility)`, `browser-checks (windows-latest, interface)`); start `ci.yml` by hand with
   `e2e_stability=true` (the six stability shards: `item-10-stability.mjs --current`, and `perf
   (ubuntu-latest, chromium)`: `item-09-perf-verdict.mjs <log> --require-ubuntu`, "7 of 7"); start
   `release.yml` by hand without a draft release (`mac-arm64` and `mac-x64` checks 1 to 8,
   `checksums`); start `oracle.yml` by hand (`wine` green; `propose` green, or a candidate that a
   person reviews). `node tests/integration/rc/fetch-ci.mjs` with those ids in `lib/runs.mjs` and
   `npm run check:rc -- --logs <folder>` judge them.
4. **Items 5, 8 and 12: a person with a Mac.** A published pre-release of the release-candidate
   commit is needed first (the owner's decision; `release.yml` with a draft release, then published
   by hand), so that part B3 can start. Then one person works through `docs/MANUAL-TEST-MAC.md`:
   parts A and B (with B7 for item 8, and the 15 manual entries of the parity matrix for item 5),
   fills in the report form, and signs off the release's copy of the manual list. Nobody has tried
   the application on a Mac yet.
5. **Optional, with the owner's permission (O-2):** the Windows session of
   `docs/porting/windows-confirmation.md` (settles `a53`, `b19` and other items of part 4). Not
   required by 6.9.

## Repaired in this step

- The judges of `tests/integration/rc`, written on commit 4bd5f68, brought up to the definition of
  done as it reads today (items 1, 2, 3, 5, 6, 8, 9, 11, 12; see each item), each shown to fail on
  a broken copy of its input; one entry point `npm run check:rc` (`rc.mjs`), which with `--logs`
  also judges items 4, 5, 6, 8, 9 and 10 from the CI logs that `fetch-ci.mjs` downloads;
  `tests/integration/rc/README.md`; `docs/porting/errata/I3.md`.
- `tests/integration/rc/item-02-checklists.json`: T3's reviewed mapping applied (with the
  hardware 21 colour check found by its exact title), every proof given its exact title, Q19 by the
  architect's decision U2 S6.
- `engine/asm/PATCHES.md` "Macro nesting": the original's outcome is known (a stack overflow under
  Wine, `macro-13`); it said UNVERIFIED.
- `docs/porting/errata/T3.md` entry 14 and the note under trap15-b 5.4: `a51` and `a52` count
  against item 2 (not unconfirmed); `b06` is settled and accepted.

## Q1 - accessibility and keyboard audit

Run on 21 November 2026 on the working tree after commit `d771d77`, Windows 11, Node 24, the
pinned Playwright Chromium and WebKit, `engine/dist` as built on this PC.

How to run it: `node tests/a11y/check-a11y.mjs` (options `--browser chromium|webkit|all`,
`--out <dir>`, `--only scan,structure,contrast,walk-edit,walk-run`); unit tests of its logic:
`npx vitest run --config tests/a11y/vitest.config.ts`. `docs/requests/Q1-a11y-ci.md` asks for
`check:a11y` in the job `browser-checks` and for the unit tests in `test:conformance`.

What it covers (sections 2.9 to 2.11):

- **scan**: axe-core 4 (WCAG 2.0 and 2.1, A and AA) over Editor mode (start-up document, with
  assembler messages, with the Help panel, with the waiting-for-input toast), Simulator mode (a
  program loaded, every tool panel, each tool tab in front, a program waiting for input, the layout
  below 1100 px) and EASyBIN mode, and every dialog the features register (24, read from the
  running application), each in the light and the dark theme, in Chromium (Windows key map) and
  WebKit (macOS key map). For each dialog also: the dialog role, `aria-modal` exactly when modal,
  a title that labels it, the focus inside, Tab and Shift+Tab kept inside, Escape closes it, the
  focus returns.
- **structure**: menu bar and every menu by keyboard (Down reaches every item, Right goes on,
  submenus, Escape), View > Memory by keyboard; toolbars (one tab stop, arrows, Home, End, names);
  panels as named regions; the tool tablist; a visible focus indicator of at least 2 px and 3:1
  on every tab stop of the three modes (both themes); the live regions of both message areas, the
  halt announcement; register labels; the Output canvas and its text mirror, whose update rate is
  measured (at most twice a second: shortest gap 501 to 528 ms); breakpoint dots by shape; reduced
  motion.
- **contrast**: the original's syntax colours, gutter dots and Hardware colours with their numbers
  (differences, `docs/differences/Q1.md`) and the dark theme's Auto palette (the port's own; all
  meet 4.5:1).
- **walk-edit** and **walk-run**: the two keyboard-only walk-throughs of the acceptance list, on
  the Windows and the macOS key map in both browsers (four runs each), with Safari's Tab rule on
  the macOS key map. Both workflows can be done with the keyboard alone.

No serious or critical axe finding in any mode or dialog, in either theme or browser. The defects
below come from the rules of 2.10 and 2.11 that axe does not judge. Q1-3 and Q1-5 are major
against 2.11; the others are minor. All six are defects of the application, in their owners'
paths, and stand until those owners repair them: a green `check:a11y` does NOT mean that the
application has no accessibility defect. Each is listed in
`tests/a11y/lib/findings.mjs` (`KNOWN_CHECKS`): the check prints it as "known" with its id instead
of failing, and says so when it passes again, so that the entry can then be removed.

All six were repaired by their owners in the round before gate I3 and closed on 21 November 2026
(each entry below says how and by which check): `KNOWN_CHECKS` is empty, and `check:a11y` fails if
any of them returns. The texts of the findings are kept as they were found.

### Q1-1 - New Folder: Cancel leaves the focus on the Files tree, not on the button (owner FS1)

- Rule: 2.10, "Dialog closes - the element that had the focus before it opened".
- Evidence: Editor mode, both themes, Chromium and WebKit. Focus on the Files panel's
  `New Folder...` button, press it, the dialog `files.name` (New Folder) opens; Escape (Cancel)
  closes it and the focus is on the tree `div[role=tree]` "Files", not on the button. Check
  "dialog files.name: the focus returns to where it was".
- Cause: `app/src/features/files/FilesPanel.tsx` `doNewFolder` calls `treeRef.current?.focus()`
  whether or not a folder was made (the same in `doRename`).
- Suggested repair: focus the tree only when a folder was made (`if (created)`), so that Cancel
  leaves the dialog service's own focus return in place. Minor.
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by FS1, `app/src/features/files/FilesPanel.tsx` focuses
  the tree only when a folder was made or an entry renamed (errata FS1.md entry 26). Proof: the
  check "dialog files.name: the focus returns to where it was" passes in Chromium and WebKit, both
  themes and both key maps (`node tests/a11y/check-a11y.mjs --browser all`), and its entry is gone
  from `KNOWN_CHECKS` in `tests/a11y/lib/findings.mjs`, so the check fails if the defect returns.

### Q1-2 - After Execute the focus is nowhere (owner E5)

- Rule: 2.10 (the focus is always somewhere useful; "Dialog closes - the element that had the
  focus before it opened"), 2.11 "Focus is always visible".
- Evidence: walk-run, all four runs (Chromium and WebKit, Windows and macOS key maps): Enter on
  `Execute` in the Assembler Status dialog loads the program and switches to Simulator mode, and
  `document.activeElement` is the page body. The element the dialog would return to is the editor,
  which is in the hidden Editor workspace. A keyboard user's next Tab starts from the top of the
  page; chords still work, so the workflow is not blocked. Check "after Execute the focus is in a
  panel of Simulator mode".
- Suggested repair: after the switch to Simulator mode on Execute (`features/assemble/index.ts`,
  the `'execute'` answer), move the focus to the Listing panel with `focusPanel(ctx, 'listing')`,
  as a stop in trace mode does (2.10 `host.focusMain()`). (W3 may prefer a general rule in the
  dialog host: when the element to return to is hidden, focus the active mode's first panel.)
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by E5, `features/assemble/index.ts` calls
  `focusPanel(ctx, 'listing')` after the program is opened on Execute (errata E5.md entry 14).
  Proof: the check "walk-run: after Execute the focus is in a panel of Simulator mode" passes in
  Chromium and WebKit, both themes and both key maps (`node tests/a11y/check-a11y.mjs --browser
  all`), and its entry is gone from `KNOWN_CHECKS` in `tests/a11y/lib/findings.mjs`, so the check
  fails if the defect returns.

### Q1-3 - The assembler's messages are not announced (owner E5)

- Rule: 2.11, "The message areas (editor and simulator) are `log` live regions with polite
  announcements".
- Evidence: Editor mode, both themes, both browsers: the Messages panel
  (`[data-e68-workspace=editor] [data-e68-panel=messages]`) contains only the `grid` "Assembler
  messages"; no element with `role=log` or `aria-live=polite`. Simulator mode's Messages panel has
  one (`e68-messages__announce`). Check "the Messages panel of Editor mode has a polite log region".
- Suggested repair: as U1 did in `features/sim-main/MessagesPanel.tsx`: a visually hidden
  `role="log" aria-live="polite"` element in `features/assemble/MessagesPanel.tsx` that receives
  the new messages of an assembly (or "No errors" style summary of the counts) when the list
  changes.
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by E5, a visually hidden `role=log aria-live=polite`
  region in `features/assemble/MessagesPanel.tsx`, its text from `features/assemble/announce.ts`
  (errata E5.md entry 14). Proof: the check "the Messages panel of Editor mode has a polite log
  region for the assembler's messages" passes in Chromium and WebKit, both themes and both key maps
  (`node tests/a11y/check-a11y.mjs --browser all`), and its entry is gone from `KNOWN_CHECKS` in
  `tests/a11y/lib/findings.mjs`, so the check fails if the defect returns.

### Q1-4 - A breakpoint (and the PC marker) is not told to a screen reader (owner U1)

- Rule: 2.11, "Nothing depends on colour alone: breakpoints also differ in shape"; WCAG 1.3.1.
- Evidence: Simulator mode, both themes, both browsers: after Space sets a breakpoint on the row
  of `ADD.L D0,D0`, the row (`role=option`) is read as "00001002 D080 4 ADD.L D0,D0"; the gutter
  is `aria-hidden`, and nothing (name, description, state) says that a breakpoint is set or which
  row holds the PC. Sighted users see filled and hollow dots (that part passes). Check "a row with
  a breakpoint says so to a screen reader".
- Suggested repair: in `features/sim-main/ListingPanel.tsx` `rowProps`, add an
  `aria-description` (or a visually hidden suffix referenced by `aria-describedby`) "breakpoint"
  on rows with `data-bp="on"` and "current instruction" on the PC row.
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by U1, rows with a breakpoint, the PC, or both point
  with `aria-describedby` to hidden notes beside the listbox in `features/sim-main/ListingPanel.tsx`
  (errata U1.md entry 10). Proof: the check "a row with a breakpoint says so to a screen reader"
  passes in Chromium and WebKit, both themes and both key maps (`node tests/a11y/check-a11y.mjs
  --browser all`), and its entry is gone from `KNOWN_CHECKS` in `tests/a11y/lib/findings.mjs`, so
  the check fails if the defect returns.

### Q1-5 - A halt is not announced (owner SH8)

- Rule: 2.11, "a halt and `Current Log Stopped.` are announced".
- Evidence: both themes, both browsers: a program that ends with `SIMHALT`, run with F9 until
  `snapshot.halted`; the live regions said only ".S68 file read successful" (the load) and
  nothing about the halt within 1.2 s. The status bar shows `Halted` (`features/run/StatusBar.tsx`)
  but the cell is not a live region. Check "a halt is announced by a live region".
  (`Current Log Stopped.` is an `alertdialog`, which screen readers announce by its role; it was not
  triggered by the audit.)
- Suggested repair: make the run-state cell of the simulator's status bar `role="status"` (polite),
  so that `Halted` (and `Stopped`, `Running`) are announced when they change.
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by SH8, the run-state cell of
  `features/run/StatusBar.tsx` is `role=status` (errata SH8.md entry 42). Proof: the check "a halt
  is announced by a live region" passes in Chromium and WebKit, both themes and both key maps (`node
  tests/a11y/check-a11y.mjs --browser all`), and its entry is gone from `KNOWN_CHECKS` in
  `tests/a11y/lib/findings.mjs`, so the check fails if the defect returns.

### Q1-6 - EASyBIN's "File Split" count has a label that is not exposed (owner B1)

- Rule: WCAG 4.1.2 / ARIA: `aria-label` on an element without a role is not announced. axe lists
  it as "needs review" (`aria-prohibited-attr`), not as a violation.
- Evidence: EASyBIN mode, both themes, both browsers:
  `span.e68-easybin__digits[aria-label="File Split: 1 file(s)"]`
  (`features/easybin/EasybinWorkspace.tsx`, line 263) has no role, so the label is dropped.
  Check "axe ... easybin: the File Split digits of EASyBIN have a name that is read" (since the
  round before gate I3; it was "axe ... easybin: no aria-label on an element whose role drops it",
  which every axe scan still runs over axe's `aria-prohibited-attr` review items for every other
  element, now without exception; only the scans of EASyBIN mode and of its About dialog, which is
  scanned over the workspace, find the digits).
- Suggested repair: `role="img"` (it is a drawn group of digits) or a visually hidden text with the
  same words. Minor.
- **Repaired** (closed on 21 November 2026, at the close-out of the round before gate I3; found on
  the working tree after commit `d771d77`): by B1, `span.e68-easybin__digits` has `role=img` in
  `features/easybin/EasybinWorkspace.tsx` (errata B1.md entry 21). Proof: the check "axe ...
  easybin: the File Split digits of EASyBIN have a name that is read" (EASyBIN mode and its About
  dialog) passes in Chromium and WebKit, both themes and both key maps (`node
  tests/a11y/check-a11y.mjs --browser all`), and its entry is gone from `KNOWN_CHECKS` in
  `tests/a11y/lib/findings.mjs`, so the check fails if the defect returns.

### Not defects, for the record

- The original's syntax colours (Color1 = light Auto: Macro/Other `#808000` 4.19:1, Structure
  Error `#FF0000` 3.99:1; Color2: Structure Error 3.99:1) and the Hardware panel's LED colours
  (`#400000` off on black 1.21:1, `#FF0000` on grey 1.01:1) are below WCAG AA. They follow from
  fidelity and are recorded in `docs/differences/Q1.md` with all the numbers; no change is asked.
- axe's other "needs review" items are empty containers before a program is loaded (the Listing,
  the simulator's Messages list, the editor's message grid without rows:
  `aria-required-children`) and the listing's text, whose background axe cannot decide because the
  gutter strip is a gradient behind the rows; the audit measures that text itself (part
  `contrast`): 17.73:1 / 12.48:1 (row / selected row, light), 14.01:1 / 7.49:1 (dark). None is a
  defect.
- The Output panel's keyboard field is visually hidden; its focus is shown by the panel (the check
  sees the pixels change; the ring's contrast is not measured there).

### Changes to the audit in the round before gate I3 (Q1)

- Review of Q1 (wave three): the pattern of Q1-6 matched every dropped label of an EASyBIN scan, so
  a new such element there would have been reported as "known". The digits now have a check of
  their own (`KNOWN_DROPPED_LABEL` and `partitionDroppedLabels` in `tests/a11y/lib/findings.mjs`,
  used by `lib/scan.mjs`); the general check "no aria-label on an element whose role drops it" is
  never excused. Unit tests in `findings.test.mjs`.
- At the start of that round the six entries above and their `KNOWN_CHECKS` lines were left in
  place: their owners were to repair them in the round, and the engineer who closed it was to
  remove each line once the check printed that it seemed repaired (done, next bullet).
- Close-out of that round (21 November 2026): the full audit printed that each of Q1-1 to Q1-6
  seems repaired in both browsers; their six `KNOWN_CHECKS` lines were removed and the entries
  above marked repaired. The check "the File Split digits of EASyBIN have a name that is read"
  stays, now without excuse.
