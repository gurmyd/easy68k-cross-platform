# Ground-truth material for the EASy68K port

Gathered 2026-11-20. Everything below was obtained by download + extraction and by reading source.
No downloaded program was executed: the EASy68K installer, EDIT68K.exe, SIM68K.exe and EASyBIN.exe were
never run. The only programs run were curl, git and 7-Zip (7zr.exe, 7z.exe 26.06, 7z.exe 15.05).

## 1. Where things are

| Path | What |
|---|---|
| `c:\easy64k\reference\official-installer\SetupEASy68K.exe` | Official installer, 2,590,393 bytes |
| `c:\easy64k\reference\official-extracted\` | Installer contents (33 files) extracted with 7-Zip, not installed |
| `c:\easy64k\reference\official-installer-script\[NSIS].nsi` | Decompiled NSIS install script (registry keys, shortcuts, file list) |
| `c:\easy64k\reference\official-portable-zip\EASy68K.zip` | Official "portable app" zip, 2,505,056 bytes |
| `c:\easy64k\reference\official-portable-extracted\EASy68K\` | Its contents (27 files) |
| `c:\easy64k\reference\examples\official\Examples\` | The examples that ship with the distribution (10 .X68 + 6 .wav) |
| `c:\easy64k\reference\examples\site\<category>\<name>\` | Examples from the EASy68K web site, extracted (134 .X68, 334 files) |
| `c:\easy64k\reference\examples\site\_downloads\<category>\<name>\` | The original archives as downloaded (78 zips + 1 pdf) |
| `c:\easy64k\reference\examples\site\_pages\` | Copies of the site's example pages (provenance, author credits) |
| `c:\easy64k\reference\examples\github\<name>\` | Three shallow clones (344 .X68 in total) |
| `c:\easy64k\.toolchain\extract-tools\` | 7-Zip 26.06 and 15.05 (portable, unpacked from the official installers with 7zr) |

Nothing that already existed under `c:\easy64k\reference` was modified.

## 2. Official Windows distribution

- Source: `http://www.easy68k.com/files/SetupEASy68K.exe` ("Current Build", server Last-Modified 2018-03-16) and
  `http://www.easy68k.com/files/EASy68K.zip`. The site is HTTP only (its HTTPS certificate does not match the host).
- SHA-256: installer `76754307e83bc7dc9a5927b233dd849d3775922c77c192990f5b54075af58b2c`,
  zip `825153468117be9ec0d05563de1d79ff17c77b88a15434d731e6acbb5e265ec3`.
- Integrity check: the SHA-1 of both files equals the digest the Internet Archive recorded for the same URLs on
  2018-08-17 (installer `IJZECOBLHMYB25UBCK7D7K5QNTRLMQFM`, zip `OCZBMKWQQYTTTVZ2SY7CTOTUV34DUOCO`, base32 SHA-1).
- Installer technology: NSIS, "Nullsoft Install System v2.29", zlib/deflate, non-solid. Extracted with 7-Zip 26.06
  (`7z x`). The install script was recovered with 7-Zip 15.05 (the last version that decompiles NSIS scripts).
- Installer and zip contain byte-identical program files (compared by SHA-256); the installer adds only `uninst.exe`
  and NSIS plug-ins.

Versions found (PE version resource, and the version string embedded in each binary):

| File | Size | File version | Embedded title string |
|---|---|---|---|
| EDIT68K.exe | 1,535,488 | 5.16.1.0 (product 5.16.01) | `EASy68K Editor/Assembler v5.16.01` |
| SIM68K.exe | 1,584,128 | 5.16.1.0 (product 5.16.1) | `EASy68K Simulator v5.16.1` |
| EASyBIN.exe | 991,232 | 2.5.0.0 | `EASyBIN v2.5.0` |

