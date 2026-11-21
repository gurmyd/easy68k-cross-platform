// Windows-1252, the encoding of every text file of EASy68K (ARCHITECTURE.md 5.1).
//
// decode() maps each of the 256 byte values to one character. The five bytes Windows-1252 leaves
// undefined ($81, $8D, $8F, $90, $9D) map to the control characters U+0081, U+008D, U+008F, U+0090,
// U+009D, so decode() followed by encode() returns the original bytes for every input.
// encode() writes '?' for a character that has no byte and counts it.
//
// Owner: W1. Runs under Node and in browsers (core/ rules, 3.1).

import type { Bytes } from '../../contracts';

/** Code points of the bytes $80-$9F. */
const HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d,
  0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x009d, 0x017e, 0x0178,
];

/** Byte for each code point of HIGH. */
const FROM_HIGH = new Map<number, number>(HIGH.map((cp, i) => [cp, 0x80 + i]));

/** The character of every byte, indexed by byte value. */
const CHARS: readonly string[] = Array.from({ length: 256 }, (_, b) =>
  String.fromCharCode(b >= 0x80 && b < 0xa0 ? (HIGH[b - 0x80] as number) : b),
);

/** The byte that stands for `?` when a character has no Windows-1252 byte. */
export const REPLACEMENT_BYTE = 0x3f;

/** The Windows-1252 byte of a Unicode code point, or null if Windows-1252 has none. */
export function byteForCodePoint(codePoint: number): number | null {
  if (codePoint < 0x80 || (codePoint >= 0xa0 && codePoint <= 0xff)) return codePoint;
  return FROM_HIGH.get(codePoint) ?? null;
}

/** The code point of a byte (0-255). */
export function codePointForByte(byte: number): number {
  return (CHARS[byte & 0xff] as string).charCodeAt(0);
}

/** Bytes to text, one character per byte. */
export function decode(bytes: Bytes): string {
  let text = '';
  // Join in chunks: one string concatenation per byte is slow for megabyte files.
  const CHUNK = 8192;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const part: string[] = new Array<string>(end - start);
    for (let i = start; i < end; i++) part[i - start] = CHARS[bytes[i] as number] as string;
    text += part.join('');
  }
  return text;
}

/**
 * Text to bytes. Every character (Unicode code point, so a surrogate pair counts once) without a
 * Windows-1252 byte becomes '?' and is counted in `unmappable`.
 */
export function encode(text: string): { bytes: Bytes; unmappable: number } {
  const out = new Uint8Array(text.length); // never more bytes than UTF-16 code units
  let length = 0;
  let unmappable = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
        i++;
      }
    }
    const byte = byteForCodePoint(cp);
    if (byte === null) {
      out[length++] = REPLACEMENT_BYTE;
      unmappable++;
    } else {
      out[length++] = byte;
    }
  }
  return { bytes: out.slice(0, length), unmappable };
}

/** Number of characters of `text` that encode() would write as '?'. */
export function countUnmappable(text: string): number {
  return encode(text).unmappable;
}
