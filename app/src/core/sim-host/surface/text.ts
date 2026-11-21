// Text on the surface (ARCHITECTURE.md 3.4 `textOut`; trap15-b §5.2, §6.7): what GDI's TextOut
// paints for a run of glyphs.
//
//   - First an opaque cell in the fill colour: as wide as the advances of the glyphs together and
//     as high as the font's cell. (trap15-b §6.7 measured it: two Fixedsys characters at (10,10)
//     fill exactly x 10-25, y 10-24.)
//   - Then each glyph in the font colour, one after the other, each `advance` pixels further right.
//     A glyph may be wider than its advance (an italic overhang); those pixels fall outside the
//     cell and are laid over whatever is there.
//   - Coverage 255 is the font colour, 0 leaves the pixel alone, values between blend the two
//     (the outline fonts; the raster fonts have only 0 and 255).
//
// Text ignores the drawing mode and the pen width. The glyphs come from the caller (TextScreen
// takes them from a GlyphProvider); this file knows nothing about fonts.
//
// Owner: SH1.

import type { Glyph, PixelBuffer, Rect } from '../../../contracts';
import { BLACK_PIXEL } from './raster';

/**
 * The box (right and bottom exclusive) that painting `glyphs` at (x, y) can touch: the opaque cell
 * and any glyph pixels beside it. Empty (right <= left) for no glyphs.
 */
export function textBounds(x: number, y: number, glyphs: readonly Glyph[]): Rect {
  let advance = 0;
  let right = x;
  let height = 0;
  for (const glyph of glyphs) {
    right = Math.max(right, x + advance + glyph.width);
    advance += glyph.advance;
    height = Math.max(height, glyph.height);
  }
  return { left: x, top: y, right: Math.max(right, x + advance), bottom: y + height };
}

/** One colour channel of a blended pixel: `under` seen through `coverage` (1-254) of `over`. */
function blendChannel(under: number, over: number, coverage: number): number {
  return ((under * (255 - coverage) + over * coverage + 127) / 255) | 0;
}

/**
 * Paints `glyphs` with their top-left corner at surface position (x, y) into `buffer`, whose pixel
 * (0, 0) is the surface pixel (originX, originY). The cell is filled with `background`, the glyphs
 * are drawn in `color` (both $00BBGGRR). Whatever falls outside the buffer is left out.
 */
export function paintText(
  buffer: PixelBuffer,
  originX: number,
  originY: number,
  x: number,
  y: number,
  glyphs: readonly Glyph[],
  background: number,
  color: number,
): void {
  const { data, width, height } = buffer;
  let cellWidth = 0;
  let cellHeight = 0;
  for (const glyph of glyphs) {
    cellWidth += glyph.advance;
    cellHeight = Math.max(cellHeight, glyph.height);
  }

  // The opaque cell.
  const cellLeft = Math.max(x - originX, 0);
  const cellRight = Math.min(x - originX + cellWidth, width);
  const cellTop = Math.max(y - originY, 0);
  const cellBottom = Math.min(y - originY + cellHeight, height);
  if (cellLeft < cellRight) {
    const pixel = (BLACK_PIXEL | background) >>> 0;
    for (let row = cellTop; row < cellBottom; row++) data.fill(pixel, row * width + cellLeft, row * width + cellRight);
  }

  // The glyphs.
  const solid = (BLACK_PIXEL | color) >>> 0;
  const red = color & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = (color >> 16) & 0xff;
  let glyphLeft = x - originX;
  for (const glyph of glyphs) {
    const top = y - originY;
    const rowFrom = Math.max(0, -top);
    const rowTo = Math.min(glyph.height, height - top);
    const columnFrom = Math.max(0, -glyphLeft);
    const columnTo = Math.min(glyph.width, width - glyphLeft);
    for (let row = rowFrom; row < rowTo; row++) {
      let source = row * glyph.width + columnFrom;
      let target = (top + row) * width + glyphLeft + columnFrom;
      for (let column = columnFrom; column < columnTo; column++, source++, target++) {
        const coverage = glyph.coverage[source] as number;
        if (coverage === 0) continue;
        if (coverage >= 255) {
          data[target] = solid;
          continue;
        }
        const under = data[target] as number;
        data[target] =
          BLACK_PIXEL |
          (blendChannel((under >> 16) & 0xff, blue, coverage) << 16) |
          (blendChannel((under >> 8) & 0xff, green, coverage) << 8) |
          blendChannel(under & 0xff, red, coverage);
      }
    }
    glyphLeft += glyph.advance;
  }
}
