// The keys of the Output panel without an engine (ARCHITECTURE.md 2.9.4): which rule a key-down
// falls under, which events are cancelled, and what is passed on to the Output keyboard.
// engine.test.ts shows the same rules through 68000 programs.

import { describe, expect, it } from 'vitest';
import type { OutputKeyboardApi } from '../../contracts';
import type { Os } from '../../commands/chords';
import { PASTE_WAIT_MS, PanelInput, type PanelKeyEvent } from './panel-input';

type Key = PanelKeyEvent & { prevented: boolean };

function key(k: string, code: string, modifiers: Partial<PanelKeyEvent> = {}): Key {
  return {
    key: k,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...modifiers,
  };
}

function setup(options: { os?: Os; desktop?: boolean; keyCommands?: boolean; enabled?: boolean } = {}) {
  /** What reached the Output keyboard, as short texts. */
  const calls: string[] = [];
  const keyboard: OutputKeyboardApi = {
    keydown: (ev, pasteChord) => void calls.push(`down ${ev.key}${pasteChord ? ' (paste chord)' : ''}`),
    keyup: (ev) => void calls.push(`up ${ev.key}`),
    text: (composed) => void calls.push(`text ${JSON.stringify(composed)}`),
    paste: (text) => void calls.push(`paste ${JSON.stringify(text)}`),
    focusGained: () => void calls.push('focus'),
    focusLost: () => void calls.push('blur'),
    resetToStartup: () => {},
  };
  const ran: string[] = [];
  const timers: { delay: number; fn: () => void; cancelled: boolean }[] = [];
  const state = { keyCommands: options.keyCommands ?? true, waiting: false, toggles: 0, nextPanel: 0 };
  const input = new PanelInput({
    os: options.os ?? 'windows',
    desktop: options.desktop ?? false,
    keyboard: () => keyboard,
    keyCommandsEnabled: () => state.keyCommands,
    commands: {
      isEnabled: () => options.enabled ?? true,
      run: async (id) => void ran.push(id),
    },
    gesture: () => {
      const entered = state.waiting;
      state.waiting = false;
      return entered;
    },
    toggleFullScreen: () => void state.toggles++,
    nextPanel: () => void state.nextPanel++,
    setTimer(delay, fn) {
      const timer = { delay, fn, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  /** Runs the timers that were not cancelled. */
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
  };
  return { input, calls, ran, timers, state, fire, take: () => calls.splice(0) };
}

describe('rules 1 to 3: keys the program never sees', () => {
  it('rule 1: the release chord runs sim.output.releaseKeyboard, also after task 24', () => {
    for (const keyCommands of [true, false]) {
      const { input, calls, ran } = setup({ keyCommands });
      const chord = key('o', 'KeyO', { ctrlKey: true, altKey: true });
      expect(input.keydown(chord)).toEqual({ kind: 'release' });
      expect(chord.prevented).toBe(true);
      expect(ran).toEqual(['sim.output.releaseKeyboard']);
      expect(calls).toEqual([]);
    }
  });

  it('rule 2: a menu shortcut runs its command if that is enabled, and is cancelled either way', () => {
    for (const enabled of [true, false]) {
      const { input, calls, ran } = setup({ enabled });
      const f9 = key('F9', 'F9');
      expect(input.keydown(f9)).toEqual({ kind: 'command', id: 'sim.run.run', ran: enabled });
      expect(f9.prevented).toBe(true);
      expect(ran).toEqual(enabled ? ['sim.run.run'] : []);
      expect(calls).toEqual([]);
    }
  });

  it('rule 3: plain Tab and Shift+Tab are cancelled and go nowhere', () => {
    const { input, calls } = setup();
    for (const shiftKey of [false, true]) {
      const tab = key('Tab', 'Tab', { shiftKey });
      expect(input.keydown(tab)).toEqual({ kind: 'tab' });
      expect(tab.prevented).toBe(true);
    }
    expect(calls).toEqual([]);
  });
});

describe('rule 4: keys of the program', () => {
  it('are posted and cancelled', () => {
    const { input, take } = setup();
    for (const event of [key('a', 'KeyA'), key('F2', 'F2'), key('Escape', 'Escape'), key('ArrowUp', 'ArrowUp')]) {
      expect(input.keydown(event)).toEqual({ kind: 'program', cancelled: true, then: null });
      expect(event.prevented).toBe(true);
    }
    expect(take()).toEqual(['down a', 'down F2', 'down Escape', 'down ArrowUp']);
  });

  it('are NOT cancelled when the browser has to make text of them', () => {
    const { input, take } = setup();
    const left = [
      key('Dead', 'Quote'),
      key('Process', 'KeyA'),
      key('Unidentified', ''),
      key('´x', 'KeyX'), // text of several characters
      key('a', 'KeyA', { isComposing: true }),
      key('a', 'KeyA', { keyCode: 229 }), // Safari's mark of a composition
    ];
    for (const event of left) {
      expect(input.keydown(event)).toEqual({ kind: 'program', cancelled: false, then: null });
      expect(event.prevented).toBe(false);
    }
    // During a composition the key is passed on without its letter.
    expect(take()).toEqual([
      'down Dead',
      'down Process',
      'down Unidentified',
      'down ´x',
      'down Process',
      'down Process',
    ]);
  });

  it('a chord typed during a composition is text, not a command', () => {
    const { input, ran } = setup();
    expect(input.keydown(key('F9', 'F9', { isComposing: true }))).toMatchObject({ kind: 'program', cancelled: false });
    expect(ran).toEqual([]);
  });

  it('Alt+Enter toggles full screen after the key was posted; Ctrl+Tab moves on in the desktop app', () => {
    const { input, state, take } = setup({ desktop: true });
    expect(input.keydown(key('Enter', 'Enter', { altKey: true }))).toEqual({
      kind: 'program',
      cancelled: true,
      then: 'fullscreen',
    });
    expect(state.toggles).toBe(1);
    expect(input.keydown(key('Tab', 'Tab', { ctrlKey: true }))).toEqual({
      kind: 'program',
      cancelled: true,
      then: 'nextPanel',
    });
    expect(state.nextPanel).toBe(1);
    expect(take()).toEqual(['down Enter', 'down Tab']);
  });

  it('the key that carries out a waiting full-screen request does not toggle it back', () => {
    const { input, state } = setup();
    state.waiting = true; // "Press any key or click to enter full screen"
    input.keydown(key('Enter', 'Enter', { altKey: true }));
    expect(state.toggles).toBe(0);
    input.keydown(key('Enter', 'Enter', { altKey: true }));
    expect(state.toggles).toBe(1);
  });

  it('after task 24 the three commands of the I/O window do not act; the keys are still posted', () => {
    const { input, state, timers, take } = setup({ keyCommands: false, desktop: true });
    const events = [
      key('Enter', 'Enter', { altKey: true }),
      key('Insert', 'Insert', { shiftKey: true }),
      key('Tab', 'Tab', { ctrlKey: true }),
      key('F9', 'F9'),
    ];
    for (const event of events) {
      expect(input.keydown(event)).toEqual({ kind: 'program', cancelled: true, then: null });
    }
    expect(state).toMatchObject({ toggles: 0, nextPanel: 0 });
    expect(timers).toEqual([]);
    expect(take()).toEqual(['down Enter', 'down Insert', 'down Tab', 'down F9']);
  });

  it('every key-up is posted and cancelled', () => {
    const { input, take } = setup();
    const ups = [key('Tab', 'Tab'), key('F9', 'F9'), key('Alt', 'AltLeft')];
    for (const event of ups) input.keyup(event);
    expect(ups.every((event) => event.prevented)).toBe(true);
    expect(take()).toEqual(['up Tab', 'up F9', 'up Alt']);
  });
});

describe('the paste chord', () => {
  const shiftInsert = () => key('Insert', 'Insert', { shiftKey: true });

  it('is not cancelled; the paste event delivers the text and stops the timer', () => {
    const { input, timers, fire, take } = setup();
    const chord = shiftInsert();
    expect(input.keydown(chord)).toEqual({ kind: 'program', cancelled: false, then: 'paste' });
    expect(chord.prevented).toBe(false);
    expect(timers.map((timer) => timer.delay)).toEqual([PASTE_WAIT_MS.browser]);
    input.paste('HELLO');
    fire();
    expect(take()).toEqual(['down Insert (paste chord)', 'paste "HELLO"']);
  });

  it('without a paste event (an empty clipboard) the timer sends the key alone', () => {
    const { input, fire, take } = setup();
    input.keydown(shiftInsert());
    fire();
    expect(take()).toEqual(['down Insert (paste chord)', 'paste ""']);
  });

  it('waits no time in a browser and a moment in the desktop app', () => {
    expect(PASTE_WAIT_MS.browser).toBe(0);
    const { input, timers } = setup({ desktop: true });
    input.keydown(shiftInsert());
    expect(timers.map((timer) => timer.delay)).toEqual([PASTE_WAIT_MS.desktop]);
    expect(PASTE_WAIT_MS.desktop).toBeGreaterThan(0);
  });

  it('macOS: Cmd+V', () => {
    const { input, take } = setup({ os: 'mac' });
    const chord = key('v', 'KeyV', { metaKey: true });
    expect(input.keydown(chord)).toMatchObject({ cancelled: false, then: 'paste' });
    expect(take()).toEqual(['down v (paste chord)']);
  });

  it('losing the focus stops the timer and tells the keyboard', () => {
    const { input, fire, take } = setup();
    input.keydown(shiftInsert());
    input.blur();
    fire();
    expect(take()).toEqual(['down Insert (paste chord)', 'blur']);
  });
});

describe("text pasted without the chord (the browser's own Paste command)", () => {
  it('goes to the keyboard, which types it in', () => {
    const { input, take } = setup();
    input.paste('abc');
    expect(take()).toEqual(['paste "abc"']);
  });

  it('after task 24 nothing is pasted: the original has no paste then', () => {
    const { input, take, state, fire } = setup();
    state.keyCommands = false;
    input.paste('abc');
    expect(take()).toEqual([]);

    // A chord whose key-down was taken while key commands were still on keeps its text.
    state.keyCommands = true;
    input.keydown(key('Insert', 'Insert', { shiftKey: true }));
    state.keyCommands = false;
    input.paste('late');
    fire();
    expect(take()).toEqual(['down Insert (paste chord)', 'paste "late"']);
  });
});

describe('the paste command (no key behind it)', () => {
  it('delivers the text as the chord does: key down with the text, key up', () => {
    const windows = setup();
    windows.input.pasteByCommand('HI');
    expect(windows.take()).toEqual(['down Insert (paste chord)', 'paste "HI"', 'up Insert']);
    const mac = setup({ os: 'mac' });
    mac.input.pasteByCommand('HI');
    expect(mac.take()).toEqual(['down v (paste chord)', 'paste "HI"', 'up v']);
  });

  it('desktop app: the paste event that follows Platform.pasteIntoFocus is the command`s', () => {
    const { input, fire, take } = setup({ desktop: true });
    input.expectPaste();
    input.paste('HI');
    expect(take()).toEqual(['down Insert (paste chord)', 'paste "HI"', 'up Insert']);
    // Only that one; and not after the wait has run out.
    input.paste('X');
    input.expectPaste();
    fire();
    input.paste('Y');
    expect(take()).toEqual(['paste "X"', 'paste "Y"']);
  });
});

describe('text and focus', () => {
  it('passes composed text on, with a line break as the Enter key; nothing for an empty textarea', () => {
    const { input, take } = setup();
    input.text('é');
    input.text('');
    input.text('ok\n');
    input.text('a\r\nb');
    expect(take()).toEqual(['text "é"', 'text "ok\\r"', 'text "a\\rb"']);
  });

  it('tells the keyboard about focus and blur', () => {
    const { input, take } = setup();
    input.focus();
    input.blur();
    expect(take()).toEqual(['focus', 'blur']);
  });
});
