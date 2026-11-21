# Integration gate I1 - wave 1 on the real application

Owner: I1 (integration engineer). Round 2, 21 November 2026, on the working tree after commit
`8611609` with the round-2 edits of the other engineers in progress. Machine: Windows 11, Node 24,
the pinned Playwright Chromium and WebKit, `engine/dist` as built on this PC.

This file says what was run, what came out, and what is wrong, each defect with one owner. Nothing
here was repaired by I1: I1 edits no package's code and no wiring (ARCHITECTURE.md 9.3).

## 1. The scenario and how it is run

ARCHITECTURE.md 9.3: open an official example in the editor; load a prebuilt `.S68` and `.L68`; run
to the halt with text output; type into a task 2 prompt; pause, step, trace; the Memory, Stack and
Hardware panels follow. It is automated twice, both in `tests/integration/wave1/`:

| File | What it drives | How to start it |
|---|---|---|
| `check-wave1.mjs` | The real application from the Vite development server, in headless Chromium (Windows key map) and WebKit (macOS key map), through menus, toolbar, Files panel, dialogs and keyboard | `node tests/integration/wave1/check-wave1.mjs --browser all` (also `chromium` or `webkit`; `--out <dir>`; `--only student,prompt,trace,hardware,draw,tour,reload`) |
| `scenario.test.ts` | The same scenario under Node on the headless session of 6.4 (`core/run/headless.ts`): real assembler, real simulator engine, real run controller, real host parts, virtual time | `npx vitest run --config tests/integration/wave1/vitest.config.ts` from the repository root |
| `fixtures.ts` | Shared by both: the official examples and five small programs, assembled with the real assembler; the headless runs that tell the browser check what each program prints | - |

The `.S68` and `.L68` files are produced at run time by the real assembler (`engine/dist`) from
`app/public/examples` (checked byte for byte against `tests/corpus/official`) and from five programs
written for this gate (a task 2 prompt, a task 5 key wait, a drawing, a counter with a subroutine,
a hardware loop). Nothing is copied from `reference/`.

`check-wave1.mjs` needs only the pinned development dependencies and `engine/dist`; it exits 1 with
a message when `engine/dist` is missing. It picks a free port, turns off file watching and hot reload
(other engineers' edits must not reload the page mid-check), writes screenshots only to
`build/I1/wave1-check/`, prints `N of M checks passed`, and exits non-zero on any failed check or
any console error. One browser takes about 6 minutes on this PC. It does not depend on Windows:
key maps are set per browser, the Memory panel's Address field is typed through its mask (Home,
digits, Enter) rather than with a Select All chord, and pixels are read from the canvas.

The page object `window.__easy68k` (development builds) is used only to read state for comparisons
and to wait; every action goes through the interface as a student does it.

### What the browser check covers

- **student**: Help > Examples...; double-click `tutorial1.X68` in the Files panel; the editor holds
  the official text unmodified, coloured; Import... of `tutorial1.S68` and `tutorial1.L68`; Simulator
  File > Open with its filter; listing, message area, window title, PC field, highlighted row, status
  bar; Run to the halt; the Output panel's text and canvas; registers equal to the engine's; cycles;
  the command states after a halt (4.8); Rewind (registers, PC, Output cleared); F9 runs it again;
  File > Close; Ctrl+O (Cmd+O) opens it again; it runs again; back in the editor, close the tab and
  reopen through Open File; type a line and save with Ctrl+S (Cmd+S): the bytes in the store have
  CR LF line ends and the settings lines.
- **prompt**: task 2 prompt, keyboard in the Output panel without a click, echo on the canvas, Enter,
  the answer equals the headless run, D1 = 3; Backspace correction; a program that waits for one key
  (task 5) waits, then takes `k`.
- **trace**: Run, F6 Pause from the Output panel, nothing executes after Pause; register fields and
  highlighted row equal the engine after every step; View > Memory and View > Stack; F7 to the BSR,
  Trace Into enters the subroutine, the Stack panel shows the return address; F8 Step Over; the
  Memory panel follows the store of the counter; F10 Auto Trace and Pause.
