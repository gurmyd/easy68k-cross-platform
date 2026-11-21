// Splitter between two panes (ARCHITECTURE.md 2.2, 2.3). Owner: W2.
//
// A focusable `separator` (the WAI-ARIA window splitter): drag with the
// pointer; Left / Right (or Up / Down) move it by 10 px, with Shift by 50;
// Home / End go to the limits; Enter and a double-click restore the default
// size. The component reports sizes; the caller lays out the panes and
// stores the size (AppSettings.layout, 3.10).

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
import './Splitter.css';
import { splitterDragValue, splitterKeyValue, type SplitterRange } from './splitter-model';

export interface SplitterProps extends SplitterRange {
  /** Current size in px of the pane the splitter sizes. */
  value: number;
  onChange: (value: number) => void;
  /** Accessible name, for example 'Resize the Messages panel'. */
  label: string;
  /** Id of the sized pane (aria-controls). */
  controls?: string;
  className?: string;
}

export function Splitter({ value, onChange, label, controls, className, ...range }: SplitterProps) {
  const drag = useRef<{ start: number; value: number; pointer: number } | null>(null);
  const vertical = range.orientation === 'vertical';

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { start: vertical ? event.clientX : event.clientY, value, pointer: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    const delta = (vertical ? event.clientX : event.clientY) - state.start;
    const next = splitterDragValue(state.value, delta, range);
    // Render the new size in this frame: without flushSync, WebKit may hold
    // React's update back for a while during pointer capture and the bar lags.
    if (next !== value) flushSync(() => onChange(next));
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };

  return (
    <div
      role="separator"
      aria-orientation={range.orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(range.min)}
      aria-valuemax={Math.round(range.max)}
      tabIndex={0}
      className={['e68-splitter', `e68-splitter--${range.orientation}`, className ?? ''].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => {
        if (range.defaultValue !== undefined) onChange(splitterKeyValue('Enter', false, value, range) ?? value);
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const next = splitterKeyValue(event.key, event.shiftKey, value, range);
        if (next === null) return;
        event.preventDefault();
        if (next !== value) onChange(next);
      }}
    />
  );
}
