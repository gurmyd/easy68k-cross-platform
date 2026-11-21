// The Ctrl editing keys of macOS in plain text fields (rule K2; errata W3.md entry 34).

import { describe, expect, it } from 'vitest';
import {
  PASTE_REFUSED_MAC,
  TEXT_FIELD_HISTORY_DEPTH,
  TextFieldHistory,
  installTextFieldHistory,
  performTextFieldEdit,
  textFieldEditChords,
  type PlainTextField,
  type TextEditHost,
} from './text-field-edits';

function field(value: string, start: number, end: number, type = 'text') {
  const state = { value, selectionStart: start as number | null, selectionEnd: end as number | null, type };
  return Object.assign(state, {
    select() {
      state.selectionStart = 0;
      state.selectionEnd = state.value.length;
    },
    setSelectionRange(from: number, to: number) {
      state.selectionStart = from;
      state.selectionEnd = to;
    },
  });
}

function host(options: Partial<TextEditHost> & { refuse?: string[] } = {}) {
  const calls: string[] = [];
  const result: TextEditHost & { calls: string[] } = {
    calls,
    execCommand: (command, value) => {
      calls.push(value === undefined ? command : `${command}:${value}`);
      return !(options.refuse ?? []).includes(command);
    },
    replaceSelection: (_field, text) => void calls.push(`replace:${text}`),
    readClipboard: null,
    writeClipboard: null,
    pasteIntoFocus: null,
    hasFocus: () => true,
    toast: (text) => void calls.push(`toast:${text}`),
    ...options,
  };
  return result;
}

describe('textFieldEditChords', () => {
  it('on macOS: the Ctrl forms the chord table gives the six text-editing commands', () => {
    expect(Object.fromEntries(textFieldEditChords('mac', false))).toEqual({
      'Ctrl+Z': 'undo',
      'Ctrl+Alt+Z': 'redo',
      'Ctrl+X': 'cut',
      'Ctrl+C': 'copy',
      'Ctrl+V': 'paste',
      'Ctrl+A': 'selectAll',
    });
    expect(textFieldEditChords('mac', true).size).toBe(6);
  });

  it('none on Windows and Linux, where Ctrl is the platform key and the browser edits', () => {
    expect(textFieldEditChords('windows', false).size).toBe(0);
    expect(textFieldEditChords('linux', true).size).toBe(0);
  });
});

describe('performTextFieldEdit', () => {
  it('Select All selects the whole field; Undo and Redo use the field’s own history', async () => {
    const f = field('hello', 2, 2);
    const h = host();
    await performTextFieldEdit('selectAll', f, h);
    expect([f.selectionStart, f.selectionEnd]).toEqual([0, 5]);
    await performTextFieldEdit('undo', f, h);
    await performTextFieldEdit('redo', f, h);
    expect(h.calls).toEqual(['undo', 'redo']);
  });

  it('Cut and Copy use execCommand, and do nothing without a selection or in a password field', async () => {
    const h = host();
    await performTextFieldEdit('copy', field('hello', 1, 3), h);
    await performTextFieldEdit('cut', field('hello', 1, 3), h);
    await performTextFieldEdit('copy', field('hello', 3, 3), h);
    await performTextFieldEdit('cut', field('hello', 0, 5, 'password'), h);
    expect(h.calls).toEqual(['copy', 'cut']);
  });

  it('Cut and Copy fall back to the Clipboard API when execCommand is refused', async () => {
    const written: string[] = [];
    const h = host({ refuse: ['cut', 'copy', 'delete'], writeClipboard: async (text) => void written.push(text) });
    await performTextFieldEdit('copy', field('hello', 1, 3), h);
    await performTextFieldEdit('cut', field('hello', 0, 2), h);
    expect(written).toEqual(['el', 'he']);
    expect(h.calls).toEqual(['copy', 'cut', 'delete', 'replace:']);
  });

  it('Paste in the desktop app is the native paste', async () => {
    let pasted = 0;
    const h = host({ pasteIntoFocus: () => void pasted++, readClipboard: async () => 'x' });
    await performTextFieldEdit('paste', field('', 0, 0), h);
    expect(pasted).toBe(1);
    expect(h.calls).toEqual([]);
  });

  it('Paste in a browser asks for the clipboard and types its text', async () => {
    const h = host({ readClipboard: async () => 'D0' });
    await performTextFieldEdit('paste', field('', 0, 0), h);
    expect(h.calls).toEqual(['insertText:D0']);
    const fallback = host({ readClipboard: async () => 'D1', refuse: ['insertText'] });
    await performTextFieldEdit('paste', field('', 0, 0), fallback);
    expect(fallback.calls).toEqual(['insertText:D1', 'replace:D1']);
  });

  it('Paste refused, or without the Clipboard API, says Press Cmd+V to paste (note 45)', async () => {
    const refused = host({
      readClipboard: () => Promise.reject(new Error('NotAllowedError')),
    });
    await performTextFieldEdit('paste', field('', 0, 0), refused);
    const none = host();
    await performTextFieldEdit('paste', field('', 0, 0), none);
    expect(refused.calls).toEqual([`toast:${PASTE_REFUSED_MAC}`]);
    expect(none.calls).toEqual([`toast:${PASTE_REFUSED_MAC}`]);
    expect(PASTE_REFUSED_MAC).toBe('Press Cmd+V to paste');
  });

  it('Paste does nothing when the clipboard is empty or the field has lost the focus meanwhile', async () => {
    const empty = host({ readClipboard: async () => '' });
    await performTextFieldEdit('paste', field('', 0, 0), empty);
    const away = host({ readClipboard: async () => 'x', hasFocus: (_f: PlainTextField) => false });
    await performTextFieldEdit('paste', field('', 0, 0), away);
    expect([...empty.calls, ...away.calls]).toEqual([]);
  });
});

