// A metric table and its atlases in memory, answering the two questions of `GlyphProvider`
// (ARCHITECTURE.md 3.5.1): which cell does this font have, and what does this byte look like in it.
//
// - `metrics(font)` is a table lookup: requested name, style and point size give the cell Windows
//   measured and the face Windows used.
// - `glyph(font, ch)` builds the glyph of that face for exactly that cell:
//     * a raster face (Fixedsys, Courier) as Windows makes it, when the table carries T2's rules
//       (docs/porting/errata/T2.md item 2): the native bitmap enlarged by whole factors, then the
//       style applied to the enlarged glyph (bold one pixel wider, italic sheared, underline and
//       strike-out as rows). The result is Windows' glyph pixel for pixel;
//     * any other face from the atlas whose cell is nearest to the measured cell, resampled to it
//       when the sizes differ (a size above the largest atlas uses the largest one); an underline
//       or strike-out without an atlas of its own is the plain glyph plus the line that
//       `scalable/index.json` gives. In a proportional face the width of a letter follows the em.
// - `textOverhang(font)` is how far the opaque box of a text reaches beyond its last character in
//   that font (Windows' simulated bold and italic of the raster faces).
// - `delInHighText(font)` is what the byte $7F is in a text that has a byte of $80 or above
//   (Windows takes it from a fallback font in the outline faces).
//
// Nothing here loads files; fonts/atlas-provider.ts does that and then builds a FontSet.
//
// Owner: SH3.

import type { CellMetrics, FontSpec, Glyph, GlyphProvider } from '../../../contracts';
import { trimGlyph, type FontAtlas } from './atlas';
import {
  emPixels,
  FONT_STYLES,
  metricEntry,
  sizeIndex,
  STYLE_SUFFIX,
  styleOf,
  type FontMetricRows,
  type FontStyle,
  type MetricTable,
  type RasterCell,
} from './metrics';
import { areaAverage, repeatPixels } from './resample';
import type { FallbackGlyphs } from './types';

/** The cell of the default font, Fixedsys 9 at 96 DPI (trap15-a §3.2). Used while no table is loaded. */
export const DEFAULT_CELL: Readonly<CellMetrics> = { colWidth: 8, rowHeight: 15 };

/** The font name used for a requested name that the metric table does not have: the default Options font. */
export const DEFAULT_FONT_NAME = 'Fixedsys';

/** Folder of the raster faces' atlases and folder of the outline faces' atlases (3.5.1). */
export const BITMAP_FOLDER = 'bitmap';
export const SCALABLE_FOLDER = 'scalable';

/** One atlas file with what the font set's lists say about it. */
export interface AtlasFile {
  /** Path relative to the fonts folder, e.g. "bitmap/Fixedsys-15-b.bin". */
  path: string;
  atlas: FontAtlas;
  /** Face and style of the atlas. When absent they are read from the path (`parseAtlasPath`). */
  face?: string;
  style?: FontStyle;
  /** Bytes to draw empty whatever the atlas holds (T2's `blankBytes`). */
  blankBytes?: readonly number[];
  /** The point size the atlas was made for, when the font set's list says it. */
  size?: number;
  /** Width of $7F in a text that has a byte of $80 or above (T2's `delInHighString`). */
  delInHighString?: number;
  /** A plain outline atlas: the underline and the strike-out line as [first row, rows] of its cell. */
  underline?: readonly [number, number];
  strikeOut?: readonly [number, number];
}

/** What an atlas path says: `[<folder>/]<face>-<height>[-<style>].bin`. */
export interface AtlasName {
  folder: string;
  face: string;
  height: number;
  style: FontStyle;
}

/** The path of an atlas file below the fonts folder as 6.5.3 names it. */
export function atlasPath(folder: string, face: string, height: number, style: FontStyle): string {
  const suffix = STYLE_SUFFIX[style];
  return `${folder}/${face}-${height}${suffix ? `-${suffix}` : ''}.bin`;
}

/** Takes an atlas path apart; null when it does not have the form of 6.5.3. T2 adds the cell width
 *  to the height where two atlases would share a name (`Courier_New-16x8-b.bin`). */
export function parseAtlasPath(path: string): AtlasName | null {
  const match = /^(?:(.*)\/)?([^/]+)-(\d+)(?:x\d+)?(?:-([bius]))?\.bin$/i.exec(path);
  if (!match) return null;
  const letter = (match[4] ?? '').toLowerCase();
  const style = FONT_STYLES.find((candidate) => STYLE_SUFFIX[candidate] === letter) as FontStyle;
  return { folder: match[1] ?? '', face: match[2] as string, height: Number(match[3]), style };
}

