# Ground truth from the official EASy68K binaries (Wine in Docker)

Measured 2026-11-20 on Windows 11, Docker Desktop 29.5.3 (linux/amd64, 20 CPUs), image
`easy68k-oracle-official:dev` built from `tools/oracle-official/Dockerfile` (Debian 12,
Wine 8.0 `wine32`, Xvfb, xdotool 3, ImageMagick 6). The programs are the official
`EDIT68K.exe` 5.16.1 and `SIM68K.exe` 5.16.1 from `reference/official-extracted`
(SHA-1 checked against the Internet Archive copy of the installer, `ground-truth.md` section 2).
They ran only inside the container. Commands are in `tools/oracle-official/README.md`.

Everything below was run and observed unless marked otherwise.

## 1. Summary

| Question | Answer |
|---|---|
| Does EDIT68K run under Wine and assemble unattended? | Yes. 485 of 488 corpus sources assembled with both option sets (486 with default options after a one-hour re-run); the others are a crash of the official program and two multi-megabyte files that take 48 minutes / over an hour to load (section 3.2). |
| Does the assembler receive the same text as on Windows? | For the whole corpus the text handed to the assembler equals the expected buffer byte for byte (485/485). Synthetic stress files found four Wine deviations or unverified cases: NUL byte, UTF-8 byte-order mark, bare CR at end of file, trailer without final newline (section 3.4). |
| Official 5.16.1 vs the v5.15.4 command-line oracle | 424/485 S-records identical; every listing difference falls into a known class (section 4). |
| Does SIM68K run unattended? | Yes, with `/r` and a self-reporting program: dump ready about 1.3 s after start (section 5.1). |
| Execution logs through the UI | Yes. Auto Trace about 60-70 instructions/s, Trace Into about 5/s (section 5.2). |
| Can exceptions / bit field be set without the UI? | Yes, both by command line (`/e`, `/b`) and by `sim68K.dat` (`1$exceptions`, `1$bit field enabled`), proven by programs (section 5.3). |
| Graphics screenshots | Work, and match the simulator's own back buffer at 7 probe points, but Wine's GDI is not Windows' GDI: not a pixel-exact reference (section 5.4). |

> **Corrected (erratum T1 1).** The paths of this document are those of the hand-off. The oracle now lives in `tests/oracle/wine/` (section 8 of ARCHITECTURE.md); the measurements stand, only the names changed: `tools/oracle-official/Dockerfile` is `tests/oracle/wine/Dockerfile`; `scripts/entry.sh`, `stage.sh`, `xwin.py` are in `tests/oracle/wine/common/`; `asm_batch.py`, `asm_corpus.sh`, `richedit_check.py`, `gen_richedit_stress.py`, `merge_manifests.py` in `tests/oracle/wine/asm/`; the simulator scripts in `tests/oracle/wine/sim/` (T3); `run-asm-corpus.sh` is `tests/oracle/wine/asm/regenerate.mjs` (`npm run oracle:wine:asm`, `asm/run.sh` for one file); `compare_cli.py` was not carried over (erratum T1 8); the image `easy68k-oracle-official:dev` is `easy68k-oracle-wine` (`npm run oracle:wine:build`); outputs under `build/ground-truth/asm/...` are the tracked `tests/conformance/asm/golden/<program id>/<label>.L68` / `.S68` (the `site` set in `build/golden-local/asm/<program id>/`), and the manifest is `tests/corpus/manifest.json`. `tests/oracle/wine/common/fetch-official.mjs` downloads and checks the official distribution; the image is pinned (`debian:bookworm-slim` by digest, Wine `8.0~repack-4`; erratum T1 18). An unexpected window fails the run; the help viewer's boxes are the one exception (erratum T1 16).

## 2. The container

- 32-bit Wine prefix (`WINEARCH=win32`) created at image build time; `WINEDLLOVERRIDES="mscoree,mshtml="`
  so no Mono/Gecko installer dialogs. `wineboot` takes about 5 s at build time.
