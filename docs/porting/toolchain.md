# Toolchain: Emscripten, the native assembler oracle, and the native-vs-wasm check

Status: everything below was run on this machine (Windows 11, 2026-11-20) and seen to work.
Nothing was installed globally: no PATH, registry or profile change.

## 1. What matters for the port (read this first)

Compiling the **unmodified** assembler sources with Emscripten does **not** by default give the
same output as the Windows build. Three causes were found and pinned down; two are traps for the
real port, because the same code is in the original v5.16.1 sources.

| # | Finding | Cause | What to do |
|---|---------|-------|------------|
| 1 | With `-O1`/`-O2`/`-O3`/`-Os` the wasm assembler silently mis-assembles any program with a forward reference ("Symbol value differs between first and second pass", symbols with value 0, wrong code). `-O0` is correct. | Undefined behaviour in `SYMBOL.CPP` `lookup()`: when a symbol is not found and `create` is false it returns the uninitialised local `t` (`symbolDef *s, *last, *t;` ... `return t;`). clang marks the return value `noundef`, treats those paths as unreachable, and compiles "not found" as if `create` were always true: the LLVM IR has `llvm.assume(create != 0)` followed by `operator new`, and the `UNDEFINED` error store is gone. So a forward reference in pass 1 *creates* the symbol. MSVC, Borland and clang `-O0` just return garbage that every caller ignores. **Identical code in the original `Edit68Kv5.16.1\SYMBOL.CPP` lines 94 and 179.** | Compile every original C++ file with **`-ftrivial-auto-var-init=zero`** (tested: fixes it at `-O2`, `-O3`, `-Os`, with both exception models), or initialise `t = NULL` in the source (tested: also fixes it). |
| 2 | A CRLF source file breaks the wasm build ("ENDM expected": a macro definition never ends) and all output files have LF instead of CRLF line ends. | On Windows the assembler opens every file with `fopen(.., "r")` / `"w"`, i.e. **text mode**: the C runtime turns CR LF into LF on read, LF into CR LF on write, and stops reading at the first Ctrl-Z (0x1A). Emscripten's libc (musl) has no text mode. The CLI port's `REMOVECR()` workaround only covers the main loop in `processFile()`; `macro()` in `MACRO.CPP` reads lines with its own `fgets` and tokenises with `" \t\n"`, so it sees `ENDM\r`. | The port must emulate CRT text mode at the file-system boundary (CR LF -> LF and Ctrl-Z = EOF going in, LF -> CR LF coming out). Doing exactly that in the test wrapper (`--crt-text-mode`) makes `.S68` byte-identical to the native output. |
| 3 | Listing header line 3 differs, and the wasm listing has one extra empty line after it. | Not a bug of the build: `LISTING.CPP` of the CLI port has `#if _WIN32` -> Borland `DateTimeToStr(Now())` (`11/20/2026 1:07:46 PM`), `#else` -> `asctime()` (`Fri Nov 20 13:07:47 2026` **plus its own `\n`**). | Mask line 3 (and the extra line) when comparing. The original v5.16.1 uses `DateTimeToStr(Now())` only. |

Also seen while investigating (same code in v5.16.1 unless noted):

- `EVAL.CPP:237` signed overflow `16 * x` for hex constants >= `$80000000` (UBSan). Use **`-fwrapv`**.
- `BUILD.CPP` `bitField()`: `type` is uninitialised in pass 1 and then tested (`if (type == BFINS)`). Not triggered by the test program; affects bit-field instructions only.
- `char` is signed on wasm32, MSVC x64 and Borland alike, so sign-extension quirks reproduce: `DC.W 'éè'` (bytes E9 E8) assembles to `$E8E8`, `DC.L 'éèüÿ'` to `$E8E7FBFF`, identically native and wasm.
- `SIMHALT` lists `FFFF FFFF` but writes its second word to the S-record at the **same address** as the first (`S1051088FFFF64` after a record that already covers `$1088`).
- ASan + UBSan (`-fsanitize=address,undefined`) on the test program: no memory error, only the overflow above.

## 2. Versions

