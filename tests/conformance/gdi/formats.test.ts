// Unit tests of the case generator and the reference formats (ARCHITECTURE.md 6.5.3). Owner: T2.

import { describe, expect, it } from 'vitest';
import { createRandom, generateCases, serializeCases, serializeOp, SUITES } from './cases';
import { decodeAtlas, decodePack, decodePix, encodePack, encodePix } from './pix';

describe('cases.ts', () => {
  it('is deterministic and every id is unique and belongs to a declared suite', () => {
    const a = generateCases();
    const b = generateCases();
    expect(serializeCases(a)).toBe(serializeCases(b));
    expect(new Set(a.map((c) => c.id)).size).toBe(a.length);
    const suites = new Set(SUITES.map((s) => s.name));
    for (const c of a) {
      expect(suites.has(c.suite)).toBe(true);
      expect(c.id.startsWith(`${c.suite}-`)).toBe(true);
    }
  }, 60_000);

  it('uses coordinates of the signed 16-bit range and modes the capture understands', () => {
    for (const c of generateCases()) {
      for (const o of c.ops) {
        for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2'] as const) {
          const v = (o as Record<string, unknown>)[k];
          if (typeof v === 'number') expect(v >= -32768 && v <= 32767).toBe(true);
        }
        if (o.op === 'mode') expect(o.value !== 16 && o.value !== 17 && o.value >= 0 && o.value <= 255).toBe(true);
        if (o.op === 'text') expect(o.bytes.includes(0)).toBe(false);
      }
    }
  }, 60_000);

  it('serializes operations in the capture program format', () => {
    expect(serializeOp({ op: 'pen', color: 0x80000005 })).toBe('pen 80000005');
    expect(serializeOp({ op: 'line', x1: -1, y1: 2, x2: 3, y2: -4 })).toBe('line -1 2 3 -4');
    expect(serializeOp({ op: 'font', name: 'Courier New', size: 9, style: 3 })).toBe('font 9 3 Courier New');
    expect(serializeOp({ op: 'text', x: 1, y: 2, bytes: [0x41, 0x0d] })).toBe('text 1 2 410D');
    expect(serializeOp({ op: 'text', x: 1, y: 2, bytes: [] })).toBe('text 1 2');
  });

  it('createRandom is the same sequence everywhere', () => {
    const r = createRandom(1);
    expect([r(), r(), r()].map((v) => Math.floor(v * 1e9))).toEqual([627073940, 2735721, 527447039]);
  });
});

describe('.pix', () => {
  it('round-trips and uses runs across rows', () => {
    const pixels = Uint32Array.from([1, 1, 1, 2, 2, 2, 2, $00bbggrr(), 1]);
    const bytes = encodePix({ width: 3, height: 3, pixels });
    expect([...bytes.subarray(0, 9)]).toEqual([0x45, 0x36, 0x38, 0x50, 1, 3, 0, 3, 0]);
    expect((bytes.length - 9) / 8).toBe(4);
    expect(decodePix(bytes)).toEqual({ width: 3, height: 3, pixels });
  });

  it('rejects files whose runs do not cover the picture', () => {
    const bytes = encodePix({ width: 2, height: 1, pixels: Uint32Array.from([5, 5]) });
    expect(() => decodePix(bytes.subarray(0, 9))).toThrow(/cover 0 of 2/);
    expect(() => decodePix(Uint8Array.from([0, 1, 2]))).toThrow(/E68P/);
  });
});

function $00bbggrr(): number {
  return 0x00336699;
}

describe('pixel packs', () => {
  it('round-trip ids, pens and .pix bytes', () => {
    const pix = encodePix({ width: 1, height: 1, pixels: Uint32Array.from([7]) });
    const pack = { suite: 's', capturedOn: { windows: 'x' }, cases: [{ id: 's-00000', pen: [3, -4] as const, pix }] };
    const back = decodePack(encodePack(pack));
    expect(back.suite).toBe('s');
    expect(back.capturedOn).toEqual({ windows: 'x' });
    expect(back.cases.map((c) => [c.id, c.pen, [...c.pix]])).toEqual([['s-00000', [3, -4], [...pix]]]);
  });
});

describe('font atlas', () => {
  it('decodes 1-bit and 8-bit atlases of format version 2', () => {
    const oneBit = new Uint8Array(9 + 256 + 256 * 2 * 2);
    oneBit.set([0x45, 0x36, 0x38, 0x46, 2, 9, 2, 9, 0], 0);
    oneBit[9 + 65] = 9;
    oneBit[9 + 256 + 65 * 4] = 0b10000000;
    oneBit[9 + 256 + 65 * 4 + 1] = 0b10000000; // 9th column of row 0
    const a = decodeAtlas(oneBit);
    expect([a.cellWidth, a.cellHeight, a.glyphWidth, a.coverage8, a.advances[65]]).toEqual([9, 2, 9, false, 9]);
    const g = a.glyph(65);
    expect([g[0], g[1], g[8], g[9]]).toEqual([255, 0, 255, 0]);

    const eight = new Uint8Array(9 + 256 + 256 * 1 * 1);
    eight.set([0x45, 0x36, 0x38, 0x46, 2, 1, 1, 1, 1], 0);
    eight[9 + 256 + 66] = 128;
    expect(decodeAtlas(eight).glyph(66)[0]).toBe(128);
    expect(() => decodeAtlas(eight.subarray(0, 100))).toThrow(/header says/);
  });
});
