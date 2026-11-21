// Ellipses (ARCHITECTURE.md 3.4 rule 6; trap15-b §6.4).
//
// STUB written by SH1 (wave 1). SH2 replaces the body with GDI's shape (flattened Bezier quarters,
// with captured tables for small boxes; acceptance in 6.5.2) and owns this file from then on. The
// Surface calls `rasterEllipse` and nothing else; its signature is what SH2 keeps.
//
// What this stub draws: a plain, mathematically ideal ellipse inscribed in the box. GDI's ellipse is
// NOT that (it is a polygon, and about one size in eight is not even symmetric), so the pixels here
// are right in shape and position but, beyond the smallest circles, not pixel for pixel. What the
// stub does get right, because trap15-b §6.4 states it exactly:
//   - the shape touches all four sides of the box x1..x2 by y1..y2 (both corners included);
//   - a box of one point draws nothing with a one-pixel pen and the pen's round dot with a wider one;
//   - a box one pixel wide or high draws a straight run of pen pixels;
//   - a 2 x 2 box draws only the two pixels of its left column;
//   - outline and interior do not overlap and each of their pixels is reported once.
// Wide pens: the outline is the ring between the ellipse of the box grown by the pen and the ellipse
// of the box shrunk by it, the same way a wide rectangle's frame is built (rect.ts).
//
// What the caller does, and this file does not: sorting the corners, the "nothing if
// x1 + y1 + x2 + y2 >= 32768" rule, clipping in x, and the drawing mode.
//
// Owner: SH1 > SH2.

import type { Rect } from '../../../contracts';
import type { SpanSink } from './raster';
import { dotRows } from './tables/dots';

/** An ideal ellipse inscribed in the box left..right by top..bottom (all four included). */
class Inscribed {
  /** Left and right end of the row last asked for (both included). */
  rowLeft = 0;
  rowRight = -1;
  private readonly columns: number;
  private readonly rows: number;

  constructor(
    private readonly left: number,
    readonly top: number,
    private readonly right: number,
    readonly bottom: number,
  ) {
    this.columns = right - left + 1;
    this.rows = bottom - top + 1;
  }

  get empty(): boolean {
    return this.columns <= 0 || this.rows <= 0;
  }

  /** Sets rowLeft and rowRight to the run of row y; false if the ellipse has no pixel in that row. */
  row(y: number): boolean {
    if (this.empty || y < this.top || y > this.bottom) return false;
    // Twice the distance of the row's pixel centres from the centre line, in pixels.
    const fromCentre = 2 * (y - this.top) + 1 - this.rows;
    if (Math.abs(fromCentre) <= 1) {
      // The middle row, or the two middle rows of an even height, reach the sides of the box.
      this.rowLeft = this.left;
      this.rowRight = this.right;
      return true;
    }
    // The radii are a quarter of a pixel short of half the box. With them the small circles come out
    // as GDI draws them (3 to 9 pixels across, trap15-b §6.4); it has no deeper meaning.
    const t = fromCentre / (this.rows - 0.5);
    const half = ((this.columns - 0.5) / 2) * Math.sqrt(Math.max(0, 1 - t * t));
    const centre = (this.columns - 1) / 2; // of the box, counted from its left column
    // Every row has at least the middle column(s), so that the shape reaches the top and the bottom.
    this.rowLeft = this.left + Math.min(Math.ceil(centre - half), Math.floor(centre));
    this.rowRight = this.left + Math.max(Math.floor(centre + half), Math.ceil(centre));
    return true;
  }
}

/**
 * Reports the pixels of the ellipse in the box (x1, y1) - (x2, y2) to the two receivers, as runs of
 * pixels: the outline (what the pen draws) to `outline`, the inside (what the fill draws) to
 * `interior`, which is null for an outline-only ellipse (task 91). EVERY PIXEL IS REPORTED EXACTLY
 * ONCE, to one of the two.
 *
 * The corners are sorted (x1 <= x2, y1 <= y2) and both belong to the box. `penWidth` is 1-255.
 * `clip` is the surface (right and bottom exclusive). Pixels outside it need not be reported; the
 * receiver clips what it gets.
 */
export function rasterEllipse(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  penWidth: number,
  clip: Rect,
  outline: SpanSink,
  interior: SpanSink | null,
): void {
  const columns = x2 - x1 + 1;
  const rows = y2 - y1 + 1;

  if (columns === 1 && rows === 1) {
    if (penWidth > 1) {
      const dot = dotRows(penWidth);
      for (let i = 0; i < dot.length; i++) {
        const half = dot[i] as number;
        outline(y1 - i, x1 - half, x1 + half);
        if (i > 0) outline(y1 + i, x1 - half, x1 + half);
      }
    }
    return;
  }

  if (penWidth === 1) {
    if (columns === 1 || rows === 1) {
      for (let y = Math.max(y1, clip.top); y <= Math.min(y2, clip.bottom - 1); y++) outline(y, x1, x2);
      return;
    }
    if (columns === 2 && rows === 2) {
      outline(y1, x1, x1);
      outline(y2, x1, x1);
      return;
    }
    thinEllipse(new Inscribed(x1, y1, x2, y2), clip, outline, interior);
    return;
  }

  const a = penWidth >> 1;
  const b = (penWidth - 1) >> 1;
  const outer = new Inscribed(x1 - a, y1 - a, x2 + b, y2 + b);
  const inner = new Inscribed(x1 + b + 1, y1 + b + 1, x2 - a - 1, y2 - a - 1);
  for (let y = Math.max(outer.top, clip.top); y <= Math.min(outer.bottom, clip.bottom - 1); y++) {
    if (!outer.row(y)) continue;
    const left = outer.rowLeft;
    const right = outer.rowRight;
    if (!inner.row(y)) {
      outline(y, left, right);
      continue;
    }
    const innerLeft = Math.max(inner.rowLeft, left);
    const innerRight = Math.min(inner.rowRight, right);
    if (innerLeft > left) outline(y, left, innerLeft - 1);
    if (innerRight < right) outline(y, innerRight + 1, right);
    interior?.(y, innerLeft, innerRight);
  }
}

/**
 * A one-pixel outline: the pixels of the shape that have a neighbour outside it above, below, left
 * or right. The rest of the shape is the interior.
 */
function thinEllipse(shape: Inscribed, clip: Rect, outline: SpanSink, interior: SpanSink | null): void {
  for (let y = Math.max(shape.top, clip.top); y <= Math.min(shape.bottom, clip.bottom - 1); y++) {
    // The columns that are inside the shape in both the row above and the row below.
    let coveredLeft = Infinity;
    let coveredRight = -Infinity;
    if (shape.row(y - 1)) {
      coveredLeft = shape.rowLeft;
      coveredRight = shape.rowRight;
      if (shape.row(y + 1)) {
        coveredLeft = Math.max(coveredLeft, shape.rowLeft);
        coveredRight = Math.min(coveredRight, shape.rowRight);
      } else {
        coveredLeft = Infinity;
        coveredRight = -Infinity;
      }
    }
    if (!shape.row(y)) continue;
    const left = shape.rowLeft;
    const right = shape.rowRight;
    // Outline: the two ends of the row, and whatever is not covered from above and below.
    const leftEnd = Math.min(right, Math.max(left, coveredLeft - 1));
    const rightStart = Math.max(left, Math.min(right, coveredRight + 1));
    if (leftEnd + 1 >= rightStart) {
      outline(y, left, right);
    } else {
      outline(y, left, leftEnd);
      outline(y, rightStart, right);
      interior?.(y, leftEnd + 1, rightStart - 1);
    }
  }
}
