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

describe.skipIf(!enginesBuilt)('the tour on the real engine (needs engine/dist)', () => {
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
  });

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
