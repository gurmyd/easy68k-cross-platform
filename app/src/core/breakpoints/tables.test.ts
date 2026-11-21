import { describe, expect, it } from 'vitest';
import { TOKEN_AND as AND, TOKEN_LPAREN as L, TOKEN_OR as OR, TOKEN_RPAREN as R, expressionText } from './expression';
import {
  BREAKPOINT_MESSAGES as M,
  MAX_ROWS,
  NEW_EXPRESSION,
  NEW_MEMORY,
  NEW_REGISTER,
  appendCondition,
  appendSymbol,
  backspace,
  cancelEdit,
  emptyTables,
  panelButtons,
  planClear,
  planClearAll,
  selectRow,
  setBuilderField,
  setEntry,
  startEdit,
  updateExpressionDraft,
  updateMemoryDraft,
  updateRegisterDraft,
  type BreakpointTables,
  type ClearPlan,
  type GridId,
} from './tables';

/** Stores a register condition through the editors, as the user does. */
function addRegister(t: BreakpointTables, register: number, value = '00000000'): BreakpointTables {
  let next = startEdit(t, 'registers', t.registers.length + 5);
  next = updateRegisterDraft(next, { register, value });
  return setEntry(next, 'registers').tables;
}
function addMemory(t: BreakpointTables, address: string, readWrite = 0): BreakpointTables {
  let next = startEdit(t, 'memory', MAX_ROWS - 1);
  next = updateMemoryDraft(next, { address, readWrite });
  return setEntry(next, 'memory').tables;
}
/** Builds an expression with the builder buttons; `parts` are 'R<n>', 'A<n>', 'AND', 'OR', '(', ')'. */
function addExpression(t: BreakpointTables, parts: string[], count = '01'): BreakpointTables {
  let next = startEdit(t, 'expressions', MAX_ROWS - 1);
  for (const part of parts) {
    if (/^[RA]\d+$/.test(part)) {
      const kind = part[0] === 'R' ? 'reg' : 'mem';
      next = setBuilderField(next, kind === 'reg' ? 'register' : 'memory', part.slice(1).padStart(2, '0'));
      const result = appendCondition(next, kind);
      expect(result.message).toBeNull();
      next = result.tables;
    } else next = appendSymbol(next, part as 'AND' | 'OR' | '(' | ')');
  }
  next = updateExpressionDraft(next, { count });
  return setEntry(next, 'expressions').tables;
}
const applied = (plan: ClearPlan) => {
  if (plan.kind !== 'apply') throw new Error(`expected a change, got the message ${plan.message}`);
  return plan;
};
const texts = (t: BreakpointTables) => t.expressions.map((e) => expressionText(e.tokens));

describe('the grids at start-up and after a cold start', () => {
  it('are empty, every button disabled, the builder fields blank (00)', () => {
    const t = emptyTables();
    expect([t.registers, t.memory, t.expressions]).toEqual([[], [], []]);
    expect(panelButtons(t)).toEqual({
      registers: { set: false, clear: false, clearAll: false },
      memory: { set: false, clear: false, clearAll: false },
      expressions: { set: false, clear: false, clearAll: false },
      builder: { operand: false, operator: false, lparen: false, rparen: false, backspace: false },
    });
    expect(t.builder).toEqual({ register: '00', memory: '00' });
  });
});

