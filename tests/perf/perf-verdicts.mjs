// The figures and verdicts of the performance measurements (ARCHITECTURE.md 6.9 item 9, 9.6 P1).
// Owner: P1.
//
// Plain functions without a browser, used by check-perf.mjs and held to their rules by
// perf-verdicts.test.ts. Every time or rate is measured several times on a machine that may be
// busy; the functions here pick the best run, say how far the runs spread, and judge only the best
// run against a threshold, so that a run made slow by other work on the machine cannot fail a check
// on its own.
//
// Two kinds of figure are kept apart everywhere:
//   - what the program observes (its own clock, task 8, and the instruction count): exact by
//     design, the same on every machine that keeps up;
//   - wall-clock figures (frame intervals, the main thread's busy time, the rate at Maximum, the
//     time to assemble): properties of the machine and the browser, judged only where 6.9 sets a
//     threshold for them.

/** The thresholds of ARCHITECTURE.md 6.9 item 9. */
export const LIMITS = Object.freeze({
  /** Increase of TaskDuration over 30 s of spin.X68 at the default speed, in seconds (15 % of a core). */
  taskDurationSeconds: 4.5,
  /** Window of the TaskDuration measurement, in seconds. */
  taskDurationWindowSeconds: 30,
  /** 95th percentile of the frame intervals while draw.X68 runs, in milliseconds. */
  frameP95Ms: { 60: 20, 120: 12 },
  /**
   * Instructions at Maximum in 10 s, at least (corrected by the architect's decision of 22 November
   * 2026, erratum P1 13: it was 200 million, which assumed an engine of 40 million per second).
   */
  maximumSteps: 100_000_000,
  /** Window of the Maximum measurement, in seconds. */
  maximumWindowSeconds: 10,
  /**
   * And at least this share of what the engine alone executes in maximumEngineSeconds on the same
   * runner in the same job: the governor gives the engine half of each frame (SLICE_FRAME_SHARE =
   * 0.5, section 4.1), so 10 s at Maximum can give at most what the engine alone does in 5 s.
   */
  maximumShareOfEngine: 0.85,
  /** The engine-alone time the Maximum window is compared with, in seconds (10 s x 0.5). */
  maximumEngineSeconds: 5,
  /** Assembling the largest corpus file under Node, in milliseconds. */
  assemblyMs: 1000,
});

/** The values of calibrate.X68 (its EQU lines). */
export const CALIBRATE = Object.freeze({ BLOCK: 25_000, PERBLK: 2 * 25_000 + 9, MINTIME: 1000 });

// ------------------------------------------------------------------------------------ statistics

/** The p-th percentile (0-100) by the nearest-rank method; NaN for no values. */
export function percentile(values, p) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Count, smallest, median, 95th percentile, largest and mean of some values. */
export function summarize(values) {
  const count = values.length;
  const mean = count === 0 ? Number.NaN : values.reduce((sum, v) => sum + v, 0) / count;
  return {
    count,
    min: count === 0 ? Number.NaN : Math.min(...values),
    median: percentile(values, 50),
    p95: percentile(values, 95),
    max: count === 0 ? Number.NaN : Math.max(...values),
    mean,
  };
}

/** The gaps between consecutive timestamps. */
export function intervalsOf(timestamps) {
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) gaps.push(timestamps[i] - timestamps[i - 1]);
  return gaps;
}

/**
 * The instructions executed between samples of `engine.stepCount`, which is an unsigned 32-bit
 * counter that wraps: the sum of the differences, each taken modulo 2^32. Samples must be taken
 * often enough that fewer than 2^32 instructions pass between two of them.
 */
export function stepsBetween(samples) {
  let total = 0;
  for (let i = 1; i < samples.length; i++) total += (samples[i] - samples[i - 1] + 2 ** 32) % 2 ** 32;
  return total;
}

/** A number with thousands separators, the same on every system. */
export const grouped = (value) => Math.round(value).toLocaleString('en-US');

/** A number with `digits` decimals. */
export const fixed = (value, digits = 1) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

// ------------------------------------------------------------------------------------ verdicts

