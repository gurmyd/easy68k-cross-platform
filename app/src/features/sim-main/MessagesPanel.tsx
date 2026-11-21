// The Messages panel of Simulator mode: the original's read-only message area under the listing
// (sim-ui §7.1, §7.2; ARCHITECTURE.md 2.3, 2.11, 4.6).
//
// The lines are AppState.sim.messageLines, which the run controller appends to and clears (the
// engine's host.message / host.messagesClear, published once per frame). Lines are only added, the
// view follows the last one as a memo does, and it uses the listing's font. A trace can add
// hundreds of thousands of lines, so only the visible ones are rendered.
//
// For screen readers the list itself is quiet (rows come and go while it scrolls); the lines that
// arrive are announced politely by a separate `log` region (2.11).

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useAppState } from '../../state/context';
import { VirtualList, type VirtualListHandle } from '../../ui/components';
import { listingMetrics } from './selection';

/** At most this many of the lines that arrived at once are announced. */
const ANNOUNCED = 3;

export function MessagesPanel() {
  const lines = useAppState((state) => state.sim.messageLines);
  const font = useAppState((state) => state.settings.sim.listingFont);
  const list = useRef<VirtualListHandle>(null);
  const previous = useRef<readonly string[]>([]);
  const announce = useRef<HTMLDivElement>(null);
  const { fontPx, rowHeight } = listingMetrics(font.size);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = lines;
    if (lines === before) return;
    // New lines: show the last one (TMemo Lines->Add moves the caret to the end).
    if (lines.length > 0) list.current?.scrollToIndex(lines.length - 1, 'end');
    const target = announce.current;
    if (!target) return;
    const appended = lines.length >= before.length && before.every((line, index) => lines[index] === line);
    const fresh = appended ? lines.slice(before.length) : lines;
    target.textContent = fresh.slice(-ANNOUNCED).join('\n');
  }, [lines]);

  const style = {
    '--e68-listing-font': `"${font.name}"`,
    '--e68-listing-size': `${fontPx}px`,
  } as CSSProperties;

  return (
    <div className="e68-messages" style={style}>
      <VirtualList
        ref={list}
        className="e68-messages__list"
        role="list"
        aria-label="Messages"
        tabIndex={0}
        data-e68-panel-focus=""
        count={lines.length}
        rowHeight={rowHeight}
        renderRow={(index) => lines[index] ?? ''}
        rowProps={() => ({ role: 'listitem' })}
      />
      <div ref={announce} className="e68-simmain__hidden" role="log" aria-live="polite" />
    </div>
  );
}
