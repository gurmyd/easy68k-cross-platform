// Feature "easybin": EASyBIN mode (region id `easybin`), work package B1 (docs/porting/easybin.md).
//
//   commands   `sim.view.easybin` and every `bin.*` (commands.ts)
//   panels     the workspace (region `easybin`); the original has no status bar (easybin.md 1.2)
//   dialogs    `easybin.about`
//   init       the window title follows the original's caption (setModeTitle, state/shell.ts), and
//              files dropped on the window while EASyBIN mode is shown (docs/porting/easybin.md 1.4)
//
// The state of the mode (the 16 MB memory image, the fields) is one EasybinModel per window
// (session.ts); it lives as long as the window and survives mode switches.
//
// Owner: W3 > B1.

import type { AppContext, FeatureModule } from '../../contracts';
import { EasybinAboutDialog } from './AboutDialog';
import { ABOUT_DIALOG_ID, commands, followCaption, openDropped } from './commands';
import { EasybinWorkspace } from './EasybinWorkspace';

/** True when a drag carries files (not text). */
function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer !== null && Array.from(transfer.types).includes('Files');
}

/**
 * Drops while EASyBIN mode is shown. The Files feature (FS1) listens on the window in the capture
 * phase too and does nothing in this mode; this listener, on the same target, still runs.
 */
function listenForDrops(ctx: AppContext): () => void {
  if (typeof window === 'undefined') return () => {};
  const active = () => ctx.store.getState().mode === 'easybin' && !ctx.dialogs.isModalOpen();
  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer) || ctx.store.getState().mode !== 'easybin') return;
    event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    if (!carriesFiles(event.dataTransfer) || ctx.store.getState().mode !== 'easybin') return;
    event.preventDefault();
    if (!active()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    void (async () => {
      const read: { name: string; data: Uint8Array }[] = [];
      for (const file of files) {
        try {
          read.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
        } catch {
          // a folder or an unreadable file: skipped, as the original skips names that do not exist
        }
      }
      await openDropped(ctx, read);
    })().catch((error: unknown) => console.error('Dropping files on EASyBIN failed:', error));
  };
  window.addEventListener('dragover', onDragOver, true);
  window.addEventListener('drop', onDrop, true);
  return () => {
    window.removeEventListener('dragover', onDragOver, true);
    window.removeEventListener('drop', onDrop, true);
  };
}

export const feature: FeatureModule = {
  id: 'easybin',
  commands,
  panels: [{ id: 'easybin', title: 'EASyBIN', mode: 'easybin', component: EasybinWorkspace }],
  dialogs: { [ABOUT_DIALOG_ID]: EasybinAboutDialog },
  init: (ctx) => {
    const stopTitle = followCaption(ctx);
    const stopDrops = listenForDrops(ctx);
    return () => {
      stopDrops();
      stopTitle();
    };
  },
};
