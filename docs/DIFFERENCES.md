# Differences from EASy68K

This port is meant to behave like EASy68K v5.16.1 for Windows (the "original") in everything a
68000 program can notice: what a source file assembles to, the listing and S-record files, what an
instruction does, the cycle counts, the TRAP #15 tasks, the pixels a program draws and the log
files. The assembler and the simulator are the original's own C++ code, compiled for the browser.

Some things could not stay the same, because a web page or a Mac is not Windows, and some defects of
the original's windows and dialogs were fixed on purpose. This page lists every such difference and
why it exists. You can also open it from the application: Help > Differences from EASy68K.

## What could change the results of a program

Most differences below concern only the editor and the simulator's windows. These are the ones a
program can notice. If your program or your course depends on one of them, read its note.

- **Speed.** The simulator runs about 1,000,000 instructions per second on every computer (the
  original ran as fast as the PC allowed, roughly 0.3 to 3 million). A delay made of a counting loop
  therefore takes the same time everywhere. Options > Execution Speed... changes it. Delays made with
  TRAP #15 task 23 take exactly 10 ms per unit. (Part SH8 below.)
- **When keys and mouse clicks arrive.** A key press or a click reaches the program between groups
  of at most 2000 instructions, not after every single instruction. (Part SH8.)
- **Key codes on keyboards that are not US English.** TRAP #15 task 19 reports the key by its
  position on a US keyboard: on a French keyboard the key labelled A reports `$51` (Q). Typed
  characters (tasks 2, 4, 5, 18) are not affected. (Part SH4.)
- **Characters.** A character that Windows-1252 does not have (Greek, Cyrillic, emoji) is not
  delivered at all; the original delivered `?`. On a Mac, Option+key types the Mac character, and
  pasting into a running program is Cmd+V instead of Shift+Insert. (Part SH4.)
- **One key is taken from programs**: Ctrl+Alt+O (Ctrl+Option+O on a Mac) always moves the keyboard
  out of the Output panel, so that nobody can be trapped there (note 44).
- **Files.** A program reaches only the files in its own folder and the folders it was given, not
  the whole disk. In a browser those files are kept by the browser (My Programs) or in a folder you
  opened; the file name task 58 returns looks like `/browser/demo/data.txt` instead of `C:\...`.
  (Note 46, parts SH6, FS2 and DV2.) In the Mac app, on a disk that tells letter case apart (not
  the default on a Mac), a name that leaves the program's folders with `..` and comes back in
  another letter case is not found (part W1). A read right after a write on one file, or a write
  right after a read, without a seek between them (C leaves both undefined) gives the original's
  results, with two exceptions: bytes the program never wrote, which the original takes from its
  own memory, are zeros in the port; and a write that runs past the end of the file's 512-byte
  buffer, whose outcome in the original depends on the layout of its memory, always ends the same
  way in the port (part SH6, "The stream's buffer memory").
