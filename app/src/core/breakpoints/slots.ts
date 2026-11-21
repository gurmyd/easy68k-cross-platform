// From the grids of the Break Points panel to the engine's breakpoint slots (sim-core §7.2, §7.3;
// ARCHITECTURE.md 3.2 `setBreakCondition`, `setBreakExpression`, `setBreakCounts`). Owner: U3.
//
// The engine holds the original's tables: `breakPoints[0..99]` (0-49 register conditions, 50-99
// memory conditions), `bpExpressions[0..49]` and the counts `regCount`, `addrCount`, `exprCount`.
// Only the first `exprCount` expressions are evaluated, after every instruction. Row n (1-based) of
// a grid is slot n - 1 (register), 50 + n - 1 (memory) and n - 1 (expression), as in the original.
//
// The fields, as the original's Set buttons fill them (`BREAKPOINTSu.cpp:354-520`):
//   condition: enabled, type (0 register, 1 memory), typeId (register number or address),
//              op, value (`StrToInt("0x" + text)`: a signed 32-bit value), size, readWrite (memory);
//              id is the condition's 0-based row (what the original stores for a new row; the
//              engine does not read it)
//   expression: enabled (`ON`), id = the 1-based row number (the expression's hit-counter slot,
//              `bpCountCond[id]`), count (decimal, 10.2 O-10), postfix (infixToPostfix)
// A slot whose row was removed is sent disabled, as the original disables the slot it frees.
//
// `slotsOf()` computes the complete set; `slotChanges()` the calls that bring an engine from one set
// to the next, so that each user action sends only what changed. A fresh engine (start-up, cold
// start) holds `FRESH_SLOTS`.

import type { BreakCondition, BreakExpression, SimEngine } from '../../contracts';
import { ADDR_OFFSET, CONDITION_SLOTS, EXPRESSION_SLOTS, infixToPostfix } from './expression';
import type { BreakExpressionRow, BreakpointTables, MemoryCondition, RegisterCondition } from './tables';

/** Every slot the engine should hold. */
export interface EngineSlots {
  conditions: readonly BreakCondition[]; // CONDITION_SLOTS entries
  expressions: readonly BreakExpression[]; // EXPRESSION_SLOTS entries
  counts: { registers: number; addresses: number; expressions: number };
}

/** `StrToInt("0x" + text)` as a signed 32-bit value (the engine compares signed `long`s). */
export function hexValue(text: string): number {
  const value = Number.parseInt(text, 16);
  return Number.isNaN(value) ? 0 : value | 0;
}

/** The hit count, read as decimal (10.2 O-10: `10` means ten; the original read it as hex). */
export function countValue(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? 0 : value;
}

/** The engine's form of register condition `row` (0-based). */
export function registerSlot(condition: RegisterCondition, row: number): BreakCondition {
  return {
    enabled: true,
    id: row,
    type: 0,
    typeId: condition.register,
    op: condition.op,
    value: hexValue(condition.value),
    size: condition.size,
  };
}

/** The engine's form of memory condition `row` (0-based). The address is not masked (sim-core §7.2). */
export function memorySlot(condition: MemoryCondition, row: number): BreakCondition {
  return {
    enabled: true,
    id: row,
    type: 1,
    typeId: hexValue(condition.address),
    op: condition.op,
    value: hexValue(condition.value),
    size: condition.size,
    readWrite: condition.readWrite,
  };
}

/** The engine's form of expression `row` (0-based). */
export function expressionSlot(expression: BreakExpressionRow, row: number): BreakExpression {
  return {
    enabled: expression.enabled,
    id: row + 1,
    count: countValue(expression.count),
    postfix: infixToPostfix(expression.tokens),
  };
}

/** An unused condition slot. */
export function freeCondition(index: number): BreakCondition {
  return index < ADDR_OFFSET
    ? { enabled: false, id: index, type: 0, typeId: 0, op: 0, value: 0, size: 2 }
    : { enabled: false, id: index - ADDR_OFFSET, type: 1, typeId: 0, op: 0, value: 0, size: 2, readWrite: 0 };
}

/** An unused expression slot. */
export function freeExpression(index: number): BreakExpression {
  return { enabled: false, id: index + 1, count: 1, postfix: [] };
}

/** What a fresh engine holds, as far as the port is concerned: nothing in use. */
export const FRESH_SLOTS: EngineSlots = {
  conditions: Array.from({ length: CONDITION_SLOTS }, (_v, index) => freeCondition(index)),
  expressions: Array.from({ length: EXPRESSION_SLOTS }, (_v, index) => freeExpression(index)),
  counts: { registers: 0, addresses: 0, expressions: 0 },
};

/** The slots for the stored rows of the grids (entries being edited are not stored yet). */
export function slotsOf(tables: BreakpointTables): EngineSlots {
  const conditions = FRESH_SLOTS.conditions.map((free, index) => {
    if (index < ADDR_OFFSET) {
      const row = tables.registers[index];
      return row ? registerSlot(row, index) : free;
    }
    const row = tables.memory[index - ADDR_OFFSET];
    return row ? memorySlot(row, index - ADDR_OFFSET) : free;
  });
  const expressions = FRESH_SLOTS.expressions.map((free, index) => {
    const row = tables.expressions[index];
    return row ? expressionSlot(row, index) : free;
  });
  return {
    conditions,
    expressions,
    counts: {
      registers: tables.registers.length,
      addresses: tables.memory.length,
      expressions: tables.expressions.length,
    },
  };
}

/** One engine call. */
export type SlotChange =
  | { kind: 'condition'; index: number; condition: BreakCondition }
  | { kind: 'expression'; index: number; expression: BreakExpression }
  | { kind: 'counts'; counts: EngineSlots['counts'] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The calls that turn an engine holding `from` into one holding `to`, in this order: conditions,
 * expressions, then the counts (so the engine never evaluates an expression whose conditions are
 * not there yet).
 */
export function slotChanges(from: EngineSlots, to: EngineSlots): SlotChange[] {
  const changes: SlotChange[] = [];
  to.conditions.forEach((condition, index) => {
    if (!same(condition, from.conditions[index])) changes.push({ kind: 'condition', index, condition });
  });
  to.expressions.forEach((expression, index) => {
    if (!same(expression, from.expressions[index])) changes.push({ kind: 'expression', index, expression });
  });
  if (!same(to.counts, from.counts)) changes.push({ kind: 'counts', counts: to.counts });
  return changes;
}

/**
 * Makes the calls on an engine. Returns the indexes of expressions the engine refused (a malformed
 * postfix; cannot happen for expressions built with the panel's buttons).
 */
export function applySlotChanges(
  engine: Pick<SimEngine, 'setBreakCondition' | 'setBreakExpression' | 'setBreakCounts'>,
  changes: readonly SlotChange[],
): number[] {
  const refused: number[] = [];
  for (const change of changes) {
    switch (change.kind) {
      case 'condition':
        engine.setBreakCondition(change.index, change.condition);
        break;
      case 'expression':
        if (!engine.setBreakExpression(change.index, change.expression)) refused.push(change.index);
        break;
      case 'counts':
        engine.setBreakCounts(change.counts);
        break;
    }
  }
  return refused;
}
