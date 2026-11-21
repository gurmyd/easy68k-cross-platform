// The Break Points panel's state and actions, one per window (ARCHITECTURE.md 2.6, note 40;
// sim-ui §12.2). Owner: U3.
//
// The grids and every rule of the panel are in core/breakpoints (pure functions). This model holds
// the current value, shows the message boxes those functions name, asks the confirmation before a
// deleted condition takes expressions with it, and sends every change of the stored rows to the
// engine through the run controller (`controller.invoke`, section 0 rule 8): only the slots that
// changed (core/breakpoints/slots.ts).
//
// Nothing is saved and nothing is cleared by Open, Reload or Rewind (sim-ui §12.2). A cold start
// gives a new engine in start-up state (4.7.1), so the grids are emptied with it.

import type { AppContext, MessageBoxRequest, SimEngine } from '../../contracts';
import {
  BREAKPOINT_MESSAGES,
  FRESH_SLOTS,
  appendCondition,
  appendSymbol,
  applySlotChanges,
  backspace,
  cancelEdit,
  emptyTables,
  panelButtons,
  planClear,
  planClearAll,
  selectRow,
  setBuilderField,
  setEntry,
  slotChanges,
  slotsOf,
  startEdit,
  updateExpressionDraft,
  updateMemoryDraft,
  updateRegisterDraft,
  type BreakExpressionRow,
  type BreakpointTables,
  type ClearPlan,
  type EngineSlots,
  type GridId,
  type MemoryCondition,
  type PanelButtons,
  type RegisterCondition,
} from '../../core/breakpoints';

/** What the model needs from the application. */
export interface BreakpointsDeps {
  messageBox(request: MessageBoxRequest): Promise<string>;
  /** RunController.invoke: runs at once or between instructions. */
  invoke(fn: (engine: SimEngine) => void): void;
  /** SimSession.onEngineReplaced. */
  onEngineReplaced(listener: () => void): () => void;
}

/** The dependencies from the application context (read at each use: they exist after bootstrap). */
export function depsOf(ctx: AppContext): BreakpointsDeps {
  return {
    messageBox: (request) => ctx.dialogs.messageBox(request),
    invoke: (fn) => ctx.sim.controller.invoke(fn),
    onEngineReplaced: (listener) => ctx.sim.onEngineReplaced(listener),
  };
}

/** Title of the port's confirmation (note 40; the original has none). */
export const CONFIRM_TITLE = 'Break Points';

/**
 * The confirmation before conditions are deleted that expressions use (note 40):
 * `Expression 2 uses this condition and is removed with it.`
 * `Expressions 1, 3 use these conditions and are removed with them.`
 */
export function confirmText(rows: readonly number[], all: boolean): string {
  const list = rows.join(', ');
  const what = all ? 'these conditions' : 'this condition';
  const them = all ? 'them' : 'it';
  return rows.length === 1
    ? `Expression ${list} uses ${what} and is removed with ${them}.`
    : `Expressions ${list} use ${what} and are removed with ${them}.`;
}

export interface BreakpointsView {
  tables: BreakpointTables;
  buttons: PanelButtons;
}

type Listener = () => void;

