// Font atlas files (ARCHITECTURE.md 3.5.1, 6.5.3): one file holds the 256 glyphs of one face at one
// pixel size in one style, `app/public/fonts/{bitmap,scalable}/<face>-<height>[-<style>].bin`.
//
// Layout (every field is one byte unless noted):
//
//   "E68F"               magic
//   version              2
//   cell width           TextWidth("W") of the font
//   cell height          TextHeight("Xp") of the font
//   glyph width          at least the cell width; larger when a style overhangs
//   flags                bit 0 set = one byte of coverage per pixel, clear = one bit per pixel
//   256 advance widths   the text extent of each byte
//   256 glyphs           glyph width x cell height each, for the bytes $00..$FF in order, row-major;
//                        a row of a 1-bit glyph is padded to whole bytes
//
// Two things 6.5.3 leaves open are decided here and recorded in docs/porting/errata/SH3.md:
// - how many bytes the version takes: this module writes one byte, and reads one, two or four
//   (little-endian), whichever makes the file length fit the header;
// - the bit order of 1-bit rows: the leftmost pixel is the highest bit of the first byte.
//
// This module only encodes and decodes; fonts/font-set.ts decides which atlas a font uses.
//
// Owner: SH3.

import type { Bytes, Glyph } from '../../../contracts';

export const ATLAS_MAGIC = 'E68F';
export const ATLAS_VERSION = 2;
/** Number of glyphs in every atlas: one per Windows-1252 byte. */
export const ATLAS_GLYPHS = 256;

const FLAG_EIGHT_BIT = 0x01;
/** Sizes of the version field the reader accepts, in bytes, in the order it tries them. */
const VERSION_SIZES = [1, 2, 4] as const;

/** A font atlas in memory. */
export interface FontAtlas {
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Width of every glyph bitmap of this atlas; `cellWidth` or more. */
  readonly glyphWidth: number;
  /** true: 8-bit coverage (outline faces). false: two-colour, coverage 0 or 255 (raster faces). */
  readonly eightBit: boolean;
  /** Text extent of each byte in pixels, 256 entries. */
  readonly advances: Uint8Array;
  /** The bitmap of one byte: `glyphWidth * cellHeight` coverage values 0..255, row-major.
   *  The array may be a view of the atlas file; callers do not change it. */
  coverage(ch: number): Uint8Array;
}

/** A file that is not a font atlas of 6.5.3, or one this reader cannot use. */
export class FontFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FontFormatError';
  }
}

/** Bytes one glyph takes in the file. */
function storedGlyphSize(glyphWidth: number, cellHeight: number, eightBit: boolean): number {
  return (eightBit ? glyphWidth : Math.ceil(glyphWidth / 8)) * cellHeight;
}

class DecodedAtlas implements FontAtlas {
  readonly advances: Uint8Array;

  constructor(
    readonly cellWidth: number,
    readonly cellHeight: number,
    readonly glyphWidth: number,
    readonly eightBit: boolean,
    advances: Uint8Array,
    /** The glyph section of the file, as stored. */
    private readonly stored: Uint8Array,
  ) {
    this.advances = advances;
  }

  coverage(ch: number): Uint8Array {
    const { glyphWidth, cellHeight } = this;
    const size = storedGlyphSize(glyphWidth, cellHeight, this.eightBit);
    const start = (ch & 0xff) * size;
    if (this.eightBit) return this.stored.subarray(start, start + size);
    const rowBytes = Math.ceil(glyphWidth / 8);
    const pixels = new Uint8Array(glyphWidth * cellHeight);
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < glyphWidth; x++) {
        const byte = this.stored[start + y * rowBytes + (x >> 3)] as number;
        if (byte & (0x80 >> (x & 7))) pixels[y * glyphWidth + x] = 255;
      }
    }
    return pixels;
  }
}

/** Reads the header with a version field of `versionSize` bytes; null when the file does not fit it. */
function decodeWith(bytes: Bytes, versionSize: number): FontAtlas | null {
  const header = ATLAS_MAGIC.length + versionSize + 4;
  if (bytes.length < header + ATLAS_GLYPHS) return null;
  let version = 0;
  for (let i = versionSize - 1; i >= 0; i--) version = version * 256 + (bytes[ATLAS_MAGIC.length + i] as number);
  if (version !== ATLAS_VERSION) return null;
  const at = ATLAS_MAGIC.length + versionSize;
  const cellWidth = bytes[at] as number;
  const cellHeight = bytes[at + 1] as number;
  const glyphWidth = bytes[at + 2] as number;
  const eightBit = ((bytes[at + 3] as number) & FLAG_EIGHT_BIT) !== 0;
  if (cellWidth === 0 || cellHeight === 0 || glyphWidth < cellWidth) return null;
  const glyphs = header + ATLAS_GLYPHS;
  if (bytes.length !== glyphs + ATLAS_GLYPHS * storedGlyphSize(glyphWidth, cellHeight, eightBit)) return null;
  return new DecodedAtlas(
    cellWidth,
    cellHeight,
    glyphWidth,
    eightBit,
    bytes.subarray(header, glyphs),
    bytes.subarray(glyphs),
  );
}

