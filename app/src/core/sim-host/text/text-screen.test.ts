// TextScreen driven directly (ARCHITECTURE.md 3.5.2, 3.5.3; trap15-a §3.4-§3.8, tasks 11, 21, 22,
// 25; trap15-b §5.5, §6.7, §6.8). The same behaviour driven by 68000 programs through the real
// engine is in engine.test.ts.
//
// The default grid is the original's: Fixedsys 9, cells of 8 x 15 pixels, 80 columns x 32 rows on
// 640 x 480.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FontSource, FontTarget, type FontSpec, type Glyph, type GlyphProvider, type Rect } from '../../../contracts';
import { AtlasGlyphProvider } from '../fonts/atlas-provider';
import { createSyntheticFontFiles, memoryFontLoader } from '../fonts/synthetic';
import { blend, bytesOf, createTextRig, rowText, syntheticFonts, type TextRig } from './testing';
import { DEFAULT_OPTIONS_FONT, MAX_COLS, MAX_ROWS, TASK21_FONT_NAMES } from './text-screen';

const WHITE = 0xffffff;
const BLACK = 0x000000;
const BLUE = 0xff0000; // $00BBGGRR
const RED = 0x0000ff;

// The synthetic fonts are drawn once; under load that can take seconds, so it has a limit of its own.
beforeAll(() => void syntheticFonts(), 60_000);

let rig: TextRig;
beforeEach(() => {
  rig = createTextRig();
});

const cursor = () => ({ row: rig.text.state.row, col: rig.text.state.col });
const print = (text: string) => {
  for (const byte of bytesOf(text)) rig.text.charOut(byte);
};
const glyphOf = (ch: number | string, font: FontSpec = rig.text.state.font): Glyph =>
  syntheticFonts().glyph(font, typeof ch === 'string' ? ch.charCodeAt(0) : ch);
const cellRect = (row: number, col: number, cols = 1, rows = 1): Rect => {
  const { colWidth, rowHeight } = rig.text.state;
  return {
    left: col * colWidth,
    top: row * rowHeight,
    right: (col + cols) * colWidth,
    bottom: (row + rows) * rowHeight,
  };
};

/** The cell at pixel (x, y) shows `glyph` in `color` on `background`, pixel for pixel. */
function expectGlyphAt(x: number, y: number, glyph: Glyph, color = WHITE, background = BLACK): void {
  const wrong: string[] = [];
  for (let gy = 0; gy < glyph.height; gy++) {
    for (let gx = 0; gx < glyph.advance; gx++) {
      const coverage = gx < glyph.width ? (glyph.coverage[gy * glyph.width + gx] as number) : 0;
      const expected = blend(background, color, coverage);
      const actual = rig.surface.pixel(x + gx, y + gy);
      if (actual !== expected)
        wrong.push(`(${x + gx},${y + gy}) is ${actual.toString(16)}, expected ${expected.toString(16)}`);
    }
  }
  expect(wrong.slice(0, 5)).toEqual([]);
}
const expectChar = (row: number, col: number, ch: string, color = WHITE, background = BLACK) =>
  expectGlyphAt(col * rig.text.state.colWidth, row * rig.text.state.rowHeight, glyphOf(ch), color, background);
const isBlack = (rect: Rect) => rig.surface.isFilled(rect, BLACK);
const whole = (): Rect => ({ left: 0, top: 0, right: rig.surface.back.width, bottom: rig.surface.back.height });

describe('the start-up state', () => {
  it('is the default grid of the original: 8 x 15 cells, 80 x 32', () => {
    expect(rig.text.state).toMatchObject({
      row: 0,
      col: 0,
      textX: 0,
      textY: 0,
      colWidth: 8,
      rowHeight: 15,
      textRows: 32,
      textCols: 80,
      textWrap: false,
      optionsFont: DEFAULT_OPTIONS_FONT,
      optionsFontColor: WHITE,
      font: DEFAULT_OPTIONS_FONT,
      fontColor: WHITE,
      promptEnabled: false,
      promptVisible: false,
    });
    expect(rig.text.state.text).toHaveLength(32768);
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
  });

  it('the grids of the menu sizes are the ones of trap15-a §3.2', () => {
    const grids = [
      [640, 480],
      [800, 600],
      [1024, 768],
      [1280, 800],
      [1280, 1024],
      [1440, 900],
      [1680, 1050],
      [1920, 1080],
      [1920, 1200],
    ].map(([width, height]) => {
      rig.device.setWindowSize(width as number, height as number);
      return `${rig.text.state.textCols}x${rig.text.state.textRows}`;
    });
    expect(grids).toEqual(['80x32', '100x40', '128x51', '160x53', '160x68', '180x60', '210x70', '240x72', '240x80']);
  });
});

describe('charOut (trap15-a §3.4)', () => {
  it("'AB' at home: A in row 0 column 0, B in column 1, cursor in column 2", () => {
    print('AB');
    expectChar(0, 0, 'A');
    expectChar(0, 1, 'B');
    expect(isBlack(cellRect(0, 2, 78))).toBe(true);
    expect(cursor()).toEqual({ row: 0, col: 2 });
    expect(rig.text.state).toMatchObject({ textX: 16, textY: 0 });
    expect(rowText(rig.text, 0, 3)).toBe('AB ');
    expect(rig.text.getrc()).toBe(0x0200);
  });

  it('shows the Output panel on every call', () => {
    print('A\r\x07');
    expect(rig.calls.show).toBe(3);
  });

  it('BEL beeps and does nothing else', () => {
    print('AB\x07');
    expect(rig.calls.beep).toBe(1);
    expect(cursor()).toEqual({ row: 0, col: 2 });
  });

  it('BS moves one column left and erases nothing', () => {
    print('ABC\b');
    expect(cursor()).toEqual({ row: 0, col: 2 }); // on the C
    expectChar(0, 2, 'C');
    expect(rowText(rig.text, 0, 3)).toBe('ABC');
  });

  it('BS in column 0 stays in column 0', () => {
    print('\b');
    expect(cursor()).toEqual({ row: 0, col: 0 });
  });

  it('HT is a move of five columns, not a tab stop', () => {
    print('\t');
    expect(cursor()).toEqual({ row: 0, col: 5 });
    print('AB\t');
    expect(cursor()).toEqual({ row: 0, col: 12 });
  });

  it('LF moves one row down in the same column, VT four rows, CR to column 0', () => {
    print('ABC\n');
    expect(cursor()).toEqual({ row: 1, col: 3 });
    print('\v');
    expect(cursor()).toEqual({ row: 5, col: 3 });
    print('\r');
    expect(cursor()).toEqual({ row: 5, col: 0 });
    expect(rig.text.state).toMatchObject({ textX: 0, textY: 75 });
  });

  it('FF clears: the screen is black, the shadow array blank, the cursor home', () => {
    rig.surface.setFillColor(BLUE);
    print('HELLO\n\nWORLD');
    rig.surface.drawPixel(300, 300);
    print('\f');
    expect(isBlack(whole())).toBe(true); // black, not the fill colour
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
    expect(cursor()).toEqual({ row: 0, col: 0 });
    expect(rig.text.state).toMatchObject({ textX: 0, textY: 0 });
  });

  it('$00-$06 and $0E-$1F do nothing at all', () => {
    print('AB');
    const before = rig.surface.back.data.slice();
    for (const code of [0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x0e, 0x0f, 0x10, 0x1b, 0x1f]) rig.text.charOut(code);
    expect(cursor()).toEqual({ row: 0, col: 2 });
    expect(rig.surface.back.data).toEqual(before);
    expect(rig.logged).toEqual([0x41, 0x42]);
  });

  it('$7F and $80-$FF are printable: a glyph is drawn, stored, and the cursor advances', () => {
    for (const code of [0x7f, 0x80, 0xe9, 0xff]) rig.text.charOut(code);
    expect(cursor()).toEqual({ row: 0, col: 4 });
    expect([...rig.text.state.text.subarray(0, 5)]).toEqual([0x7f, 0x80, 0xe9, 0xff, 0x20]);
    [0x7f, 0x80, 0xe9, 0xff].forEach((code, col) => expectGlyphAt(col * 8, 0, glyphOf(code)));
    expect(isBlack(cellRect(0, 0, 4))).toBe(false);
  });

  it('only the low byte of the argument counts', () => {
    rig.text.charOut(0x141);
    expect(rowText(rig.text, 0, 1)).toBe('A');
  });

  it('the output log gets every byte except BEL and the ignored control codes', () => {
    print('A\b\t\n\v\r\x07\x01\x1b\f\xe9');
    expect(rig.logged).toEqual([0x41, 0x08, 0x09, 0x0a, 0x0b, 0x0d, 0x0c, 0xe9]);
  });
});

