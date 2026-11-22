// The caret survives a focus that no pointer gave (ARCHITECTURE.md 2.10: a dialog that closes gives
// the focus back to the element that had it; the original's edit window keeps its caret). Owner: E2.
//
// When code (the dialog service's focus return) or the Tab key focuses the editor's content
// element, Chromium first moves the page's selection to the start of that element, and the
// `selectionchange` that follows would put the caret there. CodeMirror undoes that move only when
// the `selectionchange` arrives within 200 ms of the focus (@codemirror/view DOMObserver
// readSelectionRange, `lastFocusTime > Date.now() - 200`). On a slow machine it arrives later, and
// the caret jumps to the start of the document: after Save As, a paste or the next keys typed went
// to line 1 (reproduced with the CPU throttled 12 to 26 times in Chromium: 7 of 8 runs; seen once on
// GitHub's macOS runner and in a Debian container; errata E2.md entry 16).
//
// So on such a focus the view writes its own selection to the page at once, inside the focus
// event, before the browser's `selectionchange` is read: CodeMirror then finds the page's selection
// equal to its own and changes nothing. A focus that follows a pointer press is left alone (the
// click places the caret).

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** A focus this soon after a pointer press counts as given by that pointer. */
export const POINTER_FOCUS_MS = 1000;

/** True when a focus at `now` came from code or the keyboard, not from the pointer pressed at `pointerAt`. */
export function focusWithoutPointer(pointerAt: number | undefined, now: number): boolean {
  return pointerAt === undefined || now - pointerAt > POINTER_FOCUS_MS;
}

const pointerTimes = new WeakMap<EditorView, number>();

function notePointer(_event: Event, view: EditorView): boolean {
  pointerTimes.set(view, Date.now());
  return false;
}

/** Puts the view's selection back on the page (an update writes it when the page's one differs). */
function keepSelection(view: EditorView): void {
  const write = () => view.dispatch({ selection: view.state.selection });
  try {
    write();
  } catch {
    // A focus inside an update of this view: write it right after.
    queueMicrotask(() => {
      try {
        if (view.hasFocus) write();
      } catch {
        // the view is gone
      }
    });
  }
}

export const keepCaretOnFocus: Extension = EditorView.domEventHandlers({
  pointerdown: notePointer,
  mousedown: notePointer,
  touchstart: notePointer,
  focus: (_event, view) => {
    if (focusWithoutPointer(pointerTimes.get(view), Date.now())) keepSelection(view);
    return false;
  },
});
