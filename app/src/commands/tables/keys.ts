// The chord table (ARCHITECTURE.md 2.9.2), written from the parity matrix of section 1.3. Owner: W3.
//
// Per command: the chords on Windows and Linux (`win`), the chords on macOS (`mac`), and two
// lists that mark chords among them:
//
//   desktopOnly   the chord acts only in the desktop app, because browsers reserve it (2.9.3):
//                 Cmd+W, Cmd+Q, Cmd+N, Cmd+R, Cmd+, and Ctrl+F4, Ctrl+Tab. Ctrl+F4 is reserved by
//                 the browsers of Windows and Linux only (DESKTOP_ONLY_ON_WINDOWS_AND_LINUX);
//   notInOutput   a chord the port added (rules K3 and K5). It does not exist while the Output
//                 panel has the keyboard, where the key belongs to the running program (2.9.4).
//
// The first chord of a list that is usable on the platform is the one menus and tool-tips show.
// Chords are written as section 1.3 writes them (`Shift+Cmd+S`, `Ctrl+Option+Z`); specs.ts brings
// them into normal form (chords.ts) and its `chordsOn()` answers which chords of a command act on
// a platform. Code reads the table through that function, not through these lists.
//
// The rules of section 1.3, applied here and nowhere else:
//
//   K1  Windows and Linux use the original keys.
//   K2  On macOS every Ctrl+letter shortcut works with Cmd or Ctrl; the Cmd form is shown. The one
//       exception is Ctrl+R (Cmd+R reloads the page in a browser).
//   K3  Shift+F<n> is an alternative to Ctrl+F<n>. macOS shows the Shift form, because the system
//       reserves Ctrl+F2..F8 unless the user has switched that off; the Ctrl form still works where
//       the system delivers it (2.9.4 takes it in the Output panel on every platform).
//   K5  F2 = next panel (for Ctrl+Tab), F4 = next mode. Both are additions.
//   K6  A chord with Option is matched by the position of the letter key on macOS, and every
//       command with such a chord also has one without Option, listed first. On Windows and Linux
//       a Ctrl+Alt+letter chord follows the key's label like the original's accelerators, and
//       its position only when the key types no ASCII letter (chords.ts; errata/W3.md entry 24).

import type { CommandSpec } from '../../contracts';
import type { KnownCommandId } from '../ids';

export type KeyEntry = CommandSpec['keys'];

