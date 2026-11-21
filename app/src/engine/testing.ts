// Test helpers around the real engines (ARCHITECTURE.md 9.1 W4, 6.4). For unit tests of any package;
// never imported by the application.
//
//   createRecordingHost(parts?)   a SimHost that records every call
//   createTestEngine(parts?)      the real simulator engine on a recording host
//   withFaults(engine, plan)      a SimEngine that throws or returns a chosen value at a chosen call
//   assembleProgram(source)       the real assembler on a source text: the .S68 and .L68 bytes
//   runProgram(engine, script?)   runs a loaded program to its stop, serving the wait states
//   createMemoryFiles()           a small `files` part for the host: program files in memory
//   TRAP15_TOUR, runTrap15Tour()  a 68000 program that calls every TRAP #15 task
//
// Owner: W4.

import {
  FileMode,
  RunStatus,
  SimOption,
  TabType,
  type AsmOptions,
  type AsmResult,
  type Bytes,
  type HostFiles,
  type HostHardware,
  type HostIoGraphics,
  type HostIoText,
  type HostLog,
  type HostMain,
  type HostNet,
  type HostPrinter,
  type HostSerial,
  type HostSound,
  type SimEngine,
  type SimHost,
} from '../contracts';
import { createAsmEngine } from './asm';
import { createSimEngine, HOST_PART_DEFAULTS, releaseSimEngine, releaseThrough } from './sim';

// ---- recording host -------------------------------------------------------------------------------

/** One call the engine made to the host. Byte arguments are the engine's copies. */
export interface HostCall {
  method: keyof SimHost;
  args: unknown[];
}

/** The ten parts a host is composed of (the `SimHostParts` of 3.3.1). */
export interface HostParts {
  main: HostMain;
  hardware: HostHardware;
  log: HostLog;
  files: HostFiles;
  text: HostIoText;
  graphics: HostIoGraphics;
  sound: HostSound;
  serial: HostSerial;
  net: HostNet;
  printer: HostPrinter;
}

export interface RecordingHost {
  /** The host to give to `createSimEngine`. */
  host: SimHost;
  /** Every call so far, in order. */
  calls: HostCall[];
  /** The argument lists of the calls to one method, in order. */
  callsTo<K extends keyof SimHost>(method: K): Parameters<SimHost[K]>[];
  /** The methods called so far, each once, in the order of their first call. */
  methodsCalled(): (keyof SimHost)[];
  /** Forgets the calls recorded so far. */
  forget(): void;
}

/**
 * A host in which every `SimHost` method records its call and returns the engine's default (what
 * the engine uses when a host has no such method).
 *
 * A part given in `parts` replaces the recording methods of that part: its methods are called and
 * their results returned. Those calls are recorded as well.
 */
export function createRecordingHost(parts: Partial<HostParts> = {}): RecordingHost {
  const calls: HostCall[] = [];
  const host: Record<string, unknown> = {};
  for (const [partName, defaults] of Object.entries(HOST_PART_DEFAULTS)) {
    const part = parts[partName as keyof HostParts] as Record<string, unknown> | undefined;
    for (const [name, fallback] of Object.entries(defaults)) {
      const method = name as keyof SimHost;
      const real = part?.[name];
      if (part && typeof real !== 'function')
        throw new TypeError(`createRecordingHost: part ${partName} has no method ${name}`);
      host[name] = (...args: unknown[]): unknown => {
        calls.push({ method, args });
        return typeof real === 'function' ? (real as (...a: unknown[]) => unknown).apply(part, args) : fallback;
      };
    }
  }
  return {
    host: host as unknown as SimHost,
    calls,
    callsTo: <K extends keyof SimHost>(method: K) =>
      calls.filter((call) => call.method === method).map((call) => call.args as Parameters<SimHost[K]>),
    methodsCalled: () => [...new Set(calls.map((call) => call.method))],
    forget: () => {
      calls.length = 0;
    },
  };
}

/** The real simulator engine with the recording host it runs on. */
export interface TestEngine extends RecordingHost {
  engine: SimEngine;
  /** `releaseSimEngine(engine)`. */
  release(): void;
}

/**
 * The real engine (engine/dist) with a recording host in which the given parts are replaced. The
 * calls the engine makes while it starts up are already in `calls`.
 */
