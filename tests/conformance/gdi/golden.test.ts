// The committed GDI references themselves (ARCHITECTURE.md 6.2.3, 6.5): complete, readable, and in
// agreement with what trap15-tasks-60-up.md says about GDI. A disagreement found here is a spec
// erratum (docs/porting/errata/T2.md) or a capture defect, never something to fix in the port.
// Owner: T2.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COLOUR_FORMS,
  OUTLINE_ZERO_WIDTH_STRINGS,
  RASTER_SIZE_LIMIT,
  TEXT_COLOUR_FORMS,
  textUnmodelled,
  ZERO_WIDTH_BAR_SIZES,
  ZERO_WIDTH_BYTES,
  type GdiCase,
} from './cases';
import { cellOf, loadAtlas, loadMetrics, loadScalableIndex, STYLE_NAMES, FONTS_DIR } from './fonts';
import { cases, firstDifference, hasPack, hex6, references, spots, suiteNames } from './golden';
import { decodeAtlas } from './pix';
import {
  delOnFallback,
  drawTextCase,
  layoutText,
  OUTLINE_ZERO_ADVANCE,
  outlineAdvance,
  outlineCells,
  resolveColour,
  textExtent,
} from './text-model';

const T = 120_000;

describe('golden packs', () => {
  it(
    'exist for every suite and hold exactly the cases of cases.ts, in order',
    () => {
      for (const suite of suiteNames()) {
        expect(hasPack(suite), `golden/${suite}.pixpack.gz`).toBe(true);
        const refs = references(suite);
        const expected = cases().filter((c) => c.suite === suite);
        expect(refs.map((r) => r.case.id)).toEqual(expected.map((c) => c.id));
        for (const r of refs) {
          expect([r.image.width, r.image.height]).toEqual([r.case.width, r.case.height]);
        }
      }
    },
    T,
  );

  it(
    'cover the case counts of 6.5.1',
    () => {
      const count = (suite: string) => cases().filter((c) => c.suite === suite).length;
      expect(count('lines')).toBe(10_000);
      expect(count('widelines')).toBe(2_000);
      expect(count('rects')).toBe(10_000);
      expect(count('floods')).toBe(1_000);
      expect(count('modes')).toBe(3 * 16 * 10);
      expect(count('modes-high')).toBe(238);
    },
    T,
  );
});

