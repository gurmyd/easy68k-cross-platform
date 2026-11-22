# TRAP #15 tasks 60 and above: mouse, key IRQ, sound, graphics, network

Behaviour specification for the macOS/web port of EASy68K Sim68K v5.16.1.
Scope: every TRAP #15 task numbered 60 or higher, plus the graphics, mouse and sound side of the I/O window that those tasks depend on. Tasks 0-59 are specified in `trap15-tasks-0-59.md`; the interrupt request path is also described in `hardware.md` section 3.1.

## 0. How to read this document

### 0.1 Sources

All paths are relative to `c:\easy64k\reference\`.

| Short name | File |
|---|---|
| `CODE9.CPP` | `src-sim68k\Sim68Kv5.16.1\CODE9.CPP` (the `TRAP()` dispatcher) |
| `simIOu.cpp`, `simIOu.h`, `simIOu.dfm` | I/O window form (`TsimIO`), same folder |
| `Net.cpp`, `Net.h` | Winsock wrapper, same folder |
| `STARTSIM.CPP` | `initSim()`, same folder |
| `RUN.CPP` | `runprog()`, `exec_inst()`, `irqHandler()`, same folder |
| `hardwareu.cpp` | `THardware::IRQprocess()`, same folder |
| `SIM68K.cpp`, `SIM68Ku.cpp`, `SIM68Ku.dfm` | WinMain and main form, same folder |
| `FullscreenOptions.cpp/.h/.dfm` | full-screen monitor dialog, same folder |
| help pages | `src-help\EASy68K_Helpv5.16.1\graphics.htm`, `sound.htm`, `peripheralio.htm`, `networkio.htm`, `simio.htm`, `keyCodes.htm` |
| `SIM68K.exe` | `official-extracted\SIM68K.exe`, the official v5.16.1 binary (image base `$00400000`). Read as bytes only, to see the statically linked VCL code that the source tree does not contain. It was never run |

### 0.2 Evidence tags

Every non-obvious statement carries one of these.

- **[SRC file:line]** read directly from the original source.
- **[GDI]** measured by me on real Windows GDI (Windows 11, 32 bpp, `gdi32.dll` called directly on a memory device context holding a 32-bit DIB section, and repeated on a screen-compatible bitmap where noted). The calls were the same GDI calls that the VCL makes for EASy68K (`MoveToEx`, `LineTo`, `Rectangle`, `Ellipse`, `ExtFloodFill`, `SetPixel`, `GetPixel`, `SetROP2`, `ExtTextOut`, `CreatePen(PS_SOLID, width, colour)`, `CreateSolidBrush`). These are facts about the platform the original runs on. They were not measured through SIM68K.exe itself.
- **[BIN address]** read from the machine code or constant data of the official `SIM68K.exe` at the given virtual address, located through the import thunk of the GDI function concerned. This is how the VCL's `TCanvas` behaviour was established where it matters most: which canvas state each drawing call realises before it calls GDI (the VCL passes a set of `csHandleValid` = 1, `csFontValid` = 2, `csPenValid` = 4, `csBrushValid` = 8 to `TCanvas.RequiredState`), and the tables it indexes.
- **[VCL]** behaviour of the Borland VCL wrapper (`TCanvas`, `TForm`, `TPen`, `TBrush`, the form's mouse and key message handling) that sits between the EASy68K source and Windows, where it was **not** checked in the binary. The VCL source is not in the reference tree, so these come from knowledge of the library. They are listed again in section 15 with a test recipe each.
- **UNVERIFIED** could not be determined from the sources or by measurement.
- **PORT** a recommendation for the port, not a statement about the original.

### 0.3 Conventions

- `D0.B`, `D0.W`, `D0.L` are the low 8, low 16 and all 32 bits of a data register. "Unchanged" means the bits are not written.
- Registers are host `long` (32-bit) variables `D[8]`, `A[9]` [SRC var.h:43]. The code writes partial registers through pointer casts such as `(short*)&D[0]`; this writes the low word only because the host is little-endian. WebAssembly is little-endian, so the same casts keep working.
- 68000 memory is the host array `memory[0x01000000]`; `A1` strings are read at `&memory[A[1] & ADDRMASK]` with `ADDRMASK = 0x00ffffff` [SRC def.h:56-57], so only the low 24 bits of an address register are used.
- Colours are written `$00BBGGRR`.
- "EASy coordinates" means the coordinates the 68000 program passes (inclusive corners). GDI calls are written with their real arguments.

## 1. Dispatch rules that apply to every task

1. `TRAP()` handles only vector 15. `vector = inst & 0x0F; if(vector == 15) {...} else return (TRAP_TRAP);` [SRC CODE9.CPP:730-731, 1281-1282].
2. The task number is `D0.B` read as a **signed char**: `switch ((char)D[0])` [SRC CODE9.CPP:732]. Bits 8-31 of D0 are ignored for task selection. Values `$80-$FF` are negative and match no case.
3. Any number without a `case` falls to `default: return (TRAP_TRAP);` [SRC CODE9.CPP:1277-1278]. `TRAP_TRAP` (7, [SRC def.h:93]) then behaves as a real TRAP #15 exception: with exception processing enabled the simulator adds 38 cycles and loads PC from vector `128 + 15*4 = $BC` [SRC RUN.CPP:903-906]; with it disabled the program halts with the message `TRAP exception occurred at location %4x. Execution halted` [SRC RUN.CPP:959-962].
4. Every implemented task ends with `return SUCCESS;` [SRC CODE9.CPP:1280]. `TRAP()` never calls `inc_cyc`, so an implemented TRAP #15 adds **0 cycles** to the cycle counter.
5. No task in this range saves or restores registers. Only the registers named under "Outputs" change.
6. String arguments. Tasks 70, 71, 73, 74 and 95 run `memoryMapCheck(Invalid, (A[1] & ADDRMASK), strlen(inStr))` on the string at (A1). If the string overlaps the "Invalid" region of the Hardware window memory map, `memoryMapCheck` raises a bus error itself (exception through vector 8 if exceptions are enabled, otherwise it halts with `Bus Error: Instruction at %4x accessing address %4x`) and returns `BUS_ERROR`; the task then returns that code without doing anything else [SRC CODE9.CPP:1146-1148, 1156-1158, 1169-1171, 1179-1181, 1243-1245; UTILS.CPP:246-283]. Details: the length checked is `strlen` of the string in 68000 memory, not of the 255-byte copy that tasks 70-74 use; the check is skipped (returns `SUCCESS`) when A1 itself is one of the Hardware window's device addresses (the 16 bytes of the 7-segment display, the LED, switch or push-button address) [SRC UTILS.CPP:250-253]; with exceptions disabled the halt also calls `Hardware->disable()` and the log gets a second line, `Execution halted` [SRC RUN.CPP:974-976, 1121-1128]. The check only matters when the Invalid map is enabled. The network tasks do **no** memory-map or bounds checks on (A1) or (A2).
7. Host-side failures. Only some `TsimIO` methods have their own `try { ... } catch( ... )`: `ellipse`, `unfilledEllipse`, `drawText`, `FormPaint`, `setWindowSize`, `setupWindow`, the nine sound functions, `ResetSounds` and the DirectMusic helpers. Each catches any C++/VCL exception, appends one line to the main window's message log and returns, so the 68000 program continues. The line is `Error in <function>` (for example `Error in ellipse`, simIOu.cpp:1951-1954) with three copy-paste exceptions: `controlSound`, `playSoundMemDX` and `controlSoundDX` all log `Error in playSoundMem`, and `stopSoundMemDX` logs `Error in stopSoundMem` [SRC simIOu.cpp:1706-1709, 1779-1782, 1799-1802, 1842-1845]. The following have **no** handler: `setLineColor`, `setFillColor`, `drawPixel`, `getPixel`, `line`, `lineTo`, `moveTo`, `getXY`, `rectangle`, `floodFill`, `unfilledRectangle`, `setDrawingMode`, `setPenWidth`, `getWindowSize` and the eight network wrappers [SRC simIOu.cpp:1852-1930, 1957-1988, 2024-2044, 2378-2464]. An exception thrown inside one of those is caught by `exec_inst()`, which shows the modal box `ERROR: An exception occurred in routine 'exec_inst'.` / `PC=%08X  Code=%04X` (title `Error`), switches auto-trace off and sets `trace = true`, `sstep = false`, i.e. the program stops in trace mode [SRC RUN.CPP:1008-1014]. None of these GDI wrappers is expected to throw for any register value, so PORT: no task in this range needs a failure path of its own.
8. None of the tasks in this range waits for user input. The calls that can stall are task 100 (TCP connect attempts and host name lookup, section 12), task 105 (local host name lookup) and the synchronous file loads of tasks 70, 71, 73 and 74.

## 2. Inventory of task numbers

### 2.1 Every `case` label in `TRAP()` [SRC CODE9.CPP:733-1276]

`0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25` · `30 31 32 33` (task 32 has sub-cases `D1.B` = 0-7) · `40 41 42 43` · `50 51 52 53 54 55 56 57 58 59` · `60 61 62` · `70 71 72 73 74 75 76 77` · `80 81 82 83 84 85 86 87 88 89 90 91 92 93 94 95 96` · `100 101 102 103 104 105 106 107`.

The help pages document exactly the same set: `textio.htm` 0-25, `simio.htm` 30-33, `SerialIo.htm` 40-43, `fileio.htm` 50-59, `peripheralio.htm` 60-62, `sound.htm` 70-77, `graphics.htm` 80-96, `networkio.htm` 100-107.

The block comment above `TRAP()` [SRC CODE9.CPP:232-720] is older than the code: it omits tasks 106 and 107, omits sub-task 7 of task 32, says the network tasks are UDP only, and says "The graphics resolution is 640 x 480" [SRC CODE9.CPP:560].

### 2.2 Numbers in this document's range

| Task | Name | Section |
|---|---|---|
| 60 | Mouse IRQ enable/disable | 8.2 |
| 61 | Mouse read | 8.3 |
| 62 | Key IRQ enable/disable | 9.2 |
| 70 | Play WAV file, standard player | 11.3 |
| 71 | Load WAV into standard sound memory | 11.3 |
| 72 | Play standard sound memory | 11.3 |
| 73 | Play WAV file, DirectX player | 11.4 |
| 74 | Load WAV into DirectX sound memory | 11.4 |
| 75 | Play DirectX sound memory | 11.4 |
| 76 | Control standard player | 11.3 |
| 77 | Control DirectX player | 11.4 |
| 80 | Set pen colour | 7 |
| 81 | Set fill colour | 7 |
| 82 | Draw pixel | 7 |
| 83 | Get pixel | 7 |
| 84 | Line | 7 |
| 85 | Line to | 7 |
| 86 | Move to | 7 |
| 87 | Filled rectangle | 7 |
| 88 | Filled ellipse | 7 |
| 89 | Flood fill | 7 |
| 90 | Unfilled rectangle | 7 |
| 91 | Unfilled ellipse | 7 |
| 92 | Drawing mode / double buffering | 7 |
| 93 | Pen width | 7 |
| 94 | Repaint | 7 |
| 95 | Draw text at pixel position | 7 |
| 96 | Get pen position | 7 |
| 100 | Create network client | 12 |
| 101 | Create network server | 12 |
| 102 | Send (deprecated) | 12 |
| 103 | Receive (deprecated) | 12 |
| 104 | Close connection | 12 |
| 105 | Get local IP | 12 |
| 106 | Send on port | 12 |
| 107 | Receive data and port | 12 |

Undefined in this range and therefore a TRAP exception (rule 3 above): 63-69, 78, 79, 97-99, 108-127, and 128-255 (negative as signed char).

## 3. State owned by these tasks, and what reset does

### 3.1 Variables

| Variable | Type, initial value | Meaning | Source |
|---|---|---|---|
| `canWidth`, `canHeight` | int, 640, 480 | size of the drawing surface in pixels | simIOu.cpp:44-45 |
| `MIN_WIDTH`, `MIN_HEIGHT` | 640, 480 | minimum surface size | simIOu.cpp:40-41 |
| `BackBuffer` | `Graphics::TBitmap*` | off-screen copy of the surface; always drawn | simIOu.h:124, simIOu.cpp:91 |
| `doubleBuffer` | bool, false | when true, drawing skips the window | simIOu.cpp:37 |
| `fullScreen` | bool member of `TsimIO` | full-screen flag | simIOu.h:97 |
| `savedLeft`, `savedTop` | int, 0 | window position to restore after full screen | simIOu.cpp:42-43 |
| `FullScreenMonitor` | unsigned char | monitor index for full screen, 0 = primary | var.h:144 |
| `MultimonitorAPIsExist` | bool | set in WinMain | var.h:141, SIM68K.cpp:28-66 |
| pen colour, fill colour, pen width, pen mode, pen position, font | held inside the two VCL canvases (`simIO->Canvas` and `BackBuffer->Canvas`), not in C++ variables | section 5 | |
| `mouseX`, `mouseY`, `mouseLeft`, `mouseRight`, `mouseMiddle`, `mouseDouble`, `keyShift`, `keyAlt`, `keyCtrl` | int/bool | "current" mouse snapshot | var.h:161-163 |
| `mouseXUp` ... `keyCtrlUp` | int/bool | snapshot at the last button-up event | var.h:165-167 |
| `mouseXDown` ... `keyCtrlDown` | int/bool | snapshot at the last button-down event | var.h:169-171 |
| `mouseDownIRQ`, `mouseUpIRQ`, `mouseMoveIRQ` | byte, 0 | IRQ level per mouse event, 0 = off | var.h:172 |
| `keyDownIRQ`, `keyUpIRQ` | byte, 0 | IRQ level per key event, 0 = off | var.h:173 |
| `keys[256]`, `keyDownCode`, `keyUpCode` | bool[], uchar | key state (read by task 19) | simIOu.cpp:66-68 |
| `irq` | int | pending interrupt bit mask, bit n-1 = level n | var.h:136 |
| `wavemem[256]` | `BYTE*`, NULL | standard-player sound slots | simIOu.cpp:54-55 |
| `currentWave` | int, -1 | slot index last passed to the standard player | simIOu.cpp:56 |
| `dsoundExist` | bool | DirectX player available | var.h:158, SIM68K.cpp:68-90 |
| `dmusicLoader`, `dmusicPerformance` | DirectMusic objects | DirectX player | simIOu.cpp:59-60 |
| `dmusicSegment` | one segment | used by task 73 | simIOu.cpp:61 |
| `dmusicSegments[256]` | segments, NULL | DirectX sound slots | simIOu.cpp:62 |
| `sock`, `remote`, `local`, `netInitialized`, `bound`, `mode`, `type` | Winsock state | section 12 | Net.cpp:10-22 |

### 3.2 What `initSim()` resets [SRC STARTSIM.CPP:33-127]

`initSim()` runs at program start (`FormShow`, after the settings file is loaded), on every program load (File > Open, Reload, a .S68 named on the command line or dropped on the window - all through `OpenFile`), on Close and on Rewind [SRC SIM68Ku.cpp:275, 434, 546, 1210]. For this document's state it does the following, in this order:

1. `simIO->clear()` - black screen, text cursor to row 0 column 0 (line 39).
2. `simIO->setWindowSize(0,0)` - **keeps the current width and height** (the comment says "reset" but 0,0 means "use current", simIOu.cpp:190-193), blacks both surfaces again (line 40).
3. `setDrawingMode(4)` - pen mode Copy (line 41).
4. `setDrawingMode(16)` - double buffering off, form pen position copied from the back buffer, back buffer copied to the window (line 42).
5. `setPenWidth(1)` (line 43).
6. `setLineColor(clWhite)` - pen `$00FFFFFF` (line 44).
7. `setFillColor(clBlack)` - fill `$00000000` (line 45).
8. Options font assigned to the back-buffer canvas and to the form (lines 46-47).
9. `FullScreenMonitor = 0` (line 85). The value loaded from `sim68K.dat` and the value chosen in the Fullscreen Options dialog are therefore lost at every reset.
10. All 27 mouse snapshot variables set to 0/false (lines 87-115).
11. `mouseDownIRQ = mouseUpIRQ = mouseMoveIRQ = keyDownIRQ = keyUpIRQ = 0` (lines 116-120).
12. `simIO->ResetSounds()` - stops and unloads sounds (line 122, section 11.5).
13. `netCloseSockets()` (line 126).

Between items 8 and 9 it also clears the pending-interrupt mask (`irq = 0`, line 79) and re-enables the hardware (`Hardware->enable()`, line 84; `hardware.md` covers the auto-IRQ timers), so a mouse or key interrupt requested before the reset is forgotten and events request interrupts again (section 10.1). Just before item 13 it re-enables the simulator's key commands (`Form1->restoreMenuTask19()`, line 124), which matters for Alt+Enter (4.4).

Not reset by `initSim()`: the surface size, the `fullScreen` flag, the pen position of either canvas (items 2 and 4 leave both equal to the window canvas's position from before the reset, section 5.5), the key state arrays (`clearKeys()` runs only when the I/O window is activated or a file dialog opens, simIOu.cpp:477, 615-618), `currentWave`, the task-73 segment `dmusicSegment`, and the network variables `bound` and `mode`.

Program end (task 9, SIMHALT, STOP without exceptions, bus error without exceptions) does **not** reset any of this. In particular sounds keep playing (a looping sound loops until the next reset) and the picture stays on screen.

## 4. The I/O window and the drawing surface

### 4.1 Two surfaces

There are two canvases of identical size:

- **Back buffer**: `BackBuffer`, a VCL bitmap created in the constructor [SRC simIOu.cpp:91]. Every drawing operation is applied to it, always.
- **Window**: the form's own canvas `simIO->Canvas`. Each drawing operation is applied to it as a second, separate GDI call, but only `if (doubleBuffer == false)` [SRC e.g. simIOu.cpp:1867-1868, 1882-1886, 1928-1929].

`FormPaint` (the window's paint handler) copies the whole back buffer to the window: `Canvas->Draw(0,0,BackBuffer);` [SRC simIOu.cpp:379-388]. Windows calls it whenever the window needs repainting.

All reads come from the back buffer: `getPixel` returns `BackBuffer->Canvas->Pixels[x][y]` [SRC simIOu.cpp:1872-1875].

PORT: keep one authoritative pixel surface (the back buffer) and a presented copy. "Draw to the window" becomes "present the back buffer". Exceptions where the original window can differ from the back buffer are the input prompt (drawn on the window only, simIOu.cpp:1420-1452) and the separate pen position of the window canvas (section 5.5).

### 4.2 Form properties [SRC simIOu.dfm:1-56]

Caption `Sim68K I/O`; `BorderStyle = bsSingle` (not resizable by dragging); `BorderIcons = [biSystemMenu, biMinimize]` (no maximise box); `Color = clBlack`; `Constraints.MinWidth = 200`, `Constraints.MinHeight = 100` (never reached, the surface minimum is larger); `DefaultMonitor = dmDesktop`; `KeyPreview = True`; `Scaled = False`; `PixelsPerInch = 96`; `Visible = True`; design-time font Courier New, height -21, white (replaced by the Options font in the constructor and at every reset); a `TTimer` named `prompt` (`Interval = 500`, disabled) for the input prompt and two file dialogs for task 58; handlers `OnActivate`, `OnKeyDown`, `OnKeyPress`, `OnKeyUp`, `OnMouseDown`, `OnMouseMove`, `OnMouseUp`, `OnPaint`, `OnResize` (`FormResize` is empty, simIOu.cpp:411-414). The DFM says `ClientHeight = 481` but the constructor immediately calls `setWindowSize(MIN_WIDTH, MIN_HEIGHT)` [SRC simIOu.cpp:93], so the client area is 640 x 480 from the start. The constructor also sets `this->DoubleBuffered = true` [SRC simIOu.cpp:127]; that is a VCL flicker-reduction flag and has no behaviour to port.

Graphics tasks never show the window. Only text output and text input call `simIO->Show()` [SRC simIOu.cpp:814-815, 1326]. If the user closed the I/O window, graphics still land in the back buffer and appear when the window is shown again.

### 4.3 Size of the surface

The window's client area and the drawing surface always have the same size, `canWidth` x `canHeight`, in device pixels. There is no scaling and no separate "window size".

`setWindowSize(ushort width, ushort height)` [SRC simIOu.cpp:187-233] is the only way to change it:

```
if (height == 0 && width == 0) { height = canHeight; width = canWidth; }   // keep current
canHeight = (height >= 480) ? height : 480;
canWidth  = (width  >= 640) ? width  : 640;
ClientHeight = canHeight; ClientWidth = canWidth; PixelsPerInch = 96;
BackBuffer->Height = canHeight; BackBuffer->Width = canWidth;
fill BackBuffer with black (CopyMode = cmBlackness; CopyRect onto itself)
Canvas->CopyRect(r, BackBuffer->Canvas, r);        // window black too, even when doubleBuffer is true
BackBuffer->Canvas->Font = Canvas->Font;  CopyMode, Brush, Pen, PenPos likewise copied window -> back buffer
savedLeft = Left; savedTop = Top;
setupWindow();                                     // re-applies windowed or full-screen layout
setTextSize();                                     // recomputes text rows and columns
Form1->WindowSizeChecked();                        // updates the menu radio marks
```

Consequences:

- Width and height are clamped independently to a minimum of 640 and 480. There is **no maximum** in the code; the parameters are 16-bit so the largest request is 65535 x 65535. What Windows does with a request larger than the desktop is UNVERIFIED (the window is limited by the system's maximum tracking size while `canWidth`/`canHeight` and the back buffer keep the requested size). If the back-buffer bitmap cannot be created at the requested size, the VCL exception lands in the function's own handler: the log gets `Error in setWindowSize` and the remaining steps (blacking, property copy, window placement, text grid, menu marks) are skipped while `canWidth`/`canHeight` already hold the new values, so task 33 then reports a size the surface does not have [SRC simIOu.cpp:194-208, 229-232]. PORT: clamp to a documented maximum and record the deviation.
- **Every call blacks the whole surface on both canvases**, including a call that does not change the size, and including when double buffering is on.
- The call keeps pen colour, fill colour, pen width, pen mode, font and the double-buffer flag. The back buffer's pen position is overwritten with the window canvas's pen position (they differ only in the cases of section 5.5).
- The text cursor (row, column) and the stored text array are not touched; see `trap15-tasks-0-59.md`.

Ways to call it:

| Trigger | Call | Source |
|---|---|---|
| start-up | `setWindowSize(640, 480)` | simIOu.cpp:93 |
| every `initSim()` | `setWindowSize(0,0)` (keep size, black screen) | STARTSIM.CPP:40 |
| task 33 with `D1.L` not 0, 1 or 2 | `setWindowSize((short)(D[1]>>16), (short)D[1])`: width = high word, height = low word | CODE9.CPP:944-945 |
| Options > Output Window Size > radio item | `setWindowSize(w, h)` | SIM68Ku.cpp:2051-2087 |

Menu items [SRC SIM68Ku.dfm:1358-1414; SIM68Ku.cpp:2051-2121]: submenu caption `Output Window &Size` with radio items `640x480` (Tag 0, checked by default), `800x600` (1), `1024x768` (2), `1280x800` (3), `1280x1024` (4), `1440x900` (5), `1680x1050` (6), `1920x1080` (7), `1920x1200` (8). `WindowSizeChecked()` unchecks all nine and checks the one that equals the current size exactly; a size set by task 33 that matches none leaves all unchecked. The size is not saved in `sim68K.dat`.

Task 33 belongs to `trap15-tasks-0-59.md`. Summary for this model [SRC CODE9.CPP:937-951]: `D1.L = 0` returns `D1.L = (width << 16) + height`; `D1.L = 1` sets `fullScreen = false` and calls `setupWindow()`; `D1.L = 2` sets `fullScreen = true` and calls `setupWindow()`; any other value sets the size as above. The default 640 x 480 reads back as `$028001E0`.

### 4.4 Full screen [SRC simIOu.cpp:238-369]

`setupWindow()` with `fullScreen == true`:

1. Saves the window position in `savedLeft`, `savedTop`.
2. Asks Windows to change the display mode of monitor `FullScreenMonitor` to `canWidth` x `canHeight`, 32 bits per pixel, default refresh rate (`ChangeDisplaySettingsEx` with `CDS_SET_PRIMARY | CDS_FULLSCREEN`, or `ChangeDisplaySettings` on systems without the multi-monitor API).
3. On failure with a secondary monitor selected it sets `FullScreenMonitor = 0` and retries. On failure with the primary it shows the modal message box `Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.` (title `Information`), sets `fullScreen = false` and calls `setupWindow()` again. Two other failure paths show `Sorry, the program encountered an error when trying to read your computer's monitor configuration.` The non-multi-monitor path shows `Sorry, this computer's configuration does not support the desired resolution in full screen mode.`
4. Moves the window to the monitor's origin and sets `BorderStyle = bsNone`, `FormStyle = fsStayOnTop`, `Width = canWidth`, `Height = canHeight`.

With `fullScreen == false` it restores the display mode, sets `BorderStyle = bsSingle`, `FormStyle = fsNormal`, restores `Left`/`Top` from the saved values and sets the client size to `canWidth` x `canHeight`.

Window-position quirks that follow from this [SRC simIOu.cpp:221-224, 250-253, 357-363]: the saved position is taken at every `setWindowSize` call and at every entry to full screen, and the windowed branch always moves the window to it. So task 33 with `D1.L = 1` issued while already windowed moves the window back to where it was at the last size change or reset, and a size change made while in full screen replaces the saved position with the full-screen origin, so leaving full screen afterwards puts the window at that monitor's top-left corner. PORT: relevant only if the app shell keeps a separate, movable output window.

Full screen never changes `canWidth`/`canHeight`, never clears the surface, and keeps the 1:1 pixel mapping (the physical display is switched to the surface resolution).

Entering and leaving:

| Event | Effect | Source |
|---|---|---|
| task 33, `D1.L = 2` / `D1.L = 1` | enter / leave | CODE9.CPP:938-943 |
| Alt+Enter while the I/O window has focus | toggle. Skipped when simulator key commands are disabled by task 24, because `FormKeyDown` returns first | simIOu.cpp:428-438 |
| command-line switch `/f` after the .S68 name | enter at start-up | SIM68Ku.cpp:1228-1230 |
| View > Output Window while full screen | leave (otherwise the item just shows the window) | SIM68Ku.cpp:1063-1071 |
| program halts or enters trace mode while the main window is on monitor `FullScreenMonitor` | leave, so the debugger becomes visible | RUN.CPP:697-704 |
| I/O form destroyed | leave | simIOu.cpp:140-143 |

Options > `&Fullscreen Options...` [SRC SIM68Ku.dfm:1344-1347; SIM68Ku.cpp:1382-1393] opens the modal dialog `Fullscreen Options` [SRC FullscreenOptions.dfm]: label `Screen to use for fullscreen output window.  Primary screen = 1  Secondary screens = 2 and up.`, one edit box, buttons `&Ok` and `&Cancel`. The edit box is pre-filled with `FullScreenMonitor + 1`; `&Ok` is enabled only while the text is an integer from 1 to the number of monitors; `&Ok` stores `text - 1` in `FullScreenMonitor` [SRC FullscreenOptions.cpp:27-59]. If full screen is active the menu item shows `Please deactivate fullscreen mode before attempting to change the fullscreen settings.` instead; without the multi-monitor API it shows `Sorry, but your system does not seem to support multiple monitors.` `FullScreenMonitor` is written to `sim68K.dat` as `$fullscreen monitor` [SRC SIM68Ku.cpp:1474, 1980-1991] but `initSim()` overwrites it with 0 (section 3.2 item 9).

PORT: a browser cannot change the display mode. Treat full screen as a presentation mode that shows the unchanged `canWidth` x `canHeight` surface scaled to the display with nearest-neighbour sampling. `Element.requestFullscreen()` needs a user gesture, so a full-screen request made by task 33 from a running program may have to be deferred to the next key press or click, or shown as a prompt. Task 33 `D1.L = 0` must keep returning the logical surface size.

### 4.5 Coordinate system

- Origin (0,0) is the top-left pixel of the surface; x grows right, y grows down; one unit is one pixel. Valid pixels are `0 <= x < canWidth`, `0 <= y < canHeight`.
- All graphics tasks take coordinates from the **low word** of the register, **sign-extended**: `(short)D[1]` etc. [SRC CODE9.CPP:1202-1229, 1246]. The range is -32768 to 32767. Bits 16-31 are ignored.
- Coordinates outside the surface are legal. GDI clips to the surface; nothing wraps and nothing is an error [GDI]. The official sample draws lines to y = 640 on a 480-high surface (`examples\official\Examples\graphicSound.X68` lines 165-170).
- Mouse coordinates use the same space (section 8).

### 4.6 Colour format

A colour is the 32-bit value `$00BBGGRR`: bits 0-7 red, bits 8-15 green, bits 16-23 blue. The registers hold it as an ordinary 68000 long, so `MOVE.L #$000000FF,D1` is pure red. The code casts the register straight to a VCL `TColor`: `(TColor) c` [SRC simIOu.cpp:1854-1861].

