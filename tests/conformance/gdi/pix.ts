// Reference file formats of the GDI pixel tests (ARCHITECTURE.md 6.5.3). Owner: T2.
//
//   .pix    one captured picture: "E68P", version 1, width (u16 LE), height (u16 LE), then runs of
//           count (u32 LE) and colour (u32 LE, $00BBGGRR) until width * height pixels are covered.
//   .bin    one font atlas: "E68F", version 2, cell width, cell height, glyph width, flags (bit 0 set
//           = 8-bit coverage, clear = 1 bit per pixel), 256 advances, then 256 glyphs of glyph width
//           x cell height, row-major, rows of 1-bit glyphs padded to whole bytes.
//   pack    the committed form of a suite's .pix files (refs/<suite>.pixpack.gz): gzip of "E68R",
//           version 1, header length (u32 LE), a JSON header { suite, capturedOn, cases: [[id, penX,
//           penY, length], ...] } and the .pix files one after the other, in case order. The capture
//           program writes one .pix per case; run.mjs packs them so that the repository holds a
//           few compressed files instead of 25,000 small ones (docs/porting/errata/T2.md).
//
// This file must stay free of relative imports and of non-erasable TypeScript syntax: run.mjs loads
// it with Node's built-in type stripping.

import { gunzipSync, gzipSync } from 'node:zlib';

export interface PixImage {
  readonly width: number;
  readonly height: number;
  /** One value per pixel, $00BBGGRR, row-major. */
  readonly pixels: Uint32Array;
}

export function encodePix(image: PixImage): Uint8Array {
  const { width, height, pixels } = image;
  const out: number[] = [0x45, 0x36, 0x38, 0x50, 1, width & 0xff, width >> 8, height & 0xff, height >> 8];
  const put32 = (v: number) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  let i = 0;
  while (i < pixels.length) {
    const colour = (pixels[i] as number) & 0xffffff;
    let j = i + 1;
    while (j < pixels.length && ((pixels[j] as number) & 0xffffff) === colour) j++;
    put32(j - i);
    put32(colour);
    i = j;
  }
  return Uint8Array.from(out);
}

export function decodePix(bytes: Uint8Array): PixImage {
  if (bytes.length < 9 || bytes[0] !== 0x45 || bytes[1] !== 0x36 || bytes[2] !== 0x38 || bytes[3] !== 0x50) {
    throw new Error('not a .pix file (magic E68P expected)');
  }
  if (bytes[4] !== 1) throw new Error(`.pix version ${bytes[4]} is not supported`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(5, true);
  const height = view.getUint16(7, true);
  const pixels = new Uint32Array(width * height);
  let at = 0;
  for (let p = 9; p < bytes.length; p += 8) {
    const count = view.getUint32(p, true);
    const colour = view.getUint32(p + 4, true);
    if (at + count > pixels.length) throw new Error('.pix runs cover more than width * height pixels');
    pixels.fill(colour, at, at + count);
    at += count;
  }
  if (at !== pixels.length) throw new Error(`.pix runs cover ${at} of ${pixels.length} pixels`);
  return { width, height, pixels };
}

export interface PackedCase {
  readonly id: string;
  /** GDI's current position after the case (the back buffer's pen position, trap15-b 5.5). */
  readonly pen: readonly [number, number];
  readonly pix: Uint8Array;
}

export interface Pack {
  readonly suite: string;
  /** The capture machine's Windows version and font-smoothing settings. */
  readonly capturedOn: unknown;
  readonly cases: readonly PackedCase[];
}

const PACK_MAGIC = [0x45, 0x36, 0x38, 0x52]; // "E68R"

/** The uncompressed pack bytes (deterministic for the same content). */
export function encodePackRaw(pack: Pack): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      suite: pack.suite,
      capturedOn: pack.capturedOn,
      cases: pack.cases.map((c) => [c.id, c.pen[0], c.pen[1], c.pix.length]),
    }),
  );
  const total = 9 + header.length + pack.cases.reduce((n, c) => n + c.pix.length, 0);
  const out = new Uint8Array(total);
  out.set(PACK_MAGIC, 0);
  out[4] = 1;
  new DataView(out.buffer).setUint32(5, header.length, true);
  out.set(header, 9);
  let at = 9 + header.length;
  for (const c of pack.cases) {
    out.set(c.pix, at);
    at += c.pix.length;
  }
  return out;
}

export function encodePack(pack: Pack): Uint8Array {
  return gzipSync(encodePackRaw(pack), { level: 9 });
}

export function decodePack(gz: Uint8Array): Pack {
  const raw = gunzipSync(gz);
  if (PACK_MAGIC.some((b, i) => raw[i] !== b)) throw new Error('not a pixel pack (magic E68R expected)');
  if (raw[4] !== 1) throw new Error(`pixel pack version ${raw[4]} is not supported`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const headerLength = view.getUint32(5, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(9, 9 + headerLength))) as {
    suite: string;
    capturedOn: unknown;
    cases: [string, number, number, number][];
  };
  let at = 9 + headerLength;
  const cases = header.cases.map(([id, penX, penY, length]) => {
    const pix = raw.subarray(at, at + length);
    at += length;
    return { id, pen: [penX, penY] as const, pix };
  });
  if (at !== raw.length) throw new Error('pixel pack: data does not match its header');
  return { suite: header.suite, capturedOn: header.capturedOn, cases };
}

export interface Atlas {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly glyphWidth: number;
  /** true: 8-bit coverage; false: 1 bit per pixel. */
  readonly coverage8: boolean;
  readonly advances: Uint8Array;
  /** Glyph `ch` as glyphWidth x cellHeight values 0 or 255 (1-bit atlases) or 0..255, row-major. */
  glyph(ch: number): Uint8Array;
}

export function decodeAtlas(bytes: Uint8Array): Atlas {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x36 || bytes[2] !== 0x38 || bytes[3] !== 0x46) {
    throw new Error('not a font atlas (magic E68F expected)');
  }
  if (bytes[4] !== 2) throw new Error(`atlas version ${bytes[4]} is not supported`);
  const cellWidth = bytes[5] as number;
  const cellHeight = bytes[6] as number;
  const glyphWidth = bytes[7] as number;
  const coverage8 = ((bytes[8] as number) & 1) === 1;
  const advances = bytes.slice(9, 9 + 256);
  const rowBytes = coverage8 ? glyphWidth : Math.ceil(glyphWidth / 8);
  const glyphBytes = rowBytes * cellHeight;
  const expected = 9 + 256 + 256 * glyphBytes;
  if (bytes.length !== expected) throw new Error(`atlas is ${bytes.length} bytes, its header says ${expected}`);
  return {
    cellWidth,
    cellHeight,
    glyphWidth,
    coverage8,
    advances,
    glyph(ch: number): Uint8Array {
      const base = 9 + 256 + ch * glyphBytes;
      const out = new Uint8Array(glyphWidth * cellHeight);
      for (let y = 0; y < cellHeight; y++) {
        for (let x = 0; x < glyphWidth; x++) {
          out[y * glyphWidth + x] = coverage8
            ? (bytes[base + y * rowBytes + x] as number)
            : ((bytes[base + y * rowBytes + (x >> 3)] as number) >> (7 - (x & 7))) & 1
              ? 255
              : 0;
        }
      }
      return out;
    },
  };
}
