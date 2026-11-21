// Replays a case of the GDI capture on the port's own output device, so that the text screen can
// be held to what Windows drew (ARCHITECTURE.md 6.5.3).
//
// T2 captured Windows GDI doing what the original does (tests/oracle/gdi-capture) and committed
// the pictures with GDI's pen position after each (tests/conformance/gdi/golden). A case is a list
// of operations (tests/conformance/gdi/cases.ts). Here each operation is the call a 68000 program
// would cause: a font or a font colour is task 21 (`setFontProperties`), a text is task 95
// (`drawText`), on a real `OutputDevice` over a real `TextScreen` and the real `Surface`, with the
// glyph provider the caller gives - the application's own, loaded with the files of
// `app/public/fonts/`.
//
// gdi-references.test.ts compares the replays with the references under Node; check-text.mjs runs
// the same replays in Chromium and WebKit and compares them with the Node run.
//
// The case list itself is not imported here (core/ may not import from outside app/src, 3.1): the
// caller passes the cases. `ReplayCase` restates the shape of T2's `GdiCase`; passing one where
// the other is expected is checked by the compiler in the test.
//
// Never imported by the application.
//
// Owner: SH3.

import type { Glyph, GlyphProvider, Scheduler } from '../../../contracts';
import { OutputDevice } from '../io';
import { Surface } from '../surface/surface';
import { hashPixels } from './testing';
import { TASK21_FONT_NAMES, TextScreen } from './text-screen';

/** One operation of a case: the drawing methods of the surface, a font, a font colour, a text. */
export type ReplayOp =
  | { readonly op: 'bg'; readonly color: number } // fills the picture directly (sets it up)
  | { readonly op: 'pen'; readonly color: number } // task 80
  | { readonly op: 'fill'; readonly color: number } // task 81
  | { readonly op: 'width'; readonly value: number } // task 93
  | { readonly op: 'mode'; readonly value: number } // task 92
  | { readonly op: 'pixel'; readonly x: number; readonly y: number } // task 82
  | { readonly op: 'line'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly op: 'lineto'; readonly x: number; readonly y: number } // task 85
  | { readonly op: 'moveto'; readonly x: number; readonly y: number } // task 86
  | { readonly op: 'rect'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly op: 'urect'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly op: 'ellipse'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly op: 'uellipse'; readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
  | { readonly op: 'flood'; readonly x: number; readonly y: number } // task 89
  /** Task 21's font: a name of `TASK21_FONT_NAMES`, a point size 0-255, style 0-4 (plain, bold, italic, underline, strike-out). */
  | { readonly op: 'font'; readonly name: string; readonly size: number; readonly style: number }
  | { readonly op: 'fontcolor'; readonly color: number } // task 21's colour
  | { readonly op: 'text'; readonly x: number; readonly y: number; readonly bytes: readonly number[] }; // task 95

export interface ReplayCase {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly ops: readonly ReplayOp[];
}

/** The opaque box of one text as the port drew it. */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The font was underlined or struck out. */
  lined: boolean;
}

export interface Replay {
  width: number;
  height: number;
  /** The picture, one $00BBGGRR value per pixel, row-major. */
  pixels: Uint32Array;
  /** The pen position of the back buffer at the end (what GDI's current position is). */
  pen: [number, number];
  /** One entry per text of the case, in order. */
  boxes: TextBox[];
}

/** The smallest output window (trap15-b §4.3). */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;

const FONT_NUMBERS: ReadonlyMap<string, number> = new Map(
  Object.entries(TASK21_FONT_NAMES).map(([number, name]) => [name, Number(number)]),
);

/** A scheduler on which nothing ever runs: a replay starts no input prompt. */
const idle: Scheduler = { onFrame: () => () => {}, setTimer: () => () => {} };

/** D2.L of task 21 for a font: number and size in the high word, the style bit in the low word. */
function task21Style(name: string, size: number, style: number): number {
  const number = FONT_NUMBERS.get(name);
  if (number === undefined) throw new Error(`"${name}" is not a font name of task 21`);
  if (!Number.isInteger(style) || style < 0 || style > 4) throw new Error(`${style} is not a style of task 21`);
  return ((((number << 8) | (size & 0xff)) << 16) | (style === 0 ? 0 : 1 << (style - 1))) >>> 0;
}

/**
 * Draws a case and returns its picture.
 *
 * The surface is the size of the case but never smaller than the smallest output window, 640 x 480:
 * a program cannot have a smaller one, and with a cell higher than the canvas task 21 would scroll.
 * The picture is the top-left part of that surface, which cuts text off exactly where GDI clips it
 * at the edge of the smaller bitmap.
 */
