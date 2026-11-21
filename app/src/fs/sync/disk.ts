// DiskSyncFiles: the SyncFiles view of the /disk mount in the desktop app (ARCHITECTURE.md 3.8.4).
//
// Every call is a synchronous bridge call (`ipcRenderer.sendSync`, desktop/src/sync-ipc.ts) that
// the main process performs on the real file at that moment. Nothing is cached, so a file copied
// into the folder, or saved from the editor, a second before Rewind and Run is there, as in the
// original. The view reaches only the granted roots of 7.6: a name that leaves them does not
// resolve, and the program gets the result the original gives for a missing file.
//
//     const view = new DiskSyncFiles({ bridge: window.easy68kDesktop });
//     await view.prepare('/disk/Users/me/demo');
//     view.resolve('/disk/Users/me/demo', 'DATA.TXT');   // '/disk/Users/me/demo/data.txt'
//
// Names are resolved lexically here (Windows rules, core/paths/winpath.ts); the main process
// gives each segment its stored spelling and checks the granted roots.
//
// Owner: DV2.

import type { Bytes, SyncFiles, VPath } from '../../contracts';
import { isVPath, joinVPath, resolveLexically, splitVPath } from '../../core/paths/winpath';
import type { DiskFsBridge, DiskReply } from '../disk-backend';
import { fsError } from '../vfs';

/** The operations of the synchronous file channel (desktop/src/sync-ipc.ts DISK_SYNC_OPS). */
export type DiskSyncOp = 'resolve' | 'stat' | 'read' | 'write' | 'create' | 'remove';

/** What DiskSyncFiles needs of window.easy68kDesktop. */
export interface DiskSyncBridge extends DiskFsBridge {
  fsSync(op: DiskSyncOp, ...args: unknown[]): unknown;
}

export interface DiskSyncFilesOptions {
  bridge: DiskSyncBridge;
}

const MOUNT = 'disk';

export class DiskSyncFiles implements SyncFiles {
  /** Every change is on disk when the call returns. */
  readonly unsettled = false;
  private readonly bridge: DiskSyncBridge;

  constructor(options: DiskSyncFilesOptions) {
    this.bridge = options.bridge;
  }

  /** A direct view loads nothing; it checks that the folder may be reached. */
  async prepare(dir: VPath): Promise<void> {
    const rel = this.relOf(dir);
    if (rel === null) throw fsError('invalid-path', `not a folder of /disk: "${dir}"`);
    const reply = (await this.bridge.fs('prepare', rel)) as DiskReply<void> | null;
    if (!reply || reply.ok !== true) {
      throw fsError(
        reply?.ok === false ? reply.code : 'io',
        reply?.ok === false ? reply.message : `cannot prepare ${dir}`,
      );
    }
  }

  async revalidate(): Promise<void> {}

  resolve(dir: VPath, name: string): VPath | null {
    if (this.relOf(dir) === null || typeof name !== 'string') return null;
    const lexical = resolveLexically(dir, name);
    if (lexical === null) return null;
    const stored = this.bridge.fsSync('resolve', splitVPath(lexical).rel);
    return typeof stored === 'string' ? joinVPath(MOUNT, stored) : null;
  }

  stat(path: VPath): { size: number; readOnly: boolean } | null {
    const rel = this.relOf(path);
    if (rel === null) return null;
    const reply = this.bridge.fsSync('stat', rel) as { size?: unknown; readOnly?: unknown } | null;
    if (!reply || typeof reply.size !== 'number' || typeof reply.readOnly !== 'boolean') return null;
    return { size: reply.size, readOnly: reply.readOnly };
  }

  read(path: VPath, position: number, count: number): Bytes | null {
    const rel = this.relOf(path);
    if (rel === null || !isCount(position) || !isCount(count)) return null;
    const reply = this.bridge.fsSync('read', rel, position, count);
    return reply instanceof Uint8Array ? reply : null;
  }

  write(path: VPath, position: number, data: Bytes): boolean {
    const rel = this.relOf(path);
    if (rel === null || !isCount(position) || !(data instanceof Uint8Array)) return false;
    return this.bridge.fsSync('write', rel, position, data) === true;
  }

  create(path: VPath): boolean {
    const rel = this.relOf(path);
    return rel !== null && rel !== '' && this.bridge.fsSync('create', rel) === true;
  }

  remove(path: VPath): boolean {
    const rel = this.relOf(path);
    return rel !== null && rel !== '' && this.bridge.fsSync('remove', rel) === true;
  }

  async settled(): Promise<void> {}

  /** The path inside /disk of a VPath of this mount, or null. */
  private relOf(path: VPath): string | null {
    if (typeof path !== 'string' || !isVPath(path)) return null;
    const { mount, rel } = splitVPath(path);
    return mount === MOUNT ? rel : null;
  }
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
