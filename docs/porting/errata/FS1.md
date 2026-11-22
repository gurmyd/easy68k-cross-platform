# Errata of work package FS1 (browser store, file dialogs, Files panel)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum FS1 <n>" or naming this file: 1, 2, 4, 5, 6, 7 (ARCHITECTURE.md 3.8.1); 3 (ARCHITECTURE.md 3.8.6); 8 (ARCHITECTURE.md 2.7 (with Q1 4)); 10, 11, 12, 14, 15, 16, 17 (ARCHITECTURE.md 3.8.5); 13 (ARCHITECTURE.md 3.8.3). Nothing to merge, because no statement of a document is wrong or missing: 9 (implements the behaviour editor-ui §6.4 recommends; nothing to correct); 18, 19, 20, 21, 22, 23 (records of the browser check and of gate rounds); C1, C2, C3 (contract entries, applied by W1 at gate I1; `app/src/contracts/` is the authority).

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
    **Gate I2 round 1:** the contract has it now (`RunController.confirmLoad`, `LoadOptions.confirmed`;
    docs/requests/W1-load-confirm.md). A dropped `.S68` that is copied (a browser) first calls
    `confirmLoad('drop')`; on Cancel nothing is copied and nothing is loaded; on OK the file is copied
    (with its own replace question) and loaded with `open(copy, 'drop', { confirmed: true })`. A file
    loaded where it lies (the desktop app), or a controller without `confirmLoad`, keeps the old order
    (open asks). Tested in drop.test.ts, index.test.ts and check-files.mjs.

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
    title, so a native folder dialog does not start in `startDir`. **Gate I2 round 1:**
    `NativeFileDialogs.chooseFolder(title, startDir?)` has the second argument now, and the native
    provider passes `FolderRequest.startDir` when the request has one.
17. **`app.files.toggle` with `FilesRevealArg` (contracts/commands.ts, gate I1 round 2; round 3).**
    With `{ reveal: VPath }` the handler shows the Files panel (never hides it) and reveals the path;
    any other argument toggles as before. A hidden panel is not mounted, so it cannot take the
    request at once: `features/files/reveal.ts` keeps the latest such request and hands it to the
    panel when it mounts (also when the command is run in Simulator mode and the panel mounts on
    the switch back to Editor mode). `revealInFilesPanel(ctx, path)` of FilesPanel.tsx keeps its
    meaning (false when the panel is not mounted; nothing is kept). Help > Examples... can now call
    `ctx.commands.run('app.files.toggle', { reveal: '/browser/Examples' })` (H1).
    **Gate I2 round 1 (review of I1 round 3: a remembered request stayed pending forever):** a
    remembered request now waits at most `PENDING_REVEAL_MS` (5 s) for the panel to mount, and a
    toggle without a path drops it. A request made in Simulator or EASyBIN mode (Help > Examples...
    is in all three menus; the Files panel exists only in Editor mode) waits for the next switch to
    Editor mode and gets its 5 s from then.
18. **The download name of Export... in WebKit on Linux (gate I1 round 2 defect, round 3).** The
    port names the whole-store export `My Programs.zip` (the store's label, 3.8.1) and keeps it.
    CI run 44919519853 (commit c4d3dfa) records, through a wrapper of `HTMLAnchorElement.click`, the
    `download` attribute the page sets: `My Programs.zip` in Chromium and WebKit on Ubuntu, macOS
    and Windows (the Files check passed 134 of 134 on all three). Playwright's `download.suggestedFilename()` reports `My Programs.zip` everywhere except
    WebKit on Ubuntu, which reports `My_Programs.zip`. Playwright's client passes WebKit's
    `Playwright.downloadFilenameSuggested` value through unchanged (playwright-core 1.65.1,
    lib/coreBundle.js), so the rewrite happens inside Playwright's WebKit build for Linux
    (WebKitGTK/WPE); upstream WebKit's own filename sanitising (ResourceResponseSoup.cpp
    `sanitizeFilename`, WebKitDownload.cpp) replaces only `/`, `\`, `"`, `~`, `*`, `:`, `<`, `>`,
    `?`, `|` and control characters, not spaces, so the exact line is in Playwright's patches and was
    not identified. Safari is the macOS WebKit, which reports `My Programs.zip`: a person using
    Safari gets `My Programs.zip`. Decision: the name stays; check-files.mjs requires the page to
    ask for exactly `My Programs.zip` in every browser and accepts the reported `My_Programs.zip`
    only from WebKit on Linux; its detail names the browser build and the system.
