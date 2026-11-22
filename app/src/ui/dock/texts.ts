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
