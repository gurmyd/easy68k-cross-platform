// Release candidate, ARCHITECTURE.md 6.9 item 12 ("Manual: docs/MANUAL-TEST-MAC.md completed for
// the release candidate"): is the manual list complete against section 6.8? Owner: I3.
//
//   node tests/integration/rc/item-12-manual-coverage.mjs
//
// No browser. Whether a person has COMPLETED the list cannot be checked by a script (it is open
// until a filled-in report exists for the release candidate). What this checks is that the list a
// person would work through covers what 6.8 asks, and stays consistent with the application:
//
//   - every bullet of 6.8 (twelve for the Mac, three for real Windows) has its row in the
//     manual's table "Which check covers which item of the plan", and every check named there
//     exists as a row of the manual (ranges such as M1-M11 are expanded); a new bullet in 6.8 fails
//     until the table names it;
//   - the browser shortcut table (A2): one row per chord that the page cancels on the macOS key map,
//     read from GUARDED_CHORDS of app/src/commands/tables/keys.ts (2.9.3), with a column for Safari,
//     Chrome and Edge; B10 names a row for each chord of the Windows key map; the report form has a
//     line per row;
//   - every check of parts A, B1, B2, B3 and B7 has a place in the report form;
//   - the first-start text between <!-- first-start:begin --> and <!-- first-start:end --> is the
//     same in the README and in the manual (B3).
//
// Exit code 0 = everything checked holds.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (...path) => readFileSync(join(repoRoot, ...path), 'utf8').replace(/\r\n/g, '\n');
const manual = read('docs', 'MANUAL-TEST-MAC.md');
const architecture = read('docs', 'ARCHITECTURE.md');
const keysTable = read('app', 'src', 'commands', 'tables', 'keys.ts');
const readme = read('README.md');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (ok) passed += 1;
  else failed += 1;
};
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  return start < 0 ? '' : text.slice(start, end < 0 ? undefined : end);
};

// --- the rows of the manual ----------------------------------------------------------------------
/** Every check id of the manual: the first cell of a table row, such as K1, M10, W0, D9, C7, B12. */
const rowIds = new Set([...manual.matchAll(/^\| ([A-Z]\d+) \|/gm)].map((m) => m[1]));
console.log(`[the manual] ${rowIds.size} checks: ${[...rowIds].join(' ')}`);

