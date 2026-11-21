// The metric table (ARCHITECTURE.md 3.5.1, 6.5.3): `app/public/fonts/metrics.json`, measured on
// Windows by T2. For every font name a program or the Options dialog can ask for, each of the five
// styles and each point size 0-255 it gives the cell Windows reports (TextWidth("W"),
// TextHeight("Xp")) and the face Windows actually used. This table, not anything in the browser,
// decides the text grid.
//
//   { "capturedOn": ...,
//     "faces": ["Fixedsys", ...],
//     "fonts": { "<requested name>": { "<style>": [[colWidth, rowHeight, faceIndex], ... 256 entries ] } } }
//
// T2's file has three things beyond 6.5.3 (docs/porting/errata/T2.md), all optional for this reader:
//
//   "faceKinds": ["raster", "outline", ...]          parallel to "faces"
//   "raster": { "atlases": [...], "cells": [...] }   how Windows makes every raster cell (see RasterRules)
//
// and, next to the atlases, `scalable/index.json`, the list of the outline faces' atlases
// (parseOutlineIndex). A browser cannot list a folder, so these lists are how the provider learns
// which atlas files exist.
//
// The key of a style is one of FontSpec's names (`plain`, `bold`, `italic`, `underline`,
// `strikeOut`); the reader also accepts the letters of the atlas file names and a few other
// spellings (STYLE_KEYS).
//
// Owner: SH3.

import type { Bytes, FontSpec } from '../../../contracts';
import { FontFormatError } from './atlas';

/** The five styles of the metric table. A font has exactly one (trap15-a task 21). */
export const FONT_STYLES = ['plain', 'bold', 'italic', 'underline', 'strikeOut'] as const;
export type FontStyle = (typeof FONT_STYLES)[number];

/** Point sizes of the table: index 0-255, the byte task 21 passes. */
export const POINT_SIZES = 256;

/** Suffix of a style in an atlas file name: `<face>-<height>[-<suffix>].bin`. */
export const STYLE_SUFFIX: Readonly<Record<FontStyle, string>> = {
  plain: '',
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strikeOut: 's',
};

/** Keys the reader accepts for each style, compared without regard to letter case. */
const STYLE_KEYS: Readonly<Record<FontStyle, readonly string[]>> = {
  plain: ['plain', '', 'regular', 'normal', 'r', 'n', 'p'],
  bold: ['bold', 'b'],
  italic: ['italic', 'i'],
  underline: ['underline', 'u'],
  strikeOut: ['strikeout', 'strike-out', 'strike', 's'],
};

/** One cell of the table: what Windows answered for one name, style and size. */
export interface MetricEntry {
  colWidth: number;
  rowHeight: number;
  /** Index into `MetricTable.faces`. */
  face: number;
}

/** The entries of one font name: for each style 256 x 3 numbers (colWidth, rowHeight, face). */
export type FontMetricRows = Readonly<Record<FontStyle, Uint16Array>>;

/** A raster face (Fixedsys, Courier: two-colour bitmaps Windows only enlarges by whole factors) or an outline face. */
export type FaceKind = 'raster' | 'outline';

/** One raster atlas file as `metrics.json` lists it. */
export interface RasterAtlasInfo {
  /** Path below the fonts folder, e.g. "bitmap/Fixedsys-15.bin". */
  file: string;
  face: string;
  style: FontStyle;
  /** Bytes whose glyph is stored empty: Windows draws them from another, anti-aliased font. */
  blankBytes: readonly number[];
}

/**
 * How Windows makes one cell of a raster face (T2's `raster.cells`): the native atlas enlarged by
 * the whole factors `kx` and `ky`, then the style applied to the enlarged glyph.
 */
export interface RasterCell {
  face: string;
  style: FontStyle;
  /** The cell of the plain font at this size, [width, height]; the styled cell may be wider. */
  plainCell: readonly [number, number];
  /** The plain atlas the cell is made from. */
  native: string;
  kx: number;
  ky: number;
  /** An atlas that holds exactly this cell in this style, when one is stored. */
  atlas: string | null;
  /** Underline or strike-out: the rows of the line. */
  lineRows: readonly number[];
  /** Underline or strike-out: bytes whose line is not as long as their advance, with its length. */
  lineExceptions: Readonly<Record<number, number>>;
}

export interface RasterRules {
  atlases: readonly RasterAtlasInfo[];
  cells: readonly RasterCell[];
}

