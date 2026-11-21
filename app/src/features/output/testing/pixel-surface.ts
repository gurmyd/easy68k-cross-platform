// TEST DOUBLE for the drawing surface (contracts SurfaceApi), used by the Output feature's own
// tests and by its browser check (check-output.mjs). Never imported by the application.
//
// The real surface (core/sim-host/surface, work package SH1) is written at the same time as the
// Output panel. The panel's tests must not depend on it, so they bring this: a plain pixel buffer
// with just enough behaviour to show that the panel presents what a surface holds - pixels,
// filled rectangles, text cells, a resize, double buffering, the dirty region and the prompt
// overlay. Lines, ellipses, flood fill, pen widths and raster operations are NOT here.

import type { Glyph, GraphicsState, OverlayCell, PixelBuffer, Rect, SurfaceApi } from '../../../contracts';

const OPAQUE = 0xff000000;
const BLACK = OPAQUE;

function blackBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint32Array(width * height).fill(BLACK) };
}

function startupState(): GraphicsState {
  return {
    penColor: 0xffffff,
    fillColor: 0x000000,
    penWidth: 1,
    penMode: 4,
    doubleBuffer: false,
    backPen: { x: 0, y: 0 },
    windowPen: { x: 0, y: 0 },
  };
}

export class PixelSurface implements SurfaceApi {
  back: PixelBuffer;
  window: PixelBuffer | null = null;
  state: GraphicsState = startupState();
  overlay: OverlayCell | null = null;
  private dirty: Rect | null = null;

  constructor(width: number, height: number) {
    this.back = blackBuffer(width, height);
    this.touchAll();
  }

  /* ---- colours and pixels */

  setLineColor(color: number): void {
    this.state.penColor = color & 0xffffff;
  }
  setFillColor(color: number): void {
    this.state.fillColor = color & 0xffffff;
  }
  drawPixel(x: number, y: number): void {
    this.fill({ left: x, top: y, right: x + 1, bottom: y + 1 }, this.state.penColor);
  }
  getPixel(x: number, y: number): number {
    const { width, height, data } = this.back;
    if (x < 0 || y < 0 || x >= width || y >= height) return 0xffffffff;
    return (data[y * width + x] as number) & 0xffffff;
  }

  /* ---- shapes: only the filled rectangle draws */

  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    const rect = { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
    this.fill(rect, this.state.fillColor);
  }
  line(_x1: number, _y1: number, x2: number, y2: number): void {
    this.moveTo(x2, y2);
  }
  lineTo(x: number, y: number): void {
    this.moveTo(x, y);
  }
  moveTo(x: number, y: number): void {
    this.state.backPen = { x, y };
    if (!this.state.doubleBuffer) this.state.windowPen = { x, y };
  }
  getXY(): [number, number] {
    return [this.state.windowPen.x, this.state.windowPen.y];
  }
  unfilledRectangle(): void {}
  ellipse(): void {}
  unfilledEllipse(): void {}
  floodFill(): void {}
  setPenWidth(width: number): void {
    this.state.penWidth = width;
  }

  /* ---- double buffering (trap15-b §5.6) */

  setDrawingMode(mode: number): void {
    if (mode === 17) {
      if (this.state.doubleBuffer) return;
      this.state.doubleBuffer = true;
      this.window = { width: this.back.width, height: this.back.height, data: this.back.data.slice() };
    } else if (mode === 16) {
      this.formPaint();
      this.state.doubleBuffer = false;
      this.window = null;
      this.touchAll();
    } else {
      this.state.penMode = mode;
    }
  }
  formPaint(): void {
    this.overlay = null;
    if (this.window) (this.window.data as Uint32Array).set(this.back.data);
    this.touchAll();
  }

  /* ---- block operations of the text screen */

