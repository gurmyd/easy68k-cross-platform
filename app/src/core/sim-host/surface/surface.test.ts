// The Surface class against the SH1 acceptance list (ARCHITECTURE.md 9.2): the drawn examples
// through the public methods, the mode table for every value on every kind of primitive, the
// pen-position table of trap15-b §5.5 row by row, the double-buffer and resize rules, the colour
// forms, the start-up state of 3.3.2, clipping, the text and block operations and the dirty record.

import { describe, expect, it } from 'vitest';
import type { Glyph, OverlayCell, PixelBuffer, Rect } from '../../../contracts';
import { MODE_TABLE, rop } from './rop';
import { MAX_SURFACE, Surface } from './surface';
import {
  BLACK,
  BLUE,
  cellGlyph,
  countPixels,
  createRandom,
  drawFixedScene,
  drawShapeScene,
  FIXED_SCENE_HASH,
  GREEN,
  hashPixels,
  LETTER_GLYPH,
  picture,
  pixelAt,
  RED,
  UNDERSCORE_GLYPH,
  WHITE,
} from './testing';

const STARTUP_STATE = {
  penColor: 0xffffff,
  fillColor: 0x000000,
  penWidth: 1,
  penMode: 4,
  doubleBuffer: false,
  backPen: { x: 0, y: 0 },
  windowPen: { x: 0, y: 0 },
};

/** Glyphs in the default text cell of 8 x 15 pixels: a prompt, a blank and a letter. */
const UNDERSCORE = UNDERSCORE_GLYPH;
const BLANK = cellGlyph();
const LETTER = LETTER_GLYPH;

/** The window buffer of a surface that is double buffering. */
function shown(surface: Surface): PixelBuffer {
  if (!surface.window) throw new Error('the surface is not double buffering');
  return surface.window;
}

/** The prompt cell of a surface that has one. */
function promptCell(surface: Surface): OverlayCell {
  if (!surface.overlay) throw new Error('the surface has no prompt cell');
  return surface.overlay;
}

/** The changed region of a surface on which something changed. */
function changed(surface: Surface): Rect {
  const dirty = surface.takeDirty();
  if (!dirty) throw new Error('nothing changed on the surface');
  return dirty;
}

/** A surface whose back buffer is one colour everywhere, with the start-up state otherwise. */
function surfaceOf(color: number, width = 640, height = 480): Surface {
  const surface = new Surface(width, height);
  surface.setLineColor(color);
  surface.setFillColor(color);
  surface.rectangle(0, 0, width - 1, height - 1);
  surface.setLineColor(WHITE);
  surface.setFillColor(BLACK);
  surface.takeDirty();
  return surface;
}

describe('start-up state (ARCHITECTURE.md 3.3.2)', () => {
  it('a new surface is black with the default state', () => {
    const surface = new Surface(640, 480);
    expect(surface.back.width).toBe(640);
    expect(surface.back.height).toBe(480);
    expect(surface.back.data).toHaveLength(640 * 480);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    expect(surface.back.data[0]).toBe(0xff000000); // stored as 0xFF000000 | $00BBGGRR
    expect(surface.window).toBeNull();
    expect(surface.overlay).toBeNull();
    expect(surface.state).toEqual(STARTUP_STATE);
  });

  it('resetToStartup(): 640x480, both buffers black, double buffering off, pens at (0,0), pen white, fill black, width 1, mode 4', () => {
    const surface = new Surface(640, 480);
    const state = surface.state;
    surface.resize(800, 600);
    surface.setLineColor(RED);
    surface.setFillColor(GREEN);
    surface.setPenWidth(7);
    surface.setDrawingMode(14);
    surface.setDrawingMode(17);
    surface.rectangle(10, 10, 300, 300);
    surface.line(5, 5, 200, 100);
    surface.textOut(40, 40, [UNDERSCORE], 8, WHITE, 'window');
    expect(surface.overlay).not.toBeNull();

    surface.resetToStartup();
    expect(surface.back.width).toBe(640);
    expect(surface.back.height).toBe(480);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    expect(surface.window).toBeNull();
    expect(surface.overlay).toBeNull();
    expect(surface.state).toEqual(STARTUP_STATE);
    expect(surface.state).toBe(state); // the same object: holders of `state` stay current
    expect(surface.getXY()).toEqual([0, 0]);
    expect(surface.takeDirty()).toEqual({ left: 0, top: 0, right: 640, bottom: 480 });
  });

  it('the constructor takes the size as given; resize applies the minimum', () => {
    const small = new Surface(64, 48);
    expect([small.back.width, small.back.height]).toEqual([64, 48]);
    const large = new Surface(MAX_SURFACE + 1, 99999);
    expect([large.back.width, large.back.height]).toEqual([MAX_SURFACE, MAX_SURFACE]);
  });
});

describe('colours (tasks 80 and 81, trap15-b §4.6)', () => {
  it('the pen and the fill take every colour form', () => {
    const surface = new Surface(640, 480);
    const forms: [number, number][] = [
      [0x000000ff, 0x0000ff], // plain
      [0x80000005, 0xffffff], // system colour 5, window
      [0x8000000f, 0xf0f0f0], // system colour 15, button face
      [0x80000028, 0x000000], // system colour above 30
      [0x01000005, 0x800080], // stock palette entry 5
      [0x01010005, 0x800080], // only the low 16 bits select the entry
      [0x0100ff05, 0x000000], // entry 65285: black
      [0x02123456, 0x123456], // other even top bytes: the low 24 bits
    ];
    for (const [given, drawn] of forms) {
      surface.setLineColor(given | 0); // as the engine passes it
      surface.setFillColor(given);
      expect(surface.state.penColor, `pen $${given.toString(16)}`).toBe(drawn);
      expect(surface.state.fillColor, `fill $${given.toString(16)}`).toBe(drawn);
      surface.drawPixel(3, 3);
      expect(surface.getPixel(3, 3)).toBe(drawn);
      surface.rectangle(10, 10, 20, 20);
      expect(surface.getPixel(15, 15)).toBe(drawn);
    }
  });

  it('V9 of trap15-b §15: pen $80000005, draw a pixel, read it back', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(0x80000005 | 0);
    surface.drawPixel(100, 100);
    expect(surface.getPixel(100, 100)).toBe(0x00ffffff);
  });
});

