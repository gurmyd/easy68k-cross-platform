// OutputKeyboard: what is posted to the run controller for the key events of the Output panel
// (ARCHITECTURE.md 3.6).

import { describe, expect, it } from 'vitest';
import type { InputEvent68k, KeyLike } from '../../../contracts';
import { OutputKeyboard } from './keyboard';

type Down = KeyLike & { repeat: boolean; shiftKey: boolean };

const ev = (key: string, code: string, modifiers: Partial<Down> = {}): Down => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  ...modifiers,
});

function setup(os: 'mac' | 'windows' | 'linux' = 'windows') {
  const posted: InputEvent68k[] = [];
  const keyboard = new OutputKeyboard({ post: (event) => posted.push(event), os });
  /** What was posted since the last call. */
  const take = () => posted.splice(0);
  return { keyboard, posted, take };
}

const text = (bytes: Uint8Array | undefined) => (bytes ? String.fromCharCode(...bytes) : undefined);

describe('key-down', () => {
  it('posts one entry with the virtual key and the character', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('a', 'KeyA'), false);
    keyboard.keydown(ev('A', 'KeyA', { shiftKey: true }), false);
    keyboard.keydown(ev('Enter', 'Enter'), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x41, ch: 0x61 },
      { kind: 'keyDown', vk: 0x41, ch: 0x41 },
      { kind: 'keyDown', vk: 0x0d, ch: 0x0d },
    ]);
  });

  it('a key without a character has no ch', () => {
    const { keyboard, take } = setup();
    for (const [key, code] of [
      ['F2', 'F2'],
      ['ArrowLeft', 'ArrowLeft'],
      ['Shift', 'ShiftLeft'],
      ['Dead', 'Quote'],
    ] as const) {
      keyboard.keydown(ev(key, code), false);
    }
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x71 },
      { kind: 'keyDown', vk: 0x25 },
      { kind: 'keyDown', vk: 0x10 },
      { kind: 'keyDown', vk: 0xde },
    ]);
  });

  it('the character cases of trap15-a §3.9', () => {
    const { keyboard, take } = setup();
    const ctrl = { ctrlKey: true };
    keyboard.keydown(ev('Enter', 'Enter'), false);
    keyboard.keydown(ev('h', 'KeyH', ctrl), false);
    keyboard.keydown(ev('i', 'KeyI', ctrl), false);
    keyboard.keydown(ev('Enter', 'Enter', ctrl), false);
    keyboard.keydown(ev('Backspace', 'Backspace', ctrl), false);
    keyboard.keydown(ev('é', 'KeyE'), false);
    keyboard.keydown(ev('€', 'KeyE', { ctrlKey: true, altKey: true }), false);
    keyboard.keydown(ev('ω', 'KeyV'), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x0d, ch: 0x0d },
      { kind: 'keyDown', vk: 0x48, ch: 0x08 },
      { kind: 'keyDown', vk: 0x49, ch: 0x09 },
      { kind: 'keyDown', vk: 0x0d, ch: 0x0a },
      { kind: 'keyDown', vk: 0x08, ch: 0x7f },
      { kind: 'keyDown', vk: 0x45, ch: 0xe9 },
      { kind: 'keyDown', vk: 0x45, ch: 0x80 },
      { kind: 'keyDown', vk: 0x56 }, // a character outside Windows-1252: the key, no character
    ]);
  });

  it('auto-repeat posts the entry again, as Windows repeats both messages', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('x', 'KeyX'), false);
    keyboard.keydown(ev('x', 'KeyX', { repeat: true }), false);
    keyboard.keydown(ev('x', 'KeyX', { repeat: true }), false);
    const entry = { kind: 'keyDown', vk: 0x58, ch: 0x78 };
    expect(take()).toEqual([entry, entry, entry]);
  });

  it('the virtual key follows the position of the key, the character what it types', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('a', 'KeyQ'), false); // AZERTY
    keyboard.keydown(ev('ф', 'KeyA'), false); // Russian
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x51, ch: 0x61 },
      { kind: 'keyDown', vk: 0x41 },
    ]);
  });

  it('a key that the table does not know is not reported; its character is', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('<', 'IntlBackslash'), false);
    keyboard.keydown(ev('Meta', 'MetaLeft'), false);
    keyboard.keydown(ev('ContextMenu', 'ContextMenu'), false);
    keyboard.keyup(ev('<', 'IntlBackslash'));
    keyboard.keyup(ev('ContextMenu', 'ContextMenu'));
    expect(take()).toEqual([{ kind: 'char', ch: 0x3c }]);
  });
});