describe('editing a row (double-click or Enter)', () => {
  it.each<GridId>(['registers', 'memory', 'expressions'])(
    '%s: a row beyond the defined ones starts a new entry in the first free row with the defaults',
    (grid) => {
      const t = startEdit(emptyTables(), grid, 7);
      expect(t.editing[grid]?.row).toBe(0);
      expect(t.selected[grid]).toBe(0);
      const defaults = { registers: NEW_REGISTER, memory: NEW_MEMORY, expressions: NEW_EXPRESSION }[grid];
      expect(t.editing[grid]?.draft).toEqual(defaults);
    },
  );

  it('the defaults are PC == 00000000 L, address 00000000 == 00000000 L R/W, ON with count 01', () => {
    expect(NEW_REGISTER).toEqual({ register: 16, op: 0, value: '00000000', size: 2 });
    expect(NEW_MEMORY).toEqual({ address: '00000000', op: 0, value: '00000000', size: 2, readWrite: 0 });
    expect(NEW_EXPRESSION).toEqual({ enabled: true, tokens: [], count: '01' });
  });

  it('while the editors are shown Set is enabled and Clear / Clear All are disabled', () => {
    let t = addRegister(emptyTables(), 0);
    expect(panelButtons(t).registers).toEqual({ set: false, clear: true, clearAll: true });
    t = startEdit(t, 'registers', 0);
    expect(panelButtons(t).registers).toEqual({ set: true, clear: false, clearAll: false });
    t = cancelEdit(t, 'registers');
    expect(panelButtons(t).registers).toEqual({ set: false, clear: true, clearAll: true });
  });

  it('a defined row is loaded with its own values (the Memory grid no longer reads a register slot)', () => {
    let t = addRegister(emptyTables(), 3, '0000002A');
    t = addMemory(t, '00002000', 2);
    t = updateMemoryDraft(startEdit(t, 'memory', 0), {});
    expect(t.editing.memory?.draft).toEqual({ address: '00002000', op: 0, value: '00000000', size: 2, readWrite: 2 });
    t = startEdit(t, 'registers', 0);
    expect(t.editing.registers?.draft).toEqual({ register: 3, op: 0, value: '0000002A', size: 2 });
  });

  it('Set stores a new row after the last one and an edited row in place', () => {
    let t = addRegister(emptyTables(), 0);
    t = addRegister(t, 1);
    expect(t.registers.map((c) => c.register)).toEqual([0, 1]);
    t = updateRegisterDraft(startEdit(t, 'registers', 0), { register: 7, op: 3, size: 0 });
    t = setEntry(t, 'registers').tables;
    expect(t.registers).toEqual([
      { register: 7, op: 3, value: '00000000', size: 0 },
      { register: 1, op: 0, value: '00000000', size: 2 },
    ]);
    expect(t.editing.registers).toBeNull();
  });

  it('Set with a missing field: "Entry not stored.  Fields missing." and the editors stay', () => {
    const t = updateRegisterDraft(startEdit(emptyTables(), 'registers', 0), { value: '' });
    const result = setEntry(t, 'registers');
    expect(result.message).toBe('Entry not stored.  Fields missing.');
    expect(result.tables).toBe(t);
    const m = updateMemoryDraft(startEdit(emptyTables(), 'memory', 0), { readWrite: -1 });
    expect(setEntry(m, 'memory').message).toBe(M.fieldsMissing);
    const e = updateExpressionDraft(startEdit(addRegister(emptyTables(), 0), 'expressions', 0), { count: '' });
    const withToken = appendCondition(setBuilderField(e, 'register', '01'), 'reg').tables;
    expect(setEntry(withToken, 'expressions').message).toBe(M.fieldsMissing);
  });

  it('Set (Enter) on an empty or incomplete expression does nothing and shows no message', () => {
    // Review of U3: Enter in an empty expression editor showed "Fields missing"; in the original
    // Set is disabled there (setExprButtons), so nothing happens.
    const base = startEdit(addRegister(emptyTables(), 0), 'expressions', 0);
    const empty = setEntry(base, 'expressions');
    expect(empty.message).toBeNull();
    expect(empty.tables).toBe(base);
    const noCount = updateExpressionDraft(base, { count: '' });
    expect(setEntry(noCount, 'expressions').message).toBeNull();
    const open = appendCondition(setBuilderField(base, 'register', '01'), 'reg').tables;
    const hanging = appendSymbol(open, 'AND');
    expect(setEntry(hanging, 'expressions').message).toBeNull();
    expect(setEntry(hanging, 'expressions').tables.editing.expressions).not.toBeNull();
  });

  it('a single click on another row of the grid hides the editors without storing', () => {
    let t = addRegister(emptyTables(), 0);
    t = updateRegisterDraft(startEdit(t, 'registers', 0), { register: 5 });
    t = selectRow(t, 'registers', 3);
    expect(t.editing.registers).toBeNull();
    expect(t.registers[0]?.register).toBe(0);
  });

  it('a grid holds at most 49 rows', () => {
    let t = emptyTables();
    for (let i = 0; i < MAX_ROWS; i++) t = addRegister(t, i % 17);
    expect(t.registers).toHaveLength(49);
    expect(startEdit(t, 'registers', 60)).toBe(t);
    expect(startEdit(t, 'registers', 48).editing.registers?.row).toBe(48);
  });
});

describe('the builder fields follow a click on the Registers or Memory grid', () => {
  it('take the clicked row number as two digits, clamped to the number of defined rows', () => {
    let t = addRegister(addRegister(emptyTables(), 0), 1);
    expect(selectRow(t, 'registers', 0).builder.register).toBe('01');
    expect(selectRow(t, 'registers', 1).builder.register).toBe('02');
    expect(selectRow(t, 'registers', 30).builder.register).toBe('02');
    expect(selectRow(t, 'memory', 4).builder.memory).toBe('00');
    t = addMemory(t, '00001000');
    expect(selectRow(t, 'memory', 4).builder.memory).toBe('01');
    expect(selectRow(t, 'expressions', 4).builder).toEqual(t.builder);
  });
});

