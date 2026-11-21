// The glyph provider with a font set in the layout of T2's real files (docs/porting/errata/T2.md):
// `metrics.json` lists the raster atlases and states how Windows makes every raster cell and style
// from the native bitmaps; `scalable/index.json` lists the outline atlases and gives the underline
// and strike-out line of each plain one.
//
// The rules are checked twice: on a tiny hand-made set whose pictures can be read in the test, and
// on the synthetic set of fonts/synthetic.ts (the default `listed` layout).

import { beforeAll, describe, expect, it } from 'vitest';
import type { Bytes, FontSpec, Glyph } from '../../../contracts';
import { ATLAS_GLYPHS, decodeAtlas, type FontAtlas } from './atlas';
import { AtlasGlyphProvider, fontSetFromFiles, METRICS_FILE, OUTLINE_INDEX_FILE } from './atlas-provider';
import { FontSet, rasterOverhang, type AtlasFile } from './font-set';
import {
  parseMetricTable,
  parseOutlineIndex,
  POINT_SIZES,
  type FontStyle,
  type MetricTable,
  type RasterCell,
} from './metrics';
import { createSyntheticFontFiles, memoryFontLoader } from './synthetic';

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

// ---- a tiny raster face ----------------------------------------------------------------------------

/** A 3 x 4 raster atlas: byte $41 is the picture below, byte $01 a full block, byte $02 has advance 0. */
const NATIVE_A = ['#.#', '###', '#.#', '...'];
function tinyAtlas(): FontAtlas {
  const advances = new Uint8Array(ATLAS_GLYPHS).fill(3);
  advances[0x02] = 0;
  const glyphs = new Map<number, Uint8Array>([
    [0x41, Uint8Array.from(NATIVE_A.join(''), (ch) => (ch === '#' ? 255 : 0))],
    [0x01, new Uint8Array(12).fill(255)],
  ]);
  return {
    cellWidth: 3,
    cellHeight: 4,
    glyphWidth: 3,
    eightBit: false,
    advances,
    coverage: (ch) => glyphs.get(ch) ?? new Uint8Array(12),
  };
}

/** A table with one font name, `Tiny`, a raster face: 3 x 4 at sizes below 100, 6 x 8 from 100 on (bold one wider). */
function tinySet(
  options: { native?: boolean; stored?: AtlasFile; cells?: (cell: RasterCell) => RasterCell } = {},
): FontSet {
  const row = (extra: number) => {
    const entries = new Uint16Array(POINT_SIZES * 3);
    for (let size = 0; size < POINT_SIZES; size++)
      entries.set(size < 100 ? [3 + extra, 4, 0] : [6 + extra, 8, 0], size * 3);
    return entries;
  };
  const cells: RasterCell[] = [];
  for (const [width, height, k] of [
    [3, 4, 1],
    [6, 8, 2],
  ] as const) {
    for (const style of ['plain', 'bold', 'italic', 'underline', 'strikeOut'] as const) {
      const lined = style === 'underline' || style === 'strikeOut';
      const cell: RasterCell = {
        face: 'Tiny',
        style,
        plainCell: [width, height],
        native: 'bitmap/Tiny-4.bin',
        kx: k,
        ky: k,
        atlas: options.stored && style === 'bold' && k === 1 ? options.stored.path : null,
        lineRows: !lined ? [] : style === 'underline' ? Array.from({ length: k }, (_, i) => 3 * k + i) : [k],
        lineExceptions: lined ? { 0x09: 0, 0x00: 2 * k } : {},
      };
      cells.push(options.cells ? options.cells(cell) : cell);
    }
  }
  const table: MetricTable = {
    capturedOn: null,
    faces: ['Tiny'],
    faceKinds: ['raster'],
    fonts: new Map([['Tiny', { plain: row(0), bold: row(1), italic: row(0), underline: row(0), strikeOut: row(0) }]]),
    raster: { atlases: [], cells },
  };
  const files: AtlasFile[] = [];
  if (options.native !== false) {
    files.push({ path: 'bitmap/Tiny-4.bin', atlas: tinyAtlas(), face: 'Tiny', style: 'plain', blankBytes: [0x01] });
  }
  if (options.stored) files.push(options.stored);
  return new FontSet(table, files);
}

