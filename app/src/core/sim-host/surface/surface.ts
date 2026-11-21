// The drawing surface (ARCHITECTURE.md 3.4): the pixels of the simulator's output window, rasterised
// by the port's own code so that a program reads back (task 83) and flood-fills exactly the pixels
// it would on Windows. No canvas drawing call is involved; the Output panel only copies finished
// pixels to the screen.
//
// The original has two canvases of equal size, and so does this class:
//
//   back     the back buffer. Every drawing call changes it, and every read comes from it.
//   window   what is on screen while double buffering is on (task 92 mode 17): a copy of the back
//            buffer taken at the moments the original repaints its window. While double buffering
//            is off it is null and the screen shows `back`.
//
// The graphics state (colours, pen width, pen mode, the two pen positions) is a plain object,
// `state`. The files next to this one hold the rules, one topic each, with the reasoning:
//
//   colors.ts    what a 32-bit colour value means               (trap15-b §4.6)
//   rop.ts       the drawing modes 0-255 as raster operations   (§5.4)
//   line.ts      lines of a one-pixel pen                       (§6.1)
//   rect.ts      rectangles, every pen width                    (§6.3)
//   flood.ts     flood fill                                     (§6.6)
//   text.ts      the opaque cell and the glyphs of TextOut      (§5.2, §6.7)
//   widepen.ts   lines of wider pens      - stub, SH2 replaces  (§6.2)
//   ellipse.ts   ellipses                 - stub, SH2 replaces  (§6.4)
//   tables/      the round dots of wide pens                    (§6.2)
//
// What this file adds is the bookkeeping of trap15-b §5.5 and §5.6, which is easy to get wrong:
//
//   - Two pen positions. Lines start at `state.backPen`. Task 96 reads `state.windowPen`, which
//     lines and text move only while double buffering is off; the prompt moves it alone.
//   - Double buffering. Mode 17 freezes the picture on screen; mode 16, task 94 and `resize` bring
//     it up to date.
//   - The overlay: the input prompt, which the original paints on its window only. It is kept as a
//     separate small cell for the Output panel to lay over the picture, never drawn into `back`.
//   - `takeDirty()`: which part of the picture on screen changed since the panel last asked.
//
// Coordinates are whole numbers of any size and never an error: everything is clipped.
//
// Owner: W1 > SH1.

import type { GraphicsState, Glyph, OverlayCell, PixelBuffer, Rect, SurfaceApi } from '../../../contracts';
import { resolveColor } from './colors';
import { rasterEllipse } from './ellipse';
import { floodFill } from './flood';
import { drawLine } from './line';
import { BLACK_PIXEL, clipRect, createBuffer, mixPixel, mixSpan, Region, type SpanSink } from './raster';
import { drawRectangle } from './rect';
import { createMix, setMix, type Mix } from './rop';
import { paintText, textBounds } from './text';
import { strokeWideLine } from './widepen';

export type { GraphicsState, OverlayCell, PixelBuffer, Rect } from '../../../contracts';

/** Largest surface side the port allows (the original has no limit below 65535). */
export const MAX_SURFACE = 4096;

/** Smallest surface `resize` produces, and the size at start (trap15-b §4.3). */
export const MIN_SURFACE_WIDTH = 640;
export const MIN_SURFACE_HEIGHT = 480;

const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

export class Surface implements SurfaceApi {
  /** The graphics state. Its two pen objects stay the same objects for the life of the surface. */
  readonly state: GraphicsState = {
    penColor: 0xffffff,
    fillColor: 0x000000,
    penWidth: 1,
    penMode: 4,
    doubleBuffer: false,
    backPen: { x: 0, y: 0 },
    windowPen: { x: 0, y: 0 },
  };

  private backBuffer: PixelBuffer;
  /** Not null exactly while `state.doubleBuffer` is true. */
  private windowBuffer: PixelBuffer | null = null;
  /** A window buffer of the current size from an earlier mode 17, kept to be used again. */
  private spareBuffer: PixelBuffer | null = null;
  private overlayCell: OverlayCell | null = null;

  /** Part of the picture on screen that changed since the last takeDirty(). */
  private readonly dirty = new Region();
  /** While double buffering: part of `back` drawn since `window` last equalled it. */
  private readonly pending = new Region();

  /** Reused by every drawing call: the pen colour and the fill colour through the drawing mode. */
  private readonly penMix: Mix = createMix();
  private readonly fillMix: Mix = createMix();

