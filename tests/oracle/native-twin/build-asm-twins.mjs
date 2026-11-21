#!/usr/bin/env node
// Builds the assembler engine's native twins with MSVC (32-bit, x86) at both optimisation levels:
//
//     node tests/oracle/native-twin/build-asm-twins.mjs [--only patched-O2,...] [--verbose]
//
//   build/native-twin/asm-patched-O2/ez68k-asm.exe     engine/asm/src (patched) + shim, /O2
//   build/native-twin/asm-patched-Od/ez68k-asm.exe     the same, /Od
//   build/native-twin/asm-unpatched-O2/ez68k-asm.exe   the UNPATCHED v5.16.1 sources + shim, /O2
//   build/native-twin/asm-unpatched-Od/ez68k-asm.exe   the same, /Od
//
// The twins themselves belong to the assembler engine: engine/asm/native/build.mjs builds the /Od
// pair into build/asm-native/ for the engine's own tests, and driver.cpp there is their command
// line. This script compiles exactly the same files with exactly the same flags (read from that
// script, so that they cannot drift apart) and adds the /O2 pair that ARCHITECTURE.md 6.2.1 asks
// for; it writes only below build/native-twin/.
//
// The unpatched sources are reference/src-edit68k/Edit68Kv5.16.1 when present; otherwise the
// original archive Edit68Kv5.16.1.zip is fetched from the author's GitHub repository at a pinned
// commit, checked against its SHA-256 and unpacked below build/native-twin/original/ (it is GPL,
// like this project). They get only the two compile-only fixes of engine/asm/PATCHES.md
// ("Native twins"), applied by the same text replacements as engine/asm/native/build.mjs.
//
// Windows only. Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diagnostics, runWithVcvars } from './msvc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const asmDir = join(repo, 'engine', 'asm');
const outRoot = join(repo, 'build', 'native-twin');

export const ASM_TWIN_VARIANTS = ['patched-O2', 'patched-Od', 'unpatched-O2', 'unpatched-Od'];

/** The original source archive (GitHub: ProfKelly/EASy68K, the author's repository). */
export const ORIGINAL_ARCHIVE = Object.freeze({
  url: 'https://raw.githubusercontent.com/ProfKelly/EASy68K/dab554f09eb8168d2426a26593d8ff7b67e8515c/Edit68Kv5.16.1.zip',
  size: 216704,
  sha256: '9c8a901313daedc844f52fdcddf88cdcce6c378d6d366b38412d5aaa93114e4c',
});

/** @param {string} variant */
export function asmTwinPath(variant) {
  return join(outRoot, `asm-${variant}`, 'ez68k-asm.exe');
}