export async function createTestEngine(parts: Partial<HostParts> = {}): Promise<TestEngine> {
  const recording = createRecordingHost(parts);
  const engine = await createSimEngine(recording.host);
  return { ...recording, engine, release: () => releaseSimEngine(engine) };
}

// ---- fault injection ------------------------------------------------------------------------------

/**
 * One fault: at use number `call` of the member `at`, the engine is not called; the wrapper throws
 * `throws` or returns `returns` instead. Uses are counted from 1, separately for each member, from
 * the moment `withFaults` is called. For a getter (`memory`, `cycles`, ...) every read is a use.
 */
export type Fault = { at: keyof SimEngine; call?: number } & ({ throws: unknown } | { returns: unknown });

/**
 * A `SimEngine` that behaves as `engine` except at the calls of `plan`. Typical plans: a
 * WebAssembly trap in the middle of a run, `{ at: 'run', call: 3, throws: new Error('unreachable') }`,
 * or a status the engine rarely gives, `{ at: 'run', returns: RunStatus.Error }`.
 * `releaseSimEngine` on the wrapper releases `engine`.
 */
export function withFaults(engine: SimEngine, plan: Fault | readonly Fault[]): SimEngine {
  const faults: readonly Fault[] = Array.isArray(plan) ? plan : [plan as Fault];
  const uses = new Map<string, number>();
  const methods = new Map<string, (...args: unknown[]) => unknown>();

  /** Counts a use of `member`; returns the fault planned for it, if any. */
  const faultAt = (member: string): Fault | undefined => {
    const use = (uses.get(member) ?? 0) + 1;
    uses.set(member, use);
    return faults.find((fault) => fault.at === member && (fault.call ?? 1) === use);
  };
  const happen = (fault: Fault): unknown => {
    if ('throws' in fault) throw fault.throws;
    return fault.returns;
  };

  const wrapper = new Proxy(engine, {
    get(target, property) {
      if (typeof property !== 'string') return Reflect.get(target, property, target);
      if (isGetter(target, property)) {
        const fault = faultAt(property);
        return fault ? happen(fault) : Reflect.get(target, property, target);
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      let method = methods.get(property);
      if (!method) {
        method = (...args: unknown[]): unknown => {
          const fault = faultAt(property);
          // Called on the engine itself, not on the wrapper: the binding keeps private state.
          return fault ? happen(fault) : (value as (...a: unknown[]) => unknown).apply(target, args);
        };
        methods.set(property, method);
      }
      return method;
    },
  });
  releaseThrough(wrapper, engine);
  return wrapper;
}

function isGetter(object: object, property: string): boolean {
  for (let o: object | null = object; o; o = Object.getPrototypeOf(o) as object | null) {
    const descriptor = Object.getOwnPropertyDescriptor(o, property);
    if (descriptor) return typeof descriptor.get === 'function';
  }
  return false;
}

// ---- assembling and running programs --------------------------------------------------------------

/** Text as bytes, one byte per character (the low 8 bits of each code unit), as the engines take it. */
export function bytesOf(text: string): Bytes {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
}

/** Bytes as text, one character per byte. */
export function textOf(bytes: ArrayLike<number>): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i] as number);
  return text;
}

/** The assembler options of a fresh EASy68K installation (editor-ui §11.4). */
export const TEST_ASM_OPTIONS: AsmOptions = {
  generateListing: true,
  generateSRecord: true,
  constantsExpanded: false,
  bitFieldInstructions: true,
  crossReference: true,
  macrosExpanded: false,
  structuredExpanded: false,
  showWarnings: true,
  tabType: TabType.Fixed,
  tabSize: 4,
};

/** The date on the "Created On:" line of listings made by `assembleProgram`. */
export const TEST_ASM_TIME = new Date(2026, 0, 1, 12, 0, 0);

export interface AssembledProgram {
  /** The .S68 file. */
  s68: Bytes;
  /** The .L68 file. */
  l68: Bytes;
  result: AsmResult;
}

/**
 * Assembles a 68000 source with the real assembler, as `program.X68`. `source` is the text of the
 * program, or its lines; `files` are files it may INCLUDE or INCBIN, by name. Throws when the
 * program has errors, with the messages in the text.
 */
