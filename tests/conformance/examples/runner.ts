// Runs one program headlessly to a fixed point and reports its surface (ARCHITECTURE.md 6.5.4).
// Owner: X3.
//
// This file runs in three places and must not import anything that exists in only one of them: under
// Node (examples.test.ts), and in the page of Chromium and WebKit (check-examples.mjs loads it
// through the Vite development server). It therefore imports no `node:` module; what comes from
// the machine - the engines, the glyph provider with its font files, the bytes of the program - is
// passed in.
//
// "A fixed point" is a fixed count of instructions or a fixed span of virtual time, whichever comes
// first, or the end of the program, or its first wait for a key that the script cannot answer. Time
// is virtual (`VirtualTime`: 16 ms frames from the same start every run), so what a program reads
// from the clock and when its delays end do not depend on the machine. The run stops at a frame
// boundary: the instruction count is "the first frame that reaches `limits.instructions`", and the
// result records the count it really stopped at.

import type { Bytes, GlyphProvider, PixelBuffer, SimEngineFactory, SurfaceApi } from '../../../app/src/contracts';
import { VIRTUAL_FRAME_MS, VirtualTime } from '../../../app/src/core/run/clock';
import { createHeadlessSession, type HeadlessSession } from '../../../app/src/core/run/headless';
import { MemoryBackend } from '../../../app/src/fs/memory-backend';
import { MemorySyncFiles } from '../../../app/src/fs/sync/memory';
import { createVfs } from '../../../app/src/fs/vfs';
import { Sha256 } from './sha256';

/** Where the program and its files are in the in-memory file system. */
export const PROGRAM_DIR = '/memory/examples';

/** Something that happens while the program runs: input from the user. */
export interface ScriptEvent {
  /** Virtual milliseconds after the program was started. */
  atMs: number;
  /** Text typed as key presses (`\n` is Enter). */
  keys?: string;
  /** A mouse event on the surface; `shift` is a ShiftBit value (0 for none, 1 left button down, ...). */
  mouse?: { kind: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; shift: number };
}

/** What a program is given to do, and how long it may do it. */
export interface Script {
  /** Text typed at each wait for a key (tasks 2, 4, 5, 18), in order; `\n` is Enter. */
  keys?: string[];
  /** Timed input while the program runs. */
  events?: ScriptEvent[];
  limits: {
    /** Stop at the first frame in which this many instructions have been executed. */
    instructions: number;
    /** Stop when this much virtual time has passed since the start. */
    ms: number;
  };
  /** The start-up switches /e and /b of the simulator. */
  exceptions?: boolean;
  bitField?: boolean;
}

/** A program ready to run: assembled, with the files it needs next to it. */
export interface PreparedProgram {
  id: string;
  /** The file name without extension: `<stem>.S68`. */
  stem: string;
  s68: Bytes;
  l68: Bytes;
  /** Data files beside the program (sounds, input files), by name. */
  files: Record<string, Bytes>;
  script: Script;
}

/** What comes from the machine and not from the program. */
export interface RunEnvironment {
  /** `{ create: createSimEngine, release: releaseSimEngine }` of app/src/engine. */
  engines: SimEngineFactory;
  /** The application's glyph provider (the atlases of app/public/fonts), loaded: `ready` resolved. */
  glyphs: GlyphProvider;
}

export type EndReason = 'halted' | 'stopped' | 'waiting for input' | 'instruction limit' | 'time limit';

export interface ExampleResult {
  id: string;
  end: EndReason;
  /** The size of the back buffer. */
  width: number;
  height: number;
  /** Hash of the back buffer: `<width>x<height>:` and its bytes (R, G, B, A of every pixel in row order). */
  surfaceHash: string;
  /** The same for the image the screen shows: `window` while double buffering, else `back`. */
  shownHash: string;
  doubleBuffered: boolean;
  /**
   * The same for what the canvas of the Output panel shows: the image on screen with the prompt
   * overlay (the cell of a key wait, which is drawn on the canvas and never into a buffer, 3.4)
   * painted over it, as the panel's Presenter does. Equals `shownHash` when there is no overlay.
   */
  screenHash: string;
  /** The prompt overlay exists at the end. */
  overlay: boolean;
  instructions: number;
  cycles: number;
  /** Virtual milliseconds used. */
  ms: number;
  messages: string[];
}

/** The hash of a pixel buffer, as every committed surface hash is made. */
export function hashPixelBuffer(buffer: PixelBuffer): string {
  const prefix = new TextEncoder().encode(`${buffer.width}x${buffer.height}:`);
  return new Sha256()
    .update(prefix)
    .update(new Uint8Array(buffer.data.buffer, buffer.data.byteOffset, buffer.data.byteLength))
    .hex();
}

/** The pixels the canvas shows: `window ?? back` with the prompt overlay painted over it (Presenter.frame). */
export function screenPixels(surface: SurfaceApi): PixelBuffer {
  const shown = surface.window ?? surface.back;
  const data = new Uint32Array(shown.data);
  const overlay = surface.overlay;
  if (overlay) {
    for (let row = 0; row < overlay.height; row++) {
      const y = overlay.y + row;
      if (y < 0 || y >= shown.height) continue;
      for (let column = 0; column < overlay.width; column++) {
        const x = overlay.x + column;
        if (x < 0 || x >= shown.width) continue;
        data[y * shown.width + x] = overlay.pixels[row * overlay.width + column] as number;
      }
    }
  }
  return { width: shown.width, height: shown.height, data };
}