describe('pixels (tasks 82 and 83, trap15-b §6.5)', () => {
  it('task 82 draws one pixel in the pen colour, whatever the pen width', () => {
    const surface = new Surface(640, 480);
    surface.setPenWidth(9);
    surface.setLineColor(RED);
    surface.drawPixel(20, 30);
    expect(countPixels(surface.back, RED)).toBe(1);
    expect(surface.getPixel(20, 30)).toBe(RED);
  });

  it('task 82 outside the surface does nothing', () => {
    const surface = new Surface(640, 480);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [640, 0],
      [0, 480],
      [-32768, -32768],
      [32767, 32767],
    ] as const) {
      surface.drawPixel(x, y);
    }
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
  });

  it('task 82 goes through the drawing mode: in mode 14 a pixel drawn twice restores the background, in mode 2 nothing is drawn', () => {
    const surface = surfaceOf(0x336699);
    surface.setLineColor(0x0f0ff0);
    surface.setDrawingMode(14);
    surface.drawPixel(7, 7);
    expect(surface.getPixel(7, 7)).toBe(0x336699 ^ 0x0f0ff0);
    surface.drawPixel(7, 7);
    expect(surface.getPixel(7, 7)).toBe(0x336699);
    surface.setDrawingMode(2);
    surface.drawPixel(8, 8);
    expect(surface.getPixel(8, 8)).toBe(0x336699);
  });

  it('V3 of trap15-b §15: white filled rectangle, mode 14, pen white, task 82 inside, task 83 there gives 0', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(WHITE);
    surface.rectangle(10, 10, 50, 50);
    surface.setDrawingMode(14);
    surface.setLineColor(WHITE);
    surface.drawPixel(30, 30);
    expect(surface.getPixel(30, 30)).toBe(0);
  });

  it('task 83 returns $00BBGGRR inside and $FFFFFFFF outside the surface', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(0x123456);
    surface.drawPixel(639, 479);
    expect(surface.getPixel(639, 479)).toBe(0x00123456);
    expect(surface.getPixel(0, 0)).toBe(0);
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [640, 0],
      [0, 480],
      [640, 480],
      [-32768, 5],
      [5, 32767],
    ] as const) {
      expect(surface.getPixel(x, y), `(${x},${y})`).toBe(0xffffffff);
    }
    expect(surface.getPixel(-1, -1) | 0).toBe(-1); // what the engine stores in D0.L
  });

  it('task 83 reads the back buffer: drawing that is not on screen yet, and never the prompt', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.drawPixel(5, 5);
    expect(surface.getPixel(5, 5)).toBe(WHITE);
    expect(pixelAt(shown(surface), 5, 5)).toBe(BLACK);
    surface.setFillColor(RED);
    surface.textOut(0, 0, [UNDERSCORE], 8, WHITE, 'window');
    expect(surface.getPixel(1, 12)).toBe(BLACK);
    expect(surface.getPixel(0, 0)).toBe(BLACK);
  });
});

describe('lines (tasks 84 and 85, trap15-b §6.1)', () => {
  it('task 84 draws the example (0,0)-(8,4) of LineTo plus the end point', () => {
    const surface = new Surface(640, 480);
    surface.line(0, 0, 8, 4);
    expect(picture(surface.back, 0, 0, 9, 5)).toEqual([
      '##.......',
      '..##.....',
      '....##...',
      '......##.',
      '........#',
    ]);
    expect(countPixels(surface.back, WHITE)).toBe(9);
  });

  it('a zero-length line draws exactly one pixel', () => {
    const surface = new Surface(640, 480);
    surface.line(100, 100, 100, 100);
    expect(countPixels(surface.back, WHITE)).toBe(1);
    expect(surface.getPixel(100, 100)).toBe(WHITE);
  });

  it('task 85 draws from the pen position and includes both ends', () => {
    const surface = new Surface(640, 480);
    surface.moveTo(2, 1);
    surface.lineTo(6, 1);
    surface.lineTo(6, 4);
    expect(picture(surface.back, 0, 0, 8, 6)).toEqual([
      '........',
      '..#####.',
      '......#.',
      '......#.',
      '......#.',
      '........',
    ]);
  });

  it('the end point is a pixel through the drawing mode: in mode 14 every pixel of a thin line is combined once', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(14);
    surface.line(0, 0, 8, 4);
    expect(countPixels(surface.back, WHITE)).toBe(9);
    surface.line(0, 0, 8, 4);
    expect(countPixels(surface.back, WHITE)).toBe(0);
  });

  it('a wide pen in mode 14 leaves a one-pixel hole at the end point (it is combined twice)', () => {
    const surface = new Surface(640, 480);
    surface.setPenWidth(5);
    surface.setDrawingMode(14);
    surface.line(20, 20, 60, 20);
    expect(surface.getPixel(60, 20)).toBe(BLACK); // the hole
    expect(surface.getPixel(59, 20)).toBe(WHITE);
    expect(surface.getPixel(20, 20)).toBe(WHITE); // the start point is covered once
    expect(surface.getPixel(40, 18)).toBe(WHITE); // the band: 20-2 .. 20+2
    expect(surface.getPixel(40, 22)).toBe(WHITE);
    expect(surface.getPixel(40, 17)).toBe(BLACK);
    expect(surface.getPixel(40, 23)).toBe(BLACK);
  });

  it('in Copy mode the end-point pixel of a wide line is invisible', () => {
    const surface = new Surface(640, 480);
    surface.setPenWidth(5);
    surface.line(20, 20, 60, 20);
    expect(surface.getPixel(60, 20)).toBe(WHITE);
  });

  it('pen width 0 draws exactly like pen width 1', () => {
    const one = new Surface(640, 480);
    const zero = new Surface(640, 480);
    zero.setPenWidth(0);
    for (const surface of [one, zero]) {
      surface.line(3, 4, 300, 211);
      surface.unfilledRectangle(50, 60, 90, 80);
    }
    expect(hashPixels(zero.back)).toBe(hashPixels(one.back));
    expect(zero.state.penWidth).toBe(0); // kept as set
  });

  it('lines that leave the surface are clipped (the official sample draws to y = 640 on 480 rows)', () => {
    const surface = new Surface(640, 480);
    surface.line(320, 0, 320, 640);
    expect(countPixels(surface.back, WHITE)).toBe(480);
    surface.line(-100, -100, 739, 579);
    surface.line(32767, -32768, -32768, 32767);
    expect(surface.state.backPen).toEqual({ x: -32768, y: 32767 });
  });
});

describe('rectangles (tasks 87 and 90, trap15-b §6.3)', () => {
  const EXAMPLES = [
    [2, 2, 8, 6],
    [12, 2, 12, 6],
    [16, 2, 20, 2],
    [24, 2, 24, 2],
    [28, 2, 29, 3],
    [33, 2, 35, 4],
  ] as const;

  it('task 87 draws the examples of the spec: pen width 1, `#` pen, `R` fill', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    for (const [x1, y1, x2, y2] of EXAMPLES) surface.rectangle(x1, y1, x2, y2);
    expect(picture(surface.back, 0, 2, 39, 7)).toEqual([
      '..#######...#...#####.......##...###...',
      '..#RRRRR#...#...............##...#R#...',
      '..#RRRRR#...#....................###...',
      '..#RRRRR#...#..........................',
      '..#######...#..........................',
    ]);
    expect(countPixels(surface.back, WHITE) + countPixels(surface.back, RED)).toBe(20 + 15 + 5 + 5 + 0 + 4 + 8 + 1);
  });

  it('task 90 draws the same outlines and leaves the interiors untouched', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    for (const [x1, y1, x2, y2] of EXAMPLES) surface.unfilledRectangle(x1, y1, x2, y2);
    expect(picture(surface.back, 0, 2, 39, 7)).toEqual([
      '..#######...#...#####.......##...###...',
      '..#.....#...#...............##...#.#...',
      '..#.....#...#....................###...',
      '..#.....#...#..........................',
      '..#######...#..........................',
    ]);
    expect(surface.state.fillColor).toBe(RED); // "there is no lasting effect"
  });

  it('the corners may come in any order, and the pen width is the low byte with 0 as 1', () => {
    const surface = new Surface(640, 480);
    surface.setPenWidth(0x100); // low byte 0
    surface.rectangle(8, 6, 2, 2);
    expect(picture(surface.back, 0, 2, 11, 7)).toEqual([
      '..#######..',
      '..#.....#..',
      '..#.....#..',
      '..#.....#..',
      '..#######..',
    ]);
  });

  it('a wide outline and its interior are combined once each: in mode 14 nothing cancels', () => {
    const surface = new Surface(640, 480);
    surface.setPenWidth(6);
    surface.setLineColor(GREEN);
    surface.setFillColor(RED);
    surface.setDrawingMode(14);
    surface.rectangle(100, 100, 140, 130);
    // width 6: a = 3, b = 2. Outer 97..142 by 97..132, inner 103..136 by 103..126.
    expect(countPixels(surface.back, RED)).toBe(34 * 24);
    expect(countPixels(surface.back, GREEN)).toBe(46 * 36 - 34 * 24);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480 - 46 * 36);
  });
});

