// The governor's arithmetic (ARCHITECTURE.md 4.2, 4.5.6), without an engine.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_SETTINGS } from '../settings/defaults';
import {
  DEFAULT_IPS,
  Governor,
  INITIAL_FRAME_INTERVAL_MS,
  MAX_CATCHUP_MS,
  MAX_TICK_INSTRUCTIONS,
  SLICE_BUDGET_MS,
  SLICE_FRAME_SHARE,
  SUBSLICE,
  allowanceCap,
  instructionsPerSecond,
  stepsBetween,
  subslice,
  type SpeedSetting,
} from './governor';

const ORIGINAL: SpeedSetting = { mode: 'original', instructionsPerSecond: 123 };
const MAXIMUM: SpeedSetting = { mode: 'max', instructionsPerSecond: 123 };
const custom = (ips: number): SpeedSetting => ({ mode: 'custom', instructionsPerSecond: ips });

describe('constants of 4.2', () => {
  it('have the values the document gives', () => {
    expect({
      SLICE_BUDGET_MS,
      SLICE_FRAME_SHARE,
      SUBSLICE,
      MAX_CATCHUP_MS,
      MAX_TICK_INSTRUCTIONS,
      DEFAULT_IPS,
    }).toEqual({
      SLICE_BUDGET_MS: 8,
      SLICE_FRAME_SHARE: 0.5,
      SUBSLICE: 2000,
      MAX_CATCHUP_MS: 50,
      MAX_TICK_INSTRUCTIONS: 1_000_000,
      DEFAULT_IPS: 1_000_000,
    });
  });

  it('agree with the default of the settings (W1 wrote the same number as a literal)', () => {
    expect(DEFAULT_SIM_SETTINGS.speed.instructionsPerSecond).toBe(DEFAULT_IPS);
  });
});

describe('subslice()', () => {
  it('is at most 2 ms of program time, at least one instruction, at most SUBSLICE', () => {
    expect(subslice(1_000_000)).toBe(2000);
    expect(subslice(500_000)).toBe(1000);
    expect(subslice(1000)).toBe(2);
    expect(subslice(501)).toBe(2);
    expect(subslice(500)).toBe(1);
    expect(subslice(1)).toBe(1);
    expect(subslice(100_000_000)).toBe(2000);
    expect(subslice(Infinity)).toBe(2000);
  });
});

describe('instructionsPerSecond()', () => {
  it('uses DEFAULT_IPS for EASy68K-like, whatever number is stored', () => {
    expect(instructionsPerSecond(ORIGINAL)).toBe(DEFAULT_IPS);
  });
  it('uses the custom number, at least 1', () => {
    expect(instructionsPerSecond(custom(250_000))).toBe(250_000);
    expect(instructionsPerSecond(custom(0))).toBe(1);
    expect(instructionsPerSecond(custom(-7))).toBe(1);
    expect(instructionsPerSecond(custom(Number.NaN))).toBe(1);
    expect(instructionsPerSecond(custom(2.9))).toBe(2);
  });
  it('has no rate at Maximum', () => {
    expect(instructionsPerSecond(MAXIMUM)).toBe(Infinity);
  });
});

describe('stepsBetween()', () => {
  it('counts modulo 2^32', () => {
    expect(stepsBetween(10, 2010)).toBe(2000);
    expect(stepsBetween(0xffff_fff0, 0x10)).toBe(0x20);
    expect(stepsBetween(5, 5)).toBe(0);
  });
});

