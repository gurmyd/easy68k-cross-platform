# GDI ellipses and wide pens: what the port reproduces, and what it does not yet

Owner: SH2. This file is the measured result of ARCHITECTURE.md 6.5.2 (ellipses) and of the
wide-line part of 6.5.1, and it is the **regression baseline**: a later change may not make any
figure below worse. The figures are printed by the tests named with them. Every statement about
GDI here was measured on Windows 11 (10.0.26300, 96 DPI), the machine of T2's references.

## 1. Figures

| Case family | Where | Cases | Every pixel equal | Worst case |
|---|---|---|---|---|
| Ellipses, every box 1 x 1 to 64 x 64, one-pixel pen, filled (mode 6) and unfilled (XOR) | suite `ellipses`, `ellipse.gdi.test.ts` | 8,192 | **8,192** | 0 pixels |
| Ellipses, random boxes with sides 65 to 1,200, one-pixel pen, filled, Copy | suite `ellipses-large`, `ellipse.gdi.test.ts` | 3,000 | **3,000** | 0 pixels |
| Ellipses, pen widths 2 to 8, random boxes 1 to 100, filled and unfilled, Copy and XOR, through the Surface as it is today | suite `ellipses-wide`, `ellipse.gdi.test.ts` | 500 | 361 | 14 pixels (`ellipses-wide-00152`) |
| the same, with the drawing mode passed to `rasterEllipse` (request `docs/requests/SH2-ellipse-mode.md`) | same test, second figure | 500 | **496** | 3 pixels (`ellipses-wide-00125`) |
| Wide lines, widths 2-14 | T2's suite `widelines`, `tests/conformance/gdi/surface.test.ts` | 2,000 | **2,000** | 0 |
| Wide lines in task 85/86 chains | T2's `polylines` | 56 | **56** | 0 |
| Wide lines in the 16 drawing modes | T2's `modes` | 48 | **48** | 0 |
| Wide lines across the edges, 16-bit extremes | T2's `clip` | 17 | **17** | 0 |
| Zero-length lines, widths 2-255 | T2's `pens` | 254 | **254** | 0 |
| One-pixel ellipses in the 16 drawing modes | T2's `modes` | 96 | **96** | 0 |
| One-pixel ellipses across the edges, 16-bit extremes, the 32768 sum rule | T2's `clip` | 93 | **93** | 0 |
| One-point ellipses, widths 2-255 | T2's `pens` | 254 | **254** | 0 |
| Wide-pen ellipses across the edges | T2's `clip` | 30 | 27 (30 with the request) | 4 pixels (`clip-00202`) |

6.5.2's thresholds: the 8,192 small boxes every pixel equal - met; the 3,000 large boxes at least
95 % every pixel equal and none beyond 0.5 % of its outline - met with 100 %; the wide-pen
ellipses are reported (above), no threshold in version 1. 6.5.1's wide-line cases: every pixel
equal - met.

The large boxes are drawn on a 200 x 150 canvas, each box placed so that a part of it lies on the
canvas (`cases-ellipse.ts`, `LARGE_CANVAS`); the whole outline of such a box would make the
references several megabytes. Every one of the 3,000 shapes was also compared whole, unclipped,
against GDI's own flattening (FlattenPath, below): equal.

## 2. The deviations that remain

1. **Filled wide-pen ellipses in Copy mode, through the Surface, until SH1 passes the mode.** GDI
   draws a filled ellipse with a pen 2 or more wide in `R2_COPYPEN` from the flattened polygon,
   and in every other case from the curve (section 3, step 6). The Surface does not tell
   `rasterEllipse` the mode yet, so it always takes the curve. Effect: 1 to 14 pixels per such
   ellipse, all within one pen width of the four points where the ellipse meets its box. Cured by
   the one-line change of `docs/requests/SH2-ellipse-mode.md`.
2. **Very flat or very narrow filled wide-pen ellipses in Copy**, with the mode passed: the box is
   3 to 5 pixels in one direction (one of 11), widths 3-6. In the suite: four of the 500
   (`ellipses-wide-00125`, `-00158`, `-00195`, `-00428`). The port draws 1 to 3 pen pixels more
   than GDI, each one pixel outside GDI's outline at one of the two narrow ends (for example
   `ellipses-wide-00195`, pen 3, box 3 x 75: the pixels one above the box's top centre and one
   below its bottom centre). At those ends the flattened polygon turns by nearly 180 degrees
   between two very short segments, and GDI's choice of the join there is not modelled exactly.
   The verification of SH2 found the same kind outside the suite: Copy, filled, box 8,8-58,12
   pen 6 (3 pixels); box 8,8-33,12 pen 3 in mode 158, which behaves as Copy (2 pixels); box
   10,41-14,111 pen 6 (2 pixels).