describe('the drawing mode on every kind of primitive (task 92, trap15-b §5.4)', () => {
  const D = 0x336699; // the background, pen and brush of the GDI measurement
  const PEN = 0x0f0ff0;
  const FILL = 0xf0f00f;

  /** Draws one of everything on a small surface in pen mode `mode`. */
  function scene(mode: number): Surface {
    const surface = surfaceOf(D, 64, 48);
    surface.setLineColor(PEN);
    surface.setFillColor(FILL);
    surface.setDrawingMode(mode);
    surface.drawPixel(2, 2); // a pixel
    surface.line(5, 2, 15, 6); // a thin line: body (5,2) and end point (15,6)
    surface.rectangle(20, 2, 30, 10); // outline (20,2), interior (25,6)
    surface.unfilledRectangle(34, 2, 44, 10); // outline (34,2), interior untouched (39,6)
    surface.ellipse(2, 14, 22, 30); // outline (12,14), interior (12,22)
    surface.unfilledEllipse(26, 14, 46, 30); // outline (36,14), interior untouched (36,22)
    surface.unfilledRectangle(40, 34, 62, 46); // a box for the flood fill
    surface.setPenWidth(4);
    surface.rectangle(2, 34, 14, 46); // wide outline (0,32) and (3,35), interior (8,40)
    surface.line(50, 4, 50, 20); // wide line body (50,10); the end point (50,20) is combined twice
    surface.rectangle(58, 4, 58, 4); // the dot of a one-point rectangle
    surface.setPenWidth(1);
    surface.floodFill(50, 40); // the inside of the box: (50,40), (41,35)
    return surface;
  }

  it('every value 0-255 draws as the mode of the table, on pixels, lines, end points, outlines, interiors and flood fills', () => {
    for (let value = 0; value < 256; value++) {
      if (value === 16 || value === 17) continue; // the double-buffer switches
      const mode = MODE_TABLE[value] as number;
      const surface = scene(value);
      expect(surface.state.penMode, `value ${value}`).toBe(value);
      const pen = rop(mode, PEN, D);
      const fill = rop(mode, FILL, D);
      const at = (x: number, y: number) => surface.getPixel(x, y);
      const name = `value ${value} (mode ${mode})`;
      if (pen !== D) {
        expect(at(2, 2), `${name}: pixel`).toBe(pen);
        expect(at(5, 2), `${name}: line body`).toBe(pen);
        expect(at(10, 4), `${name}: line body`).toBe(pen);
        expect(at(15, 6), `${name}: end point`).toBe(pen);
        expect(at(20, 2), `${name}: rectangle outline`).toBe(pen);
        expect(at(30, 10), `${name}: rectangle outline`).toBe(pen);
        expect(at(34, 2), `${name}: unfilled rectangle outline`).toBe(pen);
        expect(at(12, 14), `${name}: ellipse outline`).toBe(pen);
        expect(at(36, 14), `${name}: unfilled ellipse outline`).toBe(pen);
        expect(at(0, 32), `${name}: wide outline`).toBe(pen);
        expect(at(3, 35), `${name}: wide outline`).toBe(pen);
        expect(at(50, 10), `${name}: wide line body`).toBe(pen);
        expect(at(50, 20), `${name}: wide line end point, combined twice`).toBe(rop(mode, PEN, pen));
        expect(at(58, 4), `${name}: dot`).toBe(pen);
      }
      if (fill !== D) {
        expect(at(25, 6), `${name}: rectangle interior`).toBe(fill);
        expect(at(12, 22), `${name}: ellipse interior`).toBe(fill);
        expect(at(8, 40), `${name}: wide rectangle interior`).toBe(fill);
        expect(at(50, 40), `${name}: flood fill`).toBe(fill);
        expect(at(41, 35), `${name}: flood fill reaches the corner of its box`).toBe(fill);
      }
      if (pen !== D && fill !== D) {
        // task 90 and task 91 leave the inside alone, and the flood fill stays inside its box
        expect(at(39, 6), `${name}: inside the unfilled rectangle`).toBe(D);
        expect(at(36, 22), `${name}: inside the unfilled ellipse`).toBe(D);
        expect(at(63, 47), `${name}: outside the flood fill's box`).toBe(D);
      }
      if (pen === D && fill === D) expect(countPixels(surface.back, D), name).toBe(64 * 48); // mode 2
    }
  }, 120_000);

  it('the sixteen operations each differ from the fifteen others on this scene', () => {
    const hashes = new Set(Array.from({ length: 16 }, (_, mode) => hashPixels(scene(mode).back)));
    expect(hashes.size).toBe(16);
  });

  it('16 and 17 are the double-buffer switches and leave the pen mode alone', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(14);
    surface.setDrawingMode(17);
    expect(surface.state.penMode).toBe(14);
    expect(surface.state.doubleBuffer).toBe(true);
    surface.setDrawingMode(16);
    expect(surface.state.penMode).toBe(14);
    expect(surface.state.doubleBuffer).toBe(false);
  });

  it('only the low byte of the argument counts (D1.B)', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(0x12340e);
    expect(surface.state.penMode).toBe(14);
    surface.setDrawingMode(0x111);
    expect(surface.state.doubleBuffer).toBe(true);
    surface.setDrawingMode(-240); // $FFFFFF10
    expect(surface.state.doubleBuffer).toBe(false);
    surface.setPenWidth(0x1ff);
    expect(surface.state.penWidth).toBe(255);
  });

  it('text, clear and scroll ignore the mode', () => {
    const surface = surfaceOf(D, 64, 48);
    surface.setFillColor(RED);
    surface.setDrawingMode(14);
    surface.textOut(0, 0, [LETTER], 8, GREEN, 'both');
    expect(surface.getPixel(0, 0)).toBe(RED);
    expect(surface.getPixel(3, 3)).toBe(GREEN);
    surface.fillBlack({ left: 0, top: 20, right: 64, bottom: 30 });
    expect(surface.getPixel(5, 25)).toBe(BLACK);
    surface.copyRect({ left: 0, top: 30, right: 8, bottom: 45 }, { left: 0, top: 0, right: 8, bottom: 15 });
    expect(surface.getPixel(3, 33)).toBe(GREEN);
  });
});

