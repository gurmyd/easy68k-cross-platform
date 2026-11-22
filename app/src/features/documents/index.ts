// Feature "documents" (ARCHITECTURE.md 3.9, 9.2 E1): the document service, the commands New, Open,
// Save, Save As, Close, Exit, Reload and the Window list, the close prompts, local drafts, the
// start-up document and the unload guard.
//
// Exported names are contract (section 8, "Stubs"): app/src/features/index.ts imports `feature` and
// `createDocumentService` by name.
//
// Start-up (editor-ui §1.1; 5.7): a start-up file (desktop argv, web `?open=<VPath>`) that exists
// and is not an `.S68` is opened; otherwise one new document is created from the template. An
// `.S68` belongs to the simulator (its feature loads it); the editor still gets its new document.
// Files handed over later (file association, Dock icon: Platform.onOpenFiles) are opened the same
// way, in Editor mode.
//
// A start-up file that the viewer takes (ARCHITECTURE-PLUS P3.4.2: a PDF, a picture) makes open()
// return null; the viewer's tab is queued by the dock controller and shown once the Editor dock
// attaches, and the Editor then holds the template document, as for any file that does not open.
//
// Unload guard (1.3.3): while any document is modified the browser's "leave site?" prompt is on;
// the feature asks for it as the party 'documents' (Platform.confirmBeforeUnload(needed, who)).
//
// Owner: W3 > E1.

import type { AppContext, DocumentService, FeatureModule, VPath } from '../../contracts';
import { upperExt } from '../../core/documents/format';
import { DocumentManager } from '../../core/documents/service';
import { isVPath } from '../../core/paths/winpath';
import type { LockManagerLike } from '../../state/window-lock';
import { documentCommands } from './commands';
import { DraftsDialog } from './DraftsDialog';
import { createIndexedDbDraftStore, DRAFTS_DIALOG_ID, startDraftKeeper, type DraftStore } from './drafts';

/**
 * The document service of the application (3.9). Called once by the bootstrap, after `dialogs`,
 * `vfs` and `fileDialogs` exist.
 */
export function createDocumentService(ctx: AppContext): DocumentService {
  return new DocumentManager({
    store: ctx.store,
    settings: ctx.settings,
    dialogs: ctx.dialogs,
    vfs: ctx.vfs,
    fileDialogs: ctx.fileDialogs,
    // ARCHITECTURE-PLUS P3.4, P4.4 (N6): the bootstrap creates the viewer before the documents;
    // without one (tests) every file opens as text.
    ...(ctx.viewer ? { viewer: ctx.viewer } : {}),
    clock: ctx.clock,
  });
}

/** The name under which this feature asks for the platform's "leave?" question. */
const UNLOAD_PARTY = 'documents';

/** What the feature takes from the browser; tests pass their own. */
export interface DocumentsFeatureOptions {
  /** Where drafts are kept; null = no drafts. Default: IndexedDB where it exists. */
  draftStore?: () => DraftStore | null;
  /** navigator.locks; null = cannot tell which windows are alive (no drafts are offered). */
  locks?: () => LockManagerLike | null;
  /** Calls the listener when the page is hidden. Default: `visibilitychange` and `pagehide`. */
  onHidden?: (listener: () => void) => () => void;
}

function browserDraftStore(): DraftStore | null {
  return typeof indexedDB === 'undefined' ? null : createIndexedDbDraftStore(indexedDB);
}

function browserLocks(): LockManagerLike | null {
  return typeof navigator === 'undefined' ? null : ((navigator as Navigator).locks ?? null);
}

function browserOnHidden(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') listener();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', listener);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', listener);
  };
}

/** True for a file the editor opens at start or from the system (not an S-record). */
function isEditorFile(file: string | null): file is VPath {
  return file !== null && isVPath(file) && upperExt(file) !== '.S68';
}

/** editor-ui §1.1 step 2: open the start-up file if it exists, else one new document. */
async function startupDocument(ctx: AppContext): Promise<void> {
  const file = ctx.platform.startupArgs().file;
  if (isEditorFile(file)) {
    const stat = await ctx.vfs.stat(file).catch(() => null);
    if (stat?.kind === 'file' && (await ctx.documents.open(file))) return;
  }
  ctx.documents.newSource();
}

export function createDocumentsFeature(options: DocumentsFeatureOptions = {}): FeatureModule {
  const draftStore = options.draftStore ?? browserDraftStore;
  const locks = options.locks ?? browserLocks;
  const onHidden = options.onHidden ?? browserOnHidden;
  return {
    id: 'documents',
    commands: documentCommands,
    dialogs: { [DRAFTS_DIALOG_ID]: DraftsDialog },
    init(ctx) {
      const disposers: (() => void)[] = [];

      // The start-up document. Without a start-up file it exists before init returns.
      if (isEditorFile(ctx.platform.startupArgs().file)) void startupDocument(ctx);
      else ctx.documents.newSource();

      // Unload guard, asked under this feature's own name so that the simulator's guard (party
      // 'simulator') and this one cannot switch each other off (W1 errata 11).
      let guarding: boolean | null = null;
      const guard = () => {
        const needed = ctx.store.getState().documents.items.some((doc) => doc.modified);
        if (needed === guarding) return;
        guarding = needed;
        ctx.platform.confirmBeforeUnload(needed, UNLOAD_PARTY);
      };
      disposers.push(ctx.store.subscribe(guard));
      guard();
      disposers.push(() => {
        if (guarding) ctx.platform.confirmBeforeUnload(false, UNLOAD_PARTY);
      });

      // Files from the system (file association, Dock icon).
      disposers.push(
        ctx.platform.onOpenFiles((files) => {
          const editorFiles = files.filter(isEditorFile);
          if (editorFiles.length === 0) return;
          void (async () => {
            if (ctx.store.getState().mode !== 'editor') await ctx.commands.run('app.mode.set', 'editor');
            for (const file of editorFiles) await ctx.documents.open(file);
          })();
        }),
      );

      // Drafts, for the real document service only (tests of other packages use a stub).
      const store = draftStore();
      if (store && ctx.documents instanceof DocumentManager) {
        const keeper = startDraftKeeper({
          ctx,
          documents: ctx.documents,
          drafts: store,
          locks: locks(),
          onHidden,
        });
        disposers.push(() => keeper.dispose());
      }

      return () => {
        for (const dispose of disposers.reverse()) dispose();
      };
    },
  };
}

export const feature: FeatureModule = createDocumentsFeature();
