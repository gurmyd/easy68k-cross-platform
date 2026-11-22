// The governor at work (ARCHITECTURE.md 4.2, 4.5.6): instruction accounting through stepCount, the
// cap on the allowance, 'Maximum' under virtual time, and the time budget at 60 and 120 Hz.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Clock, SimEngine } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, createRecordingHost, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { FrameScheduler, type SchedulerTimers } from './clock';
import { MAX_CATCHUP_MS, MAX_TICK_INSTRUCTIONS, SUBSLICE } from './governor';
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

/**
 * An engine whose `run()` takes time: every call moves `clock` forward by `msPerRun`, as a real
 * engine call does on a real clock. Members are reached through the engine itself, which keeps
 * private state.
 */
function timedEngine(engine: SimEngine, cost: { ms: number; spent: number; runs: number }): SimEngine {
  return new Proxy(engine, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property !== 'run') return (value as (...args: unknown[]) => unknown).bind(target);
      return (max?: number) => {
        cost.spent += cost.ms;
        cost.runs++;
        return target.run(max);
      };
    },
  });
}

describe.skipIf(!enginesBuilt)('the governor (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let spin: AssembledProgram;
  let delays: AssembledProgram;
  let kit: Kit;
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  const steps = () => kit.controller.engine.stepCount;

  beforeAll(async () => {
    spin = await assembleProgram(['        ORG     $1000', 'START:  BRA     START', '        END     START']);
    // A one-unit delay, then a spin: the step that ends the delay is finished by the next run().
    delays = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #1,D1',
      '        MOVEQ   #23,D0',
      '        TRAP    #15',
      'SPIN:   BRA     SPIN',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  it('executes the rate: a million instructions per second at the default setting', async () => {
    await start();
    await kit.open(spin);
    const before = steps();
    kit.controller.run();
    expect(steps() - before).toBe(SUBSLICE); // the first instructions at once
    kit.time.advance(1000);
    // One sub-slice at Run, then 16 ms worth at each of the 62 frames up to 992 ms.
    expect(steps() - before).toBe(SUBSLICE + 62 * 16_000);
    kit.time.advance(8); // 1008 is the next frame
    expect(steps() - before).toBe(SUBSLICE + 63 * 16_000);
  });

  it('executes a custom rate, down to single instructions per frame', async () => {
    await start({ speed: { mode: 'custom', instructionsPerSecond: 100 } });
    await kit.open(spin);
    const before = steps();
    kit.controller.run();
    expect(steps() - before).toBe(1);
    kit.time.advance(1000);
    expect(steps() - before).toBe(100); // 1 at once, then 1.6 per frame: 99.2 by 992 ms
    kit.speed = { mode: 'custom', instructionsPerSecond: 250_000 };
    kit.time.advance(1000 - 8); // frames 1008 .. 1984: 62 of them
    const fast = steps() - before - 100;
    expect(fast).toBeGreaterThanOrEqual(62 * 4000 - 1);
    expect(fast).toBeLessThanOrEqual(62 * 4000 + 1);
  });

  it('counts what the engine really executed (stepCount), not what it was asked for', async () => {
    await start();
    await kit.open(delays);
    kit.controller.run();
    expect(kit.controller.phase).toBe('waitDelay');
    expect(kit.controller.governorReading.allowance).toBe(0); // not running: nothing is kept
    const before = steps();
    kit.time.advance(10); // the delay ends; the same tick finishes the TRAP and runs on
    expect(kit.controller.phase).toBe('running');
    // run(2000) finished the suspended step and then executed 2000 new instructions.
    expect(steps() - before).toBe(SUBSLICE + 1);
    expect(kit.controller.governorReading.allowance).toBe(-1);
    kit.time.advance(6); // the frame at 16 ms: 6 ms worth, less the one that was overdrawn
    expect(steps() - before).toBe(SUBSLICE + 1 + 6000 - 1);
    expect(kit.controller.governorReading.allowance).toBe(0);
  });

  it('never lets the allowance exceed the cap, also after slices ended by the time budget', async () => {
    // Every engine call costs 1 ms of the controller's clock, so the 8 ms budget ends each slice
    // after 8 calls although the allowance would cover more.
    const cost = { ms: 1, spent: 0, runs: 0 };
    let kitTime: { now(): number; wallTime(): Date } | null = null;
    const clock: Clock = {
      now: () => (kitTime?.now() ?? 0) + cost.spent,
      wallTime: () => kitTime?.wallTime() ?? new Date(0),
    };
    await start({ clock, wrapEngine: (engine) => timedEngine(engine, cost) });
    kitTime = kit.time;
    await kit.open(spin);
    const cap = (MAX_CATCHUP_MS * 1_000_000) / 1000;
    kit.controller.run();
    let highest = 0;
    let budgetEnded = 0;
    for (let frame = 0; frame < 200; frame++) {
      const runsBefore = cost.runs;
      const stepsBefore = steps();
      kit.time.advance(16);
      const reading = kit.controller.governorReading;
      highest = Math.max(highest, reading.allowance);
      expect(reading.allowance).toBeLessThanOrEqual(cap);
      // The slice ended because of the time budget: 8 calls, and allowance was left over.
      if (cost.runs - runsBefore === 8 && reading.allowance >= 1) budgetEnded++;
      expect(steps() - stepsBefore).toBeLessThanOrEqual(8 * SUBSLICE);
    }
    expect(budgetEnded).toBeGreaterThan(150);
    // The unused allowance piled up to the cap and stayed there: cap minus one frame's execution.
    expect(highest).toBe(cap - 8 * SUBSLICE);
    // When the engine is fast again, at most MAX_CATCHUP_MS are made up, not the 200 frames.
    cost.ms = 0;
    const before = steps();
    kit.time.advance(16);
    expect(steps() - before).toBeLessThanOrEqual(cap);
  });

  it('ends every tick at Maximum although the virtual clock does not move', async () => {
    await start({ speed: { mode: 'max', instructionsPerSecond: 1 } });
    await kit.open(spin);
    const before = steps();
    kit.controller.run(); // one tick
    expect(steps() - before).toBe(MAX_TICK_INSTRUCTIONS);
    kit.time.advance(16); // one frame: one more tick
    expect(steps() - before).toBe(2 * MAX_TICK_INSTRUCTIONS);
    expect(kit.controller.phase).toBe('running');
  }, 60_000);

  it('gives the engine half of each frame at 120 Hz and 8 ms at 60 Hz', async () => {
    // A clock, timers and a frame source driven by hand; every engine call costs 0.25 ms.
    const cost = { ms: 0.25, spent: 0, runs: 0 };
    let base = 0;
    const clock: Clock = { now: () => base + cost.spent, wallTime: () => new Date(2026, 0, 1) };
    const pending: { due: number; fn: () => void; handle: number }[] = [];
    let handles = 0;
    const timers: SchedulerTimers = {
      setTimeout(callback, delayMs) {
        pending.push({ due: clock.now() + delayMs, fn: callback, handle: ++handles });
        return handles;
      },
      clearTimeout(handle) {
        const index = pending.findIndex((timer) => timer.handle === handle);
        if (index >= 0) pending.splice(index, 1);
      },
      now: () => clock.now(),
    };
    let frame: ((now: number) => void) | null = null;
    const scheduler = new FrameScheduler((callback) => (frame = callback), timers);
    /** Moves the clock to the next frame of a display with this interval and delivers the frame. */
    const nextFrame = (intervalMs: number) => {
      base += intervalMs - (cost.spent - spentAtFrame);
      spentAtFrame = cost.spent;
      for (const timer of pending.filter((t) => t.due <= clock.now())) {
        pending.splice(pending.indexOf(timer), 1);
        timer.fn();
      }
      const callback = frame;
      frame = null;
      callback?.(clock.now());
    };
    let spentAtFrame = 0;

    await start({
      clock,
      scheduler,
      speed: { mode: 'max', instructionsPerSecond: 1 },
      wrapEngine: (e) => timedEngine(e, cost),
    });
    await kit.open(spin);
    kit.controller.run();

    const engineTimePerFrame = (intervalMs: number, frames: number): number[] => {
      const used: number[] = [];
      for (let i = 0; i < frames; i++) {
        const before = cost.spent;
        nextFrame(intervalMs);
        used.push(cost.spent - before);
      }
      return used;
    };

    engineTimePerFrame(1000 / 120, 60); // let the measured frame interval settle
    const at120 = engineTimePerFrame(1000 / 120, 60);
    const budget120 = 0.5 * (1000 / 120);
    for (const used of at120) {
      expect(used).toBeGreaterThanOrEqual(budget120 - 0.01);
      expect(used).toBeLessThanOrEqual(budget120 + cost.ms + 0.01); // the call in progress is finished
    }
    expect(kit.controller.governorReading.frameBudget).toBeCloseTo(budget120, 2);

    engineTimePerFrame(1000 / 60, 60);
    const at60 = engineTimePerFrame(1000 / 60, 60);
    for (const used of at60) {
      expect(used).toBeGreaterThanOrEqual(8 - 0.01);
      expect(used).toBeLessThanOrEqual(8 + cost.ms + 0.01);
    }
    expect(kit.controller.governorReading.frameBudget).toBe(8);
  }, 60_000);

  // speed.md 4.1, errata SH8.md entry 40: a call of 2000 dear instructions (TRAP #15 drawing tasks)
  // took longer than a frame's whole budget, which the budget rule cannot stop once the call runs.
  it('bounds a sub-slice by the time the frame has left, so dear instructions do not overrun it', async () => {
    const perInstruction = 0.01; // 2000 instructions would take 20 ms
    const cost = { spent: 0, runs: 0, longest: 0 };
    let kitTime: { now(): number; wallTime(): Date } | null = null;
    const clock: Clock = {
      now: () => (kitTime?.now() ?? 0) + cost.spent,
      wallTime: () => kitTime?.wallTime() ?? new Date(0),
    };
    const dearEngine = (engine: SimEngine): SimEngine =>
      new Proxy(engine, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          if (property !== 'run') return (value as (...args: unknown[]) => unknown).bind(target);
          return (max?: number) => {
            const before = target.stepCount;
            const status = target.run(max);
            const ms = ((target.stepCount - before) >>> 0) * perInstruction;
            cost.spent += ms;
            cost.runs++;
            cost.longest = Math.max(cost.longest, ms);
            return status;
          };
        },
      });
    await start({ clock, speed: { mode: 'max', instructionsPerSecond: 1 }, wrapEngine: dearEngine });
    kitTime = kit.time;
    await kit.open(spin);
    kit.controller.run(); // the first call knows no cost yet: a whole sub-slice
    expect(cost.longest).toBeCloseTo(SUBSLICE * perInstruction, 6);
    cost.longest = 0;
    const used: number[] = [];
    for (let frame = 0; frame < 30; frame++) {
      const before = cost.spent;
      kit.time.advance(16);
      used.push(cost.spent - before);
    }
    // Every later frame gives the engine its 8 ms and not more than one instruction beyond them;
    // no call is longer than the budget.
    for (const ms of used) {
      expect(ms).toBeGreaterThanOrEqual(8 - perInstruction - 1e-6);
      expect(ms).toBeLessThanOrEqual(8 + perInstruction + 1e-6);
    }
    expect(cost.longest).toBeLessThanOrEqual(8 + 1e-6);
  }, 60_000);

  it('draws ticks between two frames from what the frame has left', async () => {
    const cost = { ms: 1, spent: 0, runs: 0 };
    let kitTime: { now(): number; wallTime(): Date } | null = null;
    const clock: Clock = {
      now: () => (kitTime?.now() ?? 0) + cost.spent,
      wallTime: () => kitTime?.wallTime() ?? new Date(0),
    };
    await start({ clock, speed: { mode: 'max', instructionsPerSecond: 1 }, wrapEngine: (e) => timedEngine(e, cost) });
    kitTime = kit.time;
    await kit.open(spin);
    kit.controller.run(); // the tick of the command: up to 8 ms
    kit.time.advance(16); // a frame: a fresh budget
    const afterFrame = cost.runs;
    expect(kit.controller.governorReading.usedThisFrame).toBeGreaterThanOrEqual(8);
    // Ticks before the next frame (posted entries) find the budget used up.
    kit.controller.post({ kind: 'ioActivated' });
    kit.time.advance(1);
    kit.controller.post({ kind: 'ioActivated' });
    kit.time.advance(1);
    expect(cost.runs).toBe(afterFrame);
    kit.time.advance(14); // the next frame
    expect(cost.runs).toBe(afterFrame + 8);
  }, 60_000);
});
