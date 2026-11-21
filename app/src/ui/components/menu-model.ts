// Menu data and the keyboard rules of menus (ARCHITECTURE.md 2.11). Owner: W2.
//
// The menu bar, the drop-down menus, sub-menus and context menus all use the
// entries below. Captions keep the original's '&' markers. Commands are tied
// in by id: the shell builds the entries from the command tables (3.12.2) and
// receives the chosen entry in onSelect.

import { findMnemonic, findTypeahead, mnemonicKeyOf } from './mnemonic';
import { moveIndex } from './roving';

interface EntryBase {
  id: string;
  /** Caption with '&' before the access key. */
  caption: string;
  disabled?: boolean;
}

export interface MenuActionEntry extends EntryBase {
  type: 'item';
  /** Shortcut text shown on the right ('Ctrl+O'); display only. */
  shortcut?: string;
  onSelect?: () => void;
}

/** A command with a check mark (menuitemcheckbox): Enable Exceptions, Text Wrap. */
export interface MenuCheckEntry extends EntryBase {
  type: 'check';
  checked: boolean;
  shortcut?: string;
  onSelect?: () => void;
}

/** One of a group with one mark (menuitemradio): Output Window Size, Window list. */
export interface MenuRadioEntry extends EntryBase {
  type: 'radio';
  checked: boolean;
  shortcut?: string;
  onSelect?: () => void;
}

export interface MenuSubmenuEntry extends EntryBase {
  type: 'submenu';
  items: MenuEntry[];
}

export interface MenuSeparatorEntry {
  type: 'separator';
  id?: string;
}

export type MenuEntry = MenuActionEntry | MenuCheckEntry | MenuRadioEntry | MenuSubmenuEntry | MenuSeparatorEntry;
export type MenuSelectable = MenuActionEntry | MenuCheckEntry | MenuRadioEntry;

/** A top-level menu of the menu bar. */
export interface MenuBarMenu {
  id: string;
  /** '&File' */
  caption: string;
  items: MenuEntry[];
  disabled?: boolean;
}

/** Why a menu asks to be closed. */
export type MenuCloseReason = 'escape' | 'tab' | 'outside' | 'left' | 'right';

export type MenuKeyAction =
  | { type: 'focus'; index: number }
  | { type: 'activate'; index: number }
  | { type: 'openSubmenu'; index: number }
  | { type: 'close'; reason: MenuCloseReason }
  /** A key the menu swallows without effect (Enter on a disabled item). */
  | { type: 'none' };

export interface MenuKeyEvent {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function isSeparator(entry: MenuEntry | undefined): entry is MenuSeparatorEntry {
  return entry?.type === 'separator';
}

export function isSelectable(entry: MenuEntry | undefined): entry is MenuSelectable {
  return entry?.type === 'item' || entry?.type === 'check' || entry?.type === 'radio';
}

/** What `event` does in a menu whose focused entry is `active` (-1: none yet); null = not a menu key. */
export function menuKeyAction(
  items: readonly MenuEntry[],
  active: number,
  event: MenuKeyEvent,
  isSubmenu: boolean,
): MenuKeyAction | null {
  const entry = items[active];
  const enabled = entry !== undefined && !isSeparator(entry) && !entry.disabled;
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
    case 'Home':
    case 'End': {
      const next = moveIndex(items.length, active, event.key, {
        orientation: 'vertical',
        isSkipped: (i) => isSeparator(items[i]),
      });
      return next === null ? { type: 'none' } : { type: 'focus', index: next };
    }
    case 'Enter':
    case ' ':
      if (!enabled) return { type: 'none' };
      return entry.type === 'submenu' ? { type: 'openSubmenu', index: active } : { type: 'activate', index: active };
    case 'ArrowRight':
      if (enabled && entry.type === 'submenu') return { type: 'openSubmenu', index: active };
      return { type: 'close', reason: 'right' };
    case 'ArrowLeft':
      return { type: 'close', reason: isSubmenu ? 'escape' : 'left' };
    case 'Escape':
      return { type: 'close', reason: 'escape' };
    case 'Tab':
      return { type: 'close', reason: 'tab' };
    default:
      break;
  }
  if (event.ctrlKey || event.metaKey) return null;
  const letter = mnemonicKeyOf(event);
  if (!letter) return null;
  const captions = items.map((item) => (isSeparator(item) ? null : item.caption));
  const match = findMnemonic(captions, letter, active);
  if (match) {
    const target = items[match.index];
    if (!match.unique || !target || isSeparator(target) || target.disabled)
      return { type: 'focus', index: match.index };
    return target.type === 'submenu'
      ? { type: 'openSubmenu', index: match.index }
      : { type: 'activate', index: match.index };
  }
  const typed = findTypeahead(captions, letter, active);
  return typed >= 0 ? { type: 'focus', index: typed } : { type: 'none' };
}

/** The ARIA role of an entry. */
export function entryRole(entry: Exclude<MenuEntry, MenuSeparatorEntry>) {
  if (entry.type === 'check') return 'menuitemcheckbox';
  if (entry.type === 'radio') return 'menuitemradio';
  return 'menuitem';
}
