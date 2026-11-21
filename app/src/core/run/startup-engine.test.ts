// The stand-in engine answers like a real engine that has just started (startup-engine.ts).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Box, RunStatus, type SimEngine } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { SIM_ENGINE_MEMBERS } from '../../engine/sim';
import { createRecordingHost } from '../../engine/testing';
import { createStartupEngine, startupBoxes } from './startup-engine';

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const simBuilt = ['sim68k.wasm', 'sim68k-loader.mjs'].every((file) => existsSync(dist(file)));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !simBuilt)('engine/dist holds the simulator', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

describe('createStartupEngine', () => {
  it('has every member of SimEngine', () => {
    const engine = createStartupEngine() as unknown as Record<string, unknown>;
    expect(Object.keys(engine).sort()).toEqual([...SIM_ENGINE_MEMBERS].sort());
  });

  it('executes nothing and changes nothing', () => {
    const engine = createStartupEngine();
    engine.cmdRun();
    expect(engine.run(1000)).toBe(RunStatus.Stopped);
    expect(engine.cmdTraceInto()).toBe(RunStatus.Stopped);
    expect(engine.autoTraceTick()).toBe(RunStatus.Stopped);
    engine.writeBytes(0x1000, [1, 2, 3]);
    engine.load(new Uint8Array(4));
    expect(engine.loadData(new Uint8Array(4))).toBe(false);
    expect(engine.editBox(Box.D0, '00000001')).toBe(false);
    expect(engine.setBreakpoint(0x1000)).toBe(false);
    expect(engine.irq(1)).toBe(false);
    expect(engine.stepCount).toBe(0);
    expect(engine.state().runMode).toBe(false);
    expect(engine.readByte(0x1000)).toBe(0xff);
    expect(engine.memory).toHaveLength(0x1000000);
    expect(engine.memory[0x1000]).toBe(0xff);
  });

  it.skipIf(!simBuilt)(
    'reads as a real engine reads right after start (needs engine/dist)',
    async () => {
      const real: SimEngine = await createSimEngine(createRecordingHost().host);
      const standIn = createStartupEngine();
      try {
        expect(standIn.state()).toEqual(real.state());
        expect(standIn.registers()).toEqual(real.registers());
        expect(standIn.hardware()).toEqual(real.hardware());
        expect(startupBoxes()).toEqual(Array.from({ length: 20 }, (_, box) => real.boxText(box as Box)));
        for (let box = 0; box < 20; box++) expect(standIn.boxText(box as Box)).toBe(real.boxText(box as Box));
        expect(standIn.cycles).toBe(real.cycles);
        expect(standIn.cyclesText).toBe(real.cyclesText);
        expect(standIn.breakpoints()).toEqual(real.breakpoints());
        expect(standIn.listingLineCount).toBe(real.listingLineCount);
        expect(standIn.listingHighlight).toBe(real.listingHighlight);
        expect(standIn.delayRemaining).toBe(real.delayRemaining);
        expect(standIn.stepCount).toBe(real.stepCount);
        for (const address of [0, 0x1000, 0xe00010, 0xffffff]) {
          expect(standIn.readByte(address)).toBe(real.readByte(address));
          expect(standIn.readWord(address)).toBe(real.readWord(address));
        }
        expect(standIn.readLong(0x2000)).toBe(real.readLong(0x2000));
        expect(standIn.run(10)).toBe(real.run(10)); // not in run mode: Stopped
      } finally {
        releaseSimEngine(real);
      }
    },
    60_000,
  );
});
