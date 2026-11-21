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
//   - Undo and Redo take back and put back the field's last change. The shell keeps that history
//     itself (TextFieldHistory below), from the field's `beforeinput` and `input` events, because
//     the browser's own history cannot be relied on for it: on the macOS runner, WebKit put the
//     typing and the cut that followed it into ONE undo step, so `execCommand('undo')` took back
//     both (errata W3.md entry 36). Without a history (tests of the old form) they fall back to
//     `execCommand('undo' | 'redo')`;
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
  setSelectionRange(start: number, end: number): void;
}

/** What the actions need from the page; the bootstrap passes the browser's, tests pass fakes. */
export interface TextEditHost {
  /** `document.execCommand(command, false, value)`; false when the browser refused. */
  execCommand(command: 'undo' | 'redo' | 'cut' | 'copy' | 'delete' | 'insertText', value?: string): boolean;
  /** Puts `text` in place of the field's selection when `insertText` is refused (and says so). */
  replaceSelection(field: PlainTextField, text: string): void;
  /**
   * Puts `text` in place of the characters `start` to `end` of the field, as an edit the page and
   * its components see (an `input` event): TextFieldHistory's undo and redo. Optional, for hosts
   * written before it; without it the history is not used.
   */
  replaceRange?(field: PlainTextField, start: number, end: number, text: string): void;
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

/**
 * Performs `edit` in `field`. Resolves when it is done (a paste waits for the clipboard). With
 * `history` (the bootstrap passes the window's), Undo and Redo use it, and Cut and Paste tell it
 * the field's state before they change it.
 */
export async function performTextFieldEdit(
  edit: TextFieldEdit,
  field: PlainTextField,
  host: TextEditHost,
  history?: TextFieldHistory,
): Promise<void> {
  const tracked = host.replaceRange !== undefined ? history : undefined;
  switch (edit) {
    case 'selectAll':
      field.select();
      return;
    case 'undo':
    case 'redo':
      if (tracked) tracked[edit](field, host);
      else host.execCommand(edit);
      return;
    case 'cut':
    case 'copy': {
      const range = selection(field);
      if (range === null || field.type?.toLowerCase() === 'password') return;
      if (edit === 'cut') tracked?.beforeChange(field, true);
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
      tracked?.beforeChange(field, true);
      if (!host.execCommand('insertText', text)) host.replaceSelection(field, text);
      return;
    }
  }
}

/** A field's text and selection at one moment. */
interface FieldState {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface FieldHistory {
  /** States to go back to, the latest last. */
  undo: FieldState[];
  /** States to go forward to, the next last. */
  redo: FieldState[];
  /** The state after the last change this history saw; null before the first one. */
  last: FieldState | null;
  /** True when that change was typing, which the next typing at its caret joins. */
  lastTyping: boolean;
  /** The state before the change under way (`beforeinput`, or the shell's own Cut and Paste). */
  pending: FieldState | null;
  /** The change under way is a step of its own whatever its input type (the shell's Paste). */
  separate: boolean;
}

/** The input types of typing: a run of them at one caret is one undo step, as in the browsers. */
const TYPING_INPUT_TYPES: ReadonlySet<string> = new Set([
  'insertText',
  'insertCompositionText',
  'insertReplacementText',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
]);

/** At most this many undo steps per field. */
export const TEXT_FIELD_HISTORY_DEPTH = 100;

function stateOf(field: PlainTextField): FieldState {
  const end = field.selectionEnd ?? field.value.length;
  return { value: field.value, start: Math.min(field.selectionStart ?? end, end), end };
}

/**
 * The undo history of the plain text fields of one window, for the Ctrl+Z and Ctrl+Option+Z of
 * macOS (rule K2; errata W3.md entry 36). It learns every change from the field's events
 * (`installTextFieldHistory`): `beforeinput` gives the state before it, `input` the state after.
 * A run of typing at one caret is one step, every other change (a cut, a paste, a drop) is a step
 * of its own, as in the browsers. A value that a script changed in between (no event) makes the
 * history start again, as a browser's does; so does the browser's own undo (Cmd+Z), whose steps
 * this history cannot follow. Undo and Redo put the text back through `TextEditHost.replaceRange`,
 * which the page sees as an ordinary edit, and restore the selection.
 *
 * Fields are kept in a WeakMap: a field that leaves the page takes its history with it.
 */
export class TextFieldHistory {
  readonly #fields = new WeakMap<PlainTextField, FieldHistory>();
  /** The field whose text this history is putting back (its own events are not new changes). */
  #applying: PlainTextField | null = null;

  #of(field: PlainTextField): FieldHistory {
    let history = this.#fields.get(field);
    if (!history) {
      history = { undo: [], redo: [], last: null, lastTyping: false, pending: null, separate: false };
      this.#fields.set(field, history);
    }
    return history;
  }

