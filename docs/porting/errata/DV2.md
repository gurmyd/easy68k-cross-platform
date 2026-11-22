# Errata of DV2 (Electron shell)

> **Merge status (DOC1, 2026-11-21; completed in its repair round 1).** Every entry of this file has been read. Merged into the documents, each place marked "erratum DV2 <n>" or naming this file: 4 (ARCHITECTURE.md 5.7); 6, 7, 10, 11, 13a, 14, 15 (ARCHITECTURE.md 7.6); 8 (ARCHITECTURE.md 3.3.4); 9 (ARCHITECTURE.md 3.8.1); 9a (ARCHITECTURE.md 3.8.4); 12, 13 (ARCHITECTURE.md 3.13). Nothing to merge, because no statement of a document is wrong or missing: 1, 2, 3, 4a (contract entries, taken into `contracts/platform.ts` by W1 at gate I1 (`nativeFileDialogs`, `userDataDir`, device sources, `grantDroppedFile`); `app/src/contracts/` is the authority, and the desktop behaviour is in ARCHITECTURE.md 3.8.5 (erratum FS1 15)); 5, 16 (records of tests).

What DV2 found while building the desktop shell from `docs/ARCHITECTURE.md` 2.1, 3.3.4, 3.8.1,
3.8.4, 3.8.6, 3.13, 5.7, 6.7 and 7.6: where the document is silent or contradicts itself, what the
repository does, and why. Entries under **Contract** concern declarations that other packages
compile against; W1 is asked to take them into `app/src/contracts/`.

## Contract

### 1. The native file dialogs have no place in `Platform` (3.8.5, 3.13, 7.6)

- Says: 3.8.5 "Desktop: the native dialogs; the folder of a chosen file becomes a granted root."
  7.6: granted roots are "folders the user chose in a native dialog". `Platform` (3.13) has no
  dialog member, and `features/files` (FS1), which "is the only place that opens file dialogs",
  may not import `platform/`.
- Does: `createDesktopPlatform()` returns a `DesktopPlatform` (`app/src/platform/desktop.ts`), a
  `Platform` with the extra member
  `nativeFileDialogs: { open(OpenRequest): Promise<VPath[] | null>; save(SaveRequest): Promise<VPath | null>; chooseFolder(title): Promise<VPath | null> }`.
  The main process shows the dialog as a sheet of the window, adds the folder of every chosen file
  (or the chosen folder) to the granted roots and returns VPaths of `/disk`. `save` appends
  `defaultExt` when the user typed no extension; macOS asks about overwriting itself. Since gate
  I1 round 2 `defaultExt` may be spelled `X68`, `.X68` or the original's `*.X68`, as
  `SaveRequest.defaultExt` in `contracts/fs.ts` says (`withDefaultExtension` in
  `desktop/src/security.ts`); before, `*.X68` appended nothing.
- For W1: add `readonly nativeFileDialogs: NativeFileDialogs | null` to `Platform` (null on the web)
  with the interface above. For FS1 meanwhile: `'nativeFileDialogs' in ctx.platform` finds it;
  a `FileSourceProvider` with id `native` can wrap it.

### 2. The user-data folder (3.8.2)

- Says: a never-saved document lives in `/disk/<userData>/Untitled` in the desktop app.
  `Platform` does not say where `<userData>` is.
- Does: `DesktopPlatform.userDataDir` is the VPath of Electron's `app.getPath('userData')`, which
  is a granted root from the start.
- For W1: `readonly userDataDir: VPath | null` on `Platform`.

### 3. `Platform.serial` and `Platform.net` cannot be built from what the platform has (3.3.4, 3.13)

- Says: `Platform.serial: HostSerial | null`, `net: HostNet | null`, "desktop only". W1's
  `DesktopSerial` needs `{ bridge, portMap: () => AppSettings.serialPortMap }` and `DesktopNet`
  `{ bridge, memory: () => engine.memory }`. The platform is created before the settings service
  and long before any simulator engine.
- Does: `desktop.ts` builds both with the preload script's bridge and with `portMap` and `memory`
  that read through sources bound later: `DesktopPlatform.bindDeviceSources({ portMap, memory })`
  (until then an empty map and an empty memory). `DesktopPlatform.deviceBridge` is the
  `DesktopDeviceBridge` itself.
