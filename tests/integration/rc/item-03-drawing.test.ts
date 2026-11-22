// Release candidate, item 3 of ARCHITECTURE.md 6.9 ("Drawing: the thresholds of 6.5"). Owner: I3.
//
//   npx vitest run --config tests/integration/rc/item-03-vitest.config.ts
//
// (from the repository root; about one to three minutes). It counts what each threshold of 6.5
// counts and prints one line per threshold with the real numbers, so that docs/integration/rc.md
// can quote them:
//
//   6.5.1  every case of T2's primitive suites (tests/conformance/gdi/golden, captured from Windows
//          GDI) replayed on the port's Surface: every pixel and the pen position equal; and the
//          sizes 6.5.1 names (10,000 width-1 lines, 2,000 wide lines of widths 2-14, 10,000
//          rectangles filled and unfilled with widths 0-12, 1,000 flood fills, the 16 raster
//          operations on every primitive kind, pixels inside and outside, the colour forms, clipping);
//   6.5.2  the ellipse suites: 8,192 small boxes every pixel equal; 3,000 large boxes at least 95 %
//          every pixel equal and none with more differing pixels than 0.5 % of its outline; 500
//          wide-pen boxes reported, not worse than docs/porting/gdi-deviations.md;
//   6.5.3  text as the architect decided on 22 November 2026 (the correction note under 6.5.3;
//          errata T2 25, T2 26, T2 28, T2 29), replayed on the port's own text screen with the fonts
//          of app/public/fonts as app/src/core/sim-host/text/gdi-references.test.ts does: (1) the
//          raster faces off the text path (suite text) every pixel and pen, the outline faces their
//          cells and pens; (2) the text path where Windows is deterministic (text-path, and the
//          texts of text-control without a fallback byte or $80) every pixel and pen; (3) the
//          recorded differences: the pens of the fallback bytes where both captured Windows agree and
//          every pixel where they draw the same; for $80 and "@" the pens Windows gives in every
//          history (golden/text-path-euro-pens.json, text-path-at-pens.json) and every pixel outside
//          the euro sign; everything else of (3) and the one-build suites text-path-formfeed and
//          text-path-fallback reported with their numbers, not required;
//   6.5.4  X3's whole-program baseline holds every official example, the twenty conformance
//          programs and X3's own scenes (the browser half is `npm run check:examples`).
//
// It reuses T2's and SH2's readers and replays (tests/conformance/gdi), SH3's replay of the text
// screen and the real Surface; it judges nothing those suites do not judge, it counts each class and
// fails when a required one differs. No browser. The Windows halves are in CI: the windows-oracles
// job's step "GDI capture, regenerate and compare (T2)" prints the pens of the one-build suites.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FontSpec } from '../../../app/src/contracts';
import { AtlasGlyphProvider, OUTLINE_INDEX_FILE } from '../../../app/src/core/sim-host/fonts/atlas-provider';
import { parseOutlineIndex, type OutlineAtlasInfo } from '../../../app/src/core/sim-host/fonts/metrics';
import { rasterEllipse } from '../../../app/src/core/sim-host/surface/ellipse';
import { Surface } from '../../../app/src/core/sim-host/surface/surface';
import {
  euroInk,
  fontOfCase,
  isProportionalName,
  replayCase,
  scoreReplays,
  type ReferenceCase,
  type ReplayCase,
} from '../../../app/src/core/sim-host/text/gdi-replay';
import { FALLBACK_BYTES, type GdiCase, type GdiOp } from '../../conformance/gdi/cases';
import { generateEllipseCases, type EllipseCase } from '../../conformance/gdi/cases-ellipse';
import { cases, firstDifference, isMachineSuite, references, suiteNames } from '../../conformance/gdi/golden';
import { decodePack, decodePix } from '../../conformance/gdi/pix';
import { replayOnSurface } from '../../conformance/gdi/replay';

const T = 600_000;
const GOLDEN = new URL('../../conformance/gdi/golden/', import.meta.url);
const isText = (suite: string) => suite.startsWith('text');
const ZERO_WIDTH = [0x09, 0x0a, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f];

const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  console.log(line);
};

