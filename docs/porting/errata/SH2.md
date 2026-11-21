# Errata of SH2 (Ellipses and wide pens)

What SH2 found while building `app/src/core/sim-host/surface/ellipse.ts`, `widepen.ts` and
`tables/pens.ts`: where `docs/ARCHITECTURE.md` or `docs/porting/trap15-tasks-60-up.md` (trap15-b)
is silent, wrong or cannot be met as written, what the code does, and why. The measured results are
in `docs/porting/gdi-deviations.md`. Entries under **Contract** concern what other packages build on.

## Contract

### C1. `rasterEllipse` reports a pixel more than once, and the interior before the outline

- SH1's stub documented "EVERY PIXEL IS REPORTED EXACTLY ONCE, to one of the two" (3.4 does not
  say). GDI does not do that: with a one-pixel pen the interior overlaps the outline, and an outline
  pixel touched by two segments is drawn twice (a 1 x 8 box: the six inner pixels twice, the two
  ends once; trap15-b §6.3 found the same for one-pixel rectangle runs). Measured on all 4,096 box
  sizes 1-64 in XOR and in MergePenNot (suite `ellipses`).
- Does: `rasterEllipse` reports every interior run first, then the outline, each pixel as often as
  GDI draws it. The Surface's sinks combine every report, so the Surface itself needed no change.
  With a wider pen the outline is one filled shape (every pixel once) and the interior leaves it out.

### C2. `rasterEllipse` needs to know whether the mode is Copy (request `docs/requests/SH2-ellipse-mode.md`)

- Measured: a filled ellipse with a pen 2 or more wide in `R2_COPYPEN` is drawn from the flattened
  polygon; in every other operation (also `R2_WHITE`, `R2_BLACK`, `R2_NOTCOPYPEN`) and unfilled,
  from the curve. The difference is a few pixels near the four ends. The two sinks cannot tell.
- Does: `rasterEllipse(..., interior, copyMode = false)`, a ninth optional argument. The Surface
  (SH1) does not pass it yet, so filled wide-pen ellipses in Copy take the curve: T2's
  `surface.test.ts` fails 3 of the 343 `clip` cases (`clip-00202`, `clip-00217`, `clip-00230`, 1-4
  pixels each) until SH1 applies the one-line change of the request. All three are equal with the
  argument passed (checked by replaying them on `rasterEllipse`).

### C3. New exports inside the surface folder

