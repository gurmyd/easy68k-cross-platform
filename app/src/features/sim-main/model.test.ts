// SimMainModel with the real engine (createTestEngine) under a session double that follows the
// SimSession contract (testing.ts): the register fields (3.11.3), the selection rule of 3.11.4,
// the gutter, Go to PC, Find, Clear Cycles and a cold start. Plus the same rules against a scripted
// controller where the real engine cannot produce the situation on demand.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Box, Reg, type AppContext, type FeatureModule, type RunSnapshot, type SimSession } from '../../contracts';
import { feature as memoryFeature } from '../memory/index';
import { memoryModelOf } from '../memory/model';
import { assembleProgram, createTestEngine, type AssembledProgram, type TestEngine } from '../../engine/testing';
import { encode } from '../../core/codec/cp1252';
import { ListingView } from '../../core/listing/view';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { shellStateOf } from '../../state/shell';
import { feature } from './index';
import { simMainOf, type SimMainModel } from './model';
import { createSessionDouble, type SessionDouble } from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

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

let program: AssembledProgram | null = null;
async function theProgram(): Promise<AssembledProgram> {
  program ??= await assembleProgram(SOURCE);
  return program;
}

interface Bench {
  app: TestApplication;
  ctx: AppContext;
  session: SessionDouble;
  model: SimMainModel;
  engines: TestEngine[];
}

const benches: Bench[] = [];
afterEach(() => {
  for (const bench of benches.splice(0)) {
    bench.app.dispose();
    for (const engine of bench.engines) engine.release();
  }
});

/** An application with this feature on a session double over a real engine, program loaded. */
async function realBench(load = true, others: FeatureModule[] = []): Promise<Bench> {
  const engines: TestEngine[] = [await createTestEngine()];
  let session: SessionDouble | null = null;
  const app = createTestApplication({
    features: [feature, ...others],
    services: {
      createSimSession: (ctx) => {
        session = createSessionDouble(ctx, engines[0] as TestEngine, async () => {
          const next = await createTestEngine();
          engines.push(next);
          return next;
        });
        return session;
      },
    },
  });
  if (!session) throw new Error('no session');
  const bench: Bench = { app, ctx: app.ctx, session, model: simMainOf(app.ctx), engines };
  benches.push(bench);
  if (load) {
    const { s68, l68 } = await theProgram();
    (session as SessionDouble).controller.loadBytes('/browser/demo/program.S68', s68, l68);
  }
  return bench;
}

const selected = (bench: Pick<Bench, 'ctx'>) => bench.ctx.store.getState().sim.selectedRow;
const rowOf = (bench: Bench, text: string) => bench.session.listing.find(text, 0);

describe.runIf(enginesRequired && !enginesBuilt)('engine/dist (EASY68K_REQUIRE_ENGINES=1)', () => {
  it('holds both engines', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist does not hold both engines');
  });
});

