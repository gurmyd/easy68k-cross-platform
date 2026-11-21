// Lines of a pen 2 or more pixels wide, and the outline of a wide-pen ellipse (ARCHITECTURE.md 3.4
// rule 4; trap15-b §6.2, §15 V11). Owner: SH2.
//
// GDI draws a wide line by WIDENING it into a polygon and filling the polygon; this file does the
// same, in GDI's 28.4 fixed point (1/16 pixel). Everything below was measured on Windows GDI (the
// polygon itself with WidenPath and GetPath, the pixels with the calls the original makes); the
// description a reader can check is in docs/porting/gdi-deviations.md.
//
// The pen. A pen of width w has a NIB, a convex polygon around the pen point (tables/pens.ts, one
// per width, measured). From the nib GDI derives, per nib vertex v:
//   - the GUIDE vertex g = v moved one sixteenth further from the centre in x and in y (each nonzero
//     coordinate grows by one in magnitude). The guide vertices decide which way a line points.
//   - the OFFSET o = g rounded to the half-pixel grid (multiples of 8 sixteenths, halves away from
//     zero). Offsets are what a line's long sides are moved by.
//
// One segment P0 -> P1 (direction d = P1 - P0; a segment of length zero counts as pointing in +x):
//   - left side: the guide vertex furthest in the direction (d.y, -d.x) (the left of d on the
//     screen); right side: furthest in (-d.y, d.x). When two guide vertices are equally far, the
//     one later in angle order is taken if d.x > 0 (or d.x = 0 and d.y > 0), the earlier one
//     otherwise.
//   - the polygon is: P0 + o(left); the nib vertices strictly between left and right going round
//     the back of P0; P0 + o(right); P1 + o(right); the nib vertices strictly between right and
//     left going round the front of P1; P1 + o(left).
//   - filled by the rule of polygon fills: a pixel belongs to the polygon when its centre is inside
//     (nonzero winding), a centre on a left edge is inside, one on a right edge is not; edges are
//     followed in exact rational arithmetic.
//
// A closed polygon (the flattened ellipse of ellipse.ts) is widened the same way with joins instead
// of ends: each segment's two sides are moved by its offsets; at each vertex the outer side goes
// round the vertices between the two segments' offsets (the guide vertices at a join inside a curve
// GDI widens, the guide vertices with the nib's on the axes at a join between two lines, which is
// every join of a polygon and the four ends of a wide-pen ellipse, the nib's own at a 180-degree
// turn), and the inner side passes through the vertex itself. Both contours are filled
// together with the nonzero rule. (496 of 500 random wide-pen ellipses equal; 6.5.2 has no threshold
// for them in version 1, and the figures are in docs/porting/gdi-deviations.md.)
//
// What the caller does, and this file does not: clipping in x (runs may reach past the surface),
// the drawing mode, and the extra end-point pixel EASy68K sets after every line (the "hole" of the
// XOR-type modes).

import type { Rect } from '../../../contracts';
import type { SpanSink } from './raster';
import { penNib, type Nib } from './tables/pens';

/** A point in GDI's 28.4 fixed point: 16 units per pixel, pixel centres on multiples of 16. */
export interface FixPoint {
  x: number;
  y: number;
}

/** The pen derived from a nib: guide vertices and offsets, in the nib's vertex order. */
interface Pen {
  readonly nib: Nib;
  readonly guideX: Int32Array;
  readonly guideY: Int32Array;
  readonly offsetX: Int32Array;
  readonly offsetY: Int32Array;
}

const pens = new Map<number, Pen>();

function penOf(width: number): Pen {
  let pen = pens.get(width);
  if (pen) return pen;
  const nib = penNib(width);
  const n = nib.x.length;
  const guideX = new Int32Array(n);
  const guideY = new Int32Array(n);
  const offsetX = new Int32Array(n);
  const offsetY = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    guideX[i] = grow(nib.x[i] as number);
    guideY[i] = grow(nib.y[i] as number);
    offsetX[i] = toHalfPixel(guideX[i] as number);
    offsetY[i] = toHalfPixel(guideY[i] as number);
  }
  pen = { nib, guideX, guideY, offsetX, offsetY };
  pens.set(width, pen);
  return pen;
}

const grow = (v: number): number => v + Math.sign(v);

/** Rounds a 28.4 value to a multiple of 8 (half a pixel), halves away from zero. */
function toHalfPixel(v: number): number {
  const q = Math.round(Math.abs(v) / 8);
  return v < 0 ? -8 * q : 8 * q;
}

/**
 * The index of the guide vertex furthest in direction (ux, uy). Of two equally far (they are then
 * neighbours), the later one in angle order if `dx` > 0, the earlier one otherwise.
 */