// ---------------------------------------------------------------- 6.5.3 helpers
// The port's own text screen with the fonts of app/public/fonts, as
// app/src/core/sim-host/text/gdi-references.test.ts (SH3) replays it.
const FONTS = fileURLToPath(new URL('../../../app/public/fonts/', import.meta.url));
const readFont = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await readFile(FONTS + path));
  } catch {
    return null;
  }
};
let provider: AtlasGlyphProvider | undefined;
async function glyphs(): Promise<AtlasGlyphProvider> {
  if (!provider) {
    provider = new AtlasGlyphProvider(readFont);
    await provider.ready;
    if (!provider.loaded || provider.problems.length > 0)
      throw new Error(`the fonts of app/public/fonts do not load: ${provider.problems.join('; ')}`);
  }
  return provider;
}
const outlineIndex = async (): Promise<OutlineAtlasInfo[]> =>
  parseOutlineIndex((await readFont(OUTLINE_INDEX_FILE)) as Uint8Array);
const spec = (font: { name: string; size: number; style: number }): FontSpec => ({
  name: font.name,
  size: font.size,
  bold: font.style === 1,
  italic: font.style === 2,
  underline: font.style === 3,
  strikeOut: font.style === 4,
});
/**
 * EASY68K_RC_SPOIL=<suite> moves the pen of the first reference of that suite by one pixel in
 * memory, to show that the judge fails when a reference and the port disagree.
 */
const spoilt = (name: string, pen: readonly [number, number], index: number): [number, number] =>
  process.env.EASY68K_RC_SPOIL === name && index === 0 ? [pen[0] + 1, pen[1]] : [pen[0], pen[1]];
const suite = (name: string): ReferenceCase[] =>
  references(name).map((r, i) => ({ case: r.case as ReplayCase, image: r.image, pen: spoilt(name, r.pen, i) }));
const hasFallbackByte = (r: ReferenceCase) =>
  r.case.ops.some((o) => o.op === 'text' && o.bytes.some((b) => FALLBACK_BYTES.includes(b)));
const onlyText = (r: ReferenceCase) => {
  const texts = r.case.ops.filter((o) => o.op === 'text');
  const text = texts[0];
  if (texts.length !== 1 || !text || text.op !== 'text') throw new Error(`${r.case.id}: not one text`);
  return text;
};
const euroPens = (): Map<string, number> => {
  const doc = JSON.parse(readFileSync(new URL('text-path-euro-pens.json', GOLDEN), 'utf8')) as {
    cases: [string, number, number, string, number][];
  };
  return new Map(doc.cases.map(([face, size, style, hex, pen]) => [`${face}|${size}|${style}|${hex}`, pen]));
};
const euroKey = (r: ReferenceCase): string => {
  const f = fontOfCase(r.case);
  const hex = onlyText(r)
    .bytes.map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${f.name}|${f.size}|${f.style}|${hex}`;
};

/** The classes of 6.5.3 as decided: required ones must be equal, reported ones are printed. */
class Rule {
  readonly lines: string[] = [];
  readonly failures: string[] = [];
  cases = 0;
  equal = 0;
  required = 0;
  require(
    name: string,
    refs: ReferenceCase[],
    fonts: AtlasGlyphProvider,
    how: 'pixels' | 'but-euro' | 'cells' | 'pens',
  ) {
    const s = scoreReplays(refs, fonts, how);
    this.cases += s.cases;
    this.equal += s.equal;
    this.required += 1;
    if (s.cases === 0) this.failures.push(`${name}: no cases`);
    this.failures.push(...s.differences.slice(0, 10).map((d) => `${name}: ${d}`));
    this.lines.push(
      `${name}: ${s.equal} of ${s.cases} equal${s.differences.length ? ` - ${s.differences.length} DIFFER` : ''}`,
    );
  }
  report(
    name: string,
    refs: ReferenceCase[],
    fonts: AtlasGlyphProvider,
    how: 'pixels' | 'but-euro' | 'cells' | 'pens',
  ) {
    const s = scoreReplays(refs, fonts, how);
    this.lines.push(
      `${name}: reported, not required - ${s.equal} of ${s.cases} equal (pictures ${s.picturesEqual}, pens ${s.pensEqual})`,
    );
  }
  /** The capture's pen of each case equals the pinned pen (the pins describe these references). */
  pinned(name: string, refs: ReferenceCase[], pins: Map<string, number>) {
    const wrong = refs.filter((r) => r.pen[0] - onlyText(r).x !== pins.get(euroKey(r))).map((r) => r.case.id);
    this.failures.push(...wrong.map((id) => `${name}: the capture's pen of ${id} is not the pinned one`));
    this.lines.push(
      `${name}: ${refs.length} texts of the suite are pinned${wrong.length ? `, ${wrong.length} DISAGREE` : ''}`,
    );
  }
  /** The port's pen for one text of the pinned lists equals the pin. */
  pens(name: string, pins: { key: string; pen: number }[], fonts: AtlasGlyphProvider) {
    let equal = 0;
    for (const { key, pen } of pins) {
      const [face, size, style, hex] = key.split('|') as [string, string, string, string];
      const bytes = (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
      const port = replayCase(
        {
          id: key,
          width: 640,
          height: 260,
          ops: [
            { op: 'font', name: face, size: Number(size), style: Number(style) },
            { op: 'text', x: 6, y: 2, bytes },
          ],
        },
        fonts,
      );
      if (port.pen[0] - 6 === pen) equal += 1;
      else this.failures.push(`${name}: ${key}: port ${port.pen[0] - 6}, Windows ${pen}`);
    }
    this.cases += pins.length;
    this.equal += equal;
    this.required += 1;
    this.lines.push(`${name}: ${equal} of ${pins.length} pens equal`);
  }
}

