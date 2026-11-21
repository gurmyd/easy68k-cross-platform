// Files dropped on the window (ARCHITECTURE.md 3.8.5; editor-ui §1.4; sim-ui §8.4). The decisions
// are plain functions on DroppedItem objects, so that they are tested under Node; browser-io.ts
// turns a real drop into DroppedItems, index.ts listens for drops.
//
// Editor mode: every dropped file is opened, in the order of the drop's list; a file that cannot
// be read is skipped without a message (editor-ui §1.4). In a browser a dropped file has no path
// the port can keep, so it is first copied into /browser/Imported/ (3.8.1, as "From this
// computer..." does) and the copy is opened.
//
// Simulator mode (sim-ui §8.4): if a program has been loaded, `The current debug environment will
// be lost, click OK to continue.` (title `Caution`, OK / Cancel) comes first, whatever was dropped.
// On OK only the first dropped file counts, and only if its name ends in .S68 (any case); it is
// loaded with RunController.open(path, 'drop'). A dropped .L68 with the same base name is copied
// along, so that the listing appears (docs/differences/FS1.md).
//
// A dropped folder is never opened as a document: a provider that takes dropped folders (FS2's
// "Open this folder?") is offered it; elsewhere a toast says `Drop files, not folders. Use
// Import... for a folder.` In Simulator mode a dropped folder is ignored silently, as the original
// ignores everything that is not an .S68.
//
// Owner: FS1.

import type { Bytes, DialogService, Mode, VPath } from '../../contracts';
import { changeFileExt, foldCase } from '../../core/paths/winpath';
import type { DroppedFolderProvider } from './providers';

export const DROP_FOLDER_TOAST = 'Drop files, not folders. Use Import... for a folder.';
export const DROP_CAUTION_TITLE = 'Caution';
export const DROP_CAUTION_TEXT = 'The current debug environment will be lost, click OK to continue.';

export interface DroppedItem {
  name: string;
  isFolder: boolean;
  /** The file's bytes; rejects when it cannot be read. */
  read(): Promise<Bytes>;
  /** The item's FileSystemHandle where the browser gives one (Chromium), else null. */
  handle: Promise<unknown> | null;
}

export interface DropDeps {
  mode: Mode;
  /** A program has been loaded in the simulator (the original's Reload1->Enabled). */
  programLoaded: boolean;
  messageBox: DialogService['messageBox'];
  toast(text: string): void;
  /** Copies a dropped file into the store and returns the path to open. */
  importFile(name: string, data: Bytes): Promise<VPath>;
  openDocument(path: VPath): Promise<unknown>;
  openProgram(path: VPath): Promise<void>;
  folderProviders(): DroppedFolderProvider[];
}

export interface DropOutcome {
  opened: VPath[];
  skipped: string[];
  folders: 'none' | 'taken' | 'refused';
}

async function offerFolder(item: DroppedItem, deps: DropDeps): Promise<boolean> {
  const handle = item.handle ? await item.handle.catch(() => null) : null;
  if (handle) {
    for (const provider of deps.folderProviders()) {
      try {
        if (await provider.openDroppedFolder(handle)) return true;
      } catch {
        // try the next one, then fall back to the toast
      }
    }
  }
  return false;
}

export async function handleDrop(items: readonly DroppedItem[], deps: DropDeps): Promise<DropOutcome> {
  const outcome: DropOutcome = { opened: [], skipped: [], folders: 'none' };
  if (items.length === 0) return outcome;

  if (deps.mode === 'simulator') {
    if (deps.programLoaded) {
      const answer = await deps.messageBox({
        title: DROP_CAUTION_TITLE,
        text: DROP_CAUTION_TEXT,
        icon: 'none',
        buttons: ['OK', 'Cancel'],
      });
      if (answer !== 'OK') return outcome;
    }
    const first = items[0] as DroppedItem;
    if (first.isFolder || foldCase(first.name).slice(-4) !== '.S68') {
      outcome.skipped.push(first.name);
      return outcome;
    }
    let path: VPath;
    try {
      path = await deps.importFile(first.name, await first.read());
    } catch {
      outcome.skipped.push(first.name);
      return outcome;
    }
    // The listing beside it, if it was dropped too.
    const listingName = foldCase(changeFileExt(first.name, '.L68'));
    const listing = items.find((item, i) => i > 0 && !item.isFolder && foldCase(item.name) === listingName);
    if (listing) {
      try {
        await deps.importFile(listing.name, await listing.read());
      } catch {
        // the program still runs without its listing
      }
    }
    await deps.openProgram(path);
    outcome.opened.push(path);
    return outcome;
  }

  if (deps.mode !== 'editor') return outcome;
  let toldAboutFolders = false;
  for (const item of items) {
    if (item.isFolder) {
      if (await offerFolder(item, deps)) {
        outcome.folders = 'taken';
      } else {
        outcome.folders = outcome.folders === 'taken' ? 'taken' : 'refused';
        if (!toldAboutFolders) deps.toast(DROP_FOLDER_TOAST);
        toldAboutFolders = true;
      }
      continue;
    }
    let path: VPath;
    try {
      path = await deps.importFile(item.name, await item.read());
    } catch {
      outcome.skipped.push(item.name); // unreadable: skipped without a message
      continue;
    }
    try {
      await deps.openDocument(path);
      outcome.opened.push(path);
    } catch {
      outcome.skipped.push(item.name);
    }
  }
  return outcome;
}
