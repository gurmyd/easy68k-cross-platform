# Changes to the original assembler sources

`engine/asm/src/` holds the 16 assembler engine files of EASy68K v5.16.1
(`Edit68Kv5.16.1`: ASSEMBLE, BUILD, CODEGEN, DIRECTIV, ERROR, EVAL, GLOBALS,
INSTLOOK, INSTTABL, LISTING, MACRO, MOVEM, OBJECT, OPPARSE, STRUCTURED, SYMBOL
`.CPP`) plus their headers `asm.h` and `proto.h`, copied byte for byte (CR LF
line ends, the trailing Ctrl-Z byte of 14 files kept). `BINFILE.CPP` is dead
code in the original (not even in its project file) and is not used.

Everything that is not a byte of the original is listed below. There are three
kinds:

1. **Source patches**: small edits inside `src/`, each marked in the source
   with a comment containing `[easy68k-mac]`. The table gives the original
   line range (`FILE:a-b`; `FILE:a+` means "inserted after line a").
2. **Build-level changes**: compiler flags and one renamed function; no source
   edit.
3. **Shim decisions**: what `shim/` supplies in place of Borland's VCL and C
   run-time library, where it decides something the user can see.

`node engine/asm/check-patches.mjs` diffs `src/` against the reference tree
(`reference/src-edit68k/Edit68Kv5.16.1`, git-ignored) and fails unless every
differing hunk is marked and appears in the table below with exactly this
range, and nothing else is listed. `--list` prints every hunk.

"Same as Borland?" says whether observable behaviour can differ from the
original Windows build, and how. The specification the patches refer to is
`docs/porting/assembler.md` (sections in parentheses).

## 1. Source patches

