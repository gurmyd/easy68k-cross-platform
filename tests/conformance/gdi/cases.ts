// Case lists of the GDI pixel tests (ARCHITECTURE.md 6.5.1 and 6.5.3). Owner: T2.
//
// Every case is a fresh canvas (black, the start-up graphics state of trap15-b 3.2: pen white, fill
// black, width 1, mode 4, pen position (0,0), font Fixedsys 9 in white) and a list of operations.
// The operations are the drawing methods of the port's Surface (ARCHITECTURE.md 3.4) with the same
// arguments, so a case replays one to one on `Surface` (replay.ts) and on Windows GDI
// (tests/oracle/gdi-capture/capture.cpp, which makes the calls SIM68K.exe's VCL makes).
//
// The lists are generated with a fixed seed, so they are the same on every machine. The capture
// program reads them in the text form of `serializeCases`.
//
// This file must stay free of imports and of TypeScript syntax that is not erasable: run.mjs loads
// it with Node's built-in type stripping.

/** One drawing operation. Colours are the raw 32-bit values a 68000 program passes (trap15-b 4.6). */
export type GdiOp =
  | { op: 'bg'; color: number } // fill the whole canvas with $00BBGGRR directly (sets up a picture)
  | { op: 'pen'; color: number } // task 80, setLineColor
  | { op: 'fill'; color: number } // task 81, setFillColor
  | { op: 'width'; value: number } // task 93, setPenWidth
  | { op: 'mode'; value: number } // task 92 with 0-15 or 18-255, setDrawingMode
  | { op: 'pixel'; x: number; y: number } // task 82, drawPixel
  | { op: 'line'; x1: number; y1: number; x2: number; y2: number } // task 84
  | { op: 'lineto'; x: number; y: number } // task 85
  | { op: 'moveto'; x: number; y: number } // task 86
  | { op: 'rect'; x1: number; y1: number; x2: number; y2: number } // task 87, rectangle
  | { op: 'urect'; x1: number; y1: number; x2: number; y2: number } // task 90, unfilledRectangle
  | { op: 'ellipse'; x1: number; y1: number; x2: number; y2: number } // task 88
  | { op: 'uellipse'; x1: number; y1: number; x2: number; y2: number } // task 91, unfilledEllipse
  | { op: 'flood'; x: number; y: number } // task 89, floodFill
  | { op: 'font'; name: string; size: number; style: number } // task 21's font (style 0-4: plain, b, i, u, s)
  | { op: 'fontcolor'; color: number } // task 21's colour
  | { op: 'text'; x: number; y: number; bytes: readonly number[] }; // task 95, drawText (no NUL inside)

export interface GdiCase {
  /** Unique, `<suite>-<number>`; also the .pix file name. */
  readonly id: string;
  readonly suite: string;
  readonly width: number;
  readonly height: number;
  readonly ops: readonly GdiOp[];
}

/**
 * The suites. `machine: true` marks a suite whose pixels depend on the machine's settings (system
 * colours follow the Windows theme; outline glyph pixels follow font smoothing), so the CI
 * comparison skips it unless the settings recorded with it are the machine's own.
 */
export const SUITES: readonly { readonly name: string; readonly machine: boolean; readonly about: string }[] = [
  { name: 'lines', machine: false, about: '10,000 width-1 lines (6.5.1), trap15-b 6.1' },
  { name: 'polylines', machine: false, about: 'task 85 / 86 chains: pen position and end points, trap15-b 5.5, 6.1' },
  { name: 'widelines', machine: false, about: '2,000 lines of widths 2-14 (6.5.1), trap15-b 6.2' },
  {
    name: 'rects',
    machine: false,
    about: '10,000 rectangles, filled and unfilled, widths 0-12, cases A, B, C, trap15-b 6.3',
  },
  {
    name: 'pens',
    machine: false,
    about:
      'every pen width 2-255: the round dot of a one-point rectangle, line and ellipse; rectangles of widths 13-255 (bars and frames), trap15-b 6.2, 6.3 (request SH1-gdi-dots)',
  },
  { name: 'floods', machine: false, about: '1,000 flood fills on random pictures, trap15-b 6.6' },
  { name: 'modes', machine: false, about: 'the 16 raster operations on every primitive kind, trap15-b 5.4' },
  { name: 'modes-high', machine: false, about: 'drawing modes 18-255 (the exception table of trap15-b 5.4)' },
  {
    name: 'pixels',
    machine: false,
    about: 'task 82 inside and outside the surface, every mode, any width, trap15-b 6.5',
  },
  { name: 'colors', machine: false, about: 'the colour forms of trap15-b 4.6 that do not depend on the theme' },
  { name: 'colors-system', machine: true, about: 'system colours (bit 31) that follow the Windows theme' },
  { name: 'clip', machine: false, about: 'clipping: primitives across the edges and with extreme 16-bit coordinates' },
  {
    name: 'text',
    machine: false,
    about: 'task 95 text in the raster faces: cells, fill colour, pen movement, clipping, control bytes (6.5.3)',
  },
  {
    name: 'text-control',
    machine: true,
    about:
      'task 95 strings with the control bytes Windows draws from an anti-aliased fallback font, or with the undefined Windows-1252 bytes (trap15-b 6.7)',
  },
  {
    name: 'text-outline',
    machine: false,
    about: 'task 95 text in the outline faces drawn in the fill colour: cell rectangles and pen positions only (6.5.3)',
  },
  {
    name: 'text-outline-zero',
    machine: false,
    about:
      'as text-outline, for strings of zero-width bytes and $7F without a byte of $80 or above (gate I1 review round 2, defect 14)',
  },
  {
    name: 'text-outline-glyphs',
    machine: true,
    about: 'outline-face text with visible glyphs (font smoothing); for looking at, not for comparing',
  },
];

// ---------------------------------------------------------------------------------------------
// Deterministic random numbers (mulberry32)

export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of every list. Changing it changes every reference. */
export const SEED = 0x68000;

interface Rng {
  int(lo: number, hi: number): number; // inclusive
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

function rng(seed: number): Rng {
  const next = createRandom(seed);
  return {
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] as never,
    chance: (p) => next() < p,
  };
}

