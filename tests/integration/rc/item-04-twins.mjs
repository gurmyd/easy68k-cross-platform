#!/usr/bin/env node
// Release candidate, item 4 of ARCHITECTURE.md 6.9 ("Twins: zero differences (6.2.1)"). Owner: I3.
//
//   node tests/integration/rc/item-04-twins.mjs [--report <file>] [--run]
//
// Reads the report of the native twins (T4's `npm run oracle:twins`, tests/oracle/native-twin/run.mjs)
// and prints what item 4 counts: how many assembler runs and programs, simulator scripts and twin
// runs were compared, and how many differed. Exit code 0 only when the report says "No unexpected
// differences", every Failed cell of the assembler table is 0, every simulator twin run was
// identical, and the assembler twins saw every tracked program (tests/oracle/native-twin/corpus.mjs
// lists them: every .X68 under tests/).
//
//   --report <file>  the report to read: build/native-twin/report.md (the default, written by a run
//                    on this machine), the `native-twin-report` artifact of the CI job
//                    `windows-oracles`, or that job's whole log (the report is printed into it)
//   --run            run `node tests/oracle/native-twin/run.mjs --skip-build` first (Windows with
//                    MSVC only, 10-25 minutes; it writes build/native-twin/, T4's folder)
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpusFiles } from '../../oracle/native-twin/corpus.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const at = argv.indexOf('--report');
const reportPath = at >= 0 ? resolve(argv[at + 1]) : join(repo, 'build', 'native-twin', 'report.md');

if (argv.includes('--run')) {
  const r = spawnSync(process.execPath, [join(repo, 'tests', 'oracle', 'native-twin', 'run.mjs'), '--skip-build'], {
    cwd: repo,
    stdio: 'inherit',
  });
  console.log(`run.mjs exit ${r.status}`);
}

if (!existsSync(reportPath)) {
  console.log(`item 4: no report at ${reportPath}; run npm run oracle:twins (Windows) or pass --report`);
  process.exit(1);
}
// A CI log has a time stamp before each line; strip it and colour codes.
const text = readFileSync(reportPath, 'utf8')
  .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
  .split(/\r?\n/)
  .map((l) => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /, ''))
  .join('\n');

const problems = [];
const asmRows = [...text.matchAll(/^\| asm-([\w-]+) \| (\d+) \| (\d+) \| (\d+) \|$/gm)].map((m) => ({
  twin: m[1],
  same: Number(m[2]),
  patch: Number(m[3]),
  failed: Number(m[4]),
}));
const asmHead = text.match(/(\d+) runs of the engine's test programs and (\d+) corpus programs x 2 option sets/);
const sim = text.match(/(\d+) scripts; transcripts identical: (\d+) of (\d+) twin runs/);
const kinds = [...text.matchAll(/^\| (script|fixture|corpus|singlestep) \| (\d+) \|$/gm)].map((m) => `${m[1]} ${m[2]}`);
const cpu = text.match(/(\d+) files, (\d+) tests, (\d+) deviate from the real 68000; ([^\n]+)/);
const expected = text.match(/## Expected differences\s+(\d+) \(not failures\)/);
const clean = /\*\*No unexpected differences\.\*\*/.test(text);
const ownTest = text.match(/engine\/asm\/test\/native\.test\.mjs`?: exit (\d+)/);
const ranAt = text.match(/Run of `tests\/oracle\/native-twin\/run\.mjs` on (\S+)\./);

console.log(`item 4: native twins, report ${reportPath}${ranAt ? ` (run ${ranAt[1]})` : ''}`);
if (!asmHead || asmRows.length === 0) problems.push('no assembler table in the report');
else {
  console.log(
    `  assembler: ${asmHead[1]} engine test runs + ${asmHead[2]} corpus programs x 2 option sets = ${Number(asmHead[1]) + 2 * Number(asmHead[2])} runs per twin`,
  );
  for (const r of asmRows) {
    console.log(
      `    asm-${r.twin}: ${r.same} same, ${r.patch} differ where a patch applies (expected), ${r.failed} failed`,
    );
    if (r.failed !== 0) problems.push(`asm-${r.twin}: ${r.failed} failed`);
  }
  for (const v of ['patched-O2', 'patched-Od', 'unpatched-O2', 'unpatched-Od'])
    if (!asmRows.some((r) => r.twin === v)) problems.push(`asm-${v} missing from the report`);
  for (const r of asmRows.filter((x) => x.twin.startsWith('patched')))
    if (r.patch !== 0) problems.push(`asm-${r.twin}: ${r.patch} differences on a patched twin`);
  const tracked = corpusFiles().length;
  const programs = Number(asmHead[2]);
  console.log(`  tracked programs today (every .X68 under tests/): ${tracked}; in the report: ${programs}`);
  if (programs < tracked)
    problems.push(`the report compared ${programs} programs, ${tracked - programs} fewer than are tracked today`);
}
if (!sim) problems.push('no simulator line in the report');
else {
  console.log(
    `  simulator: ${sim[1]} scripts, ${sim[2]} of ${sim[3]} twin runs identical (/O2 and /Od); ${kinds.join(', ')}`,
  );
  if (sim[2] !== sim[3]) problems.push(`simulator: ${Number(sim[3]) - Number(sim[2])} twin runs differ`);
}
if (cpu) console.log(`  68000 single-step baseline: ${cpu[1]} files, ${cpu[2]} tests, ${cpu[3]} deviate; ${cpu[4]}`);
else console.log('  68000 single-step baseline: not in the report');
if (ownTest) console.log(`  engine/asm/test/native.test.mjs: exit ${ownTest[1]}`);
if (expected) console.log(`  expected differences listed (unpatched twins where a patch applies): ${expected[1]}`);
console.log(`  result line: ${clean ? 'No unexpected differences.' : 'NOT clean'}`);
if (!clean) problems.push('the report does not say "No unexpected differences"');

if (problems.length) {
  console.log(`item 4 does NOT hold on this report:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('item 4 holds on this report: zero differences.');
