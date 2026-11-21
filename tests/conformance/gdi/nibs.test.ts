// The port's pen nibs (app/src/core/sim-host/surface/tables/pens.ts, SH2) against the polygons
// Windows GDI makes of the wide pens 2-255, as the GDI capture measures them (`gdi-capture nibs`,
// golden/nibs.json; docs/requests/SH2-gdi-nibs.md). `npm run oracle:gdi` regenerates nibs.json on
// Windows and fails when Windows changes it; this test holds pens.ts to it on every system.
// Owner: T2 (the test and the reference); held to it: SH2 (pens.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_NIB_WIDTH, MIN_NIB_WIDTH, penNib } from '../../../app/src/core/sim-host/surface/tables/pens';

interface NibsFile {
  capturedOn: { windows: string };
  nibs: Record<string, string>;
  ties: { width: number; dx: number; dy: number; path: string }[];
}

const nibs = JSON.parse(readFileSync(new URL('golden/nibs.json', import.meta.url), 'utf8')) as NibsFile;

describe('pen nibs against the GDI capture', () => {
  it('the capture has a nib for every width 2-255 and nothing else', () => {
    const widths = Object.keys(nibs.nibs).map(Number);
    expect(widths).toEqual(Array.from({ length: MAX_NIB_WIDTH - MIN_NIB_WIDTH + 1 }, (_, i) => i + MIN_NIB_WIDTH));
  });

  it('every vertex of every nib equals the capture', () => {
    const differ: string[] = [];
    for (let w = MIN_NIB_WIDTH; w <= MAX_NIB_WIDTH; w++) {
      const { x, y } = penNib(w);
      const port = Array.from(x, (v, i) => `${v},${y[i]}`).join(' ');
      if (port !== nibs.nibs[String(w)])
        differ.push(`width ${w}: port "${port}", GDI "${nibs.nibs[String(w)] ?? '(none)'}"`);
    }
    expect(differ.slice(0, 10), `${differ.length} of 254 nibs differ`).toEqual([]);
  });

  it('records the widened paths of the tie directions', () => {
    expect(nibs.ties.length).toBeGreaterThan(0);
    for (const t of nibs.ties)
      expect(t.path, `width ${t.width} (${t.dx},${t.dy})`).toMatch(/^-?\d+,-?\d+,6( -?\d+,-?\d+,[23])+$/);
  });
});