function furthest(pen: Pen, ux: number, uy: number, preferLater: boolean): number {
  const n = pen.guideX.length;
  let best = -Infinity;
  let first = -1;
  let tied = -1;
  for (let i = 0; i < n; i++) {
    const d = (pen.guideX[i] as number) * ux + (pen.guideY[i] as number) * uy;
    if (d > best) {
      best = d;
      first = i;
      tied = -1;
    } else if (d === best) {
      tied = i;
    }
  }
  if (tied < 0) return first;
  // `first` and `tied` are neighbours; with wrap-around, index n - 1 comes before index 0.
  let earlier = first;
  let later = tied;
  if (first === 0 && tied === n - 1) {
    earlier = tied;
    later = first;
  }
  return preferLater ? later : earlier;
}

/** The widened polygon of one segment, in 28.4 fixed point. */
export function widenSegment(width: number, p0: FixPoint, p1: FixPoint): FixPoint[] {
  const pen = penOf(width);
  const { nib, offsetX, offsetY } = pen;
  const n = nib.x.length;
  let dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  if (dx === 0 && dy === 0) dx = 1; // GDI widens a point as a line pointing in +x
  const left = furthest(pen, dy, -dx, laterOnTie(dx, dy));
  const right = furthest(pen, -dy, dx, laterOnTie(dx, dy));
  const out: FixPoint[] = [{ x: p0.x + (offsetX[left] as number), y: p0.y + (offsetY[left] as number) }];
  for (let i = (left - 1 + n) % n; i !== right; i = (i - 1 + n) % n) {
    out.push({ x: p0.x + (nib.x[i] as number), y: p0.y + (nib.y[i] as number) });
  }
  out.push({ x: p0.x + (offsetX[right] as number), y: p0.y + (offsetY[right] as number) });
  out.push({ x: p1.x + (offsetX[right] as number), y: p1.y + (offsetY[right] as number) });
  for (let i = (right - 1 + n) % n; i !== left; i = (i - 1 + n) % n) {
    out.push({ x: p1.x + (nib.x[i] as number), y: p1.y + (nib.y[i] as number) });
  }
  out.push({ x: p1.x + (offsetX[left] as number), y: p1.y + (offsetY[left] as number) });
  return out;
}

/**
 * The two contours of a closed polygon widened with round joins (the outline of a wide-pen
 * ellipse), in 28.4 fixed point. `points` is the polygon without its closing point repeated.
 * `directions[i]`, when given and not null, is the direction segment i (points[i] -> points[i + 1])
 * takes its offsets from instead of its own. `curve` says, per vertex, whether the join there is
 * one inside a curve that GDI widens as a curve (true) or a join between two straight lines (false):
 * they differ in the join vertices. A single boolean applies to every vertex; an array gives one per
 * index of `points`.
 */
export function widenClosed(
  width: number,
  points: readonly FixPoint[],
  directions?: readonly (FixPoint | null)[],
  curve: boolean | readonly boolean[] = false,
): FixPoint[][] {
  const pen = penOf(width);
  const { offsetX, offsetY } = pen;
  // Joins inside a curve go round the guide vertices; joins between straight lines round the guide
  // vertices too, except on the axes, where the nib vertex is taken (measured).
  const axisNib = (i: number, v: Int32Array): number =>
    pen.nib.x[i] === 0 || pen.nib.y[i] === 0 ? (v[i] as number) - Math.sign(v[i] as number) : (v[i] as number);
  const lineJoinX = pen.guideX.map((_, i) => axisNib(i, pen.guideX));
  const lineJoinY = pen.guideY.map((_, i) => axisNib(i, pen.guideY));
  const curveAt = (vertex: number): boolean => (typeof curve === 'boolean' ? curve : curve[vertex] === true);
  const n = offsetX.length;
  interface Segment {
    a: FixPoint;
    b: FixPoint;
    /** Indices in `points` of a and b. */
    ia: number;
    ib: number;
    dx: number;
    dy: number;
    left: number;
    right: number;
  }
  const segments: Segment[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as FixPoint;
    const b = points[(i + 1) % points.length] as FixPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx === 0 && dy === 0) continue;
    // The direction that picks the offsets: the segment's own, unless the caller gives another.
    const d = directions?.[i] ?? { x: dx, y: dy };
    const later = laterOnTie(d.x, d.y);
    segments.push({
      a,
      b,
      ia: i,
      ib: (i + 1) % points.length,
      dx,
      dy,
      left: furthest(pen, d.y, -d.x, later),
      right: furthest(pen, -d.y, d.x, later),
    });
  }
  const k = segments.length;
  if (k === 0) return [];
  const at = (p: FixPoint, i: number): FixPoint => ({
    x: p.x + (offsetX[i] as number),
    y: p.y + (offsetY[i] as number),
  });
  /**
   * One side: the segments in the order given, each moved by the offset of `bin(s)`, which lies on
   * the screen-left of the direction `sign` * d. At a vertex where the path turns away from that
   * side (a right turn as seen along sign * d) the side goes round the offsets between the two
   * bins; where it turns towards it, the side passes through the vertex.
   */
  const side = (order: readonly Segment[], sign: 1 | -1, bin: (s: Segment) => number): FixPoint[] => {
    const out: FixPoint[] = [];
    for (let i = 0; i < order.length; i++) {
      const s = order[i] as Segment;
      const t = order[(i + 1) % order.length] as Segment;
      const [from, to] = sign > 0 ? [s.a, s.b] : [s.b, s.a];
      const vertex = sign > 0 ? s.ib : s.ia;
      out.push(at(from, bin(s)), at(to, bin(s)));
      const turn = s.dx * t.dy - s.dy * t.dx; // the same for both orders (both directions negate)
      const reverses = turn === 0 && s.dx * t.dx + s.dy * t.dy < 0;
      if (turn > 0 || reverses) {
        for (let j = bin(s), guard = 0; j !== bin(t) && guard < n; guard++) {
          j = (j + 1) % n;
          // A reversal goes round the nib itself (measured on boxes one pixel wide or high).
          const jx = reverses ? pen.nib.x : curveAt(vertex) ? pen.guideX : lineJoinX;
          const jy = reverses ? pen.nib.y : curveAt(vertex) ? pen.guideY : lineJoinY;
          if (j !== bin(t)) out.push({ x: to.x + (jx[j] as number), y: to.y + (jy[j] as number) });
        }
      } else if (turn < 0 && bin(s) !== bin(t)) {
        out.push({ x: to.x, y: to.y });
      }
    }
    return out;
  };
  return [side(segments, 1, (s) => s.left), side([...segments].reverse(), -1, (s) => s.right)];
}

