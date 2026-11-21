// The glyph provider (ARCHITECTURE.md 3.5.1): the synthetic font set, written in the file formats
// of 6.5.3, goes through the loader, the atlas reader and the metric table reader, and comes out as
// cells and glyphs. Also: which atlas a font uses, and how a glyph reaches a cell no atlas has.
//
// This file uses the `plain` layout of the synthetic fonts: exactly what 6.5.3 describes, one atlas
// per face, cell and style, found by its file name. The layout of T2's real files (lists, raster
// rules) is in font-set.listed.test.ts.

import { beforeAll, describe, expect, it } from 'vitest';
import type { Bytes, FontSpec, Glyph } from '../../../contracts';
import { ATLAS_GLYPHS, decodeAtlas, encodeAtlas, trimGlyph, type FontAtlas } from './atlas';
import { AtlasGlyphProvider, expectedAtlasPaths, fontSetFromFiles, METRICS_FILE } from './atlas-provider';
import { atlasPath, FontSet, parseAtlasPath } from './font-set';
import { parseMetricTable, POINT_SIZES, serializeMetricTable, type MetricTable } from './metrics';
import { createSyntheticFontFiles, memoryFontLoader, SYNTHETIC_FONTS, syntheticMetricTable } from './synthetic';

const font = (name: string, size: number, style: Partial<FontSpec> = {}): FontSpec => ({
  name,
  size,
  bold: false,
  italic: false,
  underline: false,
  strikeOut: false,
  ...style,
});

/** A glyph as rows of '#' (full coverage), '+' (some) and '.' (none). */
const art = (glyph: Glyph): string[] =>
  Array.from({ length: glyph.height }, (_, y) =>
    Array.from({ length: glyph.width }, (_, x) => {
      const coverage = glyph.coverage[y * glyph.width + x] as number;
      return coverage === 255 ? '#' : coverage === 0 ? '.' : '+';
    }).join(''),
  );

let files: Map<string, Bytes>;
let fonts: FontSet;

beforeAll(() => {
  files = createSyntheticFontFiles({ layout: 'plain' });
  fonts = fontSetFromFiles(files);
}, 60_000);

describe('the synthetic font set is in the formats of 6.5.3', () => {
  it('has a metric table and atlases with the file names of 3.5.1', () => {
    const paths = [...files.keys()];
    expect(paths).toContain('metrics.json');
    for (const path of [
      'bitmap/Fixedsys-15.bin',
      'bitmap/Fixedsys-15-b.bin',
      'bitmap/Fixedsys-30-i.bin',
      'bitmap/Courier-13-u.bin',
      'bitmap/Courier-20-s.bin',
      'scalable/Courier New-16.bin',
      'scalable/Lucida Console-13-b.bin',
      'scalable/Consolas-15-i.bin',
      'scalable/Arial-15.bin',
      'scalable/Arial-110-s.bin',
    ]) {
      expect(paths, path).toContain(path);
    }
    // 2 + 3 raster cells and 4 x 12 outline sizes, in five styles each
    expect(paths.filter((path) => path.startsWith('bitmap/'))).toHaveLength(5 * 5);
    expect(paths.filter((path) => path.startsWith('scalable/'))).toHaveLength(4 * 12 * 5);
  });

  it('metrics.json has the seven font names of task 21, five styles and 256 sizes each', () => {
    const value = JSON.parse(new TextDecoder().decode(files.get(METRICS_FILE))) as {
      capturedOn: unknown;
      faces: string[];
      fonts: Record<string, Record<string, number[][]>>;
    };
    expect(value.faces).toEqual(['Fixedsys', 'Courier', 'Courier New', 'Lucida Console', 'Consolas', 'Arial']);
    expect(Object.keys(value.fonts)).toEqual([
      'Fixedsys',
      'Courier',
      'Courier New',
      'Lucida Console',
      'Lucida Sans Typerwriter',
      'Consolas',
      'Terminal',
    ]);
    expect(value.capturedOn).toBeDefined();
    for (const styles of Object.values(value.fonts)) {
      expect(Object.keys(styles)).toEqual(['plain', 'bold', 'italic', 'underline', 'strikeOut']);
      for (const rows of Object.values(styles)) expect(rows).toHaveLength(POINT_SIZES);
    }
    expect(value.fonts['Fixedsys']?.['plain']?.[9]).toEqual([8, 15, 0]);
    expect(value.fonts['Terminal']?.['plain']?.[9]).toEqual([11, 14, 5]);
  });

  it('every atlas file decodes, and encodes again to the same bytes', () => {
    let atlases = 0;
    for (const [path, bytes] of files) {
      if (path === METRICS_FILE) continue;
      const atlas = decodeAtlas(bytes);
      expect(Buffer.from(encodeAtlas(atlas)).equals(Buffer.from(bytes)), path).toBe(true);
      // the file name gives the cell height, the folder the kind of face
      expect(parseAtlasPath(path)?.height, path).toBe(atlas.cellHeight);
      expect(atlas.eightBit, path).toBe(path.startsWith('scalable/'));
      atlases++;
    }
    expect(atlases).toBe(265);
  }, 60_000);

  it('the metric table reads back and writes again to the same text', () => {
    const text = new TextDecoder().decode(files.get(METRICS_FILE));
    const table = parseMetricTable(text);
    expect(serializeMetricTable(table)).toBe(text);
    expect(serializeMetricTable(syntheticMetricTable('plain'))).toBe(text);
  });

  it('the file names 3.5.1 describes cover every atlas of the set', () => {
    const expected = expectedAtlasPaths(parseMetricTable(files.get(METRICS_FILE) as Bytes));
    const present = [...files.keys()].filter((path) => path !== METRICS_FILE);
    for (const path of present) expect(expected, path).toContain(path);
    // The only expected files the set does not have are the two raster cells left out on purpose.
    const missing = expected.filter((path) => !files.has(path));
    expect(missing.every((path) => /^bitmap\/(Fixedsys-45|Courier-40)(-[bius])?\.bin$/.test(path))).toBe(true);
    expect(missing).toHaveLength(10);
  });
});

