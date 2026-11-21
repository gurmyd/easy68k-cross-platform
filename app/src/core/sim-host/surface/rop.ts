// Raster operations of the drawing mode (ARCHITECTURE.md 3.4 rule 2; trap15-b §5.4).
//
// Every pixel a line, a pixel, an outline, an interior or a flood fill writes is combined with the
// pixel already on the surface: result = op(P, D), bit by bit on the 24 colour bits. P is the colour
// being drawn (the pen colour, or the fill colour for interiors and flood fills) and D the pixel on
// the surface. Task 92 selects the operation with a mode number 0-15, which is not GDI's numbering:
// the VCL translates it through a table. Values 18-255 are stored like any other mode and index
// past the end of that table in the original program, so each of them draws as one of the sixteen
// modes, most of them as mode 1 (always white). MODE_TABLE reproduces that.
//
// To draw, the operation and the colour are folded into a `Mix`, two masks with
// result = (D & keep) ^ flip. That is possible because, for a fixed bit of P, each of the sixteen
// operations leaves the matching bit of D alone, inverts it, clears it or sets it.
//
// Owner: SH1.

const RGB = 0x00ffffff;
const OPAQUE = 0xff000000;

/**
 * The operation of mode `mode` (0-15) on the colours `p` and `d`; the result has 24 bits.
 * The table of trap15-b §5.4, row by row.
 */
export function rop(mode: number, p: number, d: number): number {
  switch (mode) {
    case 0: // pmBlack
      return 0x000000;
    case 1: // pmWhite
      return 0xffffff;
    case 2: // pmNop
      return d & RGB;
    case 3: // pmNot
      return ~d & RGB;
    case 4: // pmCopy
      return p & RGB;
    case 5: // pmNotCopy
      return ~p & RGB;
    case 6: // pmMergePenNot
      return (p | ~d) & RGB;
    case 7: // pmMaskPenNot
      return p & ~d & RGB;
    case 8: // pmMergeNotPen
      return (~p | d) & RGB;
    case 9: // pmMaskNotPen
      return ~p & d & RGB;
    case 10: // pmMerge
      return (p | d) & RGB;
    case 11: // pmNotMerge
      return ~(p | d) & RGB;
    case 12: // pmMask
      return p & d & RGB;
    case 13: // pmNotMask
      return ~(p & d) & RGB;
    case 14: // pmXor
      return (p ^ d) & RGB;
    case 15: // pmNotXor
      return ~(p ^ d) & RGB;
    default:
      throw new RangeError(`rop: mode ${mode} is not one of the sixteen operations`);
  }
}

/** The values from 18 to 255 that do not draw as mode 1, by the mode they draw as (trap15-b §5.4). */
const NOT_WHITE: Readonly<Record<number, readonly number[]>> = {
  0: [66, 98, 108, 116, 128, 140, 178, 188, 193, 222, 230],
  2: [146, 154],
  3: [118, 142],
  4: [158],
  5: [22, 24, 64, 84, 92, 122, 166, 168, 234],
  6: [162, 192],
  7: [78, 172],
  8: [156],
  9: [82, 120, 126, 132, 174, 180],
  10: [44, 48, 51, 52, 53, 55, 56, 57, 160],
  11: [80, 88, 110, 136, 164, 170, 184, 220, 232],
  12: [144],
  13: [65, 102, 150, 208, 236],
  14: [124, 130, 209, 212, 213],
  15: [148, 152],
};

/**
 * MODE_TABLE[penMode] is the mode 0-15 whose operation the pen mode `penMode` (0-255) draws with.
 * 0-15 are themselves; 18-255 follow the table above and are otherwise mode 1. The entries 16 and
 * 17 are never used: task 92 treats those two values as the double-buffer switches and does not
 * store them as the pen mode.
 */
export const MODE_TABLE: Readonly<Uint8Array> = (() => {
  const table = new Uint8Array(256).fill(1);
  for (let mode = 0; mode < 16; mode++) table[mode] = mode;
  for (const [mode, values] of Object.entries(NOT_WHITE)) for (const value of values) table[value] = Number(mode);
  return table;
})();

/** An operation and a colour, ready to be applied to pixels: result = (D & keep) ^ flip. */
export interface Mix {
  /** 24 bits: the bits of the surface pixel that take part in the result. */
  keep: number;
  /** 32 bits: the bits to invert afterwards, with the alpha byte of a stored pixel ($FF) set. */
  flip: number;
}

/** A Mix for `setMix` to fill in. */
export function createMix(): Mix {
  return { keep: 0, flip: OPAQUE };
}

/**
 * Sets `mix` to the operation of pen mode `penMode` (0-255) with the colour `color` ($00BBGGRR).
 * Stored pixels are 0xFF000000 | colour, and so are the results of the mix.
 */
export function setMix(mix: Mix, penMode: number, color: number): Mix {
  const mode = MODE_TABLE[penMode & 0xff] as number;
  // The operation is bitwise, so its results for D = all zeros and D = all ones describe it.
  const onZeros = rop(mode, color, 0x000000);
  const onOnes = rop(mode, color, 0xffffff);
  mix.keep = onZeros ^ onOnes;
  mix.flip = (OPAQUE | onZeros) >>> 0;
  return mix;
}

/**
 * The mix that has the effect of applying `mix` twice in a row. For Copy it is the mix itself, for
 * the XOR-type operations it changes nothing: (((D & keep) ^ flip) & keep) ^ flip = (D & keep) ^
 * (flip & ~keep).
 */
export function mixTwice(mix: Mix): Mix {
  return { keep: mix.keep, flip: (mix.flip & ~mix.keep) >>> 0 };
}

/** True if the mix leaves every pixel as it is (mode 2, or for example mode 14 with black). */
export function mixIsIdentity(mix: Mix): boolean {
  return mix.keep === RGB && mix.flip === OPAQUE;
}

/** The pixel value (alpha included) the mix gives a stored pixel `pixel`. */
export function mixed(mix: Mix, pixel: number): number {
  return ((pixel & mix.keep) ^ mix.flip) >>> 0;
}
