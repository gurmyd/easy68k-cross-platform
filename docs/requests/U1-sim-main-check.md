# Request from U1: run the browser check of the Registers, Listing and Messages panels in CI (gates)

U1's acceptance (ARCHITECTURE.md 9.2) includes items that only a browser can show: real typing in
the register fields, gutter clicks and the gutter's context menu, the modeless Find dialog with
Enter, F3 and Escape, Ctrl+F and Ctrl+G through the dispatcher, the third-visible-row scroll, and
"a 100,000-row listing scrolls smoothly". Following the wave-zero convention, the check is a
script in U1's folder:

```
node app/src/features/sim-main/check-sim-main.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (HMR off), opens the application, replaces
it in the page by an application with the `sim-main` feature on the session double of
`app/src/features/sim-main/testing.ts` over the **real simulator engine** (SH8's session is
written at the same time), rendered by the real shell (`app/src/App.tsx`), and drives it in
headless Chromium and WebKit in both themes. It prints `N of M checks passed`, exits non-zero on a
failure or a console error, and writes screenshots below `build/U1/sim-main-check/` (git-ignored).
It uses only the pinned development dependencies (`vite`, `@playwright/test`,
`@axe-core/playwright`). Unlike `check:shell` it needs `engine/dist` (the real engines are loaded
in the page through `app/src/engine/testing.ts`).

On the U1 machine (Windows 11, under the load of fifteen packages): 138 of 138 checks pass in
Chromium and WebKit. Frame times while scrolling the 100,000-row listing are a criterion in
Chromium; in Playwright's WebKit for Windows they are reported only, because that build's frames
varied with the machine's load far more than the page's work did (60-180 ms per frame in a busy
hour, 30-50 ms in a quieter one, while the page's own work per scroll step, which is checked in
both browsers, stayed at about 1 ms). In the last runs WebKit was within the Chromium limit too.

Requests:

1. **Root `package.json`** (gates): a script
   `"check:sim-main": "node app/src/features/sim-main/check-sim-main.mjs"`.
2. **`ci.yml`** (gates): run `npm run check:sim-main` in the job `browser-checks` (Ubuntu, macOS,
   Windows), after `engine/dist` is available in that job (built or fetched as for the unit tests
   with `EASY68K_REQUIRE_ENGINES=1`).
3. **Integration gate I1**: once SH8's `features/run/session.ts` exists, the same checks can run on
   the real session; the script only needs `createSimSession` left at the feature's factory and a
   program loaded through `controller.open`.
