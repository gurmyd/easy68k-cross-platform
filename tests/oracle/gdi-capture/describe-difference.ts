// What exactly differs between a committed GDI reference and a fresh capture, in a few readable
// lines, so that a CI log tells a person what another Windows draws differently without the files
// (README.md "Another Windows"). run.mjs prints these lines under each DIFFERENT output and into the
// report. Pure functions over decoded data; tests in tests/conformance/gdi/describe-difference.test.ts.
// Owner: T2.

/** The fields of a font atlas the description needs (tests/conformance/gdi/pix.ts decodeAtlas). */
export interface AtlasView {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly glyphWidth: number;
  readonly advances: Uint8Array;
  glyph(ch: number): Uint8Array;
}

/** The fields of a pixel pack the description needs (pix.ts decodePack). */
export interface PackView {
  readonly cases: readonly { readonly id: string; readonly pen: readonly [number, number]; readonly pix: Uint8Array }[];
}

/** "$41-$43, $7F" for a sorted list of bytes. */
export function byteRanges(bytes: readonly number[]): string {
  const hex = (b: number) => '$' + b.toString(16).toUpperCase().padStart(2, '0');
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    let j = i;
    while (j + 1 < bytes.length && (bytes[j + 1] as number) === (bytes[j] as number) + 1) j++;
    parts.push(i === j ? hex(bytes[i] as number) : `${hex(bytes[i] as number)}-${hex(bytes[j] as number)}`);
    i = j;
  }
  return parts.join(', ');
}

/**
 * Which glyphs and advances of a raster atlas differ. Atlases of the same cell whose glyph widths
 * differ are compared pixel by pixel all the same (the glyph width only says how wide the widest
 * glyph is). Glyphs of the bytes in `separately` (machine-dependent.ts OTHER_FONT_BYTES) are counted
 * on a line of their own, so a log shows at once whether anything else differs.
 */
export function describeAtlas(reference: AtlasView, captured: AtlasView, separately: readonly number[] = []): string[] {
  const cell = (a: AtlasView) => `${a.cellWidth}x${a.cellHeight}`;
  const shape = (a: AtlasView) => `${cell(a)}, glyphs ${a.glyphWidth} wide`;
  if (cell(reference) !== cell(captured)) return [`cell ${shape(captured)}; the reference has ${shape(reference)}`];
  const width = Math.max(reference.glyphWidth, captured.glyphWidth);
  const pixel = (a: AtlasView, g: Uint8Array, i: number) => {
    const x = i % width;
    const y = (i - x) / width;
    return x < a.glyphWidth ? (g[y * a.glyphWidth + x] ?? 0) : 0;
  };
  const glyphs: number[] = [];
  const apart: number[] = [];
  const advances: string[] = [];
  let pixels = 0;
  let apartPixels = 0;
  for (let ch = 0; ch < 256; ch++) {
    const a = reference.glyph(ch);
    const b = captured.glyph(ch);
    let n = 0;
    for (let i = 0; i < width * reference.cellHeight; i++) if (pixel(reference, a, i) !== pixel(captured, b, i)) n++;
    if (separately.includes(ch)) {
      if (n > 0) apart.push(ch);
      apartPixels += n;
    } else {
      if (n > 0) glyphs.push(ch);
      pixels += n;
    }
    if (reference.advances[ch] !== captured.advances[ch])
      advances.push(
        `$${ch.toString(16).toUpperCase().padStart(2, '0')} ${reference.advances[ch]}->${captured.advances[ch]}`,
      );
  }
  const lines: string[] = [];
  if (glyphs.length) lines.push(`${glyphs.length} glyphs differ in ${pixels} pixels: ${byteRanges(glyphs)}`);
  if (advances.length)
    lines.push(
      `${advances.length} advances differ: ${advances.slice(0, 12).join(', ')}${advances.length > 12 ? ', ...' : ''}`,
    );
  if (apart.length)
    lines.push(`${apart.length} other-font glyphs differ in ${apartPixels} pixels: ${byteRanges(apart)}`);
  if (reference.glyphWidth !== captured.glyphWidth)
    lines.push(`glyphs ${captured.glyphWidth} wide; the reference has ${reference.glyphWidth}`);
  if (lines.length && !glyphs.length && !advances.length)
    lines.unshift('every glyph and advance of the face itself is equal');
  return lines.length ? lines : ['same glyphs and advances (the file differs elsewhere)'];
}

const show = (v: unknown) => {
  const s = JSON.stringify(v) ?? 'undefined';
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

/** The JSON paths at which two values differ, with both values, at most `limit` of them. */
export function describeJson(reference: unknown, captured: unknown, limit = 20): string[] {
  const out: string[] = [];
  let count = 0;
  const walk = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const container = (v: unknown) => v !== null && typeof v === 'object';
    const leafArray = (v: unknown) => Array.isArray(v) && v.every((e) => !container(e));
    if (container(a) && container(b) && Array.isArray(a) === Array.isArray(b) && !(leafArray(a) && leafArray(b))) {
      const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
      for (const k of keys)
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`,
        );
      return;
    }
    count++;
    if (out.length < limit) out.push(`${path || '(whole)'}: ${show(a)} -> ${show(b)}`);
  };
  walk(reference, captured, '');
  if (count > out.length) out.push(`... ${count - out.length} more`);
  return out;
}

/** Which cases of a pixel pack differ (pixels or pen), at most `limit` named. */
export function describePack(reference: PackView, captured: PackView, limit = 12): string[] {
  const old = new Map(reference.cases.map((c) => [c.id, c]));
  const ids: string[] = [];
  let pens = 0;
  for (const c of captured.cases) {
    const r = old.get(c.id);
    if (!r) {
      ids.push(`${c.id} (new)`);
      continue;
    }
    const pix = r.pix.length !== c.pix.length || r.pix.some((v, i) => v !== c.pix[i]);
    const pen = r.pen[0] !== c.pen[0] || r.pen[1] !== c.pen[1];
    if (pen) pens++;
    if (pix || pen) ids.push(c.id + (pix ? '' : ' (pen only)'));
  }
  const gone = reference.cases.filter((c) => !captured.cases.some((k) => k.id === c.id)).length;
  const lines = [`${ids.length} of ${captured.cases.length} cases differ (${pens} in the pen position)`];
  if (ids.length) lines.push(`${ids.slice(0, limit).join(', ')}${ids.length > limit ? ', ...' : ''}`);
  if (gone) lines.push(`${gone} cases of the reference are no longer captured`);
  return lines;
}

/** Which rows of a tab-separated table differ, by their first three fields. */
export function describeTsv(reference: string, captured: string, limit = 12): string[] {
  const rows = (t: string) =>
    new Map(
      t
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => [l.split('\t').slice(0, 3).join(' '), l] as const),
    );
  const a = rows(reference);
  const b = rows(captured);
  const keys = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
  return [
    `${keys.length} rows differ${keys.length ? ': ' : ''}${keys.slice(0, limit).join(', ')}${keys.length > limit ? ', ...' : ''}`,
  ];
}