- `scripts/entry.sh` starts `Xvfb :99 -screen 0 1280x1024x24` and waits for it with `xdpyinfo`.
  There is no window manager: every Win32 top-level window (form, modal dialog, message box) is
  one X window whose name is the Win32 caption. Controls are not X windows, so buttons are
  reached by their Alt+letter accelerators. `xdotool windowfocus <id>` followed by `xdotool key`
  delivers keys reliably; `windowactivate` does not work (no `_NET_ACTIVE_WINDOW`).
- The official folder is mounted read-only at `/mnt/official` and copied to `/opt/easy68k`
  by `scripts/stage.sh`, because both programs rewrite their settings file on exit. Every run
  writes `settings.dat` / `sim68K.dat` fresh before starting the program.
- No start-up message box appeared: `help.chm` is present and Wine's built-in `hhctrl.ocx`
  loads (Wine logs `HtmlHelpW HH case HH_INITIALIZE not handled`, harmless). The drivers still
  dismiss any unexpected window (Enter, or `n` on a "Confirm" box), screenshot it and record its
  title in the manifest. None appeared in the corpus runs.
- `docker run --init` is required for long-lived containers: Wine leaves zombie processes, and
  without an init process `pgrep` keeps matching them (seen in development).
- Never-leave-a-process-behind rule: after every file the driver waits for the program to exit,
  kills it (`SIGKILL` on the matching processes) if it did not, and runs `wineserver -k` if even
  that fails. Each corpus container ends with `wineserver -k` and is removed (`--rm`).

## 3. Assembler (EDIT68K.exe)

### 3.1 Automation (`scripts/asm_batch.py`)

Per source file:

1. Delete old `<name>.L68` / `.S68` (any case) and stale `EASy68Ks.tmp` / `EASy68Km.tmp`; write
   `settings.dat` (shipped file, or with lines 7-9 `1$macros expanded`, `1$structured expand`,
   `1$constants expand` for the "expand" set).
2. Create an empty `EASy68Ks.tmp` beside the source and a hard link to it in `/tmp` (3.3).
3. Start `wine EDIT68K.exe Z:\<path>` with the source folder as working directory.
4. Wait for a window titled `^EASy68K Editor/Assembler` (polling every 0.1 s; up to the file's
   time limit, because large files take long to load - 3.2). While waiting, stop early if the
   process exits (crash) and dismiss stray windows.
5. Press F9. Wait 3 s for `^Assembler Status`; if it has not appeared and neither the capture
   file nor the `.L68` shows that assembly started, press F9 again (never needed in practice:
   0 of 976 runs). Once started, wait up to the time limit.
6. Dismiss any modal box above the status dialog, then press **Alt+C** (Close) until the dialog
   is gone. Never Enter or Space: with no errors the default button is Execute, which starts
   SIM68K (`assembleS.dfm:117-126`).
7. Alt+F4 on the main window; wait up to 15 s for the process to exit, answering `n` to a
   "Confirm" save prompt if one appears (none did: the buffer is never modified). All 970
   successful runs exited cleanly.
8. Copy `.L68`, `.S68` and the captured buffer (`<name>.received.txt`), record a manifest entry.

The time limit is 300 s by default (`--timeout`, `ASM_TIMEOUT`).

Manifest record (`build/ground-truth/asm/<options>/manifest.json`, `files[]`): `source`,
`status` (`ok`/`fail`), `error`, `outputs`, `errors` and `warnings` (parsed from the listing
trailer), `status_title`, `f9_presses`, `exit` (`clean` or `killed ...`), `stray_windows`,
`source_features` (line endings, bytes >= 0x80, tabs, longest line, final newline, trailer),
`received_bytes`, `richedit` (`identical`, `kinds`, `detail`), **`reliable`** (true only when the
run succeeded and the received text is identical to the expected text), phase times
`t_main` / `t_status` / `t_closed`, `seconds`. The `summary` block lists totals and
`unreliable_richedit`.

### 3.2 Corpus results

