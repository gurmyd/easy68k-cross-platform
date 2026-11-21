// The Help panel's contents tree as rows: which nodes are open, what the filter keeps, which row
// shows the current page. Pure functions over `SitemapNode`. Owner: H1.

import type { HelpTarget, SitemapNode } from './sitemap';

/** A node's address in the tree: the child indexes from the root, "0", "2/1", ... */
export type NodeKey = string;

export interface TreeRow {
  key: NodeKey;
  node: SitemapNode;
  depth: number;
  /** True for a node with children. */
  isBook: boolean;
  /** Open books show their children. While a filter is active every book that has a match is open. */
  expanded: boolean;
}

/** Whether `title` contains every word of `filter`, ignoring letter case. */
export function titleMatches(title: string, filter: string): boolean {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const text = title.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** True if the node or any node below it has a title that matches. */
function hasMatch(node: SitemapNode, filter: string): boolean {
  return titleMatches(node.name, filter) || node.children.some((child) => hasMatch(child, filter));
}

/**
 * The rows to draw. Without a filter: the nodes below open books. With a filter: the nodes whose
 * title matches, with the books on the way to them (open), and the whole subtree of a book whose
 * own title matches.
 */
export function visibleRows(tree: readonly SitemapNode[], open: ReadonlySet<NodeKey>, filter: string): TreeRow[] {
  const filtering = filter.trim() !== '';
  const rows: TreeRow[] = [];
  const walk = (nodes: readonly SitemapNode[], prefix: string, depth: number, parentMatches: boolean): void => {
    nodes.forEach((node, index) => {
      const key = prefix === '' ? String(index) : `${prefix}/${index}`;
      const selfMatches = !filtering || parentMatches || titleMatches(node.name, filter);
      if (filtering && !selfMatches && !hasMatch(node, filter)) return;
      const isBook = node.children.length > 0;
      const expanded = isBook && (filtering ? true : open.has(key));
      rows.push({ key, node, depth, isBook, expanded });
      if (expanded) walk(node.children, key, depth + 1, filtering && selfMatches);
    });
  };
  walk(tree, '', 0, false);
  return rows;
}

/** The keys of the books on the way to `key` (not including it). */
export function ancestorKeys(key: NodeKey): NodeKey[] {
  const parts = key.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** The first node of the tree (in document order) that leads to `page`, or null. */
export function findPage(tree: readonly SitemapNode[], page: string): NodeKey | null {
  const wanted = page.toLowerCase();
  const walk = (nodes: readonly SitemapNode[], prefix: string): NodeKey | null => {
    for (const [index, node] of nodes.entries()) {
      const key = prefix === '' ? String(index) : `${prefix}/${index}`;
      if (node.target !== null && node.target.page.toLowerCase() === wanted) return key;
      const inner = walk(node.children, key);
      if (inner !== null) return inner;
    }
    return null;
  };
  return walk(tree, '');
}

/** The node at `key`. */
export function nodeAt(tree: readonly SitemapNode[], key: NodeKey): SitemapNode | null {
  let nodes: readonly SitemapNode[] = tree;
  let found: SitemapNode | null = null;
  for (const part of key.split('/')) {
    found = nodes[Number(part)] ?? null;
    if (found === null) return null;
    nodes = found.children;
  }
  return found;
}

/** The title the contents gives a page, or null when it is not listed. */
export function titleOfPage(tree: readonly SitemapNode[], target: HelpTarget): string | null {
  const key = findPage(tree, target.page);
  return key === null ? null : (nodeAt(tree, key)?.name ?? null);
}

/** What a key does in the tree (the keyboard model of an ARIA tree). */
export type TreeKeyAction =
  | { kind: 'focus'; key: NodeKey }
  | { kind: 'toggle'; key: NodeKey; open: boolean }
  | { kind: 'activate'; key: NodeKey }
  | null;

/** The action of `press` (a KeyboardEvent.key) with the row `key` focused, or null if the key is not the tree's. */
export function treeKeyAction(rows: readonly TreeRow[], key: NodeKey, press: string): TreeKeyAction {
  const at = rows.findIndex((row) => row.key === key);
  const row = rows[at];
  if (!row) return null;
  const focus = (index: number): TreeKeyAction => {
    const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
    return target ? { kind: 'focus', key: target.key } : null;
  };
  switch (press) {
    case 'ArrowDown':
      return focus(at + 1);
    case 'ArrowUp':
      return focus(at - 1);
    case 'Home':
      return focus(0);
    case 'End':
      return focus(rows.length - 1);
    case 'ArrowRight':
      if (row.isBook && !row.expanded) return { kind: 'toggle', key, open: true };
      return row.isBook && rows[at + 1] && rows[at + 1]!.depth > row.depth ? focus(at + 1) : null;
    case 'ArrowLeft': {
      if (row.isBook && row.expanded) return { kind: 'toggle', key, open: false };
      for (let i = at - 1; i >= 0; i--) if (rows[i]!.depth < row.depth) return focus(i);
      return null;
    }
    case 'Enter':
    case ' ':
      return { kind: 'activate', key };
    default:
      return null;
  }
}
