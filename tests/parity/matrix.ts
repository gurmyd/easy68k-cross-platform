// The parity matrix (ARCHITECTURE.md 6.6): reading the rows of section 1.3 from the documents and
// checking tests/parity/matrix.json against them and against the test files it names. Owner: X2.
//
// Everything here is a plain function over texts and a file-system view, so that matrix.test.ts can
// prove each rule on small made-up inputs as well as on the real matrix.

/** The four kinds of 6.6, and the browser checks (errata X2 entry 2), which only add evidence. */
export const PRIMARY_KINDS = ['web-e2e', 'desktop-e2e', 'unit', 'manual'] as const;
export const KINDS = [...PRIMARY_KINDS, 'browser-check'] as const;
export type Kind = (typeof KINDS)[number];

export interface Verification {
  kind: Kind;
  /** Repository-relative path, with forward slashes (all kinds but manual). */
  file?: string;
  /** The title of a test in `file` exactly as written in the source (web-e2e, desktop-e2e, unit). */
  test?: string;
  /** manual: words of the item as ARCHITECTURE.md 6.8 writes them. */
  item?: string;
}

export interface MatrixRow {
  section: string;
  original: string;
  id?: string;
  status: string;
  verifiedBy: Verification[];
  note?: string;
}

export interface Matrix {
  rows: MatrixRow[];
}

/** A row of a parity table in a document: its section and its first cell. */
export interface DocumentRow {
  section: string;
  original: string;
}

/** What the checks may read: the files of the repository. */
export interface Repo {
  /** The text of a file, or null if there is none (a folder is not a file). */
  read(path: string): string | null;
  /** True if a file or a folder exists. */
  exists(path: string): boolean;
}

/**
 * The rows of the Markdown tables under the headings that `heading` matches (its group 1 is the
 * section name), up to the next line that `stop` matches. The header row of a table (the row just
 * above its separator row) and the separator rows are left out; cells are trimmed.
 */
export function tableRows(text: string, heading: RegExp, stop: RegExp, name?: string): DocumentRow[] {
  const rows: DocumentRow[] = [];
  const lines = text.split(/\r?\n/);
  const separator = (line: string | undefined) => line !== undefined && /^\|[-:| ]+\|\s*$/.test(line);
  let section: string | null = null;
  for (const [index, line] of lines.entries()) {
    const match = heading.exec(line);
    if (match) {
      section = name ?? match[1] ?? null;
      continue;
    }
    if (section !== null && stop.test(line)) {
      section = null;
      continue;
    }
    if (section === null || !line.startsWith('|') || separator(line) || separator(lines[index + 1])) continue;
    rows.push({ section, original: line.slice(1).split('|')[0]?.trim() ?? '' });
  }
  return rows;
}

/**
 * Every row of ARCHITECTURE.md 1.3.1 to 1.3.8, and of the table of added commands in 1.5 (section
 * `1.5`; errata X2 entry 8). 1.3.8 holds the rows of easybin.md 21.4, copied there (errata X2
 * entry 3).
 */