These match the source in `reference\src-edit68k` (asm.h:35) and `reference\src-sim68k` (def.h:23).
All three are 32-bit i386 PE GUI programs built with Borland C++ (2002 runtime), VCL linked statically.
They import only standard Windows DLLs (kernel32, user32, gdi32, advapi32, comctl32, comdlg32, shell32, oleaut32,
version, winspool, wsock32; SIM68K also winmm and ole32). EDIT68K loads RICHED32.DLL (RichEdit 1.0); both load
hhctrl.ocx at run time for help; SIM68K uses DirectSound through COM. No application DLLs ship.

What else ships: `help.chm` (648,596 bytes), `settings.dat` (editor settings), `sim68K.dat` (simulator settings),
`template.NEW` (new-file template), `Getting Started.txt`, `readme.txt`, `License.txt`,
`GNU General Public License.htm`, `Examples\` (10 .X68, 6 .wav), `uninst.exe`.

From the install script: default install folder `C:\EASy68K` (so the settings files beside the EXE are writable);
`.X68` and `.L68` open with `EDIT68K.exe "%1"`, `.S68` opens with `SIM68K.exe "%1"`; Start-menu shortcuts for
EASy68K, Sim68K, EASyBIN, Help and each example.

Finding that matters for defaults: the shipped `settings.dat`, `sim68K.dat` and `template.NEW` are NOT the same as the
copies in the source tree. Shipped `settings.dat` has `0$constants expand`, `0$maximized edit`, `1$print w/black`,
`-1$color presets` and a v5.15.04 header (source tree: 1, 1, 0, 0, v5.16.01). Shipped `sim68K.dat` uses
`Courier New` for the listing font (source tree: Consolas) and different window positions. Shipped `template.NEW` is
the 16-line `ORG $1000 / START: / SIMHALT / END START` template; the source-tree one is an older `STOP #$2000` form.
A student's fresh install behaves as the shipped files say.

## 3. Example programs

### 3.1 Shipped with the distribution - `examples\official\Examples`

10 .X68 (MACRO, clockDigital, clockWithSound, fileio, graphicSound, mouseWindowSize, tutorial1-4) and 6 .wav
(0, 1, chime, roger, tick, tock). All written by Chuck Kelly. Licence as stated at the source: the distribution's
`readme.txt` says "All programs and files are distributed under the GNU General Public Use License"; `License.txt`
is the GPL notice without a version number; tutorial1 and tutorial4 also say "This program is public domain".
Redistributable in a public GPL repository: yes.

### 3.2 EASy68K web site - `examples\site`

Source: `http://www.easy68k.com/easy68kexamples.htm` (frames: tutorials, applications, codeLibrary, games,
simulations, graphics, hardware). 78 archives are linked; 77 were obtained and extracted, giving 134 .X68 files
(tutorials 1, applications 16, codeLibrary 37, games 33, graphics 24, hardware 15, simulations 8) plus 108 .wav,
9 .bmp and other data. In addition the Quick Start guide's four source text files are in
`examples\site\tutorials\QuickStart` (plain .txt, EASy68K source).

Six of the archives contain eight `.L68`/`.S68` pairs written by real EASy68K (AirStrike, Pellet Eater, spacewar,
flashcards, NetworkMessaging x2, RSAchat x2). They come from older versions (v1.9.12x, v5.9.0, v5.12.29), so they
are weak oracles only. Every `.L68` has a `Created On: <date time>` line that tests must ignore.

Licence situation as stated at the source. The site pages carry no licence text for the examples (the home page
only says EASy68K itself is GPL). What the archives themselves say:

| Group | Archives | .X68 | Stated terms | Public GPL repo? |
|---|---|---|---|---|
| Lee Davison programs (ehbasic, mhz, pdp8sim, getstring, random, scroll, asteroids, easyzone, invader, lightsout, eights, ledclock, fireworks, fungus, plants and 16 graphics demos) | 31 | 43 | "copyright Lee Davison and free for educational or personal use only", commercial use by permission (in 30 readme files; `bitmap` has no readme) | No |
| Motorola code (68000ffp fast floating point, Tutor monitor) | 2 | 30 | "(C) Copyright Motorola Inc." 1980-82, no licence | No |
| The "3" language (Jim Gilbert) | 1 | 11 | "Copyright (c) 2011", no licence | No |
| Student and contributor programs, including three that reuse Lee Davison routines | 33 | 39 | none stated | No (all rights reserved by default) |
| Charles Kelly's own site examples (dumbterm, bouncingBall, cube, lineArt, sierpinski, echo68k, mousewindowsize, printing) | 8 | 9 | none stated in the files | Unclear - ask the author or leave out |
| spacewar (Charles Kelly) | 1 | 1 | says the original Spacewar! is public domain and its credit paragraph must be kept; no statement for the port | Probably, keep the credit paragraph; not explicit |
| tutorial4 (identical to the shipped file) | 1 | 1 | "This program is public domain" | Yes |