/** The compiler flags of engine/asm/native/build.mjs (the `common` list and the driver line). */
export function engineNativeFlags() {
  const text = readFileSync(join(asmDir, 'native', 'build.mjs'), 'utf8');
  const common = /const common = \[([\s\S]*?)\]\.join\(' '\);/.exec(text);
  if (!common) throw new Error('engine/asm/native/build.mjs: the "common" flag list was not found');
  const literal = [...common[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  for (const expected of ['/Od', '/EHa', '/MT']) {
    if (!literal.includes(expected))
      throw new Error(`engine/asm/native/build.mjs: flag ${expected} not found; update this script`);
  }
  if (!text.includes('/STACK:16777216'))
    throw new Error('engine/asm/native/build.mjs: /STACK:16777216 not found; update this script');
  return literal.filter((flag) => flag !== '/Od');
}

/** Folder with the unpatched Edit68Kv5.16.1 sources (fetched and unpacked if needed). */
export async function unpatchedSourceDir(log = () => {}) {
  const local = join(repo, 'reference', 'src-edit68k', 'Edit68Kv5.16.1');
  if (existsSync(join(local, 'ASSEMBLE.CPP'))) return local;
  const base = join(outRoot, 'original');
  const dir = join(base, 'Edit68Kv5.16.1');
  if (existsSync(join(dir, 'ASSEMBLE.CPP'))) return dir;
  mkdirSync(base, { recursive: true });
  const zip = join(base, 'Edit68Kv5.16.1.zip');
  let bytes = existsSync(zip) ? readFileSync(zip) : null;
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  if (!bytes || sha(bytes) !== ORIGINAL_ARCHIVE.sha256) {
    log(`fetching ${ORIGINAL_ARCHIVE.url}`);
    const response = await fetch(ORIGINAL_ARCHIVE.url, { headers: { 'user-agent': 'easy68k-mac-test-fetch' } });
    if (!response.ok) throw new Error(`${ORIGINAL_ARCHIVE.url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== ORIGINAL_ARCHIVE.size || sha(bytes) !== ORIGINAL_ARCHIVE.sha256) {
      throw new Error(`Edit68Kv5.16.1.zip: SHA-256 ${sha(bytes)}, expected ${ORIGINAL_ARCHIVE.sha256}`);
    }
    writeFileSync(zip, bytes);
  }
  unpackZip(zip, base);
  if (!existsSync(join(dir, 'ASSEMBLE.CPP'))) throw new Error(`${zip} unpacked, but ASSEMBLE.CPP is missing`);
  return dir;
}

/**
 * The bsdtar that Windows 10 and later ship in System32, by absolute path. A bare 'tar' can resolve
 * to GNU tar (Git for Windows puts its usr\bin on PATH, in Git Bash and on GitHub's runners), which
 * reads the "C:" of an archive path as a remote host name and cannot unpack zip archives anyway.
 */
export function systemTarPath(env = process.env) {
  return join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'tar.exe');
}

/** Unpack a zip archive into dir with the system bsdtar (Windows only). */
export function unpackZip(zip, dir) {
  const tar = systemTarPath();
  if (!existsSync(tar)) throw new Error(`could not unpack ${zip}: ${tar} not found (Windows 10 or later ships it)`);
  const result = spawnSync(tar, ['-xf', zip, '-C', dir], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`could not unpack ${zip} with ${tar}: ${result.stderr || result.error || `exit ${result.status}`}`);
  }
}

/** Copy the unpatched sources and apply the two compile-only fixes of engine/asm/PATCHES.md. */
function prepareUnpatched(sourceDir, original) {
  const dir = join(outRoot, 'asm-unpatched-src');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of [...original, 'asm.h', 'proto.h']) copyFileSync(join(sourceDir, name), join(dir, name));
  const fix = (name, from, to) => {
    const file = join(dir, name);
    const text = readFileSync(file, 'latin1');
    if (!text.includes(from)) throw new Error(`${name}: expected text not found: ${from}`);
    writeFileSync(file, text.replace(from, to), 'latin1');
  };
  fix('ERROR.CPP', 'extern lineNumL68;', 'extern int lineNumL68;');
  fix('ASSEMBLE.CPP', 'extern int offsetMode;', 'extern bool offsetMode;');
  return dir;
}

const quote = (p) => `"${p}"`;

/**
 * @param {string} variant one of ASM_TWIN_VARIANTS
 * @param {{ verbose?: boolean, log?: (line: string) => void }} [options]
 */
export async function buildAsmTwin(variant, options = {}) {
  if (process.platform !== 'win32') throw new Error('The native twins are built with MSVC on Windows.');
  if (!ASM_TWIN_VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
  const [kind, level] = variant.split('-');
  const { ORIGINAL_SOURCES, SHIM_SOURCES } = await import(pathToFileURL(join(asmDir, 'build.mjs')).href);
  const srcDir =
    kind === 'patched'
      ? join(asmDir, 'src')
      : prepareUnpatched(await unpatchedSourceDir(options.log), ORIGINAL_SOURCES);
  const shimDir = join(asmDir, 'shim');
  const outDir = dirname(asmTwinPath(variant));
  const objDir = join(outDir, 'obj');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(objDir, { recursive: true });
  // The engine's flags with its file paths filled in, at this optimisation level.
  const flags = engineNativeFlags().map((flag) => flag);
  const common = [
    `/${level}`,
    ...flags,
    '/MP4',
    `/FI${quote(join(shimDir, 'ez_prelude.h'))}`,
    `/I${quote(join(shimDir, 'include'))}`,
    `/I${quote(join(shimDir, 'include-lc'))}`,
    `/I${quote(srcDir)}`,
    `/I${quote(shimDir)}`,
    `/Fo${quote(objDir + '\\\\')}`,
  ].join(' ');
  const engine = ORIGINAL_SOURCES.filter((n) => n !== 'ERROR.CPP')
    .map((n) => quote(join(srcDir, n)))
    .join(' ');
  const shim = SHIM_SOURCES.map((n) => quote(join(shimDir, n))).join(' ');
  const exe = asmTwinPath(variant);
  const output = await runWithVcvars(join(outDir, 'build.cmd'), [
    `cl ${common} ${engine} ${shim}`,
    `cl ${common.replace(' /MP4', '')} /DprintError=ez_original_printError ${quote(join(srcDir, 'ERROR.CPP'))}`,
    `cl /nologo /c /${level} /EHa /MT /W3 /D_CRT_SECURE_NO_WARNINGS /Fo${quote(objDir + '\\\\')} ${quote(join(asmDir, 'native', 'driver.cpp'))}`,
    `cl /nologo /Fe${quote(exe)} ${quote(join(objDir, '*.obj'))} /link /STACK:16777216`,
  ]);
  const found = diagnostics(output);
  if (options.verbose) console.log(output);
  else if (found.length)
    (options.log ?? console.log)(`asm-${variant}: ${found.length} compiler diagnostics (--verbose shows them)`);
  if (!existsSync(exe)) throw new Error(`build of ${exe} reported success but the file is missing\n${output}`);
  return exe;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf('--only');
  const variants = onlyAt >= 0 ? argv[onlyAt + 1].split(',') : ASM_TWIN_VARIANTS;
  (async () => {
    for (const variant of variants) {
      console.log(
        `built ${await buildAsmTwin(variant, { verbose: argv.includes('--verbose'), log: (l) => console.log(l) })}`,
      );
    }
  })().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
