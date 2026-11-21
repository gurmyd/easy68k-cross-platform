// Windows virtual-key codes for browser key events (ARCHITECTURE.md 3.6; trap15-b §9.1).
//
// A 68000 program reads keys with TRAP #15 task 19 as Windows virtual-key codes: the original's
// I/O window records the code of every WM_KEYDOWN and WM_KEYUP it receives. A browser reports
// which physical key was pressed in `KeyboardEvent.code`; this table turns that into the code
// Windows gives the same key on a US keyboard. It holds exactly the keys listed in trap15-b §9.1
// (the help page `keyCodes.htm` plus the standard Windows values for the numeric keypad); every
// other key answers 0, and the Output keyboard reports no key for it (keyboard.ts).
//
// The numeric keypad has two sets of codes. With NumLock on its keys are digits and the decimal
// point ($60-$69, $6E); with NumLock off they are the navigation keys printed on them (Insert,
// End, the arrows, ... and $0C for the 5). The operator keys and Enter do not depend on NumLock.
//
// Owner: W1 > SH4.

/** Keys with one code, by `KeyboardEvent.code`. */
const FIXED: Readonly<Record<string, number>> = {
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  NumpadEnter: 0x0d,
  ShiftLeft: 0x10, // left and right Shift, Ctrl and Alt are not distinguished
  ShiftRight: 0x10,
  ControlLeft: 0x11,
  ControlRight: 0x11,
  AltLeft: 0x12,
  AltRight: 0x12,
  Pause: 0x13,
  CapsLock: 0x14,
  Escape: 0x1b,
  Space: 0x20,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
  NumpadMultiply: 0x6a,
  NumpadAdd: 0x6b,
  NumpadSubtract: 0x6d,
  NumpadDivide: 0x6f,
  NumLock: 0x90, // also the Clear key of a Mac keypad, whose `code` is NumLock
  ScrollLock: 0x91,
  Semicolon: 0xba,
  Equal: 0xbb,
  Comma: 0xbc,
  Minus: 0xbd,
  Period: 0xbe,
  Slash: 0xbf,
  Backquote: 0xc0,
  BracketLeft: 0xdb,
  Backslash: 0xdc,
  BracketRight: 0xdd,
  Quote: 0xde,
};

/** The keypad keys that depend on NumLock: [code with NumLock on, code with NumLock off]. */
const KEYPAD: Readonly<Record<string, readonly [on: number, off: number]>> = {
  Numpad0: [0x60, 0x2d], // Insert
  Numpad1: [0x61, 0x23], // End
  Numpad2: [0x62, 0x28], // Down
  Numpad3: [0x63, 0x22], // Page Down
  Numpad4: [0x64, 0x25], // Left
  Numpad5: [0x65, 0x0c], // the 5 without NumLock: VK_CLEAR
  Numpad6: [0x66, 0x27], // Right
  Numpad7: [0x67, 0x24], // Home
  Numpad8: [0x68, 0x26], // Up
  Numpad9: [0x69, 0x21], // Page Up
  NumpadDecimal: [0x6e, 0x2e], // Delete
};

/** Every `KeyboardEvent.code` the table knows, for tests and diagnostics. */
export const VK_CODES: readonly string[] = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(0x41 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...Object.keys(FIXED),
  ...Object.keys(KEYPAD),
];

/** Windows virtual-key code for a KeyboardEvent.code, or 0. Table: trap15-b §9.1 (last paragraph).
 *  numLock decides between the digit and the navigation codes of the keypad. */
export function vkFromCode(code: string, numLock: boolean): number {
  // Letters are the capital letter's ASCII code, digits of the top row the digit's.
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter.charCodeAt(0);
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit.charCodeAt(0);
  const functionKey = /^F([1-9]|1[0-2])$/.exec(code)?.[1];
  if (functionKey !== undefined) return 0x6f + Number(functionKey); // F1 = $70 ... F12 = $7B
  const keypad = Object.hasOwn(KEYPAD, code) ? KEYPAD[code] : undefined;
  if (keypad !== undefined) return numLock ? keypad[0] : keypad[1];
  return Object.hasOwn(FIXED, code) ? (FIXED[code] as number) : 0;
}
