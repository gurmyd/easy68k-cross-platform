// Time for the simulator (ARCHITECTURE.md 3.11.1, 4.5): the real clock, the frame scheduler of a
// page, and the virtual time of tests.
//
// Everything under core/ reads time and sets timers only through the two interfaces `Clock` and
// `Scheduler` of the contracts. The classes here are their implementations:
//
//   RealClock        performance.now() and new Date()
//   FrameScheduler   requestAnimationFrame, with a watchdog timer for pages that get no frames
//   VirtualTime      both interfaces for tests: time moves only when the test calls advance()
//
// This file is therefore the one place under core/ that touches the browser's clock and timers;
// the lint rule that forbids them in core/ is switched off line by line, with the reason.
//
// Owner: SH8.

import type { FrameSchedulerApi, RealClockApi, VirtualTimeApi } from '../../contracts';

export type { Clock, Scheduler } from '../../contracts';

/** The clock of a running application: monotonic milliseconds, and the system's local time. */
export class RealClock implements RealClockApi {
  now(): number {
    // eslint-disable-next-line no-restricted-globals -- RealClock is the injected clock itself (3.11.1)
    return performance.now();
  }

  wallTime(): Date {
    return new Date();
  }
}

/** No frame for this long means the page is hidden, minimised or covered: a timer takes over (4.5.5). */
export const FRAME_WATCHDOG_MS = 250;

/** The timer functions a FrameScheduler uses; the default is the platform's. Tests pass their own. */
export interface SchedulerTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  /** The time passed to frame callbacks that the watchdog runs. */
  now(): number;
}

const platformTimers = (): SchedulerTimers => ({
  // eslint-disable-next-line no-restricted-globals -- FrameScheduler is the injected scheduler itself (3.11.1)
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  // eslint-disable-next-line no-restricted-globals -- as above
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
  // eslint-disable-next-line no-restricted-globals -- as above
  now: () => performance.now(),
});

/** requestAnimationFrame where it exists (a browser); under Node only the watchdog delivers frames. */
const platformFrames = (): ((callback: (now: number) => void) => void) => {
  const request = (globalThis as { requestAnimationFrame?: (callback: (now: number) => void) => number })
    .requestAnimationFrame;
  return request ? (callback) => void request.call(globalThis, callback) : () => {};
};

/**
 * The scheduler of a page. `onFrame` callbacks run once per display frame. A watchdog timer,
 * re-armed by every frame, takes over whenever no frame has arrived for 250 ms and runs the
 * callbacks itself until frames return. It does not ask whether the page is visible: a minimised
 * or covered window can stop producing frames while still calling itself visible (4.5.5).
 */
export class FrameScheduler implements FrameSchedulerApi {
  private readonly callbacks = new Set<(now: number) => void>();
  private readonly requestFrame: (callback: (now: number) => void) => void;
  private readonly timers: SchedulerTimers;
  private framePending = false;
  private watchdog: unknown = null;

  /**
   * `frameSource` replaces requestAnimationFrame in tests (for example a 120 Hz source); `timers`
   * replaces the platform's timers.
   */
  constructor(frameSource?: (callback: (now: number) => void) => void, timers?: SchedulerTimers) {
    this.requestFrame = frameSource ?? platformFrames();
    this.timers = timers ?? platformTimers();
  }

  onFrame(fn: (now: number) => void): () => void {
    this.callbacks.add(fn);
    this.armFrame();
    if (this.watchdog === null) this.armWatchdog();
    return () => {
      this.callbacks.delete(fn);
      if (this.callbacks.size === 0) this.disarmWatchdog();
    };
  }

  setTimer(delayMs: number, fn: () => void): () => void {
    const handle = this.timers.setTimeout(fn, Math.max(0, delayMs));
    return () => this.timers.clearTimeout(handle);
  }

  private run(now: number): void {
    // A callback may remove itself or another one while the list is walked.
    for (const callback of [...this.callbacks]) {
      if (this.callbacks.has(callback)) callback(now);
    }
  }

  /** Asks for the next frame unless one is already asked for. A frame source cannot be cancelled. */
  private armFrame(): void {
    if (this.framePending) return;
    this.framePending = true;
    this.requestFrame((now) => {
      this.framePending = false;
      if (this.callbacks.size === 0) return;
      this.run(now);
      if (this.callbacks.size === 0) return;
      this.armFrame();
      this.armWatchdog();
    });
  }

