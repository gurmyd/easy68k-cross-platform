// Engine failure and recovery (ARCHITECTURE.md 4.8): an engine call that throws - a WebAssembly
// trap or an abort - shows the original's box for internal faults and restarts the simulator from
// start-up state. Tested with the fault injector of app/src/engine/testing.ts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Box, Reg, RunStatus, type SimEngine } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import {
  assembleProgram,
  createRecordingHost,
  withFaults,
  type AssembledProgram,
  type Fault,
} from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { RESTART_NOTICE } from './controller';
import { KIT_PROGRAM_PATH, createKit, type Kit, type KitEnv } from './test-kit';

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
/** Lets pending promise chains run to their end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const TRAP = new WebAssembly.RuntimeError('unreachable');

describe.skipIf(!enginesBuilt)('engine failure (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let counter: AssembledProgram;
  let halting: AssembledProgram;
  let kit: Kit;
  /** A kit whose first engine fails as planned; the engines after it are sound. */
  const startWithFaults = async (plan: Fault | Fault[], secondPlan?: Fault | Fault[]) => {
    const wrapEngine = (engine: SimEngine, ordinal: number) =>
      ordinal === 1 ? withFaults(engine, plan) : ordinal === 2 && secondPlan ? withFaults(engine, secondPlan) : engine;
    kit = await createKit(ENV, { wrapEngine });
  };
  const reports = () => kit.events.filter((event) => event.startsWith('report:'));

  beforeAll(async () => {
    counter = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #0,D0',
      'LOOP:   ADDQ.L  #1,D0',
      '        BRA     LOOP',
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

  it('a trap in the middle of a run: the box, a cold start, the notice, and a working simulator', async () => {
    await startWithFaults({ at: 'run', call: 3, throws: TRAP });
    await kit.open(counter);
    kit.controller.traceInto(); // PC = 00001002, the instruction word there is 5280 (ADDQ.L #1,D0)
    kit.controller.pause();
    const failed = kit.controller.engine;
    kit.events.length = 0;
    kit.controller.run(); // the 1st run() call
    expect(kit.controller.phase).toBe('running');
    kit.time.advance(16); // a frame: the 2nd call, and the 3rd, which throws

    // The original's box for its own internal faults, with the PC and opcode of the last snapshot.
    expect(kit.controller.alerts).toEqual([
      { title: 'Error', text: "ERROR: An exception occurred in routine 'exec_inst'.\nPC=00001002  Code=5280" },
    ]);
    expect(kit.controller.phase).toBe('loading'); // nothing touches the engine while it restarts
    await settle();

    // Nothing is kept: the failed engine was released, every part reset, a new engine created.
    expect(kit.events.filter((event) => !event.startsWith('report:'))).toEqual([
      'audio',
      'exit',
      'engine.release',
      'reset',
      'engine.create',
      'apply',
      'listing.refresh',
    ]);
    expect(reports()).toEqual(['report:The simulator engine failed: unreachable']);
    expect(kit.created).toBe(2);
    expect(() => failed.state()).toThrow(/released/);
    expect(kit.controller.engine).not.toBe(failed);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.program).toBeNull();
    expect(kit.messages()).toEqual([RESTART_NOTICE]);
    expect(RESTART_NOTICE).toBe('The simulator was restarted after an internal error. Load the program again.');
    expect(kit.controller.snapshot.boxes[Box.PC]).toBe('00000000');
    expect(kit.listingRows).toEqual([]);

    // The box is still open and holds nothing back for ever: OK closes it without an engine call.
    kit.forgetEngineLog();
    kit.controller.dismissAlerts();
    expect(kit.controller.alerts).toEqual([]);
    expect(kit.engineCalls()).toEqual([]);

    // Load the program again, as the notice says.
    await kit.open(halting);
    kit.controller.run();
    kit.time.advance(16);
    expect(kit.controller.snapshot.halted).toBe(true);
    expect(kit.controller.engine.getRegister(Reg.D5)).toBe(7);
  });

  it('tells its subscribers and the engine-replaced listeners', async () => {
    await startWithFaults({ at: 'cmdTraceInto', throws: TRAP });
    await kit.open(counter);
    const phases: string[] = [];
    let replaced = 0;
    kit.controller.subscribe(() => phases.push(kit.controller.phase));
    kit.controller.onEngineReplaced(() => replaced++);
    kit.controller.traceInto();
    await settle();
    expect(phases[0]).toBe('loading');
    expect(phases.at(-1)).toBe('idle');
    expect(replaced).toBe(1);
  });

  for (const [what, fault, act] of [
    ['a command', { at: 'cmdRun', throws: TRAP }, (k: Kit) => k.controller.run()],
    ['Pause', { at: 'cmdPause', throws: TRAP }, (k: Kit) => k.controller.pause()],
    [
      'a queue entry',
      { at: 'keyDown', throws: TRAP },
      (k: Kit) => (k.controller.post({ kind: 'keyDown', vk: 65 }), k.time.advance(0)),
    ],
    [
      'an invoke',
      { at: 'setBreakpoint', throws: TRAP },
      (k: Kit) => k.controller.invoke((e) => void e.setBreakpoint(0x1000)),
    ],
    ['a register edit', { at: 'editBox', throws: TRAP }, (k: Kit) => k.controller.editBox(Box.D0, '00000001')],
    // The first read of the display after the load (the load itself refreshed it 20 boxes ago).
    ['reading the display', { at: 'boxText', call: 41, throws: TRAP }, (k: Kit) => k.controller.traceInto()],
    ['a getter', { at: 'stepCount', throws: TRAP }, (k: Kit) => k.controller.run()],
  ] as [string, Fault, (k: Kit) => void][]) {
    it(`recovers when ${what} fails`, async () => {
      await startWithFaults(fault);
      await kit.open(counter);
      act(kit);
      expect(kit.controller.alerts).toHaveLength(1);
      expect(kit.controller.alerts[0]?.text).toContain("ERROR: An exception occurred in routine 'exec_inst'.");
      await settle();
      expect(kit.controller.phase).toBe('idle');
      expect(kit.created).toBe(2);
      expect(kit.messages()).toEqual([RESTART_NOTICE]);
      // Later ticks find a sound simulator.
      kit.time.advance(100);
      expect(reports()).toHaveLength(1);
    });
  }

  it('recovers when the load itself fails, and does not stay in loading', async () => {
    await startWithFaults({ at: 'load', throws: TRAP });
    await kit.open(counter);
    await settle();
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.program).toBeNull();
    expect(kit.messages()).toEqual([RESTART_NOTICE]);
    await kit.controller.open(KIT_PROGRAM_PATH, 'open');
    expect(kit.controller.program?.path).toBe(KIT_PROGRAM_PATH);
  });

  it('the status Error is not a failure: the engine has reported it and the simulator stops', async () => {
    await startWithFaults({ at: 'run', call: 2, returns: RunStatus.Error });
    await kit.open(counter);
    kit.controller.run();
    kit.time.advance(16);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.alerts).toEqual([]);
    expect(kit.created).toBe(1);
    expect(kit.events).toContain('stopped');
  });

  it('a second failure while the simulator restarts leaves the stand-in, without a loop', async () => {
    // The first engine traps in run(); the second one traps as soon as the settings are applied.
    const wrapEngine = (engine: SimEngine, ordinal: number) =>
      ordinal === 1 ? withFaults(engine, { at: 'run', throws: TRAP }) : engine;
    let applied = 0;
    kit = await createKit(ENV, {
      wrapEngine,
      applySettings: () => {
        if (++applied === 2) throw TRAP;
      },
    });
    await kit.open(counter);
    kit.controller.run();
    await settle();
    expect(kit.controller.phase).toBe('idle');
    expect(kit.created).toBe(2);
    expect(kit.released).toBe(2);
    expect(kit.messages()).toEqual(['The simulator engine failed again while it was restarted.']);
    // Nothing runs on the stand-in, and nothing throws.
    kit.controller.dismissAlerts();
    kit.controller.run();
    kit.controller.traceInto();
    kit.time.advance(100);
    expect(kit.controller.phase).toBe('idle');
    // A cold start later gets a sound engine.
    await kit.open(halting, 'execute');
    expect(kit.created).toBe(3);
    kit.controller.run();
    kit.time.advance(16);
    expect(kit.controller.engine.getRegister(Reg.D5)).toBe(7);
  });

  it('a failure in the very first start is recovered too', async () => {
    let applied = 0;
    kit = await createKit(ENV, {
      applySettings: () => {
        if (++applied === 1) throw TRAP;
      },
    });
    await settle();
    expect(kit.controller.phase).toBe('idle');
    expect(kit.created).toBe(2);
    expect(kit.controller.alerts).toHaveLength(1);
    expect(kit.messages()).toEqual([RESTART_NOTICE]);
  });
});
