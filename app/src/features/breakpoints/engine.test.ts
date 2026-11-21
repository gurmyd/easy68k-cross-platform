// The Break Points model on the real simulator engine (engine/dist): what the user enters in the
// panel reaches the engine, a write condition stops a program at the expected instruction, a Clear
// that renumbers the expressions keeps them pointing at the right conditions, and after a cold
// start (a new engine) the grids are empty and nothing stops the program.
// (Features may not import the real session of features/run; check-breakpoints.mjs drives the
// panel on the real session in a browser.)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { SimEngine } from '../../contracts';
import { MAX_ROWS } from '../../core/breakpoints';
import { assembleProgram, createTestEngine, runProgram, textOf, type TestEngine } from '../../engine/testing';
import { BreakpointsModel, type BreakpointsDeps } from './model';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const enginesBuilt = existsSync(repo('engine/dist/sim68k.wasm')) && existsSync(repo('engine/dist/asm68k.wasm'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** Writes $AA to $3000, then calls a subroutine; the call pushes its return address $1012 to $7FFC. */
const PROGRAM = [
  '        ORG     $1000',
  'START   MOVEA.L #$8000,A7', //  $1000 (6)
  '        MOVE.B  #$AA,$3000', // $1006 (6)
  '        BSR     SUB', //        $100C (4), return address $1010
  '        SIMHALT', //            $1010 (4)
  'SUB     RTS', //                $1014
  '        END     START',
];

describe('the Break Points model on the real engine', () => {
  it.runIf(enginesRequired && !enginesBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is missing: run `npm run build:engines`.');
  });

  const engines: TestEngine[] = [];
  afterEach(() => {
    for (const engine of engines.splice(0)) engine.release();
  });

  /** A model whose deps act on `current.engine` as the run controller would, answering OK. */
  async function setup() {
    const program = await assembleProgram(PROGRAM);
    const listeners = new Set<() => void>();
    const current: { test: TestEngine } = { test: await createTestEngine() };
    engines.push(current.test);
    const deps: BreakpointsDeps = {
      messageBox: () => Promise.resolve('OK'),
      invoke: (fn: (engine: SimEngine) => void) => fn(current.test.engine),
      onEngineReplaced: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const model = new BreakpointsModel(deps);
    model.start();
    const load = () => current.test.engine.load(program.s68, program.l68, { name: 'program.S68', kind: 'open' });
    load();
    const run = () => {
      current.test.forget();
      const report = runProgram(current.test.engine, { maxInstructions: 10_000 });
      return {
        report,
        pc: current.test.engine.registers().pc,
        messages: current.test.callsTo('message').map(([text]) => textOf(text)),
      };
    };
    const coldStart = async () => {
      current.test = await createTestEngine();
      engines.push(current.test);
      for (const listener of listeners) listener();
      load();
    };
    return { model, run, coldStart, rewind: () => current.test.engine.rewind() };
  }

  /** Adds a memory condition and an expression of just that condition, with the panel's actions. */
  async function addMemoryBreak(model: BreakpointsModel, address: string, readWrite: number) {
    model.edit('memory', MAX_ROWS - 1);
    model.updateMemory({ address, readWrite, op: 6, size: 0 });
    await model.set('memory');
    model.edit('expressions', MAX_ROWS - 1);
    model.setBuilderField('memory', String(model.tables.memory.length).padStart(2, '0'));
    await model.appendCondition('mem');
    await model.set('expressions');
  }

  it.skipIf(!enginesBuilt)(
    'a write condition entered in the panel stops the program after the instruction that wrote',
    async () => {
      const { model, run } = await setup();
      await addMemoryBreak(model, '00007FFC', 2); // Write
      const r = run();
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1014);
      expect(r.messages).toContain('break point at 1014');
    },
    60_000,
  );

  it.skipIf(!enginesBuilt)(
    'after a Clear the renumbered expression still means the same condition',
    async () => {
      const { model, run, rewind } = await setup();
      await addMemoryBreak(model, '00005000', 2); // never written
      await addMemoryBreak(model, '00007FFC', 2); // the return address
      model.select('memory', 0);
      await model.clear('memory'); // removes expression 1 (after OK); expression 2 becomes 1 and refers to A1
      expect(model.tables.expressions.map((e) => e.tokens)).toEqual([[50]]);
      let r = run();
      expect(r.pc).toBe(0x1014);
      // Editing a condition in place changes what the expression tests: $3000 is written by MOVE,
      // which reads the byte back, so a Write test there never fires but R/W does (sim-core §7.2).
      rewind();
      model.edit('memory', 0);
      model.updateMemory({ address: '00003000' });
      await model.set('memory');
      r = run();
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });
      rewind();
      model.edit('memory', 0);
      model.updateMemory({ readWrite: 0 });
      await model.set('memory');
      r = run();
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x100c);
    },
    60_000,
  );

  it.skipIf(!enginesBuilt)(
    'after a cold start the grids are empty and the new engine has no breakpoint',
    async () => {
      const { model, run, coldStart, rewind } = await setup();
      await addMemoryBreak(model, '00007FFC', 2);
      await coldStart();
      expect([model.tables.registers, model.tables.memory, model.tables.expressions]).toEqual([[], [], []]);
      let r = run();
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });
      // The next entry goes to the new engine.
      rewind();
      await addMemoryBreak(model, '00007FFC', 2);
      r = run();
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1014);
    },
    60_000,
  );
});
