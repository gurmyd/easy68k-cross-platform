// What the editor shows around the caret, read from the page (a local adapter; Owner: H1).
//
// F1 in the editor needs the selected text and the text around the caret (editor-ui §15.3). The
// contracts give no access to the editor's selection (docs/porting/errata/H1.md, "Contract"), so the
// adapter reads the browser's own selection inside the editor region: the selected text, or the line
// the caret is in. The line stands for the text: it is surrounded by "\n" on both sides, which is
// what the original's lookup sees except at the very start and end of the document.

import { panelOf } from '../../state/panels';
import type { EditorWordContext } from '../../core/help';

/** The minimal parts of the DOM this adapter uses, so that it can be tested with fakes. */
export interface SelectionLike {
  readonly isCollapsed: boolean;
  readonly anchorNode: NodeLike | null;
  readonly anchorOffset: number;
  toString(): string;
}
export interface NodeLike {
  readonly textContent: string | null;
  readonly parentElement: ElementLike | null;
  readonly nodeType: number;
}
export interface ElementLike extends NodeLike {
  closest(selector: string): ElementLike | null;
}

/** True while the keyboard focus is inside the editor region (the editor has the focus). */
export function editorHasFocus(active: unknown = globalThis.document?.activeElement): boolean {
  return panelOf(active) === 'editor';
}

/**
 * The word context for F1, from the selection `selection` that lies in the editor. `lineBefore` is
 * the text of the caret's line before the caret; the line itself comes from the element that holds
 * it (`.cm-line` in CodeMirror, else the nearest block).
 */
export function wordContextFrom(
  selection: SelectionLike,
  lineTextBefore: (node: NodeLike, offset: number) => string,
): EditorWordContext | null {
  const selected = selection.toString();
  if (!selection.isCollapsed && selected !== '') return { selected, text: '', caret: 0 };
  const node = selection.anchorNode;
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as ElementLike) : node.parentElement;
  const line = element?.closest('.cm-line') ?? element?.closest('p, div, pre') ?? null;
  if (!line) return null;
  const before = lineTextBefore(node, selection.anchorOffset);
  const full = line.textContent ?? '';
  // The line between line ends; a caret at the start of a line has "\n" before it.
  return { selected: '', text: `\n${full}\n`, caret: before.length + 1 };
}

/** The context of the page's current selection, or null when the selection is not in the editor. */
export function readEditorWordContext(): EditorWordContext | null {
  const doc = globalThis.document;
  const selection = doc?.getSelection?.();
  if (!doc || !selection || selection.rangeCount === 0 || selection.anchorNode === null) return null;
  if (panelOf(selection.anchorNode.parentElement) !== 'editor' && panelOf(selection.anchorNode) !== 'editor')
    return null;
  return wordContextFrom(selection as unknown as SelectionLike, (node, offset) => {
    const element = (node.nodeType === 1 ? node : node.parentElement) as unknown as Element | null;
    const line = element?.closest('.cm-line') ?? element?.closest('p, div, pre');
    if (!line) return '';
    const range = doc.createRange();
    range.selectNodeContents(line);
    range.setEnd(node as unknown as Node, offset);
    return range.toString();
  });
}
