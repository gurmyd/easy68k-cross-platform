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
// item 1 does not hold, as the item reads with the correction note of erratum T1 26: a file without
// a default-option run; a run without an official result that docs/DIFFERENCES.md does not name (a
// named one is an exception with its cause and does not count against the item); a difference not
// in known-differences.json or not named; fewer than 240 of the 30 x 8 runs of the fixed subset
// (tests/corpus/option-subset.json) shown equal; a run with an official result that the last report
// did not judge (a stale report, or the site set not fetched). Exit code 2 when a report is missing
// or older than tests/corpus/manifest.json, tests/conformance/asm/known-differences.json or the
// assembler in engine/dist (item 1 not shown). EASY68K_RC_DIFFERENCES=<file> reads
// another DIFFERENCES.md (to show that the judge fails when an exception is not named). It is
// evidence for docs/integration/rc.md item 1 (I3); it changes nothing.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const manifest = JSON.parse(readFileSync(join(repo, 'tests', 'corpus', 'manifest.json'), 'utf8'));
const known = JSON.parse(readFileSync(join(repo, 'tests', 'conformance', 'asm', 'known-differences.json'), 'utf8'));
const differencesMd = readFileSync(
  process.env.EASY68K_RC_DIFFERENCES ?? join(repo, 'docs', 'DIFFERENCES.md'),
  'utf8',
).replace(/\r\n?/g, '\n');
const knownIds = new Set(known.differences.map((d) => d.id));
const fails = [];
/** Runs with an official result that the last conformance report did not judge. */
const unjudged = [];

