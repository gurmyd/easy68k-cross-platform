# Errata of SH1 (Drawing surface)

What SH1 found while building `app/src/core/sim-host/surface/`: where `docs/ARCHITECTURE.md` or
`docs/porting/trap15-tasks-60-up.md` (trap15-b) is silent, imprecise or cannot be met yet, what the
code does, and why. Entries under **Contract** concern what other packages compile or build against.
Nothing in `app/src/contracts/` had to change.

T2's GDI captures arrived while this package was being finished. Entry 13 has the result of the
comparison (every case of SH1's part equal), entry 1 the one rule of trap15-b it corrected, and
entry 10 what still rests on something that was not measured.

At the integration gate I1 the open points of the review were measured on Windows GDI as well:
every pen width up to 255 (entry 14, which adds a table of round dots and one oddity of GDI) and
block copies that reach past the bitmap (entry 6). In round 2 T2 committed those dots and bars as
the reference suite `pens`, and the comparison was run again on every committed case (entry 13).

## 1. trap15-b §6.3: a one-pixel rectangle run is drawn there and back (found by the GDI capture)

- Says: "The outline uses the pen colour through the drawing mode; the interior uses the fill
  colour through the drawing mode. Each pixel is combined once (...), which matters in XOR-type
  modes. Measured." And for case B, pen width 1: "a straight run of pen pixels `x1..x2` (or
  `y1..y2`), both ends included."
- GDI (T2's capture, 32 cases of the suites `rects`, `modes` and `polylines`; for example
  `rects-05458`, `rects-08454`, `modes-00035`): in case B with pen width 0 or 1 the two end pixels
  of the run are combined once and **every pixel between them twice**. GDI walks the outline of a
  box that has no height (or no width): along the run, and back. In Copy mode nothing shows. In
  mode 14 (and 3, 15) only the two end pixels are drawn; in mode 6 with pen `$FF0000` on `$336699`
  the ends are `$FF9966` and the pixels between `$FF6699`. Task 87 and task 90 behave alike, and
  so do horizontal and vertical runs. With a pen 2 or more wide (the flat bar), and in cases A and
  C, every pixel is combined once, as the spec says.
- Does: `rect.ts` draws the two ends with the pen and the pixels between them with the pen applied
  twice. With this, all 10,000 cases of the suite `rects` are equal.
- Proposed text for §6.3, case B: "Width 1: a straight run of pen pixels, both ends included; the
  end pixels are combined once, the pixels between them twice (visible only in a mode other than
  Copy)."

## 2. Mode 17 "takes a copy of `back` as `window`" - only when double buffering was off (3.4 rule 10)

- Says: "mode 17 sets `doubleBuffer` and takes a copy of `back` as `window`".
- Source: `doubleBuffer = true;` and nothing else (simIOu.cpp:2031-2032; trap15-b §5.6 "Nothing else
  happens"). A program that sends mode 17 while it is already on does not get its window repainted.
- Does: the copy is taken only when double buffering was off. A second mode 17 changes nothing;
  the screen keeps the picture it has.
- Proposed text: "mode 17, if double buffering is off, sets `doubleBuffer` and takes a copy ...".

## 3. "`PixelBuffer` objects are replaced" - when the size changes (3.4 rule 13)

- Says: "buffers are reallocated on resize; `PixelBuffer` objects are replaced, so users re-read
  `surface.back` after a resize".
- Does: `resize` and `resetToStartup` replace `back` (and `window`) when the size changes, and
  blacken the existing buffers when it does not. Every simulator reset calls `setWindowSize(0,0)`;
  with a 4096 x 4096 surface a new pair of buffers each time would be 128 MB of garbage per reset.
  Users that re-read `surface.back` are right in both cases. `takeDirty()` reports the whole surface
  after every `resize`.
- Proposed text: "... are replaced when the size changes ...".

## 4. Contract: `textOut` - width of the opaque cell, the font colour, no glyphs (3.4)

- Says: "TextOut: opaque cell in the fill colour, glyph in fontColor, then pen := (x + extent, y)".
  It does not say how wide the cell is, whether `fontColor` is already resolved, or what an empty
  glyph list means.
- Does:
  - The cell is as wide as **the advances of the glyphs together**, not `extent`, and as high as the
    tallest glyph. trap15-b §6.7: with control bytes the painted cells are fewer than the extent
    (`'A',9,'B',13,10,'C'` paints three cells and moves the pen by six). SH3 passes the glyphs that
    are painted and the extent GDI reports. For "a string made only of zero-width control bytes
    paints one cell of background" SH3 passes one blank glyph.
  - `fontColor` goes through the colour rule of trap15-b §4.6 inside `textOut` (the VCL resolves a
    font colour the same way as a pen colour). A colour that is already resolved is not changed by
    that, so both a raw task-21 value and a resolved one are right.
  - No glyphs: nothing is painted and the pen still moves (trap15-b §6.7, last item).
  - A glyph wider than its advance (italic overhang) paints beside the cell, over what is there.
  - Coverage 1-254 blends per channel as `floor((under * (255 - c) + over * c + 127) / 255)`.
    Section 6.5.3 does not compare outline-font pixels with Windows, so the rounding is the port's.
- Target `'window'`: the cell replaces the overlay; `windowPen` moves; `back` and `backPen` do not.
  The method does this also while double buffering is on - whether a prompt may be drawn then is
  the caller's decision (3.5.3: `promptTick` does nothing while double buffering, `erasePrompt`
  draws anyway). The overlay cell is cut to the surface and is `null` when it lies outside; the
  pen moves all the same.

## 5. Contract: the constructor takes the size as given (3.4)

- Says: `constructor(width: number, height: number)`; rule 11 gives the 640 x 480 minimum for
  "Resize".
- Does: the constructor accepts 1 x 1 up to `MAX_SURFACE` in each direction and applies no minimum.
  `resize` applies it. The application constructs 640 x 480 (the original's constructor calls
  `setWindowSize(640, 480)`), so nothing a program can see differs; unit tests and the GDI
  conformance cases can use small surfaces. `MIN_SURFACE_WIDTH` and `MIN_SURFACE_HEIGHT` are
  exported next to `MAX_SURFACE`.

## 6. Contract: `copyRect` - rectangles of different size, and pixels outside the surface (3.4)

- Says: "overlapping copies behave like GDI BitBlt".
- Not said, and not measured in trap15-a or trap15-b:
  - The original's `TCanvas.CopyRect` is a `StretchBlt`; with two rectangles of different size it
    would scale. `TextScreen` never asks for that (`scroll()` and `scrollRect()` pass equal sizes).
    `copyRect` copies the size the two rectangles have in common and never scales.
  - Task 25 accepts a text rectangle that reaches past the surface (up to 255 columns and 127
    rows). `copyRect` moves the pixels that exist at both the source and the destination and
    leaves every other pixel as it is.
- **Measured at gate I1**, and it is what GDI does. On a 24 x 16 memory bitmap, each pixel with a
  colour of its own, `StretchBlt` of equal sizes (the VCL's `CopyRect`) and `BitBlt` were called
  from the bitmap to itself in nine arrangements: a scroll in each of the four directions with the
  rectangle reaching past the bottom or the right edge, past both, a source completely outside, a
  source at negative coordinates, and two overlapping copies inside. On a screen-compatible bitmap
  and on a 32-bit DIB section, with both functions, the result was the same: a destination pixel
  whose source lies inside the bitmap takes that pixel's old value (also when the two rectangles
  overlap); a destination pixel whose source lies outside the bitmap **keeps its value**; nothing
  outside the destination rectangle changes. `StretchBlt` with `BLACKNESS` (what `fillBlack`
  stands for) blackens the whole destination rectangle inside the bitmap. The nine arrangements
  are a test in `surface.test.ts`. Scaling copies were not measured; nothing asks for them.
- `fillBlack` and `copyRect` change `back`, and the screen unless double buffering is on, exactly
  like the drawing methods (simIOu.cpp:1021-1025, 1122-1132).

## 7. Contract: what `takeDirty()` and `overlay` promise the Output panel (3.4)

- Says: "Region of the on-screen image changed since the last call, or null"; "then draws
  `overlay`".
- Does: the region is one bounding box, inside the surface. It also contains every place where the
  overlay cell appeared, changed or disappeared, so a panel that re-puts the region from
  `window ?? back` and then draws `overlay` (if not null) is always right, whichever way the
  sentence of 3.4 is read. The box of a line or a shape is its bounding box grown by the pen width,
  not the exact pixels. While double buffering is on, drawing reports nothing; `formPaint()`
  (task 94, `invalidate()`) and mode 16 report what was drawn since the screen was last current.
- `window` is a different object from `back`, of the same size. A buffer from an earlier mode 17 is
  used again, so a panel may keep one `ImageData` per buffer object.
- Checked in Chromium and WebKit by `check-surface.mjs`: an `ImageData` over the buffer's own
  memory, `putImageData` of the dirty region, `getImageData` back - the same bytes.

## 8. "A drawing call while not double buffered clears the overlay" - every call, drawn or not (3.5.3)

- Says: "Any presentation from the back buffer (`formPaint`, `invalidate`, a drawing call while not
  double buffered) clears the overlay."
