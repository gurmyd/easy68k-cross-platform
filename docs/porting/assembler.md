# EASy68K v5.16.1 assembler engine - behaviour specification for the port

Scope: the assembler engine of `Edit68Kv5.16.1` (ASSEMBLE.CPP, BUILD.CPP, CODEGEN.CPP, DIRECTIV.CPP,
ERROR.CPP, EVAL.CPP, GLOBALS.CPP, INSTLOOK.CPP, INSTTABL.CPP, LISTING.CPP, MACRO.CPP, MOVEM.CPP,
OBJECT.CPP, OPPARSE.CPP, STRUCTURED.CPP, SYMBOL.CPP, BINFILE.CPP, asm.h, proto.h) and the GUI code
that drives it. Instruction encodings are deliberately not re-documented: the C++ is reused as is.

## 0. Conventions and how the claims were checked

- File references without a directory are relative to
  `c:\easy64k\reference\src-edit68k\Edit68Kv5.16.1\`. `cli/X` means
  `c:\easy64k\reference\easy68k-asm-cli\ASM68Kv5.15.4\X`. `sim/X` means
  `c:\easy64k\reference\src-sim68k\Sim68Kv5.16.1\X`. `help/X` means
  `c:\easy64k\reference\src-help\EASy68K_Helpv5.16.1\X`.
- Columns in listing lines are given 0-based unless "1-based" is written.
- "Pass 1" is `pass == 0` / `pass2 == false`; "pass 2" is `pass == 1` / `pass2 == true`.
- **[EXP]** marks a statement that was additionally confirmed by experiment: the 16 engine files of
  v5.16.1 (everything except BINFILE.CPP) were compiled unmodified with Emscripten 7.0.0
  (`em++ -O0 -std=gnu++98 -fno-operator-names -fexceptions`) against a throw-away VCL stand-in
  (about 100 lines: `AnsiString`, stubs for `Main`, `Options`, `AssemblerBox`, `Application`,
  `stricmp`/`itoa` etc.) and a driver that imitates `TMain::mnuDoAssemblerClick`, then run under node on
  small probe programs. The only source edits were: strip the trailing Ctrl-Z byte, and
  `extern int lineNumL68;` in ERROR.CPP:40. This is **not** the Borland binary. Anything that depends on
  uninitialised memory, on Borland's C runtime, or on access violations being caught by `catch(...)`
  can differ on the real program and is marked **UNVERIFIED**.
- **[ORA]** marks a statement that was additionally confirmed on the native oracle of `toolchain.md`
  (`c:\easy64k\build\oracle\asm-cli-5.15.4\bin\asy68k.exe`: the CLI port's 5.15.4 engine built with MSVC,
  Windows text mode) in a code path that section 8 shows to be textually identical in 5.16.1. The
  [ORA] statements about the two 5.16.1 `opParse` changes were run on the same build with OPPARSE.CPP
  replaced by the 5.16.1 file. Like [EXP] this is not the Borland binary.
- **UNVERIFIED** marks something that could not be determined from the sources or the experiment.
- Sibling specs referred to: `toolchain.md` (Emscripten flags, native CLI oracle, text-mode emulation),
  `editor-ui.md` (GUI around the assembler), `sim-ui.md` (how the simulator shows the listing).

The single most important facts are collected in section 9 (hazards) and section 10 (recommendation).

---

## 1. Entry points and call graph

### 1.1 How the editor starts an assembly

`TMain::mnuDoAssemblerClick` (mainS.cpp:342-392; menu "Project > Assemble Source...", shortcut 120 = F9,
mainS.dfm:357-361; also the toolbar button, mainS.cpp:544-547) is the only caller of `assembleFile`.
The menu item and button are enabled as long as at least one source window is open (textS.cpp:679,
696, 849); the handler's own "is this a source file" test is commented out (mainS.cpp:348, 385-391),
so it assembles the text of whichever window is **active**, a listing window included. It does, in
this order:

1. If `Options->bSave && Active->SourceText->Modified`: `Main->mnuSaveClick` (auto-save) (mainS.cpp:351-354).
2. `Active->Messages->Items->Clear()` - empties the message list of the active editor window (mainS.cpp:355).
3. Copies the eight option check boxes into the assembler globals (mainS.cpp:360-367):

   ```cpp
   listFlag = Options->chkGenList->Checked;
   objFlag  = Options->chkGenSRec->Checked;
   CEXflag  = Options->chkConstantsEx->Checked;
   BITflag  = Options->chkBitfield->Checked;
   CREflag  = Options->chkCrossRef->Checked;
   MEXflag  = Options->chkMacEx->Checked;
   SEXflag  = Options->chkStrucEx->Checked;
   WARflag  = Options->chkShowWarnings->Checked;
   ```
4. `SetCurrentDir(ExtractFilePath(Active->Project.CurrentFile))` - the process working directory
   becomes the folder of the source file (mainS.cpp:370). Relative INCLUDE / INCBIN names are resolved
   against it by plain `fopen`.
5. Builds two temp names in that folder: `EASy68Ks.tmp` (source copy) and `EASy68Km.tmp` (macro store)
   (mainS.cpp:371-372).
6. `Active->SourceText->Lines->SaveToFile(sourceFile)` - the **editor buffer**, not the file on disk, is
   what gets assembled (mainS.cpp:373). `TStrings::SaveToFile` writes every line followed by CR LF.
   The font/tab footer lines (`*~Font name~...`) are not in the buffer: `LoadFile` removes them
   (textS.cpp:139-173).
7. `assembleFile(sourceFile.c_str(), tempFile.c_str(), Active->Project.CurrentFile)` (mainS.cpp:374).
8. `DeleteFile(sourceFile); DeleteFile(tempFile);` (mainS.cpp:375-376).
9. `AssemblerBox->ShowModal()` - the "Assembler Status" dialog (mainS.cpp:377).

A `catch(...)` around 3-9 shows "File Access Error.  Please verify that you have write permission to the
folder where the selected file is located." (mainS.cpp:379-384).

For an unsaved new window `Project.CurrentFile` is the relative name `untitledN.x68`
(textS.cpp:835-836), so `ExtractFilePath` is empty, the working directory is not changed, and the
outputs are `untitledN.L68` / `untitledN.S68` in whatever the current directory is.

What the caller must have in place before `assembleFile` (a replacement driver needs all of these):

| Item | Where consumed | Notes |
|---|---|---|
| `listFlag, objFlag, CEXflag, BITflag, CREflag, MEXflag, SEXflag, WARflag` (GLOBALS.CPP:59-66) | everywhere | section 2 |
| `Options->chkGenList->Checked` | ASSEMBLE.CPP:177 | decides whether the .L68 is created; equal to `listFlag` at entry |
| `Main->ActiveMDIChild->Project.TabType`, `.TabSize` | LISTING.CPP:128-143 | tab expansion of every listed source line |
| `Main->ActiveMDIChild->Messages` (list view) | ERROR.CPP:275-288, ASSEMBLE.CPP:210-213 | receives one row per reported message |
| `Main->MDIChildCount`, `Main->MDIChildren[i]`, `Main->OpenFile` | DIRECTIV.CPP:711-719, ERROR.CPP:246-272 | include-file windows |
| `AssemblerBox->lblStatus`, `lblStatus2`, `cmdExecute` | ASSEMBLE.CPP:215-221 | counts and Execute button |
| current directory = source folder | DIRECTIV.CPP:698, 813 | include / incbin path resolution |
| source text in a file readable in C text mode, every line ending in `\n` | ASSEMBLE.CPP:170, 319 | section 9.4 |

### 1.2 `int assembleFile(char fileName[], char tempName[], AnsiString workName)` (ASSEMBLE.CPP:157-230)

```
tmpFile = fopen(tempName, "w+")      fail -> MessageBox("Error creating temp file.","Error"), return SEVERE (0x400)
inFile  = fopen(fileName, "r")       fail -> MessageBox("Error reading source file.","Error"), return SEVERE (tmpFile stays open)
if (Options->chkGenList->Checked)    initList(ChangeFileExt(workName, ".L68"))
if (objFlag)                         if (initObj(ChangeFileExt(workName, ".S68")) != NORMAL) objFlag = false;
processFile();                       // both passes
fclose(inFile); fclose(tmpFile);
finishList();                        // counts, symbol table, start address, close .L68
if (objFlag) finishObj();            // flush, memory map S0 records, S8 record, close .S68
clearSymbols();                      // free the symbol table
pop stcStack, dbStack, forStack until empty
if (warningCount == 0 && errorCount == 0) Active->Messages->Height = 7;
AssemblerBox->lblStatus->Caption  = IntToStr(warningCount);
AssemblerBox->lblStatus2->Caption = IntToStr(errorCount);
if (errorCount == 0 && errorCount == 0) AssemblerBox->cmdExecute->Enabled = true;   // sic: tests errorCount twice
return NORMAL (0);                   // catch(...) -> printError(NULL, EXCEPTION, 0); return NULL (also 0)
```

- The return value cannot be used to tell success from failure: 0 for a normal run and for a caught
  exception, `SEVERE` (0x400) only when a temp/source file could not be opened. Success must be read
  from `errorCount`.
- Output names: `ChangeFileExt(workName, ext)` replaces the last extension of the **editor's** file name
  (`workName`), so `C:\x\prog.X68` gives `C:\x\prog.L68` and `C:\x\prog.S68` (extension always upper
  case as written in the source); a name without extension gets the extension appended.
- Warnings do not block Execute: the button is enabled whenever `errorCount == 0`.

### 1.3 `int processFile()` (ASSEMBLE.CPP:278-352) - the two passes

Reset once per assembly (286-295): `offsetMode=false; showEqual=false; pass2=false; macroNestLevel=0;
noENDM=false; includedFileError=false; mapROM=mapRead=mapProtected=mapInvalid=false`.

Then `for (pass = 0; pass < 2; pass++)` with this reset at the top of **each** pass (298-318):

```cpp
globalLabel[0] = '\0';  labelNum = 0;
stcLabelI = 0x00000000; stcLabelW = 0x10000000; stcLabelF = 0x20000000;
stcLabelR = 0x30000000; stcLabelD = 0x40000000;
includeNestLevel = 0;   includeFile[0] = '\0';
loc = 0;  sectionLoc[0..15] = 0;  sectI = 0;
lineNum = 1;  lineNumL68 = 1;  endFlag = false;
errorCount = warningCount = 0;  skipCond = false;
```

Line loop (319-329):

```cpp
while (!endFlag && fgets(line, 256, inFile)) {
  error = OK; continuation = false; skipList = false; printCond = false; skipCreateCode = false;
  assemble(line, &error);
  lineNum++;
}
```

After pass 1: `pass2 = true`. After pass 2: if `!endFlag`, `warningCount++` and
`printError(listFile, END_MISSING, lineNum)` (336-340). `rewind(inFile)` after each pass (342).

Consequences:

- Both passes run the complete code path, including INCLUDE file reads and macro expansion. Pass 1 exists
  to give every symbol a value; pass 2 produces listing, S-records and all messages.
- **Nothing is reported in pass 1.** Counting and `printError` are inside `if (pass2)` (ASSEMBLE.CPP:548-560).
- The option flags are **not** reset between the passes. Whatever `OPT`, `LIST` and `NOLIST` left behind
  at the end of pass 1 is the state at line 1 of pass 2. [EXP] a file whose last listing directive is
  `NOLIST` produces a listing that contains no source lines at all (only header, counts, symbol table);
  a file containing `OPT NOWAR` anywhere shows no warning at all, also for lines above the `OPT`.
- `nestLevel` (conditional-assembly depth, ASSEMBLE.CPP:144) and `startAddress` are not reset either
  (section 1.8).
- The three structured-code stacks (`stcStack`, `dbStack`, `forStack`) are emptied only at the end of
  `assembleFile` (ASSEMBLE.CPP:202-207), **not between the passes**: every `IF`/`WHILE`/`FOR`/`REPEAT`/
  `DBLOOP` left open in pass 1 is still on the stack when pass 2 starts.
- `noENDM` is reset once per assembly, not per pass: a missing `ENDM` found in pass 1 disables macro
  expansion for the rest of pass 1 and for the whole of pass 2 (section 3.6), so calls that pass 1
  expanded before the faulty definition generate nothing in pass 2.
- The temp file is neither truncated nor rewound between passes: macro bodies are written in pass 1 only
  (`if (pass == 0)`, MACRO.CPP:90, 105) and read in both passes.
- A physical line of 255 or more characters is split: `fgets(line, 256, ...)` returns the first 255
  characters and the rest is the next "line" (assembled as source, counted in `lineNum`). [EXP] For a
  line of exactly 255 characters the rest is only its line end, so an empty line follows it in the
  listing and every later line number is one higher. [EXP: engine/asm test "lines of 255, 256 and 300
  characters", native twin and wasm build]

### 1.4 `int assemble(char *line, int *errorPtr)` (ASSEMBLE.CPP:355-570) - one line

1. `if (pass2 && listFlag) listLoc();` - start a listing line with the current `loc` (366-367).
2. `strcap(capLine, line)` (369): copy to a local 256-byte buffer, upper-casing everything **outside
   single quotes**; each `'` toggles the mode (ASSEMBLE.CPP:233-249). Double quotes do not protect.
3. `tokenize(capLine, ", \t\n", token, tokens)` (371) fills the file-global `token[128]` (section 3.1.4).
4. Comment line = first non-blank character is `*` or `;` (372-375). If it is a comment and
   `pass2 && listFlag`, list it and return (377-381). (So comment lines are listed even inside a skipped
   conditional block and inside a macro expansion with macro expansion switched off. [EXP])
5. Conditional assembly: if `token[1]` is one of `IFC IFNC IFEQ IFNE IFLT IFLE IFGT IFGE ENDC`
   (case-insensitive `stricmp`) handle it here (386-540, section 3.5).
6. Otherwise, `if (!skipCond && !skipCreateCode) createCode(capLine, errorPtr);` (542-545).
7. In pass 2 only (548-560):

   ```cpp
   if (*errorPtr > MINOR) errorCount++; else if (*errorPtr > WARNING) warningCount++;
   printError(listFile, *errorPtr, lineNum);
   if (printCond && !skipList) { listCond(skipCond); listLine(line, lineIdent); }
   else if ((listFlag && (!skipCond && !skipList)) || *errorPtr > WARNING) listLine(line, lineIdent);
   ```

   At most one message per call of `assemble()`: the most severe code seen on the line (`NEWERROR`,
   section 4.1). A line with an error or warning is listed even when listing is off or the line would
   be hidden.
8. `catch(...)`: sets `EXCEPTION`, writes a text into `buffer`, returns 0 **without** counting or
   printing (562-567).

`assemble()` is re-entered recursively by `include()` (each line of the include file), `asmMacro()` (each
expanded line) and `assembleStc()` (each generated structured-code line).

### 1.5 `int createCode(char *capLine, int *errorPtr)` (ASSEMBLE.CPP:573-712)

1. `p = start = skipSpace(capLine)`; an empty line or a comment does nothing.
2. If the first non-blank character is not a letter, `.` or `_`: `ILLEGAL_SYMBOL` (584-585). This is
   applied to every line, whatever the first word turns out to be.
3. Scan a candidate label: first character, then while `isalnum || '.' || '_' || '$'`; only the first
   `SIGCHARS` = 33 characters are kept; `if (i >= SIGCHARS) LABEL_TOO_LONG` (587-595).
4. The word **is a label** iff `(isspace(*p) && start == capLine) || *p == ':'` (599): it starts in
   column 1 and is followed by white space, or it is followed directly by a colon (any column). A colon
   is skipped. If nothing but a comment follows, `define(label, loc, pass2, true, errorPtr)` and return
   (603-606) - **no word alignment** for a label that stands alone on its line.
   Otherwise (not a label) `p = start; label[0] = 0`.
5. `p = instLookup(p, &tablePtr, &size, errorPtr)` (611, section 3.2); return if `*errorPtr > SEVERE`.
   **A label that is followed by something is therefore defined only after the mnemonic has been
   accepted** (by step 6 or by the directive routine of step 7). On a line whose mnemonic is rejected
   (`INV_OPCODE`, `SYNTAX` from the size suffix, an earlier `ILLEGAL_SYMBOL`) the label is not defined in
   either pass, and every reference to it reports "Undefined symbol" as well. [ORA]
6. If `tablePtr->parseFlag` (a real instruction): align `loc` to even (`loc++; listLoc();`, 618-621),
   define the label (622-623), then walk the flavor list parsing source and destination with
   `opParse()` / `fieldParse()` and call the first matching flavor's builder (628-702). No match:
   `INV_ADDR_MODE` (703). Text after the last operand must start with white space, otherwise `SYNTAX`
   (669-672, 683-686); everything after that white space is a comment.
7. Otherwise (directive, MOVEM, macro call, structured statement):
   `(*tablePtr->exec)((int)size, label, p, errorPtr)` (707). The routine receives the size code
   (0, 1, 2, 4 or 8), the label text (possibly empty) and a pointer to the first non-blank character
   after the mnemonic inside the upper-cased line. Each directive defines the label itself and decides
   about alignment.

### 1.6 Call graph

```
TMain::mnuDoAssemblerClick                       mainS.cpp:342
 └─ assembleFile                                 ASSEMBLE.CPP:157
     ├─ initList                                 LISTING.CPP:92
     ├─ initObj ── writeObj                      OBJECT.CPP:130, 234
     ├─ processFile                              ASSEMBLE.CPP:278
     │   ├─ assemble (per line, per pass)        ASSEMBLE.CPP:355
     │   │   ├─ listLoc                          LISTING.CPP:180
     │   │   ├─ strcap, skipSpace, tokenize      ASSEMBLE.CPP:233, 261, 821
     │   │   ├─ eval (IFEQ.. operands)           EVAL.CPP:70
     │   │   ├─ createCode                       ASSEMBLE.CPP:573
     │   │   │   ├─ define ── lookup ── hash     SYMBOL.CPP:240, 91, 215
     │   │   │   ├─ instLookup ── lookup         INSTLOOK.CPP:58
     │   │   │   ├─ opParse ── eval ── evalNumber ── lookup / precedence / doOp   OPPARSE.CPP:59, EVAL.CPP
     │   │   │   ├─ fieldParse ── eval           ASSEMBLE.CPP:716
     │   │   │   ├─ pickMask                     ASSEMBLE.CPP:792
     │   │   │   ├─ flavor->exec: move, zeroOp, oneOp, arithReg, arithAddr, bitField, immedInst,
     │   │   │   │     quickMath, movep, moveReg, staticBit, trap, branch, moveq, immedToCCR, immedWord,
     │   │   │   │     dbcc, scc, shiftReg, exg, twoReg, oneReg, moveUSP, link    BUILD.CPP
     │   │   │   │       └─ output ── listObj / outputObj ── writeObj ;  effAddr ;  extWords   CODEGEN.CPP
     │   │   │   └─ tablePtr->exec (parseFlag false):
     │   │   │        org section offset funct_end equ set dc(collect) dcb ds opt
     │   │   │        failError listOn listOff memory simhalt page            DIRECTIV.CPP
     │   │   │        include ── assemble (recursive, per line of the file)   DIRECTIV.CPP:638
     │   │   │        incbin ── outputObj                                     DIRECTIV.CPP:761
     │   │   │        movem, reg ── evalList, opParse                         MOVEM.CPP
     │   │   │        macro (definition; reads body lines from inFile)        MACRO.CPP:76
     │   │   │        asmMacro (call; via INSTLOOK asmMac) ── assemble (recursive)   MACRO.CPP:133
     │   │   │        asmStructure ── outCmpBcc / getBcc ── assembleStc ── assemble (recursive)  STRUCTURED.CPP
     │   │   ├─ printError ── listError          ERROR.CPP:45, LISTING.CPP:206
     │   │   └─ listCond, listLine               LISTING.CPP:193, 122
     │   └─ printError(END_MISSING)
     ├─ finishList ── optCRE                     LISTING.CPP:255, SYMBOL.CPP:184
     ├─ finishObj ── writeObj, writeMap          OBJECT.CPP:317
     └─ clearSymbols                             SYMBOL.CPP:41
```

Functions that exist but are never called: `moves`, `movec` (BUILD.CPP:405, 492; their table entries
are commented out, INSTTABL.CPP:479-484, 497-500, 832, 836), all of BINFILE.CPP (`initBin`,
`outputBin`, `finishBin`, `writeBigEndian`). Declared in proto.h but defined nowhere: `setFlags`,
`help`, `checkValue` (proto.h:145, 149, 173).

### 1.7 Every file opened or created

| File | Opened by | Mode | Lifetime |
|---|---|---|---|
| `<srcdir>\EASy68Ks.tmp` | written by the GUI (mainS.cpp:373), read by `assembleFile` (ASSEMBLE.CPP:170) | `"r"` text | deleted after the run (mainS.cpp:375) |
| `<srcdir>\EASy68Km.tmp` | `assembleFile` (ASSEMBLE.CPP:163); written by `macro()` in pass 1, read by `asmMacro()` | `"w+"` text | always created, also without macros; deleted after the run (mainS.cpp:376) |
| `<name>.L68` | `initList` (LISTING.CPP:96), only if "Generate List File" is checked | `"w"` text | closed in `finishList` |
| `<name>.S68` | `initObj` (OBJECT.CPP:132), only if `objFlag` | `"w"` text | closed in `finishObj` |
| INCLUDE file | `include` (DIRECTIV.CPP:698) | `"r"` text | once per pass per INCLUDE line |
| INCBIN file | `incbin` (DIRECTIV.CPP:813) | `"rb"` | once per pass per INCBIN line |