The top byte is normally 0. What a non-zero top byte does:

| Top byte | Result | Evidence |
|---|---|---|
| `$00` | RGB as given | [GDI] |
| bit 31 set (`$80`-`$FF`) | a Windows system colour: the VCL's `ColorToRGB`, which pen, brush and pixel colours all pass through, returns `GetSysColor(value & $FF)` for a negative value and any other value unchanged. Index 5 (window) is white, 8 (window text) is black and 15 (button face) is `$F0F0F0` on a default Windows 11 desktop; indices above 30 give black | [BIN `$0046A5D4`-`$0046A5E3`], values [GDI] |
| bit 24 set, bit 31 clear (`$01`, `$03`, ..., `$7F`) | GDI palette index: the low 16 bits index the 20-entry stock palette. Measured: index 0 = `$000000`, 1 = `$000080`, 5 = `$800080`, 12 = `$808080`, 19 = `$FFFFFF`; index 20 and above = black | [GDI] |
| other non-zero even values (`$02`, `$04`, `$0A`, `$10`, ...) | RGB from the low 24 bits | [GDI] |

PORT: `if (c & $80000000) system colour; else if (c & $01000000) stock palette entry (c & $FFFF) or black; else c & $00FFFFFF`. The full stock palette in `$BBGGRR` order is: 0 `000000`, 1 `000080`, 2 `008000`, 3 `008080`, 4 `800000`, 5 `800080`, 6 `808000`, 7 `C0C0C0`, 8 `C0DCC0`, 9 `F0CAA6`, 10 `F0FBFF`, 11 `A4A0A0`, 12 `808080`, 13 `0000FF`, 14 `00FF00`, 15 `00FFFF`, 16 `FF0000`, 17 `FF00FF`, 18 `FFFF00`, 19 `FFFFFF` (all 20 entries measured [GDI]; only the low 16 bits select the entry, so `$01010005` is entry 5 and `$0100FF05` is black).

Task 83 always returns a plain `$00BBGGRR` value, or `$FFFFFFFF` outside the surface (section 7, task 83).

The surface is true colour (the back buffer is a screen-compatible bitmap; all modern displays are 32 bpp). No palette quantisation occurs. Behaviour on 8-bit or 16-bit displays is out of scope.

## 5. Graphics state

All of this state lives in the two VCL canvases. Each setter writes both canvases, so they agree except for the pen position (5.5).

### 5.1 Pen colour (task 80)

