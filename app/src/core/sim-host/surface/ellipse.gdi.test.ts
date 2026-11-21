// The surface's ellipses against what Windows GDI drew (ARCHITECTURE.md 6.5.2). Owner: SH2.
//
// The references are the packs tests/conformance/gdi/golden/ellipses*.pixpack.gz, captured by T2's
// program from the case lists of tests/conformance/gdi/cases-ellipse.ts. Each case is replayed on
// a real Surface, one method per operation, and compared pixel by pixel. The figures printed here
// are the ones in docs/porting/gdi-deviations.md, which are the regression baseline: a change may
// not make them worse.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateEllipseCases, type EllipseCase } from '../../../../../tests/conformance/gdi/cases-ellipse';
import { decodePack, decodePix } from '../../../../../tests/conformance/gdi/pix';
import { rasterEllipse } from './ellipse';
import { Surface } from './surface';

const GOLDEN = new URL('../../../../../tests/conformance/gdi/golden/', import.meta.url);

interface Result {
  readonly c: EllipseCase;
  readonly differing: number;
}

const casesById = new Map(generateEllipseCases().map((c) => [c.id, c]));

/** Replays every case of a suite on the Surface and counts the pixels that differ from GDI's. */
function compareSuite(suite: string): Result[] {
  const pack = decodePack(new Uint8Array(readFileSync(new URL(`${suite}.pixpack.gz`, GOLDEN))));
  return pack.cases.map((p) => {
    const c = casesById.get(p.id);
    if (!c) throw new Error(`${suite}: reference ${p.id} has no case in cases-ellipse.ts`);
    const surface = new Surface(c.width, c.height);
    for (const o of c.ops) {
      if (o.op === 'bg') surface.back.data.fill((0xff000000 | (o.color & 0xffffff)) >>> 0);
      else if (o.op === 'pen') surface.setLineColor(o.color);
      else if (o.op === 'fill') surface.setFillColor(o.color);
      else if (o.op === 'width') surface.setPenWidth(o.value);
      else if (o.op === 'mode') surface.setDrawingMode(o.value);
      else if (o.op === 'ellipse') surface.ellipse(o.x1, o.y1, o.x2, o.y2);
      else surface.unfilledEllipse(o.x1, o.y1, o.x2, o.y2);
    }
    const want = decodePix(p.pix).pixels;
    const got = surface.back.data;
    let differing = 0;
    for (let i = 0; i < want.length; i++)
      if (((got[i] as number) & 0xffffff) !== ((want[i] as number) & 0xffffff)) differing++;
    return { c, differing };
  });
}

/** The number of pixels in the whole outline of a case's ellipse (one-pixel pen). */
function outlineLength(c: EllipseCase): number {
  const o = c.ops.find((op) => op.op === 'ellipse' || op.op === 'uellipse');
  if (!o || (o.op !== 'ellipse' && o.op !== 'uellipse')) throw new Error(`${c.id}: no ellipse`);
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
}

function summary(suite: string, results: readonly Result[]): string {
  const equal = results.filter((r) => r.differing === 0).length;
  const worst = results.reduce((w, r) => (r.differing > w.differing ? r : w), results[0] as Result);
  return `${suite}: ${equal} of ${results.length} cases every pixel equal; worst ${worst.c.id} with ${worst.differing} pixels`;
}

/**
 * The wide-pen cases replayed on rasterEllipse directly, as the Surface will call it once it passes
 * the drawing mode (docs/requests/SH2-ellipse-mode.md): the pen and fill colours of the cases are
 * plain RGB, and the cases use Copy (mode 4) or XOR (mode 14) only.
 */
function compareWideDirect(): Result[] {
  const pack = decodePack(new Uint8Array(readFileSync(new URL('ellipses-wide.pixpack.gz', GOLDEN))));
  return pack.cases.map((p) => {
    const c = casesById.get(p.id)!;
    const data = new Uint32Array(c.width * c.height);
    let pen = 0xffffff;
    let fill = 0;
    let width = 1;
    let xor = false;
    for (const o of c.ops) {
      if (o.op === 'bg') data.fill(o.color & 0xffffff);
      else if (o.op === 'pen') pen = o.color & 0xffffff;
      else if (o.op === 'fill') fill = o.color & 0xffffff;
      else if (o.op === 'width') width = o.value;
      else if (o.op === 'mode') xor = o.value === 14;
      else {
        const sink = (colour: number) => (y: number, from: number, to: number) => {
          if (y < 0 || y >= c.height) return;
          for (let x = Math.max(from, 0); x <= Math.min(to, c.width - 1); x++) {
            const i = y * c.width + x;
            data[i] = xor ? (data[i] as number) ^ colour : colour;
          }
        };
        const [x1, x2] = o.x1 <= o.x2 ? [o.x1, o.x2] : [o.x2, o.x1];
        const [y1, y2] = o.y1 <= o.y2 ? [o.y1, o.y2] : [o.y2, o.y1];
        const clip = { left: 0, top: 0, right: c.width, bottom: c.height };
        rasterEllipse(x1, y1, x2, y2, width, clip, sink(pen), o.op === 'ellipse' ? sink(fill) : null, !xor);
      }
    }
    const want = decodePix(p.pix).pixels;
    let differing = 0;
    for (let i = 0; i < want.length; i++) if (data[i] !== ((want[i] as number) & 0xffffff)) differing++;
    return { c, differing };
  });
}

/** The measured figures of the suites without a pass threshold (docs/porting/gdi-deviations.md). */
const BASELINE = { wideEqualSurface: 496, wideEqualWithMode: 496 } as const;

describe('ellipses against the GDI capture (6.5.2)', () => {
  it('every box size from 1 x 1 to 64 x 64, filled and unfilled, one-pixel pen: every pixel equal', () => {
    const results = compareSuite('ellipses');
    console.log(summary('ellipses', results));
    expect(results).toHaveLength(8192);
    expect(results.filter((r) => r.differing > 0).map((r) => `${r.c.id}: ${r.differing}`)).toEqual([]);
  }, 300_000);

  it('3,000 boxes with sides 65 to 1,200: 95 % every pixel equal, none beyond 0.5 % of its outline', () => {
    const results = compareSuite('ellipses-large');
    console.log(summary('ellipses-large', results));
    expect(results).toHaveLength(3000);
    const equal = results.filter((r) => r.differing === 0).length;
    expect(equal).toBeGreaterThanOrEqual(Math.ceil(0.95 * results.length));
    const beyond = results.filter((r) => r.differing > 0.005 * outlineLength(r.c));
    expect(beyond.map((r) => `${r.c.id}: ${r.differing}`)).toEqual([]);
  }, 300_000);

  it('500 boxes with pen widths 2 to 8: reported, and not worse than the recorded baseline', () => {
    const results = compareSuite('ellipses-wide');
    console.log(summary('ellipses-wide', results));
    const differing = results.filter((r) => r.differing > 0);
    console.log(
      `ellipses-wide, differing cases: ${differing.map((r) => `${r.c.id} (${r.differing})`).join(', ') || 'none'}`,
    );
    expect(results).toHaveLength(500);
    expect(results.length - differing.length).toBeGreaterThanOrEqual(BASELINE.wideEqualSurface);
    const direct = compareWideDirect();
    console.log(summary('ellipses-wide with the drawing mode passed', direct));
    expect(direct.filter((r) => r.differing === 0).length).toBeGreaterThanOrEqual(BASELINE.wideEqualWithMode);
  }, 300_000);
});
