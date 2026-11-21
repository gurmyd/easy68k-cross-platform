// The ellipse. These tests hold for the stub (an ideal ellipse) and for any shape that replaces it:
// they check only what trap15-b §6.4 states exactly. GDI's pixels are SH2's acceptance (6.5.2).

import { describe, expect, it } from 'vitest';
import { rasterEllipse } from './ellipse';

const SIZE = 80;
const CLIP = { left: 0, top: 0, right: SIZE, bottom: SIZE };

/** The ellipse as rows of text: `#` outline, `R` interior, `.` untouched, `2` a pixel reported twice. */
function draw(x1: number, y1: number, x2: number, y2: number, penWidth: number, filled: boolean): string[] {
  const cells: string[][] = Array.from({ length: SIZE }, () => new Array<string>(SIZE).fill('.'));
  const sink = (mark: string) => (y: number, from: number, to: number) => {
    expect(from).toBeLessThanOrEqual(to);
    for (let x = Math.max(from, 0); x <= Math.min(to, SIZE - 1); x++) {
      const row = cells[y];
      if (row) row[x] = row[x] === '.' ? mark : '2';
    }
  };
  rasterEllipse(x1, y1, x2, y2, penWidth, CLIP, sink('#'), filled ? sink('R') : null);
  return cells.map((row) => row.join(''));
}

const crop = (rows: string[], left: number, top: number, right: number, bottom: number) =>
  rows.slice(top, bottom).map((row) => row.slice(left, right));

describe('rasterEllipse: what trap15-b §6.4 states exactly', () => {
  it('a box of one point draws nothing with a one-pixel pen', () => {
    expect(draw(10, 10, 10, 10, 1, true).join('')).not.toMatch(/[#R2]/);
  });

  it('a box of one point draws the round dot with a wider pen', () => {
    expect(crop(draw(10, 10, 10, 10, 5, true), 7, 7, 14, 14)).toEqual([
      '.......',
      '..###..',
      '.#####.',
      '.#####.',
      '.#####.',
      '..###..',
      '.......',
    ]);
  });

  it('a box one pixel wide or high draws a straight run of pen pixels (the 1 x 8 example)', () => {
    expect(crop(draw(10, 10, 10, 17, 1, true), 9, 9, 12, 19)).toEqual([
      '...',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '.#.',
      '...',
    ]);
    expect(crop(draw(10, 10, 17, 10, 1, true), 9, 9, 19, 12)).toEqual(['..........', '.########.', '..........']);
  });

  it('a 2 x 2 box draws only the two pixels of its left column', () => {
    expect(crop(draw(10, 10, 11, 11, 1, true), 9, 9, 13, 13)).toEqual(['....', '.#..', '.#..', '....']);
  });

  it('the 3 x 3 box is the plus of the figure', () => {
    expect(crop(draw(10, 10, 12, 12, 1, true), 10, 10, 13, 13)).toEqual(['.#.', '#R#', '.#.']);
  });

  it('circles of 3 to 9 pixels have the measured left edges (trap15-b §6.4, top half, row by row)', () => {
    const measured: Record<number, number[]> = {
      3: [1, 0],
      4: [1, 0],
      5: [1, 0, 0],
      6: [2, 1, 0],
      7: [2, 1, 0, 0],
      8: [3, 1, 1, 0],
      9: [3, 1, 1, 0, 0],
    };
    for (const [size, offsets] of Object.entries(measured)) {
      const n = Number(size);
      const rows = crop(draw(20, 20, 20 + n - 1, 20 + n - 1, 1, true), 20, 20, 20 + n, 20 + n);
      expect(
        rows.slice(0, offsets.length).map((row) => row.search(/[#R]/)),
        `N = ${n}`,
      ).toEqual(offsets);
      // and they are symmetric, as these sizes are on GDI
      expect(rows, `N = ${n}`).toEqual([...rows].reverse());
      expect(rows, `N = ${n}`).toEqual(rows.map((row) => [...row].reverse().join('')));
    }
  });

  it('touches all four sides of its box and stays inside it, for every size from 2 x 3 to 40 x 40', () => {
    for (let columns = 2; columns <= 40; columns++) {
      for (let rows = 2; rows <= 40; rows++) {
        if (columns === 2 && rows === 2) continue;
        const picture = draw(20, 20, 20 + columns - 1, 20 + rows - 1, 1, true);
        const inside = crop(picture, 20, 20, 20 + columns, 20 + rows);
        const name = `${columns} x ${rows}`;
        expect(inside[0], name).toContain('#');
        expect(inside[rows - 1], name).toContain('#');
        expect(
          inside.some((row) => row[0] === '#'),
          name,
        ).toBe(true);
        expect(
          inside.some((row) => row[columns - 1] === '#'),
          name,
        ).toBe(true);
        const drawn = picture.join('').replace(/\./g, '').length;
        expect(inside.join('').replace(/\./g, '').length, name).toBe(drawn); // nothing outside the box
      }
    }
  }, 60_000);

  it('reports every pixel once, outline and interior apart, for pen widths 1-8', () => {
    for (let penWidth = 1; penWidth <= 8; penWidth++) {
      for (const [columns, rows] of [
        [1, 5],
        [2, 2],
        [3, 3],
        [4, 9],
        [10, 10],
        [16, 8],
        [20, 6],
        [33, 21],
      ] as const) {
        const picture = draw(25, 25, 25 + columns - 1, 25 + rows - 1, penWidth, true).join('');
        expect(picture, `${columns} x ${rows}, width ${penWidth}`).not.toContain('2');
      }
    }
  });

  it('an outline-only ellipse reports the same outline and no interior', () => {
    const filled = draw(10, 10, 40, 30, 1, true);
    const outline = draw(10, 10, 40, 30, 1, false);
    expect(outline).toEqual(filled.map((row) => row.replace(/R/g, '.')));
    expect(filled.join('')).toContain('R');
  });

  it('the outline of a one-pixel pen encloses the interior: no interior pixel touches the outside', () => {
    const picture = draw(10, 10, 47, 33, 1, true);
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        if ((picture[y] as string)[x] !== 'R') continue;
        const around = [
          (picture[y - 1] as string)[x],
          (picture[y + 1] as string)[x],
          (picture[y] as string)[x - 1],
          (picture[y] as string)[x + 1],
        ];
        expect(around, `(${x},${y})`).not.toContain('.');
      }
    }
  });

  it('a box far larger than the surface costs no more than the rows on the surface', () => {
    const calls: number[] = [];
    rasterEllipse(
      -32768,
      -32768,
      32767,
      32766,
      1,
      CLIP,
      (y) => calls.push(y),
      (y) => calls.push(y),
    );
    expect(calls.length).toBeLessThanOrEqual(3 * SIZE);
    for (const y of calls) expect(y >= 0 && y < SIZE).toBe(true);
  });
});
