#!/usr/bin/env node
// Builds the simulator twin with MSVC as a 32-bit (x86) program, twice:
//
//     node tests/oracle/native-twin/build-sim-twin.mjs [--only O2|Od] [--verbose]
//
//   build/native-twin/sim-O2/sim-twin.exe   optimised (/O2)
//   build/native-twin/sim-Od/sim-twin.exe   not optimised (/Od)
//
// Sources: the patched original files of engine/sim/src and the engine's shim (engine/sim/shim),
// the same lists engine/sim/build.mjs compiles (read from that file, so that they cannot drift
// apart), all of them - shim/hostfile.cpp included, whose streams of the Borland run-time
// (engine/sim/shim/STDIO-MODEL.md) are exactly the kind of code this oracle exists for - plus
// sim-twin/host-native.cpp (the host's file interface over real files, and fopencookie(), which
// the Microsoft C library lacks) and the twin's driver (sim-twin/driver.cpp).
//
// Flags, against the Emscripten build (engine/sim/PATCHES.md, "Compiler flags"):
//   /EHa         C++ exceptions, and catch (...) also catches access violations, as Borland's did
//   /MT /W3      static run-time library; the original files are compiled with /w as with -w there
//   /STACK:16MB  room for the recursion the engine's guard allows (1000 levels) at /Od
// Not reproduced on purpose (finding out whether a result depends on them is the point of the
// twin): -fwrapv, -fwrapv-pointer, -ftrivial-auto-var-init=zero. MSVC's defaults already match
// -fsigned-char, -fno-strict-aliasing and Ctrl-Z as end of file (-fms-extensions).
//
// Windows only. Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostics, runWithVcvars } from './msvc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const simDir = join(repo, 'engine', 'sim');
const twinDir = join(here, 'sim-twin');

export const SIM_TWIN_VARIANTS = ['O2', 'Od'];

/** Path of a built twin. @param {'O2'|'Od'} variant */
export function simTwinPath(variant) {
  return join(repo, 'build', 'native-twin', `sim-${variant}`, 'sim-twin.exe');
}

/** The ORIGINAL_SOURCES and SHIM_SOURCES lists of engine/sim/build.mjs. */
export function engineSourceLists() {
  const text = readFileSync(join(simDir, 'build.mjs'), 'utf8');
  const list = (name) => {
    const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(text);
    if (!match) throw new Error(`engine/sim/build.mjs: ${name} not found`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };
  return { original: list('ORIGINAL_SOURCES'), shim: list('SHIM_SOURCES') };
}

const quote = (p) => `"${p}"`;

/** Every file below dir, as paths relative to the repository with forward slashes, sorted. */
function filesBelow(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(relative(repo, path).split('\\').join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * SHA-256 over everything a simulator twin is built from: engine/sim/build.mjs (the source lists),
 * every file of engine/sim/src and engine/sim/shim, the twin's own folder sim-twin/ and this
 * script (the flags). A build writes it next to the program (sources.sha256); a twin whose stamp
 * differs was built from other sources and says nothing about today's engine.
 */
export function simTwinInputsDigest() {
  const hash = createHash('sha256');
  const files = [
    relative(repo, join(simDir, 'build.mjs')).split('\\').join('/'),
    relative(repo, fileURLToPath(import.meta.url))
      .split('\\')
      .join('/'),
    ...filesBelow(join(simDir, 'src')),
    ...filesBelow(join(simDir, 'shim')),
    ...filesBelow(twinDir),
  ];
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(join(repo, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Path of the stamp a build writes next to the twin. @param {'O2'|'Od'} variant */
export function simTwinStampPath(variant) {
  return join(dirname(simTwinPath(variant)), 'sources.sha256');
}

/**
 * 'missing' (not built), 'stale' (built from other sources than today's, or before stamps were
 * written) or 'current'.
 * @param {'O2'|'Od'} variant
 * @param {string} [digest] simTwinInputsDigest()
 * @param {string} [exe] the program (default simTwinPath(variant)); its stamp lies beside it
 */
export function simTwinState(variant, digest = simTwinInputsDigest(), exe = simTwinPath(variant)) {
  if (!existsSync(exe)) return 'missing';
  const stamp = join(dirname(exe), 'sources.sha256');
  if (!existsSync(stamp)) return 'stale';
  return readFileSync(stamp, 'utf8').trim() === digest ? 'current' : 'stale';
}

/** @param {'O2'|'Od'} variant @param {{ verbose?: boolean }} [options] */
export async function buildSimTwin(variant, options = {}) {
  if (process.platform !== 'win32') throw new Error('The native twins are built with MSVC on Windows.');
  const { original, shim } = engineSourceLists();
  // taken before compiling, so that a source edited during the build leaves the twin stale
  const digest = simTwinInputsDigest();
  const outDir = dirname(simTwinPath(variant));
  rmSync(outDir, { recursive: true, force: true });
  for (const sub of ['src', 'shim', 'twin']) mkdirSync(join(outDir, 'obj', sub), { recursive: true });
  const shimSources = shim;

  const common = [
    '/nologo',
    '/c',
    `/${variant}`,
    '/EHa',
    '/MT',
    '/MP4',
    '/D_CRT_SECURE_NO_WARNINGS',
    '/D_CRT_NONSTDC_NO_WARNINGS',
    `/FI${quote(join(twinDir, 'native-prelude.h'))}`,
    `/I${quote(join(twinDir, 'include'))}`,
    `/I${quote(join(simDir, 'src'))}`,
    `/I${quote(join(simDir, 'shim'))}`,
    `/I${quote(join(simDir, 'shim', 'vcl'))}`,
    `/I${quote(twinDir)}`,
  ].join(' ');
  const obj = (sub) => `/Fo${quote(join(outDir, 'obj', sub) + '\\\\')}`;
  const exe = simTwinPath(variant);
  const output = await runWithVcvars(join(outDir, 'build.cmd'), [
    `cl ${common} /w ${obj('src')} ${original.map((n) => quote(join(simDir, 'src', n))).join(' ')}`,
    `cl ${common} /W3 /wd4996 ${obj('shim')} ${shimSources.map((n) => quote(join(simDir, 'shim', n))).join(' ')} ${quote(join(twinDir, 'host-native.cpp'))}`,
    `cl /nologo /c /${variant} /EHa /MT /W3 /D_CRT_SECURE_NO_WARNINGS /I${quote(join(simDir, 'shim'))} /I${quote(twinDir)} ${obj('twin')} ${quote(join(twinDir, 'driver.cpp'))}`,
    `link /nologo /OUT:${quote(exe)} ${quote(join(outDir, 'obj', 'src', '*.obj'))} ${quote(join(outDir, 'obj', 'shim', '*.obj'))} ${quote(join(outDir, 'obj', 'twin', '*.obj'))} /STACK:16777216`,
  ]);
  const found = diagnostics(output);
  if (options.verbose) console.log(output);
  else if (found.length) console.log(`sim-${variant}: ${found.length} compiler diagnostics (--verbose shows them)`);
  if (!existsSync(exe)) throw new Error(`build of ${exe} reported success but the file is missing\n${output}`);
  writeFileSync(simTwinStampPath(variant), `${digest}\n`);
  return exe;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf('--only');
  const variants = onlyAt >= 0 ? [argv[onlyAt + 1]] : SIM_TWIN_VARIANTS;
  (async () => {
    for (const variant of variants) {
      if (!SIM_TWIN_VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
      console.log(`built ${await buildSimTwin(variant, { verbose: argv.includes('--verbose') })}`);
    }
  })().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  });
}
