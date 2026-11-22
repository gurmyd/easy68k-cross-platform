// The verdicts of the run check (check-run.mjs) on what it measured, apart from the browser so
// that a unit test can hold them to their rules (run-verdicts.test.ts). Owner: SH8.

/** Frames (or watchdog ticks) further apart than this count as unsteady; the governor's MAX_CATCHUP_MS. */
export const STEADY_GAP_MS = 50;
/** The verdict on `measureDelay`: no run too short, and one run exact. */
export function judgeDelays(runs) {
  return {
    ok: runs.every((run) => run.took >= 50) && runs.some((run) => run.took <= run.allowed),
    detail: runs
      .map((run) => `${run.took}${run.lateMs >= 5 ? ` (timers ${Math.round(run.lateMs)} ms late)` : ''}`)
      .join(', ')
      .concat(' hundredths of a second'),
  };
}

/**
 * The verdict on the default speed over measurement windows of `{ executed, ms, granted, longest,
 * exact }` (`granted`: what the governor's allowance rule grants for the frames, or watchdog ticks,
 * the window really had: the time since the one before, at most STEADY_GAP_MS each, times 1000).
 *
 * What the product guarantees (ARCHITECTURE.md 4.2): the allowance never exceeds that grant, plus
 * one cap of allowance carried into the window; and it executes the whole grant whenever the time
 * budget of a frame (8 ms, or half the frame interval) suffices for it. At a million instructions
 * per second a frame's grant is at most 50,000 instructions, which the engine executes in 8 ms on
 * any machine that runs it at 6.25 million instructions per second or more; every CI runner and this
 * PC do (the Maximum check). So one window in up to five must be exact (3 %), and a window can only
 * fall short of it on a machine too slow or too loaded for that budget.
 *
 * A window whose frames were all steady (no gap over STEADY_GAP_MS) leaves the budget no excuse: if
 * any window was steady, one window must be exact (gate I1 round 3 review). Only when every window
 * had gaps over STEADY_GAP_MS - the frames of a throttled browser, where late frames crowd the
 * engine's time budget - may the best window fall back on half its grant, which still rules out a
 * governor that loses time. The figures are printed so that the CI log alone tells the runner from
 * the product.
 */
export function judgeRate(windows) {
  const perSecond = (amount, run) => amount / (run.ms / 1000);
  const share = (run) => (run.granted > 0 ? run.executed / run.granted : 0);
  const describe = (run) =>
    `${Math.round(perSecond(run.executed, run)).toLocaleString('en-US')}/s, ${Math.round(100 * share(run))} % ` +
    `of the grant of ${Math.round(perSecond(run.granted, run)).toLocaleString('en-US')}/s over ` +
    `${Math.round(run.ms)} ms (longest gap ${Math.round(run.longest)} ms` +
    `${run.slow !== undefined ? `, ${run.slow} of ${run.frames} gaps over ${STEADY_GAP_MS} ms` : ''})`;
  const neverAbove = windows.every((run) => run.executed <= 1.03 * run.granted + 50_000);
  const exact = windows.some((run) => run.exact);
  const steady = windows.filter((run) => run.slow === 0 || (run.slow === undefined && run.longest <= STEADY_GAP_MS));
  const best = Math.max(...windows.map(share));
  const notes = [];
  if (!neverAbove) notes.push('a window executed more than the governor grants: the product is wrong');
  let fallback = false;
  if (!exact && steady.length > 0) {
    notes.push(
      `no window executed its whole grant (best ${Math.round(100 * best)} %), although ${steady.length} of ` +
        `${windows.length} windows had steady frames, where the time budget of a frame suffices: a failure.`,
    );
  } else if (!exact) {
    fallback = best >= 0.5;
    notes.push(
      `no window executed its whole grant (best ${Math.round(100 * best)} %) and every window had gaps over ` +
        `${STEADY_GAP_MS} ms: the engine's time budget per frame was the limit. ` +
        `${fallback ? 'Accepted: at least half the grant.' : 'Below half the grant: a failure.'}`,
    );
  }
  return { ok: neverAbove && (exact || fallback), detail: windows.map(describe).join('; '), notes };
}

