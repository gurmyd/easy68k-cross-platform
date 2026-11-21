// The glyph provider of the application (ARCHITECTURE.md 3.5.1): loads `metrics.json` and every
// font atlas through an injected file loader and then answers from memory. Text pixels come from
// these data files only - no browser font and no canvas - so they are the same in every browser
// and under Node.
//
// The composition root creates one provider per window and gives it a loader for the files below
// `app/public/fonts/`, for example
//
//   new AtlasGlyphProvider(async (path) => {
//     const response = await fetch(new URL(`fonts/${path}`, document.baseURI));
//     return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
//   });
//
// Which atlas files exist (a web page cannot list a folder):
// - the caller's `options.atlasPaths`, when given; otherwise
// - raster faces: the list `raster.atlases` of `metrics.json`; outline faces: the list in
//   `scalable/index.json` (both written by T2, docs/porting/errata/T2.md);
// - for a font set that has only what 6.5.3 describes (no such lists), the file names 3.5.1 and
//   6.5.3 give, derived from the metric table (`expectedAtlasPaths`). A derived file that does not
//   exist is skipped.
//
// Before `ready` resolves, and when the fonts cannot be loaded at all, the provider answers with
// the cell of the default font (8 x 15) and empty glyphs, so that the host calls of the engine's
// start-up reset, which arrive before any file is loaded (3.3.2), find a usable grid.
//
// Owner: SH3.

import type { Bytes, CellMetrics, FontSpec, Glyph, GlyphProvider } from '../../../contracts';
import { decodeAtlas } from './atlas';
import { atlasPath, BITMAP_FOLDER, DEFAULT_CELL, FontSet, SCALABLE_FOLDER, type AtlasFile } from './font-set';
import { FONT_STYLES, parseMetricTable, parseOutlineIndex, POINT_SIZES, type MetricTable } from './metrics';
import type { StyleOverhang } from './types';

/** Name of the metric table below the fonts folder. */
export const METRICS_FILE = 'metrics.json';
/** Name of the list of outline atlases below the fonts folder. */
export const OUTLINE_INDEX_FILE = `${SCALABLE_FOLDER}/index.json`;

/** Reads one file below the fonts folder (`app/public/fonts/`); resolves to null when there is no such file. */
export type FontFileLoader = (path: string) => Promise<Bytes | null>;

/** The raster faces of 3.5.1, for a metric table that does not say which faces are raster faces. */
export const RASTER_FACES: readonly string[] = ['Fixedsys', 'Courier'];
/** Point sizes at which 3.5.1 gives the outline faces atlases: the dialog sizes and four large ones. */
export const OUTLINE_ATLAS_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36, 48, 72];

export interface AtlasGlyphProviderOptions {
  /** The atlas files to load, as paths below the fonts folder. Overrides every list of the font set. */
  atlasPaths?: readonly string[];
  /** Font name used for a name the metric table does not have. Default: Fixedsys. */
  fallbackName?: string;
}

/** What is known of an atlas file before it is loaded. */
type AtlasEntry = Omit<AtlasFile, 'atlas'>;

function isRasterFace(table: MetricTable, face: number): boolean {
  if (table.faceKinds) return table.faceKinds[face] === 'raster';
  const name = (table.faces[face] as string).toLowerCase();
  return RASTER_FACES.some((raster) => raster.toLowerCase() === name);
}

/**
 * The atlas files that should exist for a metric table according to 3.5.1 and 6.5.3 alone: for a
 * raster face one per distinct cell height and style in `bitmap/`, for an outline face one per
 * listed point size and style in `scalable/`, each named `<face>-<cell height>[-<style>].bin`.
 */
