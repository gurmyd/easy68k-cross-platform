// Tests of infrastructure.mjs: which failures count as failures of the machine, and the repetition of
// those runs (errata T1 28). They need neither Docker nor the official programs.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { asmInfrastructureReason } from '../asm/regenerate.mjs';
import { simInfrastructureReason } from '../sim/regenerate.mjs';
import {
  MAX_REPETITIONS,
  infrastructureReason,
  repetitionSummary,
  reportRepetitions,
  runWithRepetitions,
} from './infrastructure.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'easy68k-infrastructure-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// The errors of oracle run 45050289253 (job 137293912602), as asm_batch.py wrote them.
const NO_DISPLAY_FIRST =
  'EDIT68K exited unexpectedly (crash?) exit code 0; wine:  no driver could be loaded. | 0050:err:winediag:nodrv_CreateWindow L"The explorer process failed to start." | 0050:err:systray:initialize_systray Could not create tray window | 0024:err:winediag:nodrv_CreateWindow Application tried to create a window, but no driver could be loaded. | 0024:err:winediag:nodrv_CreateWindow L"Make sure that your X server is running and that $DISPLAY is set correctly."';
const NO_DISPLAY_LATER =
  'EDIT68K exited unexpectedly (crash?) exit code 0; wine: 0108:err:winediag:nodrv_CreateWindow Application tried to create a window, but no driver could be loaded. | 0108:err:winediag:nodrv_CreateWindow L"Make sure that your X server is running and that $DISPLAY is set correctly."';
const DEBUGGER_AT_START = 'unexpected window "Wine Debugger" before the editor window appeared';

const asmFailure = (error, outputs = []) => ({ id: 'x#default', status: 'fail', error, outputs });

describe('what counts as a failure of the machine', () => {
  it('the messages of Wine without an X display, of the driver without one, and a crash dialog at start', () => {
    expect(asmInfrastructureReason(asmFailure(NO_DISPLAY_FIRST))).toBe('Wine found no X display');
    expect(asmInfrastructureReason(asmFailure(NO_DISPLAY_LATER))).toBe('Wine found no X display');
    expect(
      asmInfrastructureReason(asmFailure('no X display: Xvfb on :99 did not answer after 3 starts (no log)')),
    ).toBe('Xvfb did not answer');
    expect(asmInfrastructureReason(asmFailure(DEBUGGER_AT_START))).toBe(
      'Wine crashed before the editor window appeared',
    );
    // The display stopped under the running editor (Xlib's line, recorded in wine_err).
    expect(
      asmInfrastructureReason({
        ...asmFailure('EDIT68K exited unexpectedly (crash?) exit code 1; wine: (no err lines)'),
        wine_err: 'X connection to :99 broken (explicit kill or server shutdown).',
      }),
    ).toBe('the X display went away during the run');
    // Wine's lines recorded beside another error count too.
    expect(
      asmInfrastructureReason({
        ...asmFailure('editor main window did not appear within 300s'),
        wine_err:
          '0024:err:winediag:nodrv_CreateWindow Application tried to create a window, but no driver could be loaded.',
      }),
    ).toBe('Wine found no X display');
  });

  it('not: a crash, a window or a time-out of the official program, a clean run, or no record', () => {
    for (const error of [
      'EDIT68K exited unexpectedly (crash?) exit code 1; wine: err:virtual:virtual_setup_exception stack overflow 836 bytes addr 0x2c312c31',
      'unexpected window "Information" before the editor window appeared',
      'unexpected window "EASy68K" above the Assembler Status dialog',
      'unexpected window "Wine Debugger" while the editor assembled',
      'unexpected window "Wine Debugger" above the Assembler Status dialog',
      'editor main window did not appear within 300s',
      'Assembler Status dialog did not appear within 300s (F9 pressed 4 times)',
      'no .L68/.S68 produced',
    ]) {
      expect(asmInfrastructureReason(asmFailure(error)), error).toBeNull();
    }
    expect(asmInfrastructureReason({ status: 'ok', error: null, outputs: ['P.L68'] })).toBeNull();
    expect(asmInfrastructureReason(undefined)).toBeNull();
    expect(infrastructureReason({ failed: false, texts: [NO_DISPLAY_FIRST], outputs: 0 })).toBeNull();
  });

  it('not: a run that left an output file, whatever its error says (its result is judged)', () => {
    const assembled = { status_title: 'Assembler Status - P.X68' };
    expect(asmInfrastructureReason({ ...asmFailure(NO_DISPLAY_LATER, ['P.L68']), ...assembled })).toBeNull();
    expect(asmInfrastructureReason({ ...asmFailure(DEBUGGER_AT_START, ['P.L68', 'P.S68']), ...assembled })).toBeNull();
  });

  it('but files of an editor that never finished assembling are no outputs (ingestRun keeps none)', () => {
    // Injected here: Xvfb stopped 2 s into a run; the editor had begun MACRO.L68 and died.
    const halfWritten = {
      ...asmFailure(
        'EDIT68K exited unexpectedly (crash?) exit code 1; wine: X connection to :99 broken (explicit kill or server shutdown).',
        ['MACRO.L68', 'MACRO.S68'],
      ),
    };
    expect(asmInfrastructureReason(halfWritten)).toBe('the X display went away during the run');
  });

  it('the simulator: through the error of its assembly, and never once the run left files', () => {
    const lost = {
      id: 'hardware/h01-device-bytes-at-start:report',
      status: 'failed',
      error: `the official assembler produced no S-record file: ${DEBUGGER_AT_START}`,
      asm: { status: 'fail', error: DEBUGGER_AT_START },
      files: [],
    };
    expect(simInfrastructureReason(lost)).toBe('Wine crashed before the editor window appeared');
    expect(simInfrastructureReason({ ...lost, files: ['prog.S68', 'result.bin'] })).toBeNull();
    expect(
      simInfrastructureReason({ status: 'failed', error: 'no X display: Xvfb on :99 did not answer', files: [] }),
    ).toBe('Xvfb did not answer');
    expect(
      simInfrastructureReason({ status: 'failed', error: 'END-OF-DUMP not seen within 60 s', files: [] }),
    ).toBeNull();
    expect(simInfrastructureReason({ ...lost, status: 'ok' })).toBeNull();
    // SIM68K.exe without a window (seen here once, an empty screen): a failure of the machine only
    // when Wine's lines of that run say so (sim_batch.py records them in wine_err).
    const noWindow = {
      status: 'failed',
      error: 'simulator window did not appear',
      asm: { status: 'ok', error: null },
      files: ['a48-task0-zero-count-nul.L68', 'a48-task0-zero-count-nul.S68', 'fail-screen.png'],
    };
    expect(simInfrastructureReason(noWindow)).toBeNull();
    expect(
      simInfrastructureReason({
        ...noWindow,
        wine_err:
          '0044:err:winediag:nodrv_CreateWindow L"The explorer process failed to start." | 0024:err:winediag:nodrv_CreateWindow Application tried to create a window, but no driver could be loaded.',
      }),
    ).toBe('Wine found no X display');
  });
});