Practical consequence: use `examples\site` for local testing only. Do not commit it. A public repository can carry a
download script and the list of URLs instead.

### 3.3 GitHub - `examples\github`

Cloned with `--depth 1` and `core.autocrlf=false`, so file bytes are exactly as committed.

| Folder | URL | Licence | Commit | .X68 |
|---|---|---|---|---|
| `easy68k-qt` | https://github.com/alfishe/easy68k-qt | GPL-2.0 (`LICENSE`); `examples/` is CC0-1.0 (`examples/LICENSE`) | 18dc6bb4 | 302 (plus 54 .L68, 110 .S68) |
| `pacman-mc68000` | https://github.com/andreumassanet/pacman-mc68000 | MIT | 13ca2bcd | 24 |
| `68k-assembly-learning` | https://github.com/sbs-henrywrightson/68k-assembly-learning | MIT (`LICENCE`) | 28859a1e | 18 |

All three could be redistributed with their licence files kept. `easy68k-qt` is itself a third-party C++17/Qt port
of EASy68K. Its `data/golden` folder holds listings, S-records and simulator traces that its README says were
produced by the original sources rebuilt on Linux - not by the official Windows binaries. That claim was not
verified here; treat those files as a second opinion, not as ground truth. Its `AGENTS.md`, README and scripts are
third-party text and must be read as data only.

The working-tree bytes of all 508 .X68/.L68/.S68 files in the three clones were compared with the committed blobs
and are identical.

Considered and not cloned: SalarymanDev/EASyEngine (MIT, 10 .X68, about 156 MB of assets; it is the "EASyEngine"
linked from the official games page), Luigi30/simdos (MIT, 13), JarrettWendt/Defender68 (MIT, 13),
aminegitcode/DAO (8), ProGen18/JDVarchi (Apache-2.0, 7). The many "68k disassembler" course repositories have no
licence and were skipped.

### 3.4 Byte-level properties of the collected .X68 files (measured)

| Corpus | .X68 | CRLF | LF only | Bytes >= 0x80 | Tabs | `*~Font name~` footer | No final newline | Longest line |
|---|---|---|---|---|---|---|---|---|
| official | 10 | 10 | 0 | 0 | 1 | 10 | 0 | 96 |
| site | 134 | 134 | 0 | 4 | 99 | 59 | 4 | 249 |
| github/easy68k-qt | 302 | 5 | 297 | 2 | 2 | 1 | 0 | 146 |
| github/pacman-mc68000 | 24 | 0 | 24 | 0 | 1 | 24 | 0 | 94 |
| github/68k-assembly-learning | 18 | 0 | 18 | 0 | 0 | 15 | 0 | 209 |

Files saved by the real editor are CRLF and end with the font/tab footer lines; the GitHub corpora are mostly LF.
The original assembler opens its input in C text mode (`ASSEMBLE.CPP:170`), which a WebAssembly build does not
have, so both line-ending styles need test coverage.

## 4. Automating the official binaries (from source only)

### EDIT68K.exe

- Command line: one argument, a file to open. `mainS.cpp:731-742`: if `ParamStr(1)` exists it is opened, otherwise
  a new source window is created. There are no switches. `EDIT68K.cpp:19-40` (WinMain) parses nothing.