| Tool | Version | Where |
|------|---------|-------|
| emsdk | git 708dcbc (2026-11-12), `emsdk install latest` = **7.0.0** | `c:\easy64k\.toolchain\emsdk` (2.1 GB) |
| Emscripten | 7.0.0 (777e6e5db7b4990bcaeb1b9998ed642cc84e6629), clang 24.0.0git, target wasm32-unknown-emscripten | `...\emsdk\upstream` |
| Node (emsdk) | 24.19.0 | `...\emsdk\node\24.19.0_64bit\node.exe` |
| Python (emsdk) | 3.13.3 | `...\emsdk\python\3.13.3_64bit\python.exe` |
| Node (system) | 24.19.0, npm 11.17.0 | `C:\Program Files\nodejs` |
| MSVC | cl 19.44.35215 for x64, toolset 14.44.35207, VS 2022 Community 17, Windows SDK / UCRT 10.0.26100.0 | `C:\Program Files\Microsoft Visual Studio\2022\Community` |
| Oracle source | ASM68K v5.15.4 CLI port, upstream `github.com/rayarachelian/EASy68K-asm` commit 7102f27 | `c:\easy64k\reference\easy68k-asm-cli\ASM68Kv5.15.4` |

VS 2019 Community has no C++ tools installed (no `VC\Tools\MSVC`); only VS 2022 is usable.
Disk used: `.toolchain` 2.1 GB, `build` 22 MB.

## 3. Emscripten

Install (done once; `activate` without `--permanent` only writes `emsdk\.emscripten`):

```powershell
git clone --depth 1 https://github.com/emscripten-core/emsdk.git c:\easy64k\.toolchain\emsdk
cd c:\easy64k\.toolchain\emsdk
.\emsdk.bat install latest
.\emsdk.bat activate latest
```

Use it (current shell only):

```powershell
. c:\easy64k\tools\emsdk-env.ps1        # note the leading dot; -Quiet for no banner
emcc --version
```

`emsdk-env.ps1` prepends `emsdk` and `emsdk\upstream\emscripten` to the process PATH and sets
`EMSDK`, `EMSDK_NODE`, `EMSDK_PYTHON`, `EM_CONFIG`. The Emscripten cache stays inside
`emsdk\upstream\emscripten\cache`; nothing is created in the user profile.

Smoke test: `c:\easy64k\build\toolchain-test\emscripten-smoke\` (`smoke.cpp`, `run-smoke.mjs`,
`build-and-run.ps1`). Flags that worked:

```
em++ smoke.cpp -O2 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node
     -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,FS -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1
     -fwasm-exceptions -o smoke-wasm-eh.mjs          (or -fexceptions -o smoke-js-eh.mjs)
node run-smoke.mjs ./smoke-wasm-eh.mjs
```

- C functions are exported with `EMSCRIPTEN_KEEPALIVE` and called through `ccall`, `cwrap` and `Module._name`.
- JS side: `import createModule from './smoke-wasm-eh.mjs'; const Module = await createModule({print, printErr});`
- Result: 14 checks pass in both exception modes, under the system Node and the emsdk Node:
  `fopen`/`fprintf`/`fgets` on MEMFS, a file written by C read back with `FS.readFile`, a CRLF file
  written with `FS.writeFile` read by `fgets` with the CR intact, `throw`/`catch` of
  `std::runtime_error`, `int` via `catch(...)`, and a rethrow.
- **An exception flag is required.** Without `-fexceptions` or `-fwasm-exceptions` the same program
  builds but aborts at the first `throw` (`Aborted(undefined)`).

## 4. Native oracle (asy68k.exe)

Build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle.ps1 -Configuration Debug
```

The script wipes `c:\easy64k\build\oracle\asm-cli-5.15.4\src`, copies the reference sources there,
applies `c:\easy64k\build\oracle\asm-cli-5.15.4\msvc-port.patch` with `git apply`, checks that all 20
original files are still byte-identical to the reference, and compiles:

```
cl /nologo /EHsc /W3 /D_CRT_SECURE_NO_WARNINGS /D_CRT_NONSTDC_NO_WARNINGS /FI msvc_compat.h
   /O2 /MT /I src\msvc-compat /Fe bin\asy68k.exe src\*.CPP          (Release = the oracle)
   /Od /MTd /Zi ... /Fe bin\asy68k-dbg.exe                           (Debug, with .pdb)
```

Output: `c:\easy64k\build\oracle\asm-cli-5.15.4\bin\asy68k.exe` (306,688 bytes; the hash changes
on every build because of the PE timestamp). 17 warnings, all C4101 "unreferenced local variable".

