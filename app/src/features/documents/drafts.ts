// Local drafts (ARCHITECTURE.md 3.9.4, 3.8.6 rule 4).
//
// Two seconds after the last change, and when the page is hidden, the text and DocumentState of
// every modified document are written to the IndexedDB store `drafts`, under the id of the window
// that holds the document. A draft is removed as soon as its document is no longer modified (saved,
// reloaded, undone to the saved text) or no longer open (closed with Yes or No). At start a window
// looks for drafts of windows that no longer exist (their Web Lock `easy68k.window.<id>` is free)
// and offers them: `Unsaved changes from your last session were found for <names>.` with `Restore`
// and `Discard`. Drafts of windows that are still open are left alone, and drafts never touch a
// document's real file.
//
// The offer runs inside the Web Lock `easy68k.drafts.offer`, so two windows that start at the same
// moment after a crash do not both offer the same drafts: the second one looks only after the first
// has restored or discarded them.
//
// Owner: E1.

import type { AppContext, DocumentState } from '../../contracts';
import type { DocumentManager } from '../../core/documents/service';
import { DRAFTS_TITLE, draftsText } from '../../core/documents/messages';
import { liveWindowIds, type LockManagerLike } from '../../state/window-lock';

/** One draft: a modified document of one window. */
export interface DraftRecord {
  /** `<windowId>/<docId>`. */
  key: string;
  windowId: string;
  docId: string;
  /** Position of the document among the window's tabs, for restoring them in order. */
  order: number;
  state: DocumentState;
  text: string;
  /** The file's modification time recorded at load or the last save (3.9.3), carried over. */
  mtime: number | null;
}

export interface DraftStore {
  put(records: readonly DraftRecord[]): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  all(): Promise<DraftRecord[]>;
}

/** IndexedDB database and object store of the drafts. */
export const DRAFTS_DATABASE = 'easy68k.drafts';
export const DRAFTS_STORE = 'drafts';
/** The Web Lock held while drafts are offered. */
export const DRAFTS_OFFER_LOCK = 'easy68k.drafts.offer';
/** Delay after the last change (3.9.4). */
export const DRAFT_DELAY_MS = 2000;
/** The dialog that offers drafts; resolves to 'Restore' or 'Discard'. */
export const DRAFTS_DIALOG_ID = 'documents.drafts';

export interface DraftsDialogProps {
  title: string;
  text: string;
}
export type DraftsDialogResult = 'Restore' | 'Discard';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The drafts in IndexedDB (`easy68k.drafts`, store `drafts`, key path `key`). */
export function createIndexedDbDraftStore(factory: IDBFactory): DraftStore {
  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const open = factory.open(DRAFTS_DATABASE, 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains(DRAFTS_STORE)) {
          open.result.createObjectStore(DRAFTS_STORE, { keyPath: 'key' });
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('IndexedDB open failed'));
    });
    return opened;
  };
  return {
    async put(records) {
      if (records.length === 0) return;
      const tx = (await db()).transaction(DRAFTS_STORE, 'readwrite');
      const store = tx.objectStore(DRAFTS_STORE);
      for (const record of records) store.put(record);
      await done(tx);
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const tx = (await db()).transaction(DRAFTS_STORE, 'readwrite');
      const store = tx.objectStore(DRAFTS_STORE);
      for (const key of keys) store.delete(key);
      await done(tx);
    },
    async all() {
      const tx = (await db()).transaction(DRAFTS_STORE, 'readonly');
      return (await request(tx.objectStore(DRAFTS_STORE).getAll())) as DraftRecord[];
    },
  };
}

/** Drafts in memory: shared by the windows of one test. */
export function createMemoryDraftStore(): DraftStore & { readonly records: Map<string, DraftRecord> } {
  const records = new Map<string, DraftRecord>();
  return {
    records,
    put: async (list) => {
      for (const record of list) records.set(record.key, structuredClone(record));
    },
    remove: async (keys) => {
      for (const key of keys) records.delete(key);
    },
    all: async () => [...records.values()].map((record) => structuredClone(record)),
  };
}

export interface DraftKeeperDeps {
  ctx: Pick<AppContext, 'store' | 'scheduler' | 'dialogs' | 'platform'>;
  documents: DocumentManager;
  drafts: DraftStore;
  /** navigator.locks; null where the browser has none (then nothing is offered). */
  locks: LockManagerLike | null;
  /** Calls the listener when the page is hidden. */
  onHidden?: (listener: () => void) => () => void;
  /** Told about a storage error (default: ignored; drafts are a convenience). */
  onError?: (error: unknown) => void;
}

