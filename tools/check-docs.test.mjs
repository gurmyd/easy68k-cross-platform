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
const DOCS = [
  'README.md',
  'CHANGELOG.md',
  'docs/DIFFERENCES.md',
  'docs/USER-GUIDE.md',
  'docs/CONTRIBUTING.md',
  'docs/MANUAL-TEST-MAC.md',
];

test('DIFFERENCES.md is what make-differences.mjs builds', () => {
  assert.equal(read('docs/DIFFERENCES.md'), build(repo));
});

test('DIFFERENCES.md holds every note of 1.4, numbered 1 to the last, word for word', () => {
  const arch = read('docs/ARCHITECTURE.md');
  const notes = section(
    arch,
    '### 1.4 Notes on changes and drops',
    '### 1.5 Additions (none changes program behaviour)',
  );
  const numbers = [...notes.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
  assert.ok(numbers.length >= 46, `1.4 has ${numbers.length} notes`);
  assert.deepEqual(
    numbers,
    numbers.map((_, i) => i + 1),
  );
  const differences = read('docs/DIFFERENCES.md');
  for (const line of notes.split('\n')) assert.ok(differences.includes(line), `missing from DIFFERENCES.md: ${line}`);
});

test('DIFFERENCES.md holds every fragment, every line of it', () => {
  const differences = read('docs/DIFFERENCES.md');
  const ids = fragmentIds(join(repo, 'docs', 'differences'));
  assert.ok(ids.length >= 27, `${ids.length} fragments`);
  for (const id of ids) {
    const embedded = embedFragment(read(`docs/differences/${id}.md`));
    assert.ok(
      differences.includes(embedded.split('\n').slice(1).join('\n').trim()),
      `fragment ${id} is not in DIFFERENCES.md word for word`,
    );
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
  for (const phrase of [
    'Privacy & Security',
    'Open Anyway',
    'xattr -dr com.apple.quarantine /Applications/EASy68K.app',
    'use the web version instead',
  ]) {
    assert.ok(readme.includes(phrase), phrase);
  }
  const { releaseNotes, firstStartSection } = await import('../desktop/scripts/release.mjs');
  const notes = releaseNotes('0.0.0', firstStartSection(read('docs/differences/DV3.md')), '13.0');
  assert.ok(notes.includes('## Opening the Mac app for the first time'));
  for (const phrase of ['Open Anyway', 'xattr -dr com.apple.quarantine /Applications/EASy68K.app'])
    assert.ok(notes.includes(phrase), phrase);
  // Near the top of the notes: ad hoc, not notarised, tested automatically, and nobody has worked
  // through the manual checks (release 1.0.0, the owner's decisions of 22 November 2026).
  const top = notes.slice(0, notes.indexOf('## Downloads')).replace(/\s+/g, ' ');
  for (const phrase of [
    'signed ad hoc and not notarised',
    'tested automatically',
    'no person has worked through the manual checks of [docs/MANUAL-TEST-MAC.md]',
    'https://github.com/gurmyd/easy68k-cross-platform/issues',
  ])
    assert.ok(top.includes(phrase), phrase);
  assert.deepEqual(handsOnClaims(notes), [], 'the release notes claim that a person tried it');
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
    const [first, checks] = row
      .split('|')
      .slice(1, 3)
      .map((cell) => cell.trim());
    const sections = [...checks.matchAll(/\b([A-Z]\d+)\b(?!-)/g)].map((m) => m[1]).filter((id) => id in titles);
    if (sections.length === 0) continue;
    const topic = COVERAGE_TOPICS.find((entry) => entry.row.test(first));
    assert.ok(
      topic,
      `coverage row "${first.slice(0, 60)}" names ${sections.join(', ')}: add its topic to COVERAGE_TOPICS`,
    );
    for (const id of sections)
      assert.match(titles[id], topic.title, `row "${first.slice(0, 40)}" names ${id}, "${titles[id]}"`);
  }
});

/**
 * The sentences of a text that claim that a person tried the port where only a person can (a Mac,
 * Safari itself, a screen reader, a printer, a serial adapter, the manual list), as messages; empty
 * when there is none. A sentence that says it was NOT done (no person, nobody, not, never, yet ...)
 * is no claim. Release 1.0.0 is published before anyone has made the checks of ARCHITECTURE.md 6.8
 * (the owner's decisions of 22 November 2026), so no document may say otherwise.
 */
export function handsOnClaims(text) {
  const WHERE =
    /\b(real Mac|on (a|their|my|our|your) Mac|MacBook|Safari itself|in (real )?Safari|VoiceOver|NVDA|screen reader|real printer|a printer|serial adapter|MANUAL-TEST-MAC|manual (checks|list|test))\b/i;
  const DONE =
    /\b(tried|tested|used|checked|verified|confirmed|worked through|signed off|walked through|completed)\b|\bby (hand|a person|people|students|users|testers|volunteers)\b|\bhands-on\b/i;
  const NOT =
    /\b(no|not|nobody|no one|none|never|neither|nor|yet|until|unless|only a person|cannot|can't|has to|must|needs?|please|if you|a step of|engines? of (Chrome|Safari)|Playwright's)\b/i;
  return text
    .replace(/\r\n?/g, '\n')
    .split(/(?<=[.!?])\s+|\n\s*\n|\n(?=\s*[-*>] )/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => WHERE.test(sentence) && DONE.test(sentence) && !NOT.test(sentence));
}

test('the README says nothing that is not true at the release', () => {
  const readme = read('README.md');
  for (const phrase of [
    // What no person has tried, where a reader looks first (before "What it is").
    'No person has tried it on a Mac yet.',
    // Where to get it: the web version first, then the Releases page.
    'https://gurmyd.github.io/easy68k-cross-platform/',
    'https://github.com/gurmyd/easy68k-cross-platform/releases',
    'docs/MANUAL-TEST-MAC.md',
  ]) {
    assert.ok(readme.includes(phrase), phrase);
  }
  const top = readme.slice(0, readme.indexOf('## What it is'));
  assert.ok(top.includes('No person has tried it on a Mac yet.'), 'what no person has tried, at the top');
  assert.ok(
    top.indexOf('https://gurmyd.github.io/easy68k-cross-platform/') <
      top.indexOf('https://github.com/gurmyd/easy68k-cross-platform/releases'),
    'the web version is named before the Mac download',
  );
  for (const stale of ['work in progress', 'There is no macOS app to', 'not been released yet', 'No release has been'])
    assert.ok(!readme.includes(stale), `still says "${stale}"`);
  assert.deepEqual(handsOnClaims(readme), [], 'the README claims that a person tried it');
  for (const phrase of [
    'Tim Larson',
    'Paul McKee',
    'Charles Kelly',
    'Eric Nelson',
    'GNU General Public License, version 2',
  ])
    assert.ok(readme.includes(phrase), phrase);
});

test('a claim that a person tried the port is found, a statement that nobody did is not', () => {
  for (const claim of [
    'The app was tested on a real Mac.',
    'We checked it with VoiceOver and it reads every menu.',
    'Students have used it on their Mac for a term.',
    'The manual checks were worked through on 23 November.',
    'Printing was tried on a real printer.',
  ])
    assert.equal(handsOnClaims(`Intro.\n\n${claim}\n`).length, 1, claim);
  for (const denial of [
    'No person has tried it on a Mac yet.',
    'Nobody has tried the port on a real Mac, in Safari itself, with a screen reader.',
    'The checks that only a person can make (docs/MANUAL-TEST-MAC.md) have not been worked through by anyone.',
    'If you try any of these, the page says what to do.',
  ])
    assert.deepEqual(handsOnClaims(denial), [], denial);
  // The README with one hands-on claim added fails the README test's condition.
  const broken = `${read('README.md')}\nThe Mac app was tested on a real Mac by the maintainer.\n`;
  assert.equal(handsOnClaims(broken).length, 1);
});

/**
 * Phrases that were true before release 1.0.0 and are not after it, as patterns that match across
 * line breaks (a phrase broken over two lines hid one in docs/CONTRIBUTING.md: review of the
 * release preparation, gate 3).
 */
const STALE_BEFORE_RELEASE = [
  /\bno\s+release\s+exists\b/i,
  /\bno\s+release\s+(and\s+no\s+pre-release\s+)?(yet|has\s+been)\b/i,
  /\bafter\s+the\s+manual\s+test\b/i,
  /\bnot\s+been\s+released\s+yet\b/i,
  /\bno\s+(macOS|Mac)\s+app\s+to\s+download\b/i,
  /\b(until|once|only\s+once)\s+a\s+release\s+exists\b/i,
  /\bthere\s+is\s+nothing\s+to\s+download\b/i,
  /\bwork\s+in\s+progress\b/i,
  /\bno\s+version\s+of\s+the\s+port\s+has\s+been\s+released\b/i,
  /\bmoves\s+from\s+"Not\s+released\s+yet"/i,
];

/** The stale phrases a text contains, each with a little context; empty when none. */
export function stalePhrases(text) {
  const flat = text.replace(/\s+/g, ' ');
  return STALE_BEFORE_RELEASE.flatMap((pattern) => {
    const m = pattern.exec(flat);
    return m ? [`${pattern}: ...${flat.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)}...`] : [];
  });
}

/** The README and every Markdown document of the repository it links to. */
function readmeAndItsDocuments() {
  const readme = read('README.md');
  const linked = [...readme.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1]);
  return ['README.md', ...new Set(linked)];
}