/**
 * Where the thresholds of 6.9 item 9 are judged. 6.9 sets them for Chromium on ubuntu-latest; on
 * other systems and in WebKit the same figures are measured and printed, and a miss is reported
 * as a note, not as a failure (the macOS runners of CI deliver frames 100 ms and more apart and
 * fire timers late, errata SH8.md entry 30). `strict` judges everywhere, `report` nowhere.
 */
export function judgeHere({ platform, browser, override = null }) {
  if (override === 'strict') return true;
  if (override === 'report') return false;
  return platform === 'linux' && browser === 'chromium';
}

/**
 * A verdict on runs of which the best counts. `value(run)` is the figure, `better` says whether
 * lower or higher is better, `limit` the threshold the best run must beat (strictly).
 */
export function judgeBest(runs, { value, better, limit, unit, digits = 1 }) {
  if (runs.length === 0) return { ok: false, best: Number.NaN, detail: 'no run' };
  const figures = runs.map(value);
  const best = better === 'lower' ? Math.min(...figures) : Math.max(...figures);
  const ok = better === 'lower' ? best < limit : best >= limit;
  const show = (v) => (digits === 0 ? grouped(v) : fixed(v, digits));
  const spread = runs.length > 1 ? `, runs ${figures.map(show).join(', ')}` : '';
  const sign = better === 'lower' ? '<' : '>=';
  return { ok, best, detail: `best ${show(best)} ${unit} (needs ${sign} ${show(limit)})${spread}` };
}

/** Frame intervals: the run with the lowest 95th percentile counts. */
export function judgeFrames(runs, hz) {
  const limit = LIMITS.frameP95Ms[hz];
  const verdict = judgeBest(runs, { value: (run) => run.p95, better: 'lower', limit, unit: 'ms p95', digits: 2 });
  const best = runs.find((run) => run.p95 === verdict.best);
  const shape = best
    ? `; that run: ${best.count} intervals, median ${fixed(best.median, 2)}, max ${fixed(best.max, 1)} ms, ` +
      `${grouped(best.passes ?? 0)} passes of draw.X68`
    : '';
  return { ...verdict, detail: `${verdict.detail}${shape}` };
}

/** Main-thread busy time over the window: the run with the least counts. */
export function judgeTaskDuration(runs) {
  return judgeBest(runs, {
    value: (run) => run.seconds,
    better: 'lower',
    limit: LIMITS.taskDurationSeconds,
    unit: `s of TaskDuration in ${LIMITS.taskDurationWindowSeconds} s`,
    digits: 2,
  });
}

/**
 * Instructions at Maximum in the window (6.9 item 9 as corrected on 22 November 2026, erratum P1 13):
 * the run with the most counts must reach both LIMITS.maximumSteps and LIMITS.maximumShareOfEngine
 * of what the engine alone executes in LIMITS.maximumEngineSeconds, from `engineRate`, the engine
 * alone's instructions per second measured on the same runner in the same job. Without an engine
 * figure the verdict fails: the second condition cannot be judged.
 */
export function judgeMaximum(runs, engineRate) {
  const unit = `instructions in ${LIMITS.maximumWindowSeconds} s`;
  const floor = judgeBest(runs, {
    value: (run) => run.steps,
    better: 'higher',
    limit: LIMITS.maximumSteps,
    unit,
    digits: 0,
  });
  const engineSteps = Number.isFinite(engineRate) && engineRate > 0 ? engineRate * LIMITS.maximumEngineSeconds : NaN;
  const needed = engineSteps * LIMITS.maximumShareOfEngine;
  const share = floor.best / engineSteps;
  const shareOk = Number.isFinite(needed) && floor.best >= needed;
  const shareText = Number.isFinite(engineSteps)
    ? `${fixed(100 * share, 1)} % of the engine alone's ${grouped(engineSteps)} in ${LIMITS.maximumEngineSeconds} s ` +
      `(${grouped(engineRate)} per second; needs >= ${fixed(100 * LIMITS.maximumShareOfEngine, 0)} % = ${grouped(needed)})`
    : `no figure of the engine alone (needs >= ${fixed(100 * LIMITS.maximumShareOfEngine, 0)} % of what it executes in ${LIMITS.maximumEngineSeconds} s)`;
  return {
    ok: floor.ok && shareOk,
    best: floor.best,
    floorOk: floor.ok,
    shareOk,
    share,
    detail: `${floor.detail}; ${shareText}`,
  };
}

