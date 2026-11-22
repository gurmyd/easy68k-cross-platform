# Request from DOC1: keep the documents true (a check), and prove the README on macOS and Windows

Status: applied in the round that prepares gate I3 (config), all three items. (1)
`tools/make-differences.mjs` and `tools/check-docs.test.mjs` as below, word for word, then formatted
with Prettier. (2) Root script `check:docs` and the step "Documents (DOC1)" in the job `check`. (3) A
job `readme` on macos-latest and windows-latest that runs the README's commands one step each, on the
weekly schedule and on a manual run with the input `readme` ticked (errata W0.md entry 9). DOC1's
addition below (two more tests) is adopted too: `npm run check:docs` gives 14 of 14 on this round's
tree, and `node tools/make-differences.mjs --check` says "up to date". The help page
`Port/differences.htm` is not covered by the check and still has to be renewed by H1 or the
orchestrator.

**Addition by DOC1 in the same round (for the configuration engineer):** `tools/check-docs.test.mjs`
below now has two more tests, "the manual list carries the same first-start steps as the README and
DV3" and "every section the coverage table names is about the topic of its row" (the review of DOC1
found a stale section number, B8 for B10, that the old tests let through). Please copy the file
below over `tools/check-docs.test.mjs` once more; `tools/make-differences.mjs` is unchanged. Both
tests pass on this round's documents (14 of 14 with the copy in `build/DOC1`), and the second fails
when the stale number is put back. `docs/DIFFERENCES.md` is rebuilt (W1's and DV4's fragments are
in it, and a hand-written part 5, "Known limitations", which the script keeps like parts 3 and 4).
The help page `Port/differences.htm` still has to be renewed by H1 or the orchestrator.

DOC1 owns no code path (section 8 gives it only documents), so its tools and their test live in
`build/DOC1/` on the machine where DOC1 ran, which is not in Git. This request asks the gate to
adopt them, and to add one CI job. Nothing in it needs a new dependency.

## 1. Two scripts under `tools/`

- `tools/make-differences.mjs` (below): rebuilds parts 1 and 2 of `docs/DIFFERENCES.md` from
  section 1.4 and 1.5 of `docs/ARCHITECTURE.md` and every `docs/differences/<ID>.md`, word for word;
  the introduction and parts 3 and 4 are kept as they are written in `DIFFERENCES.md`. `--check`
  compares instead of writing. Run it whenever a fragment or note 1.4 changes, then
  `npm run import:help` (H1 erratum 5) for the help page `Port/differences.htm`.
- `tools/check-docs.test.mjs` (below): Node's own test runner, no dependency. It fails when
  `DIFFERENCES.md` is not what the script builds, when a note of 1.4 or a line of a fragment is
  missing, when the README's first-start section differs from `docs/differences/DV3.md`'s (the one
  `desktop/scripts/release.mjs` puts into the release notes) or the generated notes lack the steps
  of section 11, when the manual list lacks an item of 6.8, a chord of the browser shortcut table or
  a press of `docs/requests/W3-key-recording.md`, when a relative link of the six documents goes
  nowhere, when a document names an npm script that does not exist, when the times of part A of
  the manual list add up to more than the page promises, when `CONTRIBUTING.md` says on which
  systems the CI runs what differently from the matrices of `ci.yml`, and when the generator
  accepts an argument it does not know (it used to treat `--help` as "write").