export class BreakpointsModel {
  private view: BreakpointsView = { tables: emptyTables(), buttons: panelButtons(emptyTables()) };
  /** What the engine holds (what was last sent to it). */
  private sent: EngineSlots = FRESH_SLOTS;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly deps: BreakpointsDeps) {}

  /** Starts following the engine; returns the stop function. */
  start(): () => void {
    return this.deps.onEngineReplaced(() => this.engineReplaced());
  }

  getState = (): BreakpointsView => this.view;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get tables(): BreakpointTables {
    return this.view.tables;
  }

  /** Takes a new value; sends the slots that changed to the engine. */
  private commit(tables: BreakpointTables): void {
    if (tables === this.view.tables) return;
    const slots = slotsOf(tables);
    const changes = slotChanges(this.sent, slots);
    this.sent = slots;
    this.view = { tables, buttons: panelButtons(tables) };
    if (changes.length > 0) this.deps.invoke((engine) => void applySlotChanges(engine, changes));
    for (const listener of [...this.listeners]) listener();
  }

  private async show(message: string | null): Promise<void> {
    if (message === null) return;
    await this.deps.messageBox({ title: BREAKPOINT_MESSAGES.title, text: message, icon: 'none', buttons: ['OK'] });
  }

  /* ---- grids ---- */

  select(grid: GridId, row: number): void {
    this.commit(selectRow(this.tables, grid, row));
  }

  /** Double-click or Enter on a row. */
  edit(grid: GridId, row: number): void {
    this.commit(startEdit(this.tables, grid, row));
  }

  cancel(grid: GridId): void {
    this.commit(cancelEdit(this.tables, grid));
  }

  updateRegister(patch: Partial<RegisterCondition>): void {
    this.commit(updateRegisterDraft(this.tables, patch));
  }

  updateMemory(patch: Partial<MemoryCondition>): void {
    this.commit(updateMemoryDraft(this.tables, patch));
  }

  updateExpression(patch: Partial<Pick<BreakExpressionRow, 'enabled' | 'count'>>): void {
    this.commit(updateExpressionDraft(this.tables, patch));
  }

  /** `Set`. */
  async set(grid: GridId): Promise<void> {
    const result = setEntry(this.tables, grid);
    this.commit(result.tables);
    await this.show(result.message);
  }

  /** `Clear`. */
  clear(grid: GridId): Promise<void> {
    return this.carryOut(() => planClear(this.tables, grid), false);
  }

  /** `Clear All`. */
  clearAll(grid: GridId): Promise<void> {
    return this.carryOut(() => planClearAll(this.tables, grid), true);
  }

  private async carryOut(plan: () => ClearPlan, all: boolean): Promise<void> {
    const before = this.tables;
    const first = plan();
    if (first.kind === 'message') return this.show(first.message);
    if (first.removedExpressions.length > 0) {
      const answer = await this.deps.messageBox({
        title: CONFIRM_TITLE,
        text: confirmText(first.removedExpressions, all),
        icon: 'confirmation',
        buttons: ['OK', 'Cancel'],
      });
      if (answer !== 'OK') return;
    }
    // Something may have changed while the question was open (a cold start): plan again.
    const final = this.tables === before ? first : plan();
    if (final.kind === 'apply') this.commit(final.tables);
  }

  /* ---- builder row ---- */

  setBuilderField(field: 'register' | 'memory', text: string): void {
    this.commit(setBuilderField(this.tables, field, text));
  }

  /** `PC/Reg` (`reg`) or `Memory` (`mem`). */
  async appendCondition(kind: 'reg' | 'mem'): Promise<void> {
    const result = appendCondition(this.tables, kind);
    this.commit(result.tables);
    await this.show(result.message);
  }

  appendSymbol(symbol: 'AND' | 'OR' | '(' | ')'): void {
    this.commit(appendSymbol(this.tables, symbol));
  }

  backspace(): void {
    this.commit(backspace(this.tables));
  }

  /** A cold start replaced the engine: it holds no breakpoint, and the grids are emptied with it. */
  engineReplaced(): void {
    this.sent = FRESH_SLOTS;
    const tables = emptyTables();
    this.view = { tables, buttons: panelButtons(tables) };
    for (const listener of [...this.listeners]) listener();
  }
}

const models = new WeakMap<AppContext, BreakpointsModel>();

/** The window's Break Points model (created on first use). */
export function breakpointsModelOf(ctx: AppContext): BreakpointsModel {
  let model = models.get(ctx);
  if (!model) {
    model = new BreakpointsModel(depsOf(ctx));
    models.set(ctx, model);
  }
  return model;
}