describe('spot values of trap15-b', () => {
  const s = spots();

  it('records the capture machine', () => {
    expect(s.capturedOn).toHaveProperty('fontSmoothing');
    expect(s.capturedOn).toHaveProperty('logPixelsY', 96);
  });

  it('4.6: the 20 stock palette entries, black from index 20', () => {
    const want = [
      0x000000, 0x000080, 0x008000, 0x008080, 0x800000, 0x800080, 0x808000, 0xc0c0c0, 0xc0dcc0, 0xf0caa6, 0xf0fbff,
      0xa4a0a0, 0x808080, 0x0000ff, 0x00ff00, 0x00ffff, 0xff0000, 0xff00ff, 0xffff00, 0xffffff,
    ];
    expect(s.stockPalette.slice(0, 20)).toEqual(want);
    expect(s.stockPalette.slice(20).every((c) => c === 0)).toBe(true);
  });

  it('4.6: colour forms', () => {
    expect(s.colourForms['01010005']).toBe(0x800080); // only the low 16 bits select the entry
    expect(s.colourForms['0100FF05']).toBe(0); // ... so this is black
    expect(s.colourForms['02336699']).toBe(0x336699); // other even top bytes: RGB
    expect(s.colourForms['80000005']).toBe(0xffffff); // system colour 5
    expect(s.colourForms['80000008']).toBe(0x000000); // 8
    expect(s.colourForms['8000000F']).toBe(0xf0f0f0); // 15
    expect(s.colourForms['8000001F']).toBe(0); // above 30: black
    expect(s.sysColors[5]).toBe(0xffffff);
    expect(s.sysColors[8]).toBe(0);
    expect(s.sysColors[15]).toBe(0xf0f0f0);
    expect(s.sysColors.slice(31).every((c) => c === 0)).toBe(true);
  });

  it('5.4: the 16 operations with D = $336699, pen $0F0FF0, brush $F0F00F', () => {
    const D = 0x336699;
    const ops: ((p: number, d: number) => number)[] = [
      () => 0,
      () => 0xffffff,
      (_p, d) => d,
      (_p, d) => ~d,
      (p) => p,
      (p) => ~p,
      (p, d) => p | ~d,
      (p, d) => p & ~d,
      (p, d) => ~p | d,
      (p, d) => ~p & d,
      (p, d) => p | d,
      (p, d) => ~(p | d),
      (p, d) => p & d,
      (p, d) => ~(p & d),
      (p, d) => p ^ d,
      (p, d) => ~(p ^ d),
    ];
    for (const m of s.modes) {
      const op = ops[m.mode] as (p: number, d: number) => number;
      const pen = op(0x0f0ff0, D) & 0xffffff;
      expect([m.mode, m.line, m.pixel, m.outline, m.interior]).toEqual([
        m.mode,
        pen,
        pen,
        pen,
        op(0xf0f00f, D) & 0xffffff,
      ]);
    }
  });

  it('5.4: GDI acts on a raw ROP2 value v as operation ((v - 1) AND 15) + 1', () => {
    for (const [v, [as]] of s.rop2Raw.entries()) expect(as, `ROP2 ${v}`).toBe(((v - 1) & 15) + 1);
  });

  it('6.2: dot diameters and pixel counts for widths 2-14; widths 0 and 1 draw one pixel', () => {
    const diameters = [1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13];
    const counts = [1, 5, 9, 21, 21, 37, 45, 61, 69, 89, 101, 129, 145];
    for (const d of s.dots) {
      if (d.width < 2) expect([d.pixels, d.diameterX]).toEqual([1, 1]);
      else
        expect([d.width, d.diameterX, d.diameterY, d.pixels]).toEqual([
          d.width,
          diameters[d.width - 2],
          diameters[d.width - 2],
          counts[d.width - 2],
        ]);
    }
  });

  it('6.7: control bytes in Fixedsys: painted width of "A", b, "B" and the pen after it', () => {
    for (const c of s.controlBytes) {
      const zero = [9, 10, 13, 28, 29, 30, 31].includes(c.byte);
      const width = zero ? 0 : c.byte === 12 ? 8 : c.byte === 2 ? 5 : 4;
      expect([c.byte, c.cellRight, c.pen]).toEqual([c.byte, 16 + width, 24]);
    }
  });
});

/** ceil(a / b) for integers, exactly. */
function ceilDiv(a: number, b: number): number {
  if (b < 0) {
    a = -a;
    b = -b;
  }
  let q = Math.floor(a / b);
  while (q * b > a) q--;
  while ((q + 1) * b <= a) q++;
  return q * b === a ? q : q + 1;
}

/** trap15-b 6.1: the pixels of LineTo (end excluded), then the end pixel. */
function modelLine(x1: number, y1: number, x2: number, y2: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    const step = Math.sign(dx);
    for (let x = x1; x !== x2; x += step) out.push([x, y1 + ceilDiv(2 * (x - x1) * dy - dx, 2 * dx)]);
  } else if (dy !== 0) {
    const step = Math.sign(dy);
    for (let y = y1; y !== y2; y += step) out.push([x1 + ceilDiv(2 * (y - y1) * dx - dy, 2 * dy), y]);
  }
  out.push([x2, y2]);
  return out;
}

function picture(c: GdiCase, paint: (put: (x: number, y: number, colour: number) => void) => void): Uint32Array {
  const pixels = new Uint32Array(c.width * c.height);
  paint((x, y, colour) => {
    if (x >= 0 && y >= 0 && x < c.width && y < c.height) pixels[y * c.width + x] = colour;
  });
  return pixels;
}

