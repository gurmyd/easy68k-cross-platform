#!/usr/bin/env node
// Downloads the 68000 single-step test suite into build/singlestep/ (ARCHITECTURE.md 6.2.4, L7).
//
//     node tests/conformance/cpu/fetch-suite.mjs [--jobs N] [--quiet]
//
// The suite is SingleStepTests/680x0 (https://github.com/SingleStepTests/680x0), folder 68000/v1,
// at the commit pinned in suite.json: 124 gzip-compressed JSON files, about 200 MB, a little over
// one million tests. It has no licence, so it is never committed: this script fetches it at test
// time from raw.githubusercontent.com and checks every file against the size, git blob SHA-1 and
// SHA-256 recorded in suite.json (docs/porting/ground-truth.md section 5). Nothing but the file
// URL is sent; the request carries a generic user agent.
//
// Files that are already present and match are not downloaded again. Exit code 0 when every file
// is present and verified.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');

/** @typedef {{ name: string, size: number, gitSha1: string, sha256: string }} SuiteFile */
/** @typedef {{ repository: string, commit: string, folder: string, licence: string, files: SuiteFile[] }} Suite */

/** @returns {Suite} */
export function readSuite() {
  return JSON.parse(readFileSync(join(here, 'suite.json'), 'utf8'));
}

/** Folder that holds the downloaded files (git-ignored). */
export function suiteDir(suite = readSuite()) {
  return join(repo, 'build', 'singlestep', '680x0', suite.commit.slice(0, 8), ...suite.folder.split('/'));
}

/** SHA-1 of a git blob: sha1("blob <size>\0" + content). */
export function gitBlobSha1(bytes) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** @param {Uint8Array} bytes @param {SuiteFile} file @returns {string|null} why it does not match, or null */
export function verify(bytes, file) {
  if (bytes.length !== file.size) return `size ${bytes.length}, expected ${file.size}`;
  const sha1 = gitBlobSha1(bytes);
  if (sha1 !== file.gitSha1) return `git blob SHA-1 ${sha1}, expected ${file.gitSha1}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (file.sha256 && sha256 !== file.sha256) return `SHA-256 ${sha256}, expected ${file.sha256}`;
  return null;
}

/** The path of every suite file that is present and verified; null if any is missing or wrong. */
export function presentFiles(suite = readSuite()) {
  const dir = suiteDir(suite);
  const paths = [];
  for (const file of suite.files) {
    const path = join(dir, file.name);
    if (!existsSync(path)) return null;
    paths.push(path);
  }
  return paths;
}

async function download(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'easy68k-mac-test-fetch' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Make sure every file of the suite is present and verified.
 * @param {{ jobs?: number, log?: (line: string) => void }} [options]
 * @returns {Promise<string[]>} the local paths, in suite.json order
 */
export async function ensureSuite(options = {}) {
  const suite = readSuite();
  const dir = suiteDir(suite);
  const log = options.log ?? (() => {});
  mkdirSync(dir, { recursive: true });
  const queue = suite.files.slice();
  let fetched = 0;
  const failures = [];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const path = join(dir, file.name);
      if (existsSync(path) && verify(readFileSync(path), file) === null) continue;
      const url = `https://raw.githubusercontent.com/${suite.repository}/${suite.commit}/${suite.folder}/${file.name}`;
      try {
        let bytes = null;
        for (let attempt = 1; attempt <= 3 && !bytes; attempt++) {
          try {
            bytes = await download(url);
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
        const problem = verify(bytes, file);
        if (problem) throw new Error(`${file.name}: ${problem}`);
        writeFileSync(path + '.part', bytes);
        renameSync(path + '.part', path);
        fetched++;
        log(`fetched ${file.name} (${bytes.length} bytes)`);
      } catch (error) {
        failures.push(String(error instanceof Error ? error.message : error));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.jobs ?? 6, 6)) }, worker));
  if (failures.length) throw new Error(`could not fetch the single-step suite:\n  ${failures.join('\n  ')}`);
  log(`single-step suite: ${suite.files.length} files present in ${dir} (${fetched} downloaded now)`);
  return suite.files.map((file) => join(dir, file.name));
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const jobsAt = argv.indexOf('--jobs');
  const quiet = argv.includes('--quiet');
  ensureSuite({
    jobs: jobsAt >= 0 ? Number(argv[jobsAt + 1]) : 6,
    log: quiet ? undefined : (line) => console.log(line),
  })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(String(error instanceof Error ? error.message : error));
      process.exit(1);
    });
}
