// Software timers of the simulator (ARCHITECTURE.md 4.5.3).
//
// The original's periodic timers are Windows timers (VCL TTimer): the seven auto-interrupt timers
// of the Hardware window and the auto-trace timer. The port keeps them as plain objects that the
// run controller checks in every tick (`fireDueTimers`), so that a timer can only fire between two
// engine calls and the same code runs under virtual time in tests.
//
// Rules taken from Windows timers (hardware §3.6, §7):
//   - an interval of 0 never fires;
//   - intervals from 1 to 9 ms behave as 10 ms;
//   - the first tick comes one full interval after the timer was enabled;
//   - a late timer fires once: there is no burst that catches up;
//   - enabling a disabled timer, and giving a running timer another interval, starts a fresh period.
//
// Owner: SH8.

import type { Clock, SoftTimerApi } from '../../contracts';

/** Windows raises timer intervals below this to this value (hardware §7). */
export const MIN_TIMER_INTERVAL_MS = 10;

/** The interval of a new timer: the VCL's default (hardware §3.6). */
export const DEFAULT_TIMER_INTERVAL_MS = 1000;

export class SoftTimer implements SoftTimerApi {
  private interval = DEFAULT_TIMER_INTERVAL_MS;
  private on = false;
  /** Clock time of the next tick while enabled. */
  private due = 0;

  constructor(
    private readonly clock: Clock,
    private readonly onTick: () => void,
  ) {}

  /** Milliseconds between ticks. Another value while the timer is enabled restarts the period. */
  get intervalMs(): number {
    return this.interval;
  }
  set intervalMs(value: number) {
    const interval = Number.isFinite(value) && value > 0 ? value : 0;
    if (interval === this.interval) return;
    this.interval = interval;
    if (this.on) this.restart();
  }

  /** false -> true starts a fresh period; the first tick comes one interval later. */
  get enabled(): boolean {
    return this.on;
  }
  set enabled(value: boolean) {
    if (value === this.on) return;
    this.on = value;
    if (value) this.restart();
  }

  /** Called by the controller. Fires at most once per call, then schedules `now` + interval. */
  check(now: number): void {
    if (!this.on || this.interval === 0 || now < this.due) return;
    this.due = now + this.period();
    this.onTick();
  }

  private period(): number {
    return Math.max(this.interval, MIN_TIMER_INTERVAL_MS);
  }

  private restart(): void {
    this.due = this.clock.now() + this.period();
  }
}

/**
 * The timers the run controller checks: every timer made by `create` belongs to the set for good
 * (the Hardware model makes its seven once, the UI bridge its one).
 */
export class TimerSet {
  private readonly timers: SoftTimer[] = [];

  constructor(private readonly clock: Clock) {}

  create(onTick: () => void): SoftTimer {
    const timer = new SoftTimer(this.clock, onTick);
    this.timers.push(timer);
    return timer;
  }

  /** Lets every due timer fire once. A timer that is switched off by an earlier one's tick stays quiet. */
  check(now: number): void {
    for (const timer of this.timers) timer.check(now);
  }

  /** Switches every timer off (cold start, 4.7.1: "all timers are cancelled"). */
  disableAll(): void {
    for (const timer of this.timers) timer.enabled = false;
  }

  get size(): number {
    return this.timers.length;
  }
}
