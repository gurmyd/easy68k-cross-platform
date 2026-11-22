// Release candidate (ARCHITECTURE.md 6.9, package I3), item 1 "Assembler": what the comparison of
// the port's assembler with the official EDIT68K.exe v5.16.1 (Wine goldens) covers, counted per
// set and per option, and whether every exception has its cause in docs/DIFFERENCES.md.
//
//   npm run test:conformance            (writes build/reports/asm-conformance-*.json; with the
//                                        site set fetched by node tools/fetch-site-examples.mjs)
//   node tests/integration/rc/item-01-asm-evidence.mjs [--json <file>]
//
// It reads tests/corpus/manifest.json (every program, every option run, the official result),
// tests/conformance/asm/known-differences.json, docs/DIFFERENCES.md and the two per-run reports the
// conformance tests write (corpus.test.ts and checklist/checklist.test.ts; their verdicts are
// "identical" = byte for byte with the Created On line, "identical-masked" = equal after masking
// the object code of statements with an undefined symbol, "differs" = listed in
// known-differences.json). It starts no browser and no Docker and takes a second.
//
// It prints, per set (official, github-mit, conformance, site): files, files with a default-option
// run that has an official result, and how those compare; then, for each of the eight assembler
// options switched alone from its default, the files compared; then whether a fixed subset of 30
// files exists; then the exceptions and whether docs/DIFFERENCES.md names them. Exit code 1 when
// item 1 does not hold (any of: a file without an official comparison, fewer than 240 single-option
// comparisons on a fixed 30-file subset, an exception docs/DIFFERENCES.md does not name). It is
// evidence for docs/integration/rc.md item 1 (I3); it changes nothing.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const manifest = JSON.parse(readFileSync(join(repo, 'tests', 'corpus', 'manifest.json'), 'utf8'));
const known = JSON.parse(readFileSync(join(repo, 'tests', 'conformance', 'asm', 'known-differences.json'), 'utf8'));
const differencesMd = readFileSync(join(repo, 'docs', 'DIFFERENCES.md'), 'utf8');
const fails = [];

