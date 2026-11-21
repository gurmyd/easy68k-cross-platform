// The 68000 program's files (ARCHITECTURE.md 3.8.4): the C library streams of the original over a
// SyncFiles view, and the task 58 dialog.
//
// STUB written by W1 (wave 0). SH6 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub opens no file and returns the
// engine's defaults (HOST_DEFAULTS of engine/sim/sim68k.mjs); its fileDialog does nothing, so a
// program that calls task 58 waits.
//
// Owner: W1 > SH6.

import type { Bytes, ProgramFilesApi, ProgramFilesDeps, VPath } from '../../../contracts';

export type { ProgramFilesDeps } from '../../../contracts';

export const STDIO_BUFFER = 512; // bytes; Borland BUFSIZ, to be confirmed (O-15)

export class ProgramFiles implements ProgramFilesApi {
  readonly currentDir: VPath | null = null;
  readonly unsaved: boolean = false;

  constructor(private readonly deps: ProgramFilesDeps) {}

  async setCurrentDir(_dir: VPath): Promise<void> {}
  read(_name: Bytes): Bytes | null {
    return null;
  }
  markStale(): void {}
  async revalidateIfStale(): Promise<void> {}
  async exit(): Promise<void> {}
  exitNow(): void {}
  async recoverJournal(): Promise<void> {}
  resetToStartup(): void {}

  /* HostFiles */
  fileOpen(_name: Bytes, _mode: number): number {
    return 0;
  }
  fileRead(_handle: number, _count: number): Bytes | null {
    return null;
  }
  fileWrite(_handle: number, _data: Bytes): number {
    return -1;
  }
  fileSeek(_handle: number, _offset: number, _whence: number): number {
    return -1;
  }
  fileClose(_handle: number): boolean {
    return false;
  }
  fileRemove(_name: Bytes): boolean {
    return false;
  }
  fileDialog(_mode: number, _title: Bytes, _filter: Bytes, _fileName: Bytes): void {}
}