Both were run on this machine from `build/DOC1/` (12 of 12 tests passed in DOC1's repair round 1);
the copies below differ from those only in the repository-root line (`'..'` instead of
`'..', '..'`), the path of `release.mjs` and the paths in the comments.

Why it matters: the verifier of DOC1 found the part A time and the CONTRIBUTING sentence wrong by
reading; nothing in CI would have found them, and nothing stops `DIFFERENCES.md`, the README's
first-start section and `docs/differences/DV3.md` from drifting apart until this check runs in CI.
DOC1 cannot add it itself: `tools/`, the root `package.json` and `ci.yml` are not DOC1's paths.

## 2. A root script and a CI step

- `"check:docs": "node --test tools/check-docs.test.mjs"` in the root `package.json`.
- In `ci.yml`, job `check`: a step `Documents (DOC1)`: `npm run check:docs`. About one second.

## 3. The README, literally, on macOS and Windows

No job follows the README from start to end on macOS or Windows today: the engines are built on
Ubuntu only and downloaded by every other job, and typecheck and lint run on Ubuntu only
(`docs/porting/errata/DOC1.md` entry 3). A job `readme (macos-latest)` and `readme
(windows-latest)`, on a manual run and weekly (it installs Emscripten, about 3 minutes, and the
browsers), that runs exactly the commands of the README's `sh` blocks after the checkout, in the
working copy instead of `git clone`/`cd`: `npm ci`, `npm run setup:emsdk`,
`npm run build:engines`, `npm test`, `npm run typecheck`, `npm run lint`,
`npm run test:conformance`, `npx playwright install --with-deps chromium webkit`,
`npm run build`, `npm run test:e2e`. DOC1 ran the same commands on Linux in a clean
`node:24` container (its result has the logs); this job would add the two other systems.

## `tools/make-differences.mjs`

```js
#!/usr/bin/env node
// Builds docs/DIFFERENCES.md from section 1.4 (and the list of additions in
// 1.5) of docs/ARCHITECTURE.md and every fragment docs/differences/<ID>.md, as ARCHITECTURE.md
// section 8 asks ("DOC1 builds docs/DIFFERENCES.md from these and from 1.4").
//
//     node tools/make-differences.mjs [--check]
//
// The notes and the fragments are copied word for word; only the fragments' headings move down
// two levels so that they sit under this document's headings, and the two HTML comment lines of
// DV3's fragment (the marks release.mjs reads) are left out, because the help page's Markdown
// renderer would show them as text. --check compares instead of writing and exits 1 on a
// difference (used by the test).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function section(markdown, startHeading, endHeading) {
  const start = markdown.indexOf(`\n${startHeading}\n`);
  const end = markdown.indexOf(`\n${endHeading}\n`, start + 1);
  if (start < 0 || end < 0) throw new Error(`cannot find "${startHeading}" .. "${endHeading}"`);
  return markdown.slice(start + startHeading.length + 2, end).trim();
}

/** Package order: as section 9 lists the waves, then alphabetical for anything else. */
const ORDER = ['W1', 'W2', 'W3', 'W4', 'FS1', 'E1', 'E2', 'E3', 'SH1', 'SH3', 'SH4', 'SH7', 'SH8', 'U1', 'U2', 'H1',
  'E4', 'E5', 'E6', 'FS2', 'SH2', 'SH5', 'SH6', 'U3', 'U4', 'T1', 'T2', 'T3', 'T4', 'DV1', 'DV2', 'DV3', 'B1', 'X1',
  'DV4', 'DV5', 'X2', 'X3', 'P1', 'Q1', 'I3'];

export function fragmentIds(dir) {
  const ids = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  return ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A fragment as it appears in DIFFERENCES.md: its title (the first `# ` heading) becomes a
 * `### ` heading, its other headings move down two levels, the HTML comment lines go.
 */
export function embedFragment(text) {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !/^<!--.*-->\s*$/.test(line));
  let titled = false;
  // A fenced code block indented under a list item loses its indentation: the help page's
  // renderer (tools/import-help.mjs) knows fences only at the start of a line.
  let fenceIndent = null;
  return lines
    .map((line) => {
      const fence = /^(\s+)```/.exec(line);
      if (fenceIndent === null && fence) {
        fenceIndent = fence[1];
        return line.slice(fenceIndent.length);
      }
      if (fenceIndent !== null) {
        if (/^\s*```/.test(line)) {
          const out = line.trimStart();
          fenceIndent = null;
          return out;
        }
        return line.startsWith(fenceIndent) ? line.slice(fenceIndent.length) : line;
      }
      if (!titled && /^#\s/.test(line)) {
        titled = true;
        return `##${line}`;
      }
      return /^#{1,4}\s/.test(line) ? `##${line}` : line;
    })
    .join('\n')
    .trim();
}