/** A face name for comparison: letters and digits only, lower case ("Courier New" = "Courier_New"). */
const foldFace = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Windows' style overhang of a raster face (tmOverhang): 1 for bold, half the cell height for italic. */
export function rasterOverhang(style: FontStyle, cellHeight: number): number {
  if (style === 'bold') return 1;
  if (style === 'italic') return Math.floor((cellHeight - 1) / 2);
  return 0;
}

interface LoadedAtlas {
  path: string;
  atlas: FontAtlas;
  /** A raster face: two-colour glyphs that Windows enlarges by whole factors only. */
  raster: boolean;
  blank: ReadonlySet<number> | null;
  /** Point size the atlas was made for, if known. */
  size?: number;
  delInHighString?: number;
  underline?: readonly [number, number];
  strikeOut?: readonly [number, number];
}

/** A font as resolved against the table, with the glyphs built so far. */
interface ResolvedFont {
  cell: CellMetrics;
  overhang: number;
  /** Path of the atlas the glyphs come from, or null. */
  source: string | null;
  /** The glyph of $7F in a text with a byte of $80 or above, when it is not the byte's own glyph. */
  delInHighText: Glyph | null;
  make(ch: number): Glyph;
  glyphs: (Glyph | undefined)[];
}

/** Fonts whose glyphs are kept ready. A program that switches between more fonts than this only pays
 *  for rebuilding glyphs; it never gets a different result. */
const RESOLVED_FONTS_KEPT = 24;

export class FontSet implements GlyphProvider, FallbackGlyphs {
  readonly ready: Promise<void> = Promise.resolve();
  /** What could not be used, in words: atlases that name no face of the table, and the like. */
  readonly problems: string[] = [];

  private readonly namesFolded = new Map<string, string>();
  private readonly byPath = new Map<string, LoadedAtlas>();
  /** Atlases by face index and style. */
  private readonly atlases = new Map<string, LoadedAtlas[]>();
  /** T2's raster rules by face index, style and plain cell. */
  private readonly rasterCells = new Map<string, RasterCell>();
  private readonly rasterFaces = new Set<number>();
  private readonly resolved = new Map<string, ResolvedFont>();
  /** The font of the last request: text output asks for the same font character after character. */
  private last: { font: FontSpec; resolved: ResolvedFont } | null = null;
  private readonly fallbackName: string;

  constructor(
    readonly table: MetricTable,
    atlasFiles: readonly AtlasFile[] = [],
    options: { fallbackName?: string } = {},
  ) {
    for (const name of table.fonts.keys()) {
      if (!this.namesFolded.has(name.toLowerCase())) this.namesFolded.set(name.toLowerCase(), name);
    }
    const wanted = options.fallbackName ?? DEFAULT_FONT_NAME;
    this.fallbackName = this.tableName(wanted) ?? (table.fonts.keys().next().value as string);

    const faceIndex = new Map(table.faces.map((face, index) => [foldFace(face), index]));
    table.faceKinds?.forEach((kind, face) => {
      if (kind === 'raster') this.rasterFaces.add(face);
    });
    for (const file of atlasFiles) {
      const name = parseAtlasPath(file.path);
      const faceName = file.face ?? name?.face;
      const style = file.style ?? name?.style;
      const face = faceName === undefined ? undefined : faceIndex.get(foldFace(faceName));
      if (face === undefined || style === undefined) {
        this.problems.push(`${file.path}: not an atlas of a face of the metric table`);
        continue;
      }
      // Without "faceKinds" the folder or the two-colour format says that a face is a raster face.
      if (!table.faceKinds && ((name?.folder ?? '').endsWith(BITMAP_FOLDER) || !file.atlas.eightBit)) {
        this.rasterFaces.add(face);
      }
      const loaded: LoadedAtlas = {
        path: file.path,
        atlas: file.atlas,
        raster: false,
        blank: file.blankBytes && file.blankBytes.length > 0 ? new Set(file.blankBytes) : null,
        ...(file.size !== undefined ? { size: file.size } : {}),
        ...(file.delInHighString !== undefined ? { delInHighString: file.delInHighString } : {}),
        ...(file.underline ? { underline: file.underline } : {}),
        ...(file.strikeOut ? { strikeOut: file.strikeOut } : {}),
      };
      this.byPath.set(file.path, loaded);
      const key = `${face}/${style}`;
      const list = this.atlases.get(key) ?? [];
      list.push(loaded);
      this.atlases.set(key, list);
    }
    for (const [key, list] of this.atlases) {
      const raster = this.rasterFaces.has(Number(key.slice(0, key.indexOf('/'))));
      for (const loaded of list) loaded.raster = raster;
    }
    for (const cell of table.raster?.cells ?? []) {
      const face = faceIndex.get(foldFace(cell.face));
      if (face !== undefined)
        this.rasterCells.set(rasterKey(face, cell.style, cell.plainCell[0], cell.plainCell[1]), cell);
    }
  }

