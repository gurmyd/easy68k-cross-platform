// Feature "files" (work package FS1): the file dialogs, the Files panel, files dropped on the
// window, and the browser store's messages (ARCHITECTURE.md 2.2, 3.8.1, 3.8.5, 3.8.6).
//
//   createFileDialogs(ctx)   the FileDialogs service of the context (dialogs.ts); in a browser it
//                            comes with the provider "From this computer..."
//   feature.commands         app.files.toggle - shows or hides the Files panel; with { reveal }
//                            (FilesRevealArg) shows it and reveals that path (reveal.ts)
//   feature.panels           the Files panel of Editor mode (FilesPanel.tsx)
//   feature.dialogs          file.open, file.save (FileDialog.tsx), files.name (NameDialog.tsx)
//   feature.init             drops on the window (drop.ts), the store's problems as messages, and the
//                            storage notice at the first write when the panel is not on the screen
//
// Owner: W3 > FS1.

import type { AppContext, FeatureModule, FileDialogs, FileSourceProvider, FolderRequest, VPath } from '../../contracts';
import { onStoreProblem, storageProblem } from '../../fs/browser-backend';
import { panelVisible, showPanel, togglePanel } from '../../state/panels';
import { NAME_DIALOG_ID } from './actions';
import { carriesFiles, droppedItems, hasDom, pickFiles, readFileBytes } from './browser-io';
import { createFileDialogService, OPEN_DIALOG_ID, SAVE_DIALOG_ID, type FileDialogService } from './dialogs';
import { handleDrop, type DropDeps } from './drop';
import { FileDialog } from './FileDialog';
import { FilesPanel } from './FilesPanel';
import { NameDialog } from './NameDialog';
import { EDITOR_OPEN_FILTERS, normalizeDefaultExt } from './filters';
import { NATIVE_PROVIDER_ID, UPLOAD_PROVIDER_ID, canTakeDroppedFolder, markImportingUpload } from './providers';
import { forgetPendingReveal, requestReveal, revealPathOf } from './reveal';
import { watchFirstWrite } from './storage-notice';
import { IMPORTED_DIR, displayPath, importOne } from './store';

/**
 * The desktop app's native dialogs as the provider 'native', which replaces the port's dialogs
 * (3.8.5; providers.ts). null where the platform has none (the web).
 */
export function createNativeProvider(ctx: AppContext): FileSourceProvider | null {
  const native = ctx.platform.nativeFileDialogs;
  if (!native) return null;
  return {
    id: NATIVE_PROVIDER_ID,
    label: 'Native dialogs',
    available: () => true,
    open: (request) => native.open(request),
    // The openers may pass the original's malformed '*.X68' (contracts/fs.ts SaveRequest.defaultExt);
    // the native dialog is given the plain extension, '.X68' (errata/FS1.md entry 9).
    save: (request) => native.save({ ...request, defaultExt: normalizeDefaultExt(request.defaultExt) }),
    // FolderRequest.startDir reaches the native dialog (contracts/platform.ts, second argument).
    chooseFolder: (request: FolderRequest) =>
      request.startDir ? native.chooseFolder(request.title, request.startDir) : native.chooseFolder(request.title),
  };
}

/** The title of the Open dialog a folder dropped on the desktop app shows (the editor's Open title). */
export const DROPPED_FOLDER_TITLE = 'Open File';

/** The service each window's context received, for init (one per context). */
const services = new WeakMap<AppContext, FileDialogService>();