describe('the two pen positions (trap15-b §5.5, row by row)', () => {
  const pens = (surface: Surface) => [surface.state.backPen, surface.state.windowPen];

  it('row 1 - task 86 move to (x,y): both positions, even when double buffering', () => {
    const surface = new Surface(640, 480);
    surface.moveTo(11, 22);
    expect(pens(surface)).toEqual([
      { x: 11, y: 22 },
      { x: 11, y: 22 },
    ]);
    surface.setDrawingMode(17);
    surface.moveTo(33, 44);
    expect(pens(surface)).toEqual([
      { x: 33, y: 44 },
      { x: 33, y: 44 },
    ]);
  });

  it('row 2 - task 84 line: back buffer (x2,y2); window (x2,y2) only if not double buffering', () => {
    const surface = new Surface(640, 480);
    surface.line(1, 2, 30, 40);
    expect(pens(surface)).toEqual([
      { x: 30, y: 40 },
      { x: 30, y: 40 },
    ]);
    surface.setDrawingMode(17);
    surface.line(5, 6, 70, 80);
    expect(pens(surface)).toEqual([
      { x: 70, y: 80 },
      { x: 30, y: 40 },
    ]);
  });

  it('row 3 - task 85 line to: back buffer (x,y); window (x,y) only if not double buffering', () => {
    const surface = new Surface(640, 480);
    surface.lineTo(30, 40);
    expect(pens(surface)).toEqual([
      { x: 30, y: 40 },
      { x: 30, y: 40 },
    ]);
    surface.setDrawingMode(17);
    surface.lineTo(70, 80);
    expect(pens(surface)).toEqual([
      { x: 70, y: 80 },
      { x: 30, y: 40 },
    ]);
  });

  it('row 4 - task 95 text at (x,y): (x + TextWidth, y); the window only if not double buffering', () => {
    const surface = new Surface(640, 480);
    surface.textOut(50, 60, [LETTER, LETTER], 16, WHITE, 'both'); // V2: "AB" at (50,60) gives (66,60)
    expect(pens(surface)).toEqual([
      { x: 66, y: 60 },
      { x: 66, y: 60 },
    ]);
    expect(surface.getXY()).toEqual([66, 60]);
    surface.setDrawingMode(17);
    surface.textOut(100, 200, [LETTER], 8, WHITE, 'both');
    expect(pens(surface)).toEqual([
      { x: 108, y: 200 },
      { x: 66, y: 60 },
    ]);
  });

  it('row 4 - the extent moves the pen even where fewer pixels are painted (control bytes), and an empty string moves it to (x,y)', () => {
    const surface = new Surface(640, 480);
    surface.textOut(10, 20, [LETTER, LETTER, LETTER], 48, WHITE, 'both'); // 'A',9,'B',13,10,'C': six bytes
    expect(surface.getXY()).toEqual([58, 20]);
    surface.textOut(300, 310, [], 0, WHITE, 'both');
    expect(pens(surface)).toEqual([
      { x: 300, y: 310 },
      { x: 300, y: 310 },
    ]);
    expect(countPixels(surface.back, WHITE)).toBe(12); // only the three letters were painted
  });

  it('row 5 - a printed character: (cell x + character width, cell y), the same TextOut', () => {
    const surface = new Surface(640, 480);
    surface.textOut(8 * 3, 15 * 2, [LETTER], 8, WHITE, 'both'); // column 3, row 2 of the default grid
    expect(pens(surface)).toEqual([
      { x: 32, y: 30 },
      { x: 32, y: 30 },
    ]);
  });

  it('row 6 - the blinking prompt: back buffer unchanged; window (prompt x + character width, text y)', () => {
    const surface = new Surface(640, 480);
    surface.moveTo(5, 5);
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window');
    expect(pens(surface)).toEqual([
      { x: 5, y: 5 },
      { x: 88, y: 45 },
    ]);
    expect(surface.getXY()).toEqual([88, 45]);
  });

  it('row 7 - the prompt erase: back buffer unchanged; window (prompt x + width of a space, text y), also while double buffering', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.moveTo(5, 5);
    surface.textOut(80, 45, [BLANK], 8, WHITE, 'window');
    expect(pens(surface)).toEqual([
      { x: 5, y: 5 },
      { x: 88, y: 45 },
    ]);
  });

  it('row 8 - tasks 82, 83, 87-91, 89, clear, scroll and repaint leave both positions alone', () => {
    for (const buffered of [false, true]) {
      const surface = new Surface(640, 480);
      surface.moveTo(123, 45);
      if (buffered) surface.setDrawingMode(17);
      surface.drawPixel(1, 1);
      surface.getPixel(1, 1);
      surface.rectangle(10, 10, 20, 20);
      surface.ellipse(30, 30, 60, 50);
      surface.floodFill(200, 200);
      surface.unfilledRectangle(70, 70, 90, 90);
      surface.unfilledEllipse(100, 100, 140, 130);
      surface.fillBlack({ left: 0, top: 0, right: 640, bottom: 480 });
      surface.copyRect({ left: 0, top: 0, right: 640, bottom: 465 }, { left: 0, top: 15, right: 640, bottom: 480 });
      surface.formPaint();
      surface.setLineColor(RED);
      surface.setFillColor(RED);
      surface.setPenWidth(3);
      surface.setDrawingMode(7);
      expect(pens(surface), buffered ? 'double buffering' : 'not double buffering').toEqual([
        { x: 123, y: 45 },
        { x: 123, y: 45 },
      ]);
    }
  });

  it('row 9 - task 92 mode 16: window := back buffer position; back buffer unchanged', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.moveTo(5, 5);
    surface.line(5, 5, 100, 100);
    expect(pens(surface)).toEqual([
      { x: 100, y: 100 },
      { x: 5, y: 5 },
    ]);
    surface.setDrawingMode(16);
    expect(pens(surface)).toEqual([
      { x: 100, y: 100 },
      { x: 100, y: 100 },
    ]);
  });

  it('row 9 - mode 16 copies the position also when double buffering was already off', () => {
    const surface = new Surface(640, 480);
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window'); // the prompt moved the window pen alone
    expect(pens(surface)).toEqual([
      { x: 0, y: 0 },
      { x: 88, y: 45 },
    ]);
    surface.setDrawingMode(16);
    expect(pens(surface)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ]);
  });

  it('row 10 - setWindowSize: back buffer := window position; window unchanged', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.moveTo(5, 5);
    surface.line(5, 5, 100, 100);
    surface.resize(0, 0);
    expect(pens(surface)).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
    surface.line(7, 7, 9, 9);
    surface.resize(800, 600);
    expect(pens(surface)).toEqual([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]);
  });

  it('task 96 returns the window position: V5 - mode 17, task 86 (5,5), task 84 to (100,100), task 96 gives (5,5)', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.moveTo(5, 5);
    surface.line(5, 5, 100, 100);
    expect(surface.getXY()).toEqual([5, 5]);
  });

  it('drawing uses the back buffer position: a line-to after the prompt starts where the last line ended', () => {
    const surface = new Surface(640, 480);
    surface.moveTo(10, 10);
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window'); // window pen (88,45), back pen (10,10)
    surface.lineTo(14, 10);
    expect(picture(surface.back, 8, 9, 17, 12)).toEqual(['.........', '..#####..', '.........']);
  });

  it('a simulator reset leaves both positions equal to the window position from before it (trap15-b §3.2)', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.moveTo(40, 50);
    surface.lineTo(300, 200); // back (300,200), window (40,50)
    // initSim(): clear, setWindowSize(0,0), mode 4, mode 16, width 1, pen white, fill black
    surface.fillBlack({ left: 0, top: 0, right: 640, bottom: 480 });
    surface.resize(0, 0);
    surface.setDrawingMode(4);
    surface.setDrawingMode(16);
    surface.setPenWidth(1);
    surface.setLineColor(0x00ffffff);
    surface.setFillColor(0);
    expect(surface.state).toEqual({ ...STARTUP_STATE, backPen: { x: 40, y: 50 }, windowPen: { x: 40, y: 50 } });
  });
});

