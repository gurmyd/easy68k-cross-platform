// The file dialogs of the application (ARCHITECTURE.md 3.8.5): the only place that opens one.
//
//   const paths = await ctx.fileDialogs.open({ title: 'Open File', filters, multiple: false });
//   const path = await ctx.fileDialogs.save({ title: 'Save As', filters, defaultExt: '*.X68' });
//
// In a browser the port's own dialogs `file.open` and `file.save` (FileDialog.tsx) list the
// mounted stores - the browser store, an opened folder - and show a button per provider
// (providers.ts): "From this computer...", "Open folder...". When a provider with the id 'native'
// is registered and available (the desktop app), its dialogs are used instead.
//
// save() resolves only after the overwrite question has been answered (contract: "overwrite
// already confirmed"): an existing file gives `File exists! OK to overwrite?` (title `Caution!`,
// Yes / No), and No abandons the save, as in the original (editor-ui §6.4). A request may carry
// its own question in `overwritePrompt` (the Memory panel's `File exists! OK to replace?`, title
// `Alert`), or null for none (contract SaveRequest.overwritePrompt, added at gate I1).
//
// This file holds the service and the decisions of the dialogs' buttons as plain functions, so
// that they are tested under Node; FileDialog.tsx draws them.
//
// Owner: FS1.

import type {
  AppContext,
  DialogService,
  FileDialogs,
  FileFilter,
  FolderRequest,
  OpenRequest,
  SaveRequest,
  Vfs,
  VPath,
} from '../../contracts';
import { basename, dirname, isVPath, resolveLexically, splitVPath } from '../../core/paths/winpath';
import { OVERWRITE_TEXT, OVERWRITE_TITLE, applyDefaultExtension, invalidNameReason, matchesFilter } from './filters';
import { NATIVE_PROVIDER_ID, createProviderRegistry, type ProviderRegistry } from './providers';
import { chooseStartDir, locationOf, makeFolder } from './store';

export const OPEN_DIALOG_ID = 'file.open';
export const SAVE_DIALOG_ID = 'file.save';

/** What the dialog components receive. */
export interface OpenDialogProps {
  kind: 'open';
  request: OpenRequest;
  startDir: VPath | null;
  registry: ProviderRegistry;
  /** The text the File name field starts with (OpenRequest.initialName; gate I2). */
  initialName?: string;
}
export interface SaveDialogProps {
  kind: 'save';
  request: SaveRequest;
  startDir: VPath | null;
  /** The suggested file name (from request.suggested). */
  initialName: string;
  registry: ProviderRegistry;
  /** The folder chooser of chooseFolder(): the dialog returns a folder (decideSave's `folderMode`). */
  folder?: boolean;
}
export type FileDialogProps = OpenDialogProps | SaveDialogProps;

/** The one filter of the folder chooser: no pattern, so that only folders are listed. */
export const FOLDER_FILTER: FileFilter = { label: 'Folder', patterns: [] };

/** The file dialogs plus what the Files feature itself uses. */
export interface FileDialogService extends FileDialogs {
  readonly registry: ProviderRegistry;
  /**
   * A folder (Help > Examples... in the desktop app, 5.8; FileDialogs.chooseFolder). The native
   * provider's folder dialog where there is one; elsewhere the port's Save dialog in folder mode:
   * OK with an empty name takes the folder shown, a typed name is the folder, created if it does
   * not exist. null = cancelled.
   */
  chooseFolder(request: FolderRequest): Promise<VPath | null>;
  /** The folder the last dialog ended in (the next one starts there). */
  lastDir(): VPath | null;
}

