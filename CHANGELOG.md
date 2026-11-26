# Changelog

What changes in easy68k-cross-platform, newest first. The port's own version number is separate
from the version of the original it reproduces (EASy68K Editor/Assembler v5.16.01, Simulator
v5.16.1, EASyBIN v2.5.0). The first release of the port is 1.0.0.

The notes of a release on GitHub are written by the release workflow
(`.github/workflows/release.yml`, `desktop/scripts/release.mjs`). They list the downloads and carry
the steps for opening the Mac app the first time, which are kept in `docs/differences/DV3.md` and
repeated in the README. Changes made after the newest release are collected under a heading "Not
released yet" at the top; when a version is released, that heading becomes its number and date.

## 1.1.0 (2026-11-26)

Arranging panels freely (`docs/ARCHITECTURE-PLUS.md` section P9), after the project's owner had used
the released web version: in the Simulator it was hard to arrange the panels so that everything can
be seen, and dragging was not found because the layout is locked at first. Nothing a 68000 program
can observe changes, no file the application writes, and none of the original's menus, commands or
keys. With nothing floating the window looks as in 1.0.0. The user guide's part "Arranging panels"
explains it all; the differences are in parts M1 and M2 of `docs/DIFFERENCES.md`.

- **Floating panels.** Any panel of the Editor and the Simulator can float: a window inside the
  application window, moved by its title bar, sized at its edges and corners, and docked back with
  its `Dock` button. `Float` is in the menu of a panel's tab and, as the place `As a floating
  window`, in `Move Panel To...`. Everything can be done from the keyboard: the title bar is a stop
  of Tab, and its menu has `Move`, `Size`, `Dock` and `Close`. Floating windows are kept with the
  arrangement and are where they were after a reload. `Lock Layout` now locks only the docked
  panels; floating windows can always be moved and sized.
- **Making a panel float is easy to find** (after an independent review of the built version): a
  double click on a panel's tab makes it float and a double click on a floating window's title bar
  docks it; every tab strip ends with a button `Float`. A window that floats for the first time
  appears at a free place at the right of the window, over no other floating window and not over
  the tab strip it came from. A window pushed to an edge keeps 48 pixels of its title (not of its
  buttons) in view. Leaving the Output panel with Ctrl+Alt+O lands on a floating window's title bar.
- **Floating windows after a second review.** A window pushed partly outside the application window
  is cut at its edge: clicking it or pressing Tab into it no longer scrolls the docked panels
  sideways off the screen.
- **Finding it.** A button `Arrange Panels` at the end of the toolbar is pressed while the layout is
  unlocked. The first time the Simulator is shown, a tip says once that the window can be rearranged
  and how, starting from what that page shows: press `Arrange Panels` to show each panel's tab, then
  double-click a tab or drag it; ready-made layouts are in the View menu.
- **Ready-made layouts** for the Simulator, in `View > Layouts`: `Classic`, `Wide Output`, `Output
  and Hardware Side by Side` (the Output panel gets the room its whole picture needs first) and
  `Floating Tools` (every tool panel in a window of its own, as in the original, side by side from
  the top right so that the windows do not cover one another while there is room, never over the
  Hardware panel's displays and switches, and with the Output picture in view while Hardware and
  Memory are shown; Stack, Break Points and Log go to further columns at the left, never over the
  Registers, the Listing or the messages, before any window covers another, so that in a window of
  1920 by 1080 all five lie side by side). The room kept for the windows at the right shrinks to the
  columns that still hold a window when one is moved, sized, docked or closed, and the docked panels
  take the whole window again when none is left there or when those left cover less than half of
  its height. The Hardware window is as wide as its content from a window 1,403 pixels wide on; on a
  smaller screen `Output and Hardware Side by Side` shows registers, listing, output and hardware at
  once. F2 goes from one floating window to the next. A window that a layout has just placed
  shows its content from its left edge, whatever the panel had been scrolled to where it was
  docked.
- **Panels in a small place.** The Hardware panel, the registers and the Memory panel scroll inside
  themselves when they get less room than they need (a low or narrow region, a small floating
  window), so that every control can be reached with the mouse, the wheel and the keyboard; a
  Memory row keeps its sixteen bytes and scrolls sideways. Where they fit, they look as in 1.0.0.
- In a narrow window the caption of `Arrange Panels` is shortened inside its frame; the original's
  toolbar buttons keep their places.
- The `Import...` menu of the Files panel closes when you click anywhere else (found by the owner in
  1.0.0).

## 1.0.0 (2026-11-23)

The first release: the web version at <https://gurmyd.github.io/easy68k-cross-platform/>, and the Mac
app for Apple silicon and Intel on the
[Releases page](https://github.com/gurmyd/easy68k-cross-platform/releases).

**No person has tried this release on a Mac yet.** It was tested automatically on GitHub's Windows,
macOS and Linux machines; the checks only a person can make ([docs/MANUAL-TEST-MAC.md](docs/MANUAL-TEST-MAC.md):
a real Mac, Safari itself, a screen reader, a printer, a serial adapter) have not been worked through
by anyone. The Mac app is signed ad hoc and not notarised by Apple, so macOS blocks it the first time
(the README says what to do).

### The engines

- The original EASy68K v5.16.1 assembler and simulator, compiled to WebAssembly from the original
  C++ sources with a documented set of patches (`engine/asm/PATCHES.md`, `engine/sim/PATCHES.md`).
- Checked against the official EASy68K v5.16.1 for Windows run under Wine (`npm run
  test:conformance`). Assembler: every test file with default options and 30 files with each of
  the eight options switched alone; of 801 runs with an official result, 654 are byte-identical,
  143 identical once the bytes of statements with an undefined symbol are masked, and 4 differ for
  recorded causes (part T1 of `docs/DIFFERENCES.md`, which also lists the 6 runs the official
  program gives no result for). Simulator: 185 of 188 self-reporting programs and 31 of 32
  execution logs (126,427 instructions) give the official result; the 4 others are listed in
  `docs/DIFFERENCES.md`: 3 accepted and 1 not yet confirmed on real Windows. The file streams of
  TRAP #15 tasks 50 to 59 follow the C run-time inside the original's simulator, also where C
  leaves the outcome undefined (a read right after a write without a seek).

### The application

- Editor/Assembler, Simulator and EASyBIN as three modes of one window, each with the original's
  menus, toolbar and dialogs.
- Editor: tabs, one or two panes, the original's syntax highlighting with an added `Auto` colour
  preset for the light and dark themes, line numbers, error markers, Find and Replace, printing,
  Assembler Options and Editor Options, drafts of unsaved work kept across a crash.
- Simulator: registers, listing with breakpoints, messages, the Output panel with text, graphics,
  keyboard and mouse input and full screen, sound, Memory, Stack, Hardware, Break Points and Log
  panels, execution and output logs, the file tasks of TRAP #15, printing (task 10), and a setting for
  the execution speed.
- EASyBIN: open, edit and save S-records and binary files.
- Files: the browser keeps the files ("My Programs", with Import and Export as `.zip`); Chrome and
  Edge can also work in a folder of the computer. In Safari on a Mac and in every browser on an
  iPhone or iPad, a notice in the Files panel (`About keeping your programs`) says that the browser
  may delete the programs after seven days without a visit and that an app made with "Add to Dock"
  or "Add to Home Screen" starts with its own, empty My Programs, with Export... and Got it; when the
  Files panel is not on the screen, the same text appears as a note at the first save into My
  Programs. In such an app, while its My Programs is empty, a notice points to Import....
- The original's help pages and example programs; Help > Differences from EASy68K. After the first
  visit the help pages, their links and the Differences page also show without a network, in
  Safari's engine too (tested in Playwright's WebKit; real Safari is a step of
  `docs/MANUAL-TEST-MAC.md`). Every help page carries a rule that forbids scripts, and the offline
  copy gives the help panel only pages of the help folder (erratum H1 11).
- Light and dark themes; installable as an app from the browser; works offline after the first
  visit; several windows at once.
- Import and export of the original's settings files `settings.dat` and `sim68K.dat`.
- A program's file tasks treat the name `NUL` as Windows' null device (nothing is written, a read is
  at end of file), as measured on Windows 11.
- Cut, Copy and Paste in the editor from the keys, the Edit menu, the toolbar and the context menu,
  tested in the engines of Chrome and Safari; with another program they are a step of the manual
  list.

### Beyond the original

Additions to the application, part of the first version. None changes what a 68000 program can observe (except which files are left out first in a program's folder beyond the web version's limits),
a file the application writes, or an item, command or key of the original's menus
(`docs/ARCHITECTURE-PLUS.md`; the section "Beyond the original" of [docs/USER-GUIDE.md](docs/USER-GUIDE.md)).

- Panels that can be moved, docked beside each other or put into one group, in the Editor and in the
  Simulator: by dragging a tab, or with Move Panel To... and the tab menu. Lock Layout (checked at first,
  so that the window looks as it always did) and Reset Layout. Split Editor Right, Split Editor Down
  and Close Split.
- The Files panel: several files selected with the mouse or the keyboard, deleted, moved, copied and
  exported together (Export says what it will export), Undo of the last twenty operations, the names of
  linked files and opened folders in the status bar, a question before a large import, and a line that
  says how much the browser stores. Folders that hold a Git repository are never deleted, moved,
  copied or renamed there.
- Earlier versions of the files you save, and a Trash for the files you delete or replace (30 days),
  kept in the browser and never written into a folder of your computer: File > Earlier Versions... and
  File > Trash..., with a comparison and Restore. Every question the additions ask whose Yes deletes or
  overwrites something for good has No as its default. A message offers a reload when a file you have open is
  changed outside the window. Files below a `.git` folder are loaded last for a program's folder.
- A viewer for PDF files and pictures, shown in a tab beside the Editor instead of as nonsense text;
  a document opened or chosen comes in front of it.
- Options > Port Additions... switches the viewer and the earlier versions off, and shows what is stored.

### The macOS app

- The same application in Electron, with direct disk access, file associations for `.X68`, `.L68`
  and `.S68`, several windows and the native menu bar.
- The serial port and network tasks of TRAP #15 (tasks 40-43 and 100-107), which only the Mac app
  can offer, with Options > Serial Ports... to say which device of the Mac each port name opens.
  Tested on GitHub's Mac machines with a simulated serial line and local network connections.
- Built for Apple silicon and Intel, signed ad hoc, by `.github/workflows/release.yml`. The built
  app passed its automatic checks on GitHub's Mac machines of both kinds before the release.

### Known limitations

- Listed in part 5 of [docs/DIFFERENCES.md](docs/DIFFERENCES.md): among them, nobody has tried the
  port on a real Mac yet, Firefox is not tested, a program in the web version can open at most 2,000 files of its folder (a `.git` folder's files are
  counted last), no person has tried the PDF viewer yet, and the speed at `Maximum` is about half of
  what the engine alone could do, by design, and depends on the machine.
- Speed, measured by the performance job of the release commit's manual test run on GitHub's Linux
  machine (run 45111581771): `Maximum` 113.5 million instructions in 10 s (the rule, corrected on 22
  November 2026, asks for at least 100 million and at least 85 % of what the engine alone executes
  in 5 s, here 107.0 million; erratum P1 13); frame intervals 17.4 ms at 60 Hz and 9.0 ms at 120 Hz;
  all seven verdicts of `tests/perf` hold.

### Documentation

- [README.md](README.md), [docs/USER-GUIDE.md](docs/USER-GUIDE.md),
  [docs/DIFFERENCES.md](docs/DIFFERENCES.md), [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md),
  [docs/MANUAL-TEST-MAC.md](docs/MANUAL-TEST-MAC.md).
- Part 4 of `docs/DIFFERENCES.md` lists each detail of the original that is not yet confirmed, one
  row each, with what the port does and how it could be confirmed; the one session on real Windows
  that would settle several of them is described in `docs/porting/windows-confirmation.md`.
- The manual list has a test program for every sound task (70 to 77), loops included, and steps
  for Cut, Copy and Paste with another program and for installing the web version from Chrome.
