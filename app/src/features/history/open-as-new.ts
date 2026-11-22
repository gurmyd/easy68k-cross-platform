// `Open as New Document` of the Earlier Versions dialog (ARCHITECTURE-PLUS P3.3.8): a new untitled
// source document with the version's text, so that the student can copy what they need. Owner: N4.
//
// DocumentService (P4.4) can make a new document only from the template (`newSource()`); it has no
// member that gives a new document a text (docs/requests/N4-history-ui.md, item 1, asks for one).
// Until it has, the text is put into the new document by the editor itself: a view plugin,
// registered through `ctx.editorExtensions` for that one document, replaces the template with the
// version's text when the document's view exists, as one change that Undo does not take back
// (`Transaction.addToHistory` false), and then unregisters itself. The document is modified, so
// that closing it asks whether to save it, as for any edited untitled document.

import { Transaction } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import type { AppContext, DocumentState } from '../../contracts';

/** Opens a new untitled source document holding `text` ("\n" line ends). */
export function openAsNewDocument(
  ctx: Pick<AppContext, 'documents' | 'editorExtensions'>,
  text: string,
): DocumentState {
  let done = false;
  let unregister: (() => void) | null = null;
  const target = { id: '' };
  const plugin = ViewPlugin.define((view) => {
    let destroyed = false;
    // Not inside the view's own construction (dispatching there is not allowed), and only in a view
    // that is still on the page: a view made and dropped at once (React's development double
    // mount) leaves the text to the one that stays.
    setTimeout(() => {
      if (done || destroyed || !view.dom.isConnected) return;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          annotations: Transaction.addToHistory.of(false),
        });
        done = true;
        unregister?.();
      } catch {
        // The view was between two states of its document; the next view of it tries again.
      }
    }, 0);
    return {
      destroy() {
        destroyed = true;
      },
    };
  });
  unregister = ctx.editorExtensions.register((doc) => (doc.id === target.id && !done ? plugin : []));
  const doc = ctx.documents.newSource();
  target.id = doc.id;
  return doc;
}
