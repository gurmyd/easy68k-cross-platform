#!/usr/bin/env node
// Release candidate (ARCHITECTURE.md 9.6, package I3), evidence for 6.9 item 5 "Parity".
//
// What it proves, with plain Node and no browser:
//   1. Every row of the parity tables of section 1.3 (1.3.1 to 1.3.8) has an entry in
//      tests/parity/matrix.json, and every matrix entry of a 1.3 section is a row of the document.
//      The identity of a row is its section and its first cell, exactly as written; the tables are
//      read here by a parser of their own, not by tests/parity/matrix.ts, so the two are compared
//      independently. Rows of 1.5 (added commands) are counted apart: they are not part of item 5.
//   2. The entries counted by kind (the row's kind is its first entry; every entry is counted too).
//   3. Every web-e2e, desktop-e2e and unit entry names a file that exists and a test title that the
//      file contains (a template literal title is matched as written, ${...} included).
//   4. Every manual entry is an item of docs/MANUAL-TEST-MAC.md: its words open a row of the table
//      "Which check covers which item of the plan", whose check ids exist in the manual list.
//      Whether a person has signed it off is not something a script can show: it stays open.
//   5. Given CI logs, that every web-e2e entry PASSED in each named browser log, and every
//      desktop-e2e entry in the desktop logs: a test that failed, was skipped, was an expected
//      failure (test.fail) or does not appear at all is reported by name.
//   6. Given Vitest JSON reports (--reporter=json), that every unit entry with a title passed.
//
// Run from the repository root:
//   node tests/integration/rc/item-05-parity.mjs
//   node tests/integration/rc/item-05-parity.mjs \
//     --web chromium=<log of a ci.yml e2e job in Chromium> --web webkit=<log of the job in WebKit> \
//     --desktop <log of desktop-dev> --desktop <log of a release.yml mac job> \
//     --unit <vitest json report> [--json <out.json>]
// A job's log is what `gh api repos/<owner>/<repo>/actions/jobs/<id>/logs` prints (the timestamps
// and colour codes of GitHub's logs are understood). Several --web logs of one browser count as one
// (a test passed if it passed in one of them and failed in none).
// Exit code 0 when every check that was given its input holds, 1 otherwise. Every problem is
// printed with its row, so that a failure can be read from the output alone.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path) => readFileSync(join(repo, path), 'utf8');

// ---------------------------------------------------------------------------------------------
// Arguments

