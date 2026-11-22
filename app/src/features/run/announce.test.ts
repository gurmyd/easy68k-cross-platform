// What the status bar announces, and when (announce.ts; errata SH8.md entry 43). Virtual time.
//
// Owner: SH8.

import { describe, expect, it } from 'vitest';
import type { AppState } from '../../contracts';
import type { StopRecord } from '../../core/run/controller';
import { ANNOUNCE_MIN_GAP_MS, ANNOUNCE_SETTLE_MS, RunAnnouncer, stopAnnouncement } from './announce';

type Sim = Pick<AppState['sim'], 'phase' | 'halted' | 'autoTrace' | 'menuState'>;

const IDLE: Sim = { phase: 'idle', halted: false, autoTrace: false, menuState: 0 };
const HALTED: Sim = { phase: 'idle', halted: true, autoTrace: false, menuState: 1 };

/** A RunAnnouncer on virtual time, with a simulator whose state the test sets. */
function harness() {
  let time = 0;
  let timers: { at: number; fn: () => void }[] = [];
  const state = { stop: { count: 0, after: 'run', wasRunning: false } as StopRecord, sim: { ...IDLE } as Sim };
  const said: { text: string; at: number }[] = [];
  const announcer = new RunAnnouncer({
    read: () => state,
    now: () => time,
    setTimer: (fn, ms) => {
      const timer = { at: time + ms, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
    say: (text) => said.push({ text, at: time }),
  });
  const advance = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      time = due.at;
      due.fn();
    }
    time = end;
  };
  /** The simulator changes; the announcer hears of it as the store and the controller tell it. */
  const set = (sim: Partial<Sim>) => {
    state.sim = { ...state.sim, ...sim };
    announcer.update();
  };
  const stop = (after: StopRecord['after'], wasRunning: boolean, sim: Partial<Sim> = IDLE) => {
    state.stop = { count: state.stop.count + 1, after, wasRunning };
    set(sim);
  };
  return { said, advance, set, stop, texts: () => said.map((s) => s.text), pending: () => timers.length };
}

describe('stopAnnouncement', () => {
  it('a halt is always announced, also one reached with Trace Into', () => {
    for (const after of ['run', 'trace', 'autoTrace'] as const)
      for (const wasRunning of [true, false]) expect(stopAnnouncement({ after, wasRunning }, HALTED)).toBe('Halted');
  });

  it('Stopped after a run, a stop of a running program and the end of Auto Trace; not after a Trace step', () => {
    expect(stopAnnouncement({ after: 'run', wasRunning: true }, IDLE)).toBe('Stopped');
    expect(stopAnnouncement({ after: 'autoTrace', wasRunning: false }, IDLE)).toBe('Stopped');
    expect(stopAnnouncement({ after: 'trace', wasRunning: false }, IDLE)).toBeNull();
    expect(stopAnnouncement({ after: 'run', wasRunning: false }, IDLE)).toBeNull(); // Pause while stopped
  });

  it('nothing while the program runs, waits, or Auto Trace goes on', () => {
    for (const phase of ['running', 'waitInput', 'waitHost', 'waitDelay', 'waitAlert', 'loading'] as const)
      expect(stopAnnouncement({ after: 'run', wasRunning: true }, { ...IDLE, phase })).toBeNull();
    expect(stopAnnouncement({ after: 'autoTrace', wasRunning: false }, { ...IDLE, autoTrace: true })).toBeNull();
  });
});

describe('RunAnnouncer', () => {
  it('a run to its halt announces Halted once, after the settling time', () => {
    const h = harness();
    h.set({ phase: 'running' });
    h.stop('run', true, HALTED);
    h.advance(ANNOUNCE_SETTLE_MS - 1);
    expect(h.texts()).toEqual([]);
    h.advance(1);
    expect(h.said).toEqual([{ text: 'Halted', at: ANNOUNCE_SETTLE_MS }]);
    h.advance(10_000);
    expect(h.texts()).toEqual(['Halted']);
  });

  it('a program that reads keys in a loop announces nothing while it waits and runs', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) {
      h.set({ phase: 'running' });
      h.advance(3);
      h.set({ phase: 'waitInput' });
      h.advance(40);
      h.set({ phase: 'waitHost' });
      h.advance(2);
    }
    expect(h.texts()).toEqual([]);
    expect(h.pending()).toBe(0);
  });

  it('Trace Into steps announce nothing, the step that halts announces Halted', () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      h.stop('trace', false);
      h.advance(300);
    }
    expect(h.texts()).toEqual([]);
    h.stop('trace', false, HALTED);
    h.advance(ANNOUNCE_SETTLE_MS);
    expect(h.texts()).toEqual(['Halted']);
  });

  it('Pause of a running program announces Stopped; a run that goes on again at once says nothing', () => {
    const h = harness();
    h.set({ phase: 'running' });
    h.stop('run', true);
    h.set({ phase: 'running' }); // started again before the state settled
    h.advance(ANNOUNCE_SETTLE_MS * 4);
    expect(h.texts()).toEqual([]);
    h.stop('run', true);
    h.advance(ANNOUNCE_SETTLE_MS);
    expect(h.texts()).toEqual(['Stopped']);
  });

  it('Auto Trace: announced once when it starts and Stopped when it ends, not at every tick', () => {
    const h = harness();
    h.set({ autoTrace: true });
    for (let i = 0; i < 30; i++) {
      h.advance(208);
      h.stop('autoTrace', false, { ...IDLE, autoTrace: true, menuState: 1 });
    }
    expect(h.texts()).toEqual(['Auto trace']);
    h.stop('autoTrace', false, IDLE); // Pause
    h.advance(ANNOUNCE_MIN_GAP_MS);
    expect(h.texts()).toEqual(['Auto trace', 'Stopped']);
  });

  it('never more often than once per ANNOUNCE_MIN_GAP_MS, however fast the stops come (Step Over held down)', () => {
    const h = harness();
    for (let i = 0; i < 100; i++) {
      h.set({ phase: 'running' });
      h.stop('run', true);
      h.advance(100);
    }
    h.advance(ANNOUNCE_MIN_GAP_MS);
    const times = h.said.map((s) => s.at);
    expect(times.length).toBeGreaterThan(1);
    expect(times.length).toBeLessThanOrEqual(Math.ceil((100 * 100) / ANNOUNCE_MIN_GAP_MS) + 1);
    for (let i = 1; i < times.length; i++)
      expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(ANNOUNCE_MIN_GAP_MS);
  });

  it('says nothing for a state that was there before it started', () => {
    const h = harness();
    h.set({ ...HALTED });
    h.advance(10_000);
    expect(h.texts()).toEqual([]);
  });
});
