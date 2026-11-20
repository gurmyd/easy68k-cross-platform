# Sim68K v5.16.1 - Hardware window, memory-mapped devices, interrupts and memory map

Behaviour specification for the macOS/web port. Scope: the form `THardware` ("EASy68K Hardware"), every simulator hook that calls into it, the interrupt path, and the ROM / Read / Protected / Invalid memory map.

## 0. Conventions

Path abbreviations used in citations:

| Prefix | Meaning |
|---|---|
| (none) | `c:\easy64k\reference\src-sim68k\Sim68Kv5.16.1\` - e.g. `hardwareu.cpp:757` |
| `EDIT\` | `c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\` |
| `HELP\` | `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\` |
| `CLI\` | `c:\easy64k\reference\easy68k-asm-cli\ASM68Kv5.15.4\` |

`hardwareu.dfm:N` is a line number in the original 4955-line text DFM (bitmap blobs included in the count).

Tags:

- **(VCL)** - the claim depends on behaviour of the Borland VCL or of Win32 that is not present in the reference tree. Each such claim is repeated in section 12 with its verification status.
- **UNVERIFIED** - could not be determined from the reference material.
- **QUIRK** - behaviour that differs from a real 68000 or from the help text, and that the port must nevertheless reproduce.

Terminology: "IRQ n" means interrupt priority level n (1-7). "The core" means the C simulator in `RUN.CPP`, `UTILS.CPP`, `CODE*.CPP`. "The form" means `THardware`.

Important structural fact for the architect: `hardwareu.cpp` is a VCL form unit. It cannot be compiled by Emscripten. Everything in it (including `IRQprocess`, `ResetBtnClick`, `setAutoIRQ`, `enable`, `disable`, `updateIfNeeded`) is behaviour that the port has to re-implement, and the compiled core calls into it by name. Section 1.3 lists the complete call surface.

---

## 1. Architecture of the original

### 1.1 Where state lives

There are no device objects. All four devices are plain bytes in the simulator's 16 MB memory array, and the form reads or pokes those bytes directly.

- `char *memory` (`var.h:30`), allocated as `new char[MEMSIZE]` with `MEMSIZE = 0x01000000` (`SIM68Ku.cpp:153`, `def.h:56`). Every byte is initialised to `0xFF` at program start (`SIM68Ku.cpp:154-155`) and again on every file open (`SIM68Ku.cpp:277-278`). The element type is plain `char` (signed in Borland C++).
- Device addresses are four global `int`s in `hardwareu.cpp:28`: `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc`. They are zero until `LoadSettings()` writes the address edit boxes (section 2.1).
- Memory-map state is twelve globals in `hardwareu.cpp:32-34`:
  ```cpp
  int ROMStart=0, ROMEnd=0, ReadStart=0, ReadEnd=0;
  int ProtectedStart=0, ProtectedEnd=0, InvalidStart=0, InvalidEnd=0;
  bool ROMMap=false, ReadMap=false, ProtectedMap=false, InvalidMap=false;
  ```
- Interrupt state is in `var.h:135-136`: `bool hardReset; int irq;` plus `bool stopInstruction` (`var.h:62`). The status register is `short SR` (signed 16 bits, `var.h:45`) and the option flag is `int exceptions` (`var.h:59`).
- Three more file-scope globals in `hardwareu.cpp:29-31` (ordinary globals, not class members, but referenced nowhere outside that file): `bool pbInit; bool autoIRQ; bool hardwareEnabled;`. `FormCreate` sets `pbInit = false; autoIRQ = false; hardwareEnabled = true;` (`hardwareu.cpp:1318-1323`).
- `AnsiString str1` (`hardwareu.cpp:27`) is a scratch string for building `"0x"+text`.
- `static const SWITCH_ADDR = 0xE0000A;` (`hardwareu.cpp:25`) is never used. It also has no type specifier (implicit `int`), which is a compile error in standard C++.
- `static const TColor clDrkMaroon = 0x02000040;` (`hardwareu.cpp:24`) is the "off" colour of LEDs and segments. As a `TColor` the high byte `0x02` selects palette-relative RGB and the low 24 bits are `0x00BBGGRR`, so the colour is R=0x40, G=0, B=0, i.e. `#400000`. "On" is `clRed` = `#FF0000`.

### 1.2 Form creation and visibility

- The form is auto-created at startup, ninth in order, after `Form1`, `StackFrm`, `MemoryFrm`, `BreaksFrm`, `AboutFrm`, `Log`, `simIO`, `AutoTraceOptions` (`SIM68K.cpp:96-104`).
- It has no `Visible` property in the DFM, so it starts hidden. It is shown by: the main-window menu item View > `&Hardware` (`SIM68Ku.dfm:1290-1293`, handler `TForm1::Hardware1Click` -> `Hardware->Show()`, `SIM68Ku.cpp:1359-1362`); by `LoadSettings()` when the saved `$hardware visible` flag is `1` (`SIM68Ku.cpp:1893-1897`); and by TRAP #15 task 32 with D1.B = 0 (`CODE9.CPP:909-911`).
- It is a non-modal, fixed-size window whose title bar has only a close box (no minimise or maximise): `BorderIcons = [biSystemMenu]`, `BorderStyle = bsSingle`, `Caption = 'EASy68K Hardware'`, `ClientHeight = 495`, `ClientWidth = 422`, `KeyPreview = True`, `Scaled = False` (`hardwareu.dfm:4-8,41,43`). Closing it only hides it.
- Hiding the form does not stop anything: devices, timers, interrupts and the memory map keep working. The only thing gated on visibility is the repaint routine `update()` (section 2.7).

### 1.3 Complete call surface between the rest of the simulator and the form

Everything outside `hardwareu.cpp` that touches the form or its globals:

| Caller (file:line) | What it uses | Purpose |
|---|---|---|
| `UTILS.CPP:26-29` | externs `ROMStart..InvalidEnd`, `ROMMap..InvalidMap`, `seg7loc, LEDloc, switchLoc, pbLoc` | memory-map and hardware-address checks in `memoryMapCheck`, `mem_req` |
| `UTILS.CPP:396` | `Hardware->updateIfNeeded(loc)` | after every successful `mem_put` |
| `Memory1.cpp:464` | `Hardware->updateIfNeeded(addr)` | after a keystroke edit in the Memory window |
| `RUN.CPP:699-700` | `Hardware->autoIRQoff()` | when a `runprog()` step ends in trace or halt and `stopInstruction` is false |
| `RUN.CPP:878-880` | `irq`, `irqHandler()` | interrupt recognition after each instruction |
| `RUN.CPP:957` | `Hardware->disable()` | STOP executed while exceptions are disabled |
| `RUN.CPP:1126` | `Hardware->disable()` | `haltSimulator()` (bus/address error with exceptions disabled) |
| `CODE9.CPP:787` | `Hardware->disable()` | TRAP #15 task 9 (terminate) |
| `CODE9.CPP:906-936` | `Hardware->Show()`, `seg7addr/LEDaddr/switchAddr/pbAddr->EditText`, `Hardware->setAutoIRQ()` | TRAP #15 task 32 |
| `CODE9.CPP:1317` | `Hardware->disable()` | SIMHALT (`$FFFF $FFFF`) |
| `STARTSIM.CPP:79-84` | `irq = 0; Hardware->autoIRQoff(); hardReset = false; ... Hardware->enable();` | `initSim()` |
| `SIM68Ku.cpp:281-284` | `Hardware->switchAddr->EditText`, `Hardware->initialize()` | `OpenFile()` |
| `SIM68Ku.cpp:453` | `Hardware->autoIRQon()` | Run / Run To Cursor |
| `SIM68Ku.cpp:538` | `Hardware->autoIRQoff()` | Pause |
| `SIM68Ku.cpp:1361` | `Hardware->Show()` | View > Hardware |
| `SIM68Ku.cpp:1461-1467` | `Top`, `Left`, four `EditText`s, `Visible` | `SaveSettings()` |
| `SIM68Ku.cpp:1516-1521` | `Top`, `Left`, four `Text`s | `defaultSettings()` |
| `SIM68Ku.cpp:1809-1897` | same, plus `Show()` | `LoadSettings()` |
| `SIMOPS2.CPP:262-278` | `ROMChk/ReadChk/ProtectedChk/InvalidChk->Checked`, eight `...Edit->EditText` | S0 memory-map records in `loadSrec()` |
| `Stack1.cpp:23-24,101` | `InvalidMap`, `InvalidStart`, `InvalidEnd` | Stack window draws Invalid bytes in red |
| `Stack1.cpp:173,182` | `Hardware->BringToFront()` | Ctrl+Tab window cycling |
| `simIOu.cpp:425-426, 458-459, 694-695, 760-761, 787-788` | `Hardware->IRQprocess(n)` | keyboard / mouse IRQs armed by TRAP #15 tasks 62 / 60 |
| `simIOu.cpp:1366-1368` | `Hardware->enable()` | keyboard input finished while `trace` is true |

`SIMOPS2.CPP:21` also declares `extern int ... ReadOnlyStart, ReadOnlyEnd;`. Those symbols do not exist anywhere and are never referenced; a strict linker will not complain because they are unused, but do not rely on them.

---

## 2. Devices

### 2.1 Common rules

**Default addresses** (set by `defaultSettings()`, `SIM68Ku.cpp:1518-1521`):

| Device | Edit control | Default text | Global | Bytes owned |
|---|---|---|---|---|
| 7-segment display | `seg7addr` | `E00000` | `seg7loc` | 16 bytes `seg7loc .. seg7loc+15` (8 are displayed, see 2.2) |
| LEDs | `LEDaddr` | `E00010` | `LEDloc` | 1 byte |
| Toggle switches | `switchAddr` | `E00012` | `switchLoc` | 1 byte |
| Push buttons | `pbAddr` | `E00014` | `pbLoc` | 1 byte |

Bytes `E00011` and `E00013` are ordinary RAM in the default layout.

**Persistence.** The four addresses, the form position and its visibility are saved in `sim68K.dat` next to the executable, as lines tagged `$hardware top`, `$hardware left`, `$7-segment address`, `$LED address`, `$switch address`, `$button address`, `$hardware visible` (`SIM68Ku.cpp:1461-1467`), and restored by `LoadSettings()` (`SIM68Ku.cpp:1809-1897`). Position defaults are `HARDWARE_FORM_TOP = 100`, `HARDWARE_FORM_LEFT = 240` (`def.h:261-262`); a saved top greater than `Screen->Height - 20` or left greater than `Screen->Width - 20` falls back to the default (`SIM68Ku.cpp:1820-1823, 1835-1838`). The memory map, the auto-IRQ checkboxes and the auto-IRQ intervals are **not** persisted.

**How the user changes an address.** Each address is a 6-character masked edit box with `EditMask = 'aaaaaa;0;0'` and `MaxLength = 6` (`hardwareu.dfm:1788,1795` for `seg7addr`; identical for `LEDaddr`, `switchAddr`, `pbAddr` and the eight memory-map edits). To the left of each sits a read-only, silver, non-tab-stop box containing the literal text `00` (`MaskEdit9..MaskEdit12`, `hardwareu.dfm:4801-4912`); it is decoration showing the unused upper byte of a 32-bit address. In the DFM these `00` boxes are also wired to `seg7addrChange`, `addrKeyPress` and `addrKeyUp` (for example `hardwareu.dfm:4825-4827`); because they are read-only their text never changes, so `seg7addrChange` never fires from them. Do not carry that wiring over.

- `OnKeyPress = addrKeyPress` (`hardwareu.cpp:549-558`) accepts only `0-9`, `A-F`, `a-f`, converts to upper case, and for any other character calls `Beep()` and swallows the key:
  ```cpp
  if ( (Key >= '0' && Key <= '9') || (toupper(Key) >= 'A' && toupper(Key) <= 'F') )
    Key = toupper(Key);
  else { Beep(); Key = 0; }
  ```
- The value is read as `StrToInt("0x" + <edit>->EditText)`. **(VCL)** The third field of the mask (`;0`) makes `'0'` the blank character, so `EditText` always contains exactly six characters with unfilled positions shown as `0`. The field therefore behaves as a fixed-width, six-hex-digit, overwrite-style field, and a partly filled field is padded with zeros **on the right** (typing `E0` into an empty field yields `E00000`). The help screenshot `HELP\SIMHELP\IMAGES\Hardware\hardware.png` shows this rendering (`00` + `E00000`).
- Because the field has six hex digits, the largest address is `0xFFFFFF`, which is less than `MEMSIZE`. The many `>= MEMSIZE` guards in `hardwareu.cpp` (for example `hardwareu.cpp:595, 646, 688, 696, 704`) are therefore unreachable in practice. The one reachable limit is `seg7loc >= MEMSIZE-8` (section 2.2).
- Changes take effect on every change of the text (the `OnChange` handlers), not on a commit key. Extra side effects on Enter / focus loss exist for the switch and push-button fields only (sections 2.4, 2.5).

**Memory-map immunity.** A CPU access whose *starting* address is a hardware address is never subject to the memory map. The test is the same in `memoryMapCheck` (`UTILS.CPP:251-253`) and `mem_req` (`UTILS.CPP:448-449`):
```cpp
if(( (loc >= seg7loc && loc <= seg7loc+15) ||
       loc == LEDloc || loc == switchLoc || loc == pbLoc) )
  return SUCCESS;
```
Only `loc` is tested, not `loc+bytes-1`. A word or long access that starts below a device address and runs into it is checked against the map normally; a long write that starts *at* `LEDloc` bypasses the map for all four of its bytes.

**What a 68000 read returns.** There is no device read hook. `mem_req` simply returns `memory[loc]` (big-endian assembly for word/long, `UTILS.CPP:484-494`). A word or long read at a one-byte device returns the device byte in the most significant position followed by whatever ordinary memory bytes come next (normally `0xFF` after a load). Devices get no exemption from the odd-address rule: a word or long access at an odd device address is an address error before the hardware test is reached (`UTILS.CPP:352, 427`).

**What a 68000 write does.** There is no device write hook either. `mem_put` stores the bytes and then calls `Hardware->updateIfNeeded(loc)` (`UTILS.CPP:379-396`). Writes to the switch byte and the push-button byte are accepted and stored like any RAM write.

### 2.2 Seven-segment display

- Eight digits, shape names `seg7?` (leftmost) to `seg0?` (rightmost), each with eight `TShape` rectangles `a b c d e f g h` (`hardwareu.dfm:1329-1776`, declarations `hardwareu.h:46-115`).
- **Digit to address.** Digit `segN` shows the byte at `seg7loc + 2*(7-N)`: leftmost digit = `seg7loc+0`, then `+2, +4, +6, +8, +10, +12`, rightmost = `seg7loc+14` (`hardwareu.cpp:227, 262, 297, 332, 367, 402, 437, 472`). The odd bytes `seg7loc+1, +3, ... +15` are inside the hardware address range (map-immune, and they trigger a refresh) but are never displayed. Consequently a `MOVE.W` to a digit address must carry the pattern in its **high** byte; a `MOVE.B` to the even address is the natural form. This matches the help table "digit 1 = E00000 ... digit 8 = E0000E" (`HELP\SIMHELP\Hardware.htm:26-37`).
- **Bit to segment** (identical for all eight digits, `hardwareu.cpp:228-259`): a 1 bit lights the segment (`clRed`), a 0 bit turns it off (`clDrkMaroon`).

| Bit | Mask | Shape suffix | Segment | Geometry relative to digit origin x0 (x, y, w, h) |
|---|---|---|---|---|
| 0 | `0x01` | `a` | top horizontal | x0+4, 8, 20, 5 |
| 1 | `0x02` | `b` | upper right vertical | x0+24, 12, 5, 20 |
| 2 | `0x04` | `c` | lower right vertical | x0+24, 36, 5, 20 |
| 3 | `0x08` | `d` | bottom horizontal | x0+4, 56, 20, 5 |
| 4 | `0x10` | `e` | lower left vertical | x0+0, 36, 5, 20 |
| 5 | `0x20` | `f` | upper left vertical | x0+0, 12, 5, 20 |
| 6 | `0x40` | `g` | middle horizontal | x0+4, 32, 20, 5 |
| 7 | `0x80` | `h` | decimal point, bottom right of the digit | x0+32, 56, 5, 5 |

  Digit origins x0 inside the black panel `Panel2` (329 x 69, `Color = clBlack`, `hardwareu.dfm:1322-1327`): `seg7` = 8, `seg6` = 48, `seg5` = 88, `seg4` = 128, `seg3` = 168, `seg2` = 208, `seg1` = 248, `seg0` = 288 (pitch 40 px). Example: `0x3F` shows "0", `0x06` shows "1", `0x80` shows only the decimal point.
