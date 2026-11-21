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
   or takes longer than 20 s. `storageProblem(backend)` returns the message, which the Files feature
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

## Contract

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
