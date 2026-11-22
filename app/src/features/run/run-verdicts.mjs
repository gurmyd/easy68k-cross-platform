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

/** "Keeps its frames": at Maximum the page has at least this share of the default speed's frame rate. */
export const FRAME_KEEP_SHARE = 0.7;
/** A default-speed window with fewer display frames than this is too short to judge a share by. */
export const MIN_JUDGED_FRAMES = 6;
/** Fewer frames per second than this at Maximum is a frozen page, whatever the default had. */
export const FROZEN_FPS = 4;

/**
 * The verdict on the page's display frames at `Maximum`, over the same pairs `{ normal, max }` that
 * judgeMaximum judges (only `frames` and `ms` of each window are used).
 *
 * What 4.2 promises: the engine takes at most half of each frame's time (8 ms, or half the frame
 * interval), so on a display that delivers its frames the program at Maximum costs the page no
 * frame. How many frames a browser delivers is the machine's (Chromium on GitHub's macOS runner
 * about 15 per second whatever the program does; errata SH8.md entry 44), so the verdict compares
 * each Maximum window with the default-speed window just before it, on the same page, the same
 * machine and the same load, where the engine takes almost none of the frame:
 *   - a pair passes when Maximum's frame rate is at least FRAME_KEEP_SHARE of the default's and at
 *     least FROZEN_FPS. A page that keeps its frames measures about 1; a window counts its frames
 *     to plus or minus one, so with MIN_JUDGED_FRAMES or more at the default a kept page measures
 *     at least 5/6 to 5/7 (the macOS runner's worst pair: 7 against 9, 78 %). On a display that
 *     delivers its frames, an engine that overruns the frame halves the rate or worse, at most 4/6
 *     (67 %) even at the fewest frames judged; so 0.7 lies between the two. Headless Chromium's
 *     frames are not tied to a display: there an engine that overruns the frame a little loses
 *     only about a quarter of them (a 20 ms busy wait after each engine.run: 76 to 79 %, which
 *     passes), and one that takes most of the frame is caught (40 ms: 40 %); WebKit catches both
 *     (56 to 78 % and 28 to 34 %; errata SH8.md entries 44 and 45).
 *   - A pair whose default window had fewer than MIN_JUDGED_FRAMES frames (under 12 per second in
 *     half a second) is too short for a share, where one frame is a sixth or more: it cannot show
 *     that the page kept its frames, so it does not pass (gate I3 round 4: before, such a pair
 *     passed by the floor alone, and 2 frames against 5, a loss of 60 %, passed a verdict whose
 *     caption speaks of the 70 % share). The detail counts it apart and a note says so.
 *     check-run.mjs avoids such pairs: it measures the frames again in windows of
 *     frameWindowMs(pairs) when one occurs, long enough for MIN_JUDGED_FRAMES down to 1.5 frames
 *     per second at the default. A frozen page (under FROZEN_FPS at Maximum) fails in every pair.
 *   - A majority of the pairs must keep the share. A loss of frames that the product causes is
 *     systematic (Maximum fills the engine's budget in every window) and shows in every pair; a
 *     runner's hiccup in one window, either way, decides nothing alone.
 * So `ok` means exactly what check-run.mjs's caption says: in most of the pairs the page had at
 * Maximum at least FRAME_KEEP_SHARE of the default speed's frame rate (and FROZEN_FPS).
 */
export function judgeFrames(pairs) {
  const fps = (run) => (run.ms > 0 ? run.frames / (run.ms / 1000) : 0);
  const share = (pair) => (fps(pair.normal) > 0 ? fps(pair.max) / fps(pair.normal) : Infinity);
  const judged = (pair) => pair.normal.frames >= MIN_JUDGED_FRAMES;
  const frozen = (pair) => fps(pair.max) < FROZEN_FPS;
  const keeps = (pair) => judged(pair) && !frozen(pair) && share(pair) >= FRAME_KEEP_SHARE;
  const describe = (pair) =>
    `${pair.max.frames} frames in ${Math.round(pair.max.ms)} ms at Maximum (${fps(pair.max).toFixed(1)}/s) ` +
    `against ${pair.normal.frames} in ${Math.round(pair.normal.ms)} ms at the default ` +
    `(${fps(pair.normal).toFixed(1)}/s): ` +
    `${Number.isFinite(share(pair)) ? `${Math.round(100 * share(pair))} %` : 'no frames at the default'}` +
    `${judged(pair) ? '' : ', too few at the default to judge'}${keeps(pair) ? '' : ' - short'}`;
  const kept = pairs.filter(keeps).length;
  const unjudged = pairs.filter((pair) => !judged(pair)).length;
  const ok = pairs.length > 0 && 2 * kept > pairs.length;
  const notes = [];
  if (unjudged > 0)
    notes.push(
      `${unjudged} of ${pairs.length} pairs had fewer than ${MIN_JUDGED_FRAMES} frames at the default speed, too ` +
        `few to judge a share: they count as pairs that did not keep it.`,
    );
  if (!ok) {
    const frozenPairs = pairs.filter(frozen).length;
    if (frozenPairs > 0)
      notes.push(
        `${frozenPairs} of ${pairs.length} pairs had fewer than ${FROZEN_FPS} frames per second at Maximum: ` +
          `the page froze, a failure.`,
      );
    notes.push(
      `only ${kept} of ${pairs.length} pairs kept ${Math.round(100 * FRAME_KEEP_SHARE)} % of the default ` +
        `speed's frame rate at Maximum` +
        `${unjudged > 0 ? ` (${unjudged} could not be judged)` : ''}: ` +
        `${unjudged === pairs.length ? 'the frames could not be judged, a failure.' : "the engine took the page's frames, a failure."}`,
    );
  }
  return {
    ok,
    detail:
      `${kept} of ${pairs.length} pairs kept at least ${Math.round(100 * FRAME_KEEP_SHARE)} % of the ` +
      `default's frame rate` +
      `${unjudged > 0 ? `, ${unjudged} had too few frames at the default to judge (counted as not kept)` : ''}` +
      `: ${pairs.map(describe).join(' | ')}`,
    notes,
  };
}

/** The longest frame window check-run.mjs measures, in ms. */
export const MAX_FRAME_WINDOW_MS = 4000;

/**
 * How long the windows of a second frame measurement must be so that every default-speed window has
 * MIN_JUDGED_FRAMES frames: null when every pair of `pairs` already has them; otherwise twice the
 * time the slowest default window needs for them, at least 1000 ms and at most MAX_FRAME_WINDOW_MS
 * (a page with fewer frames than that cannot be judged, and judgeFrames fails it). Only `frames`
 * and `ms` are read.
 */
export function frameWindowMs(pairs) {
  const short = pairs.filter((pair) => pair.normal.frames < MIN_JUDGED_FRAMES);
  if (short.length === 0) return null;
  const slowest = Math.min(...short.map((pair) => (pair.normal.ms > 0 ? pair.normal.frames / pair.normal.ms : 0)));
  const needed = slowest > 0 ? (2 * MIN_JUDGED_FRAMES) / slowest : Infinity;
  return Math.round(Math.min(MAX_FRAME_WINDOW_MS, Math.max(1000, needed)));
}
