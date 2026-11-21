// The platform bridge of the desktop app (ARCHITECTURE.md 3.13). main.tsx calls
// createDesktopPlatform() when the Electron preload script (desktop/src/preload.ts) has exposed
// `window.easy68kDesktop`, and the web platform otherwise.
//
// Everything here is a thin layer over that object: the main process does the work (native menu,
// files on disk, dialogs, full screen, printing, help, new windows). What the contract leaves to
// the page itself is done as on the web: the window id (3.8.6) and the unload guard.
//
// Members beyond the Platform contract (DesktopPlatform below; docs/porting/errata/DV2.md,
// "Contract"): the native file dialogs, dropped files, the user-data folder and the device bridge.
//
// Owner: DV2.

import type {
  CommandId,
  DesktopDeviceBridge,
  DesktopDeviceSources,
  DroppedEntry,
  FileSystemBackend,
  NativeFileDialogs,
  NativeMenuItem,
  OpenRequest,
  Platform,
  SaveRequest,
  StartupArgs,
  SyncFiles,
  VPath,
} from '../contracts';
import { DesktopNet } from '../core/sim-host/net/desktop';
import { DesktopSerial } from '../core/sim-host/serial/desktop';
import { DiskBackend, type DiskFsOp } from '../fs/disk-backend';
import { DiskSyncFiles, type DiskSyncOp } from '../fs/sync/disk';
import { createWindowId } from '../state/window-lock';
import { isAllowedExternalUrl } from './web';

/** The version of window.easy68kDesktop this file is written for (desktop/src/preload.ts). */
export const DESKTOP_BRIDGE_VERSION = 1;

/** The members of window.easy68kDesktop, exactly (6.7 check 2 compares them). */
export const DESKTOP_BRIDGE_KEYS = [
  'version',
  'startup',
  'fs',
  'fsSync',
  'onFsChange',
  'setMenu',
  'onMenuCommand',
  'onOpenFiles',
  'setTitle',
  'openExternal',
  'showHelp',
  'newWindow',
  'pasteIntoFocus',
  'quit',
  'setFullScreen',
  'onFullScreenChange',
  'print',
  'showOpenDialog',
  'showSaveDialog',
  'chooseFolder',
  'grantDroppedFile',
  'devices',
] as const;

/** window.easy68kDesktop, as desktop/src/preload.ts exposes it. */
export interface DesktopBridge {
  readonly version: number;
  startup(): Promise<unknown>;
  fs(op: DiskFsOp, ...args: unknown[]): Promise<unknown>;
  fsSync(op: DiskSyncOp, ...args: unknown[]): unknown;
  onFsChange(listener: (change: { rel: string; kind: 'write' | 'remove' }) => void): () => void;
  setMenu(menu: NativeMenuItem[]): void;
  onMenuCommand(listener: (id: CommandId, arg?: unknown) => void): () => void;
  onOpenFiles(listener: (files: string[]) => void): () => void;
  setTitle(title: string): void;
  openExternal(url: string): void;
  showHelp(page: string): void;
  newWindow(): void;
  pasteIntoFocus(): void;
  quit(): void;
  setFullScreen(on: boolean): Promise<unknown>;
  onFullScreenChange(listener: (on: boolean) => void): () => void;
  print(html: string, title: string): Promise<unknown>;
  showOpenDialog(request: OpenRequest): Promise<unknown>;
  showSaveDialog(request: SaveRequest): Promise<unknown>;
  chooseFolder(title: string): Promise<unknown>;
  grantDroppedFile(file: File): Promise<unknown>;
  devices: DesktopDeviceBridge;
}

/** What the main process says about this window at start (desktop/src/main.ts, e68:startup). */
export interface DesktopStartup {
  os: Platform['os'];
  args: StartupArgs;
  /** The app's user-data folder as a VPath of /disk (3.8.2: never-saved documents). */
  userData: VPath;
  /** Started by tests/desktop/dev. */
  testMode: boolean;
}

