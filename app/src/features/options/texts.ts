// Every caption and text of the three dialogs of this feature, verbatim from the original forms
// (optionsS.dfm, optionsS.cpp, editorOptions.dfm; editor-ui §11.1, §11.2) where the original has
// them, and the port's own texts for `settings.transfer` (ARCHITECTURE.md 3.10, 1.5). Kept in one
// place so that the tests and the browser check compare against the same strings. Owner: E4.

import type { MessageBoxRequest } from '../../contracts';

/* ---------------------------------------------------------------- dialog ids (2.7) */

export const ASSEMBLER_OPTIONS_DIALOG_ID = 'options.assembler';
export const EDITOR_OPTIONS_DIALOG_ID = 'options.editor';
export const TRANSFER_DIALOG_ID = 'settings.transfer';

/** The help page of both option dialogs (1.4 note 8: `options.htm`, the evident intent). */
export const OPTIONS_HELP_PAGE = 'options.htm';

/* ---------------------------------------------------------------- Assembler Options (§11.1) */

export const ASSEMBLER_OPTIONS_TITLE = 'EASy68K Assembler Options';
export const ASSEMBLER_TAB_CAPTION = 'Assembler Options';
export const TEMPLATE_TAB_CAPTION = 'Template';
export const ASSEMBLER_GROUP_CAPTION = 'Assembler Options';
export const LIST_GROUP_CAPTION = 'List File Options';
export const SAVE_TEMPLATE_CAPTION = '&Save Template';
export const ASSEMBLER_OK_CAPTION = '&OK';
export const ASSEMBLER_OK_HINT = 'Save Settings';
export const ASSEMBLER_CANCEL_CAPTION = 'C&ancel';

/** The question of `cmdOKClick` (optionsS.cpp:56-59), two blanks after each sentence. */
export const SIM68K_QUESTION_TEXT =
  'You have unchecked options that are required for use by the 68000 simulator Sim68K.  ' +
  'Without these options many features of Sim68K will be unavailable.  Do you wish to continue?';

/** `MessageDlg(msgbuff, mtInformation, mbYes << mbNo, 0)`: title Information, information icon. */
export const SIM68K_QUESTION: MessageBoxRequest = Object.freeze({
  title: 'Information',
  text: SIM68K_QUESTION_TEXT,
  icon: 'information',
  buttons: ['Yes', 'No'],
}) as MessageBoxRequest;

/* ---------------------------------------------------------------- Editor Options (§11.2) */

export const EDITOR_OPTIONS_TITLE = 'EASy68K Editor Options';
export const GENERAL_TAB_CAPTION = 'General';
export const COLORS_TAB_CAPTION = 'Colors';
export const NEW_FILE_GROUP_CAPTION = 'New File Settings';
export const NEW_FONT_CAPTION = 'New Font:';
export const NEW_FONT_SIZE_CAPTION = 'New Font Size:';
export const FIXED_TAB_SIZE_CAPTION = 'Fixed Tab Size:';
export const ASSEMBLY_TABS_CAPTION = 'Assembly Tabs';
export const FIXED_TABS_CAPTION = 'Fixed Tabs';
export const CURRENT_FILE_GROUP_CAPTION = 'Current File Info';
export const CURRENT_FONT_CAPTION = 'Font:';
export const CURRENT_FONT_SIZE_CAPTION = 'Font Size:';
export const CURRENT_TAB_SIZE_CAPTION = 'Fixed Tab Size:';
export const CURRENT_TAB_TYPE_CAPTION = 'Tab Type:';
export const ENVIRONMENT_GROUP_CAPTION = 'Environment';
export const AUTO_INDENT_CAPTION = 'Auto Indent';
export const REAL_TABS_CAPTION = 'Real Tabs';
export const ELEMENT_CAPTION = '&Element';
export const TEXT_ATTRIBUTES_GROUP_CAPTION = 'Text Attributes';
export const BOLD_CAPTION = '&Bold';
export const ITALIC_CAPTION = '&Italic';
export const UNDERLINE_CAPTION = '&Underline';
export const COLOR_PRESETS_CAPTION = 'Color &Presets';
export const PRINT_BLACK_CAPTION = 'Print w/Black';
export const COLOR_GROUP_CAPTION = '&Color';
export const PREVIEW_CAPTION = 'Preview';
export const EDITOR_OK_CAPTION = '&OK';
export const EDITOR_CANCEL_CAPTION = '&Cancel';
export const EDITOR_HELP_CAPTION = '&Help';

