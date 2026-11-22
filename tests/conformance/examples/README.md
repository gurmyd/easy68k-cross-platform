# Whole-program pixel regression

ARCHITECTURE.md 6.5.4 (work package X3): whole programs are run to a fixed point, the hash of the
surface is committed, and the same programs run in Chromium and WebKit with the same hash and a
screenshot that shows exactly those pixels. This proves that the pictures do not depend on the browser
or the operating system, and that they do not change by accident.

```sh
npx vitest run --config tests/conformance/examples/vitest.config.ts   # under Node (also part of npm run test:conformance)
node tests/conformance/examples/check-examples.mjs                    # Chromium and WebKit (--browser chromium|webkit|all, --only <text>, --out <dir>)
EASY68K_EXAMPLES_REGENERATE=1 npx vitest run --config tests/conformance/examples/vitest.config.ts   # rewrite golden/surfaces.json
```

## What the golden is, and what it is not

`golden/surfaces.json` is **a regression baseline taken from the port itself**: the port's assembler,
simulator engine and host parts, headless, under Node, with the application's glyph atlases and virtual
time. It is **not** a capture of the official EASy68K. It proves that a picture is stable and the same
in every browser. It does not prove that the picture is the one the original draws. Agreement with the
original is shown by other suites, where it can be: the GDI references of T2 (`tests/conformance/gdi`,
primitives, ellipses, raster-font atlases) and the flat-area checks of T3 (`tests/conformance/sim`,
colours the official `SIM68K.exe` under Wine drew). The whole-program pictures themselves cannot be taken
from Wine: it has no Fixedsys font, and its GDI draws text and ellipses its own way
(`docs/porting/errata/T3.md`, entry 1). Regenerating the file is therefore a decision that a picture
should change, and its diff is reviewed as one.

A hash is the SHA-256 of `<width>x<height>:` (ASCII) and the pixels as bytes R, G, B, A of every pixel
in row order (`runner.ts`, `sha256.ts`, which runs under Node and in the page).

## The programs (34)

| Group         | Programs                                                                                                                                                                                      | Run                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `official`    | the ten of `tests/corpus/official`                                                                                                                                                            | typed answers for the tutorials, mouse and key events for `mouseWindowSize`, silent sound |
| `conformance` | twenty of the simulator suite (`tests/conformance/sim`): `trap15-b/b01`-`b13` and `trap15-a/a01, a06, a07, a17, a20, a40, a46` (the other `trap15-a` programs end by clearing the screen)     | to the halt                                                                               |
| `scene`       | `programs/x01-shapes` (lines, ellipses of 1 to 600 pixels, wide pens, flood fill, clipping), `x02-text-and-fonts` (five faces, every style), `x03-modes-and-double-buffer`, `x04-window-size` | to the halt                                                                               |

`catalog.ts` lists them and their scripts. "A fixed instruction count": a run ends at the first frame
in which `script.limits.instructions` are reached (`mouseWindowSize` and the clocks never end on their
own: the clocks stop at their limit of ten seconds of virtual time, `mouseWindowSize` at the instruction
limit, 5,010,000 instructions after 4,944 ms, before its own time limit of six seconds), or when the
program halts. Time is `VirtualTime`, so the clock a program reads and the end of its delays are the
same every run. Frames are 16 ms; the count it stopped at is in the golden.

Coverage, plainly: `clockDigital` and `fileio` end on an all-black surface (the clock uses the
seven-segment display, not the surface; `fileio` draws nothing), so their pictures prove little beyond
"nothing was drawn". The browser check presents the surface on a canvas of its own with the Output
panel's `Presenter`, not inside the real Output panel, so the panel's CSS scaling and layout are not
covered here (that is the end-to-end suite's, `tests/e2e/sim`).

## Files

| File                                | What                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `catalog.ts`                        | the programs, their scripts, assembling them (Node)                                         |
| `runner.ts`                         | runs one program to its fixed point and hashes the surface; runs under Node and in the page |
| `golden.ts`, `golden/surfaces.json` | the committed hashes and how they are compared                                              |
| `sha256.ts`, `png.ts`               | SHA-256 and a PNG decoder (a screenshot is read back as pixels)                             |
| `examples.test.ts`, `units.test.ts` | the Vitest suite (Node, no browser)                                                         |
| `check-examples.mjs`                | the browser check (Chromium and WebKit); screenshots to `build/X3/check`                    |
| `programs/`                         | the four scene programs                                                                     |

## The browser check

For every program and browser: the page runs the program with the page's own engine and compares the
surface hash, the instruction and cycle counts and the end of the run with the golden; presents the
surface on a canvas with the Output panel's own `Presenter` at 100% zoom and device pixel ratio 1; reads
the canvas back; and screenshots it with Playwright. Readback and screenshot must equal the pixels the
canvas should show (`screenHash`: the image on screen, with the prompt overlay of a finished key wait
painted over it as the panel does). Finally the hashes of the two browsers are compared with each other.
