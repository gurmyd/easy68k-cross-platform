// The WM_CHAR byte of a key press, and pasted text as the original's paste loop sees it
// (ARCHITECTURE.md 3.6; trap15-a §3.9).
//
// STUB written by W1 (wave 0). SH4 replaces the bodies; the exported names and signatures are
// contract (section 8, "Stubs"). The stub produces no characters.
//
// Owner: W1 > SH4.

import type { Bytes, KeyLike } from '../../../contracts';

export type { KeyLike } from '../../../contracts';

/** The WM_CHAR byte for a key-down, or null when Windows would send none (trap15-a §3.9):
 *  printable -> its Windows-1252 byte (null if not representable); Enter 13; Backspace 8; Esc 27;
 *  Ctrl+letter 1..26; Ctrl+Enter 10; Ctrl+Backspace 127; arrows, function keys, modifiers -> null. */
export function charFromKey(_ev: KeyLike): number | null {
  return null;
}

/** Clipboard text as the original's paste loop sees it: every line end becomes CR LF (a Windows
 *  clipboard always holds CR LF; browsers on macOS and Linux deliver LF), the text is encoded as
 *  Windows-1252 with '?' for other characters, and cut to 254 bytes (simIOu.cpp:440). */
export function pasteBytes(_text: string): Bytes {
  return new Uint8Array(0);
}
