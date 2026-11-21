// W4 acceptance (9.1): a program that calls every TRAP #15 task reaches every SimHost method the
// specs say it should, seen by a recording host. And, with the debugger actions that tasks cannot
// cause, the engine reaches all 93 host methods through the binding.
//
// The program and the table of expected methods are TRAP15_TOUR in testing.ts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { RunStatus, SimOption, type SimHost } from '../contracts';
import { HOST_METHODS } from './sim';
import {
  assembleProgram,
  createMemoryFiles,
  createTestEngine,
  runProgram,
  runTrap15Tour,
  textOf,
  trap15TourSource,
  TRAP15_TOUR,
  type AssembledProgram,
  type TourResult,
} from './testing';

const dist = (file: string) => fileURLToPath(new URL(`../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
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

/** The task numbers that have a `case` in the original's TRAP() (trap15-a §1.2, trap15-b §2.1). */
const TASK_INVENTORY = [
  ...range(0, 25),
  ...range(30, 33),
  ...range(40, 43),
  ...range(50, 59),
  ...range(60, 62),
  ...range(70, 77),
  ...range(80, 96),
  ...range(100, 107),
];

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

const sorted = <T>(values: Iterable<T>) => [...values].sort();

describe('TRAP15_TOUR', () => {
  it('calls every task of the inventory, and task 9 last', () => {
    expect(sorted(new Set(TRAP15_TOUR.map((step) => step.task)))).toEqual(sorted(TASK_INVENTORY));
    expect(TRAP15_TOUR.at(-1)?.task).toBe(9);
  });

  it('calls every sub-task of task 32', () => {
    const subTasks = TRAP15_TOUR.filter((step) => step.task === 32).map((step) => step.setup[0]);
    expect(new Set(subTasks)).toEqual(new Set(range(0, 7).map((n) => `MOVEQ #${n},D1`)));
  });
});

describe.skipIf(!enginesBuilt)('the tour on the real engine (needs engine/dist)', ENGINE_TIME, () => {
  let program: AssembledProgram;
  let tour: TourResult;
  let memory: Uint8Array;
  let files: ReturnType<typeof createMemoryFiles>;

  beforeAll(async () => {
    program = await assembleProgram(trap15TourSource());
    files = createMemoryFiles();
    const test = await createTestEngine({ files });
    tour = runTrap15Tour(test, program);
    memory = test.engine.memory.slice(0x5000, 0x5200);
    test.release();
  }, 120_000);

  it('runs to its end through every wait state', () => {
    expect(tour.report).toMatchObject({ reason: 'stopped', halted: true });
    // tasks 2, 4, 5 and 18 wait for keys, then task 23 for time, then task 58 for the dialog
    expect(tour.report.statuses).toEqual([
      RunStatus.WaitInput,
      RunStatus.WaitDelay,
      RunStatus.WaitHost,
      RunStatus.Stopped,
    ]);
  });

  it('pressing Run brings the output forward and arms the hardware (4.8)', () => {
    expect(sorted(tour.before)).toEqual(sorted(['menuState', 'ioBringToFront', 'hardwareState']));
  });

  for (const [index, step] of TRAP15_TOUR.entries()) {
    it(`task ${step.task}, ${step.what}: ${step.reaches.join(', ') || 'no host call'}`, () => {
      expect(sorted(tour.reached[index] ?? [])).toEqual(sorted(new Set(step.reaches)));
    });
  }

  it('the host saw the arguments the program gave', () => {
    expect(tour.log).toContain('textOutCR("HI")');
    expect(tour.log).toContain('line(1,2,30,40)');
    expect(tour.log).toContain('setWindowSize(800,600)');
    // the dialog's initial file name is what the buffer holds: the two bytes task 53 read back
    expect(tour.log).toContain('fileDialog(0,"","","HI")');
    expect(tour.log).toContain('printerTextOut(0,0,80)');
    expect(tour.log).toContain('hardwareTimer(1,true,500)');
    expect(tour.log).toContain('initComm(0,"COM1")');
  });

  it('the program got the results of the host and of the keyboard', () => {
    // task 2: A, X, Backspace, B; task 58 later stored the chosen path in the same buffer
    expect(tour.log.filter((line) => /^input(Echo|Backspace)/.test(line)).slice(0, 4)).toEqual([
      'inputEcho(65,true)',
      'inputEcho(88,true)',
      'inputBackspace(true)',
      'inputEcho(66,true)',
    ]);
    expect(textOf(memory.subarray(0, 11))).toBe('C:\\TOUR.TXT');
    // the file tasks: written, read back, closed, found and deleted
    expect(tour.log).toContain('fileWrite(1,"HI")');
    expect(tour.log).toContain('fileRead(1,2)');
    expect(files.files.size).toBe(0);
  });

  it('the tour reaches the 80 host methods a task can reach', () => {
    const byTasks = new Set(tour.reached.flat());
    const expected = new Set(TRAP15_TOUR.flatMap((step) => step.reaches));
    expect(sorted(byTasks)).toEqual(sorted(expected));
    expect(byTasks.size).toBe(80);
  });

  it('with start-up, a load, the log and the debugger the engine reaches all 93 host methods', async () => {
    const test = await createTestEngine({ files: createMemoryFiles() });
    const reached = new Set<keyof SimHost>(test.methodsCalled()); // start-up reset
    const note = () => {
      for (const method of test.methodsCalled()) reached.add(method);
    };

    // the tour: load, Run, every task
    runTrap15Tour(test, program);
    note();

    // the execution log and the output log: Log Start, a traced instruction, Rewind, SIMHALT
    test.engine.load(program.s68, program.l68, { name: 'tour.S68' });
    test.engine.setOption(SimOption.ExecLogType, 1);
    test.engine.setOption(SimOption.OutputLogType, 1);
    test.engine.logDialogOpened();
    test.engine.startLog('1/1/2026 12:00:00 PM');
    expect(test.engine.cmdTraceInto()).toBe(RunStatus.Stopped);
    test.engine.rewind();
    test.engine.cmdAutoTrace();
    test.engine.cmdPause();
    test.engine.stopLog();
    note();

    // a message box: Run To Cursor on a row that is not an instruction
    test.engine.cmdRunToCursor(0);
    expect(test.engine.run(1000)).toBe(RunStatus.WaitAlert);
    test.engine.dismissAlert();
    test.engine.cmdPause();
    note();

    expect(sorted(reached)).toEqual(sorted(HOST_METHODS));
    expect(reached.size).toBe(93);
    test.release();
  });
});

