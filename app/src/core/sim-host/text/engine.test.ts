// The text screen and the output device driven by 68000 programs through the real simulator engine
// (SH3 acceptance, ARCHITECTURE.md 9.2): the "Text output" and "Cursor" items of trap15-a §13, each
// as a program that makes the TRAP #15 calls the item names, and the behaviour that only shows with
// the engine's own input state machine (echo, prompt, type-ahead).
//
// Every test assembles its program with the real assembler, loads it into a new engine whose `text`
// and `graphics` host parts are a real OutputDevice over a real TextScreen (with the synthetic
// fonts and the test surface), runs it to its SIMHALT and looks at the screen, the shadow array and
// the registers. The same behaviour without the engine is in text-screen.test.ts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Reg,
  RunStatus,
  type FontSpec,
  type Glyph,
  type HostMain,
  type Rect,
  type SimEngine,
} from '../../../contracts';
import {
  assembleProgram,
  createMemoryFiles,
  createTestEngine,
  runProgram,
  runTrap15Tour,
  trap15TourSource,
  type RunScript,
  type TestEngine,
} from '../../../engine/testing';
import { blend, createTextRig, rowText, syntheticFonts, type TextRig } from './testing';
import { DEFAULT_OPTIONS_FONT } from './text-screen';

const dist = (file: string) => fileURLToPath(new URL(`../../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** Engine tests assemble, create a 64 MiB instance and run: generous limit for a busy machine. */
const LIMIT = 60_000;

const WHITE = 0xffffff;
const BLACK = 0x000000;
const BLUE = 0xff0000; // $00BBGGRR
const RED = 0x0000ff;

// ---- programs ------------------------------------------------------------------------------------

/** A program: instructions between START and SIMHALT, then data lines (label in column 1). */
function source(body: readonly string[], data: readonly string[] = []): string[] {
  return [
    '        ORG     $1000',
    'START:',
    ...body.map((line) => `        ${line}`),
    '        SIMHALT',
    ...data,
    'EMPTY   DC.B    0',
    '        END     START',
  ];
}
/** `MOVEQ #task,D0` / `TRAP #15`. */
const trap = (task: number) => [`MOVEQ #${task},D0`, 'TRAP #15'];
/** Task 14 (display the string at a label). */
const show = (label: string) => [`LEA ${label},A1`, ...trap(14)];
/** Task 6 (display the character in D1.B). */
const char = (code: number) => [`MOVEQ #${code > 127 ? code - 256 : code},D1`, ...trap(6)];
/** Task 11 with D1.W. */
const task11 = (word: number) => [`MOVE.W #$${word.toString(16).toUpperCase()},D1`, ...trap(11)];
/** Task 11 get position; the answer stays in D1 and is copied to another register. */
const position = (into: string) => [...task11(0x00ff), `MOVE.L D1,${into}`];
/** CR, LF (task 13 with an empty string). */
const crlf = ['LEA EMPTY,A1', ...trap(13)];

// ---- the engine on the real device ---------------------------------------------------------------

interface Loaded {
  rig: TextRig;
  test: TestEngine;
  engine: SimEngine;
  /** A data register, unsigned. */
  d(n: number): number;
}

// The synthetic fonts are drawn once; under load that can take seconds, so it has a limit of its own.
beforeAll(() => void syntheticFonts(), LIMIT);

const engines: TestEngine[] = [];
afterEach(() => {
  for (const test of engines.splice(0)) test.release();
});

/** The `main` host part: inert, except that it gives the reset's font assignments to the text
 *  screen, as SimUiBridge does (3.3.1). */
function mainPart(rig: TextRig): HostMain {
  return {
    message: () => {},
    messagesClear: () => {},
    alert: () => {},
    registersShown: () => {},
    menuState: () => {},
    focusMain: () => {},
    autoTraceTimer: () => {},
    keyCommands: () => {},
    optionChanged: () => {},
    saveSettings: () => {},
    caption: () => {},
    repaint: () => {},
    memoryLivePaint: () => {},
    fontAssign: (target, fontSource) => rig.text.fontAssign(target, fontSource),
    timeCentiseconds: () => 0,
  };
}

/** A new engine on a new rig, with the program loaded. `prepare` runs before the engine exists
 *  (the Options menu: text wrap, the Options font). */
async function load(
  body: readonly string[],
  data: readonly string[] = [],
  prepare: (rig: TextRig) => void = () => {},
): Promise<Loaded> {
  const program = await assembleProgram(source(body, data));
  const rig = createTextRig();
  prepare(rig);
  const test = await createTestEngine({ main: mainPart(rig), text: rig.device, graphics: rig.device });
  engines.push(test);
  test.engine.load(program.s68, program.l68, { name: 'program.S68' });
  rig.logged.length = 0;
  return { rig, test, engine: test.engine, d: (n) => test.engine.getRegister((Reg.D0 + n) as Reg) >>> 0 };
}

/** Loads the program and runs it to its SIMHALT. */
async function run(
  body: readonly string[],
  data: readonly string[] = [],
  options: { prepare?: (rig: TextRig) => void; script?: RunScript } = {},
): Promise<Loaded> {
  const loaded = await load(body, data, options.prepare);
  const report = runProgram(loaded.engine, options.script);
  expect(report, 'the program must run to its SIMHALT').toMatchObject({ reason: 'stopped', halted: true });
  return loaded;
}

// ---- looking at the screen -----------------------------------------------------------------------

const glyphOf = (rig: TextRig, ch: number | string, font: FontSpec = rig.text.state.font): Glyph =>
  syntheticFonts().glyph(font, typeof ch === 'string' ? ch.charCodeAt(0) : ch);

/** The cell at pixel (x, y) shows `glyph` in `color` on `background`, pixel for pixel. */
function expectGlyphAt(rig: TextRig, x: number, y: number, glyph: Glyph, color = WHITE, background = BLACK): void {
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
const expectChar = (rig: TextRig, row: number, col: number, ch: string | number, color = WHITE, background = BLACK) =>
  expectGlyphAt(
    rig,
    col * rig.text.state.colWidth,
    row * rig.text.state.rowHeight,
    glyphOf(rig, ch),
    color,
    background,
  );
const cells = (rig: TextRig, row: number, col: number, cols = 1, rows = 1): Rect => {
  const { colWidth, rowHeight } = rig.text.state;
  return {
    left: col * colWidth,
    top: row * rowHeight,
    right: (col + cols) * colWidth,
    bottom: (row + rows) * rowHeight,
  };
};
const isBlack = (rig: TextRig, rect: Rect) => rig.surface.isFilled(rect, BLACK);
const whole = (rig: TextRig): Rect => ({
  left: 0,
  top: 0,
  right: rig.surface.back.width,
  bottom: rig.surface.back.height,
});
const cursor = (rig: TextRig) => ({ row: rig.text.state.row, col: rig.text.state.col });
/** What the overlay shows: '_', ' ', or null for no overlay. */
function overlayShows(rig: TextRig): '_' | ' ' | null {
  const cell = rig.surface.overlay;
  if (!cell) return null;
  const picture = (glyph: Glyph) =>
    Array.from(glyph.coverage, (coverage) =>
      blend(rig.surface.state.fillColor, rig.text.state.fontColor, coverage),
    ).join();
  const shown = Array.from(cell.pixels, (pixel) => pixel & 0xffffff).join();
  if (shown === picture(glyphOf(rig, '_'))) return '_';
  if (shown === picture(glyphOf(rig, ' '))) return ' ';
  throw new Error('the overlay shows neither the underscore nor the blank');
}

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist does not hold both engines: ' +
      'run `npm run build:engines` first. Without the variable the engine tests are skipped.',
  );
});

