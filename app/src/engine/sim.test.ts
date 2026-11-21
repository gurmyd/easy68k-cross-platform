// The simulator binding against the real engine (W4 acceptance, 9.1):
// - the mirror tests of 3.2: contracts/engine.ts and contracts/host.ts against engine/sim;
// - the engine's own fixtures run to their halt through createSimEngine (under Node; browser.test.ts
//   repeats it in Chromium and WebKit);
// - the four wait states, the three facts of 3.2, host calls during creation, the address of the
//   server string of task 100, and releaseSimEngine.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as contracts from '../contracts';
import {
  Box,
  MapKind,
  Reg,
  RunStatus,
  ShiftBit,
  SimOption,
  type Bytes,
  type HostNet,
  type SimHost,
} from '../contracts';
import { createSimEngine, releaseSimEngine } from './index';
import { engineLoadInfo } from './loader';
import { HOST_DEFAULTS, HOST_METHODS, HOST_PART_DEFAULTS, SIM_ENGINE_MEMBERS } from './sim';
import {
  assembleProgram,
  bytesOf,
  createRecordingHost,
  createTestEngine,
  describeCall,
  runProgram,
  textOf,
  type TestEngine,
} from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
const fixtureDir = repo('engine/sim/test/fixtures');
const fixture = (file: string): Bytes => new Uint8Array(readFileSync(`${fixtureDir}/${file}`));
const sorted = (values: Iterable<string>) => [...values].sort();

// The engine module is plain JavaScript without type declarations: loaded by URL, as loader.ts does.
type SimModule = Record<string, Record<string, unknown>> & { Sim68k: { prototype: object } };
const loadSimModule = () =>
  import(/* @vite-ignore */ new URL('../../../engine/sim/sim68k.mjs', import.meta.url).href) as Promise<SimModule>;

// ---- mirror -------------------------------------------------------------------------------------

describe('mirror of engine/sim/sim68k.mjs (3.2)', () => {
  it('SimEngine has exactly the methods and getters of Sim68k.prototype', async () => {
    const { Sim68k } = await loadSimModule();
    const theirs = Object.getOwnPropertyNames(Sim68k.prototype).filter(
      (name) => name !== 'constructor' && !name.startsWith('_'),
    );
    // SIM_ENGINE_MEMBERS are the members of the binding class, which `implements SimEngine`.
    expect(sorted(SIM_ENGINE_MEMBERS)).toEqual(sorted(theirs));
    expect(theirs.length).toBe(66);
  });

  it('getters are getters and methods are methods on both sides', async () => {
    const { Sim68k } = await loadSimModule();
    const getters = (prototype: object) =>
      sorted(
        Object.entries(Object.getOwnPropertyDescriptors(prototype))
          .filter(([name, descriptor]) => typeof descriptor.get === 'function' && !name.startsWith('_'))
          .map(([name]) => name),
      );
    expect(getters(Sim68k.prototype)).toEqual([
      'cycles',
      'cyclesText',
      'delayRemaining',
      'listingHighlight',
      'listingLineCount',
      'memory',
      'stepCount',
    ]);
  });

  it('SimHost has exactly the methods of HOST_DEFAULTS, with the same default results', async () => {
    const theirs = (await loadSimModule()).HOST_DEFAULTS as Record<string, unknown>;
    expect(sorted(HOST_METHODS)).toEqual(sorted(Object.keys(theirs)));
    expect(HOST_DEFAULTS).toEqual(theirs);
    expect(HOST_METHODS.length).toBe(93);
  });

  it('the ten host parts hold every method once', () => {
    const names = Object.values(HOST_PART_DEFAULTS).flatMap((part) => Object.keys(part));
    expect(names.length).toBe(93);
    expect(new Set(names).size).toBe(93);
    expect(Object.keys(HOST_PART_DEFAULTS)).toEqual([
      'main',
      'hardware',
      'log',
      'files',
      'text',
      'graphics',
      'sound',
      'serial',
      'net',
      'printer',
    ]);
  });

  it('the constant objects carry the numbers of the module', async () => {
    const sim = await loadSimModule();
    // contract name -> module name; contract keys are the module's keys in another spelling
    const pairs: [Record<string, number>, string][] = [
      [contracts.RunStatus, 'Status'],
      [contracts.Reg, 'Reg'],
      [contracts.Box, 'Box'],
      [contracts.SimOption, 'Option'],
      [contracts.MapKind, 'MapKind'],
      [contracts.HwDevice, 'Device'],
      [contracts.ShiftBit, 'Shift'],
      [contracts.RepaintBit, 'Repaint'],
      [contracts.FileMode, 'FileMode'],
    ];
    const irregular: Record<string, string> = { BitField: 'BITFIELD', SimHalt: 'SIMHALT' };
    const upperSnake = (key: string) => irregular[key] ?? key.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '_').toUpperCase();
    for (const [ours, name] of pairs) {
      const theirs = sim[name] as Record<string, number>;
      const renamed = Object.fromEntries(Object.entries(ours).map(([key, value]) => [upperSnake(key), value]));
      expect(renamed, name).toEqual(theirs);
    }
  });

  it('the constants that only the C header names carry its numbers (shim/host.h)', () => {
    const header = readFileSync(repo('engine/sim/shim/host.h'), 'utf8');
    const value = (name: string): number => {
      const match = new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(header);
      if (!match) throw new Error(`host.h has no ${name}`);
      return Number(match[1]);
    };
    expect(contracts.FontTarget).toEqual({
      IoBackBuffer: value('FONT_TARGET_IO_BACKBUFFER'),
      IoWindow: value('FONT_TARGET_IO_WINDOW'),
      Listing: value('FONT_TARGET_LISTING'),
      Headings: value('FONT_TARGET_HEADINGS'),
      Messages: value('FONT_TARGET_MESSAGES'),
      Printer: value('FONT_TARGET_PRINTER'),
    });
    expect(contracts.FontSource).toEqual({
      IoDialog: value('FONT_SOURCE_IO_DIALOG'),
      ListingDialog: value('FONT_SOURCE_LISTING_DIALOG'),
      PrinterDialog: value('FONT_SOURCE_PRINTER_DIALOG'),
    });
    expect(contracts.PrinterMetric).toEqual({
      RowHeight: value('PRN_ROW_HEIGHT'),
      ColWidth: value('PRN_COL_WIDTH'),
      PageHeight: value('PRN_PAGE_HEIGHT'),
      PageWidth: value('PRN_PAGE_WIDTH'),
    });
  });
});

