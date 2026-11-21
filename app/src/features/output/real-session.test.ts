// The Output panel's keyboard, mouse, presenter and text mirror with the REAL session parts of the
// other packages under Node: the real engine, the real run controller (core/run), the real drawing
// surface and the real text screen, composed the way the application composes them
// (core/run/headless.ts). Work package SH4.
//
// engine.test.ts checks every rule of 2.9.4 and 3.6 on small doubles of those three, where each
// entry that reached the engine can be read back. This file shows the part that depends on the
// neighbours: that the real controller delivers what the panel posts as 4.3 says (a pasted text in
// one go, a press and its release both visible to a polling program, the character 0), and that
// the presenter and the text mirror read the real surface and the real text screen.
// check-output.mjs (group `app`) does the same with real keys in the real application.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { VIRTUAL_FRAME_MS } from '../../core/run/clock';
import { createHeadlessSession, type HeadlessSession } from '../../core/run/headless';
import { OutputMouse } from '../../core/sim-host/input/mouse';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { createVfs } from '../../fs/vfs';
import { mirrorRows } from './mirror';
import { PanelInput, type PanelKeyEvent } from './panel-input';
import { Presenter } from './present';
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

/** Time limit of each test: both engines load and the assembler runs, on a busy machine. */
const SLOW = 60_000;
const PROGRAM = '/memory/work/program.S68';

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

interface Rig {
  session: HeadlessSession;
  input: PanelInput;
  mouse: OutputMouse;
  /** The commands the panel ran for menu shortcuts (rule 2). */
  commandsRun: string[];
  fullScreenToggles: number;
  /** Lets virtual time pass, frame by frame: the controller's ticks run the program. */
  settle(frames?: number): void;
  /** A key-down, time, the key-up, time. */
  press(event: Key): void;
  byte(address: number): number;
  long(address: number): number;
  bytes(address: number, length: number): number[];
}

let open: HeadlessSession | null = null;
afterEach(() => {
  open?.dispose();
  open = null;
});

/** Loads `program` into a real session, presses Run and gives the panel the keyboard. */
async function rig(program: readonly string[], os: 'windows' | 'mac' = 'windows'): Promise<Rig> {
  const { s68, l68 } = await assembleProgram(program);
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  await vfs.writeFile(PROGRAM, s68);
  await vfs.writeFile(PROGRAM.replace('.S68', '.L68'), l68);
  const session = await createHeadlessSession({
    engines: { create: createSimEngine, release: releaseSimEngine },
    vfs,
    viewFor: () => new MemorySyncFiles(),
    os,
  });
  open = session;
  await session.controller.open(PROGRAM, 'open');

  const self: Rig = {
    session,
    // The panel's key handling exactly as the Output feature builds it (model.ts), on the session.
    input: new PanelInput({
      os,
      desktop: false,
      keyboard: () => session.keyboard,
      keyCommandsEnabled: () => !session.engine.state().keyCommandsDisabled,
      commands: {
        isEnabled: () => true,
        run: async (id) => void self.commandsRun.push(id),
      },
      gesture: () => false,
      toggleFullScreen: () => void self.fullScreenToggles++,
      nextPanel: () => {},
      setTimer: (delayMs, fn) => session.time.setTimer(delayMs, fn),
    }),
    mouse: new OutputMouse({ post: (event) => session.controller.post(event) }),
    commandsRun: [],
    fullScreenToggles: 0,
    settle(frames = 6) {
      for (let i = 0; i < frames; i++) session.time.advance(VIRTUAL_FRAME_MS);
    },
    press(event) {
      self.input.keydown(event);
      self.settle();
      self.input.keyup(key(event.key, event.code));
      self.settle();
    },
    byte: (address) => session.engine.readByte(address),
    long: (address) => session.engine.readLong(address) >>> 0,
    bytes: (address, length) => Array.from({ length }, (_, index) => session.engine.readByte(address + index)),
  };
  session.controller.run();
  self.input.focus();
  self.settle();
  return self;
}

it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
  expect.fail(
    'EASY68K_REQUIRE_ENGINES is 1 but engine/dist lacks sim68k or asm68k: run `npm run build:engines` first. ' +
      'Without the variable these tests are skipped.',
  );
});

