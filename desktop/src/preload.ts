// The preload script of every application window (ARCHITECTURE.md 3.13, 7.6). It runs sandboxed,
// with context isolation, and exposes exactly one object to the page: `window.easy68kDesktop`,
// with the fixed set of functions below. app/src/platform/desktop.ts builds the Platform from it
// (main.tsx chooses that platform when the object exists).
//
// A sandboxed preload script can require nothing but `electron` (and a few Node built-ins), so
// this file imports no other file of desktop/src at run time; the channel names are repeated here
// and tests/desktop/dev/unit.spec.ts checks that each has its handler in the main process.
//
// Synchronous calls (ipcRenderer.sendSync) are used only where a host method of the engine must
// answer at once (7.6): program files on disk (fsSync) and the device calls (devices.request).
//
// Owner: DV2.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

const CHANNELS = {
  startup: 'e68:startup',
  fs: 'e68:fs',
  fsSync: 'e68:fs-sync',
  fsChange: 'e68:fs-change',
  menuSet: 'e68:menu-set',
  menuCommand: 'e68:menu-command',
  openFiles: 'e68:open-files',
  window: 'e68:window',
  fullScreen: 'e68:full-screen',
  print: 'e68:print',
  dialog: 'e68:dialog',
  drop: 'e68:drop',
  deviceRequest: 'e68:device-request',
  deviceEvent: 'e68:device-event',
} as const;

type Listener = (...args: never[]) => void;

/** Subscribes to an event channel; returns the unsubscribe function. */
function subscribe(channel: string, listener: (...args: unknown[]) => void): () => void {
  if (typeof listener !== 'function') throw new TypeError('the listener is not a function');
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...args);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge = {
  /** Version of this interface; app/src/platform/desktop.ts checks it. */
  version: 1,

  /** { os, args: StartupArgs, userData: VPath, testMode } of this window. */
  startup: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.startup),

  /** The asynchronous file calls of DiskBackend (desktop/src/fs-ipc.ts). */
  fs: (op: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(CHANNELS.fs, op, ...args),
  /** The synchronous file calls of DiskSyncFiles (desktop/src/sync-ipc.ts). */
  fsSync: (op: string, ...args: unknown[]): unknown => ipcRenderer.sendSync(CHANNELS.fsSync, op, ...args),
  /** Writes and removes on disk made by the other windows (3.8.6). */
  onFsChange: (listener: Listener): (() => void) => subscribe(CHANNELS.fsChange, listener as never),

  setMenu: (menu: unknown): void => ipcRenderer.send(CHANNELS.menuSet, menu),
  onMenuCommand: (listener: Listener): (() => void) => subscribe(CHANNELS.menuCommand, listener as never),
  onOpenFiles: (listener: Listener): (() => void) => subscribe(CHANNELS.openFiles, listener as never),

  setTitle: (title: string): void => ipcRenderer.send(CHANNELS.window, 'setTitle', title),
  openExternal: (url: string): void => ipcRenderer.send(CHANNELS.window, 'openExternal', url),
  showHelp: (page: string): void => ipcRenderer.send(CHANNELS.window, 'showHelp', page),
  newWindow: (): void => ipcRenderer.send(CHANNELS.window, 'newWindow'),
  pasteIntoFocus: (): void => ipcRenderer.send(CHANNELS.window, 'paste'),
  quit: (): void => ipcRenderer.send(CHANNELS.window, 'quit'),
  setFullScreen: (on: boolean): Promise<unknown> => ipcRenderer.invoke(CHANNELS.fullScreen, on),
  print: (html: string, title: string): Promise<unknown> => ipcRenderer.invoke(CHANNELS.print, html, title),

  /** Native file dialogs; the folders of chosen files become granted roots (3.8.5, 7.6). */
  showOpenDialog: (request: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.dialog, 'open', request),
  showSaveDialog: (request: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.dialog, 'save', request),
  chooseFolder: (title: unknown): Promise<unknown> => ipcRenderer.invoke(CHANNELS.dialog, 'folder', title),
  /**
   * A File the user dropped on the window (or chose in an <input type="file">): its VPath of /disk,
   * and the folder of a dropped file becomes a granted root (7.6). A sandboxed page sees no real
   * paths; webUtils gives the path only for a File that came from the user, '' for one the page
   * made itself, which the main process refuses.
   */
  grantDroppedFile: (file: unknown): Promise<unknown> => {
    let path: string;
    try {
      path = webUtils.getPathForFile(file as File);
    } catch {
      path = '';
    }
    return ipcRenderer.invoke(CHANNELS.drop, path);
  },

  /** DesktopDeviceBridge of app/src/contracts/devices.ts, for DesktopSerial and DesktopNet (3.3.4). */
  devices: {
    request: (channel: string, ...args: unknown[]): unknown => {
      const reply = ipcRenderer.sendSync(CHANNELS.deviceRequest, channel, args) as { value?: unknown } | null;
      return reply?.value;
    },
    on: (channel: string, listener: (...args: unknown[]) => void): (() => void) => {
      if (typeof listener !== 'function') throw new TypeError('the listener is not a function');
      const handler = (_event: IpcRendererEvent, eventChannel: unknown, ...args: unknown[]) => {
        if (eventChannel === channel) listener(...args);
      };
      ipcRenderer.on(CHANNELS.deviceEvent, handler);
      return () => {
        ipcRenderer.removeListener(CHANNELS.deviceEvent, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('easy68kDesktop', bridge);
