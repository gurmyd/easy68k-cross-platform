# B1: run the EASyBIN browser check in CI

Status: applied in gate I1 round 1. Root script `check:easybin` (`node app/src/features/easybin/check-easybin.mjs`; no `--browser all`, which is the script's default, like every other check) and the step "EASyBIN check (B1)" of `browser-checks`, group `interface`, on Ubuntu, macOS and Windows; screenshots `build/B1/check/` uploaded on failure.

Package: B1 (EASyBIN). Requested change: shared configuration (root `package.json`,
`.github/workflows/ci.yml`), which B1 may not edit.

## What

Add the script `app/src/features/easybin/check-easybin.mjs` to the job `browser-checks`, next to
`check:gallery`, `check:shell` and `check:engine-browsers`, for example as a root script

    "check:easybin": "node app/src/features/easybin/check-easybin.mjs --browser all"

and one step `npm run check:easybin` in that job on Ubuntu, macOS and Windows.

## Why

The B1 acceptance (9.4) needs a real browser for: EASyBIN mode with the real file dialogs of FS1
(Open S-Record, Save S-Record, Save Binary with four files, the bytes written), Copy and Fill through
the buttons, the Address field, Row and Page, clicking and typing in the rows, a dropped file, the
About box, F1, an accessibility scan in both themes, and "editing anywhere in 16 MB stays responsive"
(key-down to the painted frame at three addresses, three runs, best run; a Fill of all 16 MB). The
script starts the Vite development server on a free port without HMR or file watching, drives
headless Chromium and WebKit, prints `N of M checks passed`, exits non-zero on any failure or console
error, and writes screenshots only below `build/B1/check` (or `--out <dir>`). It needs nothing but the
pinned development dependencies.

The responsiveness thresholds (median below 50 ms, 95th percentile below 100 ms of the best of three
runs) are wide enough for a loaded CI runner; the measured values are printed.
