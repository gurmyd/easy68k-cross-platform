// The asynchronous file-system handlers of the /disk mount (ARCHITECTURE.md 3.8.1, 7.6): what
// DiskBackend (app/src/fs/disk-backend.ts) asks for over `ipcRenderer.invoke`. Every handler
// checks the window that sent the request and its arguments, and acts only on paths inside the
// granted roots (security.ts).
//
// The handlers answer with a DiskReply instead of throwing, because an Error that crosses IPC
// loses its `code`; the page turns a failure back into an FsError with the same code.
//
// createDiskFsHandlers() does not touch Electron, so app/src/fs/disk-backend.test.ts runs the
// backend contract suite against these handlers and real folders under plain Node.
//
// Owner: DV2.

import { appendFile, lstat, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import { type GrantedRoots, isBytes } from './security';

/** The error codes of FsErrorCode (app/src/contracts/fs.ts). */
export type DiskFsCode = 'not-found' | 'is-directory' | 'not-directory' | 'read-only' | 'invalid-path' | 'io';

export type DiskReply<T> = { ok: true; value: T } | { ok: false; code: DiskFsCode; message: string };

export interface DiskStat {
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  readOnly: boolean;
}

export interface DiskEntry {
  name: string;
  kind: 'file' | 'dir';
}

/** A change made through the bridge, reported to the other windows (3.8.6). */
export interface DiskChange {
  rel: string;
  kind: 'write' | 'remove';
}

/** The operations of the asynchronous channel, by name. */
export const DISK_FS_OPS = [
  'stat',
  'readFile',
  'writeFile',
  'appendFile',
  'remove',
  'list',
  'mkdirp',
  'prepare',
] as const;
export type DiskFsOp = (typeof DISK_FS_OPS)[number];

/** IPC channel of the asynchronous file calls. */
export const FS_CHANNEL = 'e68:fs';
/** IPC channel on which the main process reports changes to the other windows. */
export const FS_CHANGE_CHANNEL = 'e68:fs-change';

class DiskFailure extends Error {
  constructor(
    readonly code: DiskFsCode,
    message: string,
  ) {
    super(message);
  }
}

function fail(code: DiskFsCode, message: string): never {
  throw new DiskFailure(code, message);
}

/** The FsErrorCode of a Node error. */
export function codeOfNodeError(error: unknown): DiskFsCode {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ENOENT':
      return 'not-found';
    case 'EISDIR':
      return 'is-directory';
    case 'ENOTDIR':
      return 'not-directory';
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'read-only';
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return 'invalid-path';
    default:
      return 'io';
  }
}

async function kindOf(path: string): Promise<'file' | 'dir' | 'other' | null> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other';
  } catch (error) {
    const code = codeOfNodeError(error);
    if (code === 'not-found' || code === 'not-directory') return null;
    throw error;
  }
}

/**
 * Fails with not-directory when a parent of `path` is a file. Node reports that case differently
 * on each OS (ENOTDIR on macOS, ENOENT on Windows), so it is checked here.
 */
async function checkParents(path: string): Promise<void> {
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const kind = await kindOf(parent);
    if (kind === 'dir') return;
    if (kind !== null) fail('not-directory', `not a folder: ${parent}`);
    if (dirname(parent) === parent) return;
  }
}

/**
 * Runs a write that creates or replaces the file `path`. The common case costs one call; only a
 * failure is looked into: a folder in the way (is-directory), a file where a parent folder should
 * be (not-directory), or missing parent folders, which are created before one more try.
 */
async function writeCreatingFolders(path: string, rel: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
    return;
  } catch (error) {
    if ((await kindOf(path)) === 'dir') fail('is-directory', `a folder, not a file: /disk/${rel}`);
    const code = codeOfNodeError(error);
    if (code !== 'not-found' && code !== 'not-directory') throw error;
  }
  await checkParents(path);
  await mkdir(dirname(path), { recursive: true });
  await write();
}

async function isReadOnly(path: string, info: { mode: number; isDirectory(): boolean }): Promise<boolean> {
  if (info.isDirectory()) return false;
  // The owner-write bit is the read-only attribute on Windows and the user's own bit elsewhere.
  return (info.mode & 0o200) === 0;
}

export interface DiskFsDeps {
  grants: GrantedRoots;
  /** Told about every write and remove (for the other windows, 3.8.6). */
  onChange?: (change: DiskChange) => void;
}

export type DiskFsHandlers = { [K in DiskFsOp]: (...args: unknown[]) => Promise<DiskReply<unknown>> };