// The verdicts of the last npm run test:conformance on this machine.
const verdict = new Map();
for (const name of ['corpus', 'checklist']) {
  const path = join(repo, 'build', 'reports', `asm-conformance-${name}.json`);
  if (!existsSync(path)) {
    console.error(`${path} is missing: run npm run test:conformance first.`);
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  console.log(`report ${name}: written ${statSync(path).mtime.toISOString()}, ${JSON.stringify(report.summary)}`);
  for (const run of report.runs) verdict.set(`${run.id}|${run.label}`, run.verdict);
}

/** The eight assembler options of the Assembler Options dialog (assembler 6, AsmOptions) with the label of the run that switches only that one. */
const OPTIONS = [
  ['generateListing', 'nolist'],
  ['generateSRecord', 'nosrec'],
  ['showWarnings', 'nowar'],
  ['crossReference', 'nocre'],
  ['macrosExpanded', 'mex'],
  ['structuredExpanded', 'sex'],
  ['constantsExpanded', 'cex'],
  ['bitFieldInstructions', 'nobit'],
];

// ---------------------------------------------------------------- default options, per set
const SETS = ['official', 'github-mit', 'conformance', 'site'];
const perSet = {};
const notCompared = [];
for (const set of SETS) {
  const programs = manifest.programs.filter((p) => p.set === set);
  const row = {
    files: programs.length,
    withDefaultRun: 0,
    officialResult: 0,
    identical: 0,
    identicalMasked: 0,
    differs: 0,
    notCompared: 0,
    otherVerdict: 0,
  };
  for (const p of programs) {
    const run = p.runs.default;
    if (!run) continue;
    row.withDefaultRun += 1;
    const v = verdict.get(`${p.id}|default`);
    if (run.status === 'ok' || run.outputsKept) row.officialResult += 1;
    if (v === 'identical') row.identical += 1;
    else if (v === 'identical-masked') row.identicalMasked += 1;
    else if (v === 'differs') row.differs += 1;
    else if (v === undefined) {
      row.notCompared += 1;
      notCompared.push(`${p.id} (default): ${run.status}${run.reason ? ` - ${run.reason.slice(0, 120)}` : ''}`);
    } else row.otherVerdict += 1;
  }
  perSet[set] = row;
}
console.log('\nDefault options (Created On line compared too where the official listing is in the repository):');
console.log('set          files  default-run  official  identical  masked  differs  not-compared');
for (const set of SETS) {
  const r = perSet[set];
  console.log(
    `${set.padEnd(12)} ${String(r.files).padStart(5)} ${String(r.withDefaultRun).padStart(12)} ${String(r.officialResult).padStart(9)} ${String(r.identical).padStart(10)} ${String(r.identicalMasked).padStart(7)} ${String(r.differs).padStart(8)} ${String(r.notCompared).padStart(13)}`,
  );
}
const withoutDefault = manifest.programs.filter((p) => !p.runs.default).map((p) => p.id);
console.log(
  `files without a default-option run: ${withoutDefault.length}${withoutDefault.length ? ` (${withoutDefault.join(', ')})` : ''}`,
);
console.log(`default-option runs without an official comparison: ${notCompared.length}`);
for (const n of notCompared) console.log(`   ${n}`);
if (notCompared.length > 0)
  fails.push(`${notCompared.length} default-option runs have no official result to compare with (golden/REPORT.md)`);
if (withoutDefault.length > 0)
  fails.push(
    `${withoutDefault.length} conformance files have no default-option run at all (checklist/programs.json gives them other option sets only)`,
  );

// The expansion run ("expand": macros, structures and constants expanded together).
const expand = { runs: 0, identical: 0, identicalMasked: 0, differs: 0, notCompared: [] };
for (const p of manifest.programs) {
  if (!p.runs.expand) continue;
  expand.runs += 1;
  const v = verdict.get(`${p.id}|expand`);
  if (v === 'identical') expand.identical += 1;
  else if (v === 'identical-masked') expand.identicalMasked += 1;
  else if (v === 'differs') expand.differs += 1;
  else expand.notCompared.push(`${p.id}: ${p.runs.expand.reason?.slice(0, 100) ?? p.runs.expand.status}`);
}
console.log(
  `\n"expand" (three options switched together, not one at a time): ${expand.runs} runs, ${expand.identical} identical, ${expand.identicalMasked} masked, ${expand.differs} differ, ${expand.notCompared.length} not compared${expand.notCompared.length ? ` (${expand.notCompared.join('; ')})` : ''}`,
);

// ---------------------------------------------------------------- the eight options one at a time
console.log('\nEach of the eight options switched alone from its default (runs whose options name exactly that one):');
let singleRuns = 0;
const singleFiles = new Set();
const optionRows = [];
for (const [option, label] of OPTIONS) {
  const runs = [];
  for (const p of manifest.programs) {
    for (const [l, run] of Object.entries(p.runs)) {
      const keys = Object.keys(run.options ?? {});
      if (keys.length === 1 && keys[0] === option)
        runs.push({ id: p.id, label: l, verdict: verdict.get(`${p.id}|${l}`) ?? 'not compared' });
    }
  }
  singleRuns += runs.length;
  for (const r of runs) singleFiles.add(r.id);
  optionRows.push({ option, label, runs });
  const byVerdict = {};
  for (const r of runs) byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  console.log(
    `   ${option.padEnd(22)} (${label.padEnd(6)}) ${String(runs.length).padStart(3)} files: ${JSON.stringify(byVerdict)}`,
  );
}
console.log(
  `   together: ${singleRuns} single-option comparisons over ${singleFiles.size} distinct files (item 1 asks for 30 files x 8 options = 240)`,
);
const subsetCandidates = [
  'tests/conformance/asm/option-subset.json',
  'tests/corpus/option-subset.json',
  'tests/conformance/asm/options-subset.json',
];
const subset = subsetCandidates.find((f) => existsSync(join(repo, f)));
console.log(
  `   a fixed list of 30 files in the repository: ${subset ?? 'none found (looked for a list of the subset in the manifest and at ' + subsetCandidates.join(', ') + ')'}`,
);
if (!subset || singleRuns < 240)
  fails.push(
    `option matrix: ${singleRuns} single-option comparisons on ${singleFiles.size} files, no fixed 30-file subset; ${240 - singleRuns} short of 240`,
  );

// ---------------------------------------------------------------- exceptions and DIFFERENCES.md
console.log('\nExceptions and docs/DIFFERENCES.md:');
const exceptions = [];
for (const d of known.differences) {
  const stem = d.id.split('/').pop().slice(0, 6); // e.g. dir-11
  exceptions.push({
    what: `known difference ${d.id} (${d.label})`,
    named: differencesMd.includes(d.id) || differencesMd.includes(stem),
    cause: d.reason.slice(0, 140),
  });
}
const maskedRuns = [...verdict.values()].filter((v) => v === 'identical-masked').length;
exceptions.push({
  what: `${maskedRuns} runs equal only after masking the statements with an undefined symbol`,
  named: /undefined symbol/i.test(differencesMd),
  cause: 'the original encodes uninitialised memory for them (T1 erratum 4)',
});
/** Runs without an official result whose cause docs/DIFFERENCES.md states in other words. */
const NAMED_AS = { 's21_trailer_short_tab_size.X68': 'Error in LoadFile()' };
for (const n of notCompared.concat(expand.notCompared)) {
  const id = n.split(' ')[0].replace(/:$/, '');
  const file = id.split('/').pop();
  const named =
    differencesMd.includes(file) || (NAMED_AS[file] !== undefined && differencesMd.includes(NAMED_AS[file]));
  exceptions.push({ what: `no official result: ${n.slice(0, 110)}`, named, cause: 'golden/REPORT.md' });
}
for (const e of exceptions) console.log(`   ${e.named ? 'named   ' : 'MISSING '} ${e.what}`);
const missing = exceptions.filter((e) => !e.named);
if (missing.length > 0)
  fails.push(`${missing.length} of ${exceptions.length} exceptions are not named in docs/DIFFERENCES.md`);

if (jsonOut)
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ perSet, expand, optionRows, singleRuns, subset: subset ?? null, exceptions, notCompared, fails }, null, 2)}\n`,
  );
console.log(
  fails.length === 0 ? '\nitem 1 holds on these counts' : `\nitem 1 does not hold:\n - ${fails.join('\n - ')}`,
);
process.exit(fails.length === 0 ? 0 : 1);
