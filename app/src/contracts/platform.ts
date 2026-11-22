// Contract: the platform bridge (ARCHITECTURE.md 3.13). Implementations: app/src/platform/web.ts
// (W3) and app/src/platform/desktop.ts (DV2), chosen at start by the presence of
// window.easy68kDesktop, the object the Electron preload script exposes.
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { CommandId } from './commands';
import type { DesktopDeviceBridge } from './devices';
import type { FileSystemBackend, OpenRequest, SaveRequest, SyncFiles, VPath } from './fs';
import type { HostNet, HostSerial } from './host';

export interface StartupArgs {
  /** Desktop: the file from argv or the open-file event, as a VPath of /disk whose folder the main
   *  process has granted (null when the file does not exist). Web: the ?open= value. */
  file: string | null;
  run: boolean; // /r
  fullScreen: boolean; // /f
  exceptions: boolean; // /e
  bitField: boolean; // /b
}
export interface NativeMenuItem {
  id?: CommandId;
  arg?: unknown;
  label?: string;
  accelerator?: string; // accelerator: shown, never acted on (7.6)
  /** A native editing or application role (macOS): 'undo', 'redo', 'cut', 'copy', 'paste',
   *  'selectAll', 'about', 'hide', 'quit', 'minimize', 'close', 'window', 'help' ... */
  role?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  enabled?: boolean;
  checked?: boolean;
  items?: NativeMenuItem[];
}

/* ------------------------------------------------------------------ desktop additions of gate I1 */
// What the desktop app's platform has beyond section 3.13 (docs/porting/errata/W1.md, entry 11;
// errata DV2.md entries 1-4a, FS1.md C3, SH4.md 5). Every member of Platform that uses these types
// is optional: app/src/platform/desktop.ts has it, the web platform leaves it out.

/** The native file dialogs (3.8.5). The folder of a chosen file, or the chosen folder, becomes a
 *  granted root (7.6). Paths are VPaths of /disk; null = cancelled. */
export interface NativeFileDialogs {
  open(request: OpenRequest): Promise<VPath[] | null>;
  /** Appends request.defaultExt when the user typed no extension. macOS asks about overwriting itself. */
  save(request: SaveRequest): Promise<VPath | null>;
  /** `startDir` (added at gate I1 round 3, docs/porting/errata/W1.md, entry 13): the folder the
   *  dialog opens in, a VPath of /disk, from `FolderRequest.startDir`. Optional; an implementation
   *  that ignores it opens where the system chooses. */
  chooseFolder(title: string, startDir?: VPath | null): Promise<VPath | null>;
}
/** A file or folder dropped on the window, as the main process names it (Platform.grantDroppedFile). */
export interface DroppedEntry {
  path: VPath; // a VPath of /disk
  kind: 'file' | 'dir';
}
/** Where DesktopSerial and DesktopNet read what the platform cannot know when it is created (3.3.4). */
export interface DesktopDeviceSources {
  /** AppSettings.serialPortMap: "COM4" -> device path. */
  portMap?: () => Readonly<Record<string, string>>;
  /** engine.memory of the current engine instance. */
  memory?: () => Uint8Array;
}

export interface Platform {
  readonly kind: 'web' | 'desktop';
  readonly os: 'mac' | 'windows' | 'linux';
  readonly windowId: string; // 3.8.6
  startupArgs(): StartupArgs;
  /** File association, drop on the dock icon. Desktop: VPaths of /disk, as StartupArgs.file. */
  onOpenFiles(listener: (files: string[]) => void): () => void;
  setNativeMenu(menu: NativeMenuItem[]): void; // no-op on the web
  onNativeCommand(listener: (id: CommandId, arg?: unknown) => void): () => void; // menu items chosen with the mouse
  setTitle(title: string): void;
  print(html: string, title: string): Promise<void>; // prints a prepared document
  openExternal(url: string): void; // allow-listed URLs only
  showHelp(page: string): boolean; // desktop: help window; web: false
  /**
   * Asks the browser (the desktop app: the main process) for its "leave?" question while `needed`.
   * Several parties need it: the documents (modified text), the simulator's program files and its
   * log (bytes not yet in storage). Each passes its own name as `who` ('documents', 'simulator');
   * the question stays on while any named party needs it. A call without `who` speaks for one
   * unnamed party, as before gate I1 (docs/porting/errata/W1.md, entry 11).
   */
  confirmBeforeUnload(needed: boolean, who?: string): void;
  newWindow(): void; // desktop: another app window; web: opens the app's URL
  /** Desktop: window-level full screen for the Output panel (2.5). Web: null - the panel uses the
   *  Fullscreen API itself. */
  readonly setFullScreen: ((on: boolean) => Promise<boolean>) | null;
  /** Desktop: paste the system clipboard into the focused element (the native paste command).
   *  Web: null - a page can only paste through the browser's own paste event or the Clipboard API. */
  readonly pasteIntoFocus: (() => void) | null;
  quit(): void; // web: no-op
  readonly disk: FileSystemBackend | null; // desktop only
  readonly syncFiles: SyncFiles | null; // desktop only: DiskSyncFiles (3.8.4)
  readonly serial: HostSerial | null; // desktop only
  readonly net: HostNet | null; // desktop only

  /* ---- added at gate I1; optional, see "desktop additions" above ---- */

  /** Desktop only: the native Open, Save and folder dialogs. features/files (FS1) registers them as
   *  the FileSourceProvider `native`, which then replaces the port's own dialogs (3.8.5). */
  readonly nativeFileDialogs?: NativeFileDialogs | null;
  /**
   * Desktop only: the VPath of a File dropped on the window (from DataTransfer.files). The folder
   * of a dropped file becomes a granted root (7.6), so the file and its neighbours can be read; a
   * dropped folder is only named (3.8.5: the start folder of the Open dialog). Resolves to null for
   * a File that did not come from the user's disk.
   */
  grantDroppedFile?(file: File): Promise<DroppedEntry | null>;
  /** Desktop only: the app's user-data folder as a VPath of /disk, a granted root from the start
   *  (3.8.2: a never-saved document lives in `<userDataDir>/Untitled`). */
  readonly userDataDir?: VPath | null;
  /** Desktop only: tells `serial` and `net` where the port map and the 68000 memory are. The
   *  simulator session calls it once, before the first engine starts (3.3.4). */
  bindDeviceSources?(sources: DesktopDeviceSources): void;
  /** Desktop only: the window entered or left full screen by the system's own means (the green
   *  button), which no `fullscreenchange` event of the page reports (2.5). Returns the unsubscribe
   *  function. */
  onFullScreenChange?(listener: (on: boolean) => void): () => void;

  /* ---- added in the round before gate I3; optional (docs/porting/errata/W1.md, entry 16) ---- */

  /** Desktop only: the window's device bridge (3.3.4), the one DesktopSerial and DesktopNet use;
   *  the Serial Ports dialog (features/desktop-devices) asks it for the machine's serial devices.
   *  Null or absent in a browser (docs/requests/DV4-platform-device-bridge.md). */
  readonly deviceBridge?: DesktopDeviceBridge | null;
}