describe('double buffering (task 92 modes 16 and 17, task 94; trap15-b §5.6)', () => {
  it('mode 17: from now on drawing goes to the back buffer only; the screen keeps its picture', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(RED);
    surface.drawPixel(1, 1);
    surface.setDrawingMode(17);
    expect(surface.state.doubleBuffer).toBe(true);
    expect(surface.window).not.toBeNull();
    expect(surface.window).not.toBe(surface.back);
    expect(pixelAt(shown(surface), 1, 1)).toBe(RED); // what was on screen stays on screen
    surface.takeDirty();

    surface.drawPixel(2, 2);
    surface.rectangle(10, 10, 50, 50);
    surface.floodFill(300, 300);
    surface.textOut(100, 100, [LETTER], 8, WHITE, 'both');
    expect(surface.getPixel(2, 2)).toBe(RED);
    expect(pixelAt(shown(surface), 2, 2)).toBe(BLACK);
    expect(countPixels(shown(surface), BLACK)).toBe(640 * 480 - 1);
    expect(surface.takeDirty()).toBeNull(); // nothing changed on screen
  });

  it('task 94 copies the whole back buffer to the window at once', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.takeDirty();
    surface.setLineColor(RED);
    surface.drawPixel(2, 2);
    surface.drawPixel(600, 400);
    surface.formPaint();
    expect(shown(surface).data).toEqual(surface.back.data);
    const dirty = changed(surface);
    expect(dirty.left <= 2 && dirty.top <= 2 && dirty.right > 600 && dirty.bottom > 400).toBe(true);
    expect(surface.state.doubleBuffer).toBe(true); // still buffering
    surface.drawPixel(3, 3);
    expect(pixelAt(shown(surface), 3, 3)).toBe(BLACK);
  });

  it('task 94 is legal while double buffering is off', () => {
    const surface = new Surface(640, 480);
    surface.drawPixel(2, 2);
    surface.formPaint();
    expect(surface.window).toBeNull();
    expect(surface.getPixel(2, 2)).toBe(WHITE);
  });

  it('mode 16 switches it off and shows the back buffer immediately', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.takeDirty();
    surface.drawPixel(20, 30);
    surface.setDrawingMode(16);
    expect(surface.state.doubleBuffer).toBe(false);
    expect(surface.window).toBeNull(); // the screen shows `back`
    const dirty = changed(surface);
    expect(dirty.left <= 20 && dirty.right > 20 && dirty.top <= 30 && dirty.bottom > 30).toBe(true);
    surface.drawPixel(21, 31);
    expect(surface.takeDirty()).not.toBeNull(); // drawing shows again
  });

  it('mode 17 does nothing else: asked again while on, it does not bring the screen up to date', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.drawPixel(2, 2);
    const window = surface.window;
    surface.setDrawingMode(17);
    expect(surface.window).toBe(window);
    expect(pixelAt(shown(surface), 2, 2)).toBe(BLACK);
  });

  it('switching on and off repeatedly keeps showing the right picture', () => {
    const surface = new Surface(640, 480);
    for (let frame = 0; frame < 5; frame++) {
      surface.setDrawingMode(17);
      surface.setLineColor(frame % 2 ? RED : GREEN);
      surface.setFillColor(frame % 2 ? RED : GREEN);
      surface.rectangle(0, 0, 639, 479);
      expect(countPixels(shown(surface), frame % 2 ? RED : GREEN)).toBe(0);
      surface.setDrawingMode(16);
      expect(surface.window).toBeNull();
      expect(countPixels(surface.back, frame % 2 ? RED : GREEN)).toBe(640 * 480);
    }
  });

  it('setWindowSize blacks the window directly, also while double buffering, and keeps the switch', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(RED);
    surface.setFillColor(RED);
    surface.rectangle(0, 0, 639, 479);
    surface.setDrawingMode(17);
    surface.resize(0, 0);
    expect(surface.state.doubleBuffer).toBe(true);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    expect(countPixels(shown(surface), BLACK)).toBe(640 * 480);
    expect(surface.takeDirty()).toEqual({ left: 0, top: 0, right: 640, bottom: 480 });
  });
});

describe('resize (setWindowSize, trap15-b §4.3)', () => {
  it('each side is at least 640 and 480, independently', () => {
    const surface = new Surface(640, 480);
    const sizes: [number, number, number, number][] = [
      [800, 600, 800, 600],
      [100, 100, 640, 480],
      [1000, 100, 1000, 480],
      [100, 1000, 640, 1000],
      [639, 479, 640, 480],
      [1920, 1200, 1920, 1200],
      [0, 500, 640, 500],
      [700, 0, 700, 480],
    ];
    for (const [width, height, columns, rows] of sizes) {
      surface.resize(width, height);
      expect([surface.back.width, surface.back.height], `${width} x ${height}`).toEqual([columns, rows]);
      expect(surface.back.data).toHaveLength(columns * rows);
    }
  });

  it('(0,0) keeps the current size', () => {
    const surface = new Surface(640, 480);
    surface.resize(1024, 768);
    surface.resize(0, 0);
    expect([surface.back.width, surface.back.height]).toEqual([1024, 768]);
  });

  it('the port clamps each side to MAX_SURFACE (the original accepts up to 65535)', () => {
    const surface = new Surface(640, 480);
    surface.resize(65535, 700);
    expect([surface.back.width, surface.back.height]).toEqual([MAX_SURFACE, 700]);
    surface.resize(800, 5000);
    expect([surface.back.width, surface.back.height]).toEqual([800, MAX_SURFACE]);
    surface.resize(-1, 480); // the parameters are unsigned 16-bit: 65535
    expect(surface.back.width).toBe(MAX_SURFACE);
    expect(MAX_SURFACE).toBe(4096);
  });

  it('every call blacks the whole surface, including a call that does not change the size', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    surface.rectangle(0, 0, 639, 479);
    surface.resize(640, 480);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    surface.rectangle(0, 0, 639, 479);
    surface.resize(0, 0);
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    surface.rectangle(0, 0, 639, 479);
    surface.resize(800, 600);
    expect(countPixels(surface.back, BLACK)).toBe(800 * 600);
  });

  it('keeps pen colour, fill colour, pen width, pen mode and the double-buffer switch', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(RED);
    surface.setFillColor(GREEN);
    surface.setPenWidth(5);
    surface.setDrawingMode(14);
    surface.setDrawingMode(17);
    surface.resize(800, 600);
    expect(surface.state).toMatchObject({
      penColor: RED,
      fillColor: GREEN,
      penWidth: 5,
      penMode: 14,
      doubleBuffer: true,
    });
    expect([shown(surface).width, shown(surface).height]).toEqual([800, 600]);
  });

  it('a new size gives new buffer objects; the same size keeps them', () => {
    const surface = new Surface(640, 480);
    const first = surface.back;
    surface.resize(640, 480);
    expect(surface.back).toBe(first);
    surface.resize(800, 600);
    expect(surface.back).not.toBe(first);
    expect(first.width).toBe(640); // the old object is not changed under its holders
  });

  it('removes the prompt cell and reports the whole surface as changed', () => {
    const surface = new Surface(640, 480);
    surface.textOut(0, 0, [UNDERSCORE], 8, WHITE, 'window');
    surface.takeDirty();
    surface.resize(800, 600);
    expect(surface.overlay).toBeNull();
    expect(surface.takeDirty()).toEqual({ left: 0, top: 0, right: 800, bottom: 600 });
  });
});

