// Flood fill (ARCHITECTURE.md 3.4 rule 8; trap15-b §6.6): GDI's ExtFloodFill with FLOODFILLSURFACE,
// called with the colour of the start pixel.
//
//   - The region is every pixel that can be reached from the start pixel through left, right, upper
//     and lower neighbours of exactly the start pixel's colour. Diagonal neighbours do not connect:
//     a diagonal line one pixel wide is a boundary. The edge of the surface bounds the region.
//   - Every pixel of the region is combined once with the fill colour through the drawing mode.
//     The region is painted even when it already has the fill colour, which shows in the modes that
//     are not Copy (in mode 14 it turns black).
//   - A start point outside the surface does nothing.
//
// All pixels of the region have one colour, so they all get one new colour. If the new colour equals
// the old one the picture does not change and there is nothing to do. Otherwise the new colour marks
// the pixels already painted, and no separate "visited" map is needed.
//
// The fill works in runs: a run is a stretch of the region in one row, as long as it can be. After
// painting a run it remembers which stretches of the neighbouring rows still have to be looked at.
// For a run found while going down, that is the row below under the whole run, and the row above
// only where the run sticks out beyond the run it was found from - the part between is known to be
// painted. So a pixel is read about once on the way in and once from each neighbouring row,
// however ragged the region is.
//
// Owner: SH1.

import type { PixelBuffer, Rect } from '../../../contracts';
import { mixed, type Mix } from './rop';

/** Runs shorter than this are painted in a loop; TypedArray.fill pays off only for longer ones. */
const FILL_CALL_FROM = 24;

/**
 * Flood-fills from (x, y) through `mix`. Returns the bounding box of the pixels that changed
 * (right and bottom exclusive), or null if none did.
 */
export function floodFill(buffer: PixelBuffer, x: number, y: number, mix: Mix): Rect | null {
  const { width, height } = buffer;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const start = y * width + x;
  const paint = mixed(mix, buffer.data[start] as number);
  if (paint === buffer.data[start]) return null;

  // The same pixels as signed numbers: comparing them stays in whole-number arithmetic.
  const data = new Int32Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.length);
  const target = data[start] as number;
  const color = paint | 0;
  const lastColumn = width - 1;

  // Work still to do, four numbers each: row, first column, last column, direction (+1 down, -1 up).
  // "The columns first..last of `row` are painted; look at the row `direction` further on for
  // pixels of the region that touch them."
  let todo = new Int32Array(4 * 512);
  let count = 0;

  // The run of the start pixel, and both of its neighbouring rows.
  let from = x;
  while (from > 0 && data[start - x + from - 1] === target) from--;
  let to = x;
  while (to < lastColumn && data[start - x + to + 1] === target) to++;
  data.fill(color, start - x + from, start - x + to + 1);
  todo[count++] = y;
  todo[count++] = from;
  todo[count++] = to;
  todo[count++] = 1;
  todo[count++] = y;
  todo[count++] = from;
  todo[count++] = to;
  todo[count++] = -1;

  let left = from;
  let right = to;
  let top = y;
  let bottom = y;

  while (count > 0) {
    const direction = todo[--count] as number;
    const last = todo[--count] as number;
    const first = todo[--count] as number;
    const row = (todo[--count] as number) + direction;
    if (row < 0 || row >= height) continue;
    const base = row * width;

    let column = first;
    while (column <= last) {
      if (data[base + column] !== target) {
        column++;
        continue;
      }
      // A pixel of the region. Its run can reach further left only at the first column looked at:
      // everywhere else the pixel to its left has just been seen not to belong.
      from = column;
      if (column === first) while (from > 0 && data[base + from - 1] === target) from--;
      to = column;
      while (to < lastColumn && data[base + to + 1] === target) to++;
      if (to - from >= FILL_CALL_FROM) data.fill(color, base + from, base + to + 1);
      else for (let i = base + from; i <= base + to; i++) data[i] = color;

      if (from < left) left = from;
      if (to > right) right = to;
      if (row < top) top = row;
      if (row > bottom) bottom = row;

      if (count + 12 > todo.length) {
        const larger = new Int32Array(todo.length * 2);
        larger.set(todo);
        todo = larger;
      }
      // Onwards in the same direction, under the whole run ...
      todo[count++] = row;
      todo[count++] = from;
      todo[count++] = to;
      todo[count++] = direction;
      // ... and back the way it came, only where the run sticks out on the left or on the right.
      if (from < first) {
        todo[count++] = row;
        todo[count++] = from;
        todo[count++] = first - 1;
        todo[count++] = -direction;
      }
      if (to > last) {
        todo[count++] = row;
        todo[count++] = last + 1;
        todo[count++] = to;
        todo[count++] = -direction;
      }
      column = to + 2; // the pixel after the run is not part of the region
    }
  }
  return { left, top, right: right + 1, bottom: bottom + 1 };
}
