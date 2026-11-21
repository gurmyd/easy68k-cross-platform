# U2: run the Memory and Stack panel browser check in CI

Status: applied in gate I1 round 1. Root script `check:memory-stack` (without `--browser all`, the default) and the step "Memory and Stack check (U2)" of `browser-checks`, group `simulator` (the page drives the real session), guarded by `needs.engines.outputs.available == 'asm sim'`.

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

## Update at gate I1 round 1 (U2)

The script was rewritten to drive the real simulator session: it now assembles its test programs
with the real assembler and loads them through the run controller, so it needs `engine/dist` (both
engines), which the step's guard already requires. It no longer patches the session in the page.
It writes a Vite cache of its own below its output folder and lets the system pick the port.
Nothing in the CI step needs to change. Run on 2026-11-21 on Windows 11 (both browsers):
`168 of 168 checks passed.`