- For W1 and SH8: either `Platform.deviceBridge: DesktopDeviceBridge | null` and the simulator
  session constructs `DesktopSerial` / `DesktopNet` with its own settings and engine (cleanest),
  or `bindDeviceSources` in the contract. Whoever composes the host (SH8) must call one of them;
  today nothing does, so the desktop devices see no port map and no memory (harmless while they
  are W1's stubs).

### 4. Files from outside arrive as VPaths (3.13, 5.7)

- Says: `StartupArgs.file`: "desktop: path from argv or the open-file event";
  `onOpenFiles(listener: (files: string[]) => void)`.
- Does: both carry VPaths of `/disk` (`/Users/me/x.X68` arrives as `/disk/Users/me/x.X68`), so
  that `DocumentService.open(path: VPath)` takes them as they are. A command-line file that does
  not exist gives `file: null` (5.7: "Otherwise a new document"). The switches `/r /f /e /b` count
  from the second argument on, in any letter case, and only with the slash, as SIM68Ku.cpp compares
  `LowerCase(ParamStr(i))` with `"/r"` etc. (sim-ui 8.1). (Until verify round 1 `-r` was accepted
  too; that deviation is gone.)
- For W1: say "a VPath of `/disk`" in the comment of `StartupArgs.file` and `onOpenFiles`.

### 4a. Files dropped on the window have no path in the page (3.8.5, 7.6)

- Says: 7.6 counts "the folder of a file the user ... opened through ... a drop" among the granted
  roots; 3.8.5 makes a dropped folder the start folder of the Open dialog. A sandboxed page's `File`
  has no real path, and nothing in `Platform` turns a dropped `File` into a VPath.
- Does: `DesktopPlatform.grantDroppedFile(file: File): Promise<{ path: VPath; kind: 'file' | 'dir' } | null>`
  (bridge member `grantDroppedFile`). The preload script takes the path from
  `webUtils.getPathForFile` (empty for a `File` the page made itself, which is refused); the main
  process checks that it names an existing file or folder, grants the folder of a file (never a
  dropped folder itself) and returns its VPath of `/disk`.
- For W1: add `grantDroppedFile` (null on the web) to `Platform`. For FS1 (drops, 3.8.5):
  `'grantDroppedFile' in ctx.platform` finds it meanwhile; call it for each dropped `File` before
  opening `path`, and use a `dir` entry as `startDir` of the native Open dialog.

### 5. Who opens the files of `Platform.onOpenFiles` and `startupArgs()`

- Not an error of the document, but it decides the acceptance item "an open-file event opens the
  document": the platform delivers the path; another package's feature opens the document.
  `tests/desktop/dev/windows.spec.ts` asserts both. During DV2's work a subscriber appeared in the
  shared tree and the test passed on Windows (a `.X68` became a document); DV2 did not check which
  package's code did it, nor the `.S68` branch of 5.7 (Simulator mode, started afresh, load
  without running).

## Decisions where the document is silent

### 6. Start-up information is asynchronous

- 7.6: synchronous bridge calls only for program files, device control and the flush at close.
  The page needs the OS, the start-up arguments and the user-data folder before it starts, so
  `createDesktopPlatform()` asks once with `ipcRenderer.invoke` and returns a Promise (main.tsx
  accepts `Platform | Promise<Platform>`). No synchronous call is used for anything else.

### 7. What `window.easy68kDesktop` holds (7.6 "a fixed set of functions", 3.13)

- Fixed in `DESKTOP_BRIDGE_KEYS` (`app/src/platform/desktop.ts`): `version`, `startup`, `fs`,
  `fsSync`, `onFsChange`, `setMenu`, `onMenuCommand`, `onOpenFiles`, `setTitle`, `openExternal`,
  `showHelp`, `newWindow`, `pasteIntoFocus`, `quit`, `setFullScreen`, `onFullScreenChange`, `print`,
  `showOpenDialog`, `showSaveDialog`, `chooseFolder`, `grantDroppedFile`, `devices` (`{ request, on }`,
  the `DesktopDeviceBridge` of W1). `onFullScreenChange` (gate I1, for the contract's optional
  `Platform.onFullScreenChange`) carries the window's `enter-full-screen` and `leave-full-screen`
  events on the channel `e68:full-screen-change`.
