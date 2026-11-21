// The I/O window as the engine sees it (ARCHITECTURE.md 3.3.1): OutputDevice composes TextScreen
// and Surface into the `text` and `graphics` host parts.
//
// STUB written by W1 (wave 0). SH3 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub does nothing and returns the
// engine's defaults (HOST_DEFAULTS of engine/sim/sim68k.mjs).
//
// Owner: W1 > SH3.

import type { Bytes, OutputDeviceApi, OutputDeviceDeps } from '../../contracts';

export type { OutputDeviceDeps } from '../../contracts';

export class OutputDevice implements OutputDeviceApi {
  constructor(private readonly deps: OutputDeviceDeps) {}

  /* HostIoText */
  charOut(_ch: number): void {}
  textOut(_text: Bytes): void {}
  textOutCR(_text: Bytes): void {}
  clear(): void {}
  getrc(): number | undefined {
    return undefined;
  }
  gotorc(_row: number, _col: number): void {}
  setFontProperties(_color: number, _style: number): void {}
  getCharAt(_row: number, _col: number): number | undefined {
    return undefined;
  }
  scrollRect(_row: number, _col: number, _height: number, _width: number, _direction: number): void {}
  setWindowSize(_width: number, _height: number): void {}
  getWindowSize(): [number, number] | undefined {
    return undefined;
  }
  setupWindow(_fullScreen: boolean): void {}
  ioShow(): void {}
  ioBringToFront(): void {}
  inputPrompt(_mode: number): void {}
  erasePrompt(): void {}
  inputEcho(_ch: number, _echo: boolean): void {}
  inputBackspace(_echo: boolean): void {}
  doCRLF(): void {}
  invalidate(): void {}

  /* HostIoGraphics */
  setLineColor(_color: number): void {}
  setFillColor(_color: number): void {}
  drawPixel(_x: number, _y: number): void {}
  getPixel(_x: number, _y: number): number {
    return 0;
  }
  line(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  lineTo(_x: number, _y: number): void {}
  moveTo(_x: number, _y: number): void {}
  rectangle(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  ellipse(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  floodFill(_x: number, _y: number): void {}
  unfilledRectangle(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  unfilledEllipse(_x1: number, _y1: number, _x2: number, _y2: number): void {}
  setDrawingMode(_mode: number): void {}
  setPenWidth(_width: number): void {}
  formPaint(): void {}
  drawText(_text: Bytes, _x: number, _y: number): void {}
  getXY(): [number, number] | undefined {
    return undefined;
  }
}
