#!/usr/bin/env node
// Fetches the official EASy68K v5.16.1 distribution for the Wine oracle (ARCHITECTURE.md 6.2.2).
//
//     node tests/oracle/wine/common/fetch-official.mjs [--out <dir>] [--from <EASy68K.zip>]
//
// Downloads http://www.easy68k.com/files/EASy68K.zip (the "portable" archive of the EASy68K site),
// checks its SHA-256 against the value recorded in docs/porting/ground-truth.md section 2, and
// unpacks it into reference/official-extracted/ (git-ignored; `--out` names another folder). The
// program files of this archive are byte for byte those of the installer.
//
// The programs are only stored there. They are never started on this machine: the oracle mounts
// the folder read-only into its container and runs them there, under Wine. Nothing of the
// distribution is copied into the repository or into the Docker image.
//
// When the folder already holds the right programs, nothing is downloaded.
//   --from   use a local copy of EASy68K.zip instead of the network (it is checked the same way)

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOfficialFolder } from './docker.mjs';
import { unzip } from './unzip.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const URL_OF_ARCHIVE = 'http://www.easy68k.com/files/EASy68K.zip';
const SHA256_OF_ARCHIVE = '825153468117be9ec0d05563de1d79ff17c77b88a15434d731e6acbb5e265ec3';
/** Every file of the archive is below this folder; it is dropped when unpacking. */
const TOP_FOLDER = 'EASy68K/';

function parseArguments(argv) {
  const options = { out: join(REPO, 'reference', 'official-extracted'), from: null };
  for (let index = 0; index < argv.length; index++) {
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${argv[index - 1]} needs a value`);
      return next;
    };
    if (argv[index] === '--out') options.out = resolve(value());
    else if (argv[index] === '--from') options.from = resolve(value());
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  try {
    assertOfficialFolder(options.out);
    console.log(`${options.out} already holds the official v5.16.1 programs`);
    return;
  } catch {
    // Not there yet (or incomplete): fetch it.
  }
  let archive;
  if (options.from) {
    archive = new Uint8Array(readFileSync(options.from));
  } else {
    const response = await fetch(URL_OF_ARCHIVE, {
      headers: { 'user-agent': 'easy68k-cross-platform-tests (fetch-official)' },
    });
    if (!response.ok) throw new Error(`${URL_OF_ARCHIVE}: HTTP ${response.status} ${response.statusText}`);
    archive = new Uint8Array(await response.arrayBuffer());
  }
  const hash = createHash('sha256').update(archive).digest('hex');
  if (hash !== SHA256_OF_ARCHIVE) {
    throw new Error(`the archive has SHA-256 ${hash}, expected ${SHA256_OF_ARCHIVE}: not the v5.16.1 distribution`);
  }
  let count = 0;
  for (const entry of unzip(archive)) {
    if (entry.directory || !entry.name.startsWith(TOP_FOLDER)) continue;
    const path = join(options.out, ...entry.name.slice(TOP_FOLDER.length).split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.data);
    count++;
  }
  assertOfficialFolder(options.out);
  console.log(`${count} files unpacked into ${options.out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
