// The verdicts of the run check (run-verdicts.mjs) on its measurements. The browser check
// measures; these tests hold the judgement to its rules without a browser.

import { describe, expect, it } from 'vitest';
import {
  SLICE_BUDGET_MS as GOVERNOR_BUDGET_MS,
  SLICE_FRAME_SHARE as GOVERNOR_FRAME_SHARE,
} from '../../core/run/governor';
import {
  BUSY_SHARE,
  MAXIMUM_FACTOR,
  SLICE_BUDGET_MS,
  SLICE_FRAME_SHARE,
  budgetFor,
  judgeDelays,
  judgeMaximum,
  judgeRate,
  type MaximumPair,
  type MaximumWindow,
  type RateWindow,
} from './run-verdicts.mjs';

/** A window of one second at 60 frames, `share` of the grant executed. */
const window60 = (share: number, slow = 0, exact = Math.abs(share - 1) <= 0.03): RateWindow => ({
  executed: Math.round(1_000_000 * share),
  ms: 1000,
  granted: 1_000_000,
  longest: slow > 0 ? 120 : 17,
  frames: 60,
  slow,
  exact,
});

describe('judgeRate', () => {
  it('passes one exact window', () => {
    expect(judgeRate([window60(0.8), window60(1)]).ok).toBe(true);
  });

  // Gate I1 round 3 review, minor defect: with steady frames the 8 ms budget cannot be the limit,
  // so half the grant must not pass there.
  it('fails when windows had steady frames and none executed its whole grant', () => {
    const verdict = judgeRate([window60(0.6), window60(0.7), window60(0.9, 3), window60(0.6), window60(0.55)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('steady frames');
  });

  it('accepts half the grant only when every window had gaps over 50 ms', () => {
    expect(judgeRate([window60(0.6, 4), window60(0.7, 2)]).ok).toBe(true);
    expect(judgeRate([window60(0.4, 4), window60(0.45, 2)]).ok).toBe(false);
  });

  it('fails a window that executed more than the grant', () => {
    expect(judgeRate([window60(1.2, 0, true)]).ok).toBe(false);
  });

  it('judges a window without a gap count (no frames) by its longest gap', () => {
    const noFrames = (longest: number): RateWindow => ({
      executed: 1_200_000,
      ms: 2000,
      granted: 2_000_000,
      longest,
      exact: false,
    });
    expect(judgeRate([noFrames(30)]).ok).toBe(false);
    expect(judgeRate([noFrames(70)]).ok).toBe(true);
  });

  // Gate I1 round 3 review, minor defect: the grant was printed for the whole window next to a
  // rate per second.
  it('prints the grant per second beside the rate per second, and the window length', () => {
    const { detail } = judgeRate([
      { executed: 2_000_698, ms: 2000, granted: 2_014_100, longest: 47, frames: 92, slow: 0, exact: true },
    ]);
    expect(detail).toBe(
      '1,000,349/s, 99 % of the grant of 1,007,050/s over 2000 ms (longest gap 47 ms, 0 of 92 gaps over 50 ms)',
    );
  });
});

describe('judgeMaximum', () => {
  /** Half a second at frames `gap` ms apart, `rate` per second executed, the engine busy `busyShare` of its budget. */
  const win = (rate: number, gap: number, busyShare: number): MaximumWindow => {
    const frames = Math.floor(500 / gap);
    const budget = (500 / gap) * budgetFor(gap);
    return { executed: Math.round(rate / 2), ms: 500, frames, longest: gap, busy: busyShare * budget, budget };
  };
  const pair = (normal: MaximumWindow, max: MaximumWindow): MaximumPair => ({ normal, max });

  it('uses the governor constants', () => {
    expect(SLICE_BUDGET_MS).toBe(GOVERNOR_BUDGET_MS);
    expect(SLICE_FRAME_SHARE).toBe(GOVERNOR_FRAME_SHARE);
    expect(budgetFor(16.7)).toBe(8);
    expect(budgetFor(10)).toBe(5);
    expect(budgetFor(-1)).toBe(0);
    expect(MAXIMUM_FACTOR).toBe(2);
    expect(BUSY_SHARE).toBe(0.6);
  });

  it('passes a Maximum held back only by the time budget, on steady frames', () => {
    const verdict = judgeMaximum([pair(win(1e6, 16.7, 0.07), win(14e6, 16.7, 0.98))]);
    expect(verdict.ok).toBe(true);
    expect(verdict.notes).toEqual([]);
  });

  // CI run of 191e768, macOS runner, Chromium: the default 577,000 to 794,000 per second with half
  // the gaps over 50 ms; Maximum 2,210,180, 1,940,008 and 1,354,003 per second at 18 frames per second.
  it('passes the macOS runner figures, where the old wall-clock threshold of 2.5 million failed', () => {
    const verdict = judgeMaximum([
      pair(win(700_000, 33, 0.05), win(2_210_180, 55, 0.95)),
      pair(win(794_000, 33, 0.05), win(1_940_008, 55, 0.9)),
      pair(win(577_000, 40, 0.05), win(1_354_003, 70, 0.9)),
    ]);
    expect(verdict.ok).toBe(true);
    expect(verdict.detail).toContain('2,210,180/s at Maximum, 3.2 times');
  });

  it('fails a Maximum throttled like the default speed, whatever the frames', () => {
    const verdict = judgeMaximum([pair(win(1e6, 16.7, 0.07), win(1e6, 16.7, 0.07))]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('time budget');
    expect(judgeMaximum([pair(win(417_000, 120, 0.05), win(450_000, 120, 0.05))]).ok).toBe(false);
  });

  it('fails a Maximum that a count stops early, even when it is faster than the default', () => {
    // A cap of 5 million per second: four times the default on fast frames, but the engine idles.
    const verdict = judgeMaximum([pair(win(1e6, 16.7, 0.07), win(5e6, 16.7, 0.35))]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('never ran 60 %');
  });

  it('fails an engine that is busy but executes no more than the default', () => {
    const verdict = judgeMaximum([pair(win(1e6, 16.7, 0.07), win(1.5e6, 16.7, 1))]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('2 times');
  });

  it('needs both in the same pair', () => {
    const verdict = judgeMaximum([
      pair(win(1e6, 16.7, 0.07), win(5e6, 16.7, 0.35)),
      pair(win(1e6, 16.7, 0.07), win(1.5e6, 16.7, 1)),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('no single pair');
  });
});

describe('judgeDelays', () => {
  it('needs every run at least 50 hundredths and one within its allowance', () => {
    expect(judgeDelays([{ took: 50, lateMs: 0, allowed: 51 }]).ok).toBe(true);
    expect(judgeDelays([{ took: 49, lateMs: 0, allowed: 51 }]).ok).toBe(false);
    expect(judgeDelays([{ took: 60, lateMs: 0, allowed: 51 }]).ok).toBe(false);
    expect(judgeDelays([{ took: 60, lateMs: 90, allowed: 60 }]).detail).toBe(
      '60 (timers 90 ms late) hundredths of a second',
    );
  });
});
