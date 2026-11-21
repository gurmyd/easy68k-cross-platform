// Test support: a small simulator session over a real engine, for the tests of this feature and for
// its browser check. Never imported by the application.
//
// The real session and run controller are SH8's (features/run/session.ts, core/run/); the
// application uses them, and real-session.test.ts and the browser check's "real application" pass
// test this feature on them. This double stays for the tests that drive the panels without the rest
// of Simulator mode. It follows the SimSession and RunController contracts (3.11.2) and the refresh
// rules of 4.6 closely enough for the panels of the main window:
//
//   - every engine call is followed by afterEngineCall(): the host calls recorded since the last
//     one are examined; registersShown() refreshes the snapshot (twenty boxText() values, cycles,
//     listingHighlight, halt) and bumps sim.regsRevision; repaint() bumps sim.viewRevision;
//     message() / messagesClear() change sim.messageLines; alert() adds a PendingAlert;
//   - invoke(), editBox() and clearCycles() run at once (nothing is ever in progress here);
//   - open() loads bytes the test registered with `files`, then listing.refresh();
//   - coldStart() releases the engine, makes a new one, refreshes and tells onEngineReplaced.
//
// The engine comes from the test (app/src/engine/testing.ts createTestEngine, which a feature may
// not import): `bench` is the engine and the list of host calls its recording host made.

import {
  RunStatus,
  type Box,
  type AppContext,
  type Bytes,
  type ControllerRequest,
  type InputEvent68k,
  type LoadOrigin,
  type PendingAlert,
  type ProgramInfo,
  type RunController,
  type RunSnapshot,
  type SimEngine,
  type SimPhase,
  type SimSession,
  type VPath,
} from '../../contracts';
import { decode } from '../../core/codec/cp1252';
import { ListingView } from '../../core/listing/view';
import { createInertSimSession } from '../../state/stub-services';

/** An engine and the calls its host received (the shape of engine/testing.ts TestEngine). */
export interface EngineBench {
  engine: SimEngine;
  calls: { method: string; args: unknown[] }[];
  release(): void;
}

export interface SessionDouble extends SimSession {
  readonly controller: RunController & DoubleController;
  readonly listing: ListingView;
  /** Program files that open() can load, by path: the .S68 bytes and the .L68 bytes (or null). */
  readonly programs: Map<VPath, { s68: Bytes; l68: Bytes | null }>;
}

export interface DoubleController {
  /** Every invoke / editBox / clearCycles / command, in order (for assertions). */
  readonly log: string[];
  /** Current number of holds. */
  readonly holds: number;
  /** Loads raw bytes as `open` would (no file lookup). */
  loadBytes(path: VPath, s68: Bytes, l68: Bytes | null, origin?: LoadOrigin): void;
}

function boxesOf(engine: SimEngine): string[] {
  return Array.from({ length: 20 }, (_unused, box) => engine.boxText(box as Box));
}

/**
 * The session double. `create` makes a new engine for coldStart(); without it a cold start keeps
 * the engine and only resets the bookkeeping.
 */