| # | Hunk | What changed | Why | Same as Borland? |
|---|---|---|---|---|
| P2 | `ERROR.CPP:40` | `extern lineNumL68;` -> `extern int lineNumL68;` | C++ has no implicit `int`; clang and MSVC reject the line (9.1 B3). | Yes. Borland read it as `int`. |
| P3 | `ASSEMBLE.CPP:90` | `extern int offsetMode;` -> `extern bool offsetMode;` | The definition is `bool` (GLOBALS.CPP:27). `offsetMode = false` in `processFile()` stored 4 bytes into a 1-byte object (9.1 B7); MSVC also refuses to link the mismatch. | Yes in effect: in the Borland layout the 3 extra zero bytes hit `showEqual`, `pass`, `pass2`, which `processFile()` assigns right after. |
| P4 | `SYMBOL.CPP:94` | `symbolDef *s, *last, *t = NULL;` | `lookup()` returns `t` unassigned when the symbol is missing and `create` is false; clang at -O1 and above then compiles "not found" as "create", and every forward reference breaks (9.3.1). | Yes. No caller dereferences the pointer on that path; see P14 for the two that do. |
| P5 | `MACRO.CPP:106` | `fprintf(tmpFile, line)` -> `fputs(line, tmpFile)` | A macro body line was used as a printf format (9.3.4): with a C library that rejects an invalid `%` conversion, every body line with a binary constant (`#%0101`) disappeared. | Yes for every `%` that is not a valid conversion (Borland evidently copies those: binary constants in macros work in EASy68K). **Differs** for body lines whose `%` forms a valid conversion, e.g. `'%d'` or `50% done` in a comment (`% d`): Borland prints stack garbage there, the port copies the text. UNVERIFIED on the real program. |
| P5 | `LISTING.CPP:210-211` | `fprintf(listFile, lineNum)`, `fprintf(listFile, errMsg)` -> `fputs` | Same: the message text (user text for `FAIL`) was a format. | Same as above; only a `FAIL` text with a valid conversion can differ. |
| P5 | `LISTING.CPP:220` | `fprintf(listFile, text)` -> `fputs` | Same (only fixed texts reach it). | Yes. |
| P6 | `OBJECT.CPP:281` | `char data[6]` -> `char data[7]` | `sprintf(data, "%06X", ...)` writes 7 bytes (9.3.5); in the wasm -O0 build the extra NUL destroyed the low byte of the MEMORY end address. | Yes: on x86 the 6-byte array sits in an aligned slot, the 7th byte lands in padding (the unpatched MSVC twin also gives the right records). |
| P7 | `ASSEMBLE.CPP:576` | `opDescriptor source = {0}, dest = {0};` | Operand fields are read without having been written on error paths: an undefined symbol in pass 2 (`eval` returns without storing a value), `(PC),Dn` (9.3.3). | **Differs** only in bytes of lines that carry an error (and `MOVE.W (PC),Dn`): the original emits stack garbage there, the port emits 0. |
| P7 | `BUILD.CPP:257` | `unsigned short type = 0;` | `bitField()` tests `type` in pass 1 before it is ever set (9.3.2). | Garbage in the original; with 0 pass 1 sizes the source operand. Differs only if the Borland garbage was $0700: then `BFINS Dn,<ea>{..}` would have been sized correctly in pass 1. |
| P7 | `DIRECTIV.CPP:340` | `int outVal = 0;` | `DC` with an undefined first item emits the variable unwritten (9.3.3). | **Differs** only in the bytes of a `DC` line with an undefined symbol as its first item. A later undefined item still repeats the previous item's value, as in the original. |
| P7 | `DIRECTIV.CPP:449` | `int blockSize = 0, blockVal = 0, i;` | `DCB` with an undefined value. | As above. |
| P7 | `EVAL.CPP:76` | `int t = 0;` | In pass 1 an undefined symbol pushes `t` unwritten; the value is used by `IFxx` with a forward reference and stored by `SET` (9.3.3). | **Differs** where the original used that garbage: an `IFxx` whose expression contains a forward reference may take the other branch in pass 1 (see the test "SET and MACRO lines reached only in pass 2"). |
| P7 | `MOVEM.CPP:73` | `opDescriptor memOp = {0};` | As for `source`/`dest`. | As P7 above. |
| P7 | `MOVEM.CPP:208` | `unsigned short regList = 0;` | `reg()` defines the symbol with `regList` unwritten after an undefined name. | Value of such a (failed) REG symbol: 0 instead of garbage. |
| P8 | `MACRO.CPP:135` | `macLine[MAC_SIZE]` (512-byte local) -> `static char macLine[MAC_SIZE * 64]` | The substitution loop writes without a bound; an expansion can be about 32 KB (127 arguments of 256 characters) and smashed the stack (9.3.8). Static is safe: the buffer is copied into `line[]` before the recursive `assemble()` call and rebuilt for each line; it also keeps the 256-level macro recursion within the stack. | Yes, except where the original corrupted its stack. |
| P8 | `MACRO.CPP:345+` | If the expanded line is longer than 255 characters: keep the first 255 and raise `SYNTAX` on it | `strcpy(line, macLine)` overran the 256-byte `line[]` into `lineNum`, `lineNumL68`, `listPtr` and the option flags (9.3.8). | **Differs**: the original corrupted those variables (wrong line numbers, stray options); the port reports "ERROR: Invalid syntax" on the macro call line and lists the truncated line. |
| P11 | `EVAL.CPP:411-412` | `>>` and `<<` use `(val2 & 31)`; `<<` is done on `unsigned` | A shift count < 0 or >= 32, or a negative left operand, is undefined in C++; the x86 SHL/SHR of the original masks the count to 5 bits. | Yes (x86 semantics made explicit; the unpatched MSVC twin agrees). |
| P12 | `EVAL.CPP:415+`, `EVAL.CPP:422+` | `INT_MIN / -1` and `INT_MIN \ -1` raise the shim's CPU-fault exception | The x86 `idiv` faults; Borland turns the fault into an exception caught by `eval()`'s `catch(...)`, which reports "ERROR: An exception occurred in routine 'eval'. " (9.2). WebAssembly would abort the whole run. | Yes, assuming Borland's `catch(...)` catches the divide fault (the documented C++Builder behaviour; the unpatched MSVC twin built with /EHa gives the same message). UNVERIFIED on the real program. |
| P13 | `OPPARSE.CPP:203+`, `OPPARSE.CPP:254+` | `EZ_FAULT_IF_NULL(p);` after the two displacement `eval()` calls of `(d,An)` / `(d,PC)` | After a syntax error `eval()` returns NULL and the next line reads `p[1]`: an access violation in the original, caught by `opParse()`'s `catch(...)` -> "ERROR: An exception occurred in routine 'opParse'. ". In WebAssembly address 1 is readable and the code would go on with garbage. | Yes (same reasoning as P12; the unpatched MSVC /EHa twin agrees). Example: `MOVE.W (1+,A0),D0`. |
| P14 | `DIRECTIV.CPP:320+` | `if (symbol)` before `symbol->flags \|= REDEFINABLE` in `set()` | `define()` returns no symbol when a `SET` line is reached in pass 2 only (a conditional with a forward reference); the original then writes through an unassigned pointer (9.3.9). | **Differs** only in that case: the original's outcome (write through garbage, possibly a caught access violation) is not knowable; the port skips the flag. |
| P14 | `MACRO.CPP:97+` | `if (symbol)` before `symbol->flags \|= MACRO_SYM` | Same for a `MACRO` line reached in pass 2 only. | As above. |
| P15 | `GLOBALS.CPP:33` | `char buffer[256]` -> `char buffer[256 + 128]` | `listLine()` expands tabs into `buffer` and stops only after column 247, so a fixed tab size above 8 could write up to `TabSize+1` bytes past the array (9.3.8). | Yes for tab sizes up to 20 (the Editor Options limit): the overrun went into `numBuf`, which is always rewritten before use. **Differs** for tab sizes 29..99 (possible only through a hand-edited `*~Tab size~` trailer): the original also overwrote `errorCount`/`warningCount`; the API refuses sizes beyond 99. |

