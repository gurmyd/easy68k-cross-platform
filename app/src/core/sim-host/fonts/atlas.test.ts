// The atlas file format of ARCHITECTURE.md 6.5.3: reading, writing, and what is refused.

import { describe, expect, it } from 'vitest';
import { ATLAS_GLYPHS, decodeAtlas, encodeAtlas, FontFormatError, trimGlyph, type FontAtlas } from './atlas';

/** An atlas whose glyph `ch` has coverage `(ch + x * 7 + y * 13) & 0xff` at (x, y), or a bit pattern for a 1-bit atlas. */
function sampleAtlas(cellWidth: number, cellHeight: number, glyphWidth: number, eightBit: boolean): FontAtlas {
  const advances = Uint8Array.from({ length: ATLAS_GLYPHS }, (_, ch) => (ch % cellWidth) + 1);
  return {
    cellWidth,
    cellHeight,
    glyphWidth,
    eightBit,
    advances,
    coverage: (ch) =>
      Uint8Array.from({ length: glyphWidth * cellHeight }, (_, i) => {
        const value = (ch + (i % glyphWidth) * 7 + Math.floor(i / glyphWidth) * 13) & 0xff;
        return eightBit ? value : value & 1 ? 255 : 0;
      }),
  };
}

function expectSameAtlas(actual: FontAtlas, expected: FontAtlas): void {
  expect({
    cellWidth: actual.cellWidth,
    cellHeight: actual.cellHeight,
    glyphWidth: actual.glyphWidth,
    eightBit: actual.eightBit,
  }).toEqual({
    cellWidth: expected.cellWidth,
    cellHeight: expected.cellHeight,
    glyphWidth: expected.glyphWidth,
    eightBit: expected.eightBit,
  });
  expect([...actual.advances]).toEqual([...expected.advances]);
  for (let ch = 0; ch < ATLAS_GLYPHS; ch++) {
    expect([...actual.coverage(ch)], `glyph ${ch}`).toEqual([...expected.coverage(ch)]);
  }
}

