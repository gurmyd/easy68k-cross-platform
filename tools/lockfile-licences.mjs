// Lists every package that package-lock.json adds or changes against another version of the
// lockfile, with its licence, and fails when one is not MIT, BSD or ISC (ARCHITECTURE-PLUS P2.3,
// P2.4, P5 N0; the integration pass of P6.4 attaches the list to its pull request).
//
//   node tools/lockfile-licences.mjs                  against origin/main
//   node tools/lockfile-licences.mjs --base <ref>     against the lockfile of a commit or branch
//   node tools/lockfile-licences.mjs --before <file>  against a lockfile on disk
//
// The licence is the `license` field npm writes into the lockfile from each package's own
// package.json. A package without one, or with any other licence, fails the check. Packages with
// an install script are named as well (`hasInstallScript` in the lockfile), because the root
// package.json's `allowScripts` policy needs a decision for each.
//
// Prints one line per package: `added|changed  <path>  <version>  <licence>[  install script]`,
// then `N packages added or changed, M not MIT, BSD or ISC`. Exit code 0 when M is 0 and no
// added or changed package has an install script; 1 otherwise.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause']);

function argument(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function readBefore() {
  const file = argument('--before');
  if (file) return { label: file, text: readFileSync(file, 'utf8') };
  const ref = argument('--base') ?? 'origin/main';
  const text = execFileSync('git', ['show', `${ref}:package-lock.json`], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  return { label: ref, text };
}

/** A licence expression is allowed when every alternative of an OR is (`(MIT OR Apache-2.0)` is not). */
function allowed(license) {
  if (typeof license !== 'string' || license === '') return false;
  const parts = license.replace(/[()]/g, '').split(/\s+(?:AND|OR)\s+/);
  return parts.every((part) => ALLOWED.has(part.trim()));
}

const before = readBefore();
const old = JSON.parse(before.text).packages ?? {};
const now = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')).packages ?? {};

const rows = [];
for (const [path, entry] of Object.entries(now)) {
  if (path === '' || entry.link) continue; // the root and the workspace links
  const previous = old[path];
  if (previous && previous.version === entry.version && previous.integrity === entry.integrity) continue;
  rows.push({
    change: previous ? 'changed' : 'added',
    path,
    version: entry.version ?? '?',
    license: entry.license ?? '(none)',
    script: entry.hasInstallScript === true,
    ok: allowed(entry.license),
  });
}
const removed = Object.keys(old).filter((path) => path !== '' && !(path in now) && !old[path].link);

console.log(`package-lock.json against ${before.label}:`);
for (const row of rows) {
  console.log(
    `${row.change.padEnd(8)} ${row.path}  ${row.version}  ${row.license}${row.script ? '  install script' : ''}${row.ok ? '' : '  NOT ALLOWED'}`,
  );
}
for (const path of removed) console.log(`removed  ${path}`);
const bad = rows.filter((row) => !row.ok);
const scripts = rows.filter((row) => row.script);
console.log(
  `${rows.length} packages added or changed, ${bad.length} not MIT, BSD or ISC, ${scripts.length} with an install script`,
);
process.exit(bad.length === 0 && scripts.length === 0 ? 0 : 1);