export function createSessionDouble(
  ctx: AppContext,
  first: EngineBench,
  create?: () => Promise<EngineBench>,
): SessionDouble {
  const inert = createInertSimSession(ctx);
  let bench = first;
  let seen = bench.calls.length;
  const listeners = new Set<() => void>();
  const replacedListeners = new Set<() => void>();
  const programs = new Map<VPath, { s68: Bytes; l68: Bytes | null }>();
  const log: string[] = [];
  let holds = 0;
  let phase: SimPhase = 'idle';
  let program: ProgramInfo | null = null;
  let alerts: PendingAlert[] = [];
  let snapshot: RunSnapshot = {
    boxes: boxesOf(bench.engine),
    cycles: bench.engine.cycles,
    highlight: bench.engine.listingHighlight,
    halted: bench.engine.state().halt,
    revision: 1,
  };
  const listing = new ListingView(() => bench.engine);
  listing.refresh();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const sim = (change: (current: ReturnType<typeof ctx.store.getState>['sim']) => Partial<typeof current>) =>
    ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, ...change(state.sim) } }));

  function refreshSnapshot(): void {
    const engine = bench.engine;
    snapshot = {
      boxes: boxesOf(engine),
      cycles: engine.cycles,
      highlight: engine.listingHighlight,
      halted: engine.state().halt,
      revision: snapshot.revision + 1,
    };
  }

  /** 4.6: act on what the engine reported during the call that just returned. */
  function afterEngineCall(): void {
    const calls = bench.calls;
    let shown = false;
    let repainted = false;
    const lines: string[] = [];
    let cleared = false;
    for (; seen < calls.length; seen++) {
      const call = calls[seen];
      if (!call) continue;
      switch (call.method) {
        case 'registersShown':
          shown = true;
          break;
        case 'repaint':
          repainted = true;
          break;
        case 'message':
          lines.push(decode(call.args[0] as Bytes));
          break;
        case 'messagesClear':
          cleared = true;
          lines.length = 0;
          break;
        case 'alert':
          alerts = [...alerts, { title: decode(call.args[0] as Bytes), text: decode(call.args[1] as Bytes) }];
          break;
        default:
          break;
      }
    }
    if (shown) refreshSnapshot();
    sim((state) => ({
      phase,
      program,
      halted: snapshot.halted,
      regsRevision: shown ? state.regsRevision + 1 : state.regsRevision,
      viewRevision: repainted ? state.viewRevision + 1 : state.viewRevision,
      messageLines:
        cleared || lines.length > 0 ? [...(cleared ? [] : state.messageLines), ...lines] : state.messageLines,
    }));
    notify();
  }

  /** Runs until the program stops, serving the waits (alerts are answered OK at once). */
  function runToStop(): void {
    const engine = bench.engine;
    phase = 'running';
    for (let slices = 0; slices < 2000; slices++) {
      const status = engine.run(100_000);
      if (status === RunStatus.Running) continue;
      if (status === RunStatus.WaitDelay) {
        engine.delayElapsed(engine.delayRemaining);
        continue;
      }
      if (status === RunStatus.WaitAlert) {
        afterEngineCall();
        engine.dismissAlert();
        continue;
      }
      break;
    }
    phase = 'idle';
    afterEngineCall();
  }

  const controller: RunController & DoubleController = {
    get phase() {
      return phase;
    },
    get held() {
      return holds > 0;
    },
    get program() {
      return program;
    },
    get snapshot() {
      return snapshot;
    },
    get alerts() {
      return alerts;
    },
    get log() {
      return log;
    },
    get holds() {
      return holds;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    loadBytes(path, s68, l68, origin = 'open') {
      log.push(`load ${path}`);
      bench.engine.load(s68, l68, {
        name: path,
        kind: origin === 'reload' ? 'reload' : origin === 'open' ? 'open' : 'drop',
      });
      afterEngineCall();
      listing.refresh();
      program = { path, title: path, hasListing: l68 !== null };
      afterEngineCall();
    },
    async open(path, origin) {
      const file = programs.get(path);
      if (!file) throw new Error(`session double: no program registered at ${path}`);
      controller.loadBytes(path, file.s68, file.l68, origin);
    },
    async openData() {},
    async reload() {
      if (program) await controller.open(program.path, 'reload');
    },
    async close() {
      log.push('close');
      bench.engine.close();
      afterEngineCall();
      listing.refresh();
      afterEngineCall();
    },
    async coldStart() {
      log.push('coldStart');
      if (create) {
        bench.release();
        bench = await create();
        seen = 0;
      }
      program = null;
      afterEngineCall();
      refreshSnapshot();
      listing.refresh();
      sim((state) => ({ regsRevision: state.regsRevision + 1, program: null }));
      for (const listener of [...replacedListeners]) listener();
      notify();
    },

    run() {
      log.push('run');
      bench.engine.cmdRun();
      runToStop();
    },
    runToCursor(row) {
      log.push(`runToCursor ${row}`);
      bench.engine.cmdRunToCursor(row);
      runToStop();
    },
    stepOver() {
      log.push('stepOver');
      bench.engine.cmdStepOver();
      runToStop();
    },
    traceInto() {
      log.push('traceInto');
      bench.engine.cmdTraceInto();
      afterEngineCall();
    },
    autoTrace() {
      log.push('autoTrace');
    },
    pause() {
      log.push('pause');
      bench.engine.cmdPause();
      phase = 'idle';
      afterEngineCall();
    },
    rewind() {
      log.push('rewind');
      bench.engine.rewind();
      phase = 'idle';
      afterEngineCall();
    },
    dismissAlerts() {
      if (alerts.length === 0) return;
      alerts = [];
      bench.engine.dismissAlert();
      afterEngineCall();
    },
    post(entry: InputEvent68k | ControllerRequest) {
      if ('kind' in entry && entry.kind === 'call') controller.invoke(entry.fn);
    },
    invoke(fn) {
      log.push('invoke');
      fn(bench.engine);
      afterEngineCall();
    },
    hold() {
      holds++;
      notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds--;
        notify();
      };
    },
    editBox(box, text) {
      log.push(`editBox ${box} ${text}`);
      bench.engine.editBox(box, text);
      afterEngineCall();
    },
    pokeMemory(address, value) {
      bench.engine.writeBytes(address, [value]);
    },
    clearCycles() {
      log.push('clearCycles');
      bench.engine.clearCycles();
      snapshot = { ...snapshot, cycles: bench.engine.cycles, revision: snapshot.revision + 1 };
      sim((state) => ({ regsRevision: state.regsRevision + 1 }));
      notify();
    },
  };

  return {
    ...inert,
    get engine() {
      return bench.engine;
    },
    controller,
    listing,
    programs,
    onEngineReplaced(listener) {
      replacedListeners.add(listener);
      return () => {
        replacedListeners.delete(listener);
      };
    },
  };
}
