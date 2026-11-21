// Page-side helper of check-highlight.mjs (browser check of the highlighter). Owner: E3.
//
// Loaded by the check script inside the development build of the application with
// `await import('/src/features/highlight/check/harness.ts')`. It mounts bare CodeMirror views with
// the highlighter's extension and the running application's settings (for exact per-preset
// colours independent of the editor component's own styles), and reads the views of the real
// editor component (E2's DocumentEditor, reached through the development hook `e68View`).
// Nothing in the application imports it.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { TabType, type AppContext, type DocumentState } from '../../../contracts';
import { buildHighlightDecorations } from '../decorations';
import { createHighlightEnvironment, highlightExtension } from '../extension';
import { measureBest } from '../timing';

let counter = 0;

function documentState(kind: DocumentState['kind']): DocumentState {
  counter++;
  return {
    id: `highlight-check-${counter}`,
    path: null,
    name: kind === 'source' ? `check${counter}.x68` : `check${counter}.L68`,
    kind,
    hasName: true,
    tabType: TabType.Fixed,
    tabSize: 4,
    fontName: 'Courier New',
    fontSize: 10,
    insertMode: true,
    modified: false,
    revision: 0,
  };
}

/** Mounts a view of `text` as a source or list document in a fixed box on top of the page. */
export function mountView(
  ctx: AppContext,
  text: string,
  kind: DocumentState['kind'],
  box: { left: number; top: number; width: number; height: number },
): EditorView {
  const parent = document.createElement('div');
  parent.dataset.highlightCheck = kind;
  Object.assign(parent.style, {
    position: 'fixed',
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    zIndex: '1000',
    border: '1px solid var(--c-border)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
  });
  document.body.append(parent);
  const env = createHighlightEnvironment(ctx);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        highlightExtension(env, documentState(kind)),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto' } }),
      ],
    }),
  });
  return view;
}

/** The computed style of the marks of line `lineNumber`: [text, color, weight, style, decoration]. */
export function lineStyles(view: EditorView, lineNumber: number): [string, string, string, string, string][] {
  const line = view.state.doc.line(lineNumber);
  const { node } = view.domAtPos(line.from + Math.min(1, line.length));
  const lineElement = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
  if (!lineElement) return [];
  return Array.from(lineElement.querySelectorAll<HTMLElement>('[class*="e68-syntax__"]')).map((span) => {
    const style = getComputedStyle(span);
    return [span.textContent ?? '', style.color, style.fontWeight, style.fontStyle, style.textDecorationLine];
  });
}

/** The background a view's text is drawn on: the first non-transparent one from the content up. */
function effectiveBackground(element: Element | null): string {
  for (let at = element; at; at = at.parentElement) {
    const background = getComputedStyle(at).backgroundColor;
    if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
  }
  return 'rgba(0, 0, 0, 0)';
}

/** Colour and background of a view's content (the background it is drawn on; the content itself is
 *  transparent so that the selection layer behind it shows). */
export function contentColors(view: EditorView): {
  color: string;
  background: string;
  ownBackground: string;
  marks: number;
} {
  const content = view.contentDOM;
  const style = getComputedStyle(content);
  return {
    color: style.color,
    background: effectiveBackground(content),
    ownBackground: style.backgroundColor,
    marks: content.querySelectorAll('[class*="e68-syntax__"]').length,
  };
}

/** Selects [from, to) in a view, with or without the focus, for the selection check. */
export function selectRange(view: EditorView, from: number, to: number, focus: boolean): void {
  view.dispatch({ selection: { anchor: from, head: to } });
  if (focus) view.focus();
  else view.contentDOM.blur();
}

/** The page rectangle of the text [from, to) of line `line` (1-based) in a view. */
export function textRect(view: EditorView, line: number, from: number, to: number) {
  const start = view.state.doc.line(line).from;
  const a = view.coordsAtPos(start + from);
  const b = view.coordsAtPos(start + to, -1);
  if (!a || !b) return null;
  return { x: a.left, y: a.top, width: b.right - a.left, height: a.bottom - a.top, pos: start + from, end: start + to };
}

/**
 * Best time in ms of passes over the view's visible ranges: batches of 25 until one run is under
 * `target` ms (a loaded CI runner may deschedule a whole batch), at most 20 batches or 10 s.
 */
export function timeViewport(view: EditorView, target: number): { best: number; runs: number; lines: number } {
  const options = { bitField: true };
  const { best, runs } = measureBest(() => buildHighlightDecorations(view.state.doc, view.visibleRanges, options), {
    target,
  });
  const first = view.state.doc.lineAt(view.visibleRanges[0]?.from ?? 0).number;
  const last = view.state.doc.lineAt(view.visibleRanges.at(-1)?.to ?? 0).number;
  return { best, runs, lines: last - first + 1 };
}

/** The view of the real editor component (E2's DocumentEditor) that shows document `id`. */
export function editorView(id: string): EditorView | null {
  const host = document.querySelector<HTMLElement & { e68View?: EditorView }>(
    `.e68-editor__view[data-e68-document="${CSS.escape(id)}"]`,
  );
  return host?.e68View ?? null;
}

/** What the check reads from a view of the real editor. */
export function editorFacts(id: string): {
  found: boolean;
  syntaxClasses: number;
  classes: string;
  marks: number;
  color: string;
  background: string;
  gutterBackground: string;
  caret: string;
} | null {
  const view = editorView(id);
  if (!view) return null;
  const classes = view.dom.className;
  const content = getComputedStyle(view.contentDOM);
  const gutters = view.dom.querySelector('.cm-gutters');
  const cursor = view.dom.querySelector('.cm-cursorLayer .cm-cursor');
  return {
    found: true,
    syntaxClasses: classes.split(/\s+/).filter((c) => c === 'e68-syntax').length,
    classes,
    marks: view.contentDOM.querySelectorAll('[class*="e68-syntax__"]').length,
    color: content.color,
    background: getComputedStyle(view.scrollDOM).backgroundColor,
    gutterBackground: gutters ? getComputedStyle(gutters).backgroundColor : '',
    caret: cursor ? getComputedStyle(cursor).borderLeftColor : '',
  };
}

/** Hides or shows the bare views this harness mounted (so screenshots show the real editor). */
export function showHarnessViews(visible: boolean): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-highlight-check]')) {
    element.style.display = visible ? '' : 'none';
  }
}
