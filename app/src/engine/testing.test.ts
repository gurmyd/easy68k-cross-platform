// The test helpers of testing.ts: the recording host, createTestEngine, withFaults, assembleProgram,
// runProgram and the memory files (W4, 9.1).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FileMode, Reg, RunStatus, type HostIoText, type SimEngine, type SimHost } from '../contracts';
import { releaseSimEngine } from './index';
import { HOST_DEFAULTS, HOST_METHODS, HOST_PART_DEFAULTS } from './sim';
import {
  assembleProgram,
  bytesOf,
  createMemoryFiles,
  createRecordingHost,
  createTestEngine,
  describeCall,
  runProgram,
  textOf,
  withFaults,
} from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);

/** Suites that load and compile the engines: on a loaded machine they need more than Vitest's 5 s. */
const ENGINE_TIME = { timeout: 60_000 };

/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)(
  'engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)',
  () => {
    expect.fail(
      'EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run "npm run build:engines" or "npm run fetch:engines"',
    );
  },
);

describe('createRecordingHost', () => {
  it('has the 93 methods; each records its call and returns the default of the engine', () => {
    const recording = createRecordingHost();
    const host = recording.host as unknown as Record<string, (...args: unknown[]) => unknown>;
    expect(Object.keys(host).sort()).toEqual([...HOST_METHODS].sort());
    for (const name of HOST_METHODS) {
      expect(host[name]?.(1, 2), name).toBe(HOST_DEFAULTS[name]);
    }
    expect(recording.calls.length).toBe(93);
    expect(recording.calls[0]).toEqual({ method: HOST_METHODS[0], args: [1, 2] });
    // the defaults that are not `undefined`
    expect(recording.host.fileOpen(bytesOf('x'), FileMode.Read)).toBe(0);
    expect(recording.host.fileRead(1, 10)).toBeNull();
    expect(recording.host.fileWrite(1, bytesOf('x'))).toBe(-1);
    expect(recording.host.fileClose(1)).toBe(false);
    expect(recording.host.commRead(0, 4)).toBe(-3);
    expect(recording.host.getPixel(0, 0)).toBe(0);
    expect(recording.host.getWindowSize()).toBeUndefined();
  });

  it('callsTo, methodsCalled, forget', () => {
    const recording = createRecordingHost();
    recording.host.textOut(bytesOf('one'));
    recording.host.gotorc(2, 3);
    recording.host.textOut(bytesOf('two'));
    expect(recording.callsTo('textOut').map(([text]) => textOf(text))).toEqual(['one', 'two']);
    expect(recording.callsTo('gotorc')).toEqual([[2, 3]]);
    expect(recording.callsTo('clear')).toEqual([]);
    expect(recording.methodsCalled()).toEqual(['textOut', 'gotorc']);
    expect(recording.calls.map(describeCall)).toEqual(['textOut("one")', 'gotorc(2,3)', 'textOut("two")']);
    recording.forget();
    expect(recording.calls).toEqual([]);
    expect(recording.methodsCalled()).toEqual([]);
  });

  it('a given part replaces the recording methods of that part; its calls are recorded too', () => {
    class Text {
      row = 0;
      col = 0;
      gotorc(row: number, col: number) {
        this.row = row;
        this.col = col;
      }
      getrc() {
        return (this.col << 8) | this.row;
      }
    }
    // the other methods of the part: the defaults
    const text = Object.assign(
      new Text(),
      noops(HOST_PART_DEFAULTS.text, ['gotorc', 'getrc']),
    ) as unknown as HostIoText & Text;
    const recording = createRecordingHost({ text });
    recording.host.gotorc(4, 9);
    expect(recording.host.getrc()).toBe(0x0904);
    expect(text.row).toBe(4); // called on the part itself
    expect(recording.host.getPixel(1, 1)).toBe(0); // another part: still the default
    expect(recording.calls.map(describeCall)).toEqual(['gotorc(4,9)', 'getrc()', 'getPixel(1,1)']);
  });

  it('refuses a part that lacks a method', () => {
    expect(() => createRecordingHost({ text: { clear() {} } as unknown as HostIoText })).toThrow(
      'createRecordingHost: part text has no method charOut',
    );
  });
});

