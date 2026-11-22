// N10: tests of tools/check-guide-strings.mjs.
//
//     node --test tools/check-guide-strings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_QUOTES,
  STAGE_TEXTS,
  buildMatcher,
  checkGuide,
  extractExamples,
  extractQuotes,
  loadLiterals,
  parseLiterals,
  sourceFiles,
} from './check-guide-strings.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = fileURLToPath(new URL('./check-guide-strings.mjs', import.meta.url));
const guideText = readFileSync(join(repo, 'docs', 'USER-GUIDE.md'), 'utf8').replace(/\r\n?/g, '\n');

test('parseLiterals reads quotes, templates with nested expressions, comments and a + join', () => {
  const src = [
    "// 'not a literal'",
    '/* "nor this" */ export const A = \'one\';',
    'export const B = "two \\"quoted\\"";',
    "export const C = (n: number) => `Deleted ${n === 1 ? 'a' : `${n}`} items.`;",
    "export const D = 'first ' +",
    "  'second';",
  ].join('\n');
  const found = parseLiterals(src).map((segments) => JSON.stringify(segments));
  assert.ok(found.includes('["one"]'));
  assert.ok(found.includes('["two \\"quoted\\""]'));
  assert.ok(found.includes('["Deleted ",null," items."]'));
  assert.ok(found.includes('["first second"]'));
  assert.ok(!found.some((f) => f.includes('not a literal') || f.includes('nor this')));
});

test('a caption matches without its access key; a wildcard stands for an example name', () => {
  const matches = buildMatcher([['Loc&k Layout'], ['Delete ', null, '?'], ['Move ', null]], ['prog.X68', 'a b.X68']);
  assert.ok(matches('Lock Layout'));
  assert.ok(matches('Delete "prog.X68"?'));
  assert.ok(matches('Delete\n  "a b.X68"?'), 'a line break in the guide is a space');
  assert.ok(!matches('Lock Layou'));
  assert.ok(!matches('Delet "prog.X68"?'));
  assert.ok(!matches('Delete "other.X68"?'), 'a name that is not an example name');
  assert.ok(!matches('Delete "a". Then more?'));
});

test('a wildcard stands only for a number, an example name or another text of the code', () => {
  const matches = buildMatcher(
    [
      ['Moved'],
      ['Copied'],
      ['', null, ' ', null, ' items to ', null, '.'],
      ['', null, ' ', null, ' to ', null, '.'],
      ['Deleted ', null, '.'],
      ['', null, ' items selected'],
      ['Delete ', null, ' items: ', null, '?'],
      ['', null, ' and ', null, ' more'],
      ['the folder ', null, ' (', null, ')'],
      ['"', null, '" in the Trash'],
      ['', null, ' ', null],
    ],
    ['demo', 'a.X68', 'My Programs'],
  );
  assert.ok(matches('Moved 3 items to demo.'));
  assert.ok(matches('Copied "a.X68" to My Programs/demo.'));
  assert.ok(!matches('Moves 3 items to demo.'), 'one changed letter in a word that a wildcard stands for');
  assert.ok(!matches('Everything you know is wrong to me.'));
  assert.ok(!matches('Deleted the whole disk.'));
  assert.ok(matches('Deleted "a.X68" in the Trash.'), 'a wildcard may be another template');
  assert.ok(matches('Deleted 14 files.'));
  assert.ok(!matches('Deleted 14 bananas.'));
  assert.ok(!matches('Garbage 5 items selected'));
  assert.ok(matches('Delete 4 items: "a.X68", the folder "demo" (14 files) and 2 more?'), 'a list of texts');
  assert.ok(!matches('Delete 4 items: "a.X68", the folders "demo" (14 files) and 2 more?'));
  assert.ok(!matches('Moved demo'), 'a template with fewer than two letters of its own is only a part');
});

