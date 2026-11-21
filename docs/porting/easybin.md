# EASyBIN v2.5.0 - behaviour specification for the web and macOS port

Scope: everything a user of the original Windows utility `EASyBIN.exe` (title `EASyBIN v2.5.0`) sees
and does: the window, the menus, every control and caption, the memory display and its editing, the
four file operations and their file formats, Copy and Fill, help and the About box. EASyBIN is the
third program of the EASy68K suite: a 16 MB memory image that S-record and binary files are loaded
into, viewed and edited in hexadecimal and ASCII, and written out again as S-records or as one, two
or four binary files (for EPROM programmers). This document is written for an engineer who has never
seen the Borland source, and for a reviewer who checks the port against it without the source.

Status: derived from the original source, not from a running binary. Anything that could not be
established from the source or the shipped files is marked **UNVERIFIED**. The file-format
behaviour of sections 10 to 13 was additionally checked by compiling the original's own functions
(`fileIO.cpp`, `CopyClick`, `FillClick`) natively with a minimal stand-in for the VCL calls and
running them on test files (section 0.4); the fixtures of the port's tests were produced that way.

## 0. Sources, conventions, and what is in the build

### 0.1 Sources read

All file names without a directory are relative to
`c:\easy64k\reference\src-easybin\EASyBINv2.5.0\`. Citations are `file:line`. Both `.dfm` files
are stored in *binary* form; they were decoded for this spec and are cited by object name
(`Form1u.dfm`, object `Address1`) and property. The help page is
`c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\easybin.htm`.

| File(s) | Role |
|---|---|
| `EASyBIN.cpp`, `EASyBIN.BPR` | Program entry, list of compiled units and forms |
| `Form1u.cpp/.h/.dfm` | The main window: every control, menu, action, the memory display, editing, Copy, Fill, the file commands' front ends |
| `fileIO.cpp/.h` | `loadSrec`, `loadBinary`, `saveBinary`, `saveSRecord`, `finish`: the four file operations |
| `aboutS.cpp/.h/.dfm` | The About box |
| `help.cpp/.h`, `ez68k.h`, `HTMLhelp.h` | Help-context table and the HTML Help declarations |
| `def.h` | `TITLE`, `MEMSIZE` |
| `easybin.htm`, `ez68k.ali` (help folder) | The help page and the context-id to page map |
| `c:\easy64k\reference\official-extracted\EASyBIN.exe` | The shipped binary (version resource `2.5.0.0`, ground-truth §2); not run for this spec |

### 0.2 Conventions used in this document

- **(VCL)** - behaviour that comes from Borland's VCL framework or from Windows, not from code in this
  source tree. It is described from knowledge of the framework and is UNVERIFIED unless stated.
- **QUIRK** - behaviour that is surprising or plainly a defect of the original. It is recorded exactly.
  Section 19 says for each whether it can change a file the user writes, and what the port does.
- **DEAD** - code that a user of the shipped program cannot reach.
- Shortcut numbers in the `.dfm` are VCL `TShortCut` values: key code + `0x2000` (Shift) + `0x4000`
  (Ctrl) + `0x8000` (Alt). `16463 = 0x404F = Ctrl+O`.
- `StrToInt("0x" + text)` (used for every numeric field) is VCL `StrToInt`: hexadecimal with the `0x`
  prefix, up to eight digits, the result an `int` (32-bit, two's complement: `0xFFFFFFF0` is -16).
  Written `hex(field)` below.
- "Text" of a mask edit is what the program assigns; "EditText" is what the control holds and what the
  program reads back. Both are the same string for these controls (section 4.1).
- `MEMSIZE = 0x01000000` (`def.h:23`), 16 MB; valid addresses are `$000000` to `$FFFFFF`.

### 0.3 What is compiled into EASyBIN.exe

`EASyBIN.BPR:7`: `EASyBIN.obj Form1u.obj aboutS.obj help.obj fileIO.obj`, linked with the Borland
runtime (`cp32mt.lib`, `EASyBIN.BPR:43`). Forms created at start (`EASyBIN.cpp:23-24`): `Form1`
(main), `AboutFrm`. `Application->Title = "EASyBIN"` (`EASyBIN.cpp:22`) is the task-bar name and the
title of every `ShowMessage` box. Version string: `const char TITLE[] = "EASyBIN v2.5.0";`
(`def.h:20`).

### 0.4 How the file formats were checked

The functions `loadSrec`, `loadBinary`, `saveBinary`, `saveSRecord`, `finish` (`fileIO.cpp`) and the
bodies of `CopyClick` and `FillClick` (`Form1u.cpp:899-991`) were copied into a C++ test harness
unchanged, with `AnsiString`, `ShowMessage`, `StrToInt`, `FileExists`, `ChangeFileExt` and the form's
fields replaced by minimal equivalents, and compiled with Microsoft C++ (whose C library treats text
files as the Borland one does: CR LF read as LF and written for LF, Ctrl-Z ends a text file). It was
run on S-record files written by the port's assembler engine, on the `.S68` files of the official
assembler in `build\ground-truth\asm` (369 of its 973 files, 178 distinct; the 604 made from one
third-party project's sources were left out, as that project may not be used), on malformed S-record
lines, and on binary files. Its results are the expected values of the port's tests
(`app/src/core/easybin/fixtures/`; for the official files only hashes are kept). Where the Borland
and Microsoft runtimes could differ (the reading of malformed hexadecimal by `sscanf`) this document
says so.

---

## 1. Application shell

### 1.1 Start-up (`TForm1::TForm1`, `Form1u.cpp:101-147`; `FormShow`, `390-410`)

1. Help file path = `<exe folder>\help.chm`; if it does not exist: message `Help file not found` +
   newline + path (`Form1u.cpp:106-110`).
2. If the HTML Help library cannot be loaded: message `HTML Help was not detected on this computer.
   EASy68K help may not work correctly.` (`Form1u.cpp:118-121`).
3. `Form1->Caption = TITLE` -> window title `EASyBIN v2.5.0` (`Form1u.cpp:128`); the design-time
   caption `EASyBIN` (`Form1u.dfm`, `Form1.Caption`) is never seen. `DoubleBuffered = true`.
4. `rowHeight = Canvas->TextHeight("Xp")`, `colWidth = Canvas->TextWidth("W")` of the form font
   (Courier New, `Font.Height = -13`; the DFM's design `TextHeight` is 16) (`Form1u.cpp:131-132`).
5. `split = OutputSplit->ItemIndex << 1` = 0 (`Form1u.cpp:134`).
6. `memory = new char[MEMSIZE]`, every byte set to `$FF` (`Form1u.cpp:136-140`). If the allocation
   throws: message box `Error reserving 16Meg memory block` (caption NULL, i.e. `Error`) and exit
   (`Form1u.cpp:141-144`).
7. Files may be dropped on the window (`DragAcceptFiles`, `Form1u.cpp:146`; section 1.4).
8. `FormShow`: if there is a command-line parameter and the file `ParamStr(1)` exists, it is stored as
   the Open dialog's file name and opened with `OpenSRecordFile` (section 10). Only the first parameter
   is used; the computed extension `ext` is never used; the `/r` handling is commented out
   (`Form1u.cpp:394-409`). The file is always treated as an S-record, whatever its extension.

Global state at start (`Form1u.cpp:37-41`; `Form1u.h:161-164`): `memAddr`, `startAddr`, `endAddr`,
`length` = 0 (C++ globals); `row`, `col`, `textX`, `textY`, `nRows`, `promptVisible` are form members
(zero-initialised by the VCL's form allocation (VCL)); `split` = 0.

### 1.2 Main window (`Form1u.dfm`, object `Form1`)

| Property | Value |
|---|---|
| Size | `Width = 640`, `Height = 480`; `Constraints.MinWidth = MaxWidth = 640`, `MinHeight = 440`: the width is fixed, the height can be changed (not below 440) |
| Position | `poDesktopCenter` |
| Colour | `clWhite`; font Courier New, `Font.Height = -13`, `clWindowText` |
| Cursor | `crIBeam` over the memory area; `crArrow` over the two panels |
| Menu | `MainMenu1` (section 2) |
| Events | `OnKeyDown = FormKeyDown`, `OnKeyPress = FormKeyPress`, `OnMouseDown = FormMouseDown`, `OnMouseWheelDown/Up`, `OnPaint = FormPaint`, `OnResize = FormResize` (repaint, `Form1u.cpp:413-416`), `OnShow = FormShow` |

There is no toolbar and no status bar. The window title is `EASyBIN v2.5.0` until a file is opened;
it then becomes the full path of that file (sections 10, 12, 1.4) and goes back to `EASyBIN v2.5.0`
on File > New.

### 1.3 Exit (`ExitExecute`, `Form1u.cpp:195-198`)

`File > Exit` calls `Application->Terminate()`. Nothing is asked and nothing is saved; the memory
image is lost. The window's close button does the same (VCL). The destructor frees the memory and
closes HTML Help (`Form1u.cpp:152-190`). EASyBIN keeps no settings file and no registry entries.

### 1.4 Files dropped on the window (`WmDropFiles`, `Form1u.cpp:228-265`)

For every dropped file, in drop order, if it exists:

1. `loadSrec(fileName)` (section 10.3). On success the fields are set exactly as `OpenSRecordFile`
   sets them (section 10.2) and the caption becomes the file name.
2. Otherwise (after `loadSrec`'s own error message, if it showed one) the message
   `Opening as binary file.` is shown and `loadBinary(fileName, split)` runs (section 12.2). If it
   returns non-zero: caption = file name, `startAddress = "00000000"`,
   `Address1 = OutputFirstAddress`, `length = size`, `OutputLength = "%06lX"` of `length` - the same
   as Open Binary (section 12.1).

A dropped file of any type is therefore first tried as an S-record. A binary file that does not
begin with `S` gives `Invalid data on line 1` ... `Open stopped.` (section 10.4) and then
`Opening as binary file.`. Memory written by a partly loaded S-record stays written.

---

## 2. Menus

Menu bar: **File, Help** (`Form1u.dfm`, object `MainMenu1`). Captions come from the actions of
`ActionList1`; `&` marks the access key.

### 2.1 File (`File1`, caption `&File`)

| # | Menu object | Action | Caption | Shortcut | Effect |
|---|---|---|---|---|---|
| 1 | `Close1` | `New` | `&New` | none | Section 9. `NewExecute`, `Form1u.cpp:352-381` |
| - | `N8` | | separator | | |
| 2 | `Open1` | `Open` | `&Open S-Record...` | Ctrl+O (`16463`) | Section 10. `OpenExecute`, `Form1u.cpp:269-281` |
| 3 | `OpenB` | `OpenBin` | `Open &Binary...` | Ctrl+B (`16450`) | Section 12. `OpenBinFile`, `Form1u.cpp:309-333` |
| - | `N7` | | separator | | |
| 4 | `SaveSRecord1` | `SaveSRecord` | `Save S-&Record...` | Ctrl+R (`16466`) | Section 11. `SaveSRecFile`, `Form1u.cpp:285-304` |
| 5 | `Save1` | `SaveBin` | `&Save Binary...` | Ctrl+S (`16467`) | Section 13. `SaveBinFile`, `Form1u.cpp:336-348` |
| - | `N1` | | separator | | |
| 6 | `Exit1` | `Exit` | `E&xit` | none | Section 1.3 |

Every item is always enabled; nothing in the source changes `Enabled` of an action or menu item.

### 2.2 Help (`Help1`, caption `&Help`)

| # | Menu object | Action | Caption | Shortcut | Effect |
|---|---|---|---|---|---|
| 1 | `Help2` | `Help` | `&EASyBIN Help` | none | `displayHelp("EASyBIN")` -> `easybin.htm` (section 15). `HelpExecute`, `Form1u.cpp:429-432` |
| 2 | `About1` | `About` | `&About EASyBIN` (the menu item's own caption overrides the action's `&About...`) | none | `AboutFrm->ShowModal()` (section 15.3). `AboutExecute`, `Form1u.cpp:384-387` |

### 2.3 Keyboard summary

| Key | Where | Effect | Source |
|---|---|---|---|
| Ctrl+O, Ctrl+B, Ctrl+R, Ctrl+S | anywhere in the window (VCL action shortcuts) | the four file commands | `Form1u.dfm`, `ActionList1` |
| F1 | memory area, Address field | `displayHelp("EASyBIN")` | `Form1u.cpp:465-467, 722-724` |
| F1 | About box | `displayHelp("CHUCK")` -> credits page | `aboutS.cpp:36-40` |
| Up, Down, Left, Right, Page Up, Page Down | memory area | cursor and scrolling (section 7.2) | `FormKeyDown`, `Form1u.cpp:435-470` |
| Up, Down, Page Up, Page Down, Enter | Address field | scrolling (section 6.3); Enter repaints | `Address1KeyDown`, `Form1u.cpp:706-729` |
| any character | memory area | edits memory (section 7.4) | `FormKeyPress`, `Form1u.cpp:823-896` |
| `0`-`9`, `a`-`f`, `A`-`F` | every edit field | typed in upper case; any other character beeps and is refused | `AddrKeyPress`, `Form1u.cpp:949-958` |
| Tab, Shift+Tab | everywhere | focus moves between controls in tab order (section 3.4) (VCL) | |

---

## 3. Main window layout

### 3.1 Top panel (`Panel1`: left 0, top 0, 628 x 128, colour `clInactiveBorder`, cursor `crArrow`)

Coordinates are pixels within the parent. Every value field is a `TMaskEdit` (section 4.1); every
`$` is a separate label in front of the field; a `00` label with colour `clMedGray` in front of a
six-digit field shows the always-zero top byte of a 32-bit address.

**Group `S68File`** (left 8, top 0, 191 x 88), caption ` S-Record File ` (a space before and after,
as the group box frame needs), font MS Sans Serif:

| Object | Kind | Position | Caption / content |
|---|---|---|---|
| `Label2` | label, right-justified | 30, 16 | `Start Address:` |
| `Label5` | label | 103, 16 | `$` |
| `startAddress` | mask edit, 8 digits (`EditMask = 'aaaaaaaa;0;0'`, `MaxLength = 8`), Courier New | 111, 16, 71 x 17 | initially empty (VCL: shows `00000000`, section 4.1). `OnEnter = startAddressEnter` (erase cursor), `OnKeyPress = AddrKeyPress` |
| `Label3` | label, right-justified | 32, 40 | `Last Address:` |
| `Label8` | label | 103, 40 | `$` |
| `Label28` | label, `clMedGray` | 111, 40 | `00` |
| `S68endAddress` | label (read-only), Courier New | 127, 40 | `000000` |
| `Label4` | label, right-justified | 60, 64 | `Length:` |
| `Label19` | label | 119, 64 | `$` |
| `S68length` | label (read-only), Courier New | 127, 64 | `000000` |
| `BitBtn2` | button with glyph (an opening folder), no caption, no hint | 8, 56, 25 x 24 | `OnClick = OpenExecute`: Open S-Record (section 10) |

**Radio group `OutputSplit`** (left 224, top 0, 174 x 80), caption ` Binary Input/Output Split `,
`ItemIndex = 0`, items, top to bottom: `1 File - All Bytes`, `2 Files - Every 2nd Byte`,
`4 Files - Every 4th Byte`. `OnClick = OutputSplitClick` (section 8).

**Group `OutputData`** (left 397, top 0, 192 x 80), caption ` Binary File(s) `:

| Object | Kind | Position | Caption / content |
|---|---|---|---|
| `Label25` | label, right-justified | 33, 16 | `First Address:` |
| `Label6` | label | 103, 16 | `$` |
| `Panel5` > `Label17` | label, `clMedGray` | 110, 16 | `00` |
| `Panel5` > `OutputFirstAddress` | mask edit, 6 digits (`'aaaaaa;0;0'`, `MaxLength = 6`) | 126, 16 | initially empty (`000000`). `OnChange = OutputFirstAddressChange` (repaint), `OnEnter` (erase cursor), `OnKeyPress = AddrKeyPress` |
| `Label26` | label, right-justified | 60, 40 | `Length:` |
| `Label7` | label | 119, 40 | `$` |
| `OutputLength` | mask edit, 6 digits | 126, 40, 58 x 16 | initially empty (`000000`). `OnChange = OutputLengthChange` (repaint; the rounding code in it is commented out, `Form1u.cpp:1038-1047`), `OnEnter`, `OnKeyPress = AddrKeyPress` |
| `Label29` | label, right-justified | 54, 64 | `File Split:` |
| `split0Lbl` | label, bold, `clBlack` | 104, 64 | `0` (always visible) |
| `split1Lbl` | label, bold, `clOlive` | 120, 64 | `1` (`Visible = False` at start) |
| `split2Lbl` | label, bold, `clGreen` | 136, 64 | `2` (`Visible = False`) |
| `split3Lbl` | label, bold, `clBlue` | 152, 64 | `3` (`Visible = False`) |
| `BitBtn1` | button with glyph (a floppy disk), no caption, no hint | 8, 48, 25 x 24 | `OnClick = SaveBinFile`: Save Binary (section 13) |

**Second row** (top 87), three bordered panels with colour `clInactiveBorder`, font Courier New:

| Panel | Objects, left to right | Behaviour |
|---|---|---|
| `Panel7` (79, 87, 247 x 25) | `Label9` `From:`; `Label20` `$`; `FromPanel` > `Label15` `00` (`clMedGray`) + `From` (6 digits); `Label11` `To:`; `Label21` `$`; `Panel4` > `Label16` `00` + `To` (6 digits) | From / To of Copy, Fill and Save S-Record (sections 11, 14) |
| `Panel6` (326, 87, 167 x 25) | `Label10` `Size:`; `Label22` `$`; `Bytes` (6 digits, no `00` label); button `Copy` (caption `Copy`) | Copy (section 14.1) |
| `Panel8` (492, 87, 97 x 25) | `Label23` `$`; `FillByte` (2 digits, `EditMask = 'aa;0;0'`, `MaxLength = 2`, `Text = 'FF'`); button `Fill` (caption `Fill`) | Fill (section 14.2) |

**Address line**: `Label24` `$` (0, 95) and `Label1` `Address:` (10, 97, 64 wide, centred) above
`Panel3` (-1, 111, 73 x 17) holding `Label18` `00` (`clMedGray`) and `Address1` (6 digits,
`OnChange = Address1Change`, `OnEnter` (erase cursor), `OnKeyDown = Address1KeyDown`,
`OnKeyPress = AddrKeyPress`, `OnKeyUp = Address1KeyUp` (repaint)). To its right, `Label12` (79, 111,
517 wide) is the column header:

```
00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF
```

Its first character stands above character column 10 of the rows (section 5.1).

### 3.2 Right panel (`Panel2`: `Align = alRight`, 32 px wide, cursor `crArrow`)

| Object | Position | Caption | Behaviour |
|---|---|---|---|
| `Label13` | 0, 191 | `Row` (Courier New, -12) | |
| `RowSpin` (`TCSpinButton`, an up and a down arrow) | 8, 214, 20 x 49 | | up: `RowSpinUpClick`; down: `RowSpinDownClick` (section 6.2) |
| `Label14` | 1, 294 | `Page` | |
| `PageSpin` (`TCSpinButton`) | 8, 318, 20 x 48 | | up: `PageSpinUpClick`; down: `PageSpinDownClick` |

### 3.3 Memory area

Everything of the form below `Panel1` and left of `Panel2` is painted by `FormPaint` (section 5): a
white area with rows of memory, starting at y = 129. It has no scroll bar.

### 3.4 Tab order (VCL, from the `TabOrder` properties)

`Panel1` (0) before `Panel2` (1). Inside `Panel1`: `S68File` (`BitBtn2`, `startAddress`),
`OutputSplit`, `OutputData` (`OutputLength`, then `OutputFirstAddress`, then `BitBtn1` - Length comes
before First Address), `Panel3` (`Address1`), `Panel6` (`Bytes`, `Copy`), `Panel7` (`From`, `To`),
`Panel8` (`FillByte`, `Fill`); then `RowSpin`, `PageSpin`. The memory area is not a control and has
no place in the tab order; it receives keys only after a click on it (section 7.3) or after a Row or
Page button (section 6.2).

---

## 4. Fields

### 4.1 The mask edits

All seven edit fields (`startAddress`, `OutputFirstAddress`, `OutputLength`, `Address1`, `Bytes`,
`From`, `To`) and `FillByte` use the mask `a...a;0;0` with 8, 6 or 2 positions: `a` = optional
alphanumeric character, literals not saved, blank character `0` (VCL). A position the user clears
shows `0`; typing overwrites. `AutoSelect = False` on all of them. `AddrKeyPress`
(`Form1u.cpp:949-958`) upper-cases `0`-`9`, `a`-`f`; every other character key beeps
(`Beep()`) and is discarded. (The identical `OutputStartAddressKeyPress`, `Form1u.cpp:473-482`, is
attached to no control: DEAD.)

When the **program** assigns a text longer than the mask (`Address1->Text = "%08lX"`, sections 6.2,
10.2), the VCL's `FormatMaskText` only pads, it does not cut (VCL, UNVERIFIED on the binary), and
`MaxLength` limits typing only; the field then holds all eight digits and `hex(Address1)` reads them
all. The program relies on this: section 6 assigns eight digits and the `OnChange` handler turns
them back into six. The only way the field keeps more than six digits is an S-record without data
records (section 10.2).

### 4.2 What each value means

| Field | Read as | Used by |
|---|---|---|
| `startAddress` | `hex()`, 8 digits | Save S-Record writes it into the S7 record (section 11.3); shown in the confirmation box |
| `S68endAddress`, `S68length` | label text only, never read | |
| `OutputFirstAddress` | `hex()` | first address of Open Binary and Save Binary; colouring (section 5.2) |
| `OutputLength` | `hex()` | length of Save Binary; colouring |
| `Address1` | `hex()` | address of the top row of the memory area (section 6) |
| `From`, `To` | `hex()` | Copy, Fill, Save S-Record |
| `Bytes` | `hex()` | Copy |
| `FillByte` | `hex() & 0xFF` | Fill |

### 4.3 Global values

`startAddr`, `endAddr`, `length` (`Form1u.cpp:38-40`) are written by Open S-Record, Open Binary and
New; only Open S-Record and the drop handler read them (to fill the fields). `memAddr` is written by
`Address1Change` and New and never read for drawing (`FormPaint` starts from it: `addr = memAddr`,
`Form1u.cpp:508`).

---

## 5. The memory display (`FormPaint`, `Form1u.cpp:503-603`)

### 5.1 Rows

`nRows = (ClientHeight - Panel1->Height) / rowHeight` (integer division; with the default window
`(426 - 128) / 16 = 18`). Starting at `addr = memAddr` and y = `Panel1->Height + 1`, each row is:

```
%08X: <16 x "%02hX "><16 ASCII characters>
```

- character columns 0-9: the address, eight hex digits, a colon and a space (the Address field shows
  six digits; the rows show eight);
- columns 10-57: sixteen bytes, each two upper-case hex digits and a space; byte `i` occupies
  columns `10 + 3i` (high digit), `11 + 3i` (low digit), `12 + 3i` (space);
- columns 58-73: the same sixteen bytes as characters.

The next row starts at `addr + 16`. There is no blank line or separator.

Constants (`Form1u.cpp:29-32`): `HEX_LEFT = 10`, `HEX_RIGHT = 56`, `ASC_LEFT = 58`, `ASC_RIGHT = 73`.

### 5.2 Colours

| Element | Colour |
|---|---|
| Address, when `addr >= MEMSIZE` | `clRed` |
| Address otherwise | `clBlack` |
| A byte whose address `>= MEMSIZE` | `xx ` in `clRed`, and `-` in `clRed` in the ASCII column |
| A byte outside the binary output range, or any byte while `OutputLength` is 0 | `clGray` |
| A byte in the range, split 1 file (`split == 0`) | `clBlack` |
| A byte in the range, split 2 or 4 | by `(address - outFirst) % split`: 0 `clBlack`, 1 `clOlive`, 2 `clGreen`, 3 `clBlue` (the colours of the `File Split` digits) |
| ASCII characters of valid addresses | `clBlack` |

The output range is `outFirst = hex(OutputFirstAddress)`, `outLength = hex(OutputLength)`,
`outLast = outFirst + outLength - 1` (unsigned), or 0 when `outLength` is 0. A byte is in the range
when `outFirst <= address <= outLast` (`Form1u.cpp:514-519, 553`).

### 5.3 The ASCII column

`memory` is `char *` in `Form1u.cpp` (signed). A byte is drawn as itself when `memory[a] >= ' '`,
otherwise as `-` (`Form1u.cpp:587-591`). Because the comparison is signed, bytes `$00`-`$1F` **and
`$80`-`$FF`** are shown as `-` (QUIRK). `$7F` is drawn as the character 127 of Courier New, which has
no glyph there (UNVERIFIED: a box or blank).

### 5.4 When the display is redrawn

`Repaint()` is called after: a change of `Address1` (every keystroke), any key-up in `Address1`,
Enter in `Address1`, Row and Page buttons, the mouse wheel, a click in the memory area, a key typed
into memory, Copy (when it finishes without a message), Fill (likewise), a change of the split,
`OutputFirstAddress` or `OutputLength`, New, and a resize. Open S-Record and Open Binary change
`Address1` and so repaint through its `OnChange`.

---

## 6. Navigation

### 6.1 Address field (`Address1Change`, `Form1u.cpp:485-499`)

On every change of `Address1` (each keystroke, and each assignment by the program):

1. `memAddr = hex(Address1)` (as unsigned); `memAddr -= memAddr % 16` (down to a multiple of 16);
2. `Address1->Text = "%06lX"` of `memAddr` - six digits, or more for a value above `$FFFFFF`;
3. `nRows` recomputed; repaint.

So typing a last digit other than `0` is undone at once (the text shows `...0`), and the top row
always starts at a multiple of 16. An address above `$FFFFFF` can only come from section 10.2; its
rows are red (section 5.2).

### 6.2 Row and Page buttons (`Form1u.cpp:606-689`) and the wheel (`692-703`)

Each reads `addr = hex(Address1)` as `int`, changes it, clamps it, assigns
`Address1->Text = "%08lX"` (which runs 6.1), repaints, then moves the keyboard focus to the memory
area (the `Address1->SetFocus; Enabled = false; Form1->SetFocus; Enabled = true` sequence) and starts
the cursor blink.

| Button | Change | Clamp |
|---|---|---|
| Row up | `addr -= 16` | `if (addr < 0) addr = 0` |
| Row down | `addr += 16` | `if (addr >= MEMSIZE) addr = MEMSIZE - 16` |
| Page up | `addr -= nRows * 16` | `if (addr <= 0) addr = 0` |
| Page down | `addr += nRows * 16` | `if (addr >= MEMSIZE) addr = MEMSIZE - 16` |

The last row of memory (`$FFFFF0`) can be the top row; the rows below it are drawn in red with `xx`
(section 5.2). Each notch of the mouse wheel down runs Row down; up runs Row up (VCL fires the event
once per notch).

### 6.3 Keys in the Address field (`Address1KeyDown`, `Form1u.cpp:706-729`)

Page Up / Page Down = Page buttons; Up / Down = Row buttons (and therefore the focus moves to the
memory area: QUIRK); F1 = help; Enter = repaint. Every key-up repaints (`Address1KeyUp`,
`Form1u.cpp:994-998`).

---

## 7. Cursor and editing in the memory area

### 7.1 The cursor ("prompt")

The cursor is a one-character frame at character column `col` of the visible row `row`
(`drawPrompt`, `Form1u.cpp:795-809`): `FrameRect` from `(colWidth*col, textY + rowHeight/4 - 1)` to
`(colWidth*col + colWidth + 1, textY + rowHeight/4 + rowHeight - 1)` with `textY = row*rowHeight +
Panel1->Height`. The timer `prompt` (`Interval = 500`, `Enabled = False` at start) toggles it between
black and white every 500 ms: a blinking frame. `erasePrompt` (`813-820`) stops the timer and draws
the frame once more in the current brush. The cursor is erased whenever one of the eight edit fields
gets the focus (`*Enter` handlers, `Form1u.cpp:1052-1105`) and when a key goes down in the memory area
(it is restarted after the key).

At start `row = col = 0` and the timer is off: no cursor is shown until the first click or key.

### 7.2 Placing the cursor (`gotoRC`, `Form1u.cpp:733-765`) and the arrow keys (`FormKeyDown`, `435-470`)

`gotoRC(r, c)`:

1. `row = r; col = c`.
2. `row < 0`: `row = 0` and Row up (section 6.2). `row > nRows - 1`: `row = nRows - 1` and Row down.
3. `col < HEX_LEFT (10)`: `col = 10`. Else if `col < ASC_LEFT (58)` and `col % 3 == 0`: `col++` (the
   space after a byte becomes the next byte's high digit; column 57 becomes 58, the first ASCII
   column). Else if `col > ASC_RIGHT (73)`: `col = 73`.
4. Draw the cursor at once.

Keys (`FormKeyDown`, only while the memory area has the focus):

| Key | Action |
|---|---|
| Page Up / Page Down | Page buttons |
| Up / Down | `row--` / `row++`, `gotoRC` (scrolls one row at the edges) |
| Left | `col--`; if `col < 58` and `col % 3 == 0`, `col--` again; `gotoRC`. From column 10 the cursor stays (9 -> 8 -> clamped to 10); from 58 it goes to 56 (the low digit of byte 15) |
| Right | `col++`, `gotoRC`. From 56 it goes to 58; from 73 it stays |
| F1 | help |

Left and Right never change the row and never wrap.

### 7.3 The mouse (`FormMouseDown`, `Form1u.cpp:769-785`)

Any button: erase the cursor, take the focus from every control (as in 6.2), then
`row = (Y - Panel1->Height) / rowHeight`, `col = X / colWidth`, `gotoRC(row, col)`, start the blink,
repaint. A click in the address column puts the cursor on column 10; a click right of the ASCII
column on column 73; **a click in the partly visible strip below the last whole row scrolls one row
down** (`row > nRows - 1` in `gotoRC`; QUIRK).

### 7.4 Typing (`FormKeyPress`, `Form1u.cpp:823-896`)

For a character key while the memory area has the focus:

1. `addr = hex(Address1) + row*16`; in the hex columns (`col <= HEX_RIGHT`):
   `addr += (col - 10) / 3`, low digit when `(col - 10) % 3` is 1; in the ASCII columns:
   `addr += col - 58`.
2. `addr >= MEMSIZE`: beep, nothing else (the cursor does not move).
3. Hex columns: the key is upper-cased; `0`-`9`, `A`-`F` replace the high or low four bits of the
   byte; any other character beeps and does nothing else. Then `col++`; if `col > 56`: `col = 10`,
   `row++`; `gotoRC` (which skips the space and scrolls one row past the last row).
4. ASCII columns: `memory[addr] = Key` - **any** character the keyboard produces, including control
   characters the form receives as characters: Backspace (`$08`), Enter (`$0D`), Esc (`$1B`) and
   Ctrl+letter (`$01`-`$1A`) that is not a menu shortcut (QUIRK; Tab moves the focus instead (VCL)).
   Characters are bytes of the Windows ANSI code page (1252 on Western systems). Then `col++`; if
   `col > 73`: `col = 58`, `row++`; `gotoRC`.
5. Repaint.

There is no undo, no insert mode and no selection.

---

## 8. Binary split (`OutputSplitClick`, `Form1u.cpp:1001-1029`)

`split = OutputSplit->ItemIndex << 1`: 0 (1 file), 2 (2 files), 4 (4 files). The digits of
`File Split:` follow: `0` only; `0 1`; `0 1 2 3` (`split1Lbl` .. `split3Lbl` made visible or
invisible). Then `OutputLengthChange` (repaint only) and repaint: the byte colours of section 5.2
follow at once. The split is used by Open Binary, Save Binary, the drop handler and the colours. It
is not reset by Open, only by New (section 9).

---

## 9. File > New (`NewExecute`, `Form1u.cpp:352-381`)

1. Message box `The current environment will be lost, click OK to continue.`, caption `Caution`,
   buttons OK / Cancel (no icon). Cancel: nothing happens.
2. OK: every byte of memory = `$FF` (not the Fill byte, whatever the help says, section 18).
3. Caption = `EASyBIN v2.5.0`; `startAddress = "00000000"`; `S68endAddress = "000000"`;
   `S68length = "000000"`; `Address1 = "00000000"` (runs 6.1: shows `000000`);
   `OutputFirstAddress = "000000"`; `OutputLength = "000000"`; `length = memAddr = startAddr =
   endAddr = 0`.
4. `OutputSplit->ItemIndex = 0`. Setting `ItemIndex` checks the first radio button, which fires
   `OnClick` (VCL, UNVERIFIED), so `split` becomes 0 and the digits `1 2 3` disappear.
5. Repaint.

`From`, `To`, `Bytes`, `FillByte`, the cursor position and the remembered dialog file names are
kept.

---

## 10. Open S-Record

### 10.1 The command (`OpenExecute`, `Form1u.cpp:269-281`)

The Open dialog (`OpenDialog`, default options, no title: Windows shows `Open`) with the filter
`EASy68K S-Record [.S68]|*.S68|Motorola S-Record [.S3][.S19]|*.S3;*.S19|Other S-Record|*.*`:

| Filter label | Patterns |
|---|---|
| `EASy68K S-Record [.S68]` | `*.S68` |
| `Motorola S-Record [.S3][.S19]` | `*.S3;*.S19` |
| `Other S-Record` | `*.*` |

If a file is chosen, `OpenSRecordFile(name)`. The dialog object is shared with Open Binary, so it
starts in the folder of the last file opened with either (VCL keeps `FileName`). Without
`ofFileMustExist` a typed name that does not exist is returned and fails in `loadSrec` (VCL).

### 10.2 `OpenSRecordFile` (`Form1u.cpp:202-224`)

If `loadSrec(name)` returns true:

1. Caption = `name` (the full path).
2. `startAddress = "%08lX"` of `startAddr` (which `loadSrec` set to the **lowest data address**,
   section 10.3 step 7).
3. `Address1 = startAddress->EditText` - eight digits; `Address1Change` (6.1) rounds down to a
   multiple of 16 and writes six digits.
4. `OutputFirstAddress = Address1->EditText` - the **rounded** value (QUIRK: an S-record that starts
   at `$1004` gives First Address `001000`).
5. `S68length = "%06lX"` of `length`; `OutputLength = S68length`.
6. `S68endAddress = "%06lX"` of `endAddr`.

If it returns false, nothing changes here (memory may already have been written, section 10.4).

With an S-record that has no data records at all, `loadSrec` succeeds with `lowAddr = $FFFFFFFF`,
`highAddr = 0`: `startAddress = FFFFFFFF`, `Address1` = `FFFFFFF0` (eight digits, red rows),
`OutputFirstAddress = FFFFFFF0`, `S68length = OutputLength = 000002` (`0 - $FFFFFFFF + 1`, unsigned),
`S68endAddress = 000000` (QUIRK).

### 10.3 `loadSrec` (`fileIO.cpp:102-235`)

Variables: `loc` (unsigned, not initialised: the port starts it at 0), `lowAddr = $FFFFFFFF`,
`highAddr = 0`, `s_type = 0`, `line = 0`, `s0str = ""`, `errorStr = ""`, `sRecError = false`; the
global buffer `lbuf[516]` (`fileIO.cpp:18-19`) and the local `s_byte[4]` keep their contents from line
to line. **Checksums are never computed or checked** (the variable `checksum` is unused) and the byte
count field is ignored.

1. `fopen(name, "rt")` - text mode: CR LF is read as LF, a Ctrl-Z byte ends the file. Failure:
   message `error: cannot open file <name>`, return false.
2. Each `fgets(lbuf, 515, fp)` reads one line of at most 514 characters including its LF; a longer
   line is split and its rest is read as the next line. `line++`.
3. `sscanf(lbuf, "S%c%2x", &s_type, &bytecount)`: if the line does not start with `S`, `s_type` keeps
   the value of the previous line (QUIRK; on the first line it is 0). `bufptr = lbuf + 4`.
4. By `s_type`:

| Type | Action |
|---|---|
| `'0'` | `bufend` = end of the string; `bufptr += 4` (address skipped). `s0str += "S0 = "`. Then, while `sscanf(bufptr, "%2x")` succeeds: `bufptr += 2`; if `bufptr + 2 >= bufend`, stop (that pair was the checksum); else append the byte as a character if it is `' '` to `'~'`, otherwise `.`. Then `s0str += "\n"`. |
| `'1'` | `sscanf(bufptr, "%04x", &loc)`; not 1 converted: error; else `bufptr += 4` |
| `'2'` | the same with `%06x`, `bufptr += 6` |
| `'3'` | the same with `%08x`, `bufptr += 8` |
| `'5'` | nothing (falls through to step 6, QUIRK) |
| `'7'`, `'8'`, `'9'` | `sscanf(bufptr, "%08x" / "%06x" / "%04x", &loc)`; not 1: error; else `startAddr = loc` and end of file |
| anything else | error (this includes `S4`, `S6` and a first line that does not start with `S`) |

5. End of file (S7/S8/S9) or error: leave the loop. Nothing after the termination record is read.
6. Data step, for **every** other type, `S0` and `S5` included (`fileIO.cpp:192-209`): `bufend` = end
   of the string from `bufptr`; while `sscanf(bufptr, "%02x", &s_byte)` returns non-zero (1, or -1 at
   the end of the string): `bufptr += 2`; if `bufptr + 2 >= bufend`, stop (that pair was the
   checksum, or there was nothing); if `loc > $FFFFFF`: `errorStr = "ERROR, Address exceeds
   $FFFFFF\n"`, error, stop; else track `lowAddr`/`highAddr` and `memory[loc++] = byte`. An error
   leaves the loop.
   - For S1/S2/S3 this stores every hex pair up to, not including, the last pair before the end of
     the line, whatever the byte count says.
   - For S0 the data step finds `bufptr` at the line end and stores nothing.
   - For S5 (`S503000AF2`) the step stores the record's own count bytes (`00 0A`) at the current
     `loc` - the address after the previous record's data (QUIRK).
   - A blank line or any line that does not start with `S` repeats the previous record type on the
     stale rest of `lbuf`: after a data record, an empty line (only its LF) rereads that record's
     address and data from the buffer (which still holds them beyond the new terminator) and stores
     them again at the same place (QUIRK; harmless). A line of three blanks puts the terminator at
     the address position, the address `sscanf` returns -1, and the load fails with `Invalid data`.
   - An address whose data runs past `$FFFFFF` stores the bytes below the limit, then fails.
   - An address field is read only up to its first non-hex character: `S1071G00...` loads at
     address `$1` (the `1` before the `G`), with the pairs that follow. Only an address that starts
     with a non-hex character fails.
   - White space after the checksum moves `bufend` away from it: the checksum pair is stored as data,
     and each further two blanks store the last byte once more (`sscanf` returns -1 and leaves
     `s_byte` unchanged) (QUIRK). Lines of the assembler and of EASyBIN have none.
   - A record type character is case-sensitive: a line starting with `s1` fails as a non-S line.