Used for: the outline of rectangles and ellipses, lines, pixels drawn by task 82, and the end-point pixel that tasks 84 and 85 add. Default `$00FFFFFF` (white) after every reset. It does not affect text.

### 5.2 Fill colour (task 81)

The VCL brush colour, style always solid. Used for: the interior of tasks 87 and 88, flood fill (task 89), and **the background rectangle behind every piece of text** drawn on the surface, both task 95 text and ordinary text output. `TCanvas.TextOut` requires the font and the brush to be realised (state set `$0B`), and realising a solid brush calls `SetBkColor(brush colour)` and `SetBkMode(OPAQUE)` [BIN `$0046BCD4` (state set used by `TextOut`), `$0046C14C`-`$0046C19D` (`TCanvas.CreateBrush`)]; GDI then fills the text cell with that colour (6.7). Default `$00000000` (black) after every reset.

Clearing and scrolling never use the fill colour; they always produce black [SRC simIOu.cpp:1021-1023, 1128-1130].

### 5.3 Pen width (task 93)

`w &= 0x00FF; Pen->Width = w;` on both canvases [SRC simIOu.cpp:2039-2044]. Range 0-255. Width 0 draws exactly like width 1 [GDI]. Default 1 after every reset. Width applies to lines and to the outlines of rectangles and ellipses. It does not apply to task 82, to the end-point pixel of tasks 84/85, to flood fill or to text.

### 5.4 Drawing mode (task 92, values 0-15)

`Pen->Mode = (TPenMode) m` on both canvases [SRC simIOu.cpp:2034-2035]. When the VCL realises the pen it selects it and calls `SetROP2(handle, PenModes[mode])`, where `PenModes` is a table of 16-bit words indexed by the mode byte with no range check [BIN `$0046C11C`-`$0046C14B` (`TCanvas.CreatePen`); table at `$005270B4` = 1, 16, 11, 6, 13, 4, 14, 5, 12, 3, 15, 2, 9, 8, 7, 10]. The mapping is therefore **not** numeric order; the table below gives the operation. `P` is the colour being drawn (pen colour for outlines, lines and pixels; fill colour for interiors and flood fill), `D` is the pixel already on the surface; all operations are bitwise on the 24-bit RGB value.

| Mode | VCL name | GDI ROP2 | Result pixel | Help text (graphics.htm:125-140) |
|---|---|---|---|---|
| 0 | pmBlack | R2_BLACK | `$000000` | always black |
| 1 | pmWhite | R2_WHITE | `$FFFFFF` | always white |
| 2 | pmNop | R2_NOP | `D` (nothing drawn, pen position still moves) | move but do not draw |
| 3 | pmNot | R2_NOT | `~D` | NOT background |
| 4 | pmCopy | R2_COPYPEN | `P` (default) | draw colour |
| 5 | pmNotCopy | R2_NOTCOPYPEN | `~P` | NOT draw colour |
| 6 | pmMergePenNot | R2_MERGEPENNOT | `P \| ~D` | NOT background OR draw colour |
| 7 | pmMaskPenNot | R2_MASKPENNOT | `P & ~D` | NOT background AND draw colour |
| 8 | pmMergeNotPen | R2_MERGENOTPEN | `~P \| D` | background OR NOT draw colour |
| 9 | pmMaskNotPen | R2_MASKNOTPEN | `~P & D` | background AND NOT draw colour |
| 10 | pmMerge | R2_MERGEPEN | `P \| D` | OR |
| 11 | pmNotMerge | R2_NOTMERGEPEN | `~(P \| D)` | NOR |
| 12 | pmMask | R2_MASKPEN | `P & D` | AND |
| 13 | pmNotMask | R2_NOTMASKPEN | `~(P & D)` | NAND |
| 14 | pmXor | R2_XORPEN | `P ^ D` | XOR |
| 15 | pmNotXor | R2_NOTXORPEN | `~(P ^ D)` | XNOR |

Each of the 16 GDI operations was measured with `D = $336699`, pen `$0F0FF0`, brush `$F0F00F` and gave exactly the formula in the table [GDI].

What the mode applies to [GDI, measured with XOR and the other 15 operations]:

| Primitive | Affected by the mode? |
|---|---|
| Line body (tasks 84, 85) | yes |
| Rectangle and ellipse outline (87, 88, 90, 91) | yes, with the pen colour |
| Rectangle and ellipse interior (87, 88) | yes, with the fill colour |
| `SetPixel` - task 82 and the end-point pixel of tasks 84/85 | **yes** at the GDI level. The help says the opposite ("The drawing mode is not used", graphics.htm:45; "Not affected by drawing mode", CODE9.CPP:568). See below |
| Flood fill (task 89) | yes at the GDI level, but see below |
| Text (task 95 and all text output) | no |
| Clear, scroll, repaint (block copies) | no |

Two points contradict the help or depend on VCL internals; both are worth one confirming run on real EASy68K (section 15, items V3 and V4):

- **Pixels.** GDI `SetPixel` combines the colour with the destination using the device context's current ROP2 [GDI, measured on a DIB section and on a screen-compatible bitmap, with and without a pen selected]. `TCanvas.SetPixel` asks for the pen to be realised (state set `$05` = handle + pen) before it calls `SetPixel`, and realising the pen sets the ROP2 from the pen mode [BIN `$0046BF14`-`$0046BF55`, set constant at `$0046BF58`]. Net effect: task 82 obeys the drawing mode. In mode 14 a pixel drawn twice restores the background; in mode 2 nothing is drawn. PORT: apply the mode to task 82 and to the end-point pixel.
- **Flood fill.** `TCanvas.FloodFill` realises only the brush, not the pen (state set `$09` = handle + brush) [BIN `$0046B9E8`], and `Pixels[x][y]`, which the source evaluates first, realises nothing (`$01`) [BIN `$0046BF10`]. The ROP2 in force is whatever the device context was last given: the current mode if a line, shape or pixel was drawn on that canvas since the VCL last released its cached device contexts (which it does after each processed window message [VCL]), otherwise Copy, the default of a new device context [GDI]. The original is therefore not deterministic for flood fill in a non-Copy mode. PORT: apply the current mode to flood fill (this equals the original whenever a pen primitive was drawn just before) and treat any other outcome as acceptable.

Mode values 16 and 17 are the double-buffer switches (5.6). **Values 18-255** are stored as the pen mode like any other value, and `TCanvas.CreatePen` then reads the word at `PenModes[value]`, which lies beyond the 16-entry table in whatever constant data follows it in the executable. GDI does not reject an out-of-range ROP2: it keeps the low byte and draws as operation `((v - 1) AND 15) + 1`, so 0 acts as `R2_WHITE` [GDI, measured for every value 0-255 on lines, pixels, outlines and interiors]. Combining the two for `SIM68K.exe` v5.16.1 [BIN words at `$005270B4 + 2 * value`]: each value 18-255 behaves exactly like one of the modes 0-15, and for most of them that mode is **1, always white**. The exceptions are:

| Behaves as mode | Values |
|---|---|
| 0 | 66, 98, 108, 116, 128, 140, 178, 188, 193, 222, 230 |
| 2 | 146, 154 |
| 3 | 118, 142 |
| 4 | 158 |
| 5 | 22, 24, 64, 84, 92, 122, 166, 168, 234 |
| 6 | 162, 192 |
| 7 | 78, 172 |
| 8 | 156 |
| 9 | 82, 120, 126, 132, 174, 180 |
| 10 | 44, 48, 51, 52, 53, 55, 56, 57, 160 |
| 11 | 80, 88, 110, 136, 164, 170, 184, 220, 232 |
| 12 | 144 |
| 13 | 65, 102, 150, 208, 236 |
| 14 | 124, 130, 209, 212, 213 |
| 15 | 148, 152 |

All other values from 18 to 255 (171 of them, including 18-21) behave as mode 1. This is an accident of the binary's layout, derived without running it (section 15, V8). PORT: reproduce the table; a program that passes such a value by mistake then draws in white, as it does on the original.

> **Corrected (erratum T3 F6).** Under Wine every mode 18-23 draws the pen unchanged (Wine's `SetROP2` refuses values outside 1-16 and keeps the previous mode), where the table above expects white for mode 20 and the inverted pen for 22 (`trap15-b/b06-modes-above-15`). Whether Windows does the same is open (V8); the port keeps the table until `b06` has run on Windows (`tests/conformance/windows-confirm`), and the difference is listed as unconfirmed with owner SH1. (Settled since, 22 November 2026: the GDI calls the original makes were measured on Windows 11, `tests/conformance/gdi/golden/modes.json`, erratum SH1 17, which says what Windows does; the port follows that measurement, and `b06` differs from its golden only because Wine's `SetROP2` differs from Windows'. It is an accepted difference whose golden is Wine's, part T3 of `docs/DIFFERENCES.md`.)

### 5.5 Current position (pen position)

GDI keeps one current position per device context. The VCL preserves it when it recycles a device context: `TCanvas.SetHandle` stores the current position in the canvas object before it gives a handle up and moves the next handle to it [BIN `$0046C000`-`$0046C053`]. There are two positions: the back buffer's and the window's.

| Operation | Back-buffer position | Window position |
|---|---|---|
| task 86 move to (x,y) | (x,y) | (x,y) - always, even when double buffering [SRC simIOu.cpp:1902-1906] |
| task 84 line (x1,y1)-(x2,y2) | (x2,y2) | (x2,y2) only if not double buffering [SRC simIOu.cpp:1877-1888] |
| task 85 line to (x,y) | (x,y) | (x,y) only if not double buffering [SRC simIOu.cpp:1890-1899] |
| task 95 draw text at (x,y) | (x + `TextWidth(string)`, y): `TCanvas.TextOut` ends with `MoveTo(X + TextWidth(Text), Y)` [BIN `$0046BCAE`-`$0046BCC4`] | same, only if not double buffering [SRC simIOu.cpp:906-916] |
| any printed character (text tasks, keyboard echo, the space that erases a character on Backspace) | (cell x + character width, cell y), same `TextOut` | same, only if not double buffering [SRC simIOu.cpp:865-868, 1381-1383, 1395-1397] |
| input prompt `_` blinking (every 500 ms while an input task waits; not while double buffering) | unchanged | (prompt x + character width, text y) [SRC simIOu.cpp:1420-1434] |
| prompt erase (`erasePrompt`: when an input completes, before a Backspace is processed, on Pause during input; only if the prompt is enabled, task 16) | unchanged | (prompt x + width of a space, text y), **also while double buffering** [SRC simIOu.cpp:1339-1340, 1377, 1439-1447; SIM68Ku.cpp:530-533] |
| tasks 82, 83, 87-91, 89, clear, scroll, repaint | unchanged | unchanged [GDI] |
| task 92 mode 16 | unchanged | set to the back-buffer position [SRC simIOu.cpp:2029] |
| `setWindowSize` (task 33 size, menu, every reset) | set to the window position [SRC simIOu.cpp:219] | unchanged |

Task 96 returns the **window** position [SRC simIOu.cpp:1909-1913]. While double buffering is on, lines and text do not move the window position, so task 96 returns the position of the last task 86, or of the last drawing done before buffering was switched on, or - if a keyboard input task has completed since then with the prompt enabled - the position left by the prompt erase.

The position starts at (0,0) when the simulator starts and is **not** reset by `initSim()`. A program that begins with task 85 after a Rewind draws from wherever the previous run left the pen.

PORT: keep both positions as described. Draw with the back-buffer position. Answer task 96 from the window position. If that is judged too obscure, the minimum is: one position, updated by 84, 85, 86, 95 and text output; say so in the release notes.

### 5.6 Double buffering (task 92 values 16 and 17, task 94)

[SRC simIOu.cpp:2024-2037]

- Value 17: `doubleBuffer = true`. Nothing else happens. From now on drawing and text go to the back buffer only.
- Value 16: `doubleBuffer = false; Canvas->PenPos = BackBuffer->Canvas->PenPos; FormPaint(...)`. The back buffer is copied to the window immediately.
- Task 94: `simIO->FormPaint((TObject *)simIO)` [SRC CODE9.CPP:1237-1239] copies the whole back buffer to the window. It works in either mode; the help's "Requires drawing mode 17" (graphics.htm:161) is not enforced.

While double buffering is on, the window is also refreshed from the back buffer at these moments, which a program can observe as an "early" update:

1. Windows repaints the window (uncovered, restored, moved on screen).
2. A key is accepted during text input: `FormKeyPress` calls `this->Invalidate()` after an ordinary character or a backspace, regardless of echo, and after a single-character read when echo is on [SRC simIOu.cpp:1349, 1386, 1405].
3. `setWindowSize` blacks the window directly [SRC simIOu.cpp:213].

One thing is drawn on the window itself while double buffering is on: the prompt erase described in 5.5 paints one character cell in the fill colour at the text cursor [SRC simIOu.cpp:1439-1447]. It stays until the window is next refreshed from the back buffer; the Enter key that ends a string or number input does not itself schedule a refresh. PORT: with a single presented surface this cell can be ignored; only its effect on the window pen position (5.5) is observable by a program.

`initSim()` switches double buffering off (section 3.2 item 4).

PORT: with buffering off, present after each drawing call or once per animation frame (the eye cannot tell). With buffering on, present on task 94, on mode 16, on case 2 above and on resize. Case 1 has no browser equivalent.

### 5.7 Font used by task 95

Task 95 uses the canvas font, the same one as text output: the font from Options > Output Window Font, or the one set by task 21. Font face, size, style and colour are specified in `trap15-tasks-0-59.md`. Facts needed here:

- Default: `Fixedsys`, 9 point, colour white [SRC SIM68Ku.cpp:1524-1525; SIM68Ku.dfm:2266-2271]. Fixedsys is a bitmap font with a fixed 8 x 15 pixel cell at every size from 8 to 16 point and 16 x 30 at 18 point [GDI, measured with `CreateFont(height = -round(pt*96/72))`]. The default text grid is therefore 80 columns x 32 rows on 640 x 480.
- Text colour is the font colour (task 21, `D1.L`), not the pen colour.
- Measured cell sizes (height of "Xp", width of "W") for the other task 21 fonts on Windows 11 [GDI]: Courier 10/12/15 pt = 8x13, 9x16, 12x20. Courier New 8/9/10/11/12/14/16/18 pt = 7x14, 7x15, 8x16, 9x17, 10x18, 11x21, 13x23, 14x27. Lucida Console same sizes = 7x11, 7x12, 8x13, 9x15, 10x16, 11x19, 13x21, 14x24. Consolas = 6x13, 7x14, 7x15, 8x18, 9x19, 10x22, 12x24, 13x28. The source misspells font 5 as `Lucida Sans Typerwriter` [SRC simIOu.cpp:974]; with that name Windows 11 substitutes Arial, a proportional font. `Terminal` (font 7) requested with the ANSI character set is also substituted by Arial. These substitutions are machine dependent.
- TrueType fonts are drawn with the system's anti-aliasing (ClearType), so their edge pixels are blends that task 83 can read back. Bitmap fonts (Fixedsys, Courier, Terminal) have only two colours per cell.

## 6. Rasterisation rules: exactly which pixels are touched

Everything in this section is [GDI] unless marked otherwise. "Pen width" means the value after `max(w, 1)`.

Notation for a pen of width `w`: `a = floor(w / 2)`, `b = floor((w - 1) / 2)`. A wide horizontal or vertical stroke centred on coordinate `c` covers `c - a` through `c + b`. So width 2 covers `c-1..c`, width 3 `c-1..c+1`, width 4 `c-2..c+1`, width 5 `c-2..c+2`.

### 6.1 Lines, pen width 1 (tasks 84, 85)

GDI `LineTo` draws from the current position up to **but not including** the end point. EASy68K then sets the end-point pixel itself: `Pixels[x2][y2] = Pen->Color;  // plot to fix builder bug` [SRC simIOu.cpp:1881, 1885, 1893, 1896]. Together the line includes both end points.