describe('colours (trap15-a §3.3)', () => {
  it('the cell background is the fill colour, the glyph has the font colour', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(RED, 0);
    print('Hi');
    expectChar(0, 0, 'H', RED, BLUE);
    expectChar(0, 1, 'i', RED, BLUE);
    // the corner of the cell is background
    expect(rig.surface.pixel(0, 0)).toBe(BLUE);
    expect(rig.surface.pixel(15, 14)).toBe(BLUE);
    // only the printed cells are painted
    expect(isBlack(cellRect(0, 2, 78))).toBe(true);
    expect(isBlack(cellRect(1, 0, 80, 31))).toBe(true);
  });

  it('text overwrites graphics in its cell and nothing outside it', () => {
    rig.surface.setFillColor(BLUE);
    rig.surface.rectangle(0, 0, 40, 40);
    rig.surface.setFillColor(BLACK);
    rig.text.gotorc(1, 1);
    print('X');
    expectChar(1, 1, 'X');
    expect(rig.surface.pixel(0, 20)).toBe(WHITE); // the rectangle's outline, left of the cell
    expect(rig.surface.pixel(20, 39)).toBe(WHITE); // and below it
    expect(rig.surface.pixel(7, 20)).toBe(BLUE); // its interior right up to the cell
    expect(rig.surface.pixel(16, 20)).toBe(BLUE);
  });

  it('text moves the pen to the end of the cell (trap15-b §5.5)', () => {
    rig.text.gotorc(2, 3);
    print('A');
    expect(rig.surface.state.backPen).toEqual({ x: 32, y: 30 });
    expect(rig.surface.getXY()).toEqual([32, 30]);
  });
});

describe('gotorc (trap15-a §3.5)', () => {
  it('places the cursor and its pixel position', () => {
    rig.text.gotorc(5, 10);
    expect(cursor()).toEqual({ row: 5, col: 10 });
    expect(rig.text.state).toMatchObject({ textX: 80, textY: 75 });
  });

  it('a negative row or column becomes 0', () => {
    rig.text.gotorc(5, -128);
    expect(cursor()).toEqual({ row: 5, col: 0 });
    rig.text.gotorc(-1, 7);
    expect(cursor()).toEqual({ row: 0, col: 7 });
  });

  it('LF on the last row: the screen scrolls one row, the cursor stays on the last row in the same column', () => {
    rig.text.gotorc(31, 7);
    print('Q\n');
    expect(cursor()).toEqual({ row: 31, col: 8 });
    expectChar(30, 7, 'Q'); // moved up one row
    expect(isBlack(cellRect(31, 0, 80))).toBe(true);
    expect(rig.text.getCharAt(30, 7)).toBe(0x51);
    expect(rig.text.getCharAt(31, 7)).toBe(0x20);
  });

  it('VT on row 30 of 32: one scroll, cursor on row 31', () => {
    rig.text.gotorc(30, 0);
    print('Q\v');
    expect(cursor()).toEqual({ row: 31, col: 1 });
    expectChar(29, 0, 'Q'); // one row up, not three
    expect(isBlack(cellRect(30, 0, 80, 2))).toBe(true);
  });

  it('however far down the request is, the screen scrolls once', () => {
    rig.text.gotorc(10, 0);
    print('Q');
    rig.text.gotorc(100, 10);
    expect(cursor()).toEqual({ row: 31, col: 10 });
    expectChar(9, 0, 'Q');
    expect(rig.text.getCharAt(9, 0)).toBe(0x51);
  });

  it('right edge, wrap off: the cursor runs off the canvas, characters there are clipped but stored', () => {
    print('x'.repeat(80) + 'Y');
    expect(cursor()).toEqual({ row: 0, col: 81 });
    expect(rig.text.state.textX).toBe(648);
    expect(rig.text.getrc()).toBe(0x5100);
    for (let col = 0; col < 80; col++) expectChar(0, col, 'x');
    expect(isBlack(cellRect(1, 0, 80, 31))).toBe(true); // nothing on the next row
    // stride aliasing: row 0, column 80 is the same byte as row 1, column 0
    expect(rig.text.getCharAt(1, 0)).toBe(0x59);
    expect(rig.text.state.text[80]).toBe(0x59);
  });

  it('wrap off: the column saturates at 255 while the pixel position follows the uncapped column', () => {
    print('x'.repeat(300));
    expect(cursor()).toEqual({ row: 0, col: 255 });
    expect(rig.text.state.textX).toBe(8 * 256);
    expect(rig.text.getrc()).toBe(0xff00);
    expect(rowText(rig.text, 0, 257)).toBe('x'.repeat(256) + ' ');
  });

  it('wrap on is eager: the 80th character leaves the cursor at column 0 of the next row, the 81st is printed there', () => {
    rig.text.setTextWrap(true);
    print('x'.repeat(80));
    expect(cursor()).toEqual({ row: 1, col: 0 });
    print('Y');
    expectChar(0, 79, 'x');
    expectChar(1, 0, 'Y');
    expect(cursor()).toEqual({ row: 1, col: 1 });
  });

  it('wrap on: printing in the bottom-right cell scrolls the screen at once', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(31, 79);
    print('Z');
    expect(cursor()).toEqual({ row: 31, col: 0 });
    expectChar(30, 79, 'Z');
    expect(isBlack(cellRect(31, 0, 80))).toBe(true);
    expect(rig.text.getCharAt(30, 79)).toBe(0x5a);
  });

  it('wrap on: a tab that passes the right edge ends in column 0 of the next row', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(3, 77);
    print('\t');
    expect(cursor()).toEqual({ row: 4, col: 0 });
  });

  it('wrap on: a column past the right edge ignores the requested row and goes to the row after the current one', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(2, 5);
    rig.text.gotorc(10, 90);
    expect(cursor()).toEqual({ row: 3, col: 0 });
    // ... and a scroll has already been done for the requested row
    print('Q\r');
    rig.text.gotorc(40, 90);
    expect(cursor()).toEqual({ row: 4, col: 0 });
    expectChar(2, 0, 'Q');
  });

  it('wrap on: the automatic CR, LF is written to the output log as one LF', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(0, 78);
    print('ab');
    expect(rig.logged).toEqual([0x61, 0x62, 0x0a]);
  });

  it('a grid higher than 128 rows: the row is capped at 127, the pixel position is not', () => {
    rig.device.setWindowSize(640, 1200);
    rig.text.setFontProperties(WHITE, 0x03030000); // Courier New, 3 points: cells of 2 x 5
    expect(rig.text.state).toMatchObject({ colWidth: 2, rowHeight: 5, textRows: MAX_ROWS, textCols: MAX_COLS });
    rig.text.gotorc(200, 300);
    expect(cursor()).toEqual({ row: 127, col: 255 });
    expect(rig.text.state).toMatchObject({ textX: 600, textY: 1000 });
  });
});

describe('doCRLF, getrc', () => {
  it('doCRLF goes to column 0 of the next row and logs one LF', () => {
    print('AB');
    rig.text.doCRLF();
    expect(cursor()).toEqual({ row: 1, col: 0 });
    expect(rig.logged).toEqual([0x41, 0x42, 0x0a]);
  });

  it('getrc is the column in the high byte and the row in the low byte', () => {
    rig.text.gotorc(5, 10);
    expect(rig.text.getrc()).toBe(0x0a05);
    rig.text.gotorc(31, 200);
    expect(rig.text.getrc()).toBe(0xc81f);
  });
});

describe('scrolling (trap15-a §3.6)', () => {
  it('moves every pixel up one text row, graphics included, and blacks the bottom band', () => {
    rig.surface.line(0, 100, 639, 100);
    rig.surface.setFillColor(BLUE);
    rig.text.gotorc(31, 0);
    print('\n');
    expect(rig.surface.pixel(0, 85)).toBe(WHITE);
    expect(rig.surface.pixel(639, 85)).toBe(WHITE);
    expect(rig.surface.isFilled({ left: 0, top: 100, right: 640, bottom: 101 }, BLACK)).toBe(true);
    // the vacated band is black, not the fill colour
    expect(isBlack({ left: 0, top: 465, right: 640, bottom: 480 })).toBe(true);
  });

  it('shifts the shadow array by one row of textCols bytes and blanks the last row', () => {
    for (let row = 0; row < 32; row++) {
      rig.text.gotorc(row, 0);
      print(String.fromCharCode(0x41 + (row % 26)).repeat(3));
    }
    print('\n');
    expect(rowText(rig.text, 0, 4)).toBe('BBB ');
    expect(rowText(rig.text, 30, 4)).toBe('FFF ');
    expect(rowText(rig.text, 31, 4)).toBe('    ');
  });

  it('when the height is no multiple of the row height the blacked band is lower than the last text row', () => {
    rig.text.setFontProperties(WHITE, 0x020a0000); // Courier 10: cells of 8 x 13, 36 rows, 12 pixels left over
    expect(rig.text.state).toMatchObject({ rowHeight: 13, textRows: 36 });
    rig.surface.drawPixel(5, 479);
    rig.surface.drawPixel(5, 13);
    rig.text.gotorc(36, 0); // past the last full row: scroll
    expect(cursor()).toEqual({ row: 35, col: 0 });
    expect(rig.surface.pixel(5, 0)).toBe(WHITE); // from y = 13
    expect(rig.surface.pixel(5, 466)).toBe(WHITE); // from y = 479
    expect(isBlack({ left: 0, top: 467, right: 640, bottom: 480 })).toBe(true);
  });
});

