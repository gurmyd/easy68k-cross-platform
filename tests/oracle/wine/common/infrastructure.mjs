// Runs that failed because of the machine, not because of the official program, and their repetition
// (errata T1 28).
//
// Oracle run 45050289253: one of four containers had no X display, and all 134 runs of it failed
// within a second with Wine's "no driver could be loaded"; two runs of the simulator's oracle saw a
// "Wine Debugger" window before the editor's own window. The drivers now wait for the display before
// every run (xwin.ensure_display). What can still happen is repeated here: a run whose failure carries
// one of INFRASTRUCTURE_SIGNATURES and that left no output file is run again in a fresh container, at
// most MAX_REPETITIONS times. Every repetition is printed and counted. A run that failed for any other
// reason, that left an output, or that still fails after the repetitions, keeps its failure, and the
// result that counts is compared with the manifest exactly as any other.
//
// Owner: T1.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

/** How often one run is repeated at most (so it runs at most three times). */
export const MAX_REPETITIONS = 2;

/**
 * The texts that mark a failure of the machine. Each is matched against the error of the run and
 * against the lines of Wine's log the driver recorded with it (`wine_err`).
 */
export const INFRASTRUCTURE_SIGNATURES = [
  // Wine without an X server (exactly the lines of run 45050289253; reproduced with no Xvfb).
  { pattern: /no driver could be loaded/, why: 'Wine found no X display' },
  { pattern: /The explorer process failed to start/, why: 'Wine found no X display' },
  { pattern: /Make sure that your X server is running/, why: 'Wine found no X display' },
  // The display went away under a running program (Xlib's message; reproduced by stopping Xvfb).
  { pattern: /X connection to \S+ broken/, why: 'the X display went away during the run' },
  // The driver's own check (xwin.ensure_display) found no display after three starts of Xvfb.
  { pattern: /^no X display: /, why: 'Xvfb did not answer' },
  // Wine's crash dialog before the program had a window of its own.
  {
    pattern: /^unexpected window "Wine Debugger" before the editor window appeared$/,
    why: 'Wine crashed before the editor window appeared',
  },
];

/**
 * Why a failed run is a failure of the machine, or null when it is not one (or did not fail).
 * `run`: { failed: boolean, texts: string[] (the error and Wine's lines), outputs: number (output
 * files the run left) }. A run that left any output file is never one: its result is judged.
 */
export function infrastructureReason({ failed, texts, outputs }) {
  if (!failed || outputs > 0) return null;
  for (const { pattern, why } of INFRASTRUCTURE_SIGNATURES) {
    if (texts.some((text) => typeof text === 'string' && pattern.test(text))) return why;
  }
  return null;
}

/**
 * Runs `jobs` with `run(jobs, workDirectory)` (which resolves with a Map from job id to record) and
 * runs again, in fresh containers below `<workDirectory>/repeat-<n>`, every job whose record
 * `classify(record)` calls a failure of the machine, up to MAX_REPETITIONS times. A job whose
 * repetition wrote no record keeps the record it had. Resolves with { records, repeated }, where
 * `repeated` lists one { id, attempt, why } per repetition (attempt 2 or 3).
 */
export async function runWithRepetitions(jobs, workDirectory, run, classify, log = console.log) {
  const records = await run(jobs, workDirectory);
  const repeated = [];
  for (let attempt = 2; attempt <= MAX_REPETITIONS + 1; attempt++) {
    const again = jobs.map((job) => ({ job, why: classify(records.get(job.id)) })).filter(({ why }) => why !== null);
    if (again.length === 0) break;
    log(
      `run ${attempt} of at most ${MAX_REPETITIONS + 1} for ${again.length} run(s) that failed because of the machine, in fresh containers:`,
    );
    for (const { job, why } of again) {
      log(`  ${job.id}: ${why}`);
      repeated.push({ id: job.id, attempt, why });
    }
    const next = await run(
      again.map(({ job }) => job),
      join(workDirectory, `repeat-${attempt - 1}`),
    );
    for (const { job } of again) if (next.has(job.id)) records.set(job.id, next.get(job.id));
  }
  return { records, repeated };
}

/**
 * The lines that say what was repeated: for the log and for the job's summary on GitHub. `stillFailing`
 * names the repeated runs whose last attempt failed too.
 */
export function repetitionSummary(what, repeated, stillFailing) {
  if (repeated.length === 0) return [`${what}: no run was repeated.`];
  const runs = [...new Set(repeated.map((entry) => entry.id))];
  const lines = [
    `${what}: ${runs.length} run${runs.length === 1 ? ' was' : 's were'} repeated because the machine failed them (no display, or Wine crashed before the program's window): ${runs.join(', ')}`,
  ];
  if (stillFailing.length > 0) {
    lines.push(`${what}: still failing after ${MAX_REPETITIONS + 1} attempts: ${stillFailing.join(', ')}`);
  }
  return lines;
}

/** Prints the lines and, on GitHub, appends them to the job's summary. */
export function reportRepetitions(lines, env = process.env) {
  for (const line of lines) console.log(line);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.map((l) => `- ${l}`).join('\n')}\n`);
}
