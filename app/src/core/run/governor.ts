// The speed governor of the run controller (ARCHITECTURE.md 4.2, 4.5.6).
//
// The port governs execution speed by INSTRUCTION COUNT: the program may execute so many
// instructions per second of real time. The governor keeps the account:
//
//   allowance       instructions the program may execute now. Time adds to it, execution takes
//                   from it. It never exceeds what MAX_CATCHUP_MS of execution are worth, so a
//                   stretch in which the program could not run (heavy drawing, a hidden tab) is
//                   not made up afterwards at full engine speed.
//   time budget     engine time per display frame: at most SLICE_BUDGET_MS and never more than
//                   SLICE_FRAME_SHARE of the measured frame interval, so that input, React and
//                   presenting keep the rest. It is per FRAME, not per tick: a tick between two
//                   frames draws from what the frame has left.
//
// The controller (controller.ts) calls the engine; this class only does the arithmetic, so that it
// can be tested without an engine.
//
// Owner: SH8.

/** Most engine time per frame interval, in milliseconds ... */
export const SLICE_BUDGET_MS = 8;
/** ... and never more than this share of the measured frame interval. */
export const SLICE_FRAME_SHARE = 0.5;
/** Most instructions between two looks at the queue. */
export const SUBSLICE = 2000;
/** Unused allowance never exceeds this much execution time, in milliseconds. */
export const MAX_CATCHUP_MS = 50;
/** Instructions per tick at 'Maximum' speed: a tick ends even when the clock does not move. */
export const MAX_TICK_INSTRUCTIONS = 1_000_000;
/** "EASy68K-like" instructions per second; an estimate until P1 measures the original (4.5.6, O-1). */
export const DEFAULT_IPS = 1_000_000;

/** Instructions between two deliveries of input: at most 2 ms of program time. */
export function subslice(ips: number): number {
  return Math.max(1, Math.min(SUBSLICE, Math.ceil(ips / 500)));
}

/** `SimSettings.speed` (4.5.6). */
export interface SpeedSetting {
  mode: 'original' | 'max' | 'custom';
  instructionsPerSecond: number;
}

/**
 * The rate a speed setting stands for: DEFAULT_IPS for 'EASy68K-like', the custom number (at least
 * 1), and Infinity for 'Maximum', which has no rate, only the per-tick cap.
 */
export function instructionsPerSecond(speed: SpeedSetting): number {
  if (speed.mode === 'max') return Infinity;
  if (speed.mode === 'original') return DEFAULT_IPS;
  const ips = Math.floor(speed.instructionsPerSecond);
  return Number.isFinite(ips) && ips >= 1 ? ips : 1;
}

/** The frame interval assumed before two frames have been seen: 60 Hz. */
export const INITIAL_FRAME_INTERVAL_MS = 1000 / 60;

/** Weight of a new frame interval in the smoothed one. */
const FRAME_SMOOTHING = 0.25;
/** A frame interval outside these bounds (a stalled page, a clock step) counts as the bound. */
const MIN_FRAME_INTERVAL_MS = 1;
const MAX_FRAME_INTERVAL_MS = 1000;

export class Governor {
  /** Instructions the program may execute now. */
  allowance = 0;
  /** Clock time at which the allowance was last topped up. */
  lastSlice = 0;
  /** Smoothed interval between display frames, in milliseconds. */
  frameInterval = INITIAL_FRAME_INTERVAL_MS;
  /** Engine time spent since the last frame began, in milliseconds. */
  usedThisFrame = 0;
  private lastFrame: number | null = null;

  /** A display frame begins: measure the interval and give the frame its whole time budget. */
  frame(now: number): void {
    if (this.lastFrame !== null && now > this.lastFrame) {
      const interval = Math.min(Math.max(now - this.lastFrame, MIN_FRAME_INTERVAL_MS), MAX_FRAME_INTERVAL_MS);
      this.frameInterval += (interval - this.frameInterval) * FRAME_SMOOTHING;
    }
    this.lastFrame = now;
    this.usedThisFrame = 0;
  }

  /**
   * The program starts running (a run command, the end of a wait, a wake-up): the first
   * instructions execute at once.
   */
  enter(now: number, speed: SpeedSetting): void {
    this.lastSlice = now;
    this.allowance = subslice(instructionsPerSecond(speed));
  }

  /** The program stops running. */
  leave(): void {
    this.allowance = 0;
  }

  /** The start of a slice: time since the last slice becomes allowance; the cap holds after adding, too. */
  refill(now: number, speed: SpeedSetting): void {
    if (speed.mode === 'max') {
      this.allowance = MAX_TICK_INSTRUCTIONS;
    } else {
      const ips = instructionsPerSecond(speed);
      this.allowance += (Math.min(Math.max(now - this.lastSlice, 0), MAX_CATCHUP_MS) * ips) / 1000;
      this.allowance = Math.min(this.allowance, allowanceCap(ips));
    }
    this.lastSlice = now;
  }

  /** Engine time this frame still has, in milliseconds (zero or less: none). */
  budget(): number {
    return Math.min(SLICE_BUDGET_MS, SLICE_FRAME_SHARE * this.frameInterval) - this.usedThisFrame;
  }

  /** Instructions for the next engine call: a sub-slice, or what the allowance still covers. */
  next(speed: SpeedSetting): number {
    return Math.min(subslice(instructionsPerSecond(speed)), Math.floor(this.allowance));
  }

  /** The engine executed so many instructions (counted with `engine.stepCount`). */
  spend(instructions: number): void {
    this.allowance -= instructions;
  }

  /** The engine ran for so many milliseconds. */
  used(ms: number): void {
    this.usedThisFrame += Math.max(ms, 0);
  }
}

/** The most allowance a rate can hold: MAX_CATCHUP_MS of execution. */
export function allowanceCap(ips: number): number {
  return (MAX_CATCHUP_MS * ips) / 1000;
}

/** Instruction steps between two readings of `engine.stepCount`, which counts modulo 2^32. */
export function stepsBetween(before: number, after: number): number {
  return (after - before) >>> 0;
}