No binary object file is produced: BINFILE.CPP is dead code (section 6.5). `errFile` and `binFile`
(GLOBALS.CPP:47, 49) are never opened. Creation failures show a message box ("Unable to create listing
file", LISTING.CPP:98-99; "Unable to create S-Record file", OBJECT.CPP:134-135) and the assembly
continues without that output.

### 1.8 State and what must be reset between runs

The engine is a set of globals. `processFile` resets most of them (section 1.3), `assembleFile` frees
the symbol table and the three structured-code stacks, `initObj`/`initList` reset their own statics.
The following survive from one assembly to the next inside the same running editor and can change the
result of the next run:

| Global | File:line | Effect when stale |
|---|---|---|
| `nestLevel` | ASSEMBLE.CPP:144 | A source with an unterminated false `IFxx` leaves it > 0; the next false `IFxx` then never ends (its `ENDC` only brings the count back to the stale value), so the rest of that file is skipped. It also leaks from pass 1 into pass 2 of the same run. |
| `startAddress` | GLOBALS.CPP:37 (and BINFILE.CPP:55) | Only assigned by `END`. Without `END` the first listing line and the S8 record carry the value of the previous run (0 in a fresh process). [EXP: `00000000 Starting Address`, `S804000000FB`] |
| `createdL68` | LISTING.CPP:90 | Written only inside `initList` (false on entry, true once the file is open, LISTING.CPP:95, 112), and `initList` is not called when "Generate List File" is unchecked. If such a run follows one that produced a listing, the flag is still true and `listLine`/`listError`/`finishList` use the already closed `listFile` (undefined behaviour). |
| `lineIdent[]` | MACRO.CPP:69 | Early error returns in `asmMacro` (MACRO.CPP:231-260) leave the `m...` prefix in place; it then decorates ordinary lines until the next successful macro call. |
| `listPtr` | GLOBALS.CPP:55 | NULL until the first `listLoc()`. `listLoc()` runs at the start of every line while `pass2 && listFlag`, and - in either pass, whatever `listFlag` is - from `org`, `section`, `offset`, `dc`, `dcb`, `simhalt` and from the odd-address alignment in `createCode`, `ds` and `movem`. `listCond()` writes through `listPtr` without a check (LISTING.CPP:195-198). It is therefore still NULL at an `IFxx` line of pass 2 only in a fresh process, with `listFlag` false from the start, for a source that executes none of those directives before that line (pass 1 included). |
| `macroFP`, `skipList`, `skipCreateCode`, `printCond`, `continuation`, `token[]`, `tokens[]`, `tokenEnd[]` | MACRO.CPP:66, ASSEMBLE.CPP:134-143 | scratch; overwritten before use |
| option flags | GLOBALS.CPP:59-66 | overwritten by the GUI before every run |
| `htable[]`, `symbolInit` | SYMBOL.CPP:36-37 | cleared by `clearSymbols()` at the end of every run |
| `stcStack`, `dbStack`, `forStack` | STRUCTURED.CPP:67-71 | emptied at the end of every run (not between the passes, section 1.3); their heap buffers stay allocated (matters for section 9.3.6) |
| `listData[]` | LISTING.CPP:76 | text of the last listing line; shown again by any line that is listed without a fresh `listLoc()` (section 5.2) |

**Port rule:** the simplest way to get first-run behaviour every time is a fresh WebAssembly instance (or a
re-initialised memory image) per assembly. If one instance is reused, reset at least `nestLevel`,
`startAddress`, `createdL68`, `lineIdent[0]` and `listPtr` (to `listData`) before each run.

### 1.9 Other GUI code that calls into the engine

- The syntax highlighter (textS.cpp:1092-1234 and `highlightLine`, textS.cpp:1304-1494) calls `strcap`
  (1146), `skipSpace`, `tokenize(start, ". \t\n", tokenS, tokensS)` (1184) - which overwrites the engine's
  global `tokenEnd[]` (declared there as `extern char *tokenEnd[256]`, textS.cpp:54, although the
  definition is `char *tokenEnd[MAXT]` with `MAXT == 128`, ASSEMBLE.CPP:139-143) - and
  `instLookup(tokenS[1], &tablePtr, &size, &error)` (1451), which reads `instTable`, `BITflag` and the
  symbol table (empty outside an assembly) and reads `tablePtr->flavorPtr->source`. A TypeScript
  highlighter does not need any of this; if the same classification is wanted, export `instLookup`.
- optionsS.cpp only reads and writes the flags (section 2). assembleS.cpp is the status dialog
  (Execute spawns `SIM68K.EXE "<name>.S68"`, assembleS.cpp:33-37; "Load L68" opens `<name>.L68` in the
  editor, assembleS.cpp:78-80).

---

## 2. Option flags

All flags are plain `bool` globals in GLOBALS.CPP:59-66. The GUI writes them in three places: on
"OK" in the Assembler Options dialog (optionsS.cpp:71-79 and 93-101), when settings are loaded at
start-up (optionsS.cpp:228-426, called from `TMain::FormShow`, mainS.cpp:729) and - authoritative
for an assembly - immediately before every run (mainS.cpp:360-367).

Defaults: `TOptions::LoadSettings` first calls `defaultSettings()` (optionsS.cpp:237, 915-938), which
copies the design-time state of the check boxes; then each line of `settings.dat` (next to the EXE,
optionsS.cpp:233) overrides its flag **only if the text after the value matches exactly** (for example
`!strcmp(&buffer[1], "$generate list")`, optionsS.cpp:250). So the default when `settings.dat` is absent
is the `.dfm` state.

| Flag (global) | Check box (optionsS.dfm) | settings.dat line | Default (dfm) | `OPT` | Effect |
|---|---|---|---|---|---|
| `listFlag` | `chkGenList` "Generate List File" (84-96) | `N$generate list` | on (`Checked = True`, line 91) | changed by `LIST` / `NOLIST` directives (DIRECTIV.CPP:878-893) | The check box (read directly, ASSEMBLE.CPP:177) decides whether `<name>.L68` is created. `listFlag` gates `listLoc()` at the start of a line (ASSEMBLE.CPP:366), the object field (`output()`, CODEGEN.CPP:70), and the listing of ordinary lines (ASSEMBLE.CPP:558). Messages, the lines they belong to and evaluated `IFxx` lines are written even when it is false (section 5.2). |
| `objFlag` | `chkGenSRec` "Generate S-Record" (97-109) | `N$generate s-record` | on (104) | - | `.S68` is created (ASSEMBLE.CPP:183-187) and `output()` / `incbin()` call `outputObj` (CODEGEN.CPP:72, DIRECTIV.CPP:825). Cleared if the file cannot be created. |
| `Options->bSave` (not an engine global; optionsS.h:47) | `chkSave` "Auto Save Modified Source Before Assembling" (110-120) | `N$save then assemble` | off | - | mainS.cpp:351-354 saves the file before assembling. |
| `WARflag` | `chkShowWarnings` "Show Warnings" (121-130) | `N$show warnings` | on (127) | `WAR` / `NOWAR` | `printError` returns without output for codes in (0x100, 0x200) when false (ERROR.CPP:50-51). **The warning is still counted** (ASSEMBLE.CPP:551-552, 338). |
| `BITflag` | `chkBitfield` "Assemble Bit Field Instructions" (131-140) | `N$assemble bit field` | on (137) | `BIT` (no `NOBIT`) | When false `instLookup` answers `INV_OPCODE` for BFCHG, BFCLR, BFEXTS, BFEXTU, BFFFO, BFINS, BFSET, BFTST (INSTLOOK.CPP:115-119). |
| `CREflag` | `chkCrossRef` "Cross Reference" (149-161) | `N$cross reference` | on (156) | `CRE` (no `NOCRE`) | `finishList` appends the symbol table (LISTING.CPP:276-277). There is no real cross reference. |
| `MEXflag` | `chkMacEx` "Macros Expanded" (162-172) | `N$macros expanded` | off | `MEX` / `NOMEX` | When false every expanded macro line gets `skipList = true` (MACRO.CPP:350-351). |
| `CEXflag` | `chkConstantsEx` "Constants Expanded" (173-183) | `N$constants expand` | off | `CEX` / `NOCEX` | `listObj`: when true, data that does not fit the object field continues on extra listing lines; when false `...` is shown (LISTING.CPP:226-235). `DCB` forces it off for its own data (DIRECTIV.CPP:498-504). |
| `SEXflag` | `chkStrucEx` "Structured Expanded" (184-194) | `N$structured expand` | off | `SEX` / `NOSEX` | When false the generated CMP/Bcc/label lines are not listed (STRUCTURED.CPP:737-741). |
| `tabType` (global, GLOBALS.CPP:70) and per window `Project.TabType` / `Project.TabSize` (textS.h:34-35) | Editor Options: `AssemblyTabs` / `FixedTabs` radio buttons, `FixedTabSize` spin edit (editorOptions.dfm:190-218) | `N$tab type` (0 = Assembly, 1 = Fixed), `N$fixed tab size` | Fixed (`FixedTabs` checked, dfm:215), size 4 (dfm:199; allowed 4..20, editorOptions.cpp:94-97) | - | Only the listing uses it: `listLine` expands tabs of the source text with the **active window's** `Project.TabType` / `Project.TabSize` (LISTING.CPP:128-146). A window gets them from Editor Options when it is created (textS.cpp:887-892) or loaded (textS.cpp:131-135), overridden by the `*~Tab type~N~` / `*~Tab size~N~` footer of the .X68 file (textS.cpp:144-157), and changed by Editor Options "OK" (editorOptions.cpp:88-103). |
| `noFileName` (GLOBALS.CPP:67), `xrefFlag` (only an `extern`, ASSEMBLE.CPP:112) | - | - | - | - | Unused. |
| `maximizedEdit`, `autoIndent`, `realTabs`, the `FontStyle` colours (GLOBALS.CPP:71-82) | editor only | | | | Not used by the engine; they live in GLOBALS.CPP only because the editor shares the file. |

Notes:

- The copy of `settings.dat` in the source tree has `1$constants expand`, i.e. the author's own
  setting, not the default. The installer does ship a `settings.dat`
  (`c:\easy64k\reference\official-installer-script\[NSIS].nsi:576`; the file is
  `c:\easy64k\reference\official-extracted\settings.dat`, see `ground-truth.md`): its option lines are
  `1$generate list`, `1$generate s-record`, `0$save then assemble`, `1$show warnings`,
  `1$cross reference`, `0$macros expanded`, `0$structured expand`, `0$constants expand`, `1$tab type`,
  `4$fixed tab size`, `1$assemble bit field` - **the same values as the dfm defaults in the table**.
  Its first line still says v5.15.04, which does not matter: line 1 is read and discarded
  (optionsS.cpp:247). A fresh install therefore assembles with exactly the defaults above.
- The lines are positional: `LoadSettings` reads them in the fixed order of `SaveSettings`
  (optionsS.cpp:157-173) and a line whose text does not match is skipped without re-synchronising. Any
  value character other than `1` means false (for `$tab type`: `0` = Assembly, anything else = Fixed).
  Loading sets the global **and** the check box (optionsS.cpp:250-257 and following), so the copy made
  before each assembly (mainS.cpp:360-367) sees the loaded values.
- `SaveSettings` (on Options "OK" and when the editor closes, mainS.cpp:792) writes `listFlag` and
  `objFlag` from the **engine globals** but every other option from its check box
  (optionsS.cpp:158-165, 173). The globals can have been changed by the last assembly (`NOLIST` /
  `LIST`, or `objFlag = false` after a failed .S68 creation), so in the original, assembling a source
  whose last listing directive is `NOLIST` and then closing the editor stores `0$generate list`, and
  the next session starts with "Generate List File" unchecked. A GUI artefact; the port should persist
  the user's choices, not the engine state.
- Options "OK" with "Generate List File" or "Generate S-Record" unchecked first asks "You have unchecked
  options that are required for use by the 68000 simulator Sim68K. ... Do you wish to continue?"; "No"
  re-checks both boxes (optionsS.cpp:56-88).
- `OPT` operands are processed in **both** passes and are never undone (section 1.3). `OPT CRE` can only
  switch the symbol table on. [ORA: an `OPT MEX` near the end of a source expands the macro calls
  above it as well.]
- `OPT BIT` additionally writes the line `*[sim68k]bitfield` into the listing (DIRECTIV.CPP:620-625).
  Enabling bit fields through the check box alone does **not** write that marker, so the simulator is
  then not told to enable bit-field execution (the marker is what sim/SIM68Ku.cpp:330-333 looks for).
- Help disagreement: help/Directives/opt.htm lists only MEX, NOMEX, SEX, NOSEX, WAR, NOWAR, BIT. The
  source also accepts CRE, CEX and NOCEX (DIRECTIV.CPP:602-619).

---

## 3. Features a test suite must cover

### 3.1 Source line anatomy

#### 3.1.1 Fields

`[label[:]] [mnemonic[.size] [operands]] [comment]`, fields separated by spaces or tabs. Everything
outside single quotes is upper-cased before parsing (`strcap`), so mnemonics, register names, symbols,
hex digits and macro arguments are case-insensitive, and what a macro argument substitutes is the
upper-cased text.

#### 3.1.2 Comments

- A line whose first non-blank character is `*` or `;` (ASSEMBLE.CPP:372).
- After a label: `LABEL  * text` or `LABEL ; text` (ASSEMBLE.CPP:603).
- After the operand field: any text following white space. There is no comment character requirement;
  parsers simply stop at the first white space after the last operand. (`NOP anything` is fine;
  `MOVE.L #1 + 2,D0` is not: the operand ends at the space, then a comma is expected. [EXP] "Comma expected")
- A mnemonic directly followed by `;` or `*` without a space is `SYNTAX` (INSTLOOK.CPP:92-94).
- **Where an operand is optional or absent the comment is taken as the operand.** A routine with
  `parseFlag` false receives a pointer to the first non-blank character after the mnemonic
  (ASSEMBLE.CPP:614, 707) and none of them knows about comment characters:
  `END ; text` and `SECTION ; text` are "Invalid syntax" (and the start address stays unset);
  `END * text` evaluates `*` and silently makes the current location the start address, without the
  "Address expected" warning; `END text` reports "Undefined symbol" (or takes the value of a symbol
  that happens to be called `TEXT`); a macro call takes the first word
  as argument 1 (section 3.6); `OPT ;x` does nothing at all. [ORA] Instructions without operands
  (`NOP`, `RTS` ...) and `SIMHALT`, `LIST`, `NOLIST`, `PAGE`, `REPEAT`, `ENDI` ... ignore the rest of the
  line.

#### 3.1.3 Labels (createCode ASSEMBLE.CPP:581-610, lookup SYMBOL.CPP:91-180, define SYMBOL.CPP:240-268)

| Rule | Detail |
|---|---|
| Position | The first word of a line is a label if it starts in column 1 and is followed by white space, **or** if it is followed immediately by `:` (then it may be indented). An opcode written in column 1 is therefore taken as a label: `NOP` in column 1 defines a symbol `NOP` and generates no code [EXP]; `END START` in column 1 takes `END` as the label and `START` as the mnemonic, reports "Invalid opcode" (the symbol `END` is not created, see the next row) and later "END directive missing". |
| When the label is defined | A label alone on its line (or followed only by a comment) is defined at once. A label followed by a mnemonic is defined only after `instLookup` has accepted the mnemonic: by `createCode` for instructions (after alignment, before the operands are parsed - so it exists even if the operands are wrong) or by the directive routine. `LBL  BOGUS D0` leaves `LBL` undefined, and each `BRA LBL` elsewhere adds an "Undefined symbol". [ORA] |
| Unterminated last line | The "followed by white space" test needs a character after the word: a bare label on a last line that has no line end (possible in an INCLUDE file; the main source always ends in a line end, section 9.4.1) is not followed by white space, is looked up as a mnemonic and reports "Invalid opcode". [ORA] |
| First character | Letter, `.` or `_`. Anything else as the first non-blank character of a non-comment line - label or not, indented or not - gives `ILLEGAL_SYMBOL` "Illegal symbol" (ASSEMBLE.CPP:584-585) and the line is not assembled. [EXP] (A label-only line of that kind still creates the symbol in pass 1, with unset value and flags - hazard 9.3.3 - and it then appears in the symbol table.) |
| Other characters (definition) | Letters, digits, `.`, `_`, `$` (ASSEMBLE.CPP:592). |
| Characters in a reference | Letter, `.` or `_` first, then letters, digits, `_`, `$` - **no dot** after the first character (EVAL.CPP:305-315). A label defined as `A.B` can never be referenced: `MOVE.W A.B,D0` parses `A` then `.B` ("Comma expected"). [EXP] |
| Case | Insensitive (upper-cased). |
| Length | 33 significant characters (`SIGCHARS`, asm.h:129). The warning `LABEL_TOO_LONG` is raised when the scanned word has 33 **or more** characters (`if (i >= SIGCHARS)`, ASSEMBLE.CPP:594), so the longest label without a warning is 32. Longer names are truncated to 33 and still defined. The same scan runs over the first word of every line, label or not. |
| Colon | Optional, not part of the name. `L3:NOP` works without a space. [EXP] |
| Label alone on a line | Defined with the current `loc` without alignment; after `DC.B` data the label can be odd while the following instruction is aligned to the next even address. [EXP: `ODD` = $1009, next instruction at $100A] |
| Label before an instruction | `loc` is first made even, then the label is defined (ASSEMBLE.CPP:618-623). |
| Local labels | A name starting with `.`. In `lookup()` the dot is replaced by `:` and the name is prefixed with `globalLabel`, the last **non-local symbol defined** (SYMBOL.CPP:109-124, 248-249): `.loop` after `MAIN` becomes `MAIN:LOOP` (this is the name in the symbol table). The combined name is truncated to 33 characters with `LABEL_TOO_LONG` when it reaches 33. |
| Local label too long | When global name + `:` + local name reaches 33 characters the **definition** only gets the warning "Label too long", but every **reference** fails: `evalNumber` treats any non-`OK` status of `lookup()` - including that warning - as "not found" (EVAL.CPP:319-353), so pass 2 reports "Undefined symbol" on each line that uses the label and the operand is garbage. [ORA: a 25-character global label with `.LOCALXX`] |
| Names that are never symbols in operands | `opParse` tests the register spellings first (OPPARSE.CPP:115-131, 300-328): `D0`-`D7`, `A0`-`A7`, `SP`, `SR`, `CCR`, `USP`, `SFC`, `DFC`, `VBR` followed by `,` `/` `-` white space, end of line or `{` are registers even if a label of that name exists. The label can be defined and appears in the symbol table; it stays usable wherever the name is not a complete operand (`#SR`, `SR+0`, `SR(A0)`, `DC.W SR`, `EQU`), but a bare `SR` / `D0` operand is always the register. |
| What ends a local scope | Every successful `define()` of a non-local name: ordinary labels, `EQU`, `SET`, `REG`, `SECTION` labels, macro **definitions**, labels on macro calls, and the labels generated by structured statements (`_00000000` ...). [EXP: `.a` after `VAL EQU 5` is `VAL:A`; a `.a` referenced after an `ENDW` is "Undefined symbol"; a local label inside macro `M` defined right after the macro definition is `M:M_1`] |
| Duplicate definition | Pass 1 flags `MULTIPLE_DEFS` silently and keeps the first value. Pass 2 reports "Symbol defined more than once" **only if the second definition has a different value** (SYMBOL.CPP:253-257). Two identical `X EQU 5` lines produce no message. [EXP] |
| Phase error | Pass 2 value differs from pass 1 value and the symbol was not yet defined in pass 2: `PHASE_ERROR` "Symbol value differs between first and second pass". It is a severe error, so the instruction on that line is not assembled, which shifts everything after it. |
| `SET` symbols | `REDEFINABLE` flag; value updated at each `SET` in both passes (SYMBOL.CPP:260-261). `SET` on a name that already exists as an ordinary symbol silently turns it into a redefinable one (the `MULTIPLE_DEFS` from pass 1 goes into a local that is discarded, DIRECTIV.CPP:319-321). |

#### 3.1.4 `tokenize()` (ASSEMBLE.CPP:821-881)

Used for conditional assembly (delimiters `", \t\n"`), macro definition scanning (`" \t\n"`), macro
body lines (`", \t\n"`) and structured statements (`". \t\n"`).

- `token[0]` is reserved for the label: if the line starts with white space, numbering starts at 1.
  Unused entries point to the global empty string `empty` (tests like `token[2] == empty` compare pointers).
- A token ends at a delimiter unless inside parentheses (`parenCount > 0`) or inside single quotes
  (`quoted`, toggled by every `'`).
- `''` at the start of a token yields an empty token.
- When `.` is in the delimiter set, the dot is kept as the first character of the next token
  (`IF.B` gives `IF`, `.B`).
- At most 127 tokens, 512 bytes of token text.
- White space is skipped before and after every token (`isspace`, ASSEMBLE.CPP:846, 876), so a run of
  blanks is one separator. Exactly one delimiter character is consumed after a token (871-872); a
  second non-blank delimiter then yields an **empty token**: `A,,B` and `A ,B` both give `A`, empty,
  `B`, while `A, B` and `A  B` give `A`, `B`. [ORA: `IFC A ,A` is FALSE (it compares `A` with the
  empty token), `IFC A  A` is TRUE.]
- The quote state is not reset between tokens; an unbalanced `'` makes the rest of the line one token.
- A comment line produces no tokens. A comment after a statement is tokenised like everything else.

Consequence used throughout: **directive names recognised through tokens must be `token[1]`**, i.e. be
preceded by white space or by a label. `IFEQ`, `ENDC`, `ENDM`, `MEXIT`, `IFARG` written in column 1 are
labels, not directives (an `ENDM` in column 1 is not seen; the macro definition runs to end of file and
gives "ENDM expected").

### 3.2 Mnemonic and size (instLookup, INSTLOOK.CPP:58-148)

- The mnemonic is the first character plus following letters, digits, `_`, `-`, 33 significant.
- Size suffix: `.` must be followed by one character and then white space or end of line
  (`isspace(p[2]) || !p[2]`), otherwise `SYNTAX`. `B` = 1, `W` = 2, `L` = 4, `S` = 8; any other letter
  gives size 0 and `INV_SIZE_CODE` (INSTLOOK.CPP:73-91). A bare dot counts as `.W` only when the
  character after it **and** the next one are white space (or the line ends): `MOVE.  D0,D1` (two
  blanks) is `MOVE.W`, `MOVE. D0,D1` (one blank) is `SYNTAX`, and `NOP.` at the end of a line is size
  word, which `NOP` then rejects with "Invalid size code". [ORA]
- Whether the size is legal for the mnemonic is decided later (`pickMask`, ASSEMBLE.CPP:792-803, or
  the directive routine): an illegal size is the minor error `INV_SIZE_CODE` and the instruction is
  still generated, from the flavor's word-size opcode mask (the builder still receives the size as
  written). [ORA: `NOP.` lists `4E71` under the message.]
- No suffix: the next character must be white space or end of line, else `SYNTAX`.
- Binary search of `instTable[0 .. tableSize-1]` (INSTTABL.CPP:733-905, 163 entries of which 32 are not plain
  instructions, upper-case, alphabetical; comparison is `strcmp`, so the order must stay ASCII-sorted).
- Bit-field mnemonic with `BITflag` false: `INV_OPCODE`.
- Not in the table: `lookup()` in the symbol table; if the symbol has `MACRO_SYM` it is a macro call
  (`asmMac`, INSTLOOK.CPP:56, 127-133); in pass 2 a macro not yet defined in pass 2 adds the warning
  `FORWARD_REF`. Otherwise `INV_OPCODE` "Invalid opcode".
- Built-in mnemonics always win over macros of the same name.

Table entries that are not plain instructions (`parseFlag` false), all dispatched with
`(size, label, operandText, errorPtr)`:

`DBLOOP, DC, DCB, DS, ELSE, END, ENDF, ENDI, ENDW, EQU, FAIL, FOR, IF, INCBIN, INCLUDE, LIST, MACRO,
MEMORY, MOVEM, NOLIST, OFFSET, OPT, ORG, PAGE, REG, REPEAT, SECTION, SET, SIMHALT, UNLESS, UNTIL, WHILE`.

Not in the table and handled elsewhere: `IFC IFNC IFEQ IFNE IFLT IFLE IFGT IFGE ENDC` (assemble),
`ENDM MEXIT IFARG NARG \n \@` (macro processing). Commented out, therefore "Invalid opcode":
`MOVEC`, `MOVES`, `RTD` (INSTTABL.CPP:832, 836, 859).

### 3.3 Expressions (EVAL.CPP)