// Gate I2: where the official SIM68K.exe was measured (T3, tests/conformance/sim trap15-a a05, a31,
// a32; errata T3.md F1, F3, F4; T4.md D1) and the engine had to follow (engine/sim/PATCHES.md P24 and
// section 3, easy68k_fread / easy68k_fwrite).
describe.skipIf(!enginesBuilt)('TRAP #15 edge cases measured in the official binary (needs engine/dist)', () => {
  const source = [
    '        ORG     $1000',
    'START   LEA     NAME,A1',
    '        MOVE.B  #52,D0          open a new file',
    '        TRAP    #15',
    '        MOVE.L  D1,D6           file ID',
    '        LEA     DATA,A1',
    '        MOVE.L  #10,D2',
    '        MOVE.B  #54,D0          write 10 bytes',
    '        TRAP    #15',
    '        MOVE.L  #$12340036,D0   task 54 with D2 = 0',
    '        MOVE.L  D6,D1',
    '        MOVEQ   #0,D2',
    '        TRAP    #15',
    '        MOVE.L  D0,RES',
    '        MOVE.L  D6,D1',
    '        MOVEQ   #0,D2',
    '        MOVE.B  #55,D0          back to the start',
    '        TRAP    #15',
    '        MOVE.L  #$12340035,D0   task 53: A1 + D2 wraps past 2^32',
    '        MOVE.L  D6,D1',
    '        LEA     $2000,A1',
    '        MOVE.L  #$FFFFFFFF,D2',
    '        TRAP    #15',
    '        MOVE.L  D0,RES+4',
    '        MOVE.L  D2,RES+8',
    '        MOVE.B  #53,D0          control: 4 bytes from the same position',
    '        MOVE.L  D6,D1',
    '        LEA     $2100,A1',
    '        MOVEQ   #4,D2',
    '        TRAP    #15',
    '        MOVE.L  D0,RES+12',
    '        MOVE.L  D2,RES+16',
    '        LEA     LONG,A1',
    '        MOVE.W  #-1,D1',
    '        MOVE.B  #0,D0           task 0, D1.W negative, 300 bytes',
    '        TRAP    #15',
    '        MOVE.W  #$8000,D1',
    '        MOVE.B  #1,D0           task 1, D1.W = $8000',
    '        TRAP    #15',
    '        SIMHALT',
    "NAME    DC.B    'EDGE.BIN',0",
    "DATA    DC.B    '0123456789'",
    '        ORG     $3000',
    'RES     DS.L    5',
    "LONG    DCB.B   300,'A'",
    "        DC.B    'Z',0",
    '        END     START',
  ];
  let memory: Uint8Array;
  let printed: string[];

  beforeAll(async () => {
    const program = await assembleProgram(source);
    const test = await createTestEngine({ files: createMemoryFiles() });
    test.engine.load(program.s68, program.l68, { name: 'edge.S68' });
    test.forget();
    expect(runProgram(test.engine, { maxInstructions: 10_000 })).toMatchObject({ reason: 'stopped', halted: true });
    memory = test.engine.memory.slice(0, 0x4000);
    printed = [
      ...test.callsTo('textOutCR').map(([text]) => textOf(text as Uint8Array)),
      ...test.callsTo('textOut').map(([text]) => textOf(text as Uint8Array)),
    ];
    test.release();
  }, 120_000);

  const long = (address: number) => new DataView(memory.buffer, memory.byteOffset).getUint32(address);

  it('task 54 with D2 = 0 succeeds: D0.W = 0 (the Borland fwrite returns the item count)', () => {
    expect(long(0x3000)).toBe(0x12340000);
  });

  it('task 53 whose bounds test wraps: D0.W = 0, D2 unchanged, nothing read', () => {
    expect(long(0x3004)).toBe(0x12340000);
    expect(long(0x3008)).toBe(0xffffffff);
    expect([...memory.subarray(0x2000, 0x2010)]).toEqual(new Array(16).fill(0xff));
    // the position did not move: the next read gets the first 4 bytes
    expect(long(0x300c) & 0xffff).toBe(0);
    expect(long(0x3010)).toBe(4);
    expect(textOf(memory.subarray(0x2100, 0x2104))).toBe('0123');
  });

  it('tasks 0 and 1 with a negative D1.W print exactly 255 characters of a longer string', () => {
    expect(printed).toEqual(['A'.repeat(255), 'A'.repeat(255)]);
  });
});

