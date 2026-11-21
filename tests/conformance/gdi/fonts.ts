// Glyphs from the committed font data (app/public/fonts), for the GDI conformance tests. Owner: T2.
//
// This is the tests' own small reader of metrics.json and the atlases, written from the rules that
// metrics.json states (ARCHITECTURE.md 3.5.1, tests/oracle/gdi-capture/README.md). It is not the
// port's GlyphProvider (SH3 owns that); it exists so that the references can be checked against
// GDI's own pictures, and so that the Surface's textOut can be tested before SH3's provider exists.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeAtlas, type Atlas } from './pix';

export const FONTS_DIR = fileURLToPath(new URL('../../../app/public/fonts/', import.meta.url));

export const STYLE_NAMES = ['plain', 'bold', 'italic', 'underline', 'strikeOut'] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

export interface RasterCell {
  face: string;
  style: StyleName;
  plainCell: [number, number];
  native: string;
  kx: number;
  ky: number;
  atlas: string | null;
  lineRows: number[];
  lineExceptions: Record<string, number>;
}

export interface Metrics {
  capturedOn: Record<string, unknown>;
  faces: string[];
  faceKinds: ('raster' | 'outline')[];
  fonts: Record<string, Record<StyleName, [number, number, number][]>>;
  raster: {
    atlases: {
      file: string;
      face: string;
      style: StyleName;
      cellWidth: number;
      cellHeight: number;
      glyphWidth: number;
      overhang: number;
      blankBytes: number[];
    }[];
    cells: RasterCell[];
  };
}

export interface ScalableEntry {
  file: string;
  face: string;
  style: 'plain' | 'bold' | 'italic';
  size: number;
  cellWidth: number;
  cellHeight: number;
  glyphWidth: number;
  underline?: [number, number];
  strikeOut?: [number, number];
  /** Width of $7F in a string that has a byte of $80 or above (a fallback glyph; text-model.ts). */
  delInHighString?: number;
}

export function loadMetrics(): Metrics {
  return JSON.parse(readFileSync(FONTS_DIR + 'metrics.json', 'utf8')) as Metrics;
}

export function loadScalableIndex(): ScalableEntry[] {
  return (JSON.parse(readFileSync(FONTS_DIR + 'scalable/index.json', 'utf8')) as { atlases: ScalableEntry[] }).atlases;
}

let scalableIndex: ScalableEntry[] | undefined;

/**
 * The outline atlas entry of an outline-face request, found by face, style and cell as the port's
 * provider finds it (underline and strike-out use the plain atlas), or undefined at a size that has
 * no atlas.
 */
export function outlineEntry(metrics: Metrics, font: FontRequest): ScalableEntry | undefined {
  const base = font.style >= 3 ? { ...font, style: 0 } : font;
  const cell = cellOf(metrics, base);
  scalableIndex ??= loadScalableIndex();
  return scalableIndex.find(
    (e) =>
      e.face === cell.face &&
      e.style === STYLE_NAMES[base.style] &&
      e.cellWidth === cell.colWidth &&
      e.cellHeight === cell.rowHeight,
  );
}

const atlasCache = new Map<string, Atlas>();
export function loadAtlas(file: string): Atlas {
  let atlas = atlasCache.get(file);
  if (!atlas) {
    atlas = decodeAtlas(new Uint8Array(readFileSync(FONTS_DIR + file)));
    atlasCache.set(file, atlas);
  }
  return atlas;
}

export interface TestGlyph {
  advance: number;
  width: number;
  height: number;
  coverage: Uint8Array; // width * height, 0..255
}

export interface FontRequest {
  name: string;
  size: number;
  style: number; // 0-4 as in task 21's single style
}

/** [colWidth, rowHeight, face] of a request, as measured on Windows. */
export function cellOf(
  metrics: Metrics,
  font: FontRequest,
): { colWidth: number; rowHeight: number; face: string; kind: string } {
  const entry = metrics.fonts[font.name]?.[STYLE_NAMES[font.style] as StyleName]?.[font.size];
  if (!entry) throw new Error(`metrics.json has no entry for ${font.name} ${font.style} ${font.size}`);
  return {
    colWidth: entry[0],
    rowHeight: entry[1],
    face: metrics.faces[entry[2]] as string,
    kind: metrics.faceKinds[entry[2]] as string,
  };
}

/** A raster glyph made by the rules of metrics.json from the native atlas (or the stored atlas). */
export function rasterGlyph(metrics: Metrics, font: FontRequest, byte: number): TestGlyph {
  const style = STYLE_NAMES[font.style] as StyleName;
  const plain = metrics.fonts[font.name]?.plain[font.size];
  const face = cellOf(metrics, font).face;
  if (!plain) throw new Error(`no metrics for ${font.name} ${font.size}`);
  const cell = metrics.raster.cells.find(
    (c) => c.face === face && c.style === style && c.plainCell[0] === plain[0] && c.plainCell[1] === plain[1],
  );
  if (!cell) throw new Error(`no raster cell for ${face} ${style} ${plain[0]}x${plain[1]}`);
  const native = loadAtlas(cell.native);
  const nativeInfo = metrics.raster.atlases.find((a) => a.file === cell.native);
  const blank = nativeInfo?.blankBytes.includes(byte) ?? false;
  const { kx, ky } = cell;
  const height = native.cellHeight * ky;
  const n = native.glyph(byte);
  const nAdv = native.advances[byte] as number;
  const P = (x: number, y: number) =>
    x < 0 || y < 0 || x >= native.glyphWidth * kx || y >= height || blank
      ? 0
      : (n[Math.floor(y / ky) * native.glyphWidth + Math.floor(x / kx)] as number);
  let advance = kx * nAdv;
  let width = native.glyphWidth * kx;
  if (style === 'bold') {
    if (nAdv > 0) advance += 1;
    width += 1;
  } else if (style === 'italic') width += Math.floor((height - 1) / 2);
  width = Math.max(width, advance);
  const coverage = new Uint8Array(width * height);
  const lineLength = cell.lineExceptions[String(byte)] ?? advance;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v: number;
      if (style === 'bold') v = P(x, y) | P(x - 1, y);
      else if (style === 'italic') v = P(x - (Math.floor((height - 1) / 2) - Math.floor(y / 2)), y);
      else {
        v = P(x, y);
        if ((style === 'underline' || style === 'strikeOut') && cell.lineRows.includes(y) && x < lineLength) v = 255;
      }
      coverage[y * width + x] = v;
    }
  }
  return { advance, width, height, coverage };
}

export { ZERO_WIDTH_BYTES } from './cases';