- Does: `drawPixel`, `line`, `lineTo`, the four shapes, `floodFill`, `fillBlack`, `copyRect` and
  `textOut(..., 'both')` clear it while double buffering is off, also when the call changes no
  pixel (a pixel outside the surface, mode 2). Changing state (`moveTo`, colours, width, mode
  0-15, 17) and reading (`getPixel`, `getXY`, `takeDirty`) do not. `resize` and `resetToStartup`
  clear it in every case.

## 9. `resize` takes the original's unsigned 16-bit parameters (3.4 rule 11, trap15-b §4.3)

- `resize(width, height)` uses the low 16 bits of each argument (`setWindowSize(ushort, ushort)`),
  treats (0, 0) as "keep the current size" itself, then clamps each side to 640 / 480 and
  `MAX_SURFACE`. So `OutputDevice.setWindowSize` (SH3) may pass the engine's values straight on.
  The message `Output window size limited to 4096 x 4096` of 2.5 is not the surface's: it has no
  message sink. Whoever calls `resize` compares the request with `MAX_SURFACE`.

## 10. What rests on something other than a measurement

None of these was chosen silently; each is the simplest reading of what the specs give. Rows a and b
were open when the code was written and have since been confirmed by T2's capture; rows c and d
were measured at gate I1. They stay in the list to say where the values came from. Rows e and f
are what is still not measured.

