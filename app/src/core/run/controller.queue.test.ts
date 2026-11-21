// The queue (ARCHITECTURE.md 4.3): order, one input edge per sub-slice while the program executes,
// everything at once otherwise, and a key press with its character and pasted text as one unit.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, ShiftBit, SimOption, type SimEngine } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, bytesOf, createRecordingHost, textOf, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { subslice } from './governor';
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
const VK_A = 0x41;
const VK_INSERT = 0x2d;

/** The engine methods that deliver an input edge (4.3). */
const EDGE_METHODS: ReadonlySet<string> = new Set([
  'keyDown',
  'keyUp',
  'mouseDown',
  'mouseUp',
  'pushButton',
  'switchClick',
]);

/**
 * Stands in front of an engine and writes `engine.stepCount` into `steps` at every input edge that
 * reaches it, so that a test can see how many instructions executed between two edges.
 */
function recordEdgeSteps(steps: number[]): (engine: SimEngine) => SimEngine {
  return (engine) =>
    new Proxy(engine, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const method = value as (...args: unknown[]) => unknown;
        if (typeof property !== 'string' || !EDGE_METHODS.has(property)) return method.bind(target);
        return (...args: unknown[]): unknown => {
          steps.push(target.stepCount);
          return method.apply(target, args);
        };
      },
    });
}

/** The differences between consecutive entries. */
const gapsOf = (steps: readonly number[]): number[] => steps.slice(1).map((step, i) => (step - steps[i]!) >>> 0);