describe('the shadow array (trap15-a §3.7, task 22)', () => {
  it('getCharAt reads what charOut stored, and a space where nothing was written', () => {
    print('HI');
    expect(rig.text.getCharAt(0, 1)).toBe(0x49);
    expect(rig.text.getCharAt(0, 2)).toBe(0x20);
    expect(rig.text.getCharAt(31, 79)).toBe(0x20);
  });

  it('a row of 128 or more is row 127, a column of 256 or more is column 255', () => {
    rig.text.state.text[127 * 80 + 3] = 0x52;
    rig.text.state.text[2 * 80 + 255] = 0x43;
    expect(rig.text.getCharAt(128, 3)).toBe(0x52);
    expect(rig.text.getCharAt(65535, 3)).toBe(0x52);
    expect(rig.text.getCharAt(2, 256)).toBe(0x43);
    expect(rig.text.getCharAt(2, 40000)).toBe(0x43);
  });

  it('a change of the font changes the stride: text printed before reads back from other coordinates', () => {
    rig.text.gotorc(1, 0);
    print('HELLO');
    expect(rig.text.getCharAt(1, 0)).toBe(0x48);
    rig.text.setFontProperties(WHITE, 0x01120000); // Fixedsys 18: cells of 16 x 30, 40 columns
    expect(rig.text.state.textCols).toBe(40);
    expect(rig.text.getCharAt(1, 0)).toBe(0x20);
    expect(rig.text.getCharAt(2, 0)).toBe(0x48); // byte 80 is now row 2, column 0
    expect(rig.text.getCharAt(2, 4)).toBe(0x4f);
  });

  it('a change of the window size does the same', () => {
    rig.text.gotorc(1, 0);
    print('HELLO');
    rig.device.setWindowSize(800, 600); // 100 columns
    expect(rig.text.getCharAt(0, 80)).toBe(0x48);
    expect(rig.text.getCharAt(1, 0)).toBe(0x20);
  });

  it('clear is the one access with a stride of 256: all 32768 bytes become spaces', () => {
    rig.text.state.text.fill(0x55);
    rig.text.clear();
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
  });
});

describe('scrollRect (trap15-a task 25)', () => {
  /** Rows 2-5 hold "abcdefgh", "ijklmnop", "qrstuvwx", "ABCDEFGH" from column 4 on. */
  function fill(): void {
    ['abcdefgh', 'ijklmnop', 'qrstuvwx', 'ABCDEFGH'].forEach((line, index) => {
      rig.text.gotorc(2 + index, 4);
      print(line);
    });
    rig.text.gotorc(20, 20);
  }
  const lines = () => [2, 3, 4, 5].map((row) => rowText(rig.text, row, 14).slice(3, 13));

  it('up: rows take the row below, the last row of the rectangle is blanked', () => {
    fill();
    rig.surface.setFillColor(BLUE);
    rig.text.scrollRect(2, 5, 3, 4, 0);
    expect(lines()).toEqual([' ajklmfgh ', ' irstunop ', ' q    vwx ', ' ABCDEFGH ']);
    expectChar(2, 5, 'j');
    expectChar(2, 9, 'f'); // outside the rectangle: untouched
    expectChar(3, 8, 'u');
    expect(isBlack(cellRect(4, 5, 4))).toBe(true); // black, not the fill colour
    expectChar(4, 9, 'v');
    expectChar(5, 5, 'B');
    expect(cursor()).toEqual({ row: 20, col: 20 });
  });

  it('down: rows take the row above, the first row is blanked', () => {
    fill();
    rig.text.scrollRect(2, 5, 3, 4, 1);
    expect(lines()).toEqual([' a    fgh ', ' ibcdenop ', ' qjklmvwx ', ' ABCDEFGH ']);
    expect(isBlack(cellRect(2, 5, 4))).toBe(true);
    expectChar(3, 5, 'b');
    expectChar(4, 8, 'm');
    expectChar(5, 5, 'B');
  });

  it('left: columns take the column to the right, the last column is blanked', () => {
    fill();
    rig.text.scrollRect(2, 5, 3, 4, 2);
    expect(lines()).toEqual([' acde fgh ', ' iklm nop ', ' qstu vwx ', ' ABCDEFGH ']);
    expectChar(2, 5, 'c');
    expectChar(4, 7, 'u');
    expect(isBlack(cellRect(2, 8, 1, 3))).toBe(true);
    expectChar(2, 9, 'f');
  });

  it('right: columns take the column to the left, the first column is blanked', () => {
    fill();
    rig.text.scrollRect(2, 5, 3, 4, 3);
    expect(lines()).toEqual([' a bcdfgh ', ' i jklnop ', ' q rstvwx ', ' ABCDEFGH ']);
    expect(isBlack(cellRect(2, 5, 1, 3))).toBe(true);
    expectChar(2, 6, 'b');
    expectChar(4, 8, 't');
    expectChar(2, 9, 'f');
  });

  it('graphics inside the rectangle move with the text', () => {
    rig.surface.drawPixel(44, 33); // in the cell of row 2, column 5
    rig.text.scrollRect(1, 5, 3, 4, 0);
    expect(rig.surface.pixel(44, 18)).toBe(WHITE);
    expect(rig.surface.pixel(44, 33)).toBe(BLACK);
  });

  it('is rejected silently when row + height reaches 128, column + width reaches 256, or a side is 0', () => {
    fill();
    const pixels = rig.surface.back.data.slice();
    const text = rig.text.state.text.slice();
    for (const [r, c, h, w] of [
      [2, 5, 126, 4],
      [2, 5, 3, 251],
      [2, 5, 0, 4],
      [2, 5, 3, 0],
      [127, 0, 1, 1],
      [0, 255, 1, 1],
    ] as const) {
      for (const dir of [0, 1, 2, 3]) rig.text.scrollRect(r, c, h, w, dir);
    }
    expect(rig.surface.back.data).toEqual(pixels);
    expect(rig.text.state.text).toEqual(text);
  });

  it('accepts the largest rectangle, although most of it is outside the visible grid', () => {
    fill();
    rig.text.scrollRect(0, 0, 127, 255, 0);
    // The picture moves up one row.
    expectChar(1, 4, 'a');
    expectChar(4, 11, 'H');
    expect(isBlack(cellRect(5, 0, 80))).toBe(true);
    // The shadow array does not follow it: a rectangle wider than the grid reaches into the bytes
    // of the following rows (stride textCols), so the original's loops move most bytes twice.
    // Row 0 takes row 1; every later row takes the row two below it.
    expect(lines()).toEqual([' qrstuvwx ', ' ABCDEFGH ', '          ', '          ']);
    expect(rowText(rig.text, 1, 14).slice(3, 13)).toBe(' ijklmnop ');
    expect(rowText(rig.text, 0, 14).trim()).toBe('');
  });

  it('a rectangle inside the grid moves the shadow array exactly as it moves the picture', () => {
    fill();
    rig.text.scrollRect(0, 0, 31, 79, 0);
    expect(lines()).toEqual([' ijklmnop ', ' qrstuvwx ', ' ABCDEFGH ', '          ']);
    expectChar(1, 4, 'a');
    expectChar(4, 11, 'H');
  });

  it('any other direction does nothing', () => {
    fill();
    const text = rig.text.state.text.slice();
    rig.text.scrollRect(2, 5, 3, 4, 4);
    rig.text.scrollRect(2, 5, 3, 4, 0xffff);
    expect(rig.text.state.text).toEqual(text);
  });
});

