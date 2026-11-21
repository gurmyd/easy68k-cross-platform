// Key chords (ARCHITECTURE.md 2.9.1). Owner: W3.
//
// A chord is a key with its modifiers, written `Ctrl+Shift+F9` or `Cmd+O`. This module turns a
// keyboard event into a chord, brings a written chord into its normal form, and formats a chord
// for display on a platform.
//
// Normal form: the modifiers in the order Ctrl, Alt, Shift, Cmd, then the key. `Alt` is the
// Option key of a Mac and `Cmd` its Command key (the Windows key elsewhere, which no binding
// uses). Keys are named as below: letters in upper case, `F1`..`F24`, digits, the punctuation
// character of the US layout, and `Enter`, `Tab`, `Esc`, `Space`, `Insert`, `Delete`,
// `Backspace`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`. The `+` key
// has no name here: `+` only separates the parts of a chord, and no command uses that key.
//
// How the key of an event is named (2.9.1; rule K6 of section 1.3):
//
// - A LETTER comes from `KeyboardEvent.key` when that is a single ASCII letter. It follows the
//   user's layout: Ctrl+Z is the key labelled Z on an AZERTY or QWERTZ keyboard too.
// - With Alt held, or when `key` is not an ASCII letter, a letter comes from the key's POSITION
//   (`KeyboardEvent.code`, `KeyA`..`KeyZ`). Option on a Mac and AltGr on Windows change the
//   character (Option+O is `ø`), a dead key has no character (`Dead`), and Cyrillic or Greek
//   layouts have no ASCII letters at all.
// - Function keys, digits, punctuation and the named keys always come from the position.
// - The numeric keypad is the exception: its positions (`Numpad0`..`Numpad9`, `NumpadDecimal`)
//   have no fixed meaning. With NumLock off they are Insert, End, the arrows, Delete and so on,
//   and the event says which in `key` (`key: 'Insert', code: 'Numpad0'`). Such a press is the
//   named key, as on Windows, where it sends the same virtual key as the navigation block. On
//   many laptops the keypad is the only place with an Insert key. With NumLock on the keypad
//   types digits; those form no chord, as in the original (a shortcut on `1` is not on `Num 1`).

/** The parts of a KeyboardEvent this module reads; a plain object will do in tests. */
export interface KeyEventLike {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
}

export type Os = 'mac' | 'windows' | 'linux';

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Cmd'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

/** Other spellings of modifiers and keys that tables and people write. */
const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  cmd: 'Cmd',
  command: 'Cmd',
  meta: 'Cmd',
};
const KEY_ALIASES: Record<string, string> = {
  return: 'Enter',
  enter: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  ins: 'Insert',
  insert: 'Insert',
  del: 'Delete',
  delete: 'Delete',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
};

/** Keys named by their position (KeyboardEvent.code). */
const CODE_NAMES: Record<string, string> = {
  Period: '.',
  Comma: ',',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Space: 'Space',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/**
 * The same names from `KeyboardEvent.key`: for the numeric keypad, whose keys are navigation keys
 * while NumLock is off, and for events without a `code` (some virtual keyboards).
 */
const KEY_NAMES: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  ' ': 'Space',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/;

function join(modifiers: ReadonlySet<Modifier>, key: string): string {
  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

/**
 * The normal form of a written chord: `Shift+Cmd+S`, `cmd+shift+s` and `Command+Shift+S` all
 * give `Shift+Cmd+S`; `Ctrl+Option+Z` gives `Ctrl+Alt+Z`; `Option+Return` gives `Alt+Enter`.
 * Throws for text that is not a chord, so that a typing mistake in a table fails its test.
 */
export function normalizeChord(text: string): string {
  const parts = text.split('+');
  const keyPart = parts.pop();
  if (keyPart === undefined || keyPart === '') throw new Error(`Not a key chord: "${text}"`);
  const modifiers = new Set<Modifier>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()];
    if (!modifier) throw new Error(`Unknown modifier "${part}" in key chord "${text}"`);
    modifiers.add(modifier);
  }
  const trimmed = keyPart.trim();
  let key = KEY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
  if (/^[a-z]$/.test(key)) key = key.toUpperCase();
  if (/^f\d+$/i.test(key)) key = key.toUpperCase();
  if (key.length > 1 && !FUNCTION_KEY.test(key) && !Object.values(KEY_ALIASES).includes(key)) {
    throw new Error(`Unknown key "${keyPart}" in key chord "${text}"`);
  }
  return join(modifiers, key);
}

/** The name of the key of an event, or null for a key that forms no chord (a modifier by itself). */
export function keyNameOf(event: Pick<KeyEventLike, 'key' | 'code' | 'altKey'>): string | null {
  const { key, code } = event;
  if (!event.altKey && /^[A-Za-z]$/.test(key)) return key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter;
  if (FUNCTION_KEY.test(code)) return code;
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit) return digit;
  const named = CODE_NAMES[code];
  if (named) return named;
  // The keypad with NumLock off: named by what the key does (`key`), not by where it is.
  if (code.startsWith('Numpad')) return KEY_NAMES[key] ?? null;
  if (code !== '') return null;
  // No position information at all: fall back on the character.
  if (FUNCTION_KEY.test(key)) return key;
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (/^[A-Za-z]$/.test(key)) return key.toUpperCase();
  if (/^[\x21-\x7e]$/.test(key)) return key;
  return null;
}

/** The chord of a key-down event in normal form, or null when the key forms none. */
export function chordOf(event: KeyEventLike): string | null {
  const key = keyNameOf(event);
  if (key === null) return null;
  const modifiers = new Set<Modifier>();
  if (event.ctrlKey) modifiers.add('Ctrl');
  if (event.altKey) modifiers.add('Alt');
  if (event.shiftKey) modifiers.add('Shift');
  if (event.metaKey) modifiers.add('Cmd');
  return join(modifiers, key);
}

/** Splits a chord in normal form into its modifiers and its key. */
export function splitChord(chord: string): { modifiers: string[]; key: string } {
  const parts = chord.split('+');
  const key = parts.pop() ?? '';
  return { modifiers: parts, key };
}

/**
 * A chord as menus and tool-tips show it. Windows and Linux: `Ctrl+Alt+Z`. macOS: the same order
 * with Apple's names, `Ctrl+Option+Z`, `Shift+Cmd+S`, `Option+Return` (the spelling of section 1.3).
 */
export function formatChord(chord: string, os: Os): string {
  if (os !== 'mac') return chord;
  const { modifiers, key } = splitChord(chord);
  return [
    ...modifiers.map((modifier) => (modifier === 'Alt' ? 'Option' : modifier)),
    key === 'Enter' ? 'Return' : key,
  ].join('+');
}