export async function assembleProgram(
  source: string | readonly string[],
  files: Readonly<Record<string, Bytes | string>> = {},
  options: Partial<AsmOptions> = {},
): Promise<AssembledProgram> {
  const text = typeof source === 'string' ? source : source.map((line) => `${line}\r\n`).join('');
  const all = new Map<string, Bytes>([['program.X68', bytesOf(text)]]);
  for (const [name, data] of Object.entries(files)) all.set(name, typeof data === 'string' ? bytesOf(data) : data);
  const asm = await createAsmEngine();
  const result = await asm.assemble('program.X68', all, { ...TEST_ASM_OPTIONS, ...options }, TEST_ASM_TIME);
  if (result.fatal !== null) throw new Error(`assembleProgram: ${result.fatal}`);
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    const messages = result.messages.map((message) => `line ${message.line}: ${message.text}`).join('\n');
    throw new Error(`assembleProgram: ${result.errorCount} error(s)\n${messages}`);
  }
  return { s68: result.sRecord, l68: result.listing, result };
}

/** What `runProgram` does at the wait states. All of it is plain data, so it can be sent to a page. */
export interface RunScript {
  /** Characters to type, one entry per keyboard wait, in order. `\n` and `\r` are the Enter key.
   *  A keyboard wait with no entry left ends the run (`reason: 'input'`). */
  keys?: string[];
  /** Answers to the TRAP #15 task 58 dialog, in order. With none left the dialog is cancelled. */
  dialogs?: { accepted: boolean; fileName?: string }[];
  /** Instructions per `run()` call. Default 100 000. */
  slice?: number;
  /** The run ends with `reason: 'limit'` after this many instructions. Default 20 million. */
  maxInstructions?: number;
  /** false: do not press Run first, only continue what is in progress. Default true. */
  start?: boolean;
}

export interface RunReport {
  /** Why the run ended: the program stopped (halt, breakpoint, pause), it waits for keys the script
   *  does not have, the instruction limit was reached, or `run()` returned `Error` or `Busy`. */
  reason: 'stopped' | 'input' | 'limit' | 'error';
  /** `state().halt` at the end: the program reached SIMHALT, task 9 or a halting error. */
  halted: boolean;
  /** Every status `run()` returned, without repetitions of the same status in a row. */
  statuses: RunStatus[];
  /** Instructions executed. */
  instructions: number;
}

/**
 * Presses Run and calls `run()` until the program stops, doing the run controller's part at each
 * wait state: keys from the script for `WaitInput`, the whole remaining time for `WaitDelay`, the
 * script's answer for `WaitHost`, OK for `WaitAlert`.
 */
export function runProgram(engine: SimEngine, script: RunScript = {}): RunReport {
  const keys = [...(script.keys ?? [])];
  const dialogs = [...(script.dialogs ?? [])];
  const slice = script.slice ?? 100_000;
  const limit = script.maxInstructions ?? 20_000_000;
  const statuses: RunStatus[] = [];
  let instructions = 0;
  const report = (reason: RunReport['reason']): RunReport => ({
    reason,
    halted: engine.state().halt,
    statuses,
    instructions,
  });

  if (script.start !== false) engine.cmdRun();
  for (;;) {
    const before = engine.stepCount;
    const status = engine.run(slice);
    instructions += (engine.stepCount - before) >>> 0;
    if (statuses[statuses.length - 1] !== status) statuses.push(status);
    switch (status) {
      case RunStatus.Running:
        if (instructions >= limit) return report('limit');
        break;
      case RunStatus.Stopped:
        return report('stopped');
      case RunStatus.WaitInput: {
        const typed = keys.shift();
        if (typed === undefined) return report('input');
        for (const ch of typed) engine.keyChar(ch === '\n' ? 13 : ch.charCodeAt(0) & 0xff);
        break;
      }
      case RunStatus.WaitDelay:
        engine.delayElapsed(engine.delayRemaining);
        break;
      case RunStatus.WaitHost: {
        const answer = dialogs.shift();
        engine.fileDialogReply(answer?.accepted ?? false, answer?.fileName ?? '');
        break;
      }
      case RunStatus.WaitAlert:
        engine.dismissAlert();
        break;
      default:
        return report('error');
    }
  }
}

// ---- a host part for program files ----------------------------------------------------------------

