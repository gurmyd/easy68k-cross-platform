// The synchronous bridge calls of the desktop app (ARCHITECTURE.md 3.3.4, 3.8.4, 7.6), answered
// through `ipcRenderer.sendSync`. They exist only where a host method of the engine must answer
// at once:
//
// - program files on disk: DiskSyncFiles (app/src/fs/sync/disk.ts) performs every call on the
//   real file at that moment; nothing is cached;
// - serial and network control calls: the device handlers of DV4 (desktop/src/serial.ts, net.ts)
//   register themselves here with registerDeviceHandler(); the page side is the
//   DesktopDeviceBridge of app/src/contracts/devices.ts.
//
// Every handler checks the sending window and its arguments; the file handlers act only inside
// the granted roots (security.ts). A refused call answers like a missing file: null or false.
//
// createDiskSyncHandlers() does not touch Electron; app/src/fs/sync/disk.test.ts runs the
// SyncFiles contract suite against it under plain Node.
//
// Owner: DV2.

import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IpcMain, IpcMainEvent, WebContents } from 'electron';
import { type GrantedRoots, hostPlatform, isBytes, isCount, isShortString, realPathOf } from './security';
import type { DiskChange } from './fs-ipc';

/** IPC channel of the synchronous file calls. */
export const FS_SYNC_CHANNEL = 'e68:fs-sync';
/** IPC channel of the synchronous device calls (DesktopDeviceBridge.request). */
export const DEVICE_REQUEST_CHANNEL = 'e68:device-request';
/** IPC channel of device events pushed to the page (DesktopDeviceBridge.on). */
export const DEVICE_EVENT_CHANNEL = 'e68:device-event';

/** The most bytes one readSync() of the `read` handler asks for. */
const READ_CHUNK = 1 << 20;

export const DISK_SYNC_OPS = ['resolve', 'stat', 'read', 'write', 'create', 'remove'] as const;
export type DiskSyncOp = (typeof DISK_SYNC_OPS)[number];

/** Upper-cases one character at a time, as Windows compares file names (core/paths/winpath.ts). */
function foldCase(name: string): string {
  let out = '';
  for (const ch of name) {
    const upper = ch.toUpperCase();
    out += upper.length === ch.length ? upper : ch;
  }
  return out;
}

/** The stored name `name` refers to: the exact one, else the first without regard to case. */
function matchName(names: readonly string[], name: string): string | null {
  if (names.includes(name)) return name;
  const folded = foldCase(name);
  return names.find((candidate) => foldCase(candidate) === folded) ?? null;
}

function kindOf(path: string): 'file' | 'dir' | null {
  try {
    const info = statSync(path);
    return info.isFile() ? 'file' : info.isDirectory() ? 'dir' : null;
  } catch {
    return null;
  }
}

export interface DiskSyncDeps {
  grants: GrantedRoots;
  onChange?: (change: DiskChange) => void;
}

export type DiskSyncHandlers = { [K in DiskSyncOp]: (...args: unknown[]) => unknown };

