// A scrolling list that renders only the visible rows (ARCHITECTURE.md 2.3,
// 2.6): the simulator's listing, the Log panel's tails, long message lists.
// Owner: W2.
//
// Rows have one fixed height. The caller renders each row's content and
// gives the container its role and keyboard handling (a listing is a
// `listbox` or `grid`, a log a `log`); the rows get `rowProps(index)` (id,
// role, aria-selected, ...). The handle scrolls a row into view.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import './VirtualList.css';
import { scrollTopFor, visibleRange, type RowWindow, type ScrollAlign } from './virtual';

export interface VirtualListHandle {
  scrollToIndex(index: number, align?: ScrollAlign): void;
  /** The rows currently on screen (without overscan). */
  visibleRows(): RowWindow;
  /** The scrolling element. */
  element(): HTMLDivElement | null;
}

export interface VirtualListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  count: number;
  /** Row height in px. */
  rowHeight: number;
  renderRow: (index: number) => ReactNode;
  /** Attributes of a row element (id, role, aria-selected, data-*). */
  rowProps?: (index: number) => HTMLAttributes<HTMLDivElement> & { [data: `data-${string}`]: string | undefined };
  /** Extra rows rendered above and below the visible ones. Default 6. */
  overscan?: number;
  /** Called when the visible rows change (without overscan). */
  onVisibleRowsChange?: (rows: RowWindow) => void;
  ref?: Ref<VirtualListHandle>;
}

export function VirtualList({
  count,
  rowHeight,
  renderRow,
  rowProps,
  overscan = 6,
  onVisibleRowsChange,
  className,
  onScroll,
  ref,
  ...rest
}: VirtualListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element) setViewport({ top: element.scrollTop, height: element.clientHeight });
  }, []);

  useLayoutEffect(() => {
    measure();
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const onScreen = visibleRange(viewport.top, viewport.height, rowHeight, count, 0);
  const shown = visibleRange(viewport.top, viewport.height, rowHeight, count, overscan);
  const lastReported = useRef<string>('');
  useEffect(() => {
    const key = `${onScreen.start}:${onScreen.end}`;
    if (key !== lastReported.current) {
      lastReported.current = key;
      onVisibleRowsChange?.(onScreen);
    }
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex(index, align = 'auto') {
      const element = scrollRef.current;
      if (!element) return;
      const top = scrollTopFor(index, align, element.scrollTop, element.clientHeight, rowHeight, count);
      if (top !== element.scrollTop) element.scrollTop = top;
      measure();
    },
    visibleRows: () => {
      const element = scrollRef.current;
      return element ? visibleRange(element.scrollTop, element.clientHeight, rowHeight, count, 0) : onScreen;
    },
    element: () => scrollRef.current,
  }));

  const rows: ReactNode[] = [];
  for (let index = shown.start; index < shown.end; index++) {
    const extra = rowProps?.(index) ?? {};
    rows.push(
      <div
        key={index}
        {...extra}
        className={extra.className ? `e68-vlist__row ${extra.className}` : 'e68-vlist__row'}
        style={{ ...extra.style, top: index * rowHeight, height: rowHeight }}
      >
        {renderRow(index)}
      </div>,
    );
  }

  return (
    <div
      ref={scrollRef}
      className={className ? `e68-vlist ${className}` : 'e68-vlist'}
      onScroll={(event) => {
        measure();
        onScroll?.(event);
      }}
      {...rest}
    >
      <div className="e68-vlist__sizer" style={{ height: count * rowHeight }}>
        {rows}
      </div>
    </div>
  );
}
