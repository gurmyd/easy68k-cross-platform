#!/usr/bin/env node
// Release candidate, item 11 of ARCHITECTURE.md 6.9 ("Open verification items: every UNVERIFIED item
// of the specs is either confirmed, or listed in docs/DIFFERENCES.md under 'not yet confirmed against
// the original' with the port's chosen behaviour"). Owner: I3.
//
//   node tests/integration/rc/item-11-unverified.mjs [--all]
//
// What it does, in three steps, and prints the counts of each:
//
//  1. Finds every occurrence of the marker UNVERIFIED in docs/porting/*.md and docs/porting/errata/*.md
//     and accounts for each one: a definition of the marker, a line inside a spec's own list of open
//     items (the LISTS below), a line that such a list carries (CARRIED, matched by a piece of its
//     text), an erratum that restates or answers a list item (ERRATA), or settled where it stands
//     (SETTLED). An occurrence that is none of these is printed as NOT CARRIED: it is in no list.
//  2. Checks docs/DIFFERENCES.md: the heading "## 4. Not yet confirmed against the original" exists,
//     and which of the spec lists its text names (the `ref` of each list).
//  3. Walks the items of every list (ITEMS, transcribed from the specs; the script checks that each
//     list still has the items it expects) and sorts them into: confirmed (with the test or oracle
//     run that confirmed it; the evidence files are checked to exist), open and named by section 4,
//     open and in neither place. It also prints the confirmed items that section 4 still names as
//     not confirmed.
//
// Each open item must have a row of its own in part 4 (ROWS / ROW_OF: the subsection and the first
// cell) whose third cell states the port's chosen behaviour, and a confirmed item must have left
// part 4. The unconfirmed conformance programs (a53, b19; erratum T3 14) are open items too.
// EASY68K_RC_DIFFERENCES=<file> reads another copy (to show that the judge fails on a missing row).
//
// Exit code 0 only when the heading exists and no item and no occurrence is in neither place. The
// tables below are the I3 reading of 2026-11-22; when a spec, an erratum or DIFFERENCES.md changes,
// the script says which table entry no longer matches. --all prints every occurrence.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const porting = join(repo, 'docs', 'porting');
const all = process.argv.includes('--all');

