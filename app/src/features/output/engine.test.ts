// The Output feature with the real simulator engine (engine/dist) under Node: 68000 programs
// observe what the panel's key and mouse handling delivers (ARCHITECTURE.md 2.9.4, 3.6, 4.3).
// Work package SH4, acceptance. The same rules are checked once more with real key events in
// Chromium and WebKit by check-output.mjs.
//
// The surface, the text screen and the run controller are small doubles here (testing/bed.ts);
// real-session.test.ts runs the same keyboard against the real three of the other packages.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ShiftBit, SimOption } from '../../contracts';
import { assembleProgram, createTestEngine } from '../../engine/testing';
import { panelVisible } from '../../state/panels';
import { shellStateOf } from '../../state/shell';
import type { FullScreenDriver } from './fullscreen';
import { outputOf } from './model';
import type { PanelKeyEvent, PanelKeyOutcome } from './panel-input';
import { createOutputBed, type BedOptions, type OutputBed } from './testing/bed';
import {
  CHARS,
  KEYS,
  LINES,
  MOUSE,
  PICTURE,
  charLoopProgram,
  keyWatchProgram,
  lineInputProgram,
  mouseWatchProgram,
  pictureProgram,
} from './testing/programs';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** Time limit of each test: the engines load and the assembler runs, on a busy machine. */
const SLOW = 60_000;

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

interface Rig extends OutputBed {
  /** Lets time pass: timers, frames and with them slices of the program. */
  settle(frames?: number): void;
  down(event: Key): PanelKeyOutcome;
  up(event: Key): void;
  /** A key-down, time, the key-up, time. Returns what the key-down was. */
  press(event: Key): PanelKeyOutcome;
  /** The entries posted to the run controller since the last call. */
  posted(): unknown[];
}

async function rig(program: readonly string[], options: BedOptions = {}): Promise<Rig> {
  const bed = await createOutputBed(
    {
      createEngine: async (parts) => (await createTestEngine(parts)).engine,
      assemble: (source) => assembleProgram(source),
    },
    options,
  );
  bed.controller.start();
  await bed.load(program);
  const input = outputOf(bed.ctx).input;
  let seen = 0;
  const settle = (frames = 6) => {
    for (let i = 0; i < frames; i++) bed.time?.advance(16);
  };
  const self: Rig = Object.assign(bed, {
    settle,
    down: (event: Key) => input.keydown(event),
    up: (event: Key) => input.keyup(event),
    press(event: Key) {
      const outcome = input.keydown(event);
      settle();
      input.keyup(key(event.key, event.code));
      settle();
      return outcome;
    },
    posted() {
      const entries = bed.controller.delivered.slice(seen);
      seen = bed.controller.delivered.length;
      return entries;
    },
  });
  // The program runs and the panel has the keyboard, as after Run in the application.
  bed.run();
  input.focus();
  settle();
  self.posted();
  return self;
}

const downs = (r: Rig, vk: number) => r.byte(KEYS.downs + vk);
const ups = (r: Rig, vk: number) => r.byte(KEYS.ups + vk);

/** A full-screen driver that enters at once, like the desktop app's window. */
function instantDriver(): FullScreenDriver & { active: boolean } {
  const driver = {
    active: false,
    available: () => true,
    gestureActive: () => true,
    enter: async () => (driver.active = true),
    leave: async () => void (driver.active = false),
  };
  return driver;
}

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks sim68k or asm68k: run `npm run build:engines` first. ' +
      'Without the variable these tests are skipped.',
  );
});

