// The Memory panel's state and actions (ARCHITECTURE.md 2.6; sim-ui §10). Owner: U2.
//
// One model per window, created by the feature's init() and kept for the life of the window, so
// that the panel keeps its address, cursor, fields and Live box while it is hidden, as the
// original's window did. The React view (MemoryPanel.tsx) only renders the state and forwards
// events; everything that can be decided without a DOM is decided here and in rules.ts.
//
// Engine access follows ground rule 8 and 3.11.2: the model READS `ctx.sim.engine.memory`
// directly (always through the property: a cold start replaces the engine) and every write goes
// through the run controller: a typed byte through `controller.pokeMemory`, Copy and Fill through
// `controller.invoke(engine => engine.writeBytes(...))`, the Live box through
// `controller.invoke(engine => engine.setOption(SimOption.MemLive, ...))`.
//
// Refresh moments (4.6, sim-ui §10.4):
//   - the engine names the Memory window in host.repaint (scrshow: a stop, a trace step): the
//     store's `sim.repaint.memory` changes, or `sim.viewRevision` while `sim.repaint` is absent;
//   - `sim.liveRevision` changes (memory changed: a Memory-panel edit, a live write);
//   - the panel's own navigation, editing, Copy and Fill;
//   - with Live checked: once per display frame, if a visible byte differs from what is shown.
//     This is the port's "redraw visible rows that changed" (sim-ui §10.4), which also works while
//     the top row is address 0, where the original's test fails (parity matrix 1.3.7, ~38).
// Between those moments the panel shows the bytes of its last paint, so that during a full-speed
// run without Live it is static, as the original's window is.
//
// After a typed byte the controller bumps `sim.liveRevision` ("memory / hardware changed", 3.12.1);
// after Copy and Fill, which write through `controller.invoke`, the model bumps it itself. That is
// how the Stack panel learns that it must redraw without re-centring (sim-ui §11.4) - see
// docs/porting/errata/U2.md, "Contract".

import type { AppContext, AppState } from '../../contracts';
import { SimOption } from '../../contracts';
import { byteForCodePoint } from '../../core/codec/cp1252';
import {
  APPLICATION_TITLE,
  MEMSIZE,
  MSG_INVALID_COPY,
  MSG_INVALID_FILL,
  MSG_INVALID_SAVE,
  MSG_INVALID_SAVE_TITLE,
  MSG_SAVE_FAILED,
  MSG_SAVE_FAILED_TITLE,
  addressFieldText,
  fieldValue,
  gotoRC,
  keyCharCode,
  memoryRow,
  moveCell,
  pageDown,
  pageUp,
  planCopy,
  planFill,
  planSave,
  rowDown,
  rowUp,
  topAddressOf,
  typeChar,
  wheelSteps,
  type Cell,
  type MemoryRow,
} from './rules';

/** Blank texts of the From / To fields (6 digits) and the Bytes field (8 digits). */
export const BLANK_ADDRESS = '000000';
export const BLANK_BYTES = '00000000';

/** The question of Save for a file that exists (Memory1.cpp:646, MB_YESNO). */
export const OVERWRITE_PROMPT = { title: 'Alert', text: 'File exists! OK to replace?' } as const;

/** The Address field persists to `SimSettings.memoryAddress` this long after its last change. */
export const PERSIST_DELAY_MS = 500;

export interface MemoryPanelState {
  /** Address of the top row: a multiple of 16, 0..$FFFFF0. */
  address: number;
  /** Rows that fit the panel (nRows). */
  rows: number;
  /** The cursor cell, or null before the first click or key. */
  cursor: Cell | null;
  from: string;
  to: string;
  bytes: string;
  live: boolean;
  /** The rows of the last paint. */
  view: readonly MemoryRow[];
  /** Increases with every paint (tests and the view's key). */
  paints: number;
}

type Listener = () => void;

/**
 * Whether the store says the Memory panel must re-read its rows: `liveRevision` moved ("memory
 * changed"), or the engine named the Memory window in `host.repaint` - `sim.repaint.memory` moved,
 * or, while the session does not publish `sim.repaint` (an optional member, W1 errata entry 11),
 * `viewRevision` moved, which moves with every repaint.
 */