/** A small deterministic random source (a linear congruential generator), 0 <= value < 1. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
}

describe.skipIf(!enginesBuilt)('the queue (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let spin: AssembledProgram;
  let pollKey: AssembledProgram;
  let mouseIrq: AssembledProgram;
  let readLine: AssembledProgram;
  let readTwoChars: AssembledProgram;
  let lineAfterTask24: AssembledProgram;
  let slowPoll: AssembledProgram;
  let kit: Kit;
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  const register = (reg: Reg) => kit.controller.engine.getRegister(reg);
  const exceptionsOn: KitOptions = { applySettings: (engine) => engine.setOption(SimOption.Exceptions, true) };

  beforeAll(async () => {
    spin = await assembleProgram(['        ORG     $1000', 'START:  BRA     START', '        END     START']);
    // Waits until it sees the A key down with task 19, then until it sees it up again.
    pollKey = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #0,D5',
      'DOWN:   MOVEQ   #$41,D1',
      '        MOVEQ   #19,D0',
      '        TRAP    #15',
      '        TST.B   D1',
      '        BEQ     DOWN',
      '        MOVEQ   #1,D5',
      'UP:     MOVEQ   #$41,D1',
      '        MOVEQ   #19,D0',
      '        TRAP    #15',
      '        TST.B   D1',
      '        BNE     UP',
      '        MOVEQ   #2,D5',
      '        SIMHALT',
      '        END     START',
    ]);
    // Counts mouse-down interrupts (level 1) in D5 while spinning.
    mouseIrq = await assembleProgram([
      '        ORG     $64',
      '        DC.L    MOUSE',
      '        ORG     $1000',
      'START:  MOVE.W  #$0101,D1',
      '        MOVEQ   #60,D0',
      '        TRAP    #15',
      '        MOVE.W  #$2000,SR',
      'LOOP:   ADDQ.L  #1,D4',
      '        BRA     LOOP',
      'MOUSE:  ADDQ.L  #1,D5',
      '        RTE',
      '        END     START',
    ]);
    // Reads a line into BUFFER (task 2), length in D1.W, then halts.
    readLine = await assembleProgram([
      '        ORG     $1000',
      'START:  LEA     BUFFER,A1',
      '        MOVEQ   #2,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        SIMHALT',
      '        ORG     $2000',
      'BUFFER: DS.B    100',
      '        END     START',
    ]);
    // Reads two single characters (task 5) into D6 and D7.
    readTwoChars = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #5,D0',
      '        TRAP    #15',
      '        MOVE.B  D1,D6',
      '        MOVEQ   #5,D0',
      '        TRAP    #15',
      '        MOVE.B  D1,D7',
      '        SIMHALT',
      '        END     START',
    ]);
    // Switches the simulator's key commands off (task 24), then reads a line.
    lineAfterTask24 = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #1,D1',
      '        MOVEQ   #24,D0',
      '        TRAP    #15',
      '        LEA     BUFFER,A1',
      '        MOVEQ   #2,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        SIMHALT',
      '        ORG     $2000',
      'BUFFER: DS.B    100',
      '        END     START',
    ]);
    // Counts in D7 how often it saw the A key go down and up again (task 19), with about 250
    // instructions of other work between two looks at the key.
    slowPoll = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #0,D7',
      'DOWN:   BSR     WORK',
      '        MOVEQ   #$41,D1',
      '        MOVEQ   #19,D0',
      '        TRAP    #15',
      '        TST.B   D1',
      '        BEQ     DOWN',
      'UP:     BSR     WORK',
      '        MOVEQ   #$41,D1',
      '        MOVEQ   #19,D0',
      '        TRAP    #15',
      '        TST.B   D1',
      '        BNE     UP',
      '        ADDQ.L  #1,D7',
      '        BRA     DOWN',
      'WORK:   MOVE.W  #240,D2',
      'SPIN:   DBRA    D2,SPIN',
      '        RTS',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  it('delivers entries in the order they were posted, in the next tick', async () => {
    await start();
    await kit.open(spin);
    kit.controller.pause(); // trace mode: requests are latched and start nothing
    kit.forgetEngineLog();
    const { controller } = kit;
    controller.post({ kind: 'ioActivated' });
    controller.post({ kind: 'keyDown', vk: VK_A, ch: 0x61 });
    controller.post({ kind: 'keyUp', vk: VK_A });
    controller.post({ kind: 'char', ch: 0xe9 });
    controller.post({ kind: 'mouseMove', x: 1, y: 1, shift: 0 });
    controller.post({ kind: 'mouseDown', x: 1, y: 1, shift: ShiftBit.Left });
    controller.post({ kind: 'mouseUp', x: 1, y: 1, shift: 0 });
    controller.post({ kind: 'pushButton', bit: 1, down: true });
    controller.post({ kind: 'switchClick', bit: 2 });
    controller.post({ kind: 'irq', level: 3 });
    controller.post({ kind: 'timerTick', level: 4 });
    controller.post({ kind: 'hwReset' });
    controller.post({ kind: 'call', fn: (engine) => engine.setOption(SimOption.BitField, true) });
    expect(kit.engineCalls()).toEqual([]); // nothing before the tick
    expect(controller.queueLength).toBe(13);
    kit.time.advance(0);
    expect(kit.engineCalls()).toEqual([
      'ioActivated',
      'keyDown',
      'keyChar',
      'keyUp',
      'keyChar',
      'mouseMove',
      'mouseDown',
      'mouseUp',
      'pushButton',
      'switchClick',
      'irq',
      'timerTick',
      'hardwareReset',
      'setOption',
    ]);
    expect(controller.queueLength).toBe(0);
    expect(controller.phase).toBe('idle');
  });

  it('merges consecutive mouse moves into the last one, but not across another entry', async () => {
    await start();
    await kit.open(spin);
    kit.controller.pause();
    const seen: [number, number][] = [];
    const real = kit.controller.engine;
    kit.forgetEngineLog();
    for (let x = 1; x <= 5; x++) kit.controller.post({ kind: 'mouseMove', x, y: 10, shift: 0 });
    kit.controller.post({ kind: 'mouseDown', x: 5, y: 10, shift: ShiftBit.Left });
    kit.controller.post({ kind: 'mouseMove', x: 6, y: 10, shift: 0 });
    kit.controller.post({ kind: 'mouseMove', x: 7, y: 10, shift: 0 });
    kit.controller.post({ kind: 'call', fn: () => seen.push([0, 0]) });
    expect(kit.controller.queueLength).toBe(4);
    kit.time.advance(0);
    expect(kit.engineCalls()).toEqual(['mouseMove', 'mouseDown', 'mouseMove']);
    expect(real).toBe(kit.controller.engine);
    expect(seen).toHaveLength(1);
  });

  it('a keyDown and keyUp posted together are both seen by a program that polls task 19', async () => {
    await start();
    await kit.open(pollKey);
    kit.controller.run();
    kit.time.advance(100);
    expect(register(Reg.D5)).toBe(0);
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: VK_A, ch: 0x61 });
    kit.controller.post({ kind: 'keyUp', vk: VK_A });
    kit.time.advance(32);
    expect(kit.controller.phase).toBe('idle');
    expect(register(Reg.D5)).toBe(2); // it saw the key down, and then up
    // Between the two edges the program executed.
    const calls = kit.engineCalls();
    const down = calls.indexOf('keyDown');
    const up = calls.indexOf('keyUp');
    expect(calls.slice(down + 1, up).filter((name) => name === 'run').length).toBeGreaterThanOrEqual(1);
  });

  it('delivers one input edge per sub-slice, in order, however many are waiting', async () => {
    await start();
    await kit.open(spin);
    kit.controller.run();
    kit.time.advance(100);
    kit.forgetEngineLog();
    for (let i = 0; i < 4; i++) {
      kit.controller.post({ kind: 'keyDown', vk: VK_A + i });
      kit.controller.post({ kind: 'keyUp', vk: VK_A + i });
    }
    kit.controller.post({ kind: 'irq', level: 1 }); // not an edge: it goes with the edge before it
    kit.time.advance(16);
    const calls = kit.engineCalls();
    const edges = calls.filter((name) => name !== 'run');
    expect(edges).toEqual(['keyDown', 'keyUp', 'keyDown', 'keyUp', 'keyDown', 'keyUp', 'keyDown', 'keyUp', 'irq']);
    // No two edges without a run() between them.
    for (let i = 1; i < calls.length; i++) {
      const pair = [calls[i - 1], calls[i]];
      expect(
        pair.every((name) => name === 'keyDown' || name === 'keyUp'),
        `calls ${i - 1}, ${i}: ${pair}`,
      ).toBe(false);
    }
    expect(calls.at(-1) === 'irq' || calls.at(-2) === 'irq').toBe(true);
  });

  it('edges that wait behind one another follow exactly one sub-slice of instructions apart', async () => {
    // 4.3: "the next one follows subslice(ips) instructions later". The cases differ in how the
    // sub-slices fall: at the default speed the allowance of a tick rarely ends on a sub-slice
    // boundary, at 10,000 instructions per second a sub-slice is 20 instructions, at 100 it is one.
    for (const [ips, frames] of [
      [1_000_000, 4],
      [10_000, 8],
      [100, 8],
    ] as const) {
      const steps: number[] = [];
      await start({
        speed:
          ips === 1_000_000
            ? { mode: 'original', instructionsPerSecond: ips }
            : { mode: 'custom', instructionsPerSecond: ips },
        wrapEngine: recordEdgeSteps(steps),
      });
      await kit.open(spin);
      kit.controller.run();
      kit.time.advance(100.37); // off the frame grid: the allowance has a remainder
      kit.controller.post({ kind: 'keyDown', vk: VK_A });
      kit.controller.post({ kind: 'keyUp', vk: VK_A });
      kit.controller.post({ kind: 'mouseDown', x: 1, y: 1, shift: ShiftBit.Left });
      kit.controller.post({ kind: 'mouseUp', x: 1, y: 1, shift: 0 });
      kit.controller.post({ kind: 'pushButton', bit: 0, down: true });
      kit.controller.post({ kind: 'switchClick', bit: 1 });
      for (let frame = 0; frame < frames; frame++) kit.time.advance(16.21);
      expect(steps, `${ips} instructions per second`).toHaveLength(6);
      expect(gapsOf(steps), `${ips} instructions per second`).toEqual(new Array<number>(5).fill(subslice(ips)));
      kit.dispose();
    }
  });

  it('never lets two edges reach a running program less than a sub-slice apart', async () => {
    // Bursts of four edges posted at many different moments between two frames, so that the
    // allowance left when an edge arrives - and with it the length of the engine call that
    // follows - takes every size. (Counting "a run() that executed something" as a sub-slice let
    // edges through 41 instructions apart here.)
    const steps: number[] = [];
    await start({ wrapEngine: recordEdgeSteps(steps) });
    await kit.open(spin);
    kit.controller.run();
    kit.time.advance(100);
    const random = createRandom(12345);
    for (let burst = 0; burst < 300; burst++) {
      kit.controller.post({ kind: 'keyDown', vk: VK_A });
      kit.controller.post({ kind: 'keyUp', vk: VK_A });
      kit.controller.post({ kind: 'keyDown', vk: VK_A + 1 });
      kit.controller.post({ kind: 'keyUp', vk: VK_A + 1 });
      kit.time.advance(1 + Math.floor(random() * 40));
      kit.time.advance(0.37 * Math.floor(random() * 10));
    }
    kit.time.advance(100);
    expect(steps).toHaveLength(1200);
    expect(kit.controller.queueLength).toBe(0);
    const gaps = gapsOf(steps);
    expect(Math.min(...gaps)).toBe(subslice(1_000_000));
    expect(subslice(1_000_000)).toBe(2000);
  });

  it('a program that looks at a key only every 250 instructions sees every press and release posted together', async () => {
    await start();
    await kit.open(slowPoll);
    kit.controller.run();
    kit.time.advance(50);
    const random = createRandom(99);
    const pairs = 300;
    for (let pair = 0; pair < pairs; pair++) {
      kit.controller.post({ kind: 'keyDown', vk: VK_A });
      kit.controller.post({ kind: 'keyUp', vk: VK_A });
      kit.time.advance(1 + Math.floor(random() * 40) + 0.37 * Math.floor(random() * 10));
    }
    kit.time.advance(100);
    expect(register(Reg.D7)).toBe(pairs);
  });

  it('delivers at once the edges that wait when the program stops executing', async () => {
    const steps: number[] = [];
    await start({ wrapEngine: recordEdgeSteps(steps) });
    await kit.open(spin);
    kit.controller.run();
    kit.time.advance(96); // the frame at 96 ms has used the allowance up: a tick right after it executes nothing
    kit.controller.post({ kind: 'keyDown', vk: VK_A });
    kit.controller.post({ kind: 'keyUp', vk: VK_A });
    kit.controller.post({ kind: 'keyDown', vk: VK_A + 1 });
    kit.time.advance(0); // one tick without a frame: the first edge, the others wait
    expect(steps).toHaveLength(1);
    expect(kit.controller.queueLength).toBe(2);
    // A dialog holds the program: the original's modal loop would drain its queue, and so does the port.
    const release = kit.controller.hold();
    kit.time.advance(16); // the next frame
    expect(steps).toHaveLength(3);
    expect(gapsOf(steps)[1]).toBe(0); // nothing executed between the two that were drained
    release();
    // Running again: an edge delivered while the program stood still separates nothing, so the
    // next one goes through at once, and the one after it a sub-slice later.
    kit.controller.post({ kind: 'keyUp', vk: VK_A + 1 });
    kit.controller.post({ kind: 'keyDown', vk: VK_A + 2 });
    kit.time.advance(16);
    expect(steps).toHaveLength(5);
    expect(gapsOf(steps)[3]).toBe(2000);
  });

  it('two mouse-down requests at one interrupt level give two interrupts', async () => {
    await start(exceptionsOn);
    await kit.open(mouseIrq);
    kit.controller.run();
    kit.time.advance(50);
    expect(register(Reg.D5)).toBe(0);
    kit.controller.post({ kind: 'mouseDown', x: 10, y: 20, shift: ShiftBit.Left });
    kit.controller.post({ kind: 'mouseDown', x: 11, y: 21, shift: ShiftBit.Left });
    kit.time.advance(32);
    expect(register(Reg.D5)).toBe(2);
    expect(kit.controller.phase).toBe('running');
  });

  it('delivers everything at once while the program waits for input', async () => {
    await start();
    await kit.open(readLine);
    kit.controller.run();
    expect(kit.controller.phase).toBe('waitInput');
    kit.forgetEngineLog();
    for (const ch of 'HI') kit.controller.post({ kind: 'char', ch: ch.charCodeAt(0) });
    kit.controller.post({ kind: 'keyDown', vk: 0x0d, ch: 13 });
    kit.controller.post({ kind: 'keyUp', vk: 0x0d });
    kit.time.advance(0); // one tick
    // Each character is followed by one run(), which waits on until Enter completes the line.
    expect(kit.engineCalls().slice(0, 6)).toEqual(['keyChar', 'run', 'keyChar', 'run', 'keyDown', 'keyChar']);
    expect(kit.controller.phase).toBe('idle');
    expect(register(Reg.D6) & 0xffff).toBe(2);
    expect(textOf(kit.controller.engine.memory.subarray(0x2000, 0x2002))).toBe('HI');
    expect(kit.controller.queueLength).toBe(0);
  });

  it('a keyDown with paste delivers its bytes with no instruction in between', async () => {
    await start();
    await kit.open(readLine);
    kit.controller.run();
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: VK_INSERT, paste: bytesOf('HELLO\r') });
    kit.time.advance(0);
    const calls = kit.engineCalls();
    expect(calls.slice(0, 8)).toEqual(['keyDown', ...new Array<string>(6).fill('keyChar'), 'run']);
    expect(register(Reg.D6) & 0xffff).toBe(5);
    expect(textOf(kit.controller.engine.memory.subarray(0x2000, 0x2005))).toBe('HELLO');
    expect(kit.controller.phase).toBe('idle');
  });

  it('pasting HELLO into a task 5 loop stores HO: the first key, then the last of the type-ahead', async () => {
    await start();
    await kit.open(readTwoChars);
    kit.controller.run();
    expect(kit.controller.phase).toBe('waitInput');
    kit.controller.post({ kind: 'keyDown', vk: VK_INSERT, paste: bytesOf('HELLO') });
    kit.time.advance(16);
    expect(kit.controller.phase).toBe('idle');
    expect(String.fromCharCode(register(Reg.D6) & 0xff, register(Reg.D7) & 0xff)).toBe('HO');
  });

  it('does not deliver pasted text when the engine says key commands are disabled (task 24)', async () => {
    await start();
    await kit.open(lineAfterTask24);
    kit.controller.run();
    expect(kit.controller.phase).toBe('waitInput');
    expect(kit.bridge.state.keyCommands).toBe(false);
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: VK_INSERT, paste: bytesOf('HI\r') });
    kit.time.advance(0);
    expect(kit.engineCalls()).toEqual(['keyDown']); // no character, and so no run()
    expect(kit.controller.phase).toBe('waitInput');
  });

  it('keeps the queue during a load and delivers it afterwards', async () => {
    await start();
    await kit.open(spin);
    const release = kit.block('revalidate');
    const loading = kit.controller.reload();
    await Promise.resolve();
    expect(kit.controller.phase).toBe('loading');
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: VK_A });
    kit.controller.post({ kind: 'call', fn: (engine) => engine.setOption(SimOption.BitField, true) });
    kit.time.advance(100);
    expect(kit.engineCalls()).toEqual([]);
    expect(kit.controller.queueLength).toBe(2);
    release();
    await loading;
    kit.time.advance(0);
    expect(kit.engineCalls()).toEqual(['load', 'keyDown', 'setOption']);
  });

  it('invoke runs at once when idle, and is queued during a load and inside an engine call', async () => {
    await start();
    await kit.open(spin);
    const order: string[] = [];
    kit.controller.invoke(() => order.push('idle'));
    expect(order).toEqual(['idle']);
    // From inside an engine call (as a host part would, 3.3.2): queued, run after the call.
    kit.controller.invoke((engine) => {
      order.push('outer starts');
      kit.controller.invoke(() => order.push('inner'));
      engine.clearCycles();
      order.push('outer ends');
    });
    expect(order).toEqual(['idle', 'outer starts', 'outer ends']);
    kit.time.advance(0);
    expect(order).toEqual(['idle', 'outer starts', 'outer ends', 'inner']);
  });
});