19. **The "store still opening" banner on a loaded machine (round 3).** A store whose database does
    not answer says `My Programs is still opening...` until OPEN_TIMEOUT_MS (20 s) after opening
    began, then gives up and says `Files are NOT being saved...` (fs/browser-backend.ts). On this PC
    one WebKit run read the panel only after the 20 s had passed and failed the check although the
    product did what it guarantees. check-files.mjs now records when the page first called
    `indexedDB.open` and requires each reading to show the message that belongs to its time; its
    detail lists every reading with its time and says when none came before the limit.
    **Gate I2 round 1 (review of I1 round 3: the banner could pass without ever being seen):** the
    page itself now records, with a MutationObserver installed before the application starts, when
    the Files panel first shows `still opening`, measured from the first `indexedDB.open`. A new check
    requires that time to be under the 20 s limit in at least one of the (up to three) attempts, so
    the message is always verified, independently of how late the check's own reading comes.
20. **The Files check with FS2 present (round 3).** In Chromium FS2 (features/files-fsaccess)
    replaces the provider `upload` ("From this computer...") with the system file picker and adds
    "Open folder..." to the dialogs, as its design allows (providers.ts: one provider per id, a later
    one replaces it). Playwright cannot answer the system picker, and `Open` no longer named one
    button. check-files.mjs now runs its dialog pass with the File System Access API removed (what
    WebKit and Firefox have, so FS1's own provider is tested in both browsers) and names buttons
    exactly. FS2's check covers the Chromium pickers.
21. **The Open dialog's note with FS2's "From this computer..." (gate I2 round 1, FS2 review).** In
    Chromium FS2's provider of the same id links the chosen files instead of copying them, so the
    sentence `From this computer... copies files from this computer into My Programs/Imported.` was
    wrong there. FS1 marks its own provider (`providers.ts: markImportingUpload`), and the note
    carries the sentence only while that provider is the one registered. check-files.mjs checks the
    note against the provider actually registered in the page.
22. **A linked file's display path (gate I2 round 2; review of round 1).** `displayPath` returned the
    raw VPath for `/linked/<id>/prog.X68`, because `locations()` hides `/linked` (the folder is the
    port's own copy). It now names a linked file by what follows its id, under the linked backend's
    label (FS2's `LINKED_LABEL`, `Linked files/prog.X68`), and never shows `/linked/` or the id
    (`store.test.ts`). The window's bottom status line, where the review saw the internal path, is
    not FS1's: `EditorWindowStatus` (ui/editor/EditorStatusBar.tsx, E2) shows `doc.path` itself and
    cannot import a feature; that part is reported to E2.
23. **Each pass of check-files.mjs has a time limit (gate I2 round 2; config's note on CI run
    44937920498).** `page.evaluate` has no time limit in Playwright, and the check once waited 39
    minutes in WebKit after "a page killed in the middle of a write" until CI cancelled the job. Every
    pass now runs under `PASS_LIMIT_MS` (6 minutes; the passes took 1.2 to 60.4 s here, WebKit the slower) and fails with
    the last step it reached (the kill pass reports each step per delay); the browser's remaining
    passes are then skipped. The cause of that one WebKit hang is not known: it did not recur here.
24. **The contract members of gate I2 (contracts engineer's and SH6's requests).** `dialogs.ts` now
    honours `OpenRequest.initialName` (the File name field starts with it; absent, it starts empty
    as before) and `SaveRequest.startDir` (the folder a Save dialog starts in when `suggested` gives
    none; `suggested` wins), and implements `FileDialogs.linkFileHandle(handle)`: the first
    available registered provider that has `linkFileHandle` links the file, null when none has
    (FS2 has none yet, so the launch queue of DV1 gets null until FS2 adds it to its provider).
    Tested in `dialogs.test.ts`; the initial name also in `check-files.mjs` in both browsers.
    `DroppedFolderProvider` stays as it is (the contract's optional `openDroppedFolder` has the
    same signature, so both describe the same providers).
25. **A case-only rename where the folder above may not be listed (docs/requests/W1-case-only-rename.md;
    review of the repair of D1).** Since W1's erratum 15.1 `vfs.resolve` keeps the given spelling of
    a segment whose folder may not be listed, so for a granted root on `/disk` it returns the new
    spelling (`.../DEMO`), not `from`, and `renameEntry` refused the rename as "already exists". It
    now compares with `foldCase`. The request expected the rename to succeed then; it cannot on the
    real `/disk`: a case-only rename goes through a temporary name beside the entry, which for a
    granted root lies outside the grant, and the main process refuses that (and `stat` there). So
    `renameEntry` lists the parent first when the rename is case-only and reports the refusal before
    anything is copied or removed; without that, a store that let the temporary folder be written
    but not read would have been left with the files only under the temporary name. A case-only
    rename below a granted root works as before. Tests: `store.test.ts`, "renameEntry: a change of
    letter case of a granted root on /disk" (a disk that ignores case and refuses everything outside
    the grant, with and without guarded writes).
26. **Cancel in New Folder... and Rename leaves the focus where it was (Q1-1, `docs/integration/rc.md`;
    2.10).** `FilesPanel.tsx` focused the tree after either dialog whatever the answer, so Cancel of
    New Folder... left the focus on the tree instead of the button. The tree now takes the focus
    only when a folder was made or an entry renamed; on Cancel the dialog service's own focus
    return stands. `check-files.mjs` checks both cases and that OK still moves the focus to the
    tree with the new folder selected.
27. **Import > Files... and "From this computer..." dropped files that arrived late (round before
    I3; found going through the import paths as a person would, after the owner's folder import
    defect of commit 5f16615).** `pickFiles` still had, for files, the fallback that had dropped the
    folder import: one second after the window got the focus back without a `change`, it took the
    choice for cancelled. A browser hands the files over only after it has read them, which can be
    later (a file in iCloud Drive or on a network share is fetched first; a loaded machine). The
    files were then dropped without a word. Reproduced in Chromium and WebKit with the files
    handed over 2.5 s after the focus came back (`build/FS1/probe-import-delay.mjs`: "DROPPED" in
    both; "imported" with the repair). The fallback is gone: a choice ends only with `change` or
    `cancel`, which every supported browser sends (Chromium 113, Safari 16.4, Firefox 91 or
    later; the user guide asks for macOS 14, whose Safari is 17). `check-files.mjs` checks the late
    files and that a cancelled chooser still ends the choice.
28. **The Safari storage notice (risk R-10; the gate's decision of the second round before I3).**
    Built in `features/files/storage-notice.ts` (decision, texts, environment) and `FilesPanel.tsx`
    (a `role=note` named `About keeping your programs` between the strip and the tree; no
    dialog, takes no focus, blocks nothing; third round: the same text as a toast at the first write
    when the panel is not on the screen, below).
    - **When.** `storageNoticeKind({ platform, engine, installed, store, storeEmpty, acknowledged,
      automated, forced })`: only `platform` `web`; only engine `webkit`; only while /browser is the
      browser's own store (`BrowserBackend`, or a `PendingBrowserStore` still opening, which almost
      always becomes one; never the memory stand-in, whose own message says nothing is kept, and
      never without a browser store); never once acknowledged. In a tab: `tab`. Installed: `installed`
      only when the store had no entry when the window first listed it (decided once per window, so
      an import does not take the notice away before `Got it`; after a reload a filled store shows
      none). Under automation only with the address parameter. Unit tests decide all 512
      combinations against the rule written out again.
    - **What is tested for the engine.** `navigator.vendor === 'Apple Computer, Inc.'`, the string
      every WebKit browser reports (Safari on macOS, iOS and iPadOS, every other browser on an iPhone
      or iPad, WebKitGTK, Playwright's WebKit); Chromium-based browsers report `Google Inc.`, Gecko an
      empty string. The product name in the user agent is not read. Installed:
      `matchMedia('(display-mode: standalone)')` or iOS's `navigator.standalone`.
    - **Automation.** `navigator.webdriver` true hides the notice, so every other check sees the
      panel it always saw, unless the query has `storage-notice=1` (`STORAGE_NOTICE_PARAM`), which
      shows it as for a person; the parameter does not overrule the engine or the acknowledgement.
    - **Remembered.** `Got it` sets `AppSettings.storageNoticeSeen = true`: the per-browser part of
      the settings (one `localStorage` document for every window; not `app.layout`, the one
      per-window setting). The key is optional and has no default: this package added exactly that
      one optional member to `contracts/settings.ts` (allowed for this round); the settings service
      keeps a key it has no default for, so `defaults.ts` (W1) is unchanged. Any stored value but
      `true` counts as not acknowledged. The focus moves to the tree when `Got it` had it.
    - **Buttons.** The gate asked for "the existing command that exports the whole store as a .zip
      (use its real caption)": no command of that name exists; the store's export is the panel's
      `Export...` with the store root, so the notice's button has that caption and exports
      `/browser` whatever is selected (`My Programs.zip`). The installed variant's button is the
      panel's `Import...`, which goes straight to the file chooser of "Files or .zip..." and imports
      into the store's root (the menu's second item, a folder, is not what the notice is about).
      Both buttons have `tabIndex=0` (WebKit's Tab rule) and sit between the strip and the tree in
      the Tab order.
    - **Texts** (constants in `storage-notice.ts`):
      - tab (`STORAGE_NOTICE_TAB_TEXT`): `This browser may delete the programs kept here after seven
        days without a visit to this page. An app made with "Add to Dock" or "Add to Home Screen"
        starts with its own, empty My Programs. Use Export... in the Files panel to save them all as a
        .zip, and Import... in the app to bring them over.`
      - installed (`STORAGE_NOTICE_INSTALLED_TEXT`): `This app keeps its own programs, apart from the
        browser's: Import... in the Files panel brings over programs exported there.`
      - name of the note (`STORAGE_NOTICE_LABEL`): `About keeping your programs`.
      (Texts of the third round; the second round's said "Safari deletes", "\"Add to Dock\" makes a
      separate app", "Export... here" and "separate from Safari's", and the note was named "About
      keeping programs in Safari".)
      - buttons `Export...`, `Import...`, `Got it`.
    - **Checks.** `storage-notice.test.ts` (Node). `check-files.mjs` pass "the Safari storage
      notice" (both browsers): absent under automation without the parameter; absent in Chromium
      with it; in WebKit present at the first start with the exact text, named, not focused, above
      the tree; Tab order strip > Export... > Got it > tree and back; Export... downloads `My
      Programs.zip` whose files equal the store's bytes; axe clean in both themes; Got it hides it,
      sets the setting, gives the tree the focus, the panel's geometry then equals that of a page
      that never showed it; not shown after a reload nor in a second window; installed variant with
      an empty store (Import... brings the .zip over byte for byte, the notice stays until Got it,
      not shown after a reload with a filled store; Got it remembered with the store still empty).
      `tests/e2e/app/storage-notice.spec.ts` (X1) checks the same essentials on the production
      build. Screenshots: `build/FS1/files-check/webkit-storage-notice-*.png`.
    - `check-files.mjs` also takes `--pass <text>` (run only passes whose label contains it), an
      addition for working on one pass; CI runs all of them.
    - **Third round before I3 (review of the second round, two minor points).**
      - *True wherever it is shown.* The notice is shown in every WebKit browser: Safari on a Mac,
        and every browser on an iPhone or iPad, where the menu item is "Add to Home Screen" and
        Chrome, Firefox and Edge are WebKit but not Safari. The second round's texts said "Safari
        deletes" (false in Chrome on an iPad) and named only "Add to Dock" (false on an iPhone). Now
        no sentence names Safari; the storage rule is "may delete" (WebKit's seven-day rule is
        Safari's Intelligent Tracking Prevention, which other WebKit browsers may or may not apply);
        both menu items are named, as the names of the apps they make; and the buttons are placed
        "in the Files panel", which is true in the panel and in the note of the next point. A unit
        test fixes the exact texts and that none says "Safari" or "Export... here".
      - *Seen before or when the first file is written.* The notice lived only in the Files panel,
        which may be hidden (its visibility is remembered) or absent (a first visit that starts in
        Simulator mode with `?open=`), so a document could become the only copy without the notice
        ever having been on the screen (R-10: "documents are never the only copy without that notice
        having been shown"). Chosen: **the same text as a note where the person is looking, at the
        first write.** `watchFirstWrite` (feature init) listens to `/browser`; at the first write of a
        file by this window (origin `local`, a path below `/browser`, not the mount itself) while a
        notice is due (`storageNoticeKind`) and has not been on the screen in this window, it shows
        a toast with the notice's text and the action `Got it` (the panel's `Got it`: the same
        setting), duration 0 (it stays until it is answered or closed), once per window. "On the
        screen" is: the panel's notice was visible for a second (`markStorageNoticeSeen`; a panel of
        Editor mode that is mounted but hidden, as in a start that goes on to Simulator mode, does not
        count), or it is visible at the moment of the write. Why this and not "show the Files panel
        once at such a start": that does not help in Simulator mode, which has no Files panel, and it
        would change the remembered layout of a person who hid the panel; the note changes nothing
        for anyone to whom the notice is not due (another engine, the desktop app, a store that
        keeps nothing, after `Got it`, under automation without the parameter), appears only when a
        file is really written, and says the same as the panel. The pure rule is
        `noticeAtWrite({ due, seen, change })`: its table (120 combinations) and the watcher's cases
        (hidden panel, installed app with an empty or a filled store, seen, acknowledged, Chromium,
        automation, desktop) are in `storage-notice.test.ts`; `check-files.mjs` pass "the storage
        notice at the first write" proves in WebKit: Files panel hidden before the first start with
        the parameter, the first write shows the note with the exact text and `Got it`, it stays
        past a toast's default 8 s, a second write adds nothing, its `Got it` sets the setting and
        the panel shown again has no notice; a first visit in Simulator mode (`?open=` an `.S68`)
        shows no Files panel and no note until the first write, then the note (axe-scanned); with
        the panel's notice on the screen a write shows nothing; and in Chromium nothing at all.
      - *The audit.* `tests/a11y` opens the page with `?storage-notice=1` in WebKit in both themes
        (`openApp` takes a query; `storageNoticeStep` in `lib/scan.mjs`): axe scan, a named note
        with two named buttons, no live region, no focus taken, Tab reaches both buttons with a
        visible focus.
      - The engine rule `engineOf` moved to `core/help/engine.ts` (erratum H1 11), where the Help
        frame uses it too; `storage-notice.ts` re-exports it under the same name.

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
