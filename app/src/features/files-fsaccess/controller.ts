// What the File System Access additions do (ARCHITECTURE.md 3.8.1, 3.8.2, 3.8.5), apart from the
// browser: the environment (the pickers, the handle store, the linked backend) is passed in, so
// that everything here runs under Node with the stand-ins of fake-handles.ts.
//
//   "Open folder..."          provider 'folder' of the file dialogs: the browser's folder picker,
//                             then the folder is mounted at /folder and the dialog shows it
//                             (the provider resolves null, as providers.ts of FS1 describes)
//   "From this computer..."   provider 'upload', which in a browser with this API replaces FS1's
//                             copy into /browser/Imported: the picked files are LINKED (/linked/<id>/),
//                             so that Save writes to them
//   a dropped folder          "Open this folder?", then mounted (FS1's drop.ts asks the provider)
//   the folder of last time   mounted at start when the browser still grants access
//                             (createStartupBackends); otherwise a toast offers to open it again, and
//                             its button asks the browser inside the click
//   a linked file             a toast (the banner of 3.8.2) with "Open the containing folder..."
//
// Only one folder is open at a time. Another one is opened only when no document and no loaded
// program comes from the open one, because the same path would then name a file of another folder.
//
// Owner: FS2.

import type { AppContext, FileSourceProvider, OpenRequest, VPath } from '../../contracts';
import { isWithin } from '../../core/paths/winpath';
import {
  FOLDER_KEY,
  FOLDER_MOUNT,
  FolderBackend,
  LINKED_MOUNT,
  LinkedBackend,
  hasPermission,
  storedFolder,
  type FsaDirectoryHandle,
  type FsaFileHandle,
  type FsaHandle,
  type HandleStore,
} from '../../fs/fsaccess-backend';
import { FILE_PICKER_ID, FOLDER_PICKER_ID, isPickerCancel, pickerTypes, type Pickers } from './pickers';
import {
  DROPPED_FOLDER_QUESTION,
  FOLDER_TITLE,
  FROM_COMPUTER_LABEL,
  FSACCESS_TEXTS,
  OPEN_CONTAINING_FOLDER,
  OPEN_FOLDER_LABEL,
} from './texts';

/** FS1's provider ids (features/files/providers.ts); repeated here because a feature may not import another. */
export const FOLDER_PROVIDER_ID = 'folder';
export const UPLOAD_PROVIDER_ID = 'upload';

export interface FsAccessEnv extends Pickers {
  /** The handle store of the page (IndexedDB `easy68k-fsaccess`). */
  handles(): Promise<HandleStore>;
  /** A linked-files backend, for when none was mounted at start. */
  createLinked(handles: HandleStore): Promise<LinkedBackend>;
}

async function same(a: FsaHandle, b: FsaHandle): Promise<boolean> {
  try {
    return (await a.isSameEntry?.(b)) ?? a === b;
  } catch {
    return false;
  }
}

export class FsAccess {
  /** The folder record offered by the toast at start, if any. */
  private offered: { handle: FsaDirectoryHandle; name: string } | null = null;

  constructor(
    private readonly ctx: AppContext,
    private readonly env: FsAccessEnv,
  ) {}

  /** Registers the providers and offers the folder of the last visit. Returns the function that undoes it. */
  start(): () => void {
    // In this order, so that the dialogs show "From this computer..." before "Open folder..." (3.8.5).
    const removeUpload = this.ctx.fileDialogs.registerProvider(this.linkProvider());
    const removeFolder = this.ctx.fileDialogs.registerProvider(this.folderProvider());
    void this.ensureLinked().catch(() => {});
    void this.offerStoredFolder().catch(() => {});
    return () => {
      removeFolder();
      removeUpload();
    };
  }

  // ---- the opened folder --------------------------------------------------------------------

  /** The FolderBackend at /folder, if one is mounted. */
  folder(): FolderBackend | null {
    const backend = this.ctx.vfs.backends().find((b) => b.mount === FOLDER_MOUNT);
    return backend instanceof FolderBackend ? backend : null;
  }

  /** "Open folder...": the browser's folder picker, then useFolder(). false = nothing opened. */
  async openFolder(startIn?: FsaHandle): Promise<boolean> {
    let handle: FsaDirectoryHandle;
    try {
      const remembered = startIn ?? this.folder()?.handle ?? (await this.stored())?.handle;
      handle = await this.env.showDirectoryPicker({
        id: FOLDER_PICKER_ID,
        mode: 'readwrite',
        ...(remembered ? { startIn: remembered } : {}),
      });
    } catch (error) {
      if (isPickerCancel(error)) return false;
      throw new Error(FSACCESS_TEXTS.pickerFailed(error instanceof Error ? error.message : String(error)), {
        cause: error,
      });
    }
    return this.useFolder(handle);
  }

