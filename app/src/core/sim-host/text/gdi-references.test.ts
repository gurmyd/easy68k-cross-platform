// The text screen against Windows (ARCHITECTURE.md 6.5.3): every text case of the GDI capture
// (tests/conformance/gdi, captured on Windows 11 by T2) is replayed as the calls a 68000 program
// causes - task 21 for the font, task 95 for the text - on the real OutputDevice, TextScreen and
// Surface with the fonts of app/public/fonts, and compared with what GDI drew.
//
//   text                  raster faces (Fixedsys, Courier): every pixel and the pen position equal;
//   text-outline          outline faces: the cell rectangles and the pen positions equal (the text
//                         is drawn in the fill colour, so the glyphs do not show);
//   text-outline-glyphs   outline faces with visible glyphs: the pen positions (the glyphs are
//                         substitutes, 3.5.1, and are not compared).
//
// The fourth suite, text-control, holds the strings Windows draws from a fallback font. Its
// pictures depend on the machine and the port does not reproduce them (docs/differences/SH3.md);
// check-text.mjs reports its numbers.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GdiCase } from '../../../../../tests/conformance/gdi/cases';
import { references } from '../../../../../tests/conformance/gdi/golden';
import type { FontSpec } from '../../../contracts';
import { AtlasGlyphProvider, OUTLINE_INDEX_FILE } from '../fonts/atlas-provider';
import { parseOutlineIndex, type OutlineAtlasInfo } from '../fonts/metrics';
import { Surface } from '../surface/surface';
import {
  compareReplay,
  fontOfCase,
  isProportionalName,
  outsideTheBoxes,
  replayCase,
  scoreReplays,
  type ReferenceCase,
  type ReplayCase,
  type Score,
} from './gdi-replay';
import { TASK21_FONT_NAMES, TextScreen } from './text-screen';

/** Reading 150 font files and replaying 2,000 cases takes a few seconds on a loaded machine. */
const LIMIT = 120_000;

const FONTS_FOLDER = fileURLToPath(new URL('../../../../public/fonts/', import.meta.url));
const requested: string[] = [];
const readFontFile = async (path: string): Promise<Uint8Array | null> => {
  requested.push(path);
  try {
    return new Uint8Array(await readFile(FONTS_FOLDER + path));
  } catch {
    return null;
  }
};

let fonts: AtlasGlyphProvider;
let outlineAtlases: OutlineAtlasInfo[];
beforeAll(async () => {
  fonts = new AtlasGlyphProvider(readFontFile);
  await fonts.ready;
  outlineAtlases = parseOutlineIndex((await readFontFile(OUTLINE_INDEX_FILE)) as Uint8Array);
}, LIMIT);

const spec = (font: { name: string; size: number; style: number }): FontSpec => ({
  name: font.name,
  size: font.size,
  bold: font.style === 1,
  italic: font.style === 2,
  underline: font.style === 3,
  strikeOut: font.style === 4,
});

/** A case of T2's list is a case of the replay; the compiler checks here that the shapes agree. */
const asReplayCase = (c: GdiCase): ReplayCase => c;
/** The references of a suite as the replay takes them. */
const suite = (name: string): ReferenceCase[] =>
  references(name).map((r) => ({ case: asReplayCase(r.case), image: r.image, pen: r.pen }));

/** What a failed comparison prints: how many cases differ, and the first of them. */
const differing = (score: Score) =>
  score.differences.length === 0
    ? []
    : [`${score.differences.length} of ${score.cases} cases differ`, ...score.differences.slice(0, 15)];

