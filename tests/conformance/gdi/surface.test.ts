// The port's drawing surface against the GDI capture (ARCHITECTURE.md 6.5.1, 6.5.3): every case of
// every suite that does not depend on the machine, every pixel and the pen position.
//
// Who is held to which case (3.4): ellipses (rule 6) and lines drawn with a pen 2 or more pixels
// wide (rule 4) belong to SH2 (surface/ellipse.ts, surface/widepen.ts; wave 2); everything else,
// wide rectangle frames included (rule 5, rect.ts), belongs to SH1.
//
// Until SH2 lands, ellipse.ts and widepen.ts are SH1's stubs, whose headers start with
// "// STUB written by SH1". While a file is still that stub its cases WAIT: they are reported as
// skipped tests whose names give the number of waiting cases and the reason, and a summary line
// counts them. When SH2 replaces a file (and with it the header) its cases start to count by
// themselves. While the Surface is still the wave-0 stub every comparison is skipped with a note.
// Owner: T2 (the test); held to it: SH1 (surface), SH2 (ellipses and wide pens).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GdiCase } from './cases';
import { loadMetrics } from './fonts';
import { cases, firstDifference, hex6, isMachineSuite, references, suiteNames } from './golden';
import { blankOutlineGlyph, replayOnSurface, surfaceDraws } from './replay';
import { outlineCells } from './text-model';

const SURFACE_DIR = new URL('../../../app/src/core/sim-host/surface/', import.meta.url);

/** Whether an SH2 file is still SH1's stub (its header says so until SH2 replaces it). */
export function stillSh1Stub(source: string): boolean {
  return /^\/\/ STUB written by SH1\b/m.test(source);
}

const draws = surfaceDraws();
const ellipsesLanded = !stillSh1Stub(readFileSync(new URL('ellipse.ts', SURFACE_DIR), 'utf8'));
const widePensLanded = !stillSh1Stub(readFileSync(new URL('widepen.ts', SURFACE_DIR), 'utf8'));
const metrics = loadMetrics();
if (!draws) console.log('GDI conformance: the Surface is still the wave-0 stub; the surface comparisons are skipped.');

/** Which of SH2's parts a case needs: an ellipse, or a line drawn with a pen 2 or more pixels wide. */
export function sh2Parts(c: GdiCase): { ellipse: boolean; wide: boolean } {
  let width = 1;
  let wide = false;
  let ellipse = false;
  for (const o of c.ops) {
    if (o.op === 'width') width = o.value;
    else if (o.op === 'ellipse' || o.op === 'uellipse') ellipse = true;
    else if (width >= 2 && (o.op === 'line' || o.op === 'lineto')) wide = true;
  }
  return { ellipse, wide };
}

/** Whether a case waits for a part of SH2 that has not landed. */
const waits = (c: GdiCase) => {
  const p = sh2Parts(c);
  return (p.ellipse && !ellipsesLanded) || (p.wide && !widePensLanded);
};
const why = (c: GdiCase) => {
  const p = sh2Parts(c);
  return p.ellipse && !ellipsesLanded ? 'ellipse.ts' : 'widepen.ts';
};

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
const waiting = new Map<string, Map<string, number>>(); // suite -> file -> cases
for (const c of cases()) {
  if (!suites.includes(c.suite) || !waits(c)) continue;
  const bySuite = waiting.get(c.suite) ?? waiting.set(c.suite, new Map()).get(c.suite)!;
  bySuite.set(why(c), (bySuite.get(why(c)) ?? 0) + 1);
}
const waitingTotal = [...waiting.values()].reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0);
if (draws && waitingTotal > 0)
  console.log(
    `GDI conformance: ${waitingTotal} cases wait for SH2 (` +
      [!ellipsesLanded && 'ellipse.ts', !widePensLanded && 'widepen.ts'].filter(Boolean).join(' and ') +
      " still SH1's stub) and are not compared yet.",
  );

describe.skipIf(!draws)('Surface against the GDI capture', () => {
  for (const suite of suites) {
    it(`${suite}: every pixel and pen position equal`, () => {
      expect(compare(suite, (c) => !waits(c))).toEqual([]);
    }, 300_000);
    for (const [file, n] of waiting.get(suite) ?? []) {
      it.skip(`${suite}: ${n} cases wait for SH2 (surface/${file} is still SH1's stub)`, () => {});
    }
  }
});

describe('which cases wait for SH2', () => {
  it('a header that starts with "// STUB written by SH1" marks a stub, any other header does not', () => {
    expect(stillSh1Stub('// Ellipses (3.4).\n//\n// STUB written by SH1 (wave 1). SH2 replaces ...\n')).toBe(true);
    expect(stillSh1Stub("// Ellipses (3.4).\n//\n// GDI's ellipse, flattened Bezier quarters (SH2).\n")).toBe(false);
  });

  it('ellipses and wide lines are SH2 parts; wide rectangle frames and width-1 lines are not', () => {
    const c = (ops: GdiCase['ops']): GdiCase => ({ id: 'x', suite: 'x', width: 8, height: 8, ops });
    expect(
      sh2Parts(
        c([
          { op: 'width', value: 3 },
          { op: 'rect', x1: 1, y1: 1, x2: 5, y2: 5 },
        ]),
      ),
    ).toEqual({
      ellipse: false,
      wide: false,
    });
    expect(
      sh2Parts(
        c([
          { op: 'width', value: 3 },
          { op: 'line', x1: 1, y1: 1, x2: 5, y2: 5 },
        ]),
      ),
    ).toEqual({
      ellipse: false,
      wide: true,
    });
    expect(
      sh2Parts(
        c([
          { op: 'width', value: 1 },
          { op: 'lineto', x: 5, y: 5 },
        ]),
      ),
    ).toEqual({
      ellipse: false,
      wide: false,
    });
    expect(sh2Parts(c([{ op: 'uellipse', x1: 1, y1: 1, x2: 5, y2: 5 }]))).toEqual({ ellipse: true, wide: false });
  });
});
