// The drawing modes of trap15-b §5.4: the sixteen operations and the mode table for every value
// 0-255 (SH1 acceptance, ARCHITECTURE.md 9.2).

import { describe, expect, it } from 'vitest';
import { createMix, mixed, mixIsIdentity, mixTwice, MODE_TABLE, rop, setMix } from './rop';
import { createRandom } from './testing';

/**
 * The "Result pixel" column of the table in trap15-b §5.4 as truth tables: the result bit for the
 * bits (P, D) = (0,0), (0,1), (1,0), (1,1), in that order.
 */
const TRUTH: readonly string[] = [
  '0000', //  0  $000000
  '1111', //  1  $FFFFFF
  '0101', //  2  D
  '1010', //  3  ~D
  '0011', //  4  P
  '1100', //  5  ~P
  '1011', //  6  P | ~D
  '0010', //  7  P & ~D
  '1101', //  8  ~P | D
  '0100', //  9  ~P & D
  '0111', // 10  P | D
  '1000', // 11  ~(P | D)
  '0001', // 12  P & D
  '1110', // 13  ~(P & D)
  '0110', // 14  P ^ D
  '1001', // 15  ~(P ^ D)
];

/** The operation of a mode by its truth table, one bit at a time. */
function byTruthTable(mode: number, p: number, d: number): number {
  const table = TRUTH[mode] as string;
  let result = 0;
  for (let bit = 0; bit < 24; bit++) {
    const index = (((p >> bit) & 1) << 1) | ((d >> bit) & 1);
    if (table[index] === '1') result |= 1 << bit;
  }
  return result;
}

/**
 * What each pen mode 0-255 draws as, regenerated from the official SIM68K.exe v5.16.1 the way
 * trap15-b §5.4 describes (the 16-bit words at $005270B4 + 2 * value, GDI's rule
 * ((low byte - 1) AND 15) + 1, then back through the first 16 words). An independent copy of the
 * table that rop.ts builds from the lists of the spec.
 */
const FROM_THE_BINARY: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 1, 1, 1, 1, 1, 1, 5, 1, 5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 10, 1, 1, 1, 10, 1, 1, 10, 10, 10, 1, 10, 10, 10, 1, 1, 1, 1, 1, 1, 5, 13, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 7, 1, 11, 1, 9, 1, 5, 1, 1, 1, 11, 1, 1, 1, 5, 1, 1, 1, 1, 1, 0, 1, 1, 1, 13, 1, 1, 1, 1, 1, 0, 1, 11,
  1, 1, 1, 1, 1, 0, 1, 3, 1, 9, 1, 5, 1, 14, 1, 9, 1, 0, 1, 14, 1, 9, 1, 1, 1, 11, 1, 1, 1, 0, 1, 3, 1, 12, 1, 2, 1, 15,
  1, 13, 1, 15, 1, 2, 1, 8, 1, 4, 1, 10, 1, 6, 1, 11, 1, 5, 1, 5, 1, 11, 1, 7, 1, 9, 1, 1, 1, 0, 1, 9, 1, 1, 1, 11, 1,
  1, 1, 0, 1, 1, 1, 6, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 13, 14, 1, 1, 14, 14, 1, 1, 1, 1, 1, 1, 11, 1, 0, 1,
  1, 1, 1, 1, 1, 1, 0, 1, 11, 1, 5, 1, 13, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
];

describe('the sixteen operations (trap15-b §5.4)', () => {
  it('each gives the formula of the table on the measured sample: D $336699, pen $0F0FF0, brush $F0F00F', () => {
    for (let mode = 0; mode < 16; mode++) {
      expect(rop(mode, 0x0f0ff0, 0x336699), `mode ${mode}, pen`).toBe(byTruthTable(mode, 0x0f0ff0, 0x336699));
      expect(rop(mode, 0xf0f00f, 0x336699), `mode ${mode}, brush`).toBe(byTruthTable(mode, 0xf0f00f, 0x336699));
    }
  });

  it('a few results written out', () => {
    expect(rop(4, 0x0f0ff0, 0x336699)).toBe(0x0f0ff0); // copy
    expect(rop(3, 0x0f0ff0, 0x336699)).toBe(0xcc9966); // not background
    expect(rop(14, 0x0f0ff0, 0x336699)).toBe(0x3c6969); // xor
    expect(rop(14, 0xffffff, 0xffffff)).toBe(0x000000); // white on white in xor: black
    expect(rop(12, 0xf0f00f, 0x336699)).toBe(0x306009); // and
    expect(rop(10, 0xf0f00f, 0x336699)).toBe(0xf3f69f); // or
  });

  it('ignores anything above the 24 colour bits', () => {
    for (let mode = 0; mode < 16; mode++) {
      expect(rop(mode, 0xff0f0ff0 | 0, 0xff336699 | 0)).toBe(rop(mode, 0x0f0ff0, 0x336699));
    }
  });

  it('rejects a mode that is not 0-15', () => {
    expect(() => rop(16, 0, 0)).toThrow(RangeError);
  });
});