describe('a raster face is made as Windows makes it (docs/porting/errata/T2.md item 2)', () => {
  const tiny = tinySet();
  const glyph = (size: number, style: Partial<FontSpec>, ch = 0x41) => tiny.glyph(font('Tiny', size, style), ch);

  it('plain: the native bitmap, every pixel repeated kx by ky times', () => {
    expect(art(glyph(9, {}))).toEqual(NATIVE_A);
    expect(art(glyph(100, {}))).toEqual([
      '##..##',
      '##..##',
      '######',
      '######',
      '##..##',
      '##..##',
      '......',
      '......',
    ]);
    expect(glyph(100, {}).advance).toBe(6);
  });

  it('bold: the enlarged glyph OR itself one pixel to the right, and the advance one more - not the native bold enlarged', () => {
    expect(art(glyph(9, { bold: true }))).toEqual(['####', '####', '####', '....']);
    expect(glyph(9, { bold: true }).advance).toBe(4);
    // at twice the size the glyph is one pixel wider, not two
    expect(art(glyph(100, { bold: true }))).toEqual([
      '###.###',
      '###.###',
      '#######',
      '#######',
      '###.###',
      '###.###',
      '.......',
      '.......',
    ]);
    expect(glyph(100, { bold: true }).advance).toBe(7);
    expect(tiny.metrics(font('Tiny', 100, { bold: true }))).toEqual({ colWidth: 7, rowHeight: 8 });
  });

  it('bold: a byte whose native advance is 0 stays at 0', () => {
    expect(glyph(9, { bold: true }, 0x02).advance).toBe(0);
    expect(glyph(9, {}, 0x02).advance).toBe(0);
  });

  it('italic: row y of the enlarged glyph moves right by floor((h - 1) / 2) - floor(y / 2); the advance stays', () => {
    // h = 4: rows 0 and 1 move one pixel, rows 2 and 3 none
    expect(art(glyph(9, { italic: true }))).toEqual(['.#.#', '.###', '#.#.', '....']);
    expect(glyph(9, { italic: true })).toMatchObject({ advance: 3, width: 4 });
    // h = 8: rows 0-1 move three pixels, 2-3 two, 4-5 one, 6-7 none
    expect(art(glyph(100, { italic: true }))).toEqual([
      '...##..##',
      '...##..##',
      '..######.',
      '..######.',
      '.##..##..',
      '.##..##..',
      '.........',
      '.........',
    ]);
    expect(glyph(100, { italic: true })).toMatchObject({ advance: 6, width: 9 });
  });

  it('underline and strike-out: the plain glyph plus the rows of the rule across the advance', () => {
    expect(art(glyph(9, { underline: true }))).toEqual(['#.#', '###', '#.#', '###']);
    expect(art(glyph(9, { strikeOut: true }))).toEqual(['#.#', '###', '#.#', '...']); // row 1 is ink anyway
    expect(art(glyph(100, { underline: true }))).toEqual([
      '##..##',
      '##..##',
      '######',
      '######',
      '##..##',
      '##..##',
      '######',
      '######',
    ]);
    expect(art(glyph(100, { strikeOut: true }, 0x20))).toEqual([
      '......',
      '......',
      '######',
      '......',
      '......',
      '......',
      '......',
      '......',
    ]);
  });

  it('underline: a byte listed in the exceptions has a line of the given length, often none', () => {
    expect(art(glyph(9, { underline: true }, 0x09))).toEqual(['...', '...', '...', '...']);
    expect(art(glyph(9, { underline: true }, 0x00))).toEqual(['...', '...', '...', '##.']);
    expect(art(glyph(100, { underline: true }, 0x00))[7]).toBe('####..');
  });

  it('a byte the set stores empty is drawn empty, in every style; its line is still drawn', () => {
    expect(art(glyph(9, {}, 0x01))).toEqual(['...', '...', '...', '...']);
    expect(art(glyph(100, { bold: true }, 0x01)).every((row) => !row.includes('#'))).toBe(true);
    expect(art(glyph(9, { underline: true }, 0x01))).toEqual(['...', '...', '...', '###']);
    expect(glyph(9, {}, 0x01).advance).toBe(3);
  });

  it('the style overhang of the opaque box: 1 for bold, floor((h - 1) / 2) for italic, none otherwise', () => {
    expect(tiny.textOverhang(font('Tiny', 9))).toBe(0);
    expect(tiny.textOverhang(font('Tiny', 9, { bold: true }))).toBe(1);
    expect(tiny.textOverhang(font('Tiny', 9, { italic: true }))).toBe(1);
    expect(tiny.textOverhang(font('Tiny', 100, { italic: true }))).toBe(3);
    expect(tiny.textOverhang(font('Tiny', 9, { underline: true }))).toBe(0);
    expect([
      rasterOverhang('bold', 15),
      rasterOverhang('italic', 15),
      rasterOverhang('italic', 30),
      rasterOverhang('plain', 15),
    ]).toEqual([1, 7, 14, 0]);
  });

  it('the rule from the native atlas comes before an atlas stored for the cell; the stored one serves without it', () => {
    const stored: AtlasFile = {
      path: 'bitmap/Tiny-4-b.bin',
      face: 'Tiny',
      style: 'bold',
      atlas: {
        ...tinyAtlas(),
        cellWidth: 4,
        glyphWidth: 4,
        advances: new Uint8Array(ATLAS_GLYPHS).fill(4),
        coverage: () => new Uint8Array(16).fill(255),
      },
    };
    const both = tinySet({ stored });
    expect(both.atlasOf(font('Tiny', 9, { bold: true }))).toBe('bitmap/Tiny-4.bin');
    expect(art(both.glyph(font('Tiny', 9, { bold: true }), 0x41))).toEqual(['####', '####', '####', '....']);
    const storedOnly = tinySet({ stored, native: false });
    expect(storedOnly.atlasOf(font('Tiny', 9, { bold: true }))).toBe('bitmap/Tiny-4-b.bin');
    expect(art(storedOnly.glyph(font('Tiny', 9, { bold: true }), 0x41))).toEqual(['####', '####', '####', '####']);
  });

  it('independent factors: 3 x 4 enlarged twice as wide and three times as high', () => {
    const tall = tinySet({ cells: (cell) => (cell.kx === 2 ? { ...cell, ky: 3, plainCell: [6, 8] } : cell) });
    const stretched = tall.glyph(font('Tiny', 100), 0x41);
    expect(art(stretched).slice(0, 4)).toEqual(['##..##', '##..##', '##..##', '######']);
    expect(stretched).toMatchObject({ advance: 6, width: 6, height: 12 });
  });
});

