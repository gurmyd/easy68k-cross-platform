// Ellipses (ARCHITECTURE.md 3.4 rule 6; trap15-b §6.4, §15 V12). Owner: SH2.
//
// GDI's ellipse, reproduced step by step as Windows does it. Every step was measured on Windows
// GDI separately (the curve with GetPath, the flattened polygon with FlattenPath, the pixels of
// the polygon with Polyline), and the whole against Ellipse itself; docs/porting/gdi-deviations.md
// has the figures and a description a reader can check.
//
// 1. THE CURVE. The box x1..x2 by y1..y2 (both corners included) becomes, in 28.4 fixed point
//    (16 units per pixel, pixel centres on multiples of 16), the box L = 16 x1, R = 16 x2,
//    T = 16 y1, B = 16 y2 with centre (cx, cy) = ((L + R) / 2, (T + B) / 2) and radii
//    rx = (R - L) / 2, ry = (B - T) / 2. Four cubic Bezier quarters, starting at the right end
//    (R, cy) and going up first: right -> top -> left -> bottom -> right. Each quarter's control
//    points lie on the box at distance kx = ceil(K rx) from the centre line in x and
//    ky = floor(K ry) in y, K = 4 (sqrt 2 - 1) / 3; so the quarter right -> top is
//    (R, cy), (R, cy - ky), (cx + kx, T), (cx, T). (x rounds up, y rounds down: measured on 7,096
//    boxes from 1 x 1 to 1200 x 1200.)
// 2. FLATTENING. Each quarter becomes straight segments by GDI's hybrid forward differencing (the
//    Bezier "cracker" of Goossen and Olynyk), with GDI's error of 2/3 pixel: the 32-bit cracker
//    when the control points span less than 1024 pixels in x and in y, the 64-bit one otherwise.
//    The vertices are in 28.4 fixed point.
// 3. OUTLINE (pen width 1). The closed polygon is drawn as GDI draws a cosmetic line, segment by
//    segment (grid intersection quantization, "GIQ"): a pixel is drawn when the segment touches
//    the diamond |x - px| + |y - py| < 1/2 around its centre. Of the diamond's boundary only the
//    right and bottom corners count, for a segment of slope exactly +1 (dx = dy) the left and bottom
//    corners. A segment does not draw the pixel whose diamond its end point lies in (or on a
//    counted corner of), nor the pixel whose diagonal boundary it runs along to its end. Pixels
//    where segments overlap are drawn as often as segments touch them (visible in the XOR modes).
// 4. INTERIOR. The pixels whose centre lies inside the polygon (a centre on a left edge inside, on
//    a right edge outside, an edge counting for the rows top <= y < bottom), drawn BEFORE the
//    outline and overlapping it; in Copy mode the outline covers the overlap, in XOR it shows.
// 5. WIDE PENS. The polygon of step 2 is widened as a closed figure (widepen.ts, widenClosed) and
//    filled; the interior is step 4 without the pixels of that outline. GDI does this two ways: a
//    FILLED ellipse in COPY mode is widened from the flattened polygon; every other one from the
//    curve, where the first and last segment of each quarter (of a quarter with two or more) take
//    their offsets from the quarter's end tangent, joins inside a quarter are curve joins and the
//    joins at the four ends, where two quarters meet, are line joins (they matter only when a
//    quarter is one segment). A box of one point draws the pen's measured dot (tables/dots.ts).
//
// Steps 1-4 give every pixel of every box from 1 x 1 to 64 x 64 (filled, unfilled, single and
// double visits) and of the larger boxes of 6.5.2. Step 5 gives 496 of 500 random wide-pen
// ellipses; the families that still differ (very flat or very narrow boxes, a few tiny boxes,
// pens much wider than the box) are described in docs/porting/gdi-deviations.md section 2.
//
// What the caller does, and this file does not: sorting the corners, the "nothing if
// x1 + y1 + x2 + y2 >= 32768" rule, clipping in x, and the drawing mode.

import type { Rect } from '../../../contracts';
import { emitDot, type SpanSink } from './raster';
import { penDot } from './tables/dots';
import { fillPolygons, widenClosed, type FixPoint } from './widepen';

/** The Bezier constant of a quarter circle, 4 (sqrt 2 - 1) / 3. */
export const BEZIER_KAPPA = (4 * (Math.SQRT2 - 1)) / 3;