describe.skipIf(!enginesBuilt)('the panel on the real run controller, surface and text screen', () => {
  it(
    'the session gives the panel the Output keyboard, and a waiting read is the phase waitInput',
    async () => {
      const r = await rig(lineInputProgram());
      expect(r.session.controller.phase).toBe('waitInput');
      for (const [k, code] of [
        ['H', 'KeyH'],
        ['i', 'KeyI'],
      ] as const) {
        r.press(key(k, code));
      }
      r.press(key('Enter', 'Enter'));
      expect(r.long(LINES.count)).toBe(1);
      expect(r.bytes(LINES.text, 3)).toEqual([0x48, 0x69, 0x00]);
      expect(r.session.reports).toEqual([]);
    },
    SLOW,
  );

  it(
    'pasting HELLO into a task 5 loop stores HO',
    async () => {
      const r = await rig(charLoopProgram());
      const chord = key('Insert', 'Insert', { shiftKey: true });
      expect(r.input.keydown(chord)).toEqual({ kind: 'program', cancelled: false, then: 'paste' });
      r.input.paste('HELLO'); // the browser's paste event
      r.input.keyup(key('Insert', 'Insert'));
      r.settle();
      expect(r.long(CHARS.count)).toBe(2);
      expect(r.bytes(CHARS.text, 3)).toEqual([0x48, 0x4f, 0x00]);
    },
    SLOW,
  );

  it(
    'a two-line paste into task 2 fills one input; a paste with LF line ends terminates the line',
    async () => {
      const r = await rig(lineInputProgram());
      const shiftInsert = () => key('Insert', 'Insert', { shiftKey: true });
      r.input.keydown(shiftInsert());
      r.input.paste('ONE\r\nTWO');
      r.input.keyup(key('Insert', 'Insert'));
      r.settle();
      expect(r.long(LINES.count)).toBe(1);
      expect(r.bytes(LINES.text, 4)).toEqual([0x4f, 0x4e, 0x45, 0x00]);
      // Of the second line only its last character survived, as the first key of the next read.
      r.press(key('Enter', 'Enter'));
      expect(r.long(LINES.count)).toBe(2);
      expect(r.bytes(LINES.text + LINES.size, 2)).toEqual([0x4f, 0x00]);

      r.input.keydown(shiftInsert());
      r.input.paste('ABC\nDEF'); // what a browser on macOS or Linux delivers
      r.input.keyup(key('Insert', 'Insert'));
      r.settle();
      expect(r.long(LINES.count)).toBe(3);
      expect(r.bytes(LINES.text + 2 * LINES.size, 4)).toEqual([0x41, 0x42, 0x43, 0x00]);
    },
    SLOW,
  );

  it(
    'a press and its release posted in the same instant are both seen by a polling program (4.3)',
    async () => {
      const r = await rig(keyWatchProgram());
      r.session.engine.writeBytes(KEYS.watch, [0x00, 0x00, 0x73, 0x71]); // watch F4 and F2
      r.settle(1);
      r.input.keydown(key('F2', 'F2'));
      r.input.keyup(key('F2', 'F2'));
      r.settle();
      expect(r.byte(KEYS.downs + 0x71)).toBe(1);
      expect(r.byte(KEYS.ups + 0x71)).toBe(1);
      expect(r.long(KEYS.held)).toBe(0x000000ff); // task 19 saw F2 down in between
      expect(r.long(KEYS.state)).toBe(0); // and up again afterwards
      expect(r.commandsRun).toEqual([]); // F2 is a key of the program here
    },
    SLOW,
  );

  it(
    'F9 runs its command and is not seen by task 19; Alt+Enter is seen by it and by a key-down interrupt',
    async () => {
      const r = await rig(keyWatchProgram({ keyDownInterrupt: true }));
      r.press(key('F9', 'F9'));
      expect(r.commandsRun).toEqual(['sim.run.run']);
      expect(r.byte(KEYS.downs + 0x78)).toBe(0);
      expect(r.byte(KEYS.ups + 0x78)).toBe(1);

      const interrupts = r.long(KEYS.interrupts);
      r.input.keydown(key('Alt', 'AltLeft', { altKey: true }));
      r.settle();
      expect(r.input.keydown(key('Enter', 'Enter', { altKey: true }))).toEqual({
        kind: 'program',
        cancelled: true,
        then: 'fullscreen',
      });
      r.settle();
      expect(r.byte(KEYS.downs + 0x0d)).toBe(1);
      expect(r.byte(KEYS.interruptDowns + 0x0d)).toBe(1);
      expect(r.long(KEYS.interrupts)).toBe(interrupts + 2); // Alt, then Enter
      expect(r.fullScreenToggles).toBe(1);
    },
    SLOW,
  );

  it(
    'after task 24 a menu shortcut reaches the program and runs nothing',
    async () => {
      const r = await rig(keyWatchProgram({ keyCommandsOff: true }));
      expect(r.session.engine.state().keyCommandsDisabled).toBe(true);
      r.press(key('F9', 'F9'));
      r.press(key('Enter', 'Enter', { altKey: true }));
      expect(r.byte(KEYS.downs + 0x78)).toBe(1);
      expect(r.byte(KEYS.downs + 0x0d)).toBe(1);
      expect(r.commandsRun).toEqual([]);
      expect(r.fullScreenToggles).toBe(0);
    },
    SLOW,
  );

  it(
    'Ctrl+@ reaches a task 5 loop as the character 0',
    async () => {
      const r = await rig(charLoopProgram());
      r.press(key('a', 'KeyA'));
      r.press(key('@', 'Digit2', { ctrlKey: true, shiftKey: true }));
      r.press(key('b', 'KeyB'));
      expect(r.long(CHARS.count)).toBe(3);
      expect(r.bytes(CHARS.text, 3)).toEqual([0x61, 0x00, 0x62]);
    },
    SLOW,
  );

  it(
    'gaining the focus clears the key table; losing it posts nothing',
    async () => {
      const r = await rig(keyWatchProgram());
      r.session.engine.writeBytes(KEYS.watch, [0, 0, 0, 0x25]); // the Left arrow
      r.input.keydown(key('ArrowLeft', 'ArrowLeft'));
      r.settle();
      expect(r.long(KEYS.state)).toBe(0xff);
      r.input.blur();
      r.settle();
      expect(r.long(KEYS.state)).toBe(0xff); // still down for task 19, as in the original
      r.input.focus();
      r.settle();
      expect(r.long(KEYS.state)).toBe(0);
    },
    SLOW,
  );

  it(
    'mouse events reach task 61 with surface coordinates and the shift bits of trap15-b §8.1',
    async () => {
      const r = await rig(mouseWatchProgram());
      // D0 of task 61: bit 0 = the left button, bit 4 = Shift (trap15-b §8.3).
      const LEFT = 0x01;
      const SHIFT = 0x10;
      const box = { left: 100, top: 50, width: 1280, height: 960 }; // the canvas at 200 %
      const size = r.session.surface.back;
      const at = (x: number, y: number, more: object = {}) => ({
        clientX: box.left + 2 * x,
        clientY: box.top + 2 * y,
        buttons: 0,
        detail: 0,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        ...more,
      });
      const position = (x: number, y: number) => ((y << 16) | (x & 0xffff)) >>> 0;

      r.mouse.move(at(10, 20), box, size);
      r.settle();
      expect(r.long(MOUSE.currentPosition)).toBe(position(10, 20));
      r.mouse.down(at(10, 20, { buttons: 1, detail: 1, shiftKey: true }), box, size);
      r.settle();
      expect(r.long(MOUSE.down)).toBe(LEFT | SHIFT);
      expect(r.long(MOUSE.current)).toBe(LEFT | SHIFT);
      // The left button captures: a position left of and above the surface is reported as it is.
      r.mouse.move(at(-15, -10, { buttons: 1 }), box, size);
      r.mouse.up(at(-15, -10), box, size);
      r.settle();
      expect(r.long(MOUSE.upPosition)).toBe(position(-15, -10));
      expect(r.long(MOUSE.up)).toBe(0);
      expect(r.long(MOUSE.current)).toBe(0);
    },
    SLOW,
  );

  it(
    'the presenter shows the real surface, and the text mirror reads the real text screen',
    async () => {
      const r = await rig(pictureProgram());
      expect(r.long(PICTURE.drawn)).toBe(1);
      const { surface, text } = r.session;
      const { pixel, box } = PICTURE;
      expect(surface.getPixel(pixel.x, pixel.y)).toBe(pixel.color);

      // A canvas that is nothing but a pixel array: what the presenter puts there is what a browser shows.
      let canvas = new Uint32Array(0);
      let width = 0;
      let height = 0;
      const presenter = new Presenter<{ pixels: Uint32Array; width: number }>({
        size: () => ({ width, height }),
        resize(w, h) {
          width = w;
          height = h;
          canvas = new Uint32Array(w * h);
        },
        image: (pixels, w) => ({ pixels, width: w }),
        put(image, dx, dy, sx, sy, w, h) {
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const tx = dx + sx + x;
              const ty = dy + sy + y;
              if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
              canvas[ty * width + tx] = image.pixels[(sy + y) * image.width + sx + x] as number;
            }
          }
        },
      });
      const rgb = (x: number, y: number) => (canvas[y * width + x] as number) & 0xffffff;
      presenter.frame(surface);
      expect([width, height]).toEqual([640, 480]);
      expect(rgb(pixel.x, pixel.y)).toBe(pixel.color);
      expect(rgb(box.left + 1, box.top + 1)).toBe(box.color);
      expect(surface.takeDirty()).toBeNull(); // the presenter took the record

      // The mirror holds the line the program wrote with task 13.
      expect(mirrorRows(text.state)[0]).toBe(PICTURE.text);

      // TRAP #15 task 33 sets 800x600: the canvas follows the new buffer, and the picture is drawn again.
      r.session.engine.writeBytes(PICTURE.resize, [1]);
      r.settle();
      expect(r.long(PICTURE.drawn)).toBe(2);
      presenter.frame(surface);
      expect([width, height]).toEqual([800, 600]);
      expect(rgb(pixel.x, pixel.y)).toBe(pixel.color);
    },
    SLOW,
  );
});
