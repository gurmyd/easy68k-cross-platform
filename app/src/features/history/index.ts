// The History and Trash dialogs and the recording of versions (ARCHITECTURE-PLUS P3.3.3, P3.3.4,
// P3.3.8): ed.file.history, app.files.trash. Owner: N0 > N4.
//
//   init       records automatic versions from DocumentService.onWritten (recording.ts; never from
//              the Vfs) and shows the storage-tight toast once per window (tight-notice.ts).
//   commands   ed.file.history (`Earlier Versions...`, argument `{ path?: VPath }`, default the
//              active document's path; enabled while ctx.history exists and that path is a file
//              outside /memory) opens `history.versions`; app.files.trash (`Trash...`, enabled
//              while ctx.history exists; in state `unavailable` the dialog shows P3.3.7's text)
//              opens `history.trash`.
//   dialogs    history.versions (VersionsDialog.tsx), history.trash (TrashDialog.tsx), both modal.
//
// When a dialog closes and the element that opened it no longer exists (a deleted row), the focus
// goes to the Files tree's focused row, else to the Editor panel (P3.3.8).

import type { AppContext, FeatureModule, VPath } from '../../contracts';
import { isVPath, mountOf } from '../../core/paths/winpath';
import { focusPanel, panelVisible } from '../../state/panels';
import { startRecording } from './recording';
import { TRASH_DIALOG_ID, VERSIONS_DIALOG_ID } from './texts';
import { browserEstimate, startTightNotice } from './tight-notice';
import { TrashDialog } from './TrashDialog';
import { VersionsDialog, type VersionsDialogProps } from './VersionsDialog';

/** True for a path that can have earlier versions shown: a VPath outside /memory (P3.6). */
export function versionsPathOk(path: unknown): path is VPath {
  if (typeof path !== 'string' || !isVPath(path)) return false;
  const mount = mountOf(path);
  return mount !== 'memory' && path !== `/${mount}`;
}

/** The path `ed.file.history` acts on: the argument's, else the active document's. */
export function versionsPathOf(ctx: Pick<AppContext, 'documents'>, arg?: unknown): VPath | null {
  const given = typeof arg === 'object' && arg !== null ? (arg as { path?: unknown }).path : undefined;
  const path = given ?? ctx.documents.active()?.path ?? null;
  return versionsPathOk(path) ? path : null;
}

/** P3.3.8: the focus after a dialog closes, when the element that opened it is gone. */
function focusAfterClose(ctx: AppContext): void {
  if (typeof document === 'undefined' || typeof setTimeout === 'undefined') return;
  setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focusPanel(ctx, panelVisible(ctx, 'files') ? 'files' : 'editor');
  }, 0);
}

export const feature: FeatureModule = {
  id: 'history',
  commands: {
    'ed.file.history': {
      enabled: (_state, ctx) => ctx.history !== undefined && versionsPathOf(ctx) !== null,
      async run(ctx, arg) {
        const path = versionsPathOf(ctx, arg);
        if (!ctx.history || path === null) return;
        await ctx.dialogs.open<VersionsDialogProps, void>(VERSIONS_DIALOG_ID, { path });
        focusAfterClose(ctx);
      },
    },
    'app.files.trash': {
      enabled: (_state, ctx) => ctx.history !== undefined,
      async run(ctx) {
        if (!ctx.history) return;
        await ctx.dialogs.open<undefined, void>(TRASH_DIALOG_ID, undefined);
        focusAfterClose(ctx);
      },
    },
  },
  dialogs: {
    [VERSIONS_DIALOG_ID]: VersionsDialog,
    [TRASH_DIALOG_ID]: TrashDialog,
  },
  init(ctx) {
    const stopRecording = startRecording(ctx);
    const stopNotice = startTightNotice(ctx, browserEstimate());
    return () => {
      stopRecording();
      stopNotice();
    };
  },
};