/** The governor's time budget per frame (core/run/governor.ts SLICE_BUDGET_MS and SLICE_FRAME_SHARE). */
export const SLICE_BUDGET_MS = 8;
export const SLICE_FRAME_SHARE = 0.5;
/** "Far more than the default speed": at least this many times the default's rate in the same pair. */
export const MAXIMUM_FACTOR = 2;
/** "Limited only by the time budget": the engine ran at least this share of its budget at Maximum. */
export const BUSY_SHARE = 0.6;

/** The engine time the governor grants a stretch of `gap` ms between two frames. */
export function budgetFor(gap) {
  return Math.min(SLICE_BUDGET_MS, SLICE_FRAME_SHARE * Math.max(gap, 0));
}

/**
 * The verdict on `Maximum` over pairs `{ normal, max }` of measurement windows taken back to back in
 * the same run of the same program, first at the default speed, then at Maximum. A window is
 * `{ executed, ms, frames, longest, busy, budget }`: instructions executed, its length, the display
 * frames it had and their longest gap, the engine time the controller's `engine.run` calls took
 * (`busy`), and the engine time the governor's budget allows for those frames (`budget`, the sum of
 * budgetFor(gap) over its gaps).
 *
 * What the check proves is what 4.2 and 4.5.6 promise of `Maximum`: no instruction count throttles
 * it, only the engine's time budget per frame. Two things show that on any machine, however fast
 * its engine and however late its frames (GitHub's macOS runner: Chromium frames 55 to 120 ms
 * apart, a wall-clock rate of 1.1 to 2.2 million per second; errata SH8.md entry 41):
 *   - the engine ran for at least BUSY_SHARE of its time budget at Maximum (at a throttled speed it
 *     stops when the allowance is spent, after a fraction of the budget on any CI machine), and
 *   - the program executed at least MAXIMUM_FACTOR times what it executed at the default speed
 *     just before, in the same page, the same frames and the same load.
 * One pair of three must show both. How fast a given machine is at Maximum is not this check's
 * business: section 6.9 item 9 sets that figure (200 million in 10 s) for Chromium on ubuntu-latest,
 * and tests/perf measures it there. The wall-clock rates are printed for information.
 */
export function judgeMaximum(pairs) {
  const rate = (run) => (run.ms > 0 ? run.executed / (run.ms / 1000) : 0);
  const factor = (pair) => (rate(pair.normal) > 0 ? rate(pair.max) / rate(pair.normal) : Infinity);
  const share = (run) => (run.budget > 0 ? run.busy / run.budget : 0);
  const n = (x) => Math.round(x).toLocaleString('en-US');
  const describe = (pair) =>
    `${n(rate(pair.max))}/s at Maximum, ${factor(pair).toFixed(1)} times the default's ${n(rate(pair.normal))}/s; ` +
    `engine ${Math.round(pair.max.busy)} of ${Math.round(pair.max.budget)} ms budget ` +
    `(${Math.round(100 * share(pair.max))} %, ${n(pair.max.busy > 0 ? pair.max.executed / (pair.max.busy / 1000) : 0)}/s ` +
    `while it ran; at the default ${Math.round(pair.normal.busy)} of ${Math.round(pair.normal.budget)} ms); ` +
    `${pair.max.frames} and ${pair.normal.frames} frames, longest gaps ${Math.round(pair.max.longest)} and ` +
    `${Math.round(pair.normal.longest)} ms`;
  const passes = (pair) => factor(pair) >= MAXIMUM_FACTOR && share(pair.max) >= BUSY_SHARE;
  const ok = pairs.some(passes);
  const notes = [];
  if (!ok) {
    const bestFactor = Math.max(0, ...pairs.map(factor));
    const bestShare = Math.max(0, ...pairs.map((pair) => share(pair.max)));
    if (bestShare < BUSY_SHARE)
      notes.push(
        `the engine never ran ${Math.round(100 * BUSY_SHARE)} % of its time budget at Maximum (best ` +
          `${Math.round(100 * bestShare)} %): something other than the budget stopped it, a failure.`,
      );
    if (bestFactor < MAXIMUM_FACTOR)
      notes.push(
        `Maximum never executed ${MAXIMUM_FACTOR} times the default speed's rate of the same pair (best ` +
          `${bestFactor.toFixed(2)}): a failure.`,
      );
    if (bestShare >= BUSY_SHARE && bestFactor >= MAXIMUM_FACTOR) notes.push('no single pair showed both: a failure.');
  }
  return { ok, detail: pairs.map(describe).join(' | '), notes };
}