const args = { web: new Map(), desktop: [], unit: [], json: null };
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i];
  const value = process.argv[i + 1];
  if (flag === '--web' && value) {
    const [browser, file] = value.includes('=') ? value.split(/=(.*)/s) : [null, null];
    if (!browser || !file) throw new Error(`--web wants <browser>=<log file>, got ${value}`);
    if (!args.web.has(browser)) args.web.set(browser, []);
    args.web.get(browser).push(file);
    i += 1;
  } else if (flag === '--desktop' && value) {
    args.desktop.push(value);
    i += 1;
  } else if (flag === '--unit' && value) {
    args.unit.push(value);
    i += 1;
  } else if (flag === '--json' && value) {
    args.json = value;
    i += 1;
  } else {
    console.error(`unknown argument ${flag}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------------------------
// 1. The rows of 1.3 against the matrix

/** Rows of the Markdown tables under "#### 1.3.N" headings, up to "### 1.4". */
function documentRows(text) {
  const lines = text.split(/\r?\n/);
  const isSeparator = (line) => line !== undefined && /^\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
  const rows = [];
  let section = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = /^#### (1\.3\.\d+) /.exec(line);
    if (heading) {
      section = heading[1];
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      section = null;
      continue;
    }
    if (section === null || !line.startsWith('|')) continue;
    if (isSeparator(line) || isSeparator(lines[i + 1])) continue; // separator and header rows
    const cells = line
      .slice(1)
      .split('|')
      .map((cell) => cell.trim());
    rows.push({ section, original: cells[0], line: i + 1, cells });
  }
  return rows;
}

const architecture = read('docs/ARCHITECTURE.md');
const matrix = JSON.parse(read('tests/parity/matrix.json'));
const docRows = documentRows(architecture);
const key = (row) => `${row.section}\u0000${row.original}`;
const label = (row) => `${row.section} | ${row.original}`;

const problems = [];
const problem = (row, text) => problems.push({ row, problem: text });

const matrixRows13 = matrix.rows.filter((row) => /^1\.3\./.test(row.section));
const matrixRowsOther = matrix.rows.filter((row) => !/^1\.3\./.test(row.section));
const inMatrix = new Map();
for (const row of matrixRows13) inMatrix.set(key(row), (inMatrix.get(key(row)) ?? 0) + 1);
const inDoc = new Map();
for (const row of docRows) inDoc.set(key(row), (inDoc.get(key(row)) ?? 0) + 1);

const rowsWithoutEntry = docRows.filter((row) => !inMatrix.has(key(row)));
const entriesWithoutRow = matrixRows13.filter((row) => !inDoc.has(key(row)));
const duplicated = [...inMatrix].filter(([k, n]) => n > (inDoc.get(k) ?? 1)).map(([k]) => k.replace('\u0000', ' | '));
for (const row of rowsWithoutEntry)
  problem(label(row), `row of ARCHITECTURE.md line ${row.line} has no entry in the matrix`);
for (const row of entriesWithoutRow) problem(label(row), 'matrix entry is not a row of section 1.3');
for (const row of duplicated) problem(row, 'row appears more than once in the matrix');

const perSection = {};
for (const row of docRows) {
  perSection[row.section] ??= { document: 0, matrix: 0 };
  perSection[row.section].document += 1;
}
for (const row of matrixRows13) {
  perSection[row.section] ??= { document: 0, matrix: 0 };
  perSection[row.section].matrix += 1;
}

// ---------------------------------------------------------------------------------------------
// 2. Counts by kind

const firstKind = {};
const everyKind = {};
for (const row of matrix.rows) {
  const scope = /^1\.3\./.test(row.section) ? '1.3' : row.section;
  const kind = row.verifiedBy?.[0]?.kind ?? 'none';
  firstKind[scope] ??= {};
  firstKind[scope][kind] = (firstKind[scope][kind] ?? 0) + 1;
  for (const entry of row.verifiedBy ?? []) {
    everyKind[scope] ??= {};
    everyKind[scope][entry.kind] = (everyKind[scope][entry.kind] ?? 0) + 1;
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Named files and titles exist

/** Titles of test(...) / it(...) calls, as written (a template literal keeps its ${...}). */
function testTitles(source) {
  const pattern = /\b(?:test|it)(?:\.(?:fail|skip|fixme|only|concurrent))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs;
  return [...source.matchAll(pattern)].map((match) =>
    match[2].replace(/\\(.)/g, (all, character) => (character === match[1] || character === '\\' ? character : all)),
  );
}
const titleCache = new Map();
function titlesOf(file) {
  if (!titleCache.has(file)) titleCache.set(file, testTitles(read(file)));
  return titleCache.get(file);
}

const allEntries = [];
for (const row of matrix.rows) {
  for (const entry of row.verifiedBy ?? []) allEntries.push({ row, entry });
}
for (const { row, entry } of allEntries) {
  if (entry.kind === 'manual' || entry.kind === 'browser-check') continue;
  const where = label(row);
  if (!entry.file) {
    problem(where, `${entry.kind} entry names no file`);
    continue;
  }
  const path = join(repo, entry.file);
  if (!existsSync(path)) {
    problem(where, `${entry.kind}: ${entry.file} does not exist`);
    continue;
  }
  if (entry.test === undefined) {
    if (entry.kind !== 'unit') problem(where, `${entry.kind}: ${entry.file} names no test title`);
    continue;
  }
  if (statSync(path).isDirectory()) {
    problem(where, `${entry.kind}: ${entry.file} is a folder but a test title is given`);
    continue;
  }
  if (!titlesOf(entry.file).includes(entry.test))
    problem(where, `${entry.kind}: ${entry.file} has no test "${entry.test}"`);
}

// ---------------------------------------------------------------------------------------------
// 4. Manual entries against docs/MANUAL-TEST-MAC.md

const manualText = read('docs/MANUAL-TEST-MAC.md');
const words = (text) =>
  text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9+#.-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
/** The rows of the table under "## Which check covers which item of the plan". */
const coverTable = (() => {
  const start = manualText.search(/^## Which check covers which item of the plan/m);
  if (start < 0) return [];
  const rest = manualText.slice(start).split(/\r?\n/).slice(1);
  const rows = [];
  for (const line of rest) {
    if (/^## /.test(line)) break;
    if (!line.startsWith('|') || /^\|[-| :]+\|\s*$/.test(line)) continue;
    const [item, checks] = line
      .slice(1)
      .split('|')
      .map((cell) => cell.trim());
    if (item === 'Item of 6.8' || item === 'From') continue;
    rows.push({ item, checks });
  }
  return rows;
})();
/** Expands "S1-S5, D6, A2 (K1-K15)" into the ids it names and checks that each has a row or heading. */
function checkIds(checks) {
  const ids = [];
  for (const part of checks.replace(/\([^)]*\)/g, '').split(',')) {
    const range = /^\s*([A-Z])(\d+)\s*-\s*\1?(\d+)\s*$/.exec(part);
    if (range) for (let n = Number(range[2]); n <= Number(range[3]); n += 1) ids.push(`${range[1]}${n}`);
    else if (part.trim()) ids.push(part.trim());
  }
  return ids;
}
const idExists = (id) => new RegExp(`^(\\| ${id} \\||### ${id}\\. )`, 'm').test(manualText);
const manualItems = new Map();
for (const { row, entry } of allEntries) {
  if (entry.kind !== 'manual') continue;
  const item = entry.item ?? '';
  if (!manualItems.has(item)) {
    const lead = words(item).slice(0, 5).join(' ');
    // The table may write an item a little shorter than 6.8 does ("the app" for "the desktop
    // app"), so the first five words are looked for, at the start of a row or after its "; ".
    const match =
      coverTable.find((candidate) => words(candidate.item).join(' ').startsWith(lead)) ??
      coverTable.find((candidate) => candidate.item.split('; ').some((part) => words(part).join(' ').startsWith(lead)));
    const ids = match ? checkIds(match.checks) : [];
    manualItems.set(item, { match, ids, missingIds: ids.filter((id) => !idExists(id)), rows: [] });
  }
  manualItems.get(item).rows.push(label(row));
}
for (const [item, found] of manualItems) {
  if (!found.match)
    problem(found.rows[0], `manual item "${item}" is in no row of MANUAL-TEST-MAC.md "Which check covers which item"`);
  else if (found.missingIds.length > 0)
    problem(
      found.rows[0],
      `manual item "${item}": checks ${found.missingIds.join(', ')} are not in MANUAL-TEST-MAC.md`,
    );
}

// ---------------------------------------------------------------------------------------------
// 5. Results from Playwright logs (list reporter)

/**
 * Results of a Playwright list-reporter log: one record per result line, with the file (forward
 * slashes, relative to tests/), the full title path after the file, and the outcome. Colours are
 * read before they are stripped: a green cross is an expected failure (test.fail), a red one a
 * failure.
 */
const ESC = String.fromCharCode(27);
const COLOUR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const GREEN_CROSS = new RegExp(`${ESC}\\[32m\\s*(✘|x)`);
/** GitHub's timestamp at the start of every log line (and a byte-order mark on the first). */
const TIMESTAMP = new RegExp(String.raw`^${String.fromCharCode(0xfeff)}?\d{4}-\d\d-\d\dT[\d:.]+Z `);

function playwrightResults(path) {
  const results = [];
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(TIMESTAMP, '');
    const plain = line.replace(COLOUR, '');
    const match =
      /^\s+(✓|✘|ok|x|-)\s+\d+\s+(?:\[([\w-]+)\]\s+›\s+)?(\S+?):\d+:\d+\s+›\s+(.*?)(?:\s+\(\d[\d.]*m?s\))?\s*$/.exec(
        plain,
      );
    if (!match) continue;
    const [, mark, project, file, titlePath] = match;
    let outcome = 'passed';
    if (mark === '-') outcome = 'skipped';
    else if (mark === '✘' || mark === 'x') outcome = GREEN_CROSS.test(line) ? 'expected-failure' : 'failed';
    results.push({ project: project ?? null, file: file.replace(/\\/g, '/'), titlePath, outcome });
  }
  return results;
}

/** A matcher for a title as written in the source: ${...} stands for any text. */
function titleMatcher(title) {
  const parts = title.split(/\$\{[^}]*\}/);
  const body = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+');
  return new RegExp(`(^|\\s›\\s)${body}$`);
}

function outcomeIn(results, entry) {
  // tests/e2e/x.spec.ts in the matrix; the logs print it relative to tests/ (e2e/x.spec.ts) or to
  // the config's folder (desktop/dev/x.spec.ts is "x.spec.ts" or "dev/x.spec.ts").
  const file = entry.file.replace(/^tests\//, '');
  const matcher = titleMatcher(entry.test);
  const hits = results.filter((r) => (file.endsWith(r.file) || r.file.endsWith(file)) && matcher.test(r.titlePath));
  if (hits.length === 0) return { outcome: 'absent', count: 0 };
  const order = ['failed', 'expected-failure', 'skipped', 'passed'];
  const worst = order.find((outcome) => hits.some((hit) => hit.outcome === outcome));
  return { outcome: worst, count: hits.length, passed: hits.filter((h) => h.outcome === 'passed').length };
}

const resultsReport = { web: {}, desktop: null, unit: null };
for (const [browser, files] of args.web) {
  const results = files.flatMap(playwrightResults);
  const summary = { log: files, resultLines: results.length, passed: 0, notPassed: [] };
  for (const { row, entry } of allEntries) {
    if (entry.kind !== 'web-e2e' || entry.test === undefined) continue;
    const found = outcomeIn(results, entry);
    if (found.outcome === 'passed') summary.passed += 1;
    else {
      summary.notPassed.push({ row: label(row), file: entry.file, test: entry.test, outcome: found.outcome });
      problem(label(row), `web-e2e ${entry.file} "${entry.test}": ${found.outcome} in ${browser}`);
    }
  }
  resultsReport.web[browser] = summary;
}
if (args.desktop.length > 0) {
  const results = args.desktop.flatMap(playwrightResults);
  const summary = { log: args.desktop, resultLines: results.length, passed: 0, notPassed: [] };
  for (const { row, entry } of allEntries) {
    if (entry.kind !== 'desktop-e2e') continue;
    const found = outcomeIn(results, entry);
    if (found.outcome === 'passed') summary.passed += 1;
    else {
      summary.notPassed.push({ row: label(row), file: entry.file, test: entry.test, outcome: found.outcome });
      problem(label(row), `desktop-e2e ${entry.file} "${entry.test}": ${found.outcome} in the desktop logs`);
    }
  }
  resultsReport.desktop = summary;
}

// ---------------------------------------------------------------------------------------------
// 6. Results from Vitest JSON reports

if (args.unit.length > 0) {
  const assertions = [];
  for (const file of args.unit) {
    const report = JSON.parse(readFileSync(file, 'utf8'));
    for (const suite of report.testResults ?? []) {
      const name = suite.name.replace(/\\/g, '/');
      for (const assertion of suite.assertionResults ?? [])
        assertions.push({ file: name, title: assertion.title, status: assertion.status });
    }
  }
  const summary = { reports: args.unit, passed: 0, folders: [], notPassed: [] };
  for (const { row, entry } of allEntries) {
    if (entry.kind !== 'unit') continue;
    if (entry.test === undefined) {
      // A folder or a whole file: every test in it must have passed, and there must be some. A
      // folder of programs (tests/conformance/sim/logs) holds no test files: the suite that runs
      // it is the folder above it, so then every test of that suite must have passed.
      let inside = assertions.filter((a) => a.file.endsWith(entry.file) || a.file.includes(`${entry.file}/`));
      if (inside.length === 0) {
        const suite = entry.file.replace(/\/[^/]+$/, '/');
        inside = assertions.filter((a) => a.file.includes(suite));
      }
      // Skipped tests are counted but not held against it: each suite has a guard test that is
      // skipped whenever engine/dist is present (it fails only when the engines are missing).
      const failed = inside.filter((a) => a.status !== 'passed' && a.status !== 'skipped' && a.status !== 'pending');
      const skipped = inside.filter((a) => a.status === 'skipped' || a.status === 'pending');
      summary.folders.push({
        file: entry.file,
        tests: inside.length,
        notPassed: failed.length,
        skipped: skipped.length,
      });
      if (inside.length === 0 || failed.length > 0) {
        summary.notPassed.push({
          row: label(row),
          file: entry.file,
          outcome: inside.length === 0 ? 'absent' : `${failed.length} not passed`,
        });
        problem(
          label(row),
          `unit ${entry.file}: ${inside.length === 0 ? 'no test of it in the reports' : `${failed.length} of ${inside.length} not passed`}`,
        );
      } else summary.passed += 1;
      continue;
    }
    const matcher = titleMatcher(entry.test);
    const hits = assertions.filter((a) => a.file.endsWith(entry.file) && matcher.test(a.title));
    if (hits.length > 0 && hits.every((a) => a.status === 'passed')) summary.passed += 1;
    else {
      const outcome = hits.length === 0 ? 'absent' : hits.map((a) => a.status).join(',');
      summary.notPassed.push({ row: label(row), file: entry.file, test: entry.test, outcome });
      problem(label(row), `unit ${entry.file} "${entry.test}": ${outcome} in the Vitest reports`);
    }
  }
  resultsReport.unit = summary;
}

// ---------------------------------------------------------------------------------------------
// Report

const total = (counts) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
console.log('6.9 item 5 (parity): tests/parity/matrix.json against ARCHITECTURE.md 1.3');
console.log(
  `rows of 1.3 in the document: ${docRows.length}; matrix entries of 1.3: ${matrixRows13.length}; matrix entries of other sections (1.5): ${matrixRowsOther.length}`,
);
for (const [section, counts] of Object.entries(perSection).sort()) {
  console.log(`  ${section}: document ${counts.document}, matrix ${counts.matrix}`);
}
console.log(
  `rows of 1.3 without an entry: ${rowsWithoutEntry.length}${rowsWithoutEntry.map((r) => `\n  - ${label(r)}`).join('')}`,
);
console.log(
  `entries without a row of 1.3: ${entriesWithoutRow.length}${entriesWithoutRow.map((r) => `\n  - ${label(r)}`).join('')}`,
);
console.log(`duplicated entries: ${duplicated.length}`);
for (const scope of Object.keys(firstKind).sort()) {
  console.log(
    `rows of ${scope} by kind (first entry): ${JSON.stringify(firstKind[scope])} = ${total(firstKind[scope])}`,
  );
  console.log(
    `entries of ${scope} by kind (every entry): ${JSON.stringify(everyKind[scope])} = ${total(everyKind[scope])}`,
  );
}
console.log(`manual items named: ${manualItems.size}`);
for (const [item, found] of manualItems) {
  console.log(
    `  - "${item}" (${found.rows.length} entries) -> ${found.match ? `MANUAL-TEST-MAC.md checks ${found.match.checks}` : 'NOT FOUND in MANUAL-TEST-MAC.md'}`,
  );
}
console.log('  (sign-off of these items: OPEN; only a person on a Mac can give it)');
for (const [browser, summary] of Object.entries(resultsReport.web)) {
  const wanted = allEntries.filter(({ entry }) => entry.kind === 'web-e2e' && entry.test !== undefined).length;
  const distinct = new Set(
    allEntries
      .filter(({ entry }) => entry.kind === 'web-e2e' && entry.test !== undefined)
      .map(({ entry }) => `${entry.file}\u0000${entry.test}`),
  ).size;
  const distinctMissed = new Set(summary.notPassed.map((miss) => `${miss.file}\u0000${miss.test}`)).size;
  console.log(
    `web-e2e entries passed in ${browser}: ${summary.passed} of ${wanted}; distinct tests named: ${distinct}, not passed: ${distinctMissed} (${summary.resultLines} result lines read)`,
  );
  for (const miss of summary.notPassed) console.log(`  - ${miss.outcome}: ${miss.file} "${miss.test}" [${miss.row}]`);
}
if (resultsReport.desktop) {
  const wanted = allEntries.filter(({ entry }) => entry.kind === 'desktop-e2e').length;
  console.log(
    `desktop-e2e entries passed: ${resultsReport.desktop.passed} of ${wanted} (${resultsReport.desktop.resultLines} result lines read)`,
  );
  for (const miss of resultsReport.desktop.notPassed)
    console.log(`  - ${miss.outcome}: ${miss.file} "${miss.test}" [${miss.row}]`);
}
if (resultsReport.unit) {
  const wanted = allEntries.filter(({ entry }) => entry.kind === 'unit').length;
  console.log(`unit entries passed: ${resultsReport.unit.passed} of ${wanted}`);
  for (const folder of resultsReport.unit.folders)
    console.log(
      `  folder ${folder.file}: ${folder.tests} tests, ${folder.notPassed} failed, ${folder.skipped} skipped`,
    );
  for (const miss of resultsReport.unit.notPassed)
    console.log(`  - ${miss.outcome}: ${miss.file} "${miss.test ?? ''}" [${miss.row}]`);
}
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  ${p.row}: ${p.problem}`);
if (args.json) {
  writeFileSync(
    args.json,
    JSON.stringify(
      {
        perSection,
        rowsWithoutEntry: rowsWithoutEntry.map(label),
        entriesWithoutRow: entriesWithoutRow.map(label),
        firstKind,
        everyKind,
        manual: [...manualItems].map(([item, f]) => ({ item, checks: f.match?.checks ?? null, rows: f.rows })),
        results: resultsReport,
        problems,
      },
      null,
      2,
    ),
  );
}
process.exit(problems.length === 0 ? 0 : 1);
