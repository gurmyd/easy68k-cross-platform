// The keys of a tree view (WAI-ARIA Authoring Practices, "Tree View"). Owner: W2.
//
// Plain arithmetic, no DOM: the caller keeps its rows (the visible items, in
// order, with their depth and whether they can be expanded), draws them with
// role=tree / treeitem, and carries out the action this returns. Written for
// the Files panel (FS1) and the help contents (H1), which each had a copy.
//
//   Up / Down        the previous / next visible row (no wrap)
//   Home / End       the first / last row
//   Right            a closed parent opens; an open one moves to its first child
//   Left             an open parent closes; otherwise to the row's parent
//   Enter / Space    a row that `activates` (default: every leaf) is activated;
//                    a parent that does not activate opens or closes
//
// With no row focused yet (`index` -1), Down, Up, Home and Right go to the first row.

export interface TreeKeyRow {
  /** Nesting level; a top-level row has the smallest depth (any start: 0 or 1). */
  depth: number;
  /** The row has children (it can be opened and closed). */
  expandable: boolean;
  /** Open (only meaningful when `expandable`). */
  expanded: boolean;
  /** Enter and Space activate it (open a file, show a page). Default: true for leaves, false for parents. */
  activates?: boolean;
}

export type TreeKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'toggle'; index: number; open: boolean }
  | { kind: 'activate'; index: number };

/** What `key` (KeyboardEvent.key) does on row `index` of `rows`; null for a key the tree does not use. */
export function treeViewKeyAction(rows: readonly TreeKeyRow[], index: number, key: string): TreeKeyAction | null {
  if (rows.length === 0) return null;
  const last = rows.length - 1;
  const move = (to: number): TreeKeyAction => ({ kind: 'move', index: Math.max(0, Math.min(last, to)) });
  const row = index >= 0 && index <= last ? rows[index] : undefined;
  switch (key) {
    case 'ArrowDown':
      return move(row ? index + 1 : 0);
    case 'ArrowUp':
      return move(row ? index - 1 : 0);
    case 'Home':
      return move(0);
    case 'End':
      return move(last);
    case 'ArrowRight': {
      if (!row) return move(0);
      if (!row.expandable) return null;
      if (!row.expanded) return { kind: 'toggle', index, open: true };
      const next = rows[index + 1];
      return next && next.depth > row.depth ? move(index + 1) : null;
    }
    case 'ArrowLeft': {
      if (!row) return null;
      if (row.expandable && row.expanded) return { kind: 'toggle', index, open: false };
      for (let i = index - 1; i >= 0; i--) if ((rows[i] as TreeKeyRow).depth < row.depth) return move(i);
      return null;
    }
    case 'Enter':
    case ' ': {
      if (!row) return null;
      if (row.activates ?? !row.expandable) return { kind: 'activate', index };
      return { kind: 'toggle', index, open: !row.expanded };
    }
    default:
      return null;
  }
}