/** `HostFiles` over a map in memory, with the files it holds. */
export interface MemoryFiles extends HostFiles {
  /** The files by upper-cased name. */
  files: Map<string, number[]>;
}

/**
 * A minimal `HostFiles` for tests of the engine boundary: files in a map, names compared without
 * regard to letter case, nothing buffered, no folders, a dialog that is only recorded. It is not the
 * application's file model (3.8.4).
 */
export function createMemoryFiles(initial: Readonly<Record<string, Bytes | string>> = {}): MemoryFiles {
  const files = new Map<string, number[]>();
  for (const [name, data] of Object.entries(initial)) {
    files.set(name.toUpperCase(), [...(typeof data === 'string' ? bytesOf(data) : data)]);
  }
  const open = new Map<number, { data: number[]; position: number; writable: boolean }>();
  let nextHandle = 1;
  const keyOf = (name: Bytes) => textOf(name).toUpperCase();
  return {
    files,
    fileOpen(name, mode) {
      const key = keyOf(name);
      let data = files.get(key);
      if (mode === FileMode.Create) {
        data = [];
        files.set(key, data);
      }
      if (!data) return 0;
      open.set(nextHandle, { data, position: 0, writable: mode !== FileMode.Read });
      return nextHandle++;
    },
    fileRead(handle, count) {
      const file = open.get(handle);
      if (!file) return null;
      const bytes = Uint8Array.from(file.data.slice(file.position, file.position + count));
      file.position += bytes.length;
      return bytes;
    },
    fileWrite(handle, data) {
      const file = open.get(handle);
      if (!file?.writable) return -1;
      while (file.data.length < file.position) file.data.push(0);
      for (const byte of data) file.data[file.position++] = byte;
      return data.length;
    },
    fileSeek(handle, offset, whence) {
      const file = open.get(handle);
      if (!file) return -1;
      const position = (whence === 0 ? 0 : whence === 1 ? file.position : file.data.length) + offset;
      if (position < 0) return -1;
      file.position = position;
      return position;
    },
    fileClose: (handle) => open.delete(handle),
    fileRemove: (name) => files.delete(keyOf(name)),
    fileDialog: () => {},
  };
}

// ---- the TRAP #15 tour ----------------------------------------------------------------------------

/** One TRAP #15 call of the tour program. */
export interface TourStep {
  /** The task number (D0.B). */
  task: number;
  /** What this call asks for. */
  what: string;
  /** Lines that load the registers the task reads. The program adds `MOVEQ #task,D0` and `TRAP #15`. */
  setup: string[];
  /** Characters typed when the task waits for the keyboard. */
  keys?: string;
  /** The answer to the dialog of task 58. */
  dialog?: { accepted: boolean; fileName?: string };
  /** The host methods the specs say this call reaches (trap15-a §4-§7, trap15-b §7-§12), on a
   *  recording host whose `files` part is `createMemoryFiles()`. */
  reaches: (keyof SimHost)[];
}

const INPUT_LINE: (keyof SimHost)[] = ['inputPrompt', 'ioShow', 'inputEcho', 'erasePrompt', 'doCRLF'];
const XY = ['MOVEQ #1,D1', 'MOVEQ #2,D2'];
const BOX = [...XY, 'MOVEQ #30,D3', 'MOVEQ #40,D4'];

/**
 * A program that calls every TRAP #15 task of EASy68K v5.16.1 (the inventory of trap15-a §1.2 and
 * trap15-b §2.1: 0-25, 30-33, 40-43, 50-59, 60-62, 70-77, 80-96, 100-107), with the host methods
 * each call reaches. Task 9 comes last because it ends the program.
 *
 * `trap15TourSource()` is its source and `runTrap15Tour()` runs it. Besides the binding's own test
 * it serves any test that wants the engine to visit the whole host once.
 */
