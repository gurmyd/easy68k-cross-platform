# Request from SH3: run the text screen's browser check in CI (gate I1)

Status: applied in gate I1 round 1. Root script `check:text` and the step "Text screen check (SH3)" of `browser-checks`, group `simulator`, guarded by `needs.engines.outputs.available == 'asm sim'`.

SH3's acceptance (ARCHITECTURE.md 9.2) includes "the same text gives the same pixels under Node,
Chromium and WebKit". Unit tests run under Node without a DOM and `tests/e2e` belongs to a later
package, so the browser half is a script in SH3's own folder, by the wave-zero convention:

```
node app/src/core/sim-host/text/check-text.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (chosen by the operating system), runs the
two scenarios of `app/src/core/sim-host/text/pixel-scenario.ts` under Node (through the dev
server's module loader), in headless Chromium and in headless WebKit, and compares: the pixels of
each browser with the Node run, the Node run with the hashes fixed in `pixel-scenario.ts`, the
shadow array, cursor and grid, and a canvas round trip (`putImageData`, `getImageData`). One
scenario calls the text screen directly; the other runs a 68000 program on the real simulator
engine with the real `OutputDevice`. It fails on any console or page error, writes two screenshots
per browser to `build/text-check/` (git-ignored) and prints `N of M checks passed`. It uses only
the pinned development dependencies (`vite`, `@playwright/test`). It needs `engine/dist` (both
engines: the program is assembled and run). On the SH3 machine: 22 of 22 checks pass.

Requests:

1. **Root `package.json`**: a script `"check:text": "node app/src/core/sim-host/text/check-text.mjs"`.
2. **`ci.yml`**: run `npm run check:text` in the job `browser-checks` (Ubuntu, macOS, Windows;
   Chromium and WebKit), which already has the browsers and the engines.

Nothing else is asked for: no dependency, no configuration change.
