// The metric table of ARCHITECTURE.md 6.5.3 (`metrics.json`): reading, writing, and what is refused.

import { describe, expect, it } from 'vitest';
import { FontFormatError } from './atlas';
import {
  emPixels,
  FONT_STYLES,
  metricEntry,
  parseMetricTable,
  parseOutlineIndex,
  POINT_SIZES,
  serializeMetricTable,
  serializeOutlineIndex,
  sizeIndex,
  styleOf,
  type FontMetricRows,
  type MetricTable,
} from './metrics';

const plainFont = { name: 'Fixedsys', size: 9, bold: false, italic: false, underline: false, strikeOut: false };

/** 256 entries [w, h, face] for a style, as JSON values. */
const rows = (cell: (size: number) => [number, number, number]) =>
  Array.from({ length: POINT_SIZES }, (_, size) => cell(size));

/** A small table as the JSON value of 6.5.3. */
function sampleJson(): Record<string, unknown> {
  return {
    capturedOn: { windows: '10.0.26100', dpi: 96, smoothing: 'ClearType' },
    faces: ['Fixedsys', 'Arial'],
    fonts: {
      Fixedsys: {
        plain: rows((size) => (size < 18 ? [8, 15, 0] : [16, 30, 0])),
        b: rows((size) => (size < 18 ? [9, 15, 0] : [17, 30, 0])),
        i: rows(() => [8, 15, 0]),
        u: rows(() => [8, 15, 0]),
        s: rows(() => [8, 15, 0]),
      },
      Terminal: {
        plain: rows((size) => [size + 1, size + 2, 1]),
        b: rows((size) => [size + 2, size + 2, 1]),
        i: rows((size) => [size + 1, size + 2, 1]),
        u: rows((size) => [size + 1, size + 2, 1]),
        s: rows((size) => [size + 1, size + 2, 1]),
      },
    },
  };
}

function entriesOf(table: MetricTable): Record<string, Record<string, number[]>> {
  const result: Record<string, Record<string, number[]>> = {};
  for (const [name, styles] of table.fonts) {
    result[name] = Object.fromEntries(FONT_STYLES.map((style) => [style, [...styles[style]]]));
  }
  return result;
}

