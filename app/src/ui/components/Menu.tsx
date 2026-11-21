// A drop-down menu, sub-menu or context menu (ARCHITECTURE.md 2.11). Owner: W2.
//
// Normally used through MenuBar or ContextMenu, which own the open state and
// put the focus back afterwards. A Menu by itself shows `items` next to
// `anchor`, takes the focus, and reports the user's decision:
//   onSelect(entry)      an enabled item was chosen (click, Enter, Space, its access key);
//   onClose(reason, backward)  Escape, Tab (backward: Shift+Tab), ArrowLeft / ArrowRight at
//                        the edge (for the menu bar).
// Keys: Up / Down (wrapping), Home / End, Enter / Space, Right opens a
// sub-menu, Left or Escape closes one, a letter chooses the item with that
// access key (or moves to the next item starting with it). Disabled items
// can be focused but not chosen.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import '../../styles/components.css';
import './Menu.css';
import { Caption } from './Caption';
import { Icon } from './Icon';
import { Portal } from './layer';
import {
  entryRole,
  isSeparator,
  menuKeyAction,
  type MenuCloseReason,
  type MenuEntry,
  type MenuSelectable,
} from './menu-model';
import { placePopup, type Box, type Placement } from './position';

export interface MenuProps {
  items: readonly MenuEntry[];
  /** Accessible name of the menu ('File'), or the id of the element that names it. */
  label?: string;
  labelledBy?: string;
  id?: string;
  /** Where to show it; ignored when `inline`. */
  anchor?: Box;
  placement?: Placement;
  /** Render in place without positioning or taking the focus (the gallery's previews). */
  inline?: boolean;
  /** Focus the first or last item, or the menu itself (opened by the mouse). Default 'first'. */
  initialFocus?: 'first' | 'last' | 'none';
  isSubmenu?: boolean;
  /** Underline access keys (Windows and Linux). Default true. */
  showMnemonics?: boolean;
  onSelect: (entry: MenuSelectable) => void;
  /**
   * `backward` is true for Shift+Tab (reason 'tab'). For 'tab', returning true lets the browser's
   * own Tab go on from wherever the handler put the focus (the menu bar does that); otherwise the
   * key is cancelled.
   */
  onClose: (reason: MenuCloseReason, backward?: boolean) => boolean | void;
}

const SUBMENU_HOVER_MS = 220;

export function Menu(props: MenuProps) {
  const { inline = false } = props;
  const body = <MenuPopup {...props} />;
  return inline ? body : <Portal>{body}</Portal>;
}

