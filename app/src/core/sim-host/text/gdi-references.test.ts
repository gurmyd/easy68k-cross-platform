// The text screen against Windows (ARCHITECTURE.md 6.5.3): every text case of the GDI capture
// (tests/conformance/gdi, captured on Windows 11 by T2) is replayed as the calls a 68000 program
// causes - task 21 for the font, task 95 for the text - on the real OutputDevice, TextScreen and
// Surface with the fonts of app/public/fonts, and compared with what GDI drew.
//
//   text                  raster faces (Fixedsys, Courier): every pixel and the pen position equal;
//   text-outline          outline faces: the cell rectangles and the pen positions equal (the text
//                         is drawn in the fill colour, so the glyphs do not show);
//   text-outline-zero     as text-outline, for zero-width bytes and $7F in the fixed-pitch outline
//                         faces (the cell from the widths Windows draws);
//   text-outline-glyphs   outline faces with visible glyphs: the pen positions (the glyphs are
//                         substitutes, 3.5.1, and are not compared).
//
// The suite text-control holds the strings Windows draws (in part) from a fallback font or
// that T2's model does not cover. For the bytes $01-$08, $0B, $0E-$1B the pictures differ between
// two Windows, so 6.5.3 holds their pens instead (erratum T2 25). The other 162 strings of the suite
// are drawn the same by both captured Windows, and the text screen draws them as Windows does
// (gate I3, item 3b: Windows' Unicode text path - the zero-width bar, italic itemization, the euro
// sign; docs/porting/errata/SH3.md entry 32): every pixel and the pen, except the pixels of the
// euro sign Windows takes from a fallback font with ClearType (6.5.3 as corrected, erratum T2 26).
// The suites text-path and text-path-euro hold more such strings. check-text.mjs reports the numbers.

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { FALLBACK_BYTES, type GdiCase } from '../../../../../tests/conformance/gdi/cases';
import { GOLDEN_DIR, references } from '../../../../../tests/conformance/gdi/golden';
import { decodePack, decodePix } from '../../../../../tests/conformance/gdi/pix';
import type { FontSpec } from '../../../contracts';
import { AtlasGlyphProvider, OUTLINE_INDEX_FILE } from '../fonts/atlas-provider';
import { parseOutlineIndex, type OutlineAtlasInfo } from '../fonts/metrics';
import { Surface } from '../surface/surface';
import {
  compareReplay,
  euroInk,
  fontOfCase,
  isProportionalName,
  outlineWidening,
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

describe('task 95 against the GDI capture: italic in the outline faces (suite text-outline-italic)', () => {
  // GDI widens the opaque box of an italic outline text further than a plain one (errata T2
  // section 1 item 18; docs/requests/T2-outline-italic.md): `outlineWidening` leaves those pixels
  // out, as T2's `outlineCells` does. Texts that draw only $7F are left out as in text-outline-zero
  // (the fallback font's cell height is not measured).
  const ZERO_WIDTH = [0x09, 0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f];
  const drawsOnlyDel = (reference: ReferenceCase) =>
    reference.case.ops.some(
      (o) => o.op === 'text' && o.bytes.includes(0x7f) && o.bytes.every((b) => b === 0x7f || ZERO_WIDTH.includes(b)),
    );
  const modelled = () => suite('text-outline-italic').filter((reference) => !drawsOnlyDel(reference));

  it(
    'Courier New, Lucida Console, Consolas in italic: the cell rectangles and the pen positions are those of Windows',
    () => {
      const cases = modelled();
      // 177 cases in the suite when this was written: 3 faces, 9 sizes, the strings of OUTLINE_ITALIC_STRINGS
      expect(cases.length).toBeGreaterThanOrEqual(100);
      const score = scoreReplays(cases, fonts, 'cells');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(cases.length);
    },
    LIMIT,
  );

  it(
    'the plain margin (a tenth of the cell on both sides) would fail here',
    () => {
      let failing = 0;
      for (const reference of modelled()) {
        const replay = replayCase(reference.case, fonts);
        const plainBoxes = replay.boxes.map((box) => ({ ...box, italic: false }));
        if (compareReplay(replay, reference.image, outsideTheBoxes(plainBoxes))) failing++;
      }
      expect(failing).toBeGreaterThan(0);
      expect(outlineWidening(true, 39)).toEqual([5, 14]);
      expect(outlineWidening(false, 39)).toEqual([4, 4]);
    },
    LIMIT,
  );
});

describe('task 95 against the GDI capture: zero-width bytes and $7F in the outline faces (suite text-outline-zero)', () => {
  // Windows builds the cell of these faces from the widths it draws: a zero-width byte takes none,
  // even alone, and $7F takes the fallback glyph's width (errata T2 section 2, "Outline faces,
  // cells and pens"). A text that draws only $7F gets the fallback font's cell height on Windows,
  // which nobody measured (errata T2, same item): its pen is compared, its picture is not.
  const ZERO_WIDTH = [0x09, 0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f];
  const drawsOnlyDel = (reference: ReferenceCase) =>
    reference.case.ops.some(
      (o) => o.op === 'text' && o.bytes.includes(0x7f) && o.bytes.every((b) => b === 0x7f || ZERO_WIDTH.includes(b)),
    );

  it(
    'Courier New, Lucida Console, Consolas: the cell rectangles and the pen positions are those of Windows',
    () => {
      const cases = suite('text-outline-zero');
      // 408 when this was written: 3 faces, 4 styles; 11 strings at 8 and 10 pt, 6 also at 13 and 72 pt
      expect(cases.length).toBeGreaterThanOrEqual(400);
      const modelled = cases.filter((reference) => !drawsOnlyDel(reference));
      expect(modelled.length).toBeGreaterThanOrEqual(330);
      const score = scoreReplays(modelled, fonts, 'cells');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(modelled.length);

      const onlyDel = cases.filter(drawsOnlyDel);
      expect(onlyDel.length).toBeGreaterThanOrEqual(70);
      expect(differing(scoreReplays(onlyDel, fonts, 'pens'))).toEqual([]);
    },
    LIMIT,
  );

  it(
    'the fonts say what the pen needs: Consolas $0D advances 0 at every size and style, the zero-width bytes of the other faces a cell; every face is a fixed-pitch outline face',
    () => {
      for (const name of ['Courier New', 'Lucida Console', 'Consolas']) {
        for (const size of [0, 1, 8, 10, 13, 24, 36, 72, 255]) {
          for (let style = 0; style < 5; style++) {
            const font = spec({ name, size, style });
            const where = `${name} ${size} style ${style}`;
            expect([where, fonts.monospacedOutline(font)]).toEqual([where, true]);
            const advances = ZERO_WIDTH.map((byte) => fonts.glyph(font, byte).advance);
            const cell = fonts.metrics(font).colWidth;
            expect([where, advances]).toEqual([
              where,
              ZERO_WIDTH.map((b) => (name === 'Consolas' && b === 0x0d ? 0 : cell)),
            ]);
          }
        }
      }
      for (const name of ['Fixedsys', 'Courier', TASK21_FONT_NAMES[5] as string, TASK21_FONT_NAMES[7] as string]) {
        expect([name, fonts.monospacedOutline(spec({ name, size: 10, style: 0 }))]).toEqual([name, false]);
      }
    },
    LIMIT,
  );

  it(
    'the previous rule (a cell for zero-width bytes, the face advance for $7F) would fail here',
    () => {
      // A provider that does not say that the face is a fixed-pitch outline face gets the rules of the
      // raster faces: the test above must see the difference.
      const legacy = {
        ready: fonts.ready,
        metrics: fonts.metrics.bind(fonts),
        glyph: fonts.glyph.bind(fonts),
        textOverhang: fonts.textOverhang.bind(fonts),
        delInHighText: fonts.delInHighText.bind(fonts),
      };
      const modelled = suite('text-outline-zero').filter((reference) => !drawsOnlyDel(reference));
      const score = scoreReplays(modelled, legacy, 'cells');
      expect(score.pensEqual).toBe(modelled.length);
      expect(score.picturesEqual).toBeLessThan(modelled.length / 2);
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

describe('task 95 with the bytes Windows draws from a fallback font (suite text-control; 6.5.3 as corrected, erratum T2 25)', () => {
  // $01-$08, $0B and $0E-$1B in Fixedsys and Courier. Windows draws them from another font, and two
  // Windows draw them differently (10.0.26300, the references: a ClearType box 4 pixels wide in
  // Fixedsys 9; 10.0.26100, GitHub's runner: other glyphs, 6 pixels and more, without smoothing), so
  // "every pixel equal" has no single truth for them. What holds instead: the pen (which a program
  // sees through the next line or text) wherever the two captures agree, the picture wherever they
  // agree, and otherwise the port's documented choice (docs/differences/SH3.md).
  const RUNNER = `${GOLDEN_DIR}windows-10.0.26100/text-control.pixpack.gz`;
  const withFallbackByte = (reference: ReferenceCase) =>
    reference.case.ops.some((o) => o.op === 'text' && o.bytes.some((b) => FALLBACK_BYTES.includes(b)));
  const both = () => {
    const runner = decodePack(new Uint8Array(readFileSync(RUNNER)));
    return suite('text-control').flatMap((reference, i) => {
      const other = runner.cases[i];
      if (!other || other.id !== reference.case.id) throw new Error(`${RUNNER} does not list ${reference.case.id}`);
      if (!withFallbackByte(reference)) return [];
      const image = decodePix(other.pix);
      const samePicture = image.pixels.every(
        (p, j) => (p & 0xffffff) === ((reference.image.pixels[j] as number) & 0xffffff),
      );
      const samePen = other.pen[0] === reference.pen[0] && other.pen[1] === reference.pen[1];
      return [{ reference, samePicture, samePen }];
    });
  };

  it(
    'the pen position is that of Windows in every case in which the two captured Windows agree on it',
    () => {
      const cases = both();
      expect(cases.length).toBe(90);
      const agreed = cases.filter((c) => c.samePen).map((c) => c.reference);
      expect(agreed.length).toBe(85); // the other 5 differ between the two Windows by 4 to 9 pixels
      const score = scoreReplays(agreed, fonts, 'pens');
      expect(differing(score)).toEqual([]);
    },
    LIMIT,
  );

  it(
    'every pixel and the pen are those of Windows in every case in which the two captured Windows draw the same picture',
    () => {
      const agreed = both()
        .filter((c) => c.samePicture && c.samePen)
        .map((c) => c.reference);
      expect(agreed.length).toBe(16); // 18 equal pictures; in two of them the pens are 9 and 4 pixels apart
      const score = scoreReplays(agreed, fonts, 'pixels');
      expect(differing(score)).toEqual([]);
    },
    LIMIT,
  );

  it(
    "elsewhere the port's choice: without underline or strike-out each such byte is a blank cell of the face's own width, as a space",
    () => {
      const plain = suite('text-control').filter(
        (reference) => withFallbackByte(reference) && fontOfCase(reference.case).style <= 2,
      );
      expect(plain.length).toBeGreaterThanOrEqual(60);
      const asSpace = (c: ReplayCase): ReplayCase => ({
        ...c,
        ops: c.ops.map((o) =>
          o.op === 'text' ? { ...o, bytes: o.bytes.map((b) => (FALLBACK_BYTES.includes(b) ? 0x20 : b)) } : o,
        ),
      });
      const failures: string[] = [];
      for (const reference of plain) {
        const [port, spaced] = [replayCase(reference.case, fonts), replayCase(asSpace(reference.case), fonts)];
        const pixels = port.pixels.filter((p, i) => p !== spaced.pixels[i]).length;
        if (pixels || port.pen.join() !== spaced.pen.join())
          failures.push(`${reference.case.id}: ${pixels} pixels, pen ${port.pen.join()} and ${spaced.pen.join()}`);
      }
      expect(failures).toEqual([]);
    },
    LIMIT,
  );
});

describe("task 95 on Windows' Unicode text path in the raster faces (gate I3, item 3b; docs/porting/errata/SH3.md entry 32)", () => {
  const withFallbackByte = (reference: ReferenceCase) =>
    reference.case.ops.some((o) => o.op === 'text' && o.bytes.some((b) => FALLBACK_BYTES.includes(b)));
  const control = () => suite('text-control').filter((reference) => !withFallbackByte(reference));

  it(
    'text-control without the fallback-font bytes (162 cases, drawn the same by both captured Windows): every pixel and the pen, but the smoothed euro sign',
    () => {
      const cases = control();
      expect(cases.length).toBe(162);
      const withEuro = cases.filter((reference) => euroInk(reference.case, fonts) !== null);
      expect(withEuro.length).toBe(30); // the rows $80-$9F of Fixedsys 9, 0, 18 and Courier 10, 12, 15
      const exact = cases.filter((reference) => euroInk(reference.case, fonts) === null);
      const score = scoreReplays(exact, fonts, 'pixels');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(132);
      const outside = scoreReplays(withEuro, fonts, 'but-euro');
      expect(differing(outside)).toEqual([]);
    },
    LIMIT,
  );

  it(
    'text-path: the bar, every string of up to three zero-width bytes, edges, italic itemization, undefined bytes - every pixel and the pen',
    () => {
      const cases = suite('text-path');
      expect(cases.length).toBeGreaterThanOrEqual(7000);
      const score = scoreReplays(cases, fonts, 'pixels');
      expect(differing(score)).toEqual([]);
      expect(score.equal).toBe(cases.length);
    },
    LIMIT,
  );

  it(
    'text-path, control texts ($7F with undefined bytes and punctuation; erratum T2 27): the extra cell and the italic overhang, every pixel and the pen',
    () => {
      // The last 1,440 cases of text-path: 36 strings in 8 fonts and 5 styles (review R4 of gate I3).
      const cases = suite('text-path').filter((reference) =>
        reference.case.ops.some(
          (o) =>
            o.op === 'text' &&
            o.x === 6 &&
            o.y === 2 &&
            o.bytes.includes(0x7f) &&
            o.bytes.some((b) => [0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(b)),
        ),
      );
      expect(cases.length).toBe(1440);
      const score = scoreReplays(cases, fonts, 'pixels');
      expect(differing(score)).toEqual([]);
      // Windows' box: $7F $81 fills two cells in Fixedsys 9 plain (one for the pen), and three with
      // the italic overhang; $7F $81 "A" stays the ordinary two.
      const ids = (bytes: number[], style: number) =>
        cases.filter(
          (reference) =>
            reference.case.ops.some(
              (o) => o.op === 'font' && o.name === 'Fixedsys' && o.size === 9 && o.style === style,
            ) && reference.case.ops.some((o) => o.op === 'text' && o.bytes.join() === bytes.join()),
        );
      for (const [bytes, style, box] of [
        [[0x7f, 0x81], 0, 16],
        [[0x7f, 0x81], 2, 23],
        [[0x7f, 0x81, 0x41], 0, 16],
        [[0x7f, 0x81, 0x7f], 2, 23],
      ] as const) {
        const [reference] = ids([...bytes], style);
        expect(reference, bytes.join()).toBeDefined();
        const row = 2 + 7; // a row of the text's box, below every glyph's ink at the left
        const fill = (x: number) =>
          ((reference!.image.pixels[row * reference!.case.width + x] as number) & 0xffffff) !== 0;
        expect([fill(6 + box - 1), fill(6 + box)], `${bytes.join()} style ${style}`).toEqual([true, false]);
      }
    },
    LIMIT,
  );

  it(
    'text-path-formfeed: $0C on the text path is not modelled (a known difference, erratum T2 27) - reported, not required',
    () => {
      const cases = suite('text-path-formfeed');
      expect(cases.length).toBe(640);
      const score = scoreReplays(cases, fonts, 'pixels');
      // Printed for the record; the numbers say how far the port is from Windows here.
      console.log(
        `text-path-formfeed: ${score.equal} of ${score.cases} cases every pixel and pen equal, pens ${score.pensEqual} (not modelled; docs/differences/SH3.md)`,
      );
      expect(score.cases).toBe(640);
    },
    LIMIT,
  );

  it(
    'text-path-euro: $80 on the text path - the pen, and every pixel but the smoothed euro sign',
    () => {
      const cases = suite('text-path-euro');
      expect(cases.length).toBe(1400);
      expect(cases.filter((reference) => euroInk(reference.case, fonts) !== null).length).toBeGreaterThanOrEqual(1200);
      const score = scoreReplays(cases, fonts, 'but-euro');
      expect(differing(score)).toEqual([]);
    },
    LIMIT,
  );

  it(
    'without the font data of the text path the bar and the euro width would fail (the rules need raster.textPath)',
    () => {
      const plain = {
        ready: fonts.ready,
        metrics: fonts.metrics.bind(fonts),
        glyph: fonts.glyph.bind(fonts),
        textOverhang: fonts.textOverhang.bind(fonts),
        delInHighText: fonts.delInHighText.bind(fonts),
        monospacedOutline: fonts.monospacedOutline.bind(fonts),
      };
      const bars = suite('text-path').slice(0, 1610); // a lone $0D at every raster size and style
      // 81 bar sizes (29 of Fixedsys, 52 of Courier) in plain, bold and italic
      expect(scoreReplays(bars, plain, 'pixels').picturesEqual).toBe(bars.length - 81 * 3);
      const euros = suite('text-path-euro');
      expect(scoreReplays(euros, plain, 'pens').pensEqual).toBeLessThan(euros.length / 2);
    },
    LIMIT,
  );
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
