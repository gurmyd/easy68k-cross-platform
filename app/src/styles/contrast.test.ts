// The contrast check of ARCHITECTURE.md 2.8 (W2 acceptance: "a script checks
// the contrast rules of 2.8"). It reads tokens.css itself, so it fails as soon
// as a token change breaks a rule. Run alone with:
//   npx vitest run --root app src/styles/contrast.test.ts --silent=false
// and the table of all ratios is printed.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_RULES,
  INFORMATIVE_RULES,
  MIN_RATIO,
  contrastRatio,
  evalColor,
  mixSrgb,
  parseTokens,
  ruleRatio,
} from './contrast';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const tokens = parseTokens(css);

describe('contrast arithmetic', () => {
  it('matches the WCAG reference values', () => {
    const black = evalColor('#000000', {});
    const white = evalColor('#ffffff', {});
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
    // #767676 on white is the classic 4.54:1.
    expect(contrastRatio(evalColor('#767676', {}), white)).toBeCloseTo(4.54, 2);
  });

  it('evaluates var(), rgb() with alpha and color-mix()', () => {
    const map = { '--a': '#ff0000', '--b': 'var(--a)', '--c': 'color-mix(in srgb, var(--a) 50%, #0000ff)' };
    expect(evalColor('var(--b)', map)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(evalColor('var(--c)', map)).toEqual({ r: 127.5, g: 0, b: 127.5, a: 1 });
    expect(evalColor('rgb(17 24 39 / 0.32)', map)).toEqual({ r: 17, g: 24, b: 39, a: 0.32 });
    const translucent = mixSrgb(evalColor('#ff0000', {}), evalColor('transparent', {}), 0.6);
    expect(translucent).toEqual({ r: 255, g: 0, b: 0, a: 0.6 });
  });
});

describe('tokens.css', () => {
  it('has the colour values of the 2.8 table (apart from erratum 1)', () => {
    const expected: Record<string, [string, string]> = {
      '--c-bg': ['#f3f4f6', '#111418'],
      '--c-surface': ['#ffffff', '#1b1f24'],
      '--c-panel': ['#f9fafb', '#22272e'],
      '--c-border': ['#d1d5db', '#373e47'],
      '--c-text': ['#111827', '#e6edf3'],
      '--c-text-muted': ['#4b5563', '#9da7b3'],
      '--c-accent': ['#0b63ce', '#58a6ff'],
      '--c-on-accent': ['#ffffff', '#0d1117'],
      '--c-selection': ['#bfdbfe', '#1f4b7f'],
      '--c-danger': ['#b42318', '#ff7b72'],
      '--c-warning': ['#b54708', '#e3b341'],
      '--c-ok': ['#067647', '#56d364'],
      '--c-logging': ['#ffeb3b', '#ffeb3b'],
      '--c-bp-on': ['#d92d20', '#d92d20'],
      '--c-bp-off': ['#12b76a', '#12b76a'],
      '--c-stack-reg': ['#00ffff', '#00ffff'],
      '--c-stack-sp': ['#ffff00', '#ffff00'],
    };
    for (const [name, [light, dark]] of Object.entries(expected)) {
      expect(tokens.light[name]?.toLowerCase(), `${name} light`).toBe(light);
      expect(tokens.dark[name]?.toLowerCase(), `${name} dark`).toBe(dark);
    }
  });

  it('has the sizes, fonts and layers of the 2.8 table', () => {
    const expected: Record<string, string> = {
      '--fs-xs': '11px',
      '--fs-sm': '12px',
      '--fs-md': '13px',
      '--fs-lg': '15px',
      '--sp-1': '4px',
      '--sp-2': '8px',
      '--sp-3': '12px',
      '--sp-4': '16px',
      '--sp-5': '20px',
      '--sp-6': '24px',
      '--r-sm': '3px',
      '--r-md': '6px',
      '--h-menubar': '28px',
      '--h-toolbar': '36px',
      '--h-control': '28px',
      '--h-status': '22px',
      '--focus-ring': '2px solid var(--c-accent)',
      '--focus-offset': '1px',
      // Additions (errata W2 entry 25): the same 2 px accent ring, drawn inside a panel.
      '--focus-ring-inset': 'inset 0 0 0 2px var(--c-accent)',
      '--focus-offset-inset': '-2px',
      '--z-panel': '1',
      '--z-modeless': '20',
      '--z-modal': '30',
      '--z-menu': '40',
      '--z-toast': '50',
      '--font-ui': `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
      '--font-mono': `'Courier New', Courier, 'Liberation Mono', 'DejaVu Sans Mono', monospace`,
    };
    for (const [name, value] of Object.entries(expected)) expect(tokens.light[name], name).toBe(value);
  });
});

describe('contrast rules of 2.8, both themes', () => {
  const rows: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const rule of CONTRAST_RULES) {
      const name = `${theme}: ${rule.fg} on ${rule.bg.join(' + ')} (${rule.use})`;
      it(name, () => {
        const ratio = ruleRatio(rule, tokens[theme]);
        rows.push(`${ratio.toFixed(2).padStart(6)}  >= ${MIN_RATIO[rule.kind]}  ${name}`);
        expect(ratio).toBeGreaterThanOrEqual(MIN_RATIO[rule.kind]);
      });
    }
  }

  it('prints the table, with the informative pairs', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const rule of INFORMATIVE_RULES) {
        const ratio = ruleRatio(rule, tokens[theme]);
        rows.push(
          `${ratio.toFixed(2).padStart(6)}  (info)  ${theme}: ${rule.fg} on ${rule.bg.join(' + ')} (${rule.use})`,
        );
      }
    }
    console.log(`Contrast of the design tokens (ARCHITECTURE.md 2.8)\n${rows.join('\n')}`);
    expect(rows.length).toBe(CONTRAST_RULES.length * 2 + INFORMATIVE_RULES.length * 2);
  });
});

// The dock's colours (ARCHITECTURE-PLUS P3.1.8; ui/dock/dock.css maps every --flexlayout-* variable
// to these tokens): tab strips on --c-panel, content on --c-surface, splitters --c-border-strong
// (controls: 3:1 against both neighbours), the selected tab, the drop outline and the focus in
// --c-accent. Added by N1.
describe("the dock's colour pairs (ARCHITECTURE-PLUS P3.1.8), both themes", () => {
  const v = (name: string) => `var(${name})`;
  const DOCK_RULES: { fg: string; bg: string[]; kind: 'text' | 'graphic'; use: string }[] = [
    { fg: v('--c-text-muted'), bg: [v('--c-panel')], kind: 'text', use: 'dock tab, not selected' },
    { fg: v('--c-text'), bg: [v('--c-panel'), v('--c-hover')], kind: 'text', use: 'dock tab, hovered' },
    { fg: v('--c-text'), bg: [v('--c-panel')], kind: 'text', use: 'dock tab, selected' },
    { fg: v('--c-text'), bg: [v('--c-panel')], kind: 'text', use: "the collapsed Output panel's bar" },
    { fg: v('--c-accent'), bg: [v('--c-panel')], kind: 'graphic', use: "the selected tab's bar, a tab's focus ring" },
    { fg: v('--c-text-muted'), bg: [v('--c-panel')], kind: 'graphic', use: "a tab's x" },
    { fg: v('--c-text'), bg: [v('--c-panel'), v('--c-pressed')], kind: 'graphic', use: "a tab's x, hovered" },
    { fg: v('--c-border-strong'), bg: [v('--c-surface')], kind: 'graphic', use: 'splitter beside a panel' },
    { fg: v('--c-border-strong'), bg: [v('--c-panel')], kind: 'graphic', use: 'splitter beside a tab strip' },
    { fg: v('--c-border-strong'), bg: [v('--c-bg')], kind: 'graphic', use: 'splitter beside the window background' },
    { fg: v('--c-accent'), bg: [v('--c-surface')], kind: 'graphic', use: 'splitter hovered or focused, drop outline' },
    { fg: v('--c-accent'), bg: [v('--c-accent-soft')], kind: 'graphic', use: 'drop outline on its fill' },
    { fg: v('--c-surface'), bg: [v('--c-border-strong')], kind: 'graphic', use: 'edge marker arrow' },
  ];
  for (const theme of ['light', 'dark'] as const) {
    for (const rule of DOCK_RULES) {
      it(`${theme}: ${rule.fg} on ${rule.bg.join(' + ')} (${rule.use})`, () => {
        expect(ruleRatio(rule, tokens[theme])).toBeGreaterThanOrEqual(MIN_RATIO[rule.kind]);
      });
    }
  }
});
