// The Stack panel's model on SH8's REAL simulator session and run controller (features/run,
// core/run), with the real engine and virtual time; only the devices of other packages are
// doubles (core/run/test-kit.ts). model.test.ts tests the same rules on a session double.
//
// Gate I2, major defect carried from gate I1 round 3: a trace over TRAP #15 task 32 with D1 = 0
// makes the engine call StackFrm->Repaint() (Hardware->FormShow) and then updateDisplay()
// (regPCChange) in ONE engine call. The original ends re-centred on the stack pointer; the port's
// bridge used to OR the bits of the call, and the panel stayed where the user had scrolled it.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SimSessionEnv } from '../../contracts';
import { VirtualTime } from '../../core/run/clock';
import { BLANK_GLYPHS } from '../../core/run/headless';
import { createDeviceDoubles } from '../../core/run/test-kit';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, type AssembledProgram } from '../../engine/testing';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature as runFeature } from '../run/index';
import { createSimSession, runSessionOf, type RunSession } from '../run/session';
import { feature } from './index';
import { stackModelOf } from './model';

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

/** Every test here runs the real engine; on a busy machine one can take seconds. */
const ENGINE_TEST_TIMEOUT = 60_000;
const DIR = '/browser/stack';

const ENGINES: SimSessionEnv = {
  engines: { create: createSimEngine, release: releaseSimEngine },
  createCachedSyncFiles: () => new MemorySyncFiles(),
};

describe.skipIf(!enginesBuilt)(
  "the Stack panel's model on the real session and run controller (needs engine/dist)",
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let trap32: AssembledProgram;
    let app: TestApplication;

    beforeAll(async () => {
      trap32 = await assembleProgram([
        '    ORG $1000',
        'START:',
        '    MOVEQ #0,D1',
        '    MOVE.B #32,D0',
        '    TRAP #15', // task 32, D1 = 0: show the Hardware window
        '    MOVEQ #1,D2',
        '    SIMHALT',
        '    END START',
      ]);
    }, 120_000);

    afterEach(() => app?.dispose());

    async function start(): Promise<RunSession> {
      const time = new VirtualTime();
      const { parts } = createDeviceDoubles();
      app = createTestApplication({
        clock: time,
        scheduler: time,
        session: ENGINES,
        features: [runFeature, feature],
        services: {
          createSimSession: (ctx, env) => createSimSession(ctx, env, { parts, glyphs: BLANK_GLYPHS }),
        },
      });
      const session = runSessionOf(app.ctx.sim) as RunSession;
      await app.ctx.vfs.writeFile(`${DIR}/trap32.S68`, trap32.s68);
      await app.ctx.vfs.writeFile(`${DIR}/trap32.L68`, trap32.l68);
      await session.start();
      await app.ctx.commands.run('app.mode.set', 'simulator');
      await app.ctx.sim.controller.open(`${DIR}/trap32.S68`, 'open');
      return session;
    }

    const ssp = () => app.ctx.sim.engine.registers().ssp >>> 0;

    it('a trace over TRAP #15 task 32/0 re-centres a scrolled panel on SS', async () => {
      await start();
      const model = stackModelOf(app.ctx);
      model.setRows(9);
      model.setChoice(8); // SS
      await app.ctx.commands.run('sim.run.traceInto'); // MOVEQ #0,D1
      await app.ctx.commands.run('sim.run.traceInto'); // MOVE.B #32,D0
      expect(model.getState().midAddr).toBe(ssp());
      model.scrollDown();
      model.scrollDown();
      const scrolled = model.getState().midAddr;
      expect(scrolled).not.toBe(ssp());
      const before = app.ctx.store.getState().sim.repaint;
      await app.ctx.commands.run('sim.run.traceInto'); // TRAP #15
      const after = app.ctx.store.getState().sim.repaint;
      console.log(
        `trace over TRAP #15 task 32/0: stack ${before?.stack} -> ${after?.stack}, ` +
          `stackRedraw ${before?.stackRedraw} -> ${after?.stackRedraw}; midAddr ${scrolled} -> ${model.getState().midAddr}`,
      );
      expect(model.getState().midAddr).toBe(ssp());
      expect(model.getState().view[4]?.address).toBe(ssp() & 0xffffff); // rows show 24-bit addresses
    });

    it('a Hardware switch click (StackFrm->Repaint() alone) still redraws in place', async () => {
      await start();
      const model = stackModelOf(app.ctx);
      model.setRows(9);
      model.setChoice(8);
      await app.ctx.commands.run('sim.run.traceInto');
      model.scrollDown();
      const scrolled = model.getState().midAddr;
      const paints = model.getState().paints;
      app.ctx.sim.controller.invoke((engine) => engine.switchClick(0));
      expect(model.getState().midAddr).toBe(scrolled);
      expect(model.getState().paints).toBeGreaterThan(paints);
    });
  },
);
