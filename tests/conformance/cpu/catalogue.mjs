// The catalogue of CPU deviations and its frozen baseline (ARCHITECTURE.md 6.1 L7).
//
// analyseFile() classifies every test of one suite file from the transcript of its script
// (singlestep.mjs). The baseline (baseline.json, committed) holds, per suite file, the number of
// tests, the number that deviate from the real 68000, the count per deviation class, and a SHA-256
// over "<test index> <class>" of every deviating test. The suite itself is not redistributable, so
// nothing of its content - no test name, no register value - is committed: only these counts, our
// own class names and the hash. A change of the core that changes any single test's outcome
// changes the hash of that file.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviationClass, differences, expectedException, parseTranscript } from './singlestep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const BASELINE_PATH = join(here, 'baseline.json');

/**
 * @typedef {{ tests: number, deviating: number, sha256: string, classes: Record<string, number>,
 *   fields: Record<string, number> }} FileResult
 */

/**
 * @param {string} fileName e.g. "ABCD.json.gz"
 * @param {import('./singlestep.mjs').SuiteTest[]} tests
 * @param {string} transcript the wasm (or twin) transcript of scriptFor(tests)
 * @returns {FileResult}
 */
export function analyseFile(fileName, tests, transcript) {
  const results = parseTranscript(transcript);
  if (results.length !== tests.length)
    throw new Error(`${fileName}: ${results.length} results for ${tests.length} tests`);
  const hash = createHash('sha256');
  const classes = {};
  const fields = {};
  let deviating = 0;
  results.forEach((result, index) => {
    const diff = differences(tests[index], result);
    if (!diff.length) return;
    deviating++;
    const cls = deviationClass(fileName, diff, expectedException(tests[index]));
    classes[cls] = (classes[cls] ?? 0) + 1;
    for (const field of diff) fields[field] = (fields[field] ?? 0) + 1;
    hash.update(`${index} ${cls}\n`);
  });
  return {
    tests: tests.length,
    deviating,
    sha256: hash.digest('hex'),
    classes: sortObject(classes),
    fields: sortObject(fields),
  };
}

/**
 * The themes of docs/porting/cpu-deviations.md, in priority order: a class is counted under the
 * first theme whose rule matches it. Each rule looks only at the class name (family, exception,
 * differing fields), so the assignment is reproducible from baseline.json.
 */
export const THEMES = [
  [
    'address-error',
    'Address error: stack frame contents and work done before the fault',
    (c) => c.includes('[address error]'),
  ],
  ['trap15', "TRAP #15 is the simulator's I/O call", (c) => c.startsWith('TRAP [TRAP]')],
  [
    'a7-byte',
    'Byte accesses through -(A7) and (A7)+ move A7 by 1',
    (c) => /^(ADDX\.b|SUBX\.b|ABCD|SBCD|CMP\.b)[ :]/.test(c) && c.includes('SSP'),
  ],
  ['link-a7', 'LINK A7 and UNLK A7 use the user stack pointer', (c) => /^(LINK|UNLINK):/.test(c)],
  ['ea24', 'Effective addresses are truncated to 24 bits', (c) => /^(LEA|PEA|JMP|JSR):/.test(c)],
  [
    'ccr-system-byte',
    'ORI and EORI to CCR change the system byte of SR',
    (c) => /^(ORItoCCR|EORItoCCR):/.test(c) && /SR\.(T|S|IPL)/.test(c),
  ],
  ['sr-unused', 'Unused SR bits are kept', (c) => c.includes('SR.unused')],
  ['bcd', 'ABCD, SBCD, NBCD: V and N flags, and digits that are not BCD', (c) => /^(ABCD|SBCD|NBCD)[ :]/.test(c)],
  ['chk', 'CHK: the flags the 68000 leaves undefined', (c) => /^CHK[ :]/.test(c)],
  ['div', 'DIVS, DIVU: flags on overflow and on division by zero', (c) => /^DIV[SU][ :]/.test(c)],
  ['mul', 'MULS: V flag not cleared', (c) => /^MUL[SU][ :]/.test(c)],
  ['shift', 'ASL, ASR: V, C and X for large shift counts', (c) => /^AS[LR]\./.test(c)],
  ['other', 'Not assigned to a theme', () => true],
];

/** @param {string} cls @returns {string} the theme id */
export function themeOf(cls) {
  return THEMES.find(([, , rule]) => rule(cls))[0];
}

function sortObject(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** @returns {{ suite: { repository: string, commit: string, folder: string }, files: Record<string, FileResult> } | null} */
export function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function writeBaseline(suite, files) {
  const baseline = {
    comment:
      'Frozen outcome of the 68000 single-step suite on the EASy68K core (tests/conformance/cpu/README.md). ' +
      'Counts, class names and hashes only: the suite is not redistributable. Regenerate with ' +
      '`node tests/conformance/cpu/run-catalogue.mjs --write-baseline` after a deliberate change of the core.',
    suite: { repository: suite.repository, commit: suite.commit, folder: suite.folder },
    files: sortObject(files),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  return baseline;
}

/**
 * Differences between a result and the baseline entry of the same file.
 * @param {string} fileName @param {FileResult} result @param {FileResult|undefined} expected
 * @returns {string[]}
 */
export function compareWithBaseline(fileName, result, expected) {
  if (!expected) return [`${fileName}: not in baseline.json`];
  const out = [];
  if (result.tests !== expected.tests) out.push(`${fileName}: ${result.tests} tests, baseline ${expected.tests}`);
  if (result.deviating !== expected.deviating)
    out.push(`${fileName}: ${result.deviating} deviating tests, baseline ${expected.deviating}`);
  for (const cls of new Set([...Object.keys(result.classes), ...Object.keys(expected.classes)])) {
    const a = result.classes[cls] ?? 0;
    const b = expected.classes[cls] ?? 0;
    if (a !== b) out.push(`${fileName}: class "${cls}": ${a}, baseline ${b}`);
  }
  if (result.sha256 !== expected.sha256 && out.length === 0)
    out.push(`${fileName}: the same counts, but other tests deviate (hash differs)`);
  return out;
}