/** Time to assemble: the fastest run counts. */
export function judgeAssembly(runs) {
  return judgeBest(runs, { value: (run) => run.ms, better: 'lower', limit: LIMITS.assemblyMs, unit: 'ms', digits: 0 });
}

/**
 * calibrate.X68 by the program's own clock: the instructions it counted must be a whole number of
 * blocks, at least MINTIME hundredths must have passed, and the rate it reports must be the
 * integer quotient of the two (its own 32-bit division), within `tolerance` of `expected` when an
 * expectation is given. `granted` is what the governor allowed for the frames the page really had
 * (see check-perf.mjs); when it is given the program's figure is compared with it instead.
 */
export function judgeCalibrate({ instructions, hundredths, ips }, { expected = null, tolerance = 0.02 } = {}) {
  const problems = [];
  if (!(instructions > 0) || instructions % CALIBRATE.PERBLK !== 0) {
    problems.push(`${grouped(instructions)} instructions is not a whole number of blocks of ${CALIBRATE.PERBLK}`);
  }
  if (!(hundredths >= CALIBRATE.MINTIME)) problems.push(`only ${hundredths} hundredths passed`);
  const quotient = hundredths > 0 ? Number((BigInt(instructions) * 100n) / BigInt(hundredths)) : Number.NaN;
  if (ips !== quotient)
    problems.push(
      `reported ${grouped(ips)}, but ${grouped(instructions)} * 100 / ${hundredths} = ${grouped(quotient)}`,
    );
  let detail = `${grouped(ips)} instructions per second (${grouped(instructions)} in ${fixed(hundredths / 100, 2)} s)`;
  if (expected !== null) {
    const off = Math.abs(ips - expected) / expected;
    detail += `, ${fixed(100 * (ips / expected - 1), 2)} % from ${grouped(expected)}`;
    if (off > tolerance) problems.push(`more than ${fixed(100 * tolerance, 1)} % from ${grouped(expected)}`);
  }
  return { ok: problems.length === 0, detail: problems.length ? `${detail}: ${problems.join('; ')}` : detail };
}

/** The three numbers of calibrate.X68's report (its screen lines or result.bin), or null. */
export function parseCalibrateReport(text) {
  const number = (label) => {
    const match = new RegExp(`${label}: (\\d+)`).exec(text);
    return match ? Number(match[1]) : null;
  };
  const instructions = number('instructions executed');
  const hundredths = number('hundredths of a second');
  const ips = number('instructions per second');
  return instructions === null || hundredths === null || ips === null ? null : { instructions, hundredths, ips };
}

// ------------------------------------------------------------------------------------ memory

/**
 * The memory of a process and all its descendants. `rows` are { pid, ppid, bytes } for every
 * process of the system; the result is the sum of `bytes` over `root` and every process below it,
 * and how many processes that was.
 */
export function treeMemory(rows, root) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row);
  }
  const self = rows.find((row) => row.pid === root);
  let bytes = self ? self.bytes : 0;
  let processes = self ? 1 : 0;
  const seen = new Set([root]);
  const stack = [...(children.get(root) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop();
    if (seen.has(row.pid)) continue;
    seen.add(row.pid);
    bytes += row.bytes;
    processes++;
    stack.push(...(children.get(row.pid) ?? []));
  }
  return { bytes, processes };
}

/** `ps -A -o pid=,ppid=,rss=` (macOS, Linux; rss in KiB) as rows of treeMemory. */
export function parsePs(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [pid, ppid, rss] = parts.map(Number);
    if ([pid, ppid, rss].every(Number.isFinite)) rows.push({ pid, ppid, bytes: rss * 1024 });
  }
  return rows;
}

/**
 * The JSON of `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,
 * WorkingSetSize | ConvertTo-Json` (Windows) as rows of treeMemory.
 */
export function parseWindowsProcesses(json) {
  const parsed = JSON.parse(json);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list
    .map((p) => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), bytes: Number(p.WorkingSetSize) }))
    .filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.bytes));
}

/** Bytes as MiB with one decimal. */
export const mib = (bytes) => `${fixed(bytes / 2 ** 20, 1)} MiB`;