/** `{ name: () => default }` for every method of a part, except the names in `skip`. */
function noops(defaults: Record<string, unknown>, skip: string[] = []): Record<string, () => unknown> {
  return Object.fromEntries(
    Object.entries(defaults)
      .filter(([name]) => !skip.includes(name))
      .map(([name, value]) => [name, () => value]),
  );
}

describe('withFaults', ENGINE_TIME, () => {
  /** A stand-in engine: enough of SimEngine to see what reaches it. */
  function fakeEngine() {
    const seen: string[] = [];
    const engine = {
      seen,
      run(maxInstructions?: number) {
        seen.push(`run(${maxInstructions})`);
        return RunStatus.Running;
      },
      cmdTraceInto() {
        seen.push('cmdTraceInto()');
        return RunStatus.Stopped;
      },
      get stepCount() {
        seen.push('stepCount');
        return 42;
      },
      label: 'fake',
      whoAmI() {
        return this.label;
      },
    };
    return engine as unknown as SimEngine & typeof engine;
  }

  it('throws at the chosen call and passes every other call to the engine', () => {
    const engine = fakeEngine();
    const trap = new WebAssembly.RuntimeError('unreachable');
    const faulty = withFaults(engine, { at: 'run', call: 3, throws: trap });
    expect(faulty.run(10)).toBe(RunStatus.Running);
    expect(faulty.run(20)).toBe(RunStatus.Running);
    expect(() => faulty.run(30)).toThrow(trap);
    expect(faulty.run(40)).toBe(RunStatus.Running);
    expect(engine.seen).toEqual(['run(10)', 'run(20)', 'run(40)']); // the faulted call never reached it
  });

  it('returns a chosen status instead of calling the engine; `call` defaults to the first', () => {
    const engine = fakeEngine();
    const faulty = withFaults(engine, [
      { at: 'run', returns: RunStatus.Error },
      { at: 'cmdTraceInto', call: 2, returns: RunStatus.Busy },
    ]);
    expect(faulty.run(1)).toBe(RunStatus.Error);
    expect(faulty.run(2)).toBe(RunStatus.Running);
    expect(faulty.cmdTraceInto()).toBe(RunStatus.Stopped); // counted separately for each member
    expect(faulty.cmdTraceInto()).toBe(RunStatus.Busy);
    expect(engine.seen).toEqual(['run(2)', 'cmdTraceInto()']);
  });

  it('a getter can fault too: every read is a use', () => {
    const engine = fakeEngine();
    const faulty = withFaults(engine, { at: 'stepCount', call: 2, throws: new Error('no memory') });
    expect(faulty.stepCount).toBe(42);
    expect(() => faulty.stepCount).toThrow('no memory');
    expect(faulty.stepCount).toBe(42);
    expect(engine.seen).toEqual(['stepCount', 'stepCount']);
  });

  it('methods run on the engine itself, and are the same function on every read', () => {
    const engine = fakeEngine();
    const faulty = withFaults(engine, []) as typeof engine;
    expect(faulty.whoAmI()).toBe('fake');
    expect(faulty.run).toBe(faulty.run);
    expect(faulty.label).toBe('fake');
  });

  it.skipIf(!enginesBuilt)('wraps the real engine; releaseSimEngine on the wrapper releases it', async () => {
    const test = await createTestEngine();
    const faulty = withFaults(test.engine, { at: 'run', call: 2, throws: new Error('trap') });
    expect(faulty.getRegister(Reg.SSP)).toBe(0x01000000);
    expect(faulty.memory.length).toBe(0x1000000);
    expect(faulty.run(10)).toBe(RunStatus.Stopped); // nothing loaded: not running
    expect(() => faulty.run(10)).toThrow('trap');
    expect(faulty.cycles).toBe(0n);
    releaseSimEngine(faulty);
    expect(() => test.engine.run(1)).toThrow(/released/);
    expect(() => faulty.run(1)).toThrow(/released/);
  });
});