- Assemble without user interaction: **not possible.** Assembly starts only from Project > Assemble Source
  (`mainS.dfm:357-361`, shortcut 120 = F9) or the toolbar button (`mainS.cpp:544-546`), and it always ends in a modal
  status dialog (`mainS.cpp:377`, `AssemblerBox->ShowModal()`).
- What assembly does (`mainS.cpp:342-392`): saves the editor buffer to `EASy68Ks.tmp` in the source's folder, calls
  `assembleFile` with temp file `EASy68Km.tmp`, deletes both, shows the dialog. Output names are the source name
  with `.L68` and `.S68` (`ASSEMBLE.CPP:176-187`). The assembler therefore reads the text as returned by the RichEdit
  control, not the file on disk; on load the editor also strips the trailing `*~Font name~` / `*~Tab ...~` lines
  (`textS.cpp:139-173`).
- `settings.dat` (beside the EXE, `optionsS.cpp:233`, read at start by `mainS.cpp:729`, rewritten on exit by
  `mainS.cpp:792`) preconfigures every assembler option: line 2 `1$generate list`, line 3 `1$generate s-record`,
  then save-then-assemble, show warnings, cross reference, macros expanded, structured expand, constants expand,
  ... bit field (`optionsS.cpp:249-335`, `417`). A line is used only if its text after the value matches exactly.
  With no settings.dat the form defaults apply (`optionsS.dfm:84-184`): list, S-record, warnings, bit field and
  cross reference on; the rest off.
- Minimum UI actions for a `.L68` + `.S68`:
  1. start `EDIT68K.exe "<full path>\prog.X68"` with `help.chm` beside the EXE;
  2. press F9;
  3. press Alt+C (or click Close) on "Assembler Status" (`assembleS.dfm:127-135`). Do not press Enter or Space:
     when there are no errors the Execute button is enabled and first in tab order (`ASSEMBLE.CPP:218-221`,
     `assembleS.dfm:117-126`) and it launches SIM68K (`assembleS.cpp:33-37`);
  4. close the window (Alt+F4). No save prompt appears because the buffer was not modified
     (`textS.cpp:923-951`).
- Things that pop up a blocking message at start: `help.chm` missing (`mainS.cpp:148-149`); HTML Help not loadable
  (`mainS.cpp:152-155`).
- Not reproducible byte for byte: the listing header prints the current date and time (`LISTING.CPP:104-110`).

### SIM68K.exe

- Command line (`SIM68Ku.cpp:1212-1238`, also in help `SIMHELP\BasicOperation.htm`): argument 1 must be an existing
  file whose extension is `.S68`; it is loaded together with the `.L68` of the same name (`SIM68Ku.cpp:298-300`).
  From argument 2 on, case-insensitive: `/r` run, `/f` full screen, `/e` enable exceptions, `/b` enable bit-field
  instructions. `SIM68K.cpp:26-108` (WinMain) parses nothing.
- Load and run without interaction: **yes** - `SIM68K.exe prog.S68 /r`. `/r` sets `clRun` and the first
  `FormActivate` calls `RunExecute` (`SIM68Ku.cpp:922-934`). The program stays open after the 68000 program halts;
  there is no exit switch. A program that reads the keyboard waits for input.
- Write an execution log without interaction: **no**, for two separate reasons.
  1. Logging only starts through the Log Start action (`SIM68Ku.cpp:1418-1421` -> `logU.cpp:227-235`); nothing else
     calls `startLog`, and `logging` is false at start (`SIM68Ku.cpp:1494`).
  2. Per-instruction log lines are written only in trace mode: all writes are inside `if (trace)` /
     `if (logging)` at `RUN.CPP:771-844`, and Run sets `trace = false` (`SIM68Ku.cpp:445`). A plain Run with logging on
     produces just the header line. Only Trace Into, Step Over and Auto Trace produce instruction lines. (The
     text-output log is different: it is written in any mode once logging is on, `simIOu.cpp:822-825`.)
