# Changelog

What changes in easy68k-cross-platform, newest first. The port's own version number is separate
from the version of the original it reproduces (EASy68K Editor/Assembler v5.16.01, Simulator
v5.16.1, EASyBIN v2.5.0). No version of the port has been released yet.

The notes of a release on GitHub are written by the release workflow
(`.github/workflows/release.yml`, `desktop/scripts/release.mjs`). They list the downloads and carry
the steps for opening the Mac app the first time, which are kept in `docs/differences/DV3.md` and
repeated in the README. When a version is released, its entry here moves from "Not released yet" to a
heading with its number.

## Not released yet

The first version is being prepared. What the repository holds today:

### The engines

- The original EASy68K v5.16.1 assembler and simulator, compiled to WebAssembly from the original
  C++ sources with a documented set of patches (`engine/asm/PATCHES.md`, `engine/sim/PATCHES.md`).
- Checked against the official EASy68K v5.16.1 for Windows run under Wine: 420 of 420 error-free
  test programs assemble to byte-identical listing and S-record files, and 9 of 9 execution logs
  match.

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
  Edge can also work in a folder of the computer. In Safari (and every browser on an iPhone or
  iPad) a notice in the Files panel explains that Safari deletes the programs after seven days
  without a visit and that an app added to the Dock has its own files, with Export... and Got it.
- The original's help pages and example programs; Help > Differences from EASy68K.
- Light and dark themes; installable as an app from the browser; works offline after the first
  visit; several windows at once.
- Import and export of the original's settings files `settings.dat` and `sim68K.dat`.

### The macOS app

- The same application in Electron, with direct disk access, file associations for `.X68`, `.L68`
  and `.S68`, several windows and the native menu bar.
- The serial port and network tasks of TRAP #15 (tasks 40-43 and 100-107), which only the Mac app
  can offer, with Options > Serial Ports... to say which device of the Mac each port name opens.
  Tested on GitHub's Mac machines with a simulated serial line and local network connections.
- Built for Apple silicon and Intel, signed ad hoc, by `.github/workflows/release.yml`. The built
  app passes its automatic checks on GitHub's Mac machines of both kinds. Not published.

### Known limitations

- Listed in part 5 of [docs/DIFFERENCES.md](docs/DIFFERENCES.md): among them, nobody has tried the
  port on a real Mac yet, Firefox is not tested, and a folder holding a large Git repository can
  crowd a program's own files out of what it may open in the web version, the help pages stay
  empty without a network in Safari's test engine, and the speed at `Maximum` and the frame rate
  while a program draws are decided only by the performance job of a manual test run on GitHub's
  Linux machine (on a Windows PC at a quieter moment, 22 November 2026: 237 and 248 million
  instructions in 10 s at `Maximum` with 60 Hz and 120 Hz frames, against the 200 million asked
  for; `docs/porting/speed.md` 4.6).

### Documentation

- [README.md](README.md), [docs/USER-GUIDE.md](docs/USER-GUIDE.md),
  [docs/DIFFERENCES.md](docs/DIFFERENCES.md), [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md),
  [docs/MANUAL-TEST-MAC.md](docs/MANUAL-TEST-MAC.md).
