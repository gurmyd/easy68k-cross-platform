# Request from SH6: run the program-files browser check in CI (gate I2)

SH6's acceptance (ARCHITECTURE.md 9.4) is headless and is covered by Vitest
(`app/src/core/sim-host/files/*.test.ts`, `app/src/core/sim-host/printer.test.ts`,
`app/src/fs/sync/cached.test.ts`, `app/src/features/sim-files/sim-files.test.ts`). The parts that need a
real browser - the real browser store (IndexedDB and its broadcast to a second page), the task 58
dialog on screen, the Printer Output dialog, closing a tab with unwritten bytes - are checked by a
script in SH6's folder, following the convention of `app/src/ui/shell/check-shell.mjs`:

```
node app/src/features/sim-files/check-sim-files.mjs [--browser chromium|webkit|all] [--out <dir>]
```

Please add:

- Root script: `"check:sim-files": "node app/src/features/sim-files/check-sim-files.mjs --browser all"`.
- CI: a step "Program files check (SH6)" in the job `browser-checks`, group **simulator**, on Ubuntu,
  macOS and Windows.
- It **needs `engine/dist`** (both engines: the programs are assembled at run time and run on the
  application's own simulator session). Without it the script prints "skipped" and exits 0, or fails
  when `EASY68K_REQUIRE_ENGINES=1`, as the other simulator checks.
- It needs **no production build** (it starts the Vite development server of `app/` on a free port,
  hot reload off).

It presses no chords (clicks and Escape only), assumes no operating system, and waits for states
(the two liveness steps repeat Rewind and Run up to 20 times, 100 ms apart). Screenshots go to `build/SH6/sim-files-check`. On the development PC Chromium takes
about 31 s and WebKit about 45 s. A module the development server cannot transform (a file another
package is saving) is printed with its URL; the page is not retried for it.

Run on 21 November 2026, Windows 11: Chromium 40 of 40, WebKit 40 of 40 (twice each). One WebKit run
failed to start the application because `app/src/features/log/LogPanel.tsx` (U4, being edited) gave
the development server a 500; the next run passed.
