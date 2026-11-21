// The simulator's state as the store holds it (ARCHITECTURE.md 3.12.1, 4.6): `AppState.sim`.
//
// The run controller and the UI bridge keep the live state; the store holds a small mirror of it,
// which is what menus, toolbars, the keyboard dispatcher, the window title and the panels read:
// the phase, the command state, the loaded program, the revision counters that tell panels when
// to re-read their data from the session, the message area, the PC breakpoints and the state of
// the Output window. `mirrorSim` builds the next mirror from the previous one and the live state,
// and returns the previous object itself when nothing changed, so that nothing re-renders.
//
// One member is not mirrored: `selectedRow` belongs to the Listing panel (3.11.4); the session
// only puts it back to -1 at a cold start. One has a second writer: `liveRevision` is also bumped
// by interface code that writes memory itself (the Memory panel), so the session passes in the
// store's value plus what the controller counted meanwhile (session.ts), never a smaller number.
//
// Owner: SH8.

import type { AppState, ProgramInfo, SimPhase } from '../../contracts';

type SimState = AppState['sim'];

/** The live state of the simulator, read from the controller, the bridge, the engine and the parts. */
export interface SimLiveState {
  phase: SimPhase;
  program: ProgramInfo | null;
  menuState: 0 | 1;
  halted: boolean;
  autoTrace: boolean;
  keyCommands: boolean;
  logging: boolean;
  /** `RunSnapshot.revision`. */
  regsRevision: number;
  viewRevision: number;
  /** `viewRevision` by panel: how often the engine named each in `host.repaint()` (4.6). */
  repaint: Readonly<NonNullable<SimState['repaint']>>;
  liveRevision: number;
  messageLines: readonly string[];
  breakpoints: readonly number[];
  output: SimState['output'];
}

function sameProgram(a: ProgramInfo | null, b: ProgramInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.title === b.title && a.hasListing === b.hasListing;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
}

type Repaint = NonNullable<SimState['repaint']>;

function sameRepaint(a: Repaint, b: Repaint): boolean {
  return a.listing === b.listing && a.breakpoints === b.breakpoints && a.memory === b.memory && a.stack === b.stack;
}

function sameOutput(a: SimState['output'], b: SimState['output']): boolean {
  return a.width === b.width && a.height === b.height && a.fullScreen === b.fullScreen && a.textWrap === b.textWrap;
}

/** The mirror after `live`; the same object as `sim` when it already says all of it. */
export function mirrorSim(sim: SimState, live: SimLiveState): SimState {
  const next: SimState = {
    program: sameProgram(sim.program, live.program) ? sim.program : live.program,
    phase: live.phase,
    menuState: live.menuState,
    halted: live.halted,
    autoTrace: live.autoTrace,
    keyCommands: live.keyCommands,
    logging: live.logging,
    regsRevision: live.regsRevision,
    viewRevision: live.viewRevision,
    liveRevision: live.liveRevision,
    selectedRow: sim.selectedRow,
    messageLines: sameList(sim.messageLines, live.messageLines) ? sim.messageLines : [...live.messageLines],
    breakpoints: sameList(sim.breakpoints, live.breakpoints) ? sim.breakpoints : [...live.breakpoints],
    output: sameOutput(sim.output, live.output) ? sim.output : { ...live.output },
    repaint: sim.repaint !== undefined && sameRepaint(sim.repaint, live.repaint) ? sim.repaint : { ...live.repaint },
  };
  const keys = Object.keys(next) as (keyof SimState)[];
  return keys.every((key) => next[key] === sim[key]) ? sim : next;
}
