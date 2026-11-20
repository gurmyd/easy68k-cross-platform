#!/usr/bin/env node
// Builds the assembler engine with Emscripten:
//
//     node engine/asm/build.mjs [--debug] [--verbose] [--out <dir>]
//
// Output (git-ignored):
//     engine/dist/asm68k.wasm          the engine
//     engine/dist/asm68k-loader.mjs    the Emscripten loader for it (ES module)
// Object files go to build/asm-obj (build/asm-obj-debug with --debug).
// --out <dir> writes the two files to another directory instead (used by the
// tests to build an -O0 copy for comparison).
//
// em++ is taken from the EMSDK environment variable if it is set (run
// emsdk_env first), otherwise from <repository>/.toolchain/emsdk.
// Works on Windows, macOS and Linux; needs nothing but Node.
//
// Why each flag is there is explained in PATCHES.md, "Build".

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const srcDir = join(here, 'src');
const shimDir = join(here, 'shim');

const argv = process.argv.slice(2);
const debug = argv.includes('--debug');
const verbose = argv.includes('--verbose');
const outIndex = argv.indexOf('--out');
const distDir = outIndex >= 0 ? resolve(argv[outIndex + 1]) : join(repo, 'engine', 'dist');
const objDir = join(repo, 'build', debug ? 'asm-obj-debug' : 'asm-obj');

/** The 16 original v5.16.1 engine files (with the marked changes of PATCHES.md). */
export const ORIGINAL_SOURCES = [
  'ASSEMBLE.CPP', 'BUILD.CPP', 'CODEGEN.CPP', 'DIRECTIV.CPP', 'ERROR.CPP', 'EVAL.CPP',
  'GLOBALS.CPP', 'INSTLOOK.CPP', 'INSTTABL.CPP', 'LISTING.CPP', 'MACRO.CPP', 'MOVEM.CPP',
  'OBJECT.CPP', 'OPPARSE.CPP', 'STRUCTURED.CPP', 'SYMBOL.CPP',
];
/** The shim: VCL stand-in, file layer, host interface. */
export const SHIM_SOURCES = ['ez_file.cpp', 'ez_vcl.cpp', 'ez_host.cpp'];

/** Per-file extra flags. ERROR.CPP: see "printError wrapper" in PATCHES.md. */
const PER_FILE = { 'ERROR.CPP': ['-DprintError=ez_original_printError'] };

const OPT = debug ? ['-O0', '-g'] : ['-O2'];

/** Flags for every C++ file.  See PATCHES.md, "Build". */
const COMMON_FLAGS = [
  '-std=gnu++98',                  // the originals: "return NULL" from int functions, narrowing in tables
  ...OPT,
  '-fno-operator-names',           // STRUCTURED.CPP uses "or" as an identifier
  '-fwasm-exceptions',             // the originals' try / catch (...) blocks
  '-fwrapv',                       // signed arithmetic wraps (two's complement), as on x86
  '-fno-strict-aliasing',
  '-fsigned-char',                 // plain char is signed, as in the Borland build
  '-ftrivial-auto-var-init=zero',  // locals the original reads uninitialised are 0
  '-fms-extensions',               // a Ctrl-Z byte ends a source file (14 of the originals end in one)
  '-include', join(shimDir, 'ez_prelude.h'),
  '-I', join(shimDir, 'include'),
  '-I', join(shimDir, 'include-lc'),
  '-I', srcDir,
  '-I', shimDir,
];
const ORIGINAL_FLAGS = ['-w'];     // the original files are not to be edited for warnings
const SHIM_FLAGS = ['-Wall', '-Wextra', '-Wno-unused-parameter'];

const EXPORTS = [
  'ez_fs_add', 'ez_set_options', 'ez_set_time', 'ez_assemble', 'ez_error_count',
  'ez_warning_count', 'ez_execute_enabled', 'ez_exit_called', 'ez_open_file_count',
  'ez_msg_count', 'ez_msg_line', 'ez_msg_text', 'ez_msg_file', 'ez_msg_code',
  'ez_msg_file_node', 'ez_dialog_count', 'ez_dialog_caption', 'ez_dialog_text',
  'ez_fs_count', 'ez_fs_deleted', 'ez_fs_name', 'ez_fs_key', 'ez_fs_size', 'ez_fs_data',
  'ez_fs_find', 'ez_output_node', 'ez_alloc', 'ez_free',
].map((n) => '_' + n);

const LINK_FLAGS = [
  ...OPT,
  ...(debug ? ['-sASSERTIONS=2', '-sSTACK_OVERFLOW_CHECK=2'] : []),
  '-fwasm-exceptions',
  '-sWASM_LEGACY_EXCEPTIONS=1',    // the exception encoding every current browser supports (Safari 15.2+)
  '-sMODULARIZE=1',
  '-sEXPORT_ES6=1',
  '-sEXPORT_NAME=createAsm68kModule',
  '-sENVIRONMENT=web,worker,node', // one build for browsers (Safari included) and Node
  '-sFILESYSTEM=0',                // no Emscripten file system: the shim has its own (ez_file.cpp)
  '-sALLOW_MEMORY_GROWTH=1',
  '-sINITIAL_MEMORY=16777216',     // 16 MB
  '-sSTACK_SIZE=8388608',          // 8 MB: 256 nested macro calls need about 3 MB (PATCHES.md)
  `-sEXPORTED_FUNCTIONS=${EXPORTS.join(',')}`,
  '-sEXPORTED_RUNTIME_METHODS=HEAPU8',
];

function findEmxx() {
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
    const useShell = /\.bat$/i.test(command);
    const quoted = useShell ? commandArgs.map((a) => (/[\s"&|<>^=]/.test(a) ? `"${a}"` : a)) : commandArgs;
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
    ...ORIGINAL_SOURCES.map((name) => ({ source: join(srcDir, name), prefix: 'src-', flags: [...ORIGINAL_FLAGS, ...(PER_FILE[name] || [])] })),
    ...SHIM_SOURCES.map((name) => ({ source: join(shimDir, name), prefix: 'shim-', flags: SHIM_FLAGS })),
  ];
  const objects = [];
  const started = Date.now();
  await pool(units.map((unit) => async () => {
    const base = unit.source.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const object = join(objDir, unit.prefix + base + '.o');
    objects.push(object);
    const output = await run(emxx, [...COMMON_FLAGS, ...unit.flags, '-c', unit.source, '-o', object], env);
    if (output.trim()) console.log(output.trim());
  }), Math.max(1, Math.min(8, availableParallelism())));

  const loader = join(distDir, 'asm68k.mjs');
  const output = await run(emxx, [...objects.sort(), ...LINK_FLAGS, '-o', loader], env);
  if (output.trim()) console.log(output.trim());
  // em++ names the .wasm after the loader ("asm68k.wasm") and the loader finds
  // it by that name, so the loader itself can be renamed.
  const finalLoader = join(distDir, 'asm68k-loader.mjs');
  rmSync(finalLoader, { force: true });
  renameSync(loader, finalLoader);
  const wasm = join(distDir, 'asm68k.wasm');
  console.log(`built ${wasm} (${statSync(wasm).size} bytes) and ${finalLoader} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

const invokedDirectly = process.argv[1] &&
  (process.platform === 'win32'
    ? resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
    : resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch((error) => {
    console.error(String(error.message || error));
    process.exit(1);
  });
}
