# End-to-end harness

Owner: X1. ARCHITECTURE.md 6.6. The suites under `tests/e2e/` drive the **production build** of the
web application in Chromium and WebKit with Playwright:

| Folder      | Owner | What                                                                                                 |
| ----------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `fixtures/` | X1    | this harness: configuration helpers, the page object, keys, pending features                         |
| `editor/`   | X1    | every editor row of the parity matrix (section 1.3) that a browser test can show                     |
| `app/`      | X1    | mode switch, themes, layout, drafts, two windows, offline, manifest, accessibility, cancelled chords |
| `sim/`      | X2    | the simulator suites                                                                                 |

## Running

From the repository root:

```sh
npm run build                                    # once; CI builds in its own step
npm run test:e2e                                 # both browsers (builds first unless E2E_SKIP_BUILD=1)
npm run test:e2e -- --project=webkit             # one browser
npx playwright test --config tests/playwright.config.ts tests/e2e/editor/documents.spec.ts
E2E_DIST=build/X1/dist npx playwright test --config tests/playwright.config.ts --workers=4
npx playwright test --config tests/playwright.config.ts --repeat-each=20 --project=chromium   # 6.9 item 10
```

`tests/playwright.config.ts` serves the build with `fixtures/serve.mjs` (Vite's preview server with the
application's configuration) on a port that is free when the run starts. Environment variables are
listed at the top of that file.

## Rules every suite follows

1. **A fresh profile per test.** The `app` fixture (`fixtures/test.ts`) opens the application in a new
   browser context: empty storage, default settings, no drafts. Windows of one test are pages of that
   context (`app.openWindow()`), which share storage, Web Locks and BroadcastChannels like tabs.
2. **No console errors.** The fixture fails a test whose windows logged a console error or threw an
   uncaught exception.
3. **Through the interface.** The production build has no page object. Act with menus
   (`app.chooseMenu`), the toolbar (`app.toolbarButton`), keys (`app.press`), dialogs, the Files panel
   (`app.importFiles`, `app.exportFile`) and drops (`app.dropFiles`). Read what a user sees: tabs, the
   status bar, dialog texts, downloaded bytes. The two readings below the surface are documented in
   `fixtures/app.ts` (the editor's text and selection through CodeMirror's own view lookup).
4. **Keys from the table, on the host's key map.** The page gets the key map of the system the tests
   run on (macOS on a Mac, Windows on Windows and Linux), because the browser's own editing keys follow
   the real system. Every command chord comes from `chordsOn()` of `app/src/commands/specs.ts`
   (`app.press(id)`, `app.chords(id)`); no test spells `Control+S`. `test.use({ keys: 'mac' })` runs a
   block with the other key map for commands the application's dispatcher handles
   (`editor/shortcuts.spec.ts`). Use `app.mod` for CodeMirror's and the browser's own Mod key.
5. **No fixed pauses.** Wait for the state (`expect.poll`, `toBeVisible`, `toHaveText`), never for a
   time. Nothing may depend on the speed of the machine: GitHub's macOS runner is slow.
6. **Nothing Windows-only.** No paths, line ends, fonts or key names of one system. File names are
   compared as the application shows them.
7. **Hold keys a program polls** (X2): `keyboard.down`, wait for the program-visible effect,
   `keyboard.up`; or a press with a delay of at least 50 ms (6.6).
8. **Features still being built.** A test of a wave-2 feature starts with
   `await requirePackage(app, 'E5')` (or in `beforeEach`). While the package's command is disabled in
   the page, the test is marked `test.fail()` with the package id in the reason and stops at once;
   once the feature lands, the same test runs as an ordinary test (`fixtures/pending.ts`). When the
   package is built and committed, its entry in `PENDING` gets `landed: true`: from then on a
   missing feature fails the test as a regression. E4, E5, E6 and FS2 have landed.
9. **Long tests** get the configuration's limits (120 s per test, 15 s per expectation); a test that
   needs more says so with `test.setTimeout`.

## What these tests cannot show

What the page does with a key is shown; what a real browser does with it (reload on F5, Safari's
menu equivalents) is not, because Playwright's keys do not pass through the browser's own shortcut
handling, and Playwright's WebKit is not Safari (6.6, 6.8).