describe.skipIf(!enginesBuilt)('with the real engines (needs engine/dist)', ENGINE_TIME, () => {
  it('createTestEngine: the real engine on a recording host, start-up calls included', async () => {
    const test = await createTestEngine();
    expect(test.calls.length).toBeGreaterThan(20);
    expect(test.methodsCalled()).toContain('registersShown');
    expect(test.engine.getRegister(Reg.SSP)).toBe(0x01000000);
    test.forget();
    test.engine.rewind();
    expect(test.methodsCalled()).toContain('clear'); // the same recorder keeps recording
    test.release();
    expect(() => test.engine.rewind()).toThrow(/released/);
  });

  it('createTestEngine(parts): the engine talks to the given part', async () => {
    const files = createMemoryFiles({ 'in.txt': 'data' });
    const test = await createTestEngine({ files });
    const program = await assembleProgram([
      '        ORG     $1000',
      'START   LEA     NAME,A1',
      '        MOVEQ   #51,D0          open existing',
      '        TRAP    #15',
      '        LEA     BUFFER,A1',
      '        MOVEQ   #4,D2',
      '        MOVEQ   #53,D0          read 4 bytes',
      '        TRAP    #15',
      '        SIMHALT',
      "NAME    DC.B    'IN.TXT',0",
      'BUFFER  DS.B    8',
      '        END     START',
    ]);
    test.engine.load(program.s68, program.l68);
    expect(runProgram(test.engine)).toMatchObject({ reason: 'stopped', halted: true });
    expect(test.engine.getRegister(Reg.D0) & 0xffff).toBe(0);
    const buffer = program.result.messages.length === 0 ? addressOf(program.l68, 'BUFFER') : 0;
    expect(textOf(test.engine.memory.subarray(buffer, buffer + 4))).toBe('data');
    // The Borland run-time fills its 512-byte buffer: ReadFile(512), not the program's 4 (STDIO-MODEL.md R1).
    expect(test.callsTo('fileRead')).toEqual([[1, 512]]);
    test.release();
  });

  it('assembleProgram: the .S68 and .L68 of a source, INCLUDE files by name', async () => {
    const program = await assembleProgram('START NOP\r\n  INCLUDE more.x68\r\n  END START\r\n', {
      'more.x68': '  MOVEQ #1,D0\r\n',
    });
    expect(textOf(program.s68)).toMatch(/^S0.*\r\nS1.*4E717001/s);
    expect(textOf(program.l68)).toContain('Created On: 1/1/2026 12:00:00 PM');
    expect(program.result.errorCount).toBe(0);
  });

  it('assembleProgram: a program with errors throws with the messages', async () => {
    await expect(assembleProgram(['START BOGUS', '      END START'])).rejects.toThrow(
      /assembleProgram: 2 error\(s\)\nline 1: ERROR: Invalid opcode\nline 2: ERROR: Undefined symbol/,
    );
  });

  describe('runProgram', () => {
    const echo = [
      '        ORG     $1000',
      'START   LEA     BUFFER,A1',
      '        MOVEQ   #2,D0           read a line',
      '        TRAP    #15',
      'LOOP    BRA     LOOP',
      'BUFFER  DS.B    80',
      '        END     START',
    ];

    it("ends with 'input' when the script has no keys left, and continues with start: false", async () => {
      const program = await assembleProgram(echo);
      const test = await createTestEngine();
      test.engine.load(program.s68, program.l68);
      const first = runProgram(test.engine);
      expect(first).toMatchObject({ reason: 'input', halted: false, statuses: [RunStatus.WaitInput] });
      expect(first.instructions).toBe(2); // LEA and MOVEQ are complete; the TRAP is waiting

      // \n is the Enter key; then the program loops until the limit
      const second = runProgram(test.engine, { start: false, keys: ['ok\n'], maxInstructions: 5000, slice: 1000 });
      expect(second).toMatchObject({
        reason: 'limit',
        halted: false,
        statuses: [RunStatus.WaitInput, RunStatus.Running],
      });
      // the TRAP that was waiting, then five slices of the endless loop: the limit is checked per slice
      expect(second.instructions).toBe(5001);
      expect(test.callsTo('inputEcho').map(([ch]) => String.fromCharCode(ch))).toEqual(['o', 'k']);
      test.release();
    });

    // Gate I2: the limit was checked only while run() returned Running, so a program that waits on
    // every pass of its loop (the official clock examples) ran for ever and the worker ran out of memory.
    it("ends with 'limit' for a program that waits on every pass of its loop", async () => {
      const clock = [
        '        ORG     $1000',
        'START   MOVEQ   #1,D1',
        'LOOP    MOVEQ   #23,D0          delay 1/100 s',
        '        TRAP    #15',
        '        BRA     LOOP',
        '        END     START',
      ];
      const program = await assembleProgram(clock);
      const test = await createTestEngine();
      test.engine.load(program.s68, program.l68);
      const report = runProgram(test.engine, { maxInstructions: 300 });
      expect(report).toMatchObject({ reason: 'limit', halted: false });
      expect(report.statuses).toContain(RunStatus.WaitDelay);
      expect(report.statuses).not.toContain(RunStatus.Stopped);
      // one pass is three instructions; the limit is checked after each wait
      expect(report.instructions).toBeGreaterThanOrEqual(300);
      expect(report.instructions).toBeLessThan(310);
      test.release();
    }, 60_000);

    it("ends with 'error' when run() returns a status it cannot serve", async () => {
      const test = await createTestEngine();
      const faulty = withFaults(test.engine, { at: 'run', returns: RunStatus.Busy });
      expect(runProgram(faulty)).toMatchObject({ reason: 'error', statuses: [RunStatus.Busy] });
      test.release();
    });
  });
});

