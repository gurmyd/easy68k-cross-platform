// How the editor reaches the text of a document (ARCHITECTURE.md 3.9.1). Owner: E2.
//
// 3.9.1: "One EditorState per document lives in core/documents/registry.ts; the editor component
// (E2) reaches it with documentRegistryOf(ctx.documents) of core/documents and attaches a view to
// it. Every transaction of a view goes through the registry." The per-document Insert/Replace flag
// is set with the contract's `ctx.documents.update?.(id, { insertMode })` (3.9, DocumentPatch).
// (errata/W1.md 11.2 and 11.3; errata/E2.md entry 2.)
//
// The editor talks to documents through `DocumentLink`, which has two forms:
//
//   - `ctx.documents` is E1's DocumentManager: the link works on its registry. The registry stays
//     the one place where the text lives, so Save, Assemble and drafts read what the editor wrote.
//   - Any other document service (the wave-0 stub, test doubles that implement only the contract):
//     the link keeps the states itself, created from `text(id)`, and tracks Modified and
//     Insert/Replace locally. The editor works fully; only other services do not see the edits.
//
// The editor never assumes which of these it has.

import { EditorState, type Transaction } from '@codemirror/state';
import type { AppContext, DocumentState } from '../../contracts';
import { DocumentManager, documentRegistryOf, type DocumentRegistry } from '../../core/documents';

/** What the link needs from the registry of the document service (3.9.1), in one place. */
export interface DocumentEditorAccess {
  /** The document's current EditorState (3.9.1). */
  getState(id: string): EditorState;
  /** The editor applied `tr` to the document's state: the registry stores it (revision, Modified). */
  apply(id: string, tr: Transaction): void;
  /**
   * Called when the document's state was changed by something other than the editor's own
   * `apply` (Reload replaces it; another part reconfigures it). `tr` is the transaction when the
   * change was one, absent when the whole state was replaced.
   */
  subscribe(id: string, listener: (tr?: Transaction) => void): () => void;
  /** The per-document Insert/Replace flag (`DocumentState.insertMode`, editor-ui §8.6). */
  setInsertMode(id: string, insertMode: boolean): void;
}

/** The editor's view of documents. */
export interface DocumentLink {
  /** True when the edits reach the document service (the access object exists). */
  readonly shared: boolean;
  state(id: string): EditorState;
  /** Store the result of a transaction the editor made (an edit, or a reconfiguration). */
  commit(id: string, tr: Transaction): void;
  modified(id: string): boolean;
  insertMode(id: string): boolean;
  setInsertMode(id: string, insertMode: boolean): void;
  /** Fires after any change of a state, of Modified or of Insert/Replace (any document). */
  subscribe(listener: () => void): () => void;
  /** Fires when a document's state was changed from outside; the view must follow (see access). */
  onExternalChange(id: string, listener: (tr?: Transaction) => void): () => void;
  /** Forget a closed document. */
  release(id: string): void;
}

function documentOf(ctx: AppContext, id: string): DocumentState | undefined {
  return (
    ctx.store.getState().documents.items.find((item) => item.id === id) ?? ctx.documents.list().find((d) => d.id === id)
  );
}

/** The registry of the document service as the access object of the link. */
export function adaptRegistry(
  registry: Pick<DocumentRegistry, 'state' | 'apply' | 'subscribe'>,
  update: (id: string, patch: { insertMode: boolean }) => void,
): DocumentEditorAccess {
  let applying: Transaction | null = null;
  return {
    getState: (id) => registry.state(id),
    apply(id, tr) {
      applying = tr;
      try {
        registry.apply(id, tr);
      } finally {
        applying = null;
      }
    },
    subscribe: (id, listener) =>
      registry.subscribe((event) => {
        if (event.id !== id) return;
        if (event.kind === 'updated' && event.transaction !== applying) listener(event.transaction);
        else if (event.kind === 'replaced') listener();
      }),
    setInsertMode: (id, insertMode) => update(id, { insertMode }),
  };
}

/** The registry of the document service, when it is E1's DocumentManager (see the top of this file). */
export function editorAccessOf(ctx: AppContext): DocumentEditorAccess | null {
  const documents = ctx.documents;
  if (!(documents instanceof DocumentManager)) return null;
  return adaptRegistry(documentRegistryOf(documents), (id, patch) => ctx.documents.update?.(id, patch));
}

export function createDocumentLink(ctx: AppContext): DocumentLink {
  const access = editorAccessOf(ctx);
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  if (access) {
    // The store mirrors DocumentState; a change there (Modified, insertMode) is a change here.
    ctx.store.subscribe(notify);
    return {
      shared: true,
      state: (id) => access.getState(id),
      commit(id, tr) {
        access.apply(id, tr);
        notify();
      },
      modified: (id) => documentOf(ctx, id)?.modified ?? false,
      insertMode: (id) => documentOf(ctx, id)?.insertMode ?? true,
      setInsertMode(id, insertMode) {
        access.setInsertMode(id, insertMode);
        notify();
      },
      subscribe,
      onExternalChange: (id, listener) => access.subscribe(id, listener),
      release: () => {},
    };
  }

  // Local fallback: the link holds the states.
  interface Entry {
    state: EditorState;
    saved: EditorState['doc'];
    insertMode: boolean;
  }
  const entries = new Map<string, Entry>();
  const entry = (id: string): Entry => {
    let found = entries.get(id);
    if (!found) {
      let text = '';
      try {
        text = ctx.documents.text(id);
      } catch {
        // A document the service does not know (yet): an empty text.
      }
      const state = EditorState.create({ doc: text });
      found = { state, saved: state.doc, insertMode: documentOf(ctx, id)?.insertMode ?? true };
      entries.set(id, found);
    }
    return found;
  };
  return {
    shared: false,
    state: (id) => entry(id).state,
    commit(id, tr) {
      entry(id).state = tr.state;
      notify();
    },
    modified: (id) => !entry(id).state.doc.eq(entry(id).saved),
    insertMode: (id) => entry(id).insertMode,
    setInsertMode(id, insertMode) {
      entry(id).insertMode = insertMode;
      notify();
    },
    subscribe,
    onExternalChange: () => () => {},
    release(id) {
      entries.delete(id);
    },
  };
}