// ---- the synthetic set in the layout of the real files ---------------------------------------------

let files: Map<string, Bytes>;
let fonts: FontSet;

beforeAll(() => {
  files = createSyntheticFontFiles();
  fonts = fontSetFromFiles(files);
}, 60_000);

describe('the synthetic font set in the layout of the real files', () => {
  it('lists its atlases: native raster cells in metrics.json, outline atlases in scalable/index.json', () => {
    const table = parseMetricTable(files.get(METRICS_FILE) as Bytes);
    expect(table.faceKinds).toEqual(['raster', 'raster', 'outline', 'outline', 'outline', 'outline']);
    expect(table.raster?.atlases.map((atlas) => atlas.file)).toEqual([
      'bitmap/Fixedsys-15.bin',
      'bitmap/Courier-13.bin',
      'bitmap/Courier-16.bin',
      'bitmap/Courier-20.bin',
    ]);
    const index = parseOutlineIndex(files.get(OUTLINE_INDEX_FILE) as Bytes);
    expect(index).toHaveLength(4 * 10 * 3); // four faces, ten sizes, plain, bold and italic
    expect(index.map((atlas) => atlas.file)).toEqual(
      expect.arrayContaining(['scalable/Courier_New-16.bin', 'scalable/Arial-15-b.bin']),
    );
    // every listed file exists and nothing else does
    const listed = [...(table.raster?.atlases.map((atlas) => atlas.file) ?? []), ...index.map((atlas) => atlas.file)];
    expect([...files.keys()].sort()).toEqual([METRICS_FILE, OUTLINE_INDEX_FILE, ...listed].sort());
    for (const path of listed) expect(() => decodeAtlas(files.get(path) as Bytes), path).not.toThrow();
    // underline and strike-out are lines of the plain atlases, not atlases
    expect(index.filter((atlas) => atlas.underline).every((atlas) => atlas.style === 'plain')).toBe(true);
    expect(listed.some((path) => /-[us]\.bin$/.test(path))).toBe(false);
  });

  it('the provider asks for metrics.json, the index, and then exactly the listed atlases', async () => {
    const asked: string[] = [];
    const provider = new AtlasGlyphProvider((path) => {
      asked.push(path);
      return memoryFontLoader(files)(path);
    });
    await provider.ready;
    expect(provider.problems).toEqual([]);
    expect(asked.slice(0, 2)).toEqual([METRICS_FILE, OUTLINE_INDEX_FILE]);
    expect(asked.slice().sort()).toEqual([...files.keys()].sort());
    expect(provider.metrics(font('Fixedsys', 9))).toEqual({ colWidth: 8, rowHeight: 15 });
    expect(provider.atlasOf(font('Courier New', 10))).toBe('scalable/Courier_New-16.bin');
    expect(provider.textOverhang(font('Fixedsys', 9, { italic: true }))).toBe(7);
  });

  it('a listed atlas that is missing is a problem; the other fonts stay usable', async () => {
    const partial = new Map(files);
    partial.delete('bitmap/Courier-13.bin');
    partial.delete('scalable/Arial-15.bin');
    const provider = new AtlasGlyphProvider(memoryFontLoader(partial));
    await provider.ready;
    expect(provider.problems).toEqual([
      'bitmap/Courier-13.bin: the file is missing',
      'scalable/Arial-15.bin: the file is missing',
    ]);
    expect(provider.glyph(font('Fixedsys', 9), 0x41).coverage.some((value) => value !== 0)).toBe(true);
  });

  it('an index that cannot be read fails the loading with its place', async () => {
    const broken = new Map(files);
    broken.set(OUTLINE_INDEX_FILE, new TextEncoder().encode('{"atlases": [{"file": "a.bin"}]}'));
    const provider = new AtlasGlyphProvider(memoryFontLoader(broken));
    await expect(provider.ready).rejects.toThrow(/scalable\/index\.json: "atlases"\[0\] needs a "file" and a "face"/);
  });

  it('bold changes the grid of the raster faces by one pixel per column; the other styles keep it', () => {
    const cell = (name: string, size: number, style: Partial<FontSpec> = {}) => {
      const { colWidth, rowHeight } = fonts.metrics(font(name, size, style));
      return `${colWidth}x${rowHeight}`;
    };
    expect([cell('Fixedsys', 9), cell('Fixedsys', 9, { bold: true }), cell('Fixedsys', 18, { bold: true })]).toEqual([
      '8x15',
      '9x15',
      '17x30',
    ]);
    expect([
      cell('Courier', 12, { bold: true }),
      cell('Courier', 12, { italic: true }),
      cell('Courier', 12, { underline: true }),
    ]).toEqual(['10x16', '9x16', '9x16']);
    expect(cell('Courier New', 10, { bold: true })).toBe('8x16');
  });

  it('a raster cell without an atlas of its own is the native cell enlarged: Fixedsys 16 x 30 and 24 x 45 from 8 x 15', () => {
    const native = fonts.glyph(font('Fixedsys', 9), 0x41);
    for (const [size, k] of [
      [18, 2],
      [40, 3],
    ] as const) {
      expect(fonts.atlasOf(font('Fixedsys', size))).toBe('bitmap/Fixedsys-15.bin');
      const large = fonts.glyph(font('Fixedsys', size), 0x41);
      expect(large).toMatchObject({ advance: 8 * k, width: 8 * k, height: 15 * k });
      for (let y = 0; y < 15 * k; y++) {
        for (let x = 0; x < 8 * k; x++) {
          expect(large.coverage[y * 8 * k + x]).toBe(native.coverage[Math.floor(y / k) * 8 + Math.floor(x / k)]);
        }
      }
    }
  });

  it('every style of every raster cell follows its rule: bold, italic, underline and strike-out from the plain glyph', () => {
    const at = (glyph: Glyph, x: number, y: number) =>
      x >= 0 && x < glyph.width && y < glyph.height ? (glyph.coverage[y * glyph.width + x] as number) : 0;
    for (const [name, size] of [
      ['Fixedsys', 9],
      ['Fixedsys', 18],
      ['Fixedsys', 40],
      ['Courier', 10],
      ['Courier', 12],
      ['Courier', 15],
      ['Courier', 30],
    ] as const) {
      const { rowHeight: h } = fonts.metrics(font(name, size));
      const lean = Math.floor((h - 1) / 2);
      for (const ch of [0x20, 0x41, 0x48, 0x57, 0x67, 0x7f, 0xe9]) {
        const plain = fonts.glyph(font(name, size), ch);
        const bold = fonts.glyph(font(name, size, { bold: true }), ch);
        const italic = fonts.glyph(font(name, size, { italic: true }), ch);
        expect(bold.advance, `${name} ${size} bold`).toBe(plain.advance + 1);
        expect(italic.advance).toBe(plain.advance);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < plain.width + lean + 1; x++) {
            expect(at(bold, x, y), `${name} ${size} bold ${ch} (${x},${y})`).toBe(
              at(plain, x, y) | at(plain, x - 1, y),
            );
            expect(at(italic, x, y), `${name} ${size} italic ${ch} (${x},${y})`).toBe(
              at(plain, x - (lean - Math.floor(y / 2)), y),
            );
          }
        }
      }
    }
    // the lines: two rows at twice the native size, across the advance
    const underlined = art(fonts.glyph(font('Fixedsys', 18, { underline: true }), 0x41));
    expect(underlined[26]).toBe('#'.repeat(16));
    expect(underlined[27]).toBe('#'.repeat(16));
    expect(underlined[25]).not.toBe('#'.repeat(16));
    expect(art(fonts.glyph(font('Fixedsys', 9, { strikeOut: true }), 0x20))[8]).toBe('########');
    // a zero-width byte has no line, and the control bytes the set stores empty have no picture
    expect(art(fonts.glyph(font('Fixedsys', 9, { underline: true }), 0x0d))).toEqual(
      art(fonts.glyph(font('Fixedsys', 9), 0x0d)),
    );
    expect(art(fonts.glyph(font('Fixedsys', 9, { underline: true }), 0x0e))[13]).toBe('########');
    expect(fonts.glyph(font('Fixedsys', 9), 0x01).coverage.every((value) => value === 0)).toBe(true);
    expect(fonts.glyph(font('Fixedsys', 9), 0x0c).coverage.some((value) => value !== 0)).toBe(true);
  }, 60_000);

  it('the overhang of the opaque box is that of the raster styles only', () => {
    const overhang = (name: string, size: number, style: FontStyle) =>
      fonts.textOverhang(font(name, size, { [style]: true }));
    expect(overhang('Fixedsys', 9, 'bold')).toBe(1);
    expect(overhang('Fixedsys', 9, 'italic')).toBe(7);
    expect(overhang('Fixedsys', 18, 'italic')).toBe(14);
    expect(overhang('Courier', 10, 'italic')).toBe(6);
    expect(overhang('Fixedsys', 9, 'underline')).toBe(0);
    expect(fonts.textOverhang(font('Fixedsys', 9))).toBe(0);
    expect(overhang('Courier New', 10, 'bold')).toBe(0);
    expect(overhang('Terminal', 10, 'italic')).toBe(0);
  });
});

