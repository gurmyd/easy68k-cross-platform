// Contract: the platform bridge (ARCHITECTURE.md 3.13). Implementations: app/src/platform/web.ts
// (W3) and app/src/platform/desktop.ts (DV2), chosen at start by the presence of
// window.easy68kDesktop, the object the Electron preload script exposes.
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { CommandId } from './commands';
import type { FileSystemBackend, SyncFiles } from './fs';
import type { HostNet, HostSerial } from './host';

export interface StartupArgs {
  file: string | null; // desktop: path from argv or the open-file event; web: ?open= value
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
export interface Platform {
  readonly kind: 'web' | 'desktop';
  readonly os: 'mac' | 'windows' | 'linux';
  readonly windowId: string; // 3.8.6
  startupArgs(): StartupArgs;
  onOpenFiles(listener: (files: string[]) => void): () => void; // file association, drop on the dock icon
  setNativeMenu(menu: NativeMenuItem[]): void; // no-op on the web
  onNativeCommand(listener: (id: CommandId, arg?: unknown) => void): () => void; // menu items chosen with the mouse
  setTitle(title: string): void;
  print(html: string, title: string): Promise<void>; // prints a prepared document
  openExternal(url: string): void; // allow-listed URLs only
  showHelp(page: string): boolean; // desktop: help window; web: false
  confirmBeforeUnload(needed: boolean): void;
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
}
