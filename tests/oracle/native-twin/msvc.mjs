// Finding and running the Microsoft C++ compiler (32-bit, x86) for the native twins.
//
// vcvars32.bat is taken from the VCVARS32 environment variable if it is set, otherwise from the
// newest Visual Studio installation with the x86/x64 C++ tools that vswhere reports (any
// version and edition, so that a CI runner with a newer Visual Studio works too).
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** @returns {string} the path of vcvars32.bat */
export function findVcvars32() {
  if (process.env.VCVARS32 && existsSync(process.env.VCVARS32)) return process.env.VCVARS32;
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (existsSync(vswhere)) {
    const result = spawnSync(
      vswhere,
      [
        '-latest',
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property',
        'installationPath',
      ],
      { encoding: 'utf8' },
    );
    const installation = (result.stdout ?? '').trim().split(/\r?\n/)[0];
    if (installation) {
      const candidate = join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars32.bat');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('vcvars32.bat not found: install the Visual Studio C++ tools (x86/x64) or set VCVARS32.');
}

/**
 * Run cmd.exe lines after vcvars32.bat; every line is followed by an error check.
 * @param {string} batchFile where to write the batch file
 * @param {string[]} commands
 * @returns {Promise<string>} the combined output
 */
export function runWithVcvars(batchFile, commands) {
  const lines = ['@echo off', `call "${findVcvars32()}" >nul`, 'if errorlevel 1 exit /b 1'];
  for (const command of commands) lines.push(command, 'if errorlevel 1 exit /b 1');
  writeFileSync(batchFile, lines.join('\r\n') + '\r\n');
  return new Promise((resolvePromise, reject) => {
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

/** The compiler diagnostics (warning/error lines) of a build output. */
export function diagnostics(output) {
  return output.split(/\r?\n/).filter((l) => /\b(warning|error) [A-Z]+\d+/.test(l));
}