describe.skipIf(!enginesBuilt)('with the real engine (needs engine/dist)', () => {
  it('after a load the panels show the snapshot, the rows, and the start row selected', async () => {
    const bench = await realBench();
    const view = bench.model.view.getState();
    expect(view.rows).toBe(bench.session.listing.rows);
    expect(view.boxes[Box.PC]).toBe('00001000');
    expect(view.boxes[Box.SR]).toBe('0010000000000000');
    expect(view.cycles).toBe('0');
    const move = rowOf(bench, 'MOVE.L #5');
    expect(selected(bench)).toBe(move);
    expect(view.scroll?.row).toBe(move);
  }, 60_000);

  it('an edit of D0 is forwarded at once, used by the next Trace Into, and all boxes are re-read', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    model.editRegister(Box.D0, '00000007');
    expect(session.controller.log).toContain('editBox 0 00000007');
    expect(model.view.getState().boxes[Box.D0]).toBe('00000007');
    expect(session.engine.getRegister(Reg.D0)).toBe(0); // only the text changed (sim-ui §4.4)
    session.controller.traceInto(); // MOVE.L #5,D1
    session.controller.traceInto(); // ADD.L D0,D1
    expect(model.view.getState().boxes[Box.D1]).toBe('0000000C');
    expect(model.view.getState().boxes[Box.D0]).toBe('00000007');
  }, 60_000);

  it('an edit of D2 is discarded by the next refresh (Pause)', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    model.editRegister(Box.D2, '0000ABCD');
    expect(model.view.getState().boxes[Box.D2]).toBe('0000ABCD');
    session.controller.pause();
    expect(model.view.getState().boxes[Box.D2]).toBe('00000000');
    session.controller.traceInto();
    expect(session.engine.getRegister(Reg.D2)).toBe(0);
  }, 60_000);

  it('an edit of an address register is applied at once; A7 mirrors into US or SS', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    model.editRegister(Box.A3, '00001234');
    expect(session.engine.getRegister(Reg.A3)).toBe(0x1234);
    // Supervisor mode (S = 1 at start): A7 is the supervisor stack pointer.
    model.editRegister(Box.A7, '00F00000');
    expect(session.engine.getRegister(Reg.SSP)).toBe(0xf00000);
    expect(model.view.getState().boxes[Box.SS]).toBe('00F00000'); // re-read: the engine changed SS too
    model.editRegister(Box.US, '00E00000');
    expect(session.engine.getRegister(Reg.USP)).toBe(0xe00000);
    expect(model.view.getState().boxes[Box.A7]).toBe('00F00000');
    // Clearing the S bit in the SR field swaps what A7 shows (regSRChange).
    model.editRegister(Box.SR, '0000000000000000');
    expect(model.view.getState().boxes[Box.A7]).toBe('00E00000');
  }, 60_000);

  it('a typed PC moves the selection to the matching row; Go to PC brings it back after a click', async () => {
    const bench = await realBench();
    const { model } = bench;
    const lea = rowOf(bench, 'MOVEA.L');
    model.editRegister(Box.PC, '00001004');
    expect(selected(bench)).toBe(lea);
    model.selectRow(1);
    expect(selected(bench)).toBe(1);
    const before = model.view.getState().scroll?.serial ?? 0;
    model.gotoPC();
    expect(selected(bench)).toBe(lea);
    expect(model.view.getState().scroll).toEqual({ row: lea, serial: before + 1 });
  }, 60_000);

  it('a typed PC that matches no row leaves the selection where it is, and still scrolls it into view', async () => {
    const bench = await realBench();
    const { model } = bench;
    model.selectRow(2);
    model.editRegister(Box.PC, '00009000');
    expect(selected(bench)).toBe(2);
    expect(model.view.getState().scroll?.row).toBe(2);
  }, 60_000);

  it('double-click on an instruction row sets the PC field (used by the next Trace Into); not on other rows', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    const bra = rowOf(bench, 'BRA.S');
    model.doubleClickRow(bra);
    expect(model.view.getState().boxes[Box.PC]).toBe('0000100A');
    expect(selected(bench)).toBe(bra);
    expect(session.engine.getRegister(Reg.PC)).toBe(0x1000); // not before the next run command
    session.controller.traceInto(); // BRA.S LOOP: stays at $100A
    expect(model.view.getState().boxes[Box.PC]).toBe('0000100A');
    const edits = session.controller.log.filter((entry) => entry.startsWith('editBox')).length;
    model.doubleClickRow(rowOf(bench, 'LOOP:')); // label row: no code
    model.doubleClickRow(rowOf(bench, 'No errors'));
    expect(session.controller.log.filter((entry) => entry.startsWith('editBox')).length).toBe(edits);
    // The first header row passes the test (no index check, sim-ui §6.6): the start address.
    model.doubleClickRow(0);
    expect(model.view.getState().boxes[Box.PC]).toBe('00001000');
  }, 60_000);

  it('the selection follows the engine after Trace Into, also back from a clicked row when the PC row did not change', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    session.controller.traceInto();
    session.controller.traceInto();
    session.controller.traceInto();
    const bra = rowOf(bench, 'BRA.S');
    expect(selected(bench)).toBe(bra);
    model.selectRow(4); // the user clicks a row
    const serial = model.view.getState().scroll?.serial ?? 0;
    session.controller.traceInto(); // BRA.S LOOP: the highlight stays on the same row
    expect(session.controller.snapshot.highlight).toBe(bra);
    // highlight() runs at every scrshow(): the PC row is selected again (sim-ui §6.4).
    expect(selected(bench)).toBe(bra);
    expect(model.view.getState().scroll).toEqual({ row: bra, serial: serial + 1 });
  }, 60_000);

  it('Clear Cycles is no scrshow(): a clicked row stays selected', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    session.controller.traceInto();
    model.selectRow(1);
    const serial = model.view.getState().scroll?.serial ?? 0;
    model.clearCycles();
    expect(selected(bench)).toBe(1);
    expect(model.view.getState().scroll?.serial ?? 0).toBe(serial);
  }, 60_000);

  it('gutter: a click toggles the breakpoint of an instruction row; other rows and the header do nothing', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    const add = rowOf(bench, 'ADD.L');
    model.toggleBreakpoint(add);
    expect(session.engine.breakpoints()).toEqual([0x1002]);
    expect([...model.view.getState().breakpoints]).toEqual([0x1002]);
    model.toggleBreakpoint(add);
    expect(session.engine.breakpoints()).toEqual([]);
    expect(model.view.getState().breakpoints.size).toBe(0);
    const calls = session.controller.log.length;
    model.toggleBreakpoint(0); // header row 0 passes isInstruction, but index must be above 2
    model.toggleBreakpoint(rowOf(bench, 'LOOP:'));
    model.toggleBreakpoint(rowOf(bench, 'ORG'));
    model.toggleBreakpoint(9999);
    expect(session.controller.log.length).toBe(calls);
    expect(session.engine.breakpoints()).toEqual([]);
  }, 60_000);

  it('a breakpoint set in the gutter stops Run; Clear All PC Breakpoints removes every one', async () => {
    const bench = await realBench();
    const { model, session, ctx } = bench;
    model.toggleBreakpoint(rowOf(bench, 'MOVEA.L'));
    model.toggleBreakpoint(rowOf(bench, 'SIMHALT'));
    session.controller.run();
    expect(model.view.getState().boxes[Box.PC]).toBe('00001004');
    expect(ctx.store.getState().sim.messageLines).toContain('break point at 1004');
    await ctx.commands.run('sim.bp.clearAllPC');
    expect(session.engine.breakpoints()).toEqual([]);
    expect(model.view.getState().breakpoints.size).toBe(0);
  }, 60_000);

  it('the 101st breakpoint: the engine shows `Breakpoint Limit Reached!` and the table stays at 100', async () => {
    const lines = ['    ORG $1000', 'START:'];
    for (let index = 0; index < 101; index++) lines.push('    NOP');
    lines.push('    SIMHALT', '    END START');
    const big = await assembleProgram(lines);
    const bench = await realBench(false);
    const { model, session } = bench;
    session.controller.loadBytes('/browser/demo/nops.S68', big.s68, big.l68);
    const rows = bench.session.listing.rows
      .map((_text, row) => row)
      .filter((row) => row > 2 && bench.session.listing.isInstruction(row));
    expect(rows.length).toBe(102);
    for (const row of rows.slice(0, 100)) model.toggleBreakpoint(row);
    expect(session.engine.breakpoints()).toHaveLength(100);
    expect(session.controller.alerts).toEqual([]);
    model.toggleBreakpoint(rows[100] as number);
    expect(session.engine.breakpoints()).toHaveLength(100);
    expect(session.controller.alerts).toEqual([{ title: 'Error', text: 'Breakpoint Limit Reached!' }]);
    expect(model.view.getState().breakpoints.size).toBe(100);
    // Removing one makes room again.
    session.controller.dismissAlerts();
    model.toggleBreakpoint(rows[0] as number);
    model.toggleBreakpoint(rows[100] as number);
    expect(session.engine.breakpoints()).toHaveLength(100);
    expect(model.view.getState().breakpoints.has(0x1000 + 2 * 100)).toBe(true);
  }, 60_000);

  it('Clear Cycles: forwarded to the controller, the field shows 0', async () => {
    const bench = await realBench();
    const { model, session, ctx } = bench;
    session.controller.traceInto();
    expect(model.view.getState().cycles).not.toBe('0');
    await ctx.commands.run('sim.cycles.clear');
    expect(session.controller.log).toContain('clearCycles');
    expect(session.engine.cycles).toBe(0n);
    expect(model.view.getState().cycles).toBe('0');
  }, 60_000);

  it('changed registers are marked after a refresh and not by the edit itself', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    session.controller.traceInto(); // MOVE.L #5,D1
    const changed = model.view.getState().changed;
    expect(changed[Box.D1]).toBe(true);
    expect(changed[Box.PC]).toBe(true);
    expect(changed[Box.D0]).toBe(false);
    model.editRegister(Box.D3, '00000001');
    expect(model.view.getState().changed[Box.D3]).toBe(false);
  }, 60_000);

  it('double-click on an address register runs sim.view.memory with its text (the Memory feature)', async () => {
    const bench = await realBench(true, [memoryFeature]);
    const { model, ctx } = bench;
    await ctx.commands.run('app.mode.set', 'simulator');
    model.editRegister(Box.A2, '00FF3004');
    model.copyToMemory(Box.A2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // U2's rules: masked to 24 bits, rounded down to 16; the panel is shown and takes the focus.
    expect(memoryModelOf(ctx).getState().address).toBe(0xff3000);
    expect(shellStateOf(ctx).getState().activeTool).toBe('memory');
    expect(shellStateOf(ctx).getState().focusRequest?.panel).toBe('memory');
    model.editRegister(Box.D0, '00005000');
    model.copyToMemory(Box.D0); // data registers have no handler
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(memoryModelOf(ctx).getState().address).toBe(0xff3000);
  }, 60_000);

  it('Find: hits are selected and scrolled to, searches continue, no wrap; Go to PC afterwards', async () => {
    const bench = await realBench();
    const { model } = bench;
    const move = rowOf(bench, 'MOVE.L');
    const movea = rowOf(bench, 'MOVEA.L');
    expect(model.findButton('move').hit).toBe(move);
    expect(selected(bench)).toBe(move);
    expect(model.findButton('move').hit).toBe(movea);
    expect(selected(bench)).toBe(movea);
    expect(model.view.getState().scroll?.row).toBe(movea);
    const symbol = model.findButton('move').hit; // nothing further down mentions MOVE
    expect(symbol).toBeNull();
    expect(selected(bench)).toBe(movea);
    expect(model.findF3('move')).toEqual({ hit: null, searched: false });
    model.finder.restart();
    expect(model.findButton('MOVE').hit).toBe(move);
  }, 60_000);

  it('the panels follow a cold start: new engine, start-up registers, no rows, no breakpoints', async () => {
    const bench = await realBench();
    const { model, session } = bench;
    model.toggleBreakpoint(rowOf(bench, 'ADD.L'));
    session.controller.traceInto();
    const first = session.engine;
    await session.controller.coldStart();
    expect(session.engine).not.toBe(first);
    const view = model.view.getState();
    expect(view.rows).toEqual([]);
    expect(view.breakpoints.size).toBe(0);
    expect(view.boxes[Box.PC]).toBe('00000000');
    expect(view.boxes[Box.A7]).toBe('01000000');
    expect(view.changed.every((flag) => !flag)).toBe(true);
    expect(selected(bench)).toBe(-1);
    // The new engine is the one that is used from now on.
    model.editRegister(Box.A1, '00000042');
    expect(session.engine.getRegister(Reg.A1)).toBe(0x42);
    expect(first).not.toBe(session.engine);
    const { s68, l68 } = await theProgram();
    session.controller.loadBytes('/browser/demo/program.S68', s68, l68);
    expect(model.view.getState().rows.length).toBeGreaterThan(5);
    expect(selected(bench)).toBe(rowOf(bench, 'MOVE.L #5'));
  }, 60_000);

  it('messages: the engine lines reach AppState.sim.messageLines (trace lines, cleared on load)', async () => {
    const bench = await realBench();
    const { session, ctx } = bench;
    expect(ctx.store.getState().sim.messageLines).toContain('.S68 file read successful');
    session.controller.traceInto();
    // MOVE.L #5,D1 is assembled as MOVEQ; the mnemonic comes from the core's table, padded.
    expect(ctx.store.getState().sim.messageLines.at(-1)).toMatch(/^PC=00001000 {2}Code=7205 {2}MOVEQ */);
    const { s68, l68 } = await theProgram();
    session.controller.loadBytes('/browser/demo/program.S68', s68, l68);
    expect(ctx.store.getState().sim.messageLines.some((line) => line.startsWith('PC='))).toBe(false);
  }, 60_000);
});

