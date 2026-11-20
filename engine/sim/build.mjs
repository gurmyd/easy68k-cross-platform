#!/usr/bin/env node
// Builds the simulator engine with Emscripten:
//
//     node engine/sim/build.mjs [--debug] [--asan] [--verbose]
//
// Output (git-ignored):
//     engine/dist/sim68k.wasm          the engine
//     engine/dist/sim68k-loader.mjs    the Emscripten loader for it (ES module)
// Object files go to build/sim-obj.
//
// em++ is taken from the EMSDK environment variable if it is set (run
// emsdk_env first), otherwise from <repository>/.toolchain/emsdk.
// Works on Windows, macOS and Linux; needs nothing but Node.
//
// Why each compiler flag is there is explained in PATCHES.md.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const srcDir = join(here, 'src');
const shimDir = join(here, 'shim');
const objDir = join(repo, 'build', 'sim-obj');
const distDir = join(repo, 'engine', 'dist');

const args = new Set(process.argv.slice(2));
const debug = args.has('--debug');
// --asan: AddressSanitizer build for hunting memory errors.  It is slow and
// needs memory growth, so it is for testing only; it overwrites engine/dist.
const asan = args.has('--asan');
const verbose = args.has('--verbose');

/** Original v5.16.1 files (with the marked changes listed in PATCHES.md). */
const ORIGINAL_SOURCES = [
  'RUN.CPP', 'UTILS.CPP', 'CODE1.CPP', 'CODE2.CPP', 'CODE3.CPP', 'CODE4.CPP', 'CODE5.CPP',
  'CODE6.CPP', 'CODE7.CPP', 'CODE8.CPP', 'CODE9.CPP', 'SIMOPS2.CPP', 'STARTSIM.CPP',
  'BPoint.cpp', 'BPointExpr.cpp',
];
/** New files: the stand-in for the GUI forms and the exported API. */
const SHIM_SOURCES = [
  'globals.cpp', 'vcl.cpp', 'runloop.cpp', 'hostfile.cpp', 'form1.cpp', 'hardware.cpp',
  'simio.cpp', 'log.cpp', 'misc.cpp', 'api.cpp',
];

/** Flags for every C++ file.  See PATCHES.md, "Compiler flags". */
const COMMON_FLAGS = [
  '-std=gnu++14',                  // not C++17: "byte" must not clash with std::byte
  debug ? '-O0' : '-O2',
  ...(debug ? ['-g'] : []),
  '-fwasm-exceptions',             // the original's try / catch (...) blocks keep working
  '-fwrapv',                       // signed arithmetic wraps (two's complement), as on x86
  '-fwrapv-pointer',               // pointer arithmetic wraps too (&memory[unmasked index])
  '-fno-strict-aliasing',          // (long *)&memory[..], (short *)&D[0], (long *)&SR ...
  '-fsigned-char',                 // plain char is signed, as in the Borland build
  '-ftrivial-auto-var-init=zero',  // locals the original reads uninitialised are 0
  '-fms-extensions',               // a Ctrl-Z byte ends a source file (18 of the originals end in one)
  ...(asan ? ['-fsanitize=address', '-g'] : []),
  '-include', join(shimDir, 'prelude.h'),
  '-I', srcDir, '-I', shimDir, '-I', join(shimDir, 'vcl'),
];
/** The original files are compiled without warnings (they are not to be edited). */
const ORIGINAL_FLAGS = ['-w'];
const SHIM_FLAGS = ['-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-nonportable-include-path'];

