// The keyboard dispatcher follows 2.9.1 on the Windows and the macOS key map (W3 acceptance,
// ARCHITECTURE.md 9.1), with the key and code pairs of key-fixtures.ts: Option chords
// (`key` 'ø' with `code` 'KeyO'), AltGr, QWERTZ, AZERTY and layouts without ASCII letters.

import { describe, expect, it } from 'vitest';
import type { CommandId, Mode } from '../contracts';
import type { KeyEventLike, Os } from './chords';
import {
  MAC_RUSSIAN,
  MAC_US,
  WINDOWS_FRENCH,
  WINDOWS_GERMAN,
  WINDOWS_GREEK,
  WINDOWS_KEYPAD,
  WINDOWS_RUSSIAN,
  WINDOWS_US,
  fixture,
  type KeyFixture,
} from './key-fixtures';
import {
  buildBindings,
  createKeyDispatcher,
  hasProgramKeys,
  isTextEntry,
  type DispatchEvent,
  type KeyOutcome,
} from './keymap';
import { COMMAND_SPECS } from './specs';

/** A page element as far as the dispatcher looks at it. */
function element(tagName: string, options: { type?: string; editable?: boolean; inside?: string[] } = {}) {
  return {
    tagName,
    type: options.type,
    isContentEditable: options.editable ?? false,
    closest: (selector: string) => ((options.inside ?? []).some((own) => selector.includes(own)) ? {} : null),
  };
}

const BUTTON = element('BUTTON');
const TEXT_FIELD = element('INPUT', { type: 'text' });
const EDITOR = element('DIV', { editable: true });
const OUTPUT_TEXTAREA = element('TEXTAREA', { inside: ['[data-e68-keys="program"]'] });
const MENU_ITEM = element('DIV', { inside: ['[role="menu"]'] });
const DIALOG_FIELD = element('INPUT', { type: 'text', inside: ['[role="dialog"]'] });

interface Sent {
  outcome: KeyOutcome;
  prevented: boolean;
  stopped: boolean;
}

/** An application as the dispatcher sees it. */
function harness(
  options: {
    os?: Os;
    desktop?: boolean;
    mode?: Mode;
    /** Commands that have a handler and are enabled; default: all. */
    enabled?: (id: CommandId) => boolean;
  } = {},
) {
  const state = {
    mode: options.mode ?? ('editor' as Mode),
    modal: false,
    keyCommands: true,
    ran: [] as CommandId[],
    menusOpened: [] as string[],
    menuLetters: 'fepowh',
  };
  const dispatcher = createKeyDispatcher({
    os: options.os ?? 'windows',
    desktop: options.desktop ?? false,
    mode: () => state.mode,
    keyCommandsEnabled: () => state.keyCommands,
    isModalOpen: () => state.modal,
    commands: {
      isEnabled: (id) => (options.enabled ? options.enabled(id) : true),
      run: async (id) => {
        state.ran.push(id);
      },
    },
    openMenu: (letter) => {
      if (!state.menuLetters.includes(letter)) return false;
      state.menusOpened.push(letter);
      return true;
    },
  });
  const send = (key: KeyEventLike, target: unknown = BUTTON, extra: Partial<DispatchEvent> = {}): Sent => {
    const sent = { prevented: false, stopped: false };
    const event: DispatchEvent = {
      ...key,
      target,
      preventDefault: () => {
        sent.prevented = true;
      },
      stopPropagation: () => {
        sent.stopped = true;
      },
      ...extra,
    };
    return { outcome: dispatcher.handle(event), ...sent };
  };
  return { state, send };
}

const win = (name: string) => fixture(WINDOWS_US, name);
const mac = (name: string) => fixture(MAC_US, name);

