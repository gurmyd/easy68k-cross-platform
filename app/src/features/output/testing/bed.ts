// A whole application around the REAL Output feature and the REAL simulator engine, for the Output
// feature's tests: unit tests under Node (../engine.test.ts) and the browser check
// (../check-output.mjs through harness.tsx). Never imported by the application.
//
// What is real: the engine, the Output feature (panel, commands, start-up code), the Output
// keyboard and mouse, the shell with its keyboard dispatcher, the command registry, the stores.
// What is a test double: the drawing surface (PixelSurface), the text screen and output device
// (TextGrid) and the run controller (MiniController). They are small, need no fonts and no files,
// and let a test read every entry that reached the engine; the real three of the other packages
// are checked with the real application by the `app` group of check-output.mjs. The bed does for
// the panel what the real session (features/run/session.ts) does:
//
//   host.ioShow()             showPanel(ctx, 'output', { focus: false })
//   host.ioBringToFront()     focusPanel(ctx, 'output')
//   host.keyCommands(on)      AppState.sim.keyCommands = on
//   host.setupWindow(on)      nothing: the Output feature follows the engine's own full-screen
//                             flag (model.ts), whatever a session does with this call
//   once per frame            AppState.sim.output.width, height and textWrap follow the surface
//                             and the text screen (the session's mirror, which the Options menu
//                             and the panel's header read)
//
// The commands of other packages whose shortcuts act in the Output panel (2.9.4 rule 2) get
// handlers here that only record that they ran; `sim.run.run` and `sim.run.pause` also do it.
//
// The engine and the assembler are passed in (BedEnv): feature code may not import app/src/engine
// (3.1), unit tests and the check script may.

import type {
  AppContext,
  Bytes,
  Clock,
  FeatureModule,
  Glyph,
  HostIoGraphics,
  HostMain,
  Platform,
  Scheduler,
  SimEngine,
  SimHost,
  SimHostParts,
  SimSession,
} from '../../../contracts';
import { decode } from '../../../core/codec/cp1252';
import { OutputKeyboard } from '../../../core/sim-host/input/keyboard';
import { focusPanel, showPanel } from '../../../state/panels';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../../state/testing';
import { feature } from '../index';
import { MiniController } from './mini-controller';
import { PixelSurface } from './pixel-surface';
import { TextGrid } from './text-grid';

export interface BedEnv {
  /** The real simulator engine on a host with the given parts: `createTestEngine(parts)` of
   *  app/src/engine/testing.ts gives it. */
  createEngine(parts: Partial<SimHostParts>): Promise<SimEngine>;
  /** The real assembler: `assembleProgram(lines)` of app/src/engine/testing.ts. */
  assemble(source: readonly string[]): Promise<{ s68: Bytes; l68: Bytes }>;
}

export interface BedOptions {
  os?: Platform['os'];
  /** Other members of the platform, for example `kind: 'desktop'` with `setFullScreen`. */
  platform?: Partial<Platform>;
  /** Default: time that moves only by `time.advance()` (see ManualTime). */
  clock?: Clock;
  scheduler?: Scheduler;
  /** Where the keyboard dispatcher listens (the window, in a browser); default: no dispatcher. */
  keyTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** Pictures for the characters of the text double; default: blocks. */
  glyph?: (ch: number) => Glyph;
}

/** The simulator commands of other packages whose shortcuts act in the Output panel (2.9.4 rule 2). */
export const RECORDED_COMMANDS = [
  'sim.file.open',
  'sim.run.run',
  'sim.run.stepOver',
  'sim.run.traceInto',
  'sim.run.pause',
  'sim.run.rewind',
  'sim.run.reload',
  'sim.run.autoTrace',
  'sim.run.runToCursor',
  'sim.run.logStart',
  'sim.run.logStop',
  'sim.search.find',
  'sim.search.gotoPC',
] as const;

/** Time for tests under Node: it moves only when the test says so. */
export class ManualTime implements Clock, Scheduler {
  private time = 0;
  private readonly frames = new Set<(now: number) => void>();
  private timers: { due: number; fn: () => void }[] = [];

