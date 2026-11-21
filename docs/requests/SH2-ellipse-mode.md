# SH2 request: the Surface tells `rasterEllipse` whether it draws in Copy mode

- From: SH2 (ellipses and wide pens). To: SH1 (owner of `app/src/core/sim-host/surface/surface.ts`).
- Status: done by SH1 at gate I2 round 1, as asked (`surface.ts` passes `MODE_TABLE[penMode & 0xff] === 4`; test "a filled wide-pen ellipse tells rasterEllipse whether the mode draws as Copy" in `surface.test.ts`). `ellipse.gdi.test.ts` now prints 496 of 500 through the Surface and T2's `clip` cases all pass; raising `BASELINE.wideEqualSurface` to 496 is left to SH2 (its test). SH2 raised it at gate I2 round 1; closed.

## What

In `Surface.drawEllipse` (surface.ts), pass a ninth argument to `rasterEllipse`: whether the
effective drawing mode is Copy (mode 4 of trap15-b §5.4, `R2_COPYPEN`; also the modes 18-255 that
behave as mode 4, i.e. value 158):

```ts
import { MODE_TABLE } from './rop';
...
rasterEllipse(
  x1, y1, x2, y2, width,
  { left: 0, top: 0, right: back.width, bottom: back.height },
  outline,
  interior,
  MODE_TABLE[this.state.penMode & 0xff] === 4, // GDI fills and strokes a filled ellipse in one pass in Copy
);
```

`rasterEllipse(x1, y1, x2, y2, penWidth, clip, outline, interior, copyMode = false)` already takes
the argument (ellipse.ts); nothing else changes.

## Why

Measured on Windows GDI (docs/porting/gdi-deviations.md, "Wide-pen ellipses"): an ellipse drawn
with a pen 2 or more pixels wide **and** a brush, in `R2_COPYPEN`, is drawn from the flattened
polygon widened as a polygon (as `FlattenPath` + `WidenPath` would make it); in every other case
(unfilled, or any of the other 15 operations, `R2_WHITE` and `R2_NOTCOPYPEN` included) GDI widens
the curve itself, and the two outlines differ by a few pixels near the four ends of the ellipse.
The operation cannot be read from the two `SpanSink`s the Surface passes, so `rasterEllipse` must
be told. A one-pixel pen does not depend on it.

## Effect

- Without it, `tests/conformance/gdi/surface.test.ts` (T2) fails 3 of the 343 `clip` cases
  (`clip-00202`, `clip-00217`, `clip-00230`: filled wide-pen ellipses in Copy, 1-4 pixels each).
  With `copyMode` they are equal (checked by replaying them on `rasterEllipse` directly).
- In SH2's own suite `ellipses-wide` (500 cases), through the Surface: 361 every pixel equal
  today, 496 with the argument passed (`ellipse.gdi.test.ts` prints both figures and holds the
  first; raise `BASELINE.wideEqualSurface` to 496 when this lands).