/** `CurrentTabType->Caption` (editorOptions.cpp:181-184). */
export const TAB_TYPE_NAMES = Object.freeze({ assembly: 'Assembly', fixed: 'Fixed' });

/**
 * The `Element` list (editorOptions.dfm:678-687), in its order; the index is `Element->ItemIndex`.
 * The first eight are style elements, the ninth the background.
 */
export const ELEMENT_NAMES: readonly string[] = [
  'Code',
  'Comment',
  'Directive',
  'Label',
  'Macro/Other',
  'Structured',
  'Structure Error',
  'Text',
  'Background',
];

/**
 * The `Color Presets` list: the original's five items (editorOptions.dfm `SyntaxCombo`) and,
 * after them, the port's `Auto` (1.4 note 19, 1.5: added items come after the original's). The
 * index is `EditorSettings.colorPreset`.
 */
export const PRESET_NAMES: readonly string[] = ['Color1', 'Color2', 'No Color', 'Custom', 'Disabled', 'Auto'];

/**
 * The preview (editorOptions.dfm `Panel1`): each run of text with the element it is drawn in,
 * line by line, at the positions of the labels (`highlightPreview`, editorOptions.cpp:483-554).
 */
export const PREVIEW_LINES: readonly (readonly [text: string, element: number | null][])[] = [
  [['* Syntax Highlight', 1]],
  [
    ['START', 3],
    ['   ', null],
    ['MOVE.B #1,D0', 0],
  ],
  [
    ['        ', null],
    ['Macro/Other', 4],
  ],
  [
    ['    ', null],
    ['if <NE> then', 5],
  ],
  [
    ['    ', null],
    ['of <NE> tehn', 6],
  ],
  [
    ['        ', null],
    ['DC.B', 2],
    [' ', null],
    ["'HELLO'", 7],
  ],
];

/* ---------------------------------------------------------------- settings.transfer (3.10, 1.5) */

export const TRANSFER_TITLE = 'Import/Export Settings';
export const TRANSFER_INTRO =
  'These files are in the format of EASy68K v5.16.1 for Windows. Importing one replaces the settings it holds ' +
  'in every window of this application. Window positions are not imported; exported files contain the ' +
  "original's default positions.";
export const TRANSFER_IMPORT_CAPTION = 'Import...';
export const TRANSFER_EXPORT_CAPTION = 'Export...';
export const TRANSFER_CLOSE_CAPTION = 'Close';

/** The three files, in the order of the dialog. */
export type TransferFileKind = 'settings' | 'sim' | 'template';
export const TRANSFER_FILES: readonly {
  kind: TransferFileKind;
  fileName: string;
  caption: string;
  importTitle: string;
  exportTitle: string;
}[] = [
  {
    kind: 'settings',
    fileName: 'settings.dat',
    caption: 'Editor/Assembler settings',
    importTitle: 'Import settings.dat',
    exportTitle: 'Export settings.dat',
  },
  {
    kind: 'sim',
    fileName: 'sim68K.dat',
    caption: 'Simulator settings',
    importTitle: 'Import sim68K.dat',
    exportTitle: 'Export sim68K.dat',
  },
  {
    kind: 'template',
    fileName: 'template.NEW',
    caption: 'New file template',
    importTitle: 'Import template.NEW',
    exportTitle: 'Export template.NEW',
  },
];

export const transferImported = (fileName: string, path: string) => `Imported ${fileName} from ${path}.`;
export const transferExported = (fileName: string, path: string) => `Exported ${fileName} to ${path}.`;
export const transferFailed = (fileName: string, reason: string) => `${fileName} could not be transferred: ${reason}`;
export const TRANSFER_UNMAPPABLE = 'Characters that Windows-1252 cannot hold were written as "?" in template.NEW.';