  /** The name as the table spells it, or undefined: exact first, then without regard to letter case
   *  (Windows compares font names that way). */
  private tableName(name: string): string | undefined {
    return this.table.fonts.has(name) ? name : this.namesFolded.get(name.toLowerCase());
  }

  /** Whether the table has this font name. A name it does not have gets the cells of the fallback name. */
  hasFont(name: string): boolean {
    return this.tableName(name) !== undefined;
  }

  metrics(font: FontSpec): CellMetrics {
    const { cell } = this.resolve(font);
    return { colWidth: cell.colWidth, rowHeight: cell.rowHeight };
  }

  glyph(font: FontSpec, ch: number): Glyph {
    const resolved = this.resolve(font);
    const code = ch & 0xff;
    return (resolved.glyphs[code] ??= resolved.make(code));
  }

  textOverhang(font: FontSpec): number {
    return this.resolve(font).overhang;
  }

  delInHighText(font: FontSpec): Glyph | null {
    return this.resolve(font).delInHighText;
  }

  /** The path of the atlas a font's glyphs come from, or null when the set has none for its face.
   *  For tests and for diagnosis. */
  atlasOf(font: FontSpec): string | null {
    return this.resolve(font).source;
  }

  private resolve(font: FontSpec): ResolvedFont {
    const last = this.last;
    if (last && sameFont(last.font, font)) return last.resolved;
    const style = styleOf(font);
    const size = sizeIndex(font.size);
    const key = `${font.name}\n${style}\n${size}`;
    let resolved = this.resolved.get(key);
    if (!resolved) {
      resolved = this.lookUp(font.name, style, size);
      if (this.resolved.size >= RESOLVED_FONTS_KEPT) {
        this.resolved.delete(this.resolved.keys().next().value as string);
      }
      this.resolved.set(key, resolved);
    }
    this.last = { font: { ...font }, resolved };
    return resolved;
  }

  private lookUp(name: string, style: FontStyle, size: number): ResolvedFont {
    const rows = this.table.fonts.get(this.tableName(name) ?? this.fallbackName) as FontMetricRows;
    const entry = metricEntry(rows, style, size);
    // A cell of no width or height cannot be drawn or divided by; Windows never reports one.
    const cell = { colWidth: Math.max(1, entry.colWidth), rowHeight: Math.max(1, entry.rowHeight) };

    if (this.rasterFaces.has(entry.face)) {
      // Windows' own way to this cell, when the table says it.
      const plain = metricEntry(rows, 'plain', size);
      const rule = this.rasterCells.get(rasterKey(entry.face, style, plain.colWidth, plain.rowHeight));
      const stored = rule?.atlas ? this.byPath.get(rule.atlas) : undefined;
      const native = rule ? this.byPath.get(rule.native) : undefined;
      const overhang = rasterOverhang(style, cell.rowHeight);
      // The rule from the native atlas comes first: it is what T2 checked against Windows for every
      // cell, also for the bytes an atlas stores empty. A stored atlas of the cell serves when the
      // native one is not there.
      if (rule && native) {
        return {
          cell,
          overhang,
          source: native.path,
          delInHighText: null,
          glyphs: [],
          make: (ch) => ruledGlyph(native, rule, style, ch),
        };
      }
      if (rule && stored) {
        return {
          cell,
          overhang,
          source: stored.path,
          delInHighText: null,
          glyphs: [],
          make: (ch) => atlasGlyph(stored, ch),
        };
      }
    }

    // A face without an atlas in the requested style is drawn with its plain atlas: the grid is
    // still the measured one. An underline or strike-out then gets its line from the plain atlas.
    const styled = this.atlases.get(`${entry.face}/${style}`);
    const source = nearestAtlas(styled ?? this.atlases.get(`${entry.face}/plain`) ?? [], cell);
    if (!source) {
      // No atlas for this face: empty cells of the measured size.
      const empty: Glyph = {
        advance: cell.colWidth,
        width: cell.colWidth,
        height: cell.rowHeight,
        coverage: new Uint8Array(cell.colWidth * cell.rowHeight),
      };
      return { cell, overhang: 0, source: null, delInHighText: null, glyphs: [], make: () => empty };
    }
    const line = styled || (style !== 'underline' && style !== 'strikeOut') ? undefined : source[style];
    const scaledLine = line && scaleLine(line, cell.rowHeight, source.atlas.cellHeight);
    // How much larger the em of the requested size is than the em the atlas was drawn for.
    const emRatio = source.size !== undefined && size > 0 ? emPixels(size) / emPixels(source.size) : undefined;
    // $7F from Windows' fallback font: its width is measured for the atlas, and grows with the size
    // like the width of a letter. The glyph itself is not known (it is another font's): no ink.
    let delInHighText: Glyph | null = null;
    if (source.delInHighString !== undefined) {
      const sameCell = source.atlas.cellWidth === cell.colWidth && source.atlas.cellHeight === cell.rowHeight;
      const ratio = sameCell ? 1 : (emRatio ?? cell.colWidth / source.atlas.cellWidth);
      const advance = Math.round(source.delInHighString * ratio);
      const width = Math.max(1, advance);
      const blank: Glyph = { advance, width, height: cell.rowHeight, coverage: new Uint8Array(width * cell.rowHeight) };
      delInHighText = scaledLine ? withLine(blank, scaledLine) : blank;
    }
    return {
      cell,
      overhang: 0,
      source: source.path,
      delInHighText,
      glyphs: [],
      make: (ch) => {
        const glyph = fittedGlyph(source, cell, ch, emRatio);
        return scaledLine ? withLine(glyph, scaledLine) : glyph;
      },
    };
  }
}

