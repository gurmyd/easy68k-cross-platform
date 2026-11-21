// Lines of a pen 2 or more pixels wide (ARCHITECTURE.md 3.4 rule 4; trap15-b §6.2).
//
// STUB written by SH1 (wave 1). SH2 replaces the body with GDI's stroke (round caps from the dot
// table, validated against T2's captures) and owns this file from then on. The Surface calls
// `strokeWideLine` and nothing else; its signature is what SH2 keeps.
// (The comparison with the GDI capture, tests/conformance/gdi/surface.test.ts, looks for the words
// "STUB written by SH1" at the start of a comment line of this file: while they are there, the
// cases with wide lines wait instead of failing. SH2 removes the line together with the stub.)
//
// What this stub draws: the BAND WITHOUT CAPS.
//   - A wide stroke centred on coordinate c covers c - a .. c + b, with a = floor(w / 2) and
//     b = floor((w - 1) / 2). The band is that stroke around every pixel of the one-pixel line
//     (line.ts), both end points included: a vertical run in every column for a flat line, a
//     horizontal run in every row for a steep one.
//   - GDI adds a round cap at each end and, for even widths, leaves out one corner pixel of the band
//     at the start; both are missing here.
//   - A line of length zero draws the pen's round dot (`penDot` of tables/dots.ts), which is what
//     GDI draws for every pen width (measured, 2-255).
//
// What the caller does, and this file does not: clipping (runs may leave the surface in x; rows
// outside `clip` may be skipped but need not be), the drawing mode, and the extra end-point pixel
// that EASy68K sets after every line (the "hole" of the XOR-type modes).
//
// Owner: SH1 > SH2.

import type { Rect } from '../../../contracts';
import { isXMajor, walkLine } from './line';
import { emitDot, type SpanSink } from './raster';
import { penDot } from './tables/dots';

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
  const a = width >> 1;
  const b = (width - 1) >> 1;

  if (x1 === x2 && y1 === y2) {
    emitDot(penDot(width), x1, y1, emit);
    return;
  }

  if (y1 === y2) {
    // Horizontal: the band is a block of whole rows.
    const top = Math.max(y1 - a, clip.top);
    const bottom = Math.min(y1 + b, clip.bottom - 1);
    for (let y = top; y <= bottom; y++) emit(y, Math.min(x1, x2), Math.max(x1, x2));
    return;
  }

  if (isXMajor(x1, y1, x2, y2)) {
    // One column per pixel of the thin line: a vertical run of `width` pixels in each.
    const run = (x: number, y: number): void => {
      for (let yy = y - a; yy <= y + b; yy++) emit(yy, x, x);
    };
    // Thin-line pixels whose run can reach the clip rectangle.
    walkLine(x1, y1, x2, y2, { left: clip.left, top: clip.top - b, right: clip.right, bottom: clip.bottom + a }, run);
    run(x2, y2);
  } else {
    // One row per pixel of the thin line: a horizontal run of `width` pixels in each.
    const run = (x: number, y: number): void => emit(y, x - a, x + b);
    walkLine(x1, y1, x2, y2, { left: clip.left - b, top: clip.top, right: clip.right + a, bottom: clip.bottom }, run);
    run(x2, y2);
  }
}
