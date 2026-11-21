#!/usr/bin/env node
// Runs the whole 68000 single-step suite through the WebAssembly simulator and compares the
// outcome with the frozen baseline (ARCHITECTURE.md 6.1 L7, 6.2.4).
//
//     node tests/conformance/cpu/run-catalogue.mjs [--only NAME,...] [--write-baseline] [--report <file.md>]
//
// Downloads the suite first if needed (fetch-suite.mjs). Prints one line per suite file and a
// summary; writes a Markdown report with every deviation class and its count (default
// build/cpu-catalogue/report.md). Exit code 1 if any file differs from baseline.json, unless
// --write-baseline is given, which rewrites baseline.json from this run instead.
//
// Needs engine/dist (the built simulator). Part of easy68k-cross-platform, an unofficial port of EASy68K.
// GPL-2.0-or-later.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScript } from '../../oracle/native-twin/sim-script.mjs';
import { analyseFile, compareWithBaseline, readBaseline, THEMES, themeOf, writeBaseline } from './catalogue.mjs';
import { ensureSuite, readSuite } from './fetch-suite.mjs';
import { readSuiteFile, scriptFor } from './singlestep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

/** Markdown table of every class, most frequent first, and of the fields. */
export function reportMarkdown(files) {
  const totals = { tests: 0, deviating: 0 };
  const classes = {};
  const fields = {};
  for (const r of Object.values(files)) {
    totals.tests += r.tests;
    totals.deviating += r.deviating;
    for (const [c, n] of Object.entries(r.classes)) classes[c] = (classes[c] ?? 0) + n;
    for (const [f, n] of Object.entries(r.fields)) fields[f] = (fields[f] ?? 0) + n;
  }
  const md = ['# 68000 single-step suite on the EASy68K core', ''];
  md.push(
    `${Object.keys(files).length} files, ${totals.tests} tests, ${totals.deviating} deviate from the real 68000.`,
    '',
  );
  md.push('## Per file', '', '| File | Tests | Deviating |', '|---|---:|---:|');
  for (const [name, r] of Object.entries(files)) md.push(`| ${name} | ${r.tests} | ${r.deviating} |`);
  const themes = Object.fromEntries(THEMES.map(([id, title]) => [id, { title, classes: 0, tests: 0 }]));
  for (const [c, n] of Object.entries(classes)) {
    const t = themes[themeOf(c)];
    t.classes++;
    t.tests += n;
  }
  md.push('', '## Themes (docs/porting/cpu-deviations.md)', '', '| Theme | Classes | Tests |', '|---|---:|---:|');
  for (const [id, t] of Object.entries(themes)) md.push(`| ${id}: ${t.title} | ${t.classes} | ${t.tests} |`);
  md.push('', '## Differing fields (a test can count under several)', '', '| Field | Tests |', '|---|---:|');
  for (const [f, n] of Object.entries(fields).sort((a, b) => b[1] - a[1])) md.push(`| ${f} | ${n} |`);
  md.push('', '## Classes', '', '| Class | Theme | Tests |', '|---|---|---:|');
  for (const [c, n] of Object.entries(classes).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)))
    md.push(`| ${c} | ${themeOf(c)} | ${n} |`);
  return { markdown: md.join('\n') + '\n', totals };
}

/**
 * The command line above, as a function (run-singlestep.mjs calls it too).
 * @param {string[]} argv the arguments after the script name
 * @returns {Promise<number>} the exit code
 */
export async function runCatalogue(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const only = arg('--only')?.split(',');
  const write = argv.includes('--write-baseline');
  const reportPath = arg('--report') ?? join(repo, 'build', 'cpu-catalogue', 'report.md');
  const suite = readSuite();
  const baseline = readBaseline();
  if (argv.includes('--from-baseline')) {
    // Only the report, from the committed counts; the suite is not needed.
    if (!baseline) throw new Error('baseline.json is missing');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, reportMarkdown(baseline.files).markdown);
    console.log(`report from baseline.json: ${reportPath}`);
    return 0;
  }
  const paths = await ensureSuite({ log: (l) => console.log(l) });
  const files = {};
  const problems = [];
  const started = Date.now();
  for (const path of paths) {
    const name = basename(path);
    if (only && !only.includes(name) && !only.includes(name.replace(/\.json\.gz$/, ''))) continue;
    const tests = readSuiteFile(path);
    const result = analyseFile(name, tests, await runScript(scriptFor(tests)));
    files[name] = result;
    const diff = write ? [] : compareWithBaseline(name, result, baseline?.files?.[name]);
    problems.push(...diff);
    console.log(
      `${name}: ${result.tests} tests, ${result.deviating} deviate${diff.length ? '  DIFFERS FROM BASELINE' : ''}`,
    );
  }
  const { markdown, totals } = reportMarkdown(files);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, markdown);
  console.log(
    `${Object.keys(files).length} files, ${totals.tests} tests, ${totals.deviating} deviate (${((Date.now() - started) / 1000).toFixed(0)} s); report: ${reportPath}`,
  );
  if (write) {
    if (only) throw new Error('--write-baseline needs the whole suite (no --only)');
    writeBaseline(suite, files);
    console.log('baseline.json written');
    return 0;
  }
  if (problems.length) {
    console.log(`${problems.length} difference(s) from baseline.json:\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log('matches baseline.json');
  return 0;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  runCatalogue(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(String(error instanceof Error ? error.stack : error));
      process.exit(1);
    });
}