export const TRAP15_TOUR: readonly TourStep[] = [
  // text output and keyboard input (trap15-a §4)
  {
    task: 0,
    what: 'display D1.W characters, then CR LF',
    setup: ['LEA TEXT,A1', 'MOVEQ #2,D1'],
    reaches: ['textOutCR'],
  },
  { task: 1, what: 'display D1.W characters', setup: ['LEA TEXT,A1', 'MOVEQ #2,D1'], reaches: ['textOut'] },
  {
    task: 2,
    what: 'read a string (with a Backspace)',
    setup: ['LEA BUFFER,A1'],
    keys: 'AX\bB\r',
    reaches: [...INPUT_LINE, 'inputBackspace'],
  },
  { task: 3, what: 'display D1.L as a signed number', setup: ['MOVEQ #-5,D1'], reaches: ['textOut'] },
  { task: 4, what: 'read a number', setup: [], keys: '42\r', reaches: INPUT_LINE },
  {
    task: 5,
    what: 'read a character',
    setup: [],
    keys: 'X',
    reaches: ['inputPrompt', 'ioShow', 'erasePrompt', 'charOut', 'invalidate'],
  },
  { task: 6, what: 'display the character in D1.B', setup: ['MOVEQ #65,D1'], reaches: ['charOut'] },
  { task: 7, what: 'is a key pending?', setup: [], reaches: [] },
  { task: 8, what: 'time since midnight', setup: [], reaches: ['timeCentiseconds'] },
  {
    task: 10,
    what: 'print a character and a form feed',
    setup: ['LEA PAGE,A1'],
    reaches: ['fontAssign', 'printerMetric', 'printerBeginDoc', 'printerTextOut', 'printerEndDoc'],
  },
  { task: 11, what: 'clear the screen', setup: ['MOVE.W #$FF00,D1'], reaches: ['clear'] },
  { task: 11, what: 'read the cursor position', setup: ['MOVE.W #$00FF,D1'], reaches: ['getrc'] },
  { task: 11, what: 'set the cursor position', setup: ['MOVE.W #$0102,D1'], reaches: ['gotorc'] },
  { task: 12, what: 'keyboard echo on', setup: ['MOVEQ #1,D1'], reaches: [] },
  { task: 13, what: 'display a string, then CR LF', setup: ['LEA TEXT,A1'], reaches: ['textOutCR'] },
  { task: 14, what: 'display a string', setup: ['LEA TEXT,A1'], reaches: ['textOut'] },
  { task: 15, what: 'display D1.L in base D2.B', setup: ['MOVEQ #10,D1', 'MOVEQ #16,D2'], reaches: ['textOut'] },
  { task: 16, what: 'input prompt on', setup: ['MOVEQ #1,D1'], reaches: [] },
  { task: 17, what: 'display a string, then D1.L', setup: ['LEA TEXT,A1', 'MOVEQ #5,D1'], reaches: ['textOut'] },
  {
    task: 18,
    what: 'display a string, then read a number',
    setup: ['LEA TEXT,A1'],
    keys: '7\r',
    reaches: ['textOut', ...INPUT_LINE],
  },
  { task: 19, what: 'key state', setup: ['MOVEQ #0,D1'], reaches: [] },
  { task: 20, what: 'display D1.L in a field', setup: ['MOVEQ #5,D1', 'MOVEQ #4,D2'], reaches: ['textOut'] },
  {
    task: 21,
    what: 'text colour and font',
    setup: ['MOVE.L #$00FFFFFF,D1', 'MOVEQ #0,D2'],
    reaches: ['setFontProperties'],
  },
  { task: 22, what: 'character at row, column', setup: ['MOVEQ #0,D1'], reaches: ['getCharAt'] },
  { task: 23, what: 'delay', setup: ['MOVEQ #3,D1'], reaches: [] },
  { task: 24, what: 'simulator key commands off', setup: ['MOVEQ #1,D1'], reaches: ['keyCommands'] },
  { task: 24, what: 'simulator key commands on', setup: ['MOVEQ #0,D1'], reaches: ['keyCommands'] },
  {
    task: 25,
    what: 'scroll a text rectangle',
    setup: ['MOVEQ #0,D1', 'MOVE.L #$00020003,D2', 'MOVEQ #0,D3'],
    reaches: ['scrollRect'],
  },
  // simulator environment (trap15-a §5)
  { task: 30, what: 'clear the cycle counter', setup: [], reaches: [] },
  { task: 31, what: 'read the cycle counter', setup: [], reaches: [] },
  {
    task: 32,
    what: 'show the hardware window',
    setup: ['MOVEQ #0,D1'],
    reaches: ['hardwareShow', 'hardwareUpdate', 'repaint'],
  },
  { task: 32, what: 'address of the 7-segment display', setup: ['MOVEQ #1,D1'], reaches: [] },
  { task: 32, what: 'address of the LEDs', setup: ['MOVEQ #2,D1'], reaches: [] },
  { task: 32, what: 'address of the switches', setup: ['MOVEQ #3,D1'], reaches: [] },
  { task: 32, what: 'simulator version', setup: ['MOVEQ #4,D1'], reaches: [] },
  { task: 32, what: 'enable exceptions', setup: ['MOVEQ #5,D1'], reaches: ['optionChanged', 'saveSettings'] },
  {
    task: 32,
    what: 'auto interrupt 1 every 500 ms',
    setup: ['MOVEQ #6,D1', 'MOVE.B #$81,D2', 'MOVE.L #500,D3'],
    reaches: ['hardwareTimer', 'hardwareControls'],
  },
  {
    task: 32,
    what: 'auto interrupts off',
    setup: ['MOVEQ #6,D1', 'MOVEQ #0,D2', 'MOVEQ #0,D3'],
    reaches: ['hardwareTimer', 'hardwareState', 'hardwareControls'],
  },
  { task: 32, what: 'address of the push buttons', setup: ['MOVEQ #7,D1'], reaches: [] },
  { task: 33, what: 'set the output size', setup: ['MOVE.L #$03200258,D1'], reaches: ['setWindowSize'] },
  { task: 33, what: 'read the output size', setup: ['MOVEQ #0,D1'], reaches: ['getWindowSize'] },
  { task: 33, what: 'full screen', setup: ['MOVEQ #2,D1'], reaches: ['setupWindow'] },
  { task: 33, what: 'windowed', setup: ['MOVEQ #1,D1'], reaches: ['setupWindow'] },
  // serial ports (trap15-a §6)
  { task: 40, what: 'initialise a port', setup: ['LEA PORT,A1'], reaches: ['initComm'] },
  { task: 41, what: 'set port parameters', setup: ['MOVEQ #0,D1'], reaches: ['setCommParams'] },
  { task: 42, what: 'receive', setup: ['LEA BUFFER,A1', 'MOVEQ #4,D1'], reaches: ['commRead'] },
  { task: 43, what: 'send', setup: ['LEA TEXT,A1', 'MOVEQ #2,D1'], reaches: ['sendComm'] },
  // files (trap15-a §7); D7 keeps the file number
  { task: 52, what: 'open a new file', setup: ['LEA FNAME,A1'], reaches: ['fileOpen'] },
  {
    task: 54,
    what: 'write',
    setup: ['MOVE.L D1,D7', 'LEA TEXT,A1', 'MOVEQ #2,D2'],
    reaches: ['fileWrite'],
  },
  { task: 55, what: 'position', setup: ['MOVE.L D7,D1', 'MOVEQ #0,D2'], reaches: ['fileSeek'] },
  { task: 53, what: 'read', setup: ['MOVE.L D7,D1', 'LEA BUFFER,A1', 'MOVEQ #2,D2'], reaches: ['fileRead'] },
  { task: 56, what: 'close', setup: ['MOVE.L D7,D1'], reaches: ['fileClose'] },
  { task: 51, what: 'open an existing file', setup: ['LEA FNAME,A1'], reaches: ['fileOpen'] },
  { task: 50, what: 'close all files', setup: [], reaches: ['fileClose'] },
  { task: 59, what: 'does the file exist?', setup: ['LEA FNAME,A1'], reaches: ['fileOpen', 'fileClose'] },
  { task: 57, what: 'delete', setup: ['LEA FNAME,A1'], reaches: ['fileRemove'] },
  {
    task: 58,
    what: 'file dialog',
    setup: ['SUBA.L A1,A1', 'SUBA.L A2,A2', 'LEA BUFFER,A3', 'MOVEQ #0,D1'],
    dialog: { accepted: true, fileName: 'C:\\TOUR.TXT' },
    reaches: ['fileDialog'],
  },
  // mouse and key interrupts (trap15-b §8, §9): engine state only
  { task: 60, what: 'mouse interrupt off', setup: ['MOVEQ #0,D1'], reaches: [] },
  { task: 61, what: 'read the mouse', setup: ['MOVEQ #0,D1'], reaches: [] },
  { task: 62, what: 'key interrupt off', setup: ['MOVEQ #0,D1'], reaches: [] },
  // sound (trap15-b §11)
  { task: 70, what: 'play a sound file', setup: ['LEA TEXT,A1'], reaches: ['playSound'] },
  { task: 71, what: 'load a sound', setup: ['LEA TEXT,A1', 'MOVEQ #1,D1'], reaches: ['loadSound'] },
  { task: 72, what: 'play a loaded sound', setup: ['MOVEQ #1,D1'], reaches: ['playSoundMem'] },
  { task: 73, what: 'play a sound file (DirectX player)', setup: ['LEA TEXT,A1'], reaches: ['playSoundDX'] },
  { task: 74, what: 'load a sound (DirectX player)', setup: ['LEA TEXT,A1', 'MOVEQ #1,D1'], reaches: ['loadSoundDX'] },
  { task: 75, what: 'play a loaded sound (DirectX player)', setup: ['MOVEQ #1,D1'], reaches: ['playSoundMemDX'] },
  { task: 76, what: 'control the player', setup: ['MOVEQ #1,D1', 'MOVEQ #0,D2'], reaches: ['controlSound'] },
  {
    task: 77,
    what: 'control the DirectX player',
    setup: ['MOVEQ #1,D1', 'MOVEQ #0,D2'],
    reaches: ['controlSoundDX'],
  },
  // graphics (trap15-b §7)
  { task: 80, what: 'pen colour', setup: ['MOVE.L #$00FF0000,D1'], reaches: ['setLineColor'] },
  { task: 81, what: 'fill colour', setup: ['MOVE.L #$0000FF00,D1'], reaches: ['setFillColor'] },
  { task: 82, what: 'draw a pixel', setup: XY, reaches: ['drawPixel'] },
  { task: 83, what: 'read a pixel', setup: XY, reaches: ['getPixel'] },
  { task: 84, what: 'line', setup: BOX, reaches: ['line'] },
  { task: 85, what: 'line to', setup: XY, reaches: ['lineTo'] },
  { task: 86, what: 'move to', setup: XY, reaches: ['moveTo'] },
  { task: 87, what: 'filled rectangle', setup: BOX, reaches: ['rectangle'] },
  { task: 88, what: 'filled ellipse', setup: BOX, reaches: ['ellipse'] },
  { task: 89, what: 'flood fill', setup: XY, reaches: ['floodFill'] },
  { task: 90, what: 'rectangle outline', setup: BOX, reaches: ['unfilledRectangle'] },
  { task: 91, what: 'ellipse outline', setup: BOX, reaches: ['unfilledEllipse'] },
  { task: 92, what: 'drawing mode', setup: ['MOVEQ #4,D1'], reaches: ['setDrawingMode'] },
  { task: 93, what: 'pen width', setup: ['MOVEQ #1,D1'], reaches: ['setPenWidth'] },
  { task: 94, what: 'repaint', setup: [], reaches: ['formPaint'] },
  { task: 95, what: 'draw text at a pixel position', setup: ['LEA TEXT,A1', ...XY], reaches: ['drawText'] },
  { task: 96, what: 'read the pen position', setup: [], reaches: ['getXY'] },
  // network (trap15-b §12)
  { task: 100, what: 'create a client', setup: ['LEA SERVER,A2', 'MOVEQ #0,D1'], reaches: ['createNetClient'] },
  { task: 101, what: 'create a server', setup: ['MOVEQ #0,D1'], reaches: ['createNetServer'] },
  {
    task: 102,
    what: 'send',
    setup: ['LEA TEXT,A1', 'LEA SERVER,A2', 'MOVEQ #2,D1'],
    reaches: ['sendNet'],
  },
  {
    task: 103,
    what: 'receive',
    setup: ['LEA BUFFER,A1', 'LEA BUFFER+256,A2', 'MOVEQ #2,D1'],
    reaches: ['receiveNet'],
  },
  { task: 104, what: 'close the connection', setup: ['MOVEQ #0,D1'], reaches: ['closeNetConnection'] },
  { task: 105, what: 'local address', setup: ['LEA BUFFER,A2'], reaches: ['getLocalIP'] },
  {
    task: 106,
    what: 'send on a port',
    setup: ['LEA TEXT,A1', 'LEA SERVER,A2', 'MOVEQ #2,D1'],
    reaches: ['sendPortNet'],
  },
  {
    task: 107,
    what: 'receive with port',
    setup: ['LEA BUFFER,A1', 'LEA BUFFER+256,A2', 'MOVEQ #2,D1'],
    reaches: ['receivePortNet'],
  },
  // the end of the program (trap15-a task 9): the hardware is disabled, the display and menus updated
  {
    task: 9,
    what: 'terminate the program',
    setup: [],
    reaches: ['hardwareState', 'repaint', 'registersShown', 'menuState'],
  },
];

