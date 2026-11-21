// The four rules of 2.9.4 for a key-down in the Output panel, as the panel (SH4) will ask them.

import { describe, expect, it } from 'vitest';
import type { CommandId } from '../contracts';
import { splitChord, type KeyEventLike, type Os } from './chords';
import { MAC_US, WINDOWS_KEYPAD, WINDOWS_US, fixture } from './key-fixtures';
import { OUTPUT_SHORTCUT_COMMANDS, outputPanelKeyAction, outputShortcuts, type OutputKeyAction } from './output-keys';

const key = (name: string, modifiers: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key: name,
  code: /^[a-z]$/.test(name) ? `Key${name.toUpperCase()}` : name,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...modifiers,
});

/** The key-down a US keyboard sends for a chord in normal form (`Ctrl+F4`, `Cmd+O`). */
function eventOf(chord: string): KeyEventLike {
  const { modifiers, key: name } = splitChord(chord);
  return key(/^[A-Z]$/.test(name) ? name.toLowerCase() : name, {
    ctrlKey: modifiers.includes('Ctrl'),
    altKey: modifiers.includes('Alt'),
    shiftKey: modifiers.includes('Shift'),
    metaKey: modifiers.includes('Cmd'),
  });
}

function ask(
  event: KeyEventLike,
  options: { os?: Os; desktop?: boolean; keyCommands?: boolean; enabled?: (id: CommandId) => boolean } = {},
): OutputKeyAction {
  return outputPanelKeyAction(event, {
    os: options.os ?? 'windows',
    desktop: options.desktop ?? false,
    keyCommandsEnabled: options.keyCommands ?? true,
    commands: { isEnabled: options.enabled ?? (() => true) },
  });
}

describe('rule 1: the release chord', () => {
  it('Ctrl+Alt+O releases the keyboard, by key position', () => {
    expect(ask(fixture(WINDOWS_US, 'Ctrl+Alt+O'))).toEqual({ kind: 'release' });
    expect(ask(fixture(MAC_US, 'Ctrl+Option+O (ø)'), { os: 'mac' })).toEqual({ kind: 'release' });
  });

  it('works in every state, also after task 24', () => {
    expect(ask(fixture(WINDOWS_US, 'Ctrl+Alt+O'), { keyCommands: false })).toEqual({ kind: 'release' });
    expect(ask(fixture(MAC_US, 'Ctrl+Option+O (ø)'), { os: 'mac', keyCommands: false })).toEqual({ kind: 'release' });
  });
});

