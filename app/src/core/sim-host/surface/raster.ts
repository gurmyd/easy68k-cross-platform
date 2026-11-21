// Clipped pixel, run and block writes into a pixel buffer, each through a Mix (rop.ts). Every
// primitive of the surface ends here, so this is where "coordinates are never an error" is kept
// (ARCHITECTURE.md 3.4 rule 12): whatever lies outside the buffer is silently left out.
//
// Owner: SH1.

import type { PixelBuffer, Rect } from '../../../contracts';
import { mixIsIdentity, type Mix } from './rop';
import type { Dot } from './tables/dots';

/** A black pixel as stored: 0xFF000000 | $00BBGGRR. */
export const BLACK_PIXEL = 0xff000000;

/**
 * Receives the pixels x1..x2 (both included) of row y. The shape modules (ellipse.ts, widepen.ts)
 * describe what they cover as a series of such runs; the receiver clips them.
 */
export type SpanSink = (y: number, x1: number, x2: number) => void;

/** A new buffer of the given size, every pixel black. */
export function createBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint32Array(width * height).fill(BLACK_PIXEL) };
}

/** Combines the pixel (x, y), if the buffer has it. */
export function mixPixel(buffer: PixelBuffer, x: number, y: number, mix: Mix): void {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  const data = buffer.data;
  const i = y * buffer.width + x;
  data[i] = ((data[i] as number) & mix.keep) ^ mix.flip;
}

/** Combines the pixels x1..x2 (both included) of row y, as far as the buffer has them. */
export function mixSpan(buffer: PixelBuffer, y: number, x1: number, x2: number, mix: Mix): void {
  if (y < 0 || y >= buffer.height) return;
  if (x1 < 0) x1 = 0;
  if (x2 >= buffer.width) x2 = buffer.width - 1;
  if (x1 > x2) return;
  const data = buffer.data;
  const start = y * buffer.width + x1;
  const end = start + (x2 - x1) + 1;
  const { keep, flip } = mix;
  if (keep === 0) {
    data.fill(flip, start, end); // the result does not depend on the surface (modes 0, 1, 4, 5)
  } else {
    for (let i = start; i < end; i++) data[i] = ((data[i] as number) & keep) ^ flip;
  }
}

/** Combines the block left..right by top..bottom (all four included), as far as the buffer has it. */
export function mixBlock(
  buffer: PixelBuffer,
  left: number,
  top: number,
  right: number,
  bottom: number,
  mix: Mix,
): void {
  if (mixIsIdentity(mix)) return;
  if (top < 0) top = 0;
  if (bottom >= buffer.height) bottom = buffer.height - 1;
  for (let y = top; y <= bottom; y++) mixSpan(buffer, y, left, right, mix);
}

/**
 * Reports the rows of a wide pen's dot (tables/dots.ts) at the point (x, y), from the top row down,
 * every pixel once.
 */
export function emitDot(dot: Dot, x: number, y: number, emit: SpanSink): void {
  const { reach, left, right } = dot;
  for (let i = 0; i <= 2 * reach; i++) emit(y - reach + i, x + (left[i] as number), x + (right[i] as number));
}

/** Combines a wide pen's dot (tables/dots.ts) at the point (x, y), as far as the buffer has it. */
export function mixDot(buffer: PixelBuffer, x: number, y: number, dot: Dot, mix: Mix): void {
  const { reach, left, right } = dot;
  for (let i = 0; i <= 2 * reach; i++) {
    mixSpan(buffer, y - reach + i, x + (left[i] as number), x + (right[i] as number), mix);
  }
}

/** The part of `rect` (right and bottom exclusive) inside a buffer of the given size, or null. */
export function clipRect(rect: Rect, width: number, height: number): Rect | null {
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, width);
  const bottom = Math.min(rect.bottom, height);
  return left < right && top < bottom ? { left, top, right, bottom } : null;
}

/** Collects the bounding box of the areas added to it. */
export class Region {
  private left = 0;
  private top = 0;
  private right = 0;
  private bottom = 0;

  /** Adds the rectangle left..right by top..bottom (right and bottom exclusive). */
  add(left: number, top: number, right: number, bottom: number): void {
    if (left >= right || top >= bottom) return;
    if (this.right === this.left) {
      this.left = left;
      this.top = top;
      this.right = right;
      this.bottom = bottom;
    } else {
      if (left < this.left) this.left = left;
      if (top < this.top) this.top = top;
      if (right > this.right) this.right = right;
      if (bottom > this.bottom) this.bottom = bottom;
    }
  }

  /** The box collected so far, cut to a buffer of the given size, or null; forgets it. */
  take(width: number, height: number): Rect | null {
    const box = clipRect({ left: this.left, top: this.top, right: this.right, bottom: this.bottom }, width, height);
    this.left = this.top = this.right = this.bottom = 0;
    return box;
  }
}
