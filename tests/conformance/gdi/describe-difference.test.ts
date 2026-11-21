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
import { OTHER_FONT_BYTES } from '../../oracle/gdi-capture/machine-dependent';
import { FONTS_DIR } from './fonts';
import { GOLDEN_DIR } from './golden';
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

  it('compares atlases of different glyph widths and counts the other-font glyphs apart', () => {
    const file = 'bitmap/Courier-16-u.bin';
    const reference = decodeAtlas(new Uint8Array(readFileSync(FONTS_DIR + file)));
    // The same atlas as captured on Windows Server 10.0.26100 (CI run 44919519853): wider glyphs,
    // because its fallback font draws the control bytes as wider boxes.
    const runner = decodeAtlas(new Uint8Array(readFileSync(`${GOLDEN_DIR}windows-10.0.26100/Courier-16-u.bin`)));
    expect(describeAtlas(reference, runner, OTHER_FONT_BYTES)).toEqual([
      'every glyph and advance of the face itself is equal',
      expect.stringMatching(/^24 other-font glyphs differ in \d+ pixels: \$00-\$08, \$0B, \$0E-\$1B$/),
      'glyphs 15 wide; the reference has 9',
    ]);
    // Without the list the same glyphs count as glyphs of the face.
    expect(describeAtlas(reference, runner)[0]).toMatch(/^24 glyphs differ in \d+ pixels: \$00-\$08, \$0B, \$0E-\$1B$/);
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