`char *eval(char *p, int *valuePtr, bool *refPtr, int *errorPtr)` (EVAL.CPP:70-179) is an operator
precedence evaluator over 32-bit `int`.

**Operands** (`evalNumber`, EVAL.CPP:185-369):

| Form | Rule | file:line |
|---|---|---|
| `*` | Current location counter `loc` at the moment of parsing. In `DC.L *,*` each `*` is the address of its own element [EXP]. | 200-203 |
| `-x`, `~x` | Unary minus / one's complement, applied to the next operand only (binds tighter than every binary operator); may be stacked (`--1`). No unary plus. | 204-215 |
| `(expr)` | Parenthesised sub-expression. | 216-228 |
| `$hex` | `$` followed by at least one hex digit. More than 8 significant digits: warning `NUMBER_TOO_BIG`, value keeps the low 32 bits ([EXP] `$123456789` -> `$23456789`). | 229-243 |
| `%bin`, `@oct`, decimal | At least one digit; overflow beyond 32 bits unsigned gives `NUMBER_TOO_BIG` and wraps. | 244-273 |
| `'chars'` | 1 to 4 characters packed big-endian, right justified (`'A'` = $41, `'AB'` = $4142, `'ABCD'` = $41424344); **exactly 3 characters are shifted left one byte** (`'ABC'` = $41424300, `else if (i == 3) x = x << 8;`); more than 4: warning `ASCII_TOO_BIG` and the low 32 bits (last 4 characters). `''` inside is one quote. Empty literal, or a literal that is the last thing in the buffer (`*p == '\0'` after the closing quote), is `SYNTAX`. Characters >= $80 are sign-extended before being added (`char` is signed): the two-character constant made of `A` and the byte $E9 evaluates to $40E9, not $41E9 [EXP]. | 274-304 |
| symbol | Letter, `.` or `_`, then letters, digits, `_`, `$`; 33 significant. Value from the symbol table. Register-list symbols: `REG_LIST_SPEC`. Undefined: pass 1 `INCOMPLETE` (a warning code, never shown), pass 2 `UNDEFINED` - and in pass 2 the evaluation **stops right after that symbol** (see "Error protocol" below). | 305-355 |
| anything else | `SYNTAX`. | 356-360 |

**Binary operators** (`precedence`, EVAL.CPP:373-395; `doOp`, EVAL.CPP:399-430), highest first:

| Precedence | Operators | Meaning |
|---|---|---|
| 4 | `>>` `<<` | `>>` is a logical shift (`(unsigned) val1 >> val2`); the operator character must be doubled, a single `>` or `<` is `SYNTAX` |
| 3 | `&`, `!`, the vertical bar (ASCII $7C), `^` | AND, OR (`!` and the vertical bar are both OR), XOR |
| 2 | `*` `/` `\` | multiply, signed divide, signed remainder (C `%`); divisor 0: pass 1 `INCOMPLETE`, pass 2 `DIV_BY_ZERO` |
| 1 | `+` `-` | |

Equal precedence associates left to right (`prec <= precedence(top)` reduces). Note the unusual order:
shifts bind tightest, then the bitwise operators, then `* / \`, then `+ -`.
[EXP] `1+2*3&4>>1` = 5; `$F0&$3C!1` = $31; `7\4` = 3; `10/3` = 3; `6^3` = 5; `-1+2` = 1; `~0&$F` = $F.

**Terminators**: `,` `(` `)` end of string, white space, `.` `{` `:` `}` (EVAL.CPP:156). Any other
character where an operator is expected is `SYNTAX`. **White space therefore ends an expression**:
no spaces are allowed inside one. The only exception is made by `opParse` for instruction operands
(not for directives): when the **first or second character of the operand is `(`** it deletes the white
space up to the matching `)` before parsing (OPPARSE.CPP:68-91). So `#(1 + 2)`, `( 4, A0 )`, `-( SP )`
and `4( A0, D1 )` work [EXP for the first], but `#1 + 2` does not, and neither does `12( A0 )` or
`LABEL( A0, D1 )`, where the parenthesis comes later in the operand.

**Forward-reference flag**: `*refPtr` is true when every symbol in the expression was already defined in
the current pass (pass 1: any symbol found; pass 2: symbol has `BACKREF`). Directives that need a known
value test it and answer `INV_FORWARD_REF`.

**Error protocol** (EVAL.CPP header comment and code):

- Pass 1, undefined symbol: status `INCOMPLETE` is below `ERRORN`, so parsing continues to the end of
  the expression, but the value pushed for the symbol is **uninitialised** (the local `t` in `eval` is
  pushed without having been written, EVAL.CPP:97-110). Callers must only rely on `*refPtr == false`.
  See hazard 9.3.3.
- Pass 2, undefined symbol: `eval` returns at once (`if (!backRef && status > ERRORN) { *refPtr =
  false; return p; }`, EVAL.CPP:99-103) with `p` pointing **just behind the symbol**, the rest of the
  expression unparsed and `*valuePtr` **not written**. What the user sees therefore depends on the
  character that follows the undefined name [ORA]:

  | Operand | Message on the line | Why |
  |---|---|---|
  | `MOVE.W UNDEF,D0`, `UNDEF(A0)`, `DC.W UNDEF` | "Undefined symbol" | the caller finds a legal terminator |
  | `MOVE.W UNDEF+2,D0`, `#UNDEF+1`, `#UNDEF*2` | "Invalid syntax" | `opParse` sees `+` where the operand should end (OPPARSE.CPP:98-109, 412-433); `SYNTAX` outranks `UNDEFINED` |
  | `MOVE.W UNDEF-2,D0`, `#UNDEF-1,D0` | "Comma expected" | `-` is in `isTerm` (asm.h:31), so the operand "ends" there and `createCode` then misses the comma |
  | `(UNDEF+1)` anywhere | "Invalid syntax" | the inner `eval` stops before `+`, `evalNumber` then misses its `)` |
  | `DC.W UNDEF+1,5` | "Undefined symbol", **one** word emitted | `dc` stops at the `+`; pass 1 counted two words, so every later label gets a phase error |

  A misspelt label inside an expression is thus normally reported as a syntax error, not as an
  undefined symbol.
- A status above `SEVERE` makes `eval` return NULL; callers test `*errorPtr`, never the pointer.

Stack depth is 5 values / 4 operators (`STACKMAX`, EVAL.CPP:68); it cannot overflow because operators on
the stack have strictly increasing precedence and parentheses recurse.

### 3.4 Directives

One row per directive; "label" says what happens to a label on the line.