describe('the Expression Builder', () => {
  const base = () => addMemory(addMemory(addRegister(addRegister(emptyTables(), 0), 1), '00002000'), '00002002');

  it('enables its buttons only while an expression is edited', () => {
    let t = base();
    expect(panelButtons(t).builder.operand).toBe(false);
    t = startEdit(t, 'expressions', 0);
    expect(panelButtons(t).builder).toEqual({
      operand: true,
      operator: false,
      lparen: true,
      rparen: false,
      backspace: false,
    });
    expect(panelButtons(t).expressions).toEqual({ set: false, clear: false, clearAll: false });
  });

  it('appends conditions by number; an undefined number gives the message and changes nothing', () => {
    let t = startEdit(base(), 'expressions', 0);
    let result = appendCondition(t, 'reg'); // field 00
    expect(result.message).toBe('Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.');
    expect(result.tables).toBe(t);
    t = setBuilderField(t, 'memory', '03');
    result = appendCondition(t, 'mem');
    expect(result.message).toBe('Invalid Memory Breakpoint. Set Memory in Memory area first.');
    // The original then marked "operand entered" and enabled AND / OR; the port does not (note 40).
    expect(panelButtons(result.tables).builder.operator).toBe(false);
    t = setBuilderField(t, 'memory', '02');
    result = appendCondition(t, 'mem');
    expect(result.message).toBeNull();
    expect(result.tables.editing.expressions?.draft.tokens).toEqual([51]);
    expect(panelButtons(result.tables).expressions.set).toBe(true);
  });

  it('builds R1 AND (A1 OR A2) OR R2 with the buttons; disabled buttons do nothing', () => {
    let t = startEdit(base(), 'expressions', 0);
    t = appendSymbol(t, 'AND'); // disabled at the start
    t = appendSymbol(t, ')');
    expect(t.editing.expressions?.draft.tokens).toEqual([]);
    t = addExpression(base(), ['R1', 'AND', '(', 'A1', 'OR', 'A2', ')', 'OR', 'R2']);
    expect(t.expressions[0]?.tokens).toEqual([0, AND, L, 50, OR, 51, R, OR, 1]);
    expect(texts(t)).toEqual([' R1   AND   (   A1  OR   A2   )   OR   R2  ']);
  });

  it('Set is enabled only for a complete expression', () => {
    let t = startEdit(base(), 'expressions', 0);
    t = appendSymbol(t, '(');
    t = appendCondition(setBuilderField(t, 'register', '01'), 'reg').tables;
    expect(panelButtons(t).expressions.set).toBe(false);
    expect(setEntry(t, 'expressions').tables).toBe(t);
    t = appendSymbol(t, ')');
    expect(panelButtons(t).expressions.set).toBe(true);
  });

  it('Backspace removes the last token; at 10 tokens nothing more is appended', () => {
    let t = startEdit(base(), 'expressions', 0);
    for (const part of ['(', '(', '(']) t = appendSymbol(t, part as '(');
    t = setBuilderField(t, 'register', '01');
    for (let i = 0; i < 4; i++) {
      t = appendCondition(t, 'reg').tables;
      if (i < 3) t = appendSymbol(t, 'AND');
    }
    expect(t.editing.expressions?.draft.tokens).toHaveLength(10);
    expect(appendSymbol(t, ')')).toBe(t);
    t = backspace(t);
    expect(t.editing.expressions?.draft.tokens).toHaveLength(9);
    expect(expressionText(t.editing.expressions?.draft.tokens ?? [])).toBe(
      '  (    (    (   R1   AND  R1   AND  R1   AND ',
    );
  });

  it('editing a stored expression continues from its tokens', () => {
    let t = addExpression(base(), ['R1', 'AND', 'A2'], '05');
    t = startEdit(t, 'expressions', 0);
    expect(t.editing.expressions?.draft).toEqual({ enabled: true, tokens: [0, AND, 51], count: '05' });
    expect(panelButtons(t).builder.operator).toBe(true);
    t = updateExpressionDraft(backspace(t), { enabled: false });
    t = appendCondition(setBuilderField(t, 'memory', '01'), 'mem').tables;
    t = setEntry(t, 'expressions').tables;
    expect(t.expressions).toEqual([{ enabled: false, tokens: [0, AND, 50], count: '05' }]);
  });
});

