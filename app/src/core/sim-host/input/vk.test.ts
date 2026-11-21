// The virtual-key table against the list of trap15-b §9.1 (last paragraph), written out here as
// the spec gives it: one row per key name with its Windows code and the KeyboardEvent.code values
// that stand for it.

import { describe, expect, it } from 'vitest';
import { VK_CODES, vkFromCode } from './vk';

interface Row {
  name: string;
  vk: number;
  codes: string[];
  /** The NumLock state the row holds for; undefined = both. */
  numLock?: boolean;
}

const letters: Row[] = Array.from({ length: 26 }, (_, i) => {
  const letter = String.fromCharCode(0x41 + i);
  return { name: `letter ${letter}`, vk: 0x41 + i, codes: [`Key${letter}`] };
});
const digits: Row[] = Array.from({ length: 10 }, (_, i) => ({
  name: `top-row digit ${i}`,
  vk: 0x30 + i,
  codes: [`Digit${i}`],
}));
const keypadDigits: Row[] = Array.from({ length: 10 }, (_, i) => ({
  name: `keypad ${i} with NumLock on`,
  vk: 0x60 + i,
  codes: [`Numpad${i}`],
  numLock: true,
}));
const functionKeys: Row[] = Array.from({ length: 12 }, (_, i) => ({
  name: `F${i + 1}`,
  vk: 0x70 + i,
  codes: [`F${i + 1}`],
}));

/** trap15-b §9.1: "Virtual-key codes (help page keyCodes.htm, plus the standard Windows values)". */
const SPEC: Row[] = [
  ...letters,
  ...digits,
  { name: 'Backspace', vk: 0x08, codes: ['Backspace'] },
  { name: 'Tab', vk: 0x09, codes: ['Tab'] },
  { name: 'keypad 5 with NumLock off', vk: 0x0c, codes: ['Numpad5'], numLock: false },
  { name: 'Enter', vk: 0x0d, codes: ['Enter', 'NumpadEnter'] },
  { name: 'Shift', vk: 0x10, codes: ['ShiftLeft', 'ShiftRight'] },
  { name: 'Ctrl', vk: 0x11, codes: ['ControlLeft', 'ControlRight'] },
  { name: 'Alt', vk: 0x12, codes: ['AltLeft', 'AltRight'] },
  { name: 'Pause', vk: 0x13, codes: ['Pause'] },
  { name: 'Caps Lock', vk: 0x14, codes: ['CapsLock'] },
  { name: 'Esc', vk: 0x1b, codes: ['Escape'] },
  { name: 'Space', vk: 0x20, codes: ['Space'] },
  { name: 'Page Up', vk: 0x21, codes: ['PageUp'] },
  { name: 'Page Down', vk: 0x22, codes: ['PageDown'] },
  { name: 'End', vk: 0x23, codes: ['End'] },
  { name: 'Home', vk: 0x24, codes: ['Home'] },
  { name: 'Left', vk: 0x25, codes: ['ArrowLeft'] },
  { name: 'Up', vk: 0x26, codes: ['ArrowUp'] },
  { name: 'Right', vk: 0x27, codes: ['ArrowRight'] },
  { name: 'Down', vk: 0x28, codes: ['ArrowDown'] },
  { name: 'Insert', vk: 0x2d, codes: ['Insert'] },
  { name: 'Delete', vk: 0x2e, codes: ['Delete'] },
  ...keypadDigits,
  { name: 'keypad *', vk: 0x6a, codes: ['NumpadMultiply'] },
  { name: 'keypad +', vk: 0x6b, codes: ['NumpadAdd'] },
  { name: 'keypad -', vk: 0x6d, codes: ['NumpadSubtract'] },
  { name: 'keypad . with NumLock on', vk: 0x6e, codes: ['NumpadDecimal'], numLock: true },
  { name: 'keypad /', vk: 0x6f, codes: ['NumpadDivide'] },
  ...functionKeys,
  { name: 'Num Lock', vk: 0x90, codes: ['NumLock'] },
  { name: 'Scroll Lock', vk: 0x91, codes: ['ScrollLock'] },
  { name: ';', vk: 0xba, codes: ['Semicolon'] },
  { name: '=', vk: 0xbb, codes: ['Equal'] },
  { name: ',', vk: 0xbc, codes: ['Comma'] },
  { name: '-', vk: 0xbd, codes: ['Minus'] },
  { name: '.', vk: 0xbe, codes: ['Period'] },
  { name: '/', vk: 0xbf, codes: ['Slash'] },
  { name: 'backquote', vk: 0xc0, codes: ['Backquote'] },
  { name: '[', vk: 0xdb, codes: ['BracketLeft'] },
  { name: '\\', vk: 0xdc, codes: ['Backslash'] },
  { name: ']', vk: 0xdd, codes: ['BracketRight'] },
  { name: 'quote', vk: 0xde, codes: ['Quote'] },
];

