// From the tables to what is shown (ARCHITECTURE.md 3.12.2). Owner: W3.
//
// The tables (tables/*.ts) say what is in a menu or toolbar. This module resolves a table against
// the running application: the caption and shortcut of each command on this platform, whether its
// handler reports it enabled or checked, the open documents of the Window menu. The result is
// plain data; the in-window menu bar and toolbar (ui/shell) and the native menu of the desktop
// app (native-menu.ts) are both drawn from it, so they cannot disagree.
//
// A command without a handler resolves as disabled (3.12.2).

import type { AppState, CommandId, CommandRegistry, Mode } from '../contracts';
import { formatChord, type Os } from './chords';
import type { KnownCommandId } from './ids';
import { COMMAND_SPECS, chordsOn } from './specs';
import { EASYBIN_MENUS } from './tables/easybin-menu';
import { EDITOR_MENUS } from './tables/editor-menu';
import { ALSO_IGNORED_AFTER_TASK_24, NOT_SHOWN_IN_MENUS } from './tables/keys';
import { SIM_MENUS } from './tables/sim-menu';
import { DISABLED_BY_HALT, HALTED_HINT, TOOLBARS } from './tables/toolbars';
import type { MenuNode, MenuTable } from './tables/types';

export interface ResolveEnv {
  os: Os;
  desktop: boolean;
  state: AppState;
  commands: Pick<CommandRegistry, 'isEnabled' | 'isChecked'>;
}

export interface ResolvedItem {
  type: 'item';
  id: CommandId;
  arg?: unknown;
  /** With '&' before the access key. */
  caption: string;
  kind: 'action' | 'check' | 'radio';
  enabled: boolean;
  checked: boolean;
  /** The shortcut as shown on this platform ('Ctrl+O', 'Shift+Cmd+S'), or null. */
  shortcut: string | null;
}
export type ResolvedNode =
  ResolvedItem | { type: 'separator' } | { type: 'submenu'; caption: string; items: ResolvedNode[] };
export interface ResolvedMenu {
  id: string;
  caption: string;
  items: ResolvedNode[];
}

export type ResolvedToolbarItem =
  | {
      type: 'button';
      id: CommandId;
      icon: string;
      /** The hint with the platform's shortcut appended: the accessible name and tool-tip. */
      label: string;
      /** Shown instead of the label while the button is disabled for this reason (note 22). */
      disabledReason: string | null;
      enabled: boolean;
      /** For toggles (kind 'check'): the pressed state. */
      pressed: boolean | null;
    }
  | { type: 'separator' }
  | { type: 'logging'; visible: boolean };

const MENUS: Record<Mode, MenuTable[]> = { editor: EDITOR_MENUS, simulator: SIM_MENUS, easybin: EASYBIN_MENUS };

/** The menu tables of a mode, in menu-bar order. */
export function menuTables(mode: Mode): MenuTable[] {
  return MENUS[mode];
}

/**
 * The chord that menus and tool-tips show for a command on this platform, in normal form: the
 * first of its chords that acts here. null when it has none, and - as in the original - while
 * TRAP #15 task 24 has removed it (sim-ui §3.5).
 */
export function displayChord(id: KnownCommandId, env: Pick<ResolveEnv, 'os' | 'desktop' | 'state'>): string | null {
  const spec = COMMAND_SPECS[id];
  if (NOT_SHOWN_IN_MENUS.includes(id)) return null;
  if (!env.state.sim.keyCommands && (spec.suppressedByTask24 || ALSO_IGNORED_AFTER_TASK_24.includes(id))) return null;
  return chordsOn(id, env.os, env.desktop)[0] ?? null;
}

/** displayChord, formatted for the platform. */
export function shortcutText(id: KnownCommandId, env: Pick<ResolveEnv, 'os' | 'desktop' | 'state'>): string | null {
  const chord = displayChord(id, env);
  return chord === null ? null : formatChord(chord, env.os);
}

/** '&' in a file name is text, not an access-key marker. */
function escapeCaption(text: string): string {
  return text.replaceAll('&', '&&');
}