function MenuPopup({
  items,
  label,
  labelledBy,
  id,
  anchor,
  placement = 'below',
  inline = false,
  initialFocus = 'first',
  isSubmenu = false,
  showMnemonics = true,
  onSelect,
  onClose,
}: MenuProps) {
  const baseId = useId();
  const menuId = id ?? `${baseId}menu`;
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [submenu, setSubmenu] = useState<{ index: number; focus: 'first' | 'none' } | null>(null);

  const firstItem = items.findIndex((entry) => !isSeparator(entry));
  const lastItem = items.length - 1 - [...items].reverse().findIndex((entry) => !isSeparator(entry));
  const [active, setActive] = useState(() =>
    inline || initialFocus === 'none' || firstItem < 0 ? -1 : initialFocus === 'last' ? lastItem : firstItem,
  );

  // Position next to the anchor once the size is known. Set on the element
  // directly, before the browser paints, so the menu can take the focus in the
  // same commit (a hidden element could not).
  useLayoutEffect(() => {
    const element = ref.current;
    if (inline || !element || !anchor) return;
    const { x, y } = placePopup(
      anchor,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      placement,
    );
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  }, [inline, anchor, placement]);

  // Opened by the mouse (or empty): the menu itself takes the focus, no item is active.
  useLayoutEffect(() => {
    if (!inline && active < 0) ref.current?.focus({ preventScroll: true });
    // Only when the menu opens.
  }, []);

  // The focused item follows the active index.
  useLayoutEffect(() => {
    if (active >= 0 && (!submenu || submenu.index !== active || submenu.focus === 'none')) {
      itemRefs.current[active]?.focus({ preventScroll: true });
    }
  }, [active, submenu]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const choose = (index: number) => {
    const entry = items[index];
    if (!entry || isSeparator(entry) || entry.disabled) return;
    if (entry.type === 'submenu') {
      setActive(index);
      setSubmenu({ index, focus: 'first' });
      return;
    }
    onSelect(entry);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // A sub-menu is a separate element with its own handler.
    if (!ref.current?.contains(event.target as Node)) return;
    const action = menuKeyAction(items, active, event, isSubmenu);
    if (!action) return;
    event.stopPropagation();
    if (action.type === 'close') {
      // Tab: the owner may let the browser's own Tab go on from where it put the focus.
      const passOn = onClose(action.reason, event.shiftKey) === true && action.reason === 'tab';
      if (!passOn) event.preventDefault();
      return;
    }
    event.preventDefault();
    switch (action.type) {
      case 'focus':
        setSubmenu(null);
        setActive(action.index);
        break;
      case 'activate':
        choose(action.index);
        break;
      case 'openSubmenu':
        setActive(action.index);
        setSubmenu({ index: action.index, focus: 'first' });
        break;
      case 'none':
        break;
    }
  };

  const onSubmenuClose = (reason: MenuCloseReason, backward?: boolean) => {
    if (reason === 'escape') {
      const index = submenu?.index ?? -1;
      setSubmenu(null);
      itemRefs.current[index]?.focus({ preventScroll: true });
      return;
    }
    return onClose(reason, backward);
  };

  const hoverItem = (index: number) => {
    window.clearTimeout(hoverTimer.current);
    const entry = items[index];
    setActive(index);
    if (entry && !isSeparator(entry) && entry.type === 'submenu' && !entry.disabled) {
      if (submenu?.index === index) return;
      hoverTimer.current = window.setTimeout(() => setSubmenu({ index, focus: 'none' }), SUBMENU_HOVER_MS);
    } else if (submenu) {
      hoverTimer.current = window.setTimeout(() => setSubmenu(null), SUBMENU_HOVER_MS);
    }
  };

  const style = inline ? undefined : { left: 0, top: 0 };

  let submenuNode: ReactNode = null;
  if (submenu) {
    const entry = items[submenu.index];
    const element = itemRefs.current[submenu.index];
    if (entry && !isSeparator(entry) && entry.type === 'submenu' && element) {
      const box = element.getBoundingClientRect();
      submenuNode = (
        <MenuPopup
          key={submenu.index}
          items={entry.items}
          labelledBy={`${menuId}-${submenu.index}`}
          anchor={{ x: box.left, y: box.top, width: box.width, height: box.height }}
          placement="right"
          initialFocus={submenu.focus}
          isSubmenu
          showMnemonics={showMnemonics}
          onSelect={onSelect}
          onClose={onSubmenuClose}
        />
      );
    }
  }

  return (
    <>
      <div
        ref={ref}
        id={menuId}
        role="menu"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-orientation="vertical"
        tabIndex={-1}
        data-e68-menu=""
        className={inline ? 'e68-popup e68-menu e68-menu--inline' : 'e68-popup e68-menu'}
        style={style}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((entry, index) => {
          if (isSeparator(entry)) {
            return <div key={entry.id ?? `sep-${index}`} role="separator" className="e68-sep e68-menu__separator" />;
          }
          const role = entryRole(entry);
          const checked = entry.type === 'check' || entry.type === 'radio' ? entry.checked : undefined;
          const shortcut = entry.type === 'submenu' ? undefined : entry.shortcut;
          return (
            <div
              key={entry.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              id={`${menuId}-${index}`}
              role={role}
              tabIndex={-1}
              aria-disabled={entry.disabled ? true : undefined}
              aria-checked={checked}
              aria-haspopup={entry.type === 'submenu' ? 'menu' : undefined}
              aria-expanded={entry.type === 'submenu' ? submenu?.index === index : undefined}
              data-active={active === index ? 'true' : undefined}
              className="e68-menu__item"
              onPointerEnter={() => hoverItem(index)}
              onClick={() => choose(index)}
            >
              <span className="e68-menu__mark" aria-hidden="true">
                {checked && <Icon name={entry.type === 'radio' ? 'dot' : 'check'} />}
              </span>
              <span className="e68-menu__caption">
                <Caption text={entry.caption} showMnemonic={showMnemonics} />
              </span>
              {shortcut && <span className="e68-shortcut e68-menu__shortcut">{shortcut}</span>}
              {entry.type === 'submenu' && (
                <span className="e68-menu__arrow" aria-hidden="true">
                  <Icon name="chevron-right" />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {submenuNode}
    </>
  );
}
