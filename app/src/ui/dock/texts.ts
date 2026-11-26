// Every text of the dock a person reads (ARCHITECTURE-PLUS P2.2, P3.1.4, P3.1.8, P4.4). Owner: N1.
//
// Copied character by character from the document; code and tests use these constants.

/** FlexLayout's one splitter label (`I18nLabel.Splitter`) is mapped to this (P2.2). */
export const SPLITTER_LABEL = 'Resize';

/** Today's names of the four splitters of the default arrangements (P2.2, main §2.2, §2.3). */
export const SPLITTER_NAMES = {
  files: 'Resize the Files panel',
  messages: 'Resize the Messages panel',
  columns: 'Resize the two columns',
  tools: 'Resize the tool panels',
} as const;

/** A splitter elsewhere: the titles of the selected tabs on its two sides (P2.2). */
export function resizeBetween(first: string, second: string): string {
  return `Resize ${first} and ${second}`;
}

/** The accessible name of the strip of the group that holds the tool panels (today's). */
export const TOOL_GROUP_LABEL = 'Tool panels';

/** The tab menu (P3.1.4). */
export const TAB_MENU = {
  label: 'Panel tab',
  moveTo: 'Move To...',
  moveLeft: 'Move Left',
  moveRight: 'Move Right',
  moveUp: 'Move Up',
  moveDown: 'Move Down',
  earlier: 'Move Tab Earlier',
  later: 'Move Tab Later',
  close: 'Close',
} as const;

/** Version 1.1 (P9.2, P9.5): the tab menu's new item. */
export const FLOAT_ITEM = 'Float';

/**
 * Version 1.1 (P9.8 point 3 (b)): the button at the right end of every tab strip that is shown; it
 * floats the strip's selected panel. Its tool tip, which is also its accessible name (the kit's
 * IconButton), begins with its name `Float`.
 */
export const FLOAT_BUTTON = 'Float: make this panel a window of its own';

/** Version 1.1 (P9.2): a floating window's title bar, its buttons and its menu. */
export const FLOAT_WINDOW = {
  /** The title bar's menu (Shift+F10, the context-menu key, a right click). */
  menuLabel: 'Window',
  move: 'Move',
  size: 'Size',
  dock: 'Dock',
  close: 'Close',
} as const;

/** A floating window is a region named `<panel name>, floating` (P9.2). */
export const FLOATING_REGION = (title: string) => `${title}, floating`;

/** The tooltip of a tab's `x` (FlexLayout's `I18nLabel.Close_Tab`). */
export const CLOSE_TAB = 'Close';

/** The sides of P3.1.4's dialog, as the announcements of P3.1.8 name them. */
export type BesideSide = 'left' | 'right' | 'above' | 'below';
export type EdgeSide = 'left' | 'right' | 'top' | 'bottom';

/** The announcements of the polite live region (P3.1.8, P4.4). */
export const ANNOUNCE = {
  beside: (panel: string, near: string, side: BesideSide) => `${panel} moved beside ${near}, ${side}.`,
  intoGroup: (panel: string, near: string) => `${panel} moved into the group of ${near}.`,
  edge: (panel: string, side: EdgeSide) => `${panel} moved to the ${side} edge of the window.`,
  position: (panel: string, position: number) => `${panel} moved to position ${position} of its group.`,
  reset: 'Layout reset.',
  locked: 'Layout locked.',
  unlocked: 'Layout unlocked.',
  opened: (name: string) => `${name} opened.`,
} as const;