3. **Pens much wider than a narrow box, filled, Copy**, with the mode passed: 4 of 200 random
   cases with widths 9-80 (verification of SH2, family `wide-big`): box 42,42-54,84 (13 x 43) pen
   79, 16 pixels; box 39,39-55,174 (17 x 136) pen 73, 12 pixels; box 13,13-76,113 pen 21, 6
   pixels; box 22,22-34,115 (13 x 94) pen 39, 4 pixels. The pen is wider than the box, the inner
   side of the widened polygon folds over itself near the narrow ends, and the pixels differ there
   (both more and fewer than GDI). The other 196 are equal.
4. **Tiny boxes, 2 to 4 pixels with one side of 2 or 3, pens 3-20, every mode, filled and
   unfilled.** Each quarter of these boxes flattens to one segment, so the polygon is a diamond.
   Of the 285 boxes 1-4 x 1-4 (1 x 1 left out) with pens 2-20 in XOR (verification of SH2, family
   `tiny`), 272 are equal filled and 272 unfilled; the 13 that differ, each in both:
   3 x 2 pens 4 and 6, 3 x 3 pens 3, 4, 6 and 18, 4 x 2 pen 8, 4 x 3 pens 3, 4, 6, 13, 17 and 20;
   1 to 8 pixels each, all at the joins of the four ends. Example: box 18,18-20,20 (3 x 3), pen 3,
   unfilled, XOR: GDI's widened path (WidenPath) has the join vertex (-7, -23) sixteenths from
   the top end and (23, -7), (23, 7) from the right end, which are the nib's own vertices, where
   the port takes the guide vertices (-8, -24), (24, -8), (24, 8) and draws the pixels (18, 17)
   and (18, 21) more. For boxes with a side of 2 (2 x 2, 2 x 3) the guide vertices are right and
   the nib's are wrong; no rule found yet tells the two apart. The same kind shows in the boxes
   of one to three points after sorting (8 of 100 random such cases, family `point`, 2 to 6
   pixels; for example the unfilled box 13,27-15,29, pen 3, Copy: 2 pixels).
   Before the repair of round 1 the port also used curve joins (the guide vertices on the axes
   too) at the four ends, which cost 24 more of the 285 tiny boxes (248 equal) and 4 more of the
   100 one-to-three-point boxes; the four ends are now joined as two lines are
   (section 3, step 6), and `ellipse.test.ts` holds five of those GDI pictures.

These are all the differences known. The verification's probes, with the mode passed and
re-run after the repair: wide lines 15-255 (400), wide lines 2-14 across the edges (300), wide
lines in task 85/86 chains (100), one-pixel ellipses of sides 1,201-60,000 (300), large one-pixel
ellipses in other modes (300), across the edges (300), the 32/64-bit cracker boundary (63), the
largest boxes (8), wide pens on huge boxes (40) and the 32768 sum rule (4): all equal. Not
measured, and therefore not claimed: pen widths 9-255 on ellipses beyond these random samples.

## 3. What GDI does, as the port reproduces it (a reader can check each step)

Coordinates are GDI's 28.4 fixed point: 16 units per pixel, the centre of pixel (x, y) at
(16x, 16y). The ellipse box is the one EASy68K passes after sorting and its "+1": x1..x2 by
y1..y2, both corners included.

1. **Curve.** L = 16 x1, R = 16 x2, T = 16 y1, B = 16 y2; centre ((L+R)/2, (T+B)/2); radii
   rx = (R-L)/2, ry = (B-T)/2. Four cubic Bezier quarters starting at (R, cy) going up first;
   control points at kx = ceil(K rx) from the centre line in x and ky = floor(K ry) in y,
   K = 4(sqrt 2 - 1)/3. Check: GetPath of `Ellipse(3, 3, 16, 16)` is
   `(240,144) (240,91) (198,48) (144,48) (90,48) (48,91) (48,144) ...` in 1/16 pixel.
2. **Flattening.** Each quarter by GDI's hybrid forward differencing with an error of 2/3 pixel
   (the "GDI compatible" constants that WPF's MIT-licensed `bezier.cpp` documents: 6 * 0x2AA0 in
   18.14 at the start, eight times that in the steady state), the 32-bit cracker when the
   quarter's control points span less than 16,384 sixteenths in x and in y, the 64-bit cracker
   (target error 2^11 for the coarse pass, 4 << 32 for the fine one) otherwise. Check: FlattenPath
   of the ellipse gives exactly these vertices (128 points for a 2,100-pixel circle, 640 for a box
   60,001 x 801).