describe('underline and strike-out of an outline face: the plain glyph plus the line of the index', () => {
  const rowIsLine = (glyph: Glyph, y: number) => {
    for (let x = 0; x < glyph.advance; x++) if (glyph.coverage[y * glyph.width + x] !== 255) return false;
    return true;
  };
  const samePicture = (a: Glyph, b: Glyph, rows: number) => {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < Math.max(a.width, b.width); x++) {
        const av = x < a.width ? a.coverage[y * a.width + x] : 0;
        const bv = x < b.width ? b.coverage[y * b.width + x] : 0;
        if (av !== bv) return false;
      }
    }
    return true;
  };

  it('uses the plain atlas of the face', () => {
    expect(fonts.atlasOf(font('Courier New', 10, { underline: true }))).toBe('scalable/Courier_New-16.bin');
    expect(fonts.atlasOf(font('Courier New', 10, { strikeOut: true }))).toBe('scalable/Courier_New-16.bin');
    expect(fonts.atlasOf(font('Courier New', 10, { bold: true }))).toBe('scalable/Courier_New-16-b.bin');
    expect(fonts.atlasOf(font('Courier New', 10, { italic: true }))).toBe('scalable/Courier_New-16-i.bin');
  });

  it('the line lies where the index says, across the advance of each glyph', () => {
    // Courier New 10: cell 8 x 16, underline [14, 1], strike-out [8, 1]
    const plain = fonts.glyph(font('Courier New', 10), 0x41);
    const underlined = fonts.glyph(font('Courier New', 10, { underline: true }), 0x41);
    const struck = fonts.glyph(font('Courier New', 10, { strikeOut: true }), 0x41);
    expect(underlined).toMatchObject({ advance: 8, height: 16 });
    expect(rowIsLine(underlined, 14)).toBe(true);
    expect(rowIsLine(underlined, 13)).toBe(false);
    expect(samePicture(underlined, plain, 14)).toBe(true);
    expect(rowIsLine(struck, 8)).toBe(true);
    expect(samePicture(struck, plain, 8)).toBe(true);
    // a space is underlined too
    expect(rowIsLine(fonts.glyph(font('Courier New', 10, { underline: true }), 0x20), 14)).toBe(true);
    // the proportional face: every glyph has a line as long as its own advance
    const narrow = fonts.glyph(font('Terminal', 12, { underline: true }), 0x69);
    expect(narrow.advance).toBe(10);
    expect(rowIsLine(narrow, 16)).toBe(true);
  });

  it('an underline below the cell makes the glyph that much higher (Windows draws it there)', () => {
    // 9 points: cell 7 x 15, underline [15, 1]
    expect(fonts.metrics(font('Courier New', 9, { underline: true }))).toEqual({ colWidth: 7, rowHeight: 15 });
    const plain = fonts.glyph(font('Courier New', 9), 0x41);
    const underlined = fonts.glyph(font('Courier New', 9, { underline: true }), 0x41);
    expect(plain.height).toBe(15);
    expect(underlined.height).toBe(16);
    expect(rowIsLine(underlined, 15)).toBe(true);
    expect(samePicture(underlined, plain, 15)).toBe(true);
  });

  it('at a size without an atlas the line is scaled with the glyph', () => {
    // 20 points: cell 16 x 31 from the 14 x 27 atlas, whose underline is [25, 1]: row round(25 * 31 / 27) = 29
    const underlined = fonts.glyph(font('Courier New', 20, { underline: true }), 0x41);
    expect(underlined).toMatchObject({ advance: 16, height: 31 });
    expect(rowIsLine(underlined, 29)).toBe(true);
    expect(rowIsLine(underlined, 28)).toBe(false);
    expect(rowIsLine(underlined, 30)).toBe(false);
    // 48 points from the 36 point atlas (two rows of line): the line grows with the size
    const large = fonts.glyph(font('Courier New', 48, { underline: true }), 0x20);
    const lines = Array.from({ length: large.height }, (_, y) => rowIsLine(large, y)).filter(Boolean).length;
    expect(lines).toBe(3);
  });
});
