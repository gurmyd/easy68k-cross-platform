// Unit tests of X3's own code: the SHA-256, the PNG decoder, the surface-hash helpers and the
// golden file's shape. No engine needed.

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { describeDifference, readGolden, type GoldenEntry } from './golden';
import { GOLDEN_PATH, OFFICIAL_EXAMPLES, SCENE_NAMES, CONFORMANCE_IDS } from './catalog';
import { decodePng } from './png';
import { hashPixelBuffer, hashRgba, screenPixels } from './runner';
import { Sha256, sha256Hex } from './sha256';

const bytes = (text: string) => new TextEncoder().encode(text);
const reference = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('Sha256', () => {
  it('matches node:crypto for lengths around the block and padding boundaries', () => {
    for (const length of [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097]) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 7 + length) & 0xff);
      expect(sha256Hex(data), `length ${length}`).toBe(reference(data));
    }
  });

  it('gives the standard digests of "" and "abc"', () => {
    expect(sha256Hex(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is the same for any split of the input', () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
    const hash = new Sha256();
    for (let at = 0; at < data.length; at += 37) hash.update(data.subarray(at, at + 37));
    expect(hash.hex()).toBe(reference(data));
  });

  it('hashes a million bytes like node:crypto', () => {
    const data = new Uint8Array(1_000_000).fill(0x61);
    expect(sha256Hex(data)).toBe(reference(data));
  });
});

describe('surface hashes', () => {
  const buffer = { width: 3, height: 2, data: Uint32Array.from([0xff0000ff, 0xff00ff00, 0xffff0000, 1, 2, 3]) };
  it('hash the size and the bytes, and hashRgba agrees for the same bytes', () => {
    const rgba = new Uint8Array(buffer.data.buffer);
    expect(hashPixelBuffer(buffer)).toBe(reference(Buffer.concat([Buffer.from('3x2:'), rgba])));
    expect(hashRgba(3, 2, rgba)).toBe(hashPixelBuffer(buffer));
    expect(hashRgba(2, 3, rgba)).not.toBe(hashPixelBuffer(buffer));
  });

  it('screenPixels paints the overlay over the shown image and clips it', () => {
    const back = { width: 4, height: 3, data: new Uint32Array(12).fill(0xff000000) };
    const surface = {
      back,
      window: null,
      overlay: { x: 3, y: 2, width: 3, height: 3, pixels: new Uint32Array(9).fill(0xffffffff) },
    };
    const screen = screenPixels(surface as never);
    expect(screen.data[11]).toBe(0xffffffff); // (3, 2), the one pixel of the overlay on the surface
    expect(screen.data.filter((p) => p === 0xffffffff)).toHaveLength(1);
    expect(back.data[11]).toBe(0xff000000); // the surface itself is untouched
  });
});

/** A PNG of the given pixels with the given filter on every row. */
function png(width: number, height: number, channels: 3 | 4, pixels: number[], filter: number): Uint8Array {
  const stride = width * channels;
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(filter);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? (pixels[at - channels] as number) : 0;
      const up = y > 0 ? (pixels[at - stride] as number) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[at - stride - channels] as number) : 0;
      const p = left + up - upLeft;
      const paeth = [left, up, upLeft].reduce((best, v) => (Math.abs(p - v) < Math.abs(p - best) ? v : best));
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter] as number;
      rows.push(((pixels[at] as number) - predictor) & 0xff);
    }
  }
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    new DataView(out.buffer).setUint32(0, body.length);
    out.set(bytes(type), 4);
    out.set(body, 8);
    return out;
  };
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Uint8Array.from(rows))),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

describe('decodePng', () => {
  const pixels = Array.from({ length: 5 * 4 * 4 }, (_, i) => (i * 37 + (i >> 3) * 11) & 0xff);
  for (const filter of [0, 1, 2, 3, 4]) {
    it(`reads RGBA with filter ${filter}`, () => {
      const image = decodePng(png(5, 4, 4, pixels, filter));
      expect([image.width, image.height]).toEqual([5, 4]);
      expect(Array.from(image.rgba)).toEqual(pixels);
    });
  }
  it('reads RGB and gives alpha 255', () => {
    const rgb = Array.from({ length: 3 * 2 * 3 }, (_, i) => i * 9);
    const image = decodePng(png(3, 2, 3, rgb, 4));
    expect(Array.from(image.rgba.filter((_, i) => i % 4 === 3))).toEqual(new Array(6).fill(255));
    expect(Array.from(image.rgba.filter((_, i) => i % 4 === 0))).toEqual(
      [0, 9, 18, 27, 36, 45].map((v, i) => rgb[i * 3]),
    );
  });
  it('refuses what it does not understand', () => {
    expect(() => decodePng(bytes('not a png'))).toThrow('not a PNG');
    const palette = png(2, 2, 3, new Array(12).fill(0), 0);
    palette[8 + 8 + 9] = 3; // colour type 3 (palette)
    expect(() => decodePng(palette)).toThrow('unsupported PNG');
  });
});

describe('the golden file', () => {
  const golden = readGolden(GOLDEN_PATH);
  it('names itself a baseline of the port and not a capture of the original', () => {
    expect(golden.provenance).toMatch(/NOT a capture of the official EASy68K/);
  });
  it('has an entry per example with well-formed hashes', () => {
    const expected = OFFICIAL_EXAMPLES.length + CONFORMANCE_IDS.length + SCENE_NAMES.length;
    expect(Object.keys(golden.examples)).toHaveLength(expected);
    for (const [id, entry] of Object.entries(golden.examples)) {
      for (const key of ['surfaceHash', 'shownHash', 'screenHash', 'programSha256'] as const) {
        expect(entry[key], `${id} ${key}`).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(entry.end, id).not.toBe('waiting for input');
    }
  });
  it('describeDifference names the first member that differs', () => {
    const entry = Object.values(golden.examples)[0] as GoldenEntry;
    expect(describeDifference(entry, { ...entry })).toBeNull();
    expect(describeDifference(entry, { ...entry, instructions: entry.instructions + 1 })).toMatch(
      /^instructions: golden/,
    );
  });
});
