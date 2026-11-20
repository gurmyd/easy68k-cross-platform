#!/usr/bin/env node
// Checks the files in engine/sim/src against the original Sim68K v5.16.1
// sources:
//
//     node engine/sim/check-patches.mjs [--list] [path to Sim68Kv5.16.1]
//
// The original sources are not part of this repository.  By default they are
// looked for in <repository>/reference/src-sim68k/Sim68Kv5.16.1 (see
// docs/porting/ground-truth.md for where they come from); if they are not
// there the script says so and exits with code 2.
//
// For every file it compares bytes, not text (the files are Windows-1252 with
// CR LF line ends and must stay so).  It fails (exit code 1) if
//   * a file listed as unmodified differs from the original,
//   * a changed region is not marked with a comment containing "[easy68k-mac]"
//     (one-line changes carry the marker themselves or on the line before;
//     larger ones are enclosed in "[easy68k-mac] BEGIN" / "[easy68k-mac] END"),
//   * a changed region is not listed in PATCHES.md (matched by file name and
//     original line number),
//   * PATCHES.md lists a change that is not in the files.
// --list prints every changed region with its original line numbers.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const args = process.argv.slice(2);
const list = args.includes('--list');
const referenceDir = args.find((a) => !a.startsWith('--')) ?? join(repo, 'reference', 'src-sim68k', 'Sim68Kv5.16.1');
const srcDir = join(here, 'src');

const FILES = [
  'def.h', 'extern.h', 'var.h', 'PROTO.H', 'OPCODES.H', 'RUN.CPP', 'UTILS.CPP',
  'CODE1.CPP', 'CODE2.CPP', 'CODE3.CPP', 'CODE4.CPP', 'CODE5.CPP', 'CODE6.CPP',
  'CODE7.CPP', 'CODE8.CPP', 'CODE9.CPP', 'SIMOPS2.CPP', 'STARTSIM.CPP',
  'BPoint.cpp', 'BPoint.h', 'BPointExpr.cpp', 'BPointExpr.h',
];
const MARKER = '[easy68k-mac]';

/** Split bytes into lines (each including its line end), as latin-1 strings. */
function lines(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Line diff (longest common subsequence).  Returns the changed regions as
 * { aStart, aEnd, bStart, bEnd }: original lines [aStart, aEnd) were replaced
 * by patched lines [bStart, bEnd) (0-based, end exclusive).
 */
function diff(a, b) {
  const n = a.length, m = b.length;
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const hunks = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { open.aEnd = i; open.bEnd = j; hunks.push(open); open = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { close(); i++; j++; continue; }
    if (!open) open = { aStart: i, bStart: j };
    if (j < m && (i === n || table[i * width + j + 1] >= table[(i + 1) * width + j])) j++;
    else i++;
  }
  close();
  return hunks;
}

/** Rows of the patch table in PATCHES.md: | id | file | original lines | ... */
function documentedPatches() {
  const rows = [];
  const text = readFileSync(join(here, 'PATCHES.md'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^P\d+$/.test(cells[1])) continue;
    const file = cells[2].replace(/`/g, '');
    for (const range of cells[3].split(',')) {
      const match = /(\d+)(?:\s*-\s*(\d+))?/.exec(range);
      if (match) rows.push({ id: cells[1], file, from: Number(match[1]), to: Number(match[2] ?? match[1]), used: false });
    }
  }
  return rows;
}

if (!existsSync(join(referenceDir, 'RUN.CPP'))) {
  console.error(`Original sources not found in ${referenceDir}.`);
  console.error('They are not part of this repository; pass their directory as an argument.');
  process.exit(2);
}

const documented = documentedPatches();
let problems = 0;
let total = 0;
const problem = (text) => { console.log(`PROBLEM: ${text}`); problems++; };

for (const name of FILES) {
  const original = readFileSync(join(referenceDir, name));
  const patched = readFileSync(join(srcDir, name));
  if (original.equals(patched)) {
    if (list) console.log(`${name}: identical to the original`);
    if (documented.some((d) => d.file === name)) problem(`${name} is identical to the original but PATCHES.md lists changes for it`);
    continue;
  }
  const a = lines(original), b = lines(patched);
  const hunks = diff(a, b);
  // lines of the patched file that lie inside a BEGIN ... END region
  const inRegion = new Array(b.length).fill(false);
  let depth = 0;
  b.forEach((line, index) => {
    if (line.includes(`${MARKER} BEGIN`)) depth++;
    inRegion[index] = depth > 0;
    if (line.includes(`${MARKER} END`)) depth--;
  });
  if (depth !== 0) problem(`${name}: unbalanced ${MARKER} BEGIN / END`);
  for (const hunk of hunks) {
    total++;
    const added = b.slice(hunk.bStart, hunk.bEnd);
    const from = hunk.aStart + 1; // 1-based; for a pure insertion: the line it was inserted before
    const to = Math.max(hunk.aEnd, hunk.aStart + 1);
    const marked = added.some((line) => line.includes(MARKER))
      || (hunk.bStart < b.length && inRegion[hunk.bStart] && inRegion[Math.max(hunk.bStart, hunk.bEnd - 1)]);
    const entry = documented.find((d) => d.file === name && d.from <= to && from <= d.to);
    if (entry) entry.used = true;
    if (list || !marked || !entry) {
      console.log(`${name}: original line${to > from ? 's' : ''} ${from}${to > from ? '-' + to : ''}: `
        + `${hunk.aEnd - hunk.aStart} removed, ${added.length} added${entry ? ' (' + entry.id + ')' : ''}`);
    }
    if (!marked) problem(`${name} line ${from}: change is not marked with ${MARKER}`);
    if (!entry) problem(`${name} line ${from}: change is not listed in PATCHES.md`);
    // every line that was added must end in CR LF like the rest of the file
    if (added.some((line) => !line.endsWith('\r\n'))) problem(`${name} line ${from}: added line without CR LF`);
  }
}
for (const entry of documented) {
  if (!entry.used) problem(`PATCHES.md ${entry.id}: no change found in ${entry.file} at original line ${entry.from}`);
}

console.log(`${total} changed region${total === 1 ? '' : 's'} in ${FILES.length} files; ${problems} problem${problems === 1 ? '' : 's'}.`);
process.exit(problems ? 1 : 0);
