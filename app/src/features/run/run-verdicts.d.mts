// Types of run-verdicts.mjs, for run-verdicts.test.ts. Owner: SH8.

export declare const STEADY_GAP_MS: number;

export interface DelayRun {
  took: number;
  lateMs: number;
  allowed: number;
}

export interface RateWindow {
  executed: number;
  ms: number;
  granted: number;
  longest: number;
  frames?: number;
  slow?: number;
  exact: boolean;
}

export interface Verdict {
  ok: boolean;
  detail: string;
}

export declare function judgeDelays(runs: readonly DelayRun[]): Verdict;
export declare function judgeRate(windows: readonly RateWindow[]): Verdict & { notes: string[] };

export declare const SLICE_BUDGET_MS: number;
export declare const SLICE_FRAME_SHARE: number;
export declare const MAXIMUM_FACTOR: number;
export declare const BUSY_SHARE: number;

export declare function budgetFor(gap: number): number;

/** A window of the Maximum measurement (see judgeMaximum in run-verdicts.mjs). */
export interface MaximumWindow {
  executed: number;
  ms: number;
  frames: number;
  longest: number;
  /** Engine time of the controller's engine.run calls in the window, in ms. */
  busy: number;
  /** Engine time the governor's budget allows for the window's frames, in ms. */
  budget: number;
}

/** Two windows back to back in the same run: at the default speed, then at Maximum. */
export interface MaximumPair {
  normal: MaximumWindow;
  max: MaximumWindow;
}

export declare function judgeMaximum(pairs: readonly MaximumPair[]): Verdict & { notes: string[] };