// ---- the real engine ----------------------------------------------------------------------------

/** Loads a fixture of the engine's own test suite; `caseNumber` goes to D7 (dispatcher fixtures). */
function loadFixture(test: TestEngine, name: string, caseNumber?: number): void {
  test.engine.load(fixture(`${name}.S68`), fixture(`${name}.L68`), { name: `${name}.S68` });
  if (caseNumber !== undefined) test.engine.setRegister(Reg.D7, caseNumber);
}

const RESULTS = 0x4000; // where the io fixture stores what a test checks
const INBUF = 0x5000;

describe.skipIf(!enginesBuilt)('createSimEngine with the real engine (needs engine/dist)', () => {
  describe("the engine's own fixtures run to their halt", () => {
    const names = readdirSync(fixtureDir)
      .filter((file) => file.endsWith('.S68'))
      .map((file) => file.slice(0, -4))
      .sort();

    it('finds the fixtures with their listings', () => {
      expect(names.length).toBeGreaterThanOrEqual(11);
      for (const name of names) expect(existsSync(`${fixtureDir}/${name}.L68`), name).toBe(true);
    });

    // Case 0 of irq spins until an interrupt that a test requests; its case 2 (STOP with exceptions
    // off) halts by itself.
    const caseOf: Record<string, number> = { irq: 2 };
    for (const name of names) {
      it(name, async () => {
        const test = await createTestEngine();
        loadFixture(test, name, caseOf[name] ?? 0);
        let report = runProgram(test.engine, { keys: ['W4\r'] });
        // debug.L68 carries a break directive: the run stops there once, without a halt
        for (let stops = 0; report.reason === 'stopped' && !report.halted && stops < 5; stops++) {
          report = runProgram(test.engine);
        }
        expect(report).toMatchObject({ reason: 'stopped', halted: true });
        expect(report.instructions).toBeGreaterThan(0);
        expect(test.callsTo('message').map(([text]) => textOf(text))).toContain('.S68 file read successful');
        test.release();
      });
    }
  });

  describe('wait states: the engine returns, the host does its part, run() resumes', () => {
    it('task 2 returns WaitInput until the line is complete', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'io', 2);
      test.engine.cmdRun();
      expect(test.engine.run(1000)).toBe(RunStatus.WaitInput);
      expect(test.engine.state()).toMatchObject({ inputMode: true, runMode: true });
      expect(test.engine.run(1000)).toBe(RunStatus.WaitInput);
      for (const ch of 'Hi') test.engine.keyChar(ch.charCodeAt(0));
      expect(test.engine.run(1000)).toBe(RunStatus.WaitInput);
      test.engine.keyChar(13);
      expect(test.engine.run(1000)).toBe(RunStatus.Stopped);
      expect(test.engine.state().halt).toBe(true);
      expect(test.engine.readLong(RESULTS)).toBe(2); // the length, in D1
      expect(textOf(test.engine.memory.subarray(INBUF, INBUF + 3))).toBe('Hi\0');
      expect(test.callsTo('textOut').map(([text]) => textOf(text))).toEqual(['Hi']); // printed back
      test.release();
    });

    it('task 23 returns WaitDelay until the time has been reported', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'io', 9);
      test.engine.cmdRun();
      expect(test.engine.run(1000)).toBe(RunStatus.WaitDelay);
      expect(test.engine.delayRemaining).toBe(50);
      test.engine.delayElapsed(20);
      expect(test.engine.run(1000)).toBe(RunStatus.WaitDelay);
      expect(test.engine.delayRemaining).toBe(30);
      test.engine.delayElapsed(30);
      expect(test.engine.run(1000)).toBe(RunStatus.Stopped);
      expect(test.engine.state().halt).toBe(true);
      expect(test.callsTo('textOut').map(([text]) => textOf(text))).toEqual(['ABC', 'DEF']); // before, after
      test.release();
    });

    it('task 58 returns WaitHost until the dialog is answered', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'io', 13);
      test.engine.cmdRun();
      expect(test.engine.run(1000)).toBe(RunStatus.WaitHost);
      // mode 0 = Open, the title, the filter (the pattern is also its own description), no file name
      expect(test.calls.filter((call) => call.method === 'fileDialog').map(describeCall)).toEqual([
        'fileDialog(0,"ABC","DEF|DEF","")',
      ]);
      expect(test.engine.state().fileDialogOpen).toBe(true);
      expect(test.engine.run(1000)).toBe(RunStatus.WaitHost);
      test.engine.fileDialogReply(true, bytesOf('C:\\DATA\\X.TXT'));
      expect(test.engine.run(1000)).toBe(RunStatus.Stopped);
      expect(test.engine.state()).toMatchObject({ halt: true, fileDialogOpen: false });
      expect(test.engine.readLong(RESULTS)).toBe(1); // D1 = 1: a file was chosen
      expect(textOf(test.engine.memory.subarray(INBUF, INBUF + 14))).toBe('C:\\DATA\\X.TXT\0');
      test.release();
    });

    it('a message box returns WaitAlert until it is dismissed', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'io', 0);
      test.engine.setOption(SimOption.ExecLogType, 1);
      test.engine.startLog('1/1/2026 12:00:00 PM');
      test.engine.cmdRun();
      // SIMHALT stops a running log with the box "Current Log Stopped."
      expect(test.engine.run(100_000)).toBe(RunStatus.WaitAlert);
      expect(test.callsTo('alert').map(([title, text]) => [textOf(title), textOf(text)])).toEqual([
        ['Information', 'Current Log Stopped.'],
      ]);
      expect(test.engine.state().alertOpen).toBe(true);
      expect(test.engine.run(1000)).toBe(RunStatus.WaitAlert);
      test.engine.dismissAlert();
      expect(test.engine.run(1000)).toBe(RunStatus.Stopped);
      expect(test.engine.state()).toMatchObject({ halt: true, alertOpen: false, logging: false });
      expect(textOf(test.callsTo('logWrite')[0]?.[0] ?? [])).toBe(
        'EASy68K execution log file: 1/1/2026 12:00:00 PM\r\n\r\n',
      );
      test.release();
    });
  });

  describe('the three facts of 3.2', () => {
    it('1. state survives load, and only a new instance is in start-up state', async () => {
      const test = await createTestEngine();
      const engine = test.engine;
      engine.setMemoryMap(MapKind.Rom, { enabled: true, start: 0x7000, end: 0x70ff });
      engine.selectAutoIrq(3);
      engine.setAutoInterval(250);
      engine.keyDown(0x41);
      engine.setBreakpoint(0x1004);
      engine.writeBytes(0x9000, [1, 2, 3]);

      engine.load(fixture('io.S68'), fixture('io.L68'), { name: 'io.S68', kind: 'reload' });
      expect(engine.hardware().map[MapKind.Rom]).toEqual({ enabled: true, start: 0x7000, end: 0x70ff });
      expect(engine.hardware().auto[3]?.intervalMs).toBe(250);
      expect(engine.breakpoints()).toEqual([0x1004]);
      expect(engine.readByte(0x9000)).toBe(0xff); // memory itself is filled again by every load

      engine.load(fixture('io.S68'), fixture('io.L68'), { name: 'io.S68', kind: 'open' });
      expect(engine.breakpoints()).toEqual([]); // File > Open clears the PC breakpoints
      expect(engine.hardware().map[MapKind.Rom]?.enabled).toBe(true); // but not the memory map
      // the key table of task 19 survives too: case 15 of the fixture asks whether "A" is down
      engine.setRegister(Reg.D7, 15);
      runProgram(engine);
      expect(engine.readLong(RESULTS)).toBe(0x000000ff);

      // "process-start state" (4.7.1) is releaseSimEngine followed by createSimEngine
      test.release();
      const fresh = await createTestEngine();
      expect(fresh.engine.hardware().map[MapKind.Rom]).toEqual({ enabled: false, start: 0, end: 0 });
      expect(fresh.engine.hardware().auto[3]?.intervalMs).toBe(1000);
      expect(fresh.engine.breakpoints()).toEqual([]);
      loadFixture(fresh, 'io', 15);
      runProgram(fresh.engine);
      expect(fresh.engine.readLong(RESULTS)).toBe(0); // "A" is not down
      fresh.release();
    });

    const waits: [string, number, RunStatus][] = [
      ['a keyboard read', 2, RunStatus.WaitInput],
      ['a delay', 9, RunStatus.WaitDelay],
    ];
    const enders: [string, (test: TestEngine) => void][] = [
      ['load', (test) => loadFixture(test, 'io', 0)],
      ['rewind', (test) => test.engine.rewind()],
      ['cmdPause', (test) => test.engine.cmdPause()],
      ['close', (test) => test.engine.close()],
    ];
    for (const [waitName, caseNumber, status] of waits) {
      for (const [enderName, end] of enders) {
        it(`2. ${enderName}() during ${waitName} finishes the suspended step itself: no run() is needed`, async () => {
          const test = await createTestEngine();
          loadFixture(test, 'io', caseNumber);
          test.engine.cmdRun();
          expect(test.engine.run(1000)).toBe(status);
          expect(test.engine.state().phase).not.toBe(0); // a step is suspended
          expect(test.engine.cmdTraceInto()).toBe(RunStatus.Busy); // and refuses commands that execute

          end(test);
          expect(test.engine.state()).toMatchObject({ phase: 0, runMode: false, inputMode: false });
          const steps = test.engine.stepCount;
          expect(test.engine.run(1000)).toBe(RunStatus.Stopped); // nothing left to tidy up
          expect(test.engine.stepCount).toBe(steps);
          test.release();
        });
      }
    }

    it('2. run(0) finishes a suspended step and starts no new instruction', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'io', 9);
      test.engine.cmdRun();
      expect(test.engine.run(1000)).toBe(RunStatus.WaitDelay);
      const steps = test.engine.stepCount;
      const pc = test.engine.getRegister(Reg.PC);
      test.engine.delayElapsed(test.engine.delayRemaining);
      expect(test.engine.run(0)).toBe(RunStatus.Running);
      expect(test.engine.state().phase).toBe(0);
      expect(test.engine.stepCount).toBe(steps + 1); // the TRAP that was waiting
      expect(test.engine.getRegister(Reg.PC)).toBe(pc);
      expect(test.engine.run(0)).toBe(RunStatus.Running); // and again nothing
      expect(test.engine.stepCount).toBe(steps + 1);
      test.release();
    });

    it('3. a key or mouse interrupt starts a stopped program: only state().runMode tells', async () => {
      const program = await assembleProgram([
        '        ORG     $1000',
        'START   MOVE.L  #MOUSE,$64      level 1 autovector',
        '        MOVE.L  #KEY,$68        level 2 autovector',
        '        MOVE.L  #$0201,D1       key-down interrupt at level 2',
        '        MOVEQ   #62,D0',
        '        TRAP    #15',
        '        MOVE.L  #$0101,D1       mouse-down interrupt at level 1',
        '        MOVEQ   #60,D0',
        '        TRAP    #15',
        '        STOP    #$2000',
        '        ADDQ.L  #1,D3',
        '        STOP    #$2000',
        '        ADDQ.L  #1,D3',
        '        SIMHALT',
        'KEY     ADDQ.L  #1,D4',
        '        RTE',
        'MOUSE   ADDQ.L  #1,D5',
        '        RTE',
        '        END     START',
      ]);
      const test = await createTestEngine();
      const engine = test.engine;
      engine.setOption(SimOption.Exceptions, true);
      engine.load(program.s68, program.l68, { name: 'wake.S68' });

      expect(runProgram(engine)).toMatchObject({ reason: 'stopped', halted: true }); // the first STOP
      expect(engine.state()).toMatchObject({ runMode: false, stopInstruction: true, hardwareEnabled: true });

      // keyDown() answers whether key commands are enabled, not whether the program must run
      expect(engine.keyDown(0x41)).toBe(true);
      expect(engine.state().runMode).toBe(true);
      expect(runProgram(engine, { start: false })).toMatchObject({ reason: 'stopped', halted: true }); // the second STOP
      expect([engine.getRegister(Reg.D4), engine.getRegister(Reg.D3)]).toEqual([1, 1]);

      engine.keyUp(0x41); // not armed: nothing starts
      expect(engine.state().runMode).toBe(false);
      engine.mouseMove(5, 5, 0);
      expect(engine.state().runMode).toBe(false);

      engine.mouseDown(10, 20, ShiftBit.Left);
      expect(engine.state().runMode).toBe(true);
      expect(runProgram(engine, { start: false })).toMatchObject({ reason: 'stopped', halted: true }); // SIMHALT
      expect([engine.getRegister(Reg.D5), engine.getRegister(Reg.D3)]).toEqual([1, 2]);
      test.release();
    });

    it('3. irq(), hardwareReset() and timerTick() say themselves that execution must start', async () => {
      const test = await createTestEngine();
      const engine = test.engine;
      engine.setOption(SimOption.Exceptions, true);
      loadFixture(test, 'irq', 2); // STOP #$2000, then two instructions and SIMHALT
      expect(runProgram(engine)).toMatchObject({ reason: 'stopped' });
      expect(engine.state()).toMatchObject({ runMode: false, stopInstruction: true });
      expect(engine.timerTick(3)).toBe(false); // that timer is not enabled
      expect(engine.irq(3)).toBe(true);
      expect(engine.state().runMode).toBe(true);
      expect(runProgram(engine, { start: false })).toMatchObject({ reason: 'stopped', halted: true });
      expect(engine.getRegister(Reg.D3)).toBe(2);
      test.release();
    });
  });

  describe('the host', () => {
    it('receives the calls of the start-up reset while createSimEngine runs (3.3.2)', async () => {
      const recording = createRecordingHost();
      const pending = createSimEngine(recording.host);
      expect(recording.calls).toEqual([]); // nothing synchronous
      const engine = await pending;
      const log = recording.calls.map(describeCall);
      // initSim() in the original's order (trap15-a §2), as far as it reaches the host
      const expected = [
        'clear()',
        'setWindowSize(0,0)',
        'setDrawingMode(4)',
        'setDrawingMode(16)',
        'setPenWidth(1)',
        'setLineColor(16777215)',
        'setFillColor(0)',
        'fontAssign(1,101)',
        'fontAssign(2,101)',
        'registersShown()',
        'resetSounds()',
        'keyCommands(true)',
        'netCloseSockets()',
      ];
      expect(log.filter((line) => expected.includes(line))).toEqual(expected);
      expect(sorted(new Set(recording.calls.map((call) => call.method)))).toEqual(
        sorted([
          'clear',
          'fontAssign',
          'hardwareControls',
          'hardwareState',
          'keyCommands',
          'menuState',
          'netCloseSockets',
          'registersShown',
          'repaint',
          'resetSounds',
          'setDrawingMode',
          'setFillColor',
          'setLineColor',
          'setPenWidth',
          'setWindowSize',
        ]),
      );
      // start-up state: sim-ui §9.9
      expect(engine.registers()).toMatchObject({ pc: 0, sr: 0x2000, usp: 0x00ff0000, ssp: 0x01000000 });
      expect(engine.memory.length).toBe(0x1000000);
      expect(engine.readLong(0x1000)).toBe(0xffffffff);
      expect(engine.boxText(Box.SR)).toBe('0010000000000000');
      releaseSimEngine(engine);
    });

    it('is called with itself as `this`, and a method it lacks falls back to the engine default', async () => {
      const lines: string[] = [];
      const host = {
        prefix: '> ',
        message(this: { prefix: string }, text: Bytes) {
          lines.push(this.prefix + textOf(text));
        },
      };
      const engine = await createSimEngine(host as unknown as SimHost);
      engine.load(fixture('io.S68'), fixture('io.L68'), { name: 'io.S68' });
      engine.setRegister(Reg.D7, 8); // task 8 and others with a host that answers nothing
      expect(runProgram(engine)).toMatchObject({ halted: true });
      expect(lines).toContain('> .S68 file read successful');
      expect(engine.readLong(RESULTS)).toBe(0); // timeCentiseconds: the default 0
      releaseSimEngine(engine);
    });

    it('createNetClient receives the 68000 address of its server string (3.3.4)', async () => {
      const program = await assembleProgram([
        '        ORG     $1000',
        'START   MOVEA.L #$FF000000+SERVER,A2    the address is A2 without its top byte',
        '        MOVE.L  #$00500001,D1',
        '        MOVEQ   #100,D0',
        '        TRAP    #15',
        '        MOVE.L  D0,RESULT',
        '        SIMHALT',
        'RESULT  DC.L    0',
        '        ORG     $2000',
        "SERVER  DC.B    'example.org',0",
        '        DS.B     16',
        '        END     START',
      ]);
      const seen: unknown[][] = [];
      let memory = (): Uint8Array => new Uint8Array(0);
      const net: HostNet = {
        ...HOST_PART_DEFAULTS.net,
        createNetServer: () => undefined,
        sendNet: () => undefined,
        receiveNet: () => undefined,
        sendPortNet: () => undefined,
        receivePortNet: () => undefined,
        closeNetConnection: () => undefined,
        getLocalIP: () => undefined,
        netCloseSockets: () => 0,
        createNetClient(settings, server, serverAddress) {
          seen.push([settings, textOf(server), serverAddress]);
          // what the desktop host does after a name lookup: 16 bytes, the dotted address zero-padded
          const resolved = new Uint8Array(16);
          resolved.set(bytesOf('192.0.2.7'));
          if (serverAddress !== undefined) memory().set(resolved, serverAddress);
          return 0;
        },
      };
      const test = await createTestEngine({ net });
      memory = () => test.engine.memory;
      test.engine.load(program.s68, program.l68, { name: 'net.S68' });
      expect(runProgram(test.engine)).toMatchObject({ halted: true });
      expect(seen).toEqual([[0x00500001, 'example.org', 0x2000]]);
      expect(textOf(test.engine.memory.subarray(0x2000, 0x2010))).toBe('192.0.2.7'.padEnd(16, '\0'));
      test.release();
    });
  });

  describe('what ARCHITECTURE.md 10.3 asks W4 to confirm about the module', () => {
    it('cmdRunToCursor on a row without an address shows the box and then runs the program all the same', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'arith');
      expect(textOf(test.engine.listingLine(0))).toBe('00001000 Starting Address'); // a header row
      test.engine.cmdRunToCursor(0);
      expect(test.engine.run(1000)).toBe(RunStatus.WaitAlert);
      expect(test.calls.filter((call) => call.method === 'alert').map(describeCall)).toEqual([
        'alert("Error","Selected line does not have a valid address.")',
      ]);
      test.engine.dismissAlert();
      // The original runs on after its box; that is why the port checks the row itself (note 23).
      expect(runProgram(test.engine, { start: false })).toMatchObject({ reason: 'stopped', halted: true });
      expect(test.engine.stepCount).toBeGreaterThan(100);
      test.release();
    });

    it('with no row selected the box reads "Invalid Run-To-Cursor Selection"', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'arith');
      test.engine.cmdRunToCursor(-1);
      expect(test.engine.run(1000)).toBe(RunStatus.WaitAlert);
      expect(test.callsTo('alert').map(([, text]) => textOf(text))).toEqual(['Invalid Run-To-Cursor Selection']);
      test.release();
    });

    it('cyclesText is the display text; cycles is the number', async () => {
      const test = await createTestEngine();
      loadFixture(test, 'arith');
      runProgram(test.engine);
      expect(test.engine.cycles).toBeTypeOf('bigint');
      expect(test.engine.cycles).toBeGreaterThan(0n);
      expect(test.engine.cyclesText).toBe(String(test.engine.cycles));
      test.engine.clearCycles();
      expect([test.engine.cycles, test.engine.cyclesText]).toEqual([0n, '0']);
      test.release();
    });

    it('writeBytes changes memory and nothing else: the host is not told, the hardware not refreshed', async () => {
      const test = await createTestEngine();
      test.engine.setHardwareVisible(true);
      test.engine.setOption(SimOption.MemLive, true);
      test.forget();
      const led = test.engine.hardware().led;
      test.engine.writeBytes(led, [0x55]);
      expect(test.engine.readByte(led)).toBe(0x55);
      expect(test.engine.memory[led]).toBe(0x55);
      expect(test.calls).toEqual([]);
      test.release();
    });
  });

  describe('instances', () => {
    it('are independent, and all come from one compilation of the .wasm', async () => {
      const a = await createTestEngine();
      const b = await createTestEngine();
      a.engine.writeBytes(0x9000, [0x12]);
      a.engine.setRegister(Reg.D0, 7);
      expect(b.engine.readByte(0x9000)).toBe(0xff);
      expect(b.engine.getRegister(Reg.D0)).toBe(0);
      expect(a.engine.memory.buffer).not.toBe(b.engine.memory.buffer);
      expect(engineLoadInfo('sim').compilations).toBe(1);
      a.release();
      b.release();
    });

    it('releaseSimEngine cuts the binding off: every member then throws, a second release does nothing', async () => {
      const test = await createTestEngine();
      const other = await createTestEngine();
      releaseSimEngine(test.engine);
      expect(() => test.engine.run(1)).toThrow(/released with releaseSimEngine/);
      expect(() => test.engine.memory).toThrow(/released/);
      expect(() => test.engine.getRegister(Reg.PC)).toThrow(/released/);
      releaseSimEngine(test.engine);
      releaseSimEngine({} as contracts.SimEngine); // not an engine of the binding: ignored
      expect(other.engine.getRegister(Reg.SSP)).toBe(0x01000000);
      other.release();
    });

    it('a released instance can be collected: its 64 MiB of memory goes', async () => {
      setFlagsFromString('--expose-gc');
      const collect = runInNewContext('gc') as () => void;
      const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
      const memories: WeakRef<ArrayBufferLike>[] = [];
      // The application may keep its `SimEngine` object after the release (a stale variable, a
      // closure): the engine objects stay referenced here, and their memory must go all the same.
      const released: TestEngine[] = [];
      const kept = await createTestEngine();
      for (let i = 0; i < 4; i++) {
        const test = await createTestEngine();
        expect(test.engine.memory.buffer.byteLength).toBe(64 * 1024 * 1024);
        memories.push(new WeakRef(test.engine.memory.buffer));
        test.release();
        released.push(test);
      }
      const keptMemory = new WeakRef(kept.engine.memory.buffer);
      // A WeakRef keeps its target for the rest of the task that made it; collect in later ones.
      for (let attempt = 0; attempt < 25 && memories.some((memory) => memory.deref()); attempt++) {
        await nextTask();
        collect();
      }
      expect(memories.map((memory) => memory.deref() === undefined)).toEqual([true, true, true, true]);
      expect(released.map((test) => typeof test.engine)).toEqual(['object', 'object', 'object', 'object']);
      expect(keptMemory.deref()).toBeDefined(); // an engine in use is not affected
      expect(kept.engine.getRegister(Reg.SSP)).toBe(0x01000000);
      kept.release();
    });

    it('200 consecutive releaseSimEngine / createSimEngine cycles succeed', async () => {
      let test = await createTestEngine();
      for (let cycle = 0; cycle < 200; cycle++) {
        test.release();
        test = await createTestEngine();
        test.engine.writeBytes(0x1000, [cycle & 0xff]);
        expect(test.engine.readByte(0x1000)).toBe(cycle & 0xff);
      }
      expect(test.engine.getRegister(Reg.SSP)).toBe(0x01000000);
      expect(engineLoadInfo('sim').compilations).toBe(1);
      test.release();
    });
  });
});