export function createFileDialogService(ctx: AppContext, registry = createProviderRegistry()): FileDialogService {
  let last: VPath | null = null;
  const native = () => {
    const provider = registry.get(NATIVE_PROVIDER_ID);
    return provider && provider.available() ? provider : undefined;
  };
  /**
   * A native dialog opened from Simulator mode holds the program like any modal dialog (3.8.5 last
   * sentence, 4.4.5). The port's own dialogs are held by ctx.dialogs.open; a native one is not shown
   * through it, so the hold is taken here.
   */
  const heldWhileOpen = async <T>(show: () => Promise<T>): Promise<T> => {
    const release = ctx.store.getState().mode === 'simulator' ? ctx.sim.controller.hold() : undefined;
    try {
      return await show();
    } finally {
      release?.();
    }
  };
  /** The port's own Save dialog (the Save dialog of save(), or the folder chooser of chooseFolder()). */
  const showSaveDialog = async (request: SaveRequest, folder: boolean, folderStart?: VPath): Promise<VPath | null> => {
    const suggested = request.suggested && isVPath(request.suggested) ? request.suggested : undefined;
    // The folder of `suggested` wins over SaveRequest.startDir (contract; errata SH6.md C1).
    const startDir = await chooseStartDir(ctx.vfs, [
      folderStart,
      suggested ? dirname(suggested) : undefined,
      request.startDir,
      last,
    ]);
    const props: SaveDialogProps = {
      kind: 'save',
      request,
      startDir,
      initialName: suggested ? basename(suggested) : '',
      registry,
      ...(folder ? { folder: true } : {}),
    };
    const result = await ctx.dialogs.open<SaveDialogProps, VPath | null>(SAVE_DIALOG_ID, props);
    if (!result) return null;
    last = folder ? result : dirname(result);
    return result;
  };
  return {
    registry,
    lastDir: () => last,
    registerProvider: (provider) => registry.register(provider),

    async open(request) {
      const nativeProvider = native();
      if (nativeProvider?.open) {
        const nativeOpen = nativeProvider.open.bind(nativeProvider);
        return heldWhileOpen(() => nativeOpen(request));
      }
      const startDir = await chooseStartDir(ctx.vfs, [request.startDir, last]);
      const props: OpenDialogProps = {
        kind: 'open',
        request,
        startDir,
        registry,
        ...(request.initialName ? { initialName: request.initialName } : {}),
      };
      const result = await ctx.dialogs.open<OpenDialogProps, VPath[] | null>(OPEN_DIALOG_ID, props);
      if (!result || result.length === 0) return null;
      last = dirname(result[0] as VPath);
      return result;
    },

    async save(request) {
      const nativeProvider = native();
      if (nativeProvider?.save) {
        const nativeSave = nativeProvider.save.bind(nativeProvider);
        return heldWhileOpen(() => nativeSave(request));
      }
      return showSaveDialog(request, false);
    },

    async chooseFolder(request) {
      const nativeProvider = native();
      if (nativeProvider?.chooseFolder) {
        const nativeChoose = nativeProvider.chooseFolder.bind(nativeProvider);
        return heldWhileOpen(() => nativeChoose(request));
      }
      // The port's Save dialog in folder mode (decideSave's `folderMode`): OK with an empty name takes
      // the folder shown, a typed existing folder is taken, a typed new name is created.
      const chosen = await showSaveDialog(
        { title: request.title, filters: [FOLDER_FILTER], defaultExt: '', overwritePrompt: null },
        true,
        request.startDir,
      );
      if (chosen === null) return null;
      const stat = await ctx.vfs.stat(chosen).catch(() => null);
      if (stat?.kind === 'file') {
        await ctx.dialogs.messageBox({
          title: request.title,
          text: `"${basename(chosen)}" is a file, not a folder.`,
          icon: 'error',
          buttons: ['OK'],
        });
        return null;
      }
      if (stat === null) await makeFolder(ctx.vfs, chosen);
      return chosen;
    },

    /**
     * A file handed to the application as a FileSystemFileHandle (an installed web app's
     * launchQueue, 5.7): the first available provider that can link one does (FS2's, in
     * Chromium); null when none can. Added to the contract at gate I2.
     */
    async linkFileHandle(handle) {
      const provider = registry.available().find((p) => typeof p.linkFileHandle === 'function');
      return provider?.linkFileHandle ? provider.linkFileHandle(handle) : null;
    },
  };
}

// ---- the decisions of the dialogs' buttons -----------------------------------------------------------

/** What pressing Open or Save (or Enter in the name field) does. */
export type DialogStep =
  | { kind: 'done'; paths: VPath[] }
  | { kind: 'navigate'; dir: VPath }
  | { kind: 'filter'; filter: FileFilter }
  | { kind: 'error'; title: string; text: string }
  | { kind: 'abandon' }
  | { kind: 'nothing' };

const hasWildcard = (name: string) => /[*?]/.test(name);

/**
 * The Open button: a selected file, or a typed name relative to the shown folder. A typed folder
 * is entered, a typed pattern (*.ASM) becomes the filter, a name that does not exist is reported
 * with the Windows dialog's text.
 */
