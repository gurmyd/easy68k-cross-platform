// Test support for the Memory and Stack panels: a small simulator session that follows the
// SimSession contract (3.11.2) over any engine, and a scheduler that moves only when told.
// Owner: U2. Used by the unit tests of features/memory and features/stack only.
//
// The session's controller does what the contract says the real one (SH8) does for these panels:
// `pokeMemory` writes one byte at once, `invoke` runs the function at once (no engine call is ever
// in progress here). `coldStart()` replaces `engine` with a new instance and then runs the
// `onEngineReplaced` listeners, as 4.7.1 step 5 says.
//
// The engine comes from a factory the test passes, so that this file imports no engine module
// (features may not import app/src/engine, 3.1): tests pass `createTestEngine` of
// app/src/engine/testing.ts, or `createInertEngine` of state/stub-services.ts.

import {
  MapKind,
  type AppContext,
  type MapRow,
  type Registers,
  type RunController,
  type Scheduler,
  type SimEngine,
  type SimPhase,
  type SimSession,
} from '../../contracts';
import { createInertEngine } from '../../state/stub-services';

export interface SessionDouble extends SimSession {
  /** Every pokeMemory call, oldest first. */
  readonly pokes: [address: number, value: number][];
  /** Every invoke call, counted. */
  readonly invokes: { count: number };
  /** The phase the controller reports (tests set it). */
  phase: SimPhase;
  /** Replaces the engine (4.7.1) and runs the onEngineReplaced listeners. */
  coldStart(): Promise<void>;
  /** The engines this session has used, oldest first. */
  readonly engines: SimEngine[];
}

/**
 * Wraps a session (normally the inert one of state/stub-services.ts, for the parts these panels
 * never touch) with a live engine, a working controller and cold starts.
 */
export function createSessionDouble(
  base: SimSession,
  first: SimEngine,
  next: () => Promise<SimEngine> | SimEngine,
): SessionDouble {
  const engines: SimEngine[] = [first];
  const listeners = new Set<() => void>();
  const pokes: [number, number][] = [];
  const invokes = { count: 0 };
  let engine = first;
  const session = {} as SessionDouble;

  const controller: RunController = {
    ...base.controller,
    get phase() {
      return session.phase;
    },
    get held() {
      return base.controller.held;
    },
    get snapshot() {
      return base.controller.snapshot;
    },
    invoke(fn) {
      invokes.count++;
      fn(engine);
    },
    pokeMemory(address, value) {
      pokes.push([address, value]);
      engine.writeBytes(address, [value & 0xff]);
    },
  };

  Object.defineProperties(session, Object.getOwnPropertyDescriptors(base));
  Object.defineProperties(session, {
    engine: { get: () => engine, enumerable: true },
    controller: { value: controller, enumerable: true },
    onEngineReplaced: {
      value: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    pokes: { value: pokes },
    invokes: { value: invokes },
    engines: { value: engines },
    coldStart: {
      value: async () => {
        engine = await next();
        engines.push(engine);
        for (const listener of [...listeners]) listener();
      },
    },
  });
  session.phase = 'idle';
  return session;
}

/** What a fake engine starts with. */
export interface FakeEngineSetup {
  /** Registers; the rest of `registers()` keeps the start-up values of the inert engine. */
  registers?: Partial<Registers>;
  /** The Invalid row of the memory map. */
  invalid?: MapRow;
  /** Initial memory filler (default $FF, the start-up fill). */
  fill?: number;
}

/**
 * A SimEngine without WebAssembly: the inert engine of state/stub-services.ts with a writable
 * 16 MiB memory, settable registers and a settable Invalid range. Enough for panels that only
 * read memory, registers and the memory map, and write memory.
 */
export function createFakeEngine(setup: FakeEngineSetup = {}): SimEngine & {
  setRegisters(registers: Partial<Registers>): void;
  setInvalid(row: MapRow): void;
} {
  const base = createInertEngine();
  const memory = new Uint8Array(0x1000000).fill(setup.fill ?? 0xff);
  let registers: Registers = { ...base.registers(), ...setup.registers };
  let invalid: MapRow = setup.invalid ?? { enabled: false, start: 0, end: 0 };
  const options = new Map<number, number>();
  const engine = Object.create(base) as SimEngine & {
    setRegisters(registers: Partial<Registers>): void;
    setInvalid(row: MapRow): void;
  };
  Object.defineProperties(engine, {
    memory: { get: () => memory },
    writeBytes: {
      value: (address: number, bytes: ArrayLike<number>) => {
        for (let i = 0; i < bytes.length; i++) memory[(address + i) & 0xffffff] = (bytes[i] ?? 0) & 0xff;
      },
    },
    readByte: { value: (address: number) => memory[address & 0xffffff] ?? 0 },
    registers: { value: () => ({ ...registers, a: [...registers.a], d: [...registers.d] }) },
    hardware: {
      value: () => {
        const hw = base.hardware();
        const map = [...hw.map];
        map[MapKind.Invalid] = { ...invalid };
        return { ...hw, map };
      },
    },
    setOption: { value: (option: number, value: number | boolean) => options.set(option, Number(value)) },
    getOption: { value: (option: number) => options.get(option) ?? 0 },
    setRegisters: {
      value: (next: Partial<Registers>) => {
        registers = { ...registers, ...next };
      },
    },
    setInvalid: {
      value: (row: MapRow) => {
        invalid = row;
      },
    },
  });
  return engine;
}

/** A Scheduler that moves only when the test calls frame() or fireTimers(). */
export class ManualScheduler implements Scheduler {
  private readonly frames = new Set<(now: number) => void>();
  private timers: { due: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now = 0;

  onFrame(fn: (now: number) => void): () => void {
    this.frames.add(fn);
    return () => {
      this.frames.delete(fn);
    };
  }

  setTimer(delayMs: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ due: this.now + delayMs, fn, id });
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    };
  }

  get frameListeners(): number {
    return this.frames.size;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  /** Runs every frame callback once. */
  frame(): void {
    this.now += 16;
    for (const fn of [...this.frames]) fn(this.now);
  }

  /** Moves time forward and runs the timers that are due. */
  advance(ms: number): void {
    this.now += ms;
    const due = this.timers.filter((timer) => timer.due <= this.now);
    this.timers = this.timers.filter((timer) => timer.due > this.now);
    for (const timer of due) timer.fn();
  }
}

/** The answers a test gives to message boxes: reads the open box from the store and closes it. */
export function openMessageBoxes(ctx: AppContext): { key: number; title: string; text: string; icon: string }[] {
  return ctx.store
    .getState()
    .dialogs.stack.filter((dialog) => dialog.id === 'message')
    .map((dialog) => {
      const props = dialog.props as { title: string; text: string; icon: string };
      return { key: dialog.key, title: props.title, text: props.text, icon: props.icon };
    });
}