export function replayCase(c: ReplayCase, glyphs: GlyphProvider): Replay {
  const surface = new Surface(Math.max(c.width, MIN_WIDTH), Math.max(c.height, MIN_HEIGHT));
  const text = new TextScreen({
    surface,
    glyphs,
    scheduler: idle,
    outputLog: () => {},
    beep: () => {},
    show: () => {},
  });
  const device = new OutputDevice({
    surface,
    text,
    show: () => {},
    bringToFront: () => {},
    setFullScreen: () => {},
  });

  // The box of a text is what the text screen hands to the surface: the advances of the glyphs.
  const boxes: TextBox[] = [];
  const paint = surface.textOut.bind(surface);
  surface.textOut = (x, y, drawn: readonly Glyph[], extent, color, target) => {
    boxes.push({
      x,
      y,
      width: drawn.reduce((sum, glyph) => sum + glyph.advance, 0),
      height: text.state.rowHeight,
      lined: text.state.font.underline || text.state.font.strikeOut,
    });
    paint(x, y, drawn, extent, color, target);
  };

  // The start-up state of the original: Fixedsys 9 in white.
  let font = { name: 'Fixedsys', size: 9, style: 0 };
  let fontColor = 0x00ffffff;
  const task21 = () => device.setFontProperties(fontColor, task21Style(font.name, font.size, font.style));

  for (const o of c.ops) {
    switch (o.op) {
      case 'bg':
        surface.back.data.fill((0xff000000 | (o.color & 0xffffff)) >>> 0);
        break;
      case 'pen':
        device.setLineColor(o.color);
        break;
      case 'fill':
        device.setFillColor(o.color);
        break;
      case 'width':
        device.setPenWidth(o.value);
        break;
      case 'mode':
        device.setDrawingMode(o.value);
        break;
      case 'pixel':
        device.drawPixel(o.x, o.y);
        break;
      case 'line':
        device.line(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'lineto':
        device.lineTo(o.x, o.y);
        break;
      case 'moveto':
        device.moveTo(o.x, o.y);
        break;
      case 'rect':
        device.rectangle(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'urect':
        device.unfilledRectangle(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'ellipse':
        device.ellipse(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'uellipse':
        device.unfilledEllipse(o.x1, o.y1, o.x2, o.y2);
        break;
      case 'flood':
        device.floodFill(o.x, o.y);
        break;
      case 'font':
        font = { name: o.name, size: o.size, style: o.style };
        task21();
        break;
      case 'fontcolor':
        fontColor = o.color;
        task21();
        break;
      case 'text':
        device.drawText(Uint8Array.from(o.bytes), o.x, o.y);
        break;
    }
  }

  const { data, width } = surface.back;
  const pixels = new Uint32Array(c.width * c.height);
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) pixels[y * c.width + x] = (data[y * width + x] as number) & 0xffffff;
  }
  return {
    width: c.width,
    height: c.height,
    pixels,
    pen: [surface.state.backPen.x, surface.state.backPen.y],
    boxes,
  };
}

/** What a comparison of a replay with its reference found. */
export interface Difference {
  /** Number of pixels that differ. */
  count: number;
  /** The first of them, with the port's and the reference's colour ($00BBGGRR). */
  x: number;
  y: number;
  port: number;
  reference: number;
}

/**
 * Compares a replay with a reference picture of the same size, pixel for pixel. `ignore` leaves
 * pixels out (see `outsideTheBoxes`). Null when nothing differs.
 */
export function compareReplay(
  replay: Replay,
  reference: { readonly width: number; readonly pixels: Uint32Array },
  ignore?: (x: number, y: number) => boolean,
): Difference | null {
  if (reference.width !== replay.width || reference.pixels.length !== replay.pixels.length) {
    throw new Error('The reference picture has another size than the case');
  }
  let first: Difference | null = null;
  let count = 0;
  for (let i = 0; i < replay.pixels.length; i++) {
    const x = i % replay.width;
    const y = (i - x) / replay.width;
    if (ignore?.(x, y)) continue;
    const port = replay.pixels[i] as number;
    const reference24 = (reference.pixels[i] as number) & 0xffffff;
    if (port === reference24) continue;
    count++;
    first ??= { count: 0, x, y, port, reference: reference24 };
  }
  if (first) first.count = count;
  return first;
}

/**
 * The pixels of an outline-face text whose colour on Windows the port cannot know (6.5.3 compares
 * the cell rectangles and pen positions of the outline faces, not what Windows adds around them):
 * GDI widens the opaque box of such a text by the ink overhang of its first and last glyph - up to
 * a tenth of the cell height, at least 3 pixels - and draws a TrueType underline or strike-out
 * line where the font says, also outside the cell. T2's comparison of the surface
 * (tests/conformance/gdi/text-model.ts `outlineCells`) leaves out the same pixels.
 *
 * True for a pixel outside every box that lies in the margin beside a box, or anywhere when a text
 * of the case is underlined or struck out.
 */
export function outsideTheBoxes(boxes: readonly TextBox[]): (x: number, y: number) => boolean {
  const lined = boxes.some((box) => box.lined);
  const inside = (x: number, y: number, widened: boolean) =>
    boxes.some((box) => {
      const margin = widened ? Math.max(3, Math.ceil(box.height / 10)) : 0;
      return x >= box.x - margin && x < box.x + box.width + margin && y >= box.y && y < box.y + box.height;
    });
  return (x, y) => !inside(x, y, false) && (lined || inside(x, y, true));
}

/** A case with what Windows drew for it: the picture and GDI's pen position at the end. */
export interface ReferenceCase {
  readonly case: ReplayCase;
  readonly image: { readonly width: number; readonly pixels: Uint32Array };
  readonly pen: readonly [number, number];
}

/** How many cases of a list the port draws as Windows did. */
export interface Score {
  cases: number;
  /** Picture and pen position equal. */
  equal: number;
  picturesEqual: number;
  pensEqual: number;
  /** One line per case that differs: its id and font, and what differs first. */
  differences: string[];
}

const STYLE_NAMES = ['plain', 'bold', 'italic', 'underline', 'strike-out'];
const hex6 = (color: number) => '$' + color.toString(16).toUpperCase().padStart(6, '0');

/** The font a case ends with, in words: "Fixedsys 9 plain". */
export function fontOfCase(c: ReplayCase): { name: string; size: number; style: number; text: string } {
  let font = { name: 'Fixedsys', size: 9, style: 0 };
  for (const o of c.ops) if (o.op === 'font') font = { name: o.name, size: o.size, style: o.style };
  return { ...font, text: `${font.name} ${font.size} ${STYLE_NAMES[font.style] ?? font.style}` };
}

/** The two font names of task 21 that Windows 11 answers with a proportional face (trap15-b §5.7). */
export const isProportionalName = (name: string): boolean =>
  name === TASK21_FONT_NAMES[5] || name === TASK21_FONT_NAMES[7];

/**
 * Replays every case and compares it with its reference.
 * - `pixels`: every pixel must be equal (the raster faces);
 * - `cells`: every pixel but those of `outsideTheBoxes` (the outline faces: cell rectangles);
 * - `pens`: the picture is not looked at.
 * The pen position is compared in every mode.
 */
export function scoreReplays(
  references: readonly ReferenceCase[],
  glyphs: GlyphProvider,
  how: 'pixels' | 'cells' | 'pens',
): Score {
  const score: Score = { cases: references.length, equal: 0, picturesEqual: 0, pensEqual: 0, differences: [] };
  for (const reference of references) {
    const replay = replayCase(reference.case, glyphs);
    const difference =
      how === 'pens'
        ? null
        : compareReplay(replay, reference.image, how === 'cells' ? outsideTheBoxes(replay.boxes) : undefined);
    const penEqual = replay.pen[0] === reference.pen[0] && replay.pen[1] === reference.pen[1];
    if (!difference) score.picturesEqual++;
    if (penEqual) score.pensEqual++;
    if (!difference && penEqual) {
      score.equal++;
      continue;
    }
    const what = difference
      ? `${difference.count} pixels, first at ${difference.x},${difference.y}: ${hex6(difference.port)}, GDI ${hex6(difference.reference)}`
      : `pen ${replay.pen.join(',')}, GDI ${reference.pen.join(',')}`;
    score.differences.push(`${reference.case.id} (${fontOfCase(reference.case).text}): ${what}`);
  }
  return score;
}

/**
 * One hash over the replays of many cases (pictures and pens), for comparing two environments:
 * the same cases with the same fonts must give the same value under Node and in every browser.
 */
export function digestReplays(cases: readonly ReplayCase[], glyphs: GlyphProvider): string {
  const parts = new Uint32Array(cases.length * 3);
  cases.forEach((c, index) => {
    const replay = replayCase(c, glyphs);
    parts[index * 3] = parseInt(hashPixels(replay.pixels), 16);
    parts[index * 3 + 1] = replay.pen[0] >>> 0;
    parts[index * 3 + 2] = replay.pen[1] >>> 0;
  });
  return hashPixels(parts);
}
