import { describe, expect, it } from 'vitest';
import type { BreakCondition, BreakExpression } from '../../contracts';
import { TOKEN_AND as AND, TOKEN_LPAREN as L, TOKEN_OR as OR, TOKEN_RPAREN as R } from './expression';
import {
  FRESH_SLOTS,
  applySlotChanges,
  countValue,
  expressionSlot,
  hexValue,
  memorySlot,
  registerSlot,
  slotChanges,
  slotsOf,
} from './slots';
import { emptyTables, planClear, selectRow, type BreakpointTables } from './tables';

/** Tables written directly (the editing functions are tested in tables.test.ts). */
function tables(patch: Partial<BreakpointTables>): BreakpointTables {
  return { ...emptyTables(), ...patch };
}

/** An engine that records the breakpoint calls. */
function recorder() {
  const calls: unknown[][] = [];
  return {
    calls,
    setBreakCondition: (index: number, condition: BreakCondition) => void calls.push(['condition', index, condition]),
    setBreakExpression: (index: number, expression: BreakExpression) => {
      calls.push(['expression', index, expression]);
      return true;
    },
    setBreakCounts: (counts: object) => void calls.push(['counts', counts]),
  };
}

describe('the fields the engine receives (sim-core §7.2, §7.3)', () => {
  it('values are StrToInt("0x" + text): signed 32-bit', () => {
    expect(hexValue('0000002A')).toBe(42);
    expect(hexValue('FFFFFFFF')).toBe(-1);
    expect(hexValue('80000000')).toBe(-0x80000000);
  });

  it('the count is decimal (10.2 O-10): 10 is ten, 00 is zero', () => {
    expect(countValue('10')).toBe(10);
    expect(countValue('01')).toBe(1);
    expect(countValue('00')).toBe(0);
    expect(countValue('99')).toBe(99);
  });

  it('a register condition: type 0, typeId = register (PC 16), op, value, size, its row as id', () => {
    expect(registerSlot({ register: 16, op: 3, value: '00001010', size: 2 }, 4)).toEqual({
      enabled: true,
      id: 4,
      type: 0,
      typeId: 16,
      op: 3,
      value: 0x1010,
      size: 2,
    });
  });

  it('a memory condition: type 1, typeId = the address (not masked), readWrite', () => {
    expect(memorySlot({ address: 'FF002000', op: 6, value: '000000FF', size: 0, readWrite: 2 }, 0)).toEqual({
      enabled: true,
      id: 0,
      type: 1,
      typeId: hexValue('FF002000'),
      op: 6,
      value: 255,
      size: 0,
      readWrite: 2,
    });
  });

  it('an expression: enabled = ON, id = the 1-based row, decimal count, the postfix of §7.3', () => {
    expect(expressionSlot({ enabled: true, tokens: [0, AND, L, 50, OR, 51, R, OR, 1], count: '12' }, 2)).toEqual({
      enabled: true,
      id: 3,
      count: 12,
      postfix: [0, 50, 51, 101, 1, 101, 100],
    });
    expect(expressionSlot({ enabled: false, tokens: [50], count: '01' }, 0)).toEqual({
      enabled: false,
      id: 1,
      count: 1,
      postfix: [50],
    });
  });
});

describe('the calls that bring the engine up to date', () => {
  const two = tables({
    registers: [{ register: 0, op: 0, value: '00000002', size: 2 }],
    memory: [{ address: '00002000', op: 6, value: '00000000', size: 2, readWrite: 2 }],
    expressions: [{ enabled: true, tokens: [0, AND, 50], count: '01' }],
  });

  it('from a fresh engine: the stored rows, then the counts', () => {
    const changes = slotChanges(FRESH_SLOTS, slotsOf(two));
    const engine = recorder();
    expect(applySlotChanges(engine, changes)).toEqual([]);
    expect(engine.calls).toEqual([
      ['condition', 0, { enabled: true, id: 0, type: 0, typeId: 0, op: 0, value: 2, size: 2 }],
      ['condition', 50, { enabled: true, id: 0, type: 1, typeId: 0x2000, op: 6, value: 0, size: 2, readWrite: 2 }],
      ['expression', 0, { enabled: true, id: 1, count: 1, postfix: [0, 50, 100] }],
      ['counts', { registers: 1, addresses: 1, expressions: 1 }],
    ]);
  });

  it('nothing is sent when nothing changed', () => {
    expect(slotChanges(slotsOf(two), slotsOf(two))).toEqual([]);
    expect(slotChanges(FRESH_SLOTS, slotsOf(emptyTables()))).toEqual([]);
  });

  it('after a Clear the rows move down one slot and the freed slot is sent disabled', () => {
    const three = tables({
      registers: [
        { register: 0, op: 0, value: '00000001', size: 2 },
        { register: 1, op: 0, value: '00000002', size: 2 },
        { register: 2, op: 0, value: '00000003', size: 2 },
      ],
      expressions: [{ enabled: true, tokens: [2], count: '01' }],
    });
    const plan = planClear(selectRow(three, 'registers', 0), 'registers');
    if (plan.kind !== 'apply') throw new Error('expected a change');
    const changes = slotChanges(slotsOf(three), slotsOf(plan.tables));
    expect(changes).toEqual([
      {
        kind: 'condition',
        index: 0,
        condition: { enabled: true, id: 0, type: 0, typeId: 1, op: 0, value: 2, size: 2 },
      },
      {
        kind: 'condition',
        index: 1,
        condition: { enabled: true, id: 1, type: 0, typeId: 2, op: 0, value: 3, size: 2 },
      },
      {
        kind: 'condition',
        index: 2,
        condition: { enabled: false, id: 2, type: 0, typeId: 0, op: 0, value: 0, size: 2 },
      },
      { kind: 'expression', index: 0, expression: { enabled: true, id: 1, count: 1, postfix: [1] } },
      { kind: 'counts', counts: { registers: 2, addresses: 0, expressions: 1 } },
    ]);
  });

  it('a removed expression slot is sent disabled with an empty postfix', () => {
    const before = slotsOf(two);
    const after = slotsOf({ ...two, expressions: [] });
    expect(slotChanges(before, after)).toEqual([
      { kind: 'expression', index: 0, expression: { enabled: false, id: 1, count: 1, postfix: [] } },
      { kind: 'counts', counts: { registers: 1, addresses: 1, expressions: 0 } },
    ]);
  });

  it('reports an expression the engine refused', () => {
    const engine = { ...recorder(), setBreakExpression: () => false };
    expect(applySlotChanges(engine, slotChanges(FRESH_SLOTS, slotsOf(two)))).toEqual([0]);
  });
});