export function build(repoRoot) {
  const arch = readFileSync(join(repoRoot, 'docs', 'ARCHITECTURE.md'), 'utf8').replace(/\r\n?/g, '\n');
  const notes = section(arch, '### 1.4 Notes on changes and drops', '### 1.5 Additions (none changes program behaviour)');
  const additions = section(arch, '### 1.5 Additions (none changes program behaviour)', '---');
  // The introduction (before part 1) and parts 3 and 4 are written by hand in DIFFERENCES.md itself;
  // only parts 1 and 2 are rebuilt.
  const current = readFileSync(join(repoRoot, 'docs', 'DIFFERENCES.md'), 'utf8').replace(/\r\n?/g, '\n');
  const PART1 = '\n## 1. Changes decided in the design\n';
  const PART3 = '\n## 3. Shortcuts a browser does not give up\n';
  if (!current.includes(PART1) || !current.includes(PART3)) throw new Error('DIFFERENCES.md lacks the headings of parts 1 and 3');
  const head = current.slice(0, current.indexOf(PART1)).trim();
  const tail = current.slice(current.indexOf(PART3)).trim();
  const dir = join(repoRoot, 'docs', 'differences');
  const parts = [head, '', '## 1. Changes decided in the design', '',
    'Copied from section 1.4 of `docs/ARCHITECTURE.md`. The note numbers are the ones the rest of this',
    'document and the specifications refer to ("note 12").', '', notes, '',
    '### Additions', '', 'Copied from section 1.5 of `docs/ARCHITECTURE.md`. None of them changes what a program does.', '',
    additions, '', '## 2. Differences recorded by each part of the port', '',
    'Each part of the port records the differences it introduced in `docs/differences/<part>.md`. They are',
    'copied here word for word, in the order the parts were built. The part names (W2, SH4 and so on) are',
    'the work packages of `docs/ARCHITECTURE.md` section 9.', ''];
  for (const id of fragmentIds(dir)) {
    const embedded = embedFragment(readFileSync(join(dir, `${id}.md`), 'utf8'));
    const [first, ...rest] = embedded.split('\n');
    if (!/^### /.test(first)) throw new Error(`docs/differences/${id}.md does not start with a "# " title`);
    parts.push(first, '', `(\`docs/differences/${id}.md\`)`, ...rest, '');
  }
  parts.push(tail, '');
  return parts.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--check')) {
    console.error('usage: node make-differences.mjs [--check]  (writes docs/DIFFERENCES.md; --check only compares)');
    process.exit(2);
  }
  const out = join(repo, 'docs', 'DIFFERENCES.md');
  const text = build(repo);
  if (process.argv.includes('--check')) {
    const now = readFileSync(out, 'utf8').replace(/\r\n?/g, '\n');
    if (now !== text) {
      console.error('docs/DIFFERENCES.md is not what make-differences.mjs builds');
      process.exit(1);
    }
    console.log('docs/DIFFERENCES.md is up to date');
  } else {
    writeFileSync(out, text);
    console.log(`wrote docs/DIFFERENCES.md (${text.split('\n').length} lines, ${fragmentIds(join(repo, 'docs', 'differences')).length} fragments)`);
  }
}
```

## `tools/check-docs.test.mjs`

```js
// DOC1: tests of the documentation package (README.md, CHANGELOG.md, docs/DIFFERENCES.md,
// docs/USER-GUIDE.md, docs/CONTRIBUTING.md, docs/MANUAL-TEST-MAC.md).
//
//     node --test tools/check-docs.test.mjs
//
// Node's own test runner, no dependencies. What it holds the documents to:
//   - DIFFERENCES.md is exactly what make-differences.mjs builds: every note of 1.4, the additions
//     of 1.5, every fragment docs/differences/<ID>.md (each of their lines is in it);
//   - the README's first-start section is DV3's, which desktop/scripts/release.mjs copies into the
//     release notes, and the generated notes carry the Gatekeeper steps of section 11;
//   - the manual list has every item of 6.8 (its coverage table), the browser shortcut table with
//     every chord 6.8 names, and every press of docs/requests/W3-key-recording.md;
//   - every relative link of the six documents points to a file that exists;
//   - every npm script the README names exists in package.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, embedFragment, fragmentIds, section } from './make-differences.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(repo, path), 'utf8').replace(/\r\n?/g, '\n');
const DOCS = ['README.md', 'CHANGELOG.md', 'docs/DIFFERENCES.md', 'docs/USER-GUIDE.md', 'docs/CONTRIBUTING.md', 'docs/MANUAL-TEST-MAC.md'];

test('DIFFERENCES.md is what make-differences.mjs builds', () => {
  assert.equal(read('docs/DIFFERENCES.md'), build(repo));
});

