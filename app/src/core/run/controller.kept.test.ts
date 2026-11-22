// A command given while a program is being loaded (errata SH8.md entry 47; the architect's decision of
// 22 November 2026): in the original a load is one synchronous call and the message queue delivers a
// key pressed meanwhile when it returns. The controller keeps Run, Run To Cursor, Step Over, Trace
// Into, Auto Trace, Pause, Rewind, Reload and a second Execute given during a load, and the code
// that ends the load carries them out in the order given. Real engine, virtual time.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, type SimEngineFactory } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, createRecordingHost, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { INVALID_RUN_TO_CURSOR } from './controller';
import { KIT_PROGRAM_PATH, createKit, type Kit, type KitEnv, type KitOptions } from './test-kit';

const ENGINES: SimEngineFactory = { create: createSimEngine, release: releaseSimEngine };
const ENV: KitEnv = {
  engines: ENGINES,
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
/** The program Execute loads; the one running before it is at KIT_PROGRAM_PATH. */
const NEW_PATH = '/memory/work/new.S68';
const OTHER_PATH = '/memory/work/other.S68';

/** Lets pending promise chains run to their end. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe.skipIf(!enginesBuilt)(
  'commands given during a load (needs engine/dist)',
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let counter: AssembledProgram;
    let calls: AssembledProgram;
    let halting: AssembledProgram;
    let kit: Kit;
    const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
    const register = (reg: Reg) => kit.controller.engine.getRegister(reg);

    beforeAll(async () => {
      counter = await assembleProgram([
        '        ORG     $1000',
        'START:  MOVEQ   #0,D0',
        'LOOP:   ADDQ.L  #1,D0',
        '        BRA     LOOP',
        '        END     START',
      ]);
      // D1, then a subroutine (D2), then D3, then D4 counts for ever.
      calls = await assembleProgram([
        '        ORG     $1000',
        'START:  MOVEQ   #1,D1',
        '        BSR     SUB',
        '        MOVEQ   #3,D3',
        'AGAIN:  ADDQ.L  #1,D4',
        '        BRA     AGAIN',
        'SUB:    MOVEQ   #2,D2',
        '        ADDQ.L  #1,D2',
        '        RTS',
        '        END     START',
      ]);
      halting = await assembleProgram([
        '        ORG     $1000',
        'START:  MOVEQ   #7,D5',
        '        SIMHALT',
        '        END     START',
      ]);
    }, LONG);

    afterEach(() => kit?.dispose());

    /**
     * The finding: `counter` runs; Execute of `calls` (the Caution question, OK); the load is kept
     * open at its step 5 until the returned `release` is called. `loading` is Execute's promise.
     */
    async function executeWhileRunning(options?: KitOptions, program: AssembledProgram = calls) {
      await start(options);
      await kit.open(counter);
      await kit.put(NEW_PATH, program);
      kit.controller.run();
      kit.time.advance(50);
      expect(kit.controller.phase).toBe('running');
      const release = kit.block('setCurrentDir');
      const loading = kit.controller.open(NEW_PATH, 'execute');
      await settle();
      expect(kit.events).toContain('caution');
      expect(kit.controller.phase).toBe('loading');
      expect(kit.controller.keepsCommands).toBe(true);
      kit.forgetEngineLog();
      return { release, loading };
    }

    /** Releases the load and lets everything that follows it happen. */
    async function finish(load: { release: () => void; loading: Promise<void> }) {
      load.release();
      await load.loading;
      await settle();
    }

    it('Run given during the load runs the new program when the load has ended', async () => {
      const load = await executeWhileRunning();
      kit.controller.run();
      kit.time.advance(500);
      expect(kit.engineCalls()).toEqual([]); // nothing reaches an engine during the load
      expect(kit.controller.keptLength).toBe(1);
      expect(kit.events.at(-1)).toBe('audio'); // a user gesture: audio is unlocked at once
      await finish(load);
      expect(kit.engineCalls().slice(0, 3)).toEqual(['load', 'cmdRun', 'run']);
      expect(kit.controller.program?.path).toBe(NEW_PATH);
      expect(kit.controller.phase).toBe('running');
      kit.time.advance(50);
      expect(register(Reg.D4)).toBeGreaterThan(0); // the new program is the one that runs
      expect(kit.controller.keptLength).toBe(0);
    });

    it('Step Over given during the load steps the new program', async () => {
      const load = await executeWhileRunning();
      kit.controller.stepOver();
      await finish(load);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['load', 'cmdStepOver']);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D1)).toBe(1);
      expect(register(Reg.D2)).toBe(0);
    });

    it('Trace Into given during the load traces one instruction of the new program', async () => {
      const load = await executeWhileRunning();
      kit.controller.traceInto();
      await finish(load);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['load', 'cmdTraceInto']);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D1)).toBe(1);
      expect(kit.controller.snapshot.highlight).toBe(kit.row('BSR     SUB'));
    });

    it('Auto Trace given during the load starts Auto Trace on the new program', async () => {
      const load = await executeWhileRunning();
      kit.controller.autoTrace();
      await finish(load);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['load', 'cmdAutoTrace']);
      expect(kit.bridge.state.autoTrace).toBe(true);
      kit.time.advance(500);
      expect(register(Reg.D1)).toBe(1); // the ticks trace the new program
    });

    it('Run To Cursor given during the load reads the row selected when the load has ended', async () => {
      // The row is read in the new listing, not taken from the moment of the key (row 4 of the old).
      const row = (): number => kit.row('MOVEQ   #3,D3');
      const load = await executeWhileRunning({ cursorRow: row });
      kit.controller.runToCursor(4);
      await finish(load);
      expect(kit.engineCalls().slice(0, 2)).toEqual(['load', 'cmdRunToCursor']);
      kit.time.advance(100);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D2)).toBe(3); // the subroutine ran
      expect(register(Reg.D3)).toBe(0); // the row itself has not executed
      expect(kit.controller.snapshot.highlight).toBe(row());
    });

    it('Run To Cursor kept during an Execute finds no row selected: the cold start selected none', async () => {
      const load = await executeWhileRunning({ cursorRow: () => -1 });
      kit.controller.runToCursor(4);
      await finish(load);
      expect(kit.controller.alerts).toEqual([{ title: 'Error', text: INVALID_RUN_TO_CURSOR }]);
      expect(kit.engineCalls()).not.toContain('cmdRunToCursor');
    });

    it('Run To Cursor without a cursorRow member uses the row it was given', async () => {
      const load = await executeWhileRunning();
      kit.controller.runToCursor(-1);
      await finish(load);
      expect(kit.controller.alerts).toEqual([{ title: 'Error', text: INVALID_RUN_TO_CURSOR }]);
    });

    it('Run, then Pause: both are carried out, in that order', async () => {
      const load = await executeWhileRunning();
      kit.controller.run();
      kit.controller.pause();
      expect(kit.controller.keptLength).toBe(2);
      await finish(load);
      const order = kit.engineCalls();
      expect(order.slice(0, 2)).toEqual(['load', 'cmdRun']);
      expect(order.indexOf('cmdPause')).toBeGreaterThan(order.indexOf('cmdRun'));
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.lastStop.after).toBe('run');
    });

    it('Pause alone and Rewind alone act on the program just loaded', async () => {
      let load = await executeWhileRunning();
      kit.controller.pause();
      await finish(load);
      expect(kit.engineCalls()).toEqual(expect.arrayContaining(['load', 'cmdPause']));
      expect(kit.controller.phase).toBe('idle');
      kit.dispose();

      load = await executeWhileRunning();
      kit.controller.rewind();
      await finish(load);
      const order = kit.engineCalls();
      expect(order.indexOf('rewind')).toBeGreaterThan(order.indexOf('load'));
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.program?.path).toBe(NEW_PATH);
    });

    it('Reload, then Run: the program is loaded again, and Run waits for the end of that load', async () => {
      const load = await executeWhileRunning();
      void kit.controller.reload();
      kit.controller.run();
      expect(kit.controller.keptLength).toBe(2);
      await finish(load);
      const order = kit.engineCalls();
      const loads = order.flatMap((name, index) => (name === 'load' ? [index] : []));
      expect(loads).toHaveLength(2);
      expect(order.indexOf('cmdRun')).toBeGreaterThan(loads[1]!);
      expect(kit.events.filter((event) => event === 'revalidate')).toHaveLength(1);
      expect(kit.controller.phase).toBe('running');
      expect(kit.controller.program?.path).toBe(NEW_PATH);
    });

    it('two run commands are carried out in order: each as if given at that moment', async () => {
      let load = await executeWhileRunning();
      kit.controller.traceInto(); // MOVEQ #1,D1
      kit.controller.traceInto(); // BSR SUB: entered
      await finish(load);
      expect(kit.engineCalls().filter((name) => name === 'cmdTraceInto')).toHaveLength(2);
      expect(kit.controller.snapshot.highlight).toBe(kit.row('SUB:'));
      kit.dispose();

      // A second Run finds the program running, the commands busy: it does nothing, as in the original.
      load = await executeWhileRunning();
      kit.controller.run();
      kit.controller.run();
      await finish(load);
      expect(kit.engineCalls().filter((name) => name === 'cmdRun')).toHaveLength(1);
      expect(kit.controller.keptLength).toBe(0);
    });

    it('a run command kept during a load that halts at once finds the commands busy afterwards', async () => {
      const load = await executeWhileRunning(undefined, halting);
      kit.controller.run();
      kit.controller.traceInto();
      await finish(load);
      expect(register(Reg.D5)).toBe(7);
      expect(kit.bridge.state.menuState).toBe(1); // halted: the Trace Into after it did nothing
      expect(kit.engineCalls()).not.toContain('cmdTraceInto');
    });

    it('a load that fails drops what was kept: the program cannot be read', async () => {
      await start();
      await kit.open(counter);
      kit.controller.run();
      kit.time.advance(50);
      const release = kit.block('setCurrentDir');
      const loading = kit.controller.open('/memory/work/missing.S68', 'execute');
      await settle();
      kit.forgetEngineLog();
      kit.controller.run();
      kit.controller.traceInto();
      release();
      await loading;
      await settle();
      expect(kit.messages()).toContain('error: cannot open file /memory/work/missing.S68');
      expect(kit.engineCalls()).toEqual(['load']);
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.keptLength).toBe(0);
    });

    it('a load that fails drops what was kept: no engine could be created', async () => {
      let created = 0;
      const failing: KitEnv = {
        ...ENV,
        engines: {
          create: async (host) => {
            if (++created === 2) throw new Error('out of memory');
            return ENGINES.create(host);
          },
          release: ENGINES.release,
        },
      };
      kit = await createKit(failing);
      await kit.open(counter);
      await kit.put(NEW_PATH, calls);
      kit.controller.run();
      kit.time.advance(50);
      const release = kit.block('create');
      const loading = kit.controller.open(NEW_PATH, 'execute');
      await settle();
      expect(kit.controller.phase).toBe('loading');
      kit.controller.run();
      expect(kit.controller.keptLength).toBe(1);
      release();
      await loading;
      await settle();
      expect(kit.events.some((event) => event.startsWith('report:The simulator engine could not be created'))).toBe(
        true,
      );
      expect(kit.controller.keptLength).toBe(0);
      expect(kit.controller.phase).toBe('idle'); // the stand-in: nothing ran
      expect(kit.controller.engine.stepCount).toBe(0);
    });

    it('a second Execute during the load replaces the program; what was kept for the first is dropped', async () => {
      const load = await executeWhileRunning();
      await kit.put(OTHER_PATH, halting);
      const created = kit.created;
      kit.controller.run(); // given to the first program
      const second = kit.controller.open(OTHER_PATH, 'execute');
      kit.controller.traceInto(); // given after the second Execute: for the second program
      expect(kit.controller.keptLength).toBe(2);
      await finish(load);
      await second;
      await settle();
      expect(kit.created).toBe(created + 1); // the second Execute was a cold start of its own
      expect(kit.controller.program?.path).toBe(OTHER_PATH);
      const order = kit.engineCalls();
      expect(order.filter((name) => name === 'load')).toHaveLength(2);
      expect(order).not.toContain('cmdRun'); // the first program's Run went with the first program
      expect(order.indexOf('cmdTraceInto')).toBeGreaterThan(order.lastIndexOf('load'));
      expect(register(Reg.D5)).toBe(7); // the trace executed the second program's first instruction
      expect(kit.events.filter((event) => event === 'caution')).toHaveLength(1); // no question for the second
    });

    it('a second Execute stays kept when the first load fails', async () => {
      await start();
      await kit.open(counter);
      await kit.put(OTHER_PATH, calls);
      kit.controller.run();
      kit.time.advance(50);
      const release = kit.block('setCurrentDir');
      const first = kit.controller.open('/memory/work/missing.S68', 'execute');
      await settle();
      const second = kit.controller.open(OTHER_PATH, 'execute');
      kit.controller.run();
      release();
      await first;
      await second;
      await settle();
      expect(kit.controller.program?.path).toBe(OTHER_PATH);
      expect(kit.controller.phase).toBe('running');
    });

    it('a command given after OK, before the controller hears the answer, is kept for the load', async () => {
      await start();
      await kit.open(counter);
      await kit.put(NEW_PATH, calls);
      kit.controller.run();
      kit.time.advance(50);
      const answer = kit.block('caution');
      const loading = kit.controller.open(NEW_PATH, 'execute');
      await settle();
      expect(kit.controller.phase).toBe('running'); // held while the question is open
      answer(); // OK: the answer is on its way, the phase is not 'loading' yet
      expect(kit.controller.keepsCommands).toBe(true);
      kit.controller.run();
      expect(kit.controller.keptLength).toBe(1);
      await loading;
      await settle();
      expect(kit.controller.program?.path).toBe(NEW_PATH);
      expect(kit.controller.phase).toBe('running');
      kit.time.advance(50);
      expect(register(Reg.D4)).toBeGreaterThan(0);
    });

    it('on Cancel what was given after the answer is carried out at once, on the program that stays', async () => {
      await start({ caution: () => false });
      await kit.open(halting);
      await kit.put(NEW_PATH, calls);
      const answer = kit.block('caution');
      // A drop with a program loaded asks; the program is idle, so a Run given after Cancel runs it.
      const loading = kit.controller.open(NEW_PATH, 'drop');
      await settle();
      answer();
      kit.controller.run();
      expect(kit.controller.keptLength).toBe(1);
      await loading;
      await settle();
      expect(kit.controller.program?.path).toBe(KIT_PROGRAM_PATH);
      expect(register(Reg.D5)).toBe(7); // the old program ran to its halt
      expect(kit.controller.keptLength).toBe(0);
    });

    it('a command given while no load is under way acts at once, as before', async () => {
      await start();
      await kit.open(calls);
      expect(kit.controller.keepsCommands).toBe(false);
      kit.forgetEngineLog();
      kit.controller.traceInto();
      expect(kit.engineCalls()).toContain('cmdTraceInto');
      expect(kit.controller.keptLength).toBe(0);
      kit.controller.pause();
      kit.controller.rewind();
      expect(kit.engineCalls()).toEqual(expect.arrayContaining(['cmdPause', 'rewind']));
      expect(kit.controller.keptLength).toBe(0);
    });

    it('dispose drops what was kept and settles a kept Execute', async () => {
      const load = await executeWhileRunning();
      await kit.put(OTHER_PATH, halting);
      kit.controller.run();
      const second = kit.controller.open(OTHER_PATH, 'execute');
      kit.dispose();
      expect(kit.controller.keptLength).toBe(0);
      await second; // resolved, not left pending
      load.release();
      await load.loading;
    });
  },
);
