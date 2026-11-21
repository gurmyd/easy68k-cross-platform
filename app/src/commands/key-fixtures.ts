// Key events as browsers report them on keyboards and layouts other than a plain US one, for the
// tests of the chord table and the dispatcher (ARCHITECTURE.md 2.9.2: "key and code pairs recorded
// from real keyboards, never synthetic events with plain letters"). Owner: W3.
//
// NOT YET RECORDED. See "Where the values come from" below before trusting an entry.
//
// Each entry gives the `key` and `code` a browser delivers for a physical key press with the
// modifiers held, and the chord it must resolve to. `code` names the key's POSITION on a US
// keyboard; `key` is the character the active layout produces, which is where the layouts differ:
//
//   - macOS, Option held: the Option layer of the layout (Option+O is `ø`, Option+Z is `Ω`),
//     or `Dead` for the dead keys of the US layout (Option+U, Option+E, Option+I, Option+N).
//   - Windows, AltGr: reported as Ctrl+Alt with the AltGr character (German AltGr+Q is `@`).
//   - QWERTZ and AZERTY: letters sit at other positions (German Z is at `KeyY`, French A at `KeyQ`).
//   - Russian and Greek: no ASCII letters at all (`KeyO` gives `щ`, `KeyF` gives `φ`).
//   - The numeric keypad with NumLock off: navigation keys at keypad positions (`Insert` at
//     `Numpad0`).
//
// Where the values come from. No entry was captured on a keyboard: they were written down from
// the UI Events `key` and `code` specifications and the published definitions of the layouts.
// For the Windows lists the characters in `key` were also compared with the layout tables that
// Windows 11 uses (KBDUS, KBDGR, KBDFR, KBDRU and KBDHE.DLL) and agree. The macOS lists and the
// keypad list have no such check. docs/requests/W3-key-recording.md says how to record every
// entry in a browser on the real keyboards (the manual list of section 6.8); when that is done,
// replace the entries with what was recorded and say so here.
//
// This file is test data; nothing in the application imports it.

import type { KeyEventLike } from './chords';

export interface KeyFixture extends KeyEventLike {
  /** What was pressed, on which keyboard. */
  name: string;
  /** The chord in normal form, or null when the press forms none. */
  chord: string | null;
}