| Directive | Implemented in | Behaviour to test |
|---|---|---|
| `ORG expr` | `org` DIRECTIV.CPP:89-127 | Leaves OFFSET mode first (restores `loc`), so `ORG *` after OFFSET restores the code address [EXP]. Forward reference: `INV_FORWARD_REF`. Odd value: warning `ODD_ADDRESS`, rounded up [EXP `ORG $1001` -> $1002]. Label defined with the new `loc`. Missing operand or trailing junk: `SYNTAX`. Size suffix: `INV_SIZE_CODE` but still executed. |
| `SECTION [n]` | `section` DIRECTIV.CPP:132-168 | n in 0..15 else `SYNTAX`; saves `loc` in `sectionLoc[sectI]`, loads `loc = sectionLoc[n]` (0 the first time), leaves OFFSET mode. **A label is defined as the section number, not as an address** (`define(label, sectI, ...)`). Without operand a label is required (`LABEL_REQUIRED`) and receives the current section number. The pointer returned by `eval` is discarded, so text after the number is not checked (`SECTION 2 JUNK` is accepted [ORA]); a comment directly after a bare `SECTION` is parsed as the operand (3.1.2). |
| `OFFSET expr` | `offset` DIRECTIV.CPP:173-205 | Saves `loc` in `locOffset` (only when entering), sets `loc`, sets `offsetMode`. Label: `LABEL_ERROR` **and the directive is not executed** (the severe code blocks both branches at 188-191) [ORA]. While in OFFSET mode nothing is written to the S-record (OBJECT.CPP:173) but lines are assembled and listed normally, with `=` after the address. Ended only by `ORG` or `SECTION`. No odd check. |
| `END [expr]` | `funct_end` DIRECTIV.CPP:214-249 | Sets `endFlag` first, whatever else is wrong with the line: nothing after this line is read, also when it is inside an include file (inside a macro the expansion still runs to its `ENDM`). No operand: `startAddress = 0x1000` and warning `ADDRESS_MISSING` "Address expected" [EXP]; a label on such a line is silently ignored (not defined). Label with operand: `LABEL_ERROR` and **the start address is not set** (it keeps its previous value, 0 in a fresh instance) [ORA]. Forward/undefined: error, start address not set. Odd: `ODD_ADDRESS`, rounded up. A trailing comment after a bare `END` is parsed as the operand (3.1.2). |
| `label EQU expr` | `equ` DIRECTIV.CPP:256-288 | Label required (`LABEL_REQUIRED`), no forward references, trailing junk `SYNTAX`, listing shows `=XXXXXXXX`. A size suffix gives `INV_SIZE_CODE`; the symbol is still defined but the `=XXXXXXXX` field is left out (it is written only while the line's code is below 0x200) [ORA]. The value is checked like a label: a second `EQU` of the same name with another value is "Symbol defined more than once", a value that differs between the passes a phase error. |
| `label SET expr` | `set` DIRECTIV.CPP:295-331 | Like EQU but redefinable and forward references are accepted. |
| `DC[.B/.W/.L] item,...` | `dc` DIRECTIV.CPP:338-415, `collect` 422-440 | Default `.W`; `.S` gives `INV_SIZE_CODE` and is treated as `.W`. `.W`/`.L` align to even first; label defined after alignment. An item that starts with `'` **immediately after the comma** and whose closing quote is followed by white space or a comma is a string: packed `size` bytes per unit, last unit padded with zero bytes ([EXP] `DC.W 'ABC'` -> 4142 4300, `DC.L 'ABCDE'` -> 41424344 45000000). Any other item is an expression (so `'A'+1`, and also a quoted item preceded by a space after the comma, which is then a 1-4 character constant: [EXP] `DC.B 'AB', 'C'` -> 41 42 43). Range check for expressions: byte -128..255 (`INV_8_BIT_DATA`), word -32768..65535 (`INV_16_BIT_DATA`); the truncated value is still emitted. Double quotes are not string delimiters ([EXP] `"x"` -> "Invalid syntax", the items before it are emitted, the rest dropped). `DC.B ''` emits nothing. After each item blanks are skipped and a `,` continues the list (`DC.B 1 , 2` is two items [ORA]); anything else ends the directive silently, because the terminator check after an expression is commented out (DIRECTIV.CPP:395-398, 410-412): text after the last item is a comment, and so is junk glued to an expression (`DC.W 5(A0)` emits `0005` without a message [ORA]). No operand at all: `SYNTAX`. |
| `DCB[.B/.W/.L] count,value` | `dcb` DIRECTIV.CPP:447-510 | Default `.W`, alignment as DC. `count` must be a backward reference; the comma must follow it directly. `count < 0` or `loc + count*size > 0x00FFFFFF`: `INV_LENGTH`. No range check on `value`. Listing never expands (`CEXflag` forced off): shows what fits, then `...`. |
| `DS[.B/.W/.L] count` | `ds` DIRECTIV.CPP:517-558 | Default `.W`, `.W`/`.L` align. Backward reference only; negative: `INV_LENGTH`. Emits nothing; `loc += count*size`. `DS.W 0` aligns. |
| `OPT opt[,opt...]` | `opt` DIRECTIV.CPP:564-630 | `CRE MEX NOMEX SEX NOSEX WAR NOWAR CEX NOCEX BIT` (first 8 characters compared, case-insensitive). No operand: `SYNTAX`. An unknown word raises `SYNTAX` but the remaining words of the list are still applied (`OPT FOO,MEX` reports the error and switches MEX on [ORA]). The list is read only while the next character is a letter or digit, so an operand that starts with anything else (`OPT ;x`, `OPT -MEX`) is ignored without a message [ORA]. Label: `LABEL_ERROR`, the options are applied all the same. Acts in both passes. |
| `INCLUDE file` | `include` DIRECTIV.CPP:638-754 | Section 3.4.1. |
| `INCBIN file` | `incbin` DIRECTIV.CPP:761-843 | Section 3.4.1. |
| `FAIL text` | `failError` DIRECTIV.CPP:850-872 | Raises `FAIL_ERROR`; the message is the rest of the (upper-cased except in quotes) line from the first non-blank character after `FAIL`, at most 254 characters, without "ERROR:" prefix; without text "ERROR: Unspecified user defined error. ". Counts as an error. Label is defined. [EXP] It is a *minor* error (0x20E): if the label on the line already produced an error of class 0x200 or higher, that message is shown instead of the text. With a size suffix (`FAIL.W text`) only "Invalid size code" is reported and nothing else happens [ORA]. |
| `LIST` / `NOLIST` | `listOn` / `listOff` DIRECTIV.CPP:878-893 | Set / clear `listFlag`. Neither line is listed itself. A label on these lines is silently ignored (not defined). Size ignored. |
| `MEMORY type start,end` | `memory` DIRECTIV.CPP:899-991 | Executed in pass 2 only. `type` = `ROM`, `READ`, `PROTECTED`, `INVALID` (case-insensitive, 10 characters). Both addresses backward references, masked with $00FFFFFF. One range per type; a later line of the same type replaces the earlier. Result: S0 records (section 6.3). Label: `LABEL_ERROR` and the directive is not executed (return at 954-955). Text after the end address is not checked. |
| `SIMHALT` | `simhalt` DIRECTIV.CPP:996-1020 | Aligns, defines the label, emits $FFFF $FFFF, `loc += 4`. **Both words are passed to `output()` before `loc` is advanced**, so the listing shows `FFFF FFFF` but the S-record gets the second word at the same address as the first (section 6.4). [EXP] |
| `PAGE` | `page` DIRECTIV.CPP:1026-1042 | Writes the marker line `<------------------------------ PAGE ------------------------------>` (asm.h:261) to the listing in pass 2 when `listFlag`; the PAGE line itself is not listed. Label: `LABEL_ERROR`. |
| `label REG list` | `reg` MOVEM.CPP:204-239, `evalList` 241-371 | Defines a register-list symbol (flag `REG_LIST_SYM`, value = MOVEM mask with bit 0 = D0 ... bit 15 = A7). List syntax: `Dn`/`An` items separated by `/`, ranges with `-` (may run from D to A registers); `SP` is not accepted inside a list; or the name of an earlier REG symbol. Label required. Naming an ordinary symbol instead of a list reports `NOT_REG_LIST` **and still defines the label, with the mask $1234** (MOVEM.CPP:350-353, 218-227) [ORA]. |
| `MOVEM` | `movem` MOVEM.CPP:67-201 | Table entry with `parseFlag` false; aligns `loc`, defines the label, then tries `list,<ea>` and, if the first operand is not a list, `<ea>,list`. Accepts an explicit list or a REG symbol on either side. A REG symbol must be defined before use: as the **second** operand a later-defined REG symbol gives `REG_LIST_UNDEF`; as the **first** operand the failed list attempt is silent (its status is a local, MOVEM.CPP:98-101), the name is then parsed as an address and the message is whatever the second operand produces (`MOVEM.L R3,(A0)` with `R3 REG` further down: "Invalid syntax") [EXP: engine/asm test "REG and MOVEM"]; an ordinary symbol as the **second** operand gives `NOT_REG_LIST` (as the first operand it is simply an absolute address, and the error reported is whatever the second operand then produces). No size or `.W`: word form; `.L`: long; `.B` / `.S`: `INV_SIZE_CODE` and the word form is still generated [ORA]. |
| `name MACRO` ... `ENDM` | `macro` MACRO.CPP:76-122 | Section 3.6. |
| `IF ELSE ENDI WHILE ENDW REPEAT UNTIL FOR ENDF DBLOOP UNLESS` | `asmStructure` STRUCTURED.CPP:271-727 | Section 3.7. |
| `IFC IFNC IFEQ IFNE IFLT IFLE IFGT IFGE ENDC` | `assemble` ASSEMBLE.CPP:386-540 | Section 3.5. |

Help disagreements: help/Directives/directives.htm says DC and DCB are the only directives that add data;
SIMHALT and INCBIN do too. help/Directives/section.htm and offset.htm agree with the source.

#### 3.4.1 INCLUDE and INCBIN: file name and path rules

Both routines parse the operand the same way (DIRECTIV.CPP:668-691 and 783-806):

1. The operand is taken from the already upper-cased line and passed through `strcap` again. Result:
   **a name in single quotes keeps its case; a name in double quotes or without quotes is upper-cased.**
2. Leading white space is skipped. A leading `"` or `'` is the quote character.
3. Quoted: the name runs to the matching quote. Unquoted: the name runs to the first **space** character
   (a tab does not end it), then trailing white space is trimmed. So `INCLUDE file.x68<TAB>comment` looks
   for a file called `FILE.X68<TAB>COMMENT`.
4. `fopen(name, "r")` (include) or `fopen(name, "rb")` (incbin), relative to the current directory = the
   folder of the main source file, **also for nested includes**. Failure: `FILE_ERROR`
   "Unable to access specified file".

Port requirements that follow: file lookup must be case-insensitive (Windows); `\` and `/` must both
work as separators and drive-letter paths must at least fail cleanly; relative names resolve against the
main file's folder.

INCLUDE behaviour (DIRECTIV.CPP:693-753):

- A size suffix: `INV_SIZE_CODE` and nothing else happens. No operand: `FILE_ERROR`.
- A label is defined with the current `loc`.
- The INCLUDE line is listed by `include()` itself before the file is opened (`listLine(line)`, without
  a macro mark), the lines of the file follow, then the line
  `-------------------- end include --------------------` (it gets a listing line number). That line is
  written without a new `listLoc()`, so its first 32 columns **repeat the address and object code of the
  last assembled line of the include file**: after a file ending in `RTS` it reads
  `00001006  4E75                      16  -------------------- end include --------------------`
  [ORA], and the simulator's `isInstruction()` test (5.6) accepts it. If the file cannot be opened the
  INCLUDE line appears twice (once from `include()`, once after the error message).
- A last line without a line end is assembled as it is (no line end is supplied); see "Unterminated
  last line" in 3.1.3.
- For the duration `inFile` is the include file, `includeFile` holds its name, `lineNum` restarts at 1;
  all three are restored afterwards. Nesting is unlimited in the code (`includeNestLevel` is counted but
  never tested); the practical limit is the number of open files / stack (UNVERIFIED on Windows).
- **Lines of an include file whose first character is `*` are skipped entirely** - not assembled, not
  listed - and so are lines whose second character is `~`
  (`if(line[0] != '*' && line[1] != '~') assemble(line, &error);`, DIRECTIV.CPP:730-732; the intent was
  to skip the `*~Font name~` footer). Indented comments and `;` comments are listed normally. [EXP]
- `END` inside the include file ends the whole assembly.
- If the include file is open in another editor window, that window's message list is cleared and
  disabled (DIRECTIV.CPP:710-719).

INCBIN behaviour (DIRECTIV.CPP:808-842): label defined at `loc` (no alignment); every byte of the file
goes straight to `outputObj(loc, byte, BYTE_SIZE)` in pass 2 when `objFlag` (it never appears in the
listing); `loc` advances by the file size in both passes. The INCBIN line is listed once.
[EXP: a 108-byte file advances `loc` by 108 and appears in the S-record.]

Help disagreement: none on syntax; the help does not mention the upper-casing or the tab rule.

### 3.5 Conditional assembly (ASSEMBLE.CPP:383-545)

| Directive | Skips the block when | Notes |
|---|---|---|
| `IFC a,b` | `stricmp(token[2], token[3]) != 0` | Case-insensitive text comparison of two tokens; missing operands are empty strings (two missing operands compare equal). |
| `IFNC a,b` | tokens equal | `token[3] == empty` (second operand missing): `INVALID_ARG`. |
| `IFEQ e` / `IFNE e` / `IFLT e` / `IFLE e` / `IFGT e` / `IFGE e` | value `!= 0` / `== 0` / `>= 0` / `> 0` / `<= 0` / `< 0` | Operand missing: `INVALID_ARG`. |
| `ENDC` | | `if (nestLevel > 0) nestLevel--; if (nestLevel == 0) skipCond = false;` |

- All are recognised only as `token[1]` (white space or a label before them); a label gives `LABEL_ERROR`
  "Label is not allowed" but the directive still acts.
- While skipping (`skipCond`), every `IFxx` just increments `nestLevel`; a true `IFxx` does not increment
  it. Skipped lines are not assembled and not listed - except comment lines, which are listed. [EXP]
- **There is no ELSE for conditional assembly.** `ELSE` is the structured-control keyword.
- Operands are tokens split at spaces and commas: an expression must not contain spaces; text operands
  with spaces need single quotes or parentheses (`<...>` does not group here: `IFNC <a b>,<a b>` compares
  `<A` with `B>` [EXP]).
- The expression is evaluated with a private error variable that is thrown away:
  `if (error2Ptr < ERRORN && value != 0) skip`. **An expression error (undefined symbol, syntax) makes
  the block assemble and reports nothing.** [EXP: `IFNE 'A'` is listed as TRUE because a character
  literal at the very end of a token is a syntax error inside `eval`.]
- A forward reference is not rejected (the help says it is): in pass 1 the value is uninitialised memory
  (hazard 9.3.3), in pass 2 the real value is used [EXP], so the two passes can disagree.
- Listing: the `IFxx` line shows `TRUE` or `FALSE` in the object field (section 5.2). The test that
  lists it (`if (printCond && !skipList)`, ASSEMBLE.CPP:554-557) does not look at `listFlag`: an `IFxx`
  that is evaluated is written to the listing **even under `NOLIST`** [ORA], then with the stale
  address of the last listed line.
- Works inside macros; `IFARG n` exists only there (section 3.6). Outside a macro `IFARG` is an unknown
  mnemonic ("Invalid opcode"), and inside a skipped block it is just a skipped line that does not count
  as an opener - its `ENDC` then closes the enclosing block.

### 3.6 Macros (MACRO.CPP)

**Definition** - `name MACRO` ... `ENDM` (`macro`, MACRO.CPP:76-122):

- The name is the label of the MACRO line and becomes an ordinary symbol with flag `MACRO_SYM` whose
  **value is the byte offset of the body in the temp file** (`macroFP = ftell(tmpFile)`, pass 1). It
  appears in the symbol table with that value [EXP: first macro 0, second `68` hex = body bytes of the
  first]. On Windows the temp file is in text mode, so each body line counts its CR LF (confirmed on
  listings from the real program, 9.4.2); a build without text-mode emulation shows smaller values for
  every macro after the first.
- Body lines are read directly from `inFile` up to a line whose `token[1]` (delimiters space, tab,
  newline; case-insensitive) is `ENDM`; they are stored verbatim in pass 1 and listed (without
  expansion marks) in pass 2 when `listFlag`. `lineNum` is advanced for each.
- A line with `token[1] == "MACRO"` inside a body, or end of file: `NO_ENDM` "ENDM expected", and the
  global `noENDM` is set, which disables the assembly of expanded macro lines for the rest of the run
  (MACRO.CPP:386).
- Duplicate macro name: "Symbol defined more than once" on the second MACRO line, and - because
  `macro()` returns before skipping the body - **the body of the duplicate is assembled as ordinary
  code** and its `ENDM` reports "Invalid opcode". [EXP]
- A macro must be defined before it is used. Used earlier, pass 1 sees "invalid opcode" and generates
  nothing, pass 2 expands it with warning `FORWARD_REF`; any label after the call then gets a phase
  error. [EXP]
- A size suffix on `MACRO`: `INV_SIZE_CODE`.
- `MACRO` without a label is not diagnosed (there is no `LABEL_REQUIRED` test): a macro symbol with an
  **empty name** is created; it shows up as a line with a blank name in the symbol table [ORA] and
  cannot be called.
- A macro name can contain `.` and `$` (label rule) but the mnemonic scan of a call stops at these
  characters (INSTLOOK.CPP:71 accepts letters, digits, `_`, `-`), so such a macro cannot be called.
- Because `macro()` reads the body through the global `line` and advances `lineNum`, a message raised
  on the `MACRO` line itself (for example `INV_SIZE_CODE`) is reported with the line number of the
  `ENDM` line and followed in the listing by the `ENDM` line.

**Call** - `[label] name[.size] arg,arg,...` (`asmMacro`, MACRO.CPP:133-404):

| Feature | Rule | file:line |
|---|---|---|
| `\0` | Size letter of the call: `B`, `W` or `L`; no suffix and `.S` give `W`. | 157-169 |
| Arguments `\1`..`\9`, `\A`..`\Z` | `\A` = 10 ... `\Z` = 35. Arguments are taken from the upper-cased line (text in single quotes keeps its case), separated by commas; **the list ends at the first white space** outside `<...>` - except that white space directly after a comma is skipped, so `M A, B` has two arguments and `M A ,B` has one [ORA]. A comma followed only by blanks is `SYNTAX`. | 188-264 |
| `<text>` | `<` switches "text mode" on and `>` switches it off; in text mode commas and blanks belong to the argument. There is **no nesting count**: the `<` that opens and the first `>` after it are dropped, a further `<` inside text mode and a `>` outside it are copied. `<1,2>` is one argument [EXP]; `<A<B>C>` gives `A<BC>`; to pass a structured condition write `<<GT>>`, which gives `<GT>` [ORA]. `<` opens text mode anywhere in an argument (`AB<C D>E` gives `ABC DE`). Single quotes do **not** protect a comma or a space. | 197-207 |
| Null argument | `<>`, or nothing between two commas, or `''`. Outside text mode every `''` pair is deleted wherever it stands in an argument, so a doubled quote inside a quoted argument is lost: `'IT''S'` arrives as `'ITS'` [ORA]. | 208-209 |
| Maximum | `MAX_ARGS` = 36 slots including `\0`, so 35 real arguments; a 36th gives `TOO_MANY_ARGS`. Each argument is cut at 256 characters. (help/Directives/macro.htm says "thirty-six parameters".) | 256-261 |
| Continuation | If a comma is the last character of the line (directly before the line end, no trailing blank), the next line is read **from `inFile`** - the source or include file, also when the call itself comes from a macro body - and must start with `&` in column 1, else `INVALID_ARG`. `lineNum` is not advanced for it (section 4.4). The call line and the `&` line are both listed. [EXP] A message already pending on the call line (for example "Label too long" for its label) is printed once before the `&` line is read and again after the expansion; it is counted once [ORA]. | 216-248 |
| `NARG` | Replaced by the decimal number of arguments (index of the last one). The test is `!strnicmp(capL, "NARG", 4) && !isalnum(capL[4])` at **every character position** of a body line, so it also fires inside longer words that end in `NARG` (`MYNARG` -> `MY1`) and inside comments. 0 when the operand field is empty. | 329-334 |
| Trailing comment on a call | The first word of a comment after a macro name without arguments is taken as argument 1 (`M  this is a comment` has `NARG` = 1 and `\1` = `THIS`). [EXP] | 189-197 |
| `\@` | Replaced by `_` followed by `labelNum` in decimal; `labelNum` is incremented once per macro call (nested calls too) and reset to 0 at the start of each pass. [EXP `L\@` -> `L_1`, `L_2`, `L_5` ...] | 275-276, 303-309 |
| Substitution scope | Everywhere on the line including inside quoted strings and trailing comments; not on lines whose first non-blank character is `*`, and not while a conditional block is being skipped. `\` + lower-case letter (possible only inside quotes) or + other character: `INVALID_ARG` / `SYNTAX`. | 287-343 |
| Expanded text | Built from the upper-cased body line, so expansions are listed in upper case (except quoted text). | 279-349 |
| Label on the call | Defined with the current `loc` without alignment. | 185-186 |
| `ENDM` | Ends the expansion (must be `token[1]`). | 357-362 |
| `MEXIT` | Ends the expansion when not inside a skipped block. | 357-362 |
| `IFARG n` | `n` is an expression (1..35). If argument `n` is empty the block is skipped until `ENDC`. `n` outside 1..35 or not evaluable: `INVALID_ARG`. Only recognised inside a macro, and from the body line **before** substitution (`IFARG \1` never works as intended). It is evaluated even inside a block that is already being skipped: if argument `n` is missing it nests correctly (`nestLevel++`), but if the argument **is present** it does not increase `nestLevel`, so its own `ENDC` then ends the enclosing skipped block early [ORA: `IFEQ 1` / `IFARG 1` / `ENDC` / `DC.B 2` / `ENDC` with argument 1 given assembles the `DC.B 2`]. The `IFARG` line is listed with `TRUE`/`FALSE` even inside a skipped block. `INVALID_ARG` and a label error are attached to the macro **call** line (reported after the expansion), an expression error to the `IFARG` line. (help says "n = 0-9, A-Z"; the code evaluates an expression, so `IFARG A` looks up a symbol `A`.) | 365-384 |
| Nesting | A macro may call macros; limit `MACRO_NEST_LIMIT` = 256 levels, then `MACRO_NEST` "Nested Macro calls are too many levels deep" (once) [EXP with a 32 MB stack]. Each level needs about 11.6 KB of stack (hazard 9.3.7). | 172-177 |
| Macro definitions inside macros | Not supported: `macro()` reads the body from the main input file. | 104 |
| Structured statements and conditionals in macros | Supported (each expanded line goes through `assemble()`). | 386-387 |
| Listing | The call line is listed first, with an `m` mark (a nested call only when its own line is being listed, i.e. with `MEXflag`); expanded lines only when `MEXflag` (plus lines with messages, plus comment lines of the body, which are always listed). After the expansion the call line is not listed again - unless the call line itself carries a message (`FORWARD_REF`, a label error, `LABEL_ERROR` from a labelled `ENDM`/`MEXIT`/`IFARG`, `INVALID_ARG` from `IFARG`): then the message is followed by one more listing line that shows **the last expanded line** (normally the `ENDM` text, without mark), because the global `line` no longer holds the call [ORA]. | 266-269, 350-351, 402 |
| `ENDM` inside a skipped block | `ENDM` ends the expansion even while a conditional block is being skipped (`MEXIT` does not); `skipCond` and `nestLevel` then stay set, and the lines after the macro call are skipped up to the next `ENDC`. | 357-362 |

Null-argument test idiom from the help (`IFC '\1',''`) works because `tokenize` turns `''` into an empty
token (ASSEMBLE.CPP:848-851).

### 3.7 Structured control (STRUCTURED.CPP)

The statement line is tokenised with delimiters `". \t\n"` (dot kept at the start of the next token).
Every part must be separated by spaces; operands are single tokens (parentheses keep `(4,A0)` together).
The routine generates text lines (labels, `CMP`, `Bcc`, `MOVE`, `ADD`, `SUB`, `DBcc`) and feeds each to
`assemble()` through `assembleStc()` (STRUCTURED.CPP:729-744).

Consequences of working on tokens of the whole line (STRUCTURED.CPP:290-306):

- `createCode` finds the keyword by the normal mnemonic rules, but `asmStructure` then requires it to
  be **`token[1]`**. That holds for a statement that is indented or preceded by a label in column 1
  followed by white space. If it does not hold - an indented `LBL: IF ...`, `LBL:IF ...` without a
  blank, a label that contains a dot - no branch of the routine matches: **nothing is generated, no
  message appears**, and the line is listed twice. [ORA for the indented `LBL: IF` form; the label
  itself is still defined]
- A `.` outside parentheses and quotes always starts a new token. `IF D0 <EQ> VAR.L THEN` compares with
  `VAR` and drops the `.L` (the generated line is `CMP.W VAR,D0`) [ORA]; `#.LOCAL` is split into `#`
  and `.LOCAL`.
- The size is recognised as "the token after the keyword starts with a dot". A local label as first
  operand (`IF .LEN <EQ> D0 THEN`) is therefore taken as the size - `.L...` as long, anything else is
  `SYNTAX` - and the remaining tokens are read one position off. [ORA: no message, a lone `Bcc` is
  generated]
- The words of a trailing comment are tokens too: `THEN`/`DO` is searched in tokens 3..11 and the token
  after it is taken as the extent if it starts with a dot.
- "Register" in the operand rules below means only "first character `D` or `A`, second character
  `0`-`7`" (STRUCTURED.CPP:186-187, 193-194): a symbol such as `D1COUNT` is treated as a register
  operand, and `SP` is not.

Generated labels are `_` + 8 **upper-case** hex digits (`AnsiString::IntToHex(n, 8)`): IF `_0000000n`,
WHILE `_1000000n`, FOR `_2000000n`, REPEAT `_3000000n`, DBLOOP `_4000000n`, each family counted from 0
in each pass (ASSEMBLE.CPP:301-305). They are ordinary symbols (they appear in the symbol table and end
local-label scopes). User labels of that shape collide.

| Construct | Generated code | file:line |
|---|---|---|
| `IF[.s] expr THEN[.x]` | `CMP`+`Bcc` to the else/end label with the **inverse** condition. `THEN` missing among tokens 3..11: warning `THEN_EXPECTED` (code is still generated). | 310-357 |
| `ELSE[.x]` | `BRA[.x] new`, then the IF's label. | 360-386 |
| `ENDI` | The pending label. | 389-397 |
| `WHILE[.s] expr DO[.x]` | Loop label, test as IF. `WHILE <T> DO` generates no test (infinite loop). `DO` missing: warning `DO_EXPECTED`. | 402-455 |
| `ENDW` | `BRA` loop label (no size: short when in range), exit label. | 458-470 |
| `REPEAT` | Loop label. | 473-480 |
| `UNTIL[.s] expr [DO[.x]]` | Test, branch back while false. The help calls `DO` optional, but without it the warning `DO_EXPECTED` is raised [EXP]. | 484-539 |
| `FOR[.s] op1 = op2 TO/DOWNTO op3 [BY op4] DO[.x]` | `MOVE.s op2,op1` (omitted when the two operand texts are equal), `BRA[.x]` to the test, body label; at `ENDF`: `ADD.s`/`SUB.s` `op4`-or-`#1`,op1; test label; `CMP.s op3,op1`; `BLE[.x]` (TO) / `BGE[.x]` (DOWNTO) back - the extent given after `DO` is used for both branches [ORA: `DO.S` gives `BRA.S` and `BLE.S`]. Signed comparison. Size default `.W`. The `=` is not checked (any token in that position is accepted) and any word other than `DOWNTO` in the fourth position counts as `TO`. | 543-618 |
| `ENDF` | See above; uses three strings pushed on `forStack`. | 621-643 |
| `DBLOOP Dn = op` | `MOVE op,Dn` (word, no size suffix; omitted when texts are equal), loop label. The register digit is checked as `'0'..'9'` (not 0..7). | 647-662 |
| `UNLESS[.s] [expr]` | No expression or `<F>`: `DBRA Dn,label`; otherwise `CMP` + `DBcc Dn,label` where the mnemonic is `D` + the branch that `IF` would use, i.e. the inverse of the written condition ([EXP] `UNLESS.B D0 <EQ> #3` -> `CMP.B #3,D0`, `DBNE D4,_40000001`); compound expressions are not supported. | 666-722 |

Expressions (`outCmpBcc`, STRUCTURED.CPP:132-211; table `BccCodes`, 75-99):

- `<cc>` alone: one branch. Conditions: `GT GE LT LE EQ NE HI HS CC LO CS LS MI PL VC VS`
  (plus `<T>` for WHILE and `<F>` for UNLESS). An unknown code produces the text `B??`, which then
  fails as "Invalid syntax" on the generated line [EXP].
- `op1 <cc> op2`: `CMP` with the operands ordered so that the instruction is legal: if either side
  starts with `#` it becomes the source; else if `op1` is `Dn`/`An` then `CMP op2,op1`; else if `op2` is
  a register `CMP op1,op2`; else if `op1` looks like `(An)+` then `CMP op1,op2` (assembles as CMPM);
  anything else `SYNTAX`.
- Size: `.B`, `.W`, `.L` after the keyword (and after `AND` / `OR` for the second comparison);
  default `.W`.
- Compound: `expr AND expr`, `expr OR expr` (one operator only). With `OR` the first branch is always
  `.S`; with `AND` both branch to the false label.
- Extent `.S` / `.L` after `THEN` / `DO` / `ELSE` selects short or word branches; no extent leaves the
  size to the assembler (forward branches become word-sized).

Errors:

- `ELSE`/`ENDI` after something that is not an IF: `NO_IF`; `ENDW`: `NO_WHILE`; `UNTIL`: `NO_REPEAT`;
  `ENDF`: `NO_FOR`; `UNLESS`: `NO_DBLOOP` (the popped label's top nibble is compared with the family).
- After `NO_IF` / `NO_WHILE` / `NO_REPEAT` / `NO_DBLOOP` the routine carries on and still generates its
  lines from the mismatched entry (it has already been popped); only `ENDF` generates nothing after
  `NO_FOR`, and it leaves the three strings of the open `FOR` on `forStack`.
- A terminator with **nothing** on the stack calls `stcStack.top()` on an empty stack: undefined
  behaviour, intended to end in the routine's `catch(...)` which reports `SYNTAX` (hazard 9.3.6).
  "Nothing on the stack" is rarer than it looks in pass 2, because openers left unclosed in pass 1
  are still stacked (section 1.3). `ENDW` pops **two** entries (exit label and loop label), so an
  `ENDW` that meets a single entry of another family - `IF ... ENDW` - raises `NO_WHILE` and then runs
  into the same empty-stack case (already in pass 1). [ORA: the native MSVC build of the CLI port
  crashes on exactly this source.]
- An opener that is never closed is not diagnosed as such: the forward branch refers to a label that is
  never defined, so pass 2 reports **"Undefined symbol"** on the generated branch
  [EXP for IF, WHILE, FOR]. The messages "IF without ENDI", "WHILE without ENDW", "FOR without ENDF",
  "UNTIL without REPEAT" exist in ERROR.CPP but can no longer be produced: `evalNumber` tests the symbol
  name for the prefixes `.0`..`.3` (EVAL.CPP:338-346), a leftover from when the generated labels started
  with a dot. `REPEAT` without `UNTIL` and `DBLOOP` without `UNLESS` are silent.
- Any label on a structured statement is defined at `loc` (STRUCTURED.CPP:287-288).

Listing: the statement line is listed first (by `asmStructure` itself), then, if `SEXflag`, each
generated line with an `s` mark. Statement lines carrying a message are listed a second time by
`assemble()` (with whatever is left in the object field, e.g. the last generated branch) [EXP].

Help disagreements: help/StrucControl/ExSyntax.htm shows labels as `.00000000`; the code generates
`_00000000` (Introduction.htm is correct).

### 3.8 Extensions and quirks relative to stock 68000 syntax

These live in the reused code; they are listed so that tests pin them down.

| Item | Behaviour | file:line |
|---|---|---|
| Automatic MOVEQ | `MOVE.L #n,Dn` with a backward-known `n` in -128..127 assembles as MOVEQ [EXP `7005`]. | BUILD.CPP:68-74 |
| Automatic ADDQ/SUBQ | `ADD`/`SUB`/`ADDI`/`SUBI #n,<ea>` and `ADDA`/`SUBA #n,An` with a backward-known `n` in 1..8 assemble as ADDQ/SUBQ [EXP]. | BUILD.CPP:177-197, 308-320 |
| `#n.L` | A `.L` directly after an immediate expression suppresses both optimisations [EXP `MOVE.L #5.L,D0` -> 203C 00000005]. Any other suffix is left unread and trips the next check: `#5.W,D0` and `LABEL.B,D0` are "Comma expected" [ORA]. | OPPARSE.CPP:98-104, 412-428 |
| `ADD` / `SUB` `#n,Dn` | The flavor lists of `ADD` and `SUB` try "immediate to data-alterable" (`immedInst`) before "`<ea>` to `Dn`", so `ADD.W #100,D0` is encoded as ADDI (`0640 0064`), not as ADD (`D07C 0064`) [ORA], and `SUB #n,Dn` as SUBI. `AND`, `OR` and `CMP` have the opposite order: with a `Dn` destination they keep their own opcode and become ANDI / ORI / CMPI only for a memory destination. Listed because other assemblers choose differently. | INSTTABL.CPP:113-120, 665-672, 140-146, 530-536, 306-312 |
| `MOVEQ` range | Accepts -128..255 without error. | BUILD.CPP:607-609 |
| Branch sizing | `.S` or `.B` = 8-bit, `.W` or `.L` = 16-bit; no suffix: 8-bit only for a backward reference in range and non-zero, otherwise 16-bit. A short branch to the next instruction is an error. | BUILD.CPP:562-593 |
| Absolute addresses | No suffix: short if the value is a backward reference within -32768..32767 (so `$FFFF8000` is short), else long. `expr.L` forces long, `expr.W` forces short with warning `FORCING_SHORT`. | OPPARSE.CPP:412-429 |
| Address-mode spellings | `(An)`, `(An)+`, `-(An)`, `d(An)`, `(d,An)`, `d(An,Xn[.W/.L])`, `(d,An,Xn)`, `(An,Xn)`, `d(PC)`, `(d,PC)`, `d(PC,Xn)`, `(d,PC,Xn)`, `(PC,Xn)`, `(PC)`; `SP` = A7; `SR`, `CCR`, `USP`; `SFC`, `DFC`, `VBR` are parsed but no instruction accepts them. | OPPARSE.CPP |
| **5.16 regressions in `(d,An)`** | See section 8.3: `(d,An)` and `(d,An,Xn)` are "Invalid syntax" when the displacement text starts with `P` or has `C` as its second character (`($C,A0)`, `(PTR,A0)`, `(SCORE,A0)`); `(d,PC,Xn)` ignores `d` and always assembles displacement $FE ($FC in `BTST #n,(d,PC,Xn)`). `d(An)` / `d(PC,Xn)` are unaffected. | OPPARSE.CPP:195, 272 |
| Parenthesised absolute address | An operand that starts with `(` and is meant as an expression - `(TABLE+4)`, `(LABEL)` - is "Invalid syntax" whenever the **first comma in the rest of the line** (the operand separator, or even a comma in the trailing comment) is directly followed by `An` or `SP`: `opParse` then takes it for `(d,An)`, strips the `(`, evaluates up to the `)` and fails. `MOVE.L (TABLE+4),D0` and `MOVE.L D0,(TABLE+4)` assemble; `MOVE.L (TABLE+4),A0`, `LEA (TABLE),A1` and `MOVE.W D0,(TABLE) ; x,A0` do not. Same in 5.15.4. [ORA] | OPPARSE.CPP:195-203 |
| Index register | Only `Dn` / `An` with optional `.W` / `.L` (default word); `SP` is not accepted as an index. After `.W` / `.L` the closing `)` is assumed, not checked (`return p+9`). | OPPARSE.CPP:153-181, 217-242 |
| White space in operands | Allowed only inside a parenthesis group that starts at the first or second character of the operand (section 3.3). | OPPARSE.CPP:68-91 |
| Bit-field instructions | 68020 `BFCHG BFCLR BFEXTS BFEXTU BFFFO BFINS BFSET BFTST <ea>{offset:width}`; offset 0..31 or `Dn`, width 1..32 or `Dn`, optional `#`; spaces allowed after `{` and around `:` but not before `}`. | ASSEMBLE.CPP:634-667, 716-789; BUILD.CPP:253-284 |
| Condition aliases | `BHS`=`BCC`, `BLO`=`BCS`, `DBRA`=`DBF`, `DBHS`, `DBLO`, `SHS`, `SLO`. | INSTTABL.CPP:760-762, 787-789, 873-876 |
| `SIMHALT` | $FFFF $FFFF. | DIRECTIV.CPP:996 |
| Sign-extension of high characters | See 3.3. | EVAL.CPP:282-290, DIRECTIV.CPP:377-383 |
| Duplicate identical definitions accepted | See 3.1.3. | SYMBOL.CPP:253 |

### 3.9 Test checklist (minimum)

Line syntax: label in column 1 / indented with colon / alone on a line at an odd address; opcode in
column 1; 32-, 33- and 40-character labels; `.`, `_`, `$` in labels; illegal first character; local
labels across EQU, SET, macro definition, macro call, structured statement; duplicate labels with equal
and different values; phase error; comment forms; line of 255, 256 and 300 characters; tabs versus
spaces; lower / mixed case; CR LF and LF input; last line without newline; bytes >= $80 in strings,
comments and labels.

Expressions: each operand form, each operator, precedence pairs across all four levels, unary chains,
3-, 4- and 5-character constants, 9-digit hex, `*` in instructions / DC / EQU / ORG, division by zero,
space inside an expression, forward references in every directive that forbids them.

Directives: every row of 3.4 with and without label, with a size suffix, with a missing operand, with a
forward reference; DC strings versus constants including the space-after-comma case; odd `loc` before
DC.B / DC.W / DS / instruction / SIMHALT / INCBIN / label; OFFSET ... ORG * round trip; SECTION
switching and section labels; MEMORY for all four types and its S0 records; OPT each word and its
pass-1 leakage; LIST / NOLIST including a file ending in NOLIST; PAGE; FAIL with and without text;
INCLUDE (quoted, unquoted, missing file, nested, `*` comment lines, error inside, END inside);
INCBIN (odd length, missing file); END with / without operand, with a label, missing, in column 1.

Conditionals: each IFxx true and false, nesting three deep, label on IFxx, missing operand, missing
ENDC, comment lines inside a skipped block, undefined symbol in the expression.

Macros: `\0` for each size; `\1`..`\9`, `\A`; `<...>`; `''`; 35 and 36 arguments; continuation line;
`\@` in nested calls; NARG including inside a comment; IFARG; MEXIT; nested macro; recursion to the
limit; forward use; duplicate definition; missing ENDM; `%` binary constants and `%d` in a body line
(hazard 9.3.4); a body line that expands beyond 255 characters; structured code inside a macro; label on
the call; trailing comment on a call without arguments.

Structured: every row of 3.7 with `.B/.W/.L`, `.S/.L`, AND, OR, `<cc>` only, immediate on either side,
`(An)+` pair, `<T>`, `<F>`, missing THEN / DO, mismatched terminators, terminator with empty stack,
unterminated opener, more than 9 structures of one kind (hex label digits), SEX on and off.

Outputs: listing column layout, continuation lines, `...`, symbol table order, S-record types S1/S2/S3,
record splitting, S0 map records, S8, SIMHALT overlap; options in all combinations; error and warning
counts; message list line numbers with include files and macro continuation lines.

Quirks that are easy to "fix" by accident and therefore need a pinned test each: an undefined symbol
followed by `+`, `-`, `*` and inside parentheses (3.3, error protocol); a label on a line with an
invalid mnemonic and a later reference to it; a local label whose mangled name reaches 33 characters;
`(expr),An` versus `(expr),Dn`; the 5.16.1 `(d,An)` / `(d,PC,Xn)` cases of 8.3 including
`JMP (TABLE,PC,D0.W)` and `BTST #n,(d,PC,Xn)`; `END ; comment`, `END * comment`, `END` with a label;
`OFFSET` and `MEMORY` with a label; `OPT` with an unknown word in a list; `FAIL.W`; `IFC A ,A`;
`IFxx` under `NOLIST`; macro arguments `A, B` / `A ,B` / `<A<B>C>` / `<<GT>>` / `'IT''S'`; `IFARG`
inside a false `IFxx` with the argument present and absent; a warning on a macro call line (what is
listed after the message); `MACRO` without label; an indented `LBL: IF ...`; `IF D0 <EQ> VAR.L THEN`;
an INCLUDE file whose last line is a bare label without line end and one that ends in an instruction
(object code on the "end include" line); a source with an unclosed `IF` (stack state in pass 2).

---

## 4. Errors and warnings

### 4.1 Codes and severity

A status is a 12-bit code whose high nibble is the class (asm.h:42-116): `0x1xx` warning, `0x2xx` minor
error, `0x3xx` error, `0x4xx` severe error, `0x999` exception. Every routine reports through

```cpp
#define NEWERROR(var, code)      var = ((code & SEVERITY) > var) ? code : var     // asm.h:124
```

i.e. a new code replaces the current one only if its **class** value (0x100, 0x200, ...) is greater than
the whole current code. Within a class the first code wins; a higher class always replaces a lower one.
One `int error` exists per call of `assemble()`, so each assembled line (source line, include line,
expanded macro line, generated structured line) reports at most one message.

Tests used in the code: `> SEVERE` (0x400) aborts the line; `< ERRORN` (0x300) means "usable value";
`> MINOR` (0x200) counts as an error; `> WARNING` (0x100) and not an error counts as a warning.

### 4.2 From a code to what the user sees

Only in pass 2, at the end of `assemble()` (ASSEMBLE.CPP:548-553):
`errorCount++` or `warningCount++`, then `printError(listFile, code, lineNum)` (ERROR.CPP:45-291):

1. `OK`: return. Warning while `WARflag == false`: return (already counted).
2. `numBuf = "Line %d "` with **`lineNumL68`**, the number the next listing line will get (ERROR.CPP:53-54).
3. The message text is formatted into the global `buffer` (two `switch` statements, ERROR.CPP:59-238);
   for `FAIL_ERROR` and `EXCEPTION` the text is already in `buffer`.
4. `listError(numBuf, buffer)` appends `Line N <message>\n` to the .L68 if one was created
   (ERROR.CPP:240-241, LISTING.CPP:206-213) - also under `NOLIST`.
5. GUI part (ERROR.CPP:243-288):
   - If `includeFile[0] != 0` (the line comes from an include file): look for an editor window showing
     that file (case-insensitive compare of expanded names). If found and modified, show once per run
     "An Error occurred in the included file <name>.\nThe file is currently open and has been
     modified.\nThe line numbers of errors may not be correct." and bring the window to the front; if
     not found, `Main->OpenFile(incFile)` opens it.
   - `Active = Main->ActiveMDIChild` (after the step above this is the include file's window),
     enable its message list (a report-style list with the columns `Line ` and `Error Message`,
     textS.dfm:97-124), make it at least 87 pixels high, add a row:
     column 1 = **`lineNum`** (source line number, as text), column 2 = message without its trailing
     newline, hidden third sub-item = `Active->Project.CurrentFile`. The newline is removed by cutting
     the **last character** unconditionally (`buffer[strlen(buffer)-1] = '\0'`, ERROR.CPP:286): a
     `FAIL` text taken from a line without line end (last line of an include file, or the first 255
     characters of an over-long line) loses its last character in the list, not in the listing.
6. Double-clicking a row selects line `Caption - 1` in that window (textS.cpp:719-738).

Consequence for the new UI: a message is the triple (file, line, text) where file is
`includeFile` if non-empty else the main file, line is `lineNum`, text is `buffer` minus the final
`\n`. The original shows messages of an include file in that file's own window and, because the
include window stays active, also puts later main-file messages there (a GUI artefact, not worth
copying; the file attribution rule above is what matters).

After the run (section 1.2): the list is shrunk to 7 pixels if there were no errors and no warnings;
the modal "Assembler Status - <file name>" dialog shows "Warnings:" `warningCount` and "Errors:"
`errorCount` (assembleS.dfm:45-116) with buttons Execute (enabled iff `errorCount == 0`), Load L68,
Close.

The listing ends with (LISTING.CPP:260-273):

```
<blank line>
No errors detected            or   1 error detected   /   N errors detected
No warnings generated         or   1 warning generated /   N warnings generated
```

Counts: one per line that ended with a code of that class; suppressed warnings are included;
`END_MISSING` adds one warning; pass-1 problems count only if they recur in pass 2. Two kinds of
message are shown without being counted: the `printError(NULL, EXCEPTION, 0)` calls that some
`catch(...)` handlers make directly (second group in the `EXCEPTION` row of 4.3: a list row with line
0, in either pass, nothing in the listing), and the early copy of a message on a macro call line that
continues on a `&` line (section 3.6). An exception caught by `assemble()` itself is neither shown nor
counted (section 1.4).

### 4.3 Message texts

Texts are exactly as below (no trailing period; the help file adds periods to several and calls
`PHASE_ERROR` "Address or value of symbol has changed during assembly" in help/Directives/macro.htm -
the source wins). In the listing each is preceded by `Line N ` and followed by a newline.

| Code | Hex | Text | Raised at |
|---|---|---|---|
| `ASCII_TOO_BIG` | 101 | `WARNING: ASCII constant exceeds 4 characters` | EVAL.CPP:301 |
| `NUMBER_TOO_BIG` | 102 | `WARNING: Numeric constant exceeds 32 bits` | EVAL.CPP:235, 266 |
| `INCOMPLETE` | 103 | `WARNING: Evaluation of expression could not be completed` | pass 1 only (EVAL.CPP:142, 351); never displayed |
| `FORCING_SHORT` | 104 | `WARNING: Forcing SHORT addressing disables range checking of extension word` | OPPARSE.CPP:421 |
| `ODD_ADDRESS` | 105 | `WARNING: Origin value is odd (Location counter set to next highest address)` | DIRECTIV.CPP:113, 239 |
| `END_MISSING` | 106 | `WARNING: END directive missing, starting address not set` | ASSEMBLE.CPP:337 |
| `ADDRESS_MISSING` | 107 | `WARNING: Address expected` | DIRECTIV.CPP:225 |
| `THEN_EXPECTED` | 108 | `WARNING: THEN expected` | STRUCTURED.CPP:320 |
| `DO_EXPECTED` | 109 | `WARNING: DO expected` | STRUCTURED.CPP:418, 500, 554 |
| `FORWARD_REF` | 10A | `WARNING: Forward reference may cause 'Symbol value differs...' error` | INSTLOOK.CPP:130 |
| `LABEL_TOO_LONG` | 10B | `WARNING: Label too long` | ASSEMBLE.CPP:595, SYMBOL.CPP:121 |
| other 1xx | | `WARNING: No message defined` | unreachable |
| `INV_SIZE_CODE` | 201 | `ERROR: Invalid size code` | INSTLOOK.CPP:85, ASSEMBLE.CPP:801, most directives |
| `INV_QUICK_CONST` | 202 | `ERROR: Quick immediate data range must be 1 to 8` | BUILD.CPP:348 |
| `INV_MOVE_QUICK_CONST` | 203 | `ERROR: Quick immediate data range exceeds 1 byte` | BUILD.CPP:609 |
| `INV_VECTOR_NUM` | 204 | `ERROR: Invalid vector number` | BUILD.CPP:543 |
| `INV_BRANCH_DISP` | 205 | `ERROR: Branch instruction displacement is out of range or invalid` | BUILD.CPP:579, 586, 700 |
| `INV_DISP` | 206 | `ERROR: Displacement out of range` | CODEGEN.CPP:145, 157 |
| `INV_ABS_ADDRESS` | 207 | `ERROR: Absolute address exceeds 16 bits` | CODEGEN.CPP:165 (not reachable in practice) |
| `INV_8_BIT_DATA` | 208 | `ERROR: Immediate data exceeds 8 bits` | BUILD.CPP:636, CODEGEN.CPP:191, DIRECTIV.CPP:403 |
| `INV_16_BIT_DATA` | 209 | `ERROR: Immediate data exceeds 16 bits` | BUILD.CPP:666, 880, CODEGEN.CPP:181, DIRECTIV.CPP:406 |
| `NOT_REG_LIST` | 20A | `ERROR: Symbol is not a register list symbol` | MOVEM.CPP:351 |
| `REG_LIST_SPEC` | 20B | `ERROR: Register list symbol used in an expression` | EVAL.CPP:333 |
| `INV_SHIFT_COUNT` | 20C | `ERROR: Invalid constant shift count` | BUILD.CPP:754 |
| `INV_OPERATOR` | 20D | `ERROR: Invalid operator` | EVAL.CPP:429 (unreachable) |
| `FAIL_ERROR` | 20E | the FAIL text, or `ERROR: Unspecified user defined error. ` | DIRECTIV.CPP:861-867 |
| `UNDEFINED` | 301 | `ERROR: Undefined symbol` | EVAL.CPP:347, MOVEM.CPP:341, SYMBOL.CPP:164, 171. Also the message for a reference to a label whose own line had a rejected mnemonic (1.5), to a local label that is too long (3.1.3) and to an unclosed structure's label (3.7). When the undefined name is followed by an operator the line shows "Invalid syntax" or "Comma expected" instead (3.3) |
| `DIV_BY_ZERO` | 302 | `ERROR: Division by zero attempted` | EVAL.CPP:420, 427 |
| `MULTIPLE_DEFS` | 303 | `ERROR: Symbol defined more than once` | SYMBOL.CPP:144, 255, MACRO.CPP:95 |
| `REG_MULT_DEFS` | 304 | (no case: `ERROR: No message defined`) | never raised |
| `REG_LIST_UNDEF` | 305 | `ERROR: Register list symbol not previously defined` | MOVEM.CPP:345 |
| `INV_FORWARD_REF` | 306 | `ERROR: Forward references not allowed with this directive` | DIRECTIV.CPP:107, 148, 189, 233, 271, 476, 542, 951, 966; ASSEMBLE.CPP:744, 774 |
| `INV_LENGTH` | 307 | `ERROR: Invalid block length` | DIRECTIV.CPP:486, 552 |
| `SYNTAX` | 401 | `ERROR: Invalid syntax` | many (ASSEMBLE, DIRECTIV, EVAL, INSTLOOK, MACRO, MOVEM, OPPARSE, STRUCTURED) |
| `INV_OPCODE` | 402 | `ERROR: Invalid opcode` | INSTLOOK.CPP:117, 137; DIRECTIV.CPP:582, 922 (both unreachable: the operand pointer is already at a non-blank character and the empty case returned `SYNTAX` just before) |
| `INV_ADDR_MODE` | 403 | `ERROR: Invalid addressing mode` | ASSEMBLE.CPP:703, MOVEM.CPP:142, 184 |
| `LABEL_REQUIRED` | 404 | `ERROR: Label required with this directive` | DIRECTIV.CPP:164, 276, 317, MOVEM.CPP:220 |
| `NO_ENDM` | 405 | `ERROR: ENDM expected` | MACRO.CPP:110, 119 |
| `TOO_MANY_ARGS` | 406 | `ERROR: Too many arguments` | MACRO.CPP:258 |
| `INVALID_ARG` | 407 | `ERROR: Invalid argument` | ASSEMBLE.CPP:407-520, MACRO.CPP:231, 243, 317, 324, 369, 379 |
| `COMMA_EXPECTED` | 408 | `ERROR: Comma expected` | ASSEMBLE.CPP:647, MOVEM.CPP:105, 157 |
| `PHASE_ERROR` | 409 | `ERROR: Symbol value differs between first and second pass` | SYMBOL.CPP:257 |
| `FILE_ERROR` | 40A | `ERROR: Unable to access specified file` | DIRECTIV.CPP:660, 700, 775, 815 |
| `MACRO_NEST` | 40B | `ERROR: Nested Macro calls are too many levels deep` | MACRO.CPP:174 |
| `NO_IF` | 40C | `ERROR: No matching IF statement was found` | STRUCTURED.CPP:364, 393 |
| `NO_WHILE` | 40D | `ERROR: No matching WHILE statement was found` | STRUCTURED.CPP:462 |
| `NO_REPEAT` | 40E | `ERROR: No matching REPEAT statement was found` | STRUCTURED.CPP:488 |
| `NO_FOR` | 40F | `ERROR: No matching FOR statement was found` | STRUCTURED.CPP:625 |
| `ENDI_EXPECTED` | 410 | `ERROR: IF without ENDI` | EVAL.CPP:339 (dead, section 3.7) |
| `ENDW_EXPECTED` | 411 | `ERROR: WHILE without ENDW` | EVAL.CPP:341 (dead) |
| `ENDF_EXPECTED` | 412 | `ERROR: FOR without ENDF` | EVAL.CPP:343 (dead) |
| `REPEAT_EXPECTED` | 413 | `ERROR: UNTIL without REPEAT` | EVAL.CPP:345 (dead) |
| `LABEL_ERROR` | 414 | `ERROR: Label is not allowed` | ASSEMBLE.CPP:388-534, DIRECTIV.CPP:185, 229, 578, 918, 1032, MACRO.CPP:360, 367 |
| `NO_DBLOOP` | 415 | `ERROR: No matching DBLOOP statement was found` | STRUCTURED.CPP:670 |
| `DBLOOP_EXPECTED` | 416 | `ERROR: UNLESS without DBLOOP` | never raised |
| `BAD_BITFIELD` | 417 | `ERROR: Invalid bitfield` | ASSEMBLE.CPP:661, 724-784 |
| `ILLEGAL_SYMBOL` | 418 | `ERROR: Illegal symbol` | ASSEMBLE.CPP:585 |
| `EXCEPTION` | 999 | `ERROR: An exception occurred in routine '<name>'. ` (note the space before the newline) | every `catch(...)` except the two in STRUCTURED.CPP (which report `SYNTAX`). Group 1 - the handler stores the code in the line's error variable, so it is counted and listed like any other error of that line: eval, evalNumber, instLookup, opParse, lookup, movem, reg, evalList (and assemble, whose caller then drops it). Group 2 - the handler calls `printError(NULL, EXCEPTION, 0)` itself: assembleFile, strcap, skipSpace, processFile, include, incbin, initList, listLine, finishList, outputObj (text says 'initObj', OBJECT.CPP:226), writeObj, writeMap, finishObj, clearSymbols |
| other > 0x200 | | `ERROR: No message defined` | |

The help page help/errors.htm does not list "Label too long", "Illegal symbol", "No message defined" or
the exception message.

Messages shown in message boxes instead of the list (not counted): "Error creating temp file.",
"Error reading source file." (ASSEMBLE.CPP:165-172), "Unable to create listing file", "Error writing to
listing file", "LISTOBJ: INVALID SIZE CODE!" (LISTING.CPP:98, 164, 246), "Unable to create S-Record
file", "outputObj: INVALID SIZE CODE!", "Error writing to object file" (OBJECT.CPP:134, 218, 125),
"INVALID EFFECTIVE ADDRESSING MODE!" followed by `exit(0)` (CODEGEN.CPP:119-121, unreachable for valid
tables) and the same text without exit (CODEGEN.CPP:202-204).

### 4.4 Line numbers

Two counters exist and they are different things:

- **`lineNum`** (message list, column "Line"): physical line of the file currently being read.
  - Starts at 1 in each pass; `processFile` increments it after each line (ASSEMBLE.CPP:328).
  - `macro()` increments it for every body line it consumes (MACRO.CPP:107), so lines after a macro
    definition keep their true numbers. A message raised on the `MACRO` line itself is reported after
    the body has been consumed and so carries the number of the `ENDM` line (for "ENDM expected" at
    end of file: the number of the last line of the file). The duplicate-name error returns before the body is read and
    keeps the number of the `MACRO` line.
  - Lines of an include file that are skipped because they start with `*` or have `~` as second
    character (3.4.1) are still counted.
  - **Expanded macro lines do not change it**: a message from inside an expansion carries the line
    number of the outermost macro call.
  - **A macro-argument continuation line (`&`) is read without incrementing it** (MACRO.CPP:230), so
    every later message of that file is one too low per continuation line. [EXP: an error on source
    line 23 was reported as line 22.]
  - Generated structured lines report the line of the structured statement.
  - `include()` saves it, restarts at 1 for the include file, and restores it (DIRECTIV.CPP:707, 724,
    738). Messages from an include file carry that file's line number and `includeFile` names the file.
  - A line longer than 255 characters counts as two or more lines (section 1.3).
  - `END_MISSING` is reported with `lineNum` after the loop = number of lines read + 1.
- **`lineNumL68`** (listing, the `Line N` prefix and the number column): counts lines written by
  `listLine()` (LISTING.CPP:168) - every listed source line, expanded line, generated line, continuation
  line of long data, the `end include` line and the `*[sim68k]bitfield` marker. Message lines and the
  PAGE marker are not numbered. With no macros, includes, structured code, long data or NOLIST the two
  counters coincide.

---

## 5. Listing file (.L68)

Written by LISTING.CPP through `listFile`. Text mode: on Windows every `\n` is stored as CR LF.

### 5.1 Header (initList, LISTING.CPP:92-120; patched by finishList, 279-283)

```
XXXXXXXX Starting Address                              <- physical line 1
Assembler used: EASy68K Editor/Assembler v5.16.01      <- "Assembler used: %s", TITLE (asm.h:35)
Created On: 3/15/2018 2:41:07 PM                       <- "Created On: %s\n\n", DateTimeToStr(Now())
<empty line>
```

Line 1 is first written as `00000000 Starting Address`; at the end `rewind(listFile)` and
`fprintf(listFile, "%08lX", startAddress)` overwrite the first 8 characters with the start address
(8 upper-case hex digits). The date/time string uses the Windows locale's short date and long time
formats (US English shown); it is the only non-deterministic part of the file. `DateTimeToStr` is
Delphi's format `'c'`, which leaves the time out when it is exactly midnight (hour, minute and second
zero): `Created On: 3/15/2018`. Listing lines start at physical line 5.

Listings written by real EASy68K builds are among the site examples (`ground-truth.md`), for instance
`c:\easy64k\reference\examples\site\games\spacewar\spacewar\spacewarV0.8.L68` (v5.12.29). They are from
older versions, but they show the same header (`Created On: 4/14/2014 4:42:57 PM`), CR LF line ends,
column layout, `m` marks, `...` truncation, "Line N" message lines, trailer and symbol table as
described in this section, and can serve as layout samples.

### 5.2 Source lines (listLine, LISTING.CPP:122-177)

`fprintf(listFile, "%-32.32s", listData)` followed by either `"%6d  %s"` (no mark) or `"%6d%s %s"`
(with `lineIdent`). `listData` is the 49-byte assembly buffer that `listLoc`, `listObj`, `equ`, `set`
and `listCond` fill.

| Columns (0-based) | Content | Written by |
|---|---|---|
| 0-7 | Location counter, 8 upper-case hex digits (`%08lX`) - the value of `loc` at the last `listLoc()` for this line | LISTING.CPP:180-189 |
| 8 | `=` when `offsetMode` or for DC / DCB lines (`showEqual`, DIRECTIV.CPP:356-358, 465-467), else space | |
| 9 | space | |
| 10-31 | Object field, 22 characters, left aligned, padded with spaces and cut at column 31: bytes as `XX `, words as `XXXX `, long words as `XXXXXXXX ` in emission order (`listObj`, LISTING.CPP:224-252); or `=XXXXXXXX ` for EQU / SET (DIRECTIV.CPP:280, 323); or 15 spaces + `TRUE ` / `FALSE ` for a conditional (`listCond`, LISTING.CPP:193-201, so `TRUE`/`FALSE` start at column 25) | |
| 32-37 | Listing line number `lineNumL68`, `%6d` | |
| 38.. | No mark: two spaces, source text from column 40. With a mark: the mark characters (`m` per macro nesting level, then `s` for a generated structured line: `m`, `mm`, `s`, `ms`...), one space, then the text - so the text starts at column 40 only for a one-character mark | MACRO.CPP:180-182, STRUCTURED.CPP:733-736 |

The source text is the line as read (original case, comment included) - for macro expansions and
generated structured lines it is the generated text (upper case). Tabs are expanded while copying
(LISTING.CPP:131-151), counting columns from the start of the text:

```cpp
if (Active->Project.TabType == Assembly) { if (j <= 12) t = 12 - j; else if (j <= 20) t = 20 - j; else t = 44 - j; }
else                                       t = Active->Project.TabSize - (j % Active->Project.TabSize);
```

Assembly tabs are stops at 12, 20 and 44 (`TAB1..TAB3`, asm.h:236-238). A tab met when the text column
is exactly 12 or 20, or is 44 or more, inserts **nothing**, so the neighbouring words run together
[EXP for columns >= 44]. Fixed tabs go to the next multiple of `TabSize` (a `TabSize` of 0 divides by
zero, hazard 9.3.9). Copying stops after 247 characters (`j < 255-8`); a newline is appended if missing.

Which lines are written (ASSEMBLE.CPP:554-559 unless noted):

- every assembled line when `listFlag` and not skipped (`skipCond`) and not suppressed (`skipList`);
- any line that ends with a warning or error, always (also a warning that `WARflag` hides);
- evaluated `IFxx` / `IFARG` lines with `TRUE`/`FALSE` unless `skipList` - **whatever `listFlag` is**, so
  also under `NOLIST` (3.5); `ENDC` lines are ordinary lines (listed when `listFlag`); `IFxx` lines
  inside a skipped block, and an `ENDC` that only reduces the nesting there, are not listed;
- comment lines when `listFlag`, even in skipped blocks or suppressed expansions;
- macro definitions (MACRO line, body lines, ENDM) when `listFlag` (MACRO.CPP:100-101, 116-117);
- macro call lines (mark `m`), expanded lines only with `MEXflag`;
- structured statement lines; generated lines only with `SEXflag`;
- not listed: `LIST`, `NOLIST`, `PAGE` lines, and lines under `NOLIST`.

`listData` is rewritten only by `listLoc()`; nothing clears it after a line has been written. Every line
that is written without a fresh `listLoc()` therefore shows in its first 32 columns whatever was left
there - normally the **address and object code** of the line listed before it:

- when `listFlag` is false, a line that is listed only because of a message, and an `IFxx` line [EXP].
  Here the stale content is the address of the last `listLoc()` that ran anyway (`ORG`, `SECTION`,
  `OFFSET`, `DC`, `DCB`, `SIMHALT` and the alignment code call it whatever `listFlag` is, 1.8) with an
  empty object field, because `output()` does not fill the field while `listFlag` is false. [ORA: after
  `DCB.B 10,$FF` at $1046 under `NOLIST`, an error line further down is listed as `00001046=` + blanks];
- a structured statement line that is listed a second time because of a message [EXP];
- the line listed after a message on a macro call line (it shows the last expanded line, 3.6);
- the "end include" line (3.4.1).

(The `*[sim68k]bitfield` marker and the `INCLUDE` line that `include()` lists are written after the
`listLoc()` of their own source line and show its address with an empty object field.)

Three texts that `assemble()` lists are not the line that was read, because the global `line` buffer
has been overwritten by then: after a `MACRO` definition it is the `ENDM` line (intended - that is how
`ENDM` gets listed), after a macro call the last expanded line, and after an `INCLUDE` the last line
read from the include file (visible only when the INCLUDE line itself carries a message other than
"Unable to access specified file", for example one caused by its label).

The tab settings are read from `Main->ActiveMDIChild` at every `listLine()` call (LISTING.CPP:128). In
the original the active window changes when a message from an include file opens that file
(ERROR.CPP:246-272), so the rest of the listing is expanded with the include window's settings. The port
uses one pair of values per assembly.

### 5.3 Long data (listObj, LISTING.CPP:224-235)

The field holds 7 bytes, 4 words or 2 long words (the test is `listPtr - listData + size > 31`).

- `CEXflag` false: `...` is written at column 26 (word item) or 28 (byte or long item) and further items
  are dropped from the listing: `01 02 03 04 05 06 ...`, `00000001 00000002 ...`, and for words
  `0001 0002 0003 0...` (the dots overwrite all but the first digit of the fourth word). [EXP]
- `CEXflag` true: the current line is written **with the source text and without any mark**
  (`listLine(line)`), then data continues on continuation lines: 10 spaces, the items, padding to 32
  columns, newline - no number, no text (`continuation = true`; LISTING.CPP:130, 160-161). Each
  continuation line still consumes a listing line number. [EXP]
  Side effect: inside a macro expansion that is not being listed (`MEXflag` off) the full lines of a long
  DC still appear, without `m`, and the last partial line is lost. [EXP]
- `DCB` never continues (CEX forced off).
- Instructions never overflow (maximum word + long + long = 22 characters).

### 5.4 Other lines

| Line | Format | Source |
|---|---|---|
| Message | `Line N ` + text + newline, N = `lineNumL68` | LISTING.CPP:206-213 |
| End of include | a numbered listing line without mark whose text is `-------------------- end include --------------------`; columns 0-31 repeat the last assembled line of the include file, object code included (3.4.1). Written only when `listFlag` is true at that moment | DIRECTIV.CPP:742-745 |
| Bit-field marker | a numbered listing line without mark whose text is `*[sim68k]bitfield`, written before the `OPT BIT` line itself, in pass 2 and only when `listFlag`; columns 0-31 are those of the `OPT` line (address, empty object field) | DIRECTIV.CPP:620-625 |
| Page marker | `<------------------------------ PAGE ------------------------------>` alone on a line, no prefix | DIRECTIV.CPP:1037-1038 |
| Trailer | empty line, error count line, warning count line (section 4.2) | LISTING.CPP:260-273 |

### 5.5 Symbol table ("Cross Reference", optCRE, SYMBOL.CPP:184-210)

Only when `CREflag` at the end of the run. There is no cross reference of uses, only names and values:

```
<empty line>
<empty line>
SYMBOL TABLE INFORMATION
Symbol-name         Value
-------------------------
NAME                HEX
```

- One line per symbol: the name, padded with spaces to 18 columns, two more spaces, then the value as
  `%X` (upper-case hex, no leading zeros; negative values show 8 digits). A name of 18 or more
  characters is followed by just the two spaces.
- Order: hash bucket by first character - `A`..`Z` first (buckets 0-25), then one bucket for all other
  first characters (`_`, `:` ...) (`hash`, SYMBOL.CPP:215-221) - and inside a bucket ascending `strcmp`
  order (insertion keeps lists sorted, SYMBOL.CPP:136-162). So `START` precedes every `_0000000n`.
- **Every** symbol is listed: labels, EQU and SET names (SET: last value), REG symbols (the mask),
  macro names (temp-file offset), section labels, generated structured labels, and local labels under
  their mangled name `GLOBAL:LOCAL`.

### 5.6 What the simulator reads from the listing

Visible in sim/SIM68Ku.cpp (details belong to `sim-ui.md`); these are the layout properties the port must
not change:

- The whole file is loaded line by line into a list box (297-301).
- Line 1, characters 1-8 (1-based): start PC, used if the text compares `>= "00000000"` and
  `< "01000000"` (304-308).
- Each line, lower-cased, 1-based `SubString(41, n)` = source text at 0-based column 40: `*[sim68k]break`
  sets a breakpoint on the following line if that is an instruction line; `*[sim68k]bitfield` enables
  bit-field execution; `*[sim68k]simhalt_off` disables SIMHALT (318-337). These are ordinary comment
  lines in the user's source (they must start in column 1 and be listed without a multi-character mark).
- `isInstruction(str)` (856-864): 1-based `str[1..2] == "00"`, `str[11] != ' '` (object field not
  empty), `str[9] != '='` (not DC/DCB/OFFSET), `str[11] != '='` (not EQU/SET).
- PC to line mapping: `highlight()` (785-807) scans from index 3 and selects the **last** line whose
  first 8 characters equal the PC and that is an instruction line (any line with that address once the
  program has halted). `lineToLog()` (869-909) does a binary search on the first 8 characters, assuming
  ascending addresses. Because these tests only look at the first 32 columns, every line that repeats
  the previous line's address and object code (5.2) counts as an instruction line too: for the last
  instruction of an include file the line selected is the "end include" line, not the instruction.
  This is original behaviour and comes for free when the listing is reproduced exactly.
- The comment in LISTING.CPP:265-266 says the text "No error" is used by the simulator to find the end
  of the code; no such test exists in the 5.16.1 simulator sources (searched for the string).

---

## 6. S-record file (.S68) and BINFILE

### 6.1 Record flow (OBJECT.CPP)

The file is written through the global `objFile` (GLOBALS.CPP:46), one record per `fputs`.
All object code goes through `output(data, size)` (CODEGEN.CPP:68-75), which calls
`outputObj(loc, data, size)` when `objFlag` (pass 2 only, because all callers test `pass2`). INCBIN calls
`outputObj` directly per byte.

`outputObj(newAddr, data, size)` (OBJECT.CPP:170-231):

```cpp
if (offsetMode) return NORMAL;                               // nothing is written in OFFSET mode
if ((lineFlag && (newAddr != objAddr)) || (byteCount + size > SRECSIZE)) { writeObj(); lineFlag = false; }
if (!lineFlag) {                                             // start a record
  if      ((newAddr & 0xFFFF)   == newAddr) { sprintf(sRecord, "S1  %04X", newAddr);  byteCount = 3; }
  else if ((newAddr & 0xFFFFFF) == newAddr) { sprintf(sRecord, "S2  %06X", newAddr);  byteCount = 4; }
  else                                      { sprintf(sRecord, "S3  %08lX", newAddr); byteCount = 5; }
  ...
}
append "%02X" / "%04X" / "%08lX" (data masked to the size); byteCount += size; objAddr += size;
```

- Record type is chosen from the **first address of the record only**: S1 up to $FFFF, S2 up to $FFFFFF,
  S3 above. A record that starts at $FFF0 and runs past $FFFF stays S1 [EXP].
- `SRECSIZE` = 36 (OBJECT.CPP:103) is the maximum value of the count field (address bytes + data bytes +
  checksum byte). Maximum data per record: S1 33 bytes, S2 32, S3 31; a 2- or 4-byte item is never
  split, so word-only data gives 32 bytes per S1 record. Longest line: 76 characters + line end.
- A new record starts whenever the next item's address is not the address following the previous item:
  after `ORG`, `SECTION`, `DS`, alignment padding (the padding byte itself is never written), and after
  leaving OFFSET mode. Records appear in source order; nothing is sorted or merged; overlapping ORGs are
  not detected.
- `writeObj()` (234-272) fills in the 2-digit count, computes the checksum (one's complement of the low
  byte of the sum of count, address and data bytes) and writes the record + `\n` (upper-case hex).

### 6.2 File layout

```
S021000036384B50524F47202020323043524541544544204259204541535936384B6D   header, always identical (initObj, OBJECT.CPP:160-162)
S1.. / S2.. / S3..                                                         data records
S01A0000...                                                                 0-4 memory map records (only after MEMORY directives)
S804aaaaaacc                                                                termination record with the start address
```

- Header S0: count $21, address 0000, data = ASCII `68KPROG   20CREATED BY EASY68K`.
- Termination: always **S8** with a 3-byte address, `sprintf(sRecord, "S8  %06X", startAddress)`,
  count 04 (OBJECT.CPP:346-349), even when data records were S1 or S3. (A start address above $FFFFFF
  would print 8 digits and produce a malformed record.)

### 6.3 Start address and memory map

- `startAddress` is the operand of `END` (rounded up to even); `$1000` when `END` has no operand
  [EXP `S804001000EB`]; unchanged (0 in a fresh process) when there is no `END` (section 1.8).
- Memory map (writeMap, OBJECT.CPP:279-314; finishObj 325-341): for each type set by a MEMORY directive,
  in the fixed order ROM, READ, PROTECTED, INVALID, one record
  `S0` `1A` `0000` + 10 name characters + 6 ASCII hex digits start + `,` + 6 ASCII hex digits end, all
  hex-encoded; names are `      ROM `, `     READ `, `PROTECTED `, `  INVALID ` (right justified in 9,
  trailing space). Example [EXP, with hazard 9.3.5 fixed]:
  `S01A0000202020202020524F4D203030383030302C30303846464659` = `      ROM 008000,008FFF`.
  They are written after the last data record and before S8.

### 6.4 Non-contiguous output and known oddities

- `ORG` to any address simply starts a new record there; gaps are not filled.
- `DS` reserves without writing; the simulator pre-fills memory with $FF (sim/SIM68Ku.cpp:277-278).
- **SIMHALT** calls `output(0xFFFF, WORD_SIZE)` twice without advancing `loc` in between
  (DIRECTIV.CPP:1014-1017). The S-record therefore contains $FFFF at the SIMHALT address, then a second
  record with $FFFF **at the same address**; the two bytes at address+2 are never written. [EXP:
  `...4E71FFFF93` followed by `S1051012FFFFDA` for a SIMHALT at $1012.] It works in the simulator only
  because unloaded memory is $FF. The listing shows `FFFF FFFF`. Keep this behaviour.
- In OFFSET mode instructions and data are listed but not written.
- Bytes of operands that contain an undefined symbol are unspecified (hazard 9.3.3).

### 6.5 BINFILE.CPP

`initBin`, `outputBin`, `finishBin`, `writeBigEndian` (BINFILE.CPP:59-206) implement a "Teesside"
binary format (per section: 4-byte big-endian address, 4-byte big-endian byte count, data; pad to even).
**Nothing calls them** in 5.16.1 - `output()` only knows the listing and the S-record - and `binFile` is
never opened. BINFILE.CPP also contains a second definition of `startAddress` (line 55, the other is
GLOBALS.CPP:37) and declares an `extern char newOrg` that does not exist. The file is not even part of
the original build: `BINFILE.obj` is missing from the project's object list (EDIT68K.bpr:7-11), which is
why the duplicate definition never bothered the Borland linker. The port must not compile this file. Binary files are made by the separate EASyBIN utility from the .S68.

---

## 7. VCL / Windows / Borland dependencies in the engine files

"CLI" = what the command-line port did (file:line in `cli/`). "Shim" = what a replacement must do.

### 7.1 Headers and language

| Where | Dependency | CLI port | Shim requirement |
|---|---|---|---|
| asm.h:23-27 | `<system.hpp>`, `<process.h>`, `<malloc.h>`, `<vcl.h>` | removed; `<string>`, `<stack>`, `#define AnsiString string`, `#define String string` (cli/asm.h:26-36) | provide headers of these names that pull in the shim (malloc.h exists in Emscripten) |
| ASSEMBLE.CPP:76-83, DIRECTIV.CPP:37-42, ERROR.CPP:34-35, LISTING.CPP:59-65, SYMBOL.CPP:21-22, BINFILE.CPP:32-36, CODEGEN.CPP:56, OBJECT.CPP:96 | `<vcl.h>`, `"assembleS.h"`, `"mainS.h"`, `"textS.h"`, `"editorOptions.h"`, **`"texts.h"`** (lower case, LISTING.CPP:63) | commented out | stub headers; note the lower-case spelling on case-sensitive build hosts |
| STRUCTURED.CPP:12-13 | `<stack.h>`, `<vector.h>` (pre-standard, names in the global namespace) | `<stack>`, `<vector>`, `std::stack<int>` (cli/STRUCTURED.CPP:73-75) | headers that expose `stack` and `vector` globally. Do **not** use `using namespace std;`: the engine has global functions `hash`, `set`, `move`, `link` that then collide with `std::hash` etc. |
| STRUCTURED.CPP:37, 104, 135 | identifier `or` (a C++ alternative token) | renamed `opr` | compile with `-fno-operator-names` |
| ERROR.CPP:40 | `extern lineNumL68;` (implicit int) | `extern int lineNumL68;` | one-word source fix (hard error in clang) |
| ASSEMBLE.CPP:226, 254, 348, 566; DIRECTIV.CPP:751, 840; MACRO.CPP:112, 121; MOVEM.CPP:196, 234 | `return NULL;` from functions returning `int` | `return 0;` / `return SEVERE;` | compile as C++98 (`-std=gnu++98`, NULL is an integer) or `#define NULL 0` |
| INSTTABL.CPP flavor tables, asm.h:174-176 | masks such as `0xC100` initialising `short int` (narrowing) | `unsigned short int` (cli/asm.h:199) | C++98 mode accepts it; in C++11 it is an error |
| INSTTABL.CPP, INSTLOOK.CPP:56, proto.h:129 and call sites | string literals converted to `char *` | `(char *)` casts everywhere | accepted in C++98 mode |
| 16 of the 19 files | file ends with a DOS end-of-file byte 0x1A (all except BINFILE.CPP, MACRO.CPP, STRUCTURED.CPP) | already removed | strip before compiling (clang: "expected unqualified-id") |
| every routine | `try { } catch(...) { }` also catching CPU exceptions (access violation, divide error) as Borland does | kept (ordinary C++ only) | section 9.3.6 |
| Borland RTL | `stricmp`, `strcmpi` (DIRECTIV.CPP:602-620, 935-941, STRUCTURED.CPP:310), `strnicmp` (MACRO.CPP:329), `itoa` (MACRO.CPP:276) | `#define stricmp strcasecmp` etc. (cli/asm.h:40-42), `snprintf` (cli/MACRO.CPP:277) | same |

### 7.2 Run-time dependencies

| File:line | What it does | CLI port | Shim requirement |
|---|---|---|---|
| ASSEMBLE.CPP:157, proto.h:27 | `AnsiString workName` parameter; `AnsiString outName` | `string` | a string class with `c_str()` returning `char *` |
| asm.h:34 | `const AnsiString VERSION = "5.16.01";` - a string object defined in the header, so every file that includes asm.h needs the complete string class before that line and gets its own copy; used only by the editor's update check (aboutS.cpp:90) - the listing header, the settings.dat header and the window caption use the `char` array `TITLE` (asm.h:35) | `#define VERSION "5.15.04"` (cli/asm.h:52) | the shim's `AnsiString` must be defined by the stand-in `<vcl.h>` / `<system.hpp>` and be constructible from a literal |
| DIRECTIV.CPP:712, ERROR.CPP:252 | assignments to the global `TextStuff` (the editor's `TTextStuff *` declared in textS.h) | commented out | part of the GUI blocks replaced below; no stand-in needed once they are gone |
| ASSEMBLE.CPP:166, 172; BINFILE.CPP:64; CODEGEN.CPP:120, 203; LISTING.CPP:99, 165, 247; OBJECT.CPP:135, 219, 260, 353 | `Application->MessageBox(text, "Error", MB_OK)` | `fprintf(stderr, ...)` | report as a fatal/diagnostic message to the UI |
| ASSEMBLE.CPP:177 | `Options->chkGenList->Checked` | `if (listFlag)` (cli/ASSEMBLE.CPP:216) | same as `listFlag` at entry |
| ASSEMBLE.CPP:178, 184 | `ChangeFileExt(workName, ".L68" / ".S68")` | own version that overwrites 4 characters at the last dot (cli/ASSEMBLE.CPP:163-174; wrong for extensions that are not 3 characters, and returns the source name itself when there is no dot) | VCL semantics: replace the extension after the last dot of the file-name part, or append |
| ASSEMBLE.CPP:210-221 | shrink message list; `AssemblerBox` captions via `IntToStr`; enable Execute | commented out | expose `warningCount`, `errorCount` |
| CODEGEN.CPP:80-81 | unused `TMsgDlgButtons temp_set; temp_set << mbOK;` | commented out | stub or delete |
| CODEGEN.CPP:121 | `exit(0)` | kept | must not tear down the runtime silently; trap and report |
| DIRECTIV.CPP:710-719 | clear the message list of an editor window showing the include file (`AnsiString`, `ExpandFileName`, `AnsiCompareIC`, `Main->MDIChildren`) | commented out | optional notification |
| ERROR.CPP:41, 246-288 | whole GUI half of `printError` (`TListItem`, `ShowMessage`, `ExtractFileName`, `Main->OpenFile`, `Active->Messages`, `BringToFront`) | commented out - **the CLI shows messages only in the .L68** | callback `(includeFile, lineNum, text, code)` |
| LISTING.CPP:104 | `DateTimeToStr(Now())` | `asctime()` under non-Windows, which adds a second newline (cli/LISTING.CPP:105-118) | produce `M/D/YYYY h:mm:ss AM/PM` (US locale) or make it injectable for tests |
| LISTING.CPP:128, 135, 143 | `Main->ActiveMDIChild->Project.TabType / TabSize` | `if (true)`: always Assembly tabs (cli/LISTING.CPP:149) | two integers supplied by the UI per assembly (default Fixed, 4) |
| OBJECT.CPP:237-252 | `AnsiString str = "0x"; str += char; StrToInt(str)` for the checksum | `strtol(str.c_str(), NULL, 0)` (cli/OBJECT.CPP:255) | same |
| STRUCTURED.CPP:64-71, 104-110, 134, 173-203, 279 ... | `AnsiString` concatenation, `UpperCase()`, `(String)char*`, `(String)char`, `AnsiString::IntToHex(n, 8)`, `stack<String, vector<String> >` | `std::string`; own `IntToHex` with `"%08x"` (cli/STRUCTURED.CPP:77-83) - **lower-case digits**, visible in SEX listings as soon as a label number contains a digit A-F (11th label of a family) | `IntToHex` must give upper-case digits |
| SYMBOL.CPP:21-22 | includes only | removed | - |
| MACRO.CPP, EVAL.CPP, OPPARSE.CPP, MOVEM.CPP, INSTLOOK.CPP, BUILD.CPP, INSTTABL.CPP, GLOBALS.CPP | no VCL calls (GLOBALS.CPP:70-82 and asm.h:243-259 only declare editor data: `tabTypes`, `FontStyle`, `TColor`, `clBlack`...) | commented out (cli/GLOBALS.CPP:71-82) | typedefs/enums so the declarations compile |
| C runtime text mode | every `fopen(.., "r")`, `"w"`, `"w+"` relies on CR LF translation and Ctrl-Z = EOF | `REMOVECR()` after the `fgets` in `processFile`, `include` and the expansion loop of `asmMacro` (cli/ASSEMBLE.CPP:362, DIRECTIV.CPP:736, MACRO.CPP:280) but not in `macro()` (cli/MACRO.CPP:104) nor for the continuation line (cli/MACRO.CPP:230); `\r` added to one delimiter set | section 9.4 |
| `fprintf(file, userText)` | MACRO.CPP:106, LISTING.CPP:210-211, 220 | changed to `"%s"` | section 9.3.4 |

---

## 8. Semantic diff: command-line port 5.15.4 versus original 5.16.1

Method: both trees with CR and trailing white space removed, `git diff --no-index -w` (19 files,
570 insertions / 711 deletions). All 101 numeric constants of asm.h were compared by name and value
after converting `const int X = v;` and `#define X v` to a common form: **identical**. INSTTABL.CPP
differs only by `(char *)` casts and one moved macro. Every hunk is classified below.

### 8.1 Class 1 - portability changes by the porter (no intended behaviour change)

| File | Hunks |
|---|---|
| all | VCL / GUI includes commented out; trailing 0x1A removed |
| asm.h | VCL includes replaced by `<iostream>`, `<string>`, `<stack>`; `AnsiString`/`String` defined as `std::string`; `stricmp`/`strcmpi`/`strnicmpi` mapped to `strcasecmp`/`strncasecmp`; all `const int` constants turned into `#define` (values unchanged); `FontStyle`, `TColor` constants removed; `ControlAlt` macro moved here from INSTTABL.CPP and MOVEM.CPP; `extern` declarations of the option flags added; `short int` masks made `unsigned short int` |
| proto.h | default argument `(char *)"\0"`; `void help(void)` |
| ASSEMBLE.CPP | `extern bool offsetMode` (was `extern int`, a genuine type mismatch in the original); `std::stack` externs; GUI code in `assembleFile` commented out, message boxes to stderr; `initList((char *)...)`; `return 0` instead of `return NULL` |
| BINFILE.CPP | `startAddress` made `extern` (duplicate definition); message box to stderr |
| CODEGEN.CPP | message boxes to stderr, `TMsgDlgButtons` removed |
| DIRECTIV.CPP | `%08lX` -> `%08X` (2x); casts on string literals; GUI loop in `include` commented out; `catch` returns `SEVERE` instead of `NULL` in `include`/`incbin` |
| ERROR.CPP | `extern int lineNumL68`; GUI half commented out |
| GLOBALS.CPP | editor globals commented out |
| INSTLOOK.CPP, INSTTABL.CPP | `(char *)` casts |
| LISTING.CPP | `listData` no longer `static`; `%08lX` -> `%08X`; `fprintf(listFile, "%s", x)` instead of `fprintf(listFile, x)` (3x); `if (!listPtr) listPtr = listData;` guards in `initList`, `listLoc`, `listCond`; message boxes to stderr |
| MACRO.CPP | `fprintf(tmpFile, "%s", line)`; casts; `snprintf` for `itoa`; `strncasecmp`; `return SEVERE` instead of `return NULL` in `macro()` |
| MOVEM.CPP | `catch` returns `SEVERE` |
| OBJECT.CPP | static `byteCount` renamed `obyteCount`; `%08lX` -> `%08X`; `strtol` for `StrToInt`; `char data[7]` (was 6, a real overflow); `snprintf`; `start & 0x00ffffff`; casts; message boxes to stderr |
| STRUCTURED.CPP | `<stack>`/`<vector>`; `or` renamed `opr`; `std::transform` for `UpperCase`; `std::stack`; own `IntToHex`; `assembleStc(const char *)`; `dbStack.top()` to string by hand |
| SYMBOL.CPP, EVAL.CPP, BUILD.CPP | none beyond includes / trailing bytes |

Several of these are not behaviour-neutral in effect (they fix undefined behaviour or change output
text); those are repeated in 8.2.

### 8.2 Class 2 - CLI-only additions and side effects (absent from every official release)

| File:line (cli/) | Change | Effect |
|---|---|---|
| ASSEMBLE.CPP:941-1015 | `help()`, `main()`, option parsing, `unlink` of `<src>.tmp` | CLI front end. Exit status is 1 after a normal run (`if (!s) exit(1)`); temp file is `<source>.tmp` |
| ASSEMBLE.CPP:163-174 | own `ChangeFileExt` | output-name bugs described in 7.2 |
| ASSEMBLE.CPP:178-188, 362; DIRECTIV.CPP:736; MACRO.CPP:280 | `REMOVECR()` after `fgets` in `processFile`, `include`, `asmMacro` | accepts CR LF sources on Unix; **not** applied in `macro()` (definition scan) |
| ASSEMBLE.CPP:414-420 | lines containing the text `INCLUDE` or `INCBIN` anywhere (any case, also in a comment or inside another word) are **not upper-cased at all** | such lines fail unless already in upper case (`  include 'x'` -> invalid opcode; `move d0,d1 ; include this` -> errors). Regression relative to both official versions |
| ASSEMBLE.CPP:423 | tokenizer delimiters `", \t\n\r"` | CR tolerated |
| DIRECTIV.CPP:670 | include file name not upper-cased (`strncpy` instead of `strcap`) | case kept for unquoted / double-quoted names (INCBIN still upper-cases) |
| DIRECTIV.CPP:703-705 | `Could not open file ::name::` to stderr **and into the listing** | extra listing line |
| GLOBALS.CPP:59-66 | flags initialised `true` (then set again in `main`) | none |
| LISTING.CPP:105-118 | `asctime()` date with its own newline | one extra blank line in the listing header, different date format |
| LISTING.CPP:149 | tab type forced to Assembly | listing text columns differ from the GUI default (Fixed, 4) |
| STRUCTURED.CPP:77-83 | `IntToHex` -> `"%08x"` | lower-case hex in generated labels as listed |
| asm.h:52-53 | `VERSION "5.15.04"`, `TITLE "ASy68K Assembler v5.15.04"` | listing header line 2 |
| ERROR.CPP | no message output besides the listing | - |

### 8.3 Class 3 - changes made by the official 5.16.x release after 5.15.4

After removing classes 1 and 2 only these remain. **All of them are in OPPARSE.CPP and asm.h.**
(ASSEMBLE.CPP and EVAL.CPP carry 2018 file dates but have no code difference from the port's base.)

| # | 5.16.1 location | 5.15.4 (cli/OPPARSE.CPP) | 5.16.1 | Observable effect |
|---|---|---|---|---|
| 1 | asm.h:34-35 | `"5.15.04"` | `VERSION = "5.16.01"`, `TITLE[] = "EASy68K Editor/Assembler v5.16.01"` | listing header line 2; settings.dat line 1 |
| 2 | OPPARSE.CPP:54 | - | `extern int loc;` | needed for #4 |
| 3 | OPPARSE.CPP:195 | `if (p[0] == '(') {` (line 196) | `if (p[0] == '(' && p[1] != 'P' && p[2] != 'C') {    // CK 2018-2-7` | The block that handles `(d,An)` and `(d,An,Xn)` is now skipped whenever the character after `(` is `P` **or** the next one is `C`. Intended effect: `(PC,An)` no longer tries to evaluate `PC` as a symbol (5.15.4 [EXP]: "Undefined symbol"). Side effect: **any `(d,An)` / `(d,An,Xn)` whose displacement text starts with `P` or has `C` as second character is "Invalid syntax"**: `($C,A0)`, `(PTR,A0)`, `(SCORE,A0)`, `(SCORE,A0,D1.L)`, `(ICON,A1)`, `(PCB,SP)` ... [EXP: all four probe lines are errors in 5.16.1 and assemble in 5.15.4]. `($1C,A0)`, `(12,A0)`, `PTR(A0)` are unaffected. |
| 4 | OPPARSE.CPP:272 | (nothing) | `d->data = loc;            // CK 3-8-2018` inside the `(…PC,Xn)` branch, executed **after** an explicit displacement has been evaluated | `(PC,Xn)` without displacement used an uninitialised displacement in 5.15.4 (in the experiment: "Displacement out of range"); 5.16.1 gives it the instruction address, which makes the extension-word displacement `loc - (loc+2)` = -2 = `$FE`. Because the assignment is unconditional, **`(label,PC,Xn)` also assembles with displacement `$FE`, ignoring the label** ([EXP] `MOVE.W (TABLE,PC,D0.W),D1` -> `323B 00FE` in 5.16.1, `323B 00F6` in 5.15.4). The value is the instruction address minus the address of the extension word (`extWords`, CODEGEN.CPP:151-155), so it is `$FE` whenever the extension word directly follows the opcode word and `$FC` in the one 68000 case where a word comes between, `BTST #n,(d,PC,Xn)` ([ORA] `BTST #3,(TABLE,PC,D0.W)` -> `083B 0003 00FC`). Every `(label,PC,Xn)` operand is hit, including jump tables: [ORA] `JMP (TABLE,PC,D1.W)` -> `4EFB 10FE`, `LEA (TABLE,PC,D0.L),A0` -> `41FB 08FE`. No range error can occur any more. `(d,PC)` without index is not affected, also when `d` starts with `P` or has `C` second ([ORA] `(SCORE,PC)`, `(PTR,PC)` assemble). The spelling `label(PC,Xn)` goes through the other branch (OPPARSE.CPP:376-409) and is correct in both. |
| 5 | OPPARSE.CPP:258-261 | comment `// Displacement is zero` | comment removed | none |

So relative to 5.15.4 the 5.16.1 assembler differs only in the three address-mode spellings above
(and the version text). These are regressions from the student's point of view, but they are what the
real 5.16.1 does and the port must reproduce them; tests should pin all of them:

```
        MOVE.W  (TABLE,PC,D0.W),D1      ; 323B 00FE            (5.15.4: 323B 00F6)
        MOVE.W  TABLE(PC,D0.W),D1       ; 323B 00F2            (same in both)
        MOVE.W  (PC,D0.W),D1            ; 323B 00FE            (5.15.4: error)
        MOVE.W  (PC,A1),D2              ; 343B 90FE            (5.15.4: Undefined symbol)
        MOVE.W  ($C,A0),D1              ; ERROR: Invalid syntax (5.15.4: 3228 000C)
        MOVE.W  (PTR,A0),D1             ; ERROR: Invalid syntax (5.15.4: 3228 0008)
        MOVE.W  (SCORE,A0,D1.L),D2      ; ERROR: Invalid syntax (5.15.4: 3430 1804)
        MOVE.W  ($1C,A0),D1             ; 3228 001C
```

(Object code from the experiment with TABLE = $1000 and the first line at $1008; [ORA] the same eight
results - both columns - came out of the native build with and without the 5.16.1 OPPARSE.CPP.)
Whether the shipped EDIT68K.exe 5.16.1 was built from exactly these sources is UNVERIFIED; one run of
the lines above through the real program settles it. The file dates are consistent with it: OPPARSE.CPP
is dated 2018-03-08 (the day of the second change), asm.h 2018-03-13, and the EDIT68K.exe inside the
official installer 2018-03-15 (`c:\easy64k\reference\official-extracted\`, see `ground-truth.md`).

Unchanged between the versions but worth knowing:

- `(PC)` directly followed by `,dest` leaves the displacement uninitialised in both (the
  `strchr(p, ',')` at OPPARSE.CPP:249 finds the comma after the parenthesis, so `n != NULL` and
  `d->data = 0` is skipped) - hazard 9.3.3.
- `(PC)` with no comma anywhere behind it on the line gets `d->data = 0`, and for the PC-relative modes
  `data` is the **target address** (`disp = data - loc`, CODEGEN.CPP:140-142): `JMP (PC)` at $1000
  assembles as `4EFA EFFE`, a jump to address 0, not "displacement 0" [ORA], and reports "Displacement
  out of range" above $8000.

---

## 9. Port hazards

Summary of what breaks if the sources are simply compiled with Emscripten and run (each item is
detailed below; [EXP] = reproduced):

1. Any optimisation level above `-O0` mis-assembles every forward reference (9.3.1). [EXP]
2. Macro body lines containing `%` - every binary constant - silently disappear (9.3.4). [EXP]
3. More than 5 nested macro levels overflow the default 64 KB stack (9.3.7). [EXP]
4. `MEMORY` end addresses lose their low byte at `-O0` (9.3.5). [EXP]
5. CR LF input, Ctrl-Z, LF-only output, temp-file offsets (9.4.1, 9.4.2). (`toolchain.md` finding 2)
6. The sources do not compile without a handful of flags and two mechanical edits (9.1).

### 9.1 Build-time

| # | Problem | File:line | Remedy |
|---|---|---|---|
| B1 | Trailing 0x1A byte | 16 files (not BINFILE, MACRO, STRUCTURED) | strip in the build step |
| B2 | CR LF line ends, Windows-1252 bytes in comments | all | harmless for clang |
| B3 | `extern lineNumL68;` | ERROR.CPP:40 | add `int` |
| B4 | `or` used as identifier | STRUCTURED.CPP:37, 104-110, 135-203 | `-fno-operator-names` |
| B5 | `return NULL` in `int` functions, narrowing of `0xC100` into `short`, literals to `char *` | section 7.1 | `-std=gnu++98` |
| B6 | Duplicate definition of `startAddress` | GLOBALS.CPP:37, BINFILE.CPP:55 | do not compile BINFILE.CPP |
| B7 | **Type mismatch across files**: `extern int offsetMode;` (ASSEMBLE.CPP:90) against `bool offsetMode;` (GLOBALS.CPP:27). `offsetMode = false;` in `processFile` (ASSEMBLE.CPP:286) stores 4 bytes into a 1-byte object and clobbers its neighbours (`showEqual`, `pass`, `pass2` in the Borland layout, harmless there because they are assigned right after). No compiler or linker diagnoses it. | | change the declaration to `extern bool` |
| B8 | Header names: `"texts.h"` (LISTING.CPP:63) for `textS.h`; `<stack.h>`, `<vector.h>`, `<vcl.h>`, `<system.hpp>`, `<process.h>` | | shim headers; mind case on Linux/macOS build hosts |
| B9 | Global function names that collide with library names when `using namespace std;` or `<unistd.h>` is in scope: `hash` (SYMBOL.CPP:215), `set` (DIRECTIV.CPP:295), `move` (BUILD.CPP:62), `link` (BUILD.CPP:871), `stack` | | no using-directive in the shim; import only `std::vector` and provide `stack` |
| B10 | Stale overload declaration `void outCmpBcc(char *size, char *op1, ...)` (STRUCTURED.CPP:38) with no definition; `extern bool xrefFlag` (ASSEMBLE.CPP:112) with no definition | | harmless (never used) |

With B1 and B3 applied and BINFILE.CPP left out, the other 16 files compiled unchanged in the experiment
with `em++ -std=gnu++98 -fno-operator-names` plus shim headers.

### 9.2 Data model

- The code assumes `int` = `long` = pointer = 32 bits and two's complement wrap-around.
  wasm32 matches Win32 here (measured: `int` 4, `long` 4, pointer 4, `short` 2, `char` signed).
- `%lX` / `%08lX` is used with `int` arguments (LISTING.CPP:183, 185, 243, 281; DIRECTIV.CPP:280, 323;
  OBJECT.CPP:193, 214). Correct on wasm32 and Win32; **wrong on an LP64 native build** (macOS, Linux),
  where it may print garbage in the upper digits. Relevant only if someone builds a native oracle from
  the originals.
- `char` must be signed (Borland default; project flags in EDIT68K.bpr:41-42 contain no `-K`). Signedness
  is observable (a two-character constant or DC.W string whose second byte is >= $80, section 3.3).
  Do not pass `-funsigned-char`.
- Other Borland options in EDIT68K.bpr:41-46 (`-a8` alignment, `-b-` byte-sized enums, `-O2`, 1 MB heap
  commit, 64 KB stack commit) have no effect on assembler output.
- Signed overflow is relied upon (`16 * x` for hex >= $80000000 at EVAL.CPP:237-239, decimal conversion
  at EVAL.CPP:268, `doOp`). Use `-fwrapv` (see `toolchain.md`).
- Shift counts >= 32 or negative in `<<` / `>>` (EVAL.CPP:411-412): x86 and WebAssembly both reduce the
  count modulo 32, so results agree; formally undefined in C++.
- `INT_MIN / -1` and `INT_MIN \ -1` (EVAL.CPP:416, 423): x86 raises a divide error, which Borland turns
  into an exception caught by `eval`'s `catch(...)` (-> "ERROR: An exception occurred in routine
  'eval'. "); WebAssembly **traps** on the division (abort) and returns 0 for the remainder. Guard in
  the shim or accept. UNVERIFIED on the real program.
- `<ctype.h>` calls receive negative `char` values for bytes >= $80 (`isspace(*p)`, `isalpha`,
  `isalnum`, `toupper` throughout). musl computes these arithmetically (always "false", `toupper`
  leaves them unchanged) [EXP: a label containing $C9 is "Invalid syntax", bytes >= $80 inside strings
  and comments pass through]. Borland indexes a table with the negative value; whether any high byte is
  classified as letter/space there is UNVERIFIED.

### 9.3 Undefined behaviour and uninitialised data

#### 9.3.1 `lookup()` returns an uninitialised pointer - breaks optimised builds [EXP]

SYMBOL.CPP:94 declares `symbolDef *s, *last, *t;` and line 179 returns `t`; on the "not found and not
create" paths (164, 171) `t` was never assigned. No caller dereferences it in that case, so Borland and
`-O0` builds work. clang at `-O1` and above treats the uninitialised return as impossible and compiles
"not found" as "create": every reference to a not-yet-defined symbol **creates** it with whatever value
the fresh allocation holds. Result (reproduced with the 5.16.1 sources at `-O2`, and with the CLI port at
`-O1`): `LEA MSG,A1` before `MSG` gives "Symbol value differs between first and second pass" on the
following labels, `MSG` = 0 in the symbol table, wrong code. Bisecting file by file pins it on
SYMBOL.CPP. Fix: `*t = NULL` at the declaration (verified here at `-O2`), or compile with
`-ftrivial-auto-var-init=zero` (verified in `toolchain.md`, finding 1).

#### 9.3.2 `bitField()` tests an uninitialised variable in pass 1

BUILD.CPP:257-281: `unsigned short type;` is assigned only inside `if (pass2)`, then
`if (type == BFINS) extWords(dest...) else extWords(source...)` runs in both passes. In pass 1 the choice
of operand whose extension words are counted depends on garbage. If the garbage is not $0700 (the usual
case; [EXP] at `-O0` and `-O2`), pass 1 counts the **source** operand: correct for all bit-field
instructions except `BFINS Dn,<ea>{..}` with an `<ea>` that needs extension words, where pass 1 is
short by 2 or 4 bytes and every later label gets a phase error [EXP: `BFINS D1,(6,A0){3:4}` followed by
a label]. The real program very likely behaves the same; UNVERIFIED. Initialise `type` to 0 (or use the
flag) so that at least the behaviour is fixed.

#### 9.3.3 Values read before being written

| What | Where | When | Effect |
|---|---|---|---|
| `int t` in `eval` | EVAL.CPP:76, 97, 110 | pass 1, operand is an undefined symbol (`evalNumber` does not store a value) | The garbage is pushed and becomes the expression value: used by `IFxx` expressions with forward references (`assemble` pre-sets its `value` to 0, but `eval` overwrites it) and stored by `SET`. If the symbol is not the first operand, `t` still holds the previous operand or intermediate result. |
| the caller's value variable | `d->data` of `source` / `dest` (ASSEMBLE.CPP:576), `outVal` in `dc` (DIRECTIV.CPP:340), `blockVal` in `dcb`, `regList` in `reg` (MOVEM.CPP:208) | pass 2, undefined symbol: `eval` returns before `*valuePtr` is written (3.3, error protocol) | Garbage emitted as the operand of the erroneous line ([EXP] `MOVE.W UNDEFSYM,D1` gave `3239 00000003` in one build and `3239 00001022` in another; [ORA] `3039 00000000`). In `DC` the variable still holds the previous item of the same line, so `DC.W 7,UNDEF` emits `0007 0007`. `IFxx` is safe in pass 2: its `value` stays 0 and the error code keeps the block assembled. |
| `opDescriptor source, dest` | ASSEMBLE.CPP:576; `d->data` not set at OPPARSE.CPP:257-266 | `(PC)` followed by a comma (`MOVE.W (PC),D1`) | displacement = leftover stack data ([EXP] two builds gave `EFE5` and `FFFE`) |
| fields of a new `symbolDef` | SYMBOL.CPP:152-169 with SYMBOL.CPP:245 | `define()` creates the symbol but skips the assignment because the line already carries an error >= 0x300 | symbol exists with garbage value and flags (may even look like a macro or register list) |
| `capLine` beyond its terminator | OPPARSE.CPP:68, 115, 127 ... (`p[1]`, `p[2]` read past the end of a short or missing operand) | malformed lines only | which error is reported can depend on earlier lines |
| `cmp` in `lookup` | SYMBOL.CPP:136-141 | flagged by clang, but only read when it was assigned | none |

These cannot match the real program byte for byte (the garbage there is Borland stack content). They
only matter on lines that are errors anyway, except `(PC),Dn`. Make them deterministic by
zero-initialising the variables at their declaration and exclude such bytes from oracle comparisons.
Do not go further and assign zero at the point of the error: where the original leaves a defined
earlier value in place (the previous item of a `DC` line, the previous operand in `t`) that value is
the original behaviour and stays.

#### 9.3.4 User text used as a `printf` format [EXP]

| Call | Text |
|---|---|
| `fprintf(tmpFile, line);` MACRO.CPP:106 | every macro body line |
| `fprintf(listFile, errMsg);` LISTING.CPP:211 | message text, user controlled for `FAIL` |
| `fprintf(listFile, lineNum);` LISTING.CPP:210, `fprintf(listFile, text);` LISTING.CPP:220, `sprintf(objPtr, name);` OBJECT.CPP:288, `sprintf(buffer, objErrorMsg);` OBJECT.CPP:259, 352 | fixed texts without `%` |

With musl, a `%` that does not start a valid conversion makes the whole `fprintf` fail and write
nothing. Observed: a macro body line `AND.B #%00001111,... ; 50% done` was dropped from the stored
macro, so the expansion silently lacked that instruction (no message); a `FAIL 100% wrong %d %s`
message vanished from the listing (the list entry, which does not go through `fprintf`, was intact).
Replace all of these with `fputs`. What Borland's `fprintf` does with such a line is UNVERIFIED; since
macros with binary constants work in the field it evidently copies an invalid specification literally,
so `fputs` is equivalent except for body lines whose `%` happens to form a **valid** conversion (for
example `'%d'`, `% d` in a comment, `%%`), where the real program substitutes garbage or collapses `%%`.

#### 9.3.5 `writeMap` overflows `char data[6]` [EXP]

OBJECT.CPP:281, 291, 300: `sprintf(data, "%06X", start)` writes 7 bytes. In the `-O0` WebAssembly build
the stray NUL landed on the low byte of the parameter `end`: `MEMORY ROM $8000,$8FFF` produced the map
record for `008000,008F00`. With `data[7]` the record is `008000,008FFF`. (In the Borland layout the
byte presumably falls into padding.) Fix the array size.

#### 9.3.6 Reliance on `catch(...)` catching CPU faults

Borland C++Builder turns access violations, stack overflow and integer divide errors into exceptions that
`catch(...)` catches; nearly every routine has such a handler. In WebAssembly a trap ends the program,
address 0 is writable, and by default Emscripten compiles `catch` blocks out.

| Situation | Code | Likely original behaviour | Port |
|---|---|---|---|
| `ELSE`, `ENDI`, `ENDW`, `UNTIL`, `ENDF`, `UNLESS` with no open structure, and `ENDW` with only one entry stacked (`IF ... ENDW`): `stcStack.top()` / `.pop()` (and `dbStack`, `forStack`) on an empty container. Happens in pass 1 already, where nothing is reported. [ORA: the native MSVC build of the CLI port dies with an access violation] | STRUCTURED.CPP:361-362, 390-391, 459-464, 485-486, 622-640, 667-672 | first use in a process: read through a null pointer -> access violation -> `catch(...)` at STRUCTURED.CPP:723 -> "ERROR: Invalid syntax". After the container has once been used and emptied (also in an earlier assembly) the read returns stale heap data instead and `pop()` corrupts the container. UNVERIFIED. | give the shim's `stack` a checked `top()`/`pop()` that throws (needs C++ exceptions enabled) or patch the six sites; report "Invalid syntax" [EXP with a throwing shim] |
| `sprintf(listPtr, ...)` with `listPtr == NULL` | LISTING.CPP:195-198 (`listCond`), reached only under the conditions given in 1.8: first assembly of the process, listing off from the start, and no `ORG` / `SECTION` / `OFFSET` / `DC` / `DCB` / `SIMHALT` / odd-address alignment executed before the `IFxx` line of pass 2 (pass 1 counts) | access violation caught in `assemble`; the line is not listed (a message for it has already been written by then) | initialise `listPtr` (the CLI port added `if (!listPtr) listPtr = listData;`) |
| `INT_MIN / -1` | EVAL.CPP:416, 423 | exception message | guard |
| Fixed tab size 0 | LISTING.CPP:143 | divide error caught in `listLine` -> exception message | never pass 0 |
| runaway macro recursion | MACRO.CPP:172-177 | 1 MB default stack (EDIT68K.bpr:46 sets no stack reserve) is exhausted at roughly 85 levels, long before the 256-level check; outcome UNVERIFIED | give the module enough stack so the 256-level check fires [EXP] |
| `exit(0)` | CODEGEN.CPP:121 | unreachable with the shipped tables | make `exit` a trap that reports |

#### 9.3.7 Stack consumption [EXP]

`asmMacro` has about 11.6 KB of locals (`arguments[36][257]` = 9252 bytes, `capLine[256]`,
`macLine[512]`, two token tables; MACRO.CPP:135-142) and recursion goes
`asmMacro -> assemble -> createCode -> asmMacro`. With Emscripten's default 64 KB stack five nested
macro levels work and the sixth traps ("memory access out of bounds"). 256 levels need about 3.2 MB.
`include` adds about 1 KB per nesting level (DIRECTIV.CPP:640-652). Link with `-sSTACK_SIZE` of at
least 8 MB (16 MB recommended).

#### 9.3.8 Fixed-size buffers

| Buffer | Size | File:line | Overflow possible? |
|---|---|---|---|
| `line` | 256 | GLOBALS.CPP:52 | **Yes**: `strcpy(line, macLine)` (MACRO.CPP:349) when a macro line expands beyond 255 characters. [EXP: a 365-character expansion crashed the `-O0` build and, at `-O2`, overwrote `lineNum`/`lineNumL68` (messages for "line 824454193")]. The globals after `line` are `lineNum`, `lineNumL68`, `listPtr`, `continuation` and the option flags (GLOBALS.CPP:53-66). The real program is corrupted too; exact effect UNVERIFIED. |
| `macLine` | 512 | MACRO.CPP:135 | Yes: no bound in the substitution loop (MACRO.CPP:299-341); an expansion beyond 511 characters smashes the stack. |
| `capLine` | 256 | ASSEMBLE.CPP:360, DIRECTIV.CPP:640, 763, MACRO.CPP:135, STRUCTURED.CPP:277 | no (source lines are at most 255) - except that `assemble()` is also called with the overflowed `line` above |
| `buffer` | 256 | GLOBALS.CPP:33 | message text, and scratch for the listed source line: `listLine` stops at 247 columns but one more tab may add up to `TabSize` spaces; with fixed tab sizes of 16 or more a ~247-column line overruns by a few bytes into `numBuf` (LISTING.CPP:133-154) |
| `numBuf` | 20 | GLOBALS.CPP:34 | no (`"Line %d "`) |
| `listData` | 49 | LISTING.CPP:76 | no (longest content 33 characters) |
| `sRecord` | 80 | OBJECT.CPP:121 | no (78 with terminator) |
| `label`, `opcode`, `name`, `symName`, `sym2`, `globalLabel`, `symbolDef.name` | 34 | ASSEMBLE.CPP:577, INSTLOOK.CPP:60, EVAL.CPP:190, MOVEM.CPP:245, SYMBOL.CPP:95, GLOBALS.CPP:38, asm.h:154 | no; note `lookup()` rewrites the caller's buffer in place for local labels |
| `option` 9, `operand` 11 | | DIRECTIV.CPP:568, 903 | no |
| `string` (DC) | 260 | DIRECTIV.CPP:342 | no |
| `tokens` 512 / `token` 128 / `tokenEnd` 128 | | ASSEMBLE.CPP:141-143, MACRO.CPP:81-82, 140-142, STRUCTURED.CPP:275-278 | no for 255-character lines |
| `arguments[36][257]` | | MACRO.CPP:137 | no |
| `data` | 6 | OBJECT.CPP:281 | **yes**, 9.3.5 |
| `valStack` 5 / `opStack` 4 | | EVAL.CPP:72-73 | no (section 3.3) |
| `lineIdent` | 258 | MACRO.CPP:69 | no |
| `includeFile`, `fileNameSave` | 256 | GLOBALS.CPP:40, DIRECTIV.CPP:652 | no |

Recommendation: add one check in the shim-side patch set - if the expanded macro line is longer than
255 characters, report an error instead of copying. This deviates from the original only where the
original corrupts memory.

#### 9.3.9 Other

- `Active->Project.TabSize` of 0 (possible from a `*~Tab size~0~` footer, textS.cpp:144-149):
  `j % 0` at LISTING.CPP:143.
- `IFARG` indexes `arguments[value]` after checking `value > 0 && value < MAX_ARGS` (safe);
  `\n` substitution checks `n < MAX_ARGS` (safe).
- `collect()` (DIRECTIV.CPP:422-440) does not terminate its output for an unterminated string; `dc`
  does not read it in that case (it jumps to the expression path).
- `set()` and `macro()` dereference the pointer returned by `define()` without checking
  (DIRECTIV.CPP:320-321, MACRO.CPP:93-98); with `t = NULL` from 9.3.1 this becomes a null dereference
  in the rare case that the symbol does not exist in pass 2 (for instance a `SET` line that only pass 2
  reaches). In WebAssembly that silently writes near address 0. Guard in the patch or accept.

### 9.4 Files, line ends, paths, encoding

#### 9.4.1 Input

- All text input uses `fopen(name, "r")` = Windows text mode: CR LF -> LF, **Ctrl-Z (0x1A) ends the
  file**. Emscripten has no text mode. A CR left at the end of a line becomes part of the last token:
  `ENDM\r`, `ENDC\r`, `MEXIT\r` are then not recognised (macro never ends: "ENDM expected").
  Emulate at the file-system boundary for the main source and for every INCLUDE file: remove CR before
  LF, stop at 0x1A. A lone CR is not a line end for the assembler. **Do not append a line end to an
  INCLUDE file that lacks one**: the original reads the unterminated last line as it is, and a bare
  label there is "Invalid opcode" (3.1.3).
- The main source is what the editor control holds, saved with `TStrings::SaveToFile`: every line ends
  with CR LF, including the last. Feed the core the editor text with line ends normalised to LF and a
  final LF added if missing.
- The `*~Font name~`, `*~Font size~`, `*~Tab type~`, `*~Tab size~` footer lines of .X68 files written by
  the real editor (mainS.cpp:239-253) are removed when the file is loaded into the editor
  (textS.cpp:139-173) and therefore never reach the assembler for the main file. In include files they
  are skipped by the rule in 3.4.1.
- Lines longer than 255 characters are split (section 1.3). Do not "fix".
- Source bytes are Windows-1252. The web UI must hand the core single-byte text (encode as CP-1252, not
  UTF-8), otherwise `DC.B 'é'` emits two bytes instead of one, and decode the listing the same way.

#### 9.4.2 Output

- .L68 and .S68 are written in text mode: CR LF line ends on Windows. A WebAssembly build writes LF.
  Decide once (the simulator port reads both); for byte comparison with real output convert.
- The macro temp file is also text mode. `macroFP = ftell(tmpFile)` values become the **values of macro
  symbols** printed in the symbol table. On Windows each stored line counts 2 bytes for its line end.
  To reproduce symbol-table values of the second and later macros exactly, the temp file must be written
  with CR LF and read back with translation (or the offsets otherwise emulated). Measured with the
  MSVC-built native CLI oracle of `toolchain.md` on a two-macro source whose first body is 9 lines /
  104 characters: the second macro's value is `71` (hex) on Windows and `68` in the LF-only WebAssembly
  run. **The Borland build does the same.** This can be read off listings written by real EASy68K that
  come with the site examples next to their sources (`c:\easy64k\reference\examples\site`): for every
  macro after the first, the value in the symbol table equals the summed length of the earlier macro
  bodies (each from the line after `MACRO` through its `ENDM` line) counted with CR LF, never the LF
  count. `spacewarV0.8` (v5.12.29): `COLLIDECIRCLE 31F` = 799 with CR LF, 782 with LF.
  `FINAL PROJECT` (v5.9.0), ten macros: `ONE 1EC` (LF would be `1C8`) ... `NINE 1499` (LF `131D`).
  `RSA CLIENT`: `PRINT 51`, `PRINT_ERROR 13F`. `MyClient`: `PRINT_ERROR EE`. So a port that shows the
  symbol table must count two bytes per stored line end.
- "Created On:" is the current local time in the Windows locale format; mask it in comparisons.
- Temp files have fixed names in the source folder (`EASy68Ks.tmp`, `EASy68Km.tmp`); a user file with
  one of these names would be overwritten and deleted.

#### 9.4.3 Paths and names

- INCLUDE / INCBIN names are upper-cased unless written in single quotes (3.4.1); Windows does not
  care. A case-sensitive virtual file system needs case-insensitive lookup.
- Students write Windows paths (`"C:\Sounds\laser.wav"`, `macros\io.x68`). Map `\` to `/` and decide how
  absolute drive paths are resolved or rejected.
- Relative names resolve against the main source's folder (the process current directory), not against
  the including file.
- Output names come from the editor's file name via `ChangeFileExt` (section 1.2).

#### 9.4.4 Tabs

Tabs are plain white space for parsing. Only the listing expands them (5.2), using the two per-window
values. The CLI port hard-wires Assembly tabs; the GUI default is Fixed / 4.

### 9.5 State across runs

Section 1.8. Additionally the three structured-code stacks keep their capacity, and `symbolInit` /
`htable` rely on `clearSymbols()` having run (it does not run if `assembleFile` returns early because a
file could not be opened - then `tmpFile` also stays open).

### 9.6 Recommended build settings and minimal patch set

Compile: `-std=gnu++98 -fno-operator-names -fwrapv -fno-strict-aliasing -ftrivial-auto-var-init=zero`
(char signed by default), any `-O` level once the patches below are in; C++ exceptions enabled only if
the shim throws for the empty-stack case. Link: `-sSTACK_SIZE=16MB -sALLOW_MEMORY_GROWTH=1`.
Run the regression suite at `-O0` and at the release level and diff the outputs: any difference is new
undefined behaviour.

Source changes (keep the reference files pristine; apply as a reviewed patch in the build):

| # | File:line | Change | Why |
|---|---|---|---|
| P1 | all | strip trailing 0x1A | B1 |
| P2 | ERROR.CPP:40 | `extern int lineNumL68;` | B3 |
| P3 | ASSEMBLE.CPP:90 | `extern bool offsetMode;` | B7 |
| P4 | SYMBOL.CPP:94 | `*t = NULL` | 9.3.1 (also covered by the auto-init flag; do both) |
| P5 | MACRO.CPP:106; LISTING.CPP:210, 211, 220 | `fputs` instead of `fprintf` | 9.3.4 |
| P6 | OBJECT.CPP:281 | `char data[7];` | 9.3.5 |
| P7 | BUILD.CPP:257; EVAL.CPP:76; ASSEMBLE.CPP:576; MOVEM.CPP:73 | zero-initialise `type`, `t`, `source`/`dest`, `memOp` | 9.3.2, 9.3.3 (covered by the flag) |
| P8 | MACRO.CPP:345-349 | refuse an expanded line longer than 255 characters | 9.3.8 |
| P9 | build list | leave out BINFILE.CPP | B6 |
| P10 | ERROR.CPP:243-288 | replace the GUI half of `printError` by a callback (or satisfy it with stubs) | 7.2 |

Everything else (VCL names, text mode, date, tab settings, path mapping, checked `stack`) can live in
the shim without touching the originals.

---

## 10. Recommendation: which code to start from

**Start from the 5.16.1 originals with a thin shim and the patch set of 9.6. Use the CLI port only as
a second opinion.**

Reasons:

1. **Version.** The CLI port is 5.15.4. The official 5.16.1 differs in `opParse` (section 8.3) in ways
   that change both object code and error behaviour; coursework is checked against 5.16.1. Starting
   from the originals gets these for free and keeps the version strings right.
2. **The port's own behaviour changes.** Section 8.2: lines mentioning INCLUDE/INCBIN are not
   upper-cased, include names are not upper-cased, tab expansion is forced to Assembly tabs, generated
   labels are listed in lower-case hex, the listing header has a different date line and an extra blank
   line, output-name derivation is wrong for some names, messages go only to the listing. Each would
   have to be found and undone.
3. **The port does not remove the real hazards.** It has the same `lookup()` bug (it mis-assembles
   forward references under `em++ -O1` exactly like the originals [EXP]), the same uninitialised
   variables, the same stack appetite, and its CR handling misses `macro()` (`toolchain.md`). The things
   it did fix (`"%s"` formats, `data[7]`, `bool offsetMode`, `int lineNumL68`, `listPtr` guards) are
   five small edits listed in 9.6.
4. **The porter's work is mechanical and small.** Classified in 8.1: casts, includes, `std::string`,
   stderr instead of message boxes. A shim header reproduces all of it without editing the originals.
   This was tried: 16 files, two one-word/one-byte edits, `-std=gnu++98 -fno-operator-names`, about
   100 lines of stand-in declarations, and the result assembled all probe programs; with patches P3-P7
   the `-O2` build produced listings and S-records identical to the unpatched `-O0` build on 22 probe
   sources x 2 option sets, apart from the bytes covered by 9.3.3, the `%` cases fixed by P5 and the
   MEMORY map record fixed by P6.
5. **Traceability.** A build that is "reference files + N-line patch + shim" lets every later question
   ("is this a port bug or original behaviour?") be answered by reading the patch. A fork of a fork
   does not.
6. **Data model.** wasm32 has the same integer sizes and `char` signedness as the Borland target, so the
   original format strings and arithmetic are right as they stand; the CLI port's 64-bit adjustments are
   unnecessary.

What to take from the CLI port: its list of touched lines is a good checklist for the shim (section 7),
and the native MSVC build described in `toolchain.md` remains useful as a fast differential oracle for
everything outside sections 8.2 and 8.3. Two practical notes on that oracle: the 5.16.1 OPPARSE.CPP
compiles unchanged against the CLI port's headers once its trailing 0x1A byte is removed, so swapping
that one file gives a native build that also covers section 8.3 (this is how the [ORA] results there
were obtained); and being ordinary C++ it dies with an access violation where the original relies on
`catch(...)` (for example on `IF ... ENDW`, section 3.7), so such sources cannot be compared with it.

Integration shape that follows from sections 1 and 9: one exported function that (a) receives the
source text (CP-1252, LF), the flags, tab type and size, the "file name" for output naming and a
virtual file system for includes; (b) runs `assembleFile` in a fresh instance; (c) returns
`errorCount`, `warningCount`, the message list `(file, line, text)`, and the .L68 / .S68 contents.

---

## 11. Completeness pass

Enumerated mechanically and checked against this document:

- **Function definitions** in the 17 .CPP files (`grep` for definitions): ASSEMBLE.CPP 9
  (assembleFile, strcap, skipSpace, processFile, assemble, createCode, fieldParse, pickMask, tokenize);
  BINFILE.CPP 4 (6.5); BUILD.CPP 26 (move, zeroOp, oneOp, arithReg, arithAddr, bitField, immedInst,
  quickMath, movep, moves, moveReg, staticBit, movec, trap, branch, moveq, immedToCCR, immedWord, dbcc,
  scc, shiftReg, exg, twoReg, oneReg, moveUSP, link - encodings out of scope; quirks in 3.8, 9.3.2);
  CODEGEN.CPP 3 (output, effAddr, extWords); DIRECTIV.CPP 19 (3.4); ERROR.CPP 1; EVAL.CPP 4; INSTLOOK.CPP
  1; LISTING.CPP 8 (initList, listLine, listLoc, listCond, listError, listText, listObj, finishList);
  MACRO.CPP 2; MOVEM.CPP 3; OBJECT.CPP 5 (initObj, outputObj, writeObj, writeMap, finishObj); OPPARSE.CPP
  1; STRUCTURED.CPP 4 (getBcc, outCmpBcc, asmStructure, assembleStc); SYMBOL.CPP 5 (clearSymbols, lookup,
  optCRE, hash, define). All appear in sections 1-6.
- **Instruction table**: 163 entries; the 32 with `parseFlag == false` are listed in 3.2 and each is
  covered in 3.4-3.7.
- **Token-recognised keywords**: IFC IFNC IFEQ IFNE IFLT IFLE IFGT IFGE ENDC (ASSEMBLE.CPP:386-532);
  MACRO, ENDM (MACRO.CPP:109, 114, 357), MEXIT (358), IFARG (365), NARG (329); structured keywords
  IF ELSE ENDI WHILE ENDW REPEAT UNTIL FOR ENDF DBLOOP UNLESS and THEN DO OR AND TO DOWNTO BY, `<T>`,
  `<F>` (STRUCTURED.CPP:310-675); OPT words (DIRECTIV.CPP:602-620); MEMORY types (935-941).
- **`case` labels**: both `switch` statements of `printError` (ERROR.CPP:59-238) - every case is a row
  of 4.3; `precedence` and `doOp` (EVAL.CPP:379-428) - 3.3; `listObj` / `outputObj` size switches
  (LISTING.CPP:236-249, OBJECT.CPP:202-221) - 5.2, 6.1; `asmMacro` size switch (MACRO.CPP:157-169) - 3.6.
- **Status codes**: all 57 message codes of asm.h:42-113 (24 severe + EXCEPTION, 7 error, 14 minor,
  11 warning; besides them `OK` and the four class bases `SEVERE`, `ERRORN`, `MINOR`, `WARNING`) are in
  4.3 with their raise sites, or marked never raised.
- **Symbol flags** (asm.h:158-162): `BACKREF`, `REDEFINABLE`, `REG_LIST_SYM`, `MACRO_SYM` are used as
  described in 3.1.3, 3.4 and 3.6; `DS_SYM` (0x10) is never set or tested. Of the function return codes
  (asm.h:229-231) `CRITICAL` is never used; no caller looks at `MILD_ERROR` except
  `assembleFile` for `initObj` (section 1.2).
- **Global variables**: every definition in GLOBALS.CPP (lines 23-99) and the file-level variables of
  ASSEMBLE.CPP:134-144, MACRO.CPP:66-70, LISTING.CPP:76, 90, OBJECT.CPP:121-125, SYMBOL.CPP:36-37,
  STRUCTURED.CPP:64-71, BINFILE.CPP:49-56, ERROR.CPP:41, INSTLOOK.CPP:56 is mentioned in section 1.3,
  1.8, 2, 5, 6 or 9.
- **Option flags and their GUI controls**: 9 check boxes of optionsS.dfm:84-194 and the tab controls of
  editorOptions.dfm:190-218 - section 2.
- **GUI entry points**: one menu item / shortcut / toolbar button (1.1), the status dialog (4.2), the
  highlighter (1.9).
- **Diff hunks**: all hunks of the 19-file diff are assigned to 8.1, 8.2 or 8.3.

---

## 12. Open questions (need the real EDIT68K.exe 5.16.1 or a decision)

1. Do the three `opParse` regressions of section 8.3 occur in the shipped binary exactly as in the
   sources? (Eight-line probe in 8.3. The file dates say the binary is younger than both changes, and
   two independent builds of the 5.16.1 OPPARSE.CPP agree on every line of the probe, so only a
   mismatch between the published sources and the build is left to rule out.)
2. Borland `fprintf` with a `%` that is not a valid conversion, and with one that is (`%d` in a macro
   body line) - 9.3.4.
3. A structured terminator with nothing open (first use, and after earlier structures), and `ENDW`
   after an opener of another family (`IF ... ENDW`), which empties the stack with its second pop -
   3.7, 9.3.6.
4. `BFINS Dn,(d,An){o:w}` followed by a label: phase error on the real program? - 9.3.2.
5. Bytes emitted for an undefined symbol and for `MOVE.W (PC),Dn` - 9.3.3. Decide: zero.
6. Macro expansion longer than 255 characters - 9.3.8. Decide: report an error.
7. Macro recursion: stack overflow versus the "too many levels" message - 9.3.6.
8. Classification of bytes >= $80 by Borland's `<ctype.h>` (accented letters in labels) - 9.2.
9. Line ends of the port's .L68 / .S68 (CR LF as original, or LF) - a decision. (That macro symbol
   values are CR LF offsets on the real program is settled, 9.4.2; matching them is required if symbol
   tables are to compare equal.)
10. Maximum INCLUDE nesting on Windows (open-file limit) - 3.4.1.
11. Should listing line 2 keep the text `EASy68K Editor/Assembler v5.16.01` (tools may parse it; the
    simulator does not) and which fixed date format to print on line 3.
12. A local label whose mangled name reaches 33 characters is defined but can never be referenced
    (3.1.3). Reproduce as is (assumed here), since the real program reports the same errors.

---

## Appendix A. Reference listings from the experiment

Produced by the experimental build described in section 0 (Fixed tabs, size 4, defaults of section 2;
the date line is a placeholder). They illustrate sections 5 and 6; they are not output of the Borland
binary.

Source (tabs between fields):

```
START	ORG	$1000
	MOVE.B	#9,D0
	LEA	MSG,A1
loop:	ADD.L	#1,D1
	BRA	loop
.local	NOP
	BNE	.local
MSG	DC.B	'Hello, World, this is long',13,10,0
VAL	EQU	$20
CNT	SET	5
	DS.W	4
	DCB.B	10,$FF
	SIMHALT
	END	START
```

Listing with "Constants Expanded" on:

```
00001000 Starting Address
Assembler used: EASy68K Editor/Assembler v5.16.01
Created On: 1/1/2000 12:00:00 AM

00001000                             1  START   ORG $1000
00001000  103C 0009                  2      MOVE.B  #9,D0
00001004  43F9 00001012              3      LEA MSG,A1
0000100A  5281                       4  loop:   ADD.L   #1,D1
0000100C  60FC                       5      BRA loop
0000100E  4E71                       6  .local  NOP
00001010  66FC                       7      BNE .local
00001012= 48 65 6C 6C 6F 2C 20       8  MSG DC.B    'Hello, World, this is long',13,10,0
          57 6F 72 6C 64 2C 20  
          74 68 69 73 20 69 73  
          20 6C 6F 6E 67 0D 0A  
          00                    
0000102F  =00000020                 13  VAL EQU $20
0000102F  =00000005                 14  CNT SET 5
00001030                            15      DS.W    4
00001038= FF FF FF FF FF FF ...     16      DCB.B   10,$FF
00001042  FFFF FFFF                 17      SIMHALT
00001046                            18      END START

No errors detected
No warnings generated


SYMBOL TABLE INFORMATION
Symbol-name         Value
-------------------------
CNT                 5
LOOP                100A
LOOP:LOCAL          100E
MSG                 1012
START               1000
VAL                 20
```

S-record:

```
S021000036384B50524F47202020323043524541544544204259204541535936384B6D
S1241000103C000943F900001012528160FC4E7166FC48656C6C6F2C20576F726C642C2074C0
S1111021686973206973206C6F6E670D0A0096
S10F1038FFFFFFFFFFFFFFFFFFFFFFFFB4
S1051042FFFFAA
S804001000EB
```

(Note the last data record: the second SIMHALT word at $1042 again, section 6.4.)

Macro expansion, conditional and structured marks (lines taken from two separate probe listings,
"Macros Expanded" and "Structured Expanded" on; listing line numbers therefore restart):

```
00001000                            17m     PRINT   5
00001000                 FALSE      18m     IFARG   2
00001000                            19m     ENDC
00001000  303C 0005                 22m L_1 MOVE.W  #5,D0   ; 1=1
00001004= 01                        23m     DC.B    1
00001005                            24m     ENDM
0000100A                            13m     M1  D3
0000100A                            14m     IF D3 <NE> #0 THEN
0000100A  B67C 0000                 15ms     CMP.W   #0,D3
0000100E  6700 0004                 16ms     BEQ _00000001
00001012  4E71                      17m         NOP
00001014                            18m     ENDI
00001014                            19ms _00000001
00001014                            20m     ENDM
```

Message lines in a listing:

```
Line 9 ERROR: Immediate data exceeds 8 bits
0000101E  123C 002C                  9      MOVE.B  #300,D1
Line 54 WARNING: END directive missing, starting address not set

22 errors detected
4 warnings generated
```