describe('runWithRepetitions', () => {
  const jobs = ['a', 'b', 'c'].map((id) => ({ id }));
  const silent = () => {};

  /** A runner that answers from a script: one Map of records per call; it records each call. */
  const scripted = (answers) => {
    const calls = [];
    const run = async (some, directory) => {
      calls.push({ ids: some.map((job) => job.id), directory });
      const answer = answers[calls.length - 1] ?? {};
      return new Map(some.filter((job) => answer[job.id]).map((job) => [job.id, { id: job.id, ...answer[job.id] }]));
    };
    return { run, calls };
  };
  const noDisplay = { status: 'fail', error: NO_DISPLAY_LATER, outputs: [] };
  const realCrash = {
    status: 'fail',
    error: 'EDIT68K exited unexpectedly (crash?) exit code 1; wine: err:x',
    outputs: [],
  };
  const ok = { status: 'ok', error: null, outputs: ['P.L68', 'P.S68'] };

  it('repeats only the runs the machine failed, in a folder of their own, and keeps the new record', async () => {
    const { run, calls } = scripted([{ a: noDisplay, b: realCrash, c: ok }, { a: ok }]);
    const { records, repeated } = await runWithRepetitions(jobs, scratch, run, asmInfrastructureReason, silent);
    expect(calls.map((call) => call.ids)).toEqual([['a', 'b', 'c'], ['a']]);
    expect(calls[1].directory).toBe(join(scratch, 'repeat-1'));
    expect(records.get('a').status).toBe('ok');
    expect(records.get('b')).toMatchObject(realCrash);
    expect(repeated).toEqual([{ id: 'a', attempt: 2, why: 'Wine found no X display' }]);
  });

  it(`runs a job at most ${MAX_REPETITIONS + 1} times, and the failure stays when it persists`, async () => {
    const { run, calls } = scripted([{ a: noDisplay, b: ok, c: ok }, { a: noDisplay }, { a: noDisplay }, { a: ok }]);
    const { records, repeated } = await runWithRepetitions(jobs, scratch, run, asmInfrastructureReason, silent);
    expect(calls).toHaveLength(MAX_REPETITIONS + 1);
    expect(records.get('a')).toMatchObject(noDisplay);
    expect(repeated.map((entry) => entry.attempt)).toEqual([2, 3]);
  });

  it('judges a repetition like any run: one that now fails for another reason is not repeated again', async () => {
    const { run, calls } = scripted([{ a: noDisplay, b: ok, c: ok }, { a: realCrash }]);
    const { records } = await runWithRepetitions(jobs, scratch, run, asmInfrastructureReason, silent);
    expect(calls).toHaveLength(2);
    expect(records.get('a')).toMatchObject(realCrash);
  });

  it('keeps the earlier record when a repetition wrote none', async () => {
    const { run } = scripted([{ a: noDisplay, b: ok, c: ok }, {}, {}]);
    const { records } = await runWithRepetitions(jobs, scratch, run, asmInfrastructureReason, silent);
    expect(records.get('a')).toMatchObject(noDisplay);
  });

  it('repeats nothing when nothing failed because of the machine', async () => {
    const { run, calls } = scripted([{ a: ok, b: realCrash, c: ok }]);
    const { repeated } = await runWithRepetitions(jobs, scratch, run, asmInfrastructureReason, silent);
    expect(calls).toHaveLength(1);
    expect(repeated).toEqual([]);
  });
});

describe('the report of the repetitions', () => {
  it('counts the repeated runs and names those that still fail', () => {
    expect(repetitionSummary('Assembler oracle', [], [])).toEqual(['Assembler oracle: no run was repeated.']);
    const repeated = [
      { id: 'a', attempt: 2, why: 'w' },
      { id: 'a', attempt: 3, why: 'w' },
      { id: 'b', attempt: 2, why: 'w' },
    ];
    const lines = repetitionSummary('Assembler oracle', repeated, ['a']);
    expect(lines[0]).toMatch(/^Assembler oracle: 2 runs were repeated because the machine failed them .*: a, b$/);
    expect(lines[1]).toBe('Assembler oracle: still failing after 3 attempts: a');
  });

  it("appends the lines to the job's summary on GitHub", () => {
    const summary = join(scratch, 'summary.md');
    reportRepetitions(['one', 'two'], { GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, 'utf8')).toBe('- one\n- two\n');
  });
});