export function memoryRepaintDue(before: AppState['sim'], now: AppState['sim']): boolean {
  if (now.liveRevision !== before.liveRevision) return true;
  if (now.repaint !== undefined) return now.repaint.memory !== before.repaint?.memory;
  return now.viewRevision !== before.viewRevision;
}

export class MemoryPanelModel {
  private state: MemoryPanelState;
  private readonly listeners = new Set<Listener>();
  /** The bytes of the last paint, for the Live comparison. */
  private painted = new Uint8Array(0);
  private wheelRest = 0;
  private stopFrames: (() => void) | null = null;
  private cancelPersist: (() => void) | null = null;
  private persistedAddress: number;

  constructor(private readonly ctx: AppContext) {
    const saved = ctx.settings.get().sim.memoryAddress;
    const address = clampTop(topAddressOf(saved & 0xffffff));
    this.persistedAddress = address;
    this.state = {
      address,
      rows: 0,
      cursor: null,
      from: BLANK_ADDRESS,
      to: BLANK_ADDRESS,
      bytes: BLANK_BYTES,
      live: false,
      view: [],
      paints: 0,
    };
  }

  /** Connects the model to the store and the session; returns the disconnect. */
  start(): () => void {
    let last = this.ctx.store.getState().sim;
    const offStore = this.ctx.store.subscribe(() => {
      const now = this.ctx.store.getState().sim;
      const due = memoryRepaintDue(last, now);
      last = now;
      if (due) this.repaint();
    });
    const offEngine = this.ctx.sim.onEngineReplaced(() => this.coldStart());
    return () => {
      offStore();
      offEngine();
      this.stopFrames?.();
      this.stopFrames = null;
      this.flushPersist();
    };
  }

  getState = (): MemoryPanelState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<MemoryPanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** The text of the Address field. */
  get addressText(): string {
    return addressFieldText(this.state.address);
  }

  /* ---------------------------------------------------------------- painting */

  /** Re-reads the visible rows from the engine (the original's Repaint()). */
  repaint(): void {
    const { address, rows } = this.state;
    const memory = this.ctx.sim.engine.memory;
    const view: MemoryRow[] = [];
    for (let r = 0; r < rows; r++) view.push(memoryRow(address + r * 16, (a) => memory[a] ?? 0));
    this.painted = memory.slice(Math.min(address, MEMSIZE), Math.min(address + rows * 16, MEMSIZE));
    this.set({ view, paints: this.state.paints + 1 });
  }

  /** With Live on: repaints when a visible byte differs from what the panel shows. */
  pollLive(): boolean {
    const { address, rows } = this.state;
    const memory = this.ctx.sim.engine.memory;
    const start = Math.min(address, MEMSIZE);
    const end = Math.min(address + rows * 16, MEMSIZE);
    const painted = this.painted;
    let changed = painted.length !== end - start;
    for (let i = 0; !changed && i < painted.length; i++) changed = memory[start + i] !== painted[i];
    if (changed) this.repaint();
    return changed;
  }

  /** The number of rows that fit (FormResize). */
  setRows(rows: number): void {
    const n = Math.max(0, Math.floor(rows));
    if (n === this.state.rows) return;
    this.state = { ...this.state, rows: n };
    this.repaint();
  }

  /* ---------------------------------------------------------------- navigation */

  /** Address1Change: a new text of the Address field (rounded down to 16, rewritten as six digits). */
  setAddressText(text: string): void {
    this.setAddress(fieldValue(text));
  }

  /** Sets the top row (also the Registers panel's double-click, through `sim.view.memory`). */
  setAddress(value: number): void {
    this.goTo(clampTop(topAddressOf(value & 0xffffff)));
  }

  private goTo(address: number): void {
    if (address !== this.state.address) {
      this.state = { ...this.state, address };
      this.schedulePersist();
    }
    this.repaint();
  }

