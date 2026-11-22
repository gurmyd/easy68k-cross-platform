// Types of perf-verdicts.mjs, for the TypeScript tests of this folder. Owner: P1.

export declare const LIMITS: {
  readonly taskDurationSeconds: number;
  readonly taskDurationWindowSeconds: number;
  readonly frameP95Ms: { readonly 60: number; readonly 120: number };
  readonly maximumSteps: number;
  readonly maximumWindowSeconds: number;
  readonly maximumShareOfEngine: number;
  readonly maximumEngineSeconds: number;
  readonly assemblyMs: number;
};

export declare const CALIBRATE: { readonly BLOCK: number; readonly PERBLK: number; readonly MINTIME: number };

export interface Summary {
  count: number;
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}

export interface Verdict {
  ok: boolean;
  detail: string;
}

export interface BestVerdict extends Verdict {
  best: number;
}

export interface CalibrateReport {
  instructions: number;
  hundredths: number;
  ips: number;
}

export interface ProcessRow {
  pid: number;
  ppid: number;
  bytes: number;
}

export declare function percentile(values: readonly number[], p: number): number;
export declare function summarize(values: readonly number[]): Summary;
export declare function intervalsOf(timestamps: readonly number[]): number[];
export declare function stepsBetween(samples: readonly number[]): number;
export declare function grouped(value: number): string;
export declare function fixed(value: number, digits?: number): string;
export declare function judgeHere(where: {
  platform: string;
  browser: string;
  override?: 'strict' | 'report' | null;
}): boolean;
export declare function judgeBest<T>(
  runs: readonly T[],
  how: { value: (run: T) => number; better: 'lower' | 'higher'; limit: number; unit: string; digits?: number },
): BestVerdict;
export declare function judgeFrames(runs: readonly (Summary & { passes?: number })[], hz: 60 | 120): BestVerdict;
export declare function judgeTaskDuration(runs: readonly { seconds: number }[]): BestVerdict;
export declare function judgeMaximum(
  runs: readonly { steps: number }[],
  engineRate: number,
): BestVerdict & { floorOk: boolean; shareOk: boolean; share: number };
export declare function judgeAssembly(runs: readonly { ms: number }[]): BestVerdict;
export declare function judgeCalibrate(
  report: CalibrateReport,
  expectation?: { expected?: number | null; tolerance?: number },
): Verdict;
export declare function parseCalibrateReport(text: string): CalibrateReport | null;
export declare function treeMemory(rows: readonly ProcessRow[], root: number): { bytes: number; processes: number };
export declare function parsePs(text: string): ProcessRow[];
export declare function parseWindowsProcesses(json: string): ProcessRow[];
export declare function mib(bytes: number): string;