**The patch edits no original file.** It adds two files that supply names the port takes from
glibc / POSIX / Borland and MSVC lacks:

- `src\msvc-compat\msvc_compat.h` (force-included): `strcasecmp` -> `_stricmp`, `strncasecmp` ->
  `_strnicmp` (every call site only tests for zero), a local `strcasestr` (only tested against
  NULL), and `Now()` / `DateTimeToStr()` for the Borland line `LISTING.CPP` keeps under `_WIN32`.
  `DateTimeToStr` always prints the en-US form `M/D/YYYY h:mm:ss AM|PM`, as the real EASy68K does
  on a US-locale machine, independent of this machine's regional settings.
- `src\msvc-compat\unistd.h`: includes `<io.h>` (for the one `unlink()` call).

Invoke (outputs are written **next to the source file**, same base name):

```
c:\easy64k\build\oracle\asm-cli-5.15.4\bin\asy68k.exe [options] path\prog.X68
  -> path\prog.L68 (listing), path\prog.S68 (S-record); path\prog.X68.tmp is created and deleted
```

Options (on by default; prefix `--no-` to turn off): `--list --object --bitfields --warnings
--symbols`. Off by default: `--macroexpand --structureexpan --expandconstants`.

Behaviour of this port that a test harness must know (all observed):

- **Exit code is 1 after a successful assembly** (`NORMAL` is 0 and `main` does `if (!s) exit(1)`).
  It is 0 only for the help text (no arguments). Decide success from the listing
  (`No errors detected` / `N errors detected`), not from the exit code.
- **Only the first source file on the command line is assembled**, for the same reason.
- The symbol table is appended to the listing by default (the README says otherwise); use `--no-symbols`.
- The structure-expansion option is spelled **`--structureexpan`**; `--structureexpand` is rejected as unknown.
- The output name is made by overwriting 4 characters at the last `.` of the path:
  `prog.s` -> `prog.L68`, `prog.asm68k` -> `prog.L6868k`. **A source name without a dot is
  overwritten by the output.** Always use a 3-character extension and no dot elsewhere in a
  relative path.
- A missing source prints an empty error line, exits 1 and leaves `name.tmp` behind.
- Output is CRLF (Windows text mode), like the real EASy68K. Source may be CRLF or LF: both give identical output.
- Messages (`Assembling ...`) go to stderr.
- It is v5.15.4, not v5.16.1, and its own README warns that its L68/S68 can differ from the real
  EASy68K. Example seen in the source: internal structured-code labels use lower-case hex
  (`IntToHex` -> `"%08x"`). Treat it as an oracle for the assembler core, not for byte-exact
  v5.16.1 listings.

## 5. Test program and oracle output

`c:\easy64k\build\oracle\smoke-test\smoke.X68` (71 lines, CRLF): ORG, EQU with an expression,
a macro with two arguments, MOVEM (three forms), FOR / IF-ELSE / WHILE / REPEAT-UNTIL, BEQ.S and
BSR forward, BRA and DBRA backward, TRAP #15, SIMHALT, DC.B/DC.W/DC.L with strings and
expressions, DS.B, DS.L, DCB.W, END. Result: `No errors detected`, `No warnings generated`.

First 40 lines of `smoke.L68` (native):

