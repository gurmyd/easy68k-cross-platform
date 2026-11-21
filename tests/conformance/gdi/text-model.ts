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
import { spots } from './golden';

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
  const cell = cellOf(metrics, font);
  if ((OUTLINE_ZERO_ADVANCE[cell.face] ?? []).includes(byte)) return 0;
  return cell.colWidth;
}

/**
 * Bytes whose advance in a monospaced outline face is 0 instead of the cell width, at every size
 * and style (review round 2 of gate I1: measured at sizes 0-255 in all five styles; the other
 * zero-width bytes and the other faces have the cell width). Consolas has a zero-width glyph for
 * the carriage return; `windows-outline-metrics.tsv` shows it at the measured sizes.
 */
export const OUTLINE_ZERO_ADVANCE: Readonly<Record<string, readonly number[]>> = { Consolas: [0x0d] };

/**
 * The width `byte` takes in the opaque cell of a monospaced outline face, which is not always its
 * TextWidth advance (review round 2 of gate I1, defect 14; measured against fresh captures in 2,120
 * strings at the atlas sizes, and zero-width strings at sizes 0-72): a zero-width byte takes none,
 * even alone (GDI then fills no cell, only the widening of `outlineCells`); `$7F` always takes the
 * fallback glyph's width (`delInHighString`), with or without a byte of `$80` or above, although
 * TextWidth counts the face's advance for it when there is none. null when that width is needed and
 * the size has no outline atlas.
 */
export function outlineCellAdvance(
  metrics: Metrics,
  font: FontRequest,
  byte: number,
  bytes: readonly number[],
): number | null {
  if (isZeroWidth(byte)) return 0;
  if (byte === 0x7f) return outlineEntry(metrics, font)?.delInHighString ?? null;
  return outlineAdvance(metrics, font, byte, bytes);
}

/**
 * Task 95 in a monospaced outline face, with blank glyphs (the glyph pixels of the outline faces are
 * substitutes and are not compared, 6.5.3): the cell from outlineCellAdvance(), the pen from
 * textExtent() with outlineAdvance(). null when a width is not known at this size.
 */
