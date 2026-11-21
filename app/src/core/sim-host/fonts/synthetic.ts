// A synthetic font set for tests, in the file formats of the real one.
//
// The real `metrics.json` and atlases are measured and captured on Windows by T2 and live in
// `app/public/fonts/`. Tests of the text screen must not depend on those files, so this module
// makes a complete stand-in from nothing: a metric table for the seven font names of task 21 and
// atlases for six faces (two raster, three fixed-pitch outline, one proportional). The glyphs are
// a plain 5 x 7 dot-matrix design drawn for this file; they are legible, which makes a screenshot
// of a test checkable by eye.
//
// Two layouts:
// - `listed` (the default) is the layout of T2's files (docs/porting/errata/T2.md): plain atlases
//   of the raster faces at their native sizes with the rules by which every other raster cell and
//   style is made (`raster` in metrics.json); plain, bold and italic atlases of the outline faces,
//   listed in `scalable/index.json` together with the underline and strike-out line of each;
// - `plain` has only what ARCHITECTURE.md 6.5.3 describes: one atlas per face, cell and style,
//   found by the file names of 3.5.1, and no lists.
//
// The cell sizes of the common point sizes are the ones trap15-b 5.7 reports for Windows 11, so
// that the default grid is the real one (Fixedsys 9 = 8 x 15, 80 x 32 cells); everything else is
// invented and says nothing about Windows.
//
// Never imported by the application.
//
// Owner: SH3.

import type { Bytes } from '../../../contracts';
import { ATLAS_GLYPHS, encodeAtlas, type FontAtlas } from './atlas';
import { METRICS_FILE, OUTLINE_ATLAS_SIZES, OUTLINE_INDEX_FILE, type FontFileLoader } from './atlas-provider';
import { atlasPath, BITMAP_FOLDER, SCALABLE_FOLDER } from './font-set';
import {
  FONT_STYLES,
  POINT_SIZES,
  serializeMetricTable,
  serializeOutlineIndex,
  STYLE_SUFFIX,
  type FontMetricRows,
  type FontStyle,
  type MetricTable,
  type OutlineAtlasInfo,
  type RasterAtlasInfo,
  type RasterCell,
} from './metrics';

// ---- the glyph design ------------------------------------------------------------------------------

/** Rows of a 5 x 7 design, top to bottom, two hex digits each; bit 4 is the left column. */
const DESIGN: Readonly<Record<string, string>> = {
  ' ': '00000000000000',
  '!': '04040404040004',
  '"': '0A0A0A00000000',
  '#': '0A0A1F0A1F0A0A',
  $: '040F140E051E04',
  '%': '18190204081303',
  '&': '0C12140815120D',
  "'": '0C040800000000',
  '(': '02040808080402',
  ')': '08040202020408',
  '*': '0004150E150400',
  '+': '0004041F040400',
  ',': '000000000C0408',
  '-': '0000001F000000',
  '.': '00000000000C0C',
  '/': '00010204081000',
  '0': '0E11131519110E',
  '1': '040C040404040E',
  '2': '0E11010204081F',
  '3': '1F02040201110E',
  '4': '02060A121F0202',
  '5': '1F101E0101110E',
  '6': '0608101E11110E',
  '7': '1F010204080808',
  '8': '0E11110E11110E',
  '9': '0E11110F01020C',
  ':': '000C0C000C0C00',
  ';': '000C0C000C0408',
  '<': '02040810080402',
  '=': '00001F001F0000',
  '>': '08040201020408',
  '?': '0E110102040004',
  '@': '0E11010D15150E',
  A: '0E11111F111111',
  B: '1E11111E11111E',
  C: '0E11101010110E',
  D: '1C12111111121C',
  E: '1F10101E10101F',
  F: '1F10101E101010',
  G: '0E11101711110F',
  H: '1111111F111111',
  I: '0E04040404040E',
  J: '0702020202120C',
  K: '11121418141211',
  L: '1010101010101F',
  M: '111B1515111111',
  N: '11111915131111',
  O: '0E11111111110E',
  P: '1E11111E101010',
  Q: '0E11111115120D',
  R: '1E11111E141211',
  S: '0F10100E01011E',
  T: '1F040404040404',
  U: '1111111111110E',
  V: '11111111110A04',
  W: '1111111515150A',
  X: '11110A040A1111',
  Y: '11110A04040404',
  Z: '1F01020408101F',
  '[': '0E08080808080E',
  '\\': '00100804020100',
  ']': '0E02020202020E',
  '^': '040A1100000000',
  _: '0000000000001F',
  '`': '08040200000000',
  a: '00000E010F110F',
  b: '1010161911111E',
  c: '00000E1010110E',
  d: '01010D1311110F',
  e: '00000E111F100E',
  f: '0609081C080808',
  g: '00000F110F010E',
  h: '10101619111111',
  i: '04000C0404040E',
  j: '0200060202120C',
  k: '10101214181412',
  l: '0C04040404040E',
  m: '00001A15151111',
  n: '00001619111111',
  o: '00000E1111110E',
  p: '00001E111E1010',
  q: '00000D130F0101',
  r: '00001619101010',
  s: '00000E100E011E',
  t: '08081C08080906',
  u: '0000111111130D',
  v: '00001111110A04',
  w: '0000111115150A',
  x: '0000110A040A11',
  y: '000011110F010E',
  z: '00001F0204081F',
  '{': '02040408040402',
  '|': '04040404040404',
  '}': '08040402040408',
  '~': '00000815020000',
};