describe('the fonts of app/public/fonts in the glyph provider of the application', () => {
  it(
    'load without a problem: the metric table, the list of outline atlases and every atlas they name',
    () => {
      expect(fonts.loaded).toBe(true);
      expect(fonts.problems).toEqual([]);
      expect(requested.slice(0, 2)).toEqual(['metrics.json', OUTLINE_INDEX_FILE]);
      // 25 raster atlases (five native cells in five styles) and the listed outline atlases
      expect(outlineAtlases.length).toBeGreaterThanOrEqual(120);
      expect(new Set(requested).size).toBe(2 + 25 + outlineAtlases.length);
    },
    LIMIT,
  );

  it(
    'a size above 36 points is drawn from the 36 point atlas of the same face and style (errata T2 item 1.3)',
    () => {
      const atlas36 = (face: string, style: string) =>
        outlineAtlases.find((atlas) => atlas.face === face && atlas.style === style && atlas.size === 36)?.file;
      const faces: [string, string][] = [
        ['Courier New', 'Courier New'],
        ['Lucida Console', 'Lucida Console'],
        ['Consolas', 'Consolas'],
        [TASK21_FONT_NAMES[5] as string, 'Arial'],
        [TASK21_FONT_NAMES[7] as string, 'Arial'],
      ];
      for (const [name, face] of faces) {
        expect(atlas36(face, 'plain')).toBeDefined();
        for (let size = 37; size <= 255; size++) {
          for (let style = 0; style < 5; style++) {
            // underline and strike-out are the plain glyph plus the line the list gives
            const from = style === 1 ? 'bold' : style === 2 ? 'italic' : 'plain';
            expect([name, size, style, fonts.atlasOf(spec({ name, size, style }))]).toEqual([
              name,
              size,
              style,
              atlas36(face, from),
            ]);
          }
        }
        for (const size of [48, 72, 100, 255]) {
          // the glyph has the cell Windows measured for the size
          const font = spec({ name, size, style: 0 });
          const cell = fonts.metrics(font);
          expect(fonts.glyph(font, 0x57)).toMatchObject({ advance: cell.colWidth, height: cell.rowHeight });
          // underlined: the line is there, across the advance
          const underlined = fonts.glyph(spec({ name, size, style: 3 }), 0x20);
          const lineRows = Array.from({ length: underlined.height }, (_, y) =>
            underlined.coverage.subarray(y * underlined.width, y * underlined.width + underlined.advance),
          ).filter((row) => row.length > 0 && row.every((value) => value === 255)).length;
          expect(lineRows).toBeGreaterThan(0);
        }
      }
    },
    LIMIT,
  );
});

describe('task 95 against the GDI capture: the raster faces (suite text)', () => {
  it(
    'every case: every pixel and the pen position are those of Windows',
    () => {
      const cases = suite('text');
      const fontsCovered = new Set(cases.map((reference) => fontOfCase(reference.case).text));
      // 1,881 cases when this was written: both faces, every style, native and enlarged cells
      expect(cases.length).toBeGreaterThan(1500);
      expect(fontsCovered.size).toBeGreaterThanOrEqual(60);
      const score = scoreReplays(cases, fonts, 'pixels');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(cases.length);
    },
    LIMIT,
  );
});

describe('task 95 against the GDI capture: the outline faces (suite text-outline)', () => {
  it(
    'Courier New, Lucida Console, Consolas: the cell rectangles and the pen positions are those of Windows',
    () => {
      const cases = suite('text-outline').filter((reference) => !isProportionalName(fontOfCase(reference.case).name));
      expect(cases.length).toBeGreaterThanOrEqual(180); // three faces, fifteen sizes, four styles
      const score = scoreReplays(cases, fonts, 'cells');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(cases.length);
    },
    LIMIT,
  );

  it(
    'the proportional substitute (font numbers 5 and 7): cells and pens are those of Windows at every size that has an atlas; elsewhere the pen is within 2 % of the text width',
    () => {
      const atlasSizes = outlineAtlases.filter((atlas) => atlas.face === 'Arial').map((atlas) => atlas.size as number);
      const sameCell = (a: FontSpec, b: FontSpec) => {
        const [ca, cb] = [fonts.metrics(a), fonts.metrics(b)];
        return ca.colWidth === cb.colWidth && ca.rowHeight === cb.rowHeight;
      };
      const measured: ReferenceCase[] = [];
      const estimated: ReferenceCase[] = [];
      for (const reference of suite('text-outline')) {
        const font = fontOfCase(reference.case);
        if (!isProportionalName(font.name)) continue;
        // The widths of the letters are Windows' own where the cell is the cell of an atlas (that
        // includes size 0, whose cell is that of 12 points). At any other size they are estimated
        // from the nearest atlas (docs/differences/SH3.md).
        const hasAtlas = atlasSizes.some((size) => size === font.size || sameCell(spec(font), spec({ ...font, size })));
        (hasAtlas ? measured : estimated).push(reference);
      }
      expect(measured.length).toBeGreaterThanOrEqual(88); // two names, eleven sizes, four styles
      expect(estimated.length).toBeGreaterThanOrEqual(32); // 1, 5, 100 and 255 points

      const score = scoreReplays(measured, fonts, 'cells');
      expect(differing(score)).toEqual([]);

      const tooFar: string[] = [];
      for (const reference of estimated) {
        const texts = reference.case.ops.filter((o) => o.op === 'text');
        const last = texts[texts.length - 1];
        if (!last || last.op !== 'text') throw new Error(`${reference.case.id} has no text`);
        const pen = replayCase(reference.case, fonts).pen;
        const width = reference.pen[0] - last.x;
        const allowed = Math.max(1, Math.round(width * 0.02));
        if (pen[1] !== reference.pen[1] || Math.abs(pen[0] - reference.pen[0]) > allowed) {
          tooFar.push(
            `${reference.case.id} (${fontOfCase(reference.case).text}): pen ${pen.join(',')}, GDI ${reference.pen.join(',')}, text ${width} wide`,
          );
        }
      }
      expect(tooFar).toEqual([]);
    },
    LIMIT,
  );
});

