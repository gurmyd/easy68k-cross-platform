// Test support for the run controller: a `SimRunController` on the real engine, with virtual time,
// a recording host, and small doubles for everything else. Imported only by unit tests.
//
// The device parts (surface, text, files, log ...) are being written by other packages and are
// tested there; the controller's tests must not depend on them. The kit therefore gives the
// controller:
//
//   - the real engine (through `KitEnv.engines`), each instance behind a proxy that writes every
//     method call into `engineLog`;
//   - the recording host of app/src/engine/testing.ts with the real `SimUiBridge` as its `main`
//     part and a few lines of hardware double that run the seven auto-interrupt timers; every
//     other host method records its call and answers with the engine's default;
//   - doubles for program files, log, listing and the cold-start hooks, which write what was asked
//     of them into `events` and can be made to wait (`block`), so that a test can look at the
//     controller in the middle of a load.
//
// core/ may not import app/src/engine or app/src/fs (3.1), so the test file passes those in as
// `KitEnv`; this file knows them only by their contract types.
//
// Owner: SH8.

import type {
  Bytes,
  Clock,
  HardwareModelApi,
  HostHardware,
  ListingViewApi,
  LogServiceApi,
  OutputDeviceApi,
  OutputKeyboardApi,
  PrinterDeviceApi,
  ProgramFilesApi,
  ProgramInfo,
  Scheduler,
  SimEngine,
  SimEngineFactory,
  SimHost,
  SimHostParts,
  SoftTimerApi,
  SoundDeviceApi,
  SurfaceApi,
  TextScreenApi,
  Vfs,
  VPath,
} from '../../contracts';
import { decode } from '../codec/cp1252';
import { VirtualTime } from './clock';
import type { SessionPartOverrides } from './compose';
import { SimRunController, type CommandLineSwitches, type RunControllerDeps } from './controller';
import type { SpeedSetting } from './governor';
import { TimerSet } from './timers';
import { SimUiBridge } from './ui-bridge';

/** One call the engine made to the host (`createRecordingHost` of app/src/engine/testing.ts). */
export interface RecordedCall {
  method: string;
  args: unknown[];
}

/** What the kit needs from outside core/. */
export interface KitEnv {
  /** `{ create: createSimEngine, release: releaseSimEngine }` of app/src/engine. */
  engines: SimEngineFactory;
  /** `createRecordingHost` of app/src/engine/testing.ts. */
  recordingHost(parts: Partial<SimHostParts>): { host: SimHost; calls: RecordedCall[]; forget(): void };
  /** A new file system with a memory backend mounted at `/memory`. */
  vfs(): Vfs;
}

export interface KitOptions {
  speed?: SpeedSetting;
  /** Stands in front of every engine the kit creates: a fault injector, a clock that moves ... */
  wrapEngine?: (engine: SimEngine, ordinal: number) => SimEngine;
  /** The answer to the Caution question; default OK. */
  caution?: () => boolean | Promise<boolean>;
  commandLine?: Partial<CommandLineSwitches>;
  /** What a cold start applies to a new engine (4.7.1 step 4); default nothing. */
  applySettings?: (engine: SimEngine) => void;
  partsUntouched?: () => boolean;
  settingsUnchanged?: () => boolean;
  /** Host parts of the test's own, next to the bridge and the hardware double (see `partOf`). */
  parts?: Partial<Omit<SimHostParts, 'main' | 'hardware'>>;
  /** Called when a cold start resets the parts (4.7.1 step 2). */
  onReset?: () => void;
  /** Another clock and scheduler than the kit's VirtualTime (which then only serves `kit.time`). */
  clock?: Clock;
  scheduler?: Scheduler;
  /** false: do not start the controller; the test calls `controller.start()` itself. */
  start?: boolean;
  /** `ControllerUi.cursorRow`: the listing row selected now. Absent = the member is absent. */
  cursorRow?: () => number;
}

/** A step of a load that a test can make wait. */
export type BlockableStep = 'exit' | 'setCurrentDir' | 'revalidate' | 'glyphs' | 'caution' | 'create';

/** A program to put into the file system. */
export interface KitProgram {
  s68: Bytes;
  l68?: Bytes | null;
}