describe('Governor', () => {
  it('lets the first instructions execute at once when the program starts running', () => {
    const g = new Governor();
    g.enter(100, ORIGINAL);
    expect(g.allowance).toBe(2000);
    expect(g.lastSlice).toBe(100);
    g.enter(100, custom(100));
    expect(g.allowance).toBe(1);
    g.leave();
    expect(g.allowance).toBe(0);
  });

  it('turns the time since the last slice into allowance', () => {
    const g = new Governor();
    g.enter(0, ORIGINAL);
    g.spend(2000);
    g.refill(16, ORIGINAL);
    expect(g.allowance).toBe(16_000);
    expect(g.next(ORIGINAL)).toBe(2000);
    g.spend(15_500);
    expect(g.next(ORIGINAL)).toBe(500);
  });

  it('never lets the allowance exceed the cap, also after the addition', () => {
    const g = new Governor();
    const cap = allowanceCap(DEFAULT_IPS);
    expect(cap).toBe(50_000);
    g.enter(0, ORIGINAL);
    // A long gap adds at most MAX_CATCHUP_MS.
    g.refill(10_000, ORIGINAL);
    expect(g.allowance).toBe(cap);
    // Slices that the time budget ended leave allowance behind; it still does not pile up.
    for (let now = 10_016; now < 12_000; now += 16) {
      g.refill(now, ORIGINAL);
      expect(g.allowance).toBeLessThanOrEqual(cap);
      g.spend(4000); // the budget allowed only this much
    }
    expect(g.allowance).toBeGreaterThan(cap - 4000 - 1);
  });

  it('keeps fractions of an instruction for slow programs', () => {
    const g = new Governor();
    const speed = custom(100); // 1.6 instructions per 16 ms
    g.enter(0, speed);
    g.spend(1);
    let executed = 0;
    for (let now = 16; now <= 1000; now += 16) {
      g.refill(now, speed);
      while (g.allowance >= 1) {
        const n = g.next(speed);
        expect(n).toBe(1);
        g.spend(n);
        executed += n;
      }
    }
    expect(executed).toBe(99); // 992 ms at 100 per second, and one at the start
  });

  it('gives a tick at Maximum a fixed number of instructions, whatever the clock says', () => {
    const g = new Governor();
    g.enter(0, MAXIMUM);
    expect(g.allowance).toBe(2000);
    g.refill(0, MAXIMUM);
    expect(g.allowance).toBe(MAX_TICK_INSTRUCTIONS);
    g.spend(MAX_TICK_INSTRUCTIONS);
    expect(g.allowance).toBe(0);
    g.refill(0, MAXIMUM);
    expect(g.allowance).toBe(MAX_TICK_INSTRUCTIONS);
    expect(g.next(MAXIMUM)).toBe(SUBSLICE);
  });

  it('gives a frame at 60 Hz the 8 ms budget, and counts what was used against it', () => {
    const g = new Governor();
    expect(g.frameInterval).toBeCloseTo(INITIAL_FRAME_INTERVAL_MS);
    for (let i = 0; i < 60; i++) g.frame((i * 1000) / 60);
    expect(g.budget()).toBe(8); // min(8, 0.5 * 16.67)
    g.used(3);
    expect(g.budget()).toBe(5);
    g.used(6);
    expect(g.budget()).toBeLessThan(0);
    g.frame(1000);
    expect(g.budget()).toBe(8);
  });

  it('follows a 120 Hz display: about 4 ms of engine time per frame', () => {
    const g = new Governor();
    for (let i = 0; i < 120; i++) g.frame((i * 1000) / 120);
    expect(g.frameInterval).toBeCloseTo(1000 / 120, 3);
    expect(g.budget()).toBeCloseTo(SLICE_FRAME_SHARE * (1000 / 120), 3);
    expect(g.budget()).toBeLessThan(4.2);
    // Back to 60 Hz: the budget follows.
    for (let i = 0; i < 60; i++) g.frame(1000 + (i * 1000) / 60);
    expect(g.budget()).toBe(8);
  });

  it('is not thrown off by one stalled frame or by a clock that does not move', () => {
    const g = new Governor();
    for (let i = 0; i < 60; i++) g.frame(i * 16);
    g.frame(60 * 16 + 30_000); // the page was hidden for half a minute
    expect(g.frameInterval).toBeLessThan(300);
    g.frame(60 * 16 + 30_000); // twice at the same instant
    expect(Number.isFinite(g.frameInterval)).toBe(true);
    expect(g.budget()).toBe(8);
  });
});
