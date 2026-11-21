// The three grids of the Break Points panel and everything the user does with them (ARCHITECTURE.md
// 2.6, note 40; sim-ui §12.2). Owner: U3.
//
// A `BreakpointTables` value holds the defined rows of the Registers, Memory and Expression Builder
// grids, the row being edited in each grid (the original's in-place editors), the selected row of
// each grid and the two 2-digit fields of the builder row. Every user action is a pure function
// from one value to the next; the feature (features/breakpoints) shows the messages these functions
// name, asks the confirmation they ask for and sends the result to the engine (slots.ts).
//
// The original's behaviour that is kept: consecutive rows (a new entry always goes into the first
// free row), the default values of a new entry, which buttons are enabled when, the messages, the
// builder field taking the clicked row's number (clamped to the number of defined rows), at most 49
// rows per grid (50 grid rows including the header) and 10 tokens per expression.
//
// The editor defects of sim-ui §12.2 that note 40 fixes:
//   - Clear moves the stored conditions with the rows (the original mixed register slots into the
//     memory slots on a Memory Clear, and the Expression Clear mixed the selected and the edited
//     row);
//   - editing an existing row starts from that row's own values (the original pre-selected the
//     Memory combo boxes from a register slot);
//   - deleting a condition renumbers the references in the expressions and removes the expressions
//     that used it (after a confirmation the feature asks); the original kept stale indexes;
//   - Backspace removes exactly one token's text; a refused `PC/Reg` / `Memory` append changes
//     nothing; rows cannot be dragged and the lists cannot be typed into (the port's grid and lists
//     do not offer it);
//   - an expression's counter slot (`id`) is always its row number (the original kept the old id
//     of a row that moved up, so two expressions could share a hit counter).
//   - `Count` is read as decimal (10.2 O-10).

import {
  MAX_TOKENS,
  TOKEN_AND,
  TOKEN_LPAREN,
  TOKEN_OR,
  TOKEN_RPAREN,
  builderButtons,
  conditionToken,
  expressionComplete,
  renumberTokens,
  usesTable,
  type BuilderButtons,
} from './expression';

/** Data rows of each grid: 50 grid rows including the header row (`def.h:196-198`). */
export const MAX_ROWS = 49;

/** `PC/Reg` choices; the index is the engine's `typeId` (0-7 D0-D7, 8-15 A0-A7, 16 PC). */
export const REGISTER_CHOICES = [
  'D0',
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'D7',
  'A0',
  'A1',
  'A2',
  'A3',
  'A4',
  'A5',
  'A6',
  'A7',
  'PC',
] as const;
/** `typeId` of `PC` (`PC_TYPE_ID`), the default of a new register condition. */
export const PC_CHOICE = 16;
/** `Op` choices of a register condition; the index is the engine's `op`. */
export const REGISTER_OPS = ['==', '!=', '>', '>=', '<', '<='] as const;
/** `Op` choices of a memory condition; `N/A` (6) skips the comparison. */
export const MEMORY_OPS = ['==', '!=', '>', '>=', '<', '<=', 'N/A'] as const;
/** `Size` choices; the index is the engine's `size`. Default `L`. */
export const SIZE_CHOICES = ['B', 'W', 'L'] as const;
export const LONG_SIZE = 2;
/** `R/W` choices of a memory condition; the index is the engine's `readWrite`. Default `R/W`. */
export const READ_WRITE_CHOICES = ['R/W', 'Read', 'Write', 'N/A'] as const;
/** `Enabled` choices of an expression. Only `ON` enables it. */
export const ENABLED_CHOICES = ['ON', 'OFF'] as const;

/** The original's message boxes (`Application->MessageBox(text, NULL, MB_OK)`: title `Error`, no icon). */
export const BREAKPOINT_MESSAGES = {
  title: 'Error',
  fieldsMissing: 'Entry not stored.  Fields missing.',
  selectValidRow: 'Select a Valid Row.',
  invalidRegister: 'Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.',
  invalidMemory: 'Invalid Memory Breakpoint. Set Memory in Memory area first.',
} as const;

/** One row of the Registers grid. `value` is the 8-digit hex text of the `Value` field. */
export interface RegisterCondition {
  register: number; // index into REGISTER_CHOICES
  op: number; // index into REGISTER_OPS
  value: string;
  size: number; // index into SIZE_CHOICES
}