`ellipse.ts`: `ellipseQuarters`, `ellipsePolygon`, `flattenBezier`, `giqSegment`, `BEZIER_KAPPA`
(for tests and for anyone who needs GDI's flattened ellipse). `widepen.ts`: `widenSegment`,
`widenClosed`, `fillPolygons`, `FixPoint`. `tables/pens.ts`: `penNib`, `Nib`. The signatures the
Surface calls (`rasterEllipse`, `strokeWideLine`) are unchanged apart from C2's optional argument.

## Against trap15-b

### 1. §6.4: the ellipse model is exact, not a starting point

- Says: a model with constant 0.5523, vertices rounded to 1/16, 2/4/8/16 segments per quarter,
  "reproduces 70 of the 138 circle sizes", "the exact GDI flattening and end-point rules are
  UNVERIFIED"; "Outline and interior are each combined once".
- Measured (V12 settled): the control points round **up** in x and **down** in y
  (kx = ceil(K rx), ky = floor(K ry)); the flattening is GDI's hybrid forward differencing with
  error 2/3 pixel (the segment counts follow from it, they are not a separate rule); the outline is
  GIQ with the corner rules of gdi-deviations.md section 3 step 3, including two rules no
  documentation states (a segment of slope exactly -1 counts the right and bottom corners as any
  other; a segment that runs along a diamond's diagonal edge to its end does not draw that pixel);
  the interior overlaps the outline (C1).
- Proposed text for §6.4: replace the model paragraph by the six steps of gdi-deviations.md
  section 3, and "Outline and interior are each combined once" by "The interior is filled first,
  then the outline is drawn over it; the two overlap, and outline pixels touched by two segments
  are drawn twice (visible in non-Copy modes)".

### 2. §6.2: a wide line is a filled polygon made from the pen's nib, not a band with discs

- Says (PORT): "stroke = the band of half-widths a/b around the width-1 line plus a disc of the dot
  shape at each end; validate against captured GDI output." And V11 open.
- Measured (V11 settled for lines): GDI widens the line into a polygon from a per-width nib
  (gdi-deviations.md step 5) and fills it. The band c-a..c+b of §6 and the dots follow from that
  construction; a band plus two dots is one pixel too many at the start of even widths (SH1 errata
  11 saw that). The zero-length line's fill equals SH1's measured `penDot` table for every width
  2-255 (unit test), two independent measurements of the same thing.
- Proposed text for §6.2, PORT: "GDI widens each line into a polygon: the two long sides are the
  line moved by the pen's offsets (multiples of half a pixel), the round ends are vertices of a
  measured per-width pen polygon; the polygon is filled with the fill rule of §6.4's interior."

### 3. §6.4, wide pens: two different outlines (C2)

- Says: "the outline is thickened around the width-1 path and is not symmetric for even widths.
  UNVERIFIED beyond the two samples."
- Measured: see gdi-deviations.md step 6. 496 of 500 random wide-pen ellipses are reproduced
  pixel for pixel (with C2's argument); the four that are not are very flat. Further families that
  still differ (tiny boxes, pens much wider than a narrow box) are listed in gdi-deviations.md
  section 2.

## Against ARCHITECTURE.md

### 4. 3.4 rule 4 "round caps from the dot table"

- The caps are not the dots: they are vertices of the nib (`tables/pens.ts`), and only a
  zero-length line fills exactly the dot. `widepen.ts` uses the nib; `penDot` remains the dot of a
  one-point ellipse (and of SH1's rectangles). `tables/dots.ts` asked SH2 "whether the round caps
  of wide lines are parts of penDot": they are not, as above.

### 5. 6.5.2: the 3,000 large boxes show only a part of each ellipse

- Says: 3,000 random boxes with sides 65 to 1,200.
- Does: the boxes are drawn on a 200 x 150 canvas, each placed so that a part of it shows
  (`cases-ellipse.ts`). Whole ellipses up to 1,200 x 1,200 would make the references several
  megabytes; the three packs are 706 kB together (T2's whole set was 0.85 MB). "0.5 % of its
  outline" is taken as 0.5 % of the number of pixels of the whole outline. The whole shapes were
  compared separately with GDI's FlattenPath (equal) and 400 further large boxes pixel for pixel
  (equal); the committed suite is 3,000 of 3,000 equal.

### 6. The packs of the new suites live in T2's folder

- The task gave SH2 `tests/conformance/gdi/cases-ellipse.ts` only. T2's README says run.mjs
  captures those cases "into packs named after their suites", in `golden/`. SH2 captured them with
  T2's program (`build/gdi-capture/gdi-capture.exe cases`, packed with T2's `encodePack`, as
  run.mjs does) and added `golden/ellipses.pixpack.gz`, `golden/ellipses-large.pixpack.gz`,
  `golden/ellipses-wide.pixpack.gz`; no file of T2's was changed. `npm run oracle:gdi` regenerates
  the same three files from the case list. The test that reads them is SH2's
  (`app/src/core/sim-host/surface/ellipse.gdi.test.ts`); T2's `surface.test.ts` reads only the
  suites listed in `cases.ts`.

### 7. A scratch probe, not committed

- The steps of gdi-deviations.md section 3 and the nib table were measured with a small C++ probe
  in `build/SH2/probe/probe.cpp` (git-ignored): GDI calls under a 1/16 world transform, GetPath,
  FlattenPath, WidenPath. It is not part of the repository; `docs/requests/SH2-gdi-nibs.md` asks T2
  to add the nib capture to the committed capture program.

### 8. Repair round 1: the joins at the four ends of a wide-pen ellipse

- The verifier found tiny boxes (2-4 pixels, one side 2 or 3) drawing 1-9 pixels more than GDI
  with wide pens, in every mode. Cause: where a quarter flattens to one segment, the joins at the
  four ends of the ellipse have vertices, and the code joined them as inside a curve (guide
  vertices everywhere); GDI's WidenPath shows a line join there (the nib's vertices on the axes).
  `widenClosed`'s last argument may now be a per-vertex array; `rasterEllipse` passes line joins at
  the four ends. Tiny boxes: 248 -> 272 of 285 equal; boxes of one to three points: 88 -> 92 of
  100; every committed suite unchanged. What remains is in gdi-deviations.md section 2, item 4.

## Notes

- Performance (Node 24, this machine, best of three): a 65,536 x 32,001 ellipse on a 640 x 480
  surface 16 ms (127 ms on 4,096 x 4,096); a 4,096 x 4,096 ellipse with a 255-wide pen 59 ms; a
  64 x 64 ellipse 0.2 ms; 1,000 wide lines of width 9 across 640 x 480 141 ms.
- The 64-bit cracker uses BigInt (it runs only for quarters of 1,024 pixels or more).