test('no document the README links to says what was true only before the release', () => {
  const docs = readmeAndItsDocuments();
  assert.ok(docs.includes('docs/CONTRIBUTING.md') && docs.length >= 7, docs.join(', '));
  for (const doc of docs) assert.deepEqual(stalePhrases(read(doc)), [], doc);
  // A phrase broken over two lines is found, as CONTRIBUTING.md had it before the release.
  assert.equal(stalePhrases('downloads it from the latest release. No\nrelease exists yet, so').length, 1);
  assert.equal(stalePhrases('published by a\n  maintainer after the manual\ntest.').length, 1);
  assert.deepEqual(stalePhrases('Release 1.0.0 was published before a person had worked through it.'), []);
});

test('the other documents claim no hands-on test either', () => {
  for (const doc of ['CHANGELOG.md', 'docs/USER-GUIDE.md', 'docs/MANUAL-TEST-MAC.md'])
    assert.deepEqual(handsOnClaims(read(doc)), [], doc);
});

test('the manual list has every item of 6.8 and the browser shortcut table', () => {
  const manual = read('docs/MANUAL-TEST-MAC.md');
  const arch = read('docs/ARCHITECTURE.md');
  const items = section(arch, '### 6.8 What only a person can check', '### 6.9 Definition of done')
    .split('\n')
    .filter((line) => /^- /.test(line));
  assert.equal(items.length, 16, '6.8 has 12 Mac items, 3 Windows items and the PDF viewer item of the additions');
  const coverage = manual.slice(manual.indexOf('## Which check covers which item of the plan'));
  const rows = coverage.split('\n').filter((line) => /^\| (?!Item|---|From)/.test(line));
  // 11 Mac rows + one row for the three Windows items + 7 rows of the packages' items
  assert.ok(rows.length >= 19, `${rows.length} rows`);
  const keyPhrase = [
    'Gatekeeper',
    'Finder',
    'Sound',
    'Browser shortcut table',
    'Keyboard on a real MacBook',
    'Paste into a task 2 prompt',
    'Full screen',
    'Printing',
    'serial adapter',
    'VoiceOver',
    'Safari itself',
    'long session',
    'real Windows',
    'PDF viewer',
  ];
  for (const phrase of keyPhrase)
    assert.ok(
      rows.some((row) => row.toLowerCase().includes(phrase.toLowerCase())),
      `coverage row for "${phrase}"`,
    );
  // Every check named in the coverage table exists as a row of a table above it.
  for (const row of rows) {
    for (const [, letter, from, to] of row.matchAll(/(?<=[\s,|])([A-Z])(\d+)(?:-[A-Z]?(\d+))?(?=[\s,|])/g)) {
      for (let n = Number(from); n <= Number(to ?? from); n++) {
        assert.ok(
          manual.includes(`| ${letter}${n} |`) || manual.includes(`### ${letter}${n}. `),
          `check ${letter}${n} named in the coverage table does not exist`,
        );
      }
    }
  }
  for (const chord of [
    'F5',
    'F6',
    'F7',
    'F10',
    'Cmd+S',
    'Ctrl+S',
    'Cmd+P',
    'Ctrl+P',
    'Cmd+O',
    'Ctrl+O',
    'Cmd+F',
    'Ctrl+F',
    'Cmd+G',
    'Ctrl+G',
    'Ctrl+R',
  ]) {
    assert.ok(
      new RegExp(`\\| K\\d+ \\| [^|]+ \\| ${chord.replace('+', '\\+')} \\|`).test(manual),
      `shortcut row for ${chord}`,
    );
  }
  for (const browser of ['Safari', 'Chrome', 'Edge'])
    assert.ok(manual.includes(`| ${browser} |`) || manual.includes(` ${browser} | `), browser);
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
      assert.ok(
        flat(manual).includes(words.split(' with the system')[0].trim()),
        `press "${words}" is not in the manual list`,
      );
    }
  }
  assert.ok(
    manual.includes('console.log(JSON.stringify({ key, code, ctrlKey, altKey, shiftKey, metaKey }));'),
    'the recorder',
  );
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
  for (const [, title, minutes, body] of partA.matchAll(
    /^### (A\d+)\. .*\((\d+) minutes?\)$([\s\S]*?)(?=^### |$(?![\s\S]))/gm,
  )) {
    for (const [, n, unit] of body.matchAll(/wait (\w+) (minutes?|seconds?)/g)) {
      const value = /^\d+$/.test(n) ? Number(n) : ({ one: 1, two: 2, three: 3, five: 5 }[n] ?? 0);
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
    if (head) {
      job = head[1];
      jobs[job] = [];
      continue;
    }
    if (!job) continue;
    const list = /^\s+os: \[([^\]]*)\]/.exec(line);
    if (list) jobs[job] = list[1].split(',').map((s) => s.trim());
    const runsOn = /^\s+runs-on: ([\w.-]+)\s*$/.exec(line);
    if (runsOn && jobs[job].length === 0) jobs[job] = [runsOn[1]];
  }
  const family = (os) =>
    os.startsWith('ubuntu') ? 'Linux' : os.startsWith('macos') ? 'macOS' : os.startsWith('windows') ? 'Windows' : os;
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
  assert.ok(
    contributing.includes('runs the type check, lint and the format check on Linux;'),
    'type check and lint: Linux',
  );
  assert.ok(
    contributing.includes(
      "the unit tests, the engines' suites, the browser checks and the end-to-end tests on Linux, macOS and Windows;",
    ),
    'unit, engines, browser checks, e2e: three systems',
  );
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
});
