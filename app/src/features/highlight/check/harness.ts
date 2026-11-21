// Page-side helper of check-highlight.mjs (browser check of the highlighter). Owner: E3.
//
// Loaded by the check script inside the development build of the application with
// `await import('/src/features/highlight/check/harness.ts')`. It mounts bare CodeMirror views with
// the highlighter's extension and the running application's settings, so that the check does not
// depend on the editor component (E2) being finished. Nothing in the application imports it.

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { TabType, type AppContext, type DocumentState } from '../../../contracts';
import { buildHighlightDecorations } from '../decorations';
import { createHighlightEnvironment, highlightExtension } from '../extension';

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

/** Colour and background of a view's content. */
export function contentColors(view: EditorView): { color: string; background: string; marks: number } {
  const content = view.contentDOM;
  const style = getComputedStyle(content);
  return {
    color: style.color,
    background: style.backgroundColor,
    marks: content.querySelectorAll('[class*="e68-syntax__"]').length,
  };
}

/** Best time in ms of `runs` passes over the view's visible ranges. */
export function timeViewport(view: EditorView, runs: number): { best: number; lines: number } {
  let best = Infinity;
  const options = { bitField: true };
  for (let run = 0; run < runs; run++) {
    const start = performance.now();
    buildHighlightDecorations(view.state.doc, view.visibleRanges, options);
    best = Math.min(best, performance.now() - start);
  }
  const first = view.state.doc.lineAt(view.visibleRanges[0]?.from ?? 0).number;
  const last = view.state.doc.lineAt(view.visibleRanges.at(-1)?.to ?? 0).number;
  return { best, lines: last - first + 1 };
}