/* ------------------------------------------------------------------ a scripted controller */

/** A session whose snapshot the test sets, and whose listing has rows the test chooses. */
function scriptedBench(rows: string[]) {
  let snapshot: RunSnapshot = {
    boxes: new Array(20).fill('00000000'),
    cycles: 0n,
    highlight: -1,
    halted: false,
    revision: 0,
  };
  let session: SimSession | null = null;
  const listeners = new Set<() => void>();
  const app = createTestApplication({
    features: [feature],
    services: {
      createSimSession: (ctx) => {
        const inert = createInertSimSession(ctx);
        const listingRows = rows.slice();
        const engine = {
          ...inert.engine,
          listingLineCount: listingRows.length,
          listingLine: (index: number) => encode(listingRows[index] ?? '').bytes,
        };
        const controller = {
          ...inert.controller,
          get snapshot() {
            return snapshot;
          },
          subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        };
        const listing = new ListingView(() => engine);
        listing.refresh();
        session = { ...inert, engine, controller, listing };
        return session;
      },
    },
  });
  benches.push({
    app,
    ctx: app.ctx,
    session: session as unknown as SessionDouble,
    model: simMainOf(app.ctx),
    engines: [],
  });
  return {
    app,
    ctx: app.ctx,
    model: simMainOf(app.ctx),
    /**
     * A snapshot refresh as after a scrshow(): the engine's row, and the PC field, by default the
     * address of that row (highlight() found it); `pc` gives another PC text (no row matches).
     */
    refresh(highlight: number, options: { pc?: string; halted?: boolean } = {}) {
      const pc = options.pc ?? (rows[highlight] ?? '').slice(0, 8);
      const boxes = snapshot.boxes.slice();
      boxes[Box.PC] = pc;
      snapshot = {
        ...snapshot,
        boxes,
        highlight,
        halted: options.halted ?? false,
        revision: snapshot.revision + 1,
      };
      for (const listener of [...listeners]) listener();
    },
  };
}

