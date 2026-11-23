# Release candidate

This file belongs to I3 (ARCHITECTURE.md 8, 9.6), except the section "Q1 - accessibility and
keyboard audit" at the end, which is Q1's (9.6 Q1: "defect entries in `docs/integration/rc.md`").

It records the check of the twelve conditions of `docs/ARCHITECTURE.md` 6.9, under which version
1.0.0 may be tagged, with the evidence for each, on commit `9b2f25b`, whose application and engines
release 1.0.0 carries unchanged (the commit of the tag adds the version 1.0.0, the documents of
the release, the release notes with their test, and the judges of this check). The
correction notes printed under that list (errata X1 8, P1 1, P1 13, T1 26, T3 14, U2 S6 and I3 6)
are part of the items, and so are the notes under 6.5.3 and 6.8.

**By the owner's decisions of 22 November 2026 (erratum I3 6, the correction notes under 6.8, 6.9
and 7.5), release 1.0.0 contains the additions of `docs/ARCHITECTURE-PLUS.md` and is published
before a person has made the checks of 6.8.** Items 5, 7 and 8 therefore hold at most "except the
part a person must do", item 12 (which asks only for that part) is not done by a person, and the list of what a person must do is under "What a person must
still do". **No person has tried the application on a Mac, in real Safari, with a screen reader,
with a printer or with a serial adapter.**

