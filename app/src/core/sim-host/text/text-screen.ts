// The text half of the I/O window (ARCHITECTURE.md 3.5.2, 3.5.3): a port, function by function, of
// the text functions of the original's simIOu.cpp, as specified in trap15-a §3.4-§3.8 and under
// tasks 11, 21, 22 and 25. Each method names the original it follows; behaviour that looks like a
// mistake (a backspace that erases nothing, a tab that is a relative move, a shadow array whose
// stride changes with the font) is the original's and is what a student's program sees.
//
// What is the engine's and not here: the line-input state machine and the type-ahead key (3.2). The
// engine tells this class what to draw through inputPrompt, erasePrompt, inputEcho and
// inputBackspace.
//
// Text is drawn into the surface that graphics use (trap15-a §3.1): one glyph per call of
// `surface.textOut`, with an opaque cell in the fill colour. The blinking prompt is the one thing
// that is not in the back buffer: it goes to the surface's overlay (target 'window').
//
// Owner: W1 > SH3.

import {
  FontSource,
  FontTarget,
  type Bytes,
  type FontSpec,
  type Glyph,
  type TextScreenApi,
  type TextScreenDeps,
  type TextState,
} from '../../../contracts';
import { styleOf } from '../fonts/metrics';
import type { StyleOverhang } from '../fonts/types';

export type { TextScreenDeps, TextState } from '../../../contracts';

/** Size of the grid the shadow array is allocated for (simIOu.cpp:50). */
export const MAX_ROWS = 128;
export const MAX_COLS = 256;
/** Period of the prompt timer in milliseconds (simIOu.dfm:58-64). */
export const PROMPT_INTERVAL_MS = 500;

const SPACE = 0x20;
const UNDERSCORE = 0x5f;
const DEL = 0x7f;
/** Bytes that paint nothing and take no width inside a text of two or more bytes: HT, LF, CR and
 *  $1C-$1F (trap15-b §6.7, measured on Windows). */
const ZERO_WIDTH_BYTES: ReadonlySet<number> = new Set([0x09, 0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f]);

/** A glyph without ink: `advance` pixels of the opaque box and nothing else. */
function emptyGlyph(advance: number, height: number): Glyph {
  return { advance, width: advance, height, coverage: new Uint8Array(advance * height) };
}

/** The Options font of a fresh installation: Fixedsys 9, white, no style (trap15-a §3.2). */
export const DEFAULT_OPTIONS_FONT: Readonly<FontSpec> = {
  name: 'Fixedsys',
  size: 9,
  bold: false,
  italic: false,
  underline: false,
  strikeOut: false,
};
export const DEFAULT_FONT_COLOR = 0xffffff;

/** Font names of task 21 by font number, spelt as the original spells them (simIOu.cpp:960-982). */
export const TASK21_FONT_NAMES: Readonly<Record<number, string>> = {
  1: 'Fixedsys',
  2: 'Courier',
  3: 'Courier New',
  4: 'Lucida Console',
  5: 'Lucida Sans Typerwriter', // sic
  6: 'Consolas',
  7: 'Terminal',
};

export class TextScreen implements TextScreenApi {
  readonly state: TextState;

  /** Cancels the pending tick of the prompt timer; null while the timer is off. */
  private cancelPromptTimer: (() => void) | null = null;
  /** True while gotorc is inside the doCRLF of its wrap branch (see gotorc). */
  private wrapping = false;
  /**
   * Windows' simulated bold and italic of the raster faces make the opaque box of a text wider than
   * its advances (by 1 pixel and by half the cell height). The box is the sum of the advances the
   * surface is given, so the extra width travels as one more glyph without ink. Null for a font
   * without such an overhang.
   */
  private overhangGlyph: Glyph | null = null;

  constructor(private readonly deps: TextScreenDeps) {
    this.state = {
      row: 0,
      col: 0,
      textX: 0,
      textY: 0,
      colWidth: 0,
      rowHeight: 0,
      textRows: 0,
      textCols: 0,
      text: new Uint8Array(MAX_ROWS * MAX_COLS).fill(SPACE),
      textWrap: false,
      optionsFont: { ...DEFAULT_OPTIONS_FONT },
      optionsFontColor: DEFAULT_FONT_COLOR,
      font: { ...DEFAULT_OPTIONS_FONT },
      fontColor: DEFAULT_FONT_COLOR,
      promptEnabled: false,
      promptVisible: false,
    };
    this.setTextSize();
  }