export const KEYS: Partial<Record<KnownCommandId, KeyEntry>> = {
  // ---- Editor (1.3.1, 1.3.2)
  'ed.file.open': { win: ['Ctrl+O'], mac: ['Cmd+O', 'Ctrl+O'] },
  'ed.file.save': { win: ['Ctrl+S'], mac: ['Cmd+S', 'Ctrl+S'] },
  'ed.file.saveAs': { win: [], mac: ['Shift+Cmd+S'] },
  'ed.file.print': { win: ['Ctrl+P'], mac: ['Cmd+P', 'Ctrl+P'] },
  'ed.file.close': { win: [], mac: ['Cmd+W'], desktopOnly: ['Cmd+W'] },
  'ed.file.exit': { win: [], mac: ['Cmd+Q'], desktopOnly: ['Cmd+Q'] },
  'ed.edit.undo': { win: ['Ctrl+Z'], mac: ['Cmd+Z', 'Ctrl+Z'] },
  'ed.edit.redo': { win: ['Ctrl+Alt+Z'], mac: ['Shift+Cmd+Z', 'Ctrl+Option+Z'] },
  'ed.edit.cut': { win: ['Ctrl+X'], mac: ['Cmd+X', 'Ctrl+X'] },
  'ed.edit.copy': { win: ['Ctrl+C'], mac: ['Cmd+C', 'Ctrl+C'] },
  'ed.edit.paste': { win: ['Ctrl+V', 'Shift+Insert'], mac: ['Cmd+V', 'Ctrl+V'] },
  'ed.edit.selectAll': { win: ['Ctrl+A'], mac: ['Cmd+A', 'Ctrl+A'] },
  'ed.edit.comment': { win: ['Ctrl+Alt+C'], mac: ['Cmd+/', 'Ctrl+Option+C'] },
  'ed.edit.uncomment': { win: ['Ctrl+Alt+U'], mac: ['Shift+Cmd+/', 'Ctrl+Option+U'] },
  'ed.edit.find': { win: ['Ctrl+F'], mac: ['Cmd+F', 'Ctrl+F'] },
  'ed.edit.findNext': { win: ['F3'], mac: ['F3', 'Cmd+G'] },
  'ed.edit.replace': { win: ['Ctrl+R'], mac: ['Ctrl+R', 'Cmd+R'], desktopOnly: ['Cmd+R'] },
  'ed.project.assemble': { win: ['F9'], mac: ['F9', 'Cmd+B'] },
  'ed.options.editor': { win: [], mac: ['Cmd+,'], desktopOnly: ['Cmd+,'] },
  // F1 belongs to two commands. The dispatcher runs the first ENABLED one in the order of this
  // table (keymap.ts): context help while the editor has the focus (its handler reports itself
  // enabled only then), otherwise the help contents.
  'ed.help.context': { win: ['F1'], mac: ['F1'] },
  'ed.help.help': { win: ['F1'], mac: ['F1'] },
  'ed.edit.toggleInsert': { win: ['Insert'], mac: ['Ctrl+Shift+I'] },
  'ed.edit.indent': { win: ['Ctrl+Shift+.'], mac: ['Ctrl+Shift+.'] },
  'ed.edit.outdent': { win: ['Ctrl+Shift+,'], mac: ['Ctrl+Shift+,'] },

  // ---- Simulator (1.3.4, 1.3.5, 1.3.6)
  'sim.file.open': { win: ['Ctrl+O'], mac: ['Cmd+O', 'Ctrl+O'] },
  'sim.file.exit': { win: [], mac: ['Cmd+Q'], desktopOnly: ['Cmd+Q'] },
  'sim.search.find': { win: ['Ctrl+F'], mac: ['Cmd+F', 'Ctrl+F'] },
  'sim.search.gotoPC': { win: ['Ctrl+G'], mac: ['Cmd+G', 'Ctrl+G'] },
  'sim.run.run': { win: ['F9'], mac: ['F9'] },
  'sim.run.runToCursor': { win: ['Ctrl+F9', 'Shift+F9'], mac: ['Ctrl+F9', 'Shift+F9'], notInOutput: ['Shift+F9'] },
  'sim.run.autoTrace': { win: ['F10'], mac: ['F10'] },
  'sim.run.stepOver': { win: ['F8'], mac: ['F8'] },
  'sim.run.traceInto': { win: ['F7'], mac: ['F7'] },
  'sim.run.pause': { win: ['F6'], mac: ['F6'] },
  'sim.run.rewind': { win: ['Ctrl+F2', 'Shift+F2'], mac: ['Shift+F2', 'Ctrl+F2'], notInOutput: ['Shift+F2'] },
  'sim.run.reload': { win: ['Ctrl+F3', 'Shift+F3'], mac: ['Shift+F3', 'Ctrl+F3'], notInOutput: ['Shift+F3'] },
  // Ctrl+F4 closes the tab in a browser on Windows and Linux (2.9.3): there the Shift form is shown
  // and Ctrl+F4 is left to the desktop app. A browser on macOS has no use for Ctrl+F4, so there it
  // is an ordinary chord like Ctrl+F2 (DESKTOP_ONLY_ON_WINDOWS_AND_LINUX below).
  'sim.run.logStart': {
    win: ['Ctrl+F4', 'Shift+F4'],
    mac: ['Shift+F4', 'Ctrl+F4'],
    desktopOnly: ['Ctrl+F4'],
    notInOutput: ['Shift+F4'],
  },
  'sim.run.logStop': { win: ['Ctrl+F5', 'Shift+F5'], mac: ['Shift+F5', 'Ctrl+F5'], notInOutput: ['Shift+F5'] },
  'sim.help.context': { win: ['F1'], mac: ['F1'] },
  'sim.panel.next': {
    win: ['F2', 'Ctrl+Tab'],
    mac: ['F2', 'Ctrl+Tab'],
    desktopOnly: ['Ctrl+Tab'],
    notInOutput: ['F2'],
  },
  // The three commands of the Output panel itself (2.9.4 rules 1 and 4). The dispatcher never acts
  // on these chords; the Output panel does, while it has the keyboard (OUTPUT_PANEL_COMMANDS).
  'sim.output.fullscreen': { win: ['Alt+Enter'], mac: ['Option+Return'] },
  'sim.output.paste': { win: ['Shift+Insert'], mac: ['Cmd+V'] },
  'sim.output.releaseKeyboard': { win: ['Ctrl+Alt+O'], mac: ['Ctrl+Option+O'] },

  // ---- EASyBIN (1.3.8)
  'bin.file.openSrec': { win: ['Ctrl+O'], mac: ['Cmd+O', 'Ctrl+O'] },
  'bin.file.openBinary': { win: ['Ctrl+B'], mac: ['Cmd+B', 'Ctrl+B'] },
  'bin.file.saveSrec': { win: ['Ctrl+R'], mac: ['Ctrl+R'] },
  'bin.file.saveBinary': { win: ['Ctrl+S'], mac: ['Cmd+S', 'Ctrl+S'] },
  // F1 opens easybin.htm in the original's memory area and Address field (Form1u.cpp, VK_F1); its
  // Help action has no ShortCut, so menus show none (NOT_SHOWN_IN_MENUS). docs/requests/B1-keys.md.
  'bin.help.help': { win: ['F1'], mac: ['F1'] },

  // ---- Every mode (1.5)
  'app.mode.next': { win: ['F4'], mac: ['F4'], notInOutput: ['F4'] },
  'app.window.new': { win: [], mac: ['Cmd+N'], desktopOnly: ['Cmd+N'] },
};