  private armWatchdog(): void {
    this.disarmWatchdog();
    this.watchdog = this.timers.setTimeout(() => {
      this.watchdog = null;
      if (this.callbacks.size === 0) return;
      // The frame request stays pending; it fires again when the page gets frames.
      this.run(this.timers.now());
      if (this.callbacks.size > 0) this.armWatchdog();
    }, FRAME_WATCHDOG_MS);
  }

  private disarmWatchdog(): void {
    if (this.watchdog !== null) this.timers.clearTimeout(this.watchdog);
    this.watchdog = null;
  }
}

/** Virtual time between two display frames: a frame at every multiple of this many milliseconds. */
export const VIRTUAL_FRAME_MS = 16;

/** More timers than this at one instant of virtual time means a timer re-arms itself for ever. */
const MAX_TIMERS_PER_INSTANT = 100_000;

interface VirtualTimer {
  due: number;
  /** Order of creation: timers due at the same time run in the order they were set. */
  serial: number;
  fn: () => void;
}

/**
 * Clock and scheduler for tests. Time moves only by `advance(ms)`, which walks forward through
 * everything that is due, in time order:
 *
 * - at each timer's due time it runs that timer (timers due at the same time in the order they
 *   were set);
 * - at every multiple of 16 ms it runs the frame callbacks, after the timers due at that time;
 * - a timer set meanwhile for a time inside the span runs in the same call. A timer with delay 0
 *   set inside a callback therefore runs before `advance` returns, and one set outside runs at the
 *   start of the next call, `advance(0)` included.
 *
 * `now()` is 0 at first. `wallTime()` is `start` plus the virtual time; the default start is
 * 1 January 2026, 12:00:00 local time.
 */
export class VirtualTime implements VirtualTimeApi {
  private time = 0;
  private lastFrame = 0;
  private serial = 0;
  private advancing = false;
  private readonly timers = new Set<VirtualTimer>();
  private readonly frames = new Set<(now: number) => void>();
  private readonly startMs: number;

  constructor(start: Date = new Date(2026, 0, 1, 12, 0, 0)) {
    this.startMs = start.getTime();
  }

  now(): number {
    return this.time;
  }

  wallTime(): Date {
    return new Date(this.startMs + this.time);
  }

  onFrame(fn: (now: number) => void): () => void {
    this.frames.add(fn);
    return () => {
      this.frames.delete(fn);
    };
  }

  setTimer(delayMs: number, fn: () => void): () => void {
    const timer: VirtualTimer = { due: this.time + Math.max(0, delayMs), serial: this.serial++, fn };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }

  /** The number of timers that are set and have not run or been cancelled. */
  get pendingTimers(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    if (!(ms >= 0)) throw new RangeError(`VirtualTime.advance(${ms}): the time span must be zero or more`);
    if (this.advancing) throw new Error('VirtualTime.advance() was called from inside a timer or frame callback');
    this.advancing = true;
    try {
      const target = this.time + ms;
      let atThisInstant = 0;
      for (;;) {
        const timer = this.nextTimer();
        const timerAt = timer ? Math.max(timer.due, this.time) : Infinity;
        const frameAt = this.lastFrame + VIRTUAL_FRAME_MS;
        if (timer && timerAt <= target && timerAt <= frameAt) {
          atThisInstant = timerAt === this.time ? atThisInstant + 1 : 0;
          if (atThisInstant > MAX_TIMERS_PER_INSTANT) {
            throw new Error(`VirtualTime: a timer keeps re-arming itself with delay 0 at ${this.time} ms`);
          }
          this.time = timerAt;
          this.timers.delete(timer);
          timer.fn();
        } else if (frameAt <= target) {
          atThisInstant = 0;
          this.time = frameAt;
          this.lastFrame = frameAt;
          for (const frame of [...this.frames]) {
            if (this.frames.has(frame)) frame(this.time);
          }
        } else {
          break;
        }
      }
      this.time = target;
    } finally {
      this.advancing = false;
    }
  }

  /** The timer that runs first: the earliest due time, then the earliest set. */
  private nextTimer(): VirtualTimer | null {
    let first: VirtualTimer | null = null;
    for (const timer of this.timers) {
      if (!first || timer.due < first.due || (timer.due === first.due && timer.serial < first.serial)) first = timer;
    }
    return first;
  }
}