  /** Width and height of the canvas. The surface replaces its buffers on a resize, so they are read every time. */
  private get canWidth(): number {
    return this.deps.surface.back.width;
  }
  private get canHeight(): number {
    return this.deps.surface.back.height;
  }

  // ---- output -------------------------------------------------------------------------------------

  /** charOut (simIOu.cpp:811-882, trap15-a §3.4): the one routine every text-output task uses. */
  charOut(ch: number): void {
    const s = this.state;
    ch &= 0xff;
    this.deps.show(); // "if (simIO->Visible == false) simIO->Show();"
    switch (ch) {
      case 0x07: // BEL
        this.deps.beep();
        break;
      case 0x08: // BS: one column back, nothing is erased
        s.col--;
        this.log(ch);
        break;
      case 0x0c: // FF
        this.clear();
        this.log(ch);
        break;
      case 0x0a: // LF
        s.row++;
        this.log(ch);
        break;
      case 0x0d: // CR
        s.col = 0;
        this.log(ch);
        break;
      case 0x09: // HT: five columns to the right, not a tab stop
        s.col += 5;
        this.log(ch);
        break;
      case 0x0b: // VT
        s.row += 4;
        this.log(ch);
        break;
      default:
        // "if (ch < 0 || ch >= 0x20)" on a signed char: $20-$FF print, the other control codes do nothing.
        if (ch >= 0x20) {
          this.drawCell(ch);
          s.text[s.row * s.textCols + s.col] = ch; // stride textCols, whatever the column
          s.col++;
          this.log(ch);
        }
    }
    this.gotorc(s.row, s.col);
  }

  /** textOut (simIOu.cpp:887-899): the string without CR, LF; then the window is repainted. */
  textOut(text: Bytes): void {
    for (let i = 0; i < text.length; i++) this.charOut(text[i] as number);
    if (!this.deps.surface.state.doubleBuffer) this.deps.surface.formPaint(); // "this->Repaint();"
  }

  /** textOutCR (simIOu.cpp:921-932): the string, then CR, LF. */
  textOutCR(text: Bytes): void {
    for (let i = 0; i < text.length; i++) this.charOut(text[i] as number);
    this.doCRLF();
  }

  /** doCRLF (simIOu.cpp:998-1012). The output log gets one LF. */
  doCRLF(): void {
    const s = this.state;
    s.col = 0;
    s.row++;
    this.gotorc(s.row, s.col);
    this.log(0x0a);
  }

  /** clear (simIOu.cpp:1016-1035): cursor home, canvas black (never the fill colour), shadow array blank. */
  clear(): void {
    this.gotorc(0, 0);
    this.deps.surface.fillBlack({ left: 0, top: 0, right: this.canWidth, bottom: this.canHeight });
    this.state.text.fill(SPACE); // all 32768 bytes: the one access with stride MAX_COLS
  }

  /**
   * gotorc (simIOu.cpp:1039-1068, trap15-a §3.5): places the cursor; clamps at the top and left,
   * scrolls once at the bottom however far down the request is, and wraps at the right edge when
   * text wrap is on.
   */
  gotorc(r: number, c: number): void {
    const s = this.state;
    if (r < 0) r = 0;
    else if (s.rowHeight * r > this.canHeight - s.rowHeight) {
      this.scroll();
      r = Math.trunc(this.canHeight / s.rowHeight) - 1;
    }
    if (c < 0) c = 0;
    else if (s.colWidth * c > this.canWidth - s.colWidth && s.textWrap && !this.wrapping) {
      // The original calls doCRLF() here, which uses the current row, not r, and calls gotorc again
      // with column 0. With a cell wider than the canvas that call would wrap again without end;
      // the flag makes the port stop after one wrap (no font Windows has reaches that).
      this.wrapping = true;
      try {
        this.doCRLF();
      } finally {
        this.wrapping = false;
      }
      return;
    }
    s.textY = s.rowHeight * r;
    s.row = r;
    if (s.row >= MAX_ROWS) s.row = MAX_ROWS - 1;
    s.textX = s.colWidth * c;
    s.col = c;
    if (s.col >= MAX_COLS) s.col = MAX_COLS - 1;
  }

