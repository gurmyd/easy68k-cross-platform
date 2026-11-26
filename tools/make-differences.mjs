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
const ORDER = [
  'W1',
  'W2',
  'W3',
  'W4',
  'FS1',
  'E1',
  'E2',
  'E3',
  'SH1',
  'SH3',
  'SH4',
  'SH7',
  'SH8',
  'U1',
  'U2',
  'H1',
  'E4',
  'E5',
  'E6',
  'FS2',
  'SH2',
  'SH5',
  'SH6',
  'U3',
  'U4',
  'T1',
  'T2',
  'T3',
  'T4',
  'DV1',
  'DV2',
  'DV3',
  'B1',
  'X1',
  'DV4',
  'DV5',
  'X2',
  'X3',
  'P1',
  'Q1',
  'I3',
  'N0',
  'N1',
  'N2',
  'N3',
  'N4',
  'N5',
  'N6',
  'N7',
  'N8',
  'M1',
  'M2',
];

export function fragmentIds(dir) {
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3));
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
  const notes = section(
    arch,
    '### 1.4 Notes on changes and drops',
    '### 1.5 Additions (none changes program behaviour)',
  );
  const additions = section(arch, '### 1.5 Additions (none changes program behaviour)', '---');
  // The introduction (before part 1) and parts 3 and 4 are written by hand in DIFFERENCES.md itself;
  // only parts 1 and 2 are rebuilt.
  const current = readFileSync(join(repoRoot, 'docs', 'DIFFERENCES.md'), 'utf8').replace(/\r\n?/g, '\n');
  const PART1 = '\n## 1. Changes decided in the design\n';
  const PART3 = '\n## 3. Shortcuts a browser does not give up\n';
  if (!current.includes(PART1) || !current.includes(PART3))
    throw new Error('DIFFERENCES.md lacks the headings of parts 1 and 3');
  const head = current.slice(0, current.indexOf(PART1)).trim();
  const tail = current.slice(current.indexOf(PART3)).trim();
  const dir = join(repoRoot, 'docs', 'differences');
  const parts = [
    head,
    '',
    '## 1. Changes decided in the design',
    '',
    'Copied from section 1.4 of `docs/ARCHITECTURE.md`. The note numbers are the ones the rest of this',
    'document and the specifications refer to ("note 12").',
    '',
    notes,
    '',
    '### Additions',
    '',
    'Copied from section 1.5 of `docs/ARCHITECTURE.md`. None of them changes what a program does.',
    '',
    additions,
    '',
    '## 2. Differences recorded by each part of the port',
    '',
    'Each part of the port records the differences it introduced in `docs/differences/<part>.md`. They are',
    'copied here word for word, in the order the parts were built. The part names (W2, SH4 and so on) are',
    'the work packages of `docs/ARCHITECTURE.md` section 9.',
    '',
  ];
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
    console.log(
      `wrote docs/DIFFERENCES.md (${text.split('\n').length} lines, ${fragmentIds(join(repo, 'docs', 'differences')).length} fragments)`,
    );
  }
}
