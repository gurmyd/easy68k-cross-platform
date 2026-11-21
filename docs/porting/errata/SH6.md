# Errata of work package SH6 (program files, file dialog, printer)

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
   and not written yet. Nothing is merged.

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

12. **STDIO_BUFFER (3.8.4, O-15).** Implemented as the document says: whole multiples of 512 bytes are
    committed as soon as that many are pending, the rest stays pending; reads are not buffered. T3
    is asked to confirm (below).

## Contract

C1. **`OpenRequest` cannot carry an initial file name, and `SaveRequest` no start folder.** The
    original's task 58 Open dialog shows the program's name in its File name field; the port's Open
    request has only `startDir`, so the name is not preselected. A Save request without a name has
    no way to start in the program's current directory (`suggested` must name a file), so the Save
    dialog starts in the folder the last dialog ended in. Request (optional, no package depends on
    it): `OpenRequest.initialName?: string` and `SaveRequest.startDir?: VPath`. Until then no adapter
    is needed; the difference is recorded in `docs/differences/SH6.md`.

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
    it from the host side. Test: `program-files.engine.test.ts`, "the Files checks of trap15-a §13"
    (read, not asserted).

E2. **The two defects of the task 58 Save branch (3.8.4: "they are not reproduced"; owner: the
    simulator engine).** `engine/sim/shim/simio.cpp` reproduces both: with an empty `(A3)` the Save
    dialog receives the name of the previous Save dialog (the Open dialog's name is cleared instead),
    and the overflow check measures the Open dialog's name. `ProgramFiles` passes what the engine
    gives (`initialName`); the decision belongs to the engine owner and the document should say which
    holds.

E3. **SH8 (`features/run/session.ts`):** `viewFor` creates one `CachedSyncFiles` per mount and never
    disposes of it; `CachedSyncFiles.dispose()` exists (unsubscribes, cancels timers) for the session
    to call when it ends. Harmless while a session lives as long as its page.

## What T3 is asked to confirm on the official binary (Wine driver)

1. `stdio-buffer.X68` (6.8): after 10 bytes written and not closed, a second open of the file reads
   end of file (`D0.W = 1`); after 600 bytes written in one task 54, a second stream reads 512 (the
   port) or 600 (a large write bypasses the buffer) or 0; after 300 + 300 bytes in two task 54 calls,
   512 or 0; a reading stream that read the file before another stream changed it: does it see the
   old bytes (read buffering, which the port does not model)?
2. The same file open in two slots at once (trap15-a §12 item 11), and task 52 on a file another slot
   holds open (the port allows both).
3. After Rewind, task 57 on a file a forgotten slot still holds: `D0.W = 2` (the port), and a new
   task 51 on it reads end of file.
4. How many Rewinds with a file left open it takes until task 51/52 fail because the Borland run-time
   has no free `FILE` (its stream table): the port never runs out.
5. When the simulator exits, the forgotten streams' bytes are written in the order they were opened.
6. Task 54 with `D2 = 0` (the port: 2) and task 53 with `A1 = $2000`, `D2 = $FFFFFFFF` on a 10-byte file.
7. Names: `DATA.TXT.` and `data.txt ` open `data.txt`; a name with `?` or `*` gives 2 for tasks 51,
   52, 59.
8. Task 52 on `NUL` and `CON` (Windows devices; the port creates ordinary files).
9. Task 10: the job a form feed sends (with a PDF printer as the default printer), to compare the
   page geometry of 3.8.4 (margins 1/8 and 1/11 of the page, cell from Courier New 10).
