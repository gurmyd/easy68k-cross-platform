#!/usr/bin/env node
// `npm run fonts:atlases`: the outline-font atlases of ARCHITECTURE.md 3.5.1. Owner: T2.
//
//     node tools/make-font-atlases.mjs            write app/public/fonts/scalable/*
//     node tools/make-font-atlases.mjs --check    regenerate in memory, compare, exit 1 on any difference
//
// The Windows outline faces the original can end up with (Courier New, Lucida Console, Consolas,
// and Arial, which Windows 11 substitutes for "Lucida Sans Typerwriter" and "Terminal") are not
// redistributable, so their glyphs are drawn from open fonts with the same metrics or look
// (tools/fonts-src/README.md has the sources, hashes and licences):
//
//     Courier New     <- Liberation Mono       Lucida Console <- DejaVu Sans Mono
//     Consolas        <- Inconsolata           Arial          <- Liberation Sans
//
// Placement comes from Windows itself (tools/fonts-src/windows-outline-metrics.tsv, written by
// `npm run oracle:gdi`): the cell (TextWidth("W") x TextHeight("Xp")), the ascent (baseline), the
// advance of every byte, and the underline and strike-out positions. So the text grid and pen
// movement are Windows'; only the glyph pixels are substitutes (3.5.1, R-5).
//
// The TrueType outlines are rasterised by the small, dependency-free rasteriser below (exact area
// coverage of the flattened outline, no hinting). It uses only IEEE arithmetic that is the same on
// every platform, so the files are byte-identical on Windows, macOS and Linux (the --check mode is
// run by the conformance suite on each of them).
//
// Atlas format (6.5.3): "E68F", version 2, cell width, cell height, glyph width, flags = 1 (8-bit
// coverage), 256 advances, 256 glyphs of glyph width x cell height bytes. scalable/index.json lists
// the files.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(repo, 'tools', 'fonts-src');
const OUT = join(repo, 'app', 'public', 'fonts', 'scalable');

/**
 * The point sizes: the Options dialog sizes 8-18 of 3.5.1 and 24 and 36. 48 and 72 pt, and the
 * underline and strike-out atlases, are not stored (75 MB in all); the provider resamples the
 * nearest atlas, and draws underline and strike-out as the line given in index.json over the plain
 * glyph (docs/porting/errata/T2.md, item 3).
 */
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36];
export const STYLES = ['plain', 'bold', 'italic'];
const STYLE_SUFFIX = { plain: '', bold: '-b', italic: '-i' };
const TSV_STYLE = { plain: '-', bold: 'b', italic: 'i', underline: 'u', strikeOut: 's' };

/** Windows face -> the name task 21 asks for (whose measurements are used) and the open font files. */
export const FACES = [
  {
    face: 'Courier New',
    request: 'Courier New',
    files: {
      regular: 'liberation/LiberationMono-Regular.ttf',
      bold: 'liberation/LiberationMono-Bold.ttf',
      italic: 'liberation/LiberationMono-Italic.ttf',
    },
  },
  {
    face: 'Lucida Console',
    request: 'Lucida Console',
    files: {
      regular: 'dejavu/DejaVuSansMono.ttf',
      bold: 'dejavu/DejaVuSansMono-Bold.ttf',
      italic: 'dejavu/DejaVuSansMono-Oblique.ttf',
    },
  },
  {
    face: 'Consolas',
    request: 'Consolas',
    // Inconsolata has no italic: it is slanted by the shear below.
    files: { regular: 'inconsolata/Inconsolata-Regular.ttf', bold: 'inconsolata/Inconsolata-Bold.ttf', italic: null },
  },
  {
    face: 'Arial',
    request: 'Lucida Sans Typerwriter',
    files: {
      regular: 'liberation/LiberationSans-Regular.ttf',
      bold: 'liberation/LiberationSans-Bold.ttf',
      italic: 'liberation/LiberationSans-Italic.ttf',
    },
  },
];
/** Slant of the synthesised italic: x += SHEAR * (height above the baseline). */
const SHEAR = 0.2;

