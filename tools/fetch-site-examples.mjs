#!/usr/bin/env node
// Downloads the example programs of the EASy68K web site into build/corpus-local/ (ARCHITECTURE.md
// 6.3, the `site` set of the test corpus).
//
//     node tools/fetch-site-examples.mjs [--only <name>[,<name>...]] [--out <dir>] [--from <dir>]
//
// The examples may not be redistributed (docs/porting/ground-truth.md 3.2), so the repository holds
// only their addresses and hashes: tests/corpus/site-examples.json lists every archive with its URL
// and SHA-256 and every file it unpacks to with its SHA-256. This script downloads each archive,
// checks it, unpacks it and checks every file. Anything that does not match is an error: the tests
// that use the set compare against hashes recorded for exactly these bytes.
//
//   --only   archive names (the `name` of the list, e.g. `tutorial4,lineArt`); default: all
//   --out    target folder; default build/corpus-local (git-ignored)
//   --from   take the archives from a local folder laid out as <category>/<name>/<file> instead of
//            the network (a mirror, or reference/examples/site/_downloads on the machine that has it)
//
// Result: <out>/site/<category>/<name>/... and the downloaded archives in <out>/_downloads/.
// An archive that is already in <out>/_downloads/ with the right hash is not downloaded again.
// The archives are untrusted input: they are only unpacked (tests/oracle/wine/common/unzip.ts
// refuses paths that leave the target folder), never executed.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unzip } from '../tests/oracle/wine/common/unzip.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE_INDEX_PATH = join(REPO, 'tests', 'corpus', 'site-examples.json');
/** Sent with every request: a generic name, nothing about the machine or its user. */
const USER_AGENT = 'easy68k-cross-platform-tests (fetch-site-examples)';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @typedef {{ path: string, sha256: string, bytes: number }} SiteFile
 * @typedef {{ category: string, name: string, url: string, mirrors?: string[], sha256: string, bytes: number, files: SiteFile[] }} SiteArchive
 * @typedef {{ archives: SiteArchive[], skipped: { category: string, name: string, url: string, reason: string }[] }} SiteIndex
 */

/** @returns {SiteIndex} */
export function loadSiteIndex(path = SITE_INDEX_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** The file name of an archive, from its URL (`.../Cpp%20to%2068K.pdf` -> `Cpp to 68K.pdf`). */
export function archiveFileName(archive) {
  return decodeURIComponent(basename(new URL(archive.url).pathname));
}

/**
 * Checks an archive against the list and returns its files, or throws with the reason. Nothing is
 * written. `bytes` is the archive as downloaded.
 * @param {SiteArchive} archive
 * @param {Uint8Array} bytes
 * @returns {{ path: string, data: Uint8Array }[]}
 */
export function verifyArchive(archive, bytes) {
  const got = sha256(bytes);
  if (got !== archive.sha256) {
    throw new Error(`${archive.name}: the archive has SHA-256 ${got}, the list says ${archive.sha256}`);
  }
  const entries = unzip(bytes).filter((entry) => !entry.directory);
  const expected = new Map(archive.files.map((file) => [file.path, file]));
  const files = [];
  for (const entry of entries) {
    const file = expected.get(entry.name);
    if (!file) throw new Error(`${archive.name}: the archive holds ${entry.name}, which the list does not name`);
    if (sha256(entry.data) !== file.sha256)
      throw new Error(`${archive.name}: ${entry.name} does not have the listed SHA-256`);
    expected.delete(entry.name);
    files.push({ path: entry.name, data: entry.data });
  }
  if (expected.size > 0) {
    throw new Error(`${archive.name}: the archive lacks ${[...expected.keys()].join(', ')}`);
  }
  return files;
}

/**
 * Unpacks a verified archive into `<out>/site/<category>/<name>/`, replacing what was there.
 * @returns {number} the number of files written
 */
export function installArchive(archive, bytes, out) {
  const files = verifyArchive(archive, bytes);
  const target = join(out, 'site', archive.category, archive.name);
  rmSync(target, { recursive: true, force: true });
  for (const file of files) {
    const path = join(target, ...file.path.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.data);
  }
  return files.length;
}

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The archive's bytes: from `--from`, from an earlier download with the right hash, or the network. */
async function obtain(archive, out, from) {
  const fileName = archiveFileName(archive);
  if (from) return new Uint8Array(readFileSync(join(from, archive.category, archive.name, fileName)));
  const cached = join(out, '_downloads', archive.category, fileName);
  if (existsSync(cached)) {
    const bytes = new Uint8Array(readFileSync(cached));
    if (sha256(bytes) === archive.sha256) return bytes;
  }
  // The address the site links to first, then the mirrors of the list (three archives were hosted
  // on another server that no longer has them; the list names their Internet Archive copies).
  const problems = [];
  for (const url of [archive.url, ...(archive.mirrors ?? [])]) {
    try {
      const bytes = await download(url);
      if (sha256(bytes) !== archive.sha256) throw new Error(`${url}: not the listed file (SHA-256 differs)`);
      mkdirSync(dirname(cached), { recursive: true });
      writeFileSync(cached, bytes);
      return bytes;
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(problems.join('; '));
}

function parseArguments(argv) {
  const options = { only: null, out: join(REPO, 'build', 'corpus-local'), from: null };
  for (let index = 0; index < argv.length; index++) {
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${argv[index - 1]} needs a value`);
      return next;
    };
    if (argv[index] === '--only') options.only = new Set(value().split(','));
    else if (argv[index] === '--out') options.out = resolve(value());
    else if (argv[index] === '--from') options.from = resolve(value());
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const index = loadSiteIndex();
  const wanted = index.archives.filter((archive) => !options.only || options.only.has(archive.name));
  if (options.only) {
    const known = new Set(index.archives.map((archive) => archive.name));
    const unknown = [...options.only].filter((name) => !known.has(name));
    if (unknown.length > 0) throw new Error(`not in ${SITE_INDEX_PATH}: ${unknown.join(', ')}`);
  }
  let files = 0;
  const failed = [];
  // One request at a time: the site is a small server.
  for (const archive of wanted) {
    try {
      const bytes = await obtain(archive, options.out, options.from);
      files += installArchive(archive, bytes, options.out);
    } catch (error) {
      failed.push(archive.name);
      console.error(
        `FAILED ${archive.category}/${archive.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const skipped of options.only ? [] : index.skipped) {
    console.log(`skipped ${skipped.category}/${skipped.name}: ${skipped.reason}`);
  }
  console.log(
    `${wanted.length - failed.length} of ${wanted.length} archives unpacked into ${join(options.out, 'site')} (${files} files)`,
  );
  if (failed.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