export interface MetricTable {
  /** The capture machine's Windows version and settings, as the file gives them. */
  readonly capturedOn: unknown;
  /** Names of the faces Windows used. */
  readonly faces: readonly string[];
  /** Kind of each face, parallel to `faces`; absent in a file that has only what 6.5.3 lists. */
  readonly faceKinds?: readonly FaceKind[];
  /** By requested font name, exactly as the original spells it. */
  readonly fonts: ReadonlyMap<string, FontMetricRows>;
  /** The raster faces' atlases and rules; absent in a file that has only what 6.5.3 lists. */
  readonly raster?: RasterRules;
}

/** One outline atlas file as `scalable/index.json` lists it. */
export interface OutlineAtlasInfo {
  /** Path below the fonts folder, e.g. "scalable/Courier_New-16.bin". */
  file: string;
  face: string;
  style: FontStyle;
  /** Plain atlases: the underline as [first row, rows], in rows of the cell. It may lie below the cell. */
  underline?: readonly [number, number];
  /** Plain atlases: the strike-out line as [first row, rows]. */
  strikeOut?: readonly [number, number];
}

/** The style of a font. If more than one flag is set the last of bold, italic, underline, strike-out
 *  counts, as the highest bit does in task 21. */
export function styleOf(font: FontSpec): FontStyle {
  if (font.strikeOut) return 'strikeOut';
  if (font.underline) return 'underline';
  if (font.italic) return 'italic';
  if (font.bold) return 'bold';
  return 'plain';
}

/** A point size as an index of the table: a whole number from 0 to 255. */
export function sizeIndex(size: number): number {
  if (!(size > 0)) return 0;
  return Math.min(POINT_SIZES - 1, Math.trunc(size));
}

/** The entry of a name that is in the table. */
export function metricEntry(rows: FontMetricRows, style: FontStyle, size: number): MetricEntry {
  const row = rows[style];
  const at = sizeIndex(size) * 3;
  return { colWidth: row[at] as number, rowHeight: row[at + 1] as number, face: row[at + 2] as number };
}

// ---- reading ---------------------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffff;

function styleOfKey(key: unknown): FontStyle | undefined {
  if (typeof key !== 'string') return undefined;
  const folded = key.toLowerCase();
  return FONT_STYLES.find((style) => STYLE_KEYS[style].includes(folded));
}