describe('clipping (ARCHITECTURE.md 3.4 rule 12)', () => {
  it('a surface shows exactly its part of a larger picture, for every primitive and pen width', () => {
    // The same random scene on a 64 x 48 surface and, shifted by (64,48), on one of 192 x 144.
    const random = createRandom(3_4);
    for (let round = 0; round < 40; round++) {
      const small = new Surface(64, 48);
      const large = new Surface(192, 144);
      large.moveTo(64, 48);
      for (let n = 0; n < 40; n++) {
        const [x1, y1, x2, y2] = [random.int(-60, 123), random.int(-44, 91), random.int(-60, 123), random.int(-44, 91)];
        const kind = random.int(0, 9);
        const color = random.int(0, 0xffffff);
        const width = random.pick([0, 1, 1, 1, 2, 3, 4, 5, 8, 12]);
        const mode = random.pick([4, 4, 4, 14, 3, 7, 10]);
        for (const [surface, dx, dy] of [
          [small, 0, 0],
          [large, 64, 48],
        ] as const) {
          surface.setPenWidth(width);
          surface.setDrawingMode(mode);
          surface.setLineColor(color);
          surface.setFillColor(color ^ 0x00ffff);
          if (kind === 0) surface.drawPixel(x1 + dx, y1 + dy);
          else if (kind <= 2) surface.line(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
          else if (kind === 3) surface.lineTo(x2 + dx, y2 + dy);
          else if (kind <= 5) surface.rectangle(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
          else if (kind === 6) surface.unfilledRectangle(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
          else if (kind === 7) surface.ellipse(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
          else if (kind === 8) surface.unfilledEllipse(x1 + dx, y1 + dy, x2 + dx, y2 + dy);
          else surface.moveTo(x1 + dx, y1 + dy);
        }
      }
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 64; x++) {
          if (pixelAt(small.back, x, y) !== pixelAt(large.back, x + 64, y + 48)) {
            expect.fail(`round ${round}: pixel (${x},${y}) differs`);
          }
        }
      }
    }
  }, 120_000);

  it('no coordinate is an error: every method takes the corners of the 16-bit space', () => {
    const surface = new Surface(640, 480);
    const far = [-32768, 32767, -1, 0, 640, 480];
    surface.setPenWidth(255);
    for (const x1 of far) {
      for (const y1 of far) {
        surface.drawPixel(x1, y1);
        surface.floodFill(x1, y1);
        surface.moveTo(x1, y1);
        surface.getPixel(x1, y1);
        for (const [x2, y2] of [
          [-32768, -32768],
          [32767, 32767],
          [32767, -32768],
          [5, 5],
        ] as const) {
          surface.line(x1, y1, x2, y2);
          surface.lineTo(x2, y2);
          surface.rectangle(x1, y1, x2, y2);
          surface.unfilledRectangle(x1, y1, x2, y2);
          surface.ellipse(x1, y1, x2, y2);
          surface.unfilledEllipse(x1, y1, x2, y2);
        }
        surface.fillBlack({ left: x1, top: y1, right: 32767, bottom: 32767 });
        surface.copyRect(
          { left: x1, top: y1, right: x1 + 700, bottom: y1 + 500 },
          { left: 0, top: 0, right: 700, bottom: 500 },
        );
        surface.textOut(x1, y1, [LETTER], 8, WHITE, 'both');
        surface.textOut(x1, y1, [LETTER], 8, WHITE, 'window');
      }
    }
    expect(surface.back.data).toHaveLength(640 * 480);
    for (const pixel of surface.back.data.subarray(0, 2000)) expect(pixel >>> 24).toBe(0xff);
  }, 120_000);
});

describe('ellipses: what the surface itself decides (tasks 88 and 91, trap15-b §6.4)', () => {
  it('nothing is drawn if x1 + y1 + x2 + y2 is 32768 or more; a negative sum passes', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    surface.ellipse(-15999, -16000, 32000, 32767); // sum 32768: nothing, and no error
    surface.unfilledEllipse(-15999, -16000, 32000, 32767);
    surface.ellipse(32000, 32767, -15999, -16000); // the same box, corners reversed
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    surface.ellipse(-16000, -16000, 32000, 32767); // sum 32767: the surface lies inside this ellipse
    expect(countPixels(surface.back, RED)).toBe(640 * 480);
    surface.setFillColor(GREEN);
    surface.ellipse(-32768, -32768, 32767, 32767); // sum -2
    expect(countPixels(surface.back, GREEN)).toBe(640 * 480);
  });

  it('reversed corners are swapped per axis', () => {
    const straight = new Surface(640, 480);
    straight.setFillColor(RED);
    straight.ellipse(10, 20, 90, 60);
    for (const [x1, y1, x2, y2] of [
      [90, 60, 10, 20],
      [90, 20, 10, 60],
      [10, 60, 90, 20],
    ] as const) {
      const other = new Surface(640, 480);
      other.setFillColor(RED);
      other.ellipse(x1, y1, x2, y2);
      expect(hashPixels(other.back)).toBe(hashPixels(straight.back));
    }
  });

  it('task 91 leaves the inside untouched and the fill colour as it was', () => {
    const surface = surfaceOf(GREEN);
    surface.setFillColor(RED);
    surface.unfilledEllipse(10, 20, 90, 60);
    expect(surface.getPixel(50, 40)).toBe(GREEN);
    expect(surface.getPixel(50, 20)).toBe(WHITE);
    expect(surface.state.fillColor).toBe(RED);
    expect(countPixels(surface.back, RED)).toBe(0);
  });
});

describe('flood fill through the surface (task 89)', () => {
  it('uses the fill colour, reads the back buffer and stops at the surface edge', () => {
    const surface = new Surface(640, 480);
    surface.unfilledRectangle(100, 100, 200, 200);
    surface.setFillColor(RED);
    surface.floodFill(150, 150);
    expect(countPixels(surface.back, RED)).toBe(99 * 99);
    surface.setFillColor(BLUE);
    surface.floodFill(0, 0);
    expect(countPixels(surface.back, BLUE)).toBe(640 * 480 - 101 * 101);
    surface.floodFill(-1, 0);
    surface.floodFill(640, 479);
    expect(countPixels(surface.back, WHITE)).toBe(400);
  });
});

describe('TextOut (trap15-b §5.2, §6.7; ARCHITECTURE.md 3.5.3)', () => {
  it("target 'both': an opaque cell in the fill colour, the glyph in the font colour (V1)", () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    surface.textOut(10, 10, [LETTER], 8, GREEN, 'both');
    expect(surface.getPixel(10, 10)).toBe(RED); // V1: task 81 red, text at (10,10), the pixel there is red
    expect(surface.getPixel(17, 24)).toBe(RED);
    expect(surface.getPixel(18, 10)).toBe(BLACK);
    expect(surface.getPixel(10, 25)).toBe(BLACK);
    expect(surface.getPixel(13, 13)).toBe(GREEN);
    expect(countPixels(surface.back, RED)).toBe(8 * 15 - 4);
  });

  it('the font colour takes the colour forms of §4.6; the pen colour plays no part', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(RED);
    surface.textOut(0, 0, [LETTER], 8, 0x80000005 | 0, 'both');
    expect(surface.getPixel(3, 3)).toBe(WHITE);
    surface.textOut(0, 0, [LETTER], 8, 0x0100000d, 'both');
    expect(surface.getPixel(3, 3)).toBe(0x0000ff);
  });

  it('text is clipped at the surface edge', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    surface.textOut(636, 470, [LETTER, LETTER], 16, WHITE, 'both');
    expect(countPixels(surface.back, RED)).toBe(4 * 10 - 2); // 4 x 10 visible, two glyph pixels among them
    expect(surface.getPixel(639, 473)).toBe(WHITE);
    expect(surface.getPixel(639, 474)).toBe(WHITE);
    expect(surface.state.backPen).toEqual({ x: 652, y: 470 }); // the pen moves on regardless
  });

  it("target 'window': the prompt cell goes into the overlay; the back buffer is untouched", () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(RED);
    surface.takeDirty();
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window');
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    const overlay = promptCell(surface);
    expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([80, 45, 8, 15]);
    expect(overlay.pixels).toHaveLength(8 * 15);
    const cell = { width: 8, height: 15, data: overlay.pixels };
    expect(picture(cell, 0, 11, 8, 14)).toEqual(['RRRRRRRR', 'R######R', 'RRRRRRRR']);
    expect(overlay.pixels[0]).toBe(0xff0000ff); // stored like surface pixels
    expect(surface.takeDirty()).toEqual({ left: 80, top: 45, right: 88, bottom: 60 });
  });

  it('a second prompt cell replaces the first, and both places are reported as changed', () => {
    const surface = new Surface(640, 480);
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window');
    surface.takeDirty();
    surface.textOut(200, 300, [BLANK], 8, WHITE, 'window');
    expect([promptCell(surface).x, promptCell(surface).y]).toEqual([200, 300]);
    expect(surface.takeDirty()).toEqual({ left: 80, top: 45, right: 208, bottom: 315 });
  });

  it('the prompt cell is cut to the surface, and is absent when it lies outside', () => {
    const surface = new Surface(640, 480);
    surface.textOut(636, 470, [UNDERSCORE], 8, WHITE, 'window');
    const overlay = promptCell(surface);
    expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([636, 470, 4, 10]);
    surface.textOut(700, 500, [UNDERSCORE], 8, WHITE, 'window');
    expect(surface.overlay).toBeNull();
    expect(surface.getXY()).toEqual([708, 500]); // the window pen moves all the same
  });

  it('any presentation from the back buffer removes the prompt cell: a drawing call while not double buffered, task 94, mode 16', () => {
    const calls: [string, (surface: Surface) => void][] = [
      ['drawPixel', (s) => s.drawPixel(1, 1)],
      ['line', (s) => s.line(1, 1, 5, 5)],
      ['lineTo', (s) => s.lineTo(5, 5)],
      ['rectangle', (s) => s.rectangle(1, 1, 5, 5)],
      ['unfilledRectangle', (s) => s.unfilledRectangle(1, 1, 5, 5)],
      ['ellipse', (s) => s.ellipse(1, 1, 5, 5)],
      ['unfilledEllipse', (s) => s.unfilledEllipse(1, 1, 5, 5)],
      ['floodFill', (s) => s.floodFill(1, 1)],
      ['fillBlack', (s) => s.fillBlack({ left: 0, top: 0, right: 5, bottom: 5 })],
      [
        'copyRect',
        (s) => s.copyRect({ left: 0, top: 0, right: 5, bottom: 5 }, { left: 5, top: 5, right: 10, bottom: 10 }),
      ],
      ['textOut both', (s) => s.textOut(0, 0, [LETTER], 8, WHITE, 'both')],
      ['formPaint', (s) => s.formPaint()],
      ['mode 16', (s) => s.setDrawingMode(16)],
    ];
    for (const [name, call] of calls) {
      const surface = new Surface(640, 480);
      surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window');
      surface.takeDirty();
      call(surface);
      expect(surface.overlay, name).toBeNull();
      const dirty = changed(surface);
      expect(dirty.left <= 80 && dirty.top <= 45 && dirty.right >= 88 && dirty.bottom >= 60, name).toBe(true);
    }
  });

  it('state changes and reads do not remove the prompt cell', () => {
    const surface = new Surface(640, 480);
    surface.textOut(80, 45, [UNDERSCORE], 8, WHITE, 'window');
    surface.moveTo(3, 3);
    surface.setLineColor(RED);
    surface.setFillColor(RED);
    surface.setPenWidth(2);
    surface.setDrawingMode(14);
    surface.getPixel(1, 1);
    surface.getXY();
    surface.takeDirty();
    expect(surface.overlay).not.toBeNull();
  });

  it('while double buffering, drawing keeps the prompt cell (the erase cell stays until the window is refreshed)', () => {
    const surface = new Surface(640, 480);
    surface.setDrawingMode(17);
    surface.textOut(80, 45, [BLANK], 8, WHITE, 'window'); // erasePrompt draws even while double buffering
    expect(surface.overlay).not.toBeNull();
    surface.drawPixel(1, 1);
    surface.rectangle(0, 0, 100, 100);
    surface.textOut(0, 0, [LETTER], 8, WHITE, 'both');
    expect(surface.overlay).not.toBeNull();
    surface.formPaint();
    expect(surface.overlay).toBeNull();
  });

  it('the prompt cell is painted over what the screen shows: the window while double buffering', () => {
    const surface = new Surface(640, 480);
    surface.setFillColor(GREEN);
    surface.setDrawingMode(17);
    surface.setLineColor(RED);
    surface.setFillColor(RED);
    surface.rectangle(0, 0, 639, 479); // back buffer red, the screen still black
    surface.setFillColor(GREEN);
    // a slanted glyph that reaches two pixels past its cell
    const slanted: Glyph = { advance: 2, width: 4, height: 1, coverage: Uint8Array.of(0, 0, 255, 0) };
    surface.textOut(10, 10, [slanted], 2, WHITE, 'window');
    const overlay = promptCell(surface);
    expect([overlay.x, overlay.y, overlay.width, overlay.height]).toEqual([10, 10, 4, 1]);
    expect(Array.from(overlay.pixels, (pixel) => pixel & 0xffffff)).toEqual([GREEN, GREEN, WHITE, BLACK]);
  });
});

