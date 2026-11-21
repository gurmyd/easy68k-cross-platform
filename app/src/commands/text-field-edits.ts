// The Ctrl forms of the editing keys in plain text fields on macOS (rule K2 of 1.3). Owner: W3.
//
// On macOS every Ctrl+letter shortcut works with Cmd or Ctrl (K2), and the chord table gives Undo,
// Redo, Cut, Copy, Paste and Select All both forms (tables/keys.ts). The dispatcher leaves these
// chords to a focused text field (TEXT_EDITING_COMMANDS, errata W3.md entry 1), where the browser
// edits on its own. But a Mac's browser treats only the Cmd forms as editing keys: Ctrl+C and Ctrl+X
// do nothing, Ctrl+V pages down or does nothing, Ctrl+A moves to the start of the line (an Emacs
// key of macOS), Ctrl+Z does nothing. So on the macOS key map the dispatcher performs the Ctrl forms
// itself in a plain text field (an input or a textarea) and cancels the key, whatever the field is
// (a dialog's input, the Find box, the Address field) and whichever mode is shown. The editor
// (CodeMirror, an editable element, not a plain text field) does the same in its own key map
// (errata E2.md entry 13). Errata W3.md entry 34.
//
// What each one does is what the Cmd form does in the browser:
//
//   - Select All selects the whole field;
//   - Undo and Redo use the field's own undo history (`execCommand('undo' | 'redo')`);
//   - Cut and Copy use `execCommand`, which a browser allows during the key press, with the
//     Clipboard API as fallback; with nothing selected they do nothing, as the Cmd forms do; a
//     password field is never copied from;
//   - Paste has no browser command a page may run: the desktop app pastes natively
//     (`Platform.pasteIntoFocus`); a browser is asked for the clipboard (`navigator.clipboard`), and
//     when it refuses, a toast says `Press Cmd+V to paste`, as Paste from the menu does (1.4 note 45).

import type { Os } from './chords';
import type { KnownCommandId } from './ids';
import { chordsOn } from './specs';
import { TEXT_EDITING_COMMANDS } from './tables/keys';

/** An editing action that the dispatcher performs in a plain text field. */
export type TextFieldEdit = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

const EDIT_OF: Readonly<Partial<Record<KnownCommandId, TextFieldEdit>>> = {
  'ed.edit.undo': 'undo',
  'ed.edit.redo': 'redo',
  'ed.edit.cut': 'cut',
  'ed.edit.copy': 'copy',
  'ed.edit.paste': 'paste',
  'ed.edit.selectAll': 'selectAll',
};

/**
 * The chords that the dispatcher performs itself in a plain text field, with their action: on the
 * macOS key map the Ctrl forms the chord table gives the text-editing commands (Ctrl+Z, X, C, V, A
 * and Ctrl+Option+Z), none elsewhere (Ctrl is the platform's own key there and the browser edits).
 */
export function textFieldEditChords(os: Os, desktop: boolean): Map<string, TextFieldEdit> {
  const result = new Map<string, TextFieldEdit>();
  if (os !== 'mac') return result;
  for (const id of TEXT_EDITING_COMMANDS) {
    const edit = EDIT_OF[id];
    if (edit === undefined) continue;
    for (const chord of chordsOn(id, os, desktop)) if (chord.startsWith('Ctrl+')) result.set(chord, edit);
  }
  return result;
}

/** The parts of an input or a textarea that the actions use. */
export interface PlainTextField {
  readonly value: string;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
  readonly type?: string;
  select(): void;
}

/** What the actions need from the page; the bootstrap passes the browser's, tests pass fakes. */
export interface TextEditHost {
  /** `document.execCommand(command, false, value)`; false when the browser refused. */
  execCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'delete' | 'insertText', value?: string): boolean;
  /** Puts `text` in place of the field's selection when `insertText` is refused (and says so). */
  replaceSelection(field: PlainTextField, text: string): void;
  /** `navigator.clipboard.readText`, or null where the page has none. */
  readClipboard: (() => Promise<string>) | null;
  /** `navigator.clipboard.writeText`, or null. */
  writeClipboard: ((text: string) => Promise<void>) | null;
  /** `Platform.pasteIntoFocus` (the desktop app), null in a browser. */
  pasteIntoFocus: (() => void) | null;
  /** True while `field` still has the focus (the clipboard answers later). */
  hasFocus(field: PlainTextField): boolean;
  /** Shows a toast. */
  toast(text: string): void;
}

/** The toast of a refused paste on macOS (1.4 note 45). */
export const PASTE_REFUSED_MAC = 'Press Cmd+V to paste';

function selection(field: PlainTextField): [number, number] | null {
  const { selectionStart: start, selectionEnd: end } = field;
  return start === null || end === null || end <= start ? null : [start, end];
}

/** Performs `edit` in `field`. Resolves when it is done (a paste waits for the clipboard). */
export async function performTextFieldEdit(
  edit: TextFieldEdit,
  field: PlainTextField,
  host: TextEditHost,
): Promise<void> {
  switch (edit) {
    case 'selectAll':
      field.select();
      return;
    case 'undo':
    case 'redo':
      host.execCommand(edit);
      return;
    case 'cut':
    case 'copy': {
      const range = selection(field);
      if (range === null || field.type?.toLowerCase() === 'password') return;
      if (host.execCommand(edit)) return;
      if (host.writeClipboard === null) return;
      try {
        await host.writeClipboard(field.value.slice(range[0], range[1]));
      } catch {
        return;
      }
      if (edit === 'cut' && !host.execCommand('delete')) host.replaceSelection(field, '');
      return;
    }
    case 'paste': {
      if (host.pasteIntoFocus !== null) {
        host.pasteIntoFocus();
        return;
      }
      if (host.readClipboard === null) {
        host.toast(PASTE_REFUSED_MAC);
        return;
      }
      let text: string;
      try {
        text = await host.readClipboard();
      } catch {
        host.toast(PASTE_REFUSED_MAC);
        return;
      }
      if (text.length === 0 || !host.hasFocus(field)) return;
      if (!host.execCommand('insertText', text)) host.replaceSelection(field, text);
      return;
    }
  }
}

/**
 * The host of a browser page: `document`, `navigator.clipboard`, and from the application the
 * desktop app's native paste and the toast.
 */
export function browserTextEditHost(pasteIntoFocus: (() => void) | null, toast: (text: string) => void): TextEditHost {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  return {
    execCommand: (command, value) => {
      try {
        return document.execCommand(command, false, value);
      } catch {
        return false;
      }
    },
    replaceSelection: (field, text) => {
      const element = field as unknown as HTMLInputElement | HTMLTextAreaElement;
      element.setRangeText(text, element.selectionStart ?? 0, element.selectionEnd ?? 0, 'end');
      element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    readClipboard: clipboard?.readText ? () => clipboard.readText() : null,
    writeClipboard: clipboard?.writeText ? (text) => clipboard.writeText(text) : null,
    pasteIntoFocus,
    hasFocus: (field) => document.activeElement === (field as unknown),
    toast,
  };
}
