// The drawing surface (ARCHITECTURE.md 3.4): a pixel array rasterised by the port's own code.
//
// STUB written by W1 (wave 0). SH1 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub keeps two black 640x480-or-larger
// buffers and the default graphics state, draws nothing and returns the engine's defaults.
//
// Owner: W1 > SH1.

import type { GraphicsState, Glyph, OverlayCell, PixelBuffer, Rect, SurfaceApi } from '../../../contracts';

export type { GraphicsState, OverlayCell, PixelBuffer, Rect } from '../../../contracts';

/** Largest surface side the port allows (the original has no limit below 65535). */
export const MAX_SURFACE = 4096;

const BLACK = 0xff000000;

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

export class Surface implements SurfaceApi {
  back: PixelBuffer;
  window: PixelBuffer | null = null;
  state: GraphicsState = startupState();
  overlay: OverlayCell | null = null;

  constructor(width: number, height: number) {
    this.back = blackBuffer(width, height);
  }

  setLineColor(_color: number): void {}
  setFillColor(_color: number): void {}
  drawPixel(_x: number, _y: number): void {}
  getPixel(_x: number, _y: number): number {
    return 0; // engine default
  }
  line(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  lineTo(_x: number, _y: number): void {}
  moveTo(_x: number, _y: number): void {}
  getXY(): [number, number] {
    return [this.state.windowPen.x, this.state.windowPen.y];
  }
  rectangle(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  unfilledRectangle(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  ellipse(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  unfilledEllipse(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  floodFill(_x: number, _y: number): void {}
  setDrawingMode(_mode: number): void {}
  setPenWidth(_width: number): void {}
  formPaint(): void {}

  fillBlack(_rect: Rect): void {}
  copyRect(_dest: Rect, _source: Rect): void {}
  textOut(
    _x: number,
    _y: number,
    _glyphs: readonly Glyph[],
    _extent: number,
    _fontColor: number,
    _target: 'both' | 'window',
  ): void {}
  resize(_width: number, _height: number): void {}
  resetToStartup(): void {
    this.back = blackBuffer(640, 480);
    this.window = null;
    this.state = startupState();
    this.overlay = null;
  }

  takeDirty(): Rect | null {
    return null;
  }
}