Pixel selection of `LineTo` from (x1,y1) to (x2,y2), verified against GDI on 4000 random lines (including clipped lines and lines of slope exactly 1/2 and 2) with zero mismatches:

- Let `dx = x2 - x1`, `dy = y2 - y1`. If both are 0, `LineTo` draws nothing.
- If `|dx| >= |dy|` (x-major): for each integer `x` from `x1` towards `x2`, excluding `x2`, the pixel is `(x, y1 + ceil((x - x1) * dy / dx - 1/2))`.
- Otherwise (y-major): for each integer `y` from `y1` towards `y2`, excluding `y2`, the pixel is `(x1 + ceil((y - y1) * dx / dy - 1/2), y)`.

In words: the pixel nearest to the ideal line, and an exact tie goes to the **smaller** coordinate (up for x-major lines, left for y-major lines). The set of pixels does not depend on the drawing direction, apart from which end is left out.

Then the end-point pixel (x2,y2) is written with `SetPixel` in the pen colour, through the drawing mode (section 5.4), width 1.

A zero-length line (x1,y1) = (x2,y2) therefore draws exactly one pixel.

Example, (0,0) to (8,4) as drawn by `LineTo` alone (`#` drawn, end point (8,4) is added afterwards by `SetPixel`):

```
     012345678
   0 ##.......
   1 ..##.....
   2 ....##...
   3 ......##.
   4 .........
```

### 6.2 Lines, pen width 2 or more

The VCL creates the pen with `CreatePenIndirect(style, width, colour)` [BIN `$0046B00B`, in `TPen.GetHandle`], which for widths above 1 gives round end caps and round joins [GDI].

- Across the line, a horizontal or vertical stroke covers `c - a .. c + b` (see notation). Measured for widths 2-6.
- Along the line, the stroke covers **both** end points and extends past them by a round cap of roughly half the width.
- Each `LineTo` is a separate stroke with its own two caps, so a polyline built with task 85 has rounded outside corners.
- A zero-length wide line draws a round dot (shapes below).
- After the stroke EASy68K still calls `SetPixel` on the end point with the pen colour. In Copy mode this is invisible. In XOR-type modes the end-point pixel is combined twice and so shows the background again: a one-pixel hole at (x2,y2). Measured.

Measured strokes (`#` = pen). Horizontal lines from x to x+10 at y = 5, widths 2, 3, 4, 5, 6, starting at x = 5, 25, 45, 65, 85:

```
     0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789
   2 ......................................................................................##########....
   3 ..............................................##########........#############.......#############...
   4 ......##########.........###########........#############......###############.....###############..
   5 .....###########........#############.......#############......###############.....###############..
   6 .........................###########........#############......###############.....###############..
   7 ................................................................#############.......#############...
```

Dots drawn by a zero-length line (also by a one-point rectangle or ellipse with a wide pen), widths 2-9, centred on x = 6, 18, 30, 42, 54, 66, 78, 90, y = 10:

```
     0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789
   6 .........................................................................................###........
   7 .................................................................###........#####......#######......
   8 .........................................###.........###........#####......#######.....#######......
   9 ..................#..........###........#####.......#####......#######.....#######....#########.....
  10 ......#..........###.........###........#####.......#####......#######.....#######....#########.....
  11 ..................#..........###........#####.......#####......#######.....#######....#########.....
  12 .........................................###.........###........#####......#######.....#######......
  13 .................................................................###........#####......#######......
  14 .........................................................................................###........
```

Dot diameters: width 2 = 1 pixel, 3 and 4 = 3, 5 and 6 = 5, 7 and 8 = 7, 9 and 10 = 9, 11 and 12 = 11, 13 and 14 = 13. Pixel counts for widths 2-14: 1, 5, 9, 21, 21, 37, 45, 61, 69, 89, 101, 129, 145.

Corrected (erratum SH2 2, measured against GDI): GDI widens each line into a polygon: the two long sides are the line moved by the pen's offsets (multiples of half a pixel), the round ends are vertices of a measured per-width pen polygon; the polygon is filled with the fill rule of 6.4's interior. (The first version of this paragraph said: a band of half-widths around the width-1 line plus a disc of the dot shape at each end, UNVERIFIED.)

Corrected (erratum SH1 14, every width 2-255 measured on GDI): the dot of a pen of width `w >= 2` has `2 * floor((w - 1) / 2) + 1` rows and columns. Its shape is a polygon's, not a circle's, and was captured for every width 2-255 (`app/src/core/sim-host/surface/tables/dots.ts`). A zero-length line and a one-point ellipse draw it; a one-point rectangle draws it less one or two pixels at 15 widths.

### 6.3 Rectangles (tasks 87 and 90)

EASy68K sorts the corners so that `x1 <= x2`, `y1 <= y2`, then calls `Rectangle(x1, y1, x2+1, y2+1)` (`// +1 to fix builder bug`) [SRC simIOu.cpp:1915-1930, 1964-1988]. GDI excludes the right and bottom edge of the rectangle it is given, so the two cancel: the outline passes through the pixels of both EASy corners.

Verified against GDI on 6000 random rectangles with pen widths 0-12, zero mismatches for case A, and 4000 for case B:

- **Case A, `x1 < x2` and `y1 < y2`.** The outline covers the frame between the outer rectangle `[x1 - a, x2 + b] x [y1 - a, y2 + b]` and the inner rectangle `[x1 + b + 1, x2 - a - 1] x [y1 + b + 1, y2 - a - 1]`, all bounds inclusive. Corners are square, not rounded. The inner rectangle is filled with the fill colour by task 87 and left untouched by task 90. If the inner rectangle is empty everything is outline. With width 1 this is: outline on `x = x1`, `x = x2`, `y = y1`, `y = y2`; interior `x1+1..x2-1` x `y1+1..y2-1`.
- **Case B, exactly one of `x1 == x2`, `y1 == y2`.** Width 1: a straight run of pen pixels `x1..x2` (or `y1..y2`), both ends included; the end pixels are combined once, the pixels between them twice (visible only in a mode other than Copy; erratum SH1 1). Width 2 or more: a flat-ended bar that **omits the far end** (with a pen exactly 206 wide the left half of a vertical bar lies one row lower than the right half; erratum SH1 14): for `y1 == y2`, pixels `x1 .. x2-1` by `y1 - a .. y1 + b`; for `x1 == x2`, pixels `x1 - a .. x1 + b` by `y1 .. y2-1`. No fill.
- **Case C, `x1 == x2` and `y1 == y2`.** Width 1: **nothing is drawn.** Width 2 or more: the round dot of section 6.2.

The outline uses the pen colour through the drawing mode; the interior uses the fill colour through the drawing mode. Each pixel is combined once (outline and interior do not overlap, and the four sides of a wide outline are one shape), which matters in XOR-type modes. Measured.

Rectangles do not move the pen position.

Task 90 temporarily sets the brush style to clear and restores it to solid with the saved fill colour [SRC simIOu.cpp:1977-1987]; there is no lasting effect.

Examples, pen width 1, EASy rectangles (2,2)-(8,6), (12,2)-(12,6), (16,2)-(20,2), (24,2)-(24,2), (28,2)-(29,3), (33,2)-(35,4); `#` pen, `R` fill:

```
     012345678901234567890123456789012345678
   2 ..#######...#...#####.......##...###...
   3 ..#RRRRR#...#...............##...#R#...
   4 ..#RRRRR#...#....................###...
   5 ..#RRRRR#...#..........................
   6 ..#######...#..........................
```

### 6.4 Ellipses (tasks 88 and 91)

EASy68K sorts the corners, then draws only if `(x1 + y1 + x2 + y2) < 32768` (a Windows 95 limit kept in the code), calling `Ellipse(x1, y1, x2+1, y2+1)` [SRC simIOu.cpp:1932-1955, 1990-2022]. If the sum is 32768 or more nothing is drawn and there is no error. The sum uses the sign-extended values, so it can be negative, which passes.

What GDI draws [GDI]:

- The shape touches all four sides of the inclusive box `x1..x2` by `y1..y2`. It is `x2 - x1 + 1` pixels wide and `y2 - y1 + 1` high. The result depends only on the box size, not on its position (checked on 1680 size/position pairs).
- Pen width 1: a one-pixel outline in the pen colour; task 88 fills the inside with the fill colour; task 91 leaves the inside untouched. The interior is filled first, then the outline is drawn over it; the two overlap, and outline pixels touched by two segments are drawn twice (visible in non-Copy modes; corrected, erratum SH2 1).
- **The outline is not a mathematically ideal ellipse.** GDI converts each quarter of the ellipse to a cubic Bezier curve, flattens it to `n` straight segments and draws those with its line algorithm. Small circles are visibly polygons: a 12 x 12 circle is a regular octagon. A model with Bezier control constant 0.5523, vertices rounded to 1/16 pixel, centre `((x1+x2)/2, (y1+y2)/2)`, radii `(x2-x1)/2`, `(y2-y1)/2`, and `n` = 2 segments per quarter for boxes of 3-13 pixels, 4 for 14-48, 8 from about 49 up to at least 140, 16 by 250-500, reproduces 70 of the 138 circle sizes from 3 to 140 pixel-for-pixel and is a few pixels off on the rest. The exact GDI flattening and end-point rules are UNVERIFIED, so this model is a starting point, not a specification. A standard midpoint ("Bresenham") ellipse matches GDI on almost no size.
- Because of the flattening, about one eighth of the sizes from 1x1 to 64x64 are not mirror-symmetric (523 of 4096 not left-right symmetric, 491 not top-bottom symmetric).
- Degenerate boxes: one point (`x1 == x2`, `y1 == y2`) draws nothing with width 1 and the round dot with wider pens. A box one pixel wide or high draws a straight run of pen pixels. A 2 x 2 box draws only the two pixels of its left column.
- Wide pens: the outline is thickened around the width-1 path and is not symmetric for even widths. UNVERIFIED beyond the two samples I captured.

Measured shapes, pen width 1, task 88 (`#` pen, `R` fill). Box sizes 10x10, 11x11, 16x8, 1x8, 2x2, 3x3, 4x4, 5x5, 6x6, 7x7, 8x8:

```
 .....##...........###............######........#..#....#....##....###.....##......###.......##.....
 ...##RR##.......##RRR##.......###RRRRRR###.....#..#...#R#..#RR#..#RRR#...#RR#....#RRR#....##RR##...
 ..#RRRRRR#.....#RRRRRRR#.....#RRRRRRRRRRRR#....#.......#...#RR#..#RRR#..#RRRR#..#RRRRR#...#RRRR#...
 ..#RRRRRR#.....#RRRRRRR#....#RRRRRRRRRRRRRR#...#............##...#RRR#..#RRRR#..#RRRRR#..#RRRRRR#..
 .#RRRRRRRR#...#RRRRRRRRR#...#RRRRRRRRRRRRRR#...#..................###....#RR#...#RRRRR#..#RRRRRR#..
 .#RRRRRRRR#...#RRRRRRRRR#....#RRRRRRRRRRRR#....#..........................##.....#RRR#....#RRRR#...
 ..#RRRRRR#....#RRRRRRRRR#.....####RRRR####.....#..................................###.....##RR##...
 ..#RRRRRR#.....#RRRRRRR#..........####.........#............................................##.....
 ...##RR##......#RRRRRRR#...........................................................................
 .....##.........##RRR##............................................................................
 ..................###..............................................................................
```

12 x 12, 13 x 13 and 20 x 6 (the last is not symmetric):

```
 .....##.....     ....#####....     ......#########.....
 ..###RR###..     ...#RRRRR#...     .#####RRRRRRRRR####.
 .#RRRRRRRR#.     ..#RRRRRRR#..     #RRRRRRRRRRRRRRRRRR#
 .#RRRRRRRR#.     .#RRRRRRRRR#.     #RRRRRRRRRRRRRRRRRR#
 .#RRRRRRRR#.     .#RRRRRRRRR#.     .#####RRRRRRRR#####.
 #RRRRRRRRRR#     #RRRRRRRRRRR#     ......########......
 #RRRRRRRRRR#     #RRRRRRRRRRR#
 .#RRRRRRRR#.     #RRRRRRRRRRR#
 .#RRRRRRRR#.     .#RRRRRRRRR#.
 .#RRRRRRRR#.     .#RRRRRRRRR#.
 ..###RR###..     ..#RRRRRRR#..
 .....##.....     ...#RRRRR#...
                  ....#####....
```

Left edge offset (number of background pixels before the shape) for the top half of circles of diameter N, one number per row from the top:

```
N=3: 1 0            N=10: 4 2 1 1 0          N=17: 6 4 3 2 1 1 0 0 0
N=4: 1 0            N=11: 4 2 1 1 0 0        N=18: 7 4 3 2 1 1 1 0 0
N=5: 1 0 0          N=12: 5 2 1 1 1 0        N=19: 7 5 3 2 2 1 1 0 0 0
N=6: 2 1 0          N=13: 4 3 2 1 1 0 0      N=20: 8 5 4 3 2 1 1 1 0 0
N=7: 2 1 0 0        N=14: 4 3 2 1 0 0 0      N=21: 8 6 4 3 2 2 1 1 0 0 0
N=8: 3 1 1 0        N=15: 5 3 2 1 1 0 0 0    N=22: 8 6 4 3 2 2 1 1 0 0 0
N=9: 3 1 1 0 0      N=16: 5 4 2 2 1 0 0 0    N=23: 9 6 5 3 3 2 1 1 1 0 0 0
                                             N=24: 10 7 5 4 3 2 2 1 1 0 0 0
```

Ellipses do not move the pen position.

Corrected (erratum SH2 1): the flattening model above is replaced by the exact model of `docs/porting/gdi-deviations.md` section 3 (six steps, each checkable), which reproduces GDI's ellipses; the paragraphs above are kept as the record of how it was found.

PORT: canvas `ellipse()` anti-aliases and cannot be used. Rasterise into the pixel buffer. Pixel-exact agreement with GDI needs either the flattening model above refined against captured GDI output, or a captured lookup table for small sizes with an algorithmic fallback. This is hazard H3.

> **Corrected (erratum SH2 3).** Wide-pen ellipses: the two different outlines are measured in `docs/porting/gdi-deviations.md` step 6; 496 of 500 random wide-pen ellipses are reproduced pixel for pixel (the four that are not are very flat). The families that still differ (tiny boxes, pens much wider than a narrow box) are listed with their measured scope in gdi-deviations.md section 2 (errata SH2 8, 9).

### 6.5 Pixels (tasks 82, 83)

- Task 82: `SetPixel(x, y, pen colour)` on the back buffer, and on the window if not double buffering [SRC simIOu.cpp:1864-1870]. One pixel, regardless of pen width. Outside the surface nothing happens [GDI]. The drawing mode applies (section 5.4).
- Task 83: `GetPixel(x, y)` on the back buffer [SRC simIOu.cpp:1872-1875]. Inside the surface it returns `$00BBGGRR`. Outside it returns `$FFFFFFFF` (GDI `CLR_INVALID`) [GDI].

### 6.6 Flood fill (task 89)

`FloodFill(x, y, Pixels[x][y], fsSurface)` on the back buffer; on the window, the same call using the window's own pixel, if not double buffering [SRC simIOu.cpp:1957-1962]. That is GDI `ExtFloodFill(x, y, colour at (x,y), FLOODFILLSURFACE)`:

- The region is every pixel reachable from (x,y) through horizontal and vertical neighbours whose colour equals the colour at (x,y) exactly. It is **4-connected**: a one-pixel diagonal line is a boundary [GDI, measured].
- The region is painted with the fill colour (subject to section 5.4 for non-Copy modes).
- The surface edge bounds the region.
- If (x,y) is outside the surface nothing happens: the pixel read gives `$FFFFFFFF` and GDI rejects the fill [GDI].
- If the start pixel already has the fill colour the region is still painted: nothing visibly changes in Copy mode, but in a non-Copy mode the region changes (in mode 14 it becomes black) [GDI].
- The colour passed to GDI is the pixel value read just before, and the fill style is `FLOODFILLSURFACE` [BIN `$0046B99C`-`$0046B9E7`, style table at `$005270B0`].

