// WCAG 2 contrast arithmetic for the accessibility audit (ARCHITECTURE.md 2.8 "Contrast", 2.11).
// Owner: Q1.
//
// Pure functions, unit-tested in contrast.test.mjs: colours as the browser reports them
// (getComputedStyle gives `rgb(r, g, b)` or `rgba(r, g, b, a)`, newer engines also
// `rgb(r g b / a)` and `color(srgb r g b / a)`), relative luminance and the contrast ratio of
// WCAG 2.x (1.4.3, 1.4.11), and a colour drawn with alpha over another.

/** @typedef {{ r: number, g: number, b: number, a: number }} Rgba  channels 0..255, alpha 0..1 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * A CSS colour as the browser serialises it, or a `#rgb` / `#rrggbb` / `#rrggbbaa` literal.
 * Returns null for anything else (`transparent` is rgba(0, 0, 0, 0) and is parsed).
 * @param {string} text
 * @returns {Rgba | null}
 */
export function parseColor(text) {
  const value = String(text).trim().toLowerCase();
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value);
  if (m) {
    let hex = m[1];
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
    const channel = (i) => parseInt(hex.slice(i, i + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) / 255 : 1 };
  }
  m = /^rgba?\((.*)\)$/.exec(value);
  if (m) {
    const parts = m[1]
      .replace('/', ' ')
      .split(/[\s,]+/)
      .filter((part) => part !== '');
    if (parts.length < 3 || parts.length > 4) return null;
    const channel = (part) => (part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part));
    const alpha =
      parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const rgba = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    return Object.values(rgba).some(Number.isNaN) ? null : normalise(rgba);
  }
  m = /^color\(srgb\s+(.*)\)$/.exec(value);
  if (m) {
    const parts = m[1]
      .replace('/', ' ')
      .split(/\s+/)
      .filter((part) => part !== '');
    if (parts.length < 3 || parts.length > 4) return null;
    const unit = (part) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part));
    const rgba = {
      r: unit(parts[0]) * 255,
      g: unit(parts[1]) * 255,
      b: unit(parts[2]) * 255,
      a: parts[3] === undefined ? 1 : unit(parts[3]),
    };
    return Object.values(rgba).some(Number.isNaN) ? null : normalise(rgba);
  }
  return null;
}

/** @param {Rgba} c */
function normalise(c) {
  return { r: clamp(c.r, 0, 255), g: clamp(c.g, 0, 255), b: clamp(c.b, 0, 255), a: clamp(c.a, 0, 1) };
}

/**
 * `top` drawn over `bottom` (source-over); the result is opaque when `bottom` is.
 * @param {Rgba} top
 * @param {Rgba} bottom
 * @returns {Rgba}
 */
export function over(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/**
 * Relative luminance of an opaque sRGB colour (WCAG 2.x definition, 0.03928 threshold as the
 * WCAG 2 text gives it; axe-core uses the same).
 * @param {Rgba} c
 */
export function luminance(c) {
  const linear = (channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/**
 * Contrast ratio of two colours, 1..21. A translucent foreground is first drawn over the
 * background; a translucent background must be flattened by the caller (it depends on what lies
 * under it).
 * @param {Rgba | string} foreground
 * @param {Rgba | string} background
 */
export function contrastRatio(foreground, background) {
  const bg = typeof background === 'string' ? parseColor(background) : background;
  let fg = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  if (!fg || !bg) throw new Error(`not a colour: ${String(foreground)} / ${String(background)}`);
  if (fg.a < 1) fg = over(fg, bg);
  const [light, dark] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The ratio rounded down to two decimals, as a text ("4.48:1"): never rounds a failure up to a pass. */
export function formatRatio(ratio) {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/** `#RRGGBB` of an opaque colour. */
export function toHex(c) {
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/** WCAG 2 thresholds (AA): normal text, large text (24 px, or 18.66 px bold), interface graphics. */
export const AA = { text: 4.5, largeText: 3, graphics: 3 };

/**
 * The AA threshold for text of this size and weight (WCAG 2 "large scale": at least 18 pt, or
 * 14 pt bold; 1 pt = 4/3 px).
 */
export function textThreshold(fontSizePx, fontWeight) {
  const bold = Number(fontWeight) >= 700 || fontWeight === 'bold';
  return fontSizePx >= 24 || (bold && fontSizePx >= 18.66) ? AA.largeText : AA.text;
}
