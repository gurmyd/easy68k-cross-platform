// What GDI's ExtTextOut draws for task 95 (trap15-b 6.7) in the raster faces, built from the
// committed font data, so that the text references can be checked against it. Owner: T2.
// The rules are measured (tests/oracle/gdi-capture/README.md "Text strings"; errata T2 section 2):
//
//   - inside a string of two or more bytes the zero-width bytes ($09 $0A $0D $1C-$1F) paint nothing
//     and take no room; every other byte is drawn at x + the sum of the drawn advances before it;
//   - the opaque cell is cell-height high and as wide as the drawn advances, plus the style overhang
//     of the raster faces (bold 1, italic floor((h - 1) / 2)); italicOverhangDropped() says when GDI
//     leaves the italic overhang out; a string of zero-width bytes only fills the first byte's cell
//     plus the overhang;
//   - each glyph is drawn in the font colour (1-bit glyphs: full pixels);
//   - the pen moves by TextWidth(string): the sum of the single-byte advances, where the zero-width
//     bytes count 0 if the string has a byte of $80 or above and their full advance otherwise, in
//     every style (textExtent; in the outline faces $7F also changes its width in such a string).
//
// textUnmodelled() in cases.ts names the strings these rules do not cover (bytes Windows takes from
// a fallback font); no case of the `text` suite contains one.

import {
  cellOf,
  outlineEntry,
  rasterGlyph,
  ZERO_WIDTH_BYTES,
  type FontRequest,
  type Metrics,
  type TestGlyph,
} from './fonts';
import { ITALIC_SPECIAL_BYTES, type GdiCase } from './cases';

export interface Picture {
  width: number;
  height: number;
  pixels: Uint32Array; // $00BBGGRR
  pen: [number, number];
}

export interface TextLayout {
  /** Glyphs to paint, with their x offsets from the start of the string. */
  glyphs: { glyph: TestGlyph; x: number }[];
  /** Width of the opaque cell. */
  boxWidth: number;
  /** TextWidth(string): how far the pen moves. */
  extent: number;
  cellHeight: number;
}

const isZeroWidth = (b: number) => ZERO_WIDTH_BYTES.includes(b);

/**
 * TextWidth(string), given the advance of each byte in this string: a zero-width byte inside a
 * string of two or more bytes counts 0 when the string also has a byte of $80 or above, and its full
 * advance otherwise. Style plays no part (measured: plain, bold, italic, underline, strike-out).
 *
 * In the raster faces a byte's advance is its single-byte advance. In the outline faces (Courier
 * New, Lucida Console, Consolas, and Arial for the proportional names) it is too, except $7F in a
 * string with a byte of $80 or above: Windows draws it from a fallback font, and it takes that
 * glyph's width (`delInHighString` of the outline atlas index; about 0.4 em, one more in bold)
 * instead of the face's advance (review round 2: Courier New 9 [$E9,$7F] is 7 + 4 = 11, not 14).
 * outlineAdvance() gives that advance.
 */
export function textExtent(bytes: readonly number[], advanceOf: (byte: number) => number): number {
  const high = bytes.some((b) => b >= 0x80);
  let extent = 0;
  for (const b of bytes) if (!(bytes.length >= 2 && high && isZeroWidth(b))) extent += advanceOf(b);
  return extent;
}

/**
 * Whether GDI leaves the italic overhang out of the opaque cell: when two or more bytes are drawn
 * (zero-width bytes are not drawn) and the string contains a zero-width byte, or contains one of
 * $7F $86 $87 next to (anywhere in the same string as) a drawn byte that is not one of them.
 */
export function italicOverhangDropped(bytes: readonly number[]): boolean {
  if (bytes.length < 2) return false;
  const drawn = bytes.filter((b) => !isZeroWidth(b));
  if (drawn.length < 2) return false;
  if (drawn.length < bytes.length) return true;
  const special = drawn.filter((b) => ITALIC_SPECIAL_BYTES.includes(b)).length;
  return special > 0 && special < drawn.length;
}

/** Whether $7F takes the fallback glyph's width in this outline-face string (see textExtent). */
export const delOnFallback = (bytes: readonly number[]): boolean =>
  bytes.includes(0x7f) && bytes.some((b) => b >= 0x80);

/**
 * The advance of `byte` inside the string `bytes` in a monospaced outline face: the cell width, or
 * for $7F in a string with a byte of $80 or above the fallback width of the atlas index. null when
 * that width is needed and the size has no outline atlas.
 */
export function outlineAdvance(
  metrics: Metrics,
  font: FontRequest,
  byte: number,
  bytes: readonly number[],
): number | null {
  if (byte === 0x7f && delOnFallback(bytes)) return outlineEntry(metrics, font)?.delInHighString ?? null;
  return cellOf(metrics, font).colWidth;
}

/** A glyph source; `bytes` is the whole string, for advances that depend on it. */
export type GlyphOf = (metrics: Metrics, font: FontRequest, byte: number, bytes: readonly number[]) => TestGlyph;