// The desktop members' types are contract since gate I1 (contracts/platform.ts, W1 errata 11).
export type { DesktopDeviceSources, DroppedEntry, NativeFileDialogs } from '../contracts';
/** Sources the device parts read on every call (3.3.4); the contract's DesktopDeviceSources. */
export type DeviceSources = DesktopDeviceSources;

export interface DesktopPlatform extends Platform {
  readonly kind: 'desktop';
  readonly disk: FileSystemBackend;
  readonly syncFiles: SyncFiles;
  readonly nativeFileDialogs: NativeFileDialogs;
  /**
   * The VPath of a File dropped on the window (from DataTransfer.files). The folder of a dropped
   * file becomes a granted root (7.6), so the file and its neighbours can be read; a dropped folder
   * is only named (3.8.5: the start folder of the Open dialog). null for a File that did not come
   * from the user's disk.
   */
  grantDroppedFile(file: File): Promise<DroppedEntry | null>;
  readonly userDataDir: VPath;
  readonly deviceBridge: DesktopDeviceBridge;
  /** Tells DesktopSerial and DesktopNet where the port map and the 68000 memory are. */
  bindDeviceSources(sources: DeviceSources): void;
  readonly testMode: boolean;
  onFullScreenChange(listener: (on: boolean) => void): () => void;
}

function isStartupArgs(value: unknown): value is StartupArgs {
  const v = value as Partial<StartupArgs> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    (v.file === null || typeof v.file === 'string') &&
    typeof v.run === 'boolean' &&
    typeof v.fullScreen === 'boolean' &&
    typeof v.exceptions === 'boolean' &&
    typeof v.bitField === 'boolean'
  );
}

/** Checks what the main process sent at start. */
export function parseStartup(value: unknown): DesktopStartup {
  const v = value as Partial<DesktopStartup> | null;
  if (typeof v !== 'object' || v === null) throw new Error('the desktop app sent no start-up information');
  const os = v.os === 'mac' || v.os === 'windows' || v.os === 'linux' ? v.os : null;
  if (os === null) throw new Error(`the desktop app sent an unknown OS: ${String(v.os)}`);
  if (!isStartupArgs(v.args)) throw new Error('the desktop app sent malformed start-up arguments');
  if (typeof v.userData !== 'string' || !v.userData.startsWith('/disk')) {
    throw new Error('the desktop app sent no user-data folder');
  }
  return { os, args: { ...v.args }, userData: v.userData, testMode: v.testMode === true };
}

const isVPathList = (value: unknown): value is VPath[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.startsWith('/disk/'));

