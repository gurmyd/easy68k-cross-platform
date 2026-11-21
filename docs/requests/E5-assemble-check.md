# Request from E5: run the Assemble feature's browser check in CI (gate I2)

E5's acceptance (ARCHITECTURE.md 9.4; editor-ui §20.4) includes what only a browser shows: the
status dialog, the message list with its height rule, markers, double-click, the context menu,
Load L68 and Execute into the real simulator session. Following the convention of
`app/src/ui/shell/check-shell.mjs`, E5 wrote a script in its own folder:

```
node app/src/features/assemble/check-assemble.mjs [--browser chromium|webkit|all] [--out <dir>] [--keys mac|windows]
```

Asked of the gate:

1. A root script `check:assemble` = `node app/src/features/assemble/check-assemble.mjs`.
2. A step "Assemble check (E5)" in the job `browser-checks`, group **simulator** (it needs
   `engine/dist`, both engines: F9 uses the assembler, Execute the simulator session), with
   `EASY68K_REQUIRE_ENGINES=1` where the job has downloaded the engines.

What it needs: `engine/dist` (without it the script prints that it was skipped and exits 0; with
`EASY68K_REQUIRE_ENGINES=1` it fails instead); the pinned Playwright browsers; `@axe-core/playwright`
(installed). No production build: it runs on the Vite development server of `app/`, started on a free
port with hot reload and file watching off. Screenshots go below `build/E5/assemble-check` only.

Nothing in it assumes Windows: the page gets the key map of the system it runs on (macOS on a Mac,
Windows elsewhere), every chord is read from the application's chord table (`chordsOn()`; on a Mac
it presses both F9 and Cmd+B), files are written into the browser store through the page's Vfs, no
step waits a fixed time for a result (each waits up to 30 s for the state it expects), and no
download names or pixel sizes are compared except the message list's 7 px / 87 px heights, which are
CSS pixels and independent of the device pixel ratio.

Run on Windows 11, 2026-11-21: Chromium 34 of 34, WebKit 34 of 34 (`--browser all`: 68 of 68), and
WebKit with `--keys mac` 34 of 34.

Unit tests: `app/src/features/assemble/corpus.test.ts` (part of `npm test`) assembles 289 option
runs of the tracked corpus through the application's path; it takes about 40 s alone on this PC and
has a time limit of 600 s per set.