describe('step 3: a bound, enabled command runs and the event is cancelled', () => {
  it.each<[string, KeyFixture, Mode, CommandId]>([
    ['Ctrl+O opens a file in the editor', win('Ctrl+O'), 'editor', 'ed.file.open'],
    ['Ctrl+O opens a program in the simulator', win('Ctrl+O'), 'simulator', 'sim.file.open'],
    ['Ctrl+S', win('Ctrl+S'), 'editor', 'ed.file.save'],
    ['Ctrl+Alt+Z is Redo', win('Ctrl+Alt+Z'), 'editor', 'ed.edit.redo'],
    ['Ctrl+Alt+C comments', win('Ctrl+Alt+C'), 'editor', 'ed.edit.comment'],
    ['F9 assembles', win('F9'), 'editor', 'ed.project.assemble'],
    ['F9 runs', win('F9'), 'simulator', 'sim.run.run'],
    ['Ctrl+F9 runs to the cursor', win('Ctrl+F9'), 'simulator', 'sim.run.runToCursor'],
    ['Shift+F4 starts the log', win('Shift+F4'), 'simulator', 'sim.run.logStart'],
    ['Insert toggles Insert/Replace', win('Insert'), 'editor', 'ed.edit.toggleInsert'],
    [
      'Insert on the keypad (0 with NumLock off) toggles Insert/Replace',
      fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock off: Insert'),
      'editor',
      'ed.edit.toggleInsert',
    ],
    [
      'Shift+Insert on the keypad pastes when no text field has the focus',
      fixture(WINDOWS_KEYPAD, 'Shift + keypad 0, NumLock off: Shift+Insert'),
      'editor',
      'ed.edit.paste',
    ],
    ['Ctrl+Shift+. indents', win('Ctrl+Shift+. (types >)'), 'editor', 'ed.edit.indent'],
    ['Ctrl+Shift+, outdents', win('Ctrl+Shift+, (types <)'), 'editor', 'ed.edit.outdent'],
    [
      'QWERTZ: Ctrl + the key labelled Z is Undo',
      fixture(WINDOWS_GERMAN, 'Ctrl+Z (the key labelled Z, at the US Y position)'),
      'editor',
      'ed.edit.undo',
    ],
    [
      'QWERTZ: Redo is Ctrl+Alt + the key labelled Z',
      fixture(WINDOWS_GERMAN, 'Ctrl+Alt + key labelled Z'),
      'editor',
      'ed.edit.redo',
    ],
    [
      'QWERTZ: Comment is Ctrl+Alt + the key labelled C',
      fixture(WINDOWS_GERMAN, 'Ctrl+Alt + key labelled C'),
      'editor',
      'ed.edit.comment',
    ],
    [
      'QWERTZ: Uncomment is Ctrl+Alt + the key labelled U',
      fixture(WINDOWS_GERMAN, 'Ctrl+Alt + key labelled U'),
      'editor',
      'ed.edit.uncomment',
    ],
    [
      'AZERTY: Redo is Ctrl+Alt + the key labelled Z',
      fixture(WINDOWS_FRENCH, 'Ctrl+Alt + key labelled Z (at the US W position)'),
      'editor',
      'ed.edit.redo',
    ],
    [
      'AZERTY: Ctrl + the key labelled A is Select All',
      fixture(WINDOWS_FRENCH, 'Ctrl+A (at the US Q position)'),
      'editor',
      'ed.edit.selectAll',
    ],
    ['Russian: the O position opens', fixture(WINDOWS_RUSSIAN, 'Ctrl+O position (types щ)'), 'editor', 'ed.file.open'],
    ['Russian: the S position saves', fixture(WINDOWS_RUSSIAN, 'Ctrl+S position (types ы)'), 'editor', 'ed.file.save'],
    [
      'Russian: Ctrl+Alt + the C position comments',
      fixture(WINDOWS_RUSSIAN, 'Ctrl+Alt+C position (types с)'),
      'editor',
      'ed.edit.comment',
    ],
    ['Russian: F7 traces', fixture(WINDOWS_RUSSIAN, 'F7'), 'simulator', 'sim.run.traceInto'],
    [
      'Greek: the F position finds',
      fixture(WINDOWS_GREEK, 'Ctrl+F position (types φ)'),
      'simulator',
      'sim.search.find',
    ],
    [
      'Greek: the G position goes to the PC',
      fixture(WINDOWS_GREEK, 'Ctrl+G position (types γ)'),
      'simulator',
      'sim.search.gotoPC',
    ],
  ])('Windows: %s', (_name, key, mode, command) => {
    const app = harness({ os: 'windows', mode });
    const sent = app.send(key);
    expect(sent.outcome).toEqual({ kind: 'run', command });
    expect(app.state.ran).toEqual([command]);
    expect(sent.prevented).toBe(true);
    expect(sent.stopped).toBe(true);
  });

  it.each<[string, KeyFixture, Mode, CommandId]>([
    ['Cmd+O', mac('Cmd+O'), 'editor', 'ed.file.open'],
    ['Ctrl+O works too (K2)', mac('Ctrl+O'), 'editor', 'ed.file.open'],
    ['Shift+Cmd+S is Save As', mac('Shift+Cmd+S'), 'editor', 'ed.file.saveAs'],
    ['Shift+Cmd+Z is Redo', mac('Shift+Cmd+Z'), 'editor', 'ed.edit.redo'],
    ['Ctrl+Option+Z is Redo: key Ω, code KeyZ', mac('Ctrl+Option+Z (Ω)'), 'editor', 'ed.edit.redo'],
    ['Ctrl+Option+C comments: key ç, code KeyC', mac('Ctrl+Option+C (ç)'), 'editor', 'ed.edit.comment'],
    ['Ctrl+Option+U uncomments: a dead key', mac('Ctrl+Option+U (dead key: umlaut)'), 'editor', 'ed.edit.uncomment'],
    ['Cmd+/ comments', mac('Cmd+/'), 'editor', 'ed.edit.comment'],
    ['Shift+Cmd+/ uncomments: key ?', mac('Shift+Cmd+/ (types ?)'), 'editor', 'ed.edit.uncomment'],
    ['Cmd+G is Find Next', mac('Cmd+G'), 'editor', 'ed.edit.findNext'],
    ['Cmd+G is Go to PC in the simulator', mac('Cmd+G'), 'simulator', 'sim.search.gotoPC'],
    ['Cmd+B assembles', mac('Cmd+B'), 'editor', 'ed.project.assemble'],
    ['Ctrl+R is Find And Replace', mac('Ctrl+R'), 'editor', 'ed.edit.replace'],
    ['Ctrl+Shift+I toggles Insert/Replace', mac('Ctrl+Shift+I'), 'editor', 'ed.edit.toggleInsert'],
    ['Shift+F2 rewinds', mac('Shift+F2'), 'simulator', 'sim.run.rewind'],
    ['Ctrl+F9 runs to the cursor', mac('Ctrl+F9'), 'simulator', 'sim.run.runToCursor'],
    ['Russian layout: Cmd + the O position', fixture(MAC_RUSSIAN, 'Cmd+O position'), 'simulator', 'sim.file.open'],
    [
      'Russian layout: Ctrl + the O position',
      fixture(MAC_RUSSIAN, 'Ctrl+O position (types щ)'),
      'simulator',
      'sim.file.open',
    ],
  ])('macOS: %s', (_name, key, mode, command) => {
    const app = harness({ os: 'mac', mode });
    const sent = app.send(key);
    expect(sent.outcome).toEqual({ kind: 'run', command });
    expect(sent.prevented).toBe(true);
  });

  it('F4 switches the mode in every mode', () => {
    for (const mode of ['editor', 'simulator', 'easybin'] as const) {
      const app = harness({ mode });
      const f4 = { key: 'F4', code: 'F4', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
      expect(app.send(f4).outcome).toEqual({ kind: 'run', command: 'app.mode.next' });
    }
  });

  it('F1 runs context help where that is enabled, otherwise the help contents', () => {
    const inEditor = harness({ mode: 'editor' });
    expect(inEditor.send(win('F1')).outcome).toEqual({ kind: 'run', command: 'ed.help.context' });
    const onFrame = harness({ mode: 'editor', enabled: (id) => id !== 'ed.help.context' });
    expect(onFrame.send(win('F1')).outcome).toEqual({ kind: 'run', command: 'ed.help.help' });
  });

  it('F1 in EASyBIN mode runs EASyBIN Help (docs/requests/B1-keys.md)', () => {
    for (const os of ['windows', 'mac'] as const) {
      const app = harness({ mode: 'easybin', os });
      // F1 is the same key-down on both key maps.
      expect(app.send(win('F1')).outcome, os).toEqual({
        kind: 'run',
        command: 'bin.help.help',
      });
    }
  });

  it('a command of another mode is not bound', () => {
    const app = harness({ mode: 'easybin' });
    expect(app.send(win('F9')).outcome).toEqual({ kind: 'none' });
    expect(app.send(win('Ctrl+Alt+Z')).outcome).toEqual({ kind: 'none' });
    expect(app.state.ran).toEqual([]);
  });

  it('an Option chord that no command uses stays text: Option+O types ø', () => {
    const app = harness({ os: 'mac', mode: 'editor' });
    const sent = app.send(mac('Option+O (types ø)'), EDITOR);
    expect(sent.outcome).toEqual({ kind: 'none' });
    expect(sent.prevented).toBe(false);
  });

  it('AltGr characters that are no chord of the mode stay text: German AltGr+Q types @', () => {
    const sent = harness({ mode: 'editor' }).send(fixture(WINDOWS_GERMAN, 'AltGr+Q (types @)'), EDITOR);
    expect(sent.outcome).toEqual({ kind: 'none' });
    expect(sent.prevented).toBe(false);
    const french = harness({ mode: 'editor' }).send(
      fixture(WINDOWS_FRENCH, 'AltGr + the key labelled 0 (types @)'),
      EDITOR,
    );
    expect(french).toEqual({ outcome: { kind: 'none' }, prevented: false, stopped: false });
  });

  it('QWERTZ and AZERTY: Ctrl+Alt at the US Z position is not Redo when its label is another letter', () => {
    const app = harness({ os: 'windows', mode: 'editor' });
    expect(app.send(fixture(WINDOWS_GERMAN, 'Ctrl+Alt + key labelled Y'), EDITOR).outcome).toEqual({ kind: 'none' });
    expect(
      app.send(fixture(WINDOWS_FRENCH, 'Ctrl+Alt + key labelled W (at the US Z position)'), EDITOR).outcome,
    ).toEqual({ kind: 'none' });
    expect(app.state.ran).toEqual([]);
  });
});

describe('step 4: a bound but disabled command cancels the event and does nothing', () => {
  it('without a handler nothing runs and the browser does not act either', () => {
    const app = harness({ mode: 'editor', enabled: () => false });
    for (const name of ['Ctrl+S', 'Ctrl+O', 'F9', 'Ctrl+Alt+Z']) {
      const sent = app.send(win(name));
      expect(sent.outcome.kind, name).toBe('disabled');
      expect(sent.prevented, name).toBe(true);
    }
    expect(app.state.ran).toEqual([]);
  });
});

describe('desktop-only chords (2.9.3)', () => {
  it('do nothing in a browser, where the browser owns them', () => {
    const web = harness({ os: 'mac', mode: 'editor', desktop: false });
    for (const name of ['Cmd+W', 'Cmd+Q', 'Cmd+N', 'Cmd+,', 'Cmd+R']) {
      const sent = web.send(mac(name));
      expect(sent.outcome, name).toEqual({ kind: 'none' });
      expect(sent.prevented, name).toBe(false);
    }
    for (const os of ['windows', 'linux'] as const) {
      const sim = harness({ os, mode: 'simulator', desktop: false });
      expect(sim.send(win('Ctrl+F4')).outcome, os).toEqual({ kind: 'none' });
      expect(sim.send(win('Ctrl+Tab')).outcome, os).toEqual({ kind: 'none' });
    }
    expect(harness({ os: 'mac', mode: 'simulator' }).send(win('Ctrl+Tab')).outcome).toEqual({ kind: 'none' });
  });

  it('Ctrl+F4 is not one of them on macOS: no browser there uses it, and it is Log Start', () => {
    // 2.9.3 reserves Ctrl+F4 for the browsers of Windows and Linux. On macOS it is a system
    // shortcut like Ctrl+F2, F3 and F5: where the system delivers the key, the original's chord acts.
    for (const desktop of [false, true]) {
      const sim = harness({ os: 'mac', mode: 'simulator', desktop });
      const sent = sim.send(mac('Ctrl+F4'));
      expect(sent.outcome, `desktop ${desktop}`).toEqual({ kind: 'run', command: 'sim.run.logStart' });
      expect(sent.prevented).toBe(true);
      expect(sim.send(mac('Shift+F4')).outcome).toEqual({ kind: 'run', command: 'sim.run.logStart' });
      expect(sim.send(mac('Ctrl+F2')).outcome).toEqual({ kind: 'run', command: 'sim.run.rewind' });
    }
  });

  it('run in the desktop app', () => {
    const app = harness({ os: 'mac', mode: 'editor', desktop: true });
    expect(app.send(mac('Cmd+W')).outcome).toEqual({ kind: 'run', command: 'ed.file.close' });
    expect(app.send(mac('Cmd+Q')).outcome).toEqual({ kind: 'run', command: 'ed.file.exit' });
    expect(app.send(mac('Cmd+N')).outcome).toEqual({ kind: 'run', command: 'app.window.new' });
    expect(app.send(mac('Cmd+,')).outcome).toEqual({ kind: 'run', command: 'ed.options.editor' });
    expect(app.send(mac('Cmd+R')).outcome).toEqual({ kind: 'run', command: 'ed.edit.replace' });
    const sim = harness({ os: 'windows', mode: 'simulator', desktop: true });
    expect(sim.send(win('Ctrl+F4')).outcome).toEqual({ kind: 'run', command: 'sim.run.logStart' });
    expect(sim.send(win('Ctrl+Tab')).outcome).toEqual({ kind: 'run', command: 'sim.panel.next' });
  });
});

describe('step 1: a modal dialog is open', () => {
  it('no command runs, from any chord', () => {
    const app = harness({ mode: 'simulator' });
    app.state.modal = true;
    for (const name of ['F9', 'Ctrl+O', 'Shift+F4', 'F1']) {
      expect(app.send(win(name), DIALOG_FIELD).outcome.kind, name).toBe('modal');
    }
    expect(app.state.ran).toEqual([]);
  });

  it('the dialog keeps its keys: nothing is cancelled except the guarded chords', () => {
    const app = harness({ mode: 'editor' });
    app.state.modal = true;
    const enter = { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(app.send(enter, DIALOG_FIELD)).toMatchObject({
      outcome: { kind: 'modal', cancelled: false },
      prevented: false,
    });
    expect(app.send(win('Ctrl+Alt+Z'), DIALOG_FIELD).prevented).toBe(false);
    // The browser must not open its own dialogs behind ours.
    expect(app.send(win('Ctrl+S'), DIALOG_FIELD)).toMatchObject({
      outcome: { kind: 'modal', cancelled: true },
      prevented: true,
    });
  });
});

describe('step 2: the Output panel has the keyboard', () => {
  it('the dispatcher does nothing at all, not even for F9 or F5', () => {
    const app = harness({ mode: 'simulator' });
    const f5 = { key: 'F5', code: 'F5', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    for (const key of [win('F9'), win('Ctrl+O'), win('Shift+F4'), win('Ctrl+Alt+O'), f5]) {
      const sent = app.send(key, OUTPUT_TEXTAREA);
      expect(sent).toEqual({ outcome: { kind: 'output' }, prevented: false, stopped: false });
    }
    expect(app.state.ran).toEqual([]);
    expect(hasProgramKeys(OUTPUT_TEXTAREA)).toBe(true);
    expect(hasProgramKeys(TEXT_FIELD)).toBe(false);
  });

  it('the chords of the Output panel itself do nothing in other panels', () => {
    const app = harness({ mode: 'simulator' });
    expect(app.send(win('Alt+Enter')).outcome).toEqual({ kind: 'none' });
    expect(app.send(win('Ctrl+Alt+O')).outcome).toEqual({ kind: 'none' });
    expect(app.send(win('Shift+Insert'), TEXT_FIELD).outcome).toEqual({ kind: 'none' });
    const macApp = harness({ os: 'mac', mode: 'simulator' });
    expect(macApp.send(mac('Option+Return')).outcome).toEqual({ kind: 'none' });
    expect(macApp.send(mac('Ctrl+Option+O (ø)')).outcome).toEqual({ kind: 'none' });
  });
});

describe('TRAP #15 task 24 has switched key commands off', () => {
  it('the eleven shortcuts, F1 and the panel cycle do nothing but are still cancelled', () => {
    const app = harness({ mode: 'simulator' });
    app.state.keyCommands = false;
    const f2 = { key: 'F2', code: 'F2', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    for (const key of [win('F9'), win('Ctrl+O'), win('Ctrl+F9'), win('Shift+F4'), win('F1'), f2]) {
      const sent = app.send(key);
      expect(sent.outcome.kind, key.code).toBe('disabled');
      expect(sent.prevented, key.code).toBe(true);
    }
    expect(app.state.ran).toEqual([]);
  });

  it('Find and Go to PC keep their shortcuts', () => {
    const app = harness({ mode: 'simulator' });
    app.state.keyCommands = false;
    const ctrl = (letter: string) => ({
      key: letter.toLowerCase(),
      code: `Key${letter}`,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      metaKey: false,
    });
    expect(app.send(ctrl('F')).outcome).toEqual({ kind: 'run', command: 'sim.search.find' });
    expect(app.send(ctrl('G')).outcome).toEqual({ kind: 'run', command: 'sim.search.gotoPC' });
  });

  it('does not affect the editor', () => {
    const app = harness({ mode: 'editor' });
    app.state.keyCommands = false;
    expect(app.send(win('F9')).outcome).toEqual({ kind: 'run', command: 'ed.project.assemble' });
  });
});

describe('text-editing chords', () => {
  it('are left to a text field or the editor that has the focus', () => {
    const app = harness({ mode: 'editor' });
    for (const target of [TEXT_FIELD, EDITOR, element('TEXTAREA')]) {
      for (const name of ['Ctrl+Z', 'Shift+Insert']) {
        const sent = app.send(win(name), target);
        expect(sent.outcome.kind, name).toBe('text');
        expect(sent.prevented, name).toBe(false);
        expect(sent.stopped, name).toBe(false);
      }
    }
    const onMac = harness({ os: 'mac', mode: 'editor' });
    expect(onMac.send(mac('Cmd+V'), EDITOR).outcome.kind).toBe('text');
    expect(onMac.send(mac('Shift+Cmd+Z'), TEXT_FIELD).outcome.kind).toBe('text');
    expect(app.state.ran).toEqual([]);
  });

  it('Shift+Insert from the keypad (0 with NumLock off) is the paste chord of a text field too', () => {
    const app = harness({ mode: 'editor' });
    const key = fixture(WINDOWS_KEYPAD, 'Shift + keypad 0, NumLock off: Shift+Insert');
    for (const target of [TEXT_FIELD, EDITOR]) {
      expect(app.send(key, target)).toEqual({
        outcome: { kind: 'text', command: 'ed.edit.paste' },
        prevented: false,
        stopped: false,
      });
    }
    // With NumLock on the same key types a digit and is no chord at all.
    expect(app.send(fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock on: the digit 0'), EDITOR).outcome).toEqual({
      kind: 'none',
    });
    expect(app.state.ran).toEqual([]);
  });

  it('run the command when the focus is elsewhere', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Ctrl+Z'), BUTTON).outcome).toEqual({ kind: 'run', command: 'ed.edit.undo' });
    expect(app.send(win('Ctrl+Z'), element('INPUT', { type: 'checkbox' })).outcome.kind).toBe('run');
  });

  it('the Alt forms are commands everywhere: Ctrl+Alt+Z is Redo in a text field too', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Ctrl+Alt+Z'), TEXT_FIELD).outcome).toEqual({ kind: 'run', command: 'ed.edit.redo' });
    const onMac = harness({ os: 'mac', mode: 'editor' });
    expect(onMac.send(mac('Ctrl+Option+Z (Ω)'), EDITOR).outcome).toEqual({ kind: 'run', command: 'ed.edit.redo' });
  });

  it('other commands run from a text field as well', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Ctrl+S'), EDITOR).outcome).toEqual({ kind: 'run', command: 'ed.file.save' });
    expect(app.send(win('F9'), TEXT_FIELD).outcome).toEqual({ kind: 'run', command: 'ed.project.assemble' });
  });

  it('isTextEntry knows text inputs, text areas and editable content', () => {
    expect(isTextEntry(TEXT_FIELD)).toBe(true);
    expect(isTextEntry(element('INPUT'))).toBe(true);
    expect(isTextEntry(element('INPUT', { type: 'search' }))).toBe(true);
    expect(isTextEntry(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTextEntry(element('TEXTAREA'))).toBe(true);
    expect(isTextEntry(EDITOR)).toBe(true);
    expect(isTextEntry(BUTTON)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe('editor keys: Insert, Ctrl+Shift+. and Ctrl+Shift+, (EDITOR_FOCUS_COMMANDS)', () => {
  const editorFocus: CommandId[] = ['ed.edit.toggleInsert', 'ed.edit.indent', 'ed.edit.outdent'];
  /** Their handlers are enabled only while the editor has the focus. */
  const outsideEditor = (id: CommandId) => !editorFocus.includes(id);

  it('reach a text field outside the editor while the command is disabled', () => {
    const app = harness({ mode: 'editor', enabled: outsideEditor });
    const keys: [KeyFixture, CommandId][] = [
      [win('Insert'), 'ed.edit.toggleInsert'],
      [fixture(WINDOWS_KEYPAD, 'keypad 0, NumLock off: Insert'), 'ed.edit.toggleInsert'],
      [win('Ctrl+Shift+. (types >)'), 'ed.edit.indent'],
      [win('Ctrl+Shift+, (types <)'), 'ed.edit.outdent'],
      [fixture(WINDOWS_GERMAN, 'Ctrl+Shift+. (types :)'), 'ed.edit.indent'],
    ];
    for (const target of [TEXT_FIELD, element('TEXTAREA'), DIALOG_FIELD]) {
      for (const [key, command] of keys) {
        expect(app.send(key, target), key.name).toEqual({
          outcome: { kind: 'text', command },
          prevented: false,
          stopped: false,
        });
      }
    }
    const onMac = harness({ os: 'mac', mode: 'editor', enabled: outsideEditor });
    expect(onMac.send(mac('Ctrl+Shift+I'), TEXT_FIELD)).toEqual({
      outcome: { kind: 'text', command: 'ed.edit.toggleInsert' },
      prevented: false,
      stopped: false,
    });
    expect(app.state.ran).toEqual([]);
  });

  it('run in the editor, where the handler is enabled', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Insert'), EDITOR)).toEqual({
      outcome: { kind: 'run', command: 'ed.edit.toggleInsert' },
      prevented: true,
      stopped: true,
    });
    expect(app.send(win('Ctrl+Shift+. (types >)'), EDITOR).outcome).toEqual({ kind: 'run', command: 'ed.edit.indent' });
    expect(app.state.ran).toEqual(['ed.edit.toggleInsert', 'ed.edit.indent']);
  });

  it('are cancelled as before (step 4) when disabled and the focus is not in a text field', () => {
    const app = harness({ mode: 'editor', enabled: outsideEditor });
    expect(app.send(win('Insert'), BUTTON)).toEqual({
      outcome: { kind: 'disabled', command: 'ed.edit.toggleInsert' },
      prevented: true,
      stopped: true,
    });
    expect(app.send(win('Ctrl+Shift+, (types <)'), BUTTON).outcome.kind).toBe('disabled');
  });

  it('other disabled commands are still cancelled in a text field', () => {
    const app = harness({ mode: 'editor', enabled: () => false });
    expect(app.send(win('F9'), TEXT_FIELD)).toMatchObject({ outcome: { kind: 'disabled' }, prevented: true });
    expect(app.send(win('Ctrl+Alt+C'), TEXT_FIELD)).toMatchObject({ outcome: { kind: 'disabled' }, prevented: true });
  });
});

describe('guarded chords (2.9.3): the browser never acts on them', () => {
  const f5 = { key: 'F5', code: 'F5', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
  const ctrl = (letter: string) => ({
    key: letter.toLowerCase(),
    code: `Key${letter}`,
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });
  const cmd = (letter: string) => ({
    key: letter.toLowerCase(),
    code: `Key${letter}`,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: true,
  });
  const fkey = (n: number) => ({
    key: `F${n}`,
    code: `F${n}`,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
  });

  it.each(['editor', 'simulator', 'easybin'] as const)(
    'F5, F6, F7, F10 and Ctrl+O/S/P/F/G/R are cancelled in %s mode',
    (mode) => {
      const app = harness({ mode, enabled: () => false });
      for (const key of [f5, fkey(6), fkey(7), fkey(10), ...['O', 'S', 'P', 'F', 'G', 'R'].map(ctrl)]) {
        expect(app.send(key).prevented, `${key.key} ${key.code}`).toBe(true);
        expect(app.send(key, EDITOR).prevented, `${key.key} in the editor`).toBe(true);
      }
      expect(app.state.ran).toEqual([]);
    },
  );

  it('a guarded chord without a command is cancelled but not stopped: the element still sees it', () => {
    const sent = harness({ mode: 'editor' }).send(f5, TEXT_FIELD);
    expect(sent).toEqual({ outcome: { kind: 'guarded' }, prevented: true, stopped: false });
  });

  it('macOS guards the Cmd forms too, except Cmd+R in a browser', () => {
    const app = harness({ os: 'mac', mode: 'easybin', enabled: () => false });
    for (const letter of ['O', 'S', 'P', 'F', 'G']) expect(app.send(cmd(letter)).prevented, letter).toBe(true);
    expect(app.send(cmd('R')).prevented).toBe(false);
  });

  it('other keys are not touched', () => {
    const app = harness({ mode: 'editor' });
    for (const key of [win('a plain letter'), fkey(11), fkey(12), ctrl('T'), ctrl('W'), ctrl('N')]) {
      expect(app.send(key)).toEqual({ outcome: { kind: 'none' }, prevented: false, stopped: false });
    }
  });
});

describe('menus', () => {
  it('Alt+letter opens the menu with that access key on Windows and Linux', () => {
    const app = harness({ os: 'windows', mode: 'editor' });
    const sent = app.send(win('Alt+F (menu access key)'));
    expect(sent).toEqual({ outcome: { kind: 'openMenu' }, prevented: true, stopped: true });
    expect(app.state.menusOpened).toEqual(['f']);
  });

  it('leaves Alt+letter alone when no menu has the letter, in a dialog, and on macOS', () => {
    const altX = { key: 'x', code: 'KeyX', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false };
    expect(harness({ mode: 'editor' }).send(altX).outcome).toEqual({ kind: 'none' });
    expect(harness({ mode: 'editor' }).send(win('Alt+F (menu access key)'), DIALOG_FIELD).outcome).toEqual({
      kind: 'none',
    });
    const onMac = harness({ os: 'mac', mode: 'editor' });
    expect(onMac.send({ ...win('Alt+F (menu access key)'), key: 'ƒ' }).outcome).toEqual({ kind: 'none' });
    expect(onMac.state.menusOpened).toEqual([]);
  });

  it('no command runs while the focus is in a menu', () => {
    const app = harness({ mode: 'simulator' });
    expect(app.send(win('F9'), MENU_ITEM)).toMatchObject({ outcome: { kind: 'menu' }, prevented: false });
    expect(app.send(win('Ctrl+O'), MENU_ITEM)).toMatchObject({
      outcome: { kind: 'menu', cancelled: true },
      prevented: true,
    });
    expect(app.state.ran).toEqual([]);
  });
});

describe('composition and bare modifiers', () => {
  it('ignores keys of an input method', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Ctrl+S'), EDITOR, { isComposing: true }).outcome).toEqual({ kind: 'composing' });
    expect(app.send({ ...win('F9'), key: 'Process' }, EDITOR, { keyCode: 229 }).outcome).toEqual({ kind: 'composing' });
    expect(app.state.ran).toEqual([]);
  });

  it('ignores a modifier pressed by itself', () => {
    const app = harness({ mode: 'editor' });
    expect(app.send(win('Control by itself')).outcome).toEqual({ kind: 'none' });
    expect(harness({ os: 'mac' }).send(mac('Command by itself')).outcome).toEqual({ kind: 'none' });
  });
});

describe('buildBindings', () => {
  it("binds every chord of every command of the platform, except the Output panel's own", () => {
    const bindings = buildBindings('windows', true);
    expect(bindings.get('Ctrl+O')).toEqual(['ed.file.open', 'sim.file.open', 'bin.file.openSrec']);
    expect(bindings.get('F1')).toEqual(['ed.help.context', 'ed.help.help', 'sim.help.context', 'bin.help.help']);
    expect(bindings.has('Alt+Enter')).toBe(false);
    expect(bindings.has('Ctrl+Alt+O')).toBe(false);
    for (const [chord, ids] of bindings) {
      for (const id of ids) expect(COMMAND_SPECS[id].keys.win, `${id} ${chord}`).toContain(chord);
    }
  });

  it('two commands of one mode never share a chord, except F1 in the editor', () => {
    for (const os of ['windows', 'mac'] as const) {
      for (const [chord, ids] of buildBindings(os, true)) {
        for (const mode of ['editor', 'simulator', 'easybin'] as const) {
          const here = ids.filter((id) => COMMAND_SPECS[id].mode === mode || COMMAND_SPECS[id].mode === 'app');
          if (here.length > 1)
            expect([os, mode, chord, here]).toEqual([os, 'editor', 'F1', ['ed.help.context', 'ed.help.help']]);
        }
      }
    }
  });
});