describe('rule 2: menu shortcuts in the original spelling', () => {
  it('takes the thirteen shortcuts of 2.9.4', () => {
    const ctrl = { ctrlKey: true };
    const expected: [KeyEventLike, CommandId][] = [
      [key('F6'), 'sim.run.pause'],
      [key('F7'), 'sim.run.traceInto'],
      [key('F8'), 'sim.run.stepOver'],
      [key('F9'), 'sim.run.run'],
      [key('F10'), 'sim.run.autoTrace'],
      [key('o', ctrl), 'sim.file.open'],
      [key('F2', ctrl), 'sim.run.rewind'],
      [key('F3', ctrl), 'sim.run.reload'],
      [key('F9', ctrl), 'sim.run.runToCursor'],
      [key('F4', ctrl), 'sim.run.logStart'],
      [key('F5', ctrl), 'sim.run.logStop'],
      [key('f', ctrl), 'sim.search.find'],
      [key('g', ctrl), 'sim.search.gotoPC'],
    ];
    expect(expected).toHaveLength(13);
    for (const [event, id] of expected) expect(ask(event), id).toEqual({ kind: 'command', id, enabled: true });
    expect(OUTPUT_SHORTCUT_COMMANDS).toHaveLength(13);
  });

  it('takes exactly the chords that 2.9.4 lists, on every platform, in a browser and in the desktop app', () => {
    // Typed from rule 2 of 2.9.4: the eleven, then Find and Go to PC; "on macOS also" the Cmd forms.
    const original = [
      ...['F6', 'F7', 'F8', 'F9', 'F10', 'Ctrl+O', 'Ctrl+F2', 'Ctrl+F3', 'Ctrl+F9', 'Ctrl+F4', 'Ctrl+F5'],
      ...['Ctrl+F', 'Ctrl+G'],
    ];
    const onMacAlso = ['Cmd+O', 'Cmd+F', 'Cmd+G'];
    const chordsOf = (os: Os) => outputShortcuts(os).map((shortcut) => shortcut.chord);
    expect(chordsOf('windows').sort()).toEqual([...original].sort());
    expect(chordsOf('linux').sort()).toEqual([...original].sort());
    expect(chordsOf('mac').sort()).toEqual([...original, ...onMacAlso].sort());

    for (const os of ['windows', 'linux', 'mac'] as const) {
      for (const desktop of [false, true]) {
        for (const { chord, id } of outputShortcuts(os)) {
          expect(ask(eventOf(chord), { os, desktop }), `${os}, desktop ${desktop}: ${chord}`).toEqual({
            kind: 'command',
            id,
            enabled: true,
          });
        }
      }
    }
  });

  it('Ctrl+F4 is Log Start wherever the key-down arrives; the program never sees it', () => {
    // Most browsers on Windows and Linux close the tab on Ctrl+F4 and deliver nothing (2.9.3). A
    // browser on macOS does deliver it, and so may any browser: the original's I/O window never
    // gets this key, so it is never a key-down of the program.
    const ctrlF4 = fixture(WINDOWS_US, 'Ctrl+F4');
    for (const os of ['windows', 'linux', 'mac'] as const) {
      for (const desktop of [false, true]) {
        expect(ask(ctrlF4, { os, desktop }), `${os}, desktop ${desktop}`).toEqual({
          kind: 'command',
          id: 'sim.run.logStart',
          enabled: true,
        });
        expect(ask(ctrlF4, { os, desktop, enabled: () => false })).toMatchObject({ kind: 'command', enabled: false });
        // After task 24 the original has no such shortcut, and the key is the program's.
        expect(ask(ctrlF4, { os, desktop, keyCommands: false })).toEqual({ kind: 'program', then: null });
      }
    }
  });

  it('reports a disabled command as taken but not to be run: the key is not delivered either way', () => {
    expect(ask(key('F9'), { enabled: () => false })).toEqual({ kind: 'command', id: 'sim.run.run', enabled: false });
  });

  it('on macOS also takes Cmd+O, Cmd+F and Cmd+G', () => {
    const cmd = { metaKey: true };
    expect(ask(key('o', cmd), { os: 'mac' })).toMatchObject({ kind: 'command', id: 'sim.file.open' });
    expect(ask(key('f', cmd), { os: 'mac' })).toMatchObject({ kind: 'command', id: 'sim.search.find' });
    expect(ask(key('g', cmd), { os: 'mac' })).toMatchObject({ kind: 'command', id: 'sim.search.gotoPC' });
    expect(ask(key('o', { ctrlKey: true }), { os: 'mac' })).toMatchObject({ kind: 'command', id: 'sim.file.open' });
    expect(ask(key('F2', { ctrlKey: true }), { os: 'mac' })).toMatchObject({ kind: 'command', id: 'sim.run.rewind' });
  });

  it('after task 24 takes only Find and Go to PC; the eleven go to the program', () => {
    const off = { keyCommands: false };
    expect(ask(key('f', { ctrlKey: true }), off)).toMatchObject({ kind: 'command', id: 'sim.search.find' });
    expect(ask(key('g', { ctrlKey: true }), off)).toMatchObject({ kind: 'command', id: 'sim.search.gotoPC' });
    for (const event of [key('F9'), key('F6'), key('o', { ctrlKey: true }), key('F2', { ctrlKey: true })]) {
      expect(ask(event, off)).toEqual({ kind: 'program', then: null });
    }
  });
});

