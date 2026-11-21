// Lines of a pen one pixel wide (ARCHITECTURE.md 3.4 rule 3; trap15-b §6.1): the pixels GDI's
// LineTo draws from (x1, y1) to (x2, y2).
//
//   - If |dx| >= |dy| the line has one pixel in every column from x1 towards x2, otherwise one pixel
//     in every row from y1 towards y2.
//   - The END POINT IS NOT DRAWN. (EASy68K adds it afterwards with a separate SetPixel; that is the
//     surface's business, see Surface.lineTo.) A line of length zero therefore has no pixels here.
//   - In each column (row) the pixel is the one nearest to the ideal line, and an exact tie goes to
//     the smaller coordinate: up for a flat line, left for a steep one. Written out, pixel number k
//     (k = 0 at the start point) lies at offset ceil(k * d / m - 1/2) across the line, where m is
//     the longer and d the signed shorter of dx and dy. In whole numbers that is
//
//         offset(k) = floor((2 * k * d + m - 1) / (2 * m))
//
//     The set of pixels is the same in both drawing directions, apart from which end is left out.
//
// The loops below walk k with the remainder of that division carried along (no division per
// pixel), and they start and stop at the first and last pixel inside the clip rectangle, which are
// found by solving the formula for k. A line from far outside the surface costs no more than its
// visible part.
//
// Owner: SH1.

import type { PixelBuffer, Rect } from '../../../contracts';
import { mixIsIdentity, type Mix } from './rop';
import { mixSpan } from './raster';

/** The pixels of one line inside one clip rectangle, ready to be walked. */
interface Walk {
  /** True: one pixel per column, `major` is x. False: one pixel per row, `major` is y. */
  xMajor: boolean;
  /** Number of pixels. */
  count: number;
  /** Coordinates of the first pixel, along and across the line's main direction. */
  major: number;
  minor: number;
  /** +1 or -1: the direction `major` moves in. */
  step: number;
  /** Remainder of the division in offset(k) for the first pixel; 0 <= rem < mod. */
  rem: number;
  /** What a step adds to the dividend (2 * d, signed) and the divisor (2 * m). */
  inc: number;
  mod: number;
}

/**
 * Prepares the walk over the pixels of the line (x1, y1) - (x2, y2), end point excluded, that lie
 * in the rectangle left..right-1 by top..bottom-1. Null if there are none.
 */
function prepare(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Walk | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const xMajor = Math.abs(dx) >= Math.abs(dy);
  // "a" is the main direction of the line, "b" the direction across it.
  const a1 = xMajor ? x1 : y1;
  const b1 = xMajor ? y1 : x1;
  const da = xMajor ? dx : dy;
  const d = xMajor ? dy : dx;
  const m = Math.abs(da);
  if (m === 0) return null; // zero length: LineTo draws nothing
  const aLow = xMajor ? left : top;
  const aHigh = (xMajor ? right : bottom) - 1;
  const bLow = xMajor ? top : left;
  const bHigh = (xMajor ? bottom : right) - 1;
  const step = da > 0 ? 1 : -1;

  // Pixel k is at a = a1 + step * k, for k = 0 .. m - 1. Keep the k whose pixel is inside the clip.
  let first = 0;
  let last = m - 1;
  if (step > 0) {
    first = Math.max(first, aLow - a1);
    last = Math.min(last, aHigh - a1);
  } else {
    first = Math.max(first, a1 - aHigh);
    last = Math.min(last, a1 - aLow);
  }
  // offset(k) must lie in offsetLow .. offsetHigh. It never decreases with k if d > 0 and never
  // increases if d < 0, so each bound gives one bound on k.
  const offsetLow = bLow - b1;
  const offsetHigh = bHigh - b1;
  if (d === 0) {
    if (offsetLow > 0 || offsetHigh < 0) return null;
  } else if (d > 0) {
    // offset(k) >= offsetLow   <=>   2*k*d >= 2*m*offsetLow - m + 1
    first = Math.max(first, Math.ceil((2 * m * offsetLow - m + 1) / (2 * d)));
    // offset(k) <= offsetHigh  <=>   2*k*d <  2*m*(offsetHigh + 1) - m + 1
    last = Math.min(last, Math.ceil((2 * m * (offsetHigh + 1) - m + 1) / (2 * d)) - 1);
  } else {
    // offset(k) <= offsetHigh  <=>   2*k*|d| >  m - 1 - 2*m*(offsetHigh + 1)
    first = Math.max(first, Math.floor((m - 1 - 2 * m * (offsetHigh + 1)) / (2 * -d)) + 1);
    // offset(k) >= offsetLow   <=>   2*k*|d| <= m - 1 - 2*m*offsetLow
    last = Math.min(last, Math.floor((m - 1 - 2 * m * offsetLow) / (2 * -d)));
  }
  if (first > last) return null;

  const dividend = 2 * first * d + m - 1;
  const offset = Math.floor(dividend / (2 * m));
  return {
    xMajor,
    count: last - first + 1,
    major: a1 + step * first,
    minor: b1 + offset,
    step,
    rem: dividend - offset * 2 * m,
    inc: 2 * d,
    mod: 2 * m,
  };
}

