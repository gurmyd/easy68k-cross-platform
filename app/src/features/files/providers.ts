// Where files can come from besides the stores the Vfs mounts (ARCHITECTURE.md 3.8.5): the
// sources of the file dialogs. FS1's dialogs (dialogs.ts) list the mounted stores themselves and
// show one button per registered provider:
//
//   id 'upload'   "From this computer..."  <input type="file">, imports into /browser/Imported (FS1)
//   id 'folder'   "Open folder..."         File System Access API, mounts /folder (FS2)
//   id 'native'   the desktop app's native dialogs; when it is available it REPLACES the port's
//                 dialogs entirely (3.8.5: "Desktop: the native dialogs")
//
// A provider registers through ctx.fileDialogs.registerProvider(provider) and gets back the
// function that removes it. When a provider's open() or save() resolves to null, the port's
// dialog stays open and shows its locations again: that is how "Open folder..." works - FS2 mounts
// the folder, resolves null, and the folder appears in the dialog. A non-null result closes the
// dialog with that result.
//
// Dropped folders (3.8.5): a provider that can take a folder the user dropped on the window gives
// itself the optional method openDroppedFolder(item). It receives the DataTransferItem's
// FileSystemHandle (getAsFileSystemHandle(), Chromium) and resolves true when it took the folder
// (FS2 asks "Open this folder?" and mounts it). Registering an object with that extra method is
// allowed by the contract's structural type.
//
// Owner: FS1. The types themselves are contract (contracts/fs.ts, W1), re-exported here.

import type { FileSourceProvider } from '../../contracts';

export type { FileDialogs, FileFilter, FileSourceProvider, OpenRequest, SaveRequest } from '../../contracts';

export const UPLOAD_PROVIDER_ID = 'upload';
export const FOLDER_PROVIDER_ID = 'folder';
export const NATIVE_PROVIDER_ID = 'native';
export const BROWSER_PROVIDER_ID = 'browser';

/** A provider that can also take a dropped folder (see the header). */
export interface DroppedFolderProvider extends FileSourceProvider {
  openDroppedFolder(handle: unknown): Promise<boolean>;
}

export function canTakeDroppedFolder(provider: FileSourceProvider): provider is DroppedFolderProvider {
  return typeof (provider as Partial<DroppedFolderProvider>).openDroppedFolder === 'function';
}

/** The registered providers, in registration order. One provider per id; a later one replaces it. */
export interface ProviderRegistry {
  register(provider: FileSourceProvider): () => void;
  get(id: string): FileSourceProvider | undefined;
  /** The providers whose available() is true. */
  available(): FileSourceProvider[];
  subscribe(listener: () => void): () => void;
}

export function createProviderRegistry(): ProviderRegistry {
  const providers: FileSourceProvider[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    register(provider) {
      const existing = providers.findIndex((p) => p.id === provider.id);
      if (existing >= 0) providers.splice(existing, 1);
      providers.push(provider);
      notify();
      return () => {
        const index = providers.indexOf(provider);
        if (index >= 0) {
          providers.splice(index, 1);
          notify();
        }
      };
    },
    get: (id) => providers.find((p) => p.id === id),
    available: () =>
      providers.filter((p) => {
        try {
          return p.available();
        } catch {
          return false;
        }
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