  /**
   * A black surface with the start-up state. The size is taken as given, from 1 x 1 up to
   * MAX_SURFACE in each direction; only `resize` applies the original's minimum of 640 x 480.
   */
  constructor(width: number, height: number) {
    this.backBuffer = createBuffer(clamp(width | 0, 1, MAX_SURFACE), clamp(height | 0, 1, MAX_SURFACE));
    this.dirty.add(0, 0, this.backBuffer.width, this.backBuffer.height);
  }

  /** The back buffer: always drawn, always read. A new object after a change of size. */
  get back(): PixelBuffer {
    return this.backBuffer;
  }

  /** The image on screen while double buffering is on; null while it is off (the screen shows `back`). */
  get window(): PixelBuffer | null {
    return this.windowBuffer;
  }

  /** The prompt cell to be shown over the picture, or null. */
  get overlay(): OverlayCell | null {
    return this.overlayCell;
  }

  /* ---------------------------------------------------------------- state (tasks 80, 81, 92, 93) */

  /** Task 80. */
  setLineColor(color: number): void {
    this.state.penColor = resolveColor(color);
  }

  /** Task 81. Also the background of all text drawn afterwards. */
  setFillColor(color: number): void {
    this.state.fillColor = resolveColor(color);
  }

  /** Task 93: the low byte is the pen width; 0 draws like 1. */
  setPenWidth(width: number): void {
    this.state.penWidth = width & 0xff;
  }

  /**
   * Task 92: the low byte. 16 and 17 switch double buffering off and on and leave the pen mode
   * alone; every other value is the pen mode (rop.ts says what 18-255 draw).
   */
  setDrawingMode(mode: number): void {
    const state = this.state;
    const value = mode & 0xff;
    if (value === 16) {
      // Off: the window canvas takes the back buffer's pen position, and the window is repainted.
      this.present();
      this.spareBuffer = this.windowBuffer ?? this.spareBuffer;
      this.windowBuffer = null;
      state.doubleBuffer = false;
      state.windowPen.x = state.backPen.x;
      state.windowPen.y = state.backPen.y;
    } else if (value === 17) {
      // On: nothing is repainted, so the screen keeps the picture it has. Asking twice changes nothing.
      if (!this.windowBuffer) {
        const back = this.backBuffer;
        const spare = this.spareBuffer;
        this.spareBuffer = null;
        if (spare && spare.width === back.width && spare.height === back.height) {
          spare.data.set(back.data);
          this.windowBuffer = spare;
        } else {
          this.windowBuffer = { width: back.width, height: back.height, data: new Uint32Array(back.data) };
        }
        state.doubleBuffer = true;
      }
    } else {
      state.penMode = value;
    }
  }

  /* ---------------------------------------------------------------- pixels (tasks 82, 83) */

  /** Task 82: one pixel in the pen colour, through the drawing mode. The pen width plays no part. */
  drawPixel(x: number, y: number): void {
    x |= 0;
    y |= 0;
    this.beforeDrawing();
    mixPixel(this.backBuffer, x, y, this.pen());
    this.changed(x, y, x + 1, y + 1);
  }

  /** Task 83: the back buffer's pixel as $00BBGGRR, or $FFFFFFFF outside the surface. */
  getPixel(x: number, y: number): number {
    x |= 0;
    y |= 0;
    const back = this.backBuffer;
    if (x < 0 || y < 0 || x >= back.width || y >= back.height) return 0xffffffff;
    return (back.data[y * back.width + x] as number) & 0x00ffffff;
  }

  /* ---------------------------------------------------------------- lines (tasks 84, 85, 86, 96) */

  /** Task 84: MoveTo (x1, y1), then LineTo (x2, y2). */
  line(x1: number, y1: number, x2: number, y2: number): void {
    // The window canvas is moved only if it is drawn on. Its position then ends at (x2, y2), which
    // lineTo sets, so only the back buffer's position needs the move.
    this.state.backPen.x = x1 | 0;
    this.state.backPen.y = y1 | 0;
    this.lineTo(x2, y2);
  }

