// Contrast arithmetic for the rules of ARCHITECTURE.md 2.8. Owner: W2.
//
// contrast.test.ts reads tokens.css, evaluates every colour token in both
// themes with this module and checks the pairs that the component kit puts
// on screen: text at least 4.5:1 on its background, interface graphics (field
// borders, the focus ring, gutter dots, icons) at least 3:1.
//
// The evaluator understands exactly what tokens.css uses: #rrggbb,
// rgb(r g b / a), transparent, var(--name) and
// color-mix(in srgb, <colour> <p>%, <colour>).

export interface Rgba {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

export type TokenMap = Record<string, string>;

/** The custom properties of the light (:root) and dark (:root[data-theme=dark]) blocks. */
export interface ThemeTokens {
  light: TokenMap;
  dark: TokenMap;
}

/** Reads the declarations of the first `:root {` block and of the dark block of tokens.css. */
export function parseTokens(css: string): ThemeTokens {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selector: RegExp): TokenMap => {
    const match = selector.exec(text);
    if (!match) throw new Error(`tokens.css: block ${selector} not found`);
    const start = match.index + match[0].length;
    const end = text.indexOf('}', start);
    const map: TokenMap = {};
    for (const declaration of text.slice(start, end).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim();
      if (name.startsWith('--')) map[name] = declaration.slice(colon + 1).trim();
    }
    return map;
  };
  const light = block(/(^|\n):root\s*\{/);
  const darkOnly = block(/:root\[data-theme=['"]dark['"]\]\s*\{/);
  return { light, dark: { ...light, ...darkOnly } };
}

/** Evaluates a colour expression of tokens.css against a token map. */
export function evalColor(expression: string, tokens: TokenMap, depth = 0): Rgba {
  if (depth > 20) throw new Error(`colour expression too deep: ${expression}`);
  const value = expression.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1] ?? '', 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+)\s*)?\)$/i.exec(value);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
  }
  const variable = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (variable) {
    const name = variable[1] ?? '';
    const resolved = tokens[name];
    if (resolved === undefined) throw new Error(`unknown token ${name}`);
    return evalColor(resolved, tokens, depth + 1);
  }
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/.exec(value);
  if (mix) {
    const first = evalColor(mix[1] ?? '', tokens, depth + 1);
    const second = evalColor(mix[3] ?? '', tokens, depth + 1);
    return mixSrgb(first, second, Number(mix[2]) / 100);
  }
  throw new Error(`unsupported colour expression: ${expression}`);
}

/** CSS color-mix(in srgb, a p, b): premultiplied interpolation in gamma-encoded sRGB. */
export function mixSrgb(a: Rgba, b: Rgba, p: number): Rgba {
  const alpha = a.a * p + b.a * (1 - p);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (x: number, y: number) => (x * a.a * p + y * b.a * (1 - p)) / alpha;
  return { r: channel(a.r, b.r), g: channel(a.g, b.g), b: channel(a.b, b.b), a: alpha };
}