/** The four Bezier quarters of the box's ellipse, in 28.4 fixed point (step 1). */
export function ellipseQuarters(x1: number, y1: number, x2: number, y2: number): FixPoint[][] {
  const L = 16 * x1;
  const R = 16 * x2;
  const T = 16 * y1;
  const B = 16 * y2;
  const cx = (L + R) / 2;
  const cy = (T + B) / 2;
  const kx = Math.ceil(((R - L) / 2) * BEZIER_KAPPA);
  const ky = Math.floor(((B - T) / 2) * BEZIER_KAPPA);
  const right = { x: R, y: cy };
  const top = { x: cx, y: T };
  const left = { x: L, y: cy };
  const bottom = { x: cx, y: B };
  return [
    [right, { x: R, y: cy - ky }, { x: cx + kx, y: T }, top],
    [top, { x: cx - kx, y: T }, { x: L, y: cy - ky }, left],
    [left, { x: L, y: cy + ky }, { x: cx - kx, y: B }, bottom],
    [bottom, { x: cx + kx, y: B }, { x: R, y: cy + ky }, right],
  ];
}

/** The flattened ellipse: the closed polygon, starting and ending at the right end (step 2). */
export function ellipsePolygon(x1: number, y1: number, x2: number, y2: number): FixPoint[] {
  return flattenedEllipse(x1, y1, x2, y2).points;
}

/**
 * The flattened ellipse; per segment, the direction a wide pen takes its offsets from (step 5): the
 * curve's own end tangent (control point minus end point) for the first and the last segment of
 * each quarter, null (the segment's own direction) for the others; and per vertex, whether a wide
 * pen joins there as inside a curve (true) or as between two lines (false: the four ends, where
 * the quarters meet).
 */