- **Validity limit.** The display is refreshed only `if (seg7loc < MEMSIZE-8)` (`hardwareu.cpp:224`); `MEMSIZE` is `const uint`, so the comparison is unsigned and the limit is `seg7loc <= 0xFFFFF7`. With `seg7loc` in `0xFFFFF8..0xFFFFFF` the digits simply keep their last colours. **Bug to be aware of:** for `seg7loc` in `0xFFFFF2..0xFFFFF7` the routine reads `memory[seg7loc+14]`, up to 6 bytes beyond the 16 MB array (`hardwareu.cpp:472`).
- State is stored only in simulator memory. The shapes are a mirror, refreshed as described in 2.7. All shapes have `Brush.Color = clRed` in the DFM, so before the first refresh every segment is drawn lit; that coincides with memory being `0xFF`.

### 2.3 LEDs

- Eight round `TShape`s `LED7` (leftmost) to `LED0` (rightmost) in the grey panel `Panel1` (329 x 33, `Color = clGray`), each 17 x 17, `Shape = stCircle`, `Pen.Color = clMaroon`, `Pen.Width = 2`, at `Left = 16 + 40*(7-n)`, `Top = 8` (`hardwareu.dfm:1234-1321`).
- One byte at `LEDloc`. Bit n drives `LEDn`; 1 = `clRed`, 0 = `clDrkMaroon` (`hardwareu.cpp:509-544`). Bit 7 is the leftmost LED.
- Refreshed only `if (LEDloc < MEMSIZE)` (always true in practice).
- State is stored only in simulator memory.
- The labels `7 6 5 4 3 2 1 0` (`Label8` .. `Label1`, `hardwareu.dfm:49-176`) sit between the LED row and the switch row and name the bit columns for LEDs, switches and push buttons alike.

### 2.4 Toggle switches

- Eight `TBitBtn`s `switch7` (leftmost, `Left = 16`) to `switch0` (rightmost, `Left = 296`), 29 x 45 px, hand cursor (`hardwareu.dfm:233-1233`). The glyph is a 54 x 44 bitmap holding two 27-px images side by side (the DFM blob, decoded, is byte-identical to `toggleswitch.bmp` in the source directory, so that file can be used as the asset): left half = rocker off with a dark-red indicator, right half = rocker on with a bright-red indicator. `Layout = blGlyphLeft` shows the left (off) half and `blGlyphRight` the right (on) half **(VCL)**. The design-time captions (`'switch7'`, `'BitBtn1'`) are clipped away and not visible.
- **The on/off state is the button's `Layout` property; the value is a bit in `memory[switchLoc]`.** Clicking switch n (`hardwareu.cpp:66-192`):
  ```cpp
  if(switchN->Layout == blGlyphLeft) {      // was off
    switchN->Layout = blGlyphRight;         // now on
    memory[switchLoc] |= (1 << n);
  } else {                                  // was on
    switchN->Layout = blGlyphLeft;
    memory[switchLoc] &= ~(1 << n);
  }
  update();  MemoryFrm->Repaint();  StackFrm->Repaint();
  ```
  The exact masks are `0x01/0xFE, 0x02/0xFD, 0x04/0xFB, 0x08/0xF7, 0x10/0xEF, 0x20/0xDF, 0x40/0xBF, 0x80/0x7F`. Only the one bit is modified; the other seven bits of the byte are left as they are.
- **QUIRK - control and memory can diverge.** The decision "turn on or turn off" is taken from the control, never from memory. If the 68000 program writes the switch byte, or anything in the list below zeroes it, the picture and the byte disagree until the user clicks. Clicking a switch that is drawn "on" always clears its bit, whatever the bit currently is.
- **Events that force the switch byte to `0x00`:**
  1. `OpenFile()` (Open, Reload, drag-and-drop, command-line file): `memory[StrToInt("0x" + switchAddr->EditText)] = 0x00;` after the `0xFF` fill and before the S-record is loaded (`SIM68Ku.cpp:277-282`), so S-record data at that address wins.
  2. `FormShow` - every time the form goes from hidden to shown: `update(); memory[switchLoc] = 0x00;` (`hardwareu.cpp:195-201`). This does **not** reset the `Layout` of the switches, so switches that were on stay drawn on while the byte is 0. It is triggered by View > Hardware when hidden, by `LoadSettings()` at startup, and by TRAP #15 task 32/0 when hidden.
  3. `switchAddrExit` (focus leaves the switch address box, changed or not) and `switchAddrKeyDown` with `VK_RETURN` (`hardwareu.cpp:617-638`): re-reads the address, `memory[switchLoc] = 0x00`, repaints Memory and Stack windows. Neither resets `Layout`; neither calls `update()`. **(VCL)** `OnExit` fires when focus moves to another focusable control of the same form (Tab, or a click on another edit, a switch, a push button or a checkbox); it does not fire for a click on an IRQ or Reset speed button (they cannot take focus) and is not expected to fire when another window is merely activated. Consequence: the first switch click after the address box had focus first zeroes the whole byte (exit) and then applies the click as usual.
- **Events that reset the pictures to off without touching memory:** `Hardware->initialize()` (called from `OpenFile`, `hardwareu.cpp:44-63`, `SIM68Ku.cpp:284`) and every change of the switch address text (`switchAddrChange`, `hardwareu.cpp:583-614`). `switchAddrChange` also sets `switchLoc`, and enables or disables the eight buttons depending on `switchLoc >= MEMSIZE` (unreachable). It does not clear the byte at the old address and does not write the byte at the new address.
- Not affected by: Run, Pause, Reset Program (`initSim`), the hardware Reset button, `enable()`/`disable()`.

### 2.5 Push buttons

- Eight `TBitBtn`s `pb7` (leftmost, `Left = 16`) to `pb0` (rightmost, `Left = 296`), 33 x 33 px, hand cursor, no caption (`hardwareu.dfm:3224-4167`). The glyph is a single 33 x 33 image of a grey raised square; the DFM blob, decoded, is byte-identical to `pushbutton3.bmp` in the source directory. There is no separate "pressed" image.
- Active-low, one byte at `pbLoc`: idle = `0xFF`; pressing button n clears bit n; releasing it sets bit n. Handlers (`hardwareu.cpp:994-1290`), for each n:
  ```cpp
  pbNMouseDown / pbNKeyDown:  memory[pbLoc] &= ~(1 << n);
  pbNMouseUp   / pbNKeyUp:    memory[pbLoc] |=  (1 << n);
  // each followed by: update(); MemoryFrm->Repaint(); StackFrm->Repaint();
  ```
  Masks: `0xFE/0x01, 0xFD/0x02, 0xFB/0x04, 0xF7/0x08, 0xEF/0x10, 0xDF/0x20, 0xBF/0x40, 0x7F/0x80`.
- The mouse handlers ignore the `Button` argument, so left, right and middle buttons all act. The key handlers ignore `Key`, so any key that reaches a focused push button (Space, Enter, letters, F1 ...) presses it while held and releases it on key-up. Auto-repeat key-downs are harmless (idempotent).
- The control has no latched state. State is stored only in simulator memory, and only as individual bit edits: if the program writes `0x00` to the byte, the bits stay 0 until the corresponding button is pressed and released (the release sets the bit).
- **Initialisation of the byte to `0xFF`:**
  1. The first time ever that `pbAddrChange` runs with a valid address (`pbInit` false -> `memory[pbLoc] = 0xFF; pbInit = true;`, `hardwareu.cpp:664-669`). This happens during `LoadSettings()` at startup.
  2. `pbAddrExit` (focus leaves the address box; same **(VCL)** focus rules as for the switch address box, 2.4) and `pbAddrKeyDown` with `VK_RETURN`: `memory[pbLoc] = 0xFF; update();` plus Memory/Stack repaint (`hardwareu.cpp:1293-1314`). Unlike the switch handlers these do not re-read the address text; they use the `pbLoc` set by the last change event.
  3. Implicitly by the `0xFF` fill of memory on every file open.
- `pbAddrChange` (`hardwareu.cpp:642-672`) sets `pbLoc` on every text change and enables/disables the eight buttons on `pbLoc >= MEMSIZE` (unreachable). It does not restore the byte at the old address.
- Not affected by `initialize()`, `initSim()`, hardware Reset, `enable()`/`disable()`.

### 2.6 Address-conflict warning

`addrKeyUp` is the `OnKeyUp` handler of all twelve address edit boxes (four device boxes and eight memory-map boxes) and, in the DFM, also of the twelve read-only `00` boxes. On every key release it recolours the four **device** address texts red or black (`hardwareu.cpp:676-712`):

| Field | Red when |
|---|---|
| `seg7addr` | `seg7loc >= MEMSIZE-8`, or `LEDloc`, `switchLoc` or `pbLoc` lies in `[seg7loc, seg7loc+15]` |
| `LEDaddr` | `LEDloc >= MEMSIZE`, or `LEDloc` in `[seg7loc, seg7loc+15]`, or `LEDloc == switchLoc`, or `LEDloc == pbLoc` |
| `switchAddr` | `switchLoc >= MEMSIZE`, or in the 7-segment range, or `== LEDloc`, or `== pbLoc` |
| `pbAddr` | `pbLoc >= MEMSIZE`, or in the 7-segment range, or `== LEDloc`, or `== switchLoc` |

It is a warning only. Conflicting addresses are still used, and devices then share bytes (for example switches mapped onto the LED byte light the LEDs). The colours are not recomputed when addresses are set programmatically (startup), and memory-map ranges are never checked against anything.

### 2.7 When the display is refreshed

`THardware::update()` (`hardwareu.cpp:217-546`) does nothing unless `Hardware->Visible`. When visible it re-reads the eight digit bytes (if `seg7loc < MEMSIZE-8`) and the LED byte (if `LEDloc < MEMSIZE`) and assigns all 72 brush colours. **(VCL)** Assigning a different brush colour invalidates the shape; the actual repaint happens the next time the message loop runs, which during execution is after every instruction (section 7).

`THardware::updateIfNeeded(int adr)` (`hardwareu.cpp:204-212`):
```cpp
if (adr < MEMSIZE) {
  if((adr >= seg7loc-4 && adr <= seg7loc+15) ||
     (adr >= LEDloc-4  && adr <= LEDloc) )
    update();
}
```
`adr` is the starting address of the write. The `-4` margin catches word/long writes that begin below the device and run into it.

Complete list of `update()` triggers:

| Trigger | Source |
|---|---|
| CPU write through `mem_put` whose start address is in `[seg7loc-4, seg7loc+15]` or `[LEDloc-4, LEDloc]` | `UTILS.CPP:396` |
| Hex or ASCII keystroke edit in the Memory window in the same ranges | `Memory1.cpp:464` |
| Form shown | `hardwareu.cpp:197` |
| `initialize()` (file open) | `hardwareu.cpp:62` |
| Any toggle-switch click | `hardwareu.cpp:77` etc. |
| Any push-button press or release | `hardwareu.cpp:998` etc. |
| 7-segment or LED address text changed | `hardwareu.cpp:567, 577` |
| Push-button address committed (Enter / focus loss) | `hardwareu.cpp:1299, 1310` |

Things that change memory **without** refreshing the hardware display: S-record loading (`SIMOPS2.CPP:356`, which runs *after* `initialize()` in `OpenFile`), the Memory window's Copy and Fill (`Memory1.cpp:523-614`), TRAP #15 file/serial reads that `fread`/`strcpy` straight into `memory`, switch-address changes, `initSim()`, hardware Reset. After a file open the visible display therefore shows all segments and all LEDs lit (memory is `0xFF`) until the next trigger, even if the S-record contained data for those bytes.

A port may refresh more often than this (for example once per animation frame). That is not observable by the 68000 program. What must not be changed are the *memory side effects* listed in 2.4 and 2.5.

---

## 3. Interrupts

### 3.1 The request path: `THardware::IRQprocess(int irqN)`

Every interrupt source, and the Reset button, ends in this one function (`hardwareu.cpp:757-775`):
```cpp
void __fastcall THardware::IRQprocess(int irqN)
{
  static int intMask;
  if(hardwareEnabled) {
    if (irqN > 0)               // Reset calls IRQprocess with irqN = 0
      irq |= (0x01 << (irqN-1));
    if (stopInstruction) {      // if CPU halted after STOP instruction
     intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
      if (!( irq & intMask))    // if IRQ masked
        return;
    }
    inc_cyc (44);               // Interrupt execution time
    if (!trace)
      runMode = true;           // enable runLoop() if not tracing ck 1-11-2008
    if (runMode) {
      Form1->runLoop();         // enter runLoop
    }
  }
}
```
Consequences, each of which the port must reproduce:

1. If `hardwareEnabled` is false the request is dropped completely: no bit is latched, no cycles are added.
2. The request is latched as bit `irqN-1` of the global `int irq`. Level 1 = `0x01` ... level 7 = `0x40`. Several requests of the same level before service collapse into one.
3. **Every accepted request adds 44 to the cycle counter immediately**, whether or not the interrupt is ever taken, except when `stopInstruction` is true and the request is masked (early return).
4. **QUIRK - a request starts execution.** If `trace` is false, `runMode` is set and `Form1->runLoop()` is entered. If the simulator was idle (program loaded but not running, or stopped by STOP), the program starts running from the current PC inside this call. Unlike the Run command this path does not call `loadRegs()`, `setMenuTrace()` or `autoIRQon()`. If the simulator was already running, `runLoop()` returns at once because of its re-entrancy guard (`static bool running`, `SIM68Ku.cpp:249-266`).
5. If `trace` is true (paused, single-stepping, stopped at a breakpoint) nothing runs; the request stays latched until the user executes the next instruction.
6. The `stopInstruction` branch is a wake-up filter: after a STOP, a request that the current mask blocks neither adds cycles nor restarts execution. The bit stays latched. Note that `stopInstruction` is sticky (section 3.5), so this filter stays in force after the program has resumed. The filter tests the whole of `irq`, not just the new bit: a blocked request still gets through (44 cycles, run loop started) when some *other*, unmasked level is already latched.
7. **QUIRK - a request also resumes a halted program.** `trace` and `hardwareEnabled` are the only things tested; `halt` is not. Halts that do not call `Hardware->disable()` leave `hardwareEnabled` true and (after a full-speed run) `trace` false, so the next request resumes execution at the current PC although the main window's Run command is disabled (`setMenuTrace()`, `RUN.CPP:707-708`). These are, with exceptions off, the halts for illegal instruction, privilege violation, CHK, TRAP, TRAPV, divide by zero, trace, Line-A and Line-F (`RUN.CPP:938-999`), and, with exceptions on, the `Address or Bus error during exception processing. Execution halted` halt (`RUN.CPP:652-655`). After SIMHALT, TRAP #15 task 9, STOP with exceptions off and bus/address errors with exceptions off the hardware is disabled and requests are dropped (3.7). Auto-IRQ timers are switched off by every halt (unless `stopInstruction` is set), so in practice this concerns the IRQ buttons and the keyboard/mouse IRQs.
8. **QUIRK - request before any file has been opened.** At application start `initSim()` leaves `trace` false, PC is 0 (zero-initialised global, `var.h:44`) and memory is all `$FF`. The first IRQ click or auto-IRQ tick therefore executes `$FFFF $FFFF` at address 0, which is SIMHALT (`CODE9.CPP:1307-1320`): the simulator halts at once and `Hardware->disable()` turns the IRQ and Reset buttons off until a file is opened or Reset Program is used.

### 3.2 Interrupt sources

| Source | Call | Citation |
|---|---|---|
| IRQ buttons `IRQ7Btn` .. `IRQ1Btn` (`TSpeedButton`, `OnClick = IRQ7` .. `IRQ1`) | `IRQprocess(n)` | `hardwareu.dfm:1938-2854`, `hardwareu.cpp:715-755` |
| Auto-interval timers `IRQ1timer` .. `IRQ7timer` (`OnTimer = IRQ1` .. `IRQ7`, the same handlers) | `IRQprocess(n)` | `hardwareu.dfm:4913-4954` |
| Key down / key up in the output window when armed by TRAP #15 task 62 | `IRQprocess(keyDownIRQ)` / `IRQprocess(keyUpIRQ)` | `simIOu.cpp:425-426, 458-459`; armed at `CODE9.CPP:1131-1139` |
| Mouse down / up / move in the output window when armed by TRAP #15 task 60 | `IRQprocess(mouseDownIRQ / mouseUpIRQ / mouseMoveIRQ)` | `simIOu.cpp:694-695, 760-761, 787-788`; armed at `CODE9.CPP:1066-1076` |
| Reset button | `IRQprocess(0)` (no bit latched) | `hardwareu.cpp:778-792` |

