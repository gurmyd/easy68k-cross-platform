#!/usr/bin/env node
// easy68k-mac: corpus-smoke.mjs - run every example program of a directory
// tree through run-s68.mjs and report what happened.
//
//   node corpus-smoke.mjs [--assembler PATH] [--work DIR] [--max-ms N] [--json FILE] [--exceptions] [--bitfield] [--only-x68] DIR...
//
// For each .X68 file below the given directories: assemble it (with the
// command-line EASy68K assembler, default build/oracle/asm-cli-5.15.4/bin/
// asy68k.exe in this repository; a copy of the tree is made in the work
// directory first, because the assembler writes next to its source), then run
// the .S68 in a child process with a time limit and classify the outcome:
//
//   halted    reached SIMHALT / TRAP #15 task 9 without a message
//   input     waits for keyboard input (no input script is given)
//   running   still running when the instruction budget or time limit ended
//             (typical for games and animations)
//   stopped   stopped with a simulator message (exception, error)
//   asmerror  the assembler reported errors (typically a file that is only
//             meant to be INCLUDEd by another one); not run, because the
//             assembler's output for such a file differs from run to run
//   noload    no .S68 was produced, or the loader reported an error
//   CRASH     the engine itself failed: a WebAssembly trap, an abort, bad
//             output, or no answer within the hard time limit.  Every crash
//             is a bug in the port.
//
// The example programs are not part of this repository (see
// docs/porting/ground-truth.md); nothing from them is written anywhere but
// the work directory.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// "node --test" runs every file of the test directory; this is not a test.
if (process.env.NODE_TEST_CONTEXT) process.exit(0);

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const runner = join(here, 'run-s68.mjs');

const opt = { assembler: join(repo, 'build', 'oracle', 'asm-cli-5.15.4', 'bin', 'asy68k.exe'), work: join(repo, 'build', 'sim-smoke'), maxMs: 5000, dirs: [], runArgs: [] };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--assembler') opt.assembler = argv[++i];
  else if (argv[i] === '--work') opt.work = argv[++i];
  else if (argv[i] === '--max-ms') opt.maxMs = Number(argv[++i]);
  else if (argv[i] === '--json') opt.json = argv[++i];
  else if (argv[i] === '--only-x68') opt.onlyX68 = true; // copy nothing but the .X68 files to the work directory
  else if (argv[i] === '--exceptions' || argv[i] === '--bitfield') opt.runArgs.push(argv[i]); // passed on to run-s68.mjs
  else opt.dirs.push(argv[i]);
}
if (opt.dirs.length === 0) {
  console.error('usage: node corpus-smoke.mjs [--assembler PATH] [--work DIR] [--max-ms N] [--json FILE] [--exceptions] [--bitfield] [--only-x68] DIR...');
  process.exit(1);
}
if (!existsSync(opt.assembler)) {
  console.error(`assembler not found: ${opt.assembler}`);
  process.exit(1);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const results = [];
rmSync(opt.work, { recursive: true, force: true });
opt.dirs.forEach((dir, index) => {
  const copy = join(opt.work, `${index}-${basename(resolve(dir))}`);
  mkdirSync(copy, { recursive: true });
  cpSync(dir, copy, { recursive: true, filter: (path) => !opt.onlyX68 || statSync(path).isDirectory() || /\.x68$/i.test(path) });
  for (const source of walk(copy)) {
    if (!/\.x68$/i.test(source)) continue;
    const name = relative(copy, source);
    const entry = { corpus: basename(resolve(dir)), name, outcome: '', detail: '' };
    results.push(entry);
    // The assembler replaces the last four characters of the name.
    const s68 = source.slice(0, -4) + '.S68';
    const l68 = source.slice(0, -4) + '.L68';
    spawnSync(opt.assembler, [basename(source)], { cwd: dirname(source), timeout: 60000 });
    if (!existsSync(s68)) {
      entry.outcome = 'noload';
      entry.detail = 'the assembler produced no .S68';
      continue;
    }
    const listing = existsSync(l68) ? readFileSync(l68, 'latin1') : '';
    if (!/^No errors detected/m.test(listing)) {
      entry.outcome = 'asmerror';
      entry.detail = (/^\d+ errors? detected/m.exec(listing) ?? ['no summary line'])[0];
      continue;
    }
    const run = spawnSync(process.execPath, [runner, s68, ...(existsSync(l68) ? [l68] : []), '--json', '--max-ms', String(opt.maxMs), ...opt.runArgs],
      { encoding: 'latin1', timeout: opt.maxMs * 4 + 20000, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, NODE_TEST_CONTEXT: '' } });
    let report = null;
    try { report = JSON.parse(run.stdout); } catch { /* handled below */ }
    if (run.error || run.signal || !report) {
      entry.outcome = 'CRASH';
      entry.detail = (run.error ? String(run.error.message) : run.signal ? `killed by ${run.signal}` : '') + ' ' + (run.stderr || '').trim().split('\n').slice(0, 6).join(' | ');
      continue;
    }
    const loaderErrors = report.messages.filter((m) => /^(error: cannot open|Invalid|Remainder of load|Unexpected|Checksum error)/.test(m));
    const runMessages = report.messages.filter((m) => !/^S0 = |\.S68 file read successful|Unable to open \.L68/.test(m) && !loaderErrors.includes(m));
    entry.steps = report.steps;
    entry.cycles = report.registers.cycles;
    if (loaderErrors.length) {
      entry.outcome = 'noload';
      entry.detail = loaderErrors[0];
    } else if (report.reason === 'input') entry.outcome = 'input';
    else if (report.reason === 'budget' || report.reason === 'time') entry.outcome = 'running';
    else if (report.reason === 'error') {
      entry.outcome = 'CRASH';
      entry.detail = 'Status.ERROR: ' + runMessages.join(' | ');
    } else if (report.halt && runMessages.length === 0) entry.outcome = 'halted';
    else {
      entry.outcome = 'stopped';
      entry.detail = runMessages.slice(-2).join(' | ');
    }
  }
});

const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
for (const r of results) console.log(`${r.outcome.padEnd(8)} ${r.corpus}/${r.name}${r.detail ? '   [' + r.detail + ']' : ''}`);
console.log('');
const ran = results.length - count('noload') - count('asmerror');
console.log(`${results.length} programs: ${count('asmerror')} do not assemble on their own, ${ran} loaded, ${count('halted')} reached SIMHALT, `
  + `${count('input')} wait for input, ${count('running')} still running at the limit, ${count('stopped')} stopped with a message, `
  + `${count('noload')} did not load, ${count('CRASH')} engine crashes`);
if (opt.json) writeFileSync(opt.json, JSON.stringify(results, null, 1));
process.exit(count('CRASH') ? 2 : 0);
