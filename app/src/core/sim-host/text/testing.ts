// Test doubles for the text screen and the output device: a small drawing surface, a scheduler
// whose time moves only when a test says so, and a function that wires them to a real TextScreen
// and OutputDevice with the synthetic fonts.
//
// The real drawing surface (core/sim-host/surface, SH1) and the real clocks (core/run, SH8) are
// other packages' work; the tests of this package must not depend on them. `TestSurface` follows
// the `SurfaceApi` contract and the rules of trap15-b that the text screen relies on (§5.5 pen
// positions, §5.6 double buffering, §6.7 text). Of the graphics primitives it draws only pixels,
// width-1 lines and rectangles, plainly; it is not a model of GDI.
//
// Never imported by the application.
//
// Owner: SH3.

import type {
  Bytes,
  Glyph,
  GlyphProvider,
  GraphicsState,
  OverlayCell,
  PixelBuffer,
  Rect,
  Scheduler,
  SurfaceApi,
} from '../../../contracts';
import { fontSetFromFiles } from '../fonts/atlas-provider';
import type { FontSet } from '../fonts/font-set';
import { createSyntheticFontFiles } from '../fonts/synthetic';
import { OutputDevice } from '../io';
import { resolveColor } from '../surface/colors';
import { MAX_SURFACE } from '../surface/surface';
import { TextScreen } from './text-screen';

// ---- pixels --------------------------------------------------------------------------------------

/** A colour $00BBGGRR as a pixel of a `PixelBuffer`. */
export const pixelOf = (color: number) => (0xff000000 | (color & 0xffffff)) >>> 0;
const BLACK = pixelOf(0);

/** `coverage` / 255 of the way from `under` to `over`, per channel. Both are $00BBGGRR. */
export function blend(under: number, over: number, coverage: number): number {
  if (coverage === 0) return under & 0xffffff;
  if (coverage === 255) return over & 0xffffff;
  let result = 0;
  for (let shift = 0; shift < 24; shift += 8) {
    const a = (under >> shift) & 0xff;
    const b = (over >> shift) & 0xff;
    result |= Math.floor((a * (255 - coverage) + b * coverage + 127) / 255) << shift;
  }
  return result;
}