  /**
   * Task 85: a line from the back buffer's pen position to (x, y), both ends included, then the pen
   * is at (x, y).
   */
  lineTo(x: number, y: number): void {
    x |= 0;
    y |= 0;
    const state = this.state;
    const back = this.backBuffer;
    const fromX = state.backPen.x;
    const fromY = state.backPen.y;
    const width = Math.max(state.penWidth, 1);
    const pen = this.pen();
    this.beforeDrawing();
    if (width === 1) {
      drawLine(back, fromX, fromY, x, y, pen); // GDI's LineTo: without the end point
    } else {
      const clip = { left: 0, top: 0, right: back.width, bottom: back.height };
      strokeWideLine(fromX, fromY, x, y, width, clip, (row, x1, x2) => mixSpan(back, row, x1, x2, pen));
    }
    // "plot to fix builder bug": the original sets the end point itself, as a pixel through the
    // drawing mode. After a wide stroke this is its second visit, the one-pixel hole of XOR modes.
    mixPixel(back, x, y, pen);
    this.changed(
      Math.min(fromX, x) - width,
      Math.min(fromY, y) - width,
      Math.max(fromX, x) + width + 1,
      Math.max(fromY, y) + width + 1,
    );

    state.backPen.x = x;
    state.backPen.y = y;
    if (!state.doubleBuffer) {
      state.windowPen.x = x;
      state.windowPen.y = y;
    }
  }

  /** Task 86: both pen positions, also while double buffering. */
  moveTo(x: number, y: number): void {
    const state = this.state;
    state.backPen.x = state.windowPen.x = x | 0;
    state.backPen.y = state.windowPen.y = y | 0;
  }

  /** Task 96: the pen position of the WINDOW canvas, which lags behind while double buffering. */
  getXY(): [number, number] {
    return [this.state.windowPen.x, this.state.windowPen.y];
  }

  /* ---------------------------------------------------------------- shapes (tasks 87-91) */