### 6.7 Text drawn as graphics (task 95)

`TextOut(x, y, string)` on the back buffer, and on the window if not double buffering [SRC simIOu.cpp:906-916]:

- (x,y) is the top-left corner of the first character cell.
- An opaque rectangle `string width` x `font cell height` is filled with the **fill colour**, then the glyphs are drawn in the **font colour** [BIN for the choice of colours, see 5.2; GDI for the rectangle, measured: two Fixedsys characters at (10,10) fill exactly x 10-25, y 10-24]. The call is `ExtTextOut(handle, X, Y, TextFlags, NULL, text, length, NULL)` [BIN `$0046BC87`-`$0046BCAD`]; `TextFlags` is a canvas property that EASy68K never sets, so it has its initial value, 0 [VCL].
- Text is not affected by the drawing mode or the pen width [GDI].
- Text is clipped at the surface edge; there is no wrapping and no scrolling.
- EASy68K does not interpret the characters: every byte up to the terminating NUL goes to GDI, and nothing moves the text cursor. What GDI draws for bytes below `$20`, measured with Fixedsys on Windows 11 [GDI]: in a string of two or more bytes, `$09` (tab), `$0A`, `$0D` and `$1C`-`$1F` draw **nothing and take no width** - the characters after them close up, so `'A',9,'B',13,10,'C'` draws `ABC` in three cells; `$0C` draws the font's solid block in a full cell; the other control codes take 4 pixels each (5 for `$02`) and show a narrow hollow box, anti-aliased and not a Fixedsys glyph (`$02` is blank). The text extent, however, still counts one full cell (8 pixels) for every byte, control codes included, so the pen position after the call is `x + 8 * (number of bytes)` even when fewer pixels were painted. A string made only of zero-width control bytes paints one cell of background. So the help's "Control characters are ignored" (graphics.htm:171) holds for the usual case, a string that ends in CR, LF. These results depend on the Windows version (section 15, V13). PORT: paint nothing and advance nothing for bytes below `$20`, but count them at one character width each when moving the pen. Bytes `$80-$FF` are Windows-1252 characters; Fixedsys has no glyph for some of them (`$80` draws the solid block).
- Nothing is recorded in the text array, so task 22 cannot read it back [SRC simIOu.cpp:902-905].
- The pen position moves to `(x + TextWidth(string), y)` (section 5.5). An empty string draws nothing and still moves the pen to (x,y).

> **Corrected (erratum T2 2.1).** Rules beyond this section, measured by T2 (`tests/conformance/gdi/text-model.ts` reproduces all 1,881 `text` cases): TextWidth counts a zero-width byte (`$09 $0A $0D $1C-$1F`) in a string of two or more bytes as 0 when the string contains a byte of `$80` or above, and its full advance otherwise, in every style. In the outline faces `$7F` in a string with a byte of `$80` or above takes the fallback glyph's width (`delInHighString` of `scalable/index.json`), Consolas `$0D` advances 0, and the opaque cell is the sum of the drawn widths (a zero-width byte takes none, `$7F` always `delInHighString`). In the raster faces the opaque cell includes the style overhang (+1 bold, +`floor((h-1)/2)` italic), which italic leaves out when two or more bytes are drawn and the string contains a zero-width byte or `$7F` with another drawn byte; `$02` paints nothing but takes 5 pixels in Fixedsys. Not modelled, and kept in the machine-dependent suite `text-control`: the fallback-font control bytes, the five undefined bytes, `$0C`, `@` and `$80` next to `$7F $86 $87 $88 $98`, and the sizes where Windows 11 draws a thin bar for a lone zero-width byte (`ZERO_WIDTH_BAR_SIZES`).

### 6.8 Text and graphics share one surface

- Ordinary text output (tasks 0-25, keyboard echo) draws each character with the same `TextOut` at `(column * colWidth, row * rowHeight)` [SRC simIOu.cpp:863-869]. It overwrites whatever graphics are in that cell, with the fill colour as background.
- Graphics drawn over text simply replace pixels; the text array still holds the characters.
- When text output passes the bottom row, `scroll()` copies the whole surface up by one text row and blacks the bottom row [SRC simIOu.cpp:1107-1144]. **Graphics scroll with the text.**
- Clear screen (task 11 with `D1.W = $FF00`, or a form-feed character) fills `0,0 - ClientWidth,ClientHeight` of the back buffer with **black** (not the fill colour), copies that to the window if not double buffering, sets every text cell to a space and homes the text cursor [SRC simIOu.cpp:1016-1035]. It does not change colours, pen width, drawing mode, pen position or the double-buffer flag.
- The blinking input prompt `_` is drawn on the window only, never on the back buffer, and it does not blink while double buffering [SRC simIOu.cpp:1420-1434]; the prompt erase is also window-only but is not suppressed by double buffering (5.6). Task 83 never sees either.
- Printing text moves the graphics pen (section 5.5).

## 7. Graphics tasks 80-96, one by one

Common to all of them: coordinates are sign-extended low words (4.5); no task returns an error code; none blocks; none shows the window; each operation is applied to the back buffer and, unless double buffering is on, to the window.

### Task 80 - set pen colour
- Source: `simIO->setLineColor(D[1]);` [SRC CODE9.CPP:1195-1197; simIOu.cpp:1852-1856].
- Input: `D1.L` colour `$00BBGGRR` (all 32 bits are used; see 4.6 for a non-zero top byte).
- Output: none. Side effect: pen colour of both canvases.

### Task 81 - set fill colour
- Source: `simIO->setFillColor(D[1]);` [SRC CODE9.CPP:1198-1200; simIOu.cpp:1858-1862].
- Input: `D1.L` colour. Output: none.
- Side effect: brush colour of both canvases. This is also the background colour of all text drawn afterwards (5.2).

### Task 82 - draw pixel
- Source: `simIO->drawPixel((short)D[1],(short)D[2]);` [SRC CODE9.CPP:1201-1203; simIOu.cpp:1864-1870].
- Inputs: `D1.W` = X, `D2.W` = Y, signed.
- Output: none. Pen position unchanged.
- Effect: one pixel in the pen colour (6.5). Pen width is ignored. The drawing mode applies (5.4; the help and the source comment say it does not).

### Task 83 - get pixel
- Source: `D[0] = simIO->getPixel((short)D[1], (short)D[2]);` [SRC CODE9.CPP:1204-1206; simIOu.cpp:1872-1875].
- Inputs: `D1.W` = X, `D2.W` = Y, signed.
- Output: `D0.L` = `$00BBGGRR` of the back-buffer pixel, or `$FFFFFFFF` if (X,Y) is outside the surface. The whole of D0 is overwritten, so the task number in D0 is lost.
- Reads the back buffer, so it sees drawing that is not yet on screen in double-buffer mode and never sees the input prompt.

### Task 84 - line
- Source: `simIO->line((short)D[1], (short)D[2], (short)D[3], (short)D[4]);` [SRC CODE9.CPP:1207-1209; simIOu.cpp:1877-1888].
- Inputs: `D1.W` = X1, `D2.W` = Y1, `D3.W` = X2, `D4.W` = Y2, signed.
- Algorithm: `MoveTo(x1,y1); LineTo(x2,y2); Pixels[x2][y2] = Pen->Color;` on the back buffer, repeated on the window if not double buffering.
- Pixels: 6.1 (width 1) or 6.2 (wider). Both end points are drawn.
- Pen position becomes (X2,Y2) (5.5).

### Task 85 - line to
- Source: `simIO->lineTo((short)D[1], (short)D[2]);` [SRC CODE9.CPP:1210-1212; simIOu.cpp:1890-1899].
- Inputs: `D1.W` = X, `D2.W` = Y, signed.
- Algorithm: `LineTo(x,y); Pixels[x][y] = Pen->Color;` from the current position of each canvas. On the back buffer the start is the back-buffer position; on the window it is the window position (they can differ, 5.5).
- Pen position becomes (X,Y).

### Task 86 - move to
- Source: `simIO->moveTo((short)D[1], (short)D[2]);` [SRC CODE9.CPP:1213-1215; simIOu.cpp:1902-1906].
- Inputs: `D1.W` = X, `D2.W` = Y, signed. Nothing is drawn.
- Sets the pen position of **both** canvases, also in double-buffer mode.

### Task 87 - rectangle, outlined and filled
- Source: `simIO->rectangle((short)D[1], (short)D[2], (short)D[3], (short)D[4]);` [SRC CODE9.CPP:1216-1218; simIOu.cpp:1915-1930].
- Inputs: `D1.W` = left X, `D2.W` = upper Y, `D3.W` = right X, `D4.W` = lower Y, signed. Reversed corners are swapped per axis.
- Pixels: 6.3. Outline in pen colour and pen width, interior in fill colour, both through the drawing mode.
- Pen position unchanged. No output.

### Task 88 - ellipse, outlined and filled
- Source: `simIO->ellipse(...)` same four arguments [SRC CODE9.CPP:1219-1221; simIOu.cpp:1932-1955].
- Inputs as task 87; the box is the bounding rectangle.
- Nothing is drawn if `x1 + y1 + x2 + y2 >= 32768` after sorting.
- Pixels: 6.4. Pen position unchanged. No output.

### Task 89 - flood fill
- Source: `simIO->floodFill((short)D[1], (short)D[2]);` [SRC CODE9.CPP:1222-1224; simIOu.cpp:1957-1962].
- Inputs: `D1.W` = X, `D2.W` = Y, signed.
- Effect: 6.6. Uses the fill colour. No output, no error for a point off the surface.
- The window is filled by a second flood fill that reads the window's own pixel at (X,Y). In the original this can differ from the back buffer if the window is partly covered. PORT: one fill on the back buffer.

### Task 90 - rectangle, outline only
- Source: `simIO->unfilledRectangle(...)` [SRC CODE9.CPP:1225-1227; simIOu.cpp:1964-1988].
- Inputs as task 87. Pixels: the outline of 6.3; the interior is not touched. Fill colour is preserved.

### Task 91 - ellipse, outline only
- Source: `simIO->unfilledEllipse(...)` [SRC CODE9.CPP:1228-1230; simIOu.cpp:1990-2022].
- Inputs as task 88, same `< 32768` test. Pixels: the outline of 6.4.

### Task 92 - drawing mode and double buffering
- Source: `simIO->setDrawingMode(D[1]);` then `m &= 0x00FF;` [SRC CODE9.CPP:1231-1233; simIOu.cpp:2024-2037].
- Input: **`D1.B`** (the function masks to 8 bits). The source header says `D1.W` (CODE9.CPP:589), the help says `D1.B` (graphics.htm:124); the code agrees with the help.
- 0-15: pen mode (5.4). 16: double buffering off and immediate repaint. 17: double buffering on (5.6). 18-255: undefined in the original (5.4).
- No output.

### Task 93 - pen width
- Source: `simIO->setPenWidth(D[1]);` then `w &= 0x00FF;` [SRC CODE9.CPP:1234-1236; simIOu.cpp:2039-2044].
- Input: `D1.B`, 0-255. 0 behaves as 1. No output.

### Task 94 - repaint
- Source: `simIO->FormPaint((TObject *)simIO);` [SRC CODE9.CPP:1237-1239; simIOu.cpp:379-388].
- No inputs, no outputs. Copies the entire back buffer to the window at once. Legal in either buffering mode.

### Task 95 - draw text at a pixel position
- Source: `simIO->drawText(inStr, (short)D[1], (short)D[2]);` after the memory-map check of rule 6 in section 1 [SRC CODE9.CPP:1240-1247; simIOu.cpp:906-916].
- Inputs: `A1` = address of a NUL-terminated string (no length limit; unlike tasks 70-74 it is not truncated to 255); `D1.W` = X, `D2.W` = Y, signed, top-left of the text.
- Effect: 6.7. Pen position moves to the right end of the text. No output.

### Task 96 - get pen position
- Source: `simIO->getXY((short*)&D[1],(short*)&D[2]);` which stores `(short)Canvas->PenPos.x` and `.y` [SRC CODE9.CPP:1248-1250; simIOu.cpp:1909-1913].
- Outputs: `D1.W` = X, `D2.W` = Y. The high words of D1 and D2 are unchanged.
- Returns the **window** canvas position (5.5), which lags behind in double-buffer mode.

## 8. Mouse

### 8.1 Event model [SRC simIOu.cpp:636-793]

The I/O form has three handlers. X and Y are client-area pixels, i.e. surface coordinates (4.5). The `Button` argument (which button caused the event) is ignored; the handlers use only the `Shift` set, which reflects the state **after** the event.