const W = 64;
const H = 48;
/** Colours used for pictures and pens: distinct in every channel. */
const PALETTE = [0xffffff, 0x0000ff, 0x00ff00, 0xff0000, 0x336699, 0x0f0ff0, 0xf0f00f, 0x808080, 0x00ffff, 0xc0c0c0];
const MODE_TABLE_LOW = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function pad(n: number): string {
  return String(n).padStart(5, '0');
}

/** A picture to draw on in a non-Copy mode: stripes and blocks in several colours. */
function stripes(): GdiOp[] {
  const ops: GdiOp[] = [{ op: 'bg', color: 0x336699 }];
  const colours = [0xffffff, 0x000000, 0x0000ff, 0x00ff00, 0xff0000, 0xf0f00f];
  for (let i = 0; i < 6; i++) {
    ops.push({ op: 'fill', color: colours[i] as number }, { op: 'pen', color: colours[i] as number });
    ops.push({ op: 'rect', x1: i * 11, y1: 0, x2: i * 11 + 5, y2: H - 1 });
  }
  ops.push({ op: 'pen', color: 0xffffff }, { op: 'fill', color: 0x000000 });
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Suites

function lines(): GdiCase[] {
  const r = rng(SEED + 1);
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `lines-${pad(cases.length)}`, suite: 'lines', width: W, height: H, ops });
  // Named shapes first: the example of trap15-b 6.1, exact slopes 1/2 and 2, axis lines, single points.
  add([{ op: 'line', x1: 0, y1: 0, x2: 8, y2: 4 }]);
  for (const [dx, dy] of [
    [2, 1],
    [-2, 1],
    [2, -1],
    [-2, -1],
    [1, 2],
    [-1, 2],
    [1, -2],
    [-1, -2],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [3, 1],
    [1, 3],
    [3, 2],
    [2, 3],
    [4, 1],
    [1, 4],
    [5, 2],
    [2, 5],
  ] as const) {
    for (const k of [1, 2, 3, 5, 8, 13]) add([{ op: 'line', x1: 30, y1: 22, x2: 30 + dx * k, y2: 22 + dy * k }]);
  }
  for (let i = 0; i < 40; i++) {
    const x = r.int(-4, W + 3);
    const y = r.int(-4, H + 3);
    add([{ op: 'line', x1: x, y1: y, x2: x, y2: y }]);
    add([{ op: 'line', x1: x, y1: y, x2: r.int(-8, W + 8), y2: y }]);
    add([{ op: 'line', x1: x, y1: y, x2: x, y2: r.int(-8, H + 8) }]);
  }
  while (cases.length < 10_000) {
    const ops: GdiOp[] = [];
    if (r.chance(0.3)) ops.push({ op: 'pen', color: r.pick(PALETTE) });
    const span = r.chance(0.7) ? 16 : 200;
    ops.push({
      op: 'line',
      x1: r.int(-span, W + span),
      y1: r.int(-span, H + span),
      x2: r.int(-span, W + span),
      y2: r.int(-span, H + span),
    });
    add(ops);
  }
  return cases;
}

function polylines(): GdiCase[] {
  const r = rng(SEED + 2);
  const cases: GdiCase[] = [];
  for (let i = 0; i < 300; i++) {
    const ops: GdiOp[] = [];
    if (r.chance(0.5)) ops.push({ op: 'moveto', x: r.int(-8, W + 8), y: r.int(-8, H + 8) });
    if (r.chance(0.3)) ops.push({ op: 'width', value: r.int(0, 6) });
    if (r.chance(0.3)) ops.push({ op: 'mode', value: r.pick([4, 14, 3, 10]) });
    const n = r.int(1, 6);
    for (let k = 0; k < n; k++) {
      const choice = r.int(0, 9);
      if (choice < 6) ops.push({ op: 'lineto', x: r.int(-8, W + 8), y: r.int(-8, H + 8) });
      else if (choice < 8) ops.push({ op: 'moveto', x: r.int(-8, W + 8), y: r.int(-8, H + 8) });
      else if (choice < 9)
        ops.push({
          op: 'line',
          x1: r.int(-8, W + 8),
          y1: r.int(-8, H + 8),
          x2: r.int(-8, W + 8),
          y2: r.int(-8, H + 8),
        });
      else ops.push({ op: 'rect', x1: r.int(0, W), y1: r.int(0, H), x2: r.int(0, W), y2: r.int(0, H) }); // does not move the pen
    }
    cases.push({ id: `polylines-${pad(i)}`, suite: 'polylines', width: W, height: H, ops });
  }
  return cases;
}

function widelines(): GdiCase[] {
  const r = rng(SEED + 3);
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `widelines-${pad(cases.length)}`, suite: 'widelines', width: W, height: H, ops });
  // The measured strokes and dots of trap15-b 6.2, one case per width.
  for (let w = 2; w <= 14; w++) {
    add([
      { op: 'width', value: w },
      { op: 'line', x1: 20, y1: 20, x2: 30, y2: 20 },
    ]);
    add([
      { op: 'width', value: w },
      { op: 'line', x1: 20, y1: 10, x2: 20, y2: 30 },
    ]);
    add([
      { op: 'width', value: w },
      { op: 'line', x1: 30, y1: 24, x2: 30, y2: 24 },
    ]);
    add([
      { op: 'width', value: w },
      { op: 'mode', value: 14 },
      { op: 'bg', color: 0x336699 },
      { op: 'line', x1: 10, y1: 24, x2: 40, y2: 30 },
    ]);
  }
  while (cases.length < 2_000) {
    const ops: GdiOp[] = [{ op: 'width', value: r.int(2, 14) }];
    if (r.chance(0.2)) ops.push({ op: 'pen', color: r.pick(PALETTE) });
    if (r.chance(0.15)) ops.push({ op: 'bg', color: 0x336699 }, { op: 'mode', value: r.pick([14, 3, 15, 10, 12]) });
    const x1 = r.int(-12, W + 12);
    const y1 = r.int(-12, H + 12);
    const kind = r.int(0, 9);
    if (kind === 0) ops.push({ op: 'line', x1, y1, x2: x1, y2: y1 });
    else if (kind <= 2) ops.push({ op: 'line', x1, y1, x2: r.int(-12, W + 12), y2: y1 });
    else if (kind <= 4) ops.push({ op: 'line', x1, y1, x2: x1, y2: r.int(-12, H + 12) });
    else ops.push({ op: 'line', x1, y1, x2: r.int(-12, W + 12), y2: r.int(-12, H + 12) });
    add(ops);
  }
  return cases;
}

