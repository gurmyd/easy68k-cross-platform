// How the editor reaches the text of a document (ARCHITECTURE.md 3.9.1). Owner: E2.
//
// 3.9.1: "One EditorState per document lives in core/documents/registry.ts; the editor component
// (E2) attaches a view to it." The contract (contracts/documents.ts, DocumentService) gives only
// `text(id): string`; it has no way to read the EditorState, to store the editor's changes into it,
// to hear about a state replaced from outside (Reload, Open of an open file) or to set the per-
// document Insert/Replace flag. That is a gap in the contract (errata/E2.md, "Contract").
//
// Until W1 closes it, the editor talks to documents through this local adapter, `DocumentLink`:
//
//   - If the document service carries the access object proposed in errata/E2.md
//     (`ctx.documents.editor: DocumentEditorAccess`), the link uses it: E1's registry stays the one
//     place where the text lives, and Save, Assemble and drafts read what the editor wrote.
//   - Else, if the service exposes a registry of the shape E1's `DocumentManager` has in wave 1
//     (`registry` with state / apply / subscribe(event), and `update(id, { insertMode })`), the link
//     adapts that to the same access object. Nothing is imported from core/documents: the shape is
//     checked at run time, so a different service simply falls through to the next case.
//   - Otherwise (the wave-0 stub service) the link keeps the states itself, created from
//     `text(id)`, and tracks Modified and Insert/Replace locally. The editor works fully; only
//     other services do not see the edits.
//
// The editor never assumes which of these it has.

import { EditorState, type Transaction } from '@codemirror/state';
import type { AppContext, DocumentState } from '../../contracts';

/**
 * What the editor needs from the document service: the proposal of errata/E2.md for
 * `contracts/documents.ts` (an optional member `editor` of DocumentService).
 */
export interface DocumentEditorAccess {
  /** The document's current EditorState (3.9.1). */
  getState(id: string): EditorState;
  /**
   * The editor applied `tr` to the document's state: store `tr.state`, bump `revision`, and set
   * `modified` (Modified becomes false again when the history returns to the saved state).
   */
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

/** The shape of E1's registry that the link can adapt (checked at run time, never imported). */
interface RegistryLike {
  state(id: string): EditorState;
  apply(id: string, tr: Transaction): void;
  subscribe(listener: (event: { kind: string; id: string; transaction?: Transaction }) => void): () => void;
}

function isRegistryLike(value: unknown): value is RegistryLike {
  const candidate = value as Partial<RegistryLike> | null | undefined;
  return (
    !!candidate &&
    typeof candidate.state === 'function' &&
    typeof candidate.apply === 'function' &&
    typeof candidate.subscribe === 'function'
  );
}

/** A registry of that shape as the access object. */
function adaptRegistry(
  registry: RegistryLike,
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
        if (event.kind === 'updated' && event.transaction && event.transaction !== applying)
          listener(event.transaction);
        else if (event.kind === 'replaced') listener();
      }),
    setInsertMode: (id, insertMode) => update(id, { insertMode }),
  };
}

/** The access object of the document service, when it has one (see the top of this file). */
export function editorAccessOf(ctx: AppContext): DocumentEditorAccess | null {
  const service = ctx.documents as {
    editor?: Partial<DocumentEditorAccess>;
    registry?: unknown;
    update?: unknown;
  };
  const candidate = service.editor;
  if (
    candidate &&
    typeof candidate.getState === 'function' &&
    typeof candidate.apply === 'function' &&
    typeof candidate.subscribe === 'function' &&
    typeof candidate.setInsertMode === 'function'
  ) {
    return candidate as DocumentEditorAccess;
  }
  if (isRegistryLike(service.registry) && typeof service.update === 'function') {
    const update = service.update as (id: string, patch: { insertMode: boolean }) => void;
    return adaptRegistry(service.registry, (id, patch) => update.call(ctx.documents, id, patch));
  }
  return null;
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