A button click fires `OnClick` on mouse release inside the button. The seven buttons and Reset are disabled while `hardwareEnabled` is false (`disable()`, section 3.7). All eight share one 50 x 25 glyph holding two 25 x 25 images (`NumGlyphs = 2`); the DFM blob, decoded, is byte-identical to `pushbutton2glyphs.bmp` in the source directory. The first image (enabled) is a light-grey raised square; the second (disabled) is a flat dark-maroon square, so a disabled button all but disappears into the maroon group box rather than looking "greyed".

The keyboard and mouse sources are armed with an IRQ level in bits 8-15 of D1 (0-7; larger values are ignored). Level 0 means "not armed": the handlers call `IRQprocess` only when the stored level is non-zero, and `initSim()` zeroes all five levels (`STARTSIM.CPP:116-120`).

### 3.3 How the core takes an interrupt

Recognition happens in `exec_inst()` (`RUN.CPP:746-1017`), **after** the current instruction has executed, and **only when exception processing is enabled**:
```cpp
if (exceptions)               // if exception processing enabled
{
  OLD_PC = PC;
  switch (exec_result) { case BAD_INST: ...  case NO_PRIVILEGE: ... }
  intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
  if ( irq & intMask)         // if IRQ
    irqHandler();             // process IRQ
  if (trace_bit) { ... trace exception ... }
  switch (exec_result) { case STOP_TRAP: ... case TRAP_TRAP: ... }
}
```
(`RUN.CPP:862-932`). Points to note:

- `exceptions` is the "Enable Exceptions" option of the main window (Options menu item `&Enable Exceptions`, a toggle that also rewrites the settings file, `SIM68Ku.cpp:1271-1281`). It defaults to **false** (`SIM68Ku.cpp:1495`), is persisted in `sim68K.dat`, can be set by the command-line switch `/e` (`SIM68Ku.cpp:1231-1233`) and by TRAP #15 task 32/5. **QUIRK:** with exceptions disabled an IRQ still latches its bit, still adds 44 cycles and still starts the program running (3.1), but it is never taken. The bits stay latched; once exceptions are enabled, pending requests are taken at the end of the next instruction to complete. `exceptions` is tested *after* the instruction has executed, so when TRAP #15 task 32/5 enables it, a pending unmasked request is taken at the end of that very TRAP instruction.
- The whole block, including the IRQ test, is inside `if (!exec_result)` following the opcode fetch (`RUN.CPP:761-762`). In a step whose opcode fetch itself fails (address error on an odd PC, bus error from the memory map) no IRQ is recognised.
- The mask is computed from `SR` as it is *after* the instruction, so `MOVE #..,SR`, `ANDI #..,SR` and `RTE` take effect for the very next recognition.
- Requests arrive from the message loop, which runs after `exec_inst()` (section 7). A request is therefore serviced after the *next* instruction completes, never in the middle of one.

`irqHandler()` (`RUN.CPP:1083-1117`):
```cpp
exceptionHandler(2,0,READ);
SR &= 0xF8FF;                 // clear irq priority bits
if (irq & 0x40) {  SR = SR | 0x700; mem_req (0x7C, LONG_MASK, &PC); irq &= 0x3F; }
else if (irq & 0x20) { SR = SR | 0x600; mem_req (0x78, LONG_MASK, &PC); irq &= 0x1F; }
else if (irq & 0x10) { SR = SR | 0x500; mem_req (0x74, LONG_MASK, &PC); irq &= 0x0F; }
else if (irq & 0x08) { SR = SR | 0x400; mem_req (0x70, LONG_MASK, &PC); irq &= 0x07; }
else if (irq & 0x04) { SR = SR | 0x300; mem_req (0x6C, LONG_MASK, &PC); irq &= 0x03; }
else if (irq & 0x02) { SR = SR | 0x200; mem_req (0x68, LONG_MASK, &PC); irq &= 0x01; }
else if (irq & 0x01) { SR = SR | 0x100; mem_req (0x64, LONG_MASK, &PC); irq &= 0x00; }
inc_cyc (34);
```
1. `exceptionHandler(2, 0, READ)` (`RUN.CPP:1038-1080`) builds a 6-byte frame on the supervisor stack `A[8]`: `A[8] -= 4`, push `OLD_PC` (long; the address of the next instruction); `A[8] -= 2`, push `SR` (word, the pre-interrupt value). Then `SR |= sbit; SR &= ~tbit; trace_bit = false;`. If the SSP is odd, negative or greater than `MEMSIZE` (`(A[8] % 2) || (A[8] < 0) || ((unsigned int)A[8] > MEMSIZE)`; the start-up value `$01000000` passes), it switches the auto-trace timer off, prints the two message lines `Error during Exception Handler: SSP odd or outside memory space ` (with the trailing space) and `at location %4x` (the SSP), sets `trace = true; sstep = false;` and returns without pushing and without touching S or T - but `irqHandler` carries on and still changes the mask and PC.
   - **The pushes are ordinary memory writes.** Each one is `put((long *)&memory[A[8] & ADDRMASK], value, size)`, and `put()` forwards every non-register destination to `mem_put()` (`UTILS.CPP:574-587`). The frame is therefore written at the 24-bit-masked SSP, is subject to the memory map of section 4 (a stack inside a ROM range is silently not written; a stack inside a Read or Invalid range, or a Protected range while the displayed S bit is 0, raises a bus error from inside exception processing - see 4.4 item 4), and refreshes the hardware display through `updateIfNeeded` like any other write.
2. The highest pending level is chosen. The SR interrupt mask is set to that level.
3. PC is loaded from the **autovector**: level n uses vector number 24+n at address `0x60 + 4n`:

   | Level | Vector number | Address |
   |---|---|---|
   | 1 | 25 | `$064` |
   | 2 | 26 | `$068` |
   | 3 | 27 | `$06C` |
   | 4 | 28 | `$070` |
   | 5 | 29 | `$074` |
   | 6 | 30 | `$078` |
   | 7 | 31 | `$07C` |

   There is no interrupt-acknowledge cycle and no user (non-auto) vector. The vector fetch goes through `mem_req` and is subject to the memory-map checks of section 4.
4. The serviced level's bit is cleared (the `&=` masks also clear higher bits, which are already known to be 0). Lower pending levels stay latched.
5. 34 more cycles are added. A serviced interrupt therefore costs 44 (request) + 34 (service) = 78 cycles.
6. Because `trace_bit` is cleared, no trace exception follows in the same step.

### 3.4 The interrupt mask

`intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;` with `intmsk = 0x0700` (`def.h:50`). `>>` binds tighter than `|`. Evaluated:

| SR mask I2-I0 | `intMask` | Levels accepted |
|---|---|---|
| 0 | `0x01FF` | 1-7 |
| 1 | `0x03FE` | 2-7 |
| 2 | `0x07FC` | 3-7 |
| 3 | `0x0FF8` | 4-7 |
| 4 | `0x1FF0` | 5-7 |
| 5 | `0x3FE0` | 6-7 |
| 6 | `0x7FC0` | 7 |
| 7 | `0xFFC0` | 7 |

So level n is accepted when n is greater than the mask, and level 7 is always accepted (non-maskable). Level 7 is level-latched, not edge-triggered: a new IRQ 7 request is accepted again while the level-7 handler is running.

A blocked request is not lost. It stays in `irq` until the mask drops or `initSim()` clears it. `irq` is cleared only by `initSim()` (`STARTSIM.CPP:79`) and bit-by-bit by `irqHandler()`. Run, Pause, `disable()`, turning timers off and the hardware Reset button do **not** clear it.

### 3.5 STOP and interrupts

- `STOP()` (`CODE9.CPP:198-230`) adds 4 cycles, fetches the immediate word (advancing PC), and then: if S is clear it returns `NO_PRIVILEGE` (SR unchanged); otherwise it loads SR from the immediate word, re-setting T if T was set before; if the *new* SR has S clear it returns `NO_PRIVILEGE` (with SR already changed); if T was set it returns `TRACE_EXCEPTION`; otherwise it returns `STOP_TRAP`. Only `STOP_TRAP` halts as described below, so a STOP executed with the T bit set never stops the simulator.
- With exceptions **enabled** (`RUN.CPP:892-902`): `halt = true`; auto-trace timer off; and, only if `stopInstruction` was false, `stopInstruction = true`, message `STOP instruction. Execution halted`, focus to main window, `scrshow()`. `runprog()` then stops the run loop (`runMode = false`) but, because `stopInstruction` is now true, does **not** turn the auto-IRQ timers off (`RUN.CPP:697-700`). Hardware stays enabled.
- With exceptions **disabled** (`RUN.CPP:950-958`): message `STOP instruction executed at location %4x. Execution halted`, logging stopped, `Hardware->disable()`. `stopInstruction` is not set. The program cannot be woken.
- Wake-up is by `IRQprocess` (3.1): an unmasked request sets `runMode` and re-enters `runLoop()`.
- **QUIRK - one instruction runs before the interrupt is taken.** On wake-up `exec_inst()` first fetches and executes the instruction *following* the STOP, and only then recognises the interrupt. The pushed return address is that of the second instruction after STOP. (A real 68000 takes the interrupt immediately and returns to the instruction after STOP.)
- **QUIRK - `stopInstruction` is sticky.** It is cleared only by `initSim()` (`STARTSIM.CPP:67`) and by the hardware Reset button (`hardwareu.cpp:788`). After the first STOP: later STOPs print no message and do not call `scrshow()`; auto-IRQ timers are no longer switched off when the program later halts in trace mode or at a breakpoint (`RUN.CPP:699`); masked requests take the early return in `IRQprocess`.
- If a request is already latched and the SR loaded by STOP unmasks it, `irqHandler()` runs in the same `exec_inst()` (PC now points at the handler) and *then* the `STOP_TRAP` case halts the simulator anyway. See the race described in 9.2.

### 3.6 Auto-interval interrupt timers

**Controls.**

- Seven `TTimer`s `IRQ1timer` .. `IRQ7timer`, one per level, `Enabled = False` in the DFM and no `Interval` property (`hardwareu.dfm:4913-4954`). **(VCL)** `TTimer.Interval` defaults to 1000 ms, so every level starts at 1000 ms. Each level has its own independent interval.
- Seven checkboxes `CheckBox7` .. `CheckBox1` under the IRQ buttons (no caption, default unchecked, `hardwareu.dfm:2865-2964`). Checkbox n arms timer n.
- Label `AutoLbl` (design caption `'Automatic'`), which at run time reads `Automatic Enabled` or `Automatic Disabled` and reflects the master flag `autoIRQ`.
- Group "Auto Interval": masked edit `IRQinterval` (`EditMask = '!99999999;1;0'`, `MaxLength = 8`, `Text = '    1   '`, `hardwareu.dfm:3180-3197`) followed by the label `mS`; combo box `AutoIRQ` (items `'1'`..`'7'` plus an eighth empty string, `ItemIndex = 0`, default style, `hardwareu.dfm:3154-3179`) followed by the label ` IRQ`.

**Units and range.** The interval is in milliseconds, decimal, eight digits, 0 to 99999999. **(VCL)** With `'0'` as the mask blank character the design text `'    1   '` is displayed and read as `00001000`, i.e. 1000; the help screenshot shows exactly `00001000`. **(VCL)** An interval of 0 means the timer never fires. **(VCL)** A timer's first tick comes one full interval after it is enabled, and enabling a timer that was disabled starts a fresh period; so every Pause/Run, single step or breakpoint stop followed by Run restarts the phase of all auto interrupts, and a program that is paused more often than the interval never sees a tick.

**Editing.**

- Selecting a level in the combo box copies that timer's interval into the edit: `AutoIRQChange` (`hardwareu.cpp:966-991`), `case 0: IRQinterval->Text = IRQ1timer->Interval;` ... `case 6:` for IRQ 7. **(VCL)** The number is assigned as a plain decimal string (`250`); because the mask starts with `!` it is right-justified and zero-filled on the left, so the field shows `00000250` and reads back as 250.
- Any change of the edit text writes the number into the timer of the selected level: `IRQintervalChange` (`hardwareu.cpp:938-963`), `case 0: IRQ1timer->Interval = IRQinterval->EditText.ToInt();` ... `case 6:`. **(VCL)** Changing the interval of a running timer restarts its period. The edit has no `OnKeyPress` filter and no commit step (the mask itself admits digits only), and every text change is applied at once, so intermediate values are live. **(VCL)** The masked field is overwrite-style: with the caret at the first position, typing `5` over `00001000` makes the interval 50001000 ms until further digits are typed.
- Both `switch` statements have cases 0-6 only. With the empty eighth item selected (`ItemIndex` 7), or with no selection (-1), neither handler does anything, so typing an interval then affects no timer.

**The master flag and the arming rule.** A timer runs only while both its checkbox is checked and the master flag `autoIRQ` is true.

```cpp
void THardware::autoIRQoff() {            // hardwareu.cpp:796-807
  IRQ1timer->Enabled = false; ... IRQ7timer->Enabled = false;
  AutoLbl->Caption = "Automatic Disabled";
  autoIRQ = false;
}
void THardware::autoIRQon() {             // hardwareu.cpp:811-822
  IRQ1timer->Enabled = CheckBox1->Checked; ... IRQ7timer->Enabled = CheckBox7->Checked;
  AutoLbl->Caption = "Automatic Enabled";
  autoIRQ = true;
}
void THardware::CheckBoxNClick(...) {     // hardwareu.cpp:1346-1392
  if (autoIRQ) IRQNtimer->Enabled = CheckBoxN->Checked;
}
```
**(VCL)** `OnClick` of a `TCheckBox` fires whenever `Checked` actually changes, including when code assigns it. The original relies on this in three places: `initialize()`, `setAutoIRQ()` and the S0 memory-map loader.

**When the master flag changes** (this table is the complete list of callers):

| Event | Calls | `autoIRQ` afterwards | Other effects |
|---|---|---|---|
| Form created | `FormCreate` | false | caption still `Automatic` |
| Application start (`TForm1::FormShow` -> `initSim()`), Close file, Reset Program (Rewind) | `autoIRQoff()` then `enable()` -> `autoIRQon()` (`STARTSIM.CPP:80-84`) | **true** | timers of checked boxes run |
| Open / Reload / drop file (`OpenFile`) | `initSim()` as above, then `initialize()` | **false** | all seven checkboxes unchecked, switch pictures off (`hardwareu.cpp:44-63`) |
| Run, Run To Cursor (`RunExecute`) | `autoIRQon()` (`SIM68Ku.cpp:453`) | true | |
| Pause (`PauseExecute`) | `autoIRQoff()` (`SIM68Ku.cpp:538`) | false | |
| A `runprog()` step ends with `trace` or `halt` set and `stopInstruction` false (single step, step over arrival, breakpoint, run-to-cursor arrival, any halt) | `autoIRQoff()` (`RUN.CPP:697-700`) | false | |
| Same, but `stopInstruction` true | nothing | unchanged | |
| SIMHALT, TRAP #15 task 9, STOP with exceptions off, bus/address error with exceptions off | `disable()` -> `autoIRQoff()` | false | `hardwareEnabled = false` |
| Keyboard input completes while `trace` is true | `enable()` -> `autoIRQon()` (`simIOu.cpp:1366-1368`) | true | `hardwareEnabled = true` |
| TRAP #15 task 32/6 with D2.B = 0 | `autoIRQoff()` (`hardwareu.cpp:834-843`) | **false** | all checkboxes unchecked |

Step, Trace and Auto Trace do not call `autoIRQon()`.

**QUIRK - auto interrupts can start the program by themselves.** After Reset Program (and at application start) the master flag is true. If a checkbox is checked, its timer runs while the simulator is idle; when it fires, `IRQprocess` finds `trace == false` and starts the run loop (3.1 item 4). After *Open/Reload* this cannot happen because `initialize()` unchecks everything and clears the flag.