/** "A2 (K1-K15), B10" -> the ids it names, ranges expanded; part headings (A2, B10) are kept as parts. */
function namedIds(cell) {
  const ids = [];
  for (const [, letter, from, , to] of cell.matchAll(/\b([A-Z])(\d+)(-([A-Z]?\d+))?\b/g)) {
    const last = to ? Number(to.replace(/^[A-Z]/, '')) : Number(from);
    for (let n = Number(from); n <= last; n += 1) ids.push(`${letter}${n}`);
  }
  return ids;
}
const PART_HEADINGS = new Set([...manual.matchAll(/^### ([A-Z]\d+)\. /gm)].map((m) => m[1]));

// --- 6.8 against the coverage table --------------------------------------------------------------
console.log('\n[6.8 against "Which check covers which item of the plan"]');
const section68 = between(architecture, '### 6.8 What only a person can check', '### 6.9');
const bullets = [...section68.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
/** Each bullet of 6.8 by words that identify it in the bullet and in the coverage table's first column. */
const ITEMS = [
  ['First launch of the downloaded app', /First launch/],
  ['Double-click on `.X68`', /Double-click/],
  ['Sound: tasks 70-77', /^Sound/],
  ['Browser shortcut table', /Browser shortcut table/],
  ['Keyboard on a real MacBook', /Keyboard on a real MacBook/],
  ['Paste into a task 2 prompt', /^Paste into a task 2 prompt/],
  ['Full screen on the built-in display', /^Full screen/],
  ['Printing a source file', /^Printing/],
  ['A serial adapter with tasks 40-43', /serial adapter/],
  ['VoiceOver', /^VoiceOver/],
  ['Safari itself', /^Safari itself/],
  ['A long session', /^A long session/],
  ['The UNVERIFIED items', /^On real Windows/],
  ['The RichEdit spot check', /^On real Windows/],
  ['The speed measurement for `DEFAULT_IPS`', /^On real Windows/],
  // The stage of additions (ARCHITECTURE-PLUS P3.4.2; errata N10 entry 2): the sixteenth item.
  ['The PDF viewer of the stage of additions', /^The PDF viewer/],
];
check(
  `6.8 has ${ITEMS.length} bullets and each is one this script knows`,
  bullets.length === ITEMS.length &&
    bullets.every((b) => ITEMS.some(([start]) => b.replace(/\*\*/g, '').startsWith(start))),
  `${bullets.length} bullets`,
);
const coverage = between(manual, '## Which check covers which item of the plan', 'And what the parts of the port left');
const coverageRows = [...coverage.matchAll(/^\| (.+?) \| (.+?) \|$/gm)]
  .map((m) => ({ item: m[1], checks: m[2] }))
  .filter((r) => r.item !== 'Item of 6.8' && !/^-+$/.test(r.item));
for (const [start, pattern] of ITEMS) {
  const row = coverageRows.find((r) => pattern.test(r.item));
  const ids = row ? namedIds(row.checks).filter((id) => !PART_HEADINGS.has(id) || rowIds.has(id)) : [];
  const missing = ids.filter((id) => !rowIds.has(id));
  check(
    `6.8 "${start}..." has a row naming checks that exist`,
    Boolean(row) && ids.length > 0 && missing.length === 0,
    row ? `${row.checks}${missing.length ? `; not in the manual: ${missing.join(', ')}` : ''}` : 'no row',
  );
}

// --- the browser shortcut table ------------------------------------------------------------------
console.log('\n[the browser shortcut table (6.8, 2.9.3)]');
const guarded = (os) => {
  const block = keysTable.slice(keysTable.indexOf('export const GUARDED_CHORDS'));
  const list = block.match(new RegExp(`${os}:\\s*\\[([^\\]]*)\\]`))?.[1] ?? '';
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const a2 = between(manual, '### A2.', '### A3.');
const kRows = [...a2.matchAll(/^\| (K\d+) \| [^|]* \| ([^|]+?) \|/gm)].map((m) => ({ id: m[1], press: m[2].trim() }));
const header = a2.split('\n').find((line) => line.startsWith('| # |')) ?? '';
check(
  'A2 has a column for Safari, Chrome and Edge',
  ['Safari', 'Chrome', 'Edge'].every((b) => header.includes(`| ${b} |`)),
  header,
);
const macChords = guarded('mac');
const missingMac = macChords.filter((chord) => !kRows.some((row) => row.press === chord));
check(
  `A2 has one row per chord the page cancels on the macOS key map (${macChords.length} in GUARDED_CHORDS.mac)`,
  missingMac.length === 0 && kRows.length === macChords.length,
  `${kRows.length} rows${missingMac.length ? `; no row for ${missingMac.join(', ')}` : ''}`,
);
const b10 = between(manual, '### B10.', '### B11.');
// "only rows K1 to K4, K6, K8, ... apply, and in K13 press F3": the rows up to "apply".
const b10Rows = namedIds((b10.match(/only rows ([^.]*?) apply/)?.[1] ?? '').replace(/ to /g, '-'));
const winChords = guarded('win');
const winRows = new Set(b10Rows);
const winPressed = kRows.filter((row) => winRows.has(row.id)).map((row) => row.press.replace(/^Cmd\+/, 'Ctrl+'));
const missingWin = winChords.filter((chord) => !winPressed.includes(chord));
check(
  `B10 names a row for each chord the page cancels on the Windows key map (${winChords.length} in GUARDED_CHORDS.win)`,
  missingWin.length === 0,
  `rows ${[...winRows].filter((id) => id.startsWith('K')).join(' ')}${missingWin.length ? `; none for ${missingWin.join(', ')}` : ''}`,
);
check(
  'Cmd+R, which the page does not cancel (keys.ts K2, 2.9.3), is explained under A2',
  !macChords.includes('Cmd+R') && /Cmd\+R is not in the table/.test(a2),
);
const form = between(manual, '## Report form', '\n```\n\n') + manual.slice(manual.indexOf('## Report form'));
const formMissingK = kRows.filter((row) => !new RegExp(`^\\s+${row.id}\\s`, 'm').test(form)).map((row) => row.id);
check('the report form has a line for every row of A2', formMissingK.length === 0, formMissingK.join(', '));

// --- the report form -----------------------------------------------------------------------------
console.log('\n[the report form]');
const partsInForm = ['### A1.', '### A3.', '### A4.', '### A5.', '### B1.', '### B2.', '### B3.', '### B7.'];
for (const heading of partsInForm) {
  const part = between(manual, heading, '\n### ');
  const ids = [...part.matchAll(/^\| ([A-Z]\d+) \|/gm)].map((m) => m[1]);
  const formBody = form.slice(form.indexOf('```'));
  const missing = ids.filter((id) => !new RegExp(`\\b${id}\\b`).test(formBody));
  check(
    `the report form has a field for every check of ${heading.slice(4)}`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${ids.length} checks`,
  );
}

// --- texts of the application that the manual quotes ---------------------------------------------
console.log('\n[texts the manual quotes, against the application]');
/** The value of `export const NAME = '...' + "..."` in a source file (string literals joined). */
function constant(path, name) {
  const source = read(...path);
  const start = source.indexOf(`export const ${name} =`);
  if (start < 0) return null;
  const body = source.slice(start, source.indexOf(';', start));
  return [...body.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)]
    .map((m) => (m[1] ?? m[2]).replace(/\\(.)/g, '$1'))
    .join('');
}
const QUOTED = [
  [
    'W0, the notice in a Safari tab',
    ['app', 'src', 'features', 'files', 'storage-notice.ts'],
    'STORAGE_NOTICE_TAB_TEXT',
  ],
  [
    'W2, the notice in the Dock app',
    ['app', 'src', 'features', 'files', 'storage-notice.ts'],
    'STORAGE_NOTICE_INSTALLED_TEXT',
  ],
  [
    'P2, the message when the browser refuses to paste',
    ['app', 'src', 'commands', 'text-field-edits.ts'],
    'PASTE_REFUSED_MAC',
  ],
];
for (const [where, path, name] of QUOTED) {
  const text = constant(path, name);
  check(
    `${where} (${name}) is quoted in the manual as the application shows it`,
    Boolean(text) && manual.includes(text),
    text ? JSON.stringify(text) : `${name} not found in ${path.join('/')}`,
  );
}
const caution = constant(['app', 'src', 'features', 'run', 'session.ts'], 'CAUTION_TEXT');
check(
  'the box after Execute while a program is loaded and not halted ("Caution") is mentioned in the manual, which runs three programs one after the other',
  Boolean(caution) && manual.includes(caution),
  JSON.stringify(caution),
);

// --- first start: README and manual --------------------------------------------------------------
console.log('\n[the first start of the Mac app]');
const block = (text) => between(text, '<!-- first-start:begin -->', '<!-- first-start:end -->');
check(
  'the first-start text of the README and of the manual (B3) are the same',
  block(readme).length > 200 && block(readme) === block(manual),
  `${block(readme).length} and ${block(manual).length} characters`,
);

console.log(`\n${passed} of ${passed + failed} checks passed${failed ? `, ${failed} failed` : ''}.`);
console.log(
  'Open for a person: working through docs/MANUAL-TEST-MAC.md on a real Mac for the release candidate (needs a downloadable build for part B3).',
);
process.exitCode = failed ? 1 : 0;
