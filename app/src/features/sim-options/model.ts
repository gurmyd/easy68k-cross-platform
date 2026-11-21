// The texts and rules of the simulator's Options menu (ARCHITECTURE.md 1.3.4, 1.4 notes 27-29;
// sim-ui §14.1; trap15-a §3.2), as plain data and functions, so that they can be tested under Node.
//
// Owner: U4.

import type { FontSpec } from '../../contracts';

/** Dialog ids (2.7). */
export const FONT_DIALOG_ID = 'sim.font';
export const AUTO_TRACE_DIALOG_ID = 'sim.autoTrace';
export const FULLSCREEN_DIALOG_ID = 'sim.fullscreen';

/* ------------------------------------------------------------------ font dialogs (note 27) */

export type FontTargetKind = 'source' | 'output' | 'printer';

/** The fixed-pitch fonts of the measured metric table (3.5.1): the text grid depends on them. */
export const MEASURED_FONTS = ['Fixedsys', 'Courier', 'Courier New', 'Lucida Console', 'Consolas'] as const;
/** The Printer Font dialog offers any font; these are suggestions, any name can be typed. */
export const PRINTER_FONT_SUGGESTIONS = [
  'Arial',
  'Consolas',
  'Courier',
  'Courier New',
  'Georgia',
  'Lucida Console',
  'Tahoma',
  'Times New Roman',
  'Verdana',
] as const;

/** `MinFontSize = 8`, `MaxFontSize = 18` with `fdLimitSize` (SIM68Ku.dfm); the printer has no limit. */
export const FONT_SIZE_RANGE: Record<FontTargetKind, { min: number; max: number }> = {
  source: { min: 8, max: 18 },
  output: { min: 8, max: 18 },
  printer: { min: 1, max: 255 },
};

/** The caption of the menu item each dialog belongs to, as its title. */
export const FONT_DIALOG_TITLES: Record<FontTargetKind, string> = {
  source: 'Source Window Font',
  output: 'Output Window Font',
  printer: 'Printer Font',
};

/** The four entries of the Windows font dialog's style list. */
export const FONT_STYLES = ['Regular', 'Italic', 'Bold', 'Bold Italic'] as const;
export type FontStyleName = (typeof FONT_STYLES)[number];

/** The sixteen colours of the Windows font dialog's colour list, as COLORREF ($00BBGGRR). */
export const FONT_COLORS: readonly { name: string; color: number }[] = [
  { name: 'Black', color: 0x000000 },
  { name: 'Maroon', color: 0x000080 },
  { name: 'Green', color: 0x008000 },
  { name: 'Olive', color: 0x008080 },
  { name: 'Navy', color: 0x800000 },
  { name: 'Purple', color: 0x800080 },
  { name: 'Teal', color: 0x808000 },
  { name: 'Gray', color: 0x808080 },
  { name: 'Silver', color: 0xc0c0c0 },
  { name: 'Red', color: 0x0000ff },
  { name: 'Lime', color: 0x00ff00 },
  { name: 'Yellow', color: 0x00ffff },
  { name: 'Blue', color: 0xff0000 },
  { name: 'Fuchsia', color: 0xff00ff },
  { name: 'Aqua', color: 0xffff00 },
  { name: 'White', color: 0xffffff },
];

/** Props of `sim.font`. Style and colour are offered for the Output Window Font only (trap15-a §3.2). */
export interface FontDialogProps {
  target: FontTargetKind;
  font: FontSpec;
  color: number;
}
/** Result of `sim.font`: the chosen font, or null for Cancel. */
export type FontDialogResult = { font: FontSpec; color: number } | null;

/** The fonts the dialog lists for a target, with the current one added when it is not among them. */
export function fontChoices(target: FontTargetKind, current: string): string[] {
  const list: string[] = target === 'printer' ? [...PRINTER_FONT_SUGGESTIONS] : [...MEASURED_FONTS];
  if (target === 'printer' && current !== '' && !list.includes(current)) list.push(current);
  return list;
}

/** The entry of the style list a font shows. */
export function styleNameOf(font: Pick<FontSpec, 'bold' | 'italic'>): FontStyleName {
  if (font.bold && font.italic) return 'Bold Italic';
  if (font.bold) return 'Bold';
  if (font.italic) return 'Italic';
  return 'Regular';
}

/** The font a choice in the dialog stands for. */
export function fontFrom(
  name: string,
  size: number,
  style: FontStyleName,
  effects: { underline: boolean; strikeOut: boolean },
): FontSpec {
  return {
    name,
    size,
    bold: style === 'Bold' || style === 'Bold Italic',
    italic: style === 'Italic' || style === 'Bold Italic',
    underline: effects.underline,
    strikeOut: effects.strikeOut,
  };
}

/** A typed size, or null when it is not a whole number in the target's range. */
export function parseFontSize(text: string, target: FontTargetKind): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const size = Number(text);
  const { min, max } = FONT_SIZE_RANGE[target];
  return size >= min && size <= max ? size : null;
}

/** The name of a measured font as the table spells it (Windows compares font names without case). */
export function measuredName(name: string): string | null {
  const folded = name.toLowerCase();
  return MEASURED_FONTS.find((font) => font.toLowerCase() === folded) ?? null;
}

/** A plain font of the settings, as FontSpec. */
export function plainSpec(font: { name: string; size: number }): FontSpec {
  return { name: font.name, size: font.size, bold: false, italic: false, underline: false, strikeOut: false };
}

/* ------------------------------------------------------------------ Auto Trace Options (note 28) */

export const AUTO_TRACE_TITLE = 'Auto Trace Options';
export const AUTO_TRACE_LABEL = 'Auto Trace Interval';
export const AUTO_TRACE_UNIT = 'mSec';
export const DISABLE_DISPLAY_LABEL = 'Disable display update';
/** The up/down control of `Optionsu.dfm`: Min 10, Max 1000, Increment 10. */
export const AUTO_TRACE_RANGE = { min: 10, max: 1000, step: 10 } as const;

export interface AutoTraceValues {
  intervalMs: number;
  disableDisplay: boolean;
}
export type AutoTraceResult = AutoTraceValues | null;

/** A saved interval as the up/down control holds it: clamped to 10..1000 (a TUpDown position). */
export function clampInterval(value: number): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(AUTO_TRACE_RANGE.max, Math.max(AUTO_TRACE_RANGE.min, Math.round(value)));
}

/* ------------------------------------------------------------------ Fullscreen Options (note 29) */

export const FULLSCREEN_TITLE = 'Fullscreen Options';
export const FULLSCREEN_TEXT =
  'Screen to use for fullscreen output window.  Primary screen = 1  Secondary screens = 2 and up.';
/** `mmuFullscreenOptionsClick`: MessageBox with a NULL caption, which Windows shows as `Error`. */
export const FULLSCREEN_ACTIVE_TITLE = 'Error';
export const FULLSCREEN_ACTIVE_TEXT =
  'Please deactivate fullscreen mode before attempting to change the fullscreen settings.';
/** A web page and the single-window app have one screen for the output (note 29). */
export const SCREEN_COUNT = 1;

/** `txtScreenNumberChange`: `Text.ToIntDef(-1)` in 1..number of monitors enables `&Ok`. */
export function screenNumberOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= SCREEN_COUNT ? value : null;
}
