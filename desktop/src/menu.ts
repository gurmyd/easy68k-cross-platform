// The native menu bar (ARCHITECTURE.md 2.1, 7.6). The page describes the whole bar with
// NativeMenuItem objects (app/src/contracts/platform.ts, built by app/src/commands/native-menu.ts)
// and sends it whenever it changes; this module checks the description and turns it into an
// Electron menu.
//
// - A command item reports its click to the page that sent the menu (Platform.onNativeCommand);
//   the page runs the command. Its accelerator is only SHOWN: the page's key dispatcher is the
//   one handler of a command chord (2.9.1), so that it runs once and task 24 and the Output panel
//   rules of 2.9.4 decide about it. Three guards keep the menu from acting on a key:
//   `registerAccelerator: false` (Windows, Linux), `setIgnoreMenuShortcuts(true)` for every key
//   that is not a role chord (windows.ts, before-input-event, via isRoleChord()), and a click
//   whose event says `triggeredByAccelerator` is ignored.
// - A role item is the system's own editing, window or application command. Text editing with
//   Cmd+X, C, V, A and Z works in a macOS app only through these.
// - macOS has one menu bar for the app: it shows the menu of the window in front. Windows and
//   Linux (development and tests only) give each window its own menu, with the bar hidden: the
//   page shows its in-window menu there.
//
// Accelerators arrive in the normal form of app/src/commands/chords.ts (`Cmd+O`, `Shift+Cmd+S`,
// `Ctrl+Alt+Z`, `Ctrl+Shift+.`); toElectronAccelerator() gives Electron's spelling.
//
// Owner: DV2.

import type { BrowserWindow, Input, Menu, MenuItemConstructorOptions } from 'electron';

export type MenuOs = 'mac' | 'windows' | 'linux';

/** The NativeMenuItem of app/src/contracts/platform.ts, as it arrives over IPC. */
export interface NativeMenuItem {
  id?: string;
  arg?: unknown;
  label?: string;
  accelerator?: string;
  role?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  enabled?: boolean;
  checked?: boolean;
  items?: NativeMenuItem[];
}

/** IPC channels of the menu. */
export const MENU_SET_CHANNEL = 'e68:menu-set';
export const MENU_COMMAND_CHANNEL = 'e68:menu-command';

/** Roles a menu (a submenu of the bar) may have, and Electron's name for each. */
const MENU_ROLES: Readonly<Record<string, string>> = {
  appMenu: 'appMenu',
  editMenu: 'editMenu',
  // "The submenu is a Window menu": macOS adds its window list to the page's items.
  window: 'window',
  windowMenu: 'windowMenu',
  help: 'help',
};

/** Roles an item may have. Those marked mac exist only in macOS menus and are left out elsewhere. */
const ITEM_ROLES: Readonly<Record<string, { mac?: true }>> = {
  undo: {},
  redo: {},
  cut: {},
  copy: {},
  paste: {},
  selectAll: {},
  delete: {},
  minimize: {},
  close: {},
  quit: {},
  about: {},
  zoom: { mac: true },
  front: { mac: true },
  services: { mac: true },
  hide: { mac: true },
  hideOthers: { mac: true },
  unhide: { mac: true },
};

/**
 * The chords of the role items of the page's menu on macOS (Electron's defaults for these roles;
 * app/src/commands/native-menu.ts uses no `close` or `quit` role: Quit is a command item). Only
 * these reach the menu; every other key is kept from it (7.6).
 */
export const MAC_ROLE_CHORDS: Readonly<Record<string, string>> = {
  undo: 'Cmd+Z',
  redo: 'Shift+Cmd+Z',
  cut: 'Cmd+X',
  copy: 'Cmd+C',
  paste: 'Cmd+V',
  selectAll: 'Cmd+A',
  minimize: 'Cmd+M',
  hide: 'Cmd+H',
  hideOthers: 'Alt+Cmd+H',
};

const MAX_ITEMS = 4000;
const MAX_DEPTH = 6;
const MAX_TEXT = 200;

/** Key names of the normal form that Electron spells differently. */
const KEY_SPELLING: Readonly<Record<string, string>> = {
  Enter: 'Return',
  Esc: 'Escape',
};
const MODIFIER_SPELLING: Readonly<Record<string, Record<MenuOs, string>>> = {
  Ctrl: { mac: 'Control', windows: 'Control', linux: 'Control' },
  Alt: { mac: 'Alt', windows: 'Alt', linux: 'Alt' },
  Shift: { mac: 'Shift', windows: 'Shift', linux: 'Shift' },
  Cmd: { mac: 'Command', windows: 'Super', linux: 'Super' },
};
const NAMED_KEYS = new Set([
  'Tab',
  'Space',
  'Insert',
  'Delete',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'Enter',
  'Esc',
]);

