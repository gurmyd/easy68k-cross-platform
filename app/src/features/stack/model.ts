// The Stack panel's state and actions (ARCHITECTURE.md 2.6; sim-ui §11). Owner: U2.
//
// One model per window, created by the feature's init(). It only reads the engine (registers,
// memory, the memory map); the Stack panel changes nothing in the simulator.
//
// Refresh moments (sim-ui §11.4, ARCHITECTURE.md 4.6):
//   - updateDisplay() - re-centre on the selected register and redraw: `sim.viewRevision` changes
//     (scrshow), the `View` choice changes, the panel is shown, after a cold start;
//   - DisplayStack() - redraw without re-centring: the spin buttons and the wheel, a resize, and
//     `sim.liveRevision` changes (a Memory-panel edit, sim-ui §11.4) unless a full-speed run is in
//     progress (the window is not refreshed during a run).
// Between those moments the panel shows its last paint. The engine is always read through
// `ctx.sim.engine`, because a cold start replaces it.

import type { AppContext } from '../../contracts';
import { MapKind } from '../../contracts';
import {
  DEFAULT_STACK_CHOICE,
  centreOn,
  scrollMid,
  stackRegister,
  stackRows,
  stackWheelSteps,
  type StackRow,
} from './rules';

export interface StackPanelState {
  /** Index of the `View` list: 0-6 A0-A6, 7 US, 8 SS. */
  choice: number;
  midAddr: number;
  aregAddr: number;
  rows: number;
  view: readonly StackRow[];
  paints: number;
}

type Listener = () => void;

function validChoice(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= 8 ? value : DEFAULT_STACK_CHOICE;
}

export class StackPanelModel {
  private state: StackPanelState;
  private readonly listeners = new Set<Listener>();
  private wheelRest = 0;

  constructor(private readonly ctx: AppContext) {
    // FormCreate: the view starts on A[8] whatever the choice; FormShow re-centres.
    const choice = validChoice(ctx.settings.get().sim.whichStack);
    const { aregAddr, midAddr } = centreOn(stackRegister(ctx.sim.engine.registers(), 8));
    this.state = { choice, midAddr, aregAddr, rows: 0, view: [], paints: 0 };
  }

  start(): () => void {
    let last = this.ctx.store.getState().sim;
    const offStore = this.ctx.store.subscribe(() => {
      const now = this.ctx.store.getState().sim;
      if (now.viewRevision !== last.viewRevision) {
        last = now;
        this.updateDisplay();
      } else if (now.liveRevision !== last.liveRevision) {
        last = now;
        if (now.phase !== 'running') this.displayStack();
      } else {
        last = now;
      }
    });
    const offEngine = this.ctx.sim.onEngineReplaced(() => this.coldStart());
    return () => {
      offStore();
      offEngine();
    };
  }

  getState = (): StackPanelState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<StackPanelState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** updateDisplay(): the selected register's address on the middle row, then a redraw. */
  updateDisplay(): void {
    const value = stackRegister(this.ctx.sim.engine.registers(), this.state.choice);
    const { aregAddr, midAddr } = centreOn(value);
    this.state = { ...this.state, aregAddr, midAddr };
    this.displayStack();
  }

  /** DisplayStack(): redraw from the engine without moving the view. */
  displayStack(): void {
    const engine = this.ctx.sim.engine;
    const registers = engine.registers();
    const memory = engine.memory;
    const map = engine.hardware().map[MapKind.Invalid] ?? { enabled: false, start: 0, end: 0 };
    const view = stackRows({
      midAddr: this.state.midAddr,
      aregAddr: this.state.aregAddr,
      rows: this.state.rows,
      a7: registers.a7,
      invalid: map,
      byteAt: (address) => memory[address] ?? 0,
    });
    this.set({ view, paints: this.state.paints + 1 });
  }

  /** The panel became visible (FormShow). */
  shown(): void {
    this.updateDisplay();
  }

  /** The rows that fit (FormResize). */
  setRows(rows: number): void {
    const n = Math.max(0, Math.floor(rows));
    if (n === this.state.rows) return;
    this.state = { ...this.state, rows: n };
    this.displayStack();
  }

  /** The `View` list (whichStackChange). The choice is remembered (sim68K.dat line 19). */
  setChoice(choice: number): void {
    const next = validChoice(choice);
    this.state = { ...this.state, choice: next };
    if (this.ctx.settings.get().sim.whichStack !== next) {
      this.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, whichStack: next } }));
    }
    this.updateDisplay();
  }

  /** Spin up / wheel up: one row towards lower addresses. */
  scrollUp(): void {
    this.state = { ...this.state, midAddr: scrollMid(this.state.midAddr, -1) };
    this.displayStack();
  }

  /** Spin down / wheel down: one row towards higher addresses. */
  scrollDown(): void {
    this.state = { ...this.state, midAddr: scrollMid(this.state.midAddr, 1) };
    this.displayStack();
  }

  wheel(deltaY: number, deltaMode: number): void {
    const { steps, rest } = stackWheelSteps(this.wheelRest, deltaY, deltaMode);
    this.wheelRest = rest;
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps > 0) this.scrollDown();
      else this.scrollUp();
    }
  }

  /** After a cold start (4.7.1 step 4): the saved choice, re-centred on the new engine. */
  coldStart(): void {
    this.state = { ...this.state, choice: validChoice(this.ctx.settings.get().sim.whichStack) };
    this.updateDisplay();
  }
}

const models = new WeakMap<AppContext, StackPanelModel>();

/** The window's Stack panel model (created on first use). */
export function stackModelOf(ctx: AppContext): StackPanelModel {
  let model = models.get(ctx);
  if (!model) {
    model = new StackPanelModel(ctx);
    models.set(ctx, model);
  }
  return model;
}
