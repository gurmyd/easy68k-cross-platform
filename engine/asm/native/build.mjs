#!/usr/bin/env node
// Builds the two native twins of the assembler engine with MSVC, as 32-bit
// (x86) command-line programs without optimisation:
//
//     node engine/asm/native/build.mjs [--verbose]
//
//   build/asm-native/patched/ez68k-asm.exe    engine/asm/src (the patched sources) + shim
//   build/asm-native/unpatched/ez68k-asm.exe  the UNPATCHED v5.16.1 sources + the same shim
//
// The unpatched sources are copied from reference/src-edit68k/Edit68Kv5.16.1
// into build/asm-native/unpatched-src with only the two edits without which
// MSVC cannot build them at all (see PATCHES.md, "Native twins"):
//   P2  ERROR.CPP   "extern lineNumL68;" -> "extern int lineNumL68;"  (C++ has no implicit int)
//   P3  ASSEMBLE.CPP "extern int offsetMode;" -> "extern bool offsetMode;" (MSVC encodes the type
//       of a variable in its link name, so the mismatch is an unresolved external)
//
// Windows only (MSVC). vcvars32.bat is located with vswhere or the
// VCVARS32 environment variable.
//
// Flags: /Od (no optimisation), /EHa (catch(...) also catches access
// violations and divide errors, as Borland's catch(...) does), /MT, /J is
// NOT used (char stays signed), /STACK:16 MB (256 nested macro calls).

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGINAL_SOURCES, SHIM_SOURCES } from '../build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const asmDir = resolve(here, '..');
const repo = resolve(asmDir, '..', '..');
const outRoot = join(repo, 'build', 'asm-native');
const referenceDir = join(repo, 'reference', 'src-edit68k', 'Edit68Kv5.16.1');
const verbose = process.argv.includes('--verbose');

function findVcvars32() {
  if (process.env.VCVARS32 && existsSync(process.env.VCVARS32)) return process.env.VCVARS32;
  const candidates = [];
  for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
    for (const base of ['C:\\Program Files\\Microsoft Visual Studio\\2022', 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022']) {
      candidates.push(join(base, edition, 'VC', 'Auxiliary', 'Build', 'vcvars32.bat'));
    }
  }
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('vcvars32.bat not found; set VCVARS32 to its path.');
}

function run(batchFile) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('cmd.exe', ['/d', '/c', batchFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolvePromise(output) : reject(new Error(`build failed (exit ${code})\n${output}`))));
  });
}

/** Copy the reference sources and apply the two compile-only fixes. */
function prepareUnpatched() {
  const dir = join(outRoot, 'unpatched-src');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of [...ORIGINAL_SOURCES, 'asm.h', 'proto.h']) copyFileSync(join(referenceDir, name), join(dir, name));
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

async function buildVariant(name, srcDir, vcvars) {
  const outDir = join(outRoot, name);
  const objDir = join(outDir, 'obj');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(objDir, { recursive: true });
  const shimDir = join(asmDir, 'shim');
  const common = [
    '/nologo', '/c', '/Od', '/EHa', '/MT', '/W3', '/wd4996', '/wd4291', '/wd4838', '/wd4309', '/wd4101',
    '/D_CRT_SECURE_NO_WARNINGS', '/D_CRT_NONSTDC_NO_WARNINGS',
    `/FI"${join(shimDir, 'ez_prelude.h')}"`,
    `/I"${join(shimDir, 'include')}"`, `/I"${join(shimDir, 'include-lc')}"`, `/I"${srcDir}"`, `/I"${shimDir}"`,
    `/Fo"${objDir}\\\\"`,
  ].join(' ');
  const engine = ORIGINAL_SOURCES.filter((n) => n !== 'ERROR.CPP').map((n) => `"${join(srcDir, n)}"`).join(' ');
  const shim = SHIM_SOURCES.map((n) => `"${join(shimDir, n)}"`).join(' ');
  const exe = join(outDir, 'ez68k-asm.exe');
  const lines = [
    '@echo off',
    `call "${vcvars}" >nul`,
    'if errorlevel 1 exit /b 1',
    `cl ${common} ${engine} ${shim}`,
    'if errorlevel 1 exit /b 1',
    `cl ${common} /DprintError=ez_original_printError "${join(srcDir, 'ERROR.CPP')}"`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /c /Od /EHa /MT /W3 /D_CRT_SECURE_NO_WARNINGS /Fo"${objDir}\\\\" "${join(here, 'driver.cpp')}"`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /Fe"${exe}" "${objDir}\\*.obj" /link /STACK:16777216`,
    'if errorlevel 1 exit /b 1',
  ];
  const batch = join(outDir, 'build.cmd');
  writeFileSync(batch, lines.join('\r\n') + '\r\n');
  const output = await run(batch);
  const warnings = output.split(/\r?\n/).filter((l) => /\b(warning|error) [A-Z]+\d+/.test(l));
  if (verbose) console.log(output);
  else if (warnings.length) console.log(`${name}: ${warnings.length} compiler diagnostics (run with --verbose to see them)`);
  console.log(`built ${exe}`);
  return exe;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('The native twins are built with MSVC on Windows.');
  const vcvars = findVcvars32();
  mkdirSync(outRoot, { recursive: true });
  await buildVariant('patched', join(asmDir, 'src'), vcvars);
  if (existsSync(referenceDir)) await buildVariant('unpatched', prepareUnpatched(), vcvars);
  else console.log(`reference tree not found (${referenceDir}): unpatched twin skipped`);
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