export function documentRows(architecture: string): DocumentRow[] {
  return [
    ...tableRows(architecture, /^#### (1\.3\.\d) /, /^### 1\.4 /),
    ...tableRows(architecture, /^### (1\.5) /, /^---\s*$|^##? /),
  ];
}

/**
 * The sections whose rows are the simulator's and EASyBIN's: their kind is `web-e2e` and their first
 * entry names a test (9.6 X2: "a test for every simulator and EASyBIN row of 1.3").
 */
export const WEB_E2E_SECTIONS = /^1\.3\.[4-8]$/;

/** The text of ARCHITECTURE.md 6.8 (the manual list), which `manual` entries quote. */
export function manualSection(architecture: string): string {
  const start = architecture.search(/^### 6\.8 /m);
  if (start < 0) return '';
  const rest = architecture.slice(start);
  const end = rest.slice(1).search(/^### /m);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

/**
 * The titles of the tests of a source file: the first argument of `test(...)`, `it(...)` and their
 * `.fail`, `.skip`, `.fixme`, `.only` forms, as written (a template literal keeps its `${...}`).
 */
export function testTitles(source: string): string[] {
  const pattern = /\b(?:test|it)(?:\.(?:fail|skip|fixme|only|concurrent))?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs;
  return [...source.matchAll(pattern)].map((match) => unescape(match[2] ?? '', match[1] ?? "'"));
}

function unescape(text: string, quote: string): string {
  return text.replace(/\\(.)/g, (_all, character: string) =>
    character === quote || character === '\\' ? character : `\\${character}`,
  );
}

/** One problem found in the matrix, with the row it belongs to. */
export interface Problem {
  row: string;
  problem: string;
}

const label = (row: { section: string; original: string }) => `${row.section} | ${row.original}`;

/** Checks the matrix against the document rows and the repository; returns every problem found. */
export function checkMatrix(matrix: Matrix, rows: DocumentRow[], repo: Repo, manual: string): Problem[] {
  const problems: Problem[] = [];
  const key = (row: { section: string; original: string }) => `${row.section}\u0000${row.original}`;

  // 1. Exactly the rows of the documents, each once.
  const wanted = new Map<string, number>();
  for (const row of rows) wanted.set(key(row), (wanted.get(key(row)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const row of matrix.rows) seen.set(key(row), (seen.get(key(row)) ?? 0) + 1);
  for (const row of rows) {
    if (!seen.has(key(row)))
      problems.push({ row: label(row), problem: 'row of the document is missing from the matrix' });
  }
  for (const [k, count] of seen) {
    const [section = '', original = ''] = k.split('\u0000');
    if (!wanted.has(k)) problems.push({ row: `${section} | ${original}`, problem: 'row is not in the document' });
    else if (count > (wanted.get(k) ?? 0))
      problems.push({ row: `${section} | ${original}`, problem: 'row appears more than once' });
  }

  // 2. Every row verified, by entries that name something that exists.
  const titles = new Map<string, string[]>();
  const titlesOf = (file: string) => {
    if (!titles.has(file)) titles.set(file, testTitles(repo.read(file) ?? ''));
    return titles.get(file) ?? [];
  };
  for (const row of matrix.rows) {
    const where = label(row);
    if (!Array.isArray(row.verifiedBy) || row.verifiedBy.length === 0) {
      problems.push({ row: where, problem: 'no verification (verifiedBy is empty)' });
      continue;
    }
    const first = row.verifiedBy[0]!;
    if (!(PRIMARY_KINDS as readonly string[]).includes(first.kind)) {
      problems.push({
        row: where,
        problem: `the first entry gives the row's kind and must be one of ${PRIMARY_KINDS.join(', ')}, not ${first.kind}`,
      });
    }
    if (WEB_E2E_SECTIONS.test(row.section) && (first.kind !== 'web-e2e' || !first.test)) {
      problems.push({
        row: where,
        problem: `a simulator or EASyBIN row (${row.section}) is verified first by a web-e2e test, not by ${first.kind}${first.test ? '' : ' without a test title'}`,
      });
    }
    for (const entry of row.verifiedBy) problems.push(...checkEntry(entry, where, repo, manual, titlesOf));
  }
  return problems;
}

function checkEntry(
  entry: Verification,
  row: string,
  repo: Repo,
  manual: string,
  titlesOf: (file: string) => string[],
): Problem[] {
  const fail = (problem: string): Problem[] => [{ row, problem }];
  if (!(KINDS as readonly string[]).includes(entry.kind)) return fail(`unknown kind ${String(entry.kind)}`);
  if (entry.kind === 'manual') {
    if (!entry.item) return fail('a manual entry needs the words of its item');
    return manual.includes(entry.item) ? [] : fail(`no item of ARCHITECTURE.md 6.8 contains "${entry.item}"`);
  }
  const file = entry.file;
  if (!file) return fail(`a ${entry.kind} entry needs a file`);
  if (file.includes('\\')) return fail(`${file}: write paths with forward slashes`);
  const prefixes: Record<string, string[]> = {
    'web-e2e': ['tests/e2e/'],
    'desktop-e2e': ['tests/desktop/'],
    'browser-check': ['app/', 'tests/', 'tools/'],
    unit: ['app/', 'tests/', 'desktop/', 'engine/', 'tools/'],
  };
  if (!(prefixes[entry.kind] ?? []).some((prefix) => file.startsWith(prefix))) {
    return fail(`${file} is not where a ${entry.kind} test lives (${(prefixes[entry.kind] ?? []).join(', ')})`);
  }
  if (!repo.exists(file)) return fail(`${file} does not exist`);
  if (entry.kind === 'browser-check') {
    return /(^|\/)check-[\w-]+\.mjs$/.test(file) ? [] : fail(`${file} is not a check-<name>.mjs browser check`);
  }
  const needsTitle = entry.kind === 'web-e2e' || entry.kind === 'desktop-e2e';
  if (entry.test === undefined) return needsTitle ? fail(`${file}: a ${entry.kind} entry names its test`) : [];
  if (repo.read(file) === null) return fail(`${file} is a folder; a test title needs a file`);
  return titlesOf(file).includes(entry.test) ? [] : fail(`${file} has no test "${entry.test}"`);
}

/** The test titles of `files` that no row of the matrix names (they would be untracked). */
export function unreferencedTests(matrix: Matrix, files: string[], repo: Repo): string[] {
  const named = new Set(
    matrix.rows.flatMap((row) => row.verifiedBy.map((entry) => `${entry.file}\u0000${entry.test}`)),
  );
  return files.flatMap((file) =>
    testTitles(repo.read(file) ?? '')
      .filter((title) => !named.has(`${file}\u0000${title}`))
      .map((title) => `${file}: ${title}`),
  );
}

/** How many rows have each kind (their first entry). */
export function kindCounts(matrix: Matrix): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of matrix.rows) {
    const kind = row.verifiedBy[0]?.kind ?? 'none';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}