/** The handlers of the asynchronous channel, as plain functions of their IPC arguments. */
export function createDiskFsHandlers({ grants, onChange }: DiskFsDeps): DiskFsHandlers {
  const real = (rel: unknown): string => {
    if (typeof rel !== 'string') fail('invalid-path', 'the path is not a string');
    const path = grants.realIfAllowed(rel);
    if (path === null) fail('io', `refused: outside the folders this app may use: /disk/${rel}`);
    return path;
  };
  const changed = (rel: unknown, kind: DiskChange['kind']) => onChange?.({ rel: rel as string, kind });

  const wrap =
    <A extends unknown[], T>(body: (...args: A) => Promise<T>) =>
    async (...args: unknown[]): Promise<DiskReply<unknown>> => {
      try {
        return { ok: true, value: await body(...(args as A)) };
      } catch (error) {
        if (error instanceof DiskFailure) return { ok: false, code: error.code, message: error.message };
        return { ok: false, code: codeOfNodeError(error), message: String((error as Error)?.message ?? error) };
      }
    };

  return {
    stat: wrap(async (rel: unknown): Promise<DiskStat | null> => {
      const path = real(rel);
      let info;
      try {
        info = await stat(path);
      } catch (error) {
        const code = codeOfNodeError(error);
        if (code === 'not-found' || code === 'not-directory') return null;
        throw error;
      }
      if (!info.isFile() && !info.isDirectory()) return null;
      return {
        kind: info.isDirectory() ? 'dir' : 'file',
        size: info.isDirectory() ? 0 : info.size,
        mtime: info.mtimeMs,
        readOnly: await isReadOnly(path, info),
      };
    }),

    readFile: wrap(async (rel: unknown): Promise<Uint8Array> => {
      const path = real(rel);
      const kind = await kindOf(path);
      if (kind === null) fail('not-found', `no such file: /disk/${rel as string}`);
      if (kind === 'dir') fail('is-directory', `a folder, not a file: /disk/${rel as string}`);
      const data = await readFile(path);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }),

    writeFile: wrap(async (rel: unknown, data: unknown): Promise<void> => {
      const path = real(rel);
      if (!isBytes(data)) fail('io', 'the data are not bytes');
      await writeCreatingFolders(path, rel as string, () => writeFile(path, data));
      changed(rel, 'write');
    }),

    appendFile: wrap(async (rel: unknown, data: unknown): Promise<void> => {
      const path = real(rel);
      if (!isBytes(data)) fail('io', 'the data are not bytes');
      // O_APPEND: the cost depends on data.length, not on the size of the file (3.8.1).
      await writeCreatingFolders(path, rel as string, () => appendFile(path, data));
      changed(rel, 'write');
    }),

    remove: wrap(async (rel: unknown): Promise<void> => {
      const path = real(rel);
      let info;
      try {
        info = await lstat(path);
      } catch (error) {
        const code = codeOfNodeError(error);
        if (code === 'not-directory') fail('not-found', `no such file: /disk/${rel as string}`);
        throw error;
      }
      if (info.isDirectory()) await rm(path, { recursive: true });
      else await unlink(path);
      changed(rel, 'remove');
    }),

    list: wrap(async (rel: unknown): Promise<DiskEntry[]> => {
      const path = real(rel);
      const kind = await kindOf(path);
      if (kind === null) fail('not-found', `no such folder: /disk/${rel as string}`);
      if (kind !== 'dir') fail('not-directory', `not a folder: /disk/${rel as string}`);
      const entries: DiskEntry[] = [];
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isFile()) entries.push({ name: entry.name, kind: 'file' });
        else if (entry.isDirectory()) entries.push({ name: entry.name, kind: 'dir' });
        else if (entry.isSymbolicLink()) {
          const target = await kindOf(`${path}/${entry.name}`);
          if (target === 'file' || target === 'dir') entries.push({ name: entry.name, kind: target });
        }
      }
      return entries;
    }),

    mkdirp: wrap(async (rel: unknown): Promise<void> => {
      const path = real(rel);
      const kind = await kindOf(path);
      if (kind === 'dir') return;
      if (kind !== null) fail('not-directory', `a file, not a folder: /disk/${rel as string}`);
      await checkParents(path);
      await mkdir(path, { recursive: true });
    }),

    /** SyncFiles.prepare() of DiskSyncFiles: checks access only (3.8.4). */
    prepare: wrap(async (rel: unknown): Promise<void> => {
      const path = real(rel);
      const kind = await kindOf(path);
      if (kind !== null && kind !== 'dir') fail('not-directory', `not a folder: /disk/${rel as string}`);
    }),
  };
}

export interface FsIpcDeps {
  grants: GrantedRoots;
  /** True if the event comes from the main frame of an application window (windows.ts). */
  trusted(event: IpcMainInvokeEvent): boolean;
  /** A change made by the window `sender`; the other windows are told (3.8.6). */
  broadcast(change: DiskChange, sender: WebContents): void;
}

/** Registers the asynchronous channel. */
export function registerFsIpc(ipcMain: IpcMain, deps: FsIpcDeps): void {
  ipcMain.handle(FS_CHANNEL, async (event, op: unknown, ...args: unknown[]): Promise<DiskReply<unknown>> => {
    if (!deps.trusted(event)) return { ok: false, code: 'io', message: 'refused: unknown sender' };
    if (typeof op !== 'string' || !(DISK_FS_OPS as readonly string[]).includes(op)) {
      return { ok: false, code: 'io', message: `refused: unknown operation ${String(op)}` };
    }
    const handlers = createDiskFsHandlers({
      grants: deps.grants,
      onChange: (change) => deps.broadcast(change, event.sender),
    });
    return handlers[op as DiskFsOp](...args);
  });
}
