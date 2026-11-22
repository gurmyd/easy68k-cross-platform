// Unit tests of the figures and verdicts of the performance check (perf-verdicts.mjs). Owner: P1.
// No browser and no engine.

import { describe, expect, it } from 'vitest';
import {
  CALIBRATE,
  LIMITS,
  intervalsOf,
  judgeAssembly,
  judgeCalibrate,
  judgeFrames,
  judgeHere,
  judgeMaximum,
  judgeTaskDuration,
  parseCalibrateReport,
  parsePs,
  parseWindowsProcesses,
  percentile,
  stepsBetween,
  summarize,
  treeMemory,
} from './perf-verdicts.mjs';

describe('statistics', () => {
  it('percentile is nearest-rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1 .. 100
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile(values, 100)).toBe(100);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([], 95)).toBeNaN();
  });

  it('summarize and intervalsOf', () => {
    const gaps = intervalsOf([0, 16, 33, 50, 100]);
    expect(gaps).toEqual([16, 17, 17, 50]);
    expect(summarize(gaps)).toEqual({ count: 4, min: 16, median: 17, p95: 50, max: 50, mean: 25 });
  });

  it('stepsBetween follows a counter that wraps at 2^32', () => {
    expect(stepsBetween([4_294_967_000, 200, 1200])).toBe(296 + 200 + 1000);
    expect(stepsBetween([5])).toBe(0);
  });
});

describe('verdicts', () => {
  it('judges the thresholds of 6.9 item 9 only for Chromium on Linux unless told otherwise', () => {
    expect(judgeHere({ platform: 'linux', browser: 'chromium' })).toBe(true);
    expect(judgeHere({ platform: 'linux', browser: 'webkit' })).toBe(false);
    expect(judgeHere({ platform: 'darwin', browser: 'chromium' })).toBe(false);
    expect(judgeHere({ platform: 'win32', browser: 'chromium', override: 'strict' })).toBe(true);
    expect(judgeHere({ platform: 'linux', browser: 'chromium', override: 'report' })).toBe(false);
  });

  it('the best run counts, and the spread is printed', () => {
    const frames = [
      { ...summarize([30, 30, 30]), passes: 10 },
      { ...summarize([16, 17, 19]), passes: 12 },
    ];
    const at60 = judgeFrames(frames, 60);
    expect(at60.ok).toBe(true);
    expect(at60.best).toBe(19);
    expect(at60.detail).toContain('runs 30.00, 19.00');
    expect(judgeFrames(frames, 120).ok).toBe(false);

    expect(judgeTaskDuration([{ seconds: 5 }, { seconds: 4.4 }]).ok).toBe(true);
    expect(judgeTaskDuration([{ seconds: 4.5 }]).ok).toBe(false); // "less than"
    expect(judgeAssembly([{ ms: 1200 }, { ms: 999 }]).ok).toBe(true);
    expect(judgeAssembly([]).ok).toBe(false);
  });

  it('the thresholds are those of 6.9 item 9', () => {
    expect(LIMITS).toEqual({
      taskDurationSeconds: 4.5,
      taskDurationWindowSeconds: 30,
      frameP95Ms: { 60: 20, 120: 12 },
      maximumSteps: 100_000_000,
      maximumWindowSeconds: 10,
      maximumShareOfEngine: 0.85,
      maximumEngineSeconds: 5,
      assemblyMs: 1000,
    });
  });
});

