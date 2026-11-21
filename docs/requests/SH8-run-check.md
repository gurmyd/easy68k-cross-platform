# Request from SH8: run the browser check of the run feature in CI (gate I1)

SH8's acceptance list (ARCHITECTURE.md 9.2) is written for Node: "with the real engine,
`withFaults` and virtual time", and the unit tests under `app/src/core/run/` and
`app/src/features/run/` cover it. Three things only a browser shows: that the simulator engine
loads and starts in a page, that the governor and the delay of task 23 keep time on real display
frames and real timers, and that the status bar, the simulator's boxes and the Execution Speed
dialog look and work as intended. For those SH8 wrote a script in its own folder, after the
convention of `app/src/ui/shell/check-shell.mjs`:

```
node app/src/features/run/check-run.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It assembles two small programs with the real assembler, starts the Vite dev server of `app/` on
a free port (port 0, with a cache directory of its own and without file watching, so that it can
run next to other checks and next to people editing the tree) and drives the application in
headless Chromium and WebKit: start-up state and the status bar; a load from the browser store;
Run from the toolbar; F6, F7 and F9; the instruction rate at the default speed (measured against
the frames the run really had, best of three) and at Maximum; a task 23 delay of 50 units by the
program's own clock (best of three); the command states while running and after a halt; the Run
To Cursor box; the Caution question; the Execution Speed dialog with an axe-core scan; five cold
starts in a row; the dark theme; Exit; and `?open=<path>&run=1`. Screenshots go to
`build/SH8/run-check/` (git-ignored). It needs `engine/dist` and only the pinned development
dependencies. On the SH8 machine (Windows 11, busy with fourteen other builds): 64 of 64 checks
pass in Chromium and WebKit.

Requests:

1. **Root `package.json`**: a script `"check:run": "node app/src/features/run/check-run.mjs"`.
2. **`ci.yml`**: run `npm run check:run` in the job `browser-checks`, next to `check:shell`. The
   job must have `engine/dist` (as `check:engine-browsers` needs it).
3. **X2** (optional): when `tests/e2e/sim` exists it may take these checks over against the
   production build; the script uses `window.__easy68k`, which exists in development builds only.