describe('task 95 against the GDI capture: outline faces with visible glyphs (suite text-outline-glyphs)', () => {
  it(
    'every case: the pen position is that of Windows',
    () => {
      const cases = suite('text-outline-glyphs');
      expect(cases.length).toBeGreaterThanOrEqual(75);
      const score = scoreReplays(cases, fonts, 'pens');
      expect(differing(score)).toEqual([]);
    },
    LIMIT,
  );
});

describe('the comparison itself', () => {
  it('finds a wrong pixel, a wrong pen position, and a box that is too wide', () => {
    const [reference] = suite('text') as [ReferenceCase];
    expect(scoreReplays([reference], fonts, 'pixels')).toMatchObject({ cases: 1, equal: 1, differences: [] });

    const spoilt = reference.image.pixels.slice();
    spoilt[0] = (spoilt[0] as number) ^ 0x010000;
    const wrongPixel = scoreReplays(
      [{ ...reference, image: { width: reference.image.width, pixels: spoilt } }],
      fonts,
      'pixels',
    );
    expect(wrongPixel).toMatchObject({ equal: 0, picturesEqual: 0, pensEqual: 1 });
    expect(wrongPixel.differences[0]).toMatch(/^text-00000 \(Fixedsys 9 plain\): 1 pixels, first at 0,0: /);

    const wrongPen = scoreReplays([{ ...reference, pen: [reference.pen[0] + 1, reference.pen[1]] }], fonts, 'pixels');
    expect(wrongPen).toMatchObject({ equal: 0, picturesEqual: 1, pensEqual: 0 });
    expect(wrongPen.differences[0]).toMatch(/pen \d+,\d+, GDI \d+,\d+$/);

    // The margin of the outline faces forgives up to three columns beside a box, not four.
    const [outline] = suite('text-outline') as [ReferenceCase];
    const replay = replayCase(outline.case, fonts);
    const box = replay.boxes[0] as { x: number; y: number; width: number; height: number };
    const widened = (by: number) => {
      const pixels = replay.pixels.slice();
      for (let x = box.x + box.width; x < box.x + box.width + by; x++) pixels[box.y * replay.width + x] = 0x0000ff;
      return compareReplay(replay, { width: replay.width, pixels }, outsideTheBoxes(replay.boxes));
    };
    expect(widened(3)).toBeNull();
    expect(widened(4)).toMatchObject({ count: 1 });
  });
});

describe('the text screen proper draws a character as task 95 draws a text of that one byte', () => {
  // charOut, the echo of line input and the prompt each hand Windows one character. With this, what
  // the references above establish for task 95 holds for text written at the cursor as well.
  it(
    'every printable byte, in every style of the raster faces: the same pixels and the same pen',
    () => {
      const quiet = { onFrame: () => () => {}, setTimer: () => () => {} };
      const rig = () => {
        const surface = new Surface(640, 480);
        const text = new TextScreen({
          surface,
          glyphs: fonts,
          scheduler: quiet,
          outputLog: () => {},
          beep: () => {},
          show: () => {},
        });
        return { surface, text };
      };
      const failures: string[] = [];
      for (const [number, size] of [
        [1, 9],
        [1, 18],
        [2, 10],
        [2, 15],
      ] as const) {
        for (const styleBits of [0, 1, 2, 4, 8]) {
          const where = `font ${number}, ${size} points, style bits ${styleBits}`;
          const [cells, texts] = [rig(), rig()];
          for (const { surface, text } of [cells, texts]) {
            surface.setFillColor(0x00800000);
            text.setFontProperties(0x0000ffff, ((((number << 8) | size) << 16) | styleBits) >>> 0);
          }
          const { colWidth, rowHeight, textCols, textRows } = cells.text.state;
          // every second column and row, so that what a cell paints beyond itself shows
          const perRow = Math.floor(textCols / 2);
          let drawn = 0;
          for (let ch = 0x20; ch <= 0xff; ch++) {
            const [row, col] = [2 * Math.floor(drawn / perRow), 2 * (drawn % perRow)];
            if (row >= textRows) break;
            cells.text.gotorc(row, col);
            cells.text.charOut(ch);
            texts.text.drawText(Uint8Array.of(ch), col * colWidth, row * rowHeight);
            const [a, b] = [cells.surface.state.backPen, texts.surface.state.backPen];
            if (a.x !== b.x || a.y !== b.y) failures.push(`${where}, byte ${ch}: pen ${a.x},${a.y} and ${b.x},${b.y}`);
            drawn++;
          }
          expect(drawn).toBeGreaterThan(64);
          const [a, b] = [cells.surface.back.data, texts.surface.back.data];
          let pixels = 0;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) pixels++;
          if (pixels) failures.push(`${where}: ${pixels} pixels differ`);
        }
      }
      expect(failures).toEqual([]);
    },
    LIMIT,
  );
});
