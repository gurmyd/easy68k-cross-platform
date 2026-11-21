# Native twins

A test oracle for **compiler independence** (ARCHITECTURE.md 6.1 layer L1, 6.2.1). The two
engines of this project are the original EASy68K C++ compiled to WebAssembly with Clang
(Emscripten). If any result depended on undefined or implementation-defined behaviour -
uninitialised memory, the layout of globals, signed overflow, `char` signedness - a different
compiler would show it. The _twins_ are the same sources built natively with Microsoft's compiler
(MSVC) as 32-bit x86 programs, which have the same ILP32 data model as Borland C++ (the original's
compiler) and wasm32. Every twin, at `/O2` and at `/Od`, must give exactly the output of the
WebAssembly build on every program we have.

Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.

## Running it

Windows with the Visual Studio C++ tools (x86/x64) and a built `engine/dist`:

```
npm run oracle:twins                    # = node tests/oracle/native-twin/run.mjs
node tests/oracle/native-twin/run.mjs --local --singlestep --jobs 4
```

| Option            | Effect                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--local`         | also the example programs under `reference/examples` and `build/corpus-local` (not in the repository)                                                  |
| `--singlestep`    | also the 124 files of the 68000 single-step suite (fetched into `build/singlestep/` if needed); included anyway when already fetched, and always in CI |
| `--no-singlestep` | leave the suite out                                                                                                                                    |
| `--engine-twins`  | also build the assembler engine's own twins (`engine/asm/native/build.mjs`) and run its test `engine/asm/test/native.test.mjs` (always in CI)          |
| `--skip-build`    | use twins that are already built                                                                                                                       |
| `--jobs N`        | parallel processes, default 4, at most 6                                                                                                               |

The result is `build/native-twin/report.md`; in CI it is also added to the job summary. The exit
code is 1 for any difference, any build failure and any change of the CPU catalogue's baseline
(`tests/conformance/cpu/baseline.json`). On this PC a full run with `--local` and the single-step
suite takes about 20 minutes.

`vswhere` finds the newest Visual Studio with the x86 tools; set `VCVARS32` to a `vcvars32.bat` to
choose one.

## What is built

All outputs are below `build/native-twin/` (git-ignored).

| Twin                                                 | Sources                                                                | Built by              |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| `sim-O2/sim-twin.exe`, `sim-Od/sim-twin.exe`         | `engine/sim/src` (patched originals) + `engine/sim/shim` + `sim-twin/` | `build-sim-twin.mjs`  |
| `asm-patched-O2`, `asm-patched-Od` (`ez68k-asm.exe`) | `engine/asm/src` + `engine/asm/shim` + `engine/asm/native/driver.cpp`  | `build-asm-twins.mjs` |
| `asm-unpatched-O2`, `asm-unpatched-Od`               | the **unpatched** v5.16.1 assembler sources + the same shim            | `build-asm-twins.mjs` |

The assembler twins belong to the assembler engine (`engine/asm/native/`): its `build.mjs` builds
the `/Od` pair into `build/asm-native/` for the engine's own `native.test.mjs`. `build-asm-twins.mjs`
compiles the same files with the same flags (it reads both lists from the engine's scripts, so they
cannot drift apart) and adds the `/O2` pair. The unpatched sources come from
`reference/src-edit68k/Edit68Kv5.16.1` when present; otherwise (CI) the original archive
`Edit68Kv5.16.1.zip` is fetched from the author's repository on GitHub at a pinned commit, checked
against its SHA-256 and unpacked below `build/native-twin/original/`.

The simulator twin is new here: `sim-twin/driver.cpp` is a headless host (every host call is
recorded as text, files of the 68000 program are real files in a sandbox folder, no graphics) with
a small script language; `sim-twin/hostfile-native.cpp` replaces the engine's `shim/hostfile.cpp`,
which needs `fopencookie()`; `sim-twin/native-prelude.h` and `sim-twin/include/emscripten/` let the
engine's shim compile with MSVC unchanged. There is no _unpatched_ simulator twin: the engine's
shim depends on the patches that make `runprog()` resumable (engine/sim/PATCHES.md P04, P05, P07),
so the unpatched simulator sources cannot be built with it (docs/porting/errata/T4.md).

## What is compared

| Comparison                                           | Inputs                                                                                                                                                                                                                                 | Must be                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| assembler: patched twins (`/O2`, `/Od`) against wasm | every run of `engine/asm/test/cases.mjs`; every `.X68` under `tests/` (plus `--local`), default options and with CEX, MEX, SEX on                                                                                                      | identical: listing, S-records, messages, counts                                                                                                                                                                                                                                                                   |
| assembler: unpatched twins against wasm              | the same                                                                                                                                                                                                                               | identical, except the engine cases listed in `UNPATCHED_DIFFERS` (engine/asm/test/native.test.mjs) and corpus differences that are only the object field of a line with an error (patch P7), and the checklist programs listed in `UNPATCHED_CORPUS` (compare-asm.mjs), which exercise patched defects on purpose |
| simulator: twins (`/O2`, `/Od`) against wasm         | the scripts in `scripts/`; a standard script for each program of `engine/sim/test/fixtures` and each corpus program that assembles; with `--singlestep`, one script per file of the single-step suite (about one million instructions) | byte-identical transcripts, except the known difference D1 (docs/porting/errata/T4.md, "Defect reports"), which is listed in the report instead                                                                                                                                                                   |

The standard script (`compare-sim.mjs`, `standardScript`) runs the program for up to 300,000
instructions with typed input, dumps registers, state, register boxes, a CRC-32 of all 16 MB of
memory and the program's files, then rewinds it and single-steps 300 instructions with the
execution log of type 3 on, and dumps the log.

## Scripts

The same script runs through the twin (`sim-twin.exe --script f --sandbox dir --work dir [--out f]`)
and through the WebAssembly engine (`node sim-script.mjs --script f [--out f]`). One command per
line; `#` starts a comment line; numbers are decimal, `$hex` or `0xhex`; strings are in double
quotes with the escapes `\r \n \t \\ \" \xHH`. Relative paths are relative to the script's folder.