const DESIGN_WIDTH = 5;
const DESIGN_HEIGHT = 7;

/** The 5 x 7 design of a byte as rows of bits (bit 4 = left). Bytes without a letter design get a
 *  frame with their eight bits as dots inside, so that every byte looks different. */
function designRows(ch: number): number[] {
  const drawn = ch >= 0x20 && ch < 0x7f ? DESIGN[String.fromCharCode(ch)] : undefined;
  if (drawn) return Array.from({ length: DESIGN_HEIGHT }, (_, row) => parseInt(drawn.slice(row * 2, row * 2 + 2), 16));
  const rows = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f];
  for (let bit = 0; bit < 8; bit++) {
    if (ch & (0x80 >> bit)) {
      const row = 1 + (bit >> 1);
      rows[row] = (rows[row] as number) | (bit & 1 ? 0x02 : 0x08);
    }
  }
  return rows;
}

/** Columns of the design that carry ink: [first, last], or null for an empty design. */
function inkColumns(rows: readonly number[]): [number, number] | null {
  const all = rows.reduce((bits, row) => bits | row, 0);
  if (all === 0) return null;
  let first = 0;
  while (!(all & (0x10 >> first))) first++;
  let last = DESIGN_WIDTH - 1;
  while (!(all & (0x10 >> last))) last--;
  return [first, last];
}

// ---- the faces -------------------------------------------------------------------------------------

interface SyntheticFace {
  name: string;
  raster: boolean;
  proportional: boolean;
  /** Coverage of the pixels next to the ink in an outline face (a stand-in for anti-aliasing). */
  edge: number;
  /** The cell at a point size: [colWidth, rowHeight]. */
  cell(size: number): [number, number];
}

/** Pixels per em at a point size (96 DPI); size 0 stands for "the system's default height", 12 points here. */
const em = (size: number) => Math.round(((size === 0 ? 12 : size) * 96) / 72);

/** A cell rule for an outline face: measured cells for the dialog sizes (trap15-b §5.7), a ratio for the rest. */
function outlineCell(measured: Readonly<Record<number, [number, number]>>, widthRatio: number, heightRatio: number) {
  return (size: number): [number, number] =>
    measured[size] ?? [Math.max(1, Math.round(em(size) * widthRatio)), Math.max(1, Math.round(em(size) * heightRatio))];
}

const FACES: readonly SyntheticFace[] = [
  {
    name: 'Fixedsys',
    raster: true,
    proportional: false,
    edge: 0,
    // trap15-b §5.7: 8 x 15 from 8 to 16 points, 16 x 30 at 18. The 24 x 45 cell has no atlas.
    cell: (size) => (size < 18 ? [8, 15] : size < 34 ? [16, 30] : [24, 45]),
  },
  {
    name: 'Courier',
    raster: true,
    proportional: false,
    edge: 0,
    // trap15-b §5.7: 10, 12 and 15 points are 8 x 13, 9 x 16 and 12 x 20. The 24 x 40 cell has no atlas.
    cell: (size) => (size < 11 ? [8, 13] : size < 14 ? [9, 16] : size < 30 ? [12, 20] : [24, 40]),
  },
  {
    name: 'Courier New',
    raster: false,
    proportional: false,
    edge: 64,
    cell: outlineCell(
      { 8: [7, 14], 9: [7, 15], 10: [8, 16], 11: [9, 17], 12: [10, 18], 14: [11, 21], 16: [13, 23], 18: [14, 27] },
      0.6,
      1.133,
    ),
  },
  {
    name: 'Lucida Console',
    raster: false,
    proportional: false,
    edge: 96,
    cell: outlineCell(
      { 8: [7, 11], 9: [7, 12], 10: [8, 13], 11: [9, 15], 12: [10, 16], 14: [11, 19], 16: [13, 21], 18: [14, 24] },
      0.6,
      1.0,
    ),
  },
  {
    name: 'Consolas',
    raster: false,
    proportional: false,
    edge: 48,
    cell: outlineCell(
      { 8: [6, 13], 9: [7, 14], 10: [7, 15], 11: [8, 18], 12: [9, 19], 14: [10, 22], 16: [12, 24], 18: [13, 28] },
      0.55,
      1.17,
    ),
  },
  { name: 'Arial', raster: false, proportional: true, edge: 80, cell: outlineCell({}, 0.94, 1.15) },
];