describe('metrics.json (6.5.3)', () => {
  it('reads faces, fonts and capturedOn', () => {
    const table = parseMetricTable(sampleJson());
    expect(table.faces).toEqual(['Fixedsys', 'Arial']);
    expect(table.capturedOn).toEqual({ windows: '10.0.26100', dpi: 96, smoothing: 'ClearType' });
    expect([...table.fonts.keys()]).toEqual(['Fixedsys', 'Terminal']);
    const fixedsys = table.fonts.get('Fixedsys') as FontMetricRows;
    expect(metricEntry(fixedsys, 'plain', 9)).toEqual({ colWidth: 8, rowHeight: 15, face: 0 });
    expect(metricEntry(fixedsys, 'plain', 18)).toEqual({ colWidth: 16, rowHeight: 30, face: 0 });
    expect(metricEntry(fixedsys, 'bold', 9)).toEqual({ colWidth: 9, rowHeight: 15, face: 0 });
    const terminal = table.fonts.get('Terminal') as FontMetricRows;
    expect(metricEntry(terminal, 'plain', 0)).toEqual({ colWidth: 1, rowHeight: 2, face: 1 });
    expect(metricEntry(terminal, 'strikeOut', 255)).toEqual({ colWidth: 256, rowHeight: 257, face: 1 });
    // what 6.5.3 does not list is absent
    expect(table.faceKinds).toBeUndefined();
    expect(table.raster).toBeUndefined();
  });

  it('reads the same table from text and from bytes (also with a byte order mark)', () => {
    const text = JSON.stringify(sampleJson());
    const expected = entriesOf(parseMetricTable(sampleJson()));
    expect(entriesOf(parseMetricTable(text))).toEqual(expected);
    expect(entriesOf(parseMetricTable(new TextEncoder().encode(text)))).toEqual(expected);
    expect(entriesOf(parseMetricTable(new TextEncoder().encode(String.fromCharCode(0xfeff) + text)))).toEqual(expected);
  });

  it('round trip: what the writer writes, the reader reads back, and writes again identically', () => {
    const table = parseMetricTable(sampleJson());
    const text = serializeMetricTable(table);
    const again = parseMetricTable(text);
    expect(again.faces).toEqual(table.faces);
    expect(again.capturedOn).toEqual(table.capturedOn);
    expect(entriesOf(again)).toEqual(entriesOf(table));
    expect(serializeMetricTable(again)).toBe(text);
    // The text is the JSON of 6.5.3, with the style names of FontSpec as keys.
    const value = JSON.parse(text) as { fonts: Record<string, Record<string, number[][]>> };
    expect(Object.keys(value)).toEqual(['capturedOn', 'faces', 'fonts']);
    expect(Object.keys(value.fonts['Fixedsys'] ?? {})).toEqual(['plain', 'bold', 'italic', 'underline', 'strikeOut']);
    expect(value.fonts['Fixedsys']?.['bold']?.[9]).toEqual([9, 15, 0]);
    expect(value.fonts['Terminal']?.['plain']).toHaveLength(256);
  });

  it("reads T2's additions: the kind of every face and the rules of the raster faces", () => {
    const raster = {
      rules: { plain: 'P(x, y) = native(floor(x / kx), floor(y / ky))' }, // prose for people: ignored
      atlases: [
        {
          file: 'bitmap/Fixedsys-15.bin',
          face: 'Fixedsys',
          style: 'plain',
          cellWidth: 8,
          cellHeight: 15,
          blankBytes: [1, 3],
        },
        {
          file: 'bitmap/Fixedsys-15-u.bin',
          face: 'Fixedsys',
          style: 'underline',
          cellWidth: 8,
          cellHeight: 15,
          blankBytes: [],
        },
      ],
      cells: [
        {
          face: 'Fixedsys',
          style: 'underline',
          plainCell: [16, 30],
          native: 'bitmap/Fixedsys-15.bin',
          kx: 2,
          ky: 2,
          atlas: null,
          lineRows: [26, 27],
          lineExceptions: { '0': 9, '9': 0 },
        },
        {
          face: 'Fixedsys',
          style: 'plain',
          plainCell: [8, 15],
          native: 'bitmap/Fixedsys-15.bin',
          kx: 1,
          ky: 1,
          atlas: 'bitmap/Fixedsys-15.bin',
        },
      ],
    };
    const table = parseMetricTable({ ...sampleJson(), about: 'ignored', faceKinds: ['raster', 'outline'], raster });
    expect(table.faceKinds).toEqual(['raster', 'outline']);
    expect(table.raster?.atlases).toEqual([
      { file: 'bitmap/Fixedsys-15.bin', face: 'Fixedsys', style: 'plain', blankBytes: [1, 3] },
      { file: 'bitmap/Fixedsys-15-u.bin', face: 'Fixedsys', style: 'underline', blankBytes: [] },
    ]);
    expect(table.raster?.cells).toEqual([
      {
        face: 'Fixedsys',
        style: 'underline',
        plainCell: [16, 30],
        native: 'bitmap/Fixedsys-15.bin',
        kx: 2,
        ky: 2,
        atlas: null,
        lineRows: [26, 27],
        lineExceptions: { 0: 9, 9: 0 },
      },
      {
        face: 'Fixedsys',
        style: 'plain',
        plainCell: [8, 15],
        native: 'bitmap/Fixedsys-15.bin',
        kx: 1,
        ky: 1,
        atlas: 'bitmap/Fixedsys-15.bin',
        lineRows: [],
        lineExceptions: {},
      },
    ]);
    // and they survive a round trip through the writer
    const again = parseMetricTable(serializeMetricTable(table));
    expect(again.faceKinds).toEqual(table.faceKinds);
    expect(again.raster).toEqual(table.raster);
    expect(serializeMetricTable(again)).toBe(serializeMetricTable(table));
  });

  it('accepts the spellings a style key may have, and a face given as an object', () => {
    const json = sampleJson();
    const fixedsys = (json['fonts'] as Record<string, Record<string, unknown>>)['Fixedsys'] as Record<string, unknown>;
    const spelled = {
      capturedOn: null,
      faces: [{ name: 'Fixedsys', kind: 'raster' }, 'Arial'],
      fonts: {
        Fixedsys: {
          '': fixedsys['plain'],
          Bold: fixedsys['b'],
          italic: fixedsys['i'],
          Underline: fixedsys['u'],
          strikeOut: fixedsys['s'],
        },
      },
    };
    const table = parseMetricTable(spelled);
    expect(table.faces).toEqual(['Fixedsys', 'Arial']);
    expect(metricEntry(table.fonts.get('Fixedsys') as FontMetricRows, 'bold', 9)).toEqual({
      colWidth: 9,
      rowHeight: 15,
      face: 0,
    });
  });

  it('a style the table does not give has the plain cells', () => {
    const table = parseMetricTable({
      faces: ['Fixedsys'],
      fonts: { Fixedsys: { plain: rows(() => [8, 15, 0]), b: rows(() => [9, 15, 0]) } },
    });
    const fixedsys = table.fonts.get('Fixedsys') as FontMetricRows;
    expect(metricEntry(fixedsys, 'bold', 9).colWidth).toBe(9);
    expect(metricEntry(fixedsys, 'italic', 9).colWidth).toBe(8);
    expect(metricEntry(fixedsys, 'strikeOut', 9).colWidth).toBe(8);
  });

  it.each([
    ['text that is not JSON', '{', /not JSON/],
    ['no faces', { fonts: {} }, /"faces" must be a list/],
    ['no fonts', { faces: ['A'], fonts: {} }, /"fonts" must hold at least one font name/],
    ['an unknown style', { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 0]), x: [] } } }, /"x" is not a style/],
    [
      'a style twice',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 0]), p: rows(() => [1, 1, 0]) } } },
      /given twice/,
    ],
    ['no plain style', { faces: ['A'], fonts: { A: { b: rows(() => [1, 1, 0]) } } }, /has no plain style/],
    ['255 sizes', { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 0]).slice(1) } } }, /expected 256 entries/],
    [
      'a face that does not exist',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 1]) } } },
      /size 0: there is no face 1/,
    ],
    [
      'an entry of two numbers',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1] as never) } } },
      /expected \[colWidth, rowHeight, faceIndex\]/,
    ],
    [
      'a width that is not a whole number',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1.5, 1, 0]) } } },
      /not three whole numbers/,
    ],
    [
      'face kinds that do not fit the faces',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 0]) } }, faceKinds: ['raster', 'outline'] },
      /"faceKinds" must give "raster" or "outline" for every face/,
    ],
    [
      'raster rules without lists',
      { faces: ['A'], fonts: { A: { plain: rows(() => [1, 1, 0]) } }, raster: { cells: [] } },
      /"raster" must hold the lists "atlases" and "cells"/,
    ],
    [
      'a raster cell without factors',
      {
        faces: ['A'],
        fonts: { A: { plain: rows(() => [1, 1, 0]) } },
        raster: {
          atlases: [],
          cells: [{ face: 'A', style: 'plain', plainCell: [1, 1], native: 'a.bin', kx: 0, ky: 1 }],
        },
      },
      /"raster.cells"\[0\]: "kx" and "ky" must be whole factors/,
    ],
    [
      'a raster atlas with an unknown style',
      {
        faces: ['A'],
        fonts: { A: { plain: rows(() => [1, 1, 0]) } },
        raster: { atlases: [{ file: 'a.bin', face: 'A', style: 'wide' }], cells: [] },
      },
      /"raster.atlases"\[0\]: "wide" is not a style/,
    ],
  ])('refuses %s', (_name, source, message) => {
    expect(() => parseMetricTable(source)).toThrow(FontFormatError);
    expect(() => parseMetricTable(source)).toThrow(message);
  });
});