- Gate I1: `NativeFileDialogs`, `DroppedEntry` and `DesktopDeviceSources` are contract now
  (`contracts/platform.ts`, W1 errata 11); `platform/desktop.ts` re-exports them instead of declaring
  its own (its `DeviceSources` is an alias of `DesktopDeviceSources`).
  `tests/desktop/dev/security.spec.ts` compares the page's object with this list (DV3's check 2 can
  use the same list).
- Every handler checks that the message comes from the main frame of an application window the
  main process created and that the frame shows the app's page (`app://easy68k` or the dev server);
  anything else is refused (null, false, `{ ok: false, code: 'io', message: 'refused: ...' }`).

### 8. Device channels for DV4 (3.3.4)

- `desktop/src/sync-ipc.ts` exports `registerDeviceHandler(channel, (sender, ...args) => reply)`
  and `sendDeviceEvent(webContents, channel, ...args)`. Channel names are `<device>.<call>`
  (`serial.open`, `net.receive`), letters, digits and `-`. `request` is one `sendSync`; the reply
  is wrapped so that `undefined` is a reply too. A channel without a handler answers `undefined`.
  `sender` identifies the window, so each window has its own devices (3.8.6).

### 9. Errors of the disk backend

- A path outside the granted roots is rejected with the FsErrorCode `io` and a message starting
  with `refused:` (the list of codes has none for "not allowed"; `io` covers "permission withdrawn").
  The synchronous view answers such a call like a missing file (null / false), as 3.8.4 says.
- Granted roots are compared after resolving symbolic links: a link inside a granted folder that
  points outside it is refused. Letter case is ignored in the comparison on Windows only.
- `DiskBackend.label` is `This Mac` (`This Computer` on other systems); the document gives no text.
- `onExternalChange` exists: the main process reports every write and remove made through its
  handlers (asynchronous and synchronous) to the other windows (3.8.6 rule 3). Changes made by
  other programs are not reported.

### 9a. Names of folders that no listing contains (8.3 short names)

- The synchronous `resolve` gives each existing segment of a path its stored spelling, found in the
  listing of its parent. A segment that no listing contains but that exists all the same is
  another name of the same entry: a Windows 8.3 short name (`RUNNER~1` for `runneradmin`), which a
  student's path can contain too; or a folder that may be entered but not listed. It is kept as
  given and the walk goes on below it. Before gate I1 the walk stopped there, so every later segment
  kept the program's spelling (`SUB.DAT` where `Sub.Dat` was stored: three red unit tests on GitHub's
  Windows runner, whose temporary folder is `C:\Users\RUNNER~1\...`).

### 10. The native menu on Windows and Linux

- 7.6 describes the macOS menu bar. Electron also runs on Windows and Linux, where these tests run
  as well: each window gets its own menu, with the menu bar hidden (the page shows its in-window
  menu bar); the menu-level roles are not applied and the macOS-only item roles (`services`,
  `hide`, `hideOthers`, `unhide`, `zoom`, `front`) are left out; command accelerators carry
  `registerAccelerator: false`.
- Keys that reach the menu on macOS: only the chords of the role items that the window's own menu
  has (`roleChordsOf` in `desktop/src/menu.ts`, taken from each description the page sends; out of
  Cmd+Z, Shift+Cmd+Z, Cmd+X, C, V, A, Cmd+M, Cmd+H, Alt+Cmd+H). In Editor mode Undo and Redo are
  command items (`ed.edit.undo`, `ed.edit.redo`), so Cmd+Z and Shift+Cmd+Z stay with the page there;
  in Simulator and EASyBIN mode the standard Edit menu has the `undo` and `redo` roles and they go to
  the menu (gate I1 review: a fixed list let the Editor's Undo item take Cmd+Z and drop the click as
  `triggeredByAccelerator`). Before a window's page has sent a menu, the whole list applies.
  `setIgnoreMenuShortcuts` is set for each key-down in `before-input-event`. On Windows and Linux no key reaches the menu. A key is
  judged by the character it types (`input.key`), as macOS matches key equivalents, so Cmd+C works
  on Dvorak (where "c" is on the key `KeyJ`) and AZERTY; by its position (`input.code`) only when it
  types no ASCII letter or digit (Option held, non-Latin layouts).
- macOS with no window open: the last window's menu would stay in the bar with commands that reach
  no page. When the last window's menu is forgotten the bar gets a small menu of its own
  (`windowlessMenuTemplate` in `desktop/src/menu.ts`): the application menu, `File > New Window`
  (Cmd+N, opens a window) and the Window and Help menus. The page's own menu replaces it as soon as
  a window sends one.
