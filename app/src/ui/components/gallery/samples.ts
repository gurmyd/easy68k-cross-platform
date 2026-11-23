// Sample data of the gallery: the original's menus, toolbars and texts, so
// that the kit is shown with the content it will carry. Owner: W2.

import type { IconName } from '../icons';
import type { MenuBarMenu, MenuEntry } from '../menu-model';

const sep = (id: string): MenuEntry => ({ type: 'separator', id });

/** The editor's menus (editor-ui §2; shortcuts of the Windows column of 1.3.1). */
export const EDITOR_MENUS: MenuBarMenu[] = [
  {
    id: 'file',
    caption: '&File',
    items: [
      { type: 'item', id: 'ed.file.new', caption: '&New X68 Source File' },
      { type: 'item', id: 'ed.file.open', caption: '&Open File...', shortcut: 'Ctrl+O' },
      sep('f1'),
      { type: 'item', id: 'ed.file.save', caption: '&Save', shortcut: 'Ctrl+S' },
      { type: 'item', id: 'ed.file.saveAs', caption: 'Save &As...' },
      sep('f2'),
      { type: 'item', id: 'ed.file.print', caption: '&Print', shortcut: 'Ctrl+P' },
      { type: 'item', id: 'ed.file.printerSetup', caption: 'Printer Setup...' },
      sep('f3'),
      { type: 'item', id: 'ed.file.close', caption: 'C&lose File' },
      sep('f4'),
      { type: 'item', id: 'ed.file.exit', caption: 'E&xit' },
    ],
  },
  {
    id: 'edit',
    caption: '&Edit',
    items: [
      { type: 'item', id: 'ed.edit.undo', caption: '&Undo', shortcut: 'Ctrl+Z' },
      { type: 'item', id: 'ed.edit.redo', caption: '&Redo', shortcut: 'Ctrl+Alt+Z', disabled: true },
      sep('e1'),
      { type: 'item', id: 'ed.edit.cut', caption: 'Cu&t', shortcut: 'Ctrl+X' },
      { type: 'item', id: 'ed.edit.copy', caption: '&Copy', shortcut: 'Ctrl+C' },
      { type: 'item', id: 'ed.edit.paste', caption: '&Paste', shortcut: 'Ctrl+V' },
      { type: 'item', id: 'ed.edit.selectAll', caption: 'Select &All', shortcut: 'Ctrl+A' },
      sep('e2'),
      { type: 'item', id: 'ed.edit.comment', caption: 'C&omment Selection', shortcut: 'Ctrl+Alt+C' },
      { type: 'item', id: 'ed.edit.uncomment', caption: 'Unco&mment Selection', shortcut: 'Ctrl+Alt+U' },
      sep('e3'),
      { type: 'item', id: 'ed.edit.find', caption: '&Find...', shortcut: 'Ctrl+F' },
      { type: 'item', id: 'ed.edit.findNext', caption: 'Find &Next', shortcut: 'F3', disabled: true },
      { type: 'item', id: 'ed.edit.replace', caption: 'Find And &Replace...', shortcut: 'Ctrl+R' },
    ],
  },
  {
    id: 'project',
    caption: '&Project',
    items: [{ type: 'item', id: 'ed.project.assemble', caption: '&Assemble Source...', shortcut: 'F9' }],
  },
  {
    id: 'options',
    caption: '&Options',
    items: [
      { type: 'item', id: 'ed.options.assembler', caption: '&Assembler Options...' },
      { type: 'item', id: 'ed.options.editor', caption: '&Editor Options...' },
    ],
  },
  {
    id: 'window',
    caption: '&Window',
    items: [
      { type: 'item', id: 'ed.window.arrange', caption: '&Arrange', disabled: true },
      { type: 'item', id: 'ed.window.cascade', caption: '&Cascade' },
      { type: 'item', id: 'ed.window.tileH', caption: 'Tile &Horizontally' },
      { type: 'item', id: 'ed.window.tileV', caption: '&Tile Vertically' },
      { type: 'item', id: 'ed.window.minimizeAll', caption: '&Minimize All', disabled: true },
      sep('w1'),
      { type: 'radio', id: 'ed.window.select.0', caption: '&1 demo.X68', checked: true },
      { type: 'radio', id: 'ed.window.select.1', caption: '&2 macros.X68', checked: false },
    ],
  },
  {
    id: 'help',
    caption: '&Help',
    items: [
      { type: 'item', id: 'ed.help.help', caption: 'Hel&p', shortcut: 'F1' },
      { type: 'item', id: 'ed.help.about', caption: '&About' },
    ],
  },
];

