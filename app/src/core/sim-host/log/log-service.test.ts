// LogService with a small engine double, virtual time and files in memory (ARCHITECTURE.md 3.3.5,
// 5.5; sim-ui §13). The tests with the real engine are in log-engine.test.ts.

import { describe, expect, it } from 'vitest';
import { SimOption, type Bytes, type LogDeps, type SimEngine, type Vfs, type VPath } from '../../../contracts';
import { MemoryBackend } from '../../../fs/memory-backend';
import { createVfs } from '../../../fs/vfs';
import { VirtualTime } from '../../run/clock';
import { asciiBytes, defaultLogFileNames, formatUsDateTime, outputLogHeader } from './format';
import {
  FLUSH_DURATION_FACTOR,
  FLUSH_INTERVAL_MS,
  LogService,
  TAIL_NOTIFY_MS,
  logStartFailure,
  logWriteError,
} from './log-service';

const text = (bytes: Bytes): string => String.fromCharCode(...bytes);
const PROGRAM = '/memory/work/prog.S68';
const EXEC = '/memory/work/prog_RunLog.txt';
const OUTPUT = '/memory/work/prog_OutLog.txt';
const START = new Date(2026, 10, 20, 15, 4, 5);

/** The engine's side of logging, as the shim's log.cpp does it, recorded. */
class EngineDouble {
  options = new Map<number, number>();
  calls: string[] = [];
  logging = false;
  snapshot = { exec: 0, output: 0 };
  constructor(private readonly log: () => LogService) {}

  getOption(option: number): number {
    return this.options.get(option) ?? 0;
  }
  setOption(option: number, value: number | boolean): void {
    this.calls.push(`setOption(${option},${Number(value)})`);
    this.options.set(option, Number(value) | 0);
  }
  logDialogOpened(): void {
    this.calls.push('logDialogOpened');
    this.snapshot = { exec: this.getOption(SimOption.ExecLogType), output: this.getOption(SimOption.OutputLogType) };
  }
  startLog(time: string): void {
    this.calls.push(`startLog(${time})`);
    if (this.getOption(SimOption.ExecLogType))
      this.log().logWrite(asciiBytes(`EASy68K execution log file: ${time}\r\n\r\n`));
    this.logging = true;
    this.log().logState(true);
  }
  stopLog(): void {
    this.calls.push('stopLog');
    if (!this.logging) return;
    this.logging = false;
    this.log().logState(false);
  }
  /** One traced instruction of type 1. */
  trace(line: string): void {
    if (this.logging && this.getOption(SimOption.ExecLogType)) this.log().logWrite(asciiBytes(`${line}\r\n`));
  }
  rewind(): void {
    const note = '\r\n***** Reset Program Pressed *****\r\n';
    if (this.logging && this.snapshot.exec) this.log().logWrite(asciiBytes(note));
    if (this.logging && this.snapshot.output)
      this.log().outputLogWrite(asciiBytes('\n***** Reset Program Pressed *****\n'));
  }
}

interface Rig {
  log: LogService;
  engine: EngineDouble;
  vfs: Vfs;
  time: VirtualTime;
  writes: { op: 'writeFile' | 'appendFile'; path: string; bytes: number }[];
  questions: ('exec' | 'output')[];
  answer: (kind: 'exec' | 'output') => 'Replace' | 'Append' | 'Cancel' | Promise<'Replace' | 'Append' | 'Cancel'>;
}

