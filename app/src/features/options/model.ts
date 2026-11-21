// The logic of the two option dialogs, without React (editor-ui §11.1, §11.2; ARCHITECTURE.md
// 1.4 note 8, 3.10). The components (AssemblerOptionsDialog.tsx, EditorOptionsDialog.tsx) only draw
// what these functions compute. Owner: E4.
//
// "Cancel restores everything" (note 8), with several windows sharing one set of settings
// (3.8.6, errata W3 entries 26-31). A dialog keeps what the user changes in a DRAFT: the values of
// the controls the user has touched, nothing else. The controls show the draft over the LIVE
// settings, so a control the user has not touched follows a change another window makes while the
// dialog is open. Nothing reaches the settings service before OK, which writes the draft and
// nothing but the draft (`settings.update`, which stamps only the settings that actually change).
// Hence:
//
//   - Cancel (and Escape, and the close button) writes nothing. Every setting is afterwards what it
//     would be had the dialog never been opened, which includes a change another window made while
//     it was open: "everything" is what this window's dialog changed, and none of it remains.
//   - OK changes only the settings the user changed in the dialog; another window's change to any
//     other setting survives.
//
// What the original applies at once and Cancel cannot undo there (Auto Indent and Real Tabs take
// effect on click, the check boxes of Assembler Options are read by Assemble directly, the font
// and tab controls of Editor Options are the defaults themselves) is applied on OK here. Nothing a
// program can observe depends on it: the Editor Options dialog is modal, and the Assembler Options
// dialog changes the next assembly only once it is confirmed (docs/differences/E4.md).

import {
  TabType,
  type DocumentPatch,
  type DocumentState,
  type EditorSettings,
  type SyntaxElement,
  type SyntaxStyle,
} from '../../contracts';
import { COLOR_PRESET, SYNTAX_ELEMENTS, presetStyles } from '../../core/highlight';
import { clampTabSize } from '../../core/settings/dat-codec';
import { TAB_TYPE_NAMES } from './texts';

/* ================================================================ Assembler Options (§11.1) */

/** The nine check boxes, by the EditorSettings key each stands for. */
export type AsmFlag =
  | 'generateList'
  | 'generateSRecord'
  | 'saveThenAssemble'
  | 'showWarnings'
  | 'assembleBitField'
  | 'crossReference'
  | 'structuredExpanded'
  | 'constantsExpanded'
  | 'macrosExpanded';

export interface AsmOption {
  key: AsmFlag;
  caption: string;
  /** The tool-tip (`Hint`), verbatim, misspellings included. */
  hint?: string;
  group: 'assembler' | 'list';
}

/**
 * The check boxes in the order of the form, row by row (optionsS.dfm: two columns per group, the
 * left column at Left 16, the right one at 152 / 160). Defaults: DEFAULT_EDITOR_SETTINGS.
 */
export const ASSEMBLER_OPTIONS: readonly AsmOption[] = [
  {
    key: 'generateList',
    caption: 'Generate List File',
    hint: 'Generates a list file upon assembly [RECOMMENDED]',
    group: 'assembler',
  },
  {
    key: 'saveThenAssemble',
    caption: 'Auto Save Modified Source Before Assembling',
    hint: 'If checked source will be saved before assembly',
    group: 'assembler',
  },
  {
    key: 'generateSRecord',
    caption: 'Generate S-Record',
    hint: 'Generate a S-Record file upon assembly  [RECOMENDED]',
    group: 'assembler',
  },
  { key: 'assembleBitField', caption: 'Assemble Bit Field Instructions', group: 'assembler' },
  { key: 'showWarnings', caption: 'Show Warnings', group: 'assembler' },
  { key: 'crossReference', caption: 'Cross Reference', hint: 'Cross Reference list file', group: 'list' },
  { key: 'structuredExpanded', caption: 'Structured Expanded', hint: 'Expand macros in list file', group: 'list' },
  { key: 'constantsExpanded', caption: 'Constants Expanded', hint: 'Expand constants in list file', group: 'list' },
  { key: 'macrosExpanded', caption: 'Macros Expanded', hint: 'Expand macros in list file', group: 'list' },
];

/** What the user changed in the Assembler Options dialog. */
export type AsmDraft = Partial<Record<AsmFlag, boolean>>;

