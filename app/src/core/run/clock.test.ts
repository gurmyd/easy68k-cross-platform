// RealClock, FrameScheduler and VirtualTime (ARCHITECTURE.md 3.11.1, 4.5.5).

import { describe, expect, it } from 'vitest';
import { FRAME_WATCHDOG_MS, FrameScheduler, RealClock, VirtualTime, type SchedulerTimers } from './clock';

describe('RealClock', () => {
  it('is monotonic and tells the local time', () => {
    const clock = new RealClock();
    const first = clock.now();
    const second = clock.now();
    expect(second).toBeGreaterThanOrEqual(first);
    expect(Math.abs(clock.wallTime().getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe('VirtualTime', () => {
  it('stands still until advance() is called', () => {
    const time = new VirtualTime();
    expect(time.now()).toBe(0);
    time.advance(7);
    time.advance(0);
    time.advance(0.5);
    expect(time.now()).toBe(7.5);
  });

  it('runs the frame callbacks at every multiple of 16 ms', () => {
    const time = new VirtualTime();
    const frames: number[] = [];
    time.onFrame((now) => frames.push(now));
    time.advance(15);
    expect(frames).toEqual([]);
    time.advance(1);
    expect(frames).toEqual([16]);
    time.advance(40); // to 56: frames at 32 and 48
    expect(frames).toEqual([16, 32, 48]);
    time.advance(1000 - 56);
    expect(frames).toHaveLength(62); // 16 .. 992
    expect(frames.at(-1)).toBe(992);
  });

  it('gives the same frames whatever the step of advance()', () => {
    for (const step of [1, 7, 16, 1000]) {
      const time = new VirtualTime();
      const frames: number[] = [];
      time.onFrame((now) => frames.push(now));
      for (let t = 0; t < 1000; t += step) time.advance(Math.min(step, 1000 - t));
      expect(frames, `step ${step}`).toEqual(Array.from({ length: 62 }, (_, i) => (i + 1) * 16));
    }
  });

  it('runs timers at their due time, in time order, then in the order they were set', () => {
    const time = new VirtualTime();
    const seen: string[] = [];
    time.setTimer(30, () => seen.push(`a@${time.now()}`));
    time.setTimer(10, () => seen.push(`b@${time.now()}`));
    time.setTimer(30, () => seen.push(`c@${time.now()}`));
    time.onFrame((now) => seen.push(`frame@${now}`));
    time.advance(32);
    expect(seen).toEqual(['b@10', 'frame@16', 'a@30', 'c@30', 'frame@32']);
  });

  it('runs a timer due at a frame time before the frame', () => {
    const time = new VirtualTime();
    const seen: string[] = [];
    time.onFrame(() => seen.push('frame'));
    time.setTimer(16, () => seen.push('timer'));
    time.advance(16);
    expect(seen).toEqual(['timer', 'frame']);
  });

  it('runs a timer set during advance() for a time inside the span in the same call', () => {
    const time = new VirtualTime();
    const seen: number[] = [];
    time.setTimer(5, () => {
      seen.push(time.now());
      time.setTimer(5, () => seen.push(time.now()));
      time.setTimer(0, () => seen.push(time.now() + 0.5)); // delay 0: at once, same instant
      time.setTimer(1000, () => seen.push(-1)); // outside the span
    });
    time.advance(20);
    expect(seen).toEqual([5, 5.5, 10]);
    expect(time.pendingTimers).toBe(1);
  });

  it('runs a zero-delay timer set outside advance() at the next call, advance(0) included', () => {
    const time = new VirtualTime();
    let ran = 0;
    time.setTimer(0, () => ran++);
    expect(ran).toBe(0);
    time.advance(0);
    expect(ran).toBe(1);
  });

  it('does not run a cancelled timer or a removed frame callback', () => {
    const time = new VirtualTime();
    let ran = 0;
    const cancel = time.setTimer(5, () => ran++);
    const stop = time.onFrame(() => ran++);
    cancel();
    stop();
    time.advance(100);
    expect(ran).toBe(0);
    expect(time.pendingTimers).toBe(0);
  });

  it('moves the wall clock with the virtual time', () => {
    const time = new VirtualTime(new Date(2026, 10, 20, 23, 59, 59, 500));
    time.advance(600);
    const wall = time.wallTime();
    expect([wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), wall.getMilliseconds()]).toEqual([
      21, 0, 0, 0, 100,
    ]);
  });

  it('refuses a negative span and a nested advance()', () => {
    const time = new VirtualTime();
    expect(() => time.advance(-1)).toThrow(RangeError);
    time.setTimer(1, () => time.advance(1));
    expect(() => time.advance(5)).toThrow(/inside a timer or frame callback/);
  });

  it('reports a timer that re-arms itself for ever instead of hanging', () => {
    const time = new VirtualTime();
    const again = (): void => void time.setTimer(0, again);
    time.setTimer(0, again);
    expect(() => time.advance(1)).toThrow(/re-arming/);
  });
});

/** Timers and a frame source driven by hand. */
function manual() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { due: number; fn: () => void }>();
  let frame: ((now: number) => void) | null = null;
  const source: SchedulerTimers = {
    setTimeout(callback, delayMs) {
      timers.set(next, { due: now + delayMs, fn: callback });
      return next++;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    now: () => now,
  };
  return {
    source,
    frameSource: (callback: (now: number) => void) => {
      frame = callback;
    },
    /** Delivers one display frame at the current time. */
    frame() {
      const callback = frame;
      frame = null;
      callback?.(now);
    },
    hasFrameRequest: () => frame !== null,
    /** Moves the time and runs the timers that become due. */
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) break;
        now = due[1].due;
        timers.delete(due[0]);
        due[1].fn();
      }
      now = target;
    },
    timerCount: () => timers.size,
  };
}

describe('FrameScheduler', () => {
  it('calls the frame callbacks once per frame of its source', () => {
    const m = manual();
    const scheduler = new FrameScheduler(m.frameSource, m.source);
    const seen: number[] = [];
    scheduler.onFrame((now) => seen.push(now));
    m.advance(8);
    m.frame();
    m.advance(8);
    m.frame();
    expect(seen).toEqual([8, 16]);
    expect(m.hasFrameRequest()).toBe(true);
  });

  it('follows a 120 Hz frame source', () => {
    const m = manual();
    const scheduler = new FrameScheduler(m.frameSource, m.source);
    const seen: number[] = [];
    scheduler.onFrame((now) => seen.push(now));
    for (let i = 0; i < 120; i++) {
      m.advance(1000 / 120);
      m.frame();
    }
    expect(seen).toHaveLength(120);
    expect(seen[1]! - seen[0]!).toBeCloseTo(8.333, 2);
  });

  it('lets the watchdog run the callbacks when no frame has arrived for 250 ms, until frames return', () => {
    const m = manual();
    const scheduler = new FrameScheduler(m.frameSource, m.source);
    const seen: number[] = [];
    scheduler.onFrame((now) => seen.push(now));
    m.advance(FRAME_WATCHDOG_MS - 1);
    expect(seen).toEqual([]);
    m.advance(1);
    expect(seen).toEqual([250]);
    m.advance(500);
    expect(seen).toEqual([250, 500, 750]);
    // Frames return: each one re-arms the watchdog, which then stays quiet.
    for (let i = 0; i < 30; i++) {
      m.advance(16);
      m.frame();
    }
    expect(seen).toHaveLength(3 + 30);
    expect(seen.slice(3).every((t, i) => t === 750 + 16 * (i + 1))).toBe(true);
  });

  it('stops the watchdog when the last callback is removed', () => {
    const m = manual();
    const scheduler = new FrameScheduler(m.frameSource, m.source);
    let ran = 0;
    const stop = scheduler.onFrame(() => ran++);
    stop();
    m.advance(2000);
    m.frame();
    expect(ran).toBe(0);
    expect(m.timerCount()).toBe(0);
  });

  it('sets and cancels timers; delay 0 means as soon as possible', () => {
    const m = manual();
    const scheduler = new FrameScheduler(m.frameSource, m.source);
    const seen: string[] = [];
    scheduler.setTimer(0, () => seen.push('now'));
    scheduler.setTimer(-5, () => seen.push('negative'));
    const cancel = scheduler.setTimer(10, () => seen.push('cancelled'));
    scheduler.setTimer(20, () => seen.push('later'));
    cancel();
    m.advance(0);
    expect(seen).toEqual(['now', 'negative']);
    m.advance(20);
    expect(seen).toEqual(['now', 'negative', 'later']);
  });

  it('works with the timers of the platform when no frame source exists (Node)', async () => {
    const scheduler = new FrameScheduler();
    const fired = await new Promise<boolean>((resolve) => scheduler.setTimer(1, () => resolve(true)));
    expect(fired).toBe(true);
  });
});
