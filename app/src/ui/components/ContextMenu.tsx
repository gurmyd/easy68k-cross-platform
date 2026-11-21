// Context menu (ARCHITECTURE.md 1.3.2, 1.3.5, 2.11). Owner: W2.
//
// Opens at a point: the pointer for a right-click (Ctrl+click on macOS), the
// focused element's corner for Shift+F10 or the Menu key. Keys as in Menu.
// Closing gives the focus back to the element that had it, then the chosen
// item's onSelect and the onSelect prop run.
//
//   const context = useContextMenu();
//   <div {...context.triggerProps}>...</div>
//   <ContextMenu label="Editor" items={items} {...context.menuProps} />

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { focusElement } from './focus';
import { Menu } from './Menu';
import type { MenuEntry, MenuSelectable } from './menu-model';

export interface ContextMenuProps {
  items: readonly MenuEntry[];
  label: string;
  /** Where to open it (viewport pixels); null = closed. */
  at: { x: number; y: number } | null;
  onClose: () => void;
  onSelect?: (entry: MenuSelectable) => void;
  showMnemonics?: boolean;
}

export function ContextMenu({ items, label, at, onClose, onSelect, showMnemonics = true }: ContextMenuProps) {
  const restoreTo = useRef<HTMLElement | null>(null);
  const openedAt = useRef<ContextMenuProps['at']>(null);

  // Remember the focused element when the menu opens, before the menu takes the
  // focus (the menu focuses its first item while it is being committed).
  if (at !== openedAt.current) {
    openedAt.current = at;
    if (at && typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      restoreTo.current = active && active !== document.body && !active.closest('[data-e68-menu]') ? active : null;
    }
  }

  useEffect(() => {
    if (!at) return;
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('[data-e68-menu]')) return;
      restoreTo.current = null;
      onClose();
    };
    const onBlur = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [at, onClose]);

  if (!at) return null;

  const close = () => {
    const target = restoreTo.current;
    restoreTo.current = null;
    onClose();
    focusElement(target);
  };

  return (
    <Menu
      key={`${at.x},${at.y}`}
      items={items}
      label={label}
      anchor={{ x: at.x, y: at.y, width: 0, height: 0 }}
      placement="point"
      initialFocus="first"
      showMnemonics={showMnemonics}
      onSelect={(entry) => {
        close();
        entry.onSelect?.();
        onSelect?.(entry);
      }}
      onClose={(reason) => {
        // Left and Right at the edge of a context menu do nothing (they move between
        // menus only in the menu bar).
        if (reason !== 'left' && reason !== 'right') close();
      }}
    />
  );
}

/** Open state of a context menu and the handlers that open it. */
export function useContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const onClose = useCallback(() => setAt(null), []);
  const openAt = useCallback((x: number, y: number) => setAt({ x, y }), []);
  const triggerProps = {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      setAt({ x: event.clientX, y: event.clientY });
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
        event.preventDefault();
        const box = (document.activeElement ?? event.currentTarget).getBoundingClientRect();
        setAt({ x: box.left + 4, y: box.top + Math.min(box.height, 24) });
      }
    },
  };
  return { triggerProps, menuProps: { at, onClose }, openAt, isOpen: at !== null };
}