describe('rasterisation rules of trap15-b 6 against the capture', () => {
  it(
    '6.1: every width-1 line of the lines suite',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const r of references('lines')) {
        let pen = 0xffffff;
        const lines: [number, number, number, number][] = [];
        for (const o of r.case.ops) {
          if (o.op === 'pen') pen = o.color;
          else if (o.op === 'line') lines.push([o.x1, o.y1, o.x2, o.y2]);
        }
        const want = picture(r.case, (put) => {
          for (const l of lines) for (const [x, y] of modelLine(...l)) put(x, y, pen);
        });
        checked++;
        const diff = firstDifference(r.image, { width: r.case.width, pixels: want });
        if (diff) failures.push(`${r.case.id} (${diff.count} pixels, first at ${diff.x},${diff.y})`);
        const last = lines[lines.length - 1] as [number, number, number, number];
        if (r.pen[0] !== last[2] || r.pen[1] !== last[3])
          failures.push(`${r.case.id}: pen ${r.pen} after a line to ${last[2]},${last[3]}`);
      }
      expect(checked).toBe(10_000);
      expect(failures.slice(0, 20)).toEqual([]);
    },
    T,
  );

  it(
    '6.3: rectangles, cases A and B at every width and case C at width 1, in Copy mode',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const r of references('rects')) {
        if (r.case.ops.some((o) => o.op === 'mode' || o.op === 'bg')) continue;
        let pen = 0xffffff;
        let fill = 0;
        let width = 1;
        let skip = false;
        const want = picture(r.case, (put) => {
          for (const o of r.case.ops) {
            if (o.op === 'pen') pen = o.color;
            else if (o.op === 'fill') fill = o.color;
            else if (o.op === 'width') width = Math.max(1, o.value);
            else if (o.op === 'rect' || o.op === 'urect') {
              const x1 = Math.min(o.x1, o.x2),
                x2 = Math.max(o.x1, o.x2),
                y1 = Math.min(o.y1, o.y2),
                y2 = Math.max(o.y1, o.y2);
              const a = Math.floor(width / 2);
              const b = Math.floor((width - 1) / 2);
              if (x1 < x2 && y1 < y2) {
                for (let y = y1 - a; y <= y2 + b; y++) {
                  for (let x = x1 - a; x <= x2 + b; x++) {
                    const inner = x >= x1 + b + 1 && x <= x2 - a - 1 && y >= y1 + b + 1 && y <= y2 - a - 1;
                    if (!inner) put(x, y, pen);
                    else if (o.op === 'rect') put(x, y, fill);
                  }
                }
              } else if (x1 === x2 && y1 === y2) {
                if (width > 1) skip = true; // the measured dot shape (6.2); checked by the dot spot values
              } else if (width === 1) {
                for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) put(x, y, pen);
              } else if (y1 === y2) {
                for (let y = y1 - a; y <= y1 + b; y++) for (let x = x1; x < x2; x++) put(x, y, pen);
              } else {
                for (let y = y1; y < y2; y++) for (let x = x1 - a; x <= x1 + b; x++) put(x, y, pen);
              }
            }
          }
        });
        if (skip) continue;
        checked++;
        const diff = firstDifference(r.image, { width: r.case.width, pixels: want });
        if (diff)
          failures.push(
            `${r.case.id} (${diff.count} pixels, first at ${diff.x},${diff.y}: ${hex6(diff.got)} not ${hex6(diff.want)})`,
          );
      }
      expect(checked).toBeGreaterThan(8_000);
      expect(failures.slice(0, 20)).toEqual([]);
    },
    T,
  );

  it(
    '6.3 in non-Copy modes, width 1: case A combines each pixel once; case B combines the two end pixels once and the others twice',
    () => {
      const OPS: Record<number, (p: number, d: number) => number> = {
        3: (_p, d) => ~d,
        6: (p, d) => p | ~d,
        9: (p, d) => ~p & d,
        14: (p, d) => p ^ d,
        15: (p, d) => ~(p ^ d),
      };
      const failures: string[] = [];
      let checked = 0;
      for (const r of references('rects')) {
        const modeOp = r.case.ops.find((o) => o.op === 'mode');
        if (!modeOp || modeOp.op !== 'mode') continue;
        let pen = 0xffffff;
        let fill = 0;
        let width = 1;
        for (const o of r.case.ops) {
          if (o.op === 'pen') pen = o.color;
          else if (o.op === 'fill') fill = o.color;
          else if (o.op === 'width') width = Math.max(1, o.value);
        }
        if (width > 1) continue;
        const op = OPS[modeOp.value] as (p: number, d: number) => number;
        const shape = r.case.ops.find((o) => o.op === 'rect' || o.op === 'urect');
        if (!shape || (shape.op !== 'rect' && shape.op !== 'urect')) continue;
        const pixels = new Uint32Array(r.case.width * r.case.height).fill(0x336699);
        const combine = (x: number, y: number, p: number, times = 1) => {
          if (x < 0 || y < 0 || x >= r.case.width || y >= r.case.height) return;
          for (let t = 0; t < times; t++)
            pixels[y * r.case.width + x] = op(p, pixels[y * r.case.width + x] as number) & 0xffffff;
        };
        const x1 = Math.min(shape.x1, shape.x2),
          x2 = Math.max(shape.x1, shape.x2);
        const y1 = Math.min(shape.y1, shape.y2),
          y2 = Math.max(shape.y1, shape.y2);
        if (x1 < x2 && y1 < y2) {
          for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
              const edge = x === x1 || x === x2 || y === y1 || y === y2;
              if (edge) combine(x, y, pen);
              else if (shape.op === 'rect') combine(x, y, fill);
            }
          }
        } else if (y1 === y2 && x1 < x2) {
          for (let x = x1; x <= x2; x++) combine(x, y1, pen, x === x1 || x === x2 ? 1 : 2);
        } else if (x1 === x2 && y1 < y2) {
          for (let y = y1; y <= y2; y++) combine(x1, y, pen, y === y1 || y === y2 ? 1 : 2);
        }
        checked++;
        const diff = firstDifference(r.image, { width: r.case.width, pixels });
        if (diff)
          failures.push(
            `${r.case.id} (${diff.count} pixels, first at ${diff.x},${diff.y}: ${hex6(diff.got)} not ${hex6(diff.want)})`,
          );
      }
      expect(checked).toBeGreaterThan(50);
      expect(failures.slice(0, 20)).toEqual([]);
    },
    T,
  );

  it(
    '4.6: the colour forms draw the resolved colour on pixel, line, outline, interior and flood fill',
    () => {
      const s = spots();
      const resolve = (c: number) => resolveColour(c, s);
      const refs = references('colors');
      expect(refs.length).toBe(COLOUR_FORMS.length);
      for (const r of refs) {
        const c = (r.case.ops[1] as { color: number }).color;
        const at = (x: number, y: number) => (r.image.pixels[y * r.image.width + x] as number) & 0xffffff;
        const want = resolve(c);
        expect([hex6(c), at(0, 0), at(3, 0), at(8, 0), at(10, 2), at(1, 6)]).toEqual([
          hex6(c),
          want,
          want,
          want,
          want,
          want,
        ]);
      }
    },
    T,
  );
});

