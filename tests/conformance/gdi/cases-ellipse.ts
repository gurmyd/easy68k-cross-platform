// Case lists of the ellipse pixel tests (ARCHITECTURE.md 6.5.2). Owner: SH2 (the folder is T2's).
//
// The cases have the form of cases.ts (a fresh black canvas, the start-up graphics state of
// trap15-b 3.2, then a list of operations), so the GDI capture (tests/oracle/gdi-capture/run.mjs)
// captures them with the others, into one pack per suite (golden/<suite>.pixpack.gz), and
// app/src/core/sim-host/surface/ellipse.gdi.test.ts holds the port's surface to them.
//
// This file must stay free of imports and of TypeScript syntax that is not erasable: run.mjs loads
// it with Node's built-in type stripping. The types repeat those of cases.ts.

export type EllipseOp =
  | { op: 'bg'; color: number }
  | { op: 'pen'; color: number }
  | { op: 'fill'; color: number }
  | { op: 'width'; value: number }
  | { op: 'mode'; value: number }
  | { op: 'ellipse'; x1: number; y1: number; x2: number; y2: number }
  | { op: 'uellipse'; x1: number; y1: number; x2: number; y2: number };

export interface EllipseCase {
  readonly id: string;
  readonly suite: string;
  readonly width: number;
  readonly height: number;
  readonly ops: readonly EllipseOp[];
}

/** The suites of 6.5.2 and what each is held to. None depends on the machine's settings. */
export const ELLIPSE_SUITES: readonly { readonly name: string; readonly about: string }[] = [
  {
    name: 'ellipses',
    about:
      'every box size 1x1 to 64x64 with a one-pixel pen, filled (mode 6, which shows the order and the number of visits) and unfilled (XOR, which shows double visits): every pixel equal (6.5.2)',
  },
  {
    name: 'ellipses-large',
    about:
      '3,000 random boxes with sides 65 to 1,200, one-pixel pen, filled, in Copy; the canvas shows a part of each: 95 % of the cases every pixel equal, none worse than 0.5 % of its outline (6.5.2)',
  },
  {
    name: 'ellipses-wide',
    about: '500 random boxes with pen widths 2 to 8, filled and unfilled, in Copy and XOR: reported (6.5.2)',
  },
];

/** The seed of the lists (independent of cases.ts, so that T2's lists do not change). */
export const ELLIPSE_SEED = 0x68e11;

/** mulberry32, as in cases.ts. */
function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rng(seed: number): (lo: number, hi: number) => number {
  const next = createRandom(seed);
  return (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
}

const pad = (n: number): string => String(n).padStart(5, '0');

/** Background, pen and fill whose combinations are distinct in every channel. */
const BACKGROUND = 0x336699;
const PEN = 0x0f0ff0;
const FILL = 0xf0f00f;

/** All box sizes 1x1 to 64x64, filled and unfilled (8,192 cases). */
function ellipses(): EllipseCase[] {
  const cases: EllipseCase[] = [];
  for (const filled of [true, false]) {
    for (let w = 1; w <= 64; w++) {
      for (let h = 1; h <= 64; h++) {
        cases.push({
          id: `ellipses-${pad(cases.length)}`,
          suite: 'ellipses',
          width: w + 4,
          height: h + 4,
          ops: [
            { op: 'bg', color: BACKGROUND },
            { op: 'pen', color: PEN },
            { op: 'fill', color: FILL },
            // Mode 6 (P | ~D) changes a pixel visited twice again and tells interior-then-outline
            // from the reverse; XOR shows which outline pixels are visited an even number of times.
            { op: 'mode', value: filled ? 6 : 14 },
            { op: filled ? 'ellipse' : 'uellipse', x1: 2, y1: 2, x2: w + 1, y2: h + 1 },
          ],
        });
      }
    }
  }
  return cases;
}

/** The canvas of the large boxes: each box is placed so that part of it lies on it. */
export const LARGE_CANVAS = { width: 200, height: 150 } as const;

/** 3,000 random boxes with sides 65 to 1,200. */
function ellipsesLarge(): EllipseCase[] {
  const r = rng(ELLIPSE_SEED + 1);
  const cases: EllipseCase[] = [];
  const { width: W, height: H } = LARGE_CANVAS;
  while (cases.length < 3_000) {
    const w = r(65, 1200);
    const h = r(65, 1200);
    // The left and top edge somewhere from "just the right part shows" to "just the left part".
    const x1 = r(-w + 8, W - 8);
    const y1 = r(-h + 8, H - 8);
    // Corners in either order: the surface sorts them (trap15-b 6.4).
    const swapX = r(0, 1) === 1;
    const swapY = r(0, 1) === 1;
    const [ax, bx] = swapX ? [x1 + w - 1, x1] : [x1, x1 + w - 1];
    const [ay, by] = swapY ? [y1 + h - 1, y1] : [y1, y1 + h - 1];
    cases.push({
      id: `ellipses-large-${pad(cases.length)}`,
      suite: 'ellipses-large',
      width: W,
      height: H,
      ops: [
        { op: 'fill', color: 0x0000ff },
        { op: 'ellipse', x1: ax, y1: ay, x2: bx, y2: by },
      ],
    });
  }
  return cases;
}

/** 500 random boxes with pen widths 2 to 8. */
function ellipsesWide(): EllipseCase[] {
  const r = rng(ELLIPSE_SEED + 2);
  const cases: EllipseCase[] = [];
  while (cases.length < 500) {
    const pen = r(2, 8);
    // One box in eight one or two pixels wide or high: the round ends of a degenerate ellipse.
    const thin = r(0, 7) === 0;
    const w = thin ? r(1, 2) : r(1, 100);
    const h = thin ? r(1, 100) : r(1, 100);
    const [bw, bh] = r(0, 1) === 1 ? [w, h] : [h, w];
    const filled = r(0, 1) === 1;
    const xor = r(0, 3) === 0;
    const m = pen + 2;
    cases.push({
      id: `ellipses-wide-${pad(cases.length)}`,
      suite: 'ellipses-wide',
      width: bw + 2 * m,
      height: bh + 2 * m,
      ops: [
        ...(xor ? ([{ op: 'bg', color: BACKGROUND }] as EllipseOp[]) : []),
        { op: 'pen', color: xor ? PEN : 0xffffff },
        { op: 'fill', color: xor ? FILL : 0x0000ff },
        { op: 'width', value: pen },
        ...(xor ? ([{ op: 'mode', value: 14 }] as EllipseOp[]) : []),
        { op: filled ? 'ellipse' : 'uellipse', x1: m, y1: m, x2: m + bw - 1, y2: m + bh - 1 },
      ],
    });
  }
  return cases;
}

/** Every case of 6.5.2, in suite order. Deterministic. */
export function generateEllipseCases(): EllipseCase[] {
  return [...ellipses(), ...ellipsesLarge(), ...ellipsesWide()];
}