  now(): number {
    return this.time;
  }
  wallTime(): Date {
    return new Date(2026, 10, 20, 12, 0, 0);
  }
  onFrame(fn: (now: number) => void): () => void {
    this.frames.add(fn);
    return () => {
      this.frames.delete(fn);
    };
  }
  setTimer(delayMs: number, fn: () => void): () => void {
    const timer = { due: this.time + Math.max(delayMs, 0), fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((other) => other !== timer);
    };
  }
  /** Moves the clock on by `ms`, runs the timers that are due (in order of their time), then one frame. */
  advance(ms = 0): void {
    const end = this.time + ms;
    for (;;) {
      const next = this.timers.filter((timer) => timer.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.timers = this.timers.filter((timer) => timer !== next);
      this.time = Math.max(this.time, next.due);
      next.fn();
    }
    this.time = end;
    for (const frame of [...this.frames]) frame(this.time);
  }
}

export interface OutputBed {
  readonly app: TestApplication;
  readonly ctx: AppContext;
  readonly engine: SimEngine;
  readonly controller: MiniController;
  readonly surface: PixelSurface;
  readonly text: TextGrid;
  /** Present when no clock was passed in: the bed's own time. */
  readonly time: ManualTime | null;
  /** The ids of the recorded commands that ran, oldest first. */
  readonly commandsRun: string[];
  /** Recorded commands in this set report themselves disabled. */
  readonly disabledCommands: Set<string>;
  /** The lines the engine wrote to the simulator's message area. */
  readonly messages: string[];
  /** Assembles a program and loads it; Run then starts it. */
  load(source: readonly string[]): Promise<void>;
  /** Presses Run. */
  run(): void;
  byte(address: number): number;
  long(address: number): number;
  bytes(address: number, length: number): number[];
  /** The NUL-terminated text at `address`, decoded as Windows-1252. */
  string(address: number): string;
  poke(address: number, bytes: ArrayLike<number>): void;
  dispose(): void;
}

/** A session part that nothing in these tests uses: every method does nothing. */
function unused<T extends object>(): T {
  return new Proxy({}, { get: (_target, key) => (typeof key === 'symbol' ? undefined : () => undefined) }) as T;
}

export async function createOutputBed(env: BedEnv, options: BedOptions = {}): Promise<OutputBed> {
  const time = options.clock && options.scheduler ? null : new ManualTime();
  const clock = options.clock ?? (time as ManualTime);
  const scheduler = options.scheduler ?? (time as ManualTime);
  const os = options.os ?? 'windows';

  // The host parts exist before the application does: the engine calls them while it starts.
  const late: { ctx: AppContext | null; controller: MiniController | null } = { ctx: null, controller: null };
  const messages: string[] = [];
  const surface = new PixelSurface(640, 480);
  const text = new TextGrid({
    surface,
    ...(options.glyph ? { glyph: options.glyph } : {}),
    show: () => late.ctx && showPanel(late.ctx, 'output', { focus: false }),
    bringToFront: () => late.ctx && focusPanel(late.ctx, 'output'),
  });
  const nothing = () => {};
  const main: HostMain = {
    message: (line) => void messages.push(decode(line)),
    messagesClear: () => void (messages.length = 0),
    alert: (title, body) => void late.controller?.alerts.push({ title: decode(title), text: decode(body) }),
    keyCommands: (enabled) =>
      late.ctx?.store.setState((state) =>
        state.sim.keyCommands === enabled ? state : { ...state, sim: { ...state.sim, keyCommands: enabled } },
      ),
    timeCentiseconds: () => 0,
    registersShown: nothing,
    menuState: nothing,
    focusMain: nothing,
    autoTraceTimer: nothing,
    optionChanged: nothing,
    saveSettings: nothing,
    caption: nothing,
    repaint: nothing,
    memoryLivePaint: nothing,
    fontAssign: nothing,
  };
  const graphics: HostIoGraphics = {
    setLineColor: (color) => surface.setLineColor(color),
    setFillColor: (color) => surface.setFillColor(color),
    drawPixel: (x, y) => surface.drawPixel(x, y),
    getPixel: (x, y) => surface.getPixel(x, y),
    line: (x1, y1, x2, y2) => surface.line(x1, y1, x2, y2),
    lineTo: (x, y) => surface.lineTo(x, y),
    moveTo: (x, y) => surface.moveTo(x, y),
    rectangle: (x1, y1, x2, y2) => surface.rectangle(x1, y1, x2, y2),
    ellipse: nothing,
    floodFill: nothing,
    unfilledRectangle: nothing,
    unfilledEllipse: nothing,
    setDrawingMode: (mode) => surface.setDrawingMode(mode),
    setPenWidth: (width) => surface.setPenWidth(width),
    formPaint: () => surface.formPaint(),
    drawText: nothing,
    getXY: () => surface.getXY(),
  };

  const engine = await env.createEngine({ main, text, graphics });
  const controller = new MiniController({ engine: () => engine, clock, scheduler });
  late.controller = controller;

  // The one host method the Output feature calls itself is setWindowSize (Options > Output Window
  // Size); the object answers every name so that it can stand for a whole SimHost.
  const parts: object[] = [text, graphics, main];
  const host = new Proxy(
    {},
    {
      get(_target, name) {
        for (const part of parts) {
          const method = (part as Record<string | symbol, unknown>)[name];
          if (typeof method === 'function') return method.bind(part) as unknown;
        }
        return typeof name === 'symbol' ? undefined : nothing;
      },
    },
  ) as SimHost;

  const commandsRun: string[] = [];
  const disabledCommands = new Set<string>();
  const recorder: FeatureModule = {
    id: 'output-test-recorder',
    commands: Object.fromEntries(
      RECORDED_COMMANDS.map((id) => [
        id,
        {
          run() {
            commandsRun.push(id);
            if (id === 'sim.run.run') controller.run();
            if (id === 'sim.run.pause') controller.pause();
          },
          enabled: () => !disabledCommands.has(id),
        },
      ]),
    ),
  };

  const app = createTestApplication({
    features: [feature, recorder],
    platform: createFakePlatform({ os, ...options.platform }),
    clock,
    scheduler,
    ...(options.keyTarget ? { keyTarget: options.keyTarget } : {}),
    services: {
      createSimSession: (): SimSession => ({
        engine,
        host,
        controller,
        surface,
        text,
        keyboard: new OutputKeyboard({ post: (event) => controller.post(event), os }),
        sound: unused(),
        hardware: unused(),
        listing: unused(),
        log: unused(),
        files: unused(),
        printer: unused(),
        glyphs: unused(),
        onEngineReplaced: () => () => {},
      }),
    },
  });
  late.ctx = app.ctx;
  // The session's mirror of the Output window's size and text-wrap option (see the header).
  const mirrorOutput = (): void =>
    app.ctx.store.setState((state) => {
      const { output } = state.sim;
      const { width, height } = surface.back;
      const { textWrap } = text.state;
      if (output.width === width && output.height === height && output.textWrap === textWrap) return state;
      return { ...state, sim: { ...state.sim, output: { ...output, width, height, textWrap } } };
    });
  mirrorOutput();
  const stopMirror = scheduler.onFrame(mirrorOutput);
  // The engine's start-up state: key commands on (it said so before the application existed).
  main.keyCommands(!engine.state().keyCommandsDisabled);
  await app.ctx.commands.run('app.mode.set', 'simulator');

  return {
    app,
    ctx: app.ctx,
    engine,
    controller,
    surface,
    text,
    time,
    commandsRun,
    disabledCommands,
    messages,
    async load(source) {
      const { s68, l68 } = await env.assemble(source);
      engine.load(s68, l68, { name: 'output-test.S68' });
      controller.phase = 'idle';
    },
    run: () => controller.run(),
    byte: (address) => engine.readByte(address),
    long: (address) => engine.readLong(address) >>> 0,
    bytes: (address, length) => Array.from({ length }, (_, index) => engine.readByte(address + index)),
    string(address) {
      const bytes: number[] = [];
      for (let at = address; bytes.length < 4096; at++) {
        const byte = engine.readByte(at);
        if (byte === 0) break;
        bytes.push(byte);
      }
      return decode(Uint8Array.from(bytes));
    },
    poke: (address, bytes) => engine.writeBytes(address, bytes),
    dispose() {
      stopMirror();
      controller.stop();
      app.dispose();
    },
  };
}