/** 68000 address of the marks of the tour program: one byte per step. */
export const TOUR_MARKS = 0x6000;

/**
 * The source of the tour program, as lines. Before each task the program writes one byte to
 * `TOUR_MARKS + step`; with `SimOption.MemLive` on, the engine reports that write to the host
 * (`memoryLivePaint`), which is how `runTrap15Tour` knows where each task begins.
 */
export function trap15TourSource(): string[] {
  const lines = ['* Calls every TRAP #15 task once (app/src/engine/testing.ts).', '        ORG     $1000', 'START:'];
  TRAP15_TOUR.forEach((step, index) => {
    lines.push(`* ${index}: task ${step.task} - ${step.what}`, `        MOVE.B  #0,MARKS+${index}`);
    for (const line of step.setup) lines.push(`        ${line}`);
    lines.push(`        MOVEQ   #${step.task},D0`, '        TRAP    #15');
  });
  lines.push(
    '        SIMHALT',
    "TEXT    DC.B    'HI',0",
    "PAGE    DC.B    'P',12,0",
    "FNAME   DC.B    'TOUR.TXT',0",
    "PORT    DC.B    'COM1',0",
    "SERVER  DC.B    '127.0.0.1',0",
    '        ORG     $5000',
    'BUFFER  DS.B    512',
    `        ORG     $${TOUR_MARKS.toString(16).toUpperCase()}`,
    `MARKS   DS.B    ${TRAP15_TOUR.length}`,
    '        END     START',
  );
  return lines;
}