describe('the Tab rule (2.9.4 rule 3)', () => {
  it('plain Tab and Shift+Tab post no key-down and no character; the key-up is posted', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('Tab', 'Tab'), false);
    keyboard.keydown(ev('Tab', 'Tab', { shiftKey: true }), false);
    expect(take()).toEqual([]);
    keyboard.keyup(ev('Tab', 'Tab'));
    expect(take()).toEqual([{ kind: 'keyUp', vk: 0x09 }]);
  });

  it('Ctrl+Tab is a key-down without a character', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('Tab', 'Tab', { ctrlKey: true }), false);
    expect(take()).toEqual([{ kind: 'keyDown', vk: 0x09 }]);
  });
});

describe('numeric keypad', () => {
  it('Windows and Linux: the event says whether NumLock is on', () => {
    const { keyboard, take } = setup('windows');
    keyboard.keydown(ev('4', 'Numpad4'), false);
    keyboard.keydown(ev('ArrowLeft', 'Numpad4'), false);
    keyboard.keydown(ev('Clear', 'Numpad5'), false);
    keyboard.keydown(ev('Insert', 'Numpad0', { shiftKey: true }), false);
    keyboard.keydown(ev('.', 'NumpadDecimal'), false);
    keyboard.keydown(ev('Delete', 'NumpadDecimal'), false);
    keyboard.keydown(ev('Enter', 'NumpadEnter'), false);
    keyboard.keydown(ev('+', 'NumpadAdd'), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x64, ch: 0x34 },
      { kind: 'keyDown', vk: 0x25 },
      { kind: 'keyDown', vk: 0x0c },
      { kind: 'keyDown', vk: 0x2d },
      { kind: 'keyDown', vk: 0x6e, ch: 0x2e },
      { kind: 'keyDown', vk: 0x2e },
      { kind: 'keyDown', vk: 0x0d, ch: 0x0d },
      { kind: 'keyDown', vk: 0x6b, ch: 0x2b },
    ]);
  });

  it('macOS keypad rule: always digits, and the Clear key is $90', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('5', 'Numpad5'), false);
    keyboard.keydown(ev('Clear', 'NumLock'), false);
    // Even if an event named a navigation key, a Mac keypad has no such mode.
    keyboard.keydown(ev('ArrowLeft', 'Numpad4'), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x65, ch: 0x35 },
      { kind: 'keyDown', vk: 0x90 },
      { kind: 'keyDown', vk: 0x64 },
    ]);
  });

  it('a keypad key goes up as the key it went down as', () => {
    const { keyboard, take } = setup('windows');
    keyboard.keydown(ev('ArrowLeft', 'Numpad4'), false);
    take();
    // NumLock was switched on meanwhile: the key-up names a digit.
    keyboard.keyup(ev('4', 'Numpad4'));
    expect(take()).toEqual([{ kind: 'keyUp', vk: 0x25 }]);
  });
});

describe('key-up', () => {
  it('is posted for every key, also one that never went down here', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('a', 'KeyA'), false);
    keyboard.keyup(ev('a', 'KeyA'));
    keyboard.keyup(ev('F9', 'F9')); // its key-down ran a menu command
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x41, ch: 0x61 },
      { kind: 'keyUp', vk: 0x41 },
      { kind: 'keyUp', vk: 0x78 },
    ]);
  });
});