function rects(): GdiCase[] {
  const r = rng(SEED + 4);
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `rects-${pad(cases.length)}`, suite: 'rects', width: W, height: H, ops });
  // The examples of trap15-b 6.3.
  const examples: [number, number, number, number][] = [
    [2, 2, 8, 6],
    [12, 2, 12, 6],
    [16, 2, 20, 2],
    [24, 2, 24, 2],
    [28, 2, 29, 3],
    [33, 2, 35, 4],
  ];
  for (const filled of [true, false]) {
    for (let w = 0; w <= 12; w++) {
      const ops: GdiOp[] = [
        { op: 'width', value: w },
        { op: 'fill', color: 0x0000ff },
      ];
      for (const [x1, y1, x2, y2] of examples)
        ops.push({ op: filled ? 'rect' : 'urect', x1, y1: y1 + 10, x2, y2: y2 + 10 });
      add(ops);
    }
  }
  while (cases.length < 10_000) {
    const ops: GdiOp[] = [
      { op: 'width', value: r.int(0, 12) },
      { op: 'fill', color: r.pick(PALETTE) },
    ];
    if (r.chance(0.3)) ops.push({ op: 'pen', color: r.pick(PALETTE) });
    if (r.chance(0.1)) ops.push({ op: 'bg', color: 0x336699 }, { op: 'mode', value: r.pick([14, 3, 6, 9, 15]) });
    const x1 = r.int(-10, W + 10);
    const y1 = r.int(-10, H + 10);
    const kind = r.int(0, 19); // A 70 %, B 20 %, C 10 %
    let x2 = r.int(-10, W + 10);
    let y2 = r.int(-10, H + 10);
    if (kind >= 14 && kind < 16) x2 = x1;
    else if (kind >= 16 && kind < 18) y2 = y1;
    else if (kind >= 18) {
      x2 = x1;
      y2 = y1;
    }
    ops.push({ op: r.chance(0.5) ? 'rect' : 'urect', x1, y1, x2, y2 });
    add(ops);
  }
  return cases;
}

/**
 * Pen widths beyond the rects and widelines suites (docs/requests/SH1-gdi-dots.md): for every width
 * 2-255 the dot of a one-point rectangle, a zero-length line and a one-point ellipse (the line and
 * the ellipse are SH2's parts, the rectangle SH1's); for every width 13-255 a horizontal and a
 * vertical bar (case B) and a frame filled and unfilled (case A); the vertical bar of width 206 at
 * two lengths.
 */
function pens(): GdiCase[] {
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `pens-${pad(cases.length)}`, suite: 'pens', width: 300, height: 300, ops });
  for (let w = 2; w <= 255; w++) {
    for (const op of ['rect', 'line', 'ellipse'] as const) {
      add([
        { op: 'width', value: w },
        { op: 'fill', color: 0x0000ff },
        { op, x1: 150, y1: 150, x2: 150, y2: 150 },
      ]);
    }
  }
  for (let w = 13; w <= 255; w++) {
    const base: GdiOp[] = [
      { op: 'width', value: w },
      { op: 'fill', color: 0x0000ff },
    ];
    add([...base, { op: 'rect', x1: 60, y1: 150, x2: 240, y2: 150 }]);
    add([...base, { op: 'rect', x1: 150, y1: 60, x2: 150, y2: 240 }]);
    add([...base, { op: 'rect', x1: 70, y1: 80, x2: 230, y2: 220 }]);
    add([...base, { op: 'urect', x1: 70, y1: 80, x2: 230, y2: 220 }]);
  }
  for (const [y1, y2] of [
    [40, 260],
    [100, 110],
  ])
    add([
      { op: 'width', value: 206 },
      { op: 'fill', color: 0x0000ff },
      { op: 'rect', x1: 150, y1: y1 as number, x2: 150, y2: y2 as number },
    ]);
  return cases;
}

/** A random picture of rectangles, lines and pixels in a few colours (for flood fills). */
function randomPicture(r: Rng): GdiOp[] {
  const colours = [0x000000, 0xffffff, 0x0000ff, 0x00ff00];
  const ops: GdiOp[] = [{ op: 'bg', color: r.pick(colours) }];
  const n = r.int(3, 14);
  for (let k = 0; k < n; k++) {
    const c = r.pick(colours);
    ops.push({ op: 'pen', color: c }, { op: 'fill', color: r.pick(colours) });
    // No ellipses: the flood fills are SH1's, the ellipses SH2's (6.5.1, 6.5.2).
    const kind = r.int(0, 3);
    const x1 = r.int(-4, W + 4);
    const y1 = r.int(-4, H + 4);
    const x2 = r.int(-4, W + 4);
    const y2 = r.int(-4, H + 4);
    if (kind === 0) ops.push({ op: 'rect', x1, y1, x2, y2 });
    else if (kind === 1) ops.push({ op: 'urect', x1, y1, x2, y2 });
    else if (kind === 2) ops.push({ op: 'line', x1, y1, x2, y2 });
    else for (let p = 0; p < 6; p++) ops.push({ op: 'pixel', x: r.int(0, W - 1), y: r.int(0, H - 1) });
  }
  return ops;
}