/** The simulator's Options menu (sim-ui §3.1): checks, a sub-menu of radio items. */
export const SIM_OPTIONS_MENU: MenuEntry[] = [
  { type: 'item', id: 'sim.options.sourceFont', caption: 'Source Window Font...' },
  { type: 'item', id: 'sim.options.outputFont', caption: 'Output Window Font...' },
  { type: 'item', id: 'sim.options.printerFont', caption: 'Printer Font...', disabled: true },
  sep('o1'),
  { type: 'item', id: 'sim.options.logOutput', caption: '&Log Output...' },
  { type: 'check', id: 'sim.options.exceptions', caption: '&Enable Exceptions', checked: true },
  { type: 'item', id: 'sim.options.autoTrace', caption: '&Auto Trace Options...' },
  { type: 'item', id: 'sim.options.fullscreen', caption: '&Fullscreen Options...' },
  { type: 'check', id: 'sim.options.bitField', caption: 'Enable &Bit Field Instructions', checked: false },
  {
    type: 'submenu',
    id: 'sim.options.size',
    caption: 'Output Window &Size',
    items: [
      '640x480',
      '800x600',
      '1024x768',
      '1280x800',
      '1280x1024',
      '1440x900',
      '1680x1050',
      '1920x1080',
      '1920x1200',
    ].map((size, index) => ({ type: 'radio', id: `sim.options.size.${index}`, caption: size, checked: index === 0 })),
  },
  { type: 'check', id: 'sim.options.textWrap', caption: 'Output Window Text &Wrap', checked: true },
];

/** The editor's context menu (1.3.2). */
export const EDITOR_CONTEXT_MENU: MenuEntry[] = [
  { type: 'item', id: 'ed.edit.undo', caption: '&Undo', shortcut: 'Ctrl+Z' },
  { type: 'item', id: 'ed.edit.redo', caption: '&Redo', shortcut: 'Ctrl+Alt+Z' },
  sep('c1'),
  { type: 'item', id: 'ed.edit.cut', caption: 'Cu&t', shortcut: 'Ctrl+X' },
  { type: 'item', id: 'ed.edit.copy', caption: '&Copy', shortcut: 'Ctrl+C' },
  { type: 'item', id: 'ed.edit.paste', caption: '&Paste', shortcut: 'Ctrl+V' },
  { type: 'item', id: 'ed.edit.selectAll', caption: 'Select &All', shortcut: 'Ctrl+A' },
  sep('c2'),
  { type: 'item', id: 'ed.edit.comment', caption: 'C&omment Selection', shortcut: 'Ctrl+Alt+C' },
  { type: 'item', id: 'ed.edit.uncomment', caption: 'Unco&mment Selection', shortcut: 'Ctrl+Alt+U' },
  sep('c3'),
  { type: 'item', id: 'ed.edit.reload', caption: '&Reload File' },
];

export interface ToolSample {
  id: string;
  icon: IconName;
  hint: string;
  disabled?: boolean;
}

/** The editor toolbar: 13 buttons, separators after New, Print, Find, Paste, Redo and Uncomment (1.3.2). */
export const EDITOR_TOOLBAR: (ToolSample | 'sep')[] = [
  { id: 'new', icon: 'file-new', hint: 'New' },
  'sep',
  { id: 'open', icon: 'file-open', hint: 'Open (Ctrl+O)' },
  { id: 'save', icon: 'file-save', hint: 'Save (Ctrl+S)' },
  { id: 'print', icon: 'print', hint: 'Print (Ctrl+P)' },
  'sep',
  { id: 'find', icon: 'find', hint: 'Find (Ctrl+F)' },
  'sep',
  { id: 'cut', icon: 'cut', hint: 'Cut (Ctrl+X)', disabled: true },
  { id: 'copy', icon: 'copy', hint: 'Copy (Ctrl+C)', disabled: true },
  { id: 'paste', icon: 'paste', hint: 'Paste (Ctrl+V)' },
  'sep',
  { id: 'undo', icon: 'undo', hint: 'Undo (Ctrl+Z)' },
  { id: 'redo', icon: 'redo', hint: 'Redo (Ctrl+Alt+Z)', disabled: true },
  'sep',
  { id: 'comment', icon: 'comment', hint: 'Comment Line (Ctrl+Alt+C)' },
  { id: 'uncomment', icon: 'uncomment', hint: 'Uncomment Line (Ctrl+Alt+U)' },
  'sep',
  { id: 'assemble', icon: 'assemble', hint: 'Assemble Source (F9)' },
];