const NONE = { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
const CTRL = { ...NONE, ctrlKey: true };
const CMD = { ...NONE, metaKey: true };
const ALT = { ...NONE, altKey: true };
const SHIFT = { ...NONE, shiftKey: true };
const CTRL_ALT = { ...NONE, ctrlKey: true, altKey: true };
const CTRL_SHIFT = { ...NONE, ctrlKey: true, shiftKey: true };
const SHIFT_CMD = { ...NONE, shiftKey: true, metaKey: true };

/** Windows and Linux, US layout. */
export const WINDOWS_US: KeyFixture[] = [
  { name: 'Ctrl+O', key: 'o', code: 'KeyO', ...CTRL, chord: 'Ctrl+O' },
  { name: 'Ctrl+S', key: 's', code: 'KeyS', ...CTRL, chord: 'Ctrl+S' },
  { name: 'Ctrl+Z', key: 'z', code: 'KeyZ', ...CTRL, chord: 'Ctrl+Z' },
  { name: 'Ctrl+Alt+Z', key: 'z', code: 'KeyZ', ...CTRL_ALT, chord: 'Ctrl+Alt+Z' },
  { name: 'Ctrl+Alt+C', key: 'c', code: 'KeyC', ...CTRL_ALT, chord: 'Ctrl+Alt+C' },
  { name: 'Ctrl+Alt+U', key: 'u', code: 'KeyU', ...CTRL_ALT, chord: 'Ctrl+Alt+U' },
  { name: 'Ctrl+Alt+O', key: 'o', code: 'KeyO', ...CTRL_ALT, chord: 'Ctrl+Alt+O' },
  { name: 'Ctrl+O with Caps Lock', key: 'O', code: 'KeyO', ...CTRL, chord: 'Ctrl+O' },
  { name: 'F9', key: 'F9', code: 'F9', ...NONE, chord: 'F9' },
  { name: 'Ctrl+F9', key: 'F9', code: 'F9', ...CTRL, chord: 'Ctrl+F9' },
  { name: 'Shift+F4', key: 'F4', code: 'F4', ...SHIFT, chord: 'Shift+F4' },
  { name: 'Ctrl+F4', key: 'F4', code: 'F4', ...CTRL, chord: 'Ctrl+F4' },
  { name: 'F1', key: 'F1', code: 'F1', ...NONE, chord: 'F1' },
  { name: 'Insert', key: 'Insert', code: 'Insert', ...NONE, chord: 'Insert' },
  { name: 'Shift+Insert', key: 'Insert', code: 'Insert', ...SHIFT, chord: 'Shift+Insert' },
  { name: 'Ctrl+Shift+. (types >)', key: '>', code: 'Period', ...CTRL_SHIFT, chord: 'Ctrl+Shift+.' },
  { name: 'Ctrl+Shift+, (types <)', key: '<', code: 'Comma', ...CTRL_SHIFT, chord: 'Ctrl+Shift+,' },
  { name: 'Alt+Enter', key: 'Enter', code: 'Enter', ...ALT, chord: 'Alt+Enter' },
  { name: 'Alt+Enter on the keypad', key: 'Enter', code: 'NumpadEnter', ...ALT, chord: 'Alt+Enter' },
  { name: 'Ctrl+Tab', key: 'Tab', code: 'Tab', ...CTRL, chord: 'Ctrl+Tab' },
  { name: 'Alt+F (menu access key)', key: 'f', code: 'KeyF', ...ALT, chord: 'Alt+F' },
  { name: 'a plain letter', key: 'a', code: 'KeyA', ...NONE, chord: 'A' },
  { name: 'Control by itself', key: 'Control', code: 'ControlLeft', ...CTRL, chord: null },
  { name: 'Shift by itself', key: 'Shift', code: 'ShiftRight', ...SHIFT, chord: null },
  { name: 'Alt by itself', key: 'Alt', code: 'AltLeft', ...ALT, chord: null },
];

/**
 * Windows and Linux, the numeric keypad. With NumLock off its keys are navigation keys: `code`
 * still names the position (`Numpad0`), `key` says what the key does (`Insert`). On a laptop
 * without an Insert key this is how Insert and Shift+Insert are typed. With NumLock on the same
 * keys type digits, which form no chord.
 */
export const WINDOWS_KEYPAD: KeyFixture[] = [
  { name: 'keypad 0, NumLock off: Insert', key: 'Insert', code: 'Numpad0', ...NONE, chord: 'Insert' },
  {
    name: 'Shift + keypad 0, NumLock off: Shift+Insert',
    key: 'Insert',
    code: 'Numpad0',
    ...SHIFT,
    chord: 'Shift+Insert',
  },
  { name: 'keypad ., NumLock off: Delete', key: 'Delete', code: 'NumpadDecimal', ...NONE, chord: 'Delete' },
  { name: 'keypad 1, NumLock off: End', key: 'End', code: 'Numpad1', ...NONE, chord: 'End' },
  { name: 'keypad 2, NumLock off: Down', key: 'ArrowDown', code: 'Numpad2', ...NONE, chord: 'Down' },
  { name: 'keypad 3, NumLock off: PageDown', key: 'PageDown', code: 'Numpad3', ...NONE, chord: 'PageDown' },
  { name: 'keypad 4, NumLock off: Left', key: 'ArrowLeft', code: 'Numpad4', ...NONE, chord: 'Left' },
  { name: 'keypad 5, NumLock off: no key of ours', key: 'Clear', code: 'Numpad5', ...NONE, chord: null },
  { name: 'keypad 6, NumLock off: Right', key: 'ArrowRight', code: 'Numpad6', ...NONE, chord: 'Right' },
  { name: 'keypad 7, NumLock off: Home', key: 'Home', code: 'Numpad7', ...NONE, chord: 'Home' },
  { name: 'keypad 8, NumLock off: Up', key: 'ArrowUp', code: 'Numpad8', ...NONE, chord: 'Up' },
  { name: 'keypad 9, NumLock off: PageUp', key: 'PageUp', code: 'Numpad9', ...NONE, chord: 'PageUp' },
  { name: 'Ctrl + keypad 7, NumLock off: Ctrl+Home', key: 'Home', code: 'Numpad7', ...CTRL, chord: 'Ctrl+Home' },
  { name: 'keypad 0, NumLock on: the digit 0', key: '0', code: 'Numpad0', ...NONE, chord: null },
  { name: 'Ctrl + keypad 1, NumLock on', key: '1', code: 'Numpad1', ...CTRL, chord: null },
  { name: 'keypad ., NumLock on', key: '.', code: 'NumpadDecimal', ...NONE, chord: null },
  { name: 'keypad +', key: '+', code: 'NumpadAdd', ...NONE, chord: null },
];

/** Windows, German QWERTZ: Z and Y have swapped places; AltGr arrives as Ctrl+Alt. */
export const WINDOWS_GERMAN: KeyFixture[] = [
  { name: 'Ctrl+Z (the key labelled Z, at the US Y position)', key: 'z', code: 'KeyY', ...CTRL, chord: 'Ctrl+Z' },
  { name: 'Ctrl+Y (the key labelled Y, at the US Z position)', key: 'y', code: 'KeyZ', ...CTRL, chord: 'Ctrl+Y' },
  // Alt chords go by position (K6): Redo is the key at the US Z position, labelled Y here.
  { name: 'Ctrl+Alt + key labelled Y', key: 'y', code: 'KeyZ', ...CTRL_ALT, chord: 'Ctrl+Alt+Z' },
  { name: 'AltGr+Q (types @)', key: '@', code: 'KeyQ', ...CTRL_ALT, chord: 'Ctrl+Alt+Q' },
  { name: 'AltGr+E (types the euro sign)', key: '€', code: 'KeyE', ...CTRL_ALT, chord: 'Ctrl+Alt+E' },
  { name: 'Ctrl+Shift+. (types :)', key: ':', code: 'Period', ...CTRL_SHIFT, chord: 'Ctrl+Shift+.' },
];

/** Windows, French AZERTY: A/Q and Z/W have swapped places; M is at the US semicolon position. */
export const WINDOWS_FRENCH: KeyFixture[] = [
  { name: 'Ctrl+A (at the US Q position)', key: 'a', code: 'KeyQ', ...CTRL, chord: 'Ctrl+A' },
  { name: 'Ctrl+Z (at the US W position)', key: 'z', code: 'KeyW', ...CTRL, chord: 'Ctrl+Z' },
  { name: 'Ctrl+M (at the US semicolon position)', key: 'm', code: 'Semicolon', ...CTRL, chord: 'Ctrl+M' },
  { name: 'Ctrl+Alt + key labelled A', key: 'a', code: 'KeyQ', ...CTRL_ALT, chord: 'Ctrl+Alt+Q' },
];

/** Windows, Russian layout: every letter key produces a Cyrillic letter. */
export const WINDOWS_RUSSIAN: KeyFixture[] = [
  { name: 'Ctrl+O position (types щ)', key: 'щ', code: 'KeyO', ...CTRL, chord: 'Ctrl+O' },
  { name: 'Ctrl+S position (types ы)', key: 'ы', code: 'KeyS', ...CTRL, chord: 'Ctrl+S' },
  { name: 'Ctrl+Z position (types я)', key: 'я', code: 'KeyZ', ...CTRL, chord: 'Ctrl+Z' },
  { name: 'Ctrl+F position (types а)', key: 'а', code: 'KeyF', ...CTRL, chord: 'Ctrl+F' },
  { name: 'Ctrl+Alt+C position (types с)', key: 'с', code: 'KeyC', ...CTRL_ALT, chord: 'Ctrl+Alt+C' },
  { name: 'F7', key: 'F7', code: 'F7', ...NONE, chord: 'F7' },
];

/** Windows, Greek layout. */
export const WINDOWS_GREEK: KeyFixture[] = [
  { name: 'Ctrl+F position (types φ)', key: 'φ', code: 'KeyF', ...CTRL, chord: 'Ctrl+F' },
  { name: 'Ctrl+G position (types γ)', key: 'γ', code: 'KeyG', ...CTRL, chord: 'Ctrl+G' },
  { name: 'Ctrl+P position (types π)', key: 'π', code: 'KeyP', ...CTRL, chord: 'Ctrl+P' },
];

/** macOS, US layout. */
export const MAC_US: KeyFixture[] = [
  { name: 'Cmd+O', key: 'o', code: 'KeyO', ...CMD, chord: 'Cmd+O' },
  { name: 'Ctrl+O', key: 'o', code: 'KeyO', ...CTRL, chord: 'Ctrl+O' },
  { name: 'Shift+Cmd+S', key: 's', code: 'KeyS', ...SHIFT_CMD, chord: 'Shift+Cmd+S' },
  { name: 'Shift+Cmd+Z', key: 'z', code: 'KeyZ', ...SHIFT_CMD, chord: 'Shift+Cmd+Z' },
  { name: 'Option+O (types ø)', key: 'ø', code: 'KeyO', ...ALT, chord: 'Alt+O' },
  { name: 'Ctrl+Option+O (ø)', key: 'ø', code: 'KeyO', ...CTRL_ALT, chord: 'Ctrl+Alt+O' },
  { name: 'Ctrl+Option+Z (Ω)', key: 'Ω', code: 'KeyZ', ...CTRL_ALT, chord: 'Ctrl+Alt+Z' },
  { name: 'Ctrl+Option+C (ç)', key: 'ç', code: 'KeyC', ...CTRL_ALT, chord: 'Ctrl+Alt+C' },
  { name: 'Ctrl+Option+U (dead key: umlaut)', key: 'Dead', code: 'KeyU', ...CTRL_ALT, chord: 'Ctrl+Alt+U' },
  { name: 'Cmd+/', key: '/', code: 'Slash', ...CMD, chord: 'Cmd+/' },
  { name: 'Shift+Cmd+/ (types ?)', key: '?', code: 'Slash', ...SHIFT_CMD, chord: 'Shift+Cmd+/' },
  { name: 'Cmd+,', key: ',', code: 'Comma', ...CMD, chord: 'Cmd+,' },
  { name: 'Cmd+G', key: 'g', code: 'KeyG', ...CMD, chord: 'Cmd+G' },
  { name: 'Cmd+B', key: 'b', code: 'KeyB', ...CMD, chord: 'Cmd+B' },
  { name: 'Ctrl+R', key: 'r', code: 'KeyR', ...CTRL, chord: 'Ctrl+R' },
  { name: 'Cmd+R', key: 'r', code: 'KeyR', ...CMD, chord: 'Cmd+R' },
  { name: 'Ctrl+Shift+I', key: 'I', code: 'KeyI', ...CTRL_SHIFT, chord: 'Ctrl+Shift+I' },
  { name: 'Option+Return', key: 'Enter', code: 'Enter', ...ALT, chord: 'Alt+Enter' },
  { name: 'Shift+F2', key: 'F2', code: 'F2', ...SHIFT, chord: 'Shift+F2' },
  { name: 'Shift+F4', key: 'F4', code: 'F4', ...SHIFT, chord: 'Shift+F4' },
  // Ctrl+F2..F8 reach a page only when the system's own shortcuts on them are switched off.
  { name: 'Ctrl+F2', key: 'F2', code: 'F2', ...CTRL, chord: 'Ctrl+F2' },
  { name: 'Ctrl+F4', key: 'F4', code: 'F4', ...CTRL, chord: 'Ctrl+F4' },
  { name: 'Ctrl+F9', key: 'F9', code: 'F9', ...CTRL, chord: 'Ctrl+F9' },
  { name: 'Cmd+V', key: 'v', code: 'KeyV', ...CMD, chord: 'Cmd+V' },
  { name: 'Cmd+W', key: 'w', code: 'KeyW', ...CMD, chord: 'Cmd+W' },
  { name: 'Cmd+Q', key: 'q', code: 'KeyQ', ...CMD, chord: 'Cmd+Q' },
  { name: 'Cmd+N', key: 'n', code: 'KeyN', ...CMD, chord: 'Cmd+N' },
  { name: 'Command by itself', key: 'Meta', code: 'MetaLeft', ...CMD, chord: null },
];

/** macOS, Russian layout: Cmd still reports the Latin letter, Ctrl reports the Cyrillic one. */
export const MAC_RUSSIAN: KeyFixture[] = [
  { name: 'Cmd+O position', key: 'o', code: 'KeyO', ...CMD, chord: 'Cmd+O' },
  { name: 'Ctrl+O position (types щ)', key: 'щ', code: 'KeyO', ...CTRL, chord: 'Ctrl+O' },
  { name: 'Ctrl+Option+O position', key: 'щ', code: 'KeyO', ...CTRL_ALT, chord: 'Ctrl+Alt+O' },
];

export const ALL_FIXTURES: KeyFixture[] = [
  ...WINDOWS_US,
  ...WINDOWS_KEYPAD,
  ...WINDOWS_GERMAN,
  ...WINDOWS_FRENCH,
  ...WINDOWS_RUSSIAN,
  ...WINDOWS_GREEK,
  ...MAC_US,
  ...MAC_RUSSIAN,
];

/** The fixture with this name; throws when the name is not in the lists above. */
export function fixture(list: readonly KeyFixture[], name: string): KeyFixture {
  const found = list.find((entry) => entry.name === name);
  if (!found) throw new Error(`No key fixture named "${name}"`);
  return found;
}
