// TRAP #15 task 23 in real time (ARCHITECTURE.md 4.4.2): one unit is 10 ms, whatever the frame rate.
//
// The programs read the clock themselves with task 8 (hundredths of a second since midnight)
// before and after the delay, so the tests check what a program observes.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, createRecordingHost, type AssembledProgram } from '../../engine/testing';
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

describe.skipIf(!enginesBuilt)('task 23 delays (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let oneDelay: AssembledProgram;
  let hundredDelays: AssembledProgram;
  let kit: Kit;
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  /** Hundredths of a second between the program's two readings of the clock (D6 - D7). */
  const measured = () => kit.controller.engine.getRegister(Reg.D6) - kit.controller.engine.getRegister(Reg.D7);
  const halted = () => kit.controller.phase === 'idle' && kit.controller.snapshot.halted;

  beforeAll(async () => {
    // Time, a delay of 100 units, time, halt. D5 counts so that a test can see "after the delay".
    oneDelay = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #8,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D7',
      '        MOVEQ   #100,D1',
      '        MOVEQ   #23,D0',
      '        TRAP    #15',
      '        MOVEQ   #1,D5',
      '        MOVEQ   #8,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        SIMHALT',
      '        END     START',
    ]);
    hundredDelays = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #8,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D7',
      '        MOVEQ   #99,D4',
      'LOOP:   MOVEQ   #1,D1',
      '        MOVEQ   #23,D0',
      '        TRAP    #15',
      '        DBRA    D4,LOOP',
      '        MOVEQ   #8,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        SIMHALT',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  for (const step of [1, 7, 16, 1000]) {
    it(`a delay of 100 units takes exactly 1000 ms when time advances in steps of ${step} ms`, async () => {
      await start();
      await kit.open(oneDelay);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitDelay');
      let advanced = 0;
      // Up to the last step before 1000 ms the program is still inside the TRAP.
      while (advanced + step < 1000) {
        kit.time.advance(step);
        advanced += step;
        expect(kit.controller.phase).toBe('waitDelay');
        expect(kit.controller.engine.getRegister(Reg.D5)).toBe(0);
      }
      kit.time.advance(step);
      // The delay ended at 1000 ms and the program went on in that same tick, without a frame.
      expect(halted()).toBe(true);
      expect(measured()).toBe(100);
    });
  }

  it('one hundred consecutive one-unit delays take 1000 ms', async () => {
    for (const step of [1, 7, 16, 1000]) {
      await start();
      await kit.open(hundredDelays);
      kit.controller.run();
      for (let t = 0; t < 1000; t += step) kit.time.advance(Math.min(step, 1000 - t));
      expect(halted(), `step ${step}`).toBe(true);
      expect(measured(), `step ${step}`).toBe(100);
      kit.dispose();
    }
  });

  it('does not call run() during a delay, and reports whole periods only once', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.forgetEngineLog();
    kit.time.advance(995);
    const calls = kit.engineCalls();
    expect(calls).not.toContain('run');
    expect(new Set(calls)).toEqual(new Set(['delayElapsed']));
    expect(kit.controller.engine.delayRemaining).toBe(1);
    kit.time.advance(5);
    expect(kit.engineCalls().filter((name) => name === 'run').length).toBeGreaterThan(0);
  });

  it('a delay interrupted by a held dialog is extended by the time held', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.time.advance(300);
    const release = kit.controller.hold(); // a modal dialog opens
    expect(kit.controller.held).toBe(true);
    const remaining = kit.controller.engine.delayRemaining;
    kit.time.advance(500);
    expect(kit.controller.engine.delayRemaining).toBe(remaining); // the delay stands still
    expect(kit.controller.phase).toBe('waitDelay');
    release(); // at 800 ms
    kit.time.advance(699);
    expect(kit.controller.phase).toBe('waitDelay');
    kit.time.advance(1); // 1500 ms = 1000 + 500 held
    expect(halted()).toBe(true);
    expect(measured()).toBe(150);
  });

  it('counts two holds that overlap as one stretch', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.time.advance(100);
    const first = kit.controller.hold();
    kit.time.advance(100);
    const second = kit.controller.hold();
    kit.time.advance(100);
    first();
    first(); // releasing twice does nothing
    expect(kit.controller.held).toBe(true);
    kit.time.advance(100);
    second(); // held from 100 to 400
    kit.time.advance(900);
    expect(halted()).toBe(true);
    expect(measured()).toBe(130);
  });

  it('Pause ends the delay at once; the program later continues after the TRAP', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.time.advance(300);
    kit.controller.pause();
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.engine.state().phase).toBe(0); // the suspended step was finished
    expect(kit.controller.engine.delayRemaining).toBe(0);
    kit.forgetEngineLog();
    kit.time.advance(2000);
    expect(kit.engineCalls()).toEqual([]); // no delay timer is left behind
    expect(kit.controller.engine.getRegister(Reg.D5)).toBe(0);
    kit.controller.run();
    kit.time.advance(16);
    expect(halted()).toBe(true);
    expect(measured()).toBe(230); // the second reading is taken when the user continued
  });

  it('Rewind ends the delay at once', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.time.advance(300);
    kit.controller.rewind();
    expect(kit.controller.phase).toBe('idle');
    kit.forgetEngineLog();
    kit.time.advance(2000);
    expect(kit.engineCalls()).toEqual([]);
    expect(kit.controller.engine.getRegister(Reg.PC)).toBe(0x1000);
  });

  it('keys typed during a delay become the type-ahead and do not shorten it', async () => {
    await start();
    await kit.open(oneDelay);
    kit.controller.run();
    kit.time.advance(100);
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: 0x41, ch: 0x41 });
    kit.controller.post({ kind: 'keyUp', vk: 0x41 });
    kit.time.advance(1);
    // Both edges at once: the program is not executing.
    expect(kit.engineCalls().filter((name) => name !== 'delayElapsed')).toEqual(['keyDown', 'keyChar', 'keyUp']);
    expect(kit.controller.engine.state().pendingKey).toBe(0x41);
    kit.time.advance(898);
    expect(kit.controller.phase).toBe('waitDelay');
    kit.time.advance(1);
    expect(halted()).toBe(true);
    expect(measured()).toBe(100);
  });

  it('Trace Into skips the delay entirely', async () => {
    await start();
    await kit.open(oneDelay);
    for (let i = 0; i < 7; i++) kit.controller.traceInto(); // up to and including MOVEQ #1,D5
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.engine.getRegister(Reg.D5)).toBe(1);
    expect(kit.time.now()).toBe(0);
  });
});