/** A Vfs that records the writes and can be slowed down or made to fail. */
function recordingVfs(
  vfs: Vfs,
  writes: Rig['writes'],
  hooks: { before?: (op: string, path: string) => Promise<void> | void } = {},
): Vfs {
  return new Proxy(vfs, {
    get(target, prop, receiver) {
      if (prop === 'writeFile' || prop === 'appendFile') {
        return async (path: VPath, data: Bytes) => {
          writes.push({ op: prop, path, bytes: data.length });
          await hooks.before?.(prop, path);
          return (target[prop] as (p: VPath, d: Bytes) => Promise<void>).call(target, path, data);
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

function createRig(options: { hooks?: Parameters<typeof recordingVfs>[2]; invoke?: LogDeps['invoke'] } = {}): Rig {
  const base = createVfs();
  base.mount(new MemoryBackend());
  const writes: Rig['writes'] = [];
  const vfs = recordingVfs(base, writes, options.hooks);
  const time = new VirtualTime(START);
  const rig = {} as Rig;
  const engine = new EngineDouble(() => rig.log);
  rig.questions = [];
  rig.answer = () => 'Replace';
  const log = new LogService({
    vfs,
    clock: time,
    scheduler: time,
    invoke: options.invoke ?? ((fn) => fn(engine as unknown as SimEngine)),
    askFileExists: async (kind) => {
      rig.questions.push(kind);
      return rig.answer(kind);
    },
  });
  Object.assign(rig, { log, engine, vfs, time, writes });
  return rig;
}

async function read(vfs: Vfs, path: VPath): Promise<string> {
  return text(await vfs.readFile(path));
}

async function exists(vfs: Vfs, path: VPath): Promise<boolean> {
  return (await vfs.stat(path)) !== null;
}

/** Selects the types through the dialog, as the user would. */
function choose(rig: Rig, execType: 0 | 1 | 2 | 3, outputType: 0 | 1, mem = { from: 0, bytes: 0 }): void {
  rig.log.setLogFileNames(PROGRAM);
  rig.log.applyDialog({
    execFileName: rig.log.state.execFileName,
    outputFileName: rig.log.state.outputFileName,
    execType,
    outputType,
    memFrom: mem.from,
    memBytes: mem.bytes,
  });
}

describe('formatUsDateTime and the file names', () => {
  it('prints DateTimeToStr of a US English Windows', () => {
    expect(formatUsDateTime(new Date(2026, 10, 20, 15, 4, 5))).toBe('11/20/2026 3:04:05 PM');
    expect(formatUsDateTime(new Date(2018, 2, 15, 14, 5, 33))).toBe('3/15/2018 2:05:33 PM');
    expect(formatUsDateTime(new Date(2026, 0, 2, 0, 30, 0))).toBe('1/2/2026 12:30:00 AM');
    expect(formatUsDateTime(new Date(2026, 0, 2, 12, 0, 1))).toBe('1/2/2026 12:00:01 PM');
    expect(formatUsDateTime(new Date(2026, 0, 2, 9, 7, 9))).toBe('1/2/2026 9:07:09 AM');
    // Midnight: the date alone.
    expect(formatUsDateTime(new Date(2026, 11, 31, 0, 0, 0))).toBe('12/31/2026');
  });

  it('names the two files after the program (ChangeFileExt)', () => {
    expect(defaultLogFileNames('/browser/work/prog.S68')).toEqual({
      exec: '/browser/work/prog_RunLog.txt',
      output: '/browser/work/prog_OutLog.txt',
    });
    expect(defaultLogFileNames('/browser/a.b/prog')).toEqual({
      exec: '/browser/a.b/prog_RunLog.txt',
      output: '/browser/a.b/prog_OutLog.txt',
    });
    expect(text(outputLogHeader('11/20/2026 3:04:05 PM'))).toBe(
      'EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\n',
    );
  });
});

describe('LogService: names, dialog and enabled states (sim-ui §13.1, §13.2, §13.6)', () => {
  it('starts in the start-up state of 3.3.2', () => {
    const { log } = createRig();
    expect(log.state).toEqual({
      execFileName: '',
      outputFileName: '',
      execType: 0,
      outputType: 0,
      memFrom: 0,
      memBytes: 0,
      logging: false,
      startEnabled: false,
      stopEnabled: false,
    });
    expect(log.unsaved).toBe(false);
  });

  it('recomputes the names on Open and enables Log Start only when a type is selected', () => {
    const rig = createRig();
    rig.log.setLogFileNames(PROGRAM);
    expect(rig.log.state.execFileName).toBe(EXEC);
    expect(rig.log.state.outputFileName).toBe(OUTPUT);
    expect(rig.log.state.startEnabled).toBe(false);
    // Types restored from the settings live in the engine; the next Open enables Log Start.
    rig.engine.options.set(SimOption.OutputLogType, 1);
    rig.log.setLogFileNames('/memory/work/other.S68');
    expect(rig.log.state.outputType).toBe(1);
    expect(rig.log.state.startEnabled).toBe(true);
    expect(rig.log.state.execFileName).toBe('/memory/work/other_RunLog.txt');
  });

  it('OK sends the four values to the engine, LogMemFrom and LogMemBytes included, and enables Log Start', () => {
    const rig = createRig();
    choose(rig, 3, 0, { from: 0x1012, bytes: 0x10 });
    expect(rig.engine.calls).toEqual([
      `setOption(${SimOption.ExecLogType},3)`,
      `setOption(${SimOption.OutputLogType},0)`,
      `setOption(${SimOption.LogMemFrom},${0x1012})`,
      `setOption(${SimOption.LogMemBytes},16)`,
    ]);
    expect(rig.log.state).toMatchObject({ execType: 3, memFrom: 0x1012, memBytes: 16, startEnabled: true });
  });

  it('OK with both types Disabled does not enable Log Start, nor disable it once enabled', () => {
    const rig = createRig();
    choose(rig, 0, 0);
    expect(rig.log.state.startEnabled).toBe(false);
    choose(rig, 1, 0);
    expect(rig.log.state.startEnabled).toBe(true);
    choose(rig, 0, 0);
    expect(rig.log.state.startEnabled).toBe(true); // "not disabled again" (§13.6)
  });

  it('showing the dialog takes the engine snapshot of sim-ui Q24', () => {
    const rig = createRig();
    rig.engine.options.set(SimOption.ExecLogType, 2);
    rig.log.dialogShown();
    expect(rig.engine.calls).toEqual(['logDialogOpened']);
    expect(rig.engine.snapshot.exec).toBe(2);
    expect(rig.log.state.execType).toBe(2);
  });

  it('tells its listeners of every change of state', () => {
    const rig = createRig();
    let told = 0;
    const stop = rig.log.subscribe(() => told++);
    rig.log.setLogFileNames(PROGRAM);
    expect(told).toBe(1);
    stop();
    rig.log.setLogFileNames('/memory/x/y.S68');
    expect(told).toBe(1);
  });
});

describe('LogService: Log Start (sim-ui §13.3, notes 41)', () => {
  it('creates both files with their headers, then calls engine.startLog with the date', async () => {
    const rig = createRig();
    choose(rig, 1, 1);
    rig.engine.calls = [];
    expect(await rig.log.start()).toBe(true);
    expect(rig.engine.calls).toEqual(['startLog(11/20/2026 3:04:05 PM)']);
    expect(rig.log.state).toMatchObject({ logging: true, startEnabled: false, stopEnabled: true });
    expect(rig.questions).toEqual([]);
    expect(rig.writes).toEqual([
      { op: 'writeFile', path: EXEC, bytes: 53 },
      { op: 'writeFile', path: OUTPUT, bytes: 50 },
    ]);
    expect(await read(rig.vfs, EXEC)).toBe('EASy68K execution log file: 11/20/2026 3:04:05 PM\r\n\r\n');
    expect(await read(rig.vfs, OUTPUT)).toBe('EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\n');
  });

  it('Replace truncates an existing file, Append appends to it', async () => {
    const rig = createRig();
    await rig.vfs.writeFile(EXEC, asciiBytes('old exec\r\n'));
    await rig.vfs.writeFile(OUTPUT, asciiBytes('old output\n'));
    choose(rig, 1, 1);
    rig.answer = (kind) => (kind === 'exec' ? 'Replace' : 'Append');
    rig.writes.length = 0;
    expect(await rig.log.start()).toBe(true);
    expect(rig.questions).toEqual(['exec', 'output']);
    expect(rig.writes.map((w) => w.op)).toEqual(['writeFile', 'appendFile']);
    expect(await read(rig.vfs, EXEC)).toBe('EASy68K execution log file: 11/20/2026 3:04:05 PM\r\n\r\n');
    expect(await read(rig.vfs, OUTPUT)).toBe('old output\nEASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\n');
  });

  it('Cancel: engine.startLog is not called, logging stays off, nothing is written', async () => {
    for (const cancelled of ['exec', 'output'] as const) {
      const rig = createRig();
      await rig.vfs.writeFile(EXEC, asciiBytes('old exec'));
      await rig.vfs.writeFile(OUTPUT, asciiBytes('old output'));
      choose(rig, 2, 1);
      rig.answer = (kind) => (kind === cancelled ? 'Cancel' : 'Replace');
      rig.engine.calls = [];
      rig.writes.length = 0;
      expect(await rig.log.start()).toBe(false);
      expect(rig.engine.calls).toEqual([]);
      expect(rig.log.state).toMatchObject({ logging: false, startEnabled: true, stopEnabled: false });
      expect(logStartFailure(rig.log)).toBeNull();
      expect(rig.writes).toEqual([]);
      expect(await read(rig.vfs, EXEC)).toBe('old exec');
      expect(await read(rig.vfs, OUTPUT)).toBe('old output');
      // Bytes that arrive afterwards go nowhere.
      rig.log.outputWrite(asciiBytes('X'));
      rig.log.logWrite(asciiBytes('Y'));
      expect(rig.log.unsaved).toBe(false);
    }
  });

  it('a file that cannot be written leaves logging off and says which one', async () => {
    const rig = createRig({
      hooks: {
        before: (_op, path) => {
          if (path === OUTPUT) throw new Error('disk full');
        },
      },
    });
    choose(rig, 1, 1);
    rig.engine.calls = [];
    expect(await rig.log.start()).toBe(false);
    expect(logStartFailure(rig.log)).toEqual({ kind: 'output', fileName: OUTPUT });
    expect(rig.engine.calls).toEqual(['startLog(11/20/2026 3:04:05 PM)', 'stopLog']);
    expect(rig.log.state).toMatchObject({ logging: false, startEnabled: true, stopEnabled: false });
    expect(rig.log.unsaved).toBe(false);
    expect(await exists(rig.vfs, OUTPUT)).toBe(false);
  });

  it('a name the port cannot resolve is a failure before anything is asked', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    rig.log.applyDialog({ ...rig.log.state, execFileName: 'C:\\logs\\run.txt' });
    rig.engine.calls = [];
    expect(await rig.log.start()).toBe(false);
    expect(logStartFailure(rig.log)).toEqual({ kind: 'exec', fileName: 'C:\\logs\\run.txt' });
    expect(rig.engine.calls).not.toContain('startLog(11/20/2026 3:04:05 PM)');
  });

  it('a name without a folder is taken relative to the program', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    rig.log.applyDialog({ ...rig.log.state, execFileName: 'sub\\..\\mine.txt' });
    expect(await rig.log.start()).toBe(true);
    expect(await exists(rig.vfs, '/memory/work/mine.txt')).toBe(true);
  });

  it('both types Disabled: the engine logs (as the original), no file is made', async () => {
    const rig = createRig();
    rig.log.setLogFileNames(PROGRAM);
    rig.engine.calls = [];
    expect(await rig.log.start()).toBe(true);
    expect(rig.engine.calls).toEqual(['startLog(11/20/2026 3:04:05 PM)']);
    expect(rig.writes).toEqual([]);
  });

  it('cannot start twice at once, nor while logging', async () => {
    const rig = createRig();
    await rig.vfs.writeFile(EXEC, asciiBytes('old'));
    choose(rig, 1, 0);
    let release!: (answer: 'Replace') => void;
    rig.answer = () => new Promise((resolve) => (release = resolve));
    const first = rig.log.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.log.state.startEnabled).toBe(false); // while the question is open
    expect(await rig.log.start()).toBe(false);
    release('Replace');
    expect(await first).toBe(true);
    expect(await rig.log.start()).toBe(false);
  });
});

describe('LogService: bytes and flushes (3.3.5)', () => {
  it('keeps output bytes only while logging with the output type Text Only', async () => {
    const rig = createRig();
    choose(rig, 1, 1);
    rig.log.outputWrite(asciiBytes('before'));
    await rig.log.start();
    rig.log.outputWrite(asciiBytes('Hello'));
    // The type set to Disabled while logging: nothing is kept (the original tests OlogFlag).
    rig.log.applyDialog({ ...rig.log.state, outputType: 0 });
    rig.log.outputWrite(asciiBytes('lost'));
    rig.log.applyDialog({ ...rig.log.state, outputType: 1 });
    rig.log.outputWrite(asciiBytes('World\n'));
    rig.log.stop();
    await rig.log.flush();
    expect(await read(rig.vfs, OUTPUT)).toBe('EASy68K output log file: 11/20/2026 3:04:05 PM\r\n\r\nHelloWorld\n');
  });

  it('stores the engine bytes unchanged and appends with appendFile after the first write', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    await rig.log.start();
    rig.writes.length = 0;
    rig.engine.trace('PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0');
    rig.engine.trace('PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1');
    expect(rig.log.unsaved).toBe(true);
    await rig.log.flush();
    expect(rig.writes).toEqual([{ op: 'appendFile', path: EXEC, bytes: 2 * 73 }]);
    expect(rig.log.unsaved).toBe(false);
    rig.engine.stopLog();
    await rig.log.flush();
    expect((await read(rig.vfs, EXEC)).split('\r\n')).toEqual([
      'EASy68K execution log file: 11/20/2026 3:04:05 PM',
      '',
      'PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0',
      'PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1',
      '',
    ]);
  });

  it('flushes about once per second while bytes arrive', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    await rig.log.start();
    rig.writes.length = 0;
    rig.engine.trace('one');
    rig.time.advance(FLUSH_INTERVAL_MS - 1);
    expect(rig.writes).toEqual([]);
    rig.time.advance(1);
    await rig.log.flush();
    expect(rig.writes.map((w) => w.op)).toEqual(['appendFile']);
    rig.time.advance(5 * FLUSH_INTERVAL_MS);
    expect(rig.writes).toHaveLength(1); // nothing new, no write
  });

  it('never overlaps two writes of one file; bytes that arrive meanwhile wait for the next flush', async () => {
    let inFlight = 0;
    let most = 0;
    const gates: (() => void)[] = [];
    const rig = createRig({
      hooks: {
        before: async (op) => {
          if (op !== 'appendFile') return;
          inFlight++;
          most = Math.max(most, inFlight);
          await new Promise<void>((resolve) => gates.push(resolve));
          inFlight--;
        },
      },
    });
    choose(rig, 1, 0);
    await rig.log.start();
    rig.writes.length = 0;
    rig.engine.trace('A');
    const first = rig.log.flush();
    await Promise.resolve();
    rig.engine.trace('B');
    const second = rig.log.flush();
    const third = rig.log.flush();
    expect(third).toBe(second); // one flush waits, the rest join it
    rig.engine.trace('C');
    while (gates.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.writes).toHaveLength(1);
    gates.shift()?.();
    await first;
    while (gates.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    gates.shift()?.();
    await second;
    expect(most).toBe(1);
    expect(rig.writes.map((w) => w.bytes)).toEqual([3, 6]); // "A\r\n", then "B\r\nC\r\n"
  });

  it('waits twenty times the duration of a slow flush before the next timed one', async () => {
    const SLOW_MS = 200;
    const rig: Rig = createRig({
      hooks: {
        before: (op) => {
          // The store takes SLOW_MS of (virtual) time for every append.
          if (op === 'appendFile') rig.time.advance(SLOW_MS);
        },
      },
    });
    choose(rig, 1, 0);
    await rig.log.start();
    rig.engine.trace('one');
    await rig.log.flush(); // took SLOW_MS
    rig.writes.length = 0;
    rig.engine.trace('two');
    rig.time.advance(FLUSH_INTERVAL_MS);
    expect(rig.writes).toEqual([]);
    rig.time.advance(FLUSH_DURATION_FACTOR * SLOW_MS - FLUSH_INTERVAL_MS - 1);
    expect(rig.writes).toEqual([]);
    rig.time.advance(1);
    expect(rig.writes.map((w) => w.op)).toEqual(['appendFile']);
  });

  it('Log Stop closes both files after writing what is buffered; later bytes go nowhere', async () => {
    const rig = createRig();
    choose(rig, 1, 1);
    await rig.log.start();
    rig.engine.trace('last');
    rig.log.outputWrite(asciiBytes('text'));
    rig.log.stop();
    expect(rig.log.state).toMatchObject({ logging: false, startEnabled: true, stopEnabled: false });
    await rig.log.flush();
    rig.engine.trace('after');
    rig.log.outputWrite(asciiBytes('after'));
    rig.log.outputLogWrite(asciiBytes('after'));
    expect(rig.log.unsaved).toBe(false);
    expect(await read(rig.vfs, EXEC)).toMatch(/\r\nlast\r\n$/);
    expect(await read(rig.vfs, OUTPUT)).toMatch(/\r\n\r\ntext$/);
  });

  it('exit() stops without the engine and waits until everything is in storage', async () => {
    const rig = createRig({ invoke: () => {} }); // the engine is gone (a cold start)
    rig.log.setLogFileNames(PROGRAM);
    rig.log.applyDialog({ ...rig.log.state, execType: 1, outputType: 1 });
    await rig.log.start();
    rig.log.logState(true); // what the engine would have said
    rig.log.outputWrite(asciiBytes('bye'));
    await rig.log.exit();
    expect(rig.log.state.logging).toBe(false);
    expect(rig.log.unsaved).toBe(false);
    expect(await read(rig.vfs, OUTPUT)).toMatch(/bye$/);
  });

  it('a failed flush keeps the bytes for the next one and reports the error', async () => {
    let fail = true;
    const rig = createRig({
      hooks: {
        before: (op) => {
          if (op === 'appendFile' && fail) throw new Error('quota');
        },
      },
    });
    choose(rig, 1, 0);
    await rig.log.start();
    rig.engine.trace('kept');
    await expect(rig.log.flush()).rejects.toThrow('quota');
    expect(logWriteError(rig.log)).toMatch(/quota/);
    expect(rig.log.unsaved).toBe(true);
    fail = false;
    await rig.log.flush();
    expect(logWriteError(rig.log)).toBeNull();
    expect(await read(rig.vfs, EXEC)).toMatch(/\r\nkept\r\n$/);
  });

  it('a new Log Start writes the old files out first, then asks', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    await rig.log.start();
    rig.engine.trace('first run');
    rig.log.stop();
    rig.answer = () => 'Append';
    expect(await rig.log.start()).toBe(true);
    expect(rig.questions).toEqual(['exec']);
    rig.engine.trace('second run');
    rig.log.stop();
    await rig.log.flush();
    const lines = (await read(rig.vfs, EXEC)).split('\r\n');
    expect(lines.filter((line) => line.startsWith('EASy68K execution log file:'))).toHaveLength(2);
    expect(lines.indexOf('first run')).toBeLessThan(lines.indexOf('second run'));
  });

  it('writes the Rewind note to both files when the snapshot says so', async () => {
    const rig = createRig();
    choose(rig, 1, 1);
    rig.log.dialogShown(); // the dialog is shown with both types already selected
    await rig.log.start();
    rig.engine.rewind();
    rig.log.stop();
    await rig.log.flush();
    expect(await read(rig.vfs, EXEC)).toMatch(/\r\n\r\n\*\*\*\*\* Reset Program Pressed \*\*\*\*\*\r\n$/);
    expect(await read(rig.vfs, OUTPUT)).toMatch(/\r\n\r\n\n\*\*\*\*\* Reset Program Pressed \*\*\*\*\*\n$/);
  });
});

describe('LogService: the Log panel and the start-up state', () => {
  it('gives the last lines of each file, and tells its listeners within TAIL_NOTIFY_MS', async () => {
    const rig = createRig();
    choose(rig, 1, 1);
    await rig.log.start();
    let told = 0;
    rig.log.subscribe(() => told++);
    for (let i = 0; i < 5; i++) rig.engine.trace(`line ${i}`);
    rig.log.outputWrite(asciiBytes('Hello\r\nWorld\npartial'));
    expect(told).toBe(0);
    rig.time.advance(TAIL_NOTIFY_MS);
    expect(told).toBe(1);
    expect(rig.log.tail('exec', 2)).toEqual(['line 3', 'line 4']);
    expect(rig.log.tail('exec', 100)[0]).toBe('EASy68K execution log file: 11/20/2026 3:04:05 PM');
    expect(rig.log.tail('output', 3)).toEqual(['Hello', 'World', 'partial']);
    expect(rig.log.tail('output', 0)).toEqual([]);
  });

  it('keeps a bounded tail of a long log', async () => {
    const rig = createRig();
    choose(rig, 1, 0);
    await rig.log.start();
    for (let i = 0; i < 20_000; i++) rig.engine.trace(`PC=${String(i).padStart(8, '0')}  some row text that is long`);
    const lines = rig.log.tail('exec', 200);
    expect(lines).toHaveLength(200);
    expect(lines[199]).toBe('PC=00019999  some row text that is long');
    await rig.log.flush();
  });

  it('resetToStartup forgets names and files and reads the types of the new engine', async () => {
    const rig = createRig();
    choose(rig, 2, 1);
    await rig.log.start();
    rig.log.stop();
    await rig.log.flush();
    rig.engine.options.set(SimOption.ExecLogType, 2);
    rig.log.resetToStartup();
    expect(rig.log.state).toMatchObject({
      execFileName: '',
      outputFileName: '',
      execType: 2,
      outputType: 1,
      logging: false,
      startEnabled: false,
      stopEnabled: false,
    });
    expect(rig.log.tail('exec', 10)).toEqual([]);
  });

  it('works with inert dependencies (W1 stub host test): nothing throws, nothing hangs', async () => {
    const rig = createRig({ invoke: () => {} });
    rig.log.setLogFileNames(PROGRAM);
    rig.log.dialogShown();
    rig.log.applyDialog({ ...rig.log.state, outputType: 1 });
    expect(await rig.log.start()).toBe(true);
    rig.log.stop();
    await rig.log.exit();
    rig.log.resetToStartup();
    expect(rig.log.unsaved).toBe(false);
  });
});