```
00001000 Starting Address
Assembler used: ASy68K Assembler v5.15.04
Created On: 11/20/2026 1:07:46 PM

00000000                             1  *-----------------------------------------------------------
00000000                             2  * Title      : Toolchain smoke test
00000000                             3  * Written by : EASy68K macOS port team
00000000                             4  * Description: Small but varied program. It is assembled by the native
00000000                             5  *              oracle (asy68k.exe) and by the WebAssembly build of the
00000000                             6  *              same sources, and the .L68 / .S68 outputs are compared.
00000000                             7  *-----------------------------------------------------------
00000000  =0000000D                  8  CR      EQU     $0D
00000000  =0000000A                  9  LF      EQU     $0A
00000000  =00000005                 10  COUNT   EQU     5                   number of FOR iterations
00000000  =00008000                 11  STACK   EQU     $8000
00000000  =00000021                 12  SQUARE  EQU     COUNT*COUNT+(STACK>>12)
00000000                            13  
00000000                            14  * print the string at \1 with TRAP #15 task \2
00000000                            15  PRINT   MACRO
00000000                            16          LEA     \1,A1
00000000                            17          MOVE.B  #\2,D0
00000000                            18          TRAP    #15
00000000                            19          ENDM
00000000                            20  
00001000                            21          ORG     $1000
00001000                            22  START:                              ; first instruction of program
00001000  4FF9 00008000             23          LEA     STACK,SP
00001006  48E7 FFFE                 24          MOVEM.L D0-D7/A0-A6,-(SP)   save everything
0000100A                            25m         PRINT   HELLO,14
00001016                            26m         PRINT   MSG2,13
00001022                            27  
00001022  4282                      28          CLR.L   D2
00001024                            29          FOR.W   D1 = #1 TO #COUNT DO
0000102C  D441                      30              ADD.W   D1,D2
0000102E                            31          ENDF
00001036                            32  
00001036                            33          IF.W D2 <EQ> #15 THEN
0000103E  43F9 00002027             34              LEA     OKMSG,A1
00001044                            35          ELSE
00001048  43F9 0000202E             36              LEA     BADMSG,A1
```

`smoke.S68` (native, all 13 lines):

```
S021000036384B50524F47202020323043524541544544204259204541535936384B6D
S12310004FF90000800048E7FFFE43F900002000103C000E4E4F43F900002010103C000DC0
S12310204E4F4282323C000160000006D4415241B27C00056FF6B47C000F6600000C43F949
S1231040000020276000000843F90000202E103C000D4E4F7603534367066100003060F6FA
S1211060B63C00046C000006520360F4E28AB4BC0000002162F64CDF7FFF48B9020557
S10F107E0000205823C200002068FFFF7F
S1051088FFFF64
S10B108CD48251CCFFFC4E7527
S124200048656C6C6F2C203638303030210D0A00497427732061202271756F746564222073E4
S12420217472696E670073756D206F6B0073756D206261640000010002000300044142FFFF00
S11920420021DEADBEEF0000100041424344000000150000000AF2
S10B206CFFFFFFFFFFFFFFFF70
S804001000EB
```

## 6. WebAssembly build of the same sources

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\build-asm-oracle-wasm.ps1
```

compiles the 17 unmodified `.CPP` files (no shim, no patch) to
`c:\easy64k\build\oracle\asm-cli-5.15.4-wasm\asy68k.mjs` + `asy68k.wasm` (147,643 bytes) with:

```
em++ *.CPP -O2 -fwasm-exceptions -w -ftrivial-auto-var-init=zero -fwrapv -fno-strict-aliasing
     -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=node -sINVOKE_RUN=0
     -sEXPORTED_RUNTIME_METHODS=callMain,FS -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1
     -o asy68k.mjs
```

`-NoUbGuards` drops the three `-f` guard flags and reproduces finding 1. Without `-w` clang prints
9 warnings (dangling else, unused value), no errors.

Run (MEMFS, not NODERAWFS):

```
node c:\easy64k\build\oracle\asm-cli-5.15.4-wasm\run-asy68k.mjs [--crt-text-mode] [options] path\prog.X68
```

`run-asy68k.mjs` copies the one source file into MEMFS as `/work/prog.X68`, calls `callMain`, and
copies every file left in `/work` back next to the source. `--crt-text-mode` applies the Windows
text-mode translation described in finding 2 to the source going in and to the outputs coming
out. It does not copy INCLUDE / INCBIN files: single-file programs only.

## 7. Native vs wasm, byte for byte

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File c:\easy64k\tools\compare-asm-oracle.ps1 -Source c:\easy64k\build\oracle\smoke-test\smoke.X68
```

