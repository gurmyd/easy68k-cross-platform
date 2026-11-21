// The Registers, Listing and Messages panels' model on SH8's REAL simulator session and run
// controller (features/run/session.ts, core/run/), with the run feature in the same application,
// the real engine, the real ListingView and virtual time; only the devices of other packages are
// doubles (core/run/test-kit.ts). model.test.ts tests the same rules on this feature's session
// double; this file shows that they hold against the real parts (gate I1).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Box, Reg, SimOption, type MessageBoxRequest, type SimSessionEnv } from '../../contracts';
import { VirtualTime } from '../../core/run/clock';
import { BLANK_GLYPHS } from '../../core/run/headless';
import { createDeviceDoubles } from '../../core/run/test-kit';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, type AssembledProgram } from '../../engine/testing';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { MESSAGE_DIALOG_ID } from '../../state/dialogs';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature as runFeature } from '../run/index';
import { createSimSession, runSessionOf, type RunSession } from '../run/session';
import { feature } from './index';
import { simMainOf, type SimMainModel } from './model';

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
const DIR = '/browser/demo';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ENGINES: SimSessionEnv = {
  engines: { create: createSimEngine, release: releaseSimEngine },
  createCachedSyncFiles: () => new MemorySyncFiles(),
};

const SOURCE = [
  '    ORG $1000',
  'START:',
  '    MOVE.L #5,D1', // $1000
  '    ADD.L D0,D1', // $1002
  '    MOVEA.L #$2000,A0', // $1004
  'LOOP:',
  '    BRA.S LOOP', // $100A
  '    SIMHALT', // $100C
  '    END START',
];