describe('AtlasGlyphProvider loads the set through a file loader', () => {
  it('answers with the default cell and empty glyphs until the files are in memory', async () => {
    const provider = new AtlasGlyphProvider(memoryFontLoader(files));
    expect(provider.loaded).toBe(false);
    expect(provider.metrics(font('Courier New', 18))).toEqual({ colWidth: 8, rowHeight: 15 });
    const blank = provider.glyph(font('Courier New', 18), 0x41);
    expect(blank).toMatchObject({ advance: 8, width: 8, height: 15 });
    expect(blank.coverage.every((value) => value === 0)).toBe(true);

    await provider.ready;
    expect(provider.loaded).toBe(true);
    expect(provider.problems).toEqual([]);
    expect(provider.metrics(font('Courier New', 18))).toEqual({ colWidth: 14, rowHeight: 27 });
  });

  it('round trip: the glyph it gives is the glyph of the atlas file', async () => {
    const provider = new AtlasGlyphProvider(memoryFontLoader(files));
    await provider.ready;
    const cases: [FontSpec, string][] = [
      [font('Fixedsys', 9), 'bitmap/Fixedsys-15.bin'],
      [font('Fixedsys', 18, { bold: true }), 'bitmap/Fixedsys-30-b.bin'],
      [font('Courier', 12, { underline: true }), 'bitmap/Courier-16-u.bin'],
      [font('Courier New', 10, { italic: true }), 'scalable/Courier New-16-i.bin'],
      [font('Consolas', 14, { strikeOut: true }), 'scalable/Consolas-22-s.bin'],
      [font('Lucida Sans Typerwriter', 12), 'scalable/Arial-18.bin'],
    ];
    for (const [spec, path] of cases) {
      const atlas = decodeAtlas(files.get(path) as Bytes);
      expect(provider.metrics(spec), path).toEqual({ colWidth: atlas.cellWidth, rowHeight: atlas.cellHeight });
      for (const ch of [0x00, 0x20, 0x41, 0x5f, 0x67, 0x7f, 0xe9, 0xff]) {
        const expected = trimGlyph(
          atlas.coverage(ch),
          atlas.glyphWidth,
          atlas.cellHeight,
          atlas.advances[ch] as number,
        );
        const glyph = provider.glyph(spec, ch);
        expect({ ...glyph, coverage: [...glyph.coverage] }, `${path} glyph ${ch}`).toEqual({
          ...expected,
          coverage: [...expected.coverage],
        });
      }
    }
  });

  it('asks for metrics.json first and then for the atlases 3.5.1 describes; missing ones are skipped', async () => {
    const asked: string[] = [];
    const provider = new AtlasGlyphProvider((path) => {
      asked.push(path);
      return memoryFontLoader(files)(path);
    });
    await provider.ready;
    // metrics.json, then the list of outline atlases (this set has none), then the derived names
    expect(asked.slice(0, 2)).toEqual(['metrics.json', 'scalable/index.json']);
    expect(asked.slice(2).sort()).toEqual(expectedAtlasPaths(syntheticMetricTable('plain')));
    expect(provider.problems).toEqual([]);
  });

  it('takes the list from the caller when given, and reports a listed file that is missing', async () => {
    const provider = new AtlasGlyphProvider(memoryFontLoader(files), {
      atlasPaths: ['bitmap/Fixedsys-15.bin', 'bitmap/Nothing-15.bin'],
    });
    await provider.ready;
    expect(provider.problems).toEqual(['bitmap/Nothing-15.bin: the file is missing']);
    expect(provider.glyph(font('Fixedsys', 9), 0x41).coverage.some((value) => value !== 0)).toBe(true);
    // no Courier atlas was loaded: the measured cell, empty
    const courier = provider.glyph(font('Courier', 10), 0x41);
    expect(courier).toMatchObject({ advance: 8, width: 8, height: 13 });
    expect(courier.coverage.every((value) => value === 0)).toBe(true);
  });

  it('ready rejects when the metric table is missing or unreadable; the default cell stays', async () => {
    const none = new AtlasGlyphProvider(() => Promise.resolve(null));
    await expect(none.ready).rejects.toThrow('The output fonts could not be loaded: fonts/metrics.json is missing.');
    expect(none.loaded).toBe(false);
    expect(none.problems).toEqual(['The output fonts could not be loaded: fonts/metrics.json is missing.']);
    expect(none.metrics(font('Fixedsys', 9))).toEqual({ colWidth: 8, rowHeight: 15 });

    const broken = new AtlasGlyphProvider(() => Promise.resolve(new TextEncoder().encode('{"faces": 1}')));
    await expect(broken.ready).rejects.toThrow(/metrics\.json: "faces" must be a list/);

    const offline = new AtlasGlyphProvider(() => Promise.reject(new Error('network down')));
    await expect(offline.ready).rejects.toThrow('network down');
  });

  it('an atlas whose loading fails is reported and leaves the other fonts usable', async () => {
    const provider = new AtlasGlyphProvider((path) =>
      path === 'bitmap/Courier-13.bin' ? Promise.reject(new Error('network down')) : memoryFontLoader(files)(path),
    );
    await provider.ready;
    expect(provider.problems).toEqual(['bitmap/Courier-13.bin: network down']);
    expect(provider.glyph(font('Fixedsys', 9), 0x41).coverage.some((value) => value !== 0)).toBe(true);
    // Courier 10 (8 x 13) has lost its atlas: the nearest other one is used
    expect(provider.metrics(font('Courier', 10))).toEqual({ colWidth: 8, rowHeight: 13 });
  });

  it('a damaged atlas is reported and leaves the other fonts usable', async () => {
    const damaged = new Map(files);
    damaged.set('bitmap/Courier-13.bin', Uint8Array.from([1, 2, 3]));
    const provider = new AtlasGlyphProvider(memoryFontLoader(damaged));
    await provider.ready;
    expect(provider.problems).toEqual(['bitmap/Courier-13.bin: not a font atlas: the file does not start with "E68F"']);
    expect(provider.glyph(font('Fixedsys', 9), 0x41).coverage.some((value) => value !== 0)).toBe(true);
  });
});

