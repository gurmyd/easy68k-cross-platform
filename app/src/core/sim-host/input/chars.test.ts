// The character of a key press (trap15-a §3.9) and pasted text (simIOu.cpp:439-444).

import { describe, expect, it } from 'vitest';
import type { KeyLike } from '../../../contracts';
import { PASTE_LIMIT, charFromKey, isOneCharacter, pasteBytes } from './chars';

const key = (k: string, code: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});
const ctrl = { ctrlKey: true };

describe('charFromKey', () => {
  it('Enter is $0D, Backspace $08, Esc $1B', () => {
    expect(charFromKey(key('Enter', 'Enter'))).toBe(0x0d);
    expect(charFromKey(key('Enter', 'NumpadEnter'))).toBe(0x0d);
    expect(charFromKey(key('Backspace', 'Backspace'))).toBe(0x08);
    expect(charFromKey(key('Escape', 'Escape'))).toBe(0x1b);
  });

  it('Ctrl+letter is $01-$1A: Ctrl+H is a backspace, Ctrl+I is $09, Ctrl+M is Enter', () => {
    expect(charFromKey(key('h', 'KeyH', ctrl))).toBe(0x08);
    expect(charFromKey(key('i', 'KeyI', ctrl))).toBe(0x09);
    expect(charFromKey(key('m', 'KeyM', ctrl))).toBe(0x0d);
    expect(charFromKey(key('a', 'KeyA', ctrl))).toBe(0x01);
    expect(charFromKey(key('Z', 'KeyZ', ctrl))).toBe(0x1a); // with Shift or Caps Lock too
    expect(charFromKey(key('v', 'KeyV', ctrl))).toBe(0x16); // Ctrl+V is a character, not a paste (2.9.4)
  });

  it('Ctrl+letter follows the letter the key types, and the position where it types no ASCII letter', () => {
    expect(charFromKey(key('a', 'KeyQ', ctrl))).toBe(0x01); // AZERTY: the key labelled A
    expect(charFromKey(key('z', 'KeyY', ctrl))).toBe(0x1a); // QWERTZ: the key labelled Z
    expect(charFromKey(key('с', 'KeyC', ctrl))).toBe(0x03); // Russian layout: the C position
  });

  it('Ctrl+Enter is $0A and Ctrl+Backspace $7F', () => {
    expect(charFromKey(key('Enter', 'Enter', ctrl))).toBe(0x0a);
    expect(charFromKey(key('Backspace', 'Backspace', ctrl))).toBe(0x7f);
  });

  it('Ctrl+@ (Ctrl+Shift+2 on a US keyboard) is the character 0, which is not "no character"', () => {
    // Windows 11, US layout: ToUnicodeEx gives one character, U+0000, for Ctrl+Shift+2 and none
    // for Ctrl+2 (errata SH4.md entry 10). The original's key-press handler stores that 0.
    expect(charFromKey(key('@', 'Digit2', ctrl))).toBe(0x00);
    expect(charFromKey(key('@', 'Digit2', ctrl))).not.toBeNull();
    expect(charFromKey(key('2', 'Digit2', ctrl))).toBeNull();
    // Without Ctrl, and as an AltGr character (German AltGr+Q), `@` is `@`.
    expect(charFromKey(key('@', 'Digit2'))).toBe(0x40);
    expect(charFromKey(key('@', 'KeyQ', { ctrlKey: true, altKey: true }))).toBe(0x40);
  });

  it('Ctrl with [ \\ ] ^ _ gives $1B-$1F, with Space a space, with anything else nothing', () => {
    expect(charFromKey(key('[', 'BracketLeft', ctrl))).toBe(0x1b);
    expect(charFromKey(key('\\', 'Backslash', ctrl))).toBe(0x1c);
    expect(charFromKey(key(']', 'BracketRight', ctrl))).toBe(0x1d);
    expect(charFromKey(key('^', 'Digit6', ctrl))).toBe(0x1e);
    expect(charFromKey(key('_', 'Minus', ctrl))).toBe(0x1f);
    expect(charFromKey(key(' ', 'Space', ctrl))).toBe(0x20);
    expect(charFromKey(key('1', 'Digit1', ctrl))).toBeNull();
    expect(charFromKey(key('6', 'Digit6', ctrl))).toBeNull();
    expect(charFromKey(key('-', 'Minus', ctrl))).toBeNull();
    expect(charFromKey(key(';', 'Semicolon', ctrl))).toBeNull();
    expect(charFromKey(key('/', 'Slash', ctrl))).toBeNull();
    expect(charFromKey(key('{', 'BracketLeft', ctrl))).toBeNull();
    expect(charFromKey(key('é', 'Digit2', ctrl))).toBeNull();
    expect(charFromKey(key('Tab', 'Tab', ctrl))).toBeNull();
  });

  it('printable characters are their Windows-1252 bytes', () => {
    expect(charFromKey(key('a', 'KeyA'))).toBe(0x61);
    expect(charFromKey(key('A', 'KeyA'))).toBe(0x41);
    expect(charFromKey(key(' ', 'Space'))).toBe(0x20);
    expect(charFromKey(key('5', 'Numpad5'))).toBe(0x35);
    expect(charFromKey(key('~', 'Backquote'))).toBe(0x7e);
    expect(charFromKey(key('é', 'KeyE'))).toBe(0xe9);
    expect(charFromKey(key('ÿ', 'KeyY'))).toBe(0xff);
    expect(charFromKey(key('€', 'KeyE'))).toBe(0x80);
    expect(charFromKey(key('™', 'Digit2'))).toBe(0x99);
  });

  it('a character outside Windows-1252 gives none', () => {
    expect(charFromKey(key('ω', 'KeyV'))).toBeNull();
    expect(charFromKey(key('я', 'KeyZ'))).toBeNull();
    expect(charFromKey(key('あ', 'KeyA'))).toBeNull();
    expect(charFromKey(key('😀', ''))).toBeNull();
  });

  it('arrows, function keys, modifiers, dead keys and input-method keys give none', () => {
    for (const [k, code] of [
      ['ArrowUp', 'ArrowUp'],
      ['F1', 'F1'],
      ['F10', 'F10'],
      ['Shift', 'ShiftLeft'],
      ['Control', 'ControlLeft'],
      ['Alt', 'AltLeft'],
      ['AltGraph', 'AltRight'],
      ['Meta', 'MetaLeft'],
      ['Insert', 'Insert'],
      ['Delete', 'Delete'],
      ['Home', 'Home'],
      ['PageDown', 'PageDown'],
      ['CapsLock', 'CapsLock'],
      ['Dead', 'Quote'],
      ['Process', 'KeyA'],
      ['Unidentified', ''],
      ['Clear', 'Numpad5'],
    ] as const) {
      expect(charFromKey(key(k, code)), k).toBeNull();
    }
  });

  it('Alt + key is a system key without a character; AltGr (Ctrl+Alt) types its character', () => {
    expect(charFromKey(key('Enter', 'Enter', { altKey: true }))).toBeNull(); // Alt+Enter: full screen
    expect(charFromKey(key('a', 'KeyA', { altKey: true }))).toBeNull();
    expect(charFromKey(key('@', 'KeyQ', { ctrlKey: true, altKey: true }))).toBe(0x40); // German AltGr+Q
    expect(charFromKey(key('€', 'KeyE', { ctrlKey: true, altKey: true }))).toBe(0x80); // German AltGr+E
    expect(charFromKey(key('{', 'Digit7', { ctrlKey: true, altKey: true }))).toBe(0x7b);
    // Ctrl+Alt on a layout without an AltGr character there: the browser reports the plain key.
    expect(charFromKey(key('a', 'KeyA', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(charFromKey(key('1', 'Digit1', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(charFromKey(key('Enter', 'Enter', { ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('a chord with the Windows or Command key types nothing', () => {
    expect(charFromKey(key('v', 'KeyV', { metaKey: true }))).toBeNull();
    expect(charFromKey(key('Enter', 'Enter', { metaKey: true }))).toBeNull();
  });

  it('plain Tab would be $09 (the panel never lets it through, 2.9.4 rule 3)', () => {
    expect(charFromKey(key('Tab', 'Tab'))).toBe(0x09);
  });
});

describe('isOneCharacter', () => {
  it('tells characters from key names', () => {
    expect(isOneCharacter('a')).toBe(true);
    expect(isOneCharacter('€')).toBe(true);
    expect(isOneCharacter('😀')).toBe(true);
    expect(isOneCharacter('F1')).toBe(false);
    expect(isOneCharacter('Enter')).toBe(false);
    expect(isOneCharacter('´e')).toBe(false);
    expect(isOneCharacter('')).toBe(false);
  });
});

describe('pasteBytes', () => {
  const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

  it('turns every line end into CR LF', () => {
    expect(text(pasteBytes('ONE\nTWO'))).toBe('ONE\r\nTWO');
    expect(text(pasteBytes('ONE\r\nTWO'))).toBe('ONE\r\nTWO');
    expect(text(pasteBytes('ONE\rTWO'))).toBe('ONE\r\nTWO');
    expect(text(pasteBytes('A\n\nB\r\n'))).toBe('A\r\n\r\nB\r\n');
  });

  it('300 characters give 254 bytes', () => {
    const bytes = pasteBytes('x'.repeat(300));
    expect(bytes.length).toBe(254);
    expect(PASTE_LIMIT).toBe(254);
    expect(pasteBytes('y'.repeat(254)).length).toBe(254);
    expect(pasteBytes('y'.repeat(253)).length).toBe(253);
  });

  it('counts the bytes after the line ends were expanded', () => {
    const bytes = pasteBytes(`${'a'.repeat(252)}\nbcd`);
    expect(bytes.length).toBe(254);
    expect(text(bytes).endsWith('a\r\n')).toBe(true);
    // A line end at the limit is cut in two, as in the original's buffer.
    expect(text(pasteBytes(`${'a'.repeat(253)}\nb`)).endsWith('a\r')).toBe(true);
  });

  it('encodes Windows-1252 and writes ? for other characters', () => {
    expect([...pasteBytes('é€ÿ')]).toEqual([0xe9, 0x80, 0xff]);
    expect(text(pasteBytes('aωb😀c'))).toBe('a?b?c');
  });

  it('ends at the first NUL, as the clipboard text of Windows does', () => {
    expect(text(pasteBytes('AB\0CD'))).toBe('AB');
  });

  it('copes with a very long text', () => {
    expect(pasteBytes('😀'.repeat(100_000)).length).toBe(254);
    expect(pasteBytes('').length).toBe(0);
  });
});