// ---- The history of Ctrl+Z and Ctrl+Option+Z (errata W3.md entry 36)

type Field = ReturnType<typeof field>;

/** Changes `f` as the browser would, telling `history` what its events would tell it. */
function edit(history: TextFieldHistory, f: Field, inputType: string, change: () => void) {
  history.beforeChange(f);
  change();
  history.changed(f, inputType);
}

/** Types `text` at the caret, one character per event, as a person does. */
function type(history: TextFieldHistory, f: Field, text: string) {
  for (const character of text) {
    edit(history, f, 'insertText', () => {
      const end = f.selectionEnd ?? f.value.length;
      const start = f.selectionStart ?? end;
      f.value = f.value.slice(0, start) + character + f.value.slice(end);
      f.setSelectionRange(start + 1, start + 1);
    });
  }
}

/** A host whose replaceRange edits the fake field (and fires no events, as if they were ignored). */
function historyHost(f: Field) {
  const ranges: string[] = [];
  const result = host({
    replaceRange: (_field, start, end, text) => {
      ranges.push(`${start}..${end}=${JSON.stringify(text)}`);
      f.value = f.value.slice(0, start) + text + f.value.slice(end);
      f.setSelectionRange(start + text.length, start + text.length);
    },
  });
  return Object.assign(result, { ranges });
}