| # | Where | What the code does | Basis |
|---|---|---|---|
| a | `colors.ts`, system colours 0-30 except 5, 8 and 15 | the colours Windows 10 and 11 ship with (the values under `HKCU\Control Panel\Colors`; index 25, which is not a system colour, is black) | 3.4 rule 1 says "others as captured by T2". **Confirmed**: equal to the 256 values of `GetSysColor` in `tests/conformance/gdi/golden/spots.json` (0-30 as in the table, everything above black), and the 28 cases of the suite `colors-system` are equal. They are the colours of the capture machine's theme, which is the Windows 11 default |
| b | `tables/dots.ts`, pen widths 10-14 | the rows of a regular twelve-sided polygon inscribed in the circle of diameter `w`, one side at the top | trap15-b §6.2 gives only pixel counts (69, 89, 101, 129, 145) and diameters. That polygon reproduces the measured dots of the widths 4, 5, 7, 8, 9 pixel for pixel and gives the measured count and diameter of 10-14 (a circle gives the wrong count for 11, 12 and 13; polygons with 8 or 16 sides fail too). Widths 3 and 6 do not follow it, so it is not GDI's rule. **Confirmed** pixel for pixel: every one-point rectangle of the widths 2-12 (872 cases) and every zero-length line of the widths 2-14 (248 cases) of the capture is equal |
| c | `tables/dots.ts`, pen widths 15-255 | the measured dot of each width, from a table | first version: the pixels inside the circle of diameter `w`, unmeasured. **Measured at gate I1** (entry 14): that disc is GDI's dot only at the widths 15 and 24; the table now holds every width 2-255 |
| d | `copyRect`, source or destination outside the surface | such pixels are left unchanged | **Measured at gate I1** (entry 6): GDI does the same |
| e | `floodFill` in a mode other than Copy | the mode is applied, always | trap15-b §5.4: the original depends on what was drawn just before (item V4, open); the spec's PORT rule is "apply the current mode". Only a run of SIM68K.exe itself can settle it: GDI alone does what the port does |
| f | `textOut`, coverage 1-254 | per-channel blend, rounded to nearest (entry 4) | substitute outline fonts; not compared (6.5.3) |
| g | `ellipse.ts`, `widepen.ts` | stubs: an ideal ellipse (radii a quarter pixel short of half the box, which happens to give GDI's circles of 3-9 pixels) and the band without caps. Their one-point cases (a zero-length line, a one-point ellipse) draw the measured pen dot and are GDI's at every pen width | 9.2: SH2 replaces both. Wide-pen ellipses: the ring between the ellipse of the box grown by the pen and of the box shrunk by it |

## 11. Notes on trap15-b for SH2 and DOC1

- §6.2, PORT ("stroke = the band of half-widths a/b around the width-1 line plus a disc of the dot
  shape at each end"): for the measured horizontal strokes this is exact for the widths 3 and 5 and
  one pixel too many for 2, 4 and 6 - the measured top row (`c - a`) starts at `x1 + 1`, the band's
  at `x1`. So even widths need more than band plus dots.
- §6.2 and §6.4 together: the dot of a pen of odd width `w` equals the `w` x `w` ellipse for 3, 5,
  7, 9 and 11 (compare the "left edge offset" table), but not for 13: the dot has 129 pixels, the
  13 x 13 ellipse of the figure has 125.
- §5.4, the table of the modes 18-255: regenerated from `SIM68K.exe` (the words at
  `$005270B4 + 2 * value`, GDI's low-byte rule, back through the first sixteen words). It equals
  the table of the spec entry for entry; the regenerated array is in `rop.test.ts`. The entries of
  16 and 17 are both mode 1 in the binary, and unreachable.
- §6.2, the dots (gate I1, entry 14): `tables/dots.ts` now has two functions in place of
  `dotRows`. `penDot(width)` is the dot of a zero-length line and of a one-point ellipse, for
  every pen width 2-255, as rows `left[i] .. right[i]` around the point; `rectangleDot(width)` is
  the one-point rectangle's. `emitDot` in `raster.ts` reports a dot as runs. The dots are not
  symmetric at 35 widths (20 is the first), so nothing may mirror them.

## 12. Acceptance: "a 1920x1200 flood fill takes under 30 ms" - which picture (9.2)

- Says only that. Measured, best of several runs, on the build machine while the other packages
  were building or being repaired (so the single runs vary by a factor of three). Node: at the end
  of wave 1. Browsers: the first row at the end of wave 1; the ragged pictures at gate I1, the
  better of two runs of `check-surface.mjs` (the first row took 3.5 ms in Chromium and 3.0 ms in
  WebKit in that run). In the other run, with the machine busier, the ragged pictures took 11.0,
  31.1, 29.5 and 39.5 ms in Chromium and 10.0, 60.0, 37.0 and 26.0 ms in WebKit.

| Picture (1920 x 1200) | Node 24 | Chromium | WebKit |
|---|---|---|---|
| empty surface, filled completely | 3.3 ms | 3.4 ms | 3.0 ms |
| 40-pixel cells, walls with one gap each | 9.2 ms | 9.9 ms | 6.0 ms |
| 10 % random pixels | 29.9 ms | 26.9 ms | 20.0 ms |
| every second pixel of every second row set | 33.8 ms | 24.4 ms | 17.0 ms |
| vertical one-pixel stripes | 30.3 ms | 25.6 ms | 20.0 ms |

  (In the browsers the stripes have one gap each, alternately at the top and at the bottom, so
  that one fill reaches every second column: 1,152,960 pixels painted.)

- The criterion is read as the fill of a whole surface (first row), which the unit test and
  `check-surface.mjs` assert. The three ragged pictures are near the limit, under it on a quiet
  machine and above it on a busy one; at 640 x 480 they take a seventh of the time. The tests take
  the best of several runs and, so that a busy or slow machine does not fail them, accept instead
  a time below eight plain passes over the same number of pixels measured at the same moment.
  `check-surface.mjs` prints the times of the four ragged pictures in each browser for
  information and asserts nothing about them.

## 13. The comparison with T2's GDI capture (6.5.1; the clause "when T2's references are available")

Run on 2026-11-21 against `tests/conformance/gdi/golden/*.pixpack.gz` as T2 had them then (files of
2026-11-20 23:31), with T2's own replay (`replay.ts`: one `Surface` method per operation) and T2's
comparison (every pixel and the pen position). Counted by owner as section 3.4 assigns the
primitives: rectangles of every pen width are SH1's; lines of a pen 2 or more wide and ellipses are
SH2's and are drawn by the stubs for now.

| Suite | SH1's cases equal | Of them with wide-pen rectangles | Wide lines (SH2, stub) | Ellipses (SH2, stub) |
|---|---|---|---|---|
| `lines` (width-1 lines) | 10,000 of 10,000 | | | |
| `polylines` (tasks 85, 86; pen positions) | 244 of 244 | 2 of 2 | 3 of 56 | |
| `rects` (filled and unfilled, widths 0-12, cases A, B, C) | 10,000 of 10,000 | 8,457 of 8,457 | | |
| `floods` | 1,000 of 1,000 | | | |
| `modes` (the 16 operations on every kind of primitive) | 336 of 336 | 48 of 48 | 9 of 48 | 51 of 96 |
| `modes-high` (modes 18-255) | 238 of 238 | | | |
| `pixels` | 500 of 500 | | | |
| `colors` | 49 of 49 | | | |
| `colors-system` (follows the Windows theme) | 28 of 28 | | | |
| `clip` | 203 of 203 | 30 of 30 | 13 of 17 | 91 of 123 |
| `widelines` | | | 667 of 2,000 | |

The suites `text` and `text-outline` (task 95 through `Surface.textOut`, glyphs from T2's reader)
pass in T2's test as well. Before the correction of entry 1 the result was 32 cases short: 16 in
`rects`, 15 in `modes` and 1 in `polylines` - all of them one-pixel runs in a mode other than Copy.

At the end of wave 1 SH1 made two remarks on `tests/conformance/gdi/surface.test.ts` (T2's file):
it decided by two probes of the Surface (`surfaceDrawsWidePens()`, `surfaceDrawsEllipses()`)
whether to compare SH2's cases, and SH1's stubs passed both, so those cases ran and failed; and it
counted rectangles of a pen 2 or more wide among SH2's cases, although they are SH1's (3.4 rule 5).
T2 settled both at gate I1 (T2 errata 1.12), so the remarks are history: **the two probes no longer
exist.** The test counts rectangles of every pen width as SH1's, and a case with an ellipse or a
line of a pen 2 or more wide waits for SH2 while the file that draws it (`ellipse.ts`,
`widepen.ts`) starts its header with the comment line `// STUB written by SH1`. Waiting cases are
reported as skipped tests with their number and are not compared. Both stubs carry that line;
whoever replaces a stub removes it.

**Run again at gate I1** (2026-11-21, after T2 recaptured the text suites and after the changes of
entry 14), every case of every committed suite, with the same replay and comparison:

| Suite | SH1's cases equal | Of them with wide-pen rectangles | Wide lines (SH2, stub) | Ellipses (SH2, stub) |
|---|---|---|---|---|
| `lines` | 10,000 of 10,000 | | | |
| `polylines` | 244 of 244 | 2 of 2 | 3 of 56 | |
| `rects` | 10,000 of 10,000 | 8,457 of 8,457 | | |
| `floods` | 1,000 of 1,000 | | | |
| `modes` | 336 of 336 | 48 of 48 | 9 of 48 | 51 of 96 |
| `modes-high` | 238 of 238 | | | |
| `pixels` | 500 of 500 | | | |
| `colors` | 49 of 49 | | | |
| `clip` | 203 of 203 | 30 of 30 | 13 of 17 | 91 of 123 |
| `widelines` | | | 667 of 2,000 | |
| `text` (task 95 in the raster faces: cells, glyphs, pen) | 1,881 of 1,881 | | | |
| `text-outline` (outline faces: cells and pen) | 180 of 180 | | | |
| all of the above | 24,631 of 24,631 | 8,537 of 8,537 | 692 of 2,121 | 142 of 219 |

120 further cases of `text-outline` have no cells to compare (T2's `outlineCells` returns none).
The suites T2 marks as depending on the machine: `colors-system` 28 of 28 on this machine;
`text-control` 44 of 171, and none of the 127 differences is the surface's: every one of its
strings is one T2's text model does not cover (`textUnmodelled()`: a byte Windows draws from a
fallback font, an undefined Windows-1252 byte, italic itemization, the thin bar of zero-width
bytes), so the glyphs and the extent the replay hands to `textOut` are not Windows' there;
`text-outline-glyphs` (75 cases) holds glyph pixels of the outline faces, which 6.5.3 does not
compare, and the replay has no glyphs for it.

**Run again in gate I1 round 2** (2026-11-21), against the references as committed in 8611609:
T2 had added the suite `pens` (request `docs/requests/SH1-gdi-dots.md`, T2 errata 1.11) and
recaptured `text` and `text-control`. T2's own test (`npx vitest run --config
tests/vitest.workspace.ts tests/conformance/gdi/surface.test.ts`) passes every comparison it makes
(15 passed, 8 skipped as waiting for SH2, 2,848 cases). Counted case by case with the same replay
and comparison:

| Suite | SH1's cases equal | Of them with wide-pen rectangles | Wide lines (SH2, stub) | Ellipses (SH2, stub) |
|---|---|---|---|---|
| `lines` | 10,000 of 10,000 | | | |
| `polylines` | 244 of 244 | 2 of 2 | 3 of 56 | |
| `rects` | 10,000 of 10,000 | 8,457 of 8,457 | | |
| `pens` (new: dots of every width 2-255, bars and frames of the widths 13-255) | 1,228 of 1,228 | 1,228 of 1,228 | 254 of 254 (the dots) | 254 of 254 (the dots) |
| `floods` | 1,000 of 1,000 | | | |
| `modes` | 336 of 336 | 48 of 48 | 9 of 48 | 51 of 96 |
| `modes-high` | 238 of 238 | | | |
| `pixels` | 500 of 500 | | | |
| `colors` | 49 of 49 | | | |
| `clip` | 203 of 203 | 30 of 30 | 13 of 17 | 91 of 123 |
| `widelines` | | | 667 of 2,000 | |
| `text` | 2,122 of 2,122 | | | |
| `text-outline` | 198 of 198 | | | |
| all of the above | 26,118 of 26,118 | 9,765 of 9,765 | 946 of 2,375 | 396 of 473 |

120 cases of `text-outline` again have no cells to compare. Machine-dependent suites:
`colors-system` 28 of 28; `text-control` 44 of 252, and every one of the 208 differences is a
string T2's text model does not cover (by `textUnmodelled()`: 74 a byte drawn from the fallback
font, 30 an undefined Windows-1252 byte, 9 italic itemization, 95 the bar of zero-width bytes;
T2's `golden.test.ts` asserts that `text-control` holds only such strings), so the glyphs and the
extent handed to `textOut` are not Windows' there and no difference is the surface's.
`text-outline-glyphs` is still not comparable (6.5.3). The dots of the stubs' one-point cases are
equal because they use the measured table (entry 14); everything else the stubs draw waits for SH2.

## 14. Pen widths above those of the references: every width 2-255 measured on GDI (gate I1)

- Says: 6.5.1 has rectangles with the pen widths 0-12 and wide lines with 2-14, and trap15-b §6.2
  gives the round dots of the widths 2-14. A pen width is a byte, so a program can ask for any
  width up to 255, and rectangles of every width are SH1's (3.4 rule 5). The review left the dots
  of the widths 15-255 open (entry 10, row c: a plain disc, unmeasured).
- Measured on 2026-11-21 on Windows 11 (10.0.26300) with T2's capture program
  (`tests/oracle/gdi-capture/capture.cpp`, built as `build/gdi-capture/gdi-capture.exe`), which SH1
  ran on case lists of its own, in the text form of `serializeCases`. Lists, pictures and the
  comparison are scratch files under `build/SH1/capture/` and are not committed.

| What GDI drew | Cases | Equal before | Equal now |
|---|---|---|---|
| one-point rectangles (tasks 87, 90), widths 2-255: at three positions, filled and unfilled, and in mode 6 on a coloured background | 1,270 | the widths 2-15 and 24 only | all |
| zero-length lines (task 84; task 86 then 85), widths 2-255, at two positions | 762 | the widths 2-15 and 24 only | all |
| one-point ellipses (tasks 88, 91), widths 2-255 | 508 | the widths 2-15 and 24 only | all |
| dots cut off by the edge of the surface, widths 15, 16, 31, 64, 100, 255 | 6 | 2 | all |
| rectangles, cases A and B, every width 2-255: bars of six lengths in both directions, with the corners in either order, and four kinds of frame | 4,572 | all but the 7 vertical bars of width 206 | all |
| random rectangles, all three cases, widths 13-255 on a 420 x 360 surface (1,500) and widths 2-255 reaching past a 200 x 160 surface in ten drawing modes (6,000) | 7,500 | of the first 1,500: 1,498 | all |
| vertical bars of the widths 205, 206 and 207 at seven places, in three modes | 126 | | all |
| lines of a one-pixel pen (4,000) and rectangles with the pen widths 0, 1, 2, 3, 7, 12, 100, 206 and 255 (2,000), with coordinates from the whole signed 16-bit range, on a 64 x 48 surface; pictures and pen positions | 6,000 | | all |
| the scene `drawWideRectangleScene` of `surface/testing.ts`: 1,016 rectangles on one 640 x 480 picture, every width 2-255, modes XOR and NOT XOR | 1 | | all 307,200 pixels |

  What the capture showed, and what the code does now:

  1. **The dots are not discs.** A pen of width `w` gives a dot of `2k + 1` rows and columns,
     `k = floor((w - 1) / 2)`, centred on the point, each row one unbroken run - but its outline
     is that of a polygon GDI makes of the pen. Of the widths 15-255, the pixels inside the circle
     of diameter `w` are GDI's dot at 15 and 24 only; at 16 the dot has 189 pixels, the disc 193. At 35 widths (20 is the first) the dot is not even symmetric: single rows end one
     pixel early on one side. `tables/dots.ts` now holds the measured dot of every width 2-255.
  2. **A one-point rectangle is not always the pen's dot.** A zero-length line and a one-point
     ellipse draw the same dot at every width. The one-point rectangle draws that dot too, except
     at 15 widths (47, 151, 157, 163, 199, 201, 221, 223, 225, 227, 243, 245, 247, 249, 251),
     where it lacks one pixel at one end of a row near the top and, at eleven of them, one pixel at
     the other end of the matching row near the bottom (26 pixels in all 254 dots). Hence
     `penDot(width)` and `rectangleDot(width)`.
  3. **The vertical bar of a pen exactly 206 wide is sheared** (case B of trap15-b §6.3). Its left
     half, the columns `x1 - 103 .. x1 - 1`, covers the rows `y1 + 1 .. y2`; its right half, the
     columns `x1 .. x1 + 102`, the rows `y1 .. y2 - 1`, as the whole bar does at every other width.
     The same for every length and position tried, in the modes 4, 6 and 14, and for either order
     of the corners. Horizontal bars of width 206 are straight, and so are the vertical bars of the other
     253 widths. `rect.ts` reproduces it (`SHEARED_BAR_WIDTH`).
  4. Everything else is as trap15-b §6.3 has it, at every pen width: the square-cornered frame of
     case A with its interior, the flat bar of case B without its far end, every pixel combined
     once.

- Proposed text for trap15-b §6.2: "The dot of a pen of width `w >= 2` has `2 * floor((w - 1) / 2)
  + 1` rows and columns. Its shape is a polygon's, not a circle's, and was captured for every
  width 2-255 (`app/src/core/sim-host/surface/tables/dots.ts`). A zero-length line and a one-point
  ellipse draw it; a one-point rectangle draws it less one or two pixels at 15 widths."
- Proposed text for §6.3, case B: "... Wider: a flat-ended bar that leaves out its far end. With a
  pen exactly 206 wide the left half of a vertical bar lies one row lower than the right half."
- Guarded by the committed references since gate I1 round 2: T2's suite `pens`
  (`docs/requests/SH1-gdi-dots.md`, T2 errata 1.11) holds the dot of every width 2-255 as a
  one-point rectangle, a zero-length line and a one-point ellipse, and bars and frames of every
  width 13-255 with the sheared bar of width 206; the surface equals all of it (entry 13, last
  table). The unit tests hold the table as well: a checksum and the pixel total of the captured
  dots (`tables/dots.test.ts`), drawn examples, and the hash of the scene of the last table row,
  which is the hash of the picture GDI drew (`WIDE_RECTANGLE_SCENE_HASH`, checked under Node and
  in both browsers).
- Measured on one machine first, then on a second Windows: in CI run 44913261966 (commit
  8611609) the job `windows-oracles` recaptured every suite on Windows Server 10.0.26100 (the
  references come from 10.0.26300). Of its 44 outputs, the 24 that differed were font files,
  `metrics.json`, `spots.json` and the two machine-dependent suites `colors-system` and
  `text-control`; `pens`, `rects`, `lines`, `polylines`, `floods`, `modes`, `modes-high`,
  `pixels`, `colors` and `clip` were equal to the committed references. So the dots, bars and
  frames are the same on that Windows.

## 15. Interface inside the surface folder: `dotRows` is gone (for SH2)

- Was: `dotRows(width)` in `tables/dots.ts`, the half-widths of a dot's rows from the centre
  outwards, which assumed a symmetric dot.
- Is: `penDot(width)` and `rectangleDot(width)`, each a `Dot` (`reach`, `left[]`, `right[]`: row
  `y - reach + i` covers `x + left[i] .. x + right[i]`), and `emitDot(dot, x, y, emit)` and
  `mixDot(buffer, x, y, dot, mix)` in `raster.ts`. The stubs `widepen.ts` and `ellipse.ts` use
  `penDot` for their one-point cases. Nothing outside `surface/` used `dotRows`.
