// The verdicts of the run check (run-verdicts.mjs) on its measurements. The browser check
// measures; these tests hold the judgement to its rules without a browser.

import { describe, expect, it } from 'vitest';
import {
  SLICE_BUDGET_MS as GOVERNOR_BUDGET_MS,
  SLICE_FRAME_SHARE as GOVERNOR_FRAME_SHARE,
} from '../../core/run/governor';
import {
  BUSY_SHARE,
  FRAME_KEEP_SHARE,
  FROZEN_FPS,
  MAXIMUM_FACTOR,
  MAX_FRAME_WINDOW_MS,
  MIN_JUDGED_FRAMES,
  SLICE_BUDGET_MS,
  SLICE_FRAME_SHARE,
  budgetFor,
  judgeDelays,
  frameWindowMs,
  judgeFrames,
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

describe('judgeFrames', () => {
  /** A pair of half-second windows: `max` frames at Maximum, `normal` at the default speed just before. */
  const frames = (max: number, normal: number, ms = 500) => ({
    normal: { frames: normal, ms },
    max: { frames: max, ms },
  });

  it('has the thresholds that the errata entry explains', () => {
    expect(FRAME_KEEP_SHARE).toBe(0.7);
    expect(MIN_JUDGED_FRAMES).toBe(6);
    expect(FROZEN_FPS).toBe(4);
  });

  // CI run 44999787233 (4bd5f68), macos-latest, Chromium: about 15 frames per second at either speed;
  // the old absolute rule (more than 15 per second) failed it with 11.
  it('passes the macOS runner figures of Chromium, about 15 frames per second at both speeds', () => {
    const verdict = judgeFrames([frames(8, 7), frames(8, 9), frames(9, 8)]);
    expect(verdict.ok).toBe(true);
    expect(verdict.notes).toEqual([]);
    expect(verdict.detail).toBe(
      "3 of 3 pairs kept at least 70 % of the default's frame rate: " +
        '8 frames in 500 ms at Maximum (16.0/s) against 7 in 500 ms at the default (14.0/s): 114 % | ' +
        '8 frames in 500 ms at Maximum (16.0/s) against 9 in 500 ms at the default (18.0/s): 89 % | ' +
        '9 frames in 500 ms at Maximum (18.0/s) against 8 in 500 ms at the default (16.0/s): 113 %',
    );
  });

  it('passes the macOS runner figures of WebKit, 60 frames per second', () => {
    expect(judgeFrames([frames(30, 29), frames(29, 30), frames(30, 30)]).ok).toBe(true);
  });

  // npm run check:run on this PC (Windows, loaded by other engineers), 2026-11-22.
  it("passes this PC's figures (Windows, loaded)", () => {
    expect(judgeFrames([frames(31, 30), frames(30, 30), frames(30, 30)]).ok).toBe(true); // Chromium
    expect(judgeFrames([frames(29, 26), frames(22, 26), frames(25, 24)]).ok).toBe(true); // WebKit
  });

  it('fails a page that loses most of its frames at Maximum, and one that loses half', () => {
    const verdict = judgeFrames([frames(8, 30), frames(9, 31), frames(7, 30)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('took the page');
    // An engine that overruns each frame halves the rate; at the fewest frames judged that is 4 of 6.
    expect(judgeFrames([frames(15, 30), frames(16, 30), frames(15, 31)]).ok).toBe(false);
    expect(judgeFrames([frames(4, 6), frames(4, 6), frames(4, 6)]).ok).toBe(false);
  });

  it('fails a frozen page, also when the default had too few frames to judge a share', () => {
    const verdict = judgeFrames([frames(0, 30), frames(1, 30), frames(0, 29)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('froze');
    expect(judgeFrames([frames(1, 4), frames(0, 5), frames(1, 4)]).ok).toBe(false);
  });

  // Review R4 of gate I3, and gate I3 round 4: 2 frames against 5 is a loss of 60 %, which the floor
  // alone let pass under a caption that speaks of the 70 % share. A pair with too few frames at the
  // default cannot show the share, so it does not pass, and the verdict says what was judged.
  it('does not pass windows with too few frames at the default to judge a share, and says so', () => {
    const verdict = judgeFrames([frames(3, 5), frames(2, 4), frames(3, 5)]);
    expect(verdict.ok).toBe(false);
    expect(verdict.notes.join(' ')).toContain('3 of 3 pairs had fewer than 6 frames');
    expect(verdict.notes.join(' ')).toContain('the frames could not be judged, a failure');
    expect(verdict.detail).toContain('too few at the default to judge');
    const lost = judgeFrames([frames(2, 5), frames(2, 5), frames(2, 5)]);
    expect(lost.ok).toBe(false);
    expect(lost.detail).toMatch(
      /^0 of 3 pairs kept at least 70 % of the default's frame rate, 3 had too few frames at the default to judge \(counted as not kept\)/,
    );
  });

  it('counts a pair with too few frames at the default as one that did not keep the share', () => {
    const mixed = judgeFrames([frames(30, 30), frames(2, 5), frames(29, 30)]);
    expect(mixed.ok).toBe(true);
    expect(mixed.detail).toMatch(
      /^2 of 3 pairs kept at least 70 % [^:]*, 1 had too few frames at the default to judge/,
    );
    expect(judgeFrames([frames(30, 30), frames(2, 5), frames(10, 30)]).ok).toBe(false);
    expect(judgeFrames([frames(30, 30), frames(5, 5), frames(5, 5)]).ok).toBe(false);
  });

  it('frameWindowMs: no second measurement when every default window has enough frames', () => {
    expect(frameWindowMs([frames(8, 7), frames(8, 6), frames(9, 8)])).toBeNull();
    expect(frameWindowMs([])).toBeNull();
  });

  it('frameWindowMs: windows long enough for twice MIN_JUDGED_FRAMES at the slowest short default window', () => {
    // 5 frames in 500 ms: 10 per second, so 12 frames take 1200 ms.
    expect(frameWindowMs([frames(2, 5), frames(8, 7), frames(9, 8)])).toBe(1200);
    // 3 frames in 500 ms: 6 per second, 12 frames take 2000 ms.
    expect(frameWindowMs([frames(2, 5), frames(2, 3)])).toBe(2000);
    // never shorter than a second, never longer than MAX_FRAME_WINDOW_MS
    expect(frameWindowMs([frames(5, 5, 100)])).toBe(1000);
    expect(frameWindowMs([frames(0, 0)])).toBe(MAX_FRAME_WINDOW_MS);
    expect(frameWindowMs([frames(1, 1)])).toBe(MAX_FRAME_WINDOW_MS);
    // with such windows a page of 10 frames per second is judged by its share
    const longer = judgeFrames([frames(4, 12, 1200), frames(5, 12, 1200), frames(4, 12, 1200)]);
    expect(longer.ok).toBe(false);
    expect(longer.notes.join(' ')).toContain('took the page');
  });

  it('needs a majority of the pairs: one disturbed pair decides nothing alone', () => {
    expect(judgeFrames([frames(30, 30), frames(10, 30), frames(29, 30)]).ok).toBe(true);
    expect(judgeFrames([frames(30, 30), frames(10, 30), frames(9, 30)]).ok).toBe(false);
    expect(judgeFrames([]).ok).toBe(false);
  });

  it('compares rates, so a window that a late timer made longer is not short of frames', () => {
    expect(judgeFrames([frames(30, 30, 500)].map((pair) => ({ ...pair, max: { frames: 36, ms: 600 } }))).ok).toBe(true);
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
