// The texts of the layout feature: the dialog `layout.move` (ARCHITECTURE-PLUS P3.1.4; owner N1)
// and, since version 1.1 (P9.2, P9.3; M2), its fourth place and the tip about arranging the panels.
//
// P3.1.4 draws the dialog with `&Panel:` and `&Place:`, two access keys on one letter; the place's
// is `P&lace:` here (docs/porting/errata/N1.md).

import { ARRANGE_BUTTON_TEXTS } from '../../commands/tables/toolbars';

export const MOVE_DIALOG_ID = 'layout.move';

export const MOVE_TEXTS = {
  title: 'Move Panel',
  panel: '&Panel:',
  place: 'P&lace:',
  intoGroup: 'Into the group of',
  asTab: 'as a tab',
  beside: 'Beside',
  edge: 'At the edge of the window:',
  /** Version 1.1 (P9.2): the fourth place. */
  float: 'As a floating window',
  /** The accessible names of the lists inside the three choices. */
  intoGroupList: 'Group of',
  besideList: 'Beside panel',
  besideSide: 'Side',
  edgeSide: 'Edge',
  ok: 'OK',
  cancel: 'Cancel',
} as const;

/** The side lists: beside a panel, and the window's edges (P3.1.4). */
export const BESIDE_SIDE_LABELS = { left: 'Left', right: 'Right', above: 'Above', below: 'Below' } as const;
export const EDGE_SIDE_LABELS = { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' } as const;

/**
 * The tip of P9.3 (its text as P9.9 point 3 gives it: what can be done on the page it appears on),
 * shown once per browser profile above the Simulator's status bar.
 */
export const ARRANGE_TIP_TEXTS = {
  text: "You can rearrange this window. Press Arrange Panels to show each panel's tab; then double-click a tab to make the panel float, or drag it to dock it elsewhere. Ready-made layouts are in the View menu.",
  /** Unlocks the layout and closes the tip. */
  arrange: ARRANGE_BUTTON_TEXTS.caption,
  /** Closes the tip. */
  dismiss: 'Got it',
} as const;

/**
 * The query parameter that shows the tip in a browser driven by a test (navigator.webdriver) as it
 * is shown to a person: `?arrange-tip=1`. Without it a driven browser never sees the tip, so that
 * the checks and end-to-end tests of 1.0.0 see the window they always saw (errata M2).
 */
export const ARRANGE_TIP_PARAM = 'arrange-tip';

export { ARRANGE_BUTTON_TEXTS };