const LINK_FLAGS = [
  debug ? '-O0' : '-O2',
  ...(debug ? ['-g', '-sASSERTIONS=2', '-sSTACK_OVERFLOW_CHECK=2'] : []),
  '-fwasm-exceptions',
  '-sWASM_LEGACY_EXCEPTIONS=1',    // the exception encoding every current browser supports
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sEXPORT_NAME=createSim68kModule',
  '-sENVIRONMENT=web,worker,node', // one build for browsers (Safari included) and Node
  '-sFILESYSTEM=0',                // no file system: files are host imports
  ...(asan
    ? ['-fsanitize=address', '-g', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=268435456']
    : ['-sALLOW_MEMORY_GROWTH=0',      // fixed memory, so views of 68000 memory never go stale
       '-sINITIAL_MEMORY=67108864']),  // 64 MB: 16 MB 68000 memory + listing + stack
  '-sSTACK_SIZE=4194304',          // 4 MB: room for the recursion that the guard in mem_req allows
  '-sEXPORTED_FUNCTIONS=_malloc,_free',
  // Module properties the caller may pass (CreateOptions in sim68k.mjs);
  // Emscripten ignores any that are not listed here.
  '-sINCOMING_MODULE_JS_API=wasmBinary,locateFile,print,printErr',
  '-sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAP8,HEAP16,HEAPU16,HEAP32,HEAPU32',
  '--js-library', join(shimDir, 'host-imports.js'),
];

function findEmxx() {
  // Windows: newer SDKs ship em++.exe, older ones em++.bat.
  const names = process.platform === 'win32' ? ['em++.exe', 'em++.bat'] : ['em++'];
  const roots = [];
  if (process.env.EMSDK) roots.push(process.env.EMSDK);
  roots.push(join(repo, '.toolchain', 'emsdk'));
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, 'upstream', 'emscripten', name);
      if (existsSync(candidate)) return { emxx: candidate, emsdk: root };
    }
  }
  throw new Error(`em++ not found. Set EMSDK or install the SDK in ${join(repo, '.toolchain', 'emsdk')} (docs/porting/toolchain.md).`);
}

/** Environment for em++ when the SDK has not been activated in this shell. */
function emscriptenEnv(emsdk) {
  const env = { ...process.env };
  if (!env.EMSDK) env.EMSDK = emsdk.replace(/\\/g, '/');
  if (!env.EM_CONFIG && existsSync(join(emsdk, '.emscripten'))) env.EM_CONFIG = join(emsdk, '.emscripten');
  for (const [name, dir, exe] of [['EMSDK_NODE', 'node', process.platform === 'win32' ? 'node.exe' : join('bin', 'node')],
                                  ['EMSDK_PYTHON', 'python', process.platform === 'win32' ? 'python.exe' : join('bin', 'python3')]]) {
    if (env[name] || !existsSync(join(emsdk, dir))) continue;
    for (const version of readdirSync(join(emsdk, dir))) {
      const candidate = join(emsdk, dir, version, exe);
      if (existsSync(candidate)) { env[name] = candidate; break; }
    }
  }
  return env;
}

function run(command, commandArgs, env) {
  return new Promise((resolvePromise, reject) => {
    if (verbose) console.log([command, ...commandArgs].join(' '));
    // .bat files need a shell on Windows; arguments are quoted for it.
    const useShell = /\.bat$/i.test(command);
    const quoted = useShell ? commandArgs.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a}"` : a)) : commandArgs;
    const child = spawn(useShell ? `"${command}"` : command, quoted, { env, shell: useShell, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} ${commandArgs.join(' ')}\nexit code ${code}\n${output}`));
    });
  });
}

async function pool(tasks, limit) {
  const queue = tasks.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

async function main() {
  const { emxx, emsdk } = findEmxx();
  const env = emscriptenEnv(emsdk);
  mkdirSync(objDir, { recursive: true });
  mkdirSync(distDir, { recursive: true });

  const units = [
    ...ORIGINAL_SOURCES.map((name) => ({ source: join(srcDir, name), prefix: 'src-', flags: ORIGINAL_FLAGS })),
    ...SHIM_SOURCES.map((name) => ({ source: join(shimDir, name), prefix: 'shim-', flags: SHIM_FLAGS })),
  ];
  const objects = [];
  const started = Date.now();
  await pool(units.map((unit) => async () => {
    // The prefix keeps src/RUN.CPP and a shim file of the same name apart on
    // file systems that ignore case.
    const base = unit.source.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const object = join(objDir, unit.prefix + base + (debug ? '.debug' : '') + (asan ? '.asan' : '') + '.o');
    objects.push(object);
    const output = await run(emxx, [...COMMON_FLAGS, ...unit.flags, '-c', unit.source, '-o', object], env);
    if (output.trim()) console.log(output.trim());
  }), Math.max(1, Math.min(8, availableParallelism())));

  const loader = join(distDir, 'sim68k.mjs');
  const output = await run(emxx, [...objects.sort(), ...LINK_FLAGS, '-o', loader], env);
  if (output.trim()) console.log(output.trim());
  // em++ names the .wasm after the loader ("sim68k.wasm") and the loader finds
  // it by that name, so the loader itself can be renamed.
  const finalLoader = join(distDir, 'sim68k-loader.mjs');
  rmSync(finalLoader, { force: true });
  renameSync(loader, finalLoader);

  const wasm = join(distDir, 'sim68k.wasm');
  console.log(`built ${wasm} (${statSync(wasm).size} bytes) and ${finalLoader} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
