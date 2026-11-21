// The in-window menu bar (ARCHITECTURE.md 2.1, 2.11). Owner: W2.
//
// A `menubar` with one `menuitem` per menu and a `menu` pop-up for the open
// one. Keyboard (2.11):
//   Left / Right      previous / next menu (wrapping); with a menu open, open that one
//   Down, Enter, Space  open the menu and focus its first item; Up: its last item
//   Home / End        first / last menu
//   a letter          open the menu with that access key ('&File' -> F)
//   Escape            close the menu (focus back on its title); again: leave the menu bar
//   Tab               close and leave
// Choosing an item closes the menu, gives the focus back to where it was
// before the menu bar was entered, and then calls the item's onSelect and the
// bar's onSelect, in that order, so a command that moves the focus keeps it.
// The shell opens a menu for Alt+letter or focuses the bar through the
// handle (MenuBarHandle).

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import './MenuBar.css';
import { Caption } from './Caption';
import { focusElement } from './focus';
import { Menu } from './Menu';
import type { MenuBarMenu, MenuCloseReason, MenuSelectable } from './menu-model';
import { findMnemonic, mnemonicKeyOf } from './mnemonic';
import { moveIndex } from './roving';

export interface MenuBarHandle {
  /** Puts the keyboard focus on the first menu title (no menu opens). */
  focus(): void;
  /** Opens a menu and focuses its first item. */
  openMenu(index: number): void;
  /** Opens the menu whose access key is `key`; false when there is none. */
  openByAccessKey(key: string): boolean;
  /** Closes any open menu. */
  close(): void;
}

export interface MenuBarProps {
  menus: readonly MenuBarMenu[];
  /** Accessible name, for example 'Editor'. */
  label: string;
  onSelect?: (entry: MenuSelectable) => void;
  /** Underline access keys (Windows and Linux; not macOS). Default true. */
  showMnemonics?: boolean;
  className?: string;
  ref?: Ref<MenuBarHandle>;
}

interface OpenState {
  index: number;
  focus: 'first' | 'last' | 'none';
}