Corpus: every `.X68` (any case) under `reference/examples` except `site/_downloads`: 488 files
(official 10, site 134, github 344; the `easy68k-qt` files are used only as local input).
Each source is assembled in place in a container-local copy of the whole corpus, so relative
`INCLUDE`s resolve as in the original layout.

| Options | Total | OK | Failed | Reliable | With assembly errors |
|---|---|---|---|---|---|
| default (shipped `settings.dat`) | 488 | 486 | 2 | 486 | 66 |
| expand (macros, structured, constants expanded) | 488 | 485 | 3 | 485 | 66 |

The default set includes `ALLGAMES4.1.X68` from the one-hour re-run (3.2.1); the expand set
was not re-run for it. All other counts come from the 300 s run.

Failures, all reproducible:

- `github/easy68k-qt/data/golden/asm/corpus/diagnostics.x68`: **the official EDIT68K crashes**
  during assembly. Wine reports `virtual_setup_exception stack overflow 1348 bytes addr 0x4e6659`
  and the process exits; `.L68` and `.S68` are left at 0 bytes. The file contains a macro that
  calls itself (`MAC1 MACRO / MAC1 / ENDM`), which the source guards with a "Nested Macro calls
  are too many levels deep" error; in the real binary the recursion overflows the 1 MB main-thread
  stack first. Whether Windows also crashes is not verified, but a stack overflow there is
  equally fatal. The driver detects the exit within a second and records the Wine error line.
- `github/pacman-mc68000/GAME/GFX.X68` (2,438,385 bytes) and
  `site/games/AlienInvasion_Pucky_Protector/ALLGAMES4.1.X68` (1,242,388 bytes): the editor window
  did not finish appearing within 300 s. Loading text into the RichEdit control and colouring it
  (`colorHighlight`) is slow under Wine: `Basic68s3.52.x68` (305 KB) needs 59 s, and the cost grows
  faster than linearly. See 3.2.1.

#### 3.2.1 The two very large files

These were re-run with a 3600 s limit (`ASM_TIMEOUT=3600`, default options only; the run was
stopped before the expand pass):

- `ALLGAMES4.1.X68` (1.2 MB): **OK**. The editor window appeared after 2,907 s (48 minutes of
  loading and colouring), the status dialog 161 s later; 0 errors, 0 warnings; the received
  text is identical to the source; the editor exited cleanly. 3,075 s in total.
- `GFX.X68` (2.4 MB): the window had still not appeared after 3,600 s; recorded as failed.

So under Wine the editor is impractical for sources above roughly 1 MB. Whether the real
Windows editor is faster is not known. These files are data tables; the CLI oracle or the port
itself is the practical way to test them.

Other observations:

- Median 7.2 s per file (7.3 s with expansion), mean 7.7 s. Median phase times: editor
  window visible at 0.56 s, status dialog at 0.79 s (assembly itself is fast), dialog closed at
  2.96 s; the remaining 4 s are Wine shutting the program down after Alt+F4. 8 containers in parallel did both option
  sets of the corpus in 18.6 minutes wall time (sum of per-file times 3,729 s + 3,811 s).
- The status dialog caption is `Assembler Status - <active window's file>`
  (`assembleS.cpp:60`). In 2 files (`inc_nest1.x68`, `lightsout.x68`) it named an included file
  (`INC_NEST2.X68`, `MOUSE.X68`): the editor opens an included file that has errors or warnings
  in its own window, which then is the active window. Expected behaviour, recorded as `warning`
  in the manifest.
- Error counts and outputs are identical between the default and expand sets except where the
  expansion options add listing lines.

### 3.3 What the assembler actually receives (RichEdit check)

EDIT68K does not assemble the file on disk. It loads the file into a RichEdit 1.0 control
(`textS.cpp:128`), deletes the `*~Font name~` / `*~Font size~` / `*~Tab type~` / `*~Tab size~`
trailer lines among the last lines (`textS.cpp:140-173`), and before assembling writes the
control's text to `EASy68Ks.tmp` beside the source (`mainS.cpp:371-373`), assembles that file
and deletes it (`mainS.cpp:375`). Wine implements RichEdit itself, so this round trip is the
main risk of using Wine.