  fillBlack(rect: Rect): void {
    this.fill(rect, 0x000000);
  }
  copyRect(dest: Rect, source: Rect): void {
    const width = Math.min(dest.right - dest.left, source.right - source.left);
    const height = Math.min(dest.bottom - dest.top, source.bottom - source.top);
    const { data, width: stride } = this.back;
    const pixels = data as Uint32Array;
    const rows = Array.from({ length: height }, (_, row) =>
      pixels.slice((source.top + row) * stride + source.left, (source.top + row) * stride + source.left + width),
    );
    rows.forEach((row, index) => pixels.set(row, (dest.top + index) * stride + dest.left));
    this.touch({ left: dest.left, top: dest.top, right: dest.left + width, bottom: dest.top + height });
  }
  textOut(
    x: number,
    y: number,
    glyphs: readonly Glyph[],
    extent: number,
    fontColor: number,
    target: 'both' | 'window',
  ): void {
    const height = glyphs[0]?.height ?? 0;
    const width = Math.max(extent, 0);
    // The opaque cell in the fill colour, then each glyph in the font colour.
    const cell = new Uint32Array(width * height).fill(OPAQUE | this.state.fillColor);
    let left = 0;
    for (const glyph of glyphs) {
      for (let row = 0; row < glyph.height; row++) {
        for (let column = 0; column < glyph.width && left + column < width; column++) {
          if ((glyph.coverage[row * glyph.width + column] as number) >= 128) {
            cell[row * width + left + column] = OPAQUE | (fontColor & 0xffffff);
          }
        }
      }
      left += glyph.advance;
    }
    if (target === 'window') {
      // The prompt: drawn over the image on screen, never into a buffer (3.5.3).
      this.overlay = { x, y, width, height, pixels: cell };
      this.state.windowPen = { x: x + extent, y };
      return;
    }
    this.overlay = null;
    const { data, width: stride, height: rows } = this.back;
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const px = x + column;
        const py = y + row;
        if (px >= 0 && py >= 0 && px < stride && py < rows) {
          (data as Uint32Array)[py * stride + px] = cell[row * width + column] as number;
        }
      }
    }
    this.touch({ left: x, top: y, right: x + width, bottom: y + height });
    this.moveTo(x + extent, y);
  }

  /* ---- size */

  resize(width: number, height: number): void {
    const w = Math.min(Math.max(width, 640), 4096);
    const h = Math.min(Math.max(height, 480), 4096);
    this.back = blackBuffer(w, h);
    this.window = this.state.doubleBuffer ? blackBuffer(w, h) : null;
    this.overlay = null;
    this.state.backPen = { ...this.state.windowPen };
    this.touchAll();
  }
  resetToStartup(): void {
    this.back = blackBuffer(640, 480);
    this.window = null;
    this.state = startupState();
    this.overlay = null;
    this.touchAll();
  }

  /* ---- presentation */

  takeDirty(): Rect | null {
    const dirty = this.dirty;
    this.dirty = null;
    return dirty;
  }

  /** Fills a rectangle of the back buffer with an RGB colour, clipped to the surface. */
  private fill(rect: Rect, color: number): void {
    const { width, height, data } = this.back;
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.right, width);
    const bottom = Math.min(rect.bottom, height);
    if (right <= left || bottom <= top) return;
    for (let y = top; y < bottom; y++)
      (data as Uint32Array).fill(OPAQUE | (color & 0xffffff), y * width + left, y * width + right);
    this.overlay = null;
    this.touch({ left, top, right, bottom });
  }

  /** Records a change of the back buffer. While double buffering is on, the screen does not change. */
  private touch(rect: Rect): void {
    if (this.state.doubleBuffer) return;
    const dirty = this.dirty;
    this.dirty = dirty
      ? {
          left: Math.min(dirty.left, rect.left),
          top: Math.min(dirty.top, rect.top),
          right: Math.max(dirty.right, rect.right),
          bottom: Math.max(dirty.bottom, rect.bottom),
        }
      : rect;
  }

  private touchAll(): void {
    this.dirty = { left: 0, top: 0, right: this.back.width, bottom: this.back.height };
  }
}