interface SuiteCount {
  readonly suite: string;
  readonly total: number;
  readonly compared: number;
  readonly equal: number;
  readonly failures: readonly string[];
}

/** T2's comparison of surface.test.ts for a primitive suite, counted instead of asserted. */
function countSuite(suite: string): SuiteCount {
  let compared = 0;
  let equal = 0;
  let total = 0;
  const failures: string[] = [];
  for (const r of references(suite)) {
    total++;
    const got = replayOnSurface(r.case, 'raster');
    compared++;
    const diff = firstDifference(got, r.image);
    if (diff) failures.push(`${r.case.id}: ${diff.count} pixels`);
    else if (got.pen[0] !== r.pen[0] || got.pen[1] !== r.pen[1]) failures.push(`${r.case.id}: pen`);
    else equal++;
  }
  return { suite, total, compared, equal, failures };
}

/** Widths in effect at each drawing op of a case. */
function opsWithWidth(c: GdiCase): { op: GdiOp; width: number; mode: number }[] {
  let width = 1;
  let mode = 4;
  const out: { op: GdiOp; width: number; mode: number }[] = [];
  for (const op of c.ops) {
    if (op.op === 'width') width = op.value;
    else if (op.op === 'mode') mode = op.value;
    else out.push({ op, width, mode });
  }
  return out;
}

