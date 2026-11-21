// The /disk mount of the desktop app (ARCHITECTURE.md 3.8.1): the real file system, reached
// through the Electron main process. `/disk/Users/me/x.X68` is `/Users/me/x.X68`.
//
// Every call is one asynchronous bridge call (`ipcRenderer.invoke`, desktop/src/fs-ipc.ts). The
// main process acts only inside the granted roots (7.6) and answers with a DiskReply, which this
// class turns into the value or into an FsError with the same code (fs/vfs.ts fsError()).
//
// Writes and removes made by another window of the app reach onExternalChange() (3.8.6): the main
// process reports every change made through its handlers to the other windows.
//
//     const disk = new DiskBackend({ bridge: window.easy68kDesktop, label: 'This Mac' });
//     await disk.readFile('Users/me/demo/prog.X68');
//
// `base` (tests): a folder of the real file system that stands for the root of the mount, so that
// the backend contract suite can run against an empty temporary folder.
//
// Not exported: createStartupBackends. The platform (platform/desktop.ts) creates this backend
// and bootstrap() mounts `platform.disk` itself (docs/porting/errata/W3.md, entry 11).
//
// Owner: DV2.

import type { BackendChange, Bytes, DirEntry, FileStat, FileSystemBackend, FsErrorCode } from '../contracts';
import { fsError } from './vfs';

/** A reply of the main process (desktop/src/fs-ipc.ts DiskReply). */
export type DiskReply<T> = { ok: true; value: T } | { ok: false; code: FsErrorCode; message: string };

/** The operations of the asynchronous file channel (desktop/src/fs-ipc.ts DISK_FS_OPS). */
export type DiskFsOp = 'stat' | 'readFile' | 'writeFile' | 'appendFile' | 'remove' | 'list' | 'mkdirp' | 'prepare';

/** What DiskBackend needs of window.easy68kDesktop. */
export interface DiskFsBridge {
  fs(op: DiskFsOp, ...args: unknown[]): Promise<unknown>;
  /** Changes made by the other windows; absent in tests without them. */
  onFsChange?(listener: (change: { rel: string; kind: 'write' | 'remove' }) => void): () => void;
}

export interface DiskBackendOptions {
  bridge: DiskFsBridge;
  /** Shown in dialogs. Default "This Mac". */
  label?: string;
  /** Tests: the path inside /disk that stands for the root of the mount ('' = the whole disk). */
  base?: string;
}

const CODES: readonly FsErrorCode[] = ['not-found', 'is-directory', 'not-directory', 'read-only', 'invalid-path', 'io'];

/** True for a path inside a mount as FileSystemBackend takes it: no leading '/', no '.' or '..'. */
function isRel(rel: string): boolean {
  if (rel === '') return true;
  return rel
    .split('/')
    .every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\'));
}

export class DiskBackend implements FileSystemBackend {
  readonly mount = 'disk';
  readonly kind = 'disk' as const;
  readonly label: string;
  private readonly bridge: DiskFsBridge;
  private readonly base: string;

  constructor(options: DiskBackendOptions) {
    this.bridge = options.bridge;
    this.label = options.label ?? 'This Mac';
    this.base = options.base ?? '';
    if (!isRel(this.base)) throw new TypeError(`not a path inside /disk: "${this.base}"`);
  }

  stat(rel: string): Promise<FileStat | null> {
    return this.call<FileStat | null>('stat', rel);
  }

  readFile(rel: string): Promise<Bytes> {
    return this.call<Bytes>('readFile', rel);
  }

  writeFile(rel: string, data: Bytes): Promise<void> {
    return this.call<void>('writeFile', rel, data.slice());
  }

  appendFile(rel: string, data: Bytes): Promise<void> {
    return this.call<void>('appendFile', rel, data.slice());
  }

  remove(rel: string): Promise<void> {
    return this.call<void>('remove', rel);
  }

  list(rel: string): Promise<DirEntry[]> {
    return this.call<DirEntry[]>('list', rel);
  }

  mkdirp(rel: string): Promise<void> {
    return this.call<void>('mkdirp', rel);
  }

  onExternalChange(listener: (change: BackendChange) => void): () => void {
    if (!this.bridge.onFsChange) return () => {};
    const prefix = this.base === '' ? '' : `${this.base}/`;
    return this.bridge.onFsChange((change) => {
      if (typeof change?.rel !== 'string' || (change.kind !== 'write' && change.kind !== 'remove')) return;
      if (prefix !== '' && !change.rel.startsWith(prefix)) return;
      listener({ rel: change.rel.slice(prefix.length), kind: change.kind });
    });
  }

  /** The path inside /disk of a path inside this backend. */
  private full(rel: string): string {
    if (typeof rel !== 'string' || !isRel(rel)) throw fsError('invalid-path', `not a path inside the mount: "${rel}"`);
    if (this.base === '') return rel;
    return rel === '' ? this.base : `${this.base}/${rel}`;
  }

  private async call<T>(op: DiskFsOp, rel: string, ...args: unknown[]): Promise<T> {
    const reply = (await this.bridge.fs(op, this.full(rel), ...args)) as DiskReply<T> | null;
    if (reply === null || typeof reply !== 'object' || typeof reply.ok !== 'boolean') {
      throw fsError('io', `the desktop bridge gave no answer to ${op}`);
    }
    if (reply.ok) return reply.value;
    throw fsError(CODES.includes(reply.code) ? reply.code : 'io', reply.message);
  }
}