/** FNV-1a hash of pixels, as eight hex digits. Whole-number arithmetic: the same in every JavaScript engine. */
export function hashPixels(pixels: Uint32Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i] as number;
    for (let shift = 0; shift < 32; shift += 8) {
      hash ^= (pixel >>> shift) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

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

// ---- the surface ---------------------------------------------------------------------------------

export class TestSurface implements SurfaceApi {
  back: PixelBuffer;
  window: PixelBuffer | null = null;
  state: GraphicsState = startupState();
  overlay: OverlayCell | null = null;
  private changed = false;

  constructor(width = 640, height = 480) {
    this.back = blackBuffer(width, height);
  }

  // -- reading, for tests --

  /** The colour ($00BBGGRR) of a back-buffer pixel. */
  pixel(x: number, y: number): number {
    return (this.back.data[y * this.back.width + x] as number) & 0xffffff;
  }

  /** The colour of a pixel as the user sees it: the window (or the back buffer while double buffering is off) under the overlay. */
  visible(x: number, y: number): number {
    const cell = this.overlay;
    if (cell && x >= cell.x && x < cell.x + cell.width && y >= cell.y && y < cell.y + cell.height) {
      return (cell.pixels[(y - cell.y) * cell.width + (x - cell.x)] as number) & 0xffffff;
    }
    const shown = this.window ?? this.back;
    return (shown.data[y * shown.width + x] as number) & 0xffffff;
  }

  /** True when every pixel of the rectangle has the colour. */
  isFilled(rect: Rect, color: number): boolean {
    for (let y = rect.top; y < rect.bottom; y++) {
      for (let x = rect.left; x < rect.right; x++) if (this.pixel(x, y) !== color) return false;
    }
    return true;
  }

  // -- state --

  setLineColor(color: number): void {
    this.state.penColor = resolveColor(color);
  }
  setFillColor(color: number): void {
    this.state.fillColor = resolveColor(color);
  }
  setPenWidth(width: number): void {
    this.state.penWidth = width & 0xff;
  }
  setDrawingMode(mode: number): void {
    mode &= 0xff;
    if (mode === 17) {
      // Double buffering on: the screen keeps showing what it shows now.
      if (!this.state.doubleBuffer) this.window = { ...this.back, data: this.back.data.slice() };
      this.state.doubleBuffer = true;
    } else if (mode === 16) {
      this.state.doubleBuffer = false;
      this.state.windowPen = { ...this.state.backPen };
      this.window = null;
      this.presented();
    } else {
      this.state.penMode = mode;
    }
  }

  // -- graphics, plainly --

  private put(x: number, y: number, color: number): void {
    if (x >= 0 && x < this.back.width && y >= 0 && y < this.back.height) {
      this.back.data[y * this.back.width + x] = pixelOf(color);
    }
  }

  /** Something was drawn. While double buffering is off the window shows it at once, which also
   *  removes the prompt cell (3.5.3). */
  private drawn(): void {
    this.changed = true;
    if (!this.state.doubleBuffer) this.overlay = null;
  }

  /** The window was repainted from the back buffer. */
  private presented(): void {
    this.changed = true;
    this.overlay = null;
  }

  drawPixel(x: number, y: number): void {
    this.put(x, y, this.state.penColor);
    this.drawn();
  }
  getPixel(x: number, y: number): number {
    if (x < 0 || x >= this.back.width || y < 0 || y >= this.back.height) return 0xffffffff;
    return this.pixel(x, y);
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps;
      this.put(Math.round(x1 + (x2 - x1) * t), Math.round(y1 + (y2 - y1) * t), this.state.penColor);
    }
    this.state.backPen = { x: x2, y: y2 };
    if (!this.state.doubleBuffer) this.state.windowPen = { x: x2, y: y2 };
    this.drawn();
  }
  lineTo(x: number, y: number): void {
    this.line(this.state.backPen.x, this.state.backPen.y, x, y);
  }
  moveTo(x: number, y: number): void {
    this.state.backPen = { x, y };
    this.state.windowPen = { x, y };
  }
  getXY(): [number, number] {
    return [this.state.windowPen.x, this.state.windowPen.y];
  }
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    for (let y = Math.min(y1, y2); y < Math.max(y1, y2); y++) {
      for (let x = Math.min(x1, x2); x < Math.max(x1, x2); x++) this.put(x, y, this.state.fillColor);
    }
    this.unfilledRectangle(x1, y1, x2, y2);
  }
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void {
    const [left, right] = [Math.min(x1, x2), Math.max(x1, x2) - 1];
    const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2) - 1];
    for (let x = left; x <= right; x++) {
      this.put(x, top, this.state.penColor);
      this.put(x, bottom, this.state.penColor);
    }
    for (let y = top; y <= bottom; y++) {
      this.put(left, y, this.state.penColor);
      this.put(right, y, this.state.penColor);
    }
    this.drawn();
  }
  // Not drawn by this double; the text screen never asks for them.
  ellipse(): void {}
  unfilledEllipse(): void {}
  floodFill(): void {}

  formPaint(): void {
    if (this.window) this.window.data.set(this.back.data);
    this.presented();
  }

  // -- block operations used by the text screen --

  fillBlack(rect: Rect): void {
    const left = Math.max(0, rect.left);
    const right = Math.min(this.back.width, rect.right);
    for (let y = Math.max(0, rect.top); y < Math.min(this.back.height, rect.bottom); y++) {
      if (right > left) this.back.data.fill(BLACK, y * this.back.width + left, y * this.back.width + right);
    }
    this.drawn();
  }

  copyRect(dest: Rect, source: Rect): void {
    const { width, height, data } = this.back;
    const before = data.slice(); // an overlapping copy reads the pixels as they were
    for (let dy = 0; dy < dest.bottom - dest.top; dy++) {
      for (let dx = 0; dx < dest.right - dest.left; dx++) {
        const [sx, sy] = [source.left + dx, source.top + dy];
        const [x, y] = [dest.left + dx, dest.top + dy];
        if (sx < 0 || sx >= width || sy < 0 || sy >= height || x < 0 || x >= width || y < 0 || y >= height) continue;
        data[y * width + x] = before[sy * width + sx] as number;
      }
    }
    this.drawn();
  }

  textOut(
    x: number,
    y: number,
    glyphs: readonly Glyph[],
    extent: number,
    fontColor: number,
    target: 'both' | 'window',
  ): void {
    // A text colour takes the path of pen and fill colours (trap15-b §4.6), as on the real surface.
    fontColor = resolveColor(fontColor);
    if (target === 'window') {
      // The prompt cell: the same picture, but over the presented image instead of in the back buffer.
      const width = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0);
      const height = glyphs[0]?.height ?? 0;
      const pixels = new Uint32Array(width * height).fill(pixelOf(this.state.fillColor));
      paintGlyphs(glyphs, fontColor, (gx, gy, color) => {
        if (gx >= 0 && gx < width && gy < height)
          pixels[gy * width + gx] = pixelOf(color(pixels[gy * width + gx] as number));
      });
      this.overlay = { x, y, width, height, pixels };
      this.state.windowPen = { x: x + extent, y };
      this.changed = true;
      return;
    }
    // Opaque cells in the fill colour first, then the glyphs; a glyph may reach beyond its cell.
    let cellX = x;
    for (const glyph of glyphs) {
      for (let gy = 0; gy < glyph.height; gy++) {
        for (let gx = 0; gx < glyph.advance; gx++) this.put(cellX + gx, y + gy, this.state.fillColor);
      }
      cellX += glyph.advance;
    }
    paintGlyphs(glyphs, fontColor, (gx, gy, color) => {
      const [px, py] = [x + gx, y + gy];
      if (px >= 0 && px < this.back.width && py >= 0 && py < this.back.height)
        this.put(px, py, color(this.pixel(px, py)));
    });
    this.state.backPen = { x: x + extent, y };
    if (!this.state.doubleBuffer) this.state.windowPen = { x: x + extent, y };
    this.drawn();
  }

  resize(width: number, height: number): void {
    const side = (value: number, least: number) => Math.min(MAX_SURFACE, Math.max(least, value));
    this.back = blackBuffer(side(width, 640), side(height, 480));
    this.window = this.state.doubleBuffer ? blackBuffer(this.back.width, this.back.height) : null;
    this.state.backPen = { ...this.state.windowPen };
    this.presented();
  }

  resetToStartup(): void {
    this.back = blackBuffer(640, 480);
    this.window = null;
    this.state = startupState();
    this.presented();
  }

  takeDirty(): Rect | null {
    if (!this.changed) return null;
    this.changed = false;
    return { left: 0, top: 0, right: this.back.width, bottom: this.back.height };
  }
}

