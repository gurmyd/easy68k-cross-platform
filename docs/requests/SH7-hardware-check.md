# Request from SH7: run the Hardware panel's browser check in CI (gate I1)

Status: applied in gate I1 round 1. Root script `check:hardware` and the step "Hardware panel check (SH7)" of `browser-checks`, group `simulator`, where engine-dist is downloaded and EASY68K_REQUIRE_ENGINES=1 is set when it holds both engines.

SH7's acceptance (ARCHITECTURE.md 9.2) includes the panel itself: every control of hardware §5,
conflict colouring, push buttons released on pointer cancel. Unit tests run under Node without a
DOM, so, following the convention of `app/src/ui/shell/check-shell.mjs`, SH7 wrote a script in its
own folder:

```
node app/src/features/hardware/check-hardware.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (hot reload off, so that files other
packages save meanwhile cannot remount the page) and drives the application in headless Chromium
and WebKit:

1. With the shell's own session: View > Hardware shows the panel with every control of hardware §5;
   an axe-core scan of the panel (WCAG 2.0/2.1 A and AA) in both themes.
2. With the real engines (`engine/dist`): the application's own simulator session (features/run, SH8:
   real engine, real `HardwareModel`, real run controller and timers). Two programs assembled by
   the real assembler under Node are written to the browser store and opened with File > Open;
   segments and LEDs follow a running program, a write without a host call repaints, a real click
   on a switch, a held push button released by pointer up and by pointer cancel, conflict colours
   after typing an address, showing the panel zeroes the switch byte and keeps the pictures, the
   auto-interrupt settings reach the engine, the Automatic label on Run and Pause, IRQ and Reset
   disabled after SIMHALT. Without `engine/dist` part 2 is skipped, or fails when
   `EASY68K_REQUIRE_ENGINES=1`.

Without `engine/dist` part 1 still runs: the simulator session's failed engine requests and its
"The simulator engine could not be created" message are the expected outcome there and are printed
but not counted (gate I1 round 2; before, they failed part 1, so the CI step, which has no engines
guard, would have failed on a runner without engines). `--without-engines` answers every request for
`engine/dist` with 404 and so proves that run on a machine that has the engines. The CI step
therefore needs no engines guard, as its comment in `ci.yml` already says; nothing new is requested.

No step waits a fixed time: each waits (up to 30 s) for the state it expects, so a slow runner
only makes the check slower. Nothing depends on Windows (no paths in the page, no fonts, key names
are Playwright's portable ones). WebKit's `Failed to load resource ... Timeout was reached` (the
development server slow to transform a module on a loaded machine) is printed but not counted.

Screenshots go to `build/SH7/hardware-check/` (git-ignored). Prints `N of M checks passed`; exits
non-zero on a failure or a console error. It needs only the pinned development dependencies
(`vite`, `@playwright/test`, `@axe-core/playwright`). On the SH7 machine (Windows 11), on the
combined tree of gate I1: 74 of 74 checks pass (both browsers).

Requested:

1. A root script `check:hardware` = `node app/src/features/hardware/check-hardware.mjs`.
2. A step in the CI job `browser-checks` (Ubuntu, macOS, Windows) after the engines are available
   (the job needs `engine/dist` for part 2; with `EASY68K_REQUIRE_ENGINES=1` a missing engine fails
   the step).
