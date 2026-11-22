// The unit test on tests/parity/matrix.json (ARCHITECTURE.md 6.6, 9.6 X2): every row of section 1.3
// and of the table of added commands in 1.5 is in the matrix exactly once, every row has a
// verification, every simulator and EASyBIN row a web-e2e test first, and every verification names
// something that exists: a test title in a test file, a conformance folder, a browser check or an
// item of the manual list (6.8). Owner: X2.
//
//   npx vitest run --config tests/parity/vitest.config.ts     (also part of npm run test:conformance)

import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  KINDS,
  checkMatrix,
  documentRows,
  kindCounts,
  manualSection,
  tableRows,
  testTitles,
  unreferencedTests,
  WEB_E2E_SECTIONS,
  type Matrix,
  type Repo,
} from './matrix';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const diskRepo: Repo = {
  read(path) {
    const full = join(repoRoot, path);
    return existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  },
  exists: (path) => existsSync(join(repoRoot, path)),
};

const architecture = readFileSync(join(repoRoot, 'docs', 'ARCHITECTURE.md'), 'utf8');
const matrix = JSON.parse(readFileSync(join(here, 'matrix.json'), 'utf8')) as Matrix;
const rows = documentRows(architecture);
const manual = manualSection(architecture);

describe('the real matrix', () => {
  it('has every row of 1.3 and 1.5 once, each verified by tests that exist', () => {
    const problems = checkMatrix(matrix, rows, diskRepo, manual);
    // Printed so that a failure in CI can be read from the log alone.
    for (const problem of problems) console.log(`matrix: ${problem.row}: ${problem.problem}`);
    expect(problems).toEqual([]);
  });

  it('covers the sections 1.3.1 to 1.3.8 and the added commands of 1.5', () => {
    const sections = [...new Set(rows.map((row) => row.section))];
    expect(sections).toEqual(['1.3.1', '1.3.2', '1.3.3', '1.3.4', '1.3.5', '1.3.6', '1.3.7', '1.3.8', '1.5']);
    expect(matrix.rows).toHaveLength(rows.length);
    // The counts of the document when the matrix was last brought up to date, so that a lost table
    // shows: 1.3.8 has the twenty rows of easybin.md 21.4, 1.5 twelve added commands.
    expect(rows.filter((row) => row.section === '1.3.8')).toHaveLength(20);
    expect(rows.filter((row) => row.section === '1.5').length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBeGreaterThanOrEqual(191);
    console.log(`matrix: ${rows.length} rows; kinds ${JSON.stringify(kindCounts(matrix))}`);
  });

  it('names every test of the simulator suites (tests/e2e/sim), so none is untracked', () => {
    const files = globSync('tests/e2e/sim/*.spec.ts', { cwd: repoRoot }).map((file) => file.replaceAll('\\', '/'));
    expect(files.length).toBeGreaterThan(0);
    expect(unreferencedTests(matrix, files, diskRepo)).toEqual([]);
  });

  it('has simulator and EASyBIN rows (1.3.4 to 1.3.8), which checkMatrix requires to be web-e2e', () => {
    // The rule itself is in checkMatrix (proved below on made-up rows); here: it has rows to judge.
    const simulator = matrix.rows.filter((row) => WEB_E2E_SECTIONS.test(row.section));
    expect(simulator.length).toBeGreaterThanOrEqual(99);
  });
});

// ---- the rules themselves, on made-up inputs -------------------------------------------------

const DOC = [
  '#### 1.3.1 Editor - menus (editor-ui §2)',
  '',
  '| Original | id | Port | Win/Linux | macOS | St |',
  '|---|---|---|---|---|---|',
  '| File > `&New` | `ed.file.new` | File | - | - | = |',
  '| File > `&Save` | `ed.file.save` | File | Ctrl+S | Cmd+S | = |',
  '',
  '### 1.4 Notes on changes and drops',
  '| Not | a | row |',
  '',
  '### 6.8 What only a person can check',
  '',
  '- Sound: tasks 70-77 audible, in order.',
  '',
  '### 6.9 Definition of done',
].join('\n');

const SPEC = [
  "test('New opens a document', async () => {});",
  'test.fail("Save writes the file", async () => {});',
  'for (const t of list) test(`${t}: every item`, async () => {});',
  "it('a unit test', () => {});",
].join('\n');

function fakeRepo(files: Record<string, string>, folders: string[] = []): Repo {
  return {
    read: (path) => files[path] ?? null,
    exists: (path) => path in files || folders.includes(path),
  };
}

const repo = fakeRepo({ 'tests/e2e/editor/a.spec.ts': SPEC, 'app/src/x.test.ts': SPEC, 'app/src/check-x.mjs': '' }, [
  'tests/conformance/sim/logs',
]);
const docRows = tableRows(DOC, /^#### (1\.3\.\d) /, /^### 1\.4 /);
const good = (): Matrix => ({
  rows: [
    {
      section: '1.3.1',
      original: 'File > `&New`',
      status: '=',
      verifiedBy: [{ kind: 'web-e2e', file: 'tests/e2e/editor/a.spec.ts', test: 'New opens a document' }],
    },
    {
      section: '1.3.1',
      original: 'File > `&Save`',
      status: '=',
      verifiedBy: [
        { kind: 'web-e2e', file: 'tests/e2e/editor/a.spec.ts', test: 'Save writes the file' },
        { kind: 'unit', file: 'app/src/x.test.ts', test: 'a unit test' },
        { kind: 'unit', file: 'tests/conformance/sim/logs' },
        { kind: 'manual', item: 'Sound: tasks 70-77 audible' },
        { kind: 'browser-check', file: 'app/src/check-x.mjs' },
      ],
    },
  ],
});
const check = (m: Matrix) => checkMatrix(m, docRows, repo, manualSection(DOC)).map((p) => p.problem);

describe('the rules', () => {
  it('reads the table rows of a section and stops at the next heading', () => {
    expect(docRows).toEqual([
      { section: '1.3.1', original: 'File > `&New`' },
      { section: '1.3.1', original: 'File > `&Save`' },
    ]);
  });

  it('reads test titles of every form, a template literal as written', () => {
    expect(testTitles(SPEC)).toEqual([
      'New opens a document',
      'Save writes the file',
      '${t}: every item',
      'a unit test',
    ]);
  });

  it('accepts a complete matrix', () => {
    expect(check(good())).toEqual([]);
    expect(KINDS).toContain('browser-check');
  });

  it('fails a row that has no verification', () => {
    const m = good();
    m.rows[0]!.verifiedBy = [];
    expect(check(m)).toEqual(['no verification (verifiedBy is empty)']);
  });

  it('fails an entry that names a test that does not exist', () => {
    const m = good();
    m.rows[0]!.verifiedBy[0]!.test = 'New opens two documents';
    expect(check(m)).toEqual(['tests/e2e/editor/a.spec.ts has no test "New opens two documents"']);
  });

  it('fails an entry whose file does not exist, or lies where its kind does not live', () => {
    const m = good();
    m.rows[0]!.verifiedBy[0]!.file = 'tests/e2e/editor/b.spec.ts';
    m.rows[1]!.verifiedBy[0]!.file = 'app/src/x.test.ts';
    expect(check(m)).toEqual([
      'tests/e2e/editor/b.spec.ts does not exist',
      'app/src/x.test.ts is not where a web-e2e test lives (tests/e2e/)',
    ]);
  });

  it('fails a manual item that is not in 6.8, and a browser check as the first entry', () => {
    const m = good();
    m.rows[1]!.verifiedBy[3]!.item = 'Sound: tasks 70-79';
    m.rows[0]!.verifiedBy.unshift({ kind: 'browser-check', file: 'app/src/check-x.mjs' });
    const problems = check(m);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^the first entry gives the row's kind/);
    expect(problems[1]).toBe('no item of ARCHITECTURE.md 6.8 contains "Sound: tasks 70-79"');
  });

  it('fails a missing row, an extra row and a row that appears twice', () => {
    const m = good();
    const save = m.rows.pop()!;
    m.rows.push({ ...m.rows[0]!, verifiedBy: [...m.rows[0]!.verifiedBy] });
    m.rows.push({ ...save, original: 'File > `&Save All`' });
    expect(check(m).sort()).toEqual([
      'row appears more than once',
      'row is not in the document',
      'row of the document is missing from the matrix',
    ]);
  });

  it('fails a simulator or EASyBIN row (1.3.4 to 1.3.8) whose first entry is not a web-e2e test', () => {
    // The verifier's case: a simulator row changed to kind unit (errata X2 entry 8).
    const simDoc = DOC.replace('#### 1.3.1 Editor - menus', '#### 1.3.4 Simulator - menus');
    const simRows = tableRows(simDoc, /^#### (1\.3\.\d) /, /^### 1\.4 /);
    const sim = good();
    for (const row of sim.rows) row.section = '1.3.4';
    const checkSim = (m: Matrix) => checkMatrix(m, simRows, repo, manualSection(simDoc)).map((p) => p.problem);
    expect(checkSim(sim)).toEqual([]);
    sim.rows[0]!.verifiedBy = [{ kind: 'unit', file: 'app/src/x.test.ts', test: 'a unit test' }];
    sim.rows[1]!.verifiedBy[0] = { kind: 'web-e2e', file: 'tests/e2e/editor/a.spec.ts' };
    expect(checkSim(sim)).toEqual([
      'a simulator or EASyBIN row (1.3.4) is verified first by a web-e2e test, not by unit',
      'a simulator or EASyBIN row (1.3.4) is verified first by a web-e2e test, not by web-e2e without a test title',
      'tests/e2e/editor/a.spec.ts: a web-e2e entry names its test',
    ]);
    // Rows of other sections may be of any primary kind.
    expect(
      check({ rows: [{ ...good().rows[0]!, verifiedBy: [{ kind: 'manual', item: 'Sound' }] }, good().rows[1]!] }),
    ).toEqual([]);
  });

  it('reads the table of added commands of 1.5, whose header is not "Original"', () => {
    const text = [
      '### 1.5 Additions (none changes program behaviour)',
      '',
      '| Caption | id | Where |',
      '|---|---|---|',
      '| `New Window` | `app.window.new` | menu |',
      '| (next panel) | `sim.panel.next` | key only |',
      '',
      '---',
      '| not | a | row |',
    ].join('\n');
    expect(documentRows(text)).toEqual([
      { section: '1.5', original: '`New Window`' },
      { section: '1.5', original: '(next panel)' },
    ]);
  });

  it('lists the tests that no row names', () => {
    const m = good();
    expect(unreferencedTests(m, ['tests/e2e/editor/a.spec.ts'], repo)).toEqual([
      'tests/e2e/editor/a.spec.ts: ${t}: every item',
      'tests/e2e/editor/a.spec.ts: a unit test',
    ]);
  });
});
