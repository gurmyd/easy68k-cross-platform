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
// loaded with RunController.open(path, 'drop'). For an .S68 the controller asks that question: in
// a browser through RunController.confirmLoad('drop') before the file is copied (nothing is copied
// on Cancel), then open(copy, 'drop', { confirmed: true }); a file opened where it lies (the desktop
// app), or a controller without confirmLoad, gets it inside open (ARCHITECTURE.md 4.7 step 2). This
// file asks it itself only when something else was dropped, which is then ignored. A dropped .L68
// with the same base name is copied along, so that the listing appears (docs/differences/FS1.md).
//
// The desktop app (docs/porting/errata/DV2.md 4a): deps.locate names a dropped file's real place on
// /disk (DesktopPlatform.grantDroppedFile). A file found there is opened where it is, not copied; a
// dropped folder becomes the start folder of the Open dialog (3.8.5, deps.openFolder).
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
  /** The dropped File itself (for DropDeps.locate), when the drop gave one. */
  file?: unknown;
}

/** Where a dropped item really is (the desktop app's disk). */
export interface LocatedItem {
  path: VPath;
  kind: 'file' | 'dir';
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
  /** Loads a program; `confirmed` when confirmLoad has just been asked and answered OK. */
  openProgram(path: VPath, confirmed?: boolean): Promise<void>;
  /**
   * Step 2 of the load on its own (RunController.confirmLoad('drop')): asks `Caution` when a
   * program is loaded and resolves false on Cancel. Where it exists the question comes before a
   * dropped .S68 is copied, as the original asks before anything happens.
   */
  confirmLoad?(): Promise<boolean>;
  folderProviders(): DroppedFolderProvider[];
  /** The desktop app: the item's place on /disk, or null (then it is copied as in a browser). */
  locate?(item: DroppedItem): Promise<LocatedItem | null>;
  /** The desktop app: shows the Open dialog in a dropped folder and opens what is chosen. */
  openFolder?(dir: VPath): Promise<void>;
}

async function locate(item: DroppedItem, deps: DropDeps): Promise<LocatedItem | null> {
  if (!deps.locate) return null;
  try {
    return await deps.locate(item);
  } catch {
    return null;
  }
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
    const first = items[0] as DroppedItem;
    if (first.isFolder || foldCase(first.name).slice(-4) !== '.S68') {
      // The original asks even when what was dropped is no program, and then ignores it.
      if (deps.programLoaded) {
        await deps.messageBox({
          title: DROP_CAUTION_TITLE,
          text: DROP_CAUTION_TEXT,
          icon: 'none',
          buttons: ['OK', 'Cancel'],
        });
      }
      outcome.skipped.push(first.name);
      return outcome;
    }
    let path: VPath;
    let confirmed = false;
    const located = await locate(first, deps);
    if (located?.kind === 'file') {
      path = located.path; // the listing beside it is found there by the controller
    } else {
      // The copy must not happen when the user cancels the Caution question (sim-ui §8.4).
      if (deps.confirmLoad) {
        if (!(await deps.confirmLoad())) {
          outcome.skipped.push(first.name);
          return outcome;
        }
        confirmed = true;
      }
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
    }
    // Without confirmLoad (or for a file opened where it lies), RunController.open asks the Caution
    // question itself when a program is loaded (4.7 step 2).
    await deps.openProgram(path, confirmed || undefined);
    outcome.opened.push(path);
    return outcome;
  }

  if (deps.mode !== 'editor') return outcome;
  let toldAboutFolders = false;
  for (const item of items) {
    const located = await locate(item, deps);
    if (located?.kind === 'dir' && deps.openFolder) {
      await deps.openFolder(located.path);
      outcome.folders = 'taken';
      continue;
    }
    if (located?.kind === 'file') {
      try {
        await deps.openDocument(located.path);
        outcome.opened.push(located.path);
      } catch {
        outcome.skipped.push(item.name);
      }
      continue;
    }
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
