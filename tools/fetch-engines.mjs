#!/usr/bin/env node
// `npm run fetch:engines` (ARCHITECTURE.md 7.2, 7.3): installs prebuilt
// engines into engine/dist/ for contributors without Emscripten, from the
// `engine-dist.zip` asset of the latest GitHub release.
//
//     node tools/fetch-engines.mjs [--repo owner/name] [--tag vX.Y.Z]
//     node tools/fetch-engines.mjs --file path/to/engine-dist.zip
//
// The repository is taken from --repo, else GITHUB_REPOSITORY, else the
// "origin" remote of this checkout (10.2, O-14: nothing is hard-coded).
// GITHUB_TOKEN, when set, is sent to the GitHub API (higher rate limit).
// The zip may hold the files at its top level or inside one folder. Existing
// files in engine/dist/ with the same names are replaced; others are kept.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repo, 'engine', 'dist');
const ASSET = 'engine-dist.zip';

class FetchError extends Error {}

/** Stops with a message. Thrown, not process.exit(): exiting while fetch()
 * still holds sockets trips a libuv assertion on Windows. */
function fail(message) {
  throw new FetchError(message);
}

function parseArgs(argv) {
  const options = { repo: null, tag: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => argv[++i] ?? fail(`${arg} needs a value`);
    if (arg === '--repo') options.repo = value();
    else if (arg === '--tag') options.tag = value();
    else if (arg === '--file') options.file = value();
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node tools/fetch-engines.mjs [--repo owner/name] [--tag vX.Y.Z] | --file engine-dist.zip');
      process.exit(0);
    } else fail(`unknown argument "${arg}"`);
  }
  return options;
}

function repositoryFromGit() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

async function download(options) {
  const repository = options.repo ?? process.env.GITHUB_REPOSITORY ?? repositoryFromGit();
  if (!repository)
    fail('cannot tell which GitHub repository to use: pass --repo owner/name (no "origin" remote found)');
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'easy68k-cross-platform-fetch-engines' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const api = `https://api.github.com/repos/${repository}/releases/${options.tag ? `tags/${options.tag}` : 'latest'}`;
  console.log(`fetch-engines: ${api}`);
  const response = await fetch(api, { headers });
  if (response.status === 404)
    fail(`no ${options.tag ? `release ${options.tag}` : 'published release'} in ${repository}`);
  if (!response.ok) fail(`GitHub API answered ${response.status} ${response.statusText}`);
  const release = await response.json();
  const asset = (release.assets ?? []).find((a) => a.name === ASSET);
  if (!asset) fail(`release ${release.tag_name} of ${repository} has no ${ASSET}`);
  console.log(`fetch-engines: downloading ${asset.browser_download_url} (${asset.size} bytes)`);
  const file = await fetch(asset.browser_download_url, { headers: { 'User-Agent': headers['User-Agent'] } });
  if (!file.ok) fail(`download failed: ${file.status} ${file.statusText}`);
  return { bytes: Buffer.from(await file.arrayBuffer()), source: `${repository} ${release.tag_name}` };
}

/** Minimal zip reader: stored and deflated entries, no encryption, no zip64. */
function readZip(bytes) {
  const eocdMin = 22;
  let eocd = -1;
  for (let i = bytes.length - eocdMin; i >= Math.max(0, bytes.length - eocdMin - 65535); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error(`corrupt zip entry ${name}`);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip entry ${name} uses unsupported compression method ${method}`);
    if (data.length !== size) throw new Error(`zip entry ${name}: size mismatch`);
    entries.push({ name: name.replaceAll('\\', '/'), data });
  }
  return entries;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { bytes, source } = options.file
    ? { bytes: readFileSync(options.file), source: options.file }
    : await download(options);

  let entries;
  try {
    entries = readZip(bytes);
  } catch (error) {
    fail(`${source}: ${error.message}`);
  }
  if (!entries.length) fail(`${source}: the zip is empty`);
  // Strip one common top-level folder ("engine-dist/sim68k.wasm" -> "sim68k.wasm").
  const tops = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')));
  const strip = tops.size === 1 && !tops.has('') ? `${[...tops][0]}/` : '';
  mkdirSync(distDir, { recursive: true });
  for (const { name, data } of entries) {
    const relativeName = name.slice(strip.length);
    if (
      !relativeName ||
      relativeName.split('/').some((part) => part === '..' || part === '') ||
      /^[a-z]:/i.test(relativeName)
    ) {
      fail(`${source}: refusing unsafe entry name "${name}"`);
    }
    const target = join(distDir, ...relativeName.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    console.log(`  engine/dist/${relativeName} (${data.length} bytes)`);
  }
  console.log(`fetch-engines: installed ${entries.length} file(s) from ${source} into engine/dist/`);
}

main().catch((error) => {
  if (!(error instanceof FetchError)) throw error;
  console.error(`fetch-engines: ${error.message}`);
  process.exitCode = 1;
});
