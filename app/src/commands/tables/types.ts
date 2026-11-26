// The shape of the menu and toolbar tables (ARCHITECTURE.md 3.12.2). Owner: W3.
//
// A table says WHAT is in a menu or toolbar and in which order. Everything else about an item -
// caption, shortcut, icon, whether it is a check item - comes from the command's specification
// (specs.ts), and whether it is enabled or checked comes from its handler at run time
// (registry.ts). The shell (ui/shell) and the native menu of the desktop app (native-menu.ts)
// are both built from these tables.

import type { KnownCommandId } from '../ids';

export type MenuNode =
  /** A command. `arg` is passed to the handler; `caption` replaces the specification's caption. */
  | { type: 'command'; id: KnownCommandId; arg?: unknown; caption?: string }
  | { type: 'separator' }
  | { type: 'submenu'; caption: string; items: MenuNode[] }
  /** The Window menu's list of open documents, `1 <name>`, `2 <name>`, ... (editor-ui §2.5).
   *  With at least one document open it is preceded by a separator, as Windows adds one. */
  | { type: 'documents' };

/** One menu of the menu bar. */
export interface MenuTable {
  /** Stable id: `<mode>.<name>`, for example `editor.file`. */
  id: string;
  /** '&File' */
  caption: string;
  items: MenuNode[];
}

export type ToolbarNode =
  | { type: 'command'; id: KnownCommandId }
  | { type: 'separator' }
  /** The simulator's `LOGGING` label: bold on yellow while a log file is open (sim-ui §3.2). */
  | { type: 'logging' }
  /**
   * Version 1.1 (ARCHITECTURE-PLUS P9.3; M2): a toggle drawn with its caption as text (not an
   * icon), with its own tool-tip. Its pressed state is the check state of the check command `id`,
   * inverted when `inverted` is true (`Arrange Panels` is `Lock Layout` inverted).
   */
  | { type: 'toggle'; id: KnownCommandId; caption: string; tooltip: string; inverted: boolean };

/** Shorthand for table rows. */
export const command = (id: KnownCommandId, arg?: unknown, caption?: string): MenuNode => {
  const node: MenuNode = { type: 'command', id };
  if (arg !== undefined) node.arg = arg;
  if (caption !== undefined) node.caption = caption;
  return node;
};
export const separator: { type: 'separator' } = { type: 'separator' };
