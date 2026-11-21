// The measured pen nibs (pens.ts). Owner: SH2.

import { describe, expect, it } from 'vitest';
import { MAX_NIB_WIDTH, MIN_NIB_WIDTH, penNib } from './pens';

describe('penNib', () => {
  it('has a nib for every width 2-255 and none for others', () => {
    for (let w = MIN_NIB_WIDTH; w <= MAX_NIB_WIDTH; w++) expect(penNib(w).x.length).toBeGreaterThan(0);
    expect(() => penNib(1)).toThrow(RangeError);
    expect(() => penNib(256)).toThrow(RangeError);
  });

  it('every nib is convex, point-symmetric and in order of increasing angle', () => {
    for (let w = MIN_NIB_WIDTH; w <= MAX_NIB_WIDTH; w++) {
      const { x, y } = penNib(w);
      const n = x.length;
      for (let i = 0; i < n; i++) {
        expect([x[(i + n / 2) % n], y[(i + n / 2) % n]], `width ${w}, vertex ${i}`).toEqual([0 - x[i]!, 0 - y[i]!]);
        // Turning the same way at every vertex (y grows downwards: clockwise on the screen).
        const [ax, ay, bx, by, cx, cy] = [
          x[i]!,
          y[i]!,
          x[(i + 1) % n]!,
          y[(i + 1) % n]!,
          x[(i + 2) % n]!,
          y[(i + 2) % n]!,
        ];
        expect((bx - ax) * (cy - by) - (by - ay) * (cx - bx), `width ${w}, vertex ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it('holds the measured table (vertex counts, sizes and a checksum)', () => {
    let total = 0;
    let checksum = 0;
    const counts = new Set<number>();
    for (let w = MIN_NIB_WIDTH; w <= MAX_NIB_WIDTH; w++) {
      const { x, y } = penNib(w);
      counts.add(x.length);
      total += x.length;
      for (let i = 0; i < x.length; i++) checksum = (checksum * 31 + x[i]! * 7 + y[i]! * 13 + w) % 1_000_000_007;
      // From width 7 on, the axis vertices lie 8w - 1 sixteenths from the centre.
      if (w >= 7) expect(Math.max(...x), `width ${w}`).toBe(8 * w - 1);
    }
    expect([...counts].sort((a, b) => a - b)).toEqual([6, 8, 12, 16, 24, 32, 40, 48, 56]);
    // Computed from the raw capture (360 directions per width), not from this table.
    expect([total, checksum]).toEqual([8278, -415743821]);
  });
});
