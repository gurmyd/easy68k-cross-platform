// Preset resolution: which colours and attributes the eight style elements and the background
// take, from the editor settings and the theme (ARCHITECTURE.md 2.8, editor-ui §9.2, §11.2).
// Owner: E3.
//
// - `Auto` (colorPreset 5, the port's default): the original defaults on #FFFFFF in the light
//   theme, the dark palette of 2.8 in the dark theme; no attributes. The stored styles are not used.
// - Every other preset (Color1, Color2, No Color, Custom, Disabled, or none selected): the stored
//   styles and the stored background, unchanged, in both themes.
// - `highlightDisabled` (set by the Disabled preset): no highlighting; every character takes the
//   Code colour without attributes (editorOptions.cpp:140-143).
//
// The CodeMirror side expresses this with CSS custom properties: the Auto values live in the
// highlighter's theme (one rule per theme, keyed on data-theme), the stored values are set as an
// inline style on the editor, which overrides the theme.

import type { EditorSettings, SyntaxElement, SyntaxStyle } from '../../contracts';
import { AUTO_DARK, AUTO_LIGHT, COLOR_PRESET, colorRefToHex, SYNTAX_ELEMENTS } from '../../core/highlight';

export type ThemeName = 'light' | 'dark';

/** The styles a source document is drawn with. */
export interface ResolvedSyntaxColors {
  /** True for the Auto preset (the theme decides). */
  auto: boolean;
  /** True when highlighting is off: everything is drawn in `styles.code.color`, no attributes. */
  disabled: boolean;
  styles: Readonly<Record<SyntaxElement, SyntaxStyle>>;
  /** COLORREF */
  background: number;
}

export function isAutoPreset(editor: Pick<EditorSettings, 'colorPreset'>): boolean {
  return editor.colorPreset === COLOR_PRESET.auto;
}

/** The colours of the editor settings in a theme. */
export function resolveSyntaxColors(
  editor: Pick<EditorSettings, 'colorPreset' | 'styles' | 'backgroundColor' | 'highlightDisabled'>,
  theme: ThemeName,
): ResolvedSyntaxColors {
  const auto = isAutoPreset(editor);
  const palette = auto
    ? theme === 'dark'
      ? AUTO_DARK
      : AUTO_LIGHT
    : { styles: editor.styles, background: editor.backgroundColor };
  return { auto, disabled: editor.highlightDisabled, styles: palette.styles, background: palette.background };
}

/** Name of the CSS custom property of an element's colour; `-weight`, `-style`, `-decoration` follow it. */
export const syntaxVariable = (element: SyntaxElement | 'background'): string => `--e68-syntax-${element}`;

/** The CSS class of the mark decoration of an element. */
export const syntaxClass = (element: SyntaxElement): string => `e68-syntax__${element}`;

/** The custom properties for a set of styles and a background. */
export function syntaxVariables(
  styles: Readonly<Record<SyntaxElement, SyntaxStyle>>,
  background: number,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const element of SYNTAX_ELEMENTS) {
    const style = styles[element];
    const name = syntaxVariable(element);
    variables[name] = colorRefToHex(style.color);
    variables[`${name}-weight`] = style.bold ? 'bold' : 'normal';
    variables[`${name}-style`] = style.italic ? 'italic' : 'normal';
    variables[`${name}-decoration`] = style.underline ? 'underline' : 'none';
  }
  variables[syntaxVariable('background')] = colorRefToHex(background);
  return variables;
}

/** Custom properties as the text of an inline style, in a canonical order. */
const styleText = (variables: Record<string, string>): string =>
  Object.entries(variables)
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ');

/**
 * The inline style that carries the stored colours, or null for Auto (the theme's values apply).
 * The text is canonical, so equal settings give equal strings.
 */
export function storedColorsStyle(
  editor: Pick<EditorSettings, 'colorPreset' | 'styles' | 'backgroundColor'>,
): string | null {
  if (isAutoPreset(editor)) return null;
  return styleText(syntaxVariables(editor.styles, editor.backgroundColor));
}

/** The text colour of a list document under a stored preset: the RichEdit default (clWindowText). */
export const LIST_TEXT_COLOR = 0x000000;

/**
 * The inline style of a list document (.L68, .S68), or null for Auto. The original sets the stored
 * background on every edit window (`SourceText->Color = backColor`, textS.cpp:78, editorOptions.cpp:148),
 * list windows included, and leaves their text in the default black: no syntax colours, no
 * attributes. Under Auto a list document keeps the theme's editor colours.
 */
export function listColorsStyle(editor: Pick<EditorSettings, 'colorPreset' | 'backgroundColor'>): string | null {
  if (isAutoPreset(editor)) return null;
  return styleText({
    [syntaxVariable('code')]: colorRefToHex(LIST_TEXT_COLOR),
    [syntaxVariable('background')]: colorRefToHex(editor.backgroundColor),
  });
}