- **hardware**: the 7-segment display and LEDs follow the running program; Switch 0 and Switch 7
  reach it and come back on the LEDs; the Memory panel shows the display bytes at `E00000`.
- **draw**: five canvas pixels of a drawing program (fill, pen, line, pixel, background).
- **tour**: each of the ten official examples is opened, its PC row must be marked, it is run and
  compared with the headless session (text, end state); for a program that keeps running, nothing
  may call it halted; Pause and Rewind between programs.
- **reload**: the page is reloaded, the imported file is still there and runs again; a second page
  of the same browser sees the file and runs it on its own simulator.

## 2. Results

Times are local (UTC-5). Results that came and went are listed with both times.

### The scenario

| Run | When | Result |
|---|---|---|
| `scenario.test.ts` (Node, real engines) | 10:00 | 13 tests: 11 passed, 1 failed, 1 skipped (the engines guard). The failure is finding 1. |
| `check-wave1.mjs --browser chromium` | 09:30 (round 1 script) | 103 of 106. Failures: finding 3 twice, and the prompt part, whose page did not load because `app/src/features/files/dialogs.ts` did not parse at 09:25 (FS1 mid-edit; gone at 09:45, see section 4). |
| `check-wave1.mjs --browser webkit` | 09:40 | 114 of 120. Besides finding 3, four failures were faults of the check itself (Cmd+A is not Select All in Playwright's WebKit on Windows; a click on the listing selected a row). Both repaired in the check. |
| `check-wave1.mjs --browser chromium` | 09:58 | 126 of 133. All 7 failures are findings 1, 3 and 4. |
| `check-wave1.mjs --browser webkit` | 10:08 | 127 of 134. All 7 failures are findings 1, 3 and 4. The save step passes. |
| `check-wave1.mjs --browser all` (the command for CI) | 10:12 | 254 of 268, exit 1. The same 7 failures in each browser: finding 1 (three examples), finding 3 (two steps), finding 4 (two examples). No console error. |

Every part of the scenario itself works on the real application in both browsers: the example opens
in the editor, the prebuilt files load with their listing, tutorial1 runs to its halt with the four
lines on screen and on the canvas, the task 2 prompt takes typed text with echo and Backspace, a key
wait takes one key, Pause, Trace Into, Step Over and Auto Trace move the registers and the listing
with the engine, the Stack panel shows the return address, the Memory panel follows a store, the
Hardware panel follows a running program and its switches reach the program, a drawing program's
pixels are on the canvas, all ten official examples end as in the headless session with no console
error, and the store survives a reload. The screenshots in `build/I1/wave1-check/` were looked at;
what they show beyond the checks is in findings 4 and 5.

### Root check scripts, unit tests, type check, lint (this PC)

| Command | When | Result |
|---|---|---|
| `npm test` | 09:38 | 152 files passed, 1 skipped; 3,150 tests passed, 36 skipped |
| `npm run typecheck` | 09:48 | failed: `app/src/features/pwa/register.test.ts(282,51)` and `(283,37)` TS2551 `toasts` does not exist on `DialogService` (DV1, mid-edit) |
| `npm run typecheck` | 10:10 | passed (app, desktop, tests) |
| `npm run lint` | 09:49 | passed (eslint and the lint-rule tests, 59 of 59) |
| `npx prettier --check tests/integration/wave1` | 10:15 | passed |
| `npm run check:gallery` | 09:36 | 206 of 206 |
| `npm run check:shell` | 09:42 | 344 of 344 |
| `npm run check:engine-browsers` | 09:46 | failed: `the production build in chromium`, the `afterAll` that closes the browser exceeded 60 s (24 of 24 tests passed) |
| `npm run check:engine-browsers` | 10:09 | passed, 24 of 24 (21 s): the 09:46 failure was the machine's load |
| `npm run check:editor` | 09:50 | 122 of 122 |
| `npm run check:highlight` | 09:50 | 54 of 54 |
| `npm run check:files` | 09:55 | 134 of 134 |
| `npm run check:documents` | 09:56 | 66 of 66 |
| `npm run check:help` | 09:58 | 162 of 162 |
| `npm run check:surface` | 09:58 | 28 of 28 |
| `npm run check:easybin` | 10:00 | 164 of 164 |
| `npm run check:memory-stack` | 10:01 | 168 of 168 |
| `npm run check:text` | 10:01 | 57 of 57 |
| `npm run check:output` | 10:04 | 525 of 525 |
| `npm run check:hardware` | 10:04 | 74 of 74 |
| `npm run check:run` | 10:05 | 90 of 90 |
| `npm run check:sim-main` | 10:07 | 170 of 170 |
| `npm run check:pwa` | 10:08 | 60 of 60 |

All check scripts ran in both browsers (their default `--browser all`), one after another, while
other engineers ran tests on the same PC.

### CI run 44913261966 (the round-1 commit `8611609`)

Read with `gh run view 44913261966` and `--log-failed` at about 09:35 (the run had ended;
`build/gate1/ci-round1.log` did not exist yet). Green: check (typecheck, lint, format), engines,
unit on all three systems, conformance on Ubuntu and macOS, desktop-dev on macOS, and both
browser-check jobs on Windows. Red, with the steps that failed:

| Job | Step | What failed | Finding |
|---|---|---|---|
| browser-checks (macos-latest, interface) | Editor check (E2) | `chromium: Ctrl+C and Ctrl+X with a selection copy and cut it` and the same in WebKit: no copy or cut event, the text stays | 2 |
| browser-checks (macos-latest, interface) | EASyBIN check (B1) | key-down to painted frame: median 34.2 ms, p95 129.8 ms, max 187.8 ms | 9 |
| browser-checks (ubuntu-latest, interface) | Files check (FS1) | WebKit: Export... of the store root downloads `My_Programs.zip`, not `My Programs.zip` | 8 |
| browser-checks (macos-latest, simulator) | Run check (SH8) | Chromium: 618,792 to 785,397 instructions/s instead of 1,000,000 (longest frame gaps 117-133 ms); task 23 delay of 50 units took 52-55 hundredths; without frames 59-61 | 6 |
| browser-checks (ubuntu-latest, simulator) | Output panel check (SH4) | `webkit/ratio 1.5: the canvas holds the pixels the program drew, unscaled` | 7 |
| windows-oracles | GDI capture (T2) | `spots.json`, `metrics.json` and bitmap atlases DIFFERENT on the runner's Windows (10.0.26100, not recorded) | 10 |

Every one of these passed on this PC (Windows) in the runs above, so each is a macOS or Linux
difference. The steps after a failed step of the same job did not run in CI.

## 3. Findings, most serious first

Each has one owner. "Seen" says where; "Expected" says by which section or spec; "Cause" is where I
believe the fault is; "Repair" is a suggestion, not a decision.

### 1. After opening a second program, the listing marks a row that is not the PC (major) - owner W4 (for the simulator engine)

- Seen: in both browsers and headless. Open, run and rewind one program, then open another whose
  start address gives the same PC text (almost every example starts at `$1000`). The listing's
  highlighted, selected row is the previous program's row number in the new listing. tutorial1 then
  tutorial2: row 21 is marked, `0000100A 4E4F trap #15`, while PC = `00001000`. Also graphicSound
  (row 39, `00001036`, a blank line), mouseWindowSize (row 19, `00000000`, a comment), and by
  coincidence MACRO and clockWithSound. `scenario.test.ts` "a second program opened over a rewound
  first one" fails with `row 21: 0000100A 4E4F 18 trap #15`; the tour of `check-wave1.mjs` fails
  three times per browser.
- Expected: sim-ui §6.4 (highlight rule) and the original's code path traced in
  `docs/porting/errata/U1.md` entry 8: `OpenFile` empties the list box with
  `ListBox1->Items->Clear()`, which in the VCL also drops the selection; because the PC text does
  not change, no `highlight()` runs afterwards, so the original selects no row. It never marks a
  row of the new program that is not the PC. A student sees the arrow on a wrong instruction.
- Cause: `engine/sim/shim/form1.cpp:366` calls `ListBox1->Items->Clear()`; the shim's
  `TStrings::Clear` does not reset `ItemIndex` (only `TListBox::Clear`, `form1.cpp:47-49`, does).
  The controller (SH8) and the Listing panel (U1) follow `engine.listingHighlight` as they must.
  U1 recorded this for the engine owner in its errata entry 8; nobody has taken it up.
- Repair: in the shim, make the list box's `Items->Clear()` reset `ItemIndex` to -1 (or call
  `ListBox1->Clear()` in `OpenFile`), rebuild `engine/dist`, and add a W4 test of the fact. W4 owns
  the binding and the tests of the shim facts (ARCHITECTURE.md 3.2), so W4 takes it to the engine
  owner.

