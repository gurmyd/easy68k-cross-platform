import { describe, expect, it } from 'vitest';
import { byteForCodePoint, codePointForByte, countUnmappable, decode, encode } from './cp1252';

const asmModuleUrl = new URL('../../../../engine/asm/asm68k.mjs', import.meta.url).href;

describe('Windows-1252 codec (5.1)', () => {
  it('round-trips all 256 byte values', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = decode(all);
    expect(text.length).toBe(256);
    const { bytes, unmappable } = encode(text);
    expect(unmappable).toBe(0);
    expect([...bytes]).toEqual([...all]);
  });

  it('round-trips a large buffer of random bytes', () => {
    const data = new Uint8Array(100_000);
    let seed = 12345;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      data[i] = seed >>> 24;
    }
    expect(encode(decode(data)).bytes).toEqual(data);
  });

  it('maps $80-$9F to the Windows-1252 characters and the five undefined bytes to C1 controls', () => {
    expect(decode(Uint8Array.of(0x80))).toBe('€'); // euro sign
    expect(decode(Uint8Array.of(0x85))).toBe('…'); // ellipsis
    expect(decode(Uint8Array.of(0x92))).toBe('’');
    expect(decode(Uint8Array.of(0x9f))).toBe('Ÿ');
    for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) expect(decode(Uint8Array.of(b)).charCodeAt(0)).toBe(b);
    expect(decode(Uint8Array.of(0xe9))).toBe('é');
    expect(decode(Uint8Array.of(0x00, 0x0d, 0x0a, 0x1a))).toBe('\0\r\n\x1a');
  });

  it('agrees with the table of engine/asm/asm68k.mjs for every byte', async () => {
    const asm = (await import(/* @vite-ignore */ asmModuleUrl)) as {
      decodeCp1252(bytes: Uint8Array): string;
      encodeCp1252(text: string): Uint8Array;
    };
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decode(all)).toBe(asm.decodeCp1252(all));
    expect(encode(decode(all)).bytes).toEqual(asm.encodeCp1252(decode(all)));
  });

  it("writes '?' for characters without a byte and counts them", () => {
    const { bytes, unmappable } = encode('A中BΩ');
    expect([...bytes]).toEqual([0x41, 0x3f, 0x42, 0x3f]);
    expect(unmappable).toBe(2);
    expect(countUnmappable('plain ASCII and é€')).toBe(0);
  });

  it('counts a character outside the BMP once', () => {
    const { bytes, unmappable } = encode('x\u{1f600}y');
    expect([...bytes]).toEqual([0x78, 0x3f, 0x79]);
    expect(unmappable).toBe(1);
  });

  it('gives the byte of a code point, or null', () => {
    expect(byteForCodePoint(0x41)).toBe(0x41);
    expect(byteForCodePoint(0x20ac)).toBe(0x80);
    expect(byteForCodePoint(0x81)).toBe(0x81);
    expect(byteForCodePoint(0x80)).toBeNull(); // U+0080 has no byte: $80 is the euro sign
    expect(byteForCodePoint(0x100)).toBeNull();
    expect(codePointForByte(0x80)).toBe(0x20ac);
    expect(codePointForByte(0xff)).toBe(0xff);
  });
});
