// The editor area of Editor mode (ARCHITECTURE.md 2.2): one pane, or two panes one above the other
// (Tile Horizontally) or side by side (Tile Vertically), each a stack of tab strip, editor and
// status bar (1.4 note 9). Owner: E2.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useAppContext, useAppState } from '../../state/context';
import { shallowEqual } from '../../state/store';
import { Splitter } from '../components';
import './editor.css';
import { EditorPane } from './EditorPane';
import { paneViews, syncPanes, type PaneLayout } from './panes';
import { editorSession } from './session';

/** Width or height of an element, followed with a ResizeObserver. */
function useLength(ref: RefObject<HTMLElement | null>, vertical: boolean): number {
  const [length, setLength] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setLength(vertical ? element.clientWidth : element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, vertical]);
  return length;
}

const MIN_PANE = 120;

export function EditorArea() {
  const ctx = useAppContext();
  const session = editorSession(ctx);
  const layout = useAppState((state) => state.settings.app.layout.editorPanes) as PaneLayout;
  const { items, activeId } = useAppState(
    (state) => ({ items: state.documents.items, activeId: state.documents.activeId }),
    shallowEqual,
  );
  const panes = useSyncExternalStore(session.panes.subscribe, () => session.panes.state);
  const ids = items.map((item) => item.id);
  const idsKey = ids.join('\n');

  // New documents go into the active pane; closed ones are forgotten.
  useEffect(() => {
    session.panes.set((state) => syncPanes(state, idsKey === '' ? [] : idsKey.split('\n'), activeId));
  }, [session, idsKey, activeId]);

  // Forget the states of closed documents (local link only).
  const known = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(ids);
    for (const id of known.current) if (!now.has(id)) session.link.release(id);
    known.current = now;
  });

  const twoPanes = layout !== 'one';
  const views = paneViews(panes, layout, ids, activeId);
  const vertical = layout === 'vertical';
  const container = useRef<HTMLDivElement>(null);
  const available = useLength(container, vertical);
  const [fraction, setFraction] = useState(0.5);
  const max = Math.max(MIN_PANE, available - MIN_PANE);
  const first = Math.min(Math.max(Math.round(available * fraction), MIN_PANE), max);

  return (
    <div ref={container} className="e68-editor" data-layout={layout}>
      <div className="e68-editor__slot" style={twoPanes ? { flexBasis: `${first}px` } : undefined}>
        <EditorPane index={0} pane={views[0]} docs={items} activeId={activeId} twoPanes={twoPanes} />
      </div>
      {twoPanes && (
        <>
          <Splitter
            orientation={vertical ? 'vertical' : 'horizontal'}
            value={first}
            min={MIN_PANE}
            max={max}
            defaultValue={Math.round(available / 2)}
            label="Resize the editor panes"
            onChange={(value) => setFraction(available > 0 ? value / available : 0.5)}
          />
          <div className="e68-editor__slot e68-editor__slot--rest">
            <EditorPane index={1} pane={views[1]} docs={items} activeId={activeId} twoPanes />
          </div>
        </>
      )}
    </div>
  );
}