describe('drawText (task 95, trap15-b §6.7)', () => {
  it('draws at a pixel position in the fill and font colours; no cell is stored and the cursor stays', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(RED, 0);
    rig.text.gotorc(3, 3);
    rig.text.drawText(bytesOf('Hi'), 101, 57);
    expectGlyphAt(101, 57, glyphOf('H'), RED, BLUE);
    expectGlyphAt(109, 57, glyphOf('i'), RED, BLUE);
    // exactly two cells: x 101-116, y 57-71
    expect(rig.surface.pixel(100, 57)).toBe(BLACK);
    expect(rig.surface.pixel(117, 57)).toBe(BLACK);
    expect(rig.surface.pixel(101, 56)).toBe(BLACK);
    expect(rig.surface.pixel(101, 72)).toBe(BLACK);
    expect(cursor()).toEqual({ row: 3, col: 3 });
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
    expect(rig.logged).toEqual([]);
    expect(rig.calls.show).toBe(0); // graphics never show the window
  });

  it('moves the pen to the right end of the text', () => {
    rig.text.drawText(bytesOf('ABC'), 10, 20);
    expect(rig.surface.state.backPen).toEqual({ x: 34, y: 20 });
    expect(rig.surface.getXY()).toEqual([34, 20]);
  });

  it("HT, LF, CR and $1C-$1F paint nothing and take no room, but count in the extent: 'A',9,'B',13,10,'C' is ABC in three cells", () => {
    rig.text.drawText(Uint8Array.from([0x41, 9, 0x42, 13, 10, 0x43]), 10, 20);
    expectGlyphAt(10, 20, glyphOf('A'));
    expectGlyphAt(18, 20, glyphOf('B'));
    expectGlyphAt(26, 20, glyphOf('C'));
    expect(isBlack({ left: 34, top: 20, right: 640, bottom: 35 })).toBe(true);
    expect(rig.surface.state.backPen).toEqual({ x: 10 + 6 * 8, y: 20 });
    // the same for $1C-$1F
    rig.text.drawText(Uint8Array.from([0x41, 0x1c, 0x1d, 0x1e, 0x1f, 0x42]), 10, 100);
    expectGlyphAt(10, 100, glyphOf('A'));
    expectGlyphAt(18, 100, glyphOf('B'));
    expect(rig.surface.state.backPen).toEqual({ x: 10 + 6 * 8, y: 100 });
  });

  it('the other control bytes keep their cell: $0C is drawn with the glyph the font has for it', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.drawText(Uint8Array.from([0x41, 0x0c, 0x42, 0x01]), 10, 20);
    expectGlyphAt(10, 20, glyphOf('A'), WHITE, BLUE);
    expectGlyphAt(18, 20, glyphOf(0x0c), WHITE, BLUE);
    expectGlyphAt(26, 20, glyphOf('B'), WHITE, BLUE);
    // $01 is one of the bytes the font set stores empty: a cell of background
    expect(rig.surface.isFilled({ left: 34, top: 20, right: 42, bottom: 35 }, BLUE)).toBe(true);
    expect(rig.surface.state.backPen).toEqual({ x: 42, y: 20 });
  });

  it('a text of zero-width bytes only fills one cell; a single such byte is drawn like any character', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.drawText(Uint8Array.from([13, 10]), 10, 20);
    expect(rig.surface.isFilled({ left: 10, top: 20, right: 18, bottom: 35 }, BLUE)).toBe(true);
    expect(rig.surface.pixel(18, 20)).toBe(BLACK);
    expect(rig.surface.state.backPen).toEqual({ x: 26, y: 20 }); // the pen still moves two cells
    rig.text.drawText(Uint8Array.from([9]), 10, 100);
    expectGlyphAt(10, 100, glyphOf(9), WHITE, BLUE);
    expect(rig.surface.state.backPen).toEqual({ x: 18, y: 100 });
  });

  it('the pen: zero-width bytes count in the extent unless the text has a byte of $80 or above; the style plays no part', () => {
    const penMove = (bytes: number[], y: number) => {
      rig.text.drawText(Uint8Array.from(bytes), 10, y);
      expect(rig.surface.state.backPen.y).toBe(y);
      return rig.surface.state.backPen.x - 10;
    };
    // plain, italic, underline, strike-out: every advance is 8
    for (const [bits, y] of [
      [0, 20],
      [2, 60],
      [4, 100],
      [8, 140],
    ] as const) {
      rig.text.setFontProperties(WHITE, bits);
      expect(penMove([0x41, 9, 0x42], y)).toBe(24); // three advances for two letters
      expect(penMove([0x41, 0x42, 9, 10], y)).toBe(32);
      expect(penMove([0x1c, 0x39], y)).toBe(16);
      expect(penMove([0x41, 0x7f, 13], y)).toBe(24); // $7F is not a byte of $80 or above
      // with a byte of $80 or above the zero-width bytes count nothing, wherever they stand
      expect(penMove([0x41, 13, 0xe9], y)).toBe(16);
      expect(penMove([0x1c, 0xaa, 0x1d, 0x1d], y)).toBe(8);
      expect(penMove([0x41, 10, 0xfc, 0x42, 13, 10], y)).toBe(24);
      expect(penMove([0xe9, 0xc4, 0xfc], y)).toBe(24); // no zero-width byte: nothing to leave out
    }
    // a single zero-width byte is a text of one byte and counts, with or without a high byte around
    rig.text.setFontProperties(WHITE, 4);
    expect(penMove([13], 180)).toBe(8);
  });

  it('an empty text draws nothing and still moves the pen', () => {
    rig.text.drawText(new Uint8Array(0), 33, 44);
    expect(isBlack(whole())).toBe(true);
    expect(rig.surface.state.backPen).toEqual({ x: 33, y: 44 });
  });

  it('is clipped at the edge of the surface; nothing wraps or scrolls', () => {
    rig.text.drawText(bytesOf('ABCD'), 628, 470);
    expect(rig.surface.pixel(630, 474)).toBe(WHITE); // part of the A
    expect(cursor()).toEqual({ row: 0, col: 0 });
  });

  it('with double buffering on, the window pen does not move', () => {
    rig.surface.moveTo(1, 2);
    rig.surface.setDrawingMode(17);
    rig.text.drawText(bytesOf('AB'), 10, 20);
    expect(rig.surface.state.backPen).toEqual({ x: 26, y: 20 });
    expect(rig.surface.getXY()).toEqual([1, 2]);
  });
});

