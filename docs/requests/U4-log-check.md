# Request from U4: run the logging and options browser check in CI (gate I2)

Status: done at gate I2 by the configuration engineer: the root script `check:log` exists and
`.github/workflows/ci.yml` runs `npm run check:log` in `browser-checks`, group `simulator`. At the
same gate U4 replaced the check's remaining fixed pauses by waits for state (see below).

U4's acceptance (ARCHITECTURE.md 9.4) covers dialogs, enabled states and files in the browser
store. Unit tests run under Node without a DOM, so, following the convention of
`app/src/ui/shell/check-shell.mjs`, U4 wrote a script in its own folder:

```
node app/src/features/log/check-log.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It assembles two programs with the real assembler (`engine/asm/asm68k.mjs`, needs `engine/dist`),
starts the Vite dev server of `app/` on a free port (no hot reload, no file watching, a Vite cache of
its own below the output folder) and drives the real application in headless Chromium and WebKit
with the key map of the system it runs on (chords read from `chordsOn()` in the page):

- Log Start and Log Stop disabled at start-up; Options > Log Output... with the original's texts
  and the memory range for type 3; OK enables Log Start and saves the two types;
- Log Start, Trace Into to the halt, `Current Log Stopped.`: the execution log of sim-ui §13.4
  (type 1) and the output log in the browser store, byte for byte (header date by its form);
- the `Log File Options` question: Cancel, Append, Replace; the Rewind and Reload notes; Log Stop
  with its key;
- Log Start while a program runs and the log file exists, with the question open for 3 s: every
  byte the program writes after the click is in the log;
- the cost of a flush in the real browser store with a 30 MB log against a small one (best of three
  attempts; the figures are printed);
- the Log panel; Auto Trace Options; Enable Exceptions and Enable Bit Field (still set after a
  reload); the three font dialogs; Fullscreen Options; axe-core scans of every dialog (WCAG 2.0/2.1
  A and AA); light and dark theme.

Every wait is for a state, never a fixed time, except the 3 s for which the question is
deliberately left open. Nothing depends on Windows. Screenshots go to `build/U4/log-check/`
(git-ignored). Prints `N of M checks passed`; exits non-zero on a failure or a console error.
Without `engine/dist` it prints that nothing was checked and exits 0, or 1 when
`EASY68K_REQUIRE_ENGINES=1`. Needs only the pinned development dependencies (`vite`,
`@playwright/test`, `@axe-core/playwright`); no production build.

Requested:

1. A root script `check:log` = `node app/src/features/log/check-log.mjs`.
2. A step in the CI job `browser-checks`, group `simulator` (it needs `engine/dist`; with
   `EASY68K_REQUIRE_ENGINES=1` a missing engine fails the step).
