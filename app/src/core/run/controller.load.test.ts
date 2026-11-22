// Loading a program (ARCHITECTURE.md 4.7) and the cold start (4.7.1): the order of the steps,
// the 'loading' phase in which nothing else reaches the engine, and process-start state.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Box, MapKind, Reg, SimOption, type HostIoGraphics, type HostIoText } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, bytesOf, createRecordingHost, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { KIT_PROGRAM_PATH, createKit, partOf, type Kit, type KitEnv, type KitOptions } from './test-kit';
import { VirtualTime } from './clock';

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
const DIR = '/memory/work';
/** Lets pending promise chains run to their end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The output window as far as these tests need it: its size and the window pen. */
function outputDouble() {
  const state = { width: 640, height: 480, pen: [0, 0] as [number, number] };
  return {
    state,
    text: partOf<HostIoText>({
      setWindowSize(width, height) {
        if (width !== 0 || height !== 0) Object.assign(state, { width, height }); // 0,0 = keep the size
      },
      getWindowSize: () => [state.width, state.height],
    }),
    graphics: partOf<HostIoGraphics>({
      moveTo(x, y) {
        state.pen = [x, y];
      },
      getXY: () => state.pen,
      getPixel: () => 0,
    }),
    resetToStartup() {
      Object.assign(state, { width: 640, height: 480, pen: [0, 0] });
    },
  };
}