describe('metric table (app/public/fonts/metrics.json)', () => {
  const metrics = loadMetrics();
  const NAMES = [
    'Fixedsys',
    'Courier',
    'Courier New',
    'Lucida Console',
    'Lucida Sans Typerwriter',
    'Consolas',
    'Terminal',
  ];

  it(
    'covers every name, style and size 0-255, with the face Windows used',
    () => {
      expect(Object.keys(metrics.fonts).sort()).toEqual([...NAMES].sort());
      for (const name of NAMES) {
        for (const style of STYLE_NAMES) {
          const sizes = metrics.fonts[name]?.[style];
          expect(sizes?.length, `${name} ${style}`).toBe(256);
          for (const e of sizes ?? []) {
            expect(e[0] > 0 && e[1] > 0 && metrics.faces[e[2]] !== undefined).toBe(true);
          }
        }
      }
      expect(metrics.capturedOn).toHaveProperty('fontSmoothing');
    },
    T,
  );

  it('5.7: the measured cells of trap15-b', () => {
    const cells = (name: string, sizes: number[]) =>
      sizes.map((s) => cellOf(metrics, { name, size: s, style: 0 })).map((c) => `${c.colWidth}x${c.rowHeight}`);
    const dialog = [8, 9, 10, 11, 12, 14, 16, 18];
    expect(cells('Fixedsys', [8, 9, 12, 16, 18])).toEqual(['8x15', '8x15', '8x15', '8x15', '16x30']);
    expect(cells('Courier', [10, 12, 15])).toEqual(['8x13', '9x16', '12x20']);
    expect(cells('Courier New', dialog)).toEqual(['7x14', '7x15', '8x16', '9x17', '10x18', '11x21', '13x23', '14x27']);
    expect(cells('Lucida Console', dialog)).toEqual([
      '7x11',
      '7x12',
      '8x13',
      '9x15',
      '10x16',
      '11x19',
      '13x21',
      '14x24',
    ]);
    expect(cells('Consolas', dialog)).toEqual(['6x13', '7x14', '7x15', '8x18', '9x19', '10x22', '12x24', '13x28']);
    expect(cellOf(metrics, { name: 'Lucida Sans Typerwriter', size: 9, style: 0 }).face).toBe('Arial');
    expect(cellOf(metrics, { name: 'Terminal', size: 9, style: 0 }).face).toBe('Arial');
    expect(cellOf(metrics, { name: 'Fixedsys', size: 9, style: 0 }).kind).toBe('raster');
  });

  it(
    'lists raster atlases that exist and decode',
    () => {
      for (const a of metrics.raster.atlases) {
        const atlas = loadAtlas(a.file);
        expect([a.file, atlas.cellWidth, atlas.cellHeight, atlas.glyphWidth, atlas.coverage8]).toEqual([
          a.file,
          a.cellWidth,
          a.cellHeight,
          a.glyphWidth,
          false,
        ]);
      }
      for (const c of metrics.raster.cells) expect(metrics.raster.atlases.some((a) => a.file === c.native)).toBe(true);
    },
    T,
  );
});