/**
 * Electron's spelling of a chord in normal form: `Shift+Cmd+S` -> `Shift+Command+S`,
 * `Ctrl+Alt+Z` -> `Control+Alt+Z`, `Alt+Enter` -> `Alt+Return`. null for text that is not a chord.
 */
export function toElectronAccelerator(chord: string, os: MenuOs): string | null {
  const parts = chord.split('+');
  const key = parts.pop();
  if (key === undefined || key === '') return null;
  const modifiers: string[] = [];
  for (const part of parts) {
    const spelled = MODIFIER_SPELLING[part]?.[os];
    if (!spelled) return null;
    modifiers.push(spelled);
  }
  let spelledKey: string;
  if (/^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1\d|2[0-4])$/.test(key)) spelledKey = key;
  else if (NAMED_KEYS.has(key)) spelledKey = KEY_SPELLING[key] ?? key;
  else if (/^[.,/;'[\]\\\-=`]$/.test(key)) spelledKey = key;
  else return null;
  return [...modifiers, spelledKey].join('+');
}

/** The chord (normal form) of a key-down as before-input-event reports it, letters by position. */
export function chordOfInput(input: Pick<Input, 'key' | 'code' | 'control' | 'alt' | 'shift' | 'meta'>): string {
  const letter = /^Key([A-Z])$/.exec(input.code)?.[1];
  const digit = /^Digit(\d)$/.exec(input.code)?.[1];
  const key = letter ?? digit ?? (input.key.length === 1 ? input.key.toUpperCase() : input.key);
  return [input.control && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', input.meta && 'Cmd', key]
    .filter(Boolean)
    .join('+');
}

/**
 * The chord of a key-down by the character the key types (input.key), not by its position: what
 * macOS matches menu key equivalents against. null when the key types no single ASCII letter or
 * digit. With Option held, macOS reports the Option character (Option+H types "˙"), so the letter
 * then comes from the position only.
 */
export function typedChordOfInput(
  input: Pick<Input, 'key' | 'code' | 'control' | 'alt' | 'shift' | 'meta'>,
): string | null {
  if (!/^[A-Za-z0-9]$/.test(input.key)) return null;
  return [
    input.control && 'Ctrl',
    input.alt && 'Alt',
    input.shift && 'Shift',
    input.meta && 'Cmd',
    input.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join('+');
}

/**
 * True if the key-down is the chord of a role item of the macOS menu (only those reach the menu).
 * macOS matches Cmd+C by the typed "c", so the character the key types decides (on Dvorak "c" is
 * on the key KeyJ, on AZERTY "a" is on KeyQ); the key's position decides only when it types no
 * ASCII letter or digit (Option held, or a non-Latin layout, where macOS also goes by position).
 * Letting a key through by its position although it types another letter would hand Dvorak's
 * Cmd+J (on KeyC) to the menu, which would swallow it instead of the page.
 */
export function isRoleChord(
  input: Pick<Input, 'key' | 'code' | 'control' | 'alt' | 'shift' | 'meta'>,
  os: MenuOs,
): boolean {
  if (os !== 'mac') return false;
  return Object.values(MAC_ROLE_CHORDS).includes(typedChordOfInput(input) ?? chordOfInput(input));
}

/** Why a menu description was refused. */
export class MenuDescriptionError extends Error {}

function text(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT)
    throw new MenuDescriptionError(`${what} is not a short string`);
  return value;
}

function flag(value: unknown, what: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new MenuDescriptionError(`${what} is not a boolean`);
  return value;
}

/**
 * Checks a menu description that came over IPC and returns it as NativeMenuItem[]: known keys
 * only, short strings, known roles, a command id on every item that is not a role, separator or
 * submenu, at most MAX_DEPTH levels and MAX_ITEMS items, `arg` a string, number, boolean or null.
 */
export function validateMenu(value: unknown): NativeMenuItem[] {
  let count = 0;
  const walk = (items: unknown, depth: number): NativeMenuItem[] => {
    if (!Array.isArray(items)) throw new MenuDescriptionError('a menu is not a list');
    if (depth > MAX_DEPTH) throw new MenuDescriptionError('the menu is nested too deeply');
    return items.map((raw, index): NativeMenuItem => {
      if (++count > MAX_ITEMS) throw new MenuDescriptionError('the menu has too many items');
      if (raw === null || typeof raw !== 'object') throw new MenuDescriptionError(`item ${index} is not an object`);
      const item = raw as Record<string, unknown>;
      for (const key of Object.keys(item)) {
        if (!['id', 'arg', 'label', 'accelerator', 'role', 'type', 'enabled', 'checked', 'items'].includes(key)) {
          throw new MenuDescriptionError(`item ${index} has the unknown key ${key}`);
        }
      }
      const out: NativeMenuItem = {};
      const type = item['type'];
      if (type !== undefined) {
        if (!['normal', 'separator', 'checkbox', 'radio', 'submenu'].includes(type as string)) {
          throw new MenuDescriptionError(`item ${index} has the unknown type ${String(type)}`);
        }
        out.type = type as NativeMenuItem['type'] & string;
      }
      const id = text(item['id'], 'id');
      if (id !== undefined) {
        if (!/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$/.test(id)) throw new MenuDescriptionError(`bad command id ${id}`);
        out.id = id;
      }
      const arg = item['arg'];
      if (arg !== undefined) {
        if (arg !== null && !['string', 'number', 'boolean'].includes(typeof arg)) {
          throw new MenuDescriptionError(`item ${index} has an arg that is not a string, number, boolean or null`);
        }
        if (typeof arg === 'string' && arg.length > MAX_TEXT) throw new MenuDescriptionError('arg is too long');
        out.arg = arg;
      }
      const label = text(item['label'], 'label');
      if (label !== undefined) out.label = label;
      const accelerator = text(item['accelerator'], 'accelerator');
      if (accelerator !== undefined) out.accelerator = accelerator;
      const role = text(item['role'], 'role');
      if (role !== undefined) {
        const isMenu = type === 'submenu' || item['items'] !== undefined;
        if (!(isMenu ? role in MENU_ROLES : role in ITEM_ROLES)) {
          throw new MenuDescriptionError(`unknown ${isMenu ? 'menu' : 'item'} role ${role}`);
        }
        out.role = role;
      }
      const enabled = flag(item['enabled'], 'enabled');
      if (enabled !== undefined) out.enabled = enabled;
      const checked = flag(item['checked'], 'checked');
      if (checked !== undefined) out.checked = checked;
      if (item['items'] !== undefined) out.items = walk(item['items'], depth + 1);
      const isSubmenu = out.type === 'submenu' || out.items !== undefined;
      if (!isSubmenu && out.type !== 'separator' && out.role === undefined && out.id === undefined) {
        throw new MenuDescriptionError(`item ${index} (${out.label ?? ''}) has neither a command id nor a role`);
      }
      return out;
    });
  };
  return walk(value, 0);
}

/** What a click on a command item does: report it to the page that sent the menu. */
export type MenuCommandSink = (id: string, arg: unknown) => void;

/** The Electron template of a checked description, for `os`. */
export function toElectronTemplate(
  items: NativeMenuItem[],
  os: MenuOs,
  onCommand: MenuCommandSink,
): MenuItemConstructorOptions[] {
  const convert = (list: NativeMenuItem[], topLevel: boolean): MenuItemConstructorOptions[] => {
    const out: MenuItemConstructorOptions[] = [];
    for (const item of list) {
      if (item.type === 'separator') {
        out.push({ type: 'separator' });
        continue;
      }
      if (item.type === 'submenu' || item.items !== undefined) {
        const menu: MenuItemConstructorOptions = { type: 'submenu', submenu: convert(item.items ?? [], false) };
        if (item.label !== undefined) menu.label = item.label;
        // Menu-level roles matter only to macOS (application, Edit, Window and Help menus).
        if (os === 'mac' && topLevel && item.role !== undefined) {
          menu.role = MENU_ROLES[item.role] as NonNullable<MenuItemConstructorOptions['role']>;
        }
        if (item.enabled !== undefined) menu.enabled = item.enabled;
        out.push(menu);
        continue;
      }
      if (item.role !== undefined) {
        if (ITEM_ROLES[item.role]?.mac && os !== 'mac') continue;
        const roleItem: MenuItemConstructorOptions = {
          role: item.role as NonNullable<MenuItemConstructorOptions['role']>,
        };
        if (item.label !== undefined) roleItem.label = item.label;
        out.push(roleItem);
        continue;
      }
      const id = item.id as string;
      const command: MenuItemConstructorOptions = {
        id: `${id}${item.arg === undefined ? '' : `:${JSON.stringify(item.arg)}`}`,
        label: item.label ?? id,
        type: item.type === 'checkbox' || item.type === 'radio' ? item.type : 'normal',
        enabled: item.enabled ?? true,
        // Shown, never registered with the system (Windows, Linux); see the top of this file.
        registerAccelerator: false,
        click: (_menuItem, _window, event) => {
          if (event.triggeredByAccelerator) return;
          onCommand(id, item.arg);
        },
      };
      if (item.checked !== undefined) command.checked = item.checked;
      if (item.accelerator !== undefined) {
        const accelerator = toElectronAccelerator(item.accelerator, os);
        if (accelerator !== null) command.accelerator = accelerator;
      }
      out.push(command);
    }
    // Drop separators left at the edges or doubled by the items removed for this OS.
    return out.filter(
      (entry, index, all) =>
        entry.type !== 'separator' || (index > 0 && index < all.length - 1 && all[index - 1]?.type !== 'separator'),
    );
  };
  return convert(items, true);
}

/** A plain summary of an Electron menu, for the tests (tests/desktop/dev). */
export interface MenuSnapshot {
  label: string;
  role: string | null;
  type: string;
  id: string;
  accelerator: string | null;
  enabled: boolean;
  checked: boolean;
  visible: boolean;
  items?: MenuSnapshot[];
}

export function snapshotMenu(menu: Menu): MenuSnapshot[] {
  return menu.items.map((item) => {
    const snapshot: MenuSnapshot = {
      label: item.label,
      role: item.role ?? null,
      type: item.type,
      id: item.id,
      accelerator: item.accelerator ?? null,
      enabled: item.enabled,
      checked: item.checked,
      visible: item.visible,
    };
    if (item.submenu) snapshot.items = snapshotMenu(item.submenu);
    return snapshot;
  });
}

interface MenuApi {
  buildFromTemplate(template: MenuItemConstructorOptions[]): Menu;
  setApplicationMenu(menu: Menu | null): void;
}

/**
 * The menus of all windows. A window's description is kept until it sends another; on macOS the
 * bar shows the menu of the window in front.
 */
export class NativeMenus {
  private readonly menus = new Map<number, { description: NativeMenuItem[]; menu: Menu }>();
  private front: number | null = null;

  /**
   * `windowless` is the menu bar of a macOS app with no window open (the last window's menu would
   * stay in the bar with commands that reach no page): installed when the last window's menu is
   * forgotten. Unused on Windows and Linux, where the app quits with its last window.
   */
  constructor(
    private readonly api: MenuApi,
    private readonly os: MenuOs,
    private readonly sendCommand: (window: BrowserWindow, id: string, arg: unknown) => void,
    private readonly windowless?: () => MenuItemConstructorOptions[],
  ) {}

  /** A new description from the page of `window`. Throws MenuDescriptionError for a bad one. */
  set(window: BrowserWindow, description: unknown): void {
    const items = validateMenu(description);
    const menu = this.api.buildFromTemplate(
      toElectronTemplate(items, this.os, (id, arg) => {
        if (!window.isDestroyed()) this.sendCommand(window, id, arg);
      }),
    );
    this.menus.set(window.id, { description: items, menu });
    if (this.os === 'mac') {
      if (this.front === null || this.front === window.id || window.isFocused()) this.show(window);
    } else {
      window.setMenu(menu);
      window.setMenuBarVisibility(false);
    }
  }

  /** The window came to the front. */
  show(window: BrowserWindow): void {
    this.front = window.id;
    const entry = this.menus.get(window.id);
    if (entry && this.os === 'mac') this.api.setApplicationMenu(entry.menu);
  }

  forget(window: BrowserWindow | number): void {
    const id = typeof window === 'number' ? window : window.id;
    this.menus.delete(id);
    if (this.front === id) this.front = null;
    if (this.os === 'mac' && this.menus.size === 0 && this.windowless) {
      this.api.setApplicationMenu(this.api.buildFromTemplate(this.windowless()));
    }
  }

  description(window: BrowserWindow | number): NativeMenuItem[] | null {
    return this.menus.get(typeof window === 'number' ? window : window.id)?.description ?? null;
  }

  menu(window: BrowserWindow | number): Menu | null {
    return this.menus.get(typeof window === 'number' ? window : window.id)?.menu ?? null;
  }
}

/**
 * The macOS menu bar while no window is open: the application menu, New Window (Cmd+N, which
 * opens a window, as a click on the Dock icon does), and the Window and Help menus. `newWindow`
 * creates the window.
 */
export function windowlessMenuTemplate(newWindow: () => void): MenuItemConstructorOptions[] {
  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { id: 'windowless.newWindow', label: 'New Window', accelerator: 'Command+N', click: () => newWindow() },
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [] },
  ];
}
