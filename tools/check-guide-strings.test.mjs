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
  codeFrom,
  literalsOf,
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

test('a caption matches without its access key; a value from outside is an example name', () => {
  const matches = buildMatcher(
    [{ segments: ['Loc&k Layout'] }, { segments: ['Delete "', null, '"?'] }, { segments: ['Move ', null] }],
    ['prog.X68', 'a b.X68'],
  );
  assert.ok(matches('Lock Layout'));
  assert.ok(matches('Delete "prog.X68"?'));
  assert.ok(matches('Delete\n  "a b.X68"?'), 'a line break in the guide is a space');
  assert.ok(!matches('Lock Layou'));
  assert.ok(!matches('Delet "prog.X68"?'));
  assert.ok(!matches('Delete "other.X68"?'), 'a name that is not an example name');
  assert.ok(!matches('Delete "a". Then more?'));
});

// A small copy of the code's ways of building a text, in two files: a texts.ts and a file that
// imports and calls it (as features/history/trash.ts calls emptyTrashQuestion).
const CODE = {
  'f/texts.ts': [
    "import { formatSize } from './size';",
    'const quoted = (name: string) => `"${name}"`;',
    "const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;",
    "export type Side = 'left' | 'right';",
    'export const ANNOUNCE = {',
    '  beside: (panel: string, near: string, side: Side) => `${panel} moved beside ${near}, ${side}.`,',
    "  reset: 'Layout reset.',",
    '} as const;',
    "export const UNDO = 'Undo';",
    "export const RESTORED_FOLDER = 'Restored';",
    'export const intoRestored = (name: string) => `Restore ${quoted(name)} into ${RESTORED_FOLDER}?`;',
    'export function movedToast(count: number, only: string | null, target: string, copied: boolean): string {',
    "  const verb = copied ? 'Copied' : 'Moved';",
    '  return count === 1 && only !== null',
    '    ? `${verb} ${quoted(only)} to ${target}.`',
    '    : `${verb} ${count} items to ${target}.`;',
    '}',
    'export const exportAll = (label: string): string => `Export all of ${label} as ${label}.zip`;',
    'function listOf(names: readonly string[]): string {',
    '  if (names.length === 1) return names[0] as string;',
    "  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;",
    '}',
    'export function deleteQuestion(list: readonly { name: string; files: number }[]): string {',
    '  return `Delete ${list.length} items: ${listOf(list.map((item) => `the folder ${quoted(item.name)} (${files(item.files)})`))}?`;',
    '}',
    'export function emptyTrash(count: number, size: string): string {',
    "  return `Empty the Trash? (${count} ${count === 1 ? 'item' : 'items'}, ${size})`;",
    '}',
    'export const usage = (bytes: number) => `This site uses ${formatSize(bytes)}`;',
  ].join('\n'),
  'f/size.ts': [
    "const UNITS = ['kB', 'MB', 'GB'] as const;",
    'export function formatSize(bytes: number): string {',
    '  const value = Math.max(0, Math.round(bytes));',
    "  if (value < 1024) return value === 1 ? '1 byte' : `${value} bytes`;",
    '  let size = value / 1024;',
    '  let unit = 0;',
    '  return `${size.toFixed(1)} ${UNITS[unit]}`;',
    '}',
  ].join('\n'),
  'f/trash.ts': [
    "import { emptyTrash } from './texts';",
    "import { formatSize } from './size';",
    'export function ask(items: number[], bytes: number) {',
    '  const size = formatSize(bytes);',
    '  return emptyTrash(items.length, size);',
    '}',
  ].join('\n'),
};

test('a wildcard stands only for what the code puts there', () => {
  const code = codeFrom(CODE);
  const matches = buildMatcher(
    literalsOf(code, ['f/texts.ts']),
    ['demo', 'a.X68', 'My Programs', 'Lab', 'Files', 'Editor'],
    code,
  );
  // Accepted: the code puts these texts there.
  assert.ok(matches('Moved 3 items to demo.'), 'a local variable: Copied or Moved');
  assert.ok(matches('Copied "a.X68" to My Programs/demo.'), 'a function of the file; a path of example names');
  assert.ok(matches('Files moved beside Editor, left.'), 'a parameter whose type is a set of strings');
  assert.ok(matches('Restore "a.X68" into Restored?'), 'a constant of the file');
  assert.ok(matches('Export all of Lab as Lab.zip'));
  assert.ok(
    matches(
      'Delete 3 items: the folder "demo" (14 files), the folder "Lab" (1 file) and the folder "a.X68" (2 files)?',
    ),
  );
  assert.ok(matches('Empty the Trash? (12 items, 1.4 MB)'), 'what a caller in another file passes');
  assert.ok(matches('Empty the Trash? (1 item, 512 bytes)'));
  assert.ok(matches('This site uses 7.9 MB'));
  // Rejected: one changed letter, or a text of the code where the code puts no such text.
  assert.ok(!matches('Moves 3 items to demo.'), 'one changed letter in a word that a wildcard stands for');
  assert.ok(!matches('Moved Undo to demo.'), 'another text of the code where a number or a quoted name goes');
  assert.ok(!matches('Moved "Undo" to demo.'), 'a text of the code where a name from outside goes');
  assert.ok(!matches('Layout reset. 3 items to demo.'), 'a text of the code where Copied or Moved goes');
  assert.ok(!matches('Files moved beside Editor, below.'), 'a string that the type does not have');
  assert.ok(!matches('Restore "a.X68" into Undo?'));
  assert.ok(!matches('Export all of Lab as demo.zip'), 'the same expression twice is the same text');
  assert.ok(!matches('Empty the Trash? (12 items, Layout reset.)'));
  assert.ok(!matches('Empty the Trash? (12 itemz, 1.4 MB)'));
  assert.ok(!matches('Empty the Trash? (12 items, 1.4 TB)'), 'a unit that formatSize does not write');
  assert.ok(!matches('Delete 2 items: the folder "demo" (14 files) and Undo?'), 'a list of what the code lists');
  assert.ok(!matches('Delete 2 items: the folder "demo" (14 filez) and the folder "Lab" (1 file)?'));
  assert.ok(!matches('Everything you know is wrong to me.'));
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
    // Texts that fit no template: a text of the code where the code puts another.
    ['`Moved 3 items to demo.`', '`Moved Undo to demo.`'],
    ['`Moved 3 items to demo.`', '`Moved "Trash" to demo.`'],
    ['`Files moved beside Editor, left.`', '`Files moved beside Editor, Close.`'],
    ['`Exported 23 files as EASy68K export.zip.`', '`Exported 23 Layout reset. as EASy68K export.zip.`'],
    ['(12\n  items, 1.4 MB)', '(12\n  items, Saved)'],
    ['(no detail is known)', '(Layout reset.)'],
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
    writeFileSync(copy, guideText.replace('`Deleted 5 items.`', '`Deleted Undo.`'));
    const fitsNone = spawnSync(process.execPath, [script, '--guide', copy], { encoding: 'utf8' });
    assert.equal(fitsNone.status, 1, 'a quoted text that fits no template of the code');
    assert.match(fitsNone.stderr, /not a text of the code \(text\): "Deleted Undo\."/);
    const good = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /of \d+ quoted texts/);
    const unknown = spawnSync(process.execPath, [script, '--nope'], { encoding: 'utf8' });
    assert.equal(unknown.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
