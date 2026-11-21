// Presentation of the drawing surface on the canvas (ARCHITECTURE.md 3.4, last paragraph; 2.5).
//
// The surface is a pixel array that the host parts draw into; the canvas only ever receives
// finished pixels. Once per animation frame the Output panel calls Presenter.frame(), which
//
//   1. makes the canvas's backing store exactly as large as the surface (2.5: device pixel ratio
//      and zoom never change it; CSS scales the canvas);
//   2. copies the region that changed since the last frame (`surface.takeDirty()`) from the image
//      on screen, which is `surface.window` while double buffering is on and `surface.back`
//      otherwise;
//   3. draws the prompt overlay (`surface.overlay`: the blinking `_` of a keyboard read, or the
//      blank that erases it) over that image - on the canvas only, never into a buffer (3.5.3) -
//      and takes an overlay that has moved or gone off the canvas again.
//
// Nothing here touches the DOM: the canvas is behind PresentTarget, so the logic runs under Node.

import type { PixelBuffer, Rect, SurfaceApi } from '../../contracts';

/** The canvas as the presenter needs it. `Image` is the browser's ImageData. */
export interface PresentTarget<Image> {
  /** The size of the backing store. */
  size(): { width: number; height: number };
  /** Sets the size of the backing store. This clears the canvas. */
  resize(width: number, height: number): void;
  /** An image over the SAME memory as `pixels` (one Uint32 per pixel, $FFBBGGRR), not a copy. */
  image(pixels: Uint32Array, width: number, height: number): Image;
  /** Copies the rectangle (sx, sy, width, height) of `image` to (dx + sx, dy + sy) of the canvas. */
  put(image: Image, dx: number, dy: number, sx: number, sy: number, width: number, height: number): void;
}

interface Cached<Image> {
  pixels: Uint32Array;
  width: number;
  height: number;
  image: Image;
}

/** The part of `rect` that lies on a surface of the given size, or null. */
function clip(rect: Rect, width: number, height: number): Rect | null {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const right = Math.min(width, Math.ceil(rect.right));
  const bottom = Math.min(height, Math.ceil(rect.bottom));
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

const sameRect = (a: Rect, b: Rect) =>
  a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

export class Presenter<Image> {
  /** The image that was presented last, with the memory it wraps. */
  private shown: Cached<Image> | null = null;
  private overlayImage: Cached<Image> | null = null;
  /** Where the overlay was drawn in the last frame. */
  private overlayRect: Rect | null = null;
  /** The whole canvas is to be painted in the next frame. */
  private stale = true;

  constructor(private readonly target: PresentTarget<Image>) {}

  /** Paints the whole canvas in the next frame (a new canvas element, a new engine). */
  invalidate(): void {
    this.stale = true;
  }

  /** Brings the canvas up to date with the surface. Call once per animation frame. */
  frame(surface: SurfaceApi): void {
    const buffer: PixelBuffer = surface.window ?? surface.back;
    const { width, height } = buffer;
    const { target } = this;

    const size = target.size();
    if (size.width !== width || size.height !== height) {
      target.resize(width, height);
      this.stale = true;
    }
    // A resize and a change of buffering replace the buffer (3.4 rule 13): wrap the new memory.
    let shown = this.shown;
    if (!shown || shown.pixels !== buffer.data || shown.width !== width || shown.height !== height) {
      shown = { pixels: buffer.data, width, height, image: target.image(buffer.data, width, height) };
      this.shown = shown;
      this.stale = true;
    }

    // Always taken, so that the record is cleared even when the whole canvas is painted anyway.
    const changed = surface.takeDirty();
    const dirty = this.stale
      ? { left: 0, top: 0, right: width, bottom: height }
      : changed && clip(changed, width, height);
    if (this.stale) this.overlayRect = null; // painted over
    this.stale = false;
    if (dirty) this.put(shown.image, dirty);

    const overlay = surface.overlay;
    const rect = overlay && {
      left: overlay.x,
      top: overlay.y,
      right: overlay.x + overlay.width,
      bottom: overlay.y + overlay.height,
    };
    // An overlay that has moved or gone: the image shows through again where it was.
    const previous = this.overlayRect;
    if (previous && !(rect && sameRect(previous, rect))) {
      const visible = clip(previous, width, height);
      if (visible) this.put(shown.image, visible);
    }
    this.overlayRect = rect;
    if (!overlay || overlay.width <= 0 || overlay.height <= 0) return;

    let cell = this.overlayImage;
    if (!cell || cell.pixels !== overlay.pixels || cell.width !== overlay.width || cell.height !== overlay.height) {
      cell = {
        pixels: overlay.pixels,
        width: overlay.width,
        height: overlay.height,
        image: target.image(overlay.pixels, overlay.width, overlay.height),
      };
      this.overlayImage = cell;
    }
    // Drawn every frame: the cell's pixels change in place when the prompt blinks.
    target.put(cell.image, overlay.x, overlay.y, 0, 0, overlay.width, overlay.height);
  }

  private put(image: Image, rect: Rect): void {
    this.target.put(image, 0, 0, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  }
}

/** The ImageData-like object the canvas target makes: `data` shares the surface's memory. */
export function rgbaView(pixels: Uint32Array): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength);
}