/** One row of the Memory grid. `address` and `value` are 8-digit hex texts. */
export interface MemoryCondition {
  address: string;
  op: number; // index into MEMORY_OPS
  value: string;
  size: number;
  readWrite: number; // index into READ_WRITE_CHOICES
}

/** One row of the Expression Builder grid. `count` is the 2-digit decimal text of `Count`. */
export interface BreakExpressionRow {
  enabled: boolean;
  tokens: readonly number[]; // infix, coded as in expression.ts
  count: string;
}

export type GridId = 'registers' | 'memory' | 'expressions';

export interface RowEdit<T> {
  /** 0-based row the editors stand on: a defined row, or the first free row for a new entry. */
  row: number;
  draft: T;
}

export interface BreakpointTables {
  registers: readonly RegisterCondition[];
  memory: readonly MemoryCondition[];
  expressions: readonly BreakExpressionRow[];
  editing: {
    registers: RowEdit<RegisterCondition> | null;
    memory: RowEdit<MemoryCondition> | null;
    expressions: RowEdit<BreakExpressionRow> | null;
  };
  /** The selected row of each grid, 0-based (-1: none). */
  selected: Record<GridId, number>;
  /** The 2-digit fields next to `PC/Reg` and `Memory` (blank: `00`, as the original's empty mask). */
  builder: { register: string; memory: string };
}

/** The panel at start-up and after a cold start: every grid empty. */
export function emptyTables(): BreakpointTables {
  return {
    registers: [],
    memory: [],
    expressions: [],
    editing: { registers: null, memory: null, expressions: null },
    selected: { registers: 0, memory: 0, expressions: 0 },
    builder: { register: '00', memory: '00' },
  };
}

/** Defaults of a new entry (`RegStringGridDblClick` and the others, `BREAKPOINTSu.cpp:905-1013`). */
export const NEW_REGISTER: RegisterCondition = { register: PC_CHOICE, op: 0, value: '00000000', size: LONG_SIZE };
export const NEW_MEMORY: MemoryCondition = {
  address: '00000000',
  op: 0,
  value: '00000000',
  size: LONG_SIZE,
  readWrite: 0,
};
export const NEW_EXPRESSION: BreakExpressionRow = { enabled: true, tokens: [], count: '01' };

/** Number of defined rows of a grid. */
export function rowCount(tables: BreakpointTables, grid: GridId): number {
  return tables[grid].length;
}