- **Date of the check**: 22 and 23 November 2026.
- **Commit**: `9b2f25b` on `main` ("Merge the additions: movable panels, a Files panel with a safety
  net, a viewer"), pushed. The local runs were made on its working tree with this step's changes:
  the version 1.0.0, the documents of the release, and the judges of `tests/integration/rc` (listed
  under "Changed in this step"; none touches the application, an engine or a test of the product,
  except the test of the release notes in `tests/desktop/packaged/unit.spec.ts`).
- **Machine for the local runs**: Windows 11, Node 24, the pinned Playwright Chromium and WebKit,
  `engine/dist` as built on this PC.
- **CI runs read** (repository `gurmyd/easy68k-cross-platform`, all of commit `9b2f25b`):
  - `ci.yml` push run 45111564124: **cancelled by GitHub** while it was still waiting, when the
    manual run below was queued in the same concurrency group. The manual run runs every job of a
    push run as well, so it is read in its place (erratum I3 8);
  - `ci.yml` run 45111581771, by hand (the whole matrix of a push run, and in addition the six shards
    of the twenty-repetition job, the six performance jobs with their thresholds and the history
    model): **46 of 47 jobs passed, 0 failed**, 1 skipped (`readme`, which runs only when its input
    is ticked; beyond 7.4);
  - `release.yml` run 45111584448, by hand, build and test only, no draft release (the packaged
    macOS app on Apple Silicon and Intel): **6 of 7 passed**, `publish (draft)` skipped as on every
    run without a release;
  - `oracle.yml` run 45111588256, by hand (the Wine reference on GitHub): **3 of 4 passed**,
    `propose the regenerated goldens` skipped because nothing changed ("The official programs
    produced what the repository holds.");
  - `pages.yml` run 45111564156 (push of `9b2f25b`): success; the web version is that commit.
- **How to run it again**: `npm run check:rc`, and with the CI logs
  `node tests/integration/rc/fetch-ci.mjs build/rc-final` then `npm run check:rc -- --logs
  build/rc-final --browsers` (`tests/integration/rc/README.md` says what proves each item and how to
  run each part alone; `tests/integration/rc/lib/runs.mjs` holds the run and job ids above).
- **Result of `npm run check:rc -- --logs build/rc-final --browsers`** on this PC, with every log
  of the runs above (`fetch-ci.mjs`, 0 jobs not finished): every local and CI judge "holds", items 5, 7, 8
  and 12 with their parts open for a person (for item 12 that part is the whole requirement, and
  nobody has done it); "No item found not to hold here; the parts shown only in CI
  and the parts open for a person are listed above."; **exit 0**.

## The twelve items

| # | What it asks | Verdict | The evidence in one line |
|---|---|---|---|
| 1 | Assembler: every file of the four sets and a fixed 30-file subset with each option, byte-identical with the Wine goldens; every exception in DIFFERENCES.md | Holds | Default runs with an official result: official 10 of 10 equal, github-mit 41 of 41, conformance 118 of 121 equal and 3 accepted differences (`dir-11`, `macro-09`, `stc-03`), site 134 of 134 (4 files without an official result, each named with its cause); 240 of 240 subset runs equal; 801 runs judged: 654 identical, 143 after masking, 4 known differences; 10 of 10 exceptions named; the `site` set re-run on GitHub "every run equals the manifest" |
| 2 | Simulator: at least 150 self-reporting programs, coverage, 20 logs of 100,000 instructions, checklists | Holds | 188 self-reporting programs, 185 byte-identical as the comparison measured, 3 listed (accepted `b06`, `b20`; unconfirmed `b19`), 0 counted against; 31 of 32 logs, 126,427 instructions identical (`l14` accepted); 86 of 87 table entries plus `LINE_1010` as words; every non-interactive task; checklists 60/60, 37/37, 16/16; the official SIM68K.exe on GitHub gave every committed golden |
| 3 | Drawing: the thresholds of 6.5 | Holds | 26,826 of 26,826 primitive cases; ellipses 8,192/8,192, 3,000/3,000; text 16,902 of 16,902 required cases as decided under 6.5.3; check:text 78/78, check:examples 309/309, check:surface 28/28 in CI; the second Windows build 56 of 56 outputs |
| 4 | Twins: zero differences | Holds | windows-oracles of run 45111581771: 957 runs per assembler twin, 1,138 of 1,138 simulator twin runs, "No unexpected differences." |
| 5 | Parity: every row of 1.3 in the matrix; web-e2e, desktop-e2e and unit entries pass; manual entries signed off | Holds except the part a person must do | 179 of 179 rows; 308 of 308 web-e2e entries of 1.3 (338 with 1.5) in each browser over the six e2e jobs; 13 of 13 desktop-e2e entries of 1.3 (17 with 1.5); 10 of 10 unit entries of 1.3 (14 with 1.5); **15 manual entries (8 items) not signed off** |
| 6 | Platforms: the CI matrix of 7.4 green; the packaged-app checks on arm64 and Intel | Holds | The workflows against 7.4: 0 problems; every job of the three runs green or skipped as 7.4 allows (0 problems); packaged-app checks 1 to 8 of 6.7: arm64 "59 passed (52.1s)", Intel "59 passed (1.2m)"; the push run cancelled by GitHub, the manual run read in its place |
| 7 | Offline: the offline test passes; the app installs in Chromium | Holds except the part a person must do | offline.spec.ts in all six e2e jobs; check:pwa 114/114 in CI; the offline walk 27/27 here; installing from a real Chrome not done by a person |
| 8 | Accessibility: no serious automated finding; the manual list signed off | Holds except the part a person must do | 408 of 408 axe checks in each of the three audit jobs, no serious or critical finding; a11y.spec.ts 16/16 in all six e2e jobs; **the manual list not signed off** |
| 9 | Performance in Chromium on ubuntu-latest | Holds | Run 45111581771, `perf (ubuntu-latest, chromium)`: 7 of 7 verdicts; TaskDuration 2.41 s; p95 17.4 ms and 9 ms; Maximum 113,543,387 (needs 107,048,618 and 100,000,000); assembly 285 and 311 ms |
| 10 | Stability: the e2e suites 20 times in a row in each browser | Holds | Run 45111581771, six shards, each on `ubuntu-26.04` (`ubuntu-latest`): Chromium 6,500 of 6,500 passed, WebKit 6,440 passed and 60 skipped of 6,500, 0 failed, 0 flaky, 325 tests per repetition as in the checkout |
| 11 | Open verification items: confirmed, or listed under "not yet confirmed" with the port's behaviour | Holds | 108 occurrences of UNVERIFIED accounted for; 25 items confirmed; 59 open items each a row of part 4 of DIFFERENCES.md with the port's behaviour; 0 in neither place; 7 occurrences in lower case, each accounted for |
| 12 | Manual: MANUAL-TEST-MAC.md completed for the release candidate | **Not done by a person** (the release does not wait for it, erratum I3 6); the automatic part holds | The manual covers 6.8 (35 of 35 checks, 16 items) and part A can be followed as written (71 of 71 browser checks); nobody has worked through it on a Mac; by the owner's decisions the release is published before that (erratum I3 6) |

## Item 1 - Assembler

**Holds.**

`node tests/integration/rc/item-01-asm-evidence.mjs` on this PC, after `npm run test:conformance`
on the working tree of `9b2f25b` with the `site` set fetched (`build/corpus-local`; "Test Files 41
passed | 1 skipped", "Tests 1317 passed | 141 skipped"), exit 0, "item 1 holds on these counts".
The reports were written on 23 November 2026 at 04:25 UTC, after the last change of the manifest,
of the list of known differences and of the assembler in `engine/dist` (the judge refuses an older
report). Default options, per set (files / with a default run / with an official result /
identical / identical after masking undefined symbols / a known difference / no official result):

| Set | Files | Default run | Official result | Identical | Masked | Known difference | No official result |
|---|---|---|---|---|---|---|---|
| official | 10 | 10 | 10 | 10 | 0 | 0 | 0 |
| github-mit | 42 | 42 | 41 | 24 | 17 | 0 | 1 (`GFX.X68`) |
| conformance | 124 | 124 | 121 | 112 | 6 | 3 | 3 (`macro-10`, `macro-13`, `s21`) |
| site | 134 | 134 | 134 | 95 | 39 | 0 | 0 |

- So 118 of the 121 conformance default runs with an official result are equal (112 byte for byte,
  6 after masking) and 3 are the accepted differences `dir-11`, `macro-09` and `stc-03`.
- The `site` set is the 77 archives of the site that can be unpacked (134 programs;
  `tests/corpus/site-examples.json`). One archive of the site, `dragonballz.zip`, could not be
  obtained at all: the file on the server (43,384,832 bytes) is cut off and cannot be unpacked, so
  it has no programs to compare. (The other skipped entry, "Cpp to 68K", is a PDF with no program.)
- The fixed subset `tests/corpus/option-subset.json`: 30 files, each with one run per option
  switched alone: **240 of 240 runs equal** to the official result (byte for byte, or after masking
  undefined symbols), 0 not shown.
- Every run with an official result (801) was judged by the last conformance report: 654 identical,
  143 identical after masking, 4 known differences (`dir-11`, `stc-03`, and `macro-09` with the
  default options and with macros expanded); 0 not judged.
- Exceptions, all named in `docs/DIFFERENCES.md` (part T1) with their cause: the three accepted
  differences `dir-11`, `macro-09`, `stc-03`; the 143 runs equal only after masking undefined
  symbols; the six runs without an official result (`GFX.X68` default and expanded,
  `ALLGAMES4.1.X68` expanded, `macro-10` and `macro-13`, where the official program crashes with a
  stack overflow, and `s21`, where it stops at a message box). By the correction note of 6.9 (erratum
  T1 26) a run without an official result is an exception like any other.
- CI, run 45111581771: `conformance (ubuntu-latest)` and `conformance (macos-latest)` both printed
  "320 runs compared with the official assembler: 293 identical, 23 identical after masking
  undefined symbols, 4 differ" (the four known differences) and "214 runs compared ...: 172
  identical, 42 identical after masking undefined symbols, 0 differ" (CI has no `site` set);
  "Tests 1048 passed | 410 skipped".
- The official assembler on GitHub, `oracle.yml` run 45111588256, job `wine` (137497162720): the
  tracked sets regenerated through `EDIT68K.exe` under Wine ("534 runs with a result, 5 without",
  "every run equals the manifest"); the site set fetched ("77 of 77 archives unpacked ... (330
  files)") and run again: "267 runs with a result, 1 without", "**every run equals the
  manifest**"; the conformance tests there compared 801 runs: "320 ...: 293 identical, 23 ..., 4
  differ" and "481 ...: 361 identical, 120 identical after masking undefined symbols, 0 differ";
  "The official programs produced what the repository holds." (so `propose` was skipped).
- Shown to fail (this step, on a copy of `docs/DIFFERENCES.md` with CRLF line ends and without
  `macro-10`): "1 of 10 exceptions are not named in docs/DIFFERENCES.md", exit 1; the same copy with
  `macro-10` holds (erratum I3 7). The judge refuses a report older than its inputs (exit 2), as
  shown at the first check.

## Item 2 - Simulator

**Holds.**

`npm run check:rc` ran the sim project of `npm run test:conformance` (`EASY68K_SIM_REPORT_JSON`
set): "Tests 309 passed | 4 skipped (313)", exit 0, and then `node
tests/integration/rc/item-02-sim-evidence.mjs --sim-report <file> --sim-vitest <file>` on that
run's reports, exit 0. The comparison wrote: 220 programs, 244 artifacts compared, 240 equal, 4
measured differences, 0 recipes not compared.

- **Self-reporting programs: 188** (exceptions 16, hardware 10, instructions 62, quirks 10,
  trap15-a 70, trap15-b 20), all with an official result; **185 write the golden result file byte
  for byte**, as the comparison measured; 3 differ, all listed in
  `tests/conformance/sim/known-differences.json` and sorted by the correction note of 6.9 item 2
  (erratum T3 14): accepted (named in DIFFERENCES.md with their cause, not counted) `b06` and `b20`;
  unconfirmed (part 4 of DIFFERENCES.md, an open item of item 11, not counted) `b19`. **Counted
  against item 2: none.** 188 of 188 produce the golden or an accepted or unconfirmed difference.
- **Execution logs: 32 runs with an official log, 126,432 instructions logged; 31 runs and 126,427
  instructions byte-identical after masking the date** (at least 20 runs and 100,000 instructions
  are asked for). The one that differs is the accepted `l14` (a listing line with `%`). Outside the
  result files the output logs of `a05` and `a55` are accepted and masked (the stack residue after
  the text, erratum T3 14 and commit 45a7d55).
- The file-stream repair (commits 49a2e6d and 43282ba) is in this commit: `a51`, `a52` and `a53`
  produce their goldens and are no longer listed; `a61` to `a69` pin the Borland run-time's stream
  down against the official program. `a53`'s one remaining point (a close that fails because the
  system refuses a write of more than 4 GB, seen only under Wine) is a row of part 4 of
  DIFFERENCES.md and an open item of item 11, not a listed difference of item 2.
- sim-core 3.16: 86 of 87 table entries are present as instructions in the self-reporting
  programs as assembled (the judge decodes the first word of every instruction line of the port's
  listing; it does not trace a run); the 87th, `LINE_1010`, has no mnemonic and is present as `DC.W`
  words in `e07` and `e16` (erratum T3 10).
- TRAP #15: 80 tasks; interactive by erratum T3 11 (2, 4, 5, 10, 18, 58, 61, 100, 101): 9; every
  other task, and every sub-task of task 32, is called by at least one self-reporting program.
- Checklists, `node tests/integration/rc/item-02-checklists.mjs`, exit 0: trap15-a §13 60 of 60,
  hardware §13 37 of 37, sim-ui §19 (affects program results) 16 of 16 proved; "every named proof
  exists" (a program with an official result or a test found by its exact title; T3's reviewed
  mapping, errata T3 12 and 13; Q19 by the architect's decision U2 S6).
- CI, run 45111581771: `conformance (ubuntu-latest)` and `(macos-latest)` passed ("Test Files 41
  passed | 1 skipped", "Tests 1048 passed | 410 skipped"); the unit jobs on three systems passed
  (ubuntu "Tests 5141 passed | 63 skipped").
- The goldens on GitHub, `oracle.yml` run 45111588256: the official `SIM68K.exe` was run again for
  every program (step "Regenerate the simulator goldens (T3)"), the conformance tests passed
  against the regenerated goldens ("Tests 1314 passed | 144 skipped"), and "The official programs
  produced what the repository holds.": every result file and log of the release commit, `a61` to
  `a69` included, is what the official program gives there.
- Shown to fail (this step, on a copy of DIFFERENCES.md with CRLF line ends and without the part-4
  row of `b19`): "trap15-b/b19-net-send-uninitialised|report|result is unconfirmed but
  docs/DIFFERENCES.md does not name it under part 4", exit 1. The other broken inputs of the first
  check (a list without `a51` and `a52`, a partial run, a stale entry, a checklist proof whose title
  lost its end) are listed in `tests/integration/rc/README.md` and in the Git history of this file.

Open for a person, not required by item 2: the Windows session (`docs/porting/windows-confirmation.md`,
decision O-2) would settle `b19` and the remaining point of `a53`; it needs the owner's permission.

## Item 3 - Drawing

**Holds.**

`npx vitest run --config tests/integration/rc/item-03-vitest.config.ts --silent=false` on this PC:
exit 0, every test passed.

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
  `text-path-euro` 986/986, the 1,125 pinned pens 1,125/1,125; "@" in Courier 1,000/1,000 pinned
  pens; the fallback-font bytes: pens 85/85 where both captured Windows agree, every pixel 16/16
  where they draw the same. **16,902 of 16,902 required cases** ("6.5.3 required: 16902 of 16902
  cases equal in 15 classes; 0 differ"). Reported, not required: the 74 fallback-byte texts the two
  Windows draw differently, `text-path-formfeed` (pens 400 of 640) and `text-path-fallback` (0 of
  480), the history-dependent euro texts (9 and 414, all equal to the committed capture), and the
  proportional substitute at sizes without an atlas (12 of 32; widths estimated, recorded in part
  SH3).
- 6.5.4: `tests/conformance/examples/golden/surfaces.json` holds the 10 official examples, 20
  conformance programs and 4 scenes.
- CI, run 45111581771: `check:text` "78 of 78 checks passed" and `check:examples` "309 of 309" in
  `browser-checks (<os>, simulator)` (ubuntu 137487306036; the jobs on windows and macOS green
  too); `check:surface` "28 of 28" in the interface jobs (ubuntu 137487305967); the unit jobs on
  three systems "ellipses: 8192 of 8192", "ellipses-large: 3000 of 3000", "ellipses-wide: 496 of
  500".
- The second Windows build (job windows-oracles 137487305824, step "GDI capture, regenerate and
  compare (T2)"): "56 of 56 outputs equal the committed references (3 byte for byte; 24 apart from
  the other-font bytes)"; "text-path-euro: 1400 of 1400 pens equal the committed references; of the
  986 pinned in golden/text-path-euro-pens.json, 986 equal"; "text-path-fallback: 0 of 480 pens";
  "text-path-formfeed: 400 of 640 pens", which by erratum T2 29 the rule does not require.
- The judge is unchanged since the first check, where it was shown to fail with one pen moved by a
  pixel (`EASY68K_RC_SPOIL=text-path` and `=lines`, exit 1).

## Item 4 - Twins

**Holds.**

`node tests/integration/rc/item-04-twins.mjs --report <log of windows-oracles 137487305824>`, run
45111581771, exit 0: assembler 95 engine test runs and 431 programs x 2 option sets = 957 runs per
twin; patched `/O2` and `/Od` 957 same, unpatched 884 same and 73 that differ where a patch applies
(expected), 0 failed; the tracked programs today are 431, all in the report; simulator "569
scripts, 1138 of 1138 twin runs identical (/O2 and /Od)"; the 68000 single-step baseline "124
files, 1000060 tests, 285116 deviate; matches tests/conformance/cpu/baseline.json";
"engine/asm/test/native.test.mjs: exit 0"; "**No unexpected differences.**" The twins were not run
on this PC (they take 11 to 25 minutes and write T4's folder); the CI job is the evidence.

## Item 5 - Parity

**Holds, except the part a person must do: the 15 manual entries (8 items) are not signed off.**

- `node tests/integration/rc/item-05-parity.mjs`: 179 rows of 1.3 in the document, 179 matrix
  entries, per section 30/13/37/35/24/7/13/20 on both sides; 0 without an entry, 0 without a row,
  0 duplicated; every named file and test exists. Entries of 1.3 by kind: web-e2e 308, manual 15,
  desktop-e2e 13, unit 10, browser-check 4 (350). The additions bring 18 rows of 1.5 with 38
  entries (web-e2e 30, desktop-e2e 4, unit 4), which item 5 does not count; the judge prints both
  figures and judges the entries of 1.5 with the same rules.
- With the logs of run 45111581771: **308 of 308 web-e2e entries of 1.3** passed in Chromium and
  308 of 308 in WebKit (**338 of 338 with 1.5**), over the three e2e jobs of each browser (ubuntu
  Chromium 137487305843 "325 passed", ubuntu WebKit 137487305869 "3 skipped, 322 passed", windows
  Chromium 137487305915 "325 passed", windows WebKit 137487305868 "3 skipped, 322 passed", macOS
  Chromium 137487305785 "1 skipped, 324 passed", macOS WebKit 137487305874 "4 skipped, 321
  passed"; 0 failed in any of them). **13 of 13 desktop-e2e entries of 1.3** (17 of 17 with 1.5;
  desktop-dev 137487305808 "1 skipped, 79 passed" and the two release jobs). **10 of 10 unit entries
  of 1.3** passed (14 of 14 with 1.5), judged by `check:rc` from the Vitest JSON reports of local
  runs of the files they name and of the sim project; the folder entry `tests/conformance/sim/logs`
  by a passed test for each of its 30 programs. In CI the same files passed in the unit and
  conformance jobs.
- The manual entries (8 items of 6.8: printing; paste, twice; the browser shortcut table; full
  screen; the keyboard of a real MacBook; sound; serial and network) each open a row of the
  manual's table "Which check covers which item of the plan", whose checks exist. **No person has
  signed any of them off; no person has tried the application on a Mac.**
- The judge is unchanged since the first check (where it was shown to fail on a log with one red
  cross on a named test, and on a sim report without the test of one program of `logs`); the rows of
  1.5 were added to the matrix by the stage of additions and are read by the same code.

## Item 6 - Platforms

**Holds.**

`node tests/integration/rc/item-06-platforms.mjs --run ci=<jobs of 45111581771> --run
release=<jobs of 45111584448> --run oracle=<jobs of 45111588256> --mac arm64=<log> --mac x64=<log>`
(as `npm run check:rc -- --logs build/rc-final` runs it): **problems: 0**, exit 0.

- The workflows against 7.4, alone: 0 problems (every job and trigger of 7.4 is there, every action
  pinned by commit, `contents: read` by default; the job `propose` of `oracle.yml` pushes a branch
  instead of opening the pull request itself, erratum I3 2). Beyond 7.4 in `ci.yml`: plan,
  history-model, perf, readme, browser-checks.
- `ci.yml` run 45111581771 (by hand, standing for the cancelled push run 45111564124, erratum I3
  8): every job of 7.4 passed: `check`, `unit` on three systems, `conformance` on ubuntu and macOS,
  `e2e` on three systems in both browsers, the six `e2e stability` shards, `windows-oracles`,
  `desktop-dev (macos-15)`. Beyond 7.4 every job passed too: the twelve `browser-checks` jobs, the
  six `perf` jobs, the six `history model` jobs; `readme` was skipped (its input was not ticked).
  None of the failures of the first check (`chords.spec.ts` on macOS Chromium, `check:wave2` on
  Windows, the walk-run on macOS, `check:files` in WebKit on Windows) occurred in this run.
- `release.yml` run 45111584448 (version 0.0.0 at this commit; the tag's run builds 1.0.0):
  version, engines, web and `checksums` passed; **mac-arm64** (137484985034; arm64, macOS 15.8.2:
  "59 passed (52.1s)") and **mac-x64** (137484985016; x86_64, macOS 15.7.9: "59 passed (1.2m)"):
  checks 1 to 8 of 6.7 each passed. `publish (draft)` was skipped, as on every run that makes no
  release. The mac jobs print, for information, that Apple's distribution check rejects the bundle
  ("Notary Ticket Missing"): the app is signed ad hoc and not notarised, which the README, the
  release notes and part B3 of the manual cover.
- `oracle.yml` run 45111588256: engines, `wine` (137497162720) and "single-step CPU suites (frozen
  baseline)" passed; `propose the regenerated goldens` was skipped because nothing changed (items 1
  and 2).
- `pages.yml` run 45111564156: success.
- The judge is unchanged in this step; `rc.mjs` gives it the manual run instead of the push run.
  Before the runs had finished, in this step, it printed "problems: 6" (the six stability shards
  still running, the oracle run without jobs) and exited 1: a run that has not finished does not
  pass. At the first check it was shown to fail on a copy of the workflows with jobs on another
  runner (`EASY68K_RC_WORKFLOWS`).

## Item 7 - Offline

**Holds, except the part a person must do.**

- `tests/e2e/app/offline.spec.ts` passed in each of the six e2e jobs of run 45111581771 (the
  offline reload, Help offline, the manifest an installation needs, the file handlers; every job
  green, 0 failed).
- `check:pwa`: "114 of 114 checks passed" in the `browser-checks (<os>, simulator)` jobs (on ubuntu
  137487306036 "433 files, 18552116 bytes precached"; all served offline in Chromium and WebKit;
  Chromium parses the manifest without errors).
- This PC: `node tests/integration/rc/item-07-check-offline.mjs --browser all` (run by `check:rc
  --browsers`, a production build of the tree): "27 of 27 checks passed" (load, service worker,
  network off, reload, then check A1 of the manual offline in Chromium and WebKit: tutorial1.X68
  assembles and prints its four lines; Help shows its text in WebKit).
- "Installs in Chromium" is shown by Chromium's own reading of the manifest (no installability
  error) and the worker that controls the page; automation cannot press Install. Open for a person:
  installing from a real Chrome (manual B13), Safari's offline reload and Add to Dock (B2).

## Item 8 - Accessibility

**Holds, except the part a person must do: the manual list is not signed off.**

- The lists of erratum X1 8: `ALLOWED` in `tests/e2e/app/a11y.spec.ts` holds exactly its one entry
  (colour contrast of the original's syntax colours); `KNOWN` and `KNOWN_CHECKS` of the audit are
  empty; Q1-1 to Q1-6 are marked repaired below.
- `node tests/integration/rc/item-08-a11y-lists.mjs` with the three audit logs and the six e2e logs
  of run 45111581771: "60 of 60 checks passed". The automated scan: **408 of 408 axe checks** in each
  of `browser-checks (ubuntu-latest, accessibility)` 137487305948, `(windows-latest, ...)`
  137487305977 and `(macos-latest, ...)` 137487305991, no serious or critical finding (the audit
  printed "738 of 738" and "750 of 750 checks passed" in each, the keyboard walks included);
  `a11y.spec.ts` 16 passed, 0 failed in each e2e job.
- Open for a person: `docs/MANUAL-TEST-MAC.md` B7 (VoiceOver, the keyboard alone in Safari with both
  Tab settings, the focus frame in both themes; V10 and V11 for moving panels) and X4. Nobody has
  done them.

## Item 9 - Performance

**Holds.**

`node tests/integration/rc/item-09-perf-verdict.mjs <log of perf (ubuntu-latest, chromium)
137487305835> --require-ubuntu`, run 45111581771 (image ubuntu-26.04 as `ubuntu-latest`, `node
tests/perf/check-perf.mjs --browser chromium --judge auto`), exit 0, "7 of 7 verdicts hold
(Maximum by the document rule)":

- TaskDuration over 30 s of `spin.X68` at the default speed: 2.41 s with the 60 Hz frame source
  (needs < 4.5 s); 2.57 s with 120 Hz, printed.
- Frame intervals while `draw.X68` runs, 95th percentile: 17.4 ms at 60 Hz (needs < 20 ms), 9 ms at
  120 Hz (needs < 12 ms).
- At `Maximum`, by the rule of the document with its correction note (erratum P1 13): the engine
  alone 25,187,910 instructions per second, so 125,939,550 in 5 s, 85 % of that 107,048,618;
  `engine.stepCount` in 10 s **113,543,387** with the 60 Hz frame source (needs at least
  100,000,000 and at least 107,048,618: holds, by 6.5 million); 119,817,810 with 120 Hz, printed.
  The figure as printed before the note (200 million) is missed by 86,456,613, for information only.
  This runner was slower than the one of the first check (32.8 million per second for the engine
  alone there); the rule follows the runner, as the note intends.
- Assembling the largest corpus file under Node: `GFX.X68` alone 285 ms, `MAIN.X68` with its
  includes 311 ms (needs < 1 s).

The other five perf jobs of the run (macOS and Windows, both browsers; Ubuntu WebKit) passed; their
figures are for information (erratum P1 2). The judge is unchanged since the first check, where it
was shown to fail on a log with a smaller Maximum count and on one without the engine-alone line.

## Item 10 - Stability

**Holds** on commit `9b2f25b`.

`node tests/integration/rc/item-10-stability.mjs --current <the six shard logs>`, run 45111581771,
exit 0, "problems: 0":

- Every log is of an Ubuntu runner: "runner: ubuntu-26.04" (the image `ubuntu-latest` names), read
  from the job's "Image:" line.
- Chromium, `--repeat-each=20`, shards 1 and 2 of 2 (137487305897, 137487306055): 6,500 tests run
  = 325 x 20; **6,500 passed, 0 failed, 0 flaky**, 0 skipped.
- WebKit, shards 1 to 4 of 4 (137487305864, 137487305870, 137487305976, 137487305924): 6,500 tests
  run = 325 x 20; **6,440 passed, 0 failed, 0 flaky**, 60 skipped (3 tests that the suites skip in
  WebKit by design, 20 times each).
- The checkout lists 325 tests in each browser (e2e/app 47, e2e/editor 120, e2e/fixtures 13,
  e2e/plus 17 (the additions), e2e/sim 128), as many as the logs ran per repetition. The longest
  shard took 1.0 h (Chromium), within the shards' limit of 120 min.
- The judge is unchanged since the first check, where it was shown to fail on a log whose image line
  named a macOS runner.

## Item 11 - Open verification items

**Holds.**

`node tests/integration/rc/item-11-unverified.mjs`, exit 0: 108 occurrences of UNVERIFIED in
`docs/porting` and its errata, each accounted for (11 define the marker, 16 inside a spec's list,
65 carried by a list item, 13 errata about one, 2 settled where they stand, 1 superseded, 0 in no
list); 86 list items, of which 2 are decisions, **25 confirmed** (none still a row of part 4) and
**59 open, each a row of its own in part 4 of `docs/DIFFERENCES.md`** ("Not yet confirmed against
the original", 65 table rows) whose third cell says what the port does; 0 in neither place. The
word in lower or mixed case occurs 7 times, each accounted for (5 carried by a list item, among them
the three statements of erratum E4 that the architect made open items, 1 settled, 1 not the
marker), 0 awaiting a decision. The conformance programs `b19` (unconfirmed) and `a53` (its one
point seen only under Wine) are among the 59.

- Changed in the judge in this step: it reads `docs/DIFFERENCES.md` with its line ends normalised.
  On this PC's working copy (CRLF, from `core.autocrlf`) `npm run check:rc` first printed "does not
  hold here (open and in NEITHER place: 59)", because the judge did not find the heading of part 4;
  the document was right (erratum I3 7). Shown to fail after the change: with a CRLF copy of
  DIFFERENCES.md without the row of `b19`, "open and in NEITHER place: 1", exit 1; the CRLF copy
  itself holds.

Open for a person, not required by the item: the Windows session would confirm many of the 59.

## Item 12 - Manual

**Not done by a person (the release does not wait for it, erratum I3 6); the automatic part
holds.** By the owner's decisions (erratum
I3 6) the release is published before `docs/MANUAL-TEST-MAC.md` has been completed; it stays open
there, and the README, the release notes and part 5 of DIFFERENCES.md say so.

- `node tests/integration/rc/item-12-manual-coverage.mjs`: **35 of 35**: 6.8 has 16 bullets (the
  sixteenth, the PDF viewer of the additions, since the integration pass of the additions), each
  with a row of the table of checks naming checks that exist (the viewer: E1 to E4); the shortcut
  table has the 15 macOS and 10 Windows chords the page cancels; every check of A1, A3 to A5, B1 to
  B3 and B7 has a place in the report form; the texts the manual quotes are the application's (the
  storage notices, the paste message, the Caution box); the first-start text of B3 equals the
  README's (2,714 characters each).
- `node tests/integration/rc/item-12-check-part-a.mjs --browser all` (macOS key map, a production
  build of the tree): "71 of 71 checks passed" in Chromium and WebKit (Help > Examples..., F9,
  Execute, F9 with the four lines and Halted; the three test programs: echo "You typed:   HELLO",
  keys "A down: FF" then "A down: 0", fonts "Sum: B4818F4C").
- The manual was brought to the release in this step: the Mac app is the download of the Releases
  page (B3 and the checks E4 and E5 no longer wait for a release), and its first lines say that
  release 1.0.0 was published before anyone worked through it. Both judges were run on the changed
  manual (above). The judge's last line now says that part B3 uses the app of the Releases page.
- Open for a person: parts A and B on a real Mac, including the shortcut table in Safari, Chrome and
  Edge, B3 (Gatekeeper and the first start on Apple Silicon and Intel) with the released app, and
  E1 to E5 (the PDF viewer); part C on real Windows only with the owner's permission (O-2).

## What a person must still do

Nothing here is required before the tag by the owner's decisions of 22 November 2026 (erratum I3
6); each stays open in `docs/MANUAL-TEST-MAC.md` and is named in the README, the release notes and
part 5 of `docs/DIFFERENCES.md`. Nobody has done any of it.

1. **Items 5, 7, 8 and 12: a person with a Mac** works through `docs/MANUAL-TEST-MAC.md` with the
   web version and the released Mac app: parts A and B (B3 for the first start, B7 for item 8, B2
   and B13 for item 7: Safari's offline reload and Add to Dock, and installing from a real Chrome;
   the 15 manual entries of the parity matrix for item 5; E1 to E5 for the PDF viewer of the
   additions), fills in the report form and posts it as an issue, and signs off the manual list.
2. **Optional, with the owner's permission (O-2):** the Windows session of
   `docs/porting/windows-confirmation.md` (settles `b19`, the remaining point of `a53` and other
   items of part 4). Not required by 6.9.

## Changed in this step

- `tests/integration/rc/lib/runs.mjs`: the runs and jobs of `9b2f25b`; the cancelled push run is
  named (`CANCELLED_PUSH`) and the manual run is read in its place (erratum I3 8). `rc.mjs` reads
  the manual run where it read the push run; its header and its line for item 12 say what is true at
  the release.
- `item-01-asm-evidence.mjs`, `item-02-sim-evidence.mjs`, `item-11-unverified.mjs`: read
  `docs/DIFFERENCES.md` with its line ends normalised (erratum I3 7); each shown to fail on a broken
  CRLF copy (items 1, 2 and 11 above).
- `item-12-manual-coverage.mjs`: its closing line (part B3 with the released app). The count of
  6.8's bullets (16) and of the parity matrix's rows of 1.5 (18, judged with the rest by item 5)
  were already brought to the merged state by the integration pass of the additions (commit
  bd3d8a2); this step checked that the judges and this document agree with it.
- This document, `tests/integration/rc/README.md` and `docs/porting/errata/I3.md` (entries 6 to
  9).

The history of the first check (commit `b247e17`, before the file-stream repair and the additions)
and its two reviews is in the Git history of this file (commit 9b2f25b and earlier) and in
`docs/porting/errata/I3.md`; the broken inputs on which each judge was shown to fail are listed in
`tests/integration/rc/README.md` ("Showing that a judge fails when its item is broken").

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
