// The verdicts of the run check (run-verdicts.mjs) on its measurements. The browser check
// measures; these tests hold the judgement to its rules without a browser.

import { describe, expect, it } from 'vitest';
import { judgeDelays, judgeRate, type RateWindow } from './run-verdicts.mjs';

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