### 2. On a Mac, Ctrl+C and Ctrl+X do not copy or cut in the editor (major) - owner E2

- Seen: CI run 44913261966, browser-checks (macos-latest, interface), Editor check (E2):
  `FAIL chromium: Ctrl+C and Ctrl+X with a selection copy and cut it - "line1\nline2\nline3" []`
  and the same for WebKit (the WebKit pass runs with the macOS key map). It passes on Windows and
  Linux, where the browser itself copies on Ctrl+C. Not reproducible on this PC.
- Expected: E2's own rule K2 (check-editor.mjs: "on a Mac Cmd+X / Cmd+C and Ctrl+X / Ctrl+C"),
  editor-ui §8.7. On macOS neither Safari nor Chrome copies on Ctrl+C by itself, so the editor must.
  macOS is the port's main target.
- Cause: the editor leaves Ctrl+C and Ctrl+X to the browser's default action (`app/src/ui/editor/`),
  which exists only on Windows and Linux.
- Repair: handle Ctrl+C and Ctrl+X in the editor's key map on the macOS key map (run the copy or cut
  through the platform clipboard or `document.execCommand`), and keep the check on the macOS runner
  as the proof.

### 3. The status bar says "Halted" after Rewind and after opening a program (minor) - owner SH8

- Seen: both browsers, student part: after Rewind `Halted | PC=00001000 | ...`; after File > Close
  and Ctrl+O (Cmd+O) of the same program the same. Run is enabled at that moment.