7. After the loop:
   - Error: message `<errorStr>Invalid data on line <line>\n<line>: <lbuf>\n\nOpen stopped.` - the raw
     line includes its own line feed, so two line breaks follow it - and return false. Memory written
     by earlier records stays.
   - Success: `startAddr = lowAddr; endAddr = highAddr; length = highAddr - lowAddr + 1`
     (unsigned 32-bit). **The S7/S8/S9 start address is overwritten by the lowest data address**
     (QUIRK; the help says the field shows the start address). Message
     `S Record loaded successfully.\n\nS0 description record contains:\n` + `s0str`. Return true.
   - Any C++ exception: message `Unexpected Error reading S-Record file`, return false.

All messages of `loadSrec` are `ShowMessage` boxes (caption `EASyBIN`, OK, no icon). `lowAddr` and
`highAddr` are the lowest and highest address written, so a file with gaps reports a length that
includes the gaps.

`sscanf` details that matter only for malformed files: `%x` skips leading white space (a line feed
too), accepts an optional sign and an optional `0x` prefix within the field width, and returns -1
when the string ends before any conversion. The port follows the C standard here; the Borland
library's handling of a sign or `0x` prefix inside an S-record line is UNVERIFIED.

### 10.4 Example

The `.S68` the assembler writes for the fixture program `asm-hello` (ORG `$1000`, code and a
`DC.B` string, `END START`; `app/src/core/easybin/fixtures/asm-hello.S68`):

