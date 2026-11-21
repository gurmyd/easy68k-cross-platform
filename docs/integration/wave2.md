# Integration gate I2 - wave 2 on the real application

Owner: I2 (integration engineer). Round 1, 21 November 2026, on the working tree after commit
`fdabb2b` with the round-1 edits of the other engineers in progress. The round was cut off twice (an
editor restart at about 14:00 and a restart of the PC at about 15:15) and resumed each time; what the
stopped I2 had written was kept, checked and finished. Machine: Windows 11, Node 24, the pinned
Playwright Chromium and WebKit, `engine/dist` as built on this PC.

This file says what was run, on what, with what result, and what is wrong, each defect with one
owner. I2 repaired nothing outside `tests/integration/**` and `docs/integration/**`: it edits no
package's code and no wiring (ARCHITECTURE.md 9.5, 3.1, 3.12.3).

## 1. The scenario and how it is run

ARCHITECTURE.md 9.5: every official example is opened, assembled, executed and run to its end or
first input in the web build, in Chromium and WebKit; outputs compared with the headless results;
edit, assemble and Execute three times in a row (each Execute a cold start); settings import and
export; logging; the desktop development build runs the same scenario; no command id without a
handler. The task of this gate added: a program that reads and writes a file, a program that plays
sounds, a breakpoint that stops a run, find and replace before assembling, and, beyond the letter, a
program with an error, an INCLUDE from the store, two windows, closing and reopening the page, and the
published preview's sub-path build.

| File | What it drives | How to start it |
|---|---|---|
| `tests/integration/wave2/check-wave2.mjs` | The real application from the Vite development server in headless Chromium (Windows key map) and WebKit (macOS key map); and the production build under `/easy68k-cross-platform/` | `node tests/integration/wave2/check-wave2.mjs` (options: `--browser chromium\|webkit\|all`, default `all`; `--out <dir>`, default `build/I2/wave2-check`; `--only` with any of `examples,cycle,settings,logging,files,breakpoint,replace,error,include,windows,reopen,commands,subpath`) |
| `tests/integration/wave2/scenario.test.ts` | The same scenario under Node: the APPLICATION built by bootstrap (`createTestApplication`) with the real document service, Assemble, Run, Listing, Log, Break Points and Find features, the real engines, run controller and host parts (ProgramFiles over `CachedSyncFiles`, LogService, SoundDevice), virtual time; only the audio output (a recorder) and the glyph atlases are stand-ins | `npm run test:integration` (it picks up `tests/integration/*/vitest.config.ts`), or `npx vitest run --config tests/integration/wave2/vitest.config.ts` |
| `tests/integration/wave2/programs.ts` | The scenario's programs and the official goldens it compares with (plain data and file readers) | - |
| `tests/integration/wave2/fixtures.ts` | The Node application builder; re-exports `programs.ts` | - |

### For the configuration engineer (CI)

`check-wave2.mjs` needs `engine/dist` (it exits 1 with a message when it is missing) and nothing but
the pinned development dependencies with Playwright's Chromium and WebKit installed. It starts the Vite
development server of `app/` on a free port with file watching and hot reload off, and for the part
`subpath` it runs `vite build` with `EASY68K_BASE=/easy68k-cross-platform/` and then
`app/src/features/pwa/build/finish-build.mjs`, exactly as `pages.yml` does, into
`<out>/dist` (never `app/dist`), and serves it from a small static server on a free port under that
sub-path only. Screenshots and the build go below `build/I2/wave2-check` (or `--out`). It prints
`N of M checks passed` and exits non-zero on any failed check or console error; a failed part leaves
`<browser>-<part>-failed-<n>.png` and prints the open dialogs. On this PC, alone, Chromium takes about
three minutes and WebKit about eight (11 minutes in all at 15:19-15:30 with other engineers' tests
running). Suggested root script and CI step: `"check:wave2": "node tests/integration/wave2/check-wave2.mjs"`,
in the job `browser-checks` (group `simulator`) after `check:wave1`, with `EASY68K_REQUIRE_ENGINES=1`,
uploading `build/I2/wave2-check/*.png` on failure. Nothing in it depends on Windows: chords are read
from the application's own table (`chordsOn()`), paths are POSIX paths of the store, sounds are
identified by their length, timing checks have wide margins and print their numbers. Until finding 2
is repaired it fails in Chromium on that one check; the job will be red for it.

### What the browser check does