(P1, P9, P10 of assembler.md 9.6 need no source edit: see section 2.)

## 2. Build-level changes (no edit in `src/`)

Flags of `build.mjs` (WebAssembly) and the reasons:

| Flag / change | Why |
|---|---|
| `-std=gnu++98` | The originals return `NULL` from `int` functions and narrow `0xC100` into `short` in the instruction tables. |
| `-fno-operator-names` | STRUCTURED.CPP uses `or` as an identifier. |
| `-fms-extensions` | A Ctrl-Z byte ends a source file, as for the Borland and Microsoft compilers (P1 of 9.6 without touching the files). |
| `-fsigned-char` | `char` is signed in the Borland build; sign extension of bytes >= $80 is observable (3.3). |
| `-fwrapv`, `-fno-strict-aliasing` | Signed overflow wraps (hex/decimal conversion, `doOp`), as on x86. |
| `-ftrivial-auto-var-init=zero` | Every local the originals read before writing is 0 (complements P4/P7; covers the cases not worth a patch, e.g. bytes of `capLine` past its terminator that `opParse` peeks at on malformed lines). |
| `-O2`, `-fwasm-exceptions`, `-sWASM_LEGACY_EXCEPTIONS=1` | Optimised build; the originals' `try`/`catch(...)` work, with the exception encoding Safari 15.2+, Chrome 95+ and Firefox 100+ support. |
| `-sSTACK_SIZE=8 MB`, `-sINITIAL_MEMORY=16 MB`, `-sALLOW_MEMORY_GROWTH=1` | 256 nested macro calls need about 3 MB of stack (9.3.7). |
| `-include shim/ez_prelude.h`, `-I shim/include -I shim/include-lc` | The shim: stand-in headers for `<vcl.h>`, `<system.hpp>`, `<process.h>`, `<stack.h>`, `<vector.h>`, `"mainS.h"`, `"textS.h"`, `"texts.h"` (LISTING.CPP:63 spells it in lower case), `"assembleS.h"`, `"editorOptions.h"`. |
| BINFILE.CPP not compiled | Dead code with a duplicate definition of `startAddress` (9.1 B6, P9). |
| ERROR.CPP compiled with `-DprintError=ez_original_printError` | The shim's `printError()` (shim/ez_host.cpp) records the status code and calls the original. This is how a message row gets its severity; it changes nothing else (P10: the GUI half of `printError` itself runs unchanged against the shim's editor objects). |