runs native, wasm raw and wasm `--crt-text-mode` in `c:\easy64k\build\oracle\compare\<name>\`.
"masked" = line 3 replaced in both and the wasm listing's extra empty line dropped.

| Source (in `build\oracle\smoke-test`) | `.S68` native vs wasm text-mode | `.L68` text-mode | `.L68` masked | wasm raw (no emulation) |
|---|---|---|---|---|
| `smoke.X68` (CRLF) | identical (706 bytes) | differs in header only | **identical** | wrong: `ENDM expected`, S68 84 bytes |
| `smoke.X68` + `--macroexpand --structureexpan --expandconstants` | identical | header only | **identical** | wrong (same reason) |
| `smoke.X68` + `--no-symbols --no-warnings` | identical | header only | **identical** | wrong (same reason) |
| `smoke.X68`, native Debug (`/Od`) build | identical | header only | **identical** | - |
| `smoke-lf.X68` (LF only) | identical | header only | **identical** | correct content, LF line ends: equals native with every CR removed |
| `probe-ctrlz.X68` (0x1A mid-file) | identical | header only | **identical** | differs: reads past the Ctrl-Z |
| `probe-highbit.X68` (bytes >= $80) | identical | header only | **identical** | LF line ends |
| `probe-errors.X68` (9 errors, no END) | identical | header only | **identical** | LF line ends |

So: with the guard flags and CRT text-mode emulation, the wasm build reproduces the native
oracle exactly on these inputs; the only remaining byte difference is the "Created On" header
(finding 3). Without the guard flags the same comparison fails at S68 line 2
(`43F900002000` native, `43F900000000` wasm).

Optimisation matrix on the LF source (S68 and masked L68 against native):
`-O0` same; `-O1`, `-O2`, `-O3`, `-Os` different; each of `-O2`, `-O3`, `-Os` with
`-ftrivial-auto-var-init=zero` same; `-O2 -fexceptions` different, with the flag same.
Bisecting one file at a time (`-O2` for one, `-O0` for the rest) isolates `SYMBOL.CPP`.

## 8. Problems hit, and fixes

| Problem | Fix |
|---------|-----|
| MSVC: `unistd.h` not found; `strcasecmp`, `strncasecmp`, `strcasestr`, `Now`, `DateTimeToStr` undefined. | Two added shim files, force-included; no source edit (section 4). |
| `vcvars64.bat` prints `'vswhere.exe' is not recognized` | Harmless (vswhere is not on PATH); the environment is still set. The scripts discard vcvars output. |
| wasm output wrong at `-O1` and above | Finding 1; `-ftrivial-auto-var-init=zero`. |
| wasm fails on CRLF sources, writes LF | Finding 2; `--crt-text-mode` in the wrapper. |
| Listing header differs | Finding 3; masked in the comparison. |
| Oracle exit code is always 1 | Port behaviour (section 4); scripts ignore it. |
| Windows PowerShell 5.1 turns native stderr into error records (`NativeCommandError`, UTF-16 log) | Scripts start processes with `System.Diagnostics.Process`, or redirect inside the child. |
| `powershell -File script.ps1 -AsmOptions a,b` passes one string, not an array | `compare-asm-oracle.ps1` splits on commas itself. |
| `git status` run once against `reference\easy68k-asm-cli` rewrote that repository's `.git\index` (stat cache refresh, same size, no tracked file changed). | Not repeated. Use `git --no-optional-locks` or avoid git commands in `reference`. |
| `du` over the emsdk tree takes minutes | Sizes above were taken with `Get-ChildItem | Measure-Object`. |

## 9. Files

```
c:\easy64k\tools\emsdk-env.ps1               dot-source: emcc / em++ on PATH for this shell
c:\easy64k\tools\build-asm-oracle.ps1        reference sources + patch -> bin\asy68k.exe (MSVC)
c:\easy64k\tools\build-asm-oracle-wasm.ps1   same sources -> asy68k.mjs / .wasm (em++)
c:\easy64k\tools\compare-asm-oracle.ps1      native vs wasm on one .X68
c:\easy64k\build\oracle\asm-cli-5.15.4\msvc-port.patch
c:\easy64k\build\oracle\asm-cli-5.15.4\{src,obj,bin}
c:\easy64k\build\oracle\asm-cli-5.15.4-wasm\{asy68k.mjs,asy68k.wasm,run-asy68k.mjs}
c:\easy64k\build\oracle\smoke-test\*.X68     test and probe sources
c:\easy64k\build\oracle\compare\             outputs of the comparisons above
c:\easy64k\build\toolchain-test\emscripten-smoke\
```

If the project goes into git: `.toolchain\` (2.1 GB) and the generated parts of `build\` should
be ignored, but `msvc-port.patch`, `run-asy68k.mjs`, the smoke-test sources and the emscripten
smoke sources live under `build\` and are hand-written, so they must be tracked or moved.