/** The seven font names of task 21, as the original spells them, with the face each resolves to.
 *  The misspelt name and `Terminal` resolve to a proportional face, as on Windows 11 (trap15-b §5.7). */
export const SYNTHETIC_FONTS: Readonly<Record<string, string>> = {
  Fixedsys: 'Fixedsys',
  Courier: 'Courier',
  'Courier New': 'Courier New',
  'Lucida Console': 'Lucida Console',
  'Lucida Sans Typerwriter': 'Arial',
  Consolas: 'Consolas',
  Terminal: 'Arial',
};

/** Which files and lists the set has; see the head of this file. */
export type SyntheticLayout = 'listed' | 'plain';

/**
 * The cell of a face at a point size in a style. Bold Arial is one pixel wider, so that a style can
 * change the grid. In the `listed` layout the bold of a raster face is one pixel wider as well:
 * that is Windows' rule for it (the advance grows by one), which the layout's raster rules state.
 */
function cellOf(face: SyntheticFace, size: number, style: FontStyle, layout: SyntheticLayout): [number, number] {
  const [width, height] = face.cell(size);
  const wider = style === 'bold' && (face.proportional || (face.raster && layout === 'listed'));
  return wider ? [width + 1, height] : [width, height];
}

// ---- drawing an atlas ------------------------------------------------------------------------------

/** How far the top row of an italic glyph leans to the right, in pixels. */
const overhangOf = (cellHeight: number) => Math.max(1, cellHeight >> 3);

function drawAtlas(face: SyntheticFace, cellWidth: number, cellHeight: number, style: FontStyle): FontAtlas {
  const overhang = style === 'italic' ? overhangOf(cellHeight) : 0;
  const glyphWidth = cellWidth + overhang;
  // The design is enlarged by a whole factor and centred in the cell.
  const k = Math.max(
    1,
    Math.min(Math.floor(cellWidth / (DESIGN_WIDTH + 1)), Math.floor(cellHeight / (DESIGN_HEIGHT + 2))),
  );
  const top = Math.max(0, (cellHeight - DESIGN_HEIGHT * k) >> 1);
  const advances = new Uint8Array(ATLAS_GLYPHS);
  const glyphs: Uint8Array[] = [];

  for (let ch = 0; ch < ATLAS_GLYPHS; ch++) {
    const rows = designRows(ch);
    const ink = inkColumns(rows);
    // A proportional face gives every glyph the width of its ink plus a gap; 'W' fills the cell.
    const inkWidth = ink ? ink[1] - ink[0] + 1 : 2;
    const advance = face.proportional
      ? Math.max(1, Math.round((cellWidth * (inkWidth + 1)) / (DESIGN_WIDTH + 1)))
      : cellWidth;
    // Centred in the cell; an italic design stands at the right edge, so that its leaning top
    // reaches beyond the cell (the overhang of 6.5.3).
    const room = Math.max(0, cellWidth - DESIGN_WIDTH * k);
    const left = face.proportional ? 0 : overhang ? room : room >> 1;
    const firstColumn = face.proportional && ink ? ink[0] : 0;
    const pixels = new Uint8Array(glyphWidth * cellHeight);
    const set = (x: number, y: number, value: number) => {
      if (x >= 0 && x < glyphWidth && y >= 0 && y < cellHeight) {
        const at = y * glyphWidth + x;
        if (value > (pixels[at] as number)) pixels[at] = value;
      }
    };
    for (let row = 0; row < DESIGN_HEIGHT; row++) {
      for (let column = firstColumn; column < DESIGN_WIDTH; column++) {
        if (!((rows[row] as number) & (0x10 >> column))) continue;
        for (let dy = 0; dy < k; dy++) {
          const y = top + row * k + dy;
          // Italic: the higher the row, the further right.
          const lean = overhang ? Math.floor(((cellHeight - 1 - y) * (overhang + 1)) / cellHeight) : 0;
          for (let dx = 0; dx < k; dx++) {
            const x = left + (column - firstColumn) * k + dx + lean;
            set(x, y, 255);
            if (style === 'bold') set(x + 1, y, 255);
          }
        }
      }
    }
    if (style === 'underline')
      for (let x = 0; x < advance; x++) set(x, Math.min(cellHeight - 1, top + DESIGN_HEIGHT * k + 1), 255);
    if (style === 'strikeOut') for (let x = 0; x < advance; x++) set(x, top + 3 * k, 255);
    if (!face.raster) {
      // Soft edges: every empty pixel beside or below ink gets the face's edge coverage.
      const solid = pixels.slice();
      for (let y = 0; y < cellHeight; y++) {
        for (let x = 0; x < glyphWidth; x++) {
          if (solid[y * glyphWidth + x] !== 255) continue;
          set(x + 1, y, face.edge);
          set(x, y + 1, face.edge);
        }
      }
    }
    advances[ch] = advance;
    glyphs.push(pixels);
  }
  return {
    cellWidth,
    cellHeight,
    glyphWidth,
    eightBit: !face.raster,
    advances,
    coverage: (ch) => glyphs[ch & 0xff] as Uint8Array,
  };
}