/** The same hash of an RGBA byte array of a known size (a screenshot read back). */
export function hashRgba(width: number, height: number, rgba: Uint8Array): string {
  return new Sha256()
    .update(new TextEncoder().encode(`${width}x${height}:`))
    .update(rgba)
    .hex();
}

/** Types text as key presses into the Output panel's keyboard; `\n` is Enter. */
function typeKeys(session: HeadlessSession, text: string): void {
  const plain = { ctrlKey: false, altKey: false, metaKey: false, repeat: false };
  for (const ch of text) {
    const enter = ch === '\n' || ch === '\r';
    const code = enter
      ? 'Enter'
      : /[a-z]/i.test(ch)
        ? `Key${ch.toUpperCase()}`
        : /[0-9]/.test(ch)
          ? `Digit${ch}`
          : ch === ' '
            ? 'Space'
            : '';
    const event = { key: enter ? 'Enter' : ch, code, ...plain, shiftKey: /[A-Z]/.test(ch) };
    session.keyboard.keydown(event, false);
    session.time.advance(VIRTUAL_FRAME_MS);
    session.keyboard.keyup(event);
    session.time.advance(VIRTUAL_FRAME_MS);
  }
}

/** Virtual time a stopped program (a STOP instruction) is given before the run counts as ended. */
const IDLE_GRACE_MS = 1000;

/**
 * Runs the program to its fixed point in a fresh headless session. `inspect` is called with the
 * finished session before it is disposed: the page uses it to present the surface on a canvas and
 * to take the screenshot.
 */
export async function runExample(
  program: PreparedProgram,
  environment: RunEnvironment,
  inspect?: (session: HeadlessSession, result: ExampleResult) => void | Promise<void>,
): Promise<ExampleResult> {
  const { script } = program;
  await environment.glyphs.ready;
  const vfs = createVfs();
  vfs.mount(new MemoryBackend());
  const path = `${PROGRAM_DIR}/${program.stem}.S68`;
  await vfs.writeFile(path, program.s68);
  await vfs.writeFile(`${PROGRAM_DIR}/${program.stem}.L68`, program.l68);
  for (const [name, data] of Object.entries(program.files)) await vfs.writeFile(`${PROGRAM_DIR}/${name}`, data);
  const view = new MemorySyncFiles({
    files: Object.fromEntries(Object.entries(program.files).map(([name, data]) => [`${PROGRAM_DIR}/${name}`, data])),
  });

  const session = await createHeadlessSession({
    engines: environment.engines,
    vfs,
    viewFor: () => view,
    glyphs: environment.glyphs,
    time: new VirtualTime(),
    commandLine: { run: true, exceptions: script.exceptions ?? false, bitField: script.bitField ?? false },
  });
  try {
    const { controller, time } = session;
    await controller.open(path, 'commandLine');
    const keys = [...(script.keys ?? [])];
    const events = [...(script.events ?? [])].sort((a, b) => a.atMs - b.atMs);
    let end: EndReason = 'time limit';
    let idleSince: number | null = null;
    let elapsed = 0;
    for (; elapsed <= script.limits.ms; elapsed += VIRTUAL_FRAME_MS) {
      if (controller.alerts.length > 0) controller.dismissAlerts();
      while (events.length > 0 && (events[0] as ScriptEvent).atMs <= elapsed) {
        const event = events.shift() as ScriptEvent;
        if (event.keys !== undefined) typeKeys(session, event.keys);
        if (event.mouse) controller.post(event.mouse);
      }
      const steps = session.engine.stepCount >>> 0;
      if (steps >= script.limits.instructions) {
        end = 'instruction limit';
        break;
      }
      const idle = controller.phase === 'idle' && controller.queueLength === 0;
      if (idle) {
        // A halted program can still be started again by an interrupt: wait a second before ending.
        idleSince ??= elapsed;
        if (controller.snapshot.halted || elapsed - idleSince >= IDLE_GRACE_MS) {
          if (events.length === 0) {
            end = controller.snapshot.halted ? 'halted' : 'stopped';
            break;
          }
        }
      } else {
        idleSince = null;
      }
      if (controller.phase === 'waitInput') {
        const next = keys.shift();
        if (next === undefined) {
          end = 'waiting for input';
          break;
        }
        typeKeys(session, next);
        continue;
      }
      time.advance(VIRTUAL_FRAME_MS);
    }
    if (end === 'instruction limit' || end === 'time limit') {
      // Stop between instructions at the frame boundary, so that the surface is a settled picture.
      controller.pause();
      time.advance(VIRTUAL_FRAME_MS);
    }
    const { surface, engine } = session;
    const shown = surface.window ?? surface.back;
    const result: ExampleResult = {
      id: program.id,
      end,
      width: surface.back.width,
      height: surface.back.height,
      surfaceHash: hashPixelBuffer(surface.back),
      shownHash: hashPixelBuffer(shown),
      doubleBuffered: surface.window !== null,
      screenHash: hashPixelBuffer(screenPixels(surface)),
      overlay: surface.overlay != null,
      instructions: engine.stepCount >>> 0,
      cycles: Number(engine.cycles),
      ms: elapsed,
      messages: [...session.messages()],
    };
    await inspect?.(session, result);
    return result;
  } finally {
    session.dispose();
  }
}