export function MenuBar({ menus, label, onSelect, showMnemonics = true, className, ref }: MenuBarProps) {
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** The element that had the focus before the menu bar took it. */
  const restoreTo = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [tabStop, setTabStop] = useState(0);

  const isDisabled = useCallback((i: number) => menus[i]?.disabled === true, [menus]);

  const rememberFocus = () => {
    const active = document.activeElement as HTMLElement | null;
    const inside = active && (rootRef.current?.contains(active) || active.closest('[data-e68-menu]'));
    if (!inside) restoreTo.current = active && active !== document.body ? active : null;
  };

  const restoreFocus = () => {
    const target = restoreTo.current;
    restoreTo.current = null;
    if (target?.isConnected) focusElement(target);
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const focusTitle = (index: number) => {
    setTabStop(index);
    titleRefs.current[index]?.focus({ preventScroll: true });
  };

  const openMenu = (index: number, focus: OpenState['focus']) => {
    if (isDisabled(index)) return;
    rememberFocus();
    setTabStop(index);
    setOpen({ index, focus });
  };

  useImperativeHandle(ref, () => ({
    focus() {
      rememberFocus();
      const first = moveIndex(menus.length, -1, 'Home', { orientation: 'horizontal', isSkipped: isDisabled }) ?? 0;
      focusTitle(first);
    },
    openMenu: (index) => openMenu(index, 'first'),
    openByAccessKey(key) {
      const match = findMnemonic(
        menus.map((menu) => (menu.disabled ? null : menu.caption)),
        key,
        -1,
      );
      if (!match) return false;
      openMenu(match.index, 'first');
      return true;
    },
    close: () => setOpen(null),
  }));

  // A press outside the bar and its menus closes the menu; the focus goes where the press puts it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && (rootRef.current?.contains(target) || target.closest('[data-e68-menu]'))) return;
      restoreTo.current = null;
      setOpen(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const step = (from: number, key: 'ArrowLeft' | 'ArrowRight') =>
    moveIndex(menus.length, from, key, { orientation: 'horizontal', isSkipped: isDisabled }) ?? from;

  const onMenuClose = (reason: MenuCloseReason) => {
    if (!open) return;
    switch (reason) {
      case 'escape':
        setOpen(null);
        focusTitle(open.index);
        break;
      case 'left':
      case 'right': {
        const next = step(open.index, reason === 'left' ? 'ArrowLeft' : 'ArrowRight');
        setTabStop(next);
        setOpen({ index: next, focus: 'first' });
        break;
      }
      case 'tab':
        setOpen(null);
        restoreFocus();
        break;
      case 'outside':
        setOpen(null);
        break;
    }
  };

  const onMenuSelect = (entry: MenuSelectable) => {
    setOpen(null);
    restoreFocus();
    entry.onSelect?.();
    onSelect?.(entry);
  };

  const onTitleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.ctrlKey || event.metaKey) return;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End': {
        event.preventDefault();
        const next =
          event.key === 'Home' || event.key === 'End'
            ? (moveIndex(menus.length, index, event.key, { orientation: 'horizontal', isSkipped: isDisabled }) ?? index)
            : step(index, event.key);
        if (open) setOpen({ index: next, focus: 'first' });
        focusTitle(next);
        return;
      }
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        event.preventDefault();
        openMenu(index, 'first');
        return;
      case 'ArrowUp':
        event.preventDefault();
        openMenu(index, 'last');
        return;
      case 'Escape':
        event.preventDefault();
        if (open) setOpen(null);
        else restoreFocus();
        return;
      default: {
        const key = mnemonicKeyOf(event);
        if (!key) return;
        const match = findMnemonic(
          menus.map((menu) => (menu.disabled ? null : menu.caption)),
          key,
          index,
        );
        if (match) {
          event.preventDefault();
          openMenu(match.index, 'first');
        }
      }
    }
  };

  const openMenuData = open ? menus[open.index] : undefined;
  const anchorBox = (() => {
    if (!open) return undefined;
    const title = titleRefs.current[open.index];
    if (!title) return undefined;
    const box = title.getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  })();

  return (
    <div
      ref={rootRef}
      role="menubar"
      aria-label={label}
      aria-orientation="horizontal"
      className={className ? `e68-menubar ${className}` : 'e68-menubar'}
    >
      {menus.map((menu, index) => {
        const isOpen = open?.index === index;
        return (
          <button
            key={menu.id}
            ref={(element) => {
              titleRefs.current[index] = element;
            }}
            type="button"
            id={`${baseId}-title-${index}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={isOpen}
            aria-controls={isOpen ? `${baseId}-menu` : undefined}
            aria-disabled={menu.disabled ? true : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            className="e68-menubar__title"
            data-open={isOpen ? 'true' : undefined}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // Keep the focus where it is until the menu takes it.
              event.preventDefault();
              if (isOpen) {
                setOpen(null);
                restoreFocus();
              } else {
                openMenu(index, 'none');
              }
            }}
            onPointerEnter={() => {
              if (open && !isOpen && !menu.disabled) {
                setTabStop(index);
                setOpen({ index, focus: 'none' });
              }
            }}
            onFocus={(event) => {
              const from = event.relatedTarget as HTMLElement | null;
              if (from && !rootRef.current?.contains(from) && !from.closest('[data-e68-menu]')) {
                restoreTo.current = from;
              }
              setTabStop(index);
            }}
            onKeyDown={(event) => onTitleKeyDown(event, index)}
          >
            <Caption text={menu.caption} showMnemonic={showMnemonics} />
          </button>
        );
      })}
      {open && openMenuData && anchorBox && (
        <Menu
          key={open.index}
          id={`${baseId}-menu`}
          items={openMenuData.items}
          labelledBy={`${baseId}-title-${open.index}`}
          anchor={anchorBox}
          placement="below"
          initialFocus={open.focus}
          showMnemonics={showMnemonics}
          onSelect={onMenuSelect}
          onClose={onMenuClose}
        />
      )}
    </div>
  );
}
