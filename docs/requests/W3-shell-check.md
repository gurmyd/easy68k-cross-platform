# Request from W3: run the shell's browser check in CI (gates; X1 and Q1 for adoption)

W3's acceptance (ARCHITECTURE.md 9.1) includes items that only a browser can show: the chords of
2.9.3 have `defaultPrevented` in Chromium and WebKit, a `storage` event updates a running
instance, the window lock of 3.8.6 is held and released. Unit tests run under Node without a DOM,
and `tests/e2e/**` belongs to X1, so W3 wrote the check as a script in its own folder, as W2 did
for the gallery (`docs/requests/W2-gallery-check.md`):

```
node app/src/ui/shell/check-shell.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (5198 first) and drives the application in
headless Chromium and WebKit, with the Windows and with the macOS key map: start-up and the three
modes; menus and toolbars on screen against the command tables; `defaultPrevented` for the chords
of 2.9.3 in every mode; key and code pairs of other layouts (Option chords, QWERTZ, Russian);
modal dialogs (no command from a key or a toolbar button, the pressed button is returned, the
controller is held in Simulator mode); two pages on one origin (settings, the `storage` event, the
window lock); layout persistence across a reload; the narrow layout; an axe-core scan of the three
modes and a message box in both themes; `?gallery`. Screenshots go to `build/shell-check/`
(git-ignored). It uses only the pinned development dependencies (`vite`, `@playwright/test`,
`@axe-core/playwright`) and needs neither a production build nor the engines. On the W3 machine
(Windows 11): 268 of 268 checks pass.

Requests:

1. **Root `package.json`** (gates): a script
   `"check:shell": "node app/src/ui/shell/check-shell.mjs"`.
2. **`ci.yml`** (gates): run `npm run check:shell` in the job that has the Playwright browsers
   (the e2e job), next to `check:gallery`. The script pretends the platform through
   `navigator.platform`, so it gives the same result on the three runners.
3. **X1 / Q1** (optional): when `tests/e2e/app` and `tests/a11y` exist they may take these checks
   over against the production build. Two of them use `window.__easy68k`, which exists in
   development builds only (to register recording command handlers and to open a message box
   before any feature can); once features have real handlers and dialogs, a production-build test
   needs no such hook.
