# U2: run the Memory and Stack panel browser check in CI

Status: open

Package: U2 (Memory and Stack panels). Requested change: shared configuration (root `package.json`,
`.github/workflows/ci.yml`), which U2 may not edit.

## What

Add the script `app/src/features/memory/check-memory-stack.mjs` to the job `browser-checks`, next to
`check:gallery`, `check:shell` and `check:engine-browsers`, for example as a root script

    "check:memory-stack": "node app/src/features/memory/check-memory-stack.mjs --browser all"

and one step `npm run check:memory-stack` in that job on Ubuntu, macOS and Windows.

## Why

The U2 acceptance (9.2) includes checks that need a real browser: the rendered rows, the number of
rows following the panel height, clicking and typing in the hex and ASCII columns, the message boxes
of Copy and Save, Live, the stack's aqua / yellow / red colours and the cursor's blink. The script
starts the Vite development server on a free port without file watching, drives headless Chromium
and WebKit, prints `N of M checks passed`, exits non-zero on any failure or console error, and writes
screenshots only below `build/U2/check` (or `--out <dir>`). It needs nothing but the pinned
development dependencies.

Run on 2026-11-20 on Windows 11: `140 of 140 checks passed.`
