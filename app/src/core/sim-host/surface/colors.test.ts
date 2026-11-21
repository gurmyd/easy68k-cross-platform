// The colour forms of trap15-b §4.6 (SH1 acceptance, ARCHITECTURE.md 9.2).

import { describe, expect, it } from 'vitest';
import { resolveColor, STOCK_PALETTE, SYSTEM_COLORS } from './colors';

describe('resolveColor (trap15-b §4.6)', () => {
  it('top byte $00: the colour as given', () => {
    expect(resolveColor(0x000000ff)).toBe(0x0000ff);
    expect(resolveColor(0x00123456)).toBe(0x123456);
    expect(resolveColor(0x00ffffff)).toBe(0xffffff);
  });

  it('bit 31 set: a Windows system colour, chosen by the low byte', () => {
    // the three values trap15-b measured
    expect(resolveColor(0x80000005)).toBe(0xffffff); // window
    expect(resolveColor(0x80000008)).toBe(0x000000); // window text
    expect(resolveColor(0x8000000f)).toBe(0xf0f0f0); // button face
    // only the low byte counts, and every top byte from $80 to $FF selects this form
    expect(resolveColor(0xff12340f)).toBe(0xf0f0f0);
    expect(resolveColor(0x81ffff05)).toBe(0xffffff);
  });

  it('bit 31 set: an index above 30 is black', () => {
    for (let index = 31; index <= 255; index++) expect(resolveColor(0x80000000 + index), `index ${index}`).toBe(0);
  });

  it('accepts the value as the engine passes it, a signed 32-bit number', () => {
    expect(resolveColor(0x8000000f | 0)).toBe(0xf0f0f0);
    expect(resolveColor(-1)).toBe(0); // $FFFFFFFF: system colour 255
    expect(resolveColor(0x01000005 | 0)).toBe(0x800080);
  });

  it('bit 24 set, bit 31 clear: an entry of the stock palette, chosen by the low 16 bits', () => {
    // the five entries trap15-b names as measured
    expect(resolveColor(0x01000000)).toBe(0x000000);
    expect(resolveColor(0x01000001)).toBe(0x000080);
    expect(resolveColor(0x01000005)).toBe(0x800080);
    expect(resolveColor(0x0100000c)).toBe(0x808080);
    expect(resolveColor(0x01000013)).toBe(0xffffff);
    // "$01010005 is entry 5 and $0100FF05 is black"
    expect(resolveColor(0x01010005)).toBe(0x800080);
    expect(resolveColor(0x0100ff05)).toBe(0x000000);
    // every odd top byte up to $7F
    for (let top = 0x01; top <= 0x7f; top += 2)
      expect(resolveColor(top * 0x1000000 + 13), `top $${top}`).toBe(0x0000ff);
  });

  it('bit 24 set: index 20 and above is black', () => {
    expect(resolveColor(0x01000014)).toBe(0);
    expect(resolveColor(0x0100ffff)).toBe(0);
  });

  it('other top bytes with bit 24 and bit 31 clear: the low 24 bits', () => {
    for (const top of [0x02, 0x04, 0x0a, 0x10, 0x7e]) {
      expect(resolveColor(top * 0x1000000 + 0x123456), `top $${top}`).toBe(0x123456);
    }
  });

  it('a resolved colour resolves to itself', () => {
    for (const color of [0x80000005, 0x01000009, 0x02abcdef, 0x00010203]) {
      expect(resolveColor(resolveColor(color))).toBe(resolveColor(color));
    }
  });
});

describe('the two tables', () => {
  it('the stock palette has the 20 entries of trap15-b §4.6, in order', () => {
    // "0 000000, 1 000080, 2 008000, ... 19 FFFFFF", typed from the spec as one string
    const spec =
      '000000 000080 008000 008080 800000 800080 808000 C0C0C0 C0DCC0 F0CAA6 ' +
      'F0FBFF A4A0A0 808080 0000FF 00FF00 00FFFF FF0000 FF00FF FFFF00 FFFFFF';
    expect(STOCK_PALETTE.map((color) => color.toString(16).toUpperCase().padStart(6, '0')).join(' ')).toBe(spec);
  });

  it('the system colours 0-30 are those GetSysColor gave the GDI capture on a default Windows 11 desktop', () => {
    // the first 31 values of `sysColors` in tests/conformance/gdi/golden/spots.json; all above are 0
    const captured = [
      0xc8c8c8, 0x000000, 0xd1b499, 0xdbcdbf, 0xf0f0f0, 0xffffff, 0x646464, 0x000000, 0x000000, 0x000000, 0xb4b4b4,
      0xfcf7f4, 0xababab, 0xd77800, 0xffffff, 0xf0f0f0, 0xa0a0a0, 0x6d6d6d, 0x000000, 0x000000, 0xffffff, 0x696969,
      0xe3e3e3, 0x000000, 0xe1ffff, 0x000000, 0xcc6600, 0xead1b9, 0xf2e4d7, 0xd77800, 0xf0f0f0,
    ];
    expect([...SYSTEM_COLORS]).toEqual(captured);
    captured.forEach((color, index) => expect(resolveColor(0x80000000 + index), `index ${index}`).toBe(color));
  });
});
