// Paste, Cut and Copy from the menu, the toolbar and the context menu (note 45), with a fake text
// field and fake page functions.
import { describe, expect, it } from 'vitest';
import {
  cutOrCopy,
  pasteFromMenu,
  pasteRefusedText,
  selectAllIn,
  type ClipboardEnv,
  type TextFieldLike,
} from './clipboard';

class FakeField implements TextFieldLike {
  focused = 0;
  inputs = 0;
  constructor(
    public value: string,
    public selectionStart: number | null = 0,
    public selectionEnd: number | null = 0,
  ) {}
  focus() {
    this.focused++;
  }
  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
  setRangeText(text: string, start: number, end: number) {
    this.value = this.value.slice(0, start) + text + this.value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  dispatchEvent() {
    this.inputs++;
    return true;
  }
}

function env(overrides: Partial<ClipboardEnv> = {}): ClipboardEnv & { toasts: string[]; written: string[] } {
  const toasts: string[] = [];
  const written: string[] = [];
  return {
    execCommand: () => false,
    readText: async () => 'pasted',
    writeText: async (text) => void written.push(text),
    pasteIntoFocus: null,
    toast: (text) => void toasts.push(text),
    os: 'windows',
    ...overrides,
    toasts,
    written,
  };
}

// Event exists in Node 24; the field fake ignores the event object.
describe('Paste from a menu (note 45)', () => {
  it('a browser asks for the clipboard and inserts plain text with "\\n" line breaks', async () => {
    const field = new FakeField('ab', 1, 1);
    await pasteFromMenu({ kind: 'field', field }, env({ readText: async () => 'x\r\ny' }));
    expect(field.value).toBe('ax\nyb');
    expect(field.focused).toBe(1);
    expect(field.inputs).toBe(1);
  });

  it('when the browser refuses, a toast says how to paste', async () => {
    const field = new FakeField('ab');
    const page = env({ readText: () => Promise.reject(new Error('NotAllowedError')) });
    await pasteFromMenu({ kind: 'field', field }, page);
    expect(page.toasts).toEqual(['Press Ctrl+V to paste']);
    expect(field.value).toBe('ab');
    const mac = env({ readText: null, os: 'mac' });
    await pasteFromMenu({ kind: 'field', field }, mac);
    expect(mac.toasts).toEqual(['Press Cmd+V to paste']);
    expect(pasteRefusedText('linux')).toBe('Press Ctrl+V to paste');
  });

  it('the desktop app pastes natively into the focused control (Platform.pasteIntoFocus)', async () => {
    const field = new FakeField('ab');
    let native = 0;
    let read = 0;
    await pasteFromMenu(
      { kind: 'field', field },
      env({
        pasteIntoFocus: () => void native++,
        readText: async () => {
          read++;
          return 'x';
        },
      }),
    );
    expect([native, read, field.focused]).toEqual([1, 0, 1]);
  });

  it('an empty clipboard pastes nothing; no target does nothing', async () => {
    const field = new FakeField('ab');
    await pasteFromMenu({ kind: 'field', field }, env({ readText: async () => '' }));
    expect(field.value).toBe('ab');
    await pasteFromMenu(null, env());
  });
});

describe('Cut and Copy from a menu', () => {
  it('use execCommand when the browser allows it', async () => {
    const field = new FakeField('abcd', 1, 3);
    const used: string[] = [];
    await cutOrCopy({ kind: 'field', field }, 'copy', env({ execCommand: (c) => (used.push(c), true) }));
    expect(used).toEqual(['copy']);
  });

  it('fall back to the Clipboard API; Cut then deletes the selection', async () => {
    const field = new FakeField('abcd', 1, 3);
    const page = env();
    await cutOrCopy({ kind: 'field', field }, 'cut', page);
    expect(page.written).toEqual(['bc']);
    expect(field.value).toBe('ad');
  });

  it('do nothing without a selection', async () => {
    const field = new FakeField('abcd', 2, 2);
    const page = env();
    await cutOrCopy({ kind: 'field', field }, 'cut', page);
    expect(page.written).toEqual([]);
    expect(field.value).toBe('abcd');
  });
});

describe('Select All from a menu', () => {
  it('selects the whole field', () => {
    const field = new FakeField('abcd');
    selectAllIn({ kind: 'field', field });
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4]);
  });
});