  rowUp(): void {
    this.goTo(rowUp(this.state.address));
  }
  rowDown(): void {
    this.goTo(rowDown(this.state.address));
  }
  pageUp(): void {
    this.goTo(pageUp(this.state.address, this.state.rows));
  }
  pageDown(): void {
    this.goTo(pageDown(this.state.address, this.state.rows));
  }

  /** The mouse wheel: one row per notch, up = lower addresses. */
  wheel(deltaY: number, deltaMode: number): void {
    const { steps, rest } = wheelSteps(this.wheelRest, deltaY, deltaMode);
    this.wheelRest = rest;
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps > 0) this.rowDown();
      else this.rowUp();
    }
  }

  /* ---------------------------------------------------------------- the cursor and editing */

  /** Places the cursor (a click on a cell, FormMouseDown + gotoRC). */
  place(cell: Cell): void {
    const placed = gotoRC(cell.row, cell.col, this.state.rows);
    if (placed.scroll < 0) this.rowUp();
    else if (placed.scroll > 0) this.rowDown();
    this.set({ cursor: { row: placed.row, col: placed.col } });
  }

  /** Puts a cursor at the first byte if there is none yet (the rows area got the keyboard focus). */
  ensureCursor(): void {
    if (this.state.cursor === null) this.place({ row: 0, col: 0 });
  }

  /** Arrow keys on the rows area. */
  moveCursor(key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): void {
    const cell = this.state.cursor ?? gotoRC(0, 0, this.state.rows);
    this.place(moveCell(cell, key));
  }

  /**
   * A key that produced a character on the rows area. Returns false where the original beeps
   * (the port has no system sound; the key is simply ignored).
   */
  typeKey(key: string, modifiers: { ctrl: boolean; alt: boolean; meta: boolean }): boolean | null {
    const code = keyCharCode(key, modifiers, byteForCodePoint);
    if (code === null) return null;
    return this.typeCode(code);
  }

  /** FormKeyPress with an 8-bit character. False = the original beeps. */
  typeCode(code: number): boolean {
    this.ensureCursor();
    const cell = this.state.cursor;
    if (cell === null) return false;
    const memory = this.ctx.sim.engine.memory;
    const result = typeChar(this.state.address, cell, code, (a) => memory[a] ?? 0);
    if (result.kind === 'beep') return false;
    // The controller bumps `liveRevision` for a direct write itself (RunController.pokeMemory), so
    // the Hardware and Stack panels redraw; the panel repaints its own rows at once in any case.
    this.ctx.sim.controller.pokeMemory(result.address, result.value);
    this.place(result.next);
    this.repaint();
    return true;
  }

  /**
   * Tells the other panels that memory changed (the Stack panel redraws, sim-ui §10.3) after a
   * write through `controller.invoke`: the contract (RunController.pokeMemory) leaves that bump to
   * the interface code that writes.
   */
  private announceMemoryChange(): void {
    this.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, liveRevision: state.sim.liveRevision + 1 } }));
  }

  /* ---------------------------------------------------------------- fields */

  setFrom(text: string): void {
    this.set({ from: text });
  }
  setTo(text: string): void {
    this.set({ to: text });
  }
  setBytes(text: string): void {
    this.set({ bytes: text });
  }

  setLive(live: boolean): void {
    if (live === this.state.live) return;
    this.set({ live });
    this.ctx.sim.controller.invoke((engine) => engine.setOption(SimOption.MemLive, live));
    this.stopFrames?.();
    this.stopFrames = null;
    if (live) {
      this.stopFrames = this.ctx.scheduler.onFrame(() => {
        this.pollLive();
      });
      this.repaint();
    }
  }

  /* ---------------------------------------------------------------- Copy, Fill, Save */

  private box(title: string, text: string, icon: 'none' | 'information' = 'none'): Promise<string> {
    return this.ctx.dialogs.messageBox({ title, text, icon, buttons: ['OK'] });
  }

  /** The Copy button. Resolves when the message box (if any) is closed. */
  async copy(): Promise<void> {
    const plan = planCopy(fieldValue(this.state.from), fieldValue(this.state.to), fieldValue(this.state.bytes));
    if (plan.kind === 'invalid') {
      await this.box(APPLICATION_TITLE, MSG_INVALID_COPY);
      return;
    }
    if (plan.count > 0) {
      this.ctx.sim.controller.invoke((engine) => {
        const source = engine.memory.slice(plan.from, plan.from + plan.count);
        engine.writeBytes(plan.to, source);
        this.announceMemoryChange();
      });
    }
    this.repaint();
    if (plan.stopped) await this.box(APPLICATION_TITLE, MSG_INVALID_COPY);
  }

  /** The Fill button. */
  async fill(): Promise<void> {
    const plan = planFill(fieldValue(this.state.from), fieldValue(this.state.to), fieldValue(this.state.bytes));
    if (plan.kind === 'none') return;
    if (plan.data.length > 0) {
      this.ctx.sim.controller.invoke((engine) => {
        engine.writeBytes(plan.from, plan.data);
        this.announceMemoryChange();
      });
    }
    this.repaint();
    if (plan.stopped) await this.box(APPLICATION_TITLE, MSG_INVALID_FILL);
  }

  /** The Save button: From through To, inclusive, as a raw binary file. */
  async save(): Promise<void> {
    const plan = planSave(fieldValue(this.state.from), fieldValue(this.state.to));
    if (plan.kind === 'invalid') {
      await this.box(MSG_INVALID_SAVE_TITLE, MSG_INVALID_SAVE);
      return;
    }
    // The original's TSaveDialog: no title of its own (Windows shows "Save As"), no filter,
    // default extension "bin". For an existing file the original asks its own question
    // (Memory1.cpp:646); the file dialog asks it in its place (SaveRequest.overwritePrompt).
    const path = await this.ctx.fileDialogs.save({
      title: 'Save As',
      filters: [{ label: 'All Files (*.*)', patterns: ['*.*'] }],
      defaultExt: 'bin',
      overwritePrompt: OVERWRITE_PROMPT,
    });
    if (path === null) return;
    try {
      const data = this.ctx.sim.engine.memory.slice(plan.from, plan.from + plan.length);
      await this.ctx.vfs.writeFile(path, data);
    } catch {
      await this.box(MSG_SAVE_FAILED_TITLE, MSG_SAVE_FAILED, 'information');
    }
  }

  /* ---------------------------------------------------------------- cold start, settings */

  /**
   * After a cold start (4.7.1 and the table of 3.3.2): Live off, From / To / Bytes empty, the
   * address from the saved settings, and a paint from the new engine.
   */
  coldStart(): void {
    this.stopFrames?.();
    this.stopFrames = null;
    this.cancelPersist?.();
    this.cancelPersist = null;
    const saved = clampTop(topAddressOf(this.ctx.settings.get().sim.memoryAddress & 0xffffff));
    this.persistedAddress = saved;
    this.state = {
      ...this.state,
      address: saved,
      from: BLANK_ADDRESS,
      to: BLANK_ADDRESS,
      bytes: BLANK_BYTES,
      live: false,
    };
    this.repaint();
  }

  private schedulePersist(): void {
    this.cancelPersist?.();
    this.cancelPersist = this.ctx.scheduler.setTimer(PERSIST_DELAY_MS, () => {
      this.cancelPersist = null;
      this.persist();
    });
  }

  private flushPersist(): void {
    if (this.cancelPersist === null) return;
    this.cancelPersist();
    this.cancelPersist = null;
    this.persist();
  }

  private persist(): void {
    const address = this.state.address;
    if (address === this.persistedAddress) return;
    this.persistedAddress = address;
    this.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, memoryAddress: address } }));
  }
}

/** The highest top row the original allows: MEMSIZE - 16. */
function clampTop(address: number): number {
  return Math.min(Math.max(0, address), MEMSIZE - 16);
}

const models = new WeakMap<AppContext, MemoryPanelModel>();

/** The window's Memory panel model (created on first use). */
export function memoryModelOf(ctx: AppContext): MemoryPanelModel {
  let model = models.get(ctx);
  if (!model) {
    model = new MemoryPanelModel(ctx);
    models.set(ctx, model);
  }
  return model;
}