/**
 * Draws the line (x1, y1) - (x2, y2) of a one-pixel pen into the buffer, clipped, WITHOUT its end
 * point: exactly what GDI's LineTo does.
 */
export function drawLine(buffer: PixelBuffer, x1: number, y1: number, x2: number, y2: number, mix: Mix): void {
  if (mixIsIdentity(mix)) return;
  if (y1 === y2) {
    // A horizontal line is one run of pixels.
    if (x1 < x2) mixSpan(buffer, y1, x1, x2 - 1, mix);
    else if (x1 > x2) mixSpan(buffer, y1, x2 + 1, x1, mix);
    return;
  }
  const walk = prepare(x1, y1, x2, y2, 0, 0, buffer.width, buffer.height);
  if (!walk) return;
  const data = buffer.data;
  const width = buffer.width;
  const { keep, flip } = mix;
  const { inc, mod } = walk;
  // Index of the pixel, and what a step along and a step across the line add to it.
  let i = walk.xMajor ? walk.minor * width + walk.major : walk.major * width + walk.minor;
  const along = walk.xMajor ? walk.step : walk.step * width;
  const across = walk.xMajor ? width : 1;
  let rem = walk.rem;
  for (let n = walk.count; n > 0; n--) {
    data[i] = ((data[i] as number) & keep) ^ flip;
    i += along;
    rem += inc;
    if (rem >= mod) {
      rem -= mod;
      i += across;
    } else if (rem < 0) {
      rem += mod;
      i -= across;
    }
  }
}

/**
 * Calls `visit(x, y)` for the pixels of the line (x1, y1) - (x2, y2) of a one-pixel pen that lie in
 * `clip`, in drawing order and without the end point. For code that draws something other than one
 * pixel at each of them (the wide-pen stroke).
 */
export function walkLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  clip: Rect,
  visit: (x: number, y: number) => void,
): void {
  const walk = prepare(x1, y1, x2, y2, clip.left, clip.top, clip.right, clip.bottom);
  if (!walk) return;
  const { xMajor, step, inc, mod } = walk;
  let { major, minor, rem } = walk;
  for (let n = walk.count; n > 0; n--) {
    if (xMajor) visit(major, minor);
    else visit(minor, major);
    major += step;
    rem += inc;
    if (rem >= mod) {
      rem -= mod;
      minor++;
    } else if (rem < 0) {
      rem += mod;
      minor--;
    }
  }
}

/** True if the line (x1, y1) - (x2, y2) has one pixel per column rather than one per row. */
export function isXMajor(x1: number, y1: number, x2: number, y2: number): boolean {
  return Math.abs(x2 - x1) >= Math.abs(y2 - y1);
}