/** The value a check box shows: the draft over the live settings. */
export function asmValue(live: Pick<EditorSettings, AsmFlag>, draft: AsmDraft, key: AsmFlag): boolean {
  return draft[key] ?? live[key];
}

/** OK asks the Sim68K question when Generate S-Record or Generate List File is unchecked. */
export function needsSim68KQuestion(live: Pick<EditorSettings, AsmFlag>, draft: AsmDraft): boolean {
  return !asmValue(live, draft, 'generateSRecord') || !asmValue(live, draft, 'generateList');
}

/** The answer No: "re-check both boxes and leave the dialog open". */
export function recheckRequired(draft: AsmDraft): AsmDraft {
  return { ...draft, generateList: true, generateSRecord: true };
}

/** OK: the settings with the draft applied. */
export function applyAsmDraft<S extends { editor: EditorSettings }>(settings: S, draft: AsmDraft): S {
  return { ...settings, editor: { ...settings.editor, ...draft } };
}

/* ================================================================ Editor Options (§11.2) */

/** The three fonts of `cbFont` (editorOptions.dfm). */
export const EDITOR_FONTS = ['Courier', 'Courier New', 'Fixedsys'] as const;
export type EditorFont = (typeof EDITOR_FONTS)[number];

/** The sizes `cbFontChange` offers for each font (editorOptions.cpp:211-255). */
export const FONT_SIZES: Readonly<Record<EditorFont, readonly number[]>> = {
  Courier: [10, 12, 15],
  'Courier New': [8, 9, 10, 11, 12, 14, 16, 18],
  Fixedsys: [9, 18],
};

/** FormShow: `Courier` -> item 0, `Fixedsys` -> item 2, anything else -> `Courier New`. */
export function fontItemFor(name: string): EditorFont {
  return name === 'Courier' || name === 'Fixedsys' ? name : 'Courier New';
}

/** cbFontChange's bucket: the size preset for a font from the active document's size. */
export function bucketSize(font: EditorFont, documentSize: number): number {
  if (font === 'Fixedsys') return documentSize < 15 ? 9 : 18;
  if (font === 'Courier') return documentSize < 12 ? 10 : documentSize < 15 ? 12 : 15;
  return documentSize < 12 ? 10 : documentSize < 15 ? 12 : 16;
}

/**
 * The size the size box shows for a font. When the dialog opens it is the document's real size
 * (1.4 note 8; the original's bucket made OK change an 11-point document to 10). When the user
 * chooses another font it is the document's size if that font offers it, else the original's
 * bucket (errata E4.md).
 */
export function sizeFor(font: EditorFont, documentSize: number, opening: boolean): number {
  if (opening || FONT_SIZES[font].includes(documentSize)) return documentSize;
  return bucketSize(font, documentSize);
}

/** The sizes the size box lists: the font's own, and the shown size if the font lacks it. */
export function sizeChoices(font: EditorFont, shown: number): number[] {
  const sizes = [...FONT_SIZES[font]];
  if (!sizes.includes(shown)) sizes.push(shown);
  return sizes.sort((a, b) => a - b);
}

/** The colour swatches of the `Color` group, row by row (editor-ui §11.2), as COLORREF. */
export const SWATCHES: readonly { name: string; color: number }[] = [
  { name: 'clBlack', color: 0x000000 },
  { name: 'clMaroon', color: 0x000080 },
  { name: 'clGreen', color: 0x008000 },
  { name: 'clOlive', color: 0x008080 },
  { name: 'clNavy', color: 0x800000 },
  { name: 'clPurple', color: 0x800080 },
  { name: 'clTeal', color: 0x808000 },
  { name: 'clGray', color: 0x808080 },
  { name: 'clMedGray', color: 0xa4a0a0 },
  { name: 'clRed', color: 0x0000ff },
  { name: 'clLime', color: 0x00ff00 },
  { name: 'clYellow', color: 0x00ffff },
  { name: 'clBlue', color: 0xff0000 },
  { name: 'clFuchsia', color: 0xff00ff },
  { name: 'clAqua', color: 0xffff00 },
  { name: 'clWhite', color: 0xffffff },
];

