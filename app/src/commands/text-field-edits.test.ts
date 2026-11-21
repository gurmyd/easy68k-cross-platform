// The Ctrl editing keys of macOS in plain text fields (rule K2; errata W3.md entry 34).

import { describe, expect, it } from 'vitest';
import {
  PASTE_REFUSED_MAC,
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
