// TEST DOUBLE for the run controller (contracts RunController), used by the Output feature's own
// tests and by its browser check. Never imported by the application.
//
// The real controller (core/run, work package SH8) is written at the same time as the Output
// panel. This one is the smallest loop that lets a real engine run a real program and receive the
// panel's input the way ARCHITECTURE.md section 4 describes it:
//
//   - one queue (4.3): keyDown (with its character and its pasted text, in one go), keyUp, char,
//     ioActivated and the three mouse entries are applied as the table of 4.3 says; while the
//     program runs, at most one input edge is delivered per sub-slice, so a press and a release
//     that arrive together are both seen by a polling program;
//   - a tick runs the engine in sub-slices and serves the wait states (4.4): no run() while a
//     keyboard read waits; a delay is reported in periods of 10 ms of the clock; a message box of
//     the engine is recorded and dismissed at once; a file dialog is cancelled;
//   - a key or mouse event that arms an interrupt wakes an idle program (4.3, "Wake-up").
//
// It has no speed governor, no timers, no loads, no register snapshot and no holds beyond a count.

import {
  RunStatus,
  type Clock,
  type ControllerRequest,
  type InputEvent68k,
  type PendingAlert,
  type RunController,
  type RunSnapshot,
  type Scheduler,
  type SimEngine,
  type SimPhase,
} from '../../../contracts';

/** Instructions between two looks at the queue (4.2 `SUBSLICE`). */
export const SUBSLICE = 2000;

export interface MiniControllerDeps {
  engine: () => SimEngine;
  clock: Clock;
  scheduler: Scheduler;
  /** Instructions per tick; default 40,000 (twenty sub-slices). */
  perTick?: number;
}

type Entry = InputEvent68k | ControllerRequest;

const INPUT_EDGES: ReadonlySet<Entry['kind']> = new Set(['keyDown', 'keyUp', 'char', 'mouseDown', 'mouseUp']);

export class MiniController implements RunController {
  phase: SimPhase = 'idle';
  readonly program = null;
  readonly snapshot: RunSnapshot = { boxes: [], cycles: 0n, highlight: -1, halted: false, revision: 0 };
  /** The message boxes the engine opened, oldest first; each was dismissed at once. */
  readonly alerts: PendingAlert[] = [];
  /** Every entry that was delivered to the engine, in order: for tests. */
  readonly delivered: Entry[] = [];

  private readonly queue: Entry[] = [];
  private readonly listeners = new Set<() => void>();
  private holds = 0;
  private delayStart = 0;
  private delayReported = 0;
  private stopFrames: (() => void) | null = null;
  private tickPending = false;

  constructor(private readonly deps: MiniControllerDeps) {}

  get held(): boolean {
    return this.holds > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Calls tick() once per display frame from now on. */
  start(): void {
    this.stopFrames ??= this.deps.scheduler.onFrame(() => this.tick());
  }

  stop(): void {
    this.stopFrames?.();
    this.stopFrames = null;
  }

  /* ---- commands */

  run(): void {
    this.deps.engine().cmdRun();
    this.setPhase('running');
    this.tick();
  }

  pause(): void {
    this.deps.engine().cmdPause();
    this.setPhase('idle');
  }

  rewind(): void {
    this.deps.engine().rewind();
    this.setPhase('idle');
  }

  /* ---- the queue (4.3) */

  post(entry: Entry): void {
    this.queue.push(entry);
    if (this.tickPending) return;
    this.tickPending = true;
    this.deps.scheduler.setTimer(0, () => {
      this.tickPending = false;
      this.tick();
    });
  }

  invoke(fn: (engine: SimEngine) => void): void {
    fn(this.deps.engine());
  }

  hold(): () => void {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
    };
  }

  /** One step of progress (4.2): delivers the queue, serves a delay, runs a slice. */
  tick(): void {
    this.deliverQueue();
    if (this.held) return;
    if (this.phase === 'waitDelay') this.serviceDelay();
    if (this.phase !== 'running') return;
    const engine = this.deps.engine();
    let budget = this.deps.perTick ?? 20 * SUBSLICE;
    while (this.phase === 'running' && budget > 0) {
      const count = Math.min(SUBSLICE, budget);
      budget -= count;
      this.handleStatus(engine.run(count));
      this.deliverQueue();
    }
  }