function floods(): GdiCase[] {
  const r = rng(SEED + 5);
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `floods-${pad(cases.length)}`, suite: 'floods', width: W, height: H, ops });
  // A one-pixel diagonal is a boundary (4-connected); start pixel already in the fill colour.
  add([
    { op: 'line', x1: 0, y1: 0, x2: 47, y2: 47 },
    { op: 'fill', color: 0x0000ff },
    { op: 'flood', x: 40, y: 2 },
  ]);
  add([
    { op: 'bg', color: 0x0000ff },
    { op: 'fill', color: 0x0000ff },
    { op: 'flood', x: 5, y: 5 },
  ]);
  add([
    { op: 'bg', color: 0x0000ff },
    { op: 'fill', color: 0x0000ff },
    { op: 'mode', value: 14 },
    { op: 'flood', x: 5, y: 5 },
  ]);
  add([
    { op: 'fill', color: 0x00ff00 },
    { op: 'flood', x: -1, y: 5 },
  ]);
  add([
    { op: 'fill', color: 0x00ff00 },
    { op: 'flood', x: W, y: 5 },
  ]);
  while (cases.length < 1_000) {
    const ops = randomPicture(r);
    ops.push({ op: 'fill', color: r.pick([0xff0000, 0x00ffff, 0x0000ff, 0xffffff, 0x000000]) });
    if (r.chance(0.15)) ops.push({ op: 'mode', value: r.pick([14, 3, 10, 12, 0, 1, 2]) });
    const n = r.chance(0.2) ? 2 : 1;
    for (let k = 0; k < n; k++) ops.push({ op: 'flood', x: r.int(-2, W + 1), y: r.int(-2, H + 1) });
    add(ops);
  }
  return cases;
}

type Kind = (r: Rng) => GdiOp[];
const KINDS: Record<string, Kind> = {
  pixel: () => [
    { op: 'pixel', x: 3, y: 3 },
    { op: 'pixel', x: 14, y: 20 },
    { op: 'pixel', x: 14, y: 20 },
  ],
  line: () => [
    { op: 'line', x1: 2, y1: 40, x2: 60, y2: 5 },
    { op: 'line', x1: 0, y1: 10, x2: 63, y2: 10 },
  ],
  lineTo: () => [
    { op: 'moveto', x: 5, y: 5 },
    { op: 'lineto', x: 50, y: 20 },
    { op: 'lineto', x: 10, y: 40 },
  ],
  wideLine: () => [
    { op: 'width', value: 5 },
    { op: 'line', x1: 4, y1: 30, x2: 58, y2: 12 },
    { op: 'width', value: 4 },
    { op: 'line', x1: 30, y1: 4, x2: 30, y2: 4 },
  ],
  rect: () => [{ op: 'rect', x1: 5, y1: 6, x2: 50, y2: 40 }],
  urect: () => [
    { op: 'urect', x1: 5, y1: 6, x2: 50, y2: 40 },
    { op: 'urect', x1: 20, y1: 20, x2: 20, y2: 30 },
  ],
  wideRect: () => [
    { op: 'width', value: 6 },
    { op: 'rect', x1: 8, y1: 8, x2: 52, y2: 38 },
  ],
  ellipse: () => [{ op: 'ellipse', x1: 4, y1: 4, x2: 58, y2: 42 }],
  uellipse: () => [{ op: 'uellipse', x1: 10, y1: 6, x2: 40, y2: 36 }],
  flood: () => [
    { op: 'flood', x: 2, y: 2 },
    { op: 'flood', x: 13, y: 20 },
  ],
};

function modes(): GdiCase[] {
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `modes-${pad(cases.length)}`, suite: 'modes', width: W, height: H, ops });
  const colourSets: [number, number][] = [
    [0x0f0ff0, 0xf0f00f],
    [0xffffff, 0x0000ff],
    [0x000000, 0x808080],
  ];
  for (const [pen, fill] of colourSets) {
    for (const mode of MODE_TABLE_LOW) {
      for (const kind of Object.keys(KINDS)) {
        const make = KINDS[kind] as Kind;
        add([
          ...stripes(),
          { op: 'pen', color: pen },
          { op: 'fill', color: fill },
          { op: 'mode', value: mode },
          ...make(rng(0)),
        ]);
      }
    }
  }
  return cases;
}

function modesHigh(): GdiCase[] {
  const cases: GdiCase[] = [];
  for (let mode = 18; mode <= 255; mode++) {
    cases.push({
      id: `modes-high-${pad(mode)}`,
      suite: 'modes-high',
      width: W,
      height: H,
      ops: [
        ...stripes(),
        { op: 'pen', color: 0x0f0ff0 },
        { op: 'fill', color: 0xf0f00f },
        { op: 'mode', value: mode },
        { op: 'line', x1: 2, y1: 40, x2: 60, y2: 5 },
        { op: 'pixel', x: 3, y: 3 },
        { op: 'rect', x1: 30, y1: 20, x2: 50, y2: 44 },
      ],
    });
  }
  return cases;
}

function pixels(): GdiCase[] {
  const r = rng(SEED + 6);
  const cases: GdiCase[] = [];
  while (cases.length < 500) {
    const ops: GdiOp[] = [];
    if (r.chance(0.5)) ops.push({ op: 'bg', color: 0x336699 });
    ops.push({ op: 'pen', color: r.pick(PALETTE) }, { op: 'width', value: r.int(0, 20) });
    if (r.chance(0.5)) ops.push({ op: 'mode', value: r.pick(MODE_TABLE_LOW) });
    const n = r.int(1, 12);
    for (let k = 0; k < n; k++) ops.push({ op: 'pixel', x: r.int(-3, W + 2), y: r.int(-3, H + 2) });
    if (r.chance(0.2)) ops.push({ op: 'pixel', x: r.pick([-32768, 32767, -1, W]), y: r.pick([-32768, 32767, 0, H]) });
    cases.push({ id: `pixels-${pad(cases.length)}`, suite: 'pixels', width: W, height: H, ops });
  }
  return cases;
}

/** Pen and fill colours of trap15-b 4.6 that do not depend on the Windows theme. */
export const COLOUR_FORMS: readonly number[] = [
  0x00336699,
  0x00ffffff,
  0x00000000,
  ...Array.from({ length: 24 }, (_, i) => 0x01000000 + i), // stock palette 0-19, then black
  0x01010005,
  0x0100ff05,
  0x01ff0013,
  0x0300000c,
  0x7f000007,
  0x7fffff10,
  0x02336699,
  0x04336699,
  0x0a336699,
  0x10336699,
  0x20336699,
  0x40336699,
  0x7e336699,
  0x02000005,
  0x80000005,
  0x80000008,
  0x8000000f,
  0xff000005,
  0x800000ff,
  0x8000001f,
  0x80000020,
  0xc0000080,
];

/** System colours whose value follows the theme (bit 31 with an index other than 5, 8, 15 and above 30). */
export const SYSTEM_COLOUR_FORMS: readonly number[] = Array.from({ length: 31 }, (_, i) => 0x80000000 + i).filter(
  (c) => ![5, 8, 15].includes(c & 0xff),
);

