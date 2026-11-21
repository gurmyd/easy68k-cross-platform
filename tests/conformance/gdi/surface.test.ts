// The port's drawing surface against the GDI capture (ARCHITECTURE.md 6.5.1, 6.5.3): every case of
// every suite that does not depend on the machine, every pixel and the pen position.
//
// Cases with ellipses or with pen widths of 2 and more belong to SH2 (surface/ellipse.ts,
// surface/widepen.ts; wave 2): they are compared in tests of their own, which are skipped while the
// Surface does not draw ellipses, or a width-5 dot of 21 pixels (trap15-b 6.2), yet. While the
// Surface is still the wave-0 stub every comparison is skipped with a note.
// Owner: T2 (the test); held to it: SH1 (surface), SH2 (ellipses and wide pens).

import { describe, expect, it } from 'vitest';
import type { GdiCase } from './cases';
import { loadMetrics } from './fonts';
import { firstDifference, hex6, isMachineSuite, references, suiteNames } from './golden';
import { blankOutlineGlyph, replayOnSurface, surfaceDraws, surfaceDrawsEllipses, surfaceDrawsWidePens } from './replay';
import { outlineCells } from './text-model';

const draws = surfaceDraws();
const ellipses = draws && surfaceDrawsEllipses();
const widePens = draws && surfaceDrawsWidePens();
const metrics = loadMetrics();
if (!draws) console.log('GDI conformance: the Surface is still the wave-0 stub; the surface comparisons are skipped.');

/** Whether a case needs SH2's ellipses or wide pens. */
function sh2(c: GdiCase): { ellipse: boolean; wide: boolean } {
  let width = 1;
  let wide = false;
  let ellipse = false;
  for (const o of c.ops) {
    if (o.op === 'width') width = o.value;
    else if (o.op === 'ellipse' || o.op === 'uellipse') ellipse = true;
    else if (width >= 2 && (o.op === 'line' || o.op === 'lineto' || o.op === 'rect' || o.op === 'urect')) wide = true;
  }
  return { ellipse, wide };
}

function compare(suite: string, select: (c: GdiCase) => boolean): string[] {
  const failures: string[] = [];
  let compared = 0;
  for (const r of references(suite)) {
    if (!select(r.case)) continue;
    // Outline faces: only the cells and the pen are compared (6.5.3), not the pixels GDI adds outside them.
    const cells = suite === 'text-outline' ? outlineCells(metrics, r.case) : undefined;
    if (cells === null) continue;
    const got = replayOnSurface(r.case, suite === 'text-outline' ? blankOutlineGlyph : undefined);
    compared++;
    const diff = firstDifference(got, r.image, cells ? (x, y) => !cells.uncertain(x, y) : undefined);
    if (diff) {
      failures.push(
        `${r.case.id}: ${diff.count} pixels differ, first at ${diff.x},${diff.y}: ${hex6(diff.got)}, GDI ${hex6(diff.want)}`,
      );
    } else if (got.pen[0] !== r.pen[0] || got.pen[1] !== r.pen[1]) {
      failures.push(`${r.case.id}: pen ${got.pen}, GDI ${r.pen}`);
    }
  }
  return failures.length === 0 ? [] : [`${failures.length} of ${compared} cases differ`, ...failures.slice(0, 15)];
}

const suites = suiteNames().filter((s) => !isMachineSuite(s));

describe.skipIf(!draws)('Surface against the GDI capture (SH1)', () => {
  for (const suite of suites) {
    it(`${suite}: every pixel and pen position equal`, () => {
      expect(compare(suite, (c) => !sh2(c).ellipse && !sh2(c).wide)).toEqual([]);
    }, 300_000);
  }
});

describe.skipIf(!widePens)('Surface against the GDI capture: wide pens (SH2)', () => {
  for (const suite of suites) {
    it(`${suite}: every pixel and pen position equal`, () => {
      expect(compare(suite, (c) => sh2(c).wide && (ellipses || !sh2(c).ellipse))).toEqual([]);
    }, 300_000);
  }
});

describe.skipIf(!ellipses)('Surface against the GDI capture: ellipses (SH2)', () => {
  for (const suite of suites) {
    it(`${suite}: every pixel and pen position equal`, () => {
      expect(compare(suite, (c) => sh2(c).ellipse && (widePens || !sh2(c).wide))).toEqual([]);
    }, 300_000);
  }
});
