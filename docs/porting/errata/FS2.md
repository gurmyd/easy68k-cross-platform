# Errata of work package FS2 (File System Access backend)

Where the code of FS2 (`app/src/fs/fsaccess-backend.ts`, `app/src/features/files-fsaccess/**`)
differs from ARCHITECTURE.md, or fills a gap the document leaves. Entries under "Contract" are for
W1. "Manual checks" lists what only a person with a real folder can prove.

## Document

1. **Where the copies of linked files live (3.8.1, "a folder `/linked/<id>/` in the browser
   store").** They live in a browser store of their own: the IndexedDB database `easy68k-linked`,
   run by FS1's `BrowserBackend` (same records, same durability, same append segments) with its own
   `BroadcastChannel` `easy68k.linked`. Read "in a browser store", not "in My Programs": a copy in
   `easy68k-files` would show up in the Files panel and in exports, and its broadcasts would make
   other windows re-read My Programs. `<id>` is 8 hexadecimal digits. The handles are kept in the
   IndexedDB database `easy68k-fsaccess`, object store `handles`: key `folder` = `{handle, name}`,
   key `link:<id>` = `{id, name, handle, size, mtime}`. Where IndexedDB cannot be opened (3 s at
   most), handles are kept in memory and copies in a memory store; nothing survives a reload then,
   but the real files are written all the same.

2. **What the linked backend does (3.8.2).** Only the file `<id>/<name>` (letter case ignored) is
   tied to the real file; every other path of `/linked` is the copy store.
   - `stat` reports the real file's size and modification time while the browser grants read
     access; otherwise the copy's size with the modification time last seen of the real file.
   - `readFile` reads the real file and refreshes the copy while access is granted (it asks for read
     and write at once when the page has a user activation, so that Save needs no second question);
     otherwise it returns the copy.
   - `writeFile` asks for write access (Save comes from a key press or click, so the browser can
     ask), then compares the real file's size and time with the ones this window last saw. If they
     differ, it refuses with code `io` and the text `"<name>" has been changed by another program
     since this window last read it, so it was not saved. Use Reload to see the other version, or
     Save As to keep yours under another name.` This happens only when `stat` could not look at the
     real file before (after a reload, before access was granted): in every other case `stat`
     already showed the change and the documents asked `'<name>' has been changed outside this
     window. Save anyway?` (3.8.6 rule 3). A real file that is gone is reported (`"<name>" no longer
     exists on this computer ...`), never re-created. After the real file the copy is written.
   - `remove` removes the copy and forgets the link; the real file is never deleted from the port.
   - `appendFile` to the linked file itself reads and rewrites the whole file (nothing appends to a
     source file in practice).

3. **`appendFile` on `/folder` costs time in proportion to the file's size (3.8.1: "Cost must depend
   on data.length, not on the file size").** Through the File System Access API this cannot be
   met: Chromium writes every writable stream to a swap file and copies the existing data into it
   when `keepExistingData` is set. `FileSystemSyncAccessHandle`, which writes in place, exists only
   for the origin private file system and only in workers, not for a folder the user chose.
   Measured by `check-fsaccess.mjs` on this machine (best of 3 x 6): appending 1 kB takes 3-4 ms on
   a 1 kB file and 90-125 ms on a 20 MB file. Consequence for SH6 (the cached view writes back with
   the write-behind helper) and U4 (log files): on `/folder`, batch appends rather than appending
   line by line; a log file of a few hundred kilobytes is unaffected in practice.

4. **What the API cannot say.** Folders have no modification time: `stat` gives `mtime: 0` for a
   folder. There is no read-only flag: `readOnly` is always `false`, and a write to a read-only file
   fails with code `io` (`NoModificationAllowedError` or `NotAllowedError`). Chromium's swap files
   (`<name>.crswap`, beside a file while it is written) are left out of `list`. Modification times
   are milliseconds; a change by another program that keeps the size and falls within the
   resolution of the disk's own clock (FAT: 2 s) is not seen by revalidation.

5. **Permission after a reload (3.8.1, "permission is asked again").** At start nothing is asked:
   `createStartupBackends()` mounts the folder only when `queryPermission({mode: 'readwrite'})` is
   `granted` (Chromium's "Allow on every visit"). Otherwise the feature shows the toast `The folder
   "<name>" was open the last time. Open it again?` with the button `Open folder` (it stays until it
   is dismissed); the button asks the browser inside the click and mounts the folder.
   `requestPermission` is never called without a user activation (`navigator.userActivation`).

6. **The banner of a linked file (3.8.2: "A banner offers `Open the containing folder...`").** It is
   a toast, shown when the file is linked: `"<name>" is opened from this computer: Save writes to
   that file. The listing and the files a program writes stay in the browser. To keep them beside
   the file, open its folder.` with the button `Open the containing folder...`. That button opens
   the folder picker at the file; when the chosen folder holds the file
   (`FileSystemDirectoryHandle.resolve`), every document of the linked file without unsaved changes
   is closed and opened again from `/folder/...`, and a toast says `"<name>" is now opened from the
   folder "<folder>".` A modified document stays linked. A folder that does not hold the file is
   opened all the same, with a toast saying so. A banner inside the editor would belong to E2.

7. **One folder at a time.** `/folder` is one mount. Another folder replaces it only when no open
   document and no loaded program comes from the open one, because the same path would then name a
   file of the other folder; otherwise: `Only one folder can be open at a time. Close what is open
   from "<name>" first (<n> documents and the program in the simulator), then open the other
   folder.` Choosing the open folder again changes nothing. The picker starts in the open folder (or
   the remembered one). There is no "close folder" command; the document names none.

8. **"From this computer..." links in Chromium.** 3.8.5 lists the buttons `From this computer...`
   and `Open folder...`; 3.8.1 says `From this computer...` imports into `/browser/Imported` where
   the API is missing. Where it exists, FS2 registers a provider with the same id `upload` and the
   same caption, which replaces FS1's: the picked files are linked, so that Save writes to them.
   The provider has no `save`: in the Save dialog "Open folder..." is the way to the computer's
   files. The picker gets the request's filters as file types (`*.X68` -> `.X68`; `*.*` is the
   picker's own "All files"). The providers are registered `upload` first, so the buttons appear
   in the order of 3.8.5.

9. **A dropped folder (3.8.5: "offered as the opened folder (`Open this folder?`)").** A message box
   with the folder's name as title and `Open this folder?` as text, Yes / No. The provider tells
   FS1's drop handling that it took the folder also when the answer is No, so that no toast about
   folders follows.

10. **The desktop app.** Electron has `showDirectoryPicker`, but the desktop app works on `/disk`
    with native dialogs: the feature and `createStartupBackends()` do nothing when
    `Platform.kind` is not `web` or `Platform.nativeFileDialogs` exists.

11. **A newly mounted folder is announced** as `Vfs.mkdirp('/folder')`, which writes nothing (a
    mount root) and is reported as a `write` of `/folder`; FS1's Files panel and dialogs list a
    store with its first change (see Contract C1).

12. **Letter case.** Real folders on Windows and macOS ignore letter case, the origin private file
    system does not. The backend passes names to the API as given; `Vfs.resolve` takes the stored
    spelling first, so the port behaves the same on every system.

13. **The launch queue of an installed app** (DV1 erratum 6, W1 erratum 11.3). `LinkedBackend.link
    (handle)` is how a `FileSystemFileHandle` becomes a `VPath` (`/linked/<id>/<name>`, Save writes
    back). Wiring the launch queue to it (manifest `file_handlers`, `features/pwa`) is left to the
    gate that assigns it.

## Contract

C1. **The Vfs reports no mount or unmount.** The Files panel and the dialogs learn of a store
    mounted at run time only from its first change (FS1 `tree-model.ts`). FS2 announces the mount
    with `vfs.mkdirp('/folder')` (entry 11). Proposal: report `mount()` and `unmount()` to the
    subscribers of `/` as a `write` and a `remove` of `/<mount>`, or add `onMountsChange`. Not
    blocking.

C2. **`FileSystemBackend.appendFile`'s cost sentence** cannot hold for the `fsaccess` backends
    (entry 3). Proposal: "Cost must depend on data.length, not on the file size, except for the
    `fsaccess` backends, where the browser copies the file".

## Manual checks (only a person with a real folder can prove these)

The automated check (`check-fsaccess.mjs`) replaces the two pickers by functions that hand out
handles of Chromium's origin private file system, and simulates the permission state after a
reload (see its header). These remain for a person, in Chrome and Edge on Windows and macOS:

1. File > Open > `Open folder...`: Chrome's folder picker appears; after choosing a coursework
   folder, Chrome asks "Let site edit files?"; the folder appears in the dialog and the Files panel.
2. Reload the page: the toast `The folder "<name>" was open the last time. Open it again?`; its
   button shows Chrome's real permission prompt; after "Allow", the folder is back. With "Allow on
   every visit" (Chrome 122 or later) the next reload mounts it without a toast.
3. `From this computer...` with a real `.X68`: the file picker shows the editor's filters; the
   first Save shows Chrome's "save changes to <name>?" prompt; the file on disk has the new text
   (open it in Notepad or TextEdit) with CR LF line ends.
4. Change that file in another editor while it is open in the port, then Save: the question
   `'<name>' has been changed outside this window. Save anyway?`; No leaves the other version.
5. After a reload, change the linked file in another editor, open it again in the port from the
   recent files without touching anything else, then Save: the port refuses with the text of
   entry 2 and the file keeps the other editor's version.
6. Drop a folder from Explorer or Finder on the window: `Open this folder?`; Yes opens it.
7. A read-only file in the folder: Save reports an error and changes nothing.
8. A folder that holds a symbolic link or a Windows junction pointing outside it: nothing outside
   the folder can be opened or written through the link (Chromium does not follow them; to be
   confirmed on each system).
9. Revoke the site's file access in Chrome's site settings while a folder is open: the next Save
   says `The browser does not allow this page to use "<name>" at the moment...`.
10. "Open the containing folder..." on a linked file: the picker starts in the file's folder.