/**
 * `desktopOnly` chords that only the browsers of Windows and Linux reserve; on macOS they act in
 * a browser as well. `CommandSpec.keys.desktopOnly` is one list for both key maps, so the
 * platform is named here.
 *
 * Ctrl+F4 closes the tab in a browser on Windows and Linux (2.9.3, first row; section 1.4 note
 * 25). No browser on macOS acts on it. There it is one of the system's Ctrl+F<n> shortcuts, like
 * Ctrl+F2, F3 and F5 (2.9.3, row "Ctrl+F2 .. Ctrl+F8 (macOS)"): once the user has switched those
 * off, the key reaches the page, and it is the original's Log Start.
 */
export const DESKTOP_ONLY_ON_WINDOWS_AND_LINUX: readonly string[] = ['Ctrl+F4'];

/**
 * Commands whose key is a key of the window, not a menu shortcut: the original's menu shows none
 * next to `Help > Help` (editor-ui §2.6), although F1 on the frame opens it (editor-ui §5.2).
 * EASyBIN's `Help > EASyBIN Help` likewise (its TAction in Form1u.dfm has no ShortCut; F1 is
 * handled by the memory area and the Address field, docs/porting/easybin.md 15.2).
 * Menus and tool-tips show no shortcut for these.
 */
export const NOT_SHOWN_IN_MENUS: readonly KnownCommandId[] = ['ed.help.help', 'bin.help.help'];

/** The eleven commands whose shortcuts TRAP #15 task 24 removes (sim-ui §3.5). */
export const SUPPRESSED_BY_TASK_24: readonly KnownCommandId[] = [
  'sim.file.open',
  'sim.run.run',
  'sim.run.stepOver',
  'sim.run.traceInto',
  'sim.run.pause',
  'sim.run.rewind',
  'sim.run.reload',
  'sim.run.autoTrace',
  'sim.run.runToCursor',
  'sim.run.logStart',
  'sim.run.logStop',
];

/**
 * Keys of the main window that the original also ignores after task 24 (sim-ui §3.5: "F1 and
 * Ctrl+Tab on the main window are ignored"; section 1.3.5, row "TRAP #15 task 24").
 */
export const ALSO_IGNORED_AFTER_TASK_24: readonly KnownCommandId[] = ['sim.help.context', 'sim.panel.next'];

/**
 * Commands whose chords belong to the Output panel alone (2.9.4): the original handles them in
 * the I/O window's own key handler, so they do nothing in any other panel.
 */
export const OUTPUT_PANEL_COMMANDS: readonly KnownCommandId[] = [
  'sim.output.fullscreen',
  'sim.output.paste',
  'sim.output.releaseKeyboard',
];

/**
 * The commands that edit text in the focused field: cut, copy, paste, select all, undo, redo.
 * Their chords without Alt are the platform's own text-editing keys. While a text field or the
 * editor has the focus the dispatcher leaves them to it (keymap.ts explains why).
 */
export const TEXT_EDITING_COMMANDS: readonly KnownCommandId[] = [
  'ed.edit.undo',
  'ed.edit.redo',
  'ed.edit.cut',
  'ed.edit.copy',
  'ed.edit.paste',
  'ed.edit.selectAll',
];

/**
 * Commands of keys that the original handles in the editor control only: Insert (toggle Insert /
 * Replace) and Ctrl+Shift+. / Ctrl+Shift+, (indent, outdent). Their handlers report themselves
 * enabled only while the editor has the focus, as F1's context help does (errata/W3.md entry 8).
 * While such a command is disabled and a text field outside the editor has the focus, the
 * dispatcher leaves the key to that field instead of cancelling it (keymap.ts; errata/W3.md
 * entry 25): in the original a text field of a dialog gets these keys itself.
 */
export const EDITOR_FOCUS_COMMANDS: readonly KnownCommandId[] = [
  'ed.edit.toggleInsert',
  'ed.edit.indent',
  'ed.edit.outdent',
];

/**
 * Chords whose browser action is always cancelled, in every mode and whether or not a command is
 * bound to them (2.9.3: "F5, F6, F7, F10, Ctrl+O/S/P/F/G/R - browser defaults that a page may
 * cancel - the dispatcher calls preventDefault()"). Reloading the page on F5 or opening the
 * browser's own Save dialog on Ctrl+S would throw away the simulator's state or confuse a student
 * who knows the keys from the original. On macOS the Cmd forms are guarded as well, except Cmd+R:
 * a page cannot dependably keep a browser from reloading on it (2.9.3).
 */
export const GUARDED_CHORDS: { win: readonly string[]; mac: readonly string[] } = {
  win: ['F5', 'F6', 'F7', 'F10', 'Ctrl+O', 'Ctrl+S', 'Ctrl+P', 'Ctrl+F', 'Ctrl+G', 'Ctrl+R'],
  mac: [
    'F5',
    'F6',
    'F7',
    'F10',
    'Ctrl+O',
    'Ctrl+S',
    'Ctrl+P',
    'Ctrl+F',
    'Ctrl+G',
    'Ctrl+R',
    'Cmd+O',
    'Cmd+S',
    'Cmd+P',
    'Cmd+F',
    'Cmd+G',
  ],
};