- Expected: the status bar's run state is the port's addition (ARCHITECTURE.md 1.4 note 34, 2.3).
  The original's `halt` flag is not cleared by `initSim()` (sim-ui §9.9; sim-core: cleared at the
  start of the next `runprog`), which matters for the listing rule and must stay; but to a student
  "Halted" next to an enabled Run after Rewind is wrong, and Rewind and Open put the commands into
  the active state (sim-ui §3.6).
- Cause: `app/src/features/run/status.ts` `runStateText` returns `Halted` whenever
  `AppState.sim.halted`, which `features/run/mirror.ts:66` copies from the snapshot's raw engine
  flag.
- Repair: show `Halted` only while the program is idle in the busy menu state
  (`halted && menuState === 1`), otherwise `Stopped`; add the two cases to `logic.test.ts`. The
  contract field `AppState.sim.halted` (W1) has no comment; saying there that it is the engine's
  raw flag would prevent finding 4 as well.

### 4. While a program runs, the Run button's tool-tip says "Program halted" (minor) - owner W3

- Seen: both browsers, tour: clockDigital and mouseWindowSize running (status bar `Running`), the
  disabled Run button's tool-tip reads `Program halted. Rewind or Reload to run it again.`;
  `AppState.sim.halted` is true. It is the previous program's halt: the flag is not cleared by
  Rewind or Open (finding 3) and no snapshot is taken during a run. Also visible in the screenshots
  `*-tour-clockDigital.png` and `*-tour-mouseWindowSize.png`.
- Expected: ARCHITECTURE.md 1.4 note 22: the hint explains why the five commands are disabled after
  a halt; while running they are disabled because the program runs.