describe('the selection rule of highlight() (scripted snapshots)', () => {
  const rows = ['00001000 Starting Address', 'h', 'h'];
  for (let index = 0; index < 200; index++) {
    rows.push(`${(0x1000 + index * 2).toString(16).toUpperCase().padStart(8, '0')}  4E71    ${index + 1}   NOP`);
  }
  rows.push('00001190                    201  DATA:'); // row 203: a label row, not an instruction row

  it('a matching highlight takes the selection and asks for the scroll', () => {
    const bench = scriptedBench(rows);
    bench.refresh(10);
    expect(selected(bench)).toBe(10);
    expect(bench.model.view.getState().scroll?.row).toBe(10);
    bench.refresh(150);
    expect(selected(bench)).toBe(150);
    expect(bench.model.view.getState().scroll?.row).toBe(150);
  });

  it('the same matching highlight again takes the selection back from a clicked row (scrshow re-runs highlight)', () => {
    const bench = scriptedBench(rows);
    bench.refresh(10);
    bench.model.selectRow(40);
    const serial = bench.model.view.getState().scroll?.serial ?? 0;
    bench.refresh(10);
    expect(selected(bench)).toBe(10);
    expect(bench.model.view.getState().scroll).toEqual({ row: 10, serial: serial + 1 });
  });

  it('no row matches the PC: the selection stays, and is still scrolled into view', () => {
    const bench = scriptedBench(rows);
    bench.refresh(10);
    bench.model.selectRow(40);
    const serial = bench.model.view.getState().scroll?.serial ?? 0;
    bench.refresh(10, { pc: '00009000' }); // the engine keeps its last row when nothing matched
    expect(selected(bench)).toBe(40);
    expect(bench.model.view.getState().scroll).toEqual({ row: 40, serial: serial + 1 });
  });

  it('a non-instruction row matches only when the program has halted', () => {
    const bench = scriptedBench(rows);
    bench.refresh(10);
    bench.refresh(203);
    expect(selected(bench)).toBe(10);
    bench.refresh(203, { halted: true });
    expect(selected(bench)).toBe(203);
  });

  it('a refresh without a new revision does nothing', () => {
    const bench = scriptedBench(rows);
    bench.refresh(10);
    bench.model.selectRow(40);
    bench.model.sync();
    expect(selected(bench)).toBe(40);
  });

  it('selectRow clamps to the rows', () => {
    const bench = scriptedBench(rows);
    bench.model.selectRow(-5);
    expect(selected(bench)).toBe(0);
    bench.model.selectRow(9999);
    expect(selected(bench)).toBe(rows.length - 1);
  });
});

