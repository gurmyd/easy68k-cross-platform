// The I/O window as the engine sees it (ARCHITECTURE.md 3.3.1): OutputDevice composes TextScreen and
// Surface into the `text` and `graphics` host parts. It has no state of its own; a method either
// belongs to the text screen, to the surface, to both (a size change), or to the Output panel
// (show, bring to front, full screen), which it reaches through three callbacks. A fourth callback
// writes one line to the simulator message area.
//
// Owner: W1 > SH3.

import type { Bytes, OutputDeviceApi, OutputDeviceDeps } from '../../contracts';
import { MAX_SURFACE } from './surface/surface';

export type { OutputDeviceDeps } from '../../contracts';

/** Smallest canvas (simIOu.cpp:40-41). */
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 480;

/** Message for a size request above the port's limit (ARCHITECTURE.md 2.5). */
export const SIZE_LIMIT_MESSAGE = `Output window size limited to ${MAX_SURFACE} x ${MAX_SURFACE}`;

export class OutputDevice implements OutputDeviceApi {
  constructor(private readonly deps: OutputDeviceDeps) {}

  /* ---- HostIoText: the text screen ---- */

  charOut(ch: number): void {
    this.deps.text.charOut(ch);
  }
  textOut(text: Bytes): void {
    this.deps.text.textOut(text);
  }
  textOutCR(text: Bytes): void {
    this.deps.text.textOutCR(text);
  }
  clear(): void {
    this.deps.text.clear();
  }
  getrc(): number {
    return this.deps.text.getrc();
  }
  gotorc(row: number, col: number): void {
    this.deps.text.gotorc(row, col);
  }
  setFontProperties(color: number, style: number): void {
    this.deps.text.setFontProperties(color, style);
  }
  getCharAt(row: number, col: number): number {
    return this.deps.text.getCharAt(row, col);
  }
  scrollRect(row: number, col: number, height: number, width: number, direction: number): void {
    this.deps.text.scrollRect(row, col, height, width, direction);
  }
  inputPrompt(mode: number): void {
    this.deps.text.inputPrompt(mode);
  }
  erasePrompt(): void {
    this.deps.text.erasePrompt();
  }
  inputEcho(ch: number, echo: boolean): void {
    this.deps.text.inputEcho(ch, echo);
  }
  inputBackspace(echo: boolean): void {
    this.deps.text.inputBackspace(echo);
  }
  doCRLF(): void {
    this.deps.text.doCRLF();
  }

  /* ---- HostIoText: the window ---- */

  /**
   * setWindowSize (simIOu.cpp:187-233, trap15-b §4.3). 0, 0 keeps the size. Every call blacks the
   * whole surface and measures the text grid again; the cursor and the shadow array stay as they
   * are. The surface clamps each side to at least 640 x 480 and to the port's maximum; a request
   * above the maximum is reported in the message area.
   *
   * Two calls at the end of the original's function have no counterpart here: `setupWindow()`,
   * which lays the window out again (in full screen it switches the display to the new size), and
   * `Form1->WindowSizeChecked()`, which sets the radio marks of the size menu. The Output panel
   * lays the surface out from its size on every frame, in a window and in full screen, and the
   * menu marks follow the size the same way. The full-screen flag is the engine's; this class
   * only passes it on in `setupWindow` and must not repeat an old value of it here.
   */
  setWindowSize(width: number, height: number): void {
    const { surface, text } = this.deps;
    width &= 0xffff; // ushort parameters
    height &= 0xffff;
    if (height === 0 && width === 0) {
      width = surface.back.width;
      height = surface.back.height;
    }
    if (width > MAX_SURFACE || height > MAX_SURFACE) this.deps.message?.(SIZE_LIMIT_MESSAGE);
    surface.resize(Math.max(width, MIN_WIDTH), Math.max(height, MIN_HEIGHT));
    text.setTextSize();
  }
  getWindowSize(): [number, number] {
    const { back } = this.deps.surface;
    return [back.width, back.height];
  }
  setupWindow(fullScreen: boolean): void {
    this.deps.setFullScreen(fullScreen);
  }
  ioShow(): void {
    this.deps.show();
  }
  ioBringToFront(): void {
    this.deps.bringToFront();
  }
  /** "this->Invalidate()": the window is repainted from the back buffer. */
  invalidate(): void {
    this.deps.surface.formPaint();
  }

  /* ---- HostIoGraphics: the surface ---- */

  setLineColor(color: number): void {
    this.deps.surface.setLineColor(color);
  }
  setFillColor(color: number): void {
    this.deps.surface.setFillColor(color);
  }
  drawPixel(x: number, y: number): void {
    this.deps.surface.drawPixel(x, y);
  }
  getPixel(x: number, y: number): number {
    return this.deps.surface.getPixel(x, y);
  }
  line(x1: number, y1: number, x2: number, y2: number): void {
    this.deps.surface.line(x1, y1, x2, y2);
  }
  lineTo(x: number, y: number): void {
    this.deps.surface.lineTo(x, y);
  }
  moveTo(x: number, y: number): void {
    this.deps.surface.moveTo(x, y);
  }
  rectangle(x1: number, y1: number, x2: number, y2: number): void {
    this.deps.surface.rectangle(x1, y1, x2, y2);
  }
  ellipse(x1: number, y1: number, x2: number, y2: number): void {
    this.deps.surface.ellipse(x1, y1, x2, y2);
  }
  floodFill(x: number, y: number): void {
    this.deps.surface.floodFill(x, y);
  }
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void {
    this.deps.surface.unfilledRectangle(x1, y1, x2, y2);
  }
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void {
    this.deps.surface.unfilledEllipse(x1, y1, x2, y2);
  }
  setDrawingMode(mode: number): void {
    this.deps.surface.setDrawingMode(mode);
  }
  setPenWidth(width: number): void {
    this.deps.surface.setPenWidth(width);
  }
  formPaint(): void {
    this.deps.surface.formPaint();
  }
  /** Task 95 draws with the font of the text screen (trap15-b §5.7). */
  drawText(text: Bytes, x: number, y: number): void {
    this.deps.text.drawText(text, x, y);
  }
  getXY(): [number, number] {
    return this.deps.surface.getXY();
  }
}