The page object `window.__easy68k` (development builds only) is used to READ state for the
comparisons. Actions go through the interface (menus, toolbars, chords, dialogs, the Files panel, the
listing gutter, the mouse wheel), with three declared exceptions that a student does by typing or by
the Files panel and that the packages' own checks cover: a source file is written into the store
(`ctx.vfs.writeFile`), opened in the editor (`ctx.documents.open`, what the Files panel's
double-click calls), and the caret is placed in the editor before typing (the view's `dispatch`). The
production build has no page object: its part uses the interface alone.

- **examples**: Help > Examples...; each of the ten official examples is double-clicked in the Files
  panel, F9 (the key map's chord) gives 0 errors and 0 warnings, the `.L68` in the store equals the
  official EASy68K's (`tests/conformance/asm/golden/official/<name>/default.L68`) but for its
  `Created On:` line, the `.S68` equals it byte for byte; Execute loads it in a new simulator (a cold
  start, counted with `onEngineReplaced`); Run ends as in the headless session of 6.4 (halted, or
  waiting for input) with the same Output panel text, or keeps running like it; `fileio.X68` leaves no
  file behind; the sounds `graphicSound.X68` starts are timed (every `AudioBufferSourceNode.start` is
  recorded, observation only), and so are the calls of `ProgramFiles.read` its sound tasks make.
- **cycle**: `pen.X68` prints the pen position it finds and its version, then moves the pen. Three
  times: type a new version digit, F9, Execute, Run. Each prints `0,0 version n` (a fresh simulator)
  and each Execute replaces the engine. Control: File > Open of the same program over the finished run
  prints `123,45`, so the three results do prove a cold start.
- **settings**: the official `settings.dat` and `sim68K.dat` (E4's fixtures from the official
  installer) imported through Options > Import/Export Settings and the port's Open dialog;
  Simulator Options > Enable Exceptions; both files exported; in a NEW browser profile the exports are
  imported, give the same settings, export again to the same bytes, and the first and second Execute
  of a program both run with exceptions on (engine option and status bar).
- **logging**: `l04-print.X68` (T3's log program); Options > Log Output... (Instruction and Registers,
  Text Only); Log Start; Trace Into to the halt; `Current Log Stopped.`; the execution log and the
  output log in the store equal the official EASy68K's (`tests/conformance/sim/golden/logs/
  l04-print.log2o.*`) line for line, the date masked.
- **files**: a program writes `written.txt`, closes it, opens and reads it back and prints it; the
  bytes are in the store next to the program, and the Files panel lists it.
- **breakpoint**: tutorial1, scrolled with the mouse wheel to `lea textD3,a1`, a gutter click; Run
  stops there with two lines printed and the row selected; Run again goes to the halt.
- **replace**: a program prints `12341234`; the key map's Replace chord, Replace All `#1234` with
  `#4321`, `End of document reached.`; F9, Execute, Run print `43214321`.
- **error**: a program with `TRAPP #15` in line 4: Errors 1, Execute disabled; the Messages panel row
  `4 / ERROR: Invalid opcode` and the marker on the line; a double-click selects the line; typing the
  correction over it; F9 gives 0 errors; it runs.
- **include**: `main.X68` INCLUDEs `strings.X68` next to it in the store.
- **windows**: two pages of one browser profile: a file saved in one (Ctrl+S / Cmd+S) is in the other's
  store and opens there with the edit; both windows run their own program at the same time in their
  own simulator; Enable Exceptions in one reaches the other's settings.
- **reopen**: a program runs, a document is changed, the page is closed without its unload handlers;
  a new page offers the draft (`Unsaved changes from your last session were found for pen.X68.`),
  Restore brings the edit back; the assembled program is still in the store; no program is loaded.
- **commands**: in each of the three modes, every command id of that mode and of `app` has a handler
  (`ctx.commands.hasHandler`); and no id at all lacks one.
- **subpath**: the production build under `/easy68k-cross-platform/`, as `pages.yml` builds it: Help >
  Examples..., `tutorial1.X68` from the Files panel, the toolbar's Assemble, Execute, Run print its
  four lines; no request leaves the sub-path or misses a file; no console error.

## 2. Results

Times are local (UTC-5), 21 November 2026. Results that came and went are listed with both times.

| Run | When | Result |
|---|---|---|
| `check-wave2.mjs --browser all` (log `build/I2/w2-run7.log`) | 15:19-15:30 | **182 of 183**. The one failure is finding 2 (Chromium). Commands: 97 ids, none without a handler, in all three modes, both browsers. No console error in any part. |
| `check-wave2.mjs --browser chromium --only examples` (`w2-run8.log`) | 15:36 | 41 of 42: finding 2 again; the read counter of finding 3. |
| `check-wave2.mjs` earlier runs | 14:47-15:14 | 82 of 88 (Chromium), then 163 of 181 (both): `sim.view.log` without a handler (since repaired by U4), finding 2, and faults of the check itself (WebKit on Windows has no `AudioBufferSourceNode`, so the observation hook threw in every WebKit page; a virtualised listing row; the drafts offer looked for with the wrong role), all repaired. The run of 15:05-15:15 was cut off by the PC's restart. |
| `scenario.test.ts` (Node; `node-run6.log`) | 15:31-15:34 | 10 tests: 8 passed, 1 failed (finding 1), 1 skipped (the engines guard, which only runs when `engine/dist` is missing). |
| `check-wave1.mjs --browser all` (`wave1-run2.log`) | 15:30-15:35 | **268 of 268** (also 268 of 268 at 14:08). |
| `EASY68K_CONFORMANCE_PARTS=final npx vitest run --config tests/conformance/sim/vitest.config.ts` (T3's request) | 15:27 | 6 files, 247 passed, 4 skipped, 0 failed: SH6's ProgramFiles and U4's LogService agree with the official goldens on every program (at 14:45 it failed on a stale entry of `known-differences.json`, since removed by T3). |
| `npm run typecheck` | 15:27, 15:44 | At 15:27 it failed outside I2's paths (`tests/conformance/sim/compare.test.ts(32,11): error TS2375`, T3, being edited); green at 15:44. |
| `npx eslint tests/integration`, `npx prettier --check tests/integration docs/integration` | 15:27, 15:44 | Clean. |

What the application does, part by part (Chromium and WebKit agree unless said):

- Every official example opens from the Files panel, assembles with F9 to the official `.L68` (but its
  date line) and `.S68` byte for byte, executes in a new simulator and runs to the same end with the
  same Output panel text as the headless session (tutorial1 and MACRO halt with their text, tutorial2
  to 4 wait for input, fileio halts and leaves no file, the two clocks and mouseWindowSize keep
  running, graphicSound halts). Under Node the same, and the `.L68` is equal including its date when
  the clock is set to the official file's.
- Edit, assemble, Execute three times: each run prints `0,0 version n` and each Execute replaces the
  engine; File > Open over a finished run prints `123,45`.
- Settings: the official files import; Enable Exceptions; the exports, imported into a new profile,
  give the same settings and export again to the same bytes; both Executes there run with exceptions
  on. Under Node the first Execute after an import does not obey it (finding 1).
- Logging: the execution log (type 2, 171 lines) and the output log written into the store are line
  for line the official EASy68K's for the same program, date masked, in both browsers and under Node.
- The file program, the breakpoint, Replace All before F9, the error (message, marker, double-click,
  correction), the INCLUDE, two windows (a saved file, two simulators at once, a setting), closing and
  reopening the page (the draft offered and restored): all pass in both browsers.
- The preview's sub-path build: tutorial1 opens, assembles, executes and runs with its four lines in
  both browsers; no request leaves `/easy68k-cross-platform/` or misses a file; no console error.
- Commands: 97 ids; in each mode every id of the mode and of `app` has a handler.

Screenshots looked at (15:30-15:40): every example after its run, the error page (marker on line 4,
the Messages row `4 / ERROR: Invalid opcode`), graphicSound's drawing in WebKit, the sub-path build in
WebKit (tutorial1's four lines), settings, logging, breakpoint, windows and reopen. They show what the
checks say.

## 3. Findings, most serious first

Each has one owner. None was repaired by I2.

1. **A cold start skipped by 4.7.1 does not apply settings changed since the last one; and whether it
   is skipped depends on timing** (SH8, minor: hidden in today's browsers, real under Node and in any
   window whose frames do not run). Reproduced 14:37, 15:25 (a probe, `build/I2/probe-settings-skip.log`)
   and 15:33 (`scenario.test.ts`, "settings ..."): a new window imports `sim68K.dat` with Enable
   Exceptions on and execution log type 2, F9, Execute; that Execute finds `pristine` set, skips the
   cold start, and the engine keeps exceptions 0 and log type 0, Log Start stays disabled; the second
   Execute obeys (`expected { first: { exceptions: 1, execLogType: 2, logStart: true } }, received 0,
   0, false`). `app/src/core/run/controller.ts:566` returns early on `this.live && this.pristine &&
   partsUntouched()`; 4.7.1 allows the skip only when "nothing has been loaded, run or changed since
   the last one", and step 4 (apply the saved SimSettings) is then skipped too. The original's Execute
   starts a new SIM68K.EXE that reads `sim68K.dat`. The probe also shows why it is timing-dependent:
   every engine call clears `pristine` (`call()`, line 1283), including the read-only
   `readOptions` that LogService queues after each cold start; once a display frame has delivered it,
   no Execute is ever skipped (so in the browsers the skip is dead code, which hides the defect), and
   before that frame it is skipped. Repair: clear `pristine` when `SimSettings` change (subscribe to
   the settings service), or apply `lifecycle.applySettings(engine)` on the skipped path; and do not
   let a read-only engine call count as a change (or drop the skip). Add a controller test: settings
   changed, then `open(..., 'execute')` without a cold start, the engine has the new options.

2. **graphicSound.X68: 0.wav starts while 1.wav is still sounding** (SH5, minor). Chromium, every run
   (14:51, 14:57, 15:20, 15:36): the recorded `AudioBufferSourceNode.start` calls give 0.wav 197-250 ms
   after 1.wav, which lasts 302 ms (15:20: `1.wav@26278+0-0, 0.wav@26475+0-0, roger.wav@26878+0-0`).
   The program asks task 72 again and again until the standard player is free; `SoundDevice` counts
   the player busy for the sound's length from the REQUEST on `ctx.clock`, which is right (Node,
   virtual time: 0.wav 304 ms after 1.wav, roger.wav 368 ms after 0.wav). The Web Audio backend
   (`features/audio/webaudio-backend.ts`) started 1.wav 50-100 ms after the request (task 71 had just
   loaded the slot and it was still decoding) and, because the delay was under `LATE_START_S` (0.2 s),
   from its beginning (offset 0): so 1.wav sounds until 50-100 ms after the device has declared the
   one-voice standard player free, and the next sound overlaps it. The program sees the right busy
   flag; a student hears two sounds of a one-voice player at once. Repair (SH5's choice): for the
   standard player, whose end the program observes, start a late sound part-way by its lateness (as it
   already does above 0.2 s), or stop the standard voice when the device starts the next one; or note
   it in `docs/differences/SH5.md` if the overlap is accepted. WebKit: no audio context runs in
   Playwright's headless WebKit on Windows, so nothing could be timed there (a note, not a finding).

3. **ProgramFiles.read copies the whole file at every try of graphicSound's last wait loop** (SH6,
   minor; SH5 asked for this measurement). The loop `playr` asks task 70 for `roger.wav` until the
   player is free (about 356 ms), and the sound device reads the file through `ProgramFiles.read` at
   every try, as the original tests `FileExists` each time. Measured in the application: Chromium
   15:36, **21,162 calls in that wait, 184.6 ms of main-thread time (mean 9 us), 224 MiB of copies
   returned**; under Node (15:33, real `CachedSyncFiles`, virtual time) 73,602 calls, 4.25 s of real
   time (mean 58 us). In Chromium roger.wav then started 415 ms after 0.wav instead of about 356 (it
   also has to be decoded, so not all of the 59 ms is the reads). Half of the wait's main-thread time
   and a quarter of a gigabyte of garbage for one wait loop is what SH5's note warned of. Repair (SH6):
   let `read` return the view's committed bytes without a copy when they have not changed since the
   last call (the contract only says it "sees committed bytes"; the device does not change them), or
   offer the device a cheap existence test so that it reads only when the player is free (that part
   would be SH5's, with a contract addition by the contracts engineer).

Repaired during this round (seen failing, then passing):

- `tests/conformance/sim/compare.test.ts` did not typecheck (T3): `npm run typecheck` at 15:27 gave
  `compare.test.ts(32,11): error TS2375 ... 'Mismatch' with 'exactOptionalPropertyTypes: true'`; at
  15:44 `npm run typecheck` is green (a file T3 was in the middle of editing).
- `sim.view.log` had no handler, so View > Log was disabled (U4): seen 14:53 and 15:05 in both
  browsers; U4 gave it its handler; 97 of 97 ids have one at 15:22 and 15:28.
- `known-differences.json` listed the a47 serial difference after W1 had repaired it (T3): seen 14:45;
  green at 15:27.

What the latest CI run on main shows (run 44937920498, commit `fdabb2b`, 18:52 UTC; read 15:20):

- `Integration scenario in the browser (I1)` (`check:wave1`) failed on all three systems with 256 of
  268: the toast for Help > Examples and the "PC row after the load" expectation. Both are the
  check's, repaired in this round (section 5); 268 of 268 here. The next CI run will show it.
- Owners outside I2, for their information: `conformance` fails on Ubuntu and macOS on GDI cases
  clip-00202, -00217, -00230 (SH1, pending `docs/requests/SH2-ellipse-mode.md`); `Shell check (W3)` on
  macOS WebKit fails "Ctrl+Z in a text field undoes the cut" twice (W3); `browser-checks (windows-latest,
  interface)` hit the 45-minute job limit (configuration engineer).

## 4. The desktop development build

I2 cannot start Electron on this PC (no window may open). What DV2 must add to `tests/desktop/dev`
so that the CI job `desktop-dev` runs the same scenario:

- A spec `tests/desktop/dev/scenario.spec.ts` that launches the development app with
  `launchDesktop({ devServer })` and `warmUpDevPage(page)` from `harness.ts` (the development page has
  `window.__easy68k`, as `windows.spec.ts` uses), and imports the programs and goldens from
  `tests/integration/wave2/programs.ts` (plain data and Node file readers; no change needed there).
- Its steps, on the window's page, with the same actions and comparisons as `check-wave2.mjs`'s
  parts: `examples` (Help > Examples... copies the examples into the store and reveals them; on the
  desktop the store may be the granted disk folder: use the path the Files panel reveals), `cycle`,
  `settings` (the Import/Export dialog; in the desktop build the Open and Save dialogs may be the
  native ones: drive them through the main-process test hooks DV2 already has, or put the files where
  the dialog opens), `logging`, `files`, `breakpoint`, `replace`, `error`, `include`, and `windows`
  with `app.window.new` instead of a second page. The headless outcomes come from
  `tests/integration/wave1/fixtures.ts` (`assembleExample`, `runHeadless`), which Playwright's test
  runner can import under Node.
- What the job would then prove, on macos-15: the same student path works in the Electron shell
  under `app://` with the native menu (F9 through the menu's accelerator as well as the page's
  dispatcher), the desktop file system (`DiskBackend`, `DiskSyncFiles`) for the program's files, the
  logs and the include, and two native windows with their own simulators; what it would not prove is
  sound (no audio device on the runner).

## 5. Entries of the gate papers addressed to I2

| From | Entry | What was done |
|---|---|---|
| carried from I1 (minor, I2) | check-wave1 expects a toast for Help > Examples | Done: the check now asks that the Files panel is shown with the Examples folder selected (W1-files-reveal-arg.md), and opens the folder only if the reveal did not; 268 of 268 at 14:08 and 15:35. |
| gate I1 round 3, engine (W4) | let the tour's "listing highlights the row of the PC" accept no row when the PC field keeps its text | Done: the check now asks for the PC row when the start address differs from the PC shown before the load, and for no row at all when it is the same (sim-ui 6.4, errata U1.md 8, W4.md 9); any other row fails. |
| SH5 | graphicSound and clockWithSound with the real ProgramFiles in the application; 0.wav 302 ms after 1.wav, roger.wav 356 ms after 0.wav | Done under Node (304 ms and 368 ms of virtual time, within one frame) and in Chromium (finding 2). clockWithSound runs in both browsers without console errors; its ticks were not timed. |
| SH5 | measure the cost of ProgramFiles.read in graphicSound's wait loop | Done: finding 3 (both the browser check and the Node scenario print the figures at every run). The stopped I2's note that the loop does not read was wrong: the `playr` loop polls task 70 for the whole of 0.wav. |
| T3 | run the conformance suite with `EASY68K_CONFORMANCE_PARTS=final` | Done: 247 passed, 0 failed at 15:27. |
| SH2 | confirm the location of `tests/conformance/gdi/golden/ellipses*.pixpack.gz` | Confirmed: the three files are tracked at that path since commit 5c13516. |
| FS2 | rerun the revalidate acceptance with SH6's CachedSyncFiles on a FolderBackend over an origin private file system handle | Not done in this round: it is an acceptance item of FS2 and SH6's pairing that needs its own browser harness (check-fsaccess.mjs's OPFS route); the scenario here runs on the browser store. Who must act: FS2 adds it to check-fsaccess.mjs with the real CachedSyncFiles, or the next I2 round. |
| E5, E6, U3 | test hooks and per-window models | Used as described (asm.status dialog, selectors, find dialogs non-modal, breakpoints emptied by Execute). |
| B1, gate I1 config | read CI logs of the next run | Run 44937920498 (commit fdabb2b) read at 15:20: section 3, last part. Its `EASyBIN check (B1)` on macOS interface passed. |

## 6. What could not be run, and why

- The desktop development build (section 4): Electron may not be started here.
- Sound in WebKit: no audio context runs in Playwright's headless WebKit on this PC.
- macOS and Linux: only CI can run the check there; nothing in it depends on Windows. `check:wave2` is
  not yet in CI (section 1 says how to add it).
- FS2's OPFS revalidation (section 5).
- The whole `npm test`: not run by I2 in this round (`app/src/engine/sim.test.ts` ran out of memory
  after the restart, the engine's engineer repairs it first); I2's own suites were run by path.