  /** getrc (simIOu.cpp:1072-1080): column in the high byte, row in the low byte, for D1.W. */
  getrc(): number {
    const signedByte = (value: number) => (value << 24) >> 24;
    // "(short)(((char)col << 8) | (char)row)"
    return ((signedByte(this.state.col) << 8) | signedByte(this.state.row)) & 0xffff;
  }

  /** getCharAt (simIOu.cpp:1084-1096): what charOut stored, read with stride textCols. */
  getCharAt(row: number, col: number): number {
    let r = row & 0xffff; // ushort parameters
    let c = col & 0xffff;
    if (r >= MAX_ROWS) r = MAX_ROWS - 1;
    if (c >= MAX_COLS) c = MAX_COLS - 1;
    return this.state.text[r * this.state.textCols + c] as number;
  }

  /** scroll (simIOu.cpp:1107-1144, trap15-a §3.6): everything, graphics included, moves up one text row. */
  private scroll(): void {
    const s = this.state;
    const { surface } = this.deps;
    const width = this.canWidth;
    const height = this.canHeight;
    surface.copyRect(
      { left: 0, top: 0, right: width, bottom: height - s.rowHeight },
      { left: 0, top: s.rowHeight, right: width, bottom: height },
    );
    // The blacked band is the bottom rowHeight pixels of the canvas, which lies lower than the last
    // text row when the height is not a multiple of the row height.
    surface.fillBlack({ left: 0, top: height - s.rowHeight, right: width, bottom: height });

    // The original's loops count with unsigned numbers; with no row at all they would run wild.
    if (s.textRows === 0) return;
    const text = s.text;
    const cols = s.textCols;
    for (let i = 0; i < s.textRows - 1; i++) {
      for (let j = 0; j < cols; j++) text[i * cols + j] = text[(i + 1) * cols + j] as number;
    }
    for (let j = 0; j < cols; j++) text[(s.textRows - 1) * cols + j] = SPACE;
  }

  /**
   * scrollRect (simIOu.cpp:1151-1272, trap15-a task 25): moves a rectangle of cells by one cell.
   * dir: 0 up, 1 down, 2 left, 3 right. The rectangle is tested against the allocated grid only,
   * not against what is visible; the vacated strip is black; the cursor does not move.
   */
  scrollRect(row: number, col: number, height: number, width: number, dir: number): void {
    const r = row & 0xffff; // ushort parameters
    const c = col & 0xffff;
    const h = height & 0xffff;
    const w = width & 0xffff;
    if (r + h >= MAX_ROWS || c + w >= MAX_COLS || w === 0 || h === 0) return;

    const s = this.state;
    const { surface } = this.deps;
    const cw = s.colWidth;
    const rh = s.rowHeight;
    const topRect = { left: c * cw, top: r * rh, right: (c + w) * cw, bottom: (r + h - 1) * rh };
    const botRect = { left: c * cw, top: (r + 1) * rh, right: (c + w) * cw, bottom: (r + h) * rh };
    const leftRect = { left: c * cw, top: r * rh, right: (c + w - 1) * cw, bottom: (r + h) * rh };
    const rightRect = { left: (c + 1) * cw, top: r * rh, right: (c + w) * cw, bottom: (r + h) * rh };
    const text = s.text;
    const cols = s.textCols;

    switch (dir & 0xffff) {
      case 0: // up
        surface.copyRect(topRect, botRect);
        surface.fillBlack({ left: c * cw, top: (r + h - 1) * rh, right: (c + w) * cw, bottom: (r + h) * rh });
        // Every row takes the row below it, the last one from outside the rectangle; then it is blanked.
        for (let i = r; i < r + h; i++) {
          for (let j = c; j < c + w; j++) text[i * cols + j] = text[(i + 1) * cols + j] as number;
        }
        for (let j = c; j < c + w; j++) text[(r + h - 1) * cols + j] = SPACE;
        break;
      case 1: // down
        surface.copyRect(botRect, topRect);
        surface.fillBlack({ left: c * cw, top: r * rh, right: (c + w) * cw, bottom: (r + 1) * rh });
        for (let i = r + h - 1; i > r; i--) {
          for (let j = c; j < c + w; j++) text[i * cols + j] = text[(i - 1) * cols + j] as number;
        }
        for (let j = c; j < c + w; j++) text[r * cols + j] = SPACE;
        break;
      case 2: // left
        surface.copyRect(leftRect, rightRect);
        surface.fillBlack({ left: (c + w - 1) * cw, top: r * rh, right: (c + w) * cw, bottom: (r + h) * rh });
        for (let j = c; j < c + w; j++) {
          for (let i = r; i < r + h; i++) text[i * cols + j] = text[i * cols + j + 1] as number;
        }
        for (let i = r; i < r + h; i++) text[i * cols + c + w - 1] = SPACE;
        break;
      case 3: // right
        surface.copyRect(rightRect, leftRect);
        surface.fillBlack({ left: c * cw, top: r * rh, right: (c + 1) * cw, bottom: (r + h) * rh });
        for (let j = c + w - 1; j > c; j--) {
          for (let i = r; i < r + h; i++) text[i * cols + j] = text[i * cols + j - 1] as number;
        }
        for (let i = r; i < r + h; i++) text[i * cols + c] = SPACE;
        break;
      default: // any other direction does nothing
    }
  }

