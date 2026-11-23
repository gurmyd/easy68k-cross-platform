# easy68k-mac - architecture of everything above the two engines

Status: design, version 2. This document is the contract for the remaining work. It covers the web
application, the desktop application, the test strategy, the build and release pipeline and the work
breakdown. It does not describe the insides of the two engines (`engine/asm`, `engine/sim`); it
describes the boundary the application expects from them.

How to read it:

- Paths are relative to the repository root and use `/`. `sim-ui §9.2` means section 9.2 of
  `docs/porting/sim-ui.md`; the other specs are cited the same way (`editor-ui`, `assembler`,
  `sim-core`, `hardware`, `trap15-a` = `trap15-tasks-0-59.md`, `trap15-b` = `trap15-tasks-60-up.md`,
  `toolchain`, `ground-truth`).
- "The original" is EASy68K v5.16.1 for Windows (EDIT68K.exe, SIM68K.exe, EASyBIN.exe).
- Section 3 contains real TypeScript. Work package W1 copies those declarations into
  `app/src/contracts/`; after that, `app/src/contracts/` is the authority and this document is the
  explanation.
- Section 9 lists the work packages. Read section 0, then your package, then the sections it names.

Contents: 0 ground rules - 1 product definition and parity matrix - 2 interface design - 3 module
architecture - 4 execution model - 5 files and formats - 6 test strategy - 7 build, CI, release -
8 repository layout and ownership - 9 work breakdown - 10 risks and open decisions - 11 dissent.

---

## 0. Ground rules

1. **Fidelity rule.** Anything a student's program can observe matches the original, quirks included:
   assembler output, CPU results, cycle counts, TRAP #15 results, pixels, hardware-device behaviour,
   the contents of listing, S-record and log files. Defects of the original's GUI that cannot change a
   program's results are fixed, not copied. When in doubt, reproduce, and add a line to
   `docs/DIFFERENCES.md` (owned by DOC1) either way.
2. **The engines are the original C++.** Application code never re-implements anything the engines
   compute, and the simulator engine also carries much of the original's form logic (3.2 lists it).
   Application code supplies what was Windows in the original - pixels, fonts, keyboard and mouse
   events, sound, files, timers, windows - and the interface itself.
3. **Contract first.** A module talks to another module only through a type in `app/src/contracts/`.
   If a contract is wrong, the fix goes to the owner of `app/src/contracts/` (W1), not around it.
4. **One owner per file.** Section 8 assigns every path to one work package. A package edits only its
   own paths. Wave zero creates every shared file; later packages replace stub bodies in files they own.
5. **Logic runs without a browser.** Everything under `app/src/core/` and `app/src/contracts/` must run
   under Node (Vitest) with no DOM, no canvas and no Web Audio. Browser APIs are injected through
   interfaces. This is what makes the conformance tests of section 6 possible.
6. **Bytes, not strings, at every file and engine boundary.** Text is Windows-1252 and CR LF on disk
   (section 5).
7. **Exact texts.** Captions, messages and file formats quoted in the specs are used verbatim, including
   double spaces and spelling mistakes, unless section 1.4 says otherwise.
8. **The engine is changed in one place.** Interface code may read from the simulator engine freely
   (registers, memory, listing rows), but every call that changes it goes through the run controller
   (3.11.2), which is also the only code that calls `run()`. Host parts never call the engine from
   inside a host method (3.3.2).

---

## 1. Product definition

### 1.1 What ships

| Deliverable | Form | Where |
|---|---|---|
| Web app | Static site: one HTML page, hashed JS/CSS, two `.wasm` engines, the original HTML help, fonts, the official example programs. Installable (web app manifest) and usable offline after the first load (service worker). | GitHub Pages, from `main` |
| macOS app | The same web build inside Electron. Two downloads: Apple Silicon (arm64) and Intel (x64), each as `.dmg` and `.zip`, ad-hoc signed. Adds real disk access, native menus, several windows, file associations for `.X68`, `.L68`, `.S68`, and the network and serial TRAP #15 tasks. | GitHub Releases |
| Source | GPL-2.0-or-later repository with the engines' patch sets, the application, the tests and the oracles' build scripts. | GitHub |

Supported browsers: current and previous major versions of Chrome, Edge and Safari (macOS). Firefox is
expected to work but is not a test target. Phones and tablets get a readable layout but no promise of a
usable keyboard.

Any number of windows may be open at once - browser tabs, the installed web app, windows of the
desktop app. Each is an independent editor and simulator, as each started copy of the original is
(3.8.6).

One application contains three **modes**, one per original program, each with the original program's
menu bar and toolbar:

| Mode | Original program | Mode id |
|---|---|---|
| Editor | EDIT68K.exe "EASy68K Editor/Assembler v5.16.01" | `editor` |
| Simulator | SIM68K.exe "EASy68K Simulator v5.16.1" | `simulator` |
| EASyBIN | EASyBIN.exe "EASyBIN v2.5.0" | `easybin` |

### 1.2 Names and versions

- Repository and npm name: `easy68k-mac`. Application display name: `EASy68K` with the subtitle
  `unofficial web and macOS port` wherever a title is shown (window title, About boxes, README). The
  open decision on the final name is O-7 in section 10.
- The port's own version is semantic (`0.y.z` until the definition of done in 6.9 is met, then `1.0.0`).
  It is independent of the compatibility target, which is fixed text: `5.16.01` (editor) and `5.16.1`
  (simulator). Strings that a program or a file can observe keep the original values: listing line 2
  `Assembler used: EASy68K Editor/Assembler v5.16.01`, TRAP #15 task 32/4 = `$00051001`, the
  `settings.dat` and `sim68K.dat` header lines.

### 1.3 Parity matrix

Columns: **Original** = caption or feature as in the spec; **id** = command id (section 3.12; empty for
non-command features); **Port** = where it lives; **Win/Linux** and **macOS** = shortcuts; **St** =
status: `=` same behaviour, `~` changed (note number refers to 1.4), `x` dropped (note).

Shortcut rules that apply to every row (details and the reasons are in 2.9):

- K1. Windows and Linux use the original keys.
- K2. On macOS every `Ctrl+letter` shortcut works with **Cmd or Ctrl**. The table shows the Cmd form.
  The one exception is Ctrl+R, whose Cmd form reloads the page in a browser (2.9.3).
- K3. `Shift+F<n>` is accepted as an alternative to `Ctrl+F<n>`, because macOS reserves Ctrl+F2 to
  Ctrl+F8 and browsers on Windows close the tab on Ctrl+F4. The alternative does **not** exist while
  the Output panel has the keyboard: there Shift+F<n> belongs to the running program, as in the
  original (2.9.4).
- K4. Function keys on Apple keyboards need the Fn key unless the user has switched them to standard
  function keys. This is normal for debuggers on macOS and is stated in the user guide.
- K5. `F2` (next panel) replaces `Ctrl+Tab` in browsers, which reserve it. `F4` switches mode. Both are
  additions. Like K3 they do not exist while the Output panel has the keyboard, because the original
  leaves F2 to F5 to programs (`keyCodes.htm`). From the Output panel the way out is `Ctrl+Alt+O`.
- K6. On macOS a chord with Option is matched by the **position** of the letter key
  (`KeyboardEvent.code`), because Option changes the character a key produces (Option+O is `ø`).
  On Windows and Linux a Ctrl+Alt+letter chord follows the key's label (`KeyboardEvent.key` when it
  is one ASCII letter) and otherwise its position (erratum W3 24). On macOS every command that has
  such a chord also has one without Option, shown first.

#### 1.3.1 Editor - menus (editor-ui §2)

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| File > `&New X68 Source File` | `ed.file.new` | Editor menu File, toolbar | - | - | = |
| File > `&Open File...` | `ed.file.open` | File, toolbar | Ctrl+O | Cmd+O | ~1 |
| File > `&Save` | `ed.file.save` | File, toolbar | Ctrl+S | Cmd+S | = |
| File > `Save &As...` | `ed.file.saveAs` | File | - | Shift+Cmd+S (added) | ~1 |
| File > `&Print` | `ed.file.print` | File, toolbar | Ctrl+P | Cmd+P | ~2 |
| File > `Printer Setup...` | `ed.file.printerSetup` | File | - | - | ~2 |
| File > `C&lose File` | `ed.file.close` | File, tab close button | - | Cmd+W (desktop only) | ~3 |
| File > `E&xit` | `ed.file.exit` | File | - | Cmd+Q (desktop only) | ~4 |
| Edit > `&Undo` | `ed.edit.undo` | Edit, toolbar, context menu | Ctrl+Z | Cmd+Z | ~5 |
| Edit > `&Redo` | `ed.edit.redo` | Edit, toolbar, context menu | Ctrl+Alt+Z | Shift+Cmd+Z, Ctrl+Option+Z | ~5 |
| Edit > `Cu&t` | `ed.edit.cut` | Edit, toolbar, context menu | Ctrl+X | Cmd+X | = |
| Edit > `&Copy` | `ed.edit.copy` | same | Ctrl+C | Cmd+C | = |
| Edit > `&Paste` | `ed.edit.paste` | same | Ctrl+V, Shift+Insert | Cmd+V | ~45 |
| Edit > `Select &All` | `ed.edit.selectAll` | same | Ctrl+A | Cmd+A | = |
| Edit > `C&omment Selection` | `ed.edit.comment` | Edit, toolbar, context menu | Ctrl+Alt+C | Cmd+/, Ctrl+Option+C | ~6 |
| Edit > `Unco&mment Selection` | `ed.edit.uncomment` | same | Ctrl+Alt+U | Shift+Cmd+/, Ctrl+Option+U | ~6 |
| Edit > `&Find...` | `ed.edit.find` | Edit, toolbar | Ctrl+F | Cmd+F | ~7 |
| Edit > `Find &Next` | `ed.edit.findNext` | Edit | F3 | F3, Cmd+G | ~7 |
| Edit > `Find And &Replace...` | `ed.edit.replace` | Edit | Ctrl+R | Ctrl+R; Cmd+R (desktop only) | ~7 |
| Project > `&Assemble Source...` | `ed.project.assemble` | Project, toolbar | F9 | F9, Cmd+B | = |
| Options > `&Assembler Options...` | `ed.options.assembler` | Options | - | - | ~8 |
| Options > `&Editor Options...` | `ed.options.editor` | Options | - | Cmd+, (desktop only) | ~8 |
| Window > `&Arrange` | `ed.window.arrange` | Window (shown, always disabled) | - | - | x9 |
| Window > `&Cascade` | `ed.window.cascade` | Window: one pane, documents as tabs | - | - | ~9 |
| Window > `Tile &Horizontally` | `ed.window.tileH` | Window: two panes, one above the other | - | - | ~9 |
| Window > `&Tile Vertically` | `ed.window.tileV` | Window: two panes side by side | - | - | ~9 |
| Window > `&Minimize All` | `ed.window.minimizeAll` | Window (shown, always disabled) | - | - | x9 |
| Window > `1 <name>`, `2 <name>`, ... | `ed.window.select` (arg: index) | Window: one entry per open document, check mark on the active one | - | - | = |
| Help > `Hel&p` | `ed.help.help` | Help: opens the Help panel at `main.htm` | - | - | ~10 |
| Help > `&About` | `ed.help.about` | Help: About dialog | - | - | ~11 |

#### 1.3.2 Editor - toolbar, context menus, keys (editor-ui §3, §4, §5)

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| Toolbar: New, Open, Save, Print, Find, Cut, Copy, Paste, Undo, Redo, Comment Selection, Uncomment Selection, Assemble Source (13 buttons, 6 separators, this order) | the ids above | Editor toolbar, same order, hints as in editor-ui §3 with the platform's shortcut appended | | | = |
| Editor context menu: Undo, Redo, Cut, Copy, Paste, Select All, Comment Selection, Uncomment Selection, `&Reload File` | the ids above, `ed.edit.reload` | Right-click (Ctrl+click on macOS) in the editor | | | = |
| Message list context menu: `&Clear Error Messages` | `ed.msg.clear` | Right-click in the message list | | | = |
| F1 in the editor: context help on the selection or the word at the caret | `ed.help.context` | Help panel; keyword table of editor-ui §15.3 | F1 | F1 | ~10 |
| F1 on the frame | `ed.help.help` | Help panel | F1 | F1 | ~10 |
| Insert: toggle Insert/Replace | `ed.edit.toggleInsert` | Editor; also a click on the status-bar cell | Insert | Ctrl+Shift+I, click | = |
| Shift+Insert: paste as plain text | `ed.edit.paste` | Editor | Shift+Insert | Cmd+V | = |
| Tab (spaces to the next tab stop unless Real Tabs) | - | Editor (section 2.4) | Tab | Tab | ~12 |
| Ctrl+Shift+`.` indent / Ctrl+Shift+`,` outdent by one space | `ed.edit.indent`, `ed.edit.outdent` | Editor | Ctrl+Shift+. / Ctrl+Shift+, | Ctrl+Shift+. / Ctrl+Shift+, | ~6 |
| Enter with Auto Indent | - | Editor | Enter | Return | = |
| Ctrl+Backspace, Ctrl+Delete, Ctrl+E, and every other Ctrl+Shift key swallowed | - | Not reproduced: standard editor keys work | | | x13 |
| Alt+F, Alt+E, Alt+P, Alt+O, Alt+W, Alt+H open the menus | - | In-app menu bar on Windows and Linux; native menu bar in the desktop app | Alt+letter | (none; macOS has no menu mnemonics) | ~14 |
| Dialog keys (Enter = default button, F1 in the option dialogs, B M W in the About box) | - | Dialogs; Esc also closes (added) | | | ~11 |

#### 1.3.3 Editor - documents, window, features (editor-ui §1, §6-§15)

| Original | Port | St |
|---|---|---|
| Start-up: one new document from the template; title `EASy68K Editor/Assembler v5.16.01`; command-line file | Same. Title bar text: `EASy68K Editor/Assembler v5.16.01 - unofficial port <version>`. Command line: desktop `argv`, web URL parameter `?open=` (section 5.7) | = |
| MDI child windows, any number, title = file name | Tabs in the editor area; up to two panes (Window menu). Tab shows the file name and a dot when modified (added) | ~9 |
| Per-document state: path, tab type, tab size, font, Insert/Replace, modified, source/list kind | `DocumentState` (3.9), unchanged semantics | = |
| Open dialog filters (5 entries), single selection | Open dialog of the active file backend with the same five filters; multiple selection allowed (added) | ~1 |
| Open of a file that is already open (reopen, discard question) | Same question text; reopen replaces the tab | = |
| Source document versus list document (`.L68`, `.S68`): list documents are editable, not highlighted, no trailer | Same | = |
| Font/tab trailer read (last four lines) and written (`.X68` only) | Same algorithm, byte for byte (5.2) | = |
| Save, Save As, `File exists! OK to overwrite?`, `IsSource` update on Save As | Same; the overwrite question is asked by the port only where the platform's own dialog does not ask | = |
| Reload File with the discard question | Same | = |
| Close with `File modified, do you wish to save '<name>' before closing?` Yes/No/Cancel | Same text. Saves the document being closed; cancelling Save As cancels the close | ~3 |
| Exit closes every document with its prompt, then saves settings | Desktop: same. Web: section 1.4 note 4; the browser's "leave site?" prompt guards unsaved documents | ~4 |
| Encoding: ANSI (Windows-1252), CR LF, no BOM, tabs never converted | Same (5.1) | = |
| New document names `untitledN.x68` | Same; N increases by one per new document (the original's skipping is not reproduced) | ~15 |
| Editor: plain text, no wrap, scroll bars, selection visible | Same, plus an optional line-number gutter (default on) and inline assembler markers | ~16 |
| Status bar: `line: column`, `Modified`, `Insert`/`Replace`, empty panel, 64 underscores and `^` | First three panels the same; column is the true visual column; panel 4 shows encoding, line ends and tab mode; the underscore ruler is dropped | ~17 |
| Message list: columns `Line ` and `Error Message`, tool-tip, double-click selects the line, clear, collapse rules, include-file routing | Messages panel under the editor with the same columns, texts and collapse rules; a file column appears when a message belongs to an include file | ~18 |
| Tab model: Assembly stops 12/20/44, Fixed size, Real Tabs, display of tab characters | Same model and stops | ~12 |
| Auto indent | Same rule (editor-ui §8.4) | = |
| Insert / overwrite | Same; overwrite typing is undoable | ~5 |
| Clipboard: paste arrives as plain text | Same | = |
| Mouse: select, double-click word, drag-move of text, file drop opens files | Same. Dropped files open in drop order and unreadable ones are skipped; a dropped folder is handled as 3.8.5 says | = |
| Undo/redo, unlimited | Standard editor history (grouped typing, redo cleared by a new edit, saved state tracked) | ~5 |
| Syntax highlighting: 8 styles + background, per-line algorithm, bit-field dependence, presets | Same algorithm including its quirks (editor-ui §9.3-§9.7); applied to every line at once, no 400 ms delay; one added preset `Auto` (2.8) | ~19 |
| Assemble: auto-save option, flags, editor buffer is assembled, working directory = source folder, outputs `<name>.L68`/`.S68` | Same (4.9, 5.3). No temporary files are visible | = |
| `Assembler Status - <name>` dialog: Warnings, Errors, `&Execute`, `&Load L68`, `&Close` | Same dialog. Execute switches to Simulator mode, starts the simulator afresh and loads the S-record without running it | ~20 |
| Messages from include files open the include file | Same; the assembled document keeps its identity | ~18 |
| Assembler Options dialog: two tabs, nine check boxes with tool-tips, Template tab with `&Save Template`, `&OK`, `C&ancel`, the Sim68K question | Same; Cancel cancels | ~8 |
| Editor Options dialog: General (font, size, fixed tab size, tab type, Current File Info, Auto Indent, Real Tabs), Colors (element list, attributes, presets, `Print w/Black`, 4x4 colour grid, preview), `&OK`, `&Cancel`, `&Help` | Same controls and values; Cancel cancels; the size shown is the real size | ~8 |
| `settings.dat` (57 lines) next to the EXE | Settings live in application storage; `settings.dat` can be imported and exported (3.10, 5.6) | ~21 |
| `template.NEW` next to the EXE | Stored with the settings; default = the shipped 16-line template (editor-ui §12.2) | ~21 |
| Print: selection or all, tabs expanded, monochrome, document font, no header, new page at the PAGE marker line | Same content through the system print dialog | ~2 |
| Find dialog (`Fi&nd what:`, two options, `Find  (F3)`, `Cancel`), modeless | Same dialog, modeless, docked at the top right of the editor area | ~7 |
| Replace dialog (`&Find Next`, `&Replace`, `Replace &All`) | Same | ~7 |
| Help (`help.chm`), F1 keyword table, context ids | The original HTML pages in a Help panel; same keyword table | ~10 |
| About box with credits, link, `Check for update?`, B-M-W Easter egg | About dialog with the original credits and the port's notice; update check against the port's releases; no Easter egg | ~11 |
| Message catalogue (editor-ui §16) | Same texts where the situation exists | = |
| Dead code and unused UI (editor-ui §17), `Print w/Black` effect, print preview | Not ported | x |

#### 1.3.4 Simulator - menus (sim-ui §3.1)

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| File > `&Open...` | `sim.file.open` | Simulator menu File, toolbar | Ctrl+O | Cmd+O | ~22 |
| File > `Open &Data...` | `sim.file.openData` | File | - | - | = |
| File > `&Close` | `sim.file.close` | File | - | - | = |
| File > `&Printer Setup...` | `sim.file.printerSetup` | File | - | - | ~2 |
| File > `E&xit` | `sim.file.exit` | File | - | Cmd+Q (desktop only) | ~4 |
| Search > `&Find...` | `sim.search.find` | Search | Ctrl+F | Cmd+F | = |
| Search > `&Go to PC` | `sim.search.gotoPC` | Search | Ctrl+G | Cmd+G | = |
| Run > `&Run` | `sim.run.run` | Run, toolbar | F9 | F9 | = |
| Run > `Run To &Cursor` | `sim.run.runToCursor` | Run, toolbar | Ctrl+F9, Shift+F9 | Ctrl+F9, Shift+F9 | ~23 |
| Run > `&Auto Trace` | `sim.run.autoTrace` | Run, toolbar | F10 | F10 | = |
| Run > `&Step Over` | `sim.run.stepOver` | Run, toolbar | F8 | F8 | = |
| Run > `&Trace Into` | `sim.run.traceInto` | Run, toolbar | F7 | F7 | = |
| Run > `&Pause` | `sim.run.pause` | Run, toolbar | F6 | F6 | ~24 |
| Run > `R&ewind Program` | `sim.run.rewind` | Run, toolbar | Ctrl+F2, Shift+F2 | Shift+F2, Ctrl+F2 (erratum W3 3) | = |
| Run > `Re&load Program` | `sim.run.reload` | Run, toolbar | Ctrl+F3, Shift+F3 | Shift+F3, Ctrl+F3 (erratum W3 3) | ~22 |
| Run > `L&og Start` | `sim.run.logStart` | Run, toolbar | Shift+F4 (Ctrl+F4 in the desktop app) | Shift+F4, Ctrl+F4 (erratum W3 3) | ~25 |
| Run > `Lo&g Stop` | `sim.run.logStop` | Run, toolbar | Ctrl+F5, Shift+F5 | Shift+F5, Ctrl+F5 (erratum W3 3) | = |
| View > `&Output Window` | `sim.view.output` | View: shows and focuses the Output panel; leaves full screen if active | - | - | = |
| View > `&Memory` | `sim.view.memory` | View: shows and focuses the Memory panel | - | - | = |
| View > `&Stack` | `sim.view.stack` | View: Stack panel | - | - | = |
| View > `&Hardware` | `sim.view.hardware` | View: Hardware panel | - | - | = |
| View > `&Break Points` | `sim.view.breakpoints` | View: Break Points panel | - | - | = |
| View > `&EASyBIN` | `sim.view.easybin` | View: switches to EASyBIN mode | - | - | ~26 |
| Options > `Source Window Font...` | `sim.options.sourceFont` | Options: font dialog (fixed-pitch list, sizes 8-18) | - | - | ~27 |
| Options > `Output Window Font...` | `sim.options.outputFont` | Options: font dialog limited to the measured fonts | - | - | ~27 |
| Options > `Printer Font...` | `sim.options.printerFont` | Options: font dialog | - | - | ~27 |
| Options > `&Log Output...` | `sim.options.logOutput` | Options: Log Output dialog | - | - | = |
| Options > `&Enable Exceptions` (check) | `sim.options.exceptions` | Options | - | - | = |
| Options > `&Auto Trace Options...` | `sim.options.autoTrace` | Options: dialog | - | - | ~28 |
| Options > `&Fullscreen Options...` | `sim.options.fullscreen` | Options: dialog | - | - | ~29 |
| Options > `Enable &Bit Field Instructions` (check) | `sim.options.bitField` | Options | - | - | = |
| Options > `Output Window &Size` > `640x480`, `800x600`, `1024x768`, `1280x800`, `1280x1024`, `1440x900`, `1680x1050`, `1920x1080`, `1920x1200` (radio) | `sim.options.size` (arg: index 0-8) | Options sub-menu; the check mark follows the real size | - | - | = |
| Options > `Output Window Text &Wrap` (check) | `sim.options.textWrap` | Options | - | - | = |
| Help > `&Sim68K Help` | `sim.help.help` | Help panel at `SIMHELP/BasicOperation.htm` | - | - | ~10 |
| Help > `&About Sim68K` | `sim.help.about` | About dialog (sim-ui §16.2 texts) | - | - | ~11 |

#### 1.3.5 Simulator - toolbar, keys, main window (sim-ui §2-§9)

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| Toolbar: Open, Run, Run To Cursor, Auto Trace, Step Over, Trace Into, Pause, Rewind Program, Reload Program, Log Start, Log Stop, `LOGGING` label | the ids above | Simulator toolbar, same order and hints; `LOGGING` on yellow while a log file is open | | | = |
| Gutter context menu `Clear All PC Breakpoints` | `sim.bp.clearAllPC` | Right-click in the breakpoint gutter | | | = |
| F1 in the main window and in each tool window (the I/O window has no F1 handler) | `sim.help.context` | Help panel; each panel opens its own page. In the Output panel F1 goes to the program, as in the original | F1 | F1 | ~10 |
| Ctrl+Tab window cycle Main > I/O > Memory > Stack > Hardware > Break Points > Main, skipping hidden windows | `sim.panel.next` | Same order over the visible panels (Log panel last) | F2; from the Output panel Ctrl+Alt+O; Ctrl+Tab in the desktop app | F2; from the Output panel Ctrl+Option+O; Ctrl+Tab in the desktop app | ~30 |
| Shortcuts act while any simulator window has the focus | - | Same: the original's shortcuts act in every panel, including the Output panel. The chords the port added (K3, K5) do not act in the Output panel | | | = |
| TRAP #15 task 24: eleven shortcuts removed, F1 / Ctrl+Tab / Alt+Enter / Shift+Insert ignored; Find and Go to PC keep theirs | - | Same (2.9.4); only the keyboard-release chord stays | | | ~44 |
| Several simulators at once: every Execute, command line and double-click starts another SIM68K | `app.window.new` | One simulator per window and any number of windows (3.8.6). Execute restarts the window's simulator from start-up state (4.7.1) | - | Cmd+N (desktop only) | ~43 |
| Enabled/disabled state machine: active, busy, halted (sim-ui §3.6) | - | Same states, driven by the engine's menu-state callback; Open and Reload stay available | | | ~22 |
| Registers: 19 hex fields + SR in binary, label `T S  INT   XNZVC`, refresh moments | - | Registers panel, same fields, formats and refresh moments | | | ~31 |
| Editing registers: overwrite-style hex fields, SR 0/1 only, D0-D7/SR/PC applied at the next run command, A0-A7/US/SS applied at once, A7/US/SS mirroring, double-click on PC and on address registers, tab order | - | Same rules (3.11.3) | | | = |
| Cycle counter and `Clear Cycles` | `sim.cycles.clear` | Registers panel | | | ~32 |
| Listing pane: raw `.L68` rows, heading line, 8-column tabs, nine-line text when no listing exists | - | Listing panel, same content | | | = |
| Horizontal scroll bar 1..200 | - | Ordinary horizontal scrolling; the heading scrolls with the text | | | ~33 |
| Current instruction = selected row; `highlight()` rule (last match wins, stale selection, third visible row) | - | Same rule; the row is drawn as selected and also carries a PC marker in the gutter (added) | | | = |
| Gutter dots: green on instruction rows, red on breakpoints; click toggles; limit 100 with `Breakpoint Limit Reached!` | - | Same | | | = |
| Single click selects a row (the "cursor"); double-click sets the PC field | - | Same | | | = |
| Find dialog (`Fi&nd what:`, `Find  (F3)`, `Cancel`), case-insensitive over the raw row, no wrap, F3 inside the dialog | `sim.search.find` | Same | F3 in the dialog | F3 in the dialog | = |
| Message area: append only, cleared on load, trace lines, catalogue of sim-ui §7.2 | - | Messages panel under the listing, same texts | | | = |
| Status bar (two empty panels) | - | Shows run state, speed setting and option flags (added) | | | ~34 |
| Command line `file.S68 /r /f /e /b` | - | Desktop: same arguments. Web: URL parameters (5.7) | | | = |
| Load sequence, listing lookup, `*[sim68k]break` / `bitfield` / `simhalt_off`, window title = file name | - | Same (4.7) | | | = |
| Drag and drop of an `.S68`, `Caution` box | - | Same | | | = |
| Run, Run To Cursor, Step Over, Trace Into, Auto Trace, Pause, Rewind, Reload, halts, input interplay (sim-ui §9) | - | Same (section 4) | | | = |
| Shut-down: settings saved, log stopped, no prompt | - | Same on quit and on page unload | | | = |

#### 1.3.6 Simulator - I/O window (sim-ui §15, trap15-a §3, trap15-b §4-§8)

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| Window `Sim68K I/O`, black, fixed size = surface size, always visible at start, shown on text output and on input, close only hides | - | Output panel, always present in Simulator mode; "show" = make visible and scroll into view; the panel can be collapsed, not destroyed | | | ~35 |
| One surface for text and graphics, 640x480 to 1920x1200 and any task 33 size | - | One canvas, logical size = surface size, integer scaling (2.5) | | | = |
| Full screen: Alt+Enter, `/f`, task 33, left automatically on stop | `sim.output.fullscreen` | The Output panel (browser) or the window (desktop app) goes full screen; the surface is scaled, the display mode is not changed (2.5) | Alt+Enter | Option+Return | ~36 |
| Paste clipboard as typed input (254 characters) | `sim.output.paste` | Same: the key is recorded first, then the characters are fed in one go (3.6) | Shift+Insert | Cmd+V | = |
| Keyboard input, key state table, key and mouse interrupts, input prompt | - | Same (3.6, 4.4) | | | = |
| Sound (two players), files, file dialog (task 58), printer (task 10) | - | Same (3.7, 3.8.4); printer output goes to a print job that the system print dialog prints; file names and task 58 paths: note 46 | | | ~2 |
| Serial ports (tasks 40-43), network (tasks 100-107) | - | Desktop app: implemented. Browser: the original's own "not available" results (3.3.4) | | | ~37 |

#### 1.3.7 Simulator - memory, stack, hardware, breakpoints, logging, options (sim-ui §10-§14, hardware)

| Original | Port | St |
|---|---|---|
| `68000 Memory` window: Address / From / To / Bytes fields, Copy, Fill, Save, Row and Page spin buttons, Live, 16 bytes per row with ASCII, cursor editing in hex and ASCII, wheel, arrows, PgUp/PgDn | Memory panel with the same controls, formats and rules (sim-ui §10) | = |
| Memory window live update not working at address 0 | Live update repaints every visible row that changed | ~38 |
| `68000 Stack` window: `View` list A0..A6, US, SS; pointer on the middle row; aqua and yellow byte marks; red text in the Invalid range; spin and wheel | Stack panel, same | = |
| `EASy68K Hardware` window: 7-segment display, LEDs, switches, push buttons, four address fields with conflict colouring, IRQ 1-7 buttons with auto check boxes, `Automatic Enabled/Disabled`, Auto Interval field and level list, Reset, Memory Map (ROM, Read, Protected, Invalid) | Hardware panel with every control of hardware §5 and the memory side effects of hardware §2 | = |
| Simple PC breakpoints (gutter, `*[sim68k]break`, cleared by Open and Close) | Same; Open clears them only when a file is actually opened | ~39 |
| `EASy68K Advanced Break Points`: Registers, Memory and Expression Builder grids, Set / Clear / Clear All, expression buttons | Break Points panel with the same three grids and buttons; evaluation is the engine's (quirks included); editor defects fixed | ~40 |
| `Log Output` dialog (file names, execution log type, memory range, output log type) | Same dialog | = |
| Log Start, `Log File Options` (Replace / Append / Cancel), Log Stop, `LOGGING`, automatic stops with `Current Log Stopped.` | Same; Cancel or a failed open means logging does not start | ~41 |
| Execution log and output log formats, file names `<name>_RunLog.txt`, `<name>_OutLog.txt`, Rewind/Reload notes | Same bytes (5.5); a Log panel shows the tail of both files (added) | ~42 |
| `Auto Trace Options` dialog (interval 10..1000 step 10, `Disable display update`) | Same; the saved interval is applied at start; Cancel cancels | ~28 |
| `sim68K.dat` (37 lines) | Settings in application storage; import and export of `sim68K.dat` (5.6) | ~21 |
| Persisted: log types, exceptions, bit field, hardware addresses, fonts, auto-trace settings, visibility of Memory / Stack / Hardware, stack register choice, memory address | Same list, plus panel sizes and the visibility of Break Points and Log | = |
| Window positions and sizes on the Windows desktop | Replaced by panel layout state | ~21 |

#### 1.3.8 EASyBIN

The specification is `docs/porting/easybin.md`, written by B1 from `reference/src-easybin/EASyBINv2.5.0`
and `easybin.htm`. The rows below are its section 21.4 (corrected, errata B1 1 to 4 and 7, 8, 10 to 12:
the Save Binary shortcut is Ctrl+S as in the source, New fills with `$FF` after the `Caution` question,
the caption is ` Binary Input/Output Split `, Exit quits the application like the other modes' Exit,
files dropped in EASyBIN mode are read by EASyBIN itself, the tab order follows the layout).

| Original | id | Port | Win/Linux | macOS | St |
|---|---|---|---|---|---|
| File > `&New` (fill memory with `$FF` after `Caution` question) | `bin.file.new` | EASyBIN menu File | - | - | = |
| File > `&Open S-Record...` | `bin.file.openSrec` | File; button in `S-Record File` | Ctrl+O | Cmd+O | = |
| File > `Open &Binary...` | `bin.file.openBinary` | File | Ctrl+B | Cmd+B | = |
| File > `Save S-&Record...` | `bin.file.saveSrec` | File | Ctrl+R | Ctrl+R | = |
| File > `&Save Binary...` | `bin.file.saveBinary` | File; button in `Binary File(s)` | Ctrl+S | Cmd+S | = |
| File > `E&xit` | `bin.file.exit` | File | - | - | ~ (quits the application, easybin.md 19 item 4) |
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
| Tab order | - | follows the layout | | | ~ (easybin.md Q18) |
| Command line `EASyBIN <file>` | - | none | | | x (easybin.md 19 item 7) |

### 1.4 Notes on changes and drops

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

### 1.5 Additions (none changes program behaviour)

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
| `Move Panel To...` (stage of additions, `ARCHITECTURE-PLUS.md` P3.1.4, P3.6) | `app.layout.move` (arg: `{ panel? }`) | Editor: Window menu, after the document list, below a separator; Simulator: end of the View menu, below a separator | - | - |
| `Split Editor Right`, `Split Editor Down`, `Close Split` (P3.1.4) | `ed.window.splitRight`, `ed.window.splitDown`, `ed.window.unsplit` | Editor: Window menu, after `Move Panel To...` | - | - |
| `Lock Layout` (a check item), `Reset Layout` (Simulator: `Reset Layout` with another access key) (P3.1.4) | `app.layout.lock`, `app.layout.reset` | Editor: Window menu, below a separator; Simulator: View menu, after `Move Panel To...` | - | - |
| `Earlier Versions...` (P3.3.3) | `ed.file.history` (arg: `{ path? }`) | end of the Editor's File menu, below a separator; end of the editor's context menu; the Files panel's context menu | - | - |
| `Trash...` (P3.3.3) | `app.files.trash` | end of the Editor's File menu, after `Earlier Versions...`; the Files panel's strip | - | - |
| `Port Additions...` (P3.5) | `app.additions.options` (arg: `{ group?: 'storage' }`) | end of the Options menu in Editor and Simulator mode, below a separator | - | - |

---

### 1.6 Additions of the Plus stage

The stage of additions (movable and dockable panels, a Files panel with multiple selection, earlier versions and a Trash, a viewer for PDF files and pictures, and the dialog `Port Additions...`) is specified in `docs/ARCHITECTURE-PLUS.md`, which is part of this contract for those additions. It changes nothing in sections 0 to 1.4 that a 68000 program can observe; the commands it adds are listed at the end of the table of section 1.5, and the places where the application with the additions does something else than the faithful port are in `docs/differences/N0.md` to `N8.md` (copied into `docs/DIFFERENCES.md`, part 2).

---

## 2. Interface design

### 2.1 Window structure

```
+-----------------------------------------------------------------------------------------------+
| menu bar (mode's own menus)                                   [ Editor | Simulator | EASyBIN ] |
| toolbar (mode's own buttons)                                                        [theme]   |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|                                   mode workspace                                              |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
| status bar (mode's own)                                                                       |
+-----------------------------------------------------------------------------------------------+
```

- The menu bar and toolbar belong to the mode. Switching mode swaps both. In the macOS app the menu bar
  is the native one and is rebuilt on a mode switch; the in-window menu bar is hidden there. The native
  bar also carries what macOS expects of every application - the application menu, an Edit menu with
  the system's editing commands, a Window menu (7.6).
- The mode switch is a three-segment control at the right end of the menu bar row. `F4` cycles
  Editor > Simulator > EASyBIN (rule K5). Modes keep their state when not shown; a program keeps
  running while Editor mode is in front.
- The Help panel (2.7) is a drawer on the right edge, available in every mode.

### 2.2 Editor mode

```
+-----------------------------------------------------------------------------------------------+
| File  Edit  Project  Options  Window  Help                    [ Editor | Simulator | EASyBIN ] |
| [New] | [Open][Save][Print] | [Find] | [Cut][Copy][Paste] | [Undo][Redo] | [Cmt][Unc] | [Asm]   |
+---------+-------------------------------------------------------------------------------------+
| Files   | prog.X68 *  | macros.X68 | prog.L68 |                                                |
| (web)   +----+--------------------------------------------------------------------------------+
| My      |  1 | *-----------------------------------------------------------                   |
| Programs|  2 | * Title      : demo                                                            |
|  demo/  |  7 |     ORG    $1000                                                               |
|   prog. |  8 | START:                  ; first instruction of program                        |
|   macro |  9 |     MOVE.B  #14,DO                                                             |
| Folder: | ! 9|                 ~~  ERROR: Undefined symbol                                     |
|  (none) | 10 |     SIMHALT             ; halt simulator                                       |
|         +----+--------------------------------------------------------------------------------+
|         | 9: 17    | Modified | Insert |          | Windows-1252  CR LF  Fixed tabs 4         |
|         +=====================================================================================+
|         | Line  | Error Message                                                               |
|         | 9     | ERROR: Undefined symbol                                                     |
+---------+-------------------------------------------------------------------------------------+
```

- **Files panel** (left, collapsible, web only by default): the browser store ("My Programs") as a tree,
  and the folder opened through the File System Access API if any. Double-click opens. It is the port's
  replacement for Windows Explorer next to the editor. In the desktop app it is hidden by default.
- **Editor area**: tab strip, editor, status bar. With `Tile Horizontally` or `Tile Vertically` the area
  holds two such stacks; a new document opens in the active pane.
- **Messages panel**: under the editor of the active document, 5 px high when there are no messages,
  at least 87 px when a message arrives, 7 px after a clean assembly (editor-ui §7.3). The splitter can be
  dragged. Each document has its own list.
- **Inline markers**: a squiggle under the whole source line and a mark in the gutter for every message
  of the last assembly; the message text appears on hover and focus. They are removed at the next
  assembly and by `Clear Error Messages`, and they move with edits.

> **Corrected (erratum W3 15).** The shell owns the separator above the Messages panel and applies editor-ui §7.3 itself from `AppState.messages` and `AppState.assemble` (`messagesPaneHeight()` in `state/layout.ts`); a document's list counts as used once it has a summary or a message list (erratum W3 41).

> **Corrected (erratum E2 8).** Two panes: each document is in exactly one pane. Tiling from one pane moves the active document to the second pane (the first shows the document opened last of the others; with one document the second pane is empty and says `No document in this pane. New and Open put a document here after a click into it.`). A click into a pane makes it active; `Cascade` shows every document in one pane again; the tab menu offers `Move to the Other &Pane` while two panes are shown; the pane sizes can be dragged and are not stored. Cascade and the Tile commands are enabled while a document is open.

> **Corrected (erratum E5 11).** With two panes there is still one Messages region under the editor area; it shows the list of the active document, whichever pane it is in.

### 2.3 Simulator mode

```
+--------------------------------------------------------------------------------------------------------+
| File  Search  Run  View  Options  Help                                 [ Editor | Simulator | EASyBIN ] |
| [Open] | [Run] | [RunTo][Auto][Step][Trace][Pause] | [Rewind] | [Reload] | [LogStart][LogStop] LOGGING  |
+----------------------------------------------------+---------------------------------------------------+
| Registers                                          | Output   640x480   zoom: Fit        [full screen] |
|  D0=00000000  D4=00000000  A0=00000000  A4=00000000 | +-----------------------------------------------+ |
|  D1=00000000  D5=00000000  A1=00000000  A5=00000000 | |                                               | |
|  D2=00000000  D6=00000000  A2=00000000  A6=00000000 | |   canvas: text and graphics on one surface    | |
|  D3=00000000  D7=00000000  A3=00000000  A7=01000000 | |   black, pixel-exact, integer scaling         | |
|      T S  INT   XNZVC          Cycles              | |                                               | |
|  SR=0010000000000000     [            0]           | +-----------------------------------------------+ |
|  US=00FF0000  SS=01000000  PC=00001000 [Clear Cycles]+==================================================+
+----------------------------------------------------+ [Memory] [Stack] [Hardware] [Break Points] [Log]  |
|   Address  --------Code---------   Line ---Source--| Address: $00[001000] From: $00[......] To: ...    |
| o 00001000  103C 000E               9   MOVE.B #14 | Bytes: $[........] [Copy] [Fill] [Save]           |
| o>00001004  43F9 00001012          10   LEA MSG,A1 |           00 01 02 03 ... 0F 0123456789ABCDEF     |
| * 0000100A  4E4F                   11   TRAP #15   | 00001000: 10 3C 00 0E ... -<--C-----NO----        |
|   0000100C                         12 * comment    | 00001010: FF FF 48 65 ... --Hello---------        |
+====================================================+                                                   |
| PC=00001000  Code=103C  MOVE                       |                       Row [^][v] Page [^][v] [ ]Live|
| .S68 file read successful                          |                                                   |
+----------------------------------------------------+---------------------------------------------------+
| Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off                           |
+--------------------------------------------------------------------------------------------------------+
```

Legend: `o` green dot (instruction row), `*` red dot (breakpoint), `>` PC marker, the selected row is
drawn with the selection colours.

- The **left column** is the original main window: Registers, Listing with gutter, Messages. It is
  always visible.
- The **right column** holds the Output panel on top and the **tool tabs** below: Memory, Stack,
  Hardware, Break Points, Log. A View menu command makes its panel visible, selects its tab and moves
  the keyboard focus into it. Closing a tool tab (its `x`) hides the panel, as closing the original
  window did; when all are closed the Output panel takes the whole column.
- All three separators can be dragged. Double-click on a separator restores the default split.
- Width below 1100 px: the right column moves under the left one and the tool tabs join the Output
  panel as tabs of one group.

> **Corrected (erratum SH8 20).** The status bar's run words: `Loading`, `Running`, `Waiting for input`, `Waiting`, `Auto trace` (between two Auto Trace ticks), `Halted` (only while the simulator is idle after a halt with the commands busy, `menuState` 1; Rewind, Open and Pause bring back `Stopped`; erratum SH8 29), `Stopped`. The toolbar's `LOGGING` label shows only if a log type was not Disabled at Log Start (erratum SH8 36).

### 2.4 Panel and document behaviour

Panels:

- Panel ids: `registers`, `listing`, `messages`, `output`, `memory`, `stack`, `hardware`, `breakpoints`,
  `log`, `files`, `help`. Visibility and sizes are stored in `AppSettings.layout` (3.10).
- Visibility at start: Output always visible (sim-ui Q17); Memory, Stack and Hardware as saved (default
  hidden, as in the original); Break Points and Log as saved (default hidden).
- Panels are not floating windows. There is no docking by drag; the layout has exactly the regions
  drawn above.
- A panel's content updates at the moments the original's window does (4.6). Showing a hidden panel
  performs the original's `FormShow` side effects: showing the Hardware panel zeroes the switch byte
  (hardware §2.4); nothing else has one.

Documents:

- One tab per open document; order = order of opening. The Window menu lists them `1 <name>` ... with a
  check mark on the active one.
- The tab title is the file name without its folder; the full path is the tool-tip. A modified document
  shows a dot before its name; the status bar shows `Modified` as in the original.
- Font name, font size, tab type and tab size are per document (from the Editor Options defaults,
  overridden by the file's trailer). The editor renders each document with its own values.
- List documents (`.L68`, `.S68`) open in the same editor without highlighting and stay editable.
- The original's eight syntax styles, the background, Auto Indent and Real Tabs are global.

Editing rules that differ from a stock code editor and must be built on purpose (editor-ui §8):

- No word wrap, no bracket matching, no auto-completion, no folding, no multiple cursors.
- Tab with Real Tabs off inserts blanks to the next stop of the document's tab model; with a selection
  the blanks go in at the selection's end and the selection collapses (original behaviour).
- Tab characters are displayed with the document's stops: Assembly = columns 12, 20, 44, then multiples
  of the fixed size; Fixed = multiples of the fixed size.
- Auto Indent: after Enter, if the new line is empty it receives the leading blanks of the line the
  caret was on.
- Insert/Replace per document, shown in the status bar.

> **Corrected (erratum W3 14).** Three more ids are regions of the shell, not panels: `editor` (the editor area, E2), `easybin` (the EASyBIN workspace, B1) and `status` (a mode's status bar). A PanelSpec with the id `help` serves every mode; `messages` exists once per mode. Shell state that `AppState` does not hold (the tool tab in front, a collapsed Output panel, a pending focus request, "Exit has run") is in `ShellState` (`app/src/state/shell.ts`), used through `state/panels.ts` and `showExitScreen(ctx)` (erratum W3 13).

### 2.5 Output panel

- **One surface.** The canvas backing store is exactly `canWidth` x `canHeight` (640x480 at start,
  minimum 640x480, any size from task 33 up to the port's limit `MAX_SURFACE` = 4096x4096; larger
  requests are clamped and reported in the message area as `Output window size limited to 4096 x 4096`;
  the original accepts up to 65535x65535). Device pixel ratio never changes the backing store.
- **Scaling.** `zoom: Fit` (default) uses the largest whole-number scale that fits the panel; if even
  1x does not fit, the panel scrolls. `100%` and `200%` are the other choices. CSS
  `image-rendering: pixelated`; no smoothing at any scale.
- **Header strip**: title `Output`, current size, zoom choice, full-screen button. The strip is not
  part of the surface and disappears in full screen.
- **Prompt overlay**: the blinking `_` and its erasing blank are drawn over the presented image, never
  into the back buffer (3.5.3).
- **Text mirror**: an off-screen element holds the current contents of the text shadow array, one row
  per line, for screen readers (2.11).
- **Mouse**: coordinates are surface pixels (trap15-b §8.4). The context menu is suppressed. The left
  button captures the pointer (3.6).

**Full screen** shows the unchanged surface centred, scaled by the largest whole number that fits,
black around it. The display mode is never changed.

| | Browser | Desktop app |
|---|---|---|
| Mechanism | Fullscreen API on the page's root element; the Output panel then fills the window, as in the desktop app (erratum SH4 6) | the window itself goes full screen (`Platform.setFullScreen`) and the Output panel fills it |
| `Esc` | Chromium: the panel calls `navigator.keyboard.lock(['Escape'])` after entering, so a short Esc reaches the program, as in the original; holding Esc leaves. Safari and Firefox: Esc leaves full screen and is not delivered (a difference, listed) | delivered to the program; leaves nothing |
| Needs a user gesture | yes | no |

- Entered by Alt+Enter (macOS Option+Return), the full-screen button, the `/f` switch, and task 33
  with `D1.L = 2` (the engine calls `host.setupWindow(true)`). When the user is the one who toggles,
  the panel tells the engine (`SimOption.Fullscreen`), as the original's key handler sets its flag.
  The engine's flag `SimOption.Fullscreen` is the state; the Output feature reads it once per frame and
  makes the screen follow, and sets it whenever the state changes on the user's or the browser's side
  (erratum SH4 1).
- Left by Alt+Enter, by `View > Output Window`, by task 33 with `D1.L = 1`, and automatically when the
  engine calls `host.setupWindow(false)` (a stop in trace mode or a halt, sim-ui §9.2 step 9).
- **A program asks without a gesture** (task 33 from a running program in a browser): the panel shows
  `Press any key or click to enter full screen` over the surface and enters on the next key or click in
  the panel. That key or click is also delivered to the program. The request is dropped if the program
  asks for windowed mode or stops first. Task 33 results do not depend on any of this: `D1.L = 0`
  always returns the surface size.
- **The request is refused** (the browser rejects it although a gesture was present, or the page is
  embedded without permission): the port shows the original's failure box, `Sorry, this computer's
  configuration does not support the desired screen resolution in full screen mode.` (title
  `Information`), and stays windowed, which is what the original does when the display mode cannot be
  set (trap15-b §4.4).
- **Full screen ends without the port asking** (browser Esc, the system, a tab switch): the panel sees
  `fullscreenchange` and sets the engine's flag back with
  `controller.invoke(e => e.setOption(SimOption.Fullscreen, false))`, so the engine and the panel never
  disagree.

> **Corrected (erratum SH4 14).** Details (SH4): the full-screen prompt appears only when no user gesture is active (`navigator.userActivation`), so a program that asks within a few seconds of the key or click that started it (F9, then task 33) gets full screen at once, as in the original; a key or click without user activation (Esc) does not carry the request out. The refusal box is `FULL_SCREEN_REFUSED` with no icon and OK (erratum SH4 17). In the desktop app `Platform.onFullScreenChange` tells the panel that the window left full screen (erratum SH4 5). The header strip has a `Collapse the Output panel` button (note 35), hidden where the panel is a tab; leaving Simulator mode leaves full screen; `View > Output Window` leaves full screen and shows and focuses the panel (erratum SH4 15). The picture's scroll region is a Tab stop (`role="region"`, `aria-label="Output picture"`; erratum SH4 25).

### 2.6 Tool panels

- **Memory** (sim-ui §10): top strip with `Address:`, `From:`, `To:`, `Bytes:`, `Copy`, `Fill`, `Save`;
  right strip with `Row`, `Page`, `Live`; rows `%08X: ` + 16 hex bytes + 16 ASCII cells; the cursor is a
  one-cell frame that blinks at 500 ms (static when the system asks for reduced motion). The number of
  rows follows the panel height. The panel does not scroll; it pages, as the original does.
- **Stack** (sim-ui §11): rows `%08X: ` + 4 bytes; the selected pointer on the middle row; `View` list
  on the right with A0..A6, US, SS (default SS); aqua and yellow byte backgrounds; red text for bytes in
  the enabled Invalid range.
- **Hardware** (hardware §5): six rows as in the original (7-segment display, LEDs, bit labels and
  switches, push buttons, the three groups Interrupt / Auto Interval / Reset, Memory Map). Segments and
  LEDs use `#FF0000` (on) and `#400000` (off) on black and grey panels in both themes. Switches and
  buttons are drawn by the port (the original's bitmaps are GPL and may be used as reference).
  Disabled IRQ and Reset buttons are visibly disabled.
- **Break Points** (sim-ui §12.2): three stacked groups `Registers`, `Memory`, `Expression Builder`,
  each a grid with row numbers and `Set`, `Clear`, `Clear All`; the builder row `PC/Reg [nn]`,
  `Memory [nn]`, `AND`, `OR`, `(`, `)`, `Backspace`. A row is edited in place after a double-click.
- **Log** (added): the two file names, the state (`Logging` / `Stopped`), and the last 200 lines of each
  file, read-only. Configuration stays in `Options > Log Output...`.

### 2.7 Dialogs and the Help panel

- Dialogs are in-window layers with a title bar, built from one `Dialog` component. Modal dialogs
  dim the workspace and trap the focus; modeless ones (Find, Replace, Assembler Options, Log Output, the
  simulator's Find) float above the workspace at a fixed anchor and do not block it.
- A message box is a modal dialog with the original's title, text, icon class and buttons. The dialog
  service (3.12.4) returns the button pressed.
- While a modal dialog opened from **Simulator mode** is open, the program does not execute: the run
  controller is held (4.4.5). The original's program stands still in the same way, inside the dialog's
  message loop, and a program's log or timing can depend on it. Modeless dialogs and the dialogs of
  Editor mode do not hold it. The dialogs a **program** causes - the task 58 file dialog and the
  message boxes the engine opens (`Current Log Stopped.` and the others of 4.4.4) - stop it through the
  engine's own wait states. No command can be given while a modal dialog is open (2.9.1), except by
  the dialog's own code (its Help button and F1, 3.12.2; erratum W1 11.4).
- Dialog ids (3.12.4): `asm.status`, `options.assembler`, `options.editor`, `find`, `replace`,
  `about.editor`, `about.sim`, `sim.find`, `sim.logOutput`, `sim.logFileExists`, `sim.autoTrace`,
  `sim.fullscreen`, `sim.font`, `sim.speed`, `file.open`, `file.save`, `sim.fileDialog`,
  `settings.transfer`, `message`, and `print.range` (Print: All / Selection, asked only while the
  document has a selection; erratum E6 6). The features added four more (erratum Q1 4):
  `documents.drafts` (the drafts found at start-up, 3.9.4), `files.name` (a name asked by the Files
  panel), `sim.printerOutput` (the output of task 10, 3.3.1) and `easybin.about` (Help > About
  EASyBIN, which has its own texts; erratum B1 5). The running application's list
  (`dialogComponents`) is the authority; the accessibility audit fails when a registered dialog has
  no route in it.
- The **Help panel** shows the original pages in a sandboxed `iframe` (no scripts), with the original
  contents tree (`contents.hhc`) as a collapsible list and a text filter over page titles. In the
  desktop app `Help` opens the same view in a separate window.

> **Corrected (erratum H1 9).** The help frame is `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"` and the panel attaches nothing to the frame's document (WebKit refuses event listeners in a frame without scripts). A link navigates the frame by itself; the panel notices the load and records a history entry, so Back and Forward work. Escape while the page itself has the focus does not close the drawer; it does from the toolbar, the tree and the filter.

> **Corrected (erratum H1 8).** `sim.help.context` (F1 in Simulator mode) opens `BasicOperation.htm`, or, while the focus is in the Memory, Stack, Hardware, Break Points or Log panel, `Memory.htm`, `Stack.htm`, `Hardware.htm`, `AdvBreakpoints.htm` or `SimOptions.htm` (note 10: the page that was meant).

### 2.8 Visual design tokens

File: `app/src/styles/tokens.css` (owner W2). Tokens are CSS custom properties on `:root`; the dark
values apply under `:root[data-theme="dark"]`. `data-theme` is `light`, `dark`, or follows
`prefers-color-scheme` when the setting is `system` (default).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--c-bg` | `#F3F4F6` | `#111418` | window background |
| `--c-surface` | `#FFFFFF` | `#1B1F24` | panels, dialogs, fields |
| `--c-panel` | `#F9FAFB` | `#22272E` | toolbars, headers, status bar |
| `--c-border` | `#D1D5DB` | `#373E47` | separators |
| `--c-border-strong` | `#818B98` | `#6E7781` | field borders (erratum W2 1: the first values failed 3:1) |
| `--c-text` | `#111827` | `#E6EDF3` | text |
| `--c-text-muted` | `#4B5563` | `#9DA7B3` | secondary text, disabled captions use 60% of it |
| `--c-accent` | `#0B63CE` | `#58A6FF` | focus, active tab, changed registers |
| `--c-on-accent` | `#FFFFFF` | `#0D1117` | text on accent |
| `--c-selection` | `#BFDBFE` | `#1F4B7F` | selected listing row, editor selection |
| `--c-danger` | `#B42318` | `#FF7B72` | errors |
| `--c-warning` | `#B54708` | `#E3B341` | warnings |
| `--c-ok` | `#067647` | `#56D364` | success |
| `--c-logging` | `#FFEB3B` | `#FFEB3B` | `LOGGING` label background (text `#000000`) |
| `--c-bp-on` / `--c-bp-off` | `#D92D20` / `#12B76A` | same | gutter dots |
| `--c-stack-reg` / `--c-stack-sp` | `#00FFFF` / `#FFFF00` | same, with `#000000` text | stack marks |
| `--font-ui` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | | interface text |
| `--font-mono` | `"Courier New", Courier, "Liberation Mono", "DejaVu Sans Mono", monospace` | | registers, listing, memory, stack, messages |
| `--fs-xs`, `--fs-sm`, `--fs-md`, `--fs-lg` | `11px`, `12px`, `13px`, `15px` | | type scale; body = `--fs-md`, line height 1.4 |
| `--sp-1` .. `--sp-6` | `4px`, `8px`, `12px`, `16px`, `20px`, `24px` | | spacing scale (4 px grid) |
| `--r-sm`, `--r-md` | `3px`, `6px` | | corner radius |
| `--h-menubar`, `--h-toolbar`, `--h-control`, `--h-status` | `28px`, `36px`, `28px`, `22px` | | fixed heights |
| `--focus-ring` | `2px solid var(--c-accent)` with 1 px offset | | keyboard focus, never removed |
| `--z-panel`, `--z-modeless`, `--z-modal`, `--z-menu`, `--z-toast` | `1`, `20`, `30`, `40`, `50` | | stacking |

Rules:

- Plain CSS only: `tokens.css`, `base.css`, `components.css`, and one `.css` file next to each
  component. Class names are `e68-<component>__<part>`. No CSS-in-JS, no utility framework.
- Contrast: text on its background at least 4.5:1, interface graphics at least 3:1, in both themes.
- The **Output surface** is not themed: its colours are the program's.
- **Editor syntax colours.** With the `Auto` preset: light theme = the original defaults of
  editor-ui §9.2 on `#FFFFFF`; dark theme = Code `#E6EDF3`, Comment `#6CB6FF`, Directive `#6BC46D`,
  Label `#D2A8FF`, Macro/Other `#D4B24C`, Structured `#FF938A`, Structure Error `#FF5F56`, Text `#56D4DD`
  on `#1B1F24`. With `Color1`, `Color2`, `No Color`, `Custom` or `Disabled` the stored colours and the
  stored background are used unchanged in both themes.
- Icons: one SVG sprite `app/src/ui/components/icons.svg`, 16 px, drawn for the port, `currentColor`.
  The help folder's `Tool*.GIF` images are the visual reference for the meaning of each button.

> **Corrected (erratum E3 10).** The light `Auto` syntax colours are the original's (`#808000` Macro/Other, `#FF0000` Structure Error on `#FFFFFF`) although they are below 4.5:1: the rule specific to the editor's syntax colours decides over the general contrast rule. An automated contrast scan excludes the syntax-colour samples and marks (`[data-element]`, `.e68-syntax__*`) with this as the reason; a student who needs more contrast picks the dark theme or a stored preset.

> **Corrected (erratum W2 2).** Tokens derived from the table, in `tokens.css` under "Derived colours" and covered by the contrast test: `--c-text-disabled` (`--c-text-muted` at 60 %), `--c-hover` and `--c-pressed` (`--c-text` at 7 % / 13 % light, 8 % / 11 % dark), `--c-accent-soft` (a selected item of a list without the focus), `--c-bp-on-edge` and `--c-bp-off-edge` (`#B42318`, `#067647` light; `#FF7B72`, `#12B76A` dark: a 1-1.5 px outline that lets the gutter dots, whose fills keep the original's colours, meet 3:1; erratum W2 3), `--c-logging-text` and `--c-stack-text` (`#000000`), `--c-backdrop`, `--shadow-popup`, `--shadow-dialog`, `--focus-offset` (`1px`), `--focus-ring-inset` and `--focus-offset-inset` (erratum W2 25), `--lh-body` (`1.4`), `--motion-fast` and `--motion-normal` (`90ms`, `160ms`; `0s` under `prefers-reduced-motion`). Tool-tips use `--z-toast` (erratum W2 9). `components.css` holds the classes several components share (field frame, pop-up surface, access-key underline, screen-reader-only text, separators, icons; erratum W2 8).

### 2.9 Keyboard

#### 2.9.1 One dispatcher

`app/src/commands/keymap.ts` installs one `keydown` listener on `window` in the capture phase. For every
event it builds a normalised chord (`Ctrl+Shift+F9`, `Cmd+O`):

- function keys, digits and punctuation from `KeyboardEvent.code`;
- a letter from `KeyboardEvent.key` when that is a single ASCII letter, which follows the user's keyboard
  layout (Ctrl+Z is the key labelled Z on AZERTY and QWERTZ keyboards too);
- a letter from `KeyboardEvent.code` (`KeyA` .. `KeyZ`) when `key` is not an ASCII letter (AltGr on
  Windows changes `key`; Cyrillic and Greek layouts have no ASCII letters), and on macOS whenever
  `altKey` is set (Option changes `key`). Such chords follow the key's position (rule K6; erratum
  W3 24);
- a key of the numeric keypad from `key` when that names a navigation key (NumLock off); keypad
  digits and operators form no chord (erratum W3 21).

The chord is resolved in this order:

1. A modal dialog is open: only the dialog's keys (Enter, Esc, Tab, its mnemonics) and text editing.
   `CommandRegistry.run` does nothing while a modal dialog is open (3.12.2), whatever asked for the
   command: a key, a toolbar, or the native menu of the desktop app. The open dialog's own code may
   run a command with `{ allowInModal: true }` (erratum W1 11.4).
2. The Output panel has the keyboard (2.10): the rules of 2.9.4 and nothing else.
3. A command of the current mode bound to the chord and enabled: run it, `preventDefault()`.
4. A command of the current mode bound to the chord but disabled: `preventDefault()` and do nothing
   (the browser must not act on F5, Ctrl+S and the like).
5. Otherwise the event continues to the focused element (editor, field, grid).

Three refinements (errata W3 1, 2, 25):

- The platform's text-editing chords (Ctrl/Cmd+Z, X, C, V, A, Shift+Cmd+Z, Shift+Insert) are left to a
  focused text field or editor.
- A chord of the list of 2.9.3 (F5, F6, F7, F10, Ctrl+O/S/P/F/G/R and their Cmd forms) is cancelled
  with `preventDefault()` in every mode, bound or not, and also in steps 1 and 5.
- Step 4 has one exception: Insert, Ctrl+Shift+. and Ctrl+Shift+, (commands of the editor, enabled
  only while it has the focus) reach a text field that has the focus.

In the desktop app the page's dispatcher is the only thing that acts on a command chord. The native
menu shows the shortcuts but does not act on them (7.6).

> **Corrected (erratum W3 5).** Details of the dispatcher (W3): the three chords of the Output panel (Alt+Enter, Shift+Insert / Cmd+V, Ctrl+Alt+O) are never acted on by the dispatcher (`OUTPUT_PANEL_COMMANDS`); the panel acts on them through `outputPanelKeyAction()` (rules 1-4 of 2.9.4). The element that takes keys for a program carries `data-e68-keys="program"`, and while it is the target the dispatcher does nothing (erratum W3 6). While the target is in the menu bar or an open menu no command runs; Alt+letter that no command uses opens the menu with that access key on Windows and Linux (erratum W3 7). Of two commands on one chord (F1: `ed.help.context`, then `ed.help.help`) the first enabled one in the key table runs, so an editor command reports itself enabled only while the editor has the focus (erratum W3 8). An element marked `data-e68-own-keys="F1"` keeps the chords it lists while the focus is inside it (erratum W3 37). On the macOS key map the dispatcher performs Ctrl+Z, Ctrl+Option+Z, Ctrl+X, C, V and A itself in a plain text field, with the shell's own undo history (`TextFieldHistory`), in every mode and in modal dialogs (errata W3 34, 36).

#### 2.9.2 Chord table

The complete table is `app/src/commands/tables/keys.ts` (owner W3), generated from the parity matrix.
Per command it holds `win` (Windows and Linux), `mac`, and `desktopOnly` chords, and a flag
`notInOutput` for the port's own additions (rules K3 and K5). The rules of 1.3 are applied there, not in
feature code. The unit tests of the table use key and code pairs recorded from real keyboards (for
example `key: 'ø', code: 'KeyO'` for Option+O on a Mac), never synthetic events with plain letters.

> **Corrected (erratum W3 9).** The key and code pairs of `commands/key-fixtures.ts` (macOS Option layer with dead keys, Windows AltGr, QWERTZ, AZERTY, Russian, Greek, the keypad) were not captured on a keyboard; they come from the published layouts. Recording them is `docs/requests/W3-key-recording.md`, and step A6 of `docs/MANUAL-TEST-MAC.md` asks a person to do it.

#### 2.9.3 Keys that cannot be had

| Key | Problem | Decision |
|---|---|---|
| Ctrl+F4 (Windows, Linux browsers) | closes the tab, cannot be intercepted | Log Start = Shift+F4; outside the Output panel Ctrl+F4 only in the desktop app; in the Output panel a Ctrl+F4 that arrives is Log Start (2.9.4; erratum W3 3) |
| Ctrl+Tab | switches browser tabs | `F2`; Ctrl+Tab only in the desktop app |
| Ctrl+N, Ctrl+T, Ctrl+W, Cmd+N, Cmd+T, Cmd+W, Cmd+Q | reserved by browsers | not used by the original; Cmd+N, Cmd+W and Cmd+Q are bound in the desktop app only |
| Ctrl+F2 .. Ctrl+F8 (macOS) | system focus shortcuts unless the user has switched them off | Shift+F2 .. Shift+F5 (K3); Ctrl+F9 is free and works |
| F11, F12 | browser full screen, developer tools | not used by the original; a program that reads them with task 19 may not receive them in a browser |
| F5, F6, F7, F10, Ctrl+O/S/P/F/G/R | browser defaults that a page may cancel | the dispatcher calls `preventDefault()`. Automated tests assert that it does (`defaultPrevented`); whether each real browser then keeps quiet is checked by hand per browser (6.8), because test automation does not pass through the browser's own shortcut handling |
| Function keys on Apple keyboards | act as media keys without Fn | K4; documented |
| Insert (Apple keyboards) | does not exist | status-bar click or Ctrl+Shift+I; paste is Cmd+V |
| Alt+letter menu mnemonics | Chrome and Firefox use some for their own menus | best effort (note 14) |
| Cmd+R in browsers on macOS | reload; interception is not dependable | Find And Replace on macOS = Ctrl+R; Cmd+R in the desktop app only |
| Esc while the output is full screen (Safari, Firefox) | the browser leaves full screen and keeps the key | 2.5; listed as a difference |

#### 2.9.4 Keys while the Output panel has the keyboard

The Output panel stands for the original's I/O window, and a 68000 program can observe every key that
reaches it (task 19, tasks 2, 4, 5 and 18, the key interrupts of task 62). The rule is therefore the
original's: **the program gets every key the original I/O window gets, in the same order relative to
the simulator's own key commands.** The original's order is (trap15-a §3.9, `simIOu.cpp:417-449`):
menu shortcuts are taken by the framework before the window sees the key; every other key-down is first
recorded (key table, last-key code, key-down interrupt) and only then examined for the window's own
three commands.

The panel takes keys through a hidden, focused `<textarea>` inside the panel. For each `keydown`, in
this order:

1. **Keyboard release.** `Ctrl+Alt+O` (macOS `Ctrl+Option+O`, matched by key position) runs
   `sim.output.releaseKeyboard`: the focus moves to the next visible panel of the cycle of 1.3.5, as
   Ctrl+Tab does in the original. Nothing is delivered to the program. It works in every state,
   including after task 24, so that a keyboard-only user is never trapped. It is the one chord the port
   takes away from programs and is listed in `docs/DIFFERENCES.md`.
2. **Menu shortcuts, in the original's spelling only.** While key commands are enabled (the default;
   `engine.state().keyCommandsDisabled` is false): F6, F7, F8, F9, F10, Ctrl+O, Ctrl+F2, Ctrl+F3,
   Ctrl+F9, Ctrl+F4, Ctrl+F5 (the eleven commands task 24 can switch off), Ctrl+F and Ctrl+G; on macOS
   also Cmd+O, Cmd+F and Cmd+G. The command runs if it is enabled; the key-down is **not** delivered to
   the program, whether or not the command is enabled (the unverified detail about disabled commands is
   O-4 in section 10). After task 24 with `D1.L = 1` only Ctrl+F and Ctrl+G (Cmd+F, Cmd+G) are still
   taken; the eleven go to the program.
3. **Plain Tab and Shift+Tab** produce no key-down and no character for the program (the original's
   framework swallows them). The event is cancelled so that the focus stays in the panel.
4. **Every other key** is posted to the program as a key-down (3.6), with its character if it has one.
   This includes F1 (the original's I/O window has no F1 handler, sim-ui §3.4), F2, F3, F4, F5, Esc,
   every Shift+F<n>, and the three keys below. Then, only if key commands are enabled, the panel acts on
   the I/O window's own three commands:
   - **Alt+Enter** (macOS Option+Return): toggle full screen (2.5).
   - **The paste chord** - Shift+Insert on Windows and Linux; Cmd+V on macOS, where no Insert key
     exists: paste the clipboard as typed input (3.6). Ctrl+V on Windows and Linux is not a paste
     chord: the original delivers it to the program as the character `$16`, and so does the port.
   - **Ctrl+Tab** (desktop app only; a browser never delivers it): next panel.

   `Alt+Enter` and `Ctrl+Tab` act also with further modifiers held (the original tests with
   `Shift.Contains`); `Shift+Insert` is exact, because a browser pastes only on its own chord
   (`docs/DIFFERENCES.md`; erratum W3 29).

   After task 24 none of the three acts; the keys are delivered and nothing else happens.

Every `keyup` is posted to the program, also for Tab and for a key whose key-down ran a menu shortcut:
the original's framework takes only the key-down.

Which events are cancelled (`preventDefault()`):

- cancelled: every key-down handled by rules 1 to 3, and every key-down of rule 4 that is not listed
  in the next item. This stops scrolling, focus movement, browser shortcuts and the macOS
  press-and-hold accent menu, and it is what lets held keys repeat for games;
- **not** cancelled: a key-down whose `key` is `Dead`, `Process` or `Unidentified`, a key-down during
  composition (`isComposing`, or `keyCode` 229 for Safari), and the paste chord while key commands are
  enabled. The browser then composes text or fires `paste` into the textarea, and the panel takes the
  text from there (3.6). This is what makes dead keys (`é` on a US-International or Mac keyboard),
  input methods and paste work.

What the port offers in the Output panel beyond the original is therefore only the release chord.
Panel cycling with F2, the mode switch with F4 and the Shift+F<n> alternatives are available in every
other panel and after `Ctrl+Alt+O`; every command is also on the toolbar and in the menu.

> **Corrected (erratum W3 4).** After task 24 the chords of `sim.help.context` (F1) and `sim.panel.next` are ignored in Simulator mode too, like the eleven of sim-ui §3.5 (`ALSO_IGNORED_AFTER_TASK_24`); menus show no shortcut for them, and the commands still run from the mouse, as in the original.

> **Corrected (erratum SH4 7).** Also not cancelled: a key-down whose `key` is text of several characters and not a key name (a dead key followed by a letter it does not combine with); it is handled like a dead key.

### 2.10 Focus rules

| Event | Focus goes to | Source |
|---|---|---|
| Run, Run To Cursor (command) | Output panel, if it is visible (it always is) | sim-ui §9.3 |
| Step Over, Trace Into, Auto Trace | unchanged | sim-ui §9.5-§9.7 |
| A keyboard-input task starts (tasks 2, 4, 5, 18): engine calls `host.ioShow()` | Output panel; in Editor mode a toast `The program is waiting for keyboard input` with a button that switches to Simulator mode | trap15-a §3.9 |
| Text output while the Output panel is collapsed | the panel expands; focus unchanged | trap15-a §3.1 |
| Execution stops in trace mode with no input pending: engine calls `host.focusMain()` | Listing panel | sim-ui §9.2 step 9 |
| Input completes while tracing | Listing panel | trap15-a §3.9 |
| Halt after a Run | unchanged (stays on the Output panel) | sim-ui §9.12 |
| Output panel gains the focus | key table cleared (`engine.ioActivated()`) | trap15-a §3.9 |
| Output panel loses the focus | nothing is delivered to the program: held keys stay down for task 19 until the next activation clears the table, as in the original | trap15-a task 19 |
| Pointer cancelled by the browser | a captured left mouse button is released for the program; push buttons of the Hardware panel are released | hardware §9.2 item 8 |
| View > panel | that panel | 2.3 |
| F2; in the Output panel Ctrl+Alt+O; in the desktop app also Ctrl+Tab | next visible panel in the order of 1.3.5 | sim-ui §3.4 |
| Dialog closes | the element that had the focus before it opened | - |

> **Corrected (erratum W3 38).** Before focusing a panel's element the shell sends it `e68-panel-focus` (`PANEL_FOCUS_EVENT`, not bubbling, cancelable); an element that cancels it has focused itself (the editor does, to keep its caret).

> **Corrected (erratum SH8 19).** The two "show the Output panel" hooks: `SessionUi.showOutput()` for text output (the panel expands, the focus stays) and `SessionUi.inputStarted()` for `host.ioShow()` (the panel takes the focus; a toast in Editor mode); `ioBringToFront` (Run) focuses the panel in Simulator mode only.

### 2.11 Accessibility basics

- Every command is reachable from the menu bar with the keyboard (arrow keys, Enter, Esc; the menu bar
  is a `menubar` with `menu` and `menuitem`, `menuitemcheckbox`, `menuitemradio` roles).
- Toolbars are `toolbar` elements with one tab stop and arrow-key movement; every button has an
  accessible name equal to its tool-tip (the hint and its shortcut, `Open File (Ctrl+O)`, as
  `resolveToolbar` makes it; a disabled button may give its reason instead; erratum Q1 1).
- Panels are `region` landmarks named by their title, except those shown as tool tabs, which are the
  `tabpanel`s of a `tablist` (erratum Q1 2).
- Dialogs are `dialog` elements with `aria-modal` where modal, a labelled title, focus trapped inside
  and returned afterwards.
- The message areas (editor and simulator) are `log` live regions with polite announcements; a halt and
  `Current Log Stopped.` are announced.
- Register, memory and stack values are text, not pictures; each register field has a label.
- The Output canvas has `role="img"` and a label; the text mirror next to it (2.5) is a polite live
  region throttled to two updates per second.
- Focus is always visible (`--focus-ring`). Nothing depends on colour alone: breakpoints also differ in
  shape (`*` filled; the instruction dot `o` is drawn at most half opaque inside its edge, erratum
  Q1 3), errors carry the word `ERROR`.
- `prefers-reduced-motion`: no interface animation; the Memory cursor does not blink. The input prompt
  of a running program keeps blinking because it is program output.
- Checked with an automated scan (6.6) and the manual list of 6.8.

> **Corrected (erratum W2 6).** "Dialogs are `dialog` elements" means elements with the dialog role: `Dialog` renders a `div` with `role="dialog"` (`alertdialog` for message boxes), `aria-modal`, `aria-labelledby` and its own focus trap, not the HTML `<dialog>` with `showModal()`, whose top layer would cover the menus, lists and tool-tips a dialog opens.

> **Corrected (erratum W2 13).** A modal dialog moves the focus on every Tab and Shift+Tab itself, through its own list of controls, wrapping at the ends; controls that refuse the focus (disabled, also through a `<fieldset disabled>`, `visibility: hidden`) are skipped, a container that hands its focus to a child counts as that child's place, a focus pulled back after the control was disabled goes to its next neighbour, and Escape, Enter and access keys pressed with the focus on the page body go to the top-most modal dialog (errata W2 13, 14). So every control of a dialog is reachable with Tab in every browser, Safari included.

> **Corrected (erratum W2 10).** Tab and Shift+Tab in an open menu of the menu bar close it and move on from the menu bar in document order, as from the bar's own title (`Menu`'s `onClose` may return true for the reason `tab`; a context menu does not). Only the selected tab carries `aria-controls` (the panels of other tabs are not rendered; erratum W2 11).

> **Corrected (erratum U1 6).** The simulator's message list renders only the rows on screen, so it is a plain `list`, and a separate visually hidden `role="log"` region with `aria-live="polite"` receives the new lines.

---

## 3. Module architecture

The declarations of this section were copied into `app/src/contracts/` by W1, which is the authority
from then on. The changes made there after wave zero are listed, with proposed texts for this
section, in `docs/porting/errata/W1.md` (entries 4 and 10 to 14; 11.4 lists them section by
section); the declarations below are not updated with every one of them.

### 3.1 Layers

```
ui/ (React components)  ->  features/ (commands, panels, dialogs per feature)
        |                          |
        v                          v
state/ + commands/ (store, registry, keymap)      platform/ (web | desktop bridge)
        |                          |
        v                          v
core/ (framework-free logic: documents, settings, sim-host, run, listing, highlight, ...)
        |
        v
contracts/ (types only)   <-   engine/ (wrappers around asm68k.mjs, sim68k.mjs)   <-   fs/ (backends)
```

Dependency rules, enforced by the local ESLint rule `easy68k/layer-imports` in `eslint.config.js`
(with `no-restricted-globals` / `no-restricted-properties`), written by W0 (erratum W0 2):

- `contracts/` imports nothing.
- `core/` imports `contracts/` and `@codemirror/state` (for the text type) only. No React, no DOM
  globals, no `window`, `document`, `navigator`, `performance`, `Date.now()` or timers except through
  the injected `Clock` and `Scheduler` (3.11.1).
- `engine/` imports `contracts/`; it loads the engine modules by URL at run time (`loader.ts`;
  erratum W4 4).
- `fs/` imports `contracts/` and `core/paths`, `core/codec`.
- `features/<x>/` imports `contracts/`, `core/`, `state/`, `commands/`, `ui/components/`, and other
  features only through `AppContext` services (3.12.3), never by path. `features/editor/` also imports
  `ui/editor/` (the editor component is its user interface; erratum E2 1), and `features/files/**` and
  `features/files-fsaccess/**` may import `fs/**` (gate W0).
- `ui/shell/` imports features only through `features/index.ts`.

Runtime dependencies (closed list). Web application: `react`, `react-dom`, `@codemirror/state`,
`@codemirror/view`, `@codemirror/commands`, `@codemirror/search` (its search cursor only), and, for the stage of additions (`docs/ARCHITECTURE-PLUS.md` P2.4), `flexlayout-react` (the movable panels) and `@codemirror/merge` (the comparison of Earlier Versions, loaded on demand). Desktop main
process, in addition to Electron itself: `serialport` (3.3.4). Anything else needs a change to this
document. Development dependencies are listed in 7.1.

**Classes, their interfaces, and their stubs.** Several packages of the same wave build classes that
use each other (`Surface`, `TextScreen`, `OutputDevice`, `OutputKeyboard`, `SoundDevice`,
`HardwareModel`, `ListingView`, `LogService`, `ProgramFiles`, `PrinterDevice`, `SoftTimer`, the clocks),
and the composition root must construct all of them from the first day. Two things make that possible:

1. W1 declares the public members of every class named in this section as an interface `<Name>Api` in
   `app/src/contracts/devices.ts`, together with the plain data types shown next to them (`PixelBuffer`,
   `GraphicsState`, `Rect`, `OverlayCell`, `FontSpec`, `CellMetrics`, `Glyph`, `GlyphProvider`,
   `TextState`, `HardwareView`, `HardwareActions`, `WavInfo`, `AudioBackend`, `InputEvent68k`, `Clock`,
   `Scheduler`) and the `Deps` object of each constructor. A class implements its `Api` interface;
   other packages depend on the interface only. Where this section writes a class name as a type (for
   example `surface: Surface` in a `Deps` object) read the `Api` interface.
2. W1 also creates **a stub of every such class at its final path**, with the declared constructor and
   every member doing nothing and returning the engine's default (3.3.1 lists the paths). The owning
   package replaces the body of its stub. Because the class name, the path and the constructor
   signature never change, the composition root, `app/src/features/run/session.ts` (owner SH8, wave
   1), constructs every part from its first version on - a stub where the owner has not delivered yet
   - and the running application picks up each real class the moment its owner replaces the stub.
   **No package other than SH8 edits `session.ts`**, and SH8 does not have to edit it when SH5, SH6,
   U4 or DV4 deliver in later waves.

Classes and functions in the code blocks below are declarations: they show the public members, and the
bodies are the owning package's work. All code blocks of this document were type-checked together with
TypeScript in strict mode (with `declare` added where a body is missing and with stand-ins for the
React and CodeMirror types).

### 3.2 Engine wrappers

The engines are separate packages with a plain ES-module API and no knowledge of the interface. Their
state when this document was revised:

- **Simulator**: `engine/sim/sim68k.mjs`, `engine/sim/README.md`, `engine/dist/sim68k-loader.mjs` and
  `engine/dist/sim68k.wasm` exist. The simulator declarations below mirror the module (`createSim`,
  class `Sim68k`, the `SimHost` typedef and `HOST_DEFAULTS`). The mirror was compared with the module
  mechanically: 93 host methods and 66 members of `Sim68k`, no difference in names.
- **Assembler**: `engine/asm/asm68k.mjs`, `engine/asm/README.md`, `engine/dist/asm68k-loader.mjs` and
  `engine/dist/asm68k.wasm` exist (they appeared while this document was being revised), and so do
  two native twins (`engine/asm/native`). The assembler declarations below mirror the module's
  `assemble()` function and its documented types (`AssembleOptions`, `AsmMessage`, `AsmDialog`,
  `AssembleResult`); a trial assembly through the module gave a result with exactly the fields of
  `AsmResult`.

The application never imports the engine modules directly. It imports `app/src/engine/` (owner W4),
which loads them through Vite and gives them the types of `app/src/contracts/engine.ts`.

**Authority.** For the engine boundary the engine's own module wins. `contracts/engine.ts` is a typed
mirror, kept in step by W4. Tests in `app/src/engine/` compare the method names of `Sim68k.prototype`
and the keys of `HOST_DEFAULTS` with the keys of the simulator interfaces below, and the keys of the
assembler's `DEFAULT_OPTIONS` and of an assembly result with `AsmOptions` and `AsmResult`, and fail on
any difference, so drift shows up as a failing test and never at run time. When an engine changes, W4
changes the mirror and tells the packages concerned (the table of 3.3.1 for host methods; E5 for the
assembler).

File: `app/src/contracts/engine.ts`.

```ts
export type Bytes = Uint8Array;

/* ------------------------------------------------------------------ assembler (mirror of asm68k.mjs) */

export const TabType = { Assembly: 0, Fixed: 1 } as const;
export type TabType = (typeof TabType)[keyof typeof TabType];

/** Options of one assembly. See editor-ui §11.1 and assembler §2. */
export interface AsmOptions {
  generateListing: boolean;       // "Generate List File" (decides whether the .L68 is produced)
  generateSRecord: boolean;       // "Generate S-Record"   objFlag
  constantsExpanded: boolean;     // CEXflag
  bitFieldInstructions: boolean;  // BITflag
  crossReference: boolean;        // CREflag
  macrosExpanded: boolean;        // MEXflag
  structuredExpanded: boolean;    // SEXflag
  showWarnings: boolean;          // WARflag; hidden warnings are still counted
  tabType: TabType;               // of the document being assembled (used by the listing)
  tabSize: number;                // of the document being assembled
}

/** One row of the editor's message list. */
export interface AsmMessage {
  /** lineNum of assembler §4.4: 1-based line in the file the message belongs to; 0 for the
   *  uncounted exception rows. */
  line: number;
  severity: 'warning' | 'error';
  code: number;                   // the engine's status code
  /** Without line end; starts with "ERROR: " or "WARNING: ". */
  text: string;
  /** null = the main document; otherwise the INCLUDE file name as the assembler holds it. */
  file: string | null;
  /** For an include file: the key of `files` it was read from. */
  resolvedFile: string | null;
}

/** A message box the original would have shown during the assembly. */
export interface AsmDialog { caption: string; text: string; }

export interface AsmResult {
  listing: Bytes | null;   // the .L68 file exactly as the original writes it (CR LF); null if not produced
  listingName: string;     // mainName with the extension replaced by ".L68"
  sRecord: Bytes | null;   // the .S68 file (CR LF); null if not produced
  sRecordName: string;
  messages: AsmMessage[];  // in the order the editor shows them
  errorCount: number;
  warningCount: number;
  executeEnabled: boolean; // state of the Execute button of the original's status dialog
  dialogs: AsmDialog[];    // in order
  status: number;          // the engine's own return value
  /** null normally. Otherwise the run ended abnormally - the original would have ended the whole
   *  editor process, or the instance failed - and the other fields are empty. */
  fatal: string | null;
}

export interface AsmEngine {
  /** Assembles as the original's "Assemble Source" does.
   *  mainName: name of the main source inside the file tree that `files` describes, '/' or '\'
   *    separators, e.g. "demo/prog.X68"; it must be a key of `files`. Its folder is the current
   *    directory of the assembly: INCLUDE and INCBIN names resolve against it.
   *  files: every file the program may read. The entry of mainName is the EDITOR BUFFER as
   *    encodeForAssembler() produces it (3.9.3), not the stored file. The other entries are files as
   *    stored.
   *  timestamp: local date and time for the "Created On:" line; the engine formats it.
   *  Every call runs in a fresh WebAssembly instance of the once-compiled module (assembler §1.8). */
  assemble(mainName: string, files: ReadonlyMap<string, Bytes>, options: AsmOptions,
           timestamp: Date): Promise<AsmResult>;
}

/* ------------------------------------------------------------------ simulator (mirror of sim68k.mjs) */

export const RunStatus = {
  Running: 0,      // budget used up, program still running: call run() again
  Stopped: 1,      // trace step done, breakpoint, halt, pause
  WaitInput: 2,    // tasks 2, 4, 5, 18: deliver keys with keyChar(), then run()
  WaitDelay: 3,    // task 23: report time with delayElapsed(), then run()
  WaitHost: 4,     // task 58 dialog open: fileDialogReply(), then run()
  WaitAlert: 5,    // a message box is open (host.alert): dismissAlert(), then run()
  Error: 6,        // the original's "Unexpected error in runLoop"
  Busy: -1,        // command refused because a step is suspended; nothing happened
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const Reg = {
  D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
  A0: 8, A1: 9, A2: 10, A3: 11, A4: 12, A5: 13, A6: 14,
  USP: 15, SSP: 16, PC: 17, SR: 18, A7: 19, OldPC: 20,
} as const;
export type Reg = (typeof Reg)[keyof typeof Reg];

/** The twenty register text boxes of the original main window. */
export const Box = {
  D0: 0, D1: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7,
  A0: 8, A1: 9, A2: 10, A3: 11, A4: 12, A5: 13, A6: 14,
  A7: 15, US: 16, SS: 17, PC: 18, SR: 19,
} as const;
export type Box = (typeof Box)[keyof typeof Box];

export const SimOption = {
  Exceptions: 0, BitField: 1, SimHalt: 2, ExecLogType: 3, OutputLogType: 4, LogMemFrom: 5,
  LogMemBytes: 6, DisableDisplay: 7, MemLive: 8, MainMonitor: 9, FullscreenMonitor: 10, Fullscreen: 11,
} as const;
export type SimOption = (typeof SimOption)[keyof typeof SimOption];

export const MapKind = { Rom: 0, Read: 1, Protected: 2, Invalid: 3 } as const;
export type MapKind = (typeof MapKind)[keyof typeof MapKind];
export const HwDevice = { Seg7: 0, Led: 1, Switch: 2, PushButton: 3 } as const;
export type HwDevice = (typeof HwDevice)[keyof typeof HwDevice];

/** Shift-state bits of the mouse methods (the VCL's TShiftState). */
export const ShiftBit = { Shift: 1, Alt: 2, Ctrl: 4, Left: 8, Right: 16, Middle: 32, Double: 64 } as const;
/** Bits of SimHost.repaint(). */
export const RepaintBit = { Listing: 1, Breakpoints: 2, Memory: 4, Stack: 8 } as const;
/** Modes of SimHost.fileOpen(): fopen "r+b", "rb", "w+b". */
export const FileMode = { Update: 0, Read: 1, Create: 2 } as const;
/** Arguments of SimHost.fontAssign(). */
export const FontTarget = { IoBackBuffer: 1, IoWindow: 2, Listing: 3, Headings: 4, Messages: 5, Printer: 6 } as const;
export const FontSource = { IoDialog: 101, ListingDialog: 102, PrinterDialog: 103 } as const;
/** Arguments of SimHost.printerMetric(). */
export const PrinterMetric = { RowHeight: 0, ColWidth: 1, PageHeight: 2, PageWidth: 3 } as const;

export interface SimStateFlags {
  runMode: boolean; trace: boolean; sstep: boolean; halt: boolean; inputMode: boolean;
  hardwareEnabled: boolean; autoIRQ: boolean; stopInstruction: boolean; logging: boolean;
  autoTraceTimer: boolean; menuState: number; phase: number; irq: number; alertOpen: boolean;
  pendingKey: number; keyCommandsDisabled: boolean; startPC: number; errflg: boolean;
  stepToAddr: number; runToAddr: number; autoTraceInProgress: boolean; fileDialogOpen: boolean;
}

export interface MapRow { enabled: boolean; start: number; end: number; }

export interface Registers {
  d: number[]; a: number[];          // D0-D7, A0-A6, unsigned 32-bit
  usp: number; ssp: number; a7: number; pc: number; sr: number; cycles: bigint;
}

/** State of the controls of the original hardware form, as the engine holds it. */
export interface HardwareControls {
  seg7: number; led: number; switches: number; pushButtons: number;      // the four device addresses
  map: MapRow[];                                                         // indexed by MapKind
  auto: ({ checked: boolean; timerEnabled: boolean; intervalMs: number } | null)[];   // index 1..7
  switchOn: boolean[];                                                   // picture state, index = bit
  visible: boolean;
  selectedAutoIrq: number;                                               // 1..7, 8 = the empty entry
  intervalBox: number;
}

/** One row of the Registers or Memory grid of the Break Points panel (sim-core §7.2). */
export interface BreakCondition {
  enabled?: boolean; id?: number;
  type: number;        // 0 PC/register, 1 memory address
  typeId: number;      // register: 0-7 D0-D7, 8-15 A0-A7, 16 PC; memory: the address
  op: number;          // 0 ==, 1 !=, 2 >, 3 >=, 4 <, 5 <=, 6 N/A
  value: number;
  size: number;        // 0 B, 1 W, 2 L
  readWrite?: number;  // 0 R/W, 1 Read, 2 Write, 3 N/A (memory only)
}
/** One row of the Expression Builder grid (sim-core §7.3). Tokens: 0-99 condition slot, 100 AND, 101 OR. */
export interface BreakExpression { enabled?: boolean; id?: number; count?: number; postfix: number[]; }

export type LoadKind = 'open' | 'reload' | 'drop';

/** The instance createSim() returns. Every method is synchronous and returns at once. */
export interface SimEngine {
  /* memory: direct access, bypasses the memory map and the breakpoint flags (like the Memory window) */
  readonly memory: Uint8Array;                    // live 16 MiB view; re-read the property, never cache it
  readByte(address: number): number;
  readWord(address: number): number;
  readLong(address: number): number;
  writeBytes(address: number, bytes: ArrayLike<number>): void;

  /* loading: the engine keeps the listing, applies its start address and "*[sim68k]" directives.
     load(), close(), rewind() and cmdPause() end a pending wait and finish a suspended step themselves. */
  load(s68: Bytes | null, l68?: Bytes | null, options?: { name?: string | Bytes; kind?: LoadKind }): void;
  loadData(s68: Bytes | null, name?: string | Bytes): boolean;        // File > Open Data
  close(): void;                                                      // File > Close, after the question
  rewind(): void;

  /* run control */
  cmdRun(): void;
  cmdRunToCursor(listingLine: number): void;
  cmdRunToAddress(address: number): void;
  cmdStepOver(): void;
  cmdTraceInto(): RunStatus;
  cmdPause(): void;
  cmdAutoTrace(): void;                           // switches the auto-trace timer on
  autoTraceTick(): RunStatus;                     // one tick of that timer
  /** Finishes a suspended step first, then executes at most maxInstructions NEW instructions while
   *  the program is in run mode. run(0) therefore finishes a suspended step and starts nothing. */
  run(maxInstructions?: number): RunStatus;
  readonly stepCount: number;                     // instruction steps completed, modulo 2^32

  /* ending a wait state */
  dismissAlert(): void;
  readonly delayRemaining: number;
  delayElapsed(periods: number): void;            // periods of 10 ms
  fileDialogReply(accepted: boolean, fileName?: Bytes | string): void;

  /* keyboard and mouse of the I/O window */
  keyChar(ch: number): void;                      // FormKeyPress: one 8-bit character
  keyDown(virtualKey: number): boolean;           // FormKeyDown; true = simulator key commands enabled
  keyUp(virtualKey: number): void;
  ioActivated(): void;                            // FormActivate: clears the key table of task 19
  mouseDown(x: number, y: number, shift: number): void;
  mouseUp(x: number, y: number, shift: number): void;
  mouseMove(x: number, y: number, shift: number): void;

  /* CPU state and the register boxes */
  getRegister(reg: Reg): number;
  setRegister(reg: Reg, value: number): void;     // register and its box; OLD_PC untouched
  registers(): Registers;
  boxText(box: Box): string;                      // what the box shows; refreshed when the original refreshes
  editBox(box: Box, text: string): boolean;       // the user typed in a box (sim-ui §4.4 rules inside)
  readonly cycles: bigint;
  readonly cyclesText: string;                    // the original's display text
  clearCycles(): void;
  state(): SimStateFlags;

  /* options and logging */
  setOption(option: SimOption, value: number | boolean): void;
  getOption(option: SimOption): number;
  logDialogOpened(): void;                        // the snapshot of sim-ui Q24
  startLog(timeString: string | Bytes): void;     // writes the execution-log header through host.logWrite
  stopLog(): void;

  /* hardware form: the engine holds its controls and logic (hardware §2-§4) */
  irq(level: number): boolean;                    // IRQ button; true = call run()
  hardwareReset(): boolean;
  timerTick(level: number): boolean;              // an auto-interrupt timer fired
  switchClick(n: number): void;
  pushButton(n: number, down: boolean): void;
  setDeviceAddress(device: HwDevice, address: number, options?: { commit?: boolean }): void;
  setMemoryMap(kind: MapKind, row: Partial<MapRow>): void;
  setAutoIrq(level: number, checked: boolean): void;
  selectAutoIrq(level: number): void;
  setAutoInterval(ms: number): void;
  setHardwareVisible(visible: boolean): void;     // showing zeroes the switch byte
  hardware(): HardwareControls;

  /* breakpoints */
  setBreakpoint(address: number): boolean;        // false = table of 100 full
  clearBreakpoint(address: number): void;
  clearAllBreakpoints(): void;
  breakpoints(): number[];
  setBreakCondition(index: number, condition: BreakCondition): void;      // 0-49 register, 50-99 memory
  setBreakExpression(index: number, expression: BreakExpression): boolean;
  setBreakCounts(counts: { registers?: number; addresses?: number; expressions: number }): void;

  /* listing pane */
  readonly listingLineCount: number;
  listingLine(index: number): Bytes;
  readonly listingHighlight: number;              // the engine's selected row (current instruction), -1 = none
}
```

File: `app/src/engine/index.ts` (owner W4) exports:

```ts
export function createAsmEngine(): Promise<AsmEngine>;
/** A new simulator in the state of the original program right after start-up. May be called any
 *  number of times; every call gives an independent WebAssembly instance of the once-compiled module.
 *  The host receives calls already while this function runs (3.3.2). */
export function createSimEngine(host: SimHost): Promise<SimEngine>;
/** Drops every reference the binding holds to this instance so that its 64 MiB of memory can be
 *  collected. The engine must not be used afterwards. */
export function releaseSimEngine(engine: SimEngine): void;
```

Three facts about the simulator module that the rest of this document relies on, each read from
`engine/sim/shim/` and covered by a W4 test:

1. **Start-up state needs a new instance.** The module's start-up routine runs once per instance, and
   much of what the original holds in its windows (memory-map ranges, breakpoints, key table,
   auto-interval values) is reset only there. "Process-start state" (4.7.1) is therefore
   `releaseSimEngine` followed by `createSimEngine`.
2. **The engine finishes a suspended step itself** in `load`, `close`, `rewind` and `cmdPause`. After
   those calls the controller never has to call `run()` to tidy up. `run(0)` exists for the remaining
   case (finish, start nothing).
3. **Only `irq`, `hardwareReset` and `timerTick` say that execution must start.** A key or mouse event
   armed by task 60 or 62 can also start a stopped program (trap15-b §10.1), but `keyDown`, `keyUp` and
   the mouse methods do not return that fact. The controller reads `state().runMode` after delivering
   them (4.3).

What the simulator engine does itself, so that no application package re-implements it:

| In the engine | Consequence for the application |
|---|---|
| The CPU, memory, memory map, interrupts, TRAP #15 dispatch | - |
| The line-input state machine (`textIn`, `charIn`, `FormKeyPress`), the type-ahead key, the key table of task 19, the mouse snapshots and IRQ levels | The host only forwards events (`keyChar`, `keyDown`, `keyUp`, `mouse*`, `ioActivated`) and draws what the engine asks for (`inputEcho`, `inputBackspace`, `inputPrompt`, `erasePrompt`) |
| The register boxes with the editing rules of sim-ui §4.4 and the displayed-SR rule | The Registers panel shows `boxText()` and forwards typed text with `editBox()` |
| The listing rows, the start-address and directive rules, the highlight rule, the execution-log line lookup | The Listing panel shows `listingLine()` rows and `listingHighlight`; the host supplies the two files as bytes |
| The hardware form's controls and logic (switch pictures, auto-interrupt check boxes and arming rule, memory-map boxes) | The Hardware panel is a view of `hardware()` plus memory, and forwards clicks; the host runs the timers the engine asks for (`hardwareTimer`) |
| The printer's page logic (`printChar`, margins, form feed) | The host is a page device (`printerMetric`, `printerTextOut`, `printerBeginDoc`, `printerEndDoc`) |
| The execution-log records and header, the Rewind/Reload notes and their snapshot rule | The host owns the files and the output log's contents |
| The file-task results and the eight-slot table (`SIMOPS2.CPP`). The engine's file streams are unbuffered: the host sees every read, write, seek and close of the program in program order | The host is a byte-level file device (`fileOpen` ... `fileRemove`) and models the C library's buffering itself (3.8.4) |

> **Corrected (erratum STDIO 1; architect's decision of 22 November 2026).** The last row no longer holds as written. The engine's file streams are not unbuffered: they are the streams of the Borland C run-time that is linked into the official `SIM68K.exe` (a 512-byte buffer per stream, one level counter for both directions, the run-time's flags, 47 free stream entries shared with the log files, a close that can fail and keeps its handle), because that run-time decides what a program observes where C leaves the outcome undefined (a read right after a write, a write right after a read, without a seek). The model, read in the program's machine code and measured in the official program under Wine, is `engine/sim/shim/STDIO-MODEL.md`; the implementation is `engine/sim/shim/hostfile.cpp`. The host interface is unchanged: the host is the operating system below those streams (`ReadFile`, `WriteFile`, `SetFilePointer`, `CloseHandle`, `DeleteFile`). What the host sees: a read of fewer than 512 bytes arrives as a read of 512 at the run-time's position; writes arrive when the run-time's buffer is flushed; seeks arrive as before.

Three statements of the **assembler** module that the application relies on; W4 has a test for each:

1. It emulates Windows text mode itself (CR LF and Ctrl-Z on input, CR LF on output, two bytes per
   line end in the macro temp file; toolchain §1, assembler §9.4). The application passes and receives
   raw bytes.
2. It resolves INCLUDE and INCBIN names against the supplied files without regard to letter case, with
   `\` and `/` equivalent and `..` resolved, relative to the folder of `mainName` (assembler §3.4.1).
3. Every assembly runs in a fresh instance of a module that is compiled once and cached. W4 tells the
   module where its `.wasm` file is (`initAssembler`) under Vite, Node and the desktop app's protocol.

### 3.3 Simulator host

The host is the port's replacement for the original's windows as seen from the engine: one flat object
with one method per engine import. Its methods return at once and never call the engine. Text is
bytes. Where a method "returns a value for a register", returning `undefined` leaves the register as it
is. File: `app/src/contracts/host.ts`.

```ts
import type { Bytes } from './engine';

/** Main window (original: TForm1) and clock. */
export interface HostMain {
  message(text: Bytes): void;                    // one line for the simulator message area
  messagesClear(): void;
  alert(title: Bytes, text: Bytes): void;        // modal box; the engine reports WaitAlert until dismissAlert()
  registersShown(): void;                        // scrshow(): boxText(), cyclesText, listingHighlight changed
  menuState(state: number): void;                // 0 active, 1 busy (sim-ui §3.6)
  focusMain(): void;
  autoTraceTimer(enabled: boolean): void;        // while on, call autoTraceTick() at the interval
  keyCommands(enabled: boolean): void;           // task 24, simulator reset
  optionChanged(option: number, value: number): void;   // 0 exceptions, 1 bit field
  saveSettings(): void;                          // task 32/5
  caption(text: Bytes): void;                    // name of the loaded program
  repaint(what: number): void;                   // RepaintBit combination
  memoryLivePaint(address: number): void;        // only while SimOption.MemLive is on
  fontAssign(target: number, source: number): void;     // FontTarget, FontSource
  timeCentiseconds(): number;                    // task 8
}

/** Hardware window (original: THardware). */
export interface HostHardware {
  hardwareUpdate(): void;                        // redraw digits, LEDs, switches (only while visible)
  hardwareState(hardwareEnabled: boolean, autoIRQ: boolean): void;
  hardwareTimer(level: number, enabled: boolean, intervalMs: number): void;
  hardwareShow(): void;                          // task 32/0
  hardwareControls(): void;                      // the engine changed a control: re-read hardware()
}

/** Log window (original: TLog). */
export interface HostLog {
  logWrite(data: Bytes): void;                   // execution-log bytes, CR LF line ends, header included
  logState(logging: boolean): void;              // on false: close the log files
  outputLogWrite(data: Bytes): void;             // a note for the output log, raw
}

/** Host files (original: C stdio in SIMOPS2.CPP) and the task 58 dialog. */
export interface HostFiles {
  fileOpen(name: Bytes, mode: number): number;   // FileMode; handle > 0, or 0
  fileRead(handle: number, count: number): Bytes | null;    // empty at end of file; null on error
  fileWrite(handle: number, data: Bytes): number;           // bytes written, -1 on error
  fileSeek(handle: number, offset: number, whence: number): number;   // new position, -1 on error
  fileClose(handle: number): boolean;
  fileRemove(name: Bytes): boolean;
  fileDialog(mode: number, title: Bytes, filter: Bytes, fileName: Bytes): void;   // answer with fileDialogReply()
}

/** I/O window, text (original: TsimIO; trap15-a §3-§5). */
export interface HostIoText {
  charOut(ch: number): void;
  textOut(text: Bytes): void;
  textOutCR(text: Bytes): void;
  clear(): void;
  getrc(): number | undefined;                   // (column << 8) | row, for D1.W
  gotorc(row: number, col: number): void;
  setFontProperties(color: number, style: number): void;    // task 21: D1.L, D2.L
  getCharAt(row: number, col: number): number | undefined;  // task 22, for D1.B
  scrollRect(row: number, col: number, height: number, width: number, direction: number): void;
  setWindowSize(width: number, height: number): void;       // 0,0 = keep size; always blacks the surface
  getWindowSize(): [number, number] | undefined;
  setupWindow(fullScreen: boolean): void;        // enter or leave full screen
  ioShow(): void;                                // simIO->Show()
  ioBringToFront(): void;                        // Run pressed: bring forward and give the keyboard
  inputPrompt(mode: number): void;               // prompt timer: 0 off, 1 on, 2 on starting "visible"
  erasePrompt(): void;                           // blank over the prompt cell
  inputEcho(ch: number, echo: boolean): void;    // typed character during line input
  inputBackspace(echo: boolean): void;
  doCRLF(): void;
  invalidate(): void;                            // repaint the window from the back buffer
}

/** I/O window, graphics (trap15-b §4-§7). */
export interface HostIoGraphics {
  setLineColor(color: number): void;
  setFillColor(color: number): void;
  drawPixel(x: number, y: number): void;
  getPixel(x: number, y: number): number;        // $00BBGGRR, or $FFFFFFFF outside the surface
  line(x1: number, y1: number, x2: number, y2: number): void;
  lineTo(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  rectangle(x1: number, y1: number, x2: number, y2: number): void;
  ellipse(x1: number, y1: number, x2: number, y2: number): void;
  floodFill(x: number, y: number): void;
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void;
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void;
  setDrawingMode(mode: number): void;            // task 92: 0-15 pen mode, 16/17 buffering, 18-255 table
  setPenWidth(width: number): void;
  formPaint(): void;                             // task 94
  drawText(text: Bytes, x: number, y: number): void;        // task 95
  getXY(): [number, number] | undefined;         // task 96: the window pen
}

/** Sound (trap15-b §11). undefined = leave D0 as it is. */
export interface HostSound {
  resetSounds(): void;
  playSound(fileName: Bytes): number | undefined;                     // task 70
  loadSound(fileName: Bytes, waveIndex: number): void;                // task 71
  playSoundMem(waveIndex: number): number | undefined;                // task 72
  controlSound(control: number, waveIndex: number): number | undefined;      // task 76
  playSoundDX(fileName: Bytes): number | undefined;                   // task 73
  loadSoundDX(fileName: Bytes, waveIndex: number): number | undefined;       // task 74
  playSoundMemDX(waveIndex: number): number | undefined;              // task 75
  controlSoundDX(control: number, waveIndex: number): number | undefined;    // task 77
}

/** Serial ports (trap15-a §6). */
export interface HostSerial {
  initComm(cid: number, portName: Bytes): number | undefined;         // task 40, result for D0.W
  setCommParams(cid: number, settings: number): number | undefined;   // task 41
  commRead(cid: number, count: number): Bytes | number;               // task 42: bytes, or -1 / -2 / -3
  sendComm(cid: number, data: Bytes): { result: number; sent?: number } | undefined;   // task 43
}

/** Network (trap15-b §12). Addresses are 68000 addresses; the host reads and writes engine.memory. */
export interface HostNet {
  /** Task 100. serverAddress is the 68000 address of the server string; the engine binding adds it
   *  (see the note under 3.3.4). */
  createNetClient(settings: number, server: Bytes, serverAddress?: number): number | undefined;
  createNetServer(settings: number): number | undefined;                     // task 101
  sendNet(settings: number, dataAddress: number, remoteIP: Bytes): { result: number; count?: number } | undefined;
  receiveNet(settings: number, bufferAddress: number, senderIPAddress: number): { result: number; count?: number } | undefined;
  sendPortNet(d1: number, dataAddress: number, remoteIP: Bytes): { d0: number; d1?: number } | undefined;
  receivePortNet(d1: number, bufferAddress: number, senderIPAddress: number): { d0: number; d1?: number } | undefined;
  closeNetConnection(closeIP: number): number | undefined;                   // task 104
  getLocalIP(localIPAddress: number): number | undefined;                    // task 105
  netCloseSockets(): number;                                                 // simulator reset
}

/** Printer page device (task 10). */
export interface HostPrinter {
  printerBeginDoc(): void;
  printerEndDoc(): void;
  printerMetric(which: number): number;          // PrinterMetric, in printer pixels
  printerTextOut(x: number, y: number, ch: number): void;
}

/** The object given to createSim(): every method of every part, in one flat object. */
export type SimHost = HostMain & HostHardware & HostLog & HostFiles & HostIoText & HostIoGraphics &
  HostSound & HostSerial & HostNet & HostPrinter;
```

#### 3.3.1 Composition

`app/src/core/sim-host/index.ts` (owner SH8):

```ts
export interface SimHostParts {
  main: HostMain; hardware: HostHardware; log: HostLog; files: HostFiles;
  text: HostIoText; graphics: HostIoGraphics; sound: HostSound;
  serial: HostSerial; net: HostNet; printer: HostPrinter;
}
/** Binds every method of every part into one flat object. Throws if two parts define the same name. */
export function createSimHost(parts: SimHostParts): SimHost;
```

A test checks that the keys of the composed object equal the keys of the engine's `HOST_DEFAULTS`.
The application builds the parts once, in `features/run/session.ts` (SH8), and gives the same host
object to every engine instance it creates. Tests build them from the same core modules with fake
devices.

| Part | Implementation | File (W1 creates the stub, the owner replaces its body) | Owner |
|---|---|---|---|
| `main` | `SimUiBridge` - turns callbacks into flags, store actions and controller events | `app/src/core/run/ui-bridge.ts` (no W1 stub: section 8 gives `core/run/**` to SH8, which created it; erratum W1 5) | SH8 |
| `hardware` | `HardwareModel` | `app/src/core/sim-host/hardware/model.ts` | SH7 |
| `log` | `LogService` | `app/src/core/sim-host/log/log-service.ts` | U4 |
| `files` | `ProgramFiles` | `app/src/core/sim-host/files/program-files.ts` | SH6 |
| `text`, `graphics` | `OutputDevice` - composes `TextScreen` and `Surface` | `app/src/core/sim-host/io.ts`, `text/text-screen.ts`, `surface/surface.ts` | SH3, SH1 |
| `sound` | `SoundDevice` over an `AudioBackend` | `app/src/core/sim-host/audio/sound-device.ts` | SH5 |
| `serial` | `ctx.platform.serial ?? new NullSerial()` | `app/src/core/sim-host/serial/null.ts` (W1), `serial/desktop.ts` (DV4) | W1, DV4 |
| `net` | `ctx.platform.net ?? new NullNet()` | `app/src/core/sim-host/net/null.ts` (W1), `net/desktop.ts` (DV4) | W1, DV4 |
| `printer` | `PrinterDevice` | `app/src/core/sim-host/printer.ts` | SH6 |

Devices that exist only in a browser reach the session through the context, not by import:
`ctx.devices.audio` (an `AudioBackend`, from `features/audio`) and the file and message dialogs of
`ctx.dialogs` and `ctx.fileDialogs`. Their stubs (a silent audio backend, dialogs that answer Cancel)
come from W3 (3.12.3).

`SimUiBridge.fontAssign(target, source)` forwards targets 1 and 2 to `TextScreen.fontAssign`, target 6
to `PrinterDevice.fontChanged`, and ignores 3-5 (the listing, heading and message fonts are CSS driven
by `SimSettings.listingFont`).

#### 3.3.2 Rules for every part

- **No engine calls from a host method.** A part never calls the engine from inside a host method.
  Reading `engine.memory` is allowed (it is a view, not a call). If a part needs an engine method as a
  consequence of a callback (for example `hardwareShow()` leading to `setHardwareVisible(true)`), it
  posts a request to the run controller, which calls the engine after the current engine call has
  returned (4.3).
- **Host methods arrive before the engine exists.** `createSimEngine` runs the original's start-up
  reset, which calls `clear`, `setWindowSize`, `registersShown`, `hardwareState`, `fontAssign`,
  `keyCommands` and others before it returns the engine object. No host method may therefore touch
  "the engine" at all, not even to read a value. `registersShown()` and `repaint()` only set flags; the
  controller reads `boxText()`, `cyclesText` and `listingHighlight` after the engine call that caused
  them has returned (4.6).
- **Start-up state.** Every part with state has `resetToStartup()`, which puts it into the state of
  the original program right after start, before a file is loaded. Only the cold start of 4.7.1 calls
  it. The table below says what it means for each part.
- A part holds its state in plain objects reachable from `SimSession` (3.11), so that a headless test
  can read it.
- A part that draws does so only by changing the `Surface`; a part that shows interface state does so
  only through its `subscribe` listeners, which the feature layer connects to the store.

| Part | `resetToStartup()` |
|---|---|
| `Surface` | 640x480, both buffers black, double buffering off, both pen positions (0,0), pen white, fill black, width 1, mode 4 |
| `TextScreen` | cursor at row 0, column 0; shadow array blank; text wrap off; font and colour = the Options font; prompt off |
| `OutputKeyboard` | forgets which keys it saw go down |
| `SoundDevice` | every voice stopped, **including** the task-73 voice; all slots empty; looping flags cleared; `currentWave` = -1 |
| `ProgramFiles` | `exit()` has already run (3.8.4): no handles, no current directory |
| `PrinterDevice` | no open job |
| `HardwareModel` | all seven timers off; view rebuilt from the new engine |
| `LogService` | not logging; file names empty; `Log Start` disabled |
| `DesktopSerial` | every port closed |
| `DesktopNet` | socket closed; the original's `bound` and `mode` variables back to their initial values |
| panels and store | message area empty; listing selection none; Memory panel `Live` off and From/To/Bytes empty; Break Points grids empty; full screen left |

#### 3.3.3 Hardware model

The engine holds the hardware form's controls and logic. `HardwareModel` (owner SH7) is the thin layer
between it and the panel: it remembers what `hardwareState` reported, runs the seven auto-interrupt
timers the engine asks for, builds the view, and forwards the user's actions through the controller.

```ts
// app/src/core/sim-host/hardware/model.ts
export interface HardwareView {
  controls: HardwareControls;       // engine.hardware()
  seg7Bytes: Uint8Array;            // the 8 displayed bytes: memory[seg7 + 0, 2, ... 14], leftmost first
  ledByte: number;                  // memory[led]
  buttonsEnabled: boolean;          // IRQ and Reset buttons (hardwareState)
  autoLabel: 'Automatic' | 'Automatic Enabled' | 'Automatic Disabled';
  addressConflict: { seg7: boolean; led: boolean; sw: boolean; pb: boolean };   // rule of hardware §2.6
}
export interface HardwareActions {       // called by the panel; every one goes to the controller queue
  clickSwitch(bit: number): void;                       // { kind: 'switchClick' }
  pressButton(bit: number): void;                       // { kind: 'pushButton', down: true }
  releaseButton(bit: number): void;                     // { kind: 'pushButton', down: false }
  requestIrq(level: number): void;                      // { kind: 'irq' }
  reset(): void;                                        // { kind: 'hwReset' }
  setAutoChecked(level: number, on: boolean): void;     // engine.setAutoIrq
  selectLevel(level: number): void;                     // engine.selectAutoIrq
  setAutoInterval(ms: number): void;                    // engine.setAutoInterval
  setAddress(device: HwDevice, address: number, commit: boolean): void;   // every change; commit = Enter / blur
  setMap(kind: MapKind, row: Partial<MapRow>): void;    // engine.setMemoryMap
  setVisible(visible: boolean): void;                   // engine.setHardwareVisible
}
export interface HardwareDeps {
  post: (request: ControllerRequest) => void;           // run-controller queue (4.3)
  timers: { create(onTick: () => void): SoftTimer };    // 4.5.3
  showPanel: () => void;                                // make the Hardware panel visible
}
export class HardwareModel implements HostHardware {
  constructor(deps: HardwareDeps);
  view(engine: SimEngine): HardwareView;
  readonly actions: HardwareActions;
  subscribe(listener: () => void): () => void;          // fires when the view may have changed
  resetToStartup(): void;
  /* HostHardware */
  hardwareUpdate(): void;
  hardwareState(hardwareEnabled: boolean, autoIRQ: boolean): void;
  hardwareTimer(level: number, enabled: boolean, intervalMs: number): void;   // arms SoftTimer n
  hardwareShow(): void;                                 // showPanel(), then setVisible(true) through the queue
  hardwareControls(): void;
}
```

A tick of timer `n` posts `{ kind: 'timerTick', level: n }`; the controller calls
`engine.timerTick(n)` and starts running if it returns true (4.3). The engine applies the arming rule
of hardware §3.6 and tells the model through `hardwareTimer` whenever a timer's enabled state or
interval changes. Push buttons are released on pointer cancel and when the panel loses the pointer
(hardware §9.2 item 8).

> **Corrected (erratum SH7 2).** `hardwareTimer` writes `intervalMs` and `enabled` to SoftTimer n only when they differ, and sets the interval before enabling, so a repeated report never restarts a running period (the original's TTimer does not either).

> **Corrected (erratum SH7 4).** `features/hardware` watches the panel's visibility and calls `actions.setVisible(visible)` on every change, and `setVisible(true)` once at `init` when the restored layout shows the panel; View > Hardware, the tab, task 32 and a restored layout all reach the engine the same way, and hiding the panel tells the engine, so the next show zeroes the switch byte again. A call that repeats the engine's state changes nothing.

#### 3.3.4 Serial and network

W1 provides `NullSerial` and `NullNet`, which produce the results of note 37 in 1.4 (`initComm` returns
2; `setCommParams` returns 3; `commRead` returns -3; `sendComm` returns `{ result: 3 }`;
`createNetClient` and `createNetServer` return `$276B0002`; `sendNet` returns `{ result: $276D0001 }`;
`receiveNet` returns `{ result: 0, count: 0 }`; the port variants the same in `d0`;
`closeNetConnection` and `getLocalIP` return `$276D0001`). They are what a browser gets.

DV4 provides `DesktopSerial` and `DesktopNet` behind the same interfaces. The devices live in the
Electron main process (`desktop/src/serial.ts` on the `serialport` package, `desktop/src/net.ts` on
Node's `dgram` and `net`); each application window has its own set (3.8.6). The host methods must
answer synchronously, so:

| Kind of call | How it is answered |
|---|---|
| Open, configure, send, close, name lookup, local address | a **synchronous** bridge call (`ipcRenderer.sendSync` in the preload script); the main process sets the reply when the operation has finished. The page waits meanwhile, as the original's window does during the same Winsock and Win32 calls |
| Receive (tasks 42, 103, 107) | from a buffer **in the page**, filled by events the main process pushes as data arrives. No bridge call per receive, so a polling loop costs nothing |

Behaviour that follows the original call for call (trap15-a §6, trap15-b §12):

- **Task 100 with a host name** (the string is not a dotted address): the name is looked up inside the
  bridge call. Failure returns plain `8`. On success exactly 16 bytes, the dotted address padded with
  zero bytes, are written to memory at `serverAddress`. A dotted address leaves the string untouched.
- **Task 100, TCP**: the bridge call waits for the connection in steps of 500 ms, at most 5000 ms, as
  the original's loop does; connected returns 0; an error returns `(Winsock code << 16) + 1`; after
  5000 ms it returns 0 with the connection pending and later sends retry. (Which of the two behaviours
  of trap15-b §12.2 the binary shows is item V14; the port implements the loop as written.)
- **Task 105**: needs task 100 or 101 first (`$276D0001` otherwise); writes the first non-internal
  IPv4 address of the machine as a dotted string with its terminator at `localIPAddress`.
- **Tasks 106 and 107**: the byte-swapped port of the original, on both architectures.
- **Errors**: POSIX error numbers are mapped to the Winsock numbers the original would report
  (`ECONNREFUSED` to `$274D`, `EADDRINUSE` to `$2740`, and so on; the table is in `net/desktop.ts`).
- **Serial reads** return what has arrived; the engine reports result 4 for a short read. The original
  waits up to `count + 1` ms first; the port does not wait (a timing difference, listed).
- **Serial port names**: `COM1` ... are mapped to device paths by `AppSettings.serialPortMap`, edited
  in the dialog of `features/desktop-devices`. An unmapped name fails with result 2.
- **Lifetime**: serial ports are **not** closed by Rewind, Reload, Open or Close, as in the original
  (trap15-a §6); task 40 on an open port closes it first. They are closed by the cold start and when
  the window closes. The network socket is closed at every simulator reset (`netCloseSockets`), while
  `bound` and `mode` survive resets and are cleared only by the cold start (trap15-b §12.1).

Note on `serverAddress`: the engine's import passes the server string of task 100 as a copy, without
its address, so a host cannot do the write-back above. Until the engine package passes the address
(requested in 10.3), W4's binding supplied it by reading register A2. The engine now passes it as the
third argument (`A2 & $FFFFFF`; erratum W4 8), so nothing touches the engine inside a host call.

> **Corrected (erratum DV2 8).** The device channels of the desktop app: `desktop/src/sync-ipc.ts` exports `registerDeviceHandler(channel, (sender, ...args) => reply)` and `sendDeviceEvent(webContents, channel, ...args)`; names are `<device>.<call>` (`serial.open`, `net.receive`); `request` is one `sendSync`, a channel without a handler answers `undefined`, and `sender` identifies the window, so each window has its own devices.

> **Corrected (erratum W1 8).** `NullSerial.commRead` returns -3 ("port not initialised"), which the engine turns into result 3 for task 42 (note 37); `NullNet.receivePortNet` returns `{ d0: 0, d1: 0 }`. For a CID outside 0..15 (`MAX_COMM = 16`) `NullSerial` answers 1 ("invalid CID") for tasks 40, 41 and 43 and the device result -1 for task 42, as the original's `TsimIO` checks before it touches a port (`simIOu.cpp:2072, 2129, 2306, 2351`; erratum W1 14.2, T3 F5); a real serial device must make the same check first.

#### 3.3.5 Log service

Owner U4. The engine writes the execution log's records and header and decides when the Rewind and
Reload notes are written. `LogService` owns the two files: names, the question about an existing file,
the buffers, the output log's header and contents, and writing to the `Vfs`.

```ts
// app/src/core/sim-host/log/log-service.ts
export interface LogState {
  execFileName: string;  outputFileName: string;     // editable; recomputed on every Open (5.5)
  execType: 0 | 1 | 2 | 3;  outputType: 0 | 1;        // mirrors of SimOption.ExecLogType / OutputLogType
  memFrom: number;  memBytes: number;                 // dialog fields for type 3
  logging: boolean;                                   // from logState()
  startEnabled: boolean;  stopEnabled: boolean;       // sim-ui §13.6
}
export type LogDialogValues =
  Pick<LogState, 'execFileName' | 'outputFileName' | 'execType' | 'outputType' | 'memFrom' | 'memBytes'>;
export interface LogDeps {
  vfs: Vfs;
  clock: Clock;
  scheduler: Scheduler;
  invoke: (fn: (engine: SimEngine) => void) => void;  // RunController.invoke
  /** Replace / Append / Cancel question for an existing file. */
  askFileExists: (kind: 'exec' | 'output') => Promise<'Replace' | 'Append' | 'Cancel'>;
}
export class LogService implements HostLog {
  constructor(deps: LogDeps);
  readonly state: LogState;
  subscribe(listener: () => void): () => void;
  setLogFileNames(programPath: VPath): void;          // recompute the two default names
  dialogShown(): void;                                // engine.logDialogOpened()
  applyDialog(values: LogDialogValues): void;         // OK: engine.setOption(...) for the four values
  /** Log Start: questions for existing files, open the buffers, write the output-log header, then
   *  engine.startLog(formatUsDateTime(now)). Resolves false, with logging off, on Cancel or failure. */
  start(): Promise<boolean>;
  stop(): void;                                       // Log Stop: engine.stopLog()
  /** The original's exit: stop without a message box and write everything out. */
  exit(): Promise<void>;
  outputWrite(data: Bytes): void;                     // from TextScreen; kept only while logging and outputType == 1
  flush(): Promise<void>;                             // append what is buffered to the files
  readonly unsaved: boolean;                          // bytes not yet in storage (unload guard)
  tail(kind: 'exec' | 'output', lines: number): string[];    // for the Log panel
  resetToStartup(): void;
  /* HostLog */
  logWrite(data: Bytes): void;                        // append to the execution log, unchanged
  logState(logging: boolean): void;                   // false: flush and close both files
  outputLogWrite(data: Bytes): void;                  // append to the output log, unchanged
}
```

Writing rules:

- `Replace` starts the file with `vfs.writeFile` (header only); everything after that, and everything
  in `Append` mode, goes out with `vfs.appendFile`, so the cost of a flush depends on the new bytes and
  not on the size of the file.
- `flush()` is single-flight: one write per file at a time; bytes that arrive meanwhile wait for the
  next flush. A flush is due every second while logging, but never sooner than twenty times the
  duration of the previous flush, so a slow backend cannot take more than about 5% of the time. A flush
  always follows a stop of execution, Log Stop and `exit()`.
- The Log Start command holds the run controller from the click until `start()` has resolved (the
  `Log File Options` question holds it too, 2.7), so no output can fall between the click and the
  first logged byte, however long the user and the store take (erratum U4 2).

> **Corrected (erratum U4 3).** The log service reads `ExecLogType`, `OutputLogType`, `LogMemFrom` and `LogMemBytes` through `invoke` in `setLogFileNames`, `dialogShown`, `start` and `resetToStartup`, and keeps them itself in `applyDialog` (the engine reports no change of them). A flush is due one second after the first byte not yet in storage (no timer runs while nothing is pending), or twenty times the previous flush's duration if that is longer; every stop of execution flushes (erratum U4 9). The Log panel shows the last 200 lines of the last 256 KiB written to each file since its Log Start; in Append mode the earlier contents are not read back (erratum U4 11). `LogService` also has `startFailure` and `writeError`, read through `logStartFailure(log)` and `logWriteError(log)` (erratum U4 C1).

### 3.4 Drawing surface

Owner SH1 (`app/src/core/sim-host/surface/`), except `ellipse.ts` and `widepen.ts` (SH2). The surface is
a pixel array rasterised by our own code. **No Canvas 2D drawing call is ever used for program output**
(trap15-b H1): the canvas only receives finished pixels with `putImageData`.

```ts
// app/src/core/sim-host/surface/surface.ts
export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  /** One Uint32 per pixel, value 0xFF000000 | $00BBGGRR. On little-endian hosts this is the RGBA byte
   *  order of ImageData, so the same ArrayBuffer backs the ImageData that is presented. */
  readonly data: Uint32Array;
}

export interface GraphicsState {
  penColor: number;       // resolved RGB ($00BBGGRR) after the colour rule of trap15-b §4.6
  fillColor: number;      // resolved RGB
  penWidth: number;       // 0-255 as set; drawing uses max(width, 1)
  penMode: number;        // 0-255 as set; effective operation = MODE_TABLE[penMode] (trap15-b §5.4)
  doubleBuffer: boolean;
  backPen: { x: number; y: number };     // pen position of the back buffer
  windowPen: { x: number; y: number };   // pen position of the window canvas (task 96 reads this)
}

export interface Rect { left: number; top: number; right: number; bottom: number; }  // right, bottom exclusive

/** Largest surface side the port allows (the original has no limit below 65535). */
export const MAX_SURFACE = 4096;

export class Surface {
  constructor(width: number, height: number);
  readonly back: PixelBuffer;                 // always drawn
  /** Image on screen while double buffering is on; null while it is off (the screen shows `back`). */
  readonly window: PixelBuffer | null;
  readonly state: GraphicsState;

  /* the drawing methods of HostIoGraphics, same names and arguments */
  setLineColor(color: number): void;   setFillColor(color: number): void;
  drawPixel(x: number, y: number): void;   getPixel(x: number, y: number): number;
  line(x1: number, y1: number, x2: number, y2: number): void;
  lineTo(x: number, y: number): void;   moveTo(x: number, y: number): void;   getXY(): [number, number];
  rectangle(x1: number, y1: number, x2: number, y2: number): void;
  unfilledRectangle(x1: number, y1: number, x2: number, y2: number): void;
  ellipse(x1: number, y1: number, x2: number, y2: number): void;
  unfilledEllipse(x1: number, y1: number, x2: number, y2: number): void;
  floodFill(x: number, y: number): void;
  setDrawingMode(mode: number): void;   setPenWidth(width: number): void;
  formPaint(): void;                          // window := back (task 94, mode 16, invalidate)

  /* block operations used by TextScreen */
  fillBlack(rect: Rect): void;
  copyRect(dest: Rect, source: Rect): void;   // overlapping copies behave like GDI BitBlt
  /** TextOut: opaque cell in the fill colour, glyph in fontColor, then pen := (x + extent, y).
   *  target 'both' = back buffer and (unless double buffering) window; 'window' = overlay only. */
  textOut(x: number, y: number, glyphs: readonly Glyph[], extent: number, fontColor: number,
          target: 'both' | 'window'): void;
  resize(width: number, height: number): void;   // setWindowSize: black both, backPen := windowPen
  resetToStartup(): void;                        // 3.3.2: 640x480, black, pens at (0,0), default state

  /* presentation */
  /** Region of the on-screen image changed since the last call, or null. Clears the record. */
  takeDirty(): Rect | null;
  readonly overlay: OverlayCell | null;          // prompt cell drawn over the presented image
}
export interface OverlayCell { x: number; y: number; width: number; height: number; pixels: Uint32Array; }
```

Model rules (each is a rule of trap15-b; the section is the place to read the detail):

1. **Colour** (§4.6): `resolveColor(c)`: bit 31 set -> the fixed table of system colours (index 5
   `$FFFFFF`, 8 `$000000`, 15 `$F0F0F0`, others as captured by T2, above 30 black); else bit 24 set ->
   stock palette entry `c & 0xFFFF` (20 entries listed in §4.6) or black; else `c & 0x00FFFFFF`.
2. **Raster operations** (§5.4): every pixel written by a line, a pixel, an outline, an interior or a
   flood fill is combined as `op(P, D)` on the low 24 bits, `op` being one of the 16 operations.
   `MODE_TABLE` maps mode 0-15 through the table of §5.4 and 18-255 through the exception table there
   (everything unlisted behaves as mode 1). Modes 16 and 17 switch buffering and do not change the pen
   mode. Text, clear, scroll and repaint ignore the mode.
3. **Lines, width 1** (§6.1): the formula there (nearest pixel, ties to the smaller coordinate, end
   point excluded), then the end-point pixel through the mode. Zero-length line = one pixel.
4. **Wide pens** (§6.2): band `c-a .. c+b` with `a = floor(w/2)`, `b = floor((w-1)/2)`, round caps from
   the dot table; then the end-point pixel is combined a second time (the XOR hole).
5. **Rectangles** (§6.3): cases A, B and C exactly; outline and interior each combined once.
6. **Ellipses** (§6.4): nothing if `x1+y1+x2+y2 >= 32768` after sorting; shape depends on box size only;
   SH2 owns the algorithm and its tables (acceptance in 6.5).
7. **Pixels** (§6.5): task 82 through the mode, pen width ignored; task 83 reads `back`, `$FFFFFFFF`
   outside.
8. **Flood fill** (§6.6): 4-connected, target = colour at the start pixel, painted with the fill colour
   through the mode, also when the start pixel already has the fill colour; nothing outside the surface.
9. **Two pen positions** (§5.5): the table there, row by row. Drawing uses `backPen`; `getXY` returns
   `windowPen`.
10. **Double buffering** (§5.6): mode 17, if double buffering is off, sets `doubleBuffer` and takes a
    copy of `back` as `window` (a second mode 17 changes nothing; erratum SH1 2);
    while on, drawing changes `back` only; `formPaint()`, mode 16, `invalidate()` and `resize()` copy
    `back` to `window`; mode 16 also sets `windowPen := backPen` and drops `window`.
11. **Resize** (§4.3): minimum 640x480, port maximum `MAX_SURFACE` in each direction, both buffers
    black every time, state kept, `backPen := windowPen`.
12. **Clipping**: every primitive clips to the surface; coordinates are signed 16-bit values and are
    never an error.
13. **Out-of-surface memory**: buffers are reallocated on resize; `PixelBuffer` objects are replaced
    when the size changes (otherwise the existing buffers are blackened; erratum SH1 3), so users
    re-read `surface.back` after a resize. `resize` takes the low 16 bits of each argument, treats
    (0, 0) as "keep the current size", then clamps; the message of 2.5 is its caller's (erratum SH1 9).

Presentation is the Output panel's job (SH4): once per animation frame it calls `takeDirty()` and, if
there is a region, calls `putImageData` for that region from `window ?? back`, then draws `overlay`.
Presenting once per frame instead of after every drawing call is not observable by a program (task 83
reads `back`).

> **Corrected (erratum SH2 4).** Rule 4's round caps are not the dots of the dot table: they are vertices of the pen's nib (`tables/pens.ts`); only a zero-length line fills exactly the dot. `penDot` remains the dot of a one-point ellipse and of the rectangles. When one of two equally far nib vertices lies on the x axis, the choice goes by dy > 0 (`laterOnTie` in `widepen.ts`, measured against GDI's LineTo for every direction in -40..40 at widths 2-14; erratum SH2 9).

> **Corrected (erratum SH1 10).** Where the surface's values come from (erratum SH1 10): the system colours other than 5, 8 and 15 are those Windows 10 and 11 ship with, confirmed by T2's capture; the dots of pen widths 2-255 are measured (`tables/dots.ts`: `penDot` for a zero-length line and a one-point ellipse, `rectangleDot` for a one-point rectangle; 35 widths are not symmetric, so nothing may mirror them; errata SH1 11, 14); `copyRect` leaves pixels outside the surface unchanged, as GDI does (measured). Still not measured: `floodFill` in a mode other than Copy applies the mode (trap15-b V4), and the blending of anti-aliased coverage.

### 3.5 Text screen and fonts

Owner SH3 (`app/src/core/sim-host/text/`, `app/src/core/sim-host/fonts/`, `app/src/core/sim-host/io.ts`).

#### 3.5.1 Fonts

Text pixels come from **data files only**: a table of measured cell sizes and a set of glyph atlases.
No browser font and no canvas is involved, so text is identical in every browser, in private browsing
modes that add noise to canvas read-back, and under Node.

```ts
// app/src/core/sim-host/fonts/types.ts
export interface FontSpec {
  name: string;             // as requested, e.g. "Fixedsys", "Courier New", "Lucida Sans Typerwriter"
  size: number;             // points, 0-255 (task 21 passes any byte)
  bold: boolean; italic: boolean; underline: boolean; strikeOut: boolean;   // at most one is set (trap15-a task 21)
}
export interface CellMetrics { colWidth: number; rowHeight: number; }   // TextWidth("W"), TextHeight("Xp")
export interface Glyph {
  advance: number;          // text extent of this byte in pixels
  width: number; height: number;   // width may exceed advance (italic overhang)
  coverage: Uint8Array;     // width * height values 0..255, row-major
}
export interface GlyphProvider {
  /** Resolves when the metric table and every atlas are in memory. The controller awaits it before
   *  the first load (4.7), so that task 21 can switch fonts synchronously. */
  readonly ready: Promise<void>;
  metrics(font: FontSpec): CellMetrics;
  glyph(font: FontSpec, ch: number): Glyph;      // ch = one Windows-1252 byte
}
```

Data, all produced by T2 and committed under `app/public/fonts/`:

| File | Content | Source |
|---|---|---|
| `metrics.json` | For each font name a program or the Options dialog can ask for (the seven names of task 21 exactly as the original spells them, including `Lucida Sans Typerwriter` and `Terminal`), each of the five styles (plain, bold, italic, underline, strike-out) and each size 0-255: cell width, cell height, and the **face Windows actually used** | measured on Windows 11 with `GetTextFace` and `GetTextExtentPoint32` (6.2.3). This table, not anything in the browser, decides the text grid. It contains the cases the original leaves to Windows: size 0, and the two names that Windows 11 answers with Arial, a proportional font (trap15-b §5.7) |
| `bitmap/<face>-<height>[-<style>].bin` | Atlases of the raster faces (Fixedsys, Courier) for every distinct pixel size and style Windows produces | captured from Windows; exact, two-colour |
| `scalable/<face>-<height>[-<style>].bin` | Atlases of the outline faces (Courier New, Lucida Console, Consolas, Arial) at the dialog sizes 8, 9, 10, 11, 12, 14, 16, 18 pt and at 24, 36, 48, 72 pt | rasterised once by `tools/make-font-atlases.mjs` from bundled open fonts with the same metrics or look (Liberation Mono, DejaVu Sans Mono, Inconsolata, Liberation Sans; their licences are in `tools/fonts-src/`). 8-bit coverage |

`fonts/atlas-provider.ts` implements `GlyphProvider`:

- `metrics(font)` is a table lookup. A name that is not in the table is the Options font's name (the
  original keeps the Options font for unknown font numbers).
- `glyph(font, ch)` takes the atlas of the face the table names, in the requested style, whose cell is
  nearest to the measured cell. If the cell sizes differ the glyph is resampled to the measured cell:
  by whole-number pixel repetition for raster faces when the factor is whole (which is what Windows
  does with them), by area averaging otherwise.
- For a proportional face `advance` differs per glyph. `TextScreen` still places each character at
  `colWidth * col`, as the original does; the picture is then the original's (wide cells, narrow
  letters).
- Underline and strike-out of the outline faces are drawn by the atlas tool at the positions the
  metric capture records.

What is exact and what is not: the grid (columns, rows, cursor positions, pen movement) is the measured
one for every reachable font, style and size. Glyph pixels are exact for the raster faces, which
include the default font. Glyph pixels of the outline faces are substitutes: right position, right
size, different edge pixels from Windows ClearType (10, R-5).

Task 95 control bytes (trap15-b §6.7, corrected, erratum SH3 14 from T2's measurements): only `$09 $0A $0D
$1C-$1F` take no width, and only inside a text of two or more bytes; they paint nothing, and they count
in the pen's advance except when the text also has a byte of `$80` or above. `$0C` is the font's
solid block. The opaque box is the advances of the drawn bytes plus the style overhang; the
fixed-pitch outline faces and `$7F` follow the rules of trap15-b §6.7's additions (errata SH3 25,
28, T2 section 2). The bytes Windows draws from a fallback font (`$01-$08 $0B $0E-$1B`) are empty
cells of their width in the port.

> **Corrected (erratum T2 2).** Raster atlases: GDI makes every cell from a few native sizes by whole-number pixel repetition (independent factors in x and y) and simulates the styles on the scaled glyph, so `app/public/fonts/bitmap/` holds 25 atlases (the native plain cells and the four styles at each native size, 230 KB) and `metrics.json` `raster` gives the rules and, per face, style and cell, the native atlas, `kx`, `ky` and the line rows. A styled cell is made with its style rule after the repetition (bold adds one pixel after scaling, italic shears after scaling, underline rows scale with the cell), not by repeating a styled native atlas.

> **Corrected (erratum T2 3).** Outline atlases are stored plain, bold and italic at 8-12, 14, 16, 18, 24 and 36 pt (14 MB). A request above 36 pt resamples the 36 pt atlas of the same face and style to the cell of `metrics.json`; underline and strike-out are the plain glyph plus the line `scalable/index.json` gives (`underline`, `strikeOut`: `[top, height]` in cell rows, across the advance; Windows draws the TrueType underline below the cell). The positions come from `GetOutlineTextMetrics` (erratum T2 6). Inconsolata has no italic: Consolas italic is a synthetic oblique (erratum T2 8); every glyph is fitted into Windows' cell (erratum T2 9).

> **Corrected (erratum SH3 9).** The provider (SH3): a glyph of a raster face is made from the native atlas by the rule of `metrics.json` `raster.cells` (`ruledGlyph`: bold `P(x, y) | P(x - 1, y)` with the advance one more, italic shears by `floor((h - 1) / 2) - floor(y / 2)`, underline and strike-out rows across the advance), checked against T2's 102,235 raster glyphs. The atlas files are taken from T2's lists (`raster.atlases`, `scalable/index.json`; a page cannot list a folder), names derived only for a set without lists (erratum SH3 8). "Nearest": the atlas with the same cell, else for a raster face the largest of which the cell is a whole multiple, else the smallest difference in height, then width; resampling by whole-number repetition, otherwise area averaging (erratum SH3 11). Underline and strike-out of outline faces are the plain glyph plus a full line at the listed rows, also below the cell (erratum SH3 10). Above 36 pt the 36 pt atlas is resampled; an advance as wide as the cell becomes the measured column width, other advances grow with `MulDiv(size, 96, 72)`; the proportional substitute's pen is within 2 % of Windows' (erratum SH3 26, `docs/differences/SH3.md`). A name not in the table uses `Fixedsys`'s entries (erratum SH3 12); a font with several style flags takes the last of bold, italic, underline, strike-out (erratum SH3 13).

#### 3.5.2 TextScreen

```ts
// app/src/core/sim-host/text/text-screen.ts
export interface TextState {
  row: number; col: number;             // cursor in cells
  textX: number; textY: number;         // pixel position of the cursor cell
  colWidth: number; rowHeight: number;
  textRows: number; textCols: number;   // capped at 128 x 256
  text: Uint8Array;                     // 32768 bytes, the shadow array of trap15-a §3.7
  textWrap: boolean;
  optionsFont: FontSpec; optionsFontColor: number;   // Options > Output Window Font
  font: FontSpec; fontColor: number;                 // font in use (task 21)
  promptEnabled: boolean; promptVisible: boolean;    // blink state
}
export interface TextScreenDeps {
  surface: Surface;
  glyphs: GlyphProvider;
  scheduler: Scheduler;                 // 500 ms prompt timer
  outputLog: (data: Bytes) => void;     // LogService.outputWrite; no-op unless the output log is active
  beep: () => void;
  show: () => void;                     // make the Output panel visible
}
export class TextScreen {
  constructor(deps: TextScreenDeps);
  readonly state: TextState;
  /* the text methods of HostIoText, same names */
  charOut(ch: number): void;  textOut(text: Bytes): void;  textOutCR(text: Bytes): void;  doCRLF(): void;
  clear(): void;  gotorc(row: number, col: number): void;  getrc(): number;
  getCharAt(row: number, col: number): number;
  scrollRect(row: number, col: number, height: number, width: number, dir: number): void;
  setFontProperties(color: number, style: number): void;
  inputPrompt(mode: number): void;  erasePrompt(): void;  inputEcho(ch: number, echo: boolean): void;
  inputBackspace(echo: boolean): void;
  drawText(text: Bytes, x: number, y: number): void;
  /* called by OutputDevice and by options */
  setTextSize(): void;                  // re-measure the cell and the grid
  setTextWrap(on: boolean): void;
  setOptionsFont(font: FontSpec, color: number): void;   // Options dialog OK (trap15-a §3.2)
  fontAssign(target: number, source: number): void;      // simulator reset: back to the Options font and colour
  resetToStartup(): void;
}
```

`TextScreen` is a line-by-line port of the text half of `simIOu.cpp` as specified in trap15-a §3.4-§3.8
and tasks 11, 21, 22, 25. The behaviours that are easy to get wrong and are tested by name: BS is
non-destructive; HT is `col += 5`; one scroll per `gotorc` however far down; eager wrap; stride
`textCols` for every access except `clear()`; echo during line input is not stored in `text[]`;
scroll and clear use black, text cells use the fill colour; the cursor is not moved by a size change;
`doCRLF` in the wrap branch uses the current row; in task 21 only the highest style bit counts and a
font number sets the size byte even when it is 0.

> **Corrected (erratum SH3 15).** `fontAssign(target, source)`: for target 1 or 2 with source 101, font and colour of the Options font and the cell measured again (the cursor stays); everything else is ignored. `resetToStartup()` puts the Options font back to a fresh installation's (Fixedsys 9, white), and step 4 of the cold start applies the saved one (erratum SH3 16). The text colour keeps all 32 bits and is resolved by the rule of trap15-b §4.6 when drawn, as Windows does for fonts (`ColorToRGB`; confirmed by T2's ten captured colours; erratum SH3 17). `textOut` ends with `surface.formPaint()` when double buffering is off, also for an empty text, and the output log gets one call per byte (erratum SH3 20). `TextScreenDeps.show` is called for every character (erratum SH3 3). `setWindowSize` does not call `setupWindow()` or `WindowSizeChecked()`: the Output panel lays itself out from the size every frame (erratum SH3 24). Where the original would fail and the port does not: a cell wider than the canvas wraps once, a cell higher than the canvas scrolls the pixels only, a cell of 0 is taken as 1 (erratum SH3 18).

#### 3.5.3 Prompt

The prompt timer runs on the injected `Scheduler` (500 ms). `promptTick` draws `_` or a blank at the
cursor with `surface.textOut(..., 'window')`, that is into `surface.overlay`, and moves `windowPen`
(trap15-b §5.5). It does nothing while double buffering is on. `erasePrompt` draws the blank into the
overlay even while double buffering is on. Any presentation from the back buffer (`formPaint`,
`invalidate`, a drawing call while not double buffered) clears the overlay. The two timing quirks of
trap15-a §3.8 (prompt started after a type-ahead key completed the input; not stopped by `initSim`) are
reproduced because they follow from calling the same functions in the same order.

> **Corrected (erratum SH1 8).** "A drawing call while not double buffered" is every drawing call, also one that changes no pixel: `drawPixel`, `line`, `lineTo`, the four shapes, `floodFill`, `fillBlack`, `copyRect` and `textOut(..., 'both')` clear the overlay while double buffering is off; changing state and reading do not.

### 3.6 Keyboard and mouse

Owner SH4 (`app/src/core/sim-host/input/`, `app/src/features/output/`). The engine keeps the key table
of task 19, the line-input state and the mouse snapshots; this package translates browser events into
what Windows would have delivered and posts them to the run controller, which delivers them between
instructions (4.3). Section 2.9.4 says which keys reach this package at all.

```ts
// app/src/core/sim-host/input/vk.ts
/** Windows virtual-key code for a KeyboardEvent.code, or 0. Table: trap15-b §9.1 (last paragraph).
 *  numLock decides between the digit and the navigation codes of the keypad. */
export function vkFromCode(code: string, numLock: boolean): number;

// app/src/core/sim-host/input/chars.ts
export interface KeyLike { key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; }
/** The WM_CHAR byte for a key-down, or null when Windows would send none (trap15-a §3.9):
 *  printable -> its Windows-1252 byte (null if not representable); Enter 13; Backspace 8; Esc 27;
 *  Ctrl+letter 1..26; Ctrl+Enter 10; Ctrl+Backspace 127; arrows, function keys, modifiers -> null. */
export function charFromKey(ev: KeyLike): number | null;
/** Clipboard text as the original's paste loop sees it: every line end becomes CR LF (a Windows
 *  clipboard always holds CR LF; browsers on macOS and Linux deliver LF), the text is encoded as
 *  Windows-1252 with '?' for other characters, and cut to 254 bytes (simIOu.cpp:440). */
export function pasteBytes(text: string): Bytes;

// app/src/core/sim-host/input/keyboard.ts
export type InputEvent68k =
  /** One key press as Windows delivers it: WM_KEYDOWN, then its WM_CHAR if it has one, then - only if
   *  the engine says key commands are enabled - the pasted text of a paste chord. */
  | { kind: 'keyDown'; vk: number; ch?: number; paste?: Bytes }
  | { kind: 'keyUp'; vk: number }
  | { kind: 'char'; ch: number }                 // text from a dead key or an input method
  | { kind: 'ioActivated' }
  | { kind: 'mouseDown' | 'mouseUp' | 'mouseMove'; x: number; y: number; shift: number };   // ShiftBit
export interface KeyboardDeps {
  post: (event: InputEvent68k) => void;               // run-controller queue (4.3)
  os: 'mac' | 'windows' | 'linux';
}
export class OutputKeyboard {
  constructor(deps: KeyboardDeps);
  /** Key-down of rule 4 of 2.9.4. pasteChord = the platform's paste chord with key commands enabled. */
  keydown(ev: KeyLike & { repeat: boolean; shiftKey: boolean }, pasteChord: boolean): void;
  keyup(ev: KeyLike): void;
  text(composed: string): void;                       // from the textarea: dead keys, input methods
  paste(text: string): void;                          // the textarea's paste event
  focusGained(): void;                                // posts ioActivated (the key table is cleared)
  focusLost(): void;                                  // posts nothing; forgets the keys it saw go down
  resetToStartup(): void;
}
```

**Key-down.** `keydown` posts one `keyDown` entry: `vk` from `vkFromCode(ev.code, numLock)`; `ch` from
`charFromKey(ev)` unless the event is one the panel did not cancel (2.9.4: dead key, composition, paste
chord), in which case the entry has no `ch`. Auto-repeat posts the entry again, as Windows repeats both
messages. On macOS `numLock` is always true: Mac keyboards have no NumLock, their keypad keys are
digits, and the Clear key (`code` `NumLock`) is `$90`.

**Text that does not come from a single key.** For key-downs the panel did not cancel, the browser puts
the resulting text into the textarea. The panel listens to `input` (when not composing) and
`compositionend`, takes the textarea's value, clears it, and calls `text()`, which posts one `char`
entry per character that has a Windows-1252 byte. Reading and clearing in one place makes the result
independent of the order in which browsers fire the two events.

**Paste.** For a paste chord `keydown` keeps the `keyDown` entry back. The browser then fires `paste` on
the textarea; the panel cancels it and calls `paste(text)`, which posts the entry with
`paste = pasteBytes(text)`. If no `paste` event follows (empty clipboard), the entry is posted without
it from a zero-delay timer. The controller delivers such an entry as the original's handler runs:
`engine.keyDown(vk)` first - the key is recorded and its interrupt raised - and then, if that call
returned true, every byte with `engine.keyChar()` **consecutively, with no instruction in between**.
The consequences are the original's: the character that completes the pending read ends it, and every
later character overwrites the one-slot type-ahead, so of a multi-line paste only the first line and
the last character arrive (trap15-a §3.9). The text comes from the browser's own paste event, so no
clipboard permission is involved in either delivery.

**Key-up.** `keyup` posts `keyUp`. `OutputKeyboard` remembers which keys it reported down for one
purpose: macOS sends no key-up for a key released while Cmd is held, so when the Meta key goes up it
posts `keyUp` for every non-modifier key still marked down. Windows always delivers those key-ups; this
restores them, and a game never sees a stuck key.

**Focus.** Gaining the focus posts `ioActivated`, which clears the key table as the original's window
activation does. Losing it posts nothing: the original delivers nothing either, the keys stay "down"
for task 19 until the next activation, and no key-up interrupt is raised by a click on another panel
(trap15-a task 19, §11 item 19).

**Mouse** (`input/mouse.ts`): `shift` is the state after the event, built from `MouseEvent.buttons`
(`ShiftBit.Left`, `Right`, `Middle`) and the modifier keys; `ShiftBit.Double` when `detail` is even on a
button-down; coordinates by the formula of trap15-b §8.4, not clamped while the left button is held.
The left button captures the pointer, as the original's window does; the right and middle buttons do
not. If the browser cancels a captured pointer, a `mouseUp` with no buttons is posted. Ctrl+click on
macOS is reported as a right-button event, which is what the platform delivers.

> **Corrected (erratum SH4 3).** Details (SH4): the zero-delay timer of a paste chord is the panel's (`ctx.scheduler`, `keyboard.paste('')`), and `OutputKeyboard` sends a waiting key-down itself before anything else it is told. `input/mouse.ts` exports `OutputMouse` (`down`, `up`, `move`, `cancel`, `resetToStartup`, `leftHeld`), owned by the Output feature (erratum SH4 4). A key the virtual-key table does not know (Windows/Command key, menu key, the ISO extra key, F13 and up) posts no `keyDown` and no `keyUp`, only a `char` if it types one (erratum SH4 8). Virtual keys follow the key's position (`code`); characters and Ctrl+letter follow what the key types, so on another layout task 19 reports the US key at that position (erratum SH4 9, `docs/differences/SH4.md`). For keypad keys NumLock counts as off when `key` names a navigation key (erratum SH4 11). `charFromKey` follows Windows where this list is silent: Ctrl+`@` `$00`, Ctrl+`[ \ ] ^ _` `$1B`-`$1F`, Ctrl+Space `$20`, Ctrl with a digit or punctuation nothing, Alt+key nothing, AltGr the character unless an ASCII letter or digit, Meta nothing; on macOS Option+key types its character (Option+G `$A9`), checked against `ToUnicodeEx` on Windows 11 (erratum SH4 10). Plain Tab is refused by `OutputKeyboard.keydown` too (erratum SH4 12); `pasteBytes` stops at the first NUL, as `for (i = 0; inBuf[i]; i++)` does (erratum SH4 13). A paste that reaches the panel without the chord is typed in while key commands are on and dropped after task 24 (erratum SH4 19).

### 3.7 Audio

Owner SH5. Logic in `app/src/core/sim-host/audio/` (Node-testable), device in
`app/src/features/audio/webaudio-backend.ts`.

```ts
// app/src/core/sim-host/audio/types.ts
export interface WavInfo { valid: boolean; durationMs: number; }
export function parseWav(data: Bytes): WavInfo;          // RIFF header only; PCM duration from the data chunk

export type SoundId = number;
export interface AudioBackend {
  /** Registers the bytes and starts decoding in the background. Never throws. */
  load(data: Bytes): SoundId;
  /** Starts playback now, or as soon as decoding finishes. Returns a playback handle. */
  play(sound: SoundId, loop: boolean): number;
  stop(playback: number): void;
  release(sound: SoundId): void;
  /** Called from user gestures (any run command, any key in the Output panel) to unlock audio. */
  resume(): void;
}
export interface SoundDeviceDeps {
  backend: AudioBackend;
  clock: Clock;
  readProgramFile: (name: Bytes) => Bytes | null;   // ProgramFiles.read: current directory rules of 3.8.4
  message: (text: string) => void;                  // "'<name>' not found"
}
export class SoundDevice implements HostSound {
  constructor(deps: SoundDeviceDeps);
  playSound(fileName: Bytes): number | undefined;
  loadSound(fileName: Bytes, waveIndex: number): void;
  playSoundMem(waveIndex: number): number | undefined;
  controlSound(control: number, waveIndex: number): number | undefined;
  playSoundDX(fileName: Bytes): number | undefined;
  loadSoundDX(fileName: Bytes, waveIndex: number): number | undefined;
  playSoundMemDX(waveIndex: number): number | undefined;
  controlSoundDX(control: number, waveIndex: number): number | undefined;
  resetSounds(): void;
  resetToStartup(): void;
  /** Standard player: time on the injected clock until which a new request is refused. */
  readonly busyUntil: number;
}
```

Model (trap15-b §11):

- **Standard player** (tasks 70, 71, 72, 76): 256 slots of raw bytes; one voice. `busyUntil` is a time
  on the injected clock: `now + durationMs` when a sound starts, `Infinity` for a loop, 0 after a stop.
  A request while `now < busyUntil` returns 0 and starts nothing. The flag is computed from the WAV
  header's duration, **not** from the audio device, so that the classic wait loop of
  `graphicSound.X68` ends even when audio is muted, suspended or failed (H6). A file that is not a
  valid WAV counts as duration 0. `currentWave` rules, the "D0 not written" cases (`undefined` results) and the
  result table of task 76 are the original's.
- **DirectX player** (tasks 73, 74, 75, 77): reported as available. 256 slots; any number of
  overlapping voices per slot; looping is sticky per slot until the slot is reloaded or sounds are reset
  (the recommended port behaviour of §11.4); task 77 does nothing when the slot named by `D1.B` is
  empty; the task-73 sound cannot be stopped and survives a reset.
- **Reset** (`resetSounds`): stop the standard voice, stop and release every slot of both players. The
  task-73 voice plays on, as in the original.
- **Start-up state** (`resetToStartup`, cold start only): as reset, and the task-73 voice is stopped,
  the looping flags are cleared and `currentWave` is -1 again, because the original's process has ended.
- File names resolve like program files (3.8.4). A missing file adds `'<name>' not found` to the message
  area.
- Formats: WAV through `decodeAudioData`. MIDI and DirectMusic segment files, which the original's
  DirectX player also accepts, are not supported; the load reports failure (`D0.W = 0`) with the message
  `'<name>' Error loading `.

> **Corrected (erratum SH5 2).** `parseWav` walks the chunk list (even padding, any order, unknown chunks skipped; `tick.wav` has a `LIST` chunk after `data`). Valid = `RIFF....WAVE` with a `fmt ` chunk of at least 16 bytes, a `data` chunk, channels > 0 and a sample rate > 0. Duration for PCM, IEEE float and WAVE_FORMAT_EXTENSIBLE: whole frames (`data size / blockAlign`) / sample rate; for compressed formats the `fact` chunk's frame count / sample rate, else `data size / byte rate`. A `data` size beyond the end of the file is cut to the bytes present; durations are not rounded.

> **Corrected (erratum SH5 4).** The Web Audio backend starts decoding in `load()` (tasks 71 and 74 decode ahead of play); a `play()` before the decode is done waits for it. Uncompressed WAVE data (every official sound) is converted to samples within `load()` and put into an `AudioBuffer` at once, so the sound starts within the task that asked for it (erratum SH5 4a: waiting for `decodeAudioData` made `1.wav` start late and overlap `0.wav`). `release(sound)` does not stop playbacks already started. A playback that has to wait starts late in step with the program, or not at all after `LATE_START_S` = 0.2 s; at most 64 play at once. The feature resumes audio at `pointerdown`, `keydown` and when the page becomes visible, only for a context that exists or that a playback waits for; without Web Audio the backend plays nothing and never throws.

### 3.8 File system

#### 3.8.1 Backends

File: `app/src/contracts/fs.ts`.

```ts
/** Absolute virtual path: "/<mount>/<segment>/..."; '/' separators; letter case as stored. */
export type VPath = string;

export interface FileStat { kind: 'file' | 'dir'; size: number; mtime: number; readOnly: boolean; }
export interface DirEntry { name: string; kind: 'file' | 'dir'; }
export interface BackendChange { rel: string; kind: 'write' | 'remove'; }

export interface FileSystemBackend {
  readonly mount: string;                          // "browser", "folder", "linked", "disk", "memory"
  readonly kind: 'browser' | 'fsaccess' | 'disk' | 'memory';
  readonly label: string;                          // shown in dialogs, e.g. "My Programs"
  stat(rel: string): Promise<FileStat | null>;     // rel: path inside the mount, no leading '/'
  readFile(rel: string): Promise<Bytes>;
  writeFile(rel: string, data: Bytes): Promise<void>;    // creates parent directories; replaces the file
  /** Adds bytes at the end (creating the file). Cost must depend on data.length, not on the file size,
   *  except for the `fsaccess` backends, where the browser copies the file (erratum FS2 C2). */
  appendFile(rel: string, data: Bytes): Promise<void>;
  remove(rel: string): Promise<void>;
  list(rel: string): Promise<DirEntry[]>;
  mkdirp(rel: string): Promise<void>;
  /** Changes made by someone else (another window, 3.8.6). Absent when the backend cannot know. */
  onExternalChange?(listener: (change: BackendChange) => void): () => void;
}

export interface SnapshotLimits { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxDepth: number; }
export interface DirSnapshot {
  root: VPath;
  files: Map<string, { data: Bytes; mtime: number }>;   // key: path relative to root
  skipped: { path: string; reason: 'too-large' | 'too-many' | 'too-deep' | 'unreadable' }[];
}
export interface VfsChange { path: VPath; kind: 'write' | 'remove'; origin: 'local' | 'external'; }

export interface Vfs {
  mount(backend: FileSystemBackend): void;
  unmount(mount: string): void;
  backends(): FileSystemBackend[];
  stat(path: VPath): Promise<FileStat | null>;
  readFile(path: VPath): Promise<Bytes>;
  /** writeFile, appendFile, remove and mkdirp on one path run one at a time, in call order. mkdirp
   *  (W1 11.4) is a member too. createVfs() (fs/vfs.ts) is the only implementation of Vfs; tests call it
   *  and mount a MemoryBackend, and code that needs a few members takes Pick<Vfs, ...>, so a member
   *  added later is implemented in one place and may be required (erratum W1 12.1). */
  writeFile(path: VPath, data: Bytes): Promise<void>;
  appendFile(path: VPath, data: Bytes): Promise<void>;
  remove(path: VPath): Promise<void>;
  list(path: VPath): Promise<DirEntry[]>;
  /** Windows-style lookup of `name` relative to `dir`: '\' and '/' separate, case is ignored when no
   *  exact match exists, ".." is allowed while it stays inside the mount. null = not found or refused. */
  resolve(dir: VPath, name: string): Promise<VPath | null>;
  snapshot(dir: VPath, limits: SnapshotLimits): Promise<DirSnapshot>;
  /** Every change below `prefix`: made through this Vfs ('local') or reported by a backend ('external'). */
  subscribe(prefix: VPath, listener: (change: VfsChange) => void): () => void;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits =
  { maxFiles: 2000, maxFileBytes: 32 << 20, maxTotalBytes: 256 << 20, maxDepth: 4 };

/** Synchronous access to files, for the simulator's host file calls (3.8.4). */
export interface SyncFiles {
  /** Makes the tree below `dir` available. A cached view loads it; a direct view checks access only. */
  prepare(dir: VPath): Promise<void>;
  /** Brings a cached view up to date with storage; a no-op for views that are always current. */
  revalidate(): Promise<void>;
  /** Windows-style lookup as Vfs.resolve, but for a file that need not exist yet.
   *  null = the name is malformed or leaves what the view may reach. */
  resolve(dir: VPath, name: string): VPath | null;
  stat(path: VPath): { size: number; readOnly: boolean } | null;      // null = no such file
  read(path: VPath, position: number, count: number): Bytes | null;   // short at end of file; null on error
  write(path: VPath, position: number, data: Bytes): boolean;         // a gap before position reads as zero bytes
  create(path: VPath): boolean;                                       // new empty file, or truncate
  remove(path: VPath): boolean;
  /** Resolves when every change made through this view is in storage. */
  settled(): Promise<void>;
  readonly unsettled: boolean;                                        // for the unload guard
}
```

| Backend | Mount | File | Owner | Storage | Available |
|---|---|---|---|---|---|
| Browser store | `/browser` | `app/src/fs/browser-backend.ts` | FS1 | IndexedDB database `easy68k-files`, object store `files` (key = path, value = `{data, mtime}`), with a full in-memory index loaded at start and kept current across windows (3.8.6). `appendFile` stores appended data as numbered segment records under the file's key and merges them on the next whole-file write or read, or when there are more than 256 | web and desktop |
| Opened folder | `/folder` | `app/src/fs/fsaccess-backend.ts` | FS2 | a `FileSystemDirectoryHandle` from `showDirectoryPicker()`; the handle is kept in IndexedDB so the folder can be re-opened after a reload (permission is asked again). No change events exist for it | Chromium browsers |
| Linked files | `/linked` | `app/src/fs/fsaccess-backend.ts` | FS2 | per opened single file: a folder `/linked/<id>/` in the browser store holding a copy, plus the `FileSystemFileHandle` to save back to | Chromium browsers |
| Disk | `/disk` | `app/src/fs/disk-backend.ts` | DV2 | the real file system through Electron IPC; `/disk/Users/me/x.X68` is `/Users/me/x.X68` | desktop app |
| Memory | `/memory` | `app/src/fs/memory-backend.ts` | W1 | a `Map`; tests and fakes | everywhere |

Browsers without the File System Access API (Safari, Firefox): `Open File...` offers the browser store
and `From this computer...`, which uses `<input type="file">` and imports the chosen files into
`/browser/Imported/`; `Save` writes to the browser store; `Export...` in the Files panel downloads a
file, a folder or the whole store as a `.zip` written by the port's own minimal store-only zip writer,
and `Import...` reads such a `.zip` back (`app/src/fs/zip.ts`, FS1). This is stated in the open dialog.

`Vfs` itself (`app/src/fs/vfs.ts`), the write-behind helper (`app/src/fs/write-behind.ts`: per path,
one write in flight, the newest bytes written next, the data taken when a write starts), the in-memory
`SyncFiles` for tests (`app/src/fs/sync/memory.ts`), the path rules (`app/src/core/paths/winpath.ts`)
and the codec (`app/src/core/codec/cp1252.ts`) are written by W1 in wave zero, because almost every
package needs them.

> **Corrected (erratum FS1 1).** Besides the file record `{data, mtime}` the object store `files` holds, under array keys, a head per file `["h", rel] = {size, mtime, segs}` (a file exists when its head exists), the appended segments `["s", rel, n] = {data}` (n = 1, 2, ...) and a record per folder `["d", rel] = {mtime}` (empty folders are kept). Only heads and folders are read at start, and an append reads only the head, so its cost does not depend on the file's size; every operation is one transaction, so two windows appending to one file never take the same segment number.

> **Corrected (erratum FS1 2).** Segments are merged by a whole-file write in its own transaction; a read returns the concatenation from a read-only transaction and then merges in a separate read-write transaction in the background (also after the append that makes the count exceed 256). A read never waits for a merge, a failed merge loses nothing, and a merge changes neither the modification time nor anything other windows are told.

> **Corrected (erratum FS1 4).** Every read-write transaction of the browser store is opened with `{ durability: 'strict' }`, and a write resolves on the transaction's `complete` event: an acknowledged write is on disk.

> **Corrected (erratum FS1 5).** When IndexedDB cannot be used (`indexedDB.open` throws, fails or takes longer than 20 s), `/browser` is a memory store with the same label, and the Files feature says so permanently: `Files are NOT being saved: this browser does not let the page keep files (<reason>; ...). Use the Export button of the Files panel to keep your work.` (so worded since the stage of additions, whose Files panel shows Export as a button that names what it exports: errata N10 entry 8); a store that did not answer within the 20 s (opening or reading its index) says `Files are NOT being saved right now: the browser's storage did not answer (<reason>; ...). The programs you saved before are still in the browser: reload the page in a minute to see them. ...` instead (erratum FS1 30). Start-up waits for the database at most 3 s; after that the store is mounted as pending (its operations wait for the database) with the message `My Programs is still opening: ...`. A write refused for lack of space rejects with code `io` and a message that says nothing saved before is lost. At start the backend asks for persistent storage (`navigator.storage.persist()`), best effort.

> **Corrected (erratum FS1 6).** `Export...` downloads a file as itself, a folder as `<folder>.zip` holding the folder, and the store's root as `My Programs.zip` holding the store's content at the top level, so that importing it into an empty store gives the same store.

> **Corrected (erratum FS1 7).** `Import...` offers `Files or .zip...` and `Folder...`. A `.zip` is unpacked into the selected folder, other files are copied as they are; existing files are replaced only after one question for all of them (Yes / No / Cancel). `.zip` files of other tools are read too (deflate, code page 437 names, macOS resource forks skipped), and nothing is ever written outside the target folder.

> **Corrected (erratum DV2 9).** The disk backend rejects a path outside the granted roots with code `io` and a message starting `refused:` (the synchronous view answers it like a missing file). Granted roots are compared after resolving symbolic links, so a link that points outside is refused; letter case is ignored only on Windows. The label is `This Mac` (`This Computer` elsewhere). Writes and removes through the main process are reported to the other windows; changes by other programs are not.

> **Corrected (erratum W1 8).** Behaviour W1 fixed where this section is silent: paths that differ only in letter case share one Vfs queue, and `stat` and `readFile` wait for the mutations requested before them (a failed mutation does not block the next). `Vfs.resolve` is lexical first (`..` as on Windows, also through a folder that does not exist), then each segment takes its stored spelling (exact match first); a drive letter or a leading `\` or `/` is refused. `Vfs.snapshot` walks breadth first with names sorted, so the files nearest the folder are taken first when a limit is reached; a deeper folder is listed once as `too-deep`. The backend contract (`fs/backend-contract.ts`, with a `SyncFiles` suite): `remove` of a folder removes its content, missing paths reject with `not-found`, `writeFile` below a file with `not-directory` and on a folder with `is-directory`; `SyncFiles.write` on a missing file returns false.

> **Corrected (erratum FS2 1).** The copies of linked files live in a browser store of their own, the IndexedDB database `easy68k-linked` (FS1's `BrowserBackend` with its own `BroadcastChannel` `easy68k.linked`), not in My Programs, so they appear neither in the Files panel nor in exports; `<id>` is 8 hex digits. The handles are kept in `easy68k-fsaccess`, store `handles` (`folder` = `{handle, name}`, `link:<id>` = `{id, name, handle, size, mtime}`); without IndexedDB they are kept in memory and nothing survives a reload, but the real files are written.

> **Corrected (erratum FS2 3).** On `/folder` the rule "cost must depend on `data.length`" cannot be met: through the File System Access API Chromium copies the existing data into a swap file for every writable stream (appending 1 kB: 3-4 ms on a 1 kB file, 90-125 ms on a 20 MB file). Callers batch appends there (the cached view writes at most every 500 ms per file); `FolderBackend` runs the writes of one file one after the other. What the API cannot say: folders have no modification time (`mtime: 0`), there is no read-only flag (a write to a read-only file fails with `io`; what a program can see of it is in `docs/differences/FS2.md`), swap files (`*.crswap`) are left out of `list`, and a change that keeps the size within the disk clock's resolution is not seen (erratum FS2 4). Names are passed as given; `Vfs.resolve` takes the stored spelling first, so letter case behaves alike on every system (erratum FS2 12).

> **Corrected (erratum FS2 5).** After a reload the folder is mounted at start only when `queryPermission({mode: 'readwrite'})` is `granted`; otherwise a toast `The folder "<name>" was open the last time. Open it again?` with `Open folder` asks inside the click. `requestPermission` is never called without a user activation. One folder at a time: another folder replaces `/folder` only when no open document and no loaded program comes from it, otherwise `Only one folder can be open at a time. Close what is open from "<name>" first (...), then open the other folder.` (erratum FS2 7). In the desktop app the feature does nothing (erratum FS2 10).

#### 3.8.2 The program's directory

Every document and every loaded program has a **program directory**: the `VPath` of the folder that
contains it. It is what the original calls the current directory (editor-ui §10.2, trap15-a §7.1).

| Where the file lives | Program directory | Outputs (`.L68`, `.S68`, logs, files a program creates) |
|---|---|---|
| Browser store, `/browser/demo/prog.X68` | `/browser/demo` | same folder, visible in the Files panel |
| Opened folder, `/folder/prog.X68` | `/folder` (and its sub-folders) | the real folder |
| Linked single file | `/linked/<id>` (browser store) | that browser-store folder; the Files panel offers `Export`. `Save` writes the document to the real file and to the copy. A banner offers `Open the containing folder...` to get real-folder behaviour |
| Disk, `/disk/Users/me/demo/prog.X68` | `/disk/Users/me/demo` | the real folder |
| Never-saved document `untitledN.x68` | `/browser/Untitled` (web), `/disk/<userData>/Untitled` (desktop) | that folder, as the original uses whatever the current directory is |

> **Corrected (erratum FS2 2).** The linked backend ties only `<id>/<name>` to the real file; every other path of `/linked` is the copy store. `stat` reports the real file while read access is granted; `readFile` reads the real file and refreshes the copy (asking for read and write at once in a user activation); `writeFile` asks for write access and refuses with `io` when the real file's size or time differ from what this window saw (`"<name>" has been changed by another program since this window last read it, so it was not saved. ...`); a real file that is gone is reported, never re-created; `remove` forgets the link and never deletes the real file. The banner is a toast with `Open the containing folder...`, which reopens the unmodified documents of the file from `/folder/...` when the chosen folder holds it (erratum FS2 6).

#### 3.8.3 How the assembler sees files

`features/assemble/collect.ts` (owner E5) builds the arguments of `AsmEngine.assemble`. The file tree
they describe is the mount of the document: `mainName` is the document's path inside its mount
(`demo/prog.X68` for `/browser/demo/prog.X68`) and every key of `files` is a path in the same mount,
so that `..` in an INCLUDE name works as far as the mount reaches. The entry of `mainName` is the
editor buffer, not the stored file.

1. Scan the main text and, transitively, every text file found, for `INCLUDE` and `INCBIN` lines with
   the operand rules of assembler §3.4.1 (quoted name keeps its case, unquoted runs to the first space).
   The scan is deliberately loose (any line whose mnemonic field is one of the two words, any case).
2. Resolve each name with `vfs.resolve(programDir, name)` and add found files.
3. Assemble. If any message is `ERROR: Unable to access specified file` and the complete snapshot has
   not been supplied yet, take `vfs.snapshot(programDir, DEFAULT_SNAPSHOT_LIMITS)`, add everything, and
   assemble once more; the second result is the result. (This covers names built by macros.)

Names with a drive letter or a leading `\` or `/` are not resolved; the assembler then reports
`Unable to access specified file`, which is what the original reports for a path that does not exist.

> **Corrected (erratum FS1 13).** Names that differ only in letter case are the same name wherever an entry is created: Rename refuses such a name (except a change of case of the entry itself), Import and drops count a file in another spelling as existing and write to the stored spelling, and two items of one import whose names differ only in case are a conflict. Without this a `.zip` exported to Windows could hold names that collide.

> **Corrected (erratum E5 7).** The snapshot retry assembles once more only when the snapshot added at least one file (every assembly runs in a fresh instance, so the same files give the same result). Include names drop trailing dots and spaces of every component and empty components, as Win32 does, before `Vfs.resolve` applies `.` and `..` (erratum E5 12).

#### 3.8.4 How the simulator sees files

The engine asks the host for files through synchronous calls (`fileOpen`, `fileRead`, `fileWrite`,
`fileSeek`, `fileClose`, `fileRemove`), with the name exactly as the 68000 program gave it, and other
host parts (sound) need whole files synchronously. In the original each of these calls goes to the
disk **at that moment**: a file copied into the folder, or saved from the editor, a second before
Rewind and Run is there. The port keeps that property. `ProgramFiles` (owner SH6) is built in two
layers.

**Layer 1 - where the bytes are: a `SyncFiles` view, chosen by the mount of the program.**

| Mount | View | File, owner | How it stays current |
|---|---|---|---|
| `/disk` (desktop) | `DiskSyncFiles`: every call is a synchronous bridge call to the main process, which performs it on the real file. Nothing is cached | `app/src/fs/sync/disk.ts`, DV2 | it is the disk |
| `/browser`, `/linked` | `CachedSyncFiles`: `prepare(dir)` loads the tree below `dir` into memory (`DEFAULT_SNAPSHOT_LIMITS`); calls act on that copy; every change is written through to the `Vfs` with the write-behind helper, at most every 500 ms per file while it keeps changing and at once when a handle closes, when execution stops and at exit | `app/src/fs/sync/cached.ts`, SH6 | it subscribes to `vfs.subscribe(dir)`: a save in the editor, an import in the Files panel, and a change made in another window (3.8.6) replace the cached bytes at once |
| `/folder` (File System Access) | `CachedSyncFiles` as above | same | no change events exist, so `revalidate()` lists the tree and re-reads every file whose size or modification time changed. The controller calls it when the view may be stale - the window has had the focus elsewhere since the last check - at the next simulator reset and before the next run command from the idle state |
| `/memory` | `MemorySyncFiles` | `app/src/fs/sync/memory.ts`, W1 | tests |

What a view may reach: the browser store and an opened folder as far as the mount goes; on disk only
the **granted roots** of 7.6 (the folder of the program, of files and folders the user chose in a
dialog, and their sub-folders). A name that leaves that area does not resolve, and the program gets the
result the original gives for a missing file. In a cached view, files beyond the limits are not in
memory; each is listed once in the message area as `Not available to the program: <path> (<reason>)`,
and opening one fails.

**Layer 2 - what the program observes: the C library's files.** The original opens these files with
`fopen` and the Borland run-time library buffers them. The engine passes the program's operations to
the host unbuffered and in order (3.2), so `ProgramFiles` models the stream itself:

> **Corrected (erratum STDIO 1; architect's decision of 22 November 2026).** The sentence above reads now: the engine has the run-time's streams (`engine/sim/shim/STDIO-MODEL.md`) and uses the host as the operating system below them; `ProgramFiles` is that operating system, and its pending bytes carry the bytes a stream's flush would write to the end of the process. `ProgramFiles` itself is unchanged. The engine relies on two of its properties: a write of 512 bytes or fewer stays pending until the next call on the handle, and pending bytes are written at `exit()` / `exitNow()`; through them the bytes of a stream the program never closed reach the file when the original's process would write them (STDIO-MODEL.md section 10). `STDIO_BUFFER = 512` is the size measured in the official program under Wine (erratum SH6 12); `tests/conformance/windows-confirm/stdio-buffer.X68` repeats the measurement on Windows. What remains different for a program is recorded in `docs/differences/SH6.md` ("The stream's buffer memory").

```ts
// app/src/core/sim-host/files/program-files.ts
export const STDIO_BUFFER = 512;                   // bytes; Borland BUFSIZ, to be confirmed (O-15)

export interface ProgramFilesDeps {
  viewFor: (dir: VPath) => SyncFiles;              // by mount, table above
  message: (text: string) => void;                 // simulator message area
  /** Opens the task 58 dialog; resolves to the chosen path or null. */
  showFileDialog: (mode: number, title: string, filter: string, initialName: string) => Promise<VPath | null>;
  post: (request: ControllerRequest) => void;      // to answer with { kind: 'fileDialogReply' }
  /** Small synchronous store for bytes that must survive an abrupt page close (localStorage). */
  journal: { write(text: string | null): void; read(): string | null };
}
export class ProgramFiles implements HostFiles {
  constructor(deps: ProgramFilesDeps);
  /** The directory relative names resolve against (the original's current directory). */
  readonly currentDir: VPath | null;
  setCurrentDir(dir: VPath): Promise<void>;        // prepares the view of dir
  /** Whole file for other host parts (sound). Same name rules as fileOpen; sees committed bytes. */
  read(name: Bytes): Bytes | null;
  markStale(): void;                               // the window had the focus elsewhere
  revalidateIfStale(): Promise<void>;
  /** The original's process exit: commit the pending bytes of every stream, open or abandoned, in the
   *  order the streams were opened, close them all, and wait until storage has everything. */
  exit(): Promise<void>;
  /** Synchronous part of exit() for an abrupt page close: commit what can be committed and write the
   *  rest to the journal. recoverJournal() applies it at the next start. */
  exitNow(): void;
  recoverJournal(): Promise<void>;
  readonly unsaved: boolean;                       // pending bytes, or changes not yet in storage
  resetToStartup(): void;
  /* HostFiles */
  fileOpen(name: Bytes, mode: number): number;
  fileRead(handle: number, count: number): Bytes | null;
  fileWrite(handle: number, data: Bytes): number;
  fileSeek(handle: number, offset: number, whence: number): number;
  fileClose(handle: number): boolean;
  fileRemove(name: Bytes): boolean;
  fileDialog(mode: number, title: Bytes, filter: Bytes, fileName: Bytes): void;
}
```

Rules:

- **Names** (trap15-a §7.1, §11 item 14): decoded as Windows-1252; `\` and `/` both separate; relative
  names resolve against `currentDir`; letter case is ignored when no exact match exists; `..` is
  allowed inside what the view may reach; a name with a drive letter does not resolve. An absolute name
  is accepted when it is a path the port itself handed out (task 58): a `VPath`, or in the desktop app
  a real path such as `/Users/me/demo/data.txt`.
- **Current directory** (trap15-a §7.1, trap15-b §11.2): set to the program's folder by every load
  except Reload, which keeps it; moved by `Open Data` to the data file's folder and by a task 58 dialog
  closed with OK to the chosen file's folder, because the original's file dialogs change the process's
  current directory. Sound file names resolve against it too.
- **Modes**: `Update` needs an existing, writable file; `Read` needs an existing file; `Create`
  creates the file or truncates it at once. A file the view reports as read-only cannot be opened with
  `Update` or `Create`, so the engine's own fallback yields result 3 for task 51, as on Windows.
- **Streams**: handles are positive integers, never reused. Each stream has its own position. The same
  file may be open in several streams.
- **Write buffering.** Bytes written through a stream are **pending** until they are committed to the
  view. Pending bytes are committed when the stream is closed (task 56, task 50), when it is
  repositioned (task 55), before a read through the same stream, and when the 512-byte buffer is full
  **and another byte comes** (corrected, erratum SH6 12, from T3's measurement of the original, T3.md
  F2 and F8): byte by byte nothing is visible after 512 bytes, 512 after the 513th; a write that fits
  into what is left of the buffer is copied into it even when it fills it exactly; a write that does
  not fit commits the buffer first and then goes to the file whole when it is 512 bytes or more, or
  into the buffer when it is smaller. Until then no other stream and no other host part sees them. This reproduces what the original's help warns about: data a program has written and not
  closed is not in the file yet when the program, or anything else, looks at the file again. A program
  that forgets task 56 fails in the port as it fails on EASy68K, and not only when it is graded.
- **Reads** see the committed bytes at the moment of the call, except that a reading stream buffers
  what it reads, 512 bytes at a time, and keeps returning those bytes after another stream changed
  them; a seek, or a write through the same stream, empties that buffer (erratum SH6 12; a read of
  512 bytes or more keeps its last 512-byte block, not measured on the original yet). `fileRead` returns an empty array at the
  end of the file. A seek past the end is allowed; a later write fills the gap with zero bytes.
- **Simulator reset.** The engine forgets its eight slots on every reset without closing them
  (trap15-a §7.1 lifetime quirk), so the host never hears of it: the streams stay open as **abandoned**
  streams, keep their pending bytes, and keep their files in use, exactly as the forgotten `FILE`
  objects of the original do until the simulator exits. Task 57 on such a file fails; a new run that
  opens it sees it without the pending bytes.
- **Remove** fails while the file is open in any stream, open or abandoned (Windows behaviour).
- **Exit.** The pending bytes reach the files when the original's process would end: at a cold start
  (4.7.1), when the application quits and when the window or tab closes. `exit()` is the orderly form.
  A tab can also be closed without notice; `exitNow()` runs in `pagehide`: in the desktop app it
  commits everything synchronously, in a browser it commits to the cached view, starts the writes and
  puts the bytes storage does not have yet - at most a few kilobytes of pending data - into the
  journal, which `recoverJournal()` applies at the next start. While `unsaved` is true the page also
  asks the browser for its "leave site?" prompt (`Platform.confirmBeforeUnload`).
- **Task 58**: `fileDialog` opens the `sim.fileDialog` dialog through `showFileDialog`. On OK the view
  of the chosen file's folder is prepared, the current directory moves there, and the reply
  `{ kind: 'fileDialogReply', accepted: true, path }` is posted with the path as bytes; on Cancel
  `accepted: false`. In Save mode the path may name a file that does not exist yet; the program creates
  it with task 52. The path the program receives is the port's own: `/browser/demo/data.txt` in a
  browser, the real path in the desktop app; it is cut to 255 bytes by the engine as the original cuts
  it. The original's two defects in the Save branch (trap15-a task 58) concern which dialog's file name
  is used; they are not reproduced. The engine's `shim/simio.cpp` copied both until gate I2, when W4
  removed them (erratum W4 15, `engine/sim/PATCHES.md` section 5); the host passes on what the engine
  gives (erratum SH6 E2, which still describes the state before that repair).
- The `.S68` and `.L68` of the program are read by the run controller and given to `engine.load` as
  bytes (4.7); they do not pass through these calls.

What is modelled and what is assumed: that written data stays invisible until close or until the
buffer fills, and that a reset abandons streams, is in the original's source and help. The buffer size,
whether a large write bypasses the buffer, and whether a reading stream keeps stale bytes in its own
buffer are properties of the Borland run-time library that the source does not show. T3 measured all
three on the official program under Wine with `stdio-buffer.X68` and `a59-files-buffer-edges`
(erratum SH6 12: 512 bytes, large writes go to the file whole, reads are buffered), and the port
follows that measurement; Windows itself confirms it once (6.8, Part C of the manual list).

`PrinterDevice` (same owner) is the page device for task 10:

```ts
// app/src/core/sim-host/printer.ts
export interface PrintedChar { x: number; y: number; ch: number; }          // printer pixels, one byte
export interface PrintJob { font: { name: string; size: number }; chars: PrintedChar[]; }
export interface PrinterDeps {
  font: () => { name: string; size: number };      // SimSettings.printerFont
  submit: (job: PrintJob) => void;                 // to the Printer Output dialog and Platform.print
}
export class PrinterDevice implements HostPrinter {
  constructor(deps: PrinterDeps);
  fontChanged(): void;                             // Options > Printer Font, or a simulator reset
  resetToStartup(): void;                          // an open job is submitted as it stands
  printerBeginDoc(): void;
  printerEndDoc(): void;
  printerMetric(which: number): number;
  printerTextOut(x: number, y: number, ch: number): void;
}
```

The engine keeps the original's page logic; the device answers `printerMetric` for a virtual page of
8.5 x 11 inches at 600 pixels per inch (page 5100 x 6600; cell width and row height from the Printer
Font setting: `round(size * 600 / 72 * 0.6)` and `round(size * 600 / 72 * 1.13)`), collects the
characters of `printerTextOut` between `printerBeginDoc` and `printerEndDoc`, and on `printerEndDoc`
submits one print job. Jobs are listed in a `Printer Output` dialog until printed (`Platform.print`) or
discarded.

> **Corrected (erratum SH6 1).** A cached view reaches the folders it was asked to `prepare()` and everything below them (to `maxDepth`), not the whole mount: the program's folder at every load, the data file's folder at Open Data, the chosen file's folder at task 58 OK. A name that leaves the prepared folders (`../other/data.txt`) gets the result of a missing file (`docs/differences/SH6.md`).

> **Corrected (erratum SH6 2).** The limits message names the reason in words (`too large`, `too many files`, `too deep`, `unreadable`) and `<path>` is the VPath. It is written from a timer, because the engine's load empties the message area after the folder was prepared. A file beyond the limits cannot be opened, created or removed.

> **Corrected (erratum SH6 3).** A write to storage that fails is reported once per file in the message area, `A file of the program could not be saved: <path> (<reason>)`; the view keeps the change and writes the whole file again at the next `settled()`.

> **Corrected (erratum SH6 4).** A change arms one 500 ms timer per file (so the first write of a quiet file also waits 500 ms); `settled()` starts every pending write at once. "When a handle closes" is `fileClose()` calling `view.settled()`, which writes every changed file of the view. A change that only adds bytes at the end is sent as `appendFile`; anything else rewrites the file.

> **Corrected (erratum SH6 5).** A change reported by the Vfs replaces the cached bytes unless the program changed the file after the change was reported and before its bytes were read; then the program's bytes win and the next write replaces the whole file (never an append onto the other version). Nothing is merged. Every change by others to a cached file is read whole (the `Vfs` has no ranged read; `docs/requests/SH6-append-change.md`), and a whole-file read returns one cached copy until the file changes.

> **Corrected (erratum SH6 6).** The journal is one `localStorage` text per origin (`easy68k.sim.journal.v1`) holding every window's part under a random instance id: `{"v":1,"parts":{"<id>":{"entries":[...]}}}`. An entry says what a file must look like (`{path, remove: true}` or `{path, size, at, data}`), so applying it twice gives the same bytes; only what the view has not written yet is journalled. `recoverJournal()` applies other instances' parts and removes them. Known hazard: an entry applied after another window changed the same bytes overwrites that change.

> **Corrected (erratum SH6 7).** `exitNow()` commits the pending bytes of every stream (in the order the streams were opened) but leaves the streams open, because `pagehide` also comes to a page that enters the back-forward cache and may come back.

> **Corrected (erratum SH6 8).** Names: a character Windows refuses in file names (`< > : " | ? *`, control characters) does not resolve; trailing periods and spaces of every segment are dropped (`data.txt.` opens `data.txt`); an absolute name is accepted only for a mount the program has been given (in the desktop app, with the program's folder on `/disk`, every absolute name is a real path). Device names (`NUL`, `CON`) are ordinary names here.

> **Corrected (erratum SH6 9).** The printer's cell is computed from `SimSettings.printerFont` whenever the engine asks (at the first character of every document), so a font change takes effect at the next document; `fontChanged()` does nothing.

> **Corrected (erratum SH6 10).** The Printer Output dialog (`sim.printerOutput`, title `Printer Output`) lists the jobs neither printed nor discarded, shows the selected page as text, and has `Print...` (`Platform.print`, letter-size page, every character at its place at 600 dpi), `Discard` and `Close`. A finished job opens it modeless; `File > Printer Setup...` opens it modal.

> **Corrected (erratum DV2 9a).** On the disk, a path segment that no listing contains but that exists (a Windows 8.3 short name such as `RUNNER~1`, or a folder that may be entered but not listed) is kept as given and the walk goes on below it, so the later segments still get their stored spelling.

> **Corrected (erratum SH8 35).** `RunSession.dispose()` calls `settled()` on each cached view it made and then the view's `dispose()` (stops listening to the Vfs and the timers; writes already started go on).

> **Corrected (erratum T3 F7).** Measured under Wine and not yet reproduced (unconfirmed until it runs on Windows, 6.8): a stream that mixes reads and writes without a seek between them does something definite in the Borland run-time that the rule "pending bytes are committed before a read through the same stream" does not give. Write `ABCDE`, read 4 without a seek: the original gives D0.W = 0, D2 = 4 and leaves a file holding `A`; seek to 1, read 2, write `X`: the original's file stays `ABCDE`; a write past the end followed by a read gives 0 and a close that fails with 2 (`trap15-a/a51`-`a53`, `known-differences.json`). If Windows agrees, SH6 models the Borland stream state for these cases (erratum SH6, questions for T3 item 10).

#### 3.8.5 File dialogs

`features/files/dialogs.ts` (owner FS1) is the only place that opens file dialogs. The File System
Access additions (FS2) plug into it through the `FileSourceProvider` interface that FS1 defines in
`features/files/providers.ts` and exposes on the context as part of `fileDialogs`.

```ts
export interface FileFilter { label: string; patterns: string[]; }       // e.g. ["*.X68"]
export interface OpenRequest { title: string; filters: FileFilter[]; multiple: boolean; startDir?: VPath; }
export interface SaveRequest { title: string; filters: FileFilter[]; defaultExt: string; suggested?: VPath; }
export interface FileSourceProvider {
  id: string;                                               // "browser", "folder", "upload", "native"
  label: string;                                            // button or list caption
  available(): boolean;
  open?(request: OpenRequest): Promise<VPath[] | null>;
  save?(request: SaveRequest): Promise<VPath | null>;
}
export interface FileDialogs {
  open(request: OpenRequest): Promise<VPath[] | null>;      // null = cancelled
  save(request: SaveRequest): Promise<VPath | null>;        // overwrite already confirmed
  registerProvider(provider: FileSourceProvider): () => void;
}
```

Web: the port's own dialog (`file.open`, `file.save`) lists the browser store and the opened folder and
has the buttons `From this computer...` and `Open folder...`. Desktop: the native dialogs; the folder
of a chosen file becomes a granted root. The task 58 dialog (`sim.fileDialog`) uses the same service
with the program's title and filter. A file dialog opened from Simulator mode holds the program like
any modal dialog (2.7).

**Files dropped on the window** (owner FS1). Editor mode: every dropped file is opened, in the order
of the drop's file list; entries that cannot be read are skipped without a message (editor-ui §1.4).
Simulator mode: only the first dropped file is considered, and only if it is an `.S68` (sim-ui §8.4).
A dropped **folder** is never opened as a document: where the File System Access API exists it is
offered as the opened folder (`Open this folder?`), in the desktop app it becomes the start folder of
the Open dialog, and elsewhere a toast says `Drop files, not folders. Use Import... for a folder.`

> **Corrected (erratum FS1 10).** Each opener puts its filters into the request itself (a feature cannot import another): E1, SH8 and SH6 copy the reference texts of `features/files/filters.ts` exactly, double spaces included, and task 58's `"desc|pattern|..."` strings go through `parseWindowsFilter()`. The dialog shows each label verbatim.

> **Corrected (erratum FS1 11).** A file dropped in a browser has no path the port can keep: it is copied into `/browser/Imported/` (as `From this computer...` does) and the copy is opened. A copy with the same bytes is reused; one with other bytes is replaced only after a question.

> **Corrected (erratum FS1 12).** For a name that does not exist the Open dialog shows the Windows common dialog's message: `<name>` / `File not found.` / `Check the file name and try again.`, titled with the dialog's title.

> **Corrected (erratum FS1 14).** A dropped `.S68` while a program is loaded: in a browser the `Caution` question is asked first (`RunController.confirmLoad('drop')`); on Cancel nothing is copied or loaded, on OK the file is copied (with its own replace question) and loaded with `open(copy, 'drop', { confirmed: true })`. In the desktop app the file is loaded where it lies and `open` asks.

> **Corrected (erratum FS1 15).** In the desktop app `Platform.nativeFileDialogs` is registered as the provider `native`, which replaces the port's dialogs ("From this computer..." is then not offered). A dropped file on the disk is opened where it is; a dropped folder opens the Open dialog (`Open File`, the editor's five filters) with that folder as start. A native dialog opened in Simulator mode holds the run controller while it is open, and its Save receives `defaultExt` normalised (`'*.X68'` becomes `'.X68'`).

> **Corrected (erratum FS1 16).** `FileDialogs.chooseFolder` uses the native folder dialog where there is one (`NativeFileDialogs.chooseFolder(title, startDir?)`); in a browser the port's Save dialog is shown in folder mode: it starts in `startDir`, lists only folders, its button is `OK`; OK with an empty name takes the selected (or shown) folder, a typed existing folder is taken, a new name is created, a file is refused.

> **Corrected (erratum FS1 17).** `app.files.toggle` with `{ reveal: VPath }` shows the Files panel (never hides it) and reveals the path; a panel that is not mounted gets the request when it mounts, within 5 s (`PENDING_REVEAL_MS`), and a request made in Simulator or EASyBIN mode waits for the next switch to Editor mode.

> **Corrected (erratum SH6 11).** The task 58 request: the program's title, or `Open` / `Save As` when it passes none; its filter string read as `description|patterns|...`, or `All Files (*.*)` when it passes none; Save has no default extension and no overwrite question (`overwritePrompt: null`). The program's initial name gives the Save dialog's suggested file (`initialName`) and the Open dialog's start folder (`startDir`).

> **Corrected (erratum FS2 8).** In Chromium FS2 registers a provider with the id `upload` and the caption `From this computer...` that replaces FS1's: the picked files are linked, so Save writes to them; it has no `save` (in the Save dialog `Open folder...` is the way to the computer). A dropped folder asks a message box titled with the folder's name, `Open this folder?`, Yes / No (erratum FS2 9). A newly mounted store is reported by the Vfs as a `write` of its root (errata FS2 11, W1 14.2).

#### 3.8.6 More than one window

The original lets a student start the editor and the simulator as often as they like; every Execute
starts another simulator. In the port one window holds one editor and one simulator, and **several
windows may be open at once**: browser tabs, an installed web app next to a tab, and in the desktop app
`New Window` (Cmd+N). Each window is a complete, independent instance with its own engines. They share
one origin's storage, so four rules keep them from damaging each other:

1. **Window identity.** At start a window takes a random `windowId` and holds the Web Lock
   `easy68k.window.<id>` for as long as the page lives. A lock that is no longer held means its window
   is gone, however it ended.
2. **Settings.** A page may read another page's `localStorage` write late, so re-reading before a
   write is not enough. Each changed setting carries a stamp (time, window) in the document's
   `stamps` table; every document a window reads or receives with a `storage` event (its `newValue`)
   is merged with what the window knows, setting by setting, the later stamp winning, and a window
   whose newer setting is missing from another window's write writes the merged document again,
   after a short pause and only if no other window has done so meanwhile. A document without a
   `stamps` table was written by something other than the port and replaces what the windows know
   (the rule for such documents: errata W3 entries 27, 28, 33 and 39). Subscribers are notified; the
   `editor` and `sim` settings then take effect at once, while the panel layout of a window that is
   already open stays as it is (erratum W3 26).
3. **Browser store.** After every write and remove the backend posts `{rel, kind, mtime}` on the
   `BroadcastChannel` `easy68k.files`. Other windows update their index, and their `Vfs` reports the
   change (`origin: 'external'`) to the Files panel and to a simulator's cached view. Before a document
   is saved, the stored modification time is compared with the one recorded when the document was
   loaded or last saved; if it differs, on any backend, the user is asked `'<name>' has been changed
   outside this window. Save anyway?` (Yes / No). Nothing is merged and nothing is reloaded by itself.
4. **Drafts** (3.9.4) are stored under their window's id. At start a window offers only the drafts of
   windows whose lock is free, so two open windows never offer each other's work, and the drafts of a
   crashed window are offered exactly once.

Two simulators that talk to each other over the network (the classic demo of trap15-b §12) are two
windows of the desktop app. In a browser both get the "no network" results.

> **Corrected (erratum FS1 3).** The broadcast of a change is `{rel, kind, mtime}`. A receiving window does not trust it for sizes: it re-reads the heads and folders at and below `rel` in a read-only transaction, replaces that part of its index, and then reports `{rel, kind}` through `onExternalChange`.

> **Corrected (erratum W3 33).** The rule for an outside document (a stored JSON object without a `stamps` table; the port always writes one, `{}` before any change; errata W3 27, 28, 31, 33 and 39, of which 33 states the rule and 39 completes it): each such write is one event of the shared history, and every window gives it the same stamp, the writer `outside:<FNV-1a hash of its text>#<n>` (n counts the writes of that text; the first has no `#1`) at the time the first window took it in. A window takes a write in exactly once, the first time it sees a document that differs from the last one it saw, wrote or took in (its first read, a `storage` event, or its own copy for a write made in its own page), stamps every setting that write changed and records the mark `~outside/<writer>`; when two stamp tables meet, every stamp of one outside writer moves back to the earliest time either holds. A window counts the writes of each outside text it has seen itself, so an event it already heard of is not a new write.

### 3.9 Documents

Owner E1 (`app/src/core/documents/`, `app/src/features/documents/`).

```ts
// app/src/contracts/documents.ts
export type DocKind = 'source' | 'list';
export interface DocumentState {
  id: string;
  path: VPath | null;          // null until loaded from or saved to a file
  name: string;                // file name, or "untitledN.x68"
  kind: DocKind;               // IsSource
  hasName: boolean;
  tabType: TabType;
  tabSize: number;
  fontName: string;            // as stored in the trailer; never rewritten to a substitute
  fontSize: number;
  insertMode: boolean;
  modified: boolean;
  /** Increases with every text change; lets panels detect staleness without reading the text. */
  revision: number;
}

export interface DocDefaults { fontName: string; fontSize: number; tabType: TabType; tabSize: number; }

export interface DocumentService {
  list(): DocumentState[];
  active(): DocumentState | null;
  text(id: string): string;                       // lines separated by "\n"
  newSource(): DocumentState;
  open(path: VPath): Promise<DocumentState | null>;      // editor-ui §6.2 incl. the "already open" question
  save(id: string): Promise<boolean>;             // false = cancelled or failed
  saveAs(id: string): Promise<boolean>;
  reload(id: string): Promise<void>;
  close(id: string): Promise<boolean>;            // false = cancelled
  closeAll(): Promise<boolean>;
  activate(id: string): void;
}
```

#### 3.9.1 Text in memory

The text of a document is a CodeMirror `EditorState` (from `@codemirror/state`, which has no DOM
dependency) with `"\n"` as the line separator. One `EditorState` per document lives in
`core/documents/registry.ts`; the editor component (E2) attaches a view to it. Characters are Unicode
code points that are images of Windows-1252 bytes (5.1).

#### 3.9.2 Loading

```ts
// app/src/core/documents/format.ts
export interface LoadedSource { text: string; tabType: TabType; tabSize: number; fontName: string; fontSize: number; }
export function decodeFile(bytes: Bytes): string;                      // Windows-1252; CR LF, lone LF and lone CR each end a line
export function stripTrailer(text: string, defaults: DocDefaults): LoadedSource;   // editor-ui §6.3 step 4
export function encodeFile(doc: DocumentState, text: string): Bytes;   // editor-ui §6.4: text, then SaveFont
export function encodeForAssembler(text: string): Bytes;               // every "\n" as CR LF; a final line break only if the text ends with one (the RichEdit's plain-text save; erratum E1 1)
```

`stripTrailer`, exactly: split the text into lines; if the text ends with a line break, the empty piece
after it is not a line. Let `count` be the number of lines. Examine the lines with 0-based index
`count-1` down to `count-4`. A line that starts with `*~Tab size~`, `*~Tab type~`, `*~Font size~` or
`*~Font name~` supplies its value by the character rules of editor-ui §6.3 and is removed together with
its own line break. Other lines stay. Each of the four is tested independently.

#### 3.9.3 Saving

`encodeFile`: the text with every `"\n"` written as CR LF (a line break after the last line only if the
text ends with one). For a source document whose extension is `.X68` in any letter case, append
CR LF, `*~Font name~<name>~` CR LF, `*~Font size~<size>~` CR LF, `*~Tab type~<0|1>~` CR LF,
`*~Tab size~<n>~` CR LF. Consequence, kept on purpose: each open-and-save cycle adds one empty line
before the trailer, as in the original (editor-ui §6.4); the files are then byte-identical to what the
original writes after the same steps.

Characters that have no Windows-1252 byte (typed or pasted) are written as `?`. The editor marks such
characters as they are typed (wavy underline, hover text `Not in Windows-1252: saved as ?`), and Save
asks once per document: `This file contains N characters that EASy68K cannot store. They will be saved
as "?".` with OK and Cancel.

`DocumentService` records the file's modification time when a document is loaded and after every save.
Before it writes, it compares that with the stored one and, if they differ, asks the question of 3.8.6
(the file was changed by another window or another program). The original overwrites without looking;
with several windows on one store that would lose work silently.

#### 3.9.4 Local drafts

`features/documents/drafts.ts`: two seconds after the last change, and when the page is hidden, the
text and `DocumentState` of every modified document are written to the IndexedDB store `drafts`, under
the id of the window that holds the document (3.8.6). A draft is removed on save, on close with No, and
on close with Yes. At start a window looks for drafts of windows that no longer exist (their lock is
free) and offers them: `Unsaved changes from your last session were found for <names>.` with `Restore`
and `Discard`. Drafts of windows that are still open are left alone. Drafts never touch the document's
real file. (The original's own option *Auto Save Modified Source Before Assembling* is separate and
behaves as in the original.)

> **Corrected (erratum E1 13).** The drafts database is `easy68k.drafts` (version 1, key path `key` = `<windowId>/<docId>`), separate from the browser store; a record holds the `DocumentState`, the text, the file's recorded modification time and the tab order. The offer runs under the Web Lock `easy68k.drafts.offer`; without `navigator.locks.query` nothing is offered. A draft goes as soon as its document is no longer modified or no longer open. While an owner of drafts still looks alive the starting window asks the lock list again every 100 ms for at most 3 s (`DRAFTS_GONE_POLL_MS`, `DRAFTS_GONE_GRACE_MS`), because a crashed window's lock can stay listed for a moment (erratum E1 19).

### 3.10 Settings

File: `app/src/contracts/settings.ts`. The store is `SettingsService`
(`app/src/core/settings/service.ts`, owner W3): `get()`, `update(patch)`, `subscribe()`, persisted as
one JSON document under the `localStorage` key `easy68k.settings.v1` (both deliveries; in the desktop
app `localStorage` belongs to the app's own origin and lives in the user-data folder). Unknown keys are
kept; missing keys take defaults; a stored value that the contract does not allow for its key is
treated as missing (erratum W3 23); a version field allows migration. `update()` reads the stored
document again, applies the change and writes it; because a page may read another page's write
late, each changed setting carries a stamp in the document's `stamps` table and every document a
window reads or receives with a `storage` event is merged with what it knows, setting by setting,
the later stamp winning (3.8.6 rule 2), so several windows share one set of settings without
overwriting each other (erratum W3 26).

```ts
export interface SyntaxStyle { color: number; bold: boolean; italic: boolean; underline: boolean; }  // color = COLORREF
export type SyntaxElement = 'code' | 'unknown' | 'directive' | 'comment' | 'label' | 'structure' | 'error' | 'text';

export interface EditorSettings {              // defaults = editor-ui §11.4 "Default when the file is missing"
  generateList: boolean; generateSRecord: boolean; saveThenAssemble: boolean; showWarnings: boolean;
  crossReference: boolean; macrosExpanded: boolean; structuredExpanded: boolean; constantsExpanded: boolean;
  fontName: string; fontSize: number; tabType: TabType; fixedTabSize: number;
  autoIndent: boolean; realTabs: boolean; assembleBitField: boolean;
  styles: Record<SyntaxElement, SyntaxStyle>;
  highlightDisabled: boolean; printBlack: boolean; backgroundColor: number;
  colorPreset: -1 | 0 | 1 | 2 | 3 | 4 | 5;     // 0 Color1, 1 Color2, 2 No Color, 3 Custom, 4 Disabled, 5 Auto (port; default)
  template: string;                            // template.NEW text; default = shipped template, editor-ui §12.2
  lineNumbers: boolean;                        // port; default true
}

export interface SimSettings {                 // defaults = sim-ui §14.3
  execLogType: 0 | 1 | 2 | 3; outputLogType: 0 | 1;
  exceptions: boolean; bitField: boolean;
  memoryAddress: number; whichStack: number;   // 0..8, default 8
  seg7Address: number; ledAddress: number; switchAddress: number; buttonAddress: number;
  outputFont: { name: string; size: number }; listingFont: { name: string; size: number };
  printerFont: { name: string; size: number };
  autoTraceIntervalMs: number; disableDisplay: boolean;
  speed: { mode: 'original' | 'max' | 'custom'; instructionsPerSecond: number };   // port; 4.5
  highlightChangedRegisters: boolean;          // port; default true
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  layout: {
    panels: Record<string, { visible: boolean }>;        // key = panel id (2.4)
    splits: Record<string, number>;                      // key = splitter id, value = fraction 0..1
    editorPanes: 'one' | 'horizontal' | 'vertical';
    outputZoom: 'fit' | 1 | 2;
  };
  serialPortMap: Record<string, string>;                 // desktop: "COM4" -> device path (3.3.4)
}

export interface Settings { version: 1; editor: EditorSettings; sim: SimSettings; app: AppSettings; }

export interface SettingsService {
  get(): Settings;
  update(change: (current: Settings) => Settings): void;     // persists and notifies
  subscribe(listener: () => void): () => void;
}
```

What is **not** persisted is the original's list (sim-ui §14.2): last opened file, log file names, the
log memory range, breakpoints, Output size, text wrap, the Memory panel's `Live` box and From/To/Bytes.

Reading the original's files (owner E4, `app/src/core/settings/dat-codec/`):

```ts
export function parseSettingsDat(bytes: Bytes): Partial<EditorSettings>;   // editor-ui §11.4, positional rule
export function writeSettingsDat(settings: EditorSettings): Bytes;         // 57 lines, CR LF, v5.16.01 header
export function parseSim68KDat(bytes: Bytes): Partial<SimSettings> & { panels: Record<string, boolean> };
export function writeSim68KDat(settings: SimSettings, panels: Record<string, boolean>): Bytes;   // 37 lines; raw bytes on lines 2, 3, 34
```

The dialog `settings.transfer` (command `Import/Export Settings...` at the end of the Options menu of
Editor and Simulator mode, 1.5) imports and exports `settings.dat`, `sim68K.dat` and `template.NEW`. Import keeps
the positional reader's behaviour (a missing line puts all later lines back to defaults). Window
positions are ignored on import and written as the original's defaults on export; the `Auto` preset is
exported as `-1` with the Color1 values.

> **Corrected (erratum SH7 3).** The Hardware panel writes `seg7Address`, `ledAddress`, `switchAddress` and `buttonAddress` into `SimSettings` on every change the user makes to a device address (the port's settings are written at once, not at Exit); the cold start reads them.

> **Corrected (erratum W1 8).** Defaults W1 chose where this section gives none: theme `system`, empty panel and splitter maps, `editorPanes` `one`, `outputZoom` `fit`, empty `serialPortMap`; `EditorSettings.template` is the shipped template with `"\n"` line breaks (saved with CR LF it is the original's 420 bytes); `SimSettings.speed.instructionsPerSecond` is 1,000,000.

> **Corrected (erratum W3 16).** `SettingsService` keeps `app.layout` per window: a change from another window replaces everything except the layout, and `update()` writes this window's layout back only if the change touched it; a window that starts takes the stored layout.

> **Corrected (erratum E4 7).** "Cancel restores everything" (note 8) with several windows: a dialog keeps what the user changes in a draft and writes nothing before OK; Cancel, Escape and the close button discard the draft, so every setting is what it would be had the dialog never opened, including other windows' changes meanwhile; OK writes the draft and nothing else through `ctx.settings.update`. The font and size boxes of Editor Options count as touched from the moment the dialog opens, because in the original those boxes are the defaults for new documents and OK always applies them (erratum E4 8). What the original applies at once (Auto Indent, Real Tabs, the Assembler Options check boxes) therefore takes effect on OK (`docs/differences/E4.md`).

### 3.11 Run controller

Owner SH8 (`app/src/core/run/`). Section 4 specifies behaviour; this section fixes the types.

#### 3.11.1 Time

```ts
// app/src/core/run/clock.ts
export interface Clock {
  now(): number;                 // monotonic milliseconds
  wallTime(): Date;              // local date and time (task 8, log headers, listing header)
}
export interface Scheduler {
  /** Calls fn once per display frame. If no frame has arrived for 250 ms (hidden tab, minimised or
   *  covered window) it calls fn from a timer instead, whatever the page's visibility state says. */
  onFrame(fn: (now: number) => void): () => void;
  setTimer(delayMs: number, fn: () => void): () => void;      // returns cancel; delay 0 = as soon as possible
}
export class RealClock implements Clock {                     // performance.now(), new Date()
  now(): number;  wallTime(): Date;
}
export class FrameScheduler implements Scheduler {            // requestAnimationFrame + watchdog timer (4.5.5)
  /** frameSource replaces requestAnimationFrame in tests (for example a 120 Hz source). */
  constructor(frameSource?: (callback: (now: number) => void) => void);
  onFrame(fn: (now: number) => void): () => void;
  setTimer(delayMs: number, fn: () => void): () => void;
}
/** Tests: time moves only by advance(). advance(ms) moves the clock forward in steps: at every
 *  multiple of 16 ms of virtual time it runs the frame callbacks, and at each timer's due time it runs
 *  that timer, all in time order; a timer set during advance() for a time inside the span runs in the
 *  same call. */
export class VirtualTime implements Clock, Scheduler {
  advance(ms: number): void;
  now(): number;  wallTime(): Date;
  onFrame(fn: (now: number) => void): () => void;
  setTimer(delayMs: number, fn: () => void): () => void;
}
```

> **Corrected (erratum W3 12).** Until SH8's classes existed the bootstrap put `createRealClock()` and `createFrameScheduler()` of `app/src/state/browser.ts` on the context (frames, with the 250 ms watchdog); SH8's session may use its own; nothing depends on which.

> **Corrected (erratum SH8 15).** `VirtualTime`: timers due at the same time run in the order they were set, and timers due at a frame time before that frame; a zero-delay timer set inside a callback runs before `advance()` returns. `clock.ts` switches the lint rule for `core/` off for the four lines that reach the browser's clock and timers, each with its reason; `FrameScheduler` takes the timer functions as a second optional argument (erratum SH8 16).

#### 3.11.2 Controller

```ts
// app/src/contracts/run.ts
export type SimPhase = 'loading' | 'idle' | 'running' | 'waitInput' | 'waitDelay' | 'waitHost' | 'waitAlert';

/** Where a load comes from. 'execute', 'commandLine' and 'association' start from process-start
 *  state (4.7.1), because the original starts a new simulator process for them. */
export type LoadOrigin = 'open' | 'reload' | 'drop' | 'execute' | 'commandLine' | 'association';

export interface ProgramInfo {
  path: VPath;                   // the file Reload loads (after Open Data: the data file, sim-ui Q11)
  title: string;                 // from host.caption()
  hasListing: boolean;
}

export interface RunSnapshot {   // refreshed after an engine call during which host.registersShown() ran
  boxes: readonly string[];      // 20 texts indexed by Box
  cycles: bigint;
  highlight: number;             // engine.listingHighlight
  halted: boolean;
  revision: number;              // increases with every refresh
}

export interface PendingAlert { title: string; text: string; }

export interface RunController {
  readonly phase: SimPhase;
  readonly held: boolean;                         // a modal dialog of Simulator mode is open (2.7)
  readonly program: ProgramInfo | null;
  readonly snapshot: RunSnapshot;
  readonly alerts: readonly PendingAlert[];       // message boxes the engine opened, oldest first
  subscribe(listener: () => void): () => void;

  /* loads: each puts the controller into 'loading'; a request made during 'loading' is ignored */
  open(path: VPath, origin: LoadOrigin): Promise<void>;
  openData(path: VPath): Promise<void>;
  reload(): Promise<void>;
  close(): Promise<void>;
  coldStart(): Promise<void>;                     // process-start state without a program (4.7.1)

  run(): void;
  runToCursor(row: number): void;                 // row = selected listing row, -1 = none
  stepOver(): void;
  traceInto(): void;
  autoTrace(): void;
  pause(): void;
  rewind(): void;
  dismissAlerts(): void;                          // the user closed the box(es)

  /** Queue used by host parts and panels; delivered between instructions (4.3). */
  post(entry: InputEvent68k | ControllerRequest): void;
  /** For interface code: run an engine method that changes state. It runs at once when no engine
   *  call is in progress and the phase is not 'loading'; otherwise it is queued as a 'call' entry.
   *  Interface code never calls a state-changing engine method directly. */
  invoke(fn: (engine: SimEngine) => void): void;
  /** While at least one hold is active nothing calls engine.run() (2.7). Returns the release. */
  hold(): () => void;

  editBox(box: Box, text: string): void;          // Registers panel: forwarded to the engine at once
  /** Memory panel: direct write. Writes the byte and bumps liveRevision; the Hardware, Memory and Stack
   *  panels redraw, the Stack panel without re-centring. Interface code that writes memory with
   *  invoke(... writeBytes ...) bumps liveRevision itself (errata W1 11.4, U2 C1). */
  pokeMemory(address: number, value: number): void;
  clearCycles(): void;
}

export type ControllerRequest =
  | { kind: 'irq'; level: number } | { kind: 'hwReset' } | { kind: 'timerTick'; level: number }
  | { kind: 'autoTraceTick' }
  | { kind: 'pushButton'; bit: number; down: boolean } | { kind: 'switchClick'; bit: number }
  | { kind: 'fileDialogReply'; accepted: boolean; path: Bytes | null }
  | { kind: 'call'; fn: (engine: SimEngine) => void };       // any other engine call a host part needs

export interface SimSession {        // one per window; created by features/run/session.ts
  /** The current engine instance. A cold start replaces it: always read the property, never keep it. */
  readonly engine: SimEngine;
  readonly host: SimHost;            // one object for the life of the window, given to every instance
  readonly controller: RunController;
  readonly surface: Surface;
  readonly text: TextScreen;
  readonly keyboard: OutputKeyboard;
  readonly sound: SoundDevice;
  readonly hardware: HardwareModel;
  readonly listing: ListingView;
  readonly log: LogService;
  readonly files: ProgramFiles;
  readonly printer: PrinterDevice;
  readonly glyphs: GlyphProvider;
  /** Fires after a cold start has replaced the engine and reset every part. */
  onEngineReplaced(listener: () => void): () => void;
}
```

#### 3.11.3 Register fields

The engine models the twenty register boxes of the original, including which edits take effect at
once and which at the next run command, the A7/US/SS mirroring, and the refresh that overwrites
unapplied edits (sim-ui §4.4). The Registers panel therefore has no rules of its own beyond the field
behaviour of sim-ui §4.1 and §4.4 (fixed width, overwrite, hex digits only and upper case; the SR field
accepts only 0 and 1 and types a `0` for Backspace and for any other key):

- It shows `snapshot.boxes`.
- On every change of a field's text it calls `controller.editBox(box, text)`, then re-reads all twenty
  texts with `engine.boxText()` (the engine may have changed other boxes).
- Double-click on PC re-selects the current row; double-click on an address-register field copies its
  text to the Memory panel's Address field and shows that panel.

> **Corrected (erratum U1 C1).** The hand-over from a register field to the Memory panel is the command `sim.view.memory` with an optional argument, a number or the register field's hex text (`ctx.commands.run('sim.view.memory', boxText)`); the Memory panel masks it to 24 bits and rounds it down to 16 (erratum U2 C4).

#### 3.11.4 Listing view

Owner U1 (`app/src/core/listing/view.ts`). The engine holds the listing; this class is the host's
cached, decoded copy plus the few pure rules the panel needs.

```ts
export class ListingView {
  constructor(engine: () => SimEngine);
  refresh(): void;                                 // re-read all rows (after load, close, cold start, RepaintBit.Listing)
  readonly rows: readonly string[];                // Windows-1252 decoded, no line ends
  isInstruction(row: number): boolean;             // sim-ui §6.2
  addressOf(row: number): number | null;           // first 8 characters as hex
  find(text: string, fromRow: number): number;     // sim-ui §6.7; -1 = none
}
```

Selection: the original has one selected row, moved both by the user and by the highlight rule. The
panel keeps `sim.selectedRow` in the store. A click sets it. After every snapshot refresh that comes
from a `scrshow()` with the listing display on, the engine's row becomes the selection when it
matches the PC field (sim-ui §6.4); otherwise the selection stays (errata W1 12.4, U1 1, W4 12). Whenever the selection is set by the engine and
lies outside the visible rows, the panel scrolls so that it is the third visible row (sim-ui §6.4).
Gutter clicks go through `controller.invoke` to `engine.setBreakpoint` / `clearBreakpoint` for
instruction rows with index above 2; a double-click on an instruction row calls
`controller.editBox(Box.PC, first 8 characters)`.

> **Corrected (erratum U1 2).** `ListingView.refresh()` re-reads the rows only after a load, a close and a cold start (4.7 step 7, 4.7.1 step 5, 4.8 Close), not at every `RepaintBit.Listing` (which the engine reports at every `scrshow()` and breakpoint toggle); on `sim.viewRevision` the panel re-reads the breakpoints and redraws. After Close and an Open of the same program, and after any load whose start PC equals the PC shown before, no row is selected, as in the original (errata U1 8, 9, W4 12); Ctrl+G or the first step selects the PC row.

### 3.12 Store, commands, features, dialogs

Owner W3.

#### 3.12.1 Store

```ts
// app/src/contracts/store.ts
export interface Store<S> {
  getState(): S;
  setState(update: (state: S) => S): void;         // synchronous; listeners run after the update
  subscribe(listener: () => void): () => void;
}
export interface AppState {
  mode: Mode;
  documents: { items: DocumentState[]; activeId: string | null; };
  messages: Record<string, EditorMessage[]>;       // key = document id
  assemble: Record<string, AssembleSummary>;       // key = document id; last result
  sim: {
    program: ProgramInfo | null;
    phase: SimPhase;
    menuState: 0 | 1;                              // 0 active, 1 busy (sim-ui §3.6)
    halted: boolean;
    autoTrace: boolean;
    keyCommands: boolean;
    logging: boolean;
    regsRevision: number;                          // bump = register fields and cycle counter re-read the snapshot
    viewRevision: number;                          // bump = listing highlight, Stack, non-live Memory refresh (4.6)
    liveRevision: number;                          // bump at most once per frame: memory / hardware changed
    selectedRow: number;                           // listing selection ("cursor"), -1 = none
    messageLines: string[];
    breakpoints: number[];
    output: { width: number; height: number; fullScreen: boolean; textWrap: boolean; };
  };
  dialogs: { stack: DialogInstance[] };
  settings: Settings;                              // mirror of SettingsService
}
export type Mode = 'editor' | 'simulator' | 'easybin';
// file: the file the message belongs to; null = the document whose list it is, when that document has
// no path yet (erratum E5 2).
export interface EditorMessage { file: VPath | null; line: number; text: string; severity: 'error' | 'warning'; }
export interface AssembleSummary { errors: number; warnings: number; hasSRecord: boolean; hasListing: boolean; at: number; }
```

`app/src/state/store.ts` implements `Store<AppState>` in about fifty lines and
`useAppState(selector, isEqual?)` with React's `useSyncExternalStore`. Large or fast-changing data
(memory, pixels, listing rows, log tails, register values) is **not** in the store; components read it
from `SimSession` when the matching revision counter changes.

> **Corrected (erratum U1 C2).** `AppState.sim.breakpoints` has no writer: the Listing panel's gutter reads `engine.breakpoints()` whenever `sim.viewRevision` moves and after its own toggles.

> **Corrected (erratum SH4 2).** `AppState.sim.output.width`, `height` and `textWrap` have one writer, the simulator session (SH8), which mirrors `surface.back.width / height` and `text.state.textWrap` into the store once per frame; the check marks of `Output Window Size` and `Output Window Text Wrap` follow them, also after task 33.

#### 3.12.2 Commands

```ts
// app/src/contracts/commands.ts
export type CommandId = string;                    // every id of section 1.3; the union lives in commands/ids.ts
export interface CommandSpec {
  id: CommandId;
  mode: Mode | 'app';
  caption: string;                                 // original caption with '&'
  hint?: string;                                   // toolbar tool-tip
  kind: 'action' | 'check' | 'radio';
  /** notInOutput: the chords among them that the port added (K3, K5); they are not active while the
   *  Output panel has the keyboard (2.9.4). */
  keys: { win: string[]; mac: string[]; desktopOnly?: string[]; notInOutput?: string[] };
  suppressedByTask24: boolean;                     // one of the eleven of sim-ui §3.5
  icon?: string;
}
export interface CommandHandler {
  run(ctx: AppContext, arg?: unknown): void | Promise<void>;
  enabled?(state: AppState, ctx: AppContext): boolean;      // default true
  checked?(state: AppState, ctx: AppContext, arg?: unknown): boolean;
}
export interface CommandRegistry {
  spec(id: CommandId): CommandSpec;
  register(id: CommandId, handler: CommandHandler): void;   // exactly one handler per id
  /** Does nothing when the command is disabled and while a modal dialog is open (2.9.1). */
  run(id: CommandId, arg?: unknown): Promise<void>;
  isEnabled(id: CommandId): boolean;
  isChecked(id: CommandId, arg?: unknown): boolean;
}
```

Tables (owner W3, written once from section 1.3): `app/src/commands/tables/editor-menu.ts`,
`sim-menu.ts`, `easybin-menu.ts` (menu trees with separators in the original's order),
`toolbars.ts`, `keys.ts`. Feature packages register handlers; they never edit the tables. A command
without a handler is shown disabled; a unit test fails while any id of section 1.3 has no handler at the
end of wave 2.

> **Corrected (erratum W3 35).** The tool-tip `Program halted` (note 22) is given only while the simulator is idle and busy after a halt (`blockedByHalt(state)` in `commands/menus.ts`: `halted && phase === 'idle' && menuState === 1`).

> **Corrected (erratum E2 6).** Menus re-read `enabled` when the store changes. The editor session announces a change of the facts its handlers depend on (undo or redo possible, selection empty, focused document) with a new state object of the same contents, at most once per change (the rule of `CommandHandler.enabled`, erratum W1 11.2). While a plain text field is the target, Cut and Copy count as enabled and do nothing on an empty selection.

#### 3.12.3 Features and context

```ts
// app/src/contracts/features.ts
export interface AppContext {
  store: Store<AppState>;
  commands: CommandRegistry;
  settings: SettingsService;
  dialogs: DialogService;
  platform: Platform;
  vfs: Vfs;
  fileDialogs: FileDialogs;
  documents: DocumentService;
  asm: AsmEngine;
  /** Devices that exist only in a browser; the simulator session takes them from here (3.3.1). */
  devices: { audio: AudioBackend };
  sim: SimSession;
  clock: Clock;
  scheduler: Scheduler;
  /** Editor extensions contributed by other features (highlighting, markers). The editor component
   *  applies every registered source to every document view. `Extension` is declared in
   *  contracts/features.ts as a structural copy of @codemirror/state's type; React.ComponentType is
   *  reached through a type reference (contracts/ imports nothing; erratum W1 2). */
  editorExtensions: { register(source: (doc: DocumentState) => Extension): () => void };
}
export interface PanelSpec { id: string; title: string; mode: Mode; component: React.ComponentType; }
export interface FeatureModule {
  id: string;
  commands?: Record<CommandId, CommandHandler>;
  panels?: PanelSpec[];
  dialogs?: Record<string, React.ComponentType<DialogProps<any, any>>>;
  /** Called once after every service exists. May return a dispose function. */
  init?(ctx: AppContext): void | (() => void);
}
```

`app/src/features/index.ts` (owner W3) lists every feature module by a fixed import. W3 creates each
`app/src/features/<name>/index.ts` as a stub exporting an empty `FeatureModule`; the owning package
replaces the stub. The list, in this order: `documents`, `editor`, `highlight`, `options`, `assemble`,
`find`, `print`, `files`, `files-fsaccess`, `help`, `run`, `sim-main`, `output`, `memory`, `stack`,
`hardware`, `breakpoints`, `log`, `sim-options`, `sim-files`, `audio`, `desktop-devices`, `easybin`,
`pwa`.

Services created by features are placed on the context by W3's bootstrap in this order: `platform`,
`settings`, `store`, `commands`, `dialogs`, `vfs` (+ backends), `fileDialogs`, `documents`, `asm`,
`devices`, `sim`. A feature that provides a service exports a factory with a fixed name from its
`index.ts` (`createDocumentService(ctx)`, `createFileDialogs(ctx)`, `createAudioBackend(ctx)`,
`createSimSession(ctx, env)`, with `env: SimSessionEnv` of `contracts/features.ts`, because a feature
may not import `engine/` or `fs/`; erratum W3 10); the stubs return minimal working services (the
memory file backend, one in-memory document, dialogs that answer Cancel, a silent audio backend, and
an inert simulator session whose commands are all disabled) so that the shell runs from wave zero.
`asm` is W4's engine, loaded by the bootstrap at the first assembly; unit tests pass the scripted
assembler of `fake-asm.ts` (erratum W3 22). The real simulator session is SH8's `features/run/session.ts` (3.1).

#### 3.12.4 Dialogs

```ts
export interface DialogProps<P, R> { props: P; close(result: R): void; }
export interface DialogInstance { key: number; id: string; props: unknown; modal: boolean; }
export interface MessageBoxRequest {
  title: string; text: string;
  icon: 'none' | 'information' | 'confirmation' | 'warning' | 'error';
  buttons: ('OK' | 'Cancel' | 'Yes' | 'No' | 'Replace' | 'Append')[];
}
export interface DialogService {
  /** holdsProgram: hold the run controller while the dialog is open (4.4.5). Default: true for a
   *  modal dialog opened while the mode is 'simulator', false otherwise. */
  open<P, R>(id: string, props: P, options?: { modal?: boolean; holdsProgram?: boolean }): Promise<R>;
  messageBox(request: MessageBoxRequest, options?: { holdsProgram?: boolean }): Promise<string>;   // resolves to the button caption
  toast(text: string, action?: { label: string; run(): void }): void;
  isModalOpen(): boolean;
}
```

> **Corrected (erratum W3 17).** `open(id, ...)` for an id no feature registered rejects with an error naming the id. A dialog component draws the kit's `Dialog` with the `modal` value it was opened with; only dialogs opened through `ctx.dialogs` block commands and hold the run controller.

### 3.13 Platform bridge

File: `app/src/contracts/platform.ts`; implementations `app/src/platform/web.ts` (W3) and
`app/src/platform/desktop.ts` (DV2), chosen at start by the presence of `window.easy68kDesktop`, the
object the Electron preload script exposes. `main.tsx` chooses the platform (`createDesktopPlatform()`
when `window.easy68kDesktop` exists, otherwise the web platform) and mounts whatever
`createStartupBackends(platform)` of each `fs/*-backend.ts` returns; the bootstrap mounts
`platform.disk`. Both happen before the features start (erratum W3 11).

```ts
export interface StartupArgs {
  file: string | null;           // desktop: path from argv or the open-file event; web: ?open= value
  run: boolean; fullScreen: boolean; exceptions: boolean; bitField: boolean;   // /r /f /e /b
}
export interface NativeMenuItem {
  id?: CommandId; arg?: unknown; label?: string; accelerator?: string;   // accelerator: shown, never acted on (7.6)
  /** A native editing or application role (macOS): 'undo', 'redo', 'cut', 'copy', 'paste',
   *  'selectAll', 'about', 'hide', 'quit', 'minimize', 'close', 'window', 'help' ... */
  role?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  enabled?: boolean; checked?: boolean; items?: NativeMenuItem[];
}
export interface Platform {
  readonly kind: 'web' | 'desktop';
  readonly os: 'mac' | 'windows' | 'linux';
  readonly windowId: string;                                        // 3.8.6
  startupArgs(): StartupArgs;
  onOpenFiles(listener: (files: string[]) => void): () => void;     // file association, drop on the dock icon
  setNativeMenu(menu: NativeMenuItem[]): void;                      // no-op on the web
  onNativeCommand(listener: (id: CommandId, arg?: unknown) => void): () => void;   // menu items chosen with the mouse
  setTitle(title: string): void;
  print(html: string, title: string): Promise<void>;                // prints a prepared document
  openExternal(url: string): void;                                  // allow-listed URLs only
  showHelp(page: string): boolean;                                  // desktop: help window; web: false
  confirmBeforeUnload(needed: boolean): void;
  newWindow(): void;                                                // desktop: another app window; web: opens the app's URL
  /** Desktop: window-level full screen for the Output panel (2.5). Web: null - the panel uses the
   *  Fullscreen API itself. */
  readonly setFullScreen: ((on: boolean) => Promise<boolean>) | null;
  /** Desktop: paste the system clipboard into the focused element (the native paste command).
   *  Web: null - a page can only paste through the browser's own paste event or the Clipboard API. */
  readonly pasteIntoFocus: (() => void) | null;
  quit(): void;                                                     // web: no-op
  readonly disk: FileSystemBackend | null;                          // desktop only
  readonly syncFiles: SyncFiles | null;                             // desktop only: DiskSyncFiles (3.8.4)
  readonly serial: HostSerial | null;                               // desktop only
  readonly net: HostNet | null;                                     // desktop only
}
```

> **Corrected (erratum DV2 12).** In the desktop app `confirmBeforeUnload` is answered by a native question: `Leave EASy68K?` / `Changes you made may not be saved.`, buttons `Leave` and `Stay` (Stay is the default). `Platform.print(html, title)` loads the document into a hidden window with JavaScript off and opens the system print dialog; it resolves when that closes (erratum DV2 13).

> **Corrected (erratum E1 17).** `confirmBeforeUnload(needed, who?)` keeps the guard while any named party needs it: the documents feature always passes `'documents'` and gives its question back when the window is disposed while a document is still modified.

---

## 4. Execution model

### 4.1 Decision: main thread, time-sliced

The simulator engine runs on the **main thread**, in slices driven by the display frame and by timers.
It does not run in a worker.

| Concern | Main thread, sliced | Worker | Verdict |
|---|---|---|---|
| Host imports must answer synchronously (get pixel, cursor, key state, sound busy, files, time) | Direct function calls into the host parts | The whole host (surface, text, key table, sound logic, files) must live in the worker and be mirrored to the page | Main thread is simpler and has one copy of every state |
| Wait states (input, delay, file dialog) | The controller simply stops calling `run()` until the event arrives | Same, plus a message round trip per event | Equal |
| Keyboard and mouse delivery | Events are queued and delivered between instructions, a few milliseconds late at most | Events are posted to the worker and delivered when its slice ends; without shared memory the worker cannot see them sooner | Equal latency; main thread has no second queue |
| Drawing cost | We rasterise into a pixel array in any case; presenting is one `putImageData` of the dirty region per frame (640x480: about 1.2 MB) | Needs `OffscreenCanvas` transfer or a pixel copy per frame | Main thread is cheaper |
| Audio | Web Audio is only available on the main thread; the busy flag is computed from time, not from the device | Play commands must be posted to the page anyway | Main thread |
| Safari | No dependence on `OffscreenCanvas`, worker timers, cross-origin isolation or `SharedArrayBuffer`; GitHub Pages cannot send the headers those need | Several Safari-specific risks | Main thread |
| Electron | The page reaches disk, serial and network services synchronously through the preload bridge (3.3.4, 3.8.4); a worker has no bridge | Would need shared memory and blocking waits | Main thread |
| Responsiveness of the interface | A slice is bounded (half a frame, at most 8 ms); each instruction and each host call is bounded | Interface never waits for the engine | Worker is better, but the bound makes it unnecessary |
| Speed | At the default speed (4.5.6) a frame needs well under 1 ms of engine time; at `Maximum` the engine gets about half of each frame | Could use a whole core | Enough; the original is far slower than either |
| Tests | The same controller runs under Node with virtual time | Same | Equal |

The design keeps the door open: nothing under `core/` touches the DOM, so the session could be moved
into a worker later without changing a contract. That is not planned.

### 4.2 Ticks

Constants (in `app/src/core/run/governor.ts`):

```ts
export const SLICE_BUDGET_MS = 8;            // most engine time per frame interval ...
export const SLICE_FRAME_SHARE = 0.5;        // ... and never more than this share of the measured frame interval
export const SUBSLICE = 2000;                // most instructions between two looks at the queue
export const MAX_CATCHUP_MS = 50;            // unused allowance never exceeds this much execution time
export const MAX_TICK_INSTRUCTIONS = 1_000_000;   // per tick at 'Maximum' speed
export const DEFAULT_IPS = 1_000_000;        // "EASy68K-like" instructions per second; see 4.5.6 and O-1
/** Instructions between two deliveries of input: at most 2 ms of program time. */
export function subslice(ips: number): number { return Math.max(1, Math.min(SUBSLICE, Math.ceil(ips / 500))); }
```

A **tick** is the controller's one entry point for making progress. It is called once per display
frame (`Scheduler.onFrame`), by the timers the controller arms (the end of a delay, a posted event), and
directly by a run command. Ticks never nest.

```
tick(now, isFrame):
  if phase == loading: return                  # 4.7: nothing touches the engine during a load
  if isFrame:
    frameInterval = smoothed(now - lastFrame);  lastFrame = now
    usedThisFrame = 0
  deliverQueue()                               # 4.3
  fireDueTimers(now)                           # 4.5.3
  if not held and alerts is empty:             # 2.7, 4.4.4
    if phase == waitDelay: serviceDelay(now)   # 4.4.2; may change the phase to running
    if phase == running:   runSlice(now)
  if isFrame: publishRevisions()               # 4.6: at most one store update per frame

runSlice(now):
  if speed.mode == 'max': allowance = MAX_TICK_INSTRUCTIONS
  else:
    allowance += min(now - lastSlice, MAX_CATCHUP_MS) * ips / 1000
    allowance  = min(allowance, MAX_CATCHUP_MS * ips / 1000)       # the cap holds after adding, too
  lastSlice = now
  budget = min(SLICE_BUDGET_MS, SLICE_FRAME_SHARE * frameInterval) - usedThisFrame
  start = clock.now()
  while phase == running and allowance >= 1 and clock.now() - start < budget:
    n = min(subslice(ips), floor(allowance), edgeGap if an input edge is waiting)   # erratum SH8 1:
    # an input edge delivered while the program executes sets edgeGap = subslice(ips); the next edge
    # waits until edgeGap executed instructions have run (edgeGap -= executed)
    before = engine.stepCount
    status = engine.run(n)
    allowance -= (engine.stepCount - before) mod 2^32
    handleStatus(status)                       # leaves phase == running only for RunStatus.Running
    deliverQueue();  fireDueTimers(clock.now())
  usedThisFrame += clock.now() - start
```

Points that are easy to get wrong:

- **The time budget is per frame interval**, not per tick: a tick between two frames (the end of a
  delay, a key) draws from what the frame has left. On a 120 Hz display the engine gets at most about
  4 ms per frame, so input, React and presenting keep the other half.
- **The allowance is capped after the addition.** A stretch during which the time budget, not the
  allowance, ended the slices (heavy drawing) therefore cannot be made up later at full engine speed.
- **`Maximum` has an instruction cap per tick**, so a tick always ends even when the clock does not
  move, as under `VirtualTime`.
- **Entering `running`** (a run command, the end of a wait, `startRunningIfIdle`) sets
  `lastSlice = clock.now()` and `allowance = subslice(ips)`, so the first instructions execute at
  once; leaving it sets the allowance to 0.

`handleStatus(status)`:

| Status | Action |
|---|---|
| `Running` | none |
| `Stopped`, `Error` | `phase = idle`; program files are written through (3.8.4); logs are flushed. `Error` is the original's `Unexpected error in runLoop`, which the engine has already put in the message area |
| `WaitInput` | `phase = waitInput` |
| `WaitDelay` | If the phase is not `waitDelay`, or `engine.stepCount` differs from the value recorded at the last `WaitDelay`, this is a **new** delay: `delayStart = clock.now()`, `delayReported = 0`, record `stepCount`, `phase = waitDelay`, arm the delay timer. Otherwise it is the delay already being waited for: nothing changes |
| `WaitHost`, `WaitAlert` | set the phase |
| `Busy` | none: the command did nothing. It can only come from `cmdTraceInto` and `autoTraceTick` while a step is suspended |

Events are delivered between instructions, never inside one, which is the original's rule (hardware §7:
"between instructions"). The original looks at its message queue after every single instruction; the
port looks after every sub-slice, that is at least every 2 ms of program time while running. The cases
where the exact instruction boundary matters are races in the original too (hardware §9.2); they stay
possible and stay rare, and where the engine had to choose one outcome its README says which.

### 4.3 The queue

`RunController.post()` appends to one FIFO and asks for a tick as soon as possible (a zero-delay timer,
at most one pending). `deliverQueue()`:

```
while the queue is not empty:
  entry = take the first entry
  apply(entry)                                         # table below
  if phase == idle and engine.state().runMode: startRunningIfIdle()
  if phase == running and entry is an input edge: stop # the rest waits for the next sub-slice
```

| Entry | Input edge | Action |
|---|---|---|
| `keyDown` | yes | `enabled = engine.keyDown(vk)`; then `engine.keyChar(ch)` if the entry has `ch`; then, if it has `paste` and `enabled` is true, `engine.keyChar()` for every byte, consecutively. If the phase was `waitInput` and a character was delivered: `handleStatus(engine.run(subslice))` once, after the last one |
| `keyUp` | yes | `engine.keyUp(vk)` |
| `char` | yes | `engine.keyChar(ch)`; if the phase is `waitInput`: `handleStatus(engine.run(subslice))` |
| `ioActivated` | no | `engine.ioActivated()` |
| `mouseDown` / `mouseUp` | yes | the matching engine method |
| `mouseMove` | no | `engine.mouseMove`; consecutive `mouseMove` entries are merged into the last one |
| `pushButton` / `switchClick` | yes | `engine.pushButton(bit, down)` / `engine.switchClick(bit)` |
| `irq` | no | `engine.irq(level)` |
| `hwReset` | no | `engine.hardwareReset()` |
| `timerTick` | no | `engine.timerTick(level)` |
| `autoTraceTick` | no | `handleStatus(engine.autoTraceTick())` |
| `fileDialogReply` | no | `engine.fileDialogReply(accepted, path)`; if the phase is `waitHost`: `phase = running`, then `handleStatus(engine.run(subslice))`. (After a Trace Into the same call finishes the step and returns `Stopped`.) |
| `call` | no | `fn(engine)` (address and map edits, breakpoint edits, option changes) |

Three rules sit in those few lines.

**Wake-up.** After every entry, if the controller is idle and the engine says it is in run mode, the
controller starts running. This is the original's "a request starts execution" behaviour (hardware
§3.1 items 4 and 7): an IRQ button, an auto-interrupt tick, the Reset button, and equally a key or
mouse event armed by task 62 or 60 restart a program that waits in `STOP` or has stopped without
disabling the hardware. `startRunningIfIdle()` sets the phase to `running` **without** the effects of
the Run command (no focus change, no arming of the auto-interrupt timers). In the wait phases the
request is only latched, as in the original.

**One input edge at a time.** The original looks at its queue after every instruction, so a key press
and its release, two clicks, or two typed characters are always separated by executed instructions,
and a program that polls task 19 or task 61 sees each state. Browser events arrive in batches, between
ticks. While the program is running, the controller therefore delivers **at most one input edge per
sub-slice**; the next one follows `subslice(ips)` instructions later, in order. A press and a release
that reach the page in the same frame are both seen by the program, and two interrupt requests at one
level are two interrupts, not one. In the other phases the program is not executing, the original's
own pump would drain everything at once too, and so does the port.

**Atomic key press.** A `keyDown` entry carries its character and, for a paste chord, the pasted text,
because the original processes those inside one handler with no instruction in between (3.6).

While the phase is `waitAlert` or `waitHost`, while alerts are open and while the controller is held,
the queue is still delivered (keys become type-ahead, requests are latched) but `run()` is not called:
the original's modal box blocks the program in the same way.

User commands (Run, Pause, ...) are not queued: they act at once, because they arrive as browser events
and no slice is executing at that moment. After **every** engine call the controller makes, from the
queue or from a command, it runs `afterEngineCall()`: if `host.registersShown()` was called meanwhile
it refreshes the snapshot (4.6), and if `host.alert()` was called it shows the box (4.4.4).

> **Corrected (erratum SH8 2).** Details (SH8): `handleStatus(engine.run(subslice))` enters `running` with the allowance of one sub-slice, executes, and deducts what `stepCount` says was executed; at most one sub-slice runs at once. While the controller is held or an engine box is open a queue entry is delivered and its `run()` is left to the catch-up of 4.4.5 (4.4.5 wins over the table; erratum SH8 3).

### 4.4 Wait states

#### 4.4.1 `WaitInput`

The engine has armed a keyboard read and is in run mode. The controller does not call `run()`. The
prompt blinks on its own timer. Each character goes to `engine.keyChar()` followed by one `run()`,
which either returns `WaitInput` again (line not finished) or continues the program. Interrupt requests
are latched and serviced after the input (trap15-a §3.9). `Pause` cancels the read:
`engine.cmdPause()` ends the wait and finishes the suspended step itself; the program later continues
without its input, as in the original.

#### 4.4.2 `WaitDelay` (task 23)

One unit is **10 ms** of real time, as the help states. (On Windows each unit is one `Sleep(10)`, which
lasts 10 to 15.6 ms depending on the machine's timer; the port uses the nominal value. Recorded in
`docs/DIFFERENCES.md`.)

```
serviceDelay(now):
  periods = floor((now - delayStart) / 10) - delayReported
  if periods > 0: engine.delayElapsed(periods);  delayReported += periods
  if engine.delayRemaining == 0:
    phase = running                            # the TRAP finishes in the next run()
  else:
    arm the delay timer for min(time until the last period ends, 1000 ms)
```

- `delayStart` and `delayReported` are set once, when the delay begins (4.2), and are not touched
  while it lasts. The remainder below 10 ms is therefore never thrown away: a delay of 100 units takes
  1000 ms whatever the frame rate.
- The delay timer calls `tick()` when the delay is due, so the end of a delay does not wait for a
  display frame, and the program continues in that same tick. A loop of one-unit delays runs at about
  100 iterations per second.
- The controller does not call `run()` during a delay.
- While the controller is held by a modal dialog the delay does not advance: the original's delay loop
  stands still inside the dialog's message loop. On release `delayStart` is moved forward by the time
  held.

Keys typed during a delay reach `engine.keyChar()` and become the one-character type-ahead; key state
and mouse state keep updating; interrupt requests are latched and recognised when the TRAP ends
(sim-core §10.4 item 3). `Pause` and `Rewind` end the delay at once. In Trace Into the engine skips the
delay entirely.

> **Corrected (erratum SH8 4).** A delay also stands still while a message box of the engine is open: holds and open boxes are one condition ("the program may not execute"), and the time either lasts is added to `delayStart`, as the original's delay loop stands still inside either modal loop.

#### 4.4.3 `WaitHost` (task 58)

The engine has called `host.fileDialog(...)`. `ProgramFiles` opens the `sim.fileDialog` dialog and,
when it closes, posts `{ kind: 'fileDialogReply', ... }`; the queue entry answers the engine and
resumes the program (4.3). The dialog is modal: no key reaches the dispatcher, `CommandRegistry.run`
refuses every command, and the native menu's command items are disabled, so nothing can change the
simulator while the engine waits for the reply.

#### 4.4.4 `WaitAlert` (message boxes of the engine)

Whenever the engine calls `host.alert(title, text)`, `SimUiBridge` appends the box to
`controller.alerts` and the interface shows it as a modal message box with an OK button. While
`alerts` is not empty nothing calls `run()`, so the program stands still while the box is open, as in
the original. When the user closes the box, `controller.dismissAlerts()` empties the list, calls
`engine.dismissAlert()`, and, if the phase is `waitAlert`, sets it to `running` and calls
`handleStatus(engine.run(subslice))`.

Alerts are raised from `run()` (which then returns `WaitAlert`) and from other calls: a load
(`Breakpoint Limit Reached!`, `Current Log Stopped.`), a gutter click, a trace step. The rule is the
same for all of them.

The boxes in question are the original's: `Current Log Stopped.` (title `Information`),
`ERROR: An exception occurred in routine 'exec_inst'.` (title `Error`), `Breakpoint Limit Reached!`,
and the Run To Cursor boxes. The full-screen failure box is the host's own (2.5).

#### 4.4.5 Dialogs opened by the user

While a modal dialog opened from Simulator mode is open (the Open dialog, `Log File Options`, the
`Caution` question, the option dialogs, About), the controller is **held**: the dialog service calls
`controller.hold()` when it opens such a dialog and the returned release when it closes. A held
controller delivers the queue and fires timers but calls neither `run()` nor `serviceDelay()`. This is
the original's behaviour, whose modal dialogs run their message loop inside the run loop's own, and it
is what keeps a log complete when the user answers `Replace` or `Append` at leisure. Modeless dialogs
(Find, Log Output) and everything in Editor mode do not hold the program. When the last hold is
released the controller calls `handleStatus(engine.run(subslice))` once if the phase is `waitInput` or
`waitHost`, in case a queue entry completed the wait meanwhile.

### 4.5 Time

#### 4.5.1 Sources

All time comes from the injected `Clock`: `now()` (monotonic) for delays, timers, sound and the
governor; `wallTime()` for task 8, log headers and the listing header. The application injects
`RealClock`; tests inject `VirtualTime`.

#### 4.5.2 Time of day (task 8)

`SimUiBridge.timeCentiseconds()` = `hours*360000 + minutes*6000 + seconds*100 + floor(ms/10)` of
`clock.wallTime()`, local time.

#### 4.5.3 Software timers

`app/src/core/run/timers.ts` provides `SoftTimer` objects checked by `fireDueTimers`:

```ts
export class SoftTimer {
  constructor(clock: Clock, onTick: () => void);
  intervalMs: number;            // setting it while enabled restarts the period
  enabled: boolean;              // false -> true starts a fresh period; first tick one interval later
  /** Called by the controller. Fires at most once per call, then schedules now + interval. */
  check(now: number): void;
}
```

Rules taken from Windows timers (hardware §7, §3.6): an interval of 0 never fires; intervals from 1 to
9 ms behave as 10 ms; a late timer fires once, with no catch-up burst; enabling restarts the phase.
Resolution is one display frame (about 16.7 ms at 60 Hz) against 15.6 ms on Windows.

| Timer | Interval | Tick |
|---|---|---|
| Auto-interrupt, levels 1-7 | per level, default 1000 ms | `post({kind:'timerTick', level})`. Enabled, disabled and given its interval by the engine through `hardwareTimer` (the arming rule of hardware §3.6 is the engine's); ticks also while the simulator is idle |
| Auto trace | `SimSettings.autoTraceIntervalMs`, 10-1000, default 200 | `post({kind:'autoTraceTick'})`; the engine skips a tick while keyboard input is pending |
| Input prompt | 500 ms | runs inside `TextScreen` on the injected `Scheduler`, not on a `SoftTimer` (errata SH3 2, W1 11.4) |
| Log flush | 1000 ms or more while logging (3.3.5) | `LogService.flush()` |

The end of a task 23 delay is not one of these: it has its own timer on the `Scheduler` (4.4.2).

> **Corrected (erratum SH8 14).** `SoftTimer`: a new `intervalMs` restarts the period of a running timer, the same value does not, and `enabled = true` on an enabled timer changes nothing (hardware §3.6, the VCL's `SetInterval`). The controller's `TimerSet` holds the seven auto-interrupt timers and the auto-trace timer; the input prompt and the log flush run on the scheduler in their own packages (erratum SH8 17).

#### 4.5.4 Sound durations

`SoundDevice` computes `busyUntil` from `clock.now()` and the WAV header (3.7). Nothing waits for audio.

#### 4.5.5 Hidden pages

`FrameScheduler` uses `requestAnimationFrame`. A watchdog timer, re-armed by every frame, takes over
whenever no frame has arrived for 250 ms and then calls the frame callbacks itself about 60 times per
second until frames return (errata SH8 25, W3 32). It
does not consult the page's visibility state, because a minimised or covered window can stop producing
frames while still calling itself visible.

In a browser, timers of a hidden tab are slowed down by the browser (to about one per second, and to
about one per minute after several minutes). Because the allowance is capped at `MAX_CATCHUP_MS`, a
program in a hidden tab runs at a few percent of its speed or less; delays, sound and timers stay
correct because they use real time, only coarser. The desktop app disables background throttling, so
there the watchdog keeps a program at its speed when the window is hidden or minimised.

> **Corrected (erratum W3 32).** Once the watchdog has fired it calls the frame callbacks every `WATCHDOG_FRAME_MS` (1000 / 60 ms) until a frame arrives, then waits 250 ms again. A hidden browser tab slows the timer down by itself; the desktop app keeps the speed.

#### 4.5.6 Speed

The original executes one instruction and then pumps the Windows message queue twice. That makes it
slow: an estimated 0.3 to 3 million instructions per second on current PCs, depending on the machine
and on what else the window is doing (sim-core §11.11 lists this as unverified). The WebAssembly core
alone reaches tens of millions.

The port therefore **governs speed by instruction count**, not by cycle count:

- `Options > Execution Speed...` offers `EASy68K-like` (default), `Maximum`, and a custom number of
  instructions per second.
- `EASy68K-like` uses `DEFAULT_IPS`. Its initial value, 1,000,000, is an estimate. Work package P1
  replaces it with a figure measured on the official binary on real Windows hardware, if the owner
  allows that measurement (O-1); otherwise the estimate stays and the user guide says so.
- The cycle counter (tasks 30 and 31) is unaffected by the governor: it counts 68000 cycles as the
  original does.

**What a student with a software delay loop sees.** A loop such as `MOVE.L #500000,D0` /
`SUBQ.L #1,D0` / `BNE` executes one million instructions. At the default setting it takes about one
second, every time, on every machine. On real EASy68K the same loop takes somewhere between a third of
a second and a few seconds depending on the PC. So the port is inside the spread of real machines, more
repeatable than any of them, and not equal to a particular one. Programs that must keep time should use
task 23 or task 8, which behave the same on both; the user guide says this in its first section on
timing. With `Maximum`, delay loops finish almost at once; the setting exists for long computations.

Step Over's full-speed stretch and Run To Cursor use the same governor. Trace Into and Auto Trace
execute one instruction per command or tick and are not governed.

> **Corrected (erratum P1 6).** `DEFAULT_IPS` (`app/src/core/run/governor.ts`) and `DEFAULT_INSTRUCTIONS_PER_SECOND` (`app/src/core/settings/defaults.ts`, stored in `SimSettings.speed`) are both 1,000,000; a change of the default after O-1 must change both.

### 4.6 What is refreshed when

The original refreshes registers, cycle counter, listing highlight, Stack and Memory only when
`scrshow()` runs (sim-ui §4.2). The engine reproduces those moments and tells the host. Host methods
only record what happened; the controller acts after the engine call has returned (3.3.2).

| Engine callback | Effect in the port |
|---|---|
| `registersShown()` | Sets a flag. In `afterEngineCall()` the controller copies the twenty `boxText()` values, the cycle count and `listingHighlight` into `RunSnapshot` and bumps `regsRevision`. The Registers panel and the listing selection (3.11.4) update. |
| `repaint(what)` | Records the bits. `afterEngineCall()` bumps `viewRevision` and, in `sim.repaint`, the counter of every panel the bits name; a panel re-reads its data when its own counter moves (Listing, Break Points, Memory, Stack). `RepaintBit.Stack` is `updateDisplay()`, which re-centres the Stack panel; `StackRedraw: 16` comes with `Stack` for `StackFrm->Repaint()`, which redraws it in place (errata W1 11.4, 12.2, 13.3; W4 10). The engine itself applies the rule that an auto-trace step with `Disable display update` skips the listing, stack and memory (sim-ui §4.2); the host only keeps `SimOption.DisableDisplay` equal to the setting. |
| `memoryLivePaint(address)` | Only while `SimOption.MemLive` is on, which the Memory panel sets while its `Live` box is checked. The panel records the row as dirty; once per frame `publishRevisions()` bumps `liveRevision` if a visible row is dirty. |
| `hardwareUpdate()`, `hardwareControls()`, `hardwareState()` | `HardwareModel` notifies its listeners; the Hardware panel re-reads `view()` at most once per frame. |
| `message(text)`, `messagesClear()` | Appended to or clearing `sim.messageLines`; published once per frame. |
| `caption(text)` | `ProgramInfo.title` and the window title. |
| Drawing calls | The Output panel presents the surface's dirty region once per frame (3.4). |

During a full-speed run nothing else is refreshed: register fields, cycle counter, listing and stack are
frozen until the program stops, exactly as in the original.

> **Corrected (erratum W4 10).** `TStackFrm::Repaint()` sends `REPAINT_STACK | REPAINT_STACK_REDRAW` (24) and `updateDisplay()` keeps `REPAINT_STACK` (8), so a host that counts only `Stack` still redraws the Stack panel as before, and one that counts both re-centres only when `Stack` moved by more than `StackRedraw` (`RepaintBit.StackRedraw = 16`).

> **Corrected (erratum U2 C2).** When U2 wrote this entry `AppState.sim` carried only `viewRevision`, and the Memory and Stack panels treated every change of it as their own repaint. Since gate I1 the optional `AppState.sim.repaint` counts the repaints per panel (`listing`, `breakpoints`, `memory`, `stack`, `stackRedraw`; errata W1 11, SH8 24, 33), and a panel falls back on `viewRevision` only while it is absent; U2 C2 is superseded there. While `Live` is checked the Memory panel compares its visible bytes with the engine's memory once per display frame and repaints when one differs, which sim-ui §10.4 allows; `memoryLivePaint` reaches no panel (erratum U2 C3).

> **Corrected (erratum SH8 18).** Publishing (SH8): frame ticks and everything a free run changes publish at most once per frame; commands, loads, `invoke`, `hold` and `dismissAlerts` publish when they return. The repaint counters count `host.repaint()` calls per panel (`SimUiBridge.takeRepaintCalls()`), not engine calls; `viewRevision` still moves once per engine call; `stackRedraw` is a fifth counter, mirrored into `AppState.sim.repaint.stackRedraw` (errata SH8 24, 32, 33).

### 4.7 Loading a program

`RunController.open(path, origin)`, in order (sim-ui §8.2-§8.4):

1. A request that arrives while the phase is `loading` is ignored.
2. Questions. `origin` `drop` with a program already loaded, and `origin` `open` while a program is
   running: the `Caution` question (`The current debug environment will be lost, click OK to
   continue.`, OK / Cancel). `origin` `execute` while a program is running or waiting: the same
   question (note 20). The controller holds the program (4.4.5) while it asks, whatever the mode.
   Stop on Cancel. `confirmLoad(origin)` asks this question on its own for a caller that must act
   between the question and the load; `open(path, origin, { confirmed: true })` then skips it
   (erratum W1 13.5).
3. `phase = loading`. From here until step 10 no tick touches the engine, the queue is kept, and every
   simulator command is disabled. The old program does not execute another instruction.
4. `origin` `execute`, `commandLine` or `association`: `await coldStart()` (4.7.1).
5. `await glyphs.ready`. Read the `.S68` bytes from the `Vfs` (`null` if it cannot be read). Find the
   listing: the file in the same folder whose name equals the program's with the extension `.L68`,
   ignoring letter case; read it (`null` if there is none). Unless `origin` is `reload`:
   `await files.setCurrentDir(dirname(path))`; for `reload`: `await files.revalidateIfStale()`.
6. `engine.load(s68, l68, { name, kind })` with `kind` = `open` for `open`, `reload` for `reload`, and
   `drop` for `drop`, `execute`, `commandLine` and `association`. `name` is the path as the user sees
   it. The engine does the rest: reset, memory fill, S-records, listing, start address, `*[sim68k]`
   directives, messages, the caption, clearing PC breakpoints for `open`, stopping a running log for
   `open` and `drop`, and finishing a step that was suspended.
7. `afterEngineCall()` (snapshot, alerts). `listing.refresh()`. Set `program` (`path`, `hasListing`).
8. Unless `origin` is `reload`: `log.setLogFileNames(path)`.
9. For `commandLine`: apply `/e` and `/b` with `engine.setOption`.
10. `phase = idle`. For `commandLine`: `/f` = the full-screen command, then `/r` = `run()`.

The awaits of steps 4 and 5 are why the `loading` phase exists: in the original a load is one
uninterrupted function call, and in the port nothing may happen to the simulator between its
beginning and its end either. `reload()`, `close()`, `openData()` and `coldStart()` use the same
phase.

A change of the bit-field or exceptions option made by the engine during a load or by a program
arrives as `optionChanged` and is written to `SimSettings` at once (sim-ui Q14).

`openData(path)`: read the file, `engine.loadData(bytes, name)`, move the current directory to the
file's folder (3.8.4), and make `path` the file that Reload loads (sim-ui Q11, a quirk that can load
the wrong program and is therefore kept).

> **Corrected (erratum SH8 7).** Details (SH8): with an `.S68` that cannot be read, `program` stays `null` if nothing was loaded, otherwise it keeps its title and gets the new path and `hasListing: false`. `/e` and `/b` reach `SimSettings` at once through `host.optionChanged`; the port stores every settings change when it is made, so there is no "at exit" (erratum SH8 8). `/f` passes `true` to `sim.output.fullscreen`: it asks for full screen, it does not toggle (erratum SH8 27). `confirmLoad(origin)` asks exactly when `open(path, origin)` would, holds the program while the question is open, and resolves with the answer (erratum SH8 31). A run command and a load wait until the cached program files have read a change saved elsewhere (`whenCurrent()`, `filesCatchingUp()`; erratum SH8 34). Open Data while a program runs moves the PC, because there is no next run command to reload it (erratum SH8 12; sim-ui 8.3's sentence holds for a stopped simulator).

> **Corrected (architect's decision, 22 November 2026; erratum SH8 47).** Step 3 and step 1, for commands given during a load: in the original a load is one synchronous call and Windows delivers a key or click given meanwhile when it returns, so F9 pressed right after OK on `Caution` runs the new program. During a load, and from the answer to `Caution` until the load begins, Run, Run To Cursor, Step Over, Trace Into, Auto Trace, Pause, Rewind and Reload are therefore not refused but kept, and the code that ends the load (step 10) carries them out in the order given, each finding the commands enabled or busy as at that moment (a second Run after a Run does nothing; Reload loads again and what follows waits for that load; Run To Cursor reads the row selected then, after Execute none). If the load fails (the `.S68` cannot be read, no engine, a host part or the engine fails) what was kept is dropped. A second Execute during a load is kept as well and replaces the program when the first load has ended; what was kept before it, which in the original went to the first simulator's window, is dropped. These commands are shown enabled while they are kept; Open, Open Data and Close stay disabled during a load, and everything given while no load is under way acts as before (4.8's availability table holds outside a load).

#### 4.7.1 Cold start: process-start state

In the original, the editor's Execute button starts a new `SIM68K.EXE` (`assembleS.cpp:37`), and so
does a command line or a double-click on a file. The program therefore finds everything as it is after
start-up. A load into a running simulator does not give that: the reset inside a load deliberately
keeps the memory-map ranges an earlier program switched on, the Output size, both pen positions, text
wrap, PC and advanced breakpoints, the key table, the auto-interval values, a sound started by task 73
and open serial ports (sim-ui §9.9, hardware §8, trap15-b §3.2). `coldStart()` gives the window's one
simulator the same fresh state:

1. **The old simulator exits** as the original's process does: `log.exit()` (logging stops without a
   message box, sim-ui §1.5), `files.exit()` (pending bytes of all streams are committed, 3.8.4), an
   open print job is closed, full screen is left, all timers are cancelled, the queue is emptied,
   `releaseSimEngine(engine)`.
2. Every part: `resetToStartup()` (table in 3.3.2).
3. `engine = await createSimEngine(host)`. The host receives the start-up reset's calls during this.
4. The saved `SimSettings` are applied as the original's `LoadSettings` applies `sim68K.dat`:
   exceptions, bit field, both log types, the auto-trace interval and its display option, the four
   device addresses (`setDeviceAddress`, whose handlers also set the push-button byte, hardware §8),
   the Output, listing and printer fonts, the Stack and Memory panel choices; if the Hardware panel is
   visible, `setHardwareVisible(true)` (which zeroes the switch byte, as at the original's start).
5. `afterEngineCall()`; `listing.refresh()`; `program = null`; `onEngineReplaced` listeners run.

The application's own start is the same function, and it is the recovery from an engine failure
(4.8). A cold start is skipped when the simulator is still exactly in that state: nothing has been
loaded, run or changed since the last one (the usual case for a file named on the command line).

> **Corrected (erratum U3 7).** The breakpoints model empties its grids at every `onEngineReplaced`, which also fires when the window's first engine exists, so rows entered while the first engine is still being created are lost; the original has no such moment.

> **Corrected (erratum SH8 9).** Details (SH8): "all timers are cancelled" is `TimerSet.disableAll()` (the seven auto-interrupt timers and the auto-trace timer) plus the delay timer and the pending tick (erratum SH8 11). The Output font is in place before the engine exists: `TextScreen.setOptionsFont` is called in step 2, right after the parts' `resetToStartup()` (erratum SH8 10). `recoverJournal()` is the first step of `controller.start()`, before the first engine (erratum SH8 23). A cold start is skipped only when no engine call has gone through the controller since the last one, the parts the user can change directly are untouched (`RunControllerDeps.partsUntouched()`), and so a skipped cold start leaves exactly the state one would make, independent of frames (errata SH8 9, 38). "Changed" includes the saved settings a cold start applies (after an import of `sim68K.dat` the next Execute is a cold start) and leaves out the engine calls the cold start itself queued (the log service's read of the log types in step 2): the first Execute of a new window makes no cold start, each later one does (erratum SH8 38). The session starts its engine in the microtask after bootstrap; until then `session.engine` is a stand-in that reads as a simulator in start-up state (erratum SH8 21); a session or controller disposed before it starts stays inert (erratum SH8 28).

### 4.8 Commands and states

| Command | Controller action |
|---|---|
| Run | `await files.revalidateIfStale()` if needed (phase `loading` meanwhile); `engine.cmdRun()` (the engine copies the register boxes to the CPU, resets the breakpoint counters, arms the auto-interrupt timers and calls `ioBringToFront`); audio `resume()`; `phase = running`; `tick()` |
| Run To Cursor | Selected row must be an instruction row with index above 2. If it is: `engine.cmdRunToCursor(row)`, then as Run. If not, the box `Selected line does not have a valid address.` (no row selected: `Invalid Run-To-Cursor Selection`) and no run (note 23; the engine's own path would run anyway) |
| Step Over | `engine.cmdStepOver()`; `phase = running` (the engine stops after one instruction or after the called subroutine returns); `tick()` |
| Trace Into | `handleStatus(engine.cmdTraceInto())` |
| Auto Trace | `engine.cmdAutoTrace()`. The engine calls `autoTraceTimer(true)`; the bridge starts the auto-trace timer (4.5.3), whose tick posts `autoTraceTick`. `autoTraceTimer(false)` stops it |
| Pause | `engine.cmdPause()` (ends a wait and finishes a suspended step itself); `phase = idle`; command state forced to active (note 24) |
| Rewind | `engine.rewind()` (the same); `phase = idle` |
| Reload | `open(program.path, 'reload')` |
| Open, Execute, drop, command line, file association | `open(...)` (4.7) |
| Close | `Caution` question; `engine.close()`; `phase = idle`; `listing.refresh()` |
| IRQ button, Reset button, auto-interrupt tick | queue entries (4.3) |
| Clear Cycles | `engine.clearCycles()`; refresh the field |
| Log Start / Log Stop | `LogService.start()` / `stop()` (3.3.5) |

Command availability follows `sim.menuState`, `sim.phase` and `sim.halted`:

| Command | Enabled when |
|---|---|
| Run, Run To Cursor, Auto Trace, Step Over, Trace Into | `menuState == 0` and the phase is not `loading` |
| Pause, Rewind | the phase is not `loading` |
| Close | the phase is not `loading` (also with no program: it asks `Caution` and leaves the start-up state; erratum SH8 39) |
| Open | the phase is not `loading` (note 22) |
| Reload | a program has been loaded in this session |
| Log Start / Log Stop | sim-ui §13.6 |

Engine failure: if any engine call throws (a WebAssembly trap or an abort), the controller shows
`ERROR: An exception occurred in routine 'exec_inst'.` with the PC and opcode from the last snapshot
(the original's box for its own internal faults, sim-ui §9.12) and then performs a cold start. A new
engine in start-up state next to host parts in their old state would be inconsistent, so nothing is
kept; the message area then reads `The simulator was restarted after an internal error. Load the
program again.` This path is tested with an engine wrapped by a fault injector.

> **Corrected (erratum U1 C3).** Clear Cycles: the panel calls `controller.clearCycles()` and shows `0` itself, as the original's `ClearCyclesClick` does; the next snapshot refresh shows the engine's count again.

> **Corrected (erratum SH8 5).** After `cmdPause()`, `rewind()` and every `Stopped` status the controller looks at `engine.state()`: with `fileDialogOpen` the phase is `waitHost`, with an engine box open `waitAlert`, otherwise `idle`. The run commands check their availability in the controller too: `run()`, `runToCursor()`, `stepOver()`, `traceInto()`, `autoTrace()` do nothing unless the commands are active and the phase is not `loading`, and `pause()`, `rewind()`, `editBox()`, `pokeMemory()`, `clearCycles()` nothing during a load (erratum SH8 6). Engine failure: the box shows `PC=<PC box>  Code=<the word at the snapshot's PC>`; it is the controller's own alert, and the cold start begins at once without waiting for OK. If the engine fails again while restarted, or cannot be created, a stand-in engine stays in place and the message area says so; the next cold start tries again (erratum SH8 13).

### 4.9 Assembling

`ed.project.assemble` (owner E5), in the original's order (editor-ui §10.2):

1. If `saveThenAssemble` and the document is modified: `documents.save(id)`; a cancelled Save As
   cancels the assembly.
2. Clear the document's messages and markers.
3. Build `AsmOptions` from `EditorSettings` and the document's tab type and size.
4. Collect the files (3.8.3) and put the editor buffer, `encodeForAssembler(documents.text(id))`,
   under `mainName`; `asm.assemble(mainName, files, options, clock.wallTime())`.
5. If `result.fatal` is not null: add it to the Messages panel as
   `The assembler stopped: <text>` and stop; no file is written. (The original ends the whole editor
   at this point.)
6. Write `result.listing` to `<dir>/<base>.L68` and `result.sRecord` to `<dir>/<base>.S68` (5.3). A
   write failure shows `File Access Error.  Please verify that you have write permission to the folder
   where the selected file is located.` and no status dialog.
7. Show each `result.dialogs` entry as a box with its caption.
8. Convert `result.messages` to `EditorMessage`s. A message of an include file (`resolvedFile` names
   it) opens that file as a document if it is not open (with the three-line notice of editor-ui §10.5
   if it is open and modified) and is listed in that document's Messages panel; the assembled document
   stays active.
9. Messages panel height rules of 2.2. Open `asm.status` with the counts. `Execute` is enabled when
   `result.executeEnabled` is true and the S-record was written.

The interface is not blocked visibly: assembling a typical program takes a few milliseconds. For a
long assembly the toolbar button shows a busy state and a second F9 is ignored.

> **Corrected (erratum E5 4).** Details (E5): a cancelled or a failed auto-save both cancel the assembly (the original assembles whatever happened). A write failure shows its box and stops: no engine message boxes, no rows, no new summary (erratum E5 5). A rejection of `AsmEngine.assemble` (a forbidden tab size from a hand-edited trailer, an engine that cannot load) is shown like a fatal result: one row `The assembler stopped: <error message>` with line number 0, no file, no dialog (errata E5 6, 10). An engine message box takes the engine's caption as its title and the error icon when the caption is `Error`; the status dialog has no default button. `ed.project.assemble` is enabled while a document is active and some open document is a source document (the original's frame-wide flag), and disabled while an assembly runs; `ed.msg.clear` is enabled while the active document's list has rows (erratum E5 9).

---

## 5. Files and formats

### 5.1 Bytes and text

- **Encoding.** Every text file is Windows-1252. `app/src/core/codec/cp1252.ts` (owner W1) provides
  `decode(bytes): string` and `encode(text): { bytes: Bytes; unmappable: number }`. Decoding maps every
  one of the 256 byte values to one character (the five bytes Windows-1252 leaves undefined, `$81`,
  `$8D`, `$8F`, `$90`, `$9D`, map to the control characters U+0081, U+008D, U+008F, U+0090, U+009D), so
  decode followed by encode returns the original bytes for **every** input. Encoding writes `?` for a
  character that has no byte and counts it.
- **Line ends.** Files are written with CR LF. Reading accepts CR LF, lone LF and lone CR as a line
  break for display. The assembler does not get the display text of an include file: it gets that
  file's stored bytes and applies the Windows text-mode rules itself (3.2, first statement on the
  assembler).
- **No BOM** is written. A UTF-8 file is shown as its Windows-1252 bytes, which is what the original
  shows; if the bytes are valid UTF-8 with multi-byte sequences the editor shows a banner:
  `This file looks like UTF-8. EASy68K reads it as Windows-1252.` with no automatic conversion.
- **Ctrl-Z** (`$1A`) in a source ends the file for the assembler (text mode); the editor shows the
  character and everything after it.
- **Tabs** are never converted on load or save.

> **Corrected (erratum E1 12).** The UTF-8 notice is a toast: `DocumentState` has no field to carry a banner to the editor, so the document service shows `This file looks like UTF-8. EASy68K reads it as Windows-1252.` through `dialogs.toast` when such a file is opened or reloaded (a UTF-8 byte-order mark counts).

### 5.2 `.X68` source files

Load: 3.9.2. Save: 3.9.3. Example of a new document saved as `t.X68` with the default options: the
420-byte template, then

```
0D 0A
*~Font name~Courier New~ 0D 0A
*~Font size~10~ 0D 0A
*~Tab type~1~ 0D 0A
*~Tab size~4~ 0D 0A
```

A source saved under any other extension gets no trailer. A list document (`.L68`, `.S68`) never gets
one. Save As with an extension spelled exactly `.X68` turns a list document into a source document
(editor-ui §6.4).

### 5.3 `.L68` and `.S68`

- Names: the document's path with its last extension replaced by `.L68` and `.S68` (upper case); a name
  without an extension gets the extension appended. Same folder as the source (the program directory).
- Both are written after every assembly for which their option is on, also when there are errors;
  existing files are replaced without a question. Nothing is deleted when an option is off.
- Content is the engine's output, unchanged: CR LF line ends, Windows-1252.
- `Created On:` is printed by the engine from the local date and time the application passes (the
  `timestamp` argument of `assemble`), in the form `M/D/YYYY h:mm:ss AM` or `PM` with no leading zeros
  on month, day and hour; at exactly midnight only the date is printed, as the original's
  `DateTimeToStr` does (the original prints the Windows locale's format; the port always uses the US
  form, which is the form of every sample listing and of the oracle). Tests mask this line. Log
  headers use the same form and the same midnight rule, produced by `formatUsDateTime(date)` of
  `app/src/core/sim-host/log/format.ts` (U4; erratum U4 1).
- `Load L68` opens the listing as a list document in the editor.

### 5.4 Opening an `.S68` in the simulator

`File > Open...` in Simulator mode, a dropped `.S68`, a file association, `Execute`, and the command
line all end in `RunController.open` (4.7); the last three start the simulator afresh first, as the
original starts a new process for them (4.7.1). The listing is the `.L68` with the same base name in the
same folder, matched without regard to letter case. Without it the simulator shows the nine explanatory
lines and still runs the program. The filter of the dialog is
`EASy68K S-Record (*.S68)` and `All Files (*.*)`.

### 5.5 Log files

- Default names: the program's path with the extension replaced by `_RunLog.txt` (execution) and
  `_OutLog.txt` (output), in the program directory; editable in the Log Output dialog; recomputed on
  every Open, not on Reload (sim-ui §13.1).
- **Execution log**: header `EASy68K execution log file: <formatUsDateTime>` and an empty line; then
  the engine's records. The engine supplies header and records with CR LF line ends (the original
  writes this file in text mode); `LogService` stores the bytes unchanged.
- **Output log**: header `EASy68K output log file: <formatUsDateTime>` CR LF CR LF; then raw bytes as
  described in trap15-a §3.11 (one LF per automatic new line). Binary: no conversion.
- `Replace` truncates, `Append` appends, `Cancel` leaves logging off.
- `LogService` buffers in memory and appends to the files about once per second and at every stop
  (3.3.5). The original flushes after every entry; the port's files end with the same content and can
  be one flush behind while a program runs.
- Rewind and Reload notes follow the stale-snapshot rule (note 42). The engine implements it:
  `LogService.dialogShown()` calls `engine.logDialogOpened()` each time the Log Output dialog is shown,
  and the engine writes a note only when logging is on and the matching snapshot is non-zero (to the
  execution log through `logWrite`, to the output log through `outputLogWrite`).

> **Corrected (erratum U4 8).** Log file names are VPaths (`/browser/work/prog_RunLog.txt`), shown and edited as such; a typed name that is not a VPath is taken relative to the program's folder (Windows rules), and the folder buttons open the port's Save dialog.

### 5.6 Settings files

`settings.dat`: 57 lines, CR LF, `<value>$<name>`, positional (editor-ui §11.4). `sim68K.dat`: 37
lines, with raw bytes instead of digits on lines 2, 3 and 34 (sim-ui §14.3). `template.NEW`: plain
text. All three are imported and exported through `settings.transfer`; the port's own storage is JSON
(3.10). Exported files load in the original.

### 5.7 Start-up arguments and file associations

| Delivery | Syntax | Behaviour |
|---|---|---|
| Desktop command line | `EASy68K [file] [/r] [/f] [/e] [/b]` | A first argument ending in `.S68` (any case) that exists: Simulator mode, load it, then the switches of sim-ui §8.1 (only from the second argument on). Any other existing file: Editor mode, open it. Otherwise a new document. The switches of sim-ui §8.1 are processed in all three cases; without a loaded program `/r` halts at once and `/f` acts only once Simulator mode is shown (erratum SH8 22). |
| Desktop file association and drop on the Dock icon | `.X68`, `.L68` | Editor mode, open (the original's installer maps both to EDIT68K) |
| | `.S68` | Simulator mode, simulator started afresh (4.7.1), load without running |
| Web URL | `?open=<VPath>` plus optional `run=1`, `fullscreen=1`, `exceptions=1`, `bitfield=1` | Same rules on the path's extension. Only paths in the browser store can be opened this way. `?example=<name>` opens an official example. |
| Web, installed app | file handlers in the manifest for `.x68`, `.l68`, `.s68` (Chromium) | as the desktop association |

> **Corrected (erratum DV1 6).** Not done yet: the installed web app's manifest has no `file_handlers`. A launched file arrives as a `FileSystemFileHandle`; FS2's `LinkedBackend.link(handle)` can make it a `/linked/...` path that saves back, but `features/pwa` may not import `app/src/fs` and no contract member reaches it (erratum DV1 12, `docs/requests/DV1-launch-files.md`: W1, then FS2, then DV1). Declaring the handlers before something consumes the launch queue would open an empty window for every double-clicked file.

> **Corrected (erratum DV2 4).** In the desktop app `StartupArgs.file` and `onOpenFiles` carry VPaths of `/disk` (`/Users/me/x.X68` arrives as `/disk/Users/me/x.X68`); a command-line file that does not exist gives `file: null`. The switches `/r /f /e /b` count from the second argument on, in any letter case, and only with the slash, as `SIM68Ku.cpp` compares them.

### 5.8 Examples

The ten official example programs and six sounds (`reference/examples/official/Examples`, GPL) are
shipped under `app/public/examples/`. `Help > Examples...`: web - copies them into `/browser/Examples/`
if that folder is missing and shows it in the Files panel (`ctx.commands.run('app.files.toggle',
{ reveal: '/browser/Examples' })`, `FilesRevealArg` of 3.12.2; erratum W1 12.3); desktop - asks for a
folder, copies them
there and shows the open dialog in it. Nothing from `reference/examples/site` is shipped or committed.

### 5.9 Exchanging files with users of the Windows original

- `.X68` files written by the port open in the original with the same text, font and tab settings, and
  the other way round. The font name stored in a file is kept when the port has to display a substitute.
- Files from Git hosts often have LF line ends. They open correctly; saving writes CR LF, as the
  original does.
- A classmate needs the whole folder for programs that use INCLUDE, INCBIN, data files or sounds. The
  Files panel's `Export` produces a `.zip` of a folder; `Open folder...` or `From this computer...`
  brings one in.
- File names in 68000 programs are matched without regard to letter case and with `\` or `/`, so a
  program written on Windows finds its files. A program that names a drive (`C:\...`) fails with the
  result the original gives for a missing file.
- `.L68` and `.S68` files are interchangeable in both directions. The memory panel's `Save` writes raw
  bytes with the default extension `.bin`.
- A file a program writes appears when the original's C library would have written it: at task 56 or
  task 50, when the program sets the file position (task 55; erratum DV5 2), when 512 bytes have
  accumulated, or when the simulator is restarted (3.8.4). A file edited
  or added while a program is loaded is seen by the program's next open, without a reload.

---

## 6. Test strategy

### 6.1 The claim and how it is argued

The claim is: *a program assembles and runs in the port as it does in EASy68K v5.16.1.* It cannot be
proved in general. It is argued in layers, each with an oracle and with a stated limit.

| # | Layer | Oracle | What it shows | What it cannot show | Runs | Owner |
|---|---|---|---|---|---|---|
| L1 | Compiler independence of the engines | Native "twins": the same patched sources built with MSVC (32-bit, `/O2` and `/Od`) and, for the assembler, the unpatched sources built the same way (the simulator's shim needs the patches that make it non-blocking; erratum T4 2) | The WebAssembly build has no compiler-dependent behaviour on the tested inputs (uninitialised data, layout, signedness); our patches change nothing but what they say | Equality with the Borland build; anything in the GUI-coupled code the twins replace by shims | Windows CI, every push | T4 |
| L2 | Assembler output | Official EDIT68K.exe v5.16.1 under Wine in Docker | `.S68` and `.L68` (date line masked) are byte-identical for every corpus file and for an option matrix | Inputs outside the corpus; the path through Wine's RichEdit control, which hands the text to the assembler (ground-truth §4 risk 1) | Docker, on demand and weekly; results are compared on every push | T1 |
| L3 | Assembler logic, second opinion | `asy68k.exe`, the v5.15.4 command-line port built natively | Same output except the documented 5.16 changes (assembler §8.3) | 5.16.1-specific formatting | Windows CI | T1 |
| L4 | Simulator results | Official SIM68K.exe under Wine: (a) self-reporting programs started with `/r` that write their registers and memory to a file; (b) execution logs made with Log Start and Auto Trace | CPU results, flags, cycle counts (through task 31), register effects of non-interactive TRAP #15 tasks, file-task results, per-instruction register traces | Pixels (Wine's GDI is not Windows GDI), timing, sound, interactive input, the hardware window | Docker, on demand and weekly; compared on every push | T3 |
| L5 | Drawing | The GDI rules of trap15-b §6, re-measured by a capture program on real Windows | Our rasteriser produces GDI's pixels for the calls the original makes; the text grid is Windows' for every font, style and size | That SIM68K.exe makes exactly those calls in every state (established from the binary, trap15-b §15 V1-V9, not from a run); glyph pixels of the outline fonts | Windows CI (capture), every platform (compare) | T2, SH1, SH2, SH3 |
| L6 | The specs' own checklists | The specs (derived from the original source) | The port implements what the specs say, item by item | Items the specs mark UNVERIFIED | every push | each owner |
| L7 | CPU deviations from hardware | SingleStepTests 68000 suites | A catalogue of where the original core differs from a real 68000, frozen as a regression baseline | Nothing about fidelity to EASy68K; a mismatch is a quirk to keep | on demand; the frozen baseline on every push | T4 |
| L8 | The application | Playwright in Chromium and WebKit | The interface drives the engines correctly; every `web-e2e` row of the parity matrix works; output pixels are identical across browsers | Real Safari, real keyboards, and what a browser itself does with a key the page cancelled (6.6) | every push, three operating systems | X1, X2, X3 |
| L9 | The macOS app | The development build under Playwright's Electron support, and the built `.app` on macOS runners (arm64 and Intel) driven over the DevTools protocol (6.7) | The main-process settings; it launches, opens files from disk, assembles, runs, draws, writes files; fuses set; signature valid ad-hoc | Gatekeeper prompts, sound you can hear, real devices | on changes under `desktop/` and `app/`; the packaged checks on release | DV2, DV3, DV5 |
| L10 | A person on a Mac | Manual check list (6.8) | What automation cannot | - | before each release | DOC1 |

### 6.2 Oracles

#### 6.2.1 Native twins (T4)

The twins are built with MSVC as 32-bit programs (ILP32, like Borland and wasm32):

- The two assembler twins are the assembler engine's own: `engine/asm/native` builds the command-line
  program `ez68k-asm` (inputs by manifest, the eight options, tab settings and the time as switches)
  once from the engine's patched sources and once from the unpatched sources, and the engine's own
  tests compare them. T4 runs them in CI and over the corpus and does not own them.
- `tests/oracle/native-twin/sim-twin/`: the sources of `sim-twin.exe` (built into `build/native-twin/`;
  erratum T4 1): the patched simulator core with a headless C++ host (text
  output to a file, no graphics, files on disk), driven by a script: load, run N instructions, dump
  registers and a memory range.

Comparisons: twin against WebAssembly for the whole tracked corpus (assembler) and for the conformance
programs (simulator); `/O2` against `/Od`; patched against unpatched on inputs that do not trigger the
patched defects. Any difference fails the build.

> **Corrected (erratum T4 3).** Details (T4): the engine's own build (`engine/asm/native/build.mjs`) makes only the `/Od` assembler twins, so `tests/oracle/native-twin/build-asm-twins.mjs` compiles the same files with the same flags (read from the engine's build scripts, failing if they cannot be found) at `/O2` and `/Od`. The compiler is found with `vswhere` and passed through `VCVARS32` (erratum T4 4). In CI the unpatched twins are built from the original archive (`ProfKelly/EASy68K` at `dab554f0`, SHA-256 checked) and compared with the engine's list of expected differences (erratum T4 5); the archive is unpacked with `%SystemRoot%\System32\tar.exe`, never a `tar` from PATH (erratum T4 11). The simulator comparison runs a standard script for every `.X68` under `tests/` that assembles, the engine's test programs, the hand-written scripts and the single-step suite, each program given the files of its folder and its parent (erratum T4 8). A twin built from older sources than the WebAssembly engine is not compared (erratum T4 12).

#### 6.2.2 Official binaries under Wine (T1, T3)

`tests/oracle/wine/Dockerfile`: Debian with 32-bit Wine, Xvfb and xdotool. The official files are
**not** in the image or the repository; the run script mounts `reference/official-extracted` read-only
and copies it into a writable folder inside the container (both programs rewrite their settings file).
The binaries never run on the host.

- **Assembler** (`tests/oracle/wine/asm/run.sh <file.X68> [settings.dat]`): the steps of
  ground-truth §4: start `EDIT68K.exe` with the file, F9, Alt+C, Alt+F4; collect `.L68` and `.S68`.
  Options are selected by writing `settings.dat` first. The script detects and dismisses the
  help-viewer message boxes and fails loudly on any unexpected window.
- **Simulator, self-reporting** (`tests/oracle/wine/sim/run-report.sh <file.S68>`): start
  `SIM68K.exe file.S68 /r` (plus `/e`, `/b` when the test asks), wait for the end marker the program
  writes (errata T3 4 and 6: `result.bin`), kill the process. Wine has no Fixedsys: under the oracle the
  default output font has an 11 x 14 cell. Programs whose results depend on the text grid are compared
  with the port running with the same cells; Windows' cells are verified by L5 (erratum T3 1).
- **Simulator, execution log** (`tests/oracle/wine/sim/run-log.sh <file.S68> <type>`): write
  `sim68K.dat` with the raw type byte, start without `/r`, Ctrl+F4, open and confirm Auto Trace Options
  (to apply the 10 ms interval), F10, wait for the `Current Log Stopped.` box, Enter, kill; collect
  `<name>_RunLog.txt`.
- Outputs for redistributable inputs are committed under `tests/conformance/*/golden/`. Outputs for
  inputs that may not be redistributed are kept in `build/golden-local/` (git-ignored); only their
  SHA-256 (after masking) is committed, in the corpus manifest. An output above 512 KiB is kept like a
  non-redistributable one: its hash in the manifest, the file in `build/golden-local/` (erratum T1 2).
- **Spot check of the RichEdit path**: files with bytes `>= $80`, lines longer than 255 characters, lone
  LF or lone CR, tabs or Ctrl-Z are flagged `richedit-sensitive` in the manifest. A sample of them must
  be confirmed once on real Windows (6.8) before the corresponding goldens count as ground truth; until
  then the text the editor model produces for such a file is "unconfirmed" where it differs from the
  text captured under Wine; the assembler comparison uses the captured text and is exact (erratum T1 5).

> **Corrected (erratum T3 5).** The simulator's goldens (T3): `tests/conformance/sim/golden/<suite>/<program>.result.bin`, `.OutLog.txt` and `.log<N>[o].RunLog.txt.gz`, with `golden/manifest.json` (hashes after masking the header and listing dates, and the status of every run) and `golden/REPORT.md` (runs without a result). The official `.S68` is not stored, only its SHA-256, and the port's assembler must produce the same bytes. The simulator driver is mounted into the container, not copied into the image, and `run-report.sh` waits for the end marker `END-OF-DUMP` in `result.bin` (errata T3 3, 4); `dumplib.X68` is `tests/conformance/sim/dumplib.X68` (erratum T3 6). The harness ran `ProgramFiles` and `LogService` as doubles while SH6 and U4 wrote them (erratum T3 2).

#### 6.2.3 GDI capture (T2)

`tests/oracle/gdi-capture/` is a small C++ program built with MSVC. It creates a memory device context
with a 32-bit DIB section and makes the GDI calls the VCL makes (trap15-b §15, last paragraphs):
`CreatePenIndirect`, `CreateSolidBrush`, `SetROP2`, `MoveToEx`, `LineTo`, `SetPixel`, `Rectangle`,
`Ellipse`, `ExtFloodFill`, `ExtTextOut`, `GetTextExtentPoint32`. It reads a case list and writes one
`.pix` file per case (6.5.3). It also writes the raster-font atlases and the metric table of 3.5.1
(`GetTextFace`, `GetTextExtentPoint32` for every name, style and size).

What GDI returns for text depends on the machine: the display scaling when point sizes become pixels,
and the font-smoothing setting. The program is therefore marked DPI-unaware in its manifest, and it
writes the machine's smoothing settings into every output. CI regenerates and compares only what does
not depend on them - the primitives, the raster-font atlases and the metric table - and fails if a
committed reference changed (a Windows update changed GDI), so drift is noticed. The outline-font
atlases do not come from Windows at all (3.5.1): `tools/make-font-atlases.mjs` produces them from the
bundled open fonts, identically on every operating system, and CI checks that too.

> **Corrected (erratum T2 17).** Besides display scaling and font smoothing, the fallback font depends on the machine: what the control bytes `$00-$08 $0B $0E-$1B` draw in the raster faces differs between Windows builds. These pixels are not compared on another Windows (`tests/oracle/gdi-capture/machine-dependent.ts`, `OTHER_FONT_BYTES`; their advances still are). On another Windows than the references' the differences must be exactly those recorded for it in `tests/oracle/gdi-capture/other-windows.json`, and `--write` refuses to replace the references from it (erratum T2 13).

#### 6.2.4 The command-line port and the single-step suites

`tools/build-asm-oracle.ps1` already builds `asy68k.exe` (toolchain §4); W0 moved the hand-written
files it needs from `build/` to `tests/oracle/asm-cli/`; T1 owns them from then on (erratum W0 5).
The single-step suites are downloaded at test
time into `build/singlestep/` (never committed; SingleStepTests/680x0 has no licence, m68000 is MIT).

> **Corrected (erratum T1 8).** L3 as built: `tests/oracle/asm-cli/run.mjs` builds `asy68k.exe` (`tools/build-asm-oracle.ps1`) and compares it with the port's assembler (not with the official program, as `compare_cli.py` of the hand-off did) on the tracked example sets, both option sets, the same text and Assembly tabs; it runs on Windows in CI when the file exists.

> **Corrected (erratum T4 6).** One single-step suite: SingleStepTests/680x0 (`68000/v1`, commit `e0d5ece9`), whose JSON states are the 68000's architectural state; SingleStepTests/m68000 is a repackaging of MAME's core and is not used. The runner enables exceptions and traces one NOP at `$000400` between tests, because EASy68K's double-fault latch and the previous instruction's static result survive a reset (erratum T4 9). "The frozen baseline on every push" is the job `windows-oracles` (`npm run oracle:twins`), which checks `tests/conformance/cpu/baseline.json`; `run-singlestep.mjs` checks it weekly on Linux in `oracle.yml` (errata T4 7, 10).

### 6.3 Corpus

`tests/corpus/manifest.json` lists every test program: id, origin, licence class, SHA-256 of the
input, flags (`richedit-sensitive`, `needs-include`, `interactive`), and the expected hashes.

| Set | Files | In the repository | Used for |
|---|---|---|---|
| `official` | 10 `.X68` + 6 `.wav` (GPL) | yes, `tests/corpus/official/` | L2, L4, L8 |
| `github-mit` | pacman-mc68000 (24), 68k-assembly-learning (18), with their licence files | yes, `tests/corpus/github/` | L2 |
| `conformance` | programs written for this project (one per checklist item or group) | yes, `tests/conformance/` | L2, L4, L6 |
| `site` | 134 `.X68` from the EASy68K web site | no; `tools/fetch-site-examples.mjs` downloads them by URL into `build/corpus-local/` | L2 locally and in the weekly job |

The third-party project checked out under `reference/examples/github/easy68k-qt` is not used in any
way: not its sources, tools, documents or expected outputs, and not its example files either. No
package reads that folder.

> **Corrected (erratum T1 6).** The hand-off's figures (420 and 419 error-free programs, 57 differing only in undefined-symbol lines) include the excluded third-party folder. For the permitted sets (`npm run test:conformance` with the `site` set fetched): 185 / 184 runs with an official result, 129 / 128 byte-identical (every error-free program, 128 of 128 and 127 of 127), 56 equal after masking undefined symbols, 0 differing. Without an official result: `pacman-mc68000/GAME/GFX.X68` (2.4 MB) and one 1.2 MB program of the `site` set with the expansion options (`golden/REPORT.md`).

### 6.4 Conformance checklists

Each checklist in the specs becomes a suite with one test per item, named after the item:

| Checklist | Suite | Kind | Owner |
|---|---|---|---|
| assembler §3.9 "Test checklist" | `tests/conformance/asm/checklist/` | source + golden from L2 | T1 |
| editor-ui §20.1 highlighting vectors | `app/src/core/highlight/vectors.test.ts` | unit | E3 |
| editor-ui §20.2-§20.6 | `tests/e2e/editor/*.spec.ts` and unit tests of `core/documents` | unit + e2e | E1, X1 |
| trap15-a §13 | `tests/conformance/sim/trap15-a/` | 68000 programs + headless runs; golden from L4 where the item is not interactive | T3 |
| trap15-b §15 (V1-V14) and §6 | `tests/conformance/gdi/`, `tests/conformance/sim/trap15-b/` | pixel + headless | T2, T3 |
| hardware §13 | `tests/conformance/sim/hardware/` | headless with scripted panel actions | T3 with SH7 |
| sim-ui §19 quirk register (rows marked "affects program results") | `tests/conformance/sim/quirks/` | headless | T3 |
| sim-core §2-§8 statements quoted in sections 3 and 4 | `app/src/core/run/*.test.ts`, `app/src/core/listing/*.test.ts` | unit against the real engine | SH8, U1 |

The headless harness is `tests/conformance/sim/harness.ts` (T3): it builds a `SimSession` from the
real engine and the real host parts with `VirtualTime`, a memory file system and fake audio, runs a
scenario (keys to type at each `WaitInput`, panel actions at instruction counts, time to advance) and
returns the message lines, the text shadow array, a hash of the surface, the files written, the logs
and the final registers.

> **Corrected (erratum T3 7).** "Panel actions at instruction counts": `ScheduledAction` has `atInstruction` (checked after every frame of virtual time, so it comes at the first frame boundary at or after the count), `atMs` and `whenIdle`; exact boundaries need a scripted Trace Into. Checklist items that need a person at the original or a memory map have no golden from the Wine oracle and are tested in the harness against what the specs dictate (`tests/conformance/sim/checklist.test.ts`; erratum T3 9). 6.9 item 2's "100,000 instructions" of execution logs is not reached yet: the suite has 27 execution-log runs with 47,664 instructions (the official Auto Trace runs at 8-12 instructions per second in a one-CPU container; erratum T3 8).

### 6.5 Pixel tests

#### 6.5.1 Primitives (SH1, SH2)

Cases are generated by `tests/conformance/gdi/cases.ts` with a fixed seed: 10,000 width-1 lines,
2,000 wide lines (widths 2-14), 10,000 rectangles filled and unfilled (widths 0-12, all three cases of
trap15-b §6.3), 1,000 flood fills on random pictures, the 16 raster operations on every primitive kind,
pixels inside and outside the surface, the colour forms of trap15-b §4.6, and clipping cases.
Acceptance: **every pixel equal** to the GDI capture.

#### 6.5.2 Ellipses (SH2)

- All box sizes from 1x1 to 64x64, width-1 pen, filled and unfilled (8,192 cases): **every pixel
  equal**. A captured table may be used to achieve this.
- 3,000 random boxes with sides from 65 to 1,200: at least 95% of the cases with every pixel equal, and
  no case with more differing pixels than 0.5% of its outline length.
- Wide-pen ellipses (widths 2-8, 500 random boxes): reported, no pass threshold in version 1.
- The measured figures are written to `docs/porting/gdi-deviations.md` and become the regression
  baseline: a later change may not make them worse.

> **Corrected (erratum SH2 5).** The 3,000 large boxes are drawn on a 200 x 150 canvas, each placed so that a part of it shows (whole ellipses up to 1,200 x 1,200 would make the references several megabytes; the three packs are 706 kB), and "0.5 % of its outline" is 0.5 % of the pixels of the whole outline. The whole shapes were compared separately with GDI's FlattenPath (equal); the committed suite is 3,000 of 3,000 equal. The packs (`ellipses`, `ellipses-large`, `ellipses-wide`) live in T2's `tests/conformance/gdi/golden/` (erratum SH2 6).

#### 6.5.3 Text and reference formats

- Text grid: cell positions, opaque cell backgrounds in the fill colour, pen movement, clipping,
  control bytes in task 95 - every pixel equal for the raster faces; for the outline faces the cell
  rectangles and pen positions are equal and the glyph pixels are not compared with Windows.
- `.pix` reference file: bytes `E68P`, version 1, width (u16 LE), height (u16 LE), then runs of
  `count (u32 LE)`, `colour (u32 LE, $00BBGGRR)` until `width * height` pixels are covered.
- Font atlas `app/public/fonts/{bitmap,scalable}/<face>-<height>[-<style>].bin` (`<style>` is `b`, `i`,
  `u` or `s`): bytes `E68F`, version (u8) = 2, cell width (u8), cell height (u8), glyph width (u8, at least
  the cell width; larger when a style overhangs), flags (u8; bit 0 set = 8-bit coverage, clear = 1 bit
  per pixel), 256 advance widths (u8 each), then 256 glyphs of `glyphWidth x cellHeight` in byte order
  `$00`..`$FF`, row-major, rows of 1-bit glyphs padded to whole bytes, leftmost pixel in the highest bit (erratum SH3 6).
- `app/public/fonts/metrics.json`: `{ "faces": [...], "fonts": { "<requested name>": { "<style>":
  [[colWidth, rowHeight, faceIndex], ... 256 entries, index = point size ] } } }`, with the capture
  machine's Windows version and settings in a `"capturedOn"` field.

> **Corrected (erratum T2 1).** The `.pix` references are committed packed, one gzip file per suite, `tests/conformance/gdi/golden/<suite>.pixpack.gz` ("E68R", a JSON header with each case's id and GDI's pen position, then the `.pix` files unchanged; format in `tests/conformance/gdi/pix.ts`); the pen position, which the `.pix` format cannot hold, travels in the header. 26,000 single files would make every checkout slow; the packs are 0.85 MB.

> **Corrected (erratum T2 4).** `metrics.json`'s style keys are `plain`, `bold`, `italic`, `underline`, `strikeOut` (the names of `FontSpec`); it also has `about`, `faceKinds` (`raster` or `outline`, parallel to `faces`) and `raster` (the style rules and the cells, erratum T2 2). `scalable/index.json` lists the outline atlases. Atlas files are named `<face>-<height>[-<style>].bin` with spaces as `_`, and `<face>-<height>x<width>[-<style>].bin` when two sizes share a height (erratum T2 5); providers take the names from these two files, not build them.

> **Corrected (architect's decision, 22 November 2026; errata T2 25, T2 26, T2 28 and T2 29).** "Control bytes in task 95 - every pixel equal for the raster faces" means three things. (1) Every pixel and the pen position equal Windows' for every text of the raster faces made only of bytes the face draws from its own glyphs without Windows' Unicode text path, that is a text with none of the zero-width bytes `$09 $0A $0D $1C`-`$1F`, `$7F`, the undefined bytes `$81 $8D $8F $90 $9D` and `$86`-`$88`, `$98` (and none of the bytes of (3a)): what students' programs print (suite `text`). (2) For a text that takes the text path, every pixel and the pen equal Windows' wherever Windows is deterministic and draws from the raster face itself - the zero-width bar, italic itemization, the undefined bytes and control texts (errata T2 26-28) - as the suite `text-path` pins it; that suite stays equal in every pixel and pen. (3) Outside "every pixel equal", each recorded as a difference with its evidence in `docs/differences/SH3.md`: (a) pixels Windows takes from a fallback font the project cannot ship - the bytes `$01`-`$08`, `$0B` and `$0E`-`$1B` (Windows 11 10.0.26300 and Windows Server 10.0.26100 draw 72 of the 90 captured texts with them differently; erratum T2 25), the glyph of the euro sign `$80` on the text path (ClearType; erratum T2 26), and `$0C` on the text path, whose glyph and width come from a fallback font (erratum T2 27); (b) anything where Windows' own result depends on what the process drew before: `"@"` on the text path in Courier (the same text is drawn differently in another order; erratum T2 28), and the width of the euro sign `$80` on the text path in Courier (the same text moves the pen by another amount in another order, after another text, alone in a new process, and in some orders from run to run; erratum T2 29). For each of them the port's pen position equals Windows' wherever Windows' is the same on both captured builds and from run to run, and that is a test (`app/src/core/sim-host/text/gdi-references.test.ts`; `check-text.mjs` reports the numbers): for the bytes of (3a) in the 85 texts whose pen the two builds agree on (and every pixel in the 16 they draw alike); for the euro sign the pen and every pixel outside its glyph in the texts whose pen is the same in every history - every text in Fixedsys, some in Courier (`tests/conformance/gdi/golden/text-path-euro-pens.json`; in `text-control` and `text-path-euro`); for `"@"` the pens of its texts without a byte of `$80` or above, which are the same in every history (`tests/conformance/gdi/golden/text-path-at-pens.json`). `$0C` on the text path has been captured on one build (`text-path-formfeed`), so the rule requires no pen of it; `text-path-euro` too has been captured on one build, so its pens that are the same in every history, which the port gives and the test holds, become required by the rule on the second build's evidence (erratum T2 29).

#### 6.5.4 Whole programs (X3)

Every official example and twenty conformance programs with graphics are run headlessly to a fixed
instruction count with scripted input; the surface hash is committed. The same programs run in
Chromium and WebKit through Playwright; the surface's pixel array, read from the session, must have the
same hash, and a screenshot of the canvas at 100% zoom must show exactly those pixels. This proves
that the pixels do not depend on the browser.

> **Corrected (erratum X3 1).** The committed surface hashes (`tests/conformance/examples/golden/surfaces.json`) come from the port itself (headless under Node, real glyph atlases, virtual time; its `provenance` member says so). The official program under Wine cannot give whole-program pictures that mean anything for Windows (no Fixedsys, its own GDI), so this suite proves stability and independence of browser and system, not agreement with the original; agreement is covered by T2's GDI references and T3's flat-area checks.

> **Corrected (erratum X3 2).** "Twenty conformance programs with graphics" are the thirteen of `trap15-b` and seven of `trap15-a` (`a01, a06, a07, a17, a20, a40, a46`; those that end by clearing the screen are left out), plus four programs of X3's own (`programs/x01` to `x04`). "A fixed instruction count": a run stops at the first 16 ms frame boundary at or after the limit, at the program's halt, or at the time limit, and the count it stopped at is in the golden (erratum X3 3). The browser check compares the screenshot with `screenHash`, the surface with the prompt overlay painted over it, as the Output panel shows it (erratum X3 4).

### 6.6 End-to-end tests

Playwright, projects `chromium` and `webkit`, against the production build served locally. Suites:

- `tests/e2e/editor/`: every editor row of the parity matrix (new, open, save with trailer, reload,
  close prompts, tab model, auto indent, comment and indent, insert/replace, find and replace,
  options dialogs with every control, presets, settings import and export, template, print content,
  assemble with messages and markers, include-file messages, Execute, Load L68, shortcuts on both
  platform key maps).
- `tests/e2e/sim/`: load, run, pause, step, trace, auto trace, run to cursor, rewind, reload, simple and
  advanced breakpoints, register editing rules, memory edit / copy / fill / save, stack view, hardware
  panel (switches, buttons, LEDs, interrupts, auto interval, reset, memory map), keyboard input tasks,
  type-ahead, paste (one line, several lines), dead-key and composed input, task 24 key suppression and
  keyboard release, the keys of 2.9.4 reaching a program (F2, F4, Shift+F2, Alt+Enter), mouse tasks,
  sound busy flag with audio muted, file tasks and the task 58 dialog, logging with both logs and the
  file-exists dialog, output sizes, text wrap, full screen, start-up switches, Execute after a program
  that changed the memory map and the output size (4.7.1).
- `tests/e2e/app/`: mode switch, themes, panel layout persistence, drafts, two windows on one store
  (3.8.6: a file saved in one appears in the other, the save-conflict question, settings, drafts not
  offered twice), offline reload after first load, installed-app manifest, accessibility scan of each
  mode and each dialog with `@axe-core/playwright` (no "serious" or "critical" findings), and for the
  chords of 2.9.3 that the dispatcher cancels: that `defaultPrevented` is true on the event.
- `tests/parity/matrix.json` (X2) lists every row of section 1.3 with a `verifiedBy` kind and the id
  of what covers it. A unit test fails when a row has neither or names a test that does not exist.

  | `verifiedBy` | Meaning | Runs |
  |---|---|---|
  | `web-e2e` | a Playwright test of this section | Chromium and WebKit |
  | `desktop-e2e` | an Electron test (6.7): native menus, file associations, Cmd+Q, Cmd+W, Cmd+N, Ctrl+F4, Ctrl+Tab | the desktop jobs |
  | `unit` | a unit or conformance test | every push |
  | `manual` | an item of `docs/MANUAL-TEST-MAC.md` (6.8) | before each release |

Two rules for these tests:

- **Hold keys and buttons.** A program observes a key through polling. Tests press with a hold
  (`keyboard.down`, wait for the program-visible effect, `keyboard.up`, or `press` and `click` with a
  delay of at least 50 ms). A zero-length press is a legitimate separate test of the input-edge rule
  of 4.3, not the default.
- **What automation cannot show.** Playwright sends keys to the page through its automation channel.
  The browser's own shortcut handling (reload on F5, Safari's menu equivalents, Chrome's F10 menu
  focus) is not on that path, and Playwright's WebKit is not Safari. These tests therefore prove what
  the page does with a key, never what a real browser does with it; the second half is manual (6.8).

> **Corrected (erratum X1 2).** The production build has no page object (`window.__easy68k` exists in development builds only), so the end-to-end suites act through the interface and read what a user sees: bytes in storage through the Files panel's Export... and Import..., the editor's text from the CodeMirror view of the document element (`viewIn()` in `tests/e2e/fixtures/test.ts`). The build is served on a free port with the application's own headers (CSP included); service workers are blocked except in the offline tests (erratum X1 3, 4).

> **Corrected (erratum X1 5a).** The axe scan excludes the Help panel's frame (`.e68-help__frame`): axe cannot run inside a frame sandboxed without scripts, and its content is the original help, not the port's interface. Printing in the tests never opens a print dialog: `tests/e2e/fixtures/printing.ts` replaces `print()` in child frames and reports `afterprint` (erratum X1 5c); what a real print dialog does is the manual list of 6.8.

### 6.7 The desktop app

Two kinds of test, because one tool cannot do both.

**Development build** (`tests/desktop/dev/`, owner DV2): the application started from source with
Playwright's Electron support, on macOS runners. This is where the main process can be inspected:
the settings of 7.6 (web preferences, permission handlers, navigation and window-open blocking,
protocol privileges and content types), the native menu against the command tables in each mode, that
a shortcut runs its command exactly once, that Cmd+C and Cmd+V work in a text field of Simulator mode,
the disk backend and `DiskSyncFiles` against real folders, refusal of a path outside the granted
roots, a second window with its own simulator, and both engines starting under the `app://` protocol.

**Packaged app** (`tests/desktop/packaged/`, owners DV3 and DV5), on `macos-15` (arm64) and on an Intel
runner, against the `.app` the release build produced, with its fuses set and its ad-hoc signature.
Playwright's Electron launcher needs Node's inspector, which the `enableNodeCliInspectArguments` fuse
switches off, so these tests do **not** use it. The harness starts the app's own binary with
`--remote-debugging-port=0 --user-data-dir=<temporary folder>`, reads the port from the
`DevToolsActivePort` file Chromium writes there, and attaches with `chromium.connectOverCDP`. The
fuses of the shipped build are never relaxed for a test.

| # | Check | Owner |
|---|---|---|
| 1 | `codesign --verify --deep --strict` passes; the signature is ad-hoc; the bundle contains both engines, the help, the fonts and the examples; the main binary and every `.node` file have the expected architecture; `npx @electron/fuses read` shows the fuses of 7.6 | DV3 |
| 2 | Launch; the page loads without a Content Security Policy violation; both engines start; the window title is the one of 1.3.3; `window.easy68kDesktop` has exactly the documented functions and the page has no `require` and no `process` | DV3 |
| 3 | A prebuilt `tutorial1.S68` opened with `open -n -a EASy68K.app tutorial1.S68 --args --remote-debugging-port=<p> --user-data-dir=<tmp>` starts Simulator mode with the program loaded and not running (file association path) | DV3 |
| 4 | Quit with a modified document: the prompt appears; Cancel keeps the app running | DV3 |
| 5 | Minimise the window while a program waits in a task 23 delay of 300 units: it finishes within 3.5 s (4.5.5) | DV3 |
| 6 | Open `tutorial1.X68` from a temporary folder; assemble; `tutorial1.L68` and `tutorial1.S68` appear in that folder and equal the goldens | DV5 |
| 7 | Execute, Run; the message area equals, and the hash of the output surface equals, what the headless harness (6.4) computes for the same program in the same job; a screenshot is stored as an artifact | DV5 |
| 8 | Run `fileio.X68`: the file it writes is on disk with the expected bytes as soon as the program has closed it | DV5 |

> **Corrected (erratum DV3 3).** How the packaged checks work (DV3): window titles are read from macOS with System Events (the page cannot read its native title, and the packaged app has no test hooks); check 3 runs `open -n -a <app> <file> --args --remote-debugging-port=<p> --user-data-dir=<tmp>` (erratum DV3 10); check 4 answers DV2's sheet `Leave EASy68K?` with **Stay** and quits with `app.quit()` through the bridge, reading "Modified" from the editor's status row (Cmd+Q and the native menu stay on the manual list; erratum DV3 11); check 5 measures from F9 to `Halted`, noted by the page itself with a MutationObserver, with the window minimised through System Events once the status bar says `Running`, best of up to three runs, and the program's own task 8 delay (300-350 hundredths in D7; erratum DV3 12). Results go to `build/desktop-packaged/` (erratum DV3 14). First runs on GitHub's Mac runners passed checks 1 to 5 on Apple silicon and Intel (erratum DV3 21).

### 6.8 What only a person can check

On a Mac, before each release (`docs/MANUAL-TEST-MAC.md`, owner DOC1):

- First launch of the downloaded app: the Gatekeeper dialogs and the documented way through them, on
  the two most recent macOS versions, Apple Silicon and Intel.
- Double-click on `.X68`, `.L68`, `.S68` in Finder; icons; the app in the Dock; Cmd+Q with unsaved work.
- Sound: tasks 70-77 audible, in order, loops stop on reset.
- **Browser shortcut table.** For Safari, Chrome and Edge on macOS, and Chrome and Edge on Windows:
  each chord of 2.9.3 that the page cancels (F5, F6, F7, F10, Ctrl+S, Ctrl+P, Ctrl+O, Ctrl+F, Ctrl+G,
  Ctrl+R and their Cmd forms) runs the port's command and the browser does nothing of its own. One
  row per browser and chord; a failing cell becomes an entry in `docs/DIFFERENCES.md`.
- Keyboard on a real MacBook: function keys with and without Fn; Shift+F2..F5; the Option chords
  Ctrl+Option+Z, C, U and O; Option+Return; the Touch Bar models; a non-US layout (dead keys and
  Option characters into task 2, `KeyboardEvent.code` mapping for task 19); a held letter key repeats
  in the Output panel and shows no accent menu; a key released while Cmd is held does not stay down
  for task 19; keypad digits.
- Paste into a task 2 prompt with Cmd+V in Safari, Chrome and the desktop app, and with Shift+Insert in
  Chrome on Windows; Paste from the editor's menu, toolbar and context menu in each (note 45).
- Full screen on the built-in display and on an external monitor; Esc reaching a program in Chrome and
  in the desktop app, and leaving full screen in Safari; sharpness of the scaled surface on a Retina
  display; trackpad tap, right-click and drag for the mouse tasks.
- Printing a source file and task 10 output on a real printer.
- A serial adapter with tasks 40-43; two windows, and two machines on a LAN, with the network tasks.
- VoiceOver: menu bar, dialogs, message area, the Output text mirror.
- Safari itself (not the test build of WebKit): the web app, offline reload, `Add to Dock`, and that
  programs exported as a `.zip` from the Safari tab can be imported into the Dock app (R-10); Private
  Browsing: text in every font is the same on every run.
- A long session: one hundred Execute cycles and several hundred assemblies in Safari without a
  failure (R-19).
- The PDF viewer of the stage of additions (`docs/ARCHITECTURE-PLUS.md` P3.4.2): a PDF appears under the production policy in Chrome and Edge on macOS and on Windows, in Safari, and in the desktop app.

On real Windows, once (needs the owner's permission, O-2, because the project rule forbids running the
official binaries on the development host):

- The UNVERIFIED items of trap15-a §12 and trap15-b §15 that Wine cannot settle (GDI, VCL key handling,
  sound, the `fwrite`/`fread` edge cases, the C library's file buffering of 3.8.4), using the programs
  in `tests/conformance/windows-confirm/` (T3), which write their findings to a file.
- The RichEdit spot check of 6.2.2.
- The speed measurement for `DEFAULT_IPS` (P1).

> **Corrected (architect's decision, 22 November 2026; erratum DOC1 10).** The item about pasting gains the words "Cut, Copy and Paste between the editor and another program, in each browser and in the desktop app". It reads: "Paste into a task 2 prompt with Cmd+V in Safari, Chrome and the desktop app, and with Shift+Insert in Chrome on Windows; Paste from the editor's menu, toolbar and context menu in each (note 45); Cut, Copy and Paste between the editor and another program, in each browser and in the desktop app."

### 6.9 Definition of done

Version 1.0.0 may be tagged when all of the following hold on `main`:

1. **Assembler**: for every file of the `official`, `github-mit`, `conformance` and `site` sets the
   `.S68` is byte-identical and the `.L68` is byte-identical after masking line 3, against the Wine
   goldens, with default options; and for a fixed subset of 30 files with each of the eight assembler
   options switched from its default, one at a time. Every exception is listed in `docs/DIFFERENCES.md`
   with its cause, and there are none without a cause.
2. **Simulator**: every self-reporting conformance program (at least 150, covering every instruction
   group of sim-core §3.16 and every non-interactive TRAP #15 task) produces the golden result file;
   at least 20 execution logs totalling at least 100,000 instructions are byte-identical after masking
   the header date; every automatable item of trap15-a §13, hardware §13 and the "affects program
   results" rows of sim-ui §19 has a passing test.
3. **Drawing**: the thresholds of 6.5.
4. **Twins**: zero differences (6.2.1).
5. **Parity**: every row of section 1.3 has an entry in `tests/parity/matrix.json`; every `web-e2e`
   entry passes in Chromium and WebKit, every `desktop-e2e` entry passes in the desktop jobs, every
   `unit` entry passes, and every `manual` entry is signed off in the release's copy of the manual
   list.
6. **Platforms**: the CI matrix of 7.4 is green; the packaged-app checks of 6.7 pass on arm64 and
   Intel.
7. **Offline**: the offline test passes; the app installs in Chromium.
8. **Accessibility**: the automated scan has no serious finding; the manual list is signed off.
9. **Performance**, measured by `tests/perf/` in Chromium on `ubuntu-latest` with the fixed programs
   `spin.X68` (a busy loop) and `draw.X68` (continuous drawing):
   - at the default speed, over 30 s of running `spin.X68`, the increase of `TaskDuration` reported by
     the DevTools protocol's `Performance.getMetrics` is less than 4.5 s (15% of one core);
   - frame intervals taken from `requestAnimationFrame` timestamps while `draw.X68` runs: 95th
     percentile below 20 ms at 60 Hz, and below 12 ms with the 120 Hz frame source of 3.11.1;
   - at `Maximum`, `engine.stepCount` advances by at least 200 million in 10 s;
   - assembling the largest corpus file takes less than one second under Node on the same runner.
10. **Stability of the tests**: the end-to-end suites pass 20 times in a row (`--repeat-each=20`) on
    `ubuntu-latest` in each browser with no failure.
11. **Open verification items**: every UNVERIFIED item of the specs is either confirmed, or listed in
    `docs/DIFFERENCES.md` under "not yet confirmed against the original" with the port's chosen
    behaviour.
12. **Manual**: `docs/MANUAL-TEST-MAC.md` completed for the release candidate.

> **Corrected (erratum X1 8).** Item 8 as tested: `tests/e2e/app/a11y.spec.ts` keeps a short list `ALLOWED` (rule, a pattern on the node, owner, reason). Its one entry is `color-contrast` on text drawn in a syntax colour (the light `Auto` preset's olive and red on white are the original's; 2.8, erratum E3 10); every other serious or critical finding fails.

> **Corrected (erratum P1 1).** Item 9 as measured by `tests/perf/check-perf.mjs`: "at 60 Hz" and "the 120 Hz frame source" are simulated in the browser by an init script that replaces `requestAnimationFrame` with a timer on a grid of 1000/60 or 1000/120 ms that skips the slots the page was too busy for; the application's scheduler runs on it unchanged (in Playwright's WebKit for Windows timers come about every 15 ms, so its figures are for information only, erratum P1 10). The wall-clock thresholds are judged in Chromium on Linux (`--judge strict` judges them everywhere); elsewhere the same figures are printed with "would pass" or "would MISS" (erratum P1 2). TaskDuration is judged at 60 Hz and printed at 120 Hz (erratum P1 3). "The largest corpus file" is judged both as `GFX.X68` alone and as `MAIN.X68` with its includes, as the `assemble()` call with the module compiled (erratum P1 4).

> **Corrected (architect's decision, 22 November 2026; erratum P1 13).** Item 9, third bullet, reads: "at `Maximum`, `engine.stepCount` advances in 10 s by at least 100 million, and by at least 85 % of what the engine alone executes in 5 s on the same runner in the same job (the half of each frame that the governor gives the engine, `SLICE_FRAME_SHARE = 0.5`)". The figure of 200 million assumed an engine of 40 million instructions per second on `ubuntu-latest`. Measured there in Chromium (performance job of run 44988194975): the engine alone executes 32.05 million per second; the governor gives it half of each frame by design (4.1: the other half keeps the window responsive), so about 160 million in 10 s is the most the design allows on that runner, and the port reached 150.4 million with the 60 Hz frame source and 158.9 million with the 120 Hz one, 94 and 99 % of it; on a quiet desktop PC the same build reaches 237 to 248 million. The other three bullets passed there with a wide margin (TaskDuration 1.15 s of 4.5; frame p95 17.4 ms of 20 at 60 Hz and 8.8 ms of 12 at 120 Hz; assembly 217 ms of 1 s). `SLICE_FRAME_SHARE` is not raised: the interface's half of the frame is what the design promises. `tests/perf/check-perf.mjs` measures the engine alone in the same job before the `Maximum` runs and requires both conditions, judged with the 60 Hz frame source and printed for information with the 120 Hz one.

> **Corrected (architect's decision, 22 November 2026; erratum T1 26).** Item 1, "Every exception is listed in `docs/DIFFERENCES.md` with its cause, and there are none without a cause": a run for which the official program gives no result at all (it crashes, shows a message box, or cannot take a file of that size under Wine) is an exception with its cause like any other. It is listed in `docs/DIFFERENCES.md` (part T1, from `docs/differences/T1.md`) and does not count against the item.

> **Corrected (architect's decision, 22 November 2026; erratum T3 14).** Item 2, "every self-reporting conformance program ... produces the golden result file": the goldens were made with the official program under Wine, and for some programs the golden itself is in doubt, or the original's answer is not reproducible. A program whose difference is **accepted** (the cause is known and recorded: the original's answer depends on memory the program did not write, or on a defect of the original that the port does not reproduce on purpose) is listed in `tests/conformance/sim/known-differences.json` and in `docs/DIFFERENCES.md` with its cause, and does not count against the item. A program whose golden is **unconfirmed** (Wine's own behaviour is suspected and only the official program on real Windows can settle it) is listed in the same file and in `docs/DIFFERENCES.md` under "not yet confirmed against the original" with the port's chosen behaviour, as item 11 asks, and the steps to settle it are in `docs/porting/windows-confirmation.md`; it does not count against item 2, and it does count as an open verification item of item 11. A program that differs for any other reason counts against the item.

> **Corrected (architect's decision, 22 November 2026; erratum U2 S6).** The memory view's Live mode at address 0 (sim-ui §19, row Q19: the original does not update a Live view that starts at address 0): the port updates it. That is a deliberate difference, a display defect of the original that would only mislead and that nothing a program does can observe; it is recorded in the fragment `docs/differences/U2.md`.

---

## 7. Build, continuous integration, release

### 7.1 Toolchain and versions

Node 24 and npm workspaces. Emscripten 7.0.0 (pinned; toolchain §2). Vite, React, CodeMirror 6,
Vitest, Playwright, Electron and electron-builder at the current stable release when W0 runs;
TypeScript at the newest release that the current `typescript-eslint` supports (6.0.x in wave 0; it
moves to 7 by a deliberate pull request once `typescript-eslint` accepts it; erratum W0 1). All are
pinned exactly by `package-lock.json` and updated only by deliberate pull requests. TypeScript is
strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`).

Workspaces: `app`, `desktop`, `tests`. The engines are not npm workspaces; they are built by scripts.

W0 installs the **complete** set of development dependencies, so that no later package has to change a
`package.json` or the lockfile (8): TypeScript, Vite, `@vitejs/plugin-react`, Vitest,
`fake-indexeddb`, Playwright, `@axe-core/playwright`, ESLint, Prettier, Electron, `electron-builder`,
`@electron/fuses`, `@electron/rebuild`, and `@napi-rs/canvas` (used only by the font-atlas tool). The
runtime dependencies are the closed list of 3.1.

### 7.2 npm scripts (root `package.json`, owner W0)

| Script | Does |
|---|---|
| `setup:emsdk` | installs the pinned Emscripten into `.toolchain/emsdk` (`tools/setup-emsdk.ps1` / `.sh`) |
| `build:engines` | runs each engine's own build script; output in `engine/dist/` |
| `fetch:engines` | downloads `engine-dist.zip` of the latest release into `engine/dist/` (for contributors without Emscripten) |
| `dev` | Vite dev server for `app` (needs `engine/dist/` to assemble or run; warns when it is missing; erratum W0 3); the page is served without the Content Security Policy, which only the production build adds (7.6) |
| `build` | production build of `app` into `app/dist/` |
| `preview` | serves `app/dist/` |
| `typecheck`, `lint`, `format` | `tsc --noEmit` for all workspaces; ESLint; Prettier |
| `test` | Vitest: unit tests of `app` |
| `test:conformance` | Vitest project `tests/conformance` (headless engine tests, pixel tests, goldens) |
| `test:e2e` | Playwright, Chromium and WebKit |
| `test:all` | the three above |
| `oracle:wine:build`, `oracle:wine:asm`, `oracle:wine:sim` | build the container; regenerate assembler and simulator goldens |
| `oracle:gdi` | build and run the GDI capture (Windows only) |
| `oracle:twins` | build and compare the native twins (Windows only) |
| `import:help`, `import:examples` | copy the original help and the official examples from `reference/` into `app/public/` (run once by H1; the results are committed) |
| `desktop:dev` | Electron against the Vite dev server |
| `desktop:pack` | unpacked `.app` for the host architecture |
| `desktop:dist` | signed `.dmg` and `.zip` for one architecture (`npm run desktop:dist -- --arm64` or `-- --x64`, electron-builder's switches; erratum DV3 1) |
| `desktop:test` | the desktop tests of 6.7: `-- dev` against the development build, `-- packaged` against a built `.app` |
| `fonts:atlases` | regenerate the outline-font atlases from `tools/fonts-src/` (3.5.1) |

### 7.3 Engines in CI

Built `.wasm` and `.mjs` files are **not committed**. `engine/dist/` stays git-ignored.

- A reusable workflow `.github/workflows/engines.yml` runs on `ubuntu-latest`: restores
  `.toolchain/emsdk` from the cache (key: Emscripten version), runs `npm run build:engines`, uploads
  the artifact `engine-dist`. The whole job is skipped and the artifact restored from the cache when the
  key `hash(engine/** , tools/build-engines.mjs, emsdk version)` is unchanged.
- Every other job downloads `engine-dist`. No job except this one needs Emscripten.
- The Linux build is the canonical one. The Windows CI job also builds the engines once per week and
  compares the `.wasm` SHA-256 with the Linux build; a difference is reported (not a failure) so that
  developers on Windows know whether their local builds match.
- Each release attaches `engine-dist.zip`, which `fetch:engines` uses.

### 7.4 Workflows

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | push, pull request | `engines` (reusable); `check` on ubuntu: typecheck, lint, format check; `unit` on ubuntu, windows, macos: `npm test`; `conformance` on ubuntu and macos: `npm run test:conformance` against committed goldens; `e2e` on ubuntu (chromium, webkit), macos (chromium, webkit) and windows (chromium, webkit); `e2e-stability` on ubuntu (chromium, webkit): the suites 20 times in a row (6.9 item 10), on a manual run and on a `v*` tag (erratum W0 6); `windows-oracles` on windows: GDI capture regenerate-and-compare, native twins, command-line assembler oracle; `desktop-dev` on macos-15: the development-build tests of 6.7 (only when `desktop/**` or `app/**` changed). Every job is written by W0 with a guard that reports it as skipped while the script or folder it needs does not exist yet (8) |
| `pages.yml` | push to `main` | `engines`; build `app` with the repository's base path; upload the Pages artifact; deploy with `actions/deploy-pages` |
| `oracle.yml` | weekly, manual | build the Wine container (layer cache); regenerate goldens for the tracked sets and open a pull request if any changed; fetch the `site` set, run it, compare hashes with the manifest; download the single-step suites and re-check the frozen baseline |
| `release.yml` | tag `v*` | `engines`; `web`: build and zip `app/dist`; `mac-arm64` on macos-15 and `mac-x64` on the Intel runner (`macos-15-intel` while GitHub offers it; otherwise built on arm64 and tested under Rosetta 2): `desktop:dist`, the packaged-app checks of 6.7; `publish`: draft GitHub Release with the two `.dmg`, two `.zip`, `engine-dist.zip`, the web zip and `SHA256SUMS.txt` (names: `EASy68K-<v>-arm64.dmg`, `EASy68K-<v>-x64.dmg`, `EASy68K-<v>-arm64-mac.zip`, `EASy68K-<v>-x64-mac.zip`, `engine-dist.zip`, `easy68k-cross-platform-web-<v>.zip`; a `checksums` job writes `SHA256SUMS.txt` and the notes on every run; errata DV3 2 and 20) |

Caches: npm (`actions/setup-node`), Emscripten (by version), engine artifact (by source hash),
Playwright browsers (by Playwright version), Electron and electron-builder downloads, Docker layers
(buildx, GitHub cache), single-step data (by upstream commit).

All actions are pinned by commit hash. Workflows have `permissions: contents: read` by default; only
`pages.yml` (pages, id-token) and the `publish` job (contents: write) ask for more.

> **Corrected (erratum DV1 1).** The service worker and the manifest tags are written by a step after the build: `pwaPlugin()` in `app/vite.config.ts` (since gate I1) runs `app/src/features/pwa/build/pwa-build.mjs` at the end of every production build (tags in the built `index.html`, the precache list with size and SHA-256 of every file, and `sw.js`); `pages.yml` runs `finish-build.mjs app/dist` again as an idempotent safety net. The development server has no manifest and no worker.

> **Corrected (erratum DV1 7).** `pages.yml`: the base path comes from `actions/configure-pages` (`base_path` plus `/`, as `EASY68K_BASE`), so forks work unchanged; the build job needs `pages: read` besides `contents: read`; it refuses to deploy unless `engines.yml` reports both engines, so the previous site stays online rather than one that cannot assemble. In Git Bash on Windows a hand-run of the step needs `MSYS_NO_PATHCONV=1`.

> **Corrected (erratum T1 14).** `oracle.yml` (T1): the Wine image is cached as one file (`docker save` / `docker load`) with `actions/cache`, keyed by the hash of the Dockerfile and the scripts it copies (no buildx actions). The job that runs Docker, Wine and the official programs has a read-only token; a second job, `propose`, with `contents: write` and `pull-requests: write`, receives the changed goldens as an artifact, accepts only paths under `tests/corpus/manifest.json` and `tests/conformance/`, and opens the pull request with `gh`; so `oracle.yml` is a third workflow that asks for more than read access, in one job. A pull request opened with the workflow's token does not start `ci.yml` by itself (its text says to close and reopen it).

### 7.5 Versioning and release

- One version number in the root `package.json`; `app/src/build-info.ts` is generated at build time
  with the version, the commit and the build date.
- Tags `vX.Y.Z` on `main` create a draft release; a person publishes it after 6.8.
- The web app on Pages is always the head of `main`; the About box shows version and commit.
- The service worker is versioned by the build hash; a new deployment shows
  `A new version is available. Reload` and never reloads by itself while a program is running or a
  document is modified.
- The update check of the About box reads the latest release tag from the GitHub API and compares it
  with the running version; it sends nothing but the request itself.

> **Corrected (erratum DV1 2).** "Versioned by the build hash": the version is the first 20 hex digits of a SHA-256 over the worker's bundled code and the precache list (paths, sizes, hashes); the cache is `easy68k-v-<version>`.

> **Corrected (erratum DV1 3).** Two versions never mix: installation fetches each file with `cache: 'no-cache'` and keeps it only if size and SHA-256 match the list (one mismatch fails the whole installation; unchanged files are copied from the previous cache). The first installation does not claim the page that registered it; a new version waits until the student presses `Reload` on `A new version is available.` (shown with `duration: 0`), and only that page reloads. The worker answers each page from the cache of the version it was loaded with and deletes an old cache once no open page uses it. Known remaining mix: a help page opened in a frame by an old page after the new version took over is answered by the new version.

> **Corrected (erratum DV1 4).** The worker leaves to the network everything that is not a GET for a listed file under its scope (`sw.js`, source maps, `https://api.github.com`, other origins). A navigation to the scope with any query (`?open=`, `?example=`) is answered with `index.html`; paths are compared with percent-escapes decoded; a range request gets the whole file.

> **Corrected (erratum DV3 9).** One version number: release.yml passes `-c.extraMetadata.version=<root version>` (the frozen `desktop/package.json` says `0.0.0`), so the app, its file names and the window title carry the root `package.json`'s version; a tag push fails unless the tag is `v<root version>`. The web zip of a release is built with the relative base `./`, so it works from any folder of any server (erratum DV3 13). Every run of release.yml yields `SHA256SUMS.txt` and checks the downloads (erratum DV3 20).

### 7.6 Security posture

Both deliveries:

- No remote code and no remote content. Everything is served from the app's own origin. The only
  network request the app can make is the update check (`https://api.github.com`), and only when the
  user presses `Check`.
- Content Security Policy:
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'
  https://api.github.com; worker-src 'self'; frame-src 'self'; manifest-src 'self'; base-uri 'none';
  form-action 'none'`.
  `'unsafe-inline'` for styles is needed by the editor component, which injects style elements; scripts
  stay strict. The policy is **added to `index.html` by the production build** (a Vite
  `transformIndexHtml` plugin with `apply: 'build'`, as a `<meta http-equiv>` tag, because GitHub Pages
  cannot send headers), and the desktop app sends it as a response header as well. The development
  server serves the page without it: the React plugin injects an inline script there, which the policy
  would rightly block. The tests for violations run against the production build.
- The help pages are third-party HTML: they are shown in an `iframe` with `sandbox="allow-same-origin"`
  (no scripts, no forms, no navigation of the top window); links to other sites open in the system
  browser after the user confirms.
- 68000 programs are data. What a program can reach through file names is bounded (3.8.4): the browser
  store or the opened folder in a browser, the granted roots in the desktop app.
- No analytics, no cookies.

Desktop app (owner DV2):

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`,
  `allowRunningInsecureContent: false`, no `remote` module, no `webview` tag.
  `backgroundThrottling: false` (4.5.5).
- **Protocol.** The window loads `app://easy68k/index.html`. The scheme is registered before the app is
  ready with `protocol.registerSchemesAsPrivileged` and the privileges `standard`, `secure`,
  `supportFetchAPI`, `corsEnabled` and `stream`; without `supportFetchAPI` the engines' loaders, which
  use `fetch`, could not load the `.wasm` files, the fonts or the help. The handler serves only files
  inside the packaged `app/dist` and sets `Content-Type` from a fixed extension table (`.wasm` as
  `application/wasm`, which streaming compilation requires; `.mjs` and `.js` as `text/javascript`;
  and so on; an unknown extension is refused). `features/pwa` registers no service worker when
  `platform.kind` is `desktop`: the files are already local.
- `will-navigate` is cancelled for every other URL; `setWindowOpenHandler` denies all windows and sends
  `http(s)` links on the allow list (the repository, `www.easy68k.com`) to the system browser. A second
  application window is created by the main process only (`Platform.newWindow`).
- The preload script exposes one object, `window.easy68kDesktop`, with a fixed set of functions
  (3.13). Every IPC handler validates its arguments and the window that sent them. File-system
  handlers, asynchronous and synchronous alike, accept only paths inside **granted roots**: folders
  the user chose in a native dialog, the folder of a file the user chose in a native dialog or opened
  through a file association or a drop, and the app's own user-data folder. The list is kept in the
  main process. Serial and network handlers act only on the devices of the calling window.
- **Synchronous bridge calls** (`ipcRenderer.sendSync`) are used only where a host method of the engine
  must answer at once: program files on disk (3.8.4), serial and network control calls (3.3.4), and the
  flush at window close. Everything else is asynchronous.
- **Native menu.** The menu bar always starts with the standard macOS application menu (About,
  Settings..., Services, Hide, Quit), followed by the mode's own menus in the original's order, with a
  standard `Window` menu before `Help`. Text editing with Cmd+X, C, V, A and Z works in a macOS app
  only through menu items with the matching roles, so the Edit menu's Cut, Copy, Paste and Select All
  are role items in Editor mode, and in Simulator and EASyBIN mode, whose originals have no Edit menu,
  a standard `Edit` menu of role items is inserted before `Window`. Command items show their shortcut
  but never act on it: in `before-input-event` the main process calls
  `webContents.setIgnoreMenuShortcuts(true)` for every key that is not one of the role chords, so the
  page's dispatcher is the only handler of a command chord (it runs once, and task 24 and the Output
  panel rules of 2.9.4 decide about it, not the menu); as a second guard the click handler ignores an
  activation whose event says `triggeredByAccelerator`. While a modal dialog is open, and during a
  load, the command items are disabled; the role items stay enabled for the dialog's text fields.
  While task 24 has key commands switched off, the eleven items show no shortcut, as in the original.
- **Permissions.** Every permission request of the page is denied; it needs none. Full screen is done
  by the window, not by the page (2.5). Pasting goes through the native paste role or
  `Platform.pasteIntoFocus`, copying through the native copy role, so no clipboard permission is
  involved. Serial ports are not a page permission at all: they live in the main process.
- Fuses: `runAsNode` off, `enableNodeCliInspectArguments` off, `onlyLoadAppFromAsar` on, ASAR integrity
  on. Native modules (`serialport`'s `.node` file) are unpacked from the archive (`asarUnpack`), built
  or fetched for each architecture, and signed like the rest.
- Signing: ad-hoc, in an `afterPack` step after the fuses are set: first every `.node` and `.dylib`,
  then the helpers and frameworks, then the app (`codesign --force --sign -`). The hardened runtime is
  not enabled (it is only required for notarisation, which needs a Developer ID). The consequences for
  users are in section 11.
- No automatic updater.

> **Corrected (erratum DV2 6).** Start-up information is asynchronous: `createDesktopPlatform()` asks the main process once with `ipcRenderer.invoke` for the system, the start-up arguments and the user-data folder and returns a Promise (`main.tsx` accepts `Platform | Promise<Platform>`). No other synchronous call is used than those this section allows.

> **Corrected (erratum DV2 7).** The fixed set of `window.easy68kDesktop` is `DESKTOP_BRIDGE_KEYS` in `app/src/platform/desktop.ts`: `version`, `startup`, `fs`, `fsSync`, `onFsChange`, `setMenu`, `onMenuCommand`, `onOpenFiles`, `setTitle`, `openExternal`, `showHelp`, `newWindow`, `pasteIntoFocus`, `quit`, `setFullScreen`, `onFullScreenChange`, `print`, `showOpenDialog`, `showSaveDialog`, `chooseFolder`, `grantDroppedFile`, `devices`. Every handler checks that the message comes from the main frame of a window the main process created showing the app's page, and refuses anything else (`refused: ...`).

> **Corrected (erratum DV2 10).** On Windows and Linux each window has its own native menu with the bar hidden (the page shows its own), without the macOS-only roles, and with `registerAccelerator: false`; no key reaches the menu there. On macOS only the chords of the role items the window's menu has reach the menu (`roleChordsOf`), judged by the character the key types (so Cmd+C works on Dvorak and AZERTY) and by position only when it types no ASCII letter or digit; in Editor mode Undo and Redo are command items and stay with the page. With no window open the bar shows a small menu of its own (`windowlessMenuTemplate`: application menu, `File > New Window`, Window, Help).

> **Corrected (erratum DV2 11).** The desktop's help window is a separate window per application window that loads `app://easy68k/help/<page>` with JavaScript off and no preload script; links inside the help stay there, allow-listed web addresses open in the system browser after a confirmation, everything else is cancelled; `target="_blank"` links to help files (the Quick Reference PDF) show in the help window itself. `showHelp(page)` returns false for anything but a relative `.htm`/`.html` path inside the help folder.

> **Corrected (erratum DV2 13a).** `app://` also serves `.pdf` (`application/pdf`) and `.md` (`text/plain`); a test fails when `app/public` or the build holds an extension the table lacks. A single `Range: bytes=...` gets 206 with `Content-Range` (416 beyond the end); several ranges get the whole file with 200; every response says `Accept-Ranges: bytes`.

> **Corrected (erratum DV2 14).** The packaged app loads the built web app from `<resources>/app/dist` or `<app path>/app/dist`; from the repository it is `app/dist`. `EASY68K_APP_DIST`, `EASY68K_DEV_SERVER_URL` and the test switch `EASY68K_DESKTOP_TEST_WINDOWS` are honoured only when the app is not packaged (`developmentOverrides`), so whoever controls a packaged app's environment cannot make it serve another folder or install the test hooks.

> **Corrected (erratum W3 18).** The page describes the whole native menu bar: `buildNativeMenu()` (`commands/native-menu.ts`) builds the application menu (About, Settings... in Editor mode, New Window, Services, Hide, Quit = the mode's Exit command), the mode's menus and the standard Edit and Window menus, and the bootstrap hands it to `Platform.setNativeMenu` whenever it changes.

> **Corrected (erratum DV3 5).** Packaging as built (DV3): besides the four fuses of this section, `EnableNodeOptionsEnvironmentVariable` is off (with it on, `NODE_OPTIONS=--require ...` would run any script in the main process) and `GrantFileProtocolExtraPrivileges` is off (the app loads only `app://`; erratum DV3 16); every other fuse keeps Electron's default (`SHIPPED_FUSES`). The web build lies next to the archive, in `Contents/Resources/app/dist`, sealed by the code signature rather than the ASAR integrity check (erratum DV3 6). `@serialport/bindings-cpp` ships one N-API binary for both Mac architectures; nothing is compiled, and `after-pack.mjs` thins every `.node` file to the architecture being built with `lipo -thin` (erratum DV3 7). `after-pack.mjs` does native modules, fuses and the ad-hoc signature itself, in that order (`.node` and `.dylib` files, helper executables, frameworks, helper apps, the app; `codesign --force --sign - --timestamp=none`, then `--verify --deep --strict`); with a Developer ID in the secrets electron-builder signs and notarises instead, a path that has never run (erratum DV3 8). The bundle identifier is `org.easy68k-port.easy68k` and must never change after the first release; `productName` (`EASy68K`) names the user-data folder and must not change either (errata DV3 4, 19). The minimum macOS is Electron's own `LSMinimumSystemVersion`, measured as 13.0 (Ventura) on both architectures; release.yml reads it from the built bundle into the release notes (erratum DV3 17).

> **Corrected (erratum H1 11).** WebKit hands the navigation of a frame sandboxed without `allow-scripts` to no service worker, so the Help frame could not load offline there. In the web app, in WebKit (`engineOf` of `app/src/core/help/engine.ts`, the one engine rule, which the Files panel's storage notice uses too), while a service worker controls the page, the Help frame is `sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"`; everywhere else, the desktop app included, it stays `sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"`. No script runs in a help page all the same: `tools/import-help.mjs` puts `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">` first in the head of every page and refuses (exit 1, naming the file) a page with a script element, an inline event handler attribute, a `javascript:` address or a link to an address of the site outside `help/`; the service worker answers a frame navigation (`request.destination` `iframe` or `frame`) only below `help/` and every other one with a network error, so the frame can show nothing but Help.

---

## 8. Repository layout and ownership

The owner of a path is the only package that edits it. "A > B" means A creates the file (a stub, a
skeleton or a first version) and B owns it from then on. `**` means everything below.

```
/
  package.json, package-lock.json, tsconfig.base.json, eslint.config.js,
  .prettierrc, .editorconfig, .gitignore                                   W0 > gates (see rules)
  .gitattributes, .prettierignore                                          W0 > gates (erratum W0 4)
  LICENSE                                                                  (exists)
  README.md, CHANGELOG.md                                                  DOC1
  .github/workflows/ci.yml, engines.yml                                    W0 > gates
  .github/workflows/pages.yml                                              DV1
  .github/workflows/release.yml                                            DV3
  .github/workflows/oracle.yml                                             T1
  docs/
    ARCHITECTURE.md                                                        architect
    porting/*.md (the nine specs)                                          their authors; see "corrections" below
    porting/errata/<package-id>.md                                         each package, its own file
    porting/easybin.md                                                     B1
    porting/cpu-deviations.md                                              T4
    porting/gdi-deviations.md                                              SH2
    porting/speed.md                                                       P1
    differences/<package-id>.md                                            each package, its own file
    requests/<package-id>.md                                               each package, its own file
    integration/wave1.md, wave2.md, rc.md                                  I1, I2, I3
    ENGINE-BINDING.md                                                      W4
    DIFFERENCES.md, USER-GUIDE.md, CONTRIBUTING.md, MANUAL-TEST-MAC.md     DOC1
  engine/
    asm/**, sim/**                                                         the engine packages (not in this document)
    dist/**                                                                build output, git-ignored
  tools/
    emsdk-env.ps1, build-asm-oracle*.ps1, compare-asm-oracle.ps1           (exist)
    setup-emsdk.ps1, setup-emsdk.sh, build-engines.mjs, fetch-engines.mjs,
    vite-csp-plugin.mjs                                                    W0
    build-info.mjs                                                         W0 (erratum W0 4)
    typecheck.mjs, desktop-dev.mjs                                         W0 > gates (erratum W0 4)
    import-help.mjs, import-examples.mjs                                   H1
    fetch-site-examples.mjs                                                T1
    make-font-atlases.mjs, fonts-src/**                                    T2
  app/
    package.json, tsconfig.json, vite.config.ts, vitest.config.ts,
    index.html                                                             W0 > gates
    public/
      help/**, examples/**                                                 H1
      fonts/**                                                             T2
      icons/**, manifest.webmanifest                                       DV1
    src/
      main.tsx, App.tsx, bootstrap.ts                                      W3
      App.test.tsx                                                         W0 > W3 (erratum W0 4)
      build-info.ts (generated)                                            W0
      sw.ts                                                                DV1
      contracts/**                                                         W1
      engine/index.ts, asm.ts, sim.ts, loader.ts, testing.ts,
         *.test.ts (except fake-asm.test.ts)                               W4 (erratum W1 7)
      engine/fake-asm.ts, fake-asm.test.ts                                 W1
      fs/vfs.ts, write-behind.ts, memory-backend.ts, backend-contract.ts,
         sync/memory.ts                                                    W1
      fs/browser-backend.ts, zip.ts                                        FS1
      fs/fsaccess-backend.ts                                               FS2
      fs/disk-backend.ts, sync/disk.ts                                     DV2
      fs/sync/cached.ts                                                    W1 > SH6
      platform/web.ts                                                      W3
      platform/desktop.ts                                                  DV2
      state/**, commands/** (except tables/easybin-menu.ts)                W3
      commands/tables/easybin-menu.ts                                      W3 > B1
      styles/**, ui/components/**                                          W2
      ui/shell/**                                                          W3
      ui/editor/**                                                         E2
      core/
        codec/**, paths/**                                                 W1
        settings/service.ts                                                W3
        settings/defaults.ts                                               W1
        settings/dat-codec/**                                              E4
        documents/**                                                       E1
        highlight/**                                                       E3
        help/**                                                            H1
        listing/**                                                         W1 > U1
        breakpoints/**                                                     U3
        easybin/**                                                         B1
        print/**                                                           E6
        run/**                                                             SH8
        sim-host/
          index.ts                                                         SH8
          io.ts, text/**, fonts/**                                         W1 > SH3
          surface/** (except the next line)                                W1 > SH1
          surface/ellipse.ts, surface/widepen.ts, surface/tables/**        SH1 > SH2
          input/**                                                         W1 > SH4
          audio/**                                                         W1 > SH5
          files/**, printer.ts                                             W1 > SH6
          hardware/**                                                      W1 > SH7
          log/**                                                           W1 > U4
          serial/null.ts, net/null.ts                                      W1
          serial/desktop.ts, net/desktop.ts                                W1 > DV4
      features/
        index.ts                                                           W3
        documents/**                                                       W3 > E1
        editor/**                                                          W3 > E2
        highlight/**                                                       W3 > E3
        options/**                                                         W3 > E4
        assemble/**                                                        W3 > E5
        find/**, print/**                                                  W3 > E6
        files/**                                                           W3 > FS1
        files-fsaccess/**                                                  W3 > FS2
        help/**                                                            W3 > H1
        run/**                                                             W3 > SH8
        sim-main/**                                                        W3 > U1
        output/**                                                          W3 > SH4
        memory/**, stack/**                                                W3 > U2
        hardware/**                                                        W3 > SH7
        breakpoints/**                                                     W3 > U3
        log/**, sim-options/**                                             W3 > U4
        sim-files/**                                                       W3 > SH6
        audio/**                                                           W3 > SH5
        desktop-devices/**                                                 W3 > DV4
        easybin/**                                                         W3 > B1
        pwa/**                                                             W3 > DV1
  desktop/
    package.json, tsconfig.json                                            W0 > gates
    src/main.ts, windows.ts, preload.ts, protocol.ts, menu.ts, fs-ipc.ts,
        sync-ipc.ts, associations.ts, security.ts                          DV2
    src/net.ts, src/serial.ts                                              DV4
    electron-builder.yml, build/**, scripts/**                             DV3
  tests/
    package.json, vitest.workspace.ts                                      W0 > gates
    tsconfig.json, lint/**                                                 W0 > gates (erratum W0 4)
    playwright.config.ts                                                   W0 > X1
    corpus/**                                                              T1
    oracle/asm-cli/**                                                      W0 > T1
    oracle/wine/Dockerfile, wine/common/**, wine/asm/**                    T1
    oracle/wine/sim/**                                                     T3
    oracle/gdi-capture/**                                                  T2
    oracle/native-twin/**                                                  T4
    conformance/asm/**                                                     T1
    conformance/gdi/** (except cases-ellipse.ts)                           T2
    conformance/gdi/cases-ellipse.ts                                       SH2
    conformance/sim/**, conformance/windows-confirm/**                     T3
    conformance/cpu/**                                                     T4
    conformance/examples/**                                                X3
    e2e/fixtures/**, e2e/editor/**, e2e/app/**                             X1
    e2e/sim/**                                                             X2
    parity/**                                                              X2
    a11y/**                                                                Q1
    desktop/dev/**                                                         DV2
    desktop/packaged/** (harness and checks 1-5)                           DV3
    desktop/packaged/programs/** (checks 6-8)                              DV5
    perf/**                                                                P1
    integration/**                                                         I1, I2, I3 (one folder each)
  build/, .toolchain/, reference/                                          git-ignored
```

Rules that keep packages apart:

- **Unit tests** live next to the code (`x.ts`, `x.test.ts`) and belong to the code's owner.
- **Shared configuration is frozen after wave 0.** The root files, the three `package.json` files of
  the workspaces, the lockfile, `ci.yml`, `engines.yml`, `app/index.html`, the Vite and Vitest
  configurations are written by W0 and afterwards changed only at an integration gate (I1, I2, I3).
  W0 makes that workable in three ways: it installs the **complete** development-dependency set up
  front (7.1); it writes every CI job from the start, each guarded so that it is skipped while the
  script or folder it needs does not exist yet; and it configures the test runners by glob
  (`tests/vitest.workspace.ts` picks up every `tests/conformance/*/vitest.config.ts`, which belongs to
  the package that owns the folder). Packages run `npm ci`, never `npm install <package>`. A package
  that needs a new dependency, script or CI change writes it to `docs/requests/<package-id>.md` and
  works behind a local guard until the next gate applies it.
- **Corrections to the specs.** A package that finds an error in a spec writes it to
  `docs/porting/errata/<package-id>.md` (what the spec says, what the source says, citation). DOC1 merges
  the errata into the specs at the end of each wave. A package acts on its own erratum at once.
- **Differences from the original.** Every deliberate difference a package introduces goes to
  `docs/differences/<package-id>.md`; DOC1 builds `docs/DIFFERENCES.md` from these and from 1.4.
- **A contract is wrong.** The package writes the problem to its errata file under the heading
  `Contract`, uses a local adapter, and tells W1 in its result. W1 changes `contracts/` between waves.
- **Stubs.** A file marked "W1 > X" or "W3 > X" exists from wave 0 as a stub with its final exports.
  X replaces the body and never the exported names or constructor signatures (those are contract).
- **Fixes after a wave.** Integration packages (I1, I2, I3) do not edit other packages' source files.
  They write defect entries naming the owning package; the owner fixes them in a follow-up round.
- **Fixtures.** A package that needs a file from `reference/` in a tracked test copies it into its own
  directory, and only if section 6.3 allows redistribution.

---

## 9. Work breakdown

Package ids are chosen so that they cannot be mistaken for 68000 registers, function keys or S-record
types: `W` = wave zero, `FS` = file system, `E` = editor, `SH` = simulator host, `U` = simulator
interface, `T` = test oracles, `DV` = delivery, `H` = help, `B` = EASyBIN, `X` = end-to-end tests,
`P` = performance, `Q` = accessibility, `DOC` = documentation, `I` = integration gates.

Model tiers: **strongest** = the strongest model, for packages where a wrong inference is expensive;
**mid** = ordinary implementation and interface work; **small** = mechanical work.

Every package, in addition to what is listed: unit tests for its own code; no file outside its paths;
an entry in `docs/differences/` for each deliberate difference; requests for shared configuration in
`docs/requests/`; a short result listing what was verified by running, what was not, and any erratum.
"Read" lists what to read besides sections 0 and 8 of this document.

Two packages outside this document are dependencies: **the simulator engine** (`engine/sim`) and **the
assembler engine** (`engine/asm`). Both modules exist and were still changing when this was written;
W4 is the one place that absorbs a change. `fake-asm.ts` is a scripted stand-in for unit tests that
need a particular assembler result, not a substitute for the engine in acceptance tests.

### 9.1 Wave 0 - foundation (in order: W0, then W1 and W2 together, then W3 and W4 together)

**W0 - Scaffolding** - tier mid - depends on: nothing
- Read: 7, 3.1, 8 (the rule on shared configuration); toolchain.
- Outputs: the root files, `app/`, `desktop/` and `tests/` package skeletons with the **complete pinned
  development-dependency set of 7.1**, `tools/setup-emsdk.*`, `tools/build-engines.mjs`,
  `tools/fetch-engines.mjs`, `tools/vite-csp-plugin.mjs` (the policy of 7.6, production build only),
  `ci.yml` with every job of 7.4 behind its guard, `engines.yml`, `tests/vitest.workspace.ts` and
  `tests/playwright.config.ts` configured by glob, the ESLint import rules of 3.1, the hand-written
  files of `build/oracle` moved to `tests/oracle/asm-cli/` (toolchain §9, last paragraph).
- Acceptance: on Windows, macOS and Linux `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run build` succeed with a placeholder page; `npm run dev` serves the page and a Chromium page
  load shows the React component with no console error; the built `index.html` carries the policy and
  the served development page does not; a fixture with a forbidden import fails lint;
  `npm run build:engines` calls the `engine/asm` and `engine/sim` build scripts and reports clearly
  when one is missing; CI is green with every not-yet-possible job reported as skipped.

**W1 - Contracts, base utilities and stubs** - tier mid - depends on: W0
- Read: 3 (all), 5.1; `engine/sim/sim68k.mjs` (the `SimHost` typedef, `HOST_DEFAULTS`, the class).
- Outputs: `app/src/contracts/**` (`engine.ts`, `host.ts`, `devices.ts`, `fs.ts`, `documents.ts`,
  `settings.ts`, `run.ts`, `store.ts`, `commands.ts`, `features.ts`, `platform.ts`, `index.ts`);
  `engine/fake-asm.ts` (a scripted `AsmEngine`); `fs/vfs.ts` (with per-path ordering, `appendFile`,
  `subscribe`), `fs/write-behind.ts`, `fs/memory-backend.ts`, `fs/sync/memory.ts`,
  `fs/backend-contract.ts` (a reusable test suite every backend must pass); `core/codec/cp1252.ts`;
  `core/paths/winpath.ts`; `core/settings/defaults.ts`; `core/sim-host/serial/null.ts`, `net/null.ts`;
  and **a stub at its final path for every class of 3.3.1 and for `ListingView`, `CachedSyncFiles`,
  `DesktopSerial` and `DesktopNet`** (3.1).
- Acceptance: every declaration of section 3 exists with the same names (a test compares the exported
  names with a list kept in the test); every stub can be constructed with its declared `Deps`, and a
  host composed of the stubs has exactly the keys of the engine's `HOST_DEFAULTS` and lets the engine's
  own fixtures run to their halt under Node; Windows-1252 round trip for all 256 bytes; `vfs.resolve`
  cases (backslash, mixed case, `..` inside and outside the mount, drive letter); two overlapping
  writes to one path finish in call order; a subscriber sees local and backend-reported changes;
  snapshot limits; defaults equal editor-ui §11.4 and sim-ui §14.3 (table-driven); the null devices
  return the values of 3.3.4.

**W2 - Design tokens and component kit** - tier mid - depends on: W0
- Read: 2.6-2.8, 2.11; hardware §2.1 (masked fields); sim-ui §4.1, §4.4 (register fields).
- Outputs: `app/src/styles/**`; `app/src/ui/components/**`: `Button`, `IconButton`, `Toolbar`,
  `MenuBar`, `Menu`, `ContextMenu`, `Dialog`, `MessageBox`, `Tabs`, `Splitter`, `TextField`,
  `MaskedField` (fixed-width overwrite field with blank character `0`, hex or binary or decimal),
  `SpinField`, `Checkbox`, `RadioGroup`, `Select`, `ListBox`, `DataGrid`, `VirtualList`, `Tooltip`,
  `Toast`, `icons.svg`, and a gallery page at `?gallery`.
- Acceptance: `MaskedField` behaves as hardware §2.1 and sim-ui §4.4 describe (unit tests); keyboard
  behaviour of menu bar, toolbar, tabs and dialog follows 2.11; the gallery has no serious finding in an
  automated accessibility scan in both themes; a script checks the contrast rules of 2.8.

**W3 - Application shell** - tier strongest - depends on: W1, W2
- Read: 1.3-1.5, 2.1-2.4, 2.7, 2.9, 2.10, 3.8.6, 3.10, 3.12, 3.13.
- Outputs: `main.tsx`, `App.tsx`, `bootstrap.ts`; `state/**`; `commands/**` with the tables written
  from 1.3 and 1.5; `ui/shell/**` (menu bar, toolbar, mode switch, the workspace frames of 2.2 and 2.3
  with their panel regions and splitters, status bars, dialog host, toasts); `features/index.ts` and a
  stub `index.ts` for each of the 24 features; `core/settings/service.ts`; `platform/web.ts`.
- Acceptance: the app starts with the stub services of 3.12.3 and shows three modes; menus and toolbars
  equal the tables (snapshot generated from the tables and checked against 1.3 by hand once); the
  dispatcher follows 2.9.1 for the Windows and macOS key maps, tested with recorded key and code pairs
  including Option chords (`key` `ø` with `code` `KeyO`) and a non-Latin layout; `preventDefault()` is
  called for the chords listed in 2.9.3 (`defaultPrevented` asserted in Chromium and WebKit); no
  command runs while a modal dialog is open, from a key, a toolbar or `onNativeCommand`; a modal dialog
  opened in Simulator mode holds the controller and releases it; settings survive two instances writing
  in turn, and a `storage` event updates a running instance; the window lock of 3.8.6 is held and
  released; panel layout and settings persist; message boxes return the pressed button; every command
  without a handler is shown disabled.

**W4 - Engine binding** - tier strongest - depends on: W1, the simulator engine, the assembler engine
- Read: 3.2, 3.3; `engine/sim/sim68k.mjs`, `engine/sim/README.md`, `engine/sim/shim/host.h`,
  `engine/sim/shim/api.h`; `engine/asm/asm68k.mjs`, `engine/asm/README.md`; sim-core §10;
  assembler §1.2, §1.8, §3.4.1, §9.4; toolchain §1, §7.
- Outputs: `app/src/engine/index.ts`, `asm.ts`, `sim.ts`, `loader.ts` (loads the engines' loader
  modules and `.wasm` files under Vite, under Node for tests and under the desktop app's protocol;
  compiles each `.wasm` once and creates instances from the compiled module), `testing.ts`
  (`createRecordingHost()`: every `SimHost` method records its call and returns the engine's default;
  `createTestEngine(parts?)`: the real engine with a recording host in which the given parts are
  replaced; `withFaults(engine, plan)`: a wrapper that throws or returns a chosen status at a chosen
  call), tests, `docs/ENGINE-BINDING.md` (how each module is loaded; every difference found between a
  module and section 3.2, and what was done about it).
- Acceptance, against the real `engine/dist`: the mirror tests of 3.2 pass for both engines, or the
  mirror was changed and the owners of the affected parts are named in the result; the engine's own
  fixtures
  (`engine/sim/test/fixtures/*.S68` with their `.L68`) load and run to their halt through
  `createSimEngine` under Node, Chromium and WebKit; tasks 2, 23 and 58 and a message box return
  `WaitInput`, `WaitDelay`, `WaitHost`, `WaitAlert` and resume; the three facts of 3.2 have tests
  (state survives `load` but not a new instance; no `run()` is needed after `load`, `rewind`,
  `cmdPause` during a wait; a key interrupt sets `runMode`); host calls made during `createSimEngine`
  are recorded; **200 consecutive `releaseSimEngine` / `createSimEngine` cycles and 500 consecutive
  assemblies succeed in Chromium and in WebKit**, with the memory use recorded at the start and the
  end; `createNetClient` receives the address of its string; a program that calls every TRAP #15 task
  reaches every `SimHost` method the specs say it should (recording host). Assembler: `smoke.X68`
  assembles to the native oracle's `.S68` byte for byte and to its `.L68` after masking lines 2 and 3
  (the oracle is version 5.15.4), with the Assembly tab type the oracle uses (erratum W4 1); the
  three statements of 3.2 have tests; a `fatal` result is returned, not thrown; the module loads under
  Vite and Node, and from a server that behaves as the protocol handler of 7.6 is specified to (the
  run under `app://` itself is DV2's; erratum W4 3).

> **Corrected (erratum W4 2).** `app/src/engine/browser.test.ts` is a Vitest file that builds the binding with Vite, serves it and drives headless Chromium and WebKit; it runs only when `EASY68K_BROWSERS` is set (`npm run check:engine-browsers`, CI job `browser-checks`). "Loads under the `app://` protocol" is shown as far as the protocol is specified: the production build at a sub-path, served with the handler's content types and the policy as a response header (erratum W4 3; the run under `app://` itself is DV2's). "Every SimHost method the specs say it should" is `TRAP15_TOUR`: one entry per call (94: every task of the inventories, every sub-task of task 32, the forms of tasks 11, 24 and 33) with the host methods trap15-a §4-§7 and trap15-b say it reaches (erratum W4 6).

### 9.2 Wave 1 - fifteen packages in parallel (all depend on wave 0)

**FS1 - Browser store, file dialogs, Files panel** - tier mid
- Read: 3.8, 5.8, 5.9; editor-ui §1.4, §6.2, §6.4; sim-ui §8.4.
- Outputs: `fs/browser-backend.ts`, `fs/zip.ts`, `features/files/**` (dialogs `file.open`, `file.save`,
  providers, upload import, export and import of files, folders and the whole store, drag and drop of
  files onto the window, Files panel, `app.files.toggle`).
- Acceptance: the backend contract suite passes (Node with a fake IndexedDB, and in Chromium and
  WebKit); `appendFile` of 1 kB to a 20 MB file takes a time that does not depend on the 20 MB; two
  pages on one store: a write in one is listed in the other without a reload; the five open filters and
  two save filters; default extension rule; overwrite question text; dropped files open in list
  order, unreadable ones are skipped, a dropped folder follows 3.8.5; a zip export opens in the
  system's archive tool (checked by parsing it back) and a whole-store export imports into an empty
  store with every byte equal.

**E1 - Documents** - tier mid
- Read: 3.8.6, 3.9, 5.1-5.3; editor-ui §1, §2.7, §6, §12, §16, §19.3, §20.2.
- Outputs: `core/documents/**`; `features/documents/**` (`ed.file.new`, `open`, `save`, `saveAs`,
  `close`, `exit`, `ed.edit.reload`, `ed.window.select`, close prompts, drafts, start-up document,
  unload guard).
- Acceptance: the items of editor-ui §20.2 as tests; the byte example of 5.2; one extra empty line per
  open-and-save cycle; trailer variants (only `*~Tab type~0~`; two-digit limits; unknown font name
  kept); bytes `$80-$FF` survive a round trip; every prompt has the exact text; cancelled Save As
  cancels a close; drafts are restored after a simulated crash, and a second live window is not
  offered them; saving a file that changed in storage since it was loaded asks the question of 3.8.6.

**E2 - Editor component** - tier mid
- Read: 2.2, 2.4; editor-ui §4, §5.2, §7, §8, §20.3; notes 5, 6, 12, 13, 16, 17, 45.
- Outputs: `ui/editor/**` (pane, tab strip, status bar, context menu, CodeMirror extensions for tab
  stops, Tab key, auto indent, overwrite mode, comment/indent, markers, non-Windows-1252 marks);
  `features/editor/**` (Edit-menu commands, Window-menu commands, `ed.edit.toggleInsert`).
- Acceptance: the items of editor-ui §20.3 as transaction-level tests, with the Tab rule of note 12;
  tab characters displayed at columns 12, 20, 44; true visual column in the status bar; two-pane
  layouts; pasted rich text arrives as plain text; Paste from the menu, the toolbar and the context
  menu follows note 45 in a browser and uses `Platform.pasteIntoFocus` in the desktop app; component
  tests in Chromium and WebKit.

**E3 - Syntax highlighter** - tier mid
- Read: 2.8; editor-ui §9, §20.1; `reference/src-edit68k/.../INSTTABL.CPP` and `textS.cpp:1144-1571`
  for the tables and the exact order of tests.
- Outputs: `core/highlight/**` (`strcap`, tokeniser, classifier, operand scanner, mnemonic table),
  `features/highlight/**` (decorations, preset resolution including `Auto`).
- Acceptance: the 36 vectors of editor-ui §20.1, including vector 28 with the bit-field option off and
  the quirk of vector 35; every preset; list documents not highlighted; a 10,000-line document
  highlights its viewport in under 5 ms.

**SH1 - Drawing surface** - tier strongest
- Read: 3.4, 6.5.1; trap15-b §3-§7 (except §6.4), §13, §14.
- Outputs: `core/sim-host/surface/**` and stubs of `ellipse.ts`, `widepen.ts` (stub ellipse may be a
  plain midpoint ellipse; stub wide line draws the band without caps).
- Acceptance: the drawn examples of trap15-b §6.1 and §6.3 as tests; the mode table for every value
  0-255; the pen-position table of §5.5 row by row; double-buffer and resize rules; colour forms of
  §4.6; `resetToStartup()` gives the state of 3.3.2; when T2's references are available, the
  thresholds of 6.5.1 for width-1 lines, rectangles, flood fill, raster operations and pixels; a
  1920x1200 flood fill takes under 30 ms.

> **Corrected (erratum SH1 12).** "A 1920x1200 flood fill takes under 30 ms" is measured, best of several runs, on a whole surface and on ragged pictures, under Node and in both browsers (`check-surface.mjs`). The comparison with T2's GDI references (6.5.1) runs on every system; a case waits for SH2 only while the file that draws it is still SH1's stub (errata SH1 13, T2 12).

**SH3 - Text screen, fonts, output device** - tier strongest
- Read: 3.5, 2.5; trap15-a §2, §3, tasks 0-25 of §4, §11, §13 ("Text output", "Cursor"); trap15-b §5.5,
  §5.7, §6.7, §6.8.
- Outputs: `core/sim-host/text/**`, `core/sim-host/fonts/**` (atlas provider, metric table reader),
  `core/sim-host/io.ts`.
- Acceptance: the "Text output" and "Cursor" items of trap15-a §13 with a synthetic atlas set, driven
  by 68000 programs through the real engine (`createTestEngine`) and also directly; prompt timing with
  virtual time (first underscore after 1000 ms, then 500/500); stride aliasing; eager wrap;
  scrolling moves graphics; echo not stored; task 21: style bits (highest bit wins), font numbers 1-7
  including the two that resolve to a proportional face, size byte 0, a size outside the atlas sizes
  (resampled to the measured cell); the provider and the reader round-trip a synthetic atlas and metric
  table in the formats of 6.5.3; the same text gives the same pixels under Node, Chromium and WebKit.

**SH4 - Keyboard, mouse, Output panel** - tier strongest
- Read: 2.5, 2.9.4, 2.10, 3.6, 4.3; trap15-a §3.9, tasks 19 and 24; trap15-b §8, §9.
- Outputs: `core/sim-host/input/**`; `features/output/**` (panel, hidden textarea and its event
  handling, presentation loop, zoom, full screen, text mirror, `sim.view.output`, `sim.output.*`,
  `sim.options.size`, `sim.options.textWrap`).
- Acceptance: the virtual-key table equals the list of trap15-b §9.1, with the macOS keypad rule;
  character cases (Enter, Ctrl+H, Ctrl+I, Ctrl+Enter, Ctrl+Backspace, `e` with acute = `$E9`, euro sign
  = `$80`, a character outside Windows-1252 = none); the Tab rule; `pasteBytes` (LF to CR LF, 300
  characters give 254 bytes); the shift bits of mouse events follow rules 1-3 of trap15-b §8.1; nothing
  is posted on focus loss and `ioActivated` on focus; key-ups are restored when Meta is released.
  With the real engine and the real panel in Chromium and WebKit: each rule of 2.9.4 has a test - F9
  runs and is not seen by task 19, its key-up is; F2, F4 and Shift+F2 are seen by task 19 and run
  nothing; Alt+Enter is seen by task 19 and by a key-down interrupt and then toggles full screen;
  after task 24 the eleven shortcuts reach the program and only the release chord acts; a dead-key
  sequence and a composed character arrive in task 2; a held letter repeats; pasting `HELLO` into a
  task 5 loop stores `HO`, a two-line paste into task 2 fills one input, and a paste with LF line ends
  terminates the line; canvas backing size equals the surface size at device pixel ratios 1 and 2;
  deferred, refused and externally ended full screen (2.5).

**SH7 - Hardware model and panel** - tier mid
- Read: 2.6, 3.3.3, 4.3, 4.5.3; hardware §2-§5, §8, §13.
- Outputs: `core/sim-host/hardware/**`, `features/hardware/**`.
- Acceptance, with the real engine (`createTestEngine`) and virtual time: items 1-10 of hardware §13
  driven through `HardwareActions`; a checked box with interval 500 gives two `timerTick` posts per
  second during a run and none after Pause; every control of hardware §5 present; conflict colouring;
  showing the panel calls `setHardwareVisible(true)` (switch byte zero, pictures kept); push buttons
  release on pointer cancel; a press and release posted in the same instant are both seen by a polling
  program (4.3).

**SH8 - Run controller and session** - tier strongest
- Read: 3.3.1, 3.3.2, 3.11, 4 (all); `engine/sim/sim68k.mjs`, `engine/sim/README.md`; sim-core §10;
  sim-ui §8, §9; hardware §3.1, §3.6, §7.
- Outputs: `core/run/**` (clocks, timers, governor, controller, UI bridge, `headless.ts`),
  `core/sim-host/index.ts`, `features/run/**` (`session.ts`, the Run-menu commands except logging,
  `sim.file.open`, `openData`, `close`, `exit`, the simulator status bar, `sim.options.speed`, start-up
  switches, the modal boxes for engine alerts).
- Acceptance, with the real engine, `withFaults` and virtual time:
  - governor: instruction accounting through `stepCount`; the allowance never exceeds the cap, also
    after slices ended by the time budget; `Maximum` ends every tick under virtual time; the budget
    follows a 120 Hz frame source;
  - task 23: a delay of 100 units takes exactly 1000 ms of virtual time when `advance()` is called in
    steps of 1, 7, 16 and 1000 ms; one hundred consecutive one-unit delays take 1000 ms; a delay
    interrupted by a held dialog is extended by the time held; Pause ends it;
  - queue: order; one input edge per sub-slice while running (a `keyDown` and `keyUp` posted together
    are both seen by a program that polls task 19; two mouse-down requests at one level give two
    interrupts) and everything at once in the wait phases; a `keyDown` with `paste` delivers its bytes
    with no instruction in between;
  - wake-up: a program in `STOP #$2000` with mouse and key interrupts armed runs its handler after a
    posted `mouseDown` and after a posted `keyDown`; the same after a halt that leaves the hardware
    enabled; an IRQ request, a timer tick and Reset as before;
  - each wait state serviced as in 4.4, including `WaitAlert`, `Busy` (no change), the reply of task 58
    after Run and after Trace Into, and a native command arriving while the task 58 dialog is open
    (refused);
  - loading: the order of 4.7 (recording host); nothing reaches the engine between the start and the
    end of a load, also when Reload is requested twice and when a program was running; **Execute after
    a program that enabled a ROM range, set the size to 800x600 and moved the pen gives the results of
    a fresh simulator** (a write to the former ROM range is stored, task 33 returns `$028001E0`, task 96
    returns 0,0), while Open, Reload and a drop keep that state; host callbacks during engine creation
    are harmless;
  - the command table of 4.8; engine-failure recovery; the keys of `createSimHost(...)` equal the keys
    of `HOST_DEFAULTS`; a program runs to SIMHALT headlessly.

**U1 - Registers, listing, messages** - tier mid
- Read: 2.3, 3.11.3, 3.11.4, 4.6; sim-ui §4-§7.
- Outputs: `core/listing/**`; `features/sim-main/**` (the three panels, the gutter, the `sim.find`
  dialog, `sim.search.*`, `sim.bp.clearAllPC`, `sim.cycles.clear`).
- Acceptance: `ListingView` tests (`isInstruction` vectors, `addressOf`, the Find rules of sim-ui
  §6.7); the selection rule of 3.11.4 including the third-visible-row scroll; register fields: every
  change is forwarded with `editBox` and all boxes are re-read; the SR field's treatment of Backspace
  and invalid keys; with the real engine: an edit of D0 is used by the next Trace Into and discarded by
  a refresh, an edit of an address register is applied at once; gutter toggling and the
  `Breakpoint Limit Reached!` box at 100; the panels follow a cold start; a 100,000-row listing
  scrolls smoothly.

**U2 - Memory and Stack panels** - tier mid
- Read: 2.6; sim-ui §10, §11.
- Outputs: `features/memory/**`, `features/stack/**` (with `sim.view.memory`, `sim.view.stack`).
- Acceptance: row formats equal the examples; the ASCII rule (`$00-$1F` and `$80-$FF` as `-`); cursor
  placement and editing rules; Copy, Fill and Save with their messages; the stack's middle-row rule and
  colours; live update, also at address 0; the panels read `session.engine` afresh after a cold start.

**T1 - Wine oracle for the assembler, corpus** - tier strongest
- Read: 6.2.2, 6.3, 6.4; ground-truth §2-§4; assembler §2, §3.9, §8; toolchain.
- Outputs: `tests/oracle/wine/Dockerfile`, `wine/common/**`, `wine/asm/**`; `tests/oracle/asm-cli/**`;
  `tests/corpus/**`; `tests/conformance/asm/**`; `tools/fetch-site-examples.mjs`; `oracle.yml`.
- Acceptance: the container builds from nothing; the official examples assemble under Wine without
  manual steps; goldens exist for every tracked file, or a report says for which file the automation
  failed and why; the comparison test runs the WebAssembly assembler over the corpus and reports per
  file; the official binaries are never copied into the image or the repository.

**T2 - GDI capture, references, fonts** - tier mid
- Read: 3.4, 3.5.1, 6.2.3, 6.5; trap15-a task 21, §12 items 1-3; trap15-b §4.6, §5.4, §5.7, §6, §15.
- Outputs: `tests/oracle/gdi-capture/**`, `tests/conformance/gdi/**`, `tools/make-font-atlases.mjs`,
  `tools/fonts-src/**`, `app/public/fonts/**` (`metrics.json`, `bitmap/**`, `scalable/**`).
- Acceptance: `npm run oracle:gdi` builds and runs on Windows; the capture program is DPI-unaware and
  writes the machine's font-smoothing settings into every output; two runs give identical files; the
  spot values of trap15-b are reproduced (text cell extents, the 20 stock palette entries, dot sizes
  for widths 2-14, the 16 raster operations); `metrics.json` covers every name, style and size of
  3.5.1 with the face Windows used; atlases exist for every raster size and style and for the listed
  outline sizes; `make-font-atlases.mjs` gives identical files on Windows, macOS and Linux; any
  disagreement with trap15-b goes to the errata file.

**DV2 - Electron shell** - tier mid
- Read: 2.1, 3.3.4 (the two kinds of bridge call), 3.8.1, 3.8.4, 3.8.6, 3.13, 5.7, 6.7, 7.6.
- Outputs: `desktop/src/main.ts`, `windows.ts`, `preload.ts`, `protocol.ts`, `menu.ts`, `fs-ipc.ts`,
  `sync-ipc.ts`, `associations.ts`, `security.ts`; `app/src/platform/desktop.ts`;
  `app/src/fs/disk-backend.ts`, `app/src/fs/sync/disk.ts`; `tests/desktop/dev/**`.
- Acceptance: `desktop:dev` and `desktop:pack` work; through Playwright's Electron support against the
  development build (6.7): the settings of 7.6 hold; both engines, a font atlas and a help page load
  under `app://`; the native menu equals the command tables, follows the mode, has the application,
  Edit and Window menus of 7.6, and is disabled while a modal dialog is open; F9 runs Run once; after
  task 24, F9 pressed in the Output panel reaches the program and runs nothing; Cmd+C and Cmd+V work
  in the Memory panel's Address field; an open-file event opens the document; the disk backend passes
  the backend contract suite and `DiskSyncFiles` the `SyncFiles` suite; a path outside the granted
  roots is refused by the asynchronous and the synchronous handlers; `New Window` gives a second
  window with its own simulator; window-level full screen; navigation and new windows are blocked.

**H1 - Help, examples, About** - tier small
- Read: 2.7, 5.8, notes 10 and 11; editor-ui §15; sim-ui §16.
- Outputs: `tools/import-help.mjs`, `tools/import-examples.mjs`, `app/public/help/**`,
  `app/public/examples/**`, `core/help/**` (keyword table, contents tree), `features/help/**`.
- Acceptance: the import rewrites every `href`, `src`, contents entry and index entry to the exact
  letter case of the file it names (the original has 39 references whose case differs: 16 in pages,
  23 in `contents.hhc` and `index.hhk`) and reports the 4 targets that do not exist; the tests compare
  every reference **case-sensitively against the list of imported files**, never with a file-system
  existence check, so that they mean the same on Windows as on GitHub Pages; each of the 197 keywords
  resolves to an imported page; the contents tree equals `contents.hhc`; pages render in the sandboxed
  frame with their images; About texts are exact; a test asserts that nothing from
  `reference/examples/site` is under `app/public/`.

> **Corrected (erratum H1 10).** Besides the letter case, the import adds `target="_blank"` to the four links that leave the help (three web addresses and the Quick Reference PDF), because neither can be shown in the sandboxed frame (`manifest.json`: `blankTargetsAdded: 4`).

> **Corrected (erratum H1 3).** Encoding: pages, `contents.hhc` and `index.hhk` are decoded as `windows-1252` and written as UTF-8 without a byte order mark; every page declares `charset=utf-8` (the three that declared nothing get a `<meta>` line); line ends stay CR LF. The import adds `manifest.json` (the list of imported files the tests compare against), `README.txt`, `Reference/ATTRIBUTION.txt` (O-5) and `Port/differences.htm`, rendered from `docs/DIFFERENCES.md` by the import's own small Markdown renderer: run `npm run import:help` after `DIFFERENCES.md` changes and commit the result (errata H1 4, 5).

> **Corrected (erratum H1 1).** The import copies every file of the help project except its build files (`help.chm`, `help.chw`, `help.hhp`, `ez68k.*`, the compiler log, `Thumbs.db`) and the unused `EASy68K Icons` folder, because `Quick Reference.htm` links to `EASy68KQuickRef.pdf`. A reference to a file left out stops the import with an error.

> **Corrected (erratum H1 2).** The 23 split as 20 in `contents.hhc` and 3 in `index.hhk`. The four missing targets are `ac-archive.css`, `Reference/68ks2d.htm`, a bare `top` and `..\Helpv1_4\main.htm`, all listed in `app/public/help/manifest.json`; seven index entries keep a fragment whose anchor does not exist in an existing page.

### 9.3 Integration gate I1 - tier strongest - depends on: wave 1

- Outputs: `tests/integration/wave1/**`, `docs/integration/wave1.md`; the shared-configuration changes
  requested in `docs/requests/` (8).
- Does: runs the application with the real services (each real part is in the application as soon as
  its owner has replaced its stub, 3.1 and 3.12.3; I1 edits no wiring) through this scenario: open an
  official example in the editor; load a prebuilt `.S68` and `.L68`; run to the halt with text output;
  type into a task 2 prompt; pause, step, trace; Memory, Stack and Hardware panels follow.
- Acceptance: the list of contract mismatches and defects, each assigned to an owner; the scenario
  above passes after the owners' fixes.

### 9.4 Wave 2 - fifteen packages in parallel (depend on wave 1 and I1)

**E4 - Options dialogs and settings files** - tier mid - depends on: E1, E2
- Read: 3.10, 5.6, 2.8, note 8; editor-ui §11, §12; sim-ui §14.3.
- Outputs: `core/settings/dat-codec/**`; `features/options/**` (Assembler Options, Editor Options,
  `settings.transfer`, their commands).
- Acceptance: the shipped `settings.dat` parses to the "Shipped file" column of editor-ui §11.4; a file
  with a line removed behaves positionally; the writer's output loads back and equals a checked
  fixture; `sim68K.dat` raw bytes on lines 2, 3 and 34; every control and text of both dialogs; the
  Sim68K question; presets table; Cancel restores everything.

**E5 - Assemble** - tier mid - depends on: W4, E1, E2, FS1, the assembler engine
- Read: 3.2 (assembler types), 3.8.3, 4.9, 5.3; editor-ui §7.3, §10, §20.4; assembler §3.4.1, §4.2, §4.4.
- Outputs: `features/assemble/**` (collection of files, the command, Messages panel, markers, status
  dialog, Execute, Load L68, `ed.msg.clear`).
- Acceptance: the items of editor-ui §20.4 with the real engine; include resolution (quoted, unquoted,
  other letter case, backslash path, `..` into a sibling folder, a name built by a macro through the
  second pass); messages of an include file open that file and keep the assembled document active; a
  `fatal` result writes no file; Execute hands over without running and follows note 20.

**E6 - Find, Replace, Print** - tier mid - depends on: E2
- Read: notes 2 and 7; editor-ui §13, §14, §20.6, §8.1 (tab expansion rule).
- Outputs: `features/find/**`, `features/print/**`, `core/print/**`.
- Acceptance: the items of editor-ui §20.6 with note 7; print document: tabs expanded with the
  document's rule, page break at the marker line, monochrome, selection or all.

**FS2 - File System Access backend** - tier mid - depends on: FS1
- Read: 3.8.1, 3.8.2, 3.8.4 (revalidation).
- Outputs: `fs/fsaccess-backend.ts`, `features/files-fsaccess/**`.
- Acceptance: the backend contract suite in Chromium against a directory handle; linked single file
  with save-back; permission asked again after reload; a file changed or added on disk is found by
  `revalidate()`; the feature is absent, without error, in WebKit.

**SH2 - Ellipses and wide pens** - tier strongest - depends on: SH1, T2
- Read: 3.4 rules 4 and 6, 6.5.2; trap15-b §6.2, §6.4, §15 (V11, V12).
- Outputs: `core/sim-host/surface/ellipse.ts`, `widepen.ts`, `tables/**`;
  `tests/conformance/gdi/cases-ellipse.ts`; `docs/porting/gdi-deviations.md`.
- Acceptance: the thresholds of 6.5.2; the wide-line cases of 6.5.1; table data under 300 kB
  compressed.

**SH5 - Sound** - tier mid - depends on: SH8
- Read: 3.7; trap15-b §11, §13 rows 8-14.
- Outputs: `core/sim-host/audio/**`, `features/audio/**`.
- Acceptance: every row of the task tables for tasks 70-77 with a fake backend and virtual time; the
  busy flag clears by time with audio suspended; `D0` untouched where the original leaves it; sticky
  looping; reset keeps the task-73 voice and `resetToStartup()` stops it; file names follow the
  current directory; the six official `.wav` files parse with the right durations.

**SH6 - Program files, file dialog, printer** - tier strongest - depends on: W4, FS1, SH8
- Read: 3.8.1, 3.8.4, 3.8.5, 4.4.3; trap15-a §7, §11 items 13-15, tasks 10 and 58; trap15-b §11.2.
- Outputs: `core/sim-host/files/**`, `fs/sync/cached.ts`, `core/sim-host/printer.ts`,
  `features/sim-files/**` (the `sim.fileDialog` dialog, the `Printer Output` dialog,
  `sim.file.printerSetup`).
- Acceptance, headless with the real engine: the "Files" items of trap15-a §13; names in another
  letter case and with backslashes open; a read-only file gives result 3; **write buffering**: a
  program that writes 10 bytes and reopens the file without closing reads end of file (`D0.W = 1`);
  after task 56, or after 512 bytes, the bytes are there; **abandoned streams**: after Rewind, task 57
  on a file left open fails and a new open does not see the pending bytes; after a cold start the bytes
  are in the file; **liveness**: a file written through the `Vfs` (as the editor saves) and a file
  added to the folder are seen by the next Rewind and Run without a reload; a sound file added the same
  way plays; the limits message; task 58 OK and Cancel, the move of the current directory, a Save-mode
  path that task 52 then creates; `exitNow()` followed by `recoverJournal()` in a new instance leaves
  every byte in storage; the `SyncFiles` suite passes for `CachedSyncFiles`; printer: the metrics of
  3.8.4, a form feed ends a job, the job reaches `Platform.print`.

**U3 - Advanced breakpoints** - tier mid - depends on: W4, U1
- Read: 2.6, note 40; sim-ui §12.2; sim-core §7.
- Outputs: `core/breakpoints/**`, `features/breakpoints/**` (with `sim.view.breakpoints`).
- Acceptance: the button-enabling grammar; the conversion example of sim-core §7.3; Set, Clear and
  Clear All with their messages; renumbering on delete; the engine receives the expected slots; with
  the real engine a write condition stops a test program at the expected instruction; the grids are
  empty after a cold start.

**U4 - Logging and simulator options** - tier mid - depends on: W4, SH8, U1
- Read: 3.3.5, 4.4.5, 5.5, notes 27-29, 41, 42; sim-ui §13, §14; trap15-a §3.2, §3.11.
- Outputs: `core/sim-host/log/**`, `features/log/**`, `features/sim-options/**`.
- Acceptance: the three log examples of sim-ui §13.4 and the output-log example of §13.5, byte for
  byte, from headless runs with the real engine; Replace, Append and Cancel (after Cancel
  `engine.startLog` is not called and logging stays off); **Log Start during a run with an existing
  file: every byte the program writes after the click is in the log, however long the question stays
  open**; flushes never overlap and use `appendFile`; a 30 MB log costs the same per flush as a small
  one; the Rewind and Reload notes appear or not according to whether the dialog had been shown;
  enabled states of sim-ui §13.6; the memory range reaches the engine (`LogMemFrom`, `LogMemBytes`);
  font dialogs (`TextScreen.setOptionsFont`); Auto Trace Options; exceptions and bit field saved at
  once.

**T3 - Simulator conformance and its Wine driver** - tier strongest - depends on: W4, SH8, T1
- Read: 6.2.2, 6.4; trap15-a §13; trap15-b §15; hardware §13; sim-ui §17, §19; sim-core §3.9, §3.16.
- Outputs: `tests/oracle/wine/sim/**`, `tests/conformance/sim/**`, `tests/conformance/windows-confirm/**`
  (including `stdio-buffer.X68`).
- Acceptance: at least 150 self-reporting programs with goldens from the official binary; at least 20
  execution logs; the harness; a report of every mismatch between the port and the official binary,
  each assigned to the engine or to a host package.

**T4 - Native twins and CPU catalogue** - tier mid - depends on: W4
- Read: 6.2.1, 6.2.4; ground-truth §5; sim-core §11; `engine/asm/README.md`, `engine/asm/native/`.
- Outputs: `tests/oracle/native-twin/**` (the simulator twin and the scripts that run all twins),
  `tests/conformance/cpu/**`, `docs/porting/cpu-deviations.md`.
- Acceptance: the simulator twin and the engine's assembler twins build with MSVC in CI; zero
  differences on the corpus and the conformance programs, or a defect report; the
  single-step runner covers every file of the suite; the catalogue names each class of deviation with
  counts; the baseline is committed as hashes only.

**DV1 - Offline, install, Pages** - tier mid - depends on: W3, W4
- Read: 1.1, 7.4-7.6.
- Outputs: `app/src/sw.ts`, `features/pwa/**`, `app/public/manifest.webmanifest`, `app/public/icons/**`,
  `pages.yml`.
- Acceptance: after one load, a reload with the network off works in Chromium and WebKit, including
  every engine file W4's loader requests, help, fonts and examples; no service worker is registered
  when the platform is the desktop app; no Content Security Policy violation during the smoke test of
  the production build; the build works under a sub-path; the update notice never reloads by itself.

**DV3 - macOS packaging and release** - tier mid - depends on: DV2
- Read: 6.7, 7.4-7.6, 11.
- Outputs: `desktop/electron-builder.yml`, `desktop/build/**`, `desktop/scripts/**` (fuses, native
  modules per architecture, ad-hoc signing), `tests/desktop/packaged/**` (the CDP harness and checks
  1-5 of 6.7), `release.yml`.
- Acceptance: checks 1-5 of 6.7 pass on the arm64 and Intel runners against the fused, signed bundle,
  with a prebuilt `.S68`; the release job produces the six artifacts and the checksum file as a draft
  release.

**B1 - EASyBIN** - tier mid - depends on: W3, FS1
- Read: `reference/src-easybin/EASyBINv2.5.0` (all), `easybin.htm`; sim-core §2.4.
- Outputs: `docs/porting/easybin.md` (with a completeness index like the other specs),
  `commands/tables/easybin-menu.ts`, `core/easybin/**`, `features/easybin/**`.
- Acceptance: the spec lists every menu item, control, message and file rule of the source; S-record
  files written by the assembler load and save back byte for byte where the original would; binary
  open and save with 1, 2 and 4 files; Copy and Fill; editing anywhere in 16 MB stays responsive.

> **Corrected (erratum B1 16).** "Editing anywhere in 16 MB stays responsive" is measured as the work the product does per key: key-down to the changed page median under 16 ms and p95 under 50 ms, the slowest address no more than twice the fastest plus 4 ms, and key-down to painted frame median under 50 ms (or at most 20 ms above a baseline measured under the same load). The painted frame's p95 is printed, not judged, because a loaded runner paints late whatever the page does.

> **Corrected (erratum B1 6).** "Load and save back byte for byte where the original would" means: after loading such a file every value in memory and every field is the original's, and Save S-Record writes byte for byte the file the original writes for the same From, To and Start Address - not the input file, because the original writes its own header, 32-byte records and an S7 record (easybin.md 11.3). Proven against the original's functions compiled natively (easybin.md 0.4).

**X1 - End-to-end harness, editor and application suites** - tier mid - depends on: E1, E2, FS1
- Read: 6.6; editor-ui §20.
- Outputs: `tests/playwright.config.ts`, `tests/e2e/fixtures/**`, `tests/e2e/editor/**`,
  `tests/e2e/app/**`.
- Acceptance: a test for every editor row of 1.3 whose kind is `web-e2e` (tests for wave-2 features
  are written against the spec and marked expected-fail until the feature lands); the two-window tests
  of 6.6; green in Chromium and WebKit on the three operating systems; 20 repetitions in a row
  without a failure on `ubuntu-latest` in each browser.

> **Corrected (erratum X1 1).** "Every editor row of 1.3 whose kind is `web-e2e`": the kinds are set in X2's `tests/parity/matrix.json`. Until it existed X1 chose the rows: every row of 1.3.1-1.3.3 that a browser can show has a test in `tests/e2e/editor/` (the file per area named in its header); the desktop-only chords, the Easter egg and dead code, the positional parsing of `settings.dat` and the highlighting vectors are left to other kinds. X2 can take the test titles as the ids for `verifiedBy: web-e2e`.

### 9.5 Integration gate I2 - tier strongest - depends on: wave 2

- Outputs: `tests/integration/wave2/**`, `docs/integration/wave2.md`; the shared-configuration changes
  requested in `docs/requests/`.
- Scenario: every official example is opened, assembled, executed and run to its end or first input in
  the web build, in Chromium and WebKit; outputs compared with the headless results; edit, assemble
  and Execute three times in a row (each Execute a cold start); settings import and export; logging;
  the desktop development build runs the same scenario.
- Acceptance: defect list assigned to owners; scenario green after fixes; no command id without a
  handler.

### 9.6 Wave 3 - completion (depend on I2)

**DV4 - Desktop serial and network** - tier mid - depends on: DV2, SH8
- Read: 3.3.4, 7.6; trap15-a §6; trap15-b §12.
- Outputs: `desktop/src/net.ts`, `serial.ts`; `core/sim-host/serial/desktop.ts`, `net/desktop.ts`;
  `features/desktop-devices/**` (the `COMn` to device mapping dialog).
- Acceptance: on a macOS runner: UDP and TCP exchanges with a local echo server, and between two
  windows of the app; the byte-swapped port of tasks 106 and 107; the result codes of trap15-b §12.2;
  task 100 with a host name (success writes 16 bytes at (A2), failure returns 8); task 105; receives
  answered from the page-side buffer without a bridge call; serial tasks against a pseudo-terminal
  pair; a port stays open across Rewind and Reload and is closed by a cold start; the web build still
  returns the values of note 37.

**DV5 - Packaged-app program checks** - tier mid - depends on: DV3, E5, SH6, T3
- Read: 6.7.
- Outputs: `tests/desktop/packaged/programs/**`.
- Acceptance: checks 6-8 of 6.7 pass on the arm64 and Intel runners against the fused, signed bundle.

**X2 - End-to-end simulator suite and parity map** - tier mid
- Read: 6.6.
- Outputs: `tests/e2e/sim/**`, `tests/parity/**`.
- Acceptance: a test for every simulator and EASyBIN row of 1.3 whose kind is `web-e2e`;
  `matrix.json` complete, with a `verifiedBy` kind for every row; the unit test on it passes.

**X3 - Whole-program pixel regression** - tier small - depends on: T3
- Outputs: `tests/conformance/examples/**`.
- Acceptance: 6.5.4.

**P1 - Performance and speed** - tier mid - depends on: SH8
- Read: 4.2, 4.5.5, 4.5.6, 6.9 item 9; sim-core §11.11.
- Outputs: `tests/perf/**` (including `calibrate.X68`, a program that reports instructions per second
  through task 8, `spin.X68` and `draw.X68`), `docs/porting/speed.md`.
- Acceptance: the measurements of 6.9 item 9, at 60 Hz and with the 120 Hz frame source; a
  4096x4096 surface in Chromium and WebKit: resize, clear, flood fill and present without a failure,
  with the memory use recorded (if WebKit fails, the largest size that passes becomes `MAX_SURFACE`
  and the change goes to `docs/differences/`); if O-1 is granted, the measured figure for the original
  and the proposed `DEFAULT_IPS` (the constant itself is changed by SH8).

**Q1 - Accessibility and keyboard audit** - tier mid
- Read: 2.9-2.11.
- Outputs: `tests/a11y/**`, defect entries in `docs/integration/rc.md`.
- Acceptance: every mode and dialog scanned; keyboard-only walk-through of the two workflows
  "edit, assemble, fix an error" and "run, answer input, leave the Output panel with the release
  chord, set a breakpoint, step" recorded as tests.

**DOC1 - Documentation and release notes** - tier mid
- Outputs: `README.md`, `CHANGELOG.md`, `docs/USER-GUIDE.md`, `docs/DIFFERENCES.md`,
  `docs/CONTRIBUTING.md`, `docs/MANUAL-TEST-MAC.md`; errata merged into the specs.
- Acceptance: a new contributor can build and test from the README alone on the three operating
  systems (checked in a clean container and on a clean macOS runner); `DIFFERENCES.md` contains every
  note of 1.4 and every fragment; the manual list contains every item of 6.8, with the browser
  shortcut table; the Gatekeeper instructions of section 11 are in the README and in the release notes
  template.

**I3 - Release candidate** - tier strongest - depends on: all
- Outputs: `tests/integration/rc/**`, `docs/integration/rc.md`.
- Acceptance: the definition of done (6.9) checked item by item, with the evidence for each.

### 9.7 Summary

| Wave | Packages | Count |
|---|---|---|
| 0 | W0, W1, W2, W3, W4 | 5 |
| 1 | FS1, E1, E2, E3, SH1, SH3, SH4, SH7, SH8, U1, U2, T1, T2, DV2, H1 | 15 |
| gate | I1 | 1 |
| 2 | E4, E5, E6, FS2, SH2, SH5, SH6, U3, U4, T3, T4, DV1, DV3, B1, X1 | 15 |
| gate | I2 | 1 |
| 3 | DV4, DV5, X2, X3, P1, Q1, DOC1, I3 | 8 |

45 packages in all. Tier strongest: W3, W4, SH1, SH2, SH3, SH4, SH6, SH8, T1, T3, I1, I2, I3. Tier
small: H1, X3. All others mid.

Which package registers which command handler (ids of 1.3 and 1.5; exactly one owner each):

| Package | Commands |
|---|---|
| W3 | `app.mode.set`, `app.mode.next`, `app.theme.set`, `app.window.new`, `sim.panel.next` |
| E1 | `ed.file.new`, `ed.file.open`, `ed.file.save`, `ed.file.saveAs`, `ed.file.close`, `ed.file.exit`, `ed.edit.reload`, `ed.window.select` |
| E2 | `ed.edit.undo`, `redo`, `cut`, `copy`, `paste`, `selectAll`, `comment`, `uncomment`, `indent`, `outdent`, `toggleInsert`; `ed.window.arrange`, `cascade`, `tileH`, `tileV`, `minimizeAll` |
| E4 | `ed.options.assembler`, `ed.options.editor`, `ed.options.transfer`, `sim.options.transfer` |
| E5 | `ed.project.assemble`, `ed.msg.clear` |
| E6 | `ed.edit.find`, `ed.edit.findNext`, `ed.edit.replace`, `ed.file.print`, `ed.file.printerSetup` |
| FS1 | `app.files.toggle` |
| H1 | `ed.help.help`, `ed.help.about`, `ed.help.context`, `sim.help.help`, `sim.help.about`, `sim.help.context`, `app.help.examples`, `app.help.differences` |
| SH8 | `sim.file.open`, `sim.file.openData`, `sim.file.close`, `sim.file.exit`, `sim.run.run`, `runToCursor`, `autoTrace`, `stepOver`, `traceInto`, `pause`, `rewind`, `reload`, `sim.options.speed` |
| U1 | `sim.search.find`, `sim.search.gotoPC`, `sim.bp.clearAllPC`, `sim.cycles.clear` |
| U2 | `sim.view.memory`, `sim.view.stack` |
| U3 | `sim.view.breakpoints` |
| U4 | `sim.run.logStart`, `sim.run.logStop`, `sim.options.logOutput`, `sim.options.sourceFont`, `outputFont`, `printerFont`, `exceptions`, `autoTrace`, `fullscreen`, `bitField` |
| SH4 | `sim.view.output`, `sim.output.fullscreen`, `sim.output.paste`, `sim.output.releaseKeyboard`, `sim.options.size`, `sim.options.textWrap` |
| SH6 | `sim.file.printerSetup` |
| SH7 | `sim.view.hardware` |
| B1 | `sim.view.easybin`, every `bin.*` |

---

## 10. Risks and open decisions

### 10.1 Risks

| # | Risk | Effect if it happens | Recommended default |
|---|---|---|---|
| R-1 | Both engines were still being worked on when this document was revised. Both modules exist and are mirrored in 3.2; the assembler's appeared during the revision. | A method the application relies on changes or is missing. | The engine's module is the authority (3.2). W4 runs first, with tests that fail on any difference between a module and its mirror. The assembler boundary is one call. |
| R-2 | GDI's ellipse algorithm is not known exactly (trap15-b §6.4). | Circles differ from Windows by a pixel here and there; task 83 and flood fills near them can differ. | Captured table up to 64x64 (exact), best algorithm beyond, measured thresholds (6.5.2), figures published in `docs/porting/gdi-deviations.md`. |
| R-3 | Driving the official programs under Wine is brittle; Wine's RichEdit may hand the assembler different text than Windows for unusual files. | Wrong or missing goldens. | Flag sensitive files (6.2.2), confirm a sample on real Windows (O-2), treat unflagged disagreement as a port defect and flagged disagreement as unconfirmed. The v5.15.4 oracle and the native twins give independent evidence for the S-records. |
| R-4 | The default output font must be pixel-identical to Windows Fixedsys; the only source of its glyphs is Windows itself. | Legal doubt about shipping captured glyph bitmaps. | Ship captured atlases for the raster faces, state their origin, and let the owner decide (O-3). An atlas is a data file; replacing it needs no code change. |
| R-5 | The outline fonts (Courier New, Lucida Console, Consolas, and Arial where Windows substitutes it) are drawn by Windows from its own font files with sub-pixel anti-aliasing. | Text in those fonts has the measured grid and positions but glyphs from open substitute fonts: not the same pixels. Task 83 on such text, and a flood fill that touches it, can differ. | Accept; documented. The default font and the other raster faces are exact, and the substitute glyphs are the same on every machine and browser (3.5.1). |
| R-6 | The original's speed is unknown and varies by machine. | Delay loops run faster or slower than a student's lab PC. | Governor with a measured default (4.5.6, O-1); the setting is visible in the status bar. |
| R-7 | A real browser may act on a key although the page cancelled it (F6, F7, F10; Cmd+letter in Safari). Automated tests cannot see this. | A shortcut does nothing or triggers the browser. | The per-browser table of the manual list (6.8); every command is also in the menu and toolbar; Shift+F<n> and Ctrl+letter alternatives (K2, K3); failures are listed in `docs/DIFFERENCES.md`. |
| R-8 | macOS blocks the first launch of an ad-hoc signed download. | Students cannot start the app without changing a system setting; on managed Macs perhaps not at all. | Section 11. The web app is the recommended route where the desktop app cannot be opened. |
| R-9 | GitHub withdraws Intel macOS runners. | The Intel build is tested less directly. | Build on arm64 and run the packaged-app tests under Rosetta 2. |
| R-10 | Safari deletes a site's script-writable storage after seven days without a visit unless the site is installed, and a site added to the Dock is a separate app with its **own, empty** storage (Apple's documentation for macOS 14 and later; on the manual list). | Programs kept only in the browser store disappear; a student who follows the advice to add the app to the Dock finds `My Programs` empty there. | Call `navigator.storage.persist()`; show the storage state in the Files panel; in Safari show a one-time notice that explains both facts and offers `Export everything...` (a `.zip` of the whole store) next to the advice to use `Add to Dock`, the Dock app offering `Import...`; documents are never the only copy without that notice having been shown. |
| R-11 | A program folder with thousands of files or very large files (for example a source saved in Downloads). | Browser: slow load and revalidation; files beyond the limits are not visible to the program. Desktop: none, files are read on demand. | The limits and the message of 3.8.4; the user guide recommends one folder per project. |
| R-12 | Hidden browser tabs are throttled, after some minutes to about one timer per minute. | A running program crawls or nearly stops while its tab is hidden. | Documented; time-based behaviour stays correct, only coarser (4.5.5); the desktop app is unaffected. |
| R-13 | A single host call can take long on the main thread (flood fill of a 4096x4096 surface, a synchronous bridge call to a slow disk or a name lookup). | A visible hitch; during a name lookup the window does not respond, as the original's does not. | Bounded by the surface limit; measured by P1; no further action unless a measured frame exceeds 100 ms outside the calls the original also blocks in. |
| R-14 | Fifteen packages build against interfaces whose implementations do not exist yet. | Integration failures at the end of a wave. | `Api` interfaces and working stubs at the final paths from W1; the real simulator engine and W4's test helpers available from wave zero; integration gates I1 and I2 with fixes by owners. |
| R-15 | The help contains third-party material (the 68000 reference pages) whose licence is only stated by the distribution's general GPL notice. | A request to remove it. | Bundle it with attribution; keep it in its own folder (`help/Reference/`) so that removal is one deletion; ask (O-5). |
| R-16 | The execution-log lookup of the original can throw when its binary search runs past the last row, in which case the original does not execute the instruction (sim-core §8.3). | The engine decides what happens in this case (the lookup is inside it); the result may differ from the original for that one instruction. | Accept; T3 records what the engine does in `docs/differences/T3.md`. |
| R-17 | Many statements in the specs are marked UNVERIFIED (trap15-a §12, trap15-b §15, hardware §12, sim-core §13, assembler §12, editor-ui §22 item 12). | Small behavioural differences that nobody has observed yet. | The specs' recommended behaviour is implemented; the Windows confirmation set settles them when O-2 is granted; until then they are listed as unconfirmed (6.9 item 11). |
| R-18 | EASyBIN has no specification. | Its parity rows are incomplete today. | B1 writes the spec first; X2 covers its rows. |
| R-19 | A cold start creates a new WebAssembly instance with 64 MiB of memory, and every assembly a new instance too. Safari is known to run out of address space when many memories are created faster than they are collected. | After very many Execute or assemble commands in one Safari session, a failure that only a page reload cures. | W4 compiles each module once, releases instances explicitly and tests 200 cold starts and 500 assemblies in WebKit; the manual list repeats it in Safari. If it fails: ask the simulator engine package for a "return to start-up state" call, which `createSimEngine` can use without any change above it. |
| R-20 | Two things the port relies on in Electron on macOS are recalled from documentation, not yet run: that `setIgnoreMenuShortcuts` keeps the menu from consuming command chords, and that a window with background throttling off still gets frames or timers when minimised. | A shortcut that runs twice or never; a program that stops while the window is minimised. | Both have a second mechanism that does not depend on the recollection (the `triggeredByAccelerator` guard; the scheduler's watchdog) and a DV2 or DV3 test that fails if the behaviour is wrong. |
| R-21 | The file-buffering model of 3.8.4 rests on one constant and two assumptions about the Borland run-time library. | A program that depends on unflushed data in an unusual way (large unclosed writes, reading a file another stream is writing) behaves differently. | The common case - a short file written and not closed - is right by the original's own help. `stdio-buffer.X68` settles the rest with O-2; listed as unconfirmed until then. |

### 10.2 Open decisions for the owner

| # | Decision | Recommended default |
|---|---|---|
| O-1 | May the official SIM68K.exe be run on real Windows hardware once, to measure its instruction rate? (Project rule: official binaries run only in Docker.) | Yes, by the owner, in Windows Sandbox or a disposable virtual machine, with `tests/perf/calibrate.X68`. Until then `DEFAULT_IPS = 1,000,000`. |
| O-2 | May the Windows confirmation set (6.8) be run the same way? | Yes, once, same conditions. |
| O-3 | Ship glyph atlases captured from the Windows raster fonts Fixedsys and Courier? | Yes, with their origin stated; reconsider on any objection. |
| O-4 | While key commands are enabled, is a shortcut whose command is currently disabled still withheld from the program (trap15-a §12 item 13)? | Withheld, as the spec expects; confirm with O-2. |
| O-5 | Bundle the complete original help including the third-party reference pages? | Yes, with attribution. |
| O-6 | Reproduce the extra empty line per open-and-save cycle of `.X68` files? | Yes: files stay byte-identical to the original's after the same steps. |
| O-7 | Final product name and icon. | `EASy68K` with the subtitle `unofficial web and macOS port`; a new icon, not the original's. |
| O-8 | Task 23 unit: nominal 10 ms, or the 15.6 ms many Windows machines show? | 10 ms. |
| O-9 | Line ends when saving a file that was LF-only. | CR LF, as the original writes. |
| O-10 | Advanced breakpoint `Count`: decimal (fixed) or hexadecimal (original)? | Decimal; it only moves where the debugger stops. |
| O-11 | Cycle counter display: full 64-bit value or the original's (unverified) low 32 bits? | Full value. |
| O-12 | Keep Run, Step and Trace disabled after a halt until Rewind, Reload or Pause? | Yes; hand-outs describe it. Open and Reload stay enabled. |
| O-13 | Offer serial ports in Chromium browsers through Web Serial as well? | No; desktop app only, as decided. |
| O-14 | Repository address (needed for the Pages base path, the update check and the About link). | W0 reads it from the Git remote at build time; nothing is hard-coded. |
| O-15 | Keep written data invisible until a file is closed, as the original's C library does (3.8.4), although that means a forgotten task 56 loses nothing in the end but shows an empty file until the simulator restarts? | Yes: it is what a student's program observes on EASy68K, and the help warns about it. `STDIO_BUFFER = 512` until confirmed. |
| O-16 | Ask the `Caution` question on Execute only while a program is running or waiting (note 20), or always when one is loaded? | Only while running or waiting: the original never asks on Execute, and the common loop of edit, assemble and execute should not need an extra click. |
| O-17 | The keyboard-release chord `Ctrl+Alt+O` is the one key the port takes from programs. | Keep; a program is very unlikely to need it, and a keyboard-only user needs a way out that task 24 cannot switch off. |

> **Corrected (erratum DV1 8).** O-7 as done by DV1: `app/public/icons/` is original work of this project (GPL-2.0-or-later): a chip in a dual in-line package with "68K" in seven-segment figures on the light theme's accent colour, drawn from rectangles and polygons only (`features/pwa/icons/icon-art.mjs`); nothing is taken from the original's icon.

> **Corrected (erratum P1 7).** O-1: `tests/perf/calibrate.X68` exists and needs nothing else on real Windows (steps in `docs/porting/speed.md` section 5; it also writes `result.bin` for the Wine oracle's report recipe, erratum P1 11). P1 also ran it in the official program under Wine; that figure is not the measurement O-1 asks for, and `DEFAULT_IPS` stays 1,000,000.

### 10.3 Notes for the spec and engine owners

Found while writing and revising this document; recorded here because this package owns no other file:

- **Spec.** sim-ui §15 says Shift+Insert feeds "up to 255 characters" of clipboard text; trap15-a §3.9
  says 254. The source is `Clipboard()->GetTextBuf(inBuf, 255)` (`simIOu.cpp:440`), a buffer size that
  includes the terminator, so 254 is right. This document uses 254.
- **Spec.** trap15-a §3.9 lists F1 among the keys "used by Sim68K" after `keyCodes.htm`, and sim-ui
  §3.4 says the I/O window has no F1 handler. Both are true of different windows; for the I/O window
  the second one decides, and this document delivers F1 to the program there (2.9.4). The Windows
  confirmation set checks it (task 19 polling `$70` while F1 is held in the I/O window).
- **Simulator engine, request.** `host.createNetClient` receives the server string of task 100 as a
  copy without its 68000 address, unlike `getLocalIP`, `sendNet` and `receiveNet`, which receive
  addresses. The host-name path must write the resolved address back to that string (trap15-b §12.2).
  Please pass the address; until then W4's binding supplies it (3.3.4).
- **Simulator engine, possible request.** A call that returns an instance to start-up state would make
  a cold start cheaper than a new instance (R-19). Not needed unless W4's WebKit test fails.
- **Simulator engine, observations** on `engine/sim/sim68k.mjs` as read for section 3.2, for W4 to
  confirm or correct: `cmdRunToCursor` reproduces the original, which runs the program even after its
  error box; the port checks the row first and does not call it for an invalid row (note 23).
  `cyclesText` is the original's display text (low 32 bits); the port shows `cycles` (note 32). There is
  no call that tells the engine which listing row the user selected, other than Run To Cursor; the
  selection rule of 3.11.4 does not need one. The original refreshes the hardware display after a
  Memory-window edit (`Hardware->updateIfNeeded`); the module has no call for that, and the port simply
  repaints its Hardware panel after `pokeMemory`.
- **Assembler engine, observations** on `engine/asm/asm68k.mjs` as read for section 3.2, for W4 to
  confirm or correct: the main source is passed as the entry of `files` under `mainName` and must be
  the editor buffer; `executeEnabled` means "no errors" and is true even when no S-record was produced
  (the port also requires the S-record, 4.9); `fatal` is a text, not a flag; the module exports
  `loadEditorText`, which repeats the trailer rule of 3.9.2 - the application uses its own
  `stripTrailer` for documents, and E1's tests compare the two on the corpus.
- **Assembler engine.** The package builds both assembler twins itself (`engine/asm/native`) and
  compares them in its own tests. T4 adds only the simulator twin and runs all of them in CI (6.2.1).

Changes needed in root-level files, all made by W0: the npm workspace files, and in `.gitignore` the
entries `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `desktop/release/`.

---

## 11. Dissent

One fixed decision has a consequence serious enough to state, although this document designs to it.

**Ad-hoc signing of the macOS app.** Without an Apple Developer ID the app cannot be notarised. A
downloaded, ad-hoc signed app is quarantined, and on current macOS the first launch shows a dialog with
no "Open" button. The user must open System Settings, Privacy & Security, and choose `Open Anyway`, or
remove the quarantine attribute in Terminal (`xattr -dr com.apple.quarantine /Applications/EASy68K.app`).
On school-managed Macs neither may be allowed. For a tool aimed at students this is the largest single
obstacle to adoption of the desktop app, and no amount of engineering in this repository removes it.

Recommendation: obtain a Developer ID (about 99 USD per year) and add notarisation to `release.yml`.
The pipeline is built so that this is a configuration change: DV3 keeps signing identity and
notarisation credentials as optional secrets, and falls back to ad-hoc signing when they are absent.

What the design does in the meantime: the README and every release note carry the exact steps; the
web app is installable, works offline and is presented as the equal first choice; `docs/USER-GUIDE.md`
tells students on managed Macs to use it.

