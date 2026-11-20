# EASy68K v5.16.1 simulator — TRAP #15 tasks 0–59 and the text side of the I/O window

Behaviour specification for the macOS/web port. Derived from the original Sim68K v5.16.1 source.
Where the help pages and the source disagree, **the source wins**; every disagreement found is listed in section 10.
Anything that could not be determined from the reference tree is marked **UNVERIFIED**.

## 0. Sources and conventions

All simulator source paths are relative to `c:\easy64k\reference\src-sim68k\Sim68Kv5.16.1\`.
Help paths are relative to `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\`.
Citations are `FILE:line` or `FILE:first-last`.

| Short name | What it is |
|---|---|
| `CODE9.CPP` | `TRAP()` dispatch (lines 723-1283), printer helpers (lines 34-140), task summary comment (lines 232-720) |
| `simIOu.cpp` / `simIOu.h` / `simIOu.dfm` | The I/O window form `TsimIO` (text, keyboard, graphics, serial, file dialog) |
| `SIMOPS2.CPP` | File I/O helpers (lines 28-190); the memory-map records read by `loadSrec` (lines 258-279) |
| `STARTSIM.CPP` | `initSim()` - the reset routine (lines 33-127) |
| `RUN.CPP` | `runprog()` (638-721), `exec_inst()` (746-1017), `haltSimulator()` (1121-1128) |
| `UTILS.CPP` | `memoryMapCheck()` (246-321), `mem_put()` (339-399) |
| `SIM68Ku.cpp` / `SIM68Ku.dfm` | Main form: menus, settings file, shortcuts |
| `logU.cpp` / `logU.dfm` | Log Output dialog and log start/stop |
| `hardwareu.cpp` | Hardware window (only `setAutoIRQ`, `enable`, `disable`, `IRQprocess` matter here) |
| `def.h`, `var.h`, `extern.h` | Constants and globals |
| Help: `textio.htm`, `simio.htm`, `SerialIo.htm`, `fileio.htm`, `keyCodes.htm`, `SIMHELP\BasicOperation.htm`, `SIMHELP\SimOptions.htm`, `Directives\memory.htm` | The pages that describe these tasks, the key codes, the debugger controls, the log options and the `MEMORY` directive. `SIMHELP\IMAGES\BasicOp\OutputWindowPic.GIF` is an unscaled screenshot of part of the output window in the default font (taken from an earlier version: the caption reads `EASy68K Simulator Output`) |

Behaviour that depends on the VCL framework or the Borland C run-time library (neither is in the reference tree) is stated where it matters and flagged as such; section 12 collects the open points, most with a test to run on real EASy68K.

Register notation used below: `D1.B` = bits 7..0, `D1.W` = bits 15..0, `D1.L` = all 32 bits.

How the source reads and writes parts of a register. The 68000 registers are host variables `long D[D_REGS], A[A_REGS]` (`var.h:43`). The trap code reads a register with a C cast and writes it through a pointer cast on a little-endian host:

| Source expression | Meaning |
|---|---|
| `(char)D[n]` | read `Dn.B`, **signed** (the project is compiled without `-K`, so `char` is signed: `SIM68K.BPR:39`, `CFLAG1 = -O2 -Vx -Ve -X- -a8 -b- -k- -vi -c -tW -tWM`) |
| `(uchar)D[n]` | read `Dn.B`, unsigned |
| `(short)D[n]` / `(ushort)D[n]` | read `Dn.W`, signed / unsigned |
| `(ushort)(D[n]>>16)` | read the high word of `Dn` |
| `*(char*)&D[n] = v` or `*(uchar*)&D[n] = v` | write `Dn.B` only; bits 31..8 are preserved |
| `*(short*)&D[n] = v` | write `Dn.W` only; bits 31..16 are preserved |
| `D[n] = v` or `*(long*)&D[n] = v` | write all 32 bits |
| `&memory[A[n] & ADDRMASK]` | host pointer to 68000 memory; `ADDRMASK = 0x00ffffff` (`def.h:57`), `MEMSIZE = 0x01000000` (`def.h:56`). Only the low 24 bits of the address register are used. |

These pointer casts require a 32-bit `long` and a little-endian target. wasm32 satisfies both; a 64-bit native build would not.

Facts that hold for **every** TRAP #15 task unless a task says otherwise:

- The task selector is `switch ((char)D[0])` (`CODE9.CPP:732`): **only `D0.B` is examined**, as a signed byte. `D0 = $0000010D` runs task 13. Bits 31..8 of D0 are ignored by the dispatch (tasks 40-43 use bits 31..16 as a port identifier).
- `TRAP()` never calls `inc_cyc` on the TRAP #15 path, so **a TRAP #15 instruction adds 0 to the cycle counter** (`CODE9.CPP:723-1283`; compare `RUN.CPP:903` where a real trap exception adds 38).
- The status register and condition codes are not touched. The PC has already advanced past the 2-byte `TRAP #15` opcode when the task runs.
- Registers not named in a task's "Outputs" are unchanged. Tasks 0-33 never modify D0. Tasks 40-43 and 50-59 overwrite `D0.W` with a result code, which destroys the task number in `D0.B`; a program must reload D0 before the next TRAP.
- A successful task returns `SUCCESS` (0) to `exec_inst` (`CODE9.CPP:1280`).

## 1. Dispatch, unknown tasks and bus errors

### 1.1 Vector check

```cpp
vector = inst & 0x0F;
if(vector == 15) { switch ((char)D[0]) { ... default: return (TRAP_TRAP); } return SUCCESS; }
else return (TRAP_TRAP);
```
(`CODE9.CPP:730-732`, `1277-1282`.) `TRAP #0`..`TRAP #14` always return `TRAP_TRAP`. `TRAP #15` with a `D0.B` that has no `case` label also returns `TRAP_TRAP`.

What `TRAP_TRAP` (value 7, `def.h:93`) does (`RUN.CPP:903-906`, `959-962`):