describe('text references against the font data', () => {
  const metrics = loadMetrics();

  it(
    '6.5.3: every raster-face text case is reproduced pixel for pixel from the atlases and rules',
    () => {
      const failures: string[] = [];
      const refs = references('text');
      for (const r of refs) {
        const model = drawTextCase(metrics, r.case);
        const diff = firstDifference(r.image, model);
        if (diff)
          failures.push(
            `${r.case.id}: ${diff.count} pixels, first at ${diff.x},${diff.y}: GDI ${hex6(diff.got)}, model ${hex6(diff.want)}`,
          );
        if (r.pen[0] !== model.pen[0] || r.pen[1] !== model.pen[1])
          failures.push(`${r.case.id}: pen ${r.pen}, model ${model.pen}`);
      }
      expect(refs.length).toBeGreaterThan(500);
      expect(failures.slice(0, 20)).toEqual([]);
    },
    T,
  );

  it(
    '6.5.3: outline-face cells and pen positions follow metrics.json (monospaced faces)',
    () => {
      const failures: string[] = [];
      let checked = 0;
      for (const r of [...references('text-outline'), ...references('text-outline-zero')]) {
        const cells = outlineCells(metrics, r.case);
        if (!cells) continue; // proportional face, or a width that is not known at this size
        checked++;
        const fill = 0x0000ff;
        const back = 0x336699;
        for (let y = 0; y < r.image.height; y++) {
          for (let x = 0; x < r.image.width; x++) {
            const inBox = cells.boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
            const got = (r.image.pixels[y * r.image.width + x] as number) & 0xffffff;
            // GDI widens a TrueType cell by the glyphs' ink overhang, and draws underline, strike-out
            // and the smoothed ink edge outside it: those pixels may take any colour (errata T2
            // section 2, last item).
            if (cells.uncertain(x, y)) continue;
            if (got !== (inBox ? fill : back)) {
              failures.push(`${r.case.id} at ${x},${y}`);
              y = r.image.height;
              break;
            }
          }
        }
        if (r.pen[0] !== cells.pen[0] || r.pen[1] !== cells.pen[1])
          failures.push(`${r.case.id}: pen ${r.pen}, expected ${cells.pen}`);
      }
      expect(checked).toBeGreaterThan(150);
      expect(failures.slice(0, 20)).toEqual([]);
    },
    T,
  );

  it(
    'TextWidth: zero-width bytes count 0 exactly when the string has a byte of $80 or above, in every style',
    () => {
      // Verifier round 1: the earlier rule made underline/strike-out the condition. Each string here
      // is captured in every style at several sizes; GDI's pen must equal textExtent().
      const probes = [
        [28, 57],
        [13, 46],
        [65, 13, 66],
        [28, 170, 29, 29],
        [28, 225, 109],
        [65, 13, 0xe9],
      ].map((b) => b.join(','));
      const styles = new Set<string>();
      for (const r of references('text')) {
        let font = { name: 'Fixedsys', size: 9, style: 0 };
        for (const o of r.case.ops) if (o.op === 'font') font = o;
        const text = r.case.ops.find((o) => o.op === 'text');
        if (!text || text.op !== 'text' || !probes.includes(text.bytes.join(','))) continue;
        const advance = (b: number) => layoutText(metrics, font, [b]).extent;
        expect([r.case.id, r.pen[0] - text.x]).toEqual([r.case.id, textExtent(text.bytes, advance)]);
        styles.add(`${text.bytes.join(',')}/${font.style}`);
      }
      expect(styles.size).toBe(probes.length * 5);
    },
    T,
  );

  it('text holds only strings the model covers, text-control only strings it does not', () => {
    for (const suite of ['text', 'text-control']) {
      for (const c of cases().filter((k) => k.suite === suite)) {
        let font = { name: 'Fixedsys', size: 9, style: 0 };
        const reasons: (string | null)[] = [];
        for (const o of c.ops) {
          if (o.op === 'font') font = o;
          if (o.op === 'text') reasons.push(textUnmodelled(font.name, font.size, font.style, o.bytes));
        }
        expect([c.id, reasons.some((x) => x !== null)]).toEqual([c.id, suite === 'text-control']);
      }
    }
  });

  it(
    'ZERO_WIDTH_BAR_SIZES is exact: a lone $0D at every raster size is in text unless GDI drew a bar there',
    () => {
      // Review round 2: the list had not been measured above 72 pt. The barSweep cases put a lone $0D
      // at every size at which the face is raster: those at the listed sizes are in text-control and
      // must really differ from the model there (no size listed for nothing); the others are in
      // text, which the test above reproduces pixel for pixel (no size missing).
      const isLoneCr = (c: GdiCase) => {
        const t = c.ops.find((o) => o.op === 'text');
        return c.ops.length === 3 && t?.op === 'text' && t.bytes.length === 1 && t.bytes[0] === 13 && t.x === 3;
      };
      const seen: Record<string, Set<number>> = { Fixedsys: new Set(), Courier: new Set() };
      for (const suite of ['text', 'text-control'] as const) {
        for (const r of references(suite)) {
          if (!isLoneCr(r.case)) continue;
          const font = r.case.ops[0] as { op: 'font'; name: string; size: number; style: number };
          if (font.style !== 0) continue;
          seen[font.name]?.add(font.size);
          const listed = (ZERO_WIDTH_BAR_SIZES[font.name] ?? []).includes(font.size);
          expect([r.case.id, font.name, font.size, suite]).toEqual([
            r.case.id,
            font.name,
            font.size,
            listed ? 'text-control' : 'text',
          ]);
          if (listed) {
            const model = drawTextCase(metrics, r.case);
            expect([r.case.id, firstDifference(r.image, model) !== null]).toEqual([r.case.id, true]);
          }
        }
      }
      for (const [name, limit] of Object.entries(RASTER_SIZE_LIMIT)) {
        expect([name, seen[name]?.size]).toEqual([name, limit + 1]);
        expect(cellOf(metrics, { name, size: limit, style: 0 }).kind).toBe('raster');
        expect(cellOf(metrics, { name, size: limit + 1, style: 0 }).kind).toBe('outline');
      }
    },
    T,
  );

  it(
    'outline faces: $7F in a string with a byte of $80 or above takes delInHighString, not its advance',
    () => {
      // Review round 2: GDI draws that $7F from a fallback font (Courier New 9 [$E9,$7F] = 11, not 14).
      let checked = 0;
      for (const r of references('text-outline')) {
        let font = { name: 'Fixedsys', size: 9, style: 0 };
        let x = 0;
        for (const o of r.case.ops) {
          if (o.op === 'font') font = o;
          if (o.op === 'text')
            x = o.x + o.bytes.reduce((n, b) => n + (outlineAdvance(metrics, font, b, o.bytes) ?? NaN), 0);
        }
        const last = r.case.ops.filter((o) => o.op === 'text').at(-1);
        if (!last || last.op !== 'text' || !delOnFallback(last.bytes) || Number.isNaN(x)) continue;
        checked++;
        expect([r.case.id, r.pen[0]]).toEqual([r.case.id, x]);
        // The face's own advance would have put the pen elsewhere.
        expect(r.pen[0]).not.toBe(last.x + last.bytes.length * cellOf(metrics, font).colWidth);
      }
      expect(checked).toBe(18);
    },
    T,
  );

  it(
    'outline faces: zero-width bytes take no room in the cell, Consolas $0D advances 0, $7F fills the fallback width',
    () => {
      // Review round 2 of gate I1, defect 14: the model gave every byte the cell width, so Consolas
      // strings of zero-width bytes put the pen too far and every cell with a zero-width byte or $7F
      // was too wide. The previous rule is kept here to show that these cases tell the two apart.
      const previous = (c: GdiCase) => {
        let font = { name: 'Fixedsys', size: 9, style: 0 };
        let pen = 0;
        let width = 0;
        for (const o of c.ops) {
          if (o.op === 'font') font = o;
          if (o.op === 'text') {
            width = o.bytes.length * cellOf(metrics, font).colWidth;
            pen = o.x + textExtent(o.bytes, () => cellOf(metrics, font).colWidth);
          }
        }
        return { pen, width };
      };
      const isZeroWidthCase = (c: GdiCase) =>
        c.ops.some((o) => o.op === 'text' && OUTLINE_ZERO_WIDTH_STRINGS.some((s) => s.join(',') === o.bytes.join(',')));
      let checked = 0;
      let penDiffers = 0;
      let cellDiffers = 0;
      for (const r of references('text-outline-zero')) {
        expect([r.case.id, isZeroWidthCase(r.case)]).toEqual([r.case.id, true]);
        const cells = outlineCells(metrics, r.case);
        const text = r.case.ops.find((o) => o.op === 'text');
        const onlyDel = text?.op === 'text' && text.bytes.every((b) => b === 0x7f || ZERO_WIDTH_BYTES.includes(b));
        const onlyDelWithDel = onlyDel && text.bytes.includes(0x7f);
        // A string that draws only $7F has the fallback font's cell height, which is not measured.
        expect([r.case.id, cells !== null]).toEqual([r.case.id, !onlyDelWithDel]);
        if (!cells) continue;
        checked++;
        expect([r.case.id, r.pen]).toEqual([r.case.id, cells.pen]);
        const old = previous(r.case);
        if (old.pen !== r.pen[0]) penDiffers++;
        if (old.width !== (cells.boxes[0] as { w: number }).w) cellDiffers++;
      }
      // 11 strings at 8 and 10 pt, the 6 without $7F also at 13 and 72 pt; 3 strings draw only $7F.
      expect(checked).toBe(3 * (2 * 4 * (11 - 3) + 2 * 4 * 6));
      expect(penDiffers).toBeGreaterThan(20); // the Consolas strings with $0D
      expect(cellDiffers).toBeGreaterThan(200);
    },
    T,
  );

  it('OUTLINE_ZERO_ADVANCE agrees with windows-outline-metrics.tsv in the monospaced outline faces', () => {
    // Every byte has the cell width there except the undefined bytes (and $98 in Courier New), which
    // no modelled case contains, and the listed bytes, which have 0.
    const tsv = readFileSync(new URL('../../../tools/fonts-src/windows-outline-metrics.tsv', import.meta.url), 'utf8');
    const ignored = [0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x98];
    let rows = 0;
    for (const line of tsv.split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue;
      const f = line.split('\t');
      const face = f[3] as string;
      if (!['Courier New', 'Lucida Console', 'Consolas'].includes(face)) continue;
      rows++;
      const colWidth = Number(f[4]);
      const advances = (f[16] as string).split(',').map(Number);
      for (let b = 1; b < 256; b++) {
        if (ignored.includes(b)) continue;
        const zero = (OUTLINE_ZERO_ADVANCE[face] ?? []).includes(b);
        expect([face, f[1], f[2], b, advances[b]]).toEqual([face, f[1], f[2], b, zero ? 0 : colWidth]);
      }
    }
    expect(rows).toBeGreaterThan(100);
  });

  it(
    'task 21 font colours with a non-zero top byte follow 4.6 (request SH3-gdi-text-colour.md)',
    () => {
      const s = spots();
      let checked = 0;
      for (const r of references('text')) {
        const fc = r.case.ops.find((o) => o.op === 'fontcolor');
        if (!fc || fc.op !== 'fontcolor' || !TEXT_COLOUR_FORMS.includes(fc.color)) continue;
        const text = r.case.ops.find((o) => o.op === 'text');
        if (text?.op !== 'text' || text.bytes.join(',') !== '65,66') continue;
        checked++;
        const want = resolveColour(fc.color, s);
        const fill = 0x800000;
        const colours = new Set<number>();
        for (const p of r.image.pixels) colours.add(p & 0xffffff);
        colours.delete(0); // the background outside the cell
        colours.delete(fill);
        // "AB" in Fixedsys has glyph pixels, all in the resolved colour (black or the fill colour cannot
        // be told apart here; the pixel-for-pixel test above checks those cases too).
        const expected = want === fill || want === 0 ? [] : [hex6(want)];
        expect([hex6(fc.color), [...colours].map(hex6)]).toEqual([hex6(fc.color), expected]);
      }
      expect(checked).toBe(TEXT_COLOUR_FORMS.length);
    },
    T,
  );

  it('layoutText: the 6.7 measurement, two Fixedsys bytes fill exactly 16 x 15', () => {
    const l = layoutText(metrics, { name: 'Fixedsys', size: 9, style: 0 }, [65, 66]);
    expect([l.boxWidth, l.cellHeight, l.extent]).toEqual([16, 15, 16]);
  });
});