describe('metrics(font): a table lookup', () => {
  it('the default font is 8 x 15 (trap15-a §3.2), and 16 x 30 at 18 points (trap15-b §5.7)', () => {
    expect(fonts.metrics(font('Fixedsys', 9))).toEqual({ colWidth: 8, rowHeight: 15 });
    expect(fonts.metrics(font('Fixedsys', 16))).toEqual({ colWidth: 8, rowHeight: 15 });
    expect(fonts.metrics(font('Fixedsys', 18))).toEqual({ colWidth: 16, rowHeight: 30 });
  });

  it('every font name of task 21 has its cell at every size, also 0 and 255', () => {
    const at = (name: string, size: number) => {
      const { colWidth, rowHeight } = fonts.metrics(font(name, size));
      return `${colWidth}x${rowHeight}`;
    };
    expect(
      Object.keys(SYNTHETIC_FONTS).map((name) => `${name}: ${at(name, 10)} ${at(name, 0)} ${at(name, 255)}`),
    ).toEqual([
      'Fixedsys: 8x15 8x15 24x45',
      'Courier: 8x13 8x13 24x40',
      'Courier New: 8x16 10x18 204x385',
      'Lucida Console: 8x13 10x16 204x340',
      'Lucida Sans Typerwriter: 12x15 15x18 320x391',
      'Consolas: 7x15 9x19 187x398',
      'Terminal: 12x15 15x18 320x391',
    ]);
  });

  it('a style can have cells of its own', () => {
    expect(fonts.metrics(font('Terminal', 10)).colWidth).toBe(12);
    expect(fonts.metrics(font('Terminal', 10, { bold: true })).colWidth).toBe(13);
  });

  it('a name that is not in the table has the cells of the default font name; letter case does not matter', () => {
    expect(fonts.hasFont('Comic Sans MS')).toBe(false);
    expect(fonts.metrics(font('Comic Sans MS', 18))).toEqual({ colWidth: 16, rowHeight: 30 });
    expect(fonts.hasFont('courier new')).toBe(true);
    expect(fonts.metrics(font('COURIER NEW', 10))).toEqual({ colWidth: 8, rowHeight: 16 });
  });

  it('a size outside 0-255 is the nearest size of the table', () => {
    expect(fonts.metrics(font('Courier New', 300))).toEqual(fonts.metrics(font('Courier New', 255)));
    expect(fonts.metrics(font('Courier New', -1))).toEqual(fonts.metrics(font('Courier New', 0)));
  });
});