export function layoutOutlineText(metrics: Metrics, font: FontRequest, bytes: readonly number[]): TextLayout | null {
  const cell = cellOf(metrics, font);
  const glyphs: { glyph: TestGlyph; x: number }[] = [];
  let x = 0;
  for (const b of bytes) {
    const a = outlineCellAdvance(metrics, font, b, bytes);
    if (a === null) return null;
    if (isZeroWidth(b)) continue;
    glyphs.push({
      glyph: { advance: a, width: a, height: cell.rowHeight, coverage: new Uint8Array(a * cell.rowHeight) },
      x,
    });
    x += a;
  }
  if (bytes.some((b) => outlineAdvance(metrics, font, b, bytes) === null)) return null;
  const extent = textExtent(bytes, (b) => outlineAdvance(metrics, font, b, bytes) as number);
  return { glyphs, boxWidth: x, extent, cellHeight: cell.rowHeight };
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
 * cells; and the pen after the last string. The cells and the pen follow layoutOutlineText(). null
 * when the case uses the proportional face (no per-byte advances at every size), a $7F at a size
 * without an outline atlas, or a string that draws only $7F (the fallback font's cell height).
 */
export function outlineCells(
  metrics: Metrics,
  c: GdiCase,
  widen: (style: number, cellHeight: number) => [left: number, right: number] = outlineWidening,
): {
  boxes: Box[];
  pen: [number, number];
  uncertain: (x: number, y: number) => boolean;
  /** The pixels by which GDI may widen a cell (a part of `uncertain`): where the glyphs' ink can reach. */
  widening: (x: number, y: number) => boolean;
} | null {
  let font: FontRequest = { name: 'Fixedsys', size: 9, style: 0 };
  const boxes: Box[] = [];
  const margins: [left: number, right: number][] = [];
  let pen: [number, number] = [0, 0];
  let line = false;
  for (const o of c.ops) {
    if (o.op === 'font') font = { name: o.name, size: o.size, style: o.style };
    if (o.op === 'moveto') pen = [o.x, o.y];
    if (o.op !== 'text') continue;
    const cell = cellOf(metrics, font);
    if (cell.face === 'Arial') return null;
    if (font.style === 3 || font.style === 4) line = true;
    const layout = layoutOutlineText(metrics, font, o.bytes);
    if (layout === null) return null;
    // A string whose drawn bytes are all $7F gets the fallback font's cell, which can be a row lower
    // than the face's (Courier New 8, Lucida Console 10); its height is not measured.
    if (o.bytes.includes(0x7f) && o.bytes.every((b) => b === 0x7f || isZeroWidth(b))) return null;
    boxes.push({ x: o.x, y: o.y, w: layout.boxWidth, h: cell.rowHeight });
    margins.push(widen(font.style, cell.rowHeight));
    pen = [o.x + layout.extent, o.y];
  }
  const inside = (x: number, y: number, widen: boolean) =>
    boxes.some((b, i) => {
      const [left, right] = widen ? (margins[i] as [number, number]) : [0, 0];
      return x >= b.x - left && x < b.x + b.w + right && y >= b.y && y < b.y + b.h;
    });
  const widening = (x: number, y: number) => !inside(x, y, false) && inside(x, y, true);
  return { boxes, pen, uncertain: (x, y) => widening(x, y) || (line && !inside(x, y, false)), widening };
}

/**
 * How many pixels GDI may widen an outline cell by, on the left and on the right: the ink overhang of
 * the first and last glyph. Measured with fresh captures (gate I1 round 3: Courier New, Lucida
 * Console and Consolas at 0-40, 44-100 pt, 60 random strings of printable bytes per face, size and
 * style): plain and bold stay within a tenth of the cell height (at least 3); italic leans further,
 * on the right up to a third of the cell height (Lucida Console 29 pt: 13 of 39 rows; 90 pt: 32 of
 * 120) and on the left one more pixel (Consolas 19 pt: 4).
 */
export function outlineWidening(style: number, cellHeight: number): [left: number, right: number] {
  const base = Math.max(3, Math.ceil(cellHeight / 10));
  return style === 2 ? [base + 1, Math.max(3, Math.ceil(0.35 * cellHeight))] : [base, base];
}

/** tmOverhang of GDI's style simulation for a raster face. */
export function rasterOverhang(style: number, cellHeight: number): number {
  return style === 1 ? 1 : style === 2 ? Math.floor((cellHeight - 1) / 2) : 0;
}

/** The tables a colour form needs (golden/spots.json). */
export interface ColourTables {
  sysColors: readonly number[];
  stockPalette: readonly number[];
}

/**
 * The colour GDI draws for a VCL TColor, by trap15-b 4.6 as the capture measured it: bit 31 = the
 * system colour of the low byte (black above 30), else bit 24 = the stock palette entry of the low 16
 * bits (black from 20), else the low 24 bits. The same for pens, brushes and (request
 * SH3-gdi-text-colour.md) the font colour of task 21.
 */
export function resolveColour(c: number, tables: ColourTables): number {
  if (c & 0x80000000) return (c & 0xff) <= 30 ? ((tables.sysColors[c & 0xff] as number) ?? 0) : 0;
  if (c & 0x01000000) return (tables.stockPalette[c & 0xffff] as number | undefined) ?? 0;
  return c & 0xffffff;
}

/** Replays a text case (bg, fill, fontcolor, font, text, moveto; other operations do not affect text). */
export function drawTextCase(
  metrics: Metrics,
  c: GdiCase,
  glyphOf: GlyphOf = rasterGlyph,
  colours: ColourTables = spots(),
): Picture {
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
        fontColor = resolveColour(o.color, colours);
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