/** Two digits, as the original writes a row number into a builder field. */
function twoDigits(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * A row of a grid was selected by a click or the arrow keys (`RegStringGridClick` and the others).
 * The editors of that grid are hidden without storing when the row differs from the edited one
 * ("a single click on a grid ... discards the entry in progress"). In the Registers and Memory
 * grids the row's number, clamped to the number of defined rows, goes into the builder field.
 */
export function selectRow(tables: BreakpointTables, grid: GridId, row: number): BreakpointTables {
  const editing = tables.editing[grid];
  const next: BreakpointTables = {
    ...tables,
    selected: { ...tables.selected, [grid]: row },
    editing: editing && editing.row !== row ? { ...tables.editing, [grid]: null } : tables.editing,
  };
  if (grid === 'expressions') return next;
  const number = twoDigits(Math.min(row + 1, rowCount(tables, grid)));
  return {
    ...next,
    builder: grid === 'registers' ? { ...next.builder, register: number } : { ...next.builder, memory: number },
  };
}

/**
 * Double-click (or Enter) on a row: a row beyond the defined ones starts a new entry in the first
 * free row with the default values; a defined row is loaded into the editors with its own values.
 */
export function startEdit(tables: BreakpointTables, grid: GridId, row: number): BreakpointTables {
  const count = rowCount(tables, grid);
  const isNew = row >= count;
  const at = isNew ? count : row;
  if (at >= MAX_ROWS) return tables;
  let editing: BreakpointTables['editing'];
  switch (grid) {
    case 'registers':
      editing = {
        ...tables.editing,
        registers: { row: at, draft: isNew ? NEW_REGISTER : (tables.registers[at] as RegisterCondition) },
      };
      break;
    case 'memory':
      editing = {
        ...tables.editing,
        memory: { row: at, draft: isNew ? NEW_MEMORY : (tables.memory[at] as MemoryCondition) },
      };
      break;
    case 'expressions':
      editing = {
        ...tables.editing,
        expressions: { row: at, draft: isNew ? NEW_EXPRESSION : (tables.expressions[at] as BreakExpressionRow) },
      };
      break;
  }
  return { ...tables, editing, selected: { ...tables.selected, [grid]: at } };
}

/** Changes fields of the entry being edited in a grid. */
export function updateRegisterDraft(tables: BreakpointTables, patch: Partial<RegisterCondition>): BreakpointTables {
  const edit = tables.editing.registers;
  if (!edit) return tables;
  return { ...tables, editing: { ...tables.editing, registers: { ...edit, draft: { ...edit.draft, ...patch } } } };
}
export function updateMemoryDraft(tables: BreakpointTables, patch: Partial<MemoryCondition>): BreakpointTables {
  const edit = tables.editing.memory;
  if (!edit) return tables;
  return { ...tables, editing: { ...tables.editing, memory: { ...edit, draft: { ...edit.draft, ...patch } } } };
}
export function updateExpressionDraft(
  tables: BreakpointTables,
  patch: Partial<Pick<BreakExpressionRow, 'enabled' | 'count'>>,
): BreakpointTables {
  const edit = tables.editing.expressions;
  if (!edit) return tables;
  return { ...tables, editing: { ...tables.editing, expressions: { ...edit, draft: { ...edit.draft, ...patch } } } };
}

/** Hides a grid's editors without storing (Escape, a click elsewhere in the grid). */
export function cancelEdit(tables: BreakpointTables, grid: GridId): BreakpointTables {
  if (!tables.editing[grid]) return tables;
  return { ...tables, editing: { ...tables.editing, [grid]: null } };
}

/** Result of an action that may show one of the original's message boxes. */
export interface ActionResult {
  tables: BreakpointTables;
  /** Text of the message box to show (title BREAKPOINT_MESSAGES.title), or null. */
  message: string | null;
}

const ok = (tables: BreakpointTables): ActionResult => ({ tables, message: null });

function isIndex(value: number, choices: readonly unknown[]): boolean {
  return Number.isInteger(value) && value >= 0 && value < choices.length;
}

/** A field is missing when its text is empty or its list has nothing chosen. */
function registerMissing(draft: RegisterCondition): boolean {
  return (
    !isIndex(draft.register, REGISTER_CHOICES) ||
    !isIndex(draft.op, REGISTER_OPS) ||
    draft.value === '' ||
    !isIndex(draft.size, SIZE_CHOICES)
  );
}
function memoryMissing(draft: MemoryCondition): boolean {
  return (
    draft.address === '' ||
    !isIndex(draft.op, MEMORY_OPS) ||
    draft.value === '' ||
    !isIndex(draft.readWrite, READ_WRITE_CHOICES) ||
    !isIndex(draft.size, SIZE_CHOICES)
  );
}
function expressionMissing(draft: BreakExpressionRow): boolean {
  return draft.tokens.length === 0 || draft.count === '';
}

function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  const next = [...list];
  next[index] = item;
  return next;
}

/**
 * `Set`: stores the entry being edited into its row (a new row is appended) and hides the editors.
 * A missing field gives `Entry not stored.  Fields missing.` and keeps the editors. Without an
 * entry being edited, and for an incomplete expression, `Set` is disabled: nothing happens.
 */
export function setEntry(tables: BreakpointTables, grid: GridId): ActionResult {
  const editing = { ...tables.editing, [grid]: null };
  switch (grid) {
    case 'registers': {
      const edit = tables.editing.registers;
      if (!edit) return ok(tables);
      if (registerMissing(edit.draft)) return { tables, message: BREAKPOINT_MESSAGES.fieldsMissing };
      return ok({ ...tables, editing, registers: replaceAt(tables.registers, edit.row, edit.draft) });
    }
    case 'memory': {
      const edit = tables.editing.memory;
      if (!edit) return ok(tables);
      if (memoryMissing(edit.draft)) return { tables, message: BREAKPOINT_MESSAGES.fieldsMissing };
      return ok({ ...tables, editing, memory: replaceAt(tables.memory, edit.row, edit.draft) });
    }
    case 'expressions': {
      const edit = tables.editing.expressions;
      if (!edit) return ok(tables);
      // Set is disabled for an empty or incomplete expression (`setExprButtons`), so Enter, which
      // stands for Set, must do nothing there: the disabled state is tested before the fields.
      if (!expressionComplete(edit.draft.tokens)) return ok(tables);
      if (expressionMissing(edit.draft)) return { tables, message: BREAKPOINT_MESSAGES.fieldsMissing };
      return ok({ ...tables, editing, expressions: replaceAt(tables.expressions, edit.row, edit.draft) });
    }
  }
}

