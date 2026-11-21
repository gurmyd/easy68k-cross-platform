// The WM_CHAR byte of a key press, and pasted text as the original's paste loop sees it
// (ARCHITECTURE.md 3.6; trap15-a §3.9).
//
// The original's I/O window receives two messages for a key that types something: WM_KEYDOWN with
// the virtual-key code (vk.ts) and WM_CHAR with one 8-bit character of the ANSI code page, which
// is what the keyboard tasks 2, 4, 5 and 18 read. charFromKey() gives that character for a browser
// key-down, following what Windows does:
//
//   a key that types a character       its Windows-1252 byte; none if Windows-1252 has no such character
//   Enter, Backspace, Esc              $0D, $08, $1B
//   Ctrl + letter                      $01 .. $1A (Ctrl+H is a backspace, Ctrl+I is $09, Ctrl+M is Enter)
//   Ctrl + Enter, Ctrl + Backspace     $0A, $7F
//   Ctrl + [  \  ]  ^  _               $1B .. $1F, and Ctrl + Space is a space (the US layout's control column)
//   Ctrl + anything else               none
//   Alt + key                          none: Windows sends WM_SYSCHAR, which the form's key-press handler never sees
//   Ctrl + Alt + key (AltGr)           the character AltGr types (`@`, the euro sign), none for a plain letter or digit
//   arrows, function keys, modifiers   none
//
// Owner: W1 > SH4.

import type { Bytes, KeyLike } from '../../../contracts';
import { byteForCodePoint, encode } from '../../codec/cp1252';

export type { KeyLike } from '../../../contracts';

/** What Ctrl types with a key that is not a letter (the control column of the US layout). */
const CONTROL_CHARACTERS: Readonly<Record<string, number>> = {
  '[': 0x1b,
  '\\': 0x1c,
  ']': 0x1d,
  '^': 0x1e,
  _: 0x1f,
  ' ': 0x20,
};

/** True if `key` (KeyboardEvent.key) is one character and not the name of a key such as `Enter`. */
export function isOneCharacter(key: string): boolean {
  if (key.length === 0 || key.length > 2) return false;
  return key.length === 1 || (key.codePointAt(0) as number) > 0xffff; // a surrogate pair is one character
}

/**
 * The letter A-Z of a key press, or null: the letter the key types if that is an ASCII letter (it
 * follows the keyboard layout), otherwise the letter of the key's position (`code`), which is what
 * a Cyrillic or Greek layout leaves to go by.
 */
function letterOf(ev: Pick<KeyLike, 'key' | 'code'>): string | null {
  if (/^[A-Za-z]$/.test(ev.key)) return ev.key.toUpperCase();
  if (isOneCharacter(ev.key) && /^[\x20-\x7e]$/.test(ev.key)) return null; // an ASCII digit or sign: not a letter
  return /^Key([A-Z])$/.exec(ev.code)?.[1] ?? null;
}

/** The WM_CHAR byte for a key-down, or null when Windows would send none (trap15-a §3.9):
 *  printable -> its Windows-1252 byte (null if not representable); Enter 13; Backspace 8; Esc 27;
 *  Ctrl+letter 1..26; Ctrl+Enter 10; Ctrl+Backspace 127; arrows, function keys, modifiers -> null. */
export function charFromKey(ev: KeyLike): number | null {
  // A chord with the Windows key (Command on a Mac) types nothing.
  if (ev.metaKey) return null;
  const { key } = ev;

  if (!isOneCharacter(key)) {
    // A named key. With Alt held it is a system key (Alt+Enter), which has no WM_CHAR.
    if (ev.altKey) return null;
    switch (key) {
      case 'Enter':
        return ev.ctrlKey ? 0x0a : 0x0d;
      case 'Backspace':
        return ev.ctrlKey ? 0x7f : 0x08;
      case 'Escape':
        return 0x1b;
      case 'Tab':
        return ev.ctrlKey ? null : 0x09;
      default:
        return null; // arrows, function keys, modifiers, Insert, Delete, dead keys, `Process`, ...
    }
  }

  if (ev.ctrlKey && !ev.altKey) {
    const letter = letterOf(ev);
    if (letter !== null) return letter.charCodeAt(0) & 0x1f;
    return Object.hasOwn(CONTROL_CHARACTERS, key) ? (CONTROL_CHARACTERS[key] as number) : null;
  }
  if (ev.altKey) {
    // Alt alone: a system key. Ctrl+Alt is AltGr, which types a character on layouts that have one;
    // where it has none the browser reports the key's plain letter or digit, and Windows sends nothing.
    if (!ev.ctrlKey || /^[A-Za-z0-9]$/.test(key)) return null;
  }
  return byteForCodePoint(key.codePointAt(0) as number);
}

/** The most bytes one paste delivers: the original reads the clipboard into a 255-byte buffer. */
export const PASTE_LIMIT = 254;

/** Clipboard text as the original's paste loop sees it: every line end becomes CR LF (a Windows
 *  clipboard always holds CR LF; browsers on macOS and Linux deliver LF), the text is encoded as
 *  Windows-1252 with '?' for other characters, and cut to 254 bytes (simIOu.cpp:440). */
export function pasteBytes(text: string): Bytes {
  // The original's loop stops at the first NUL, as the clipboard text of Windows does.
  const end = text.indexOf('\0');
  // No more than two code units make one byte, so the rest of a long text cannot matter.
  const head = (end < 0 ? text : text.slice(0, end)).slice(0, 2 * PASTE_LIMIT);
  return encode(head.replace(/\r\n|\r|\n/g, '\r\n')).bytes.slice(0, PASTE_LIMIT);
}