describe('Clear and Clear All', () => {
  it('Clear on a row that is not defined: "Select a Valid Row."', () => {
    const t = selectRow(addRegister(emptyTables(), 0), 'registers', 4);
    expect(planClear(t, 'registers')).toEqual({ kind: 'message', message: 'Select a Valid Row.' });
    expect(planClear(selectRow(emptyTables(), 'expressions', 0), 'expressions')).toEqual({
      kind: 'message',
      message: M.selectValidRow,
    });
  });

  it('Clear removes the selected row and moves the following rows up', () => {
    let t = addRegister(addRegister(addRegister(emptyTables(), 0), 1), 2);
    t = selectRow(t, 'registers', 1);
    const plan = applied(planClear(t, 'registers'));
    expect(plan.tables.registers.map((c) => c.register)).toEqual([0, 2]);
    expect(plan.removedExpressions).toEqual([]);
  });

  it('a Memory Clear moves the memory conditions, not register conditions (note 40)', () => {
    let t = addRegister(emptyTables(), 4);
    t = addMemory(addMemory(addMemory(t, '00001000'), '00002000'), '00003000');
    t = selectRow(t, 'memory', 0);
    const plan = applied(planClear(t, 'memory'));
    expect(plan.tables.memory.map((c) => c.address)).toEqual(['00002000', '00003000']);
    expect(plan.tables.registers).toEqual(t.registers);
  });

  it('deleting a condition renumbers the expressions and removes those that used it', () => {
    let t = addRegister(addRegister(addRegister(emptyTables(), 0), 1), 2);
    t = addMemory(t, '00002000');
    t = addExpression(t, ['R1', 'AND', 'R3']);
    t = addExpression(t, ['R2']);
    t = addExpression(t, ['R3', 'OR', 'A1']);
    expect(texts(t)).toEqual([' R1   AND  R3  ', ' R2  ', ' R3   OR   A1 ']);
    const plan = applied(planClear(selectRow(t, 'registers', 1), 'registers'));
    expect(plan.removedExpressions).toEqual([2]);
    expect(texts(plan.tables)).toEqual([' R1   AND  R2  ', ' R2   OR   A1 ']);
    expect(plan.tables.expressions.map((e) => e.tokens)).toEqual([
      [0, AND, 1],
      [1, OR, 50],
    ]);
  });

  it('deleting a memory condition renumbers only memory references', () => {
    let t = addRegister(addRegister(emptyTables(), 0), 1);
    t = addMemory(addMemory(t, '00002000'), '00003000');
    t = addExpression(t, ['R2', 'AND', 'A2']);
    const plan = applied(planClear(selectRow(t, 'memory', 0), 'memory'));
    expect(plan.removedExpressions).toEqual([]);
    expect(plan.tables.expressions[0]?.tokens).toEqual([1, AND, 50]);
  });

  it('an expression being edited is renumbered with the others, or discarded if it used the condition', () => {
    let t = addRegister(addRegister(emptyTables(), 0), 1);
    t = addExpression(t, ['R1']);
    t = startEdit(t, 'expressions', 5);
    t = appendCondition(setBuilderField(t, 'register', '02'), 'reg').tables;
    let plan = applied(planClear(selectRow(t, 'registers', 0), 'registers'));
    expect(plan.removedExpressions).toEqual([1]);
    expect(plan.tables.editing.expressions).toEqual({ row: 0, draft: { enabled: true, tokens: [0], count: '01' } });
    plan = applied(planClear(selectRow(t, 'registers', 1), 'registers'));
    expect(plan.tables.editing.expressions).toBeNull();
  });

  it('Clear on an expression removes it and moves the following ones up', () => {
    let t = addRegister(emptyTables(), 0);
    t = addExpression(addExpression(addExpression(t, ['R1'], '01'), ['R1'], '02'), ['R1'], '03');
    const plan = applied(planClear(selectRow(t, 'expressions', 0), 'expressions'));
    expect(plan.tables.expressions.map((e) => e.count)).toEqual(['02', '03']);
  });

  it('Clear All empties the grid; for conditions it removes every expression that used one', () => {
    let t = addRegister(emptyTables(), 0);
    t = addMemory(t, '00002000');
    t = addExpression(addExpression(addExpression(t, ['R1']), ['A1']), ['A1', 'OR', 'R1']);
    let plan = applied(planClearAll(t, 'registers'));
    expect(plan.tables.registers).toEqual([]);
    expect(plan.removedExpressions).toEqual([1, 3]);
    expect(texts(plan.tables)).toEqual([' A1 ']);
    plan = applied(planClearAll(t, 'expressions'));
    expect(plan.tables.expressions).toEqual([]);
    expect(plan.removedExpressions).toEqual([]);
    expect(panelButtons(plan.tables).expressions).toEqual({ set: false, clear: false, clearAll: false });
  });
});