export interface Kit {
  time: VirtualTime;
  controller: SimRunController;
  bridge: SimUiBridge;
  timers: TimerSet;
  vfs: Vfs;
  /** The host the engines are created with. */
  host: SimHost;
  /** Every call the engine made to the host, in order. */
  calls: RecordedCall[];
  /** What the controller asked of its surroundings, in order: 'exit', 'reset', 'stopped' ... */
  events: string[];
  /** Every engine method called, in order, as `#<instance>.<method>`. */
  engineLog: string[];
  /** `events` and `engineLog` in one sequence; engine calls as `engine.<method>`. */
  timeline: string[];
  /** The speed setting; change it at any time. */
  speed: SpeedSetting;
  autoTraceIntervalMs: number;
  /** The rows the listing double read at its last refresh. */
  listingRows: string[];
  /** How many engines were created and released. */
  created: number;
  released: number;
  /** The seven auto-interrupt timers of the hardware double, index 1..7. */
  hardwareTimers: (SoftTimerApi | null)[];
  /** Makes the next occurrence of a step wait; the returned function lets it go on. */
  block(step: BlockableStep): () => void;
  /** Writes the program's files into the file system. */
  put(path: VPath, program: KitProgram): Promise<void>;
  /** `put`, then `controller.open`. */
  open(program: KitProgram, origin?: Parameters<SimRunController['open']>[1], path?: VPath): Promise<void>;
  /** The message area as text lines. */
  messages(): readonly string[];
  /** The index of the first listing row that holds `text`, or -1. */
  row(text: string): number;
  /** Calls that can change the engine since the last `forgetEngineLog()`, without the instance prefix. */
  engineCalls(): string[];
  forgetEngineLog(): void;
  program(): ProgramInfo | null;
  dispose(): void;
}

/** Engine methods that only read: `Kit.engineCalls()` leaves them out. */
const ENGINE_READS: ReadonlySet<string> = new Set([
  'readByte',
  'readWord',
  'readLong',
  'getRegister',
  'registers',
  'boxText',
  'state',
  'getOption',
  'hardware',
  'breakpoints',
  'listingLine',
]);

/** The default path of `Kit.open`. */
export const KIT_PROGRAM_PATH: VPath = '/memory/work/program.S68';

/** sim-ui §6.2: the test the original applies to a listing row. */
export function isInstructionRow(row: string): boolean {
  return row.slice(0, 2) === '00' && row.length >= 11 && row[10] !== ' ' && row[8] !== '=' && row[10] !== '=';
}

/** Runs the seven auto-interrupt timers the engine asks for; everything else is ignored. */
class HardwareDouble implements HostHardware {
  readonly timers: (SoftTimerApi | null)[] = [null];
  enabled = true;
  autoIRQ = false;

  constructor(timers: TimerSet, post: SimRunController['post']) {
    for (let level = 1; level <= 7; level++) {
      this.timers.push(timers.create(() => post({ kind: 'timerTick', level })));
    }
  }

  hardwareUpdate(): void {}
  hardwareState(hardwareEnabled: boolean, autoIRQ: boolean): void {
    this.enabled = hardwareEnabled;
    this.autoIRQ = autoIRQ;
  }
  hardwareTimer(level: number, enabled: boolean, intervalMs: number): void {
    const timer = this.timers[level];
    if (!timer) return;
    timer.intervalMs = intervalMs;
    timer.enabled = enabled;
  }
  hardwareShow(): void {}
  hardwareControls(): void {}
  resetToStartup(): void {
    for (const timer of this.timers) if (timer) timer.enabled = false;
  }
}

/**
 * A host part made of the given methods; every other method of the part does nothing and returns
 * undefined (the engine then keeps its default). For the few methods a test wants to answer itself.
 */
export function partOf<Part extends object>(methods: Partial<Part>): Part {
  return new Proxy(methods as Part, {
    get: (target, property) => (property in target ? Reflect.get(target, property, target) : () => undefined),
  });
}

/** Doubles for every device of a session (`SessionEnv.parts`), with what they were asked to do. */
export interface DeviceDoubles {
  parts: SessionPartOverrides;
  /** The text the program printed (tasks 0, 1, 13, 14 ...), one entry per call; a CR LF call ends in "
". */
  printed: string[];
  /** The resets and exits of a cold start, in order: 'log.exit', 'surface', 'font:Fixedsys,9' ... */
  resets: string[];
  /** The task 58 dialogs the program asked for. */
  fileDialogs: { mode: number; title: string; filter: string; fileName: string }[];
}

/**
 * A double for each device of a simulator session: enough state for the session to be composed and
 * to run a program, and a record of what reached it. A test of the composition uses these instead
 * of the devices at their final paths, which belong to other packages.
 */
