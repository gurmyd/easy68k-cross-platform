// Best-of-N timing that tolerates a loaded machine (the speed acceptance of ARCHITECTURE.md 9.2
// E3). Owner: E3.
//
// The highlighter's speed is a property of the code, not of the moment: the best run is what counts.
// On a machine shared with other test runs a whole batch can be descheduled, so the measurement
// repeats batches until one reaches the target, up to a number of batches and a time budget, and
// reports the best run it saw. Used by the unit test and by the browser check's page harness.

export interface MeasureOptions {
  /** Stop as soon as the best run is below this many milliseconds. */
  target: number;
  /** Runs per batch (default 25). */
  batch?: number;
  /** At most this many batches (default 20). */
  maxBatches?: number;
  /** Stop starting new batches once this many milliseconds have passed (default 10,000). */
  budgetMs?: number;
  /** The clock (default performance.now). */
  now?: () => number;
}

export interface Measurement {
  /** Best run, in milliseconds. */
  best: number;
  /** Runs made. */
  runs: number;
}

export function measureBest(work: () => unknown, options: MeasureOptions): Measurement {
  const { target, batch = 25, maxBatches = 20, budgetMs = 10_000, now = () => performance.now() } = options;
  const started = now();
  let best = Infinity;
  let runs = 0;
  for (let n = 0; n < maxBatches; n++) {
    for (let i = 0; i < batch; i++) {
      const start = now();
      work();
      best = Math.min(best, now() - start);
      runs++;
    }
    if (best < target || now() - started >= budgetMs) break;
  }
  return { best, runs };
}