export interface DraftKeeper {
  /** Writes the drafts now (also what the 2 s timer and a hidden page do). */
  flush(): Promise<void>;
  /** Settles when the start-up offer is done (nothing found, restored, or discarded). */
  readonly offered: Promise<void>;
  dispose(): void;
}

export function startDraftKeeper(deps: DraftKeeperDeps): DraftKeeper {
  const { ctx, documents, drafts } = deps;
  const windowId = ctx.platform.windowId;
  const onError = deps.onError ?? (() => {});
  const keyOf = (docId: string) => `${windowId}/${docId}`;
  /** Revision of each document as last written. */
  const written = new Map<string, number>();
  let chain: Promise<void> = Promise.resolve();
  let cancelTimer: (() => void) | null = null;
  let disposed = false;

  /** Runs storage work one piece at a time, in order. */
  const enqueue = (work: () => Promise<void>) => {
    chain = chain.then(work).catch(onError);
    return chain;
  };

  const modifiedDocs = () => documents.list().filter((doc) => doc.modified);

  const flush = () =>
    enqueue(async () => {
      cancelTimer?.();
      cancelTimer = null;
      const list = documents.list();
      const records: DraftRecord[] = [];
      list.forEach((state, order) => {
        if (!state.modified || written.get(state.id) === state.revision) return;
        records.push({
          key: keyOf(state.id),
          windowId,
          docId: state.id,
          order,
          state,
          text: documents.text(state.id),
          mtime: documents.fileTime(state.id),
        });
      });
      await drafts.put(records);
      for (const record of records) written.set(record.docId, record.state.revision);
    });

  /** Removes at once the drafts of documents that are no longer modified or no longer open. */
  const removeStale = () => {
    const modified = new Set(modifiedDocs().map((doc) => doc.id));
    const stale = [...written.keys()].filter((id) => !modified.has(id));
    if (stale.length === 0) return;
    for (const id of stale) written.delete(id);
    void enqueue(() => drafts.remove(stale.map(keyOf)));
  };

  const schedule = () => {
    cancelTimer?.();
    cancelTimer = ctx.scheduler.setTimer(DRAFT_DELAY_MS, () => {
      cancelTimer = null;
      void flush();
    });
  };

  let lastSeen = new Map<string, number>();
  const onStore = () => {
    if (disposed) return;
    removeStale();
    const now = new Map(modifiedDocs().map((doc) => [doc.id, doc.revision]));
    const changed = [...now].some(([id, revision]) => lastSeen.get(id) !== revision && written.get(id) !== revision);
    lastSeen = now;
    if (changed) schedule();
  };
  const unsubscribe = ctx.store.subscribe(onStore);
  const stopHidden = deps.onHidden?.(() => void flush()) ?? (() => {});

  const offer = async () => {
    const live = await liveWindowIds(deps.locks);
    if (live === null) return; // cannot tell which windows are gone: offer nothing
    const orphans = (await drafts.all())
      .filter((record) => record.windowId !== windowId && !live.has(record.windowId))
      .sort((a, b) => (a.windowId === b.windowId ? a.order - b.order : a.windowId < b.windowId ? -1 : 1));
    if (orphans.length === 0 || disposed) return;
    const names = [...new Set(orphans.map((record) => record.state.name))];
    const answer = await ctx.dialogs.open<DraftsDialogProps, DraftsDialogResult>(DRAFTS_DIALOG_ID, {
      title: DRAFTS_TITLE,
      text: draftsText(names),
    });
    if (answer === 'Restore' && !disposed) {
      for (const record of orphans) documents.restore({ state: record.state, text: record.text, mtime: record.mtime });
    }
    await drafts.remove(orphans.map((record) => record.key));
    // The restored documents are drafts of this window from now on.
    if (answer === 'Restore') await flush();
  };

  const offered = (async () => {
    if (!deps.locks) return;
    try {
      await deps.locks.request(DRAFTS_OFFER_LOCK, offer);
    } catch (error) {
      onError(error);
    }
  })();

  onStore();
  return {
    flush,
    offered,
    dispose() {
      disposed = true;
      unsubscribe();
      stopHidden();
      cancelTimer?.();
    },
  };
}