describe('task 21: setFontProperties', () => {
  const style = (bits: number) => {
    rig.text.setFontProperties(WHITE, bits);
    const { bold, italic, underline, strikeOut } = rig.text.state.font;
    return { bold, italic, underline, strikeOut };
  };
  const none = { bold: false, italic: false, underline: false, strikeOut: false };

  it('one style bit sets one style', () => {
    expect(style(0)).toEqual(none);
    expect(style(1)).toEqual({ ...none, bold: true });
    expect(style(2)).toEqual({ ...none, italic: true });
    expect(style(4)).toEqual({ ...none, underline: true });
    expect(style(8)).toEqual({ ...none, strikeOut: true });
  });

  it('the bits do not combine: only the highest one counts', () => {
    expect(style(3)).toEqual({ ...none, italic: true });
    expect(style(5)).toEqual({ ...none, underline: true }); // bold + underline
    expect(style(6)).toEqual({ ...none, underline: true });
    expect(style(9)).toEqual({ ...none, strikeOut: true });
    expect(style(0xf)).toEqual({ ...none, strikeOut: true });
    // bits 4-15 are no style
    expect(style(0xfff0)).toEqual(none);
  });

  it('the style is drawn: a bold, an italic, an underlined and a struck-out H differ from the plain one', () => {
    const pictures = [0, 1, 2, 4, 8].map((bits, index) => {
      rig.text.setFontProperties(WHITE, bits);
      rig.text.gotorc(index * 2, 0);
      print('H');
      expectGlyphAt(0, index * 30, glyphOf('H'));
      return [...glyphOf('H').coverage].join();
    });
    expect(new Set(pictures).size).toBe(5);
  });

  it('bold changes the grid of a raster font: Fixedsys bold is 9 x 15, 71 columns', () => {
    rig.text.setFontProperties(WHITE, 1);
    expect(rig.text.state).toMatchObject({ colWidth: 9, rowHeight: 15, textCols: 71, textRows: 32 });
    print('AB');
    expectGlyphAt(0, 0, glyphOf('A'));
    expectGlyphAt(9, 0, glyphOf('B'));
    expect(glyphOf('A').advance).toBe(9);
    // italic, underline and strike-out keep the cell
    for (const bits of [2, 4, 8]) {
      rig.text.setFontProperties(WHITE, bits);
      expect(rig.text.state).toMatchObject({ colWidth: 8, rowHeight: 15, textCols: 80 });
    }
  });

  it('the colour is D1.L as $00BBGGRR', () => {
    rig.text.setFontProperties(0x00123456, 0);
    expect(rig.text.state.fontColor).toBe(0x123456);
    print('A');
    expectChar(0, 0, 'A', 0x123456);
  });

  // Measured on Windows with the calls the original makes (docs/porting/errata/SH3.md entry 17):
  // text takes the colour rule of pens and fills (trap15-b §4.6).
  it.each([
    ['$01000005: entry 5 of the stock palette', 0x01000005, 0x800080],
    ['$0100000D: entry 13', 0x0100000d, 0x0000ff],
    ['$01000014: an entry from 20 on is black', 0x01000014, 0x000000],
    ['$0100FF05: the low 16 bits select the entry', 0x0100ff05, 0x000000],
    ['$7F000007: any odd top byte is a palette entry', 0x7f000007, 0xc0c0c0],
    ['$02336699: an even top byte is plain RGB', 0x02336699, 0x336699],
    ['$80000005: system colour 5, white', 0x80000005, 0xffffff],
    ['$8000000F: system colour 15', 0x8000000f, 0xf0f0f0],
    ['$FF336699: bit 31 with an index above 30 is black', 0xff336699, 0x000000],
  ])('a colour with a top byte that is not zero - %s', (_name, given, drawn) => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(given | 0, 0); // a signed number, as a 68000 register value may arrive
    expect(rig.text.state.fontColor).toBe(given); // kept as given, unsigned
    print('A');
    expectChar(0, 0, 'A', drawn, BLUE);
    rig.text.drawText(bytesOf('B'), 100, 100);
    expectGlyphAt(100, 100, glyphOf('B'), drawn, BLUE);
    // the prompt (its first tick outside an input task draws the underscore) and the Options colour
    // take the same path
    rig.text.promptTick();
    expect(rig.surface.overlay?.pixels).toContain((0xff000000 | drawn) >>> 0);
    rig.text.setOptionsFont(DEFAULT_OPTIONS_FONT, given);
    expect(rig.text.state).toMatchObject({ optionsFontColor: given, fontColor: given });
  });

  it('font numbers 1-7 select the names as the original spells them, with the size byte', () => {
    const selected = [1, 2, 3, 4, 5, 6, 7].map((number) => {
      rig.text.setFontProperties(WHITE, ((number << 8) | 12) << 16);
      const { font, colWidth, rowHeight, textCols, textRows } = rig.text.state;
      return `${font.name} ${font.size}: ${colWidth}x${rowHeight}, ${textCols}x${textRows}`;
    });
    expect(selected).toEqual([
      'Fixedsys 12: 8x15, 80x32',
      'Courier 12: 9x16, 71x30',
      'Courier New 12: 10x18, 64x26',
      'Lucida Console 12: 10x16, 64x30',
      'Lucida Sans Typerwriter 12: 15x18, 42x26',
      'Consolas 12: 9x19, 71x25',
      'Terminal 12: 15x18, 42x26',
    ]);
    expect(TASK21_FONT_NAMES[5]).toBe('Lucida Sans Typerwriter'); // misspelt in the source
  });

  it('the two names that resolve to a proportional face: wide cells, narrow letters', () => {
    for (const number of [5, 7]) {
      rig.text.clear();
      rig.text.setFontProperties(WHITE, ((number << 8) | 12) << 16);
      print('Wii');
      // every character stands at colWidth * column, whatever its own width
      expect(cursor()).toEqual({ row: 0, col: 3 });
      expect(rig.text.state.textX).toBe(45);
      expectGlyphAt(0, 0, glyphOf('W'));
      expectGlyphAt(15, 0, glyphOf('i'));
      expectGlyphAt(30, 0, glyphOf('i'));
      expect(glyphOf('i').advance).toBe(10);
      // the cell of an i is only as wide as the i: the rest of the grid cell is not painted
      rig.surface.setFillColor(BLUE);
      rig.text.gotorc(1, 0);
      print('i');
      expect(rig.surface.isFilled({ left: 10, top: 18, right: 15, bottom: 36 }, BLACK)).toBe(true);
      expect(rig.surface.pixel(0, 18)).toBe(BLUE);
      // the pen ends after the letter, not after the grid cell
      expect(rig.surface.state.backPen).toEqual({ x: 10, y: 18 });
      rig.surface.setFillColor(BLACK);
    }
  });

  it('any other font number keeps the name of the Options font but still sets the size', () => {
    rig.text.setFontProperties(WHITE, 0x08120000);
    expect(rig.text.state.font).toMatchObject({ name: 'Fixedsys', size: 18 });
    expect(rig.text.state).toMatchObject({ colWidth: 16, rowHeight: 30, textCols: 40, textRows: 16 });
    rig.text.setFontProperties(WHITE, 0x000c0000); // font number 0, size 12
    expect(rig.text.state.font).toMatchObject({ name: 'Fixedsys', size: 12 });
    rig.text.setFontProperties(WHITE, 0xff090000 | 0);
    expect(rig.text.state.font).toMatchObject({ name: 'Fixedsys', size: 9 });
  });

  it('a font number sets the size byte even when it is 0', () => {
    rig.text.setFontProperties(WHITE, 0x03000000);
    expect(rig.text.state.font).toMatchObject({ name: 'Courier New', size: 0 });
    // the cell the metric table gives for size 0
    expect(rig.text.state).toMatchObject({ colWidth: 10, rowHeight: 18 });
    print('A');
    expectChar(0, 0, 'A');
  });

  it('a size outside the atlas sizes is drawn resampled to the measured cell', () => {
    rig.text.setFontProperties(WHITE, 0x03140000); // Courier New 20
    expect(rig.text.state).toMatchObject({ colWidth: 16, rowHeight: 31, textCols: 40, textRows: 15 });
    print('AB');
    const glyph = glyphOf('A');
    expect(glyph).toMatchObject({ advance: 16, height: 31 });
    expectGlyphAt(0, 0, glyph);
    expectGlyphAt(16, 0, glyphOf('B'));
    expect(isBlack({ left: 0, top: 31, right: 640, bottom: 480 })).toBe(true);
    expect(rig.surface.state.backPen).toEqual({ x: 32, y: 0 });
  });

  it('a high word of 0 goes back to the Options font: a colour-only call undoes name and size', () => {
    rig.text.setFontProperties(WHITE, 0x03120000);
    expect(rig.text.state.font).toMatchObject({ name: 'Courier New', size: 18 });
    rig.text.setFontProperties(RED, 2);
    expect(rig.text.state.font).toEqual({ ...DEFAULT_OPTIONS_FONT, italic: true });
    expect(rig.text.state).toMatchObject({ colWidth: 8, rowHeight: 15, fontColor: RED });
  });

  it('starts from the Options font: its name and size, but not its style', () => {
    rig.text.setOptionsFont({ ...DEFAULT_OPTIONS_FONT, name: 'Consolas', size: 14, italic: true }, WHITE);
    rig.text.setFontProperties(WHITE, 0);
    expect(rig.text.state.font).toEqual({ ...DEFAULT_OPTIONS_FONT, name: 'Consolas', size: 14 });
    rig.text.setFontProperties(WHITE, 0x02000000 | (10 << 16)); // font 2 keeps nothing of Consolas
    expect(rig.text.state.font).toMatchObject({ name: 'Courier', size: 10 });
    // the Options font itself is untouched
    expect(rig.text.state.optionsFont).toEqual({ ...DEFAULT_OPTIONS_FONT, name: 'Consolas', size: 14, italic: true });
  });

  it('the cursor keeps its row and column numbers; its pixel position follows the new cell', () => {
    rig.text.gotorc(5, 10);
    rig.text.setFontProperties(WHITE, 0x03120000); // 14 x 27
    expect(cursor()).toEqual({ row: 5, col: 10 });
    expect(rig.text.state).toMatchObject({ textX: 140, textY: 135 });
  });

  it('scrolls once when the row no longer fits', () => {
    rig.text.gotorc(31, 2);
    print('Q');
    rig.text.setFontProperties(WHITE, 0x01120000); // 16 x 30: 16 rows
    expect(cursor()).toEqual({ row: 15, col: 3 });
    expect(rig.text.state).toMatchObject({ textX: 48, textY: 450 });
    // the picture moved up one row of the new height; what was printed is not drawn again
    expectGlyphAt(16, 465 - 30, glyphOf('Q', DEFAULT_OPTIONS_FONT));
  });

  it('does not redraw existing pixels or lay the shadow array out again', () => {
    print('AB');
    const before = rig.surface.back.data.slice();
    rig.text.setFontProperties(RED, 0x03120002);
    expect(rig.surface.back.data).toEqual(before);
    expect(rowText(rig.text, 0, 3)).toBe('AB ');
  });
});