/**
 * Fills polygons given in 28.4 fixed point by GDI's rule: the pixels whose centre is inside by the
 * nonzero winding rule, a centre on a left edge inside, on a right edge outside (an edge counts for
 * the rows top <= y < bottom). Each row's pixels go to `emit` as runs, every pixel once. Only the
 * rows of `clip` are visited.
 */
export function fillPolygons(contours: readonly (readonly FixPoint[])[], clip: Rect, emit: SpanSink): void {
  let top = Infinity;
  let bottom = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.y < top) top = p.y;
      if (p.y > bottom) bottom = p.y;
    }
  }
  if (top > bottom) return;
  const firstRow = Math.max(Math.ceil(top / 16), clip.top);
  const lastRow = Math.min(Math.ceil(bottom / 16) - 1, clip.bottom - 1);
  const crossings: { x: number; d: number }[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const cy = row * 16;
    crossings.length = 0;
    for (const c of contours) {
      const m = c.length;
      for (let i = 0; i < m; i++) {
        const a = c[i] as FixPoint;
        const b = c[(i + 1) % m] as FixPoint;
        if (a.y === b.y) continue;
        const down = a.y < b.y;
        const lo = down ? a : b;
        const hi = down ? b : a;
        if (cy < lo.y || cy >= hi.y) continue;
        // First pixel at or right of the crossing: ceil(crossing / 16), exactly.
        const num = lo.x * (hi.y - lo.y) + (cy - lo.y) * (hi.x - lo.x);
        crossings.push({ x: Math.ceil(num / (16 * (hi.y - lo.y))), d: down ? 1 : -1 });
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p.x - q.x);
    let winding = 0;
    let start = 0;
    for (const { x, d } of crossings) {
      const before = winding;
      winding += d;
      if (before === 0 && winding !== 0) start = x;
      else if (before !== 0 && winding === 0 && x - 1 >= start) emit(row, start, x - 1);
    }
  }
}

/**
 * Reports the pixels of the stroke from (x1, y1) to (x2, y2) with a pen `width` pixels wide
 * (2-255) to `emit`, as runs of pixels. EVERY PIXEL OF THE STROKE IS REPORTED EXACTLY ONCE: the
 * caller combines each run with the surface through the drawing mode, and a pixel reported twice
 * would be undone again in the XOR-type modes.
 *
 * `clip` is the surface (right and bottom exclusive). Pixels outside it need not be reported.
 */
export function strokeWideLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  clip: Rect,
  emit: SpanSink,
): void {
  const polygon = widenSegment(width, { x: 16 * x1, y: 16 * y1 }, { x: 16 * x2, y: 16 * y2 });
  fillPolygons([polygon], clip, emit);
}

/** Which of two equally far guide vertices a segment of direction (dx, dy) takes (measured). */
function laterOnTie(dx: number, dy: number): boolean {
  return dx > 0 || (dx === 0 && dy > 0);
}
