# Request from SH1: run the surface's browser check in CI (gate I1)

The drawing surface is plain arithmetic on a pixel array and its unit tests run under Node.
One property they cannot show is that a browser changes nothing: the same pixels in Chromium and
WebKit, and a pixel array that `ImageData` accepts as it is (ARCHITECTURE.md 3.4, 6.5.4). SH1 wrote
that as a script in its own folder, on the pattern of `check-shell.mjs`:

```
node app/src/core/sim-host/surface/check-surface.mjs [--browser chromium|webkit|all] [--out <dir>]
```

It starts the Vite dev server of `app/` on a free port (5238 first), opens an empty page on that
origin in headless Chromium and WebKit - not the application, so that an unfinished feature cannot
fail it - imports `surface.ts` into the page and checks, per browser (13 checks each):

- the fixed scene of `surface/testing.ts` has the hash the unit tests expect under Node
  (`FIXED_SCENE_HASH`);
- the scene of ellipses and wide lines has the same hash in every browser of the run;
- `putImageData` from the buffer's own memory and `getImageData` back give the same bytes; a pixel
  `$123456` is stored as the bytes red, green, blue, alpha;
- double buffering, as the Output panel will present it (`window ?? back`, `takeDirty()`): the
  canvas keeps its picture after mode 17 and shows the new one after task 94 and after mode 16;
- a flood fill of a whole 1920 x 1200 surface takes under 30 ms (best of 15 runs; on a busy
  machine, under eight plain passes over the same pixels measured at the same moment);
- no console errors.

Screenshots go to `build/surface-check/` (git-ignored). The script needs only the pinned
development dependencies (`vite`, `@playwright/test`), no production build and no engines. On the
SH1 machine (Windows 11): 26 of 26 checks pass.

Requests:

1. **Root `package.json`** (gate): a script
   `"check:surface": "node app/src/core/sim-host/surface/check-surface.mjs"`.
2. **`.github/workflows/ci.yml`** (gate): one more step in the job `browser-checks`, next to
   `check:gallery` and `check:shell`: `npm run check:surface`. The job already runs on Ubuntu,
   macOS and Windows with both browsers installed; the step takes about fifteen seconds.

Until then the script is run by hand, by its path.