/** A help page name (relative to the help folder), as desktop/src/windows.ts isHelpPage() accepts it. */
export function isHelpPage(page: string): boolean {
  return (
    page.length <= 200 &&
    /^[A-Za-z0-9_][A-Za-z0-9_\-. /]*\.html?(#[A-Za-z0-9_\-.:]*)?$/i.test(page) &&
    !page.split('/').includes('..')
  );
}

export interface DesktopPlatformEnv {
  bridge: DesktopBridge;
  /** The page's window (unload guard, crypto for the window id). */
  win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'crypto'>;
}

/** The platform of the desktop app over a bridge (tests pass a fake). */
export async function createDesktopPlatformWith({ bridge, win }: DesktopPlatformEnv): Promise<DesktopPlatform> {
  if (bridge.version !== DESKTOP_BRIDGE_VERSION) {
    throw new Error(
      `window.easy68kDesktop has version ${String(bridge.version)}; this page needs ${DESKTOP_BRIDGE_VERSION}`,
    );
  }
  const startup = parseStartup(await bridge.startup());
  const sources: Required<DeviceSources> = { portMap: () => ({}), memory: () => new Uint8Array(0) };
  const disk = new DiskBackend({ bridge, label: startup.os === 'mac' ? 'This Mac' : 'This Computer' });
  const syncFiles = new DiskSyncFiles({ bridge });
  const devices = bridge.devices;

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault();
    event.returnValue = '';
  };
  /**
   * The parties that need the "leave?" question now (Platform.confirmBeforeUnload(needed, who):
   * the documents, the simulator's files and log). A call without a name is one unnamed party.
   */
  const needing = new Set<string>();
  let guarding = false;

  return {
    kind: 'desktop',
    os: startup.os,
    windowId: createWindowId(win.crypto),
    testMode: startup.testMode,
    userDataDir: startup.userData,

    startupArgs: () => ({ ...startup.args }),
    onOpenFiles(listener) {
      return bridge.onOpenFiles((files) => {
        if (isVPathList(files)) listener([...files]);
      });
    },
    setNativeMenu(menu) {
      bridge.setMenu(menu);
    },
    onNativeCommand(listener) {
      return bridge.onMenuCommand((id, arg) => {
        if (typeof id === 'string') listener(id, arg);
      });
    },
    setTitle(title) {
      bridge.setTitle(title);
    },
    async print(html, title) {
      await bridge.print(html, title);
    },
    openExternal(url) {
      if (isAllowedExternalUrl(url)) bridge.openExternal(url);
    },
    showHelp(page) {
      if (!isHelpPage(page)) return false;
      bridge.showHelp(page);
      return true;
    },
    confirmBeforeUnload(needed, who) {
      // The main process turns the page's request into a native question (will-prevent-unload).
      // The question stays on while any party needs it: the documents saying "no longer" must not
      // switch it off while the simulator still has bytes to write.
      const party = who ?? '';
      if (needed) needing.add(party);
      else needing.delete(party);
      const next = needing.size > 0;
      if (next === guarding) return;
      guarding = next;
      if (next) win.addEventListener('beforeunload', onBeforeUnload);
      else win.removeEventListener('beforeunload', onBeforeUnload);
    },
    newWindow() {
      bridge.newWindow();
    },
    setFullScreen: async (on) => (await bridge.setFullScreen(on)) === true,
    onFullScreenChange(listener) {
      return bridge.onFullScreenChange((on) => {
        if (typeof on === 'boolean') listener(on);
      });
    },
    pasteIntoFocus: () => bridge.pasteIntoFocus(),
    quit() {
      bridge.quit();
    },
    disk,
    syncFiles,
    serial: new DesktopSerial({ bridge: devices, portMap: () => sources.portMap() }),
    net: new DesktopNet({ bridge: devices, memory: () => sources.memory() }),
    nativeFileDialogs: {
      async open(request) {
        const result = await bridge.showOpenDialog(request);
        return isVPathList(result) ? result : null;
      },
      async save(request) {
        const result = await bridge.showSaveDialog(request);
        return typeof result === 'string' && result.startsWith('/disk/') ? result : null;
      },
      async chooseFolder(title) {
        const result = await bridge.chooseFolder(title);
        return typeof result === 'string' && result.startsWith('/disk') ? result : null;
      },
    },
    async grantDroppedFile(file) {
      const result = (await bridge.grantDroppedFile(file)) as Partial<DroppedEntry> | null;
      if (typeof result !== 'object' || result === null) return null;
      if (typeof result.path !== 'string' || !result.path.startsWith('/disk/')) return null;
      if (result.kind !== 'file' && result.kind !== 'dir') return null;
      return { path: result.path, kind: result.kind };
    },
    deviceBridge: devices,
    bindDeviceSources(next) {
      if (next.portMap) sources.portMap = next.portMap;
      if (next.memory) sources.memory = next.memory;
    },
  };
}

declare global {
  interface Window {
    /** The object the Electron preload script exposes (desktop/src/preload.ts). */
    easy68kDesktop?: DesktopBridge;
  }
}

/** The desktop platform of this page (main.tsx calls it when window.easy68kDesktop exists). */
export function createDesktopPlatform(): Promise<Platform> {
  const bridge = window.easy68kDesktop;
  if (!bridge) return Promise.reject(new Error('window.easy68kDesktop does not exist: not the desktop app'));
  return createDesktopPlatformWith({ bridge, win: window });
}