test('extractQuotes: bold is a caption, one backtick a text, two backticks and comments nothing', () => {
  const guide = [
    '# Guide',
    '',
    '## Beyond the original',
    '<!-- **hidden** `hidden` -->',
    'Use **Window > Lock Layout** and `Layout locked.` but not ``prog.X68`` or *this*.',
    'A caption **that runs',
    'over two lines** ends here.',
    '',
    '## Next',
    '**outside** `outside`',
  ].join('\n');
  const quotes = extractQuotes(guide).map((q) => `${q.kind}:${q.text}@${q.line}`);
  assert.deepEqual(quotes.sort(), [
    'caption:Lock Layout@5',
    'caption:Window@5',
    'caption:that runs over two lines@6',
    'text:Layout locked.@5',
  ]);
});

test('extractQuotes refuses a guide without the section', () => {
  assert.throws(() => extractQuotes('# Guide\n\n## Other\n'), /no section/);
});

test('extractExamples reads the names after "Example names:" in a comment of the section', () => {
  const guide = [
    '## Beyond the original',
    '<!-- rules',
    'Example names: prog.X68, My Programs,',
    '  prog (restored).X68',
    '-->',
    'Example names: outside, a comment',
    '## Next',
  ].join('\n');
  assert.deepEqual(extractExamples(`# G\n\n${guide}`), ['prog.X68', 'My Programs', 'prog (restored).X68']);
});

test('only the stage texts, the command captions and the menu names are read', () => {
  const files = sourceFiles(repo).map((p) => p.slice(repo.length + 1).replace(/\\/g, '/'));
  assert.equal(files.filter((p) => p.endsWith('/texts.ts')).length, STAGE_TEXTS.length);
  assert.ok(!files.some((p) => /features\/(options|assemble|files-fsaccess)\//.test(p)));
  assert.ok(files.includes('app/src/commands/specs.ts'));
  const { failures } = checkGuide(guideText.replace('**Open as Text**', '**New File Settings**'), loadLiterals(repo));
  assert.deepEqual(
    failures.map((f) => f.text),
    ['New File Settings'],
    'a caption of the faithful port only',
  );
});

test("the guide's section quotes only texts of the code, and enough of them", () => {
  const { quotes, failures } = checkGuide(guideText, loadLiterals(repo));
  assert.deepEqual(
    failures.map((f) => `${f.line}: ${f.text}`),
    [],
  );
  assert.ok(quotes.length >= MIN_QUOTES, `${quotes.length} marked texts`);
});

test('one changed letter in a quoted caption or text is found', () => {
  const literals = loadLiterals(repo);
  for (const [from, to] of [
    ['> Lock Layout**', '> Lock Layot**'],
    ['`Layout reset.`', '`Layout reseet.`'],
    ['**Delete for Good**', '**Delete for good**'],
    ['`Deleted 5 items.`', '`Delete 5 items.`'],
    ['Nothing was deleted. Delete it with', 'Nothing was deleted. Delet it with'],
    ['`Moved 3 items to demo.`', '`Moves 3 items to demo.`'],
    ['**Kept**', '**Kapt**'],
    ['`Files moved beside Editor, left.`', '`Files moved beside Editor, lift.`'],
    ['and everything in it (14 files)?', 'and everything in it (14 filez)?'],
  ]) {
    const changed = guideText.replace(from, to);
    assert.notEqual(changed, guideText, `the guide no longer contains ${from}`);
    const { failures } = checkGuide(changed, literals);
    assert.ok(failures.length >= 1, `no failure for ${to}`);
  }
});

test('the command line fails on a changed copy and passes on the real guide', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guide-strings-'));
  try {
    const copy = join(dir, 'guide.md');
    writeFileSync(copy, guideText.replace('**Move Tab Later**', '**Move Tab Latter**'));
    const bad = spawnSync(process.execPath, [script, '--guide', copy], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Move Tab Latter/);
    const good = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /of \d+ quoted texts/);
    const unknown = spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' });
    assert.equal(unknown.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
