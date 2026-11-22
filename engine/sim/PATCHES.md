# Changes to the original Sim68K v5.16.1 sources

The files in `src/` are copies of the simulator core of EASy68K v5.16.1
(`Sim68Kv5.16.1/` in the original source archive, author Charles Kelly and
others, GPL). They are kept byte-for-byte except for the changes listed
here. Every change is marked in the file with a comment that starts
`[easy68k-mac]`; larger ones are enclosed in `[easy68k-mac] BEGIN` /
`[easy68k-mac] END`, with removed original lines kept inside `#if 0`.

To verify, with the original sources at hand:

```
node engine/sim/check-patches.mjs [--list] [path/to/Sim68Kv5.16.1]
```

It compares bytes, fails on any change that is not marked or not in the table
below, and fails if the table lists a change that is not there.

Line numbers below are those of the **original** files.

## 1. Files

| File | State |
|---|---|
| `def.h`, `PROTO.H`, `OPCODES.H`, `CODE6.CPP`, `BPoint.h`, `BPointExpr.h`, `BPointExpr.cpp` | identical to the original |
| `extern.h`, `var.h`, `RUN.CPP`, `UTILS.CPP`, `CODE1.CPP`, `CODE2.CPP`, `CODE3.CPP`, `CODE4.CPP`, `CODE5.CPP`, `CODE7.CPP`, `CODE8.CPP`, `CODE9.CPP`, `SIMOPS2.CPP`, `STARTSIM.CPP`, `BPoint.cpp` | changed as listed in section 2 |

Not ported, because the original does not compile them into SIM68K.exe (they
are leftovers of a command-line ancestor): `SIMOPS1.CPP`, `SCAN.CPP`,
`STRUTILS.CPP`.

Not copied, but re-implemented in `shim/` (they are Windows GUI forms; only
their logic that the 68000 program or the execution log can observe was
ported, function by function, with the original line numbers in comments):
`SIM68Ku.cpp` (main window) -> `shim/form1.cpp`, `shim/runloop.cpp`,
`shim/api.cpp`; `hardwareu.cpp` -> `shim/hardware.cpp`; `simIOu.cpp` ->
`shim/simio.cpp`; `logU.cpp` -> `shim/log.cpp`; `BREAKPOINTSu.cpp`,
`Memory1.cpp`, `Stack1.cpp`, `Net.cpp` -> `shim/misc.cpp`. Section 5 lists
where those ports deliberately differ.

## 2. Changes inside the original files

"Observable difference" means: can a 68000 program, the message area or the
execution log show something else than the Windows program built with
Borland C++ Builder 6 would.