  /**
   * The field is about to change (`beforeinput`, or before the shell's own Cut and Paste).
   * `separate`: the change is a step of its own even if the browser reports it as typing (a paste
   * through `execCommand('insertText')`); it holds until the change has happened.
   */
  beforeChange(field: PlainTextField, separate = false): void {
    if (this.#applying === field) return;
    const history = this.#of(field);
    history.pending = stateOf(field);
    if (separate) history.separate = true;
  }

  /** The field has changed (`input`), by an edit of the kind `inputType`. */
  changed(field: PlainTextField, inputType: string): void {
    const history = this.#of(field);
    const after = stateOf(field);
    if (this.#applying === field) {
      history.pending = null;
      history.separate = false;
      return;
    }
    const before = history.pending ?? history.last;
    const separate = history.separate;
    history.pending = null;
    history.separate = false;
    if (inputType === 'historyUndo' || inputType === 'historyRedo' || before === null) {
      // The browser's own undo (its steps are not ours), or the first change seen without the
      // state before it: start from here.
      Object.assign(history, { undo: [], redo: [], last: after, lastTyping: false });
      return;
    }
    // A script changed the value since the last change seen: what was before is gone.
    if (history.last !== null && before.value !== history.last.value) {
      history.undo = [];
      history.redo = [];
      history.last = null;
    }
    if (before.value === after.value) {
      history.last = after;
      return;
    }
    const typing = !separate && TYPING_INPUT_TYPES.has(inputType);
    const last = history.last;
    const joins =
      typing &&
      history.lastTyping &&
      last !== null &&
      history.undo.length > 0 &&
      before.start === before.end &&
      last.start === last.end &&
      before.start === last.end;
    if (!joins) {
      history.undo.push(before);
      if (history.undo.length > TEXT_FIELD_HISTORY_DEPTH) history.undo.shift();
    }
    history.redo = [];
    history.last = after;
    history.lastTyping = typing;
  }

  /** True when Undo would take something back in `field`. */
  canUndo(field: PlainTextField): boolean {
    return this.#current(field)?.undo.length ? true : false;
  }

  /** True when Redo would put something back in `field`. */
  canRedo(field: PlainTextField): boolean {
    return this.#current(field)?.redo.length ? true : false;
  }

  /** Takes back the last change of `field`; false when there is none. */
  undo(field: PlainTextField, host: TextEditHost): boolean {
    return this.#step(field, host, 'undo');
  }

  /** Puts back the last change that Undo took back; false when there is none. */
  redo(field: PlainTextField, host: TextEditHost): boolean {
    return this.#step(field, host, 'redo');
  }

  /** The field's history, or null when a script has changed its value since the last change seen. */
  #current(field: PlainTextField): FieldHistory | null {
    const history = this.#fields.get(field);
    if (!history || history.last === null) return null;
    if (history.last.value !== field.value) {
      history.undo = [];
      history.redo = [];
      history.last = null;
      return null;
    }
    return history;
  }

  #step(field: PlainTextField, host: TextEditHost, direction: 'undo' | 'redo'): boolean {
    const history = this.#current(field);
    const target = history?.[direction].pop();
    if (!history || !target || !host.replaceRange) return false;
    history[direction === 'undo' ? 'redo' : 'undo'].push(stateOf(field));
    // Replace only the part that differs, so the edit is as small as the change it takes back.
    const now = field.value;
    let head = 0;
    while (head < now.length && head < target.value.length && now[head] === target.value[head]) head++;
    let tail = 0;
    while (
      tail < now.length - head &&
      tail < target.value.length - head &&
      now[now.length - 1 - tail] === target.value[target.value.length - 1 - tail]
    )
      tail++;
    this.#applying = field;
    try {
      host.replaceRange(field, head, now.length - tail, target.value.slice(head, target.value.length - tail));
    } finally {
      this.#applying = null;
    }
    field.setSelectionRange(target.start, target.end);
    history.last = stateOf(field);
    history.lastTyping = false;
    return true;
  }
}

/** What `installTextFieldHistory` listens on (the window). */
export type HistoryEventTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

/**
 * Feeds `history` from the `beforeinput` and `input` events of every plain text field that
 * `isField` accepts, in the capture phase on `target`. Returns the uninstall function.
 */
export function installTextFieldHistory(
  target: HistoryEventTarget,
  history: TextFieldHistory,
  isField: (element: unknown) => boolean,
): () => void {
  const before = (event: Event) => {
    if (isField(event.target)) history.beforeChange(event.target as unknown as PlainTextField);
  };
  const after = (event: Event) => {
    if (!isField(event.target)) return;
    const inputType = (event as InputEvent).inputType;
    history.changed(event.target as unknown as PlainTextField, typeof inputType === 'string' ? inputType : '');
  };
  target.addEventListener('beforeinput', before, { capture: true });
  target.addEventListener('input', after, { capture: true });
  return () => {
    target.removeEventListener('beforeinput', before, { capture: true });
    target.removeEventListener('input', after, { capture: true });
  };
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
    // Through execCommand where the browser allows it, so that the field's own history (Cmd+Z)
    // stays whole: WebKit's is broken by a script's setRangeText (an undo then does nothing and a
    // redo inserts the text again). setRangeText and an input event only when it is refused.
    replaceRange: (field, start, end, text) => {
      const element = field as unknown as HTMLInputElement | HTMLTextAreaElement;
      element.setSelectionRange(start, end);
      let done: boolean;
      try {
        done =
          text === ''
            ? start === end || document.execCommand('delete', false)
            : document.execCommand('insertText', false, text);
      } catch {
        done = false;
      }
      if (done) return;
      element.setRangeText(text, start, end, 'end');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
    },
    readClipboard: clipboard?.readText ? () => clipboard.readText() : null,
    writeClipboard: clipboard?.writeText ? (text) => clipboard.writeText(text) : null,
    pasteIntoFocus,
    hasFocus: (field) => document.activeElement === (field as unknown),
    toast,
  };
}
