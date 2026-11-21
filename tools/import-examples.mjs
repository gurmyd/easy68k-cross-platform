#!/usr/bin/env node
// `npm run import:examples` (ARCHITECTURE.md 5.8, work package H1): copies the ten official example
// programs and their six sounds into app/public/examples/, byte for byte.
//
//     node tools/import-examples.mjs [--source <folder>] [--out <folder>]
//
// Source: reference/examples/official/Examples (the examples of the EASy68K distribution, GPL).
// This script reads that one folder and nothing else under reference/examples: the third-party
// collections next to it (site, github) are not redistributable and never come into the
// repository. A test (features/help/examples.test.ts) checks that app/public/ holds no file from
// them.
//
// Output: the files under their original names (the 68000 sources keep their Windows-1252 bytes
// and CR LF line ends; app/public/** is marked `-text` in .gitattributes) and manifest.json, a
// sorted list of { name, size } that the web app reads to copy the examples into the browser
// store. Running the script twice gives identical files: the output folder is emptied first, the
// names are sorted by code unit, and nothing in the output depends on the time or the machine.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The kinds of file the folder may hold; anything else stops the import. */
const KINDS = /\.(x68|wav)$/i;

/** Code-unit order: the same on every platform, unlike localeCompare. */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function parseArgs(argv) {
  const options = {
    source: join(repo, 'reference', 'examples', 'official', 'Examples'),
    out: join(repo, 'app', 'public', 'examples'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--source') options.source = resolve(argv[++i] ?? '');
    else if (arg === '--out') options.out = resolve(argv[++i] ?? '');
    else {
      console.error('usage: node tools/import-examples.mjs [--source <folder>] [--out <folder>]');
      process.exit(arg === '--help' || arg === '-h' ? 0 : 2);
    }
  }
  return options;
}

export function importExamples({ source, out }) {
  const entries = readdirSync(source, { withFileTypes: true });
  const names = entries
    .map((entry) => {
      if (!entry.isFile()) throw new Error(`${source}: "${entry.name}" is not a file`);
      if (!KINDS.test(entry.name)) throw new Error(`${source}: "${entry.name}" is neither a program nor a sound`);
      return entry.name;
    })
    .sort(byCodeUnit);
  const folded = new Set(names.map((name) => name.toLowerCase()));
  if (folded.size !== names.length) throw new Error(`${source}: two names differ only in letter case`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = names.map((name) => {
    const bytes = readFileSync(join(source, name));
    writeFileSync(join(out, name), bytes);
    return { name, size: bytes.length };
  });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ files }, null, 2)}\n`);
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const files = importExamples(options);
  const programs = files.filter((file) => /\.x68$/i.test(file.name)).length;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  console.log(
    `import-examples: ${programs} programs and ${files.length - programs} sounds, ${total} bytes -> ${options.out}`,
  );
}