describe.skipIf(!enginesBuilt)('loading (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let counter: AssembledProgram;
  let halting: AssembledProgram;
  let leavesState: AssembledProgram;
  let observes: AssembledProgram;
  let readChar: AssembledProgram;
  let kit: Kit;
  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));
  const register = (reg: Reg) => kit.controller.engine.getRegister(reg);
  /** What happened since the kit was last told to forget, engine reads left out. */
  const sinceMark = () => kit.timeline.slice(mark).filter((entry) => !READS.has(entry));
  let mark = 0;
  const markHere = () => {
    mark = kit.timeline.length;
  };
  const READS = new Set(['engine.state', 'engine.boxText', 'engine.readWord', 'engine.listingLine']);

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
    // Enables a ROM range, sets the output size to 800x600 and moves the pen.
    leavesState = await assembleProgram([
      '        MEMORY  ROM $2000,$2FFF',
      '        ORG     $1000',
      'START:  MOVE.L  #$03200258,D1',
      '        MOVEQ   #33,D0',
      '        TRAP    #15',
      '        MOVEQ   #100,D1',
      '        MOVEQ   #120,D2',
      '        MOVEQ   #86,D0',
      '        TRAP    #15',
      '        SIMHALT',
      '        END     START',
    ]);
    // Writes to $2000 and reads it back (D5), reads the output size (D6) and the pen (D7, D4).
    observes = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVE.B  #$5A,$2000',
      '        MOVE.B  $2000,D5',
      '        MOVEQ   #0,D1',
      '        MOVEQ   #33,D0',
      '        TRAP    #15',
      '        MOVE.L  D1,D6',
      '        MOVEQ   #96,D0',
      '        TRAP    #15',
      '        MOVE.W  D1,D7',
      '        MOVE.W  D2,D4',
      '        SIMHALT',
      '        END     START',
    ]);
    readChar = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #5,D0',
      '        TRAP    #15',
      'LOOP:   ADDQ.L  #1,D5',
      '        BRA     LOOP',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  describe('the order of 4.7', () => {
    it('open: folder, load, listing, program, log names; no cold start', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, counter);
      markHere();
      kit.calls.length = 0;
      await kit.controller.open(KIT_PROGRAM_PATH, 'open');
      expect(sinceMark()).toEqual([
        `setCurrentDir:${DIR}`,
        'engine.load',
        'listing.refresh',
        `setLogFileNames:${KIT_PROGRAM_PATH}`,
      ]);
      // What the engine told the host during that one call (the recording host), in its order: the
      // simulator reset, the messages of the load, the caption, the panels to repaint.
      const told = kit.calls.map((call) => call.method);
      const order = ['clear', 'registersShown', 'messagesClear', 'message', 'caption'].map((method) =>
        told.indexOf(method),
      );
      expect(order.every((index) => index >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(told.at(-1)).toBe('repaint');
      expect(kit.calls.find((call) => call.method === 'caption')?.args[0]).toEqual(
        Uint8Array.from(KIT_PROGRAM_PATH, (ch) => ch.charCodeAt(0)),
      );
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.program).toEqual({ path: KIT_PROGRAM_PATH, title: KIT_PROGRAM_PATH, hasListing: true });
      expect(kit.controller.snapshot.boxes[Box.PC]).toBe('00001000');
      expect(kit.messages()).toEqual(['S0 = 68KPROG   20CREATED BY EASY68K', '.S68 file read successful']);
      expect(kit.listingRows[0]).toBe('00001000 Starting Address');
    });

    it('reload: revalidation instead of a new folder, and no new log names', async () => {
      await start();
      await kit.open(counter);
      markHere();
      await kit.controller.reload();
      expect(sinceMark()).toEqual(['revalidate', 'engine.load', 'listing.refresh']);
    });

    it('drop: as open (the engine is told "drop")', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, counter);
      markHere();
      await kit.controller.open(KIT_PROGRAM_PATH, 'drop');
      expect(sinceMark()).toEqual([
        `setCurrentDir:${DIR}`,
        'engine.load',
        'listing.refresh',
        `setLogFileNames:${KIT_PROGRAM_PATH}`,
      ]);
    });

    it('tells the engine the kind: open clears PC breakpoints, reload and drop keep them', async () => {
      await start();
      await kit.open(counter);
      kit.controller.invoke((engine) => engine.setBreakpoint(0x1002));
      await kit.controller.reload();
      expect(kit.controller.engine.breakpoints()).toEqual([0x1002]);
      await kit.controller.open(KIT_PROGRAM_PATH, 'drop');
      expect(kit.controller.engine.breakpoints()).toEqual([0x1002]);
      await kit.controller.open(KIT_PROGRAM_PATH, 'open');
      expect(kit.controller.engine.breakpoints()).toEqual([]);
    });

    for (const origin of ['execute', 'association'] as const) {
      it(`${origin}: a cold start first, then the load`, async () => {
        await start();
        await kit.open(counter); // so that the simulator is not in start-up state any more
        markHere();
        await kit.controller.open(KIT_PROGRAM_PATH, origin);
        expect(sinceMark()).toEqual([
          'exit',
          'engine.release',
          'reset',
          'engine.create',
          'apply',
          'listing.refresh',
          `setCurrentDir:${DIR}`,
          'engine.load',
          'listing.refresh',
          `setLogFileNames:${KIT_PROGRAM_PATH}`,
        ]);
        expect(kit.created).toBe(2);
        expect(kit.released).toBe(1);
        expect(kit.controller.phase).toBe('idle'); // loaded, not started
      });
    }

    it('commandLine: cold start, load, /e and /b, then idle, then /f and /r', async () => {
      await start({ commandLine: { run: true, fullScreen: true, exceptions: true, bitField: true } });
      await kit.open(halting);
      markHere();
      await kit.controller.open(KIT_PROGRAM_PATH, 'commandLine');
      const events = sinceMark();
      expect(events.slice(0, 15)).toEqual([
        'exit',
        'engine.release',
        'reset',
        'engine.create',
        'apply',
        'listing.refresh',
        `setCurrentDir:${DIR}`,
        'engine.load',
        'listing.refresh',
        `setLogFileNames:${KIT_PROGRAM_PATH}`,
        'engine.setOption',
        'engine.setOption',
        'option:exceptions=true', // the engine reported both changes: they go to the settings
        'option:bitField=true',
        'fullscreen',
      ]);
      expect(events.slice(15, 18)).toEqual(['engine.cmdRun', 'audio', 'engine.run']);
      expect(kit.controller.engine.getOption(SimOption.Exceptions)).toBe(1);
      expect(kit.controller.engine.getOption(SimOption.BitField)).toBe(1);
      kit.time.advance(16);
      expect(register(Reg.D5)).toBe(7);
    });

    it('commandLine without switches loads and does not run', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, halting);
      await kit.controller.open(KIT_PROGRAM_PATH, 'commandLine');
      kit.time.advance(100);
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D5)).toBe(0);
      expect(kit.events).not.toContain('fullscreen');
    });

    it('skips the cold start while the simulator is still exactly in start-up state', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, counter);
      markHere();
      await kit.controller.open(KIT_PROGRAM_PATH, 'commandLine');
      expect(sinceMark()).not.toContain('engine.create');
      expect(kit.created).toBe(1);
      // Now something was loaded: the next one starts afresh.
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(kit.created).toBe(2);
    });

    it('does not skip it when a part the controller cannot see was changed', async () => {
      let untouched = true;
      await start({ partsUntouched: () => untouched });
      await kit.put(KIT_PROGRAM_PATH, counter);
      untouched = false; // for example the Output size was changed from the menu
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(kit.created).toBe(2);
    });

    it('does not skip it when the saved settings changed since the last one (gate I2)', async () => {
      // An import of sim68K.dat changes the settings without an engine call; the program must be
      // started with them, as the original's new SIM68K.EXE reads sim68K.dat.
      let unchanged = true;
      const exceptions = { on: false };
      await start({
        settingsUnchanged: () => unchanged,
        applySettings: (engine) => engine.setOption(SimOption.Exceptions, exceptions.on),
      });
      await kit.put(KIT_PROGRAM_PATH, counter);
      exceptions.on = true;
      unchanged = false;
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(kit.created).toBe(2);
      expect(kit.controller.engine.getOption(SimOption.Exceptions)).toBe(1);
    });

    for (const delivered of [false, true]) {
      it(`a call the cold start queued itself does not count as a change (${delivered ? 'delivered' : 'still queued'} at the load)`, async () => {
        // The log service reads the log types of the new engine in its resetToStartup (3.3.5);
        // that call waits in the queue until the next tick. The skip must not depend on whether
        // a display frame has delivered it yet (gate I2).
        const reads: number[] = [];
        await start({
          onReset: () => kit.controller.invoke((engine) => void reads.push(engine.getOption(SimOption.Exceptions))),
          start: false, // `kit` must be this kit when the start resets the parts
        });
        await kit.controller.start();
        await kit.put(KIT_PROGRAM_PATH, counter);
        if (delivered) kit.time.advance(16);
        expect(reads).toHaveLength(delivered ? 1 : 0);
        await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
        expect(kit.created).toBe(1);
        kit.time.advance(16);
        expect(reads).toHaveLength(1);
        // Interface code that reaches the engine itself is a change: the next Execute starts afresh.
        await kit.controller.coldStart();
        expect(kit.created).toBe(2);
        kit.time.advance(16);
        kit.controller.invoke((engine) => engine.setBreakpoint(0x1000));
        await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
        expect(kit.created).toBe(3);
      });
    }

    it('finds the listing whatever its letter case, and works without one', async () => {
      await start();
      await kit.vfs.writeFile('/memory/a/Prog.s68', counter.s68);
      await kit.vfs.writeFile('/memory/a/PROG.l68', counter.l68);
      await kit.controller.open('/memory/a/Prog.s68', 'open');
      expect(kit.controller.program?.hasListing).toBe(true);
      expect(kit.listingRows[0]).toBe('00001000 Starting Address');

      await kit.vfs.writeFile('/memory/b/alone.S68', counter.s68);
      await kit.controller.open('/memory/b/alone.S68', 'open');
      expect(kit.controller.program).toEqual({
        path: '/memory/b/alone.S68',
        title: '/memory/b/alone.S68',
        hasListing: false,
      });
      expect(kit.messages()).toContain('Unable to open .L68 file.');
      expect(kit.listingRows).toHaveLength(9); // the nine explanatory lines
      expect(kit.controller.snapshot.boxes[Box.PC]).toBe('00001000');
    });

    it('a file that cannot be read: the engine says so; Reload then names that file', async () => {
      await start();
      await kit.controller.open('/memory/none/missing.S68', 'open');
      expect(kit.messages()).toEqual(['error: cannot open file /memory/none/missing.S68']);
      expect(kit.controller.program).toBeNull(); // Reload stays disabled
      expect(kit.controller.phase).toBe('idle');

      await kit.open(counter);
      await kit.controller.open('/memory/none/missing.S68', 'open');
      expect(kit.controller.program).toEqual({
        path: '/memory/none/missing.S68',
        title: KIT_PROGRAM_PATH, // the title is unchanged (sim-ui §8.2 step 6)
        hasListing: false,
      });
    });

    it('Open Data loads on top, resets nothing, moves the folder and becomes what Reload loads (sim-ui Q11)', async () => {
      await start();
      await kit.open(counter);
      kit.controller.run();
      kit.time.advance(50);
      // The data file's start address becomes the PC of the running program, as in the original
      // (sim-ui §8.3); this one names the loop, so that the program goes on counting.
      const data = await assembleProgram(['        ORG     $3000', 'DATA:   DC.B    1,2,3', '        END     $1002']);
      await kit.vfs.writeFile('/memory/data/table.S68', data.s68);
      markHere();
      await kit.controller.openData('/memory/data/table.S68');
      expect(sinceMark()).toEqual(['engine.loadData', 'setCurrentDir:/memory/data']);
      expect([0x3000, 0x3001, 0x3002].map((address) => kit.controller.engine.readByte(address))).toEqual([1, 2, 3]);
      expect(kit.controller.phase).toBe('running'); // the program goes on
      const count = register(Reg.D0);
      kit.time.advance(32);
      expect(register(Reg.D0)).toBeGreaterThan(count);
      expect(kit.controller.program?.path).toBe('/memory/data/table.S68');
      expect(kit.controller.program?.title).toBe(KIT_PROGRAM_PATH);
    });
  });

  describe('questions (4.7 step 2)', () => {
    const asked = () => kit.events.filter((event) => event === 'caution').length;

    it('open asks only while a program is running', async () => {
      await start();
      await kit.open(counter);
      await kit.controller.open(KIT_PROGRAM_PATH, 'open'); // stopped: no question
      expect(asked()).toBe(0);
      kit.controller.run();
      await kit.controller.open(KIT_PROGRAM_PATH, 'open');
      expect(asked()).toBe(1);
      expect(kit.controller.phase).toBe('idle');
    });

    it('drop asks whenever a program is loaded', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, counter);
      await kit.controller.open(KIT_PROGRAM_PATH, 'drop');
      expect(asked()).toBe(0);
      await kit.controller.open(KIT_PROGRAM_PATH, 'drop');
      expect(asked()).toBe(1);
    });

    it('execute asks while a program is running or waiting, not when it is stopped or halted (note 20)', async () => {
      await start();
      await kit.open(readChar);
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(asked()).toBe(0);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitInput');
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(asked()).toBe(1);
      await kit.open(halting);
      kit.controller.run();
      kit.time.advance(16);
      expect(kit.controller.snapshot.halted).toBe(true);
      await kit.controller.open(KIT_PROGRAM_PATH, 'execute');
      expect(asked()).toBe(1);
    });

    it('reload, commandLine and association never ask', async () => {
      await start();
      await kit.open(counter);
      for (const origin of ['reload', 'commandLine', 'association'] as const) {
        kit.controller.run();
        await kit.controller.open(KIT_PROGRAM_PATH, origin);
      }
      expect(asked()).toBe(0);
    });

    it('Cancel stops the load, and the program held meanwhile runs on', async () => {
      await start({ caution: () => false });
      await kit.open(counter);
      kit.controller.run();
      const release = kit.block('caution');
      kit.forgetEngineLog();
      const opening = kit.controller.open(KIT_PROGRAM_PATH, 'open');
      await settle();
      expect(kit.controller.held).toBe(true); // held while the question is open, whatever the mode
      expect(kit.controller.phase).toBe('running');
      const count = register(Reg.D0);
      kit.time.advance(200);
      expect(register(Reg.D0)).toBe(count);
      release();
      await opening;
      expect(kit.engineCalls()).not.toContain('load');
      expect(kit.controller.held).toBe(false);
      kit.time.advance(32);
      expect(register(Reg.D0)).toBeGreaterThan(count);
    });

    it('a second load request while the question is open is ignored', async () => {
      await start();
      await kit.open(counter);
      kit.controller.run();
      const release = kit.block('caution');
      kit.forgetEngineLog();
      const first = kit.controller.open(KIT_PROGRAM_PATH, 'open');
      await settle();
      await kit.controller.open(KIT_PROGRAM_PATH, 'drop');
      await kit.controller.reload();
      expect(kit.engineCalls()).not.toContain('load');
      release();
      await first;
      expect(kit.engineCalls().filter((name) => name === 'load')).toHaveLength(1);
      expect(asked()).toBe(1);
    });

    describe('confirmLoad: step 2 on its own (docs/requests/W1-load-confirm.md)', () => {
      it('with no program it resolves true without a question', async () => {
        await start();
        expect(await kit.controller.confirmLoad('drop')).toBe(true);
        expect(asked()).toBe(0);
      });

      it('with a program it asks once, holds the program meanwhile and resolves the answer', async () => {
        let answer = true;
        await start({ caution: () => answer });
        await kit.open(counter);
        kit.controller.run();
        const release = kit.block('caution');
        kit.forgetEngineLog();
        const asking = kit.controller.confirmLoad('drop');
        await settle();
        expect(kit.controller.held).toBe(true);
        await kit.controller.open(KIT_PROGRAM_PATH, 'drop'); // a load request meanwhile is ignored
        expect(kit.engineCalls()).not.toContain('load');
        release();
        expect(await asking).toBe(true);
        expect(asked()).toBe(1);
        expect(kit.controller.held).toBe(false);
        expect(kit.controller.phase).toBe('running'); // nothing loads until the caller's open
        answer = false;
        expect(await kit.controller.confirmLoad('drop')).toBe(false);
        expect(asked()).toBe(2);
        expect(kit.controller.phase).toBe('running');
      });

      it('asks exactly when open would ask', async () => {
        await start();
        await kit.open(counter);
        expect(await kit.controller.confirmLoad('open')).toBe(true); // stopped: no question
        expect(await kit.controller.confirmLoad('reload')).toBe(true);
        expect(asked()).toBe(0);
        expect(await kit.controller.confirmLoad('drop')).toBe(true); // a program is loaded
        expect(asked()).toBe(1);
        kit.controller.run();
        expect(await kit.controller.confirmLoad('open')).toBe(true);
        expect(await kit.controller.confirmLoad('execute')).toBe(true);
        expect(await kit.controller.confirmLoad('commandLine')).toBe(true);
        expect(asked()).toBe(3);
      });

      it("open(path, 'drop', { confirmed: true }) asks nothing and loads", async () => {
        await start();
        await kit.open(counter);
        kit.controller.run();
        kit.forgetEngineLog();
        await kit.controller.open(KIT_PROGRAM_PATH, 'drop', { confirmed: true });
        expect(asked()).toBe(0);
        expect(kit.engineCalls()).toContain('load');
        expect(kit.controller.phase).toBe('idle');
        // Without it the same request asks.
        await kit.controller.open(KIT_PROGRAM_PATH, 'drop', { confirmed: false });
        expect(asked()).toBe(1);
      });
    });
  });

  describe("the 'loading' phase (4.7 step 3)", () => {
    it('nothing reaches the engine between the start and the end of a load', async () => {
      await start();
      await kit.open(counter);
      const release = kit.block('setCurrentDir');
      let published = 0;
      kit.controller.subscribe(() => published++);
      const loading = kit.controller.open(KIT_PROGRAM_PATH, 'open');
      await settle();
      expect(kit.controller.phase).toBe('loading');
      expect(published).toBe(1); // the interface is told at once
      kit.forgetEngineLog();
      const engineReads = kit.engineLog.length;

      // Everything a user, a panel, a timer or a host part could do meanwhile:
      const { controller } = kit;
      kit.time.advance(500); // frames
      controller.run();
      controller.runToCursor(5);
      controller.stepOver();
      controller.traceInto();
      controller.autoTrace();
      controller.pause();
      controller.rewind();
      controller.editBox(Box.D0, '00000001');
      controller.pokeMemory(0x1000, 0);
      controller.clearCycles();
      controller.dismissAlerts();
      controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
      controller.post({ kind: 'keyDown', vk: 0x41, ch: 0x41 });
      controller.post({ kind: 'ioActivated' });
      const hold = controller.hold();
      hold();
      void controller.reload();
      void controller.open(KIT_PROGRAM_PATH, 'drop');
      void controller.openData(KIT_PROGRAM_PATH);
      void controller.close();
      void controller.coldStart();
      kit.time.advance(500);
      await settle();

      expect(kit.engineLog.length).toBe(engineReads); // not even a read
      expect(controller.phase).toBe('loading');
      expect(kit.events).not.toContain('caution');

      release();
      await loading;
      expect(controller.phase).toBe('idle');
      // The load itself, and only then what was queued: the invoke and the two posts, in order.
      kit.time.advance(0);
      expect(kit.engineCalls()).toEqual(['load', 'setOption', 'keyDown', 'keyChar', 'ioActivated']);
    });

    it('the same when Reload is requested twice: the second request is ignored', async () => {
      await start();
      await kit.open(counter);
      const release = kit.block('revalidate');
      kit.forgetEngineLog();
      const first = kit.controller.reload();
      const second = kit.controller.reload();
      await settle();
      expect(kit.controller.phase).toBe('loading');
      kit.time.advance(300);
      expect(kit.engineCalls()).toEqual([]);
      await second; // already over: it was ignored
      release();
      await first;
      expect(kit.engineCalls()).toEqual(['load']);
      expect(kit.events.filter((event) => event === 'revalidate')).toHaveLength(1);
    });

    it('the same when a program was running: it does not execute another instruction', async () => {
      await start();
      await kit.open(counter);
      kit.controller.run();
      kit.time.advance(100);
      const release = kit.block('revalidate');
      const loading = kit.controller.reload();
      await settle();
      const steps = kit.controller.engine.stepCount;
      kit.forgetEngineLog();
      kit.time.advance(1000);
      expect(kit.controller.engine.stepCount).toBe(steps);
      expect(kit.engineCalls()).toEqual([]);
      release();
      await loading;
      expect(kit.controller.phase).toBe('idle');
      expect(register(Reg.D0)).toBe(0);
      kit.time.advance(100);
      expect(register(Reg.D0)).toBe(0); // loaded, not running
    });

    it('a load that waits in a delay does not leave a delay timer behind', async () => {
      await start();
      const delayed = await assembleProgram([
        '        ORG     $1000',
        'START:  MOVE.L  #500,D1',
        '        MOVEQ   #23,D0',
        '        TRAP    #15',
        '        MOVEQ   #1,D5',
        '        SIMHALT',
        '        END     START',
      ]);
      await kit.open(delayed);
      kit.controller.run();
      expect(kit.controller.phase).toBe('waitDelay');
      await kit.controller.reload();
      kit.forgetEngineLog();
      kit.time.advance(10_000);
      expect(kit.engineCalls()).toEqual([]);
      expect(register(Reg.D5)).toBe(0);
    });

    it('a host part that fails does not leave the simulator locked in loading', async () => {
      await start();
      await kit.put(KIT_PROGRAM_PATH, counter);
      const original = kit.vfs.resolve.bind(kit.vfs);
      kit.vfs.resolve = () => Promise.reject(new Error('storage is gone'));
      await kit.controller.open(KIT_PROGRAM_PATH, 'open');
      kit.vfs.resolve = original;
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.program?.hasListing).toBe(false); // loaded without its listing
    });
  });

  describe('cold start: process-start state (4.7.1)', () => {
    it('start() after dispose() neither listens to frames nor creates an engine', async () => {
      let frameListeners = 0;
      const time = new VirtualTime();
      await start({
        start: false,
        clock: time,
        scheduler: {
          onFrame(fn) {
            frameListeners++;
            const stop = time.onFrame(fn);
            return () => {
              frameListeners--;
              stop();
            };
          },
          setTimer: (delayMs, fn) => time.setTimer(delayMs, fn),
        },
      });
      kit.controller.dispose();
      await kit.controller.start();
      expect(frameListeners).toBe(0);
      expect(kit.created).toBe(0);
      expect(kit.events).not.toContain('reset');
    });

    const fresh = { rom: { enabled: false, start: 0, end: 0 }, size: [640, 480], pen: [0, 0] };

    /** Runs `leavesState` to its halt and checks that it left the state behind. */
    const leaveState = async (output: ReturnType<typeof outputDouble>) => {
      await kit.open(leavesState);
      kit.controller.run();
      kit.time.advance(16);
      expect(kit.controller.snapshot.halted).toBe(true);
      expect(kit.controller.engine.hardware().map[MapKind.Rom]).toEqual({ enabled: true, start: 0x2000, end: 0x2fff });
      expect(output.state).toEqual({ width: 800, height: 600, pen: [100, 120] });
    };
    /** Loads `observes` with the given origin, runs it and returns what it saw. */
    const observe = async (origin: 'open' | 'reload' | 'drop' | 'execute') => {
      await kit.put(KIT_PROGRAM_PATH, observes);
      if (origin === 'reload') await kit.controller.reload();
      else await kit.controller.open(KIT_PROGRAM_PATH, origin);
      kit.controller.run();
      kit.time.advance(16);
      expect(kit.controller.snapshot.halted).toBe(true);
      return {
        stored: register(Reg.D5) & 0xff,
        size: register(Reg.D6),
        pen: [register(Reg.D7) & 0xffff, register(Reg.D4) & 0xffff],
      };
    };
    const withOutput = async () => {
      const output = outputDouble();
      await start({ parts: { text: output.text, graphics: output.graphics }, onReset: () => output.resetToStartup() });
      return output;
    };

    it('Execute after a program that enabled a ROM range, set the size to 800x600 and moved the pen gives the results of a fresh simulator', async () => {
      const output = await withOutput();
      await leaveState(output);
      const seen = await observe('execute');
      expect(seen.stored).toBe(0x5a); // a write to the former ROM range is stored
      expect(seen.size).toBe(0x028001e0); // task 33: 640 x 480
      expect(seen.pen).toEqual([0, 0]); // task 96
      expect(kit.controller.engine.hardware().map[MapKind.Rom]).toEqual(fresh.rom);
    });

    for (const origin of ['open', 'reload', 'drop'] as const) {
      it(`${origin} keeps that state`, async () => {
        const output = await withOutput();
        await leaveState(output);
        const seen = await observe(origin);
        expect(seen.stored).toBe(0xff); // the write is still ignored: memory holds the fill byte
        expect(seen.size).toBe(0x03200258); // 800 x 600
        expect(seen.pen).toEqual([100, 120]);
        expect(kit.created).toBe(1);
      });
    }

    it('coldStart(): start-up state without a program, a new engine, listeners told', async () => {
      const output = await withOutput();
      await leaveState(output);
      const old = kit.controller.engine;
      let replaced = 0;
      kit.controller.onEngineReplaced(() => replaced++);
      await kit.controller.coldStart();
      expect(replaced).toBe(1);
      expect(kit.controller.engine).not.toBe(old);
      expect(() => old.state()).toThrow(/released/);
      expect(kit.controller.program).toBeNull();
      expect(kit.controller.phase).toBe('idle');
      expect(kit.messages()).toEqual([]);
      expect(kit.listingRows).toEqual([]);
      expect(output.state).toEqual({ width: 640, height: 480, pen: [0, 0] });
      expect(kit.controller.snapshot.boxes[Box.PC]).toBe('00000000');
      expect(kit.controller.snapshot.halted).toBe(false);
      expect(kit.bridge.state.menuState).toBe(0);
      expect(kit.bridge.state.caption).toBeNull();
    });

    it('releases the old engine before it creates the new one', async () => {
      await start();
      await kit.open(counter);
      markHere();
      await kit.controller.coldStart();
      const events = sinceMark();
      expect(events.indexOf('engine.release')).toBeLessThan(events.indexOf('engine.create'));
      expect(events.indexOf('exit')).toBeLessThan(events.indexOf('engine.release'));
    });

    it('empties the queue and cancels the timers of the old simulator', async () => {
      await start();
      await kit.open(counter);
      kit.controller.autoTrace();
      kit.controller.pause(); // (so that the cold start below is not refused by a running state)
      kit.controller.autoTrace();
      const release = kit.block('exit');
      const starting = kit.controller.coldStart();
      kit.controller.post({ kind: 'irq', level: 1 }); // posted to the old simulator
      await settle();
      release();
      await starting;
      kit.forgetEngineLog();
      kit.time.advance(2000);
      expect(kit.engineCalls()).toEqual([]);
      expect(kit.bridge.state.autoTrace).toBe(false);
    });

    it('applies the saved settings to the new engine', async () => {
      await start({ applySettings: (engine) => engine.setOption(SimOption.Exceptions, true) });
      expect(kit.controller.engine.getOption(SimOption.Exceptions)).toBe(1);
      await kit.open(counter);
      await kit.controller.coldStart();
      expect(kit.controller.engine.getOption(SimOption.Exceptions)).toBe(1);
    });

    it('host callbacks during engine creation are harmless', async () => {
      await start();
      await kit.open(counter);
      kit.controller.run();
      kit.time.advance(50);
      kit.controller.pause();
      const release = kit.block('create');
      const starting = kit.controller.coldStart();
      await settle();
      // The old engine is released and the new one does not exist yet.
      expect(kit.events.at(-1)).toBe('engine.create');
      kit.calls.length = 0;
      const { controller, host } = kit;
      // Reads answer with start-up values instead of touching an engine that is not there.
      expect(controller.engine.state().runMode).toBe(false);
      expect(controller.engine.boxText(Box.PC)).toBe('00000000');
      expect(controller.engine.memory[0x1000]).toBe(0xff);
      // Host methods as the start-up reset calls them, and some it does not: none looks at the engine.
      host.clear();
      host.setWindowSize(0, 0);
      host.registersShown();
      host.repaint(15);
      host.menuState(1);
      host.hardwareState(true, true);
      host.fontAssign(1, 101);
      host.keyCommands(false);
      host.memoryLivePaint(0x1000);
      host.message(bytesOf('early line'));
      host.autoTraceTimer(true);
      expect(host.timeCentiseconds()).toBeGreaterThanOrEqual(0);
      kit.time.advance(1000); // frames and the auto-trace timer meanwhile
      controller.post({ kind: 'ioActivated' });
      expect(controller.phase).toBe('loading');
      const logged = kit.engineLog.length;

      release();
      await starting;
      // The engine's own start-up calls arrived while it was created (27 of them, 3.3.2).
      const startup = kit.calls.map((call) => call.method);
      for (const method of ['clear', 'setWindowSize', 'registersShown', 'hardwareState', 'fontAssign', 'keyCommands']) {
        expect(startup).toContain(method);
      }
      expect(controller.phase).toBe('idle');
      expect(kit.events.filter((event) => event.startsWith('report:'))).toEqual([]);
      // The state is that of the new engine, whatever was reported meanwhile.
      expect(controller.snapshot.boxes[Box.PC]).toBe('00000000');
      expect(kit.bridge.state.menuState).toBe(0);
      expect(kit.bridge.state.keyCommands).toBe(true);
      expect(kit.bridge.state.autoTrace).toBe(true); // what the test itself switched on stays on
      expect(kit.messages()).toEqual(['early line']);
      // What was posted meanwhile is delivered to the new engine.
      kit.time.advance(0);
      expect(kit.engineLog.slice(logged).some((entry) => entry.endsWith('.ioActivated'))).toBe(true);
    });

    it('when no engine can be created: the reason is in the message area, and the next start works', async () => {
      let fail = true;
      const engines = ENV.engines;
      const flaky: KitEnv = {
        ...ENV,
        engines: {
          create: (host) =>
            fail
              ? Promise.reject(new Error('The simulator engine could not be loaded: offline'))
              : engines.create(host),
          release: (engine) => engines.release(engine),
        },
      };
      kit = await createKit(flaky);
      expect(kit.controller.phase).toBe('idle');
      expect(kit.messages()).toEqual(['The simulator engine could not be loaded: offline']);
      // Commands do nothing harmful on the stand-in.
      kit.controller.run();
      kit.controller.traceInto();
      kit.time.advance(100);
      expect(kit.controller.phase).toBe('idle');
      expect(kit.controller.snapshot.boxes[Box.SS]).toBe('01000000');

      fail = false;
      await kit.open(halting, 'execute');
      kit.controller.run();
      kit.time.advance(16);
      expect(register(Reg.D5)).toBe(7);
    });
  });
});