/**
 * What `Clear` or `Clear All` will do. `message`: a message box instead of any change.
 * Otherwise `tables` is the result, and `removedExpressions` lists the 1-based rows of the
 * expressions that used a deleted condition and are removed with it: when it is not empty the
 * feature asks for a confirmation first (note 40).
 */
export type ClearPlan =
  { kind: 'message'; message: string } | { kind: 'apply'; tables: BreakpointTables; removedExpressions: number[] };

/** Applies the deletion of condition slots to the expressions (and an expression being edited). */
function dropConditions(
  tables: BreakpointTables,
  removedSlots: (tokens: readonly number[]) => number[] | null,
): ClearPlan {
  const removed: number[] = [];
  const expressions: BreakExpressionRow[] = [];
  tables.expressions.forEach((expression, index) => {
    const tokens = removedSlots(expression.tokens);
    if (tokens === null) removed.push(index + 1);
    else expressions.push(tokens === expression.tokens ? expression : { ...expression, tokens });
  });
  let editingExpr = tables.editing.expressions;
  if (editingExpr) {
    const tokens = removedSlots(editingExpr.draft.tokens);
    if (tokens === null)
      editingExpr = null; // the entry in progress used a deleted condition: discarded
    else {
      // The edited row moves up with the rows before it that are removed.
      const row =
        editingExpr.row - removed.filter((r) => r - 1 < (editingExpr as RowEdit<BreakExpressionRow>).row).length;
      editingExpr = { row, draft: { ...editingExpr.draft, tokens } };
    }
  }
  return {
    kind: 'apply',
    removedExpressions: removed,
    tables: { ...tables, expressions, editing: { ...tables.editing, expressions: editingExpr } },
  };
}

/**
 * `Clear`: removes the selected row if it is a defined one and moves the following rows up; on any
 * other row `Select a Valid Row.`. For a condition, the expressions are renumbered and those that
 * used it are removed (see ClearPlan).
 */
export function planClear(tables: BreakpointTables, grid: GridId): ClearPlan {
  const row = tables.selected[grid];
  const count = rowCount(tables, grid);
  if (row < 0 || row >= count) return { kind: 'message', message: BREAKPOINT_MESSAGES.selectValidRow };
  const without = <T>(list: readonly T[]) => list.filter((_item, index) => index !== row);
  switch (grid) {
    case 'expressions':
      return {
        kind: 'apply',
        removedExpressions: [],
        tables: {
          ...tables,
          expressions: without(tables.expressions),
          editing: { ...tables.editing, expressions: null },
        },
      };
    case 'registers':
    case 'memory': {
      const slot = conditionToken(grid === 'registers' ? 'reg' : 'mem', row + 1);
      const base: BreakpointTables =
        grid === 'registers'
          ? { ...tables, registers: without(tables.registers), editing: { ...tables.editing, registers: null } }
          : { ...tables, memory: without(tables.memory), editing: { ...tables.editing, memory: null } };
      return dropConditions(base, (tokens) => renumberTokens(tokens, slot));
    }
  }
}

/** `Clear All`: empties the grid; for a condition grid, removes the expressions that used one. */
export function planClearAll(tables: BreakpointTables, grid: GridId): ClearPlan {
  switch (grid) {
    case 'expressions':
      return {
        kind: 'apply',
        removedExpressions: [],
        tables: { ...tables, expressions: [], editing: { ...tables.editing, expressions: null } },
      };
    case 'registers':
    case 'memory': {
      const table = grid === 'registers' ? 'reg' : 'mem';
      const base: BreakpointTables =
        grid === 'registers'
          ? { ...tables, registers: [], editing: { ...tables.editing, registers: null } }
          : { ...tables, memory: [], editing: { ...tables.editing, memory: null } };
      return dropConditions(base, (tokens) => (usesTable(tokens, table) ? null : (tokens as number[])));
    }
  }
}