- Exceptions enabled (`exceptions` true): `inc_cyc(38)`, PC is loaded from vector address `128 + (inst & 0x0f) * 4` (for TRAP #15 that is `$BC`), and a group-2 exception frame (return PC, SR) is pushed on the supervisor stack.
- Exceptions disabled (the default, `SIM68Ku.cpp:1495`): `halt = true` and the message `TRAP exception occurred at location %4x. Execution halted` is added to the main-window message log, where `%4x` is `OLD_PC`.

### 1.2 Complete inventory of task numbers

Every `case` label inside `TRAP()` was enumerated mechanically (`CODE9.CPP:733-1274`). No other file dispatches on D0.

| D0.B | Owner | Where |
|---|---|---|
| 0-25 | **this document** | `CODE9.CPP:733-895`, help `textio.htm` |
| 26-29 | unassigned -> `TRAP_TRAP` | - |
| 30-33 | **this document** | `CODE9.CPP:897-951`, help `simio.htm` |
| 34-39 | unassigned -> `TRAP_TRAP` | - |
| 40-43 | **this document** | `CODE9.CPP:954-984`, help `SerialIo.htm` |
| 44-49 | unassigned -> `TRAP_TRAP` | - |
| 50-59 | **this document** | `CODE9.CPP:987-1063`, help `fileio.htm` |
| 60, 61, 62 | other agent (mouse IRQ, mouse read, key IRQ) | `CODE9.CPP:1066-1139`, help `peripheralio.htm` |
| 63-69 | unassigned -> `TRAP_TRAP` | - |
| 70-77 | other agent (sound) | `CODE9.CPP:1141-1192`, help `sound.htm` |
| 78-79 | unassigned -> `TRAP_TRAP` | - |
| 80-96 | other agent (graphics) | `CODE9.CPP:1195-1250`, help `graphics.htm` |
| 97-99 | unassigned -> `TRAP_TRAP` | - |
| 100-107 | other agent (network) | `CODE9.CPP:1253-1276`, help `networkio.htm` |
| 108-127 | unassigned -> `TRAP_TRAP` | - |
| 128-255 | negative as a signed byte, no case label -> `TRAP_TRAP` | `CODE9.CPP:732` |

Task 32 has an inner `switch ((char)D[1])` with sub-cases 0-7 (`CODE9.CPP:908-935`).
The header comment in `CODE9.CPP:232-720` lists tasks only up to 105; tasks 106 and 107 exist in code and in `networkio.htm`.

### 1.3 The memory-map check and bus errors

Several tasks call `memoryMapCheck(maptype mapt, int loc, int bytes)` (`UTILS.CPP:246-321`) before touching 68000 memory, and `return code;` if it returns `BUS_ERROR` (value `0x000A`, `def.h:96`).

- The function returns `SUCCESS` immediately if `loc` is a hardware-window address (the sixteen 7-segment bytes, LED, switch or push-button address) (`UTILS.CPP:251-253`).
- It returns `BUS_ERROR` if `loc < 0 || loc > MEMSIZE-1` (cannot happen from the trap code because the address is masked first) (`UTILS.CPP:256-266`).
- For each map type requested in `mapt` **and enabled in the Hardware window's Memory Map** (`InvalidMap`, `ProtectedMap`, `ReadMap`, `ROMMap`, all `false` by default, `hardwareu.cpp:32-34`), it tests `loc+bytes-1 >= Start && loc <= End`. A hit on Invalid, on Protected (only when not in supervisor mode) or on Read gives `BUS_ERROR`. A hit on Rom gives `ROM_MAP` (0x000F), which means "writes are silently ignored" (`UTILS.CPP:271-318`). The supervisor test for Protected does not read `SR`: it reads the third character of the SR field displayed in the main window (`Form1->regSR->EditText[3] == '0'`, `UTILS.CPP:287`), which is refreshed only when the register display is updated. Of the tasks in this document only task 2 (through `mem_put`) ever asks for the Protected check.
- When it returns `BUS_ERROR` it has already acted: with exceptions enabled it loads PC from vector `$8` and pushes a group-0 frame (`exceptionHandler(0, loc, WRITE)`); with exceptions disabled it calls `haltSimulator()` (which also stops an active log, see 3.11) and logs `Bus Error: Instruction at %4x accessing address %4x` (`UTILS.CPP:257-265`). The task then does nothing else (`return code;`), and with exceptions disabled `exec_inst` adds a second message line, `Execution halted` (`RUN.CPP:974-976`).

With the default memory map (nothing enabled) none of these checks can fail. A region becomes enabled in two ways:

- the student ticks it in the Hardware window (`hardwareu.cpp:1443-1464`), or
- **the program itself asks for it**: a source file assembled with a `MEMORY ROM / READ / PROTECTED / INVALID` directive carries extra S0 records, and `loadSrec` ticks the matching Hardware check box and fills in the range when the `.S68` file is loaded (`SIMOPS2.CPP:258-279`). A map set this way is not cleared when a different program is loaded later in the same session (`SIMOPS2.CPP:260-261`; `Hardware->initialize()` does not touch it, `hardwareu.cpp:44-63`).

So a coursework program that uses `MEMORY` directives can make these tasks raise bus errors without the student touching the Hardware window; the port must run the same checks.

Quirk: the string tasks pass `strlen(inStr)` - the length of the whole NUL-terminated string in 68000 memory - as the byte count, even for tasks 0/1 where only `D1.W` bytes are displayed (`CODE9.CPP:741`).

Host-memory hazards in the original (do not reproduce the crash, but know they exist): `strncpy(buf,inStr,255)` and `strlen(inStr)` read up to the first NUL starting at `&memory[A1 & ADDRMASK]` with no wrap at `$FFFFFF`; a string that runs off the end of the 16 MB array reads host memory beyond it.

## 2. Global state touched by tasks 0-59

| Variable | Type / definition | Initial and reset value | Meaning |
|---|---|---|---|
| `row`, `col` | `int`, `simIOu.cpp:27` | 0, 0 (ctor `simIOu.cpp:76-77`; `clear()` via `initSim`) | Text cursor, in character cells |
| `textX`, `textY` | `int`, `simIOu.cpp:27` | 0, 0 | Pixel position of the cursor cell: `colWidth*c`, `rowHeight*r` |
| `rowHeight`, `colWidth` | `int`, `simIOu.cpp:46` | from `setTextSize()` | Character cell size in pixels |
| `textRows`, `textCols` | `uint`, `simIOu.cpp:49` | from `setTextSize()` | Visible grid size, capped at `MAX_ROWS = 128`, `MAX_COLS = 256` (`simIOu.cpp:50`) |
| `text` | `char*`, `new char[MAX_COLS * MAX_ROWS]` = 32768 bytes (`simIOu.cpp:51`, `94`) | filled with `' '` by `clear()` | Shadow copy of printed characters for task 22 |
| `canWidth`, `canHeight` | `int`, `simIOu.cpp:44-45` | 640, 480 (`MIN_WIDTH`, `MIN_HEIGHT`, `simIOu.cpp:40-41`) | Canvas size in pixels |
| `doubleBuffer` | `bool`, `simIOu.cpp:37` | `false`; `initSim` calls `setDrawingMode(16)` | Graphics task 92 modes 16/17. When true, drawing goes only to the back buffer |
| `textWrap` | `bool`, `simIOu.cpp:38` | `false`; **not** reset by `initSim`; not saved to the settings file | Options menu "Output Window Text Wrap" |
| `keyboardEcho` | `bool`, `var.h:80` | `true` (`STARTSIM.CPP:71`) | Task 12 |
| `inputPrompt` | `bool`, `var.h:82` | `true` (`STARTSIM.CPP:72`) | Task 16 values 0/1 |
| `inputLFdisplay` | `bool`, `var.h:83` | `true` (`STARTSIM.CPP:73`) | Task 16 values 2/3 |
| `pendingKey` | `char`, `var.h:81` | 0 (`STARTSIM.CPP:54`) | One-character type-ahead buffer |
| `inputMode` | `bool`, `var.h:87` | `false` (`STARTSIM.CPP:53`) | True while a keyboard-input task is waiting |
| `charInput` | `bool`, `simIOu.cpp:36` | `false` in the ctor only (`simIOu.cpp:83`); **not** reset by `initSim` or Pause | True while task 5 is waiting |
| `keyBuf[256]`, `keyI` | `simIOu.cpp:29-30`, `34` (`KEYBUF_SIZE = 256`; only 80 bytes are ever used) | `keyI = 0` at each `textIn` | Line-edit buffer and its length |
| `userBuf`, `inputLength`, `inputNumber`, `inputCh` | pointers, `simIOu.cpp:28-33` | set by `textIn` / `charIn` | Where the result goes when input completes |
| `inputBuf[256]`, `inputSize` | `var.h:85-86` | - | Scratch buffer and length for numeric input |
| `promptVisible` | `bool`, `simIOu.cpp:35` | set `true` by `textIn` | Blink phase of the `_` prompt |
| `prompt` | `TTimer`, `Interval = 500`, `Enabled = False` (`simIOu.dfm:58-64`) | not stopped by `initSim` | Prompt blink timer |
| `keys[256]`, `keyDownCode`, `keyUpCode` | `simIOu.cpp:66-68` | cleared by `clearKeys()` on window activation and by task 58 | Task 19 key state, indexed by Windows virtual-key code |
| `disableKeyCommands` | `bool`, `SIM68Ku.cpp:32` | `false`; `initSim` calls `restoreMenuTask19()` (`STARTSIM.CPP:124`) | Task 24 |
| `files[MAXFILES]` | `FileStruct { FILE *fp; char name[256]; }`, `MAXFILES = 8` (`def.h:158-163`, `var.h:89`) | `fp = NULL` in `initSim` **without `fclose`** (`STARTSIM.CPP:75-77`) | File table |
| `hComm[MAX_COMM]` | `HANDLE`, `MAX_COMM = 16` (`def.h:248`, `simIOu.h:44`) | `NULL` in the ctor (`simIOu.cpp:124-125`); **never closed or reset afterwards** | Serial ports |
| `InBuff[MAX_SERIAL_IN+1]` | `char[257]` (`def.h:249`, `simIOu.h:46`) | zero at construction (VCL zero-fills objects) | Serial receive scratch buffer |
| `cycles` | `unsigned __int64`, `var.h:58` | 0 (`STARTSIM.CPP:61`) | Cycle counter |
| `logging`, `OlogFlag`, `OlogFile`, `ElogFlag`, `ElogFile` | `var.h:92-96` (`OlogFlag`, `ElogFlag` are `char`) | `logging = false` at every start; the two type flags default to 0 (`SIM68Ku.cpp:1492-1494`) but are **saved in `sim68K.dat` and restored at start-up** (`SIM68Ku.cpp:1442-1443`, `1572-1586`). Not touched by `initSim` | Log Output feature |
| `printing`, `pageX`, `pageY`, ... | `CODE9.CPP:34-44` | `printing = false` | Task 10 printer state |
| `exceptions` | `int`, `var.h:59` | `false` (`SIM68Ku.cpp:1495`), persisted in `sim68K.dat` | Task 32 sub-task 5 |
| `runMode` | `bool`, `var.h:77` | `false` | True while Run or Step Over is executing |
| `halt`, `trace` | `var.h:59-61` | - | Set by task 9 |

`initSim()` (`STARTSIM.CPP:33-127`) runs when the program starts (`SIM68Ku.cpp:1210`, after `LoadSettings()`), on every program load - Open (`SIM68Ku.cpp:275`), drag-and-drop of an `.S68` file (`SIM68Ku.cpp:416`), a file named on the command line (`SIM68Ku.cpp:1219`), Reload (via `OpenFile`, `SIM68Ku.cpp:1368`) - and on Close (`SIM68Ku.cpp:434`) and Rewind (`SIM68Ku.cpp:546`). In order it: stops auto-trace; `simIO->clear()`; `simIO->setWindowSize(0,0)` (keeps the current size, blacks the canvas, re-measures the font); `setDrawingMode(4)`; `setDrawingMode(16)`; `setPenWidth(1)`; line colour white; fill colour black; assigns the Options font to the back buffer and the form; `inputMode = false`; `pendingKey = 0`; `runMode = false`; D0-D7/A0-A7 = 0; `cycles = 0`; `SR = 0x2000`; `A[7] = 0x00FF0000`; `A[8] = 0x01000000`; `trace = sstep = false`; `keyboardEcho = inputPrompt = inputLFdisplay = true`; `files[i].fp = NULL`; `irq = 0`; `Hardware->autoIRQoff()`; `Hardware->enable()`; `FullScreenMonitor = 0`; mouse state and IRQ levels zeroed; `ResetSounds()`; `restoreMenuTask19()`; `netCloseSockets()`. Note the order of the first three steps: the screen is cleared (and the cursor homed) with the *old* double-buffer setting and the cell size is re-measured *before* the Options font is re-assigned (see section 12, item 4).

Not reset by `initSim` (consequences are listed in section 11): `charInput`, the `prompt` timer, `textWrap`, the window size, `fullScreen`, `keys[]`, serial ports, the printer state, the log state, open host files (the handles leak; see 7.1), and - possibly - the font of the visible canvas after task 21 (section 12, item 4).

## 3. The text I/O model

### 3.1 The surface: one bitmap shared by text and graphics

- The I/O window is a VCL form, caption `Sim68K I/O`, black background (`Color = clBlack`), single (non-resizable) border, system-menu and minimise buttons only, `KeyPreview = True`, `Scaled = False`, `PixelsPerInch = 96` (`simIOu.dfm:1-57`). Closing it only hides it; the next output or input call shows it again (`simIOu.cpp:814-815`, `1326`).
- All drawing goes to an off-screen bitmap `BackBuffer` (`simIOu.cpp:91`, `simIOu.h:124`) of `canWidth` x `canHeight` pixels. **Text and graphics are drawn into the same bitmap**; there is no separate text layer. Text overwrites graphics and graphics overwrite text, pixel for pixel.
- When `doubleBuffer == false` (default) every drawing call is made twice: once on `BackBuffer->Canvas` and once directly on the form's `Canvas`, so it is visible at once. When `doubleBuffer == true` (graphics task 92 mode 17) only the back buffer is drawn; the window shows it at the next paint (`FormPaint`: `Canvas->Draw(0,0,BackBuffer)`, `simIOu.cpp:379-388`), which is triggered by graphics task 94, by mode 16, by key echo during input (`this->Invalidate()`), or by any window-system repaint.
- Port model: keep one persistent back-buffer canvas. If `doubleBuffer` is false, present it after every drawing operation. If true, present it only on task 94, on mode 16, on the `Invalidate()` points listed in 3.9, and on browser repaint. The only thing ever drawn that is **not** in the back buffer is the blinking input prompt (3.8); treat it as an overlay.
- `TCanvas::TextOutA` in the source is VCL `TCanvas::TextOut` (the Windows header macro renames it). VCL behaviour, not in the reference tree: `TextOut` draws the string in the canvas font colour on an **opaque rectangle filled with the canvas brush colour** when the brush style is solid, and afterwards **moves the canvas pen position to (X + TextWidth(Text), Y)**. Consequences:
  - The background of every printed character cell is the current **fill colour** (graphics task 81, default black: `STARTSIM.CPP:45`), not necessarily black.
  - Printing text moves the graphics pen (affects graphics tasks 85 "line to" and 96 "get pen position", owned by the other agent). `getXY` reads the *form* canvas pen (`simIOu.cpp:1909-1913`), which text output does not move while double buffering is on, and which the blinking prompt moves every 500 ms. **UNVERIFIED** against the VCL source; confirm on real EASy68K before relying on exact pen positions after text output.
- Clearing always uses black (`cmBlackness`), never the fill colour: `clear()` (`simIOu.cpp:1016-1035`), `scroll()` (`simIOu.cpp:1127-1132`), `scrollRect()` and `setWindowSize()` (`simIOu.cpp:210-213`).
- The graphics pen mode (task 92 modes 0-15) and pen width do not affect text.

### 3.2 Font and character cell

- The font is chosen in Options -> "Output Window Font..." (`FontDialogSimIO`, options `[fdEffects, fdFixedPitchOnly, fdLimitSize]`, `MinFontSize = 8`, `MaxFontSize = 18`, `SIM68Ku.dfm:2266-2277`). Default: **Fixedsys, size 9, colour white (`clWhite`), no style, `ANSI_CHARSET`** (`SIM68Ku.cpp:1524-1525`, `SIM68Ku.dfm:2267-2271`). Only the font name and size are saved in `sim68K.dat` (`SIM68Ku.cpp:1468-1469`, `1900-1924`); colour and style (bold, italic, underline, strike-out) chosen in the dialog last for the session and become the text colour and style that every `initSim` restores.
- On OK the dialog font is assigned to the back buffer and to the form, the cell is re-measured (`SIM68Ku.cpp:956-963`), but `gotorc` is not called: `textX`/`textY` keep the pixel position computed with the old cell size until the cursor next moves, so the first character printed afterwards is drawn at the old pixel position. An `OnApply` handler is assigned to the dialog (`SIM68Ku.dfm:2275`), which in VCL makes it show an **Apply** button; the handler assigns the font to the back buffer only - not to the visible form canvas, and without re-measuring the cell (`SIM68Ku.cpp:983-986`) - so after Apply and until OK the two surfaces draw with different fonts. A port that has no Apply button loses nothing.
- Cell size is measured from the form canvas font (`simIOu.cpp:392-408`):

```cpp
rowHeight = Canvas->TextHeight("Xp");
colWidth  = Canvas->TextWidth("W");
textRows = canHeight/rowHeight;  if (textRows > MAX_ROWS) textRows = MAX_ROWS;   // 128
textCols = canWidth/colWidth;    if (textCols > MAX_COLS) textCols = MAX_COLS;   // 256
```

- Fixedsys is a Windows bitmap font with a single size. At 96 DPI its cell is **8 pixels wide by 15 pixels high**, which gives the default grid of **80 columns x 32 rows** in the 640x480 window (640/8 = 80, 480/15 = 32). The cell size is a property of the Windows font file and is not written anywhere in the source, but the help screenshot of the output window, `SIMHELP\IMAGES\BasicOp\OutputWindowPic.GIF`, confirms it: measured on its pixels, successive characters are 8 pixels apart and successive text lines 15 pixels apart, and the input prompt is an 8-pixel-wide underscore at the bottom of the cell. That image also serves as the glyph reference for the bitmap font the port ships. Treat "Fixedsys 9 = 8x15" as the required default.
- Grid for the default font at each menu size: 640x480 -> 80x32; 800x600 -> 100x40; 1024x768 -> 128x51 (3 pixel rows unused at the bottom); 1280x800 -> 160x53 (5 unused); 1280x1024 -> 160x68 (4 unused); 1440x900 -> 180x60; 1680x1050 -> 210x70; 1920x1080 -> 240x72; 1920x1200 -> 240x80.
- `setTextSize()` is called from `setWindowSize()` (`simIOu.cpp:226`), from task 21 (`simIOu.cpp:987`) and after the Options font dialog (`SIM68Ku.cpp:961`).
- A character is drawn with `TextOut(textX, textY, oneCharString)` at `textX = colWidth*col`, `textY = rowHeight*row`: top-left aligned in its cell, with an opaque background rectangle the size of that glyph's text extent.
- Characters are 8-bit. Codes `$80-$FF` are printable (see 3.4) and are rendered in the Windows ANSI code page of the font (Windows-1252 on a western system).
- **UNVERIFIED**: the cell sizes Windows GDI returns for the other fonts and sizes selectable by task 21 or by the font dialog (Courier, Courier New, Lucida Console, Consolas, Terminal; bold variants). These decide `textCols`/`textRows` and every cursor pixel position. They must be measured on real Windows and shipped as a table; do not derive them from browser font metrics.

### 3.3 Colours

- Text colour: the font colour, default white; changed by task 21 (`D1.L` as `$00BBGGRR`) until the next `initSim`, or for the session by the colour picked in the Options font dialog.
- Text background: the brush (fill) colour, default black; changed only by graphics task 81 (`setFillColor` sets the brush of both canvases, `simIOu.cpp:1858-1862`; the unfilled-shape tasks switch the brush to clear and back to solid inside one call, `simIOu.cpp:1964-2022`, so text always sees a solid brush). That a solid brush gives an opaque text background is VCL behaviour, see 3.1.
- Screen clear, scroll fill and resize fill: always black.

### 3.4 `charOut(char ch)` - the one routine every text-output task uses

`simIOu.cpp:811-882`. If the window is hidden it is shown first. Then:

| Byte | Action | Written to the output log |
|---|---|---|
| `$07` BEL | `Beep()` (system beep). Cursor unchanged. | no |
| `$08` BS | `col--`. **Non-destructive**: nothing is erased. | yes |
| `$09` HT | `col += 5`. A relative move of five columns, **not** a move to a tab stop. | yes |
| `$0A` LF | `row++` (column unchanged). | yes |
| `$0B` VT | `row += 4`. | yes |
| `$0C` FF | `clear()`: black screen, `text[]` filled with spaces, cursor to 0,0. | yes |
| `$0D` CR | `col = 0`. | yes |
| `$00-$06`, `$0E-$1F` | **Ignored completely**: nothing drawn, cursor unchanged. | no |
| `$20-$7F` and `$80-$FF` | Printable: draw the glyph at (`textX`,`textY`) on the back buffer (and on the form if not double buffered), store it with `text[row*textCols + col] = ch`, then `col++`. The test is `if (ch < 0 \|\| ch >= 0x20)` on a signed char, so `$7F` and all high codes print. | yes |

After the switch, **always** `gotorc(row, col)` to clamp, wrap and scroll (3.5).

Output log: when `logging && OlogFlag == TEXTONLY`, the byte is written with `fprintf(OlogFile,"%c",ch)` and the file is flushed after every character.

### 3.5 `gotorc(int r, int c)` - cursor placement, edges, wrap and scroll

`simIOu.cpp:1039-1068`:

```cpp
if (r < 0) r = 0;
else if ( (rowHeight * r) > (canHeight - rowHeight) ) { scroll(); r = canHeight/rowHeight - 1; }
if (c < 0) c = 0;
else if ( (colWidth * c) > (canWidth - colWidth) && textWrap) { doCRLF(); return; }
textY = rowHeight * r;  row = r;  if (row >= MAX_ROWS) row = MAX_ROWS - 1;
textX = colWidth * c;   col = c;  if (col >= MAX_COLS) col = MAX_COLS - 1;
```

Resulting behaviour:

- **Bottom edge.** If the requested row is past the last full row, the screen scrolls up by **exactly one row, once** (even if the request was many rows down, e.g. after VT or a task-11 position), and the cursor is put on the last row `canHeight/rowHeight - 1` (row 31 by default).
- **Top and left edges.** Negative row or column becomes 0. BS at column 0 stays at column 0.
- **Right edge, wrap off (default).** Nothing special happens. The cursor keeps moving right off the visible canvas; characters printed there are clipped (invisible) but are still stored in `text[]` (at an index that aliases the following rows, see 3.7). `col` saturates at 255; `textX` is computed from the uncapped column.
- **Right edge, wrap on.** If the new column would be past the last full column (column >= 80 by default), `doCRLF()` is executed instead and `gotorc` returns. Because `charOut` calls `gotorc` right after `col++`, the wrap is **eager**: printing a character in the last column moves the cursor to column 0 of the next row immediately, and if that was the bottom row the screen scrolls immediately.
- HT that passes the right edge with wrap on ends at column 0 of the next row (not at the overflow column).
- Quirk: in the wrap branch `doCRLF()` uses the global `row`, not the local `r`. From task 11, a position request whose column is past the right edge with wrap on therefore ignores the requested row: the cursor goes to column 0 of the row after the *current* one (and a scroll may already have been done for the requested row).
- Quirk: if `canHeight/rowHeight` exceeds 128 (possible only with a small font in a tall window), `row` is capped at 127 while `textY` uses the uncapped row.

`doCRLF()` (`simIOu.cpp:998-1012`): `col = 0; row++; gotorc(row, col);` then, if output logging is on, writes the single byte `"\n"` (LF only - the log file is opened in binary mode) and flushes.

`getrc(short* d1)` (`simIOu.cpp:1072-1080`): `*d1 = (short)(((char)col << 8) | (char)row);`.

### 3.6 Scrolling

`scroll()` (`simIOu.cpp:1107-1144`) - full-screen scroll up by one text row:

1. Copy back-buffer rectangle (0, `rowHeight`)-(`canWidth`, `canHeight`) to (0, 0)-(`canWidth`, `canHeight - rowHeight`). This moves **all pixels, graphics included**.
2. Fill (0, `canHeight - rowHeight`)-(`canWidth`, `canHeight`) with black.
3. If not double buffered, copy both rectangles from the back buffer to the form.
4. Shadow array: `for i in 0..textRows-2: for j in 0..textCols-1: text[i*textCols+j] = text[(i+1)*textCols+j]`; then the last row `text[(textRows-1)*textCols + j] = ' '`.

Rectangles are VCL `Rect(left, top, right, bottom)` with exclusive right/bottom. When `canHeight` is not a multiple of `rowHeight` the blacked band is the bottom `rowHeight` pixels of the canvas, which is lower than the last text row by the remainder; implement the rectangles literally.

Task 25's rectangle scroll is described under the task (section 4, task 25).

### 3.7 The shadow character array `text[]` (what task 22 reads)

- Allocated as 256 x 128 = 32768 bytes (`simIOu.cpp:94`).
- **`clear()` fills it with stride `MAX_COLS` (256)** - all 32768 bytes become `' '` (`simIOu.cpp:1026-1030`).
- **Every other access uses stride `textCols`** (80 by default): `charOut` stores `text[row*textCols + col]` (`simIOu.cpp:866`), `getCharAt` reads `text[r*textCols + c]` (`simIOu.cpp:1091`), `scroll` and `scrollRect` shift with stride `textCols`.
- Consequences to reproduce:
  - A character printed at a column >= `textCols` (possible when wrap is off) lands in the cell of a later row: row 0, column 80 is the same byte as row 1, column 0.
  - Changing the font (task 21) or the window size (task 33 or the menu) changes `textCols` but does not re-lay-out or clear the array, so previously printed text reads back from different coordinates.
  - Only `charOut` writes it. **Characters echoed while the user types a string or number (tasks 2, 4, 18) are not stored**, nor is text drawn by graphics task 95. Characters echoed by task 5 are stored (they go through `charOut`).
  - Backspace during line editing does not change it.
- The array is uninitialised until the first `clear()` (which `initSim` performs at start-up).

### 3.8 The input prompt

- **There is no cursor outside input.** Nothing marks the cursor position while the program is only writing text; the single visible cursor is this blinking underscore, shown while a keyboard-input task (2, 4, 18, or 5 when it has to wait) is pending.
- Enabled by `inputPrompt` (task 16, default on).
- `textIn` starts it: `prompt->Enabled = true; promptVisible = true;` (`simIOu.cpp:1322-1325`). Nothing is drawn at that moment.
- Every 500 ms the timer runs `promptTimer` (`simIOu.cpp:1420-1434`): if `doubleBuffer` is false, it draws either `" "` (when `promptVisible` was true) or `"_"` (when false) with `TextOut` at (`colWidth*col`, `textY`) **on the form canvas only**, and toggles `promptVisible`. So after input starts the underscore first appears after 1000 ms, shows for 500 ms, hides for 500 ms, and so on. With double buffering on, the timer does nothing (no visible prompt).
- The underscore is an ordinary glyph in the current font and colour on the fill-colour background. Because it is drawn only on the form canvas, any repaint from the back buffer removes it.
- Each typed character or backspace stops the timer and restarts it (a full 500 ms interval) without changing `promptVisible` (`simIOu.cpp:1387-1393`, `1406-1407`).
- `erasePrompt()` (`simIOu.cpp:1439-1452`): only if `inputPrompt` is true, stop the timer and draw `" "` at the prompt position on the form canvas. Called when input completes, on backspace, and from Pause. It draws on the visible window **even when double buffering is on**, and it never touches the back buffer. So both the underscore and the erasing space are an overlay cell (current font, fill-colour background) that hides whatever the back buffer holds at the cursor cell until the next repaint from the back buffer. Such a repaint follows at once after a typed character or a backspace (`Invalidate()`), but not after the Enter that ends a string or number input: there the blank cell stays on screen until something else repaints the window (the next task 1/3/14/15/17/20 output when not double buffered, task 94, or a window-system repaint). It is only noticeable when the cursor sits on top of existing text or graphics.
- Quirk: if a pending type-ahead key completes a string/number input inside `textIn` (for example a pending Enter), the timer is started **after** the input has already finished and keeps blinking an underscore at the cursor until the next input task ends (`simIOu.cpp:1317-1325`).
- Quirk: `initSim` does not stop the timer, so Rewind while an input is waiting leaves the underscore blinking at the home position.

### 3.9 Keyboard input

Keys reach the simulated program only while the I/O window has keyboard focus. The simulator gives it the focus itself at the two moments that matter, and the port must do the same or typed keys will go nowhere:

- **Run** brings the I/O window to the front and focuses it, if it is visible (`RunExecute`: `if (simIO->Visible) simIO->BringToFront();`, `SIM68Ku.cpp:451-452`; `TsimIO::BringToFront` calls `SetFocus()`, `simIOu.cpp:567-578`). Step Over and Trace Into do not.
- **Every keyboard-input task** calls `simIO->Show()` (`simIOu.cpp:1326`), which makes the window visible and brings it to the front (VCL `Show`); every text output shows the window if it was hidden (`simIOu.cpp:814-815`).
- When an input completes in trace mode the focus is handed back to the main window (`simIOu.cpp:1366-1371`); in Run mode it stays on the I/O window.

Three Windows events are handled.

**Key down** (`FormKeyDown`, `simIOu.cpp:417-449`), for every key that reaches the form, including modifiers, arrows and function keys, and for each auto-repeat:
1. `keys[(uchar)Key] = true; keyDownCode = (char)Key;` where `Key` is the Windows virtual-key code.
2. If `keyDownIRQ` is non-zero, raise that interrupt (task 62, other agent).
3. If `disableKeyCommands` (task 24): set `Key = 0` and stop here (`simIOu.cpp:428-432`). Zeroing the key only stops further key-down handling; the character event below is still delivered.
4. Otherwise: Ctrl+Tab brings the Memory window to the front; **Alt+Enter toggles full-screen**; **Shift+Insert pastes**: up to 254 characters of clipboard text are fed one at a time to `FormKeyPress` exactly as if typed.

Keys that do **not** reach these handlers in the original. This is the behaviour of the VCL framework, which pre-processes key messages before the form's handlers run; the framework source is not in the reference tree, so each point is **UNVERIFIED** and should be checked once on real EASy68K, but the help page agrees with both:

- **Simulator shortcut keys.** While key commands are enabled, a key that is a main-window shortcut (F6 Pause, F7 Trace Into, F8 Step Over, F9 Run, F10 Auto Trace, Ctrl+O, Ctrl+F2, Ctrl+F3, Ctrl+F9, Ctrl+F4, Ctrl+F5) runs that command (when the command is currently available - during a run that means Pause, Rewind, Reload and the log commands) even when it is pressed in the I/O window, and is not reported to the program. `keyCodes.htm:42-51` marks F1 and F6-F10 "used by Sim68K" with the footnote "use trap task #24 to disable simulator shortcut keys" (`keyCodes.htm:68-69`). Task 24 removes exactly these eleven shortcuts; Find (Ctrl+F) and Go to PC (Ctrl+G) keep theirs in every case, so the characters `$06` and `$07` cannot normally be typed.
- **The Tab key.** A form with no controls still treats plain Tab and Shift+Tab as focus-navigation keys and consumes them: no key-down event and no character. Consistently, `keyCodes.htm:18-20` lists Backspace `$8`, keypad 5 `$C` and Enter `$D` but has **no entry for Tab**. Ctrl+Tab is not consumed (the handler above sees it), and the character `$09` can still be produced with Ctrl+I. The key-up event for Tab is delivered, so `keyUpCode` can become `$09`.

**Key up** (`FormKeyUp`, `simIOu.cpp:452-464`): `keys[(uchar)Key] = false; keyUpCode = (char)Key;` then the key-up interrupt if enabled.

**Window activation** (`FormActivate`, `simIOu.cpp:615-618`) calls `clearKeys()`: all `keys[]` false, `keyDownCode = keyUpCode = 0`. Task 58 also calls it.

**Character** (`FormKeyPress(char &Key)`, `simIOu.cpp:1334-1416`) - the Windows `WM_CHAR` character, one 8-bit code in the ANSI code page: printable characters with Shift/CapsLock applied, Enter = `$0D`, Backspace = `$08`, Esc = `$1B`, Ctrl+letter = `$01-$1A` (so Ctrl+H is a backspace, Ctrl+M is Enter and Ctrl+I is `$09`), Ctrl+Enter = `$0A`, Ctrl+Backspace = `$7F`. Holding a key down repeats the character. Arrow keys, function keys, Insert/Delete/Home/End and bare modifiers produce no character and are invisible to tasks 2, 4, 5, 7 and 18 (use task 19). The Tab key and the shortcut keys are subject to the note above.

```
if (!inputMode) { pendingKey = Key; return; }            // type-ahead: ONE slot, the last key wins

if (Key == '\r' || keyI >= 79 || charInput) {             // --- terminate ---
    erasePrompt();
    if (charInput) {                                      // task 5 waiting
        *inputCh = Key;                                   // D1.B
        charInput = false;
        if (keyboardEcho) {
            charOut(Key);                                 // control characters are interpreted by charOut
            if (Key == '\r' && inputLFdisplay) charOut('\n');
            Invalidate();
        }
    } else {                                              // string or number input
        doCRLF();                                         // ALWAYS, even with echo off or inputLFdisplay false
        keyBuf[keyI] = '\0';
        if (inputNumber == NULL) {                        // task 2
            for (i = 0; i <= keyI; i++) mem_put(keyBuf[i], addressOf(userBuf)+i, BYTE_MASK);   // includes the NUL
            *inputLength = keyI;                          // D1.L
        } else {                                          // tasks 4 and 18
            strcpy(inputBuf, keyBuf);
            *inputLength = keyI;                          // the global inputSize, not a register
            *inputNumber = atoi(inputBuf);                // D1.L
        }
    }
    inputMode = false;
    if (trace) { enable debug menus; Hardware->enable(); scrshow(); focus main window; }
}
else if (Key == VK_BACK) {                                // --- backspace ($08) ---
    keyI--;
    if (keyI < 0) keyI = 0;                               // nothing to delete: no visible effect at all
    else {
        erasePrompt();
        gotorc(row, col-1);
        keyBuf[keyI] = '\0';
        if (keyboardEcho) TextOut(textX, textY, " ");     // back buffer, and form if not double buffered
        Invalidate();
        if (inputPrompt) prompt->Enabled = true;
    }
}
else {                                                    // --- any other character, control codes included ---
    keyBuf[keyI++] = Key;  keyBuf[keyI] = '\0';
    prompt->Enabled = false;
    if (keyboardEcho) {
        TextOut(textX, textY, Key);                       // drawn directly, NOT via charOut: no control handling, not stored in text[]
        if (logging && OlogFlag == TEXTONLY) write Key to the output log and flush;
    }
    gotorc(row, col+1);                                   // the cursor advances even when echo is off
    Invalidate();
    if (inputPrompt) prompt->Enabled = true;
}
```

Rules that follow from this code:

- **Maximum line length is 79 characters.** The test `keyI >= 79` is made when a key arrives, before storing it. After 79 characters are in the buffer, the **80th key press of any kind - printable, Backspace or Enter - terminates the input and is discarded**. Task 2 then stores 79 characters plus a NUL (80 bytes) and returns 79.
- **Only Enter (`$0D`) terminates** otherwise. Every other character code that arrives - Esc, `$09`, the other Ctrl+letter codes, LF, `$7F`, codes `$80-$FF` - is stored in the buffer as data and echoed as a glyph of the current font (no control-character handling; see section 12, item 7).
- **Type-ahead is one character.** Keys typed while no input task is waiting overwrite `pendingKey`; only the last one survives. `pendingKey` is cleared by `initSim` and when consumed.
- A pasted multi-line text: the first CR ends the current input; every following character goes to `pendingKey`, so only the last pasted character survives as type-ahead.
- **Echo off (`keyboardEcho == false`) hides the characters but not the cursor movement**: each typed character still advances the cursor one column, Backspace still moves it back, and Enter still performs the CR+LF.
- Backspace with wrap on does not return to the previous row (column is clamped at 0); the buffer character is still removed and the space is drawn at column 0 of the current row.
- Backspace editing is not written to the output log, so the log contains every character typed, including ones later erased.
- The string result is stored with `mem_put` byte by byte (`simIOu.cpp:1356-1357`), i.e. through the normal memory-map rules: writes into a ROM-mapped region are silently dropped; a write into an Invalid/Read-only/Protected region raises the bus-error machinery of `mem_put` for that byte (the return value is ignored and the loop continues, so with exceptions enabled a bus-error frame is pushed for every offending byte). `mem_put` masks each address to 24 bits (`UTILS.CPP:369`), so a buffer that starts near `$FFFFFF` **wraps to address 0** instead of overflowing; it also refreshes the Hardware and Memory windows for the bytes written and marks the instruction as a memory write for write breakpoints (`UTILS.CPP:394-397`). The bytes are stored when the input completes - an instruction boundary later than the TRAP, see below - not while the user types.

**How "blocking" works** (important for the WASM/JS split): the trap handler does **not** wait. `textIn` (`simIOu.cpp:1309-1331`) records where the result must go, sets `inputMode = true`, feeds a pending key if there is one, starts the prompt, shows the window and returns; `TRAP()` returns `SUCCESS`. The CPU is then held by the run loop:

```cpp
do { Application->ProcessMessages(); if(inputMode) Sleep(10); } while (inputMode && runMode);   // RUN.CPP:646-650
```

- In **Run** and **Step Over** (`runMode` true) no further instruction executes until `inputMode` becomes false. The register/memory result is written later, by the key handler, when the user finishes.
- In **Trace Into** (`runMode` false, `SIM68Ku.cpp:515-522`) the loop exits at once: the simulator returns to the debugger with input still pending. The user can type into the I/O window (which completes the input and returns focus to the main window) or can trace further instructions before the input has been delivered. Auto Trace skips its ticks while `inputMode` is true (`SIM68Ku.cpp:1339-1350`).
- **Pause** during input (`SIM68Ku.cpp:525-539`): `runMode = false; inputMode = false; erasePrompt()`. The trap has already "returned"; nothing is written to D1 or memory, and when the program is resumed it continues after the TRAP as if the input had produced nothing. `charInput` is left as it was (see hazards).
- Hardware interrupts requested while the CPU is held for input are latched but not serviced until input completes (`hardwareu.cpp:757-775` re-enters `runLoop`, which refuses nested calls, `SIM68Ku.cpp:249-266`).

### 3.10 Window size, resize and full screen

- The user cannot resize the window by dragging (single border); `FormResize` is empty (`simIOu.cpp:411-414`).
- Size changes come from Options -> "Output Window Size" (radio items 640x480 (default, checked), 800x600, 1024x768, 1280x800, 1280x1024, 1440x900, 1680x1050, 1920x1080, 1920x1200; `SIM68Ku.dfm:1358-1414`, `SIM68Ku.cpp:2051-2121`) and from task 33. The size is not saved in the settings file; the program starts at 640x480. `initSim` calls `setWindowSize(0,0)`, which **keeps the current size**.
- `setWindowSize(ushort width, ushort height)` (`simIOu.cpp:187-233`):
  1. If both are 0, use the current size.
  2. `canHeight = max(height, 480)`, `canWidth = max(width, 640)` - each dimension is clamped separately; there is no upper limit in the code.
  3. Resize the window client area and the back buffer; **fill the whole back buffer and window with black**.
  4. Copy font, brush, pen and pen position from the form canvas to the back-buffer canvas.
  5. Re-apply windowed/full-screen placement (`setupWindow()`), re-measure the text cell (`setTextSize()`), update the menu check mark.
  - It does **not** clear `text[]` and does **not** move the cursor: `row`, `col`, `textX`, `textY` keep their values.
- Full screen (`setupWindow()`, `simIOu.cpp:238-369`): changes the monitor's display mode to `canWidth` x `canHeight` at 32 bpp, removes the border, makes the window stay on top at the monitor's origin. If the mode is unsupported a message box says `Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.` and the window stays windowed. Entered by task 33 with `D1.L = 2`, by Alt+Enter in the I/O window, or by the `/f` command-line switch; left by task 33 with `D1.L = 1`, Alt+Enter, View -> Output Window, automatically when the program halts or enters trace mode while the main window is on the same monitor (`RUN.CPP:701-704`), and when the simulator exits (`simIOu.cpp:140-143`). Neither entering nor leaving full screen changes `canWidth`/`canHeight`, the back buffer, the text grid or the cursor; a set-size call (task 33 or the menu) while in full screen switches the display mode to the new size. The target monitor is chosen in Options -> "Fullscreen Options..." and is reset to the primary by every `initSim` (`STARTSIM.CPP:85`). For the port, full screen is a presentation mode: scale the unchanged `canWidth` x `canHeight` canvas to the display.

### 3.11 Output log ("Log Output")

- Options -> "Log Output..." opens a dialog (`logU.dfm`) with: Execution Log File Name; Execution Log Type (`Disabled`, `Instruction only`, `Instruction and Registers`, `Instruction, Registers and Memory`); Memory Range to Log (From, 8 hex digits; Bytes, 2 hex digits; visible only for the last type); **Output Log File Name**; **Output Log Type (`Disabled`, `Text Only`)**; OK; Cancel. The execution log belongs to the debugger; only the output log is specified here.
- OK copies the two radio selections into `ElogFlag` / `OlogFlag` and enables Log Start if either is not `Disabled` (`logU.cpp:76-85`); Cancel restores the dialog to what it showed when it was opened (`logU.cpp:88-99`, `278-286`). The two types are stored in the settings file and come back at the next start (section 2).
- When a program file is opened (Open, drag-and-drop or command line - not Reload) the names default to the program path with its extension replaced by `_RunLog.txt` and `_OutLog.txt`; a log that is running is stopped first with a `Current Log Stopped.` box; Log Start is enabled if a log type is selected (`logU.cpp:59-73`, `SIM68Ku.cpp:373`, `417`, `1220`).
- Logging starts with Run -> Log Start (Ctrl+F4, toolbar) and stops with Log Stop (Ctrl+F5) (`SIM68Ku.dfm:1156-1166`, `logU.cpp:202-235`). Both items start disabled (`SIM68Ku.cpp:1499-1502`): **Log Start cannot be used until a log type other than `Disabled` has been chosen** (and, after a restart, until a program has been opened or the dialog confirmed). The toolbar shows `LOGGING` while active.
- On start (`logU.cpp:103-199`): if the output log file already exists, a dialog titled `Log File Options` with message `Output Log File exists!` offers `Replace` (open `"wb"`), `Append` (open `"ab"`) or `Cancel` (abort). Otherwise the file is created with `"wb"`. The first thing written is `EASy68K output log file: <date and time>\r\n\r\n`.
- What is written while `logging && OlogFlag == TEXTONLY`:
  - every byte that `charOut` handles except BEL and the ignored control codes (table in 3.4), raw, in binary mode;
  - one `"\n"` for every `doCRLF()` (the CR+LF of tasks 0 and 13, the Enter that ends a string/number input, and every automatic wrap);
  - every character echoed during string/number input (only when `keyboardEcho` is true).
  - Not written: backspace editing, the prompt, graphics text (task 95).
  - The file is flushed after each character.
- Rewind and Reload do not stop the log; they append `\n***** Reset Program Pressed *****\n` / `\n***** Reload Program Pressed *****\n` (bare LF bytes, the file being binary) (`SIM68Ku.cpp:548`, `1369`, `logU.cpp:289-295`). Quirk: `addMessage` does not test `OlogFlag`; it tests `oLogType`, the copy of the Output Log Type that was taken **when the Log Output dialog was last opened** (`logU.cpp:33`, `280-281`, `293`). The marker is therefore written only if the dialog was opened at a moment when the type already read `Text Only`. With the usual sequence - open the dialog, switch from `Disabled` to `Text Only`, OK, Log Start - the copy is still 0 and no marker is written; nor is one written when the type came from the settings file and the dialog was never opened in this session.
- Task 9, `SIMHALT`, a `STOP` executed with exceptions disabled, and every bus or address error that halts the simulator (`haltSimulator`, `RUN.CPP:1121-1128`) stop the log and show a modal box `Current Log Stopped.`, title `Information` (`logU.cpp:217-223`). Closing the simulator stops it silently (`SIM68Ku.cpp:234`, `243`). Pause, Rewind, Reload and an unknown-task halt leave it running.
- `stopLog()` closes **both** `ElogFile` and `OlogFile` whichever log types are selected (`logU.cpp:202-214`), so with only the output log selected it calls `fclose` on a pointer that was never opened (or was closed by an earlier log). The port must close only what it opened.
- There is no "redirect output to file instead of the screen" option; the log is always in addition to the screen.

### 3.12 Menu items and shortcuts that affect text I/O

| Item | Effect | Source |
|---|---|---|
| View -> Output Window | Shows the I/O window, or leaves full screen if in it | `SIM68Ku.cpp:1063-1071` |
| Options -> Output Window Font... | Font dialog; on OK the font is applied to the back buffer and the form, then `setTextSize()`; Apply button quirk in 3.2 | `SIM68Ku.cpp:956-963`, `983-986` |
| Run -> Run (F9, toolbar) | Besides starting the CPU, brings a visible I/O window to the front with keyboard focus (3.9) | `SIM68Ku.cpp:441-455` |
| Options -> Printer Font... | Font used by task 10, default Courier New 10 | `SIM68Ku.cpp:967-972`, `1532-1533` |
| File -> Printer Setup... | Standard printer setup dialog | `SIM68Ku.cpp:1376-1379` |
| Options -> Log Output... | Section 3.11 | `SIM68Ku.cpp:1265-1268` |
| Options -> Fullscreen Options... | Monitor number for full screen | `SIM68Ku.cpp:1382-1393` |
| Options -> Output Window Size | Section 3.10 | `SIM68Ku.cpp:2051-2087` |
| Options -> Output Window Text Wrap | Toggles `textWrap`; unchecked by default | `SIM68Ku.cpp:2124-2134`, `SIM68Ku.dfm:1415-1418` |
| Ctrl+Tab in the I/O window | Brings the Memory window to the front (Ctrl+Tab in the main window brings the I/O window forward, `SIM68Ku.cpp:1310-1311`) | `simIOu.cpp:434-435` |
| Alt+Enter in the I/O window | Toggle full screen | `simIOu.cpp:436-438` |
| Shift+Insert in the I/O window | Paste clipboard as typed input | `simIOu.cpp:439-444` |

The last three are disabled while task 24 has key commands disabled.

## 4. Tasks 0-25 (text I/O)

### Task 0 - display `D1.W` characters with CR, LF. Task 1 - the same without CR, LF

`CODE9.CPP:733-749`.

- Inputs: `A1` = address of the text (low 24 bits used). `D1.W` = character count, read as **signed** 16 bits.
- Algorithm:

```cpp
inStr = &memory[A[1] & ADDRMASK];
strncpy(buf,inStr,255);                       // char buf[256]
if ((short)D[1] > 255) buf[255] = '\0'; else buf[(short)D[1]] = '\0';
code = memoryMapCheck(Invalid, (A[1] & ADDRMASK), strlen(inStr));  if (code == BUS_ERROR) return code;
if ((char)D[0]) simIO->textOut(buf); else simIO->textOutCR(buf);
```

- The number of characters displayed is `min(D1.W, 255, length up to the first NUL)`. **A NUL byte ends the text early.** `D1.W = 0` displays nothing (task 0 still does the CR, LF).
- `D1.W` negative (`$8000-$FFFF`): the original writes a zero byte at a negative index of a stack array - undefined behaviour. **UNVERIFIED** what a given Windows build then displays. The port must not perform the out-of-bounds write; recommended behaviour is to display up to the first NUL, at most 255 characters.
- Each character goes through `charOut` (3.4), so control characters in the text are interpreted.
- Task 0 ends with `doCRLF()` (cursor to column 0 of the next row, scrolling if needed). Task 1 leaves the cursor after the last character. `textOut` (task 1) repaints the window when not double buffered; `textOutCR` (task 0) does not need to (`simIOu.cpp:887-932`).
- Outputs: none. Blocks: no. Errors: bus error only via the Invalid memory map (1.3).

### Task 2 - read a string from the keyboard

`CODE9.CPP:750-753`, `simIOu.cpp:1309-1416`.

- Input: `A1` = buffer address (low 24 bits). No memory-map check is made when the task starts.
- Blocks until Enter or until the 80th key press (3.9). A pending type-ahead key is consumed as the first key (a pending Enter completes the input immediately with an empty string).
- Outputs: the typed characters followed by a NUL are stored at `(A1)` via `mem_put` (at most 79 characters + NUL = 80 bytes). **`D1.L` = number of characters, 0..79** (all 32 bits are written; `inputLength` points at the whole `long`).
- Screen: characters are echoed if `keyboardEcho`; the cursor advances regardless; on completion `doCRLF()` is always performed (task 16 options 2/3 do **not** affect this task - see section 10).
- Editing: Backspace only. No cursor keys, no insert.

### Task 3 - display `D1.L` as a signed decimal number

`CODE9.CPP:754-757`: `itoa(D[1], buf, 10); simIO->textOut(buf);`

- Input: `D1.L` signed. Output text: optional leading `-`, then the digits with no padding, no leading zeros, no thousands separators. `$80000000` prints `-2147483648`; 0 prints `0`.
- No CR/LF. Blocks: no. Registers unchanged.
- `itoa` is a Borland library function (not standard C); the port must supply an equivalent.

### Task 4 - read a number from the keyboard into `D1.L`

`CODE9.CPP:758-760`: `simIO->textIn(inputBuf, &inputSize, &D[1]);`

- Blocks. Line input, echo, 79-character limit and the final `doCRLF()` are exactly as for task 2. Nothing is stored in 68000 memory.
- Output: **`D1.L = atoi(text)`** (`simIOu.cpp:1359-1363`). `atoi` rules: skip leading white space, accept one optional `+` or `-`, read decimal digits, stop at the first non-digit. Therefore: empty input -> 0; `abc` -> 0; `12abc` -> 12; `  -7` -> -7; `$FF` -> 0; `1.9` -> 1. There is no error indication and no re-prompt.
- Values outside the signed 32-bit range: **UNVERIFIED** for the Borland runtime (most likely wraps modulo 2^32; some runtimes clamp). Decide once and test against real EASy68K with input `4294967295` and `99999999999`.

### Task 5 - read one character into `D1.B`

`CODE9.CPP:761-763`, `charIn` `simIOu.cpp:1278-1301`.

- Output: `D1.B` = the character; **bits 31..8 of D1 are preserved**.
- Path A - a type-ahead key is pending: returns at once (no blocking). `D1.B = pendingKey`. If `keyboardEcho`: `if (pendingKey != '\b') charOut(pendingKey); if (pendingKey == '\r') charOut('\n');` then `pendingKey = 0`.
- Path B - nothing pending: `charInput = true`, then `textIn` -> blocks until the next character key. Any character completes it. If `keyboardEcho`: `charOut(Key); if (Key == '\r' && inputLFdisplay) charOut('\n');`
- The two paths differ in two ways, and both must be reproduced:
  - Backspace is not echoed in path A, but is echoed in path B (`charOut('\b')` moves the cursor left one column).
  - After Enter, path A always outputs LF; path B outputs LF only if `inputLFdisplay` is true (task 16, value 3 = default).
- Echo goes through `charOut`, so the character code decides what happens: `$0D` (Enter) moves to column 0 (plus LF as above); `$09` (Ctrl+I) moves five columns; `$0A` (Ctrl+Enter or Ctrl+J) moves down one row; `$0B` (Ctrl+K) moves down four rows; **`$0C` (Ctrl+L) clears the screen**; `$07` would beep (but Ctrl+G is normally taken by the Go to PC shortcut, 3.9); Esc and the other ignored control codes echo nothing; printable characters, `$7F` and `$80-$FF` are drawn, stored in `text[]` and logged.
- No Enter is needed and none is consumed. Keys without a character code (arrows, function keys) do not complete the task.

### Task 6 - display the character in `D1.B`

`CODE9.CPP:764-766`: `simIO->charOut((char)D[1]);` Full `charOut` rules (3.4). Blocks: no. Registers unchanged.

### Task 7 - is a key pending?

`CODE9.CPP:767-774`. `D1.B = 1` if `pendingKey != 0`, else `D1.B = 0`. Implemented as `D[1] &= 0xFFFFFF00; D[1] |= 1;` so **bits 31..8 are preserved**. Does not consume the key and does not block. The pending key is read by task 5 (returned immediately) or becomes the first key of a task 2/4/18 line.

### Task 8 - time since midnight

`CODE9.CPP:775-782`. `D1.L = hour*360000 + minute*6000 + second*100 + hundredths`, local wall-clock time (Borland `gettime`). Range 0..8639999. All 32 bits written. Blocks: no.

### Task 9 - terminate the program

`CODE9.CPP:783-789`:

```cpp
Form1->AutoTraceTimer->Enabled = false;
trace = false;
halt = true;
Hardware->disable();
Log->stopLogWithAnnounce();
```

- The simulator halts after this instruction; PC points at the instruction after the TRAP. `runprog` then sets `runMode = false`, leaves full-screen mode if the main window is on the full-screen monitor, updates the register display and puts the menus in the "halted" state: Open, Run, Run To Cursor, Auto Trace, Step Over and Trace Into are disabled, Pause, Rewind and Close stay enabled, and Reload is not touched (`RUN.CPP:697-712`, `SIM68Ku.cpp:585-616`). No message is added to the message log. (Pressing Pause in this state re-enables the run commands, `SIM68Ku.cpp:525-539`, and Run would then continue with the instruction after the TRAP; this belongs to the debugger specification.)
- `Hardware->disable()` turns off the auto-interrupt timers and disables the hardware window's Reset/IRQ buttons (`hardwareu.cpp:907-919`).
- If logging is active a modal `Current Log Stopped.` box appears and the log files are closed.
- Files opened by the program are **not** closed and the I/O window content stays.
- Identical in effect to the `SIMHALT` pseudo-instruction (`$FFFF $FFFF`, `CODE9.CPP:1307-1322`), which runs the same five statements after advancing PC past its second word. `SIMHALT` can be switched off for a program by the listing comment `*[sim68k]simhalt_off` (`SIM68Ku.cpp:285`, `334-336`), in which case `$FFFF` is an ordinary line-1111 exception; task 9 cannot be switched off.

### Task 10 - print a NUL-terminated string on the printer

`CODE9.CPP:790-798`, helpers `CODE9.CPP:47-140`.

- Input: `A1` = address of a NUL-terminated string. **`D1` is ignored** (the comment at `CODE9.CPP:251-254` describing `D1.B` is obsolete). Memory-map check as in 1.3. Each byte is passed to `printChar`.
- Printer model. On the first character after start-up or after a form feed: `initPrint()` selects the default printer, the Printer Font (default Courier New 10), and computes `pageRowHeight = TextHeight("Xp")`, `pageColWidth = TextWidth("W")`, `pageTop = PageHeight/11`, `pageBot = PageHeight - pageTop`, `pageLeft = PageWidth/8`, `pageRight = PageWidth - pageLeft`, `pageX = pageLeft`, `pageY = pageTop`; then `BeginDoc()`.
- `printChar(ch)`:

| Byte | Action |
|---|---|
| `$08` BS | `pageX -= pageColWidth`, not left of `pageLeft` |
| `$09` HT | `pageX += 4*pageColWidth` then `nextX()` (so five columns in total, wrapping to the next line past the right margin) |
| `$0A` LF | `lineFeed()`: `pageY += pageRowHeight`; past `pageBot` -> `formFeed()` |
| `$0B` VT | `pageY += 4*pageRowHeight`; past `pageBot` -> remember the overflow, `formFeed()`, continue at `pageTop + overflow` |
| `$0C` FF | `formFeed()`: (start a document if none is open,) `EndDoc()`, `printing = false`, `pageY = pageTop` |
| `$0D` CR | `pageX = pageLeft` |
| `>= ' '` (signed compare) | draw the character at (`pageX`,`pageY`), then `nextX()`: `pageX += pageColWidth`; if `pageX > pageRight` then `pageX = pageX - pageRight + pageLeft` (the overshoot is carried to the new line, it is not reset exactly to the margin) and `lineFeed()` (`CODE9.CPP:66-73`) |
| everything else, **including `$80-$FF`** (negative as signed char) and BEL | ignored |

- The print job is only sent when a form feed ends the document (the help says "Always send a Form Feed character to end printing"). A page overflow ends the document (it does not start a second page of the same job); the next character starts a new document at the top-left margin.
- Confirming Options -> "Printer Font..." calls `initPrint()` immediately (`SIM68Ku.cpp:967-972`): the page position returns to the top-left margin and `printing` becomes `false` even if a document is open, so the next character starts a document again.
- Blocks: no (the Windows spooler is asynchronous). Registers unchanged. The printing code has no error handling of its own (for example for "no printer installed"): anything the printer library throws is caught only by the generic handler in `exec_inst`, which shows the box `ERROR: An exception occurred in routine 'exec_inst'.` with the PC and opcode and switches to trace mode (`RUN.CPP:1008-1014`).
- Port suggestion: accumulate the text into a "printer output" document and offer it for printing/saving at each form feed. The exact page geometry only matters if printed layout must match.

### Task 11 - cursor position / clear screen

`CODE9.CPP:799-806`:

```cpp
if ((unsigned short)D[1] == 0xFF00) simIO->clear();
else if ((unsigned short)D[1] == 0x00FF) simIO->getrc((short*)&D[1]);
else simIO->gotorc((char)D[1],(char)(D[1]>>8));
```

- `D1.W = $FF00`: **clear screen** - cursor to 0,0, whole canvas black (graphics too), `text[]` all spaces (`simIOu.cpp:1016-1035`). Fonts, colours, wrap and window size are unchanged.
- `D1.W = $00FF`: **get position** - `D1.W = (col << 8) | row` (column in the high byte, row in the low byte); **bits 31..16 preserved**.
- Otherwise: **set position** - row = low byte of `D1.W`, column = high byte of `D1.W`, **each taken as a signed byte**, then `gotorc(row, column)` (3.5). Consequently:
  - Row or column byte `$80-$FF` is negative and becomes 0.
  - A row beyond the last row **scrolls the screen up one row** and puts the cursor on the last row. It is not ignored.
  - A column beyond the right edge (up to 127): with wrap off the cursor is placed off-screen; with wrap on a CR+LF is performed from the current row (3.5 quirk).
  - Column 255 with row 0 and column 0 with row 255 cannot be requested (they are the two special values).
- Blocks: no.

### Task 12 - keyboard echo

`CODE9.CPP:807-812`. `D1.B == 0` -> `keyboardEcho = false`; any other `D1.B` -> `true`. Default `true`, restored by every `initSim`. Effects are described in 3.9 and task 5.

### Task 13 - display NUL-terminated string with CR, LF. Task 14 - the same without CR, LF

`CODE9.CPP:813-823`.

- Input: `A1` = address of a NUL-terminated string. There is **no length limit** in the code (the "max 255" in the source comment is not implemented): the whole string up to the first NUL is displayed through `charOut`. The port should stop at address `$FFFFFF`.
- Task 13 ends with `doCRLF()`; task 14 does not. Memory-map check as in 1.3. Blocks: no. Registers unchanged.

### Task 15 - display `D1.L` as an unsigned number in base `D2.B`

`CODE9.CPP:824-831`:

```cpp
if ((char)D[2]>=2 && (char)D[2]<=36) { ultoa(D[1], buf, (char)D[2]); AnsiString hex = buf; hex = hex.UpperCase(); simIO->textOut(hex.c_str()); }
```

- `D1.L` is treated as **unsigned**. Digits above 9 are **upper-case** letters A-Z. No prefix, no padding, no leading zeros (0 prints `0`). Base 2 of `$FFFFFFFF` prints 32 ones.
- `D2.B` outside 2..36 (as a signed byte): nothing is displayed. No CR/LF. Registers unchanged.

### Task 16 - input prompt and LF options

`CODE9.CPP:832-841`. `D1.B`: 0 -> `inputPrompt = false`; 1 -> `inputPrompt = true`; 2 -> `inputLFdisplay = false`; 3 -> `inputLFdisplay = true`; any other value -> nothing. Both default to `true` and are restored by `initSim`.

- `inputPrompt` controls the blinking underscore (3.8).
- `inputLFdisplay` is tested in exactly one place: the LF after Enter in task 5's blocking path (`simIOu.cpp:1346`). It has no effect on tasks 2, 4 and 18.

### Task 17 - display string, then `D1.L` as signed decimal

`CODE9.CPP:844-853`. Exactly task 14 on `(A1)` followed by task 3 on `D1.L`. No CR/LF. Memory-map check as in 1.3.

### Task 18 - display string, then read a number into `D1.L`

`CODE9.CPP:856-864`. Exactly task 14 on `(A1)` followed by task 4. Blocks.

### Task 19 - key state

`CODE9.CPP:866-868`, `getKeyState` `simIOu.cpp:584-612`.

- `D1.L == 0` on entry: `D1.L = (keyUpCode << 16) + keyDownCode` - the virtual-key code of the last key released in bits 23..16 and of the last key pressed in bits 7..0 (bits 31..24 and 15..8 are 0). Both are 0 after the window is activated or after task 58.
- `D1.L != 0`: each of the four bytes is a virtual-key code; the same byte position of the result is `$FF` if that key is currently down, `$00` if not. A zero byte in a non-zero request yields `$00`. All 32 bits are written.
- Does not block; does not consume `pendingKey`.
- Codes are Windows virtual-key codes. The help table (`keyCodes.htm:12-66`) lists: letters = the upper-case ASCII code; top-row digits `$30-$39`; Backspace `$08`; keypad 5 (Num Lock off) `$0C`; Enter and keypad Enter `$0D`; Shift `$10`; Ctrl `$11`; Alt `$12`; Pause `$13`; Caps Lock `$14`; Esc `$1B`; Space `$20`; Page Up `$21`; Page Down `$22`; End `$23`; Home `$24`; Left `$25`; Up `$26`; Right `$27`; Down `$28`; Insert `$2D`; Delete `$2E` (the keypad keys with Num Lock off give the same codes as the navigation keys printed on them: keypad 9/3/1/7 = `$21`-`$24`, 4/8/6/2 = `$25`-`$28`, 0 = `$2D`, `.` = `$2E`); keypad `*` `$6A`, `+` `$6B`, `-` `$6D`, `/` `$6F`; F1-F12 `$70-$7B`; Num Lock `$90`; Scroll Lock `$91`; `;` `$BA`; `=` `$BB`; `,` `$BC`; `-` `$BD`; `.` `$BE`; `/` `$BF`; `` ` `` `$C0`; `[` `$DB`; `\` `$DC`; `]` `$DD`; `'` `$DE`. "Modifier keys (Shift, Alt, Ctrl) do not change the key code returned" (`keyCodes.htm:16-17`); left and right Shift/Ctrl/Alt are not distinguished. Not in the help table but standard Windows values the handler would record just the same: keypad digits with Num Lock on `$60-$69`, keypad `.` with Num Lock on `$6E`. **Tab (`$09`) is not in the help table and its key-down probably never arrives** (3.9). F6-F10 and the other simulator shortcut keys are reported only after task 24 has disabled key commands (3.9). Mouse buttons are never reported. The port must translate browser key events to these codes.
- Key state is tracked only while the I/O window has focus and is wiped on every activation, so a key held while focus changes is seen as released.

### Task 20 - display `D1.L` as signed decimal in a field `D2.B` wide

`CODE9.CPP:869-872`: `sprintf(buf,"%*d",(char)D[2],D[1]);`

- `D2.B` is a **signed** byte. Positive width: right-justified, padded on the left with spaces. Zero: no padding. **Negative width: left-justified in a field of the absolute value, padded on the right with spaces** (C `printf` rule for a negative `*` width). A number longer than the field is printed in full. No CR/LF.

### Task 21 - text colour and font

`CODE9.CPP:873-875`, `setFontProperties(int c, int s)` `simIOu.cpp:935-994`, with `c = D1.L`, `s = D2.L`.

1. Start from a copy of the **Options font** (`FontDialogSimIO->Font`: its name, size, charset and style) - not from the font currently in use.
2. Colour = `D1.L` as a VCL `TColor`, i.e. `$00BBGGRR`. Values with a non-zero top byte are VCL/GDI special colours (system or palette colours); **UNVERIFIED** - the port should use the low 24 bits.
3. Style = none, then:

```cpp
if (s & 0x01) f->Style = TFontStyles()<< fsBold;
if (s & 0x02) f->Style = TFontStyles()<< fsItalic;
if (s & 0x04) f->Style = TFontStyles()<< fsUnderline;
if (s & 0x08) f->Style = TFontStyles()<< fsStrikeOut;
```
   Each line **replaces** the style set, so **only the highest set bit takes effect**: bits 0-3 are not combinable. `$5` (bold + underline) gives underline only.
4. `s = high word of D2.L`. If it is non-zero:
   - high byte selects the font name: 1 `Fixedsys`, 2 `Courier`, 3 `Courier New`, 4 `Lucida Console`, 5 `Lucida Sans Typerwriter` (misspelt in the source, `simIOu.cpp:974`, so Windows substitutes some other font - **UNVERIFIED** which), 6 `Consolas`, 7 `Terminal`; any other value keeps the Options font name;
   - then `f->Size = s & 0x00FF` unconditionally - the low byte is the point size, **even when it is 0** (a size of 0 lets Windows choose a default height - **UNVERIFIED**).
5. Assign the font to both canvases, call `setTextSize()` (new cell size and grid), then `gotorc(row, col)` (the cursor keeps its row/column numbers; its pixel position is recomputed; it may scroll once if the row no longer fits).

Notes:
- "High word = 0, keep current font" in the help really means **revert to the Options font**: a colour-only call undoes the name and size selected by an earlier task 21 call.
- Existing pixels are not redrawn and `text[]` is not re-laid-out.
- Blocks: no. Registers unchanged.

### Task 22 - read the character at row, column

`CODE9.CPP:876-878`, `getCharAt` `simIOu.cpp:1084-1096`.

- Inputs: row = high word of `D1.L`, column = low word of `D1.L` (unsigned). Row >= 128 is treated as 127, column >= 256 as 255.
- Output: `D1.B = text[row*textCols + column]`; **bits 31..8 of D1 are preserved** (they still hold the row/column the program passed).
- Returns what `charOut` stored (3.7): a space for never-written cells after a clear; typed input from tasks 2/4/18 and graphics text are not visible to it. Blocks: no.

### Task 23 - delay

`CODE9.CPP:879-885`:

```cpp
{uint n = (unsigned)D[1];
 while(n-- > 0 && runMode) { Application->ProcessMessages(); Sleep(10); }}
```

- Input: **`D1.L`**, unsigned, in 1/100 s (the comment at `CODE9.CPP:329-330` says `D1.W`; the code uses all 32 bits).
- The delay is at least `n * 10 ms`; on Windows each `Sleep(10)` usually lasts 10-16 ms, so real EASy68K delays tend to run long. The window stays responsive (keys typed go to `pendingKey` and the task-19 key table; repaint works).
- The loop ends early if `runMode` becomes false (Pause). **In Trace Into mode `runMode` is false, so the delay is skipped entirely.**
- Adds nothing to the cycle counter. Registers unchanged.

### Task 24 - enable/disable simulator key commands

`CODE9.CPP:886-892`. `D1.L == 0` -> `restoreMenuTask19()`; `D1.L == 1` -> `setMenuTask19()`; other values -> nothing (the comparison is on all 32 bits).

- `setMenuTask19()` (`SIM68Ku.cpp:619-633`) removes the keyboard shortcuts of Open (Ctrl+O), Run (F9), Step Over (F8), Trace Into (F7), Pause (F6), Rewind (Ctrl+F2), Reload (Ctrl+F3), Auto Trace (F10), Run To Cursor (Ctrl+F9), Log Start (Ctrl+F4), Log Stop (Ctrl+F5) and sets `disableKeyCommands = true`, which also disables Ctrl+Tab, Alt+Enter and Shift+Insert in the I/O window (`simIOu.cpp:428-432`) and F1/Ctrl+Tab in the main window (`SIM68Ku.cpp:1301-1312`). Find (Ctrl+F) and Go to PC (Ctrl+G) keep their shortcuts. Menu and toolbar clicks still work.
- `restoreMenuTask19()` (`SIM68Ku.cpp:636-650`) restores all of them. Also done by every `initSim`.
- Purpose: lets a game read F-keys with task 19 without triggering the debugger. While the shortcuts exist, pressing one of these keys in the I/O window runs the simulator command instead of reaching the program (3.9; help: "Disable simulator shortcut keys. All key codes are made available for 68000 program read using task 19", `textio.htm:322-325`). The port must reproduce both halves: with key commands enabled its own debugger shortcuts act while the I/O view has focus; after task 24 with `D1.L = 1` they must not act and the keys must be delivered to task 19.
- The setting is not tied to Run/Pause: it stays in force after the program pauses or halts, until task 24 is called with 0 or `initSim` runs (Rewind, Reload, Open, Close). While it is in force the Pause (F6), Rewind (Ctrl+F2) and Reload (Ctrl+F3) shortcuts are themselves removed, so the user must use the menu or toolbar to get control back.

### Task 25 - scroll a text rectangle

`CODE9.CPP:893-895`, `scrollRect(ushort r, ushort c, ushort h, ushort w, ushort dir)` `simIOu.cpp:1151-1272`.

- Inputs: top row `r` = high word of `D1.L`; left column `c` = low word of `D1.L`; height `h` (rows) = high word of `D2.L`; width `w` (columns) = low word of `D2.L`; direction = `D3.W`: 0 up, 1 down, 2 left, 3 right. (The header declares the parameters as `(r, c, w, h, dir)`, `simIOu.h:69`; the definition and the call agree on `(r, c, h, w, dir)`.)
- Rejected silently if `(r+h >= 128) || (c+w >= 256) || (w == 0) || (h == 0)`. Note `>=`: `r+h` may be at most 127 and `c+w` at most 255. The rectangle is not checked against the visible grid. Any other direction value does nothing.
- With `cw = colWidth`, `rh = rowHeight`, pixel rectangles (left, top, right, bottom):
  - `TopRect   = (c*cw, r*rh, (c+w)*cw, (r+h-1)*rh)`
  - `BotRect   = (c*cw, (r+1)*rh, (c+w)*cw, (r+h)*rh)`
  - `LeftRect  = (c*cw, r*rh, (c+w-1)*cw, (r+h)*rh)`
  - `RightRect = ((c+1)*cw, r*rh, (c+w)*cw, (r+h)*rh)`

| dir | Pixels (back buffer; mirrored to the window when not double buffered) | `text[]` (stride `textCols`) |
|---|---|---|
| 0 up | copy `BotRect` -> `TopRect`; fill the bottom row of the rectangle black | rows `r..r+h-1` each take the row below; then row `r+h-1` = spaces |
| 1 down | copy `TopRect` -> `BotRect`; fill the top row black | rows `r+h-1` down to `r+1` each take the row above; then row `r` = spaces |
| 2 left | copy `RightRect` -> `LeftRect`; fill the right column black | columns `c..c+w-1` each take the column to the right; then column `c+w-1` = spaces |
| 3 right | copy `LeftRect` -> `RightRect`; fill the left column black | columns `c+w-1` down to `c+1` each take the column to the left; then column `c` = spaces |

- Scrolls by one cell per call. Graphics pixels inside the rectangle move with the text. The vacated strip is black, not the fill colour. The cursor does not move. Blocks: no. Registers unchanged.

## 5. Tasks 30-33 (simulator environment)

### Task 30 - clear the cycle counter
`CODE9.CPP:897-899`: `cycles = 0;`

### Task 31 - read the cycle counter
`CODE9.CPP:900-905`: `D1.L = (uint)cycles`, or **0 if `cycles > 0xFFFFFFFF`**. `cycles` is 64-bit. Because TRAP #15 itself costs 0 cycles, two consecutive reads return the same value plus the cost of the instructions between them.

### Task 32 - hardware / simulator

`CODE9.CPP:906-936`, selector `(char)D[1]` (`D1.B`):

| D1.B | Action | Output |
|---|---|---|
| 0 | Show the Hardware window | - |
| 1 | - | `D1.L` = address of the 7-segment display (default `$00E00000`) |
| 2 | - | `D1.L` = address of the LEDs (default `$00E00010`) |
| 3 | - | `D1.L` = address of the toggle switches (default `$00E00012`) |
| 4 | - | `D1.L = VERSION = $00051001` for v5.16.1 (`def.h:24`) |
| 5 | `exceptions = true`; the Options -> "Enable Exceptions" item becomes checked; the settings file is saved, so the change **persists into later sessions** | - |
| 6 | `Hardware->setAutoIRQ((uchar)D[2], D[3])` | - |
| 7 | - | `D1.L` = address of the push buttons (default `$00E00014`) |
| other | nothing | - |

- Addresses are whatever is typed in the Hardware window's address fields, parsed as hex (`StrToInt("0x" + ...)`); defaults from `SIM68Ku.cpp:1518-1521`. Sub-tasks 1, 2, 3, 4 and 7 write all 32 bits of D1.
- Sub-task 6 (`hardwareu.cpp:831-903`): `D2.B = $00` disables all auto-interrupts and unchecks all seven boxes; `$01-$07` disables auto-interrupt 1-7; `$81-$87` sets that interrupt's timer interval to `D3.L` milliseconds and checks its box; any other `D2.B` does nothing. The interval is used as given (an interval of 0 never fires). The enable case does not start the timer itself: the timer starts through the check box's click handler, and only if the master flag `autoIRQ` is true (`hardwareu.cpp:1346-1392`). `autoIRQ` is true during a Run, false after Pause or a trace stop - **and false after a "disable all" (`D2.B = $00`), which calls `autoIRQoff()`** (`hardwareu.cpp:796-807`, `834-843`). So a program that disables all auto-interrupts and then enables one gets none until the next Run command. The full timer model is in `hardware.md`; this document only fixes the register interface.
- The help's version example ("3.9.10 is returned as 0003090A") matches the encoding: major in bits 23..16, minor in bits 15..8, revision in bits 7..0.

### Task 33 - output window size / mode

`CODE9.CPP:937-951`:

```cpp
if(D[1] == 1)       { simIO->fullScreen = false; simIO->setupWindow(); }
else if(D[1] == 2)  { simIO->fullScreen = true;  simIO->setupWindow(); }
else if(D[1])       { simIO->setWindowSize((short)(D[1]>>16),(short)D[1]); }
else                { ushort width, height; simIO->getWindowSize(width, height); D[1] = (((uint)width)<<16) + height; }
```

- `D1.L = 0`: **get** - `D1.L = (width << 16) + height` in pixels (640x480 gives `$028001E0`).
- `D1.L = 1`: windowed mode. `D1.L = 2`: full-screen mode (3.10).
- Any other value: **set** - width = high word, height = low word, each clamped up to at least 640 / 480, no maximum. Side effects (3.10): the canvas is **cleared to black**, the text grid is re-measured, but **the cursor is not moved and `text[]` is not cleared**. D1 is unchanged by a set.
- Blocks: no (a failed full-screen switch shows a modal message box).

## 6. Tasks 40-43 (serial port)

Common rules. The **port identifier (CID) is bits 31..16 of D0** (`cid = (unsigned int)D[0]; cid = cid>>16;` with `int cid`, `CODE9.CPP:962-963`), valid 0..15 (`MAX_COMM = 16`); every other value of the high word - including those with bit 31 set, which come out negative - is an invalid CID. The result is written to **`D0.W`**; bits 31..16 (the CID) are preserved. Result codes: 0 success, 1 invalid CID, 2 error, 3 port not initialised (tasks 41-43), 4 timeout (tasks 42-43). Ports are never closed by Rewind/Reload (`closeAllComm` at `simIOu.cpp:2051` has no caller); a port is closed only when task 40 is called again for the same CID.

A browser/macOS port has no Win32 COM ports. Faithful behaviour for "no such port" is: task 40 returns 2, tasks 41-43 return 3. If serial support is offered, the semantics below apply.

### Task 40 - initialise port
`CODE9.CPP:954-965`, `initComm` `simIOu.cpp:2068-2098`.
- Inputs: CID in D0 high word; `A1` = NUL-terminated port name (e.g. `COM4`), at most 255 characters used. Memory-map check as in 1.3.
- CID > 15 -> `D0.W = 1`. If the CID is already open it is closed first. The name is opened for exclusive read/write; failure -> `D0.W = 2`. On success the default parameters are applied by calling the task-41 routine with settings 0, and its result is returned.

### Task 41 - set port parameters
`CODE9.CPP:966-970`, `setCommParams` `simIOu.cpp:2121-2273`. Input `D1.L`:

| Bits | Meaning |
|---|---|
| 7..0 | baud: 0 = 9600 (default), 1 = 110, 2 = 300, 3 = 600, 4 = 1200, 5 = 2400, 6 = 4800, 7 = 9600, 8 = 19200, 9 = 38400, 10 = 56000, 11 = 57600, 12 = 115200, 13 = 128000, 14 = 256000; 15-255 have no case: the default text `9600,N,8,1` is kept and the parity/data/stop suffixes are appended to it, giving a malformed string such as `9600,N,8,1,N,8,1` (three bytes longer than its 14-byte buffer, `simIOu.cpp:2124`); the inter-character timeout stays 27 ms. The return value of `BuildCommDCB` is ignored (`simIOu.cpp:2266`), so the line settings most likely stay as they were and the result is 0 - **UNVERIFIED** |
| 9..8 | parity: 0 none, 1 odd, 2 even, 3 mark |
| 11..10 | data bits: 0 = 8, 1 = 7, 2 = 6, 3 = 8 |
| 12 | stop bits: 0 = 1, 1 = 2 |
| 31..13 | ignored |

- Results: 1 invalid CID; 3 not initialised; 2 if the port state cannot be read or set; else 0.
- Timeouts set here: inter-character read timeout by baud index `{0:27, 1:73, 2:27, 3:14, 4:7, 5:4, 6:2, 7..14:1}` ms (note index 0 and index 7 are both 9600 baud but use 27 and 1); total read timeout = `1 ms * bytes requested + 1 ms`; total write timeout = `timeout * bytes + 100 ms`.

### Task 42 - receive
`CODE9.CPP:971-975`, `readComm` `simIOu.cpp:2300-2333`.
- Inputs: CID; `A1` = buffer; `D1.B` = number of bytes wanted (0..255).
- Results: 1 / 3 as above; 2 on read error (D1 unchanged). Otherwise `D1.B` = bytes actually read (bits 31..8 preserved) and `D0.W = 4` if fewer than requested arrived, else 0.
- Data: a NUL is written directly at `(A1 + bytesRead)` when at least one byte arrived; then, if the memory-map check `Invalid | Read | Rom` passes, `strcpy((A1), InBuff)`. Quirks: `InBuff` is not NUL-terminated at `bytesRead`, so stale bytes from an earlier, longer read can be copied after the new ones; a received `$00` byte truncates the copy; when 0 bytes were read the previous contents of `InBuff` are still copied to `(A1)`. The memory-map check is made after `D0.W` and `D1.B` have been written and its result is not passed back: if it raises a bus error the exception or halt happens (1.3) but the task still "succeeds".
- Blocks for at most the read timeout.

### Task 43 - send
`CODE9.CPP:976-984`, `sendComm` `simIOu.cpp:2345-2369`.
- Inputs: CID; `A1` = data; `D1.B` = number of bytes (0..255). Memory-map check `Invalid` over `D1.B` bytes.
- Results: 1 / 3; 2 on write error; otherwise `D1.B` = bytes sent (bits 31..8 preserved) and `D0.W = 4` if fewer than requested, else 0.

## 7. Tasks 50-59 (files)

### 7.1 File model

- **Handles.** A table of `MAXFILES = 8` slots, each a C `FILE*` (`def.h:158-163`). The File-ID (FID) returned to the program is the slot index **0..7**; opening always takes the **lowest free slot**. A FID is valid if `0 <= fn < 8` and the slot is open; anything else gives error 2.
- **Maximum open files: 8.** A ninth open fails with `D0.W = 2` and `D1.L = $FFFFFFFF`.
- **Result codes**, always written to **`D0.W`** (bits 31..16 preserved): `F_SUCCESS = 0`, `F_EOF = 1`, `F_ERROR = 2`, `F_READONLY = 3` (`def.h:153-156`).
- **Binary only.** Every open uses a `b` mode (`"r+b"`, `"rb"`, `"w+b"`); there is no text mode, no CR/LF translation and no Ctrl-Z handling. Bytes move unchanged between the file and 68000 memory.
- **Position.** Each handle has its own position, starting at byte 0 for both open-existing and open-new (never append). Reads and writes advance it. Task 55 sets it absolutely. There is no task to read the position, seek relative/from the end, get the file size or truncate.
- **Buffering.** C stdio buffering: written data may not reach the host file until the file is closed (task 56 or 50). The help says so too.
- The `name` field of each slot is filled on open (`SIMOPS2.CPP:76`, `83`, `102`) and never read.
- **Path resolution.** Names are passed unchanged to `fopen`/`remove` (maximum 255 characters; longer names are cut at 255). Relative names resolve against the **process current directory**. Sim68K never sets it explicitly; in practice it is:
  - the folder of the source file, when Sim68K is started from the editor's Execute button (the editor does `SetCurrentDir(ExtractFilePath(...CurrentFile))` before assembling, `src-edit68k\Edit68Kv5.16.1\mainS.cpp:370`, and the simulator inherits it, `assembleS.cpp:36-37`);
  - the folder of the last file chosen in any Windows file dialog (File -> Open, Open Data, the log-file browse buttons, and the task-58 dialogs), because the standard dialogs change the current directory as a side effect (VCL/Windows behaviour, not in the reference tree);
  - otherwise the directory the simulator was started from.
  - **Port rule: resolve relative paths against the directory of the loaded program (.S68 / source) file.** A task-58 dialog should also move this base directory to the chosen file's folder if exact compatibility with that side effect is wanted.
- **Lifetime quirk.** `initSim` (Rewind, Reload, Open, Close) and task 9 do not close files: `initSim` just sets every `fp` to `NULL` (`STARTSIM.CPP:75-77`), abandoning the handles. On real EASy68K data written but not closed by the program is not flushed until the simulator exits, and the host file stays open until then (so it cannot be deleted, and a later task 57 on it fails). The port should flush and close abandoned files on reset (a deliberate, benign deviation) - or reproduce the delay if byte-exact parity of unflushed files is wanted.

### Task 50 - close all files
`CODE9.CPP:987-989`, `SIMOPS2.CPP:30-40`. Closes every open slot. `D0.W = 0`, or 2 if any `fclose` failed. Recommended by the help at the start of any program that uses files.

### Task 51 - open existing file
`CODE9.CPP:990-999`, `SIMOPS2.CPP:68-90`.
- Input: `A1` = NUL-terminated name. Memory-map check as in 1.3.
- Tries `fopen(name, "r+b")` (read/write, must exist). Success: `D0.W = 0`, `D1.L` = FID.
- Else tries `fopen(name, "rb")`. Success: **`D0.W = 3`** (file is read-only), `D1.L` = FID - the file **is open** and readable; writes to it fail with 2.
- Else, or if no slot is free: `D0.W = 2`, **`D1.L = $FFFFFFFF`** (-1).
- The file is not created if missing. Position 0.

### Task 52 - open new file
`CODE9.CPP:1000-1009`, `SIMOPS2.CPP:94-109`. `fopen(name, "w+b")`: creates the file, or **truncates an existing one to zero length**; readable and writable. Success: `D0.W = 0`, `D1.L` = FID. Failure or no free slot: `D0.W = 2`, `D1.L = $FFFFFFFF`.

### Task 53 - read
`CODE9.CPP:1010-1022`, `SIMOPS2.CPP:113-133`.
- Inputs: `D1.L` = FID; `A1` = buffer (low 24 bits); `D2.L` = number of bytes (unsigned).
- Order of checks:
  1. `if ((A1 & ADDRMASK) + D2 > MEMSIZE)` -> `D0.W = 2`, nothing read, D2 unchanged.
  2. `memoryMapCheck(Invalid | Read | Rom, A1, D2)`: `BUS_ERROR` -> bus error (1.3). If it returns `ROM_MAP` (buffer overlaps an enabled ROM region) the read is **skipped silently and D0 is not written at all** - it still holds the task number.
  3. Invalid FID -> `D0.W = 2`.
  4. `r = fread(buf, 1, D2, fp)`. If `r >= 1`: `D0.W = 0` and **`D2.L = r`** (bytes actually read; may be less than requested at end of file - a short read is a *success*). If `r == 0`: `D0.W = 1` if the end-of-file flag is set, else 2; **D2 is left unchanged** (it is not set to 0).
- So EOF (`D0.W = 1`) is reported only by a read that returns no bytes at all. A request for 0 bytes returns 2, or 1 if the handle's end-of-file flag is already set by an earlier read (a task 55 seek clears the flag).
- Bytes are copied straight into 68000 memory (no per-byte memory-map handling beyond step 2, no refresh of the Hardware or Memory windows, no write-breakpoint flag).
- The bound in step 1 is exactly `MEMSIZE`: a block that ends on the last byte (`A1 + D2 = $1000000`) is accepted.
- Hazard: step 1 is computed in 32-bit unsigned arithmetic (`CODE9.CPP:1012`), so it **wraps**: with `A1 = $1000` and `D2 = $FFFFFFFF` the sum is `$FFF`, the test passes, and `fread` is asked for 4 GB into the 16 MB array. On the original the read is then limited only by the length of the file: a file that fits is read to its end and reported as a normal success (`D0.W = 0`, `D2.L` = bytes read), a longer one overruns host memory. Port rule: evaluate the test with the same 32-bit wrap, and when it passes only because of the wrap, read at most `MEMSIZE - (A1 & ADDRMASK)` bytes. **UNVERIFIED**: that the Borland `fread` accepts a 4 GB count and simply stops at end of file - check `A1 = $2000`, `D2 = $FFFFFFFF` on a short file on real EASy68K.

### Task 54 - write
`CODE9.CPP:1023-1034`, `SIMOPS2.CPP:137-149`.
- Inputs: `D1.L` = FID; `A1` = data; `D2.L` = number of bytes.
- `(A1 & ADDRMASK) + D2 > MEMSIZE` -> `D0.W = 2`. Memory-map check `Invalid`. Invalid FID -> 2.
- `r = fwrite(buf, D2, 1, fp)` - one item of `D2` bytes - and `D0.W = 0` if `r >= 1`, else 2 (`SIMOPS2.CPP:145-148`). There is no partial-write result. Writing to a handle opened read-only (task 51 result 3) returns 2. D2 is never modified.
- **Zero-length write (`D2 = 0`): UNVERIFIED.** The result is whatever the C library's `fwrite` returns for an item size of 0. A C99 library (including the one the port is built with) returns 0, giving `D0.W = 2`; older Borland run-times returned the item count for a zero item size, which would give `D0.W = 0`. Check on real EASy68K and special-case `D2 = 0` in the port to match.
- The same 32-bit wrap as in task 53 exists in the bounds test (`CODE9.CPP:1025`); here a wrapped request makes the original read far past the 68000 memory array and crash or write garbage. The port must fail such a request with `D0.W = 2`.

### Task 55 - position
`CODE9.CPP:1035-1037`, `SIMOPS2.CPP:153-165`. Inputs: `D1.L` = FID, `D2.L` = absolute byte offset, passed as a signed `int` to `fseek(fp, offset, SEEK_SET)`. `D0.W = 0` when `fseek` returns 0, 2 on invalid FID or any other return. A negative offset (`D2.L >= $80000000`) is rejected by the C library, giving 2. Seeking past the end is allowed by stdio; a later write extends the file, a later read reports EOF. A successful seek clears the handle's end-of-file flag and makes it legal to switch between reading and writing.

### Task 56 - close
`CODE9.CPP:1038-1040`, `SIMOPS2.CPP:169-181`. Input `D1.L` = FID. Invalid/closed FID -> 2. Otherwise the slot is freed and `D0.W = 0` (2 if `fclose` reported an error; the slot is freed anyway).

### Task 57 - delete
`CODE9.CPP:1041-1050`, `SIMOPS2.CPP:185-190`. Input `A1` = NUL-terminated name. `remove(name)`: `D0.W = 0` on success, 2 otherwise. (On Windows deleting a file that is still open fails; the port's file system may allow it - make it fail for parity if the file is open in the table.)

### Task 58 - file dialog
`CODE9.CPP:1051-1053`, `displayFileDialog(long *mode, int A1, int A2, int A3, short *result)` `simIOu.cpp:468-563`.

- Inputs:
  - `D1.L` (all 32 bits): 0 = Open dialog, 1 = Save dialog. Any other value: nothing is shown, `D0.W = 0`, D1 unchanged.
  - `A1`: 0 (compared as the full 32-bit register) = default title; else address of a NUL-terminated title, at most 255 characters.
  - `A2`: 0 = all files; else address of a NUL-terminated list of patterns separated by semicolons, e.g. `*.txt;*.pcb`, at most 255 characters. The dialog filter is set to `ext + "|" + ext` (the pattern text is also its own description).
  - `A3`: address of a path buffer. It is always read (at most 255 characters); a non-empty string becomes the dialog's initial file name.
- Effects before the dialog: `clearKeys()` (task-19 key table and last-key codes zeroed); `D0.W = 0`.
- The dialog is **modal: the CPU is stopped until it closes**.
- Result:
  - Cancel/close: **`D1.L = 0`**, the buffer at `(A3)` is untouched, `D0.W = 0`.
  - OK: let `n = min(length of chosen full path, 255)`. If `(unsigned)(A3 + n) > MEMSIZE` (A3 **not** masked) -> `D0.W = 2` and return with D1 unchanged. Otherwise `strncpy((A3), path, 255); (A3)[255] = 0;` and **`D1.L = 1`**. Because `strncpy` pads with zeros, **exactly 256 bytes at `(A3)` are overwritten**, whatever the path length. The buffer must therefore be 256 bytes; the write goes straight into memory with no memory-map check.
- The returned path is the full absolute host path.
- Bugs in the Save branch, to reproduce only if byte-exact parity matters: when `(A3)` is empty the code clears the *Open* dialog's file name instead of the Save dialog's (so the Save dialog shows the name from its previous use), and the overflow check measures the Open dialog's file name instead of the Save dialog's (`simIOu.cpp:540-548`).
- No file is opened or created by this task; the Save dialog does not ask before overwriting.
- The dialogs are the `OpenDialogIO` / `SaveDialogIO` components of the I/O form with default options (`simIOu.dfm:65-72`). Components with the same names on the main form (`SIM68Ku.dfm:2292-2297`) are unused duplicates.

### Task 59 - file operation (does file exist?)
`CODE9.CPP:1054-1063`, `fileOp` `SIMOPS2.CPP:50-64`.
- Input: `A1` = NUL-terminated name. **`D1` is ignored** (the help reserves `D1.L = 0`); D1 is not modified.
- `fopen(name, "r+b")` succeeds -> `D0.W = 0` (exists, writable). Else `fopen(name, "rb")` succeeds -> `D0.W = 3` (exists, read-only). Else `D0.W = 2`. The file is closed again; no slot is used.
- Hazard: when the file does not exist the original calls `fclose(NULL)` (`SIMOPS2.CPP:63`). The Borland runtime evidently tolerates it (section 12, item 15); other C libraries crash. The result code is stored before the call, so the port simply guards it.

## 8. Register effects at a glance

| Task | Reads | Writes | Blocks |
|---|---|---|---|
| 0, 1 | D1.W (signed), A1 | - | no |
| 2 | A1 | memory at (A1); **D1.L** = length | yes |
| 3 | D1.L | - | no |
| 4 | - | **D1.L** | yes |
| 5 | - | **D1.B** | only if no key is pending |
| 6 | D1.B | - | no |
| 7 | - | **D1.B** = 0/1 | no |
| 8 | - | **D1.L** | no |
| 9 | - | (halts) | - |
| 10 | A1 | - | no |
| 11 | D1.W | get: **D1.W** | no |
| 12 | D1.B | - | no |
| 13, 14 | A1 | - | no |
| 15 | D1.L, D2.B | - | no |
| 16 | D1.B | - | no |
| 17 | A1, D1.L | - | no |
| 18 | A1 | **D1.L** | yes |
| 19 | D1.L | **D1.L** | no |
| 20 | D1.L, D2.B (signed) | - | no |
| 21 | D1.L, D2.L | - | no |
| 22 | D1.L | **D1.B** | no |
| 23 | D1.L | - | timed |
| 24 | D1.L | - | no |
| 25 | D1.L, D2.L, D3.W | - | no |
| 30 | - | - | no |
| 31 | - | **D1.L** | no |
| 32 | D1.B, (D2.B, D3.L) | sub 1,2,3,4,7: **D1.L** | no |
| 33 | D1.L | get: **D1.L** | no |
| 40 | D0 high word, A1 | **D0.W** | no |
| 41 | D0 high word, D1.L | **D0.W** | no |
| 42 | D0 high word, D1.B, A1 | **D0.W**, **D1.B**, memory | up to the timeout |
| 43 | D0 high word, D1.B, A1 | **D0.W**, **D1.B** | up to the timeout |
| 50 | - | **D0.W** | no |
| 51, 52 | A1 | **D0.W**, **D1.L** = FID or -1 | no |
| 53 | D1.L, D2.L, A1 | **D0.W**, memory, **D2.L** (only when bytes were read) | no |
| 54 | D1.L, D2.L, A1 | **D0.W** | no |
| 55 | D1.L, D2.L | **D0.W** | no |
| 56 | D1.L | **D0.W** | no |
| 57 | A1 | **D0.W** | no |
| 58 | D1.L, A1, A2, A3 | **D0.W**, **D1.L** = 0/1, 256 bytes at (A3) on OK | yes (modal) |
| 59 | A1 | **D0.W** | no |

## 9. Interaction with the debugger controls (summary)

- Run / Step Over: input tasks hold the CPU (3.9). Trace Into: they do not.
- Pause during input cancels the wait without delivering a result (3.9).
- Rewind / Reload / Open / Close run `initSim` (section 2): the screen is cleared, echo/prompt/LF options return to defaults, the type-ahead key is dropped, key commands are re-enabled, the file table is forgotten.
- Task 9 and `SIMHALT` leave the debugger in the halted state: the run commands are disabled and the normal way on is Rewind or Reload (Pause re-enables them, see task 9).
- Run moves the keyboard focus to the I/O window; a trace stop moves it back to the main window unless an input is pending (`RUN.CPP:714-717`).
- Pause and Rewind end a task-23 delay at once (`runMode` becomes false). Rewind during a pending input or delay runs `initSim` from inside the wait loop; the interrupted TRAP has already returned, so nothing is written afterwards.
- The help states that the Auto Trace, Trace and Step buttons are disabled while the program waits for input (`SIMHELP\BasicOperation.htm:120-121`). The source re-enables them after a traced instruction that started an input (`RUN.CPP:707-711`); only Auto Trace actually waits (`SIM68Ku.cpp:1341`).

## 10. Help pages versus source

| # | Help says | Source does | Citation |
|---|---|---|---|
| 1 | Task 16, `D1.B = 2/3`: suppress/show the line feed when Enter is pressed "during Trap task #2 input" (`textio.htm:193-196`) | The flag is tested only for task 5's blocking read. Task 2 (and 4, 18) always performs CR+LF | `simIOu.cpp:1346`, `1352` |
| 2 | Task 2: length returned in `D1.W`, "max 80" (`textio.htm:45-48`) | Length is written to all of `D1.L`; at most 79 characters are stored (80 bytes with the NUL); the 80th key press ends input and is discarded | `CODE9.CPP:752`, `simIOu.cpp:1339`, `1358` |
| 3 | Task 11: "Out of range coordinates are ignored"; COL 0-255, ROW 0-128 (`textio.htm:103-109`) | Row and column are signed bytes; negative -> 0; a row past the bottom scrolls one line; a column past the edge is accepted (or wraps) | `CODE9.CPP:805`, `simIOu.cpp:1039-1068` |
| 4 | Task 21 example: `D2.L = $01090005` is "Fixedsys, 9 point, Bold Underline" (`textio.htm:299-300`) | Style bits overwrite each other; that value gives underline only | `simIOu.cpp:943-955` |
| 5 | Task 21: "High word = 0, keep current font" (`textio.htm:272-273`) | High word 0 reverts to the Options font | `simIOu.cpp:940`, `958-959` |
| 6 | Task 21 font 5 is "Lucida Sans Typewriter" (`textio.htm:293-294`) | The name requested is `Lucida Sans Typerwriter` (does not exist) | `simIOu.cpp:974` |
| 7 | Task 25: "Top + Height max 128", "Left + Width max 255" (`textio.htm:337-340`) | Rejected when `r+h >= 128` or `c+w >= 256`, so the maxima are 127 and 255 | `simIOu.cpp:1156` |
| 8 | Task 13/14: source comment says "max 255" (`CODE9.CPP:273-274`); the help gives no limit | No limit | `CODE9.CPP:813-823` |
| 9 | Task 23: source comment says `D1.W` (`CODE9.CPP:329-330`); help says `D1.L` (`textio.htm:315`) | `D1.L`; no delay at all in Trace Into mode | `CODE9.CPP:880-884` |
| 10 | Task 10: source comment describes `D1.B = 00 print / 01 end` (`CODE9.CPP:251-254`); help does not mention D1 | D1 is ignored | `CODE9.CPP:790-798` |
| 11 | Task 59: "D1.L = 0 does file exist?", other values reserved (`fileio.htm:164-171`) | D1 is ignored | `SIMOPS2.CPP:50-64` |
| 12 | Task 53: "EOF may cause a shortened read" (`fileio.htm:76-77`) | True, and the short read returns success; EOF code 1 comes only from a read of zero bytes, which leaves D2 unchanged | `SIMOPS2.CPP:121-131` |
| 13 | Task 58 default title "'Open' or 'Save'" (`fileio.htm:138-139`); source comment says "'Load file' or 'Save file'" (`CODE9.CPP:454-455`) | The title is set to the empty string, so the operating system's default dialog title is used | `simIOu.cpp:500-503`, `530-533` |
| 14 | Tasks 42/43 source comment: "will timeout after 100 milli-seconds" (`CODE9.CPP:407`, `418`) | Read total timeout is `bytes + 1` ms; write total timeout is `timeout*bytes + 100` ms | `simIOu.cpp:2257-2263` |
| 15 | Serial help calls the identifier "PID"; the source comment calls it "CID" | Same thing: D0 bits 31..16 | `CODE9.CPP:962-963` |
| 16 | Tab is "horizontal 5 characters" (`textio.htm:358`) | Agrees: `col += 5`, not tab stops | `simIOu.cpp:848-849` |
| 17 | Source comment for task 11: columns 0-79, rows 0-24 (`CODE9.CPP:257-260`) | Obsolete; the grid is computed from window and font size | `simIOu.cpp:392-408` |
| 18 | Buttons disabled while waiting for input (`SIMHELP\BasicOperation.htm:120-121`) | Not enforced for Trace/Step | `RUN.CPP:707-711` |
| 19 | Task 58: title, extension list and path are "max 256" (`fileio.htm:136-147`) | 255 characters of each are used; the path returned is at most 255 characters plus a NUL, zero-padded to exactly 256 bytes | `simIOu.cpp:480-496`, `522-523` |
| 20 | Task 7: "Use task 2 or 5 to read pending key" (`textio.htm:76`) | Tasks 4 and 18 consume the pending key in the same way, as the first key of the line | `simIOu.cpp:1317-1320` |
| 21 | Task 24: "Shortcuts are restored by Rewind or Reload" (`textio.htm:328`) | Restored by every `initSim`: Rewind, Reload, Open and Close | `STARTSIM.CPP:124` |
| 22 | Key code table has no entry for Tab (`keyCodes.htm:18-20`); `textio.htm` says nothing about it | The handlers would record `$09` like any other key if the key-down reached them; the framework most likely consumes it first (3.9) | `simIOu.cpp:417-449` |
| 23 | Task 54: "(unaltered upon return)" and no word on length 0 (`fileio.htm:85-89`) | D2 unaltered - agrees; the result for `D2 = 0` depends on the C library | `SIMOPS2.CPP:137-149` |
| 24 | Task 41: data-bits values 0-2 documented (`SerialIo.htm:72-74`) | Value 3 selects 8 data bits | `simIOu.cpp:2230-2243` |

## 11. Hazards for the port

1. **Asynchronous input.** The original writes D1/memory from a key handler after `TRAP()` has returned. The WASM core must expose "input pending" plus a completion entry point (string, number or single character), and the run loop must not execute instructions while it is pending in Run/Step mode - but must be able to in Trace mode.
2. **`simIOu.cpp` is GUI code** and will be rewritten; its quirks listed here (eager wrap, single scroll, `text[]` stride, echo-off cursor movement, 79-character limit, one-key type-ahead, task-5 path differences, prompt timing) are behaviour students see and must be carried over deliberately.
3. **Font metrics.** Cell size comes from Windows GDI measurements of a Windows font. A browser canvas with a system font will not give 8x15. Ship a pixel-exact Fixedsys-style bitmap font for the default, and a measured table for the other task-21 fonts.
4. **Text background = fill colour** and **text moves the graphics pen** (3.1). Coordinate with the graphics specification.
5. **Scrolling moves graphics** and clears with black, not the fill colour.
6. **`charInput` is never reset** except by a key press. After Pause or Rewind during a pending task 5, the next task 2/4/18 behaves as a single-character read (first key ends it, `D1.B` gets the key, no string or number is produced). Decide whether to reproduce (faithful) or reset in `initSim` (safer); it is reachable by a student who pauses at a character prompt.
7. **Undefined behaviour in the original** that must not crash the port: negative `D1.W` in tasks 0/1 (`buf[negative] = 0`); strings running past `$FFFFFF`; `fclose(NULL)` in task 59; `strcpy` from an unterminated buffer in task 42 and the NUL it writes at `(A1 + count)` with no wrap or bounds test; the three-byte overrun of the settings string for baud index 15-255 in task 41; the 256-byte write at `(A3)` near the top of memory in task 58; wrapped byte counts in tasks 53 and 54.
8. **Non-standard library calls** in the compiled core: `itoa`, `ultoa`, `gettime`/`struct time` (dos.h), `AnsiString::UpperCase`, `Sleep`, `Application->ProcessMessages`. Their replacements must match the formats stated here (signed minimal decimal; unsigned any-radix upper-case; local time in hundredths).
9. **`memoryMapCheck(Invalid | Read | Rom, ...)`** passes an `int` where an enum `maptype` is declared (`CODE9.CPP:1016`, `simIOu.cpp:2331`); Borland accepts it, standard C++ compilers reject it.
10. **Signed `char`.** Dispatch, task 11 coordinates, task 20 width, task 15 radix and the printable test depend on `char` being signed. Emscripten's default is signed; do not compile with `-funsigned-char`.
11. **Zero cycle cost** of TRAP #15: programs that measure time with task 31 depend on it.
12. **Task 23 timing**: 10 ms per unit minimum, skipped in Trace mode, interruptible by Pause. In a browser the wait must be asynchronous, not a busy loop.
13. **File semantics on a virtual file system**: lowest-free-slot FIDs, `r+b` then `rb` fallback (result 3), truncation by task 52, short-read success, EOF only on a zero-byte read, D2 untouched on EOF, zero-length read returning 2 (zero-length write: see task 54), relative paths against the program's folder, no implicit close on reset. Mixing reads and writes on one handle without an intervening task 55 is formally undefined in C stdio; behaviour may differ between Borland's runtime and the port's C library - test it.
14. **File names are Windows paths.** The name is handed to the Windows C library unchanged, so student programs may use `\` or `/` as the directory separator, drive letters, and any letter case (Windows matches file names case-insensitively). On macOS and in a browser file system `\` is an ordinary character and names are case-sensitive. The port must at least treat `\` as a separator and should match names case-insensitively when an exact match is not found, or programs that work on real EASy68K will get `D0.W = 2`. (Platform behaviour, not in the simulator source.)
15. **Bounds tests that wrap** in tasks 53 and 54 (32-bit unsigned sum of address and count); see those tasks.
16. **Keys the original never delivers**: plain Tab, and the simulator's own shortcut keys while key commands are enabled (3.9). A browser delivers Tab (and moves focus with it) and has its own reserved keys (F5, F11, Ctrl+W ...); decide per key and document the result.
17. **Keyboard focus**: Run and every input task put the focus on the I/O window in the original (3.9). In the port, starting a run and starting an input task must focus the I/O canvas.
18. **Task 32 sub-task 5 persists** (settings file). In the port, "exceptions enabled" set by a program should persist the same way or the difference should be documented.
19. **Key codes** for task 19 are Windows virtual-key codes; browser `KeyboardEvent.code` values must be mapped. Focus loss must clear the table as window activation does.
20. **Log bugs**: `startLog()` sets `logging = true` even when preparing the files failed or was cancelled (`logU.cpp:227-235`), and `stopLog()` closes both log files whether or not they were opened (`logU.cpp:202-214`); do not reproduce writes to, or closes of, an unopened log. The Rewind/Reload marker depends on a stale copy of the log type (3.11) - decide whether to reproduce that or always write the marker.
21. **Memory map from the program file**: `MEMORY` directives travel in the `.S68` file and switch on the bus-error and ROM checks used by these tasks (1.3); the loader of the port must apply them before the program runs.

## 12. UNVERIFIED items (cannot be settled from the reference tree)

1. Exact GDI cell sizes for every font/size/style reachable through task 21 and the font dialog. Only Fixedsys 9 = 8x15 is established (measured on the help screenshot `SIMHELP\IMAGES\BasicOp\OutputWindowPic.GIF`, see 3.2).
2. Whether bold (or italic) changes `TextWidth("W")` for bitmap fonts, i.e. whether task 21 bold changes the grid.
3. Which font Windows substitutes for the misspelt `Lucida Sans Typerwriter`, and what a point size of 0 selects.
4. Whether, after Rewind/Reload following a task-21 font change, the form canvas font (which is the one measured for the cell size) really returns to the Options font. What the source shows: task 21 assigns its font to `BackBuffer->Canvas->Font` and to the form's `Canvas->Font` directly (`simIOu.cpp:985-986`); `initSim` re-measures the cell from the form canvas first (`STARTSIM.CPP:40`) and only then assigns the Options font to `BackBuffer->Canvas->Font` and to the form's own `Font` property - not to `Canvas->Font` (`STARTSIM.CPP:46-47`). The form's `Font` property was never changed by task 21, so this second assignment changes nothing on the form, and whether the framework nevertheless pushes it to the form canvas cannot be read from the tree. If it does not, real EASy68K after a Rewind keeps the task-21 cell size, draws new text on the visible window in the task-21 font and colour, and in the Options font on the back buffer (so the text changes appearance at the next repaint), until the program calls task 21 again or a different Options font is chosen. Test on real EASy68K: task 21 with red and a different font, Rewind, then task 6 and task 11 get-position. Recommended port behaviour unless that test shows otherwise: on every reset, restore the Options font, colour and cell metrics on both surfaces.
5. VCL `TextOut` moving the pen position and using the brush colour as an opaque background (documented VCL behaviour; the VCL source is not in the tree).
6. `atoi` overflow behaviour of the Borland runtime (task 4/18).
7. The glyph drawn for control codes echoed during string input (`$09`, Esc, Ctrl+letter) in Fixedsys.
8. Display result of tasks 0/1 with negative `D1.W` on real EASy68K.
9. Colour values with a non-zero top byte in task 21.
10. Behaviour of task 41 with baud index 15-255.
11. Whether the same host file can be opened in two slots at once on Windows with the Borland runtime.
12. Real-world duration of task 23 on current Windows (10 ms vs about 15.6 ms per unit).
13. Keys consumed by the VCL framework before the I/O form's handlers run (3.9): that plain Tab produces neither a key-down nor a character, and that the main window's shortcut keys act (and are swallowed) while the I/O window has the focus. Both agree with `keyCodes.htm` but neither is visible in the simulator source. It is also not visible whether a shortcut whose command is currently disabled (Run, Step Over and Trace Into while the program is running) is still swallowed. Test: task 19 polling `$09` while Tab is held; task 5 followed by the Tab key; task 19 polling `$75` (F6) and `$78` (F9) while the key is held, before and after task 24.
14. The result of task 54 with `D2 = 0` (depends on the Borland `fwrite`), and of task 53 with a byte count that wraps the 32-bit bounds test (depends on the Borland `fread`).
15. That `fclose(NULL)` in task 59 is harmless in the Borland runtime. It is inferred from the fact that "file does not exist" is the task's main use; the result code is already stored before the call, so the port simply skips the call.
16. What `OnActivate` covers: the task-19 key table is cleared in the form's `OnActivate` handler (`simIOu.cpp:615-618`). In VCL that event fires when the form becomes the active form of the application (focus arriving from another simulator window, or the window being shown), not necessarily when the whole application regains focus from another program. The port clears the table whenever the I/O view gains focus.

## 13. Conformance checks derived from this specification

Each line is an input and the result the source dictates. Run them on real EASy68K v5.16.1 and on the port.

Text output
- Task 14 with `'AB',0` at home: `A` at (row 0, col 0), `B` at (0,1), cursor (0,2). Task 11 get then returns `D1.W = $0200`.
- Task 13 with an empty string: cursor moves to column 0 of the next row.
- Task 0 with `D1.W = 3` and text `'ABCDE'`: displays `ABC` then CR+LF. With `D1.W = 300` and a 300-character text: 255 characters. With `D1.W = 5` and text `'AB',0,'CD'`: `AB`.
- Task 6 with `$09` at column 0: cursor at column 5. Task 6 with `$08` at column 0: stays at column 0. Task 6 with `$08` after `ABC`: cursor on the `C`, `C` still visible.
- Task 6 with `$0A` on the last row: screen scrolls one row, cursor stays on the last row, same column.
- Task 6 with `$0B` on row 30 of 32: one scroll, cursor on row 31.
- Task 6 with `$0C`: screen black, cursor home.
- Task 6 with `$01`, `$1B` or `$00`: nothing happens. Task 6 with `$7F` or `$E9`: a glyph is drawn and the cursor advances.
- 81 printable characters from column 0, wrap off: 80 visible, cursor column 81 (task 11 get gives column `$51`), nothing on the next row. Task 22 at (row 1, col 0) returns the 81st character (stride aliasing).
- The same with wrap on: the 80th character leaves the cursor at (next row, 0); the 81st is printed there.
- With wrap on, printing in the bottom-right cell scrolls the screen immediately.
- Task 3 with `D1 = $FFFFFFFF`: `-1`. Task 15 with `D1 = $FFFFFFFF`, `D2.B = 16`: `FFFFFFFF`; `D2.B = 2`: thirty-two `1`s; `D2.B = 1` or 37: nothing; `D1 = 255`, `D2.B = 36`: `73`.
- Task 20 with `D1 = 42`: `D2.B = 5` -> three spaces then `42`; `D2.B = $FB` (-5) -> `42` then three spaces; `D2.B = 1` -> `42`.
- Task 17 with `'N='`,0 and `D1 = -5`: `N=-5`.
- Task 81 (fill colour) set to blue, then task 14: characters have blue cell backgrounds. Task 11 `$FF00`: screen is black, not blue.
- Draw a graphics line across the screen, then scroll with LF on the last row: the line moves up one text row.

Cursor
- Task 11 with `D1.W = $0A05`: cursor at column 10, row 5. `D1.W = $0A28` (row 40) on a 32-row screen: one scroll, cursor row 31, column 10. `D1.W = $8005`: column 0, row 5. `D1.W = $00FF`: get. `D1.W = $FF00`: clear.
- Task 11 get preserves D1 bits 31..16.

Input
- Task 2, type `abc` Enter: memory `61 62 63 00`, `D1.L = 3`, cursor at column 0 of the next row. With `D1 = $FFFFFFFF` beforehand, `D1.L = 3` afterwards.
- Task 2, type 79 characters then any key: input ends, 79 characters stored, the last key is not stored.
- Task 2, type `ab`, Backspace, `c`, Enter: `ac`. Backspace on an empty line: nothing.
- Task 2 after task 16 with `D1.B = 2`: Enter still moves to the next row.
- Task 2 after task 12 with `D1.B = 0`: the typed characters are not drawn; the cursor (and with it the blinking underscore) still advances one column per character; Enter still does CR+LF; the string is returned.
- Task 4: `123` -> 123; `-45` -> `$FFFFFFD3`; `12x` -> 12; `x` -> 0; empty -> 0; `$10` -> 0.
- Press a key while the program is in a task-23 delay, then task 7: `D1.B = 1`; task 5: returns that key without waiting; task 7 again: 0. Press three keys during the delay: only the last is returned.
- Press Enter during a delay, then task 2: returns at once with length 0.
- Task 5 (waiting) + Enter: `D1.B = $0D`, cursor at column 0 of the next row. After task 16 `D1.B = 2`: cursor at column 0 of the **same** row.
- Task 5 preserves D1 bits 31..8. Task 7 preserves D1 bits 31..8.
- Task 5 in Trace Into mode: the simulator returns to the debugger immediately; typing the key later sets `D1.B`.
- Task 19 with `D1 = 'A'<<24 + 'S'<<16 + 'D'<<8 + 'F'` while S is held: `$00FF0000`. With `D1 = 0` after pressing and releasing Q: `$00510051`.
- Task 22 after task 14 `'HI'` at home with `D1 = $00000001`: `D1 = $00000049`. Task 22 on a typed (task 2) character: `$20`.
- Click Run while the main window has the focus, with the I/O window visible: the I/O window comes to the front and what is typed next reaches task 2 / task 5 without a mouse click.
- Task 2, press the Tab key: expected no effect at all (framework behaviour - confirm on real EASy68K). Task 2, press Ctrl+I: one glyph is echoed, the cursor advances one column and `$09` is stored. Task 5 (waiting), Ctrl+I: `D1.B = $09`, cursor five columns right.
- A loop that polls task 19 with `D1 = $75` (F6): with key commands enabled, pressing F6 in the I/O window pauses the simulator and the program never sees `$FF`; after task 24 with `D1 = 1`, F6 does not pause and the poll returns `$000000FF` while the key is held. The same loop with `D1 = $78` (F9, whose command is disabled while the program runs): expected `$00` before task 24 and `$FF` after (framework behaviour - confirm on real EASy68K).
- Print `HELLO`, move the cursor back onto the `H` with task 11, call task 2 (prompt on) and press Enter at once: the `H` is blanked on screen, task 22 still returns `H` for that cell, and the `H` reappears at the next repaint (for example after a following task 14).
- Task 2 with `A1 = $FFFFFE`, type `abc` Enter: bytes land at `$FFFFFE`, `$FFFFFF`, `$000000`, `$000001` (24-bit wrap).

Timing and environment
- Task 8 twice around a task 23 with `D1 = 100`: difference >= 100.
- `MOVEQ #30,D0` / `TRAP #15` / `MOVEQ #31,D0` / `TRAP #15`: `D1 = 4` (the second `MOVEQ` costs 4 cycles, `CODE1.CPP:388`; the TRAPs cost 0).
- Task 32 `D1.B = 4`: `D1 = $00051001`. `D1.B = 1`: `$00E00000`; 2: `$00E00010`; 3: `$00E00012`; 7: `$00E00014`.
- Task 33 `D1 = 0`: `$028001E0`. Task 33 `D1 = $03200258`: window 800x600, screen black, cursor position unchanged; then `D1 = 0` returns `$03200258`. Task 33 `D1 = $00640064`: window becomes 640x480.
- `D0 = $00000063` (task 99, unassigned) with exceptions off: halt with `TRAP exception occurred at location ...`. `D0 = $0000001A` (task 26, unassigned): the same. `D0 = $0000010E`: behaves as task 14 (only `D0.B` is examined).

Files
- Task 52 `'t.bin'` -> `D0.W = 0`, `D1 = 0`. Second task 52 `'u.bin'` -> `D1 = 1`. Close FID 0, open another -> `D1 = 0` again (lowest free slot).
- Nine opens without closing: the ninth gives `D0.W = 2`, `D1 = $FFFFFFFF`.
- Task 51 on a missing file: `D0.W = 2`, `D1 = $FFFFFFFF`; the file is not created.
- Task 51 on a read-only file: `D0.W = 3`, valid FID; task 53 works; task 54 gives 2.
- Write 10 bytes, task 55 to 0, read 20 bytes: `D0.W = 0`, `D2 = 10`. Read again 20 bytes: `D0.W = 1`, `D2` still 20.
- Task 53 with `D2 = 0` on a freshly opened file: `D0.W = 2`. Task 54 with `D2 = 0`: record what real EASy68K returns (0 or 2, see task 54) and make the port match.
- Task 53 with `A1 = $2000`, `D2 = $FFFFFFFF` on a 10-byte file: expected `D0.W = 0`, `D2 = 10` (32-bit wrap in the bounds test; confirm on real EASy68K).
- Task 53/54/55/56 with FID 8, -1, or a closed FID: `D0.W = 2`.
- Task 53 with `A1 = $FFFFF0`, `D2 = $20`: `D0.W = 2`, nothing read.
- Task 55 with `D2 = $FFFFFFFF` (offset -1): `D0.W = 2`.
- Task 59 on a writable file: 0; read-only: 3; missing: 2 (and no crash). D1 unchanged.
- Task 57 on an existing closed file: 0; again: 2.
- Task 50 with nothing open: 0.
- After any file task, D0 bits 31..16 are unchanged and `D0.B` no longer holds the task number.
- Task 58 cancel: `D1 = 0`, buffer unchanged. OK: `D1 = 1`, path at `(A3)`, and bytes after the path up to offset 255 are zero.

Serial (no port available)
- Task 40 with CID 16 (`D0 = $00100028`): `D0.W = 1`. With CID 0 and a non-existent port name: `D0.W = 2`. Task 41/42/43 on an unopened CID: `D0.W = 3`.

Memory map and log
- A program containing `MEMORY INVALID $8000,$8FFF`, exceptions off, task 14 with `A1 = $8000` and a non-empty string there: nothing is displayed, the simulator halts, and the message log gains `Bus Error: Instruction at <pc> accessing address 8000` followed by `Execution halted`. Task 13 with `A1 = $7FFE` pointing at a 4-character string: the same with address `7ffe` (the check covers the whole string, the message names its first byte). An empty string at `$8000` raises nothing.
- A program containing `MEMORY ROM $8000,$8FFF`, task 2 with `A1 = $8000`: input works, `D1.L` is the length, memory is unchanged. Task 53 with `A1 = $8000` and `D2 = 4`: nothing is read and D0 still holds `$35` in its low byte.
- Output log, type `Text Only`, started: task 13 `'AB'` writes the bytes `41 42 0A`; task 6 with `$0D` then `$0A` writes `0D 0A`; task 6 with `$07` writes nothing; `abX`, Backspace, `c`, Enter typed into task 2 writes `61 62 58 63 0A`.

## 14. Completeness checklist

Case labels in `TRAP()` within scope, each covered above: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 31, 32 (sub-cases 0, 1, 2, 3, 4, 5, 6, 7), 33, 40, 41, 42, 43, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59. Out-of-scope labels listed in 1.2: 60, 61, 62, 70-77, 80-96, 100-107.

`TsimIO` functions used by tasks 0-59, each covered: the constructor (initial state, `simIOu.cpp:73-132`) and destructor (leaves full-screen mode), `setWindowSize`, `setupWindow`, `getWindowSize`, `FormPaint`, `setTextSize`, `FormResize`, `FormKeyDown`, `FormKeyUp`, `FormKeyPress`, `FormActivate`, `clearKeys`, `displayFileDialog`, `BringToFront`, `getKeyState`, `charOut`, `textOut`, `textOutCR`, `setFontProperties`, `doCRLF`, `clear`, `gotorc`, `getrc`, `getCharAt`, `setTextWrap`, `scroll`, `scrollRect`, `charIn`, `textIn`, `promptTimer`, `erasePrompt`, `closeAllComm`, `initComm`, `setCommParams`, `closeComm`, `readComm`, `sendComm`. Not covered here (other agent), listed so that nothing falls between the two documents: mouse handlers `FormMouseDown`, `FormMouseUp`, `FormMouseMove`; sound `playSound`, `loadSound`, `playSoundMem`, `controlSound`, `playSoundDX`, `loadSoundDX`, `playSoundMemDX`, `stopSoundMemDX`, `controlSoundDX`, `InitDirectXAudio`, `LoadSegment`, `PlaySegment`, `PlaySegmentLoop`, `StopSegment`, `CloseDown`, `ResetSounds`; graphics `drawPixel`, `getPixel`, `line`, `lineTo`, `moveTo`, `getXY`, `setLineColor`, `setFillColor`, `rectangle`, `ellipse`, `floodFill`, `unfilledRectangle`, `unfilledEllipse`, `setDrawingMode`, `setPenWidth`, `drawText` (`drawText`, `setDrawingMode`, `setFillColor` and `getXY` are mentioned above only where they touch text); network `createNetClient`, `createNetServer`, `sendNet`, `receiveNet`, `sendPortNet`, `receivePortNet`, `closeNetConnection`, `getLocalIP`. The key-up/key-down interrupt hooks inside `FormKeyDown`/`FormKeyUp` (task 62) also belong to the other document.

Other functions covered: `closeFiles`, `fileOp`, `openFile`, `newFile`, `readFile`, `writeFile`, `positionFile`, `closeFile`, `deleteFile` (`SIMOPS2.CPP`); `formFeed`, `lineFeed`, `nextX`, `initPrint`, `printChar` (`CODE9.CPP`); `memoryMapCheck`, `mem_put` as used by tasks; `initSim`; `runprog` wait loop; `setMenuTask19`, `restoreMenuTask19`, `WindowSizeClick`, `WindowSizeChecked`, `OutputWindowTextWrap1Click`, `FontOutputExecute`, `FontDialogSimIOApply`, `FontPrinterExecute`, `RunExecute` (focus), `PauseExecute`, `RewindExecute`, `ReloadExecute`, `SaveSettings` / `LoadSettings` / `defaultSettings` (output font, log types); `haltSimulator`; the memory-map part of `loadSrec`; `THardware::setAutoIRQ`, `enable`, `disable`; `TLog::OKBtnClick`, `CancelBtnClick`, `FormShow`, `startLog`, `stopLog`, `stopLogWithAnnounce`, `prepareLogFile`, `setLogFileNames`, `addMessage`.

Global flags covered in section 2: `row`, `col`, `textX`, `textY`, `rowHeight`, `colWidth`, `textRows`, `textCols`, `text`, `canWidth`, `canHeight`, `doubleBuffer`, `textWrap`, `keyboardEcho`, `inputPrompt`, `inputLFdisplay`, `pendingKey`, `inputMode`, `charInput`, `keyBuf`, `keyI`, `userBuf`, `inputLength`, `inputNumber`, `inputCh`, `inputBuf`, `inputSize`, `promptVisible`, `keys`, `keyDownCode`, `keyUpCode`, `disableKeyCommands`, `files`, `hComm`, `InBuff`, `cycles`, `logging`, `OlogFlag`, `OlogFile`, `printing` and the page variables, `exceptions`, `runMode`, `halt`, `trace`, `fullScreen`, `FullScreenMonitor`. Unused globals in `simIOu.cpp` (declared, never read): `x`, `y`, `r` (`simIOu.cpp:27`, `48`), `savedLeft`/`savedTop` (window placement only).

Menu items covered in 3.12: View -> Output Window; Options -> Output Window Font, Printer Font, Log Output, Fullscreen Options, Output Window Size (nine sizes), Output Window Text Wrap; File -> Printer Setup; Run -> Log Start, Log Stop.