**Capture method.** Before the editor starts, the driver creates an empty `EASy68Ks.tmp` and a
hard link to it. The VCL saves with `CREATE_ALWAYS`, which Wine implements as an open with
truncate of the existing file (same inode), so after `DeleteFile` removes the name the link
still holds exactly the bytes the assembler read. Verified: `tutorial1.X68` (3,660 bytes)
gives a 3,587-byte capture = the source minus its 73-byte trailer.

**Expected text** (`scripts/richedit_check.py`): split the source into lines at CR LF, LF or
CR; drop the trailer lines exactly as `textS.cpp:140-173` does; join with CR LF; end with CR LF
if the source ended with a line break. This is the editor's behaviour as written in the source
plus the documented plain-text save (`editor-ui.md` 6.7).

**Corpus result: every successful run identical** (485 of 485 per option set, plus
`ALLGAMES4.1.X68`). That covers 337 LF-only files
(Wine's control turns LF into CR LF, as the model expects), 102 files with tabs, 6 files with
bytes >= 0x80 (Windows-1252 text such as `é`, `’`), 4 files without a final newline, lines up
to 249 characters, and every trailer form in the corpus. No file in the corpus is flagged
unreliable.

### 3.4 RichEdit stress test (synthetic files)

The corpus does not contain the riskiest inputs, so `scripts/gen_richedit_stress.py` writes 24
small programs (results in `build/ground-truth/richedit-stress/default/manifest.json`):

| File | Content | Received text |
|---|---|---|
| s01 | every byte 0x01-0xFF except CR, LF, 0x1A in comments | identical |
| s02 | bytes 0x80-0xFF in `DC.B` strings | identical |
| s03 | comment lines of 255, 256, 300, 1000 characters | identical |
| s03 | comment line of 4000 characters | identical (written), but see below |
| s04 | `DC.B` line of about 1500 characters | identical |
| s06, s07, s09 | mixed CR LF / LF / CR, LF only, CR CR LF | identical |
| s08 | no final newline | identical |
| s10, s11 | Ctrl-Z in a comment, Ctrl-Z at end of file | identical (bytes kept) |
| s13, s14 | form feed, vertical tab; tabs and trailing blanks | identical |
| s15 | UTF-8 text without byte-order mark | identical (bytes kept as ANSI) |
| s17, s18 | normal trailer, CR LF and LF | identical |
| s20 | empty file | identical |
| **s05** | bare CR line endings, **file ends with a bare CR** | final line break **dropped**: text ends `END START` without CR LF |
| **s12** | **NUL byte** in a comment | text **cut at the NUL**: everything after it is lost (7 lines become 3) |
| **s16** | **UTF-8 byte-order mark** | Wine **drops the 3 BOM bytes** |
| **s19** | trailer **without a final newline** | one **extra empty line** at the end (`START\r\n\r\n`) |

How real Windows RichEdit 1.0 behaves on these four is **not known**; the classification only
says that Wine differs from the simple model. Listings from such files are flagged
`reliable: false`. Practical weight: a BOM or NUL in a student's `.X68` is rare, and the
assembler ignores trailing blank lines, so s05 and s19 do not change the listing body.

Other things the stress files showed about the **official program itself** (not Wine):

- A 4000-character line makes EDIT68K raise `Access violation at address 00479971 in module
  'EDIT68K.exe'. Read of address 58585B44.` (0x58 = 'X', the line's text) in a VCL message box
  titled `EASy68K` over the status dialog. The box comes back after Enter, so the driver times
  out, records the failure with screenshots and kills the program; `.L68`/`.S68` (14 errors)
  were written. Lines of 1000 characters already give 2 errors, because the assembler reads
  source lines with `fgets(line, 256, ...)`.

### 3.5 Official 5.16.1 vs the 5.15.4 command-line oracle

`tools/oracle-official/compare_cli.py` runs `build/oracle/asm-cli-5.15.4/bin/asy68k.exe` on a
copy of the corpus with the matching options (`--macroexpand --structureexpan
--expandconstants` for "expand"), **with the source folder as working directory** like the
editor (`mainS.cpp:370`; without it the CLI cannot find relative `INCLUDE`s), and compares
S-records byte for byte and listings after dropping the three header lines
(`Starting Address`, `Assembler used:`, `Created On:`). Differing lines are aligned with
difflib on whitespace-free text and classified. Report: `build/ground-truth/cli-compare/<options>/report.json`.

| | default | expand |
|---|---|---|
| Sources compared (official OK in the 300 s run) | 485 | 485 |
| `.S68` byte-identical | 424 | 424 |
| `.L68` identical apart from the header | 343 | 331 |
| Error count differs | 5 | 5 |

Classes of listing difference (files / differing lines, default options; the expand set has the
same classes with more lines):

| Class | Files | Lines | Explanation |
|---|---|---|---|
| Tab expansion / hex letter case | 103 | 53,425 | CLI forces tab type "Assembly" (`assembler.md` 8.2, `LISTING.CPP:149`); the official editor uses the `settings.dat` tab settings (Fixed, 4). Same text after removing white space. Structured-code labels: CLI `_0000000e`, official `_0000000E` (`IntToHex` vs `%08x`, 8.2). |
| Object code of lines with an undefined symbol | 57 | 2,123 | Both programs encode an **uninitialised value** for an undefined symbol. The official one shows heap-like values (`004DBD16`, `005455B8`, `BD16`, `55D4`); the CLI shows `00000000` or other values. These words are **not reproducible ground truth**: they depend on the process's memory and may differ between Windows and Wine. Tests must mask object code on lines that carry an `Undefined symbol` error. Mostly include-only files assembled on their own (pacman `GAME/*.X68`, the "3" language modules). |
| Editor strips the trailer, CLI assembles it | 37 | 185 | The CLI sees the `*~Font...~` lines as comment lines (and, in files without `END`, reports the missing END after them). The editor deleted them before assembling. |
| CLI does not upper-case lines containing INCLUDE/INCBIN | 5 | 3,046 | CLI-only regression (8.2, `ASSEMBLE.CPP:414-420`): `include 'x'` in lower case and even `bra x * continue in included file` become "Invalid opcode" in the CLI; following addresses shift. Explains 4 of the 5 error-count differences and the `MyClient`/`MyServer` object-code shifts. |
| CLI-only "Could not open file" line | 2 | 4 | 8.2 (`DIRECTIV.CPP:703-705`): only for genuinely missing include files. |
| 5.16.1: `(label,PC,Xn)` displacement `$FE` | 1 | 1 | 8.3 #4: `operands.x68` `MOVE.W (START,PC,D1.W),D0`: official `303B 10FE`, CLI `303B 10AA`. |
| 5.16.1: `(d,An)` with `P` first or `C` second -> Invalid syntax | 1 | 3 | 8.3 #3. |
| Object code differs (other) | 2 | 124 | `MyClient.X68`, `MyServer.X68`: forward-reference addresses shifted by the CLI include regression above. |

No unexplained class remains. The S-record differences (61 files) all come from these classes:
undefined-symbol values, the CLI include regression, and the 5.16.1 operand changes.

> **Corrected (erratum T1 4).** "Mask object code on lines that carry an `Undefined symbol` error" takes three rules (`tests/conformance/asm/compare.ts`): (1) the object-code field (columns 11-32) of the statement, whose message stands above its last listing line (with Constants Expanded the last continuation line); (2) in the symbol table, the value of an entry whose name cannot be a label (`,D0`), which the original leaves uninitialised; (3) in the S-records, the data bytes of exactly those statements (from the address of its listing line to the next listing line's) and the checksum of a record holding one. With them every run of the permitted corpus is equal. The date line is compared, not masked, wherever the official listing is in the repository: the assembler is given the time the listing printed (erratum T1 3).

### 3.6 assembler.md 8.3 settled

The probe lines of `assembler.md` 8.3 (in `build/ground-truth/probe-opparse/probe.X68`) were
assembled by the official EDIT68K: every result matches the 5.16.1 column
(`(TABLE,PC,D0.W)` -> `323B 00FE`, `TABLE(PC,D0.W)` -> `323B 00F2`, `(PC,D0.W)` -> `323B 00FE`,
`(PC,A1)` -> `343B 90FE`, `($C,A0)`, `(PTR,A0)`, `(SCORE,A0,D1.L)` -> "Invalid syntax",
`($1C,A0)` -> `3228 001C`, `BTST #3,(TABLE,PC,D0.W)` -> `083B 0003 00FC`,
`JMP (TABLE,PC,D1.W)` -> `4EFB 10FE`, `LEA (TABLE,PC,D0.L),A0` -> `41FB 08FE`). So the shipped
binary was built from the 5.16.1 OPPARSE.CPP. `assembler.md` was updated.

## 4. Reliability caveats for assembler ground truth

1. **Date line.** `Created On:` in every `.L68` carries the container's clock (UTC, en-US format
   `11/20/2026 9:20:04 PM`). Ignore it.
2. **Undefined-symbol object code** is uninitialised memory (3.5). Mask it.
3. **RichEdit deviations** (3.4): NUL bytes, UTF-8 BOM, bare CR at end of file, trailer without
   final newline. Flagged per file (`reliable`).
4. **Bare LF files**: Wine's control turns LF into CR LF. That real Windows RichEdit 1.0 does
   the same is plausible but **not verified** here (`editor-ui.md` 6.7 still says UNVERIFIED).
5. **Fonts are not involved** in assembly; listing columns depend only on the tab settings in
   `settings.dat`.
6. Wine itself was never compared with a real Windows run; the listing format, error texts and
   counts come from the official binary's own code, so only the RichEdit round trip and
   uninitialised memory can differ.
7. **Crashes of the official program** (stack overflow on a self-calling macro, access violation on
   very long lines) are recorded as failures, with their outputs (if any) kept.

## 5. Simulator (SIM68K.exe)

### 5.1 Recipe (a): self-reporting programs

`sim/dumplib.X68` (include it after the program code) provides:

| Routine | Input | Writes |
|---|---|---|
| `DMP_OPEN` | A1 = NUL-terminated file name | opens/truncates the file (TRAP #15 task 52) |
| `DMP_REGS` | - | `D0=... D7=... A0=... A7=... SR=xxxx` (values at the call; A7 = caller's SP) |
| `DMP_MEM` | A0 = start, D0.L = byte count | `aaaaaaaa: bb bb ...`, 16 bytes per line |
| `DMP_TEXT` | A1 = NUL-terminated string | the string as one line |
| `DMP_CLOSE` | - | `END-OF-DUMP`, then closes the file (task 56, flushes) |

All routines preserve every register and the condition codes; lines end in CR LF; the file name
is relative to the simulator's working directory (the driver starts it in the program's
folder). The A7 value is computed with `MOVEA.L SP,A0 / ADDQ.L #4,A0`, not `LEA 4(SP),A0`,
because Sim68K masks LEA results to 24 bits (`sim-core.md` table, LEA row): the first version
reported `A7=00000000` for SP = `$01000000`, which is the documented quirk seen in the real binary.

`scripts/sim_run.py selfreport prog.S68 --dump <file>` writes the shipped `sim68K.dat`
(optionally `--exceptions`, `--bitfield`), starts `SIM68K.exe Z:\...\prog.S68 /r [args]`, waits
for the simulator window (its title is the full `.S68` path), polls every 50 ms until the dump
file contains `END-OF-DUMP\r\n`, optionally takes a screenshot, and kills the simulator
(it never exits by itself after `SIMHALT`). Failure (time limit, or the process exiting) is
recorded with a screenshot and the list of open windows.

Proof (`run-sim-proofs.sh`; programs assembled by the official EDIT68K, 0 errors each):

| Program | Checks | Dump after | Result |
|---|---|---|---|
| `t1_arith` | ADDQ/SUB/ADD overflow and carry, MULS/MULU, DIVU/DIVS incl. quotient overflow, NEG/NEGX | 1.45 s | 5 register lines, e.g. `D0=80000000 ... SR=200A` after `ADDQ.L #1` on `$7FFFFFFF` |
| `t2_bcd_shift` | ABCD/SBCD/NBCD, ASL/ASR/LSR/ROL/ROR/ROXL, shift count 40 | 1.53 s | 3 register lines |
| `t3_memory` | (An)+, -(An), d(An,Xn), MOVEM, MOVEP, PEA, SWAP, EXG + 64-byte memory dump | 1.41 s | memory shows `$FF` fill and the MOVEP pattern `AA FF BB FF CC FF DD FF` |
| `t4_print` | TRAP #15 tasks 0, 3, 6, 13, 15, 20 | 1.18 s | registers; text in the I/O window |
| `t5_branches` | DBRA loop, Scc, DBEQ, BSET/BCHG/BTST/BCLR, EXT, TAS, LINK/UNLK | 1.31 s | 2 register lines |
| `t6_options` | divide by zero through vector 5 | 1.30 s | see 5.3 |
| `t8_bitfield` | `BFEXTU D0{0:4},D1` | 1.31 s | see 5.3 |
| `t7_draw` | graphics, see 5.4 | 1.41 s | |

A complete run takes about 7 s (Wine start about 1 s, program, kill and clean-up). Outputs:
`build/ground-truth/sim/selfreport/<label>/`.

### 5.2 Recipe (b): execution logs through the UI

`scripts/sim_run.py log prog.S68 --exec-log N [--out-log 1] --drive autotrace|step|run`:

1. delete old `<name>_RunLog.txt` / `<name>_OutLog.txt` (else a Replace/Append/Cancel dialog
   appears, `logU.cpp:113-128`);
2. write `sim68K.dat` with the raw byte N (1, 2 or 3) before `$exec log`, 0 or 1 before
   `$output log`, `10$auto trace interval` and `1$disable display`;
3. start `SIM68K.exe prog.S68` without `/r`;
4. for Auto Trace: Alt+O, A (Options > Auto Trace Options...), then Alt+O (OK) in the
   "Auto Trace Options" dialog - this copies the interval into the timer (`Optionsu.cpp:27`);
   the value read from `sim68K.dat` alone only sets the spin box (`SIM68Ku.cpp:2009-2011`);
5. Ctrl+F4 (Log Start); the log files appear;
6. F10 (Auto Trace), F7 per instruction (Trace Into), or F9 (Run);
7. wait for the message box titled `Information` ("Current Log Stopped.", `logU.cpp:217-223`),
   press Enter, then Alt+F4.

Proof on five programs (`l1`-`l5`: the bodies of `t1`-`t5` without the dump calls), log type 3,
Auto Trace: all five halted, logged 23, 29, 30, 28, 63 instructions and exited cleanly.
Also: `l1` with types 1 and 2; `l1` by Trace Into (its log equals the Auto Trace log byte for
byte apart from the date line); `l4` with Run and only the text-output log; `l4` with both logs.
Outputs: `build/ground-truth/sim/log/<label>/`, summary `build/ground-truth/sim/results.jsonl`.

Speed (measured over 30 s on `t1_arith`, which runs about 7,000 instructions):

| Drive | Setting | Instructions/s |
|---|---|---|
| Auto Trace | interval 200 ms (form default) | 5.0 |
| Auto Trace | interval 10 ms, display updated | about 5 (display update dominates) |
| Auto Trace | interval 10 ms, "Disable display update" | **61-72** |
| Trace Into (F7) | one key after each logged step + 80 ms | **about 5.5** |
| Trace Into | keys sent blind at 10 ms intervals | 4 of 40 keys registered |

Keys that arrive while the simulator is still updating after a step are dropped, so Trace
Into must be paced; the driver waits for the log file to grow (it is flushed per line) and
80 ms more. At 60-70 instructions/s a 10,000-instruction program needs about 2.5 minutes, so the
UI log recipe is for short programs; use recipe (a) for anything longer.

Log facts seen:
- Type 3 ("instruction, registers and memory") writes **empty** memory blocks: the memory range
  comes from the Log Output dialog's `MemFrom`/`MemBytes` fields (`logU.cpp:148-152`), which are
  empty by default and are not stored in `sim68K.dat`. Filling them needs the Log Output dialog
  (not automated).
- The output log (`EASy68K output log file: <date>` header) is written with Run as well as with
  tracing, as `ground-truth.md` says. The run-only case did not exit on Alt+F4 within 10 s and
  was killed; the log was complete.
- The register block and listing-line format match `ground-truth.md` section 4.

### 5.3 Simulator options without the UI

`t6_options` (divide by zero, vector 5 handler sets D7) and `t8_bitfield` (`BFEXTU`, illegal
instruction handler sets D7) were run three ways:

| Way | Exceptions (t6) | Bit field (t8) |
|---|---|---|
| neither | halts: "Divide by zero occurred at location 101a. Execution halted" in the message area, no dump | halts: "Illegal instruction found at location 101e. Execution halted" |
| command line `/e` resp. `/b` | handler ran: `D7=E5E5E5E5`, `D6=600D600D` | `D1=0000000A` (`$A5000000{0:4}`), `D7=0` |
| `sim68K.dat` `1$exceptions` resp. `1$bit field enabled` | same as `/e` | same as `/b` |

So both options can be set without touching the UI, by either means (`SIM68Ku.cpp:1226-1237`,
`1589-1591`, `1994-1996`). Note that the shipped `sim68K.dat` has bit field off, while the
shipped `settings.dat` lets the assembler accept bit-field instructions.

### 5.4 Graphics capture

`t7_draw` draws a filled rectangle, a filled ellipse, eleven lines and text, then reads seven
pixels back with task 83 and writes them to its dump. `sim_run.py --screenshot` captures the
`Sim68K I/O` window with ImageMagick `import`.

- **Pitfall found:** without a compositor, the parts of an X window covered by another window
  are never drawn. The simulator's main window overlaps the I/O window, so the first captures
  lost everything below y = 160 (kept as `build/ground-truth/sim/graphics/t7-without-repaint-window.png`).
  A task 94 repaint did not help. The driver now moves the main window off-screen and raises the
  I/O window before capturing.
- With that, the screenshot matches the simulator's own back buffer at all 7 probe points
  (rectangle `$0000FF`, ellipse `$00FF00`, three points on lines `$FF0000`, text background
  `$00FF00` = fill colour, background `$000000`).
- **Not a pixel-exact reference.** Wine implements GDI line, ellipse and text rasterisation
  itself, and text is drawn with Wine's own font files and renderer, not Microsoft's (the
  shipped `sim68K.dat` names `Fixedsys` as the output font). Shapes, colours and positions can be trusted to within a pixel; exact edge
  pixels of lines/ellipses and all text glyphs cannot. A pixel-exact graphics reference needs a
  real Windows run.

## 6. What does not work / not done

- Real Windows was never run, so none of the Wine-specific behaviour (3.4, 5.4) is checked
  against Windows itself.
- The Log Output dialog (memory range for log type 3, file names) is not automated.
- Sound, full screen (`/f`), printing, serial, network and mouse/keyboard input programs were
  not tried. Programs that wait for keyboard input will hang recipe (a) until its time limit.
- `diagnostics.x68` crashes the official editor; the 4000-character-line file leaves a
  repeating access-violation box (both recorded as failures).
- Execution logging is slow (5.2).

## 7. Timings

| Step | Time |
|---|---|
| Image build (first time) | about 2 minutes; image 2.37 GB |
| One small source through EDIT68K | 7 s (median 7.2 s) |
| Corpus, 488 files x 2 option sets, 8 containers | 18.6 minutes wall |
| CLI comparison (both sets) | under 1 minute |
| One self-report simulator run | about 7 s (dump after 1.2-1.7 s) |
| Execution log of a 25-instruction program | about 13 s, of which under 1 s tracing |
| Whole `run-sim-proofs.sh` | 5.6 minutes |
