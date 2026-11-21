// TEST DOUBLE for the text screen and the output device (contracts TextScreenApi, HostIoText),
// used by the Output feature's own tests and by its browser check. Never imported by the
// application.
//
// The real text screen (core/sim-host/text, work package SH3) is written at the same time as the
// Output panel. This grid is enough for what the panel's tests need from it: the keyboard tasks
// 2 and 5 of TRAP #15 (prompt, echo, backspace, the line end), plain text output so that a
// screenshot shows something, the shadow array for the text mirror, the size and full-screen calls
// of task 33, and the text-wrap option. It has one fixed 8x16 cell and no fonts: unless a glyph
// source is given, every character is a filled block. Scrolling, text wrap, tabs, colours and
// fonts are NOT here.

import type { Bytes, FontSpec, Glyph, HostIoText, SurfaceApi, TextScreenApi, TextState } from '../../../contracts';

export const CELL_WIDTH = 8;
export const CELL_HEIGHT = 16;

const FONT: FontSpec = { name: 'Fixedsys', size: 9, bold: false, italic: false, underline: false, strikeOut: false };
const WHITE = 0xffffff;

/** A block that fills the cell except for a one-pixel margin: the glyph of every character. */
const BLOCK: Glyph = (() => {
  const coverage = new Uint8Array(CELL_WIDTH * CELL_HEIGHT);
  for (let y = 2; y < CELL_HEIGHT - 2; y++) coverage.fill(255, y * CELL_WIDTH + 1, y * CELL_WIDTH + CELL_WIDTH - 1);
  return { advance: CELL_WIDTH, width: CELL_WIDTH, height: CELL_HEIGHT, coverage };
})();
const BLANK: Glyph = {
  advance: CELL_WIDTH,
  width: CELL_WIDTH,
  height: CELL_HEIGHT,
  coverage: new Uint8Array(CELL_WIDTH * CELL_HEIGHT),
};

export interface TextGridDeps {
  surface: SurfaceApi;
  /** A picture for a character (one Windows-1252 byte), 8x16; default: a block. */
  glyph?: (ch: number) => Glyph;
  /** ioShow(): the engine shows the I/O window (text output, a keyboard read). */
  show?: () => void;
  /** ioBringToFront(): Run was pressed. */
  bringToFront?: () => void;
  /** setupWindow(): the engine enters or leaves full screen. */
  setFullScreen?: (on: boolean) => void;
}

export class TextGrid implements TextScreenApi, HostIoText {
  readonly state: TextState;
  /** Every call the engine made to the input methods, in order: for tests. */
  readonly calls: string[] = [];

  constructor(private readonly deps: TextGridDeps) {
    this.state = {
      row: 0,
      col: 0,
      textX: 0,
      textY: 0,
      colWidth: CELL_WIDTH,
      rowHeight: CELL_HEIGHT,
      textRows: 0,
      textCols: 0,
      text: new Uint8Array(32768).fill(0x20),
      textWrap: false,
      optionsFont: FONT,
      optionsFontColor: WHITE,
      font: FONT,
      fontColor: WHITE,
      promptEnabled: false,
      promptVisible: false,
    };
    this.setTextSize();
  }

  /* ---- text output */