describe('the opaque box of a bold or italic raster font (measured: tests/oracle/gdi-capture)', () => {
  /** Width of the run of fill-coloured or inked pixels that starts at (x, y): the box of a text drawn there. */
  const boxWidth = (x: number, y: number) => {
    let width = 0;
    while (x + width < 640 && rig.surface.pixel(x + width, y) !== BLACK) width++;
    return width;
  };

  it('bold: the box is one pixel wider than the advances; the pen moves by the advances', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(WHITE, 1);
    rig.text.gotorc(1, 2);
    print('A');
    expectGlyphAt(18, 15, glyphOf('A'), WHITE, BLUE);
    expect(boxWidth(18, 15)).toBe(9 + 1);
    expect(rig.surface.state.backPen).toEqual({ x: 27, y: 15 });
    rig.text.drawText(bytesOf('AB'), 100, 200);
    expect(boxWidth(100, 200)).toBe(18 + 1);
    expect(rig.surface.state.backPen).toEqual({ x: 118, y: 200 });
  });

  it('italic: the box is wider by half the cell height, floor((15 - 1) / 2) = 7 for the default font', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(WHITE, 2);
    expect(rig.text.state).toMatchObject({ colWidth: 8, rowHeight: 15 });
    rig.text.gotorc(1, 2);
    print('H');
    expect(boxWidth(16, 29)).toBe(8 + 7); // the bottom row of the cell: fill colour all the way
    expect(rig.surface.state.backPen).toEqual({ x: 24, y: 15 });
    // the top of the H leans out of its cell, into the overhang
    const glyph = glyphOf('H');
    expect(glyph.width).toBeGreaterThan(glyph.advance);
    // The next character's box takes the place of that overhang.
    print('H');
    expectGlyphAt(
      16,
      15,
      { ...glyph, width: 8, coverage: glyph.coverage.filter((_, i) => i % glyph.width < 8) },
      WHITE,
      BLUE,
    );
    expect(boxWidth(16, 29)).toBe(16 + 7);
    // in a text the overhang comes once, after the last character
    rig.text.drawText(bytesOf('HHH'), 100, 200);
    expect(boxWidth(100, 214)).toBe(24 + 7);
  });

  /** Draws a text at (100, y) and returns the width of its box, measured in the bottom row of the cell. */
  const boxOf = (bytes: number[], y: number) => {
    rig.text.drawText(Uint8Array.from(bytes), 100, y);
    return boxWidth(100, y + rig.text.state.rowHeight - 1);
  };

  it('italic: no overhang when two or more bytes are drawn and the text has a zero-width byte, or $7F beside another byte', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(WHITE, 2);
    expect(boxOf([0x4c, 9, 0x4c], 20)).toBe(16); // L, HT, L
    expect(boxOf([0x4c, 0x4c, 13, 10], 50)).toBe(16); // a trailing zero-width byte counts for this as well
    expect(boxOf([0x1c, 0x4c, 0x1f, 0x4c], 80)).toBe(16);
    expect(boxOf([0x4c, 0x7f], 110)).toBe(16);
    expect(boxOf([0x4c, 0x7f, 0x4c], 140)).toBe(24);
    // the overhang stays when only one byte is drawn, and when $7F is the only byte there is
    expect(boxOf([0x4c, 13], 170)).toBe(8 + 7);
    expect(boxOf([0x1c, 0x39], 200)).toBe(8 + 7);
    expect(boxOf([0x7f, 0x7f], 230)).toBe(16 + 7);
    // bold keeps its pixel in every case
    rig.text.setFontProperties(WHITE, 1);
    expect(boxOf([0x4c, 9, 0x4c], 260)).toBe(18 + 1);
    expect(boxOf([0x4c, 0x7f], 290)).toBe(18 + 1);
  });

  it('a text of zero-width bytes only fills the cell of its first byte plus the overhang', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(WHITE, 1); // bold: cells of 9, overhang 1
    expect(boxOf([10], 20)).toBe(9 + 1);
    expect(boxOf([13, 13, 30, 31], 50)).toBe(9 + 1);
    expect(rig.surface.state.backPen).toEqual({ x: 100 + 4 * 9, y: 50 }); // the pen moves by all four
    rig.text.setFontProperties(WHITE, 2); // italic: overhang 7
    expect(boxOf([13, 10], 80)).toBe(8 + 7);
    expect(boxOf([13], 110)).toBe(8 + 7);
    rig.text.setFontProperties(WHITE, 0);
    expect(boxOf([13, 10], 140)).toBe(8);
  });

  it('italic, overhang left out: the first glyph keeps its own where it reaches past the advances (a narrow, tall font)', () => {
    // Fixedsys at 72 points is such a font on Windows (cell 40 x 90, overhang 44): "A", CR, "B" fills
    // 84 pixels, not 80. Here: cells of 4 x 21 with an overhang of 10.
    const blank = (advance: number): Glyph => ({
      advance,
      width: advance,
      height: 21,
      coverage: new Uint8Array(advance * 21),
    });
    const tall: GlyphProvider = {
      ready: Promise.resolve(),
      metrics: () => ({ colWidth: 4, rowHeight: 21 }),
      glyph: () => blank(4),
      textOverhang: (font) => (font.italic ? 10 : 0),
    };
    const narrow = createTextRig({ glyphs: tall });
    const width = (bytes: number[], y: number) => {
      narrow.text.drawText(Uint8Array.from(bytes), 100, y);
      let run = 0;
      while (narrow.surface.pixel(100 + run, y + 20) !== BLACK) run++;
      return run;
    };
    narrow.surface.setFillColor(BLUE);
    narrow.text.setFontProperties(WHITE, 2);
    expect(width([0x41, 0x42], 20)).toBe(8 + 10); // nothing left out
    expect(width([0x41, 13, 0x42], 50)).toBe(4 + 10); // first advance + overhang beats the 8 of the advances
    expect(width([0x41, 13, 0x42, 0x43, 0x44], 80)).toBe(16); // four advances beat it
    expect(width([0x41, 0x7f], 110)).toBe(4 + 10);
  });

  it('the prompt cell has the overhang too; an outline font and a plain raster font have none', () => {
    rig.text.setFontProperties(WHITE, 1);
    rig.text.promptTick();
    expect(rig.surface.overlay).toMatchObject({ width: 10, height: 15 });
    rig.text.setFontProperties(WHITE, 0);
    rig.text.promptTick();
    expect(rig.surface.overlay).toMatchObject({ width: 8, height: 15 });
    rig.text.setFontProperties(WHITE, 0x030a0002); // Courier New 10 italic
    rig.text.promptTick();
    expect(rig.surface.overlay).toMatchObject({ width: 8, height: 16 });
  });

  it('a provider that knows no overhang (the contract has no such method) gives plain boxes', () => {
    const fonts = syntheticFonts();
    const plain = createTextRig({
      glyphs: {
        ready: Promise.resolve(),
        metrics: (font) => fonts.metrics(font),
        glyph: (font, ch) => fonts.glyph(font, ch),
      },
    });
    plain.surface.setFillColor(BLUE);
    plain.text.setFontProperties(WHITE, 1);
    plain.text.charOut(0x41);
    expect(plain.surface.pixel(8, 0)).not.toBe(BLACK);
    expect(plain.surface.pixel(9, 0)).toBe(BLACK);
  });
});

describe('the Options font and the reset', () => {
  const courierNew18: FontSpec = { ...DEFAULT_OPTIONS_FONT, name: 'Courier New', size: 18 };

  it('setOptionsFont measures the cell again but leaves the cursor at the pixel position of the old cell', () => {
    rig.text.gotorc(2, 3);
    rig.text.setOptionsFont(courierNew18, RED);
    expect(rig.text.state).toMatchObject({
      colWidth: 14,
      rowHeight: 27,
      textCols: 45,
      textRows: 17,
      font: courierNew18,
      fontColor: RED,
      optionsFont: courierNew18,
      optionsFontColor: RED,
      textX: 24, // 3 * 8: not placed again
      textY: 30,
    });
    // the first character afterwards is drawn at the old pixel position, the next at the new one
    print('AB');
    expectGlyphAt(24, 30, glyphOf('A'), RED);
    expectGlyphAt(56, 54, glyphOf('B'), RED);
    expect(cursor()).toEqual({ row: 2, col: 5 });
  });

  it('the Options font keeps a copy: changing the object afterwards changes nothing', () => {
    const mine = { ...courierNew18 };
    rig.text.setOptionsFont(mine, WHITE);
    mine.name = 'Consolas';
    expect(rig.text.state.optionsFont.name).toBe('Courier New');
    expect(rig.text.state.font.name).toBe('Courier New');
  });

  it('fontAssign from the Options dialog to the back buffer or the window restores font, colour and cell', () => {
    rig.text.setOptionsFont(courierNew18, 0x00ff00);
    for (const target of [FontTarget.IoBackBuffer, FontTarget.IoWindow]) {
      rig.text.setFontProperties(RED, 0x01090002);
      expect(rig.text.state).toMatchObject({ colWidth: 8, rowHeight: 15, fontColor: RED });
      rig.text.fontAssign(target, FontSource.IoDialog);
      expect(rig.text.state).toMatchObject({
        font: courierNew18,
        fontColor: 0x00ff00,
        colWidth: 14,
        rowHeight: 27,
        textCols: 45,
      });
    }
  });

  it('fontAssign ignores the other targets and sources', () => {
    rig.text.setFontProperties(RED, 0x03120001);
    const before = { ...rig.text.state.font };
    for (const target of [FontTarget.Listing, FontTarget.Headings, FontTarget.Messages, FontTarget.Printer, 0, 7]) {
      rig.text.fontAssign(target, FontSource.IoDialog);
    }
    rig.text.fontAssign(FontTarget.IoWindow, FontSource.ListingDialog);
    rig.text.fontAssign(FontTarget.IoBackBuffer, FontSource.PrinterDialog);
    expect(rig.text.state.font).toEqual(before);
    expect(rig.text.state.fontColor).toBe(RED);
  });

  it('a size change measures the grid again and does not move the cursor', () => {
    rig.text.gotorc(31, 79);
    print('\b');
    rig.device.setWindowSize(800, 600);
    expect(rig.text.state).toMatchObject({ textCols: 100, textRows: 40, row: 31, col: 78, textX: 624, textY: 465 });
    rig.device.setWindowSize(640, 480);
    expect(rig.text.state).toMatchObject({ textCols: 80, textRows: 32, row: 31, col: 78 });
  });

  it('resetToStartup: cursor home, shadow array blank, wrap off, the default Options font, prompt off', () => {
    rig.text.setOptionsFont(courierNew18, RED);
    rig.text.setTextWrap(true);
    rig.text.gotorc(3, 4);
    print('X');
    rig.text.inputPrompt(2);
    const state = rig.text.state;
    rig.text.resetToStartup();
    expect(rig.text.state).toBe(state); // the same object: holders of the state stay valid
    expect(rig.text.state).toMatchObject({
      row: 0,
      col: 0,
      textX: 0,
      textY: 0,
      colWidth: 8,
      rowHeight: 15,
      textRows: 32,
      textCols: 80,
      textWrap: false,
      optionsFont: DEFAULT_OPTIONS_FONT,
      optionsFontColor: WHITE,
      font: DEFAULT_OPTIONS_FONT,
      fontColor: WHITE,
      promptEnabled: false,
      promptVisible: false,
    });
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
    expect(rig.scheduler.pending).toBe(0);
  });
});

