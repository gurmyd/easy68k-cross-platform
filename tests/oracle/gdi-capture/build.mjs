// Builds the GDI capture program with MSVC (ARCHITECTURE.md 6.2.3). Owner: T2.
//
//     node tests/oracle/gdi-capture/build.mjs        (run.mjs calls buildCapture() itself)
//
// Output: build/gdi-capture/gdi-capture.exe, a 64-bit console program with the DPI-unaware manifest
// gdi-capture.manifest embedded. vcvars64.bat is found with vswhere, in the usual Visual Studio 2022
// folders, or through the VCVARS64 environment variable.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
export const BUILD_DIR = join(repo, 'build', 'gdi-capture');
export const EXE = join(BUILD_DIR, 'gdi-capture.exe');

function vswhereInstallations() {
  const vswhere = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Microsoft Visual Studio',
    'Installer',
    'vswhere.exe',
  );
  if (!existsSync(vswhere)) return Promise.resolve([]);
  return new Promise((resolvePromise) => {
    const child = spawn(vswhere, ['-latest', '-products', '*', '-property', 'installationPath'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolvePromise([]));
    child.on('close', () => resolvePromise(out.split(/\r?\n/).filter(Boolean)));
  });
}

async function findVcvars64() {
  if (process.env.VCVARS64 && existsSync(process.env.VCVARS64)) return process.env.VCVARS64;
  const candidates = (await vswhereInstallations()).map((p) => join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'));
  for (const edition of ['Community', 'Professional', 'Enterprise', 'BuildTools']) {
    for (const base of [
      'C:\\Program Files\\Microsoft Visual Studio\\2022',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
    ]) {
      candidates.push(join(base, edition, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'));
    }
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('vcvars64.bat not found; install the MSVC build tools or set VCVARS64 to its path.');
  return found;
}

function runBatch(batchFile) {
  return new Promise((resolvePromise, reject) => {
    // windowsHide: no console window on the desktop, whatever the parent process is attached to.
    const child = spawn('cmd.exe', ['/d', '/c', batchFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise(output) : reject(new Error(`build failed (exit ${code})\n${output}`)),
    );
  });
}

/** Compiles capture.cpp; returns the path of the program. */
export async function buildCapture() {
  if (process.platform !== 'win32') throw new Error('The GDI capture runs on Windows only (it measures Windows GDI).');
  const vcvars = await findVcvars64();
  mkdirSync(join(BUILD_DIR, 'obj'), { recursive: true });
  const lines = [
    '@echo off',
    `call "${vcvars}" >nul`,
    'if errorlevel 1 exit /b 1',
    `cl /nologo /O2 /EHsc /MT /W4 /std:c++17 /D_CRT_SECURE_NO_WARNINGS /Fo"${join(BUILD_DIR, 'obj')}\\\\" /Fe"${EXE}" "${join(here, 'capture.cpp')}" ` +
      `/link /SUBSYSTEM:CONSOLE /MANIFEST:EMBED /MANIFESTINPUT:"${join(here, 'gdi-capture.manifest')}" gdi32.lib user32.lib`,
    'if errorlevel 1 exit /b 1',
  ];
  const batch = join(BUILD_DIR, 'build.cmd');
  writeFileSync(batch, lines.join('\r\n') + '\r\n');
  const output = await runBatch(batch);
  const diagnostics = output.split(/\r?\n/).filter((l) => /\b(warning|error) [A-Z]+\d+/.test(l));
  for (const line of diagnostics) console.log(line);
  return EXE;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildCapture().then(
    (exe) => console.log(`built ${exe}`),
    (error) => {
      console.error(String(error.message || error));
      process.exit(1);
    },
  );
}
