// Feature "files" (work package FS1): the file dialogs, the Files panel, files dropped on the
// window, and the browser store's messages (ARCHITECTURE.md 2.2, 3.8.1, 3.8.5, 3.8.6).
//
//   createFileDialogs(ctx)   the FileDialogs service of the context (dialogs.ts); in a browser it
//                            comes with the provider "From this computer..."
//   feature.commands         app.files.toggle - shows or hides the Files panel
//   feature.panels           the Files panel of Editor mode (FilesPanel.tsx)
//   feature.dialogs          file.open, file.save (FileDialog.tsx), files.name (NameDialog.tsx)
//   feature.init             drops on the window (drop.ts), and the store's problems as messages
//
// Owner: W3 > FS1.

import type { AppContext, FeatureModule, FileDialogs, FileSourceProvider, VPath } from '../../contracts';
import { BrowserBackend, storageProblem } from '../../fs/browser-backend';
import { panelVisible, togglePanel } from '../../state/panels';
import { NAME_DIALOG_ID } from './actions';
import { carriesFiles, droppedItems, hasDom, pickFiles, readFileBytes } from './browser-io';
import { createFileDialogService, OPEN_DIALOG_ID, SAVE_DIALOG_ID, type FileDialogService } from './dialogs';
import { handleDrop, type DropDeps } from './drop';
import { FileDialog } from './FileDialog';
import { FilesPanel } from './FilesPanel';
import { NameDialog } from './NameDialog';
import { UPLOAD_PROVIDER_ID, canTakeDroppedFolder } from './providers';
import { IMPORTED_DIR, displayPath, importOne } from './store';

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
  return {
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
  };
}

/**
 * The file dialogs of the application (3.8.5). Called once by the bootstrap, after `dialogs` and
 * `vfs` exist.
 */
export function createFileDialogs(ctx: AppContext): FileDialogs {
  const service = createFileDialogService(ctx);
  if (hasDom()) service.registerProvider(createUploadProvider(ctx));
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
    openProgram: (path) => ctx.sim.controller.open(path, 'drop'),
    folderProviders: () => (service ? service.registry.available().filter(canTakeDroppedFolder) : []),
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
  if (browser instanceof BrowserBackend) {
    return browser.onProblem((store) => ctx.dialogs.toast(store.message));
  }
  return () => {};
}

export const feature: FeatureModule = {
  id: 'files',
  commands: {
    'app.files.toggle': {
      run: (ctx) => togglePanel(ctx, 'files'),
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
    return () => {
      stopDrops();
      stopProblems();
    };
  },
};
