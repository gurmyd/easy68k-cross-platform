# Sim68K v5.16.1 user interface - behaviour specification

Scope: everything a user of the original Windows simulator (`SIM68K.exe`, title "EASy68K Simulator v5.16.1") sees and does, except the semantics of the TRAP #15 tasks, the CPU core, and the Hardware window internals, which other specs own. This document is written for an engineer who has never seen the Borland source.

All source paths are relative to `c:\easy64k\reference\src-sim68k\Sim68Kv5.16.1\` unless a longer path is given. Help pages are under `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\SIMHELP\`. Citations are `file:line`. `.dfm` line numbers are the line numbers of the text `.dfm` file.

Legend used throughout:

- **UNVERIFIED** - could not be determined from the source alone (normally because it depends on VCL or Windows run-time behaviour, or would need the running binary).
- **VCL-inferred** - follows from documented Borland VCL behaviour, not from EASy68K source lines. Treat as very likely but not proven.
- **Quirk** - behaviour that looks like a bug but is what the source does. Section 19 collects all of them with a note on whether they can change a student program's results.

Code quotations keep the original tokens and their order; a few are re-wrapped onto fewer lines or have unrelated lines removed, so always open the cited lines before transcribing logic.

Where the help pages and the source disagree the source wins; all disagreements are listed in section 18.

Where to find things:

| Topic | Section |
|---|---|
| Windows, start-up order, shut-down | 1 |
| Main window layout | 2 |
| Menus, toolbar, shortcuts, context menu, enabled/disabled rules | 3 |
| Registers, SR flags, editing | 4 |
| Cycle counter | 5 |
| Listing pane, highlight, gutter breakpoints, Find | 6 |
| Message area (with every message text), status bar | 7 |
| Command line, loading (`.S68` / `.L68`), Open Data, drag-drop, Close | 8 |
| Run, Run To Cursor, Step Over, Trace Into, Auto Trace, Pause, Rewind, Reload, halts | 9 |
| Memory window | 10 |
| Stack window | 11 |
| Simple and advanced breakpoints | 12 |
| Logging dialog, Log Start/Stop, log file formats with examples | 13 |
| Options menu, `sim68K.dat` | 14 |
| I/O window's own interface | 15 |
| Help and About | 16 |
| Unattended logging / oracle automation | 17 |
| Help-versus-source disagreements | 18 |
| Quirk register | 19 |
| Core-to-UI coupling | 20 |
| Completeness check | 21 |

---

## 1. Application structure and start-up order

### 1.1 Forms (windows)

`WinMain` creates twelve forms in this order (`SIM68K.cpp:96-107`). Only `Form1` is the main form; closing it ends the application.

| # | Global | Class | Caption | Shown how | Source |
|---|--------|-------|---------|-----------|--------|
| 1 | `Form1` | `TForm1` | `EASy68K Simulator v5.16.1` (the `TITLE` constant, `def.h:23`), replaced by the loaded file name | main window | `SIM68Ku.*` |
| 2 | `StackFrm` | `TStackFrm` | `68000 Stack` | View > Stack, or restored from settings | `Stack1.*` |
| 3 | `MemoryFrm` | `TMemoryFrm` | `68000 Memory` | View > Memory, double-click on an address register, or restored from settings | `Memory1.*` |
| 4 | `BreaksFrm` | `TBreaksFrm` | `EASy68K Advanced Break Points` | View > Break Points | `BREAKPOINTSu.*` |
| 5 | `AboutFrm` | `TAboutFrm` | `About EASy68K Simulator` | Help > About Sim68K (modal) | `aboutS.*` |
| 6 | `Log` | `TLog` | `Log Output` | Options > Log Output... (non-modal) | `logU.*` |
| 7 | `simIO` | `TsimIO` | `Sim68K I/O` | always visible at start (see 14.3) | `simIOu.*` |
| 8 | `AutoTraceOptions` | `TAutoTraceOptions` | `Auto Trace Options` | Options > Auto Trace Options... (modal) | `Optionsu.*` |
| 9 | `Hardware` | `THardware` | (other spec) | View > Hardware | `hardwareu.*` |
| 10 | `frmFullscreenOptions` | `TfrmFullscreenOptions` | `Fullscreen Options` | Options > Fullscreen Options... (modal) | `FullscreenOptions.*` |
| 11 | `LogfileDialog` | `TLogfileDialog` | `Log File Options` | when Log Start finds an existing log file (modal) | `LogfileDialogu.*` |
| 12 | `findDialogFrm` | `TfindDialogFrm` | `Find` | Search > Find... (non-modal, stay-on-top) | `findDialogS.*` |

`Application->Title` is `"SIM68K"` (`SIM68K.cpp:95`).

Before the forms are created `WinMain` probes `User32.dll` for the multi-monitor APIs (sets `MultimonitorAPIsExist`, `SIM68K.cpp:33-66`) and `dsound.dll` (sets `dsoundExist`, `SIM68K.cpp:69-90`). Neither is relevant to a web port except that `MultimonitorAPIsExist == false` makes Options > Fullscreen Options... show an error box (section 14.1).

### 1.2 `TForm1` constructor (`SIM68Ku.cpp:122-175`)

In order:

1. `runMode = false`.
2. `HeadingsLbl->Caption = HeadingStr`, the listing column heading (section 6.1).
3. The help file path is `<exe dir>\help.chm`. If the file does not exist a modal message box `"Help file not found\n<full path>"` is shown at start-up (`SIM68Ku.cpp:130-134`). If `hhctrl.ocx` cannot be loaded another modal box says `"HTML Help was not detected on this computer. EASy68K help may not work correctly."` (`SIM68Ku.cpp:142-145`).
4. The 68000 memory is allocated: `memory = new char[MEMSIZE]` with `MEMSIZE = 0x01000000` (16 MiB, `def.h:56`) and **every byte is set to `0xFF`** (`SIM68Ku.cpp:153-155`). Failure shows `"Error reserving main 68000 memory in Form1::FormCreate"` and calls `exit(1)`.
5. The shortcuts of eleven actions are saved for later restore by TRAP #15 task 24 (`SIM68Ku.cpp:162-172`; section 3.5).
6. `DragAcceptFiles(Handle, true)` enables dropping a file from Explorer onto the main window (section 8.4).

### 1.3 `TForm1::FormShow` (`SIM68Ku.cpp:1203-1239`)

Runs when the main window is first shown:

```cpp
Form1->Caption = TITLE;       // set title
LoadSettings();               // load simulator settings from file
initSim();                    // don't call before LoadSettings()
if (ParamCount() > 0) { ...   // command line, section 8.1
```

`LoadSettings()` is section 14.3, `initSim()` is section 9.9.

### 1.4 `TForm1::FormActivate` (`SIM68Ku.cpp:922-936`)

Runs every time the main window becomes the active window. It turns on double buffering for the listing, memory and stack windows, sets the breakpoint gutter background to `clBtnFace`, and performs the command-line auto-run exactly once:

```cpp
if (clRun) {            // if command line Run
  clRun = false;
  RunExecute(Sender);
}
```

### 1.5 Shut-down

- **File > Exit** (`ExitExecute`, `SIM68Ku.cpp:239-245`): `runMode = false; SaveSettings(); Log->stopLog(); Application->Terminate();`
- **Closing the main window** (`FormClose`, `SIM68Ku.cpp:230-235`): `runMode = false; SaveSettings(); Log->stopLog();`
- The destructor frees the 68000 memory and shuts down HTML Help (`SIM68Ku.cpp:180-226`).

There is no "are you sure" prompt on exit and no prompt about a running program.

---

## 2. Main window layout

Source: `SIM68Ku.dfm`. Default size 744 x 500 px, minimum 600 x 400 (`SIM68Ku.dfm:4-8`), `KeyPreview = True` (the form sees keys before its controls, `SIM68Ku.dfm:40`), position chosen by Windows (`poDefault`) and then overridden by the saved settings.

From top to bottom:

1. **Menu bar** `MainMenu1` (section 3.1).
2. **Toolbar** `ToolBar1`, 29 px high (section 3.2), with the yellow `LOGGING` indicator at its right-hand end.
3. **Group box `Registers`** (`GroupBox1`, 140 px high, aligned to the top, `SIM68Ku.dfm:52-59`) containing the register fields, the SR field, the cycle counter and, on its bottom edge, the listing column heading (sections 4, 5, 6.1).
4. **`Panel1`** filling the rest of the client area (`SIM68Ku.dfm:955-1044`), containing:
   - `breakPnl`/`breakP`: a 24 px wide gutter on the left for breakpoint dots (section 6.5);
   - `ListBox1`: the listing pane (section 6);
   - `ScrollBar1`: a horizontal scroll bar under the listing (section 6.3);
   - `Splitter2`: a horizontal splitter the user can drag;
   - `Message`: a read-only multi-line message area, 57 px high by default (section 7.1).
5. **Status bar** `StatusBar1` with two empty panels (section 7.3).

Exact pixel positions of the register fields are in the `.dfm` (`SIM68Ku.dfm:60-797`); the logical arrangement is:

```
        col 1          col 2          col 3          col 4          right-hand block
row 1   D0=xxxxxxxx    D4=xxxxxxxx    A0=xxxxxxxx    A4=xxxxxxxx        T S  INT   XNZVC      Cycles
row 2   D1=xxxxxxxx    D5=xxxxxxxx    A1=xxxxxxxx    A5=xxxxxxxx    SR=bbbbbbbbbbbbbbbb   [   cycles]
row 3   D2=xxxxxxxx    D6=xxxxxxxx    A2=xxxxxxxx    A6=xxxxxxxx    US=xxxxxxxx           [Clear Cycles]
row 4   D3=xxxxxxxx    D7=xxxxxxxx    A3=xxxxxxxx    A7=xxxxxxxx    SS=xxxxxxxx  PC=xxxxxxxx
 Address  --------Code---------   Line -----------Source----------->>
```

Labels are Courier New bold 13 px; edit fields are Courier New 13 px, 73 px wide (SR is 137 px).

---

## 3. Commands: menus, toolbar, shortcuts, context menus

### 3.1 Main menu

Source: `SIM68Ku.dfm:1175-1432` (menu) and `SIM68Ku.dfm:1059-1174` (action list). Menu items that reference an action take their caption, shortcut and handler from the action unless the menu item overrides the caption. `&` marks the Alt-accelerator letter. Shortcut numbers in the `.dfm` decode as `value & 0xFF` = virtual key, `0x4000` = Ctrl (for example `16504 = 0x4078` = Ctrl+F9).

#### File (`&File`)

| Order | Component | Caption | Shortcut | Handler | What it does |
|---|---|---|---|---|---|
| 1 | `Open1` (action `Open`) | `&Open...` | Ctrl+O (16463) | `OpenExecute` | Section 8.2 |
| 2 | `OpenData1` (action `OpenData`) | `Open &Data...` | none | `OpenDataExecute` | Section 8.3 |
| - | separator | | | | |
| 3 | `Close1` (action `Close`) | `&Close` | none | `CloseExecute` | Section 8.5 |
| - | separator | | | | |
| 4 | `PrinterSetup1` | `&Printer Setup...` | none | `PrinterSetup1Click` | Opens the standard printer set-up dialog (`SIM68Ku.cpp:1376-1379`). The chosen printer is used by TRAP #15 task 10 printing. |
| - | separator | | | | |
| 5 | `Exit1` (action `Exit`) | `E&xit` | none | `ExitExecute` | Section 1.5 |

#### Search (`&Search`)

| Order | Component | Caption | Shortcut | Handler | What it does |
|---|---|---|---|---|---|
| 1 | `Search2` (action `Search`, caption overridden) | `&Find...` | Ctrl+F (16454) | `SearchExecute` | Shows the Find dialog non-modally (section 6.7) |
| - | separator | | | | |
| 2 | `GotoPC1` | `&Go to PC` | Ctrl+G (16455) | `GotoPC1Click` | Calls `highlight()`: re-selects and scrolls to the listing line of the current PC (section 6.4) |

#### Run (`&Run`)

| Order | Component | Caption | Shortcut | Handler | Section |
|---|---|---|---|---|---|
| 1 | `Run1` (action `Run`) | `&Run` | F9 (120) | `RunExecute` | 9.3 |
| - | separator | | | | |
| 2 | `RunToCursor1` (action `RunToCursor`) | `Run To &Cursor` | Ctrl+F9 (16504) | `RunToCursorExecute` | 9.4 |
| 3 | `AutoTrace1` (action `AutoTrace`) | `&Auto Trace` | F10 (121) | `AutoTraceExecute` | 9.7 |
| 4 | `StepOver1` (action `Step`) | `&Step Over` | F8 (119) | `StepExecute` | 9.5 |
| 5 | `TraceInto1` (action `Trace`) | `&Trace Into` | F7 (118) | `TraceExecute` | 9.6 |
| 6 | `Pause1` (action `Pause`) | `&Pause` | F6 (117) | `PauseExecute` | 9.8 |
| - | separator | | | | |
| 7 | `Reset1` (action `Rewind`) | `R&ewind Program` | Ctrl+F2 (16497) | `RewindExecute` | 9.10 |
| 8 | `Reload1` (action `Reload`) | `Re&load Program` | Ctrl+F3 (16498) | `ReloadExecute` | 9.11 |
| - | separator | | | | |
| 9 | `LogStart1` (action `LogStart`) | `L&og Start` | Ctrl+F4 (16499) | `LogStartExecute` | 13.3 |
| 10 | `LogStop1` (action `LogStop`) | `Lo&g Stop` | Ctrl+F5 (16500) | `LogStopExecute` | 13.5 |

#### View (`&View`)

| Order | Component | Caption | Handler | What it does |
|---|---|---|---|---|
| 1 | `OutputWindow1` | `&Output Window` | `OutputWindow1Click` | If the I/O window is in full-screen mode, leaves full-screen (`simIO->fullScreen = false; simIO->setupWindow();`); otherwise `simIO->Show()` (`SIM68Ku.cpp:1063-1071`) |
| 2 | `Memory1` | `&Memory` | `Memory1Click` | `MemoryFrm->Show()` |
| 3 | `Stack1` | `&Stack` | `Stack1Click` | `StackFrm->Show()` |
| 4 | `Hardware1` | `&Hardware` | `Hardware1Click` | `Hardware->Show()` |
| 5 | `BreakPoints1` | `&Break Points` | `BreakPoints1Click` | `BreaksFrm->Show()` |
| 6 | `EASyBIN1` | `&EASyBIN` | `EASyBIN1Click` | Starts `<exe dir>\EASyBIN.EXE` with no arguments and does not wait (`spawnl(P_NOWAITO, ...)`, `SIM68Ku.cpp:2149-2155`). No message if the file is missing. |

None of the View items has a shortcut or a check mark; they only show windows (there is no menu command to hide one - the user closes the window).

#### Options (`&Options`)

| Order | Component | Caption | Handler | Section |
|---|---|---|---|---|
| 1 | `SourceFont` (action `FontSource`) | `Source Window Font...` | `FontSourceExecute` | 14.1 |
| 2 | `OutputFont` (action `FontOutput`) | `Output Window Font...` | `FontOutputExecute` | 14.1 |
| 3 | `PrinterFont1` (action `FontPrinter`) | `Printer Font...` | `FontPrinterExecute` | 14.1 |
| - | separator | | | |
| 4 | `LogOutput1` | `&Log Output...` | `LogOutput1Click` | 13.2 |
| - | separator | | | |
| 5 | `ExceptionsEnabled` | `&Enable Exceptions` (check item) | `ExceptionsEnabledClick` | 14.1 |
| - | separator | | | |
| 6 | `SimulatorOptions` | `&Auto Trace Options...` | `SimulatorOptionsClick` | 14.1 |
| - | separator | | | |
| 7 | `mmuFullscreenOptions` | `&Fullscreen Options...` | `mmuFullscreenOptionsClick` | 14.1 |
| - | separator | | | |
| 8 | `BitFieldEnabled` | `Enable &Bit Field Instructions` (check item) | `BitFieldEnabledClick` | 14.1 |
| - | separator | | | |
| 9 | `OutputWindowSize1` | `Output Window &Size` (sub-menu) | `WindowSizeClick` on each child | 14.1 |
| 10 | `OutputWindowTextWrap1` | `Output Window Text &Wrap` (check item) | `OutputWindowTextWrap1Click` | 14.1 |

Sub-menu **Output Window Size** - nine radio items in this order, each with `Tag` 0..8: `640x480` (checked by default), `800x600`, `1024x768`, `1280x800`, `1280x1024`, `1440x900`, `1680x1050`, `1920x1080`, `1920x1200` (`SIM68Ku.dfm:1358-1414`).

#### Help (`&Help`)

| Order | Component | Caption | Handler | What it does |
|---|---|---|---|---|
| 1 | `Help2` (action `Help`) | `&Sim68K Help` | `HelpExecute` | `displayHelp("SIM_BASIC")` - see section 16.1 for which page actually opens |
| 2 | `About1` (action `About`, caption overridden) | `&About Sim68K` | `AboutExecute` | Shows the About box modally (section 16.2) |

### 3.2 Toolbar

Source: `SIM68Ku.dfm:798-954`. Buttons left to right; every button is linked to the action of the same-named menu item and shows a tool-tip hint.

| Order | Component | Hint | Action | Image index |
|---|---|---|---|---|
| 1 | `ToolOpen` | `Open` | `Open` | 0 |
| - | separator | | | |
| 2 | `ToolRun` | `Run` | `Run` | 3 |
| - | separator | | | |
| 3 | `ToolRunToCursor` | `Run To Cursor` | `RunToCursor` | 13 |
| 4 | `ToolAutoTrace` | `Auto Trace` | `AutoTrace` | 12 |
| 5 | `ToolStep` | `Step Over` | `Step` | 5 |
| 6 | `ToolTrace` | `Trace Into` | `Trace` | 4 |
| 7 | `ToolPause` | `Pause` | `Pause` | 7 |
| - | separator | | | |
| 8 | `ToolReset` | `Rewind Program` | `Rewind` | 8 |
| - | separator | | | |
| 9 | `ToolReload` | `Reload Program` | `Reload` | 14 (initially disabled) |
| - | separator | | | |
| 10 | `ToolLogStart` | `Log Start` | `LogStart` | 16 |
| 11 | `ToolLogStop` | `Log Stop` | `LogStop` | 17 |
| 12 | `LoggingLbl` (a label, not a button) | - | - | text `LOGGING`, bold, yellow background, hidden unless a log file is open (`SIM68Ku.dfm:935-953`) |

There are no toolbar buttons for Open Data, Close, Exit, Find, the View items or the Options items.

### 3.3 Context (right-click) menus

There is exactly one: `BreakMenu` (`SIM68Ku.dfm:2253-2259`), attached to the breakpoint gutter `breakP` only. It has one item, caption `Clear All PC Breakpoints`, handler `ClearAllPCBreakpoints1Click` which calls `BreaksFrm->cbpoint(-1)` (`SIM68Ku.cpp:777-781`): all simple PC breakpoints are removed (advanced breakpoints are untouched).

The listing, message area, memory window, stack window and I/O window have no context menu of their own. (Edit fields get the standard Windows edit-control menu; that is Windows behaviour, not EASy68K.)

### 3.4 Other keyboard handling on the main window

`TForm1::FormKeyDown` (`SIM68Ku.cpp:1301-1312`), active because `KeyPreview = True`:

```cpp
if (disableKeyCommands)
  return;
if (Key == VK_F1)
  Form1->displayHelp("SIM_BASIC");
else if (Key == VK_TAB && Shift.Contains(ssCtrl))    // if Ctrl+Tab
  simIO->BringToFront();
```

**Ctrl+Tab window cycle.** Each window passes focus to the next one, skipping windows that are not visible:

| From | Ctrl+Tab goes to | If target not visible, falls through to | Source |
|---|---|---|---|
| Main window | I/O window | Memory | `SIM68Ku.cpp:1310-1311`, `simIOu.cpp:567-578` |
| I/O window | Memory | Stack | `simIOu.cpp:434-435`, `Memory1.cpp:513-519` |
| Memory | Stack | Hardware | `Memory1.cpp:300-303, 503-506`, `Stack1.cpp:177-183` |
| Stack | Hardware | Break Points | `Stack1.cpp:172-173`, `hardwareu.cpp:1336-1342` |
| Hardware | Break Points | Main window | `hardwareu.cpp:1331-1332`, `BREAKPOINTSu.cpp:1195-1201` |
| Break Points | Main window | - | `BREAKPOINTSu.cpp:1190-1191` |

**F1** opens help in the main, memory, stack, Break Points, Hardware, Log Output and About windows, each with its own context word (section 16.1). The Find, Auto Trace Options, Fullscreen Options and Log File Options dialogs and the I/O window have no F1 handler.

**Scope of the F-key shortcuts.** The shortcuts in 3.1 belong to the main window's menu. VCL-inferred: VCL forwards unhandled shortcut keys from any application window to the main form's menu, so F9, F7, etc. also work while the I/O window (or any other Sim68K window) has focus, as long as no modal dialog is open. This is the reason TRAP #15 task 24 exists (3.5). A shortcut whose menu item is disabled does nothing (VCL-inferred).

### 3.5 Shortcut suppression by the running program (TRAP #15 task 24)

`CODE9.CPP:886-892`: task 24 with `D1 = 1` calls `Form1->setMenuTask19()`, with `D1 = 0` calls `Form1->restoreMenuTask19()` (the function names say "19" for historical reasons).

`setMenuTask19` (`SIM68Ku.cpp:619-633`) sets the `ShortCut` of these eleven actions to 0 and sets `disableKeyCommands = true`: `Open`, `Run`, `Step`, `Trace`, `Pause`, `Rewind`, `Reload`, `AutoTrace`, `RunToCursor`, `LogStart`, `LogStop`. Consequences while suppressed:

- Ctrl+O, F9, F8, F7, F6, Ctrl+F2, Ctrl+F3, F10, Ctrl+F9, Ctrl+F4, Ctrl+F5 do nothing (the menu items and toolbar buttons still work with the mouse).
- **Ctrl+F (Find) and Ctrl+G (Go to PC) are not suppressed** - the `Search` action and the `GotoPC1` item are not in the list.
- F1 and Ctrl+Tab on the main window are ignored (`SIM68Ku.cpp:1304-1305`).
- In the I/O window Ctrl+Tab, Alt+Enter and Shift+Insert are ignored and the key event is cleared (`simIOu.cpp:428-432`).

`restoreMenuTask19` (`SIM68Ku.cpp:636-650`) restores the saved shortcuts and clears `disableKeyCommands`. It is also called by `initSim()` (`STARTSIM.CPP:124`), so Rewind, Reload, Open and Close always re-enable the shortcuts.

### 3.6 Enabled/disabled state of the commands

Three helper functions change the enabled state of nine commands. They set the menu items and the toolbar buttons directly.

`setMenuActive()` (`SIM68Ku.cpp:560-581`) - **does nothing if the auto-trace timer is enabled** (`if (AutoTraceTimer->Enabled) return;`), otherwise enables: Open, Close, Run, Run To Cursor, Auto Trace, Step Over, Trace Into, Pause, Rewind Program.

`setMenuInactive()` (`SIM68Ku.cpp:585-604`) disables those same nine.

`setMenuTrace()` (`SIM68Ku.cpp:608-616`) calls `setMenuInactive()` and then re-enables **Pause, Rewind Program and Close**. Result ("busy" state): Open, Run, Run To Cursor, Auto Trace, Step Over, Trace Into are disabled.

When each state is entered:

| Event | State afterwards | Source |
|---|---|---|
| Start-up, Open, Reload, Close, Rewind (all through `initSim`) | all nine enabled | `STARTSIM.CPP:83` |
| Run, Step Over or Trace Into is invoked | busy (`setMenuTrace`) | `SIM68Ku.cpp:443, 503, 517` |
| Execution stops in trace mode and the program has not halted | all nine enabled, unless the auto-trace timer is still enabled (then no change, i.e. still busy) | `RUN.CPP:707-711` |
| Execution stops because the program halted (SIMHALT, TRAP #15 task 9, STOP, error with exceptions off) | busy (`setMenuTrace`) | `RUN.CPP:707-708` |
| Pause | all nine enabled, unless the auto-trace timer was enabled when Pause was processed (Quirk, section 9.8) | `SIM68Ku.cpp:535-537` |
| Keyboard input requested by the program completes while `trace` is true | all nine enabled | `simIOu.cpp:1366-1371` |

Commands not managed by these functions:

- **Reload Program**: disabled at start (`SIM68Ku.dfm:907, 1264`), enabled the first time an S-record file loads successfully (`SIM68Ku.cpp:294-295`), never disabled again.
- **Log Start / Log Stop**: section 13.6.
- **Open Data, Printer Setup, Exit, Find, Go to PC, every View item, every Options item, both Help items**: always enabled, including while a program is running.

Important consequence of the halted state: after SIMHALT the user cannot Run, Step, Trace **or use File > Open** until they press **Pause** (which re-enables everything without resetting anything) or **Rewind Program** (drag-and-drop of a file still works). Run is also enabled at start-up with no program loaded; memory is then all `0xFF`, and the word pair `FFFF FFFF` at PC = 0 is the SIMHALT pattern, so Run halts immediately.

---

## 4. Register display

### 4.1 Which registers and in what format

Nineteen edit fields plus the SR field (`SIM68Ku.dfm:384-796`), refreshed by `scrshow()` (`STARTSIM.CPP:130-175`):

| Label | Field | Value shown | Format |
|---|---|---|---|
| `D0=` .. `D7=` | `regD0`..`regD7` | `D[0]`..`D[7]` | `"%08lX"` - 8 upper-case hex digits |
| `A0=` .. `A6=` | `regA0`..`regA6` | `A[0]`..`A[6]` | same |
| `A7=` | `regA7` | the **active** stack pointer `A[a_reg(7)]`: `A[8]` when the S bit of SR is 1, otherwise `A[7]` (`UTILS.CPP:229-237`) | same |
| `US=` | `regUS` | user stack pointer `A[7]` | same |
| `SS=` | `regA8` | supervisor stack pointer `A[8]` | same |
| `PC=` | `regPC` | `PC` | same |
| `SR=` | `regSR` | status register | 16 characters `0`/`1`, bit 15 first (`STARTSIM.CPP:158-166`) |

Above the SR field is the fixed label `SRflags` with caption `T S  INT   XNZVC` (`SIM68Ku.dfm:312-325`). Its 16 characters line up one-to-one with the 16 bit characters of the SR field: bit 15 = `T`, bit 13 = `S`, bits 10-8 = `INT` (interrupt mask), bit 4 = `X`, 3 = `N`, 2 = `Z`, 1 = `V`, 0 = `C`; the other positions are blank. There is no separate decoded flag display.

All numbers are hexadecimal except SR, which is binary. There is no decimal view, no ASCII view and no per-register size selector.

The fields are `TMaskEdit` controls with `EditMask = 'aaaaaaaa;0;0'` (8 characters, blank character `'0'`); SR uses `'9999999999999999;0;0'` (`SIM68Ku.dfm:390, 735`). VCL-inferred: a field therefore always holds exactly 8 (or 16) characters, typing overwrites the character at the caret, and a deleted position shows `0`.

### 4.2 When the display is refreshed

`scrshow()` rewrites every register field, the cycle counter and SR. It is called only:

- from `initSim()` (start-up, Open, Reload, Close, Rewind) - `STARTSIM.CPP:70`;
- when execution stops (`trace || halt`) at the end of `runprog()` - `RUN.CPP:705`;
- when a STOP instruction halts - `RUN.CPP:900, 956`;
- on Pause - `SIM68Ku.cpp:534`;
- when keyboard input completes while tracing - `simIOu.cpp:1369`;
- on the Hardware window's Reset button - `hardwareu.cpp:789`.

**During a full-speed Run the register fields, cycle counter, listing highlight, stack window and (non-live) memory window are not updated at all.** They show the values from the moment Run was pressed until the program stops.

At the end of `scrshow()`:

```cpp
// If NOT (auto trace AND display is disabled)
if(!(autoTraceInProgress && AutoTraceOptions->DisableDisplay->Checked))
{
  Form1->highlight();              // highlight the instruction
  Form1->ListBox1->Repaint();
  StackFrm->updateDisplay();
  MemoryFrm->Repaint();
}
```

So with "Disable display update" checked, an auto-trace step still rewrites the register text fields and the cycle counter but skips the listing highlight, the stack window and the memory window (`STARTSIM.CPP:167-174`).

### 4.3 Highlighting of changed values

**There is none.** No code changes the colour, font or background of a register field; the only colour assignment in `SIM68Ku.cpp` is the gutter background (`SIM68Ku.cpp:928`). A port that highlights changed registers is adding a feature.

### 4.4 Editing registers

The fields are always editable (never disabled or read-only), also while a program is running.

**Key filtering.** For every register except SR, `regKeyPress` (`SIM68Ku.cpp:1074-1083`) accepts `0-9`, `a-f`, `A-F` (lower case is converted to upper case) and rejects everything else with a beep. For SR, `regSRKeyPress` (`SIM68Ku.cpp:1026-1041`):

```cpp
if (regSR->SelLength > 1)     // allow only one char to be changed at a time
  regSR->SelLength = 1;
if (Key == VK_BACK) {
  regSR->SelLength = 0;
  Key = '0';
}
if (Key<'0' || Key>'1') {
  Beep();                     // allow only 0's and 1's
  regSR->SelLength = 0;
  Key = '0';
}
```

Note that in the SR field Backspace and any invalid key **type a `0`** at the caret (they are not swallowed).

**When an edited value reaches the CPU.** This is the central rule: every run command (Run, Run To Cursor, Step Over, Trace Into, each Auto Trace tick) begins with `loadRegs()` (`SIM68Ku.cpp:990-1021`), which parses the text of the fields back into the CPU variables:

```cpp
SR = 0;
for (int j=15;j>=0;j--)
  if (regSR->EditText[16-j] == '1')
    SR = SR | 1<<j;
D[0] = StrToInt(str + regD0->EditText);   // str is "0x"
...
A[6] = StrToInt(str + regA6->EditText);
A[a_reg(7)] = StrToInt(str + regA7->EditText);
A[8] = StrToInt(str + regA8->EditText);
PC = OLD_PC = StrToInt(str + regPC->EditText);
```

Consequences:

- The screen fields are the source of truth at the start of every run command. An edit to D0-D7, SR or PC takes effect on the next run command.
- The order matters: SR is loaded first, so `a_reg(7)` uses the edited S bit; then the `A7` field is stored into the active stack pointer; then the `SS` field unconditionally overwrites `A[8]`. The `US` field is **not** read by `loadRegs()` (it is applied by its own key handler, below).
- Any `scrshow()` that happens before the next run command (Pause, Rewind, ...) overwrites un-applied edits of D0-D7, SR and PC with the CPU's values.
- A non-hex character pasted into a field makes `StrToInt` throw; the VCL default handler shows an error box and the command is aborted (VCL-inferred).

**Address registers are applied immediately.** Each of `regA0`..`regA6` has an `OnKeyUp` handler that stores the field into `A[n]` at once and refreshes the stack window (`SIM68Ku.cpp:1093-1147`). The three stack-pointer fields mirror each other on key-up:

| Field edited | Effect (`SIM68Ku.cpp:1150-1184`) |
|---|---|
| `A7` | If SR field character 3 (the S bit) is `'1'`: copy the text into the `SS` field and set `A[8]`. Otherwise copy the text into the `US` field and set `A[7]`. |
| `US` | If the S bit character is `'0'`, copy the text into the `A7` field. Always set `A[7]`. |
| `SS` | If the S bit character is `'1'`, copy the text into the `A7` field. Always set `A[8]`. |

Because these handlers write the CPU variables directly, typing in an address-register field while a program is running changes the running program's register (Quirk).

**SR change handler.** Whenever the SR field text changes (by typing or by `scrshow()`), `regSRChange` (`SIM68Ku.cpp:1043-1052`) rewrites the `A7` field from `A[8]` if character 3 of the SR text is `'1'`, else from `A[7]`, and refreshes the stack window. Toggling the S bit therefore immediately swaps what the `A7` field shows.

**PC change handler.** Whenever the PC field text changes, `regPCChange` (`SIM68Ku.cpp:1186-1194`) refreshes the stack window and calls `highlight()` (unless an auto-trace step is in progress with display update disabled). Typing a PC value therefore moves the listing highlight to the matching line as soon as the 8 digits equal a listing address.

**Double-click.**

- On `PC`: `highlight()` (`SIM68Ku.cpp:1405-1408`).
- On `A0`..`A7`, `US`, `SS`: copies the field's 8 digits into the memory window's Address field and shows the memory window (`regDblClick`, `SIM68Ku.cpp:1411-1415`; the memory window then snaps the address down to a multiple of 16, section 10.3).
- On `D0`..`D7` and `SR`: nothing (no handler in the `.dfm`).

Tab order: D0-D7, A0-A7, SR, PC, SS, Clear Cycles, US (`TabOrder` values in `SIM68Ku.dfm`).

> **Corrected (erratum W2 12).** The kit's masked field (`app/src/ui/components/masked.ts`), where hardware §12 V1 leaves the keystrokes open: Delete clears the position at the caret and keeps the caret, Backspace clears the one before and moves onto it, with a selection both clear it; a key at the end of a full field is refused; Home and End (and with Shift) move to the ends on every system, as a Windows text box does (erratum W2 12); the register fields select their text on keyboard focus (not on a mouse click, erratum W2 15), SR and the Hardware fields do not (`AutoSelect = False`). SR Backspace follows this section (types a `0` at the caret); the VCL may instead clear the position before the caret: open, to be confirmed under Wine (erratum W2 7).

---

## 5. Cycle counter

- Global `unsigned __int64 cycles` (`var.h:58`), incremented by `inc_cyc(n)` in the core (`UTILS.CPP:165-170`).
- Displayed in `cyclesDisplay`, a right-justified sunken static text under the label `Cycles` (`SIM68Ku.dfm:340-352, 748-767`), refreshed only by `scrshow()`:

```cpp
if (cycles > 0xFFFFFFFFFFFF)
  Form1->cyclesDisplay->Caption = "Overflow";
else
  Form1->cyclesDisplay->Caption = str.sprintf("%u",cycles);
```

(`STARTSIM.CPP:152-155`.) The value is decimal with no thousands separators. The text `Overflow` appears above 2^48 - 1. **Quirk / UNVERIFIED:** `"%u"` is a 32-bit conversion applied to a 64-bit argument; on 32-bit x86 this prints only the low 32 bits, so the display would wrap at 4 294 967 296 cycles. Confirm on the real binary before relying on either behaviour.

- **Clearing.** The `Clear Cycles` button (`ClearCyclesClick`, `SIM68Ku.cpp:1256-1262`) sets `cycles = 0` and shows `0`; it works at any time, including while running. `initSim()` also sets `cycles = 0` (Rewind, Reload, Open, Close; `STARTSIM.CPP:61`). TRAP #15 task 30 clears it and task 31 reads it (`CODE9.CPP:897-905`).
- The counter is not editable and is not written to any log.

---

## 6. Source / listing pane

### 6.1 What is shown

The pane is an owner-drawn list box (`ListBox1`, `lbOwnerDrawFixed`, item height 16 px, Courier New 13 px by default, `SIM68Ku.dfm:984-1004`) holding the **raw lines of the `.L68` listing file**, one line per row, loaded with `ListBox1->Items->LoadFromFile` (`SIM68Ku.cpp:300`). Nothing is filtered: the three header lines, comment lines, data lines, the symbol table and the "No errors detected" trailer are all shown.

The heading label above the pane is the constant (`SIM68Ku.cpp:33`):

```
 Address  --------Code---------   Line -----------Source----------->>
```

A listing line written by the EASy68K assembler has this fixed layout (`c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\LISTING.CPP:129, 157-159, 183-185`): columns 1-8 the address as 8 hex digits, column 9 `=` for some directives or a space, columns 11-32 the object code, columns 33-38 the source line number (`%6d`), then the source text starting at column 41. The first three lines of every `.L68` file are a header (`LISTING.CPP:107-110, 281`):

```
00001000 Starting Address
Assembler used: EASy68K Editor/Assembler v5.16.01
Created On: 3/15/2018 2:05:33 PM
```

where the first 8 characters are the program's start address. This is why most of the code below ignores row indexes 0-2.

When drawing a row (`ListBox1DrawItem`, `SIM68Ku.cpp:654-688`) tab characters are expanded to 8-column tab stops and the text is shifted left by the horizontal scroll position (6.3).

**When no listing is available** (no `.L68` next to the `.S68`, section 8.2) the pane shows these nine fixed lines (`SIM68Ku.cpp:342-350`):

```
A matching .L68 file was not found. The .L68 file
is used to provide source level debugging.

Use EASy68K to assemble the source file to create
a properly formatted .L68 file and make sure the
.L68 and .S68 files are in the same directory.

You may run the program without an .L68 file but
source level debugging will not be available.
```

and the message area gets the line `Unable to open .L68 file.` The program can still be run, traced and stepped; there is no disassembly. With no file loaded at all the pane is empty.

### 6.2 "Instruction line" test

Several features only apply to rows that hold an instruction. The test is `isInstruction` (`SIM68Ku.cpp:856-864`), using 1-based character positions:

```cpp
if (str.SubString(1,2) == "00" &&             // address
               str[11] != ' ' &&              // data present
               str[9] != '=' &&               // not DS or DC
               str[11] != '=')                // not EQU or SET
  return true;
return false;
```

So a row is an instruction row when its address starts with `00` (addresses below `$01000000`), it has object code, and it is not a `=`-marked directive line. Comment lines, label-only lines, blank lines, DC/DS lines, EQU/SET lines and the trailer text are not instruction rows. Callers additionally require row index > 2 (the header line `0000xxxx Starting Address` would otherwise pass the test).

> **Corrected (erratum U1 4).** A row that starts with `00` and is shorter than 11 characters would raise an exception in `isInstruction` (positions 9 and 11); the port treats it as no instruction row. No listing line the assembler writes is like that.

### 6.3 Horizontal scrolling

`ScrollBar1` (`Min = 1`, `Max = 200`, initial `Position = 1`, `SIM68Ku.dfm:971-983`) scrolls the listing text by whole characters. With position `p`, each row is drawn as `str.SubString(p, str.Length() - p + 1)` when `p < str.Length()`, otherwise as an empty string (`SIM68Ku.cpp:680-687`). The heading label scrolls with it while `p < 41` (`HEADING_LIMIT`, `SIM68Ku.cpp:34, 912-919`); from position 41 on the heading keeps its last text. Vertical scrolling is the list box's own scroll bar.

### 6.4 Current-instruction highlight

There is no separate "PC arrow". The current instruction is shown by making its row the **selected row of the list box** (`ListBox1->ItemIndex`), which Windows draws in the system selection colours. The same selection is what the user moves by clicking a row, and it is the "cursor" of Run To Cursor.

`highlight()` (`SIM68Ku.cpp:785-807`):

```cpp
for (i=3; i<ListBox1->Items->Count; i++) {
  str = ListBox1->Items->Strings[i];
  if (regPC->EditText == str.UpperCase().SubString(1,8))  // if current instruction
    if (isInstruction(str) || halt)           // if instruction or program halted
      ListBox1->ItemIndex = i;                // highlight line
}
// make sure current instruction line is on screen
if (ListBox1->ItemIndex > -1) {               // if line highlighted
  botIndex = ListBox1->TopIndex + ListBox1->Height/ListBox1->ItemHeight;
  if (ListBox1->ItemIndex < ListBox1->TopIndex ||
      ListBox1->ItemIndex > botIndex)             // if not on screen
    ListBox1->TopIndex = ListBox1->ItemIndex - 2; // position highlighted row
}
```

Exact rules:

- The comparison is between the **text of the PC field** and the first 8 characters of each row, upper-cased.
- The loop does not stop at the first match, so **the last matching instruction row wins** (a label line and its instruction share an address; macro expansions can repeat addresses).
- A non-instruction row is selected only when the program has halted (`halt` true). After SIMHALT the PC is 4 bytes past the SIMHALT opcode, so whatever row carries that address (often a data line) is selected.
- If no row matches, **the previous selection is left unchanged** (clearing it is commented out at `SIM68Ku.cpp:790`). The highlight can therefore be stale when the PC is in code that has no listing row.
- Scrolling: only if the selected row is above the first visible row or below row `TopIndex + Height/ItemHeight`, the list is scrolled so that the selected row becomes the **third visible row** (`TopIndex = ItemIndex - 2`). Otherwise the list does not move. The same scroll rule runs even when the selection did not change, so a stale selection that the user scrolled away from is scrolled back into view.

`highlight()` runs from `scrshow()`, from the PC field's change handler, from a double-click on the PC field and from Search > Go to PC (Ctrl+G).

**Scrolling behaviour while running or tracing.** During a full-speed Run nothing is redrawn or scrolled (4.2). While tracing or stepping each stop calls `scrshow()` and thus `highlight()`, so the listing follows the PC with the rule above. During Auto Trace with "Disable display update" checked the listing does not follow.

> **Corrected (erratum W4 9).** After a load the listing has no selected row unless the new start PC differs from the PC shown before the load: `OpenFile` calls `ListBox1->Items->Clear()` (`LB_RESETCONTENT`, so `ItemIndex` = -1), and only the assignment of a different PC text runs `regPCChange` -> `highlight()`. Measured on the official program for the ten official examples in both orders (erratum W4 12); the port gives the same answers (the shim's `listingItemsCleared` hook).

### 6.5 Simple (PC) breakpoints in the gutter

The gutter `breakP` to the left of the listing draws one 16 px dot per visible instruction row (`breakPPaint`, `SIM68Ku.cpp:692-733`):

- image 10 of `ImageList1`, a **green dot**, on an instruction row with no breakpoint;
- image 11, a **red dot**, on an instruction row whose address is in the breakpoint table;
- nothing on rows that are not instruction rows (index <= 2 or `isInstruction` false).

A **left click** in the gutter (`breakPMouseDown`, `SIM68Ku.cpp:738-773`) computes the row as `Y/ListBox1->ItemHeight + ListBox1->TopIndex`; if it is an instruction row with index > 2 its address (`StrToInt("0x" + first 8 characters)`) is toggled: `BreaksFrm->cbpoint(addr)` if present, `BreaksFrm->sbpoint(addr)` if not. Clicking a non-instruction row does nothing. A click below the last row raises an exception that is reported as the box `Invalid Breakpoint Selection`.

A **right click** opens the one-item menu `Clear All PC Breakpoints` (3.3).

The breakpoint table is `int brkpt[100]` with count `char bpoints` (`var.h:65-66`). `sbpoint` ignores an address that is already present and shows `Breakpoint Limit Reached!` when 100 are set (`BREAKPOINTSu.cpp:112-129`). `cbpoint(-1)` clears all; `cbpoint(addr)` removes one and closes the gap (`BREAKPOINTSu.cpp:132-156`). Breakpoints are stored by **address**, not by row, and are not saved to disk.

When simple breakpoints are cleared automatically: File > Open (before the file dialog appears, so even if the dialog is cancelled; `SIM68Ku.cpp:370`), File > Close (`SIM68Ku.cpp:435`). They are **kept** by Rewind, Reload and drag-and-drop.

Breakpoints set from the source: section 8.2 step 7 (`*[sim68k]break`).

How a breakpoint stops the program: section 9.2.

### 6.6 Mouse actions on the listing

- **Single click** selects a row (standard list-box behaviour; `ExtendedSelect = False`, one row at a time). This moves the highlight away from the PC row; Ctrl+G brings it back.
- **Double click** (`ListBox1DblClick`, `SIM68Ku.cpp:1322-1330`): if the selected row passes `isInstruction`, its first 8 characters are written into the PC field - "set PC to this line". There is no index > 2 check here, so double-clicking the first header row sets the PC to the program start address. The new PC takes effect on the next run command (4.4).

### 6.7 Find

Search > Find... (Ctrl+F) shows `findDialogFrm` (`findDialogS.dfm`): a stay-on-top, non-modal dialog captioned `Find` with the label `Fi&nd what:`, an edit box, a button `Find  (F3)` (default button, disabled while the edit box is empty) and a button `Cancel` (closes the dialog).

`TForm1::find(searchStr, next)` (`SIM68Ku.cpp:818-851`):

- The search is a case-insensitive substring search over the **whole raw row text** (address, object code and line number columns included).
- A static row index `i` remembers the position. `next == false` restarts at row 3; `next == true` continues from the row after the previous hit.
- On a hit the row is selected (`ListBox1->ItemIndex = i++`) and scrolled into view with the same rule as `highlight()`.
- If nothing is found, nothing happens: no message, no wrap-around, the selection is unchanged, and further "next" searches return immediately because `i` is at the end.

The button passes `next = false` the first time and `true` afterwards; changing the text or re-showing the dialog resets it to `false` (`findDialogS.cpp:18-55`). Pressing **F3 while the Find dialog has focus** always searches with `next = true` (`findDialogS.cpp:58-65`). F3 does nothing in the main window.

> **Corrected (erratum U1 3).** A Find that finds nothing still scrolls the selected row into view: `TForm1::find` (`SIM68Ku.cpp:833-850`) runs the "make sure highlighted line is on screen" block after the loop whether or not a row matched. Find upper-cases ASCII letters only (`toupper` on a signed `char`; `é` does not match `É`; erratum U1 5).

---

## 7. Message area and status line

### 7.1 Message area

`Message` is a read-only `TMemo` (vertical scroll bar, no word wrap, not a tab stop; `SIM68Ku.dfm:1005-1024`) under the listing. Lines are only ever appended (`Message->Lines->Add`); the area is cleared in exactly one place, at the start of loading a program (`SIM68Ku.cpp:288`). It is not cleared by Rewind, Close or Open Data. It uses the same font as the listing.

**Every traced instruction adds a line** (`RUN.CPP:771-777`), before the instruction executes:

```cpp
if(inst == 0xFFFF && temp == 0xFFFF)  // if SIMHALT command
  sprintf(buffer,"PC=%08X  Code=%04X  SIMHALT", PC-2, inst);
else
  sprintf(buffer,"PC=%08X  Code=%04X  %s", PC-2, inst, inst_arr[i].name);
Form1->Message->Lines->Add(buffer);
```

Example: `PC=00001000  Code=103C  MOVE`. (`PC-2` is the instruction address because the opcode word has just been fetched; `inst_arr[i].name` is the core's mnemonic table entry.) Nothing is added for instructions executed at full speed.

### 7.2 Catalogue of message-area texts

`%4x`/`%04x` are lower-case hex.

| Text | When | Source |
|---|---|---|
| `S0 = <text>` | For each S0 record of a loaded file; the EASy68K header gives `S0 = 68KPROG   20CREATED BY EASY68K` | `SIMOPS2.CPP:244-257` |
| `.S68 file read successful` | Load finished without a format error | `SIMOPS2.CPP:370` |
| `Checksum error on line %d...` | S-record checksum mismatch (load continues) | `SIMOPS2.CPP:256, 360` |
| `Invalid Address on line %d...` | S-record address outside 0..$FFFFFF | `SIMOPS2.CPP:351` |
| `Invalid data on line %d of .S68 file...`, then `%d: <line text>`, then `Remainder of load stopped...` | S-record format error | `SIMOPS2.CPP:366-368` |
| `error: cannot open file %s` | File could not be opened | `SIMOPS2.CPP:219` |
| `Unexpected Error reading .S68 file` | Exception while loading | `SIMOPS2.CPP:376` |
| `Unable to open .L68 file.` | No listing file found | `SIM68Ku.cpp:341` |
| `Unexpected error in OpenFile` / `Unexpected error in OpenDataExecute` / `Unexpected error in runLoop` | Exception in those functions | `SIM68Ku.cpp:360, 386, 262` |
| `PC=%08X  Code=%04X  <mnemonic>` | Each traced instruction (7.1) | `RUN.CPP:773-777` |
| `break point at %04x` | PC equals a simple breakpoint, or an advanced breakpoint expression fired (one line per hit) | `RUN.CPP:661, 680` |
| `Address or Bus error during exception processing. Execution halted` | `errflg` set | `RUN.CPP:654` |
| `STOP instruction. Execution halted` | STOP with exceptions enabled (once) | `RUN.CPP:898` |
| `Illegal instruction found at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:939-940` |
| `supervisor privilege violation at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:943-944` |
| `CHK exception occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:947-948` |
| `STOP instruction executed at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:952-953` |
| `TRAP exception occurred at location %4x. Execution halted` | exceptions disabled, TRAP other than the simulator's #15 services | `RUN.CPP:960-961` |
| `TRAPV exception occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:964-965` |
| `Divide by zero occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:968-969` |
| `Execution halted` | address or bus error result, exceptions disabled (follows a `Bus Error:`/`Address Error:` line) | `RUN.CPP:971-976` |
| `Trace exception occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:978-979` |
| `Line 1010 Emulator exception occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:982-983` |
| `Line 1111 Emulator exception occurred at location %4x. Execution halted` | exceptions disabled (includes `FFFF FFFF` when SIMHALT is turned off) | `RUN.CPP:986-987` |
| `Unknown execution error %4x occurred at location %4x. Execution halted` | exceptions disabled | `RUN.CPP:990-991` |
| `TRACE exception occurred at location %4x. Execution halted` | exceptions disabled and the T bit of SR is set after an instruction | `RUN.CPP:994-999` |
| `Error during Exception Handler: SSP odd or outside memory space ` then `at location %4x` | exceptions enabled, bad SSP | `RUN.CPP:1046-1048` |
| `Bus Error: Instruction at %4x accessing address %4x` | exceptions disabled | `UTILS.CPP:262-263, 278-279, 293-294, 308-309, 460-461, 475-476` |
| `Address Error: Instruction at %4x accessing address %4x` | exceptions disabled | `UTILS.CPP:360-361, 436-437` |
| `Error in <function>` and similar | internal errors of the I/O window (about 50 sites in `simIOu.cpp`) | e.g. `simIOu.cpp:129` |

### 7.3 Status line

`StatusBar1` (`SIM68Ku.dfm:1045-1058`) has two panels, 75 px and 50 px wide, and **no code ever writes to it**. It is an empty bar. The only status indicator in the main window is the `LOGGING` label on the toolbar (13.6).

---

## 8. Start-up, command line, opening and closing programs

### 8.1 Command line

`SIM68K.exe [file.S68] [/r] [/f] [/e] [/b]` - parsed in `FormShow` after settings are loaded and the simulator is initialised (`SIM68Ku.cpp:1212-1238`):

```cpp
if (ParamCount() > 0)         // if parameters are present
{
  fileName = ParamStr(1);     // get file name to open
  ext = ExtractFileExt(fileName.UpperCase());     // get file extension
  if (FileExists(fileName) && ext == ".S68") {
    OpenDialog1->FileName = fileName;         // save for reload
    OpenFile(fileName);       // open specified file
    Log->setLogFileNames(fileName);
  }
}
// check for additional command line parameters       CK 1-25-2008
for (int i=2;i<=ParamCount();i++)
{
  if (LowerCase(ParamStr(i)) == "/r")
    clRun = true;
  else if (LowerCase(ParamStr(i)) == "/f") {
    simIO->fullScreen = true;
    simIO->setupWindow();
  } else if (LowerCase(ParamStr(i)) == "/e") {
    exceptions = true;
    ExceptionsEnabled->Checked = true;
  } else if (LowerCase(ParamStr(i)) == "/b") {
    bitfield = true;
    BitFieldEnabled->Checked = true;
  }
}
```

Exact rules:

- **Argument 1 is always treated as a file name.** It is loaded only if the file exists and its extension is `.S68` in any letter case. Otherwise it is silently ignored (no error message).
- **Switches are recognised only in argument positions 2 and later**, in any order, case-insensitively, and only with a leading `/` (not `-`). A switch given as the first argument is ignored. Unknown arguments are ignored.
- Switches are still processed when argument 1 was not a loadable file.

| Switch | Effect |
|---|---|
| `/r` | Sets `clRun`; the program is started with the Run command the first time the main window is activated (1.4). It runs at full speed (not tracing). |
| `/f` | Puts the I/O window into full-screen mode immediately. |
| `/e` | Enables exception processing (same as checking Options > Enable Exceptions, but without an immediate save). |
| `/b` | Enables bit-field instructions (same as checking Options > Enable Bit Field Instructions, but without an immediate save). |

`/e` and `/b` are not written to the settings file at that moment, but the settings file is rewritten on exit with the then-current values, so they become sticky for later sessions (14.3).

There are no switches for logging, for auto-exit, for trace mode or for choosing a listing file.

When the EASy68K editor's "Execute" button starts the simulator it passes exactly one argument, the quoted `.S68` path, and no switches (`c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\assembleS.cpp:33-37`). The program is therefore loaded but **not** started.

### 8.2 Loading a program: `TForm1::OpenFile(name)` (`SIM68Ku.cpp:270-363`)

Used by File > Open, the command line, drag-and-drop and Reload. Steps in order:

1. `initSim()` - full simulator reset (9.9). This happens before anything is known about the file.
2. Every byte of 68000 memory is set to `0xFF` (`SIM68Ku.cpp:277-278`).
3. The byte at the Hardware window's toggle-switch address (default `$E00012`) is set to `0x00` (`SIM68Ku.cpp:281-282`).
4. `Hardware->initialize()` (switches off, auto-IRQ check boxes off; `hardwareu.cpp:44-63`) and `simhalt_on = true`.
5. The message area and the listing are cleared.
6. `loadSrec(name)` reads the S-record file into memory and sets `PC` from its S7/S8/S9 record (`SIMOPS2.CPP:203-379`; file format owned by another spec). It returns failure only if the file cannot be opened (or an internal exception occurs); a file with format errors still counts as loaded. On failure nothing further happens (empty listing, message `error: cannot open file ...`, window title unchanged, Reload not enabled).
7. On success: `startPC = PC`; Reload Program is enabled; then the listing is looked up:

   ```cpp
   str = ChangeFileExt(name,".L68");
   if (FileExists(str)) {
   ```

   **The listing file is the program file's path with the extension replaced by `.L68`** - same folder, same base name. On Windows the existence test is case-insensitive, so `prog.l68` also matches; a port on a case-sensitive file system must match the extension (and base name) case-insensitively to behave the same.

   If the listing exists:
   - It is loaded into the list box.
   - The first 8 characters of its **first line** are taken as the start address: if that string is `>= "00000000"` and `< "01000000"` (string comparison) it is written into the PC field. Then `startPC = PC = StrToInt("0x" + regPC->EditText)`. **The listing's start address therefore overrides the start address in the S-record.** If the first line is not in range the PC field keeps its previous text (the PC from before the load).
   - Every listing row is scanned, lower-cased, for three directives that must appear **at column 41** (the start of the source text):

     | Text at column 41 | Effect |
     |---|---|
     | `*[sim68k]break` (14 chars compared) | If the **next** row has index > 2 and is an instruction row, a simple PC breakpoint is set at that row's address (`sbpoint`). If the next row is a comment, blank or label-only row, nothing is set. |
     | `*[sim68k]bitfield` (17 chars) | `bitfield = true` and Options > Enable Bit Field Instructions is checked. |
     | `*[sim68k]simhalt_off` (20 chars) | `simhalt_on = false`: the opcode pair `FFFF FFFF` is no longer treated as SIMHALT (it becomes a normal line-1111 opcode). |

     The comparison is on the lower-cased row, so the directives are case-insensitive. `simhalt_on` is reset to true by every load; `bitfield` is **not** reset by a load (it stays on once set, and is saved to the settings file on exit).

   If the listing does not exist: the PC field is set from the S-record start address, `Unable to open .L68 file.` is added to the message area, and the nine explanatory lines of 6.1 are put in the listing pane.
8. The main window title becomes the file name exactly as passed (full path from the dialog; possibly a relative path from the command line).
9. The breakpoint and memory windows are repainted.

After `OpenFile`, the callers (except Reload) call `Log->setLogFileNames(name)` (13.1).

What the window shows after a successful load: title = file path; registers reset (D0-D7, A0-A6 = 0, US = `00FF0000`, SS = `01000000`, A7 = `01000000`, SR = `0010000000000000`, PC = start address, cycles 0); listing loaded, normally with the start row selected (the selection is made by the PC field's change handler, so it happens only if the row is an instruction row and the PC text actually changed - after a Reload of a program that had not moved from its start address no row is selected until the first step); message area showing the S0 line and `.S68 file read successful`; I/O window cleared; all nine run commands enabled; Reload enabled.

### 8.3 File > Open (Ctrl+O) and File > Open Data

`OpenExecute` (`SIM68Ku.cpp:368-375`):

```cpp
BreaksFrm->cbpoint(-1);  // clear all break points
if (OpenDialog1->Execute()) {
  OpenFile(OpenDialog1->FileName);
  Log->setLogFileNames(OpenDialog1->FileName);
}
```

The dialog filter is `EASy68K S-Record (*.S68)|*.S68|All Files (*.*)|*.*` (`SIM68Ku.dfm:2238`). There is no confirmation prompt, and all simple breakpoints are cleared even if the dialog is cancelled. Open is disabled while a program is running or halted (3.6).

`OpenDataExecute` (`SIM68Ku.cpp:379-389`) shows the **same** dialog object and calls only `loadSrec(fileName)`: the S-records are written into memory on top of whatever is there, with no reset of any kind. Its S0 and success messages are appended to the message area. Quirks:

- `loadSrec` sets the global `PC` from the data file's termination record, but the display is not refreshed and the next run command reloads PC from the PC field, so the change is normally lost.
- Because the same dialog object is used, `OpenDialog1->FileName` now names the data file, and **Reload Program reloads that data file as if it were the program** (9.11).
- Open Data is always enabled, even while the program runs.

> **Corrected (erratum SH8 12).** While a program is running there is no next run command: execution continues at the data file's start address after Open Data (seen with the engine; it follows from the same source lines). The sentence above holds for a stopped simulator.

### 8.4 Drag and drop

Dropping files from Explorer on the main window (`WmDropFiles`, `SIM68Ku.cpp:396-422`): if a program has been loaded before (`Reload1->Enabled`), a box titled `Caution` asks `The current debug environment will be lost, click OK to continue.` with OK / Cancel. On OK (or if no program was loaded), only the **first** dropped file is considered; if it exists and has extension `.S68` (any case) it is loaded exactly like the command-line file (`OpenDialog1->FileName` set, `OpenFile`, `setLogFileNames`). Other files are ignored silently. Simple breakpoints are not cleared.

### 8.5 File > Close

`CloseExecute` (`SIM68Ku.cpp:426-437`) shows the same `Caution` box; on OK:

```cpp
ListBox1->Clear();    // clear program
initSim();            // initialize simulator
BreaksFrm->cbpoint(-1);  // clear all break points
```

Not done: memory is not erased, PC is not changed, the window title is not reset, the message area is not cleared, Reload stays enabled and still reloads the last file, logging is not stopped.

---

## 9. Run control

### 9.1 State variables

| Variable | Type | Meaning | Declared |
|---|---|---|---|
| `runMode` | bool | true while `runLoop()` should keep executing instructions | `var.h:77` |
| `trace` | int | "trace mode": when non-zero each instruction is reported/logged and execution stops after it | `var.h:59` |
| `sstep` | int | "Step Over mode" | `var.h:59` |
| `stepToAddr` | int | return address at which a Step Over stops; 0 = none | `var.h:67` |
| `runToAddr` | int | Run To Cursor target; 0 = none | `var.h:68` |
| `halt` | bool | set by the core when the program has ended or died; cleared at the start of every `runprog()` | `var.h:61` |
| `stopInstruction` | bool | a STOP instruction is waiting for an interrupt (exceptions enabled) | `var.h:62` |
| `inputMode` | bool | the program is waiting for keyboard input in the I/O window | `var.h:87` |
| `autoTraceInProgress` | bool | an auto-trace tick is executing | `var.h:100` |
| `clRun` | bool | `/r` was given and has not been consumed yet | `SIM68Ku.cpp:31` |
| `startPC` | int (member of `TForm1`) | PC to restore on Rewind | `SIM68Ku.h:276` |
| `runModeSave`, `old_trace`, `old_sstep`, `done` | - | assigned or declared but never read; ignore | `var.h:59, 78`, `SIM68Ku.cpp:30` |

### 9.2 The execution loop and the stop checks

`runLoop()` (`SIM68Ku.cpp:249-266`):

```cpp
static bool running = false;
if (running)          // prevent nested calls
  return;
running = true;
try {
  while(runMode){
    runprog();          // run next 68000 instruction
    Application->ProcessMessages();
  }
}
catch( ... ) {
  Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in runLoop"));
}
running = false;
```

The loop is cooperative: after **every** instruction Windows messages are pumped (twice - once inside `runprog()` and once here), which is how Pause, Rewind, menu commands, key presses in the I/O window and repaints are handled while a program runs. A port must yield to its event loop in an equivalent way (not necessarily after every instruction) and must make sure that commands arriving during a yield see the same state.

`runprog()` (`RUN.CPP:638-721`) executes one instruction and then performs the stop checks, **in this order**:

1. `halt = false; exec_inst();` - execute one instruction (core). If `trace` is non-zero at that moment the instruction is first reported to the message area (7.1) and, if logging, to the execution log (13.4).
2. Pump messages; **while `inputMode && runMode`, keep pumping and sleeping 10 ms** - this is how a running program blocks for keyboard input. Note the condition: if `runMode` is false (Trace Into) the loop body runs once and falls through even though input is pending (9.13).
3. If `errflg`: `halt = true` and the message `Address or Bus error during exception processing. Execution halted`.
4. **Simple breakpoints**: for each entry, `if (PC == brkpt[i])` add the message `break point at %04x`, set `trace = true`, disable the auto-trace timer.
5. **Run To Cursor**: `if (PC == runToAddr) { trace = true; AutoTraceTimer->Enabled = false; runToAddr = 0; }`
6. **Advanced breakpoints**: for each defined expression, `if (bpExpressions[i].isBreak())` add `break point at %04x`, set `trace = true`, disable the auto-trace timer (12.2).
7. **Step Over**: `if (sstep) if (PC == stepToAddr) { trace = true; stepToAddr = 0; }`
8. `OLD_PC = PC`.
9. If `trace || halt`:
   - `runMode = false`;
   - turn off the Hardware window's automatic interrupt timers unless a STOP instruction is pending;
   - if the I/O window is full-screen on the same monitor as the main window, return it to windowed mode;
   - `scrshow()` (refresh registers, cycles, listing highlight, stack, memory);
   - if `halt`: `setMenuTrace()` (busy state); else `setMenuActive()`;
   - if `trace` and not `inputMode`: give the main window the focus.

Consequences of this ordering that a user can observe:

- **Breakpoints are tested after an instruction, against the new PC.** The program stops *before* executing the instruction at the breakpoint address when it arrives there. If the PC is already on a breakpoint when a run command is given, that instruction executes and no break occurs - so Run can always be used to continue from a breakpoint, and a breakpoint on the very first instruction does not trigger when running from the start.
- The instruction that led to the breakpoint was executed with `trace` false, so it is not in the message area or the execution log.
- **Quirk (can affect what a student sees):** `runToAddr` and `stepToAddr` use 0 for "none", and checks 5 and 7 do not test for that. A program whose PC becomes 0 (for example a jump through a null pointer) stops at once as if Run To Cursor had been reached, because `PC == runToAddr` is `0 == 0`.
- **Quirk:** `runToAddr` is cleared only when reached or by `initSim()`. If a Run To Cursor is interrupted (breakpoint, Pause), the stale target makes a later plain Run stop there once.

### 9.3 Run (F9) - `RunExecute` (`SIM68Ku.cpp:441-455`)

```cpp
setMenuTrace();               // disable some commands
BreaksFrm->resetDebug();      // Reset break condition counters
trace = false;
sstep = false;
loadRegs();                   // load registers from screen
runMode = true;               // enable runLoop()
runModeSave = runMode;        // save current runMode
if (simIO->Visible)
  simIO->BringToFront();      // display the output form
Hardware->autoIRQon();        // enable auto interrupt timers
runLoop();                    // enter runLoop
```

Run executes from the PC shown in the PC field, at full speed, with no display updates, until one of: a simple breakpoint, the Run To Cursor target, an advanced breakpoint expression, the program halts (9.12), Pause, Rewind, or an internal error. Run does not check that a program is loaded. Keyboard focus moves to the I/O window if it is visible. Of the run commands, only Run (and therefore Run To Cursor and `/r`) resets the advanced-breakpoint hit counters and calls `Hardware->autoIRQon()`.

### 9.4 Run To Cursor (Ctrl+F9) - `RunToCursorExecute` (`SIM68Ku.cpp:468-498`)

```cpp
try{
  str = ListBox1->Items->Strings[ListBox1->ItemIndex];
  if (ListBox1->ItemIndex > 2 && isInstruction(str))
  {
    addr = StrToInt("0x" + str.SubString(1,8)); // get address from line
    for (i = 0; i < bpoints; i++)
      if (brkpt[i] == addr)
        break;
    if (i >= bpoints)         // if this address is not already a break point
      runToAddr = addr;    // set runToAddress for break point
  }
  else
    Application->MessageBox("Selected line does not have a valid address.",NULL,mbOK);
}
catch(...)
{
  Application->MessageBox("Invalid Run-To-Cursor Selection",NULL,mbOK);
}
RunExecute(Sender);
```

- The "cursor" is the selected listing row. If it is an instruction row its address becomes `runToAddr` (unless that address already has a simple breakpoint, which will stop the run anyway), and Run is started.
- **Quirk:** `RunExecute` is called unconditionally - after either error box the program is run anyway, as a plain Run.
- The selected row is normally the current-PC row. Run To Cursor without first clicking another row therefore means "run until the PC comes back to this instruction" (the first execution does not stop, 9.2).
- With no row selected (`ItemIndex == -1`) or no listing, the `Invalid Run-To-Cursor Selection` box appears and then the program runs.
- The target is one-shot: reaching it sets `trace = true` and `runToAddr = 0`. No message is added to the message area.

### 9.5 Step Over (F8) - `StepExecute` (`SIM68Ku.cpp:501-512`)

```cpp
setMenuTrace();               // disable some commands
trace = true;
sstep = true;
stepToAddr = 0;               // reset step to address
loadRegs();                   // load registers from screen
runMode = true;               // enable runLoop()
runModeSave = runMode;        // save current runMode
runLoop();
```

Because `trace` is true the loop stops after one instruction (9.2 step 9) - unless that instruction is a **BSR or JSR**. Both contain (`CODE8.CPP:143-147` and `202-206`), after pushing the return address and before changing the PC:

```cpp
// set address to stop program execution if user selects "Step Over"
if (sstep && stepToAddr == 0) {  // if "Step Over" mode
  trace = false;              // do not trace through subroutine
  stepToAddr = PC;
}
```

At that point `PC` is the address of the instruction following the BSR/JSR (its return address). With `trace` now false the loop keeps running at full speed until `PC == stepToAddr`, where check 7 sets `trace = true` and the program stops on the instruction after the call.

Precise behaviour:

- **Only BSR and JSR are stepped over.** These are the only two places that set `stepToAddr`.
- **TRAP #15** is a single instruction to the simulator (the I/O service runs natively), so it is always executed as one step by both Step Over and Trace Into; there is nothing to step into.
- **Other TRAPs and all exceptions/interrupts with exceptions enabled** are *not* stepped over: Step Over stops on the first instruction of the 68000 handler, exactly like Trace Into.
- Nested calls inside the subroutine do not change `stepToAddr` (the `stepToAddr == 0` test). The stop test is only "PC equals the return address"; there is no stack-depth check, so a recursive routine stops the first time any activation returns to that address.
- While the subroutine runs, its instructions are not reported in the message area and **not written to the execution log**; the display is not updated.
- A breakpoint, Run-To-Cursor target, halt or Pause inside the subroutine stops execution there. If the subroutine never returns to that address, execution continues until one of those happens.
- If the stepped instruction (or the subroutine) requests keyboard input, Step Over waits for it (the commands stay in the busy state meanwhile).
- Step Over does not reset the advanced-breakpoint counters, does not bring the I/O window forward and does not call `Hardware->autoIRQon()`.

### 9.6 Trace Into (F7) - `TraceExecute` (`SIM68Ku.cpp:515-522`)

```cpp
setMenuTrace();               // disable some commands
trace = true;
sstep = false;
loadRegs();                   // load registers from screen
runprog();
```

Exactly one instruction is executed (one call of `runprog()`, not the loop), reported in the message area and logged, and the display is refreshed. BSR/JSR are entered. `runMode` stays false, which has two visible effects: `runprog()` does not wait for keyboard input (9.13), and TRAP #15 task 23 delays return immediately (`CODE9.CPP:879-885`, loop condition `n-- > 0 && runMode`).

### 9.7 Auto Trace (F10) - `AutoTraceExecute`, `AutoTraceTimerTimer` (`SIM68Ku.cpp:1333-1350`)

The command only enables a timer: `AutoTraceTimer->Enabled = true;`. The timer handler is:

```cpp
if (!inputMode)
{
  if(!autoTraceInProgress)
  {
    autoTraceInProgress = true;   // prevent calling until finished
    TraceExecute(Sender);
    autoTraceInProgress = false;
  }
}
```

So Auto Trace is "press Trace Into every *interval* milliseconds":

- The interval is the timer's `Interval`, 200 ms by default (`SIM68Ku.dfm:2260-2265`). It is changed only by the OK button of Options > Auto Trace Options... (14.1). **Quirk:** the interval saved in the settings file is loaded into the dialog's field but is not applied to the timer at start-up, so every session starts at 200 ms until that dialog is confirmed.
- Ticks are skipped while the program waits for keyboard input.
- Each tick reports and logs one instruction. With "Disable display update" checked the listing/stack/memory are not refreshed (4.2), which the help recommends for producing log files.
- While the timer is enabled, `setMenuActive()` does nothing, so after the first tick the commands are in the busy state (only Pause, Rewind, Close). Between pressing F10 and the first tick the commands are still enabled.
- Auto Trace ends (timer disabled) on: Pause; Rewind/Reload/Open/Close (`initSim`); a simple breakpoint; the Run-To-Cursor address; an advanced breakpoint; SIMHALT; TRAP #15 task 9; STOP; any error halt (`haltSimulator`); an exception in `exec_inst`; a bad SSP during exception processing. (`RUN.CPP:663, 671, 682, 894, 951, 1009, 1045, 1123`; `CODE9.CPP:784, 1314`; `STARTSIM.CPP:37`.)

### 9.8 Pause (F6) - `PauseExecute` (`SIM68Ku.cpp:525-539`)

```cpp
trace = true;
sstep = false;
runMode = false;
if (inputMode) {
  inputMode = false;        // disable input mode  ck v2.3
  simIO->erasePrompt();     //                     ck v2.3
}
scrshow();            // update the screen
setMenuActive();
// the next two lines must be after setMenuActive()
AutoTraceTimer->Enabled = false;      // turn off auto trace
Hardware->autoIRQoff();       // turn off auto interrupt timers
```

- Pause stops the loop after the current instruction and refreshes the display. Nothing is reset: registers, memory, I/O window contents, open files, breakpoints and logging are untouched.
- **A pending keyboard input request is cancelled**: `inputMode` is cleared and the input prompt erased. The TRAP that asked for input has already "completed" as far as the PC is concerned; its destination register/buffer keeps whatever it held. Continuing the program proceeds with the instruction after the TRAP.
- Pause is enabled in every state, including after a halt. Pressing Pause after SIMHALT is the way to re-enable Run/Step/Trace/Open without rewinding (3.6).
- **Quirk (UNVERIFIED on the binary, follows directly from the source):** when Pause is processed while the auto-trace timer is enabled and no trace step is executing, `setMenuActive()` returns early (timer still enabled) and the timer is disabled only afterwards, so Run/Step/Trace/Open remain disabled. A second Pause (or Rewind) enables them. A port may simply enable the commands.

### 9.9 `initSim()` - what a simulator reset does (`STARTSIM.CPP:33-127`)

Called at start-up and by Open/command-line load/drag-drop/Reload (via `OpenFile`), Close and Rewind. In order:

| What | Value / action |
|---|---|
| Auto trace | timer disabled, `autoTraceInProgress = false` |
| I/O window | `simIO->clear()` (text and graphics erased to black, cursor to row 0, column 0); `setWindowSize(0,0)` = re-apply the **current** size (the size is not reset to 640x480); drawing mode 4 then 16 (default pen mode, double buffering off); pen width 1; line colour white; fill colour black; font reset to the Output Window Font option |
| Listing, heading, message area | font re-applied from the Source Window Font option |
| Input | `inputMode = false`, `pendingKey = 0` |
| Execution | `runMode = false`; `trace = sstep = false`; `stopInstruction = false`; `stepToAddr = 0`; `runToAddr = 0`; `OLD_PC = -1` |
| Data and address registers | `D[0..7] = 0`, `A[0..7] = 0` |
| Cycle counter | `cycles = 0` |
| Status register | `SR = 0x2000` (supervisor mode, interrupt mask 0) |
| User stack pointer | `A[7] = 0x00FF0000` |
| Supervisor stack pointer | `A[8] = 0x01000000` |
| Display | `scrshow()` |
| Input options | `keyboardEcho = true`, `inputPrompt = true`, `inputLFdisplay = true` |
| Open files | `files[i].fp = NULL` for all 8 slots - **the files are not closed** (no `fclose`), the handles are simply forgotten |
| Interrupts | `irq = 0`, Hardware auto-IRQ timers off, `hardReset = false` |
| Commands | `setMenuActive()` (all nine enabled), `Hardware->enable()` |
| Full-screen monitor | `FullScreenMonitor = 0` |
| Mouse/key state for TRAP #15 | all cleared, mouse/key IRQ levels 0 |
| Sound | `simIO->ResetSounds()` |
| Shortcuts | `restoreMenuTask19()` (3.5) |
| Network | `netCloseSockets()` |

**Not touched by `initSim()`:** the 68000 memory, the PC, simple and advanced breakpoints, the exceptions and bit-field options, `simhalt_on`, the message area, the listing contents, the I/O window size and the text-wrap option, serial ports (`closeAllComm` exists but is never called), logging state.

### 9.10 Rewind Program (Ctrl+F2) - `RewindExecute` (`SIM68Ku.cpp:542-549`)

```cpp
AutoTraceTimer->Enabled = false;      // turn off auto trace
PC = startPC;
initSim();            // initialize simulator, sets runMode to false
setMenuActive();
Log->addMessage("\n***** Reset Program Pressed *****\n");
```

- Registers: reset as in 9.9; PC = the start address remembered at load (`startPC`).
- **Memory: not changed.** Whatever the program wrote (variables, self-modified code, stack contents) is still there. A rewound program is *not* a freshly loaded program. Use Reload for that.
- I/O window: cleared (9.9).
- Open files: forgotten without being closed (9.9). The program sees no open files after a rewind; data buffered in a file the program never closed is not flushed until Sim68K exits (consequence of the missing `fclose`; another spec owns file I/O).
- Breakpoints kept. Message area kept. Logging continues; the text `***** Reset Program Pressed *****` (note: "Reset", not "Rewind") is written to the log files under the condition described in 13.5.
- Works while running (it is processed during message pumping; the loop then ends because `runMode` is false).

### 9.11 Reload Program (Ctrl+F3) - `ReloadExecute` (`SIM68Ku.cpp:1366-1370`)

```cpp
OpenFile(OpenDialog1->FileName);
Log->addMessage("\n***** Reload Program Pressed *****\n");
```

The full load sequence of 8.2 is repeated for the remembered file name: simulator reset, **memory re-filled with `0xFF`**, S-record and listing re-read from disk (so a program re-assembled in the editor is picked up), `*[sim68k]` directives re-applied, message area cleared, PC = start address.

- Simple breakpoints are **not** cleared by Reload (addresses may no longer match a re-assembled program); `*[sim68k]break` breakpoints are added again (duplicates are ignored).
- Logging is not stopped and the log file names are not recomputed.
- The remembered name is whatever the shared file dialog last returned, so after File > Open Data, Reload loads the data file (Quirk, 8.3).

### 9.12 End of program and halts

There is no "program finished" dialog. A program ends in one of these ways:

**SIMHALT** - the opcode pair `FFFF FFFF` while `simhalt_on` (`CODE9.CPP:1307-1322`):

```cpp
PC += 2;    // position at next instruction
Form1->AutoTraceTimer->Enabled = false;
trace = false;
halt = true;
Hardware->disable();
Log->stopLogWithAnnounce();
return SUCCESS;
```

**TRAP #15 task 9** does the same without the `PC += 2` (`CODE9.CPP:783-789`).

What the user then sees (9.2 step 9 with `halt` true, `trace` false):

- Execution stops; the registers, cycle counter, stack and memory windows are refreshed; PC shows the address after the SIMHALT; the listing row with that address is selected even if it is not an instruction row (6.4).
- The commands go to the busy state: only Pause, Rewind and Close (plus Reload and the always-enabled items) are available.
- **No line is added to the message area** by the halt itself (if the SIMHALT was traced, its `PC=...  Code=FFFF  SIMHALT` trace line is there).
- Focus is not moved (it stays on the I/O window after a Run).
- The I/O window keeps its contents. Open files stay open.
- If logging is active, a modal box titled `Information` with the text `Current Log Stopped.` appears *before* the display refresh, and logging ends (13.5).
- The Hardware window's interrupt controls are disabled.

Because unused memory is `0xFF`, a program that runs off its end into unloaded memory meets `FFFF FFFF` and halts as SIMHALT.

**STOP instruction.** With exceptions disabled: message `STOP instruction executed at location %4x. Execution halted`, logging stopped with the announce box, main window focused, halted (`RUN.CPP:950-958`). With exceptions enabled: message `STOP instruction. Execution halted` (once), halted, but an interrupt from the Hardware window restarts execution (`RUN.CPP:892-902`, `hardwareu.cpp:757-775`).

**Errors with exceptions disabled** (illegal instruction, privilege violation, CHK, TRAPV, TRAP #0-#14, divide by zero, line 1010/1111, trace bit set, bus error, address error): the corresponding message of 7.2 and a halt. Bus and address errors go through `haltSimulator()` (`RUN.CPP:1121-1128`), which also stops logging with the announce box. With exceptions enabled these vector to the program's handlers instead (core spec).

**`exec_inst` internal exception**: modal box titled `Error`: `ERROR: An exception occurred in routine 'exec_inst'.` / `PC=%08X  Code=%04X`, then `trace = true` (execution stops; `RUN.CPP:1008-1014`).

After any halt the next run command must be preceded by Pause or Rewind (3.6). Continuing after Pause resumes at the current PC.

### 9.13 Keyboard input and the run commands

When the program executes an input TRAP, the I/O window sets `inputMode = true`, starts the blinking prompt and returns at once (`simIOu.cpp:1309-1331`); the value arrives later from the window's key handler.

| Command in progress | Behaviour while input is pending |
|---|---|
| Run, Run To Cursor, Step Over | `runprog()` waits in its pump-and-sleep loop (9.2 step 2). Commands are in the busy state; Pause cancels the input (9.8). |
| Trace Into | `runprog()` does **not** wait (`runMode` is false). The command returns with input still pending; focus stays on the I/O window; the commands are **enabled** again. When the user finishes typing and `trace` is true, the I/O window re-enables the commands, re-enables Hardware, refreshes the registers and focuses the main window (`simIOu.cpp:1365-1371`). **Quirk:** pressing Trace Into (or Step Over/Run) again before finishing the input executes the following instructions with the input still outstanding. |
| Auto Trace | ticks are skipped until the input completes (9.7). |

### 9.14 Summary: what each command resets

| | Registers | PC | Memory | I/O window | Files | PC breakpoints | Message area | Logging |
|---|---|---|---|---|---|---|---|---|
| Pause | kept | kept | kept | kept (pending input cancelled) | kept open | kept | kept | continues |
| Rewind | reset (9.9) | `startPC` | **kept** | cleared | forgotten, not closed | kept | kept | continues, note written |
| Reload | reset | start address from file | **all `0xFF`, then file reloaded** | cleared | forgotten, not closed | kept (+ `*[sim68k]break`) | cleared | continues, note written |
| Open | reset | start address from file | all `0xFF`, then file loaded | cleared | forgotten, not closed | cleared | cleared | stopped with announce box |
| Open Data | kept | (see 8.3) | file overlaid | kept | kept | kept | appended | continues |
| Close | reset | kept | kept | cleared | forgotten, not closed | cleared | kept | continues |
| SIMHALT | kept | after SIMHALT | kept | kept | kept open | kept | kept | stopped with announce box |

---

## 10. Memory window (`MemoryFrm`, `Memory1.*`)

### 10.1 Layout

A separate window captioned `68000 Memory`, white background, I-beam cursor, Courier New 13 px. Width is fixed in practice (`Constraints.MaxWidth = 640`, minimum 200 x 200); height is resizable and determines the number of rows (`Memory1.dfm:1-17`).

Top panel `Panel1` (41 px high, `Memory1.dfm:168-528`):

| Control | Caption / mask | Purpose |
|---|---|---|
| label `Address:` | | heading of the address column |
| `$` + grey `00` + `Address1` | mask `aaaaaa;0;0` (6 hex digits) | address of the first displayed row; sits directly above the address column |
| label `From:` `$` + grey `00` + `From` | mask `aaaaaa;0;0` | start address for Copy / Fill / Save |
| label `To:` `$` + grey `00` + `To` | mask `aaaaaa;0;0` | Copy: destination address. Fill / Save: last address (inclusive) |
| label `Bytes:` `$` + `Bytes` | mask `aaaaaaaa;0;0` (8 hex digits) | Copy: byte count. Fill: the 4-byte fill pattern |
| button `Copy` | | 10.5 |
| button `Fill` | | 10.5 |
| speed button `Save` (disk icon, no caption) | | 10.5 |
| label (column header) | `00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 0123456789ABCDEF` | positioned over the hex and ASCII columns |

All four edit fields accept only hex digits (`AddrKeyPress`, `Memory1.cpp:574-583`: others beep) and convert to upper case. The grey `00` prefix is decoration showing that the upper byte of the address is always 00.

Right panel `Panel2` (32 px wide, `Memory1.dfm:55-167`): label `Row` with an up/down spin button; label `Page` with an up/down spin button; label `Live` with a check box `LiveCheckBox` (unchecked by default).

Client area: one text row per 16 bytes, drawn by `FormPaint` (`Memory1.cpp:67-124`):

```
"%08X: "  then 16 x "%02hX "  then 16 ASCII characters
00001000: 10 3C 00 0E 43 F9 00 00 10 12 4E 4F FF FF FF FF -<--C-----NO----
```

- Address: 8 upper-case hex digits and `": "` (10 character cells).
- Hex bytes: character columns 10-57 (each byte = 2 digits + 1 space).
- ASCII: character columns 58-73. A byte is shown as itself when `memory[addr] >= ' '` **as a signed char**, otherwise as `-` (`Memory1.cpp:113-117`). So `$00-$1F` and `$80-$FF` are shown as `-`, and `$20-$7F` as the character (including `$7F`).
- Rows whose address is `>= $01000000` have a red address and red `xx ` / `-` placeholders (`Memory1.cpp:82-111`).
- Number of rows: `nRows = (ClientHeight - Panel1->Height) / rowHeight` where `rowHeight` is the text height of the font (`Memory1.cpp:44, 77`).

### 10.2 Navigation

- **Address field.** Every change of the text (`Address1Change`, `Memory1.cpp:49-63`) does: `memAddr = StrToInt("0x" + text); memAddr -= memAddr%16;` rewrites the field as `"%06lX"` and repaints. The top row address is therefore always a multiple of 16 and the last digit of the field is always forced to 0. Enter repaints.
- **Row spin** up / down, **mouse wheel** up / down, and **Up / Down arrow keys while the Address field has focus**: move by 16 bytes. Lower limit 0; upper limit `MEMSIZE - 16` = `$FFFFF0` (`Memory1.cpp:193-224, 263-274, 288-293`).
- **Page spin** up / down, and **Page Up / Page Down** (in the Address field or on the form): move by `nRows*16` bytes with the same limits (`Memory1.cpp:227-260`).
- **Double-click on an address register in the main window** sets the Address field from that register (4.4).
- F1 opens help with context `MEMORY`; Ctrl+Tab goes to the Stack window (`Memory1.cpp:294-303, 500-506`).

### 10.3 Editing memory

Clicking in the client area (`FormMouseDown`, `Memory1.cpp:340-356`) moves keyboard focus to the form and places a cursor at the clicked character cell: `row = (Y - Panel1->Height)/rowHeight`, `col = X/colWidth`. The cursor is a one-cell frame rectangle that blinks every 500 ms (`prompt` timer, `Memory1.dfm:529-535`).

Cursor placement rules (`gotoRC`, `Memory1.cpp:309-335`) with `HEX_LEFT = 10`, `HEX_RIGHT = 56`, `ASC_LEFT = 58`, `ASC_RIGHT = 73` (`Memory1.cpp:27-30`):

```cpp
if (row < 0) { row = 0; RowSpinUpClick(Sender); }                 // scroll up one row
else if (row > nRows-1) { row = nRows-1; RowSpinDownClick(Sender); } // scroll down one row
if (col < HEX_LEFT)           // don't put cursor in address column
  col = HEX_LEFT;
else if (col < ASC_LEFT) {
  if (col%3 == 0)             // the space after each hex byte
    col++;
} else if (col > ASC_RIGHT)
  col = ASC_RIGHT;
```

Keys on the form (`FormKeyDown`, `Memory1.cpp:470-510`): Up/Down move the cursor one row (scrolling at the edges); Left/Right move one cell, skipping the separator spaces; Page Up/Page Down page the view.

Typing a character (`FormKeyPress`, `Memory1.cpp:397-467`) modifies the byte under the cursor. The address is `Address + row*16 + (col-10)/3` in the hex area or `Address + row*16 + (col-58)` in the ASCII area; if it is `>= $01000000` the key beeps and is ignored.

- **Hex area** (`col <= 56`): the key must be a hex digit (else beep). It replaces the high nibble when `(col-10)%3 == 0`, else the low nibble. The cursor advances one cell (wrapping from the last byte of a row to the first byte of the next row).
- **ASCII area**: `memory[addr] = Key;` - the raw character code is stored, including control keys that produce a character (Enter stores `$0D`, Backspace `$08`, Escape `$1B`). The cursor advances one cell, wrapping to the next row.

After each edit: `Hardware->updateIfNeeded(addr)`, the stack window is redrawn, and the memory window is repainted.

**Edits write the memory array directly.** They bypass the core's `mem_put`, so the Hardware window's ROM / read-only / protected / invalid memory map is not enforced, no address or bus error can occur, and no advanced-breakpoint write is recorded. Editing is allowed at any time, including while the program runs.

### 10.4 Live update

Without `Live`, the window is repainted only by `scrshow()` (when execution stops or traces, 4.2), by its own navigation/editing, and by some Hardware-window actions. During a full-speed Run it is static.

With `Live` checked, every memory write by the running program calls `MemoryFrm->LivePaint(loc)` (`UTILS.CPP:397`), which immediately redraws the rows around the written address if it is in view (`Memory1.cpp:129-183`). The view test is:

```cpp
if (loc >= memAddr-3 && loc <= (memAddr + nRows*16) &&
    loc < MEMSIZE && LiveCheckBox->Checked)
```

**Quirk:** `memAddr` is unsigned, so when the top row is address 0, `memAddr-3` wraps and the test is false - there is no live update while the window shows address 0. A port may implement live update as "redraw visible rows that changed".

### 10.5 Copy, Fill, Save (no Load)

All three read their parameters as hex from the `From`, `To` and `Bytes` fields and write/read the memory array directly (no memory-map checks, no Hardware refresh).

**Copy** (`CopyClick`, `Memory1.cpp:523-570`): copies `Bytes` bytes from address `From` to address `To`.
- `To == From` or `Bytes == 0`: box `Invalid copy range`.
- `From < To`: both end addresses must be `< $01000000` (else `Invalid copy range`, nothing copied); copied from the highest byte down, so overlapping ranges are safe.
- `From > To`: copied upward one byte at a time; if an address reaches `$01000000` the box `Invalid copy range` appears and the copy stops, leaving the bytes already copied.

**Fill** (`FillClick`, `Memory1.cpp:588-614`): fills addresses `From` through `To` **inclusive** with a repeating **4-byte pattern** taken from the 8-digit `Bytes` field, most significant byte first:

```cpp
data[3] = (char)(bytes & 0xFF);            // low byte
data[2] = (char)((bytes>>8) & 0xFF);       // next byte
data[1] = (char)((bytes>>16) & 0xFF);
data[0] = (char)((bytes>>24) & 0xFF);
for (i=fromAddr; i<=toAddr; i++) {
  if (i >= MEMSIZE) { ShowMessage("Invalid memory range"); return; }
  else memory[i] = data[(i-fromAddr)%4];
}
```

So `Bytes = 12345678` writes `12 34 56 78 12 34 ...` starting at `From`. To fill with a single byte value enter it four times (`FFFFFFFF`). Because the field's blank character is `0`, typing only `FF` at the left of the field gives the pattern `FF 00 00 00`. If `From > To` nothing happens and no message is shown.

**Save** (`SaveClick`, `Memory1.cpp:625-659`): saves addresses `From` through `To` inclusive as a raw binary file. If `To - From + 1 <= 0` or `To >= $01000000`: beep and box `Invalid memory range.` (title `Information`). Otherwise a Save dialog (default extension `bin`); if the file exists a box titled `Alert` asks `File exists! OK to replace?` (Yes / No); then the bytes are written unmodified.

There is no command to load a binary file into memory; File > Open Data (S-records) is the only loader.

> **Corrected (erratum U2 S1).** In the port the Memory panel passes the question in `SaveRequest.overwritePrompt` (`{ title: 'Alert', text: 'File exists! OK to replace?' }`, Yes / No), and the file dialog asks it in place of its own. The panels do not beep (there is no beep service outside the Output panel; erratum U2 S2). The Address field is the first control of the panel's top strip, as the sketch of ARCHITECTURE.md 2.3 shows (erratum U2 S3).

---

## 11. Stack window (`StackFrm`, `Stack1.*`)

### 11.1 Layout

A separate window captioned `68000 Stack`, 250 px wide (fixed: min = max = 250), height resizable (minimum 240, default from settings 538), white background, Courier New 13 px (`Stack1.dfm:1-18`). On the right a 60 px panel holds an up/down spin button, the label `View` and a combo box `whichStack` with the nine entries `A0`, `A1`, `A2`, `A3`, `A4`, `A5`, `A6`, `US`, `SS` (`Stack1.dfm:107-127`). The default selection is index 8, `SS`.

### 11.2 Which stack it shows

`updateDisplay()` (`Stack1.cpp:62-69`):

```cpp
stackAddr = A[whichStack->ItemIndex];
AregAddr = stackAddr;
stackAddr -= stackAddr%2;     // force even address
midAddr = stackAddr;
DisplayStack();
```

The combo index is used directly as an index into `A[]`: indexes 0-6 are A0-A6, 7 (`US`) is the user stack pointer `A[7]`, 8 (`SS`) is the supervisor stack pointer `A[8]`. There is no "A7 / current stack" entry: with the default `SS` selected the window shows the supervisor stack even while the program runs in user mode.

### 11.3 Drawing (`DisplayStack`, `Stack1.cpp:72-120`)

- `nRows = ClientHeight/rowHeight`; `midRow = nRows/2`.
- The first row's address is `(midAddr - midRow*4) & 0x00FFFFFF`, so **the selected pointer's address is on the middle row**. Lower addresses are above it, higher addresses below. Addresses wrap within 24 bits.
- Each row is 4 bytes: `"%08X: "` followed by 4 x `"%02hX "`, for example `00FEFFFC: 00 00 10 0A `.
- Byte colouring, per byte:
  - background **aqua** if the byte's address equals `AregAddr` (the value of the selected register);
  - else background **yellow** if it equals `A[a_reg(7)] & 0x00FFFFFF` (the current active stack pointer);
  - else white;
  - text **red** if the Hardware window's Invalid memory range is enabled and contains the address.
- Only the single byte at the pointer address is coloured, not the whole longword.
- **Quirk:** `AregAddr` is not masked to 24 bits while row addresses are. At reset `SS = $01000000`, so nothing is aqua, and the yellow mark (masked to `$000000`) is on the middle row at address `00000000`.

### 11.4 How it follows the pointer

`updateDisplay()` re-centres the view on the selected register. It is called from `scrshow()` (every stop/trace step, unless display update is disabled during auto trace), when the PC or SR field changes, when an address-register field is edited, when the combo selection changes and when the window is shown. So after every stop the selected pointer is back on the middle row.

Manual scrolling: the spin button and the mouse wheel move the view by one row (4 bytes) without changing the register - up shows lower addresses (`midAddr -= 4`), down higher (`Stack1.cpp:137-164`). Any `updateDisplay()` snaps the view back. Editing memory in the memory window redraws the stack window without re-centring.

During a full-speed Run the window is not refreshed. There is no editing in the stack window. F1 opens help with context `STACK`; Ctrl+Tab goes to the Hardware window.

---

## 12. Breakpoints

There are two independent mechanisms.

### 12.1 Simple PC breakpoints

Set by clicking the gutter dot or by `*[sim68k]break` in the source (6.5, 8.2). Up to 100 addresses. Tested after every instruction (9.2 step 4). When hit: message `break point at %04x`, execution stops, the breakpoint stays set. They do not appear in the Break Points window.

### 12.2 Advanced breakpoints window (`BreaksFrm`, `BREAKPOINTSu.*`, `BPoint.*`, `BPointExpr.*`)

View > Break Points shows a fixed-size dialog captioned `EASy68K Advanced Break Points` with three group boxes (`BREAKPOINTSu.dfm`). The seven labels named `debugLabel1..7` are positioned outside the client area and are never visible.

**The model has two levels.** Conditions are defined in the `Registers` and `Memory` grids, but **a condition by itself never stops the program**. Only rows of the `Expression Builder` grid are evaluated by the run loop (`RUN.CPP:676-685` loops over `exprCount` expressions only). To break on a single condition the user must still create an expression consisting of just that condition. The help states this explicitly.

Limits (`def.h:180-198`): 50 slots for register conditions (`breakPoints[0..49]`), 50 for memory conditions (`breakPoints[50..99]`), 50 expressions (`bpExpressions[]`), at most 10 tokens per expression (`MAX_LB_NODES`). Each grid has 50 rows including its header row, so 49 data rows are visible. Nothing is saved to disk and nothing is cleared by Open/Reload/Rewind.

> **Corrected (erratum U3 2).** In the port no user action leaves a field empty (note 40 removes the editable lists, and a masked field always holds its characters), so `Entry not stored.  Fields missing.` is reached only through the model's API. `Set` stays disabled for an empty or incomplete expression, as `setExprButtons` makes it, and Enter there does nothing.

> **Corrected (erratum U3 4).** In the source a click on a row beyond the defined ones makes `Clear` act on the last defined row (`reg_edit_row = regCount`), so `Select a Valid Row.` appears only in rarer states. The port does what this section says (the selected row if defined, the message otherwise); `docs/differences/U3.md` entry 10.

> **Corrected (erratum U3 5).** In the port selecting another row of the same grid (click or arrow keys) or Escape hides the editors without storing; a click inside the editors, on the edited row's number, and scrolling do not (the editors are part of the row and scroll with it). Dragging does not exist (note 40).

> **Corrected (erratum U3 6).** The confirmation note 40 asks for: title `Break Points`, a confirmation icon, OK / Cancel, `Expression 2 uses this condition and is removed with it.` or `Expressions 1, 3 use these conditions and are removed with them.` (Clear All).

#### Group `Registers` (grid `RegStringGrid`)

Columns: row number, `PC/Reg`, `Op`, `Value`, `Size` (`BREAKPOINTSu.cpp:52-55`). Buttons: `Set`, `Clear`, `Clear All`.

| Column | Editor | Choices / format | Stored as |
|---|---|---|---|
| `PC/Reg` | combo | `D0`..`D7`, `A0`..`A7`, `PC` (default `PC`) | `typeId` 0-7, 8-15, 16 |
| `Op` | combo | `==`, `!=`, `>`, `>=`, `<`, `<=` (default `==`) | 0..5 |
| `Value` | 8 hex digits, mask `aaaaaaaa;0;0` (default `00000000`) | hex only | `StrToInt("0x"+text)` |
| `Size` | combo | `B`, `W`, `L` (default `L`) | 0, 1, 2 |

#### Group `Memory` (grid `AddrStringGrid`)

Columns: row number, `Address`, `Op`, `Value`, `Size`, `R/W` (`BREAKPOINTSu.cpp:60-64`). Buttons: `Set`, `Clear`, `Clear All`.

| Column | Editor | Choices / format | Stored as |
|---|---|---|---|
| `Address` | 8 hex digits (default `00000000`) | hex only | `typeId` = address |
| `Op` | combo | `==`, `!=`, `>`, `>=`, `<`, `<=`, `N/A` (default `==`) | 0..6 (`N/A` = always true) |
| `Value` | 8 hex digits (default `00000000`) | hex only | value |
| `Size` | combo | `B`, `W`, `L` (default `L`) | 0, 1, 2 |
| `R/W` | combo | `R/W`, `Read`, `Write`, `N/A` (default `R/W`) | 0..3 |

#### Group `Expression Builder` (grid `ExprStringGrid`)

Columns: row number, `Enabled`, `Expression`, `Count` (`BREAKPOINTSu.cpp:69-71`). Buttons: `Set`, `Clear`, `Clear All`; then the expression-building controls `PC/Reg` + a 2-digit field, `Memory` + a 2-digit field, `AND`, `OR`, `(`, `)`, `Backspace`.

| Column | Editor | Meaning |
|---|---|---|
| `Enabled` | combo `ON` / `OFF` (default `ON`) | only the exact text `ON` enables the expression |
| `Expression` | read-only text built with the buttons | see syntax below |
| `Count` | 2 digits, mask `99;0;0` (default `01`) | number of times the expression must be true before breaking - see quirks |

#### Editing workflow (same for all three grids)

- **Double-click a row** to edit. Double-clicking any row beyond the last defined one starts a **new** entry in the first free row ("force data to be entered into consecutive rows"); double-clicking a defined row loads it for editing. In-place editors (combos / mask edits) appear over the row and the `Set` button is enabled while `Clear` / `Clear All` are disabled (`BREAKPOINTSu.cpp:905-1053, 167-231`).
- **`Set`** stores the entry. If any field is empty: box `Entry not stored.  Fields missing.` (`BREAKPOINTSu.cpp:354-520`).
- **A single click on a grid, scrolling it, or dragging a row/column hides the editors without storing** - the entry in progress is discarded (`BREAKPOINTSu.cpp:299-351, 1056-1150`).
- A single click on a row of the Registers or Memory grid also copies its row number, as two digits, into the field next to the `PC/Reg` or `Memory` button of the Expression Builder (clamped to the number of defined rows).
- **`Clear`** removes the selected defined row and moves the following rows up; on an undefined row it shows `Select a Valid Row.`. **`Clear All`** empties the grid.

#### Expression syntax

An expression is a sequence of at most 10 tokens built only with the buttons (it cannot be typed). Tokens and the text each appends (`BREAKPOINTSu.cpp:533-614, 1153-1182`):

| Button | Token | Text appended |
|---|---|---|
| `PC/Reg` (with number *n* from the field) | register condition *n* | `" R" + n`, one extra space if *n* < 10, then one space - e.g. `" R1  "`, `" R12 "` |
| `Memory` (with number *n*) | memory condition *n* | `" A" + n + " "` - e.g. `" A1 "`, `" A12 "` |
| `AND` | logical and | `" AND "` |
| `OR` | logical or | `" OR  "` |
| `(` | left parenthesis | `"  (  "` |
| `)` | right parenthesis | `"  )  "` |

The condition number must refer to a defined row, otherwise the box `Invalid PC/Reg Breakpoint. Set PC/Reg in Registers area first.` or `Invalid Memory Breakpoint. Set Memory in Memory area first.` appears.

The buttons are enabled so that only well-formed infix can be built (`setExprButtons`, `BREAKPOINTSu.cpp:209-297`): an operand is allowed at the start, after an operator or after `(`; `AND`/`OR` are allowed after an operand or `)`; `(` is allowed at the start, after an operator or after `(`; `)` is allowed when a `(` is open and the last token is not an operator or `(`; `Backspace` whenever there is at least one token; at 10 tokens only `Backspace` remains. `Set` is enabled only when all parentheses are closed and the expression ends in an operand or `)`. There is no NOT operator.

`Backspace` removes the last token and the last **5 characters** of the text (`BREAKPOINTSu.cpp:617-644`).

Grammar, informally: `expr := term { ("AND" | "OR") term }`, `term := Rn | An | "(" expr ")"`. `AND` binds tighter than `OR` (`precedence()` returns the negated token value, and AND has the smaller value; `BREAKPOINTSu.cpp:523-529`). On `Set` the infix token list is converted to postfix with a shunting-yard loop (`BREAKPOINTSu.cpp:476-509`).

#### Evaluation semantics (what the user experiences)

After every instruction, each defined expression is evaluated (`BPointExpr::isBreak`, `BPointExpr.cpp:97-151`): a disabled expression is false; otherwise the postfix list is evaluated with each operand being `BPoint::isBreak()` of the referenced condition, then:

```cpp
if(isBrk) bpCountCond[id]++;
isBrk = (count == bpCountCond[id]);
if(isBrk) bpCountCond[id] = 0;          // Reset counter for next iteration.
return isBrk;
```

The hit counters are reset to 0 by the Run command only (`resetDebug`, `BREAKPOINTSu.cpp:161-165`).

A condition (`BPoint::isBreak`, `BPoint.cpp:112-205`):

- **Register condition:** compares `register & sizeMask` (size B = `$FF`, W = `$FFFF`, L = all 32 bits) with `Value` using `Op`. `PC` uses the PC after the instruction. Comparisons are on signed 32-bit integers.
- **Memory condition:** first the access test. `R/W`: true if the instruction's last memory read **or** last memory write was at exactly this address; `Read`: last read at this address; `Write`: last write at this address; `N/A`: no access test. If the access test fails the condition is false. Then the value at the address (big-endian, of the selected size) is compared with `Value` using `Op`; `Op = N/A` skips the comparison.
- The core records only **one** read address and **one** write address per instruction - the address of the most recent `mem_req` / `mem_put` call (`UTILS.CPP:394-395, 496-497`). "At exactly this address" means the starting address of that access; a long write to `$2000` does not count as a write to `$2002`.

#### Quirks of the advanced breakpoints (all follow from the source)

| Quirk | Source |
|---|---|
| `Count` is parsed as **hexadecimal** although only decimal digits can be typed: `10` means 16. | `BREAKPOINTSu.cpp:467-468` |
| `Count = 00` breaks on every step until the expression is first true, and never afterwards until Run resets the counter (`0 == 0` while the counter stays 0; corrected, erratum U3 1, as sim-core §7.3 says). | `BPointExpr.cpp:147-149` |
| The register choice `A7` always tests the **user** stack pointer `A[7]`, never the supervisor stack pointer. | `BPoint.cpp:126` |
| Evaluating a memory condition reads the address through the core's `mem_req`. Consequences: a W or L condition on an odd address raises an address error (halting the program when exceptions are off); the Hardware memory map applies; and the read itself is recorded as "the last read", which can satisfy a `Read` or `R/W` test of a condition evaluated later in the same step. | `BPoint.cpp:178`, `UTILS.CPP:420-499` |
| After a parenthesised group the converter leaves the `(` on its stack, which shields earlier operators: `R1 AND ( R2 OR R3 ) OR R4` is evaluated as `R1 AND ((R2 OR R3) OR R4)`. Expressions without parentheses, and expressions where the group comes last, evaluate normally. | `BREAKPOINTSu.cpp:492-497` |
| `Clear` on a Memory row copies register-condition slots into the memory slots (`breakPoints[curRow - 1 + ADDR_ID_OFFSET] = breakPoints[curRow];` lacks the offset on the right-hand side), corrupting the memory conditions that followed the deleted row. | `BREAKPOINTSu.cpp:752-754` |
| Editing an existing Memory row pre-selects the combo boxes from a *register* slot (`breakPoints[reg_edit_row-1]`), so pressing `Set` without re-choosing can silently change Op / Size / R/W. | `BREAKPOINTSu.cpp:971-973` |
| Deleting a condition renumbers the rows but existing expressions keep their old indexes, so they now refer to different conditions. | `BREAKPOINTSu.cpp:676-682` |
| `Backspace` always removes 5 characters, but an `An` token with n < 10 added only 4, so the displayed text loses a character of the previous token (the internal token list stays correct). | `BREAKPOINTSu.cpp:568-571, 620` |
| The Registers and Memory grids allow rows and columns to be dragged; this moves only the displayed text, not the stored conditions. | `BREAKPOINTSu.dfm:110, 292` |
| The combo boxes are editable; typed text that matches no entry stores index -1 (undefined behaviour in the original). | `BREAKPOINTSu.dfm:170-276` |

None of these affects how a student's program executes; they only affect where the debugger stops. A port should implement the documented semantics; whether to reproduce the bugs is a product decision (section 19).

F1 in this window opens help with context `BREAKPOINT`; Ctrl+Tab goes to the main window.

---

## 13. Logging

Two independent logs exist: the **execution log** (traced instructions, optionally with registers and a memory range) and the **output log** (text the program writes to the I/O window). Both are configured in one dialog and started/stopped together.

Globals (`var.h:92-98`): `char ElogFlag` (execution log type 0-3), `FILE *ElogFile`, `char OlogFlag` (output log type 0-1), `FILE *OlogFile`, `bool logging`, `unsigned int logMemAddr`, `unsigned int logMemBytes`. Type constants (`def.h:166-170`): `DISABLED = 0`, `INSTRUCTION = 1`, `REGISTERS = 2`, `INST_REG_MEM = 3`, `TEXTONLY = 1`.

### 13.1 Log file names

Whenever a program is loaded through File > Open, the command line or drag-and-drop, `Log->setLogFileNames(name)` runs (`logU.cpp:59-73`):

```cpp
if(logging)
{
  stopLog();              // stop current log
  Application->MessageBox("Current Log Stopped.", "Information", MB_OK);
}
ELogFileName->Text = ChangeFileExt(name,"_RunLog.txt");
OLogFileName->Text = ChangeFileExt(name,"_OutLog.txt");
if (ElogFlag || OlogFlag) {
  Form1->ToolLogStart->Enabled = true;
  Form1->LogStart->Enabled = true;
}
```

`ChangeFileExt` replaces the extension including its dot, so for `C:\work\prog.S68` the defaults are `C:\work\prog_RunLog.txt` (execution) and `C:\work\prog_OutLog.txt` (output), in the program's folder. The user can change either name in the dialog; the names are not saved in the settings file and are recomputed on every Open (not on Reload).

### 13.2 The Log Output dialog (Options > Log Output...)

`Log` form, captioned `Log Output`, non-modal, centred on the main window (`logU.dfm`). Controls top to bottom:

| Control | Caption / content |
|---|---|
| label | `Execution Log File Name:` |
| edit `ELogFileName` + folder button | free-text path; the button opens a Save dialog (default name `EASy68kELog.txt`, filter "Text File", pattern `*.txt`) |
| radio group `ELogType` | title `Execution Log Type`; items `Disabled` (0, default), `Instruction only` (1), `Instruction and Registers` (2), `Instruction, Registers and Memory` (3) |
| group box `MemRange` | title `Memory Range to Log`; visible only while item 3 is selected (`logU.cpp:247-254`); contains `From:` (8 hex digits, mask `aaaaaaaa;0;0`) and `Bytes` (2 hex digits, mask `aa;0;0`). Leaving `From` with a value `>= $01000000` shows `Invalid Address`. |
| label | `Output Log File Name:` |
| edit `OLogFileName` + folder button | as above, default name `EASy68kOLog.txt` |
| radio group `OLogType` | title `Output Log Type`; items `Disabled` (0, default), `Text Only` (1) |
| button `&OK` (default) | `ElogFlag = ELogType->ItemIndex; OlogFlag = OLogType->ItemIndex;` enables Log Start if either is non-zero; closes (`logU.cpp:76-85`) |
| button `&Cancel` | restores the six values captured when the dialog was shown and closes (`logU.cpp:88-99, 278-286`) |

OK only selects *what* to log. **It does not start logging** and does not write the settings file. F1 in this dialog opens help (context `SIM_OPTIONS`).

What can be logged, in summary: traced instructions; traced instructions with all registers; traced instructions with all registers and one memory range of at most 256 bytes; the program's text output. Nothing else (no cycle counts, no memory writes, no graphics).

### 13.3 Log Start (Run > Log Start, Ctrl+F4, toolbar)

`startLog()` (`logU.cpp:227-235`) calls `prepareLogFile()` and then **unconditionally** sets `logging = true`, disables Log Start and enables Log Stop.

`prepareLogFile()` (`logU.cpp:103-199`), for the execution log if `ElogFlag != 0` and then for the output log if `OlogFlag != 0`:

1. If the file already exists, the modal dialog `LogfileDialog` appears: caption `Log File Options`, bold message `Execution Log File exists!` or `Output Log File exists!`, and three buttons `Replace`, `Append`, `Cancel` (`LogfileDialogu.dfm`).
   - `Replace`: open for writing (truncate).
   - `Append`: open for appending.
   - `Cancel`: return without opening.
2. If it does not exist it is created.
3. The execution log is opened in **text mode** (`"wt"` / `"at"`: every `\n` is written as CR LF); the output log in **binary mode** (`"wb"` / `"ab"`).
4. If the file cannot be opened: box titled `Error` with `Can't open log file. Check log file name., Error number 0` (execution) or `Can't open log file, error 0` (output); for the execution log the Log Output dialog is then shown.
5. A header line is written:
   - execution log: `fprintf(ElogFile, "EASy68K execution log file: %s\n\n", timeStr.c_str());`
   - output log: `fprintf(OlogFile, "EASy68K output log file: %s\r\n\r\n", timeStr.c_str());`

   where `timeStr = DateTimeToStr(Now())`, the date and time in the Windows user's regional format (for US English, for example `3/15/2018 2:05:33 PM`).
6. The `LOGGING` label is shown, Log Start disabled, Log Stop enabled.
7. For type 3 the memory range is computed, both values rounded to whole rows of 16:

   ```cpp
   logMemAddr = StrToInt(str + MemFrom->EditText);   // get address to log
   logMemAddr -= logMemAddr%16;            // force to $10 boundary
   logMemBytes = StrToInt(str + MemBytes->EditText); // get byte count
   logMemBytes += 15;
   logMemBytes -= logMemBytes%16;          // force to increment of $10
   ```

   The start address is rounded **down** and the count rounded **up** separately, so `From = 1012, Bytes = 10` logs the single row `$1010-$101F` (which does not cover `$1020-$1021`). `Bytes = 00` logs no rows.
8. `Form1->SaveSettings()` is called and the Log Output dialog is closed.

**Quirk:** because `startLog()` sets `logging = true` regardless, pressing `Cancel` in the "file exists" dialog (or a failed open) leaves the simulator in the "logging" state with no valid file; the original then writes through a closed or null `FILE*` (undefined behaviour). A port should treat Cancel/failure as "logging not started".

> **Corrected (erratum U4 4).** In the port both questions are asked before anything is written: Cancel at either leaves both files untouched and logging off, and `engine.startLog` is not called; a file that cannot be written is found by the first write. Log Start with both types Disabled calls `engine.startLog` and makes no file (erratum U4 5). Log Start closes the Log Output dialog as Cancel does (erratum U4 7). The `Log File Options` question also shows the file's path below the bold message (erratum U4 13).

### 13.4 Execution log format

The execution log is written **only for instructions executed while `trace` is non-zero** (`RUN.CPP:771-845`), immediately *before* the instruction executes. That means:

- Trace Into, each Auto Trace tick, and Step Over steps are logged.
- **Run and Run To Cursor at full speed write nothing**, and the body of a subroutine skipped by Step Over is not logged.
- The register and memory values in an entry are the values **before** the instruction on that entry's instruction line executes.
- The file is flushed after every entry.

One entry consists of up to three parts, in this order:

**(a) Memory block - type 3 only.** A blank line, then `logMemBytes/16` rows:

```cpp
fprintf(ElogFile,"\n");           // blank line
for (int r=0; r<nRows; r++) {
  if (addr < 0 || addr >= MEMSIZE)    // if invalid address
    fprintf(ElogFile,"%08X: Invalid Address",addr);
  else                                // valid address
    fprintf(ElogFile,"%08X: ",addr);
  for (int i=0; i<16; i++) {                       // 16 hex bytes
    if (addr+i >= MEMSIZE) fprintf(ElogFile,"xx ");
    else fprintf(ElogFile,"%02hX ",(unsigned char)memory[(addr+i) & ADDRMASK]);
  }
  for (int i=0; i<16; i++) {                       // 16 ASCII characters
    if (addr+i >= MEMSIZE) fprintf(ElogFile,"-");
    else {
      if (memory[(addr+i) & ADDRMASK] >= ' ') fprintf(ElogFile,"%hc",memory[(addr+i) & ADDRMASK]);
      else fprintf(ElogFile,"-");
    }
  }
  addr += 16;
  fprintf(ElogFile,"\n");         // new line
}
```

The ASCII rule is the same signed-char rule as the memory window: bytes `$00-$1F` and `$80-$FF` print as `-`.

**(b) Register block - types 2 and 3.** A blank line, then four lines:

```cpp
fprintf(ElogFile,"\n");
fprintf(ElogFile,"D0=%08lX D4=%08lX A0=%08lX A4=%08lX    T_S__INT___XNZVC\n", D[0],D[4],A[0],A[4]);
fprintf(ElogFile,"D1=%08lX D5=%08lX A1=%08lX A5=%08lX SR=", D[1],D[5],A[1],A[5]);
for (int j=0; j<16; j++)          // display each bit of SR, bit 15 first
  fprintf(ElogFile, ((0x8000 >> j) & SR) ? "1" : "0");
fprintf(ElogFile,"\nD2=%08lX D6=%08lX A2=%08lX A6=%08lX US=%08lX\n", D[2],D[6],A[2],A[6],A[7]);
fprintf(ElogFile,"D3=%08lX D7=%08lX A3=%08lX A7=%08lX SS=%08lX\n", D[3],D[7],A[3],A[a_reg(7)],A[8]);
```

(The bit loop is condensed here; the original uses an if/else, `RUN.CPP:824-829`.) `A7` is the active stack pointer; `US` and `SS` are `A[7]` and `A[8]`. PC is not in the register block (it is on the instruction line). The cycle counter is not logged.

**(c) Instruction line - all types.** `Form1->lineToLog()` (`SIM68Ku.cpp:869-909`) tries to find the listing row for the current PC and writes it with three labels inserted:

```cpp
str.Insert("PC=",0);              // add labels
str.Insert("Code=",14);           // add labels
str.Insert("Line=",42);           // add labels
fprintf(ElogFile, str.c_str());   // output instruction to log file
fprintf(ElogFile,"\n");
```

`Insert` positions are 1-based character positions in the progressively modified string (position 0 behaves as 1). Applied to a listing row (layout in 6.1) the result is: `PC=` + 8-digit address + 2 spaces + `Code=` + the 22-character object-code field + the first character of the 6-character line-number field + `Line=` + the remaining 5 characters of the line number + 2 characters + the source text.

How the row is found: a **binary search** over rows 3..end comparing the PC field's text with the first 8 characters of each row as strings, then a forward scan to the **last** consecutive row with that same address (so the instruction row is used rather than a label or comment row that shares its address). If the search fails - no listing loaded, PC not in the listing, or a listing whose addresses are not ascending (several ORGs out of order) defeating the binary search - the fallback is the same text as the message-area trace line (`RUN.CPP:838-841`):

```
PC=00001000  Code=103C  MOVE
```

**Quirk:** the listing row is passed to `fprintf` as the *format string*. A source line containing `%` (for example in a comment) is interpreted as a printf directive in the original (undefined output). A port should write the row literally and note the deviation.

**Literal examples** (reconstructed from the format strings; line ends are CR LF in the real file; the date format depends on the Windows locale).

Type 1, `Instruction only`:

```
EASy68K execution log file: 11/20/2026 3:04:05 PM

PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0
PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1
PC=0000100A  Code=4E4F                   Line=   11      TRAP    #15
PC=0000100C  Code=FFFF FFFF              Line=   12      SIMHALT
```

Type 2, `Instruction and Registers` (first two entries):

```
EASy68K execution log file: 11/20/2026 3:04:05 PM


D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC
D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000
D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000
D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000
PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0

D0=0000000E D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC
D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000
D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000
D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000
PC=00001004  Code=43F9 00001012          Line=   10      LEA     MSG,A1
```

Type 3, `Instruction, Registers and Memory`, with `From = 00001012`, `Bytes = 10` (first entry):

```
EASy68K execution log file: 11/20/2026 3:04:05 PM


00001010: FF FF 48 65 6C 6C 6F 00 FF FF FF FF FF FF FF FF --Hello---------

D0=00000000 D4=00000000 A0=00000000 A4=00000000    T_S__INT___XNZVC
D1=00000000 D5=00000000 A1=00000000 A5=00000000 SR=0010000000000000
D2=00000000 D6=00000000 A2=00000000 A6=00000000 US=00FF0000
D3=00000000 D7=00000000 A3=00000000 A7=01000000 SS=01000000
PC=00001000  Code=103C 000E              Line=    9      MOVE.B  #14,D0
```

The header's `\n\n` produces one blank line; each register or memory block begins with its own `\n`, which is why types 2 and 3 show two blank lines after the header and one blank line between entries, while type 1 has no blank lines between entries.

### 13.5 Output log, Log Stop, and log notes

**Output log content** (only when `logging && OlogFlag == TEXTONLY`), written by the I/O window character by character and flushed each time:

- every printable character the program displays (`ch < 0 || ch >= 0x20`), and the control characters BS, FF, LF, CR, TAB and VT as raw bytes; BEL is not logged (`simIOu.cpp:816-875`);
- a single LF (`"\n"`, one byte because the file is binary) for each automatic new line (`doCRLF`, `simIOu.cpp:998-1007`) - so lines ended by the simulator end in LF while lines the program ended itself with CR LF contain CR LF;
- every key the user types during line input while keyboard echo is on (`simIOu.cpp:1398-1401`).

The output log is written both when tracing and when running at full speed.

Example (`MOVE.B #14,D0` / `TRAP #15` printing `Hello`, then task 13 printing `World` with new line):

```
EASy68K output log file: 11/20/2026 3:04:05 PM<CR><LF>
<CR><LF>
HelloWorld<LF>
```

**Log Stop** (Run > Log Stop, Ctrl+F5, toolbar) calls `stopLog()` (`logU.cpp:202-214`): if `logging`, both files are closed, `logging = false`, Log Start is enabled, Log Stop disabled and the `LOGGING` label hidden.

**Automatic stops.**

| Event | Function | Box shown |
|---|---|---|
| SIMHALT; TRAP #15 task 9; STOP with exceptions off; bus/address error with exceptions off (`haltSimulator`) | `stopLogWithAnnounce()` (`logU.cpp:217-223`) | modal `Current Log Stopped.` (title `Information`, OK), shown **before** the files are closed |
| A new program is opened while logging | `setLogFileNames` | same text, shown after closing |
| Exit / closing the main window | `stopLog()` | none |

Other halts (illegal instruction, divide by zero, etc. with exceptions off) and breakpoints do **not** stop logging.

**Log notes.** Rewind writes `"\n***** Reset Program Pressed *****\n"` and Reload writes `"\n***** Reload Program Pressed *****\n"` through `Log->addMessage` (`logU.cpp:289-295`):

```cpp
if (logging && eLogType)
  fprintf(ElogFile, msg.c_str());
if (logging && oLogType)
  fprintf(OlogFile, msg.c_str());
```

**Quirk:** `eLogType` / `oLogType` are not the active log types; they are the snapshot taken the last time the Log Output dialog was *shown* (for its Cancel button, `logU.cpp:33, 278-281`). The notes are therefore written only if the dialog has been opened at a moment when the type was already non-zero. With log types restored from the settings file and the dialog never opened in the session, no note is written.

### 13.6 Enabled states and the LOGGING indicator

| Command | Enabled when |
|---|---|
| Log Start | disabled at start-up (`SIM68Ku.cpp:1499-1502`); enabled when a program is loaded and a log type is non-zero, or when the Log Output dialog is confirmed with a non-zero type; disabled while logging; enabled again after any stop. It is not disabled again if both types are later set to Disabled. |
| Log Stop | enabled only while logging |
| `LOGGING` label | visible from the moment a log file has been opened and its header written until the log is stopped |

> **Corrected (erratum U4 6).** OK of the Log Output dialog enables Log Start only while not logging.

---

## 14. Options and persistence

### 14.1 Every item of the Options menu

| Caption | Variable(s) | Default | Effect | Saved in `sim68K.dat` |
|---|---|---|---|---|
| `Source Window Font...` | `FontDialogSource->Font`, applied to `ListBox1`, `HeadingsLbl`, `Message` | Courier New, 10 pt (`SIM68Ku.cpp:1528-1529`) | Font dialog restricted to fixed-pitch fonts, sizes 8-18 (`SIM68Ku.dfm:2241-2252`). On OK the font is applied to the listing, the heading and the message area, and the row height becomes `(height < 0 ? (int)(height * -1.1) : height) + 1` px, where `height` is the font's `Height` property (`SIM68Ku.cpp:940-952`). | name and size (lines 30-31); colour and style are not |
| `Output Window Font...` | `FontDialogSimIO->Font`, applied to the I/O window and its back buffer | Fixedsys, 9 pt (`SIM68Ku.cpp:1524-1525`) | Fixed-pitch fonts, sizes 8-18. On OK the I/O window font changes and its text rows/columns are recomputed (`SIM68Ku.cpp:956-963`, `simIOu.cpp:392-408`). Every `initSim()` re-applies this font, undoing font changes the program made with TRAP #15 task 21. | name and size (lines 28-29) |
| `Printer Font...` | `FontDialogPrinter->Font` | Courier New, 10 pt (`SIM68Ku.cpp:1532-1533`) | Any font. Used for TRAP #15 task 10 printing; OK calls `initPrint()` (`SIM68Ku.cpp:967-972`, `CODE9.CPP:75-88`). | name and size (lines 32-33) |
| `&Log Output...` | `ElogFlag`, `OlogFlag`, file names, memory range | both Disabled | Opens the Log Output dialog (13.2) | the two types only (lines 2-3) |
| `&Enable Exceptions` (checkable) | `exceptions` (`var.h:59`) | off (`SIM68Ku.cpp:1495`) | Toggles 68000 exception processing: when on, errors/TRAPs vector through the program's exception table; when off they stop the program with a message (9.12). The settings file is rewritten immediately (`SIM68Ku.cpp:1271-1281`). Also turned on by `/e` and by TRAP #15 task 32 sub-task 5 (which also saves, `CODE9.CPP:924-928`). | yes (line 4) |
| `&Auto Trace Options...` | `AutoTraceTimer->Interval`; `AutoTraceOptions->DisableDisplay->Checked` | 200 ms; unchecked | Modal dialog `Auto Trace Options`: label `Auto Trace Interval`, a read-only number field with an up/down control (minimum 10, maximum 1000, step 10; `Optionsu.dfm:82-112`), label `mSec`, check box `Disable display update`, buttons `&OK` and `&Cancel`. OK sets the timer interval from the field (`Optionsu.cpp:25-29`). Cancel only closes: changes made to the number field or the check box are **not** reverted, and the check box is read live by the display code (Quirk). | interval text and check box (lines 36-37); the saved interval is shown in the dialog at start-up but not applied to the timer until OK is pressed (Quirk, 9.7) |
| `&Fullscreen Options...` | `FullScreenMonitor` (`var.h:144`) | 0 (primary) | If the multi-monitor API is missing: box `Sorry, but your system does not seem to support multiple monitors.`; if the I/O window is currently full-screen: box `Please deactivate fullscreen mode before attempting to change the fullscreen settings.`; otherwise a modal dialog `Fullscreen Options` with the text `Screen to use for fullscreen output window.  Primary screen = 1  Secondary screens = 2 and up.`, a number field and `&Ok` / `&Cancel`; `Ok` is enabled only for 1..number of monitors and stores the number minus 1 (`SIM68Ku.cpp:1382-1393`, `FullscreenOptions.cpp`). `initSim()` resets the value to 0 on every load/rewind (`STARTSIM.CPP:85`). | written (line 34) but never successfully read back (14.3) |
| `Enable &Bit Field Instructions` (checkable) | `bitfield` (`var.h:60`) | off (`SIM68Ku.cpp:1496`) | Toggles support for the 68020 bit-field instructions in the core; saved immediately (`SIM68Ku.cpp:2037-2047`). Also turned on by `/b` and by a `*[sim68k]bitfield` line in the listing (8.2). | yes (line 35) |
| `Output Window &Size` > nine sizes | `canWidth`, `canHeight` (`simIOu.cpp:44-45`) | 640x480 | `simIO->setWindowSize(w, h)` (`SIM68Ku.cpp:2051-2087`, `simIOu.cpp:187-233`): sets the I/O window's client area, resizes the back buffer and **fills the window with black** (previous output is erased; the text cursor position is not reset). Minimum 640x480. The radio check marks always mirror the actual size (`WindowSizeChecked`, `SIM68Ku.cpp:2090-2121`), including a size set by the program with TRAP #15 task 33; if the size is not one of the nine, no item is checked. | no |
| `Output Window Text &Wrap` (checkable) | `textWrap` (`simIOu.cpp:38`) | off | Toggles wrapping in the I/O window: with wrap on, moving the text cursor past the right edge performs a new line (`simIOu.cpp:1050-1054`); with wrap off, text continues off-screen. Not reset by Rewind/Reload. | no |

> **Corrected (erratum U4 14).** The port's option dialogs (U4): one font dialog `sim.font` for the three targets. Output Window Font: the five measured fonts, sizes 8-18, the styles Regular, Italic, Bold, Bold Italic, Strikeout, Underline and the sixteen colours; OK saves name and size and calls `TextScreen.setOptionsFont(font, color)`, style and colour last for the session; with several styles the text screen draws one (erratum SH3 13). Source Window Font: the same fonts and sizes, no style or colour. Printer Font: any name, sizes 1-255. Titles are the menu captions without the dots. Auto Trace Options: a read-only interval with up/down (10-1000, step 10); Fullscreen Options while full screen is on shows the original's `Error` box `Please deactivate fullscreen mode before attempting to change the fullscreen settings.`, and its value is never saved (erratum U4 15). Enable Exceptions and Enable Bit Field follow and set `SimSettings.exceptions` / `.bitField` and the engine option (erratum U4 16).

### 14.2 What is and is not remembered between sessions

Remembered (in `sim68K.dat`): log types, exceptions, bit field, main window position and size, I/O window position, memory window position and address, stack window position/height/selected register, Hardware window position and its four device addresses, visibility of the memory, stack and Hardware windows, three font names and sizes, auto-trace interval and "disable display update".

Not remembered: the last opened file (there is no recent-files list), log file names, the log memory range, breakpoints of any kind, I/O window size, text wrap, the memory window's `Live` check box and From/To/Bytes fields, the memory window size, the Break Points window contents, the listing scroll position, the splitter position.

### 14.3 The settings file `sim68K.dat`

**Location:** the folder of `SIM68K.exe` (`ExtractFilePath(Application->ExeName) + "sim68K.dat"`, `SIM68Ku.cpp:1435, 1556`). The program therefore needs write access to its own folder; if the file cannot be written nothing is reported.

**When written** (`SaveSettings`, `SIM68Ku.cpp:1430-1485`): on Exit and on closing the main window; immediately when Enable Exceptions or Enable Bit Field Instructions is toggled; when TRAP #15 task 32/5 enables exceptions; on every Log Start.

**When read** (`LoadSettings`, `SIM68Ku.cpp:1551-2034`): once, when the main window is first shown. `defaultSettings()` (`SIM68Ku.cpp:1489-1544`) is applied first; then, if the file exists, each line overrides one default.

**Format:** a text file of 37 lines (CR LF line ends), each `value` immediately followed by `$name`. Line 1 is a header and is not checked. The lines are **positional**: the loader reads line N and accepts it only if the text from the `$` on equals the expected name; a non-matching line is skipped but still consumed, so an inserted or missing line makes all later lines fail and fall back to defaults.

| Line | Text after the value | Value written | Load rule | Default |
|---|---|---|---|---|
| 1 | `$Settings for EASy68K Simulator v5.16.1  DO NOT EDIT THIS FILE!!!!` (the whole line) | - | ignored | - |
| 2 | `$exec log` | **one raw byte** with value 0-3 (`ElogFlag` is a `char` streamed as a character, not as a digit) | accepted if the byte is 0..3 | 0 |
| 3 | `$output log` | one raw byte, 0-1 | accepted if 0..1 | 0 |
| 4 | `$exceptions` | `0` or `1` | `'1'` turns it on | 0 |
| 5 | `$main top` | integer px | if > screen height - 20 use 100 | Windows default |
| 6 | `$main left` | integer px | if > screen width - 20 use 100 | Windows default |
| 7 | `$main height` | integer px | capped at screen height | 500 |
| 8 | `$main width` | integer px | capped at screen width | 744 |
| 9 | `$simIO top` | integer px | if > screen height - 20 use 300 | 300 |
| 10 | `$simIO left` | integer px | if > screen width - 20 use 200 | 200 |
| 11 | `$simIO visible` | `0` or `1` | `'1'` shows the I/O window; `'0'` does nothing | visible (see below) |
| 12 | `$memory top` | integer px | if > screen height - 20 use 80 | 80 |
| 13 | `$memory left` | integer px | if > screen width - 20 use 280 | 280 |
| 14 | `$memory address` | hex digits of the memory window's Address field | written to the Address field | `000000` |
| 15 | `$memory visible` | `0` or `1` | `'1'` shows the memory window | hidden |
| 16 | `$stack top` | integer px | if > screen height - 20 use 200 | 200 |
| 17 | `$stack left` | integer px | if > screen width - 20 use 40 | 40 |
| 18 | `$stack height` | integer px | as is | 538 |
| 19 | `$which stack` | 0-8, index of the stack window's register combo | as is | 8 (`SS`) |
| 20 | `$stack visible` | `0` or `1` | `'1'` shows the stack window | hidden |
| 21 | `$hardware top` | integer px | if > screen height - 20 use 100 | 100 |
| 22 | `$hardware left` | integer px | if > screen width - 20 use 240 | 240 |
| 23 | `$7-segment address` | hex digits | Hardware 7-segment address field | `E00000` |
| 24 | `$LED address` | hex digits | Hardware LED address field | `E00010` |
| 25 | `$switch address` | hex digits | Hardware switch address field | `E00012` |
| 26 | `$button address` | hex digits | Hardware push-button address field | `E00014` |
| 27 | `$hardware visible` | `0` or `1` | `'1'` shows the Hardware window | hidden |
| 28 | `$output font name` | text | Output Window Font name | `Fixedsys` |
| 29 | `$output font size` | integer pt | Output Window Font size | 9 |
| 30 | `$listing font name` | text | Source Window Font name | `Courier New` |
| 31 | `$listing font size` | integer pt | Source Window Font size | 10 |
| 32 | `$printer font name` | text | Printer Font name | `Courier New` |
| 33 | `$printer font size` | integer pt | Printer Font size | 10 |
| 34 | `$fullscreen monitor` | **one raw byte** (`unsigned char FullScreenMonitor`) | effectively never loaded (see below) | 0 |
| 35 | `$bit field enabled` | `0` or `1` | `'1'` turns it on | 0 |
| 36 | `$auto trace interval` | text of the interval field | sets the up/down control position (10..1000); **not** the timer | 200 |
| 37 | `$disable display` | `0` or `1` | sets the check box | 0 |

The file shipped with 5.16.1 (`sim68K.dat` in the source folder) matches this layout; its lines 2, 3 and 34 begin with a NUL byte.

Notes and quirks:

- **Line 11:** `defaultSettings()` sets `simIO->Visible = true` and the saved `0` is not acted on, so **the I/O window is always visible at start-up** regardless of the saved value (`SIM68Ku.cpp:1509, 1692-1696`).
- **Line 34:** the loader copies characters up to `$` but bounds the loop with `strlen(buffer)`; a value byte of 0 makes the string empty so the name never matches, and a non-zero byte is passed to `atoi`, which yields 0 (`SIM68Ku.cpp:1980-1991`). `initSim()` then sets the variable to 0 anyway. The full-screen monitor choice does not survive a restart.
- **Line 36:** see 9.7 - the timer keeps its 200 ms default until the Auto Trace Options dialog is confirmed.
- Lines 2 and 3 use raw bytes, so a file edited to contain the digit `1` there is rejected (the byte `0x31` is outside 0..3).
- The saved listing font is applied by `initSim()`, but the listing row height is only recomputed by the font dialog, so a non-default saved size is drawn with the 16 px default row height until the font is chosen again (Quirk, cosmetic).
- `bitfield` set by a `*[sim68k]bitfield` listing line and options set by `/e` or `/b` are written back on exit and so persist.

A port does not need this file format for its own settings store, but the defaults, the list of persisted items and the load-time rules above define the expected behaviour.

---

## 15. The I/O window's own interface

The I/O window (`simIO`, `simIOu.dfm`) has **no menu, no toolbar and no status bar**. Its caption is `Sim68K I/O`; the title bar has a system menu and a minimise button but no maximise button; the border is fixed (not resizable by dragging); the background is black; the client area is 640 x 480 by default. Its only components besides the canvas are the input-prompt timer (500 ms) and one Open and one Save file dialog that a TRAP #15 task can display.

Everything a user can configure about it lives elsewhere:

| Feature | Where | Details |
|---|---|---|
| Font | Options > Output Window Font... | 14.1 |
| Size / resolution | Options > Output Window Size (nine fixed sizes) | 14.1; a program can set other sizes with TRAP #15 task 33 |
| Text wrap | Options > Output Window Text Wrap | 14.1 |
| Full screen on/off | **Alt+Enter** while the I/O window has focus (`simIOu.cpp:436-438`); command-line `/f`; TRAP #15 task 33 | In full-screen mode the original changes the display resolution to the window size at 32 bits per pixel and makes the window borderless and top-most (`simIOu.cpp:250-345`). If the mode cannot be set: box `Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.` Full screen is left automatically when execution stops in trace mode or halts while the main window is on the same monitor (`RUN.CPP:701-704`), and by View > Output Window. |
| Full-screen monitor | Options > Fullscreen Options... | 14.1 |
| Showing the window | View > Output Window; also shown automatically whenever the program outputs a character while it is hidden (`simIOu.cpp:814-815`) or requests input (`simIOu.cpp:1326`) | Closing the window with its close button only hides it. |
| Output to a file | the output log (section 13) | there is no other "save output" or "print output" command |
| Paste as keyboard input | **Shift+Insert** while the I/O window has focus | up to 255 characters of clipboard text are fed to the key handler one by one (`simIOu.cpp:439-444`) |
| Next window | **Ctrl+Tab** | goes to the memory window (3.4) |

There are no user-interface controls for keyboard echo, the input prompt or line-feed display; those input-mode options (`keyboardEcho`, `inputPrompt`, `inputLFdisplay`) are set only by the program through TRAP #15 tasks and are reset to "on" by `initSim()`. While the program waits for line input a `_` prompt blinks at the cursor every 500 ms if `inputPrompt` is on (`simIOu.cpp:1420-1434`).

All three key commands above are disabled while the program has turned off simulator key commands with TRAP #15 task 24 (3.5).

---

## 16. Help and About

### 16.1 Help

Help is the compiled HTML Help file `help.chm` in the program folder, opened with `HtmlHelp(..., HH_HELP_CONTEXT, id)` (`SIM68Ku.cpp:1284-1291`). The context id comes from `getHelpContext(word)` (`help.cpp:232-251`): a case-insensitive exact match of `word` in a table, **falling back to the introduction page** (`IDH_INTRO`, `main.htm`) when the word is not in the table. Because several callers use words that are not in the table, the page that actually opens is:

| Where | Context word | In table? | Page opened |
|---|---|---|---|
| Help > Sim68K Help; F1 in the main window | `SIM_BASIC` | no (the table has `SIMULATOR`) | `main.htm` (introduction) |
| F1 in the Log Output dialog | `SIM_OPTIONS` | no | `main.htm` |
| F1 in the memory window | `MEMORY` | yes -> `IDH_DIRECT_MEMORY` | `Directives\memory.htm` (the assembler's MEMORY directive, **not** the memory-window page) |
| F1 in the stack window | `STACK` | yes | `SIMHELP\stack.htm` |
| F1 in the Break Points window | `BREAKPOINT` | yes | `SIMHELP\AdvBreakpoints.htm` |
| F1 in the Hardware window | `HARDWARE` | yes | `SIMHELP\hardware.htm` |
| F1 in the About box | `CHUCK` | no | `main.htm` |

(Mapping of ids to pages: `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\ez68k.ali`.) If HTML Help is not installed the box `HTML Help was not detected on this computer. The HTML help viewer may be downloaded from msdn.microsoft.com` is shown. A port can reasonably open the simulator pages directly; the table records what the original does.

The simulator help pages are `SIMHELP\BasicOperation.htm`, `SimOptions.htm`, `Memory.htm`, `Stack.htm`, `AdvBreakpoints.htm`, `Exceptions.htm`, `Hardware.htm`.

### 16.2 About box

Modal dialog `About EASy68K Simulator` (`aboutS.dfm`, binary form), centred on the screen, with the program icon and these texts:

- title label: set at show time to `EASy68K Simulator v5.16.1` (`aboutS.cpp:25-28`);
- `GUI implemenation: Charles Kelly` (spelling as in the original);
- `Original simulator code: Paul McKee`;
- `Simulator code modification: Charles Kelly, Eric Nelson`;
- `www.easy68k.com` (green, bold);
- `Use the EASy68K forum to submit bug reports.`;
- `EASy68K is distributed under the GNU general public use license. See Help for more information.`;
- `The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.`;
- an `OK` button.

---

## 17. Can execution logs be produced without user interaction?

**Answer: no.** Not through any combination of settings file and command line. Starting a log requires one user-interface event, and an execution log additionally requires trace-mode execution, which the command line cannot request. The reasoning, from the source:

1. **`logging` is always false at start-up.** `defaultSettings()` sets `logging = false` (`SIM68Ku.cpp:1494`) and the only assignment of `true` in the whole program is in `TLog::startLog()` (`logU.cpp:230`).
2. **`startLog()` has exactly one caller**, `TForm1::LogStartExecute` (`SIM68Ku.cpp:1418-1421`), the handler of the Log Start action (menu item, toolbar button, Ctrl+F4). Nothing calls it at load time or from the command line.
3. **The settings file can pre-select the log types but cannot start a log.** Lines 2 and 3 of `sim68K.dat` restore `ElogFlag` / `OlogFlag` (as raw bytes, 14.3). With a non-zero type and a program loaded, Log Start is *enabled* at start-up (`logU.cpp:69-72`) - but still has to be invoked.
4. **There is no logging switch.** The command line accepts only `/r`, `/f`, `/e`, `/b` (8.1).
5. **`/r` cannot produce an execution log even if logging were on.** It calls `RunExecute`, which sets `trace = false`, and the execution log is written only inside `if (trace)` (`RUN.CPP:771`). The help says the same: "Log data is only saved when tracing the program. No log data is saved when running the program at full speed." (`SimOptions.htm`).
6. **Auto Trace, the only unattended way to trace, is also a user command** (F10) and its tick rate is at most one instruction per timer interval (10 ms minimum, 200 ms unless the options dialog has been confirmed in the session).
7. **Modal boxes interrupt an unattended run:** the "file exists" dialog if the log file is already there (13.3); `Current Log Stopped.` at SIMHALT / task 9 / STOP / bus or address error while logging (13.5); `Help file not found` at start-up if `help.chm` is missing (1.2).
8. **The program never exits by itself** - there is no auto-exit at SIMHALT and no exit switch.

**What this means for using the official binary as a ground-truth oracle.** It can be automated only by synthesising user input on Windows (a UI-automation tool sending keys/clicks to the process). The sequence that the source implies is (UNVERIFIED in practice - nobody on this project has run it yet):

1. Work on a **copy** of the installation, never the files under `c:\easy64k\reference` (the program rewrites `sim68K.dat` in its own folder on exit, on Log Start and on some option changes). `help.chm` must be present in that folder.
2. Prepare `sim68K.dat` in that folder with line 2 beginning with the raw byte `0x02` (registers + instruction; `0x01` or `0x03` for the other types) and, for an output log, line 3 beginning with `0x01`. Optionally line 37 `1$disable display`.
3. Delete any existing `<name>_RunLog.txt` / `<name>_OutLog.txt` next to the `.S68` to avoid the Replace/Append/Cancel dialog.
4. Start `SIM68K.exe <name>.S68` (the `.L68` must be next to it if listing-based instruction lines are wanted). Do not use `/r`.
5. Send Ctrl+F4 (Log Start).
6. Trace: send F7 repeatedly, or send F10 (Auto Trace). For a faster Auto Trace first open Options > Auto Trace Options... and press OK so the saved interval is applied.
7. At the end of the program, dismiss the `Current Log Stopped.` box (Enter). The execution log has been flushed after every entry, so the file is complete even before the box is dismissed.
8. Terminate the process.

Caveats for comparing against such a log: the header contains a locale-formatted timestamp; registers are the values *before* each instruction, so the state after the last real instruction is the entry printed with the SIMHALT line; subroutine bodies are missing if Step Over is used; instruction lines depend on the listing (13.4); the cycle counter is never logged; a program that needs keyboard input pauses the Auto Trace until the input is typed into the I/O window.

**An alternative that needs no logs and no synthetic input** (also UNVERIFIED): `/r` does run a program unattended, and with logging off SIMHALT shows no dialog. A test program can therefore write its own results to a file with the TRAP #15 file tasks before SIMHALT (closing the file so the data is flushed), and a harness can start `SIM68K.exe test.S68 /r`, wait for the result file, and kill the process. This observes only what the test program chooses to dump (registers and memory at the end), not a per-instruction trace. `/r` depends on the main window being activated at start-up (1.4), so the process must be allowed to show its window normally.

---

## 18. Where the help pages and the source disagree

The source is authoritative. Help quotations are from the SIMHELP pages.

| # | Help says | Source does | Source |
|---|---|---|---|
| 1 | "If no matching 'Listing' (.L68) file is available, no code will display in the code window." | Nine lines of explanatory text are displayed in the listing pane and `Unable to open .L68 file.` is added to the message area. | `SIM68Ku.cpp:339-350` |
| 2 | "The Auto Trace, Trace and Step buttons will be disabled if the program is waiting for input." | True only while a Run or Step Over is in progress. After a Trace Into of an input instruction the buttons are enabled again while input is still pending; Auto Trace is not disabled but its ticks are skipped. | 9.13; `RUN.CPP:646-650, 707-711`; `SIM68Ku.cpp:1341` |
| 3 | Close: "Clears the current program from the display." | Asks for confirmation, clears the listing, resets the simulator (registers, I/O window) and clears all PC breakpoints. Memory and PC are kept. | `SIM68Ku.cpp:426-437` |
| 4 | Run stops when "The program reaches a STOP instruction / a user placed Break-Point / The user Pauses / Resets / An exception occurs." | Also stops at SIMHALT, at TRAP #15 task 9, at the Run-To-Cursor address, and when the PC becomes 0 (quirk). With exceptions enabled an exception does not stop the program. | 9.2, 9.12 |
| 5 | Breakpoint: "it will halt prior to running the instruction at the breakpoint." | True when the PC arrives at the breakpoint; not when execution is started with the PC already on it. | `RUN.CPP:657-666` |
| 6 | Embedded breakpoints: "Any source line that begins with the above text will automatically set a PC breakpoint on the following line of code." | Only if the *immediately following listing row* is an instruction row; a comment, blank or label-only row in between means no breakpoint is set. The match is case-insensitive. | `SIM68Ku.cpp:318-329` |
| 7 | Rewind: "Clears the Output Window, clears the 68000 registers and places the Program Counter at the beginning of the program." | Correct, but memory is not restored, and open files are abandoned without being closed. | 9.10 |
| 8 | Memory window Fill: "Enter the From and To address and the Bytes to fill with." | The `Bytes` field is a 32-bit value used as a repeating 4-byte pattern. | `Memory1.cpp:588-614` |
| 9 | Memory window: "The contents of memory may be changed by clicking on the desired location and entering a new value." | Correct; not mentioned: edits bypass the Hardware memory map (ROM/read-only areas can be modified). | `Memory1.cpp:444, 456` |
| 10 | Stack window: "The location of the selected register is highlighted in blue and the location of the current system stack is highlighted in yellow." | Colours are aqua and yellow, one byte each; the aqua mark is absent when the register value is `>= $01000000` (as SS is at reset). | `Stack1.cpp:104-109` |
| 11 | Advanced breakpoints: "The Count column specifies how many times the expression must be true before breaking." | The count is parsed as hexadecimal; a count of 0 breaks on every instruction until the expression is first true (erratum U3 1). | `BREAKPOINTSu.cpp:467-468`, `BPointExpr.cpp:147-149` |
| 12 | Options: "Auto Trace Options - Set the Auto Trace interval." | The interval takes effect only when the dialog's OK is pressed in the current session; the saved value is not applied at start-up. | `Optionsu.cpp:27`, `SIM68Ku.cpp:2009-2011` |
| 13 | Options: "Full Screen Options - Set the screen to use for full screen output." | The setting is reset to the primary screen by every load/rewind and is not restored from the settings file. | `STARTSIM.CPP:85`, `SIM68Ku.cpp:1980-1991` |
| 14 | Output log: "Text only - The text output from the traced program is logged." | Also logs echoed keyboard input, and logs at full speed as well (the help's file-name paragraph does say this). | `simIOu.cpp:1398-1401` |
| 15 | (Help menu) | "Sim68K Help" and F1 open the introduction page, not the simulator's Basic Operation page; F1 in the memory window opens the assembler's MEMORY directive page. | 16.1 |
| 16 | Batch file example: `"c:\easy68k\SIM68K" easyzone.s68 /r /f /e` | Consistent with the source. Not stated in the help: switches are ignored in the first argument position; `/e` and `/b` become permanent through the settings file. | 8.1 |

---

## 19. Register of quirks

"Affects program results" means the quirk can change what a student's 68000 program computes or outputs, or what an execution log contains, as opposed to only changing debugger conveniences.

| # | Quirk | Affects program results? | Section |
|---|---|---|---|
| Q1 | Registers are re-read from the screen fields at the start of every run command (`loadRegs`). | Yes - it is the mechanism for editing registers; a port must push edited values into the core before each run command. | 4.4 |
| Q2 | Typing in A0-A6, A7, US, SS writes the CPU register immediately, even while running. | Yes if the user types while running. | 4.4 |
| Q3 | Program stops when PC becomes 0 (`PC == runToAddr` / `stepToAddr` with value 0). | Yes - a running program that reaches address 0 is paused there with no message (as at a breakpoint; pressing Run continues from address 0). | 9.2 |
| Q4 | Stale `runToAddr` after an interrupted Run To Cursor stops a later Run once. | Only where execution stops. | 9.2 |
| Q5 | Run To Cursor runs the program even after its error boxes. | Debugger only. | 9.4 |
| Q6 | Step Over stops on the first return to the call's return address without checking stack depth; only BSR/JSR are stepped over. | Debugger only. | 9.5 |
| Q7 | Trace Into does not wait for keyboard input and leaves the run commands enabled. | Yes if the user continues before typing: following instructions run without the input. | 9.13 |
| Q8 | Pause cancels a pending input request. | Yes - the input never arrives. | 9.8 |
| Q9 | Pause during Auto Trace can leave Run/Step/Trace disabled until Pause is pressed again. | Debugger only (UNVERIFIED on the binary). | 9.8 |
| Q10 | Rewind keeps memory; Rewind/Reload/Open/Close forget open files without closing them. | Yes - a rewound program sees its previous memory contents; unflushed file data is not written until exit. | 9.9, 9.10 |
| Q11 | Reload after Open Data reloads the data file. | Yes (wrong program loaded). | 8.3 |
| Q12 | Open clears PC breakpoints even when the dialog is cancelled; Reload and drag-and-drop keep them. | Debugger only. | 6.5 |
| Q13 | The listing's first line overrides the S-record start address. | Yes - start PC. | 8.2 |
| Q14 | `*[sim68k]bitfield`, `/e`, `/b` persist into later sessions via the settings file. | Yes - option state of later sessions. | 8.1, 14.3 |
| Q15 | After a halt, Open/Run/Step/Trace are disabled until Pause or Rewind. | Debugger only. | 3.6 |
| Q16 | Saved auto-trace interval not applied at start-up; Cancel in Auto Trace Options does not revert. | Debugger only. | 9.7, 14.1 |
| Q17 | The I/O window is always visible at start-up; the full-screen monitor setting is never restored. | No. | 14.3 |
| Q18 | Cycle display uses a 32-bit format for a 64-bit counter. | Display only (UNVERIFIED). | 5 |
| Q19 | Memory window edits, Copy and Fill bypass the memory map; Fill uses a 4-byte pattern; no live update when the view starts at address 0. | Memory contents if the user uses them. | 10 |
| Q20 | Stack window: unmasked compare for the aqua mark; `SS` default view even in user mode. | No. | 11 |
| Q21 | Advanced breakpoints: hex count, count 0, A7 = user SP, read side effect, parenthesis conversion, Clear/edit slot mix-ups, stale expression indexes, 5-character Backspace. Also: a failed `PC/Reg`/`Memory` append still marks "operand entered" (`BREAKPOINTSu.cpp:553-554, 578-579`), and a memory condition's address is not masked to 24 bits (`BPoint.cpp:130`). | Only where execution stops (a W/L memory condition on an odd address can raise an address error in the program). | 12.2 |
| Q22 | Log Start sets `logging = true` even when the file dialog was cancelled or the open failed. | Log content / crash in the original. | 13.3 |
| Q23 | Listing rows are used as printf format strings in the execution log. | Log content for lines containing `%`. | 13.4 |
| Q24 | Rewind/Reload notes are written to the logs only if the Log Output dialog had been shown with a non-zero type. | Log content. | 13.5 |
| Q25 | Execution-log lookup uses a binary search over listing text; listings with non-ascending addresses fall back to the short `PC=... Code=... <mnemonic>` line. | Log content. | 13.4 |
| Q26 | `Application->MessageBox(text, NULL, mbOK)` is called with the VCL enum `mbOK` (value 2) where a Windows flag is expected, so the boxes `Selected line does not have a valid address.`, `Invalid Run-To-Cursor Selection`, `Invalid Breakpoint Selection` and the memory-allocation error would show Abort / Retry / Ignore buttons under the default title `Error` (VCL-inferred, UNVERIFIED). The result is ignored. | No. | `SIM68Ku.cpp:157, 490, 494, 771` |
| Q27 | The font-dialog "Apply" handlers `FontDialogSourceApply` / `FontDialogSimIOApply` exist but the dialogs have no Apply button, so they are unreachable. `RegChange` is not wired to any control. | No. | `SIM68Ku.cpp:976-986, 1086-1090` |

---

## 20. Coupling between the original core and the user interface

The decision to compile the original C++ core unchanged means every place where the core reaches into a VCL form must be given an equivalent. These are the couplings that involve the windows in this spec:

| Core location | UI dependency | Why it matters |
|---|---|---|
| `runprog()` `RUN.CPP:647-650`, `runLoop()` `SIM68Ku.cpp:256-259`, TRAP #15 task 23 `CODE9.CPP:881-884` | `Application->ProcessMessages()` and `Sleep(10)` | cooperative message pumping and the blocking wait for keyboard input; must become asynchronous yielding in a browser |
| `loadRegs()` `SIM68Ku.cpp:990-1021` | parses register values from the text of the edit fields | registers flow UI -> core at every run command |
| `scrshow()` `STARTSIM.CPP:130-175` | writes all register fields, the cycle counter, triggers highlight / stack / memory repaint | core -> UI refresh point |
| `memoryMapCheck()` `UTILS.CPP:287`, `mem_req()` `UTILS.CPP:469` | `Form1->regSR->EditText[3] == '0'` | **the supervisor test for the Hardware window's Protected memory range reads the SR *text field*, which is only updated by `scrshow()`.** During a full-speed run it reflects the S bit at the last display refresh, not the live SR. This is program-visible behaviour. |
| `exec_inst()` `RUN.CPP:777, 838` | `Form1->Message->Lines->Add`, `Form1->lineToLog()` | trace line and execution log; `lineToLog` reads the listing rows and the PC text field |
| `exec_inst()`, `LINE1111()`, `TRAP()`, `haltSimulator()`, `exceptionHandler()` | `Form1->AutoTraceTimer->Enabled = false`, `Form1->SetFocus()`, `Log->stopLogWithAnnounce()`, `Hardware->disable()` | halt side effects, including a modal box |
| `runprog()` `RUN.CPP:701-717` | `simIO->fullScreen`, `Form1->Monitor`, `Form1->setMenuTrace/Active`, `Form1->SetFocus` | stop handling |
| `mem_put()` `UTILS.CPP:396-397` | `Hardware->updateIfNeeded(loc)`, `MemoryFrm->LivePaint(loc)` | called on every memory write |
| `TRAP()` `CODE9.CPP:886-892, 924-928` | `Form1->setMenuTask19/restoreMenuTask19`, `Form1->ExceptionsEnabled->Checked`, `Form1->SaveSettings()` | shortcut suppression; option change persisted from inside the program |
| `initSim()` `STARTSIM.CPP:33-127` | fonts, `simIO` reset, `Form1->setMenuActive`, `Hardware->enable` | reset |
| `BPoint::isBreak()` `BPoint.cpp:178` | calls `value_of` -> `mem_req` | breakpoint evaluation has core side effects |
| `loadSrec()` `SIMOPS2.CPP:219-376` | `Form1->Message->Lines->Add`, Hardware memory-map fields | load messages |

---

## 21. Completeness check

The following were enumerated mechanically from the sources and each is covered above.

**Menu items (`TMenuItem` in `SIM68Ku.dfm`, 64 objects: 6 top-level menus, 13 separators, 44 items of which 9 are window sizes, and 1 pop-up item):** `File1`: `Open1`, `OpenData1`, `N7`, `Close1`, `N1`, `PrinterSetup1`, `N8`, `Exit1`. `Search1`: `Search2`, `N13`, `GotoPC1`. `RunMenu`: `Run1`, `N2`, `RunToCursor1`, `AutoTrace1`, `StepOver1`, `TraceInto1`, `Pause1`, `N3`, `Reset1`, `Reload1`, `N10`, `LogStart1`, `LogStop1`. `View1`: `OutputWindow1`, `Memory1`, `Stack1`, `Hardware1`, `BreakPoints1`, `EASyBIN1`. `Options1`: `SourceFont`, `OutputFont`, `PrinterFont1`, `N4`, `LogOutput1`, `N5`, `ExceptionsEnabled`, `N6`, `SimulatorOptions`, `N9`, `mmuFullscreenOptions`, `N11`, `BitFieldEnabled`, `N12`, `OutputWindowSize1` (`Size640x480`, `Size800x600`, `Size1024x768`, `Size1280x800`, `Size1280x1024`, `Size1440x900`, `Size1680x1050`, `Size1920x1080`, `Size1920x1200`), `OutputWindowTextWrap1`. `Help1`: `Help2`, `About1`. Pop-up `BreakMenu`: `ClearAllPCBreakpoints1`. - sections 3.1, 3.3.

**Actions (20):** `Open`, `OpenData`, `Close`, `Exit`, `Run`, `Step`, `Trace`, `Pause`, `Rewind`, `Reload`, `Help`, `About`, `FontSource`, `FontOutput`, `FontPrinter`, `AutoTrace`, `RunToCursor`, `LogStart`, `LogStop`, `Search` - section 3.1.

**Toolbar (16 `TToolButton` objects = 11 buttons + 5 separators `ToolButton3`, `ToolButton7`, `ToolButton9`, `ToolButton1`, `ToolButton2`; plus the `LoggingLbl` label):** section 3.2.

**`TForm1` methods (`SIM68Ku.h`):** `OpenExecute` 8.3; `CloseExecute` 8.5; `ExitExecute` 1.5; `RunExecute` 9.3; `StepExecute` 9.5; `TraceExecute` 9.6; `PauseExecute` 9.8; `RewindExecute` 9.10; `AboutExecute` 16.2; `ListBox1DrawItem` 6.1, 6.3; `ScrollBar1Change` 6.3; `FormActivate` 1.4; `FontSourceExecute`, `FontOutputExecute`, `FontPrinterExecute` 14.1; `FontDialogSourceApply`, `FontDialogSimIOApply` Q27; `regSRKeyPress`, `regKeyPress`, `regSRChange`, `regPCChange`, `regA0KeyUp`, `regA1KeyUp`, `regA2KeyUp`, `regA3KeyUp`, `regA4KeyUp`, `regA5KeyUp`, `regA6KeyUp`, `regA7KeyUp`, `regUSKeyUp`, `regA8KeyUp`, `regPCDblClick`, `regDblClick`, `loadRegs` 4.4; `RegChange` Q27; `Stack1Click`, `OutputWindow1Click`, `Memory1Click`, `BreakPoints1Click`, `Hardware1Click`, `EASyBIN1Click` 3.1; `FormShow` 1.3, 8.1; `FormResize` (repaint only); `breakPMouseDown`, `breakPPaint`, `ClearAllPCBreakpoints1Click` 6.5, 3.3; `ClearCyclesClick` 5; `LogOutput1Click` 13.2; `FormClose` 1.5; `ExceptionsEnabledClick`, `BitFieldEnabledClick`, `SimulatorOptionsClick`, `mmuFullscreenOptionsClick`, `WindowSizeClick`, `WindowSizeChecked`, `OutputWindowTextWrap1Click`, `PrinterSetup1Click` 14.1, 3.1; `HelpExecute`, `displayHelp` 16.1; `FormKeyDown`, `BringToFront` 3.4; `ListBox1DblClick` 6.6; `AutoTraceExecute`, `AutoTraceTimerTimer` 9.7; `OpenDataExecute` 8.3; `RunToCursorExecute` 9.4; `ReloadExecute` 9.11; `LogStartExecute`, `LogStopExecute` 13.3, 13.5; `SearchExecute`, `find`, `GotoPC1Click` 6.7, 3.1; `OnDisplayChange` (empty); `WmDropFiles` 8.4; `OpenFile` 8.2; `setMenuActive`, `setMenuInactive`, `setMenuTrace` 3.6; `setMenuTask19`, `restoreMenuTask19` 3.5; `runLoop` 9.2; `highlight` 6.4; `isInstruction` 6.2; `lineToLog` 13.4; `LoadSettings`, `SaveSettings`, `defaultSettings` 14.3; constructor/destructor 1.2, 1.5; free functions `LoadHtmlHelp` 1.2, `toUpper` 6.7.

**Other forms' methods:** `TMemoryFrm` (`FormCreate`, `Address1Change`, `FormPaint`, `LivePaint`, `FormResize`, `RowSpinUpClick`, `RowSpinDownClick`, `PageSpinUpClick`, `PageSpinDownClick`, `FormMouseWheelDown`, `FormMouseWheelUp`, `Address1KeyDown`, `Address1KeyUp`, `gotoRC`, `FormMouseDown`, `promptTimer`, `drawPrompt`, `erasePrompt`, `FormKeyPress`, `FormKeyDown`, `BringToFront`, `CopyClick`, `AddrKeyPress`, `FillClick`, `SaveClick`) section 10; `TStackFrm` (`FormCreate`, `FormPaint`, `FormResize`, `updateDisplay`, `DisplayStack`, `whichStackChange`, `FormShow`, `CSpinButton1UpClick`, `CSpinButton1DownClick`, `FormMouseWheelDown`, `FormMouseWheelUp`, `FormKeyDown`, `BringToFront`) section 11; `TBreaksFrm` (constructor, `sbpoint`, `cbpoint`, `resetDebug`, `setRegButtons`, `setAddrButtons`, `setExprButtons`, `RegStringGridClick`, `AddrStringGridClick`, `ExprStringGridClick`, `RegSetButtonClick`, `AddrSetButtonClick`, `ExprSetButtonClick`, `precedence`, `ExprRegAppendButtonClick`, `ExprAddrAppendButtonClick`, `ExprAndAppendButtonClick`, `ExprOrAppendButtonClick`, `ExprBackspaceButtonClick`, `ExprLParenAppendButtonClick`, `ExprRParenAppendButtonClick`, `RegClearButtonClick`, `AddrClearButtonClick`, `ExprClearButtonClick`, `RegClearAllButtonClick`, `AddrClearAllButtonClick`, `ExprClearAllButtonClick`, `RegValueKeyPress`, `AddrSelectKeyPress`, `AddrValueKeyPress`, `ExprCountKeyPress`, `RegStringGridDblClick`, `AddrStringGridDblClick`, `ExprStringGridDblClick`, `RegColumnMoved`, `AddrColumnMoved`, `ExprColumnMoved`, `RegRowMoved`, `AddrRowMoved`, `ExprRowMoved`, `RegTopLeftChanged`, `AddrTopLeftChanged`, `ExprTopLeftChanged`, `FormKeyDown`, `BringToFront`) sections 6.5, 12; `BPoint::isBreak`, `BPointExpr::isBreak` 12.2; `TLog` (`ELogOpenBtnClick`, `OLogOpenBtnClick`, `setLogFileNames`, `OKBtnClick`, `CancelBtnClick`, `prepareLogFile`, `stopLog`, `stopLogWithAnnounce`, `startLog`, `FormKeyDown`, `ELogTypeClick`, `MemFromKeyPress`, `MemFromExit`, `FormShow`, `addMessage`) section 13; `TLogfileDialog::setMessage` 13.3; `TAutoTraceOptions` (`OKClick`, `CancelClick`) 14.1; `TfrmFullscreenOptions` (`FormShow`, `txtScreenNumberChange`, `cmdOkClick`, `cmdCancelClick`) 14.1; `TfindDialogFrm` (`findNextBtnClick`, `cancelBtnClick`, `findTextChange`, `FormShow`, `FormKeyDown`) 6.7; `TAboutFrm` (`FormShow`, `FormKeyDown`) 16; `getHelpContext` 16.1.

**Global and file-scope flags touched by the UI:** `runMode`, `runModeSave`, `trace`, `sstep`, `old_trace`, `old_sstep`, `halt`, `stopInstruction`, `stepToAddr`, `runToAddr`, `inputMode`, `autoTraceInProgress`, `clRun`, `done`, `disableKeyCommands`, `startPC` (9.1, 3.5); `exceptions`, `bitfield`, `simhalt_on` (8.2, 14.1); `bpoints`, `brkpt[]`, `breakPoints[]`, `bpExpressions[]`, `bpCountCond[]`, `regCount`, `addrCount`, `exprCount`, `infixExpr[]`, `postfixExpr[]`, `infixCount`, `postfixCount`, `s_operator`, `mruOperand`, `mruOperator`, `parenCount`, `bpRead`, `bpWrite`, `readEA`, `writeEA`, `reg_edit_row`, `addr_edit_row`, `expr_edit_row` (6.5, 12); `ElogFlag`, `ElogFile`, `OlogFlag`, `OlogFile`, `logging`, `logMemAddr`, `logMemBytes`, `eLogType`, `oLogType`, `eLogName`, `oLogName`, `memoryFrom`, `memoryBytes` (13); `cycles` (5); `memAddr`, `HEX_LEFT`, `HEX_RIGHT`, `ASC_LEFT`, `ASC_RIGHT` (10); `stackAddr`, `midAddr`, `A7stackAddr`, `AregAddr` (11); `textWrap`, `canWidth`, `canHeight`, `simIO->fullScreen`, `FullScreenMonitor`, `MultimonitorAPIsExist` (14, 15); `HeadingStr`, `HEADING_LIMIT` (6); the eleven saved shortcut variables `openCut` .. `logStopCut` (3.5); `keyboardEcho`, `inputPrompt`, `inputLFdisplay`, `pendingKey`, `files[]`, `irq`, `hardReset` and the mouse/key state variables (reset list in 9.9; semantics in other specs).

**Message boxes in scope:** all `MessageBox` / `ShowMessage` / `MessageDlg` calls in `SIM68Ku.cpp`, `Memory1.cpp`, `BREAKPOINTSu.cpp`, `logU.cpp` and the full-screen ones in `simIOu.cpp` are quoted in the sections on the feature that raises them (1.2, 6.5, 8.4, 8.5, 9.4, 9.12, 10.5, 12.2, 13.1, 13.3, 13.5, 14.1, 15, 16.1). Three low-level ones are listed here only: `Error loading HTML help.` (`SIM68Ku.cpp:114`), `Html help may not have closed correctly` (`SIM68Ku.cpp:224`), and the settings errors `Error saving Sim68K settings` / `Error setting default Sim68K settings` / `Error loading Sim68k settings` (`SIM68Ku.cpp:1482, 1541, 2031`); and in the memory window `Error in Address1Change()` / `Error in CopyClick()` / `Error saving 68K memory to file.` (`Memory1.cpp:60, 567, 656`).

**Not covered here (other specs):** the Hardware window's controls, TRAP #15 task semantics, S-record parsing details, the instruction set, sound, serial and network I/O.
