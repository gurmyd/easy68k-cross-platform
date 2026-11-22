// A small PNG decoder for the screenshots of the browser check (ARCHITECTURE.md 6.5.4). Owner: X3.
//
// The check must compare the pixels of a screenshot with the pixels of the surface, byte for byte, and
// the repository has no image library (and may not take one: root dependencies are frozen). A
// screenshot of Playwright is a PNG of 8-bit RGB or RGBA, no interlacing, which is what this reads.
// Anything else is an error: a decoder that guesses would hide exactly the difference being looked for.

import { inflateSync } from 'node:zlib';

export interface DecodedImage {
  width: number;
  height: number;
  /** R, G, B, A of every pixel in row order. Alpha is 255 where the file has no alpha channel. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(file: Uint8Array): DecodedImage {
  if (SIGNATURE.some((byte, i) => file[i] !== byte)) throw new Error('not a PNG file');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let width = 0;
  let height = 0;
  let channels = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= file.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      const depth = body[8];
      const colourType = body[9];
      const interlace = body[12];
      width = new DataView(body.buffer, body.byteOffset).getUint32(0);
      height = new DataView(body.buffer, body.byteOffset).getUint32(4);
      if (depth !== 8 || (colourType !== 2 && colourType !== 6) || interlace !== 0) {
        throw new Error(
          `unsupported PNG: bit depth ${depth}, colour type ${colourType}, interlace ${interlace} (need 8-bit RGB or RGBA, not interlaced)`,
        );
      }
      channels = colourType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (width === 0 || height === 0) throw new Error('PNG without a header');
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height)
    throw new Error(`PNG data has ${raw.length} bytes, expected ${(stride + 1) * height}`);
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? (pixels[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] as number) : 0;
      const upLeft = y > 0 && x >= channels ? (pixels[(y - 1) * stride + x - channels] as number) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`PNG row ${y} has the unknown filter ${filter}`);
      pixels[y * stride + x] = ((line[x] as number) + predictor) & 0xff;
    }
  }
  if (channels === 4) return { width, height, rgba: pixels };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * 3] as number;
    rgba[i * 4 + 1] = pixels[i * 3 + 1] as number;
    rgba[i * 4 + 2] = pixels[i * 3 + 2] as number;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
