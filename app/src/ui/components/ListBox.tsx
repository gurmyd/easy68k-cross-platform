// Single-selection list (ARCHITECTURE.md 2.7): the Editor Options' element
// and font lists, the Help panel's contents, file lists. Owner: W2.
//
// A `listbox` that keeps the focus on itself and points at the current
// option with aria-activedescendant. Keys: Up / Down, Home / End, Page Up /
// Page Down move the selection; typing selects by the start of the label;
// Enter calls onActivate when there is one (otherwise it reaches the dialog,
// which presses its default button); a double-click calls onActivate too.

import { useEffect, useId, useRef, type ReactNode } from 'react';
import './ListBox.css';
import { findTypeahead } from './mnemonic';
import { moveIndex, pageIndex } from './roving';

export interface ListBoxItem<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
  /** Content instead of the plain label (the label stays the accessible text and the type-ahead key). */
  render?: () => ReactNode;
}

export interface ListBoxProps<V extends string> {
  items: readonly ListBoxItem<V>[];
  value: V | null;
  onChange: (value: V) => void;
  onActivate?: (value: V) => void;
  /** Accessible name, or the id of the visible label (labelledBy). */
  label?: string;
  labelledBy?: string;
  /** Visible rows; the list scrolls beyond. Default 8. */
  rows?: number;
  monospace?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}

const ROW_HEIGHT = 24;
const TYPEAHEAD_MS = 700;

export function ListBox<V extends string>({
  items,
  value,
  onChange,
  onActivate,
  label,
  labelledBy,
  rows = 8,
  monospace = false,
  disabled = false,
  id,
  className,
}: ListBoxProps<V>) {
  const generatedId = useId();
  const listId = id ?? generatedId;
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const activeIndex = items.findIndex((item) => item.value === value);
  const optionId = (index: number) => `${listId}-opt-${index}`;

  // Keep the selected option in view (inside the list only; the page does not scroll).
  useEffect(() => {
    const list = listRef.current;
    const option = activeIndex >= 0 ? (list?.children[activeIndex] as HTMLElement | undefined) : undefined;
    if (!list || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [activeIndex]);

  const select = (index: number) => {
    const item = items[index];
    if (item && !item.disabled && item.value !== value) onChange(item.value);
  };

  return (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      tabIndex={disabled ? -1 : 0}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
      aria-disabled={disabled || undefined}
      data-e68-enter={onActivate ? '' : undefined}
      className={['e68-listbox', monospace ? 'e68-listbox--mono' : '', className ?? ''].filter(Boolean).join(' ')}
      style={{ height: rows * ROW_HEIGHT + 2 }}
      onKeyDown={(event) => {
        if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
        const skip = (i: number) => items[i]?.disabled === true;
        const next =
          event.key === 'PageUp' || event.key === 'PageDown'
            ? pageIndex(items.length, Math.max(0, activeIndex), event.key, rows)
            : moveIndex(items.length, activeIndex, event.key, {
                orientation: 'vertical',
                wrap: false,
                isSkipped: skip,
              });
        if (next !== null) {
          event.preventDefault();
          select(next);
          return;
        }
        if (event.key === 'Enter' && onActivate && value !== null) {
          event.preventDefault();
          onActivate(value);
          return;
        }
        if (event.key.length === 1 && event.key !== ' ') {
          const now = performance.now();
          typed.current.text = now - typed.current.at > TYPEAHEAD_MS ? event.key : typed.current.text + event.key;
          typed.current.at = now;
          const from = typed.current.text.length > 1 ? activeIndex - 1 : activeIndex;
          const found = findTypeahead(
            items.map((item) => (item.disabled ? null : item.label)),
            typed.current.text,
            from,
          );
          if (found >= 0) {
            event.preventDefault();
            select(found);
          }
        }
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.value}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          aria-disabled={item.disabled || undefined}
          className="e68-listbox__option"
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.preventDefault();
            listRef.current?.focus();
            select(index);
          }}
          onDoubleClick={() => {
            if (!disabled && !item.disabled) onActivate?.(item.value);
          }}
        >
          {item.render ? item.render() : item.label}
        </div>
      ))}
    </div>
  );
}