export function layoutText(
  metrics: Metrics,
  font: FontRequest,
  bytes: readonly number[],
  glyphOf: GlyphOf = rasterGlyph,
): TextLayout {
  const cell = cellOf(metrics, font);
  const glyphs: { glyph: TestGlyph; x: number }[] = [];
  let x = 0;
  for (const b of bytes) {
    if (bytes.length >= 2 && isZeroWidth(b)) continue;
    const g = glyphOf(metrics, font, b, bytes);
    glyphs.push({ glyph: g, x });
    x += g.advance;
  }
  const extent = textExtent(bytes, (b) => glyphOf(metrics, font, b, bytes).advance);
  // GDI's simulated bold and italic overhang the last advance; the opaque cell covers the overhang
  // too (tmOverhang: 1 for bold, floor((h - 1) / 2) for italic; 0 for the outline faces).
  const fullOverhang = cell.kind === 'raster' ? rasterOverhang(font.style, cell.rowHeight) : 0;
  const allZero = bytes.length > 0 && bytes.every(isZeroWidth);
  let boxWidth: number;
  if (allZero) boxWidth = glyphOf(metrics, font, bytes[0] as number, bytes).advance + fullOverhang;
  else if (glyphs.length === 0) boxWidth = 0;
  else if (font.style === 2 && italicOverhangDropped(bytes)) {
    // Only the first glyph's overhang is kept then, where it reaches past the advances
    // (Fixedsys 72 italic "A",$0D,"B": 40 + 44 = 84, not 80; with four glyphs 160).
    const first = glyphs[0] as { glyph: TestGlyph };
    boxWidth = Math.max(x, first.glyph.advance + fullOverhang);
  } else boxWidth = x + fullOverhang;
  return { glyphs, boxWidth, extent, cellHeight: cell.rowHeight };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The text cells of an outline-face case as the port draws them (advance boxes), and a predicate
 * for the pixels whose GDI colour the port cannot know: the 1-3 columns by which GDI widens a
 * TrueType cell (the glyphs' ink overhang) and, for underline and strike-out, lines outside the
 * cells. null when the case uses the proportional face (no per-byte advances at every size), or a
 * $7F on the fallback path at a size without an outline atlas.
 */
export function outlineCells(
  metrics: Metrics,
  c: GdiCase,
): { boxes: Box[]; uncertain: (x: number, y: number) => boolean } | null {
  let font: FontRequest = { name: 'Fixedsys', size: 9, style: 0 };
  const boxes: Box[] = [];
  let line = false;
  for (const o of c.ops) {
    if (o.op === 'font') font = { name: o.name, size: o.size, style: o.style };
    if (o.op !== 'text') continue;
    const cell = cellOf(metrics, font);
    if (cell.face === 'Arial') return null;
    if (font.style === 3 || font.style === 4) line = true;
    let w = 0;
    for (const b of o.bytes) {
      const a = outlineAdvance(metrics, font, b, o.bytes);
      if (a === null) return null;
      w += a;
    }
    boxes.push({ x: o.x, y: o.y, w, h: cell.rowHeight });
  }
  // The widening grows with the size: up to a tenth of the cell height, at least 3 pixels.
  const inside = (x: number, y: number, widen: boolean) =>
    boxes.some((b) => {
      const m = widen ? Math.max(3, Math.ceil(b.h / 10)) : 0;
      return x >= b.x - m && x < b.x + b.w + m && y >= b.y && y < b.y + b.h;
    });
  return { boxes, uncertain: (x, y) => !inside(x, y, false) && (inside(x, y, true) || line) };
}

/** tmOverhang of GDI's style simulation for a raster face. */
export function rasterOverhang(style: number, cellHeight: number): number {
  return style === 1 ? 1 : style === 2 ? Math.floor((cellHeight - 1) / 2) : 0;
}

/** Replays a text case (bg, fill, fontcolor, font, text, moveto; other operations do not affect text). */
export function drawTextCase(metrics: Metrics, c: GdiCase, glyphOf: GlyphOf = rasterGlyph): Picture {
  const pixels = new Uint32Array(c.width * c.height);
  let fill = 0;
  let fontColor = 0xffffff;
  let font: FontRequest = { name: 'Fixedsys', size: 9, style: 0 };
  let pen: [number, number] = [0, 0];
  const put = (x: number, y: number, colour: number) => {
    if (x >= 0 && y >= 0 && x < c.width && y < c.height) pixels[y * c.width + x] = colour;
  };
  for (const o of c.ops) {
    switch (o.op) {
      case 'bg':
        pixels.fill(o.color & 0xffffff);
        break;
      case 'fill':
        fill = o.color & 0xffffff;
        break;
      case 'fontcolor':
        fontColor = o.color & 0xffffff;
        break;
      case 'font':
        font = { name: o.name, size: o.size, style: o.style };
        break;
      case 'moveto':
        pen = [o.x, o.y];
        break;
      case 'text': {
        const layout = layoutText(metrics, font, o.bytes, glyphOf);
        for (let y = 0; y < layout.cellHeight; y++)
          for (let x = 0; x < layout.boxWidth; x++) put(o.x + x, o.y + y, fill);
        for (const { glyph, x } of layout.glyphs) {
          for (let y = 0; y < glyph.height; y++) {
            for (let gx = 0; gx < glyph.width; gx++)
              if (glyph.coverage[y * glyph.width + gx]) put(o.x + x + gx, o.y + y, fontColor);
          }
        }
        pen = [o.x + layout.extent, o.y];
        break;
      }
      default:
        break; // pen colour, width and mode do not affect text
    }
  }
  return { width: c.width, height: c.height, pixels, pen };
}