export function createDeviceDoubles(overrides: Partial<SessionPartOverrides> = {}): DeviceDoubles {
  const printed: string[] = [];
  const resets: string[] = [];
  const fileDialogs: DeviceDoubles['fileDialogs'] = [];
  const reset = (name: string) => () => void resets.push(name);
  const parts: SessionPartOverrides = {
    surface: partOf<SurfaceApi>({
      back: { width: 640, height: 480, data: new Uint32Array(0) },
      resetToStartup: reset('surface'),
    }),
    text: partOf<TextScreenApi>({
      state: { textWrap: false, optionsFontColor: 0xffffff } as TextScreenApi['state'],
      resetToStartup: reset('text'),
      setOptionsFont: (font) => void resets.push(`font:${font.name},${font.size}`),
    }),
    output: partOf<OutputDeviceApi>({
      textOut: (text) => void printed.push(decode(text)),
      textOutCR: (text) =>
        void printed.push(`${decode(text)}
`),
      getPixel: () => 0,
    }),
    keyboard: partOf<OutputKeyboardApi>({ resetToStartup: reset('keyboard') }),
    sound: partOf<SoundDeviceApi>({ resetToStartup: reset('sound') }),
    hardware: partOf<HardwareModelApi>({ resetToStartup: reset('hardware') }),
    log: partOf<LogServiceApi>({
      resetToStartup: reset('log'),
      exit: async () => void resets.push('log.exit'),
      flush: async () => {},
      unsaved: false,
    }),
    files: partOf<ProgramFilesApi>({
      resetToStartup: reset('files'),
      exit: async () => void resets.push('files.exit'),
      setCurrentDir: async () => {},
      revalidateIfStale: async () => {},
      recoverJournal: async () => {},
      unsaved: false,
      fileOpen: () => 0,
      fileRead: () => null,
      fileWrite: () => -1,
      fileSeek: () => -1,
      fileClose: () => false,
      fileRemove: () => false,
      fileDialog: (mode, title, filter, fileName) =>
        void fileDialogs.push({ mode, title: decode(title), filter: decode(filter), fileName: decode(fileName) }),
    }),
    printer: partOf<PrinterDeviceApi>({ resetToStartup: reset('printer'), printerMetric: () => 0 }),
    listing: partOf<ListingViewApi>({ refresh: () => {}, isInstruction: () => true }),
    ...overrides,
  };
  return { parts, printed, resets, fileDialogs };
}

/** An engine that writes every method call into `log`; getters are read without a record. */
function recordEngine(engine: SimEngine, ordinal: number, log: (entry: string) => void): SimEngine {
  const methods = new Map<string, (...args: unknown[]) => unknown>();
  return new Proxy(engine, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof property !== 'string' || typeof value !== 'function') return value;
      let method = methods.get(property);
      if (!method) {
        method = (...args: unknown[]): unknown => {
          log(`#${ordinal}.${property}`);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
        methods.set(property, method);
      }
      return method;
    },
  });
}