- Cause: `app/src/commands/menus.ts:178` uses `env.state.sim.halted` alone.
- Repair: give the hint only when `phase === 'idle' && menuState === 1 && halted`; add a case to
  `menus.test.ts`.

### 5. Stale tool-tip text and a crowded Hardware panel (observations, no owner yet)

- In the screenshots the Run button's tool-tip stays on screen with its old text while the state
  changes under a still mouse; that is finding 4's text.
- With the Output panel and the Hardware panel sharing the right column at 1400x900, the Interrupt,
  Auto Interval and Reset groups of the Hardware panel are cut at the bottom of the screenshot. I did
  not check whether the panel scrolls; SH7 may want to look.

### 6. Run check fails on the macOS CI runner: speed and task 23 delays (minor) - owner SH8

- Seen: CI run 44913261966, macos-latest, Run check (SH8), Chromium only:
  `the default speed is a million instructions per second of frame time (best of three) - 618,792/s
  (longest frame gap 133 ms), 780,328/s (117 ms), 785,397/s (117 ms)`; `a task 23 delay of 50 units
  takes half a second - 55, 52, 54, 52, 54 hundredths`; `without display frames ... 59, 60, 59, 59,
  61 hundredths`. WebKit passed on the same runner; all passed on this PC (10:05) and in CI on
  Windows and Ubuntu.
- Expected: ARCHITECTURE.md 4.5.6 (speed), SH8's acceptance (task 23 timing), and the rule that a
  timing check must not fail merely because the machine is loaded.