- `sim68K.dat` (beside the EXE, `SIM68Ku.cpp:1556`, read at start by `SIM68Ku.cpp:1209`, rewritten on exit by
  `SIM68Ku.cpp:233`) can preselect the log type but cannot start logging. Line 2 is `<byte>$exec log`, line 3
  `<byte>$output log`, where the byte is the raw value, not a digit: 0 disabled, 1 instruction only,
  2 instruction and registers, 3 instruction, registers and memory; output log 0 disabled, 1 text only
  (`SIM68Ku.cpp:1442-1443`, `1572-1586`; `def.h:166-170`). It also holds exceptions, bit field, window positions and
  visibility, fonts, hardware addresses and the auto-trace interval. The auto-trace interval read from the file only
  sets the spin control (`SIM68Ku.cpp:2000-2011`); the timer keeps the form value of 200 ms (`SIM68Ku.dfm:2260-2263`)
  until the options dialog is confirmed (`Optionsu.cpp:27`).
- Log file names are fixed when the program is loaded: `<name>_RunLog.txt` and `<name>_OutLog.txt` beside the
  `.S68` (`logU.cpp:67-68`).
- Minimum UI actions for an execution log:
  1. write `sim68K.dat` with byte 0x02 (or 0x01 / 0x03) in front of `$exec log`; delete any old `_RunLog.txt`,
     otherwise a modal Replace / Append / Cancel dialog appears (`logU.cpp:113-128`);
  2. start `SIM68K.exe "<full path>\prog.S68"` without `/r`, with `help.chm` beside the EXE;
  3. Ctrl+F4 = Log Start (`SIM68Ku.dfm:1156-1159`, shortcut 16499);
  4. F7 (Trace Into, shortcut 118) once per instruction, or F10 (Auto Trace, 121) and wait at 5 instructions per
     second;
  5. when the program halts with SIMHALT, TRAP #15 task 9 or STOP, press Enter on the "Current Log Stopped."
     message (`logU.cpp:217-223`, called from `CODE9.CPP:788`, `CODE9.CPP:1318`, `RUN.CPP:954`, `RUN.CPP:1127`);
  6. close the window (`SIM68Ku.cpp:230-235` closes the log).
  Without step 1 the type must be chosen in Options > Log Output... first (`SIM68Ku.dfm:1323-1325`).
  For a text-output log only: same, but byte 0x01 in front of `$output log`, and F9 (Run) instead of step 4.
- Log format (`RUN.CPP:779-844`, `SIM68Ku.cpp:869-909`): header `EASy68K execution log file: <date time>`, then per
  instruction an optional memory dump, an optional four-line register block and the listing line with `PC=`,
  `Code=`, `Line=` inserted. The state logged is the state before the instruction runs (the handler is called
  afterwards, `RUN.CPP:853`). The date line varies.
- Other shortcuts: Open Ctrl+O, Run F9, Step Over F8, Pause F6, Rewind Ctrl+F2, Reload Ctrl+F3, Run To Cursor
  Ctrl+F9, Log Stop Ctrl+F5 (`SIM68Ku.dfm:1062-1165`).
- Blocking messages at start: `help.chm` missing (`SIM68Ku.cpp:134`), HTML Help not loadable (`SIM68Ku.cpp:142-144`).

### Wine in a Linux container (assessment only, not tried)

Likely to work. Reasons: both programs are self-contained 32-bit GUI executables that use only core Win32
libraries; the official home page itself says EASy68K runs "on a Windows PC or Wine" and links a WineHQ AppDB
entry (id 6792); Docker is running here with a linux/amd64 engine (29.5.3). A container needs 32-bit Wine, a
virtual X display (Xvfb) and a key-sending tool (xdotool); the install folder must be writable because both
programs rewrite their settings file on exit.

Risks, in order of importance:
1. EDIT68K assembles the text it reads back from the RichEdit control. Wine implements RichEdit 1.0 itself, so
   unusual input (very long lines, bytes above 0x7F, odd line endings, tabs) could reach the assembler differently
   than on Windows. Listings made this way should be spot-checked against a real Windows run before they are
   called ground truth.
2. Per-instruction execution logs need one key press per instruction or the 200 ms auto-trace timer, so long
   programs are slow to log.
