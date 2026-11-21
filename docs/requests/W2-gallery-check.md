Status: items 1 and 2 applied at the wave-0 gate. `npm run check:gallery` exists; CI runs it in a job of its own, `browser-checks` (ubuntu, macOS and Windows; Chromium and WebKit; `EASY68K_REQUIRE_BROWSERS=1`), not in the `e2e` job, which stays off until `tests/e2e` has specs. Item 3 is for Q1 / X1.

# Request from W2: run the gallery's browser check in CI (gates; Q1 and X1 for adoption)

W2's acceptance (ARCHITECTURE.md 9.1) includes keyboard behaviour that follows 2.11 and an
automated accessibility scan of the gallery in both themes. Unit tests run under Node without a
DOM, and the browser suites (`tests/e2e/**`, `tests/a11y/**`) belong to X1 and Q1, so W2 wrote the
check as a script in its own folder:

```
node app/src/ui/components/gallery/check-gallery.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (5199 first), opens the gallery in headless
Chromium and WebKit, runs axe-core (WCAG 2.0/2.1 A and AA; serious and critical findings fail) on
the page, an open menu, a modal dialog and a message box in both themes, drives the keyboard
behaviour of the toolbar, menu bar, context menu, tabs, dialogs, message boxes, masked fields,
splitter, list box and grid, and fails on any console error. Screenshots go to
`build/gallery-check/` (git-ignored). It uses only the pinned development dependencies
(`vite`, `@playwright/test`, `@axe-core/playwright`). On the W2 machine: 142 of 142 checks pass.

Requests:

1. **Root `package.json`** (gates): a script `"check:gallery": "node app/src/ui/components/gallery/check-gallery.mjs"`.
2. **`ci.yml`** (gates): run `npm run check:gallery` in the job that already has the Playwright
   browsers (the e2e job), on Linux at least. It needs no build and no engines.
3. **Q1 / X1** (optional): when `tests/a11y` and `tests/e2e/app` exist, they may take over the
   scan and the keyboard checks against `?gallery` of the production build, once W3 has added the
   route (`docs/requests/W2-gallery-route.md`). The script can then be removed or kept as W2's
   development check.
