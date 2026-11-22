# Sim68K v5.16.1 - CPU core, run loop, loader, breakpoints and execution log: porting specification

Scope: `CODE1.CPP` .. `CODE9.CPP`, `RUN.CPP`, `UTILS.CPP`, `SIMOPS1.CPP`, `SIMOPS2.CPP`, `SCAN.CPP`, `STARTSIM.CPP`,
`STRUTILS.CPP`, `BPoint.cpp/.h`, `BPointExpr.cpp/.h`, `OPCODES.H`, `PROTO.H`, `def.h`, `extern.h`, `var.h`, and the
parts of `SIM68Ku.cpp` that load programs, reset the machine and drive execution.

Out of scope (documented here only as interface points): what each TRAP #15 task does (see
`trap15-tasks-0-59.md` and the graphics/sound/network specifications), the Hardware window (`hardware.md`), and the
main-window user interface (`sim-ui.md`).

## 0. Conventions

- All source paths are relative to `c:\easy64k\reference\src-sim68k\Sim68Kv5.16.1\` unless a full path is given.
  `RUN.CPP:746` means line 746 of that file.
- "The original" means the Windows program built from that source with Borland C++ Builder 6.
- **QUIRK** marks behaviour that differs from a real 68000 or from what a reader would expect. The port must keep it.
- **HAZARD** marks something that will not compile, or will behave differently, when the source is built with
  Clang/Emscripten for wasm32.
- **UNVERIFIED** marks a statement that could not be proven from the source alone (it depends on Borland, VCL or
  Windows behaviour).
- Hex numbers are written `0x1234` or `$1234`. "Word" is 16 bits, "long" is 32 bits.
- Inside tables, a `|` that belongs to quoted code is written `\|` (Markdown table escaping). Read it as `|`.
- In the original, `long` and `int` are both 32 bits and pointers are 32 bits (Win32, ILP32). wasm32 has the same
  sizes. A native 64-bit macOS or Linux build does not (section 11.1).

Reading guide for an implementer: sections 1-3 describe what exists; sections 4-8 are the behaviour rules;
section 9 lists every place the core touches the GUI; section 10 proposes the C boundary; section 11 lists what
will go wrong.

---

## 1. Architecture

### 1.1 Role of each file

| File | Lines | Role | Compiled into SIM68K.exe? |
|---|---|---|---|
| `def.h` | 264 | Constants: masks, return codes, condition-code method codes, addressing-mode masks, breakpoint constants, window default positions. Also `#define uint/ushort/uchar`. | header |
| `var.h` | 175 | **Definitions** of all core globals. Included only by `SIM68Ku.cpp` (`SIM68Ku.cpp:23`). | header |
| `extern.h` | 161 | `extern` declarations of the same globals. Included by every other unit. | header |
| `PROTO.H` | 179 | Function prototypes. Many name functions that no longer exist (section 1.9). | header |
| `OPCODES.H` | 161 | **Defines** `offsets[]`, `inst_arr[]` (instruction decode table) and `names[]` (handler function pointers). Included only by `RUN.CPP` (`RUN.CPP:21`). | header |
| `RUN.CPP` | 1127 | `decode_size`, `eff_addr`, `eff_addr_noread`, `runprog` (one step of the run loop), `exec_inst` (fetch, decode, execute, exception processing), `exceptionHandler`, `irqHandler`, `haltSimulator`. Defines `bool trace_bit`. | yes |
| `UTILS.CPP` | 883 | `to_2s_comp`, `from_2s_comp`, `sign_extend`, `inc_cyc`, `eff_addr_code`, `a_reg`, `memoryMapCheck`, `mem_put`, `mem_req`, `mem_request`, `put`, `value_of`, `cc_update`, `check_condition`, `flip`. | yes |
| `CODE1.CPP` | 392 | `MOVE`, `MOVEP`, `MOVEA`, `MOVE_FR_SR`, `MOVE_TO_CCR`, `MOVE_TO_SR`, `MOVEM`, `MOVE_USP`, `MOVEQ` and the MOVE/MOVEM timing tables. | yes |
| `CODE2.CPP` | 175 | `EXG`, `LEA`, `PEA`, `LINK`, `UNLK`. | yes |
| `CODE3.CPP` | 464 | `ADD`, `ADDA`, `ADDI`, `ADDQ`, `ADDX`, `SUB`, `SUBA`, `SUBI`, `SUBQ`, `SUBX`. | yes |
| `CODE4.CPP` | 608 | `getDivu68kCycles`, `getDivs68kCycles`, `DIVS`, `DIVU`, `MULS`, `MULU`, `NEG`, `NEGX`, `CMP`, `CMPA`, `CMPI`, `CMPM`, `TST`, `CLR`, `EXT`. | yes |
| `CODE5.CPP` | 184 | `ABCD`, `SBCD`, `NBCD`. | yes |
| `CODE6.CPP` | 387 | `AND`, `ANDI`, `ANDI_TO_CCR`, `ANDI_TO_SR`, `OR`, `ORI`, `ORI_TO_CCR`, `ORI_TO_SR`, `EOR`, `EORI`, `EORI_TO_CCR`, `EORI_TO_SR`, `NOT`. | yes |
| `CODE7.CPP` | 495 | `SHIFT_ROT`, `SWAP`, `BIT_OP`, `TAS`, `BIT_FIELD`. | yes |
| `CODE8.CPP` | 290 | `BCC`, `DBCC`, `SCC`, `BRA`, `BSR`, `JMP`, `JSR`, `RTE`, `RTR`, `RTS`, `NOP`. | yes |
| `CODE9.CPP` | 1337 | Printer helpers (`formFeed`, `lineFeed`, `nextX`, `initPrint`, `printChar`), `CHK`, `ILLEGAL`, `RESET`, `STOP`, `TRAP` (the TRAP #15 dispatcher), `TRAPV`, `LINE1010`, `LINE1111` (SIMHALT). | yes |
| `SIMOPS2.CPP` | 381 | TRAP #15 file primitives (`closeFiles`, `fileOp`, `openFile`, `newFile`, `readFile`, `writeFile`, `positionFile`, `closeFile`, `deleteFile`) and `loadSrec` (S-record loader). | yes |
| `STARTSIM.CPP` | 179 | `initSim` (simulator reset) and `scrshow` (push registers to the screen). | yes |
| `BPoint.cpp/.h` | 217/62 | `class BPoint`: one register or memory break condition; `isBreak()`. | yes |
| `BPointExpr.cpp/.h` | 155/53 | `class BPointExpr`: postfix AND/OR expression over `BPoint`s with a hit count; `isBreak()`. | yes |
| `SIM68Ku.cpp` | 2157 | Main form. In scope: constructor (allocates memory), `runLoop`, `OpenFile`, `RunExecute`, `StepExecute`, `TraceExecute`, `PauseExecute`, `RewindExecute`, `ReloadExecute`, `RunToCursorExecute`, `AutoTraceTimerTimer`, `loadRegs`, `highlight`, `isInstruction`, `lineToLog`, `defaultSettings`. | yes |
| `SIMOPS1.CPP` | 166 | `mdis`, `memread`, `memwrite`, commented-out `selbp`. Left over from the command-line ancestor. | **no** |
| `SCAN.CPP` | 56 | `scan`, `iswhite` (command-line tokeniser). | **no** |
| `STRUTILS.CPP` | 237 | `getText`, `same`, `eval`, `eval2`, `getval`, `strcopy`, `mkfname`, `pchange`. | **no** |

`SIMOPS1.CPP`, `SCAN.CPP` and `STRUTILS.CPP` are **dead code**: they are not in the project's object list
(`SIM68K.BPR:7-11` lists `SIM68K SIM68Ku UTILS CODE2..CODE9 RUN SIMOPS2 STARTSIM CODE1 Stack1 Memory1 BREAKPOINTSu
aboutS logU BPoint BPointExpr simIOu help Optionsu hardwareu FullscreenOptions LogfileDialogu Net findDialogS`), and
they call functions that are defined nowhere (`windowLine`, `scrollWindow`, `cmderr`). Do not port them. Their
contents are summarised in section 1.9 only so that nobody mistakes them for live behaviour.

Build flags of the original (`SIM68K.BPR:39`): `-O2 -Vx -Ve -X- -a8 -b- -k- -vi -c -tW -tWM`. Relevant
consequences: plain `char` is signed (no `-K`); enums are byte-sized where possible (`-b-`); data alignment 8.

### 1.2 Constants (`def.h`)

| Group | Names and values | Line |
|---|---|---|
| Version | `TITLE = "EASy68K Simulator v5.16.1"`, `VERSION = 0x00051001` (returned by TRAP #15 task 32/4) | 23-24 |
| Memory-map flags | `enum maptype {Invalid=0x01, Protected=0x02, Read=0x04, Rom=0x10}` | 27 |
| Mode bits | `bit_1=0x0001` .. `bit_12=0x0800` (one per addressing mode, see 3.6) | 31-42 |
| SR bits | `cbit=0x0001, vbit=0x0002, zbit=0x0004, nbit=0x0008, xbit=0x0010, intmsk=0x0700, sbit=0x2000, tbit=0x8000` | 45-52 |
| Memory | `MEMSIZE = 0x01000000` (`uint`), `ADDRMASK = 0x00ffffff` | 56-57 |
| Size masks | `BYTE_MASK = 0xff`, `WORD_MASK = 0xffff` (both `int`), `LONG_MASK = 0xffffffff` (`const long`, so its value is -1) | 59-61 |
| Register counts | `D_REGS = 8`, `A_REGS = 9` | 64-65 |
| Addressing-mode sets | `DATA_ADDR=0x0ffd`, `MEMORY_ADDR=0x0ffc`, `CONTROL_ADDR=0x07e4`, `ALTERABLE_ADDR=0x01ff`, `ALL_ADDR=0x0fff`, `DATA_ALT_ADDR=0x01fd`, `MEM_ALT_ADDR=0x01fc`, `CONT_ALT_ADDR=0x01e4` | 74-81 |
| Instruction return codes | `SUCCESS=0`, `BAD_INST=1`, `NO_PRIVILEGE=2`, `CHK_EXCEPTION=3`, (`ILLEGAL_TRAP=4` commented out), `STOP_TRAP=5`, `TRAPV_TRAP=6`, `TRAP_TRAP=7`, `DIV_BY_ZERO=8`, `USER_BREAK=9`, `BUS_ERROR=0xA`, `ADDR_ERROR=0xB`, `LINE_1010=0xC`, `LINE_1111=0xD`, `TRACE_EXCEPTION=0xE`, `ROM_MAP=0xF`, `FAILURE=0x1111` | 86-102 |
| Condition-code methods | `N_A=0, GEN=1, ZER=2, UND=3, CASE_1=4 .. CASE_9=12` | 107-119 |
| Decode helpers | `MODE_MASK=0x0038`, `REG_MASK=0x0007`, `FIRST_FOUR=0xf000`, `READ=0xffff`, `WRITE=0x0000` | 124-129 |
| Conditions | `COND_T=0, COND_F=1, COND_HI=2, COND_LS=3, COND_CC=4, COND_CS=5, COND_NE=6, COND_EQ=7, COND_VC=8, COND_VS=9, COND_PL=10, COND_MI=11, COND_GE=12, COND_LT=13, COND_GT=14, COND_LE=15` | 134-149 |
| File results | `F_SUCCESS=0, F_EOF=1, F_ERROR=2, F_READONLY=3` (`short`), `MAXFILES=8`, `struct FileStruct { FILE *fp; char name[256]; }` | 153-163 |
| Log types | `DISABLED=0, INSTRUCTION=1, REGISTERS=2, INST_REG_MEM=3, TEXTONLY=1`. (`CANCEL`, `APPEND`, `REPLACE` exist only as commented-out lines.) | 166-174 |
| Breakpoints | `MAX_BPOINTS=100, MAX_BP_EXPR=50, MAX_LB_NODES=10, AND_OP=0, OR_OP=1, LPAREN=102, RPAREN=103, ADDR_ID_OFFSET=50, MAX_REG_ROWS=MAX_ADDR_ROWS=MAX_EXPR_ROWS=50, PC_REG_TYPE=0, ADDR_TYPE=1, D0_TYPE_ID=0, D1_TYPE_ID=1, D2_TYPE_ID=2, D3_TYPE_ID=3, D4_TYPE_ID=4, D5_TYPE_ID=5, D6_TYPE_ID=6, D7_TYPE_ID=7, A0_TYPE_ID=8, A1_TYPE_ID=9, A2_TYPE_ID=10, A3_TYPE_ID=11, A4_TYPE_ID=12, A5_TYPE_ID=13, A6_TYPE_ID=14, A7_TYPE_ID=15, PC_TYPE_ID=16, DEFAULT_TYPE_ID=PC_TYPE_ID, EQUAL_OP=0, NOT_EQUAL_OP=1, GT_OP=2, GT_EQUAL_OP=3, LT_OP=4, LT_EQUAL_OP=5, NA_OP=6, DEFAULT_OP=EQUAL_OP, BYTE_SIZE=0, WORD_SIZE=1, LONG_SIZE=2, DEFAULT_SIZE=LONG_SIZE, RW_TYPE=0, READ_TYPE=1, WRITE_TYPE=2, NA_TYPE=3, DEFAULT_TYPE=RW_TYPE, EXPR_ON=0, EXPR_OFF=1` | 180-244 |
| Misc | `SREC_MAX=515` (S-record line buffer), `MAX_COMM=16`, `MAX_SERIAL_IN=256` | 246-249 |
| Window defaults | `FORM1_TOP=100, FORM1_LEFT=100, SIMIO_FORM_TOP=300, SIMIO_FORM_LEFT=200, MEMORY_FORM_TOP=80, MEMORY_FORM_LEFT=280, STACK_FORM_TOP=200, STACK_FORM_LEFT=40, STACK_FORM_HEIGHT=538, HARDWARE_FORM_TOP=100, HARDWARE_FORM_LEFT=240` (GUI only) | 252-262 |

`def.h:15-17` defines `uint`, `ushort`, `uchar` as **macros** (`#define uint unsigned int`). HAZARD: see 11.6.

### 1.3 Globals defined in `var.h` (declared in `extern.h`)

All are plain globals with static storage, so anything without an initialiser starts as zero.

| Name | Type | Meaning | Initial value / where reset |
|---|---|---|---|
| `memory` | `char *` | The 68000 memory, `MEMSIZE` bytes (section 1.5). | `NULL`; allocated in `TForm1::TForm1` (`SIM68Ku.cpp:153`) |
| `buffer` | `char[256]` | Scratch for building messages (`sprintf`). | - |
| `numBuf` | `char[20]` | Unused in the core. | - |
| `errstr`, `str` | `AnsiString` | Scratch VCL strings (`var.h:34`). `str` is used by `RUN.CPP:29`. | - |
| `D` | `long[8]` | Data registers D0-D7. | `initSim` sets 0 |
| `A` | `long[9]` | Address registers. `A[0..6]` = A0-A6, `A[7]` = user stack pointer (USP), `A[8]` = supervisor stack pointer (SSP). | `initSim`: A0-A6 = 0, `A[7] = 0x00FF0000`, `A[8] = 0x01000000` |
| `PC` | `long` | Program counter, full 32 bits, never masked when stored. | 0 at program start; **not** touched by `initSim` |
| `SR` | `short` | Status register (16 bits; CCR is the low byte). | `initSim`: `0x2000` |
| `global_temp` | `long` | Holds an immediate operand so that `EA1`/`EA2` can point at it. | - |
| `OLD_PC` | `long` | Address of the instruction being executed (set before it starts); used for PC-relative branches and for exception frames and messages. Section 3.5. | `initSim`: `-1` |
| `EA1`, `EA2` | `long *` | "Effective address" pointers produced by `eff_addr`: either the address of a register variable or a pointer into `memory[]` (section 1.7). `EA2` is used only for the MOVE destination. | - |
| `EV1`, `EV2` | `long` | Values read at `EA1` / `EA2`, masked to the operand size. | - |
| `source`, `dest`, `result` | `long` | Operands and result of the current instruction, passed to `cc_update`. They keep their values between instructions (some handlers read stale values, section 3.16). | - |
| `inst` | `int` | The opcode word of the current instruction (0..0xFFFF). | - |
| `cycles` | `unsigned __int64` | Cycle counter. | `initSim`: 0 |
| `trace` | `int` | Non-zero: stop after the current instruction and print it in the message area (single-step mode). | `initSim`: false |
| `sstep` | `int` | Non-zero: "Step Over" is in progress. | `initSim`: false |
| `old_trace`, `old_sstep` | `int` | Never used. | - |
| `exceptions` | `int` | Option "Enable Exceptions" (section 4). | `defaultSettings`: false |
| `bitfield` | `bool` | Option "Enable Bit Field Instructions". | `defaultSettings`: false |
| `simhalt_on` | `bool` | SIMHALT (`$FFFF $FFFF`) recognised. | `defaultSettings` and every `OpenFile`: true |
| `halt` | `bool` | Set by an instruction to stop the run loop; cleared at the start of every `runprog` (`RUN.CPP:643`). | - |
| `stopInstruction` | `bool` | Set when a STOP has executed with exceptions enabled (`RUN.CPP:897`). Cleared **only** by `initSim` (`STARTSIM.CPP:67`) and the hardware Reset button (`hardwareu.cpp:788`). | false |
| `lbuf` | `char[515]` | Line buffer for the S-record loader. | `initSim`: `lbuf[0] = 0` |
| `wordptr` | `char *[20]` | Dead (command-line ancestor). | `initSim`: `wordptr[0] = lbuf` |
| `bpoints` | `char` | Number of simple (PC) breakpoints in `brkpt[]`. | 0 |
| `brkpt` | `int[100]` | Simple breakpoint addresses. | - |
| `wcount` | `int` | Dead. | - |
| `stepToAddr` | `int` | Step Over: address at which to stop (return address of the BSR/JSR); 0 = none. | `initSim`: 0 |
| `runToAddr` | `int` | Run To Cursor target; 0 = none. | `initSim`: 0 |
| `errflg` | `int` | "The previous instruction ended in an address or bus error" latch used for double-fault detection (section 3.14). | 0; **not** reset by `initSim` |
| `port1` | `unsigned int[4]` = `{0x00,0,0x82,0}` | Dead (MC6850 model used only by `SIMOPS1.CPP`). | - |
| `p1dif` | `char` | Dead. | 0 |
| `runMode` | `bool` | True while the run loop should keep executing instructions. | false (`TForm1` ctor, `initSim`) |
| `runModeSave` | `bool` | Written by Run and Step (`SIM68Ku.cpp:449, 510`), never read. | - |
| `keyboardEcho`, `inputPrompt`, `inputLFdisplay` | `bool` | Text-input options set by TRAP #15 tasks 12 and 16. | `initSim`: all true |
| `pendingKey` | `char` | One-character type-ahead buffer for the I/O window. | `initSim`: 0 |
| `inputBuf` | `char[256]`, `inputSize` `long` | Buffer and length used for numeric keyboard input (tasks 4, 18). | - |
| `inputMode` | `bool` | True while a TRAP #15 keyboard read is waiting for the user. The run loop stalls on it (section 3.3 step 3). | `initSim`: false |
| `files` | `FileStruct[8]` | Open-file table for TRAP #15 tasks 50-59. | `initSim`: every `fp = NULL` (files are **not** closed first) |
| `ElogFlag`, `OlogFlag` | `char` | Execution-log type (0-3) and output-log type (0-1). | `defaultSettings`: 0 |
| `ElogFile`, `OlogFile` | `FILE *` | Log files. | - |
| `logging` | `bool` | True between Log Start and Log Stop. | `defaultSettings`: false |
| `logMemAddr`, `logMemBytes` | `unsigned int` | Memory range to dump in log type 3 (already rounded to multiples of 16, `logU.cpp:148-152`). | - |
| `autoTraceInProgress` | `bool` | True while the auto-trace timer handler is inside `TraceExecute`. | `initSim`: false |
| `breakPoints` | `BPoint[100]` | Break conditions: elements 0-49 are PC/register conditions, 50-99 memory conditions. | constructors set `isEnab = false` |
| `bpExpressions` | `BPointExpr[50]` | Break expressions. | zero |
| `bpCountCond` | `int[100]` | Hit counters, indexed by `BPointExpr::id`. | zero; cleared by Run (`resetDebug`) |
| `regCount`, `addrCount`, `exprCount` | `int` | Number of defined register conditions, memory conditions, expressions. | 0 |
| `infixExpr`, `postfixExpr` | `int[10]` each; `infixCount`, `postfixCount` `int`; `s_operator` `stack<int>`; `mruOperand`, `mruOperator` `bool`; `parenCount` `int` | Working state of the breakpoint-expression editor (GUI). | 0 |
| `bpRead`, `bpWrite` | `bool` | "This instruction did at least one memory read / write". Cleared at the start of `exec_inst`. | - |
| `readEA`, `writeEA` | `long *` | Pointer into `memory[]` of the **last** read / write. | - |
| `hardReset` | `bool` | Set true by the hardware Reset button, false by `initSim`; never read. | - |
| `irq` | `int` | Pending interrupt requests: bit `n-1` set = level `n` pending (bits 0-6). | `initSim`: 0 |
| `MultimonitorAPIsExist`, `FullScreenMonitor`, `FullScreenDeviceName[32]`, `ChangeDisplaySettingsExAPtr`, `EnumDisplaySettingsExAPtr`, `EnumDisplayDevicesAPtr`, `dsoundExist` | Windows-only | Full-screen and DirectSound plumbing. `FullScreenMonitor` is reset to 0 by `initSim` (`STARTSIM.CPP:85`). | not needed by the port's core |
| `mouseX`, `mouseY` (`int`); `mouseLeft`, `mouseRight`, `mouseMiddle`, `mouseDouble`, `keyShift`, `keyAlt`, `keyCtrl` (`bool`) | | Current mouse state read by TRAP #15 task 61. | `initSim`: all 0 / false |
| `mouseXUp`, `mouseYUp`, `mouseLeftUp`, `mouseRightUp`, `mouseMiddleUp`, `mouseDoubleUp`, `keyShiftUp`, `keyAltUp`, `keyCtrlUp` | same types | State captured at the last button-up event. | `initSim`: all 0 / false |
| `mouseXDown`, `mouseYDown`, `mouseLeftDown`, `mouseRightDown`, `mouseMiddleDown`, `mouseDoubleDown`, `keyShiftDown`, `keyAltDown`, `keyCtrlDown` | same types | State captured at the last button-down event. | `initSim`: all 0 / false |
| `mouseDownIRQ`, `mouseUpIRQ`, `mouseMoveIRQ`, `keyDownIRQ`, `keyUpIRQ` | `byte` | Interrupt level (0 = off) raised by mouse and key events (tasks 60, 62). | `initSim`: 0 |

`extern.h` additionally declares `OLD_D[8]`, `OLD_A[9]`, `OLD_SR` (`extern.h:34-36`) and `char *gettext()`
(`extern.h:47`). None of them is defined or used anywhere.

**The block `D, A, PC, SR, global_temp, OLD_PC, EA1, EA2, EV1, EV2, source, dest, result, inst` (`var.h:43-52`)
must stay contiguous and in this order.** `put()` and `value_of()` decide "register or memory?" by comparing a
pointer against `&D[0]` and `&inst` (section 1.7). The comment at `var.h:39-41` says so. HAZARD 11.2.

### 1.4 Other globals the core uses (defined outside `var.h`)

| Name | Defined | Type | Meaning |
|---|---|---|---|
| `trace_bit` | `RUN.CPP:30` | `bool` | Value of SR bit 15 sampled **before** the current instruction ran; cleared by `exceptionHandler`. |
| `offsets`, `inst_arr`, `names` | `OPCODES.H:31, 43-137, 148-160` | tables | Instruction decode (section 3.4). |
| `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc` | `hardwareu.cpp:28` | `int` | Addresses of the four hardware devices (defaults `0xE00000`, `0xE00010`, `0xE00012`, `0xE00014`, `SIM68Ku.cpp:1518-1521`). Accesses that start at one of these addresses bypass the memory map. |
| `ROMStart, ROMEnd, ReadStart, ReadEnd, ProtectedStart, ProtectedEnd, InvalidStart, InvalidEnd` | `hardwareu.cpp:32-33` | `int`, all 0 | Memory-map ranges (inclusive). |
| `ROMMap, ReadMap, ProtectedMap, InvalidMap` | `hardwareu.cpp:34` | `bool`, all false | Memory-map enables. |
| `hardwareEnabled`, `autoIRQ` | `hardwareu.cpp:30-31` | `bool` | Hardware accepts interrupts / auto-interrupt timers armed. |
| `disableKeyCommands` | `SIM68Ku.cpp:32` | `bool` | Set by TRAP #15 task 24. |
| `clRun` | `SIM68Ku.cpp:31` | `bool` | Command line asked for `/r`. |
| `startPC` | `SIM68Ku.h:276` (member of `TForm1`) | `int` | Start address remembered for Rewind. |
| `move_bw_times[12][9]`, `move_l_times[12][9]`, `movem_t_r_times[11]`, `mover_t_m_times[11]` | `CODE1.CPP:26-63` | `int` tables | MOVE and MOVEM cycle times. |
| `Prntr`, `printing`, `pageRowHeight`, `pageColWidth`, `pageTop`, `pageBot`, `pageLeft`, `pageRight`, `pageX`, `pageY` | `CODE9.CPP:35-44` | printer state | TRAP #15 task 10. |
| `exec_inst` statics `start, finish, exec_result, i, intMask` (`int`) and `temp` (`long`) | `RUN.CPP:748-749` | function-static | `exec_result` **persists between calls** and is part of the double-fault logic. |
| `runLoop` static `running` | `SIM68Ku.cpp:251` | `bool` | Re-entrancy guard. |
| `IRQprocess` static `intMask` | `hardwareu.cpp:759` | `int` | - |

`UTILS.CPP:26-29` declares `extern int ROMStart, ROMEnd, ReadStart, ReadEnd; ...`. `SIMOPS2.CPP:21` declares
`extern int ROMStart, ROMEnd, ReadOnlyStart, ReadOnlyEnd;` - the names `ReadOnlyStart`/`ReadOnlyEnd` do not exist
anywhere and are never used; drop the declaration.

### 1.5 How 68000 memory is stored

- One block of `MEMSIZE = 0x01000000` (16,777,216) bytes: `memory = new char[MEMSIZE];` in the main form's
  constructor (`SIM68Ku.cpp:152-155`). Every byte is set to `0xFF` there, and again at the start of every
  program load (`SIM68Ku.cpp:277-278`). It is freed in the destructor (`SIM68Ku.cpp:183-184`). If allocation
  fails the original shows `Error reserving main 68000 memory in Form1::FormCreate` and exits (`SIM68Ku.cpp:157-158`).
- The element type is plain `char`, which is **signed** in the original. Code that compares a memory byte without
  masking depends on that (for example the log's printable test `memory[...] >= ' '`, `RUN.CPP:805`).
- Byte order inside the array is the 68000's (big-endian): index = 68000 address, the most significant byte of a
  word or long is at the lower index. `mem_req` and `mem_put` assemble and split values byte by byte
  (`UTILS.CPP:379-392, 484-493`), so they do not depend on host byte order.
- Every address is reduced with `& ADDRMASK` (24 bits) before the array is indexed (`UTILS.CPP:369, 445`). Address
  `$FF001000` is the same cell as `$00001000`. There is no "outside memory" bus error (section 5).
- **Out-of-bounds by up to 3 bytes.** A long access at `$FFFFFE` reads or writes `memory[0x1000000]` and
  `memory[0x1000001]`, two bytes past the allocation (`UTILS.CPP:388-391, 490-491`); nothing prevents it. HAZARD 11.4.

**Host-endian and pointer tricks** (all work on little-endian ILP32 hosts only, which wasm32 is):

1. *Pointers as addresses.* `EA1`/`EA2` for a memory operand are `(long *)&memory[addr & ADDRMASK]`
   (`RUN.CPP:146-149` and the other modes). The 68000 address is recovered as `(int)EA1 - (int)&memory[0]`
   (`UTILS.CPP:586, 618`, `CODE1.CPP:276`, `CODE2.CPP:68, 106`, `CODE7.CPP:347`, `CODE8.CPP:165, 208`).
2. *Dereferencing a memory pointer as a host `long`.* `BIT_OP` uses `*EA1` (`CODE7.CPP:268, 270, 274, 281`) and
   `TAS` uses `*EA1` (`CODE7.CPP:303`) even when `EA1` points into `memory[]`. This reads four bytes at the 68000
   address as a little-endian host integer; only the low 8 bits are used afterwards, and on a little-endian host
   those are the byte at the operand address. The read is unaligned and, at `$FFFFFD`-`$FFFFFF`, runs past the end.
3. *Writing parts of a register through a narrower pointer.* The TRAP dispatcher passes `(short *)&D[0]`,
   `(char *)&D[1]`, `(uchar *)&D[1]`, `(short *)&D[1]`, `(unsigned int *)&D[2]`, `(int *)&D[0]` to I/O routines
   (for example `CODE9.CPP:762, 803, 877, 964, 988, 1020, 1254`). On a little-endian host the pointed-to byte or
   word is the low byte or low word of the register; the rest of the register is preserved.
4. *`put((long *)&SR, ...)`* (`CODE1.CPP:226, 244`) reads and rewrites four bytes starting at the 16-bit `SR`.
   The two bytes after `SR` are written back unchanged, so this is harmless as long as two readable and writable
   bytes follow `SR`.
5. *`sscanf(bufptr, "%2x", &s_byte)`* with `char s_byte[4]` in the S-record loader (`SIMOPS2.CPP:245, 346`) stores an
   `unsigned int` into four chars and then uses `s_byte[0]` as the value: little-endian only.
6. *`mem_request(&PC, WORD_MASK, (long *)&inst)`* (`RUN.CPP:761`) writes a `long` into the `int inst`: needs
   `sizeof(long) == sizeof(int)`.

### 1.6 How registers, SR, the stack pointers and the PC are represented

- `D[0..7]` and `A[0..8]` are host `long` (signed 32-bit). Byte and word operations on a register go through
  `put()`, which keeps the untouched upper bits: `*dest = (source & size) | (*dest & ~size);` (`UTILS.CPP:584`).
- **Two stack pointers:** `A[7]` is always the user stack pointer and `A[8]` always the supervisor stack pointer.
  The active A7 is `A[a_reg(7)]`, where
  ```cpp
  int a_reg (int reg_num) { if ((reg_num == 7) && (SR & sbit)) return 8; else return reg_num; }   // UTILS.CPP:229-237
  ```
  Handlers call `a_reg()` each time they index `A[]` with a register number taken from the opcode. Places that
  do **not** call it are listed as quirks in 3.16 (`LINK`, `UNLK`, register breakpoints on A7).
- `SR` is a host `short`. All 16 bits are stored; nothing masks the unimplemented bits (5-7, 11, 12, 14), so
  `MOVE to CCR`, `MOVE to SR`, `RTE`, `RTR`, `ORI/EORI to CCR` can set them and they stay set (QUIRK).
- `PC` is a host `long` and is never masked on assignment. Branches, RTS and RTE can leave any 32-bit value in it;
  the memory functions mask it when fetching. `JMP`/`JSR` targets and `LEA`/`PEA` results are 24-bit because they
  are derived from a masked pointer (3.16).
- `cycles` is an unsigned 64-bit counter. The on-screen display prints it with `"%u"` (`STARTSIM.CPP:155`), which
  on Win32 shows only the low 32 bits (QUIRK), and shows the text `Overflow` when `cycles > 0xFFFFFFFFFFFF`
  (`STARTSIM.CPP:152-153`).

### 1.7 The effective-address pointer convention: `put()` and `value_of()`

```cpp
void put (long *dest, long source, long size)                       // UTILS.CPP:574-587
{
  if ( ( (int)dest >= (int)&D[0] ) && ( (int)dest < (int)&inst ) )   // if dest is register
    *dest = (source & size) | (*dest & ~size);
  else                                                              // else dest is memory
    mem_put (source, (int) ((int)dest - (int)&memory[0]), size);
}
void value_of (long *EA, long *EV, long size)                       // UTILS.CPP:606-619
{
  if ( ( (int)EA >= (int)&D[0] ) && ( (int)EA < (int)&inst ) )
    *EV = *EA & size;
  else
    mem_req ( (int) ((int)EA - (int)&memory[0]), size, EV);
}
```

- "Register" means any address inside the global block `D .. result` (section 1.3). That is how `put(&result, ...)`
  (CMP family), `put((long *)&SR, ...)` and an immediate operand held in `global_temp` are treated as plain host
  variables.
- Everything else is treated as a pointer into `memory[]` and converted back to a 68000 address by pointer
  subtraction. `put()` returns `void`: **the result of `mem_put` (address error, bus error) is discarded by every
  caller of `put()`** (section 3.7).
- Several handlers build the pointer **without** masking the address: `&memory[A[Rx]]` in `ADDX`, `SUBX`, `ABCD`,
  `SBCD` (`CODE3.CPP:222, 442`, `CODE5.CPP:69, 129`) and `&memory[A[a_reg(7)]]` in `PEA`, `LINK`, `BSR`, `JSR`
  (`CODE2.CPP:110, 147`, `CODE8.CPP:141, 200`). With 32-bit wrap-around the subtraction still returns the original
  register value, and `mem_put` then masks it. Two consequences: (a) the unmasked 32-bit address is what
  `mem_put` tests for oddness and reports in an address-error frame; (b) in the original, a register value that
  makes `memory + value` land inside the global register block would be written as a host variable instead of
  68000 memory. Case (b) depends on where Windows placed the heap block and cannot be reproduced; the port must
  simply never take that branch for these call sites (HAZARD 11.2).

### 1.8 Call structure

```
TForm1::RunExecute / StepExecute            (GUI commands, SIM68Ku.cpp)
  -> TForm1::runLoop()                      while (runMode) { runprog(); Application->ProcessMessages(); }
TForm1::TraceExecute / AutoTraceTimerTimer  -> runprog()            (one call, no loop)
THardware::IRQprocess (button, timer, key, mouse)  -> TForm1::runLoop()
runprog()                                   one instruction + stop checks        RUN.CPP:638
  -> exec_inst()                            fetch, decode, execute, exceptions   RUN.CPP:746
       -> mem_request()  -> mem_req()       fetch
       -> (*names[i])()                     instruction handler in CODE1..CODE9
            -> eff_addr / eff_addr_noread   operand decode                      RUN.CPP:85, 404
            -> mem_req / mem_put / put / value_of / cc_update / inc_cyc         UTILS.CPP
            -> TRAP() -> simIO->..., Hardware->..., file functions             CODE9.CPP:723
       -> exceptionHandler(), irqHandler()  stack frames                         RUN.CPP:1038, 1083
  -> bpExpressions[i].isBreak() -> breakPoints[n].isBreak() -> value_of()      BPointExpr.cpp:97, BPoint.cpp:112
  -> scrshow()                              when stopping                        STARTSIM.CPP:130
```

### 1.9 Prototypes without a live definition, and the dead files

`PROTO.H` declares these functions that are **not defined** in any compiled unit: `at`, `chk_buf`, `gethelp`, `home`,
`parse`, `show_topics`, `iswhite`, `cmderr`, `setdis`, `mdis`, `selbp`, `dbpoint`, `memread`, `memwrite`, `alter`,
`hex_to_dec`, `dec_to_hex`, `intmod`, `portmod`, `pcmod`, `changemem`, `mmod`, `regmod`, `clear`, `getText`, `same`,
`eval`, `eval2`, `getval`, `strcopy`, `mkfname`, `pchange`, `reg_put`, `windowLine`, `scrollWindow`, `scan`,
`save_cursor`, `restore_cursor`, `finishSim`, `errmess`, `startSim`, `DFcommand` (`PROTO.H:91-123, 137-145, 156,
165-174`; `reg_put` is defined nowhere at all, the others only in the dead files or not at all). `to_2s_comp` and both
`flip` overloads are defined (`UTILS.CPP:42, 873, 879`) but never called. `BIT_FIELD` is declared only in
`OPCODES.H:26`, not in `PROTO.H`.

Dead files, for the record only:
- `SIMOPS1.CPP`: `mdis()` (memory dump to stdout), `memread(loc, MASK)` (reads `memory[loc & ADDRMASK] & MASK`, with
  an MC6850 model at `$1000/$1001` using `port1[]`), `memwrite(loc, value)` (writes 1, 2 or 4 bytes depending on the
  magnitude of `value`).
- `SCAN.CPP`: `scan(str, ptrbuf, maxcnt)` splits a command line into words (`;` starts a comment, single quotes
  protect spaces); `iswhite(c, qflag)`.
- `STRUTILS.CPP`: `getText`, `getval`, `pchange` (prompt on `cin`), `same` (case-insensitive prefix compare),
  `eval`/`eval2` (number parser: `$` hex, `.` decimal, `@` octal, `'`/`"` character, `%` binary, default hex),
  `strcopy`, `mkfname`.

### 1.10 Licence notices found inside the scope files

Relevant because the port compiles these files and is to be published.
- `CODE4.CPP:21-40`: `getDivu68kCycles` / `getDivs68kCycles` are "Copyright (c) 2005 by Jorge Cwik", GNU General
  Public License "either version 2 of the License, or (at your option) any later version".
- `CODE7.CPP:128` ("Incorporated code from the UAE emulator", ROXL/ROXR) and `CODE7.CPP:314-315` (`BIT_FIELD` "is
  patterned after the 68020 simulator code used in the UAE (Unix Amiga Emulator)"). UAE is GPL software.
- The simulator's own files carry only author credits (Charles Kelly; some headers of the older core say
  "Modified by"); the project file states `LegalCopyright=GNU general public use license` (`SIM68K.BPR:110`) with no
  version number. `ground-truth.md` section 3.1 quotes the distribution's readme to the same effect.

---

## 2. Program loading and reset

### 2.1 Start-up state

1. `TForm1::TForm1` (`SIM68Ku.cpp:122-175`): `runMode = false`; allocate `memory` and fill it with `0xFF`.
2. `TForm1::FormShow` (`SIM68Ku.cpp:1203-1239`): `LoadSettings()` (which first calls `defaultSettings()`:
   `exceptions = false; bitfield = false; simhalt_on = true; ElogFlag = OlogFlag = 0; logging = false`,
   `SIM68Ku.cpp:1492-1497`, then overrides from `sim68K.dat`), then `initSim()`.
3. Command line: if argument 1 is an existing file with extension `.S68` it is loaded with `OpenFile`. Arguments
   2..n, case-insensitive: `/r` run after start, `/f` full screen, `/e` `exceptions = true`, `/b` `bitfield = true`
   (`SIM68Ku.cpp:1212-1238`).

At this point `PC` is 0 (static initialisation), `SR = 0x2000`, `A[7] = 0x00FF0000`, `A[8] = 0x01000000`, all other
registers 0, `cycles = 0`, memory all `0xFF`.

### 2.2 `initSim()` - simulator reset (`STARTSIM.CPP:33-127`), in source order

1. Auto-trace timer off; `autoTraceInProgress = false`.
2. I/O window: clear, `setWindowSize(0,0)`, drawing mode 4 then 16 (double buffering off), pen width 1, line colour
   white, fill colour black, fonts re-applied (I/O specification).
3. `inputMode = false; pendingKey = 0; runMode = false;`
4. `lbuf[0] = '\0'; wordptr[0] = lbuf;`
5. `for (i = 0; i <= 7; i++) A[i] = D[i] = 0;`
6. `cycles = 0; SR = 0x2000; A[7] = 0x00FF0000; A[8] = 0x01000000;`
7. `OLD_PC = -1;` ("set different from 'PC'").
8. `trace = sstep = false; stopInstruction = false; stepToAddr = 0; runToAddr = 0;`
9. `scrshow();` (register display refreshed - this also refreshes the *displayed SR*, section 5.4).
10. `keyboardEcho = true; inputPrompt = true; inputLFdisplay = true;`
11. `files[i].fp = NULL` for all 8 entries. The files are **not** closed (leak; QUIRK).
12. `irq = 0; Hardware->autoIRQoff(); hardReset = false;`
13. `Form1->setMenuActive(); Hardware->enable();` - `enable()` calls `autoIRQon()` and sets `hardwareEnabled = true`
    (`hardwareu.cpp:923-935`).
14. `FullScreenMonitor = 0;`
15. All mouse state and the five `...IRQ` levels to 0 / false.
16. `simIO->ResetSounds(); Form1->restoreMenuTask19(); netCloseSockets();`

**Not** changed by `initSim`: `PC`, `memory[]`, `exceptions`, `bitfield`, `simhalt_on`, the memory map, the
hardware addresses, all breakpoints and `bpCountCond[]`, `halt`, `errflg`, the static `exec_result`, `trace_bit`,
`logging` and the log files, `startPC`.

### 2.3 `TForm1::OpenFile(name)` - load a program (`SIM68Ku.cpp:270-363`), in source order

1. `initSim();`
2. `for (int i=0; i<MEMSIZE; i++) memory[i] = 0xFF;`
3. `memory[StrToInt("0x" + Hardware->switchAddr->EditText)] = 0x00;` - the toggle-switch byte is cleared.
4. `Hardware->initialize();` (all switches off, the seven auto-interrupt check boxes cleared, `autoIRQoff()`,
   `hardwareu.cpp:44-63`).
5. `simhalt_on = true;`
6. Message area and listing are cleared.
7. `if (loadSrec(name.c_str()) == false)` - that is, when `loadSrec` returned `SUCCESS` (0). **`loadSrec` returns
   0 even when the file had errors**; it returns `FAILURE` only when the file could not be opened or a C++
   exception occurred (2.4). Inside the `if`:
   1. `startPC = PC;` (the S7/S8/S9 address, or the unchanged previous PC if the file had no such record).
   2. Reload is enabled.
   3. Listing: `str = ChangeFileExt(name, ".L68")`. If that file exists, it is loaded line by line into the list
      box and the start address is taken from it (2.5); the lines are scanned for `*[sim68k]` directives (2.6).
      Otherwise `regPC->Text = "%08lX" of PC`, the message `Unable to open .L68 file.` is added and the listing
      shows nine fixed lines of explanation (`SIM68Ku.cpp:339-351`).
   4. Window caption = file name; breakpoint and memory windows repainted.
8. Any C++ exception inside steps 6-7: message `Unexpected error in OpenFile`, return (`SIM68Ku.cpp:359-362`).

Callers and what they add:

| Command | Code | Extra behaviour |
|---|---|---|
| File > Open (Ctrl+O) | `OpenExecute`, `SIM68Ku.cpp:368-375` | `BreaksFrm->cbpoint(-1)` (all simple breakpoints cleared) is executed **before** the file dialog, even if the dialog is then cancelled. After `OpenFile`: `Log->setLogFileNames(name)`. |
| Reload (Ctrl+F3) | `ReloadExecute`, `SIM68Ku.cpp:1366-1370` | `OpenFile(OpenDialog1->FileName)` then `Log->addMessage("\n***** Reload Program Pressed *****\n")`. Simple breakpoints are kept. |
| Drag and drop | `WmDropFiles`, `SIM68Ku.cpp:396-422` | Confirmation box if a program is loaded; only an existing `.S68`. |
| Command line | `FormShow` | see 2.1. |
| File > Open Data | `OpenDataExecute`, `SIM68Ku.cpp:379-389` | Calls **only** `loadSrec`: no reset, no memory clear, no listing. If the data file has an S7/S8/S9 record, the variable `PC` changes but the PC text box does not, and the next Run/Step/Trace reloads `PC` from the text box (3.1), so the change is lost. |

Not changed by `OpenFile`: the memory-map ranges and enables (an S0 record can switch a range **on**; nothing
switches one off - `SIMOPS2.CPP:260-261` "Does not erase existing map if no map specified"), `exceptions`,
`bitfield` (only ever set to true by a listing directive), advanced breakpoints, hardware addresses.

### 2.4 The S-record loader: `int loadSrec(char *name)` (`SIMOPS2.CPP:203-379`)

File access: `fopen(name, "rt")` - **text mode**; on Windows CR LF becomes LF and Ctrl-Z ends the file. Lines are
read with `fgets(lbuf, SREC_MAX, fp)` where `SREC_MAX = 515`; a longer line is split silently.

Per line (`line` counts from 1):

1. `bufptr = lbuf; checksum = 0; skipRecord = false;` `checksum` is `uchar` (arithmetic modulo 256).
2. `sscanf(lbuf, "S%c%2x", &s_type, &bytecount); bufptr += 4; checksum += bytecount;`
   The return value is not checked. If the line does not start with `S` (blank line, garbage), `s_type` and
   `bytecount` **keep their values from the previous line** and the line is processed as that type, reading
   whatever is in `lbuf` beyond the new, shorter text (QUIRK; only reachable with malformed files).
3. `switch (s_type)`:

| Type | Action |
|---|---|
| `'0'` | Header. `skipRecord = true`. Address: `sscanf(bufptr, "%04x", &loc)`; failure sets `sRecError`; success `bufptr += 4`. Then the data bytes are decoded into the string `str = "S0 = "` + one character per byte (bytes `' '..'~'` as themselves, others as `.`); the last byte (the checksum byte) is added to `checksum` but not to the string. `checksum = ~checksum & 0xFF;` if non-zero the message `Checksum error on line %d...` is added. **The address bytes are not included in the S0 checksum** (harmless because the address is `0000`). The string is then added to the message area. Memory-map handling below. |
| `'1'` | `sscanf(bufptr, "%04x", &loc)`, `bufptr += 4` (2-byte address). |
| `'2'` | `sscanf(bufptr, "%06x", &loc)`, `bufptr += 6` (3-byte address). |
| `'3'` | `sscanf(bufptr, "%08x", &loc)`, `bufptr += 8` (4-byte address). |
| `'5'` | Record count: `skipRecord = true`, ignored entirely (no checksum test). |
| `'7'` | `sscanf(bufptr, "%08x", &loc)`; on success `PC = loc; end__of__file = true;` |
| `'8'` | `sscanf(bufptr, "%06x", &loc)`; on success `PC = loc; end__of__file = true;` |
| `'9'` | `sscanf(bufptr, "%04x", &loc)`; on success `PC = loc; end__of__file = true;` |
| anything else | `sRecError = true` (this includes S4, S6 and, on the first line, a non-S line because `s_type` starts as 0). |

   A failed address `sscanf` in types 1, 2, 3, 7, 8, 9 sets `sRecError = true`.

4. `if (end__of__file) break; if (sRecError) break;` - loading stops at the first S7/S8/S9 record; **its checksum
   is never verified** and nothing after it is read.
5. For data records (S1, S2, S3):
   ```cpp
   checksum += loc&0xFF;  checksum += (loc&0xFF00)>>8;  checksum += (loc&0xFF0000)>>16;  checksum += (loc&0xFF000000)>>24;
   for (bufend = bufptr; *bufend != '\0'; bufend++);            // bufend = end of line (after '\n')
   while (sscanf(bufptr,"%02x",&s_byte)) {
     bufptr += 2;
     checksum += s_byte[0];
     if ((bufptr + 2) >= bufend) break;                         // that was the checksum byte
     if ((loc < 0) || (loc > (MEMSIZE - 1))) {
       Form1->Message->Lines->Add(str.sprintf("Invalid Address on line %d...",line));
       sRecError = true;  break;
     }
     else
       memory[loc++ & ADDRMASK] = s_byte[0];
   }
   checksum = ~checksum &0xFF;
   if(checksum) Form1->Message->Lines->Add(str.sprintf("Checksum error on line %d...",line));
   if (sRecError) break;
   ```
   - The byte count field is **not used** to decide how many bytes to load; the loader loads every hex pair up to,
     but not including, the last pair before the end of the line.
   - "Last pair" is detected by `(bufptr + 2) >= bufend`: after consuming a pair, at most 2 characters remain. With
     a line ending of `"\n"` (1 character) or `"\r\n"` (2 characters) this is the checksum pair. **If the final line
     has no line terminator at all, the last data byte is taken for the checksum, is not stored, and a checksum
     error is reported.** (HAZARD 11.8: the port has no text-mode translation, so `"\r\n"` reaches this code; the
     arithmetic above shows it still works.)
   - A checksum error is **only a message**: the bytes are already in memory and loading continues.
   - Bytes are written straight into `memory[]`: no memory-map check, no breakpoint flags, no hardware refresh.
   - The address test is made **per byte, on the running `loc`**, after the byte has been added to the checksum:
     `(loc < 0) || (loc > (MEMSIZE - 1))` (the second comparison is unsigned, so only `0`..`$FFFFFF` passes). It
     fails for an S3 record whose address has a non-zero top byte, and also for **any** record (S1, S2 or S3)
     whose data runs past `$FFFFFF` - the bytes below the limit have already been stored by then. The messages
     are, in order: `Invalid Address on line %d...`; then `Checksum error on line %d...` (the loop was left
     before the rest of the record was summed, so the checksum is wrong unless by coincidence); then the three
     lines of step 6. Loading stops.
   - `sscanf` returns `EOF` (-1, which is "true") at the end of the string, so the loop relies on the `bufend`
     test to terminate; it terminates with 0 only on a non-hex character.

6. After the loop:
   - If `sRecError`: three messages - `Invalid data on line %d of .S68 file...`, `%d: %s` (line number and the raw
     line, including its newline), `Remainder of load stopped...`.
   - Otherwise: `.S68 file read successful`.
   - `fclose(fp); return SUCCESS;` in **both** cases.
7. Other exits: file cannot be opened: message `error: cannot open file %s`, `return FAILURE`. Any C++ exception:
   message `Unexpected Error reading .S68 file`, `return FAILURE` (the file is left open).

**Memory map in S0 records** (`SIMOPS2.CPP:258-280`). The first S0 record whose decoded string equals exactly
`S0 = 68KPROG   20CREATED BY EASY68K` sets the local flag `EASy68Kv2_0_SRecord`. Every *later* S0 record in the
same file is then examined: characters 6-14 of the string (1-based) select the range, characters 16-21 are the
start and 23-28 the end, each six hex digits (the layout is `S0 = ` + 9-character keyword + space + `ssssss` + `,`
+ `eeeeee`):

| Keyword (exactly 9 characters) | Effect |
|---|---|
| `"      ROM"` | `Hardware->ROMChk->Checked = true; ROMStartEdit = start; ROMEndEdit = end` |
| `"     READ"` | Read-only range, same pattern |
| `"PROTECTED"` | Protected range |
| `"  INVALID"` | Invalid range |

Setting the check box and edit fields fires their handlers, which set `ROMMap = true`, `ROMStart`, `ROMEnd` and
so on (`hardwareu.cpp:1395-1464`). The assembler writes these S0 records after the data records and before the
S8 record (`reference\src-edit68k\Edit68Kv5.16.1\OBJECT.CPP:324-343`). See `hardware.md` section 4.2.

Messages produced by the loader (exact texts): `error: cannot open file %s` / `Checksum error on line %d...` /
`S0 = <text>` / `Invalid Address on line %d...` / `Invalid data on line %d of .S68 file...` / `%d: %s` /
`Remainder of load stopped...` / `.S68 file read successful` / `Unexpected Error reading .S68 file`.

### 2.5 How the start address is set

1. `loadSrec` assigns `PC` from the S7 (32-bit), S8 (24-bit) or S9 (16-bit) record. The EASy68K assembler always
   writes S8 (`OBJECT.CPP:346`). `OpenFile` copies it to `startPC`.
2. If the `.L68` exists (`SIM68Ku.cpp:303-308`):
   ```cpp
   str = ListBox1->Items->Strings[0];
   str = str.SubString(1,8);
   if (str >= "00000000" && str < "01000000")  regPC->EditText = str;
   startPC = PC = StrToInt("0x" + regPC->EditText);
   ```
   The first line of an EASy68K listing is `XXXXXXXX Starting Address` (written as `00000000 Starting Address`
   and patched with `%08lX` of the start address at the end of assembly,
   `reference\src-edit68k\Edit68Kv5.16.1\LISTING.CPP:107, 280-281`). So **when a listing exists, the listing's first
   8 characters override the S-record start address.** If those 8 characters do not compare inside the range,
   the PC text box is left as it was - and it still shows the PC from *before* the load, because `loadSrec` does
   not refresh it - so `PC` and `startPC` become that stale value (QUIRK).
3. If there is no `.L68`, `PC` stays at the S-record value and the text box is set from it.
4. A file with no S7/S8/S9 record and no listing leaves `PC` unchanged from before the load.
5. An `.L68` that exists but has no lines makes `Strings[0]` throw: the load ends with `Unexpected error in
   OpenFile` (2.3 step 8). `PC` and `startPC` then hold the S-record value, but the PC text box still shows the
   PC from before the load, and the next Run, Step or Trace loads `PC` from that box (3.1).

For the port this means the value "PC as displayed before the load" must be kept: it is the value `PC` had when
`OpenFile` called `initSim()` (whose `scrshow()` wrote the box), and cases 2 and 5 fall back to it (10.3).

### 2.6 Listing directives processed at load (`SIM68Ku.cpp:310-337`)

For every listing line `i` (0-based), the line is lower-cased and the text starting at **column 41** is tested.
Column 41 is where the source text begins: a listing line is `%-32.32s` (address and object code), `%6d` (line
number), two spaces, then the source line (`LISTING.CPP:124-153`).

| Text at column 41 (prefix match, case-insensitive) | Effect |
|---|---|
| `*[sim68k]break` (14 chars) | Take line `i+1`. If `i+1 > 2` and `isInstruction(line i+1)`: `BreaksFrm->sbpoint(address of that line)` - a simple PC breakpoint. If the next line is not an instruction line nothing is set. If the directive is the last line, `Strings[i+1]` throws and the load ends with `Unexpected error in OpenFile`. |
| `*[sim68k]bitfield` (17 chars) | `bitfield = true` and the menu item is checked. The assembler emits this line for `OPT BIT` (`DIRECTIV.CPP:620-624`). It is **never cleared** by loading another program, and it is written to `sim68K.dat` at the next settings save. |
| `*[sim68k]simhalt_off` (20 chars) | `simhalt_on = false`. Not persisted; reset to true by the next `OpenFile`. |

### 2.7 The reset variants compared

| Action | Registers | PC | Memory | Other |
|---|---|---|---|---|
| `initSim()` | D0-D7, A0-A6 = 0; USP = `$00FF0000`; SSP = `$01000000`; SR = `$2000`; cycles = 0 | unchanged | unchanged | see 2.2 |
| Rewind (Ctrl+F2), `RewindExecute`, `SIM68Ku.cpp:542-549` | as `initSim` | `PC = startPC` (assigned **before** `initSim()`, so the refreshed display shows it) | **unchanged** - data the program modified stays modified (QUIRK; the help says only "clears the 68000 registers") | auto-trace off; log gets `\n***** Reset Program Pressed *****\n`; `Hardware->enable()` re-arms any checked auto-interrupt timers (`hardware.md` 8) |
| Reload (Ctrl+F3) | as `initSim` | from file | refilled with `$FF`, then reloaded | see 2.3 |
| File > Close, `CloseExecute`, `SIM68Ku.cpp:426-437` | as `initSim` | unchanged | unchanged | listing cleared; simple breakpoints cleared |
| Hardware "Reset" button, `ResetBtnClick`, `hardwareu.cpp:778-792` | only if `hardwareEnabled`: `SR \|= sbit; SR &= ~tbit; SR \|= 0x700;` `mem_req(0x00, LONG_MASK, &A[8]);` | `mem_req(0x04, LONG_MASK, &PC);` | unchanged | `hardReset = true; inc_cyc(40); stopInstruction = false; scrshow(); IRQprocess(0);` - the last call adds 44 more cycles and, if `trace` is false, **starts or continues running** (3.10). `OLD_PC` is not updated (QUIRK, 3.5). |
| 68000 `RESET` instruction | none | none | none | 132 cycles; privileged (3.16) |

There is no power-on reset that loads SSP and PC from vectors 0 and 4 except the Hardware window's Reset button.

QUIRK (Rewind, File > Close): `initSim()` ends with `Hardware->enable()`, whose `autoIRQon()` re-enables the timer
of every auto-interrupt box that is still checked (`hardwareu.cpp:811-822`; only `OpenFile`'s
`Hardware->initialize()` clears the boxes). `initSim()` has also set `trace = false`, so the first tick of such
a timer goes through `IRQprocess` (3.10) and **starts the program running by itself** from the current `PC`
(`startPC` after a Rewind), with `OLD_PC` still `-1` (3.5). The same happens if the user clicks an IRQ button
after a load or Rewind instead of pressing Run.

### 2.8 The listing and how addresses are matched to listing lines

The listing is kept only as the text lines of a list box (`ListBox1->Items`); there is no address index. Lines
0-3 are the listing header (`Starting Address`, `Assembler used:`, `Created On:`, blank), which is why every
search starts at index 3.

**"Instruction line" test** (`isInstruction`, `SIM68Ku.cpp:856-864`):
```cpp
if (str.SubString(1,2) == "00" &&  str[11] != ' ' &&  str[9] != '=' &&  str[11] != '=')  return true;
```
Characters are 1-based: the line starts with `00` (an address below `$01000000`), column 11 (first object-code
character) is not blank, column 9 is not `=` (offset/equate marker) and column 11 is not `=`. Data lines (`DC`)
pass this test too.

**Current-instruction highlight** (`highlight`, `SIM68Ku.cpp:785-807`): for `i` from 3 to the last line, if the PC
text box (`"%08lX"` of `PC` as last displayed) equals the upper-cased first 8 characters of the line **and**
(`isInstruction(line)` **or** `halt`), then `ItemIndex = i`. The loop does not stop at the first match, so the
**last** matching line wins. If nothing matches the previous highlight stays. A PC above `$00FFFFFF` never matches.

**Other users of the same matching:** breakpoint dots (`breakPPaint`, `SIM68Ku.cpp:692-733`), toggling a breakpoint
by clicking (`breakPMouseDown`, `738-773`), Run To Cursor (`468-498`), double-click sets the PC text box
(`ListBox1DblClick`, `1322-1330`). The first three require `index > 2 && isInstruction(line)` and take the address
with `StrToInt("0x" + line.SubString(1,8))`; the double-click tests only `isInstruction(line)` (no index test) and
copies the first 8 characters into the PC box, where they take effect at the next `loadRegs()` (3.1). Details
are in `sim-ui.md` section 6.

**Execution-log lookup** (`lineToLog`, `SIM68Ku.cpp:869-909`) uses a *binary search* instead; it is described in
section 8.3.

---

## 3. The execution loop

### 3.1 Entry points that start or drive execution

Full user-interface detail is in `sim-ui.md` section 9. What the core needs:

| Command | Code | What it does before executing |
|---|---|---|
| Run (F9) | `RunExecute`, `SIM68Ku.cpp:441-455` | `setMenuTrace(); BreaksFrm->resetDebug();` (all `bpCountCond[] = 0`) `trace = false; sstep = false; loadRegs(); runMode = true; runModeSave = runMode;` I/O window to front; `Hardware->autoIRQon(); runLoop();` |
| Run To Cursor (Ctrl+F9) | `RunToCursorExecute`, `468-498` | If the selected listing line is an instruction line and its address is not already a simple breakpoint: `runToAddr = addr`. Then `RunExecute`. |
| Step Over (F8) | `StepExecute`, `501-512` | `setMenuTrace(); trace = true; sstep = true; stepToAddr = 0; loadRegs(); runMode = true; runModeSave = runMode; runLoop();` |
| Trace Into (F7) | `TraceExecute`, `515-522` | `setMenuTrace(); trace = true; sstep = false; loadRegs(); runprog();` - exactly one `runprog()` call; `runMode` is not set. |
| Auto Trace (F10) | `AutoTraceExecute`, `AutoTraceTimerTimer`, `1333-1350` | Enables a timer (default interval 200 ms, `SIM68Ku.dfm:2260-2263`). Each tick: `if (!inputMode) if (!autoTraceInProgress) { autoTraceInProgress = true; TraceExecute(); autoTraceInProgress = false; }` |
| Pause (F6) | `PauseExecute`, `525-539` | `trace = true; sstep = false; runMode = false; if (inputMode) { inputMode = false; simIO->erasePrompt(); } scrshow(); setMenuActive();` auto-trace timer off; `Hardware->autoIRQoff();` **Pause cancels a pending keyboard read**: the TRAP #15 that started it has already completed, so the program continues after it without input (QUIRK). |
| Interrupt request | `THardware::IRQprocess`, `hardwareu.cpp:757-775` | Section 3.10. Can start `runLoop()` on its own. |

`loadRegs()` (`SIM68Ku.cpp:990-1021`) copies the on-screen register text into the CPU state: `SR` from the 16
binary digits, `D[0..7]`, `A[0..6]`, then `A[a_reg(7)]` from the A7 box (using the SR just loaded), `A[8]` from the
SS box, and finally **`PC = OLD_PC = ` the PC box**. The US box is never read by `loadRegs()`. Because `scrshow()`
wrote those boxes from the same variables, `loadRegs()` is an identity operation unless the user edited a box -
**except that it always sets `OLD_PC = PC`**, which the PC-relative branch handlers rely on (3.5).

The two kinds of register box behave differently when the user types in them:
- **Address registers are written through at once.** A0-A6, A7, US and SS each have a key-up handler that
  stores the box into `A[]` immediately (`regA0KeyUp` .. `regA6KeyUp`, `regA7KeyUp`, `regUSKeyUp`, `regA8KeyUp`,
  `SIM68Ku.cpp:1093-1184`; wired as `OnKeyUp`, for example `SIM68Ku.dfm:422` SS, `442` A7, `582` A0, `795` US), also
  while a program is running. `regA7KeyUp` writes `A[8]` or `A[7]` according to the **displayed** S bit and
  mirrors the text into the SS or US box; `regUSKeyUp` and `regA8KeyUp` write `A[7]` / `A[8]` and mirror into the
  A7 box when that is the active stack.
- **D0-D7, SR and PC are only text until the next `loadRegs()`** (their boxes have only a key filter). An edit
  there reaches the CPU at the next Run, Step Over or Trace Into, and is lost if `scrshow()` refreshes the display
  first or if execution is resumed by an interrupt request or the Reset button, which do not call `loadRegs()`.
  The one immediate effect of typing in the SR box is on the Protected-range test, which reads that text (5.4);
  `regSRChange` (`SIM68Ku.cpp:1043-1052`) also re-displays A7 from `A[8]` or `A[7]`.

How Step Over works, end to end: the first instruction runs with `trace` true. If it is not `BSR`/`JSR`, `runprog`
step 10 stops the loop after it (same as Trace Into). If it is `BSR`/`JSR`, the handler sets `trace = false` and
`stepToAddr` = the return address (`CODE8.CPP:144-147, 203-206`); the loop then runs at full speed, without trace
messages or logging, until an instruction leaves `PC == stepToAddr` (step 8), which sets `trace` again. The test is
on the PC only, not on the stack depth, so a recursive routine stops at the first return to that address.
Breakpoints, halts and Pause still stop the run inside the subroutine. `TRAP` is not stepped over.

The command-line switch `/r` sets `clRun`; the first `FormActivate` then calls `RunExecute`
(`SIM68Ku.cpp:931-934`).

### 3.2 `TForm1::runLoop()` (`SIM68Ku.cpp:249-266`)

```cpp
static bool running = false;
if (running) return;                 // prevent nested calls
running = true;
try {
  while(runMode){
    runprog();                       // run next 68000 instruction
    Application->ProcessMessages();
  }
}
catch( ... ) { Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in runLoop")); }
running = false;
```

Windows messages are pumped after every instruction, here and once more inside `runprog`. Every GUI event
(Pause, Rewind, key presses, timers, the Hardware window's buttons) is therefore handled *between two
instructions*, at one of these two points, and may change any CPU state.

### 3.3 `runprog()` - one instruction plus the stop checks (`RUN.CPP:638-721`), in source order

1. `halt = false;`
2. `exec_inst();` (section 3.4).
3. Message pump and input wait:
   ```cpp
   do {
     Application->ProcessMessages();
     if(inputMode) Sleep(10);        // don't hog the CPU while waiting for input
   } while (inputMode && runMode);
   ```
   A TRAP #15 keyboard read (tasks 2, 4, 5, 18) normally only sets `inputMode = true` and returns; the instruction
   is complete. The loop then spins here until the I/O window's key handler has stored the input and cleared
   `inputMode` (`simIOu.cpp:1365`), or until `runMode` becomes false (Pause, Rewind). **If `runMode` is already
   false (Trace Into), the body runs once and execution falls through with the read still pending.**
   Exception - the one-key type-ahead: if `pendingKey` is non-zero, task 5 returns it at once without ever
   setting `inputMode` (`simIOu.cpp:1283-1293`), and tasks 2, 4 and 18 feed it to the key handler from inside the
   instruction (`simIOu.cpp:1317-1320`): it becomes the first typed character, or, if it is CR, completes the read
   immediately (D1 and memory are written before the TRAP handler returns, and `inputMode` is false again).
4. `if (errflg) { halt = true; ` message `Address or Bus error during exception processing. Execution halted` ` }`
5. Simple breakpoints: `for (i = 0; i < bpoints; i++) if (PC == brkpt[i])` -> message `break point at %04x` (the PC,
   lower-case hex, zero-padded to 4), `trace = true`, auto-trace timer off.
6. Run To Cursor: `if (PC == runToAddr) { trace = true; ` auto-trace timer off`; runToAddr = 0; }`
   **QUIRK:** `runToAddr` is 0 when no target is set and the test is unconditional, so **any instruction that
   leaves `PC == 0` stops the run silently** (no message).
7. Advanced breakpoints: `for (i = 0; i < exprCount; i++) if (bpExpressions[i].isBreak())` -> same message,
   `trace = true`, auto-trace timer off (section 7).
8. Step Over: `if (sstep) { if (PC == stepToAddr) { trace = true; stepToAddr = 0; } }`
9. `OLD_PC = PC;`
10. `if (trace || halt)`:
    - `runMode = false;`
    - `if (!stopInstruction) Hardware->autoIRQoff();`
    - if the I/O window is full screen on the main window's monitor: leave full screen;
    - `scrshow();`
    - `if (halt) Form1->setMenuTrace(); else Form1->setMenuActive();`
    - `if (trace) if (!inputMode) Form1->SetFocus();`
11. `return 0;`

Steps 4-10 run **after** the input wait of step 3. Breakpoint conditions therefore see the registers and memory
as they are once the input has been stored.

### 3.4 `exec_inst()` - fetch, decode, execute, exception processing (`RUN.CPP:746-1017`)

All locals are `static`: `start, finish, exec_result, i, intMask` (`int`) and `temp` (`long`).

1. `bpRead = false; bpWrite = false;`
2. (inside `try`) **Double-fault latch:** `if (exec_result == ADDR_ERROR || exec_result == BUS_ERROR) errflg = true;`
   - `exec_result` here is still the result of the *previous* call.
3. **Fetch:** `exec_result = mem_request (&PC, (long) WORD_MASK, (long *)&inst);`
   On success `inst` holds the opcode word and `PC` has advanced by 2. On failure (odd PC: address error; PC
   inside an Invalid range, or inside a Protected range while the displayed S bit is 0: bus error) the error has already been
   processed inside `mem_req` (3.7), `PC` is not advanced by the fetch, and **the rest of the function is
   skipped**.
4. **Decode:** `start = offsets[(inst & FIRST_FOUR) >> 12]; finish = offsets[((inst & FIRST_FOUR) >> 12) + 1] - 1;`
   then a linear search:
   ```cpp
   for (i = start; i <= finish || exec_result == BAD_INST; i++) {
     if( (exec_result == BAD_INST) || ((inst & ~inst_arr[i].mask) == inst_arr[i].val) ) {
        ... steps 5-9 ...
        break;
     }
     if(i == finish) exec_result = BAD_INST;
   }
   ```
   `inst_arr[]` (87 entries, section 3.16) is grouped by the top four opcode bits and `offsets[] = { 0, 15, 16, 18,
   20, 53, 57, 60, 61, 65, 68, 69, 73, 80, 83, 86, 87 }` gives the first entry of each group. An entry matches when
   the opcode with the entry's `mask` bits cleared equals `val`. **The first match in table order wins**, so the
   order of the entries is part of the behaviour (for example `SWAP` before `PEA`, `EXT` before `MOVEM`, `ILLEGAL`
   before `TAS`, `ORI_TO_CCR` before `ORI`).
   If no entry of the group matches, `exec_result` is set to `BAD_INST` and the loop body runs once more with
   `i == finish + 1`, **without calling a handler**. Only groups 0, 4 and 7 have unmatched opcodes: `$0E00-$0EFF`;
   in group 4: `$4100-$417F`, `$4300-$437F`, `$4500-$457F`, `$4700-$477F`, `$4900-$497F`, `$4B00-$4B7F`,
   `$4C00-$4C7F`, `$4D00-$4D7F`, `$4E00-$4E3F`, `$4E74`, `$4E78-$4E7F`, `$4F00-$4F7F`; and `$7100-$71FF` and the other
   odd-high-byte patterns of group 7 (`$73xx`, `$75xx`, ... `$7Fxx`). (Verified by enumerating all 65,536 opcodes
   against the table.)
5. **Trace output** (only `if (trace)`):
   - `mem_req (PC, (long) WORD_MASK, &temp);` - peeks at the word after the opcode. This is a real `mem_req`: it
     sets `readEA`/`bpRead` and can itself raise a bus error.
   - Message line: `"PC=%08X  Code=%04X  SIMHALT"` if `inst == 0xFFFF && temp == 0xFFFF` (regardless of
     `simhalt_on`), else `"PC=%08X  Code=%04X  %s"` with `PC-2`, `inst` and `inst_arr[i].name` (a 12-character,
     space-padded name such as `"MOVEL       "`). The line is added to the message area for **every** traced
     instruction. For an unmatched opcode `i` is `finish + 1`, so the name printed is that of the first entry
     of the *next* group: `MOVEB` for group 0, `DBCC` for group 4, `SBCD` for group 7 (QUIRK).
   - If `logging`: the execution-log records of section 8.
6. `trace_bit = (SR & tbit) ? true : false;` - sampled **before** the instruction executes.
7. **Execute:** `if (exec_result != BAD_INST) exec_result = (*(names[i]))();`
8. `if (errflg && (exec_result != ADDR_ERROR && exec_result != BUS_ERROR)) errflg = false;`
9. **Exception processing**, two completely different paths:

   **(a) `exceptions` true** (`RUN.CPP:862-932`), in this order:
   1. `OLD_PC = PC;`
   2. `switch (exec_result)`:
      `BAD_INST`: `inc_cyc(34); OLD_PC -= 2; mem_req(0x10, LONG_MASK, &PC); exceptionHandler(1, 0, READ);`
      `NO_PRIVILEGE`: `inc_cyc(34); mem_req(0x20, LONG_MASK, &PC); exceptionHandler(1, 0, READ);`
   3. Interrupts: `intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40; if (irq & intMask) irqHandler();` (3.10)
   4. Trace: `if (trace_bit) { inc_cyc(34); mem_req(0x24, LONG_MASK, &PC); exceptionHandler(2, 0, READ); OLD_PC = PC; }`
   5. `switch (exec_result)`:

      | Code | Action |
      |---|---|
      | `SUCCESS` | nothing |
      | `STOP_TRAP` | auto-trace timer off; `halt = true;` and, only `if (stopInstruction == false)`: `stopInstruction = true;` message `STOP instruction. Execution halted`; focus main window; `scrshow();` |
      | `TRAP_TRAP` | `inc_cyc(38); mem_req(128 + (inst & 0x0f) * 4, LONG_MASK, &PC); exceptionHandler(2, 0, READ);` |
      | `DIV_BY_ZERO` | `inc_cyc(42); mem_req(0x14, ...); exceptionHandler(2, 0, READ);` |
      | `CHK_EXCEPTION` | `inc_cyc(44); mem_req(0x18, ...); exceptionHandler(2, 0, READ);` |
      | `TRAPV_TRAP` | `inc_cyc(34); mem_req(0x1C, ...); exceptionHandler(2, 0, READ);` |
      | `TRACE_EXCEPTION` | `inc_cyc(34); mem_req(0x24, ...); exceptionHandler(2, 0, READ);` |
      | `LINE_1010` | `inc_cyc(34); mem_req(0x28, ...); exceptionHandler(2, 0, READ);` |
      | `LINE_1111` | `inc_cyc(34); mem_req(0x2C, ...); exceptionHandler(2, 0, READ);` |
      | `ADDR_ERROR`, `BUS_ERROR` | no case: the frame was already built inside `mem_req`/`mem_put`/`memoryMapCheck` |

   **(b) `exceptions` false** (`RUN.CPP:933-1000`): `switch (exec_result)` - every non-success code sets
   `halt = true` and adds a message (`%4x` is `OLD_PC`, the address of the instruction, printed in lower-case hex
   with minimum width 4, space-padded):

      | Code | Message (exact) | Also |
      |---|---|---|
      | `BAD_INST` | `Illegal instruction found at location %4x. Execution halted` | |
      | `NO_PRIVILEGE` | `supervisor privilege violation at location %4x. Execution halted` | |
      | `CHK_EXCEPTION` | `CHK exception occurred at location %4x. Execution halted` | |
      | `STOP_TRAP` | `STOP instruction executed at location %4x. Execution halted` | auto-trace timer off; `Log->stopLogWithAnnounce();` focus main window; `scrshow(); Hardware->disable();` |
      | `TRAP_TRAP` | `TRAP exception occurred at location %4x. Execution halted` | |
      | `TRAPV_TRAP` | `TRAPV exception occurred at location %4x. Execution halted` | |
      | `DIV_BY_ZERO` | `Divide by zero occurred at location %4x. Execution halted` | |
      | `ADDR_ERROR` | `Execution halted` | (the detailed line was already printed by `mem_req`/`mem_put`) |
      | `BUS_ERROR` | `Execution halted` | |
      | `TRACE_EXCEPTION` | `Trace exception occurred at location %4x. Execution halted` | |
      | `LINE_1010` | `Line 1010 Emulator exception occurred at location %4x. Execution halted` | |
      | `LINE_1111` | `Line 1111 Emulator exception occurred at location %4x. Execution halted` | |
      | any other | `Unknown execution error %4x occurred at location %4x. Execution halted` (`exec_result`, `OLD_PC`) | |

   Then, still in path (b): `if (SR & tbit) { halt = true; ` message `TRACE exception occurred at location %4x.
   Execution halted` ` }` - tested on the SR **after** the instruction, so the instruction that sets the T bit
   halts immediately.
   With exceptions disabled no vector is ever read and pending interrupts are never serviced (the bits stay in
   `irq`).
10. `catch( ... )` around steps 2-9 (`RUN.CPP:1008-1014`): auto-trace timer off; modal message box titled `Error`
    with text `"ERROR: An exception occurred in routine 'exec_inst'.\nPC=%08X  Code=%04X"` (`PC-2`, `inst`);
    `trace = true; sstep = false;`. In the original this catches VCL exceptions thrown by GUI calls made from
    inside an instruction and (UNVERIFIED, Borland runtime behaviour) hardware faults such as access violations
    and stack overflow.
11. `return 0;`

### 3.5 `OLD_PC`: who sets it and who reads it

Readers: `BCC`, `BRA`, `BSR`, `DBCC` compute the target as `PC = OLD_PC + displacement + 2` (`CODE8.CPP:40, 73, 119,
149`), so **`OLD_PC` must equal the address of the opcode being executed**. `exceptionHandler` pushes `OLD_PC` (or
`OLD_PC+2`) as the return address. The halt messages print it.

Writers:

| Where | Value |
|---|---|
| `runprog` step 9 (`RUN.CPP:695`) | `PC` after the instruction and after the message pump = address of the next instruction |
| `loadRegs` (`SIM68Ku.cpp:1019`) | `PC` from the text box (before Run / Step / Trace) |
| `exec_inst` 9(a)1 (`RUN.CPP:864`) | `PC` after the instruction (exceptions enabled only) |
| `exec_inst` illegal instruction (`RUN.CPP:869`) | that value minus 2 |
| `exec_inst` after a trace exception (`RUN.CPP:887`) | the trace handler's address |
| `mem_req` address error, exceptions enabled (`UTILS.CPP:431`) | `PC - 2` at the moment of the fault |
| `initSim` (`STARTSIM.CPP:65`) | `-1` |

QUIRKS that follow:
- The hardware Reset button and an interrupt request that starts the run loop from idle do not go through
  `loadRegs`, and nothing else sets `OLD_PC` before the first instruction of such a run. Three cases:
  1. **Interrupt request while idle** (not in trace mode): the first instruction runs with the old `OLD_PC`. That
     is harmless after a normal stop (`runprog` step 9 left `OLD_PC == PC`), but after `initSim` (load, Rewind)
     `OLD_PC` is `-1`. Deterministic.
  2. **Reset button while idle** (not in trace mode - for example after a load, or after a `STOP` halt): `PC` is
     loaded from vector 4 and the run loop starts at once (2.7), so the first instruction at the reset address
     runs with `OLD_PC` = `-1` or the address where the previous run stopped. **Deterministic** - the port must
     reproduce it, not correct it.
  3. **Reset button while a program is running**: the click is handled in one of the two message pumps. In
     `runprog`'s pump (3.3 step 3) it is followed by steps 4-9 with the new `PC` (breakpoint tests on the reset
     address, then `OLD_PC = PC`): correct base. In `runLoop`'s own pump (`SIM68Ku.cpp:258`) the next `runprog`
     starts immediately and `OLD_PC` still holds the pre-reset `PC`. Which pump receives the click is a race in
     the original; the port may pick either outcome (10.4).
  In every case where `OLD_PC` is stale, a first instruction that is `BRA`/`Bcc`/`BSR`/`DBcc` computes its
  target from the wrong base, a write fault stacks the wrong `PC`, and a halt message of 3.4 step 9b prints the
  wrong location. From the second instruction on everything is normal.
- Editing the PC box while paused takes effect only through `loadRegs`.

### 3.6 Effective-address decoding: `eff_addr(long size, int mask, int add_times)` (`RUN.CPP:85-387`)

Inputs: `size` is `BYTE_MASK`, `WORD_MASK` or `LONG_MASK`; `mask` is the set of permitted modes; `add_times` says
whether to add the mode's time to `cycles`. Output: `EA1`/`EV1` (or `EA2`/`EV2`), and a return code.

- **MOVE destination detection:** `move_operation` is true when the opcode's top nibble is 1, 2 or 3 **and**
  `mask == DATA_ALT_ADDR`. Then the EA field is bits 11-6 with register and mode swapped, and the results go to
  `EA2`/`EV2`. In every other case the EA field is bits 5-0 and results go to `EA1`/`EV1`.
- Mode table (`bw` = cycles added for byte/word, `l` = for long, only when `add_times`):

| Mode | Mask bit | EA pointer | Value read with | bw / l | Notes |
|---|---|---|---|---|---|
| 0 `Dn` | `bit_1` | `&D[reg]` | `value_of` | 0 / 0 | |
| 1 `An` | `bit_2` | `&A[a_reg(reg)]` | `value_of` | 0 / 0 | legal only `if (mask & bit_2 && size != BYTE_MASK)` |
| 2 `(An)` | `bit_3` | `&memory[A[reg] & ADDRMASK]` | `mem_req(A[reg], size, &EV)` | 4 / 8 | |
| 3 `(An)+` | `bit_4` | as mode 2 | `mem_req` | 4 / 8 | then `A[reg] += inc_size` (1, 2, 4; **2 for a byte when the opcode register number is 7**). The increment happens **even if the read failed**. |
| 4 `-(An)` | `bit_5` | after `A[reg] -= inc_size` | `mem_req` | 6 / 10 | same size rule |
| 5 `d16(An)` | `bit_6` | `&memory[(A[reg] + ext) & ADDRMASK]` | `mem_req(A[reg] + ext, ...)` | 8 / 12 | `ext` = sign-extended extension word |
| 6 `d8(An,Xi)` | `bit_7` | `&memory[(A[reg] + disp + ind_reg) & ADDRMASK]` | `mem_req` | 10 / 14 | `disp` = signed low byte; index register = `A[a_reg(n)]` if bit 15 else `D[n]`, `n` = bits 14-12; sign-extended from word unless bit 11 is set. Bits 10-8 of the extension word are ignored. |
| 7/0 `abs.W` | `bit_8` | `&memory[ext & ADDRMASK]` | `mem_req(ext, ...)` | 8 / 12 | `if (ext >= 0x8000) ext = 0xFFFF0000 \| ext;` |
| 7/1 `abs.L` | `bit_9` | `&memory[ext & ADDRMASK]` | `mem_req(ext, ...)` | 12 / 16 | |
| 7/2 `d16(PC)` | `bit_10` | `&memory[(PC + ext - 2) & ADDRMASK]` | `mem_req` | 8 / 12 | `PC` already points past the extension word, hence `- 2` |
| 7/3 `d8(PC,Xi)` | `bit_11` | `&memory[(PC - 2 + disp + ind_reg) & ADDRMASK]` | `mem_req` | 10 / 14 | |
| 7/4 `#imm` | `bit_12` | `&global_temp` | `value_of` | 4 / 8 | a word is fetched for byte and word sizes, a long for long; `global_temp = ext` |

- `reg = a_reg(reg)` is applied in modes 1-6, so A7 means the active stack pointer.
- **Every memory mode performs a real read** (`mem_req`) of the operand, even when the instruction only writes
  it (MOVE destination, CLR, Scc, MOVEM register-to-memory, JMP, JSR ...). Consequences: an odd destination
  address is reported as a *read* address error; the read sets `readEA`/`bpRead`; Invalid/Protected checks apply.
- Return value: `BAD_INST` if the mode is not in `mask`; otherwise the `mem_req` result of the operand read
  (`SUCCESS`, `ADDR_ERROR` or `BUS_ERROR`). Failures of the extension-word fetches (`mem_request`) are ignored;
  if one fails, `ext` is used uninitialised.
- Modes 7/5-7/7 are never legal.

`eff_addr_noread(size, mask, add_times)` (`RUN.CPP:404-621`) is the same decoder without the operand read and
without the size restriction on mode 1. It is used only by `LEA` and `PEA`. Differences: it returns `SUCCESS` or
`FAILURE` (0x1111); it does **not** sign-extend `abs.W` (the two callers do that themselves).

`decode_size(long *result)` (`RUN.CPP:44-66`): bits 7-6 of the opcode: 0 -> `BYTE_MASK`, 1 -> `WORD_MASK`,
2 -> `LONG_MASK`, 3 -> `*result = 0` and return `FAILURE`. Callers turn the failure into `BAD_INST`.

`eff_addr_code(inst, start)` (`UTILS.CPP:187-212`) returns an index 0-12 for the timing tables: the mode number
for modes 0-6, then 7 abs.W, 8 abs.L, 9 d16(PC), 10 d8(PC,Xi), 11 #imm, 12 anything else. `start = 0` reads the
source field, `start = 6` the MOVE destination field (mode and register swapped).

### 3.7 Memory access functions and error detection (`UTILS.CPP`)

**`int mem_req(int loc, long size, long *result)`** - read (`UTILS.CPP:420-499`):

1. Address error: `if ((loc % 2 != 0) && (size != BYTE_MASK))`, tested on the **unmasked** address.
   - exceptions on: `OLD_PC = PC-2; mem_req(0xc, LONG_MASK, &PC); exceptionHandler(0, (long) loc, READ);`
   - exceptions off: `haltSimulator();` then message `Address Error: Instruction at %4x accessing address %4x`
     (`OLD_PC`, `loc`).
   - `return ADDR_ERROR;` `*result` is not written.
2. `loc = loc & ADDRMASK;`
3. Unless `loc` is a hardware address (`loc >= seg7loc && loc <= seg7loc+15`, or `loc == LEDloc`, `switchLoc`,
   `pbLoc`):
   - `if (InvalidMap) if (loc >= InvalidStart && loc <= InvalidEnd)` -> bus error;
   - `if (ProtectedMap) if (loc >= ProtectedStart && loc <= ProtectedEnd) if (Form1->regSR->EditText[3] == '0')`
     -> bus error (the *displayed* S bit, section 5.4).
   - Bus error means: exceptions on: `mem_req(0x8, LONG_MASK, &PC); exceptionHandler(0, (long) loc, WRITE);`
     (note `WRITE`, and no update of `OLD_PC`); exceptions off: `haltSimulator();` and message
     `Bus Error: Instruction at %4x accessing address %4x`. `return BUS_ERROR;`
   - Only the first byte's address is tested, not the extent of the access.
4. Read 1, 2 or 4 bytes big-endian into `*result` (zero-extended).
5. `readEA = (long *)&memory[loc]; bpRead = true; return SUCCESS;`

**`int mem_request(long *loc, long size, long *result)`** - read and advance (`UTILS.CPP:527-547`): reads a long
if `size == LONG_MASK`, otherwise a **word**; for `BYTE_MASK` the result is then masked to `0xff`. On success
`*loc` is increased by 4 (long) or 2 (byte and word). Used for opcode and extension-word fetches (`&PC`) and for
stack pops in `RTE`, `RTR`, `RTS` (`&A[...]`).

**`int mem_put(long data, int loc, long size)`** - write (`UTILS.CPP:339-399`):

1. Address error on the unmasked address, as above but `WRITE` and **without** setting `OLD_PC`:
   exceptions on: `mem_req(0xc, LONG_MASK, &PC); exceptionHandler(0, (long) loc, WRITE);`
   exceptions off: `haltSimulator();` and the `Address Error: ...` message. `return ADDR_ERROR;`
2. `loc = loc & ADDRMASK;`
3. `code = memoryMapCheck(Invalid | Protected | Read | Rom, loc, bytes);` (`bytes` = 1, 2, 4)
   `BUS_ERROR` -> return it. `ROM_MAP` -> `return SUCCESS` **without writing**.
4. Store the bytes big-endian.
5. `writeEA = (long *)&memory[loc]; bpWrite = true; Hardware->updateIfNeeded(loc); MemoryFrm->LivePaint(loc);
   return SUCCESS;`

**`int memoryMapCheck(maptype mapt, int loc, int bytes)`** (`UTILS.CPP:246-321`), in order: hardware address ->
`SUCCESS`; `loc < 0 || loc > MEMSIZE-1` -> bus error (unreachable: every caller masks first); Invalid (overlap of
`[loc, loc+bytes-1]` with the range) -> bus error; Protected (overlap, and displayed S bit is 0) -> bus error;
Read (overlap) -> bus error; ROM (overlap) -> `ROM_MAP`; else `SUCCESS`. Each test applies only if the map is
enabled and its flag is in `mapt`. Every bus error here uses `exceptionHandler(0, loc, WRITE)`.

**Who looks at the result.** `put()` and `value_of()` return `void`. Handlers that call `mem_req`/`mem_put`
directly mostly ignore the result too. Only these propagate an access error to `exec_inst`: the `eff_addr`
return value (checked by every handler that calls it, except that `LEA`/`PEA` use the no-read variant),
`BIT_FIELD`'s five byte reads, and the `memoryMapCheck` calls in `TRAP`. **Therefore a faulting *write* normally
does not make the handler return `ADDR_ERROR`/`BUS_ERROR`**: with exceptions enabled the exception frame is
still pushed and `PC` is still loaded from the vector inside `mem_put`, the handler then finishes (flags,
cycles, possibly more accesses) and returns `SUCCESS`; with exceptions disabled the simulator is halted by
`haltSimulator()` and the `Address Error:`/`Bus Error:` line is printed, but the line `Execution halted` is not.

`haltSimulator()` (`RUN.CPP:1121-1128`): auto-trace timer off; `trace = false; halt = true; Hardware->disable();
Log->stopLogWithAnnounce();`

### 3.8 `exceptionHandler(int clas, long loc, int r_w)` and the stack frames (`RUN.CPP:1038-1080`)

Callers load `PC` from the vector **before** calling this function.

1. Supervisor-stack sanity check:
   `if ( (A[8] % 2) || (A[8] < 0) || ((unsigned int)A[8] > MEMSIZE) )` -> auto-trace timer off; two messages,
   `Error during Exception Handler: SSP odd or outside memory space ` (with a trailing space) and
   `at location %4x` (`A[8]`); `trace = true; sstep = false; return;`. Nothing is pushed and SR is not changed, but
   `PC` already holds the vector. `A[8] == 0x01000000` (the reset value) and `A[8] == 0` are accepted (0 wraps to
   `$FFFFFC` through the address mask).
2. Class 1 or 2 (6-byte frame): `A[8] -= 4;` push `OLD_PC` (long); `A[8] -= 2;` push `SR` (word).
3. Class 0 (14-byte frame, address or bus error): `inc_cyc(50);` then, in this order,
   `A[8] -= 4;` push `OLD_PC+2` (long); `A[8] -= 2;` push `SR`; `A[8] -= 2;` push `inst` (the opcode word);
   `A[8] -= 4;` push `loc` (the faulting address, long); `A[8] -= 2;` push the information word:
   `infoWord = (loc == OLD_PC+2) ? 0x6 : 0x5; if (r_w == READ) infoWord |= 0x10;`
   Resulting layout from `SSP` upwards: info word (2), access address (4), instruction register (2), SR (2),
   PC (4). The function-code field always says "supervisor" (5 = data, 6 = program) and bit 3 is never set.
   `inst` is whatever the last **successful** opcode fetch stored: when the fault is in the opcode fetch itself
   (odd or unmapped `PC`), the instruction-register word of the frame is the opcode of the *previous*
   instruction, because a failed `mem_request` leaves `inst` untouched (`UTILS.CPP:439, 463, 478`).
4. `SR = SR | sbit; SR = SR & ~tbit; trace_bit = false;` The interrupt mask is not changed here.

The pushes use `put((long *)&memory[A[8] & ADDRMASK], ...)`, that is `mem_put`: they honour the memory map (a ROM
range silently swallows the frame; a Read-only or Invalid range raises a nested bus error from inside the
handler), they set `writeEA`/`bpWrite`, and they refresh the hardware and memory displays.

### 3.9 Exception catalogue (exceptions enabled)

| Cause | Detected by | Vector address | Class | PC pushed | Cycles added |
|---|---|---|---|---|---|
| Bus error | `mem_req`, `memoryMapCheck` (memory map only) | `$08` | 0 | `OLD_PC + 2` = address of the current opcode + 2 (or the value set by an earlier address error in the same instruction) | 50 |
| Address error, read | `mem_req` | `$0C` | 0 | `PC` at the moment of the fault (`OLD_PC` was set to `PC-2`) | 50 |
| Address error, write | `mem_put` | `$0C` | 0 | `OLD_PC + 2` (opcode address + 2) | 50 |
| Illegal instruction | handler returned `BAD_INST`, or no table match | `$10` | 1 | `PC - 2` when the handler returned. This is the opcode address only if no extension word had been fetched yet (QUIRK: e.g. `ADDI` with an illegal mode has already fetched its immediate) | 34 |
| Divide by zero | `DIVS`, `DIVU` | `$14` | 2 | address after the instruction | 42 |
| CHK | `CHK` | `$18` | 2 | address after the instruction | 44 |
| TRAPV | `TRAPV` | `$1C` | 2 | address after the instruction | 34 |
| Privilege violation | handler returned `NO_PRIVILEGE` | `$20` | 1 | `PC` when the handler returned: opcode + 2, or opcode + 4 for `STOP` (QUIRK: a real 68000 stacks the opcode address) | 34 |
| Trace | `trace_bit` | `$24` | 2 | address of the next instruction | 34 |
| Line A | `LINE1010` | `$28` | 2 | opcode + 2 (QUIRK: a real 68000 stacks the opcode address) | 34 |
| Line F | `LINE1111` | `$2C` | 2 | opcode + 2 (same QUIRK) | 34 |
| Interrupt level n | `irq & intMask` | `$60 + 4n` (`$64`..`$7C`) | 2 | address of the next instruction | 44 at request time + 34 |
| TRAP #n | `TRAP` | `$80 + 4n` | 2 | address after the TRAP | 38 |

Order when several apply to one instruction: illegal/privilege, then interrupt, then trace, then the group
`TRAP`/divide/CHK/TRAPV/STOP-trace/line A/line F. Each later one stacks on top of the earlier one, using whatever
`OLD_PC` then holds. QUIRK: `OLD_PC` is not refreshed between "illegal/privilege" and "interrupt", so an interrupt
taken in the same step as an illegal instruction or privilege violation stacks the *faulting instruction's*
address again instead of the first handler's address.

### 3.10 Interrupts

**Request** - `THardware::IRQprocess(int irqN)` (`hardwareu.cpp:757-775`; sources and timers are specified in
`hardware.md` section 3):

```cpp
if(hardwareEnabled) {
  if (irqN > 0) irq |= (0x01 << (irqN-1));        // Reset calls IRQprocess with irqN = 0
  if (stopInstruction) {                          // if CPU halted after STOP instruction
    intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
    if (!( irq & intMask)) return;                // if IRQ masked
  }
  inc_cyc (44);                                   // Interrupt execution time
  if (!trace) runMode = true;                     // enable runLoop() if not tracing
  if (runMode) Form1->runLoop();                  // enter runLoop
}
```

- The request is only latched in `irq`. It is taken later, inside `exec_inst`, **after the next instruction has
  executed**.
- 44 cycles are added at request time whether or not the interrupt is masked (except in the `stopInstruction`
  early return).
- `IRQprocess` does not look at `exceptions`. With exceptions disabled the request is still latched, the 44
  cycles are still added and an idle simulator is still set running; the request is just never serviced
  (3.4 step 9b) and stays in `irq` until `initSim()` - or until exceptions are enabled later, when it is taken.
- The Reset button does not clear `irq` either: requests latched before a reset survive it (levels 1-6 are then
  masked by the SR value the reset sets).
- If the simulator is idle and not in trace mode, a request **starts the program running** from the current PC,
  without `loadRegs()` and without the menu changes of Run (QUIRK). If the run loop is already active the nested
  `runLoop()` call returns at once (`running` guard).
- Callers: the seven IRQ buttons and auto-interval timers of the Hardware window (`hardwareu.cpp:715-755`), the
  Reset button (`irqN = 0`), key down/up in the I/O window when `keyDownIRQ`/`keyUpIRQ` is non-zero
  (`simIOu.cpp:425-426, 458-459`), mouse down/up/move when the corresponding level is non-zero
  (`simIOu.cpp:694-695, 760-761, 787-788`).

**Mask** - `intMask = (0xFF80 >> (7 - level)) | 0x40` where `level = (SR & 0x0700) >> 8` (`RUN.CPP:878`). Only bits
0-6 matter: level 0 lets requests 1-7 through, level `k` lets `k+1`..7 through, and bit 6 (`0x40`, level 7) is
always enabled (non-maskable).

**Acceptance** - `irqHandler()` (`RUN.CPP:1083-1117`), called from `exec_inst` when `irq & intMask` is non-zero
and exceptions are enabled:

1. `exceptionHandler(2, 0, READ);` - pushes `OLD_PC` (the next instruction's address) and the *old* SR; sets S,
   clears T.
2. `SR &= 0xF8FF;`
3. The **highest pending** level is taken (tests `irq & 0x40`, `0x20`, ... `0x01` in that order): `SR |= level << 8`,
   `mem_req(0x60 + 4*level, LONG_MASK, &PC)` (autovectors `$64`, `$68`, `$6C`, `$70`, `$74`, `$78`, `$7C`), and that
   request bit is cleared (`irq &= 0x3F`, `0x1F`, `0x0F`, `0x07`, `0x03`, `0x01`, `0x00` respectively - each mask
   also clears all higher bits, which are known to be zero).
4. `inc_cyc(34);`

Only one interrupt is taken per instruction step. Lower pending requests stay latched.

### 3.11 The trace bit

- `trace_bit` is sampled from SR bit 15 before the handler runs (`RUN.CPP:847-850`).
- Exceptions enabled: after the instruction (and after any illegal/privilege/interrupt processing, each of which
  clears `trace_bit`), a trace exception through vector `$24` is taken if `trace_bit` is still true. The
  instruction that *sets* T is therefore not traced; the one that *clears* T is.
- Exceptions disabled: no trace exception; instead the simulator halts with `TRACE exception occurred at location
  %4x. Execution halted` whenever SR bit 15 is set after an instruction (3.4 step 9b).
- Do not confuse the 68000 T bit with the simulator's `trace` variable (single-step mode).

### 3.12 STOP (`CODE9.CPP:198-230`, opcode `$4E72`)

```cpp
inc_cyc (4);
mem_request (&PC, (long) WORD_MASK, &temp);
if (!(SR & sbit)) return (NO_PRIVILEGE);
tr_on = (SR & tbit) ? true : false;
SR = temp & WORD_MASK;
if (tr_on) SR = SR | tbit;
if (!(SR & sbit)) return (NO_PRIVILEGE);      // QUIRK: new SR without S -> privilege violation, SR already changed
if (tr_on) return (TRACE_EXCEPTION);
return (STOP_TRAP);
```

- Exceptions enabled, `STOP_TRAP`: `halt = true`, so the run loop stops and the menus show the busy state.
  The message `STOP instruction. Execution halted` appears only the **first** time after a reset, because
  `stopInstruction` stays true (3.4). Hardware stays enabled; auto-interrupt timers keep running because
  `runprog` skips `autoIRQoff()` while `stopInstruction` is true. A later unmasked interrupt request restarts the
  run loop through `IRQprocess`. **QUIRK:** the restarted loop first executes the instruction that follows the
  STOP and only then takes the interrupt, so the stacked return address is the *second* instruction after the
  STOP.
- Because `stopInstruction` is never cleared by continuing, after the first STOP a *masked* interrupt request no
  longer adds 44 cycles and no longer starts the run loop, and pausing no longer turns the auto-interrupt
  timers off in `runprog` (Pause itself still calls `autoIRQoff()`).
- **QUIRK - request already latched when the STOP executes.** In `exec_inst` the interrupt test (3.4 step 9a-3,
  `RUN.CPP:878-880`) comes *before* the `STOP_TRAP` case (`RUN.CPP:892`). If an unmasked request is pending at the
  end of the STOP instruction - it was latched in a message pump just before, and typically the STOP operand
  has just lowered the mask - the interrupt is accepted in that same step (frame pushed with the address after the STOP,
  `PC` = handler, SR mask raised to the request level) and **then `halt = true` is still set**: the simulator
  stops with `PC` at the first instruction of the handler. From there it restarts only on a later request that
  passes the *new*, raised mask (the `stopInstruction` test in `IRQprocess`), on Reset, or by Pause followed by
  Run. A program that waits in a `STOP` loop can therefore occasionally stall in the original when a request
  arrives in the short window between its `RTE` and the next `STOP`; the port inherits this and must not "fix"
  it. The same ordering applies to SIMHALT and task 9: the handler sets
  `halt`, a pending unmasked interrupt is still accepted at the end of that step, and the displayed `PC` is then
  the interrupt handler's address.
- With the T bit set, `STOP` returns `TRACE_EXCEPTION`; with exceptions enabled this produces **two** trace
  frames (one from `trace_bit`, one from the `TRACE_EXCEPTION` case) (QUIRK).
- Exceptions disabled: message `STOP instruction executed at location %4x. Execution halted`, the log is
  stopped, the hardware is disabled (3.4 step 9b).

### 3.13 Halting

| Mechanism | Where | Effect |
|---|---|---|
| **SIMHALT** = opcode `$FFFF` followed by the word `$FFFF`, and `simhalt_on` true | `LINE1111`, `CODE9.CPP:1307-1322` | `mem_req(PC, WORD_MASK, &temp)` peeks the next word. If all three conditions hold: `PC += 2;` auto-trace timer off; `trace = false; halt = true; Hardware->disable(); Log->stopLogWithAnnounce(); return SUCCESS;`. Otherwise `return LINE_1111` (line-F exception, or halt with message when exceptions are disabled). No cycles are added. |
| TRAP #15 task 9 | `CODE9.CPP:783-789` | Same statements without the PC adjustment. |
| `haltSimulator()` | address/bus error with exceptions disabled | Same statements (3.7). |
| `halt = true` only | exception with exceptions disabled; STOP; double fault (3.14) | Run loop stops; hardware is disabled only in the STOP-without-exceptions case. |

After any of these, `runprog` step 10 sets `runMode = false`, refreshes the display and calls `setMenuTrace()`
(Run, Step, Trace disabled; Pause, Rewind, Close enabled). Pressing Pause re-enables the commands; execution can
then continue from the PC, which for SIMHALT is the address after the four `$FF` bytes. `Hardware->disable()`
leaves `hardwareEnabled` false until the next `initSim()` (or until a keyboard read completes in trace mode,
`simIOu.cpp:1368`), so interrupts and the Reset button are ignored meanwhile. `Log->stopLogWithAnnounce()` shows a
modal box `Current Log Stopped.` if logging was on, then closes the log (`logU.cpp:217-223`).

`halt` is cleared at the start of the next `runprog`; nothing remembers that the program "ended". In particular,
after a halt that leaves the hardware enabled and `trace` false (every row of the table marked "`halt = true`
only", except STOP without exceptions) an interrupt request or a click on Reset starts execution again through
`IRQprocess` (3.10), continuing after the instruction that halted.

Two consequences of the SIMHALT encoding that programs depend on without knowing it:
- Memory is filled with `$FF` (1.5), so **every unused even address holds `$FFFF $FFFF`, which is SIMHALT**. A
  program that runs off its end, or jumps or returns into memory it never loaded, stops there silently - no
  message is added to the message area by the SIMHALT path (only the trace line of 3.4 step 5 when
  single-stepping). With `simhalt_on` false the same bytes give the line-F result instead: the message
  `Line 1111 Emulator exception occurred at location %4x. Execution halted`, or, with exceptions enabled, an
  exception through the (usually uninitialised) vector `$2C` and the double-fault sequence of 3.14.
- `LINE1111` peeks the following word with a real `mem_req(PC, ...)` for **every** `$Fxxx` opcode, not only
  `$FFFF`: it sets `readEA`/`bpRead` (7.2) and can raise a bus error if that word lies in an Invalid range.

### 3.14 Double faults, uninitialised vectors and zero vectors

There is **no test of a vector's value** anywhere. What happens follows from the mechanisms above:

**Double-fault rule.** `errflg` is set at the start of `exec_inst` when the previous step's result was
`ADDR_ERROR` or `BUS_ERROR`, and cleared again if the current instruction is fetched and finishes with any other
result. If the fetch fails, or the instruction also ends in an address/bus error, `errflg` stays set and
`runprog` halts with the message

> `Address or Bus error during exception processing. Execution halted`

This path does **not** stop the auto-trace timer or the log and does not disable the hardware (only the
`autoIRQoff()` of `runprog` step 10 applies). If the user (or the auto-trace timer) steps again the same fault
repeats: another 14-byte frame and the same message each time.

**Uninitialised vector.** Memory is filled with `$FF`, so a vector the program never wrote reads `$FFFFFFFF`.
Sequence for, say, `TRAP #1` with exceptions enabled:
1. Step 1: frame pushed, `PC = $FFFFFFFF`. No message.
2. Step 2: fetch at an odd address -> address error: `OLD_PC = PC-2`, `PC` reloaded from `$0C` (also
   `$FFFFFFFF` if uninitialised), 14-byte frame, `exec_result = ADDR_ERROR`. No message.
3. Step 3: `errflg = true`; the fetch faults again (third frame); `runprog` prints the message above and halts.
The registers then show `PC = FFFFFFFF` and the supervisor stack holds 6 + 14 + 14 bytes of frames. If the first
exception was itself an address error, the halt comes one step earlier. If the address-error vector is valid but
the original vector is not, the program's address-error handler simply runs.

**Zero vector.** If the vector contains 0, `PC` becomes 0 and `runprog` step 6 (`PC == runToAddr`, with
`runToAddr == 0`) turns trace mode on: **execution pauses at address 0 with no message at all.** The user can
continue, executing whatever bytes are at address 0.

**Bad supervisor stack.** See 3.8 step 1: the two-line message `Error during Exception Handler: SSP odd or outside
memory space ` / `at location %4x`, and trace mode on.

**Vector table inside an Invalid range.** Reading the bus-error vector (`mem_req(0x8, ...)`) faults again and
recurses without limit (`UTILS.CPP:456`). UNVERIFIED what the user sees in the original (a stack overflow caught by
the `catch (...)` in `exec_inst`, most likely). HAZARD 11.9.

**Exceptions disabled.** Vectors are never read; every exception halts with the message from 3.4 step 9b.

Worked example, useful as a regression test because it is what a student sees who ends a program with `RTS`
instead of `SIMHALT` (default settings: exceptions disabled, supervisor mode, `SSP = $01000000`, vector 0 never
written). `RTS` pops from `$01000000`, which is masked to address 0 (`UTILS.CPP:445`): `PC = $FFFFFFFF`,
`SSP = $01000004`, no message; `runprog` step 9 sets `OLD_PC = $FFFFFFFF`. The next step fails in the opcode
fetch: `haltSimulator()`, and the message area gets exactly one line,
`Address Error: Instruction at ffffffff accessing address ffffffff` - **without** a following `Execution halted`,
because `exec_inst` skips everything after a failed fetch (3.4 step 3). The display shows `PC=FFFFFFFF`. If the
user pauses and runs again, the same line is printed once more, followed this time by
`Address or Bus error during exception processing. Execution halted` (the double-fault rule above).

### 3.15 Cycle counting

- `void inc_cyc(int num) { cycles = cycles + num; }` (`UTILS.CPP:165-170`).
- Each handler adds its base time; `eff_addr` adds the addressing-mode time when called with `add_times = true`
  (table in 3.6). `MOVE`, `MOVEA`, `MOVEM`, `LEA`, `PEA`, `JMP`, `JSR` pass `false` and use their own tables.
- Exception times are listed in 3.9; the Reset button adds 40 + 44.
- **TRAP #15 tasks serviced by the simulator add nothing** (`TRAP()` never calls `inc_cyc` on that path).
  Task 30 sets `cycles = 0`; task 31 returns the counter in D1, or 0 if it exceeds `0xFFFFFFFF`
  (`CODE9.CPP:897-905`).
- The "Clear Cycles" button sets `cycles = 0` (`SIM68Ku.cpp:1256-1262`).
- The values are estimates and are not those of a real 68000 in every case; the table in 3.16 gives the formulas.

### 3.16 The instruction table and per-instruction notes

`inst_arr[i] = { mask, val, name }`, `names[i]` = handler. An opcode matches entry `i` when
`(inst & ~mask) == val`; the first matching entry within the opcode's group wins. In the handler tables below,
the number in parentheses after a handler name is the line where it starts in its file; mode-set names such as
`DATA_ALT_ADDR` are the masks passed to `eff_addr` (values in 1.2, bits in 3.6). Flags are given as the five
method codes passed to `cc_update(x, n, z, v, c, ...)` (meanings in 3.17). "Cycles" excludes the EA time added by
`eff_addr` unless stated ("+ EA" means `eff_addr` was called with `add_times = true`).

| # | mask | val | name | handler | # | mask | val | name | handler |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0000 | 0A3C | EORI_TO_CCR | `EORI_TO_CCR` | 44 | 007F | 4C80 | MOVEM_TO_REG | `MOVEM` |
| 1 | 0000 | 0A7C | EORI_TO_SR | `EORI_TO_SR` | 45 | 007F | 4880 | MOVEM_TO_EA | `MOVEM` |
| 2 | 0000 | 003C | ORI_TO_CCR | `ORI_TO_CCR` | 46 | 00FF | 4200 | CLR | `CLR` |
| 3 | 0000 | 007C | ORI_TO_SR | `ORI_TO_SR` | 47 | 00FF | 4000 | NEGX | `NEGX` |
| 4 | 0000 | 023C | ANDI_TO_CCR | `ANDI_TO_CCR` | 48 | 00FF | 4400 | NEG | `NEG` |
| 5 | 0000 | 027C | ANDI_TO_SR | `ANDI_TO_SR` | 49 | 00FF | 4600 | NOT | `NOT` |
| 6 | 0EC7 | 0108 | MOVEP | `MOVEP` | 50 | 00FF | 4A00 | TST | `TST` |
| 7 | 00FF | 0200 | ANDI | `ANDI` | 51 | 0E3F | 4180 | CHK | `CHK` |
| 8 | 00FF | 0000 | ORI | `ORI` | 52 | 0E3F | 41C0 | LEA | `LEA` |
| 9 | 00FF | 0400 | SUBI | `SUBI` | 53 | 0F07 | 50C8 | DBCC | `DBCC` |
| 10 | 00FF | 0600 | ADDI | `ADDI` | 54 | 0F3F | 50C0 | SCC | `SCC` |
| 11 | 00FF | 0800 | BIT_OP | `BIT_OP` | 55 | 0EFF | 5100 | SUBQ | `SUBQ` |
| 12 | 00FF | 0A00 | EORI | `EORI` | 56 | 0EFF | 5000 | ADDQ | `ADDQ` |
| 13 | 00FF | 0C00 | CMPI | `CMPI` | 57 | 00FF | 6000 | BRA | `BRA` |
| 14 | 0EFF | 0100 | BIT_OP | `BIT_OP` | 58 | 00FF | 6100 | BSR | `BSR` |
| 15 | 0FFF | 1000 | MOVEB | `MOVE` | 59 | 0FFF | 6000 | BCC | `BCC` |
| 16 | 0E3F | 2040 | MOVEAL | `MOVEA` | 60 | 0EFF | 7000 | MOVEQ | `MOVEQ` |
| 17 | 0FFF | 2000 | MOVEL | `MOVE` | 61 | 0E0F | 8100 | SBCD | `SBCD` |
| 18 | 0E3F | 3040 | MOVEAW | `MOVEA` | 62 | 0E3F | 80C0 | DIVU | `DIVU` |
| 19 | 0FFF | 3000 | MOVEW | `MOVE` | 63 | 0E3F | 81C0 | DIVS | `DIVS` |
| 20 | 0000 | 4AFC | ILLEGAL | `ILLEGAL` | 64 | 0FFF | 8000 | OR | `OR` |
| 21 | 0000 | 4E70 | RESET | `RESET` | 65 | 0F3F | 90C0 | SUBA | `SUBA` |
| 22 | 0000 | 4E71 | NOP | `NOP` | 66 | 0ECF | 9100 | SUBX | `SUBX` |
| 23 | 0000 | 4E72 | STOP | `STOP` | 67 | 0FFF | 9000 | SUB | `SUB` |
| 24 | 0000 | 4E73 | RTE | `RTE` | 68 | 0FFF | A000 | LINE_1010 | `LINE1010` |
| 25 | 0000 | 4E75 | RTS | `RTS` | 69 | 0F3F | B0C0 | CMPA | `CMPA` |
| 26 | 0000 | 4E76 | TRAPV | `TRAPV` | 70 | 0EC7 | B108 | CMPM | `CMPM` |
| 27 | 0000 | 4E77 | RTR | `RTR` | 71 | 0EFF | B000 | CMP | `CMP` |
| 28 | 0007 | 4E50 | LINK | `LINK` | 72 | 0EFF | B100 | EOR | `EOR` |
| 29 | 0007 | 4E58 | UNLK | `UNLK` | 73 | 0E07 | C140 | EXG_D | `EXG` |
| 30 | 0007 | 4E60 | MOVE_TO_USP | `MOVE_USP` | 74 | 0E07 | C148 | EXG_A | `EXG` |
| 31 | 0007 | 4E68 | MOVE_FR_USP | `MOVE_USP` | 75 | 0E07 | C188 | EXG_D_AND_A | `EXG` |
| 32 | 0007 | 4840 | SWAP | `SWAP` | 76 | 0E0F | C100 | ABCD | `ABCD` |
| 33 | 0007 | 4880 | EXT | `EXT` | 77 | 0E3F | C1C0 | MULS | `MULS` |
| 34 | 0007 | 48C0 | EXT | `EXT` | 78 | 0E3F | C0C0 | MULU | `MULU` |
| 35 | 000F | 4E40 | TRAP | `TRAP` | 79 | 0FFF | C000 | AND | `AND` |
| 36 | 003F | 40C0 | MOVE_FR_SR | `MOVE_FR_SR` | 80 | 0F3F | D0C0 | ADDA | `ADDA` |
| 37 | 003F | 44C0 | MOVE_TO_CCR | `MOVE_TO_CCR` | 81 | 0ECF | D100 | ADDX | `ADDX` |
| 38 | 003F | 46C0 | MOVE_TO_SR | `MOVE_TO_SR` | 82 | 0FFF | D000 | ADD | `ADD` |
| 39 | 003F | 4800 | NBCD | `NBCD` | 83 | 073F | E8C0 | BIT_FIELD | `BIT_FIELD` |
| 40 | 003F | 4840 | PEA | `PEA` | 84 | 073F | E0C0 | SHIFT_ROT | `SHIFT_ROT` |
| 41 | 003F | 4AC0 | TAS | `TAS` | 85 | 0FFF | E000 | SHIFT_ROT | `SHIFT_ROT` |
| 42 | 003F | 4E80 | JSR | `JSR` | 86 | 0FFF | F000 | LINE_1111 | `LINE1111` |
| 43 | 003F | 4EC0 | JMP | `JMP` | | | | | |

Names in the table are stored padded with spaces to 12 characters (`char name[13]`).

**Data movement (`CODE1.CPP`, `CODE2.CPP`)**

| Handler | Operation as coded | Flags | Cycles | Quirks |
|---|---|---|---|---|
| `MOVE` (68) | Size from bits 13-12: 1 byte, 3 word, 2 long, 0 -> `BAD_INST`. `eff_addr(size, ALL_ADDR, false)` then `eff_addr(size, DATA_ALT_ADDR, false)`; `put(EA2, EV1, size); value_of(EA2, &EV2, size);` | `N_A, GEN, GEN, ZER, ZER` on the value re-read from the destination | `move_bw_times[src][dst]` or `move_l_times[src][dst]` (`CODE1.CPP:26-53`) | The destination is **read before and after** the write (two `mem_req`). A write fault does not abort the instruction (3.7). |
| `MOVEP` (118) | Displacement word, `address = A[a_reg(reg)] + disp`; bit 6 = long (4 bytes) else word (2 bytes); bit 7 set = register to memory, clear = memory to register; most significant byte first, `address += 2` each | none | 16 word / 24 long | Access errors ignored. |
| `MOVEA` (173) | Bit 12 set = word (sign-extended), else long; `eff_addr(size, ALL_ADDR, false)`; `A[a_reg(n)] = EV1` | none | `move_bw_times[src][1]` / `move_l_times[src][1]`, added **before** the EA is validated | For an illegal source mode `src` is 12 and the table read is out of bounds (HAZARD 11.4). |
| `MOVE_FR_SR` (205) | `eff_addr(WORD, DATA_ALT_ADDR, true); put(EA1, SR, WORD)` | none | `(inst & 0x30) ? 8 : 6` + EA | Not privileged (correct for a 68000). |
| `MOVE_TO_CCR` (220) | `eff_addr(WORD, DATA_ADDR, true); put((long *)&SR, EV1, BYTE_MASK)` | whole low byte of SR replaced | 12 + EA | All 8 bits are written, including bits 5-7. |
| `MOVE_TO_SR` (235) | `NO_PRIVILEGE` if S clear (before the EA is decoded); else `put((long *)&SR, EV1, WORD_MASK)` | whole SR | 12 + EA | |
| `MOVEM` (253) | `saveAn = A[a_reg(inst & 7)]`; fetch mask word; bit 6 = long; bit 10 = memory to registers. `eff_addr(size, dir ? CONTROL_ADDR\|bit_4 : CONT_ALT_ADDR\|bit_5, false)`; `address = EA1 - memory`; for bit `counter` 0..15 set in the mask: memory to register: word values sign-extended, `counter < 8 ? D[counter] : A[a_reg(counter-8)]`; register to memory, `-(An)`: `counter < 8 ? A[a_reg(7-counter)] (saveAn if that is the base register) : D[15-counter]`; other modes: `D[counter]` / `A[a_reg(counter-8)]`; `address += +-2/4`. For `(An)+`/`-(An)`: `A[base] = saveAn + (address moved)` | none | `movem_t_r_times[mode]` or `mover_t_m_times[mode]` (`CODE1.CPP:59-63`) + 4 (word) or 8 (long) per register | `eff_addr` performs one read at the starting address in both directions. In `-(An)` mode with the base register in the list, the **initial** value of An is stored. Access results inside the loop are ignored. |
| `MOVE_USP` (350) | `NO_PRIVILEGE` if S clear. `reg = inst & 7; if (reg == 7) reg = 8;` bit 3 set: `A[reg] = A[7]`, else `A[7] = A[reg]` | none | 4 | |
| `MOVEQ` (375) | `D[reg]` = byte sign-extended to long (two `sign_extend` calls) | `N_A, GEN, GEN, ZER, ZER` long | 4 | |
| `EXG` (24) | `(inst >> 3) & 0x1f`: `0x08` D-D, `0x09` A-A, `0x11` D-A, else `BAD_INST` | none | 6 | |
| `LEA` (57) | `eff_addr_noread(BYTE_MASK, CONTROL_ADDR, false)`, failure -> `BAD_INST`. `A[a_reg(reg)] = EA1 - memory`; if mode is abs.W, sign-extend the word | none | (An) 4, d16 8, d8+Xi 12, abs.W 8, abs.L 12, d16(PC) 8, d8(PC,Xi) 12 | **Result is 24-bit**: the address has been through `& ADDRMASK`. `LEA $12345678,A0` gives `$00345678`; `LEA -1(A0)` with A0 = 0 gives `$00FFFFFF`. Only abs.W gives a sign-extended 32-bit value. |
| `PEA` (94) | Same decode with `LONG_MASK`; `A[a_reg(7)] -= 4`; push the 24-bit (or sign-extended abs.W) address | none | 12, 16, 20, 16, 20, 16, 20 (same mode order) | Same 24-bit quirk. |
| `LINK` (135) | `A[a_reg(7)] -= 4; put(&memory[A[a_reg(7)]], A[reg], LONG); A[reg] = A[a_reg(7)]; A[a_reg(7)] += disp` | none | 16 | `A[reg]` is used without `a_reg()`: `LINK A7` in supervisor mode uses the **user** stack pointer as the frame register. |
| `UNLK` (160) | `A[a_reg(7)] = A[reg]; mem_req(A[a_reg(7)], LONG, &A[reg]); A[a_reg(7)] += 4` | none | 12 | Same `A[reg]` quirk. |

**Arithmetic (`CODE3.CPP`, `CODE4.CPP`, `CODE5.CPP`)**

| Handler | Operation as coded | Flags | Cycles | Quirks |
|---|---|---|---|---|
| `ADD` (24), `SUB` (246) | Bit 8 set: Dn op to `<ea>` with `MEM_ALT_ADDR`; clear: `<ea>` to Dn with `ALL_ADDR`. | ADD `GEN, GEN, GEN, CASE_1, CASE_5`; SUB `GEN, GEN, GEN, CASE_2, CASE_6` | to memory: 12 long / 8; to Dn: long 8 if source is Dn, An or #imm, else 6; byte/word 4. + EA | |
| `ADDA` (85), `SUBA` (300) | Bit 8 = long, else word sign-extended; `ALL_ADDR`; 32-bit result in `A[a_reg(n)]` | none | long: 8 if source Dn/An/#imm else 6; word: 8. + EA | |
| `ADDI` (127), `SUBI` (340) | Immediate fetched first (`mem_request(&PC, size, &source)`), then `eff_addr(size, DATA_ALT_ADDR, true)` | as ADD / SUB | Dn: 16 long / 8; memory: 20 long / 12. + EA | |
| `ADDQ` (156), `SUBQ` (374) | Data = bits 11-9, 0 means 8. Mode An forces `LONG_MASK` and skips flags. `ALTERABLE_ADDR` | as ADD / SUB (not for An) | Dn: 8 long / 4; An: 8; memory: 12 long / 8. + EA | A byte-size ADDQ/SUBQ to An is accepted and done as long. |
| `ADDX` (198), `SUBX` (417) | Bit 3 set: `-(Ay),-(Ax)` with `A[] -= 1/2/4`; clear: `Dy,Dx`. Operand +- `((SR & xbit) >> 4)` | `GEN, GEN, CASE_1, CASE_1 (ADDX) / CASE_2 (SUBX), CASE_5 / CASE_6` | memory 30 long / 18; register 8 long / 4 | Byte size decrements A7 by 1, not 2. Only a **bus** error on the destination read is handled (An restored, stale `result` used for the flags); an address error falls through into the write and a second read, producing up to three frames. |
| `DIVS` (178) | `eff_addr(WORD, DATA_ADDR, true)`; divisor 0 -> `DIV_BY_ZERO`. 64-bit quotient; if outside -32768..32767: `SR \|= vbit` and nothing else changes; else `SR &= ~vbit`, `D[reg] = (remainder << 16) \| quotient` | no overflow: `N_A, GEN, GEN, N_A, ZER` on the 16-bit quotient | `getDivs68kCycles(dest, source)` (`CODE4.CPP:130-174`) + EA | On overflow N, Z and C keep their old values. |
| `DIVU` (226) | Same with unsigned arithmetic; overflow when quotient > `0xFFFF` | same | `getDivu68kCycles` (`CODE4.CPP:82-123`) + EA | same |
| `MULS` (257) | 16x16 signed -> `D[reg]` | `N_A, GEN, GEN, CASE_9, ZER` long | 38 + 2n, n = number of 0/1 transitions in the source word scanned from bit 0 with an initial 0. + EA | `CASE_9` is not a V method, so **V is left unchanged**. |
| `MULU` (294) | 16x16 unsigned | `N_A, GEN, GEN, ZER, ZER` long | 38 + 2n, n = number of 1 bits in the source. + EA | |
| `NEG` (328) | `put(EA1, -dest, size)`, `DATA_ALT_ADDR` | `GEN, GEN, GEN, CASE_3, CASE_4` | Dn 6 long / 4; memory 12 long / 8. + EA | |
| `NEGX` (358) | `put(EA1, -dest - X, size)` | `GEN, GEN, CASE_1, CASE_3, CASE_4` | same | `source` is not set (stale); the selected flag methods do not use it. |
| `CMP` (390) | `ALL_ADDR`; `put(&result, dest - source, size)` | `N_A, GEN, GEN, CASE_2, CASE_6` | 6 long / 4. + EA | |
| `CMPA` (419) | word source sign-extended; 32-bit compare | same, long | 6 + EA | |
| `CMPI` (457) | immediate first; `DATA_ALT_ADDR` | same | memory 12 long / 8; Dn 14 long / 8. + EA | |
| `CMPM` (489) | `(Ay)+,(Ax)+`, increments 1/2/4 | same | 20 long / 12 | Byte size increments A7 by 1. A bus error on the destination leaves Ax and `result` unchanged. |
| `TST` (520) | `DATA_ALT_ADDR` | `N_A, GEN, GEN, ZER, ZER` | 4 + EA | |
| `CLR` (549) | `DATA_ALT_ADDR`; `put(EA1, 0, size)` | `N_A, ZER, GEN, ZER, ZER` | Dn 6 long / 4; memory 12 long / 8. + EA | The operand is read first (as on a real 68000). |
| `EXT` (582) | Bit 6 = long (word to long), else byte to word | `N_A, GEN, GEN, ZER, ZER` at the result size | 4 | |
| `ABCD` (25), `SBCD` (86) | Bit 3: `-(Ay),-(Ax)` byte with decrement 1; else `Dy,Dx`. Digit-wise decimal add/subtract with X; C set or cleared directly | then `GEN, UND, CASE_1, UND, N_A` | memory 18; register 6 | **N and V are inverted on every execution** (`UND` = toggle). Byte decrement of A7 is 1. |
| `NBCD` (146) | `eff_addr(BYTE, DATA_ALT_ADDR, true)`; `0 - dest - X` in decimal | same | `(inst & 0x30) ? 8 : 6` + EA | N and V toggled. |

**Logic, shifts, bits (`CODE6.CPP`, `CODE7.CPP`)**

| Handler | Operation as coded | Flags | Cycles | Quirks |
|---|---|---|---|---|
| `AND` (24), `OR` (141) | Bit 8 set: Dn to `<ea>` `MEM_ALT_ADDR`; clear: `<ea>` to Dn `DATA_ADDR` | `N_A, GEN, GEN, ZER, ZER` | as ADD | |
| `EOR` (260) | Dn to `<ea>`, `DATA_ALT_ADDR` | same | memory 12 long / 8; Dn 8 long / 4. + EA | |
| `ANDI` (77), `ORI` (194), `EORI` (293) | immediate first; `DATA_ALT_ADDR` | same | Dn 16 long / 8; memory 20 long / 12. + EA | |
| `NOT` (358) | `DATA_ALT_ADDR` | same | Dn 6 long / 4; memory 12 long / 8. + EA | |
| `ANDI_TO_CCR` (107) | `SR &= temp \| 0xff00` | | 20 | |
| `ORI_TO_CCR` (227) | `SR \|= temp` | | 20 | The **whole immediate word** is ORed into SR without a privilege check. Assembler-generated code has a zero high byte. |
| `EORI_TO_CCR` (326) | `SR ^= temp` | | 20 | Same. |
| `ANDI_TO_SR` (122), `ORI_TO_SR` (242), `EORI_TO_SR` (341) | `NO_PRIVILEGE` if S clear (**before** the immediate is fetched), else `SR &=`, `\|=`, `^= temp` | | 20 | After a privilege violation the stacked PC points at the immediate word. |
| `SHIFT_ROT` (23) | See below | | memory: 8 + EA(word); register: 6 + 2n, or 8 + 2n for long | |
| `SWAP` (209) | halves of `D[reg]` exchanged | `N_A, GEN, GEN, ZER, ZER` long | 4 | |
| `BIT_OP` (229) | Bit number from `D[n]` (bit 8 set) or from an extension word `& 0xff`. Memory operand: number mod 8, byte; Dn: mod 32, long. `eff_addr(size, DATA_ADDR, true)`. Z = complement of the tested bit. Bits 7-6: 0 BTST, 1 BCHG, 2 BCLR, 3 BSET via `put(EA1, *EA1 ..., size)` | Z only | BTST: memory 4, Dn 6; BCHG 8; BCLR memory 8, Dn 10; BSET 8; plus 4 if memory; + EA | `DATA_ADDR` also admits PC-relative and immediate operands for BCHG/BCLR/BSET. Uses the host-endian `*EA1` trick (1.5). |
| `TAS` (295) | `eff_addr(BYTE, DATA_ALT_ADDR, true)`; flags from `*EA1`; `put(EA1, EV1 \| 0x80, BYTE)` | `N_A, GEN, GEN, ZER, ZER` byte | `(inst & 0x30) ? 10 : 4` + EA | |
| `BIT_FIELD` (316) | `BAD_INST` unless `bitfield`. Extension word: bit 11 offset in `D[(ext>>6)&7]` else `(ext>>6)&0x1f`; bit 5 width in `D[ext&7]` else `ext`; width = `((w-1)&0x1f)+1`. Operation = bits 10-8 of the opcode: 0 BFTST, 1 BFEXTU, 2 BFCHG, 3 BFEXTS, 4 BFCLR, 5 BFFFO, 6 BFSET, 7 BFINS. Register operand when mode is 0, else `eff_addr(BYTE, CONTROL_ADDR, true)` and five byte reads | N = top bit of field, Z = field is 0, V = C = 0, X kept (set directly) | register / memory within 4 bytes / memory over 5 bytes: BFTST 7/12/16; BFEXTU, BFEXTS 8/13/18; BFCHG, BFCLR, BFSET 12/16/24; BFFFO 18/24/32; BFINS 10/15/21 (+ EA for memory) | Patterned on UAE. A register field does not wrap past bit 0. For a field that reaches into the fifth byte the code computes `bf4` but **writes `bf1`** to the fifth byte (`CODE7.CPP:486-488`). BFINS sets Z from the whole source register, not the inserted field. |

`SHIFT_ROT` in detail (`CODE7.CPP:23-205`):
- Memory form (`(inst & 0xc0) == 0xc0`): word, count 1, type = `(inst & 0x600) >> 9`, `eff_addr(WORD, MEM_ALT_ADDR, true)`.
- Register form: size from `decode_size`; count = `(unsigned(D[(inst >> 9) & 7]) & size) % 64` if bit 5 set, else
  bits 11-9 with 0 meaning 8; type = `(inst & 0x18) >> 3`. Type: 0 arithmetic, 1 logical, 2 rotate through X,
  3 rotate. Direction = bit 8 (set = left).
- Count 0: flags `N_A, GEN, GEN, ZER, CASE_1` for type 2 (C = X), `N_A, GEN, GEN, ZER, ZER` otherwise.
- ASL: result = `(EV1 & size) << count` (0 if count >= 32); flags `GEN, GEN, GEN, CASE_4, CASE_9`.
- ASR: one-bit shifts in a loop keeping the sign bit; flags `GEN, GEN, GEN, ZER, CASE_7`.
- LSL: `EV1 << count` (0 if count >= 32); flags `GEN, GEN, GEN, ZER, CASE_9`.
- LSR: `(unsigned)(EV1 & size) >> count` (0 if count >= 32); flags `GEN, GEN, GEN, ZER, CASE_8`.
- ROXL/ROXR: count reduced first - byte: `-36` if >= 36, `-18` if >= 18, `-9` if >= 9; word: `-34` if >= 34, `-17` if
  >= 17; long: `-33` if >= 33 - then one-bit rotations through X; X written to SR; flags `N_A, GEN, GEN, ZER,
  CASE_1` (C = new X). The cycle count uses the unreduced count.
- ROL: loop; flags `N_A, GEN, GEN, ZER, CASE_3`. ROR: loop; flags `N_A, GEN, GEN, ZER, CASE_2`.
- For memory operands every loop iteration is a `mem_put` and a `mem_req`.

**Program control (`CODE8.CPP`, `CODE9.CPP`)**

| Handler | Operation as coded | Cycles | Quirks |
|---|---|---|---|
| `BCC` (23) | 8-bit displacement, or a fetched 16-bit one when the byte is 0; `if (check_condition((inst >> 8) & 0xf)) PC = OLD_PC + disp + 2` | taken 10; not taken 8 (byte) / 12 (word) | A displacement byte of `$FF` is treated as -1 (the 68020 long form does not exist): target is odd. |
| `BRA` (107) | same, unconditional | 10 | |
| `BSR` (128) | `A[a_reg(7)] -= 4`; push `PC`; Step Over hook; `PC = OLD_PC + disp + 2` | 18 | Step Over hook: `if (sstep && stepToAddr == 0) { trace = false; stepToAddr = PC; }` (return address). |
| `DBCC` (54) | Displacement fetched; condition true: nothing; else low word of `D[reg]` decremented; if it became `$FFFF` fall through, else `PC = OLD_PC + disp + 2` | condition true 12; expired 14; branch 10 | |
| `SCC` (81) | `eff_addr(BYTE, DATA_ALT_ADDR, true)`; `put(EA1, 0xFF or 0, BYTE)` | Dn: 6 true / 4 false; memory 8. + EA | |
| `JMP` (158) | `eff_addr(WORD, CONTROL_ADDR, false)`; `PC = EA1 - memory` | (An) 8, d16 10, d8+Xi 14, abs.W 10, abs.L 12, d16(PC) 10, d8(PC,Xi) 14 | **A word is read at the target** (so an odd target faults here, as a read address error with the PC of the JMP), and the new PC is 24-bit. |
| `JSR` (191) | same decode; push `PC`; Step Over hook; `PC = EA1 - memory` | 16, 18, 22, 18, 20, 18, 22 | same |
| `RTE` (233) | `NO_PRIVILEGE` if S clear; `mem_request(&A[8], WORD, &temp); SR = temp; mem_request(&A[8], LONG, &PC)` | 20 | Pops only the 6-byte frame. All 16 SR bits loaded. |
| `RTR` (252) | pop word, `SR = (SR & 0xff00) \| (temp & 0xff)`; pop PC | 20 | |
| `RTS` (269) | `mem_request(&A[a_reg(7)], LONG, &PC)` | 16 | |
| `NOP` (282) | | 4 | |
| `CHK` (143) | `eff_addr(WORD, DATA_ADDR, true)`; `source` = signed bound; `dest = D[reg] & 0xFFFF`; flags; `if ((dest < 0) \|\| (dest > source)) return CHK_EXCEPTION` | 10 + EA (no trap); EA + 44 (trap) | `dest` is never negative, so the test is "unsigned low word of Dn > signed bound". Flags `N_A, GEN, UND, UND, UND`: **Z, V and C are inverted on every CHK**. |
| `ILLEGAL` (171) | `return BAD_INST` | (34 as exception) | |
| `RESET` (180) | `NO_PRIVILEGE` if S clear | 132 | Does nothing else. |
| `STOP` (198) | 3.12 | 4 | |
| `TRAP` (723) | section 6 | 0 if serviced, else 38 as exception | |
| `TRAPV` (1288) | `if (SR & vbit) return TRAPV_TRAP` | 4 (no trap) / 34 | |
| `LINE1010` (1300) | `return LINE_1010` | 34 as exception | |
| `LINE1111` (1307) | SIMHALT test (3.13), else `return LINE_1111` | 34 as exception / 0 for SIMHALT | |

Common to all handlers: signed 32-bit host arithmetic is used for 68000 arithmetic (`source + dest` and so on),
relying on two's-complement wrap-around (HAZARD 11.3).

### 3.17 Condition codes: `cc_update` and `check_condition` (`UTILS.CPP:650-858`)

`cc_update(x, n, z, v, c, source, dest, result, sizeMask, shiftCount)` masks `source`, `dest`, `result` with
`sizeMask`, takes `Sm`, `Dm`, `Rm` = their most significant bits at that size, computes each flag by the method
code given, then rewrites SR bits 4-0 (`SR = SR & 0xffe0;` then sets). Evaluation order is N, Z, V, C, X.

| Flag | Code | Meaning |
|---|---|---|
| any | `N_A` (0) | unchanged |
| N, V, C | `ZER` (2) | cleared (there is no `ZER` case for Z or X) |
| N, Z, V, C | `UND` (3) | **inverted** (`bit = !bit`) |
| N | `GEN` | `Rm` |
| Z | `GEN` | `result == 0` |
| Z | `CASE_1` | `old Z && result == 0` |
| V | `CASE_1` | `(Sm && Dm && !Rm) \|\| (!Sm && !Dm && Rm)` (add) |
| V | `CASE_2` | `(!Sm && Dm && !Rm) \|\| (Sm && !Dm && Rm)` (subtract) |
| V | `CASE_3` | `Dm && Rm` (negate) |
| V | `CASE_4` | ASL: `mask = (~((unsigned)sizeMask >> shiftCount+1)) & sizeMask;  if (shiftCount > (size-1) & source) v = true; else v = !(((mask & source) == 0) \|\| ((mask & ~source) == 0));` |
| C | `CASE_1` | `x_bit` as read at entry (ROXL/ROXR, after X was updated) |
| C | `CASE_2` | ROR: `if (shiftCount > size) shiftCount %= size; if (shiftCount == 0) shiftCount = size; c = (dest >> (shiftCount-1)) & 1` |
| C | `CASE_3` | ROL: `shiftCount %= size; c = shiftCount == 0 ? dest & 1 : (dest >> (size-shiftCount)) & 1` |
| C | `CASE_4` | `Dm \|\| Rm` (negate) |
| C | `CASE_5` | `(Sm && Dm) \|\| (!Rm && Dm) \|\| (Sm && !Rm)` (add) |
| C | `CASE_6` | `(Sm && !Dm) \|\| (Rm && !Dm) \|\| (Sm && Rm)` (subtract) |
| C | `CASE_7` | ASR: `if (shiftCount > size) shiftCount = size; c = (dest >> (shiftCount-1)) & 1` |
| C | `CASE_8` | LSR: `shiftCount > size ? 0 : (dest >> (shiftCount-1)) & 1` |
| C | `CASE_9` | ASL, LSL: `shiftCount > size ? 0 : (dest >> (size-shiftCount)) & 1` |
| X | `GEN` | the C just computed |

Any other code for a flag (for example `CASE_9` passed for V by `MULS`) leaves that flag unchanged.

Two expressions in `CASE_4` (V of ASL) do not mean what they appear to mean; the port must keep them as written:
- `shiftCount > (size-1) & source` parses as `(shiftCount > (size-1)) & source`: true only when the count is at
  least the operand size **and bit 0 of the source is 1**.
- `(unsigned)sizeMask >> shiftCount+1` is a shift by `shiftCount+1`, which reaches 32..64 for counts 31..63. On x86
  the shift count is taken modulo 32, so for example count 40 on a word shifts `0xFFFF` right by 9 and yields
  `mask = 0xFF80` instead of `0xFFFF`. The resulting V values are wrong compared with a real 68000 but are what
  EASy68K produces. HAZARD 11.3.

`check_condition(condition)` implements the 16 standard tests on SR (T, F, HI, LS, CC, CS, NE, EQ, VC, VS, PL,
MI, GE, LT, GT, LE) exactly as on a 68000; the result is used only as true/false.

Helper semantics: `sign_extend(number, size_from, &result)` extends byte to **word** (`|= 0xff00`) or word to
long (`|= 0xffff0000`) - a byte needs two calls to reach a long. `from_2s_comp(number, size, &result)` converts an
unsigned bit pattern of the given size into a signed host value.

---

## 4. Options and state that change core behaviour

| Variable | Type | Default | Set by | Persisted in `sim68K.dat`? | Effect |
|---|---|---|---|---|---|
| `exceptions` | `int` | false (`SIM68Ku.cpp:1495`) | Options > Enable Exceptions toggles it and saves settings (`SIM68Ku.cpp:1271-1281`); command line `/e` (`1231-1233`); TRAP #15 task 32 with D1.B = 5 sets it true, checks the menu item and **saves settings** (`CODE9.CPP:924-928`); settings file line `1$exceptions` (`1588-1592`) | yes | Selects path (a) or (b) of 3.4 step 9 and the two branches inside `mem_req`, `mem_put`, `memoryMapCheck`. When false: no vectors, no interrupts, every exception halts with a message. |
| `bitfield` | `bool` | false (`1496`) | Options > Enable Bit Field Instructions (`2037-2047`); `/b`; listing directive `*[sim68k]bitfield` (set only, `330-333`); settings line `1$bit field enabled` (`1993-1997`) | yes | `BIT_FIELD` returns `BAD_INST` when false (`CODE7.CPP:326-327`). |
| `simhalt_on` | `bool` | true (`1497`) | set true by every `OpenFile` (`285`); `*[sim68k]simhalt_off` sets false (`334-336`) | no | When false, `$FFFF $FFFF` is an ordinary line-F opcode. Not reset by Rewind. |
| `ROMMap`, `ReadMap`, `ProtectedMap`, `InvalidMap` and the eight range variables | `bool` / `int` | false / 0 (`hardwareu.cpp:32-34`) | Hardware window; S0 records (2.4) | no | Section 5. Never cleared by loading or reset. |
| `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc` | `int` | `$E00000`, `$E00010`, `$E00012`, `$E00014` | Hardware window; settings file | yes | Addresses exempt from the memory map; display refresh trigger. |
| `hardwareEnabled` | `bool` | true (`hardwareu.cpp:1322`) | `Hardware->enable()` (in `initSim`, and on input completion in trace mode) / `disable()` (SIMHALT, task 9, `haltSimulator`, STOP without exceptions) | no | Interrupt requests and the Reset button are ignored when false. |
| displayed SR text | GUI state | follows `scrshow()` | `scrshow()`, user typing | no | Supervisor test of the Protected range (5.4). |
| `trace`, `sstep`, `runMode`, `stepToAddr`, `runToAddr` | | false / 0 | run commands (3.1), `BSR`/`JSR`, breakpoints | no | Run control. |
| `stopInstruction` | `bool` | false | 3.12 | no | Changes interrupt-request and pause behaviour after the first STOP. |
| `logging`, `ElogFlag`, `logMemAddr`, `logMemBytes` | | false / 0 | Log window, Log Start/Stop | `ElogFlag`, `OlogFlag` yes | Section 8. |
| auto-trace interval; "Disable display update" | GUI | 200 ms; off | Options > Auto Trace Options | yes | Rate of timer-driven Trace Into; whether `scrshow()` also repaints listing, stack and memory (`STARTSIM.CPP:168-174`). |
| `keyboardEcho`, `inputPrompt`, `inputLFdisplay`, `disableKeyCommands` | `bool` | true, true, true, false | TRAP #15 tasks 12, 16, 24; `initSim` | no | Text I/O (other specification). |
| `breakPoints[]`, `bpExpressions[]`, `brkpt[]` and their counts | | empty | Breakpoint window, listing gutter, `*[sim68k]break` | no | Section 7. |

Settings-file format for the two boolean options: the line is the digit `0` or `1` immediately followed by the
key text (`0$exceptions`, `0$bit field enabled`); a line is honoured only if the key text matches exactly.

There is no option for the memory size, the reset stack pointers, the `$FF` fill value or CPU model.

---

## 5. Memory access rules

### 5.1 Address space

24-bit, `$000000`-`$FFFFFF`, all RAM by default. The upper 8 bits of any address are ignored
(`loc & ADDRMASK`). There is **no** bus error for "outside memory": the test `loc < 0 || loc > MEMSIZE-1` in
`memoryMapCheck` (`UTILS.CPP:256`) can never be true because every caller masks first. The help text claims
otherwise (section 12).

### 5.2 Address error

Any word or long access (read or write) at an odd address, tested on the unmasked 32-bit address
(`UTILS.CPP:352, 427`). Byte accesses never fault. Instruction fetch is a word read, so an odd PC faults.

### 5.3 The four configurable ranges

Each has an enable flag and inclusive start/end addresses (six hex digits, so at most `$FFFFFF`), set in the
Hardware window or by S0 records. Rules, in the order they are tested:

| Step | Read (`mem_req`) | Write (`mem_put` via `memoryMapCheck`) |
|---|---|---|
| 0. Hardware address | `loc` (first byte only) in `seg7loc..seg7loc+15`, or equal to `LEDloc`, `switchLoc`, `pbLoc`: **all map tests skipped** | same |
| 1. Invalid | first byte inside the range: bus error | access `[loc, loc+bytes-1]` overlaps the range: bus error |
| 2. Protected | first byte inside and displayed S bit is 0: bus error | overlaps and displayed S bit is 0: bus error |
| 3. Read | not tested (readable) | overlaps: bus error |
| 4. ROM | not tested (readable) | overlaps: the write is **silently discarded**, `mem_put` returns `SUCCESS`, no flags or display hooks |

A "bus error" is: exceptions enabled - load `PC` from `$08`, push a 14-byte frame with the masked address and
the R/W bit always saying "write" (even for a read; QUIRK); exceptions disabled - `haltSimulator()` and the message
`Bus Error: Instruction at %4x accessing address %4x`.

Accesses that bypass the map and the error checks entirely: the S-record loader, the memory fill at load, the
Memory window's editing/copy/fill, the Hardware window's switch and push-button writes, the byte reads made by
the display code, `strncpy`/`strlen`/pointer passing of `&memory[A1 & ADDRMASK]` in TRAP #15 tasks (those tasks
call `memoryMapCheck(Invalid, ...)` explicitly first, section 6.3).

### 5.4 The Protected range tests the *displayed* SR, not `SR` (QUIRK)

The supervisor test is `Form1->regSR->EditText[3] == '0'` (`UTILS.CPP:287, 469`): the third character of the
16-digit binary SR text box, i.e. bit 13 as last **displayed**. That text is written only by `scrshow()`
(`STARTSIM.CPP:157-166`) and by the user. `scrshow()` runs at: `initSim`; the end of any step that stops
(`RUN.CPP:705`); the first STOP (`RUN.CPP:900`) and STOP without exceptions (`RUN.CPP:956`); Pause
(`SIM68Ku.cpp:534`); the hardware Reset button (`hardwareu.cpp:789`); completion of a keyboard read while `trace` is
set (`simIOu.cpp:1369`). During a free run the text is frozen at the value it had when Run was pressed. So a
program that switches to user mode while running can still access a Protected range, and one started in user mode
keeps faulting there even inside its supervisor-mode handlers. When single-stepping, the text is refreshed after
every instruction and the check follows the true S bit as of the end of the previous instruction.
The port must keep a "displayed SR" shadow that is updated at exactly these points (10.3).

### 5.5 Hooks for memory-mapped hardware

- **Output devices (7-segment display, LEDs):** the only hook is at the end of a successful `mem_put`:
  `Hardware->updateIfNeeded(loc); MemoryFrm->LivePaint(loc);` (`UTILS.CPP:396-397`). `updateIfNeeded(adr)` redraws
  the devices when `adr` is in `seg7loc-4 .. seg7loc+15` or `LEDloc-4 .. LEDloc` (`hardwareu.cpp:204-212`). The data
  itself is ordinary memory; the display code reads `memory[]` directly.
- **Input devices (switches, push buttons):** the Hardware window writes the byte at `switchLoc` / `pbLoc` directly
  into `memory[]` when the user clicks (`hardwareu.cpp:66-192, 994-1290`). There is **no read hook**: the program
  simply reads memory.
- Writes that bypass `mem_put` (list in 5.3) do not trigger the hook.
- `readEA`/`bpRead` and `writeEA`/`bpWrite` (breakpoint support) are updated at the same two points
  (`UTILS.CPP:394-395, 496-497`).

---

## 6. TRAP handling in the core

### 6.1 Dispatch (`CODE9.CPP:723-1283`)

```cpp
vector = inst & 0x0F;
if(vector == 15) {
  switch ((char)D[0]) {  ... case labels ...   default: return (TRAP_TRAP); }
  return SUCCESS;
} else
  return (TRAP_TRAP);
```

- **`TRAP #15` is intercepted unconditionally.** The decision between "simulator service" and "the program's own
  vector" depends only on the low byte of D0: if it equals one of the `case` labels the simulator performs the
  task and the instruction returns `SUCCESS` - the vector at `$BC` is never consulted, whether or not exceptions
  are enabled and whatever the vector contains. There is no way for a program to take over a serviced task.
- Task numbers with a `case` label (enumerated from the source): 0-25, 30-33, 40-43, 50-59, 60-62, 70-77, 80-96,
  100-107. `(char)D[0]` is a signed char, so D0.B values `$80-$FF` are negative and match nothing.
- Any other D0.B, and every `TRAP #0` .. `TRAP #14`, returns `TRAP_TRAP`: with exceptions enabled, an ordinary
  TRAP exception through vector `$80 + 4n` (38 cycles, return address = the instruction after the TRAP); with
  exceptions disabled, halt with `TRAP exception occurred at location %4x. Execution halted`.
- No other TRAP number has special treatment.
- A serviced task adds no cycles and does not change SR.

### 6.2 Tasks that touch core state directly

| Task | Core effect | Lines |
|---|---|---|
| 2, 4, 5, 18 | Start a keyboard read: `simIO->textIn(...)` / `charIn(...)` set `inputMode = true` and return; the result is written later by the key handler into `D[1]` and/or memory (through `mem_put`). Task 5 returns immediately if `pendingKey` is set. | 750-763, 856-864 |
| 7 | `D[1]` low byte = 1 if `pendingKey` else 0. | 767-774 |
| 8 | `D[1]` = hundredths of a second since local midnight (`gettime`). | 775-782 |
| 9 | Halt (3.13). | 783-789 |
| 12, 16 | `keyboardEcho`, `inputPrompt`, `inputLFdisplay`. | 807-812, 832-841 |
| 23 | Delay loop - a **blocking wait inside the instruction** (section 9.3). Skipped entirely when `runMode` is false (Trace Into). | 879-885 |
| 24 | `Form1->restoreMenuTask19()` / `setMenuTask19()` (`disableKeyCommands`). | 886-892 |
| 30, 31 | `cycles = 0`; `D[1] = cycles > 0xFFFFFFFF ? 0 : (uint)cycles`. | 897-905 |
| 32 | D1.B: 0 show Hardware window; 1, 2, 3, 7 return the device addresses (parsed from the Hardware window's text boxes); 4 `D[1] = VERSION`; 5 `exceptions = true` + save settings; 6 `Hardware->setAutoIRQ((uchar)D[2], D[3])`. | 906-936 |
| 60, 62 | `mouseDownIRQ`, `mouseUpIRQ`, `mouseMoveIRQ`, `keyDownIRQ`, `keyUpIRQ` (level in D1 bits 15-8, ignored if > 7; event bits in D1 bits 2-0). | 1066-1076, 1131-1139 |
| 61 | Reads the mouse-state globals into `D[0]`, `D[1]`. | 1077-1128 |
| 50-59 | File functions in `SIMOPS2.CPP` (6.4). | 987-1063 |

Everything else calls into the I/O window object (`simIO->...`); those semantics belong to the I/O
specifications. The complete list of call sites is in section 9.1.

### 6.3 Memory-map check inside tasks

Tasks that take a string or buffer at `(A1)` call `memoryMapCheck(Invalid, A[1] & ADDRMASK, length)` first and
`return code` when it is `BUS_ERROR` (`CODE9.CPP:741, 793, 816, 847, 859, 959, 980, 995, 1005, 1029, 1046, 1059,
1146, 1156, 1169, 1179, 1243`); task 53 uses `Invalid | Read | Rom` and skips the read on `ROM_MAP` (`1016-1020`).
`TRAP` then returns `BUS_ERROR` to `exec_inst`: with exceptions enabled the bus-error frame has already been
pushed; with exceptions disabled the messages are `Bus Error: Instruction at ...` and `Execution halted`.
Only the Invalid range is tested (never Protected); lengths come from `strlen` on simulator memory.

### 6.4 File primitives (`SIMOPS2.CPP:30-190`)

`files[0..7]` hold `FILE *`; the 68000 file number is the array index. Results are written through
`(short *)&D[0]` (low word of D0 only).

| Function | Behaviour |
|---|---|
| `closeFiles(short *result)` | `fclose` every non-NULL entry and set it NULL; `F_SUCCESS`, or `F_ERROR` if any `fclose` returned `EOF`. |
| `fileOp(long *mode, char *fname, short *result)` | `mode` is ignored. `fopen(fname, "r+b")` succeeds -> `F_SUCCESS`; else `fopen(fname, "rb")` succeeds -> `F_READONLY`; else `F_ERROR`. Then **`fclose(fp)` is called unconditionally, with `fp == NULL` when the file does not exist** (HAZARD 11.5). |
| `openFile(long *fn, char *fname, short *result)` | `*result = F_ERROR; *fn = -1;` For each free slot in order: try `"r+b"` (-> `F_SUCCESS`), then `"rb"` (-> `F_READONLY`); on success store the name (`strcpy` into `char[256]`) and `*fn = i`. If the file cannot be opened the result stays `F_ERROR` after trying every free slot. |
| `newFile(long *fn, char *fname, short *result)` | Same with `fopen(fname, "w+b")` (create/truncate). |
| `readFile(long fn, char *buf, unsigned int *size, short *result)` | Invalid `fn` or NULL slot -> `F_ERROR`. `r = fread(buf, 1, *size, fp)`. `r < 1`: `F_EOF` if `feof`, else `F_ERROR`, and `*size` is **not** updated. Otherwise `F_SUCCESS` and `*size = r` (a short read at end of file is a success). |
| `writeFile(long fn, char *buf, unsigned int size, short *result)` | `r = fwrite(buf, size, 1, fp)`; `F_SUCCESS` if `r >= 1`. **A zero-length write returns `F_ERROR`.** |
| `positionFile(long fn, int offset, short *result)` | `fseek(fp, offset, SEEK_SET) == 0` -> `F_SUCCESS`. |
| `closeFile(long fn, short *result)` | `fclose`; slot set NULL; `F_SUCCESS` if `fclose` returned 0. |
| `deleteFile(char *fname, short *result)` | `remove(fname) == 0` -> `F_SUCCESS`. |

`buf` is `&memory[A[1] & ADDRMASK]`: file data is transferred directly to and from simulator memory with no
per-byte checks, breakpoint flags or display refresh. Paths are whatever the 68000 program supplies, relative
to the process's current directory.

---

## 7. Breakpoints

### 7.1 Simple (PC) breakpoints

- Data: `int brkpt[100]`, count in `char bpoints`.
- Set: `TBreaksFrm::sbpoint(int loc)` (`BREAKPOINTSu.cpp:112-129`): ignored if already present; appended if
  `bpoints < 100`, else a message box `Breakpoint Limit Reached!`.
- Clear: `cbpoint(int loc)` (`BREAKPOINTSu.cpp:132-156`): `loc == -1` clears all; otherwise the entry is removed
  and the rest shifted down. If `loc` is not in the table the count is still decremented (bug; callers always
  check first).
- Sources: clicking the listing gutter, `*[sim68k]break`, "Clear All PC Breakpoints". File > Open and File >
  Close clear them all; Reload and Rewind keep them.
- Test: `runprog` step 5 - after each instruction, `PC == brkpt[i]`. The comparison is on the full 32-bit PC.
  Effect: message `break point at %04x`, `trace = true`, auto-trace timer off. The instruction *at* the
  breakpoint has not executed. A breakpoint at the address where execution starts does not trigger for that
  first instruction.
- Run To Cursor uses `runToAddr` the same way but silently and once (3.3 step 6).

### 7.2 Break conditions: `class BPoint` (`BPoint.h:22-61`, `BPoint.cpp`)

Fields: `int id; int type; long typeId; int op; long value; int readWrite; long size; bool isEnab;`
`breakPoints[0..49]` are PC/register conditions (`type = PC_REG_TYPE`), `breakPoints[50..99]` memory conditions
(`type = ADDR_TYPE`). The constructor sets only `isEnab = false`.

`bool BPoint::isBreak()` (`BPoint.cpp:112-205`):

1. `if (!isEnab) return false;`
2. Locate the operand:
   - `PC_REG_TYPE`, `typeId` 0-7: `curEA = &D[typeId]`; `typeId` 8-15: `curEA = &A[typeId - 8]`.
     **`typeId` 15 (A7) is always `A[7]`, the user stack pointer**, even in supervisor mode (QUIRK).
     `typeId` 16 is the PC.
   - `ADDR_TYPE`: `curEA = (long *)&memory[typeId]` (the address is **not** masked here), then the access test:
     ```cpp
     if (bpRead && curEA == readEA) read = true;
     else if (bpWrite && curEA == writeEA) write = true;
     switch (readWrite) { RW_TYPE: read || write;  READ_TYPE: read;  WRITE_TYPE: write;  NA_TYPE: true;  default: false; }
     ```
     If the access test fails, return false.
3. `curSize` = `BYTE_MASK`, `WORD_MASK` or `LONG_MASK` for `size` 0, 1, 2 (uninitialised for any other value).
4. Value: for the PC, `valueFound = PC & curSize`; otherwise `value_of(curEA, &valueFound, curSize)`.
5. Compare with `value` using `op`: `==`, `!=`, `>`, `>=`, `<`, `<=` on **signed** `long`s, `NA_OP` -> true,
   anything else -> false.

Consequences the port must reproduce:
- `readEA` / `writeEA` hold only the address of the **last** read and the **last** write of the instruction (the
  starting address of the access, after masking). A read condition on address X triggers only if X was the last
  address read. Many handlers make further reads after the operand access (`MOVE`, the arithmetic and logic
  instructions with a memory destination, `CLR`, `NEG`, `NOT` and the shifts re-read the destination after
  writing it with `value_of`; `LINE1111` peeks the following word), so the "last read"
  is often not what a user expects: for example `MOVE.W D0,X` makes X the last **read** address as well as the
  last write address. In single-step mode `exec_inst` also reads the word after the opcode *before* the handler
  runs (`RUN.CPP:772`); for an instruction that reads no memory of its own, the last read address is therefore
  the opcode address + 2 when tracing but the opcode (or last extension word) address when running, and a read
  condition can trigger in one mode and not in the other.
- **A location that was both the last read and the last write is never a "write".** The access test is
  `if (bpRead && curEA == readEA) read = true; else if (bpWrite && curEA == writeEA) write = true;` - the `else`
  means `write` stays false whenever the address is also the last read address. Because `MOVE`, the
  arithmetic/logic instructions with a memory destination, `CLR`, `NEG`, `NOT` and the shifts read the destination
  (before and/or after writing it), a `WRITE_TYPE` condition on their destination **never fires**; `RW_TYPE` and
  `READ_TYPE` do. A write-only condition fires only when the address is the **last** address written by the
  instruction and was not also the last one read - for example the return address pushed by `BSR`/`JSR`
  (confirmed by test: `engine/sim/test/debug.test.mjs`).
- `bpRead` is true after every instruction (the opcode fetch is a read).
- For a memory condition, step 4 calls `mem_req`. It therefore (a) sets `readEA = &memory[X]` and `bpRead = true`,
  so a second condition on the same address evaluated later in the same step sees a "read"; and (b) can raise
  an **address error** (word or long size at an odd address) or a bus error, with full exception processing or
  halt, from inside the breakpoint test.
- A memory condition with an address above `$FFFFFF` can never satisfy a read/write test (the recorded pointers
  are always inside the 16 MB array) but its value is read from the masked address.

> **Corrected (erratum U3 3).** Fields left open: `id` is never read by `BPoint::isBreak` (the port sends the condition's 0-based row); a register condition's `readWrite` is never set (the port sends 0); a freed slot is sent disabled with zero fields (an expression with an empty postfix), then the counts. The grids allow 49 rows (50 including the header, as the original's).

### 7.3 Break expressions: `class BPointExpr` (`BPointExpr.h:22-52`, `BPointExpr.cpp`)

Fields: `int id; int postfix_expr[10]; int infix_expr[10]; int p_count; int i_count; AnsiString expr; int count;
bool isBrk; bool isEnab;`. Tokens: `0..99` = index into `breakPoints[]`; `100` = AND (`MAX_BPOINTS + AND_OP`);
`101` = OR; `102`/`103` = parentheses (infix form only).

`bool BPointExpr::isBreak()` (`BPointExpr.cpp:97-151`):

1. `if (!isEnab) return false;`
2. Evaluate `postfix_expr[0..p_count-1]` with a `stack<bool>`: an operand token pushes
   `breakPoints[token].isBreak()`; any other token pops two values and pushes their AND (token 100), OR (token
   101) or `false` (anything else). **Every operand is evaluated; there is no short circuit.**
3. `isBrk` = top of stack.
4. Hit counting:
   ```cpp
   if(isBrk) bpCountCond[id]++;
   isBrk = (count == bpCountCond[id]);
   if(isBrk) bpCountCond[id] = 0;          // Reset counter for next iteration.
   return isBrk;
   ```
   The break happens when the number of steps on which the expression was true reaches `count`; the counter then
   restarts. `count == 0` breaks on every step until the expression is first true and never afterwards (QUIRK).
   `bpCountCond[]` is zeroed by Run (`resetDebug`, `BREAKPOINTSu.cpp:161-165`) but not by Step, Trace, Rewind or
   Reload.

Test point: `runprog` step 7, for `i` in `0..exprCount-1`, every step, in every mode (Run, Step, Trace, Auto
Trace). A register or memory condition that is not referenced by an enabled expression has no effect.

How the editor fills these structures is the breakpoint window's concern (`BREAKPOINTSu.cpp`); three facts
matter for exact behaviour and are recorded here: `id` is the 1-based row number (`BREAKPOINTSu.cpp:464`); the
count field is parsed as **hexadecimal** (`StrToInt("0x" + text)`, `BREAKPOINTSu.cpp:468`; the default text is
`01`); and the infix-to-postfix conversion (`BREAKPOINTSu.cpp:471-509`) never removes a `(` from its operator stack
until the end, so an operator that follows a parenthesised group does not pop lower entries - for example
`R1 AND (A1 OR A2) OR R2` becomes `R1 A1 A2 OR R2 OR AND`, i.e. `R1 AND ((A1 OR A2) OR R2)`.

---

## 8. Execution logging at the core level

### 8.1 When something is logged

Everything is inside `if (trace)` in `exec_inst` (`RUN.CPP:771-845`), then `if (logging)`. Therefore only
instructions executed in single-step mode are logged: Trace Into, Auto Trace, and the instructions Step Over
executes itself (not the body of a stepped-over subroutine, during which `trace` is false). A free Run writes
nothing per instruction. Records are written **before** the instruction executes, so they show the state before
it.

`logging` becomes true on Log Start and false on Log Stop, SIMHALT, task 9, `haltSimulator()`, STOP without
exceptions, opening a program with File > Open, drag-and-drop or the command line (`Log->setLogFileNames`,
`logU.cpp:59-66`; not on Reload or Rewind), or exit. Log Start, the file names (`<program>_RunLog.txt`), the
Replace/Append/Cancel dialog and the header line `EASy68K execution log file: <date time>` followed by a blank
line (`logU.cpp:140`) are UI behaviour (`sim-ui.md`). The file is opened in **text mode** (`"wt"` / `"at"`,
`logU.cpp:120-130`), so on Windows every `\n` below is written as CR LF.

### 8.2 Per-instruction record, in order

`ElogFlag` values: 1 = instruction only, 2 = instruction and registers, 3 = instruction, registers and memory.

1. **Memory dump** - only `if (ElogFlag == INST_REG_MEM)`:
   - `"\n"`
   - for each of `logMemBytes/16` rows starting at `addr = logMemAddr`:
     - `"%08X: "` with `addr` (or `"%08X: Invalid Address"` if `addr < 0 || addr >= MEMSIZE`);
     - 16 times `"%02hX "` with `(unsigned char)memory[(addr+i) & ADDRMASK]` (or `"xx "` if `addr+i >= MEMSIZE`);
     - 16 characters: the byte itself (`"%hc"`) if `memory[(addr+i) & ADDRMASK] >= ' '`, else `"-"`. The comparison
       is on a **signed** char, so bytes `$80-$FF` print as `-` and `$7F` prints as itself;
     - `"\n"`; `addr += 16`.
2. **Registers** - only `if (ElogFlag == REGISTERS || ElogFlag == INST_REG_MEM)`:
   ```
   "\n"
   "D0=%08lX D4=%08lX A0=%08lX A4=%08lX    T_S__INT___XNZVC\n"      D[0], D[4], A[0], A[4]
   "D1=%08lX D5=%08lX A1=%08lX A5=%08lX SR="                        D[1], D[5], A[1], A[5]
   16 characters '1' or '0': SR bit 15 first
   "\nD2=%08lX D6=%08lX A2=%08lX A6=%08lX US=%08lX\n"               D[2], D[6], A[2], A[6], A[7]
   "D3=%08lX D7=%08lX A3=%08lX A7=%08lX SS=%08lX\n"                 D[3], D[7], A[3], A[a_reg(7)], A[8]
   ```
3. **Instruction** - `if (ElogFlag)`: `if (Form1->lineToLog() == false) { fprintf(ElogFile, buffer); fprintf(ElogFile,
   "\n"); }` then `fflush(ElogFile)`. `buffer` is the trace message of 3.4 step 5:
   `PC=%08X  Code=%04X  <name padded to 12>` or `PC=%08X  Code=%04X  SIMHALT`.

Example of one type-2 record (line breaks as written):
```

D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC
D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000
D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000
D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000
PC=00001000  Code=43F9 00001018          Line=    9      LEA     MESSAGE,A1
```
(The last line was derived by applying the three insertions of 8.3 to the listing line
`00001000  43F9 00001018              9      LEA     MESSAGE,A1`; it was not captured from a run of the original.)

### 8.3 The source line: `TForm1::lineToLog()` (`SIM68Ku.cpp:869-909`)

The lookup key is the **PC text box** (`regPC->EditText`), which in trace mode holds the address of the
instruction about to execute (`PC` itself has already been advanced by the fetch).

1. `botIndex = ListBox1->Count; topIndex = 3;` only if `Count > 3`.
2. Binary search comparing the key with the first 8 characters of line `midIndex = (botIndex - topIndex) / 2 +
   topIndex` as strings: equal -> found; key smaller -> `botIndex = midIndex - 1`; else `topIndex = midIndex + 1`;
   repeat `while (!foundPC && topIndex <= botIndex)`.
3. If found: advance while the following line has the same first 8 characters, and use the **last** such line.
   Then three insertions on a copy of the line, in this order: `"PC="` at the start; `"Code="` at character 14;
   `"Line="` at character 42. Starting from the listing layout (address in columns 1-8, object code from column
   11, six-character line number in columns 33-38, source from column 41) the result is
   `PC=` + address + two spaces + `Code=` + object code field + first character of the line-number field + `Line=`
   + the other five characters of the line number + two spaces + source text.
4. The line is written with **`fprintf(ElogFile, str.c_str())`** - the listing line is used as the format string
   - then `"\n"`, then `fflush`. Returns `foundPC`.

Notes: the listing is not strictly sorted by its first 8 characters (header lines, the symbol table, error
lines), so the binary search can miss a line that exists; then the short `PC= Code= name` form is written
instead. If the search runs off the end (`Strings[Count]`) a VCL exception is thrown, which is caught by
`exec_inst` (3.4 step 10) - the instruction is then **not executed**, although its opcode has been fetched.
A source line containing `%` (very common: binary constants such as `#%1010`) is interpreted by `fprintf`
(HAZARD 11.7).

Other texts written to the execution log: `Log->addMessage("\n***** Reset Program Pressed *****\n")` on Rewind and
`"\n***** Reload Program Pressed *****\n"` on Reload (`SIM68Ku.cpp:548, 1369`).

---

## 9. Inventory of VCL / Windows / GUI coupling

Classes: **(a)** UI refresh or UI state change that can become a host callback or a no-op; **(b)** blocking wait
or nested message loop that must become an asynchronous boundary; **(c)** I/O that needs a host API; **(d)**
reading a GUI setting. "(a)+state" means the call also stores state that the core later depends on, so the state
must move into a core variable.

Global objects referenced: `Form1` (main window), `simIO` (I/O window), `Hardware`, `MemoryFrm`, `StackFrm`,
`BreaksFrm`, `Log`, `AutoTraceOptions`, `Application`. The message area is `Form1->Message` (a `TMemo`).

### 9.1 Call sites

**`RUN.CPP`**

| Line(s) | Code | What it does | Class |
|---|---|---|---|
| 22-25, 29 | `#include "SIM68Ku.h"`, `"simIOu.h"`, `"hardwareu.h"`, `"logU.h"`; `extern AnsiString str;` | VCL form headers and string type | build |
| 647 | `Application->ProcessMessages();` | message pump after every instruction | (b) |
| 649 | `Sleep(10);` | idle while waiting for keyboard input | (b) |
| 654 | `Form1->Message->Lines->Add("Address or Bus error during exception processing. Execution halted")` | message | (a) |
| 661, 680 | `Form1->Message->Lines->Add(str.sprintf("break point at %04x", PC))` | message | (a) |
| 663, 671, 682, 894, 951, 1009, 1045, 1123 | `Form1->AutoTraceTimer->Enabled = false;` | stop auto trace | (a)+state (`setMenuActive` reads it) |
| 700 | `Hardware->autoIRQoff();` | stop auto-interrupt timers | (a)+state (`autoIRQ`) |
| 701 | `simIO->fullScreen && Form1->Monitor->MonitorNum == FullScreenMonitor` | is the I/O window full screen on this monitor? | (d) |
| 702-703 | `simIO->fullScreen = false; simIO->setupWindow();` | leave full screen when stopping | (a) |
| 705, 900, 956 | `scrshow();` | refresh register display (and displayed SR) | (a)+state |
| 708, 710 | `Form1->setMenuTrace();` / `Form1->setMenuActive();` | enable/disable commands | (a) |
| 716, 899, 955 | `Form1->SetFocus();` | bring main window forward | (a) |
| 756, 1008 | `try { ... } catch( ... )` | C++/SEH exception barrier | build |
| 777 | `Form1->Message->Lines->Add(buffer);` | trace line for every traced instruction | (a) |
| 786-832, 839-842 | `fprintf(ElogFile, ...)`, `fflush(ElogFile)` | execution-log writes | (c) |
| 838 | `Form1->lineToLog()` | reads the PC text box and the listing lines, writes the log | (d) + (c) |
| 898 | `Form1->Message->Lines->Add("STOP instruction. Execution halted")` | message | (a) |
| 939-991 (13 sites), 997 | `Form1->Message->Lines->Add(str.sprintf(...))` | halt messages of 3.4 step 9b | (a) |
| 954, 1127 | `Log->stopLogWithAnnounce();` | modal box `Current Log Stopped.` then close log | (b) + (c) |
| 957, 1126 | `Hardware->disable();` | hardware off, buttons greyed | (a)+state (`hardwareEnabled`, `autoIRQ`) |
| 1011 | `Application->MessageBox(buffer, "Error", MB_OK);` | modal error box | (b) |
| 1041, 1046, 1048 | `AnsiString str;` two `Message->Lines->Add` | SSP error messages | (a) |

**`UTILS.CPP`**

| Line(s) | Code | What it does | Class |
|---|---|---|---|
| 21-23 | `#include "SIM68Ku.h"`, `"hardwareu.h"`, `"Memory1.h"` | form headers | build |
| 248, 341, 423 | `AnsiString str;` | scratch for messages | build |
| 262, 278, 293, 308, 460, 475 | `Form1->Message->Lines->Add(str.sprintf("Bus Error: Instruction at %4x accessing address %4x", OLD_PC, loc))` | message | (a) |
| 360, 436 | same with `"Address Error: Instruction at %4x accessing address %4x"` | message | (a) |
| 287, 469 | `Form1->regSR->EditText[3] == '0'` | **reads the displayed SR text** to decide supervisor mode | (d) |
| 261, 277, 292, 307, 359, 435, 459, 474 | `haltSimulator();` | leads to `RUN.CPP:1123-1127` | (a) + (b) |
| 396 | `Hardware->updateIfNeeded(loc);` | redraw 7-segment/LEDs after a write | (a) |
| 397 | `MemoryFrm->LivePaint(loc);` | redraw one row of the Memory window after a write | (a) |
| 875 | `const byte *b = (byte *) n;` | Windows `byte` typedef (in unused `flip`) | build |

**`STARTSIM.CPP`**

| Line(s) | Code | What it does | Class |
|---|---|---|---|
| 17-18, 20-26 | `<iostream.h>`, `<conio.h>`, seven form headers | | build |
| 37 | `Form1->AutoTraceTimer->Enabled = false;` | | (a)+state |
| 39-45 | `simIO->clear(); setWindowSize(0,0); setDrawingMode(4); setDrawingMode(16); setPenWidth(1); setLineColor(clWhite); setFillColor(clBlack);` | reset the I/O window | (c) |
| 46-47 | `simIO->BackBuffer->Canvas->Font->Assign(Form1->FontDialogSimIO->Font); simIO->Font->Assign(...)` | apply output font setting | (d) + (a) |
| 49-51 | `ListBox1`, `HeadingsLbl`, `Message` fonts from `FontDialogSource` | apply listing font setting | (d) + (a) |
| 70 | `scrshow();` | | (a)+state |
| 80, 84 | `Hardware->autoIRQoff();` `Hardware->enable();` | timers, `hardwareEnabled = true`, `autoIRQ` | (a)+state |
| 83 | `Form1->setMenuActive();` | | (a) |
| 122 | `simIO->ResetSounds();` | stop and unload sounds | (c) |
| 124 | `Form1->restoreMenuTask19();` | restore shortcuts, `disableKeyCommands = false` | (a)+state |
| 126 | `netCloseSockets();` | close sockets | (c) |
| 132-151 | `Form1->regD0->Text = str.sprintf("%08lX", D[0]);` ... `regPC` (19 text boxes: D0-D7, A0-A6, A7 = `A[a_reg(7)]`, US = `A[7]`, SS = `A[8]`, PC) | register display | (a) |
| 152-155 | `Form1->cyclesDisplay->Caption = "Overflow"` or `str.sprintf("%u", cycles)` | cycle display | (a) |
| 158-166 | `Form1->regSR->Text = str;` (16 binary digits) | SR display - **this is the value 5.4 reads back** | (a)+state |
| 168 | `autoTraceInProgress && AutoTraceOptions->DisableDisplay->Checked` | read option | (d) |
| 170-173 | `Form1->highlight(); Form1->ListBox1->Repaint(); StackFrm->updateDisplay(); MemoryFrm->Repaint();` | listing highlight, stack and memory windows | (a) |

**`SIMOPS2.CPP`**

| Line(s) | Code | What it does | Class |
|---|---|---|---|
| 15, 17-19 | `<iostream.h>`, three form headers | | build |
| 35, 54, 58, 63, 74, 81, 100, 121, 124, 145, 161, 177, 188 | `fclose`, `fopen`, `fread`, `feof`, `fwrite`, `fseek`, `remove` | TRAP #15 file tasks on the host file system | (c) |
| 210-211 | `AnsiString str, str2; const AnsiString EASy68K_HEADER` | string type | build |
| 216, 375 | `try` / `catch( ... )` | | build |
| 217, 227, 372 | `fopen(name, "rt")`, `fgets`, `fclose` | read the `.S68` file | (c) |
| 219, 256, 257, 351, 360, 366, 367, 368, 370, 376 | `Form1->Message->Lines->Add(...)` | loader messages (2.4) | (a) |
| 262-277 | `Hardware->ROMChk->Checked = true; Hardware->ROMStartEdit->EditText = ...; Hardware->ROMEndEdit->EditText = ...;` and the same for `Read`, `Protected`, `Invalid` | sets the memory map **through GUI controls**; their change handlers set the map variables | (a)+state |

**`CODE9.CPP`** (everything outside `TRAP` first)

| Line(s) | Code | What it does | Class |
|---|---|---|---|
| 20-21, 24-27 | `<dos.h>`, `<Printers.hpp>`, four form headers | | build |
| 30-32 | `extern uchar keyDownCode, keyUpCode; extern bool disableKeyCommands;` | I/O window state | build |
| 35 | `TPrinter *Prntr;` | printer object | (c) |
| 47-140 | `formFeed`, `lineFeed`, `nextX`, `initPrint`, `printChar`: `Printer()`, `BeginDoc()` (51, 104), `EndDoc()` (53), `Canvas->TextHeight/TextWidth` (80-81), `PageHeight/PageWidth` (82-85), `Canvas->TextOut` (136) | printing for task 10 | (c) |
| 79 | `Prntr->Canvas->Font->Assign(Form1->FontDialogPrinter->Font);` | printer font setting | (d) |
| 1314, 1317, 1318 | `Form1->AutoTraceTimer->Enabled = false; Hardware->disable(); Log->stopLogWithAnnounce();` | SIMHALT | (a)+state, (a)+state, (b)+(c) |

**`CODE9.CPP`, function `TRAP`** (task -> call site)

| Task | Line(s) | Call | Class |
|---|---|---|---|
| 0, 1 | 746, 748 | `simIO->textOut(buf)` / `textOutCR(buf)` | (c) |
| 2 | 752 | `simIO->textIn(inStr, &D[1], NULL)` - starts a keyboard read | (b) |
| 3 | 755-756 | `itoa`; `simIO->textOut` | (c) |
| 4 | 759 | `simIO->textIn(inputBuf, &inputSize, &D[1])` | (b) |
| 5 | 762 | `simIO->charIn((char*)&D[1])` | (b) (immediate if `pendingKey`) |
| 6 | 765 | `simIO->charOut((char)D[1])` | (c) |
| 8 | 776-777 | `struct time t; gettime(&t);` | (c) host clock |
| 9 | 784, 787, 788 | timer off; `Hardware->disable()`; `Log->stopLogWithAnnounce()` | (a)+state, (a)+state, (b)+(c) |
| 10 | 797 | `printChar(*inStr++)` | (c) |
| 11 | 801, 803, 805 | `simIO->clear()`, `getrc((short*)&D[1])`, `gotorc(...)` | (c) |
| 13, 14 | 820, 822 | `simIO->textOut` / `textOutCR` | (c) |
| 15 | 826-829 | `ultoa`; `AnsiString::UpperCase`; `simIO->textOut` | (c) |
| 17 | 850-852 | `textOut`, `itoa`, `textOut` | (c) |
| 18 | 862, 863 | `textOut`; `textIn(inputBuf, &inputSize, &D[1])` | (c), (b) |
| 19 | 867 | `simIO->getKeyState(&D[1])` | (c) |
| 20 | 870-871 | `sprintf(buf, "%*d", ...)`; `textOut` | (c) |
| 21 | 874 | `simIO->setFontProperties(D[1], D[2])` | (c) |
| 22 | 877 | `simIO->getCharAt(...)` | (c) |
| 23 | 881-884 | `while (n-- > 0 && runMode) { Application->ProcessMessages(); Sleep(10); }` | (b) |
| 24 | 888, 890 | `Form1->restoreMenuTask19()` / `Form1->setMenuTask19()` | (a)+state |
| 25 | 894 | `simIO->scrollRect(...)` | (c) |
| 32 | 910 | `Hardware->Show();` | (a) |
| 32 | 913, 916, 919, 933 | `StrToInt("0x" + Hardware->seg7addr->EditText)` and `LEDaddr`, `switchAddr`, `pbAddr` | (d) (use `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc`) |
| 32 | 926, 927 | `Form1->ExceptionsEnabled->Checked = true; Form1->SaveSettings();` | (a), (c) |
| 32 | 930 | `Hardware->setAutoIRQ((uchar)D[2], D[3])` | (a)+state (timers) |
| 33 | 939-948 | `simIO->fullScreen = ...; simIO->setupWindow(); setWindowSize(...); getWindowSize(...)` | (c); `setupWindow` can open modal boxes (9.3) |
| 40-43 | 964, 969, 974, 983 | `simIO->initComm`, `setCommParams`, `readComm`, `sendComm` | (c), synchronous device I/O |
| 50-57, 59 | 988, 998, 1008, 1020, 1032, 1036, 1039, 1049, 1062 | file functions of `SIMOPS2.CPP` | (c) |
| 58 | 1052 | `simIO->displayFileDialog(&D[1], A[1], A[2], A[3], (short*)&D[0])` | (b) modal file dialog |
| 70-77 | 1149, 1159, 1162, 1172, 1182, 1185, 1188, 1191 | `simIO->playSound`, `loadSound`, `playSoundMem`, `playSoundDX`, `loadSoundDX`, `playSoundMemDX`, `controlSound`, `controlSoundDX` | (c) |
| 80-96 | 1196-1249 | `simIO->setLineColor`, `setFillColor`, `drawPixel`, `getPixel`, `line`, `lineTo`, `moveTo`, `rectangle`, `ellipse`, `floodFill`, `unfilledRectangle`, `unfilledEllipse`, `setDrawingMode`, `setPenWidth`, `FormPaint` (1238), `drawText`, `getXY` | (c) |
| 100-107 | 1254-1275 | `simIO->createNetClient`, `createNetServer`, `sendNet`, `receiveNet`, `closeNetConnection`, `getLocalIP`, `sendPortNet`, `receivePortNet` | (c), synchronous sockets |

Tasks 7, 12, 16, 30, 31, 60, 61, 62 touch only core variables.

**`BPoint.cpp`, `BPointExpr.cpp` and headers**

| File:line | Code | Class |
|---|---|---|
| `BPoint.h:14`, `BPointExpr.h:14` | `#include <vcl.h>` | build |
| `BPointExpr.h:33-34, 47`, `BPointExpr.cpp:66-72` | `AnsiString getExprString(); void setExprString(AnsiString); AnsiString expr;` (display text of the expression) | build / (a) |
| `BPointExpr.cpp:24` | `#include "BREAKPOINTSu.h"` (nothing from it is used) | build |
| `def.h:9`, `var.h:26`, `extern.h:27`, `BPoint.h:15`, `BPointExpr.h:15` | `#pragma hdrstop` | build |
| `def.h:252-262` | window default positions | GUI only |
| `var.h:34` | `AnsiString errstr, str;` | build |
| `var.h:58`, `extern.h:41` | `unsigned __int64 cycles;` | build |
| `var.h:140-158`, `extern.h:126-144` | `MultimonitorAPIsExist`, `FullScreenMonitor`, `FullScreenDeviceName`, three `typedef HRESULT (CALLBACK* ...)(LPCTSTR, ...)` function-pointer types and variables, `dsoundExist` | Windows only |
| `var.h:172-173`, `extern.h:158-159` | `byte mouseDownIRQ, ...` | build (`byte`) |
| `PROTO.H:175` | `void __fastcall initPrint();` | build |
| `OPCODES.H`, `PROTO.H` otherwise | no GUI coupling | - |

**`SIM68Ku.cpp`, execution-driving parts** (for completeness; the UI specification owns them)

| Line(s) | Code | Class |
|---|---|---|
| 153-158 | `new char[MEMSIZE]`; `Application->MessageBox("Error reserving main 68000 memory in Form1::FormCreate", NULL, mbOK); exit(1);` | (b) |
| 258 | `Application->ProcessMessages();` in `runLoop` | (b) |
| 282 | `StrToInt(str + Hardware->switchAddr->EditText)` | (d) (use `switchLoc`) |
| 288-289, 340-350, 353-356 | message area, listing, caption, repaints | (a) |
| 299-300 | `FileExists`, `ListBox1->Items->LoadFromFile` | (c) |
| 304-308 | `regPC->EditText` used as the store for the start address | (d)+state |
| 327, 332 | `BreaksFrm->sbpoint(addr)`; `BitFieldEnabled->Checked = true` | (a)+state |
| 447, 508, 520 | `loadRegs()` - reads 19 text boxes and the SR box | (d) |
| 451-453 | `simIO->BringToFront(); Hardware->autoIRQon();` | (a), (a)+state |
| 532, 534-538 | `simIO->erasePrompt(); scrshow(); setMenuActive(); AutoTraceTimer->Enabled = false; Hardware->autoIRQoff();` | (a) |
| 548, 1369 | `Log->addMessage(...)` | (c) |
| 885-903 | `lineToLog`: `regPC->EditText`, `ListBox1->Items->Strings[]`, `fprintf(ElogFile, str.c_str())` | (d), (c) |
| 1341-1348 | auto-trace timer handler | timer |

### 9.2 Timers that drive the core

| Timer | Declared | Default | Handler | Effect on the core |
|---|---|---|---|---|
| `Form1->AutoTraceTimer` | `SIM68Ku.h:143`, `SIM68Ku.dfm:2260-2263` | disabled, 200 ms | `AutoTraceTimerTimer` | one Trace Into per tick |
| `Hardware->IRQ1timer` .. `IRQ7timer` | `hardwareu.h:133, 157-162`, `hardwareu.dfm:4913-4954` | disabled, 1000 ms (VCL default; no `Interval` in the form file) | `IRQ1`..`IRQ7` -> `IRQprocess(n)` | interrupt request |
| `simIO->prompt` | `simIOu.h:24` | | `promptTimer` | cursor blink only |
| `MemoryFrm->prompt` | `Memory1.h:26` | 500 ms | | display only |

There are no threads, no `setjmp`/`longjmp` and no `throw` statements anywhere in the simulator source (the only
exception use is `try`/`catch (...)` barriers).

### 9.3 Every place where the original blocks or waits

**A. Inside the execution of an instruction or of `runprog`**

| # | Where | What blocks | Why |
|---|---|---|---|
| 1 | `RUN.CPP:646-650` | `do { ProcessMessages(); if (inputMode) Sleep(10); } while (inputMode && runMode);` | waiting for keyboard input started by TRAP #15 tasks 2, 4, 5, 18; also the per-instruction message pump |
| 2 | `CODE9.CPP:881-884` | `while (n-- > 0 && runMode) { ProcessMessages(); Sleep(10); }` with `n = (unsigned)D[1]` | TRAP #15 task 23 delay; nested message loop **inside** the TRAP handler. Each pass sleeps a nominal 10 ms (UNVERIFIED actual duration: Windows `Sleep(10)` commonly lasts about 15.6 ms). Ends early when `runMode` goes false. |
| 3 | `CODE9.CPP:1052` -> `simIOu.cpp:512, 542` | `OpenDialogIO->Execute()` / `SaveDialogIO->Execute()` | TRAP #15 task 58: modal file dialog; its result is written to D0, D1 and memory before the instruction returns |
| 4 | `logU.cpp:220` via `Log->stopLogWithAnnounce()` | `Application->MessageBox("Current Log Stopped.", "Information", MB_OK)` | only if `logging`; reached from `RUN.CPP:954`, `RUN.CPP:1127` (`haltSimulator`, itself called from `UTILS.CPP:261, 277, 292, 307, 359, 435, 459, 474`), `CODE9.CPP:788` (task 9), `CODE9.CPP:1318` (SIMHALT) |
| 5 | `RUN.CPP:1011` | `Application->MessageBox(buffer, "Error", MB_OK)` | internal exception barrier of `exec_inst` |
| 6 | `simIOu.cpp:290, 302, 321, 333` | `Application->MessageBoxA(...)` in `TsimIO::setupWindow` | full-screen switch failed; reached from task 33 (`CODE9.CPP:940, 943`) and from `runprog` (`RUN.CPP:703`) |
| 7 | `simIOu.cpp:2318, 2362` | `ReadFile` / `WriteFile` on a serial port with time-outs | tasks 42, 43 |
| 8 | `Net.cpp:209` (`Sleep(500)` retry), `Net.cpp:363, 435` (`accept`), `382, 454` (`recvfrom`) | socket calls | tasks 100-107 (UNVERIFIED which of them can block; owned by the network specification) |
| 9 | `CODE9.CPP:51, 53, 104` | `Prntr->BeginDoc()`, `EndDoc()` | task 10 printing (printer driver may show its own dialogs) |
| 10 | `simIOu.cpp:1626, 1663, 1689, 1694` | `PlaySound(...)` | tasks 70, 72, 76 (UNVERIFIED whether any call is synchronous; owned by the sound specification) |
| 11 | `BREAKPOINTSu.cpp:125` | `Application->MessageBox("Breakpoint Limit Reached!", NULL, MB_OK)` | reachable during program load from `*[sim68k]break` |

**B. The run loop itself:** `SIM68Ku.cpp:258` `Application->ProcessMessages()` after every `runprog()`.

**C. Modal dialogs opened by user commands.** They are not in the instruction path, but when the user invokes
them while a program is running they execute inside one of the two message pumps and **suspend the 68000 program
until closed**: `SIM68Ku.cpp:371, 382` (open dialogs), `404, 428` (confirmations), `490, 494, 771` (message boxes),
`555` (About), `942, 958, 969` (font dialogs), `1355` (auto-trace options), `1378` (printer setup), `1386-1391`
(full-screen options), `114, 134, 144, 224, 1290` (help messages), `157` (allocation failure), `1482, 1541, 2031`
(settings errors); `logU.cpp:46, 54` (save dialogs), `65`, `117, 163` (Replace/Append/Cancel), `134, 180, 197`, `274`;
`Memory1.cpp:60, 535, 546, 557, 567, 606, 638, 643, 646, 656`; `BREAKPOINTSu.cpp:362, 405, 450, 549, 575, 686, 761, 877`.
`SIM68Ku.cpp:214` is a `Sleep(0)` in the destructor.

**D. Waiting for a key.** There is no blocking "get key" call. All keyboard input arrives as window messages
(`TsimIO::FormKeyPress`, `simIOu.cpp:1334-1416`) processed by the pumps of A.1 and B; the handler either completes
the pending read (clearing `inputMode`) or stores the key in `pendingKey`.

---

## 10. Proposed C-level platform boundary

This section is a proposal, not a description of the original. Its goals: (1) the instruction handlers,
`eff_addr`, `cc_update`, the memory functions and `exceptionHandler` are compiled **unchanged**; (2) every
blocking wait of 9.3 A/B becomes "return a status code to the host and resume later"; (3) no Asyncify; (4) the
ordering of side effects inside one `runprog` step stays exactly as in 3.3 and 3.4.

### 10.1 Rules

- The core is single-threaded and not re-entrant. The host calls an exported function, it runs to completion and
  returns. Imported (host) functions are synchronous, return immediately and **must not call back** into the core.
  This replaces the `running` guard of `runLoop`.
- Asynchronous events (keys, mouse, interrupt requests, Pause, Rewind, hardware Reset, timers) are delivered by the
  host calling an exported function **between** calls of `sim_run`, never from inside an import.
- State that the original keeps in GUI controls moves into core variables (10.3).

### 10.2 Functions the host calls (exports)

```c
/* ---- status codes returned by sim_run() and sim_trace_once() ---- */
#define SIM_RUNNING     0  /* instruction budget used up; runMode still true; call sim_run() again           */
#define SIM_STOPPED     1  /* runMode is false (stop after trace step, breakpoint, halt, pause, reset)       */
#define SIM_WAIT_INPUT  2  /* inputMode && runMode: a keyboard read is pending   (RUN.CPP:646-650)            */
#define SIM_WAIT_DELAY  3  /* TRAP #15 task 23 delay in progress                 (CODE9.CPP:879-885)          */
#define SIM_WAIT_HOST   4  /* an asynchronous host request is outstanding (file dialog, task 58, ...)         */

/* ---- life cycle ---- */
void     sim_boot(void);              /* once: allocate memory (+ padding, 11.4), fill 0xFF, defaultSettings(), initSim() */
uint8_t *sim_memory(void);            /* base of the 16 MB array, for zero-copy views from JavaScript          */
void     sim_init(void);              /* initSim()                                            STARTSIM.CPP:33  */

/* ---- loading (2.3-2.6) ---- */
void     sim_open_begin(void);        /* OpenFile steps 1-5: initSim, fill 0xFF, clear switch byte, hw init,
                                         simhalt_on = true                                                     */
int      sim_load_srec(const char *path);          /* loadSrec(): 0 or 0x1111; also used for "Open Data"       */
void     sim_open_finish(int haveListing, int firstLineIsAddress, uint32_t listingStartPC);
                                      /* startPC / PC logic of 2.5. The host owns the listing text and applies
                                         2.6 itself through sim_set_option() and sim_bp_set(). With a listing
                                         whose first 8 characters are not in range, PC = startPC = the PC that
                                         was displayed before the load, which sim_open_begin() must save (10.3).
                                         Call it only if sim_load_srec() returned 0 (2.3 step 7).              */
void     sim_rewind(void);            /* RewindExecute: PC = startPC; initSim()               SIM68Ku.cpp:542  */

/* ---- CPU state (host reads for display, writes when the user edits) ---- */
enum { SIM_D0 = 0, /* ..D7 = 7 */ SIM_A0 = 8, /* ..A6 = 14 */ SIM_USP = 15 /* A[7] */, SIM_SSP = 16 /* A[8] */,
       SIM_PC = 17, SIM_SR = 18, SIM_A7 = 19 /* A[a_reg(7)] */ };
int32_t  sim_reg_get(int reg);
void     sim_reg_set(int reg, int32_t value);      /* SIM_SR also updates shownSR (10.3)                        */
uint32_t sim_cycles_lo(void);  uint32_t sim_cycles_hi(void);  void sim_cycles_clear(void);
int      sim_flag_get(int which);     /* runMode, trace, sstep, halt, inputMode, hardwareEnabled, autoIRQ,
                                         stopInstruction, logging, autoTraceTimerEnabled, menuState             */

/* ---- run control (3.1) ---- */
void     sim_cmd_run(void);           /* RunExecute without GUI: resetDebug(); trace = sstep = false;
                                         OLD_PC = PC; runMode = true; autoIRQ on                               */
void     sim_cmd_run_to(uint32_t a);  /* runToAddr = a (host has checked it is not a simple breakpoint); then run */
void     sim_cmd_step_over(void);     /* trace = sstep = true; stepToAddr = 0; OLD_PC = PC; runMode = true      */
void     sim_cmd_pause(void);         /* PauseExecute: trace = true; sstep = false; runMode = false;
                                         inputMode = false; scrshow; menu active; autotrace off; autoIRQ off   */
int      sim_run(int maxInstructions);/* replaces runLoop(): while (runMode) runprog();                        */
int      sim_trace_once(void);        /* TraceExecute: trace = true; sstep = false; OLD_PC = PC; one runprog()  */

/* ---- asynchronous events ---- */
int      sim_irq(int level);          /* THardware::IRQprocess(level), level 1..7. Returns 1 if runMode is true
                                         afterwards (the host must make sure it is calling sim_run).           */
int      sim_hw_reset(void);          /* THardware::ResetBtnClick; same return convention                      */
void     sim_delay_elapsed(uint32_t ticks);        /* ticks of 10 ms that have passed during SIM_WAIT_DELAY     */
uint32_t sim_delay_remaining(void);
void     sim_host_reply(int request, int32_t r0, int32_t r1, const char *data, int len);  /* ends SIM_WAIT_HOST */
/* keyboard, mouse: sim_key_char(), sim_key_down(), sim_key_up(), sim_mouse_*() - defined by the I/O
   specification; they are the bodies of TsimIO::FormKeyPress / FormKeyDown / FormKeyUp / FormMouse*.          */

/* ---- options (section 4) ---- */
enum { SIM_OPT_EXCEPTIONS, SIM_OPT_BITFIELD, SIM_OPT_SIMHALT, SIM_OPT_ELOG_TYPE, SIM_OPT_LOG_MEM_ADDR,
       SIM_OPT_LOG_MEM_BYTES, SIM_OPT_DISABLE_DISPLAY };
void     sim_set_option(int opt, int32_t value);   int32_t sim_get_option(int opt);
void     sim_map_set(int kind /*0 ROM,1 Read,2 Protected,3 Invalid*/, int enabled, uint32_t start, uint32_t end);
void     sim_hw_addr_set(int device /*0 seg7,1 LED,2 switch,3 push button*/, uint32_t addr);

/* ---- breakpoints (section 7) ---- */
int      sim_bp_set(uint32_t addr);   /* sbpoint: 0 ok, 1 table full                                           */
void     sim_bp_clear(int32_t addr);  /* cbpoint: -1 clears all                                                */
void     sim_bp_cond_set(int index /*0..99*/, int enabled, int type, int32_t typeId, int op, int32_t value,
                         int size, int readWrite);
void     sim_bp_expr_set(int index /*0..49*/, int id, int enabled, int count, const int32_t *postfix, int n);
void     sim_bp_counts(int regCount, int addrCount, int exprCount);

/* ---- logging ---- */
int      sim_log_start(void);  void sim_log_stop(void);   /* logging = true / false; files as decided in 10.6  */
```

`sim_reg_set(SIM_PC, v)` must not touch `OLD_PC`; the three run commands set `OLD_PC = PC`, which is the only
lasting effect of `loadRegs()` once the registers live in the core.

### 10.3 Core variables that replace GUI-held state

| Original | Replacement | Updated where |
|---|---|---|
| `Form1->regSR->EditText[3]` (5.4) | `short shownSR;` test `(shownSR & sbit) == 0` in `mem_req` and `memoryMapCheck` | in the replacement of `scrshow()` (`shownSR = SR`), and in `sim_reg_set(SIM_SR, ...)` |
| `Form1->AutoTraceTimer->Enabled` | `bool autoTraceTimerEnabled;` | the 9 assignment sites of 9.1; read by the `setMenuActive` replacement and by the host's timer |
| `hardwareEnabled`, `autoIRQ`, timer enables | already variables; `Hardware->enable()/disable()/autoIRQon()/autoIRQoff()` become core functions that set them and notify the host | |
| `Hardware->ROMChk`, `ROMStartEdit`, ... in `loadSrec` | assign `ROMMap`, `ROMStart`, `ROMEnd`, ... directly (parse the six hex digits), then `host_map_changed()` | `SIMOPS2.CPP:262-277` |
| `Hardware->seg7addr->EditText` etc. in task 32 and `OpenFile` | `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc` | `CODE9.CPP:913-933`, `SIM68Ku.cpp:282` |
| register text boxes read by `loadRegs()` | the registers themselves | - |
| `regPC->EditText` in `OpenFile` and `lineToLog` | `PC` / `startPC`, plus `long shownPC;` = the PC as last displayed. `OpenFile` needs it for the fallback of 2.5 (cases 2 and 5): it is the value `PC` had when `initSim()` ran at the start of the load, **before** `loadSrec` changed `PC`. In `lineToLog` the key is the address of the instruction being logged, `PC - 2` at that point, formatted `%08lX` (identical to the box text whenever a traced instruction starts, because every stop refreshes the display and `loadRegs()` copies the box into `PC`) | `SIM68Ku.cpp:304-308, 885` |
| `Form1->ListBox1` lines in `lineToLog` | host callback (10.5) | |
| `Form1->ExceptionsEnabled->Checked`, `BitFieldEnabled->Checked` | `exceptions`, `bitfield` + `host_option_changed()` | |

### 10.4 Restructuring needed to remove the blocking waits

Only the functions below change shape. The split points are chosen so that statement order is preserved.

1. **`TForm1::runLoop`** (`SIM68Ku.cpp:249-266`) is replaced by `sim_run`. The nested calls from `IRQprocess`
   (`hardwareu.cpp:772`) and the direct calls from Run/Step disappear: those functions only set `runMode`.
2. **`runprog`** (`RUN.CPP:638-721`) is split at the pump (`646-650`) into
   `runprog_head()` = `halt = false; exec_inst();` and `runprog_tail()` = lines 652-720 (steps 4-10 of 3.3).
   Between them the core is in a "pump" state:
   ```c
   int sim_run(int budget) {
     for (;;) {
       switch (phase) {
       case PH_IDLE:                                  /* between instructions */
         if (!runMode)     return SIM_STOPPED;
         if (budget-- <= 0) return SIM_RUNNING;
         halt = false;
         exec_inst_head();                            /* 3.4 steps 1-7 */
         phase = PH_EXEC;  /* fall through */
       case PH_EXEC:                                  /* handler has run; it may have asked to wait */
         if (pendingDelay && runMode) return SIM_WAIT_DELAY;      /* task 23: loop ends when runMode is false */
         pendingDelay = 0;
         if (pendingHost)             return SIM_WAIT_HOST;       /* task 58 etc. */
         exec_inst_tail();                            /* 3.4 steps 8-9; does nothing if the fetch failed (item 3) */
         phase = PH_PUMP;  /* fall through */
       case PH_PUMP:                                  /* RUN.CPP:646-650 */
         if (inputMode && runMode)    return SIM_WAIT_INPUT;
         runprog_tail();                              /* 3.3 steps 4-10 */
         phase = PH_IDLE;
       }
     }
   }
   ```
   `sim_trace_once()` runs the same three phases once without the `runMode` test at `PH_IDLE`; because `runMode`
   is false in that path, the delay of task 23 and the input wait are skipped exactly as in the original
   (`while (n-- > 0 && runMode)`, `while (inputMode && runMode)`).
   Returning `SIM_RUNNING` only at `PH_IDLE` means host events are delivered where the original's second pump
   (`SIM68Ku.cpp:258`) delivers them. For the hardware Reset button this fixes the outcome of the race of 3.5
   case 3 as "stale `OLD_PC`". If the other outcome is preferred, `sim_hw_reset()` may set `OLD_PC = PC`, **but
   only when `runMode` was already true on entry** (a program was running). When the simulator was idle
   (3.5 case 2) the original is deterministic - the first instruction after the reset runs with the stale
   `OLD_PC` - and `sim_hw_reset()` must leave `OLD_PC` alone. `sim_irq()` never touches `OLD_PC` (3.5 case 1).
3. **`exec_inst`** (`RUN.CPP:746-1017`) is split after the handler call (`RUN.CPP:853`) into `exec_inst_head()`
   (lines 753-853) and `exec_inst_tail()` (lines 855-1001, the `errflg` fix-up and exception processing). Its
   locals are already `static`, but the split needs **one new flag**: lines 855-1001 lie inside
   `if ( !(exec_result) )` (`RUN.CPP:762`) and inside the matched branch of the decode loop, so in the original
   they are **not executed at all when the opcode fetch fails**. The head must record "fetch succeeded" (for
   example `static bool fetched`), and the tail must do nothing when it is clear. `exec_result` cannot serve as
   that test, because a handler can itself return `ADDR_ERROR` or `BUS_ERROR` (from `eff_addr`), and in that case
   the tail does run. Getting this wrong shows at once: after a fetch fault with exceptions disabled the original
   prints only the `Address Error: ...` / `Bus Error: ...` line, whereas a tail that ran would add
   `Execution halted`; with exceptions enabled it would run the interrupt test and accept a pending request one
   step earlier than the original does. The `try`/`catch (...)` is removed (11.9).
   This split matters because interrupts latched *during* a task-23 delay must be seen by the interrupt check
   of the **same** instruction (`RUN.CPP:878-880`), as in the original where the delay runs inside the handler.
4. **`TRAP`, task 23** (`CODE9.CPP:879-885`): replace the loop by `pendingDelay = (unsigned)D[1];`. The host waits
   and reports with `sim_delay_elapsed()`; `PH_EXEC` continues when the count reaches zero or `runMode` is false.
5. **`TRAP`, task 58** (`CODE9.CPP:1051-1053`, `simIOu.cpp:468-560`): split `displayFileDialog` into "issue request"
   (`host_request(...)`, set `pendingHost`) and "apply reply" (`sim_host_reply` writes D0, D1 and the path into
   memory). The same mechanism serves any other task the host cannot complete synchronously (sound file
   loading, serial and network tasks) - their specifications decide.
6. **Keyboard input** (`TsimIO::textIn`, `charIn`, `FormKeyPress`, `simIOu.cpp:1278-1416`) already has the right
   shape: the task only arms the read. The key handler becomes the exported `sim_key_char()`.
7. **Modal message boxes in the instruction path** (`RUN.CPP:1011`; `Log->stopLogWithAnnounce()` at `RUN.CPP:954,
   1127`, `CODE9.CPP:788, 1318`; `BREAKPOINTSu.cpp:125`): replace by a non-blocking `host_alert()`. Nothing reads
   their result, so no resume point is needed. The original's ordering "box closed, then `stopLog()`" has no
   observable effect on the log contents.
8. **`THardware::IRQprocess`** and **`ResetBtnClick`** (`hardwareu.cpp:757-792`) move into the core as `sim_irq`
   and `sim_hw_reset`, minus the `Form1->runLoop()` call.
9. **`scrshow`** (`STARTSIM.CPP:130-175`) becomes `shownSR = SR; host_show_regs();`.
10. **`loadSrec`** (`SIMOPS2.CPP:203-379`): only its GUI statements change (messages, memory-map controls).
11. **`mem_req` / `memoryMapCheck`** (`UTILS.CPP:287, 469`): the SR text test; nothing else.
12. **`put` / `value_of`** (`UTILS.CPP:574-619`): make the register-range test well defined (11.2).
13. **`initSim`** (`STARTSIM.CPP:33-127`): I/O-window, font, sound, network and menu statements become host
    callbacks; the variable assignments stay.

### 10.5 Functions the core imports from the host

All return immediately.

```c
/* ---- messages and UI state ---- */
void host_message(const char *text);        /* Form1->Message->Lines->Add(text); text is one line, no newline  */
void host_alert(const char *title, const char *text);   /* replaces Application->MessageBox(..., MB_OK)        */
void host_show_regs(void);                  /* scrshow(): host re-reads registers, cycles, highlights listing  */
void host_menu_state(int state);            /* 0 = setMenuActive(), 1 = setMenuTrace()                         */
void host_focus_main(void);                 /* Form1->SetFocus(); may be a no-op                               */
void host_autotrace(int enabled);           /* AutoTraceTimer->Enabled changed                                 */
void host_hw_state(int hardwareEnabled, int autoIRQ);   /* Hardware->enable/disable/autoIRQon/autoIRQoff        */
void host_hw_auto_irq(int level, int enabled, uint32_t intervalMs);   /* Hardware->setAutoIRQ (task 32/6)      */
void host_hw_show(void);                    /* Hardware->Show() (task 32/0)                                    */
void host_map_changed(void);                /* memory map changed by an S0 record                              */
void host_option_changed(int opt);          /* exceptions / bitfield changed by the program or a listing       */
void host_exit_fullscreen(void);            /* RUN.CPP:701-704                                                 */
void host_key_commands(int enabled);        /* setMenuTask19 / restoreMenuTask19 (task 24, initSim)            */
void host_save_settings(void);              /* Form1->SaveSettings() (task 32/5)                               */

/* ---- memory write hook (5.5) ---- */
void host_mem_written(uint32_t addr);       /* Hardware->updateIfNeeded(addr) + MemoryFrm->LivePaint(addr).
                                               Called once per successful mem_put. May be replaced by a core-side
                                               "hardware dirty" flag that the host polls once per frame: the
                                               original repaints synchronously but nothing reads the pixels back. */

/* ---- execution log (section 8) ---- */
int  host_log_listing_line(uint32_t pc, char *out, int cap);
                                            /* lineToLog(): return 1 and the labelled line (8.3 step 3) for the
                                               instruction at pc, or 0 if the binary search of 8.3 fails        */
void host_log_write(const char *data, int len);          /* only if the log is not a MEMFS FILE* (10.6)        */

/* ---- time ---- */
uint32_t host_time_centiseconds(void);      /* local time since midnight in 1/100 s (task 8, gettime)          */

/* ---- asynchronous requests (answered later with sim_host_reply) ---- */
void host_request(int request, int32_t a0, int32_t a1, int32_t a2, int32_t a3);   /* e.g. file dialog          */

/* ---- everything else called by TRAP #15 (9.1): text, graphics, sound, serial, network, printing ----
   Signatures are defined by the I/O specifications. Requirement from the core: every one of them is
   synchronous; the tasks that return values (11 getrc, 19, 22, 33 getWindowSize, 83 getPixel, 96 getXY)
   need the answer before the instruction completes, so that state must live in wasm memory or be readable
   through a synchronous import. */
```

### 10.6 Files

`loadSrec`, the TRAP #15 file tasks and the two log files use C stdio (`fopen`, `fgets`, `fread`, `fwrite`,
`fseek`, `fclose`, `remove`). The least intrusive port keeps them and lets Emscripten's in-memory file system
back them: the host writes the `.S68` text into the virtual file system before `sim_load_srec`, and reads the
log files and program-created files back out. No status code is needed because these calls never wait. If the
host instead wants direct callbacks, only `SIMOPS2.CPP` and the `fprintf` sites of `RUN.CPP:786-842` are affected.

### 10.7 Mapping of every original wait to the boundary

| Original wait (9.3) | In the port |
|---|---|
| A.1 input wait, `RUN.CPP:646-650` | `SIM_WAIT_INPUT`; host calls `sim_key_char()` and then `sim_run()` |
| A.1 / B per-instruction pump | return of `sim_run` with `SIM_RUNNING` after `maxInstructions` |
| A.2 task 23 delay | `SIM_WAIT_DELAY`; `sim_delay_elapsed()` |
| A.3 task 58 dialog | `SIM_WAIT_HOST`; `host_request()` / `sim_host_reply()` |
| A.4, A.5, A.11 message boxes | `host_alert()`, no wait |
| A.6 full-screen failure boxes | `host_alert()` (or not applicable) |
| A.7, A.8 serial, network | decided by their specifications; `SIM_WAIT_HOST` is available |
| A.9 printing, A.10 sound | synchronous host calls that queue work |
| C user dialogs | host UI; the host simply does not call `sim_run` while one of its own modal dialogs is open if it wants the original's "program pauses while a dialog is open" behaviour |

After `sim_cmd_pause()`, `sim_rewind()`, a program load or any event delivered while `sim_run` had returned a
`SIM_WAIT_*` code, the host must call `sim_run()` once more: the suspended step then finishes its remaining phases
(as the original does when its wait loop exits) and returns `SIM_STOPPED`. For a load, make that call only after
the **whole** sequence `sim_open_begin()`, `sim_load_srec()`, `sim_open_finish()` and the listing directives of
2.6: in the original, `OpenFile` runs to completion inside the message pump, and the suspended `runprog` then
performs its steps 4-10 on the newly loaded program (for example it reports `break point at ...` and sets `trace`
if a `*[sim68k]break` breakpoint sits on the start address, and it replaces the `OLD_PC = -1` of `initSim` by
`OLD_PC = PC`).

---

## 11. Port hazards

### 11.1 Data model

- The code assumes `sizeof(int) == sizeof(long) == sizeof(void *) == 4`, little-endian. wasm32 satisfies this.
- **Do not build the core natively for a 64-bit host** (for unit tests on macOS or Linux) without first replacing
  `long`: on LP64, `LONG_MASK = 0xffffffff` (`def.h:61`) becomes a positive 64-bit value instead of -1, registers
  become 64 bits wide, sign tests such as `number & 0x80000000` and `Rm = result & 0x80000000` stop detecting
  negative values, and every `(int)pointer` cast truncates. Either test under wasm32 (Node.js) or compile natively
  with a 32-bit target.
- `unsigned __int64` / `__int64` (`var.h:58`, `extern.h:41`, `CODE4.CPP:182`) must become `unsigned long long` /
  `long long`.
- `mem_request(&PC, WORD_MASK, (long *)&inst)` (`RUN.CPP:761`) and `sscanf(..., "%2x", &s_byte)` into `char[4]`
  (`SIMOPS2.CPP:245, 346`) need 32-bit `int`/`long`.
- The 16 MB block (plus the padding of 11.4) is allocated once (`SIM68Ku.cpp:153`) and never moves in the
  original. In wasm the module needs enough initial linear memory for it, and if memory growth is enabled, any
  growth replaces the JavaScript `ArrayBuffer`: typed-array views made from `sim_memory()` (10.2) must be
  re-created after every call that can allocate, or growth must be disabled.

### 11.2 Dependence on the layout of globals (`put`, `value_of`)

- `put()`/`value_of()` (`UTILS.CPP:583, 615`) compare a pointer with `&D[0]` and `&inst`. Borland lays out the globals
  of `var.h:43-52` in declaration order; Clang/LLVM and the wasm linker give **no** such guarantee (each global may
  be placed independently). If `inst` ends up below `D`, every register operand is treated as memory. Required
  fix: put the block into one struct (same order, `inst` last) and refer to the members through macros or
  references, or replace the two range tests by explicit bounds of that struct.
- The comparisons are done on `(int)` casts, i.e. signed. In wasm32 addresses are below 2 GB unless the module is
  given more than 2 GB of memory; keep it that way or cast to `unsigned`.
- `put((long *)&SR, ...)` (`CODE1.CPP:226, 244`) reads and writes 4 bytes at a 2-byte variable. In the struct, keep
  `short SR` followed by at least 2 bytes of padding or of data that may be rewritten with its own value.
- Unmasked pointer construction `&memory[A[x]]` (1.7): in the original a register value that maps onto the
  globals' addresses is silently treated as a register. This cannot be reproduced. The safe equivalent that keeps
  every *reproducible* behaviour is to bypass `put()` at these eight call sites and call
  `mem_put(value, A[x], size)` directly with the unmasked value (same oddness test, same reported address).

### 11.3 Undefined or implementation-defined behaviour the original relies on

| Behaviour | Where | Needed result |
|---|---|---|
| Shift count >= 32 | `cc_update` `CASE_4`: `(unsigned)sizeMask >> shiftCount+1` with `shiftCount` up to 63 (`UTILS.CPP:722`) | x86 semantics: count taken modulo 32. wasm's `i32.shr_u` does the same, but C leaves it undefined and the compiler may fold or assume it away. Write the modulo explicitly: `>> ((shiftCount+1) & 31)`. |
| Signed overflow wraps | `source + dest`, `dest - source`, `-dest` in the arithmetic handlers; `(temp << 8)` in `mem_req` (`UTILS.CPP:487-491`); `temp * 0x1000000` (`CODE1.CPP:153`); `(D[reg] & WORD_MASK) * 0x10000` (`CODE7.CPP:216`); `remainder * 0x10000` (`CODE4.CPP:203`); `EV1 <<= 1` (`CODE7.CPP:142`); `1 << 31` (`CODE7.CPP:97, 193, 268-281`); `-1 << width` (`CODE7.CPP:401`); `~number + 1` and `-*result` in `from_2s_comp` (`UTILS.CPP:95-96`) | two's-complement wrap. Compile with `-fwrapv`. |
| `abs(INT_MIN)` | `getDivs68kCycles` (`CODE4.CPP:145, 151`) | stays `INT_MIN`, then cast to unsigned |
| Right shift of a negative `long` is arithmetic | `dest >> n` in `cc_update` (`UTILS.CPP:742-775`), `(EV1 >> shift_size) & 1`, `bf0 >> 24` (`CODE7.CPP:481`) | arithmetic shift (Clang does this) |
| Type punning | `(long *)&memory[...]`, `*EA1` on memory, `(long *)&SR`, `(short *)&D[0]`, `(char *)&D[1]`, `(unsigned int *)&D[2]`, `(int *)&D[0]`, `(long *)&inst` | compile with `-fno-strict-aliasing` |
| Unaligned 4-byte access | `*EA1` in `BIT_OP`/`TAS` at any byte address (`CODE7.CPP:268-281, 303`) | must not trap (it does not in wasm); keep alignment sanitizers off |
| Out-of-bounds pointer arithmetic | `&memory[A[x]]` unmasked (1.7); `(long *)&memory[typeId]` in `BPoint::isBreak` | plain 32-bit address arithmetic |
| Cast used as an lvalue (Borland extension) | `(uint)EV1 >>= 1;` (`CODE7.CPP:159`); `&(static_cast<long>(bit_no))` (`CODE7.CPP:237`) | Not valid C++; will not compile. Meanings: `EV1 = (long)((unsigned)EV1 >> 1);` and `mem_request(&PC, (long)WORD_MASK, (long *)&bit_no);` - the fetched word must land in `bit_no` (UNVERIFIED by execution, but immediate bit numbers could not work in the original otherwise). |
| Implicit `int` to `enum` | `memoryMapCheck(Invalid \| Protected \| Read \| Rom, ...)` (`UTILS.CPP:372`), `memoryMapCheck(Invalid \| Read \| Rom, ...)` (`CODE9.CPP:1016`) | add a cast to `maptype` |
| Precedence that looks like a bug but is the behaviour | `shiftCount > (size-1) & source`, `>> shiftCount+1` (`UTILS.CPP:722-723`); `0xFF80 >> (7 - ...) \| 0x40` (`RUN.CPP:878`) | keep exactly; compilers will warn |
| Mis-indented statements that are unconditional | `CODE7.CPP:83-86` (ASL `put`), `UTILS.CPP:738-741` (ROR count), `SIMOPS2.CPP:249-252` | keep exactly |

### 11.4 Reads and writes outside objects

| What | Where | Port action |
|---|---|---|
| Long access at `$FFFFFE`: bytes at index `0x1000000`, `0x1000001` | `mem_req`, `mem_put` (`UTILS.CPP:383-391, 487-491`) | Allocate padding after the 16 MB. The original reads/writes whatever follows the heap block (UNVERIFIED contents). Use zero-filled padding; never report those bytes as 68000 memory. |
| 4-byte host read at `$FFFFFD-$FFFFFF` | `*EA1` in `BIT_OP`, `TAS` | covered by the same padding (only the low byte is used) |
| `strncpy(buf, inStr, 255)` and `strlen(inStr)` starting near the top of memory | `CODE9.CPP:735, 741` and the other string tasks | padding of at least 256 bytes ending in a NUL; `strlen` can otherwise run through the rest of the wasm heap |
| `buf[(short)D[1]] = '\0'` with a negative index when D1.W is `$8000-$FFFF` | task 0/1, `CODE9.CPP:736-739` | **writes a zero byte up to 32768 bytes below a stack buffer.** Must be guarded. Observable original behaviour in that case: no truncation (the string is printed up to its NUL or 255 characters, then whatever follows in `buf`, which is uninitialised: UNVERIFIED). |
| `move_bw_times[12][1]` / `move_l_times[12][1]` | `MOVEA` with an illegal source mode (modes 7/5-7/7, `CODE1.CPP:183-187`) | The read is one row past a `[12][9]` table and is added to `cycles` before the illegal-instruction result. The four tables are defined consecutively (`CODE1.CPP:26-63`: `move_bw_times`, `move_l_times`, `movem_t_r_times`, `mover_t_m_times`); **if** Borland placed them contiguously in that order (UNVERIFIED), the values read are `move_l_times[0][1]` = 4 for `MOVEA.W` and `movem_t_r_times[1]` = 0 for `MOVEA.L`. Clang gives no such layout, so the port must not perform the read: guard `src == 12` and add 4 (word) or 0 (long). |
| `brkpt[-1]` after `cbpoint` on an address that is not set | `BREAKPOINTSu.cpp:147`, then `sbpoint` | keep callers from doing it |
| `Strings[i+1]` / `Strings[Count]` past the last listing line | `SIM68Ku.cpp:322, 884, 896` | VCL throws; port: bounds-check and reproduce the documented outcome (2.6, 8.3) |
| `inst_arr[finish + 1].name` for an unmatched opcode | `RUN.CPP:776` | in bounds for groups 0, 4, 7 (index 15, 53, 61); documented quirk (3.4 step 5) |
| S-record line longer than 514 characters | `fgets(lbuf, SREC_MAX, fp)` | split silently, second part treated as a new line |
| Stale tail of `lbuf` re-parsed for a blank or non-S line | `SIMOPS2.CPP:232-233` | deterministic given the same buffer; keep the code as is |

### 11.5 Uninitialised and stale values

- `fileOp` calls `fclose(fp)` with `fp == NULL` when the file does not exist (`SIMOPS2.CPP:63`). Borland's library
  tolerates this (UNVERIFIED); musl's `fclose(NULL)` dereferences the pointer. **Guard it.**
- `TLog::stopLog` closes both log files even if only one was opened, and `startLog` sets `logging = true` even when
  preparing the files failed (`logU.cpp:202-235`) - then `exec_inst` writes to an invalid `ElogFile`. Owned by the
  log UI, but the core must not `fprintf` to a null or closed file.
- `eff_addr`: `ext` is uninitialised if an extension-word fetch fails (`RUN.CPP:212, 231, 262, 279, 297, 315, 346`).
- `mem_req` does not write `*result` on failure; callers that ignore the return value then use the previous or an
  uninitialised value: `MOVEP` (`temp`), `ADDX`/`SUBX`/`ABCD`/`SBCD`/`CMPM` (`source`, `dest`, `result` are globals, so
  they are *stale*, not random), `UNLK`, `RTE`/`RTR`/`RTS` (the destination register keeps its old value),
  `MOVEM`.
- Globals `source`, `dest`, `result` are deliberately left stale by `NEGX`, `TST`, `SWAP`, `TAS`, `NBCD`; the flag
  methods they select do not read the stale ones.
- `BPoint::isBreak`: `curSize` is uninitialised unless `size` is 0, 1 or 2.
- `BPointExpr::isBreak`: `stack::top()` on an empty stack if an enabled expression has `p_count == 0` or is
  malformed.
- `loadSrec`: `bytecount` and `loc` are uninitialised if the first `sscanf` fails; harmless because the record is
  then rejected.
- `exec_inst`'s static `exec_result` and the global `errflg` survive `initSim` and program loads (2.2). This is
  behaviour, not a bug to fix: keep them static.
- `cc_update`: `size`, `Sm`, `Rm`, `Dm` are uninitialised if `sizeMask` is not one of the three masks (does not
  happen).

### 11.6 Things that will not compile or link outside Borland/VCL

- Headers: `<vcl.h>` (`BPoint.h:14`, `BPointExpr.h:14`), `<dos.h>`, `<Printers.hpp>` (`CODE9.CPP:20-21`), `<iostream.h>`,
  `<conio.h>` (`STARTSIM.CPP:17-18`, `SIMOPS2.CPP:15`), all `*u.h` form headers.
- Types: `AnsiString` / `String` (`str.sprintf`, `SubString`, `UpperCase`, concatenation), `TPrinter`, `TObject`,
  `byte`, `HRESULT`, `CALLBACK`, `LPCTSTR`, `LPDEVMODEA`, `HWND`, `DWORD`, `LPVOID`, `PDISPLAY_DEVICE`, `__fastcall`.
  `CODE4.CPP:72-75` defines its own `DWORD`, `WORD`, `LONG`, `SHORT` typedefs, which clash with Windows headers but
  are fine without them.
- Library functions: `itoa`, `ultoa` (`CODE9.CPP:755, 826, 851`), `gettime` / `struct time` (`CODE9.CPP:776-777`),
  `StrToInt`, `Sleep`. Semantics needed: `itoa(v, buf, 10)` signed decimal; `ultoa(v, buf, radix)` unsigned,
  lower-case digits (the caller upper-cases); `StrToInt("0x" + s)` hex parse that **throws** on bad input.
- `#define uint unsigned int`, `ushort`, `uchar` (`def.h:15-17`) collide with the `uint`/`ushort` typedefs in some
  libc headers when a system header is included after `def.h`. Replace by typedefs under different guard, or
  make sure `def.h` is included last.
- **`byte` against `std::byte`.** `extern.h:21` and `var.h:22` say `using namespace std;` at file scope, and the core
  uses the Windows type `byte` (`var.h:172-173`, `extern.h:158-159`, `CODE9.CPP:728, 1067, 1132`, `UTILS.CPP:875`). If
  the port supplies `typedef unsigned char byte;` and compiles as C++17 or later (Emscripten's default),
  every unqualified `byte` is ambiguous with `std::byte` and does not compile. Rename the core's uses (for
  example to `uchar`), or remove the `using namespace std;` lines and qualify `std::stack` (`var.h:119`,
  `extern.h:106`, `BPointExpr.cpp:103`).
- Standard headers that the VCL headers used to pull in are not included by the core files themselves:
  `<string.h>` for `strncpy`/`strlen`/`strcpy` (`CODE9.CPP:735-1243`, `SIMOPS2.CPP:76-102`) and `<stdlib.h>` for `abs`
  (`CODE4.CPP:145, 151`). Add them; C++ has no implicit declarations.
- `OPCODES.H` **defines** data (`offsets`, `inst_arr`, `names`) and declares the handlers as `extern int ORI(), ...`;
  it can be included by exactly one translation unit.
- `var.h` defines data and must be included by exactly one translation unit.
- Include-name case: files are `PROTO.H`, `OPCODES.H`, `Net.h`, `HTMLhelp.h` but are included as `"proto.h"`
  (`var.h:18`, `extern.h:24`), `"opcodes.h"` (`RUN.CPP:21`), `"PROTO.H"` (`UTILS.CPP:24`), `"net.h"`
  (`STARTSIM.CPP:25`). This fails on a case-sensitive file system (Linux CI, Emscripten in Docker).
- The source files are Windows-1252 with CR LF; `CODE9.CPP` has non-ASCII bytes in comments only.
- **Eighteen of the scope files end with a Ctrl-Z byte (`0x1A`, the DOS end-of-file mark)**: all of them except
  `BPoint.cpp/.h` and `BPointExpr.cpp/.h`. Borland ignores it; Clang reports `expected unqualified-id` unless it is
  run with `-fms-extensions`, in which mode Ctrl-Z ends the file. (Found when the files were first compiled with
  Emscripten; `engine/sim` uses that flag instead of editing the files.)
- `PROTO.H` declares `flip(ushort *)` and `flip(ushort &)` and dozens of non-existent functions; harmless.
- Locals named `cycles` (`CODE7.CPP:324`) shadow the global; `getText(int WORD_MASK, ...)` in the dead
  `STRUTILS.CPP` uses a constant's name as a parameter name.

### 11.7 Format strings

- **`fprintf(ElogFile, str.c_str())`** (`SIM68Ku.cpp:903`) uses a listing line as the format. Any `%` in the source
  line (binary constants, `%` in strings and comments) is interpreted, reading non-existent arguments. The
  original's output for such lines depends on the Borland runtime and on stack contents (UNVERIFIED). The port
  must write the line literally (`fputs`) and must not pass it as a format. This is the one place where the
  port cannot be byte-identical for affected lines.
- `fprintf(ElogFile, buffer)` (`RUN.CPP:839`) is safe (the buffer contains no `%`).
- **`fprintf(ElogFile,"%hc", ...)`** (`RUN.CPP:806`, the ASCII column of the memory dump of log type 3): Borland
  prints a character for `%hc`. musl (the C library of Emscripten) has no `hc` conversion: the call fails and prints
  nothing, so every printable byte would silently vanish from the dump. The port changes the format to `%c`
  (`engine/sim/PATCHES.md`, P06). `"%02hX"` on the same lines is fine in both libraries.
- `str.sprintf("%u", cycles)` with a 64-bit argument (`STARTSIM.CPP:155`, `SIM68Ku.cpp:1261`): shows the low 32 bits
  on Win32. The host should format `cycles mod 2^32` to match, and `Overflow` above `0xFFFFFFFFFFFF`.
- `"%08X"` / `"%4x"` / `"%04x"` are passed `long` arguments; fine on ILP32.
- `sprintf(buffer, "Can't open log file ... %d", ElogFile)` passes a pointer (`logU.cpp:133, 179`).

### 11.8 Files and text mode

- `fopen(name, "rt")` (`SIMOPS2.CPP:217`), `"wt"`/`"at"` for the execution log (`logU.cpp:120-130`): Borland text mode
  translates CR LF <-> LF and treats `0x1A` as end of file on input. Emscripten/musl ignore `t`. Consequences:
  an `.S68` with CR LF line ends still loads correctly (analysis in 2.4 step 5); the execution log is written with
  LF only unless the host converts; a stray `0x1A` no longer ends the file.
- The assembler in the same project writes `.S68` and `.L68` with `fopen(name, "w")` (text mode); files produced
  by the ported assembler should use the same line ends in both tools.
- File names given by 68000 programs are Windows paths (backslashes, drive letters, case-insensitive) relative
  to the current directory - a mapping policy is needed (I/O specification).
- `initSim` forgets open files without closing them (`STARTSIM.CPP:75-77`): each Rewind/Reload with files open
  leaks `FILE` objects (and, in a MEMFS world, keeps the data unflushed until exit). Consider closing them; no
  68000-visible difference except that buffered data reaches the file.

### 11.9 Exceptions, faults and recursion

- `try { } catch (...)` in `exec_inst`, `loadSrec`, `runLoop`, `OpenFile`: in the original these catch VCL
  exceptions (`EConvertError` from `StrToInt` on a blank Hardware address box in task 32, `EStringListError` from the
  listing, and others) and - Borland runtime behaviour, UNVERIFIED - CPU faults such as access violations. Once
  the GUI calls are gone nothing in the core throws. Remove the handlers (Emscripten builds without C++
  exception support by default, in which case a `throw` would abort) and replace each formerly-throwing
  operation by an explicit check that produces the documented outcome.
- wasm has no access violations inside linear memory: wild reads and writes succeed silently and corrupt state
  (see 11.4). An access outside linear memory traps and terminates the instance.
- **Unbounded recursion:** `mem_req` -> bus error -> `mem_req(0x8, ...)` -> bus error ... when address 8 lies in an
  enabled Invalid range (or a Protected range with the displayed S bit clear); likewise `exceptionHandler` ->
  `put` -> `mem_put` -> `memoryMapCheck` -> `exceptionHandler` when the supervisor stack lies in a Read-only or
  Invalid range (this one ends when `A[8]` leaves the range or fails the sanity check). In wasm the first becomes
  a JavaScript `RangeError` thrown through the module. Add a depth guard; define the outcome as the
  double-fault halt (UNVERIFIED what the original shows).
  Note for the guard: the two cycles nest in different functions. The first nests `mem_req` inside `mem_req`. The
  second does **not** nest `mem_req` at all (each `mem_req(0x8, ...)` returns before `exceptionHandler` is called);
  it nests `exceptionHandler` -> `put` -> `mem_put` -> `memoryMapCheck` -> `exceptionHandler`. A guard in `mem_req`
  alone misses it. `engine/sim` counts in both functions and, beyond 1000 levels, raises a C++ exception that ends
  in the original `catch (...)` of `exec_inst` (error box, trace mode), which is the closest defined equivalent
  of the original's stack overflow.
- No `setjmp`/`longjmp`, no threads, no signal handlers.

### 11.10 `char` signedness

Plain `char` must be **signed** (compile with `-fsigned-char`; Clang for wasm32 and for Apple arm64 already
does this, Clang for Linux arm64 does not). Places that depend on it: `switch ((char)D[0])` (task numbers above
127 fall to `default`); `(char)D[2] >= 2 && (char)D[2] <= 36` (task 15); `"%*d"` with `(char)D[2]` as width (task
20, negative width = left-justify); `memory[...] >= ' '` in the log (8.2); `s_byte[0] >= ' ' && s_byte[0] <= '~'`
(`SIMOPS2.CPP:249`); `char bpoints` as a counter; `char pendingKey`; `ElogFlag`/`OlogFlag` are `char` used as small
integers.

### 11.11 Timing

- The original pumps Windows messages twice per instruction, which bounds its speed far below a native
  interpreter loop. Programs with software delay loops will run much faster in the port unless throttled.
  UNVERIFIED: the original's instructions per second (it depends on the PC and on window activity).
- `Sleep(10)` granularity (task 23 and the input wait) is the Windows timer tick, typically 15.6 ms.
- Interrupt and auto-trace timers are Windows `WM_TIMER` timers: low priority, coalesced, delivered only at the
  message pumps, i.e. only between instructions. A burst of timer ticks cannot queue more than one pending
  request per level because `irq` is a bit set.
- Task 8 uses local wall-clock time.
- Cycle counts are deterministic and independent of host timing.

### 11.12 Re-entrancy and ordering

- `exec_inst` keeps `exec_result`, `i`, `start`, `finish`, `intMask`, `temp` in statics; it is not re-entrant.
  In the original the only possible re-entry is a nested Trace Into issued from inside a message pump; the port's
  boundary (10.1) forbids it.
- Events processed in the original's pumps can change anything between two instructions, and also *inside* a
  TRAP #15 task 23 (delay) or task 58 (dialog). In particular Pause during a delay ends the delay, Rewind during a
  keyboard wait resets the machine and the suspended `runprog` then finishes with the reset state. The phase
  machine of 10.4 reproduces these.
- Keyboard input arriving while a Trace Into has returned with `inputMode` still true is applied later to the
  registers/memory by the key handler (3.3 step 3); a second Trace Into before the input completes executes the
  next instruction with the read still pending (QUIRK).

### 11.13 Endianness

All items of 1.5 "host-endian and pointer tricks" assume a little-endian host. wasm is little-endian by
specification, so no change is needed; do not "fix" them to be portable in a way that changes which byte of a
register an I/O routine writes.

---

## 12. Where the help text and the source disagree (the source wins)

| Help (`c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\`) | Source |
|---|---|
| `SIMHELP\Exceptions.htm`: "Bus error can occur in this simulator by attempting to read or write outside of the virtual memory space ... 0 to FFFFFF" | Addresses are masked to 24 bits (`UTILS.CPP:369, 445`); there is no such bus error. Bus errors come only from the Invalid/Protected/Read memory-map ranges. |
| `SIMHELP\Exceptions.htm` groups: "Group 1: Trace, Interrupt, Illegal, Privilege; Group 2: TRAP, TRAPV, CHK, Divide by zero" | `exceptionHandler` is called with class 1 only for illegal and privilege, class 2 for all the others including trace and interrupt (`RUN.CPP:871-929, 1085`). Classes 1 and 2 build the same 6-byte frame, so only the processing order differs (3.9). |
| `SIMHELP\Hardware.htm`: "Protected - Read and Write only if the Supervisor bit in the Status Register is set" | The test uses the SR as last *displayed* (5.4). |
| `SIMHELP\Hardware.htm`: "Invalid - Any access results in a Bus error" | A read is tested on its first byte only; hardware-device addresses are exempt (5.3). |
| `SIMHELP\BasicOperation.htm`: "The Auto Trace, Trace and Step buttons will be disabled if the program is waiting for input." | After a Trace Into that started a keyboard read, `runprog` calls `setMenuActive()` (`RUN.CPP:710`); the commands stay enabled. Only the auto-trace timer skips ticks while `inputMode` (`SIM68Ku.cpp:1341`). |
| `SIMHELP\BasicOperation.htm`, Rewind: "Clears the Output Window, clears the 68000 registers and places the Program Counter at the beginning of the program." | True, and in addition memory is **not** restored (2.7). |
| `SIMHELP\BasicOperation.htm`: "When the program reaches the breakpoint it will halt prior to running the instruction at the breakpoint." | True except for a breakpoint on the instruction where execution starts or resumes (7.1). |
| `SIMHELP\AdvBreakpoints.htm`: "The Count column specifies how many times the expression must be true before breaking." | The count text is parsed as hexadecimal; a count of 0 breaks on every step until the expression first becomes true (7.3). |
| `SIMHELP\AdvBreakpoints.htm`: R/W "Break will only occur on read or write while the comparison is true" | Only the last read address and the last write address of each instruction are remembered (7.2). |
| `Directives\simhalt.htm`: "No registers are modified." | True for D/A/SR; the PC is advanced past both `$FFFF` words (`CODE9.CPP:1313`). |
| `fileio.htm` (task 53): D2 returns the number of bytes actually read | Only when at least one byte was read; on end-of-file or error D2 is unchanged (6.4). |
| `SIMHELP\SimOptions.htm`: "Log data is only saved when tracing the program." | Agrees (8.1). |
| `simio.htm`, task 31: "Zero is returned if the cycle count exceeds 32 bits." | Agrees (`CODE9.CPP:901-904`). |

---

## 13. Items marked UNVERIFIED (could not be determined from the source)

1. Whether Borland's `catch (...)` in `exec_inst` catches access violations and stack overflow, and what the user
   then sees (3.4 step 10, 3.14, 11.9).
2. What lies after the 16 MB memory block and is read by accesses at `$FFFFFE`/`$FFFFFF` (11.4).
3. The output of `fprintf(ElogFile, listingLine)` for lines containing `%` (11.7).
4. The cycle value added by `MOVEA` with an illegal source mode (out-of-bounds table read, 11.4): 4 for word and
   0 for long if Borland laid the four timing tables out contiguously in source order, which the source cannot
   prove.
5. The contents printed by task 0/1 when D1.W is negative (11.4).
6. That `&(static_cast<long>(bit_no))` stores into `bit_no` under Borland (11.3); inferred from the fact that
   immediate-form BTST/BSET/BCLR/BCHG are usable in the original.
7. `fclose(NULL)` behaviour of the Borland runtime in `fileOp` (11.5).
8. Real duration of `Sleep(10)` and the original's execution speed (11.11).
9. Whether keyboard shortcuts of disabled menu items (F7 while running, for example) still reach their action
   handlers; if they do, `TraceExecute` can re-enter `runprog` from a message pump. (GUI question; affects only
   whether the port has to forbid or emulate it.)
10. Which of the serial, network and sound calls block and for how long (9.3 A.7, A.8, A.10).
11. The example log line in 8.2 was derived from the code, not captured from the original program.
12. `AnsiString` comparison `str >= "00000000" && str < "01000000"` (`SIM68Ku.cpp:306`) is assumed to order
    8-digit hexadecimal strings as plain ASCII does; VCL uses a locale-aware compare.

---

## 14. Completeness pass

Enumerated mechanically from the source and checked against this document.

**Function definitions** (grep of every definition in the scope files):
- `RUN.CPP`: `decode_size` (3.6), `eff_addr` (3.6), `eff_addr_noread` (3.6), `runprog` (3.3), `exec_inst` (3.4),
  `exceptionHandler` (3.8), `irqHandler` (3.10), `haltSimulator` (3.7, 3.13).
- `UTILS.CPP`: `to_2s_comp` (1.9, unused), `from_2s_comp` (3.17), `sign_extend` (3.17), `inc_cyc` (3.15),
  `eff_addr_code` (3.6), `a_reg` (1.6), `memoryMapCheck` (3.7, 5.3), `mem_put` (3.7), `mem_req` (3.7), `mem_request`
  (3.7), `put` (1.7), `value_of` (1.7), `cc_update` (3.17), `check_condition` (3.17), `flip` x2 (1.9, unused).
- `CODE1.CPP`: `MOVE`, `MOVEP`, `MOVEA`, `MOVE_FR_SR`, `MOVE_TO_CCR`, `MOVE_TO_SR`, `MOVEM`, `MOVE_USP`, `MOVEQ` (3.16).
- `CODE2.CPP`: `EXG`, `LEA`, `PEA`, `LINK`, `UNLK` (3.16).
- `CODE3.CPP`: `ADD`, `ADDA`, `ADDI`, `ADDQ`, `ADDX`, `SUB`, `SUBA`, `SUBI`, `SUBQ`, `SUBX` (3.16).
- `CODE4.CPP`: `getDivu68kCycles`, `getDivs68kCycles`, `DIVS`, `DIVU`, `MULS`, `MULU`, `NEG`, `NEGX`, `CMP`, `CMPA`, `CMPI`,
  `CMPM`, `TST`, `CLR`, `EXT` (3.16).
- `CODE5.CPP`: `ABCD`, `SBCD`, `NBCD` (3.16).
- `CODE6.CPP`: `AND`, `ANDI`, `ANDI_TO_CCR`, `ANDI_TO_SR`, `OR`, `ORI`, `ORI_TO_CCR`, `ORI_TO_SR`, `EOR`, `EORI`,
  `EORI_TO_CCR`, `EORI_TO_SR`, `NOT` (3.16).
- `CODE7.CPP`: `SHIFT_ROT`, `SWAP`, `BIT_OP`, `TAS`, `BIT_FIELD` (3.16).
- `CODE8.CPP`: `BCC`, `DBCC`, `SCC`, `BRA`, `BSR`, `JMP`, `JSR`, `RTE`, `RTR`, `RTS`, `NOP` (3.16).
- `CODE9.CPP`: `formFeed`, `lineFeed`, `nextX`, `initPrint`, `printChar` (9.1, printing: interface only), `CHK`,
  `ILLEGAL`, `RESET`, `STOP` (3.12), `TRAP` (6), `TRAPV`, `LINE1010`, `LINE1111` (3.13) (3.16).
- `SIMOPS2.CPP`: `closeFiles`, `fileOp`, `openFile`, `newFile`, `readFile`, `writeFile`, `positionFile`, `closeFile`,
  `deleteFile` (6.4), `loadSrec` (2.4).
- `STARTSIM.CPP`: `initSim` (2.2), `scrshow` (5.4, 9.1).
- `BPoint.cpp`: constructor, destructor, 16 accessors (`getId`/`setId`, `getType`/`setType`, `getTypeId`/`setTypeId`,
  `getOperator`/`setOperator`, `getValue`/`setValue`, `getReadWrite`/`setReadWrite`, `getSize`/`setSize`,
  `isEnabled` x2: trivial field access), `isBreak` (7.2).
- `BPointExpr.cpp`: constructor, destructor, `getId`/`setId`, `setPostfixExpr`/`getPostfixExpr`,
  `setInfixExpr`/`getInfixExpr` (copy `count` ints), `getExprString`/`setExprString`, `getCount`/`setCount`,
  `isEnabled` x2, `isBreak` (7.3).
- Dead files `SIMOPS1.CPP` (`mdis`, `memread`, `memwrite`), `SCAN.CPP` (`scan`, `iswhite`), `STRUTILS.CPP` (`getText`,
  `same`, `eval`, `eval2`, `getval`, `strcopy`, `mkfname`, `pchange`): 1.1, 1.9.
- `SIM68Ku.cpp` (in-scope functions): constructor (1.5), `runLoop` (3.2), `OpenFile` (2.3), `OpenExecute`,
  `OpenDataExecute`, `WmDropFiles`, `ReloadExecute` (2.3), `CloseExecute`, `RewindExecute` (2.7), `RunExecute`,
  `RunToCursorExecute`, `StepExecute`, `TraceExecute`, `PauseExecute`, `AutoTraceExecute`, `AutoTraceTimerTimer`, `loadRegs`
  (3.1), `highlight`, `isInstruction` (2.8), `lineToLog` (8.3), `defaultSettings` (2.1, 4), `FormShow` (2.1).

**Instruction table:** all 87 entries of `inst_arr[]` and `names[]` are listed in 3.16; every handler named there has
a row in the handler tables. Unmatched opcode ranges were computed by enumeration (3.4 step 4).

**Globals:** every variable of `var.h` (lines 30-173) appears in 1.3; every additional `extern.h` declaration
(`OLD_D`, `OLD_A`, `OLD_SR`, `gettext`) is noted there; core-relevant globals defined elsewhere are in 1.4.

**Constants:** every constant of `def.h` appears in 1.2.

**`case` labels:**
- `RUN.CPP`: `decode_size` 0/1/2/default; `eff_addr` and `eff_addr_noread` modes 0-7 and 7/0-7/4 (3.6); the two
  exception switches with exceptions enabled (`BAD_INST`, `NO_PRIVILEGE`; `SUCCESS`, `STOP_TRAP`, `TRAP_TRAP`,
  `DIV_BY_ZERO`, `CHK_EXCEPTION`, `TRAPV_TRAP`, `TRACE_EXCEPTION`, `LINE_1010`, `LINE_1111`) and the one with exceptions
  disabled (`SUCCESS`, `BAD_INST`, `NO_PRIVILEGE`, `CHK_EXCEPTION`, `STOP_TRAP`, `TRAP_TRAP`, `TRAPV_TRAP`, `DIV_BY_ZERO`,
  `ADDR_ERROR`, `BUS_ERROR`, `TRACE_EXCEPTION`, `LINE_1010`, `LINE_1111`, `default`) (3.4).
- `UTILS.CPP`: `eff_addr_code` 0-4; `cc_update` N (`N_A`, `ZER`, `GEN`, `UND`), Z (`N_A`, `UND`, `GEN`, `CASE_1`),
  V (`N_A`, `ZER`, `UND`, `CASE_1`-`CASE_4`), C (`N_A`, `UND`, `ZER`, `CASE_1`-`CASE_9`), X (`N_A`, `GEN`);
  `check_condition` 16 conditions (3.17).
- `CODE9.CPP` `TRAP`: tasks 0-25, 30-33 (with sub-cases 0-7 of task 32), 40-43, 50-59, 60-62, 70-77, 80-96, 100-107,
  `default` (6.1, 9.1); `printChar` control characters (`\b \f \n \r \t \v`, interface only).
- `SIMOPS2.CPP` `loadSrec`: `'0'`, `'1'`, `'2'`, `'3'`, `'5'`, `'7'`, `'8'`, `'9'`, `default` (2.4).
- `BPoint.cpp`: `readWrite` cases and `op` cases (7.2). `BPointExpr.cpp`: AND, OR, default (7.3).
- Handler-internal switches: `MOVE` size, `EXG` mode, `LEA`/`PEA`/`JMP`/`JSR` timing by mode, `ADDQ`/`SUBQ` timing,
  `SHIFT_ROT` type, `BIT_OP` operation, `BIT_FIELD` operation (two switches), `MOVEP` byte position (3.16).

**Message texts:** every `Form1->Message->Lines->Add` and `MessageBox` in `RUN.CPP`, `UTILS.CPP`, `SIMOPS2.CPP` is
quoted (2.4, 3.3, 3.4, 3.7, 3.8, 3.14).

**Options and flags:** section 4 lists every variable that changes core behaviour; `old_trace`, `old_sstep`,
`runModeSave`, `hardReset`, `port1`, `p1dif`, `wcount`, `wordptr`, `numBuf` are identified as unused or
write-only in 1.3.

**GUI call sites:** section 9.1 was built from a grep for `Form1->`, `simIO->`, `Hardware->`, `Log->`, `MemoryFrm->`,
`StackFrm->`, `Application->`, `Sleep`, `AnsiString`, `Prntr`, `StrToInt`, `gettime`, `itoa`, `ultoa` over the files in
scope; section 9.3 from a grep for `ProcessMessages`, `Sleep`, `ShowModal`, `MessageBox`, `ShowMessage`, `MessageDlg`,
`->Execute()` and the Win32 I/O calls over the whole simulator directory.