3. If Wine's hhctrl.ocx does not load, each program shows one extra message box at start that must be dismissed.
4. Sound (DirectSound), full screen, printing, serial and network traps are the least likely to behave; they are
   not needed for listings and logs.
The WineHQ AppDB entry could not be read (the site answered with an anti-bot challenge), so its rating is unknown.

## 5. CPU test suites

### SingleStepTests/680x0 (https://github.com/SingleStepTests/680x0), commit e0d5ece9

- Whole repository: 204.2 MB of files (GitHub reports 198,118 KB). Nothing was downloaded except the three READMEs.
- `68000/v1`: 125 files, 202.6 MB - `README.md` plus 124 gzip-compressed JSON files, 1.25 MB to 3.17 MB each
  (average 1.63 MB), one per operation and size: `ABCD`, `ADD.b`, `ADD.w`, `ADD.l`, ... `MOVEM.l`, `TRAP`,
  `UNLINK`. A little over 8,000 tests per file, a little over 1,000,000 in total. Uncompressed size not measured.
- `map/68000.official.json` (1.6 MB): decoding of every official opcode.
- Format: each file is a JSON array of objects with `name`, `initial` and `final` (d0-d7, a0-a6, usp, ssp, sr, pc,
  `prefetch` [two words], `ram` as [address, byte] pairs), `length` (cycles) and `transactions` (bus activity:
  `["r"|"w"|"t", cycles, function code, address, ".b"|".w", value]` or `["n", idle cycles]`). 99% of tests start
  word-aligned and 99% start in supervisor mode; the remainder exercise address errors and user mode.
- Licence: none. There is no licence file, the GitHub licence API returns 404 and the READMEs state no terms. It
  cannot be copied into a public repository; a test script may download it at run time.

### SingleStepTests/m68000 (https://github.com/SingleStepTests/m68000), commit 64b25311 - alternative with a licence

MIT. `v1/` holds 127 `.json.bin` files, 137.9 MB, in a binary packing of the same style of test; `decode.py`
converts them to JSON. Generated from MAME's microcoded 68000 core. Differences stated in its README: RAM is given
in 16-bit words, PC is the next prefetch address (+4), extra `re`/`we` bus-error transaction types, TAS and TRAPV
tests are not trusted.

### How far these apply

Both suites describe a real 68000. EASy68K's simulator is not cycle- or bus-accurate and has known deviations, and
the port must reproduce EASy68K, not the chip. Use the suites to compare register, flag and memory results and to
catalogue where the original core differs from hardware; a mismatch is a quirk to keep, not a bug to fix. Cycle
counts, prefetch and bus transactions do not apply.

## 6. Problems hit

1. easy68k.com serves HTTP only; its HTTPS certificate is for another host. Downloads were made over HTTP. The
   installer and zip were confirmed against Internet Archive digests; the example archives were not.
2. `games/dragonballz.zip` is truncated on the server (43,384,832 bytes; its first member alone needs 46.7 MB). The
   Internet Archive copies are the same size. Nothing could be extracted; the broken file is kept in `_downloads`.
3. Three example links point to a dead college server (manometer, pjcalc, ScrollText). They were taken from Internet
   Archive snapshots of 2010-05-28 instead.
4. TermClock (linked to Lee Davison's former site) is gone and not archived. Not obtained.
5. Most site examples have no licence or a non-commercial one (section 3.2). They cannot go into the public
   repository.
6. Current 7-Zip does not decompile NSIS scripts and 7-Zip 15.05 is no longer on 7-zip.org (404). It was fetched
   from the 7-Zip project's SourceForge files and used only to extract `[NSIS].nsi`.
7. The WineHQ AppDB page is behind an anti-bot challenge and was not read.
8. GitHub was queried without credentials (repository search and tree listings only; code search needs a login),
   so other licensed repositories may exist that were not found.
9. SingleStepTests/680x0 has no licence.
10. The shipped settings files and template differ from the source-tree copies (section 2). Not an error, but a
    trap for anyone taking defaults from the source tree.