/** Windows-1252 bytes $80-$9F; the five undefined ones map to nothing. */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0, 0,
  0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];
export function codePointOf(byte) {
  if (byte < 0x20) return 0; // control bytes: no glyph (3.5.1, trap15-b 6.7)
  if (byte >= 0x80 && byte < 0xa0) return CP1252_HIGH[byte - 0x80];
  return byte;
}

// ---------------------------------------------------------------------------------------------
// TrueType reading: cmap (3,1) format 4, head, maxp, hhea, hmtx, loca, glyf (simple and composite).

export function parseFont(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = {};
  const numTables = v.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    tables[tag] = { offset: v.getUint32(at + 8), length: v.getUint32(at + 12) };
  }
  for (const t of ['cmap', 'head', 'hhea', 'hmtx', 'loca', 'glyf', 'maxp'])
    if (!tables[t]) throw new Error(`font has no ${t} table`);
  const head = tables.head.offset;
  const unitsPerEm = v.getUint16(head + 18);
  const longLoca = v.getInt16(head + 50) === 1;
  const numGlyphs = v.getUint16(tables.maxp.offset + 4);
  const numHMetrics = v.getUint16(tables.hhea.offset + 34);
  const advanceOf = (g) => v.getUint16(tables.hmtx.offset + 4 * Math.min(g, numHMetrics - 1));
  const locaAt = (g) =>
    longLoca ? v.getUint32(tables.loca.offset + 4 * g) : 2 * v.getUint16(tables.loca.offset + 2 * g);

  // cmap: Windows Unicode BMP subtable, format 4.
  let sub = -1;
  const cmap = tables.cmap.offset;
  for (let i = 0, n = v.getUint16(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    if (v.getUint16(rec) === 3 && v.getUint16(rec + 2) === 1) sub = cmap + v.getUint32(rec + 4);
  }
  if (sub < 0 || v.getUint16(sub) !== 4) throw new Error('font has no Windows Unicode cmap of format 4');
  const segX2 = v.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  function glyphIndex(cp) {
    for (let s = 0; s < segX2; s += 2) {
      const end = v.getUint16(ends + s);
      if (cp > end) continue;
      const start = v.getUint16(starts + s);
      if (cp < start) return 0;
      const delta = v.getInt16(deltas + s);
      const range = v.getUint16(ranges + s);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = v.getUint16(ranges + s + range + 2 * (cp - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }

  /** Contours of glyph g as arrays of { x, y, on } in font units, with an affine transform applied. */
  function contours(g, m = [1, 0, 0, 1, 0, 0], depth = 0) {
    if (g >= numGlyphs || depth > 8) return [];
    const start = locaAt(g);
    const end = locaAt(g + 1);
    if (end <= start) return [];
    let p = tables.glyf.offset + start;
    const nc = v.getInt16(p);
    p += 10;
    const apply = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
    if (nc >= 0) {
      const endPts = [];
      for (let i = 0; i < nc; i++, p += 2) endPts.push(v.getUint16(p));
      const n = nc ? endPts[nc - 1] + 1 : 0;
      p += 2 + v.getUint16(p);
      const flags = [];
      while (flags.length < n) {
        const f = bytes[p++];
        flags.push(f);
        if (f & 8) for (let r = bytes[p++]; r > 0; r--) flags.push(f);
      }
      const xs = [];
      let x = 0;
      for (const f of flags) {
        if (f & 2) x += f & 16 ? bytes[p++] : -bytes[p++];
        else if (!(f & 16)) {
          x += v.getInt16(p);
          p += 2;
        }
        xs.push(x);
      }
      const ys = [];
      let y = 0;
      for (const f of flags) {
        if (f & 4) y += f & 32 ? bytes[p++] : -bytes[p++];
        else if (!(f & 32)) {
          y += v.getInt16(p);
          p += 2;
        }
        ys.push(y);
      }
      const out = [];
      let first = 0;
      for (const last of endPts) {
        const c = [];
        for (let i = first; i <= last; i++) c.push({ ...apply(xs[i], ys[i]), on: (flags[i] & 1) === 1 });
        out.push(c);
        first = last + 1;
      }
      return out;
    }
    // Composite glyph.
    const out = [];
    for (;;) {
      const flags = v.getUint16(p);
      const glyph = v.getUint16(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) {
        dx = v.getInt16(p);
        dy = v.getInt16(p + 2);
        p += 4;
      } else {
        dx = v.getInt8(p);
        dy = v.getInt8(p + 1);
        p += 2;
      }
      if (!(flags & 2)) {
        // point matching is not used by these fonts
        dx = 0;
        dy = 0;
      }
      let a = 1,
        b = 0,
        c = 0,
        d = 1;
      const f2 = (o) => v.getInt16(o) / 16384;
      if (flags & 8) {
        a = d = f2(p);
        p += 2;
      } else if (flags & 0x40) {
        a = f2(p);
        d = f2(p + 2);
        p += 4;
      } else if (flags & 0x80) {
        a = f2(p);
        b = f2(p + 2);
        c = f2(p + 4);
        d = f2(p + 6);
        p += 8;
      }
      // child transform followed by the parent's
      const t = [a, b, c, d, dx, dy];
      const mm = [
        m[0] * t[0] + m[2] * t[1],
        m[1] * t[0] + m[3] * t[1],
        m[0] * t[2] + m[2] * t[3],
        m[1] * t[2] + m[3] * t[3],
        m[0] * t[4] + m[2] * t[5] + m[4],
        m[1] * t[4] + m[3] * t[5] + m[5],
      ];
      out.push(...contours(glyph, mm, depth + 1));
      if (!(flags & 0x20)) break;
    }
    return out;
  }

  return { unitsPerEm, glyphIndex, advanceOf, contours };
}

// ---------------------------------------------------------------------------------------------
// Rasterising: flatten quadratic curves, accumulate exact signed area per pixel (font-rs method).

/** Line segments (x0, y0, x1, y1) of the outline in pixel space, y down. */
function flatten(contoursPx, steps) {
  const segs = [];
  for (const c of contoursPx) {
    if (c.length < 2) continue;
    // Expand implied on-curve points between two off-curve points.
    const pts = [];
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      pts.push(a);
      if (!a.on && !b.on) pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
    }
    let startIndex = pts.findIndex((q) => q.on);
    if (startIndex < 0) continue;
    const ring = pts.slice(startIndex).concat(pts.slice(0, startIndex));
    ring.push(ring[0]);
    let cur = ring[0];
    for (let i = 1; i < ring.length; i++) {
      const q = ring[i];
      if (q.on) {
        segs.push(cur.x, cur.y, q.x, q.y);
        cur = q;
      } else {
        const e = ring[i + 1];
        let px = cur.x;
        let py = cur.y;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          const x = u * u * cur.x + 2 * u * t * q.x + t * t * e.x;
          const y = u * u * cur.y + 2 * u * t * q.y + t * t * e.y;
          segs.push(px, py, x, y);
          px = x;
          py = y;
        }
        cur = e;
        i++;
      }
    }
  }
  return segs;
}

/** Coverage 0..255 of a w x h grid. */
function rasterise(segs, w, h) {
  const acc = new Float64Array(w * h + 2);
  for (let i = 0; i < segs.length; i += 4) {
    let x0 = segs[i],
      y0 = segs[i + 1],
      x1 = segs[i + 2],
      y1 = segs[i + 3];
    if (y0 === y1) continue;
    let dir = 1;
    if (y0 > y1) {
      dir = -1;
      [x0, x1] = [x1, x0];
      [y0, y1] = [y1, y0];
    }
    const dxdy = (x1 - x0) / (y1 - y0);
    let x = x0;
    if (y0 < 0) {
      x -= y0 * dxdy;
      y0 = 0;
    }
    if (y1 > h) y1 = h;
    for (let y = Math.floor(y0); y < Math.ceil(y1) && y < h; y++) {
      if (y < 0) continue;
      const linestart = y * w;
      const dy = Math.min(y + 1, y1) - Math.max(y, y0);
      const xnext = x + dxdy * dy;
      const d = dy * dir;
      let xa = x,
        xb = xnext;
      if (xa > xb) [xa, xb] = [xb, xa];
      const xaf = Math.floor(xa);
      const xai = xaf;
      const xbi = Math.ceil(xb);
      if (xbi <= xai + 1) {
        const xmf = 0.5 * (x + xnext) - xai;
        add(linestart + xai, d - d * xmf);
        add(linestart + xai + 1, d * xmf);
      } else {
        const s = 1 / (xb - xa);
        const x0f = xa - xaf;
        const a0 = 0.5 * s * (1 - x0f) * (1 - x0f);
        const x1f = xb - xbi + 1;
        const am = 0.5 * s * x1f * x1f;
        add(linestart + xai, d * a0);
        if (xbi === xai + 2) add(linestart + xai + 1, d * (1 - a0 - am));
        else {
          const a1 = s * (1.5 - x0f);
          add(linestart + xai + 1, d * (a1 - a0));
          for (let xi = xai + 2; xi < xbi - 1; xi++) add(linestart + xi, d * s);
          const a2 = a1 + (xbi - xai - 3) * s;
          add(linestart + xbi - 1, d * (1 - a2 - am));
        }
        add(linestart + xbi, d * am);
      }
      x = xnext;
    }
  }
  function add(index, value) {
    // The caller leaves margins wide enough that no outline reaches the grid's sides.
    if (index >= 0 && index < acc.length) acc[index] += value;
  }
  // One running sum over the whole buffer, as in font-rs: every row of a closed outline sums to 0.
  const out = new Uint8Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    sum += acc[i];
    out[i] = Math.round(Math.min(1, Math.abs(sum)) * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Windows measurements, keyed "<request>|<style>|<size>". */
export function readWindowsMetrics(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    const [name, style, size, face, colWidth, rowHeight, ppem, , ascent, , , , uPos, uSize, sPos, sSize, advances] = f;
    map.set(`${name}|${style}|${size}`, {
      face,
      colWidth: Number(colWidth),
      rowHeight: Number(rowHeight),
      ppem: Number(ppem),
      ascent: Number(ascent),
      underline: [Number(uPos), Number(uSize)],
      strikeOut: [Number(sPos), Number(sSize)],
      advances: advances.split(',').map(Number),
    });
  }
  return map;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Checks every font file against tools/fonts-src/sources.json before it is used. */
function loadFonts() {
  const sources = JSON.parse(readFileSync(join(SRC, 'sources.json'), 'utf8'));
  const known = new Map();
  for (const archive of sources.archives) for (const file of archive.files) known.set(file.path, file.sha256);
  const cache = new Map();
  return (path) => {
    if (!cache.has(path)) {
      const bytes = readFileSync(join(SRC, path));
      const expected = known.get(path);
      if (!expected) throw new Error(`${path} is not listed in tools/fonts-src/sources.json`);
      if (sha256(bytes) !== expected) throw new Error(`${path}: SHA-256 differs from tools/fonts-src/sources.json`);
      cache.set(path, parseFont(new Uint8Array(bytes)));
    }
    return cache.get(path);
  };
}

/**
 * Keeps every glyph inside Windows' cell. The open fonts are taller than some Windows faces (DejaVu
 * Sans Mono's accented capitals reach 0.93 em and its capitals 0.73 em; Lucida Console's cell top is
 * at 0.79 em), so the accents of À, É, Ö, ... would be cut off above row 0 and those letters would
 * look like A, E, O. Two cases:
 *   - at least 2 pixels between the cap height (the top of "H") and the cell top: for a glyph that
 *     leaves the cell, only its part above the cap height is compressed into that room (as Windows'
 *     own faces flatten the accents of capitals); other glyphs are unchanged;
 *   - less room than that: the whole atlas is scaled vertically so that its tallest glyph reaches
 *     the cell top, keeping the proportions between all letters (Lucida Console's capitals are
 *     lower than DejaVu's anyway).
 * Ink below the baseline that leaves the cell is compressed towards the baseline. Only arithmetic,
 * so the result is the same on every platform. Returns, per glyph outline, the y mapping (font units).
 */
function verticalFit(font, win) {
  const scale = win.ppem / font.unitsPerEm;
  const top = win.ascent / scale; // the cell's top row, in font units above the baseline
  const bottom = (win.rowHeight - win.ascent) / scale; // its bottom, below the baseline
  const yMaxOf = (outline) => Math.max(-Infinity, ...outline.flat().map((p) => p.y));
  const h = font.glyphIndex(0x48);
  const capHeight = h ? yMaxOf(font.contours(h)) : top;
  let tallest = -Infinity;
  for (let byte = 0x20; byte < 256; byte++) {
    const cp = codePointOf(byte);
    const g = cp ? font.glyphIndex(cp) : 0;
    if (g) tallest = Math.max(tallest, yMaxOf(font.contours(g)));
  }
  const uniform = (top - capHeight) * scale < 2 && tallest > top ? top / tallest : 1;
  return (outline) => {
    const ys = outline.flat().map((p) => p.y);
    if (ys.length === 0) return (y) => y;
    const yMax = Math.max(...ys);
    const yMin = Math.min(...ys);
    const kTop = uniform === 1 && yMax > top ? (top - capHeight) / (yMax - capHeight) : 1;
    const kBottom = -yMin > bottom ? bottom / -yMin : 1;
    return (y) =>
      y < 0 ? y * kBottom : uniform !== 1 ? y * uniform : y > capHeight ? capHeight + (y - capHeight) * kTop : y;
  };
}

/** One atlas as bytes, plus its index entry. */
export function makeAtlas(font, synthItalic, win, style) {
  const scale = win.ppem / font.unitsPerEm;
  const cellW = win.colWidth;
  const cellH = win.rowHeight;
  const steps = Math.max(2, Math.min(16, Math.ceil(win.ppem / 6)));
  const margin = Math.ceil(win.ppem * 0.6) + 2;
  const glyphs = [];
  let glyphWidth = Math.max(cellW, ...win.advances);
  const fit = verticalFit(font, win);
  for (let byte = 0; byte < 256; byte++) {
    const advance = win.advances[byte];
    const cp = codePointOf(byte);
    const g = cp ? font.glyphIndex(cp) : 0;
    const gridW = Math.max(advance, cellW) + margin;
    let cov = new Uint8Array(gridW * cellH);
    if (g) {
      // Centre the open font's advance in Windows' advance (monospaced substitutes). The outline is
      // drawn on a grid with `margin` columns on both sides; ink left of the cell is cut off.
      const offset = (advance - font.advanceOf(g) * scale) / 2 + margin;
      const outline = font.contours(g);
      const fitY = fit(outline);
      const px = outline.map((c) =>
        c.map((p) => {
          const up = fitY(p.y) * scale;
          return { x: offset + p.x * scale + (synthItalic ? SHEAR * up : 0), y: win.ascent - up, on: p.on };
        }),
      );
      const wide = rasterise(flatten(px, steps), gridW + margin, cellH);
      for (let y = 0; y < cellH; y++)
        cov.set(wide.subarray(y * (gridW + margin) + margin, (y + 1) * (gridW + margin)), y * gridW);
    }
    if (style === 'underline' || style === 'strikeOut') {
      const [pos, size] = style === 'underline' ? win.underline : win.strikeOut;
      const top = win.ascent - pos;
      for (let y = top; y < top + Math.max(1, size); y++) {
        if (y < 0 || y >= cellH) continue;
        for (let x = 0; x < advance; x++) cov[y * gridW + x] = 255;
      }
    }
    for (let y = 0; y < cellH; y++)
      for (let x = gridW - 1; x >= 0; x--)
        if (cov[y * gridW + x]) {
          glyphWidth = Math.max(glyphWidth, x + 1);
          break;
        }
    glyphs.push({ cov, gridW });
  }
  glyphWidth = Math.min(255, glyphWidth);
  const out = new Uint8Array(9 + 256 + 256 * glyphWidth * cellH);
  out.set([0x45, 0x36, 0x38, 0x46, 2, cellW, cellH, glyphWidth, 1], 0);
  out.set(
    win.advances.map((a) => Math.min(255, a)),
    9,
  );
  let at = 9 + 256;
  for (const { cov, gridW } of glyphs) {
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < glyphWidth; x++) out[at++] = x < gridW ? cov[y * gridW + x] : 0;
    }
  }
  return { bytes: out, cellW, cellH, glyphWidth };
}

export function generate() {
  const metricsText = readFileSync(join(SRC, 'windows-outline-metrics.tsv'), 'utf8');
  const windows = readWindowsMetrics(metricsText);
  const font = loadFonts();
  const files = new Map();
  const index = [];
  for (const spec of FACES) {
    for (const style of STYLES) {
      for (const size of SIZES) {
        const win = windows.get(`${spec.request}|${TSV_STYLE[style]}|${size}`);
        if (!win) throw new Error(`windows-outline-metrics.tsv has no entry for ${spec.request} ${style} ${size}`);
        if (win.face !== spec.face)
          throw new Error(`Windows used ${win.face} for ${spec.request}, expected ${spec.face}`);
        const file =
          style === 'bold'
            ? spec.files.bold
            : style === 'italic'
              ? (spec.files.italic ?? spec.files.regular)
              : spec.files.regular;
        const synth = style === 'italic' && !spec.files.italic;
        const atlas = makeAtlas(font(file), synth, win, style);
        let name = `${spec.face.replaceAll(' ', '_')}-${atlas.cellH}${STYLE_SUFFIX[style]}.bin`;
        if (files.has(name)) {
          const first = index.find((e) => e.file === `scalable/${name}`);
          // Two point sizes with the same cell: keep the first (the provider picks by cell).
          if (first && first.cellWidth === atlas.cellW) continue;
          // Same height, other width: the name also carries the width (docs/porting/errata/T2.md).
          name = `${spec.face.replaceAll(' ', '_')}-${atlas.cellH}x${atlas.cellW}${STYLE_SUFFIX[style]}.bin`;
        }
        files.set(name, atlas.bytes);
        const entry = {
          file: `scalable/${name}`,
          face: spec.face,
          style,
          size,
          cellWidth: atlas.cellW,
          cellHeight: atlas.cellH,
          glyphWidth: atlas.glyphWidth,
          source: file.split('/').pop() + (synth ? ' (slanted)' : ''),
        };
        if (style === 'plain') {
          // Underline and strike-out: rows [top, top + height) of the cell, across each glyph's advance.
          for (const line of ['underline', 'strikeOut']) {
            const w = windows.get(`${spec.request}|${TSV_STYLE[line]}|${size}`);
            entry[line] = [w.ascent - w[line][0], Math.max(1, w[line][1])];
          }
        }
        index.push(entry);
      }
    }
  }
  const json = JSON.stringify(
    {
      about:
        'Outline-face atlases drawn by tools/make-font-atlases.mjs from the open fonts in tools/fonts-src, placed with the Windows measurements of windows-outline-metrics.tsv. 8-bit coverage.',
      atlases: index,
    },
    null,
    2,
  ).replace(/\{\n\s+("file"[\s\S]*?)\n\s+\}/g, (_, body) => `{ ${body.replace(/\n\s+/g, ' ')} }`);
  files.set('index.json', new TextEncoder().encode(json + '\n'));
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const files = generate();
  let differing = 0;
  const existing = existsSync(OUT) ? readdirSync(OUT) : [];
  for (const [name, bytes] of files) {
    const path = join(OUT, name);
    const same = existsSync(path) && Buffer.compare(readFileSync(path), Buffer.from(bytes)) === 0;
    if (same) continue;
    if (check) {
      differing++;
      console.log(`DIFFERENT ${name}`);
    } else {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(path, bytes);
    }
  }
  for (const name of existing) {
    if (files.has(name)) continue;
    if (check) {
      differing++;
      console.log(`no longer produced: ${name}`);
    } else unlinkSync(join(OUT, name));
  }
  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  console.log(
    `${files.size} files (${(total / 1024).toFixed(0)} KiB)${check ? `, ${differing} differ from app/public/fonts/scalable` : ' written to app/public/fonts/scalable'}`,
  );
  if (check && differing) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
