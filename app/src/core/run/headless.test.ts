// The headless session (ARCHITECTURE.md 6.4): a program runs to SIMHALT under Node, with the real
// engine, the real run controller, virtual time and no user interface.
//
// The first group uses the host parts at their final paths, as the conformance harness will. The
// second replaces the devices by doubles, so that it tests the composition and nothing else.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Reg, SimOption, type Vfs } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { HOST_DEFAULTS } from '../../engine/sim';
import { assembleProgram, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { createVfs } from '../../fs/vfs';
import { createHeadlessSession, type HeadlessOptions, type HeadlessSession } from './headless';
import { createDeviceDoubles } from './test-kit';

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
const PATH = '/memory/demo/hello.S68';

describe.skipIf(!enginesBuilt)('headless session (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let hello: AssembledProgram;
  let asksOptions: AssembledProgram;
  let vfs: Vfs;
  let session: HeadlessSession | null = null;

  const create = async (options: Partial<HeadlessOptions> = {}) => {
    session = await createHeadlessSession({
      engines: { create: createSimEngine, release: releaseSimEngine },
      vfs,
      viewFor: () => new MemorySyncFiles(),
      ...options,
    });
    return session;
  };

  beforeAll(async () => {
    hello = await assembleProgram([
      '        ORG     $1000',
      'START:  LEA     TEXT,A1',
      '        MOVEQ   #14,D0',
      '        TRAP    #15',
      '        MOVEQ   #50,D1', // half a second
      '        MOVEQ   #23,D0',
      '        TRAP    #15',
      '        MOVEQ   #7,D5',
      '        SIMHALT',
      "TEXT:   DC.B    'HELLO',0",
      '        END     START',
    ]);
    // Task 32/5 enables exception processing and saves the settings.
    asksOptions = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #5,D1',
      '        MOVEQ   #32,D0',
      '        TRAP    #15',
      '        SIMHALT',
      '        END     START',
    ]);
    vfs = createVfs();
    vfs.mount(new MemoryBackend());
    await vfs.writeFile(PATH, hello.s68);
    await vfs.writeFile('/memory/demo/hello.L68', hello.l68);
    await vfs.writeFile('/memory/demo/options.S68', asksOptions.s68);
  }, LONG);

  afterEach(() => {
    session?.dispose();
    session = null;
  });

  describe('with the host parts at their final paths', () => {
    it('a program runs to SIMHALT', async () => {
      const s = await create();
      expect(Object.keys(s.host).sort()).toEqual(Object.keys(HOST_DEFAULTS).sort());
      await s.controller.open(PATH, 'open');
      expect(s.controller.program).toEqual({ path: PATH, title: PATH, hasListing: true });
      expect(s.messages()).toContain('.S68 file read successful');
      s.controller.run();
      expect(s.controller.phase).toBe('waitDelay');
      expect(s.runUntilIdle()).toBe(true);
      expect(s.time.now()).toBeGreaterThanOrEqual(500); // the delay took its time, in virtual time
      expect(s.time.now()).toBeLessThan(532);
      expect(s.controller.snapshot.halted).toBe(true);
      expect(s.engine.getRegister(Reg.D5)).toBe(7);
      expect(s.engine.state().halt).toBe(true);
      expect(s.reports).toEqual([]);
    });

    it('always reads the current engine from the session', async () => {
      const s = await create();
      const first = s.engine;
      let replaced = 0;
      s.onEngineReplaced(() => replaced++);
      await s.controller.open(PATH, 'execute');
      await s.controller.open(PATH, 'execute');
      expect(replaced).toBe(1); // the first Execute found the simulator still in start-up state
      expect(s.engine).not.toBe(first);
      expect(s.engine).toBe(s.controller.engine);
    });
  });

  describe('the cold start of Execute and the saved settings (4.7.1; gate I2)', () => {
    /** onEngineReplaced calls while `fn` runs: 0 = the cold start was skipped. */
    const coldStartsDuring = async (s: HeadlessSession, fn: () => Promise<void>) => {
      let count = 0;
      const stop = s.onEngineReplaced(() => count++);
      await fn();
      stop();
      return count;
    };
    const options = (s: HeadlessSession) => ({
      exceptions: s.engine.getOption(SimOption.Exceptions),
      execLogType: s.engine.getOption(SimOption.ExecLogType),
      outputLogType: s.engine.getOption(SimOption.OutputLogType),
      logTypes: [s.log.state.execType, s.log.state.outputType],
    });

    it('nothing changed since the start: the first Execute keeps the start-up simulator, frame or no frame', async () => {
      for (const frames of [0, 1, 3]) {
        const s = await create();
        s.time.advance(16 * frames); // the log service's queued read of the new engine, delivered or not
        expect(await coldStartsDuring(s, () => s.controller.open(PATH, 'execute')), `${frames} frame(s)`).toBe(0);
        s.dispose();
      }
    });

    it('settings changed without an engine call (an import of sim68K.dat): Execute applies them', async () => {
      for (const frames of [0, 1]) {
        const s = await create();
        s.time.advance(16 * frames);
        expect(options(s)).toEqual({ exceptions: 0, execLogType: 0, outputLogType: 0, logTypes: [0, 0] });
        Object.assign(s.settings, { exceptions: true, execLogType: 2, outputLogType: 1 });
        expect(await coldStartsDuring(s, () => s.controller.open(PATH, 'execute')), `${frames} frame(s)`).toBe(1);
        s.time.advance(16);
        expect(options(s), `${frames} frame(s)`).toEqual({
          exceptions: 1,
          execLogType: 2,
          outputLogType: 1,
          logTypes: [2, 1],
        });
        // The settings did not change again: the next Execute is a cold start because of the load.
        expect(await coldStartsDuring(s, () => s.controller.open(PATH, 'execute'))).toBe(1);
        s.dispose();
      }
    });

    it('a setting changed and changed back leaves nothing to apply: skipped', async () => {
      const s = await create();
      s.settings.exceptions = true;
      s.settings.exceptions = false;
      expect(await coldStartsDuring(s, () => s.controller.open(PATH, 'execute'))).toBe(0);
    });
  });

  describe('with doubles for the devices', () => {
    it('a program runs to SIMHALT, and its output reaches the output device', async () => {
      const { parts, printed } = createDeviceDoubles();
      const s = await create({ parts });
      await s.controller.open(PATH, 'open');
      s.controller.run();
      expect(s.runUntilIdle()).toBe(true);
      expect(printed).toEqual(['HELLO']);
      expect(s.controller.snapshot.halted).toBe(true);
      expect(s.engine.getRegister(Reg.D5)).toBe(7);
      expect(s.uiLog).toContain('resetPanels');
    });

    it('a cold start shuts the old simulator down, resets every part and applies the settings', async () => {
      const { parts, resets } = createDeviceDoubles();
      const s = await create({
        parts,
        settings: { exceptions: true, seg7Address: 0xe10000, outputFont: { name: 'Courier New', size: 12 } },
      });
      // The start itself was a cold start.
      expect(resets).toEqual([
        'log.exit',
        'files.exit',
        'surface',
        'text',
        'keyboard',
        'sound',
        'files',
        'printer',
        'hardware',
        'log',
        'font:Courier New,12',
      ]);
      expect(s.uiLog.slice(0, 2)).toEqual(['fullScreen:false', 'resetPanels']);
      expect(s.engine.getOption(SimOption.Exceptions)).toBe(1);
      expect(s.engine.hardware().seg7).toBe(0xe10000);
      expect(s.settings.exceptions).toBe(true);
    });

    it('follows options the program changes, and the command line', async () => {
      const { parts } = createDeviceDoubles();
      const s = await create({ parts, commandLine: { run: true } });
      expect(s.settings.exceptions).toBe(false);
      await s.controller.open('/memory/demo/options.S68', 'commandLine');
      expect(s.runUntilIdle()).toBe(true); // /r: it ran without a Run command
      expect(s.controller.snapshot.halted).toBe(true);
      expect(s.settings.exceptions).toBe(true);
      expect(s.uiLog).toContain('saveSettings');
    });

    it('answers the Caution question as told', async () => {
      const { parts } = createDeviceDoubles();
      let answer = false;
      const s = await create({ parts, answers: { caution: () => answer } });
      await s.controller.open(PATH, 'open');
      await s.controller.close();
      expect(s.engine.listingLineCount).toBeGreaterThan(0);
      answer = true;
      await s.controller.close();
      expect(s.engine.listingLineCount).toBe(0);
    });

    it('runUntilIdle gives up after its limit and answers message boxes with OK', async () => {
      const { parts } = createDeviceDoubles();
      const s = await create({ parts });
      const spin = await assembleProgram(['        ORG     $1000', 'START:  BRA     START', '        END     START']);
      await vfs.writeFile('/memory/demo/spin.S68', spin.s68);
      await s.controller.open('/memory/demo/spin.S68', 'open');
      s.controller.run();
      expect(s.runUntilIdle(200)).toBe(false);
      expect(s.controller.phase).toBe('running');
      s.controller.pause();
      // Run To Cursor without a selection raises a box; runUntilIdle closes it.
      s.controller.runToCursor(-1);
      expect(s.controller.alerts).toHaveLength(1);
      expect(s.runUntilIdle()).toBe(true);
      expect(s.controller.alerts).toEqual([]);
    });
  });
});