- **Serial port and network** (TRAP #15 tasks 40-43 and 100-107) work only in the Mac app. In a
  browser they return the original's "not available" results (note 37).
- **The Output window** is at most 4096 x 4096 pixels (part SH1), and Windows' system colours are
  those of a default Windows 11 desktop (parts SH1 and SH3).
- **Text in the outline fonts** (Courier New, Lucida Console, Consolas) has the original's sizes and
  positions but not quite its pixels (part SH3). The default font, Fixedsys, is exact.
- **Execution logs**: a listing line that contains `%` is written as it is (the original printed
  garbage there), and the date in the header is always in the US format (part U4, note 42).
- **Assembling.** Three rare sources assemble differently (part T1): an `IFxx` block whose
  condition is a symbol defined further down, with `SET` or `MACRO` lines inside; a macro body line
  with a printf conversion such as `%d`; and a structured `ENDI` with nothing open. A statement
  with an undefined symbol (an error) gets defined bytes, mostly zeros, where the original wrote
  whatever was in memory (part E5). Two sources that make the original crash (a macro line longer
  than 255 characters, a macro that calls itself without end) get an error message instead.

## How this page is organised

Part 1 is the list of changes decided when the port was designed (`docs/ARCHITECTURE.md`, section
1.4), with the features the port added. Part 2 holds the notes of each part of the port, word for
word. Part 3 lists the keyboard shortcuts that a browser does not give up. Part 4 lists what has
not been checked against the original yet. Part 5 lists the limitations the project knows of and
has not repaired yet.

A row or note marked **program** can change what a 68000 program observes; everything else concerns
only the interface.

## 1. Changes decided in the design

Copied from section 1.4 of `docs/ARCHITECTURE.md`. The note numbers are the ones the rest of this
document and the specifications refer to ("note 12").

1. **File dialogs** depend on the file backend (3.8): the browser store has its own dialog; the File
   System Access backend and the desktop app use system dialogs. Filters and default extensions are the
   original's. A name typed without an extension gets `.X68` when the first filter is selected
   (editor-ui §6.4 recommendation).
2. **Printing** goes through the system print dialog (browser or macOS). `Printer Setup...` opens the
   same dialog, because web pages cannot open a separate printer set-up. Page content rules are kept.
3. **Close** saves the document that is closing (the original saves the active one) and a cancelled
   Save As cancels the close. GUI defect, editor-ui §19.3.
4. **Exit.** Desktop app: quits after the close prompts. Web: runs the close prompts, saves settings,
   stops logs and shows an empty workspace with the text `You can close this tab.`; a page cannot close
   its own tab.
5. **Undo/redo** uses the editor component's history instead of the original's one-record-per-keystroke
   stacks with their defects (stale redo, overtype not recorded, corrupting comment undo). Nothing a
   program can observe depends on it.
6. **Comment / uncomment / indent / outdent** act on the caret line when nothing is selected; undo is
   correct. Otherwise editor-ui §8.5 exactly (column 0 only, one character per command).
7. **Find** starts at the caret when nothing is selected (the original restarts from the top of the
   document). `End of document reached.` and the restart from the top after it are kept. Replace does
   not replace a selection that is not a match; an empty replacement does not skip a character.
8. **Option dialogs**: Cancel restores everything; the Editor Options size box shows the document's real
   size; the modified flag is not touched by OK; F1 and Help open `options.htm` (the evident intent)
   instead of the introduction page.
9. **MDI** becomes tabs. `Cascade`, `Tile Horizontally` and `Tile Vertically` choose between one pane and
   two panes. `Arrange` and `Minimize All` act on minimised child windows, which do not exist in a
   tabbed interface; the items stay in the menu, disabled, so that the menu matches hand-outs.
10. **Help** is the original HTML, shown in a Help panel (web) or a help window (desktop). Entry points
    that the original sends to the introduction page by mistake (`SIM_BASIC`, `SIM_OPTIONS`, `MEMORY` in
    the memory window, `EDIT_OPTIONS`) open the page they were meant to open (sim-ui §16.1).
11. **About boxes** keep the original texts and add the port's name, version, repository link and the
    statement that the port is unofficial. `Check` compares with the port's latest GitHub release. The
    B-M-W Easter egg needs a picture of unknown origin from the binary form file and is dropped. F1 in
    the simulator's About box does nothing.
12. **Tab key** with Assembly tabs at column 12, 20 or beyond 43: the original inserts nothing; the port
    advances to the next stop (12 > 20 > 44 > next multiple of the fixed tab size). Shift+Tab deletes the
    blanks before the caret back to the previous stop (the original treats it as Tab). This changes what
    is typed, never how a file is assembled or listed.
13. **Swallowed keys.** The original blocks Ctrl+Backspace, Ctrl+Delete, Ctrl+E and every Ctrl+Shift
    combination to work around its edit control. The port lets the standard editing keys work.
14. **Menu mnemonics** work where the browser delivers Alt+letter. F10 never opens a menu (it is Auto
    Trace).
15. **`untitledN`** numbers do not skip.
16. **Line numbers and inline markers** are additions. Line numbers can be switched off (View setting in
    Editor Options, General).
17. **Status bar**: the fixed 64-underscore ruler has no meaning without a fixed window width.
18. **Messages**: the assembled document keeps its identity while include files are opened for their
    messages (the original lets the include file steal the active window, so later messages, the dialog
    title and Execute refer to the include file).
19. **Highlighting** has no 400 ms delay and is not limited to visible lines. The `Auto` preset follows
    the light or dark theme and is the default; choosing any original preset or colour behaves as in the
    original in both themes.
20. **Execute** gives the program a simulator in start-up state, as the original does by starting a new
    simulator process: the window's simulator is shut down the way SIM68K exits and started again
    (4.7.1), then the file is loaded like a command-line file. Nothing of an earlier program is left -
    no memory-map range, output size, pen position, breakpoint or open port. The original leaves the
    earlier simulator windows open; the port has one simulator per window, so if a program is running
    or waiting there, the `Caution` question of sim-ui §8.4 is asked first (not when it is stopped or
    halted; O-16). A second window keeps the old one (note 43). Execute is enabled when the engine
    reports it (`AsmResult.executeEnabled`) and this assembly wrote the S-record (4.9 step 9; erratum
    E5 1).
21. **Settings files** next to the executable cannot exist in a web page or a signed app bundle.
    Positions and sizes of Windows windows (`$main top` and its neighbours, the simulator's window
    lines) and the `$maximized edit` flag have no meaning in a tabbed single window; they are ignored on
    import and written with the original's defaults on export.
22. **Open and Reload stay enabled** after a halt and while a program runs (the original disables Open
    after a halt until Pause or Rewind). While a program is running, Open asks the `Caution` question
    first. Run, Run To Cursor, Auto Trace, Step Over and Trace Into keep the original's disabled state
    after a halt; their tool-tip then reads `Program halted. Rewind or Reload to run it again.`
23. **Run To Cursor** runs only when a valid instruction row is selected; after either error box the
    original runs anyway (sim-ui Q5).
24. **Pause during Auto Trace** always re-enables the run commands (sim-ui Q9).
25. **Log Start** cannot use Ctrl+F4 in a browser on Windows or Linux (it closes the tab).
26. **EASyBIN** is a mode of the same application, not a separate process.
27. **Font dialogs** are the port's own. The Output Window Font list is limited to the fixed-pitch
    fonts of the measured metric table (3.5.1: Fixedsys, Courier, Courier New, Lucida Console,
    Consolas), because the text grid depends on those measurements. Colour and style choices behave as
    in trap15-a §3.2.
28. **Auto Trace Options**: the saved interval is applied at start-up (sim-ui Q16).
29. **Fullscreen Options**: a web page and a single-window app cannot place the output on a chosen
    monitor. The dialog is kept with its text; it accepts only `1`. The original resets the choice on
    every load anyway and never restores it from the settings file.
30. **Ctrl+Tab** is reserved by browsers. F2 replaces it, except in the Output panel, where F2 belongs
    to the program and `Ctrl+Alt+O` moves on (note 44). The desktop app also has Ctrl+Tab itself.
31. **Registers that changed** since the previous stop are shown in the accent colour (added; can be
    switched off). Values and refresh moments are the original's.
32. **Cycle counter** shows the full 64-bit value. The original formats it with a 32-bit conversion
    (sim-ui Q18, unverified on the binary); `Overflow` above 2^48-1 is kept.
33. **Horizontal scrolling** of the listing is ordinary scrolling.
34. **Simulator status bar** is used for run state; the original's is always empty.
35. **Output panel** cannot be closed, only collapsed, so "showing the window" always succeeds.
36. **Full screen** in a browser needs a user gesture. When a program asks for it (task 33, `D1.L = 2`)
    without one, the Output panel shows `Press any key or click to enter full screen` and enters on the
    next key or click; task 33 results are unaffected. In Safari and Firefox the Esc key leaves full
    screen and does not reach the program; in Chromium browsers and in the desktop app it reaches the
    program, as in the original (2.5).
37. **Serial and network in the browser**: task 40 returns 2, tasks 41-43 return 3; tasks 100 and 101
    return `$276B0002`, 102 and 106 `$276D0001`, 103 and 107 return 0 with 0 bytes, 104 and 105
    `$276D0001` (trap15-a §6, trap15-b §12.4 option 1).
38. **Memory live update** fixes the unsigned-wrap defect at address 0 (sim-ui §10.4).
39. **Open** clears PC breakpoints only when a file was chosen (sim-ui Q12).
40. **Advanced breakpoints**: the editor defects of sim-ui §12.2 are fixed (slot mix-ups on Clear and
    edit, five-character Backspace, draggable rows, editable lists, stale indexes: deleting a condition
    renumbers the references in existing expressions and removes expressions that used it, after a
    confirmation). `Count` is read as decimal. The evaluation rules, including count 0, A7 = user stack
    pointer, last-read/last-write matching and the parenthesis conversion, are the original's because the
    engine evaluates them and they decide where a program stops.
41. **Log Start** after Cancel or a failed open leaves logging off (the original writes through a null
    file, sim-ui Q22).
42. **Log contents** are the original's, including the stale-snapshot rule for the Rewind/Reload notes
    (sim-ui Q24). One exception: a listing row is written literally, not used as a `printf` format
    (sim-ui Q23, sim-core §11.7); rows containing `%` differ from the original's undefined output.
43. **Several simulators.** The original is two programs that can each be started any number of times.
    The port is one window holding one editor and one simulator, and any number of such windows
    (browser tabs, `New Window` in the desktop app); they share settings and the browser store safely
    (3.8.6). Two simulators that talk to each other over the network are two windows of the desktop app.
44. **Keys in the Output panel.** The program receives every key the original's I/O window receives
    (2.9.4). The port takes exactly one chord away from programs: `Ctrl+Alt+O`, which moves the keyboard
    out of the Output panel in every state, so that a keyboard-only user is not trapped after task 24.
    The chords the port added elsewhere (F2, F4, Shift+F<n>) are not active there.
45. **Paste from the menu, toolbar or context menu** in a browser has no key event to ride on and must
    ask the browser for the clipboard: Chromium asks for permission once, Safari shows a small `Paste`
    confirmation each time. If the browser refuses, a toast says `Press Ctrl+V to paste` (Cmd+V on
    macOS). The keyboard chords and the desktop app are not affected.
46. **Files of a 68000 program.** Names are matched as on Windows (either slash, any letter case). A
    name with a drive letter, and a name that leaves what the program may reach (3.8.4), does not
    resolve; the program gets the original's result for a missing file. The path task 58 returns is the
    port's own (`/browser/demo/data.txt`, or a real path in the desktop app), not a Windows path.
    Written data becomes visible when the original's C library would have written it (3.8.4).

### Additions

Copied from section 1.5 of `docs/ARCHITECTURE.md`. None of them changes what a program does.

Light and dark themes; mode switch; tabs; line numbers; inline error markers; automatic local drafts
(3.9.4); a Files panel for the browser store; execution-speed setting (4.5); changed-register colouring;
Log panel; integer zoom of the Output panel; import/export of the two settings files; export and
import of the browser store as a `.zip`; several windows; `Esc` closes dialogs. `Open Recent` is
deliberately not added: the original has none and the Files panel covers it.

Added commands. In a menu they come after the original items, below a separator, so that the original
items keep their positions:

| Caption | id | Where | Win/Linux | macOS |
|---|---|---|---|---|
| (mode switch) Editor / Simulator / EASyBIN | `app.mode.set` (arg: mode), `app.mode.next` | segmented control; `app.mode.next` on a key (not while the Output panel has the keyboard) | F4 | F4 |
| `Theme` > `System`, `Light`, `Dark` | `app.theme.set` (arg) | theme button at the right of the toolbar row | - | - |
| `Import/Export Settings...` | `ed.options.transfer`, `sim.options.transfer` | end of the Options menu in Editor and Simulator mode | - | - |
| `Execution Speed...` | `sim.options.speed` | end of the simulator's Options menu | - | - |
| `Examples...` | `app.help.examples` | end of each Help menu (5.8) | - | - |
| `Differences from EASy68K` | `app.help.differences` | end of each Help menu; opens `docs/DIFFERENCES.md` rendered as a help page | - | - |
| (next panel) | `sim.panel.next` | key only (not while the Output panel has the keyboard) | F2 | F2 |
| (release keyboard from the Output panel: focus to the next panel) | `sim.output.releaseKeyboard` | key only | Ctrl+Alt+O | Ctrl+Option+O |
| `New Window` | `app.window.new` | desktop app: application menu; web: the same address in another tab | - | Cmd+N (desktop only) |
| `Files` panel show/hide | `app.files.toggle` | button at the left of the editor toolbar | - | - |
| `Log` panel show (erratum W3 40) | `sim.view.log` | end of the simulator's View menu | - | - |
| `Serial Ports...` (erratum DV4 2, W3 43; enabled in the desktop app only) | `sim.options.serialPorts` | end of the simulator's Options menu, after `Execution Speed...`, below a separator | - | - |

## 2. Differences recorded by each part of the port

Each part of the port records the differences it introduced in `docs/differences/<part>.md`. They are
copied here word for word, in the order the parts were built. The part names (W2, SH4 and so on) are
the work packages of `docs/ARCHITECTURE.md` section 9.

### Differences introduced by W1 (contracts and the virtual file system)

(`docs/differences/W1.md`)

Deliberate differences from the original that W1's code introduces, beyond those section 1.4 of
`docs/ARCHITECTURE.md` already lists. DOC1 (or whoever next merges the differences files) merges
this file into `docs/DIFFERENCES.md`, under 3.8.

| Where | Original | Port | Why |
|---|---|---|---|
| A file name that leaves the folders the macOS app may use with `..` and comes back in another letter case (for example `..\DEMO\data.txt` from inside the folder `demo`), on a case-sensitive Mac disk | Found: Windows disks ignore letter case | Not found (the `.L68` lookup, `INCLUDE` and `INCBIN`, the Files panel, EASyBIN). On a disk that ignores letter case (macOS and Windows disks as they ship) it is found, as on Windows. In the browser and in every folder the app may use it is found as on Windows | Learning the stored spelling of the folder above would mean listing a folder the person did not grant, which 7.6 forbids. `Vfs.resolve` keeps the spelling as given for such a segment (docs/porting/errata/W1.md, entry 15.1). The simulator's own file tasks (TRAP #15 tasks 50-59) use another lookup (`SyncFiles.resolve`, in the main process), which this row does not describe. |

### Differences introduced by W2 (component kit)

(`docs/differences/W2.md`)

Deliberate differences from the original's interface that the component kit introduces. None of
them changes what a 68000 program can observe (section 0, rule 1). DOC1 merges this file into
`docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Masked fields (registers, Hardware addresses) | Backspace clears a position and also beeps: `regKeyPress` / `addrKeyPress` reject the `#8` character after the mask has handled the key (`SIM68Ku.cpp:1074-1083`, `hardwareu.cpp:549-558`) | Backspace clears the position without a beep | A GUI defect (section 0 rule 1: fixed, not copied) |
| Masked fields, paste | Text is pasted through the mask (`a` admits any letter); a non-hex letter makes `StrToInt` throw at the next run command and an error box aborts the command (sim-ui §4.4) | Pasted characters the field does not accept are left out (only 0-9/A-F, 0/1 or digits arrive); nothing usable: a beep | A GUI defect; the result for valid input is the same |
| Masked fields, drag and drop, undo | Windows edit-control behaviour | Refused; the text always keeps its width | The original's masked edit never shows a shorter or longer text either |
| Tab strips | Document windows are MDI children; tool windows are separate forms | Tabs; Delete closes a closable tab; middle click closes | The port's window structure (2.1-2.3) |
| Splitters | Not in the original | Arrow keys, Home / End, Enter or double-click restores the default | Keyboard access to the layout of 2.3 |
| Dialogs and message boxes | Win32 dialogs | Escape closes a dialog with a Cancel answer (as 1.3.2 notes "Esc also closes (added)"); a message box follows the Windows rule: Escape answers Cancel, or OK when OK is the only button, and does nothing for Yes / No | Same answers as the original where it has them |
| Access keys in captions | Underlined only while Alt is held (Windows default) | Always underlined on Windows and Linux; hidden on macOS (`showMnemonics={false}`) | The menu bar and dialogs are in-window; macOS has no menu access keys (1.3.2 note 14) |
| Tab outside dialogs, Safari | Tab visits every control of a window | In Safari with the system's default setting ("Keyboard navigation" off) Tab skips buttons and check boxes that have no explicit tabindex outside dialogs; Option+Tab reaches them. Inside a modal dialog Tab visits every control in every browser (the dialog moves the focus itself; errata W2 entry 13) | As in any web page: the browser's own Tab order is kept outside dialogs |

### Differences introduced by W3 (application shell)

(`docs/differences/W3.md`)

Deliberate differences from the original's interface that the shell introduces, beyond those
section 1.4 of `docs/ARCHITECTURE.md` already lists. None of them changes what a 68000 program can
observe (section 0, rule 1). DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Undo, Redo, Cut, Copy, Paste, Select All from the keyboard while a text field other than the editor has the focus (the Find box, an address field) | The frame's shortcuts act on the document: Ctrl+Z in the Find box undoes in the editor (editor-ui §5.1) | Ctrl/Cmd+Z, X, C, V, A, Shift+Cmd+Z and Shift+Insert act on the focused field. Ctrl+Alt+Z (Redo) still acts on the document from anywhere | A browser performs clipboard keys only on the key's own event (1.4 note 45), and a field's own undo is what a user expects. A GUI detail; no program result depends on it |
| F5, F6, F7, F10, Ctrl+O, Ctrl+S, Ctrl+P, Ctrl+F, Ctrl+G, Ctrl+R (and Cmd+O, S, P, F, G on macOS) in a mode that has no command on the key | The key does nothing | The same, and the browser's own action (reload, save page, print, find) is suppressed as well | 2.9.3; a student who presses F5 or Ctrl+S from habit must not lose the simulator's state or get the browser's dialog |
| A shortcut pressed while a menu is open | Windows closes nothing and runs nothing (the menu loop owns the keyboard) | The same: no command runs while the focus is in the menu bar or a menu | Same behaviour, stated because the menu is the port's own |
| Shortcut text next to `Help > Help` | none | none, although F1 opens it when the editor does not have the focus | As the original's menu (editor-ui §2.6) |
| Editor status bar at the bottom of the window (until the editor component supplies its own) | `line: column`, `Modified`, `Insert`, empty, ruler | document name, `Modified`, `Insert` / `Replace` | Placeholder of wave 0; E2 owns the document's status bar (1.4 note 17) |
| Separators between panels | Fixed window layout; one splitter above the message area | Every separator can be dragged, moved with the arrow keys and reset with a double-click; positions are kept per window | 2.3 |
| Output panel "window" state | Always visible at start; can be closed and re-shown | Always visible at start; can be collapsed to a title bar, never closed; the collapsed state is not remembered | 1.4 note 35; 2.4 |
| Window title | `EASy68K Editor/Assembler v5.16.01`, `EASy68K Simulator v5.16.1` (replaced by the file name after a load), `EASyBIN v2.5.0` (replaced by the file opened last, back after New) | The same text of the mode in front, followed by ` - unofficial port <version>`; EASyBIN's file once B1 calls `setModeTitle` | 1.3.3 |
| Help from a modal dialog (the `Help` button and F1 of Editor Options and Assembler Options) | Opens the help file in its own window, above the dialog | Opens the Help drawer, which is drawn above the dialog's dimmed backdrop while the dialog stays open; the dialog keeps the keyboard focus, the page can be read and scrolled with the mouse | The port's help is a drawer of the window (2.1, 2.7); docs/requests/H1-help-from-dialogs.md |
| Help > EASyBIN Help | No shortcut shown; F1 opens the help only in the memory area and the Address field | No shortcut shown; F1 opens it anywhere in EASyBIN mode | F1 is a key of the mode (2.9.2), as in the editor and the simulator; docs/requests/B1-keys.md |

### Differences introduced by W4 (engine binding)

(`docs/differences/W4.md`)

The binding passes calls and bytes between the application and the two engines. It changes nothing
that a 68000 program or an assembly can observe (section 0, rule 1): outputs, results and host calls
are the engines' own, and the tests compare them between Node, Chromium and WebKit.

Two failures exist only in the port, because the original is one native program. DOC1 merges this
file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| The engines cannot be loaded (a file is missing from the server, or the browser refuses it) | Cannot happen: assembler and simulator are part of the executables | `createAsmEngine()` / `createSimEngine()` fail with `The assembler engine could not be loaded: <reason>. ...` / `The simulator engine could not be loaded: ...`; the application shows the text | The engines are separate files in the port |
| No new engine instance can be created for an assembly (the browser is out of memory) | Cannot happen in this form | The assembly ends with the `fatal` result `The assembler could not start: <reason>`, shown as `The assembler stopped: ...` (4.9); nothing is written | Every assembly runs in a fresh WebAssembly instance (assembler §1.8); the engine module alone would not answer at all in this case |

### Differences from the original introduced by FS1

(`docs/differences/FS1.md`)

None of these changes what a student's program can observe.

- **Dropped files are copied before they are opened (browser).** The original opens a dropped file
  where it lies. A browser gives the page the file's bytes but no path it can keep, so the port
  copies it into `My Programs/Imported/` and opens the copy; saving writes the copy. Use Export...
  to take it out again. The desktop app opens a dropped file where it lies, as the original does,
  and shows the Open dialog in a dropped folder.
- **Names that differ only in letter case are one name in every store.** As on Windows, Rename...
  refuses a name that exists in another spelling, and Import... and dropped files replace (after the
  question) the file that is already there under another spelling, keeping its spelling, instead of
  adding a second spelling beside it.
- **A dropped `.S68` brings its listing along.** The original loads only the first dropped file. The
  port still loads only that one, but also copies a dropped `.L68` with the same base name into the
  same folder, so that the simulator finds the listing beside the program instead of showing the
  nine explanatory lines.
- **A dropped `.S68` in Simulator mode may ask one more question (browser).** As in the original,
  `The current debug environment will be lost, click OK to continue.` (`Caution`) comes first when a
  program is loaded, and Cancel leaves everything as it was. After OK the port copies the file into
  `My Programs/Imported/` before loading it; if an earlier copy with other contents is already there,
  `"My Programs/Imported/<name>" already exists with other contents. Replace it with the new file?`
  (title `Drop`) is asked then. The desktop app loads a dropped `.S68` where it lies and asks only
  `Caution`, as the original does.
- **The port's own Open and Save dialogs (browser).** They list the browser store ("My Programs")
  and an opened folder instead of the disk, offer `From this computer...` (and `Open folder...` where
  the browser can), and say in a short note where files are kept. Names are checked against
  Windows' rules (no `\ / : * ? " < > |`, no reserved device names, no trailing space or period) so
  that exported files work on Windows. Only one file can be chosen from the list; several files can
  be brought in at once with `From this computer...` where the opener asks for several.
- **The Files panel** (an addition, 1.5): the browser store as a tree with New Folder...,
  Import..., Export..., Rename... and Delete. Delete and Import ask before removing or replacing
  anything.
- **A browser storage that is slow to answer does not hold up the start.** After three seconds the
  application is shown and the Files panel says that My Programs is still opening; what is opened
  or saved meanwhile waits for the storage (at most 20 s, after which the session keeps files in
  memory and says so).
- **A notice about Safari's storage rules (an addition; risk R-10).** In Safari, and in every
  browser on an iPhone or iPad, the Files panel shows a short notice above the tree from the first
  start: the browser may delete the programs kept in it after seven days without a visit, and an
  app made with "Add to Dock" or "Add to Home Screen" starts with its own, empty My Programs. It
  offers Export... (the whole store as a `.zip`) and `Got it`, which hides it for good in that
  browser. The Dock or Home Screen app shows, while its store is empty, one sentence with
  Import.... When the Files panel is hidden, or the visit starts in Simulator mode, the same text
  appears as a note at the first file written into the browser, until `Got it` or the note is
  closed. The desktop app and other browsers show none.
- **A full or blocked browser storage is reported.** The original writes to the disk and shows the
  run-time library's error. The port says in plain words that the file was not saved and that
  nothing saved before is lost, or that the browser keeps no files at all (some private windows).

### Differences from the original introduced by E1 (Documents)

(`docs/differences/E1.md`)

None of these changes what a program assembles to, its listing or its S-record.

- **Close saves the document that is closing**, and a cancelled or failed save (cancelled Save As,
  a refused write, Cancel at the Windows-1252 question, No at the save-conflict question) cancels the
  close and an Exit (1.4 note 3). The original saves the active document and closes anyway.
- **`untitledN` numbers** increase by one per new document; the original also counts opened and
  reloaded files (1.4 note 15).
- **Enabled state** is computed from the active document: Save, Save As and Close File need an open
  document (also a list document, which is editable); Reload File needs a document with a name. The
  original keeps frame-wide flags that ignore the active document (editor-ui §2.7, §19.3).
- **Open** allows several files to be chosen at once and starts in the folder of the active
  document; each file is opened in turn as the original opens one.
- **Saving a file changed in storage** since it was loaded or saved asks
  `'<name>' has been changed outside this window. Save anyway?` (3.8.6). The original overwrites.
- **Characters without a Windows-1252 byte** (typed or pasted) are asked about once per document:
  `This file contains N characters that EASy68K cannot store. They will be saved as "?".` (3.9.3).
- **Local drafts** of modified documents and the offer `Unsaved changes from your last session were
  found for <names>.` with Restore and Discard (3.9.4).
- **Unload guard**: the browser's "leave site?" prompt while a document is modified.
- **Exit on the web** ends with an empty workspace and `You can close this tab.` (1.4 note 4).
- **UTF-8 notice**: a file that is valid UTF-8 with multi-byte sequences opens as its Windows-1252
  bytes, as in the original, with the notice `This file looks like UTF-8. EASy68K reads it as
  Windows-1252.` (5.1).
- **Write failure** shows `Cannot create file "<path>". <reason>`; the original shows the VCL's
  exception message.
- **Reopening an already open file** replaces it in its own tab (the original closes the window and
  opens a new one at the end).
- **A trailer line too short to read** (`*~Tab size~4` without its closing `~`, erratum 2): both
  show `Error in LoadFile()` and keep the line in the text. The original's window is then left
  half set up (no repaint, no caption, no tab stops, possibly modified); the port opens the document
  normally. Derived from the source, not checked against the binary.

### Differences introduced by E2 (Editor component)

(`docs/differences/E2.md`)

None of these changes what a program assembles to, how it is listed, or what it does when it runs.

| Where | Original (editor-ui) | Port | Why |
|---|---|---|---|
| Tab key, Assembly tabs, at column 12, 20 or 44 and beyond | inserts nothing (§8.2, the `<=` rule) | advances to the next stop: 12 > 20 > 44 > next multiple of the fixed tab size | 1.4 note 12 |
| Shift+Tab | same as Tab (§5.2 rule 8) | deletes the blanks before the caret back to the previous stop | note 12 |
| Column Tab works from | the status-bar column (counts tabs, global tab size) | the true visual column | §19.3, note 17 |
| Status bar column | counts tab characters, global tab size (§7.2) | true visual column with the document's stops | note 17 |
| Status bar, last panel | 64 underscores and `^` | `Windows-1252  CR LF  Fixed tabs <n>` or `... Assembly tabs` | note 17 |
| Insert/Replace | Insert key only | also a click on the status-bar cell; Ctrl+Shift+I on macOS | 1.3.2 |
| Undo / Redo | one record per keystroke, stale redo, overtype not recorded, comment undo corrupts text, undo-to-empty clears Modified after a save | standard history: typing grouped, redo cleared by a new edit, overtype undoable, correct undo; Modified follows the saved state | note 5 |
| Comment / Uncomment / Indent / Outdent without a selection | nothing at column 0 of any line but the first; otherwise selects one character | act on the caret line; the caret moves with its text | note 6 |
| Ctrl+Backspace, Ctrl+Delete, Ctrl+E, Ctrl+Shift+arrows, Ctrl+Insert | swallowed / flips the Insert indicator | standard editor behaviour | note 13 |
| Ctrl+Y | (nothing) | (nothing) - not bound, although CodeMirror binds it to Redo by default | fidelity |
| Esc, then Tab | (Tab inserts) | moves the focus out of the editor | accessibility (2.11) |
| Line numbers | none | gutter, on by default (Editor Options) | note 16 |
| Inline markers | none | squiggle under the line and a gutter mark per message of the last assembly; text on hover and while the caret is on the line | note 16 |
| Characters without a Windows-1252 byte | saved as `?` silently | wavy underline, hover text `Not in Windows-1252: saved as ?` | 3.9.3 |
| MDI child windows | free windows, Cascade / Tile / Arrange / Minimize All | tabs; one or two panes; Arrange and Minimize All disabled; tab menu item `Move to the Other Pane` while two panes are shown | note 9 |
| Modified document | `Modified` in the status bar | also a dot on the tab | 2.4 |
| Paste from the menu, toolbar, context menu (browser) | pastes | the browser is asked for the clipboard; if it refuses, a toast `Press Ctrl+V to paste` (`Cmd+V` on macOS) | note 45 |
| Editor Options font missing on the system (Fixedsys, Courier New on some Macs) | n/a | shown in a monospace fallback; the stored name is kept | editor-ui §19.2 item 11 |
| Ctrl+V on macOS in a browser (rule K2) | n/a | as Paste from the menu: the browser is asked for the clipboard; if it refuses, a toast `Press Cmd+V to paste` (Cmd+V pastes directly) | note 45, errata entry 13 |

### Differences of E3 (syntax highlighter) from the original

(`docs/differences/E3.md`)

None of these changes what a program assembles to or does; they concern only the editor's colours.

1. **No delay, every shown line.** Lines are coloured at once on every change, not 400 ms after the
   last key stroke (ARCHITECTURE.md 1.4 note 19). The colour of each line is the original's.
2. **`Auto` preset (port).** The default: the original's Color1 colours on white in the light theme,
   a dark palette (ARCHITECTURE.md 2.8) in the dark theme. Every other preset uses the stored
   colours and background unchanged in both themes.
3. **List documents under `Auto`.** The original applied the editor background colour to every
   window, `.L68`/`.S68` included, with their text in the default black (`textS.cpp:78`). The port
   does the same under every stored preset (Color1, Color2, No Color, Custom, Disabled, none
   selected): a list document takes the stored background and black text, and no syntax marks.
   Under the port's own `Auto` preset a list document keeps the theme's editor colours.
   One quirk is not reproduced: when Editor Options is closed with OK while Disabled is chosen, the
   original recoloured the text of every open window in the Code colour, list windows included
   (`editorOptions.cpp:140-143` selects all text of each MDI child); list windows opened later were
   black again. In the port list text is always black under a stored preset.
4. **Long lines.** Lines longer than 255 characters, which overflowed a buffer in the original, are
   highlighted by the same rules over their whole length.

### Differences introduced by SH1 (drawing surface)

(`docs/differences/SH1.md`)

The surface draws the pixels of the output window with the port's own code, following the rules
measured on Windows GDI (`docs/porting/trap15-tasks-60-up.md` §4-§7). What a 68000 program reads
back - task 83 pixels, task 96 pen positions, the result of a flood fill - is meant to equal the
original in every case below unless the row says otherwise. DOC1 merges this file into
`docs/DIFFERENCES.md`.

| Where | Original | Port | Why | Can a program observe it? |
|---|---|---|---|---|
| Windows system colours (a colour value with bit 31 set, for example `$80000005`) | `GetSysColor`: the colour of the user's Windows theme | the fixed colours of a default Windows 11 desktop | there is no Windows theme to ask | Only if the original ran under a theme that is not the default |
| Flood fill (task 89) in a drawing mode other than 4 | combined through the mode last used on that canvas, which depends on what was drawn just before and on window messages in between (trap15-b §5.4, item V4) | always combined through the current mode | the original is not deterministic here; the port takes the case the original shows right after a pen primitive | Yes, where the original happens to fill in Copy mode instead |
| The window while double buffering is off | drawn separately from the back buffer, each call a second time. `LineTo` on the window starts at the window canvas's own pen position, and a flood fill reads the window's own pixel, so the window can show something else than the back buffer (after an input prompt moved the window pen; while the window is partly covered) | the screen shows the back buffer | one picture (ARCHITECTURE.md 3.4 rule 9; trap15-b §4.1, task 89) | No. Task 83 reads the back buffer in the original too. The picture on screen can differ in those two rare cases |
| The input prompt (`_`) and its erasing blank | painted on the window and left there until something is drawn over the cell or Windows repaints the window | a cell laid over the picture, removed at the next drawing call, task 94 or mode 16 | ARCHITECTURE.md 3.5.3 | No (task 83 never sees the prompt in either) |
| Size of the surface | any size up to 65535 x 65535 that Windows grants | each side at most 4096 (`MAX_SURFACE`) | memory; ARCHITECTURE.md 2.5 | Yes: task 33 with `D1.L = 0` then returns the clamped size |

No longer a difference: the round dots of pens wider than 14 pixels. They were a plain disc until
gate I1; they are now GDI's dots, measured for every pen width 2-255
(`docs/porting/errata/SH1.md` entry 14). Nor are ellipses and lines of pens 2 or more pixels wide,
which SH1 drew with stand-ins until SH2 delivered them in wave 2: they follow GDI's rules now, and
the few wide-pen ellipses that are not yet Windows' pixels are listed by SH2
(`docs/differences/SH2.md`).

### Differences introduced by SH3 (text screen, fonts, output device)

(`docs/differences/SH3.md`)

The text screen is a port, function by function, of the text half of the original's I/O window
(`simIOu.cpp`): control characters, cursor rules, eager wrap, the single scroll, the shadow array and
its stride, the prompt and its timing behave as in the original, quirks included. The text grid
(columns, rows, cursor positions, pen movement) is the one Windows measures for every font, style and
size, because it comes from the measured table and not from the browser. The glyphs of the raster
fonts (Fixedsys, the default, and Courier) are Windows' own in every size and style.

What differs is listed here. DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Task 95 (text at a pixel position) with the bytes `$01`-`$08`, `$0B`, `$0E`-`$1B`, in Fixedsys or Courier (every size and style) | Windows draws them from a fallback font, and what it draws depends on the Windows: Windows 11 (10.0.26300) a narrow box with coloured ClearType edges in a cell 4 pixels wide in the default font (5 for `$02`, which shows nothing); Windows Server 10.0.26100 other, unsmoothed shapes in a cell 6 pixels wide (12 for `$01`). The rest of the text moves left by what the cell is narrower | An empty cell of the font's own character width in the fill colour, as for a space (with underline or strike-out the line has the length Windows 11 gives it); the letters after it stay on the character grid | The two Windows draw 72 of T2's 90 captured texts with these bytes differently, so there is no one picture to copy (ARCHITECTURE.md 6.5.3 as corrected, erratum T2 25). Where both draw the same picture (16 texts), the port draws it too. `$09`, `$0A`, `$0D`, `$1C`-`$1F` are as in the original, the thin bar of a text of them alone included, and so is `$0C` except in the row about `$0C` below |
| Task 95 in Fixedsys or Courier: the byte `$80` in a text that also has `$7F`, `$86`, `$87`, `$88`, `$98`, an undefined byte (`$81 $8D $8F $90 $9D`) or a zero-width byte (`$09 $0A $0D $1C`-`$1F`) | Windows draws a euro sign there, from a fallback font, smoothed with ClearType, in a cell of that glyph's width (7 pixels in the default font, where `$80` alone is the font's 8-pixel block). In Fixedsys that width is always the same. In Courier it depends on what the program drew before, so the same program can place the text after a euro sign a few pixels differently from run to run (Courier 10: the euro sign 5 or 8 pixels wide; `$80 $86` in Courier 19: 25 or 30; in Courier 199: 185 or 150) | The cell has one of Windows' widths, measured for every size and style: in Courier the width Windows gives when the sizes are met in increasing order (the one it gives again in another process and twice in one run), so the pen and everything after it are Windows' in that history; the cell itself is blank in the fill colour | The euro sign's pixels are ClearType output of a font the project cannot ship, whose colours follow the text and fill colours and, by its colour fringes, presumably the user's font-smoothing settings (both captured Windows draw it alike; ARCHITECTURE.md 6.5.3 as corrected, signed off by the architect on 22 November 2026; errata T2 26 and SH3 32). Windows' width in Courier has no one value (6.5.3 decision 3 (b), erratum T2 29: of 1,753 euro texts captured in 31 histories, in reverse order of size 585 pens differ, each alone in a new process 207, and one random order differently from run to run), and the order in which a program meets the sizes cannot be known, so the port takes one of Windows' values on purpose. Where Windows' pen is the same in every history (every text in Fixedsys; in Courier 386 of the 800 of `text-path-euro` and 6 of the 15 of `text-control`), the port's pen and every pixel outside the euro sign are Windows' (run of 22 November 2026: `text-control` 21 of 21, `text-path-euro` 986 of 986, `golden/text-path-euro-pens.json` 1,125 of 1,125). `text-path-euro` has been captured on one Windows (10.0.26300) only |
| Task 95 in Fixedsys or Courier: `$0C` in a text that also has `$7F`, `$86`, `$87`, `$88`, `$98`, an undefined byte or a zero-width byte | `$0C` is drawn as an arrow from a fallback font, smoothed with ClearType, in a cell whose width depends on its neighbours (Fixedsys 9: `$0C "[" $86` gives `$0C` 10 pixels, `$0C "A" $86` 8) | The font's own `$0C` glyph in a cell of the font's width | Not modelled (gate I3, item 3b and review R4; errata T2 27 and SH3 33): the glyph is smoothed output of a font the project does not ship, and how a second Windows draws it is not known yet. In T2's suite `text-path-formfeed` (640 texts, captured on Windows 11 10.0.26300) no picture is Windows' and the pen is Windows' in 400; Windows' cell is wider in most of the others (the pen 1 to 45 pixels short, gate I3 item 3b). Windows draws these texts the same whatever it drew before (gate I3 item 3c, erratum T2 28); whether a second Windows does is not yet captured (ARCHITECTURE.md 6.5.3 as corrected) |
| Task 95 in Courier: `"@"` in a text that also has `$7F`, `$86`, `$87`, `$88`, `$98`, an undefined byte or a zero-width byte | What Windows draws depends on what the program drew before: the same text comes out in the font's own `"@"` after texts of smaller sizes, and in other pictures - with another cell width and, when the text also has a byte of `$80` or above, another pen position (Courier 71 plain `"@" $81`: the pen moves 60 or 88 pixels; Courier 140 plain: 75 or 155) - after larger ones or as the first text of the program | The font's own `"@"`, always: what Windows draws in the first case | Windows gives no one answer for such a text (ARCHITECTURE.md 6.5.3 as corrected, decision 3 (b); errata T2 28 and SH3 34): of 2,333 texts captured in order of size and again in reverse order, all were drawn differently, and 59 of 106 alone in a fresh program. Where Windows' pen is the same whatever came before (the texts without a byte of `$80` or above), the port's is the same: 1,000 of 1,000 |
| The pen position after task 95 with the bytes `$01`-`$08`, `$0B`, `$0E`-`$1B` (what a program sees through the next line or text drawn from the pen) | Each byte moves the pen by the font's character width, except in a text that also has a byte of `$80` or above (Windows' text path), where its width is the fallback font's, which differs between Windows | The font's character width always | The pen is Windows' in all 85 of T2's 90 `text-control` texts in which the two captured Windows agree; in the other 5 (Courier 0 and 19, Fixedsys 30, each with a byte of `$80` or above) the two Windows are 4 to 9 pixels apart and the port is 1 to 5 pixels further right than either (run of 22 November 2026, `check-text.mjs`: pens 85 of 85 where they agree, 85 of 90 in all). In a text that also has a byte of `$80` or above the port's pen is Windows' only rarely: in 12 of 320 such texts of an independent random sample, and in 0 of the 480 of T2's suite `text-path-fallback` (Windows 11 10.0.26300, where these pens are the same whatever was drawn before; erratum T2 29). Whether a second Windows gives the same pens is not yet captured; the `windows-oracles` job of CI compares them (6.5.3 decision 3: if it does, the port must give them) |
| Task 21 with a colour whose top byte is not 0 (`D1.L` above `$00FFFFFF`) | A Windows system colour (bit 31) or an entry of the stock palette (bit 24), as for pens and fills | The same rule, and the same colours as Windows in the ten cases T2 captured; the system colours are those of a default Windows 11 desktop, whatever the user's theme | The system colours of a desktop with another theme are not known to a browser (errata SH3.md entry 17) |
| Task 95 in Courier New, Lucida Console or Consolas: the byte `$7F` | Drawn from a fallback font, with that font's width in the background box (always) and for the pen (in a text that also has a byte of `$80` or above) | The widths and the pen are Windows' (measured per size); the glyph is blank | The fallback glyph is anti-aliased and machine dependent |
| Task 95 (or a character written at the cursor) in Courier New, Lucida Console or Consolas: a text whose only drawn bytes are `$7F` | The background box has the height of the fallback font's cell, which in some sizes differs by one row from the font's own (Courier New 8, Lucida Console 10) | The box has the font's own cell height; its width and the pen are Windows' | That height was not measured (errata T2 section 2); 12 of T2's 72 such references differ in that one row, all in those two fonts |
| Rewind, Reload, Open or Close after a program changed the font with task 21 | Unverified: the window may keep the cell size and the look of the task 21 font until task 21 is called again (trap15-a §12 item 4) | Every reset restores the Options font, its colour and its cell size | The behaviour trap15-a §12 item 4 recommends |
| Text in the outline fonts (Courier New, Lucida Console, Consolas, and Arial where Windows substitutes it) | Windows widens the opaque background of a text by one or two pixels where a letter's ink reaches beyond its cell | The background is exactly as wide as the characters | The port's glyphs for these fonts are substitutes (R-5); Windows' ink extents are not known |
| An outline font at a size for which no atlas exists (other than 8, 9, 10, 11, 12, 14, 16, 18, 24 and 36 points) | Windows draws the outlines at that size | The glyphs of the nearest atlas are scaled to the measured cell (averaged); they look softer. The grid is the measured one. Above 36 points the 36 point glyphs are enlarged. In the proportional substitute (font numbers 5 and 7) the widths of the single letters are estimated from the size of the em, so the pen position after task 95 can differ: at 1, 5, 100 and 255 points it is Windows' in half the measured texts and otherwise up to 1.3 % off (8 pixels on a text 619 pixels wide) | 3.5.1: text pixels come from data files only, the same in every browser |
| A font file or the metric table cannot be loaded (a file is missing from the server) | Cannot happen: the fonts are part of Windows | Text has the default grid (8 x 15 pixel cells) and empty cells until the files are there; a face whose atlas is missing or damaged has empty cells | The fonts are separate files in the port |
| A request for an output size above 4096 x 4096 | Accepted up to 65535 x 65535 | Clamped; the message area says `Output window size limited to 4096 x 4096` and task 33 reports the clamped size | 2.5 |