// The verdicts of the last npm run test:conformance on this machine. A report older than what it
// was made from (the manifest, the list of known differences, the assembler in engine/dist) judges
// another state of the repository: the judge then says so and exits 2, not shown (review of the
// release-candidate check). EASY68K_RC_REPORTS=<folder> reads the reports from another folder.
const reports = process.env.EASY68K_RC_REPORTS ?? join(repo, 'build', 'reports');
const INPUTS = [
  'tests/corpus/manifest.json',
  'tests/conformance/asm/known-differences.json',
  'engine/dist/asm68k.wasm',
  'engine/dist/asm68k-loader.mjs',
];
const verdict = new Map();
const stale = [];
for (const name of ['corpus', 'checklist']) {
  const path = join(reports, `asm-conformance-${name}.json`);
  if (!existsSync(path)) {
    console.error(`${path} is missing: run npm run test:conformance first.`);
    process.exit(2);
  }
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const written = statSync(path).mtime;
  console.log(`report ${name}: written ${written.toISOString()}, ${JSON.stringify(report.summary)}`);
  for (const input of INPUTS) {
    const at = join(repo, input);
    if (existsSync(at) && statSync(at).mtime > written)
      stale.push(`${name}: written ${written.toISOString()}, before ${input} (${statSync(at).mtime.toISOString()})`);
  }
  for (const run of report.runs) verdict.set(`${run.id}|${run.label}`, run.verdict);
}
if (stale.length > 0) {
  console.log(`\nitem 1 not shown: the conformance reports are STALE:\n - ${stale.join('\n - ')}`);
  console.log('Run npm run test:conformance again (with the site set fetched), then this judge.');
  process.exit(2);
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
    const official = run.status === 'ok' || run.outputsKept;
    if (official) row.officialResult += 1;
    if (v === 'identical') row.identical += 1;
    else if (v === 'identical-masked') row.identicalMasked += 1;
    else if (v === 'differs') {
      row.differs += 1;
      if (!knownIds.has(p.id)) fails.push(`${p.id} (default) differs and is not in known-differences.json`);
    } else if (v === undefined && official) {
      // The official result exists but the last report has no verdict for it: the report is stale,
      // or the site set was not fetched. That is never an exception with a cause.
      row.notCompared += 1;
      unjudged.push(`${p.id} (default)`);
    } else if (v === undefined) {
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
console.log(
  `default-option runs without an official result (exceptions; each must be named in docs/DIFFERENCES.md, erratum T1 26): ${notCompared.length}`,
);
for (const n of notCompared) console.log(`   ${n}`);
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
  else if (v === 'differs') {
    expand.differs += 1;
    if (!knownIds.has(p.id)) fails.push(`${p.id} (expand) differs and is not in known-differences.json`);
  } else if (p.runs.expand.status === 'ok') unjudged.push(`${p.id} (expand)`);
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
// The fixed subset (tests/corpus/option-subset.json, T1): 30 files, each with a run for each of
// the eight options switched alone, each run with an official result and judged equal (byte for
// byte, or after masking undefined symbols) or a known difference that DIFFERENCES.md names.
const subset = 'tests/corpus/option-subset.json';
const subsetFiles = existsSync(join(repo, subset))
  ? JSON.parse(readFileSync(join(repo, subset), 'utf8')).files.map((f) => f.id)
  : [];
const cells = { equal: 0, knownDifference: 0 };
const badCells = [];
for (const id of subsetFiles) {
  const p = manifest.programs.find((x) => x.id === id);
  for (const [option, label] of OPTIONS) {
    const entry = p
      ? Object.entries(p.runs).find(
          ([, r]) => Object.keys(r.options ?? {}).length === 1 && Object.keys(r.options)[0] === option,
        )
      : undefined;
    if (!entry) {
      badCells.push(`${id} ${label}: no run`);
      continue;
    }
    const [l, run] = entry;
    const v = verdict.get(`${id}|${l}`);
    if (run.status !== 'ok') badCells.push(`${id} ${label}: no official result (${run.status})`);
    else if (v === 'identical' || v === 'identical-masked') cells.equal += 1;
    else if (v === 'differs' && knownIds.has(id)) cells.knownDifference += 1;
    else badCells.push(`${id} ${label}: ${v ?? 'not judged by the last report'}`);
  }
}
const distinctSubset = new Set(subsetFiles).size;
console.log(
  `   the fixed subset ${subset}: ${subsetFiles.length} files (${distinctSubset} distinct) x 8 options; ${cells.equal} equal, ${cells.knownDifference} known differences, ${badCells.length} not shown`,
);
for (const b of badCells) console.log(`      NOT SHOWN ${b}`);
if (distinctSubset !== 30 || subsetFiles.length !== 30)
  fails.push(`option matrix: the fixed subset has ${subsetFiles.length} files (${distinctSubset} distinct), not 30`);
if (cells.equal + cells.knownDifference < 240)
  fails.push(
    `option matrix: ${cells.equal + cells.knownDifference} of the 240 subset runs shown equal; ${240 - cells.equal - cells.knownDifference} short`,
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

// Every run with an official result must have been judged by the last npm run test:conformance
// (with the site set fetched); a run it did not judge is not evidence.
for (const p of manifest.programs)
  for (const [l, run] of Object.entries(p.runs))
    if (l !== 'default' && l !== 'expand' && run.status === 'ok' && !verdict.has(`${p.id}|${l}`)) {
      unjudged.push(`${p.id} (${l})`);
    }
const officialRuns = manifest.programs.flatMap((p) => Object.values(p.runs)).filter((r) => r.status === 'ok').length;
console.log(
  `\nruns with an official result: ${officialRuns}; judged by the last report: ${officialRuns - unjudged.length}; not judged: ${unjudged.length}`,
);
for (const u of unjudged.slice(0, 20)) console.log(`   NOT JUDGED ${u}`);
if (unjudged.length > 20) console.log(`   ... and ${unjudged.length - 20} more`);
if (unjudged.length > 0)
  fails.push(
    `${unjudged.length} runs with an official result were not judged by the last conformance report (stale report, or the site set not fetched)`,
  );

if (jsonOut)
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ perSet, expand, optionRows, singleRuns, subset, cells, badCells, exceptions, notCompared, unjudged, fails }, null, 2)}\n`,
  );
console.log(
  fails.length === 0 ? '\nitem 1 holds on these counts' : `\nitem 1 does not hold:\n - ${fails.join('\n - ')}`,
);
process.exit(fails.length === 0 ? 0 : 1);
