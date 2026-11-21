Status: open (for gate I1).

# FS1: run the Files browser check in CI

FS1's acceptance names Chromium and WebKit. Following the convention of wave zero, the browser
check is a script in FS1's folder:

    node app/src/features/files/check-files.mjs [--browser chromium|webkit|all] [--out <dir>]

It starts the Vite dev server of `app/` on a free port, drives headless Chromium and WebKit, prints
`N of M checks passed`, exits non-zero on any failure or console error, and writes screenshots and
the exported `.zip` files only below `build/FS1/files-check` (or `--out`). It needs only the pinned
development dependencies (`@playwright/test`, `@axe-core/playwright`, `vite`), plus one archive
tool on the runner for the "system archive tool" check: Python's `zipfile` (preferred, present on
all three GitHub runners), `unzip` or `bsdtar`, whichever exists.

Requested:

1. Root `package.json`: `"check:files": "node app/src/features/files/check-files.mjs"`.
2. `ci.yml`, job `browser-checks` (Ubuntu, macOS, Windows): a step `npm run check:files`, like
   `check:gallery` and `check:shell`.

Notes for the job:

- The full-storage check lowers the origin's quota through the DevTools protocol
  (`Storage.overrideQuotaForOrigin`) and therefore runs in Chromium only; WebKit has no such switch.
- The server runs without hot reload and without a file watcher, so files changing elsewhere do not
  reload the pages in the middle of a check. A file of another package that does not compile still
  breaks the page (Vite reports it); the check then fails with that error.