  /**
   * Mounts `handle` at /folder and remembers it for the next visit. Asks the browser for read and
   * write access (inside the click that led here). false = not opened (refused, or the open folder
   * is in use).
   */
  async useFolder(handle: FsaDirectoryHandle): Promise<boolean> {
    const current = this.folder();
    if (current && (await same(current.handle, handle))) {
      await this.remember(handle);
      return true;
    }
    if (current) {
      const inUse = this.inUse();
      if (inUse) {
        await this.ctx.dialogs.messageBox({
          title: FOLDER_TITLE,
          text: FSACCESS_TEXTS.inUse(current.handle.name, inUse),
          icon: 'warning',
          buttons: ['OK'],
        });
        return false;
      }
    }
    if (!(await hasPermission(handle, 'readwrite', true))) {
      await this.ctx.dialogs.messageBox({
        title: FOLDER_TITLE,
        text: FSACCESS_TEXTS.notAllowed(handle.name),
        icon: 'warning',
        buttons: ['OK'],
      });
      return false;
    }
    await this.mount(handle);
    this.offered = null;
    await this.remember(handle);
    return true;
  }

  /**
   * Mounts the folder in place of the open one. The Vfs has no event for a mount, so the new root is
   * announced as a change of `/folder` (Vfs.mkdirp of a mount root writes nothing and reports a
   * 'write' of it), which makes the Files panel and the dialogs list it (FS1's tree-model.ts).
   */
  private async mount(handle: FsaDirectoryHandle): Promise<void> {
    if (this.folder()) this.ctx.vfs.unmount(FOLDER_MOUNT);
    this.ctx.vfs.mount(new FolderBackend(handle));
    await this.ctx.vfs.mkdirp(`/${FOLDER_MOUNT}`).catch(() => {});
  }

  /** "2 documents and the program": what is open from /folder, or '' when nothing is. */
  private inUse(): string {
    const root: VPath = `/${FOLDER_MOUNT}`;
    const documents = this.ctx.documents.list().filter((doc) => doc.path !== null && isWithin(doc.path, root)).length;
    const program = this.ctx.sim.controller.program;
    const parts: string[] = [];
    if (documents > 0) parts.push(documents === 1 ? '1 document' : `${documents} documents`);
    if (program && isWithin(program.path, root)) parts.push('the program in the simulator');
    return parts.join(' and ');
  }

  private async remember(handle: FsaDirectoryHandle): Promise<void> {
    try {
      await (await this.env.handles()).put(FOLDER_KEY, { handle, name: handle.name });
    } catch {
      // not kept for the next visit; the folder is open now all the same
    }
  }

  private async stored(): Promise<{ handle: FsaDirectoryHandle; name: string } | null> {
    try {
      return await storedFolder(await this.env.handles());
    } catch {
      return null;
    }
  }

  /**
   * At start: the folder of the last visit, when it is not mounted yet. Access still granted: it is
   * mounted. Otherwise a toast offers to open it again (the browser asks inside that click).
   */
  async offerStoredFolder(): Promise<void> {
    if (this.folder()) return;
    const record = await this.stored();
    if (!record) return;
    if (await hasPermission(record.handle, 'readwrite', false)) {
      if (!this.folder()) await this.mount(record.handle);
      return;
    }
    this.offered = record;
    this.ctx.dialogs.toast(
      FSACCESS_TEXTS.reopen(record.name),
      { label: FSACCESS_TEXTS.reopenAction, run: () => void this.reopenOffered() },
      { duration: 0 },
    );
  }

  /** The toast's button: asks the browser for access to the folder of last time, then mounts it. */
  async reopenOffered(): Promise<boolean> {
    const record = this.offered;
    if (!record || this.folder()) return this.folder() !== null;
    return this.useFolder(record.handle);
  }

  private folderProvider(): FileSourceProvider & { openDroppedFolder(handle: unknown): Promise<boolean> } {
    // Resolving null keeps the port's dialog open; it then shows the newly mounted folder.
    const open = async (): Promise<null> => {
      await this.openFolder();
      return null;
    };
    return {
      id: FOLDER_PROVIDER_ID,
      label: OPEN_FOLDER_LABEL,
      available: () => true,
      open,
      save: open,
      openDroppedFolder: (handle) => this.openDroppedFolder(handle),
    };
  }

