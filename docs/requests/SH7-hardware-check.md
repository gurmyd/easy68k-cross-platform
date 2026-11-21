# Request from SH7: run the Hardware panel's browser check in CI (gate I1)

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
2. With the real engines (`engine/dist`): the page's session parts are replaced by the real engine,
   a real `HardwareModel` and the test controller of `core/sim-host/hardware/testing.ts`, ticked once
   per display frame; segments and LEDs follow a program, a write without a host call repaints, a
   real click on a switch, a held push button released by pointer up and by pointer cancel,
   conflict colours after typing an address, showing the panel zeroes the switch byte and keeps the
   pictures, the Automatic label on Run and Pause, IRQ and Reset disabled after SIMHALT. Without
   `engine/dist` part 2 is skipped, or fails when `EASY68K_REQUIRE_ENGINES=1`.

Screenshots go to `build/SH7/hardware-check/` (git-ignored). Prints `N of M checks passed`; exits
non-zero on a failure or a console error. It needs only the pinned development dependencies
(`vite`, `@playwright/test`, `@axe-core/playwright`). On the SH7 machine (Windows 11): 70 of 70
checks pass (both browsers).

Requested:

1. A root script `check:hardware` = `node app/src/features/hardware/check-hardware.mjs`.
2. A step in the CI job `browser-checks` (Ubuntu, macOS, Windows) after the engines are available
   (the job needs `engine/dist` for part 2; with `EASY68K_REQUIRE_ENGINES=1` a missing engine fails
   the step).