describe('rule 3: Tab', () => {
  it('plain Tab and Shift+Tab produce nothing for the program', () => {
    expect(ask(key('Tab'))).toEqual({ kind: 'tab' });
    expect(ask(key('Tab', { shiftKey: true }))).toEqual({ kind: 'tab' });
  });
});

describe("rule 4: everything else is the program's", () => {
  it('delivers the keys the port added elsewhere: F1, F2, F3, F4, F5, Esc and every Shift+F<n>', () => {
    for (const event of [
      key('F1'),
      key('F2'),
      key('F3'),
      key('F4'),
      key('F5'),
      key('Escape'),
      key('F2', { shiftKey: true }),
      key('F3', { shiftKey: true }),
      key('F4', { shiftKey: true }),
      key('F5', { shiftKey: true }),
      key('F9', { shiftKey: true }),
      key('a'),
      key('Enter'),
    ]) {
      expect(ask(event), `${event.shiftKey ? 'Shift+' : ''}${event.key}`).toEqual({ kind: 'program', then: null });
    }
  });

  it('Alt+Enter is delivered and then toggles full screen', () => {
    expect(ask(fixture(WINDOWS_US, 'Alt+Enter'))).toEqual({ kind: 'program', then: 'fullscreen' });
    expect(ask(fixture(MAC_US, 'Option+Return'), { os: 'mac' })).toEqual({ kind: 'program', then: 'fullscreen' });
  });

  it('the paste chord is Shift+Insert on Windows and Linux and Cmd+V on macOS', () => {
    expect(ask(fixture(WINDOWS_US, 'Shift+Insert'))).toEqual({ kind: 'program', then: 'paste' });
    expect(ask(fixture(MAC_US, 'Cmd+V'), { os: 'mac' })).toEqual({ kind: 'program', then: 'paste' });
    // Ctrl+V is not a paste chord on Windows: the original delivers it as the character $16.
    expect(ask(key('v', { ctrlKey: true }))).toEqual({ kind: 'program', then: null });
  });

  it('Shift+Insert from the keypad (0 with NumLock off) is the paste chord too', () => {
    const shiftInsert = fixture(WINDOWS_KEYPAD, 'Shift + keypad 0, NumLock off: Shift+Insert');
    expect(ask(shiftInsert)).toEqual({ kind: 'program', then: 'paste' });
    expect(ask(shiftInsert, { keyCommands: false })).toEqual({ kind: 'program', then: null });
    // Insert alone, and the same key as a digit with NumLock on, are only keys of the program.
    expect(ask(fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock off: Insert'))).toEqual({ kind: 'program', then: null });
    expect(ask(fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock on: the digit 0'))).toEqual({ kind: 'program', then: null });
  });

  it('Ctrl+Tab moves to the next panel in the desktop app only', () => {
    expect(ask(fixture(WINDOWS_US, 'Ctrl+Tab'), { desktop: true })).toEqual({ kind: 'program', then: 'nextPanel' });
    expect(ask(fixture(WINDOWS_US, 'Ctrl+Tab'), { desktop: false })).toEqual({ kind: 'program', then: null });
  });

  it('after task 24 none of the three acts; the keys are only delivered', () => {
    const off = { keyCommands: false, desktop: true };
    expect(ask(fixture(WINDOWS_US, 'Alt+Enter'), off)).toEqual({ kind: 'program', then: null });
    expect(ask(fixture(WINDOWS_US, 'Shift+Insert'), off)).toEqual({ kind: 'program', then: null });
    expect(ask(fixture(WINDOWS_US, 'Ctrl+Tab'), off)).toEqual({ kind: 'program', then: null });
  });

  it('a modifier by itself is delivered like any key', () => {
    expect(ask(fixture(WINDOWS_US, 'Shift by itself'))).toEqual({ kind: 'program', then: null });
  });
});