| Id | File | Original lines | What changed | Why | Observable difference |
|---|---|---|---|---|---|
| P01 | `extern.h` | 34-37, 57-64 | The `extern` declarations of `D, A, PC, SR, global_temp, OLD_PC, EA1, EA2, EV1, EV2, source, dest, result, inst` are disabled (`#if 0`); `shim/regblock.h` is included instead, which declares one struct with these members in this order and references with the original names. | `put()` and `value_of()` tell "register" from "68000 memory" by comparing a pointer with `&D[0]` and `&inst`. Borland placed globals in declaration order; Clang and the wasm linker do not promise that. A struct does. (sim-core.md 11.2) | None. |
| P02 | `var.h` | 43-53 | The definitions of the same variables are replaced by the definition of the struct `easy68k_regs`. | Same. | None. |
| P03 | `RUN.CPP` | 26 | `#include "easy68k.h"` added. | Declarations for P04-P10. | None. |
| P04 | `RUN.CPP` | 643-651 | `runprog()` is resumable. It starts with a jump to where it left off (`easy68k_phase`); `exec_inst()` is called through `easy68k_exec_inst()`; the loop `do { ProcessMessages(); if (inputMode) Sleep(10); } while (inputMode && runMode);` is replaced by a return of `SIM_WAIT_INPUT` to the host while `inputMode && runMode`. `runprog()` returns 0 when the step is complete, else a wait code. | The original blocks here; a WebAssembly module without Asyncify cannot. Statement order is unchanged. | Host events (keys, interrupt requests, Pause, the Reset button ...) are delivered between calls of the engine, i.e. only at the place of `runLoop`'s own `ProcessMessages()`, or during a wait. The original also delivers them in the pump inside `runprog`. That removes two races of the original (README, "Decisions"): the Reset button always sees the stale `OLD_PC`, and an interrupt request arriving right after a STOP is never lost. |
| P05 | `RUN.CPP` | 751-756 | `exec_inst()` starts with a jump to one of its two wait points when it is re-entered; `try {` becomes a plain block. | See P07/P08; C++ does not allow a jump into a `try` block, so the try/catch moved to `easy68k_exec_inst()` in `shim/runloop.cpp`, which calls `exec_inst()` and, on an exception, the original handler (P09). | None. |
| P06 | `RUN.CPP` | 806 | Execution-log memory dump: format `"%hc"` -> `"%c"`. | Borland's printf prints a character for `%hc`; musl's (the C library of Emscripten) treats it as an error and prints nothing. | None (restores the original output). |
| P07 | `RUN.CPP` | 855 | Wait point after the instruction handler returned: if the handler asked for a wait (TRAP #15 task 23 delay, task 58 file dialog, the "Current Log Stopped." box of task 9 / SIMHALT), `exec_inst()` returns the wait code and continues here on the next call, before exception and interrupt processing. | In the original these waits happen inside the handler, i.e. before this point: interrupt requests that arrive during a delay are seen by the interrupt test of the same instruction. | None in the order of effects. Real time is supplied by the host. |
| P08 | `RUN.CPP` | 955 | Wait point after `Log->stopLogWithAnnounce()` in the "STOP with exceptions disabled" case. | The original shows its modal box at this point, before `Hardware->disable()`; timer ticks during the box are still latched. | None. |
| P09 | `RUN.CPP` | 1008 | `} catch( ... ) {` ... `}`: the handler body is now the function `exec_inst_catch()`. Its statements are unchanged. | See P05. | None for what the original handler does. What reaches it differs: see section 4, "Exceptions". |
| P10 | `RUN.CPP` | 1042 | `Easy68kDepth` guard object at the top of `exceptionHandler()`. | Unbounded recursion, see section 4. | See section 4, "Unbounded recursion". |
| P11 | `UTILS.CPP` | 25 | `#include "easy68k.h"` added. | Declarations for P13. | None. |
| P12 | `UTILS.CPP` | 372 | `(maptype)` cast on `Invalid \| Protected \| Read \| Rom`. | Implicit int-to-enum conversion is a Borland extension. | None. |
| P13 | `UTILS.CPP` | 424 | `Easy68kDepth` guard object at the top of `mem_req()`. | Unbounded recursion, see section 4. | See section 4. |
| P14 | `UTILS.CPP` | 722 | `cc_update`, V flag of ASL: `>> shiftCount+1` -> `>> ((shiftCount+1) & 31)`. | The shift count reaches 32..64, which is undefined in C. The x86 `SHR` instruction of the original build takes the count modulo 32; this writes that down. | None (test: quirks.test.mjs, "ASL: the V flag ..."). |
| P15 | `CODE1.CPP` | 184 | `MOVEA` with an illegal source mode (`src == 12`): add 4 cycles (word) or 0 (long) instead of reading `move_bw_times[12][1]` / `move_l_times[12][1]`. | The read is one row past the end of the tables. | The cycle counter for such an (illegal) instruction is 4 / 0 here. In the original it is whatever followed the tables; if Borland laid the four timing tables out in source order - which cannot be proven from the source - those are the same values. |
| P16 | `CODE2.CPP` | 110, 147 | `PEA`, `LINK`: `put((long *)&memory[A[..]], v, size)` -> `mem_put(v, A[..], size)`. | See section 4, "Unmasked memory pointers". | None in any reproducible case. |
| P17 | `CODE3.CPP` | 222, 442 | `ADDX`, `SUBX` (memory form): same replacement. | Same. | Same. |
| P18 | `CODE5.CPP` | 69, 129 | `ABCD`, `SBCD` (memory form): same replacement. | Same. | Same. |
| P19 | `CODE8.CPP` | 141, 200 | `BSR`, `JSR`: same replacement. | Same. | Same. |
| P20 | `CODE4.CPP` | 77 | `abs` is redefined for this file as a function that returns `INT_MIN` for `INT_MIN`. | `getDivs68kCycles()` calls `abs()` on values that can be `INT_MIN`: undefined in C; the x86 code of the original leaves the value unchanged. | None. |
| P21 | `CODE7.CPP` | 159 | `(uint)EV1 >>= 1;` -> `EV1 = (long)((uint)EV1 >> 1);` | A cast used as an lvalue is a Borland extension. | None. |
| P22 | `CODE7.CPP` | 237 | `&(static_cast<long>(bit_no))` -> `(long *)&bit_no` | The address of a cast is a Borland extension. The meaning (the fetched word is stored in `bit_no`) is the only one under which immediate bit numbers work at all. | None. |
| P23 | `CODE9.CPP` | 28 | `#include "easy68k.h"` added. | Declaration for P25. | None. |
| P24 | `CODE9.CPP` | 738, 740 | TRAP #15 tasks 0 / 1: `buf[(short)D[1]] = '\0'` only `if ((short)D[1] >= 0)`; otherwise (gate I2) `buf[255] = '\0'`. | With D1.W = $8000-$FFFF the original writes a zero byte up to 32768 bytes below a stack buffer. `strncpy(buf, inStr, 255)` writes no NUL for a string of 255 bytes or more, so without the explicit end the text printed depended on the compiler (it was 255 characters only because the build zero-fills locals, `-ftrivial-auto-var-init=zero`; errata T4.md D1). | In that case the original prints the string and then whatever follows in an unterminated stack buffer, and corrupts its own stack: not reproducible. Measured under Wine (errata T4.md D1, T3.md F1): 255 characters, or 255 and one byte `$C0`, depending on the 68000 instruction before the `TRAP`. Here the string is printed up to its NUL, at most 255 characters, whatever the compiler. |
| P25 | `CODE9.CPP` | 881-885 | TRAP #15 task 23: the loop `while (n-- > 0 && runMode) { ProcessMessages(); Sleep(10); }` -> `easy68k_delay(n)`, which records the count; P07 then returns `SIM_WAIT_DELAY` until the host has reported `n` periods or `runMode` is false. | A blocking wait inside the instruction. | None in what executes. One period is 10 ms nominal; the host decides how long it really is (the original's `Sleep(10)` is about 15.6 ms on Windows). |
| P26 | `CODE9.CPP` | 1016 | `(maptype)` cast on `Invalid \| Read \| Rom`. | As P12. | None. |
| P27 | `SIMOPS2.CPP` | 63 | `fileOp()` (task 59): `fclose(fp)` only `if (fp != NULL)`. | The original calls `fclose(NULL)` when the file does not exist; that crashes in musl. | None. |
| P28 | `STARTSIM.CPP` | 155 | `sprintf("%u", cycles)` -> `sprintf("%u", (unsigned int)cycles)`. | A 64-bit argument for `%u` is undefined; on Win32 it prints the low 32 bits. | None. |
| P29 | `STARTSIM.CPP` | 175 | `easy68k_scrshow_done();` added at the end of `scrshow()`. | Tells the host that the displayed registers changed (`host.registersShown`). | None. |
| P30 | `BPoint.cpp` | 178 | Memory break condition: `mem_req((int)typeId, curSize, &valueFound)` instead of `value_of(curEA, ...)` with `curEA = (long *)&memory[typeId]`. | `typeId` is not masked, so that pointer can lie anywhere; see section 4, "Unmasked memory pointers". `mem_req(typeId)` is what `value_of` does with it. | None in any reproducible case. |

## 3. Build-level substitutions (no file edits)

These keep further lines of the originals unchanged.

- **`shim/prelude.h`** is force-included (`-include`) before every file. It
  includes the standard headers the originals use without including them
  (`<string.h>`, `<stdlib.h>`) - and includes them *before* `def.h`, whose
  `#define uint unsigned int` / `ushort` / `uchar` would break the C library
  typedefs of the same names. It defines `__fastcall` (empty) and `__int64`
  (`long long`), the Windows types named in `var.h` / `extern.h` (`byte`,
  `HRESULT`, `CALLBACK`, `LPCTSTR`, ...), declares Borland's `itoa` / `ultoa`,
  and renames `fopen` and `remove` to `easy68k_fopen` / `easy68k_remove`
  (`shim/hostfile.cpp`), which serve the files of TRAP #15 tasks 50-59 from the
  host and the S-record text from the bytes the host handed over.
  Since gate 3 (branch `gate3/stdio`) it also renames `fread`, `fwrite`, `fseek`, `fclose` and
  `feof` (function-like macros) to `easy68k_*` functions in `shim/hostfile.cpp`. On the files of
  the 68000 program these are **the stream of the Borland C++ Builder 6 run-time library** that is
  linked into SIM68K.exe, modelled function by function from its machine code and measured in the
  official program under Wine: one 512-byte buffer, one signed `level` counter for both directions,
  the flags `READ`, `WRIT`, `ERR`, `EOF`, ..., 47 free stream entries, and the system calls below
  (`ReadFile`, `WriteFile`, `SetFilePointer`, `CloseHandle`) taken from the host's file interface,
  which did not change. `shim/STDIO-MODEL.md` is the specification, with the address of every
  function in SIM68K.exe and the probe that shows each rule. On any other `FILE*` (loadSrec's
  `"rt"` stream, the execution log) they are the C library's functions, as before.
  Until then the streams were unbuffered `fopencookie` streams of this build's C library, and the
  host imitated the run-time's buffering; the sequences C leaves undefined came out differently
  (trap15-a `a51`, `a52`, `a53`: a read right after a write, a write right after a read, a close
  that fails and leaves the file open; they now produce the official results). Observable
  differences that remain: the bytes a read in the write state returns from the buffer's memory
  where the original's heap held something the port cannot know, and the bytes past the end of a
  buffer (STDIO-MODEL.md sections 7 and 10; docs/differences/SH6.md). The two special cases that
  gate I2 measured are part of the model: `fwrite` with an item size of 0 returns the item count
  (task 54 with D2 = 0 gives D0.W = 0, not 2), and `fread` of 0xFFFFFFFF bytes returns the
  requested count because the failed `ReadFile` returns -1, which the run-time compares with the
  count (task 53 whose bounds test wraps, A1 = $2000 and D2 = $FFFFFFFF, gives D0.W = 0 and leaves
  D2 unchanged; T3: `tests/conformance/sim`, trap15-a `a31` and `a32`; errata T3.md F3, F4). Other
  wrapping counts now fail as the original's do (D0.W = 2) instead of returning the count. Tests:
  io.test.mjs ("file tasks 50-59 ..."), `app/src/engine/trap15.test.ts`, and the conformance
  programs trap15-a `a30`-`a37` and `a51`-`a60`; `test/stdio.test.mjs` for the rules that no official
  run measures yet (STDIO-MODEL.md section 9).
  `shim/simio.cpp` (`fileDialogReply`) tells `shim/hostfile.cpp` when a task 58 dialog was
  accepted (`easy68k_files_folder_changed`), and `shim/api.cpp` takes the size of the memory
  padding from `shim/easy68k.h` (`EASY68K_MEMORY_PADDING`), which the streams use to tell where
  the 68000 memory ends.
- **Stand-in headers with the original names**, found through the include
  path: `shim/vcl/vcl.h`, `dos.h`, `Printers.hpp`, `iostream.h`, `conio.h`,
  `net.h`, and the form headers `shim/SIM68Ku.h`, `simIOu.h`, `hardwareu.h`,
  `logU.h`, `Memory1.h`, `Stack1.h`, `Optionsu.h`, `BREAKPOINTSu.h`. They
  declare small classes (`AnsiString`, `TEdit`, `TCheckBox`, `TForm1`,
  `TsimIO`, `THardware` ...) with just the members the core uses, so that
  statements such as `Form1->Message->Lines->Add(str.sprintf(...))`,
  `Form1->regSR->EditText[3] == '0'` or `Hardware->ROMChk->Checked = true`
  compile as they are. Assigning a `Checked` or `EditText` runs the same
  handler the VCL would run, and only when the value changes.
  Clearing the listing's lines (`ListBox1->Items->Clear()`, in `OpenFile`)
  also drops the list box's selection (`ItemIndex = -1`), as the VCL's
  `TListBoxStrings.Clear` does by sending `LB_RESETCONTENT`; until gate I1
  round 3 only `ListBox1->Clear()` did, so a program opened over another one
  with the same start address kept the old row marked (`shim/form1.cpp`,
  `listingItemsCleared`; test: loader.test.mjs, "opening a program over
  another one ...").
  `shim/vcl/proto.h` and `opcodes.h` forward to `PROTO.H` / `OPCODES.H` (the
  originals include them in both spellings; that only works on a
  case-insensitive file system).
- **Compiler flags** (`build.mjs`):

| Flag | Reason |
|---|---|
| `-std=gnu++14` | In C++17 `byte` (used by the originals as the Windows type) clashes with `std::byte`, because `var.h` / `extern.h` say `using namespace std;`. |
| `-fwasm-exceptions`, `-sWASM_LEGACY_EXCEPTIONS=1` | The original `try { } catch (...)` blocks stay and work: the stand-ins throw where the VCL throws (bad number text, list index out of range). Legacy wasm exceptions are supported by every current browser, Safari included (15.2+), and by Node. |
| `-fwrapv` | Signed overflow wraps. The handlers do 68000 arithmetic in host `long`s (`source + dest`, `-dest`, `temp << 8`, `1 << 31`, `-1 << width` ...). |
| `-fwrapv-pointer` | Pointer arithmetic wraps (`&memory[unmasked index]`, section 4). |
| `-fno-strict-aliasing` | `(long *)&memory[..]`, `*EA1` on memory, `(long *)&SR`, `(short *)&D[0]`, `(char *)&D[1]`, `(long *)&inst` ... |
| `-fsigned-char` | Plain `char` is signed in the Borland build: `switch ((char)D[0])`, `(char)D[2]` as radix and field width, `memory[..] >= ' '` in the log, `s_byte[0] >= ' '` in the loader, `char bpoints`. (wasm32 Clang has this default; the flag pins it.) |
| `-ftrivial-auto-var-init=zero` | Local variables that the original reads before writing them are zero instead of indeterminate, and the optimiser cannot exploit the undefined read: `ext` in `eff_addr` after a failed extension-word fetch, `temp` in `MOVEP`, `curSize` in `BPoint::isBreak`, `bytecount` / `loc` / `s_byte` in `loadSrec`, `buf` in `TRAP`. Original outcome: unknowable (stack contents). |
| `-fms-extensions` | 18 of the original files end with a Ctrl-Z byte (0x1A, the DOS end-of-file mark). Clang accepts it as end of file only in this mode. Nothing else of the mode is used. |
| `-sALLOW_MEMORY_GROWTH=0`, `-sINITIAL_MEMORY=64MB` | wasm32 has the ILP32 data model the code assumes (`int`, `long` and pointers 32 bits, little-endian). Fixed memory keeps JavaScript views of 68000 memory valid. |
| `-sSTACK_SIZE=4MB` | Room for the nesting the recursion guard allows. |
| `-sFILESYSTEM=0` | No Emscripten file system: files are host imports. |

## 4. Hazards of docs/porting/sim-core.md section 11, one by one

| Hazard | Handling |
|---|---|
| 11.1 Data model | Built for wasm32 only (ILP32, little-endian). `unsigned __int64` -> `unsigned long long` through the prelude. Memory is a static array; views never go stale because memory cannot grow. |
| 11.2 Layout of globals | P01/P02: one struct. `short SR` is followed by two padding bytes (`SR_padding`), as in the Borland layout, so `put((long *)&SR, ...)` rewrites only itself. The signed pointer comparisons of `put` / `value_of` are safe: all addresses are below 2 GB (64 MB of memory). |
| 11.2 / 11.3 **Unmasked memory pointers** | Eight handlers build `&memory[A[x]]` from an unmasked register and pass it to `put()`; `BPoint::isBreak` does the same with a breakpoint address. In the original, `put` turns the pointer back into the same 32-bit value and `mem_put` masks it - unless `memory + value` happens to point into the register variables, in which case a host variable is overwritten; where that happens depends on where Windows put the heap block. P16-P19 and P30 call `mem_put` / `mem_req` with the unmasked value directly: identical in every reproducible case (same oddness test, same address in an address-error frame), and never the irreproducible one. |
| 11.3 Shift count >= 32 | P14. The other shifts by a variable count were checked: `SHIFT_ROT` tests `shift_count >= 32` itself, `cc_update` cases 2, 3, 7, 8, 9 and `BIT_FIELD` stay below 32. |
| 11.3 Signed overflow, `abs(INT_MIN)` | `-fwrapv`; P20. |
| 11.3 Arithmetic right shift of negative values | Clang does that on wasm32. |
| 11.3 Type punning, unaligned access | `-fno-strict-aliasing`; wasm loads and stores do not trap on unaligned addresses. |
| 11.3 Borland extensions | P12, P21, P22, P26. |
| 11.3 Precedence and indentation that look like bugs | Kept exactly (`shiftCount > (size-1) & source`, `0xFF80 >> (7 - ...) \| 0x40`, the mis-indented statements in `CODE7.CPP`, `UTILS.CPP`, `SIMOPS2.CPP`). |
| 11.4 Access past the end of memory | The 16 MB array is followed by 64 KB of zero-filled padding (`shim/api.cpp`). A long access at `$FFFFFE`, the 4-byte host read of `BIT_OP` / `TAS` near the top, `strlen` / `strncpy` on a string that runs off the end, and the 256-byte path written by task 58 land there. The padding is never reported as 68000 memory; a program can read back what it wrote there (as in the original, where it is whatever follows the heap block). Original contents of those bytes: unknowable. |
| 11.4 `buf[(short)D[1]]` | P24. |
| 11.4 `move_bw_times[12][1]` | P15. |
| 11.4 `brkpt[-1]` | `TBreaksFrm::cbpoint` in `shim/misc.cpp` ignores an address that is not in the table (the original decrements the count anyway; its callers never do that). |
| 11.4 Listing index past the end | `TStrings::Strings[]` in `shim/vcl/vcl.h` throws `EStringListError` like the VCL, and the original `catch (...)` blocks (kept) produce the original outcome: `Unexpected error in OpenFile`, or the `exec_inst` error box. |
| 11.4 `inst_arr[finish + 1].name`, S-record line longer than 514 characters, stale tail of `lbuf` | Unchanged code; in bounds; deterministic. |
| 11.5 `fclose(NULL)` | P27. |
| 11.5 Log file not open | `ElogFile` always points at a stream (`shim/hostfile.cpp`) that passes bytes on only while a log is open. `TLog::stopLog` closes only that. |
| 11.5 `ext`, `temp`, `curSize`, `bytecount`, `loc` uninitialised | `-ftrivial-auto-var-init=zero`. |
| 11.5 `mem_req` leaves `*result` untouched on failure; stale `source` / `dest` / `result` | Unchanged; these are static variables, so the behaviour is the original's. |
| 11.5 `stack::top()` on an empty stack in `BPointExpr::isBreak` | The file is unchanged; `sim_bp_expr_set` (`shim/api.cpp`) refuses a postfix expression that would pop an empty stack. |
| 11.5 `exec_result`, `errflg` survive resets | Unchanged (they stay static). |
| 11.6 Headers, types, library functions, `uint` macros, `byte`, include-name case | Section 3. |
| 11.7 `fprintf(ElogFile, listingLine)` | `TForm1::lineToLog` (`shim/form1.cpp`) writes the listing line with `fputs`. For a line that contains `%` the original prints something that depends on printf internals and stack contents; here the line is written literally. **This is the one place where the execution log can differ from the original.** |
| 11.7 `%u` with a 64-bit argument | P28. |
| 11.7 `%hc` (found during the port) | P06. |
| 11.8 Text mode | `loadSrec` reads its file as the Borland C library reads text mode: carriage returns are removed and Ctrl-Z ends the file (`shim/hostfile.cpp`). The execution log is written with `\n` -> CR LF, as a text-mode file on Windows. Files of TRAP #15 tasks are binary in the original too; their streams are the modelled Borland streams (section 3, `shim/STDIO-MODEL.md`). |
| 11.8 `initSim` forgets open files | Unchanged: the streams are dropped without closing. As in the original, each keeps its entry of the run-time's stream table (47 in all), its buffer and its open handle until the engine ends; the host's `fileClose` is never called for them, and the bytes their flush would write are already pending in the host, which writes them at its exit (`shim/STDIO-MODEL.md` R13, section 10). |
| 11.9 **Exceptions** | The `try` / `catch (...)` of `loadSrec` is unchanged; that of `exec_inst` moved one call up (P05, P09); those of `runLoop`, `OpenFile`, `OpenDataExecute` and the I/O window functions are in the ported shim code. They catch what the stand-ins throw: `EConvertError` (a memory-map range in an S0 record that is not hexadecimal, register text that is not a number), `EStringListError` (listing index), and `EStackOverflow` (next row). The original's handlers also caught CPU faults (access violations); those cannot occur here. |
| 11.9 **Unbounded recursion** | Two cycles: (a) a bus error whose vector fetch `mem_req(0x8, ...)` faults again (vector 8 inside an Invalid range, or a Protected range while the displayed S bit is 0): endless; (b) an exception frame pushed while the supervisor stack is inside a Read / Invalid range: `exceptionHandler -> put -> mem_put -> memoryMapCheck -> exceptionHandler`, which ends when the stack pointer has moved out of the range (4 bytes per level). P10 and P13 count the nesting; beyond 1000 levels `EStackOverflow` is thrown. Inside `exec_inst` that ends in the original handler: the box `ERROR: An exception occurred in routine 'exec_inst'.` and trace mode - which is what a stack overflow most probably caused in the original (not verifiable). Outside `exec_inst` it ends in the surrounding original handler (`Unexpected error in runLoop`, `Error in FormKeyPress`) or, where the original has none, in a message box `Stack overflow`. **Difference:** cycle (b) with a range of more than about 4000 bytes below the stack pointer ends in the error box here, while the original would complete the nesting if its 1 MB stack sufficed. |
| 11.10 `char` signedness | `-fsigned-char`. |
| 11.11 Timing | The engine never reads a clock: `gettime()` (task 8) asks the host; delays and timers are driven by the host (README, "Time"). |
| 11.12 Re-entrancy | The engine is not re-entrant and imports must not call back. A command that executes (`sim_cmd_trace`, `sim_auto_trace_tick`) is refused with `SIM_BUSY` while a step is suspended. |
| 11.13 Endianness | wasm is little-endian; the pointer tricks are unchanged. |

## 5. Where the ported GUI logic differs from the original on purpose

All in `shim/`; none of these is an edit of an original file.

| Where | Difference | Why |
|---|---|---|
| `runloop.cpp`, `easy68k_run_loop` | `TForm1::runLoop` without `Application->ProcessMessages()` and without the `running` guard. | P04. |
| `hardware.cpp`, `IRQprocess` | Does not call `Form1->runLoop()`; the exported function returns `runMode` and the host calls `sim_run`. | No nested loops. |
| `form1.cpp`, `lineToLog` | `fputs` instead of `fprintf(ElogFile, line)`. | 11.7. |
| `form1.cpp`, `isInstruction`; `vcl.h`, `AnsiString::operator[]` | An index outside the string reads as `'\0'`. | The VCL reads past the string; unknowable. |
| `vcl.cpp`, `AnsiString::Compare` | The relational operators (`<`, `>=`) order strings by an approximation of the Windows locale order (non-alphanumeric < digits < letters; letters without regard to case). | The VCL uses `AnsiCompare`. The engine uses the order only in the binary search of `lineToLog` and in the range test of the listing's first line. Exact for keys and lines made of hexadecimal digits; for other listing lines (symbol table, summary lines) the order of punctuation among itself is the byte order here, which can change which way the search goes. |
| `vcl.cpp`, `TextProp::set` (TMaskEdit) | A masked edit box (`aaaaaa;0;0` etc.) always holds exactly its number of characters; missing or inadmissible characters read as `0`. | VCL behaviour that could not be verified from the source (hardware.md V1). |
| `hardware.cpp`, interval box | A value above 99999999 assigned to the 8-digit interval box keeps its first eight digits. | hardware.md U1, not verifiable. |
| `simio.cpp`, `charIn` | The two locals whose addresses the original stores in globals are `static`. | Dangling pointers otherwise (never dereferenced in the original either). |
| `simio.cpp`, `FormKeyDown` | Only the part that sets the key state and requests the interrupt; Ctrl+Tab, Alt+Enter and Shift+Insert are window management for the host. | |
| `log.cpp`, `startLog` | Writes the execution-log header and sets `logging`; does not open files or ask Replace / Append / Cancel (host). If the user cancels, the host simply does not call it; the original sets `logging = true` even then and writes to a closed file. | 11.5. |
| `misc.cpp`, `cbpoint` | See 11.4. | |
| `api.cpp`, `sim_bp_expr_set` | See 11.5. | |
| `simio.cpp`, `displayFileDialog` / `fileDialogReply` (TRAP #15 task 58) | In Save mode with an empty `(A3)` the Save dialog's own file name is cleared, and the overflow test after OK measures the name of the dialog that was shown. The original clears and measures `OpenDialogIO->FileName` in the Save branch (`simIOu.cpp:541`, `:544`), so its Save dialog showed the name of its previous use and its overflow test used the Open dialog's name (trap15-a task 58). | ARCHITECTURE.md 3.8.4: "they are not reproduced". Changed at gate I2 (errata SH6.md entry 12); until then the shim copied both. |