describe('the feature module', () => {
  it('contributes the three panels of Simulator mode, the dialog and the four commands', () => {
    expect(feature.panels?.map((panel) => [panel.id, panel.mode, panel.title])).toEqual([
      ['registers', 'simulator', 'Registers'],
      ['listing', 'simulator', 'Listing'],
      ['messages', 'simulator', 'Messages'],
    ]);
    expect(Object.keys(feature.dialogs ?? {})).toEqual(['sim.find']);
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual(
      ['sim.bp.clearAllPC', 'sim.cycles.clear', 'sim.search.find', 'sim.search.gotoPC'].sort(),
    );
  });

  it('the commands are enabled in Simulator mode, also with the inert session', async () => {
    const app = createTestApplication({ features: [feature] });
    benches.push({ app, ctx: app.ctx, session: app.ctx.sim as SessionDouble, model: simMainOf(app.ctx), engines: [] });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    for (const id of ['sim.search.find', 'sim.search.gotoPC', 'sim.bp.clearAllPC', 'sim.cycles.clear']) {
      expect(app.ctx.commands.isEnabled(id), id).toBe(true);
    }
  });

  it('Search > Find... opens the modeless dialog once; again while open, it asks it to take the focus', async () => {
    const app = createTestApplication({ features: [feature] });
    benches.push({ app, ctx: app.ctx, session: app.ctx.sim as SessionDouble, model: simMainOf(app.ctx), engines: [] });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('sim.search.find');
    expect(app.ctx.store.getState().dialogs.stack).toEqual([expect.objectContaining({ id: 'sim.find', modal: false })]);
    expect(app.ctx.dialogs.isModalOpen()).toBe(false);
    const focus = simMainOf(app.ctx).view.getState().findFocus;
    await app.ctx.commands.run('sim.search.find');
    expect(app.ctx.store.getState().dialogs.stack).toHaveLength(1);
    expect(simMainOf(app.ctx).view.getState().findFocus).toBe(focus + 1);
    // Modeless: the program is not held, other commands still run.
    expect(app.ctx.sim.controller.held).toBe(false);
  });
});