export function expectedAtlasPaths(table: MetricTable, kind: 'raster' | 'outline' | 'all' = 'all'): string[] {
  const paths = new Set<string>();
  for (const rows of table.fonts.values()) {
    for (const style of FONT_STYLES) {
      const row = rows[style];
      for (let size = 0; size < POINT_SIZES; size++) {
        const height = row[size * 3 + 1] as number;
        const face = row[size * 3 + 2] as number;
        // An atlas holds its cell size in one byte each.
        if (height < 1 || height > 255 || (row[size * 3] as number) > 255) continue;
        const name = table.faces[face] as string;
        if (isRasterFace(table, face)) {
          if (kind !== 'outline') paths.add(atlasPath(BITMAP_FOLDER, name, height, style));
        } else if (kind !== 'raster' && OUTLINE_ATLAS_SIZES.includes(size)) {
          paths.add(atlasPath(SCALABLE_FOLDER, name, height, style));
        }
      }
    }
  }
  return [...paths].sort();
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The atlas files of a font set and whether a missing one is a problem (it is when a list names
 * it, not when its name was only derived). `outlineIndex` is the content of `scalable/index.json`,
 * or null when the set has none.
 */
function atlasEntries(
  table: MetricTable,
  outlineIndex: Bytes | null,
  options: AtlasGlyphProviderOptions,
): { entry: AtlasEntry; listed: boolean }[] {
  if (options.atlasPaths) return options.atlasPaths.map((path) => ({ entry: { path }, listed: true }));
  const entries: { entry: AtlasEntry; listed: boolean }[] = [];
  if (table.raster) {
    for (const { file, face, style, blankBytes } of table.raster.atlases) {
      entries.push({ entry: { path: file, face, style, blankBytes }, listed: true });
    }
  } else {
    for (const path of expectedAtlasPaths(table, 'raster')) entries.push({ entry: { path }, listed: false });
  }
  if (outlineIndex) {
    for (const { file, face, style, underline, strikeOut } of parseOutlineIndex(outlineIndex)) {
      const entry: AtlasEntry = { path: file, face, style };
      if (underline) entry.underline = underline;
      if (strikeOut) entry.strikeOut = strikeOut;
      entries.push({ entry, listed: true });
    }
  } else {
    for (const path of expectedAtlasPaths(table, 'outline')) entries.push({ entry: { path }, listed: false });
  }
  return entries;
}

/** Builds the set from what loading gave for each atlas: the bytes, null (no such file) or the failure. */
function buildFontSet(
  table: MetricTable,
  loaded: readonly { entry: AtlasEntry; listed: boolean; result: Bytes | Error | null }[],
  options: AtlasGlyphProviderOptions,
): FontSet {
  const atlasFiles: AtlasFile[] = [];
  const problems: string[] = [];
  for (const { entry, listed, result } of loaded) {
    if (result === null) {
      if (listed) problems.push(`${entry.path}: the file is missing`);
    } else if (result instanceof Error) {
      problems.push(`${entry.path}: ${result.message}`);
    } else {
      try {
        atlasFiles.push({ ...entry, atlas: decodeAtlas(result) });
      } catch (error) {
        problems.push(`${entry.path}: ${messageOf(error)}`);
      }
    }
  }
  const set = new FontSet(
    table,
    atlasFiles,
    options.fallbackName === undefined ? {} : { fallbackName: options.fallbackName },
  );
  set.problems.unshift(...problems);
  return set;
}

/** Builds a `FontSet` from files that are already in memory, by the same rules as the provider. */
export function fontSetFromFiles(files: ReadonlyMap<string, Bytes>, options: AtlasGlyphProviderOptions = {}): FontSet {
  const metrics = files.get(METRICS_FILE);
  if (!metrics) throw new Error(`The fonts have no ${METRICS_FILE}`);
  const table = parseMetricTable(metrics);
  const entries = atlasEntries(table, files.get(OUTLINE_INDEX_FILE) ?? null, options);
  return buildFontSet(
    table,
    entries.map((item) => ({ ...item, result: files.get(item.entry.path) ?? null })),
    options,
  );
}

export class AtlasGlyphProvider implements GlyphProvider, StyleOverhang {
  readonly ready: Promise<void>;
  /** The loaded fonts; null until `ready` has resolved, and for good when loading failed. */
  private fonts: FontSet | null = null;
  private failure: Error | null = null;

  /** Starts loading at once. `ready` rejects when the metric table (or the list of outline atlases)
   *  cannot be read; a single atlas that is missing, damaged or cannot be loaded only leaves its
   *  face without glyphs (see `problems`). */
  constructor(load: FontFileLoader, options: AtlasGlyphProviderOptions = {}) {
    this.ready = this.load(load, options).catch((error: unknown) => {
      this.failure = error instanceof Error ? error : new Error(String(error));
      throw this.failure;
    });
    // The rejection reaches whoever awaits `ready`; without this line a provider nobody awaits yet
    // would count as an unhandled rejection.
    this.ready.catch(() => {});
  }

  private async load(load: FontFileLoader, options: AtlasGlyphProviderOptions): Promise<void> {
    const metrics = await load(METRICS_FILE);
    if (!metrics) throw new Error(`The output fonts could not be loaded: fonts/${METRICS_FILE} is missing.`);
    const table = parseMetricTable(metrics);
    const outlineIndex = options.atlasPaths ? null : await load(OUTLINE_INDEX_FILE);
    const entries = atlasEntries(table, outlineIndex, options);
    // Every atlas is asked for at once; one that cannot be loaded does not stop the others.
    const loaded = await Promise.all(
      entries.map(async (item) => {
        try {
          return { ...item, result: await load(item.entry.path) };
        } catch (error) {
          return { ...item, result: new Error(messageOf(error)) };
        }
      }),
    );
    this.fonts = buildFontSet(table, loaded, options);
  }

  /** True once the metric table and the atlases are in memory. */
  get loaded(): boolean {
    return this.fonts !== null;
  }

  /** What went wrong while loading, in words; empty when everything was usable. */
  get problems(): readonly string[] {
    if (this.failure) return [this.failure.message];
    return this.fonts?.problems ?? [];
  }

  metrics(font: FontSpec): CellMetrics {
    return this.fonts ? this.fonts.metrics(font) : { ...DEFAULT_CELL };
  }

  glyph(font: FontSpec, ch: number): Glyph {
    if (this.fonts) return this.fonts.glyph(font, ch);
    const { colWidth, rowHeight } = DEFAULT_CELL;
    return { advance: colWidth, width: colWidth, height: rowHeight, coverage: new Uint8Array(colWidth * rowHeight) };
  }

  textOverhang(font: FontSpec): number {
    return this.fonts ? this.fonts.textOverhang(font) : 0;
  }

  /** The path of the atlas a font's glyphs come from, or null. For tests and for diagnosis. */
  atlasOf(font: FontSpec): string | null {
    return this.fonts ? this.fonts.atlasOf(font) : null;
  }
}