describe('font atlas files (6.5.3)', () => {
  it('an 8-bit atlas has the layout of 6.5.3, byte for byte', () => {
    const atlas = sampleAtlas(3, 2, 4, true);
    const bytes = encodeAtlas(atlas);
    // magic, version 2, cell 3 x 2, glyph width 4, flags 1
    expect([...bytes.subarray(0, 9)]).toEqual([0x45, 0x36, 0x38, 0x46, 2, 3, 2, 4, 1]);
    expect(bytes.length).toBe(9 + 256 + 256 * 4 * 2);
    expect([...bytes.subarray(9, 9 + 4)]).toEqual([1, 2, 3, 1]); // the first advance widths
    // glyph $00, row-major: (0 + x*7 + y*13) & 0xff
    expect([...bytes.subarray(9 + 256, 9 + 256 + 8)]).toEqual([0, 7, 14, 21, 13, 20, 27, 34]);
    // glyph $41 starts 65 glyphs later
    expect(bytes[9 + 256 + 65 * 8]).toBe(65);
  });

  it('a 1-bit atlas pads every row to whole bytes, leftmost pixel in the highest bit', () => {
    const glyphs = Array.from({ length: ATLAS_GLYPHS }, () => new Uint8Array(10 * 2));
    // glyph $01: row 0 has pixels 0 and 9, row 1 has pixel 7
    (glyphs[1] as Uint8Array).set([255], 0);
    (glyphs[1] as Uint8Array).set([255], 9);
    (glyphs[1] as Uint8Array).set([255], 10 + 7);
    const atlas: FontAtlas = {
      cellWidth: 10,
      cellHeight: 2,
      glyphWidth: 10,
      eightBit: false,
      advances: new Uint8Array(ATLAS_GLYPHS).fill(10),
      coverage: (ch) => glyphs[ch] as Uint8Array,
    };
    const bytes = encodeAtlas(atlas);
    expect(bytes[8]).toBe(0); // flags: 1 bit per pixel
    expect(bytes.length).toBe(9 + 256 + 256 * 2 * 2); // two bytes per row, two rows
    const glyph1 = 9 + 256 + 1 * 4;
    expect([...bytes.subarray(glyph1, glyph1 + 4)]).toEqual([0x80, 0x40, 0x01, 0x00]);
    expectSameAtlas(decodeAtlas(bytes), atlas);
  });

  it.each([
    ['8-bit, glyphs as wide as the cell', 8, 15, 8, true],
    ['8-bit with an overhang', 7, 14, 9, true],
    ['1-bit, glyphs as wide as the cell', 8, 15, 8, false],
    ['1-bit with an overhang, rows of two bytes', 12, 20, 14, false],
    ['the widest cell', 255, 9, 255, true],
  ])(
    'round trip: %s',
    (_name, cellWidth, cellHeight, glyphWidth, eightBit) => {
      const atlas = sampleAtlas(cellWidth, cellHeight, glyphWidth, eightBit);
      const bytes = encodeAtlas(atlas);
      const decoded = decodeAtlas(bytes);
      expectSameAtlas(decoded, atlas);
      expect(Buffer.from(encodeAtlas(decoded)).equals(Buffer.from(bytes))).toBe(true);
    },
    60_000,
  );

  it('reads a version field of two or four bytes as well (6.5.3 does not give its size)', () => {
    const atlas = sampleAtlas(6, 13, 6, true);
    const bytes = encodeAtlas(atlas);
    for (const padding of [1, 3]) {
      const wider = new Uint8Array(bytes.length + padding);
      wider.set(bytes.subarray(0, 5));
      wider.set(bytes.subarray(5), 5 + padding);
      expectSameAtlas(decodeAtlas(wider), atlas);
    }
  });

  it('refuses what is not a version 2 atlas of the right length', () => {
    const bytes = encodeAtlas(sampleAtlas(8, 15, 8, false));
    expect(() => decodeAtlas(new Uint8Array(0))).toThrow(FontFormatError);
    expect(() => decodeAtlas(Uint8Array.from([0x45, 0x36, 0x38, 0x50, 1]))).toThrow(/does not start with "E68F"/);
    const version3 = bytes.slice();
    version3[4] = 3;
    expect(() => decodeAtlas(version3)).toThrow(/version 3 is not supported/);
    expect(() => decodeAtlas(bytes.subarray(0, bytes.length - 1))).toThrow(/length does not fit its header/);
    const narrowGlyphs = bytes.slice();
    narrowGlyphs[7] = 7; // glyph width below the cell width
    expect(() => decodeAtlas(narrowGlyphs)).toThrow(FontFormatError);
  });

  it('refuses to write a cell that does not fit one byte', () => {
    expect(() => encodeAtlas(sampleAtlas(256, 15, 256, true))).toThrow(FontFormatError);
    expect(() => encodeAtlas({ ...sampleAtlas(8, 15, 8, true), glyphWidth: 7 })).toThrow(FontFormatError);
  });
});

describe('trimGlyph', () => {
  it('keeps a glyph that is as wide as its advance', () => {
    const coverage = Uint8Array.from([1, 0, 0, 0, 0, 0]); // 3 x 2
    const glyph = trimGlyph(coverage, 3, 2, 3);
    expect(glyph).toEqual({ advance: 3, width: 3, height: 2, coverage });
  });

  it('drops empty columns beyond the advance, and keeps an overhang', () => {
    // 5 wide, advance 2: ink in column 0 and column 3
    const coverage = Uint8Array.from([9, 0, 0, 0, 0, 0, 0, 0, 8, 0]);
    expect(trimGlyph(coverage, 5, 2, 2)).toEqual({
      advance: 2,
      width: 4,
      height: 2,
      coverage: Uint8Array.from([9, 0, 0, 0, 0, 0, 0, 8]),
    });
    // without the overhanging ink the glyph is as wide as its advance
    const plain = Uint8Array.from([9, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(trimGlyph(plain, 5, 2, 2)).toEqual({
      advance: 2,
      width: 2,
      height: 2,
      coverage: Uint8Array.from([9, 0, 0, 0]),
    });
  });

  it('is never narrower than one pixel', () => {
    expect(trimGlyph(new Uint8Array(6), 3, 2, 0)).toMatchObject({ advance: 0, width: 1, height: 2 });
  });
});