function colourCases(suite: string, forms: readonly number[]): GdiCase[] {
  return forms.map((c, i) => ({
    id: `${suite}-${pad(i)}`,
    suite,
    width: 16,
    height: 8,
    ops: [
      { op: 'bg', color: 0x123456 },
      { op: 'pen', color: c },
      { op: 'fill', color: c },
      { op: 'pixel', x: 0, y: 0 },
      { op: 'line', x1: 2, y1: 0, x2: 6, y2: 0 },
      { op: 'rect', x1: 8, y1: 0, x2: 12, y2: 4 },
      { op: 'fill', color: 0x00ff0000 },
      { op: 'pen', color: 0x00ff0000 },
      { op: 'rect', x1: 0, y1: 5, x2: 3, y2: 7 },
      { op: 'fill', color: c },
      { op: 'flood', x: 1, y: 6 },
    ],
  }));
}

function clip(): GdiCase[] {
  const r = rng(SEED + 7);
  const cases: GdiCase[] = [];
  const add = (ops: GdiOp[]) =>
    cases.push({ id: `clip-${pad(cases.length)}`, suite: 'clip', width: W, height: H, ops });
  const extremes = [-32768, -32767, -16384, -1000, -1, 0, W - 1, W, H - 1, H, 1000, 16383, 32766, 32767];
  for (const shape of ['line', 'rect', 'urect', 'ellipse', 'uellipse'] as const) {
    for (let i = 0; i < 60; i++) {
      const ops: GdiOp[] = [{ op: 'fill', color: 0x0000ff }];
      if (r.chance(0.3)) ops.push({ op: 'width', value: r.int(2, 9) });
      const coord = () => (r.chance(0.5) ? r.pick(extremes) : r.int(-40, 100));
      ops.push({ op: shape, x1: coord(), y1: coord(), x2: coord(), y2: coord() });
      add(ops);
    }
  }
  // Ellipses at the 32768 sum limit of simIOu.cpp: just below and at it.
  add([{ op: 'ellipse', x1: 10, y1: 10, x2: 16373, y2: 16374 }]);
  add([{ op: 'ellipse', x1: 10, y1: 10, x2: 16373, y2: 16375 }]);
  add([{ op: 'ellipse', x1: -20000, y1: 5, x2: 40, y2: 30 }]);
  for (let i = 0; i < 40; i++)
    add([
      { op: 'moveto', x: r.pick(extremes), y: r.pick(extremes) },
      { op: 'lineto', x: r.int(0, W), y: r.int(0, H) },
    ]);
  return cases;
}

// ---------------------------------------------------------------------------------------------
// Text (task 95). Bytes are Windows-1252; NUL never occurs inside a string (it ends it).

const ASCII = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** Raster requests: name, sizes (points) that reach every native cell and some scaled ones. */
const RASTER_FONTS: readonly [string, readonly number[]][] = [
  ['Fixedsys', [9, 0, 18, 30, 72]],
  ['Courier', [10, 12, 15, 19, 20, 36, 0]],
];
const OUTLINE_FONTS = ['Courier New', 'Lucida Console', 'Consolas', 'Lucida Sans Typerwriter', 'Terminal'];
const OUTLINE_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36, 0, 1, 5, 100, 255];

/**
 * Bytes that Windows 11 draws, in the raster faces, from an anti-aliased fallback font: a narrow box,
 * or for $02 nothing but 5 pixels of width (trap15-b 6.7; the capture's atlases.tsv lists the boxes
 * as blank bytes). Inside a string their width is the fallback font's, not their single-byte
 * extent. A case containing one goes to the machine-dependent suite text-control.
 */
export const FALLBACK_BYTES: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
];
/**
 * The five bytes Windows-1252 leaves undefined. Alone each has extent 0, but inside a string GDI
 * sometimes takes a pixel off the extent ($80 $81 measures 7 in Fixedsys); cases with them go to
 * text-control as well (docs/porting/errata/T2.md).
 */
export const UNDEFINED_BYTES: readonly number[] = [0x81, 0x8d, 0x8f, 0x90, 0x9d];
/** Bytes that take neither pixels nor room inside a GDI string of two or more bytes (trap15-b 6.7). */
export const ZERO_WIDTH_BYTES: readonly number[] = [9, 10, 13, 28, 29, 30, 31];
/** Bytes that make GDI leave out the italic overhang when mixed with others (text-model.ts). */
export const ITALIC_SPECIAL_BYTES: readonly number[] = [0x7f];
/**
 * Italic strings with one of these bytes keep or lose the overhang depending on the classes of the
 * bytes around them (Windows' script itemization: "A",$86 loses it, "[",$86 keeps it, at Fixedsys 12
 * "%",$86 keeps it); not modelled.
 */
export const ITALIC_ITEMIZED_BYTES: readonly number[] = [0x86, 0x87, 0x88, 0x98];
/**
 * Windows takes a different path through its text code for a string that contains one of these
 * bytes, or a zero-width byte together with a byte of $80 or above (that is also when the zero-width
 * bytes stop counting in TextWidth). On that path, and in some strings with a zero-width byte only,
 * the FALLBACK_PRONE_BYTES may be drawn from a fallback font, with another glyph and another,
 * size-dependent width ($80 in Fixedsys 9 takes 7 pixels, in Courier 10 5, in Fixedsys 72 58; "@" in
 * Courier 19 4 more than its cell).
 */
export const SECOND_PATH_BYTES: readonly number[] = [0x7f, 0x86, 0x87, 0x88, 0x98];
export const FALLBACK_PRONE_BYTES: readonly number[] = [0x0c, 0x40, 0x80];
/**
 * Requested sizes (points) at which a string made only of zero-width bytes, in plain, bold or
 * italic, may be drawn by Windows 11 as a thin fallback-font bar instead of a filled cell. Measured
 * at every size at which the face is a raster face (Fixedsys 0-121, Courier 0-199; above that
 * Windows substitutes Arial) with each of $09 $0A $0D $1C $1F alone: the bar sizes are the same for
 * every byte and style. Some strings of two or more zero-width bytes fill the cell at these sizes
 * ($0D $0A, $09 $09), others do not ($1E $0D $1F in Courier 12); all of them go to text-control
 * here. The suite `text` holds the single byte $0D at every raster size (barSweep below), so a size
 * missing here fails golden.test.ts.
 */
