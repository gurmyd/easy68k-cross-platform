// The texts of the dialog `layout.move` (ARCHITECTURE-PLUS P3.1.4). Owner: N1.
//
// P3.1.4 draws the dialog with `&Panel:` and `&Place:`, two access keys on one letter; the place's
// is `P&lace:` here (docs/porting/errata/N1.md).

export const MOVE_DIALOG_ID = 'layout.move';

export const MOVE_TEXTS = {
  title: 'Move Panel',
  panel: '&Panel:',
  place: 'P&lace:',
  intoGroup: 'Into the group of',
  asTab: 'as a tab',
  beside: 'Beside',
  edge: 'At the edge of the window:',
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