The native twins (`native/build.mjs`, MSVC 19.44, x86, `/Od /EHa /MT`, 16 MB
stack) compile the same files with the same shim (`/FI ez_prelude.h`). `/EHa`
makes `catch(...)` catch access violations and divide faults, as Borland's
does. The unpatched twin uses the reference files with only P2 and P3 applied
(without them MSVC cannot compile or link the sources at all).

## 3. Shim decisions

The shim (`shim/`) replaces the VCL and the Borland C run-time. These are the
places where it has to decide something observable:

| Topic | Decision | Same as Borland? |
|---|---|---|
| Files | All files are in memory (shim/ez_file.cpp); `fopen`, `fgets`, `fprintf`, `fputs`, `putc`, `fread`, `feof`, `ferror`, `fseek`, `ftell`, `rewind` are redirected to it (ez_prelude.h). | - |
| Text mode | Per file, from the `fopen` mode: without `b` reading removes the CR of CR LF and stops at Ctrl-Z, writing turns LF into CR LF; `ftell`/`fseek` use raw offsets (so macro symbol values count 2 bytes per line end, 9.4.2). With `b` bytes pass unchanged (INCBIN). | Yes for CR LF, LF, Ctrl-Z. A **lone CR** (not before LF) inside an INCLUDE file is removed (`EZ_TEXT_DROP_ALL_CR = 1`), following the Borland RTL documentation ("read removes carriage returns"); Microsoft's CRT keeps it. UNVERIFIED on the real program; one constant switches it. The main source never contains one (the editor saves CR LF). |
| Editor save | The main source is the editor text, written as `TStrings::SaveToFile` does (mainS.cpp:373): every line followed by CR LF, the last one included; CR LF, a lone LF and a lone CR all count as a line break. | Yes for CR LF text. How the original's rich-edit control splits a lone LF or CR into lines is UNVERIFIED (editor-ui.md 6.7); a lone LF gives the same result either way. |
| File names | `\` and `/` are separators; names compare case-insensitively (Windows-1252 letters too); `.`/`..` resolved; trailing dots and spaces of a component ignored; characters Windows forbids (`< > : " \| ? *`, control characters such as TAB) make `fopen` fail; relative names are resolved against the folder of the main source (`SetCurrentDir`, mainS.cpp:370), also for nested includes; drive-letter paths only match files supplied under such a name. | Yes, for the files the caller supplies. |
| Open files | At most 47 files open at once; the next `fopen` fails ("Unable to access specified file"). This ends an INCLUDE that includes itself after 43 levels. | The Borland RTL has a fixed stream table (`_NFILE_` = 50 including stdin/stdout/stderr); the exact limit of EDIT68K.EXE is UNVERIFIED. |
| `<ctype.h>` | `isspace`, `isalpha`, `isalnum`, `isdigit`, `isupper`, `isxdigit`, `toupper`: 7-bit ASCII "C" locale; any byte >= $80 (negative `char`) is in no class and unchanged by `toupper`. | Borland indexes a table with the negative value; what that gives is UNVERIFIED (9.2). Visible only for bytes >= $80 outside quotes and comments (labels, mnemonics). |
| `stricmp`, `strcmpi`, `strnicmp`, `itoa` | ASCII case folding; decimal. | Yes (only equality is tested). |
| `AnsiString` | Minimal class (shim/ez_vcl.cpp): concatenation, comparison, `c_str()`, `UpperCase()` (ASCII; only compared with `<GT>`...), `IntToHex` with upper-case digits, construction from `char` (one character) and `int` (decimal). | Yes for every use in the engine. |
| `DateTimeToStr(Now())` | `Now()` is the time the caller passes. Format of `DateTimeToStr` with the en-US locale: `M/D/YYYY h:mm:ss AM` / `PM`, 12-hour clock, and **only the date at exactly midnight** (Delphi's `'c'` format omits a zero time). | Yes on a US-English Windows system. |
| Editor windows | One window: the one being assembled. `Main->MDIChildCount` is 0, `Main->OpenFile()` does nothing. Its message list is the result's message list; each row records `includeFile[]` at the moment it was added (the file the message belongs to) and the status code. Tab type and size are the caller's, for the whole run. | The original opens an include file that has an error in a new window and makes it the active window, so later rows and the tab expansion of later listing lines use that window (5.2, 4.2). The port keeps the main document's tab settings throughout and reports the file per row. |
| Message boxes | `Application->MessageBox` and `ShowMessage` are recorded and returned as `dialogs`. | Not shown modally. |
| Fixed tab size 0 | `j % TabSize` with 0 raises the shim's CPU-fault exception (shim/ez_vcl.h `EzTabSize`), caught by `listLine()`'s `catch(...)`: every listed line with a tab gives "ERROR: An exception occurred in routine 'listLine'. " (line 0, not counted) and the listing loses that line's text. | Yes, if Borland's `catch(...)` catches the divide fault (as P12). |
| Structured-code stacks | `top()`/`pop()` on an empty stack raise the CPU-fault exception, caught by `asmStructure()`'s `catch(...)` -> "Invalid syntax" (9.3.6). | Yes for the first use of a stack in a run (null-pointer read). After a stack has been used and emptied the original reads stale heap data instead (not knowable); the port answers "Invalid syntax" there too. |
| `new` | Every allocation is zero-filled. | Fields of a symbol created on a line that already has an error are left unwritten by the engine (9.3.3); Borland's heap content there is not knowable, the port gives 0. |
| `sprintf` to a NULL buffer | Raises the CPU-fault exception (Borland: access violation, caught by the nearest `catch(...)`). Reached only by `listCond()` in the case of 1.8 (`listPtr` still NULL). | Yes. |
| `exit()` | Unreachable (`effAddr()` with a corrupt table). Aborts the run; the API reports `fatal`. | The original ends the editor. |
| Macro nesting | 256 levels work (8 MB wasm stack, 16 MB native), the 257th gives "Nested Macro calls are too many levels deep". | The original has a 1 MB stack and about 11.6 KB per level, so it probably overflows its stack at roughly 85 levels (9.3.6). The official EDIT68K.exe v5.16.1 under Wine crashes with a stack overflow on such a program (`tests/conformance/asm/golden/REPORT.md`, `checklist/macro-13-recursion-to-the-limit`; docs/DIFFERENCES.md part T1); so does the 5.15.4 CLI oracle, also 1 MB. |

## 4. How the patches were verified

- `node --test` in `engine/asm` (see README.md): every test program through the
  WebAssembly build, the -O0 WebAssembly build, and both native twins. The
  patched twin and the -O0 build agree with the -O2 build on every run; the
  unpatched twin differs exactly in the runs that exercise P5, P7 and P8 and
  nowhere else (`test/native.test.mjs`, `UNPATCHED_DIFFERS`). P6, P11, P12 and
  P13 change nothing relative to the unpatched MSVC /EHa build, as intended.
- `test/corpus-diff.mjs` (report in `build/reports/asm-corpus-diff.md`): the
  488 example programs, two option sets each.
