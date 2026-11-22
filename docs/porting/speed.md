# Speed of the port, and of the original

Owner: P1 (`docs/ARCHITECTURE.md` 9.6). This document records how fast the port is, how that was
measured, what the definition of done (6.9 item 9) asks and where the port meets it, what is known
of the original's speed (decision O-1), and what P1 proposes to the owners of the constants. P1
changes no constant itself: it measures and proposes.

Two kinds of figure are kept apart throughout:

- **What a program observes**: its own clock (TRAP #15 task 8), its instruction count, its pixels.
  These are exact by design: at the default setting the governor grants 1,000,000 instructions per
  second of real time (4.2, 4.5.6), on every machine that keeps up.
- **Wall-clock figures**: frame intervals, the main thread's busy time, the rate at `Maximum`, the
  time to assemble. These are properties of the machine, the browser and whatever else runs.

## 1. The tools

| File (`tests/perf/`) | What |
|---|---|
| `calibrate.X68` | Instructions per second by the program's own clock. Runs a counted loop for at least ten seconds of task 8 time, then shows `instructions executed`, `hundredths of a second` and `instructions per second`, leaves them in D4, D3 and D7, and writes the same three lines and `END-OF-DUMP` to `result.bin` beside itself. Every instruction is counted, the TRAP that reads the clock included; a block is 50,009 instructions. For O-1 (section 5) |
| `spin.X68` | A busy loop that never ends (6.9: TaskDuration, `Maximum`) |
| `draw.X68` | Continuous double-buffered drawing with no delay: per pass a clear, eight filled rectangles, a line, a filled ellipse and task 94; about 70 instructions per pass (6.9: frame intervals) |
| `surface.X68` | Task 33 to 4096 x 4096, task 11 clear, a flood fill from the centre that paints every pixel, two task 83 reads and the size, with task 8 times between the steps |
| `check-perf.mjs` | The measurements in the real application in headless Chromium and WebKit (its header has the details). `node tests/perf/check-perf.mjs [--browser chromium\|webkit\|all] [--judge auto\|strict\|report] [--only <part>]... [--runs <n>] [--bounded-subslice <ms>]` |
| `perf-verdicts.mjs` | Statistics and verdicts of the check (unit-tested in `perf-verdicts.test.ts`) |
| `programs.test.ts` | The four programs on the real engines under Node with virtual time: they assemble with no error or warning; calibrate reports 1,000,180, 250,045 and 3,330,599 instructions per second at the settings 1,000,000, 250,000 and 3,333,333 (within the 10 ms steps of task 8), and its own 68000 division gives exactly the integer quotient; spin runs at the governed rate; draw draws; surface fills all 16,777,216 pixels |

`npx vitest run --config tests/perf/vitest.config.ts` runs the unit tests (about 10 s).
`docs/requests/P1-perf-scripts.md` asks gate I3 for a root script `check:perf`, for the unit tests
to be picked up by `test:conformance`, and for a CI job.

**Frame sources.** The 60 Hz and 120 Hz sources are simulated, as 3.11.1 provides for tests: an init
script replaces the page's `requestAnimationFrame` with a timer on a grid of 1000/60 or 1000/120 ms
that skips the slots the page was too busy for, as a display does; the application's scheduler runs
on it unchanged (errata P1.md entry 1). The display's own frames (headless Chromium: 60 Hz) are
measured as well; on ubuntu-latest they are what 6.9 calls "60 Hz".

**Judging.** The thresholds of 6.9 item 9 are judged in Chromium on Linux, where 6.9 sets them; on
Windows, macOS and in WebKit the check prints "would pass" or "would MISS" (errata P1.md entry 2).
What the program observes (calibrate's whole blocks and its division, the pixels of the 4096 x 4096
surface) is judged everywhere; calibrate's rate of 1,000,000 per second at the default speed is a
threshold like the others, judged in Chromium on Linux only. Each timed figure is the
best of up to three runs (30-second windows: two), and every run is printed: a run on a busy machine
can only be slower, so the best run is the figure of the machine.

## 2. Where the figures were taken

Windows 11, Intel Core i7-12700KF (12 cores, 20 threads), 64 GB, Node 24.19, Playwright's Chromium
and WebKit (Windows builds), 2026-11-21. The PC was **heavily loaded** throughout: other engineers'
builds and browser checks, four GitHub Actions runner containers, several PostgreSQL containers and,
during run 1, the Wine oracle of section 5. The load shows: the simulated 60 Hz source alone, with no
program running, had a 95th percentile of 34 to 37 ms instead of 16.7 ms in run 1, and the same
measurement repeated minutes apart differed by up to a factor of two. **None of these figures is a
figure of ubuntu-latest**; 6.9 item 9 is decided there, by the check, in CI.

Two full runs of `check-perf.mjs --browser all` were made (run 2 with the diagnostic figures of
section 4.4) and one experiment (section 4.1). Each full run printed "42 of 42 checks passed" (on
Windows no wall-clock threshold is judged); the experiment printed "12 of 12". The logs are
`build/P1/run1.log`, `run2.log` and `experiment.log`; `build/P1/perf-check/perf.json` holds every
figure of run 2.

## 3. The figures of 6.9 item 9

Best run of each measurement; the other runs in brackets; "r1" and "r2" are the two full runs, "r3"
a last run of the frame measurement in Chromium alone (one run per source) at a quieter moment, when
the simulated 60 Hz source with no program running had a 95th percentile of 18.2 ms instead of 34 to
37 ms.

| 6.9 item 9 | Threshold | Chromium, this PC | WebKit, this PC | Here |
|---|---|---|---|---|
| TaskDuration over 30 s of `spin.X68`, default speed, display frames (60 Hz) | < 4.5 s | r1 4.24 s; r2 4.72 s (5.46) | not available (Chromium protocol) | at the limit |
| the same, simulated 60 Hz | < 4.5 s | r1 2.43 s; r2 2.64 s (5.09) | - | would pass |
| the same, simulated 120 Hz (for information) | - | r1 5.93 s; r2 4.41 s | - | about the limit (4.3) |
| frame intervals while `draw.X68` runs, display (60 Hz): p95 | < 20 ms | r1 50.0 ms; r2 16.8 ms (33.3); r3 16.7 ms | r1 146 ms; r2 90 ms (113, 196) | passes when the PC is quieter (4.1) |
| the same, simulated 60 Hz: p95 | < 20 ms | r1 46.3 ms (50.2, 54.2); r2 28.1 ms (28.4, 30.0); r3 17.9 ms | r1 51 ms; r2 47 ms | passes when the PC is quieter (4.1) |
| the same, simulated 120 Hz: p95 | < 12 ms | r1 40.1 ms (41.9, 45.4); r2 24.2 ms (28.9, 37.0); r3 17.0 ms | r1 55 ms; r2 36 ms | would **miss** (4.1) |
| `stepCount` at `Maximum` in 10 s, simulated 60 Hz | >= 200,000,000 | r1 121,071,183 (109.6 M, 68.4 M); r2 106,451,741 (103.8 M, 61.7 M) | r1 75,236,769; r2 72,181,963 | would **miss** (4.2) |
| the same, simulated 120 Hz | - | r1 69,828,549; r2 85,449,819 | r1 69,133,733; r2 81,891,003 | would miss |
| assembling the largest corpus file under Node: `GFX.X68`, 2,438,385 bytes, 33,096 listing lines | < 1 s | r1 365 ms; r2 281 ms; a separate run 268 ms. Cold, in a new Node process, with importing and compiling the engine: 394 to 654 ms | - | would pass |
| assembling `MAIN.X68`, which includes `GFX.X68` (40,623 listing lines) | < 1 s | r1 415 ms; r2 364 ms; separate 287 ms. Cold 371 ms (one outlier of 2,796 ms under load) | - | would pass |

What the program observes, judged everywhere and passing in both browsers in both runs:

| | Chromium | WebKit |
|---|---|---|
| `calibrate.X68` at the default speed, by its own clock | r1 993,192; r2 995,179 per second (-0.7 %, -0.5 %) | r1 928,103 (-7.2 %); r2 994,184 (-0.6 %) |
| `calibrate.X68` at `Maximum`, by its own clock | r1 7,501,350; r2 5,996,103 per second | r1 3,572,071; r2 2,690,172 |
| its arithmetic (whole blocks, 32-bit quotient) | exact | exact |

A rate below 1,000,000 at the default setting is the governor's design, not an error: time without
frames is made up only up to `MAX_CATCHUP_MS` = 50 ms (4.2; errata SH8.md entry 30). WebKit's timers
on Windows have a resolution of about 15 ms (the simulated 120 Hz source gave intervals with a median
of 15 ms there; errata P1.md entry 10), and on the loaded PC its frames were often more than 50 ms
apart. Under Node with virtual time the program reports the rate within the 0.2 % that the 10 ms
steps of task 8 allow (section 1).

## 4. What the figures mean, and proposals

### 4.1 Frames while a program draws continuously (6.9: p95 < 20 ms at 60 Hz, < 12 ms at 120 Hz)

**Finding.** The governor looks at the clock only between two `engine.run(n)` calls; `n` is a
sub-slice of up to `SUBSLICE` = 2000 instructions at the default speed (4.2). For plain instructions
a call takes a fraction of a millisecond, but a TRAP #15 drawing task is far dearer than an
instruction. Measured in run 2 while `draw.X68` ran (2000 instructions = about 28 passes, each with
a clear and a copy of 640 x 480): a call took 1.8 ms on average, but its 95th percentile was 12 to
21 ms and the longest 25 to 98 ms, and the engine took 650 to 710 ms of every second in Chromium
instead of the 500 ms that `SLICE_FRAME_SHARE` = 0.5 allows. The budget rule ("do not start another
call when the frame's 8 ms are used") cannot stop a call that is already running, so the frame
overruns by up to one call. The result in Chromium under load: median frame 17.7 to 19.6 ms, 95th
percentile 24 to 54 ms; WebKit worse. At the quieter moment of r3 a call's 95th percentile was 5.6 to
6.4 ms (longest 8.9 to 10.4 ms): the 60 Hz thresholds were met (p95 17.9 and 16.7 ms), but at 120 Hz,
where the budget is 4.2 ms, a single call is longer than the whole budget and the 95th percentile was
17.0 ms against the 12 ms of 6.9. So on a quiet runner the 60 Hz figure may pass as the port is; the
120 Hz figure cannot, by construction.

**What the original does.** The original runs one instruction, then pumps its message queue twice,
so its window never waits for more than one TRAP. A program that draws continuously keeps the
original's window responsive; in the port it makes the interface stutter. Nothing a program can
observe is involved (the program's figures stay exact); this is the interface's responsiveness.

**Proposal to SH8** (owner of `app/src/core/run/governor.ts` and `controller.ts`): bound a sub-slice by
time as well as by instructions. After each `engine.run(n)` the controller knows how long it took;
the next `n` can be `min(subslice(ips), floor(allowance), max(1, floor(remaining budget / measured
milliseconds per instruction)))`, with the cost per instruction smoothed over the last few calls. A
program of plain instructions keeps sub-slices of 2000 (they take well under a millisecond); a
drawing program gets sub-slices of a few passes. The rule about input edges (one edge per
`subslice(ips)` executed instructions, 4.3) counts instructions, not calls, and is not affected.

**The experiment.** `check-perf.mjs --only frames --bounded-subslice 1` shows the effect without
changing the application: while `draw.X68` runs, every `engine.run(n)` of the controller is carried
out in calls of 16 instructions and ends after 1 ms (the controller sees fewer instructions executed,
exactly as with a smaller `n`). Same PC, minutes after run 2:

| Chromium | as the port is (run 2, best) | sub-slices bounded to 1 ms |
|---|---|---|
| simulated 60 Hz: p95 / median / longest frame | 28.1 / 18.1 / 78.6 ms | **17.7** / 16.6 / 18.8 ms |
| simulated 120 Hz: p95 / median | 24.2 / 17.7 ms | **12.5** (12.7, 15.9) / 11.4 ms |
| display (60 Hz): p95 / longest | 16.8 / 33.4 ms (other run 33.3) | **16.7** / 16.8 ms |
| engine time per second | 650 to 710 ms | 510 to 550 ms (one run 955 ms) |
| longest single call | 25 to 66 ms | 2.2 to 14.7 ms |
| passes of `draw.X68` per 5 s | 3,225 to 4,086 | 3,827 to 4,420 |

With the bound, the 60 Hz threshold is met on this loaded PC and the 120 Hz one is missed by half a
millisecond; the program also draws more passes, because frames stop overrunning. WebKit on Windows
did not improve measurably (its 15 ms timers and the load dominate; errata P1.md entry 10). P1 has
not changed the controller; when SH8 does, the check shows the effect without the experiment flag.

### 4.2 `Maximum`: 200 million instructions in 10 s

**Finding.** 6.9 asks for an average of 20 million instructions per second. The governor gives the
engine at most `SLICE_FRAME_SHARE` = half of each frame (4.1, 4.2), so the engine itself would have
to run at 40 million per second. Measured: the engine alone (`run(1,000,000)` through
`controller.invoke`, no governor, best of five) executes `spin.X68` at **23.4 million** instructions
per second in Chromium and **21.7 million** in WebKit, and at about 28 million under Node. Half of
that is 117 and 109 million in 10 s, which is what the best runs reached (106 to 121 million in
Chromium, 72 to 82 million in WebKit). 4.5.6's "tens of millions" holds, but not by the factor the
threshold assumes. At 120 Hz the per-frame overhead is paid twice as often and the figure is lower.

**Proposal to the architect** (6.9 and 4.1 are the architect's): lower the threshold to what half a
frame gives on ubuntu-latest (the check prints both the figure and "the engine alone"), for example
"at least 100 million in 10 s"; or let `Maximum` take a larger share of the frame (for example
`SLICE_FRAME_SHARE` 0.75 at `Maximum` only), which is SH8's constant. P1 recommends the first:
`Maximum` exists for long computations (4.5.6), and the interface's half of the frame is what keeps
the window usable while one runs.

**Since the time-bounded sub-slice** (errata SH8.md entry 40, round before gate I3) the figures of
this PC at a quiet moment are above the threshold (section 4.6: 236.9 million in 10 s with the
simulated 60 Hz source, 248.0 million at 120 Hz, best of three runs). These are figures of a Windows
PC, not of ubuntu-latest: 6.9 item 9 is decided there, by the performance job of a manual CI run,
and this document does not claim it. The proposal above stands until that run has been read.

### 4.3 TaskDuration (6.9: < 4.5 s in 30 s at the default speed)

At the default speed the engine needs about 1,000,000 / 23,000,000 = 4 % of a core, 1.3 s of 30 s.
The rest of TaskDuration is the work done once per frame: the controller's tick, the store update,
the Output panel's look at the surface, the React renders that follow, and with the display's frames
the browser's own rendering of each frame. With the simulated 60 Hz source that came to 2.4 to 2.6 s;
with the display's frames 4.2 to 4.7 s, at the threshold; at 120 Hz 4.4 to 5.9 s. The figure is
therefore close to the limit on this loaded PC and depends on the frame rate; 6.9 does not say at
which rate the threshold applies (errata P1.md entry 3).

**Proposal to SH8 and SH4** (owners of the per-frame work): publish to the store and present only
when something changed (a busy loop that prints nothing changes nothing between frames), which makes
the figure independent of the frame rate and gives ubuntu-latest a margin.

### 4.4 Diagnostic figures of run 2

| | Chromium | WebKit |
|---|---|---|
| engine alone, `spin.X68`, `run(1,000,000)` | 23,419,204 per second | 21,739,130 per second |
| `draw.X68`, simulated 60 Hz: `engine.run()` calls per second, instructions per call | 356 to 377, 2,000 | 189 to 234, 2,000 |
| the same: engine time per second; one call p95; longest call | 658 to 662 ms; 15.8 to 18.2 ms; 24.8 to 65.5 ms | 375 to 408 ms; 17 to 26 ms; 35 to 63 ms |
| `draw.X68`, simulated 120 Hz: engine time per second; one call p95; longest | 649 to 670 ms; 13.1 to 21.1 ms; 32 to 46 ms | 391 to 418 ms; 12 to 24 ms; 18 to 98 ms |
| `draw.X68`, display: engine time per second; one call p95; longest | 706 to 712 ms; 11.8 to 15.9 ms; 24.9 to 30.2 ms | 197 to 281 ms; 17 to 30 ms; 35 to 106 ms |
| under Node, `spin.X68`, `run(2000)` and `run(1,000,000)` (scratch measurement) | about 28 million per second for both: the cost of a call is not the problem | - |

### 4.5 The 4096 x 4096 surface (9.6 P1; R-13)

Resize, clear, flood fill and presentation **pass in Chromium and in WebKit**, in both runs and in
the earlier trial runs: task 33 reports `$10001000`; all 16,777,216 pixels have the fill colour; task
83 reads it at both corners; the Output panel's canvas is 4096 x 4096 and shows the colour at four
sampled points; there are no console errors. **`MAX_SURFACE` stays 4096** (SH1's constant in
`app/src/core/sim-host/surface/surface.ts`); no entry in `docs/differences/` is needed.

| (four runs) | Chromium | WebKit |
|---|---|---|
| resize (task 33), timed in the page | 18.5 to 64.5 ms | 21 to 29 ms |
| clear (task 11) | 8.6 to 72.8 ms | 7 to 15 ms |
| flood fill of 16.7 million pixels (task 89) | 28.5 to 70.3 ms | 48 to 195 ms |
| the same three, by the program's own clock | 0.01 to 0.07 s each | 0.00 to 0.20 s each |
| first presentation (`putImageData` of 4096 x 4096) | 32.7 to 54.4 ms | 53 to 133 ms |
| reallocating the canvas's backing store (`width`, `height`) | under 1 ms for the assignment itself | 1 ms |
| memory, by arithmetic | 64 MiB back buffer + 64 MiB canvas backing store (the `ImageData` is a view of the back buffer) | the same |
| memory of the browser processes, before -> after | +375 to +503 MiB (6 processes; 528 to 830 MiB -> 997 to 1,213 MiB) | +112 to +149 MiB (8 processes; 495 to 511 MiB -> 623 to 645 MiB) |
| Chromium's JS heap | 11 to 17 MiB before and after (the pixels are outside the JS heap) | - |

The process figures are the working sets of every process the check started, read from the system
(`Get-CimInstance` on Windows, `ps` elsewhere); Chromium's include its GPU process's copies of the
canvas. On macOS WebKit's web-content process is not a child of the check and is not counted there.

**R-13** ("no further action unless a measured frame exceeds 100 ms outside the calls the original
also blocks in"). One long frame follows Run: 267 to 867 ms in Chromium and 304 to 701 ms in WebKit,
once, at the first presentation after the resize; afterwards frames return to normal. It is made of
the calls the original also blocks in (resize, clear, flood fill: 58 to 207 ms together), one
`putImageData` of 64 MiB, the first drawing into the new 64 MiB canvas and its compositing (the rest,
roughly 150 to 600 ms, varies with the load). The original repaints its resized 4096 x 4096 window
in one `WM_PAINT` as well, so this is the counterpart of a call it blocks in, and it happens once per
resize. P1 proposes no action under R-13 and records the figure for I3.

### 4.6 Figures after the time-bounded sub-slice (round before gate I3)

The same PC as section 2, 2026-11-22, `engine/dist` unchanged, the application of the main tree
with errata SH8.md entry 40 (a sub-slice bounded by time as well as by count). The PC was **far
quieter** than in section 2: CPU load (all cores, as Windows reports it) 11 % before run A, 21 %
before run B and 66 % at the end of run B, when other work on the PC had started; run C came later,
after the other checks of the round. Run A: `node tests/perf/check-perf.mjs --browser chromium`
(every part, "24 of 24 checks passed"); run B, minutes later: the same with `--only maximum --only
frames` ("10 of 10"); run C: `npm run check:perf -- --browser all` ("42 of 42"). Logs:
`build/DOC1/perf1.log`, `perf2.log` and `checks/perf.log` (git-ignored). On Windows nothing of 6.9
item 9 is judged ("would pass" or "would MISS" is printed). **None of these is a figure of
ubuntu-latest**, where 6.9 item 9 is decided.

| 6.9 item 9, Chromium | Threshold | Run A | Run B | Run C | Best |
|---|---|---|---|---|---|
| `stepCount` at `Maximum` in 10 s, simulated 60 Hz | >= 200,000,000 | 233,073,332 | 236,878,626 | 227,756,095 | 236,878,626 |
| the same, simulated 120 Hz | - | 242,033,433 | 217,842,298 | 247,961,267 | 247,961,267 |
| the engine alone, `run(1,000,000)`, best of 5 | - | 54,644,809 per second | 54,644,809 | 51,546,392 | - |
| frame intervals while `draw.X68` runs, simulated 60 Hz: p95 | < 20 ms | 17.8 ms | 17.7 ms | 18.0 ms | 17.7 ms |
| the same, simulated 120 Hz: p95 | < 12 ms | 11.0 ms | 11.7 ms | 11.2 ms | 11.0 ms |
| the same, display (60 Hz): p95 | < 20 ms | 16.7 ms | 16.8 ms | 16.8 ms | 16.7 ms |
| `draw.X68`, one `engine.run()` call: p95 / longest (60 Hz, 120 Hz, display) | - | 3.5 / 5.4, 2.4 / 5.2, 3.1 / 5.3 ms | 4.2 / 5.8, 4.5 / 6.6, 4.7 / 6.5 ms | 3.3 / 7.6, 3.1 / 5.1, 3.8 / 5.5 ms | - |
| TaskDuration over 30 s of `spin.X68`, default speed: simulated 60 Hz, 120 Hz, display | < 4.5 s | 0.99, 1.17, 1.65 s | - | 0.85, 0.97, 1.38 s | - |
| `calibrate.X68` at the default speed, by its own clock | 1,000,000 (2 %) | 999,180 per second (-0.08 %) | - | 1,000,180 (+0.02 %) | - |
| `calibrate.X68` at `Maximum`, by its own clock | - | 21,263,826 per second | - | 21,633,893 | - |
| assembling `GFX.X68` / `MAIN.X68` under Node | < 1 s | 155 / 164 ms | - | - | - |

WebKit in run C, for information (6.9 item 9 does not judge it): `Maximum` 145,847,087 (60 Hz) and
187,813,779 (120 Hz) in 10 s, the engine alone 25,641,026 per second; frame p95 31.0 ms with both
simulated sources (its timers on Windows, errata P1.md entry 10) and 13.0 ms with the display's
frames.

What changed against section 3: the engine alone is more than twice as fast as in run 2 (51.5 to
54.6 against 23.4 million per second), which says how much of section 3's shortfall was the load of
that day; and with the bound, a drawing program's calls stay under 8 ms and the frames no longer
overrun (at 120 Hz the p95 of 11.0 to 11.7 ms is under the 12 ms, where section 3 had 17.0 ms at
best). The 4096 x 4096 surface passed again (longest frame after Run 100 ms, R-13).

## 5. The original's speed (decision O-1)

**What O-1 decided** (recommended default, accepted by the owner): the official `SIM68K.exe` may be
run on real Windows hardware once, **by the owner**, in Windows Sandbox or a disposable virtual
machine, with `tests/perf/calibrate.X68`. Until then `DEFAULT_IPS` = 1,000,000.

**Steps for the owner** (about five minutes):

1. Start Windows Sandbox (or a throw-away VM) on an ordinary Windows PC, the kind a student uses.
   Copy the official EASy68K v5.16.1 folder and `tests/perf/calibrate.X68` into it.
2. Open `calibrate.X68` in `EDIT68K.exe`, Project > Assemble Source (F9), then Execute.
3. In `SIM68K.exe` press Run (F9) and leave the windows alone for about 15 seconds.
4. Read the three lines in the output window (or `result.bin` beside the program). Repeat twice;
   the highest `instructions per second` is the figure. Note the PC (processor, Windows version) and
   whether it was a sandbox or a VM, and also try once while moving the mouse over the window, which
   the original is said to slow down for (sim-core 11.11).
5. Put the figures into this section. SH8 then sets `DEFAULT_IPS` (`app/src/core/run/governor.ts`)
   and the owner of `app/src/core/settings/defaults.ts` (W1) sets `DEFAULT_INSTRUCTIONS_PER_SECOND`
   to the same value (errata P1.md entry 6), rounded to two significant digits; DOC1 updates the user
   guide's sentence on timing.

**Measured under Wine. This is not the original's speed.** P1 ran `calibrate.X68` in the official
`SIM68K.exe` inside T1's and T3's container (`tests/oracle/wine`, Wine 8.0, Debian 12, one CPU per
container, Xvfb) with `node tests/oracle/wine/sim/regenerate.mjs --file tests/perf/calibrate.X68
--recipe report --out build/P1/wine/run<N>` (the official `EDIT68K.exe` assembled it with no error;
the `report` recipe starts `SIM68K.exe calibrate.S68 /r` and collects `result.bin`), three times:

| Run | Instructions | Hundredths | Instructions per second |
|---|---|---|---|
| 1 | 50,009 | 1410 | 3,546 |
| 2 | 50,009 | 1389 | 3,600 |
| 3 | 50,009 | 1603 | 3,119 |

That is **about 3,500 instructions per second**, several hundred times below the estimate of 0.3 to
3 million for Windows in 4.5.6. What it is: the speed of the official program inside this container
on this loaded PC. What it is not: the speed on a Windows PC. Every instruction is followed by two
pumps of the message queue (sim-core 11.11); under Wine each `PeekMessage` is a round trip to the
separate `wineserver` process, which here shares one CPU with the program, Xvfb and Wine's services,
and Wine's GDI draws into Xvfb. The figure does confirm that the original's speed is dominated by its
message pumps, not by the 68000 emulation, which is why it depends so much on the machine and on what
else the window does. It cannot replace the owner's measurement, and P1 does not base `DEFAULT_IPS`
on it.

**Proposed `DEFAULT_IPS`: unchanged, 1,000,000**, until the owner has measured. The estimate of 4.5.6
(0.3 to 3 million, unverified) brackets it, the user guide says it is an estimate, and every program
that keeps time with task 23 or task 8 behaves the same at any setting.

## 6. Proposals in one place

| To | What | Section |
|---|---|---|
| SH8 | Bound each sub-slice by the remaining time budget, not only by instructions (taken up in the round before gate I3: errata SH8.md entry 40) | 4.1 |
| Architect | 6.9's `Maximum` threshold: 200 million in 10 s needs an engine of 40 million per second; measured 22 to 28 million under load. Lower it (proposal: 100 million) or give `Maximum` more of the frame. On the quieter PC after the time-bounded sub-slice: 237 million (60 Hz) and 248 million (120 Hz), best of three runs (4.6); decide after reading the manual CI run's performance job on ubuntu-latest | 4.2, 4.6 |
| SH8, SH4 | Publish and present only when something changed, so that TaskDuration does not grow with the frame rate | 4.3 |
| Architect | Say at which frame rate the TaskDuration threshold applies (P1 judges it at 60 Hz) | 4.3 |
| Owner, then SH8 and W1 | Measure the original with `calibrate.X68`; until then `DEFAULT_IPS` = 1,000,000 | 5 |
| I3 | `check:perf` in CI (`docs/requests/P1-perf-scripts.md`, applied in the round before gate I3); on ubuntu-latest its verdicts are 6.9 item 9 | 1 |
