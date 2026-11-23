// The reload offer of ARCHITECTURE-PLUS P3.3.10 (package N8), as plain logic that runs under Node.
//
//     const offer = startReloadOffer({ documents, vfs, dialogs, onFocus, settle });
//     offer.stop();
//
// An open document that has a file and is NOT modified, whose file's modification time now differs
// from the one the document recorded (DocumentService.fileTime: at open, at the last save or
// reload), is offered a reload: the toast `"prog.X68" was changed outside this window.` with the
// action `Reload`, which calls DocumentService.reload. It looks:
//   - when the window regains the focus (`onFocus`): another window, Git or another program may
//     have changed any file, in any store (an opened folder reports no changes of its own);
//   - when the Vfs reports an EXTERNAL change (origin 'external': another window of this browser
//     or of the desktop app) of a document's file or of a folder above it.
// Changes this window makes itself (origin 'local') are not looked at: Save records the new time
// itself, and Restore and Undo reload their documents (P3.3.8).
//
// What it never does:
//   - anything for a modified document: its Save asks the question of main 3.8.6 rule 3. A document
//     that becomes modified between the toast and the click is left alone too;
//   - anything without `Reload` being chosen: it only shows a toast;
//   - offer the same change twice: a toast dismissed for a file's time is not shown again for that
//     time (a later change of the file is offered again);
//   - anything when the document service has no `fileTime` (a stub service in tests).
//
// A Save in this window writes the file before it records the new time. So that a focus that falls
// between the two is not taken for a change from outside, a difference is looked at twice, `settle`
// apart, and offered only when the recorded time has not caught up meanwhile.
//
// Owner: N8.

import type { DialogService, DocumentService, DocumentState, Vfs, VfsChange, VPath } from '../../contracts';
import { foldCase } from '../../core/paths/winpath';
import { RELOAD_ACTION, changedOutsideText } from './texts';

export interface ReloadOfferDeps {
  documents: Pick<DocumentService, 'list' | 'reload' | 'fileTime'>;
  vfs: Pick<Vfs, 'stat' | 'subscribe'>;
  dialogs: Pick<DialogService, 'toast'>;
  /** Calls the listener each time the window regains the focus; returns the unsubscriber. */
  onFocus(listener: () => void): () => void;
  /** Resolves a short moment later (the second look; see the header). */
  settle(): Promise<void>;
}

/** The documents the offer looks at: with a file and not modified. */
function candidates(documents: ReloadOfferDeps['documents']): (DocumentState & { path: VPath })[] {
  return documents
    .list()
    .filter((doc): doc is DocumentState & { path: VPath } => doc.hasName && doc.path !== null && !doc.modified);
}

/** True when `path` is `changed` or lies below it, without regard to letter case. */
function touches(path: VPath, changed: VPath): boolean {
  const a = foldCase(path);
  const b = foldCase(changed);
  return a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`);
}

export interface ReloadOffer {
  /** Stops listening; a toast already shown stays. */
  stop(): void;
  /** Resolves when the looks requested so far are over (tests). */
  idle(): Promise<void>;
}

/** Starts the offer. */
export function startReloadOffer(deps: ReloadOfferDeps): ReloadOffer {
  const { documents, vfs, dialogs } = deps;
  const fileTime = documents.fileTime?.bind(documents);
  if (typeof fileTime !== 'function') return { stop() {}, idle: () => Promise.resolve() };

  /** Per document id: the file time a toast was shown for. */
  const offered = new Map<string, number>();
  let stopped = false;
  /** One look at a time; a request during a look runs one more look after it. */
  let running: Promise<void> | null = null;
  let again: ((doc: DocumentState) => boolean) | null = null;

  const current = (id: string) => documents.list().find((doc) => doc.id === id) ?? null;

  /** The file's time when it differs from the recorded one, else null. */
  async function changedTime(doc: DocumentState & { path: VPath }): Promise<number | null> {
    const recorded = fileTime?.(doc.id) ?? null;
    if (recorded === null) return null; // not known: nothing to compare with
    const stat = await vfs.stat(doc.path).catch(() => null);
    if (!stat || stat.kind !== 'file') return null; // gone or unreachable: Save and Reload say so
    return stat.mtime === recorded ? null : stat.mtime;
  }

  function offer(doc: DocumentState, time: number): void {
    offered.set(doc.id, time);
    dialogs.toast(changedOutsideText(doc.name), {
      label: RELOAD_ACTION,
      run() {
        const now = current(doc.id);
        // Only on Reload, and never for a document that is modified now.
        if (!now || now.modified || !now.hasName) return;
        void documents.reload(doc.id).catch(() => {});
      },
    });
  }

  async function look(which: (doc: DocumentState) => boolean): Promise<void> {
    const ids = new Set(documents.list().map((doc) => doc.id));
    for (const id of [...offered.keys()]) if (!ids.has(id)) offered.delete(id);
    const first: { doc: DocumentState & { path: VPath }; time: number }[] = [];
    for (const doc of candidates(documents).filter(which)) {
      const time = await changedTime(doc);
      if (time !== null && offered.get(doc.id) !== time) first.push({ doc, time });
    }
    if (first.length === 0 || stopped) return;
    await deps.settle();
    for (const { doc, time } of first) {
      if (stopped) return;
      const now = current(doc.id);
      if (!now || now.modified || now.path !== doc.path) continue;
      const second = await changedTime(now as DocumentState & { path: VPath });
      if (second === time && offered.get(doc.id) !== time) offer(now, time);
    }
  }

  function request(which: (doc: DocumentState) => boolean): void {
    if (stopped) return;
    if (running) {
      const before = again;
      again = before ? (doc) => before(doc) || which(doc) : which;
      return;
    }
    running = (async () => {
      let next: ((doc: DocumentState) => boolean) | null = which;
      while (next && !stopped) {
        await look(next).catch(() => {});
        next = again;
        again = null;
      }
      running = null;
    })();
  }

  const all = () => true;
  const stopFocus = deps.onFocus(() => request(all));
  const stopChanges = vfs.subscribe('/', (change: VfsChange) => {
    if (change.origin !== 'external') return;
    if (!candidates(documents).some((doc) => touches(doc.path, change.path))) return;
    request((doc) => doc.path !== null && touches(doc.path, change.path));
  });

  return {
    stop() {
      stopped = true;
      stopFocus();
      stopChanges();
    },
    async idle() {
      while (running) await running;
    },
  };
}
