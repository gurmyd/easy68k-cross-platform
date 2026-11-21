# Errata of work package FS1 (browser store, file dialogs, Files panel)

Where the code of FS1 differs from ARCHITECTURE.md, or the document leaves a gap that FS1 had to
fill. Entries under "Contract" ask W1 for a change of `app/src/contracts/`.

## Document

1. **Records of the browser store (3.8.1).** The table says: object store `files`, key = path,
   value = `{data, mtime}`, appended data as "numbered segment records under the file's key". The
   code keeps exactly that record for the file's bytes and adds three small kinds of record in the
   same object store, with array keys:
   - `["h", rel]` = `{size, mtime, segs}` (the file's head). A file exists when its head exists.
   - `["s", rel, n]` = `{data}` (appended segment n, n = 1, 2, ...).
   - `["d", rel]` = `{mtime}` (a folder; the store must keep empty folders: `mkdirp`, an imported
     `.zip` with empty folders).

   Why: the in-memory index must be loaded at start without reading every file's bytes, and
   `appendFile` must find the next segment number and the new size without reading the file
   record (which would make its cost depend on the file's size). Heads and folders are small and
   are the only records read at start; the head is the only record read by an append. Everything
   happens inside one IndexedDB transaction per operation, so two windows can append to one file
   at once without taking the same segment number (tested under Node and in both browsers).

2. **When segments are merged (3.8.1: "on the next whole-file write or read, or when there are
   more than 256").** A whole-file write replaces them in its own transaction. A read returns the
   concatenation from a read-only transaction and then merges in a separate read-write transaction
   in the background, which reads the head, the file record and the segments again inside itself
   and merges what it finds there (appends made meanwhile included). Reads thus
   never fail or wait because of a merge, and a merge that fails (storage full) loses nothing. The
   same background merge runs after the append that makes the count exceed 256. A merge does not
   change the modification time and is not broadcast (the content is unchanged).

3. **What other windows do with a broadcast (3.8.6 rule 3).** The message is `{rel, kind, mtime}`
   as written. The receiving window does not trust the message for sizes: it re-reads the heads and
   folders at and below `rel` in a read-only transaction (ordered after every transaction made
   before it) and replaces that part of its index, then reports `{rel, kind}` through
   `onExternalChange`. This keeps the index right when several windows write the same file.

4. **Durability.** Every read-write transaction is opened with `{ durability: 'strict' }` and a
   write resolves on the transaction's `complete` event. The document says nothing about this; the
   task requires that an acknowledged write is on disk.

5. **When IndexedDB cannot be used.** `createStartupBackends()` returns a memory store at `/browser`
   (`UnsavedBrowserStore`, kind `browser`, label `My Programs`) when `indexedDB.open` throws, fails
   or takes longer than 20 s (`OPEN_TIMEOUT_MS`). Start-up waits for the database at most 3 s
   (`START_WAIT_MS`, gate I1, review defect "start-up can wait up to 20 s"): a database that has not
   answered by then is mounted as a `PendingBrowserStore`, whose operations wait for the store that
   opening finally gives (the real one, or the memory stand-in after the 20 s), so that the
   application is shown at once. Meanwhile `storageProblem()` gives `My Programs is still opening:
   the browser has not answered yet (another tab of this site may be holding the storage). Your files
   appear here as soon as it answers; what you open or save meanwhile waits for it.`, shown as a toast
   and in the Files panel until the store has opened or given up (then the stand-in's message). `storageProblem(backend)` returns the message, which the Files feature
   shows as a toast at start and permanently in the Files panel:
   `Files are NOT being saved: this browser does not let the page keep files (<reason>; for example
   in a private window, or when storage is blocked for this site). Everything you save is lost when
   this tab closes. Use Export... in the Files panel to keep your work.`
   A write that the browser refuses for lack of space rejects with code `io` and
   `The browser's storage for this site is full, so "<rel>" was not saved. Nothing that was saved
   before has been lost. Delete files you no longer need in the Files panel, or use Export... to keep
   a copy on this computer, then save again.`; the feature also shows it as a toast
   (`BrowserBackend.onProblem`). At start the backend asks for persistent storage
   (`navigator.storage.persist()`), best effort.

6. **Export of a single file (3.8.1: "`Export...` in the Files panel downloads a file, a folder or
   the whole store as a `.zip`").** Read as: a file is downloaded as itself; a folder as
   `<folder>.zip` holding the folder; the store's root as `My Programs.zip` holding the store's
   content at the top level, so that importing it into an empty store gives the same store.

7. **`Import...` (3.8.1, 3.8.5).** The toast for dropped folders says `Use Import... for a folder`,
   so `Import...` must accept a folder. The button opens a menu with `Files or .zip...` and
   `Folder...` (`<input webkitdirectory>`). A `.zip` among the chosen files is unpacked into the
   selected folder; other files are copied as they are. Existing files are replaced only after one
   question for all of them (`Import`: `"<name>" already exists in <folder>. Replace it?` or
   `<n> of the files already exist in <folder>. Replace them?`, Yes / No / Cancel). The reader also
   takes `.zip` files written by other tools (deflate through `DecompressionStream`, code page 437
   names, macOS resource forks skipped) and never writes outside the target folder.

8. **Dialog id `files.name`.** New Folder... and Rename... in the Files panel ask for a name with a
   dialog of their own. 2.7 lists the dialog ids and does not have it.

9. **The default extension rule (editor-ui §6.4, UNVERIFIED).** Implemented as the recommended port
   behaviour: a typed name without an extension gets the request's `defaultExt` while the first
   filter is selected. `defaultExt` is normalised, so the original's malformed `'*.X68'`, `'X68'` and
   `'.X68'` all give `.X68`.

10. **Filters are passed by the openers.** 3.12.3 forbids a feature to import another, so E1
    (`ed.file.open`, `ed.file.saveAs`), SH8 (`sim.file.open`, `openData`) and SH6 (task 58) put the
    filters in the request themselves. `features/files/filters.ts` holds the reference texts
    (`EDITOR_OPEN_FILTERS`, `EDITOR_SAVE_FILTERS`, `EDITOR_DEFAULT_EXT`, `SIM_OPEN_FILTERS`) and
    `parseWindowsFilter()` for task 58's `"desc|pattern|..."` strings; the openers must copy the
    labels exactly, double spaces included. The dialog shows each label verbatim (runs of spaces are
    kept with no-break spaces, because an `<option>` collapses them).

11. **Files dropped in a browser.** A dropped file has no path the port can keep, so it is copied
    into `/browser/Imported/` (as `From this computer...` does) and the copy is opened. An existing
    copy with the same bytes is reused; one with other bytes is replaced only after a question.
    3.8.5 does not say where dropped files go.

12. **The Open dialog's message for a name that does not exist** is the Windows common dialog's:
    `<name>` / `File not found.` / `Check the file name and try again.` (title: the dialog's title).
    The specs give none, since Windows showed it.

13. **Letter case of names (gate I1, review defect "Rename and Import can create names that differ
    only in letter case").** Every store keeps the case it was given, and the Vfs resolves names
    without regard to case (3.8.3). FS1 now treats names that differ only in case as the same name
    everywhere it creates entries: Rename... refuses such a name unless it is the entry itself (a
    change of case only), Import... counts a file in another spelling as existing (the replace
    question) and writes to the stored spelling, folders of an import or a drop are merged into the
    stored spelling, and dropped and uploaded files reuse the stored spelling
    (`features/files/store.ts: storedSpelling`). The document does not say this; without it a
    `.zip` exported to Windows could hold names that collide when unpacked. Gate I1 round 2: two
    items of one import batch whose names differ only in case (a `.zip` made on Linux or macOS)
    are a conflict too: the second one is counted in the replace question, and No keeps the first.

14. **A dropped `.S68` in Simulator mode (sim-ui §8.4, 4.7 step 2).** `RunController.open(path,
    'drop')` asks the `Caution` question itself when a program is loaded. FS1 therefore asks it only
    when the first dropped item is not an `.S68` (the original asks, then ignores the item); for an
    `.S68` the copy into `/browser/Imported` is made first and the controller asks. Asking in both
    places asked twice. Consequence (gate I1 round 2 review): the copy's own replace question, when
    an earlier copy with other bytes exists, comes before `Caution`, and a Cancel there leaves the
    copy in place; recorded in `docs/differences/FS1.md`. Asking `Caution` before the copy would
    need a way to tell `RunController.open` that the question has been answered, which the contract
    does not have.

15. **The desktop app (DV2 errata 1 and 4a; contract additions of gate I1).** When
    `Platform.nativeFileDialogs` exists, FS1 registers it as the provider `native` (which replaces the
    port's dialogs; "From this computer..." is then not offered). A file dropped on the desktop app is
    passed to `Platform.grantDroppedFile`: a file on the disk is opened where it is (Simulator mode:
    loaded where it is, so its listing is found beside it), a folder opens the Open dialog (title
    `Open File`, the editor's five filters, several files) with that folder as start; a `File` the
    main process does not know is copied as in a browser. Gate I1 round 2: a native dialog opened in
    Simulator mode holds the run controller while it is open (3.8.5 last sentence, 4.4.5), because it
    does not pass through `ctx.dialogs.open`, which holds the port's own dialogs; and the native Save
    dialog receives `defaultExt` normalised (`'*.X68'` becomes `'.X68'`, entry 9), since the desktop
    main process appends only a plain extension.

16. **`FileDialogs.chooseFolder` (H1's request, contract addition of gate I1).** The native provider's
    folder dialog where there is one. Without it (a browser) the port's Save dialog is shown in
    folder mode (gate I1 round 2 review: before, a typed existing folder was entered, so only a new
    folder could be chosen): it starts in `startDir`, lists only folders (filter `Folder`), and its
    button is `OK`. OK with an empty name takes the selected folder, or the folder shown when none is
    selected; a typed existing folder is taken; a typed new name is created; a typed file is refused.
    The native provider's `chooseFolder(title)` (contracts/platform.ts) takes only the request's
    title, so a native folder dialog does not start in `startDir`.

## Contract

Status at gate I1: C1 and C2 are in the contract (`Vfs.mkdirp`, `SaveRequest.overwritePrompt`), and
C3 as `Platform.nativeFileDialogs` and `Platform.grantDroppedFile` (W1 errata entry 11). FS1 uses
all of them now: `makeFolder` calls `vfs.mkdirp`, `dialogs.ts` reads the contract's
`overwritePrompt`, and the `native` provider and desktop drops are entries 15 and 16 above.

C1. **`Vfs` has no `mkdirp`.** New Folder... and importing a `.zip` with empty folders need one. FS1
    calls `backend.mkdirp(rel)` of the mounted backend (`features/files/store.ts: makeFolder`). The
    Vfs then reports no local change; the Files panel refreshes itself, and other windows hear of it
    through the backend's broadcast. Request: add `mkdirp(path: VPath): Promise<void>` to `Vfs`,
    reported to subscribers as a `write` of the folder.

C2. **`SaveRequest` cannot carry its own overwrite question.** The contract says `save()` resolves
    with the overwrite already confirmed, and FS1 asks the editor's `File exists! OK to overwrite?`
    (`Caution!`). The Memory panel's Save (sim-ui §10) asks `File exists! OK to replace?` with the
    title `Alert`. FS1 reads an optional `overwritePrompt?: { title: string; text: string } | null`
    from the request (null = ask nothing). Request: add that field to `SaveRequest`, so that U2 can
    pass it without a cast.

C3. **The desktop app's native dialogs and dropped paths.** 3.8.5 says the desktop app uses the
    native dialogs and that a folder dropped there becomes the start folder of the Open dialog. The
    `Platform` contract has no dialog methods and no way to learn the real path of a dropped `File`
    (Electron's `webUtils.getPathForFile`), and no package is assigned to register the `native`
    provider (`platform/desktop.ts` cannot register a feature's provider). FS1 uses a registered and
    available provider with id `native` for both dialogs when one exists; until then the desktop app
    gets the port's own dialogs, which list `/disk` like any other store, and dropped files are
    copied into the browser store as in a browser. Request: `Platform.showOpenDialog(request)`,
    `Platform.showSaveDialog(request)` (null on the web) and `Platform.pathForFile(file)`, after
    which FS1 registers the `native` provider itself.