  /** Task 87: outline in the pen colour, interior in the fill colour. */
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    this.drawBox(x1 | 0, y1 | 0, x2 | 0, y2 | 0, true);
  }

  /** Task 90: the outline only. */
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void {
    this.drawBox(x1 | 0, y1 | 0, x2 | 0, y2 | 0, false);
  }

  /** Task 88: outline in the pen colour, interior in the fill colour. */
  ellipse(x1: number, y1: number, x2: number, y2: number): void {
    this.drawEllipse(x1 | 0, y1 | 0, x2 | 0, y2 | 0, true);
  }

  /** Task 91: the outline only. */
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void {
    this.drawEllipse(x1 | 0, y1 | 0, x2 | 0, y2 | 0, false);
  }

  /** Task 89: fills from (x, y) with the fill colour through the drawing mode. */
  floodFill(x: number, y: number): void {
    this.beforeDrawing();
    const box = floodFill(this.backBuffer, x | 0, y | 0, this.fill());
    if (box) this.changed(box.left, box.top, box.right, box.bottom);
  }

  /* ---------------------------------------------------------------- presentation */

  /**
   * Task 94, and the original's window repaint: the window shows the back buffer again. While
   * double buffering is off the screen shows the back buffer anyway; the prompt cell goes in both
   * cases.
   */
  formPaint(): void {
    this.present();
  }

  /** Region of the on-screen image changed since the last call, or null. Clears the record. */
  takeDirty(): Rect | null {
    return this.dirty.take(this.backBuffer.width, this.backBuffer.height);
  }

  /* ---------------------------------------------------------------- block operations of the text screen */

  /** Fills the rectangle with black, whatever the fill colour and the drawing mode are. */
  fillBlack(rect: Rect): void {
    this.beforeDrawing();
    const back = this.backBuffer;
    const box = clipRect(rect, back.width, back.height);
    if (!box) return;
    for (let y = box.top; y < box.bottom; y++) {
      back.data.fill(BLACK_PIXEL, y * back.width + box.left, y * back.width + box.right);
    }
    this.changed(box.left, box.top, box.right, box.bottom);
  }

  /**
   * Copies the pixels of `source` to `dest`, as GDI's BitBlt does within one bitmap: the result is
   * what it would be if the source were read completely first, however the two overlap. The two
   * rectangles are meant to have one size (the smaller one counts if they do not). A pixel whose
   * source or destination lies outside the surface is left as it is, which is what GDI does
   * (measured: a task 25 rectangle may reach far past the surface).
   */
  copyRect(dest: Rect, source: Rect): void {
    this.beforeDrawing();
    const { width, height, data } = this.backBuffer;
    const columns = Math.min(dest.right - dest.left, source.right - source.left);
    const rows = Math.min(dest.bottom - dest.top, source.bottom - source.top);
    // The columns and rows of the block, counted from its corner, that exist at both places.
    const columnFrom = Math.max(0, -dest.left, -source.left);
    const columnTo = Math.min(columns, width - dest.left, width - source.left);
    const rowFrom = Math.max(0, -dest.top, -source.top);
    const rowTo = Math.min(rows, height - dest.top, height - source.top);
    if (columnFrom >= columnTo || rowFrom >= rowTo) return;
    const count = columnTo - columnFrom;
    // Moving down, the lowest row goes first, so that no row is overwritten before it is read.
    const bottomUp = dest.top > source.top;
    for (let n = rowFrom; n < rowTo; n++) {
      const row = bottomUp ? rowTo - 1 - (n - rowFrom) : n;
      const from = (source.top + row) * width + source.left + columnFrom;
      data.copyWithin((dest.top + row) * width + dest.left + columnFrom, from, from + count);
    }
    this.changed(dest.left + columnFrom, dest.top + rowFrom, dest.left + columnTo, dest.top + rowTo);
  }

  /**
   * TextOut at (x, y): an opaque cell in the fill colour as wide as the glyphs' advances together,
   * the glyphs in `fontColor`, then the pen moves to (x + extent, y). `extent` is the text extent,
   * which can exceed what is painted (task 95 counts control bytes that paint nothing). No glyphs:
   * nothing is painted and the pen still moves.
   *
   * target 'both': into the back buffer; the window canvas's pen follows unless double buffering.
   * target 'window': into the overlay only, replacing the cell that was there; the window canvas's
   * pen moves, the back buffer and its pen do not. This is how the prompt is drawn, also while
   * double buffering (the caller decides when that is right).
   */
  textOut(
    x: number,
    y: number,
    glyphs: readonly Glyph[],
    extent: number,
    fontColor: number,
    target: 'both' | 'window',
  ): void {
    x |= 0;
    y |= 0;
    const state = this.state;
    const color = resolveColor(fontColor);
    const box = textBounds(x, y, glyphs);
    if (target === 'window') {
      this.setOverlay(box, x, y, glyphs, color);
    } else {
      this.beforeDrawing();
      paintText(this.backBuffer, 0, 0, x, y, glyphs, state.fillColor, color);
      this.changed(box.left, box.top, box.right, box.bottom);
      state.backPen.x = x + extent;
      state.backPen.y = y;
    }
    if (target === 'window' || !state.doubleBuffer) {
      state.windowPen.x = x + extent;
      state.windowPen.y = y;
    }
  }

  /* ---------------------------------------------------------------- size and reset */

  /**
   * setWindowSize of the original (trap15-b §4.3). (0, 0) keeps the current size. Each side is at
   * least 640 / 480 and at most MAX_SURFACE. Both buffers are black afterwards EVERY time, also when
   * the size did not change and also while double buffering. Colours, pen width, pen mode and the
   * double-buffer switch stay; the back buffer's pen position becomes the window's.
   */
  resize(width: number, height: number): void {
    // The original's parameters are unsigned 16-bit numbers.
    let columns = width & 0xffff;
    let rows = height & 0xffff;
    if (columns === 0 && rows === 0) {
      columns = this.backBuffer.width;
      rows = this.backBuffer.height;
    }
    this.blacken(clamp(columns, MIN_SURFACE_WIDTH, MAX_SURFACE), clamp(rows, MIN_SURFACE_HEIGHT, MAX_SURFACE));
    this.state.backPen.x = this.state.windowPen.x;
    this.state.backPen.y = this.state.windowPen.y;
  }

  /**
   * The state of the original right after program start (ARCHITECTURE.md 3.3.2): 640 x 480, both
   * buffers black, double buffering off, both pen positions (0,0), pen white, fill black, pen width
   * 1, mode 4. Only the cold start calls this; a simulator reset does NOT (it keeps the size and the
   * pen positions and sets the rest through the tasks' own methods).
   */
  resetToStartup(): void {
    const state = this.state;
    state.doubleBuffer = false;
    this.windowBuffer = null;
    this.spareBuffer = null;
    this.blacken(MIN_SURFACE_WIDTH, MIN_SURFACE_HEIGHT);
    state.penColor = 0xffffff;
    state.fillColor = 0x000000;
    state.penWidth = 1;
    state.penMode = 4;
    state.backPen.x = state.backPen.y = 0;
    state.windowPen.x = state.windowPen.y = 0;
  }

  /* ---------------------------------------------------------------- private */

  /** The pen colour through the drawing mode, as of now. */
  private pen(): Mix {
    return setMix(this.penMix, this.state.penMode, this.state.penColor);
  }

  /** The fill colour through the drawing mode, as of now. */
  private fill(): Mix {
    return setMix(this.fillMix, this.state.penMode, this.state.fillColor);
  }

  /**
   * Every call that draws begins here. While double buffering is off the original draws on its
   * window too, and the port shows the back buffer instead, without the prompt cell (3.5.3).
   */
  private beforeDrawing(): void {
    if (!this.windowBuffer) this.dropOverlay();
  }

  /** Records that the back buffer changed inside the box (right and bottom exclusive). */
  private changed(left: number, top: number, right: number, bottom: number): void {
    (this.windowBuffer ? this.pending : this.dirty).add(left, top, right, bottom);
  }

  /** The window shows the back buffer: brings `window` up to date and removes the prompt cell. */
  private present(): void {
    const window = this.windowBuffer;
    if (window) {
      const back = this.backBuffer;
      const box = this.pending.take(back.width, back.height);
      if (box) {
        for (let y = box.top; y < box.bottom; y++) {
          const from = y * back.width + box.left;
          window.data.set(back.data.subarray(from, from + box.right - box.left), from);
        }
        this.dirty.add(box.left, box.top, box.right, box.bottom);
      }
    }
    this.dropOverlay();
  }

  private dropOverlay(): void {
    const cell = this.overlayCell;
    if (!cell) return;
    this.dirty.add(cell.x, cell.y, cell.x + cell.width, cell.y + cell.height);
    this.overlayCell = null;
  }

  /** Makes the overlay the text cell `box`, painted over a copy of what the screen shows there. */
  private setOverlay(box: Rect, x: number, y: number, glyphs: readonly Glyph[], color: number): void {
    this.dropOverlay();
    const screen = this.windowBuffer ?? this.backBuffer;
    const visible = clipRect(box, screen.width, screen.height);
    if (!visible) return;
    const width = visible.right - visible.left;
    const height = visible.bottom - visible.top;
    const pixels = new Uint32Array(width * height);
    for (let row = 0; row < height; row++) {
      const from = (visible.top + row) * screen.width + visible.left;
      pixels.set(screen.data.subarray(from, from + width), row * width);
    }
    paintText({ width, height, data: pixels }, visible.left, visible.top, x, y, glyphs, this.state.fillColor, color);
    this.overlayCell = { x: visible.left, y: visible.top, width, height, pixels };
    this.dirty.add(visible.left, visible.top, visible.right, visible.bottom);
  }

  /** Both buffers black at the given size; the whole picture counts as changed. */
  private blacken(width: number, height: number): void {
    const back = this.backBuffer;
    if (back.width === width && back.height === height) {
      back.data.fill(BLACK_PIXEL);
      this.windowBuffer?.data.fill(BLACK_PIXEL);
    } else {
      // Users hold `back` and `window` by reference: a new size means new objects (3.4 rule 13).
      this.backBuffer = createBuffer(width, height);
      if (this.windowBuffer) this.windowBuffer = createBuffer(width, height);
      this.spareBuffer = null;
    }
    this.overlayCell = null;
    this.pending.take(width, height);
    this.dirty.take(width, height);
    this.dirty.add(0, 0, width, height);
  }

  private drawBox(x1: number, y1: number, x2: number, y2: number, filled: boolean): void {
    const width = Math.max(this.state.penWidth, 1);
    this.beforeDrawing();
    drawRectangle(this.backBuffer, x1, y1, x2, y2, width, this.pen(), filled ? this.fill() : null);
    this.changed(
      Math.min(x1, x2) - width,
      Math.min(y1, y2) - width,
      Math.max(x1, x2) + width + 1,
      Math.max(y1, y2) + width + 1,
    );
  }

  private drawEllipse(x1: number, y1: number, x2: number, y2: number, filled: boolean): void {
    if (x1 > x2) [x1, x2] = [x2, x1];
    if (y1 > y2) [y1, y2] = [y2, y1];
    // "on Windows 95 X1 + X2 + Y1 + Y2 cannot exceed 32768": the original still refuses such a box.
    if (x1 + y1 + x2 + y2 >= 32768) return;
    const back = this.backBuffer;
    const width = Math.max(this.state.penWidth, 1);
    const pen = this.pen();
    const fill = this.fill();
    const outline: SpanSink = (row, from, to) => mixSpan(back, row, from, to, pen);
    const interior: SpanSink | null = filled ? (row, from, to) => mixSpan(back, row, from, to, fill) : null;
    this.beforeDrawing();
    rasterEllipse(
      x1,
      y1,
      x2,
      y2,
      width,
      { left: 0, top: 0, right: back.width, bottom: back.height },
      outline,
      interior,
    );
    this.changed(x1 - width, y1 - width, x2 + width + 1, y2 + width + 1);
  }
}