`Shift` flags as delivered by the VCL [VCL]: `ssLeft`, `ssRight`, `ssMiddle` = that button is down after the event (from the Windows message's `MK_LBUTTON`, `MK_RBUTTON`, `MK_MBUTTON`); `ssShift`, `ssCtrl` = key held (`MK_SHIFT`, `MK_CONTROL`); `ssAlt` = Alt held (`GetKeyState(VK_MENU)`); `ssDouble` = this button-down message is the second press of a double-click (`WM_xBUTTONDBLCLK`). `ssDouble` is never present in button-up or move events.

**Button down** (`FormMouseDown`, lines 636-700):

```
mouseX = X; mouseY = Y; mouseXDown = X; mouseYDown = Y;
for each of Left, Right, Middle, Double, Shift, Alt, Ctrl:
    flag = Shift.Contains(ss...)
    current variable = flag;  ...Down variable = flag;
if (mouseDownIRQ) Hardware->IRQprocess(mouseDownIRQ);
```

**Button up** (`FormMouseUp`, lines 703-766): identical, with the `...Up` variables and `mouseUpIRQ`.

**Move** (`FormMouseMove`, lines 769-793):

```
mouseX = X; mouseY = Y;
keyShift, keyAlt, keyCtrl = Shift.Contains(...)
if (mouseMoveIRQ) Hardware->IRQprocess(mouseMoveIRQ);
```

Consequences that a port must reproduce:

1. A move event does **not** update the button flags. `mouseLeft` etc. change only on button-down and button-up events inside the window.
2. On releasing the only pressed button, `Shift` no longer contains that button, so the "current" flag and the "up snapshot" flag for it are both **false**. The up snapshot records which buttons are *still held* after the release, not which button was released. With one button in use the up snapshot's button bits are 0.
3. `mouseDouble` is true only from the second press of a double-click until the next button event; the following release clears it. `mouseDoubleUp` is always false. `mouseDoubleDown` stays true until the next button-down.
4. The snapshots hold one event each. There is no queue; a second event overwrites the first.
5. State variables are updated before `IRQprocess` is called, so an interrupt handler that calls task 61 sees the event that caused the interrupt.
6. Events arrive only for the I/O window's client area, except that the VCL captures the mouse while the **left** button is held (it does not capture for the right or middle button), so a left-button drag continues to report positions outside the window, and its release is reported wherever it happens. Those coordinates are signed 16-bit values and can be negative or larger than the surface. A right or middle button pressed inside and released outside the window produces no button-up event [VCL].
7. There is no handler for the wheel, for leave/enter, or for touch.
8. In full screen the client area is the whole display, so coordinates are display pixels at the surface resolution.
9. `initSim()` zeroes all snapshots (3.2).

### 8.2 Task 60 - mouse IRQ enable/disable

- Source [SRC CODE9.CPP:1066-1076]:

```
mouseIRQ = (byte)(D[1] >> 8);
if (mouseIRQ > 7) break;          // invalid level: nothing changes
if (D[1] & 0x0001) mouseDownIRQ = mouseIRQ;
if (D[1] & 0x0002) mouseUpIRQ   = mouseIRQ;
if (D[1] & 0x0004) mouseMoveIRQ = mouseIRQ;
```

- Inputs: `D1` bits 8-15 = IRQ level 0-7 (0 = off); `D1` bit 0 = button down, bit 1 = button up, bit 2 = move. Bits 3-7 and 16-31 are ignored.
- Each event whose bit is 1 gets the level; events whose bit is 0 keep their previous level. `D1.W = $0107` arms all three at level 1; `$0002` disarms button-up only; `$0000` changes nothing.
- A level byte of 8-255 makes the whole call a no-op.
- Outputs: none. D0 unchanged. Does not block.
- The three events may use different levels (the official `mouseWindowSize.X68` uses levels 1, 2 and 3).

### 8.3 Task 61 - mouse read

- Source [SRC CODE9.CPP:1077-1128].
- Input: `D1.B` selector: 0 = current state, 1 = up snapshot, 2 = down snapshot.
- First statement is `D[0] = 0;` so **`D0.L` is always overwritten**, even for an invalid selector.
- Outputs for selector 0, 1 or 2:
  - `D0.L` bit 0 = Left, bit 1 = Right, bit 2 = Middle, bit 3 = Double, bit 4 = Shift, bit 5 = Alt, bit 6 = Ctrl (1 = true); all other bits 0.
  - `D1.L = (Y << 16) | (ushort)X` from the matching snapshot: high word Y, low word X, each the low 16 bits of a signed value.
- Selector 3-255: `D0.L = 0`, D1 unchanged.
- Does not block and does not clear any snapshot.
- The meaning of the button bits is as in 8.1: selector 1 normally returns 0 in bits 0-2.

### 8.4 Mapping for a browser (PORT)

- Position: `x = floor((clientX - rect.left) * canWidth / rect.width)`, same for y, so that CSS scaling and device-pixel-ratio do not leak in. Do not clamp while a button is held.
- Buttons after the event: `MouseEvent.buttons` bit 0 = left, bit 1 = right, bit 2 = middle. This matches the Windows "state after the event" rule for both down and up events.
- Double: on `mousedown`, `event.detail` even (2, 4, ...) corresponds to a Windows double-click message. Windows uses the system double-click time and distance; small timing differences are unavoidable.
- Shift, Alt, Ctrl: `shiftKey`, `altKey`, `ctrlKey`. On macOS Ctrl+click arrives as a right click; decide and document.
- Suppress the context menu on the canvas, otherwise right-button events are lost.
- Use pointer capture on left-button down to keep receiving moves and the release outside the canvas. The original does not capture for the right and middle buttons (8.1 item 6); capturing them as well is a small, harmless deviation that must be documented if chosen.

## 9. Key interrupts and the key state they rely on

Only task 62 is in this range. Reading keys is task 19 and task 24 in `trap15-tasks-0-59.md`; the shared state is summarised here.

### 9.1 Key state [SRC simIOu.cpp:417-464, 584-632]

`FormKeyDown` (every Windows key-down message for the I/O window, including auto-repeat):

```
keys[(uchar)Key] = true;
keyDownCode = (char)Key;
if (keyDownIRQ) Hardware->IRQprocess(keyDownIRQ);
if (disableKeyCommands) { Key = 0; return; }
... Ctrl+Tab, Alt+Enter (full-screen toggle), Shift+Insert (paste) ...
```

`FormKeyUp`:

```
keys[(uchar)Key] = false;
keyUpCode = (char)Key;
if (keyUpIRQ) Hardware->IRQprocess(keyUpIRQ);
```

- `Key` is the Windows virtual-key code; only its low byte is used.
- The interrupt is requested before the simulator's own shortcut handling and regardless of task 24.
- Auto-repeat produces repeated key-down events and therefore repeated interrupts.
- `clearKeys()` (all `keys[]` false, both codes 0) runs whenever the I/O window is activated and when task 58 opens a file dialog [SRC simIOu.cpp:477, 615-632].
- Events arrive only while the I/O window has keyboard focus.
- Plain Tab and Shift+Tab are swallowed by the VCL's dialog navigation before `OnKeyDown`: the form answers the dialog-key query for Tab whenever neither Ctrl nor Alt is down, so no key-down event, no key-down interrupt and no character reach the program, while the key-up event still arrives. Ctrl+Tab passes (the source tests for it, simIOu.cpp:434). Arrow keys, Enter and Esc pass because the form has no child controls to navigate between [VCL; section 15, V10].

Virtual-key codes (help page `keyCodes.htm`, plus the standard Windows values): letters `$41-$5A` (always the capital letter's ASCII code), top-row digits `$30-$39`, Backspace `$08`, Tab `$09`, keypad 5 with NumLock off `$0C`, Enter `$0D`, Shift `$10`, Ctrl `$11`, Alt `$12`, Pause `$13`, Caps Lock `$14`, Esc `$1B`, Space `$20`, Page Up `$21`, Page Down `$22`, End `$23`, Home `$24`, Left `$25`, Up `$26`, Right `$27`, Down `$28`, Insert `$2D`, Delete `$2E`, keypad 0-9 with NumLock on `$60-$69`, keypad `*` `$6A`, `+` `$6B`, `-` `$6D`, `.` `$6E`, `/` `$6F`, F1-F12 `$70-$7B`, Num Lock `$90`, Scroll Lock `$91`, `;` `$BA`, `=` `$BB`, `,` `$BC`, `-` `$BD`, `.` `$BE`, `/` `$BF`, backquote `$C0`, `[` `$DB`, `\` `$DC`, `]` `$DD`, quote `$DE`. Left and right Shift/Ctrl/Alt are not distinguished. Modifier keys do not change the code of other keys. PORT: build this table from `KeyboardEvent.code`; do not rely on the deprecated `keyCode`, which differs between browsers for punctuation.

### 9.2 Task 62 - key IRQ enable/disable

- Source [SRC CODE9.CPP:1131-1139]:

```
keyIRQ = (byte)(D[1] >> 8);
if (keyIRQ > 7) break;
if (D[1] & 0x0001) keyDownIRQ = keyIRQ;
if (D[1] & 0x0002) keyUpIRQ   = keyIRQ;
```

- Inputs: `D1` bits 8-15 = level 0-7 (0 = off); bit 0 = key down, bit 1 = key up. Same selective-update rule as task 60. Level above 7: no-op.
- Outputs: none. Does not block.
- The handler finds out which key it was with task 19, `D1.L = 0`, which returns `(keyUpCode << 16) + keyDownCode`.

## 10. How a mouse or key event becomes a 68000 interrupt

### 10.1 Request: `THardware::IRQprocess(int irqN)` [SRC hardwareu.cpp:757-775]

```
if (hardwareEnabled) {
    if (irqN > 0) irq |= (0x01 << (irqN-1));
    if (stopInstruction) {                       // CPU is parked on a STOP instruction
        intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
        if (!(irq & intMask)) return;            // masked: leave it pending, stay stopped
    }
    inc_cyc(44);
    if (!trace) runMode = true;
    if (runMode) Form1->runLoop();
}
```

- `hardwareEnabled` is true after every `initSim()` [SRC STARTSIM.CPP:84; hardwareu.cpp:923-926] and false after the program halts through task 9, SIMHALT, a STOP without exception processing, or a bus/address error without exception processing [SRC CODE9.CPP:787, 1317; RUN.CPP:957, 1126; hardwareu.cpp:907-910]. After one of those halts, mouse and key events no longer request interrupts. The other ways a program can stop do **not** disable the hardware: an illegal instruction, privilege violation, CHK, divide by zero, TRAP, TRAPV, line-A, line-F or trace condition with exception processing off (RUN.CPP:938-999), a breakpoint and Pause. After those, an armed mouse or key event still goes through `IRQprocess`; unless the simulator is in trace mode (which breakpoints and Pause set) that restarts execution at the current PC. `hardware.md` section 3 describes this path in full.
- The request is one bit per level in `irq`. Several events at the same level before the CPU services it merge into one interrupt.
- Every accepted request adds 44 to the cycle counter, whether or not the interrupt is ever taken.
- If the simulator is not tracing, the request sets `runMode` and enters the run loop (which returns at once if it is already running, SIM68Ku.cpp:249-266). This is what wakes a program waiting in `STOP`.

### 10.2 Service: after each instruction [SRC RUN.CPP:862-880, 1083-1117]

Only **when exception processing is enabled** (Options > Enable Exceptions, command-line `/e`, or task 32 with `D1.B = 5`):

```
intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
if (irq & intMask) irqHandler();
```

`intMask` allows levels strictly above the SR interrupt mask, and level 7 always. `irqHandler()` pushes PC (long) then SR (word) on the supervisor stack, sets the S bit, clears the T bit, sets the SR mask to the level being serviced, loads PC from the autovector `$64` (level 1), `$68`, `$6C`, `$70`, `$74`, `$78`, `$7C` (level 7), clears that level's bit in `irq`, and adds 34 cycles. The highest pending level is serviced first.

With exception processing **disabled** the pending bit just stays set: no interrupt is taken, yet the 44 cycles are added and the run loop is started. If the program later enables exceptions (task 32/5) the stale request fires at once. A program that wants mouse or key interrupts must enable exceptions itself, as the official sample does.

PORT: `hardwareu.cpp` is a VCL unit and has to be re-implemented; `irq`, `irqHandler()` and the check in `exec_inst()` are in the original core. Browser events must be turned into exactly the calls above, between instruction batches.

## 11. Sound

There are two independent players with separate slot arrays.

| | Standard player | DirectX player |
|---|---|---|
| Tasks | 70, 71, 72, 76 | 73, 74, 75, 77 |
| Windows API | `PlaySound` (winmm) [SRC simIOu.cpp:1626, 1663, 1689, 1694] | DirectMusic `IDirectMusicPerformance8`/`IDirectMusicLoader8` [SRC simIOu.cpp:1460-1588] |
| Voices | one at a time; a new request while busy is **rejected**, it does not replace the playing sound | many at once, mixed |
| Slots | `wavemem[0..255]`, raw file bytes | `dmusicSegments[0..255]`, loaded segments |
| Availability | always | only if `dsoundExist` (11.1) |

### 11.1 Availability of the DirectX player

`dsoundExist` starts true if `dsound.dll` exists in the Windows system directory and can be loaded [SRC SIM68K.cpp:68-90]. The I/O form's constructor clears it if `CoInitialize` fails or if `InitDirectXAudio` fails to create the DirectMusic loader or performance [SRC simIOu.cpp:102-114, 1460-1496]. The performance is initialised with `DMUS_APATH_DYNAMIC_STEREO`, 64 channels. When `dsoundExist` is false, tasks 73, 74, 75 and 77 return `D0.W = 0` and do nothing.

PORT: report the DirectX player as available (Web Audio can mix), unless audio is unavailable altogether.

### 11.2 File names

- Tasks 70, 71, 73, 74 copy at most 255 bytes of the string at (A1) and force a terminator: `strncpy(buf,inStr,255); buf[255] = '\0';` [SRC CODE9.CPP:1143-1144 and the three siblings]. Longer names are truncated.
- The name is a Windows path in the ANSI code page: backslashes, drive letters and relative names are all possible, and Windows matches file names without regard to case.
- Existence is tested with VCL `FileExists(name)` before anything else [SRC simIOu.cpp:1625, 1641, 1723, 1751]. A missing file adds `'<name>' not found` to the main window's message log and the task returns without touching the slot.
- **Relative names resolve against the process's current directory.** When the simulator is started with the editor's Execute button, the editor has just made the source file's folder current (`SetCurrentDir(ExtractFilePath(...))`, `src-edit68k\Edit68Kv5.16.1\mainS.cpp:370`) and the simulator inherits it (`spawnl`, `assembleS.cpp:36-37`). When the user opens the .S68 with File > Open, the Windows file dialog makes that file's folder current (the dialog has no `ofNoChangeDir`, SIM68Ku.dfm:2237-2240) [Windows behaviour]. A task 58 file dialog can change it again. In practice: the folder of the .X68/.S68 file. The shipped examples use bare names such as `'tick.wav'`.
- The DirectMusic loader's search directory is set once, to the current directory at simulator start [SRC simIOu.cpp:1483-1490]. Whether a relative name that exists in a later current directory but not in the start-up directory loads is UNVERIFIED.
- PORT: resolve relative names against the folder of the loaded .S68, accept `\` and `/`, match case-insensitively.

Formats: the standard player plays what `PlaySound` plays, RIFF WAVE files (PCM, and compressed WAVE for which Windows has a codec). The DirectMusic loader loads WAVE files and, because the code asks for a generic segment (`CLSID_DirectMusicSegment`, simIOu.cpp:1509-1512), also MIDI and DirectMusic segment files; the help only promises WAV. The shipped example sounds are PCM, 8 or 16 bit, mono or stereo, 11025 or 22050 Hz. What `PlaySound` does with a file that exists but is not a valid WAVE (it may play the Windows default sound) is UNVERIFIED.

### 11.3 Standard player tasks

`PlaySound` is always called with `SND_ASYNC | SND_NOSTOP`: it returns immediately; it returns TRUE (1) if playback started and FALSE (0) if a sound started by this process is still playing. "Busy" covers sounds started by tasks 70, 72 and 76, including a looping sound.

The shipped example relies on this to play sounds one after another [`examples\official\Examples\graphicSound.X68` lines 193-204]:

```
play0 move  #0,d1
      move  #72,d0
      trap  #15
      tst.w d0          ; d0 = 0 if player is busy
      beq   play0       ; loop until sound plays
```

**Task 70 - play WAV file** [SRC CODE9.CPP:1141-1150; simIOu.cpp:1622-1635]
- Input: `A1` = file name (11.2).
- If the file exists: `D0.W = (short) PlaySound(fileName, NULL, SND_ASYNC | SND_NOSTOP | SND_FILENAME)` = 1 started, 0 busy.
- If the file does not exist: message in the log and **D0 is not written**. `D0.W` still holds what the program loaded, normally 70, which reads as "success". The help says "Invalid file names are ignored".
- High word of D0 unchanged. Does not block. Does not set `currentWave`.

**Task 71 - load WAV into slot** [SRC CODE9.CPP:1151-1160; simIOu.cpp:1638-1653]
- Inputs: `A1` = file name; `D1.B` = slot 0-255.
- If the file exists, the whole file is read into a new buffer stored in `wavemem[slot]`. The contents are not validated. The previous buffer is not freed (a leak in the original with no visible effect; a sound still playing from it keeps playing).
- If the file does not exist: message, slot unchanged.
- **No register is written.** There is no success indication.

**Task 72 - play slot** [SRC CODE9.CPP:1161-1163; simIOu.cpp:1658-1670]
- Input: `D1.B` = slot.
- If the slot is loaded: `currentWave = slot;` then `D0.W = PlaySound(wavemem[slot], NULL, SND_ASYNC | SND_NOSTOP | SND_MEMORY)` = 1 or 0. `currentWave` is set even when the player was busy and the sound did not start.
- If the slot is empty: nothing happens and **D0 is not written** (so `D0.W` normally stays 72).

**Task 76 - control standard player** [SRC CODE9.CPP:1187-1189; simIOu.cpp:1681-1710]
- Inputs: `D1.B` = slot; `D2.L` = command (all 32 bits are compared).
- `D0.W` is first set to 0. Then:

| `D2.L` | Slot loaded | Slot empty |
|---|---|---|
| 0 play once | `currentWave = slot`; `D0.W` = 1 started / 0 busy | `D0.W = 0` |
| 1 play looped | same with `SND_LOOP`: repeats until stopped; `D0.W` = 1 / 0 busy | `D0.W = 0` |
| 2 stop this slot | if `slot == currentWave`: `PlaySound(NULL, NULL, SND_PURGE)` stops whatever the standard player is playing, `D0.W = 1`; otherwise `D0.W = 0` and nothing stops | `D0.W = 0` |
| 3 stop all | `PlaySound(NULL, NULL, SND_PURGE)`, `D0.W = 1` | same: works with any `D1.B` |
| other | `D0.W = 0` | `D0.W = 0` |

- "Stop this slot" compares against `currentWave`, which is only the last slot handed to tasks 72/76, not necessarily the one sounding (see task 72), and is never cleared when a sound ends. A sound started by task 70 can be stopped by command 2 only by accident, and always by command 3.

> **Corrected (erratum SH5 3).** Port decisions (SH5): task 70 with a file that is not a WAVE file gives `D0.W = 1` and duration 0; task 70 while busy reads the file first, so a missing file gives its message and leaves D0 even while busy, and a refused task 70 hands nothing to the backend. A standard slot's sound is released when the slot is emptied, unless the standard voice plays it (then when that voice ends).

### 11.4 DirectX player tasks

All four set `D0.W = 0` first and return at once if `dsoundExist` is false.

**Task 73 - play WAV file** [SRC CODE9.CPP:1164-1173; simIOu.cpp:1717-1736]
- Input: `A1` = file name.
- File missing: message, `D0.W = 0`. Load failure: message `'<name>' Error loading ` (with the trailing space), `D0.W = 0`. Otherwise the file is loaded into the single shared segment `dmusicSegment`, played once, `D0.W = 1`.
- Unlike task 70, a missing file gives a clean 0.
- Sounds overlap freely. Each call overwrites the pointer `dmusicSegment` without stopping or releasing the previous segment. The source has no way to stop a sound started by task 73: task 77 only knows the 256 slots and `ResetSounds` does not touch `dmusicSegment`, so it plays to its end even across a reset (but see the loader-cache note at the end of this section).

**Task 74 - load WAV into slot** [SRC CODE9.CPP:1174-1183; simIOu.cpp:1745-1763]
- Inputs: `A1` = file name; `D1.B` = slot.
- File missing: message, `D0.W = 0`, slot unchanged. Otherwise the old segment in the slot, if any, is released (it is not stopped first), the file is loaded, and `D0.W = 1` on success, 0 on load failure.
- After a load failure (the file exists but DirectMusic rejects it) the slot's old segment has already been released and the slot pointer is whatever `LoadObjectFromFile` left in it; the source does not clear it. The state of that slot is then undefined in the original. PORT: treat the slot as empty.

**Task 75 - play slot** [SRC CODE9.CPP:1184-1186; simIOu.cpp:1769-1783]
- Input: `D1.B` = slot. Loaded: start one more playback of it, `D0.W = 1`. Empty: `D0.W = 0`.
- Playing a slot that is already playing starts an additional overlapping copy.

**Task 77 - control DirectX player** [SRC CODE9.CPP:1190-1192; simIOu.cpp:1814-1846]
- Inputs: `D1.B` = slot; `D2.L` = command.
- **Everything, including "stop all", is inside `if(dmusicSegments[waveIndex] != NULL)`.** If the slot in `D1.B` is empty, `D0.W = 0` and nothing happens, whatever the command. The help says `D1.B` is ignored for command 3; the source needs it to name a loaded slot.

| `D2.L` | Effect when the slot is loaded | `D0.W` |
|---|---|---|
| 0 | play once (as task 75) | 1 |
| 1 | `SetRepeats(DMUS_SEG_REPEAT_INFINITE)` on the segment, then play: loops until stopped | 1 |
| 2 | stop every playing copy of this slot immediately | 1 |
| 3 | stop every loaded slot | 1 |
| other | nothing | 0 |

- Command 3 calls the stop routine for all 256 slots and then forces `D0.W = 1`; command 2 returns 1 whether or not the slot was sounding.
- Quirk: command 1 sets the repeat count on the segment object and nothing ever sets it back [SRC simIOu.cpp:1544-1559; the only `SetRepeats` call in the source]. After a slot has been looped once, later "play once" requests for it (task 75 or command 0) also loop forever. Derived from the DirectMusic API contract; confirm on real EASy68K (section 15, V6).
- Loader cache. The source never disables the DirectMusic loader's object cache, which the API documents as enabled by default; with it, loading the same file again returns the same segment object. If that is what happens in SIM68K, then: two slots loaded from one file are one sound (stopping or looping either affects both); task 73 playing a file that is also in a slot can be stopped through that slot and inherits its looping; and the sticky looping above survives a task 74 reload of the same file and a reset, for as long as the simulator runs. None of this can be read from the source. UNVERIFIED (V6). PORT: keep one decoded sound per slot, make looping sticky per slot until the slot is reloaded or the simulator is reset, and record the choice as a possible deviation.

> **Corrected (erratum SH5 3).** Port decisions (SH5): "the loader rejects" means `parseWav` says the file is no valid RIFF WAVE file (so MIDI and segment files are rejected); a WAVE file the browser cannot decode is accepted and silent. Task 74 over a loaded slot releases the old sound without stopping it (`simIOu.cpp:1752`), and its playbacks play on until a reset; any reload clears looping. Task 77 command 3 stops the voices of every loaded slot, not those orphans. A task 73 sound is released once its duration has passed. `currentWave` survives a reset and is -1 again after `resetToStartup()`.

### 11.5 Reset: `ResetSounds()` [SRC simIOu.cpp:1593-1614]

Called from `initSim()`. Stops the standard player (`SND_PURGE`); for each of the 256 slots stops and releases the DirectX segment and frees the standard buffer; both arrays end up empty. The shared task-73 segment is not stopped.

### 11.6 Blocking and timing

No sound task waits for playback. File reads are synchronous but short. PORT: decoding in Web Audio (`decodeAudioData`) is asynchronous. Either decode ahead of time when the program's folder is loaded, or let "load" return success immediately and queue "play" until decoding completes. The busy flag of the standard player must become false when the sound's real duration has elapsed, even if the browser has suspended the audio context; otherwise the wait loop above never ends (hazard H6).

## 12. Network tasks 100-107

### 12.1 Model [SRC Net.cpp, Net.h]

One socket for the whole simulator, non-blocking, Winsock 1.1. State:

| Variable | Values |
|---|---|
| `mode` | `UNINITIALIZED` 0, `SERVER` 1, `CLIENT` 2 |
| `type` | `UNCONNECTED` -1, `UDP` 0, `UNCONNECTED_TCP` 2, `CONNECTED_TCP` 3 |
| `netInitialized` | set by a successful `netInit`, cleared by `netCloseSockets` |
| `bound` | false at program start; set true by a successful server bind and by any successful send; **never set back to false** |
| `remote`, `local` | socket addresses. `remote` is overwritten by every receive with the sender's address and port |

Result codes [SRC Net.h:22-31]: `NET_OK` 0, `NET_ERROR` 1, `NET_INIT_FAILED` 2, `NET_INVALID_SOCKET` 3, `NET_GET_HOST_BY_NAME_FAILED` 4, `NET_BIND_FAILED` 5, `NET_CONNECT_FAILED` 6, `NET_ADDR_IN_USE` 7, `NET_DOMAIN_NOT_FOUND` 8, `REMOTE_DISCONNECT` `$2775`. Codes 4, 6 and 7 are defined and documented in the help but **never returned** by the code. A result is `(Winsock error << 16) + code`, written to `D0.L`. Winsock error numbers are 10000 + n, e.g. `$2740` = address in use, `$274D` = connection refused, `$276D` = network not initialised.

`netInit(port, protocol)` [SRC Net.cpp:35-104]: if the network is initialised it calls `netCloseSockets()` first (result ignored); sets `mode = UNINITIALIZED`; `WSAStartup(1.1)`, whose failure returns `(error << 16) + 2`; protocol 0 creates a UDP socket (`type = UDP`), 1 a TCP socket (`type = UNCONNECTED_TCP`), anything else returns plain 2 (`NET_INIT_FAILED`, no extended code); a socket or `ioctlsocket` failure returns `(error << 16) + 3`; sets non-blocking mode; stores `htons(port)` in both `local` and `remote`; sets `netInitialized`. Because `mode` is cleared at the start, a failed task 100 or 101 leaves the simulator neither client nor server: a later send then uses whatever address `remote` still holds and ignores (A2).

### 12.2 Tasks

**Task 100 - create client** [SRC CODE9.CPP:1253-1255; simIOu.cpp:2378-2385; Net.cpp:159-218]
- Inputs: `D1.L` bits 0-7 = protocol (0 UDP, 1 TCP), bits 8-15 ignored, bits 16-31 = port; `A2` = NUL-terminated dotted IP address or host name.
- Output: `D0.L` = result.
- Steps: `netInit`; if the string is not a dotted address (`inet_addr` fails) it is looked up with `gethostbyname` (blocking); failure returns 8 with no extended code; on success the resolved address is written back to (A2) with `strncpy(server, ..., 16)`, which writes **exactly 16 bytes** (zero padded). A dotted address leaves (A2) untouched; the help's "(A2) IP address connected to" applies only to the host-name case. Then `mode = CLIENT`.
- TCP only: a loop calls `connect` on the non-blocking socket. "Already connected" (`WSAEISCONN`) ends it with `type = CONNECTED_TCP`; "would block" or "already in progress" (`WSAEWOULDBLOCK`, `WSAEALREADY`) sleeps 500 ms (`Sleep(500)` with no message processing, so the simulator freezes) and counts down from 5000 ms; any other error returns `(error << 16) + 1` at once. When the 5000 ms run out the task still returns 0 with the connection pending; later sends retry it.
- Winsock detail that decides what really happens [Windows Sockets documentation, UNVERIFIED on the binary]: `SIM68K.exe` links `wsock32.dll` and asks for Winsock 1.1, and for such programs a second `connect` on a socket whose first attempt is still pending is reported as `WSAEINVAL` (10022), not `WSAEALREADY`. If so, a TCP connection that has not completed within the first 500 ms makes task 100 return `$27260001` after about half a second, and the 5-second wait never happens. The same applies to the connect retry inside tasks 102 and 106. PORT: with real sockets, decide which of the two behaviours to reproduce and test it against the original (section 15, V14).
- UDP: returns immediately. The socket is not bound, so receives return nothing until the client has sent once.
- The string `255.255.255.255` is not accepted as a dotted address (`inet_addr` returns the same value for it as for an error), so it goes through the host-name path.
- Blocks: for TCP as described, plus name lookup time (the client also looks up its own host name, result unused). The help's "all of the network trap tasks return immediately" is wrong for these cases.

**Task 101 - create server** [SRC CODE9.CPP:1256-1258; simIOu.cpp:2389-2396; Net.cpp:120-141]
- Input: `D1.L` as task 100 (no address). Output: `D0.L`.
- `netInit`, bind to all local addresses on the port; failure returns `(error << 16) + 5`; success sets `bound = true`, `mode = SERVER`.
- TCP: listening and accepting happen lazily inside receive. Exactly one client is ever accepted; the listening socket is then closed and replaced by the connection.

**Task 102 - send (deprecated)** [SRC CODE9.CPP:1259-1261; simIOu.cpp:2400-2408; Net.cpp:234-273]
- Inputs: `D1.L` bits 0-15 = byte count (bits 16-31 ignored); `A1` = data; `A2` = destination IP string, read **only when `mode == SERVER`**.
- Outputs: `D0.L` = result; if the result is 0, `D1.L` = bytes sent (may be 0); on error D1 is unchanged.
- Server: destination address = (A2), destination port = whatever is in `remote`: the creation port, or the source port of the last datagram received.
- Client with TCP not yet connected: tries to connect; if still in progress returns 0 with `D1.L = 0`.
- Any send error, including "would block", returns `(error << 16) + 1`. Not initialised: `$276D0001`. A TCP server that sends before a client has been accepted is sending on the listening socket; Winsock reports "not connected", expected `$27490001` [Winsock, UNVERIFIED].
- The send is one `sendto` call with the `remote` address, for TCP as well as UDP; a partial TCP send is reported through the byte count.
- A successful send sets `bound = true`.

**Task 103 - receive (deprecated)** [SRC CODE9.CPP:1262-1264; simIOu.cpp:2412-2420; Net.cpp:345-400]
- Inputs: `D1.L` bits 0-15 = buffer size; `A1` = buffer; `A2` = 16-byte buffer for the sender's IP.
- Outputs: `D0.L` = result; if 0, `D1.L` = bytes received (0 = nothing waiting). If bytes were received, the sender's dotted address is written to (A2) with `strncpy(..., 16)` (16 bytes, zero padded). With 0 bytes (A2) is untouched.
- `bound == false`: returns 0 and 0 bytes at once.
- TCP server not yet connected: `listen`, then a non-blocking `accept`; no client yet returns 0 and 0 bytes.
- "Would block" is reported as 0 bytes, result 0. Other errors return `(error << 16) + 1`; a datagram larger than the buffer gives `$27380001` (the first part of the datagram is already in the buffer; D1 and (A2) are unchanged). A TCP peer that closed gives `$27750001`.
- The receive is one `recvfrom` call into `remote`. For UDP that records the sender's address and port. For TCP, Winsock does not fill in the address, so the string written to (A2) is whatever `remote` already held: the server address for a client, and for a server the address given to its last send or `0.0.0.0` [Winsock, UNVERIFIED].
- Data is copied straight into 68000 memory with no bounds or memory-map check.

**Task 104 - close** [SRC CODE9.CPP:1265-1267; simIOu.cpp:2454-2457; Net.cpp:478-499]
- Input: none used. The help's "D1.L IP address of connection to close" is ignored by the source.
- Output: `D0.L` = result of `netCloseSockets()`: closes the socket, frees buffers, `WSACleanup`. Closing when nothing was opened returns an error (expected `$276D0001`, UNVERIFIED). `bound` and `mode` are left as they were.

**Task 105 - get local IP** [SRC CODE9.CPP:1268-1270; simIOu.cpp:2461-2464; Net.cpp:503-522]
- Output: `D0.L` = result; on success the first address of the local host is written to (A2) as a dotted string with a terminator (at most 16 bytes).
- Needs Winsock started, i.e. after task 100 or 101; otherwise an error (expected `$276D0001`, UNVERIFIED).

**Task 106 - send on port** [SRC CODE9.CPP:1271-1273; simIOu.cpp:2424-2434; Net.cpp:290-330]
- Inputs: `D1.L` bits 0-15 = byte count, bits 16-31 = port; `A1` = data; `A2` = destination IP (server only).
- Outputs: `D0.L` = result; on 0, `D1.L` = bytes sent (**the port in the high word is cleared**; the help's wording for the post-condition is copied from the receive task).
- As task 102, except that in server mode the destination port is set with `remote.sin_port = port;` **without `htons`** [SRC Net.cpp:298]. On a little-endian host the datagram goes to the byte-swapped port: 2048 (`$0800`) is sent to port 8. In client mode the port argument is ignored.

**Task 107 - receive data and port** [SRC CODE9.CPP:1274-1276; simIOu.cpp:2438-2450; Net.cpp:417-473]
- Inputs as task 103.
- Outputs: `D0.L` = result; on 0, `D1.L` = `(port << 16) | bytes received`; (A2) = sender IP when bytes were received.
- The port is `remote.sin_port` **without `ntohs`** [SRC Net.cpp:468], i.e. the sender's port byte-swapped. The two missing conversions cancel: a server that answers with task 106 using the value from task 107 reaches the right port.
- When no bytes were received the port variable is an uninitialised local (`unsigned short portNum;`, simIOu.cpp:2441), so the high word of D1 is garbage. PORT: return 0 there.

### 12.3 Other quirks

- Because `bound` is never cleared, a client created after an earlier session that had sent or served will attempt to receive on an unbound socket and get an error instead of "0 bytes". Derived from the source; Winsock documents "invalid argument" for `recvfrom` on an unbound socket, so the expected value is `$27260001` (UNVERIFIED).
- An unsupported protocol number leaves Winsock started without a matching clean-up (`netInit` returns before `netInitialized` is set) [SRC Net.cpp:46-74]. After that, calls that would otherwise report "not initialised" reach Winsock and fail with other codes.
- Receives overwrite `remote`, so a UDP client that receives a datagram from a third party sends its next datagram to that party.
- `initSim()` calls `netCloseSockets()` at every reset.

### 12.4 What a browser-based port can and cannot do

A web page cannot open UDP sockets, cannot open raw TCP connections, cannot listen for connections, cannot resolve host names and cannot learn the machine's LAN address. None of tasks 100-107 can therefore work with real peers from a pure web build.

Options, in increasing cost:

1. **Report "no network" faithfully.** Tasks 100/101 return `D0.L = $276B0002` (`NET_INIT_FAILED` with the Winsock "system not ready" code, which the help lists as "Network cannot initialize, system unavailable"). Tasks 102/106 return `$276D0001`. Tasks 103/107 return 0 with 0 bytes. Tasks 104/105 return `$276D0001`. These follow the original's own failure paths (start-up failure for 100/101, "not initialised" for the others; the exact Winsock values are UNVERIFIED), so programs that check D0 behave sensibly.
2. **Local loopback between simulator instances** (two tabs or windows on one machine) through `BroadcastChannel`, emulating UDP datagrams and a single TCP stream keyed by port. Enough for the classic two-simulator demos on `127.0.0.1`. Not interoperable with real EASy68K.
3. **Native sockets in the macOS .app.** The app shell can provide real BSD sockets with the same semantics (non-blocking, one socket, same return codes mapped from errno to the Winsock numbers above). The core calls are synchronous, so the bridge must be synchronous from the core's point of view (worker thread with a blocking wait on shared memory, or host functions imported into the WebAssembly instance). Note the byte-swapped port quirk of tasks 106/107 must be reproduced deliberately on Apple Silicon and Intel (both little-endian).

The 5-second blocking connect and blocking name lookup should become asynchronous waits that keep the UI alive but do not let the 68000 program advance.

## 13. Where the help (or the source comments) and the code disagree

The code wins in every case.

| # | Topic | Help / comment says | Code does |
|---|---|---|---|
| 1 | Task 82 and drawing mode | "The drawing mode is not used" (graphics.htm:45; CODE9.CPP:568) | the pixel goes through the pen mode (5.4) [BIN + GDI] |
| 2 | Task 92 register | `D1.W` in the source header (CODE9.CPP:589), `D1.B` in the help | `D1.B` (simIOu.cpp:2026) |
| 3 | Task 94 | "Requires drawing mode 17" (graphics.htm:161) | works in both modes |
| 4 | Task 95 control characters | "ignored" | passed to GDI unfiltered; on Windows 11 tab, CR, LF and `$1C`-`$1F` then draw nothing, the others draw a small box, and all of them still count in the pen movement (6.7) |
| 5 | Resolution | "640 x 480" (CODE9.CPP:560) | any size from 640x480 up via task 33 |
| 6 | Task 61 "mouse up state" | implies the released button | reports buttons still held after the release; normally 0 (8.1) |
| 7 | Task 60 description | "when a mouse button is pressed or released" | also move events (bit 2) |
| 8 | Task 70 missing file | "Invalid file names are ignored" | true, and D0 is left unchanged, which reads as success |
| 9 | Task 72 empty slot | not mentioned | D0 unchanged |
| 10 | Task 71 result | not mentioned | no register written |
| 11 | Task 76 command 1 | "returns error if sound currently playing" | true for any standard-player sound, not only the same one |
| 12 | Task 77 command 3 | "(D1.B ignored)" | only works if `D1.B` names a loaded slot |
| 13 | Task 77 looping | not mentioned | looping is sticky for the slot (11.4) |
| 14 | Tasks 73/74 formats | WAV | also MIDI/segment files via DirectMusic |
| 15 | Network blocking | "all of the network trap tasks return immediately" | task 100 with TCP sleeps in 500 ms steps, up to 5 s as written; name lookup blocks |
| 22 | Task 92 modes above 17 | not mentioned | not rejected: stored as the pen mode and, in the shipped binary, drawn as one of the 16 modes, mostly "always white" (5.4) |
| 23 | Tasks 75 and 77 result 0 | "DirectX player not available" | also returned for an empty slot (and by task 77 for an unknown command) |
| 24 | Task 61 selector | 0, 1, 2 | any other `D1.B` clears `D0.L` and leaves D1 unchanged |
| 16 | Task 100 (A2) result | IP written to (A2) | only after a host-name lookup |
| 17 | Task 104 input | `D1.L` = IP to close | ignored |
| 18 | Task 106 post-condition | `D1.L` "bytes received", high word reserved | bytes sent, high word 0 |
| 19 | Tasks 106/107 port | port number | byte-swapped on the wire / on return |
| 20 | Network error codes 4, 6, 7 | listed | never returned |
| 21 | Source header | tasks 100-105, UDP only | 100-107, UDP and TCP |

## 14. Hazards for the port

- **H1. Canvas 2D is anti-aliased.** `lineTo`, `rect`, `ellipse`, `fillText` blend edge pixels. Task 83 and flood fill depend on exact colours. All primitives must be rasterised into a pixel buffer (`ImageData` or a WebAssembly-side framebuffer) using the rules of section 6.
- **H2. Raster operations.** Canvas compositing has no AND/OR/NOT/XNOR. Implement the 16 operations per pixel.
- **H3. GDI ellipses are flattened Beziers**, not ideal ellipses (6.4). Task 88 is the fourth most used graphics task in the collected examples. Pixel parity needs dedicated work and a captured reference set.
- **H4. Wide pens.** Round caps, square rectangle corners, `c-a..c+b` placement, far-end omission on one-pixel rectangles, and the end-point hole in XOR modes (6.2, 6.3).
- **H5. Text background and pen movement.** Text draws an opaque box in the fill colour and moves the graphics pen. Easy to miss because neither is in the help. Task 95 strings that end in CR, LF (a common habit) must not draw boxes for those bytes (6.7).
- **H6. Standard-player busy flag.** Programs spin on `D0.W = 0`. The flag must clear by elapsed time even when audio is muted, suspended by autoplay policy, or failed to decode.
- **H7. Asynchronous audio loading** versus synchronous tasks 71/74 (11.6).
- **H8. D0 left unchanged** by tasks 70 and 72 on missing file/empty slot. A shim that always writes a result breaks programs that test D0.
- **H9. Task 83 returns `$FFFFFFFF` off-surface**, not 0.
- **H10. Signed 16-bit coordinates** and the ellipse `< 32768` rule.
- **H11. Two pen positions** and task 96 returning the window one (5.5).
- **H12. Resize blacks the screen every time**, even with unchanged size, and keeps colours, modes and the text cursor (4.3). Browser canvases also clear on resize but reset more state; keep state outside the canvas.
- **H13. Mouse semantics.** Button bits only change on down/up events; the up snapshot is "still held"; Double is transient (8.1). Coordinates must be surface pixels under CSS scaling.
- **H14. Interrupts need exceptions enabled**, add 44 cycles each, merge per level, and stop after the program halts through task 9 or SIMHALT (or, with exceptions off, STOP or a bus/address error); after other kinds of halt an armed event restarts the program (section 10).
- **H15. Key codes** are Windows virtual-key codes, with auto-repeat generating interrupts.
- **H16. Fonts.** Fixedsys does not exist on macOS. Pixel-identical text needs an embedded 8x15 bitmap font in Windows-1252 order. The misspelt font 5 and font 7 fall back to a proportional font on Windows.
- **H17. File names** are Windows paths, case-insensitive, relative to the program's folder.
- **H18. Full screen needs a user gesture** in browsers and cannot change the display mode.
- **H19. Network** is unavailable in a browser; see 12.4. Remember the byte-swapped port.
- **H20. Unbounded surface size** from task 33; clamp.
- **H21. State survives program end**: sounds keep playing and loops keep looping until reset; the pen position survives even a reset.

## 15. Items that rest on something other than the EASy68K source

Nothing in this document was observed on a running `SIM68K.exe`. Each item below can be checked on the official binary with a short 68000 program that writes register values to a file with the file tasks (see `ground-truth.md` section 4 for running the official binary unattended).

Established from the binary's code plus GDI measurement; a run would only confirm them:

| # | Claim | Basis | Test |
|---|---|---|---|
| V1 | Text background is the fill colour | BIN (`CreateBrush`, `TextOut`) + GDI | task 81 red; task 95 "A" at (10,10); task 83 at (10,10) should be red |
| V2 | `TextOut` moves the pen to the end of the text | BIN (`TextOut`) | task 86 (0,0); task 95 "AB" at (50,60); task 96 should give (66,60) with the default font |
| V3 | Task 82 obeys the drawing mode (the help says it does not) | BIN (`SetPixel` realises the pen) + GDI | white filled rectangle; mode 14; pen white; task 82 inside; task 83 there should be 0 |
| V5 | Task 96 lags in double-buffer mode | source | mode 17; task 86 (5,5); task 84 to (100,100); task 96 should give (5,5) |
| V7 | Pen position survives Rewind | source + BIN (`SetHandle` keeps the position) | draw, rewind, run a program that starts with task 96 |
| V8 | Modes 18-255 behave as in the table of 5.4 | BIN (table index without range check, data after the table) + GDI. A few of the words read are addresses or variables rather than constants, so single entries could differ at run time | set mode 20 and mode 22, draw in red on black, read back: expect white, then the inverse of the pen colour |
| V9 | System-colour (bit 31) and palette-index (bit 24) colours | BIN (`ColorToRGB`) + GDI; the system colours themselves follow the user's Windows theme | pen `$80000005`, draw pixel, read back |

Open:

| # | Claim | Basis | Test |
|---|---|---|---|
| V4 | Flood fill versus non-Copy modes | BIN (`FloodFill` does not realise the pen) + VCL device-context caching | mode 14, draw a line, flood fill at once, read back; repeat with a task 23 delay before the fill |
| V6 | DirectX looping is sticky, and whether the loader cache shares segments between slots, task 73 and reloads (11.4) | DirectMusic API | task 74; task 77 loop; task 77 stop; task 75; listen whether it repeats. Then reload the same file with task 74 and play once; load one file into two slots and stop one |
| V10 | Tab key never reaching `OnKeyDown`; mouse capture for the left button only | VCL | arm key-down IRQ, press Tab; arm mouse-up IRQ, drag out of the window with the right button and release |
| V11 | Exact pixels of diagonal wide lines and wide-pen ellipses | GDI internals | capture with the GDI harness |
| V12 | Exact GDI ellipse flattening | GDI internals | capture with the GDI harness; refine the model of 6.4 |
| V13 | Control characters in task 95 (6.7) on other Windows versions and with other fonts | measured on Windows 11 with Fixedsys only | task 95 with bytes 1-31 between two letters, screenshot |
| V14 | `PlaySound` result for a non-WAVE file; behaviour of over-large surface requests; Winsock results: repeated `connect` on a pending TCP connection (12.2, task 100), calls made before initialisation, receive on an unbound socket, send on a listening socket; DirectMusic search directory versus current directory | platform | direct tests |

The GDI measurements in this document can be regenerated on any Windows machine without EASy68K: create a memory device context with a 32-bit DIB section, select a pen made with `CreatePenIndirect` (style `PS_SOLID`, width, colour) and `CreateSolidBrush(colour)`, call the GDI function with the arguments given in section 6, and read the pixels back. The same harness can produce the reference images for a conformance suite.

The [BIN] readings can be regenerated without running the program: parse the import table of `SIM68K.exe`, find the `jmp` thunk of the GDI function (for example `SetPixel`), find the `call` instructions that target the thunk, and read the surrounding bytes; the state-set constant sits just after each `TCanvas` method.

## 16. Completeness check

**`case` labels 60 and above in `TRAP()`** [CODE9.CPP:1066-1276]: 60 (8.2), 61 (8.3), 62 (9.2), 70-77 (11.3, 11.4), 80-96 (7), 100-107 (12.2), `default` (1). All covered.

**`TsimIO` methods used by these tasks** [simIOu.h:72-124]: `playSound`, `loadSound`, `playSoundMem`, `controlSound`, `playSoundDX`, `loadSoundDX`, `playSoundMemDX`, `stopSoundMemDX`, `controlSoundDX` (11); `InitDirectXAudio`, `LoadSegment`, `PlaySegment`, `PlaySegmentLoop`, `StopSegment`, `CloseDown`, `ResetSounds` (11.1, 11.4, 11.5); `drawPixel`, `getPixel`, `line`, `lineTo`, `moveTo`, `getXY`, `setLineColor`, `setFillColor`, `rectangle`, `ellipse`, `floodFill`, `unfilledRectangle`, `unfilledEllipse`, `setDrawingMode`, `setPenWidth`, `drawText` (5, 6, 7); `FormPaint`, `setWindowSize`, `getWindowSize`, `setupWindow` (4, 5.6); `FormMouseDown`, `FormMouseUp`, `FormMouseMove` (8.1); `FormKeyDown`, `FormKeyUp`, `clearKeys`, `FormActivate` (9.1); `createNetClient`, `createNetServer`, `sendNet`, `receiveNet`, `sendPortNet`, `receivePortNet`, `closeNetConnection`, `getLocalIP` (12.2); constructor and destructor (4.2, 11.1). Methods belonging to the text, file-dialog and serial tasks (`charOut`, `textOut`, `textOutCR`, `textIn`, `charIn`, `FormKeyPress`, `promptTimer`, `erasePrompt`, `gotorc`, `getrc`, `getCharAt`, `scroll`, `scrollRect`, `clear`, `doCRLF`, `setFontProperties`, `setTextSize`, `setTextWrap`, `getKeyState`, `displayFileDialog`, `BringToFront`, `FormResize` (empty), the `...Comm` functions) are specified in `trap15-tasks-0-59.md` and referenced here only where they touch the surface or the pen position (5.5, 5.6, 6.8). Which of these methods catch host exceptions is listed in section 1, rule 7.

**`Net.cpp` functions**: `netInit`, `netCreateServer`, `netCreateClient`, `netSendData` (two overloads), `netReadData` (two overloads), `netCloseSockets`, `netLocalIP`. All in section 12.

**Globals**: every variable in the table of 3.1, plus `Net.cpp`'s `dwLength`, `wsd`, `recvbuf`, `sendbuf`, `ret`, `remoteAddrSize`, `port` (buffers are allocated and never used; `port` is shadowed by parameters).

**Menu items and dialogs** (identifier, caption): `OutputWindow1` View > `&Output Window` (4.4); `mmuFullscreenOptions` Options > `&Fullscreen Options...` and its dialog `frmFullscreenOptions` with `txtScreenNumber`, `Label1`, `cmdOk`, `cmdCancel` (4.4); `OutputWindowSize1` Options > `Output Window &Size` with the nine radio items `Size640x480`, `Size800x600`, `Size1024x768`, `Size1280x800`, `Size1280x1024`, `Size1440x900`, `Size1680x1050`, `Size1920x1080`, `Size1920x1200` (4.3); `OutputWindowTextWrap1` Options > `Output Window Text &Wrap` and the Output Window Font dialog `FontDialogSimIO` belong to the text specification. Command-line `/f` (4.4). Keyboard Alt+Enter (4.4).

**Help pages read**: `graphics.htm` (tasks 80-96 and the colour table), `sound.htm` (70-77), `peripheralio.htm` (60-62), `networkio.htm` (100-107 and the extended error list), `simio.htm` (task 33), `keyCodes.htm`, `SIMHELP\SimOptions.htm`, `SIMHELP\BasicOperation.htm` (command-line switches), `SIMHELP\Hardware.htm`, `SIMHELP\Exceptions.htm`.