  /** A folder dropped on the window (3.8.5): "Open this folder?", then mounted. */
  async openDroppedFolder(handle: unknown): Promise<boolean> {
    const candidate = handle as Partial<FsaDirectoryHandle> | null;
    if (!candidate || candidate.kind !== 'directory' || typeof candidate.getDirectoryHandle !== 'function')
      return false;
    const folder = candidate as FsaDirectoryHandle;
    const answer = await this.ctx.dialogs.messageBox({
      title: folder.name,
      text: DROPPED_FOLDER_QUESTION,
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    if (answer !== 'Yes') return true; // taken: the student answered, no toast about folders
    await this.useFolder(folder);
    return true;
  }

  // ---- linked files -------------------------------------------------------------------------

  /** The LinkedBackend at /linked; mounted here when start-up did not. */
  async ensureLinked(): Promise<LinkedBackend> {
    const mounted = this.linked();
    if (mounted) return mounted;
    const created = await this.env.createLinked(await this.env.handles());
    const again = this.linked(); // mounted meanwhile
    if (again) return again;
    this.ctx.vfs.mount(created);
    return created;
  }

  private linked(): LinkedBackend | null {
    const backend = this.ctx.vfs.backends().find((b) => b.mount === LINKED_MOUNT);
    return backend instanceof LinkedBackend ? backend : null;
  }

  private linkProvider(): FileSourceProvider {
    return {
      id: UPLOAD_PROVIDER_ID,
      label: FROM_COMPUTER_LABEL,
      available: () => true,
      open: (request) => this.linkFiles(request),
      linkFileHandle: (handle) => this.linkFileHandle(handle),
    };
  }

  /**
   * A file the application was handed outside a dialog (an installed web app's launch queue, 5.7;
   * FileDialogs.linkFileHandle): linked like a file chosen with "From this computer...", banner
   * included. null when it is not a file handle or cannot be linked.
   */
  async linkFileHandle(handle: unknown): Promise<VPath | null> {
    const candidate = handle as Partial<FsaFileHandle> | null;
    if (!candidate || candidate.kind !== 'file' || typeof candidate.getFile !== 'function') return null;
    try {
      return await this.linkOne(await this.ensureLinked(), candidate as FsaFileHandle);
    } catch {
      return null;
    }
  }

  /** Links one file and shows the banner of 3.8.2 for it. */
  private async linkOne(linked: LinkedBackend, handle: FsaFileHandle): Promise<VPath> {
    const path = await linked.link(handle);
    this.ctx.dialogs.toast(FSACCESS_TEXTS.linked(handle.name), {
      label: OPEN_CONTAINING_FOLDER,
      run: () => void this.openContainingFolder(path, handle).catch(() => {}),
    });
    return path;
  }

  /** "From this computer...": the browser's file picker; each chosen file is linked. null = cancelled. */
  async linkFiles(request: OpenRequest): Promise<VPath[] | null> {
    let handles: FsaFileHandle[];
    try {
      handles = await this.env.showOpenFilePicker({
        id: FILE_PICKER_ID,
        multiple: request.multiple,
        types: pickerTypes(request.filters),
      });
    } catch (error) {
      if (isPickerCancel(error)) return null;
      throw new Error(FSACCESS_TEXTS.pickerFailed(error instanceof Error ? error.message : String(error)), {
        cause: error,
      });
    }
    if (handles.length === 0) return null;
    const linked = await this.ensureLinked();
    const paths: VPath[] = [];
    for (const handle of request.multiple ? handles : handles.slice(0, 1)) {
      paths.push(await this.linkOne(linked, handle));
    }
    return paths;
  }

  /**
   * The banner's "Open the containing folder...": the folder picker starting at the file. When the
   * chosen folder holds the file, its documents that have no unsaved changes are opened again from
   * the folder, so that listings and program files go there (3.8.2).
   */
  async openContainingFolder(linkedPath: VPath, file: FsaFileHandle): Promise<boolean> {
    if (!(await this.openFolder(file))) return false;
    const folder = this.folder();
    if (!folder) return false;
    const segments = await Promise.resolve(folder.handle.resolve?.(file)).catch(() => null);
    if (!segments || segments.length === 0) {
      this.ctx.dialogs.toast(FSACCESS_TEXTS.notContaining(file.name, folder.handle.name));
      return true;
    }
    const target: VPath = `/${FOLDER_MOUNT}/${segments.join('/')}`;
    for (const doc of this.ctx.documents.list()) {
      if (doc.path !== linkedPath || doc.modified) continue;
      if (!(await this.ctx.documents.close(doc.id))) continue;
      await this.ctx.documents.open(target);
      this.ctx.dialogs.toast(FSACCESS_TEXTS.moved(doc.name, folder.handle.name));
    }
    return true;
  }
}