test('DIFFERENCES.md holds every note of 1.4, numbered 1 to the last, word for word', () => {
  const arch = read('docs/ARCHITECTURE.md');
  const notes = section(arch, '### 1.4 Notes on changes and drops', '### 1.5 Additions (none changes program behaviour)');
  const numbers = [...notes.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
  assert.ok(numbers.length >= 46, `1.4 has ${numbers.length} notes`);
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  const differences = read('docs/DIFFERENCES.md');
  for (const line of notes.split('\n')) assert.ok(differences.includes(line), `missing from DIFFERENCES.md: ${line}`);
});

test('DIFFERENCES.md holds every fragment, every line of it', () => {
  const differences = read('docs/DIFFERENCES.md');
  const ids = fragmentIds(join(repo, 'docs', 'differences'));
  assert.ok(ids.length >= 27, `${ids.length} fragments`);
  for (const id of ids) {
    const embedded = embedFragment(read(`docs/differences/${id}.md`));
    assert.ok(differences.includes(embedded.split('\n').slice(1).join('\n').trim()), `fragment ${id} is not in DIFFERENCES.md word for word`);
    assert.ok(differences.includes(`(\`docs/differences/${id}.md\`)`), `fragment ${id} is not named`);
  }
});

const firstStart = (text) => {
  const begin = text.indexOf('<!-- first-start:begin -->');
  const end = text.indexOf('<!-- first-start:end -->');
  assert.ok(begin >= 0 && end > begin, 'first-start marks');
  return text.slice(begin, end);
};

test('the README carries the first-start steps of section 11, the same text as the release notes', async () => {
  const readme = read('README.md');
  assert.equal(firstStart(readme), firstStart(read('docs/differences/DV3.md')));
  for (const phrase of ['Privacy & Security', 'Open Anyway', 'xattr -dr com.apple.quarantine /Applications/EASy68K.app', 'use the web version instead']) {
    assert.ok(readme.includes(phrase), phrase);
  }
  const { releaseNotes, firstStartSection } = await import('../desktop/scripts/release.mjs');
  const notes = releaseNotes('0.0.0', firstStartSection(read('docs/differences/DV3.md')), '13.0');
  assert.ok(notes.includes('## Opening the Mac app for the first time'));
  for (const phrase of ['Open Anyway', 'xattr -dr com.apple.quarantine /Applications/EASy68K.app']) assert.ok(notes.includes(phrase), phrase);
});

test('the manual list carries the same first-start steps as the README and DV3', () => {
  assert.equal(firstStart(read('docs/MANUAL-TEST-MAC.md')), firstStart(read('docs/differences/DV3.md')));
});

/**
 * The sections (### headings) of the manual list that the coverage table may name, and the topic
 * each row that names one is about: a section a row names must have that topic in its title. This
 * catches a stale number after the sections were renumbered (review of DOC1, wave three: the
 * shortcut row named B8, "A long session in Safari", instead of B10).
 */
const COVERAGE_TOPICS = [
  { row: /^Browser shortcut table/, title: /shortcut/i },
  { row: /^Keyboard on a real MacBook/, title: /keyboard|layout/i },
  { row: /^Safari itself/, title: /Safari|first program/i },
  { row: /^Full screen/, title: /full screen/i },
  { row: /^Printing/, title: /print/i },
  { row: /^A serial adapter/, title: /serial|network|Mac app/i },
  { row: /^VoiceOver/, title: /VoiceOver/i },
  { row: /^A long session/, title: /long session/i },
  { row: /W3-key-recording/, title: /record|keyboard/i },
  { row: /FS2\.md/, title: /folder/i },
  { row: /DOC1\.md/, title: /README/i },
];

test('every section the coverage table names is about the topic of its row', () => {
  const manual = read('docs/MANUAL-TEST-MAC.md');
  const titles = Object.fromEntries([...manual.matchAll(/^### ([A-Z]\d+)\. (.*)$/gm)].map((m) => [m[1], m[2]]));
  const coverage = manual.slice(manual.indexOf('## Which check covers which item of the plan'));
  const rows = coverage.split('\n').filter((line) => /^\| (?!Item|---|From)/.test(line));
  for (const row of rows) {
    const [first, checks] = row.split('|').slice(1, 3).map((cell) => cell.trim());
    const sections = [...checks.matchAll(/\b([A-Z]\d+)\b(?!-)/g)].map((m) => m[1]).filter((id) => id in titles);
    if (sections.length === 0) continue;
    const topic = COVERAGE_TOPICS.find((entry) => entry.row.test(first));
    assert.ok(topic, `coverage row "${first.slice(0, 60)}" names ${sections.join(', ')}: add its topic to COVERAGE_TOPICS`);
    for (const id of sections) assert.match(titles[id], topic.title, `row "${first.slice(0, 40)}" names ${id}, "${titles[id]}"`);
  }
});

test('the README says nothing that is not true today', () => {
  const readme = read('README.md');
  for (const phrase of ['work in progress', 'There is no macOS app to', 'No person has tried it on a Mac yet', 'not been released yet']) {
    assert.ok(readme.includes(phrase), phrase);
  }
  assert.ok(!/\bv?\d+\.\d+\.\d+ (is|has been) released/i.test(readme), 'announces a release');
  for (const phrase of ['Tim Larson', 'Paul McKee', 'Charles Kelly', 'Eric Nelson', 'GNU General Public License, version 2']) assert.ok(readme.includes(phrase), phrase);
});

test('the manual list has every item of 6.8 and the browser shortcut table', () => {
  const manual = read('docs/MANUAL-TEST-MAC.md');
  const arch = read('docs/ARCHITECTURE.md');
  const items = section(arch, '### 6.8 What only a person can check', '### 6.9 Definition of done')
    .split('\n')
    .filter((line) => /^- /.test(line));
  assert.equal(items.length, 15, '6.8 has 12 Mac items and 3 Windows items');
  const coverage = manual.slice(manual.indexOf('## Which check covers which item of the plan'));
  const rows = coverage.split('\n').filter((line) => /^\| (?!Item|---|From)/.test(line));
  // 11 Mac rows + one row for the three Windows items + 7 rows of the packages' items
  assert.ok(rows.length >= 19, `${rows.length} rows`);
  const keyPhrase = ['Gatekeeper', 'Finder', 'Sound', 'Browser shortcut table', 'Keyboard on a real MacBook', 'Paste into a task 2 prompt', 'Full screen', 'Printing', 'serial adapter', 'VoiceOver', 'Safari itself', 'long session', 'real Windows'];
  for (const phrase of keyPhrase) assert.ok(rows.some((row) => row.toLowerCase().includes(phrase.toLowerCase())), `coverage row for "${phrase}"`);
  // Every check named in the coverage table exists as a row of a table above it.
  for (const row of rows) {
    for (const [, letter, from, to] of row.matchAll(/(?<=[\s,|])([A-Z])(\d+)(?:-[A-Z]?(\d+))?(?=[\s,|])/g)) {
      for (let n = Number(from); n <= Number(to ?? from); n++) {
        assert.ok(manual.includes(`| ${letter}${n} |`) || manual.includes(`### ${letter}${n}. `), `check ${letter}${n} named in the coverage table does not exist`);
      }
    }
  }
  for (const chord of ['F5', 'F6', 'F7', 'F10', 'Cmd+S', 'Ctrl+S', 'Cmd+P', 'Ctrl+P', 'Cmd+O', 'Ctrl+O', 'Cmd+F', 'Ctrl+F', 'Cmd+G', 'Ctrl+G', 'Ctrl+R']) {
    assert.ok(new RegExp(`\\| K\\d+ \\| [^|]+ \\| ${chord.replace('+', '\\+')} \\|`).test(manual), `shortcut row for ${chord}`);
  }
  for (const browser of ['Safari', 'Chrome', 'Edge']) assert.ok(manual.includes(`| ${browser} |`) || manual.includes(` ${browser} | `), browser);
});

test('the manual list has every press of the key-recording request', () => {
  const manual = read('docs/MANUAL-TEST-MAC.md');
  const request = read('docs/requests/W3-key-recording.md');
  const rows = request.split('\n').filter((line) => /^\| (Mac|Windows|the same)/.test(line));
  assert.equal(rows.length, 8);
  for (const row of rows) {
    const presses = row.split('|')[2].trim();
    for (const press of presses.split(/, (?![^()]*\))/)) {
      const flat = (s) => s.replace(/[;:]/g, ' ').replace(/\s+/g, ' ').trim();
      const words = flat(press);
      assert.ok(flat(manual).includes(words.split(' with the system')[0].trim()), `press "${words}" is not in the manual list`);
    }
  }
  assert.ok(manual.includes("console.log(JSON.stringify({ key, code, ctrlKey, altKey, shiftKey, metaKey }));"), 'the recorder');
});

test('every relative link of the documents points to a file that exists', () => {
  for (const doc of DOCS) {
    const text = read(doc);
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = join(repo, dirname(doc), target.replace(/#.*$/, ''));
      assert.ok(existsSync(path), `${doc}: link to ${target} goes nowhere`);
    }
  }
});

test('every npm script the README and CONTRIBUTING name exists', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const doc of ['README.md', 'docs/CONTRIBUTING.md', 'docs/USER-GUIDE.md']) {
    for (const [, name] of read(doc).matchAll(/npm run ([a-z][\w:-]*)/g)) {
      if (name.endsWith(':')) continue; // "npm run check:<name>"
      assert.ok(name in scripts, `${doc}: npm run ${name} does not exist`);
    }
  }
});

test('part A of the manual list fits the time it promises', () => {
  const manual = read('docs/MANUAL-TEST-MAC.md');
  const promise = /about \*\*(\w+) minutes for part A\*\*/.exec(manual);
  assert.ok(promise, 'the promise "about **N minutes for part A**"');
  const WORDS = { ten: 10, fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30 };
  const promised = WORDS[promise[1]];
  assert.ok(promised, `unknown number word ${promise[1]}`);
  const partA = manual.slice(manual.indexOf('## Part A'), manual.indexOf('## Part B'));
  const times = [...partA.matchAll(/^### A\d+\. .*\((\d+) minutes?\)$/gm)].map((m) => Number(m[1]));
  const headings = [...partA.matchAll(/^### A\d+\. /gm)].length;
  assert.equal(times.length, headings, 'every section of part A states its time');
  const sum = times.reduce((a, b) => a + b, 0);
  assert.ok(sum <= promised, `part A sections add up to ${sum} minutes, the page promises ${promised}`);
  // A wait written into a row may not be longer than its section's time.
  for (const [, title, minutes, body] of partA.matchAll(/^### (A\d+)\. .*\((\d+) minutes?\)$([\s\S]*?)(?=^### |$(?![\s\S]))/gm)) {
    for (const [, n, unit] of body.matchAll(/wait (\w+) (minutes?|seconds?)/g)) {
      const value = /^\d+$/.test(n) ? Number(n) : { one: 1, two: 2, three: 3, five: 5 }[n] ?? 0;
      const waitMinutes = unit.startsWith('minute') ? value : value / 60;
      assert.ok(waitMinutes < Number(minutes), `${title} waits ${n} ${unit} inside ${minutes} minutes`);
    }
  }
});

/** The `os:` list of each job's matrix in ci.yml, or its single `runs-on` system. */
function ciSystems() {
  const ci = read('.github/workflows/ci.yml');
  const jobs = {};
  let job = null;
  for (const line of ci.split('\n')) {
    const head = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (head) { job = head[1]; jobs[job] = []; continue; }
    if (!job) continue;
    const list = /^\s+os: \[([^\]]*)\]/.exec(line);
    if (list) jobs[job] = list[1].split(',').map((s) => s.trim());
    const runsOn = /^\s+runs-on: ([\w.-]+)\s*$/.exec(line);
    if (runsOn && jobs[job].length === 0) jobs[job] = [runsOn[1]];
  }
  const family = (os) => (os.startsWith('ubuntu') ? 'Linux' : os.startsWith('macos') ? 'macOS' : os.startsWith('windows') ? 'Windows' : os);
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, [...new Set(v.map(family))].sort()]));
}

test('CONTRIBUTING says on which systems the CI runs what, as ci.yml does', () => {
  const systems = ciSystems();
  const contributing = read('docs/CONTRIBUTING.md').replace(/\s+/g, ' ');
  assert.deepEqual(systems.check, ['Linux'], 'job check');
  assert.deepEqual(systems.unit, ['Linux', 'Windows', 'macOS'], 'job unit');
  assert.deepEqual(systems.conformance, ['Linux', 'macOS'], 'job conformance');
  assert.deepEqual(systems.e2e, ['Linux', 'Windows', 'macOS'], 'job e2e');
  assert.deepEqual(systems['browser-checks'], ['Linux', 'Windows', 'macOS'], 'job browser-checks');
  assert.ok(contributing.includes('runs the type check, lint and the format check on Linux;'), 'type check and lint: Linux');
  assert.ok(contributing.includes('the unit tests, the engines\' suites, the browser checks and the end-to-end tests on Linux, macOS and Windows;'), 'unit, engines, browser checks, e2e: three systems');
  assert.ok(contributing.includes('the conformance tests on Linux and macOS'), 'conformance: Linux and macOS');
});

test('make-differences.mjs refuses an argument it does not know, and writes nothing', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = fileURLToPath(new URL('./make-differences.mjs', import.meta.url));
  const before = read('docs/DIFFERENCES.md');
  const run = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0, 'exit status for --help');
  assert.match(run.stdout + run.stderr, /usage/i);
  assert.equal(read('docs/DIFFERENCES.md'), before);
});`