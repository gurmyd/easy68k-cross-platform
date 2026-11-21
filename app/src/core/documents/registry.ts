// The text of every open document, as a CodeMirror EditorState (ARCHITECTURE.md 3.9.1).
//
// One EditorState per document lives here. The editor component (E2) attaches its views to them;
// everything else reads the text through DocumentService.text(id). The line separator is "\n":
// EditorState's default line splitting turns CR LF and lone CR in inserted text into line breaks,
// and doc.toString() joins lines with "\n".
//
// How a view uses the registry (E2):
//
//   const registry = documentRegistryOf(ctx.documents);
//   const view = new EditorView({
//     state: registry.state(id),
//     dispatchTransactions: (trs) => trs.forEach((tr) => registry.apply(id, tr)),
//   });
//   registry.subscribe((event) => {
//     if (event.id !== id) return;
//     if (event.kind === 'updated') view.update([event.transaction]);
//     if (event.kind === 'replaced') view.setState(registry.state(id));
//   });
//
// Every transaction goes through apply() and comes back to every view as an 'updated' event, so two
// views of one document (two panes) stay in step. Reload replaces the whole state ('replaced'): new
// text, caret at the start, empty undo history. The extensions of new and replaced states come
// from setExtensions() (the editor component's own: history, tab stops, key maps ...).
//
// The registry also remembers the text as it was last loaded or saved, so `isModified` is true
// exactly while the text differs from it: undoing back to the saved text clears "Modified"
// (1.3.3 "saved state tracked").
//
// Owner: E1. Runs under Node and in browsers (core/ rules, 3.1).

import {
  EditorSelection,
  EditorState,
  StateEffect,
  type Extension,
  type Text,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';

export type RegistryEvent =
  { kind: 'created' | 'replaced' | 'removed'; id: string } | { kind: 'updated'; id: string; transaction: Transaction };

/** The extensions for the state of a document; called with the document's id. */
export type ExtensionSource = (id: string) => Extension;

interface Entry {
  state: EditorState;
  /** The text in the file; null = unknown (a restored draft), so the document counts as modified. */
  saved: Text | null;
}

export class DocumentRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(event: RegistryEvent) => void>();
  private extensions: ExtensionSource = () => [];

  /** Ids of the documents that have a state, in the order they were created. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** The current state of a document. Throws for an unknown id. */
  state(id: string): EditorState {
    return this.entry(id).state;
  }

  /** The text, lines separated by "\n". */
  text(id: string): string {
    return this.entry(id).state.doc.toString();
  }

  /** True while the text differs from the text last loaded or saved. */
  isModified(id: string): boolean {
    const entry = this.entry(id);
    return entry.saved === null || !entry.state.doc.eq(entry.saved);
  }

  /**
   * A new document holding `text`, caret at the start, counted as saved; with `modified` (a
   * restored draft) it counts as modified until it is saved or replaced.
   */
  create(id: string, text: string, options: { modified?: boolean } = {}): EditorState {
    if (this.entries.has(id)) throw new Error(`The document "${id}" already exists`);
    const state = this.newState(id, text);
    this.entries.set(id, { state, saved: options.modified ? null : state.doc });
    this.emit({ kind: 'created', id });
    return state;
  }

  /** Replaces the whole state (reload): new text, caret at the start, empty history, counted as saved. */
  replace(id: string, text: string): EditorState {
    const entry = this.entry(id);
    entry.state = this.newState(id, text);
    entry.saved = entry.state.doc;
    this.emit({ kind: 'replaced', id });
    return entry.state;
  }

  remove(id: string): void {
    if (!this.entries.delete(id)) return;
    this.emit({ kind: 'removed', id });
  }

  /**
   * Applies a transaction made from the current state (by a view). A transaction made from an
   * older state is refused: the view missed an update.
   */
  apply(id: string, transaction: Transaction): void {
    const entry = this.entry(id);
    if (transaction.startState !== entry.state) {
      throw new Error(`The transaction for "${id}" was not made from the document's current state`);
    }
    entry.state = transaction.state;
    this.emit({ kind: 'updated', id, transaction });
  }

  /** Makes a transaction from the current state, applies it and returns it. */
  dispatch(id: string, ...specs: TransactionSpec[]): Transaction {
    const transaction = this.entry(id).state.update(...specs);
    this.apply(id, transaction);
    return transaction;
  }

  /** Records `doc` (default: the current text) as the text that is now in the file. */
  markSaved(id: string, doc?: Text): void {
    const entry = this.entry(id);
    entry.saved = doc ?? entry.state.doc;
  }

  /**
   * Sets the extensions of every state created or replaced from now on, and reconfigures the
   * existing states with them (one 'updated' event per document).
   */
  setExtensions(source: ExtensionSource): void {
    this.extensions = source;
    for (const id of this.ids()) this.dispatch(id, { effects: StateEffect.reconfigure.of(source(id)) });
  }

  subscribe(listener: (event: RegistryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private newState(id: string, text: string): EditorState {
    return EditorState.create({ doc: text, selection: EditorSelection.cursor(0), extensions: this.extensions(id) });
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`No open document has the id "${id}"`);
    return entry;
  }

  private emit(event: RegistryEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}