describe('item 3: the thresholds of 6.5', () => {
  it(
    '6.5.1: every case of every primitive suite that does not depend on the machine is equal to GDI',
    () => {
      const results: SuiteCount[] = [];
      for (const suite of suiteNames()) {
        if (isText(suite)) continue;
        if (isMachineSuite(suite)) {
          say(
            `6.5.1 ${suite}: ${references(suite).length} references, machine-dependent (system colours), not judged (6.2.3, erratum T2 17)`,
          );
          continue;
        }
        const r = countSuite(suite);
        results.push(r);
        say(
          `6.5.1 ${suite}: ${r.equal} of ${r.compared} cases every pixel and pen equal` +
            (r.failures.length ? `; differing: ${r.failures.slice(0, 10).join(', ')}` : ''),
        );
      }
      const sum = (k: 'equal' | 'compared') => results.reduce((n, r) => n + r[k], 0);
      say(`6.5.1 primitives total: ${sum('equal')} of ${sum('compared')} cases equal in ${results.length} suites`);
      expect(results.flatMap((r) => r.failures.map((f) => `${r.suite} ${f}`))).toEqual([]);
    },
    T,
  );

  it(
    '6.5.3: text as the architect decided on 22 November 2026 (errata T2 25, T2 26, T2 28, T2 29)',
    async () => {
      const fonts = await glyphs();
      const rule = new Rule();
      // (1) Raster-face texts off the text path: every pixel and the pen.
      rule.require('(1) text, raster faces off the text path: every pixel and pen', suite('text'), fonts, 'pixels');
      // Outline faces: the cell rectangles and the pen (6.5.3, second half of the first bullet).
      const onlyDel = (r: ReferenceCase) =>
        r.case.ops.some(
          (o) =>
            o.op === 'text' && o.bytes.includes(0x7f) && o.bytes.every((b) => b === 0x7f || ZERO_WIDTH.includes(b)),
        );
      const outline = suite('text-outline');
      rule.require(
        'outline faces, text-outline, fixed-pitch faces: cells and pen',
        outline.filter((r) => !isProportionalName(fontOfCase(r.case).name)),
        fonts,
        'cells',
      );
      // The proportional substitute (font numbers 5 and 7): Windows' widths where the size has an
      // atlas; elsewhere they are estimated from the nearest atlas, a recorded difference
      // (docs/differences/SH3.md), reported here.
      const arialSizes = (await outlineIndex()).filter((a) => a.face === 'Arial').map((a) => a.size as number);
      const proportional = outline.filter((r) => isProportionalName(fontOfCase(r.case).name));
      const sameCell = (a: FontSpec, b: FontSpec) => {
        const [ca, cb] = [fonts.metrics(a), fonts.metrics(b)];
        return ca.colWidth === cb.colWidth && ca.rowHeight === cb.rowHeight;
      };
      const measured = proportional.filter((r) => {
        const f = fontOfCase(r.case);
        return arialSizes.some((size) => size === f.size || sameCell(spec(f), spec({ ...f, size })));
      });
      rule.require(
        'outline faces, text-outline, proportional substitute at sizes with an atlas: cells and pen',
        measured,
        fonts,
        'cells',
      );
      rule.report(
        'outline faces, text-outline, proportional substitute at other sizes (widths estimated, SH3)',
        proportional.filter((r) => !measured.includes(r)),
        fonts,
        'cells',
      );
      rule.require(
        'outline faces, text-outline-zero: cells and pen (pen only where the text draws only $7F)',
        suite('text-outline-zero').filter((r) => !onlyDel(r)),
        fonts,
        'cells',
      );
      rule.require(
        'outline faces, text-outline-zero, texts of only $7F: pen',
        suite('text-outline-zero').filter(onlyDel),
        fonts,
        'pens',
      );
      rule.require(
        'outline faces, text-outline-italic: cells and pen',
        suite('text-outline-italic').filter((r) => !onlyDel(r)),
        fonts,
        'cells',
      );
      rule.require('outline faces, text-outline-glyphs: pen', suite('text-outline-glyphs'), fonts, 'pens');
      // (2) On the text path where Windows is deterministic and draws from the face itself.
      rule.require('(2) text-path: every pixel and pen', suite('text-path'), fonts, 'pixels');
      const control = suite('text-control');
      const fallback = control.filter(hasFallbackByte);
      const pathControl = control.filter((r) => !hasFallbackByte(r));
      const exact = pathControl.filter((r) => euroInk(r.case, fonts) === null);
      const withEuro = pathControl.filter((r) => euroInk(r.case, fonts) !== null);
      rule.require('(2) text-control without a fallback byte or $80: every pixel and pen', exact, fonts, 'pixels');
      // (3a, 3b) The euro sign: the pen and every pixel outside its glyph where Windows gives the same
      // pen in every history (golden/text-path-euro-pens.json); the rest reported.
      const pinned = euroPens();
      const held = (rs: ReferenceCase[]) => rs.filter((r) => pinned.has(euroKey(r)));
      const notHeld = (rs: ReferenceCase[]) => rs.filter((r) => !pinned.has(euroKey(r)));
      rule.pinned('(3) text-control with $80, pinned pens', held(withEuro), pinned);
      rule.require(
        '(3) text-control with $80, pinned: every pixel but the euro sign, and the pen',
        held(withEuro),
        fonts,
        'but-euro',
      );
      rule.report('(3b) text-control with $80, pen depends on history', notHeld(withEuro), fonts, 'but-euro');
      const euro = suite('text-path-euro');
      rule.pinned('(3) text-path-euro, pinned pens', held(euro), pinned);
      rule.require(
        '(3) text-path-euro, pinned: every pixel but the euro sign, and the pen',
        held(euro),
        fonts,
        'but-euro',
      );
      rule.report('(3b) text-path-euro, pen depends on history', notHeld(euro), fonts, 'but-euro');
      rule.pens(
        '(3) golden/text-path-euro-pens.json: every pinned pen',
        [...pinned].map(([key, pen]) => ({ key, pen })),
        fonts,
      );
      // (3a) The fallback-font bytes: the pen where the two captured Windows agree, every pixel where
      // they draw the same picture and pen.
      const runner = decodePack(
        new Uint8Array(readFileSync(new URL('windows-10.0.26100/text-control.pixpack.gz', GOLDEN))),
      );
      const agree = fallback.map((r) => {
        const other = runner.cases.find((c) => c.id === r.case.id);
        if (!other) throw new Error(`windows-10.0.26100/text-control.pixpack.gz has no ${r.case.id}`);
        const image = decodePix(other.pix);
        const samePicture = image.pixels.every((p, j) => (p & 0xffffff) === ((r.image.pixels[j] as number) & 0xffffff));
        const samePen = other.pen[0] === r.pen[0] && other.pen[1] === r.pen[1];
        return { r, samePicture, samePen };
      });
      rule.require(
        `(3a) text-control fallback bytes (${fallback.length} texts), pen where both Windows agree`,
        agree.filter((a) => a.samePen).map((a) => a.r),
        fonts,
        'pens',
      );
      rule.require(
        '(3a) text-control fallback bytes, every pixel and pen where both Windows draw the same',
        agree.filter((a) => a.samePen && a.samePicture).map((a) => a.r),
        fonts,
        'pixels',
      );
      rule.report(
        '(3a) text-control fallback bytes where the two Windows differ (recorded difference, SH3)',
        agree.filter((a) => !a.samePen || !a.samePicture).map((a) => a.r),
        fonts,
        'pixels',
      );
      // (3b) "@" in Courier on the text path: the pens without a byte of $80 or above.
      const at = JSON.parse(readFileSync(new URL('text-path-at-pens.json', GOLDEN), 'utf8')) as {
        cases: [number, number, string, number][];
      };
      rule.pens(
        '(3b) golden/text-path-at-pens.json: every pinned pen of "@" in Courier',
        at.cases.map(([size, style, hex, pen]) => ({ key: `Courier|${size}|${style}|${hex}`, pen })),
        fonts,
      );
      // One-build suites: reported, not required (6.5.3: no pen of $0C is required; text-path-fallback
      // and the history-dependent euro pens wait for a second build's capture, erratum T2 29).
      rule.report('(3a) text-path-formfeed ($0C on the path, one build)', suite('text-path-formfeed'), fonts, 'pixels');
      rule.report(
        '(3a) text-path-fallback (fallback bytes with $80 or above on the path, one build)',
        suite('text-path-fallback'),
        fonts,
        'pixels',
      );
      for (const l of rule.lines) say(`6.5.3 ${l}`);
      say(
        `6.5.3 required: ${rule.equal} of ${rule.cases} cases equal in ${rule.required} classes; ${rule.failures.length} differ`,
      );
      expect(rule.failures).toEqual([]);
    },
    T,
  );

  it('6.5.1: the suites have the sizes and the coverage 6.5.1 names', () => {
    const all = cases();
    const of = (suite: string) => all.filter((c) => c.suite === suite);
    const width1Lines = of('lines').filter((c) =>
      opsWithWidth(c).every((o) => (o.op.op !== 'line' && o.op.op !== 'lineto') || o.width === 1),
    ).length;
    const wide = of('widelines');
    const wideWidths = new Set(
      wide.flatMap((c) =>
        opsWithWidth(c)
          .filter((o) => o.op.op === 'line')
          .map((o) => o.width),
      ),
    );
    const rects = of('rects');
    const rectFilled = rects.filter((c) => c.ops.some((o) => o.op === 'rect')).length;
    const rectUnfilled = rects.filter((c) => c.ops.some((o) => o.op === 'urect')).length;
    const rectWidths = new Set(
      rects.flatMap((c) =>
        opsWithWidth(c)
          .filter((o) => o.op.op === 'rect' || o.op.op === 'urect')
          .map((o) => o.width),
      ),
    );
    const floods = of('floods').filter((c) => c.ops.some((o) => o.op === 'flood')).length;
    // the 16 raster operations on every primitive kind
    // (the suite's ten kinds of cases.ts KINDS: pixel, line, lineTo, wideLine, rect, urect, wideRect,
    // ellipse, uellipse, flood; counted here by the operation they draw with)
    const kinds = ['pixel', 'line', 'rect', 'urect', 'ellipse', 'uellipse', 'flood'];
    const modesByKind = new Map<string, Set<number>>(kinds.map((k) => [k, new Set()]));
    for (const c of of('modes'))
      for (const o of opsWithWidth(c)) modesByKind.get(o.op.op === 'lineto' ? 'line' : o.op.op)?.add(o.mode);
    const modeCover = kinds.map(
      (k) => `${k} ${[...(modesByKind.get(k) ?? [])].filter((m) => m >= 0 && m <= 15).length}/16`,
    );
    const pixels = of('pixels');
    const pixelsOutside = pixels.filter((c) =>
      c.ops.some((o) => o.op === 'pixel' && (o.x < 0 || o.y < 0 || o.x >= c.width || o.y >= c.height)),
    ).length;
    say(`6.5.1 width-1 lines: ${width1Lines} (threshold 10,000; suite lines has ${of('lines').length} cases)`);
    say(
      `6.5.1 wide lines: ${wide.length} cases, widths ${[...wideWidths].sort((a, b) => a - b).join(',')} (threshold 2,000, widths 2-14)`,
    );
    say(
      `6.5.1 rectangles: ${rects.length} cases, ${rectFilled} with a filled and ${rectUnfilled} with an unfilled rectangle, widths ${Math.min(...rectWidths)}-${Math.max(...rectWidths)} (threshold 10,000, widths 0-12)`,
    );
    say(`6.5.1 flood fills: ${floods} (threshold 1,000)`);
    say(`6.5.1 the 16 raster operations per primitive kind (suite modes): ${modeCover.join(', ')}`);
    say(`6.5.1 pixels: ${pixels.length} cases, ${pixelsOutside} with a pixel outside the surface`);
    say(
      `6.5.1 colour forms: ${of('colors').length} cases (and ${of('colors-system').length} machine-dependent system colours)`,
    );
    say(`6.5.1 clipping: ${of('clip').length} cases`);
    expect(width1Lines).toBeGreaterThanOrEqual(10_000);
    expect(wide.length).toBeGreaterThanOrEqual(2_000);
    for (let w = 2; w <= 14; w++) expect(wideWidths.has(w), `wide line width ${w}`).toBe(true);
    expect(rects.length).toBeGreaterThanOrEqual(10_000);
    for (let w = 0; w <= 12; w++) expect(rectWidths.has(w), `rectangle width ${w}`).toBe(true);
    expect(floods).toBeGreaterThanOrEqual(1_000);
    for (const k of kinds)
      expect(
        modeCover.find((m) => m.startsWith(`${k} `)),
        k,
      ).toBe(`${k} 16/16`);
    expect(pixelsOutside).toBeGreaterThan(0);
    expect(of('colors').length).toBeGreaterThan(0);
    expect(of('clip').length).toBeGreaterThan(0);
  });

  it(
    '6.5.2: ellipses',
    () => {
      const byId = new Map(generateEllipseCases().map((c) => [c.id, c]));
      const run = (suite: string) => {
        const pack = decodePack(new Uint8Array(readFileSync(new URL(`${suite}.pixpack.gz`, GOLDEN))));
        return pack.cases.map((p) => {
          const c = byId.get(p.id) as EllipseCase;
          const s = new Surface(c.width, c.height);
          for (const o of c.ops) {
            if (o.op === 'bg') s.back.data.fill((0xff000000 | (o.color & 0xffffff)) >>> 0);
            else if (o.op === 'pen') s.setLineColor(o.color);
            else if (o.op === 'fill') s.setFillColor(o.color);
            else if (o.op === 'width') s.setPenWidth(o.value);
            else if (o.op === 'mode') s.setDrawingMode(o.value);
            else if (o.op === 'ellipse') s.ellipse(o.x1, o.y1, o.x2, o.y2);
            else s.unfilledEllipse(o.x1, o.y1, o.x2, o.y2);
          }
          const want = decodePix(p.pix).pixels;
          let differing = 0;
          for (let i = 0; i < want.length; i++)
            if (((s.back.data[i] as number) & 0xffffff) !== ((want[i] as number) & 0xffffff)) differing++;
          return { c, differing };
        });
      };
      const outlineLength = (c: EllipseCase): number => {
        const o = c.ops.find((op) => op.op === 'ellipse' || op.op === 'uellipse');
        if (!o || (o.op !== 'ellipse' && o.op !== 'uellipse')) return 0;
        const [x1, x2] = o.x1 <= o.x2 ? [o.x1, o.x2] : [o.x2, o.x1];
        const [y1, y2] = o.y1 <= o.y2 ? [o.y1, o.y2] : [o.y2, o.y1];
        const seen = new Set<number>();
        const clip = { left: x1 - 1, top: y1 - 1, right: x2 + 2, bottom: y2 + 2 };
        rasterEllipse(
          x1,
          y1,
          x2,
          y2,
          1,
          clip,
          (y, from, to) => {
            for (let x = from; x <= to; x++) seen.add((y - y1 + 1) * (x2 - x1 + 3) + (x - x1 + 1));
          },
          null,
        );
        return seen.size;
      };
      const small = run('ellipses');
      const large = run('ellipses-large');
      const wide = run('ellipses-wide');
      const eq = (rs: { differing: number }[]) => rs.filter((r) => r.differing === 0).length;
      const beyond = large.filter((r) => r.differing > 0.005 * outlineLength(r.c));
      const worstLarge = Math.max(0, ...large.map((r) => r.differing));
      say(
        `6.5.2 small ellipses 1x1-64x64: ${eq(small)} of ${small.length} every pixel equal (threshold: all of 8,192)`,
      );
      say(
        `6.5.2 large ellipses 65-1,200: ${eq(large)} of ${large.length} every pixel equal (${((100 * eq(large)) / large.length).toFixed(1)} %, threshold 95 %); ${beyond.length} beyond 0.5 % of the outline (threshold 0); worst ${worstLarge} pixels`,
      );
      say(
        `6.5.2 wide-pen ellipses (reported, no threshold; baseline 496): ${eq(wide)} of ${wide.length} every pixel equal; differing ${wide
          .filter((r) => r.differing > 0)
          .map((r) => `${r.c.id} (${r.differing})`)
          .join(', ')}`,
      );
      expect(small).toHaveLength(8192);
      expect(eq(small)).toBe(8192);
      expect(large).toHaveLength(3000);
      expect(eq(large)).toBeGreaterThanOrEqual(2850);
      expect(beyond).toHaveLength(0);
      expect(wide).toHaveLength(500);
      expect(eq(wide)).toBeGreaterThanOrEqual(496);
    },
    T,
  );

  it('6.5.4: the whole-program baseline holds every official example, twenty conformance programs and the scenes', () => {
    const golden = JSON.parse(
      readFileSync(new URL('../../conformance/examples/golden/surfaces.json', import.meta.url), 'utf8'),
    ) as { examples: Record<string, { surfaceHash: string; screenHash: string }> | { id: string }[] };
    const ids = Array.isArray(golden.examples) ? golden.examples.map((e) => e.id) : Object.keys(golden.examples);
    const officialDir = fileURLToPath(new URL('../../corpus/official/', import.meta.url));
    const official = readdirSync(officialDir)
      .filter((f) => /\.x68$/i.test(f))
      .map((f) => `official/${f.replace(/\.x68$/i, '')}`);
    const missingOfficial = official.filter((id) => !ids.includes(id));
    const conformance = ids.filter((id) => id.startsWith('conformance/'));
    const scenes = ids.filter((id) => id.startsWith('scene/'));
    say(
      `6.5.4 whole programs: ${ids.length} in golden/surfaces.json: ${ids.filter((id) => id.startsWith('official/')).length} official (of ${official.length} in tests/corpus/official), ${conformance.length} conformance (threshold 20), ${scenes.length} scenes`,
    );
    expect(missingOfficial).toEqual([]);
    expect(conformance.length).toBeGreaterThanOrEqual(20);
  });

  it('prints the summary', () => {
    console.log(`\nitem 3 summary\n${lines.map((l) => `  ${l}`).join('\n')}`);
  });
});