describe('scalable/index.json: the list of the outline atlases', () => {
  const index = {
    about: 'ignored',
    atlases: [
      {
        file: 'scalable/Courier_New-15.bin',
        face: 'Courier New',
        style: 'plain',
        size: 9,
        cellWidth: 7,
        cellHeight: 15,
        underline: [15, 1],
        strikeOut: [9, 1],
      },
      { file: 'scalable/Courier_New-16x8-b.bin', face: 'Courier New', style: 'bold', size: 10 },
      { file: 'scalable/Arial-15-i.bin', face: 'Arial', style: 'italic' },
    ],
  };

  it('reads file, face, style, the point size and the two lines of every atlas', () => {
    expect(parseOutlineIndex(index)).toEqual([
      {
        file: 'scalable/Courier_New-15.bin',
        face: 'Courier New',
        style: 'plain',
        size: 9,
        underline: [15, 1],
        strikeOut: [9, 1],
      },
      { file: 'scalable/Courier_New-16x8-b.bin', face: 'Courier New', style: 'bold', size: 10 },
      // an atlas without a point size is read all the same
      { file: 'scalable/Arial-15-i.bin', face: 'Arial', style: 'italic' },
    ]);
    expect(parseOutlineIndex(new TextEncoder().encode(JSON.stringify(index)))).toEqual(parseOutlineIndex(index));
  });

  it('round trip through the writer', () => {
    const atlases = parseOutlineIndex(index);
    const text = serializeOutlineIndex(atlases);
    expect(parseOutlineIndex(text)).toEqual(atlases);
    expect(serializeOutlineIndex(parseOutlineIndex(text))).toBe(text);
  });

  it.each([
    ['text that is not JSON', '[', /scalable\/index\.json: not JSON/],
    ['no list', { files: [] }, /expected an object with a list "atlases"/],
    [
      'an atlas without a face',
      { atlases: [{ file: 'a.bin', style: 'plain' }] },
      /"atlases"\[0\] needs a "file" and a "face"/,
    ],
    ['an unknown style', { atlases: [{ file: 'a.bin', face: 'A', style: 'wide' }] }, /"wide" is not a style/],
    [
      'a line that is not two numbers',
      { atlases: [{ file: 'a.bin', face: 'A', style: 'plain', underline: [3] }] },
      /"underline" must be \[first row, rows\]/,
    ],
    [
      'a point size of 0',
      { atlases: [{ file: 'a.bin', face: 'A', style: 'plain', size: 0 }] },
      /"size" must be a point size from 1 to 255/,
    ],
    [
      'a point size that is not a whole number',
      { atlases: [{ file: 'a.bin', face: 'A', style: 'plain', size: 9.5 }] },
      /"size" must be a point size from 1 to 255/,
    ],
  ])('refuses %s', (_name, source, message) => {
    expect(() => parseOutlineIndex(source)).toThrow(FontFormatError);
    expect(() => parseOutlineIndex(source)).toThrow(message);
  });
});