/** The handlers of the synchronous file channel, as plain functions of their IPC arguments. */
export function createDiskSyncHandlers({ grants, onChange }: DiskSyncDeps): DiskSyncHandlers {
  const platform = hostPlatform();
  const real = (rel: unknown): string | null => grants.realIfAllowed(rel);

  return {
    /**
     * `rel` is a path inside /disk that the page has already resolved lexically (Windows name
     * rules: '\' and '/', '.', '..'). Each segment takes its stored spelling where a file or
     * folder of that name exists in any letter case; the rest is kept as given. Returns the rel
     * with the stored spelling, or null when it is malformed or outside the granted roots.
     */
    resolve(rel: unknown): string | null {
      if (realPathOf(rel, platform) === null || real(rel) === null) return null;
      const segments = (rel as string).split('/');
      const out: string[] = [];
      let exists = true;
      for (const [index, segment] of segments.entries()) {
        let chosen = segment;
        if (exists && !(platform === 'win32' && index === 0)) {
          const parent = realPathOf(out.join('/'), platform);
          let names: string[];
          try {
            names = parent === null ? [] : readdirSync(parent);
          } catch {
            names = [];
          }
          const match = matchName(names, segment);
          if (match !== null) chosen = match;
          // Not listed, yet there: another name of the same entry, such as a Windows 8.3 short
          // name ("RUNNER~1" for "runneradmin"), which a student's path may well contain. It is
          // kept as given and the walk goes on below it; giving up here would leave every later
          // segment in the spelling the program used (gate 1, CI on windows-latest).
          else if (parent === null || kindOf(join(parent, segment)) === null) exists = false;
        }
        out.push(chosen);
      }
      const result = out.join('/');
      return real(result) === null ? null : result;
    },

    stat(rel: unknown): { size: number; readOnly: boolean } | null {
      const path = real(rel);
      if (path === null) return null;
      try {
        const info = statSync(path);
        if (!info.isFile()) return null;
        return { size: info.size, readOnly: (info.mode & 0o200) === 0 };
      } catch {
        return null;
      }
    },

    read(rel: unknown, position: unknown, count: unknown): Uint8Array | null {
      const path = real(rel);
      if (path === null || !isCount(position) || !isCount(count)) return null;
      let fd: number | null = null;
      try {
        fd = openSync(path, 'r');
        const info = fstatSync(fd);
        if (!info.isFile()) return null;
        // Never more than the file holds after `position` (a program may ask for any count), and
        // never more than a bounded amount at once; a file that grows meanwhile is read to the end
        // it had when the call began.
        const want = Math.min(count, Math.max(0, info.size - position));
        const buffer = new Uint8Array(want);
        let done = 0;
        while (done < want) {
          const n = readSync(fd, buffer, done, Math.min(want - done, READ_CHUNK), position + done);
          if (n === 0) break;
          done += n;
        }
        return buffer.slice(0, done);
      } catch {
        return null;
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },

    /** Writes into an existing file; a gap before `position` reads as zero bytes. */
    write(rel: unknown, position: unknown, data: unknown): boolean {
      const path = real(rel);
      if (path === null || !isCount(position) || !isBytes(data)) return false;
      let fd: number | null = null;
      try {
        if (kindOf(path) !== 'file') return false;
        fd = openSync(path, 'r+');
        let done = 0;
        while (done < data.length) done += writeSync(fd, data, done, data.length - done, position + done);
        onChange?.({ rel: rel as string, kind: 'write' });
        return true;
      } catch {
        return false;
      } finally {
        if (fd !== null) closeSync(fd);
      }
    },

    /** A new empty file, or an existing one truncated; the folder must exist, as for fopen(). */
    create(rel: unknown): boolean {
      const path = real(rel);
      if (path === null) return false;
      if (kindOf(dirname(path)) !== 'dir' || kindOf(path) === 'dir') return false;
      try {
        closeSync(openSync(path, 'w'));
        onChange?.({ rel: rel as string, kind: 'write' });
        return true;
      } catch {
        return false;
      }
    },

    remove(rel: unknown): boolean {
      const path = real(rel);
      if (path === null || kindOf(path) !== 'file') return false;
      try {
        unlinkSync(path);
        onChange?.({ rel: rel as string, kind: 'remove' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ---- devices (DV4) -------------------------------------------------------------------------------

/**
 * A synchronous device call of one window: `channel` names it ("serial.open", "net.send", ...),
 * `args` are the page's arguments. Whatever it returns is the reply. DV4's serial.ts and net.ts
 * register their handlers; each window has its own devices (3.8.6), identified by `sender`.
 */
export type DeviceRequestHandler = (sender: WebContents, ...args: unknown[]) => unknown;

const deviceHandlers = new Map<string, DeviceRequestHandler>();

/** Device channel names: "<device>.<call>", letters, digits and '-' only. */
export const DEVICE_CHANNEL_PATTERN = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9-]*$/;

/** Registers the handler of a device channel (DV4). Returns the unregister function. */
export function registerDeviceHandler(channel: string, handler: DeviceRequestHandler): () => void {
  if (!DEVICE_CHANNEL_PATTERN.test(channel)) throw new Error(`not a device channel name: ${channel}`);
  if (deviceHandlers.has(channel)) throw new Error(`the device channel ${channel} has a handler already`);
  deviceHandlers.set(channel, handler);
  return () => {
    if (deviceHandlers.get(channel) === handler) deviceHandlers.delete(channel);
  };
}

/** Pushes a device event (received data) to one window's page (DesktopDeviceBridge.on). */
export function sendDeviceEvent(target: WebContents, channel: string, ...args: unknown[]): void {
  if (!DEVICE_CHANNEL_PATTERN.test(channel)) throw new Error(`not a device channel name: ${channel}`);
  if (!target.isDestroyed()) target.send(DEVICE_EVENT_CHANNEL, channel, ...args);
}

/** The reply of a device call: the handler's value, or undefined for a channel nobody serves. */
export function answerDeviceRequest(sender: WebContents, channel: unknown, args: unknown): unknown {
  if (!isShortString(channel, 64) || !DEVICE_CHANNEL_PATTERN.test(channel) || !Array.isArray(args)) return undefined;
  const handler = deviceHandlers.get(channel);
  if (!handler) return undefined;
  try {
    return handler(sender, ...args);
  } catch (error) {
    console.error(`device call ${channel} failed:`, error);
    return undefined;
  }
}

// ---- registration --------------------------------------------------------------------------------

export interface SyncIpcDeps {
  grants: GrantedRoots;
  trusted(event: IpcMainEvent): boolean;
  broadcast(change: DiskChange, sender: WebContents): void;
}

/** Registers the synchronous channels. Every message gets a reply, so no page ever hangs. */
export function registerSyncIpc(ipcMain: IpcMain, deps: SyncIpcDeps): void {
  ipcMain.on(FS_SYNC_CHANNEL, (event, op: unknown, ...args: unknown[]) => {
    if (!deps.trusted(event) || typeof op !== 'string' || !(DISK_SYNC_OPS as readonly string[]).includes(op)) {
      event.returnValue = op === 'stat' || op === 'read' || op === 'resolve' ? null : false;
      return;
    }
    const handlers = createDiskSyncHandlers({
      grants: deps.grants,
      onChange: (change) => deps.broadcast(change, event.sender),
    });
    event.returnValue = handlers[op as DiskSyncOp](...args);
  });
  ipcMain.on(DEVICE_REQUEST_CHANNEL, (event, channel: unknown, args: unknown) => {
    // Wrapped, so that a reply of `undefined` (no handler, or a host method's "no value") is a
    // reply too: a synchronous call whose returnValue is never set would block the page.
    const value = deps.trusted(event) ? answerDeviceRequest(event.sender, channel, args) : undefined;
    // A device operation that finishes later (open, bind, connect, send, name lookup: DV4) returns
    // a Promise; the page waits until it settles, as the original waits in the same system calls
    // (3.3.4). A rejection is answered with `undefined`, so the page never hangs.
    if (value instanceof Promise) {
      value.then(
        (settled: unknown) => {
          event.returnValue = { value: settled };
        },
        (error: unknown) => {
          console.error(`device call ${String(channel)} failed:`, error);
          event.returnValue = { value: undefined };
        },
      );
      return;
    }
    event.returnValue = { value };
  });
}