// Gate I2: the two defects of the original's Save branch of task 58 are not reproduced
// (ARCHITECTURE.md 3.8.4; engine/sim/PATCHES.md section 5; errata SH6.md entry 12).
describe.skipIf(!enginesBuilt)('TRAP #15 task 58, Save mode (needs engine/dist)', () => {
  const source = [
    '        ORG     $1000',
    'START   MOVEQ   #1,D1           Save dialog with a file name',
    '        SUBA.L  A1,A1',
    '        SUBA.L  A2,A2',
    '        LEA     PATH,A3',
    '        MOVE.B  #58,D0',
    '        TRAP    #15',
    '        MOVE.B  #0,PATH         Save dialog with an empty name',
    '        MOVEQ   #1,D1',
    '        MOVE.B  #58,D0',
    '        TRAP    #15',
    '        MOVE.B  #0,$FFFFF8      Save near the end of memory',
    '        MOVEQ   #1,D1',
    '        MOVEA.L #$FFFFF8,A3',
    '        MOVE.L  #$12340000+58,D0',
    '        TRAP    #15',
    '        MOVE.L  D0,RES',
    '        MOVE.L  D1,RES+4',
    '        SIMHALT',
    "PATH    DC.B    'FIRST.TXT',0",
    '        DS.B    256',
    '        ORG     $3000',
    'RES     DS.L    2',
    '        END     START',
  ];

  it("an empty name clears the Save dialog's own name; the overflow test measures the chosen name", async () => {
    const program = await assembleProgram(source);
    const test = await createTestEngine({ files: createMemoryFiles() });
    test.engine.load(program.s68, program.l68, { name: 'save.S68' });
    test.forget();
    const report = runProgram(test.engine, {
      maxInstructions: 10_000,
      dialogs: [
        { accepted: true, fileName: 'C:\\SAVED.TXT' },
        { accepted: false },
        { accepted: true, fileName: 'C:\\LONGNAME.TXT' },
      ],
    });
    expect(report).toMatchObject({ reason: 'stopped', halted: true });
    const initialNames = test.callsTo('fileDialog').map((args) => textOf(args[3] as Uint8Array));
    // The original showed 'C:\SAVED.TXT' again the second time (it cleared the Open dialog's name).
    expect(initialNames).toEqual(['FIRST.TXT', '', '']);
    const view = new DataView(test.engine.memory.buffer, test.engine.memory.byteOffset);
    // $FFFFF8 + 15 bytes passes the end of memory: error. The original measured the Open dialog's
    // name (empty) and wrote the path past the end.
    expect(view.getUint32(0x3000) & 0xffff).toBe(2);
    test.release();
  }, 60_000);
});