describe('block operations of the text screen', () => {
  it('fillBlack is black whatever the fill colour and the mode, and is clipped', () => {
    const surface = surfaceOf(GREEN);
    surface.setFillColor(RED);
    surface.setDrawingMode(1);
    surface.fillBlack({ left: 600, top: 400, right: 700, bottom: 500 });
    expect(countPixels(surface.back, BLACK)).toBe(40 * 80);
    expect(surface.getPixel(600, 400)).toBe(BLACK);
    expect(surface.getPixel(599, 400)).toBe(GREEN);
    expect(surface.takeDirty()).toEqual({ left: 600, top: 400, right: 640, bottom: 480 });
    surface.fillBlack({ left: 10, top: 10, right: 10, bottom: 20 }); // empty
    surface.fillBlack({ left: -50, top: -50, right: 0, bottom: 0 }); // outside
    expect(countPixels(surface.back, BLACK)).toBe(40 * 80);
  });

  it('scroll(): the whole picture moves up one text row and the bottom row is black; graphics scroll with the text', () => {
    const surface = new Surface(640, 480);
    surface.setLineColor(RED);
    surface.line(0, 15, 639, 15); // first pixel row of text row 1
    surface.setLineColor(GREEN);
    surface.line(0, 479, 639, 479); // last pixel row
    surface.drawPixel(7, 100);
    surface.takeDirty();
    // simIOu.cpp scroll(): CopyRect(TopRect, BotRect), then the bottom row black
    surface.copyRect({ left: 0, top: 0, right: 640, bottom: 465 }, { left: 0, top: 15, right: 640, bottom: 480 });
    surface.fillBlack({ left: 0, top: 465, right: 640, bottom: 480 });
    expect(countPixels(surface.back, RED)).toBe(640);
    expect(surface.getPixel(300, 0)).toBe(RED);
    expect(surface.getPixel(300, 464)).toBe(GREEN);
    expect(surface.getPixel(7, 85)).toBe(GREEN);
    expect(countPixels(surface.back, GREEN)).toBe(641);
    expect(surface.takeDirty()).toEqual({ left: 0, top: 0, right: 640, bottom: 480 });
  });

  it('overlapping copies behave like BitBlt: as if the source were read first, in all four directions', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [3, 2],
      [-3, 2],
      [3, -2],
      [-3, -2],
    ] as const) {
      const surface = new Surface(64, 48);
      const random = createRandom(8);
      for (let i = 0; i < surface.back.data.length; i++) surface.back.data[i] = 0xff000000 + random.int(0, 0xffffff);
      const before = surface.back.data.slice();
      const source = { left: 10, top: 10, right: 40, bottom: 30 };
      surface.copyRect({ left: 10 + dx, top: 10 + dy, right: 40 + dx, bottom: 30 + dy }, source);
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 64; x++) {
          const moved = x - dx >= 10 && x - dx < 40 && y - dy >= 10 && y - dy < 30;
          const expected = moved ? before[(y - dy) * 64 + x - dx] : before[y * 64 + x];
          if (surface.back.data[y * 64 + x] !== expected) expect.fail(`shift (${dx},${dy}): pixel (${x},${y})`);
        }
      }
    }
  });

  it('a copy that leaves the surface moves what exists at both places and leaves the rest alone', () => {
    const surface = new Surface(64, 48);
    const random = createRandom(9);
    for (let i = 0; i < surface.back.data.length; i++) surface.back.data[i] = 0xff000000 + random.int(0, 0xffffff);
    const before = surface.back.data.slice();
    // scrollRect of a text rectangle that is wider and taller than the surface: up by 15 pixels
    surface.copyRect({ left: 8, top: 0, right: 2040, bottom: 1890 }, { left: 8, top: 15, right: 2040, bottom: 1905 });
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const expected = x >= 8 && y + 15 < 48 ? before[(y + 15) * 64 + x] : before[y * 64 + x];
        if (surface.back.data[y * 64 + x] !== expected) expect.fail(`pixel (${x},${y})`);
      }
    }
    // entirely outside: nothing happens
    surface.copyRect({ left: 100, top: 100, right: 120, bottom: 120 }, { left: 0, top: 0, right: 20, bottom: 20 });
    surface.copyRect({ left: 0, top: 0, right: 20, bottom: 20 }, { left: -40, top: -40, right: -20, bottom: -20 });
  });

  it('while double buffering the block operations change the back buffer only', () => {
    const surface = surfaceOf(GREEN);
    surface.setDrawingMode(17);
    surface.fillBlack({ left: 0, top: 0, right: 640, bottom: 480 });
    expect(countPixels(surface.back, BLACK)).toBe(640 * 480);
    expect(countPixels(shown(surface), GREEN)).toBe(640 * 480);
    expect(surface.takeDirty()).toBeNull();
  });
});