/** The simulator toolbar (1.3.5), as it looks while a program is loaded and stopped. */
export const SIM_TOOLBAR: (ToolSample | 'sep')[] = [
  { id: 'open', icon: 'file-open', hint: 'Open (Ctrl+O)' },
  'sep',
  { id: 'run', icon: 'run', hint: 'Run (F9)' },
  'sep',
  { id: 'runTo', icon: 'run-to-cursor', hint: 'Run To Cursor (Ctrl+F9)' },
  { id: 'auto', icon: 'auto-trace', hint: 'Auto Trace (F10)' },
  { id: 'step', icon: 'step-over', hint: 'Step Over (F8)' },
  { id: 'trace', icon: 'trace-into', hint: 'Trace Into (F7)' },
  { id: 'pause', icon: 'pause', hint: 'Pause (F6)', disabled: true },
  'sep',
  { id: 'rewind', icon: 'rewind', hint: 'Rewind Program (Shift+F2)' },
  'sep',
  { id: 'reload', icon: 'reload', hint: 'Reload Program (Shift+F3)' },
  'sep',
  { id: 'logStart', icon: 'log-start', hint: 'Log Start (Shift+F4)', disabled: true },
  { id: 'logStop', icon: 'log-stop', hint: 'Log Stop (Shift+F5)' },
];

/** Message boxes of the original, verbatim (section 0 rule 7). */
export const MESSAGE_SAMPLES = [
  {
    title: 'Information',
    text: "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
    icon: 'information',
    buttons: ['OK'],
  },
  {
    title: 'Confirm',
    text: "File modified, do you wish to save 'demo.X68' before closing?",
    icon: 'confirmation',
    buttons: ['Yes', 'No', 'Cancel'],
  },
  { title: 'Warning', text: 'Breakpoint Limit Reached!', icon: 'warning', buttons: ['OK'] },
  { title: 'Error', text: 'File exists! OK to overwrite?', icon: 'error', buttons: ['Yes', 'No'] },
  // MessageBoxRequest.defaultButton (the stage of additions, docs/requests/N5-default-button.md):
  // the question of ARCHITECTURE-PLUS P3.3.4, where No has the focus and Enter answers No.
  {
    title: 'Delete',
    text: 'EASy68K cannot keep a copy of "prog.X68" in the Trash. Delete it anyway? This cannot be undone.',
    icon: 'warning',
    buttons: ['Yes', 'No'],
    defaultButton: 'No',
  },
] as const;

/** Rows of the editor's message list (2.2). */
export const MESSAGE_ROWS = [
  { line: 9, text: 'ERROR: Undefined symbol' },
  { line: 14, text: 'WARNING: Forcing SHORT addressing disables range checking of extension word' },
  { line: 22, text: 'ERROR: Invalid addressing mode' },
  { line: 31, text: 'ERROR: Comma expected' },
  { line: 47, text: 'WARNING: END directive missing, starting address not set' },
];

/** The fixed caption above the SR field (sim-ui §4.1), one character per bit. Verbatim: two and three spaces. */
export const SR_FLAGS_CAPTION = 'T S  INT   XNZVC';

/** Rows of the gallery's grid with several selected rows (DataGrid's optional `multiSelect`, ARCHITECTURE-PLUS P5 N4: the Trash). */
export const TRASH_SAMPLE_ROWS = [
  { name: 'prog.X68', wasIn: 'My Programs/demo', why: 'Deleted' },
  { name: 'demo', wasIn: 'My Programs', why: 'Deleted' },
  { name: 'lab1.X68', wasIn: 'Lab', why: 'Replaced' },
  { name: 'notes.txt', wasIn: 'My Programs', why: 'Deleted' },
  { name: 'macros.X68', wasIn: 'My Programs/lib', why: 'Deleted' },
  { name: 'old.X68', wasIn: 'My Programs/demo', why: 'Replaced' },
];

/** The drag type of the gallery's draggable tabs (Tabs' optional `drag`, ARCHITECTURE-PLUS P5 N2). */
export const GALLERY_TAB_DRAG_TYPE = 'application/x-e68-gallery-tab';

/** Moves the item `moved` before the item `before` (null: to the end); an unknown id changes nothing. */
export function moveItemBefore<T extends { id: string }>(
  items: readonly T[],
  moved: string,
  before: string | null,
): T[] {
  const item = items.find((entry) => entry.id === moved);
  if (!item || moved === before) return [...items];
  const rest = items.filter((entry) => entry.id !== moved);
  const at = before === null ? rest.length : rest.findIndex((entry) => entry.id === before);
  return at < 0 ? [...items] : [...rest.slice(0, at), item, ...rest.slice(at)];
}
