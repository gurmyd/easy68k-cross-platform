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