describe('textOut, textOutCR', () => {
  it('textOut prints the bytes and leaves the cursor after the last one', () => {
    rig.text.textOut(bytesOf('AB'));
    expect(cursor()).toEqual({ row: 0, col: 2 });
    expect(rowText(rig.text, 0, 3)).toBe('AB ');
  });

  it('textOutCR ends with CR, LF, also for an empty text', () => {
    rig.text.textOutCR(bytesOf('ABC'));
    expect(cursor()).toEqual({ row: 1, col: 0 });
    rig.text.gotorc(1, 9);
    rig.text.textOutCR(new Uint8Array(0));
    expect(cursor()).toEqual({ row: 2, col: 0 });
  });

  it('control characters in the text are interpreted', () => {
    rig.text.textOut(bytesOf('AB\r\nC\tD'));
    expect(rowText(rig.text, 0, 3)).toBe('AB ');
    expect(rowText(rig.text, 1, 8)).toBe('C     D ');
    expect(cursor()).toEqual({ row: 1, col: 7 });
  });

  it('the output log of task 13 with AB is 41 42 0A, and CR, LF as characters are 0D 0A', () => {
    rig.text.textOutCR(bytesOf('AB'));
    expect(rig.logged).toEqual([0x41, 0x42, 0x0a]);
    rig.logged.length = 0;
    print('\r\n\x07');
    expect(rig.logged).toEqual([0x0d, 0x0a]);
  });
});

describe('the prompt (3.5.3, trap15-a §3.8)', () => {
  const overlay = () => rig.surface.overlay;
  /** What the overlay shows: '_' for the underscore, ' ' for the blank, null for none. */
  function overlayShows(): '_' | ' ' | null {
    const cell = overlay();
    if (!cell) return null;
    const fill = rig.surface.state.fillColor;
    const picture = (glyph: Glyph) =>
      Array.from(glyph.coverage, (coverage) => blend(fill, rig.text.state.fontColor, coverage)).join();
    const shown = Array.from(cell.pixels, (pixel) => pixel & 0xffffff).join();
    if (shown === picture(glyphOf('_'))) return '_';
    if (shown === picture(glyphOf(' '))) return ' ';
    throw new Error('the overlay shows neither the underscore nor the blank');
  }

  it('nothing is drawn when the timer starts; the underscore first shows after 1000 ms, then 500 on, 500 off', () => {
    rig.text.gotorc(2, 3);
    rig.text.inputPrompt(2);
    expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: true });
    expect(overlayShows()).toBeNull();
    const seen: string[] = [];
    for (let ms = 100; ms <= 3000; ms += 100) {
      rig.scheduler.advance(100);
      seen.push(`${ms}:${overlayShows() ?? '-'}`);
    }
    expect(seen.join(' ')).toBe(
      '100:- 200:- 300:- 400:- 500:  600:  700:  800:  900:  ' +
        '1000:_ 1100:_ 1200:_ 1300:_ 1400:_ 1500:  1600:  1700:  1800:  1900:  ' +
        '2000:_ 2100:_ 2200:_ 2300:_ 2400:_ 2500:  2600:  2700:  2800:  2900:  3000:_',
    );
  });

  it('exactly at the periods: not at 499 ms, at 500; not at 999, at 1000', () => {
    rig.text.inputPrompt(2);
    rig.scheduler.advance(499);
    expect(overlayShows()).toBeNull();
    rig.scheduler.advance(1);
    expect(overlayShows()).toBe(' ');
    expect(rig.text.state.promptVisible).toBe(false);
    rig.scheduler.advance(499);
    expect(overlayShows()).toBe(' ');
    rig.scheduler.advance(1);
    expect(overlayShows()).toBe('_');
    expect(rig.text.state.promptVisible).toBe(true);
  });

  it('the prompt cell is at the cursor, one cell large, in the font colour on the fill colour', () => {
    rig.surface.setFillColor(BLUE);
    rig.text.setFontProperties(RED, 0);
    rig.text.gotorc(2, 3);
    rig.text.inputPrompt(2);
    rig.scheduler.advance(1000);
    expect(overlay()).toMatchObject({ x: 24, y: 30, width: 8, height: 15 });
    expect(overlayShows()).toBe('_');
    expect(rig.surface.visible(24, 30)).toBe(BLUE);
    // the underscore is ink somewhere in the cell
    const ink = [];
    for (let y = 30; y < 45; y++) for (let x = 24; x < 32; x++) if (rig.surface.visible(x, y) === RED) ink.push([x, y]);
    expect(ink.length).toBeGreaterThan(0);
  });

  it('is drawn over the presented image only: the back buffer and its pen stay as they are', () => {
    print('HELLO');
    rig.text.gotorc(0, 0);
    const before = rig.surface.back.data.slice();
    const backPen = { ...rig.surface.state.backPen };
    rig.text.inputPrompt(2);
    rig.scheduler.advance(1000);
    expect(overlayShows()).toBe('_');
    expect(rig.surface.back.data).toEqual(before);
    expect(rig.surface.state.backPen).toEqual(backPen);
    expect(rig.surface.getPixel(2, 5)).toBe(rig.surface.pixel(2, 5)); // task 83 never sees the prompt
    // the window pen moves to the end of the prompt cell (trap15-b §5.5)
    expect(rig.surface.getXY()).toEqual([8, 0]);
    expect(rig.text.state.text[0]).toBe(0x48);
  });

  it('does nothing while double buffering is on: nothing is drawn and the blink state stays', () => {
    rig.surface.setDrawingMode(17);
    rig.surface.moveTo(7, 9);
    rig.text.inputPrompt(2);
    rig.scheduler.advance(3000);
    expect(overlayShows()).toBeNull();
    expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: true });
    expect(rig.surface.getXY()).toEqual([7, 9]);
    // and blinks on once buffering is off
    rig.surface.setDrawingMode(16);
    rig.scheduler.advance(500);
    expect(overlayShows()).toBe(' ');
  });

  it('erasePrompt stops the timer and draws the blank, also while double buffering is on', () => {
    print('HELLO');
    rig.text.gotorc(0, 0);
    rig.surface.setDrawingMode(17);
    rig.text.inputPrompt(2);
    rig.text.erasePrompt();
    expect(rig.text.state.promptEnabled).toBe(false);
    expect(rig.scheduler.pending).toBe(0);
    expect(overlayShows()).toBe(' ');
    expect(overlay()).toMatchObject({ x: 0, y: 0, width: 8, height: 15 });
    // the H is blanked on screen but still in the back buffer and in the shadow array
    expect(rig.surface.visible(1, 7)).toBe(BLACK);
    expect(rig.surface.pixel(1, 7)).toBe(WHITE);
    expect(rig.text.getCharAt(0, 0)).toBe(0x48);
    expect(rig.surface.getXY()).toEqual([8, 0]); // the window pen moved, the back-buffer pen did not
    rig.scheduler.advance(2000);
    expect(overlayShows()).toBe(' ');
  });

  it('the blank stays until the window is repainted from the back buffer, for example by the next textOut', () => {
    print('HELLO');
    rig.text.gotorc(0, 0);
    rig.text.inputPrompt(2);
    rig.text.erasePrompt();
    rig.text.doCRLF(); // the Enter that ends an input draws nothing
    expect(overlayShows()).toBe(' ');
    expect(rig.surface.visible(1, 7)).toBe(BLACK);
    rig.text.textOut(new Uint8Array(0)); // "this->Repaint()"
    expect(overlayShows()).toBeNull();
    expect(rig.surface.visible(1, 7)).toBe(WHITE); // the H is back
  });

  it('a typed character stops the timer and starts a full period without changing the blink state', () => {
    rig.text.inputPrompt(2);
    rig.scheduler.advance(1200); // the underscore shows since 1000
    expect(rig.text.state.promptVisible).toBe(true);
    // what the engine does for one typed character
    rig.text.inputPrompt(0);
    rig.text.inputEcho(0x61, true);
    rig.text.inputPrompt(1);
    expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: true, col: 1 });
    expect(overlayShows()).toBeNull(); // the repaint after the echo removed it
    rig.scheduler.advance(499); // 1699: the old period would have ticked at 1500
    expect(overlayShows()).toBeNull();
    rig.scheduler.advance(1); // 1700
    expect(overlayShows()).toBe(' ');
    expect(overlay()).toMatchObject({ x: 8, y: 0 }); // at the new cursor position
    rig.scheduler.advance(500);
    expect(overlayShows()).toBe('_');
  });

  it('switching the timer on while it is on does not restart the period', () => {
    rig.text.inputPrompt(2);
    rig.scheduler.advance(400);
    rig.text.inputPrompt(1);
    rig.text.inputPrompt(2);
    rig.scheduler.advance(100);
    expect(overlayShows()).toBe(' ');
    expect(rig.scheduler.pending).toBe(1);
  });

  it('mode 1 leaves the blink state as it is, mode 2 sets it to visible, mode 0 switches the timer off', () => {
    rig.text.inputPrompt(1);
    expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: false });
    rig.scheduler.advance(500);
    expect(overlayShows()).toBe('_'); // "not visible" at the first tick: the underscore comes first
    rig.text.inputPrompt(2);
    expect(rig.text.state.promptVisible).toBe(true);
    rig.text.inputPrompt(0);
    expect(rig.text.state.promptEnabled).toBe(false);
    rig.scheduler.advance(5000);
    expect(rig.scheduler.pending).toBe(0);
  });

  it('the prompt is drawn at colWidth * column: after a font change without a cursor move that is not the text position', () => {
    rig.text.gotorc(2, 3);
    rig.text.setOptionsFont({ ...DEFAULT_OPTIONS_FONT, name: 'Courier New', size: 18 }, WHITE);
    rig.text.promptTick();
    expect(overlay()).toMatchObject({ x: 3 * 14, y: 30, width: 14, height: 27 });
  });

  it('promptTick can be called directly: it toggles between the underscore and the blank', () => {
    rig.text.promptTick();
    expect(overlayShows()).toBe('_');
    rig.text.promptTick();
    expect(overlayShows()).toBe(' ');
  });
});