/** Calls `paint` for every glyph pixel with ink: its position relative to the first glyph and a
 *  function that gives the new colour of the pixel under it. */
function paintGlyphs(
  glyphs: readonly Glyph[],
  fontColor: number,
  paint: (x: number, y: number, color: (under: number) => number) => void,
): void {
  let left = 0;
  for (const glyph of glyphs) {
    for (let gy = 0; gy < glyph.height; gy++) {
      for (let gx = 0; gx < glyph.width; gx++) {
        const coverage = glyph.coverage[gy * glyph.width + gx] as number;
        if (coverage !== 0) paint(left + gx, gy, (under) => blend(under, fontColor, coverage));
      }
    }
    left += glyph.advance;
  }
}

// ---- time ----------------------------------------------------------------------------------------

/** A scheduler for tests: time moves only by `advance`, and timers run at their due times in order. */
export class ManualScheduler implements Scheduler {
  /** Milliseconds since the scheduler was made. */
  now = 0;
  private timers: { due: number; fn: () => void }[] = [];

  onFrame(): () => void {
    return () => {};
  }

  setTimer(delayMs: number, fn: () => void): () => void {
    const timer = { due: this.now + delayMs, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other !== timer);
    };
  }

  /** Number of timers waiting. */
  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward; a timer set meanwhile for a time inside the span runs in the same call. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      let next: { due: number; fn: () => void } | undefined;
      for (const timer of this.timers) if (timer.due <= end && (!next || timer.due < next.due)) next = timer;
      if (!next) break;
      this.timers = this.timers.filter((other) => other !== next);
      this.now = next.due;
      next.fn();
    }
    this.now = end;
  }
}

// ---- the parts wired together --------------------------------------------------------------------

let synthetic: FontSet | undefined;

/** The synthetic fonts (fonts/synthetic.ts), built once. */
export function syntheticFonts(): FontSet {
  return (synthetic ??= fontSetFromFiles(createSyntheticFontFiles()));
}

export interface TextRig {
  surface: TestSurface;
  scheduler: ManualScheduler;
  text: TextScreen;
  /** The `text` and `graphics` host parts over `text` and `surface`. */
  device: OutputDevice;
  /** Every byte the text screen sent to the output log. */
  logged: number[];
  /** Calls of the callbacks, counted. */
  calls: { beep: number; show: number; ioShow: number; bringToFront: number };
  /** The arguments of the full-screen callback, in order. */
  fullScreen: boolean[];
  /** Lines the output device wrote to the message area. */
  messages: string[];
}

/** A text screen and an output device on a `TestSurface`, a `ManualScheduler` and the synthetic fonts. */
export function createTextRig(options: { glyphs?: GlyphProvider; width?: number; height?: number } = {}): TextRig {
  const surface = new TestSurface(options.width ?? 640, options.height ?? 480);
  const scheduler = new ManualScheduler();
  const logged: number[] = [];
  const calls = { beep: 0, show: 0, ioShow: 0, bringToFront: 0 };
  const fullScreen: boolean[] = [];
  const messages: string[] = [];
  const text = new TextScreen({
    surface,
    glyphs: options.glyphs ?? syntheticFonts(),
    scheduler,
    outputLog: (data) => void logged.push(...data),
    beep: () => void calls.beep++,
    show: () => void calls.show++,
  });
  const device = new OutputDevice({
    surface,
    text,
    show: () => void calls.ioShow++,
    bringToFront: () => void calls.bringToFront++,
    setFullScreen: (on) => void fullScreen.push(on),
    message: (line) => void messages.push(line),
  });
  return { surface, scheduler, text, device, logged, calls, fullScreen, messages };
}

/** Text as bytes, one byte per character. */
export function bytesOf(text: string): Bytes {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
}

/** A row of the shadow array as text, read as task 22 reads it (stride textCols). */
export function rowText(text: TextScreen, row: number, length = text.state.textCols): string {
  const start = row * text.state.textCols;
  return String.fromCharCode(...text.state.text.subarray(start, start + length));
}
