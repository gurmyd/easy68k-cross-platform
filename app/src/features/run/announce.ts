// What the simulator's status bar tells a screen reader (ARCHITECTURE.md 2.11: "a halt ... is
// announced"; errata SH8.md entry 43).
//
// The visible run-state cell changes at every TRAP #15 input wait and host wait (Running, Waiting
// for input, Waiting) and between the ticks of Auto Trace. Those passing states are not announced.
// A hidden polite region announces only the settled ones:
//
//   Halted      after every halt (SIMHALT, task 9, STOP, an error with exceptions off), also one
//               reached with Trace Into
//   Stopped     after a run that stopped without a halt: a breakpoint, Run To Cursor, Step Over,
//               Pause or Rewind of a running program, the end of Auto Trace
//   Auto trace  once, when Auto Trace starts
//
// A Trace Into step that does not halt announces nothing: the Listing moves its selection to the
// new line, which a screen reader already reads. A stop is judged ANNOUNCE_SETTLE_MS after it, by
// the state of that moment, so that a program that runs again at once says nothing, and two
// announcements are at least ANNOUNCE_MIN_GAP_MS apart. Errors are told by the Messages panel's
// own log region and by the message boxes, not here.
//
// Owner: SH8.

import type { AppState } from '../../contracts';
import type { StopCause, StopRecord } from '../../core/run/controller';
import { runStateText } from './status';

/** How long a state must hold before it is announced (milliseconds). */
export const ANNOUNCE_SETTLE_MS = 500;
/** The shortest time between two announcements (milliseconds). */
export const ANNOUNCE_MIN_GAP_MS = 1000;

type SimView = Pick<AppState['sim'], 'phase' | 'halted' | 'autoTrace' | 'menuState'>;

/** The words a stop announces now, or null for none. */
export function stopAnnouncement(stop: Pick<StopRecord, 'after' | 'wasRunning'>, sim: SimView): string | null {
  if (sim.phase !== 'idle' || sim.autoTrace) return null; // running again, or between two Auto Trace ticks
  const text = runStateText(sim);
  if (text === 'Halted') return text;
  if (text !== 'Stopped') return null;
  const ended: Record<StopCause, boolean> = {
    run: stop.wasRunning, // not a Pause or Rewind while nothing was running
    autoTrace: true, // Auto Trace has ended (sim.autoTrace is false)
    trace: false, // the Listing tells the new line
  };
  return ended[stop.after] ? text : null;
}

export interface AnnouncerDeps {
  /** The controller's last stop and the store's simulator state, now. */
  read(): { stop: StopRecord; sim: SimView };
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
  /** Puts the words into the live region. */
  say(text: string): void;
}

/**
 * Decides when to announce; `update()` is called at every change of the controller or the store.
 *
 * The first stop (or start of Auto Trace) not yet announced sets a timer of ANNOUNCE_SETTLE_MS;
 * later events while it runs do not move it, so a stream of them (Auto Trace's ticks, Step Over held
 * down) still announces, at most once per ANNOUNCE_MIN_GAP_MS. When the timer fires, the state of
 * that moment is judged: what is no longer settled (the program runs again) says nothing.
 */
export class RunAnnouncer {
  private stopCount: number;
  private autoTrace: boolean;
  /** A stop, or the start of Auto Trace, waits to be judged. */
  private stopDue = false;
  private autoTraceDue = false;
  private stop: StopRecord;
  private lastSaid = Number.NEGATIVE_INFINITY;
  private cancel: (() => void) | null = null;

  constructor(private readonly deps: AnnouncerDeps) {
    const { stop, sim } = deps.read();
    this.stop = stop;
    this.stopCount = stop.count;
    this.autoTrace = sim.autoTrace;
  }

  update(): void {
    const { stop, sim } = this.deps.read();
    if (stop.count !== this.stopCount) {
      this.stopCount = stop.count;
      this.stop = stop;
      this.stopDue = true;
    }
    if (sim.autoTrace !== this.autoTrace) {
      this.autoTrace = sim.autoTrace;
      if (sim.autoTrace) this.autoTraceDue = true;
    }
    if ((this.stopDue || this.autoTraceDue) && this.cancel === null) this.schedule(ANNOUNCE_SETTLE_MS);
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private schedule(ms: number): void {
    this.cancel = this.deps.setTimer(() => this.fire(), ms);
  }

  private fire(): void {
    this.cancel = null;
    const now = this.deps.now();
    if (now - this.lastSaid < ANNOUNCE_MIN_GAP_MS) {
      this.schedule(this.lastSaid + ANNOUNCE_MIN_GAP_MS - now);
      return;
    }
    const { sim } = this.deps.read();
    let text = this.stopDue ? stopAnnouncement(this.stop, sim) : null;
    if (text === null && this.autoTraceDue && sim.autoTrace && sim.phase === 'idle') text = 'Auto trace';
    this.stopDue = false;
    this.autoTraceDue = false;
    if (text === null) return;
    this.lastSaid = now;
    this.deps.say(text);
  }
}