describe('MODE_TABLE: what every pen mode 0-255 draws as (trap15-b §5.4)', () => {
  it('has 256 entries', () => {
    expect(MODE_TABLE).toHaveLength(256);
  });

  it('modes 0-15 are themselves', () => {
    for (let mode = 0; mode < 16; mode++) expect(MODE_TABLE[mode]).toBe(mode);
  });

  it('every value 0-255 equals the table regenerated from the official binary', () => {
    expect(FROM_THE_BINARY).toHaveLength(256);
    for (let value = 0; value < 256; value++) expect(MODE_TABLE[value], `mode ${value}`).toBe(FROM_THE_BINARY[value]);
  });

  it('171 of the values 18-255 draw as mode 1, always white; 18-21 are among them', () => {
    let white = 0;
    for (let value = 18; value < 256; value++) if (MODE_TABLE[value] === 1) white++;
    expect(white).toBe(171);
    for (const value of [18, 19, 20, 21]) expect(MODE_TABLE[value]).toBe(1);
  });

  it('the examples of trap15-b §15 V8: mode 20 is white, mode 22 the inverse of the pen colour', () => {
    expect(mixed(setMix(createMix(), 20, 0x0000ff), 0xff000000)).toBe(0xffffffff);
    expect(mixed(setMix(createMix(), 22, 0x0000ff), 0xff000000)).toBe(0xffffff00);
  });
});

describe('Mix: an operation and a colour folded into two masks', () => {
  it('gives the result of the operation for every pen mode, with the alpha byte set', () => {
    const random = createRandom(1);
    const mix = createMix();
    for (let penMode = 0; penMode < 256; penMode++) {
      for (let n = 0; n < 20; n++) {
        const p = random.int(0, 0xffffff);
        const d = random.int(0, 0xffffff);
        const expected = (0xff000000 | byTruthTable(FROM_THE_BINARY[penMode] as number, p, d)) >>> 0;
        expect(mixed(setMix(mix, penMode, p), (0xff000000 | d) >>> 0), `mode ${penMode}`).toBe(expected);
      }
    }
  }, 60_000);

  it('mixTwice is the mix applied two times, for every operation', () => {
    const random = createRandom(2);
    for (let mode = 0; mode < 16; mode++) {
      for (let n = 0; n < 50; n++) {
        const p = random.int(0, 0xffffff);
        const d = (0xff000000 | random.int(0, 0xffffff)) >>> 0;
        const once = setMix(createMix(), mode, p);
        expect(mixed(mixTwice(once), d), `mode ${mode}`).toBe(mixed(once, mixed(once, d)));
      }
    }
    expect(mixIsIdentity(mixTwice(setMix(createMix(), 14, 0x123456)))).toBe(true); // xor twice
    expect(mixTwice(setMix(createMix(), 4, 0x123456))).toEqual(setMix(createMix(), 4, 0x123456)); // copy twice
  });

  it('uses the low byte of the pen mode', () => {
    expect(setMix(createMix(), 0x10e, 0x123456)).toEqual(setMix(createMix(), 14, 0x123456));
  });

  it('knows when nothing would change', () => {
    expect(mixIsIdentity(setMix(createMix(), 2, 0x123456))).toBe(true); // mode 2: move but do not draw
    expect(mixIsIdentity(setMix(createMix(), 14, 0x000000))).toBe(true); // xor with black
    expect(mixIsIdentity(setMix(createMix(), 12, 0xffffff))).toBe(true); // and with white
    expect(mixIsIdentity(setMix(createMix(), 14, 0x000001))).toBe(false);
    expect(mixIsIdentity(setMix(createMix(), 4, 0x000000))).toBe(false);
  });
});
