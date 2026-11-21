// Double-click on a message row (editor-ui §7.3, TTextStuff::MessagesDblClick, textS.cpp:719-738):
// the row's line is selected in the editor, from its first character to just before its line
// break, and the editor gets the focus.
//
// The selection is a transaction on the document's EditorState in E1's registry
// (`documentRegistryOf`, 3.9.1); every editor view of the document follows it. The focus goes to
// the active document's text area through the shell (`focusPanel(ctx, 'editor')`).
//
// Two changes from the original, both in docs/differences/E5.md: on the last line of a document
// without a final line break the whole line is selected (the original leaves its last character
// out, `cpMax = End - 1`), and a line number outside the document (0 for the uncounted exception
// rows, lines + 1 for `END directive missing`) puts the caret at the start or the end of the
// document instead of an undefined selection.
//
// Owner: E5.

import { EditorSelection } from '@codemirror/state';
import type { AppContext, EditorMessage } from '../../contracts';
import { documentRegistryOf } from '../../core/documents/service';
import { foldCase } from '../../core/paths/winpath';
import { focusPanel } from '../../state/panels';

/** The characters of `text` ("\n" between lines) that the row's line covers, as [from, to). */
export function lineRange(text: string, line: number): { from: number; to: number } {
  if (!Number.isInteger(line) || line < 1) return { from: 0, to: 0 };
  let from = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', from);
    if (next < 0) return { from: text.length, to: text.length };
    from = next + 1;
  }
  const end = text.indexOf('\n', from);
  return { from, to: end < 0 ? text.length : end };
}

/** The open document a message row points at: the document whose path is the row's file, else `fallback`. */
export function documentOfMessage(
  ctx: Pick<AppContext, 'documents'>,
  message: EditorMessage,
  fallback: string,
): string {
  if (message.file === null) return fallback;
  const folded = foldCase(message.file);
  const owner = ctx.documents.list().find((doc) => doc.path !== null && foldCase(doc.path) === folded);
  return owner?.id ?? fallback;
}

/** Selects the row's line in its document and moves the focus to the editor. */
export function goToMessage(ctx: AppContext, docId: string, message: EditorMessage): void {
  const target = documentOfMessage(ctx, message, docId);
  if (target !== ctx.store.getState().documents.activeId) ctx.documents.activate(target);
  try {
    const registry = documentRegistryOf(ctx.documents);
    const { from, to } = lineRange(registry.text(target), message.line);
    registry.dispatch(target, { selection: EditorSelection.single(from, to), scrollIntoView: true });
  } catch {
    // A document service without E1's registry (a test stand-in): nothing to select.
  }
  focusPanel(ctx, 'editor');
}