describe('glyph(font, ch)', () => {
  it('the synthetic letters are legible: A of the default font', () => {
    const glyph = fonts.glyph(font('Fixedsys', 9), 0x41);
    expect(glyph).toMatchObject({ advance: 8, width: 8, height: 15 });
    expect(art(glyph)).toEqual([
      '........',
      '........',
      '........',
      '........',
      '..###...',
      '.#...#..',
      '.#...#..',
      '.#####..',
      '.#...#..',
      '.#...#..',
      '.#...#..',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(fonts.atlasOf(font('Fixedsys', 9))).toBe('bitmap/Fixedsys-15.bin');
  });

  it('every byte has a glyph, and every glyph of a fixed-pitch face advances by the cell width', () => {
    const pictures = new Set<string>();
    for (let ch = 0; ch < ATLAS_GLYPHS; ch++) {
      const glyph = fonts.glyph(font('Fixedsys', 9), ch);
      expect(glyph.advance).toBe(8);
      expect(glyph.coverage).toHaveLength(glyph.width * glyph.height);
      pictures.add(art(glyph).join('\n'));
    }
    // every byte looks different, except that the space is the only empty one
    expect(pictures.size).toBe(256);
  });

  it('gives the same object again', () => {
    expect(fonts.glyph(font('Courier', 12), 0x42)).toBe(fonts.glyph(font('Courier', 12), 0x42));
  });

  it('the styles look different; an italic glyph is wider than its advance', () => {
    const plain = fonts.glyph(font('Fixedsys', 9), 0x48);
    const bold = fonts.glyph(font('Fixedsys', 9, { bold: true }), 0x48);
    const italic = fonts.glyph(font('Fixedsys', 9, { italic: true }), 0x48);
    const underline = fonts.glyph(font('Fixedsys', 9, { underline: true }), 0x48);
    const strike = fonts.glyph(font('Fixedsys', 9, { strikeOut: true }), 0x48);
    const pictures = [plain, bold, italic, underline, strike].map((glyph) => art(glyph).join('\n'));
    expect(new Set(pictures).size).toBe(5);
    expect(plain.width).toBe(8);
    // The top of the italic H leans one pixel beyond the cell: the glyph is wider than its advance.
    expect(italic).toMatchObject({ advance: 8, width: 9, height: 15 });
    expect(art(italic).slice(4, 11)).toEqual([
      '....#...#',
      '....#...#',
      '....#...#',
      '...#####.',
      '...#...#.',
      '...#...#.',
      '...#...#.',
    ]);
    // An italic glyph without ink at its top right stays inside the cell.
    expect(fonts.glyph(font('Fixedsys', 9, { italic: true }), 0x4c).width).toBe(8); // L
    expect(art(underline)[12]).toBe('########');
    expect(art(strike)[7]).toBe('########');
  });

  it('the two names that resolve to a proportional face: advances differ, the cell is the width of W', () => {
    for (const name of ['Lucida Sans Typerwriter', 'Terminal']) {
      const spec = font(name, 12);
      expect(fonts.atlasOf(spec)).toBe('scalable/Arial-18.bin');
      const { colWidth } = fonts.metrics(spec);
      expect(colWidth).toBe(15);
      expect(fonts.glyph(spec, 0x57).advance).toBe(15); // W
      expect(fonts.glyph(spec, 0x69).advance).toBe(10); // i: three columns of ink
      expect(fonts.glyph(spec, 0x21).advance).toBe(5); // !: one column
      expect(fonts.glyph(spec, 0x69).width).toBe(10);
      expect(fonts.glyph(spec, 0x69).height).toBe(18);
    }
  });

  it('size byte 0: the cell the table gives for size 0, drawn from the atlas with that cell', () => {
    const spec = font('Courier New', 0);
    expect(fonts.metrics(spec)).toEqual({ colWidth: 10, rowHeight: 18 });
    expect(fonts.atlasOf(spec)).toBe('scalable/Courier New-18.bin');
    expect(fonts.glyph(spec, 0x41)).toMatchObject({ advance: 10, width: 10, height: 18 });
  });

  it('a size outside the atlas sizes: the nearest atlas, resampled to the measured cell by area averaging', () => {
    const spec = font('Courier New', 20);
    expect(fonts.metrics(spec)).toEqual({ colWidth: 16, rowHeight: 31 });
    // 18 points is 14 x 27, 24 points is 19 x 36: 27 is nearer to 31
    expect(fonts.atlasOf(spec)).toBe('scalable/Courier New-27.bin');
    const glyph = fonts.glyph(spec, 0x41);
    expect(glyph).toMatchObject({ advance: 16, width: 16, height: 31 });
    expect(glyph.coverage).toHaveLength(16 * 31);
    const levels = new Set(glyph.coverage);
    expect(levels.has(0) && levels.has(255) && levels.size > 3).toBe(true);
    // a small size is resampled down from the smallest atlas
    const tiny = font('Courier New', 3);
    expect(fonts.metrics(tiny)).toEqual({ colWidth: 2, rowHeight: 5 });
    expect(fonts.atlasOf(tiny)).toBe('scalable/Courier New-14.bin');
    expect(fonts.glyph(tiny, 0x41)).toMatchObject({ advance: 2, width: 2, height: 5 });
    // and a very large one up from the largest
    const huge = font('Courier New', 255);
    expect(fonts.atlasOf(huge)).toBe('scalable/Courier New-109.bin');
    expect(fonts.glyph(huge, 0x41)).toMatchObject({ advance: 204, height: 385 });
  });

  it('a raster face without an atlas for the cell: whole-number pixel repetition, as Windows does', () => {
    // 24 x 45 is three times 8 x 15. The 16 x 30 atlas is nearer, but 24 x 45 is not a whole multiple of it.
    const spec = font('Fixedsys', 40);
    expect(fonts.metrics(spec)).toEqual({ colWidth: 24, rowHeight: 45 });
    expect(fonts.atlasOf(spec)).toBe('bitmap/Fixedsys-15.bin');
    const small = fonts.glyph(font('Fixedsys', 9), 0x41);
    const large = fonts.glyph(spec, 0x41);
    expect(large).toMatchObject({ advance: 24, width: 24, height: 45 });
    for (let y = 0; y < 45; y++) {
      for (let x = 0; x < 24; x++) {
        expect(large.coverage[y * 24 + x]).toBe(small.coverage[Math.floor(y / 3) * 8 + Math.floor(x / 3)]);
      }
    }
    // Courier 24 x 40 is twice 12 x 20; an italic glyph keeps its overhang, doubled
    const courier = font('Courier', 30, { italic: true });
    expect(fonts.atlasOf(courier)).toBe('bitmap/Courier-20-i.bin');
    const base = fonts.glyph(font('Courier', 15, { italic: true }), 0x48);
    const doubled = fonts.glyph(courier, 0x48);
    expect(doubled).toMatchObject({ advance: 24, width: base.width * 2, height: 40 });
    expect(new Set(doubled.coverage)).toEqual(new Set([0, 255]));
  });
});

describe('which atlas a font uses', () => {
  /** A table with one font name whose cell is the same at every size, and atlases of the given cells. */
  function miniSet(cell: [number, number], atlasCells: [string, number, number, boolean][], faces = ['Face']): FontSet {
    const row = new Uint16Array(POINT_SIZES * 3);
    for (let size = 0; size < POINT_SIZES; size++) row.set([cell[0], cell[1], 0], size * 3);
    const table: MetricTable = {
      capturedOn: null,
      faces,
      fonts: new Map([['Face', { plain: row, bold: row, italic: row, underline: row, strikeOut: row }]]),
    };
    return new FontSet(
      table,
      atlasCells.map(([path, cellWidth, cellHeight, eightBit]) => ({
        path,
        atlas: {
          cellWidth,
          cellHeight,
          glyphWidth: cellWidth,
          eightBit,
          advances: new Uint8Array(ATLAS_GLYPHS).fill(cellWidth),
          coverage: () => new Uint8Array(cellWidth * cellHeight).fill(255),
        } satisfies FontAtlas,
      })),
    );
  }

  it('the atlas with the measured cell, when there is one', () => {
    const set = miniSet(
      [9, 16],
      [
        ['bitmap/Face-13.bin', 8, 13, false],
        ['bitmap/Face-16.bin', 9, 16, false],
        ['bitmap/Face-20.bin', 12, 20, false],
      ],
    );
    expect(set.atlasOf(font('Face', 9))).toBe('bitmap/Face-16.bin');
  });

  it('else the nearest height, then the nearest width, then the larger atlas', () => {
    expect(
      miniSet(
        [10, 18],
        [
          ['scalable/Face-13.bin', 8, 13, true],
          ['scalable/Face-20.bin', 12, 20, true],
        ],
      ).atlasOf(font('Face', 9)),
    ).toBe('scalable/Face-20.bin');
    // equally far in height: 17 is two below 19 and 21 is two above; the widths decide
    expect(
      miniSet(
        [11, 19],
        [
          ['scalable/Face-17.bin', 9, 17, true],
          ['scalable/Face-21.bin', 11, 21, true],
        ],
      ).atlasOf(font('Face', 9)),
    ).toBe('scalable/Face-21.bin');
    // equally far in both: the larger one
    expect(
      miniSet(
        [10, 19],
        [
          ['scalable/Face-17.bin', 9, 17, true],
          ['scalable/Face-21.bin', 11, 21, true],
        ],
      ).atlasOf(font('Face', 9)),
    ).toBe('scalable/Face-21.bin');
  });

  it('a raster face prefers an atlas the cell is a whole multiple of, and is averaged when there is none', () => {
    const multiple = miniSet(
      [16, 30],
      [
        ['bitmap/Face-15.bin', 8, 15, false],
        ['bitmap/Face-28.bin', 15, 28, false],
      ],
    );
    expect(multiple.atlasOf(font('Face', 9))).toBe('bitmap/Face-15.bin');
    // an outline face has no such preference
    const outline = miniSet(
      [16, 30],
      [
        ['scalable/Face-15.bin', 8, 15, true],
        ['scalable/Face-28.bin', 15, 28, true],
      ],
    );
    expect(outline.atlasOf(font('Face', 9))).toBe('scalable/Face-28.bin');
    // 12 x 22 is no whole multiple of 8 x 15: area averaging, and a full cell stays full
    const averaged = miniSet([12, 22], [['bitmap/Face-15.bin', 8, 15, false]]);
    const glyph = averaged.glyph(font('Face', 9), 0x41);
    expect(glyph).toMatchObject({ advance: 12, width: 12, height: 22 });
    expect(glyph.coverage.every((value) => value === 255)).toBe(true);
  });

  it('a style without an atlas is drawn with the plain atlas of the face', () => {
    const set = miniSet([8, 15], [['bitmap/Face-15.bin', 8, 15, false]]);
    expect(set.atlasOf(font('Face', 9, { bold: true }))).toBe('bitmap/Face-15.bin');
    const styled = miniSet(
      [8, 15],
      [
        ['bitmap/Face-15.bin', 8, 15, false],
        ['bitmap/Face-15-b.bin', 8, 15, false],
      ],
    );
    expect(styled.atlasOf(font('Face', 9, { bold: true }))).toBe('bitmap/Face-15-b.bin');
    expect(styled.atlasOf(font('Face', 9, { italic: true }))).toBe('bitmap/Face-15.bin');
  });

  it('a face without any atlas has empty glyphs of the measured cell', () => {
    const set = miniSet([7, 12], []);
    expect(set.atlasOf(font('Face', 9))).toBeNull();
    const glyph = set.glyph(font('Face', 9), 0x41);
    expect(glyph).toMatchObject({ advance: 7, width: 7, height: 12 });
    expect(glyph.coverage.every((value) => value === 0)).toBe(true);
  });

  it('an atlas whose name is no face of the table is reported; face names compare without case, spaces or hyphens', () => {
    const set = miniSet(
      [8, 15],
      [
        ['bitmap/Other-15.bin', 8, 15, false],
        ['odd name', 8, 15, false],
      ],
    );
    expect(set.problems).toEqual([
      'bitmap/Other-15.bin: not an atlas of a face of the metric table',
      'odd name: not an atlas of a face of the metric table',
    ]);
    const spaced = miniSet([8, 15], [['scalable/courier-new-15.bin', 8, 15, true]], ['Courier New']);
    expect(spaced.problems).toEqual([]);
    expect(spaced.atlasOf(font('Face', 9))).toBe('scalable/courier-new-15.bin');
  });

  it('a table entry without width or height is drawn as one pixel instead of failing', () => {
    const set = miniSet([0, 0], []);
    expect(set.metrics(font('Face', 9))).toEqual({ colWidth: 1, rowHeight: 1 });
  });
});

describe('atlas file names', () => {
  it('<folder>/<face>-<height>[-<style>].bin', () => {
    expect(atlasPath('bitmap', 'Fixedsys', 15, 'plain')).toBe('bitmap/Fixedsys-15.bin');
    expect(atlasPath('scalable', 'Courier New', 16, 'bold')).toBe('scalable/Courier New-16-b.bin');
    expect(atlasPath('scalable', 'Arial', 110, 'strikeOut')).toBe('scalable/Arial-110-s.bin');
    expect(parseAtlasPath('scalable/Courier New-16-i.bin')).toEqual({
      folder: 'scalable',
      face: 'Courier New',
      height: 16,
      style: 'italic',
    });
    expect(parseAtlasPath('bitmap/Fixedsys-15.bin')).toEqual({
      folder: 'bitmap',
      face: 'Fixedsys',
      height: 15,
      style: 'plain',
    });
    expect(parseAtlasPath('Lucida-Console-13-u.bin')).toEqual({
      folder: '',
      face: 'Lucida-Console',
      height: 13,
      style: 'underline',
    });
    expect(parseAtlasPath('metrics.json')).toBeNull();
    expect(parseAtlasPath('bitmap/Fixedsys.bin')).toBeNull();
  });
});