export async function decideOpen(
  vfs: Vfs,
  dir: VPath,
  typed: string,
  selected: { path: VPath; kind: 'file' | 'dir' } | null,
  title: string,
): Promise<DialogStep> {
  const name = typed.trim().replace(/^"(.*)"$/, '$1');
  if (name === '') {
    if (!selected) return { kind: 'nothing' };
    return selected.kind === 'dir'
      ? { kind: 'navigate', dir: selected.path }
      : { kind: 'done', paths: [selected.path] };
  }
  if (hasWildcard(name))
    return { kind: 'filter', filter: { label: name, patterns: name.split(';').map((p) => p.trim()) } };
  const found = await vfs.resolve(dir, name);
  if (found !== null) {
    const stat = await vfs.stat(found).catch(() => null);
    if (stat?.kind === 'dir') return { kind: 'navigate', dir: found };
    if (stat?.kind === 'file') return { kind: 'done', paths: [found] };
  }
  return { kind: 'error', title, text: `${name}\nFile not found.\nCheck the file name and try again.` };
}

/**
 * The Save button (editor-ui §6.4): the default extension rule, then the overwrite question.
 * A typed folder is entered. The result path keeps the stored spelling of an existing file.
 *
 * With `folderMode` set (the folder chooser of chooseFolder) the result is a folder instead: an empty
 * name takes the folder shown, a typed existing folder is taken rather than entered, and a typed
 * name that does not exist is returned for the caller to create. A typed existing file is an error.
 */
export async function decideSave(
  vfs: Vfs,
  dialogs: Pick<DialogService, 'messageBox'>,
  dir: VPath,
  typed: string,
  filterIndex: number,
  request: SaveRequest,
  folderMode = false,
): Promise<DialogStep> {
  const raw = typed.trim().replace(/^"(.*)"$/, '$1');
  if (raw === '') return folderMode ? { kind: 'done', paths: [dir] } : { kind: 'nothing' };
  if (hasWildcard(raw))
    return { kind: 'filter', filter: { label: raw, patterns: raw.split(';').map((p) => p.trim()) } };
  const lexical = resolveLexically(dir, raw);
  if (lexical === null || !locationOf(vfs, lexical)) {
    return { kind: 'error', title: request.title, text: `${raw}\nThe file name is not valid.` };
  }
  // A typed folder is entered (the folder chooser takes it).
  const asFolder = await vfs.resolve(dir, raw);
  if (asFolder !== null && (await vfs.stat(asFolder).catch(() => null))?.kind === 'dir') {
    return folderMode ? { kind: 'done', paths: [asFolder] } : { kind: 'navigate', dir: asFolder };
  }
  if (folderMode && asFolder !== null) {
    return { kind: 'error', title: request.title, text: `${raw}\nThis is a file, not a folder.` };
  }
  const name = applyDefaultExtension(basename(lexical), request, filterIndex);
  const reason = invalidNameReason(name);
  if (reason) return { kind: 'error', title: request.title, text: `${name}\n${reason}` };
  const folder = dirname(lexical);
  const { mount, rel: folderRel } = splitVPath(folder);
  const folderFound = folder === dir ? dir : folderRel === '' ? folder : await vfs.resolve(`/${mount}`, folderRel);
  if (folderFound === null || (await vfs.stat(folderFound).catch(() => null))?.kind !== 'dir') {
    return {
      kind: 'error',
      title: request.title,
      text: `${raw}\nThe folder does not exist. Check the name and try again.`,
    };
  }
  const existing = await vfs.resolve(folderFound, name);
  const existingStat = existing !== null ? await vfs.stat(existing).catch(() => null) : null;
  if (existing !== null && existingStat?.kind === 'dir') {
    return folderMode ? { kind: 'done', paths: [existing] } : { kind: 'navigate', dir: existing };
  }
  if (existing !== null && existingStat?.kind === 'file') {
    const prompt =
      request.overwritePrompt === undefined
        ? { title: OVERWRITE_TITLE, text: OVERWRITE_TEXT }
        : request.overwritePrompt;
    if (prompt) {
      const answer = await dialogs.messageBox({
        title: prompt.title,
        text: prompt.text,
        icon: 'none',
        buttons: ['Yes', 'No'],
      });
      if (answer !== 'Yes') return { kind: 'abandon' };
    }
    return { kind: 'done', paths: [existing] };
  }
  return { kind: 'done', paths: [`${folderFound}/${name}`] };
}

/** The entries a dialog lists for a folder under a filter: folders always, files that match. */
export function visibleEntries<T extends { name: string; kind: 'file' | 'dir' }>(
  entries: readonly T[],
  filter: FileFilter | undefined,
): T[] {
  return entries.filter((entry) => entry.kind === 'dir' || matchesFilter(entry.name, filter));
}