function flattenedEllipse(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { points: FixPoint[]; directions: (FixPoint | null)[]; curveJoins: boolean[] } {
  const quarters = ellipseQuarters(x1, y1, x2, y2);
  const points: FixPoint[] = [quarters[0]![0]!];
  const directions: (FixPoint | null)[] = [];
  const curveJoins: boolean[] = [];
  for (const q of quarters) {
    const flat = flattenBezier(q);
    curveJoins.push(false);
    for (let i = 1; i < flat.length; i++) curveJoins.push(true);
    points.push(...flat);
    const [p0, c1, c2, p3] = q as [FixPoint, FixPoint, FixPoint, FixPoint];
    for (let i = 0; i < flat.length; i++) {
      let d: FixPoint | null = null;
      // A quarter of one segment takes the segment's own direction.
      if (flat.length > 1) {
        if (i === 0 && (c1.x !== p0.x || c1.y !== p0.y)) d = { x: c1.x - p0.x, y: c1.y - p0.y };
        if (i === flat.length - 1 && (p3.x !== c2.x || p3.y !== c2.y)) d = { x: p3.x - c2.x, y: p3.y - c2.y };
      }
      directions.push(d);
    }
  }
  return { points, directions, curveJoins };
}

/* ------------------------------------------------------------------ flattening (step 2) */

// The cracker below (Basis32, Basis64, flattenBezier, flatten64) follows the structure of the
// hybrid forward-differencing flattener of WPF, bezier.cpp (CHfdBasis32, CHfdBasis64,
// CBezierFlattener) in https://github.com/dotnet/wpf, as ported to Rust in Mozilla's
// wpf-gpu-raster (bezier.rs); GDI's own constants (error, shifts, the 32/64-bit switch) are the
// measured ones of step 2. That code is used under the MIT License:
//
//   The MIT License (MIT)
//
//   Copyright (c) .NET Foundation and Contributors
//
//   All rights reserved.
//
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
//   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// 32-bit cracker: 28.4 input shifted into 18.14 for the start, 15.17 in the steady state.
const HFD32_INITIAL_SHIFT = 10;
const HFD32_ADDITIONAL_SHIFT = 3;
const HFD32_SHIFT = HFD32_INITIAL_SHIFT + HFD32_ADDITIONAL_SHIFT;
const HFD32_ROUND = 1 << (HFD32_SHIFT - 1);
/** GDI's error of 2/3 pixel, times 6, in 18.14 (the 32-bit cracker's start phase). */
const HFD32_INITIAL_TEST = 6 * 0x2aa0;
const HFD32_TEST = HFD32_INITIAL_TEST << HFD32_ADDITIONAL_SHIFT;
/** The 32-bit cracker takes curves whose control points span less than this many 1/16 in x and in y. */
const HFD32_MAX_SPAN = 0x4000;

/** One coordinate of the forward-difference basis. Plain numbers: every value stays below 2^53. */
class Basis32 {
  e0: number;
  e1: number;
  e2: number;
  e3: number;
  constructor(p1: number, p2: number, p3: number, p4: number) {
    const s = 2 ** HFD32_INITIAL_SHIFT;
    this.e0 = p1 * s;
    this.e1 = (p4 - p1) * s;
    this.e2 = 6 * (p2 - p3 - p3 + p4) * s;
    this.e3 = 6 * (p1 - p2 - p2 + p3) * s;
  }
  error(): number {
    return Math.max(Math.abs(this.e2), Math.abs(this.e3));
  }
  parentErrorDividedBy4(): number {
    return Math.max(Math.abs(this.e3), Math.abs(this.e2 + this.e2 - this.e3));
  }
  lazyHalve(shift: number): void {
    this.e2 = shr(this.e2 + this.e3, 1);
    this.e1 = shr(this.e1 - shr(this.e2, shift), 1);
  }
  steadyState(shift: number): void {
    const add = 2 ** HFD32_ADDITIONAL_SHIFT;
    this.e0 *= add;
    this.e1 *= add;
    const s = shift - HFD32_ADDITIONAL_SHIFT;
    if (s < 0) {
      this.e2 *= 2 ** -s;
      this.e3 *= 2 ** -s;
    } else {
      this.e2 = shr(this.e2, s);
      this.e3 = shr(this.e3, s);
    }
  }
  halve(): void {
    this.e2 = shr(this.e2 + this.e3, 3);
    this.e1 = shr(this.e1 - this.e2, 1);
    this.e3 = shr(this.e3, 2);
  }
  double(): void {
    this.e1 += this.e1 + this.e2;
    this.e3 *= 4;
    this.e2 = this.e2 * 8 - this.e3;
  }
  step(): void {
    this.e0 += this.e1;
    const t = this.e2;
    this.e1 += t;
    this.e2 += t - this.e3;
    this.e3 = t;
  }
  value(): number {
    return shr(this.e0 + HFD32_ROUND, HFD32_SHIFT);
  }
}

/** Arithmetic shift right of an integer-valued number. */
const shr = (v: number, s: number): number => Math.floor(v / 2 ** s);

/** The points of the flattened Bezier after its start point, its end point included. */
export function flattenBezier(c: readonly FixPoint[]): FixPoint[] {
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  // (Measured: a quarter 16,376 sixteenths across still takes the 32-bit cracker, 16,384 does not.)
  if (Math.max(...xs) - Math.min(...xs) >= HFD32_MAX_SPAN || Math.max(...ys) - Math.min(...ys) >= HFD32_MAX_SPAN) {
    return flatten64(c);
  }
  // Relative to a corner one pixel outside the control points, as GDI computes (the rounding of
  // the values does not depend on it).
  const left = Math.min(...xs) - 16;
  const top = Math.min(...ys) - 16;
  const x = new Basis32(xs[0]! - left, xs[1]! - left, xs[2]! - left, xs[3]! - left);
  const y = new Basis32(ys[0]! - top, ys[1]! - top, ys[2]! - top, ys[3]! - top);
  let shift = 0;
  let steps = 1;
  while (x.error() > HFD32_INITIAL_TEST * 2 ** shift || y.error() > HFD32_INITIAL_TEST * 2 ** shift) {
    shift += 2;
    x.lazyHalve(shift);
    y.lazyHalve(shift);
    steps *= 2;
  }
  x.steadyState(shift);
  y.steadyState(shift);
  x.step();
  y.step();
  steps--;
  const out: FixPoint[] = [];
  for (;;) {
    out.push({ x: x.value() + left, y: y.value() + top });
    if (steps === 0) return out;
    if (Math.max(x.error(), y.error()) > HFD32_TEST) {
      x.halve();
      y.halve();
      steps *= 2;
    }
    while (
      steps % 2 === 0 &&
      x.parentErrorDividedBy4() <= HFD32_TEST / 4 &&
      y.parentErrorDividedBy4() <= HFD32_TEST / 4
    ) {
      x.double();
      y.double();
      steps /= 2;
    }
    steps--;
    x.step();
    y.step();
  }
}

// 64-bit cracker (36.28): for curves too large for the 32-bit one. A coarse curve ("high") is
// stepped with a target error of 2^11, and each of its pieces is converted back to control points
// and cracked again ("low") to GDI's 2/3 pixel.
const F64 = 28n;
const ERROR_HIGH_64 = ((6n * (1n << 15n)) >> (32n - F64)) << 32n;
const ERROR_LOW_64 = 4n << 32n;

class Basis64 {
  e0: bigint;
  e1: bigint;
  e2: bigint;
  e3: bigint;
  constructor(p1: number, p2: number, p3: number, p4: number) {
    const [a, b, c, d] = [BigInt(p1), BigInt(p2), BigInt(p3), BigInt(p4)];
    this.e0 = a << F64;
    this.e1 = (d - a) << F64;
    this.e2 = (6n * (b - 2n * c + d)) << F64;
    this.e3 = (6n * (a - 2n * b + c)) << F64;
  }
  error(): bigint {
    return max(abs(this.e2), abs(this.e3));
  }
  parentError(): bigint {
    return max(abs(this.e3 << 2n), abs((this.e2 << 3n) - (this.e3 << 2n)));
  }
  halve(): void {
    this.e2 = (this.e2 + this.e3) >> 3n;
    this.e1 = (this.e1 - this.e2) >> 1n;
    this.e3 >>= 2n;
  }
  double(): void {
    this.e1 = (this.e1 << 1n) + this.e2;
    this.e3 <<= 2n;
    this.e2 = (this.e2 << 3n) - this.e3;
  }
  step(): void {
    this.e0 += this.e1;
    const t = this.e2;
    this.e1 += t;
    this.e2 += t - this.e3;
    this.e3 = t;
  }
  value(): number {
    return Number((this.e0 + (1n << (F64 - 1n))) >> F64);
  }
  /** The control points of the piece ahead (rounded to 28.4); BigInt division truncates as C does. */
  controlPoints(): [number, number, number, number] {
    let p2 = this.e1 * 3n;
    let p1 = p2 * 2n - this.e2;
    p2 = p1 * 2n - this.e3;
    p1 = p1 - this.e3 - this.e3;
    const round = (v: bigint) => Number((v + (1n << (F64 - 1n))) >> F64);
    return [round(this.e0), round(p1 / 18n + this.e0), round(p2 / 18n + this.e0), round(this.e0 + this.e1)];
  }
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v);
const max = (a: bigint, b: bigint): bigint => (a > b ? a : b);

function flatten64(c: readonly FixPoint[]): FixPoint[] {
  const xh = new Basis64(c[0]!.x, c[1]!.x, c[2]!.x, c[3]!.x);
  const yh = new Basis64(c[0]!.y, c[1]!.y, c[2]!.y, c[3]!.y);
  let stepsHigh = 1;
  let stepsLow = 0;
  let xl = xh;
  let yl = yh;
  while (xh.error() > ERROR_HIGH_64 || yh.error() > ERROR_HIGH_64) {
    stepsHigh *= 2;
    xh.halve();
    yh.halve();
  }
  const out: FixPoint[] = [];
  for (;;) {
    if (stepsLow === 0) {
      xl = new Basis64(...xh.controlPoints());
      yl = new Basis64(...yh.controlPoints());
      stepsLow = 1;
      while (xl.error() > ERROR_LOW_64 || yl.error() > ERROR_LOW_64) {
        stepsLow *= 2;
        xl.halve();
        yl.halve();
      }
      if (--stepsHigh !== 0) {
        xh.step();
        yh.step();
        if (xh.error() > ERROR_HIGH_64 || yh.error() > ERROR_HIGH_64) {
          stepsHigh *= 2;
          xh.halve();
          yh.halve();
        }
        while (stepsHigh % 2 === 0 && xh.parentError() <= ERROR_HIGH_64 && yh.parentError() <= ERROR_HIGH_64) {
          xh.double();
          yh.double();
          stepsHigh /= 2;
        }
      }
    }
    xl.step();
    yl.step();
    out.push({ x: xl.value(), y: yl.value() });
    stepsLow--;
    if (stepsLow === 0 && stepsHigh === 0) return out;
    if (xl.error() > ERROR_LOW_64 || yl.error() > ERROR_LOW_64) {
      stepsLow *= 2;
      xl.halve();
      yl.halve();
    }
    while (stepsLow % 2 === 0 && xl.parentError() <= ERROR_LOW_64 && yl.parentError() <= ERROR_LOW_64) {
      xl.double();
      yl.double();
      stepsLow /= 2;
    }
  }
}

/* ------------------------------------------------------------------ cosmetic lines (step 3) */

/** Whether a <= b for fractions a.n / a.d, b.n / b.d with positive denominators. */
const fracLess = (an: number, ad: number, bn: number, bd: number): boolean => an * bd < bn * ad;
const fracEqual = (an: number, ad: number, bn: number, bd: number): boolean => an * bd === bn * ad;

/** Whether the segment (x0, y0)-(x1, y1) passes through the open diamond of radius 8 around (cx, cy). */
function touchesOpenDiamond(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): boolean {
  // In u = x + y, v = x - y the diamond is the open square |u - cu| < 8, |v - cv| < 8.
  let loN = 0;
  let loD = 1;
  let loClosed = true;
  let hiN = 1;
  let hiD = 1;
  let hiClosed = true;
  const axes: [number, number, number][] = [
    [x0 + y0, x1 + y1 - (x0 + y0), cx + cy],
    [x0 - y0, x1 - y1 - (x0 - y0), cx - cy],
  ];
  for (const [p0, d, c] of axes) {
    if (d === 0) {
      if (!(p0 > c - 8 && p0 < c + 8)) return false;
      continue;
    }
    let aN = c - 8 - p0;
    let bN = c + 8 - p0;
    let den = d;
    if (den < 0) {
      aN = -aN;
      bN = -bN;
      den = -den;
    }
    if (bN < aN) [aN, bN] = [bN, aN];
    // Open interval (aN / den, bN / den).
    if (fracLess(loN, loD, aN, den) || (fracEqual(loN, loD, aN, den) && loClosed)) {
      loN = aN;
      loD = den;
      loClosed = false;
    }
    if (fracLess(bN, den, hiN, hiD) || (fracEqual(bN, den, hiN, hiD) && hiClosed)) {
      hiN = bN;
      hiD = den;
      hiClosed = false;
    }
  }
  return fracLess(loN, loD, hiN, hiD) || (fracEqual(loN, loD, hiN, hiD) && loClosed && hiClosed);
}

function onSegment(x0: number, y0: number, x1: number, y1: number, px: number, py: number): boolean {
  if ((x1 - x0) * (py - y0) - (y1 - y0) * (px - x0) !== 0) return false;
  return Math.min(x0, x1) <= px && px <= Math.max(x0, x1) && Math.min(y0, y1) <= py && py <= Math.max(y0, y1);
}

/** Whether the GIQ segment (x0, y0) -> (x1, y1) draws the pixel whose centre is (cx, cy) (28.4). */
function giqDraws(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const slopeOne = dx === dy;
  const antiDiagonal = dx === -dy;
  // The counted corners: right and bottom; left and bottom for a slope of exactly +1.
  const cornerX = slopeOne ? cx - 8 : cx + 8;
  const hit =
    touchesOpenDiamond(x0, y0, x1, y1, cx, cy) ||
    onSegment(x0, y0, x1, y1, cornerX, cy) ||
    onSegment(x0, y0, x1, y1, cx, cy + 8);
  if (!hit) return false;
  // The end point: inside the diamond, on a counted corner, or reached along a diagonal edge.
  const ex = x1 - cx;
  const ey = y1 - cy;
  const s = Math.abs(ex) + Math.abs(ey);
  if (s < 8) return false;
  if ((ex === cornerX - cx && ey === 0) || (ex === 0 && ey === 8)) return false;
  if (s === 8 && ex !== 0 && ey !== 0 && (Math.sign(ex) === Math.sign(ey) ? antiDiagonal : slopeOne)) return false;
  return true;
}

/**
 * Draws one cosmetic GIQ segment in 28.4 fixed point (step 3), reporting single pixels inside the
 * rows and (with a margin) the columns of `clip`.
 */
export function giqSegment(x0: number, y0: number, x1: number, y1: number, clip: Rect, emit: SpanSink): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return;
  const xMajor = Math.abs(dx) >= Math.abs(dy);
  // Walk the major axis one pixel at a time; at each, the line lies within one pixel of the row
  // (or column) nearest to it, so three candidates suffice.
  const [m0, m1, lo, hi] = xMajor ? [x0, x1, clip.left - 1, clip.right] : [y0, y1, clip.top - 1, clip.bottom];
  const first = Math.max(Math.floor(Math.min(m0, m1) / 16) - 1, lo);
  const last = Math.min(Math.ceil(Math.max(m0, m1) / 16) + 1, hi);
  for (let major = first; major <= last; major++) {
    const at = major * 16;
    // The minor coordinate of the line at this major coordinate, as the nearest pixel.
    const minor = xMajor ? y0 + ((at - x0) * dy) / dx : x0 + ((at - y0) * dx) / dy;
    const near = Math.round(minor / 16);
    for (let k = near - 1; k <= near + 1; k++) {
      const px = xMajor ? major : k;
      const py = xMajor ? k : major;
      if (py < clip.top || py >= clip.bottom) continue;
      if (giqDraws(x0, y0, x1, y1, px * 16, py * 16)) emit(py, px, px);
    }
  }
}