  private deliverQueue(): void {
    const engine = this.deps.engine();
    while (this.queue.length > 0) {
      const entry = this.queue.shift() as Entry;
      this.apply(entry);
      this.delivered.push(entry);
      if (this.phase === 'idle' && engine.state().runMode) this.setPhase('running');
      if (this.phase === 'running' && INPUT_EDGES.has(entry.kind)) return; // the rest waits a sub-slice
    }
  }

  private apply(entry: Entry): void {
    const engine = this.deps.engine();
    const waiting = this.phase === 'waitInput';
    switch (entry.kind) {
      case 'keyDown': {
        const enabled = engine.keyDown(entry.vk);
        let typed = false;
        if (entry.ch !== undefined) {
          engine.keyChar(entry.ch);
          typed = true;
        }
        if (entry.paste && enabled) {
          for (const ch of entry.paste) engine.keyChar(ch); // consecutively, no instruction in between
          typed ||= entry.paste.length > 0;
        }
        if (waiting && typed) this.handleStatus(engine.run(SUBSLICE));
        break;
      }
      case 'keyUp':
        engine.keyUp(entry.vk);
        break;
      case 'char':
        engine.keyChar(entry.ch);
        if (waiting) this.handleStatus(engine.run(SUBSLICE));
        break;
      case 'ioActivated':
        engine.ioActivated();
        break;
      case 'mouseDown':
        engine.mouseDown(entry.x, entry.y, entry.shift);
        break;
      case 'mouseUp':
        engine.mouseUp(entry.x, entry.y, entry.shift);
        break;
      case 'mouseMove':
        engine.mouseMove(entry.x, entry.y, entry.shift);
        break;
      case 'call':
        entry.fn(engine);
        break;
      default:
        break; // hardware requests and file dialogs play no part in the Output panel's tests
    }
  }

  private handleStatus(status: RunStatus): void {
    const engine = this.deps.engine();
    switch (status) {
      case RunStatus.Running:
        if (this.phase !== 'running') this.setPhase('running');
        break;
      case RunStatus.WaitInput:
        this.setPhase('waitInput');
        break;
      case RunStatus.WaitDelay:
        if (this.phase !== 'waitDelay') {
          this.delayStart = this.deps.clock.now();
          this.delayReported = 0;
          this.setPhase('waitDelay');
        }
        break;
      case RunStatus.WaitAlert:
        engine.dismissAlert();
        this.handleStatus(engine.run(SUBSLICE));
        break;
      case RunStatus.WaitHost:
        engine.fileDialogReply(false);
        this.handleStatus(engine.run(SUBSLICE));
        break;
      default:
        this.setPhase('idle'); // Stopped, Error, Busy
    }
  }

  private serviceDelay(): void {
    const engine = this.deps.engine();
    const periods = Math.floor((this.deps.clock.now() - this.delayStart) / 10) - this.delayReported;
    if (periods > 0) {
      engine.delayElapsed(Math.min(periods, engine.delayRemaining));
      this.delayReported += periods;
    }
    if (engine.delayRemaining === 0) this.setPhase('running');
  }

  private setPhase(phase: SimPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    for (const listener of [...this.listeners]) listener();
  }

  /* ---- not needed by the Output panel's tests */

  async open(): Promise<void> {}
  async openData(): Promise<void> {}
  async reload(): Promise<void> {}
  async close(): Promise<void> {}
  async coldStart(): Promise<void> {}
  runToCursor(): void {}
  stepOver(): void {}
  traceInto(): void {}
  autoTrace(): void {}
  dismissAlerts(): void {}
  editBox(): void {}
  pokeMemory(address: number, value: number): void {
    this.deps.engine().writeBytes(address, [value]);
  }
  clearCycles(): void {}
}
