// The text half of the I/O window (ARCHITECTURE.md 3.5.2): a port of the text part of simIOu.cpp.
//
// STUB written by W1 (wave 0). SH3 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub holds the start-up state of 3.3.2
// with a Fixedsys 9 cell of 8 x 15 pixels (the default font at 96 DPI), draws nothing, and answers
// getrc / getCharAt from that state.
//
// Owner: W1 > SH3.

import type { Bytes, FontSpec, TextScreenApi, TextScreenDeps, TextState } from '../../../contracts';

export type { TextScreenDeps, TextState } from '../../../contracts';

const TEXT_BYTES = 32768;

function optionsFont(): FontSpec {
  return { name: 'Fixedsys', size: 9, bold: false, italic: false, underline: false, strikeOut: false };
}

function startupState(): TextState {
  const colWidth = 8;
  const rowHeight = 15;
  return {
    row: 0,
    col: 0,
    textX: 0,
    textY: 0,
    colWidth,
    rowHeight,
    textRows: Math.min(Math.floor(480 / rowHeight), 128),
    textCols: Math.min(Math.floor(640 / colWidth), 256),
    text: new Uint8Array(TEXT_BYTES).fill(0x20),
    textWrap: false,
    optionsFont: optionsFont(),
    optionsFontColor: 0xffffff,
    font: optionsFont(),
    fontColor: 0xffffff,
    promptEnabled: false,
    promptVisible: false,
  };
}

export class TextScreen implements TextScreenApi {
  state: TextState = startupState();

  constructor(private readonly deps: TextScreenDeps) {}

  charOut(_ch: number): void {}
  textOut(_text: Bytes): void {}
  textOutCR(_text: Bytes): void {}
  doCRLF(): void {}
  clear(): void {}
  gotorc(_row: number, _col: number): void {}
  getrc(): number {
    return ((this.state.col & 0xff) << 8) | (this.state.row & 0xff);
  }
  getCharAt(row: number, col: number): number {
    return this.state.text[row * this.state.textCols + col] ?? 0x20;
  }
  scrollRect(_row: number, _col: number, _height: number, _width: number, _dir: number): void {}
  setFontProperties(_color: number, _style: number): void {}
  inputPrompt(_mode: number): void {}
  erasePrompt(): void {}
  inputEcho(_ch: number, _echo: boolean): void {}
  inputBackspace(_echo: boolean): void {}
  drawText(_text: Bytes, _x: number, _y: number): void {}
  promptTick(): void {}
  setTextSize(): void {}
  setTextWrap(on: boolean): void {
    this.state.textWrap = on;
  }
  setOptionsFont(_font: FontSpec, _color: number): void {}
  fontAssign(_target: number, _source: number): void {}
  resetToStartup(): void {
    this.state = startupState();
  }
}
