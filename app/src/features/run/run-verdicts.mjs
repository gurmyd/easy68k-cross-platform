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
