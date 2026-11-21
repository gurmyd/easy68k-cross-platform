// The Break Points panel's rows, converted by slots.ts, on the real simulator engine (engine/dist):
// test programs stop at the expected instruction for a read, a write, a register and a combined
// condition, and do not stop where the original would not (sim-core §7.2, §7.3).
//
// The rows are built with the same pure functions the panel uses (tables.ts), so this proves the
// whole way from the user's clicks to the engine's slots.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleProgram, createTestEngine, runProgram, textOf, type TestEngine } from '../../engine/testing';
import { FRESH_SLOTS, applySlotChanges, slotChanges, slotsOf } from './slots';
import {
  MAX_ROWS,
  REGISTER_CHOICES,
  appendCondition,
  appendSymbol,
  emptyTables,
  setBuilderField,
  setEntry,
  startEdit,
  updateExpressionDraft,
  updateMemoryDraft,
  updateRegisterDraft,
  type BreakpointTables,
  type MemoryCondition,
  type RegisterCondition,
} from './tables';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const simBuilt = existsSync(repo('engine/dist/sim68k.wasm')) && existsSync(repo('engine/dist/asm68k.wasm'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

// ---- building rows as the user does ---------------------------------------------------------------

const reg = (name: (typeof REGISTER_CHOICES)[number], op: string, value: number, size: 'B' | 'W' | 'L' = 'L') =>
  ({
    register: REGISTER_CHOICES.indexOf(name),
    op: ['==', '!=', '>', '>=', '<', '<='].indexOf(op),
    value: (value >>> 0).toString(16).toUpperCase().padStart(8, '0'),
    size: 'BWL'.indexOf(size),
  }) satisfies RegisterCondition;

const mem = (
  address: number,
  readWrite: 'R/W' | 'Read' | 'Write' | 'N/A',
  size: 'B' | 'W' | 'L',
  op = 'N/A',
  value = 0,
) =>
  ({
    address: address.toString(16).toUpperCase().padStart(8, '0'),
    op: ['==', '!=', '>', '>=', '<', '<=', 'N/A'].indexOf(op),
    value: (value >>> 0).toString(16).toUpperCase().padStart(8, '0'),
    size: 'BWL'.indexOf(size),
    readWrite: ['R/W', 'Read', 'Write', 'N/A'].indexOf(readWrite),
  }) satisfies MemoryCondition;

interface Setup {
  registers?: RegisterCondition[];
  memory?: MemoryCondition[];
  /** Expressions as builder clicks: 'R<n>', 'A<n>', 'AND', 'OR', '(', ')'. */
  expressions?: { parts: string[]; count?: string; enabled?: boolean }[];
}

function build(setup: Setup): BreakpointTables {
  let t = emptyTables();
  for (const condition of setup.registers ?? []) {
    t = updateRegisterDraft(startEdit(t, 'registers', MAX_ROWS - 1), condition);
    t = setEntry(t, 'registers').tables;
  }
  for (const condition of setup.memory ?? []) {
    t = updateMemoryDraft(startEdit(t, 'memory', MAX_ROWS - 1), condition);
    t = setEntry(t, 'memory').tables;
  }
  for (const expression of setup.expressions ?? []) {
    t = startEdit(t, 'expressions', MAX_ROWS - 1);
    for (const part of expression.parts) {
      if (/^[RA]\d+$/.test(part)) {
        const kind = part[0] === 'R' ? 'reg' : 'mem';
        t = setBuilderField(t, kind === 'reg' ? 'register' : 'memory', part.slice(1).padStart(2, '0'));
        const result = appendCondition(t, kind);
        if (result.message) throw new Error(result.message);
        t = result.tables;
      } else t = appendSymbol(t, part as 'AND');
    }
    t = updateExpressionDraft(t, { count: expression.count ?? '01', enabled: expression.enabled ?? true });
    const result = setEntry(t, 'expressions');
    if (result.message || result.tables === t) throw new Error(`expression not stored: ${expression.parts.join(' ')}`);
    t = result.tables;
  }
  return t;
}

// ---- the programs ---------------------------------------------------------------------------------

/** A loop that counts D0 from 1 to 10 and reads the word at $3000 on every pass. */
const LOOP = [
  '        ORG     $1000',
  'START   MOVEQ   #0,D0', //   $1000 (2 bytes)
  'LOOP    ADDQ.L  #1,D0', //   $1002 (2)
  '        MOVE.W  $3000,D1', // $1004 (4)
  '        CMP.L   #10,D0', //  $1008 (6)
  '        BNE     LOOP', //    $100E (2)
  '        SIMHALT', //         $1010
  '        ORG     $3000',
  '        DC.W    $1234',
  '        END     START',
];

/** One write by MOVE, then a subroutine call that pushes its return address to $7FFC. */
const WRITES = [
  '        ORG     $1000',
  'START   MOVEA.L #$8000,A7', //  $1000 (6)
  '        MOVE.W  D0,$3000', //   $1006 (4)
  '        BSR     SUB', //        $100A (4), return address $100E
  '        SIMHALT', //            $100E (4)
  'SUB     RTS', //                $1012
  '        END     START',
];

describe('advanced breakpoints on the real engine', () => {
  it.runIf(enginesRequired && !simBuilt)('engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is missing: run `npm run build:engines`.');
  });

  let test: TestEngine | null = null;
  afterEach(() => {
    test?.release();
    test = null;
  });

  /** Loads a program, sends the rows as the panel does, runs it; reports where it stopped. */
  async function run(source: string[], setup: Setup) {
    const program = await assembleProgram(source);
    test?.release();
    test = await createTestEngine();
    const { engine } = test;
    engine.load(program.s68, program.l68, { name: 'program.S68', kind: 'open' });
    const changes = slotChanges(FRESH_SLOTS, slotsOf(build(setup)));
    expect(applySlotChanges(engine, changes)).toEqual([]);
    test.forget();
    const report = runProgram(engine, { maxInstructions: 10_000 });
    const messages = test.callsTo('message').map(([text]) => textOf(text));
    return { engine, report, messages, pc: engine.registers().pc, d0: engine.registers().d[0] };
  }

  it.skipIf(!simBuilt)(
    'a read condition stops after the instruction that read the address',
    async () => {
      const r = await run(LOOP, { memory: [mem(0x3000, 'Read', 'W')], expressions: [{ parts: ['A1'] }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1008);
      expect(r.d0).toBe(1);
      expect(r.messages).toContain('break point at 1008');
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'a read condition on the second word of a long access never fires (only the start address is recorded)',
    async () => {
      const r = await run(LOOP, { memory: [mem(0x3001, 'Read', 'B')], expressions: [{ parts: ['A1'] }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'a write condition stops after BSR pushed its return address',
    async () => {
      const r = await run(WRITES, {
        memory: [mem(0x7ffc, 'Write', 'L', '==', 0x100e)],
        expressions: [{ parts: ['A1'] }],
      });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1012);
      expect(r.messages).toContain('break point at 1012');
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    "a write condition on MOVE's destination never fires, as in the original (MOVE reads it back); R/W does",
    async () => {
      let r = await run(WRITES, { memory: [mem(0x3000, 'Write', 'W')], expressions: [{ parts: ['A1'] }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });

      r = await run(WRITES, { memory: [mem(0x3000, 'R/W', 'W')], expressions: [{ parts: ['A1'] }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x100a);
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'a register condition stops after the instruction that made it true',
    async () => {
      const r = await run(LOOP, { registers: [reg('D0', '==', 5)], expressions: [{ parts: ['R1'] }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1004);
      expect(r.d0).toBe(5);
      expect(r.messages).toContain('break point at 1004');
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'the count is decimal: PC == LOOP with count 10 stops on the tenth time, after the ninth BNE',
    async () => {
      const r = await run(LOOP, {
        registers: [reg('PC', '==', 0x1002)],
        expressions: [{ parts: ['R1'], count: '10' }],
      });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1002);
      expect(r.d0).toBe(9);
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'a combined expression (D0 == 5 AND a read of $3000) stops only where both hold',
    async () => {
      const r = await run(LOOP, {
        registers: [reg('D0', '==', 5)],
        memory: [mem(0x3000, 'Read', 'W')],
        expressions: [{ parts: ['R1', 'AND', 'A1'] }],
      });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1008);
      expect(r.d0).toBe(5);
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'R1 AND (A1 OR A2) OR R2 is R1 AND ((A1 OR A2) OR R2): it does not stop where R2 alone holds',
    async () => {
      const setup = (parts: string[]): Setup => ({
        registers: [reg('D0', '==', 99), reg('D0', '==', 5)],
        memory: [mem(0x3000, 'Write', 'W'), mem(0x3002, 'Write', 'W')],
        expressions: [{ parts }],
      });
      // The original's conversion: R1 is never true, so the expression never is.
      let r = await run(LOOP, setup(['R1', 'AND', '(', 'A1', 'OR', 'A2', ')', 'OR', 'R2']));
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });

      // The same conditions with R2 first: R2 OR (R1 AND (A1 OR A2)) stops when D0 becomes 5.
      r = await run(LOOP, setup(['R2', 'OR', 'R1', 'AND', '(', 'A1', 'OR', 'A2', ')']));
      expect(r.report).toMatchObject({ reason: 'stopped', halted: false });
      expect(r.pc).toBe(0x1004);
      expect(r.d0).toBe(5);
    },
    60_000,
  );

  it.skipIf(!simBuilt)(
    'an expression set to OFF, and a condition without an expression, never stop the program',
    async () => {
      let r = await run(LOOP, { registers: [reg('D0', '==', 5)], expressions: [{ parts: ['R1'], enabled: false }] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });

      r = await run(LOOP, { registers: [reg('D0', '==', 5)] });
      expect(r.report).toMatchObject({ reason: 'stopped', halted: true });
    },
    60_000,
  );
});