### Differences introduced by SH4 (keyboard, mouse, Output panel)

(`docs/differences/SH4.md`)

Deliberate differences from the original's I/O window that the Output panel and its keyboard and
mouse handling introduce, beyond those section 1.4 of `docs/ARCHITECTURE.md` already lists (notes
35, 36 and 44: the panel collapses instead of closing, full screen needs a user gesture in a
browser and Esc leaves it in Safari and Firefox, Ctrl+Alt+O is taken from programs). The rows
marked **program** can change what a 68000 program observes. DOC1 merges this file into
`docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| **program** - TRAP #15 task 19 on a keyboard layout other than US | The code of a key follows the layout: on an AZERTY keyboard the key labelled A is `$41`, on a QWERTZ keyboard the key labelled Z is `$5A`; punctuation keys have the layout's `VK_OEM` codes | The code follows the key's position on a US keyboard: the key labelled A on AZERTY is `$51`, the key labelled Z on QWERTZ is `$59`. Characters (tasks 2, 4, 5, 18) are not affected | Browsers report positions (`KeyboardEvent.code`) dependably and layouts only through the typed character (3.6, trap15-b §9.1). Erratum SH4-9 proposes the label for letters |
| **program** - keys that have no entry in the table of trap15-b §9.1 (Windows / Command key, menu key, the extra key of ISO keyboards, F13 and up) | Recorded by task 19 with their Windows code; they raise the key interrupts of task 62 | Not reported as keys; no interrupt. A character they type still arrives | The table is the spec's list; code 0 must not be posted (erratum SH4-8) |
| **program** - a character that Windows-1252 does not have (Greek, Cyrillic, emoji) | Windows delivers `?` (`$3F`) to an ANSI window | Nothing is delivered | 3.6 |
| **program** - keys pressed while an input method composes text | The key code is `$E5` (`VK_PROCESSKEY`); the composed text arrives as characters | The key's own code is recorded; the composed text arrives as characters | The browser does not say more |
| **program** - the paste chord on macOS | Shift+Insert: task 19 sees `$2D` | Cmd+V: task 19 sees `$56`. The pasted text is the same | No Insert key (1.3.6) |
| **program** - Option + key on macOS | No such key. Alt + key on Windows types nothing | Types the character the Mac layout gives (Option+G is `$A9`); Option+Return types nothing | Option is how a Mac keyboard types `@`, `€`, `{` on many layouts, as AltGr does on Windows |
| **program** - a key released while Command is held (macOS) | Does not occur | The key-up is delivered when Command is released, possibly later than the finger left the key | macOS sends no key-up in that case (3.6) |
| **program** - text pasted with the browser's own Paste command (its menu), not with the chord | Does not exist | Arrives as typed characters, one after the other, so a multi-line text can fill several inputs. After TRAP #15 task 24 (key commands off) nothing is pasted, as the original has no paste then | The original's "only the first line and the last character" rule belongs to its Shift+Insert handler, which the chord keeps |
| **program** - the paste chord with further modifiers held (Ctrl+Shift+Insert, Alt+Shift+Insert) | Pastes: the handler tests `Shift.Contains(ssShift)` (`simIOu.cpp:439`) | The key reaches the program; nothing is pasted. (Alt+Enter and Ctrl+Tab do act with further modifiers held, as in the original) | A browser fires its `paste` event for its own paste chord only (run: none for Ctrl+Shift+Insert or Alt+Shift+Insert in Chromium and WebKit), and reading the clipboard another way would put the browser's permission question into a program's input |
| **program** - mouse: the left button released outside the browser window after the browser lost the capture | Windows reports the release | The release is reported at the next mouse move over the surface | The browser reports nothing earlier |
| **program** - coming back to the browser window from another application while the panel has the keyboard | The I/O window's key table is cleared only when the simulator's own windows change places (`FormActivate`); keys held while another application was in front stay as they were | The panel loses and regains the focus with the browser window, so the key table is cleared on the way back (`ioActivated`) | A page cannot tell the two cases apart; a key that went up while the browser was not looking would otherwise stay down for task 19 |
| Touch | The I/O window has no touch handling; Windows turns touches into mouse messages | Whatever mouse events the browser makes of a touch (a tap is a click); no touch gestures of the port's own | trap15-b §8.1 item 7 |
| Full screen | The display mode changes to the surface size; the window covers the monitor | The page (browser) or the window (desktop app) goes full screen; the surface is centred at the largest whole-number scale, black around it; dialogs and message boxes appear above it | 2.5 |
| Full screen and the mode switch | Editor and simulator are separate programs | Leaving Simulator mode leaves full screen | The full-screen panel belongs to the simulator's workspace |
| A program asks for full screen right after the user's Run | Enters at once | Enters at once while the browser still counts the user's key or click as a gesture (a few seconds); later it shows `Press any key or click to enter full screen` | A browser gives full screen only inside a user gesture (1.4 note 36) |
| `View > Output Window` in full screen | Leaves full screen | Leaves full screen and gives the panel the keyboard | 1.3.4 |
| Zoom at a display scale of 125 % or 150 % | The window is not scaled | `100%` and `200%` are whole numbers of CSS pixels, which are not whole numbers of screen pixels there: pixel columns of unequal width | 2.5 asks for whole-number scales; the pixels a program draws and reads back are not affected |
| Focus mark | The window's title bar shows that it is active | An outline around the surface area while the program has the keyboard; the header strip says `Output`, the size and the zoom | 2.5, 2.11 |
| Scrolling a picture that does not fit the panel (a zoom of 200 %, a small panel) | No zoom and no panel: the I/O window is a window of its own | The area scrolls with its scroll bars, and it is a Tab stop (`Output picture`) whose arrow and page keys scroll it; keys pressed there reach no program | 2.11 (keyboard access; axe `scrollable-region-focusable`, errata SH4.md entry 25) |

### Differences introduced by SH7 (Hardware panel)

(`docs/differences/SH7.md`)

Deliberate differences from the original's "EASy68K Hardware" window. None of them changes what a
68000 program can observe (section 0, rule 1): every memory side effect of hardware §2.4 and §2.5,
every interrupt request and every engine control goes to the engine unchanged. DOC1 merges this
file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why |
|---|---|---|---|
| Window | A separate fixed-size window (`EASy68K Hardware`), position saved in `sim68K.dat` | A tool panel (tab under the Output panel); no position | The port's window structure (2.1-2.3) |
| Display refresh | Segments and LEDs are recoloured only by the triggers of hardware §2.7; after a file open they stay all lit even if the S-records wrote device bytes, until the next trigger | The panel re-reads the displayed bytes once per display frame, so it also shows bytes written by a load, the Memory panel's Copy / Fill / pokes and task file reads | hardware §2.7 allows refreshing more often; not observable by a program |
| Group boxes | Maroon group boxes with white bold captions; grey Memory Map box | Themed group frames (both themes); captions verbatim (` Interrupt `, `Auto Interval`, `Reset`, `Memory Map`) | Contrast rules of 2.8; the device pictures keep their fixed colours |
| Switch, push-button, IRQ and Reset pictures | Bitmaps `toggleswitch.bmp`, `pushbutton3.bmp`, `pushbutton2glyphs.bmp` | Drawn by the port after them (2.6); a held push button is drawn sunken (the original has no pressed image) | 2.6; feedback for the held state |
| IRQ and Reset buttons and the focus | Speed buttons: cannot take the focus, not in the tab order | Ordinary buttons that can take the focus (keyboard access); leaving an address field for one of them does not count as leaving it (no commit), as in the original | Accessibility (2.11); the commit rule of hardware §2.4 is kept |
| Address fields: refused key | `addrKeyPress` beeps on a key that is not a hex digit | The key is refused silently | No system beep in a browser; a GUI defect at most |
| Level list of the Auto Interval group | An editable combo box: text can be typed, leaving no item selected (V10) | A list with the items `1`..`7` and the empty eighth item; nothing can be typed | Typing into it only reaches the "no item selected" state, in which the original's handlers do nothing - the same as the empty item |
| Push buttons and lost input | A key or mouse release that never arrives leaves the bit at 0 (hardware §9.2 item 8, unverified) | Pointer cancel, lost pointer capture, the window losing the focus and the page being hidden release every held button | 3.3.3 |
| Push buttons, mouse buttons | Any mouse button presses | Any mouse button presses; the context menu is suppressed on the buttons | Same behaviour; the browser's menu would end the press |
| Address-conflict colours | Red text | Red text (`--c-danger`) plus `aria-invalid` and a tool-tip | Accessibility |

### Differences introduced by SH8 (run controller and session)

(`docs/differences/SH8.md`)

Deliberate differences from the original that the run controller and the simulator session
introduce or carry out. The first table is what a 68000 program can observe; every row there is a
decision of `docs/ARCHITECTURE.md`, implemented here. The second table is interface only. DOC1
merges this file into `docs/DIFFERENCES.md`.

#### What a program can observe

| Where | Original | Port | Why |
|---|---|---|---|
| Execution speed | One instruction, then the Windows message queue twice: an estimated 0.3 to 3 million instructions per second, different on every PC | Governed by instruction count: `EASy68K-like` = 1,000,000 instructions per second on every computer; `Maximum`; or a custom rate (`Options > Execution Speed...`). The cycle counter is not affected | 4.5.6, O-1. A delay loop takes the same time everywhere; programs that must keep time use task 23 or task 8 |
| TRAP #15 task 23, one unit | One `Sleep(10)`: 10 to 15.6 ms depending on the machine's timer | Exactly 10 ms of real time; 100 units are one second whatever the frame rate. A modal dialog or message box that is open stops the delay for as long as it is open, as in the original | 4.4.2, O-8 |
| When keys, mouse events and interrupt requests reach the program | After every single instruction | Between sub-slices: at most 2000 instructions, that is 2 ms of program time, later. While the program executes, two input edges (a key press and its release, two clicks) that arrive together reach it one sub-slice of executed instructions apart (2000 at the default speed, 2 ms of program time at any speed), so a program that polls sees each state as it does in the original | 4.2, 4.3 |
| Auto-interrupt timers and the auto-trace timer | Windows timers: 15.6 ms resolution, intervals below 10 ms count as 10 ms, no catch-up | The same rules; resolution one display frame (16.7 ms at 60 Hz) | 4.5.3 |
| A page that is hidden or gets no display frames for a while | Does not exist | The program runs slower: time without frames is made up only up to 50 ms. Delays, time of day and timers stay correct, only coarser | 4.5.5, R-12 |
| `Execute` in the editor | Starts another SIM68K process | Restarts this window's simulator from process-start state (new engine, every host part reset, saved settings applied), then loads the file. Nothing of the program before is left | 4.7.1, note 20 |
| The simulator engine fails internally (a WebAssembly trap) | The original's own internal faults show `ERROR: An exception occurred in routine 'exec_inst'.` and stop the program | The same box, then the simulator restarts from start-up state and the message area reads `The simulator was restarted after an internal error. Load the program again.` | 4.8: a new engine next to host parts in their old state would be inconsistent |
| The bell character `$07` | `Beep()`: the system's default sound | A tone of 800 Hz, 150 ms, through the audio backend | A page has no system sound |

#### Interface only

| Where | Original | Port | Why |
|---|---|---|---|
| Run To Cursor on a row without an address, or with no row selected | Shows `Selected line does not have a valid address.` or `Invalid Run-To-Cursor Selection`, then runs the program anyway | Shows the same box and does not run | note 23 |
| Pause during Auto Trace | Run, Step and Trace stay disabled until a second Pause or Rewind | The commands are enabled at once | note 24 |
| `File > Open` and `Reload Program` after a halt and while a program runs | Open is disabled after a halt until Pause or Rewind | Both stay enabled. Open while a program is running, and Execute while one is running or waiting, ask `The current debug environment will be lost, click OK to continue.` first | notes 20 and 22, O-16 |
| `/e` and `/b` on the command line | Take effect at once, are written to `sim68K.dat` at exit | Take effect at once and are stored at once | The port stores every settings change when it is made |
| Switches when the first argument is not an `.S68` file that exists | SIM68K ignores the argument and processes the switches; its window is the simulator | The switches are processed the same way, but the file decides what the window shows: another existing file opens in Editor mode, otherwise a new document. `/r` with nothing loaded halts at once as in the original; `/f` shows only once the simulator is in front | 5.7: one command line stands for the editor and the simulator |
| `File > Exit` in a browser | Ends the program | Runs the close prompts of the documents, stops the program and the log, writes the program's files out and shows `You can close this tab.` | note 4 |
| Status bar | Two panels, always empty | Run state, PC, speed setting, exceptions and bit field (`Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off`) | note 34 |
| The engine files cannot be loaded | Cannot happen | The simulator message area shows `The simulator engine could not be loaded: ...`; the simulator's commands do nothing until a later cold start succeeds | The engine is a separate file in the port |

### Differences from the original: U1 (Registers, Listing, Messages)

(`docs/differences/U1.md`)

Deliberate differences of the Registers, Listing and Messages panels and the simulator's Find
dialog (`app/src/features/sim-main`, `app/src/core/listing`). None of them changes what a program
can observe. Section 1.4 of ARCHITECTURE.md already lists the changed-register colouring (note 31),
the 64-bit cycle counter (note 32), ordinary horizontal scrolling (note 33), the PC marker in the
gutter (1.3.5) and `Esc` closing dialogs (1.5); they are not repeated here.

| # | Original | Port | Why |
|---|---|---|---|
| 1 | A left click in the gutter below the last listing row raises an exception, reported as the box `Invalid Breakpoint Selection` (sim-ui §6.5). | Nothing happens. | A GUI defect (an unhandled index error); it cannot change a program's results (section 0, rule 1). |
| 2 | `highlight()` and `find()` treat the row just below the visible rows as "on screen" (`ItemIndex > TopIndex + Height/ItemHeight`), so a selection there stays hidden. | A selection that is not fully visible is scrolled to the third visible row. | Off-by-one GUI defect. `features/sim-main/selection.ts`, `thirdRowScroll`. |
| 3 | The list box has only the standard list-box keys; setting the PC from a row and toggling a breakpoint need the mouse. | Added keys while the listing has the focus: `Enter` does what a double-click does (an instruction row's address into the PC field), `Space` toggles the PC breakpoint of the selected row (same rules as a gutter click), `Shift+F10` and the Menu key open the gutter menu `Clear All PC Breakpoints`. Arrow keys, Page Up/Down, Home and End move the selection as in a list box. | Keyboard access (2.11). |
| 4 | A refused key in a register field calls the VCL's `Beep()` (the system's default sound). | A short quiet tone (880 Hz, 70 ms) through the window's audio backend. | A web page has no system sound. |
| 5 | The Find dialog appears centred over the main window (`poMainFormCenter`) and has no close button in its title bar. | It floats over the right part of the listing and has the kit's close button. | The port's modeless dialogs float at a fixed anchor (2.7); the close button is the kit's for every dialog. |
| 6 | The message area is a `TMemo`: its whole text can be selected and copied with the keyboard. | The Messages panel renders only the visible lines (a trace can add hundreds of thousands); the lines on screen can be selected with the mouse and copied. | Size of the message list. The texts are the original's. |
| 7 | During an Auto Trace with `Disable display update` checked, a step that halts or hits a breakpoint stops the timer but still skips `highlight()` (`autoTraceInProgress` is set for the whole tick), so the listing does not move at that stop. | At that one stop the listing selects the PC row. Every other step of such an Auto Trace leaves the listing alone, as in the original. | The engine reports `autoTraceInProgress` only inside the tick; afterwards the port can only see that the timer is off (`SimMainModel.highlightRan`, errata U1.md entry 1). Nothing a program can observe changes; only the selected row at that stop (which Run To Cursor uses) can differ from the row the user had clicked during the Auto Trace. |

### Differences from the original introduced by U2 (Memory and Stack panels)

(`docs/differences/U2.md`)

None of these changes what a program computes, writes or reads. Memory edits, Copy and Fill write
the same bytes as the original's Memory window.

- **Live update also works at address 0.** The original's test `loc >= memAddr-3` wraps when the top
  row is address 0, so nothing is updated there (sim-ui §10.4). The port repaints every visible row
  that changed, once per display frame, wherever the view is (parity matrix 1.3.7, ~38).
- **Copy with an end address beyond 2^32.** When `From < To` and `From + Bytes - 1` or
  `To + Bytes - 1` exceeds $FFFFFFFF, the original's unsigned arithmetic wraps and the copy runs
  outside its memory array (a crash). The port shows `Invalid copy range` and copies nothing.
- **The `$7F` cell** of the ASCII column is drawn as `□`. The original draws the character `$7F`,
  for which Courier New has no glyph (Windows draws a box); a browser would draw nothing and shift
  the column.
- **The Memory cursor** is shown while the rows have the keyboard focus; the original's frame keeps
  blinking after the window has lost the focus. With reduced motion it does not blink (2.11).
- **No beeps** for refused keys and before `Invalid memory range.` (no system sound in a browser).
- **The overwrite question** of Save (`File exists! OK to replace?`, title `Alert`) is asked by the file
  dialog after the name is chosen; a native macOS dialog asks its own question instead.
- **Keys added for keyboard users**: Up and Down on the Stack rows move the view one row, as its spin
  button does. Clicking or tabbing into the Memory rows puts the cursor on the first byte if none was
  placed yet.
- **The Address field** is the first control of the top strip, with the column header on its own line
  aligned with the rows (ARCHITECTURE.md 2.3 sketch); the original places it above the address
  column.

### Differences introduced by H1 (help, examples, About)

(`docs/differences/H1.md`)

Deliberate differences from the original that this package introduces, beyond those section 1.4 of
`docs/ARCHITECTURE.md` already lists (notes 10 and 11). None changes what a 68000 program can
observe (section 0, rule 1). DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where                                               | Original                                                                     | Port                                                                                                                                                                                                                                                                                      | Why                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| The help pages                                      | Compiled help (`help.chm`) in the viewer of Windows                          | The same pages (HTML), converted to UTF-8, shown in a panel at the right edge of the window (web) or a help window (desktop). File references have the letter case of the file                                                                                                            | A browser has no CHM viewer; a web server cares about letter case               |
| Help contents                                       | The viewer's contents, index and full-text search                            | The contents tree with a filter over the page titles. No index tab, no full-text search                                                                                                                                                                                                   | 2.7. The index file is imported and kept                                        |
| F1 in the Memory panel                              | Opens the assembler's MEMORY directive page                                  | Opens the memory page of the simulator help                                                                                                                                                                                                                                               | 1.4 note 10                                                                     |
| F1 in the Simulator                                 | The introduction                                                             | The simulator's basic operation page (the page of the focused panel in the Memory, Stack, Hardware and Break Points panels and the Log panel)                                                                                                                                             | 1.4 note 10                                                                     |
| Help > Differences from EASy68K, Help > Examples... | Not present                                                                  | Added at the end of each Help menu                                                                                                                                                                                                                                                        | 1.5                                                                             |
| About boxes                                         | The original's texts, a link, `Check for update?` and a hidden B-M-W picture | The same texts, plus the port's name, version, repository link and the statement that it is unofficial. The editor's `Check` asks the port's latest GitHub release and answers `Up to date`, `Update available` or `Network error`. No Easter egg. F1 in the simulator's box does nothing | 1.4 note 11                                                                     |
| The 68000 reference pages                           | Part of the help                                                             | Kept, in a folder of their own with an attribution file, so that they can be removed in one step                                                                                                                                                                                          | Decision O-5, risk R-15                                                         |
| Links to the web in help pages                      | Open in the default browser                                                  | Open in a new tab (web) or the system's browser (desktop); the Quick Reference PDF opens in a new tab. Four links of the original got `target="_blank"` for this                                                                                                                          | A sandboxed frame cannot show them                                              |
| Escape while the help page has the focus            | Not applicable                                                               | Closes the drawer from the toolbar, the tree and the filter, not from inside the page                                                                                                                                                                                                     | A browser may not run listeners in a frame without scripts (errata H1, entry 9) |
| The help pages in the dark theme                    | Not applicable                                                               | The pages keep their own (light) colours; the panel around them follows the theme                                                                                                                                                                                                         | The pages set their own colours                                                 |

### Differences from EASy68K introduced by E4 (Options dialogs and settings files)

(`docs/differences/E4.md`)

For DOC1, to merge into `docs/DIFFERENCES.md`. None of these changes what a 68000 program can
observe.

- **Cancel restores everything** in Assembler Options and Editor Options (1.4 note 8). The original
  applies Auto Indent and Real Tabs on click, lets Assemble read the Assembler Options check boxes
  directly, and keeps the Editor Options font, size and tab controls (the defaults for new files)
  after Cancel. In the port nothing in either dialog takes effect before OK. Consequence: while the
  modeless Assembler Options dialog is open with unconfirmed changes, an assembly uses the options
  last confirmed, not the boxes on screen.
- **OK changes only what was changed in the dialog**, so a setting another window changed while
  the dialog was open is kept (several windows, 3.8.6).
- **Editor Options shows the document's real font size** (1.4 note 8): an 11-point document stays
  11 points after OK (the original changes it to 10). When another font is chosen, the document's
  size is kept if that font lists it.
- **The font, size and preset boxes are lists**: the original's are editable combo boxes in which
  any text can be typed (a non-number size then fails with `Error in NewProject()`, and text typed
  into the preset box applies Disabled).
- **A colour preset always applies**: in the original, choosing a preset while Bold, Italic or
  Underline is checked turns into Custom and changes no colour.
- **Auto** is an added colour preset (1.4 note 19), the last item of Color Presets.
- **The modified flag** of the active document is not touched by Editor Options OK (the original's
  is undefined, 1.4 note 8).
- **Help and F1** in Editor Options open `options.htm` (the original opens the introduction page);
  so does F1 in Assembler Options.
- **Import/Export Settings...** (added, 1.5) reads and writes the original's `settings.dat`,
  `sim68K.dat` and `template.NEW`. Window positions are ignored on import and written as the
  original's defaults on export; the Auto preset is exported as -1 with the Color1 values.

### Differences from the original introduced by E5 (Assemble)

(`docs/differences/E5.md`)

None of these changes a byte of a `.L68` or `.S68` file: what the application writes is what the
official EASy68K v5.16.1 writes, checked through the application's own path (document service,
file collection, assembler, writing into the browser store) on 289 option runs of the tracked corpus
(`app/src/features/assemble/corpus.test.ts`: 248 byte for byte, 41 equal after masking the
statements with an undefined symbol, where the original encodes uninitialised memory).

- **The assembled document keeps its identity** (ARCHITECTURE.md 1.4 note 18). A message of an
  include file opens that file in a tab (or uses the tab it is already in) and is listed there, but
  the assembled document stays the active one: later messages of the main file stay in its own list,
  the status dialog names it, and Execute and Load L68 use its names. The original let the include
  file's window become the active one, so all three referred to the include file.
- **Execute needs this assembly's S-record** (4.9 step 9). With *Generate S-Record* off, Execute is
  disabled; the original enabled it and started the simulator on whatever `.S68` was left from an
  earlier assembly, or on none.
- **Execute starts the window's simulator afresh** and loads the S-record without running it (note
  20): Simulator mode comes to the front. If a program is running or waiting for input there, the
  `Caution` question (`The current debug environment will be lost, click OK to continue.`) comes
  first and Cancel keeps that program. The original started one more simulator process each time.
- **A cancelled Save As cancels the assembly** when *Auto Save Modified Source Before Assembling* is
  on and the document has never been saved (4.9 step 1); so does a save that fails. The original
  assembled anyway.
- **A never-saved document** is assembled in `/browser/Untitled` (desktop: `<user data>/Untitled`),
  where its `untitledN.L68` and `untitledN.S68` appear (3.8.2). The original used whatever the
  current directory was. No temporary files (`EASy68Ks.tmp`, `EASy68Km.tmp`) are created.
- **Double-click on a message row** selects the whole line, also the last line of a document without
  a final line break (the original left its last character out). A row whose line is outside the
  document (0 for the original's uncounted exception rows; one past the end for
  `END directive missing`) puts the caret at the start or at the end of the document.
- **Enter** on a selected row does what a double-click does (keyboard access, 2.11); Shift+F10 and the
  Menu key open the context menu.
- **The status dialog** is an in-window modal dialog. Escape and its title bar's close button close it
  like `&Close` (Escape is an addition, 1.5).
- **The message list** gets a `File` column only when a row belongs to an include file that could not
  be opened as a document (1.3.3).
- **An assembler that cannot run** (the engine failed to load, or the run ended abnormally) is
  reported as one row `The assembler stopped: <reason>` and nothing is written (4.9 step 5). The
  original ended the whole editor process.

### Differences introduced by E6 (Find, Replace, Print)

(`docs/differences/E6.md`)

None of these changes what a program assembles to, how it is listed, or what it does when it runs.
Details and reasons: `docs/porting/errata/E6.md`.

| Where | Original (editor-ui) | Port | Why |
|---|---|---|---|
| Find without a selection | starts at the top of the document | starts at the caret; after `End of document reached.` the next search still starts at the top | note 7 |
| Replace with a selection that is not a match | replaces the selection | finds the next match from the selection's start and replaces that | note 7 |
| Replace with an empty replacement | selects one character after the deletion, so a match starting there is skipped | the caret stays at the deletion point; no match is skipped | note 7 |
| Replace All | one undo record per change (the original's own stacks) | one undo step | note 5 |
| Find / Replace dialogs, closing | only `Cancel`; no title-bar buttons; Esc does nothing | also Esc and the title-bar close button | the kit's modeless Dialog (2.7) |
| Find / Replace dialogs, place | centred on the frame, always on top | at the top right of the editor area; the second one under the first; not drawn while another mode is shown | 1.3.3, 2.7 |
| Print, range | All / Selection in the Windows print dialog | asked in a small `Print` dialog before the system print dialog, only while the document has a selection | note 2 |
| Print, page | lines per page from the printer's page height, x = 20 device units, no header | the browser fills pages; 12 mm page margin; the browser may add its own header and footer (switchable in its dialog) | note 2 |
| Printer Setup... | the Windows printer set-up dialog | the system print dialog, with the active document (or an empty page) | note 2 |

### Differences from the original introduced by FS2

(`docs/differences/FS2.md`)

All but the last of these concern how the editor saves files of the student's computer in a
Chromium browser and cannot change what a 68000 program observes. The last one can.

- **A file changed by another program is not overwritten unasked.** The original writes the file
  on Save whatever happened to it meanwhile. The port asks first (3.8.6 rule 3, owned by E1), and
  for a linked single file whose real file it could not look at since a reload, it refuses the Save
  with a message and leaves the other program's version in place (docs/porting/errata/FS2.md,
  entry 2). Save As still saves.
- **Linked single files keep their outputs in the browser.** A file opened with `From this
  computer...` is saved back to its place, but the `.L68`, the `.S68` and the files a program
  writes go to a folder of the browser (3.8.2) until the student opens the file's folder with
  `Open the containing folder...`. The original writes them beside the source.
- **One folder of the computer at a time** (errata FS2.md, entry 7). The original reaches the whole
  disk.
- **A read-only file in an opened folder looks writable to a program.** The File System Access API
  cannot tell whether a file has the read-only attribute, so every file of `/folder` reports
  `readOnly: false` (errata FS2.md, entry 4). In the original, TRAP #15 task 51 (open) and task 59
  (file information) give `D0.W = 3` for a read-only file, and a write to it gives 2
  (trap15-tasks-0-59.md). In the port, on `/folder`, both give 0, and the write is refused only
  when the data reaches the disk, which the editor reports as a file that could not be saved. (My
  Programs, `/browser`, has no read-only files at all, so the question arises only for a real
  folder.) Asking the browser for a writable stream at `stat` time would not tell either: Chromium
  writes into a swap file first and fails only when it replaces the file.

### Differences introduced by SH2 (ellipses and wide pens)

(`docs/differences/SH2.md`)

The surface draws ellipses and lines of pens 2 or more pixels wide by GDI's own rules, measured on
Windows 11 (`docs/porting/gdi-deviations.md` section 3): every one-pixel ellipse T2 and SH2 captured
(8,192 small and 3,000 large boxes), every wide line and every pen dot are Windows' pixel for pixel.
What still differs is listed here, with the figures of `docs/porting/gdi-deviations.md`, the
regression baseline. DOC1 merges this file into `docs/DIFFERENCES.md`.

| Where | Original | Port | Why | Can a program observe it? |
|---|---|---|---|---|
| Ellipses (tasks 88 and 91) drawn with a pen 2 to 8 pixels wide (trap15-b V11) | GDI's widened shape | Windows' pixels in 496 of the 500 boxes of SH2's suite `ellipses-wide`; in the other four 1 to 3 pixels more: `ellipses-wide-00125` (3 pixels), `-00158` (3), `-00195` (2: pen 3, box 3 x 75, the pixels one above the top centre and one below the bottom centre), `-00428` (1). They are filled ellipses in Copy mode whose box has an odd side of 3 to 11 pixels, and the extra pixels lie at a narrow end, where GDI's join between two very short segments is not modelled exactly. Further families measured by SH2's verifications (very small boxes, pens wider than a narrow box, mid-size pens) differ in a few cases by 1 to 16 pixels | GDI's choice of the join there was not found (`docs/porting/gdi-deviations.md` section 2); ARCHITECTURE.md 6.5.2 reports these figures and sets no threshold for them in version 1 | Yes, through task 83 on those few pixels |

### Differences from the original introduced by SH5 (sound)

(`docs/differences/SH5.md`)

What a 68000 program observes through TRAP #15 tasks 70-77 is the original's (trap15-b §11 and §13):
every D0 result, the cases in which D0 is not written, the standard player's busy flag, `currentWave`,
the sticky looping of a DirectX slot and what a reset keeps. The differences below are in what is
heard, or in cases the original leaves undefined.

- **The standard player's busy time comes from the WAV header.** The original asks Windows whether a
  sound is still playing; the port computes `start + duration` from the file's `fmt ` and `data`
  chunks (`parseWav`), so a program's wait loop ends on time even when the browser plays nothing
  (audio locked before the first click, a suspended context, a sound that cannot be decoded).
  Windows' own buffering makes its busy time a little longer than the sound; the port's is the
  sound's exact length.
- **A file that exists but is not a WAVE file** counts as a sound of length 0 for tasks 70 and 72/76:
  `D0.W = 1` and the player is free at once (on Windows `PlaySound` may play the default system sound
  instead; trap15-b V14, unverified). Nothing is heard.
- **The DirectX player (tasks 73, 74, 75, 77) accepts RIFF WAVE files only.** MIDI and DirectMusic
  segment files, which DirectMusic also loads, give `'<name>' Error loading ` and `D0.W = 0`
  (ARCHITECTURE.md 3.7). A WAVE file whose codec the browser cannot decode loads (`D0.W = 1`) and is
  silent.
- **One decoded sound per DirectX slot.** DirectMusic's loader cache may make two slots loaded from
  one file the same object, and may keep a slot's looping across a reload and a reset (trap15-b §11.4,
  V6, unverified). The port keeps each slot separate; looping stays set for a slot until the slot is
  loaded again or the simulator is reset, the recommended port behaviour.
- **Task 74 over a slot whose sound plays.** The original releases the old segment without stopping
  it; the port lets the old sound play on too, and stops a sound left looping that way at the next
  simulator reset (in the original it is unspecified whether it ever stops).
- **Task 73 sounds stop at a cold start** (a new simulator), because the original's process has
  ended by then; a reset (Rewind, opening a program) does not stop them, as in the original.
- **A sound that had to wait is heard in step with the program.** A sound asked for while audio is
  locked or suspended starts, once audio runs, where it would be by then; a sound whose time is over
  by then is not played at all, and a loop joins at the right place. Uncompressed WAVE files (every
  official sound) never wait for a decoder; a compressed one (ADPCM, mu-law ...) may wait for the
  browser's decoder, and a wait of less than 0.2 s starts it from its beginning. If the standard
  player's next sound starts while such a late sound still plays, the late one is cut off at that
  moment: the original's one voice never sounds two sounds at once.
- **At most 64 sounds at once.** A program that starts more overlapping sounds than that (task 75 in a
  tight loop) is not heard beyond the 64th; the results in D0 are unchanged.
- **Unlocking.** Browsers start audio only after the person has clicked or pressed a key: every run
  command, every key in the Output panel and any click or key in the window once a sound is waiting
  unlocks it. Until then programs run as usual and are silent.

### Differences introduced by SH6 (program files, file dialog, printer)

(`docs/differences/SH6.md`)

Deliberate differences from the original. DOC1 merges this file into `docs/DIFFERENCES.md`. The
stream model itself (buffered writes and reads, streams a reset forgets, remove refused while a file
is open, bytes written at the process's exit) follows the original; see ARCHITECTURE.md 3.8.4 and the
measurements of docs/porting/errata/T3.md F2.

| Where | Original | Port | Why |
|---|---|---|---|
| Files a program can reach, browser store and opened folder | Any path on the disk | The folders the program has been given (its own folder, the Open Data folder, a task 58 folder) and their sub-folders, four levels deep; files beyond the limits of 3.8.4 are named once in the message area (`Not available to the program: ...`) and cannot be used | A browser has no synchronous file access: the folder is held in memory (docs/porting/errata/SH6.md entries 1, 2) |
| Path a task 58 dialog returns | `C:\...\data.txt` | `/browser/demo/data.txt` in a browser; the real path in the desktop app | 3.8.4; the program uses it as a name, which works |
| Task 58 Open dialog | The program's name (with any folder part) is in the File name field | The dialog starts in the folder of that name and the field shows the file name only (the request carries it since gate I2; the field stays empty until FS1's dialog reads `OpenRequest.initialName`, still not read at gate I2 round 2) | The port's dialog lists one folder at a time (errata Contract C1) |
| Task 58 Save dialog without a name | Starts in the process's current directory | Starts in the folder the last dialog ended in, until FS1's dialog reads `SaveRequest.startDir` (task 58 sends the program's current directory there since gate I2) | Errata Contract C1 |
| Closing the tab while a program has unwritten bytes | Not possible: the bytes are written when the simulator exits | The browser asks "Leave site?"; if the tab closes anyway, the bytes are written or kept in the browser and written at the next start | 3.8.4 |
| Page put into the back-forward cache | - | The pending bytes are written to the file, the files stay open | The page may come back (errata entry 7) |
| `NUL` behind a folder or a drive that does not exist (`nofolder\NUL`, `Q:NUL`) | The open fails (`D0.W = 2`), measured on Windows 11 and under Wine (errata SH6.md entry 17) | The null device: the open succeeds, a read is at end of file | The port's file views cannot say whether a folder exists without a file in it (`SyncFiles` has no such question); every other way of naming `NUL` behaves as on Windows (errata SH6.md entry 14) |
| `CON`, `PRN`, `AUX`, `COM1`-`COM9`, `LPT1`-`LPT9`, `CONIN$`, `CONOUT$` as the whole name | Windows devices: on a PC that has such a port the program opens it (`AUX` and `COMn` reach a serial port, `PRN` and `LPTn` a parallel port); without one, and for `CON` in the simulator (it has no console), the open fails | The open always fails (`D0.W = 2`, task 59 gives 2, task 57 fails), and no file of that name is created or removed | No ports to reach through a file name; what a student sees is what a PC without the port shows (the official program under Wine fails the same way; a70 leaves these names out, because a PC with the port answers otherwise). With a folder or an extension (`sub\COM1`, `COM1.txt`) these are ordinary files, as on Windows 11 |
| `NUL.txt`, `CON.txt` (a device name with an extension) | Microsoft's naming documentation says these are the device, and older Windows treat them so; Windows 11 10.0.26300 opens an ordinary file (measured); the official program under Wine opens the device, so it differs from Windows 11 here and a70 leaves these names out (errata SH6.md entry 17) | An ordinary file | The port follows Windows 11, the reference machine (errata SH6.md entry 14) |
| Printing (task 10) | Each form feed sends a page to the Windows printer at once | Each form feed adds a job to the `Printer Output` dialog, which opens by itself; `Print...` opens the system print dialog. `File > Printer Setup...` opens the same dialog | 1.4 note 2: a page cannot print without the print dialog |
| Printer page | The real printer's page and the Printer Font measured on it | A letter page at 600 dpi, cell from the Printer Font size (3.8.4) | No printer to ask in a browser |
| Printer Font changed in the middle of a page | The next character makes the printer library fail ("Printing in progress"), which the simulator reports as `ERROR: An exception occurred in routine 'exec_inst'.` and switches to trace mode | The open job is ended as it stands and a new one starts | A defect of the original caused by the user's action; recorded so it can be reverted if it must be reproduced |

#### The stream's buffer memory (gate I3, stdio work; engine/sim/shim/STDIO-MODEL.md)

Since gate I3 the engine has the file streams of the Borland run-time linked into SIM68K.exe, so
the sequences C leaves undefined - a read right after a write, a write right after a read, without
a seek between them - give the official results (trap15-a `a51`, `a52`, `a53`, and `a61`-`a69`).
Two things remain different, both reached only through those undefined sequences. All of it was
measured in the official program under Wine (STDIO-MODEL.md sections 7 and 9).

**Heap residue.** A stream's 512-byte buffer comes from the original's heap. A read right after a
write takes its bytes from the buffer behind the written ones (in `a51` the 4 bytes after
`ABCDE`), a read in the read state after a write there can run past the bytes that came from the
file, and a flush after a read in the write state writes such bytes into the file. Those bytes are
whatever the heap held: remains of what the simulator loaded before (text of the listing such as
`00001000 Starting Address`, Windows help strings such as `Primary screen = 1`), the heap's own
bookkeeping (pointers and sizes in bytes 0-7 of a buffer that an earlier stream freed, e.g. `3A 02`
in bytes 2-3, a small number in byte 5), and heap pointers past the end of the buffer. They are the
same in every run of one program but differ between programs, and depend on more than the program
did. In `a51` they are `0A 00 00 44`. The port does what is measured about which block a stream gets
(the lowest freed one, with its old bytes from the ninth on) and gives zeros for everything that
depends on the heap's history: `00 00 00 00` in `a51`. What a student sees: in the original, a few
bytes the program never wrote - in its memory after such a read, and in the file after such a flush
(a file that ends in, say, `27 00` after a program wrote `ABCDE`, read 2 and wrote 4 without a
seek); in the port, zero bytes in the same places, the file of the same length.

**A write past the end of the buffer.** A write right after a read that had left the buffer nearly
empty (fewer free bytes than the write's length) is copied past the end of the buffer over the
next heap block. In the original, 1 to 3 bytes past the end were harmless in every run; 4 bytes
were harmless in most layouts, but in the reviewer's program q02 under the file name
`q02-end-of-buffer.X68` the simulator process ended at once (the same program under another name
completed); 5 or more bytes made the next open, close or task 59 end in the box `ERROR: An exception
occurred in routine 'exec_inst'.` in most layouts, but 8 zero bytes in one layout were harmless.
So the outcome depends on the bytes and on the heap's layout, which even the program file's name
changes. The port's choice: up to 4 bytes are harmless; from 5 bytes on the next and every later
open or close of a file (and task 59) shows that box, which is what the original did after the
first box in every probe (e4: OK and Run, then each later open showed the box again, D0.W = 2,
D1 = -1). A student who writes past a stream's buffer therefore sees the box in the port where
the original showed it in most measured cases, sees nothing where the original ended (q02's 4
bytes), and sees the box where the original's heap happened to accept the bytes (x3's zeros).

**A log started with a nearly full stream table.** While a log runs, its files are streams of the
same table as the program's files (STDIO-MODEL.md section 8; this the port reproduces). When a log
starts and the table has no free entry for one of its files, the original does not open that file:
measured (probe e6: 46 streams whose close failed, then Log Start with both logs selected), the
execution log was created, the box `Error` / `Can't open log file, error 0` appeared, the output
log was not written, and the log stayed marked as running. In the port the log service opens and
writes both logs; no box appears. A student meets this only after more than 44 opened files whose
close failed in one session. Read in the code, not measured: the original's Log Stop closes the
execution log's file pointer even when only an output log was started, so a pointer left from an
earlier execution log could close a program's stream that has since taken its entry; the port
has no such pointer.

Two smaller differences: if a stream that has been read in the write state is left open while a
task 58 dialog moves the current folder, the bytes the host writes for it at the end of the program
can be more than the original's flush would write (STDIO-MODEL.md section 10); and a copy of a read
in the write state whose count wrapped the bounds test of task 53 ends in the `exec_inst` error box
in both (probe p13), but the port copies nothing first, while the original copies heap memory into
the 68000 memory until its access violation (how far is not measured).

### Differences from the original: U3 (Advanced breakpoints)

(`docs/differences/U3.md`)

Deliberate differences of the Break Points panel (`app/src/features/breakpoints`,
`app/src/core/breakpoints`) from the original's `EASy68K Advanced Break Points` window
(`BREAKPOINTSu.*`). None of them changes what a program can observe: the engine evaluates the
conditions and expressions exactly as the original (count 0, A7 = user stack pointer, last-read and
last-write matching, the read side effect, the parenthesis conversion of sim-core §7.3), and the
port fills its slots with the values the original's Set buttons would store. They only change
where the debugger stops in cases where the original's window corrupted its own tables. Note 40 of
ARCHITECTURE.md decides them.

| # | Original | Port | Why |
|---|---|---|---|
| 1 | `Count` is read as hexadecimal (`StrToInt("0x" + text)`): `10` means 16. | Read as decimal: `10` means 10. | 10.2 O-10 (accepted default), note 40. |
| 2 | `Clear` on a Memory row copies register slots into the memory slots that follow the deleted row (`breakPoints[curRow - 1 + ADDR_ID_OFFSET] = breakPoints[curRow]`), and the Expression `Clear` mixes the clicked row and the last edited row. | `Clear` removes exactly the selected row's slot and moves the following slots up with the rows. | Note 40 (slot mix-ups on Clear). |
| 3 | Editing an existing Memory row pre-selects Op, Size and R/W from a register slot, so `Set` can silently change them. | The editors start from the row's own values. | Note 40 (slot mix-ups on edit). |
| 4 | Deleting a condition renumbers the rows, but the expressions keep their old slot numbers and now test other conditions. | The expressions are renumbered with the rows; an expression that used the deleted condition is removed with it after the question `Expression n uses this condition and is removed with it.` (OK / Cancel, title `Break Points`). `Clear All` of a condition grid asks the same for every expression that used one of its conditions (`... these conditions and is/are removed with them.`). An expression being edited is renumbered too, or discarded if it used the deleted condition. | Note 40 (stale indexes). The question and its text are the port's; the original has none. |
| 5 | `Backspace` removes five characters of the Expression text; after an `An` token (four characters) it also eats a character of the token before. | `Backspace` removes the last token and exactly its text (the text is always derived from the tokens). | Note 40 (five-character Backspace). |
| 6 | A `PC/Reg` or `Memory` click with an undefined number shows its message but still marks "operand entered", so `AND` / `OR` become enabled although nothing was appended (sim-ui Q21). | The message appears and nothing changes. | Same family of editor defects (sim-ui Q21); the button grammar is derived from the tokens. |
| 7 | Rows and columns of the Registers and Memory grids can be dragged; only the displayed text moves. | Rows and columns cannot be dragged. | Note 40 (draggable rows). |
| 8 | The combo boxes are editable; typed text that matches no entry stores index -1 (undefined behaviour). | The lists are drop-down lists; only their entries can be chosen. | Note 40 (editable lists). |
| 9 | An expression's hit counter is `bpCountCond[id]` with the `id` given when the row was set; after a `Clear` the rows below keep their old ids, so two expressions can share a counter. | An expression's id is always its current row number. | Same family (slot mix-up); the counters still reset only on Run. |
| 10 | A single click on a row of the Registers or Memory grid beyond the defined rows makes the last defined row the one `Clear` removes (`reg_edit_row` is clamped). | `Clear` acts on the selected row; on a row that is not defined it shows `Select a Valid Row.`, as sim-ui §12.2 describes. The builder field still takes the clamped number, as in the original. | Same family (stale index): the row `Clear` removes is the one the user sees selected. |
| 11 | A fixed-size window `EASy68K Advanced Break Points`; F1 opens its help page, Ctrl+Tab goes to the main window. | A tool panel `Break Points` (2.6) with the same three groups; F1 in it opens `AdvBreakpoints.htm` (H1), Ctrl+Tab and F2 move between panels (shell). | Panels instead of windows (2.1). |
| 12 | The editors appear over the row only after a double-click. | Also Enter on a row; Enter in an editor presses `Set`, Escape hides the editors without storing. | Keyboard access (2.11). |
| 13 | After `Backspace` removes an operator (`( R1 AND` becomes `( R1`), the flag `mruOperator` stays set: `AND` / `OR` stay disabled and `PC/Reg` / `Memory` stay enabled, so a second operand can be appended directly after `R1`. | The buttons are derived from the remaining tokens (sim-ui §12.2's grammar): after `( R1`, `AND`, `OR` and `)` are enabled and the operands are not. | Same family as entry 5 (Backspace, note 40); the original's stale flag lets the user build an expression its own conversion cannot read. |

### Differences introduced by U4 (logging and simulator options)

(`docs/differences/U4.md`)

Deliberate differences from the original in the execution log, the output log and the simulator's
Options menu. The first table is what ends up in the log files (which students hand in); every row
there is a decision of `docs/ARCHITECTURE.md`, implemented here. The second table is interface
only. DOC1 merges this file into `docs/DIFFERENCES.md`.

#### What ends up in the log files

| Where | Original | Port | Why |
|---|---|---|---|
| Log Start, then `Cancel` in `Log File Options`, or a file that cannot be opened | Logging is switched on anyway and writes through a closed or null file (undefined) | Logging stays off; nothing is written to either file. Cancel on the output log's question also leaves the execution log untouched (the original had already opened it and written its header) | note 41 |
| When the bytes reach the file | `fflush` after every entry and every character | Kept in memory and appended about once per second and at every stop (Pause, a breakpoint, a halt, the end of a trace step), at Log Stop and when the simulator ends. The files end with the same bytes; while a program runs they can be up to a second (or twenty times the last flush's duration) behind | 3.3.5, 5.5 |
| A listing row that contains `%` | The row is used as a `printf` format: undefined output | The row is written literally | note 42, sim-ui Q23 |
| The date in the headers | The Windows user's regional format | Always the US form `M/D/YYYY h:mm:ss AM`, the date alone at midnight | 5.3 |

Everything else - headers, records, register and memory blocks, the Rewind and Reload notes with
the stale-snapshot rule, LF versus CR LF, the automatic stops with `Current Log Stopped.` - is the
original's. The nine execution logs and two output logs the official SIM68K.exe wrote under Wine
are reproduced byte for byte (header date aside).

#### Interface only

| Where | Original | Port | Why |
|---|---|---|---|
| OK in Log Output while logging | Enables Log Start; a second Log Start reopens the files | Log Start stays disabled until logging stops | sim-ui §13.6 |
| Log Start while the Log Output dialog is open | The dialog is hidden and keeps unconfirmed changes for next time | The dialog closes and unconfirmed changes are dropped | 3.12.4: a dialog is closed, not hidden |
| `Log File Options` | The message only | The message and, below it, the file's path | The question is easier to answer |
| Log panel | Does not exist | The two names, the state and the last 200 lines of each file written since Log Start | 1.5 |
| File names | Windows paths | Paths of the port (`/browser/...`); a name without a folder is taken relative to the program's folder | 3.8 |
| Font dialogs | The Windows font dialog with every installed font | The port's own dialog. Output and Source Window Font: Fixedsys, Courier, Courier New, Lucida Console, Consolas, sizes 8 to 18; Printer Font: any name and size. Only the Output Window Font has style, effects and colour | note 27 |
| Auto Trace Options, `Cancel` | Keeps a changed `Disable display update`; the saved interval is not applied until OK | Cancel changes nothing; the saved interval is in force from the start | note 28 |
| Fullscreen Options | Screen 1 to the number of monitors | Screen 1 only | note 29 |

### Differences recorded by T1 (assembler conformance)

(`docs/differences/T1.md`)

What the comparison of the port's assembler with the official `EDIT68K.exe` v5.16.1 found
(ARCHITECTURE.md 6.9 item 1). The official program runs under Wine in Docker
(`tests/oracle/wine`); its outputs are the goldens in `tests/conformance/asm/golden/` (hashes
only for the `site` set, which may not be redistributed); `npm run test:conformance` compares
every run with the port. For every file of the `official`, `github-mit`, `conformance` and `site`
sets with default options, and for the 30 files of `tests/corpus/option-subset.json` with each of
the eight assembler options switched alone, the `.S68` is byte-identical and the `.L68` is
byte-identical (the `Created On:` line included wherever the official listing is in the
repository), with the exceptions below. Each exception is a run of the manifest
`tests/corpus/manifest.json`; the three differences are listed with what the port produces in
`tests/conformance/asm/known-differences.json`, and the runs without an official result in
`tests/conformance/asm/golden/REPORT.md`.

#### Differences in what the port produces

##### A conditional block whose condition is a forward reference (`checklist/dir-11-set-and-macro-lines-reached-only-in-pass-2-forwa`)

- Source: `IFNE FWD` / `S SET 5` / `DC.B S` / `M MACRO` ... `ENDM` / `ENDC` / `FWD EQU 1`: `FWD`
  is defined only after the block, so in pass 1 the condition is a forward reference.
- Original: `DC.B S` assembles to `05`; 0 errors; the symbol table lists `FWD`, `M` and `S`.
- Port: `Line 4 ERROR: Undefined symbol` on the `DC.B` line, object code `00`; 1 error; the
  symbol table lists `FWD` only.
- What a student sees: an error the original does not report, in a program that defines symbols
  inside an `IFxx` block whose condition refers to a symbol defined further down.
- Cause: in pass 1 `eval` pushes, for a symbol not yet defined, a local variable it never wrote
  (`EVAL.CPP:76`, assembler §9.3.3). The port starts it at 0 (`engine/asm/PATCHES.md` P7), so
  `IFNE FWD` is false in pass 1 and the block is skipped: `S` and `M` are never created. In pass 2
  the block is assembled, `define()` finds no `S` to update (the case `PATCHES.md` P14 guards),
  and `DC.B S` is undefined. In the original the unwritten variable held a value other than 0, so
  the block was assembled in pass 1 too and `S` and `M` exist: the official symbol table lists
  both, which a block reached only in pass 2 cannot produce. The native build of the unpatched
  sources (`build/asm-native/unpatched`, compiled with MSVC) gives the official listing line for
  line (the `Created On:` line apart), 0 errors and the same symbol table; the patched build gives the port's. Which value the
  original's variable holds depends on what earlier calls left on the stack, so another program
  can take the other branch in the original as well. Owner: engine/asm. Accepted for this release:
  the engine is not changed in this round.

##### A valid printf conversion in a macro body line (`checklist/macro-09-binary-constants-and-a-valid-printf-conversion-i`)

- Source: a macro whose body has the line `DC.B '%d%s%%'`, called once; assembled with default
  options and with *Macros Expanded* on.
- Original: the expansion ends at that line; no code is emitted for it or for the rest of the body
  and no error is reported. With *Macros Expanded* on, neither the line nor the `ENDM` line is
  listed; with it off, the statement after the call is at `$1004` instead of `$100A`. The original passes the line to
  `fprintf` as the format string (assembler §9.3.4); what it does depends on what the conversions
  read from the stack, and this is what the official program did under Wine.
- Port: lists and assembles the line literally (6 bytes of object code more); 0 errors.
- What a student sees: a macro body line with `%d`, `%s` or another valid conversion is assembled
  by the port (and listed, with *Macros Expanded* on) where the original, in this program, dropped
  it and what followed it in the body (here only `ENDM`), so the code after the call is at other
  addresses. The other body line, `AND.B #%00001111,D0 ; 50% done`, gives the same code and the
  same listed text in both (`50% DONE`: an expanded line is upper-cased when it is read back for
  the expansion). Why the original's `fprintf` copied that line unchanged is not known: `% d` in
  its comment is a valid conversion in C (the native build of the unpatched sources, compiled with
  MSVC, prints a number there and the line fails), and the line is stored before it is
  upper-cased, so the upper-casing does not explain it. Borland's run-time library may stop
  converting at the malformed `%00001111,` before it; this was not tested.
- Cause: when it defines a macro, the original copies each body line into its macro store (a
  temporary file) with `fprintf(tmpFile, line)` (`MACRO.CPP:106`), so the line is a format
  string; the port copies it literally (`fputs`, `engine/asm/PATCHES.md` P5). The store is written
  whether or not *Macros Expanded* is on, which is why the code differs with the option off too.
  The original's result is undefined behaviour of C and cannot be reproduced in general. Owner:
  engine/asm.

##### `ENDI` with nothing open (`checklist/stc-03-missing-then-do-unknown-condition-mismatched-and`)

- Source: an `ENDI` with no structured statement open, followed by an `IF D0 <EQ> #1` without
  `THEN`.
- Original: `Undefined symbol` on the `ENDI` and a listed label line `_020C002A` (a value read from
  the empty stack); the `IF` assembles to `6600 0008` with only the `THEN expected` warning:
  5 errors, 2 warnings.
- Port: `Invalid syntax` on the `ENDI`, and `Undefined symbol` with `BNE _00000000` on the `IF`:
  6 errors, 2 warnings, and every later address is 4 lower.
- What a student sees: one error more, with another message, in a program that already has
  errors; the program cannot be run in either.
- Cause: the original reads past the bottom of its structure stack (assembler §9.3.6); the port's
  engine checks the stack. The original's label is a value of uninitialised memory and cannot be
  reproduced. Owner: engine/asm.

#### How listings with an undefined symbol are compared

- Where the listing reports `Undefined symbol`, the original encodes uninitialised memory as the
  operand (assembler §9.3.3: the variable the value should have been written to is left as it
  was), so the bytes differ from run to run of the original itself. For such runs (all of them
  programs with assembly errors; every error-free program is identical) three things are masked
  before comparing, and every other byte, the error and warning counts included, must be equal
  (`tests/conformance/asm/compare.ts`, erratum T1 4):
  1. the object-code field (columns 11 to 32) of each statement that reports the error, with its
     continuation lines when *Constants Expanded* is on;
  2. in the symbol table, the value of an entry whose name cannot be a label (the original creates
     one, such as `,D0`, from a failed operand and leaves its value uninitialised);
  3. in the S-records, the data bytes of exactly those statements and the checksum of each record
     that holds one; type, length and address of every record are compared. A run with *Generate
     Listing* off has no listing to name those statements: they are taken from the listing of the
     same program assembled with the same options and the listing on (the code is the same), the
     official one for the official S-record and the port's own for the port's (erratum T1 20).
     This applies to three runs of the option subset (`github/pacman-mc68000/GAME/SYSTEM.X68`,
     `checklist/line-13-...` and `checklist/stc-04-...`, each without a listing).
- What a student sees: the port emits deterministic bytes (mostly zero) where the original emitted
  whatever was in memory, only in statements that are errors.
- Counted on this PC (2026-11-22, `npm run test:conformance` with the `site` set): 143 of the 801
  runs with an official result are equal only after this masking; the other 654 are byte for byte
  equal, and 4 are the differences above.

#### Runs without an official result

These runs are not compared, because the repository holds no listing and S-record of the official
program for them. The port assembles each of them. For two of them (`macro-10`, `macro-13`) the
official program cannot give one: it crashes. The others lack one by the automation's choice: they
are not tried (the large sources) or the run stops at a message box it may not dismiss (`s21`).

- `github/pacman-mc68000/GAME/GFX.X68` (default and *expand* options) and
  `site/games/AlienInvasion_Pucky_Protector/ALLGAMES4.1.X68` (*expand* options: Macros, Structured and Constants Expanded together):
  sources of 2.4 MB and 1.2 MB. Under Wine the official editor needs more than an hour to load a
  source above about 1 MB into its RichEdit control (official-oracle §3.2.1), so these runs are not
  tried (`regenerate.mjs --large` would try them; three runs of more than an hour each do not fit
  the 180 minutes of the weekly job, and on this PC they were not attempted in this round). `GFX.X68` is compared as part of
  `github/pacman-mc68000/GAME/MAIN.X68`, which includes it and is identical with every option;
  `ALLGAMES4.1.X68` is identical with default options.
- `checklist/macro-10-expanded-line-longer-than-255-characters` (default): the official program
  crashes. Wine reports a stack overflow at address `0x2c312c31`, the text `1,1,` of the expanded
  macro line, which overwrote a return address (assembler §9.3.8). The port gives the line a
  defined result (`engine/asm/PATCHES.md` P8).
- `checklist/macro-13-recursion-to-the-limit` (default): the official program crashes on a macro
  that calls itself without end (stack overflow). The port stops the recursion with an error; a
  recursion that ends by a condition (`checklist/macro-12-recursion-that-ends-by-a-condition`) is
  identical.
- `richedit/s21_trailer_short_tab_size.X68` (default): on opening the file the official editor
  shows a box `Information` with `Error in LoadFile()` (its last trailer line, `*~Tab size~4`, has
  no closing `~`). The automation dismisses only the boxes it knows to be harmless (the help
  viewer's); any other box fails the run (erratum T1 16), so that a box the official program shows
  to a student is never pressed away unseen. With the box closed (a scratch driver, erratum T1 17)
  the official editor assembles the whole file to the result of the program without its trailer
  (what the editors show: DIFFERENCES part E1 "A trailer line too short to read"). Teaching the
  tracked driver to press OK on this one box would add a second exception to the rule of entry 16
  and change `asm_batch.py`, which is part of the image; it is not done in this round.

### Differences recorded by T3 (simulator conformance)

(`docs/differences/T3.md`)

What the port does differently from the official EASy68K v5.16.1 simulator where a student could
notice it, found or settled by the conformance suite (`tests/conformance/sim`). The per-mismatch
list with evidence is `tests/conformance/sim/MISMATCHES.md`; the owners are in
`tests/conformance/sim/known-differences.json`.

#### R-16: the execution-log lookup that runs past the last listing row

- Original (sim-core §8.3): `lineToLog()` starts its binary search with `botIndex = Count`, so
  `Strings[Count]` can be read; the VCL then throws `EListError`, `exec_inst` catches it, and the
  instruction whose opcode was fetched is not executed.
- Port: the engine keeps the same code (`engine/sim/shim/form1.cpp`); its `TStrings::Strings[]`
  (`shim/vcl/vcl.h`) throws `EStringListError` for an index at or past `Count`, which the same
  `catch (...)` of `exec_inst` receives. By construction the outcome is the original's.
- Not reached by any program of the suite: the last rows of a listing are the symbol table and the
  error count, whose first eight characters sort after every address in the locale order the engine
  imitates (digits before letters), so the search turns down before it reaches `Count`. No golden
  can show the case; it stays a statement about the code.

#### Text in execution logs with `%`

- Original: a listing row is the format string of `fprintf` (sim-ui §19 Q23), so `%d`, `%s` and the
  like print whatever the stack holds.
- Port: the row is written literally (engine/sim/PATCHES.md, 11.7).
- Evidence: `logs/l14-percent-in-listing` (see MISMATCHES.md for what the official program wrote).

#### Tasks 0 and 1 with a negative count on a string longer than 255 characters

- Original (trap15-a §12 item 8; T4's report D1): with D1.W negative the text is copied with
  `strncpy` into a 256-byte buffer without a terminating NUL, so after the 255th character the output
  can carry whatever the host stack holds. `trap15-a/a55-task0-negative-count-first` printed 255
  characters and the byte `$C0` after `NOP` and `MULU`, and exactly 255 after `MOVE.L (SP)+` and
  `RTS`; with other host calls before it (`trap15-a/a05`) always exactly 255.
- Port: always exactly 255 characters (the engine's P24 ends the buffer at character 255).
- Nothing a program can rely on: the extra byte is residue that depends on the Borland code that
  ran before. Accepted (owner: the engine; `known-differences.json`).

#### Live update of the Memory window at address 0

- Original (sim-ui §10.4, quirk; sim-ui §19 Q19): with `Live` checked, a write by the running
  program repaints the rows around the written address only if `loc >= memAddr-3`, and `memAddr` is
  unsigned, so while the window's top row is address 0 the test wraps and is false: **no live update
  while the window shows address 0**. The rows are repainted when the program stops.
- Port: the Memory panel's live update repaints every visible row that changed, once per display
  frame, wherever the view starts; at address 0 too (`app/src/features/memory/model.test.ts` "Live:
  sets SimOption.MemLive and repaints changed rows once per frame, also at address 0"). sim-ui §10.4
  allows it ("a port may implement live update as redraw visible rows that changed").
- Display only: the program's memory and results are the same; a user watching address 0 with
  `Live` on sees the writes as they happen instead of when the program stops.

#### Task 107 before any network task: the high word of D1

- Original (trap15-b 12.2, task 107; `simIOu.cpp` `receivePortNet`): when nothing was received the
  sender's port is an uninitialised local, and `D1.L = (port << 16) | 0` carries it. Under Wine,
  `trap15-b/b20-net-receive-port-uninitialised` got `D1 = $02660000` (golden line 1); a first
  probe that made other TRAP #15 calls before the same task 107 got `D1 = $00210000`.
- Port: `D1.L = 0` (trap15-b 12.2: "PORT: return 0 there"; `NullNet.receivePortNet`).
- Nothing a program can rely on: the value is residue of the host stack that depends on the
  Borland code that ran before. Accepted (owner W1; `known-differences.json`).

#### Seen only under Wine: results that wait for a run on Windows

The official program was run only under Wine 8.0 (the oracle image). For the programs below the
port's `result.bin` differed from the golden. Their state today:

- **`a51`, `a52` and `a53`: the port's differences, repaired (gate I3, branch `gate3/stdio`).** A
  read right after a write on one file, or a write right after a read, without a seek between
  them: C leaves both undefined, and what happens is decided by the Borland C run-time inside
  `SIM68K.exe`. The simulator engine now has that run-time's stream, read in the program's machine
  code and measured in the official program with the probes and conformance programs of
  `engine/sim/shim/STDIO-MODEL.md` (trap15-a `a61`-`a68`). All three produce their goldens and have
  left `known-differences.json`. What a program can still see differently are bytes of the heap the
  program never wrote (the buffer's old contents a read in the write state returns):
  `docs/differences/SH6.md`, which also records what happens when a write runs past the end of a
  stream's buffer (measured; it depends on the original's heap layout, so no conformance program
  holds it).
- **`a53`'s one remaining question for Windows.** Its failing close is the run-time's: the read in
  the write state leaves the flush a count of -3, which the run-time passes to `WriteFile` as a
  count above 4 GB. That `WriteFile` refuses such a count without writing is measured under Wine
  (a53 itself, and trap15-a `a67`: `ReadFile` and `WriteFile` of `$FFFFF000` bytes fail); that the
  run-time's close then fails, keeps the handle and the file cannot be deleted is measured without
  any system call deciding it (trap15-a `a61`, case C: a count of -1, which the run-time answers
  without calling `WriteFile`). On Windows the kernel refuses a buffer range that wraps the address
  space before it writes, so the answer is very likely the same; the Windows session keeps a53 to
  confirm exactly that (`docs/porting/windows-confirmation.md`). If Windows wrote instead, only
  `osWrite` of `engine/sim/shim/hostfile.cpp` would change.
- **Not yet confirmed against the original: `b19`.** Listed in `known-differences.json` with
  `unconfirmed`, because only the official program on real Windows can say whether the golden is
  the original's answer or Wine's (most likely Wine's); `docs/porting/windows-confirmation.md` part
  A has the steps. By the architect's decision of 22 November 2026 (erratum T3, ARCHITECTURE.md 6.9)
  such a program does not count against 6.9 item 2, and it counts as an open verification item of
  item 11 (`docs/DIFFERENCES.md` part 4).
- **`a58`: the port's difference, repaired.** It produces its golden and has left
  `known-differences.json` and the Windows session.
- **`b06`: settled by measurement on Windows.** The GDI calls the original makes were measured on
  Windows 11: the golden is Wine's, and the port draws what Windows draws. It stays listed in
  `known-differences.json` as an accepted difference with that cause (the golden cannot be replaced
  without the official program on real Windows), and it has left the Windows session.

##### `trap15-a/a51-files-read-after-write` (owner SH6; repaired, no longer listed)

- Program: task 52 creates a file, task 54 writes `ABCDE`, task 53 reads 4 bytes **without a seek**
  in between, task 56 closes; a new stream (task 51) reads the file back.
- Differs: line 2 (the read): golden `D0=00000000 D2=00000004` (success, 4 bytes), port
  `D0=00000001` (end of file); lines 4 and 6: golden `D2=00000001`, port `D2=00000005`; line 5 (the
  bytes read back): golden `41 EE EE EE EE ...` (the file holds one byte, `A`), port
  `41 42 43 44 45 EE ...` (`ABCDE`).
- Why Wine is not the cause: C leaves a read right after a write without a seek undefined; what
  happens is decided by the Borland run-time inside `SIM68K.exe`, which is the same under Wine and
  on Windows. Wine only answers the run-time's `ReadFile`, `WriteFile` and `SetFilePointer` calls,
  and the result (a write that lands short) is the kind of thing a stream state machine does with
  an ordinary file system. The golden is the original's answer. Repaired at gate I3: the engine's
  stream gives the same (STDIO-MODEL.md R3, R6; the 4 bytes read come from the buffer's heap memory,
  `0A 00 00 44` in every official run, which the port cannot know and gives as zeros; they are not
  part of the golden).

##### `trap15-a/a52-files-write-after-read` (owner SH6; repaired, no longer listed)

- Program: write `ABCDE`, task 55 seek to 1, task 53 read 2 (`BC`), task 54 write `X` **without a
  seek**, close, read the file back.
- Differs: line 7 only (the file after the close): golden `41 42 43 44 45` (unchanged; the write
  reported success, D0.W = 0), port `41 42 43 58 45` (`ABCXE`).
- Why Wine is not the cause: as for a51, the run-time's stream state decides; Wine's part is the
  file system calls. Repaired at gate I3 (STDIO-MODEL.md R8).

##### `trap15-a/a53-files-past-end-then-read` (owner SH6; repaired, no longer listed)

- Program: write `ABCDE`, seek to 25 (20 bytes past the end), write `X`, task 53 read 4 **without a
  seek**, close, then a new stream reads the file and task 57 deletes it.
- Differs: line 2 (the read): golden `D0=00000000`, port `D0=00000001`; line 3 (the close): golden
  `D0=00000002` (the close **failed**), port `D0=00000000`; lines 5 and 8: golden `D2=00000005`,
  port `D2=0000001A`; lines 6 and 7 (the bytes read back): golden `ABCDE` then `EE ...`, port `ABCDE`,
  20 zeros and `X`; task 57 afterwards: golden 2 (the first stream is still open), port 0.
- Why Wine is a suspect: here more than for a51 and a52. A failing `fclose` means a `WriteFile` (the
  flush of the buffer) or a `CloseHandle` failed, after a `SetFilePointer` past the end of the file.
  On Windows a write past the end extends the file with zeros; that a Win32 call fails here is the
  one point where Wine's answer, not the run-time, may decide the result. Repaired at gate I3: the
  run-time's flush has a count of -3 here, which reaches `WriteFile` as a count above 4 GB
  (STDIO-MODEL.md R6, section 3); see the bullet above for what is measured and what the Windows
  session still confirms.

##### `trap15-a/a58-files-devices` (owner SH6; repaired, no longer listed)

- Program: task 52 on the name `NUL`, write 3 bytes, close, task 59, task 51 on `NUL`, read 3 bytes.
- Differs: line 6 (the read): golden `D0=00000001` (end of file), port `D0=00000000` (the 3 bytes
  read back). Every other line agrees.
- Why Wine is a suspect: hardly. `NUL` is the null device on Windows as under Wine: what is written
  disappears and a read gets end of file. The port had no devices (its ProgramFiles created an
  ordinary file `NUL`), so the difference was the port's.
- **Settled in gate I3 round 3 (SH6): the port's difference, repaired.** `ProgramFiles` now treats
  `NUL` as the null device in every view (browser store, opened folder, the desktop app's disk, also
  where a file named `NUL` exists): an open succeeds in every mode and creates nothing, a write is
  discarded, a read is at end of file, a seek succeeds, a close succeeds, task 57 fails. Which names
  are the device was measured on Windows 11 (docs/porting/errata/SH6.md entry 14). a58 produces its
  golden, and its entry has left `known-differences.json`.

##### `trap15-b/b06-modes-above-15` (owner SH1)

- Program: for modes 20, 22, 18, 19, 21, 23 (task 92), a red pen draws a pixel on black (task 82),
  read back with task 83.
- Differs: lines 1-6, D0 and D6 (the pixel): golden `000000FF` (red) for every mode, port
  `00FFFFFF` (white) for modes 20, 18, 19, 21, 23 and `00FFFF00` (the inverse of the pen) for 22.
- Why Wine is the suspect: the golden is exactly what the copy mode (set by task 92 with 4 just
  before each pixel) draws, so the mode value never took effect. The VCL passes `PenModes[mode]`, a
  word read beyond the end of its 16-entry table (trap15-b 5.4), to `SetROP2`. Wine's `SetROP2`
  rejects every value outside `R2_BLACK`..`R2_WHITE` (1-16) with `ERROR_INVALID_PARAMETER` and keeps
  the previous mode; Windows' GDI, measured for every value 0-255 (trap15-b 5.4, the measurement the
  port's table rests on), keeps the low byte and draws operation `((v - 1) AND 15) + 1`. Wine and
  Windows are known to differ at exactly this call, so this one is most likely Wine's, and the port
  is right.
- **Measured in gate I3 round 3 (SH1): Wine's.** T2's capture program made the calls the original
  makes for task 92 and tasks 82 and 85 natively on Windows 11 10.0.26300 (this project's reference
  machine), with the words SIM68K.exe passes (`tests/conformance/gdi/golden/modes.json`,
  `modesAbove15`). Windows' `SetROP2` refuses no value: it returns the previous ROP2, keeps the low
  byte (`GetROP2` reads it back) and draws `((byte - 1) AND 15) + 1`:

  | Mode (task 92) | Word to `SetROP2` | `GetROP2` | Red pixel on black, Windows 11 | Golden (Wine) | Port |
  | --- | --- | --- | --- | --- | --- |
  | 18, 19, 20, 21 | 0 | 0 | `00FFFFFF` (white) | `000000FF` | `00FFFFFF` |
  | 22 | 772 | 4 | `00FFFF00` (the inverse of the pen) | `000000FF` | `00FFFF00` |
  | 23 | 37008 | 144 | `00FFFFFF` (white) | `000000FF` | `00FFFFFF` |

  Raw values 0-32 and 48, 128, 255, 256, 257, 4096, 32768, 32896, 65535, 65536, 65540, `$7FFFFFFF`,
  -1, -16 follow the same rule (docs/porting/errata/SH1.md entry 17 has the whole table). The port
  draws what Windows draws, so the entry stays in `known-differences.json` with the cause "Wine's
  SetROP2 differs from Windows'; measured on Windows 11 with the capture program". The golden cannot
  be regenerated without the official program on real Windows; if b06 is ever run there, its result
  replaces the golden and the entry goes. That run is no longer part of the session of
  `docs/porting/windows-confirmation.md`: the measurement has settled the question.

##### `trap15-b/b19-net-send-uninitialised` (owner W1)

- Program: task 102 (send 5 bytes to `127.0.0.1`) and task 106 (the same on port $0800) before any
  task 100 or 101, so Winsock is not started and the simulator's socket was never created.
- Differs: lines 1 and 2, D0 only: golden `D0=27360001` (`WSAENOTSOCK` 10038 << 16 + `NET_ERROR`),
  port `D0=276D0001` (`WSANOTINITIALISED` 10093, trap15-b 12.2 "Not initialised: $276D0001"). D1 is
  kept in both (`ABCD0005`, `08000005`), and the data and address bytes agree.
- Why Wine is the suspect: `netSendData` calls `sendto` on the never-created socket and returns
  `(WSAGetLastError() << 16) + 1`. In the same state Wine's `closesocket` (task 104) and
  `gethostbyname` (task 105) do report `WSANOTINITIALISED` (`b18` lines 1, 3 and 4; `b17`), so it is
  only Wine's `sendto` that checks the handle before the start-up; Windows Sockets documents
  `WSANOTINITIALISED` for every call made before `WSAStartup`. Most likely Wine's, and the port is
  right.

### Differences introduced by DV2 (Electron shell)

(`docs/differences/DV2.md`)

None of these changes what a 68000 program can observe.

- **Help window.** The desktop app shows the original's help pages in a window of their own with
  JavaScript switched off (the original used an embedded browser control with scripts). Links to
  other sites open in the system browser after a confirmation.
- **Closing with unsaved work.** Closing a window or quitting while the page asks for it
  (`Platform.confirmBeforeUnload`) shows a macOS question `Leave EASy68K?` with `Leave` and `Stay`,
  in addition to the original's own save prompts, which the page shows before it gets there.
- **Files a program can reach.** In the desktop app a program, an INCLUDE and every file call reach
  only the granted folders (the folder of the program, folders and files chosen in a dialog or
  opened from Finder, and the app's own folder). The original could open any path on the disk; a
  name outside those folders gives the result of a missing file (7.6, 3.8.4).
- **Several windows.** `New Window` (Cmd+N) opens another complete editor and simulator; the
  original started separate programs. Each window has its own simulator.

### Differences introduced by DV3 (macOS packaging and release)

(`docs/differences/DV3.md`)

Nothing in this package changes what a student's program can observe. The differences are in how
the macOS app reaches a user and how it starts the first time, compared with the Windows original,
which is a set of `.exe` files that Windows starts without any of this.

#### 1. The first start of the downloaded Mac app (section 11)

The Mac app is signed **ad hoc**: it carries a valid signature that proves the files are unchanged
since the build, but no Apple Developer ID, and it is not notarised by Apple (ARCHITECTURE.md 7.6,
section 11). macOS marks every file downloaded with a web browser as "quarantined", and Gatekeeper
refuses to open a quarantined app that Apple has not notarised. This is the text the README and
every release note carry (`desktop/scripts/release.mjs` copies the part between the two marks into
the release notes):

The Mac app is not notarised by Apple (the project has no paid Apple developer account), so macOS
blocks it the first time. This happens once; after that EASy68K opens like any other app. If you
cannot or do not want to do this (for example on a Mac managed by your school, where these settings
may be locked), use the web version instead: it does the same in Safari or Chrome and needs no
installation.

The Mac app needs macOS 13 (Ventura) or later.

**Install.** Download the `.dmg` for your Mac (`arm64` for Apple silicon, M1 and later; `x64` for
Intel; Apple menu > About This Mac tells you which), open it and drag **EASy68K** into
**Applications**. (Or download the `.zip`, which macOS unpacks into `EASy68K.app`, and move that
into Applications.)

**What you will see.** When you open EASy68K for the first time, macOS shows a message instead of
starting it. On macOS 15 (Sequoia) and later it reads "“EASy68K” Not Opened. Apple could not verify
“EASy68K” is free of malware that may harm your Mac or compromise your privacy.", with the buttons
**Done** and **Move to Trash**; older versions say "“EASy68K” cannot be opened because the developer
cannot be verified." Some versions instead say that "“EASy68K” is damaged and can't be opened". The
app is not damaged: this is how macOS words the same block for an app that is not notarised. Click
**Done** (or **Cancel**), never **Move to Trash**.

**Way 1: System Settings** (for the "Not Opened" or "developer cannot be verified" message)

1. Open **System Settings** (Apple menu > System Settings) and choose **Privacy & Security** in the
   sidebar.
2. Scroll down to the **Security** section. It shows "“EASy68K” was blocked to protect your Mac."
   (The line appears for about an hour after you tried to open the app; if it is gone, try to open
   EASy68K once more.)
3. Click **Open Anyway** and confirm with your password or Touch ID.
4. Open EASy68K again. macOS asks a last time; click **Open Anyway** (or **Open**).

On macOS 14 (Sonoma) and earlier you can instead Control-click (or right-click) EASy68K in
Applications, choose **Open** from the menu and then click **Open** in the message.

**Way 2: Terminal** (works for every message, including "is damaged")

1. Open **Terminal** (Applications > Utilities > Terminal).
2. Paste this line and press Return. It removes the quarantine mark from the app, and asks for
   nothing:

```
xattr -dr com.apple.quarantine /Applications/EASy68K.app
```

3. Open EASy68K as usual.

If you put the app somewhere else than Applications, use its path in the command instead (you can
type `xattr -dr com.apple.quarantine ` and then drag the app onto the Terminal window).

Not yet seen on a Mac by this package: the wording of the messages above is taken from Apple's
documentation and from reports of other ad-hoc signed apps, and the exact dialog on each macOS
version is an item of the manual test (ARCHITECTURE.md 6.8, `docs/MANUAL-TEST-MAC.md`, owner DOC1:
"First launch of the downloaded app: the Gatekeeper dialogs and the documented way through them").
Whoever runs it corrects this section, and the README, with what the screen says.

What GitHub's macOS runners have shown (release.yml runs 44938987022 and 44939698734, both architectures, through
`desktop/scripts/check-downloads.mjs`): the app inside the `.zip` (unpacked with `ditto`) and inside
the `.dmg` passes `codesign --verify --deep --strict` and is byte for byte the bundle the packaged
checks tested (same CDHash); the `.dmg` holds the `Applications` link; the minimum is macOS 13.0.
With the quarantine mark a browser sets, Gatekeeper's assessment (`spctl --assess --type execute`)
rejects the app, and `syspolicy_check distribution` reports "Notary Ticket Missing". So the block
described above does happen, and it is the not-notarised block, not a broken signature. A runner
cannot show the dialog itself; its exact wording stays an item of the manual test.

#### 2. Two downloads instead of one

The original is one Windows installer. The port's Mac app comes as two builds, Apple silicon
(`arm64`) and Intel (`x64`), each as a `.dmg` and a `.zip` (1.1). There is no universal build: each
download carries only the code of its processor, including serialport's native module, which is
reduced to that processor (`desktop/scripts/after-pack.mjs`).

#### 3. Version and the About box

The app's version (Finder's Get Info, `CFBundleShortVersionString`) is the port's own version from
the root `package.json` (7.5), not `5.16.1`. What a program or a file can observe keeps the
original's values (1.2).

#### 4. No automatic updates

As 7.6 says, the app has no updater. A new version is downloaded from the releases page; the About
box's update check only says whether one exists (7.5).

### Differences from the original introduced by B1 (EASyBIN)

(`docs/differences/B1.md`)

None of these changes a byte that EASyBIN loads into memory or writes into a file: Open S-Record,
Open Binary, Save S-Record, Save Binary, Copy and Fill give the original's results, quirks included
(docs/porting/easybin.md 19), checked against the original's own functions compiled natively.

- **A mode, not a program.** EASyBIN is the third mode of the application (ARCHITECTURE.md 1.4 note
  26). Its memory image lives as long as the window and is kept when the mode is switched. Simulator
  View > EASyBIN switches to the mode instead of starting `EASyBIN.EXE`.
- **Exit** ends the whole application, as Exit does in Editor and Simulator mode: the editor's save
  questions come first. The original ended only EASyBIN, without a question.
- **The window title** is EASyBIN's caption (`EASyBIN v2.5.0`, or the path of the opened file), as
  in the original, followed by the port's ` - unofficial port <version>` like every title of the port.
- **File dialogs** are the port's (ARCHITECTURE.md 3.8.5). Their Open dialog does not return a name
  that does not exist, so `error: cannot open file ...` and `Error openning ...` appear only when a
  chosen file cannot be read. Paths are the port's (`/browser/...`), also in messages and the caption.
- **Dropped files** are read directly in a browser (nothing is copied into the browser store); the
  caption shows the file's name without a folder.
- **Help** opens `easybin.htm` in the Help panel. The start-up messages about `help.chm` and HTML Help
  do not exist. F1 in the About box opens the credits page in the Help panel behind the box (the
  original opened it in the separate help window).
- **About EASyBIN** keeps the original's texts and adds the port's name, version and the statement
  that it is unofficial.
- **Beep** is a short quiet tone (no system sound in a browser).
- **The memory area** can also be reached with Tab; when it gets the focus the cursor is put on a cell
  (column 10) if it was not on one. The cursor is shown while the area has the focus, and it does not
  blink with reduced motion (2.11).
- **The tab order** follows the layout; the original's went to Length before First Address and to Size
  and Copy before From and To.
- **The `$7F` character** of the ASCII column is drawn as `□` (Courier New has no glyph there; a
  browser would draw nothing and shift the column).
- **Colours** of the bytes follow the theme: file 0 = text colour, file 1 = olive, file 2 = the
  success green, file 3 = the accent blue, out of range = muted text, past the end = the error colour
  (the original: black, olive, green, blue, gray, red on white).
- **Keys typed into the memory area** are Windows-1252 characters; a character outside that code page
  is refused with a beep. On macOS, Cmd+key is left to the menus and the browser; Ctrl+letter types
  the control character as on Windows.
- **The mouse wheel**: one row per notch as in the original; touchpad deltas add up to rows, and a
  change of direction starts afresh.
- **Copy downwards past the end of memory** stops with `Invalid copy range` and keeps what it copied,
  as the original does; the port also shows those bytes at once (the original did not repaint).
- **The `Open S-Record...` and `Save Binary...` buttons** in the two groups have these names as
  tool-tips and accessible names; the original's glyph buttons have no hint.

### Differences of DV4 (desktop serial ports and network)

(`docs/differences/DV4.md`)

Deliberate differences from EASy68K v5.16.1 on Windows in TRAP #15 tasks 40-43 and 100-107, as
the desktop app gives them. A browser has no serial ports and no network: there every task gives
the original's own "not available" result (note 37 of 1.4), unchanged.

#### Serial ports (tasks 40-43)

- **Port names.** Windows names serial ports `COM1`, `COM2`, ...; a Mac names them
  `/dev/cu.<something>`. A program still opens `COM4` with task 40: the Serial Ports dialog
  (Options > Serial Ports... in Simulator mode, desktop app only) says which device each name
  stands for (`AppSettings.serialPortMap`). A name with no device gives result 2, as a COM port that does not
  exist does. Names are compared without regard to letter case.
- **Task 42 does not wait.** The original waits up to `count + 1` ms (plus the inter-character
  timeout) for bytes that have not arrived yet; the port returns at once with what has arrived
  (result 4 when that is fewer than asked for). A program that polls, as programs for the original
  must anyway, sees the same bytes; a program that relies on the short wait may see more short
  reads.
- **Task 43 returns when the system has taken the bytes**, not when they have left the wire.
- **Line settings the device cannot do.** A setting of task 41 that the Mac's serial driver refuses
  gives result 2, where Windows may accept it. Mark parity is one: macOS has no mark parity, and
  task 41 with parity 3 gives 2 there (seen on GitHub's macOS 15 runner against a pseudo-terminal;
  the port stays open with its previous settings).
- **Changing parity, data bits or stop bits** closes the device and opens it again with the new
  settings (only the baud rate can be changed on an open port on a Mac); bytes the driver held
  and had not passed on yet are lost.
- **Buffers.** At most 64 KB per port wait to be read; more is dropped.

#### Network (tasks 100-107)

- **TCP server, task 101.** The original binds at task 101 and starts listening at the program's
  first receive; the port listens from task 101 on. A client that connects before the server's
  first receive is accepted (and its data kept) where the original would refuse the connection.
  After the one client is accepted, others are refused, as in the original.
- **Task 105** gives the first non-internal IPv4 address of the machine; the original gives the
  first address its host name resolves to. On most machines they are the same address.
- **Task 100 with a host name** looks the name up as macOS does (DNS, `/etc/hosts`, mDNS), not as
  Windows does; a name only Windows knows (a NetBIOS name, say) fails with 8.
- **Errors** are the Winsock numbers the original would report for the same situation, mapped from
  the Mac's own error numbers; where the two systems disagree about what a situation is (a send to
  a broadcast address, to address 0 or port 0, a TCP connection to address 0 or port 0), the Winsock
  answer is given.
- **Buffers.** At most 256 KB of datagrams wait to be read per socket; more are dropped, as a full
  socket buffer drops them.
- The waits of the original are kept: task 100 over TCP waits for the connection in steps of
  500 ms for up to 5 seconds, and a name lookup takes as long as it takes, with the window waiting.

### Differences recorded by Q1 (accessibility and keyboard audit)

(`docs/differences/Q1.md`)

Q1 changes no behaviour. This file records where the port follows the original against
accessibility guidance, because the original's colours are part of the fidelity promise
(ARCHITECTURE.md section 0, 2.8 "Editor syntax colours", 2.6 Hardware). None of these colours is to
be changed; each is a difference from WCAG 2.1 AA, not from the original. DOC1 merges this file
into `docs/DIFFERENCES.md`.

The numbers are WCAG 2 contrast ratios, rounded down, as `tests/a11y/check-a11y.mjs --only contrast`
prints them (computed from `app/src/core/highlight/presets.ts` and from the colours the editor
draws in Chromium and WebKit; both agree).

#### Editor syntax colours of the original below 4.5:1 (WCAG 1.4.3)

On the original's white background (`DEFAULT_BACK_COLOR`, the light theme's `Auto` preset and the
`Color1` / `Color2` presets, which keep their stored colours in both themes):

| Preset | Element | Colour | Ratio on #FFFFFF | AA for text |
|---|---|---|---|---|
| Color1 (= Auto, light theme) | Macro/Other (`unknown`) | `#808000` (clOlive) | 4.19:1 | 4.5:1 |
| Color1 (= Auto, light theme) | Structure Error (`error`) | `#FF0000` (clRed) | 3.99:1 | 4.5:1 |
| Color2 | Structure Error (`error`) | `#FF0000` (clRed) | 3.99:1 | 4.5:1 |

Every other element of Color1 and Color2 meets 4.5:1 (lowest: Color1 Text `#008080` 4.77:1,
Directive `#008000` 5.13:1). The `Custom` preset uses whatever the user stored. A user who needs
more contrast can choose another preset or custom colours in Editor Options; the dark theme's
`Auto` palette (the port's own, 2.8) meets 4.5:1 for every element (lowest: Structure Error
`#FF5F56` 5.53:1 on `#1B1F24`).

The axe scans of the audit therefore do not count colour-contrast findings on text drawn in a
syntax colour (`e68-syntax__*` spans, the error squiggle's text, the colour samples of Editor
Options > Colors; `tests/a11y/lib/findings.mjs`).

#### Hardware panel colours of the original below 3:1 (WCAG 1.4.11)

2.6 fixes the 7-segment display and the LEDs at `#FF0000` (on) and `#400000` (off) on a black
display and a grey LED panel, in both themes:

| Graphic | Colours | Ratio | AA for graphics |
|---|---|---|---|
| Segment or LED off, on the black display | `#400000` on `#000000` | 1.21:1 | 3:1 |
| LED on, on the grey LED panel | `#FF0000` on `#808080` | 1.01:1 | 3:1 |
| Segment or LED on, on the black display | `#FF0000` on `#000000` | 5.25:1 | meets |
| LED off, on the grey LED panel | `#400000` on `#808080` | 4.36:1 | meets |
| On against off | `#FF0000` / `#400000` | 4.31:1 | meets |

A lit and an unlit light are always told apart (4.31:1 between them); against its panel a lit
LED is as light as the grey.

#### Not a difference of colour, listed for completeness

- The listing's gutter dots (2.8 `--c-bp-on` `#D92D20`, `--c-bp-off` `#12B76A`) keep the
  original's colours; their outline tokens of errata W2 entry 3 bring every dot to 3:1 in both
  themes, also on the selected row (measured: the lowest is the breakpoint fill on the dark
  selection, 1.83:1, whose edge `#FF7B72` gives 3.51:1). No difference.
- Tab outside dialogs in Safari skips buttons without an explicit tabindex: already listed by W2
  (`docs/differences/W2.md`, last row). The keyboard-only walk-throughs of the audit take that rule
  into account and pass on the macOS key map.

## 3. Shortcuts a browser does not give up

Some keys belong to the browser or to the operating system, and a web page cannot have them. The
design chose another key for each (`docs/ARCHITECTURE.md`, section 2.9.3). Every command is also in
the menus and most are on the toolbar.

| Key | Problem | What the port does |
|---|---|---|
| Ctrl+F4 (browsers on Windows and Linux) | closes the browser tab, cannot be stopped | Log Start is Shift+F4; Ctrl+F4 works only in the Mac app |
| Ctrl+Tab | switches browser tabs | F2 moves to the next panel; Ctrl+Tab works only in the Mac app |
| Ctrl+N, Ctrl+T, Ctrl+W, Cmd+N, Cmd+T, Cmd+W, Cmd+Q | kept by browsers | the original does not use them; Cmd+N, Cmd+W and Cmd+Q work in the Mac app only |
| Ctrl+F2 to Ctrl+F8 on a Mac | macOS uses them to move the keyboard focus, unless switched off in System Settings | Shift+F2 to Shift+F5 do the same; Ctrl+F9 works |
| F11, F12 | full screen and developer tools of the browser | the original does not use them; a program that reads them with task 19 may not receive them in a browser |
| F5, F6, F7, F10, Ctrl+O, Ctrl+S, Ctrl+P, Ctrl+F, Ctrl+G, Ctrl+R | the browser's own actions (reload, save the page, print, find) | the page stops the browser's action and runs its own command. Whether every browser really keeps quiet is checked by a person, browser by browser (`docs/MANUAL-TEST-MAC.md`) |
| Function keys on Apple keyboards | act as brightness, volume and media keys unless Fn is held | hold Fn, or switch the keys to standard function keys in System Settings > Keyboard |
| Insert (Apple keyboards have none) | does not exist | click the Insert/Replace cell of the status bar, or press Ctrl+Shift+I; paste is Cmd+V |
| Alt+letter menu keys | Chrome and Firefox use some of them for their own menus | they work where the browser lets them through (note 14) |
| Cmd+R in a browser on a Mac | reloads the page, and a page cannot stop that dependably | Find And Replace is Ctrl+R on a Mac; Cmd+R works in the Mac app |
| Esc while the Output panel is full screen (Safari, Firefox) | the browser leaves full screen and keeps the key | listed in note 36 |

Results of the browser shortcut table of `docs/MANUAL-TEST-MAC.md`: none yet. The table has not
been worked through on a real Mac or a real Windows PC. Every key that fails there will be added to
this part, with the browser and its version.

## 4. Not yet confirmed against the original

The behaviour of the original was worked out from its source code and checked by running the
official EASy68K v5.16.1 under Wine (`docs/porting/ground-truth.md` section 4). Under Wine the
Borland run-time inside the official programs is the real one; the file system, the drawing (GDI),
the keyboard and the network are Wine's. Some details cannot be settled that way, and the
specifications mark them UNVERIFIED. Every such item that has not been confirmed since is listed
below, one row each: where the item is stated, what is not confirmed, what the port does, and how
it could be confirmed. Where the one session on real Windows settles it (decision O-2 in
`docs/ARCHITECTURE.md`, section 10.2), the row names the part of
[`docs/porting/windows-confirmation.md`](porting/windows-confirmation.md) that does ("Windows
session, part A"). A confirmed item leaves this list: `docs/porting/errata/DOC1.md` entry 9 says by
which test or capture each item that left it was confirmed (among them how Windows draws ellipses,
R-2, settled by the GDI capture of 6.5.2), and where a confirmation showed that the port differs,
the difference is in part 2 above.

### TRAP #15 tasks 0 to 59 (`docs/porting/trap15-tasks-0-59.md` section 12)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| 4 | Whether the output window's own canvas returns to the Options font after a Rewind or Reload that follows a task 21 font change | Every reset restores the Options font, colour and cell size for the whole output (the spec's recommendation) | On Windows: task 21 with red and another font, Rewind, then task 6 and task 11 (get position), as item 4 describes |
| 6 | Task 4 (read a number) with a value outside the signed 32-bit range: Borland's `atoi` may wrap or clamp | The engine's C library reads the digits in 32 bits, so the value wraps modulo 2^32 | Type `4294967295` and `99999999999` into task 4 in the official simulator (possible under Wine too, because the run-time is Borland's) |
| 10 | Task 41 with a baud index of 15 to 255: what the malformed settings string does to the port | The Mac app keeps the port's current line settings and returns 0 (`core/sim-host/serial/desktop.ts`); the web version has no serial ports | A serial adapter on Windows: task 41 with index 15, then send at the old rate |
| 12 | How long one unit of task 23 lasts on Windows (10 ms, or one timer tick of about 15.6 ms) | One unit is 10 ms (ARCHITECTURE.md 4.4.2) | On Windows: task 8 (time), task 23 with 100 units, task 8 again |
| 13 | Keys the original's framework takes before the program: plain Tab, and the simulator's shortcuts while the Output window has the focus, also when their command is disabled | Plain Tab and Shift+Tab give no key-down and no character (the key-up is delivered); the eleven shortcuts and Ctrl+F, Ctrl+G are taken and not delivered, whether or not their command is enabled, until task 24 switches the eleven off (ARCHITECTURE.md 2.9.4) | Windows session, part C (`tests/conformance/windows-confirm/keys-tab-f-keys.X68`) |
| 13 (erratum SH4 10) | Whether the original's framework (VCL) hands a typed character with the value 0 (Windows makes it of Ctrl+Shift+2 on a US keyboard) to the program | Ctrl+Shift+2 types the character `$00`, and tasks 2 and 5 receive it like any character (`charFromKey`; erratum SH4 10) | Windows session, part A ("The key Ctrl+Shift+2": a six-line program with task 5, one minute) |
| 15 | That `fclose(NULL)` in task 59 (a file that does not exist) is harmless in the Borland run-time | The engine skips the call (engine/sim/PATCHES.md P27); the result code is the original's | Task 59 on a missing file in the official simulator (possible under Wine too) |
| 16 | What `OnActivate` covers: when the task 19 key table is cleared | The table is cleared whenever the Output panel gets the focus, also when the browser window comes back from another program (part SH4 above) | On Windows: hold a key, switch to another program and back, read task 19 |
| §3.1 (in the text) | Which pen task 96 reads after text output: the window canvas's pen, which text moves only while double buffering is off and which the blinking input prompt moves | The same: task 96 reads the window's pen; text output moves it only while double buffering is off, and the input prompt, drawn on the window, moves it | Windows session, part C (`gdi-text.X68` reads the pen after task 95); a run with a prompt before task 96 |

### TRAP #15 tasks 60 and up (`docs/porting/trap15-tasks-60-up.md` section 15)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| V4 | The drawing mode a flood fill (task 89) uses when the mode is not Copy: the original's canvas may combine through the mode last used | Always the current mode (part SH1 above) | The test of V4 on Windows: mode 14, draw a line, flood fill at once, read back; again with a task 23 delay before the fill |
| V6 | Whether DirectX looping is sticky, and whether DirectMusic's loader cache makes two slots loaded from one file (or task 73 and a slot) one sound | One decoded sound per slot; looping stays on for a slot until it is reloaded or the simulator is reset (erratum SH5 3; part SH5 above) | Listening, on Windows, to the test of V6 (task 74, task 77 loop, stop, task 75; one file in two slots) |
| V10 | That Tab never reaches the key-down interrupt, and that only the left mouse button captures the mouse | Tab raises no key-down interrupt; only the left button captures (`core/sim-host/input/mouse.ts`) | Windows session, part C (`keys-tab-f-keys.X68`) for Tab; for the mouse, a mouse-up interrupt and a right-button drag out of the window |
| V14 | `PlaySound` with a file that exists but is not a WAVE file | A sound of length 0: `D0.W = 1`, nothing is heard (part SH5 above; Windows may play its default sound) | Task 70 with a text file renamed `.wav`, on Windows |
| V14 | Task 33 with a size larger than the desktop | Each side is clamped to 4096 (part SH1 above) | Task 33 with `D1.L = $FFFFFFFF` on Windows, then task 33 with 0 to read the size |
| V14 | Winsock: a second `connect` on a TCP connection still pending (task 100, and the retry inside tasks 102 and 106) | The Mac app waits up to 5 seconds in steps of 500 ms, as Net.cpp reads, then returns 0 with the connection pending (erratum DV4 8) | Check C5 of `docs/MANUAL-TEST-MAC.md`, on Windows |
| V14 | Winsock: calls made before task 100 or 101 (send, close, local address) | `$276D0001` (WSANOTINITIALISED), in the web version and in the Mac app (erratum DV4 6); program b19 below | Windows session, part A (b19) |
| V14 | Winsock: a receive on an unbound UDP socket, and a send on a TCP server's listening socket | `$27260001` (WSAEINVAL) and `$27490001` (WSAENOTCONN) (errata DV4 6 and 7) | A program on Windows that makes these calls and writes D0 to a file |
| V14 | Whether a relative sound file name that exists only in a later current folder loads (DirectMusic's search folder is set at start-up) | Relative names are resolved against the folder of the loaded `.S68` | On Windows: task 58 to change the folder, then task 74 with a name found only there |
| §12.2 (in the text) | Task 107 over TCP: the address written to (A2), which Winsock does not fill in for TCP | The Mac app writes what the socket record already held: the server's address for a client; for a server the address of its last send, or `0.0.0.0` | A TCP client and server on Windows, each showing (A2) after task 107 |

Item V8 (drawing modes 18 to 255) is no longer open: the GDI calls the original makes were measured
on Windows 11, and program b06 differs from its golden only because Wine's `SetROP2` differs from
Windows' (part T3 above).

### The hardware window (`docs/porting/hardware.md` section 12)

These rest on the behaviour of Borland's framework (VCL) and of Win32. They concern what the
Hardware panel shows and how a person types into it.

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| V1 | How the masked address fields react to single keystrokes (always six characters, blank `0`, padding) | The component kit's masked field: six characters, a cleared position shows `0`, typing overwrites, a value set by the program is padded with `0` on the right (erratum W2 7) | Typing into the address fields of the official Hardware window |
| V3 | `TTimer`: an interval of 0 never fires; changing the interval of a running timer restarts it; enabling an enabled timer does nothing | The same rules (ARCHITECTURE.md 4.5.3; erratum SH7 2) | Auto interrupts on Windows with intervals changed while running |
| V6 | When `OnShow` fires: on every change from hidden to visible, and not when a visible window is shown again | The switch byte is cleared only when the panel changes from hidden to visible (erratum SH7 4) | Task 32 showing the window twice, reading the switch byte each time |
| V9 | Speed buttons cannot take the focus; a push button captures the mouse, so its release arrives when the mouse button is let go outside it | The IRQ and Reset buttons can take the focus (part SH7 above); a held push button keeps the pointer and is released wherever the mouse button is let go | Dragging off a push button in the official window and reading its byte |
| V10 | The level list is an editable combo box whose text can be typed | A list of the seven levels and an empty item; nothing can be typed (part SH7 above) | Typing into the list of the official window |
| V11 | A short number assigned to the Auto Interval field is right-justified and filled with `0` | The same: `250` shows as `00000250` (component kit) | Task 32 with an interval of 250 ms while that level is selected |
| V12 | When an address field's `OnExit` fires (another control of the window gets the focus; not a speed button, not another window) | An address field commits on Enter and when the focus moves to another control of the panel, but not to the IRQ and Reset buttons (part SH7 above) | Typing an address, then clicking IRQ, then another window, in the official window |
| U1 | What the eight-digit Auto Interval field does with an interval above 99,999,999 | It keeps the first eight digits (`engine/sim/shim/hardware.cpp`), and that value goes back into the level's timer | Task 32 with an interval of 123,456,789 ms for the selected level |
| U2 | What a person sees when the bus-error vector itself lies in a faulting range (an endless recursion) | After 1000 levels the engine stops with `ERROR: An exception occurred in routine 'exec_inst'.` and trace mode (engine/sim/PATCHES.md, 11.9) | The program of hardware 4.4 item 3, on Windows |
| U3 | Whether pasting letters that are not hex digits into an address field raises a conversion error | A paste keeps only the hexadecimal digits; nothing else reaches the field (component kit) | Paste `xyz` from the context menu into an address field of the official window |
| U4 | Whether Backspace in an address field deletes | It clears the position before the caret, without a beep (part W2 above) | Backspace in an address field of the official window |
| U5 | Whether a key-up that reaches a push button whose key-down went elsewhere sets its bit | Nothing happens; only a press the button itself received is released | Tab onto a push button while a key is held, release the key, read the byte |
| §9.2 item 8 (in the text) | How Windows resolves a push button whose release never arrives (the window loses the focus while it is held) | Every held button is released when the pointer is cancelled, the window loses the focus or the page is hidden (part SH7 above) | Hold a push button, switch to another program, read the byte |

### The simulator core (`docs/porting/sim-core.md` section 13)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| 1 | Whether Borland's `catch (...)` catches access violations and stack overflows, and what the user then sees | Access violations cannot occur; an endless recursion of exceptions ends after 1000 levels in the original's handler: the box `ERROR: An exception occurred in routine 'exec_inst'.` and trace mode (engine/sim/PATCHES.md, 11.9) | As hardware U2 above, on Windows |
| 2 | What a long access at `$FFFFFE` reads beyond the 16 MB of memory | Zero bytes (64 KB of zero-filled padding; engine/sim/PATCHES.md, 11.4) | Not meaningfully: the original reads whatever follows its memory block |
| 4 | The cycles `MOVEA` adds with an illegal source mode (a read past the end of a table) | 4 for `.W`, 0 for `.L` (engine/sim/PATCHES.md P15) | Task 31 after such an instruction in the official simulator (possible under Wine too, which runs the Borland code) |
| 7 | `fclose(NULL)` in the Borland run-time | As item 15 of tasks 0 to 59 above | As item 15 above |
| 8 | The real duration of `Sleep(10)`, and the original's speed | One task 23 unit is 10 ms; the default speed of 1,000,000 instructions per second is an estimate (decision O-1) | Windows session, part B (speed); item 12 of tasks 0 to 59 above |
| 9 | Whether the shortcut of a disabled menu command (F7 while running) still reaches its handler | The key is taken and the disabled command does not run (ARCHITECTURE.md 2.9.4, rule 2) | Windows session, part C (`keys-tab-f-keys.X68`) |
| 10 | Which serial, network and sound calls block, and for how long | None blocks the window; task 100 over TCP waits up to 5 seconds while the window stays usable (check N4 of the manual list); sounds play on while the program runs | On Windows, with a serial adapter, a network and sounds |
| 12 | The VCL's locale-aware comparison of hexadecimal strings (which listing row an address belongs to) | An approximation of the Windows order (digits before letters, letters without regard to case), exact for hexadecimal strings (engine/sim/PATCHES.md) | Execution logs, made on Windows, of programs whose listings have unusual lines |

### The assembler (`docs/porting/assembler.md` section 12)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| 4 | `BFINS Dn,(d,An){o:w}` followed by a label: a phase error in the real program? | Pass 1 sizes the instruction without its extension words, so every later label gets a phase error (engine/asm/PATCHES.md P7) | A checklist program run through the Wine oracle (the assembler's code is the original's there) |
| 8 | How Borland's `<ctype.h>` classifies bytes `$80` and above (accented letters in labels) | No class: such a byte in a label or mnemonic gives `Invalid syntax`, or `Illegal symbol` when the byte begins a label; inside quotes and comments it passes (engine/asm/PATCHES.md, shim decisions) | A label with `É`, through the Wine oracle |
| 10 | The deepest INCLUDE nesting (open files) | At most 47 files open; an INCLUDE of itself ends after 43 levels with `Unable to access specified file` (engine/asm/PATCHES.md, shim decisions) | A file that includes itself, through the Wine oracle |
| §9.2 (in the text) | `INT_MIN / -1` and `INT_MIN \ -1` in an expression | `ERROR: An exception occurred in routine 'eval'.` (engine/asm/PATCHES.md P12, as Borland's handler of the divide fault would report it) | `DC.L $80000000/-1` in the official assembler on Windows |

Items 9 and 11 of that list are decisions, not questions.

### The editor (`docs/porting/editor-ui.md` section 22 item 12, and the text)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| Bare LF (§6.7) | How the original's RichEdit shows a file whose lines end in LF alone | A lone LF and a lone CR each end a line (`core/documents/format.ts`) | The RichEdit spot check (check C2 of `docs/MANUAL-TEST-MAC.md`) |
| Shift+Tab with Real Tabs on (§8.2) | What Shift+Tab does when Real Tabs is on (probably a tab character) | The same as with Real Tabs off: the blanks before the caret back to the previous stop are deleted (note 12 above; erratum E2 4) | Shift+Tab in the official editor with Real Tabs on |
| Default extension (§6.4) | The extension Windows appends in Save As when the typed name has none (the original's `DefaultExt` is malformed) | `.X68`, when the first filter is selected (the spec's recommendation; erratum FS1 9) | Save As `test` in the official editor |
| Toolbar hints (§3) | Whether the toolbar's hints show the shortcut, for example `Cut (Ctrl+X)` | The hint with the platform's shortcut appended | Pointing at the toolbar of the official editor |
| Replace dialog (§13) | Which of its three default buttons Enter presses while a text box has the focus | `Find Next` | Enter in the Replace dialog of the official editor |
| Default preset (§17, line 57 of `settings.dat`) | The syntax preset selected when no settings file exists | None (`-1`), as in the shipped `settings.dat` | The official editor started without `settings.dat` |
| Tab stops (§8.3, in the text) | How the RichEdit treats the Assembly stops that are out of ascending order, and the spacing beyond the 20th stop | Stops at columns 12, 20 and 44, then every fixed tab size, without a limit (errata E2 4 and 5) | Tab characters at the end of a long line in the official editor, with Assembly tabs |
| Match whole word only (§14.2, erratum E6 4) | Which characters the RichEdit counts as word characters | Letters (Unicode, so `é` is one), digits and `_` | Find `D0` with Match whole word only in `D0.L`, `D0@` and `éD0` |
| The Find box and a line break (erratum E6 5) | What the one-line `TEdit` shows when the selection holds a line break | The first line of the selection | Select two lines, then Find, in the official editor |

### The simulator window (`docs/porting/sim-ui.md` section 19, the rows marked UNVERIFIED)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| Q9 | Pause during Auto Trace leaves Run, Step and Trace disabled until a second Pause | They are enabled at once (note 24 above; part SH8) | Pause during Auto Trace in the official simulator |
| Q18 | The cycle counter, shown with a 32-bit conversion of a 64-bit value | The low 32 bits, as Win32 prints them: the display wraps at 4,294,967,296 (engine/sim/PATCHES.md P28) | A program that runs more than 2^32 cycles in the official simulator |
| Q26 | The buttons of the boxes opened with the VCL value `mbOK` (perhaps Abort, Retry, Ignore) | A box with OK, under the title `Error` | Run To Cursor on a row without an address, in the official simulator |

### EASyBIN (`docs/porting/easybin.md` section 22 item 3)

| Item | Not confirmed | What the port does | How it could be confirmed |
|---|---|---|---|
| §4.1 | That the VCL keeps all eight digits when the program puts an eight-digit text into a six-digit mask edit | The field holds the eight digits and reads them all, as the spec describes | `EASyBIN.exe` on Windows, with an S-record without data |
| §9 | That setting `ItemIndex` in New fires `OnClick` | It does: the split becomes 0 and the digits `1 2 3` disappear | New in `EASyBIN.exe` after choosing a split |
| §5.3 | The glyph Courier New draws for `$7F` | `□` (part B1 above) | A byte `$7F` in the memory view of `EASyBIN.exe` |
| §10.3 | Borland's `sscanf` with a sign or `0x` inside an S-record line | The C standard: an optional sign and `0x` are accepted within the field width | An S-record file with such a line, opened in `EASyBIN.exe` |

### Conformance programs whose official result was seen only under Wine

By the architect's decision of 22 November 2026 (erratum T3; `docs/ARCHITECTURE.md` 6.9), a
program whose golden is in doubt because Wine's own behaviour is suspected is listed here and in
`tests/conformance/sim/known-differences.json` (`unconfirmed`), with the evidence in
`tests/conformance/sim/MISMATCHES.md` and the details in part T3 above. The Windows session, part
A, settles both.

Three programs that were listed here have left the list: `a51`, `a52` and `a53` (a read right
after a write, a write right after a read, a write past the end followed by a read, without a
seek). The C run-time that decides them is inside the official simulator and behaves the same
under Wine; the port's file streams follow that run-time now and all three produce the official
results (part T3 above). One point of `a53` still waits for Windows, although the port already
gives the result seen under Wine: its close fails because the system refuses a write of more than
4 GB, which was measured under Wine only.

| Program | Golden (official program under Wine) | What the port does |
|---|---|---|
| `trap15-a/a53-files-past-end-then-read` | After a write 20 bytes past the end and a read, the close fails (`D0.W = 2`) and the file keeps five bytes | The same. Not listed in `known-differences.json`; the Windows session confirms that Windows refuses the write as Wine does |
| `trap15-b/b19-net-send-uninitialised` | Tasks 102 and 106 before any task 100 or 101 give `$27360001` (WSAENOTSOCK) | `$276D0001` (WSANOTINITIALISED), what Windows Sockets documents for every call made before start-up |

### Two measurements

- **The C library's file buffer** (512 bytes, written when a file is closed or the simulator ends;
  `docs/ARCHITECTURE.md` 3.8.4, risk R-21): measured under Wine with the official program, whose
  Borland run-time is the real one there; `tests/conformance/windows-confirm/stdio-buffer.X68`
  repeats the measurement on Windows (Windows session, part C). The port follows the Wine
  measurement.
- **The original's own speed** on a Windows PC (decision O-1; `docs/porting/speed.md` section 5):
  not measured. The default of 1,000,000 instructions per second is an estimate. Windows session,
  part B.

## 5. Known limitations

These are not decisions: they are things the project knows of and has not repaired or proven yet.
They stay here until they are.

- **Nobody has used the port on a real Mac yet.** Everything is tested automatically on GitHub's
  macOS, Linux and Windows machines, but the checks only a person can make
  (`docs/MANUAL-TEST-MAC.md`) have not been worked through. There is no Mac app to download until a
  release exists.
- **Firefox is not tested.** The automatic tests run in the engines of Chrome (Chromium) and Safari
  (WebKit) only, as Playwright ships them, not in Safari itself. Firefox may work; nothing proves
  it. ChromeOS and phones are not tested either.
- **A folder with a very large `.git`** (a Git repository) can crowd a program's own files out of
  what it may open. When a program runs from a folder of the web version (My Programs, or a folder
  of the disk opened in Chrome or Edge), the simulator loads that folder and the folders below it
  into memory, up to 2,000 files (and 32 MB per file, 256 MB in all). The files below `.git` count
  too, so in a large repository some of the program's own files may be left out; each one is named
  in the message area as `Not available to the program: <path> (<reason>)`. Use a folder that
  holds only the course's files, or open the program's own sub-folder. The Mac app reads the disk
  directly and is not affected. (The repair, taking the files of `.git` last, is described in
  `docs/ARCHITECTURE-PLUS.md` P3.3.10, package N8, and is not built yet.)
- **Speed at `Maximum`, and frames while a program draws, are not proven yet.** The design asks
  that at the `Maximum` setting a program executes at least 100 million instructions in 10 seconds,
  and at least 85 % of what the simulator's engine alone executes in 5 seconds on the same machine
  in the same test run; and that, while a program draws without pause, the 95th percentile of the
  frame intervals is under 20 ms at 60 Hz and under 12 ms at 120 Hz; all in Chrome's engine on
  GitHub's Linux machine (`docs/ARCHITECTURE.md` 6.9 item 9; the `Maximum` rule was corrected on
  22 November 2026 from 200 million in 10 seconds, erratum P1 13). Only the performance job of a
  manual test run there decides it, and the release-candidate check reads that job; no such run has
  been made since the correction. The last one (run 44988194975, 22 November 2026, under the old
  rule) measured the engine alone at 32.05 million instructions per second, `Maximum` at
  150.4 million (60 Hz) and 158.9 million (120 Hz) in 10 seconds, and frame intervals of 17.4 ms
  (60 Hz) and 8.8 ms (120 Hz). By those figures the corrected rule holds there (150.4 million is
  94 % of the engine's 160.3 million in 5 seconds), but only a run of the corrected check on the
  final commit shows it. On a Windows PC the same day, with the corrected check (not judged
  there), `Maximum` reached 144.9 to 224.6 million, 84.4 to 92.2 % of the engine alone; the run at
  84.4 % would miss the 85 % (`docs/porting/speed.md` 4.2, 4.6). The program's own results and
  timing are not affected either way.
- **Screen readers have not been tried.** The accessibility checks look at the page's structure;
  nobody has used the port with VoiceOver or NVDA yet. The automatic audit has no open finding
  today: `docs/integration/rc.md` records the six it found and how each was repaired.
- **Serial ports** (Mac app) were tested with a simulated serial line, never with a real USB serial
  adapter.