**`setAutoIRQ(uint irq, uint interval)`** - used by TRAP #15 task 32/6 (`hardwareu.cpp:831-903`). The first parameter shadows the global `irq`.

| `irq` argument (D2.B) | Action |
|---|---|
| `0x00` | `autoIRQoff()`; then uncheck all seven checkboxes |
| `0x01` .. `0x07` | `CheckBoxN->Checked = false; IRQNtimer->Enabled = false;` |
| `0x81` .. `0x87` | `IRQNtimer->Interval = interval; CheckBoxN->Checked = true;` |
| anything else (`0x08`-`0x80`, `0x88`-`0xFF`) | nothing |

After the switch it always calls `AutoIRQChange(this)`, which re-displays the interval of the level currently selected in the combo box. The combo selection is not changed, so the new interval becomes visible only when the level being configured happens to be the selected one (level 1 by default); for any other level the timer simply keeps the value passed in D3.

- The enable case does not set `IRQNtimer->Enabled` itself. The timer starts only through the checkbox `OnClick` handler, i.e. only if the box was previously unchecked **and** `autoIRQ` is true. During a normal Run `autoIRQ` is true, so it works.
- **QUIRK:** after a "disable all" (`0x00`), `autoIRQ` is false, so a following "enable level n" checks the box and stores the interval but does **not** start the timer. It starts at the next `autoIRQon()` (next Run, Reset Program, or input completion in trace mode). A program that does "disable all, then enable one" gets no auto interrupts on real EASy68K.
- If the box is already checked, an enable request only changes the interval (restarting the period if the timer is running and the value differs).
- The interval is not range-checked (the comment says 1 through 99999999). UNVERIFIED: what the eight-digit mask does to a value above 99999999 when it is echoed into `IRQinterval` for the selected level; the echo fires `IRQintervalChange`, which writes the possibly truncated number back into that level's timer.

### 3.7 Hardware enable / disable

```cpp
void THardware::disable() {               // hardwareu.cpp:907-919
  autoIRQoff();
  hardwareEnabled = false;
  ResetBtn->Enabled = false;  IRQ1Btn->Enabled = false; ... IRQ7Btn->Enabled = false;
}
void THardware::enable() {                // hardwareu.cpp:923-935
  autoIRQon();
  hardwareEnabled = true;
  ResetBtn->Enabled = true;   IRQ1Btn->Enabled = true;  ... IRQ7Btn->Enabled = true;
}
```
- `disable()` is called when the program terminates: TRAP #15 task 9 (`CODE9.CPP:783-789`), SIMHALT (`CODE9.CPP:1311-1319`), STOP with exceptions off (`RUN.CPP:957`), `haltSimulator()` (`RUN.CPP:1121-1128`).
- `enable()` is called by `initSim()` (`STARTSIM.CPP:84`) and by input completion in trace mode (`simIOu.cpp:1368`). A commented-out call exists at `RUN.CPP:711`.
- While disabled: the IRQ and Reset buttons are disabled and show the dark-maroon half of their glyph (3.2), `IRQprocess` and `ResetBtnClick` do nothing (keyboard and mouse IRQs are dropped too), timers are off. Switches, push buttons, LEDs, the 7-segment display, the address fields, the checkboxes and the memory map keep working.
- `disable()` does not uncheck the checkboxes and does not clear `irq`.
- `hardwareEnabled` is restored **only** by `enable()`, i.e. by `initSim()` (Reset Program, Close, Open/Reload, application start) and by input completion in trace mode. Run does not restore it. A program that is continued after SIMHALT or task 9 with Pause followed by Run (Pause re-enables the Run command, `SIM68Ku.cpp:535`) therefore runs with the hardware disabled: `RunExecute` calls `autoIRQon()`, so the label reads `Automatic Enabled` and the timers of checked boxes tick, but every request is dropped in `IRQprocess` and the IRQ and Reset buttons stay disabled.

### 3.8 The Reset button

`ResetBtnClick` (`hardwareu.cpp:778-792`):
```cpp
if (hardwareEnabled) {
  hardReset = true;
  SR = SR | sbit;                     // supervisor
  SR = SR & ~tbit;                    // trace off
  SR = SR | 0x700;                    // mask = 7
  mem_req (0x00, LONG_MASK, &A[8]);   // SSP from vector 0
  mem_req (0x04, LONG_MASK, &PC);     // PC from vector 1
  inc_cyc (40);
  stopInstruction = false;
  scrshow();
  IRQprocess(0);
}
```
Exactly what it does and does not do:

- Sets S, clears T, sets the interrupt mask to 7. The condition codes and other SR bits are kept.
- Loads the supervisor stack pointer from the long at `$000000` and PC from the long at `$000004`, through `mem_req` (so the memory map applies, and a program that has not defined these vectors gets `$FFFFFFFF` in both, which leads to an address error on the next fetch).
- Adds 40 cycles, then `IRQprocess(0)` adds 44 more (84 in total) and, if `trace` is false, starts or continues the run loop at the new PC. If `trace` is true the simulator stays paused at the new PC.
- Clears `stopInstruction`. Refreshes the register display (`scrshow()`), which also refreshes the displayed SR used by the Protected check (4.4).
- Does **not** clear `irq`, D0-D7, A0-A6, USP, memory, the cycle counter, the devices, the auto-IRQ configuration or the memory map. `hardReset` is write-only: it is set here and cleared in `initSim()` and never read.
- Works whether or not exceptions are enabled. Does nothing when hardware is disabled.

The 68000 `RESET` instruction (`CODE9.CPP:180-192`) has no connection to the hardware window: it checks the S bit and adds 132 cycles.

---

## 4. Memory map

### 4.1 GUI

Group box `GroupBox4`, caption `Memory Map`, grey (`hardwareu.dfm:4168-4800`). Column headers `Start:` and `End:`. Four rows, top to bottom:

| Checkbox | Row label | Start edit | End edit | Text at right | Flag / range globals |
|---|---|---|---|---|---|
| `ROMChk` | `ROM:` | `ROMStartEdit` | `ROMEndEdit` | `Writes are ignored` | `ROMMap`, `ROMStart`, `ROMEnd` |
| `ReadChk` | `Read:` | `ReadStartEdit` | `ReadEndEdit` | `Bus error on write` | `ReadMap`, `ReadStart`, `ReadEnd` |
| `ProtectedChk` | `Protected:` | `ProtectedStartEdit` | `ProtectedEndEdit` | `Supervisor access` | `ProtectedMap`, `ProtectedStart`, `ProtectedEnd` |
| `InvalidChk` | `Invalid:` | `InvalidStartEdit` | `InvalidEndEdit` | `Bus error on access` | `InvalidMap`, `InvalidStart`, `InvalidEnd` |

- Defaults: all four unchecked, all eight values 0 (displayed `000000`).
- Each edit is the same six-hex-digit masked box as the device addresses (2.1), with its own read-only `00` prefix box (`MaskEdit2, 3, 5, 7, 13, 15, 17, 19`). Each `OnChange` does `X = StrToInt("0x" + Hardware->XEdit->EditText);` (`hardwareu.cpp:1395-1440`). Each checkbox `OnClick` does `XMap = XChk->Checked;` (`hardwareu.cpp:1443-1464`).
- Changes take effect immediately, also while a program is running.
- One range per type. Start and End are both inclusive. Nothing validates Start <= End. An inverted range matches no read and no byte write; because the write test is `loc+bytes-1 >= Start && loc <= End` (4.3), a word or long write, or a TRAP #15 buffer check, that begins at or below End and reaches Start still matches (for example End = `001000`, Start = `001002`, long write at `$1000`). A checked row left at `000000`-`000000` covers address 0 only.
- The map is not persisted in `sim68K.dat`. **QUIRK:** it is also never reset: not by `initSim()`, `OpenFile()`, `initialize()`, Reset Program, or the Reset button. Once set (by hand or by a loaded program), it stays until the user changes it or the simulator is restarted.

### 4.2 From the assembler's MEMORY directive to the simulator

**Assembler.** `MEMORY` is in the directive table (`EDIT\INSTTABL.CPP:829`) and implemented by `memory()` (`EDIT\DIRECTIV.CPP:899-991`):

- Acts in pass 2 only.
- Errors are raised with `NEWERROR`, which keeps the most severe code; codes above `SEVERE` (`0x400`) are severe, `0x3xx` are errors, `0x2xx` minor errors (`EDIT\asm.h:42-124`). In order:
  1. A size suffix raises `INV_SIZE_CODE` (`0x201`, "Invalid size code"). This is a minor error: it is counted as an error, but the directive carries on and **the range is still recorded**.
  2. An empty operand field raises `SYNTAX` and returns.
  3. A label raises `LABEL_ERROR` (`0x414`, "Label is not allowed", `EDIT\ERROR.CPP:226-228`). The code keeps going as far as evaluating the start expression, but `LABEL_ERROR` is severe, so the `if (*errorPtr > SEVERE) return NORMAL;` that follows (`EDIT\DIRECTIV.CPP:954-955`) abandons the directive: **a labelled `MEMORY` line records nothing** and produces no S0 record. (For directives the label is passed to the directive function and is not defined as a symbol, `EDIT\ASSEMBLE.CPP:615-623, 707`.)
  4. An operand consisting only of white space raises `INV_OPCODE` and returns.
- The type word is read from the operand (at most 10 characters kept; the first character unconditionally, then while `isalnum`) and compared case-insensitively with `ROM`, `READ`, `PROTECTED`, `INVALID`; anything else is `SYNTAX`.
- Start and end are expressions separated by a comma (a missing comma is `SYNTAX`). Forward references are rejected (`INV_FORWARD_REF`, "Forward references not allowed with this directive"); a severe error from either expression abandons the directive.
- The values are stored masked to 24 bits: `mapROMStart = startAddr & 0x00FFFFFF; mapROMEnd = endAddr & 0x00FFFFFF;` and likewise for the other three, with flags `mapROM`, `mapRead`, `mapProtected`, `mapInvalid` (`EDIT\DIRECTIV.CPP:972-988`, globals `EDIT\GLOBALS.CPP:92-99`). The flags are cleared at the start of each assembly (`EDIT\ASSEMBLE.CPP:292-295`).
- One range per type; a later `MEMORY` of the same type overwrites the earlier one.