describe('macOS: key-ups that Command swallows', () => {
  const cmd = { metaKey: true };

  it('are restored when Meta is released', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('Meta', 'MetaLeft', cmd), false);
    keyboard.keydown(ev('s', 'KeyS', cmd), false);
    keyboard.keydown(ev('ArrowRight', 'ArrowRight', cmd), false);
    keyboard.keydown(ev('Shift', 'ShiftLeft', { ...cmd, shiftKey: true }), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x53 }, // no character: a Command chord types nothing
      { kind: 'keyDown', vk: 0x27 },
      { kind: 'keyDown', vk: 0x10 },
    ]);
    // S and Right are released while Command is held: macOS sends no key-up for them.
    keyboard.keyup(ev('Meta', 'MetaLeft'));
    expect(take()).toEqual([
      { kind: 'keyUp', vk: 0x53 },
      { kind: 'keyUp', vk: 0x27 },
    ]);
    // Shift is a modifier: its own key-up arrives.
    keyboard.keyup(ev('Shift', 'ShiftLeft'));
    expect(take()).toEqual([{ kind: 'keyUp', vk: 0x10 }]);
    // Nothing is released twice.
    keyboard.keydown(ev('Meta', 'MetaRight', cmd), false);
    keyboard.keyup(ev('Meta', 'MetaRight'));
    expect(take()).toEqual([]);
  });

  it('a key whose key-up did arrive is not released again', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('a', 'KeyA'), false);
    keyboard.keyup(ev('a', 'KeyA'));
    keyboard.keydown(ev('Meta', 'MetaLeft', cmd), false);
    keyboard.keyup(ev('Meta', 'MetaLeft'));
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x41, ch: 0x61 },
      { kind: 'keyUp', vk: 0x41 },
    ]);
  });

  it('Windows and Linux deliver those key-ups themselves: nothing is added', () => {
    const { keyboard, take } = setup('windows');
    keyboard.keydown(ev('ArrowRight', 'ArrowRight'), false);
    keyboard.keydown(ev('Meta', 'MetaLeft', cmd), false);
    keyboard.keyup(ev('Meta', 'MetaLeft'));
    expect(take()).toEqual([{ kind: 'keyDown', vk: 0x27 }]);
  });
});

describe('macOS: Option types characters', () => {
  it('Option+G is the copyright sign; Option+Return types nothing', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('©', 'KeyG', { altKey: true }), false);
    keyboard.keydown(ev('Enter', 'Enter', { altKey: true }), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x47, ch: 0xa9 },
      { kind: 'keyDown', vk: 0x0d },
    ]);
  });

  it('on Windows Alt + key is a system key without a character', () => {
    const { keyboard, take } = setup('windows');
    keyboard.keydown(ev('g', 'KeyG', { altKey: true }), false);
    expect(take()).toEqual([{ kind: 'keyDown', vk: 0x47 }]);
  });
});

describe('text from a dead key or an input method', () => {
  it('posts one char per character that has a Windows-1252 byte', () => {
    const { keyboard, take } = setup();
    keyboard.text('é');
    keyboard.text('añ€');
    keyboard.text('日本'); // nothing representable
    keyboard.text('aあb😀c');
    expect(take()).toEqual([
      { kind: 'char', ch: 0xe9 },
      { kind: 'char', ch: 0x61 },
      { kind: 'char', ch: 0xf1 },
      { kind: 'char', ch: 0x80 },
      { kind: 'char', ch: 0x61 },
      { kind: 'char', ch: 0x62 },
      { kind: 'char', ch: 0x63 },
    ]);
  });
});