function resolveCommand(node: Extract<MenuNode, { type: 'command' }>, env: ResolveEnv): ResolvedItem {
  const spec = COMMAND_SPECS[node.id];
  const item: ResolvedItem = {
    type: 'item',
    id: node.id,
    caption: node.caption ?? spec.caption,
    kind: spec.kind,
    enabled: env.commands.isEnabled(node.id),
    checked: spec.kind === 'action' ? false : env.commands.isChecked(node.id, node.arg),
    shortcut: shortcutText(node.id, env),
  };
  if (node.arg !== undefined) item.arg = node.arg;
  return item;
}

/** The Window menu's document list: `1 <name>`, `2 <name>`, ...; a mark on the active document. */
function resolveDocuments(env: ResolveEnv): ResolvedNode[] {
  const { items, activeId } = env.state.documents;
  if (items.length === 0) return [];
  const enabled = env.commands.isEnabled('ed.window.select');
  return [
    { type: 'separator' },
    ...items.map((document, index): ResolvedItem => ({
      type: 'item',
      id: 'ed.window.select',
      arg: index,
      // The digit is the access key for the first nine, as in a Windows MDI window list.
      caption: `${index < 9 ? '&' : ''}${index + 1} ${escapeCaption(document.name)}`,
      kind: 'radio',
      enabled,
      checked: document.id === activeId,
      shortcut: null,
    })),
  ];
}

/** Removes separators that would be drawn first, last or twice in a row. */
function tidy(nodes: ResolvedNode[]): ResolvedNode[] {
  const result: ResolvedNode[] = [];
  for (const node of nodes) {
    if (node.type === 'separator' && (result.length === 0 || result[result.length - 1]?.type === 'separator')) continue;
    result.push(node);
  }
  while (result[result.length - 1]?.type === 'separator') result.pop();
  return result;
}

function resolveNodes(nodes: readonly MenuNode[], env: ResolveEnv): ResolvedNode[] {
  return tidy(
    nodes.flatMap((node): ResolvedNode[] => {
      switch (node.type) {
        case 'command':
          return [resolveCommand(node, env)];
        case 'separator':
          return [{ type: 'separator' }];
        case 'submenu':
          return [{ type: 'submenu', caption: node.caption, items: resolveNodes(node.items, env) }];
        case 'documents':
          return resolveDocuments(env);
      }
    }),
  );
}

/** The menu bar of `mode` as it is right now. */
export function resolveMenus(mode: Mode, env: ResolveEnv): ResolvedMenu[] {
  return menuTables(mode).map((menu) => ({ id: menu.id, caption: menu.caption, items: resolveNodes(menu.items, env) }));
}

/** The toolbar of `mode` as it is right now. */
export function resolveToolbar(mode: Mode, env: ResolveEnv): ResolvedToolbarItem[] {
  return TOOLBARS[mode].map((node): ResolvedToolbarItem => {
    if (node.type === 'separator') return { type: 'separator' };
    if (node.type === 'logging') return { type: 'logging', visible: env.state.sim.logging };
    const spec = COMMAND_SPECS[node.id];
    const shortcut = shortcutText(node.id, env);
    const hint = spec.hint ?? spec.caption;
    const enabled = env.commands.isEnabled(node.id);
    return {
      type: 'button',
      id: node.id,
      icon: spec.icon ?? 'dot',
      label: shortcut ? `${hint} (${shortcut})` : hint,
      disabledReason: !enabled && blockedByHalt(env.state) && DISABLED_BY_HALT.includes(node.id) ? HALTED_HINT : null,
      enabled,
      pressed: spec.kind === 'check' ? env.commands.isChecked(node.id) : null,
    };
  });
}

/**
 * True while the run commands are blocked because the program halted (1.4 note 22): the
 * simulator is idle and busy (menuState 1, sim-ui §3.6) after a halt. `sim.halted` alone is the
 * engine's raw flag, which a reset leaves set until the next run (contracts/store.ts), so it is
 * still true while the next program runs.
 */
export function blockedByHalt(state: AppState): boolean {
  return state.sim.halted && state.sim.phase === 'idle' && state.sim.menuState === 1;
}