  charOut(ch: number): void {
    const { state } = this;
    if (ch === 0x0d) return this.gotorc(state.row, 0);
    if (ch === 0x0a) return this.gotorc(state.row + 1, state.col);
    if (ch === 0x08) return this.gotorc(state.row, Math.max(state.col - 1, 0));
    if (ch < 0x20) return;
    if (state.row < state.textRows && state.col < state.textCols) {
      state.text[state.row * state.textCols + state.col] = ch;
      this.draw(ch, 'both');
    }
    this.gotorc(state.row, state.col + 1);
  }
  textOut(text: Bytes): void {
    for (const ch of text) this.charOut(ch);
  }
  textOutCR(text: Bytes): void {
    this.textOut(text);
    this.doCRLF();
  }
  doCRLF(): void {
    this.calls.push('doCRLF');
    this.gotorc(this.state.row + 1, 0);
  }
  clear(): void {
    const { surface } = this.deps;
    this.state.text.fill(0x20);
    surface.fillBlack({ left: 0, top: 0, right: surface.back.width, bottom: surface.back.height });
    this.gotorc(0, 0);
  }
  gotorc(row: number, col: number): void {
    const { state } = this;
    state.row = Math.min(Math.max(row, 0), Math.max(state.textRows - 1, 0)); // no scrolling: the last row is kept
    state.col = Math.max(col, 0);
    state.textX = state.col * CELL_WIDTH;
    state.textY = state.row * CELL_HEIGHT;
  }
  getrc(): number {
    return ((this.state.col & 0xff) << 8) | (this.state.row & 0xff);
  }
  getCharAt(row: number, col: number): number {
    return this.state.text[Math.min(row, 127) * this.state.textCols + Math.min(col, 255)] ?? 0x20;
  }
  scrollRect(): void {}
  setFontProperties(): void {}
  drawText(): void {}

  /* ---- keyboard input (trap15-a §3.8, §3.9) */

  inputPrompt(mode: number): void {
    this.calls.push(`inputPrompt(${mode})`);
    this.state.promptEnabled = mode !== 0;
    // The real prompt blinks on a timer; this one stands still.
    if (mode !== 0) this.draw(0x5f, 'window');
  }
  erasePrompt(): void {
    this.calls.push('erasePrompt');
    this.draw(0x20, 'window');
  }
  inputEcho(ch: number, echo: boolean): void {
    this.calls.push(`inputEcho(${ch})`);
    // The echo is drawn but not stored in the shadow array (trap15-a §3.9).
    if (echo) this.draw(ch, 'both');
    this.gotorc(this.state.row, this.state.col + 1);
  }
  inputBackspace(echo: boolean): void {
    this.calls.push('inputBackspace');
    this.gotorc(this.state.row, this.state.col - 1);
    if (echo) this.draw(0x20, 'both');
  }
  promptTick(): void {}

  /* ---- options */

  setTextSize(): void {
    const { width, height } = this.deps.surface.back;
    this.state.textCols = Math.min(Math.floor(width / CELL_WIDTH), 256);
    this.state.textRows = Math.min(Math.floor(height / CELL_HEIGHT), 128);
  }
  setTextWrap(on: boolean): void {
    this.state.textWrap = on;
  }
  setOptionsFont(): void {}
  fontAssign(): void {}
  resetToStartup(): void {
    this.state.text.fill(0x20);
    this.state.textWrap = false;
    this.state.promptEnabled = false;
    this.gotorc(0, 0);
  }

  /* ---- the window (HostIoText) */

  setWindowSize(width: number, height: number): void {
    const { surface } = this.deps;
    // 0,0 keeps the size; every call blacks the surface (trap15-b §4.3).
    surface.resize(width || surface.back.width, height || surface.back.height);
    this.setTextSize();
  }
  getWindowSize(): [number, number] {
    return [this.deps.surface.back.width, this.deps.surface.back.height];
  }
  setupWindow(fullScreen: boolean): void {
    this.deps.setFullScreen?.(fullScreen);
  }
  ioShow(): void {
    this.deps.show?.();
  }
  ioBringToFront(): void {
    this.deps.bringToFront?.();
  }
  invalidate(): void {
    this.deps.surface.formPaint();
  }

  /** Draws one character cell at the cursor. */
  private draw(ch: number, target: 'both' | 'window'): void {
    const glyph = ch === 0x20 ? BLANK : (this.deps.glyph?.(ch) ?? BLOCK);
    this.deps.surface.textOut(this.state.textX, this.state.textY, [glyph], CELL_WIDTH, this.state.fontColor, target);
  }
}
