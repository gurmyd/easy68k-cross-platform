# Request from DV1: run the offline and Pages check in CI (gate I1)

Status: applied in gate I1 round 1. Root script `check:pwa` and the step "Offline, install and Pages check (DV1)" in `browser-checks`, group `simulator`, guarded by the file and by `needs.engines.outputs.available == 'asm sim'`; `build/pwa-check/` (without its `dist/`) is in the screenshot upload.

DV1's acceptance (ARCHITECTURE.md 9.4) needs a real browser and a production build: a reload with
the network off after one visit, every engine file of W4's loader, help, fonts and examples served
offline, no Content Security Policy violation, the build working under a sub-path, an update notice
that never reloads by itself. That is a script in DV1's folder, on the pattern of `check-shell.mjs`:

```
node app/src/features/pwa/check-pwa.mjs [--browser chromium|webkit|all] [--out <dir>] [--dist <dir>]
```

It runs `vite build` with `EASY68K_BASE=/easy68k-mac/` (the command `pages.yml` uses) into
`<out>/dist`, adds a fixture file of its own, runs the PWA build step, serves the result with its own
static server under `/easy68k-mac/` only (GitHub Pages' `cache-control: max-age=600`), and drives
headless Chromium and WebKit through a first visit, an offline reload (Playwright's offline mode
plus a server that refuses every connection), both engines assembling and running a program
offline, and a second deployment seen by two open pages. 26 checks per browser plus 2 for the
build; on the DV1 machine (Windows 11, Playwright 1.65.1) 54 of 54 passed in Chromium and WebKit.
Screenshots go to `build/pwa-check/` (git-ignored). About 70 seconds for both browsers, build
included.

It needs `engine/dist` (the six engine files must be in the build) and the pinned development
dependencies only. A browser without service workers is a failure on macOS and Linux and a skip on
Windows (Playwright's WebKit on Windows did have them on the DV1 machine).

Requests:

1. **Root `package.json`** (gate): `"check:pwa": "node app/src/features/pwa/check-pwa.mjs"`.
2. **`.github/workflows/ci.yml`** (gate): in the job `browser-checks`, a step after the engine
   binding step, with the same condition (it needs both engines):

   ```yaml
   - name: Offline, install and Pages check (DV1)
     if: ${{ !cancelled() && needs.engines.outputs.available == 'asm sim' }}
     run: npm run check:pwa
   ```

   and `build/pwa-check/` in the screenshot upload of that job. The plan job may guard it with
   `test -f app/src/features/pwa/check-pwa.mjs` like the other checks.

Until then the script is run by hand, by its path.