describe.skipIf(!enginesBuilt)('keys while the Output panel has the keyboard (2.9.4)', () => {
  it(
    'rule 2: F9 runs Run and is not seen by task 19; its key-up is',
    async () => {
      const r = await rig(keyWatchProgram());
      const f9 = key('F9', 'F9');
      expect(r.down(f9)).toEqual({ kind: 'command', id: 'sim.run.run', ran: true });
      expect(f9.prevented).toBe(true);
      r.settle();
      expect(r.commandsRun).toEqual(['sim.run.run']);
      expect(downs(r, 0x78)).toBe(0);
      expect(ups(r, 0x78)).toBe(0);
      r.up(key('F9', 'F9'));
      r.settle();
      expect(downs(r, 0x78)).toBe(0);
      expect(ups(r, 0x78)).toBe(1);
    },
    SLOW,
  );

  it(
    'rule 2: every menu shortcut in the original spelling runs its command; none reaches the program',
    async () => {
      const r = await rig(keyWatchProgram());
      const ctrl = { ctrlKey: true };
      const chords: [Key, string, number][] = [
        [key('F6', 'F6'), 'sim.run.pause', 0x75],
        [key('F7', 'F7'), 'sim.run.traceInto', 0x76],
        [key('F8', 'F8'), 'sim.run.stepOver', 0x77],
        [key('F10', 'F10'), 'sim.run.autoTrace', 0x79],
        [key('o', 'KeyO', ctrl), 'sim.file.open', 0x4f],
        [key('F2', 'F2', ctrl), 'sim.run.rewind', 0x71],
        [key('F3', 'F3', ctrl), 'sim.run.reload', 0x72],
        [key('F9', 'F9', ctrl), 'sim.run.runToCursor', 0x78],
        [key('F4', 'F4', ctrl), 'sim.run.logStart', 0x73],
        [key('F5', 'F5', ctrl), 'sim.run.logStop', 0x74],
        [key('f', 'KeyF', ctrl), 'sim.search.find', 0x46],
        [key('g', 'KeyG', ctrl), 'sim.search.gotoPC', 0x47],
      ];
      for (const [event, id, vk] of chords) {
        r.commandsRun.length = 0;
        // Pause would stop the program that is watching: it is recorded without pausing here.
        r.disabledCommands.clear();
        if (id === 'sim.run.pause') r.disabledCommands.add(id);
        const outcome = r.press(event);
        expect(outcome, id).toEqual({ kind: 'command', id, ran: id !== 'sim.run.pause' });
        expect(event.prevented, id).toBe(true);
        expect(r.commandsRun, id).toEqual(id === 'sim.run.pause' ? [] : [id]);
        expect(downs(r, vk), `${id} key-down`).toBe(0);
        expect(ups(r, vk), `${id} key-up`).toBe(1);
      }
    },
    SLOW,
  );

  it(
    'rule 4: F2, F4 and Shift+F2 are seen by task 19 and run nothing',
    async () => {
      const r = await rig(keyWatchProgram());
      r.poke(KEYS.watch, [0x00, 0x00, 0x73, 0x71]); // watch F4 and F2
      const f2 = key('F2', 'F2');
      expect(r.down(f2)).toEqual({ kind: 'program', cancelled: true, then: null });
      expect(f2.prevented).toBe(true);
      r.settle();
      expect(downs(r, 0x71)).toBe(1);
      expect(r.long(KEYS.state)).toBe(0x000000ff); // F2 is down, F4 is not
      r.up(key('F2', 'F2'));
      r.settle();
      expect(r.long(KEYS.state)).toBe(0);
      expect(ups(r, 0x71)).toBe(1);

      r.press(key('F4', 'F4'));
      expect(downs(r, 0x73)).toBe(1);
      expect(r.long(KEYS.held)).toBe(0x0000ffff);

      // Shift+F2: the port's alternative for Rewind elsewhere, a key of the program here (K3).
      r.down(key('Shift', 'ShiftLeft', { shiftKey: true }));
      r.settle();
      r.press(key('F2', 'F2', { shiftKey: true }));
      expect(downs(r, 0x10)).toBe(1);

      expect(r.commandsRun).toEqual([]);
      expect(r.ctx.store.getState().mode).toBe('simulator'); // F4 did not switch the mode
      expect(shellStateOf(r.ctx).getState().focusRequest?.panel).toBe('output'); // F2 moved no focus (Run did)
    },
    SLOW,
  );

  it(
    'rule 4: Alt+Enter is seen by task 19 and by a key-down interrupt, and then toggles full screen',
    async () => {
      const r = await rig(keyWatchProgram({ keyDownInterrupt: true }));
      const driver = instantDriver();
      outputOf(r.ctx).attachDriver(driver);

      r.down(key('Alt', 'AltLeft', { altKey: true }));
      r.settle();
      const enter = key('Enter', 'Enter', { altKey: true });
      expect(r.down(enter)).toEqual({ kind: 'program', cancelled: true, then: 'fullscreen' });
      r.settle();
      await Promise.resolve();
      expect(downs(r, 0x0d)).toBe(1);
      expect(downs(r, 0x12)).toBe(1);
      expect(r.byte(KEYS.interruptDowns + 0x0d)).toBe(1); // the interrupt handler read it with task 19
      expect(r.long(KEYS.interrupts)).toBe(2); // Alt, then Enter
      expect(outputOf(r.ctx).fullScreen.phase).toBe('full');
      expect(driver.active).toBe(true);
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(1); // the panel told the engine
      expect(r.ctx.store.getState().sim.output.fullScreen).toBe(true);
      // No character: Alt+Enter is a system key on Windows.
      expect(r.posted()).toEqual([
        { kind: 'keyDown', vk: 0x12 },
        { kind: 'keyDown', vk: 0x0d },
      ]);

      // Again: back to the panel.
      r.up(key('Enter', 'Enter', { altKey: true }));
      r.down(key('Enter', 'Enter', { altKey: true }));
      r.settle();
      expect(outputOf(r.ctx).fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
    },
    SLOW,
  );

  it(
    'rule 4 with further modifiers: Shift+Alt+Enter and Ctrl+Alt+Enter toggle full screen; Ctrl+Shift+Insert pastes nothing',
    async () => {
      // The original tests "Alt is held" (Shift.Contains, simIOu.cpp:436), whatever else is held.
      const r = await rig(keyWatchProgram());
      const driver = instantDriver();
      outputOf(r.ctx).attachDriver(driver);
      const { fullScreen } = outputOf(r.ctx);

      expect(r.press(key('Enter', 'Enter', { altKey: true, shiftKey: true }))).toEqual({
        kind: 'program',
        cancelled: true,
        then: 'fullscreen',
      });
      await Promise.resolve();
      expect(fullScreen.phase).toBe('full');
      expect(downs(r, 0x0d)).toBe(1); // the program saw the key first

      expect(r.press(key('Enter', 'Enter', { altKey: true, ctrlKey: true }))).toMatchObject({ then: 'fullscreen' });
      expect(fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);

      // The paste chord cannot follow the rule in a browser: the key is a key of the program,
      // cancelled like every other, and no text is asked for (docs/differences/SH4.md).
      r.posted();
      const chord = key('Insert', 'Insert', { shiftKey: true, ctrlKey: true });
      expect(r.down(chord)).toEqual({ kind: 'program', cancelled: true, then: null });
      r.settle();
      expect(chord.prevented).toBe(true);
      expect(r.posted()).toEqual([{ kind: 'keyDown', vk: 0x2d }]);
    },
    SLOW,
  );

  it(
    'after task 24 the eleven shortcuts reach the program and only the release chord acts',
    async () => {
      const r = await rig(keyWatchProgram({ keyCommandsOff: true }));
      expect(r.engine.state().keyCommandsDisabled).toBe(true);
      expect(r.ctx.store.getState().sim.keyCommands).toBe(false);
      const ctrl = { ctrlKey: true };
      const eleven: [Key, number][] = [
        [key('F6', 'F6'), 0x75],
        [key('F7', 'F7'), 0x76],
        [key('F8', 'F8'), 0x77],
        [key('F9', 'F9'), 0x78],
        [key('F10', 'F10'), 0x79],
        [key('o', 'KeyO', ctrl), 0x4f],
        [key('F2', 'F2', ctrl), 0x71],
        [key('F3', 'F3', ctrl), 0x72],
        [key('F9', 'F9', ctrl), 0x78],
        [key('F4', 'F4', ctrl), 0x73],
        [key('F5', 'F5', ctrl), 0x74],
      ];
      for (const [event, vk] of eleven) {
        r.poke(KEYS.downs + vk, [0]);
        const outcome = r.press(event);
        const label = `${event.ctrlKey ? 'Ctrl+' : ''}${event.key}`;
        expect(outcome, label).toEqual({ kind: 'program', cancelled: true, then: null });
        expect(downs(r, vk), label).toBe(1);
      }
      // The I/O window's own three commands do not act either; the keys are delivered.
      const driver = instantDriver();
      outputOf(r.ctx).attachDriver(driver);
      expect(r.press(key('Enter', 'Enter', { altKey: true }))).toMatchObject({ then: null, cancelled: true });
      expect(r.press(key('Insert', 'Insert', { shiftKey: true }))).toMatchObject({ then: null, cancelled: true });
      expect(downs(r, 0x0d)).toBe(1);
      expect(downs(r, 0x2d)).toBe(1);
      expect(outputOf(r.ctx).fullScreen.phase).toBe('windowed');
      // Find and Go to PC keep their shortcuts in every case.
      expect(r.press(key('f', 'KeyF', ctrl))).toEqual({ kind: 'command', id: 'sim.search.find', ran: true });
      expect(r.commandsRun).toEqual(['sim.search.find']);

      // Ctrl+Alt+O: the one chord the port takes from programs. Nothing is delivered.
      r.posted();
      shellStateOf(r.ctx).setState((state) => ({ ...state, focusRequest: null }));
      const release = key('o', 'KeyO', { ctrlKey: true, altKey: true });
      expect(r.down(release)).toEqual({ kind: 'release' });
      expect(release.prevented).toBe(true);
      r.settle();
      expect(r.posted()).toEqual([]);
      expect(shellStateOf(r.ctx).getState().focusRequest).not.toBeNull(); // the focus moves on
      expect(downs(r, 0x4f)).toBe(1); // from Ctrl+O above, not from the release chord
    },
    SLOW,
  );

  it(
    'rule 3: plain Tab and Shift+Tab give the program no key-down and no character; the key-up arrives',
    async () => {
      const r = await rig(keyWatchProgram());
      for (const shiftKey of [false, true]) {
        const tab = key('Tab', 'Tab', { shiftKey });
        expect(r.down(tab)).toEqual({ kind: 'tab' });
        expect(tab.prevented).toBe(true);
      }
      r.settle();
      expect(r.posted()).toEqual([]);
      expect(downs(r, 0x09)).toBe(0);
      r.up(key('Tab', 'Tab'));
      r.settle();
      expect(ups(r, 0x09)).toBe(1);
    },
    SLOW,
  );

  it(
    'every key-up is posted and cancelled',
    async () => {
      const r = await rig(keyWatchProgram());
      const up = key('Alt', 'AltLeft');
      r.up(up);
      r.settle();
      expect(up.prevented).toBe(true);
      expect(ups(r, 0x12)).toBe(1);
    },
    SLOW,
  );

  it(
    'macOS: the release chord is Ctrl+Option+O by position, and Cmd+O is the Open shortcut',
    async () => {
      const r = await rig(keyWatchProgram(), { os: 'mac' });
      // Option changes the character: the O key reports 'ø'.
      expect(r.down(key('ø', 'KeyO', { ctrlKey: true, altKey: true }))).toEqual({ kind: 'release' });
      expect(r.press(key('o', 'KeyO', { metaKey: true }))).toEqual({ kind: 'command', id: 'sim.file.open', ran: true });
      expect(r.press(key('Enter', 'Enter', { altKey: true }))).toMatchObject({ kind: 'program', then: 'fullscreen' });
      expect(downs(r, 0x4f)).toBe(0);
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('text for the keyboard tasks (3.6)', () => {
  it(
    'typed characters, Ctrl+H as backspace and Enter fill a task 2 line',
    async () => {
      const r = await rig(lineInputProgram());
      expect(r.controller.phase).toBe('waitInput');
      for (const [k, code] of [
        ['H', 'KeyH'],
        ['i', 'KeyI'],
        ['x', 'KeyX'],
      ] as const) {
        r.press(key(k, code));
      }
      r.press(key('h', 'KeyH', { ctrlKey: true })); // Ctrl+H = $08: removes the x
      r.press(key('!', 'Digit1', { shiftKey: true }));
      expect(r.long(LINES.count)).toBe(0);
      r.press(key('Enter', 'Enter'));
      expect(r.long(LINES.count)).toBe(1);
      expect(r.string(LINES.text)).toBe('Hi!');
      expect(r.long(LINES.lengths)).toBe(3);
    },
    SLOW,
  );

  it(
    'a dead-key sequence and a composed character arrive in task 2',
    async () => {
      const r = await rig(lineInputProgram());
      // Windows: the dead key has no character; the next key-down carries the composed one.
      const dead = key('Dead', 'Quote');
      expect(r.down(dead)).toEqual({ kind: 'program', cancelled: false, then: null });
      expect(dead.prevented).toBe(false);
      r.up(key('Dead', 'Quote'));
      r.press(key('é', 'KeyE'));

      // macOS: Option+E starts a composition; the browser puts the result into the textarea.
      const option = key('Dead', 'KeyE', { altKey: true });
      r.down(option);
      expect(option.prevented).toBe(false);
      const composing = key('a', 'KeyA', { isComposing: true, keyCode: 229 });
      expect(r.down(composing)).toEqual({ kind: 'program', cancelled: false, then: null });
      expect(composing.prevented).toBe(false);
      outputOf(r.ctx).input.text('á'); // from `compositionend`
      outputOf(r.ctx).input.text(''); // from the `input` event that follows: already taken
      r.settle();

      // An input method: several characters at once, one of them outside Windows-1252.
      outputOf(r.ctx).input.text('ñ日€');
      r.settle();

      // Safari reports the letter and keyCode 229, without isComposing, for the key that commits.
      const commit = key('Enter', 'Enter', { keyCode: 229 });
      expect(r.down(commit)).toMatchObject({ cancelled: false });
      r.settle();
      expect(r.long(LINES.count)).toBe(0); // that Enter belonged to the input method

      r.press(key('Enter', 'Enter'));
      expect(r.bytes(LINES.text, 5)).toEqual([0xe9, 0xe1, 0xf1, 0x80, 0x00]);
      expect(r.long(LINES.lengths)).toBe(4);
      // The keys themselves were recorded without a character.
      const keyDowns = r.controller.delivered.filter((entry) => entry.kind === 'keyDown');
      expect(keyDowns[0]).toEqual({ kind: 'keyDown', vk: 0xde });
      expect(keyDowns[2]).toEqual({ kind: 'keyDown', vk: 0x45 });
      expect(keyDowns[3]).toEqual({ kind: 'keyDown', vk: 0x41 });
    },
    SLOW,
  );

  it(
    'a key whose `key` is text of several characters is left to the browser',
    async () => {
      const r = await rig(lineInputProgram());
      const two = key('´x', 'KeyX');
      expect(r.down(two)).toMatchObject({ cancelled: false });
      outputOf(r.ctx).input.text('´x');
      r.press(key('Enter', 'Enter'));
      expect(r.bytes(LINES.text, 3)).toEqual([0xb4, 0x78, 0x00]);
    },
    SLOW,
  );

  it(
    'a line break typed as text (a virtual keyboard) is the Enter key',
    async () => {
      const r = await rig(lineInputProgram());
      outputOf(r.ctx).input.text('ok\n');
      r.settle();
      expect(r.long(LINES.count)).toBe(1);
      expect(r.string(LINES.text)).toBe('ok');
    },
    SLOW,
  );

  it(
    'a held letter repeats',
    async () => {
      const r = await rig(lineInputProgram());
      const first = key('a', 'KeyA');
      r.down(first);
      const repeats = [1, 2, 3].map(() => key('a', 'KeyA', { repeat: true }));
      for (const repeat of repeats) {
        r.settle(1);
        r.down(repeat);
      }
      r.up(key('a', 'KeyA'));
      r.press(key('Enter', 'Enter'));
      expect(r.string(LINES.text)).toBe('aaaa');
      // Every one was cancelled: that is what keeps the macOS accent menu away.
      expect([first, ...repeats].every((event) => event.prevented)).toBe(true);
    },
    SLOW,
  );

  it(
    'type-ahead is one character: only the last key typed before a read survives',
    async () => {
      const r = await rig(keyWatchProgram());
      r.press(key('a', 'KeyA'));
      r.press(key('b', 'KeyB'));
      expect(r.engine.state().pendingKey).toBe(0x62);
    },
    SLOW,
  );

  it(
    'Ctrl+@ is the character 0: task 5 returns it, task 2 stores it, and it wipes a typed-ahead key',
    async () => {
      // Ctrl+Shift+2 on a US keyboard: Windows sends WM_CHAR 0, and the original's key-press
      // handler treats it like every other character (simIOu.cpp:1334-1411).
      const ctrlAt = () => key('@', 'Digit2', { ctrlKey: true, shiftKey: true });

      // Task 5 reads one character per call; the 0 is one.
      const chars = await rig(charLoopProgram());
      chars.press(key('a', 'KeyA'));
      expect(chars.press(ctrlAt())).toEqual({ kind: 'program', cancelled: true, then: null });
      chars.press(key('b', 'KeyB'));
      expect(chars.long(CHARS.count)).toBe(3);
      expect(chars.bytes(CHARS.text, 3)).toEqual([0x61, 0x00, 0x62]);
      expect(chars.controller.delivered.filter((entry) => entry.kind === 'keyDown')[1]).toEqual({
        kind: 'keyDown',
        vk: 0x32,
        ch: 0x00,
      });

      // Task 2 stores the byte in the line, and the length counts it.
      const lines = await rig(lineInputProgram());
      lines.press(key('x', 'KeyX'));
      lines.press(ctrlAt());
      lines.press(key('y', 'KeyY'));
      lines.press(key('Enter', 'Enter'));
      expect(lines.long(LINES.count)).toBe(1);
      expect(lines.long(LINES.lengths)).toBe(3);
      expect(lines.bytes(LINES.text, 4)).toEqual([0x78, 0x00, 0x79, 0x00]);

      // With no read waiting the 0 takes the one place of type-ahead: the key before it is gone.
      const idle = await rig(keyWatchProgram());
      idle.press(key('a', 'KeyA'));
      expect(idle.engine.state().pendingKey).toBe(0x61);
      idle.press(ctrlAt());
      expect(idle.engine.state().pendingKey).toBe(0);
      // Ctrl+2 without Shift types nothing: the key is recorded, the type-ahead stays.
      idle.press(key('b', 'KeyB'));
      idle.press(key('2', 'Digit2', { ctrlKey: true }));
      expect(idle.engine.state().pendingKey).toBe(0x62);
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('paste (3.6)', () => {
  const shiftInsert = () => key('Insert', 'Insert', { shiftKey: true });

  it(
    'pasting HELLO into a task 5 loop stores HO',
    async () => {
      const r = await rig(charLoopProgram());
      const chord = shiftInsert();
      expect(r.down(chord)).toEqual({ kind: 'program', cancelled: false, then: 'paste' });
      expect(chord.prevented).toBe(false); // the browser must fire `paste`
      expect(r.posted()).toEqual([]); // the key waits for its text
      outputOf(r.ctx).input.paste('HELLO');
      r.settle();
      expect(r.string(CHARS.text)).toBe('HO');
      expect(r.long(CHARS.count)).toBe(2);
      const [entry] = r.posted() as { kind: string; vk: number; paste: Uint8Array }[];
      expect(entry).toMatchObject({ kind: 'keyDown', vk: 0x2d });
      expect(String.fromCharCode(...(entry?.paste ?? []))).toBe('HELLO');
    },
    SLOW,
  );

  it(
    'a two-line paste into task 2 fills one input',
    async () => {
      const r = await rig(lineInputProgram());
      r.down(shiftInsert());
      outputOf(r.ctx).input.paste('ONE\r\nTWO');
      r.settle();
      expect(r.long(LINES.count)).toBe(1);
      expect(r.string(LINES.text)).toBe('ONE');
      // Of the rest only the last character survives, as the first key of the next read.
      expect(r.controller.phase).toBe('waitInput');
      r.press(key('Enter', 'Enter'));
      expect(r.long(LINES.count)).toBe(2);
      expect(r.string(LINES.text + LINES.size)).toBe('O');
    },
    SLOW,
  );

  it(
    'a paste with LF line ends terminates the line',
    async () => {
      const r = await rig(lineInputProgram());
      r.down(shiftInsert());
      outputOf(r.ctx).input.paste('ABC\nDEF'); // what a browser on macOS or Linux delivers
      r.settle();
      expect(r.long(LINES.count)).toBe(1);
      expect(r.string(LINES.text)).toBe('ABC');
    },
    SLOW,
  );

  it(
    'an empty clipboard fires no paste event: the key goes out alone, from a zero-delay timer',
    async () => {
      const r = await rig(keyWatchProgram());
      r.down(shiftInsert());
      expect(r.posted()).toEqual([]);
      r.time?.advance(0);
      r.settle();
      expect(r.posted()).toEqual([{ kind: 'keyDown', vk: 0x2d }]);
      expect(downs(r, 0x2d)).toBe(1);
    },
    SLOW,
  );

  it(
    'Ctrl+V on Windows is not a paste chord: the program gets the character $16',
    async () => {
      const r = await rig(charLoopProgram());
      const ctrlV = key('v', 'KeyV', { ctrlKey: true });
      expect(r.down(ctrlV)).toEqual({ kind: 'program', cancelled: true, then: null });
      r.settle();
      expect(r.bytes(CHARS.text, 2)).toEqual([0x16, 0x00]);
    },
    SLOW,
  );

  it(
    'macOS: Cmd+V is the paste chord',
    async () => {
      const r = await rig(charLoopProgram(), { os: 'mac' });
      const chord = key('v', 'KeyV', { metaKey: true });
      expect(r.down(chord)).toEqual({ kind: 'program', cancelled: false, then: 'paste' });
      outputOf(r.ctx).input.paste('HELLO');
      r.settle();
      expect(r.string(CHARS.text)).toBe('HO');
    },
    SLOW,
  );

  it(
    'the command sim.output.paste types the clipboard in as the chord does, key included',
    async () => {
      const r = await rig(charLoopProgram());
      outputOf(r.ctx).readClipboard = async () => 'HELLO';
      await r.ctx.commands.run('sim.output.paste');
      r.settle();
      expect(r.string(CHARS.text)).toBe('HO');
      expect(r.posted().map((entry) => (entry as { kind: string }).kind)).toEqual(['keyDown', 'keyUp']);
      expect(panelVisible(r.ctx, 'output')).toBe(true);

      // A browser that refuses the clipboard: a toast names the key (1.4 note 45).
      outputOf(r.ctx).readClipboard = () => Promise.reject(new Error('denied'));
      await r.ctx.commands.run('sim.output.paste');
      expect(r.app.dialogs.toasts.getState().map((toast) => toast.text)).toEqual(['Press Shift+Insert to paste']);
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('focus (2.10)', () => {
  it(
    'nothing is posted on focus loss, and ioActivated on focus clears the key table',
    async () => {
      const r = await rig(keyWatchProgram());
      r.poke(KEYS.watch, [0, 0, 0, 0x25]); // watch the Left arrow
      r.down(key('ArrowLeft', 'ArrowLeft'));
      r.settle();
      expect(r.long(KEYS.state)).toBe(0xff);
      r.posted();

      outputOf(r.ctx).input.blur();
      r.settle();
      expect(r.posted()).toEqual([]);
      expect(r.long(KEYS.state)).toBe(0xff); // still down for the program, as in the original

      outputOf(r.ctx).input.focus();
      r.settle();
      expect(r.posted()).toEqual([{ kind: 'ioActivated' }]);
      expect(r.long(KEYS.state)).toBe(0);
      expect(r.long(KEYS.last)).toBe(0); // both codes are cleared too
    },
    SLOW,
  );

  it(
    'macOS: key-ups are restored when Meta is released',
    async () => {
      const r = await rig(keyWatchProgram(), { os: 'mac' });
      r.poke(KEYS.watch, [0, 0, 0, 0x27]); // watch the Right arrow
      r.down(key('Meta', 'MetaLeft', { metaKey: true }));
      r.down(key('ArrowRight', 'ArrowRight', { metaKey: true }));
      r.settle();
      expect(r.long(KEYS.state)).toBe(0xff);
      // The arrow is released while Command is held: no key-up event. Then Command goes up.
      r.up(key('Meta', 'MetaLeft'));
      r.settle();
      expect(r.long(KEYS.state)).toBe(0);
      expect(ups(r, 0x27)).toBe(1);
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('input edges (4.3)', () => {
  it(
    'a press and a release that arrive in the same instant are both seen by a polling program',
    async () => {
      const r = await rig(keyWatchProgram());
      r.poke(KEYS.watch, [0, 0, 0, 0x20]);
      r.down(key(' ', 'Space'));
      r.up(key(' ', 'Space')); // no time in between
      r.settle();
      expect(r.long(KEYS.held)).toBe(0xff); // it was seen down
      expect(r.long(KEYS.state)).toBe(0); // and is up now
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('mouse (trap15-b §8.1)', () => {
  const BOX = { left: 50, top: 30, width: 1280, height: 960 }; // the canvas at 200 %
  const SURFACE = { width: 640, height: 480 };
  const at = (x: number, y: number, init: object = {}) => ({
    clientX: BOX.left + 2 * x,
    clientY: BOX.top + 2 * y,
    buttons: 0,
    detail: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    ...init,
  });
  /** Bits of D0 of task 61. */
  const LEFT = 1;
  const RIGHT = 2;
  const DOUBLE = 8;
  const SHIFT = 16;
  const CTRL = 64;
  const position = (x: number, y: number) => ((y << 16) | (x & 0xffff)) >>> 0;

  it(
    'the shift bits follow rules 1 to 3',
    async () => {
      const r = await rig(mouseWatchProgram());
      const mouse = outputOf(r.ctx).mouse;

      mouse.down(at(10, 20, { buttons: 1, detail: 1, shiftKey: true }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.current)).toBe(LEFT | SHIFT);
      expect(r.long(MOUSE.down)).toBe(LEFT | SHIFT);
      expect(r.long(MOUSE.downPosition)).toBe(position(10, 20));

      // Rule 1: a move does not update the button flags, only the position and the modifier keys.
      mouse.move(at(11, 21, { buttons: 3, ctrlKey: true }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.current)).toBe(LEFT | CTRL);
      expect(r.long(MOUSE.currentPosition)).toBe(position(11, 21));

      // Rule 2: releasing the only pressed button leaves no button in the "up" snapshot.
      mouse.up(at(12, 22, { buttons: 0, detail: 1 }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.up)).toBe(0);
      expect(r.long(MOUSE.current)).toBe(0);
      expect(r.long(MOUSE.upPosition)).toBe(position(12, 22));
      expect(r.long(MOUSE.down)).toBe(LEFT | SHIFT); // the "down" snapshot keeps its event

      // Rule 3: Double from the second press of a double-click until the next button event.
      mouse.down(at(12, 22, { buttons: 1, detail: 2 }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.current)).toBe(LEFT | DOUBLE);
      expect(r.long(MOUSE.down)).toBe(LEFT | DOUBLE);
      mouse.up(at(12, 22, { buttons: 0, detail: 2 }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.current)).toBe(0);
      expect(r.long(MOUSE.up)).toBe(0); // never Double in the "up" snapshot
      expect(r.long(MOUSE.down)).toBe(LEFT | DOUBLE);

      // A right click (Ctrl+click on macOS arrives as one).
      mouse.down(at(1, 2, { buttons: 2, detail: 1, ctrlKey: true }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.current)).toBe(RIGHT | CTRL);
      expect(ShiftBit.Right).toBe(16); // the contract's bit, translated by the engine to bit 1 of D0
    },
    SLOW,
  );

  it(
    'a left drag reports positions outside the surface; a cancelled pointer releases the button',
    async () => {
      const r = await rig(mouseWatchProgram());
      const mouse = outputOf(r.ctx).mouse;
      mouse.down(at(5, 5, { buttons: 1, detail: 1 }), BOX, SURFACE);
      mouse.move(at(-7, 500, { buttons: 1 }), BOX, SURFACE);
      r.settle();
      expect(r.long(MOUSE.currentPosition)).toBe(position(-7, 500));
      mouse.cancel();
      r.settle();
      expect(r.long(MOUSE.current)).toBe(0);
      expect(r.long(MOUSE.up)).toBe(0);
      expect(r.long(MOUSE.upPosition)).toBe(position(-7, 500));
    },
    SLOW,
  );
});

describe.skipIf(!enginesBuilt)('the commands of the Options and View menus', () => {
  it(
    'Output Window Size sets the size; the check mark follows the real size, also one set by task 33',
    async () => {
      const r = await rig(pictureProgram());
      const { commands, store } = r.ctx;
      const checked = () =>
        [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((index) => commands.isChecked('sim.options.size', index));
      expect(checked()).toEqual([0]); // 640x480 at start
      expect(r.surface.getPixel(PICTURE.pixel.x, PICTURE.pixel.y)).toBe(PICTURE.pixel.color);

      await commands.run('sim.options.size', 2);
      expect([r.surface.back.width, r.surface.back.height]).toEqual([1024, 768]);
      // The session mirrors the size into the store once per frame; the Output feature does not.
      expect(store.getState().sim.output).toMatchObject({ width: 640, height: 480 });
      r.settle(1);
      expect(store.getState().sim.output).toMatchObject({ width: 1024, height: 768 });
      expect(checked()).toEqual([2]);
      expect(r.surface.getPixel(PICTURE.pixel.x, PICTURE.pixel.y)).toBe(0); // every size change blacks the surface
      expect(r.text.state.textCols).toBe(128);

      // The program sets 800x600 with task 33; the store follows at the next frame.
      r.poke(PICTURE.resize, [1]);
      r.settle();
      expect(store.getState().sim.output).toMatchObject({ width: 800, height: 600 });
      expect(checked()).toEqual([1]);
      expect(r.long(PICTURE.drawn)).toBe(2);

      // A size that is none of the nine leaves every item unchecked.
      r.ctx.sim.host.setWindowSize(700, 500);
      r.settle(1);
      expect(checked()).toEqual([]);
      await commands.run('sim.options.size', 99); // no such item: nothing happens
      expect(r.surface.back.width).toBe(700);
    },
    SLOW,
  );

  it(
    'Output Window Text Wrap toggles the option of the text screen',
    async () => {
      const r = await rig(pictureProgram());
      const { commands } = r.ctx;
      expect(commands.isChecked('sim.options.textWrap')).toBe(false);
      await commands.run('sim.options.textWrap');
      expect(r.text.state.textWrap).toBe(true);
      r.settle(1); // the check mark follows the session's mirror, a frame later
      expect(commands.isChecked('sim.options.textWrap')).toBe(true);
      await commands.run('sim.options.textWrap');
      expect(r.text.state.textWrap).toBe(false);
      r.settle(1);
      expect(commands.isChecked('sim.options.textWrap')).toBe(false);
    },
    SLOW,
  );

  it(
    'a program asks for full screen without a gesture: the request waits, and is dropped when it asks for windowed mode',
    async () => {
      const r = await rig(keyWatchProgram({ askFullScreen: true }));
      const { fullScreen } = outputOf(r.ctx);
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(1);
      expect(r.ctx.store.getState().sim.output.fullScreen).toBe(true);
      expect(fullScreen.phase).toBe('waiting');

      r.poke(KEYS.askWindowed, [1]); // task 33 with D1.L = 1
      r.settle();
      expect(fullScreen.phase).toBe('windowed');
      expect(r.ctx.store.getState().sim.output.fullScreen).toBe(false);
    },
    SLOW,
  );

  it(
    'the waiting request is carried out by the next key, which the program receives as well',
    async () => {
      const r = await rig(keyWatchProgram({ askFullScreen: true }));
      const { fullScreen } = outputOf(r.ctx);
      const driver = instantDriver();
      outputOf(r.ctx).attachDriver(driver);
      expect(fullScreen.phase).toBe('waiting');
      r.press(key('a', 'KeyA'));
      await Promise.resolve();
      expect(fullScreen.phase).toBe('full');
      expect(downs(r, 0x41)).toBe(1);

      // The engine leaves full screen itself when execution stops in trace mode (sim-ui §9.2 step
      // 9): here Pause, then one Trace Into.
      r.controller.pause();
      r.engine.cmdTraceInto();
      r.settle();
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
      expect(fullScreen.phase).toBe('windowed');
      expect(driver.active).toBe(false);
    },
    SLOW,
  );

  it(
    'View > Output Window shows and focuses the panel and leaves full screen',
    async () => {
      const r = await rig(keyWatchProgram());
      const { fullScreen } = outputOf(r.ctx);
      outputOf(r.ctx).attachDriver(instantDriver());
      fullScreen.toggle();
      await Promise.resolve();
      expect(fullScreen.phase).toBe('full');
      shellStateOf(r.ctx).setState((state) => ({ ...state, outputCollapsed: true, focusRequest: null }));

      await r.ctx.commands.run('sim.view.output');
      r.settle();
      expect(fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
      expect(panelVisible(r.ctx, 'output')).toBe(true);
      expect(shellStateOf(r.ctx).getState().focusRequest?.panel).toBe('output');
    },
    SLOW,
  );

  it(
    'sim.output.fullscreen toggles, and sets the state it is given',
    async () => {
      const r = await rig(keyWatchProgram());
      const { fullScreen } = outputOf(r.ctx);
      outputOf(r.ctx).attachDriver(instantDriver());
      await r.ctx.commands.run('sim.output.fullscreen');
      await Promise.resolve();
      r.settle();
      expect(fullScreen.phase).toBe('full');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(1);
      await r.ctx.commands.run('sim.output.fullscreen', true); // already on
      expect(fullScreen.phase).toBe('full');
      await r.ctx.commands.run('sim.output.fullscreen', false);
      r.settle();
      expect(fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
    },
    SLOW,
  );

  it(
    "desktop app: when the system ends the window's full screen the engine's flag is cleared",
    async () => {
      let system: (on: boolean) => void = () => {};
      const r = await rig(keyWatchProgram(), {
        platform: {
          kind: 'desktop',
          setFullScreen: async () => true,
          onFullScreenChange(listener) {
            system = listener;
            return () => {};
          },
        },
      });
      const { fullScreen } = outputOf(r.ctx);
      outputOf(r.ctx).attachDriver(instantDriver());
      fullScreen.toggle();
      await Promise.resolve();
      r.settle();
      expect(fullScreen.phase).toBe('full');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(1);

      system(false); // Platform.onFullScreenChange: the window's green button
      r.settle();
      expect(fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
      expect(r.ctx.store.getState().sim.output.fullScreen).toBe(false);
    },
    SLOW,
  );

  it(
    'leaving Simulator mode leaves full screen',
    async () => {
      const r = await rig(keyWatchProgram());
      const { fullScreen } = outputOf(r.ctx);
      outputOf(r.ctx).attachDriver(instantDriver());
      fullScreen.toggle();
      await Promise.resolve();
      await r.ctx.commands.run('app.mode.set', 'editor');
      r.settle();
      expect(fullScreen.phase).toBe('windowed');
      expect(r.engine.getOption(SimOption.Fullscreen)).toBe(0);
    },
    SLOW,
  );

  it(
    'the release command moves the focus to the next panel',
    async () => {
      const r = await rig(keyWatchProgram());
      shellStateOf(r.ctx).setState((state) => ({ ...state, focusRequest: null }));
      await r.ctx.commands.run('sim.output.releaseKeyboard');
      expect(shellStateOf(r.ctx).getState().focusRequest).not.toBeNull();
    },
    SLOW,
  );
});

// Added by T3 in round I3 (ARCHITECTURE.md 6.9 item 2, trap15-a §13 Input, the F6/F9 item): the
// value task 19 returns for F6 and F9 while the key is held, before and after task 24.
describe.skipIf(!enginesBuilt)('task 19 on F6 and F9, before and after task 24 (trap15-a §13)', () => {
  /** Polls task 19 for F6 ($75) into $3000 and for F9 ($78) into $3004, for ever. */
  const pollProgram = (keyCommandsOff: boolean) => [
    '        ORG     $1000',
    'START:',
    ...(keyCommandsOff ? ['        MOVEQ   #1,D1', '        MOVEQ   #24,D0', '        TRAP    #15'] : []),
    'LOOP:   MOVE.L  #$75,D1',
    '        MOVEQ   #19,D0',
    '        TRAP    #15',
    '        MOVE.L  D1,$3000',
    '        MOVE.L  #$78,D1',
    '        MOVEQ   #19,D0',
    '        TRAP    #15',
    '        MOVE.L  D1,$3004',
    '        BRA     LOOP',
    '        END     START',
  ];
  const long = (r: Rig, address: number) =>
    ((r.byte(address) << 24) | (r.byte(address + 1) << 16) | (r.byte(address + 2) << 8) | r.byte(address + 3)) >>> 0;

  /** A value the program never writes: a poll that ran since the poke replaces it. */
  const SENTINEL = [0x5a, 0x5a, 0x5a, 0x5a];

  /** Pokes the sentinel over both results, lets the program run and asserts that it polled again. */
  const pollsAgain = (r: Rig, what: string) => {
    r.poke(0x3000, SENTINEL);
    r.poke(0x3004, SENTINEL);
    r.settle();
    expect(r.controller.phase, what).toBe('running');
    expect(long(r, 0x3000), `${what}: $3000 was polled again`).not.toBe(0x5a5a5a5a);
    expect(long(r, 0x3004), `${what}: $3004 was polled again`).not.toBe(0x5a5a5a5a);
  };

  it(
    'key commands enabled: F6 runs Pause and the program never sees $FF, not even when it runs again while F6 is held',
    async () => {
      const r = await rig(pollProgram(false));
      pollsAgain(r, 'before F6');
      expect(long(r, 0x3000)).toBe(0);
      const f6 = key('F6', 'F6');
      expect(r.down(f6)).toEqual({ kind: 'command', id: 'sim.run.pause', ran: true });
      expect(f6.prevented).toBe(true);
      r.settle();
      expect(r.commandsRun).toEqual(['sim.run.pause']);
      expect(r.controller.phase).toBe('idle');
      // F6 is still held: Run again, and the program's polls of F6 still read $00.
      r.run();
      pollsAgain(r, 'F6 held, after Run');
      expect(long(r, 0x3000)).toBe(0);
      r.up(key('F6', 'F6'));
      r.settle();
      expect(long(r, 0x3000)).toBe(0);
    },
    SLOW,
  );

  it(
    'key commands enabled: F9 while the program runs (Run disabled, as the dispatcher has it) runs nothing and task 19 reads $00 while it is held',
    async () => {
      const r = await rig(pollProgram(false));
      pollsAgain(r, 'before F9');
      // While a program runs, the run feature reports Run disabled.
      r.disabledCommands.add('sim.run.run');
      const f9 = key('F9', 'F9');
      expect(r.down(f9)).toEqual({ kind: 'command', id: 'sim.run.run', ran: false });
      expect(f9.prevented).toBe(true);
      for (let poll = 0; poll < 3; poll++) {
        pollsAgain(r, `F9 held, poll ${poll}`);
        expect(long(r, 0x3004), `F9 held, poll ${poll}`).toBe(0);
      }
      expect(r.commandsRun).toEqual([]);
      r.up(key('F9', 'F9'));
      pollsAgain(r, 'after F9');
      expect(long(r, 0x3004)).toBe(0);
    },
    SLOW,
  );

  it(
    'after task 24 with D1 = 1: F6 does not pause and task 19 gives $000000FF while it is held; F9 the same',
    async () => {
      const r = await rig(pollProgram(true));
      expect(r.engine.state().keyCommandsDisabled).toBe(true);
      expect(r.down(key('F6', 'F6'))).toEqual({ kind: 'program', cancelled: true, then: null });
      r.settle();
      expect(r.commandsRun).not.toContain('sim.run.pause');
      expect(long(r, 0x3000)).toBe(0x000000ff);
      r.up(key('F6', 'F6'));
      r.settle();
      expect(long(r, 0x3000)).toBe(0);
      expect(r.down(key('F9', 'F9'))).toEqual({ kind: 'program', cancelled: true, then: null });
      r.settle();
      expect(long(r, 0x3004)).toBe(0x000000ff);
      r.up(key('F9', 'F9'));
      r.settle();
      expect(long(r, 0x3004)).toBe(0);
    },
    SLOW,
  );
});
