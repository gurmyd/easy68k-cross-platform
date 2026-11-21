// The command table of ARCHITECTURE.md 4.8, with the real engine and virtual time.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Box, Reg, SimOption } from '../../contracts';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, createRecordingHost, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { INVALID_RUN_TO_CURSOR, NO_VALID_ADDRESS } from './controller';
import { KIT_PROGRAM_PATH, createKit, type Kit, type KitEnv, type KitOptions } from './test-kit';

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

describe.skipIf(!enginesBuilt)('the commands of 4.8 (needs engine/dist)', { timeout: ENGINE_TEST_TIMEOUT }, () => {
  let counter: AssembledProgram;
  let calls: AssembledProgram;
  let halting: AssembledProgram;
  let kit: Kit;

  const start = async (options?: KitOptions) => (kit = await createKit(ENV, options));

  beforeAll(async () => {
    // Counts in D0 for ever.
    counter = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #0,D0',
      'LOOP:   ADDQ.L  #1,D0',
      '        BRA     LOOP',
      '        END     START',
    ]);
    // A subroutine call, for Step Over and Run To Cursor.
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
      'VALUE:  DC.L    5',
      '        END     START',
    ]);
    halting = await assembleProgram([
      '        ORG     $1000',
      'START:  MOVEQ   #7,D0',
      '        SIMHALT',
      '        END     START',
    ]);
  }, LONG);

  afterEach(() => kit?.dispose());

  it('starts in process-start state, idle, with every run command available', async () => {
    await start();
    const { controller } = kit;
    expect(controller.phase).toBe('idle');
    expect(controller.program).toBeNull();
    expect(controller.held).toBe(false);
    expect(controller.alerts).toEqual([]);
    expect(controller.snapshot.boxes[Box.SS]).toBe('01000000');
    expect(controller.snapshot.boxes[Box.SR]).toBe('0010000000000000');
    expect(controller.snapshot.halted).toBe(false);
    expect(kit.bridge.state.menuState).toBe(0);
    expect(kit.events).toEqual(['exit', 'reset', 'engine.create', 'apply', 'listing.refresh']);
  });

  it('Run: cmdRun, audio resumed, running, and a tick at once', async () => {
    await start();
    await kit.open(counter);
    kit.forgetEngineLog();
    kit.calls.length = 0;
    kit.controller.run();
    expect(kit.engineCalls().slice(0, 2)).toEqual(['cmdRun', 'run']);
    expect(kit.events).toContain('audio');
    expect(kit.calls.map((call) => call.method)).toContain('ioBringToFront');
    expect(kit.controller.phase).toBe('running');
    // The first sub-slice executed in the command itself.
    expect(kit.controller.engine.getRegister(Reg.D0)).toBeGreaterThan(0);
    expect(kit.bridge.state.menuState).toBe(1);
  });

  it('Run revalidates the program files first when the window has had the focus elsewhere', async () => {
    await start();
    await kit.open(counter);
    kit.controller.markFilesStale();
    const release = kit.block('revalidate');
    kit.forgetEngineLog();
    kit.controller.run();
    expect(kit.controller.phase).toBe('loading');
    expect(kit.events.at(-1)).toBe('revalidate');
    kit.time.advance(100);
    expect(kit.engineCalls()).toEqual([]);
    release();
    await settle();
    expect(kit.controller.phase).toBe('running');
    expect(kit.engineCalls().slice(0, 2)).toEqual(['cmdRun', 'run']);
    // Only once: the next Run does not ask again.
    kit.controller.pause();
    kit.events.length = 0;
    kit.controller.run();
    expect(kit.events).not.toContain('revalidate');
  });

  it('Run To Cursor runs to a valid instruction row', async () => {
    await start();
    await kit.open(calls);
    const row = kit.row('MOVEQ   #3,D3');
    expect(row).toBeGreaterThan(2);
    kit.forgetEngineLog();
    kit.controller.runToCursor(row);
    expect(kit.engineCalls()[0]).toBe('cmdRunToCursor');
    kit.time.advance(100);
    expect(kit.controller.phase).toBe('idle');
    const engine = kit.controller.engine;
    expect(engine.getRegister(Reg.D2)).toBe(3); // the subroutine ran
    expect(engine.getRegister(Reg.D3)).toBe(0); // the row itself has not executed
    expect(kit.controller.snapshot.highlight).toBe(row);
    expect(kit.controller.alerts).toEqual([]);
  });

  it('Run To Cursor on a row without an address shows the box and does NOT run (note 23)', async () => {
    await start();
    await kit.open(calls);
    for (const [row, text] of [
      [kit.row('VALUE:'), NO_VALID_ADDRESS], // a DC line
      [0, NO_VALID_ADDRESS], // the header row would pass the instruction test
      [2, NO_VALID_ADDRESS],
      [99_999, NO_VALID_ADDRESS],
      [-1, INVALID_RUN_TO_CURSOR],
    ] as const) {
      kit.forgetEngineLog();
      kit.controller.runToCursor(row);
      expect(kit.controller.alerts, `row ${row}`).toEqual([{ title: 'Error', text }]);
      expect(kit.engineCalls(), `row ${row}`).toEqual([]);
      expect(kit.controller.phase).toBe('idle');
      kit.time.advance(50);
      expect(kit.controller.engine.getRegister(Reg.D1)).toBe(0);
      kit.controller.dismissAlerts();
      expect(kit.controller.alerts).toEqual([]);
      // The box was the port's own: the engine is not told about it.
      expect(kit.engineCalls()).toEqual([]);
    }
  });

  it('Step Over executes one instruction, or a whole subroutine', async () => {
    await start();
    await kit.open(calls);
    kit.forgetEngineLog();
    kit.controller.stepOver(); // MOVEQ #1,D1
    expect(kit.engineCalls().slice(0, 2)).toEqual(['cmdStepOver', 'run']);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.engine.getRegister(Reg.D1)).toBe(1);
    kit.controller.stepOver(); // BSR SUB: the subroutine runs at full speed
    kit.time.advance(50);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.engine.getRegister(Reg.D2)).toBe(3);
    expect(kit.controller.engine.getRegister(Reg.D3)).toBe(0);
    expect(kit.controller.snapshot.highlight).toBe(kit.row('MOVEQ   #3,D3'));
  });

  it('Trace Into executes exactly one instruction and refreshes the snapshot', async () => {
    await start();
    await kit.open(calls);
    const before = kit.controller.snapshot.revision;
    kit.forgetEngineLog();
    kit.controller.traceInto();
    expect(kit.engineCalls()).toContain('cmdTraceInto');
    expect(kit.engineCalls()).not.toContain('run');
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.snapshot.revision).toBeGreaterThan(before);
    expect(kit.controller.snapshot.boxes[Box.D1]).toBe('00000001');
    kit.controller.traceInto(); // BSR: entered, not stepped over
    expect(kit.controller.snapshot.highlight).toBe(kit.row('SUB:'));
    expect(kit.messages().at(-1)).toMatch(/^PC=\w{8} {2}Code=\w{4} {2}BSR/);
    expect(kit.events).toContain('focusMain');
  });

  it('Auto Trace: the engine switches the timer on, each tick traces one instruction', async () => {
    await start();
    await kit.open(counter);
    kit.forgetEngineLog();
    kit.controller.autoTrace();
    expect(kit.engineCalls()).toEqual(['cmdAutoTrace']);
    expect(kit.bridge.state.autoTrace).toBe(true);
    expect(kit.bridge.state.menuState).toBe(0); // until the first tick (sim-ui §9.7)
    kit.time.advance(199);
    expect(kit.engineCalls()).toEqual(['cmdAutoTrace']);
    kit.time.advance(900); // ticks are checked once per frame: about one per 208 ms
    const ticks = kit.engineCalls().filter((name) => name === 'autoTraceTick').length;
    expect(ticks).toBeGreaterThanOrEqual(4);
    expect(ticks).toBeLessThanOrEqual(5);
    expect(kit.messages().filter((line) => line.startsWith('PC='))).toHaveLength(ticks);
    expect(kit.bridge.state.menuState).toBe(1);
    expect(kit.controller.phase).toBe('idle');
  });

  it('Auto Trace uses the interval of the settings at the moment it starts', async () => {
    await start();
    await kit.open(counter);
    kit.autoTraceIntervalMs = 50;
    kit.controller.autoTrace();
    kit.forgetEngineLog();
    kit.time.advance(500);
    const ticks = kit.engineCalls().filter((name) => name === 'autoTraceTick').length;
    expect(ticks).toBeGreaterThanOrEqual(7); // every 64 ms at a 16 ms frame
    expect(ticks).toBeLessThanOrEqual(10);
  });

  it('Pause stops a run, and during Auto Trace forces the commands active (note 24)', async () => {
    await start();
    await kit.open(counter);
    kit.controller.run();
    kit.time.advance(100);
    kit.forgetEngineLog();
    kit.controller.pause();
    expect(kit.engineCalls()[0]).toBe('cmdPause');
    expect(kit.controller.phase).toBe('idle');
    expect(kit.bridge.state.menuState).toBe(0);
    const count = kit.controller.engine.getRegister(Reg.D0);
    kit.time.advance(100);
    expect(kit.controller.engine.getRegister(Reg.D0)).toBe(count);
    expect(kit.controller.snapshot.boxes[Box.D0]).toBe(count.toString(16).toUpperCase().padStart(8, '0'));

    kit.controller.autoTrace();
    kit.time.advance(500);
    expect(kit.bridge.state.menuState).toBe(1);
    kit.controller.pause();
    // The engine, like the original, would leave the commands busy here.
    expect(kit.controller.engine.state().menuState).toBe(1);
    expect(kit.bridge.state.menuState).toBe(0);
    expect(kit.bridge.state.autoTrace).toBe(false);
    kit.forgetEngineLog();
    kit.time.advance(1000);
    expect(kit.engineCalls()).not.toContain('autoTraceTick');
    kit.controller.run();
    expect(kit.controller.phase).toBe('running');
  });

  it('Rewind resets the registers and goes back to the start address', async () => {
    await start();
    await kit.open(counter);
    kit.controller.run();
    kit.time.advance(100);
    kit.forgetEngineLog();
    kit.controller.rewind();
    expect(kit.engineCalls()[0]).toBe('rewind');
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.snapshot.boxes[Box.D0]).toBe('00000000');
    expect(kit.controller.snapshot.boxes[Box.PC]).toBe('00001000');
    expect(kit.bridge.state.menuState).toBe(0);
    kit.time.advance(100);
    expect(kit.controller.engine.getRegister(Reg.D0)).toBe(0);
  });

  it('Reload is open(program.path, "reload"); without a program it does nothing', async () => {
    await start();
    await kit.controller.reload();
    expect(kit.engineCalls().filter((name) => name === 'load')).toEqual([]);
    await kit.open(counter);
    kit.controller.run();
    kit.time.advance(50);
    kit.events.length = 0;
    kit.forgetEngineLog();
    await kit.controller.reload();
    expect(kit.engineCalls()).toContain('load');
    expect(kit.events).toEqual(['revalidate', 'listing.refresh']); // no question, no cold start, no log names
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.program?.path).toBe(KIT_PROGRAM_PATH);
    expect(kit.controller.engine.getRegister(Reg.D0)).toBe(0);
  });

  it('Close asks the Caution question, closes on OK and keeps the program on Cancel', async () => {
    let answer = false;
    await start({ caution: () => answer });
    await kit.open(counter);
    kit.forgetEngineLog();
    kit.events.length = 0;
    await kit.controller.close();
    expect(kit.events).toEqual(['caution']);
    expect(kit.engineCalls()).toEqual([]);
    expect(kit.listingRows.length).toBeGreaterThan(3);

    answer = true;
    const before = kit.controller.snapshot;
    expect(before.highlight).toBeGreaterThan(2); // the start row of the program
    await kit.controller.close();
    expect(kit.engineCalls()).toContain('close');
    expect(kit.events).toEqual(['caution', 'caution', 'listing.refresh']);
    expect(kit.listingRows).toEqual([]);
    expect(kit.controller.phase).toBe('idle');
    // The simulator reset inside Close shows the registers: the snapshot is new, and with the
    // listing gone no row is the current one.
    expect(kit.controller.snapshot.revision).toBeGreaterThan(before.revision);
    expect(kit.controller.snapshot.highlight).toBe(-1);
    // The title is not reset and Reload still loads the last file (sim-ui §8.5).
    expect(kit.controller.program).toEqual({ path: KIT_PROGRAM_PATH, title: KIT_PROGRAM_PATH, hasListing: false });
  });

  it('Close holds a running program while the question is open', async () => {
    await start({ caution: () => false });
    await kit.open(counter);
    kit.controller.run();
    const release = kit.block('caution');
    const closing = kit.controller.close();
    await Promise.resolve();
    expect(kit.controller.held).toBe(true);
    const count = kit.controller.engine.getRegister(Reg.D0);
    kit.time.advance(200);
    expect(kit.controller.engine.getRegister(Reg.D0)).toBe(count);
    release();
    await closing;
    expect(kit.controller.held).toBe(false);
    kit.time.advance(32);
    expect(kit.controller.engine.getRegister(Reg.D0)).toBeGreaterThan(count); // Cancel: it runs on
  });

  it('Clear Cycles clears the counter and refreshes the field', async () => {
    await start();
    await kit.open(counter);
    kit.controller.traceInto();
    kit.controller.traceInto();
    expect(kit.controller.snapshot.cycles).toBeGreaterThan(0n);
    const revision = kit.controller.snapshot.revision;
    kit.forgetEngineLog();
    kit.controller.clearCycles();
    expect(kit.engineCalls()[0]).toBe('clearCycles');
    expect(kit.controller.snapshot.cycles).toBe(0n);
    expect(kit.controller.snapshot.revision).toBe(revision + 1);
  });

  it('editBox goes to the engine at once; the next run command uses the value', async () => {
    await start();
    await kit.open(counter);
    kit.controller.traceInto(); // MOVEQ #0,D0
    kit.controller.editBox(Box.D0, '00000100');
    expect(kit.controller.engine.boxText(Box.D0)).toBe('00000100');
    expect(kit.controller.engine.getRegister(Reg.D0)).toBe(0); // only the text, until a run command
    kit.controller.traceInto(); // ADDQ.L #1,D0
    expect(kit.controller.snapshot.boxes[Box.D0]).toBe('00000101');
  });

  it('pokeMemory writes directly and says "memory changed", not "repaint"', async () => {
    await start();
    await kit.open(counter);
    const view = kit.controller.viewRevision;
    const repaints = kit.controller.repaintCounts;
    const live = kit.controller.liveRevision;
    let published = 0;
    kit.controller.subscribe(() => published++);
    kit.controller.pokeMemory(0x2000, 0x1ab);
    expect(kit.controller.engine.readByte(0x2000)).toBe(0xab);
    // sim-ui §10.3, §11.4: the Memory, Stack and Hardware windows are redrawn, and the Stack
    // window is NOT re-centred, which a repaint would do.
    expect(kit.controller.liveRevision).toBe(live + 1);
    expect(kit.controller.viewRevision).toBe(view);
    expect(kit.controller.repaintCounts).toBe(repaints);
    expect(published).toBe(1);
  });

  it('counts the repaints of the engine by panel (4.6)', async () => {
    await start();
    const { controller } = kit;
    // The start-up reset of the engine showed the main window, the Memory and the Stack window.
    expect(controller.repaintCounts).toEqual({ listing: 1, breakpoints: 0, memory: 1, stack: 1 });
    expect(controller.viewRevision).toBe(1);
    await kit.open(counter); // a load also clears the Break Points window
    expect(controller.repaintCounts).toEqual({ listing: 2, breakpoints: 1, memory: 2, stack: 2 });
    controller.traceInto(); // scrshow(): listing, memory, stack
    expect(controller.repaintCounts).toEqual({ listing: 3, breakpoints: 1, memory: 3, stack: 3 });
    // A PC breakpoint set from the gutter repaints the listing only: a Stack panel the user has
    // scrolled is not re-centred by it.
    const before = controller.repaintCounts;
    controller.invoke((engine) => engine.setBreakpoint(0x1002));
    expect(controller.repaintCounts).toEqual({ listing: 4, breakpoints: 1, memory: 3, stack: 3 });
    expect(controller.repaintCounts).not.toBe(before); // a new object when a counter has moved
    expect(controller.viewRevision).toBe(4); // one more with every repaint, whichever panel it names
    // The Run command shows the display once; the free run then repaints nothing until it stops.
    controller.run();
    const running = controller.repaintCounts;
    expect(running).toEqual({ listing: 5, breakpoints: 1, memory: 4, stack: 4 });
    kit.time.advance(160);
    expect(controller.repaintCounts).toBe(running);
    controller.pause();
    expect(controller.repaintCounts).toEqual({ listing: 6, breakpoints: 1, memory: 5, stack: 5 });
  });

  it('after a halt the run commands do nothing until Pause or Rewind (O-12)', async () => {
    await start();
    await kit.open(halting);
    kit.controller.run();
    kit.time.advance(32);
    expect(kit.controller.phase).toBe('idle');
    expect(kit.controller.snapshot.halted).toBe(true);
    expect(kit.bridge.state.menuState).toBe(1);
    kit.forgetEngineLog();
    kit.controller.run();
    kit.controller.runToCursor(kit.row('MOVEQ'));
    kit.controller.stepOver();
    kit.controller.traceInto();
    kit.controller.autoTrace();
    expect(kit.engineCalls()).toEqual([]);
    expect(kit.controller.alerts).toEqual([]);
    kit.controller.pause();
    expect(kit.bridge.state.menuState).toBe(0);
    kit.controller.traceInto();
    expect(kit.engineCalls()).toContain('cmdTraceInto');
  });

  it('a stop writes the program files through and flushes the logs', async () => {
    await start();
    await kit.open(halting);
    kit.events.length = 0;
    kit.controller.run();
    kit.time.advance(32);
    expect(kit.events.filter((event) => event === 'stopped')).toHaveLength(1);
    kit.controller.pause();
    expect(kit.events.filter((event) => event === 'stopped')).toHaveLength(2);
  });

  it('tells its subscribers once per command and at most once per frame while running', async () => {
    await start();
    await kit.open(counter);
    let published = 0;
    kit.controller.subscribe(() => published++);
    kit.controller.run();
    expect(published).toBe(1);
    kit.time.advance(160); // ten frames of a free run: nothing the interface shows changes
    expect(published).toBe(1);
    kit.controller.pause();
    expect(published).toBe(2);
  });

  it('applies options through invoke at once when idle', async () => {
    await start();
    await kit.open(counter);
    kit.forgetEngineLog();
    kit.controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
    expect(kit.engineCalls()).toEqual(['setOption']);
    expect(kit.controller.engine.getOption(SimOption.Exceptions)).toBe(1);
  });
});