export const ZERO_WIDTH_BAR_SIZES: Readonly<Record<string, readonly number[]>> = {
  Fixedsys: [
    19, 20, 23, 24, 26, 28, 29, 35, 36, 38, 39, 42, 43, 46, 49, 52, 53, 54, 71, 74, 78, 82, 83, 87, 92, 96, 100, 101,
    104,
  ],
  Courier: [
    3, 4, 6, 8, 11, 12, 13, 16, 17, 24, 27, 28, 46, 54, 56, 59, 60, 61, 62, 63, 64, 65, 66, 67, 71, 74, 75, 76, 77, 78,
    79, 82, 83, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 127, 133, 134, 135, 136, 138, 143, 144, 145,
  ],
};
/** The sizes at which Windows draws the two raster faces from their raster font (metrics.json). */
export const RASTER_SIZE_LIMIT: Readonly<Record<string, number>> = { Fixedsys: 121, Courier: 199 };

/**
 * Why text-model.ts cannot reproduce a raster-face task 95 string, or null when it can. Cases for
 * which this is not null go to the suite text-control, which is compared only with GDI itself.
 */
export function textUnmodelled(name: string, size: number, style: number, bytes: readonly number[]): string | null {
  if (bytes.some((b) => FALLBACK_BYTES.includes(b))) return 'a byte drawn from the fallback font';
  if (bytes.some((b) => UNDEFINED_BYTES.includes(b))) return 'a byte Windows-1252 leaves undefined';
  const secondPath =
    bytes.some((b) => SECOND_PATH_BYTES.includes(b)) ||
    (bytes.some((b) => ZERO_WIDTH_BYTES.includes(b)) && bytes.some((b) => b >= 0x80));
  // A zero-width byte alone is enough for "@" in Courier 8 underlined ("t'M~:@",$0A,"A").
  const anyZeroWidth = bytes.length >= 2 && bytes.some((b) => ZERO_WIDTH_BYTES.includes(b));
  if ((secondPath || anyZeroWidth) && bytes.some((b) => FALLBACK_PRONE_BYTES.includes(b)))
    return '$0C, "@" or $80 that Windows may draw from a fallback font';
  if (style === 2 && bytes.length >= 2 && bytes.some((b) => ITALIC_ITEMIZED_BYTES.includes(b)))
    return 'italic overhang decided by script itemization';
  if (
    bytes.length > 0 &&
    bytes.every((b) => ZERO_WIDTH_BYTES.includes(b)) &&
    style <= 2 &&
    (ZERO_WIDTH_BAR_SIZES[name] ?? []).includes(size)
  )
    return 'zero-width bytes only, drawn as a fallback bar at this size';
  return null;
}