/** The JSON value of a file given as bytes, text or value. `fail` reports text that is not JSON. */
function jsonOf(source: Bytes | string | unknown, fail: (message: string) => never): unknown {
  let value: unknown = source;
  if (source instanceof Uint8Array) value = new TextDecoder('utf-8').decode(source);
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    return fail(`not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

function parseRows(
  name: string,
  key: string,
  value: unknown,
  faceCount: number,
  fail: (m: string) => never,
): Uint16Array {
  const where = `font "${name}", style "${key}"`;
  if (!Array.isArray(value) || value.length !== POINT_SIZES) {
    fail(`${where}: expected ${POINT_SIZES} entries, one per point size 0-255`);
  }
  const rows = new Uint16Array(POINT_SIZES * 3);
  value.forEach((entry: unknown, size) => {
    const numbers =
      Array.isArray(entry) && entry.length === 3
        ? (entry as unknown[])
        : fail(`${where}, size ${size}: expected [colWidth, rowHeight, faceIndex]`);
    numbers.forEach((n, i) => {
      if (!isCount(n)) fail(`${where}, size ${size}: ${JSON.stringify(entry)} is not three whole numbers`);
      rows[size * 3 + i] = n;
    });
    if ((numbers[2] as number) >= faceCount) fail(`${where}, size ${size}: there is no face ${String(numbers[2])}`);
  });
  return rows;
}

function parseRaster(value: unknown, fail: (m: string) => never): RasterRules {
  if (!isObject(value) || !Array.isArray(value['atlases']) || !Array.isArray(value['cells'])) {
    fail('"raster" must hold the lists "atlases" and "cells"');
  }
  const atlases = (value['atlases'] as unknown[]).map((entry, index): RasterAtlasInfo => {
    const where = `"raster.atlases"[${index}]`;
    if (!isObject(entry) || typeof entry['file'] !== 'string' || typeof entry['face'] !== 'string') {
      fail(`${where} needs a "file" and a "face"`);
    }
    const style = styleOfKey(entry['style']) ?? fail(`${where}: ${JSON.stringify(entry['style'])} is not a style`);
    const blank = entry['blankBytes'] ?? [];
    if (!Array.isArray(blank) || !blank.every(isCount)) fail(`${where}: "blankBytes" must be a list of byte values`);
    return { file: entry['file'], face: entry['face'], style, blankBytes: blank };
  });
  const cells = (value['cells'] as unknown[]).map((entry, index): RasterCell => {
    const where = `"raster.cells"[${index}]`;
    if (!isObject(entry) || typeof entry['face'] !== 'string' || typeof entry['native'] !== 'string') {
      fail(`${where} needs a "face" and a "native" atlas`);
    }
    const style = styleOfKey(entry['style']) ?? fail(`${where}: ${JSON.stringify(entry['style'])} is not a style`);
    const plainCell = entry['plainCell'];
    if (!Array.isArray(plainCell) || plainCell.length !== 2 || !plainCell.every(isCount)) {
      fail(`${where}: "plainCell" must be [width, height]`);
    }
    const { kx, ky } = entry;
    if (!isCount(kx) || !isCount(ky) || kx < 1 || ky < 1) fail(`${where}: "kx" and "ky" must be whole factors`);
    const atlas = entry['atlas'] ?? null;
    if (atlas !== null && typeof atlas !== 'string') fail(`${where}: "atlas" must be a file or null`);
    const lineRows = entry['lineRows'] ?? [];
    if (!Array.isArray(lineRows) || !lineRows.every(isCount)) fail(`${where}: "lineRows" must be a list of rows`);
    const exceptions = entry['lineExceptions'] ?? {};
    if (!isObject(exceptions)) fail(`${where}: "lineExceptions" must map bytes to line lengths`);
    const lineExceptions: Record<number, number> = {};
    for (const [byte, length] of Object.entries(exceptions)) {
      if (!/^\d+$/.test(byte) || !isCount(length)) fail(`${where}: "lineExceptions" must map bytes to line lengths`);
      lineExceptions[Number(byte)] = length;
    }
    return {
      face: entry['face'],
      style,
      plainCell: [plainCell[0] as number, plainCell[1] as number],
      native: entry['native'],
      kx,
      ky,
      atlas,
      lineRows,
      lineExceptions,
    };
  });
  return { atlases, cells };
}

/**
 * Reads `metrics.json` (its bytes, its text, or the parsed value). Throws `FontFormatError` with
 * the place of the first thing that is not as described above. Keys it does not know are ignored.
 */
export function parseMetricTable(source: Bytes | string | unknown): MetricTable {
  const fail: (message: string) => never = (message) => {
    throw new FontFormatError(`metrics.json: ${message}`);
  };
  const root = jsonOf(source, fail);
  if (!isObject(root)) fail('expected an object with "faces" and "fonts"');

  const rawFaces = root['faces'];
  if (!Array.isArray(rawFaces) || rawFaces.length === 0) fail('"faces" must be a list of face names');
  const faces = rawFaces.map((face: unknown, index) => {
    const name = isObject(face) ? face['name'] : face;
    return typeof name === 'string' && name !== '' ? name : fail(`"faces"[${index}] is not a face name`);
  });

  const rawFonts = root['fonts'];
  if (!isObject(rawFonts) || Object.keys(rawFonts).length === 0) fail('"fonts" must hold at least one font name');
  const fonts = new Map<string, FontMetricRows>();
  for (const [name, styles] of Object.entries(rawFonts)) {
    if (!isObject(styles)) fail(`font "${name}" must be an object of styles`);
    const rows: Partial<Record<FontStyle, Uint16Array>> = {};
    for (const [key, value] of Object.entries(styles)) {
      const style = styleOfKey(key) ?? fail(`font "${name}": "${key}" is not a style`);
      if (rows[style]) fail(`font "${name}": the style "${key}" is given twice`);
      rows[style] = parseRows(name, key, value, faces.length, fail);
    }
    const plain = rows.plain ?? fail(`font "${name}" has no plain style`);
    // A style the table does not give uses the plain cells (the text grid of the plain font).
    fonts.set(name, {
      plain,
      bold: rows.bold ?? plain,
      italic: rows.italic ?? plain,
      underline: rows.underline ?? plain,
      strikeOut: rows.strikeOut ?? plain,
    });
  }

  const table: { -readonly [K in keyof MetricTable]: MetricTable[K] } = {
    capturedOn: root['capturedOn'],
    faces,
    fonts,
  };
  const rawKinds = root['faceKinds'];
  if (rawKinds !== undefined) {
    if (
      !Array.isArray(rawKinds) ||
      rawKinds.length !== faces.length ||
      !rawKinds.every((kind) => kind === 'raster' || kind === 'outline')
    ) {
      fail('"faceKinds" must give "raster" or "outline" for every face');
    }
    table.faceKinds = rawKinds as FaceKind[];
  }
  if (root['raster'] !== undefined) table.raster = parseRaster(root['raster'], fail);
  return table;
}

/** Reads `scalable/index.json`: the list of the outline faces' atlases. */
export function parseOutlineIndex(source: Bytes | string | unknown): OutlineAtlasInfo[] {
  const fail: (message: string) => never = (message) => {
    throw new FontFormatError(`scalable/index.json: ${message}`);
  };
  const root = jsonOf(source, fail);
  if (!isObject(root) || !Array.isArray(root['atlases'])) fail('expected an object with a list "atlases"');
  const line = (value: unknown, where: string): readonly [number, number] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length !== 2 || !value.every(isCount))
      fail(`${where} must be [first row, rows]`);
    return [value[0] as number, value[1] as number];
  };
  return (root['atlases'] as unknown[]).map((entry, index): OutlineAtlasInfo => {
    const where = `"atlases"[${index}]`;
    if (!isObject(entry) || typeof entry['file'] !== 'string' || typeof entry['face'] !== 'string') {
      fail(`${where} needs a "file" and a "face"`);
    }
    const style = styleOfKey(entry['style']) ?? fail(`${where}: ${JSON.stringify(entry['style'])} is not a style`);
    const info: OutlineAtlasInfo = { file: entry['file'], face: entry['face'], style };
    const underline = line(entry['underline'], `${where}: "underline"`);
    const strikeOut = line(entry['strikeOut'], `${where}: "strikeOut"`);
    if (underline) info.underline = underline;
    if (strikeOut) info.strikeOut = strikeOut;
    return info;
  });
}

// ---- writing (for the synthetic fonts of the tests) ------------------------------------------------

/** Writes a table as the text of `metrics.json`: one line per style, so that the file can be read and compared. */
export function serializeMetricTable(table: MetricTable): string {
  const lines: string[] = ['{'];
  lines.push(`  "capturedOn": ${JSON.stringify(table.capturedOn ?? null)},`);
  lines.push(`  "faces": ${JSON.stringify(table.faces)},`);
  if (table.faceKinds) lines.push(`  "faceKinds": ${JSON.stringify(table.faceKinds)},`);
  lines.push('  "fonts": {');
  const names = [...table.fonts.keys()];
  names.forEach((name, n) => {
    const rows = table.fonts.get(name) as FontMetricRows;
    lines.push(`    ${JSON.stringify(name)}: {`);
    FONT_STYLES.forEach((style, s) => {
      const row = rows[style];
      const entries: string[] = [];
      for (let size = 0; size < POINT_SIZES; size++) {
        entries.push(`[${row[size * 3]},${row[size * 3 + 1]},${row[size * 3 + 2]}]`);
      }
      lines.push(`      ${JSON.stringify(style)}: [${entries.join(',')}]${s < FONT_STYLES.length - 1 ? ',' : ''}`);
    });
    lines.push(`    }${n < names.length - 1 ? ',' : ''}`);
  });
  lines.push(`  }${table.raster ? ',' : ''}`);
  if (table.raster) {
    lines.push('  "raster": {');
    lines.push('    "atlases": [');
    table.raster.atlases.forEach((atlas, index, all) => {
      lines.push(`      ${JSON.stringify(atlas)}${index < all.length - 1 ? ',' : ''}`);
    });
    lines.push('    ],', '    "cells": [');
    table.raster.cells.forEach((cell, index, all) => {
      lines.push(`      ${JSON.stringify(cell)}${index < all.length - 1 ? ',' : ''}`);
    });
    lines.push('    ]', '  }');
  }
  lines.push('}', '');
  return lines.join('\n');
}

/** Writes the list of outline atlases as the text of `scalable/index.json`. */
export function serializeOutlineIndex(atlases: readonly OutlineAtlasInfo[]): string {
  const lines = atlases.map((atlas, index) => `    ${JSON.stringify(atlas)}${index < atlases.length - 1 ? ',' : ''}`);
  return ['{', '  "atlases": [', ...lines, '  ]', '}', ''].join('\n');
}
