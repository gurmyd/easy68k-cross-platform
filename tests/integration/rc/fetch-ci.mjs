#!/usr/bin/env node
// Release candidate (ARCHITECTURE.md 6.9, package I3): downloads, read-only, the CI job logs and
// job lists that `npm run check:rc -- --logs <folder>` judges (items 4, 5, 6, 8, 9 and 10), for
// the runs named in lib/runs.mjs. Owner: I3.
//
//   node tests/integration/rc/fetch-ci.mjs <folder> [--gh <path to gh>]
//   npm run check:rc -- --logs <folder>
//
// It needs the GitHub CLI, logged in (or GH_TOKEN set); --gh or the environment variable GH names
// it when it is not on the PATH. It only reads (gh api GET): it starts, cancels or re-runs nothing.
// A job that has not finished is listed as such and its log is not written, so that check:rc says
// "not shown yet" for what it carries. Writes only into <folder> (use one below build/, which git
// ignores).
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPOSITORY, RUNS, allJobIds } from './lib/runs.mjs';

const args = process.argv.slice(2);
const folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--gh');
const gh = args.includes('--gh') ? args[args.indexOf('--gh') + 1] : (process.env.GH ?? 'gh');
if (!folder) {
  console.error('usage: node tests/integration/rc/fetch-ci.mjs <folder> [--gh <path to gh>]');
  process.exit(2);
}
mkdirSync(resolve(folder), { recursive: true });

function api(path, { escapes = false } = {}) {
  const r = spawnSync(gh, ['api', ...(escapes ? ['--allow-escape-sequences'] : []), path], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) throw new Error(`${gh} api ${path}: ${r.error?.message ?? r.stderr.trim()}`);
  return r.stdout;
}

let problems = 0;
const state = new Map();
for (const [key, { workflow, id }] of Object.entries(RUNS)) {
  try {
    const text = api(`repos/${REPOSITORY}/actions/runs/${id}/jobs?per_page=100`);
    writeFileSync(join(folder, `run-${id}.json`), text);
    const { jobs } = JSON.parse(text);
    for (const j of jobs) state.set(j.id, `${j.status}${j.conclusion ? ` ${j.conclusion}` : ''}`);
    const open = jobs.filter((j) => j.status !== 'completed').length;
    console.log(`${workflow} run ${id} (${key}): ${jobs.length} jobs, ${open} not finished -> run-${id}.json`);
  } catch (error) {
    problems += 1;
    console.log(`${workflow} run ${id} (${key}): ${error.message}`);
  }
}
for (const id of allJobIds()) {
  const s = state.get(id) ?? 'not in the runs above';
  if (!s.startsWith('completed')) {
    console.log(`job ${id}: ${s}; log not written`);
    continue;
  }
  try {
    writeFileSync(join(folder, `${id}.log`), api(`repos/${REPOSITORY}/actions/jobs/${id}/logs`, { escapes: true }));
    console.log(`job ${id}: ${s} -> ${id}.log`);
  } catch (error) {
    problems += 1;
    console.log(`job ${id}: ${error.message}`);
  }
}
process.exit(problems ? 1 : 0);