/** The address of a label, from the symbol table at the end of a listing. */
function addressOf(listing: Uint8Array, label: string): number {
  const line = textOf(listing)
    .split('\r\n')
    .find((text) => text.startsWith(`${label} `));
  if (!line) throw new Error(`no symbol ${label} in the listing`);
  return Number.parseInt(line.slice(label.length).trim(), 16);
}

describe('createMemoryFiles', () => {
  it('opens as the three modes of FileMode ask, without regard to letter case', () => {
    const files = createMemoryFiles({ 'Data.txt': 'hello' });
    expect(files.fileOpen(bytesOf('missing.txt'), FileMode.Read)).toBe(0);
    expect(files.fileOpen(bytesOf('missing.txt'), FileMode.Update)).toBe(0);
    const reading = files.fileOpen(bytesOf('DATA.TXT'), FileMode.Read);
    expect(reading).toBeGreaterThan(0);
    expect(textOf(files.fileRead(reading, 3) ?? [])).toBe('hel');
    expect(textOf(files.fileRead(reading, 10) ?? [])).toBe('lo');
    expect(files.fileRead(reading, 10)).toEqual(new Uint8Array(0)); // end of file: empty, not null
    expect(files.fileWrite(reading, bytesOf('x'))).toBe(-1); // read only
    expect(files.fileClose(reading)).toBe(true);
    expect(files.fileClose(reading)).toBe(false);
    expect(files.fileRead(reading, 1)).toBeNull();
  });

  it('writes, seeks and removes', () => {
    const files = createMemoryFiles();
    const handle = files.fileOpen(bytesOf('new.bin'), FileMode.Create);
    expect(files.fileWrite(handle, bytesOf('abcdef'))).toBe(6);
    expect(files.fileSeek(handle, 2, 0)).toBe(2);
    expect(files.fileWrite(handle, bytesOf('XY'))).toBe(2);
    expect(files.fileSeek(handle, -1, 2)).toBe(5);
    expect(files.fileSeek(handle, -1, 1)).toBe(4);
    expect(files.fileSeek(handle, -9, 0)).toBe(-1);
    expect(files.fileSeek(handle, 0, 0)).toBe(0);
    expect(textOf(files.fileRead(handle, 99) ?? [])).toBe('abXYef');
    expect(files.fileClose(handle)).toBe(true);
    expect(textOf(files.files.get('NEW.BIN') ?? [])).toBe('abXYef');
    expect(files.fileOpen(bytesOf('new.bin'), FileMode.Create)).toBeGreaterThan(0); // truncates
    expect(files.files.get('NEW.BIN')).toEqual([]);
    expect(files.fileRemove(bytesOf('New.Bin'))).toBe(true);
    expect(files.fileRemove(bytesOf('New.Bin'))).toBe(false);
  });
});

describe('bytesOf and textOf', () => {
  it('map every byte value to one character and back', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(bytesOf(textOf(all))).toEqual(all);
    expect(textOf(bytesOf('Hi\r\n'))).toBe('Hi\r\n');
  });

  it('the recording host is a SimHost for the type checker', () => {
    const host: SimHost = createRecordingHost().host;
    expect(typeof host.message).toBe('function');
  });
});
