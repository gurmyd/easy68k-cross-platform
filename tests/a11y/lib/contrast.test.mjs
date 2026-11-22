// Owner: Q1.
import { describe, expect, it } from 'vitest';
import { AA, contrastRatio, formatRatio, luminance, over, parseColor, textThreshold, toHex } from './contrast.mjs';

describe('parseColor', () => {
  it('reads hex literals of three, six and eight digits', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0B63CE')).toEqual({ r: 11, g: 99, b: 206, a: 1 });
    expect(parseColor('#00000080')?.a).toBeCloseTo(128 / 255, 5);
  });

  it('reads what getComputedStyle returns, in both syntaxes', () => {
    expect(parseColor('rgb(17, 24, 39)')).toEqual({ r: 17, g: 24, b: 39, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseColor('rgb(17 24 39 / 0.32)')).toEqual({ r: 17, g: 24, b: 39, a: 0.32 });
    expect(parseColor('rgb(100% 0% 50%)')).toEqual({ r: 255, g: 0, b: 127.5, a: 1 });
  });

  it('reads color(srgb ...), which WebKit and Chromium give for color-mix()', () => {
    const c = parseColor('color(srgb 0.0705882 0.717647 0.415686 / 0.35)');
    expect(c && toHex(c)).toBe('#12B76A');
    expect(c?.a).toBe(0.35);
  });

  it('gives null for what it cannot read', () => {
    expect(parseColor('currentcolor')).toBeNull();
    expect(parseColor('rgb(1, 2)')).toBeNull();
    expect(parseColor('#12')).toBeNull();
    expect(parseColor('hsl(0 0% 0%)')).toBeNull();
  });

  it('reads transparent as fully transparent black', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('luminance and contrastRatio (WCAG 2)', () => {
  it('has the end points 0 and 1', () => {
    expect(luminance({ r: 0, g: 0, b: 0, a: 1 })).toBe(0);
    expect(luminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 10);
  });

  it('gives 21:1 for black on white and 1:1 for a colour on itself, in either order', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#808000', '#808000')).toBe(1);
  });

  it('matches known values: the original olive and red on white, the design tokens', () => {
    // Values as WebAIM's contrast checker gives them.
    expect(formatRatio(contrastRatio('#808000', '#FFFFFF'))).toBe('4.19:1');
    expect(formatRatio(contrastRatio('#FF0000', '#FFFFFF'))).toBe('3.99:1');
    expect(formatRatio(contrastRatio('#767676', '#FFFFFF'))).toBe('4.54:1');
    // errata W2 entry 1: --c-border-strong light on --c-surface.
    expect(formatRatio(contrastRatio('#818B98', '#FFFFFF'))).toBe('3.45:1');
  });

  it('draws a translucent foreground over the background first', () => {
    const half = { r: 0, g: 0, b: 0, a: 0.5 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(contrastRatio(half, white)).toBeCloseTo(contrastRatio(over(half, white), white), 10);
    expect(contrastRatio(half, white)).toBeLessThan(21);
  });

  it('refuses colours it cannot read', () => {
    expect(() => contrastRatio('nonsense', '#fff')).toThrow(/not a colour/);
  });
});

describe('over', () => {
  it('blends by alpha and keeps an opaque result over an opaque base', () => {
    const result = over({ r: 255, g: 0, b: 0, a: 0.25 }, { r: 0, g: 0, b: 255, a: 1 });
    expect(result.a).toBe(1);
    expect(result.r).toBeCloseTo(63.75, 5);
    expect(result.b).toBeCloseTo(191.25, 5);
  });

  it('gives full transparency for two transparent layers', () => {
    expect(over({ r: 1, g: 2, b: 3, a: 0 }, { r: 4, g: 5, b: 6, a: 0 })).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});

describe('formatRatio and thresholds', () => {
  it('rounds down, so that a failure is never shown as a pass', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(4.5)).toBe('4.50:1');
  });

  it('uses 3:1 for large text (24 px, or 18.66 px bold) and 4.5:1 otherwise', () => {
    expect(textThreshold(13, 400)).toBe(AA.text);
    expect(textThreshold(24, 400)).toBe(AA.largeText);
    expect(textThreshold(19, 700)).toBe(AA.largeText);
    expect(textThreshold(19, 'bold')).toBe(AA.largeText);
    expect(textThreshold(18, 700)).toBe(AA.text);
  });
});
