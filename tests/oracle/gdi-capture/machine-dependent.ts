// What of the compared GDI outputs depends on the Windows at hand rather than on GDI's rules, and the
// canonical forms that leave it out (README.md "Another Windows"). run.mjs compares these forms, so a
// Windows other than the references' passes when everything the references guarantee is equal, and
// fails when anything else differs. Pure functions, tested on every system by
// tests/conformance/gdi/machine-dependent.test.ts. Erasable TypeScript only (run.mjs loads it with
// Node's type stripping). Owner: T2.
//
// The other-font bytes. In the raster faces Windows draws the control bytes $00-$08, $0B and $0E-$1B
// from a fallback font, not from the face (trap15-b 6.7: "a narrow box"; docs/porting/errata/T2.md
// section 2). Which fallback font, and how it is drawn, depends on the Windows: Windows 11 10.0.26300
// (the references) paints an anti-aliased box 4 pixels wide, Windows Server 10.0.26100 (GitHub's
// runner, CI run 44919519853) a box 6 pixels wide without anti-aliasing. That run differed from the
// references in 24 outputs, and in nothing but these bytes: their glyph pixels in 24 raster atlases
// (and so the atlases' glyphWidth and blankBytes in metrics.json), the length of their underline and
// strike-out line (lineExceptions), the cell they fill between "A" and "B" (spots.json controlBytes),
// and, because the capture used to let them decide whether a style rule holds, four italic cells
// marked "ruleHolds": false. Every advance, every pixel of every other byte, the metric table, the
// primitives and the text suite were equal. The port draws these bytes from the atlases as blank (they
// are blankBytes there) and the text cases with them are the machine-dependent suite text-control, so
// the references never promised their pixels. Their advances are the face's and stay compared.

/** The bytes a raster face leaves to a fallback font: $00-$08, $0B, $0E-$1B (capture.cpp otherFontByte). */
export const OTHER_FONT_BYTES: readonly number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
];
const otherFont = new Set(OTHER_FONT_BYTES);

/** The fields of a raster atlas the canonical form needs (tests/conformance/gdi/pix.ts decodeAtlas). */
export interface AtlasGlyphs {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly glyphWidth: number;
  readonly advances: Uint8Array;
  glyph(ch: number): Uint8Array;
}

/** The inked pixels of one glyph as "x,y" points, independent of the atlas' glyph width. */
function inked(atlas: AtlasGlyphs, ch: number): string {
  const g = atlas.glyph(ch);
  const points: string[] = [];
  for (let y = 0; y < atlas.cellHeight; y++)
    for (let x = 0; x < atlas.glyphWidth; x++) if (g[y * atlas.glyphWidth + x]) points.push(`${x},${y}`);
  return points.join(' ');
}

/**
 * Canonical form of a raster atlas: the cell, all 256 advances and the pixels of every byte, or with
 * `exceptOtherFont` of every byte but the other-font bytes. The glyph width of the file is not part of
 * it (it only says how wide the widest glyph is, which the pixels already say).
 */
export function canonicalAtlas(atlas: AtlasGlyphs, exceptOtherFont: boolean): string {
  const glyphs: string[] = [];
  for (let ch = 0; ch < 256; ch++) glyphs.push(exceptOtherFont && otherFont.has(ch) ? '' : inked(atlas, ch));
  return JSON.stringify([atlas.cellWidth, atlas.cellHeight, Array.from(atlas.advances), glyphs]);
}

interface MetricsLike {
  capturedOn?: unknown;
  raster?: {
    atlases?: { glyphWidth?: number; blankBytes?: number[] }[];
    cells?: { lineExceptions?: Record<string, number> }[];
  };
  [key: string]: unknown;
}

/**
 * Canonical form of metrics.json: without capturedOn and, with `exceptOtherFont`, without what the
 * other-font bytes decide: the atlases' glyphWidth, the other-font bytes among blankBytes and in
 * lineExceptions. The metric table (`fonts`), the faces, the rules and every cell's native atlas,
 * factors, line rows and ruleHolds stay.
 */
export function canonicalMetrics(text: string, exceptOtherFont: boolean): string {
  const metrics = JSON.parse(text) as MetricsLike;
  delete metrics.capturedOn;
  if (exceptOtherFont && metrics.raster) {
    for (const atlas of metrics.raster.atlases ?? []) {
      delete atlas.glyphWidth;
      if (atlas.blankBytes) atlas.blankBytes = atlas.blankBytes.filter((b) => !otherFont.has(b));
    }
    for (const cell of metrics.raster.cells ?? []) {
      if (cell.lineExceptions)
        cell.lineExceptions = Object.fromEntries(
          Object.entries(cell.lineExceptions).filter(([b]) => !otherFont.has(Number(b))),
        );
    }
  }
  return JSON.stringify(metrics);
}

interface SpotsLike {
  capturedOn?: unknown;
  sysColors: (number | null)[];
  colourForms: Record<string, unknown>;
  controlBytes?: { byte: number; cellRight?: number; pen: number }[];
  [key: string]: unknown;
}

/**
 * Canonical form of spots.json: without capturedOn; unless `all`, without the theme's system colours
 * (only indices 5, 8, 15 and those above 30 are fixed); with `exceptOtherFont` (default: unless
 * `all`), without the cell the other-font bytes fill (controlBytes[].cellRight; the pen after them
 * stays).
 */
export function canonicalSpots(text: string, all: boolean, exceptOtherFont = !all): string {
  const spots = JSON.parse(text) as SpotsLike;
  delete spots.capturedOn;
  if (!all) {
    spots.sysColors = spots.sysColors.map((c, i) => ([5, 8, 15].includes(i) || i > 30 ? c : null));
    for (const key of Object.keys(spots.colourForms)) {
      const n = parseInt(key, 16);
      if (n & 0x80000000 && ![5, 8, 15].includes(n & 0xff) && (n & 0xff) <= 30) delete spots.colourForms[key];
    }
  }
  if (exceptOtherFont)
    for (const entry of spots.controlBytes ?? []) if (otherFont.has(entry.byte)) delete entry.cellRight;
  return JSON.stringify(spots);
}
