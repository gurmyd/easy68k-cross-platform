// Rectangles (ARCHITECTURE.md 3.4 rule 5; trap15-b §6.3): the pixels of GDI's Rectangle as EASy68K
// calls it, for every pen width.
//
// The corners (x1, y1) and (x2, y2) are both part of the rectangle and are sorted first. With a pen
// of width w (0 counts as 1), a = floor(w / 2) and b = floor((w - 1) / 2) - a wide stroke centred on
// c covers c - a .. c + b - there are three cases:
//
//   A  x1 < x2 and y1 < y2. The outline is the frame between the outer rectangle
//      x1-a .. x2+b by y1-a .. y2+b and the inner rectangle x1+b+1 .. x2-a-1 by y1+b+1 .. y2-a-1,
//      corners square. The inner rectangle is the interior. If it is empty, everything is outline.
//   B  exactly one side has length zero. Pen width 1: a straight run of pixels with both ends.
//      Wider: a flat-ended bar that leaves out its far end, x1 .. x2-1 by y1-a .. y1+b (or the same
//      turned by 90 degrees). No interior.
//   C  one point. Pen width 1: nothing at all. Wider: the round dot of the pen.
//
// The outline is drawn with the pen and the interior with the fill, each pixel exactly once, which
// is what makes the XOR-type modes come out right. There is ONE EXCEPTION, found by the GDI capture
// and not in trap15-b: in case B with pen width 1, GDI walks the outline of a box without height
// (or width) along the run and back again, so the two end pixels are combined once and every pixel
// between them TWICE. In Copy mode that shows nothing. In mode 14 only the two ends are drawn.
//
// Owner: SH1.

import type { PixelBuffer } from '../../../contracts';
import { mixTwice, type Mix } from './rop';
import { mixBlock, mixDot, mixPixel } from './raster';

/**
 * Draws the rectangle with the corners (x1, y1) and (x2, y2), in any order, into the buffer.
 * `pen` draws the outline; `fill` draws the interior, or is null to leave it untouched (task 90).
 */
export function drawRectangle(
  buffer: PixelBuffer,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  penWidth: number,
  pen: Mix,
  fill: Mix | null,
): void {
  if (x1 > x2) [x1, x2] = [x2, x1];
  if (y1 > y2) [y1, y2] = [y2, y1];
  const w = Math.max(penWidth, 1);
  const a = w >> 1;
  const b = (w - 1) >> 1;

  if (x1 < x2 && y1 < y2) {
    // Case A.
    const outerLeft = x1 - a;
    const outerTop = y1 - a;
    const outerRight = x2 + b;
    const outerBottom = y2 + b;
    const innerLeft = x1 + b + 1;
    const innerTop = y1 + b + 1;
    const innerRight = x2 - a - 1;
    const innerBottom = y2 - a - 1;
    if (innerLeft > innerRight || innerTop > innerBottom) {
      mixBlock(buffer, outerLeft, outerTop, outerRight, outerBottom, pen);
      return;
    }
    mixBlock(buffer, outerLeft, outerTop, outerRight, innerTop - 1, pen); // top side, corners included
    mixBlock(buffer, outerLeft, innerBottom + 1, outerRight, outerBottom, pen); // bottom side
    mixBlock(buffer, outerLeft, innerTop, innerLeft - 1, innerBottom, pen); // left side between them
    mixBlock(buffer, innerRight + 1, innerTop, outerRight, innerBottom, pen); // right side
    if (fill) mixBlock(buffer, innerLeft, innerTop, innerRight, innerBottom, fill);
  } else if (x1 === x2 && y1 === y2) {
    // Case C.
    if (w > 1) mixDot(buffer, x1, y1, w, pen);
  } else if (w === 1) {
    // Case B, pen width 1: the run from one corner to the other; there and back between the ends.
    mixPixel(buffer, x1, y1, pen);
    mixPixel(buffer, x2, y2, pen);
    const twice = mixTwice(pen);
    if (y1 === y2) mixBlock(buffer, x1 + 1, y1, x2 - 1, y1, twice);
    else mixBlock(buffer, x1, y1 + 1, x1, y2 - 1, twice);
  } else if (y1 === y2) {
    // Case B, wide pen, horizontal: the far end (x2) is left out.
    mixBlock(buffer, x1, y1 - a, x2 - 1, y1 + b, pen);
  } else {
    // Case B, wide pen, vertical: the far end (y2) is left out.
    mixBlock(buffer, x1 - a, y1, x1 + b, y2 - 1, pen);
  }
}
