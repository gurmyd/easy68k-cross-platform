// Chords from key events (ARCHITECTURE.md 2.9.1; rule K6 of section 1.3), with the key and code
// pairs of key-fixtures.ts: Option chords on macOS, AltGr on Windows, QWERTZ, AZERTY, Russian,
// Greek, and the numeric keypad with NumLock off.

import { describe, expect, it } from 'vitest';
import { chordOf, formatChord, keyNameOf, normalizeChord, splitChord } from './chords';
import {
  ALL_FIXTURES,
  MAC_US,
  WINDOWS_GERMAN,
  WINDOWS_KEYPAD,
  WINDOWS_RUSSIAN,
  WINDOWS_US,
  fixture,
} from './key-fixtures';

describe('chordOf', () => {
  it.each(ALL_FIXTURES.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(chordOf(entry)).toBe(entry.chord);
  });

  it('takes Option+O by position: the character is ø, the chord is Alt+O', () => {
    const event = fixture(MAC_US, 'Option+O (types ø)');
    expect(event.key).toBe('ø');
    expect(event.code).toBe('KeyO');
    expect(chordOf(event)).toBe('Alt+O');
  });

  it('follows the layout for a letter without Alt (QWERTZ: Ctrl+Z is the key labelled Z)', () => {
    const event = fixture(WINDOWS_GERMAN, 'Ctrl+Z (the key labelled Z, at the US Y position)');
    expect(event.code).toBe('KeyY');
    expect(chordOf(event)).toBe('Ctrl+Z');
  });

  it('follows the position when the layout has no ASCII letters', () => {
    expect(chordOf(fixture(WINDOWS_RUSSIAN, 'Ctrl+O position (types щ)'))).toBe('Ctrl+O');
  });

  it('names a keypad key by what it does while NumLock is off; a keypad digit forms no chord', () => {
    const insert = fixture(WINDOWS_KEYPAD, 'Shift + keypad 0, NumLock off: Shift+Insert');
    expect([insert.key, insert.code]).toEqual(['Insert', 'Numpad0']);
    expect(chordOf(insert)).toBe('Shift+Insert');
    expect(chordOf(fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock off: Insert'))).toBe('Insert');
    expect(chordOf(fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock on: the digit 0'))).toBeNull();
    expect(chordOf(fixture(WINDOWS_KEYPAD, 'Ctrl + keypad 1, NumLock on'))).toBeNull();
    // The keypad's Enter is Enter in either NumLock state.
    expect(chordOf(fixture(WINDOWS_US, 'Alt+Enter on the keypad'))).toBe('Alt+Enter');
    // Only the keypad is named by `key`: any other position keeps its own name or has none.
    expect(keyNameOf({ key: 'Insert', code: 'Period', altKey: false })).toBe('.');
    expect(keyNameOf({ key: 'Insert', code: 'IntlBackslash', altKey: false })).toBeNull();
  });

  it('names a key by its character when the event has no code at all', () => {
    const base = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: '' };
    expect(chordOf({ ...base, key: 's' })).toBe('Ctrl+S');
    expect(chordOf({ ...base, key: 'F5' })).toBe('Ctrl+F5');
    expect(chordOf({ ...base, key: 'Enter' })).toBe('Ctrl+Enter');
    expect(chordOf({ ...base, key: 'Unidentified' })).toBeNull();
  });

  it('gives no name to keys that are not part of any chord', () => {
    expect(keyNameOf({ key: 'CapsLock', code: 'CapsLock', altKey: false })).toBeNull();
    expect(keyNameOf({ key: 'Dead', code: 'Quote', altKey: false })).toBe("'");
    expect(keyNameOf({ key: 'AudioVolumeUp', code: 'AudioVolumeUp', altKey: false })).toBeNull();
  });
});

describe('normalizeChord', () => {
  it('orders the modifiers Ctrl, Alt, Shift, Cmd', () => {
    expect(normalizeChord('Shift+Cmd+S')).toBe('Shift+Cmd+S');
    expect(normalizeChord('cmd+shift+s')).toBe('Shift+Cmd+S');
    expect(normalizeChord('Shift+Ctrl+F9')).toBe('Ctrl+Shift+F9');
    expect(normalizeChord('Cmd+Alt+Ctrl+Shift+k')).toBe('Ctrl+Alt+Shift+Cmd+K');
  });

  it('accepts the Apple names of section 1.3', () => {
    expect(normalizeChord('Ctrl+Option+Z')).toBe('Ctrl+Alt+Z');
    expect(normalizeChord('Option+Return')).toBe('Alt+Enter');
    expect(normalizeChord('Command+,')).toBe('Cmd+,');
  });

  it('keeps punctuation and named keys', () => {
    expect(normalizeChord('Ctrl+Shift+.')).toBe('Ctrl+Shift+.');
    expect(normalizeChord('Cmd+/')).toBe('Cmd+/');
    expect(normalizeChord('Shift+Insert')).toBe('Shift+Insert');
    expect(normalizeChord('f9')).toBe('F9');
  });

  it('refuses text that is not a chord', () => {
    expect(() => normalizeChord('Ctrl+')).toThrow(/Not a key chord/);
    expect(() => normalizeChord('Hyper+A')).toThrow(/Unknown modifier/);
    expect(() => normalizeChord('Ctrl+Banana')).toThrow(/Unknown key/);
  });
});

describe('formatChord', () => {
  it('shows chords unchanged on Windows and Linux', () => {
    expect(formatChord('Ctrl+Alt+Z', 'windows')).toBe('Ctrl+Alt+Z');
    expect(formatChord('Alt+Enter', 'linux')).toBe('Alt+Enter');
  });

  it('uses Apple names on macOS, in the spelling of section 1.3', () => {
    expect(formatChord('Ctrl+Alt+Z', 'mac')).toBe('Ctrl+Option+Z');
    expect(formatChord('Shift+Cmd+S', 'mac')).toBe('Shift+Cmd+S');
    expect(formatChord('Alt+Enter', 'mac')).toBe('Option+Return');
    expect(formatChord('Shift+Cmd+/', 'mac')).toBe('Shift+Cmd+/');
  });

  it('splitChord separates modifiers and key', () => {
    expect(splitChord('Ctrl+Shift+F9')).toEqual({ modifiers: ['Ctrl', 'Shift'], key: 'F9' });
    expect(splitChord('F9')).toEqual({ modifiers: [], key: 'F9' });
  });
});