3. **Outline, pen width 1.** Each segment of the closed polygon as a GDI cosmetic line ("grid
   intersection quantization"): the pixel is drawn whose diamond |x - 16px| + |y - 16py| < 8 the
   segment touches; of the diamond's boundary only the right and bottom corners count (the left and
   bottom ones for a segment with dx = dy exactly); a segment does not draw the pixel whose diamond
   contains its end point, or whose counted corner is its end point, or along whose diagonal edge it
   runs to its end. Overlapping segments draw a pixel more than once (it shows in XOR). Check:
   Polyline of the vertices of step 2 (drawn with a 1/16 world transform, so the vertices keep
   their fractions) equals Ellipse.
4. **Interior.** The pixels whose centre is inside the polygon (a centre on a left edge in, on a
   right edge out, an edge counting for the rows top <= y < bottom), filled before the outline and
   overlapping it.
5. **Wide pens: the nib.** A pen of width w has a nib, a convex point-symmetric polygon (measured:
   `tables/pens.ts`; 6 to 56 vertices; from width 7 on its axis vertices lie 8w - 1 sixteenths from
   the centre). Its guide vertices are the nib's vertices one sixteenth further out in x and in y;
   its offsets are the guide vertices rounded to multiples of 8 (halves away from zero).
   **A line** P0 -> P1 becomes the polygon: P0 + offset(left), the nib vertices between left and
   right round the back of P0, P0 + offset(right), P1 + offset(right), the nib vertices round the
   front of P1, P1 + offset(left); left and right are the guide vertices furthest towards the
   screen-left and screen-right of the direction (a tie between two goes to the later one in angle
   order when dx > 0, or dx = 0 and dy > 0); a point counts as a line in +x. The polygon is filled
   by the rule of step 4 (nonzero winding). Check: WidenPath + GetPath of the line equals this
   polygon for 91,440 of 91,440 directions and widths measured, and its fill equals what LineTo
   draws.
6. **Wide-pen ellipses.** The polygon of step 2 is widened as a closed figure: each segment moved
   by its offsets, the outer side of each vertex going round the guide vertices between the two
   segments' offsets, the inner side passing through the vertex. Where GDI widens the curve itself
   (every case except the next), the first and the last segment of each quarter take their offsets
   from the quarter's end tangent instead of their own direction, a join inside a quarter goes round
   the guide vertices, a join at one of the four ends (where two quarters meet; it has vertices only
   when a quarter is one segment) is a line join: round the guide vertices except at the axis
   vertices, where the nib's are taken; and a 180-degree turn goes round the nib. A **filled**
   ellipse in **Copy** is widened from the flattened polygon instead, with line joins everywhere.
   Check: WidenPath of `Ellipse` drawn into a path for the box 18,18-20,20 with a pen 2 wide has the
   outer vertex (-15, 0) sixteenths from the left end (the nib's axis vertex), not (-16, 0). The
   interior is step 4 without the outline's pixels (every pixel once).

## 4. How the measurements were made

- The references of section 1 come from T2's capture program (`tests/oracle/gdi-capture`, the
  calls SIM68K.exe's VCL makes), from the case lists `tests/conformance/gdi/cases.ts` (T2) and
  `cases-ellipse.ts` (SH2); packs in `tests/conformance/gdi/golden/`.
- The steps of section 3 were measured with a scratch probe (not committed; recorded in
  `docs/porting/errata/SH2.md`): a 32-bit DIB section in a memory DC, the pen from
  CreatePenIndirect(PS_SOLID, width), and for fractional coordinates `SetGraphicsMode(GM_ADVANCED)`
  with the world transform scale 1/16, under which GetPath, FlattenPath and WidenPath return 28.4
  device coordinates unrounded. A pen of width 16w under that transform draws exactly what a pen of
  width w draws without it (checked on 65 lines). The nib of each width 2-255 is the union of the
  cap vertices of 360 widened lines per width. The nib capture is not yet part of the committed
  capture program (`docs/requests/SH2-gdi-nibs.md`).
- Checks besides the suites, made with the same probe: 7,096 boxes' curves (GetPath);
  300 large and 51 boundary boxes' flattening; 400 large boxes' pixels; 410 random wide lines (the
  fill of GDI's own widened path equals what GDI draws); 600 wide-pen ellipses in Copy, XOR and MergePenNot (585 equal, section 2); 300 wide-pen
  ellipses' widened paths (300 equal fills).
- The verification of SH2 (round 1) captured its own cases with T2's capture program (families
  named in section 2); the figures there are from replaying those captures on the repaired code.

## 5. Size of the tables

`app/src/core/sim-host/surface/tables/` holds `dots.ts` (SH1's measured dots, 27,764 bytes) and
`pens.ts` (the nibs, 45,903 bytes): 22,374 bytes together compressed with `gzip -9`, well under
the 300 kB of the work package. The ellipses need no table.