/** Asks before an imported copy with other contents replaces the one in the store. */
function askReplace(ctx: AppContext, title: string) {
  return async (path: VPath): Promise<boolean> => {
    const answer = await ctx.dialogs.messageBox({
      title,
      text: `"${displayPath(ctx.vfs, path)}" already exists with other contents. Replace it with the new file?`,
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    return answer === 'Yes';
  };
}

/** "From this computer...": <input type="file">, the chosen files copied into /browser/Imported (3.8.1). */
export function createUploadProvider(ctx: AppContext): FileSourceProvider {
  return markImportingUpload({
    id: UPLOAD_PROVIDER_ID,
    label: 'From this computer...',
    available: () => hasDom() && ctx.vfs.backends().some((backend) => backend.mount === 'browser'),
    open(request) {
      const picking = pickFiles({ multiple: request.multiple });
      return picking.then(async (files) => {
        if (!files) return null;
        const paths: VPath[] = [];
        for (const file of request.multiple ? files : files.slice(0, 1)) {
          const data = await readFileBytes(file);
          paths.push(await importOne(ctx.vfs, IMPORTED_DIR, file.name, data, askReplace(ctx, request.title)));
        }
        return paths.length > 0 ? paths : null;
      });
    },
  });
}

/**
 * The file dialogs of the application (3.8.5). Called once by the bootstrap, after `dialogs` and
 * `vfs` exist.
 */
export function createFileDialogs(ctx: AppContext): FileDialogs {
  const service = createFileDialogService(ctx);
  const native = createNativeProvider(ctx);
  if (native) service.registerProvider(native);
  else if (hasDom()) service.registerProvider(createUploadProvider(ctx));
  services.set(ctx, service);
  return service;
}

/** The parts of a drop that come from the application (the rest is in drop.ts). */
export function dropDeps(ctx: AppContext): DropDeps {
  const service = services.get(ctx);
  return {
    mode: ctx.store.getState().mode,
    programLoaded: ctx.sim.controller.program !== null,
    messageBox: (request) => ctx.dialogs.messageBox(request),
    toast: (text) => ctx.dialogs.toast(text),
    importFile: (name, data) => importOne(ctx.vfs, IMPORTED_DIR, name, data, askReplace(ctx, 'Drop')),
    openDocument: (path) => ctx.documents.open(path),
    openProgram: (path, confirmed) =>
      confirmed ? ctx.sim.controller.open(path, 'drop', { confirmed: true }) : ctx.sim.controller.open(path, 'drop'),
    ...confirmLoadDep(ctx),
    folderProviders: () => (service ? service.registry.available().filter(canTakeDroppedFolder) : []),
    ...desktopDropDeps(ctx),
  };
}

/**
 * RunController.confirmLoad (contracts/run.ts, docs/requests/W1-load-confirm.md item 2): the drop
 * asks `Caution` before it copies a dropped .S68, as the original asks before it loads. Absent for
 * a controller without confirmLoad; the drop then keeps the older order (copy, then open asks).
 */
function confirmLoadDep(ctx: AppContext): Pick<DropDeps, 'confirmLoad'> {
  const controller = ctx.sim.controller;
  if (typeof controller.confirmLoad !== 'function') return {};
  return { confirmLoad: () => controller.confirmLoad?.('drop') ?? Promise.resolve(true) };
}

/** The desktop app: dropped files are opened where they are on the disk (DV2 errata 4a). */
function desktopDropDeps(ctx: AppContext): Pick<DropDeps, 'locate' | 'openFolder'> {
  const { platform } = ctx;
  if (!platform.grantDroppedFile) return {};
  return {
    locate: (item) =>
      item.file ? (platform.grantDroppedFile?.(item.file as File) ?? Promise.resolve(null)) : Promise.resolve(null),
    async openFolder(dir) {
      const chosen = await ctx.fileDialogs.open({
        title: DROPPED_FOLDER_TITLE,
        filters: [...EDITOR_OPEN_FILTERS],
        multiple: true,
        startDir: dir,
      });
      for (const path of chosen ?? []) await ctx.documents.open(path);
    },
  };
}

/** Listens for files dragged onto the window. Returns the function that stops listening. */
function listenForDrops(ctx: AppContext): () => void {
  if (!hasDom()) return () => {};
  // Capture phase on the window: a drop anywhere opens the files, also over the editor, which would
  // otherwise insert the file's text; and the browser never navigates away to a dropped file.
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = ctx.dialogs.isModalOpen() ? 'none' : 'copy';
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer) || !event.dataTransfer) return;
    event.preventDefault();
    event.stopPropagation();
    if (ctx.dialogs.isModalOpen()) return; // no command while a modal dialog is open (2.9.1)
    const items = droppedItems(event.dataTransfer);
    void handleDrop(items, dropDeps(ctx)).catch((error: unknown) => console.error('Dropping files failed:', error));
  };
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop, true);
  return () => {
    window.removeEventListener('dragover', onDragOver, true);
    window.removeEventListener('drop', onDrop, true);
  };
}

/** Tells the user when the browser store keeps nothing, or could not keep a file. */
function reportStoreProblems(ctx: AppContext): () => void {
  const browser = ctx.vfs.backends().find((backend) => backend.mount === 'browser');
  const problem = storageProblem(browser);
  if (problem) ctx.dialogs.toast(problem);
  return onStoreProblem(browser, (message) => ctx.dialogs.toast(message));
}

export const feature: FeatureModule = {
  id: 'files',
  commands: {
    'app.files.toggle': {
      // With FilesRevealArg { reveal } (contracts/commands.ts): show the panel, never hide it, and
      // reveal the path, also when the panel mounts only now. Without it: show or hide the panel.
      run: (ctx, arg) => {
        const reveal = revealPathOf(arg);
        if (reveal === null) {
          forgetPendingReveal(ctx); // the user's own toggle supersedes a reveal still waiting
          togglePanel(ctx, 'files');
          return;
        }
        showPanel(ctx, 'files');
        requestReveal(ctx, reveal, true);
      },
      checked: (_state, ctx) => panelVisible(ctx, 'files'),
    },
  },
  panels: [{ id: 'files', title: 'Files', mode: 'editor', component: FilesPanel }],
  dialogs: {
    [OPEN_DIALOG_ID]: FileDialog,
    [SAVE_DIALOG_ID]: FileDialog,
    [NAME_DIALOG_ID]: NameDialog,
  },
  init(ctx) {
    const stopDrops = listenForDrops(ctx);
    const stopProblems = reportStoreProblems(ctx);
    // The storage notice at the first write while the Files panel is not on the screen (R-10).
    const stopNotice = watchFirstWrite(ctx);
    return () => {
      stopDrops();
      stopProblems();
      stopNotice();
    };
  },
};