export async function createKit(env: KitEnv, options: KitOptions = {}): Promise<Kit> {
  const time = new VirtualTime();
  const clock = options.clock ?? time;
  const scheduler = options.scheduler ?? time;
  const timers = new TimerSet(clock);
  const timeline: string[] = [];
  const engineLog: string[] = [];
  const events: string[] = [];
  /** Records something the controller asked of its surroundings. */
  const note = (entry: string): void => {
    events.push(entry);
    timeline.push(entry);
  };
  const logEngine = (entry: string): void => {
    engineLog.push(entry);
    timeline.push(`engine.${entry.slice(entry.indexOf('.') + 1)}`);
  };
  const vfs = env.vfs();
  const blocks = new Map<BlockableStep, Promise<void>>();
  const inner = new WeakMap<SimEngine, SimEngine>();
  let logStart = 0;

  /** Waits if a test has blocked this step. */
  const pass = async (step: BlockableStep): Promise<void> => {
    const gate = blocks.get(step);
    if (gate) {
      blocks.delete(step);
      await gate;
    }
  };

  const kit = {
    time,
    timers,
    vfs,
    events,
    engineLog,
    timeline,
    speed: options.speed ?? { mode: 'original', instructionsPerSecond: 1_000_000 },
    autoTraceIntervalMs: 200,
    listingRows: [] as string[],
    created: 0,
    released: 0,
  } as Kit;

  const bridge = new SimUiBridge({
    clock,
    timers,
    post: (request) => kit.controller.post(request),
    autoTraceIntervalMs: () => kit.autoTraceIntervalMs,
    optionChanged: (option, value) => note(`option:${option}=${value}`),
    saveSettings: () => note('saveSettings'),
    focusMain: () => note('focusMain'),
    textFontAssign: () => {},
    printerFontChanged: () => {},
  });
  const hardware = new HardwareDouble(timers, (entry) => kit.controller.post(entry));
  const recording = env.recordingHost({ ...options.parts, main: bridge, hardware });

  const engines: SimEngineFactory = {
    async create(host) {
      note('engine.create');
      await pass('create');
      const ordinal = ++kit.created;
      const real = await env.engines.create(host);
      const wrapped = options.wrapEngine ? options.wrapEngine(real, ordinal) : real;
      const recorded = recordEngine(wrapped, ordinal, logEngine);
      inner.set(recorded, wrapped);
      return recorded;
    },
    release(engine) {
      note('engine.release');
      kit.released++;
      env.engines.release(inner.get(engine) ?? engine);
    },
  };

  const deps: RunControllerDeps = {
    clock,
    scheduler,
    engines,
    host: recording.host,
    bridge,
    timers,
    speed: () => kit.speed,
    vfs,
    glyphs: {
      get ready() {
        return pass('glyphs');
      },
    },
    files: {
      async setCurrentDir(dir) {
        note(`setCurrentDir:${dir}`);
        await pass('setCurrentDir');
      },
      async revalidateIfStale() {
        note('revalidate');
        await pass('revalidate');
      },
    },
    log: { setLogFileNames: (path) => void note(`setLogFileNames:${path}`) },
    listing: {
      refresh() {
        note('listing.refresh');
        const engine = kit.controller.engine;
        kit.listingRows = Array.from({ length: engine.listingLineCount }, (_, i) => decode(engine.listingLine(i)));
      },
      isInstruction: (row) => isInstructionRow(kit.listingRows[row] ?? ''),
    },
    lifecycle: {
      async exit() {
        note('exit');
        await pass('exit');
      },
      resetToStartup() {
        note('reset');
        hardware.resetToStartup();
        options.onReset?.();
      },
      applySettings(engine) {
        note('apply');
        options.applySettings?.(engine);
      },
      stopped: () => void note('stopped'),
    },
    ui: {
      async confirmCaution() {
        note('caution');
        await pass('caution');
        return options.caution ? options.caution() : true;
      },
      resumeAudio: () => void note('audio'),
      enterFullScreen: () => void note('fullscreen'),
      displayName: (path) => path,
      commandLine: () => ({
        run: false,
        fullScreen: false,
        exceptions: false,
        bitField: false,
        ...options.commandLine,
      }),
      report: (what, error) => void note(`report:${what}: ${error instanceof Error ? error.message : String(error)}`),
      ...(options.cursorRow ? { cursorRow: options.cursorRow } : {}),
    },
    ...(options.partsUntouched ? { partsUntouched: options.partsUntouched } : {}),
    ...(options.settingsUnchanged ? { settingsUnchanged: options.settingsUnchanged } : {}),
  };

  kit.controller = new SimRunController(deps);
  kit.bridge = bridge;
  kit.host = recording.host;
  kit.calls = recording.calls;
  kit.hardwareTimers = hardware.timers;
  kit.block = (step) => {
    let release: () => void = () => {};
    blocks.set(step, new Promise<void>((resolve) => (release = resolve)));
    return release;
  };
  kit.put = async (path, program) => {
    await vfs.writeFile(path, program.s68);
    if (program.l68) await vfs.writeFile(path.replace(/\.[^./]*$/, '.L68'), program.l68);
  };
  kit.open = async (program, origin = 'open', path = KIT_PROGRAM_PATH) => {
    await kit.put(path, program);
    await kit.controller.open(path, origin);
  };
  kit.messages = () => bridge.state.messageLines;
  kit.row = (text) => kit.listingRows.findIndex((row) => row.includes(text));
  kit.engineCalls = () =>
    engineLog
      .slice(logStart)
      .map((entry) => entry.slice(entry.indexOf('.') + 1))
      .filter((name) => !ENGINE_READS.has(name));
  kit.forgetEngineLog = () => {
    logStart = engineLog.length;
  };
  kit.program = () => kit.controller.program;
  kit.dispose = () => kit.controller.dispose();

  if (options.start !== false) await kit.controller.start();
  return kit;
}