/** `top` painted over the opaque colour `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** WCAG 2 relative luminance of an opaque colour. */
export function luminance(color: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** WCAG 2 contrast ratio of two opaque colours (1..21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A pair the kit draws: `fg` on `bg`, where `bg` may be a stack of layers (bottom first). */
export interface ContrastRule {
  fg: string;
  /** Background layers, bottom first; translucent layers are composited. */
  bg: string[];
  kind: 'text' | 'graphic';
  use: string;
}

export const MIN_RATIO = { text: 4.5, graphic: 3 } as const;

/** Evaluates `rule` in one theme; the foreground is composited over the background too. */
export function ruleRatio(rule: ContrastRule, tokens: TokenMap): number {
  let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of rule.bg) background = composite(evalColor(layer, tokens), background);
  const foreground = composite(evalColor(rule.fg, tokens), background);
  return contrastRatio(foreground, background);
}

const v = (name: string) => `var(${name})`;
const ON_PLAIN = ['--c-bg', '--c-surface', '--c-panel'];

/**
 * Every pair the component kit and the panels of 2.6 put on screen. A rule
 * names tokens, not literals, so a change in tokens.css is checked at once.
 */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  // Body text and secondary text on every plain background, and on the
  // hover / pressed / unfocused-selection layers of buttons, menus and lists.
  ...['--c-text', '--c-text-muted'].flatMap((fg) =>
    ON_PLAIN.flatMap((bg): ContrastRule[] => [
      { fg: v(fg), bg: [v(bg)], kind: 'text', use: 'text' },
      { fg: v(fg), bg: [v(bg), v('--c-hover')], kind: 'text', use: 'hovered item' },
      { fg: v(fg), bg: [v(bg), v('--c-pressed')], kind: 'text', use: 'pressed item' },
    ]),
  ),
  { fg: v('--c-text'), bg: [v('--c-selection')], kind: 'text', use: 'selected row, editor selection' },
  { fg: v('--c-text'), bg: [v('--c-accent-soft')], kind: 'text', use: 'selected item of an unfocused list' },
  { fg: v('--c-text-muted'), bg: [v('--c-accent-soft')], kind: 'text', use: 'secondary text, unfocused selection' },
  { fg: v('--c-on-accent'), bg: [v('--c-accent')], kind: 'text', use: 'primary button, focused selection' },
  // Accent and status colours used as text.
  ...['--c-accent', '--c-danger', '--c-warning', '--c-ok'].flatMap((fg) =>
    ON_PLAIN.map((bg): ContrastRule => ({ fg: v(fg), bg: [v(bg)], kind: 'text', use: 'accent / status text' })),
  ),
  { fg: v('--c-logging-text'), bg: [v('--c-logging')], kind: 'text', use: 'LOGGING label' },
  { fg: v('--c-stack-text'), bg: [v('--c-stack-reg')], kind: 'text', use: 'stack byte, register mark' },
  { fg: v('--c-stack-text'), bg: [v('--c-stack-sp')], kind: 'text', use: 'stack byte, stack-pointer mark' },
  // Interface graphics.
  ...ON_PLAIN.map((bg): ContrastRule => ({
    fg: v('--c-border-strong'),
    bg: [v(bg)],
    kind: 'graphic',
    use: 'field border',
  })),
  ...[...ON_PLAIN, '--c-selection'].map((bg): ContrastRule => ({
    fg: v('--c-accent'),
    bg: [v(bg)],
    kind: 'graphic',
    use: 'focus ring',
  })),
  ...['--c-surface', '--c-panel', '--c-selection'].flatMap((bg): ContrastRule[] => [
    { fg: v('--c-bp-on-edge'), bg: [v(bg)], kind: 'graphic', use: 'gutter dot, breakpoint (edge)' },
    { fg: v('--c-bp-off-edge'), bg: [v(bg)], kind: 'graphic', use: 'gutter dot, instruction row (edge)' },
  ]),
  ...['--c-accent', '--c-danger', '--c-warning', '--c-ok'].flatMap((fg) =>
    ['--c-surface', '--c-panel'].map((bg): ContrastRule => ({
      fg: v(fg),
      bg: [v(bg)],
      kind: 'graphic',
      use: 'status icon, squiggle',
    })),
  ),
];

/** Pairs that are shown for information only: 2.8 does not require a ratio for them. */
export const INFORMATIVE_RULES: readonly ContrastRule[] = [
  { fg: v('--c-text-disabled'), bg: [v('--c-surface')], kind: 'text', use: 'disabled caption (exempt)' },
  { fg: v('--c-border'), bg: [v('--c-surface')], kind: 'graphic', use: 'separator (decorative)' },
  { fg: v('--c-bp-off'), bg: [v('--c-surface')], kind: 'graphic', use: 'instruction dot fill (has an edge)' },
];