function text(): GdiCase[] {
  const r = rng(SEED + 8);
  const cases: GdiCase[] = [];
  const counters: Record<string, number> = { text: 0, 'text-control': 0 };
  const add = (width: number, height: number, ops: GdiOp[]) => {
    let font = { name: 'Fixedsys', size: 9, style: 0 };
    const control = ops.some((o) => {
      if (o.op === 'font') font = o;
      return o.op === 'text' && textUnmodelled(font.name, font.size, font.style, o.bytes) !== null;
    });
    const suite = control ? 'text-control' : 'text';
    const n = counters[suite] as number;
    counters[suite] = n + 1;
    cases.push({ id: `${suite}-${pad(n)}`, suite, width, height, ops });
  };
  // V1 and V2 of trap15-b 15, the 6.7 measurement, an empty string.
  add(64, 32, [
    { op: 'fill', color: 0x0000ff },
    { op: 'text', x: 10, y: 10, bytes: ASCII('A') },
  ]);
  add(96, 80, [
    { op: 'moveto', x: 0, y: 0 },
    { op: 'text', x: 50, y: 60, bytes: ASCII('AB') },
  ]);
  add(64, 32, [
    { op: 'fill', color: 0x00ff00 },
    { op: 'text', x: 10, y: 10, bytes: ASCII('AB') },
  ]);
  add(64, 32, [
    { op: 'moveto', x: 3, y: 3 },
    { op: 'text', x: 20, y: 7, bytes: [] },
  ]);
  // Every byte $01-$FF once, in each raster face and style, in rows of 32.
  for (const [name, sizes] of RASTER_FONTS) {
    for (const size of sizes.slice(0, 3)) {
      for (let style = 0; style < 5; style++) {
        for (let row = 0; row < 8; row++) {
          const bytes = Array.from({ length: 32 }, (_, i) => row * 32 + i).filter((b) => b !== 0);
          add(640, 64, [
            { op: 'font', name, size, style },
            { op: 'fill', color: 0x402010 },
            { op: 'fontcolor', color: 0x00ffff },
            { op: 'text', x: 2, y: 2, bytes },
          ]);
        }
      }
    }
  }
  // Control bytes between letters (trap15-b 6.7): 'A', b, 'B' and a string of control bytes only.
  for (let b = 1; b < 32; b++) {
    add(64, 24, [
      { op: 'fill', color: 0x0000ff },
      { op: 'text', x: 1, y: 2, bytes: [65, b, 66] },
    ]);
  }
  add(64, 24, [
    { op: 'fill', color: 0x0000ff },
    { op: 'text', x: 1, y: 2, bytes: [9, 13, 10] },
  ]);
  add(96, 24, [
    { op: 'fill', color: 0x0000ff },
    { op: 'text', x: 1, y: 2, bytes: [65, 9, 66, 13, 10, 67] },
  ]);
  // Random strings, sizes, styles, positions (some clipped or negative), colours.
  while (cases.length < 700) {
    const [name, sizes] = r.pick(RASTER_FONTS);
    const size = r.pick(sizes);
    const style = r.int(0, 4);
    const n = r.int(1, 12);
    const bytes = Array.from({ length: n }, () => (r.chance(0.85) ? r.int(32, 126) : r.int(1, 255)));
    const ops: GdiOp[] = [{ op: 'font', name, size, style }];
    if (r.chance(0.7)) ops.push({ op: 'fill', color: r.pick(PALETTE) });
    if (r.chance(0.7)) ops.push({ op: 'fontcolor', color: r.pick(PALETTE) });
    if (r.chance(0.3)) ops.push({ op: 'bg', color: 0x336699 }, { op: 'mode', value: 14 }, { op: 'width', value: 5 }); // text ignores both
    ops.push({ op: 'text', x: r.int(-40, 150), y: r.int(-40, 70), bytes });
    if (r.chance(0.3)) ops.push({ op: 'text', x: r.int(-10, 150), y: r.int(-10, 70), bytes: ASCII('Xp') });
    add(160, 80, ops);
  }
  // Zero-width bytes with and without a byte of $80 or above, in every style and at several sizes:
  // TextWidth counts the zero-width bytes only when the string has no such byte (verifier round 1:
  // the earlier rule had underline as the condition). Also the italic overhang cases, strings of
  // zero-width bytes only, and the strings the verifier found.
  const STRINGS: readonly (readonly number[])[] = [
    [65, 13, 66], // ASCII + zero-width
    [65, 66, 13, 10],
    [28, 65, 31, 66],
    [9, 72, 105],
    [28, 57],
    [13, 46],
    [65, 13, 0xe9], // + a byte >= $80
    [0xc4, 9, 66],
    [28, 0xe9, 31],
    [65, 10, 0xfc, 66, 13, 10],
    [28, 170, 29, 29],
    [28, 225, 109],
    [13], // zero-width only
    [13, 10],
    [10],
    [13, 13, 30, 31],
    [65, 0x7f], // italic overhang with $7F
    [0x7f, 0x7f],
    [65, 0x7f, 66],
    [65, 0x86], // $86: not modelled in italic, goes to text-control there
    [0xe9, 0xc4, 0xfc],
  ];
  const SIZES: readonly [string, readonly number[]][] = [
    ['Fixedsys', [9, 18, 24, 30, 72]],
    ['Courier', [10, 15, 8, 36]],
  ];
  for (const [name, sizes] of SIZES) {
    for (const size of sizes) {
      for (let style = 0; style < 5; style++) {
        STRINGS.forEach((bytes, i) => {
          add(400, 120, [
            { op: 'font', name, size, style },
            { op: 'fill', color: PALETTE[i % PALETTE.length] as number },
            { op: 'fontcolor', color: 0x00ffff },
            { op: 'text', x: 3, y: 4, bytes },
          ]);
        });
      }
    }
  }
  // Lone $09 at the sizes where Windows draws a bar, bold strings of zero-width bytes only, italic
  // with undefined bytes (verifier round 1, minor defect 4; these land in text-control).
  for (const size of [20, 24, 36])
    add(160, 80, [
      { op: 'font', name: 'Fixedsys', size, style: 0 },
      { op: 'text', x: 3, y: 4, bytes: [9] },
    ]);
  add(160, 80, [
    { op: 'font', name: 'Fixedsys', size: 24, style: 0 },
    { op: 'text', x: 3, y: 4, bytes: [13, 13, 31] },
  ]);
  add(160, 80, [
    { op: 'font', name: 'Fixedsys', size: 9, style: 1 },
    { op: 'text', x: 3, y: 4, bytes: [10] },
  ]);
  add(160, 80, [
    { op: 'font', name: 'Fixedsys', size: 9, style: 1 },
    { op: 'text', x: 3, y: 4, bytes: [13, 13, 30, 31] },
  ]);
  add(160, 80, [
    { op: 'font', name: 'Fixedsys', size: 9, style: 2 },
    { op: 'text', x: 3, y: 4, bytes: [65, 0x90, 0x9d, 66] },
  ]);
  // More random strings rich in zero-width and high bytes.
  const r2 = rng(SEED + 9);
  for (let i = 0; i < 400; i++) {
    const [name, sizes] = r2.pick(RASTER_FONTS);
    const pool = r2.chance(0.5) ? [9, 10, 13, 28, 29, 30, 31] : [9, 13, 0x7f, 0xa0, 0xc4, 0xe9, 0xfc, 0xff, 0x85];
    const bytes = Array.from({ length: r2.int(1, 8) }, () => (r2.chance(0.5) ? r2.int(32, 126) : r2.pick(pool)));
    add(240, 120, [
      { op: 'font', name, size: r2.pick(sizes), style: r2.int(0, 4) },
      { op: 'fill', color: r2.pick(PALETTE) },
      { op: 'fontcolor', color: r2.pick(PALETTE) },
      { op: 'text', x: r2.int(-10, 60), y: r2.int(-10, 30), bytes },
    ]);
  }
  // barSweep: a lone $0D at every size at which the face is raster (review round 2: the bar sizes
  // above 72 pt had not been measured). The bar sizes land in text-control, every other size in
  // text, where the model must fill exactly one cell.
  for (const [name, limit] of Object.entries(RASTER_SIZE_LIMIT)) {
    for (let size = 0; size <= limit; size++) {
      add(40 + size, 24 + size + (size >> 2), [
        { op: 'font', name, size, style: 0 },
        { op: 'fill', color: 0x0000ff },
        { op: 'text', x: 3, y: 2, bytes: [13] },
      ]);
    }
  }
  // The font colour of task 21 in the colour forms of 4.6 (request SH3-gdi-text-colour.md): one
  // case each, Fixedsys 9, fill $800000, "AB" at (2, 2).
  for (const color of TEXT_COLOUR_FORMS) {
    add(24, 20, [
      { op: 'fill', color: 0x800000 },
      { op: 'fontcolor', color },
      { op: 'text', x: 2, y: 2, bytes: ASCII('AB') },
    ]);
  }
  return cases;
}

/** Font colours with a non-zero top byte (request SH3-gdi-text-colour.md); theme-independent. */
export const TEXT_COLOUR_FORMS: readonly number[] = [
  0x01000005, 0x0100000d, 0x01000014, 0x0100ff05, 0x7f000007, 0x02336699, 0x80000005, 0x80000008, 0x8000000f,
  0xff336699,
];

/**
 * Outline-face strings of zero-width bytes and $7F without a byte of $80 or above (review round 2 of
 * gate I1, defect 14: Consolas' $0D has advance 0, a zero-width byte takes no room in the cell even
 * alone, and $7F always fills the fallback glyph's width; text-model.ts outlineCellAdvance).
 */
