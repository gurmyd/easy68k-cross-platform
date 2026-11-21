// Toolbar (ARCHITECTURE.md 2.11). Owner: W2.
//
// A `toolbar` element with one tab stop: Tab enters on the last focused
// button (the first one at the start), Left / Right move between the enabled
// buttons and wrap, Home / End go to the ends, Tab leaves. Disabled buttons
// are skipped. Items are the buttons inside (Button, IconButton) and any
// element marked data-e68-toolbar-item; ToolbarSeparator and plain labels
// (the simulator's LOGGING label) are not items.

import { useCallback, useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import '../../styles/components.css';
import './Toolbar.css';
import { moveIndex } from './roving';

export interface ToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  /** Accessible name, for example 'Editor toolbar'. */
  label: string;
  children: ReactNode;
}

const ITEM_SELECTOR = 'button, [data-e68-toolbar-item]';

function enabledItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (item) => !(item as HTMLButtonElement).disabled && item.getAttribute('aria-disabled') !== 'true',
  );
}

export function Toolbar({ label, children, className, onKeyDown, onFocus, ...rest }: ToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  /** Exactly one enabled item has tabindex 0: the last focused one, or the first. */
  const updateTabStops = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const items = enabledItems(root);
    const stop = current.current && items.includes(current.current) ? current.current : (items[0] ?? null);
    for (const item of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) item.tabIndex = item === stop ? 0 : -1;
  }, []);

  useLayoutEffect(() => {
    updateTabStops();
    const root = ref.current;
    if (!root || typeof MutationObserver === 'undefined') return;
    // Buttons are enabled and disabled by their own state, without a render of the toolbar.
    const observer = new MutationObserver(updateTabStops);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, [updateTabStops]);

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={label}
      aria-orientation="horizontal"
      className={className ? `e68-toolbar ${className}` : 'e68-toolbar'}
      onFocus={(event) => {
        const target = event.target as HTMLElement;
        if (target.matches(ITEM_SELECTOR)) {
          current.current = target;
          updateTabStops();
        }
        onFocus?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const root = ref.current;
        if (!root) return;
        const items = enabledItems(root);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = moveIndex(items.length, index, event.key, { orientation: 'horizontal' });
        if (next === null) return;
        event.preventDefault();
        items[next]?.focus();
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A vertical line between groups of toolbar buttons. */
export function ToolbarSeparator() {
  return <div role="separator" aria-orientation="vertical" className="e68-sep e68-toolbar__separator" />;
}

/** Takes the free space, pushing the following items to the right end. */
export function ToolbarSpacer() {
  return <div className="e68-toolbar__spacer" aria-hidden="true" />;
}