/** One host call as text: `textOut("HI")`, `line(1,2,30,40)`. Bytes are shown as quoted text. */
export function describeCall(call: HostCall): string {
  const args = call.args.map((arg) => (arg instanceof Uint8Array ? JSON.stringify(textOf(arg)) : String(arg)));
  return `${call.method}(${args.join(',')})`;
}

export interface TourResult {
  report: RunReport;
  /** The host methods pressing Run reached, before the first task. */
  before: (keyof SimHost)[];
  /** The host methods each step reached, in the order of TRAP15_TOUR, each method once per step. */
  reached: (keyof SimHost)[][];
  /** Every host call of the run as text (`describeCall`), the `memoryLivePaint` marks included. */
  log: string[];
}

/**
 * Loads the tour program into a test engine and runs it to its end, typing the keys and answering
 * the dialog the steps name. `program` is `assembleProgram(trap15TourSource())`. The host should
 * have `createMemoryFiles()` as its `files` part, or the file tasks fail at the first open.
 */
export function runTrap15Tour(test: TestEngine, program: Pick<AssembledProgram, 's68' | 'l68'>): TourResult {
  test.engine.load(program.s68, program.l68, { name: 'tour.S68' });
  test.engine.setOption(SimOption.MemLive, true);
  test.forget();
  const report = runProgram(test.engine, {
    keys: TRAP15_TOUR.flatMap((step) => (step.keys === undefined ? [] : [step.keys])),
    dialogs: TRAP15_TOUR.flatMap((step) => (step.dialog === undefined ? [] : [step.dialog])),
  });
  const before: (keyof SimHost)[] = [];
  const reached: (keyof SimHost)[][] = TRAP15_TOUR.map(() => []);
  let current = before;
  for (const call of test.calls) {
    if (call.method === 'memoryLivePaint') {
      // The marks are the only writes to this range. Other reported writes (task 2 stores its
      // string) belong to the step they happen in and are not host calls the specs speak of.
      const step = (call.args[0] as number) - TOUR_MARKS;
      if (step >= 0 && step < reached.length) current = reached[step] as (keyof SimHost)[];
      continue;
    }
    if (!current.includes(call.method)) current.push(call.method);
  }
  return { report, before, reached, log: test.calls.map(describeCall) };
}