// ---- the spec lists of open items and how DIFFERENCES.md section 4 names them ---------------------
/** heading: the start of the list's heading line; ref: what section 4 must say to name the list. */
const LISTS = {
  a12: { file: 'trap15-tasks-0-59.md', heading: '## 12. UNVERIFIED items', ref: /trap15-tasks-0-59\.md` section 12/ },
  b15: { file: 'trap15-tasks-60-up.md', heading: '## 15. Items that rest', ref: /trap15-tasks-60-up\.md` section 15/ },
  h12: { file: 'hardware.md', heading: '## 12. Claims that rest', ref: /hardware\.md` section 12/ },
  c13: { file: 'sim-core.md', heading: '## 13. Items marked UNVERIFIED', ref: /sim-core\.md` section 13/ },
  asm12: { file: 'assembler.md', heading: '## 12. Open questions', ref: /assembler\.md` section 12/ },
  ed22: { file: 'editor-ui.md', heading: '## 22. Open questions', ref: /editor-ui\.md` section 22 item 12/ },
  ui19: { file: 'sim-ui.md', heading: '## 19. Register of quirks', ref: /sim-ui\.md` section 19/ },
  bin22: { file: 'easybin.md', heading: '## 22. Open questions', ref: /easybin\.md/ },
};

// ---- step 1 tables ---------------------------------------------------------------------------------
/** Lines that define the marker or describe the convention. [file, piece of the line] */
const DEFINITIONS = [
  ['assembler.md', 'can differ on the real program and is marked **UNVERIFIED**'],
  ['assembler.md', '**UNVERIFIED** marks something'],
  ['easybin.md', 'established from the source or the shipped files is marked **UNVERIFIED**'],
  ['easybin.md', 'is UNVERIFIED unless stated'],
  ['editor-ui.md', 'could not be established from the source or the shipped files is marked **UNVERIFIED**'],
  ['editor-ui.md', 'marked UNVERIFIED.'],
  ['hardware.md', '**UNVERIFIED** - could not be determined'],
  ['sim-core.md', '**UNVERIFIED** marks a statement'],
  ['sim-ui.md', '**UNVERIFIED** - could not be determined'],
  ['trap15-tasks-0-59.md', 'Anything that could not be determined from the reference tree is marked'],
  ['trap15-tasks-60-up.md', '**UNVERIFIED** could not be determined'],
];
/** Inline occurrences outside a list that a list item carries. [file, piece, list item] */
const CARRIED = [
  ['assembler.md', 'number of open files / stack (UNVERIFIED on Windows)', 'asm12.10'],
  ['assembler.md', 'the shim or accept. UNVERIFIED on the real program', 'asm.9.2'], // INT_MIN / -1: a row of part 4
  ['assembler.md', 'classified as letter/space there is UNVERIFIED', 'asm12.8'],
  ['assembler.md', 'The real program very likely behaves the same; UNVERIFIED', 'asm12.4'],
  ['assembler.md', "What Borland's `fprintf` does with such a line is UNVERIFIED", 'asm12.2'],
  ['assembler.md', 'with no open structure', 'asm12.3'],
  ['assembler.md', 'runaway macro recursion', 'asm12.7'],
  ['assembler.md', 'when a macro line expands beyond 255 characters', 'asm12.6'],
  ['easybin.md', '`FormatMaskText` only pads', 'bin22.3a'],
  ['easybin.md', 'no glyph there (UNVERIFIED', 'bin22.3c'],
  ['easybin.md', '`OnClick` (VCL, UNVERIFIED)', 'bin22.3b'],
  ['easybin.md', 'a sign or `0x` prefix inside an S-record line is UNVERIFIED', 'bin22.3d'],
  ['editor-ui.md', '(VCL, UNVERIFIED against the running program)', 'ed22.12d'],
  ['editor-ui.md', 'UNVERIFIED which one acts when a text box has the focus', 'ed22.12e'],
  ['editor-ui.md', 'UNVERIFIED: the exact extension Windows appends', 'ed22.12c'],
  ['editor-ui.md', 'UNVERIFIED: how a file with bare LF', 'ed22.12a'],
  ['editor-ui.md', 'UNVERIFIED: Shift+Tab in this mode', 'ed22.12b'],
  ['editor-ui.md', 'that are now out of ascending order', 'ed.8.3'], // 8.3: a row of part 4
  ['editor-ui.md', "control's default tab stops apply (UNVERIFIED spacing)", 'ed.8.3'], // 8.3: a row of part 4
  ['editor-ui.md', '-1 (UNVERIFIED; the design-time combo', 'ed22.12f'],
  ['editor-ui.md', "UNVERIFIED against the original's RichEdit; erratum E6 4", 'ed.E6.4'], // E6 4: a row of part 4
  ['hardware.md', 'what the eight-digit mask does to a value above 99999999', 'h12.U1'],
  ['hardware.md', 'Recursion hazard - vector 8 in a faulting range', 'h12.U2'],
  ['hardware.md', 'Push-button release without press', 'hw.9.2.8'], // 9.2 item 8: a row of part 4
  ['official-oracle.md', '`editor-ui.md` 6.7 still says UNVERIFIED', 'ed22.12a'],
  ['sim-core.md', 'hardware faults such as access violations', 'c13.1'],
  ['sim-core.md', 'UNVERIFIED what the user sees in the original (a stack overflow', 'c13.1'],
  ['sim-core.md', 'TRAP #15 task 23 delay; nested message loop', 'c13.8'],
  ['sim-core.md', 'UNVERIFIED which of them can block', 'c13.10'],
  ['sim-core.md', 'UNVERIFIED whether any call is synchronous', 'c13.10'],
  ['sim-core.md', 'Cast used as an lvalue', 'c13.6'],
  ['sim-core.md', 'Long access at `$FFFFFE`', 'c13.2'],
  ['sim-core.md', 'with a negative index when D1.W', 'c13.5'],
  ['sim-core.md', '`move_bw_times[12][1]`', 'c13.4'],
  ['sim-core.md', "musl's `fclose(NULL)`", 'c13.7'],
  ['sim-core.md', 'depends on the Borland runtime and on stack contents (UNVERIFIED)', 'c13.3'],
  ['sim-core.md', 'Borland runtime behaviour, UNVERIFIED - CPU faults', 'c13.1'],
  ['sim-core.md', 'double-fault halt (UNVERIFIED what the original shows)', 'c13.1'],
  ['sim-core.md', "UNVERIFIED: the original's instructions per second", 'c13.8'],
  ['sim-ui.md', '**Quirk / UNVERIFIED:** `"%u"`', 'ui19.Q18'],
  ['sim-ui.md', '**Quirk (UNVERIFIED on the binary, follows directly from the source):**', 'ui19.Q9'],
  ['trap15-tasks-0-59.md', '`getXY` reads the *form* canvas pen', 'a.3.1'], // 3.1: a row of part 4
  ['trap15-tasks-0-59.md', 'the cell sizes Windows GDI returns for the other fonts', 'a12.1'],
  ['trap15-tasks-0-59.md', 'Keys that do **not** reach these handlers', 'a12.13'],
  ['trap15-tasks-0-59.md', 'undefined behaviour. **UNVERIFIED** what a given Windows build', 'a12.8'],
  ['trap15-tasks-0-59.md', 'Values outside the signed 32-bit range: **UNVERIFIED**', 'a12.6'],
  ['trap15-tasks-0-59.md', 'Values with a non-zero top byte are VCL/GDI special colours', 'a12.9'],
  ['trap15-tasks-0-59.md', '`Lucida Sans Typerwriter` (misspelt', 'a12.3'],
  ['trap15-tasks-0-59.md', 'a size of 0 lets Windows choose a default height', 'a12.3'],
  ['trap15-tasks-0-59.md', '15-255 have no case', 'a12.10'],
  ['trap15-tasks-0-59.md', 'so it **wraps**', 'a12.14'],
  ['trap15-tasks-0-59.md', 'Zero-length write (`D2 = 0`): UNVERIFIED', 'a12.14'],
  ['trap15-tasks-60-up.md', 'What Windows does with a request larger than the des', 'b15.V14'],
  ['trap15-tasks-60-up.md', '(The first version of this paragraph said', 'superseded'], // the old text, replaced by erratum SH2 2
  ['trap15-tasks-60-up.md', 'GDI converts each quarter of the ellipse to a cubic Bezier', 'b15.V12'],
  ['trap15-tasks-60-up.md', 'UNVERIFIED beyond the two samples I captured', 'b15.V11'],
  ['trap15-tasks-60-up.md', "The DirectMusic loader's search directory is set once", 'b15.V14'],
  ['trap15-tasks-60-up.md', 'exists but is not a valid WAVE', 'b15.V14'],
  ['trap15-tasks-60-up.md', "Loader cache. The source never disables the DirectMusic loader's object cache", 'b15.V6'],
  ['trap15-tasks-60-up.md', 'a second `connect` on a socket', 'b15.V14'],
  ['trap15-tasks-60-up.md', 'Any send error, including "would block"', 'b15.V14'],
  ['trap15-tasks-60-up.md', 'For TCP, Winsock does not fill in the address', 'b.12.2'], // 12.2: a row of part 4
  ['trap15-tasks-60-up.md', 'Closing when nothing was opened returns an error', 'b15.V14'],
  ['trap15-tasks-60-up.md', 'Needs Winsock started, i.e. after task 100 or 101', 'b15.V14'],
  ['trap15-tasks-60-up.md', 'Because `bound` is never cleared', 'b15.V14'],
  ['trap15-tasks-60-up.md', 'Report "no network" faithfully', 'b15.V14'],
];
/** Occurrences settled where they stand. [file, piece, how] */
const SETTLED = [
  [
    'sim-ui.md',
    'It can be automated only by synthesising user input',
    'settled by T3: tests/oracle/wine/sim/run-log.sh makes execution logs of the official program under Wine (6.2.2; golden/logs)',
  ],
  [
    'sim-ui.md',
    'An alternative that needs no logs and no synthetic input',
    'settled by T3: tests/oracle/wine/sim/run-report.sh runs self-reporting programs with /r (6.2.2; golden/*/result.bin)',
  ],
];
/** Errata lines with the marker: what they refer to (a list item, or null for a new open item). */
const ERRATA = [
  ['DV4.md', "original's answers for the cases §12 lists as UNVERIFIED", 'b15.V14'],
  ['E1.md', '**UNVERIFIED against the official binary.** No file of the corpus', 'e1.2'], // E1 2: confirmed (s21)
  ['E2.md', 'Silent about Real Tabs on (editor-ui §8.2: UNVERIFIED', 'ed22.12b'],
  ['E6.md', 'UNVERIFIED against the RichEdit', 'ed.E6.4'], // E6 4: word characters, a row of part 4
  ['E6.md', "UNVERIFIED what the original's `TEdit` shows", 'ed.E6.5'], // E6 5: a row of part 4
  ['FS1.md', 'The default extension rule (editor-ui §6.4, UNVERIFIED)', 'ed22.12c'],
  ['SH2.md', 'UNVERIFIED"; "Outline and interior are each combined once"', 'b15.V12'],
  ['SH2.md', 'UNVERIFIED beyond the two samples."', 'b15.V11'],
  ['SH3.md', 'UNVERIFIED - the port should use the low 24 bits', 'a12.9'],
  ['SH4.md', 'Still UNVERIFIED, as trap15-a §12 says', 'a12.13'],
  ['T1.md', 'engine README "UNVERIFIED against the real EASy68K.EXE', 'asm12.2'],
  ['T2.md', '## 3. trap15-tasks-0-59.md §12 (UNVERIFIED items 1-3): answers', 'a12.1'],
  ['W2.md', 'hardware §12 V1 marks the keystroke-level behaviour', 'h12.V1'],
];

// ---- step 3: the items of the lists ----------------------------------------------------------------
// status: 'open', or { confirmed: how, evidence: [paths that must exist] }, or 'decision' (not an
// UNVERIFIED item: a decision the architecture took). portDiffers: the confirmation shows the port
// differs from the original (then DIFFERENCES.md must say so: `recorded`).
const W = 'official program under Wine (6.2.2; the Borland run-time is linked into the .exe)';
const ITEMS = [
  // trap15-tasks-0-59.md section 12
  [
    'a12.1',
    'cell sizes for every font, size and style',
    {
      confirmed: 'GDI capture (erratum T2 3); check:text "text: raster faces 2132 of 2132"',
      evidence: ['app/public/fonts/metrics.json', 'tests/conformance/gdi/golden/text.pixpack.gz'],
    },
  ],
  [
    'a12.2',
    'bold changes the grid',
    { confirmed: 'GDI capture (erratum T2 3)', evidence: ['app/public/fonts/metrics.json'] },
  ],
  [
    'a12.3',
    'Lucida Sans Typerwriter, size 0',
    { confirmed: 'GDI capture (erratum T2 3)', evidence: ['app/public/fonts/metrics.json'] },
  ],
  ['a12.4', 'task 21 font after Rewind/Reload', 'open'],
  [
    'a12.5',
    'TextOut moves the pen, brush as background',
    {
      confirmed:
        'GDI capture, suite text (pens and cell backgrounds, 2132 of 2132); the SIM68K run is windows-confirm/gdi-text.X68, not run',
      evidence: ['tests/conformance/gdi/golden/text.pixpack.gz', 'tests/conformance/windows-confirm/gdi-text.X68'],
    },
  ],
  ['a12.6', 'atoi overflow (task 4/18)', 'open'],
  [
    'a12.7',
    'glyphs of control codes echoed by string input in Fixedsys',
    {
      confirmed:
        'GDI capture, suite text-control (machine-dependent; differs between Windows 11 and Windows Server 10.0.26100, other-windows.json)',
      evidence: ['tests/conformance/gdi/golden/text-control.pixpack.gz', 'tests/oracle/gdi-capture/other-windows.json'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part SH3 (bytes $01-$08, $0B, $0E-$1B)',
    },
  ],
  [
    'a12.8',
    'tasks 0/1 with negative D1.W',
    {
      confirmed: `${W}: golden trap15-a/a55`,
      evidence: ['tests/conformance/sim/trap15-a/a55-task0-negative-count-first.X68'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T3 "Tasks 0 and 1 with a negative count"',
    },
  ],
  [
    'a12.9',
    'task 21 colour with a non-zero top byte',
    {
      confirmed: 'GDI capture, text colour forms (cases.ts TEXT_COLOUR_FORMS, erratum SH3 17)',
      evidence: ['tests/conformance/gdi/golden/text.pixpack.gz'],
    },
  ],
  ['a12.10', 'task 41 baud index 15-255', 'open'],
  [
    'a12.11',
    'one host file in two slots',
    {
      confirmed: `${W}, golden trap15-a/a56 (Wine's file system below it)`,
      evidence: ['tests/conformance/sim/trap15-a/a56-files-same-file-twice.X68'],
    },
  ],
  ['a12.12', 'real duration of task 23', 'open'],
  ['a12.13', 'keys the VCL consumes (Tab, shortcuts)', 'open'],
  [
    'a12.14',
    'task 54 with D2 = 0, task 53 wrap',
    {
      confirmed: `${W}: goldens trap15-a/a31, a32`,
      evidence: [
        'tests/conformance/sim/trap15-a/a31-files-zero-length.X68',
        'tests/conformance/sim/trap15-a/a32-files-bounds.X68',
      ],
    },
  ],
  ['a12.15', 'fclose(NULL) in task 59', 'open'],
  ['a12.16', 'what OnActivate covers', 'open'],
  // trap15-tasks-60-up.md section 15, the open table (V1-V3, V5, V7-V9 are "established")
  ['b15.V4', 'flood fill versus non-Copy modes', 'open'],
  ['b15.V6', 'DirectX looping, loader cache', 'open'],
  [
    'b15.V8',
    'modes 18-255 (b06 differs from its Wine golden only)',
    {
      confirmed:
        "the GDI calls of the original measured on Windows 11 (golden/modes.json, erratum SH1 17); b06's golden is Wine's SetROP2, an accepted difference (known-differences.json)",
      evidence: ['tests/conformance/gdi/golden/modes.json', 'tests/conformance/sim/known-differences.json'],
    },
  ],
  ['b15.V10', 'Tab never reaching OnKeyDown; mouse capture', 'open'],
  [
    'b15.V11',
    'pixels of diagonal wide lines and wide-pen ellipses',
    {
      confirmed:
        'GDI capture: widelines 2000 of 2000, nibs 254 of 254; wide-pen ellipses 496 of 500 (docs/porting/gdi-deviations.md section 2)',
      evidence: ['docs/porting/gdi-deviations.md', 'tests/conformance/gdi/golden/ellipses-wide.pixpack.gz'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part SH2 (docs/porting/gdi-deviations.md section 2)',
    },
  ],
  [
    'b15.V12',
    'GDI ellipse flattening',
    {
      confirmed: 'GDI capture: 8192 of 8192 and 3000 of 3000 ellipses every pixel equal (6.5.2)',
      evidence: [
        'tests/conformance/gdi/golden/ellipses.pixpack.gz',
        'tests/conformance/gdi/golden/ellipses-large.pixpack.gz',
      ],
    },
  ],
  [
    'b15.V13',
    'control characters in task 95 on other Windows versions',
    {
      confirmed:
        'measured on Windows 11 and Windows Server 10.0.26100: they differ (other-windows.json); machine-dependent',
      evidence: ['tests/oracle/gdi-capture/other-windows.json'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part SH3',
    },
  ],
  ['b15.V14', 'PlaySound non-WAVE, over-large surface, Winsock results, DirectMusic directory', 'open'],
  // hardware.md section 12
  ...['V1', 'V3', 'V6', 'V9', 'V10', 'V11', 'V12', 'U1', 'U2', 'U3', 'U4', 'U5'].map((v) => [
    `h12.${v}`,
    `hardware ${v}`,
    'open',
  ]),
  // sim-core.md section 13
  ['c13.1', 'Borland catch(...) and CPU faults', 'open'],
  ['c13.2', 'bytes after the 16 MB block', 'open'],
  [
    'c13.3',
    'fprintf of listing lines with %',
    {
      confirmed: `${W}: golden logs/l14-percent-in-listing`,
      evidence: ['tests/conformance/sim/known-differences.json'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T3 "Text in execution logs with %"',
    },
  ],
  ['c13.4', 'cycles of MOVEA with an illegal source mode', 'open'],
  [
    'c13.5',
    'tasks 0/1 with negative D1.W',
    {
      confirmed: `${W}: golden trap15-a/a55`,
      evidence: ['tests/conformance/sim/trap15-a/a55-task0-negative-count-first.X68'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T3',
    },
  ],
  [
    'c13.6',
    'the Borland lvalue cast in BTST/BSET/BCLR/BCHG',
    { confirmed: `${W}: golden instructions/g-btst`, evidence: ['tests/conformance/sim/instructions/g-btst.X68'] },
  ],
  ['c13.7', 'fclose(NULL)', 'open'],
  ['c13.8', 'Sleep(10) and the original speed', 'open'],
  ['c13.9', 'shortcuts of disabled menu items', 'open'],
  ['c13.10', 'which serial, network and sound calls block', 'open'],
  [
    'c13.11',
    'the example log line of 8.2',
    { confirmed: `${W}: execution-log goldens (golden/logs)`, evidence: ['tests/conformance/sim/golden/logs'] },
  ],
  ['c13.12', 'AnsiString compare of hex strings', 'open'],
  // assembler.md section 12
  [
    'asm12.1',
    'the opParse regressions in the binary',
    {
      confirmed: `${W.replace('official program', 'official EDIT68K.exe')}: golden checklist/quirk-03`,
      evidence: ['tests/conformance/asm/golden/checklist/quirk-03-5-16-1-regressions-in-opparse-cpp-d-an-and-d-pc'],
    },
  ],
  [
    'asm12.2',
    'Borland fprintf with %',
    {
      confirmed: 'official EDIT68K.exe under Wine: goldens checklist/macro-09, dir-16 (erratum T1 10)',
      evidence: [
        'tests/conformance/asm/golden/checklist/macro-09-binary-constants-and-a-valid-printf-conversion-i',
        'tests/conformance/asm/golden/checklist/dir-16-fail-with-and-without-text-fail-w-fail-with',
      ],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T1 (macro-09; tests/conformance/asm/known-differences.json)',
    },
  ],
  [
    'asm12.3',
    'structured terminator with nothing open',
    {
      confirmed: 'official EDIT68K.exe under Wine: golden checklist/stc-03',
      evidence: ['tests/conformance/asm/golden/checklist/stc-03-missing-then-do-unknown-condition-mismatched-and'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T1 (stc-03; tests/conformance/asm/known-differences.json)',
    },
  ],
  ['asm12.4', 'BFINS followed by a label: phase error', 'open'],
  [
    'asm12.5',
    'bytes for an undefined symbol (decided: zero)',
    {
      confirmed: 'official EDIT68K.exe under Wine: 56 runs equal only after masking undefined symbols (erratum T1 6)',
      evidence: ['tests/conformance/asm/golden/REPORT.md'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part E5 (line "statements with an undefined symbol")',
    },
  ],
  [
    'asm12.6',
    'macro expansion longer than 255 characters',
    {
      confirmed: 'official EDIT68K.exe under Wine crashes (stack overflow; golden/REPORT.md, macro-10)',
      evidence: ['tests/conformance/asm/golden/REPORT.md'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T1 (macro-10, no official result) and engine/asm/PATCHES.md P8',
    },
  ],
  [
    'asm12.7',
    'macro recursion: stack overflow or message',
    {
      confirmed: 'official EDIT68K.exe under Wine crashes (stack overflow; golden/REPORT.md, macro-13)',
      evidence: ['tests/conformance/asm/golden/REPORT.md'],
      portDiffers: true,
      recorded: 'DIFFERENCES.md part T1 (macro-13, no official result) and engine/asm/PATCHES.md "Macro nesting"',
    },
  ],
  ['asm12.8', 'Borland ctype for bytes >= $80', 'open'],
  ['asm12.9', 'line ends of .L68/.S68', 'decision'],
  ['asm12.10', 'maximum INCLUDE nesting on Windows', 'open'],
  ['asm12.11', 'listing line 2 and the date format', 'decision'],
  [
    'asm12.12',
    'local label of 33 characters',
    {
      confirmed: 'official EDIT68K.exe under Wine: golden checklist/line-07',
      evidence: ['tests/conformance/asm/golden/checklist/line-07-local-label-whose-mangled-name-reaches-33-charac'],
    },
  ],
  // editor-ui.md section 22 item 12
  ['ed22.12a', 'bare-LF files (RichEdit spot check, 6.8)', 'open'],
  ['ed22.12b', 'Shift+Tab with Real Tabs on', 'open'],
  ['ed22.12c', 'default extension appended by Save As', 'open'],
  ['ed22.12d', 'toolbar hint texts with shortcuts', 'open'],
  ['ed22.12e', 'default button of the Replace dialog', 'open'],
  ['ed22.12f', 'default preset index', 'open'],
  // sim-ui.md section 19
  ['ui19.Q9', 'Pause during Auto Trace', 'open'],
  ['ui19.Q18', 'cycle display 32-bit format', 'open'],
  ['ui19.Q26', 'MessageBox with mbOK', 'open'],
  // easybin.md section 22 item 3
  ['bin22.3a', 'eight-digit text in a six-digit mask edit', 'open'],
  ['bin22.3b', 'OnClick when New sets ItemIndex', 'open'],
  ['bin22.3c', 'the glyph of $7F', 'open'],
  ['bin22.3d', 'Borland sscanf on a sign or 0x in an S-record line', 'open'],
  // statements in the text of a spec or an erratum that no spec list carries (rows of part 4)
  ['asm.9.2', 'INT_MIN / -1 in an expression (assembler 9.2)', 'open'],
  ['ed.8.3', 'tab stops out of order, spacing beyond the 20th (editor-ui 8.3)', 'open'],
  ['ed.E6.4', 'word characters of Match whole word only (editor-ui 14.2, erratum E6 4)', 'open'],
  ['ed.E6.5', 'the Find box and a line break (erratum E6 5)', 'open'],
  ['hw.9.2.8', 'a push button whose release never arrives (hardware 9.2 item 8)', 'open'],
  ['a.3.1', 'which pen task 96 reads after text output (trap15-a 3.1)', 'open'],
  ['b.12.2', 'task 107 over TCP: the address at (A2) (trap15-b 12.2)', 'open'],
  [
    'e1.2',
    'Error in LoadFile() for a trailer that is too short (erratum E1 2)',
    {
      confirmed: 'official EDIT68K.exe under Wine: run richedit/s21 shows the Information box (errata T1 16, 17)',
      evidence: ['tests/conformance/asm/golden/REPORT.md'],
    },
  ],
  // conformance programs whose golden is unconfirmed (6.9 item 2 as corrected, erratum T3 14): open
  // items of item 11, listed in part 4
  ['prog.a53', 'trap15-a/a53-files-past-end-then-read (golden seen only under Wine)', 'open'],
  ['prog.b19', 'trap15-b/b19-net-send-uninitialised (golden seen only under Wine)', 'open'],
];

/**
 * The row of part 4 of docs/DIFFERENCES.md that lists an open item: the start of its subsection's
 * heading and the item's first cell (a row may hold several items; one item may have several rows).
 */
const ROW_OF = {
  a12: (n) => ['TRAP #15 tasks 0 to 59', n],
  b15: (n) => ['TRAP #15 tasks 60 and up', n],
  h12: (n) => ['The hardware window', n],
  c13: (n) => ['The simulator core', n],
  asm12: (n) => ['The assembler', n],
  ui19: (n) => ['The simulator window', n],
};
const ROWS = {
  'ed22.12a': ['The editor', 'Bare LF (§6.7)'],
  'ed22.12b': ['The editor', 'Shift+Tab with Real Tabs on (§8.2)'],
  'ed22.12c': ['The editor', 'Default extension (§6.4)'],
  'ed22.12d': ['The editor', 'Toolbar hints (§3)'],
  'ed22.12e': ['The editor', 'Replace dialog (§13)'],
  'ed22.12f': ['The editor', 'Default preset (§17, line 57 of `settings.dat`)'],
  'bin22.3a': ['EASyBIN', '§4.1'],
  'bin22.3b': ['EASyBIN', '§9'],
  'bin22.3c': ['EASyBIN', '§5.3'],
  'bin22.3d': ['EASyBIN', '§10.3'],
  'asm.9.2': ['The assembler', '§9.2 (in the text)'],
  'ed.8.3': ['The editor', 'Tab stops (§8.3, in the text)'],
  'ed.E6.4': ['The editor', 'Match whole word only (§14.2, erratum E6 4)'],
  'ed.E6.5': ['The editor', 'The Find box and a line break (erratum E6 5)'],
  'hw.9.2.8': ['The hardware window', '§9.2 item 8 (in the text)'],
  'a.3.1': ['TRAP #15 tasks 0 to 59', '§3.1 (in the text)'],
  'b.12.2': ['TRAP #15 tasks 60 and up', '§12.2 (in the text)'],
  'prog.a53': [
    'Conformance programs whose official result was seen only under Wine',
    '`trap15-a/a53-files-past-end-then-read`',
  ],
  'prog.b19': [
    'Conformance programs whose official result was seen only under Wine',
    '`trap15-b/b19-net-send-uninitialised`',
  ],
};
const rowOf = (id) => {
  if (ROWS[id]) return ROWS[id];
  const [list, n] = id.split('.');
  return ROW_OF[list] ? ROW_OF[list](n) : null;
};

// ---- run -------------------------------------------------------------------------------------------
const problems = [];
const read = (f) => readFileSync(f, 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ');

// step 2: DIFFERENCES.md
const differences = read(process.env.EASY68K_RC_DIFFERENCES ?? join(repo, 'docs', 'DIFFERENCES.md'));
const HEADING = '## 4. Not yet confirmed against the original';
const hAt = differences.indexOf(`\n${HEADING}\n`);
let section4 = '';
if (hAt < 0) problems.push(`docs/DIFFERENCES.md has no heading "${HEADING}"`);
else {
  const rest = differences.slice(hAt + HEADING.length + 2);
  section4 = norm(rest.slice(0, rest.search(/\n## /) >= 0 ? rest.search(/\n## /) : undefined));
}
const named = Object.fromEntries(Object.entries(LISTS).map(([id, l]) => [id, l.ref.test(section4)]));
/** The table rows of part 4, per subsection: cells "Item | Not confirmed | What the port does | How". */
const part4Rows = [];
if (hAt >= 0) {
  const rest = differences.slice(hAt + HEADING.length + 2);
  const end = rest.search(/\n## /);
  let sub = '';
  for (const line of (end >= 0 ? rest.slice(0, end) : rest).split(/\r?\n/)) {
    if (line.startsWith('### ')) sub = line.slice(4);
    else if (
      line.startsWith('| ') &&
      !/^\|[-| :]+\|\s*$/.test(line) &&
      !line.startsWith('| Item |') &&
      !line.startsWith('| Program |')
    )
      part4Rows.push({
        section: sub,
        cells: line
          .slice(2, -2)
          .split(' | ')
          .map((c) => c.trim()),
      });
  }
}
const rowsFor = (id) => {
  const where = rowOf(id);
  return where ? part4Rows.filter((r) => r.section.startsWith(where[0]) && r.cells[0] === where[1]) : [];
};

// step 1: occurrences
const files = [
  ...readdirSync(porting)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, path: join(porting, f), erratum: false })),
  ...readdirSync(join(porting, 'errata'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ name: f, path: join(porting, 'errata', f), erratum: true })),
];
const used = new Set();
const occ = [];
for (const f of files) {
  const lines = read(f.path).split(/\r?\n/);
  let heading = '';
  const list = Object.entries(LISTS).find(([, l]) => l.file === f.name && !f.erratum);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,4} /.test(line)) heading = line;
    if (!line.includes('UNVERIFIED')) continue;
    const at = `${f.erratum ? 'errata/' : ''}${f.name}:${i + 1}`;
    const find = (table) => table.findIndex(([file, piece]) => file === f.name && line.includes(piece));
    let kind;
    let to = null;
    let k;
    if (!f.erratum && (k = find(DEFINITIONS)) >= 0) {
      kind = 'definition';
      used.add(`D${k}`);
    } else if (list && heading.startsWith(list[1].heading)) {
      kind = 'list';
      to = list[0];
    } else if (!f.erratum && (k = find(SETTLED)) >= 0) {
      kind = 'settled';
      to = SETTLED[k][2];
      used.add(`S${k}`);
    } else if (!f.erratum && (k = find(CARRIED)) >= 0) {
      used.add(`C${k}`);
      to = CARRIED[k][2];
      kind = to === null ? 'NOT CARRIED' : to === 'superseded' ? 'superseded' : 'carried';
    } else if (f.erratum && (k = find(ERRATA)) >= 0) {
      used.add(`E${k}`);
      to = ERRATA[k][2];
      kind = to === null ? 'NOT CARRIED' : 'erratum';
    } else kind = 'UNACCOUNTED';
    occ.push({ at, heading: heading.slice(0, 80), kind, to, text: line.trim().slice(0, 160) });
  }
}
for (const [tag, table] of [
  ['D', DEFINITIONS],
  ['S', SETTLED],
  ['C', CARRIED],
  ['E', ERRATA],
])
  table.forEach((row, k) => {
    if (!used.has(`${tag}${k}`)) problems.push(`table entry no longer found in the documents: ${row[0]}: "${row[1]}"`);
  });

// the lists still have the items the table expects
const listItemCount = (id) => {
  const l = LISTS[id];
  const text = read(join(porting, l.file));
  const start = text.indexOf(`\n${l.heading}`);
  const rest = text.slice(start + 1);
  const end = rest.slice(3).search(/\n## /);
  return end >= 0 ? rest.slice(0, end + 3) : rest;
};
for (const [id, n] of [
  ['a12', 16],
  ['c13', 12],
  ['asm12', 12],
]) {
  const got = (listItemCount(id).match(/^\d+\. /gm) ?? []).length;
  if (got !== n) problems.push(`${LISTS[id].file} ${LISTS[id].heading}: ${got} numbered items, the table expects ${n}`);
}
for (const id of ['V4', 'V6', 'V10', 'V11', 'V12', 'V13', 'V14'])
  if (!new RegExp(`^\\| ${id} \\|`, 'm').test(listItemCount('b15'))) problems.push(`trap15-b §15: ${id} missing`);
for (const id of ['V1', 'V3', 'V6', 'V9', 'V10', 'V11', 'V12'])
  if (!new RegExp(`^\\| ${id} \\|[^\\n]*UNVERIFIED`, 'm').test(listItemCount('h12')))
    problems.push(`hardware §12: ${id} no longer UNVERIFIED`);
for (const id of ['Q9', 'Q18', 'Q26'])
  if (!new RegExp(`^\\| ${id} \\|[^\\n]*UNVERIFIED`, 'm').test(listItemCount('ui19')))
    problems.push(`sim-ui §19: ${id} no longer UNVERIFIED`);

// step 3: items
const out = { confirmed: [], confirmedStillNamed: [], openNamed: [], neither: [], decision: [] };
for (const [id, what, status] of ITEMS) {
  const list = id.split('.')[0];
  const isNamed = named[list];
  if (status === 'decision') out.decision.push(`${id} ${what}`);
  else if (status === 'open') {
    // Listed: a row of its own in part 4 whose third cell gives the port's chosen behaviour.
    const rows = rowsFor(id);
    const withBehaviour = rows.filter((r) => (r.cells[2] ?? '').length > 0);
    if (withBehaviour.length > 0) out.openNamed.push(`${id} ${what}`);
    else
      out.neither.push(
        `${id} ${what}${rows.length > 0 ? ' (its row gives no chosen behaviour)' : ' (no row of its own in part 4)'}`,
      );
    void isNamed;
  } else {
    for (const e of status.evidence)
      if (!existsSync(join(repo, e))) problems.push(`${id}: evidence ${e} does not exist`);
    const line = `${id} ${what}: ${status.confirmed}${status.portDiffers ? `; the port differs, recorded in ${status.recorded ?? 'NOTHING'}` : ''}`;
    out.confirmed.push(line);
    if (rowsFor(id).length > 0) out.confirmedStillNamed.push(`${id} ${what}`);
    if (status.portDiffers && !status.recorded)
      problems.push(`${id}: confirmed, the port differs, and no document records it`);
  }
}
const newItems = occ.filter((o) => o.kind === 'NOT CARRIED' || o.kind === 'UNACCOUNTED');

// ---- print -----------------------------------------------------------------------------------------
const count = (k) => occ.filter((o) => o.kind === k).length;
console.log(`item 11: UNVERIFIED in docs/porting and docs/porting/errata: ${occ.length} occurrences`);
console.log(
  `  ${count('definition')} define the marker, ${count('list')} inside a spec's list of open items, ${count('carried')} carried by a list item, ${count('erratum')} errata about a list item, ${count('settled')} settled where they stand, ${count('superseded')} superseded text, ${count('NOT CARRIED')} in no list, ${count('UNACCOUNTED')} unaccounted`,
);
if (all) for (const o of occ) console.log(`    ${o.kind.padEnd(11)} ${o.at} ${o.to ?? ''} | ${o.text}`);
console.log(`docs/DIFFERENCES.md: heading "${HEADING}" ${hAt >= 0 ? 'present' : 'MISSING'}`);
for (const [id, l] of Object.entries(LISTS))
  console.log(`  section 4 ${named[id] ? 'names   ' : 'does NOT name'} ${l.file} ${l.heading.replace(/^## /, '§')}`);
console.log(
  `  section 4 has ${part4Rows.length} table rows; each open item needs a row of its own with the port's chosen behaviour`,
);
console.log(`list items: ${ITEMS.length} (${out.decision.length} decisions, not UNVERIFIED)`);
console.log(`  confirmed: ${out.confirmed.length}`);
for (const l of out.confirmed) console.log(`    ${l}`);
console.log(`  confirmed but still a row of section 4: ${out.confirmedStillNamed.length}`);
for (const l of out.confirmedStillNamed) console.log(`    ${l}`);
console.log(`  open and a row of section 4 with the chosen behaviour: ${out.openNamed.length}`);
for (const l of out.openNamed) console.log(`    ${l}`);
console.log(`  open and in NEITHER place: ${out.neither.length}`);
for (const l of out.neither) console.log(`    ${l}`);
console.log(
  `occurrences in no list (so in neither place unless DIFFERENCES.md names them elsewhere): ${newItems.length}`,
);
for (const o of newItems) console.log(`    ${o.at} [${o.heading}] ${o.text}`);
if (problems.length) console.log(`problems with the tables:\n${problems.map((p) => `  - ${p}`).join('\n')}`);

const holds =
  hAt >= 0 &&
  out.neither.length === 0 &&
  out.confirmedStillNamed.length === 0 &&
  newItems.length === 0 &&
  problems.length === 0;
console.log(holds ? 'item 11 holds.' : 'item 11 does NOT hold.');
process.exit(holds ? 0 : 1);