describe('TextFieldHistory', () => {
  it('typing, then a cut: Undo takes back the cut only, Redo puts it back (the macOS runner case)', async () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    const h = historyHost(f);
    type(history, f, 'abc def');
    f.setSelectionRange(4, 7);
    edit(history, f, 'deleteByCut', () => {
      f.value = 'abc ';
      f.setSelectionRange(4, 4);
    });
    await performTextFieldEdit('undo', f, h, history);
    expect([f.value, f.selectionStart, f.selectionEnd]).toEqual(['abc def', 4, 7]);
    await performTextFieldEdit('redo', f, h, history);
    expect([f.value, f.selectionStart, f.selectionEnd]).toEqual(['abc ', 4, 4]);
    // Only the part that differs is replaced; the browser's own undo is never asked.
    expect(h.ranges).toEqual(['4..4="def"', '4..7=""']);
    expect(h.calls).toEqual([]);
    // Two undos: the cut, then the whole run of typing.
    await performTextFieldEdit('undo', f, h, history);
    await performTextFieldEdit('undo', f, h, history);
    expect(f.value).toBe('');
    expect(history.canUndo(f)).toBe(false);
    await performTextFieldEdit('undo', f, h, history);
    expect(f.value).toBe('');
  });

  it('typing at another caret, and a paste, are steps of their own', async () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    const h = historyHost(f);
    type(history, f, 'move');
    f.setSelectionRange(0, 0);
    type(history, f, 'x');
    // The shell's paste goes through execCommand('insertText'), which the browser calls typing.
    f.setSelectionRange(5, 5);
    history.beforeChange(f, true);
    edit(history, f, 'insertText', () => {
      f.value = 'xmove.l';
      f.setSelectionRange(7, 7);
    });
    type(history, f, ' D0');
    const values: string[] = [];
    while (history.canUndo(f)) {
      await performTextFieldEdit('undo', f, h, history);
      values.push(f.value);
    }
    expect(values).toEqual(['xmove.l', 'xmove', 'move', '']);
  });

  it('a value a script changed starts the history again', async () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    const h = historyHost(f);
    type(history, f, 'abc');
    f.value = 'D0';
    expect(history.canUndo(f)).toBe(false);
    await performTextFieldEdit('undo', f, h, history);
    expect(f.value).toBe('D0');
    f.setSelectionRange(2, 2);
    type(history, f, '1');
    await performTextFieldEdit('undo', f, h, history);
    expect(f.value).toBe('D0');
    expect(history.canUndo(f)).toBe(false);
  });

  it("the browser's own undo (Cmd+Z) starts the history again; a new change clears Redo", async () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    const h = historyHost(f);
    type(history, f, 'ab');
    edit(history, f, 'historyUndo', () => {
      f.value = '';
      f.setSelectionRange(0, 0);
    });
    expect(history.canUndo(f)).toBe(false);
    type(history, f, 'cd');
    await performTextFieldEdit('undo', f, h, history);
    expect(history.canRedo(f)).toBe(true);
    type(history, f, 'e');
    expect(history.canRedo(f)).toBe(false);
  });

  it(`keeps at most ${TEXT_FIELD_HISTORY_DEPTH} steps`, () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    for (let i = 0; i < TEXT_FIELD_HISTORY_DEPTH + 20; i++) {
      edit(history, f, 'insertFromPaste', () => {
        f.value += 'x';
        f.setSelectionRange(f.value.length, f.value.length);
      });
    }
    const h = historyHost(f);
    let steps = 0;
    while (history.undo(f, h)) steps++;
    expect(steps).toBe(TEXT_FIELD_HISTORY_DEPTH);
    expect(f.value).toBe('x'.repeat(20));
  });

  it('Cut and Paste of the shell tell the history the state before them', async () => {
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    type(history, f, 'abc');
    f.setSelectionRange(0, 3);
    const h = historyHost(f);
    h.execCommand = (command) => {
      h.calls.push(command);
      if (command === 'cut') {
        // As in Chromium: execCommand fires no beforeinput, only input.
        f.value = '';
        f.setSelectionRange(0, 0);
        history.changed(f, 'deleteByCut');
      }
      return true;
    };
    await performTextFieldEdit('cut', f, h, history);
    await performTextFieldEdit('undo', f, h, history);
    expect([f.value, f.selectionStart, f.selectionEnd]).toEqual(['abc', 0, 3]);
  });

  it('without replaceRange on the host, Undo and Redo are the browser’s', async () => {
    const history = new TextFieldHistory();
    const f = field('ab', 2, 2);
    const h = host();
    await performTextFieldEdit('undo', f, h, history);
    expect(h.calls).toEqual(['undo']);
  });

  it('installTextFieldHistory listens to beforeinput and input of the fields it accepts, in the capture phase', () => {
    const listeners = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (name: string, listener: (event: Event) => void, options: unknown) => {
        expect(options).toEqual({ capture: true });
        listeners.set(name, listener);
      },
      removeEventListener: (name: string) => void listeners.delete(name),
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
    const history = new TextFieldHistory();
    const f = field('', 0, 0);
    const other = field('', 0, 0);
    const uninstall = installTextFieldHistory(target, history, (element) => element === f);
    for (const element of [f, other]) {
      listeners.get('beforeinput')?.({ target: element } as unknown as Event);
      element.value = 'a';
      element.setSelectionRange(1, 1);
      listeners.get('input')?.({ target: element, inputType: 'insertText' } as unknown as Event);
    }
    expect([history.canUndo(f), history.canUndo(other)]).toEqual([true, false]);
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