// ---- the set ---------------------------------------------------------------------------------------

export interface SyntheticFontOptions {
  /** Default: `listed`, the layout of the real font files. */
  layout?: SyntheticLayout;
  /** Point sizes at which the outline faces get atlases. Default: the ten sizes T2 stores (`listed`)
   *  or the twelve sizes of 3.5.1 (`plain`). */
  outlineSizes?: readonly number[];
}

/** Point sizes at which T2 stores outline atlases (docs/porting/errata/T2.md item 3). */
const LISTED_OUTLINE_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36];
/** Point sizes that give the native cells of the two raster faces: the cells that have atlases. */
const NATIVE_SIZES: Readonly<Record<string, readonly number[]>> = { Fixedsys: [9], Courier: [10, 12, 15] };
/** Control bytes whose glyph the `listed` layout stores empty, as T2's atlases do. */
const BLANK_BYTES: readonly number[] = [1, 3, 4, 5, 6, 7, 8, 11, ...Array.from({ length: 14 }, (_, i) => 14 + i)];
/** Bytes that take no width inside a text (trap15-b 6.7): their underline has no length. */
const ZERO_WIDTH_BYTES: readonly number[] = [9, 10, 13, 28, 29, 30, 31];

/** The metric table of the synthetic set (without the lists of the `listed` layout). */
export function syntheticMetricTable(layout: SyntheticLayout = 'listed'): MetricTable {
  const faces = FACES.map((face) => face.name);
  const fonts = new Map<string, FontMetricRows>();
  for (const [name, faceName] of Object.entries(SYNTHETIC_FONTS)) {
    const faceIndex = faces.indexOf(faceName);
    const face = FACES[faceIndex] as SyntheticFace;
    const rows = {} as Record<FontStyle, Uint16Array>;
    for (const style of FONT_STYLES) {
      const row = new Uint16Array(POINT_SIZES * 3);
      for (let size = 0; size < POINT_SIZES; size++) {
        const [colWidth, rowHeight] = cellOf(face, size, style, layout);
        row.set([colWidth, rowHeight, faceIndex], size * 3);
      }
      rows[style] = row;
    }
    fonts.set(name, rows);
  }
  return { capturedOn: { windows: 'none: synthetic table for tests (fonts/synthetic.ts)' }, faces, fonts };
}

/** The `plain` layout: `bitmap/<face>-<height>[-<style>].bin` and `scalable/<face>-<height>[-<style>].bin`. */
function plainFiles(outlineSizes: readonly number[]): Map<string, Bytes> {
  const atlases = new Map<string, Bytes>();
  for (const face of FACES) {
    // Raster faces: every cell that has an atlas of its own (the largest cell of each is left out on
    // purpose: it is a whole multiple of a smaller one). Outline faces: the listed point sizes.
    const sizes = face.raster ? (face.name === 'Fixedsys' ? [9, 18] : [10, 12, 15]) : outlineSizes;
    for (const style of FONT_STYLES) {
      for (const size of sizes) {
        const [cellWidth, cellHeight] = cellOf(face, size, style, 'plain');
        if (cellWidth > 255 || cellHeight > 255) continue;
        const path = atlasPath(face.raster ? BITMAP_FOLDER : SCALABLE_FOLDER, face.name, cellHeight, style);
        if (!atlases.has(path)) atlases.set(path, encodeAtlas(drawAtlas(face, cellWidth, cellHeight, style)));
      }
    }
  }
  const files = new Map<string, Bytes>([
    [METRICS_FILE, new TextEncoder().encode(serializeMetricTable(syntheticMetricTable('plain')))],
  ]);
  for (const [path, bytes] of atlases) files.set(path, bytes);
  return files;
}