| Command                                                                       | Does                                                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `option NAME VALUE`                                                           | `exceptions`, `bitfield`, `simhalt`, `elog`, `olog`, `logmemfrom`, `logmembytes` (`sim_set_option`)        |
| `load S68 [L68\|-] [NAME]`                                                    | File > Open of a program (`-` = no listing)                                                                |
| `loaddata S68 [NAME]`                                                         | File > Open Data; prints `loaddata ok` or `loaddata fail`                                                  |
| `file NAME PATH`                                                              | puts a file into the program's sandbox (plain names only: `A-Z a-z 0-9 . _ -`)                             |
| `reg R VALUE`                                                                 | sets D0-D7, A0-A6, USP, SSP, PC, SR or A7 as typed into its box                                            |
| `poke ADDRESS HEX`                                                            | writes bytes into memory (like the Memory window)                                                          |
| `keys STRING`                                                                 | characters typed whenever the program waits for input                                                      |
| `time N`                                                                      | the time of day for task 8, in 1/100 s                                                                     |
| `dialog accept NAME` / `dialog cancel`                                        | the answer to the next task-58 file dialog                                                                 |
| `run N`                                                                       | Run, for at most N instructions, answering every wait                                                      |
| `trace N`                                                                     | N times Trace Into                                                                                         |
| `pause`, `rewind`, `irq LEVEL`                                                | Pause, Rewind, an IRQ button (runs the program if it starts)                                               |
| `logdialog`, `logstart TEXT`, `logstop`                                       | the Log Output dialog opened, Log Start, Log Stop                                                          |
| `hostlog on\|off`                                                             | record host calls or not                                                                                   |
| `echo ...`                                                                    | copies its words into the transcript                                                                       |
| `dump regs\|state\|boxes\|log\|files`                                         | registers and cycles; `sim_state` 0-21; the 20 register boxes; the execution log so far; the sandbox files |
| `dump mem ADDRESS LENGTH`, `dump bytes ADDRESS...`, `dump crc ADDRESS LENGTH` | memory as hex lines, single bytes, CRC-32                                                                  |

Waits are answered as follows: a message box is closed; a delay is reported as elapsed; a file
dialog gets the next `dialog` answer (or Cancel); a keyboard read gets the next character of `keys`
(the command ends with `wait input-exhausted` when none is left). At most 10,000 waits are
answered per command.

The transcript has one line per host call (`@name arguments`, in the names and argument forms of
the JavaScript `SimHost` of `engine/sim/sim68k.mjs`; a byte argument longer than 512 bytes is
written as `#length:CRC-32`), one `status S steps N` line per `run`/`trace`, a line per wait, and
the dumps. The host answers as the JavaScript defaults do (`HOST_DEFAULTS`). File calls are not
recorded (the twin's are real file operations); the files themselves are compared with `dump files`.

## What the twin does not reproduce

- Clang flags with no MSVC equivalent: `-fwrapv`, `-fwrapv-pointer` and
  `-ftrivial-auto-var-init=zero` (engine/sim/PATCHES.md, "Compiler flags"). A result that depends
  on them is exactly what the twin is meant to find.
- The engine's file layer (`shim/hostfile.cpp`) is replaced: a difference that only the C library's
  stream implementation could cause (buffering, end-of-file flags after unusual call sequences)
  would show as a difference here too and must be read with that in mind.
- Equality with the Borland build of the original: the twins show that two modern compilers agree,
  not what Borland C++ 5.6 generated.