export const OUTLINE_ZERO_WIDTH_STRINGS: readonly (readonly number[])[] = [
  [13],
  [9],
  [13, 10],
  [13, 29, 13, 13, 13, 9],
  [29, 9, 13, 9, 9],
  [65, 13, 66],
  [0x7f],
  [0x7f, 0x7f],
  [65, 0x7f, 66],
  [13, 0x7f, 28],
  [0x7f, 32],
];

function textOutline(glyphs: boolean): GdiCase[] {
  const suite = glyphs ? 'text-outline-glyphs' : 'text-outline';
  const cases: GdiCase[] = [];
  const add = (width: number, height: number, ops: GdiOp[]) =>
    cases.push({ id: `${suite}-${pad(cases.length)}`, suite, width, height, ops });
  for (const name of OUTLINE_FONTS) {
    for (const size of glyphs ? [9, 12, 24] : OUTLINE_SIZES) {
      // Italic overhangs its cell with smoothed pixels, so the cell suite leaves it out.
      for (const style of glyphs ? [0, 1, 2, 3, 4] : [0, 1, 3, 4]) {
        const bytes = ASCII(name === 'Lucida Sans Typerwriter' || name === 'Terminal' ? 'Wil Xp.' : 'Wi Xp_');
        const width = size >= 100 ? 640 : 320;
        const height = size >= 100 ? 400 : 120;
        add(width, height, [
          { op: 'bg', color: 0x336699 },
          { op: 'font', name, size, style },
          { op: 'fill', color: 0x0000ff },
          { op: 'fontcolor', color: glyphs ? 0xffffff : 0x0000ff },
          { op: 'text', x: 3, y: 4, bytes },
          { op: 'text', x: -5, y: Math.floor(height / 2), bytes: [0x80, 0xe9, 0x41] },
        ]);
      }
    }
  }
  if (!glyphs) {
    // $7F in a string with a byte of $80 or above takes the width of a fallback glyph, not its
    // advance (review round 2; text-model.ts textExtent). At sizes that have an outline atlas.
    for (const name of ['Courier New', 'Lucida Console', 'Consolas']) {
      for (const size of [9, 12, 24]) {
        for (const style of [0, 1]) {
          add(320, 120, [
            { op: 'bg', color: 0x336699 },
            { op: 'font', name, size, style },
            { op: 'fill', color: 0x0000ff },
            { op: 'fontcolor', color: 0x0000ff },
            { op: 'text', x: 3, y: 4, bytes: [0xe9, 0x7f] },
            { op: 'text', x: 3, y: 60, bytes: [0x7f, 0x7f, 0x80, 0x41, 0x7f] },
          ]);
        }
      }
    }
  }
  return cases;
}

/**
 * The suite text-outline-zero: OUTLINE_ZERO_WIDTH_STRINGS in the three monospaced outline faces.
 * $7F needs the width of the fallback glyph, which is known at the atlas sizes (8 and 10 here);
 * the strings without $7F are also drawn at 13 and 72 pt, which have no atlas. A suite of its own
 * so that SH3's gdi-references.test.ts, which reads text-outline, takes these cases up when the
 * port follows the rules (T2 errata section 2).
 */
function textOutlineZero(): GdiCase[] {
  const suite = 'text-outline-zero';
  const cases: GdiCase[] = [];
  for (const name of ['Courier New', 'Lucida Console', 'Consolas']) {
    for (const size of [8, 10, 13, 72]) {
      for (const style of [0, 1, 3, 4]) {
        for (const bytes of OUTLINE_ZERO_WIDTH_STRINGS) {
          if (bytes.includes(0x7f) && size !== 8 && size !== 10) continue;
          cases.push({
            id: `${suite}-${pad(cases.length)}`,
            suite,
            width: size >= 72 ? 480 : 160,
            height: size >= 72 ? 140 : 40,
            ops: [
              { op: 'bg', color: 0x336699 },
              { op: 'font', name, size, style },
              { op: 'fill', color: 0x0000ff },
              { op: 'fontcolor', color: 0x0000ff },
              { op: 'moveto', x: 1, y: 1 },
              { op: 'text', x: 8, y: 4, bytes: [...bytes] },
            ],
          });
        }
      }
    }
  }
  return cases;
}

/** Every case of 6.5.1 and 6.5.3, in suite order. Deterministic. */
export function generateCases(): GdiCase[] {
  return [
    ...lines(),
    ...polylines(),
    ...widelines(),
    ...rects(),
    ...pens(),
    ...floods(),
    ...modes(),
    ...modesHigh(),
    ...pixels(),
    ...colourCases('colors', COLOUR_FORMS),
    ...colourCases('colors-system', SYSTEM_COLOUR_FORMS),
    ...clip(),
    ...text(),
    ...textOutline(false),
    ...textOutlineZero(),
    ...textOutline(true),
  ];
}

// ---------------------------------------------------------------------------------------------
// Text form read by the capture program (one operation per line)

const hex = (n: number) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

export function serializeOp(o: GdiOp): string {
  switch (o.op) {
    case 'bg':
    case 'pen':
    case 'fill':
    case 'fontcolor':
      return `${o.op} ${hex(o.color)}`;
    case 'width':
    case 'mode':
      return `${o.op} ${o.value}`;
    case 'pixel':
    case 'lineto':
    case 'moveto':
    case 'flood':
      return `${o.op} ${o.x} ${o.y}`;
    case 'line':
    case 'rect':
    case 'urect':
    case 'ellipse':
    case 'uellipse':
      return `${o.op} ${o.x1} ${o.y1} ${o.x2} ${o.y2}`;
    case 'font':
      return `font ${o.size} ${o.style} ${o.name}`;
    case 'text':
      return `text ${o.x} ${o.y} ${o.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')}`.trimEnd();
  }
}

export function serializeCases(cases: readonly GdiCase[]): string {
  const out: string[] = ['# GDI capture case list, generated by tests/conformance/gdi/cases.ts'];
  for (const c of cases) {
    out.push(`case ${c.id} ${c.width} ${c.height}`);
    for (const o of c.ops) out.push(serializeOp(o));
    out.push('end');
  }
  return out.join('\n') + '\n';
}