const rasterKey = (face: number, style: FontStyle, width: number, height: number) =>
  `${face}/${style}/${width}x${height}`;

function sameFont(a: FontSpec, b: FontSpec): boolean {
  return (
    a.name === b.name &&
    a.size === b.size &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikeOut === b.strikeOut
  );
}

/**
 * The atlas whose cell is nearest to the measured cell: the one with the same cell if there is one;
 * for a raster face otherwise the largest atlas of which the cell is a whole multiple (Windows
 * enlarges raster fonts by whole factors only, so that atlas is the bitmap Windows enlarged); else
 * the smallest difference in height, then in width, then the larger atlas.
 */
function nearestAtlas(candidates: readonly LoadedAtlas[], cell: CellMetrics): LoadedAtlas | null {
  let best: LoadedAtlas | null = null;
  let bestRank: number[] = [];
  for (const candidate of candidates) {
    const { cellWidth, cellHeight } = candidate.atlas;
    const whole = candidate.raster && cell.colWidth % cellWidth === 0 && cell.rowHeight % cellHeight === 0;
    const rank = [
      whole ? 0 : 1,
      Math.abs(cellHeight - cell.rowHeight),
      Math.abs(cellWidth - cell.colWidth),
      -cellHeight,
      -cellWidth,
    ];
    if (!best || compareRanks(rank, bestRank) < 0) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const difference = (a[i] as number) - (b[i] as number);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The glyph of an atlas as it is stored. */
function atlasGlyph(source: LoadedAtlas, ch: number): Glyph {
  const { atlas } = source;
  const advance = atlas.advances[ch] as number;
  const coverage = source.blank?.has(ch) ? new Uint8Array(atlas.glyphWidth * atlas.cellHeight) : atlas.coverage(ch);
  return trimGlyph(coverage, atlas.glyphWidth, atlas.cellHeight, advance);
}

/**
 * The glyph of the nearest atlas brought to the measured cell (3.5.1): unchanged when the cells are
 * equal, by whole-number pixel repetition for a raster face when the factors are whole, by area
 * averaging otherwise.
 *
 * Area averaging and the advance. An advance as wide as the atlas cell becomes as wide as the
 * measured cell: that is every glyph of a fixed-pitch face, and the "W" of a proportional one,
 * whose width at every size is what the metric table holds. Any other advance belongs to a letter
 * of the proportional face; Windows was not asked for it at this size, so it is estimated: it grows
 * with the em (`emRatio`, known when the font set's list gives the atlas its point size), as the
 * advances of an outline font do. Without `emRatio` it grows like the cell. The picture of a glyph
 * is stretched with its advance.
 */
function fittedGlyph(source: LoadedAtlas, cell: CellMetrics, ch: number, emRatio?: number): Glyph {
  const { atlas, raster } = source;
  const { cellWidth, cellHeight, glyphWidth } = atlas;
  const { colWidth, rowHeight } = cell;
  if (cellWidth === colWidth && cellHeight === rowHeight) return atlasGlyph(source, ch);
  const advance = atlas.advances[ch] as number;
  const coverage = source.blank?.has(ch) ? new Uint8Array(glyphWidth * cellHeight) : atlas.coverage(ch);
  if (raster && colWidth % cellWidth === 0 && rowHeight % cellHeight === 0) {
    const kx = colWidth / cellWidth;
    const ky = rowHeight / cellHeight;
    return trimGlyph(repeatPixels(coverage, glyphWidth, cellHeight, kx, ky), glyphWidth * kx, rowHeight, advance * kx);
  }
  const cellRatio = colWidth / cellWidth;
  let fitted = 0;
  if (advance === cellWidth || (advance > 0 && emRatio === undefined)) {
    fitted = Math.max(1, Math.round(advance * cellRatio));
  } else if (advance > 0) {
    fitted = Math.round(advance * (emRatio as number)); // may be 0 at a tiny size, as on Windows
  }
  const stretch = fitted > 0 ? fitted / advance : cellRatio;
  const width = Math.max(1, Math.round(glyphWidth * stretch));
  return trimGlyph(areaAverage(coverage, glyphWidth, cellHeight, width, rowHeight), width, rowHeight, fitted);
}

/**
 * A glyph of a raster face as Windows makes it (docs/porting/errata/T2.md item 2, measured against
 * GDI for every face, style and size): with P(x, y) = native(floor(x / kx), floor(y / ky)),
 *   bold       P(x, y) | P(x - 1, y), advance + 1 unless the native advance is 0;
 *   italic     P(x - (floor((h - 1) / 2) - floor(y / 2)), y), h the cell height;
 *   underline, strike-out   P plus the rows of the rule, across the byte's advance (or the length
 *                           the rule gives for this byte).
 */
function ruledGlyph(native: LoadedAtlas, rule: RasterCell, style: FontStyle, ch: number): Glyph {
  const { atlas } = native;
  const { kx, ky } = rule;
  const nativeWidth = atlas.glyphWidth;
  const height = atlas.cellHeight * ky;
  const nativeAdvance = atlas.advances[ch] as number;
  const lean = style === 'italic' ? Math.floor((height - 1) / 2) : 0;
  const bold = style === 'bold';
  const advance = kx * nativeAdvance + (bold && nativeAdvance > 0 ? 1 : 0);
  const width = Math.max(nativeWidth * kx + (bold ? 1 : 0) + lean, advance);
  const coverage = new Uint8Array(width * height);
  if (!native.blank?.has(ch)) {
    const pixels = atlas.coverage(ch);
    for (let y = 0; y < height; y++) {
      const sourceRow = Math.floor(y / ky) * nativeWidth;
      const row = y * width + (lean ? lean - Math.floor(y / 2) : 0);
      for (let x = 0; x < nativeWidth; x++) {
        if (pixels[sourceRow + x] === 0) continue;
        coverage.fill(255, row + x * kx, row + (x + 1) * kx + (bold ? 1 : 0));
      }
    }
  }
  if (style === 'underline' || style === 'strikeOut') {
    const length = Math.min(width, rule.lineExceptions[ch] ?? advance);
    for (const row of rule.lineRows) {
      if (row < height) coverage.fill(255, row * width, row * width + length);
    }
  }
  return trimGlyph(coverage, width, height, advance);
}

/** A line given in rows of an atlas cell, in rows of the measured cell. */
function scaleLine(line: readonly [number, number], rowHeight: number, atlasHeight: number): [number, number] {
  if (rowHeight === atlasHeight) return [line[0], line[1]];
  return [
    Math.round((line[0] * rowHeight) / atlasHeight),
    Math.max(1, Math.round((line[1] * rowHeight) / atlasHeight)),
  ];
}

/** The glyph with a line of full coverage across its advance. The line may lie below the cell
 *  (Windows draws the underline of an outline font there); the glyph is then that much higher. */
function withLine(glyph: Glyph, [top, rows]: readonly [number, number]): Glyph {
  if (glyph.advance === 0 || rows === 0) return glyph;
  const width = Math.max(glyph.width, glyph.advance);
  const height = Math.max(glyph.height, top + rows);
  const coverage = new Uint8Array(width * height);
  for (let y = 0; y < glyph.height; y++) {
    coverage.set(glyph.coverage.subarray(y * glyph.width, (y + 1) * glyph.width), y * width);
  }
  for (let y = top; y < top + rows; y++) coverage.fill(255, y * width, y * width + glyph.advance);
  return { advance: glyph.advance, width, height, coverage };
}
