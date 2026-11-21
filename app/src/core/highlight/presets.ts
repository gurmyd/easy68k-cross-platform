// Colour presets of the Editor Options dialog (editor-ui §11.2, SyntaxComboChange,
// editorOptions.cpp:565-656) and the port's `Auto` palettes (ARCHITECTURE.md 2.8). Owner: E3.
//
// Colours are Windows COLORREF values (0x00BBGGRR), as EditorSettings stores them.

import type { SyntaxElement, SyntaxStyle } from '../../contracts';

/** The index stored in EditorSettings.colorPreset (3.10). */
export const COLOR_PRESET = {
  none: -1,
  color1: 0,
  color2: 1,
  noColor: 2,
  custom: 3,
  disabled: 4,
  auto: 5,
} as const;

/** The eight style elements in the order of the dialog's Element list. */
export const SYNTAX_ELEMENTS: readonly SyntaxElement[] = [
  'code',
  'comment',
  'directive',
  'label',
  'unknown',
  'structure',
  'error',
  'text',
];

/** The VCL colour constants the presets use, as COLORREF. */
export const VCL_COLORS = {
  clBlack: 0x000000,
  clMaroon: 0x000080,
  clGreen: 0x008000,
  clOlive: 0x008080,
  clNavy: 0x800000,
  clPurple: 0x800080,
  clTeal: 0x808000,
  clRed: 0x0000ff,
  clBlue: 0xff0000,
  clWhite: 0xffffff,
} as const;

/** COLORREF (0x00BBGGRR) to CSS `#RRGGBB`. */
export function colorRefToHex(color: number): string {
  const c = color >>> 0;
  const hex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(c & 0xff)}${hex((c >>> 8) & 0xff)}${hex((c >>> 16) & 0xff)}`;
}

/** CSS `#RRGGBB` to COLORREF. */
export function hexToColorRef(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  return parseInt(m[1]!, 16) | (parseInt(m[2]!, 16) << 8) | (parseInt(m[3]!, 16) << 16);
}

const plain = (color: number): SyntaxStyle => ({ color, bold: false, italic: false, underline: false });

function styles(colors: Record<SyntaxElement, number>): Record<SyntaxElement, SyntaxStyle> {
  return {
    code: plain(colors.code),
    unknown: plain(colors.unknown),
    directive: plain(colors.directive),
    comment: plain(colors.comment),
    label: plain(colors.label),
    structure: plain(colors.structure),
    error: plain(colors.error),
    text: plain(colors.text),
  };
}

const { clBlack, clMaroon, clGreen, clOlive, clNavy, clPurple, clTeal, clRed, clBlue, clWhite } = VCL_COLORS;

/** The original's default background (`DEFAULT_BACK_COLOR`, asm.h:259). Presets never change it. */
export const DEFAULT_BACKGROUND = clWhite;

/** `Color1`: the defaults of editor-ui §9.2 (asm.h:251-258). */
export const COLOR1_STYLES = styles({
  code: clBlack,
  unknown: clOlive,
  directive: clGreen,
  comment: clBlue,
  label: clPurple,
  structure: clMaroon,
  error: clRed,
  text: clTeal,
});

/** `Color2`. */
export const COLOR2_STYLES = styles({
  code: clBlack,
  unknown: clPurple,
  directive: clBlue,
  comment: clGreen,
  label: clNavy,
  structure: clBlue,
  error: clRed,
  text: clMaroon,
});

/** `No Color` ("Mono" in the source): all black, with attributes. */
export const NO_COLOR_STYLES: Record<SyntaxElement, SyntaxStyle> = {
  code: plain(clBlack),
  unknown: { color: clBlack, bold: false, italic: true, underline: true },
  directive: { color: clBlack, bold: true, italic: false, underline: false },
  comment: { color: clBlack, bold: false, italic: true, underline: false },
  label: { color: clBlack, bold: true, italic: false, underline: false },
  structure: { color: clBlack, bold: true, italic: false, underline: false },
  error: { color: clBlack, bold: false, italic: false, underline: true },
  text: plain(clBlack),
};

/** `Disabled`: all black, no attributes; the preset also turns highlighting off. */
export const DISABLED_STYLES = styles({
  code: clBlack,
  unknown: clBlack,
  directive: clBlack,
  comment: clBlack,
  label: clBlack,
  structure: clBlack,
  error: clBlack,
  text: clBlack,
});

/**
 * What choosing a preset in the dialog does to the stored styles: the new styles and whether
 * highlighting is disabled, or null for `Custom` (which changes nothing). `Auto` stores the Color1
 * values (3.10: it is exported as -1 with the Color1 values).
 */
export function presetStyles(
  preset: number,
): { styles: Record<SyntaxElement, SyntaxStyle>; highlightDisabled: boolean } | null {
  switch (preset) {
    case COLOR_PRESET.color1:
    case COLOR_PRESET.auto:
      return { styles: COLOR1_STYLES, highlightDisabled: false };
    case COLOR_PRESET.color2:
      return { styles: COLOR2_STYLES, highlightDisabled: false };
    case COLOR_PRESET.noColor:
      return { styles: NO_COLOR_STYLES, highlightDisabled: false };
    case COLOR_PRESET.disabled:
      return { styles: DISABLED_STYLES, highlightDisabled: true };
    default:
      return null; // Custom, or none selected
  }
}

/** The `Auto` palette of one theme (2.8): colours on a background, no attributes. */
export interface AutoPalette {
  readonly styles: Readonly<Record<SyntaxElement, SyntaxStyle>>;
  readonly background: number;
}

/** `Auto`, light theme: the original defaults on #FFFFFF. */
export const AUTO_LIGHT: AutoPalette = { styles: COLOR1_STYLES, background: hexToColorRef('#FFFFFF') };

/** `Auto`, dark theme (2.8). */
export const AUTO_DARK: AutoPalette = {
  styles: styles({
    code: hexToColorRef('#E6EDF3'),
    comment: hexToColorRef('#6CB6FF'),
    directive: hexToColorRef('#6BC46D'),
    label: hexToColorRef('#D2A8FF'),
    unknown: hexToColorRef('#D4B24C'),
    structure: hexToColorRef('#FF938A'),
    error: hexToColorRef('#FF5F56'),
    text: hexToColorRef('#56D4DD'),
  }),
  background: hexToColorRef('#1B1F24'),
};