describe.skipIf(!enginesBuilt)(
  "the panels' model on the real session and run controller (needs engine/dist)",
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let programs: Record<'demo' | 'nops' | 'loop', AssembledProgram>;
    let app: TestApplication;
    let time: VirtualTime;
    let session: RunSession;
    let model: SimMainModel;

    beforeAll(async () => {
      const nops = ['    ORG $1000', 'START:'];
      for (let index = 0; index < 101; index++) nops.push('    NOP');
      nops.push('    SIMHALT', '    END START');
      programs = {
        demo: await assembleProgram(SOURCE),
        nops: await assembleProgram(nops),
        loop: await assembleProgram(['    ORG $1000', 'START:', '    NOP', '    BRA.S START', '    END START']),
      };
    }, 120_000);

    afterEach(() => app?.dispose());

    async function start() {
      time = new VirtualTime();
      // Every device double except the listing: the real ListingView is part of what is tested.
      const { parts } = createDeviceDoubles();
      delete (parts as Partial<typeof parts>).listing;
      app = createTestApplication({
        clock: time,
        scheduler: time,
        session: ENGINES,
        features: [runFeature, feature],
        services: {
          createSimSession: (ctx, env) => createSimSession(ctx, env, { parts, glyphs: BLANK_GLYPHS }),
        },
      });
      session = runSessionOf(app.ctx.sim) as RunSession;
      for (const [name, program] of Object.entries(programs)) {
        await app.ctx.vfs.writeFile(`${DIR}/${name}.S68`, program.s68);
        await app.ctx.vfs.writeFile(`${DIR}/${name}.L68`, program.l68);
      }
      await session.start();
      await app.ctx.commands.run('app.mode.set', 'simulator');
      model = simMainOf(app.ctx);
    }

    const open = (name: keyof typeof programs) => app.ctx.sim.controller.open(`${DIR}/${name}.S68`, 'open');
    const selected = () => app.ctx.store.getState().sim.selectedRow;
    const rowOf = (text: string) => app.ctx.sim.listing.find(text, 0);
    const boxes = () =>
      app.ctx.store
        .getState()
        .dialogs.stack.filter((dialog) => dialog.id === MESSAGE_DIALOG_ID)
        .map((dialog) => dialog.props as MessageBoxRequest);

    it('a load: the rows, the snapshot and the start row selected', async () => {
      await start();
      await open('demo');
      const view = model.view.getState();
      expect(view.rows).toBe(app.ctx.sim.listing.rows);
      expect(view.rows.length).toBeGreaterThan(8);
      expect(view.boxes[Box.PC]).toBe('00001000');
      expect(selected()).toBe(rowOf('MOVE.L #5'));
      expect(view.scroll?.row).toBe(rowOf('MOVE.L #5'));
    });

    it('Trace Into follows the PC, also back from a clicked row on a branch to itself', async () => {
      await start();
      await open('demo');
      for (let step = 0; step < 3; step++) await app.ctx.commands.run('sim.run.traceInto');
      const bra = rowOf('BRA.S');
      expect(selected()).toBe(bra);
      expect(model.view.getState().boxes[Box.D1]).toBe('00000005');
      model.selectRow(4);
      await app.ctx.commands.run('sim.run.traceInto'); // BRA.S LOOP: the PC row stays the same
      expect(app.ctx.sim.controller.snapshot.highlight).toBe(bra);
      expect(selected()).toBe(bra);
    });

    it('Run To Cursor runs to the row the user selected', async () => {
      await start();
      await open('demo');
      model.selectRow(rowOf('MOVEA.L'));
      await app.ctx.commands.run('sim.run.runToCursor');
      time.advance(100);
      expect(app.ctx.store.getState().sim.phase).toBe('idle');
      expect(model.view.getState().boxes[Box.PC]).toBe('00001004');
      expect(selected()).toBe(rowOf('MOVEA.L'));
    });

    it('register edits: D0 is used by the next Trace Into, D2 is discarded by Rewind', async () => {
      await start();
      await open('demo');
      model.editRegister(Box.D0, '00000007');
      model.editRegister(Box.D2, '0000ABCD');
      expect(model.view.getState().boxes[Box.D2]).toBe('0000ABCD');
      await app.ctx.commands.run('sim.run.traceInto');
      await app.ctx.commands.run('sim.run.traceInto');
      expect(model.view.getState().boxes[Box.D1]).toBe('0000000C');
      await app.ctx.commands.run('sim.run.rewind');
      expect(model.view.getState().boxes[Box.D2]).toBe('00000000');
      expect(app.ctx.sim.engine.getRegister(Reg.D2)).toBe(0);
    });

    it('the gutter: a toggle reaches the engine and the store, Clear All removes them', async () => {
      await start();
      await open('demo');
      model.toggleBreakpoint(rowOf('ADD.L'));
      expect(app.ctx.sim.engine.breakpoints()).toEqual([0x1002]);
      expect([...model.view.getState().breakpoints]).toEqual([0x1002]);
      expect(app.ctx.store.getState().sim.breakpoints).toEqual([0x1002]);
      await app.ctx.commands.run('sim.run.run');
      time.advance(100);
      expect(model.view.getState().boxes[Box.PC]).toBe('00001002');
      expect(selected()).toBe(rowOf('ADD.L'));
      await app.ctx.commands.run('sim.bp.clearAllPC');
      expect(app.ctx.sim.engine.breakpoints()).toEqual([]);
      expect(model.view.getState().breakpoints.size).toBe(0);
    });

    it('the 101st breakpoint: the run feature shows the box `Breakpoint Limit Reached!`', async () => {
      await start();
      await open('nops');
      const listing = app.ctx.sim.listing;
      const rows = listing.rows.map((_text, row) => row).filter((row) => row > 2 && listing.isInstruction(row));
      expect(rows.length).toBe(102);
      for (const row of rows.slice(0, 100)) model.toggleBreakpoint(row);
      expect(app.ctx.sim.engine.breakpoints()).toHaveLength(100);
      expect(boxes()).toEqual([]);
      model.toggleBreakpoint(rows[100] as number);
      await settle();
      expect(boxes()).toEqual([{ title: 'Error', text: 'Breakpoint Limit Reached!', icon: 'none', buttons: ['OK'] }]);
      expect(app.ctx.sim.engine.breakpoints()).toHaveLength(100);
      expect(model.view.getState().breakpoints.size).toBe(100);
    });

    it('Auto Trace with `Disable display update`: the listing does not follow; Pause brings the PC row back', async () => {
      await start();
      await open('loop');
      const top = rowOf('NOP');
      expect(selected()).toBe(top);
      app.ctx.sim.controller.invoke((engine) => engine.setOption(SimOption.DisableDisplay, 1));
      model.selectRow(1);
      await app.ctx.commands.run('sim.run.autoTrace');
      // NOP and BRA.S alternate: the PC comes back to the engine's (stale) row again and again,
      // but the engine skips highlight() in these scrshow() calls, so the selection stays.
      let atTop = 0;
      for (let tick = 0; tick < 40; tick++) {
        time.advance(50);
        if (app.ctx.sim.controller.snapshot.boxes[Box.PC] === '00001000') atTop++;
        expect(selected()).toBe(1);
      }
      expect(app.ctx.store.getState().sim.autoTrace).toBe(true);
      expect(atTop).toBeGreaterThan(0);
      expect(app.ctx.sim.controller.snapshot.highlight).toBe(top);
      await app.ctx.commands.run('sim.run.pause');
      // Pause ends the Auto Trace; its scrshow() runs highlight() and the listing follows again.
      expect([top, rowOf('BRA.S')]).toContain(selected());
    });

    it('Auto Trace with the display on follows the PC', async () => {
      await start();
      await open('demo');
      model.selectRow(1);
      await app.ctx.commands.run('sim.run.autoTrace');
      time.advance(2_000);
      expect(selected()).toBe(rowOf('BRA.S'));
      model.selectRow(1);
      time.advance(1_000);
      expect(selected()).toBe(rowOf('BRA.S'));
      await app.ctx.commands.run('sim.run.pause');
    });

    it('Clear Cycles shows 0 and leaves a clicked row selected', async () => {
      await start();
      await open('demo');
      await app.ctx.commands.run('sim.run.traceInto');
      expect(model.view.getState().cycles).not.toBe('0');
      model.selectRow(1);
      await app.ctx.commands.run('sim.cycles.clear');
      expect(model.view.getState().cycles).toBe('0');
      expect(app.ctx.sim.engine.cycles).toBe(0n);
      expect(selected()).toBe(1);
    });

    it('Close and a cold start: the panels follow the new rows and the selection is cleared', async () => {
      await start();
      await open('demo');
      model.toggleBreakpoint(rowOf('ADD.L'));
      model.selectRow(6);
      // File > Close asks the Caution question first (the run feature's box).
      const closing = app.ctx.commands.run('sim.file.close');
      await settle();
      const caution = app.ctx.store.getState().dialogs.stack.find((dialog) => dialog.id === MESSAGE_DIALOG_ID);
      expect(caution).toBeDefined();
      app.dialogs.close(caution!.key, 'OK');
      await closing;
      expect(app.ctx.sim.engine.listingLineCount).toBe(0);
      expect(model.view.getState().rows).toBe(app.ctx.sim.listing.rows);
      expect(model.view.getState().rows).toEqual([]);
      expect(selected()).toBe(-1); // no stale selection over an empty listing
      expect(model.view.getState().breakpoints.size).toBe(app.ctx.sim.engine.breakpoints().length);

      await open('demo');
      // The engine's row. It is -1: Close emptied the list box but kept the PC field at 00001000,
      // so the load does not change that field and no highlight() runs over the new rows (the
      // original's code path, traced in errata U1.md entry 8).
      expect(app.ctx.sim.controller.snapshot.highlight).toBe(app.ctx.sim.engine.listingHighlight);
      expect(app.ctx.sim.engine.listingHighlight).toBe(-1);
      expect(selected()).toBe(-1);
      model.toggleBreakpoint(rowOf('ADD.L'));
      model.selectRow(6);
      // Execute: a cold start (4.7.1) with a new engine, then the load.
      const first = app.ctx.sim.engine;
      let replaced = 0;
      app.ctx.sim.onEngineReplaced(() => replaced++);
      await app.ctx.sim.controller.open(`${DIR}/demo.S68`, 'execute');
      expect(replaced).toBe(1);
      expect(app.ctx.sim.engine).not.toBe(first);
      const view = model.view.getState();
      expect(view.rows).toBe(app.ctx.sim.listing.rows);
      expect(view.breakpoints.size).toBe(0);
      expect(view.boxes[Box.PC]).toBe('00001000');
      expect(selected()).toBe(rowOf('MOVE.L #5'));
    });

    it('Open of the same program again without Close: the panel follows the engine row', async () => {
      await start();
      await open('demo');
      model.selectRow(1);
      await open('demo');
      // The panel shows the engine's row and no stale click survives the new rows.
      expect(selected()).toBe(app.ctx.sim.engine.listingHighlight);
      expect(selected()).not.toBe(1);
      // OpenFile's ListBox1->Items->Clear() drops the selection, as the VCL's LB_RESETCONTENT does,
      // and the unchanged PC text runs no highlight(): nothing is selected (errata U1.md entry 8,
      // docs/requests/U1-listbox-clear-itemindex.md; the port kept row 6 before the shim change).
      expect(app.ctx.sim.engine.listingHighlight).toBe(-1);
      expect(selected()).toBe(-1);
      // Go to PC selects the PC row (highlight() over the loaded rows), and so does the next stop.
      await app.ctx.commands.run('sim.search.gotoPC');
      expect(selected()).toBe(rowOf('MOVE.L #5'));
      model.selectRow(1);
      await app.ctx.commands.run('sim.run.traceInto');
      expect(selected()).toBe(rowOf('ADD.L'));
    });

    it('a program opened over one whose PC moved: the PC field changes, so its start row is selected', async () => {
      await start();
      await open('demo');
      for (let step = 0; step < 3; step++) await app.ctx.commands.run('sim.run.traceInto');
      expect(model.view.getState().boxes[Box.PC]).toBe('0000100A');
      await open('nops');
      // regPCChange runs for the new text 00001000 and its highlight() finds the first NOP.
      expect(app.ctx.sim.engine.listingHighlight).toBe(rowOf('NOP'));
      expect(selected()).toBe(rowOf('NOP'));
      expect(model.view.getState().scroll?.row).toBe(rowOf('NOP'));
      // Opened again with the PC still at 00001000: no row (the case above, with another program).
      await open('demo');
      expect(app.ctx.sim.engine.listingHighlight).toBe(-1);
      expect(selected()).toBe(-1);
    });

    it('the message area: load messages and trace lines arrive through the store', async () => {
      await start();
      await open('demo');
      expect(app.ctx.store.getState().sim.messageLines).toContain('.S68 file read successful');
      await app.ctx.commands.run('sim.run.traceInto');
      expect(app.ctx.store.getState().sim.messageLines.at(-1)).toMatch(/^PC=00001000 {2}Code=7205/);
    });
  },
);