  /**
   * drawText (simIOu.cpp:906-916, trap15-b §6.7): task 95, text at a pixel position. Nothing is
   * stored in the shadow array and the cursor does not move. The original hands the bytes to
   * Windows as one text; what Windows does with it was measured (tests/oracle/gdi-capture):
   * - inside a text of two or more bytes the zero-width bytes paint nothing and take no room; a
   *   text of such bytes only fills one cell;
   * - the opaque box is as wide as the advances of the drawn bytes, plus the style overhang of a
   *   bold or italic raster font; the italic overhang is left out when the text, without its
   *   trailing zero-width bytes, has two or more bytes and one of them is zero-width or $7F;
   * - the pen moves by the text extent, which counts every byte - except that with underline or
   *   strike-out a zero-width byte that is not among the trailing ones counts nothing.
   */
  drawText(text: Bytes, x: number, y: number): void {
    const { glyphs, surface } = this.deps;
    const s = this.state;
    const inText = text.length >= 2;
    let core = text.length; // length without the trailing zero-width bytes
    while (core > 1 && ZERO_WIDTH_BYTES.has(text[core - 1] as number)) core--;
    const lined = s.font.underline || s.font.strikeOut;

    const printed: Glyph[] = [];
    let extent = 0;
    let onlyZeroWidth = text.length > 0;
    let italicCut = false;
    for (let i = 0; i < text.length; i++) {
      const byte = text[i] as number;
      const glyph = glyphs.glyph(s.font, byte);
      const zeroWidth = ZERO_WIDTH_BYTES.has(byte);
      if (!zeroWidth) onlyZeroWidth = false;
      if (i < core && (zeroWidth || byte === DEL)) italicCut = true;
      const skipped = inText && zeroWidth;
      if (!(skipped && lined && i < core)) extent += glyph.advance;
      if (!skipped) printed.push(glyph);
    }
    if (onlyZeroWidth) {
      if (inText) {
        const first = glyphs.glyph(s.font, text[0] as number);
        printed.push(emptyGlyph(first.advance, first.height));
      }
    } else if (this.overhangGlyph && !(core >= 2 && italicCut && styleOf(s.font) === 'italic')) {
      printed.push(this.overhangGlyph);
    }
    surface.textOut(x, y, printed, extent, s.fontColor, 'both');
  }

  // ---- fonts and sizes ----------------------------------------------------------------------------

