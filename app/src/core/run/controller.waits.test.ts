// The wait states (ARCHITECTURE.md 4.4): keyboard input, the task 58 dialog, message boxes of the
// engine, `Busy`, and holds. Task 23 has its own file (controller.delay.test.ts).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, SimOption } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, bytesOf, createRecordingHost, textOf, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { createKit, type Kit, type KitEnv, type KitOptions } from './test-kit';

const ENV: KitEnv = {
  engines: { create: createSimEngine, release: releaseSimEngine },
  recordingHost: createRecordingHost,
  vfs: () => {
    const vfs = createVfs();
    vfs.mount(new MemoryBackend());
    return vfs;
  },
};

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const LONG = 120_000;
/** Every test here runs the real engine; on a busy machine one can take seconds. */
const ENGINE_TEST_TIMEOUT = 60_000;
const LOG_TIME = '11/20/2026 1:07:46 PM';

describe.skipIf(!enginesBuilt)('wait states (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let readChar: AssembledProgram;
  let fileDialog: AssembledProgram;
  let halting: AssembledProgram;
  let inputWithIrq: AssembledProgram;
  let kit: Kit;
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  const register = (reg: Reg) => kit.controller.engine.getRegister(reg);
  const hostCalls = (method: string) => kit.calls.filter((call) => call.method === method);
  /** Log Start, as the log service does it. */
  const startLog = () =>
    kit.controller.invoke((engine) => {
      engine.setOption(SimOption.ExecLogType, 1);
      engine.startLog(LOG_TIME);
    });

  beforeAll(async () => {
    // Reads one character (task 5) into D6, then counts in D5.
    readChar = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #5,D0',
      '        TRAP    #15',
      '        MOVE.B  D1,D6',
      'LOOP:   ADDQ.L  #1,D5',
      '        BRA     LOOP',
      '        END     START',
    ]);
    // The file dialog of task 58 (Open), result D1 into D6; then halt.
    fileDialog = await assembleProgram([
      '        ORG     $1000',
      'START:  SUBA.L  A1,A1',
      '        SUBA.L  A2,A2',
      '        LEA     BUFFER,A3',
      '        MOVEQ   #0,D1',
      '        MOVEQ   #58,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        MOVEQ   #1,D5',
      '        SIMHALT',
      '        ORG     $2000',
      'BUFFER: DS.B    256',
      '        END     START',
    ]);
    halting = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #7,D5',
      '        SIMHALT',
      '        MOVEQ   #8,D5',
      '        END     START',
    ]);
    // A level 3 interrupt handler, and a keyboard read in the main program.
    inputWithIrq = await assembleProgram([
      '        ORG     $6C',
      '        DC.L    LEVEL3',
      '        ORG     $1000',
      'START:  MOVEQ   #5,D0',
      '        TRAP    #15',
      '        MOVE.B  D1,D6',
      '        MOVE.L  D4,D7',
      '        SIMHALT',
      'LEVEL3: ADDQ.L  #1,D4',
      '        RTE',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  describe('WaitInput (4.4.1)', () => {
    it('does not call run() while it waits; a character and one run() continue the program', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitInput');
      expect(kit.bridge.state.menuState).toBe(1);
      kit.forgetEngineLog();
      kit.time.advance(500);
      expect(kit.engineCalls()).toEqual([]);
      kit.controller.post({ kind: 'char', ch: 0x58 });
      kit.time.advance(0);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['keyChar', 'run']);
      expect(kit.controller.phase).toBe('running');
      expect(register(Reg.D6)).toBe(0x58);
    });

    it('Pause cancels the read; the program later continues without its input', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.run();
      kit.controller.pause();
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.engine.state().inputMode).toBe(false);
      expect(hostCalls('erasePrompt').length).toBeGreaterThan(0);
      kit.controller.run();
      kit.time.advance(16);
      expect(kit.controller.phase).toBe('running');
      expect(register(Reg.D5)).toBeGreaterThan(0);
    });

    it('latches an interrupt request during the input and serves it afterwards', async () => {
      await start({ applySettings: (engine) => engine.setOption(SimOption.Exceptions, true) });
      await kit.open(inputWithIrq);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitInput');
      kit.controller.post({ kind: 'irq', level: 3 });
      kit.time.advance(100);
      expect(kit.controller.phase).toBe('waitInput'); // only latched
      expect(register(Reg.D4)).toBe(0);
      kit.controller.post({ kind: 'char', ch: 0x41 });
      kit.time.advance(16);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D6)).toBe(0x41);
      expect(register(Reg.D4)).toBe(1);
    });

    it('after Trace Into the engine does not wait: the keys typed later complete the read', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.traceInto(); // MOVEQ
      kit.controller.traceInto(); // TRAP #15, task 5
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.engine.state().inputMode).toBe(true);
      expect(kit.bridge.state.menuState).toBe(0); // the commands are enabled again (sim-ui §9.13)
      kit.forgetEngineLog();
      kit.controller.post({ kind: 'char', ch: 0x5a });
      kit.time.advance(0);
      expect(kit.engineCalls()).toEqual(['keyChar']); // no run(): nothing is running
      expect(kit.controller.engine.state().inputMode).toBe(false);
      expect(register(Reg.D1) & 0xff).toBe(0x5a);
    });

    it('is not continued while a dialog holds the controller; the release runs it once', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.run();
      const release = kit.controller.hold();
      kit.forgetEngineLog();
      kit.controller.post({ kind: 'char', ch: 0x51 });
      kit.time.advance(200);
      expect(kit.engineCalls()).toEqual(['keyChar']); // delivered, but run() is not called
      expect(kit.controller.phase).toBe('waitInput');
      release();
      expect(kit.engineCalls()).toEqual(['keyChar', 'run']);
      expect(kit.controller.phase).toBe('running');
      expect(register(Reg.D6)).toBe(0x51);
    });
  });

  describe('WaitHost (4.4.3)', () => {
    it('after Run: the reply answers the engine and the program continues', async () => {
      await start();
      await kit.open(fileDialog);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitHost');
      expect(hostCalls('fileDialog')).toHaveLength(1);
      kit.forgetEngineLog();
      kit.time.advance(500);
      expect(kit.engineCalls()).toEqual([]); // nothing runs while the dialog is open
      kit.controller.post({ kind: 'fileDialogReply', accepted: true, path: bytesOf('/memory/work/data.txt') });
      kit.time.advance(0);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['fileDialogReply', 'run']);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D6)).toBe(1);
      expect(register(Reg.D5)).toBe(1);
      expect(textOf(kit.controller.engine.memory.subarray(0x2000, 0x2015))).toBe('/memory/work/data.txt');
    });

    it('after Run: Cancel gives the program D1 = 0', async () => {
      await start();
      await kit.open(fileDialog);
      kit.controller.run();
      kit.controller.post({ kind: 'fileDialogReply', accepted: false, path: null });
      kit.time.advance(0);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D6)).toBe(0);
      expect(register(Reg.D5)).toBe(1);
      expect(kit.controller.engine.readByte(0x2000)).toBe(0xff); // the buffer is untouched (memory is $FF)
    });

    it('after Trace Into: the reply finishes the step and the simulator is stopped', async () => {
      await start();
      await kit.open(fileDialog);
      for (let i = 0; i < 5; i++) kit.controller.traceInto(); // up to MOVEQ #58,D0
      expect(kit.controller.phase).toBe('idle');
      kit.controller.traceInto(); // the TRAP
      expect(kit.controller.phase).toBe('waitHost');
      expect(kit.bridge.state.menuState).toBe(1);
      const revision = kit.controller.snapshot.revision;
      kit.controller.post({ kind: 'fileDialogReply', accepted: true, path: bytesOf('/memory/x.txt') });
      kit.time.advance(0);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D1)).toBe(1);
      expect(register(Reg.D6)).toBe(0); // the next instruction has not executed
      expect(kit.controller.snapshot.revision).toBeGreaterThan(revision);
      expect(kit.bridge.state.menuState).toBe(0);
    });

    it('Busy changes nothing: auto-trace ticks while the dialog is open', async () => {
      await start();
      await kit.open(fileDialog);
      kit.controller.autoTrace();
      kit.time.advance(1500); // six ticks reach the TRAP
      expect(kit.controller.phase).toBe('waitHost');
      expect(hostCalls('fileDialog')).toHaveLength(1);
      kit.forgetEngineLog();
      kit.time.advance(1000);
      const ticks = kit.engineCalls();
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(new Set(ticks)).toEqual(new Set(['autoTraceTick'])); // each refused with Busy
      expect(kit.controller.phase).toBe('waitHost');
      expect(hostCalls('fileDialog')).toHaveLength(1);
      expect(register(Reg.D5)).toBe(0);
      kit.controller.post({ kind: 'fileDialogReply', accepted: false, path: null });
      kit.time.advance(0);
      expect(kit.controller.phase).toBe('idle');
      kit.time.advance(1000); // tracing goes on
      expect(register(Reg.D5)).toBe(1);
    });

    it('Pause while the dialog is open leaves the step suspended until the reply', async () => {
      await start();
      await kit.open(fileDialog);
      kit.controller.run();
      kit.controller.pause();
      expect(kit.controller.phase).toBe('waitHost');
      expect(kit.controller.engine.state().fileDialogOpen).toBe(true);
      kit.controller.post({ kind: 'fileDialogReply', accepted: false, path: null });
      kit.time.advance(0);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D5)).toBe(0); // paused: the step finished, nothing more ran
      expect(kit.controller.engine.state().fileDialogOpen).toBe(false);
    });
  });

  describe('WaitAlert (4.4.4)', () => {
    it('SIMHALT while logging: the box is shown, nothing runs, OK finishes the step', async () => {
      await start();
      await kit.open(halting);
      startLog();
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitAlert');
      expect(kit.controller.alerts).toEqual([{ title: 'Information', text: 'Current Log Stopped.' }]);
      kit.forgetEngineLog();
      kit.time.advance(500);
      expect(kit.engineCalls()).toEqual([]);
      expect(kit.controller.snapshot.halted).toBe(false); // the display is refreshed after the box
      kit.controller.dismissAlerts();
      expect(kit.engineCalls().slice(0, 2)).toEqual(['dismissAlert', 'run']);
      expect(kit.controller.alerts).toEqual([]);
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.snapshot.halted).toBe(true);
      expect(register(Reg.D5)).toBe(7);
    });

    it('after Trace Into the box suspends the step in the same way', async () => {
      await start();
      await kit.open(halting);
      startLog();
      kit.controller.traceInto();
      kit.controller.traceInto(); // SIMHALT
      expect(kit.controller.phase).toBe('waitAlert');
      expect(kit.controller.alerts).toHaveLength(1);
      kit.controller.dismissAlerts();
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.snapshot.halted).toBe(true);
    });

    it('a box raised by a load is shown and stops nothing', async () => {
      await start();
      await kit.open(halting);
      startLog();
      await kit.controller.open('/memory/work/program.S68', 'open'); // Open stops a running log
      expect(kit.controller.alerts).toEqual([{ title: 'Information', text: 'Current Log Stopped.' }]);
      expect(kit.controller.phase).toBe('idle');
      kit.forgetEngineLog();
      // While it is open, a run command is given but nothing executes.
      kit.controller.run();
      kit.time.advance(100);
      expect(kit.engineCalls().filter((name) => name === 'run')).toEqual([]);
      expect(register(Reg.D5)).toBe(0);
      kit.controller.dismissAlerts();
      kit.time.advance(16);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D5)).toBe(7);
    });

    it('a box raised by an interface call while a program runs holds the program until OK', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.post({ kind: 'char', ch: 0x41 }); // type ahead, so that the program spins
      kit.controller.run();
      kit.time.advance(32);
      expect(kit.controller.phase).toBe('running');
      // The 101st breakpoint raises "Breakpoint Limit Reached!".
      kit.controller.invoke((engine) => {
        for (let i = 0; i <= 100; i++) engine.setBreakpoint(0x4000 + 2 * i);
      });
      expect(kit.controller.alerts).toEqual([{ title: 'Error', text: 'Breakpoint Limit Reached!' }]);
      const count = register(Reg.D5);
      kit.time.advance(200);
      expect(register(Reg.D5)).toBe(count);
      expect(kit.controller.phase).toBe('running');
      kit.controller.dismissAlerts();
      kit.time.advance(32);
      expect(register(Reg.D5)).toBeGreaterThan(count);
    });

    it('dismissAlerts without a box does nothing', async () => {
      await start();
      await kit.open(halting);
      kit.forgetEngineLog();
      kit.controller.dismissAlerts();
      expect(kit.engineCalls()).toEqual([]);
    });
  });

  describe('holds (4.4.5)', () => {
    it('a held controller delivers the queue and fires timers but does not run the program', async () => {
      await start();
      await kit.open(readChar);
      kit.controller.post({ kind: 'char', ch: 0x41 });
      kit.controller.run();
      kit.time.advance(32);
      const release = kit.controller.hold();
      expect(kit.controller.held).toBe(true);
      const count = register(Reg.D5);
      kit.forgetEngineLog();
      kit.controller.post({ kind: 'keyDown', vk: 0x42 });
      kit.controller.post({ kind: 'keyUp', vk: 0x42 });
      kit.time.advance(300);
      expect(kit.engineCalls()).toEqual(['keyDown', 'keyUp']); // both at once: nothing executes
      expect(register(Reg.D5)).toBe(count);
      release();
      expect(kit.controller.held).toBe(false);
      kit.time.advance(16);
      expect(register(Reg.D5)).toBeGreaterThan(count);
    });

    it('tells its subscribers when it is held and released', async () => {
      await start();
      const seen: boolean[] = [];
      kit.controller.subscribe(() => seen.push(kit.controller.held));
      const release = kit.controller.hold();
      release();
      expect(seen).toEqual([true, false]);
    });
  });
});
