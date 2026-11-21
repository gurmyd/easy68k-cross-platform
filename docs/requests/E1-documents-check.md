# E1: run the Documents browser check in CI

Status: applied in gate I1 round 1. Root script `check:documents` and the step "Documents check (E1)" of `browser-checks`, group `interface`, on Ubuntu, macOS and Windows; `build/E1/documents-check/` is in the screenshot upload. Run here: 66 of 66 checks passed in 25 s.

During gate I1, E1 added a browser check for what its unit tests reach only through fakes: the real
document service together with the real editor, file dialogs, drop handling, IndexedDB drafts,
Web Locks and the unload guard. Following the convention of wave zero, it is a script in E1's folder:

    node app/src/features/documents/check-documents.mjs [--browser chromium|webkit|all] [--out <dir>]

It starts the Vite dev server of `app/` on a free port, drives headless Chromium and WebKit, prints
`N of M checks passed`, exits non-zero on any failure or console error, and writes screenshots and
`results.json` only below `build/E1/documents-check` (or `--out`). It needs only the pinned
development dependencies (`@playwright/test`, `@axe-core/playwright`, `vite`). It pretends the
Windows key map on every system, uses no file system paths of the host, and waits for conditions
rather than for fixed times (the one fixed pause, 3 s before checking that a second window offers
nothing, can only make that check pass late, never fail). On this PC: 66 of 66 in about 40 seconds
for both browsers.

Requested:

1. Root `package.json`: `"check:documents": "node app/src/features/documents/check-documents.mjs"`.
2. `ci.yml`, job `browser-checks` (Ubuntu, macOS, Windows): a step `npm run check:documents`, like
   `check:files`; screenshots `build/E1/documents-check/` uploaded on failure.
