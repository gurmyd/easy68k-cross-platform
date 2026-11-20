// run-asy68k.mjs - command-line front end for the WebAssembly build of the
// ASM68K v5.15.4 command-line assembler (asy68k.mjs + asy68k.wasm).
//
//   node run-asy68k.mjs [--crt-text-mode] [asy68k options] <path\to\file.X68>
//
// asy68k options are the native ones (--no-list, --macroexpand, ...).
//
// The source file is copied into Emscripten's in-memory file system (MEMFS)
// as /work/<name>, the assembler's main() runs with /work as the current
// directory, and every file the assembler leaves in /work (file.L68, file.S68)
// is copied back next to the source file on disk. Only the one source file is
// copied in: programs that INCLUDE / INCBIN other files are not supported by
// this smoke-test wrapper.
//
// --crt-text-mode   (handled here, not passed to the assembler)
//   Emulates what the Windows C runtime does for the native asy68k.exe, which
//   opens every file in TEXT mode (fopen "r" / "w"). Emscripten's libc (musl)
//   has no text mode, so without this option the bytes differ:
//     reading : CR LF -> LF, and the first Ctrl-Z (0x1A) ends the file
//     writing : LF -> CR LF
//   With the option the translation is applied to the source on its way into
//   MEMFS and to every output file on its way out.
//   Without it, bytes are copied verbatim in both directions.
//
// Exit status: the assembler's own exit status (the v5.15.4 port ends with
// exit(1) after the first source file even when assembly succeeded, exactly
// like the native build), or 2 for a usage / I/O error of this wrapper.
import fs from 'node:fs';
import path from 'node:path';
import createAsy68k from './asy68k.mjs';

let args = process.argv.slice(2);
const textMode = args.includes('--crt-text-mode');
args = args.filter((a) => a !== '--crt-text-mode');

const sources = args.filter((a) => !a.startsWith('-'));
if (sources.length > 1) {
  console.error('run-asy68k.mjs: pass exactly one source file (the v5.15.4 port stops after the first one anyway)');
  process.exit(2);
}

// Windows CRT text-mode read: CR LF -> LF, stop at the first Ctrl-Z.
function crtTextRead(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x1a) break;
    if (b === 0x0d && bytes[i + 1] === 0x0a) continue;
    out.push(b);
  }
  return Uint8Array.from(out);
}

// Windows CRT text-mode write: every LF -> CR LF.
function crtTextWrite(bytes) {
  const out = [];
  for (const b of bytes) {
    if (b === 0x0a) out.push(0x0d);
    out.push(b);
  }
  return Uint8Array.from(out);
}

const Module = await createAsy68k({
  print: (s) => process.stdout.write(s + '\n'),
  printErr: (s) => process.stderr.write(s + '\n'),
});
const { FS } = Module;
FS.mkdir('/work');
FS.chdir('/work');

let hostDir = null;
let name = null;
if (sources.length === 1) {
  const hostPath = path.resolve(sources[0]);
  hostDir = path.dirname(hostPath);
  name = path.basename(hostPath);
  let bytes;
  try {
    bytes = fs.readFileSync(hostPath);
  } catch (e) {
    console.error(`run-asy68k.mjs: cannot read ${hostPath}: ${e.message}`);
    process.exit(2);
  }
  FS.writeFile('/work/' + name, textMode ? crtTextRead(bytes) : bytes);
}

// Replace the host path by the bare name; keep option order as given.
const wasmArgs = args.map((a) => (a.startsWith('-') ? a : name));

let status = 0;
try {
  status = Module.callMain(wasmArgs);
} catch (e) {
  if (e && e.name === 'ExitStatus') status = e.status;
  else throw e;
}

if (hostDir) {
  for (const entry of FS.readdir('/work')) {
    if (entry === '.' || entry === '..' || entry === name) continue;
    const stat = FS.stat('/work/' + entry);
    if (!FS.isFile(stat.mode)) continue;
    const bytes = FS.readFile('/work/' + entry);
    fs.writeFileSync(path.join(hostDir, entry), textMode ? crtTextWrite(bytes) : bytes);
  }
}
process.exitCode = status ?? 0;
