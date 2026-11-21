// SoftTimer and TimerSet: the rules taken from Windows timers (ARCHITECTURE.md 4.5.3; hardware §3.6, §7).

import { describe, expect, it } from 'vitest';
import { VirtualTime } from './clock';
import { DEFAULT_TIMER_INTERVAL_MS, SoftTimer, TimerSet } from './timers';

function timer() {
  const time = new VirtualTime();
  const ticks: number[] = [];
  const soft = new SoftTimer(time, () => ticks.push(time.now()));
  /** Moves the clock and checks the timer every millisecond, as a very fast frame would. */
  const run = (ms: number) => {
    for (let i = 0; i < ms; i++) {
      time.advance(1);
      soft.check(time.now());
    }
  };
  return { time, soft, ticks, run };
}

describe('SoftTimer', () => {
  it('starts disabled with the interval of a new Windows timer', () => {
    const { soft, ticks, run } = timer();
    expect(soft.enabled).toBe(false);
    expect(soft.intervalMs).toBe(DEFAULT_TIMER_INTERVAL_MS);
    run(3000);
    expect(ticks).toEqual([]);
  });

  it('ticks first one full interval after it was enabled, then every interval', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = 500;
    run(200);
    soft.enabled = true; // at 200
    run(1300);
    expect(ticks).toEqual([700, 1200]);
  });

  it('never fires with an interval of 0', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = 0;
    soft.enabled = true;
    run(5000);
    expect(ticks).toEqual([]);
  });

  it('treats intervals from 1 to 9 ms as 10 ms', () => {
    for (const interval of [1, 5, 9, 10]) {
      const { soft, ticks, run } = timer();
      soft.intervalMs = interval;
      soft.enabled = true;
      run(50);
      expect(ticks, `interval ${interval}`).toEqual([10, 20, 30, 40, 50]);
    }
  });

  it('fires once when it is late, without a burst that catches up', () => {
    const { time, soft, ticks } = timer();
    soft.intervalMs = 100;
    soft.enabled = true;
    time.advance(1050); // ten periods passed unseen
    soft.check(time.now());
    soft.check(time.now());
    expect(ticks).toEqual([1050]);
    time.advance(99);
    soft.check(time.now());
    expect(ticks).toEqual([1050]);
    time.advance(1); // the next tick is one interval after the late one
    soft.check(time.now());
    expect(ticks).toEqual([1050, 1150]);
  });

  it('fires at most once per check', () => {
    const { time, soft, ticks } = timer();
    soft.intervalMs = 10;
    soft.enabled = true;
    time.advance(35);
    soft.check(time.now());
    expect(ticks).toHaveLength(1);
  });

  it('restarts the period when it is enabled again', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = 100;
    soft.enabled = true;
    run(90);
    soft.enabled = false;
    run(50);
    soft.enabled = true; // at 140: a fresh period
    run(200);
    expect(ticks).toEqual([240, 340]);
  });

  it('restarts the period when a running timer gets another interval, not when it gets the same', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = 100;
    soft.enabled = true;
    run(60);
    soft.intervalMs = 100; // the same value: nothing happens
    run(30);
    soft.intervalMs = 50; // at 90: fresh period of 50
    run(100);
    expect(ticks).toEqual([140, 190]);
  });

  it('does not restart when it is enabled while already enabled', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = 100;
    soft.enabled = true;
    run(60);
    soft.enabled = true;
    run(60);
    expect(ticks).toEqual([100]);
  });

  it('reads a negative or senseless interval as 0', () => {
    const { soft, ticks, run } = timer();
    soft.intervalMs = -5;
    expect(soft.intervalMs).toBe(0);
    soft.intervalMs = Number.NaN;
    expect(soft.intervalMs).toBe(0);
    soft.enabled = true;
    run(100);
    expect(ticks).toEqual([]);
  });
});

describe('TimerSet', () => {
  it('checks every timer it made', () => {
    const time = new VirtualTime();
    const set = new TimerSet(time);
    const ticks: string[] = [];
    const a = set.create(() => ticks.push('a'));
    const b = set.create(() => ticks.push('b'));
    a.intervalMs = 10;
    b.intervalMs = 20;
    a.enabled = true;
    b.enabled = true;
    time.advance(10);
    set.check(time.now());
    time.advance(10);
    set.check(time.now());
    expect(ticks).toEqual(['a', 'a', 'b']);
    expect(set.size).toBe(2);
  });

  it('keeps a timer quiet that an earlier tick of the same check switched off', () => {
    const time = new VirtualTime();
    const set = new TimerSet(time);
    const ticks: string[] = [];
    const second = { timer: null as SoftTimer | null };
    const first = set.create(() => {
      ticks.push('first');
      if (second.timer) second.timer.enabled = false;
    });
    second.timer = set.create(() => ticks.push('second'));
    first.intervalMs = 10;
    second.timer.intervalMs = 10;
    first.enabled = true;
    second.timer.enabled = true;
    time.advance(10);
    set.check(time.now());
    expect(ticks).toEqual(['first']);
  });

  it('disables all of them at once', () => {
    const time = new VirtualTime();
    const set = new TimerSet(time);
    let ticks = 0;
    const timers = [set.create(() => ticks++), set.create(() => ticks++)];
    for (const t of timers) {
      t.intervalMs = 10;
      t.enabled = true;
    }
    set.disableAll();
    time.advance(100);
    set.check(time.now());
    expect(ticks).toBe(0);
    expect(timers.every((t) => !t.enabled)).toBe(true);
  });
});
