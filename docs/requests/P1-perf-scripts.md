# Request from P1: run the performance measurements and their unit tests (gate I3)

Status: open (for gate I3).

P1 (`docs/ARCHITECTURE.md` 9.6) owns `tests/perf/**`. Two things there are not picked up by any
runner, because the root `package.json`, `tests/vitest.workspace.ts` and `ci.yml` are frozen:

- `tests/perf/vitest.config.ts`: the unit tests of the folder under Node (the verdicts of the
  check, and the four fixed programs on the real engines with virtual time). They need
  `engine/dist` and follow the `EASY68K_REQUIRE_ENGINES` rule. About 10 s.
- `tests/perf/check-perf.mjs`: the measurements of 6.9 item 9 in the real application in headless
  Chromium and WebKit, after the convention of `app/src/ui/shell/check-shell.mjs` (Vite dev server
  on a free port, `--browser chromium|webkit|all`, `--out <dir>`, "N of M checks passed", screenshots
  and `perf.json` below `build/P1/perf-check`). It also takes `--judge auto|strict|report`,
  `--only <part>` (assembly, calibrate, taskduration, maximum, frames, surface) and `--runs <n>`.
  About 10 minutes for both browsers. The thresholds of 6.9 item 9 are judged on Chromium on Linux
  only (where 6.9 sets them); on macOS, Windows and in WebKit the same figures are printed with
  "would pass" or "would MISS", and only what the program observes (its own clock, its pixels, the
  4096 x 4096 surface) is judged.

Requests:

1. **Root `package.json`**: a script `"check:perf": "node tests/perf/check-perf.mjs"`.
2. **`tests/vitest.workspace.ts`**: add `'perf/vitest.config.ts'` to `PROJECT_GLOBS`, so that
   `npm run test:conformance` runs the unit tests (or a root script
   `"test:perf": "vitest run --config tests/perf/vitest.config.ts"`, whichever the gate prefers).
3. **`ci.yml`**: a job (or a step of `browser-checks`, group `simulator`) that runs
   `npm run check:perf -- --browser ${{ matrix.browser }}` on `ubuntu-latest`, `macos-latest` and
   `windows-latest`, with `engine/dist`, guarded by `needs.engines.outputs.available == 'asm sim'`
   like `check:run`. It needs about 5 minutes per browser. If the gate wants it shorter on the
   pull-request path, `--only surface --only calibrate` (about a minute) is the functional half;
   the full run then belongs to the schedule and to I3's definition-of-done evidence. Upload
   `build/P1/perf-check/perf.json` as an artifact: it holds every figure of the run.
