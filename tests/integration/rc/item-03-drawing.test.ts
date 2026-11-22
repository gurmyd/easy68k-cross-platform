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
//   6.5.3  the raster-face text suite (every pixel and pen) and the outline-face suites (cells and
//          pen) through T2's replay; the machine-dependent suites are counted and named, not judged;
//   6.5.4  X3's whole-program baseline holds every official example, the twenty conformance
//          programs and X3's own scenes (the browser half is `npm run check:examples`).
//
// It reuses T2's and SH2's readers and replays (tests/conformance/gdi) and the real Surface; it
// judges nothing those suites do not judge, it only counts. No browser.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rasterEllipse } from '../../../app/src/core/sim-host/surface/ellipse';
import { Surface } from '../../../app/src/core/sim-host/surface/surface';
import type { GdiCase, GdiOp } from '../../conformance/gdi/cases';
import { generateEllipseCases, type EllipseCase } from '../../conformance/gdi/cases-ellipse';
import { loadMetrics } from '../../conformance/gdi/fonts';
import { cases, firstDifference, isMachineSuite, references, suiteNames } from '../../conformance/gdi/golden';
import { decodePack, decodePix } from '../../conformance/gdi/pix';
import { replayOnSurface } from '../../conformance/gdi/replay';
import { outlineCells } from '../../conformance/gdi/text-model';

const T = 600_000;
const GOLDEN = new URL('../../conformance/gdi/golden/', import.meta.url);
const OUTLINE_CELL_SUITES = ['text-outline', 'text-outline-zero'];
const TEXT_SUITES = [
  'text',
  'text-control',
  'text-outline',
  'text-outline-zero',
  'text-outline-glyphs',
  'text-outline-italic',
];

const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  console.log(line);
};

interface SuiteCount {
  readonly suite: string;
  readonly total: number;
  readonly compared: number;
  readonly equal: number;
  readonly failures: readonly string[];
}

/** T2's comparison of surface.test.ts, counted instead of asserted. */
function countSuite(suite: string): SuiteCount {
  const metrics = loadMetrics();
  const outline = OUTLINE_CELL_SUITES.includes(suite);
  let compared = 0;
  let equal = 0;
  let total = 0;
  const failures: string[] = [];
  for (const r of references(suite)) {
    total++;
    const cells = outline ? outlineCells(metrics, r.case) : undefined;
    if (cells === null) continue;
    const got = replayOnSurface(r.case, outline ? 'outline' : 'raster');
    compared++;
    const diff = firstDifference(got, r.image, cells ? (x, y) => !cells.uncertain(x, y) : undefined);
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
    '6.5.1 and 6.5.3: every case of every primitive and text suite that does not depend on the machine is equal to GDI',
    () => {
      const all = suiteNames();
      const results: SuiteCount[] = [];
      for (const suite of all) {
        if (isMachineSuite(suite)) {
          say(
            `6.5 ${suite}: ${references(suite).length} references, machine-dependent, not judged (6.2.3, erratum T2 17)`,
          );
          continue;
        }
        const r = countSuite(suite);
        results.push(r);
        const skipped = r.total - r.compared;
        say(
          `6.5 ${suite}: ${r.equal} of ${r.compared} cases every pixel and pen equal` +
            (skipped ? ` (${skipped} of ${r.total} outside the cell model, not compared)` : '') +
            (r.failures.length ? `; differing: ${r.failures.slice(0, 10).join(', ')}` : ''),
        );
      }
      const prim = results.filter((r) => !TEXT_SUITES.includes(r.suite));
      const text = results.filter((r) => TEXT_SUITES.includes(r.suite));
      const sum = (rs: SuiteCount[], k: 'equal' | 'compared') => rs.reduce((n, r) => n + r[k], 0);
      say(
        `6.5.1 primitives total: ${sum(prim, 'equal')} of ${sum(prim, 'compared')} cases equal in ${prim.length} suites`,
      );
      say(`6.5.3 text total: ${sum(text, 'equal')} of ${sum(text, 'compared')} cases equal in ${text.length} suites`);
      expect(results.flatMap((r) => r.failures.map((f) => `${r.suite} ${f}`))).toEqual([]);
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