/** The builder fields take two decimal digits (mask `99;0;0`). */
export function setBuilderField(
  tables: BreakpointTables,
  field: 'register' | 'memory',
  text: string,
): BreakpointTables {
  return { ...tables, builder: { ...tables.builder, [field]: text } };
}

function appendToken(tables: BreakpointTables, token: number): BreakpointTables {
  const edit = tables.editing.expressions;
  if (!edit || edit.draft.tokens.length >= MAX_TOKENS) return tables;
  return {
    ...tables,
    editing: {
      ...tables.editing,
      expressions: { ...edit, draft: { ...edit.draft, tokens: [...edit.draft.tokens, token] } },
    },
  };
}

/**
 * `PC/Reg` or `Memory`: appends the condition whose number is in the field next to the button. A
 * number that is not a defined row gives the original's message and appends nothing. Does nothing
 * while the button is disabled.
 */
export function appendCondition(tables: BreakpointTables, kind: 'reg' | 'mem'): ActionResult {
  const tokens = tables.editing.expressions?.draft.tokens ?? null;
  if (!builderButtons(tokens).operand) return ok(tables);
  const text = kind === 'reg' ? tables.builder.register : tables.builder.memory;
  const n = /^\d+$/.test(text) ? Number.parseInt(text, 10) : 0;
  const count = rowCount(tables, kind === 'reg' ? 'registers' : 'memory');
  if (n < 1 || n > count) {
    return {
      tables,
      message: kind === 'reg' ? BREAKPOINT_MESSAGES.invalidRegister : BREAKPOINT_MESSAGES.invalidMemory,
    };
  }
  return ok(appendToken(tables, conditionToken(kind, n)));
}

/** `AND`, `OR`, `(`, `)`; does nothing while the button is disabled. */
export function appendSymbol(tables: BreakpointTables, symbol: 'AND' | 'OR' | '(' | ')'): BreakpointTables {
  const buttons = builderButtons(tables.editing.expressions?.draft.tokens ?? null);
  switch (symbol) {
    case 'AND':
      return buttons.operator ? appendToken(tables, TOKEN_AND) : tables;
    case 'OR':
      return buttons.operator ? appendToken(tables, TOKEN_OR) : tables;
    case '(':
      return buttons.lparen ? appendToken(tables, TOKEN_LPAREN) : tables;
    case ')':
      return buttons.rparen ? appendToken(tables, TOKEN_RPAREN) : tables;
  }
}

/** `Backspace`: removes the last token. */
export function backspace(tables: BreakpointTables): BreakpointTables {
  const edit = tables.editing.expressions;
  if (!edit || edit.draft.tokens.length === 0) return tables;
  return {
    ...tables,
    editing: {
      ...tables.editing,
      expressions: { ...edit, draft: { ...edit.draft, tokens: edit.draft.tokens.slice(0, -1) } },
    },
  };
}

/** Enabled state of `Set`, `Clear` and `Clear All` of one grid. */
export interface GridButtons {
  set: boolean;
  clear: boolean;
  clearAll: boolean;
}

/** Every button of the panel. */
export interface PanelButtons {
  registers: GridButtons;
  memory: GridButtons;
  expressions: GridButtons;
  builder: BuilderButtons;
}

/**
 * `setRegButtons`, `setAddrButtons`, `setExprButtons` (`BREAKPOINTSu.cpp:167-297`): while the
 * editors are shown `Set` is enabled (for an expression only when it is complete) and `Clear` /
 * `Clear All` are disabled; otherwise `Set` is disabled and `Clear` / `Clear All` are enabled when
 * the grid has at least one defined row.
 */
export function panelButtons(tables: BreakpointTables): PanelButtons {
  const grid = (id: GridId): GridButtons => {
    const edit = tables.editing[id];
    if (edit) {
      const set = id === 'expressions' ? expressionComplete((edit.draft as BreakExpressionRow).tokens) : true;
      return { set, clear: false, clearAll: false };
    }
    const any = rowCount(tables, id) > 0;
    return { set: false, clear: any, clearAll: any };
  };
  return {
    registers: grid('registers'),
    memory: grid('memory'),
    expressions: grid('expressions'),
    builder: builderButtons(tables.editing.expressions?.draft.tokens ?? null),
  };
}