  /**
   * setFontProperties (simIOu.cpp:935-994, trap15-a task 21). color = D1.L, style = D2.L: bits 0-3
   * bold, italic, underline, strike-out; high word = font number (high byte) and point size (low
   * byte), or 0.
   */
  setFontProperties(color: number, style: number): void {
    const s = this.state;
    // Starts from the Options font, not from the font in use: a colour-only call undoes an earlier
    // choice of name and size.
    const font: FontSpec = { ...s.optionsFont, bold: false, italic: false, underline: false, strikeOut: false };
    // Each test replaces the whole style set, so only the highest set bit counts.
    if (style & 0x01) font.bold = true;
    if (style & 0x02) {
      font.bold = false;
      font.italic = true;
    }
    if (style & 0x04) {
      font.bold = font.italic = false;
      font.underline = true;
    }
    if (style & 0x08) {
      font.bold = font.italic = font.underline = false;
      font.strikeOut = true;
    }
    const high = (style >>> 16) & 0xffff;
    if (high !== 0) {
      // Any other font number keeps the Options font's name.
      font.name = TASK21_FONT_NAMES[high >> 8] ?? font.name;
      font.size = high & 0xff; // unconditionally, also when it is 0
    }
    s.font = font;
    s.fontColor = textColor(color);
    this.setTextSize();
    // The cursor keeps its row and column numbers; its pixel position follows the new cell, and the
    // screen scrolls once if the row no longer fits.
    this.gotorc(s.row, s.col);
  }

  /** setTextSize (simIOu.cpp:392-408): measures the cell of the font in use and the grid that fits the canvas. */
  setTextSize(): void {
    const s = this.state;
    const cell = this.deps.glyphs.metrics(s.font);
    // Windows never reports an empty cell; a provider that does must not make the divisions fail.
    s.rowHeight = Math.max(1, Math.trunc(cell.rowHeight));
    s.colWidth = Math.max(1, Math.trunc(cell.colWidth));
    s.textRows = Math.min(Math.trunc(this.canHeight / s.rowHeight), MAX_ROWS);
    s.textCols = Math.min(Math.trunc(this.canWidth / s.colWidth), MAX_COLS);
    // The contract's GlyphProvider does not know the style overhang; the port's own provider does.
    const overhang = (this.deps.glyphs as Partial<StyleOverhang>).textOverhang?.(s.font) ?? 0;
    this.overhangGlyph = overhang > 0 ? emptyGlyph(overhang, s.rowHeight) : null;
  }

  setTextWrap(on: boolean): void {
    this.state.textWrap = on;
  }

  /**
   * Options > Output Window Font, OK (SIM68Ku.cpp:956-963, trap15-a §3.2). The font and the colour
   * also become what every simulator reset restores. The cell is measured again but the cursor is
   * not placed again: the next character is drawn at the pixel position of the old cell.
   */
  setOptionsFont(font: FontSpec, color: number): void {
    const s = this.state;
    s.optionsFont = { ...font };
    s.optionsFontColor = textColor(color);
    s.font = { ...font };
    s.fontColor = s.optionsFontColor;
    this.setTextSize();
  }

  /**
   * The engine's simulator reset assigns the Options font to the back buffer and to the window
   * (STARTSIM.CPP:46-47; `FontTarget` 1 and 2, `FontSource.IoDialog`). The port restores font, colour
   * and cell on every such call, the behaviour trap15-a §12 item 4 recommends. Other targets and
   * sources belong to other parts and are ignored here.
   */
  fontAssign(target: number, source: number): void {
    if (source !== FontSource.IoDialog) return;
    if (target !== FontTarget.IoBackBuffer && target !== FontTarget.IoWindow) return;
    const s = this.state;
    s.font = { ...s.optionsFont };
    s.fontColor = s.optionsFontColor;
    this.setTextSize();
  }

  // ---- keyboard input: what the engine asks to be drawn ---------------------------------------------

  /**
   * The prompt timer (trap15-a §3.8). mode 0: off; 1: on; 2: on, and the blink state set to
   * "visible", which is how an input task starts it. Like the original's timer, switching it on
   * while it is on changes nothing, and switching it on starts a full period: nothing is drawn now.
   */
  inputPrompt(mode: number): void {
    const s = this.state;
    if (mode === 0) {
      this.stopPromptTimer();
      return;
    }
    if (!s.promptEnabled) {
      s.promptEnabled = true;
      this.armPromptTimer();
    }
    if (mode === 2) s.promptVisible = true;
  }

  /**
   * promptTimer (simIOu.cpp:1420-1434): one tick of the prompt timer. Draws a blank or an underscore
   * at the cursor - on the window only, never into the back buffer - and toggles the blink state.
   * Does nothing while double buffering is on. Because an input task starts with the state
   * "visible", the first tick draws the blank: the underscore first shows after two periods.
   */
  promptTick(): void {
    const s = this.state;
    if (this.deps.surface.state.doubleBuffer) return;
    this.drawOverlay(s.promptVisible ? SPACE : UNDERSCORE);
    s.promptVisible = !s.promptVisible;
  }

