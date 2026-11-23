// The question before a large import (ARCHITECTURE-PLUS P3.2.6): before Import Files, Import
// Folder, a .zip and files dropped on the window, when more than 100 files or more than 10 MB go
// into the browser's storage. An opened folder and the desktop app's disk are the student's own
// disk, not the browser's storage: neither question there. Owner: N5.

import type { DialogService, Vfs, VPath } from '../../contracts';
import { splitVPath } from '../../core/paths/winpath';
import { IMPORT_TITLE, largeImportQuestion, notEnoughRoom } from './texts';

export const LARGE_IMPORT_FILES = 100;
export const LARGE_IMPORT_BYTES = 10 * 1024 * 1024;
/** Room the student's files keep beyond an import (P3.2.6, P3.3.4's "tight"). */
export const IMPORT_RESERVE_BYTES = 32 * 1024 * 1024;

/** navigator.storage.estimate as the page has it, or null. */
export type StorageEstimator = (() => Promise<{ quota?: number; usage?: number }>) | null;

export interface ImportGuardDeps {
  vfs: Pick<Vfs, 'backends'>;
  dialogs: Pick<DialogService, 'messageBox'>;
  estimate: StorageEstimator;
  /** How the target is named in the question ("My Programs/demo"). */
  where(dir: VPath): string;
}

/** The page's navigator.storage.estimate, or null where there is none (Node, an old browser). */
export function pageEstimator(): StorageEstimator {
  const storage = (globalThis as { navigator?: { storage?: { estimate?: () => Promise<StorageEstimate> } } }).navigator
    ?.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  return () => (storage.estimate as () => Promise<StorageEstimate>).call(storage);
}

/** True when `dir` lies in the browser's own storage (My Programs). */
export function inBrowserStorage(vfs: Pick<Vfs, 'backends'>, dir: VPath): boolean {
  const { mount } = splitVPath(dir);
  const backend = vfs.backends().find((b) => b.mount === mount);
  return backend !== undefined && mount === 'browser';
}

/** True when the import is large enough to be asked about (above 100 files or above 10 MB). */
export function isLargeImport(count: number, bytes: number): boolean {
  return count > LARGE_IMPORT_FILES || bytes > LARGE_IMPORT_BYTES;
}

/** The free space the estimate gives, or null without one. */
export async function freeSpace(estimate: StorageEstimator): Promise<number | null> {
  if (!estimate) return null;
  try {
    const { quota, usage } = await estimate();
    if (typeof quota !== 'number' || !Number.isFinite(quota)) return null;
    return Math.max(0, quota - (typeof usage === 'number' ? usage : 0));
  } catch {
    return null;
  }
}

/**
 * Asks before a large import into the browser's storage; refuses one that does not fit. Resolves
 * true when the import goes on.
 */
export async function guardImport(deps: ImportGuardDeps, dir: VPath, count: number, bytes: number): Promise<boolean> {
  if (!inBrowserStorage(deps.vfs, dir) || !isLargeImport(count, bytes)) return true;
  const free = await freeSpace(deps.estimate);
  if (free !== null && bytes > free - IMPORT_RESERVE_BYTES) {
    await deps.dialogs.messageBox({
      title: IMPORT_TITLE,
      text: notEnoughRoom(count, bytes, free),
      icon: 'warning',
      buttons: ['OK'],
    });
    return false;
  }
  const answer = await deps.dialogs.messageBox({
    title: IMPORT_TITLE,
    text: largeImportQuestion(count, bytes, deps.where(dir), free),
    icon: 'confirmation',
    buttons: ['Yes', 'No'],
  });
  return answer === 'Yes';
}
