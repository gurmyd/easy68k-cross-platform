// The native menu bar of the desktop app (ARCHITECTURE.md 2.1, 7.6). Owner: W3.
//
// In the macOS app the menu bar is the system's. The page describes it with NativeMenuItem
// objects (contracts/platform.ts) and hands it to Platform.setNativeMenu, which is a no-op in a
// browser; the Electron main process (desktop/src/menu.ts, owner DV2) turns the description into
// a menu. The description is built from the same resolved tables as the in-window menu bar
// (menus.ts), so both always show the same commands.
//
// Layout (7.6): the application menu (About, Settings..., New Window, Services, Hide, Quit); the
// mode's own menus in the original's order; a standard Edit menu of role items in the modes whose
// original has no Edit menu; the Window menu before Help.
//
// Three kinds of item:
// - a COMMAND item has `id` (and `arg`): the main process reports a click through
//   Platform.onNativeCommand and the page runs the command. `accelerator` is the command's chord
//   in normal form (chords.ts: 'Cmd+O', 'Shift+Cmd+S', 'Ctrl+Alt+Z'). It is only SHOWN; the
//   page's dispatcher is the one that acts on the key (2.9.1).
// - a ROLE item has `role`: the system's own editing or window command. Cut, Copy, Paste and
//   Select All must be role items, or Cmd+X/C/V/A would not work in text fields of a macOS app.
// - separators and sub-menus.
//
// While a modal dialog is open, and during a load, every command item is disabled; role items
// stay enabled for the dialog's text fields.

import type { Mode, NativeMenuItem } from '../contracts';
import type { KnownCommandId } from './ids';
import { displayChord, resolveMenus, type ResolveEnv, type ResolvedNode } from './menus';
import { COMMAND_SPECS } from './specs';

export interface NativeMenuEnv extends ResolveEnv {
  /** DialogService.isModalOpen() */
  modalOpen: boolean;
}

/** The application's display name (section 1.2). */
export const APP_NAME = 'EASy68K';

const EXIT_COMMAND: Record<Mode, KnownCommandId> = {
  editor: 'ed.file.exit',
  simulator: 'sim.file.exit',
  easybin: 'bin.file.exit',
};
const ABOUT_COMMAND: Record<Mode, KnownCommandId> = {
  editor: 'ed.help.about',
  simulator: 'sim.help.about',
  easybin: 'bin.help.about',
};

/** Edit-menu commands of the Editor that the system must perform itself, and their roles. */
const EDIT_ROLES: Partial<Record<KnownCommandId, string>> = {
  'ed.edit.cut': 'cut',
  'ed.edit.copy': 'copy',
  'ed.edit.paste': 'paste',
  'ed.edit.selectAll': 'selectAll',
};

const separator: NativeMenuItem = { type: 'separator' };

/** macOS menus have no access keys: 'Save &As...' is shown as 'Save As...'. */
function label(caption: string, env: NativeMenuEnv): string {
  return env.os === 'mac' ? caption.replace(/&(.)/g, '$1') : caption;
}

function commandItem(id: KnownCommandId, text: string, env: NativeMenuEnv, arg?: unknown): NativeMenuItem {
  const spec = COMMAND_SPECS[id];
  const item: NativeMenuItem = {
    id,
    label: label(text, env),
    type: spec.kind === 'check' ? 'checkbox' : spec.kind === 'radio' ? 'radio' : 'normal',
    enabled: !env.modalOpen && env.state.sim.phase !== 'loading' && env.commands.isEnabled(id),
  };
  if (arg !== undefined) item.arg = arg;
  if (spec.kind !== 'action') item.checked = env.commands.isChecked(id, arg);
  const chord = displayChord(id, env);
  if (chord !== null) item.accelerator = chord;
  return item;
}

function convert(nodes: readonly ResolvedNode[], env: NativeMenuEnv): NativeMenuItem[] {
  return nodes.map((node): NativeMenuItem => {
    if (node.type === 'separator') return separator;
    if (node.type === 'submenu') {
      return { type: 'submenu', label: label(node.caption, env), items: convert(node.items, env) };
    }
    const role = EDIT_ROLES[node.id as KnownCommandId];
    if (role) return { role, label: label(node.caption, env) };
    const item = commandItem(node.id as KnownCommandId, node.caption, env, node.arg);
    // The Window menu's document list carries its own check marks.
    if (node.kind !== 'action') item.checked = node.checked;
    return item;
  });
}

function applicationMenu(mode: Mode, env: NativeMenuEnv): NativeMenuItem {
  const items: NativeMenuItem[] = [commandItem(ABOUT_COMMAND[mode], `About ${APP_NAME}`, env), separator];
  if (mode === 'editor') items.push(commandItem('ed.options.editor', 'Settings...', env), separator);
  items.push(
    commandItem('app.window.new', COMMAND_SPECS['app.window.new'].caption, env),
    separator,
    { role: 'services' },
    separator,
    { role: 'hide' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    separator,
    commandItem(EXIT_COMMAND[mode], `Quit ${APP_NAME}`, env),
  );
  return { type: 'submenu', label: APP_NAME, role: 'appMenu', items };
}

const STANDARD_EDIT_MENU: NativeMenuItem = {
  type: 'submenu',
  label: 'Edit',
  role: 'editMenu',
  items: [
    { role: 'undo' },
    { role: 'redo' },
    separator,
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ],
};

const WINDOW_ROLE_ITEMS: NativeMenuItem[] = [{ role: 'minimize' }, { role: 'zoom' }];

/** The whole native menu bar for `mode`. */
export function buildNativeMenu(mode: Mode, env: NativeMenuEnv): NativeMenuItem[] {
  const menus = resolveMenus(mode, env).map((menu): NativeMenuItem & { key: string } => ({
    key: menu.id,
    type: 'submenu',
    label: label(menu.caption, env),
    items: convert(menu.items, env),
  }));
  const strip = ({ key: _key, ...item }: NativeMenuItem & { key: string }): NativeMenuItem => item;
  const help = menus.filter((menu) => menu.key.endsWith('.help')).map((menu) => ({ ...strip(menu), role: 'help' }));
  const ownWindow = menus.find((menu) => menu.key.endsWith('.window'));
  const others = menus.filter((menu) => !menu.key.endsWith('.help') && menu !== ownWindow).map(strip);

  const windowMenu: NativeMenuItem = ownWindow
    ? // The Editor has a Window menu of its own: the system's window items join it.
      { ...strip(ownWindow), role: 'window', items: [...(ownWindow.items ?? []), separator, ...WINDOW_ROLE_ITEMS] }
    : { type: 'submenu', label: 'Window', role: 'window', items: WINDOW_ROLE_ITEMS };

  return [
    applicationMenu(mode, env),
    ...others,
    ...(mode === 'editor' ? [] : [STANDARD_EDIT_MENU]),
    windowMenu,
    ...help,
  ];
}