/** `Element->ItemIndex` of the Background item; -1 = nothing selected. */
export const BACKGROUND_ITEM = 8;
export const NO_ITEM = -1;

/** What the user changed in the Editor Options dialog (see the header of this file). */
export interface EditorDraft {
  fontName?: string;
  fontSize?: number;
  tabType?: TabType;
  fixedTabSize?: number;
  autoIndent?: boolean;
  realTabs?: boolean;
  styles?: Partial<Record<SyntaxElement, SyntaxStyle>>;
  backgroundColor?: number;
  colorPreset?: EditorSettings['colorPreset'];
  highlightDisabled?: boolean;
}

/** The parts of the Colors tab that are not settings: the selected element and the three boxes. */
export interface ColorsUi {
  element: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** The active document as the dialog needs it (DocumentState fields). */
export type ActiveDocument = Pick<DocumentState, 'id' | 'fontName' | 'fontSize' | 'tabType' | 'tabSize'>;

/** Props of the dialog `options.editor`. */
export interface EditorOptionsProps {
  document: ActiveDocument;
}

/**
 * The draft when the dialog opens: the font box set to the document's font (mapped to one of the
 * three) and the size box to its real size (1.4 note 8). These two are the "New Font" and "New Font
 * Size" that OK makes the defaults, as in the original. Everything else starts untouched.
 */
export function openingDraft(document: ActiveDocument): EditorDraft {
  const font = fontItemFor(document.fontName);
  return { fontName: font, fontSize: sizeFor(font, document.fontSize, true) };
}

/** The settings the controls show: the draft over the live settings. */
export function shownSettings(live: EditorSettings, draft: EditorDraft): EditorSettings {
  const styles = { ...live.styles };
  for (const element of SYNTAX_ELEMENTS) {
    const changed = draft.styles?.[element];
    if (changed) styles[element] = { ...changed };
  }
  const { styles: _styles, ...rest } = draft;
  return { ...live, ...rest, styles };
}

/** The user chose another font: its size list, and the size the box shows. */
export function chooseFont(draft: EditorDraft, font: EditorFont, document: ActiveDocument): EditorDraft {
  return { ...draft, fontName: font, fontSize: sizeFor(font, document.fontSize, false) };
}

/** The tab size typed or stepped; the spin box keeps it within 4..20 (editorOptions.cpp:94-101). */
export function chooseTabSize(draft: EditorDraft, size: number): EditorDraft {
  return { ...draft, fixedTabSize: clampTabSize(Math.round(size)) };
}

/** Every action on the Colors tab that the original marks as a style change (`styleChange`). */
function styleChanged(draft: EditorDraft, preset: EditorSettings['colorPreset'], disabled: boolean): EditorDraft {
  return { ...draft, colorPreset: preset, highlightDisabled: disabled };
}

/** The empty Colors tab: no element selected, the three boxes clear. */
export const INITIAL_COLORS_UI: ColorsUi = { element: NO_ITEM, bold: false, italic: false, underline: false };

/** ElementClick: a style element loads its three attributes into the boxes; Background leaves them. */
export function selectElement(ui: ColorsUi, shown: EditorSettings, element: number): ColorsUi {
  const name = SYNTAX_ELEMENTS[element];
  if (name === undefined) return { ...ui, element };
  const style = shown.styles[name];
  return { element, bold: style.bold, italic: style.italic, underline: style.underline };
}

/**
 * A swatch was clicked (`setSyntaxPreviewColor`): the colour of the selected element, or the
 * background; with nothing selected no colour changes. Either way the preset becomes Custom and
 * the change counts (styleChange), which also turns highlighting back on.
 */
export function clickSwatch(draft: EditorDraft, ui: ColorsUi, shown: EditorSettings, color: number): EditorDraft {
  let next = draft;
  const name = SYNTAX_ELEMENTS[ui.element];
  if (name !== undefined) {
    next = { ...next, styles: { ...next.styles, [name]: { ...shown.styles[name], color } } };
  } else if (ui.element === BACKGROUND_ITEM) {
    next = { ...next, backgroundColor: color };
  }
  return styleChanged(next, COLOR_PRESET.custom, false);
}

/**
 * One of Bold, Italic, Underline was clicked (`setSyntaxPreviewStyle`): the three boxes become the
 * attributes of the selected style element (not of the background, not of nothing); the preset
 * becomes Custom and the change counts.
 */
export function toggleAttribute(
  draft: EditorDraft,
  ui: ColorsUi,
  shown: EditorSettings,
  attribute: 'bold' | 'italic' | 'underline',
  on: boolean,
): { draft: EditorDraft; ui: ColorsUi } {
  const nextUi = { ...ui, [attribute]: on };
  let next = draft;
  const name = SYNTAX_ELEMENTS[ui.element];
  if (name !== undefined) {
    const style: SyntaxStyle = {
      color: shown.styles[name].color,
      bold: nextUi.bold,
      italic: nextUi.italic,
      underline: nextUi.underline,
    };
    next = { ...next, styles: { ...next.styles, [name]: style } };
  }
  return { draft: styleChanged(next, COLOR_PRESET.custom, false), ui: nextUi };
}

/**
 * A preset was chosen (`SyntaxComboChange`): the element is deselected and the boxes cleared.
 * Custom changes nothing else (and is not a style change: highlighting stays as it is). Every other
 * preset sets all eight elements (editor-ui §11.2 table; Auto stores the Color1 values) and never
 * the background; Disabled also turns highlighting off, the others turn it on.
 */
export function choosePreset(draft: EditorDraft, preset: number): { draft: EditorDraft; ui: ColorsUi } {
  const ui = INITIAL_COLORS_UI;
  if (preset === COLOR_PRESET.custom) return { draft: { ...draft, colorPreset: COLOR_PRESET.custom }, ui };
  const chosen = presetStyles(preset);
  if (chosen === null) return { draft, ui };
  const styles: Partial<Record<SyntaxElement, SyntaxStyle>> = {};
  for (const element of SYNTAX_ELEMENTS) styles[element] = { ...chosen.styles[element] };
  return {
    draft: styleChanged({ ...draft, styles }, preset as EditorSettings['colorPreset'], chosen.highlightDisabled),
    ui,
  };
}

/**
 * OK, step 1 (editorOptions.cpp:66-118): the active document takes the font and size of the boxes,
 * and the tab type and size of the controls (clamped to 4..20). The text and the modified flag do
 * not change (note 8; DocumentService.update leaves both alone).
 */
export function documentPatch(live: EditorSettings, draft: EditorDraft): DocumentPatch {
  const shown = shownSettings(live, draft);
  return {
    fontName: shown.fontName,
    fontSize: shown.fontSize,
    tabType: shown.tabType,
    tabSize: clampTabSize(shown.fixedTabSize),
  };
}

/** OK, step 2: the settings with the draft applied (only what the user changed). */
export function applyEditorDraft<S extends { editor: EditorSettings }>(settings: S, draft: EditorDraft): S {
  const editor: EditorSettings = { ...settings.editor, styles: { ...settings.editor.styles } };
  const { styles, ...rest } = draft;
  Object.assign(editor, rest);
  for (const element of SYNTAX_ELEMENTS) {
    const style = styles?.[element];
    if (style) editor.styles[element] = { ...style };
  }
  if (draft.fixedTabSize !== undefined) editor.fixedTabSize = clampTabSize(draft.fixedTabSize);
  return { ...settings, editor };
}

/** `TabType` as the Current File Info shows it. */
export function tabTypeName(tabType: TabType): string {
  return tabType === TabType.Assembly ? TAB_TYPE_NAMES.assembly : TAB_TYPE_NAMES.fixed;
}

/* ================================================================ shared by the components */

/** CSS font-family for one of the original's font names, where the system has it (the template box, the preview). */
export function cssFontFamily(name: string): string {
  const clean = name.replace(/["\\\n\r]/g, '').trim();
  return clean === '' ? 'var(--font-mono)' : `"${clean}", var(--font-mono)`;
}

/**
 * The dialogs' help key in the chord form of commands/chords.ts: F1 on every system (the chord of
 * `ed.help.help` on Windows and macOS). The modeless Assembler Options dialog lists it in
 * `data-e68-own-keys` so that the shell leaves it to the dialog.
 */
export const HELP_CHORD = 'F1';

/** True for F1 without modifiers: the dialog's help key. */
export function isHelpKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return event.key === 'F1' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