describe('style and size of a font', () => {
  it('one style per font; with several flags the last of bold, italic, underline, strike-out counts', () => {
    expect(styleOf(plainFont)).toBe('plain');
    expect(styleOf({ ...plainFont, bold: true })).toBe('bold');
    expect(styleOf({ ...plainFont, italic: true })).toBe('italic');
    expect(styleOf({ ...plainFont, underline: true })).toBe('underline');
    expect(styleOf({ ...plainFont, strikeOut: true })).toBe('strikeOut');
    expect(styleOf({ ...plainFont, bold: true, italic: true })).toBe('italic');
    expect(styleOf({ ...plainFont, bold: true, underline: true, strikeOut: true })).toBe('strikeOut');
  });

  it('a size is an index from 0 to 255', () => {
    expect([0, 9, 255, 256, 1000, -3, 9.7, Number.NaN].map(sizeIndex)).toEqual([0, 9, 255, 255, 255, 0, 9, 0]);
  });

  it('the em of a point size is MulDiv(size, 96, 72) pixels, as the VCL asks Windows for it', () => {
    expect([1, 5, 8, 9, 10, 11, 12, 14, 36, 100, 255].map(emPixels)).toEqual([
      1, 7, 11, 12, 13, 15, 16, 19, 48, 133, 340,
    ]);
  });
});