/** The `listed` layout: native raster atlases with their rules, outline atlases with their index. */
function listedFiles(outlineSizes: readonly number[]): Map<string, Bytes> {
  const atlases = new Map<string, Bytes>();
  const rasterAtlases: RasterAtlasInfo[] = [];
  const cells: RasterCell[] = [];
  const outline: OutlineAtlasInfo[] = [];

  for (const face of FACES) {
    if (face.raster) {
      // The native cells, plain; every other cell and every style is made from them by rule.
      const natives = (NATIVE_SIZES[face.name] as readonly number[]).map((size) => {
        const [width, height] = face.cell(size);
        const file = atlasPath(BITMAP_FOLDER, face.name, height, 'plain');
        atlases.set(file, encodeAtlas(drawAtlas(face, width, height, 'plain')));
        rasterAtlases.push({ file, face: face.name, style: 'plain', blankBytes: BLANK_BYTES });
        return { file, width, height };
      });
      const seen = new Set<string>();
      for (let size = 0; size < POINT_SIZES; size++) {
        const [width, height] = face.cell(size);
        if (seen.has(`${width}x${height}`)) continue;
        seen.add(`${width}x${height}`);
        // The largest native cell of which this cell is a whole multiple.
        const native = natives.filter((n) => width % n.width === 0 && height % n.height === 0).at(-1);
        if (!native) continue;
        const [kx, ky] = [width / native.width, height / native.height];
        for (const style of FONT_STYLES) {
          const lined = style === 'underline' || style === 'strikeOut';
          const nativeRow = style === 'underline' ? native.height - 2 : (native.height >> 1) + 1;
          cells.push({
            face: face.name,
            style,
            plainCell: [width, height],
            native: native.file,
            kx,
            ky,
            atlas: style === 'plain' && kx === 1 && ky === 1 ? native.file : null,
            lineRows: lined ? Array.from({ length: ky }, (_, i) => nativeRow * ky + i) : [],
            lineExceptions: lined
              ? Object.fromEntries([[0, 4 * kx], ...ZERO_WIDTH_BYTES.map((byte) => [byte, 0])])
              : {},
          });
        }
      }
    } else {
      for (const size of outlineSizes) {
        for (const style of ['plain', 'bold', 'italic'] as const) {
          const [width, height] = cellOf(face, size, style, 'listed');
          if (width > 255 || height > 255) continue;
          const suffix = STYLE_SUFFIX[style];
          // T2 names the files after the face with `_` for a space.
          const file = `${SCALABLE_FOLDER}/${face.name.replace(/ /g, '_')}-${height}${suffix ? `-${suffix}` : ''}.bin`;
          atlases.set(file, encodeAtlas(drawAtlas(face, width, height, style)));
          const entry: OutlineAtlasInfo = { file, face: face.name, style };
          if (style === 'plain') {
            // Windows draws the underline of some outline fonts below the cell; the set does so at 9 points.
            const rows = height >= 28 ? 2 : 1;
            entry.underline = [size === 9 ? height : height - 2, rows];
            entry.strikeOut = [height >> 1, rows];
          }
          outline.push(entry);
        }
      }
    }
  }

  const table: MetricTable = {
    ...syntheticMetricTable('listed'),
    faceKinds: FACES.map((face) => (face.raster ? 'raster' : 'outline')),
    raster: { atlases: rasterAtlases, cells },
  };
  const text = new TextEncoder();
  const files = new Map<string, Bytes>([
    [METRICS_FILE, text.encode(serializeMetricTable(table))],
    [OUTLINE_INDEX_FILE, text.encode(serializeOutlineIndex(outline))],
  ]);
  for (const [path, bytes] of atlases) files.set(path, bytes);
  return files;
}

/** The files of the synthetic set by path below the fonts folder. */
export function createSyntheticFontFiles(options: SyntheticFontOptions = {}): Map<string, Bytes> {
  return options.layout === 'plain'
    ? plainFiles(options.outlineSizes ?? OUTLINE_ATLAS_SIZES)
    : listedFiles(options.outlineSizes ?? LISTED_OUTLINE_SIZES);
}

/** A file loader over files in memory, as the application's loader is over `app/public/fonts/`. */
export function memoryFontLoader(files: ReadonlyMap<string, Bytes>): FontFileLoader {
  return (path) => Promise.resolve(files.get(path) ?? null);
}
