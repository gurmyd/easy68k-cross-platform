// The difference descriptions `npm run oracle:gdi` prints on another Windows
// (tests/oracle/gdi-capture/describe-difference.ts). Runs on every system. Owner: T2.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  byteRanges,
  describeAtlas,
  describeJson,
  describePack,
  describeTsv,
} from '../../oracle/gdi-capture/describe-difference';
import { FONTS_DIR } from './fonts';
import { decodeAtlas } from './pix';

describe('what differs between a reference and a capture', () => {
  it('names bytes as ranges', () => {
    expect(byteRanges([0x41, 0x42, 0x43, 0x7f, 0xe9, 0xea])).toBe('$41-$43, $7F, $E9-$EA');
    expect(byteRanges([])).toBe('');
  });

  it('names the glyphs and advances of a raster atlas that differ', () => {
    const bytes = new Uint8Array(readFileSync(FONTS_DIR + 'bitmap/Fixedsys-15.bin'));
    const reference = decodeAtlas(bytes);
    expect(describeAtlas(reference, decodeAtlas(bytes))).toEqual([
      'same glyphs and advances (the file differs elsewhere)',
    ]);
    const changed = bytes.slice();
    const glyphBytes = Math.ceil(reference.glyphWidth / 8) * reference.cellHeight;
    changed[9 + 0x41] = 9; // advance of "A"
    changed[9 + 256 + 0x41 * glyphBytes] = (changed[9 + 256 + 0x41 * glyphBytes] as number) ^ 0x80; // one pixel of "A"
    changed[9 + 256 + 0x42 * glyphBytes] = (changed[9 + 256 + 0x42 * glyphBytes] as number) ^ 0xc0; // two of "B"
    expect(describeAtlas(reference, decodeAtlas(changed))).toEqual([
      '2 glyphs differ in 3 pixels: $41-$42',
      `1 advances differ: $41 ${reference.advances[0x41]}->9`,
    ]);
  });

  it('names the JSON paths that differ, with both values', () => {
    const a = { fonts: { Courier: { italic: [[9, 16, 1]] } }, raster: { cells: [{ face: 'Courier', kx: 1 }] } };
    const b = {
      fonts: { Courier: { italic: [[9, 17, 1]] } },
      raster: { cells: [{ face: 'Courier', kx: 1, ruleHolds: false }] },
    };
    expect(describeJson(a, b)).toEqual([
      '.fonts.Courier.italic[0]: [9,16,1] -> [9,17,1]',
      '.raster.cells[0].ruleHolds: undefined -> false',
    ]);
    expect(
      describeJson(
        { x: Array.from({ length: 30 }, () => ({ v: 1 })) },
        { x: Array.from({ length: 30 }, () => ({ v: 2 })) },
        3,
      ),
    ).toEqual(['.x[0].v: 1 -> 2', '.x[1].v: 1 -> 2', '.x[2].v: 1 -> 2', '... 27 more']);
  });

  it('names the cases of a pack that differ', () => {
    const c = (id: string, pen: [number, number], pix: number[]) => ({ id, pen, pix: Uint8Array.from(pix) });
    const reference = { cases: [c('a', [0, 0], [1]), c('b', [1, 1], [2]), c('c', [2, 2], [3])] };
    const captured = { cases: [c('a', [0, 0], [1]), c('b', [1, 2], [2]), c('c', [2, 2], [4])] };
    expect(describePack(reference, captured)).toEqual([
      '2 of 3 cases differ (1 in the pen position)',
      'b (pen only), c',
    ]);
  });

  it('names the rows of a table that differ', () => {
    expect(describeTsv('# h\nA\t-\t8\t1\nA\t-\t9\t2\n', '# h\nA\t-\t8\t1\nA\t-\t9\t3\n')).toEqual([
      '1 rows differ: A - 9',
    ]);
  });
});