/**
 * Decodes an atlas file. The result keeps views of `bytes`, so the caller must not change them
 * afterwards. Throws `FontFormatError` for anything that is not a version 2 atlas of exactly the
 * length its header describes.
 */
export function decodeAtlas(bytes: Bytes): FontAtlas {
  const magic = String.fromCharCode(...bytes.subarray(0, ATLAS_MAGIC.length));
  if (magic !== ATLAS_MAGIC)
    throw new FontFormatError(`not a font atlas: the file does not start with "${ATLAS_MAGIC}"`);
  for (const versionSize of VERSION_SIZES) {
    const atlas = decodeWith(bytes, versionSize);
    if (atlas) return atlas;
  }
  const version = bytes[ATLAS_MAGIC.length];
  throw new FontFormatError(
    version === ATLAS_VERSION
      ? `font atlas of ${bytes.length} bytes: the length does not fit its header ` +
          `(cell ${bytes[5]} x ${bytes[6]}, glyph width ${bytes[7]}, flags ${bytes[8]})`
      : `font atlas version ${version} is not supported (this reader knows version ${ATLAS_VERSION})`,
  );
}

/** Encodes an atlas as a file of 6.5.3. In a 1-bit atlas a pixel is set when its coverage is 128 or more. */
export function encodeAtlas(atlas: FontAtlas): Bytes {
  const { cellWidth, cellHeight, glyphWidth, eightBit } = atlas;
  const fits = (value: number) => Number.isInteger(value) && value >= 1 && value <= 255;
  if (!fits(cellWidth) || !fits(cellHeight) || !fits(glyphWidth) || glyphWidth < cellWidth) {
    throw new FontFormatError(
      `a font atlas cannot hold a ${cellWidth} x ${cellHeight} cell with glyphs ${glyphWidth} wide`,
    );
  }
  if (atlas.advances.length !== ATLAS_GLYPHS) throw new FontFormatError('a font atlas has 256 advance widths');
  const header = ATLAS_MAGIC.length + 5;
  const size = storedGlyphSize(glyphWidth, cellHeight, eightBit);
  const bytes = new Uint8Array(header + ATLAS_GLYPHS + ATLAS_GLYPHS * size);
  for (let i = 0; i < ATLAS_MAGIC.length; i++) bytes[i] = ATLAS_MAGIC.charCodeAt(i);
  bytes.set([ATLAS_VERSION, cellWidth, cellHeight, glyphWidth, eightBit ? FLAG_EIGHT_BIT : 0], ATLAS_MAGIC.length);
  bytes.set(atlas.advances, header);
  const rowBytes = Math.ceil(glyphWidth / 8);
  for (let ch = 0; ch < ATLAS_GLYPHS; ch++) {
    const pixels = atlas.coverage(ch);
    const start = header + ATLAS_GLYPHS + ch * size;
    if (eightBit) {
      bytes.set(pixels.subarray(0, size), start);
      continue;
    }
    for (let y = 0; y < cellHeight; y++) {
      for (let x = 0; x < glyphWidth; x++) {
        if ((pixels[y * glyphWidth + x] as number) >= 128) {
          const at = start + y * rowBytes + (x >> 3);
          bytes[at] = (bytes[at] as number) | (0x80 >> (x & 7));
        }
      }
    }
  }
  return bytes;
}

/**
 * The narrowest glyph that shows all of `coverage`: empty columns on the right are dropped, but the
 * glyph stays at least as wide as its advance (so the usual glyph is exactly one advance wide, and
 * only an overhanging one is wider) and at least one pixel wide.
 */
export function trimGlyph(coverage: Uint8Array, width: number, height: number, advance: number): Glyph {
  let used = Math.max(1, Math.min(advance, width));
  for (let x = width - 1; x >= used; x--) {
    let ink = false;
    for (let y = 0; y < height && !ink; y++) ink = (coverage[y * width + x] as number) !== 0;
    if (ink) {
      used = x + 1;
      break;
    }
  }
  if (used === width) return { advance, width, height, coverage };
  const trimmed = new Uint8Array(used * height);
  for (let y = 0; y < height; y++) trimmed.set(coverage.subarray(y * width, y * width + used), y * used);
  return { advance, width: used, height, coverage: trimmed };
}