- A command item's Electron id is `<command id>` or `<command id>:<JSON of arg>`.

### 11. Help window (1.4 note 10, 3.13 `showHelp`, 7.6)

- 7.6 puts the help pages into an `iframe` with `sandbox="allow-same-origin"`; that is the Help
  panel of the web app. The desktop's "help window" is a separate window per application window
  that loads `app://easy68k/help/<page>` with JavaScript switched off and no preload script. Links
  inside the help stay in the window; links to the allowed sites open in the system browser after
  a confirmation; every other navigation is cancelled. `showHelp(page)` returns false for a name
  that is not a relative `.htm`/`.html` path inside the help folder.
- Links with `target="_blank"` (H1 errata 10: the import adds it to the links to the web and to
  the Quick Reference PDF) ask for a new window, which is never created: a file of the help folder
  (another page, `EASy68KQuickRef.pdf`) is shown in the help window itself, by Electron's PDF
  viewer for the PDF; an allow-listed web address goes to the system browser after the same
  question as a followed link; anything else is refused (`helpLinkAction` in `security.ts`).

### 12. Leaving with unsaved work (3.8.4 `confirmBeforeUnload`)

- The desktop platform installs the same `beforeunload` guard as the web one. The main process
  answers Electron's `will-prevent-unload` with a native question: `Leave EASy68K?` /
  `Changes you made may not be saved.`, buttons `Leave` and `Stay` (Stay is the default). The
  document gives no text.
- Gate I1: `confirmBeforeUnload(needed, who?)` (W1 errata 11) keeps the guard while any named party
  (`documents`, `simulator`; no name = one unnamed party) needs it, as the web platform does.

### 13. Printing

- `Platform.print(html, title)` loads the document into a hidden child window with JavaScript off
  (a `data:` URL, never shown) and opens the system print dialog; resolves when it closes.

### 13a. What app:// serves beyond the document's list

- The extension table also has `.pdf` (`help/EASy68KQuickRef.pdf`, linked from the help) and `.md`
  (the read-me files under `fonts/`), served as `application/pdf` and `text/plain`. A test fails
  when `app/public` or the build holds an extension the table lacks.
- A single `Range: bytes=...` is answered with 206 and `Content-Range` (416 when it starts beyond
  the end); several ranges or another unit get the whole file with 200. Every response says
  `Accept-Ranges: bytes`, so that `<audio>` can seek in the sounds.
- The synchronous `read` allocates at most what the file holds after the position, whatever count
  the page asks for.

### 14. Where the built web app comes from

- Packaged: `<resources>/app/dist` (next to the archive, `extraResources`) or `app/dist` inside the
  archive (`<app path>/app/dist`, `files`); DV3's `electron-builder.yml` must put the build at one
  of the two. From the repository: `app/dist`. `EASY68K_APP_DIST` overrides it (tests). `EASY68K_DEV_SERVER_URL` loads the dev
  server instead (tools/desktop-dev.mjs). A packaged app ignores both (entry 15).

### 15. Test-only switches

- `EASY68K_DESKTOP_TEST_WINDOWS` (`hidden` or `inactive`) keeps windows off the screen and installs
  `globalThis.__easy68kDesktopTest` in the main process (granted roots, menus, windows). Nothing
  but `tests/desktop/dev` sets it. On macOS `window-all-closed` quits the app only in that mode.
- Gate I1 review: a packaged app (`app.isPackaged`) honours none of `EASY68K_APP_DIST`,
  `EASY68K_DEV_SERVER_URL` and `EASY68K_DESKTOP_TEST_WINDOWS` (`developmentOverrides` in
  `security.ts`): whoever controls its environment could otherwise make app:// serve another folder,
  load the page from another server or install the test hooks. DV3's packaged checks can assert it.

### 16. Unit tests of `desktop/src` from `app/` (8)

- `app/src/fs/disk-backend.test.ts` and `app/src/fs/sync/disk.test.ts` import the handlers of
  `desktop/src/fs-ipc.ts`, `sync-ipc.ts` and `security.ts` (which import Electron's types only),
  so that `npm test` runs the backend and `SyncFiles` contract suites against real folders on all
  three CI systems. The same suites run inside Electron in `tests/desktop/dev/disk.spec.ts`.