/* ------------------------------------------------------------------ interior (step 4) */

/** The interior of a polygon, by the pair rule of GDI's ellipse interior (even-odd), as runs. */
function interiorRuns(points: readonly FixPoint[], clip: Rect, emit: SpanSink): void {
  let top = Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  const firstRow = Math.max(Math.ceil(top / 16), clip.top);
  const lastRow = Math.min(Math.ceil(bottom / 16) - 1, clip.bottom - 1);
  const xs: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const cy = row * 16;
    xs.length = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as FixPoint;
      const b = points[i + 1] as FixPoint;
      if (a.y === b.y) continue;
      const [lo, hi] = a.y < b.y ? [a, b] : [b, a];
      if (cy < lo.y || cy >= hi.y) continue;
      xs.push(Math.ceil((lo.x * (hi.y - lo.y) + (cy - lo.y) * (hi.x - lo.x)) / (16 * (hi.y - lo.y))));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = xs[k] as number;
      const to = (xs[k + 1] as number) - 1;
      if (from <= to) emit(row, from, to);
    }
  }
}

/* ------------------------------------------------------------------ the shape */

/**
 * Reports the pixels of the ellipse in the box (x1, y1) - (x2, y2) to the two receivers, as runs of
 * pixels: the inside (what the fill draws) to `interior`, which is null for an outline-only
 * ellipse (task 91), and the outline (what the pen draws) to `outline`, IN THAT ORDER: every
 * interior run is reported before the first outline run, because GDI fills before it strokes.
 *
 * As in GDI, a pixel may be reported more than once: with a one-pixel pen the interior and the
 * outline overlap, and outline pixels where two segments meet are reported once per segment that
 * draws them. The receivers combine every report with the surface (the XOR-type modes show the
 * difference). With a wider pen the outline is one filled shape and the interior leaves it out.
 *
 * The corners are sorted (x1 <= x2, y1 <= y2) and both belong to the box. `penWidth` is 1-255.
 * `clip` is the surface (right and bottom exclusive). Pixels outside it need not be reported; the
 * receivers clip what they get.
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
  copyMode = false,
): void {
  if (x1 === x2 && y1 === y2) {
    // GDI draws the same dot here as for a zero-length line (measured for every pen width).
    if (penWidth > 1) emitDot(penDot(penWidth), x1, y1, outline);
    return;
  }
  const { points: polygon, directions, curveJoins } = flattenedEllipse(x1, y1, x2, y2);
  if (penWidth <= 1) {
    if (interior) interiorRuns(polygon, clip, interior);
    for (let i = 0; i + 1 < polygon.length; i++) {
      const a = polygon[i] as FixPoint;
      const b = polygon[i + 1] as FixPoint;
      giqSegment(a.x, a.y, b.x, b.y, clip, outline);
    }
    return;
  }
  // A filled ellipse in Copy mode GDI fills and strokes in one pass, from the flattened polygon;
  // otherwise it widens the curve itself (the end tangents decide the first and last offsets).
  const ring =
    interior && copyMode
      ? widenClosed(penWidth, polygon.slice(0, -1))
      : widenClosed(penWidth, polygon.slice(0, -1), directions, curveJoins);
  if (interior) {
    // The interior without the outline's pixels, row by row.
    const pen = new Map<number, [number, number][]>();
    fillPolygons(ring, clip, (row, from, to) => {
      const runs = pen.get(row) ?? pen.set(row, []).get(row)!;
      runs.push([from, to]);
    });
    interiorRuns(polygon, clip, (row, from, to) => {
      let start = from;
      const runs = (pen.get(row) ?? []).slice().sort((a, b) => a[0] - b[0]);
      for (const [a, b] of runs) {
        if (b < start || a > to) continue;
        if (a > start) interior(row, start, a - 1);
        start = Math.max(start, b + 1);
      }
      if (start <= to) interior(row, start, to);
    });
  }
  fillPolygons(ring, clip, outline);
}