- Cause: either the governor does not catch up after long frame gaps (frames of 117-133 ms on that
  runner), which a slow Mac would also show, or the criteria are too tight for that runner. The
  third item waits on `docs/requests/SH8-frame-watchdog.md` (W3's `state/browser.ts`).
- Repair: SH8 decides which: measure on the runner, and either let the governor carry the allowance
  over long frames, or record the figures and widen the criterion for runners with long frame gaps.

### 7. Output panel check fails in WebKit on Linux at device pixel ratio 1.5 (minor) - owner SH4

- Seen: CI run 44913261966, ubuntu-latest, Output panel check:
  `FAIL webkit/ratio 1.5: the canvas holds the pixels the program drew, unscaled` (524 of 525).
  Passes on Windows (here, 10:04) and on macOS.
- Expected: SH4's acceptance, "canvas backing size equals the surface size at device pixel ratios
  1 and 2", and 6.5.4 (pixels must not depend on the browser).
- Cause: not established; the backing size check passed, so the pixels read back differ (perhaps
  smoothing when WebKit on Linux paints at 1.5).
- Repair: SH4 prints the first differing pixel in the check, reproduces on Linux, and repairs or
  records it.

### 8. Files check fails in WebKit on Linux: the export's file name (minor) - owner FS1

- Seen: CI run 44913261966, ubuntu-latest, Files check: `FAIL webkit: Export... of the store root
  downloads "My Programs.zip" - My_Programs.zip`. Passes on Windows and macOS.
- Cause: Playwright's WebKit on Linux replaces the space in a suggested download name; whether a
  real browser does is not known.
- Repair: accept either spelling in the check on Linux WebKit, or name the file without a space;
  record which in FS1's errata.

### 9. EASyBIN check fails on the macOS runner on a timing criterion (minor) - owner B1

- Seen: CI run 44913261966, macos-latest, EASyBIN check: `editing at $000000, $7FFF80, $FFFF00:
  key-down to painted frame, best run (median 34.2 ms, p95 129.8 ms, max 187.8 ms over 120 keys)`.
  Passes here (10:00, 164 of 164).
- Expected: the rule that a timing check must not fail merely because the machine is loaded.
- Repair: report the figures and fail only on a criterion that holds on a loaded runner (for example
  the median), as the other timing checks do.

### 10. windows-oracles is red by policy (minor) - owner T2

- Seen: CI run 44913261966, windows-oracles, GDI capture: `DIFFERENT` for `spots.json`,
  `metrics.json` and bitmap atlases on the runner's Windows 10.0.26100, which is not recorded in
  `other-windows.json`. Already in the round-1 review defects.
- Repair: a gate decision: record the runner's differences after review, or make the step
  non-blocking until then.

### Not findings, for the record

- 09:25: `app/src/features/files/dialogs.ts:229` did not parse (`Identifier 'folder' has already
  been declared`), so the page did not load for one part of the check. FS1 was editing it; it
  parsed at 09:45 and every later run passed that part.
- 09:46: `check:engine-browsers` closing Chromium took over 60 s; it passed at 10:09 in 21 s.
- 09:48: DV1's `register.test.ts` failed the type check; it passed at 10:10.
- A Node process of the round-1 integration engineer (process id 51980, started 02:56, running
  `check-files.mjs --out build/I1/checks/round1/check-files`) was still alive at 09:50. I did not
  start it and left it alone; the orchestrator may want to end it.
- The status bar, highlight and command states after a halt were otherwise as the specs say: after
  SIMHALT Run and Trace Into are disabled and Pause, Rewind and Open enabled (4.8); after Rewind the
  canvas and the text are cleared and memory is kept (sim-ui §9.10).

## 4. Contract pairs looked at on purpose

| Pair | How | Result |
|---|---|---|
| Documents and editor (E1, E2) | open, close, reopen, type, save with the keyboard; bytes read back from the store | works in both browsers |
| File store and documents (FS1, E1) | Open File dialog from the toolbar, folders, the save to `/browser/Examples` | works |
| Files panel and simulator (FS1, SH8) | Import..., the simulator's Open dialog filter, reload, two pages | works |
| Run controller and devices (SH8 with SH3, SH4, SH7, SH1) | every official example and five programs, compared with the headless session | works; the highlight of finding 1 comes from the engine |
| Run controller and registers, listing, memory, stack, hardware panels (SH8 with U1, U2, SH7) | after every step the fields and the marked row equal the engine; memory and stack rows equal engine memory | works; findings 1, 3, 4 |
| Keyboard and text screen (SH4, SH3) | task 2 with echo and Backspace, task 5, Enter | works |
| Surface and Output panel (SH1, SH4) | five pixels of a drawing; text pixels; Rewind blanks the canvas | works |
| Command states and toolbar (SH8, W3) | the hint of a disabled Run | finding 4 |
| Features and the engine (principle 8) | every engine change in `features/` and `ui/` read | all go through `controller.invoke` |
| Help and the shell (H1, W3) | Help > Examples...; `check:help` | works |
| Electron shell and platform (DV2) | not run here (no windows may be opened on this PC); CI desktop-dev on macOS passed | see section 5 |

## 5. What could not be run, and why

- The Electron app: only DV2 may start Electron on this PC. Evidence is CI's desktop-dev job on
  macOS (green in run 44913261966).
- macOS and Linux: not available here. What they show comes from CI run 44913261966; the Mac-only
  finding 2 is therefore known from CI only.
- A production build of the scenario: `check-wave1.mjs` drives the development server, as the other
  check scripts do; `check:pwa` and `check:engine-browsers` cover the production build.
- Sound: the examples with sound ran with the browsers' audio; nothing was listened to.
- `check-wave1.mjs` in CI: not yet a step of the browser-checks job. It must be added by the
  configuration engineer (`node tests/integration/wave1/check-wave1.mjs --browser all`, after
  engine-dist is downloaded, guarded by `needs.engines.outputs.available == 'asm sim'`, uploading
  `build/I1/wave1-check/`). It will be red until findings 1, 3 and 4 are repaired, as 9.3 intends.
- `scenario.test.ts` is not part of `npm test` or `test:conformance`. It runs with its own
  configuration (section 1), and also through `tests/vitest.integration.ts`, which the configuration
  engineer was adding during this round (`npx vitest run --config tests/vitest.integration.ts`
  picked it up at 10:12: 11 passed, 1 failed, 1 skipped). It is red until finding 1 is repaired.