describe('paste', () => {
  const shiftInsert = ev('Insert', 'Insert', { shiftKey: true });

  it('keeps the key-down back and posts it with the text of the paste event', () => {
    const { keyboard, posted, take } = setup();
    keyboard.keydown(shiftInsert, true);
    expect(posted).toEqual([]);
    keyboard.paste('HELLO');
    const [entry, ...rest] = take();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ kind: 'keyDown', vk: 0x2d });
    expect(entry && 'ch' in entry).toBe(false);
    expect(text((entry as { paste?: Uint8Array }).paste)).toBe('HELLO');
  });

  it('LF becomes CR LF and 300 characters give 254 bytes', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(shiftInsert, true);
    keyboard.paste('ONE\nTWO');
    expect(text((take()[0] as { paste?: Uint8Array }).paste)).toBe('ONE\r\nTWO');
    keyboard.keydown(shiftInsert, true);
    keyboard.paste('z'.repeat(300));
    expect((take()[0] as { paste?: Uint8Array }).paste?.length).toBe(254);
  });

  it('an empty clipboard: the key-down goes out without text', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(shiftInsert, true);
    keyboard.paste(''); // the panel's zero-delay timer
    expect(take()).toEqual([{ kind: 'keyDown', vk: 0x2d }]);
    keyboard.paste('');
    expect(take()).toEqual([]);
  });

  it('whatever happens before the paste event sends the key-down first, in order', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(shiftInsert, true);
    keyboard.keyup(shiftInsert);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x2d },
      { kind: 'keyUp', vk: 0x2d },
    ]);

    keyboard.keydown(shiftInsert, true);
    keyboard.keydown(ev('a', 'KeyA'), false);
    expect(take()).toEqual([
      { kind: 'keyDown', vk: 0x2d },
      { kind: 'keyDown', vk: 0x41, ch: 0x61 },
    ]);

    keyboard.keydown(shiftInsert, true);
    keyboard.focusLost();
    expect(take()).toEqual([{ kind: 'keyDown', vk: 0x2d }]);
  });

  it('macOS: Cmd+V is kept back in the same way', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('v', 'KeyV', { metaKey: true }), true);
    keyboard.paste('HI');
    const [entry] = take();
    expect(entry).toMatchObject({ kind: 'keyDown', vk: 0x56 });
    expect(text((entry as { paste?: Uint8Array }).paste)).toBe('HI');
  });

  it("text pasted without the chord (the browser's own Paste command) arrives as typed characters", () => {
    const { keyboard, take } = setup();
    keyboard.paste('Hi\n');
    expect(take()).toEqual([
      { kind: 'char', ch: 0x48 },
      { kind: 'char', ch: 0x69 },
      { kind: 'char', ch: 0x0d },
      { kind: 'char', ch: 0x0a },
    ]);
  });
});

describe('focus', () => {
  it('gaining the focus posts ioActivated', () => {
    const { keyboard, take } = setup();
    keyboard.focusGained();
    expect(take()).toEqual([{ kind: 'ioActivated' }]);
  });

  it('nothing is posted on focus loss: held keys stay down for the program', () => {
    const { keyboard, take } = setup();
    keyboard.keydown(ev('ArrowLeft', 'ArrowLeft'), false);
    keyboard.keydown(ev(' ', 'Space'), false);
    take();
    keyboard.focusLost();
    expect(take()).toEqual([]);
  });

  it('focus loss forgets the keys that went down (macOS: nothing is released for them later)', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('ArrowLeft', 'ArrowLeft'), false);
    keyboard.focusLost();
    keyboard.focusGained();
    take();
    keyboard.keydown(ev('Meta', 'MetaLeft', { metaKey: true }), false);
    keyboard.keyup(ev('Meta', 'MetaLeft'));
    expect(take()).toEqual([]);
  });
});

describe('resetToStartup', () => {
  it('forgets the keys it saw go down and a waiting paste key', () => {
    const { keyboard, take } = setup('mac');
    keyboard.keydown(ev('a', 'KeyA', { metaKey: true }), false);
    keyboard.keydown(ev('v', 'KeyV', { metaKey: true }), true);
    take();
    keyboard.resetToStartup();
    keyboard.keyup(ev('Meta', 'MetaLeft'));
    keyboard.paste('');
    expect(take()).toEqual([]);
  });

  it('works when constructed with inert dependencies', () => {
    const keyboard = new OutputKeyboard({ post: () => {}, os: 'linux' });
    keyboard.keydown(ev('a', 'KeyA'), false);
    keyboard.keyup(ev('a', 'KeyA'));
    keyboard.text('x');
    keyboard.paste('y');
    keyboard.focusGained();
    keyboard.focusLost();
    keyboard.resetToStartup();
  });
});
