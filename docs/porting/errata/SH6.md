# Errata of work package SH6 (program files, file dialog, printer)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum SH6 <n>" or naming this file: 1, 2, 3, 4, 5, 5a, 5b, 6, 7, 8, 9, 10, 12 (ARCHITECTURE.md 3.8.4 (12 in the text of "Write buffering", "Reads" and the paragraph after the list)); 11 (ARCHITECTURE.md 3.8.5); E2 (ARCHITECTURE.md 3.8.4, Task 58: superseded by W4 15 (the engine no longer copies the defects); SH6 E2 describes the state before that repair). Nothing to merge, because no statement of a document is wrong or missing: 5c (a record of a speed measure; nothing a document states); C1, C2 (contract entries (C1 granted at gate I2); `app/src/contracts/` is the authority); E1, E3, E4, E5, E6 (notes for other owners, settled or filed as requests); T3 items 1-10 (questions for T3, answered in T3.md or still open there).

Where the code of SH6 differs from ARCHITECTURE.md, or the document leaves a gap that SH6 had to
fill. Entries under "Contract" ask W1 for a change of `app/src/contracts/`; entries under "For other
owners" name a defect or a question that is not SH6's to change.

## Document

1. **What a cached view may reach (3.8.4, "What a view may reach: the browser store and an opened
   folder as far as the mount goes").** `CachedSyncFiles` reaches the folders it was asked to
   `prepare()` and everything below them (each down to `maxDepth`), not the whole mount: a cache of
   the whole browser store would load every file of every folder at each program load, and a file
   outside the loaded tree cannot be answered synchronously. A name that leaves the prepared
   folders (`..\other\data.txt` from `/browser/demo`) does not resolve, so the program gets the
   result of a missing file. The program's folder is prepared at every load, the data file's folder
   at Open Data, and the chosen file's folder at task 58 OK, so every folder the program has been
   given is reachable, as the document intends. Recorded in `docs/differences/SH6.md`.

2. **The limits message (3.8.4).** The text is `Not available to the program: <path> (<reason>)`
   with the reasons of `DirSnapshot` in words: `too large`, `too many files`, `too deep`,
   `unreadable`; `<path>` is the VPath. It goes out from a timer, not at once: the folder is
   prepared during a load (4.7 step 7) and the engine's load then empties the message area, which
   would remove a message written at once. A file beyond the limits cannot be opened, created or
   removed (creating it would truncate the file in storage that the view does not have).

3. **A write to storage that fails (not in the document).** The view reports it once per file in the
   message area, `A file of the program could not be saved: <path> (<reason>)`, keeps the change
   and writes the whole file again at the next `settled()` (a close, a stop, the page closing).

4. **When the view writes (3.8.4, "at most every 500 ms per file while it keeps changing and at once
   when a handle closes, when execution stops and at exit").** A change arms one 500 ms timer per
   file (the first write of a quiet file therefore also waits 500 ms); `settled()` starts every
   pending write at once. `SyncFiles` knows no handles, so "when a handle closes" is
   `ProgramFiles.fileClose()` calling `view.settled()`, which writes every changed file of that view,
   not only the closed one. A change that only adds bytes at the end of what storage has is sent as
   `appendFile` (the browser store appends in O(added bytes), 3.8.1); anything else rewrites the file.

5. **Changes made by others while the program changes the same file.** A change reported by the Vfs
   (the editor, the Files panel, another window) replaces the cached bytes unless the program
   changed the file after the change was reported and before its bytes were read; then the
   program's bytes win and are written over it. `revalidate()` keeps a file the program has changed
   and not written yet. Nothing is merged. Since gate I2 "written over it" means the whole file:
   when storage changed under a file the program has changed, the next write replaces the file
   instead of appending to it (the review found storage left with `WXYZabc`, bytes of both
   versions). A file whose write failed keeps what the view knew storage held, so a later removal
   still reaches storage.

5a. **Changes by others are read whole (gate I2, U4's note).** The `Vfs` has no ranged read and a
    `VfsChange` does not say what changed, so every change another part makes to a cached file is
    read whole: a 30 MB execution log in the program's folder that the log device appends to every
    second is read again every second. Deferring the read for files the program has not opened was
    considered and not done: the session waits for `whenCurrent()` at every change report
    (`core/run/compose.ts`), so a deferred read would either be started at once anyway or make
    Rewind wait, and 3.8.4 asks for the change "at once". The cheap answer needs the change itself
    to say what was appended (requested in `docs/requests/SH6-append-change.md`). **Done in the
    round before gate I3:** see entry 13.

5b. **A whole-file read returns the same copy until the file changes (gate I2, SH5's note).** The
    sound device reads the whole file at every try of task 70's wait loop. `read(path, 0, n)` with
    `n` at least the size returns one cached copy, made again only after a write, a truncation or a
    change by others. Callers must not modify it (none does: the engine and the sound device copy).

5c. **A name asked for again is not looked up again (gate I2 round 2; the integration scenario's
    measurement).** With 5b no read copied a file any more, but each try of graphicSound.X68's task 70
    loop still cost 9 to 15 us, nearly all of it the name lookup (`CachedSyncFiles.resolve` walks the
    folder's names for the Windows letter-case rule; `ProgramFiles` splits and checks the name). Now
    `CachedSyncFiles.resolve` keeps its answers by folder and name until a name is added to or
    removed from a folder or the prepared folders change, and `ProgramFiles` keeps the parse of a
    name until the current directory or the mounts change. Measured: 15 us to 1 us per read under
    Node; in Chromium (check-wave2) 20,619 reads at 9 us before, 70,167 reads at 1 us after in the
    same wait (the loop now spins faster, which the program cannot observe: the busy flag clears by
    the clock). `CachedSyncFiles.nameLookups` counts the lookups for tests. A change by others is
    still seen at the next try (program-files.test.ts, "ProgramFiles.read in a wait loop").

6. **The journal (3.8.4; SH8 errata C8, left to SH6).** `localStorage` keeps one text per origin
   (`easy68k.sim.journal.v1`, SH8's key). SH6 keeps every window's part in it under a random
   instance id, so two windows that close at once do not overwrite each other's bytes:
   `{"v":1,"parts":{"<id>":{"entries":[...]}}}` (`core/sim-host/files/journal.ts`). An entry says
   what a file must look like (`{path, remove: true}` or `{path, size, at, data}`: the file is `size`
   bytes long and bytes `[at, at + n)` are `data`, base64), not how it got there, so applying it twice,
   or after the interrupted write did land, gives the same bytes. Only what the view has not written
   to storage yet is journalled (the changes since the view was last settled), which is at most what
   changed in the last half second or so. A page that lives on after `pagehide` (back-forward cache)
   removes its part once storage has everything. `recoverJournal()` applies the parts of other
   instances through the view of each file's folder and then removes them.
   Hazard, not solved: a journal entry applied after another window changed the same bytes would
   overwrite that change. Recovery runs at the next start of any window, so this needs an abrupt
   close followed by another window writing the same file before any window starts again.

7. **`exitNow()` keeps the streams open.** The contract says "commit what can be committed and write
   the rest to the journal"; `exit()` closes every stream. `exitNow()` commits the pending bytes of
   every stream (in the order the streams were opened) but leaves the streams open: `pagehide` is
   also sent to a page that goes into the back-forward cache and may come back, and its program must
   find its files open.

8. **Names (3.8.4, trap15-a §11 item 14).** Besides the rules of the document: a name with a
   character Windows refuses in file names (`< > : " | ? *` and control characters) does not
   resolve; trailing periods and spaces of every segment are dropped, as Windows does
   (`data.txt.` opens `data.txt`). An absolute name (starting with `\` or `/`) is accepted only for a
   mount the program has been given (the program's folder, Open Data, a task 58 answer); in the
   desktop app, when the program's folder is on `/disk`, every absolute name is a real path. Device
   names (`NUL`, `CON`, `PRN` ...) are ordinary names here; on Windows they open devices (T3 item 8).

9. **Printer metrics are read at every question.** `PrinterDevice.fontChanged()` does nothing: the
   cell is computed from `SimSettings.printerFont` whenever the engine asks (`initPrint` asks at the
   first character of every document), so a font change takes effect at the next document, as in the
   original. An open document keeps the font it started with.

10. **The Printer Output dialog and `sim.file.printerSetup` (1.4 note 2, 3.8.4).** The dialog has the
    id `sim.printerOutput` (2.7 has no id for it) and the title `Printer Output`. It lists the jobs
    that were neither printed nor discarded, shows the selected page as text, and has `Print...`
    (`Platform.print` with a letter-size page, every character at its place at 600 dpi in the job's
    font), `Discard` and `Close`. A finished job opens it modeless (it does not hold the program,
    which may go on printing); `File > Printer Setup...` opens it modal, because the original's
    set-up dialog was modal and the printer is chosen in the print dialog that `Print...` opens.

11. **The task 58 dialog's request (3.8.5).** Title: the program's, or `Open` / `Save As` when the
    program passes none (Windows' default titles, trap15-a §10 item 13). Filters: the program's
    string read as `description|patterns|...` (the engine passes `"<list>|<list>"`), or one filter
    `All Files (*.*)` when it passes none. Save: no default extension and no overwrite question
    (`overwritePrompt: null`), as the original's Save dialog. The program's initial name gives the
    Save dialog's suggested file and the Open dialog's start folder; see Contract C1.

12. **STDIO_BUFFER (3.8.4, O-15): the original's rules, as T3 measured them (gate I2).** The document
    says "whole multiples of 512 are committed as soon as that many are pending" and "reads are not
    buffered", and SH6's acceptance says "after task 56, or after 512 bytes, the bytes are there".
    T3 ran `tests/conformance/windows-confirm/stdio-buffer.X68` on the official SIM68K.exe under Wine
    (docs/porting/errata/T3.md F2) and found otherwise; the port now follows the measurement:
    - the buffer holds 512 bytes and is written when it is full **and another byte comes**: byte by
      byte, nothing is visible after 512 bytes, 512 after the 513th, 1024 after the 1025th;
    - a write that fits into what is left of the buffer is copied into it, **even when it fills it
      exactly**: one write of exactly 512 bytes on a fresh stream leaves nothing visible, 511 + 1
      leave nothing (T3's `trap15-a/a59-files-buffer-edges`, T3.md F8; repaired at gate I2 round 2,
      the port showed 512 before);
    - a write that does not fit writes the buffer first, then goes to the file whole when it is 512
      bytes or more (measured: 10 + 1000 bytes: 1010 visible; 5000: 5000; 600: 600; 513: 513; by
      the rule, not measured: 10 + 512: 522),
      or into the buffer when it is smaller (300 + 300 bytes: 300 visible, measured in a59);
    - a reading stream buffers what it reads, 512 bytes at a time, and keeps returning those bytes
      after another stream changed them; a seek, or a write through the same stream, empties it.
    Not measured (gate I2 review): **a read of 512 bytes or more.** `fileRead` keeps the last 512-byte
    block of any read, as a buffer refilled block by block would be left. If Borland's `fread` passes
    a large read straight to the file (as its `fwrite` does a large write), the buffer would instead
    be empty or hold another block, and a stream that read 1000 bytes would see another stream's
    later change to bytes 512-1023 where the port shows its buffered copy. T3 is asked for a probe
    (item 1 below). The engine test replays stdio-buffer.X68 and compares the whole `result.bin` with
    the Wine result (`program-files.engine.test.ts`); the conformance suite replays a59.

13. **An append by another part is added to the copy, not read whole (round before gate I3; entry
    5a, request SH6-append-change).** W1 added `VfsChange.appended?: { at; data }` (contracts/fs.ts;
    errata W1.md entry 16), set by `Vfs.appendFile` on its 'local' change. `CachedSyncFiles` now
    adds `data` to its copy, with no read, when four things hold: the copy is unchanged by the
    program (not dirty, no write of its own in flight, no whole rewrite pending), the copy and what
    the view knows storage holds are both exactly `at` bytes long, and a `stat` taken after the
    change says the file is exactly `at + data.length` long. Anything else (an append the view missed
    because two arrived while it was busy, a change by the program, a file now beyond the limits, an
    append from another window, which arrives as 'external' without `appended`) reads the whole file
    as before. U4's execution log in the program's folder therefore costs each flush what it added.
    Tests: `fs/sync/cached.test.ts`, "an append through the Vfs (the log) is added to the copy
    without reading the file" and "an append the copy cannot follow ... reads the file". Not
    measured again in Chromium with a 30 MB log (the 122 ms of entry 5a was U4's figure).

14. **Windows device names (gate I3 round 3; T3's a58).** The original passes the program's name
    to `fopen`, so a name Windows reads as a device reaches the device, not a file. Which names
    those are was measured on this project's reference machine, Windows 11 10.0.26300, with
    `GetFullPathNameW`, `RtlIsDosDeviceName_U` and `CreateFileA` as Borland's `fopen` calls it
    (`GENERIC_READ | GENERIC_WRITE`, `CREATE_ALWAYS` for `"w+b"` and `OPEN_EXISTING` for `"r+b"`),
    then `WriteFile` 3 bytes, `SetFilePointer` to 0 and to 5, `ReadFile` 3, `CloseHandle`, and
    `DeleteFileA` (probe script kept in the round's scratch folder):

    | Name | Windows 11 | Port now |
    |---|---|---|
    | `NUL`, `nul`, `nUl`, `NUL `, `NUL.`, `NUL..`, `NUL:`, `NUL :`, `NUL::`, `NUL. .` | null device: open ok in both dispositions, write 3 ok, seek 0 and 5 ok, read 0 bytes (end of file), close ok; nothing created; `DeleteFile` fails (error 5) | null device, the same |
    | `.\NUL`, `..\NUL`, `folder\NUL` (folder exists), `nofolder\..\NUL`, `folder\nul .`, `folder/NUL`, `\NUL`, `/NUL`, `C:\NUL`, `C:NUL`, `C:\Windows\NUL`, `\\.\NUL`, `\\?\NUL` | null device | null device |
    | `nofolder\NUL`, `folder\folder2\NUL` (folder missing), `Z:\NUL` (no drive Z:) | open fails, error 3 (path not found) | null device: `SyncFiles` cannot say whether a folder exists (differences SH6.md) |
    | `NUL.txt`, `nul.dat.x`, `NUL .txt`, `folder\NUL.txt`, ` NUL`, `NUL\.`, `NULL`, `NUL1` | ordinary files (Microsoft's naming documentation and older Windows read `NUL.txt` as the device; Windows 11 does not) | ordinary files, as before |
    | `CON`, `PRN`, `AUX`, `COM1`-`COM9`, `LPT1`-`LPT9`, `COM¹ COM² COM³ LPT¹ LPT² LPT³`, `CONIN$`, `CONOUT$`, with trailing spaces, periods or a colon (`COM1:`, `prn.`, `aux `, `CON:`) | devices, but only as the whole name. `PRN` on this PC: open fails (error 2, no printer port); `AUX` hung in `CreateFile` (a port exists); a GUI program such as SIM68K.exe has no console, so `CON` does not open | do not open (`D0.W = 2`), task 59 gives 2, task 57 fails; no file of that name is created or removed |
    | `folder\CON`, `.\COM1`, `\CON`, `C:\COM1`, `con.txt`, `COM1.txt`, `LPT1.log`, `aux.c`, `COM0`, `LPT0`, `COM10`, `CLOCK$` | ordinary files on Windows 11 | ordinary files, as before |

    `ProgramFiles.deviceOf()` implements the table; `fileOpen`, `fileRemove` and `read` ask it before
    any view, so the browser store, an opened folder and the desktop app's disk behave alike, and a
    file named `NUL` on a Mac's disk is never reached. Null streams take their handles from the same
    counter as the others. Tests: `program-files.test.ts` ("ProgramFiles: Windows devices", six
    cases) and `program-files.engine.test.ts` ("NUL: task 52, 54, 55, 56, 59, 51, 53, 57 ..."); a58
    produces its golden.

15. **Changes coalesced behind a running refresh (gate I3 round 3; another engineer's hypothesis,
    confirmed).** `changed()` kept only the last change that arrived while a refresh of the same
    path ran (`running.again = change`). When another window's write (no `appended`) was waiting
    there and this window's own append (U4's log: a 'local' change with `appended`) replaced it, the
    next refresh added the appended bytes to a copy that had never seen the other window's write:
    storage `XYZd`, the program's copy `ABCd`. Now a change that arrives while another one is
    already waiting is kept without `appended`, so that the refresh reads the file whole; a single
    waiting append is still applied without a read. Test: `cached.test.ts`, "another window's
    change waiting behind a running refresh is not lost to an append that follows" (it gives `ABCd`
    without the repair).

16. **revalidate() beyond limits.maxFiles (gate I3 round 3; found by another package's verifier).**
    With 50 program files and 3,000 others in a folder, `prepare()` loaded `DEFAULT_SNAPSHOT_LIMITS.
    maxFiles` (2,000) and named the rest, but `revalidate()` then loaded 3,050, because it read every
    file new to the view through `reload()`, which checked only the byte limits. `reload()` now
    applies the file count to a file that is not in memory yet, with the same message as `prepare()`
    (`Not available to the program: <path> (too many files)`, once per file). This also covers new
    files that the Vfs reports (a save, another window), which took the same way. Test:
    `cached.test.ts`, "revalidate() and the changes others report load no more files than prepare()
    (maxFiles)" (3,050 without the repair).

## Contract

C1. **`OpenRequest` cannot carry an initial file name, and `SaveRequest` no start folder.** The
    original's task 58 Open dialog shows the program's name in its File name field; the port's Open
    request has only `startDir`, so the name is not preselected. A Save request without a name has
    no way to start in the program's current directory (`suggested` must name a file), so the Save
    dialog starts in the folder the last dialog ended in. Request (optional, no package depends on
    it): `OpenRequest.initialName?: string` and `SaveRequest.startDir?: VPath`. **Granted at gate I2**
    (contracts/fs.ts). `programDialogRequest` now passes the program's file name as `initialName`
    (the name part; the folder part is `startDir`) and, for Save without a name, the current
    directory as `startDir`. FS1's dialog (`features/files/dialogs.ts`, `FileDialog.tsx`) does not
    read either member yet; until it does, the Open field is empty and a nameless Save dialog starts
    in the last folder used.

C2. **No way for `ProgramFiles` to know the mount names a platform serves.** An absolute name is
    tested against the mounts the program has been given (entry 8). If a later package hands a
    program a path of another mount, it must go through `setCurrentDir` first (as task 58 does).
    No change asked; noted for whoever adds such a path.

## For other owners

E1. **Task 53 with a count that wraps the bounds test (trap15-a task 53, §13 Files, item "A1 = $2000,
    D2 = $FFFFFFFF"; owner: the simulator engine / W4).** trap15-a's port rule: read at most
    `MEMSIZE - (A1 & ADDRMASK)` bytes; expected `D0.W = 0`, `D2 = 10` on a 10-byte file. The engine
    gives `D0.W = 2`: `fread(buf, 1, 0xFFFFFFFF, fp)` reaches `hostFileRead` with a `size_t` that
    `shim/hostfile.cpp` casts to `int` (-1), `host_file_read` in `shim/host-imports.js` then computes
    `Math.min(data.length, -1)` and returns -1 whatever the host answers. `ProgramFiles` cannot repair
    it from the host side. **Settled at gate I2:** T3 measured the original (T3.md F4: `D0.W = 0`,
    D2 left at `$FFFFFFFF`, nothing read, so trap15-a's expectation was wrong too) and F3 (task 54
    with `D2 = 0` gives 0); the engine owner reproduces both in `engine/sim/shim/hostfile.cpp`. The
    engine test now asserts the original's values.

E2. **Withdrawn (stale; round before gate I3, DOC1's review).** It said that
    `engine/sim/shim/simio.cpp` reproduced the two defects of the task 58 Save branch, which 3.8.4
    says are not reproduced. W4 removed them at gate I2 (errata W4.md entry 15), and ARCHITECTURE.md
    3.8.4 says "not reproduced"; the engine and the document agree, and nothing is left for anyone.
    `ProgramFiles` passes what the engine gives (`initialName`).

E3. **SH8 (`features/run/session.ts`):** `viewFor` creates one `CachedSyncFiles` per mount and never
    disposes of it; `CachedSyncFiles.dispose()` exists (unsubscribes, cancels timers) for the session
    to call when it ends. Harmless while a session lives as long as its page.

E4. **T3 (`tests/conformance/sim/known-differences.json`):** a59 is equal since gate I2 round 2
    (entry 12); its entry must go, or the suite reports "listed ... but now equal". Filed as
    `docs/requests/SH6-a59-known-difference.md`. **Done** (the entry is gone since gate I2 round 2;
    T3 closed the request in the round before gate I3).

E5. **FS2 (`/folder`, gate I2: "each appendFile copies the whole file in Chromium: batch writes").**
    The program's writes are batched already: `CachedSyncFiles` sends at most one write per file
    every 500 ms (entry 4), however many task 54 calls the program makes, plus one at a close, a stop
    and exit, as 3.8.4 requires. What one `appendFile` costs on an opened folder is the File System
    Access backend's (a writable keeps the existing data by copying it); that is FS2's to make
    cheaper, not something the view can batch further without delaying what 3.8.4 asks for "at once".
    U4's log flushes do not pass through the view.

E6. **SH8 and the contracts engineer (`SimSession.printJobs`, gate I2):** the session keeps every
    finished print job for its life. The Printer Output dialog (`features/sim-files`) only lists the
    jobs neither printed nor discarded; it cannot drop one from the session because the list is
    readonly in the contract. A `discardPrintJob(job)` on the session (contracts, then SH8) would let
    Discard and Print free them; SH6 would call it from `PrinterOutputDialog.tsx`. Not requested this
    round: a job holds a few kilobytes per page, so the growth matters only for a program that
    prints thousands of pages in one session.

## What T3 is asked to confirm on the official binary (Wine driver)

1. `stdio-buffer.X68` (6.8): **answered at gate I2** (T3.md F2, F8; entry 12 above): blocks of 512
   on the 513th byte, large writes whole, reads buffered; 300 + 300 bytes leave 300 visible; one
   write of exactly 512 leaves nothing visible (a59; the port follows it since gate I2 round 2).
   Still open: **a read of 512 bytes or more** (entry 12). Probe: a 2000-byte file of `A`; stream 1
   reads 1000 bytes; stream 2 opens the file, writes 2000 `B` and closes; stream 1 reads 10 more
   bytes. The port gives ten `A` (positions 1000-1009 lie in its buffered block 512-1023); a
   Borland `fread` that passes a large read straight through would refill and give ten `B`.
2. The same file open in two slots at once (trap15-a §12 item 11), and task 52 on a file another slot
   holds open (the port allows both): **answered** (T3.md F8, a56): the original agrees.
3. After Rewind, task 57 on a file a forgotten slot still holds: `D0.W = 2` (the port), and a new
   task 51 on it reads end of file.
4. How many Rewinds with a file left open it takes until task 51/52 fail because the Borland run-time
   has no free `FILE` (its stream table): the port never runs out.
5. When the simulator exits, the forgotten streams' bytes are written in the order they were opened.
6. Task 54 with `D2 = 0` and task 53 with `A1 = $2000`, `D2 = $FFFFFFFF` on a 10-byte file:
   **answered** (T3.md F3, F4; see E1).
7. Names: `DATA.TXT.` and `data.txt ` open `data.txt`; a name with `?` or `*` gives 2 for tasks 51,
   52, 59: **answered** (T3.md F8, a57): the original agrees.
8. Task 52 on `NUL` and `CON` (Windows devices; the port creates ordinary files): **measured under
   Wine for `NUL`** (T3.md F8, a58): a read gives end of file where the port reads back what it
   stored. **Repaired in gate I3 round 3** (entry 14), from a measurement on Windows 11 of every
   device name.
9. Task 10: the job a form feed sends (with a PDF printer as the default printer), to compare the
   page geometry of 3.8.4 (margins 1/8 and 1/11 of the page, cell from Courier New 10). Items 3, 4,
   5 and 9 cannot be measured with the oracle's recipes (T3.md F8).
10. **Reads and writes without a seek between them** (T3.md F7; a51, a52, a53, measured under Wine):
    the Borland run-time does something definite that the port does not imitate (3.8.4 commits
    pending bytes before a read). Not repaired yet, as T3's entries ask: they stay unconfirmed until
    the three programs run on Windows, where the file system under the C library is Windows' own.
    If Windows agrees, SH6 models the Borland stream state for these cases.
