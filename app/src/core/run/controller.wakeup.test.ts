// Wake-up (ARCHITECTURE.md 4.3; hardware §3.1 items 4 and 7): a request made while the simulator
// is idle starts execution - a key or mouse event armed by task 62 or 60, an IRQ button, an
// auto-interrupt tick, the Reset button - without the effects of the Run command.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, ShiftBit, SimOption } from '../../contracts';
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

describe.skipIf(!enginesBuilt)('wake-up (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let stopper: AssembledProgram;
  let haltKeepsHardware: AssembledProgram;
  let timed: AssembledProgram;
  let kit: Kit;
  const exceptionsOn: KitOptions = { applySettings: (engine) => engine.setOption(SimOption.Exceptions, true) };
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  const register = (reg: Reg) => kit.controller.engine.getRegister(reg);

  /** Runs the program until it is parked on its STOP instruction. */
  const runToStop = async (program: AssembledProgram) => {
    await start(exceptionsOn);
    await kit.open(program);
    kit.controller.run();
    kit.time.advance(32);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.engine.state().stopInstruction).toBe(true);
    kit.forgetEngineLog();
    kit.events.length = 0;
    kit.calls.length = 0;
  };

  beforeAll(async () => {
    // Arms mouse-down at level 1 and key-down at level 2, then sleeps in STOP #$2000. Handlers
    // count in D4 (mouse), D5 (key) and D6 (level 3: IRQ button, timer); D7 counts the wake-ups.
    // The reset vectors lead to RESET, which halts with D3 = 1.
    stopper = await assembleProgram([
      '        ORG     0',
      '        DC.L    $00F00000',
      '        DC.L    RESET',
      '        ORG     $64',
      '        DC.L    MOUSE',
      '        DC.L    KEY',
      '        DC.L    LEVEL3',
      '        ORG     $1000',
      'START:  MOVE.W  #$0101,D1',
      '        MOVEQ   #60,D0',
      '        TRAP    #15',
      '        MOVE.W  #$0201,D1',
      '        MOVEQ   #62,D0',
      '        TRAP    #15',
      'SLEEP:  STOP    #$2000',
      '        ADDQ.L  #1,D7',
      '        BRA     SLEEP',
      'MOUSE:  ADDQ.L  #1,D4',
      '        RTE',
      'KEY:    ADDQ.L  #1,D5',
      '        RTE',
      'LEVEL3: ADDQ.L  #1,D6',
      '        RTE',
      'RESET:  MOVEQ   #1,D3',
      '        SIMHALT',
      '        END     START',
    ]);
    // With exceptions off TRAP #1 halts the program but leaves the hardware enabled.
    haltKeepsHardware = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVE.W  #$0201,D1',
      '        MOVEQ   #62,D0',
      '        TRAP    #15',
      '        MOVE.W  #$0101,D1',
      '        MOVEQ   #60,D0',
      '        TRAP    #15',
      '        TRAP    #1',
      '        ADDQ.L  #1,D5',
      '        TRAP    #1',
      '        ADDQ.L  #1,D5',
      '        SIMHALT',
      '        END     START',
    ]);
    // Asks for auto interrupt 3 every 100 ms (task 32/6), then sleeps.
    timed = await assembleProgram([
      '        ORG     $6C',
      '        DC.L    LEVEL3',
      '        ORG     $1000',
      'START:  MOVEQ   #6,D1',
      '        MOVE.B  #$83,D2',
      '        MOVEQ   #100,D3',
      '        MOVEQ   #32,D0',
      '        TRAP    #15',
      'SLEEP:  STOP    #$2000',
      '        ADDQ.L  #1,D7',
      '        BRA     SLEEP',
      'LEVEL3: ADDQ.L  #1,D6',
      '        RTE',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  it('a program in STOP runs its handler after a posted mouseDown and after a posted keyDown', async () => {
    await runToStop(stopper);
    kit.controller.post({ kind: 'mouseDown', x: 5, y: 6, shift: ShiftBit.Left });
    kit.time.advance(16);
    expect([register(Reg.D4), register(Reg.D5), register(Reg.D7)]).toEqual([1, 0, 1]);
    expect(kit.controller.phase).toBe('idle'); // asleep again

    kit.controller.post({ kind: 'keyDown', vk: 0x41, ch: 0x61 });
    kit.time.advance(16);
    expect([register(Reg.D4), register(Reg.D5), register(Reg.D7)]).toEqual([1, 1, 2]);
    expect(kit.controller.phase).toBe('idle');

    // It started without the effects of the Run command: no cmdRun, no focus change, no audio.
    expect(kit.engineCalls()).not.toContain('cmdRun');
    expect(kit.calls.map((call) => call.method)).not.toContain('ioBringToFront');
    expect(kit.events).not.toContain('audio');
  });

  it('wakes for an IRQ request', async () => {
    await runToStop(stopper);
    kit.controller.post({ kind: 'irq', level: 3 });
    kit.time.advance(16);
    expect([register(Reg.D6), register(Reg.D7)]).toEqual([1, 1]);
    expect(kit.controller.phase).toBe('idle');
  });

  it('delivers both edges of a key to the sleeping program; only the armed one interrupts', async () => {
    await runToStop(stopper);
    kit.controller.post({ kind: 'keyDown', vk: 0x41 });
    kit.controller.post({ kind: 'keyUp', vk: 0x41 });
    kit.time.advance(32);
    expect(register(Reg.D5)).toBe(1); // the program armed key-down only
    expect(kit.engineCalls().filter((name) => name === 'keyDown' || name === 'keyUp')).toEqual(['keyDown', 'keyUp']);
    expect(kit.controller.phase).toBe('idle');
  });

  it('wakes for the ticks of an auto-interrupt timer', async () => {
    await start(exceptionsOn);
    await kit.open(timed);
    kit.controller.run();
    kit.time.advance(16);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.hardwareTimers[3]?.enabled).toBe(true);
    expect(kit.hardwareTimers[3]?.intervalMs).toBe(100);
    kit.forgetEngineLog();
    kit.time.advance(1000);
    // Timers are checked once per frame: a tick every 112 ms.
    const ticks = kit.engineCalls().filter((name) => name === 'timerTick').length;
    expect(ticks).toBeGreaterThanOrEqual(8);
    expect(ticks).toBeLessThanOrEqual(9);
    expect(register(Reg.D6)).toBe(ticks);
    expect(register(Reg.D7)).toBe(ticks);
    // Pause switches the auto interrupts off.
    kit.controller.pause();
    expect(kit.hardwareTimers[3]?.enabled).toBe(false);
    kit.forgetEngineLog();
    kit.time.advance(1000);
    expect(kit.engineCalls()).not.toContain('timerTick');
  });

  it('wakes for the Reset button: execution continues at the reset vector', async () => {
    await runToStop(stopper);
    kit.controller.post({ kind: 'hwReset' });
    kit.time.advance(16);
    expect(register(Reg.D3)).toBe(1);
    expect(register(Reg.SSP)).toBe(0x00f00000);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.snapshot.halted).toBe(true);
  });

  it('wakes after a halt that leaves the hardware enabled', async () => {
    await start(); // exceptions off: TRAP #1 halts
    await kit.open(haltKeepsHardware);
    kit.controller.run();
    kit.time.advance(16);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.snapshot.halted).toBe(true);
    expect(kit.controller.engine.state().hardwareEnabled).toBe(true);
    expect(kit.bridge.state.menuState).toBe(1); // the Run command is disabled
    expect(register(Reg.D5)).toBe(0);

    kit.controller.post({ kind: 'keyDown', vk: 0x41 });
    kit.time.advance(16);
    expect(register(Reg.D5)).toBe(1); // it resumed after the TRAP and met the next one
    expect(kit.controller.phase).toBe('idle');

    kit.controller.post({ kind: 'mouseDown', x: 1, y: 1, shift: ShiftBit.Left });
    kit.time.advance(16);
    expect(register(Reg.D5)).toBe(2);
    expect(kit.controller.phase).toBe('idle');

    // After SIMHALT the hardware is disabled: requests are dropped.
    expect(kit.controller.engine.state().hardwareEnabled).toBe(false);
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'keyDown', vk: 0x42 });
    kit.time.advance(16);
    expect(kit.engineCalls()).toEqual(['keyDown']);
    expect(kit.controller.phase).toBe('idle');
  });

  it('only latches a request in trace mode: nothing runs after Pause', async () => {
    await runToStop(stopper);
    kit.controller.pause();
    kit.forgetEngineLog();
    kit.controller.post({ kind: 'irq', level: 3 });
    kit.time.advance(32);
    expect(kit.engineCalls()).toEqual(['irq']);
    expect(kit.controller.phase).toBe('idle');
    expect(register(Reg.D6)).toBe(0);
  });

  it('does not run a woken program while a dialog holds the controller', async () => {
    await runToStop(stopper);
    const release = kit.controller.hold();
    kit.controller.post({ kind: 'irq', level: 3 });
    kit.time.advance(100);
    expect(kit.controller.phase).toBe('running'); // woken, but held
    expect(kit.engineCalls()).toEqual(['irq']);
    release();
    kit.time.advance(16);
    expect(register(Reg.D6)).toBe(1);
  });
});