```
S021000036384B50524F47202020323043524541544544204259204541535936384B6D
S111100043F900001010103C000E4E4FFFFF8D
S105100CFFFFE0
S116101048656C6C6F2C204541537942494EE9FC7F1F00DB
S804001000EB
```

loads the 35 bytes at `$1000-$1022`. Message:

```
S Record loaded successfully.

S0 description record contains:
S0 = 68KPROG   20CREATED BY EASY68K
```

Fields: Start Address `00001000`, Last Address `001022`, Length `000023`, Address `001000`, First
Address `001000`, Length (binary) `000023`. The assembler's memory-map S0 records (sim-core §2.4)
add one line each, for example `S0 =       ROM 004000,004FFF` and `S0 =   INVALID 00F000,00F0FF`.

---

## 11. Save S-Record

### 11.1 The command (`SaveSRecFile`, `Form1u.cpp:285-304`)

1. The save dialog's filter becomes
   `EASy68K S-Record [.S68]|*.S68|Motorola S-Record [.S3]|*.S3|Other S-Record|*.*` and its default
   extension `S68`.
2. Message box (caption `S-Record Creation`, Yes / No, no icon):

   ```
   S-Record file information:

   From:$<From>  To:$<To>
   Start Address:$<startAddress>

   Create S-Record?
   ```

   (two spaces before `To:`; the fields' texts, six, six and eight digits.) No: nothing more.
3. `saveSRecord()`.

### 11.2 `saveSRecord` (`fileIO.cpp:373-462`)

1. `fromAddr = hex(From)`, `toAddr = hex(To)`, `outLength = toAddr - fromAddr`.
2. If `fromAddr > toAddr` or `outLength >= MEMSIZE`: beep, message box `Invalid memory range.`
   (caption `Information`, OK), stop. (With six-digit fields only `From > To` triggers it.)
3. The save dialog (shared with Save Binary, title `Save As`). Cancel: stop.
4. If the chosen file exists: message box `File exists! OK to replace?` (caption `Alert`, Yes / No).
   No: stop. (The dialog itself asks nothing: `ofOverwritePrompt` is not set (VCL).)
5. Create the file in **text mode** (each LF is written as CR LF). Failure: `Error creating <name>`,
   stop.
6. Write the records of 11.3; close.

`outLength` bytes are written, from `From` up to **but not including** `To` (QUIRK: Fill uses
`From` to `To` inclusive). `From = To` writes an S-record with no data records.

### 11.3 The format

Every record is upper-case hex, ends with CR LF, and has a checksum computed by `finish`
(`fileIO.cpp:466-490`): the byte count is put in characters 2-3, then the ones' complement of the
low byte of the sum of the `count` pairs that start at the count field (count, address and data
bytes) is appended, with `\n`.

1. **Header** (`fileIO.cpp:417-419`), always the same:
   `S0210000535245434F5244202020313143524541544544204259204541535942494E2C`
   (data `SRECORD   11CREATED BY EASYBIN`).
2. **Data records**, starting at `sRecAddr = From`, up to 32 data bytes each (`SRECDATA = 32`), until
   `outLength` bytes are written. The type is chosen per record by its start address
   (`fileIO.cpp:425-434`): `S1` with a 4-digit address if `sRecAddr <= $FFFF`, `S2` with 6 digits if
   `<= $FFFFFF`, otherwise `S3` with 8 digits (DEAD with six-digit fields). A record that starts below
   `$10000` stays `S1` even if its data runs past `$FFFF`. Count = data bytes + address bytes + 1.
3. **Termination**: `S7` + count `05` + `%08X` of `hex(startAddress)` + checksum (`fileIO.cpp:452-454`).
   Always S7, whatever record type the file was opened with.

Example: after loading `asm-hello.S68` (10.4), From `001000`, To `001023`, Start Address
`00001000` (every line ends with CR LF):

```
S0210000535245434F5244202020313143524541544544204259204541535942494E2C
S123100043F900001010103C000E4E4FFFFFFFFF48656C6C6F2C204541537942494EE9FC2D
S10610207F1F002B
S70500001000EA
```

Because the original writes its own header, its own record lengths and an S7 record, a file saved
by EASyBIN never equals the assembler's `.S68` it was loaded from; what the port must reproduce is
the file EASyBIN writes.

---

## 12. Open Binary

### 12.1 The command (`OpenBinFile`, `Form1u.cpp:309-333`)

The Open dialog with filter `Binary File [.BIN]|*.BIN|Any File|*.*`. If a file is chosen:
`size = loadBinary(name, split)`; if `size` is non-zero: caption = name; `startAddress =
"00000000"`; `Address1 = OutputFirstAddress->EditText` (6.1 rounds it down: the top row shows the
first address); `length = size`; `OutputLength = "%06lX"` of `length`. `S68endAddress` and
`S68length` are not changed. When `size` is 0 nothing changes and nothing is said.

### 12.2 `loadBinary` (`fileIO.cpp:242-268`)

1. Open in binary mode. Failure: message `Error openning <name>` (sic), return 0.
2. `memAddr = hex(OutputFirstAddress)`; step = `split`, or 1 when `split` is 0.
3. `while (!eof && memAddr < MEMSIZE) { read 1 byte into memory[memAddr]; memAddr += step; size += step; }`
4. `return size - 1`.

Because `eof` becomes true only after a read has failed, a file of N bytes runs the loop N + 1
times; the last read stores nothing (the memory byte keeps its value). Results (QUIRK):

| Split | Bytes stored at | Returned length |
|---|---|---|
| 1 file | First .. First + N - 1 | N (0 for an empty file: nothing changes, section 12.1) |
| 2 files | First, First + 2, ... First + 2(N - 1) | 2N + 1 |
| 4 files | First, First + 4, ... First + 4(N - 1) | 4N + 3 |

If the end of memory is reached first, the loop stops there with `size` = (bytes stored) x step, and
the returned length is that minus 1. The file is loaded into **every** second or fourth byte; the
bytes in between keep their values. Only one file is read, even with split 2 or 4: loading the other
files of a split set (to their own First Address, `$...1`, `$...2`, `$...3`) is left to the user.

---

## 13. Save Binary

### 13.1 The command (`SaveBinFile`, `Form1u.cpp:336-348`)

The save dialog's filter becomes `Binary File [.BIN]|*.BIN|Other Binary File|*.*`, its default
extension `BIN`; then `saveBinary(split)`.

### 13.2 `saveBinary` (`fileIO.cpp:274-369`)

1. `fromAddr = hex(OutputFirstAddress)`, `outLength = hex(OutputLength)`, `toAddr = fromAddr +
   outLength`.
2. If `toAddr >= MEMSIZE`: beep, message box `Invalid memory range.` (caption `Information`), stop.
   Because the test is on the address after the range, the byte at `$FFFFFF` can never be saved
   (QUIRK).
3. The save dialog. Cancel: stop.
4. File names, with `ext = ExtractFileExt(FileName)` (with its dot):
   - `str0` = `FileName` itself when the split is 1 file, otherwise `ChangeFileExt(FileName, "_0" +
     ext)`;
   - `str1`, `str2`, `str3` = `ChangeFileExt(FileName, "_1" + ext)` and so on, always computed.

   `C:\x\prog.BIN` with 4 files gives `prog_0.BIN`, `prog_1.BIN`, `prog_2.BIN`, `prog_3.BIN`; a name
   without extension gives `prog_0` ... (the dialog normally appends `.BIN`, 10.1).
5. If **any** of the four names exists - also the ones this split does not write (QUIRK: saving one
   file `prog.BIN` asks when `prog_1.BIN` exists) - message box `File exists! OK to replace?`
   (caption `Alert`, Yes / No). No: stop.
6. Create `str0`; with split 2 also `str1`; with split 4 also `str1`, `str2`, `str3`, in that order,
   in binary mode. A failure shows `Error creating <name>` and stops (the files created before it
   stay, empty).
7. Write:
   - 1 file: the `outLength` bytes from `fromAddr`.
   - 2 or 4 files: for `i = 0, step, 2*step, ...` while `i < outLength`: file 0 gets the byte at
     `fromAddr + i`; file k (k = 1 .. step-1) gets the byte at `fromAddr + i + k` **if
     `fromAddr + i + k <= toAddr`** (`fileIO.cpp:341, 346-351`).

   Since `toAddr` is the address after the range, the test admits it: when `outLength` is not a
   multiple of the step, the byte just after the range is written too (QUIRK). Example: First
   `001000`, Length `000005`, 2 files: `prog_0` = bytes at `1000 1002 1004`, `prog_1` = `1001 1003
   1005` (`1005` is outside the range). With 4 files: `prog_0` = `1000 1004`, `prog_1` = `1001 1005`,
   `prog_2` = `1002`, `prog_3` = `1003`.
8. Close. A C++ exception anywhere shows `Error saving 68K memory to file.` (`MessageDlg`,
   information icon, caption `Information`).

Length 0 creates the files empty.

---

## 14. Copy and Fill

### 14.1 Copy (`CopyClick`, `Form1u.cpp:899-946`)

`fromAddr = hex(From)`, `toAddr = hex(To)`, `bytes = hex(Bytes)` (unsigned).

1. `toAddr == fromAddr` or `bytes == 0`: message `Invalid copy range`, stop.
2. `fromAddr < toAddr` (copy upwards): `fromAddr += bytes - 1; toAddr += bytes - 1`; if either is
   `>= MEMSIZE`: message `Invalid copy range`, stop (nothing copied). Else copy byte by byte from the
   top down (`memory[toAddr - i] = memory[fromAddr - i]`), so overlapping ranges copy correctly.
3. `fromAddr > toAddr` (copy downwards): for `i = 0 .. bytes-1`: if `toAddr + i` or `fromAddr + i`
   is `>= MEMSIZE`: message `Invalid copy range` and stop - **the bytes copied so far stay copied and
   the display is not refreshed** (QUIRK); else `memory[toAddr + i] = memory[fromAddr + i]`.
4. Repaint.

### 14.2 Fill (`FillClick`, `Form1u.cpp:962-991`)

`fromAddr = hex(From)`, `toAddr = hex(To)`, `data = hex(FillByte) & 0xFF`. For `i = fromAddr` up to
**and including** `toAddr`: `memory[i] = data`. `From > To` does nothing, silently. The message
`Invalid memory range` (for `i >= MEMSIZE`) cannot appear with six-digit fields (DEAD). Repaint.

Neither Copy nor Fill asks for confirmation. Both read the fields only when the button is pressed.

---

## 15. Help and About

### 15.1 Mechanism (`displayHelp`, `Form1u.cpp:419-426`; `getHelpContext`, `help.cpp:39-55`)

`displayHelp(context)` opens `help.chm` at `getHelpContext(context)`, or shows `HTML Help was not
detected on this computer. The HTML help viewer may be downloaded from msdn.microsoft.com` when
HTML Help is missing. The table (`help.cpp:24-28`, case-insensitive): `EASyBIN` -> `IDH_EASYBIN`
(560, `easybin.htm`), `CREDITS` and `CHUCK` -> `IDH_CREDITS` (350, `credits.htm`)
(`ez68k.h:41, 62`; `ez68k.ali:35, 56`). An unknown name would give context 1000 - the comment says
"INTRO", but 1000 is `IDH_ROR` (QUIRK, DEAD: every call passes a known name).

### 15.2 Entry points

| Where | Page |
|---|---|
| Help > EASyBIN Help | `easybin.htm` |
| F1 in the memory area or the Address field | `easybin.htm` |
| F1 in the About box (`KeyPreview = True`) | `credits.htm` |

### 15.3 About box (`AboutFrm`, `aboutS.dfm` (binary), `aboutS.cpp`)

Caption `About EASyBIN`; client 448 x 279; `BorderStyle = bsSingle`; only the system menu;
`poScreenCenter`; modal. Inside a raised panel (8, 8, 433 x 225), top to bottom:

| Object | Text | Style |
|---|---|---|
| `ProgramIcon` | the program icon | 33 x 33 at 24, 16 |
| `Title` | `EASyBIN v2.5.0` (set from `TITLE` in `FormShow`, `aboutS.cpp:28-31`; design text `Version `) | bold |
| `Comments` | `The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.` (two spaces before `Use`) | wraps |
| `Label4` | `EASyBIN is distributed under the GNU general public use license. See Help for more information.` | wraps |
| `Copyright` | `By: Chuck Kelly` | |
| `Label5` | `www.easy68k.com` | Arial, 16 px, bold, `clGreen`; plain text, not a link (no event) |
| `Label1` | `Use the EASy68K forum to report undocumented features.` | |

Button `OK` (`Default = True`, `ModalResult = mrOk`) at 190, 244. F1 opens the credits page
(`aboutS.cpp:33-40`).

---

## 16. Catalogue of user-visible messages

`ShowMessage` boxes have the caption `EASyBIN` (`Application->Title`), one OK button and no icon.
Texts are exact; `\n` is a line break.

| Text | Box | When | Source |
|---|---|---|---|
| `Help file not found\n<path>` | ShowMessage | start, `help.chm` missing | `Form1u.cpp:110` |
| `HTML Help was not detected on this computer. EASy68K help may not work correctly.` | ShowMessage | start | `Form1u.cpp:120` |
| `Error reserving 16Meg memory block` | MessageBox, caption `Error` | start, out of memory | `Form1u.cpp:142` |
| `HTML Help was not detected on this computer. The HTML help viewer may be downloaded from msdn.microsoft.com` | ShowMessage | help without HTML Help | `Form1u.cpp:425` |
| `The current environment will be lost, click OK to continue.` | MessageBox, caption `Caution`, OK / Cancel | File > New | `Form1u.cpp:355-357` |
| `error: cannot open file <name>` | ShowMessage | Open S-Record, file cannot be opened | `fileIO.cpp:115` |
| `S Record loaded successfully.\n\nS0 description record contains:\n<S0 lines>` | ShowMessage | S-record loaded | `fileIO.cpp:227` |
| `[ERROR, Address exceeds $FFFFFF\n]Invalid data on line <n>\n<n>: <raw line>\n\nOpen stopped.` | ShowMessage | S-record error | `fileIO.cpp:197, 214-219` |
| `Unexpected Error reading S-Record file` | ShowMessage | exception in `loadSrec` | `fileIO.cpp:232` |
| `Opening as binary file.` | ShowMessage | a dropped file is not an S-record | `Form1u.cpp:251` |
| `Error openning <name>` (sic) | ShowMessage | binary file cannot be opened | `fileIO.cpp:251` |
| `S-Record file information:\n\nFrom:$<From>  To:$<To>\nStart Address:$<start>\n\nCreate S-Record?` | MessageBox, caption `S-Record Creation`, Yes / No | Save S-Record | `Form1u.cpp:291-294` |
| `Invalid memory range.` | MessageBox, caption `Information`, OK, after a beep | Save S-Record with From > To; Save Binary with First + Length >= $1000000 | `fileIO.cpp:289, 394` |
| `File exists! OK to replace?` | MessageBox, caption `Alert`, Yes / No | saving over an existing file | `fileIO.cpp:305, 403` |
| `Error creating <name>` | ShowMessage | a file cannot be created | `fileIO.cpp:311, 317, 324, 329, 409` |
| `Error saving 68K memory to file.` | MessageDlg, information, OK | exception in `saveBinary` | `fileIO.cpp:366` |
| `Error saving S-Record file.` | ShowMessage | exception in `saveSRecord` | `fileIO.cpp:459` |
| `Error creating S-Record.` | ShowMessage | exception in `finish` | `fileIO.cpp:487` |
| `Invalid copy range` | ShowMessage | Copy (section 14.1) | `Form1u.cpp:911, 922, 933` |
| `Invalid memory range` (no full stop) | ShowMessage | Fill past the end (DEAD) | `Form1u.cpp:977` |
| `Error in OpenSRecordFile()`, `Error in OpenExecute()`, `Error in SaveSRecFile()`, `Error in OpenBinFile()`, `Error in SaveBinFile()`, `Error in NewExecute()`, `Error in Address1Change()`, `Error in FormPaint()`, `Error in gotoRC()`, `Error in FormKeyPress()`, `Error in CopyClick()`, `Error in FillClick()`, `Error in OutputSplitClick()` | ShowMessage | internal exception handlers (not reachable in normal use) | `Form1u.cpp:221, 278, 301, 330, 345, 378, 495, 600, 762, 893, 943, 987, 1026` |

A beep without a message: a refused key in an edit field (4.1); a refused key or an address past the
end in the memory area (7.4).

---

## 17. Dead code and unused declarations

| Item | Why it is dead |
|---|---|
| `OutputStartAddressKeyPress` (`Form1u.cpp:473-482`) | attached to no control |
| `OutputLengthChange`'s rounding (`Form1u.cpp:1040-1045`) | commented out |
| Command-line switches (`Form1u.cpp:404-409`) | commented out |
| `ext` in `FormShow`, `addr` in `OpenSRecordFile`, `textX`, `data[4]` in `saveBinary` and `saveSRecord`, `bytecount`, `checksum`, `nambuf`, `startAdrStr`, `str2`/`ext` uses beyond names | computed or declared, never used |
| `S3` records in `saveSRecord` | addresses are at most six digits |
| `Invalid memory range` in `FillClick` | addresses are at most six digits |
| Context 1000 in `getHelpContext` | every caller passes a known name |
| `TITLE` design captions `EASyBIN` (form) and `Version ` (About title) | replaced at start |

---

## 18. Where the help page and the source disagree (the source wins)

| Topic | `easybin.htm` says | The source does |
|---|---|---|
| File > New | "Fills all memory with specified Fill byte" | fills with `$FF` after an OK/Cancel question (section 9) |
| Save Binary shortcut | "Save Binary... Ctrl+B" | Ctrl+S (`16467`); Ctrl+B is Open Binary |
| Start Address after Open | "The starting execution address as specified in the S-Record file's S7, S8 or S9 record" | the lowest data address (section 10.3 step 7) |
| Group name | "Binary Output Split" | ` Binary Input/Output Split ` |
| Open Binary | "loaded into memory beginning at First Address" | with split 2 or 4 into every 2nd or 4th byte, and the length shown is 2N + 1 or 4N + 3 (12.2) |
| Save S-Record range | "the data specified by From: and To:" | From up to but not including To (11.2) |
| Help menu | not described | `EASyBIN Help`, `About EASyBIN` |

---

## 19. Porting notes, quirk register and recommendations

EASyBIN's output is files a user writes and gives to other tools (EPROM programmers, the simulator,
other people's EASyBIN). The rule applied below: **every byte of every file written, and every value
loaded into memory, is the original's**, quirks included; defects of the window that cannot change a
file are fixed.

| # | Quirk | Section | Changes a file or memory? | Port |
|---|---|---|---|---|
| Q1 | Start Address after Open = lowest data address, not the S7/S8/S9 address | 10.3 | yes (the S7 record written by Save) | reproduce |
| Q2 | First Address after Open = start rounded down to 16 | 10.2 | yes (Save Binary's range) | reproduce |
| Q3 | Binary Open: length N, 2N+1, 4N+3; an empty file with 1 file does nothing | 12.2 | yes (Length field, later saves) | reproduce |
| Q4 | Binary Save writes the byte after the range when Length is not a multiple of the split | 13.2 | yes | reproduce |
| Q5 | Binary Save asks about all four names, also those it does not write | 13.2 | no | reproduce (the question is cheap and safe) |
| Q6 | S5 records store their count bytes; lines not starting with `S` repeat the previous record on stale buffer contents; long lines are split at 514 characters | 10.3 | yes | reproduce exactly (the loader emulates the buffer) |
| Q7 | Checksums and byte counts are ignored on load | 10.3 | yes | reproduce |
| Q8 | Save S-Record writes From .. To-1; Fill writes From .. To | 11.2, 14.2 | yes | reproduce |
| Q9 | The byte at `$FFFFFF` cannot be saved as binary | 13.2 | yes | reproduce |
| Q10 | Copy downwards past the end: partial copy, no repaint | 14.1 | memory: yes; display: no | reproduce the partial copy; the display always shows memory |
| Q11 | ASCII column shows `-` for `$80`-`$FF` | 5.3 | no | reproduce (it is how students know EASyBIN) |
| Q12 | A click below the last whole row scrolls one row | 7.3 | no | reproduce |
| Q13 | Up/Down in the Address field move the focus to the memory area | 6.3 | no | reproduce |
| Q14 | Control characters typed in the ASCII column are stored | 7.4 | yes | reproduce for Backspace, Enter, Esc and Ctrl+letter (Windows/Linux key maps); on macOS Ctrl+letter likewise |
| Q15 | New resets the split through the radio group's event | 9 | no | reset split, digits and colours together |
| Q16 | An S-record without data records leaves eight digits in the Address field and First Address | 10.2 | yes (First Address) | reproduce |
| Q17 | Help context 1000 = `IDH_ROR` | 15.1 | no | not applicable (dead) |
| Q18 | Tab order puts Length before First Address | 3.4 | no | fix: the port's order follows the layout |
| Q19 | `Error openning` misspelt | 16 | no | keep the text (exact-texts rule) |

Windows-isms that need a decision (the port's decisions are in ARCHITECTURE.md 1.3.8 and
`docs/differences/B1.md`):

1. **Separate program.** EASyBIN becomes the third mode of the application (ARCHITECTURE.md 1.4 note
   26). Its memory image lives as long as the window; switching modes keeps it.
2. **Window title.** The original shows the opened file's path in the title bar; in the port the
   window title belongs to the shell, and EASyBIN sets it with the shell's `setModeTitle`
   (`state/shell.ts`): the opened file's path, or the fixed title after New, followed by the port's
   ` - unofficial port <version>` as every title is. The mode has no status bar, as the original.
3. **Files** are reached through the port's file dialogs and stores (ARCHITECTURE.md 3.8); text-mode
   CR LF translation and the Ctrl-Z end-of-file rule are emulated on the bytes.
4. **Exit** quits the whole application (it is one program in the port), with the editor's prompts.
5. **Help** opens the imported `easybin.htm` in the Help panel; the two start-up messages about
   `help.chm` and HTML Help do not exist.
6. **Beep** is a short quiet tone.
7. **Command line**: the port's start-up arguments belong to the editor and simulator (ARCHITECTURE.md
   5.7); EASyBIN mode has none.
8. **Dropped files**: dropped on the window while EASyBIN mode is shown, they are read as in 1.4.

---

## 20. Acceptance checks for the port

Fixture files for these are in `app/src/core/easybin/fixtures/`; their expected results come from the
original's functions compiled natively (0.4).

### 20.1 Open S-Record

- An assembler `.S68` (S0, S1 or S2, the assembler's memory-map S0 records, S8): memory, message
  (with one `S0 = ` line per S0 record), the six fields of 10.2.
- Each official assembler output in `build\ground-truth\asm` (0.4): memory, fields, message and the
  file saved back equal the original's.
- `S1` record with a wrong checksum: loaded without complaint.
- `S4` record, a first line without `S`, a lower-case `s1` line: `Invalid data on line n` ...
  `Open stopped.`, earlier records stay in memory, fields unchanged.
- An S1 record whose address is `1G00`: loaded at address `$1`.
- Trailing blanks after a record: the checksum and repeats of it stored as data.
- S3 record at `$01000000`: `ERROR, Address exceeds $FFFFFF` first.
- S2 record at `$FFFFFE` with 4 data bytes: two stored, then the error.
- S5 record after data: its count bytes stored after the data.
- Blank line between records; CR LF and LF files; a file without a final line feed (its last data
  byte is taken as the checksum); a Ctrl-Z byte ending the file; a 600-character line.
- File with only S0 and S8: success; Start Address `FFFFFFFF`, Length `000002`, Address `FFFFFFF0`.

### 20.2 Save S-Record

- After 20.1's first case with From = Start, To = Last + 1, Start Address as loaded: the file equals
  the original's byte for byte (header, 32-byte records, S7, CR LF).
- A range that crosses `$10000` (S1 then S2 records); From = To (S0 and S7 only); From > To
  (`Invalid memory range.` after a beep, no file).
- The confirmation text of 11.1, and No.
- An existing file: `File exists! OK to replace?`, No keeps the file.

### 20.3 Binary

- Open with 1, 2, 4 files: bytes at the right places, Length N, 2N+1, 4N+3; empty file.
- Save with 1, 2, 4 files and lengths that are and are not multiples of the split: file names
  `_0`..`_3`, contents including the extra byte of Q4.
- Save with First + Length = `$1000000`: `Invalid memory range.`.
- Save one file while `name_1.BIN` exists: the replace question.

### 20.4 Copy, Fill, New

- Copy upwards overlapping (`From 1000`, `To 1001`, `Size 10`): a correct shifted copy.
- Copy downwards overlapping; Copy with To = From or Size 0: `Invalid copy range`; upwards past the
  end: message, nothing copied; downwards past the end: message, partial copy.
- Fill `1000`..`100F` with `00`: 16 bytes; From > To: nothing.
- New: memory all `$FF`, fields of section 9, split back to 1 file.

### 20.5 Display and editing

- Rows: `%08X: `, 16 bytes, 16 characters; `$41` shows `A`, `$7E` `~`, `$1F` and `$80` `-`.
- Colours with split 1, 2, 4 and with Length 0; rows past `$FFFFFF` red with `xx`.
- Address field: typing `00123` + `4` shows `001230`; Row/Page/wheel move by 16 / nRows*16 with
  the clamps of 6.2.
- Cursor: Left/Right/Up/Down at every edge of section 7.2; typing hex digits writes nibbles and
  wraps to the next row; typing in the ASCII column writes the character; typing at an address past
  the end beeps.
- Editing at `$FFFFF0` and anywhere else in 16 MB responds without delay.

---

## 21. Completeness index

### 21.1 Functions

| File | Functions | Section |
|---|---|---|
| `EASyBIN.cpp` | `WinMain` | 0.3 |
| `Form1u.cpp` | `LoadHtmlHelp`, `TForm1::TForm1`, `~TForm1` | 1.1, 1.3, 15.1 |
| | `ExitExecute` | 1.3 |
| | `OpenSRecordFile`, `OpenExecute` | 10.1, 10.2 |
| | `WmDropFiles` | 1.4 |
| | `SaveSRecFile` | 11.1 |
| | `OpenBinFile` | 12.1 |
| | `SaveBinFile` | 13.1 |
| | `NewExecute` | 9 |
| | `AboutExecute` | 15.3 |
| | `FormShow`, `FormResize` | 1.1, 1.2 |
| | `displayHelp`, `HelpExecute` | 15 |
| | `FormKeyDown` | 7.2 |
| | `OutputStartAddressKeyPress` | 4.1, 17 |
| | `Address1Change`, `Address1KeyDown`, `Address1KeyUp`, `Address1Enter` | 6.1, 6.3, 7.1 |
| | `FormPaint` | 5 |
| | `RowSpinUpClick`, `RowSpinDownClick`, `PageSpinUpClick`, `PageSpinDownClick`, `FormMouseWheelDown`, `FormMouseWheelUp` | 6.2 |
| | `gotoRC`, `FormMouseDown`, `promptTimer`, `drawPrompt`, `erasePrompt`, `FormKeyPress` | 7 |
| | `CopyClick`, `FillClick` | 14 |
| | `AddrKeyPress` | 4.1 |
| | `OutputSplitClick`, `OutputFirstAddressChange`, `OutputLengthChange` | 8, 5.4 |
| | `startAddressEnter`, `OutputFirstAddressEnter`, `OutputLengthEnter`, `FromEnter`, `ToEnter`, `BytesEnter`, `FillByteEnter` | 7.1 |
| `fileIO.cpp` | `loadSrec` | 10.3 |
| | `loadBinary` | 12.2 |
| | `saveBinary` | 13.2 |
| | `saveSRecord` | 11.2, 11.3 |
| | `finish` | 11.3 |
| `aboutS.cpp` | `TAboutFrm::TAboutFrm`, `FormShow`, `FormKeyDown` | 15.3 |
| `help.cpp` | `getHelpContext` | 15.1 |

### 21.2 Components of `Form1u.dfm` (all 101 objects)

`Form1` 1.2. `Panel2` (`Label13`, `Label14`, `RowSpin`, `PageSpin`) 3.2. `Panel1` 3.1:
`Label1`, `Label12`, `Label24` (address line); `S68File` (`Label2`, `Label3`, `S68endAddress`,
`Label4`, `S68length`, `Label5`, `Label8`, `Label19`, `Label28`, `BitBtn2`, `startAddress`);
`OutputSplit`; `OutputData` (`Label6`, `Label7`, `Label25`, `Label26`, `Label29`, `split0Lbl`,
`split1Lbl`, `split2Lbl`, `split3Lbl`, `OutputLength`, `Panel5` (`Label17`, `OutputFirstAddress`),
`BitBtn1`); `Panel3` (`Label18`, `Address1`); `Panel6` (`Label10`, `Label22`, `Bytes`, `Copy`);
`Panel7` (`Label9`, `Label20`, `Label11`, `Label21`, `FromPanel` (`Label15`, `From`), `Panel4`
(`Label16`, `To`)); `Panel8` (`Label23`, `FillByte`, `Fill`). `ActionList1` (`Open`, `OpenBin`,
`SaveSRecord`, `SaveBin`, `New`, `Exit`, `Help`, `About`) 2. `MainMenu1` (`File1`: `Close1`, `N8`,
`Open1`, `OpenB`, `N7`, `SaveSRecord1`, `Save1`, `N1`, `Exit1`; `Help1`: `Help2`, `About1`) 2.
`ImageList1` (menu glyphs; not needed). `OpenDialog` 10.1, 12.1. `SaveDialog` 11.2, 13.2. `prompt`
(timer) 7.1.

`aboutS.dfm`: `AboutFrm`, `Panel1`, `ProgramIcon`, `Title`, `Copyright`, `Comments`, `Label1`,
`Label5`, `Label4`, `OKButton` - 15.3.

### 21.3 Messages

Every message text of the source is in section 16, with every source line that shows it.

### 21.4 Rows for ARCHITECTURE.md 1.3.8

The parity table of 1.3.8 extended from this specification (`St` as in 1.3; notes refer to section 19
here and to `docs/differences/B1.md`):

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| File > `&New` (fill memory with `$FF` after `Caution` question) | `bin.file.new` | EASyBIN menu File | - | - | = |
| File > `&Open S-Record...` | `bin.file.openSrec` | File; button in `S-Record File` | Ctrl+O | Cmd+O | = |
| File > `Open &Binary...` | `bin.file.openBinary` | File | Ctrl+B | Cmd+B | = |
| File > `Save S-&Record...` | `bin.file.saveSrec` | File | Ctrl+R | Ctrl+R | = |
| File > `&Save Binary...` | `bin.file.saveBinary` | File; button in `Binary File(s)` | Ctrl+S | Cmd+S | = |
| File > `E&xit` | `bin.file.exit` | File | - | - | ~ (quits the application, 19 item 4) |
| Help > `&EASyBIN Help` | `bin.help.help` | Help; F1 in the workspace | F1 | F1 | ~ (Help panel) |
| Help > `&About EASyBIN` | `bin.help.about` | Help | - | - | ~ (port notice added) |
| Simulator View > `&EASyBIN` | `sim.view.easybin` | switches to EASyBIN mode | - | - | ~ (note 26) |
| Memory area: 16 MB, rows of 16 bytes, hex and ASCII editing, cursor, colours | - | EASyBIN workspace | | | = |
| Address field, Row and Page buttons, wheel, Page Up/Down, arrows | - | workspace | | | = |
| `S-Record File` group: Start Address, Last Address, Length | - | workspace | | | = |
| `Binary Input/Output Split` (1, 2, 4 files) and `File Split` digits | - | workspace | | | = |
| `Binary File(s)` group: First Address, Length | - | workspace | | | = |
| From / To, Size + Copy, fill byte + Fill | - | workspace | | | = |
| Window title = opened file | - | window title (with the port's notice) | | | = |
| F1 in the About box (credits page) | - | Help panel, `credits.htm` | F1 | F1 | ~ (Help panel) |
| Files dropped on the window | - | drop while EASyBIN mode is shown | | | = |
| Tab order | - | follows the layout | | | ~ (Q18) |
| Command line `EASyBIN <file>` | - | none | | | x (19 item 7) |

---

## 22. Open questions for the architect

1. **Exit.** Quitting the whole application from EASyBIN mode (the port's choice, as the editor's and
   simulator's Exit do) versus leaving only EASyBIN mode. The original program ends; nothing is lost
   that the user did not already lose there.
2. **Window title.** Settled at gate I1: the shell's `setModeTitle` (`docs/requests/B1-window-title.md`)
   shows the opened file in the window title in EASyBIN mode.
3. **Items marked UNVERIFIED** (the VCL's treatment of an eight-digit text in a six-digit mask edit,
   `OnClick` when New sets `ItemIndex`, the glyph of `$7F`, the Borland `sscanf` on a sign or `0x` in
   an S-record line) can only be settled with the real `EASyBIN.exe` on Windows.