describe('typed characters during line input (trap15-a §3.9)', () => {
  it('an echoed character is drawn and logged, but not stored in the shadow array', () => {
    rig.text.gotorc(1, 2);
    rig.text.inputEcho(0x61, true);
    expectChar(1, 2, 'a');
    expect(cursor()).toEqual({ row: 1, col: 3 });
    expect(rig.text.getCharAt(1, 2)).toBe(0x20);
    expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
    expect(rig.logged).toEqual([0x61]);
  });

  it('with echo off nothing is drawn or logged, but the cursor still advances', () => {
    rig.text.inputEcho(0x61, false);
    expect(isBlack(whole())).toBe(true);
    expect(cursor()).toEqual({ row: 0, col: 1 });
    expect(rig.logged).toEqual([]);
  });

  it('a control code is echoed as a glyph of the font: one column, no control handling', () => {
    rig.text.inputEcho(0x09, true);
    expect(cursor()).toEqual({ row: 0, col: 1 });
    expectGlyphAt(0, 0, glyphOf(0x09));
    rig.text.inputEcho(0x0c, true); // would clear the screen through charOut
    expect(cursor()).toEqual({ row: 0, col: 2 });
    expectGlyphAt(0, 0, glyphOf(0x09));
    expect(rig.logged).toEqual([0x09, 0x0c]);
  });

  it('the window is repainted after every typed character, with or without echo', () => {
    rig.text.inputPrompt(2);
    rig.scheduler.advance(1000);
    expect(rig.surface.overlay).not.toBeNull();
    rig.text.inputEcho(0x61, false);
    expect(rig.surface.overlay).toBeNull();
    // with double buffering on, the echo reaches the window through that repaint
    rig.surface.setDrawingMode(17);
    rig.text.inputEcho(0x62, true);
    expect(rig.surface.visible(9, 9)).toBe(rig.surface.pixel(9, 9));
    expect((rig.surface.window as { data: Uint32Array }).data).toEqual(rig.surface.back.data);
  });

  it('a backspace moves one column back and, with echo, draws a blank in the fill colour over the character', () => {
    rig.text.inputEcho(0x61, true);
    rig.text.inputEcho(0x62, true);
    rig.surface.setFillColor(BLUE);
    rig.text.inputBackspace(true);
    expect(cursor()).toEqual({ row: 0, col: 1 });
    expectChar(0, 0, 'a');
    expect(rig.surface.isFilled(cellRect(0, 1), BLUE)).toBe(true);
    expect(rig.logged).toEqual([0x61, 0x62]); // the log keeps what was typed
  });

  it('with echo off a backspace only moves the cursor', () => {
    print('AB');
    rig.text.inputBackspace(false);
    expect(cursor()).toEqual({ row: 0, col: 1 });
    expectChar(0, 1, 'B');
  });

  it('a backspace in column 0 stays there and blanks that cell', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(3, 0);
    print('A\r');
    rig.text.inputBackspace(true);
    expect(cursor()).toEqual({ row: 3, col: 0 });
    expect(isBlack(cellRect(3, 0))).toBe(true);
    expect(rig.text.getCharAt(3, 0)).toBe(0x41); // the shadow array is not changed
  });

  it('typing in the last column with wrap on moves to the next row and logs the LF', () => {
    rig.text.setTextWrap(true);
    rig.text.gotorc(0, 79);
    rig.text.inputEcho(0x61, true);
    expect(cursor()).toEqual({ row: 1, col: 0 });
    expect(rig.logged).toEqual([0x61, 0x0a]);
  });

  it('the output log of abX, Backspace, c, Enter typed into task 2 is 61 62 58 63 0A', () => {
    for (const ch of [0x61, 0x62, 0x58]) rig.text.inputEcho(ch, true);
    rig.text.inputBackspace(true);
    rig.text.inputEcho(0x63, true);
    rig.text.doCRLF();
    expect(rig.logged).toEqual([0x61, 0x62, 0x58, 0x63, 0x0a]);
  });
});

describe('with fonts that are still loading (3.3.2: host calls arrive before any file is in memory)', () => {
  it('uses the default grid and empty cells first, and the measured grid from the next reset on', async () => {
    const glyphs = new AtlasGlyphProvider(memoryFontLoader(createSyntheticFontFiles({ outlineSizes: [18] })));
    const loading = createTextRig({ glyphs });
    loading.text.setOptionsFont({ ...DEFAULT_OPTIONS_FONT, name: 'Courier New', size: 18 }, WHITE);
    // nothing is loaded yet: the cell of the default font, and characters that leave no ink
    expect(loading.text.state).toMatchObject({ colWidth: 8, rowHeight: 15, textCols: 80, textRows: 32 });
    loading.text.textOut(bytesOf('AB'));
    expect(loading.text.state).toMatchObject({ row: 0, col: 2 });
    expect(loading.surface.isFilled({ left: 0, top: 0, right: 640, bottom: 480 }, BLACK)).toBe(true);
    expect(rowText(loading.text, 0, 3)).toBe('AB ');

    await glyphs.ready; // the controller awaits this before the first load (4.7 step 5)
    // the reset of a load: clear, setWindowSize(0, 0), the font assignments
    loading.device.clear();
    loading.device.setWindowSize(0, 0);
    loading.text.fontAssign(FontTarget.IoBackBuffer, FontSource.IoDialog);
    expect(loading.text.state).toMatchObject({ colWidth: 14, rowHeight: 27, textCols: 45, textRows: 17 });
    loading.text.textOut(bytesOf('A'));
    expect(loading.surface.isFilled({ left: 0, top: 0, right: 14, bottom: 27 }, BLACK)).toBe(false);
  });
});