  /**
   * erasePrompt (simIOu.cpp:1439-1452): stops the timer and draws a blank over the prompt cell on
   * the window, also while double buffering is on. The blank hides what the back buffer holds there
   * until the window is next repainted from the back buffer. The engine calls this only while the
   * prompt is wanted (task 16).
   */
  erasePrompt(): void {
    this.stopPromptTimer();
    this.drawOverlay(SPACE);
  }

  /**
   * A character typed during line input (simIOu.cpp:1391-1405; the engine keeps the line). With
   * echo it is drawn, but not through charOut: control codes are not interpreted and nothing is
   * stored in the shadow array. The cursor advances with or without echo.
   */
  inputEcho(ch: number, echo: boolean): void {
    const s = this.state;
    if (echo) {
      this.drawCell(ch & 0xff);
      this.log(ch & 0xff);
    }
    this.gotorc(s.row, s.col + 1);
    this.deps.surface.formPaint(); // "this->Invalidate();"
  }

  /** A backspace during line input (simIOu.cpp:1378-1386): one column back, and with echo a blank over the character. */
  inputBackspace(echo: boolean): void {
    const s = this.state;
    this.gotorc(s.row, s.col - 1);
    if (echo) this.drawCell(SPACE);
    this.deps.surface.formPaint(); // "this->Invalidate();"
  }

  // ---- start-up ---------------------------------------------------------------------------------------

  /** The state of the original right after start (3.3.2): cursor home, shadow array blank, text wrap
   *  off, the default Options font in use, prompt off. */
  resetToStartup(): void {
    const s = this.state;
    this.stopPromptTimer();
    s.promptVisible = false;
    s.row = s.col = s.textX = s.textY = 0;
    s.text.fill(SPACE);
    s.textWrap = false;
    s.optionsFont = { ...DEFAULT_OPTIONS_FONT };
    s.optionsFontColor = DEFAULT_FONT_COLOR;
    s.font = { ...DEFAULT_OPTIONS_FONT };
    s.fontColor = DEFAULT_FONT_COLOR;
    this.setTextSize();
  }

  // ---- helpers ------------------------------------------------------------------------------------

  /** "TextOutA(textX, textY, ch)" on the back buffer and, unless double buffered, on the window. */
  private drawCell(ch: number): void {
    this.textOutChar(this.state.textX, ch, 'both');
  }

  /** "Canvas->TextOutA(colWidth * col, textY, ch)": the prompt cell, on the window only. */
  private drawOverlay(ch: number): void {
    this.textOutChar(this.state.colWidth * this.state.col, ch, 'window');
  }

  /** A TextOut of one character at (x, textY): its glyph, and the style overhang in the opaque box
   *  (a text of one zero-width byte has none; see drawText). The pen moves by the advance. */
  private textOutChar(x: number, ch: number, target: 'both' | 'window'): void {
    const s = this.state;
    const glyph = this.deps.glyphs.glyph(s.font, ch);
    const glyphs = this.overhangGlyph && !ZERO_WIDTH_BYTES.has(ch) ? [glyph, this.overhangGlyph] : [glyph];
    this.deps.surface.textOut(x, s.textY, glyphs, glyph.advance, s.fontColor, target);
  }

  /** One byte for the output log; the log service keeps it only while the output log is on. */
  private log(ch: number): void {
    this.deps.outputLog(Uint8Array.of(ch));
  }

  private armPromptTimer(): void {
    this.cancelPromptTimer = this.deps.scheduler.setTimer(PROMPT_INTERVAL_MS, () => {
      this.cancelPromptTimer = null;
      if (!this.state.promptEnabled) return;
      this.armPromptTimer();
      this.promptTick();
    });
  }

  private stopPromptTimer(): void {
    this.state.promptEnabled = false;
    this.cancelPromptTimer?.();
    this.cancelPromptTimer = null;
  }
}

/** A text colour as the surface takes it. trap15-a task 21: the port uses the low 24 bits ($00BBGGRR). */
function textColor(color: number): number {
  return color & 0x00ffffff;
}