describe('outline atlases (app/public/fonts/scalable)', () => {
  it(
    'index.json lists, for each substitute face, plain, bold and italic at the dialog sizes and 24 and 36 pt',
    () => {
      const index = loadScalableIndex();
      const metrics = loadMetrics();
      for (const [face, request] of [
        ['Courier New', 'Courier New'],
        ['Lucida Console', 'Lucida Console'],
        ['Consolas', 'Consolas'],
        ['Arial', 'Lucida Sans Typerwriter'],
      ] as const) {
        for (const style of ['plain', 'bold', 'italic'] as const) {
          for (const size of [8, 9, 10, 11, 12, 14, 16, 18, 24, 36]) {
            const cell = cellOf(metrics, { name: request, size, style: STYLE_NAMES.indexOf(style) });
            const entry = index.find(
              (e) =>
                e.face === face &&
                e.style === style &&
                e.cellHeight === cell.rowHeight &&
                e.cellWidth === cell.colWidth,
            );
            expect(entry, `${face} ${style} ${size}`).toBeDefined();
            const atlas = decodeAtlas(new Uint8Array(readFileSync(FONTS_DIR + (entry?.file ?? ''))));
            expect([atlas.coverage8, atlas.cellWidth, atlas.cellHeight]).toEqual([true, cell.colWidth, cell.rowHeight]);
          }
        }
      }
    },
    T,
  );
});