describe.skipIf(!enginesBuilt)('68000 programs on the real engine (needs engine/dist)', () => {
  describe('start-up and reset', () => {
    it(
      'the host calls of the start-up reset reach the device before the engine exists, and leave the start-up state',
      async () => {
        const rig = createTextRig();
        const test = await createTestEngine({ main: mainPart(rig), text: rig.device, graphics: rig.device });
        engines.push(test);
        // initSim: clear, setWindowSize(0,0), drawing modes 4 and 16, pen width, colours, fonts
        expect(test.methodsCalled()).toEqual(
          expect.arrayContaining(['clear', 'setWindowSize', 'setDrawingMode', 'fontAssign']),
        );
        expect(test.callsTo('setWindowSize')).toEqual([[0, 0]]);
        expect(rig.text.state).toMatchObject({
          row: 0,
          col: 0,
          colWidth: 8,
          rowHeight: 15,
          textCols: 80,
          textRows: 32,
        });
        expect(rig.device.getWindowSize()).toEqual([640, 480]);
        expect(isBlack(rig, whole(rig))).toBe(true);
        expect(rig.calls.show).toBe(0);
      },
      LIMIT,
    );

    it(
      'Rewind after task 21 restores the Options font, its colour and the grid, and homes the cursor',
      async () => {
        const { rig, engine } = await run(
          [
            'MOVE.L #$000000FF,D1',
            'MOVE.L #$03120004,D2', // Courier New 18, underline, red
            ...trap(21),
            ...show('MSG'),
          ],
          ["MSG     DC.B    'AB',0"],
        );
        expect(rig.text.state).toMatchObject({ colWidth: 14, rowHeight: 27, fontColor: RED, col: 2 });
        expect(rig.text.state.font).toMatchObject({ name: 'Courier New', size: 18, underline: true });
        engine.rewind();
        expect(rig.text.state).toMatchObject({
          font: DEFAULT_OPTIONS_FONT,
          fontColor: WHITE,
          colWidth: 8,
          rowHeight: 15,
          textCols: 80,
          textRows: 32,
          row: 0,
          col: 0,
          textX: 0,
          textY: 0,
        });
        expect(isBlack(rig, whole(rig))).toBe(true);
      },
      LIMIT,
    );

    it(
      'text wrap and the window size survive a load and a Rewind',
      async () => {
        const { rig, engine } = await run(
          [
            'MOVE.L #$03200258,D1', // 800 x 600
            ...trap(33),
          ],
          [],
          { prepare: (r) => r.text.setTextWrap(true) },
        );
        engine.rewind();
        expect(rig.text.state.textWrap).toBe(true);
        expect(rig.device.getWindowSize()).toEqual([800, 600]);
        expect(rig.text.state).toMatchObject({ textCols: 100, textRows: 40 });
      },
      LIMIT,
    );
  });

  describe('trap15-a §13, "Text output"', () => {
    it(
      "task 14 with 'AB',0 at home: A at (row 0, col 0), B at (0,1), cursor (0,2); task 11 get then returns D1.W = $0200",
      async () => {
        const { rig, d } = await run([...show('MSG'), 'MOVE.L #$123400FF,D1', ...trap(11)], ["MSG     DC.B    'AB',0"]);
        expectChar(rig, 0, 0, 'A');
        expectChar(rig, 0, 1, 'B');
        expect(isBlack(rig, cells(rig, 0, 2, 78))).toBe(true);
        expect(isBlack(rig, cells(rig, 1, 0, 80, 31))).toBe(true);
        expect(cursor(rig)).toEqual({ row: 0, col: 2 });
        expect(d(1)).toBe(0x12340200); // D1.W = $0200, bits 31..16 kept
        expect(rig.calls.show).toBeGreaterThan(0); // text output shows the Output panel
      },
      LIMIT,
    );

    it(
      'task 13 with an empty string: the cursor moves to column 0 of the next row',
      async () => {
        const { rig } = await run([...show('MSG'), 'LEA EMPTY,A1', ...trap(13)], ["MSG     DC.B    'AB',0"]);
        expect(cursor(rig)).toEqual({ row: 1, col: 0 });
        expect(rowText(rig.text, 0, 4)).toBe('AB  ');
      },
      LIMIT,
    );

    it(
      "task 0: D1.W = 3 of 'ABCDE' displays ABC then CR, LF; a NUL ends the text early; 300 characters display 255",
      async () => {
        const { rig } = await run(
          [
            'LEA FIVE,A1',
            'MOVEQ #3,D1',
            ...trap(0),
            'LEA NUL,A1',
            'MOVEQ #5,D1',
            ...trap(0),
            'LEA LONG,A1',
            'MOVE.W #300,D1',
            ...trap(0),
          ],
          [
            "FIVE    DC.B    'ABCDE',0",
            "NUL     DC.B    'AB',0,'CD',0",
            'LONG    DCB.B   300,$58',
            '        DC.B    0',
          ],
        );
        expect(rowText(rig.text, 0, 6)).toBe('ABC   ');
        expectChar(rig, 0, 2, 'C');
        expect(isBlack(rig, cells(rig, 0, 3, 77))).toBe(true);
        expect(rowText(rig.text, 1, 6)).toBe('AB    ');
        // 255 X from row 2, column 0; with wrap off they all go to row 2 and alias the rows below
        const text = rig.text.state.text;
        expect([...text.subarray(160, 160 + 255)].every((byte) => byte === 0x58)).toBe(true);
        expect(text[160 + 255]).toBe(0x20);
        for (const col of [0, 79]) expectChar(rig, 2, col, 'X');
        expect(isBlack(rig, cells(rig, 3, 0, 80, 29))).toBe(true);
        expect(cursor(rig)).toEqual({ row: 3, col: 0 });
      },
      LIMIT,
    );

    it(
      'task 6: $09 at column 0 goes to column 5; $08 at column 0 stays; $08 after ABC puts the cursor on the C, which stays visible',
      async () => {
        const { rig, d } = await run(
          [
            ...char(9),
            ...position('D2'),
            ...char(13),
            ...char(8),
            ...position('D3'),
            ...show('ABC'),
            ...char(8),
            ...position('D4'),
          ],
          ["ABC     DC.B    'ABC',0"],
        );
        expect(d(2) & 0xffff).toBe(0x0500);
        expect(d(3) & 0xffff).toBe(0x0000);
        expect(d(4) & 0xffff).toBe(0x0200);
        expect(cursor(rig)).toEqual({ row: 0, col: 2 });
        expectChar(rig, 0, 2, 'C');
        expect(rowText(rig.text, 0, 4)).toBe('ABC ');
      },
      LIMIT,
    );

    it(
      'task 6 with $0A on the last row: the screen scrolls one row, the cursor stays on the last row in the same column',
      async () => {
        const { rig, d } = await run([...task11(0x071f), ...char(0x51), ...char(10), ...position('D2')]);
        expect(d(2) & 0xffff).toBe(0x081f); // column 8, row 31
        expectChar(rig, 30, 7, 'Q');
        expect(isBlack(rig, cells(rig, 31, 0, 80))).toBe(true);
        expect(rig.text.getCharAt(30, 7)).toBe(0x51);
      },
      LIMIT,
    );

    it(
      'task 6 with $0B on row 30 of 32: one scroll, cursor on row 31',
      async () => {
        const { rig, d } = await run([...task11(0x001e), ...char(0x51), ...char(11), ...position('D2')]);
        expect(d(2) & 0xffff).toBe(0x011f); // column 1, row 31
        expectChar(rig, 29, 0, 'Q'); // moved up one row, not three
        expect(isBlack(rig, cells(rig, 30, 0, 80, 2))).toBe(true);
      },
      LIMIT,
    );

    it(
      'task 6 with $0C: the screen is black, the cursor home',
      async () => {
        const { rig, d } = await run(
          [
            'MOVE.L #$00FF0000,D1',
            ...trap(81),
            ...show('MSG'),
            ...char(10),
            ...show('MSG'),
            ...char(12),
            ...position('D2'),
          ],
          ["MSG     DC.B    'HELLO',0"],
        );
        expect(isBlack(rig, whole(rig))).toBe(true);
        expect(d(2) & 0xffff).toBe(0x0000);
        expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
      },
      LIMIT,
    );

    it(
      'task 6 with $01, $1B or $00: nothing happens; with $7F or $E9: a glyph is drawn and the cursor advances',
      async () => {
        const nothing = await run([...char(1), ...char(0x1b), ...char(0), ...position('D2')]);
        expect(nothing.d(2) & 0xffff).toBe(0x0000);
        expect(isBlack(nothing.rig, whole(nothing.rig))).toBe(true);
        expect(nothing.rig.logged).toEqual([]);

        const glyphs = await run([...char(0x7f), ...char(0xe9), ...position('D2')]);
        expect(glyphs.d(2) & 0xffff).toBe(0x0200);
        expectChar(glyphs.rig, 0, 0, 0x7f);
        expectChar(glyphs.rig, 0, 1, 0xe9);
        expect(isBlack(glyphs.rig, cells(glyphs.rig, 0, 0, 2))).toBe(false);
        expect([...glyphs.rig.text.state.text.subarray(0, 3)]).toEqual([0x7f, 0xe9, 0x20]);
      },
      LIMIT,
    );

    const eightyOne = ['LINE    DCB.B   80,$78', "        DC.B    'Y',0"];

    it(
      '81 printable characters from column 0, wrap off: 80 visible, cursor column 81, nothing on the next row; task 22 at (1,0) returns the 81st',
      async () => {
        const { rig, d } = await run(
          [...show('LINE'), ...position('D2'), 'MOVE.L #$00010000,D1', ...trap(22)],
          eightyOne,
        );
        for (let col = 0; col < 80; col++) expectChar(rig, 0, col, 'x');
        expect(isBlack(rig, cells(rig, 1, 0, 80, 31))).toBe(true);
        expect(d(2) & 0xffff).toBe(0x5100); // column $51
        expect(d(1)).toBe(0x00010059); // 'Y': stride aliasing; bits 31..8 kept
      },
      LIMIT,
    );

    it(
      'the same with wrap on: the 80th character leaves the cursor at (next row, 0); the 81st is printed there',
      async () => {
        const { rig, d } = await run(
          [
            'LEA LINE,A1',
            'MOVEQ #80,D1',
            ...trap(1), // the first 80 characters
            ...position('D2'),
            ...char(0x59),
            ...position('D3'),
          ],
          eightyOne,
          { prepare: (r) => r.text.setTextWrap(true) },
        );
        expect(d(2) & 0xffff).toBe(0x0001); // column 0, row 1
        expect(d(3) & 0xffff).toBe(0x0101);
        expectChar(rig, 0, 79, 'x');
        expectChar(rig, 1, 0, 'Y');
      },
      LIMIT,
    );

    it(
      'with wrap on, printing in the bottom-right cell scrolls the screen immediately',
      async () => {
        const { rig, d } = await run([...task11(0x4f1f), ...char(0x5a), ...position('D2')], [], {
          prepare: (r) => r.text.setTextWrap(true),
        });
        expect(d(2) & 0xffff).toBe(0x001f); // column 0, last row
        expectChar(rig, 30, 79, 'Z');
        expect(isBlack(rig, cells(rig, 31, 0, 80))).toBe(true);
      },
      LIMIT,
    );

    it(
      'task 3 with $FFFFFFFF is -1; task 15 in base 16, 2 and 36; base 1 or 37 displays nothing',
      async () => {
        const number = (d1: string, base: number) => [`MOVE.L #${d1},D1`, `MOVEQ #${base},D2`, ...trap(15), ...crlf];
        const { rig } = await run([
          'MOVE.L #$FFFFFFFF,D1',
          ...trap(3),
          ...crlf,
          ...number('$FFFFFFFF', 16),
          ...number('$FFFFFFFF', 2),
          ...number('$FFFFFFFF', 1),
          ...number('$FFFFFFFF', 37),
          ...number('255', 36),
        ]);
        expect([0, 1, 2, 3, 4, 5].map((row) => rowText(rig.text, row).trimEnd())).toEqual([
          '-1',
          'FFFFFFFF',
          '1'.repeat(32),
          '',
          '',
          '73',
        ]);
        expectChar(rig, 0, 0, '-');
        expectChar(rig, 0, 1, '1');
        expect(cursor(rig)).toEqual({ row: 6, col: 0 });
      },
      LIMIT,
    );

    it(
      'task 20 with 42: width 5 gives three spaces then 42; width -5 gives 42 then three spaces; width 1 gives 42',
      async () => {
        const field = (width: number) => [
          'MOVEQ #42,D1',
          `MOVEQ #${width},D2`,
          ...trap(20),
          ...position('D3'),
          ...crlf,
        ];
        const { rig, d } = await run([...field(5), 'MOVE.L D3,D4', ...field(-5), 'MOVE.L D3,D5', ...field(1)]);
        expect([0, 1, 2].map((row) => rowText(rig.text, row, 6))).toEqual(['   42 ', '42    ', '42    ']);
        // the cursor shows that the padding was printed: column 5, 5 and 2
        expect([d(4), d(5), d(3)].map((value) => (value >> 8) & 0xff)).toEqual([5, 5, 2]);
        expect(rig.logged.slice(0, 12)).toEqual([
          0x20, 0x20, 0x20, 0x34, 0x32, 0x0a, 0x34, 0x32, 0x20, 0x20, 0x20, 0x0a,
        ]);
      },
      LIMIT,
    );

    it(
      "task 17 with 'N=',0 and D1 = -5: N=-5",
      async () => {
        const { rig } = await run(['LEA MSG,A1', 'MOVEQ #-5,D1', ...trap(17)], ["MSG     DC.B    'N=',0"]);
        expect(rowText(rig.text, 0, 5)).toBe('N=-5 ');
        expect(cursor(rig)).toEqual({ row: 0, col: 4 });
        'N=-5'.split('').forEach((ch, col) => expectChar(rig, 0, col, ch));
      },
      LIMIT,
    );

    it(
      'task 81 (fill colour) set to blue, then task 14: the characters have blue cell backgrounds',
      async () => {
        const { rig } = await run(['MOVE.L #$00FF0000,D1', ...trap(81), ...show('MSG')], ["MSG     DC.B    'Hi',0"]);
        expectChar(rig, 0, 0, 'H', WHITE, BLUE);
        expectChar(rig, 0, 1, 'i', WHITE, BLUE);
        expect(rig.surface.pixel(0, 0)).toBe(BLUE);
        expect(isBlack(rig, cells(rig, 0, 2, 78))).toBe(true);
      },
      LIMIT,
    );

    it(
      'then task 11 with $FF00: the screen is black, not blue',
      async () => {
        const { rig } = await run(
          ['MOVE.L #$00FF0000,D1', ...trap(81), ...show('MSG'), ...task11(0xff00)],
          ["MSG     DC.B    'Hi',0"],
        );
        expect(isBlack(rig, whole(rig))).toBe(true);
        expect(rig.surface.state.fillColor).toBe(BLUE); // the fill colour itself is unchanged
        expect(cursor(rig)).toEqual({ row: 0, col: 0 });
      },
      LIMIT,
    );

    it(
      'draw a graphics line across the screen, then scroll with LF on the last row: the line moves up one text row',
      async () => {
        const { rig } = await run([
          'MOVEQ #0,D1',
          'MOVEQ #100,D2',
          'MOVE.W #639,D3',
          'MOVEQ #100,D4',
          ...trap(84),
          ...task11(0x001f),
          ...char(10),
        ]);
        expect(rig.surface.isFilled({ left: 0, top: 85, right: 640, bottom: 86 }, WHITE)).toBe(true);
        expect(rig.surface.isFilled({ left: 0, top: 100, right: 640, bottom: 101 }, BLACK)).toBe(true);
      },
      LIMIT,
    );
  });

  describe('trap15-a §13, "Cursor"', () => {
    it(
      'task 11 with D1.W = $0A05: cursor at column 10, row 5',
      async () => {
        const { rig, d } = await run([...task11(0x0a05), ...position('D2')]);
        expect(cursor(rig)).toEqual({ row: 5, col: 10 });
        expect(rig.text.state).toMatchObject({ textX: 80, textY: 75 });
        expect(d(2) & 0xffff).toBe(0x0a05);
      },
      LIMIT,
    );

    it(
      'D1.W = $0A28 (row 40) on a 32-row screen: one scroll, cursor row 31, column 10',
      async () => {
        const { rig, d } = await run([...task11(0x000a), ...char(0x51), ...task11(0x0a28), ...position('D2')]);
        expect(d(2) & 0xffff).toBe(0x0a1f);
        expectChar(rig, 9, 0, 'Q'); // one row up: exactly one scroll
        expect(isBlack(rig, cells(rig, 10, 0, 80, 22))).toBe(true);
      },
      LIMIT,
    );

    it(
      'D1.W = $8005: column 0, row 5',
      async () => {
        const { rig, d } = await run([...task11(0x8005), ...position('D2')]);
        expect(cursor(rig)).toEqual({ row: 5, col: 0 });
        expect(d(2) & 0xffff).toBe(0x0005);
      },
      LIMIT,
    );

    it(
      'D1.W = $00FF gets the position and keeps D1 bits 31..16; D1.W = $FF00 clears',
      async () => {
        const { rig, d } = await run(
          [
            ...task11(0x0c03),
            ...show('MSG'),
            'MOVE.L #$ABCD00FF,D1',
            ...trap(11),
            'MOVE.L D1,D2',
            ...task11(0xff00),
            ...position('D3'),
          ],
          ["MSG     DC.B    'HELLO',0"],
        );
        expect(d(2)).toBe(0xabcd1103); // column 17, row 3
        expect(d(3) & 0xffff).toBe(0x0000);
        expect(isBlack(rig, whole(rig))).toBe(true);
        expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
      },
      LIMIT,
    );

    it(
      'a column past the right edge with wrap on: CR, LF from the current row, whatever row was asked for',
      async () => {
        const { rig, d } = await run([...task11(0x0502), ...task11(0x5a0a), ...position('D2')], [], {
          prepare: (r) => r.text.setTextWrap(true),
        });
        expect(d(2) & 0xffff).toBe(0x0003); // column 0 of the row after row 2, not row 10
        expect(cursor(rig)).toEqual({ row: 3, col: 0 });
      },
      LIMIT,
    );
  });

  describe('the shadow array and keyboard echo', () => {
    it(
      "task 22 after task 14 'HI' at home with D1 = $00000001 gives $00000049",
      async () => {
        const { d } = await run([...show('MSG'), 'MOVEQ #1,D1', ...trap(22)], ["MSG     DC.B    'HI',0"]);
        expect(d(1)).toBe(0x00000049);
      },
      LIMIT,
    );

    it(
      'task 2: the typed characters are echoed but not stored in the shadow array; task 22 on a typed character gives $20',
      async () => {
        const { rig, d, engine } = await run(
          ['LEA BUFFER,A1', 'MOVEQ #-1,D1', ...trap(2), 'MOVE.L D1,D3', 'MOVEQ #1,D1', ...trap(22)],
          ['BUFFER  DS.B    80'],
          { script: { keys: ['abc\r'] } },
        );
        'abc'.split('').forEach((ch, col) => expectChar(rig, 0, col, ch));
        expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
        expect(d(1)).toBe(0x00000020);
        expect(d(3)).toBe(3); // D1.L = 3 although it was $FFFFFFFF before
        expect(cursor(rig)).toEqual({ row: 1, col: 0 });
        expect(rig.logged).toEqual([0x61, 0x62, 0x63, 0x0a]);
        const buffer = engine.getRegister(Reg.A1);
        expect([...engine.memory.subarray(buffer, buffer + 4)]).toEqual([0x61, 0x62, 0x63, 0x00]);
      },
      LIMIT,
    );

    it(
      'task 2 with a Backspace: the character is blanked on screen, the log keeps it',
      async () => {
        const { rig, d } = await run(['LEA BUFFER,A1', ...trap(2)], ['BUFFER  DS.B    80'], {
          script: { keys: ['abX\bc\r'] },
        });
        expect(d(1)).toBe(3);
        'abc'.split('').forEach((ch, col) => expectChar(rig, 0, col, ch));
        expect(isBlack(rig, cells(rig, 0, 3, 77))).toBe(true);
        expect(rig.logged).toEqual([0x61, 0x62, 0x58, 0x63, 0x0a]);
      },
      LIMIT,
    );

    it(
      'task 2 after task 12 with D1.B = 0: nothing is drawn, the cursor still advances, Enter still does CR, LF',
      async () => {
        const loaded = await load(['MOVEQ #0,D1', ...trap(12), 'LEA BUFFER,A1', ...trap(2)], ['BUFFER  DS.B    80']);
        const { rig, engine } = loaded;
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        for (const ch of 'abc') engine.keyChar(ch.charCodeAt(0));
        expect(cursor(rig)).toEqual({ row: 0, col: 3 });
        expect(isBlack(rig, whole(rig))).toBe(true);
        engine.keyChar(13);
        expect(runProgram(engine, { start: false })).toMatchObject({ halted: true });
        expect(cursor(rig)).toEqual({ row: 1, col: 0 });
        expect(loaded.d(1)).toBe(3);
        expect(rig.logged).toEqual([0x0a]); // only the CR, LF of the Enter
      },
      LIMIT,
    );

    it(
      'task 5: the echo goes through charOut, so the character is stored and a control code is interpreted',
      async () => {
        const { rig, d } = await run([...trap(5), 'MOVE.L D1,D2', ...trap(5)], [], { script: { keys: ['A', '\t'] } });
        expect(d(2) & 0xff).toBe(0x41);
        expect(d(1) & 0xff).toBe(0x09);
        expect(rig.text.getCharAt(0, 0)).toBe(0x41);
        expectChar(rig, 0, 0, 'A');
        expect(cursor(rig)).toEqual({ row: 0, col: 6 }); // A, then five columns for the tab
      },
      LIMIT,
    );
  });

  describe('task 21', () => {
    const task21 = (color: number, style: number) => [
      `MOVE.L #$${(color >>> 0).toString(16)},D1`,
      `MOVE.L #$${(style >>> 0).toString(16)},D2`,
      ...trap(21),
    ];

    it(
      'style bits: one bit sets one style, and of several bits only the highest counts',
      async () => {
        const styles: Record<string, string> = {};
        for (const bits of [0, 1, 2, 4, 8, 3, 5, 0xf]) {
          const { rig } = await run(task21(WHITE, bits));
          const { bold, italic, underline, strikeOut } = rig.text.state.font;
          styles[bits] = Object.entries({ bold, italic, underline, strikeOut })
            .filter(([, on]) => on)
            .map(([name]) => name)
            .join('+');
        }
        expect(styles).toEqual({
          0: '',
          1: 'bold',
          2: 'italic',
          4: 'underline',
          8: 'strikeOut',
          3: 'italic',
          5: 'underline', // bold + underline gives underline only
          15: 'strikeOut',
        });
      },
      LIMIT * 2,
    );

    it(
      'font numbers 1-7 with size 12, including the two that resolve to a proportional face',
      async () => {
        const fonts: string[] = [];
        for (let number = 1; number <= 7; number++) {
          const { rig } = await run(
            [...task21(WHITE, ((number << 8) | 12) << 16), ...show('MSG')],
            ["MSG     DC.B    'Wi',0"],
          );
          const { font, colWidth, rowHeight, textCols, textRows, col, textX } = rig.text.state;
          fonts.push(`${font.name}: ${colWidth}x${rowHeight}, ${textCols}x${textRows}`);
          // two characters, each at colWidth * column, drawn with the face's glyphs
          expect({ col, textX }).toEqual({ col: 2, textX: 2 * colWidth });
          expectGlyphAt(rig, 0, 0, glyphOf(rig, 'W'));
          expectGlyphAt(rig, colWidth, 0, glyphOf(rig, 'i'));
          expect(rig.text.getCharAt(0, 1)).toBe(0x69);
        }
        expect(fonts).toEqual([
          'Fixedsys: 8x15, 80x32',
          'Courier: 9x16, 71x30',
          'Courier New: 10x18, 64x26',
          'Lucida Console: 10x16, 64x30',
          'Lucida Sans Typerwriter: 15x18, 42x26',
          'Consolas: 9x19, 71x25',
          'Terminal: 15x18, 42x26',
        ]);
      },
      LIMIT * 2,
    );

    it(
      'a proportional face: the letters are narrower than the cells they stand in',
      async () => {
        const { rig } = await run(
          ['MOVE.L #$00FF0000,D1', ...trap(81), ...task21(WHITE, 0x050c0000), ...show('MSG')],
          ["MSG     DC.B    'ii',0"],
        );
        expect(glyphOf(rig, 'i').advance).toBe(10);
        expectGlyphAt(rig, 0, 0, glyphOf(rig, 'i'), WHITE, BLUE);
        expectGlyphAt(rig, 15, 0, glyphOf(rig, 'i'), WHITE, BLUE);
        // between the letters the grid cell is not painted
        expect(isBlack(rig, { left: 10, top: 0, right: 15, bottom: 18 })).toBe(true);
        expect(isBlack(rig, { left: 25, top: 0, right: 30, bottom: 18 })).toBe(true);
      },
      LIMIT,
    );

    it(
      'size byte 0 with a font number: the size is 0 and the cell is the one the table has for it',
      async () => {
        const { rig } = await run([...task21(WHITE, 0x03000000), ...char(0x41)]);
        expect(rig.text.state.font).toMatchObject({ name: 'Courier New', size: 0 });
        expect(rig.text.state).toMatchObject({ colWidth: 10, rowHeight: 18, textCols: 64, textRows: 26 });
        expectChar(rig, 0, 0, 'A');
      },
      LIMIT,
    );

    it(
      'a size outside the atlas sizes: the grid is the measured one and the glyphs are resampled to its cell',
      async () => {
        const { rig } = await run([...task21(WHITE, 0x03140000), ...show('MSG')], ["MSG     DC.B    'AB',0"]);
        expect(rig.text.state).toMatchObject({ colWidth: 16, rowHeight: 31, textCols: 40, textRows: 15 });
        expect(syntheticFonts().atlasOf(rig.text.state.font)).toBe('scalable/Courier_New-27.bin'); // 14 x 27
        expect(glyphOf(rig, 'A')).toMatchObject({ advance: 16, width: 16, height: 31 });
        expectChar(rig, 0, 0, 'A');
        expectChar(rig, 0, 1, 'B');
        expect(isBlack(rig, { left: 32, top: 0, right: 640, bottom: 31 })).toBe(true);
        expect(isBlack(rig, { left: 0, top: 31, right: 640, bottom: 480 })).toBe(true);
      },
      LIMIT,
    );

    it(
      'bold changes the grid of a raster font: Fixedsys bold has cells of 9 x 15, 71 columns',
      async () => {
        const { rig, d } = await run(
          [
            'MOVE.L #$00FF0000,D1',
            ...trap(81),
            ...task21(WHITE, 1),
            ...show('MSG'),
            ...position('D2'),
            ...task11(0x4600), // column 70, the last one
            ...char(0x5a),
            ...position('D3'),
          ],
          ["MSG     DC.B    'AB',0"],
          { prepare: (r) => r.text.setTextWrap(true) },
        );
        expect(rig.text.state).toMatchObject({ colWidth: 9, rowHeight: 15, textCols: 71, textRows: 32 });
        expect(d(2) & 0xffff).toBe(0x0200);
        expectGlyphAt(rig, 0, 0, glyphOf(rig, 'A'), WHITE, BLUE);
        expectGlyphAt(rig, 9, 0, glyphOf(rig, 'B'), WHITE, BLUE);
        // the opaque box of bold text is one pixel wider than its advance
        expect(rig.surface.pixel(18, 7)).toBe(BLUE);
        expect(rig.surface.pixel(19, 7)).toBe(BLACK);
        // the 71st column is the last: with wrap on, printing there goes to the next row
        expect(d(3) & 0xffff).toBe(0x0001);
      },
      LIMIT,
    );

    it(
      'the colour is D1.L; an unknown font number keeps the Options font name; a colour-only call goes back to the Options font',
      async () => {
        const { rig } = await run([
          ...task21(0x00123456, 0x09120000), // font number 9, size 18
          'MOVE.L D0,D7',
        ]);
        expect(rig.text.state.font).toMatchObject({ name: 'Fixedsys', size: 18 });
        expect(rig.text.state).toMatchObject({ fontColor: 0x123456, colWidth: 16, rowHeight: 30 });

        const back = await run([...task21(WHITE, 0x03120000), ...task21(RED, 0)]);
        expect(back.rig.text.state.font).toEqual(DEFAULT_OPTIONS_FONT);
        expect(back.rig.text.state).toMatchObject({ fontColor: RED, colWidth: 8, rowHeight: 15 });
      },
      LIMIT,
    );

    it(
      'the cursor keeps its row and column; the screen scrolls once when the row no longer fits',
      async () => {
        const { rig, d } = await run([
          ...task11(0x021f),
          ...char(0x51),
          ...task21(WHITE, 0x01120000),
          ...position('D2'),
        ]);
        expect(d(2) & 0xffff).toBe(0x030f); // column 3, row 15 of 16
        expect(rig.text.state).toMatchObject({ textX: 48, textY: 450 });
        expectGlyphAt(rig, 16, 435, glyphOf(rig, 'Q', DEFAULT_OPTIONS_FONT)); // moved up 30 pixels
      },
      LIMIT,
    );
  });

  describe('window size, rectangle scroll, graphics text', () => {
    it(
      'task 33 with $03200258: 800 x 600, screen black, cursor unchanged, shadow array kept; D1 = 0 then returns $03200258',
      async () => {
        const { rig, d } = await run(
          [
            ...task11(0x0503),
            ...show('MSG'),
            'MOVE.L #$03200258,D1',
            ...trap(33),
            ...position('D2'),
            'MOVEQ #0,D1',
            ...trap(33),
          ],
          ["MSG     DC.B    'HELLO',0"],
        );
        expect(d(1)).toBe(0x03200258);
        expect(d(2) & 0xffff).toBe(0x0a03);
        expect(rig.text.state).toMatchObject({ textCols: 100, textRows: 40, textX: 80, textY: 45 });
        expect(isBlack(rig, whole(rig))).toBe(true);
        expect(rig.text.state.text[3 * 80 + 5]).toBe(0x48); // not cleared, not laid out again
      },
      LIMIT,
    );

    it(
      'task 33 with $00640064: the window becomes 640 x 480',
      async () => {
        const { rig, d } = await run([
          'MOVE.L #$03200258,D1',
          ...trap(33),
          'MOVE.L #$00640064,D1',
          ...trap(33),
          'MOVEQ #0,D1',
          ...trap(33),
        ]);
        expect(d(1)).toBe(0x028001e0);
        expect(rig.device.getWindowSize()).toEqual([640, 480]);
      },
      LIMIT,
    );

    it(
      'task 33 with 1 and 2 asks the Output panel for windowed and full-screen mode and changes nothing else',
      async () => {
        const { rig } = await run(['MOVEQ #2,D1', ...trap(33), 'MOVEQ #1,D1', ...trap(33)]);
        expect(rig.fullScreen.slice(-2)).toEqual([true, false]);
        expect(rig.device.getWindowSize()).toEqual([640, 480]);
      },
      LIMIT,
    );

    it(
      'task 25 scrolls a rectangle of cells: text, pixels and shadow array, in the four directions',
      async () => {
        const scroll = (dir: number) => [
          'MOVE.L #$00010002,D1',
          'MOVE.L #$00020003,D2',
          `MOVEQ #${dir},D3`,
          ...trap(25),
        ];
        const lines = [
          ...task11(0x0101),
          ...show('ONE'),
          ...task11(0x0102),
          ...show('TWO'),
          ...task11(0x0103),
          ...show('SIX'),
        ];
        const data = ["ONE     DC.B    'abcde',0", "TWO     DC.B    'fghij',0", "SIX     DC.B    'klmno',0"];
        const result: string[][] = [];
        for (const dir of [0, 1, 2, 3]) {
          const { rig } = await run([...lines, ...scroll(dir), ...position('D4')], data);
          result.push([1, 2, 3].map((row) => rowText(rig.text, row, 7).slice(1, 6)));
          expect(cursor(rig)).toEqual({ row: 3, col: 6 }); // the cursor does not move
          if (dir === 0) {
            expectChar(rig, 1, 2, 'g');
            expect(isBlack(rig, cells(rig, 2, 2, 3))).toBe(true);
            expectChar(rig, 1, 1, 'a');
            expectChar(rig, 3, 2, 'l');
          }
        }
        expect(result).toEqual([
          ['aghie', 'f   j', 'klmno'], // up
          ['a   e', 'fbcdj', 'klmno'], // down
          ['acd e', 'fhi j', 'klmno'], // left
          ['a bce', 'f ghj', 'klmno'], // right
        ]);
      },
      LIMIT * 2,
    );

    it(
      "task 95 draws 'A',9,'B',13,10,'C' as ABC in three cells; task 96 then gives the pen after six cells",
      async () => {
        const { rig, d } = await run(
          [
            'LEA MSG,A1',
            'MOVEQ #10,D1',
            'MOVEQ #20,D2',
            ...trap(95),
            'MOVE.L #$11110000,D1',
            'MOVE.L #$22220000,D2',
            ...trap(96),
          ],
          ["MSG     DC.B    'A',9,'B',13,10,'C',0"],
        );
        expectGlyphAt(rig, 10, 20, glyphOf(rig, 'A'));
        expectGlyphAt(rig, 18, 20, glyphOf(rig, 'B'));
        expectGlyphAt(rig, 26, 20, glyphOf(rig, 'C'));
        expect(isBlack(rig, { left: 34, top: 0, right: 640, bottom: 480 })).toBe(true);
        expect(d(1)).toBe(0x11110000 + 58); // 10 + 6 * 8; the high words are kept
        expect(d(2)).toBe(0x22220000 + 20);
        expect(cursor(rig)).toEqual({ row: 0, col: 0 });
        expect(rig.text.state.text.every((byte) => byte === 0x20)).toBe(true);
        expect(rig.calls.show).toBe(0); // graphics never show the window
      },
      LIMIT,
    );

    it(
      'task 95 with CR, LF only fills one cell; a form feed inside a text keeps its cell',
      async () => {
        const { rig, d } = await run(
          [
            'MOVE.L #$00FF0000,D1',
            ...trap(81),
            'LEA ENDS,A1',
            'MOVEQ #10,D1',
            'MOVEQ #20,D2',
            ...trap(95),
            ...trap(96),
            'MOVE.L D1,D3',
            'LEA FEED,A1',
            'MOVEQ #10,D1',
            'MOVEQ #60,D2',
            ...trap(95),
            ...trap(96),
          ],
          ['ENDS    DC.B    13,10,0', "FEED    DC.B    'A',12,'B',0"],
        );
        // CR, LF: one cell of the fill colour, the pen two cells further
        expect(rig.surface.isFilled({ left: 10, top: 20, right: 18, bottom: 35 }, BLUE)).toBe(true);
        expect(rig.surface.pixel(18, 20)).toBe(BLACK);
        expect(d(3) & 0xffff).toBe(26);
        // 'A', $0C, 'B': three cells, the form feed drawn with the glyph the font has for it
        expectGlyphAt(rig, 10, 60, glyphOf(rig, 'A'), WHITE, BLUE);
        expectGlyphAt(rig, 18, 60, glyphOf(rig, 0x0c), WHITE, BLUE);
        expectGlyphAt(rig, 26, 60, glyphOf(rig, 'B'), WHITE, BLUE);
        expect(d(1) & 0xffff).toBe(34);
        expect(cursor(rig)).toEqual({ row: 0, col: 0 }); // nothing is interpreted: no clear, no cursor move
      },
      LIMIT,
    );

    it(
      'the output log gets what trap15-a §13 lists: 41 42 0A for task 13, 0D 0A for the two characters, nothing for BEL',
      async () => {
        const { rig } = await run(
          ['LEA MSG,A1', ...trap(13), ...char(13), ...char(10), ...char(7)],
          ["MSG     DC.B    'AB',0"],
        );
        expect(rig.logged).toEqual([0x41, 0x42, 0x0a, 0x0d, 0x0a]);
        expect(rig.calls.beep).toBe(1);
      },
      LIMIT,
    );
  });

  describe('the prompt, with the engine deciding when (trap15-a §3.8)', () => {
    const input = (extra: readonly string[] = []) => ['LEA BUFFER,A1', ...trap(2), ...extra];
    const buffer = ['BUFFER  DS.B    80'];

    it(
      'virtual time: the first underscore shows after 1000 ms, then 500 ms on and 500 ms off',
      async () => {
        const { rig, engine } = await load([...task11(0x0302), ...input()], buffer);
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: true });
        const seen: string[] = [];
        for (let ms = 250; ms <= 2500; ms += 250) {
          rig.scheduler.advance(250);
          seen.push(`${ms}:${overlayShows(rig) ?? '-'}`);
        }
        expect(seen.join(' ')).toBe('250:- 500:  750:  1000:_ 1250:_ 1500:  1750:  2000:_ 2250:_ 2500: ');
        expect(rig.surface.overlay).toMatchObject({ x: 24, y: 30, width: 8, height: 15 });
        expect(isBlack(rig, whole(rig))).toBe(true); // never in the back buffer
      },
      LIMIT,
    );

    it(
      'a typed character restarts the period and moves the prompt; Enter erases it and stops the timer',
      async () => {
        const { rig, engine } = await load(input(), buffer);
        engine.cmdRun();
        engine.run(1000);
        rig.scheduler.advance(1200);
        expect(overlayShows(rig)).toBe('_');
        engine.keyChar(0x61);
        expect(overlayShows(rig)).toBeNull(); // the repaint after the echo
        rig.scheduler.advance(499);
        expect(overlayShows(rig)).toBeNull();
        rig.scheduler.advance(1);
        expect(overlayShows(rig)).toBe(' '); // the blink state was "visible": the blank comes first
        expect(rig.surface.overlay).toMatchObject({ x: 8, y: 0 });
        rig.scheduler.advance(500);
        expect(overlayShows(rig)).toBe('_');
        engine.keyChar(13);
        expect(rig.text.state.promptEnabled).toBe(false);
        expect(overlayShows(rig)).toBe(' '); // erasePrompt, at the cell the prompt was in
        expect(rig.surface.overlay).toMatchObject({ x: 8, y: 0 });
        expect(rig.scheduler.pending).toBe(0);
        expect(runProgram(engine, { start: false })).toMatchObject({ halted: true });
      },
      LIMIT,
    );

    it(
      'task 16 with D1.B = 0: no prompt at all, and nothing is erased',
      async () => {
        const { rig, engine } = await load(['MOVEQ #0,D1', ...trap(16), ...input()], buffer);
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        expect(rig.text.state.promptEnabled).toBe(false);
        rig.scheduler.advance(3000);
        engine.keyChar(0x61);
        engine.keyChar(13);
        expect(rig.surface.overlay).toBeNull();
        expect(runProgram(engine, { start: false })).toMatchObject({ halted: true });
      },
      LIMIT,
    );

    it(
      'HELLO, cursor back onto the H, task 2 and Enter at once: the H is blanked on screen, task 22 still returns H, and it reappears at the next repaint',
      async () => {
        const { rig, engine, d } = await load(
          [
            ...show('MSG'),
            ...task11(0x0000),
            ...input(['MOVEQ #0,D1', ...trap(22), 'MOVE.L D1,D2', ...trap(23), ...show('MSG')]),
          ],
          [...buffer, "MSG     DC.B    'HELLO',0"],
        );
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        engine.keyChar(13);
        expect(engine.run(1000)).toBe(RunStatus.WaitDelay); // stopped before the second task 14
        expect(d(2) & 0xff).toBe(0x48); // task 22: the H is still in the shadow array
        expect(overlayShows(rig)).toBe(' ');
        expect(rig.surface.visible(1, 7)).toBe(BLACK); // blanked on screen ...
        expect(rig.surface.pixel(1, 7)).toBe(WHITE); // ... but still in the back buffer
        expectChar(rig, 0, 0, 'H');
        engine.delayElapsed(engine.delayRemaining);
        expect(runProgram(engine, { start: false })).toMatchObject({ halted: true });
        expect(rig.surface.overlay).toBeNull(); // the next output repainted the window
        expect(rig.surface.visible(1, 7)).toBe(WHITE);
      },
      LIMIT,
    );

    it(
      'quirk: a type-ahead Enter completes the input at once, and the prompt is started after it and keeps blinking',
      async () => {
        const { rig, engine, d } = await load(
          ['MOVEQ #50,D1', ...trap(23), ...input(['MOVE.L D1,D2', 'MOVEQ #50,D1', ...trap(23), ...input()])],
          buffer,
        );
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitDelay);
        engine.keyChar(13); // typed during the delay: the one-key type-ahead
        engine.delayElapsed(engine.delayRemaining);
        expect(engine.run(1000)).toBe(RunStatus.WaitDelay); // the first input is already over
        expect(d(2)).toBe(0); // an empty line
        expect(cursor(rig)).toEqual({ row: 1, col: 0 });
        expect(rig.text.state).toMatchObject({ promptEnabled: true, promptVisible: true });
        rig.scheduler.advance(1000);
        expect(overlayShows(rig)).toBe('_'); // blinking although no input is waiting
        expect(rig.surface.overlay).toMatchObject({ x: 0, y: 15 });
        // ... until the next input task ends
        engine.delayElapsed(engine.delayRemaining);
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        engine.keyChar(13);
        expect(rig.text.state.promptEnabled).toBe(false);
        expect(runProgram(engine, { start: false })).toMatchObject({ halted: true });
      },
      LIMIT,
    );

    it(
      'quirk: Rewind while an input is waiting does not stop the timer: the underscore blinks at the home position',
      async () => {
        const { rig, engine } = await load([...task11(0x0503), ...input()], buffer);
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        rig.scheduler.advance(700);
        engine.rewind();
        expect(rig.text.state).toMatchObject({ promptEnabled: true, row: 0, col: 0 });
        rig.scheduler.advance(300); // the timer kept its phase: the tick of 1000 ms
        expect(overlayShows(rig)).toBe('_');
        expect(rig.surface.overlay).toMatchObject({ x: 0, y: 0 });
      },
      LIMIT,
    );

    it(
      'Pause during an input erases the prompt and stops the timer',
      async () => {
        const { rig, engine } = await load([...task11(0x0503), ...input()], buffer);
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        rig.scheduler.advance(1000);
        expect(overlayShows(rig)).toBe('_');
        engine.cmdPause();
        expect(rig.text.state.promptEnabled).toBe(false);
        expect(overlayShows(rig)).toBe(' ');
        expect(rig.surface.overlay).toMatchObject({ x: 40, y: 45 });
        rig.scheduler.advance(2000);
        expect(overlayShows(rig)).toBe(' ');
      },
      LIMIT,
    );

    it(
      'while double buffering is on the prompt does not blink, but its erasing blank is still drawn',
      async () => {
        const { rig, engine } = await load(
          [...show('MSG'), ...task11(0x0000), 'MOVEQ #17,D1', ...trap(92), ...input()],
          [...buffer, "MSG     DC.B    'HELLO',0"],
        );
        engine.cmdRun();
        expect(engine.run(1000)).toBe(RunStatus.WaitInput);
        rig.scheduler.advance(3000);
        expect(rig.surface.overlay).toBeNull();
        expect(rig.text.state.promptVisible).toBe(true); // the blink state did not move
        engine.keyChar(13);
        expect(overlayShows(rig)).toBe(' ');
        expect(rig.surface.visible(1, 7)).toBe(BLACK);
      },
      LIMIT,
    );
  });

  it(
    'the program that calls every TRAP #15 task runs to its end on the real device',
    async () => {
      const rig = createTextRig();
      const test = await createTestEngine({
        main: mainPart(rig),
        text: rig.device,
        graphics: rig.device,
        files: createMemoryFiles(),
      });
      engines.push(test);
      const tour = runTrap15Tour(test, await assembleProgram(trap15TourSource()));
      expect(tour.report).toMatchObject({ reason: 'stopped', halted: true });
      expect(rig.device.getWindowSize()).toEqual([800, 600]); // task 33 of the tour
      expect(rig.fullScreen).toEqual(expect.arrayContaining([true, false]));
    },
    LIMIT,
  );
});
