// Feature "files-fsaccess" (work package FS2): the File System Access additions of the file
// dialogs - the opened folder (/folder) and linked single files (/linked) - in Chromium browsers
// (ARCHITECTURE.md 3.8.1, 3.8.2, 3.8.5). The backends are in app/src/fs/fsaccess-backend.ts, the
// behaviour in controller.ts.
//
// Where the API does not exist (Safari, Firefox, an insecure page) and in the desktop app (which
// has its native dialogs and /disk), the feature does nothing at all: no provider, no button, no
// storage, no message.
//
// Owner: W3 > FS2.

import type { AppContext, FeatureModule } from '../../contracts';
import {
  LinkedBackend,
  fsAccessSupported,
  openLinkedCopies,
  pageHandleStore,
  type FsaDirectoryHandle,
  type FsaFileHandle,
} from '../../fs/fsaccess-backend';
import { FsAccess, type FsAccessEnv } from './controller';
import type { DirectoryPickerOptions, OpenFilePickerOptions } from './pickers';

interface PickerWindow {
  showDirectoryPicker(options: DirectoryPickerOptions): Promise<FsaDirectoryHandle>;
  showOpenFilePicker(options: OpenFilePickerOptions): Promise<FsaFileHandle[]>;
}

/** The environment of a real page: the window's pickers and the page's handle store. */
export function browserEnv(scope: PickerWindow = globalThis as unknown as PickerWindow): FsAccessEnv {
  return {
    showDirectoryPicker: (options) => scope.showDirectoryPicker(options),
    showOpenFilePicker: (options) => scope.showOpenFilePicker(options),
    handles: pageHandleStore,
    createLinked: async (handles) => new LinkedBackend({ copies: await openLinkedCopies(), handles }),
  };
}

/** Whether the feature takes part in this window. */
export function fsAccessAvailable(ctx: AppContext, scope: unknown = globalThis): boolean {
  return ctx.platform.kind === 'web' && !ctx.platform.nativeFileDialogs && fsAccessSupported(scope);
}

export const feature: FeatureModule = {
  id: 'files-fsaccess',
  init(ctx) {
    if (!fsAccessAvailable(ctx)) return;
    return new FsAccess(ctx, browserEnv()).start();
  },
};
