#!/usr/bin/env node
// check-patches.mjs - proves that engine/asm/src differs from the original
// EASy68K v5.16.1 sources only by the documented, marked hunks.
//
//     node engine/asm/check-patches.mjs [--list]
//
// Needs the reference tree (reference/src-edit68k/Edit68Kv5.16.1, git-ignored).
// For every file of src/ it computes a line diff against the original and
// checks that
//   1. every hunk contains a line with the marker "[easy68k-mac]";
//   2. every hunk is listed in PATCHES.md: the table row names the file and the
//      original line range exactly as this script prints it ("FILE:a-b" or
//      "FILE:a" for a one-line range; an insertion is "FILE:a+" = after line a);
//   3. no hunk is listed in PATCHES.md that does not exist.
// Line ends (CR LF) and the trailing Ctrl-Z byte are compared as well: they
// must be unchanged. --list prints every hunk.
//
// Exit code 0 when everything matches, 1 otherwise.
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const refDir = join(repo, 'reference', 'src-edit68k', 'Edit68Kv5.16.1');
const srcDir = join(here, 'src');
const list = process.argv.includes('--list');

if (!existsSync(refDir)) {
  console.log(`reference tree not found (${refDir}); nothing to check`);
  process.exit(0);
}

/** Lines including their terminators, so that a changed line end is a difference too. */
function splitKeep(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') { out.push(text.slice(start, i + 1)); start = i + 1; }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** Hunks of a line diff (LCS): [{ aStart, aEnd, bStart, bEnd }] with 0-based half-open ranges. */
function diff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const hunks = [];
  let i = 0, j = 0, cur = null;
  const flush = () => { if (cur) { cur.aEnd = i; cur.bEnd = j; hunks.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { aStart: i, bStart: j };
    if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) j++;
    else i++;
  }
  flush();
  return hunks;
}

const patchesMd = readFileSync(join(here, 'PATCHES.md'), 'utf8');
const listed = new Set([...patchesMd.matchAll(/`([A-Za-z]+\.(?:CPP|h)):(\d+(?:-\d+)?\+?)`/g)].map((m) => `${m[1]}:${m[2]}`));
const found = new Set();
let problems = 0;

for (const name of readdirSync(srcDir).sort()) {
  const ref = join(refDir, name);
  if (!existsSync(ref)) { console.log(`${name}: no original of this name`); problems++; continue; }
  const a = splitKeep(readFileSync(ref, 'latin1'));
  const b = splitKeep(readFileSync(join(srcDir, name), 'latin1'));
  for (const h of diff(a, b)) {
    const range = h.aEnd > h.aStart
      ? (h.aEnd - h.aStart === 1 ? `${h.aStart + 1}` : `${h.aStart + 1}-${h.aEnd}`)
      : `${h.aStart}+`;
    const key = `${name}:${range}`;
    found.add(key);
    const added = b.slice(h.bStart, h.bEnd);
    const marked = added.some((l) => l.includes('[easy68k-mac]'));
    if (!marked) { console.log(`UNMARKED hunk ${key}`); problems++; }
    if (!listed.has(key)) { console.log(`hunk ${key} is not listed in PATCHES.md`); problems++; }
    if (list) {
      console.log(`--- ${key}`);
      for (const l of a.slice(h.aStart, h.aEnd)) console.log(`- ${l.replace(/\r?\n$/, '')}`);
      for (const l of added) console.log(`+ ${l.replace(/\r?\n$/, '')}`);
    }
  }
}
for (const key of listed) {
  if (!found.has(key)) { console.log(`PATCHES.md lists ${key}, but there is no such hunk`); problems++; }
}
console.log(problems ? `${problems} problem(s)` : `OK: ${found.size} hunks, all marked and listed in PATCHES.md`);
process.exit(problems ? 1 : 0);