/** trap15-a task 19: the keypad with NumLock off gives the codes of the navigation keys printed on
 *  its keys: 9/3/1/7 = $21-$24, 4/8/6/2 = $25-$28, 0 = $2D, `.` = $2E. */
const KEYPAD_OFF: [code: string, vk: number][] = [
  ['Numpad9', 0x21],
  ['Numpad3', 0x22],
  ['Numpad1', 0x23],
  ['Numpad7', 0x24],
  ['Numpad4', 0x25],
  ['Numpad8', 0x26],
  ['Numpad6', 0x27],
  ['Numpad2', 0x28],
  ['Numpad0', 0x2d],
  ['NumpadDecimal', 0x2e],
  ['Numpad5', 0x0c],
];

describe('vkFromCode', () => {
  it.each(SPEC)('$name is $vk', ({ vk, codes, numLock }) => {
    for (const code of codes) {
      for (const state of numLock === undefined ? [true, false] : [numLock]) {
        expect(vkFromCode(code, state), `${code}, NumLock ${state ? 'on' : 'off'}`).toBe(vk);
      }
    }
  });

  it.each(KEYPAD_OFF)('%s with NumLock off is the navigation key printed on it', (code, vk) => {
    expect(vkFromCode(code, false)).toBe(vk);
  });

  it('knows exactly the keys of the list', () => {
    const listed = new Set([...SPEC.flatMap((row) => row.codes), ...KEYPAD_OFF.map(([code]) => code)]);
    expect([...VK_CODES].sort()).toEqual([...listed].sort());
    // ... and produces exactly the codes of the list.
    const produced = new Set(VK_CODES.flatMap((code) => [vkFromCode(code, true), vkFromCode(code, false)]));
    const specified = new Set([...SPEC.map((row) => row.vk), ...KEYPAD_OFF.map(([, vk]) => vk)]);
    expect([...produced].sort((a, b) => a - b)).toEqual([...specified].sort((a, b) => a - b));
  });

  it('answers 0 for every other key', () => {
    for (const code of [
      '',
      'MetaLeft',
      'MetaRight',
      'ContextMenu',
      'IntlBackslash',
      'F13',
      'F24',
      'PrintScreen',
      'NumpadEqual',
      'AudioVolumeUp',
      'KeyÄ',
      'Digit10',
      'keya',
      'toString',
      'constructor',
    ]) {
      expect(vkFromCode(code, true), code).toBe(0);
      expect(vkFromCode(code, false), code).toBe(0);
    }
  });

  it('macOS keypad rule: with numLock true the keypad types digits and Clear is $90', () => {
    // A Mac keyboard has no NumLock; OutputKeyboard always passes true there (keyboard.test.ts).
    expect(vkFromCode('Numpad5', true)).toBe(0x65);
    expect(vkFromCode('NumpadDecimal', true)).toBe(0x6e);
    expect(vkFromCode('NumLock', true)).toBe(0x90);
  });
});