describe('takeDirty', () => {
  it('a new surface is to be shown completely, once', () => {
    const surface = new Surface(640, 480);
    expect(surface.takeDirty()).toEqual({ left: 0, top: 0, right: 640, bottom: 480 });
    expect(surface.takeDirty()).toBeNull();
  });

  it('reports a box around what changed, inside the surface, and forgets it', () => {
    const surface = new Surface(640, 480);
    surface.takeDirty();
    surface.drawPixel(10, 20);
    expect(surface.takeDirty()).toEqual({ left: 10, top: 20, right: 11, bottom: 21 });
    surface.drawPixel(10, 20);
    surface.drawPixel(300, 200);
    expect(surface.takeDirty()).toEqual({ left: 10, top: 20, right: 301, bottom: 201 });
    expect(surface.takeDirty()).toBeNull();
    surface.drawPixel(-5, -5); // nothing on the surface changed
    expect(surface.takeDirty()).toBeNull();
  });

  it('covers every changed pixel of every primitive', () => {
    const random = createRandom(11);
    const surface = new Surface(640, 480);
    surface.takeDirty();
    for (let n = 0; n < 300; n++) {
      const before = surface.back.data.slice();
      const [x1, y1, x2, y2] = [random.int(-50, 690), random.int(-50, 530), random.int(-50, 690), random.int(-50, 530)];
      surface.setPenWidth(random.pick([1, 1, 2, 5, 9]));
      surface.setLineColor(random.int(1, 0xffffff));
      surface.setFillColor(random.int(1, 0xffffff));
      const kind = n % 6;
      if (kind === 0) surface.line(x1, y1, x2, y2);
      else if (kind === 1) surface.rectangle(x1, y1, x2, y2);
      else if (kind === 2) surface.ellipse(x1, y1, x2, y2);
      else if (kind === 3) surface.floodFill(x1, y1);
      else if (kind === 4) surface.textOut(x1, y1, [LETTER, LETTER], 16, WHITE, 'both');
      else surface.unfilledRectangle(x1, y1, x2, y2);
      const dirty = surface.takeDirty();
      const data = surface.back.data;
      for (let i = 0; i < data.length; i++) {
        if (data[i] === before[i]) continue;
        const x = i % 640;
        const y = (i - x) / 640;
        if (!dirty || x < dirty.left || x >= dirty.right || y < dirty.top || y >= dirty.bottom) {
          expect.fail(`call ${n} (kind ${kind}): pixel (${x},${y}) changed outside ${JSON.stringify(dirty)}`);
        }
      }
    }
  }, 120_000);
});

describe('a fixed scene', () => {
  it('has the same pixels every time (lines, rectangles of every width, pixels, flood fills, modes, text, blocks)', () => {
    const surface = new Surface(640, 480);
    drawFixedScene(surface);
    // check-surface.mjs expects the same hash from Chromium and WebKit
    expect(hashPixels(surface.back)).toBe(FIXED_SCENE_HASH);
  });

  it('the scene of ellipses and wide lines is repeatable too', () => {
    const first = new Surface(640, 480);
    const second = new Surface(640, 480);
    drawShapeScene(first);
    drawShapeScene(second);
    expect(hashPixels(second.back)).toBe(hashPixels(first.back));
    expect(countPixels(first.back, BLACK)).toBeLessThan(640 * 480);
  });
});