describe('the Maximum verdict (6.9 item 9 as corrected on 22 November 2026, erratum P1 13)', () => {
  // The figures of the performance job of run 44988194975 (ubuntu-latest, Chromium): the engine
  // alone 32,051,282 per second, so 160,256,410 in 5 s; at Maximum 150,448,654 (60 Hz) and
  // 158,915,569 (120 Hz) in 10 s.
  const engine = 32_051_282;

  it('passes the figures measured on ubuntu-latest: both conditions hold', () => {
    const at60 = judgeMaximum([{ steps: 142_383_829 }, { steps: 148_236_049 }, { steps: 150_448_654 }], engine);
    expect(at60).toMatchObject({ ok: true, floorOk: true, shareOk: true, best: 150_448_654 });
    expect(at60.share).toBeCloseTo(0.9388, 3);
    expect(at60.detail).toBe(
      'best 150,448,654 instructions in 10 s (needs >= 100,000,000), runs 142,383,829, 148,236,049, 150,448,654; ' +
        "93.9 % of the engine alone's 160,256,410 in 5 s (32,051,282 per second; needs >= 85 % = 136,217,949)",
    );
    expect(judgeMaximum([{ steps: 158_915_569 }], engine).ok).toBe(true);
  });

  it('the share: at least 85 % of the engine alone in 5 s, the best run counts', () => {
    const needed = engine * 5 * 0.85; // 136,217,948.5
    expect(judgeMaximum([{ steps: Math.ceil(needed) }], engine).ok).toBe(true); // "at least"
    const short = judgeMaximum([{ steps: Math.floor(needed) }, { steps: 120e6 }], engine);
    expect(short).toMatchObject({ ok: false, floorOk: true, shareOk: false });
  });

  it('the floor: at least 100 million, however slow the engine alone', () => {
    // A runner whose engine alone does 20 million per second: 85 % of 100 million is reached, the floor is not.
    const slow = judgeMaximum([{ steps: 99_999_999 }], 20_000_000);
    expect(slow).toMatchObject({ ok: false, floorOk: false, shareOk: true });
    expect(judgeMaximum([{ steps: 100_000_000 }], 20_000_000).ok).toBe(true);
  });

  it('fails without a figure of the engine alone, and without a run', () => {
    for (const rate of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const verdict = judgeMaximum([{ steps: 300e6 }], rate);
      expect(verdict).toMatchObject({ ok: false, floorOk: true, shareOk: false });
      expect(verdict.detail).toContain('no figure of the engine alone');
    }
    expect(judgeMaximum([], engine).ok).toBe(false);
  });
});

describe('calibrate.X68', () => {
  it('knows the block size of the program', () => {
    expect(CALIBRATE).toEqual({ BLOCK: 25_000, PERBLK: 50_009, MINTIME: 1000 });
  });

  it('reads the report and checks its arithmetic', () => {
    const text =
      'instructions executed: 10001800\r\nhundredths of a second: 1000\r\ninstructions per second: 1000180\r\nEND-OF-DUMP\r\n';
    const report = parseCalibrateReport(text);
    expect(report).toEqual({ instructions: 10_001_800, hundredths: 1000, ips: 1_000_180 });
    expect(judgeCalibrate(report!).ok).toBe(true);
    expect(judgeCalibrate(report!, { expected: 1_000_000, tolerance: 0.001 }).ok).toBe(true);
    expect(judgeCalibrate(report!, { expected: 2_000_000 }).ok).toBe(false);
    // A wrong quotient, a count that is not whole blocks, too short a run.
    expect(judgeCalibrate({ ...report!, ips: 1_000_181 }).ok).toBe(false);
    expect(judgeCalibrate({ instructions: 10_001_801, hundredths: 1000, ips: 1_000_180 }).ok).toBe(false);
    expect(judgeCalibrate({ instructions: 50_009, hundredths: 5, ips: 1_000_180 }).ok).toBe(false);
    expect(parseCalibrateReport('instructions executed: 1')).toBeNull();
  });
});

describe('memory of a process tree', () => {
  it('adds up a process and everything below it, once', () => {
    const rows = [
      { pid: 1, ppid: 0, bytes: 1000 },
      { pid: 10, ppid: 1, bytes: 100 },
      { pid: 11, ppid: 10, bytes: 10 },
      { pid: 12, ppid: 10, bytes: 20 },
      { pid: 20, ppid: 1, bytes: 5 },
      { pid: 30, ppid: 99, bytes: 7 },
    ];
    expect(treeMemory(rows, 10)).toEqual({ bytes: 130, processes: 3 });
    expect(treeMemory(rows, 1)).toEqual({ bytes: 1135, processes: 5 });
    expect(treeMemory(rows, 404)).toEqual({ bytes: 0, processes: 0 });
  });

  it('reads ps and Get-CimInstance output', () => {
    expect(parsePs('  1     0  2048\n 22     1   100\nbad line\n')).toEqual([
      { pid: 1, ppid: 0, bytes: 2048 * 1024 },
      { pid: 22, ppid: 1, bytes: 100 * 1024 },
    ]);
    const one = '{"ProcessId": 4, "ParentProcessId": 0, "WorkingSetSize": 4096}';
    expect(parseWindowsProcesses(one)).toEqual([{ pid: 4, ppid: 0, bytes: 4096 }]);
    const many =
      '[{"ProcessId": 4, "ParentProcessId": 0, "WorkingSetSize": 4096},{"ProcessId": 8, "ParentProcessId": 4, "WorkingSetSize": 1}]';
    expect(parseWindowsProcesses(many)).toHaveLength(2);
  });
});