**Object file.** `finishObj()` (`EDIT\OBJECT.CPP:317-366`) writes, after the last data record and before the final `S8` record, one extra S0 record per enabled type, in the fixed order ROM, Read, Protected, Invalid. It runs whenever an object file is being produced, whether or not the assembly had errors (`EDIT\ASSEMBLE.CPP:196-197`). `writeMap()` (`EDIT\OBJECT.CPP:279-314`) builds: `S0`, byte count `1A` (2 address + 23 data + 1 checksum), address `0000`, then 23 data bytes of ASCII = a 10-character tag, six upper-case hex digits (`"%06X"`) of the start, a comma, six hex digits of the end, then the checksum (ones' complement of the low byte of the sum of the count, address and data bytes, `EDIT\OBJECT.CPP:246-254`). Example: `MEMORY ROM $2000,$2FFF` produces exactly `S01A0000202020202020524F4D203030323030302C30303246464665`. The tags are:

| Type | Tag (10 chars) | Hex in file |
|---|---|---|
| ROM | `"      ROM "` | `202020202020524F4D20` |
| Read | `"     READ "` | `20202020205245414420` |
| Protected | `"PROTECTED "` | `50524F54454354454420` |
| Invalid | `"  INVALID "` | `2020494E56414C494420` |

The file's first record is always the fixed header `S021000036384B50524F47202020323043524541544544204259204541535936384B` + checksum, i.e. the text `68KPROG   20CREATED BY EASY68K` (`EDIT\OBJECT.CPP:160`).

Assembler bug to carry into the port knowingly: `writeMap` declares `char data[6];` and then `sprintf(data,"%06X", start);`, which writes 7 bytes (`EDIT\OBJECT.CPP:281, 291, 300`). The third-party CLI port changed this to `char data[7]` (`CLI\OBJECT.CPP:285`). Under Emscripten the one-byte overflow must be fixed the same way; the output is unchanged.

**Simulator.** `loadSrec()` (`SIMOPS2.CPP:203-379`) rebuilds each S0 record as the string `"S0 = "` + its data bytes as characters (bytes outside `' '`..`'~'` become `'.'`), reports a checksum mismatch as `Checksum error on line %d...` without rejecting the record, and adds the string to the message area. An S0 string equal to `"S0 = 68KPROG   20CREATED BY EASY68K"` sets the per-load flag `EASy68Kv2_0_SRecord`; S0 records met before that (or in a file without the header) are only echoed. For every S0 record after the header in that file (`SIMOPS2.CPP:258-280`):
```cpp
if(str.SubString(6,9) == "      ROM") {
  Hardware->ROMChk->Checked = true;
  Hardware->ROMStartEdit->EditText = str.SubString(16,6);
  Hardware->ROMEndEdit->EditText = str.SubString(23,6);
} else if(str.SubString(6,9) == "     READ") { ...ReadChk / ReadStartEdit / ReadEndEdit... }
  else if(str.SubString(6,9) == "PROTECTED") { ...Protected... }
  else if(str.SubString(6,9) == "  INVALID") { ...Invalid... }
```
(`SubString` is 1-based: characters 6-14 are the first nine tag characters, 16-21 the start, 23-28 the end.)

- The globals are not written directly. **(VCL)** Assigning `Checked` fires `OnClick` (sets the `...Map` flag) and assigning `EditText` fires `OnChange` (sets the range). A port without VCL controls must set flag and range explicitly.
- The loader only ever *enables* a type. The source comment says "Does not erase existing map if no map specified" (`SIMOPS2.CPP:261`). Loading a program without `MEMORY` directives leaves the previous program's map active.
- The map records are at the end of the file and the loader stores data with `memory[loc++ & ADDRMASK] = s_byte[0];` (`SIMOPS2.CPP:356`), bypassing `mem_put`. Loading into a ROM, Read or Invalid range therefore always works.
- "Open Data" (`OpenDataExecute`, `SIM68Ku.cpp:379-389`) uses the same loader, so a data file with an EASy68K header and map records also changes the map.
- A non-hex range string would raise a conversion exception inside `loadSrec`, which is caught by its `catch(...)` and reported as `Unexpected Error reading .S68 file`.

### 4.3 Enforcement in the core

There are two separate implementations: one for writes and one for reads.

**Writes - `mem_put(long data, int loc, long size)`** (`UTILS.CPP:339-399`), in this order:

1. Odd address with word or long size: address error (before any masking).
2. `loc = loc & ADDRMASK;` (24-bit).
3. `code = memoryMapCheck(Invalid | Protected | Read | Rom, loc, bytes);` If `BUS_ERROR`, return it. If `ROM_MAP`, **return `SUCCESS` without writing anything**.
4. Store the bytes big-endian, set `writeEA`, `bpWrite = true`, call `Hardware->updateIfNeeded(loc)` and `MemoryFrm->LivePaint(loc)`.

**`memoryMapCheck(maptype mapt, int loc, int bytes)`** (`UTILS.CPP:246-321`), in this order:

1. Hardware address (start address only, see 2.1): return `SUCCESS`.
2. `loc < 0 || loc > MEMSIZE-1`: bus error.
3. Invalid: `if(InvalidMap && (mapt & Invalid))` and `loc+bytes-1 >= InvalidStart && loc <= InvalidEnd`: bus error.
4. Protected: `if(ProtectedMap && (mapt & Protected))` and `loc+bytes-1 >= ProtectedStart && loc <= ProtectedEnd` and `Form1->regSR->EditText[3] == '0'`: bus error.
5. Read: `if(ReadMap && (mapt & Read))` and `loc+bytes-1 >= ReadStart && loc <= ReadEnd`: bus error.
6. ROM: `if(ROMMap && (mapt & Rom))` and `loc+bytes-1 >= ROMStart && loc <= ROMEnd`: return `ROM_MAP` (`0x000F`, `def.h:101`).
7. Otherwise `SUCCESS`.

The overlap test covers the whole access, so a word or long that only partly overlaps a range is treated as inside it: a partly overlapping write to ROM is discarded entirely, and one to Read/Invalid/Protected faults. The flag values are `enum maptype {Invalid=0x01, Protected=0x02, Read=0x04, Rom=0x10};` (`def.h:27`).

A "bus error" here means (`UTILS.CPP:257-265` and the three copies below it):
```cpp
if (exceptions) {
  mem_req (0x8, LONG_MASK, &PC);            // get bus error vector
  exceptionHandler (0, (long) loc, WRITE);
} else {
  haltSimulator();
  Form1->Message->Lines->Add(str.sprintf
    ("Bus Error: Instruction at %4x accessing address %4x", OLD_PC, loc));
}
return BUS_ERROR;
```
With exceptions disabled, `haltSimulator()` (`RUN.CPP:1121-1128`: auto-trace timer off, `trace = false`, `halt = true`, `Hardware->disable()`, log stopped) also disables the hardware (3.7), and the message is added *after* the halt.

With exceptions enabled the order matters: PC is loaded from vector `$008` **first**, and only then does `exceptionHandler(0, loc, WRITE)` (`RUN.CPP:1058-1076`) add 50 cycles and push the 14-byte group-0 frame - `OLD_PC+2` (long), SR (word), the instruction word `inst` (word), the faulting address `loc` (long, already masked to 24 bits) and an information word (`5`, or `6` when `loc == OLD_PC+2`, plus `0x10` only when the caller passed `READ`) - before setting S and clearing T. Every memory-map fault passes `WRITE`, also on the read path. These pushes go through `mem_put` like those of section 3.3.

What the faulting instruction does next depends on how it reached memory:

- **Faults that are reported to the instruction.** The opcode and extension-word fetches and the operand reads made by `eff_addr()` return the code; the instruction returns `BUS_ERROR` at once. With exceptions on, `exec_inst` has no case for that result, so execution simply continues at the handler; if the *next* instruction also returns a bus or address error, `runprog` halts with `Address or Bus error during exception processing. Execution halted` (`RUN.CPP:652-655, 759-760, 856-857`). With exceptions off, `exec_inst` adds the line `Execution halted` after the `Bus Error: ...` line (`RUN.CPP:971-976`).
- **Faults that are not.** Destination writes go through `put()`, which is `void` and throws `mem_put`'s result away (`UTILS.CPP:574-587`). An instruction whose *write* faults therefore runs to completion - condition codes, post-increment and cycle count included - and returns `SUCCESS`, although PC has already been replaced by the bus-error vector and the frame has been pushed (exceptions on), or the simulator has already been halted with only the `Bus Error: ...` line (exceptions off). The typical case is a write into a Read range.
- **Writes are preceded by a read.** `eff_addr()` reads every memory operand with `mem_req`, including the destination of a MOVE or CLR (`RUN.CPP:141-342`; only LEA and PEA use the non-reading variant `eff_addr_noread`, `CODE2.CPP:64, 98` - even JSR reads a word at its target). A write to an address *inside* an Invalid range - or inside a Protected range while the displayed S bit is 0 - therefore normally faults on that read, by the read rules below (start address only, reported to the instruction), before `mem_put` is ever reached. The write-path test matters for Read and ROM ranges, for accesses that begin below a range and run into it, and for writes that do not come from `eff_addr()` (stack pushes, MOVEM, exception frames, keyboard input stored by TRAP #15).

The frame layout and the double-fault rule belong to the exception-processing specification; they are repeated here because the memory map is their only source of bus errors.

**Reads - `mem_req(int loc, long size, long *result)`** (`UTILS.CPP:420-499`), in this order:

1. Odd address with word or long size: address error.
2. `loc = loc & ADDRMASK;`
3. If `loc` is not a hardware address:
   - `if(InvalidMap)` and `loc >= InvalidStart && loc <= InvalidEnd`: bus error.
   - `if(ProtectedMap)` and `loc >= ProtectedStart && loc <= ProtectedEnd` and `Form1->regSR->EditText[3] == '0'`: bus error.
4. Read the bytes.

Differences from the write path that the port must keep:

- Reads test only the **starting address**, not the extent. A long read beginning two bytes below an Invalid range and running into it succeeds.
- Reads never consult Read or ROM (both are readable by design).
- The read-path bus error passes `WRITE` to `exceptionHandler` (`UTILS.CPP:457, 472`), so the R/W bit in the stacked information word says "write" for a read fault. **QUIRK.**
- Instruction fetches use `mem_request` -> `mem_req`, so executing code inside an Invalid range, or inside a Protected range while the *displayed* S bit is 0, raises a bus error. So do exception-vector fetches and the Reset button's vector reads.

**Other callers of `memoryMapCheck`** (owned by the TRAP #15 specification; listed here so the map semantics are complete): string and buffer arguments of TRAP #15 tasks are checked with `Invalid` only, over `strlen` or the given length, at `CODE9.CPP:741, 793, 816, 847, 859, 959, 980, 995, 1005, 1029, 1046, 1059, 1146, 1156, 1169, 1179, 1243`; file read (task 53) uses `Invalid | Read | Rom` and skips the read on `ROM_MAP` (`CODE9.CPP:1016-1020`); serial read uses `Invalid | Read | Rom` (`simIOu.cpp:2331`). None of them checks Protected. The hardware-address bypass applies to them too.

**Things that ignore the map entirely:** the S-record loader, the Memory window (keystroke edit, Copy, Fill, Save), the hardware form's own pokes (switches, push buttons, address commits), the `0xFF` fill.

**Things that might be expected to ignore it but do not:** exception stack frames (interrupt, trap, bus/address error - all pushed with `put()` -> `mem_put()`, 3.3) and instruction writes, which reach memory through `put()` as well, including the return-address and frame pushes of BSR, JSR, PEA and LINK (`CODE8.CPP:141, 200`, `CODE2.CPP:110, 147`). The instruction files `CODE1.CPP`-`CODE8.CPP` contain no direct store into `memory[]`; there is no "supervisor" or "internal" bypass in the core.

**Display.** The Stack window draws a byte in red when `InvalidMap && addr >= InvalidStart && addr <= InvalidEnd` (`Stack1.cpp:101`). The Memory window does not mark map ranges.

### 4.4 Quirks of the map that affect program behaviour

1. **The Protected check reads the GUI, not the CPU.** The supervisor test is `Form1->regSR->EditText[3] == '0'` (`UTILS.CPP:287, 469`): the third character (1-based) of the 16-character binary SR text box on the main window, which is bit 13. That text is written by `scrshow()` (`STARTSIM.CPP:157-166`) and by the user typing in the box, and `scrshow()` is called only on trace/halt (`RUN.CPP:705`), first STOP (`RUN.CPP:900`), STOP without exceptions (`RUN.CPP:956`), Pause (`SIM68Ku.cpp:534`), `initSim()` (`STARTSIM.CPP:70`), hardware Reset (`hardwareu.cpp:789`) and input completion in trace mode (`simIOu.cpp:1369`). During a full-speed Run the text is frozen at the value it had when Run was pressed. A program that drops to user mode during a Run can still access Protected memory, and a program started in user mode faults in Protected memory even inside its exception handlers, until something calls `scrshow()`. When single-stepping the display is refreshed after every instruction, so the check then follows the real S bit of the *previous* instruction boundary. The port must model a "displayed SR" snapshot that is updated at exactly these points.
2. **Order of checks** is Hardware, (out of range), Invalid, Protected, Read, ROM - as the help says (`HELP\SIMHELP\Hardware.htm:80-81`).
3. **Recursion hazard - vector 8 in a faulting range.** With exceptions enabled, the bus-error path fetches the vector with `mem_req(0x8, ...)` before doing anything else. If address 8 is itself inside an enabled Invalid range (or inside a Protected range while the displayed S bit is 0), that fetch faults again and recurses without limit. (With exceptions disabled there is no recursion: the first fault halts.) This is not exotic: the help screenshot itself shows `Protected: 000000 - 000400` enabled, i.e. the vector table protected. With that map, single-stepping user-mode code (displayed S = 0) into *any* exception - a TRAP #n, an interrupt, a divide by zero - makes the vector fetch fault, and the bus-error vector fetch then recurses for ever; during a full-speed Run started in supervisor mode the same program works, because the displayed S bit stays 1 (item 1). In the original the recursion ends in a stack overflow, presumably caught by the `catch(...)` in `exec_inst` when it started there (message box `ERROR: An exception occurred in routine 'exec_inst'.`, `RUN.CPP:1008-1014`). UNVERIFIED: the exact visible outcome on Windows. Port note: under Emscripten the recursion overruns the small linear-memory stack of the compiled core long before the JavaScript engine reports call-stack exhaustion, silently corrupting static data unless stack-overflow checking is enabled; put a depth guard on the bus-error path that turns the runaway into a clean, reported stop.
4. **Recursion hazard - supervisor stack in a faulting range.** Because exception frames are pushed through `mem_put` (3.3), an exception taken while the SSP points into a Read or Invalid range (or a Protected range with displayed S = 0) faults on its first push; the nested `exceptionHandler(0, ...)` lowers `A[8]` by another 4 and faults again, and so on. `A[8]` falls by 4 per level, so the nesting ends only when the SSP leaves the range (or goes negative, which produces the `SSP odd or outside memory space` message). Each nested level adds 50 cycles and, once the innermost push succeeds, the levels unwind and each completes the rest of its own 14-byte frame below the range, leaving a pile of partial frames. Where execution continues depends on the caller: `irqHandler` loads the interrupt vector *after* `exceptionHandler` returns, so an interrupt still enters its own handler; for traps and for bus/address errors the vector was loaded *before* the pushes, so PC ends up holding the bus-error vector. Worked example: a 16-byte Read range immediately below the SSP and one IRQ give four nested faults, 200 extra cycles, the interrupt handler entered, and an SSP 62 bytes below its starting value. A range of N bytes below the SSP gives about N/4 nested calls - enough to overflow the native stack for ranges of a few hundred kilobytes. If the stack is inside a ROM range nothing recurses; the frame is simply not written and the handler's RTE pops whatever was there before.
5. A zero-length buffer (`bytes == 0`) placed exactly at a range start is not flagged, because `loc+bytes-1` is then `Start-1`.

---

## 5. Form inventory and logical layout

Top to bottom, as the user sees it (compare `HELP\SIMHELP\IMAGES\Hardware\hardware.png`):

**Row 1 - 7-segment display.** Black panel with eight red digits (2.2). To its right: bold label `Address:`, then `[00][E00000]` (`seg7addr`).

**Row 2 - LEDs.** Grey panel with eight round LEDs (2.3). To its right: `Address:`, `[00][E00010]` (`LEDaddr`).

**Row 3 - bit labels and toggle switches.** Labels `7 6 5 4 3 2 1 0`, then eight rocker switches (2.4). To the right: `Address:`, `[00][E00012]` (`switchAddr`).

**Row 4 - push buttons.** Eight square grey buttons (2.5). To the right: `Address:`, `[00][E00014]` (`pbAddr`).

**Row 5 - three maroon group boxes side by side** (white bold captions):

1. ` Interrupt ` (`GroupBox1`): labels `7 6 5 4 3 2 1` left to right; under them buttons `IRQ7Btn` .. `IRQ1Btn`; under each button a caption-less checkbox `CheckBox7` .. `CheckBox1`; under those the centred label `Automatic Enabled` / `Automatic Disabled`.
2. `Auto Interval` (`GroupBox3`): eight-digit edit `IRQinterval` followed by `mS`; below it the combo box `AutoIRQ` followed by ` IRQ`.
3. `Reset` (`GroupBox2`): one button `ResetBtn`.

**Row 6 - grey group box `Memory Map`** (`GroupBox4`): described in 4.1.

Complete control table (every component in `hardwareu.h:20-197` / the DFM):

| Control(s) | Type | Caption / text | Default | Effect |
|---|---|---|---|---|
| `Panel2`, `seg7a..seg0h` (64 shapes) | panel + shapes | - | all red at design time | 7-segment display, output only |
| `Panel1`, `LED7..LED0` | panel + shapes | - | all red at design time | LEDs, output only |
| `Label8..Label1` | labels | `7`..`0` | - | bit column headers |
| `switch7..switch0` | bitmap buttons | (hidden); glyph `toggleswitch.bmp` | off | toggle switches, 2.4 |
| `pb7..pb0` | bitmap buttons | none; glyph `pushbutton3.bmp` | released | push buttons, 2.5 |
| `Label9, Label10, Label11, Label21` | labels | `Address:` | - | headings of the four address fields |
| `MaskEdit9..MaskEdit12` | read-only edits | `00` | `00` | decoration |
| `seg7addr`, `LEDaddr`, `switchAddr`, `pbAddr` | masked edits | - | `E00000`, `E00010`, `E00012`, `E00014` | device addresses, 2.1 |
| `GroupBox1` | group | ` Interrupt ` | - | container |
| `Label19..Label13` | labels | `7`..`1` | - | IRQ level headers |
| `IRQ7Btn..IRQ1Btn` | speed buttons | glyph only (`pushbutton2glyphs.bmp`, enabled / disabled halves) | enabled | request IRQ n, 3.2 |
| `CheckBox7..CheckBox1` | checkboxes | none | unchecked | arm auto timer n, 3.6 |
| `AutoLbl` | label | `Automatic` at design time | `Automatic Enabled` after startup | shows master flag |
| `GroupBox3` | group | `Auto Interval` | - | container |
| `IRQinterval` | masked edit | - | `00001000` (1000 ms) | interval of the selected level |
| `Label20` | label | `mS` | - | unit |
| `AutoIRQ` | combo box | - | `1` (items `1`..`7` and one empty item) | selects the level whose interval is shown/edited |
| `Label12` | label | ` IRQ` | - | - |
| `GroupBox2` | group | `Reset` | - | container |
| `ResetBtn` | speed button | glyph only (same glyph as the IRQ buttons) | enabled | hardware reset, 3.8 |
| `GroupBox4` | group | `Memory Map` | - | container |
| `Label22`, `Label24` | labels | `Start:`, `End:` | - | column headers |
| `Label23, Label25, Label26, Label27` | labels | `ROM:`, `Read:`, `Protected:`, `Invalid:` | - | row names |
| `Label28..Label31` | labels | `Writes are ignored`, `Bus error on write`, `Supervisor access`, `Bus error on access` | - | row explanations |
| `ROMChk, ReadChk, ProtectedChk, InvalidChk` | checkboxes | none | unchecked | enable the map type, 4.1 |
| `ROMStartEdit, ROMEndEdit, ReadStartEdit, ReadEndEdit, ProtectedStartEdit, ProtectedEndEdit, InvalidStartEdit, InvalidEndEdit` | masked edits | - | `000000` | range bounds, 4.1 |
| `MaskEdit2, 3, 5, 7, 13, 15, 17, 19` | read-only edits | `00` | `00` | decoration |
| `IRQ1timer..IRQ7timer` | timers | - | disabled, 1000 ms | auto interrupts, 3.6 |

There are no menus, no pop-up menus, no hints and no shortcuts on the form itself.

Keyboard handling on the form (`FormKeyDown` with `KeyPreview`, `hardwareu.cpp:1326-1333`): F1 opens help topic `HARDWARE` (context id `IDH_SIM_HARDWARE` = 1120, `help.cpp:119`, `ez68k.h:118`); Ctrl+Tab calls `BreaksFrm->BringToFront()`. `THardware::BringToFront()` (`hardwareu.cpp:1336-1342`) focuses the form if it is visible and otherwise passes on to `BreaksFrm`; it is the target of Ctrl+Tab from the Stack window (`Stack1.cpp:173, 182`).

Tab order: `seg7addr`, `LEDaddr`, `switchAddr`, `pbAddr`, `switch0`..`switch7`, `pb0`..`pb7`, Auto Interval group (`IRQinterval`, `AutoIRQ`), Interrupt group (`CheckBox1`..`CheckBox7`), Memory Map group (ROM start, ROM end, Read start, Read end, Protected start, Protected end, Invalid start, Invalid end, then the four checkboxes). The IRQ and Reset speed buttons cannot take focus **(VCL)**.

Interactive controls use the hand cursor (`crHandPoint`): switches, push buttons, IRQ buttons, Reset, and the whole Interrupt group box.

---

## 6. TRAP #15 tasks that query or configure hardware

Task number is in D0.B (`switch ((char)D[0])`, `CODE9.CPP:732`).

**Task 32 - Hardware / simulator** (`CODE9.CPP:906-936`); sub-task in D1.B:

| D1.B | Action | Code |
|---|---|---|
| 0 | `Hardware->Show();` If the form was hidden this runs `FormShow`, which zeroes the switch byte (2.4). | `CODE9.CPP:909-911` |
| 1 | `D[1] = StrToInt("0x" + Hardware->seg7addr->EditText);` | `:912-914` |
| 2 | D1.L = LED address | `:915-917` |
| 3 | D1.L = toggle-switch address | `:918-920` |
| 4 | `D[1] = VERSION;` = `0x00051001` for v5.16.1 (`def.h:24`) | `:921-923` |
| 5 | `exceptions = true; Form1->ExceptionsEnabled->Checked = true; Form1->SaveSettings();` (writes the settings file). Takes effect for the exception/IRQ processing at the end of this same TRAP instruction (3.3). There is no sub-task that turns exceptions off again. | `:924-928` |
| 6 | `Hardware->setAutoIRQ((uchar)D[2], D[3]);` - D2.B selector, D3.L interval in ms (3.6) | `:929-931` |
| 7 | D1.L = push-button address | `:932-934` |
| other | nothing | |

All of D1.L is replaced by sub-tasks 1, 2, 3, 4 and 7. The comment block in the source (`CODE9.CPP:346-358`) omits sub-task 7; the help page lists it (`HELP\simio.htm:72`).

**Tasks 60 and 62** arm mouse and keyboard interrupts whose delivery goes through `Hardware->IRQprocess` (3.2). They are implemented at `CODE9.CPP:1066-1076` and `1131-1139` and belong to the peripheral-I/O specification.

There is no task that reads or writes the memory map, the switch or button state, or the Reset button.

---

## 7. Timing

**Timers on the form.** Only the seven auto-IRQ `TTimer`s (3.6). Default interval 1000 ms, user range 0-99999999 ms, 0 = never. **(VCL / Win32)** `TTimer` is a Win32 `SetTimer` on a hidden window, so:

- Ticks are `WM_TIMER` messages delivered only when the message loop runs; they are the lowest-priority message and at most one is pending per timer. There is no catch-up burst after a blocked period.
- Windows clamps intervals below 10 ms up to 10 ms and quantises to the system tick (typically 15.6 ms). An interval of "1" therefore yields roughly 64-100 interrupts per second on real EASy68K, not 1000.

**Where the message loop runs during execution.** Exactly three places in the simulator:

1. `TForm1::runLoop()`: `while(runMode){ runprog(); Application->ProcessMessages(); }` (`SIM68Ku.cpp:256-259`).
2. `runprog()`, right after `exec_inst()`: `do { Application->ProcessMessages(); if(inputMode) Sleep(10); } while (inputMode && runMode);` (`RUN.CPP:644-650`).
3. TRAP #15 task 23 delay: `while(n-- > 0 && runMode) { Application->ProcessMessages(); Sleep(10); }` (`CODE9.CPP:879-885`).

Modal dialogs and message boxes opened during execution also pump messages.

So in a full-speed run the queue is drained twice per instruction, and every hardware-window event (switch click, button press, IRQ click, timer tick, Reset, address or map edit) is processed **between** instructions, never inside one. All of them see and modify a consistent CPU state.

**Latency of an interrupt.** Request latched in a message pump after instruction k; recognised at the end of instruction k+1 (3.3). Requests arriving during a task-23 delay are latched during the TRAP and recognised when the TRAP instruction ends. Requests arriving while the program waits for keyboard input are latched and recognised after the first instruction that follows the input.

**Cycle accounting.** +44 per accepted request, +34 per serviced interrupt, +40 (+44) for Reset. The cycle counter is visible to programs through TRAP #15 task 31.

**Painting.** `update()` only assigns colours; pixels change at the next message pump. Push-button and switch handlers additionally force `MemoryFrm->Repaint()` and `StackFrm->Repaint()`.

---

## 8. Hardware state across simulator events

| Event | Memory | Switch byte | Switch pictures | PB byte | `irq` | `stopInstruction` | `hardwareEnabled` | Auto checkboxes | `autoIRQ` | Memory map | Device addresses |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Application start | all `0xFF` | `0xFF`, or `0x00` if the form is shown by settings | off | `0xFF` | 0 | false | true | unchecked | true | off, zeros | from `sim68K.dat` or defaults |
| Open / Reload file | refilled `0xFF`, then S-record | `0x00` (before S-record data) | off | `0xFF` (fill) | 0 | false | true | **unchecked** | **false** | kept, plus S0 records | kept |
| Reset Program (Rewind), Close file | kept | kept | kept | kept | 0 | false | true | kept | **true** | kept | kept |
| Run / Run To Cursor | - | - | - | - | kept | kept | kept | kept | true | - | - |
| Pause | - | - | - | - | kept | kept | kept | kept | false | - | - |
| Single step / breakpoint stop | - | - | - | - | kept | kept | kept | kept | false unless `stopInstruction` | - | - |
| SIMHALT / task 9 / fatal error with exceptions off | - | - | - | - | kept | kept | **false** | kept | false | - | - |
| STOP with exceptions on | - | - | - | - | kept | **true** | kept | kept | kept | - | - |
| Hardware Reset button | - | - | - | - | **kept** | false | kept | kept | kept | - | - |
| Hardware window shown (was hidden) | - | **`0x00`** | **kept** | - | - | - | - | - | - | - | - |

"-" means not touched. `initSim()` is `STARTSIM.CPP:33-127`; `OpenFile` is `SIM68Ku.cpp:270-363`; `RewindExecute` is `SIM68Ku.cpp:542-549`.

Notes on the table: Reset Program does not reload memory (it only restores PC to the load-time start address and calls `initSim()`), so device bytes, the switch byte and anything the program wrote survive it. "Run" sets `autoIRQ` true but leaves `hardwareEnabled` as it is, so Run after SIMHALT (via Pause) executes with the hardware still disabled (3.7). `initSim()` also zeroes the keyboard and mouse IRQ levels of TRAP #15 tasks 60/62 (`STARTSIM.CPP:116-120`).

Startup detail: `TForm1::FormShow` calls `LoadSettings()` then `initSim()` (`SIM68Ku.cpp:1209-1210`). `LoadSettings()` first applies `defaultSettings()` and then the file, assigning the four address `Text`s, which fires the four `OnChange` handlers and so sets `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc` and (once) `memory[pbLoc] = 0xFF`. Until that moment all four globals are 0.

---

## 9. Port hazards and order-dependent behaviour

### 9.1 Structural hazards

1. **The core reads GUI controls.** `memoryMapCheck` and `mem_req` read `Form1->regSR->EditText[3]`; TRAP #15 task 32 reads `Hardware->seg7addr->EditText` etc.; `OpenFile` reads `Hardware->switchAddr->EditText`; `loadSrec` writes `Hardware->ROMChk->Checked` and `...Edit->EditText` and depends on the controls' change events to set the real globals. The WebAssembly build needs replacements for all of these that keep the same values *and the same update moments* (especially the displayed-SR snapshot, 4.4 item 1).
2. **Side effects hidden in control events.** Checkbox `OnClick` firing on programmatic change (timer arming in `setAutoIRQ`, timer disarming in `initialize()`, `...Map` flags in `loadSrec`); `OnChange` firing on programmatic text change (device addresses at startup, map ranges in `loadSrec`, interval echo in `setAutoIRQ`); `OnShow` zeroing the switch byte. A shim that only stores properties will silently lose these.
3. **Re-entrancy model.** `IRQprocess` and `ResetBtnClick` are called from inside `ProcessMessages`, which is called from inside `runprog`, and they may call `runLoop()` (guarded) themselves. When the simulator is idle, the whole subsequent program run executes *inside* the click or timer handler. A browser cannot nest event loops; the port needs an explicit "between instructions" event queue with the same ordering: instruction, then events, then (in `runprog`) breakpoint and halt processing.
4. **Atomicity.** If the core runs on a worker and the UI pokes shared memory, switch and push-button read-modify-write operations (`|=`, `&=`) and Reset's register writes could interleave with an instruction. In the original they cannot. Marshal them to instruction boundaries.
5. **Timers.** A JavaScript timer cannot fire while a WebAssembly slice is executing, has different clamping rules, and may be throttled in background tabs. The auto-IRQ timers need a clock check at instruction boundaries (or at slice boundaries, see 9.2) and a decision on emulating the Windows 10 ms / 15.6 ms floor (open question).
6. **Standard-C++ compile errors in the reference code within this scope:** `static const SWITCH_ADDR = 0xE0000A;` (no type, `hardwareu.cpp:25`); `memoryMapCheck(Invalid | Protected | Read | Rom, ...)` and the other OR-ed calls pass an `int` where `enum maptype` is expected (`UTILS.CPP:372`, `CODE9.CPP:1016`, `simIOu.cpp:2331`) - legal in Borland C++, an error in Clang.
7. **Out-of-bounds accesses that happen to be harmless on Windows:** the 7-segment over-read of up to 6 bytes (2.2); and, in the core, a long access at `0xFFFFFE` (after 24-bit masking), which reads or writes 2 bytes past the 16 MB array (`UTILS.CPP:388-391, 490-491`). Allocate slack after the array rather than "fixing" the semantics.
8. **Unbounded or very deep recursion** when the bus-error vector, or the supervisor stack, lies in a faulting range (4.4 items 3 and 4).
9. **`memory` is `char`.** Device code casts to `unsigned char` before testing bits (`hardwareu.cpp:227, 511`). Keep the casts if the element type stays signed.
10. **Signed/unsigned comparisons** with `MEMSIZE` (`const uint`): `seg7loc < MEMSIZE-8`, `adr < MEMSIZE`, `loc > MEMSIZE-1` are all unsigned compares; a negative `int` compares as very large.
11. **Register-versus-memory test by address.** `put()` and `value_of()` decide whether a pointer is a 68000 register or simulated memory with `(int)dest >= (int)&D[0] && (int)dest < (int)&inst` (`UTILS.CPP:583, 615`), relying on the globals `D, A, PC, SR, global_temp, OLD_PC, EA1, EA2, EV1, EV2, source, dest, result, inst` being laid out contiguously in declaration order (`var.h:38-53`, which says so in a comment). Clang/Emscripten does not promise that order for separate globals. Every exception-frame push and every memory-map check on a write depends on this test, so the port must pin the layout (for example one struct) rather than trust it.
12. **Events while halted.** In the original a request that arrives while the simulator is idle or halted comes from the application's normal message loop and enters a fresh `runLoop()`; only a request that arrives inside the pump of a still-running `runprog()` meets the re-entrancy guard (9.2 item 2). A port that funnels all UI and timer events through one "between instructions" queue must keep the two cases apart, or every wake-up from STOP will be lost.

### 9.2 Races and order dependence in the original

These are real behaviours of EASy68K. The compiled core reproduces the logic, but how often each case occurs depends on how the port interleaves events with instructions. The original interleaves after **every** instruction.

1. **IRQ latched just before STOP.** If a request arrives in the message pump immediately before the STOP instruction executes and STOP's new SR unmasks it, `irqHandler()` runs inside the STOP step (PC = handler, mask = that level) and then the `STOP_TRAP` case halts the simulator anyway (`RUN.CPP:878-902`). The handler has not run. Later requests of the same or lower level are now masked, and because `stopInstruction` is true `IRQprocess` returns early for them, so a program driven by a single auto-IRQ level stays halted until a higher level arrives or the user intervenes (Pause then Run).
2. **IRQ latched just after STOP.** If the request arrives in the message pump that follows the STOP step (the one inside the same `runprog()` call, `RUN.CPP:646-650`), `IRQprocess` sets `runMode` and calls `runLoop()`, which returns immediately (guard), and `runprog()` then executes `if (trace || halt) runMode = false;` (`RUN.CPP:697-698`). The wake-up is lost; the bit stays latched; the program resumes only on the next request (any request then passes the STOP filter, because the latched bit is unmasked). A request that arrives one pump later - in `runLoop()`'s own `ProcessMessages` after `runprog()` has returned (`SIM68Ku.cpp:258`) - is *not* lost: `IRQprocess` sets `runMode` again, the nested `runLoop()` returns at the guard, and the outer `while(runMode)` simply carries on.
3. **IRQ coinciding with a trapping instruction.** In `exec_inst` the IRQ is processed before the second `switch (exec_result)`. If the instruction also raised TRAP (other than a handled TRAP #15), divide-by-zero, CHK, TRAPV, Line-A or Line-F, `irqHandler()` pushes a frame, raises the mask and loads the IRQ vector, and then the trap case pushes a second frame with the *same* `OLD_PC` and overwrites PC with the trap vector (`RUN.CPP:878-931`). The interrupt handler never runs, its request bit is already cleared, a 6-byte frame is left on the stack, and because the second frame holds the SR as `irqHandler` left it, the trap handler's RTE returns with the mask still raised and S still set - even if the trap came from user mode. Likewise, for an illegal or privileged instruction the first switch has already pushed a frame and loaded its vector before the IRQ overrides PC.
4. **Auto-IRQ after Reset Program** starting the program without the user pressing Run (3.6).
5. **Input completion in trace mode** re-enabling hardware and the auto timers (`simIOu.cpp:1366-1368`), which can then start a full-speed run through `IRQprocess` only if `trace` is false; while `trace` stays true the ticks just latch bits and add 44 cycles each.
6. **Protected-map decisions** depend on when `scrshow()` last ran (4.4 item 1), hence on whether the user is stepping or running.
7. **Switch picture versus switch byte** depends on the order of user clicks, program writes, window show/hide and address-field focus changes (2.4).
8. **Push-button release without press** (window loses focus while a key or mouse button is held, so the up event is never delivered): the bit stays 0. UNVERIFIED how Windows resolves each such case; a port should guarantee a release on pointer cancel / blur.
9. **Typing an address digit by digit** makes each intermediate value the live address. For 7-segment and LED fields this only changes what is displayed; for the switch field every keystroke also resets the switch pictures; committing (Enter or focus loss) writes `0x00` (switches) or `0xFF` (push buttons) into whatever byte is then addressed, which may be program code or data.
10. **Memory-map edits while running** take effect at the next instruction, including half-typed ranges.
11. **Run pressed during an IRQ-started run.** A run started by `IRQprocess` or the Reset button does not call `setMenuTrace()`, so Run, Step and Trace stay enabled on the main window while the program is executing. Pressing Run then executes `loadRegs()` (`SIM68Ku.cpp:441-455, 990-1020`), which overwrites the live registers, SR and PC with whatever the register boxes last displayed, and the nested `runLoop()` call returns at once. The program continues from the stale displayed PC.

---

## 10. Help text versus source

| Topic | Help says | Source does | Citation |
|---|---|---|---|
| MEMORY syntax | `[label] MEMORY type startAddress,endAddress` | A label raises `LABEL_ERROR` ("Label is not allowed"), and because that error is severe the range is not recorded at all | `HELP\Directives\memory.htm:50-51`; `EDIT\DIRECTIV.CPP:917-918, 954-955` |
| MEMORY ROM | "Memory may be read or written but the writes have no effect" | Agrees: a write that touches the range is dropped whole (also the part outside the range) and the instruction reports success | `HELP\Directives\memory.htm:31-33`; `UTILS.CPP:315-318, 375-376` |
| MEMORY addresses | "must evaluate to a valid 24 bit address" | Silently masked with `0x00FFFFFF`, no error | `HELP\Directives\memory.htm:55-56`; `EDIT\DIRECTIV.CPP:974-987` |
| Protected | Access allowed "only if the Supervisor bit in the Status Register is set" | Uses the S bit of the *displayed* SR text, stale during a Run | `HELP\SIMHELP\Hardware.htm:74-76`; `UTILS.CPP:287, 469` |
| Invalid | "Any access results in a Bus error" | Reads test only the first byte of the access; hardware addresses are exempt; loader, Memory window and device pokes are exempt | `HELP\SIMHELP\Hardware.htm:77-78`; `UTILS.CPP:448-465` |
| Bus error | "can occur ... by attempting to read or write outside of the virtual memory space" | Addresses are masked to 24 bits first, so that never happens from CPU accesses; bus errors come only from the memory map | `HELP\SIMHELP\Exceptions.htm:26-29`; `UTILS.CPP:369, 445` |
| Interrupt buttons | "Pressing each button generates the corresponding interrupt request" | Also adds 44 cycles and starts the program if it is not in trace mode; nothing is taken unless Enable Exceptions is on | `HELP\SIMHELP\Hardware.htm:45-49`; `hardwareu.cpp:757-775`; `RUN.CPP:862` |
| Auto interval | "selecting the desired interrupt ... entering the interval ... Checking the checkbox ... enables auto interrupts" | Additionally gated by the master flag `autoIRQ`, shown as `Automatic Enabled/Disabled` | `HELP\SIMHELP\Hardware.htm:50-54`; `hardwareu.cpp:1346-1392` |
| Reset | "simulates a hardware reset" | Does not clear pending IRQs or anything but SR bits, SSP, PC | `HELP\SIMHELP\Hardware.htm:55`; `hardwareu.cpp:778-792` |
| Task 32/6 interval | source comment: "1 through 99999999" | Not range-checked | `CODE9.CPP:358`; `hardwareu.cpp:872-899` |
| Task 32/7 | listed in help | missing from the source comment block, present in code | `HELP\simio.htm:72`; `CODE9.CPP:932-934` |
| Toggle switches | "write a 1 ... when the switch is on, write a 0 when off" | True per click; the byte is also zeroed by window show, file open and address commit without moving the switches | `HELP\SIMHELP\Hardware.htm:38-39`; 2.4 |

Agreements worth recording: digit-to-address table, active-low push buttons, check order "Hardware, Invalid, Protected, Read, ROM", the autovector addresses `$064`-`$07C`, 24-bit address wrap.

---

## 11. Reference model (pseudo-code summary of the form's logic)

This restates sections 2-4 in one place for implementers. It is a description of the original, not product code.

```
state:
  seg7loc, LEDloc, switchLoc, pbLoc            (ints; defaults E00000/E00010/E00012/E00014)
  switchOn[0..7]            (picture state)    default false
  autoChecked[1..7]                            default false
  autoInterval[1..7]        (ms)               default 1000
  autoIRQ (master)                             false at create, true after initSim
  hardwareEnabled                              true
  pbInit                                       false
  ROM/Read/Protected/Invalid: {enabled=false, start=0, end=0}
  irq (bit n-1 = level n), stopInstruction, hardReset   (core globals)
  displayedSR               (snapshot updated only where scrshow() or a user edit updates regSR)

timer n runs  <=>  timer-enabled[n], where timer-enabled[n] is assigned only by:
  autoIRQon():   enabled[n] = autoChecked[n] for all n; autoIRQ = true
  autoIRQoff():  enabled[n] = false for all n;          autoIRQ = false
  checkbox n changes (by user or by code): if autoIRQ then enabled[n] = autoChecked[n]
  setAutoIRQ(1..7): enabled[n] = false

requestIRQ(n):                         # IRQprocess
  if !hardwareEnabled: return
  if n > 0: irq |= 1 << (n-1)
  if stopInstruction and (irq & maskFor(SR)) == 0: return
  cycles += 44
  if !trace: runMode = true
  if runMode: enter run loop unless already inside it

after each instruction whose opcode fetch succeeded, if exceptions:  # exec_inst
  if irq & maskFor(SR):                 # maskFor(SR) = (0xFF80 >> (7 - level)) | 0x40
     push OLD_PC (long), push SR (word) on SSP; S=1; T=0
        # pushes are mem_put writes: 24-bit masked, memory map applies, display refresh
     n = highest set bit of irq + 1; SR.mask = n; PC = long at 0x60 + 4n   # mem_req: map applies
     irq &= ~(1 << (n-1)); cycles += 34

resetButton():                          # ResetBtnClick
  if !hardwareEnabled: return
  SR |= S; SR &= ~T; SR |= 0x0700
  SSP = long at 0; PC = long at 4       # mem_req: map applies
  cycles += 40; stopInstruction = false; refresh displayed registers (displayedSR)
  requestIRQ(0)

hardware disable():  autoIRQoff(); hardwareEnabled = false   # SIMHALT, task 9, STOP or bus/address error with exceptions off
hardware enable():   autoIRQon();  hardwareEnabled = true    # initSim, input completed while trace
```

---

## 12. Claims that rest on VCL / Win32 behaviour, and other UNVERIFIED items

No VCL source is in the reference tree. The following claims come from knowledge of Borland VCL 6 and Win32, not from files that could be cited. Where the help screenshot corroborates a claim this is stated.

| # | Claim | Status |
|---|---|---|
| V1 | `EditMask 'aaaaaa;0;0'`: blank character is `'0'`; `EditText` is always 6 characters; partial entry is right-padded with zeros | Corroborated by screenshot (`00`/`E00000`, `000400`) and by `regSR` using the same pattern (`SIM68Ku.dfm:735`). Exact keystroke-level editing behaviour UNVERIFIED |
| V2 | `IRQinterval` design text `'    1   '` with mask `'!99999999;1;0'` reads as `00001000` | Corroborated by screenshot (`00001000`) |
| V3 | `TTimer.Interval` defaults to 1000 ms; interval 0 never fires; changing the interval of an enabled timer restarts it; setting `Enabled` to its current value does nothing | Default corroborated indirectly by V2; rest UNVERIFIED against VCL source |
| V4 | Assigning `TCheckBox.Checked` from code fires `OnClick` when the state changes | Not verifiable here, but the original only works if true (`SIMOPS2.CPP:263` sets `ROMMap` no other way) |
| V5 | Assigning `Text` / `EditText` from code fires `OnChange` when the text changes; no event if unchanged | Same reasoning (`SIM68Ku.cpp:1518` is the only thing that sets `seg7loc`) |
| V6 | `OnShow` fires on every hidden-to-visible transition and `Visible` is already true inside it; `Show()` on an already visible form does not fire `OnShow` again (it only raises the window) | UNVERIFIED against VCL source |
| V7 | `Layout = blGlyphLeft/blGlyphRight` on a 29-px button with a 54-px glyph shows the left/right half; captions are clipped | Corroborated by screenshot (no captions, two switch looks) and by the embedded glyph being the 54 x 44 `toggleswitch.bmp` (which is not a whole multiple of its height wide, so it is treated as one image) |
| V8 | Win32 timer floor of 10 ms, tick quantisation, `WM_TIMER` coalescing and low priority | Win32 documentation, not in tree |
| V9 | `TSpeedButton` cannot take focus; push buttons capture the mouse so mouse-up arrives when released outside | UNVERIFIED |
| V10 | The combo box is the default editable drop-down style, so its text can be typed; typing leaves no item selected | UNVERIFIED |
| V11 | Assigning a short decimal string to `IRQinterval->Text` (mask `'!99999999;1;0'`) right-justifies it and fills the left with the blank character `'0'`, so `250` reads back as `00000250` | UNVERIFIED against VCL source, but the original only works if true: `setAutoIRQ` echoes the interval through this field for the selected level (level 1 by default) and the change event writes the field back into the timer; left-justified padding would turn 250 ms into 25000000 ms. Consistent with V2 |
| V12 | `OnExit` of an edit fires when focus moves to another focusable control on the same form, not when a non-focusable speed button is clicked and not when another window is activated | UNVERIFIED |
| V13 | A timer's first tick comes one interval after it is enabled; disabling and re-enabling restarts the period | Win32 `SetTimer` behaviour, not in tree |

Other UNVERIFIED items:

- U1. Result of `setAutoIRQ` with an interval above 99999999 (3.6). It can only matter when the level being set is the one selected in the combo box, because only then is the value echoed through the eight-digit field.
- U2. Visible outcome of the bus-error-vector recursion on Windows (4.4 item 3).
- U3. Whether pasting non-hex alphanumerics into an address field (possible through the context menu, since the mask accepts any alphanumeric) raises a conversion error dialog. The code path `StrToInt("0x" + EditText)` has no guard. Keyboard paste with Ctrl+V is blocked, because `addrKeyPress` swallows every character that is not a hex digit, control characters included.
- U4. Backspace in an address field: `addrKeyPress` beeps on character 8; whether the deletion still happens depends on VCL mask-edit internals.
- U5. Whether a key-up delivered to a push button whose key-down went elsewhere (focus moved onto the button with Tab or an arrow key while the key was held) reaches `pbNKeyUp`. If it does, it sets that button's bit to 1, which is visible only when the program had written 0 there.

---

## 13. Conformance checklist

Each item is a test the port should pass. "Exc on" means Enable Exceptions checked.

Devices
1. After loading any program with the window visible, all 64 segments and 8 LEDs are lit; byte at `$E00012` reads `$00`; byte at `$E00014` reads `$FF`.
2. `MOVE.B #$3F,$E00000` lights segments a-f of the leftmost digit; `MOVE.B #$80,$E0000E` lights only the rightmost decimal point; `MOVE.W #$0600,$E00002` shows "1" on the second digit and leaves `$E00003` = `$00`.
3. `MOVE.B #$A5,$E00010` lights LEDs 7, 5, 2, 0 (leftmost is bit 7).
4. Clicking switch 3 sets bit 3 of `$E00012`; clicking again clears it; other bits are untouched.
5. Program writes `$FF` to `$E00012`: the byte reads `$FF`, switch pictures do not move; clicking a switch drawn off sets its (already set) bit and draws it on; clicking again clears the bit.
6. Hide and re-show the window with a switch on: byte becomes `$00`, the picture stays on, the next click on it leaves the bit 0 and draws it off.
7. Holding push button 2 makes `$E00014` read `$FB`; releasing restores `$FF`. After the program writes `$00` there, pressing and releasing button 2 yields `$04`.
8. A write to a hardware address inside an enabled ROM, Read, Protected or Invalid range still succeeds.
9. Changing the 7-segment address to `100000` makes digits follow `$100000`, `$100002`, ...; TRAP #15 task 32/1 returns `$00100000`.
10. Task 32 sub-tasks 1, 2, 3, 7 return `$00E00000`, `$00E00010`, `$00E00012`, `$00E00014` by default; sub-task 4 returns `$00051001`.

Interrupts
11. Exc off: clicking IRQ 3 on a loaded, idle program starts it running, adds 44 cycles, and no handler is entered.
12. Exc on, mask 0, vectors installed: clicking IRQ n enters the handler at the long stored at `$60+4n` after one more instruction, with SR mask = n, S = 1, T = 0, and a 6-byte frame (SR word at SP, return PC at SP+2). Cycle counter rises by 78 plus the instruction.
13. With mask 3, IRQ 2 is held pending and is taken right after an instruction that lowers the mask below 2; IRQ 7 is taken at mask 7.
14. Two pending levels are serviced highest first; the lower one is taken when the mask allows.
15. In trace mode an IRQ click runs nothing; stepping one instruction lands in the handler.
16. Auto IRQ: check box 1, interval 500, press Run: label reads `Automatic Enabled`, handler runs about twice a second. Pause: label reads `Automatic Disabled`, ticks stop.
17. Open a file: all seven boxes are unchecked and the label reads `Automatic Disabled`.
18. Check a box, Reset Program, wait: the program starts by itself at the first tick.
19. Task 32/6 with D2 = `$81`, D3 = 250 during a Run: box 1 checked, IRQ 1 every 250 ms. Task 32/6 with D2 = 0 followed by D2 = `$81`: box checked, **no** interrupts until the next Run.
20. `STOP #$2000` with Exc on halts with the message `STOP instruction. Execution halted`; an IRQ click resumes; the instruction after STOP executes before the handler; the stacked PC is that of the second instruction after STOP. A second STOP prints no message.
21. `STOP` with Exc off prints `STOP instruction executed at location ...`, disables the IRQ and Reset buttons (dark-maroon look), and IRQ clicks do nothing.
22. After SIMHALT the IRQ and Reset buttons are disabled and timers are off until Reset Program / Reload. Pause followed by Run continues the program with the label reading `Automatic Enabled` but with the buttons still disabled and no interrupt delivered.
23. Reset button with vectors `$0` = `$00010000`, `$4` = `$00002000`: SSP = `$00010000`, PC = `$00002000`, SR has S = 1, T = 0, mask = 7, cycles +84, D and A registers unchanged, pending `irq` bits unchanged; the program runs unless paused.
24. Fresh start, no file opened, hardware window shown: one click on any IRQ button halts immediately (SIMHALT at address 0) and leaves all IRQ buttons and Reset disabled until a file is opened or Reset Program is used.
25. Exc off, full-speed run stopped by `Illegal instruction found at location ...`: an IRQ click resumes execution after the offending word, although the Run command is disabled.
26. Exc off at start, mask 0, vectors installed: an IRQ is clicked while the program runs (latched, not taken) and the program later calls task 32/5. The pending interrupt is taken at the end of that TRAP #15, with the stacked PC pointing to the instruction after the TRAP.
27. Exc on, SSP inside an enabled ROM range: an IRQ enters its handler but the 6 stack bytes are unchanged. Exc on, a 16-byte enabled Read range ending immediately below the SSP: one IRQ still enters its own handler, 200 cycles are added on top of the usual 78, and the SSP ends 62 bytes below its starting value (4.4 item 4).

Memory map
28. `MEMORY ROM $2000,$2FFF` produces the record `S01A0000202020202020524F4D203030323030302C30303246464665` (data `      ROM 002000,002FFF`), placed after the data records and before S8; loading it checks ROM and shows `002000` / `002FFF`.
29. `MAP MEMORY ROM $2000,$2FFF` (a labelled line) reports `Label is not allowed` and produces **no** S0 map record; `MEMORY.W ROM $2000,$2FFF` reports `Invalid size code` and still produces the record.
30. ROM: a write to `$2000` is silently ignored and execution continues; a long write at `$1FFE` is ignored completely.
31. Read: a write raises a bus error (vector `$8` with Exc on; `Bus Error: Instruction at ... accessing address ...` and halt with Exc off); reads work.
32. Invalid: a read or write at an address in range raises a bus error; a long read starting 2 bytes below the range does not; a long write starting 2 bytes below does.
33. Protected: with the SR box showing S = 1 when Run is pressed, a program that switches to user mode can still access the range during that Run; single-stepping the same code raises the bus error.
34. Loading a second program without MEMORY directives leaves the first program's map enabled.
35. The S-record loader can place data inside ROM / Read / Invalid ranges.
36. The Stack window shows bytes of the enabled Invalid range in red.
37. Protected `000000`-`000400` enabled, Exc on, user-mode code single-stepped into a `TRAP #1`: the original recurses without limit in the bus-error path (4.4 item 3). The port must stop cleanly with an error report and remain usable; it must not hang, corrupt its state or silently deliver the trap.

---

## 14. Completeness pass

Enumerated mechanically from the sources (every `THardware::` definition, every `case` label, every global, every DFM `object` and `Caption`) and confirmed present above. Numbered families are written as ranges in the body of this document; Appendix A lists every identifier literally so that a text search for any one name finds it.

**Functions defined in `hardwareu.cpp`** (all `THardware::` members): constructor `THardware` (empty, `:37-40`); `initialize` (2.4, 3.6); `switch0Click`..`switch7Click` (2.4); `FormShow` (2.4); `updateIfNeeded`, `update` (2.7); `addrKeyPress` (2.1); `seg7addrChange`, `LEDaddrChange` (2.1, 2.7); `switchAddrChange`, `switchAddrExit`, `switchAddrKeyDown` (2.4); `pbAddrChange` (2.5); `addrKeyUp` (2.6); `IRQ1`..`IRQ7` (3.2); `IRQprocess` (3.1); `ResetBtnClick` (3.8); `autoIRQoff`, `autoIRQon` (3.6); `setAutoIRQ` (3.6); `disable`, `enable` (3.7); `IRQintervalChange`, `AutoIRQChange` (3.6); `pb0..pb7` x `KeyDown / MouseDown / KeyUp / MouseUp` (32 handlers, 2.5); `pbAddrKeyDown`, `pbAddrExit` (2.5); `FormCreate` (1.1); `FormKeyDown`, `BringToFront` (5); `CheckBox1Click`..`CheckBox7Click` (3.6); `ROMStartEditChange`, `ROMEndEditChange`, `ReadStartEditChange`, `ReadEndEditChange`, `ProtectedStartEditChange`, `ProtectedEndEditChange`, `InvalidStartEditChange`, `InvalidEndEditChange` (4.1); `ROMChkClick`, `ReadChkClick`, `ProtectedChkClick`, `InvalidChkClick` (4.1).

**`case` labels in `hardwareu.cpp`:** `setAutoIRQ` - `0x00`, `0x01`..`0x07`, `0x81`..`0x87` (3.6 table); `IRQintervalChange` - 0..6; `AutoIRQChange` - 0..6 (3.6).

**`case` labels for hardware in `CODE9.CPP`:** task `32` with sub-cases `00`..`07` (section 6); tasks `60`, `62` (referenced); task `9` (3.7).

**Globals and flags:** `Hardware`, `clDrkMaroon`, `SWITCH_ADDR`, `str1`, `seg7loc`, `LEDloc`, `switchLoc`, `pbLoc`, `pbInit`, `autoIRQ`, `hardwareEnabled`, `ROMStart`, `ROMEnd`, `ReadStart`, `ReadEnd`, `ProtectedStart`, `ProtectedEnd`, `InvalidStart`, `InvalidEnd`, `ROMMap`, `ReadMap`, `ProtectedMap`, `InvalidMap` (1.1); `irq`, `hardReset`, `stopInstruction`, `exceptions`, `trace`, `runMode`, `halt`, and the core variables the hooks read or write - `SR`, `PC`, `OLD_PC`, `A[8]`, `cycles`, `errflg`, `simhalt_on`, `inputMode`, `keyDownIRQ`, `keyUpIRQ`, `mouseDownIRQ`, `mouseUpIRQ`, `mouseMoveIRQ` (sections 3 and 4); assembler `mapROM`, `mapRead`, `mapProtected`, `mapInvalid` and their Start/End pairs (4.2).

**DFM components (179 objects):** form; `Label1`-`Label8`; `Label9`, `Label10`, `Label11`, `Label21`; `switch7`-`switch0`; `Panel1` + `LED7`-`LED0`; `Panel2` + 64 `seg??`; `seg7addr`, `LEDaddr`, `switchAddr`, `pbAddr`; `GroupBox1` + `Label13`-`Label19`, `IRQ7Btn`-`IRQ1Btn`, `AutoLbl`, `CheckBox1`-`CheckBox7`; `GroupBox2` + `ResetBtn`; `GroupBox3` + `Label20`, `Label12`, `AutoIRQ`, `IRQinterval`; `pb0`-`pb7`; `GroupBox4` + `Label22`-`Label31`, four checkboxes, eight range edits, `MaskEdit2, 3, 5, 7, 13, 15, 17, 19`; `MaskEdit9`-`MaskEdit12`; `IRQ1timer`-`IRQ7timer`. All appear in the section 5 table.

**Menu items:** the form has none. The only menu entry that concerns it is `Hardware1` (`&Hardware`) in the main window's View menu (1.2).

**External hooks:** every line returned by a search for `Hardware->`, the device-address globals, the map globals, `irq`, `hardReset` and `stopInstruction` across the simulator sources is listed in 1.3 or cited in sections 2-4. The three `ProcessMessages` call sites are listed in section 7.

---

## Appendix A. Literal identifier index

Generated from `hardwareu.cpp` and `hardwareu.dfm`. The number after each function is the line of its definition in `hardwareu.cpp`; the number after each component is the line of its `object` statement in `hardwareu.dfm`. The section in brackets is where the behaviour is specified.

### A.1 Member functions of `THardware` (93 definitions)

`THardware` :37 [1.1] | `initialize` :44 [2.4, 3.6] | `switch0Click` :66 [2.4] | `switch1Click` :82 [2.4]  
`switch2Click` :98 [2.4] | `switch3Click` :114 [2.4] | `switch4Click` :130 [2.4] | `switch5Click` :146 [2.4]  
`switch6Click` :162 [2.4] | `switch7Click` :178 [2.4] | `FormShow` :195 [2.4] | `updateIfNeeded` :204 [2.7]  
`update` :217 [2.7] | `addrKeyPress` :549 [2.1] | `seg7addrChange` :563 [2.1, 2.7] | `LEDaddrChange` :573 [2.1, 2.7]  
`switchAddrChange` :583 [2.4] | `switchAddrExit` :617 [2.4] | `switchAddrKeyDown` :627 [2.4] | `pbAddrChange` :642 [2.5]  
`addrKeyUp` :676 [2.6] | `IRQ1` :715 [3.2] | `IRQ2` :721 [3.2] | `IRQ3` :727 [3.2]  
`IRQ4` :733 [3.2] | `IRQ5` :739 [3.2] | `IRQ6` :745 [3.2] | `IRQ7` :751 [3.2]  
`IRQprocess` :757 [3.1] | `ResetBtnClick` :778 [3.8] | `autoIRQoff` :796 [3.6] | `autoIRQon` :811 [3.6]  
`setAutoIRQ` :831 [3.6] | `disable` :907 [3.7] | `enable` :923 [3.7] | `IRQintervalChange` :938 [3.6]  
`AutoIRQChange` :966 [3.6] | `pb0KeyDown` :994 [2.5] | `pb0MouseDown` :1003 [2.5] | `pb0MouseUp` :1012 [2.5]  
`pb0KeyUp` :1021 [2.5] | `pb1KeyDown` :1031 [2.5] | `pb1MouseDown` :1040 [2.5] | `pb1KeyUp` :1049 [2.5]  
`pb1MouseUp` :1058 [2.5] | `pb2KeyDown` :1068 [2.5] | `pb2MouseDown` :1077 [2.5] | `pb2KeyUp` :1086 [2.5]  
`pb2MouseUp` :1095 [2.5] | `pb3KeyDown` :1105 [2.5] | `pb3MouseDown` :1114 [2.5] | `pb3KeyUp` :1123 [2.5]  
`pb3MouseUp` :1132 [2.5] | `pb4KeyDown` :1142 [2.5] | `pb4MouseDown` :1151 [2.5] | `pb4KeyUp` :1160 [2.5]  
`pb4MouseUp` :1169 [2.5] | `pb5KeyDown` :1179 [2.5] | `pb5MouseDown` :1188 [2.5] | `pb5KeyUp` :1197 [2.5]  
`pb5MouseUp` :1206 [2.5] | `pb6KeyDown` :1216 [2.5] | `pb6MouseDown` :1225 [2.5] | `pb6KeyUp` :1234 [2.5]  
`pb6MouseUp` :1243 [2.5] | `pb7KeyDown` :1253 [2.5] | `pb7MouseDown` :1263 [2.5] | `pb7KeyUp` :1273 [2.5]  
`pb7MouseUp` :1283 [2.5] | `pbAddrKeyDown` :1293 [2.5] | `pbAddrExit` :1306 [2.5] | `FormCreate` :1318 [1.1]  
`FormKeyDown` :1326 [5] | `BringToFront` :1336 [5] | `CheckBox1Click` :1346 [3.6] | `CheckBox2Click` :1353 [3.6]  
`CheckBox3Click` :1360 [3.6] | `CheckBox4Click` :1367 [3.6] | `CheckBox5Click` :1374 [3.6] | `CheckBox6Click` :1381 [3.6]  
`CheckBox7Click` :1388 [3.6] | `ROMStartEditChange` :1395 [4.1] | `ROMEndEditChange` :1401 [4.1] | `ReadStartEditChange` :1407 [4.1]  
`ReadEndEditChange` :1413 [4.1] | `ProtectedStartEditChange` :1419 [4.1] | `ProtectedEndEditChange` :1425 [4.1] | `InvalidStartEditChange` :1431 [4.1]  
`InvalidEndEditChange` :1437 [4.1] | `ROMChkClick` :1443 [4.1] | `ReadChkClick` :1449 [4.1] | `ProtectedChkClick` :1455 [4.1]  
`InvalidChkClick` :1461 [4.1]

### A.2 Components in `hardwareu.dfm` (179 objects)

`Hardware` THardware :1 [1.2] | `Label1` TLabel :49 [2.3] | `Label2` TLabel :65 [2.3]  
`Label3` TLabel :81 [2.3] | `Label4` TLabel :97 [2.3] | `Label5` TLabel :113 [2.3]  
`Label6` TLabel :129 [2.3] | `Label7` TLabel :145 [2.3] | `Label8` TLabel :161 [2.3]  
`Label9` TLabel :177 [5] | `Label10` TLabel :191 [5] | `Label11` TLabel :205 [5]  
`Label21` TLabel :219 [5] | `switch7` TBitBtn :233 [2.4] | `switch6` TBitBtn :359 [2.4]  
`switch5` TBitBtn :484 [2.4] | `switch4` TBitBtn :609 [2.4] | `switch3` TBitBtn :734 [2.4]  
`switch2` TBitBtn :859 [2.4] | `switch1` TBitBtn :984 [2.4] | `switch0` TBitBtn :1109 [2.4]  
`Panel1` TPanel :1234 [2.3] | `LED7` TShape :1241 [2.3] | `LED6` TShape :1251 [2.3]  
`LED5` TShape :1261 [2.3] | `LED4` TShape :1271 [2.3] | `LED3` TShape :1281 [2.3]  
`LED2` TShape :1291 [2.3] | `LED1` TShape :1301 [2.3] | `LED0` TShape :1311 [2.3]  
`Panel2` TPanel :1322 [2.2] | `seg3a` TShape :1329 [2.2] | `seg3b` TShape :1336 [2.2]  
`seg3c` TShape :1343 [2.2] | `seg3d` TShape :1350 [2.2] | `seg3e` TShape :1357 [2.2]  
`seg3f` TShape :1364 [2.2] | `seg3g` TShape :1371 [2.2] | `seg3h` TShape :1378 [2.2]  
`seg2a` TShape :1385 [2.2] | `seg2f` TShape :1392 [2.2] | `seg2b` TShape :1399 [2.2]  
`seg2g` TShape :1406 [2.2] | `seg2e` TShape :1413 [2.2] | `seg2c` TShape :1420 [2.2]  
`seg2d` TShape :1427 [2.2] | `seg2h` TShape :1434 [2.2] | `seg1a` TShape :1441 [2.2]  
`seg1f` TShape :1448 [2.2] | `seg1b` TShape :1455 [2.2] | `seg1g` TShape :1462 [2.2]  
`seg1e` TShape :1469 [2.2] | `seg1c` TShape :1476 [2.2] | `seg1d` TShape :1483 [2.2]  
`seg1h` TShape :1490 [2.2] | `seg0a` TShape :1497 [2.2] | `seg0f` TShape :1504 [2.2]  
`seg0b` TShape :1511 [2.2] | `seg0g` TShape :1518 [2.2] | `seg0e` TShape :1525 [2.2]  
`seg0c` TShape :1532 [2.2] | `seg0d` TShape :1539 [2.2] | `seg0h` TShape :1546 [2.2]  
`seg7a` TShape :1553 [2.2] | `seg7f` TShape :1560 [2.2] | `seg7b` TShape :1567 [2.2]  
`seg7g` TShape :1574 [2.2] | `seg7e` TShape :1581 [2.2] | `seg7c` TShape :1588 [2.2]  
`seg7d` TShape :1595 [2.2] | `seg7h` TShape :1602 [2.2] | `seg6a` TShape :1609 [2.2]  
`seg6f` TShape :1616 [2.2] | `seg6b` TShape :1623 [2.2] | `seg6g` TShape :1630 [2.2]  
`seg6e` TShape :1637 [2.2] | `seg6c` TShape :1644 [2.2] | `seg6d` TShape :1651 [2.2]  
`seg6h` TShape :1658 [2.2] | `seg5a` TShape :1665 [2.2] | `seg5f` TShape :1672 [2.2]  
`seg5b` TShape :1679 [2.2] | `seg5g` TShape :1686 [2.2] | `seg5e` TShape :1693 [2.2]  
`seg5c` TShape :1700 [2.2] | `seg5d` TShape :1707 [2.2] | `seg5h` TShape :1714 [2.2]  
`seg4a` TShape :1721 [2.2] | `seg4f` TShape :1728 [2.2] | `seg4b` TShape :1735 [2.2]  
`seg4g` TShape :1742 [2.2] | `seg4e` TShape :1749 [2.2] | `seg4c` TShape :1756 [2.2]  
`seg4d` TShape :1763 [2.2] | `seg4h` TShape :1770 [2.2] | `seg7addr` TMaskEdit :1778 [2.1]  
`LEDaddr` TMaskEdit :1804 [2.1] | `switchAddr` TMaskEdit :1827 [2.4] | `GroupBox1` TGroupBox :1852 [5]  
`Label13` TLabel :1868 [5] | `Label14` TLabel :1878 [5] | `Label15` TLabel :1888 [5]  
`Label16` TLabel :1898 [5] | `Label17` TLabel :1908 [5] | `Label18` TLabel :1918 [5]  
`Label19` TLabel :1928 [5] | `IRQ7Btn` TSpeedButton :1938 [3.2] | `IRQ6Btn` TSpeedButton :2069 [3.2]  
`IRQ5Btn` TSpeedButton :2200 [3.2] | `IRQ4Btn` TSpeedButton :2331 [3.2] | `IRQ3Btn` TSpeedButton :2462 [3.2]  
`IRQ2Btn` TSpeedButton :2593 [3.2] | `IRQ1Btn` TSpeedButton :2724 [3.2] | `AutoLbl` TLabel :2855 [3.6]  
`CheckBox1` TCheckBox :2865 [3.6] | `CheckBox2` TCheckBox :2881 [3.6] | `CheckBox3` TCheckBox :2895 [3.6]  
`CheckBox4` TCheckBox :2909 [3.6] | `CheckBox5` TCheckBox :2923 [3.6] | `CheckBox6` TCheckBox :2937 [3.6]  
`CheckBox7` TCheckBox :2951 [3.6] | `GroupBox2` TGroupBox :2966 [3.8] | `ResetBtn` TSpeedButton :2981 [3.8]  
`GroupBox3` TGroupBox :3113 [3.6] | `Label20` TLabel :3128 [3.6] | `Label12` TLabel :3141 [3.6]  
`AutoIRQ` TComboBox :3154 [3.6] | `IRQinterval` TMaskEdit :3180 [3.6] | `pbAddr` TMaskEdit :3199 [2.5]  
`pb0` TBitBtn :3224 [2.5] | `pb1` TBitBtn :3342 [2.5] | `pb2` TBitBtn :3460 [2.5]  
`pb3` TBitBtn :3578 [2.5] | `pb4` TBitBtn :3696 [2.5] | `pb5` TBitBtn :3814 [2.5]  
`pb6` TBitBtn :3932 [2.5] | `pb7` TBitBtn :4050 [2.5] | `GroupBox4` TGroupBox :4168 [4.1]  
`Label22` TLabel :4184 [4.1] | `Label23` TLabel :4199 [4.1] | `Label24` TLabel :4216 [4.1]  
`Label25` TLabel :4231 [4.1] | `Label26` TLabel :4246 [4.1] | `Label27` TLabel :4261 [4.1]  
`Label28` TLabel :4276 [4.1] | `Label29` TLabel :4291 [4.1] | `Label30` TLabel :4306 [4.1]  
`Label31` TLabel :4321 [4.1] | `ROMChk` TCheckBox :4336 [4.1] | `ReadChk` TCheckBox :4344 [4.1]  
`ProtectedChk` TCheckBox :4352 [4.1] | `InvalidChk` TCheckBox :4360 [4.1] | `ROMStartEdit` TMaskEdit :4368 [4.1]  
`MaskEdit2` TMaskEdit :4394 [4.1] | `MaskEdit3` TMaskEdit :4422 [4.1] | `ReadStartEdit` TMaskEdit :4450 [4.1]  
`MaskEdit5` TMaskEdit :4476 [4.1] | `ProtectedStartEdit` TMaskEdit :4504 [4.1] | `MaskEdit7` TMaskEdit :4530 [4.1]  
`InvalidStartEdit` TMaskEdit :4558 [4.1] | `MaskEdit13` TMaskEdit :4584 [4.1] | `ROMEndEdit` TMaskEdit :4612 [4.1]  
`MaskEdit15` TMaskEdit :4638 [4.1] | `ReadEndEdit` TMaskEdit :4666 [4.1] | `MaskEdit17` TMaskEdit :4692 [4.1]  
`ProtectedEndEdit` TMaskEdit :4720 [4.1] | `MaskEdit19` TMaskEdit :4746 [4.1] | `InvalidEndEdit` TMaskEdit :4774 [4.1]  
`MaskEdit9` TMaskEdit :4801 [2.1] | `MaskEdit10` TMaskEdit :4829 [2.1] | `MaskEdit11` TMaskEdit :4857 [2.1]  
`MaskEdit12` TMaskEdit :4885 [2.1] | `IRQ1timer` TTimer :4913 [3.6] | `IRQ2timer` TTimer :4919 [3.6]  
`IRQ3timer` TTimer :4925 [3.6] | `IRQ4timer` TTimer :4931 [3.6] | `IRQ5timer` TTimer :4937 [3.6]  
`IRQ6timer` TTimer :4943 [3.6] | `IRQ7timer` TTimer :4949 [3.6]
