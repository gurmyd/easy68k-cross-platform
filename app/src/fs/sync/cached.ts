// The cached SyncFiles view of the /browser, /linked and /folder mounts (ARCHITECTURE.md 3.8.4):
// prepare(dir) loads the tree into memory, calls act on the copy, changes are written through to
// the Vfs with the write-behind helper.
//
// STUB written by W1 (wave 0). SH6 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub reaches no file: names resolve
// lexically, every file operation fails as for a missing file.
//
// Owner: W1 > SH6.

import type { Bytes, CachedSyncFilesDeps, SyncFiles, VPath } from '../../contracts';
import { isVPath, resolveLexically } from '../../core/paths/winpath';

export type { CachedSyncFilesDeps } from '../../contracts';

export class CachedSyncFiles implements SyncFiles {
  readonly unsettled: boolean = false;

  constructor(private readonly deps: CachedSyncFilesDeps) {}

  async prepare(_dir: VPath): Promise<void> {}
  async revalidate(): Promise<void> {}
  resolve(dir: VPath, name: string): VPath | null {
    return isVPath(dir) ? resolveLexically(dir, name) : null;
  }
  stat(_path: VPath): { size: number; readOnly: boolean } | null {
    return null;
  }
  read(_path: VPath, _position: number, _count: number): Bytes | null {
    return null;
  }
  write(_path: VPath, _position: number, _data: Bytes): boolean {
    return false;
  }
  create(_path: VPath): boolean {
    return false;
  }
  remove(_path: VPath): boolean {
    return false;
  }
  async settled(): Promise<void> {}
}
