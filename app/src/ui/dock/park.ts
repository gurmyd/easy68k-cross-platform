// Hiding and showing panels in a changed arrangement (ARCHITECTURE-PLUS P3.1.5, P3.1.8, P4.2).
// Owner: N1.
//
// Hiding a panel takes its tab out of the tree and remembers where it was (`parked`: next to which
// panel, on which side); showing it puts it back there, or at its default place when that panel is
// hidden too (P3.1.8). A group whose last panel goes disappears and its space goes to its
// neighbours. Pure functions on DockNode trees; the dock applies the result to its model.
//
//   removePanel(tree, panel)            -> { tree, parked } (tree null when nothing is left)
//   insertPanel(tree, mode, panel, parked?)   -> tree with the panel at its parked or default place
//   withoutViewers(tree)                the tree as it is stored (viewers are never stored, P4.2)

import type { DockNode, DockParked } from '../../contracts';
import { TOOL_PANELS } from '../../state/layout';
import { groupsOf, isToolPanel, isViewerId, normalizeDock, panelsOf, type DockMode } from './model';

type Tabs = Extract<DockNode, { type: 'tabs' }>;

/** The panel that stands for a subtree on the side nearest to a neighbour: its first or last group's selected tab. */
function edgePanel(node: DockNode, last: boolean): string {
  const groups = groupsOf(node);
  const group = last ? groups[groups.length - 1]! : groups[0]!;
  return group.selected;
}

/**
 * The tree without `panel`, and where it was. `parked` is null when the panel is not in the tree
 * or was the only thing in it.
 */
export function removePanel(tree: DockNode, panel: string): { tree: DockNode | null; parked: DockParked | null } {
  let parked: DockParked | null = null;
  const visit = (node: DockNode): DockNode | null => {
    if (node.type === 'tabs') {
      if (!node.panels.includes(panel)) return node;
      const panels = node.panels.filter((id) => id !== panel);
      if (panels.length === 0) return null;
      const index = node.panels.indexOf(panel);
      const selected =
        node.selected === panel ? (panels[Math.min(index, panels.length - 1)] ?? panels[0]!) : node.selected;
      parked = { near: selected, side: 'tab' };
      return { ...node, panels, selected };
    }
    const children: DockNode[] = [];
    node.children.forEach((child, index) => {
      const kept = visit(child);
      if (kept !== null) {
        children.push(kept);
        return;
      }
      // The child was the panel's group alone: remember the neighbour it was beside.
      const before = node.children[index - 1];
      const after = node.children[index + 1];
      const row = node.type === 'row';
      if (before) parked = { near: edgePanel(before, true), side: row ? 'right' : 'below' };
      else if (after) parked = { near: edgePanel(after, false), side: row ? 'left' : 'above' };
    });
    if (children.length === 0) return null;
    return { ...node, children };
  };
  const result = visit(tree);
  return { tree: result === null ? null : normalizeDock(result), parked };
}

/** Adds `panel` as the last tab of the group that holds `near`, selected. */
function intoGroup(tree: DockNode, near: string, panel: string): DockNode {
  if (tree.type === 'tabs') {
    return tree.panels.includes(near) ? { ...tree, panels: [...tree.panels, panel], selected: panel } : tree;
  }
  return { ...tree, children: tree.children.map((child) => intoGroup(child, near, panel)) };
}

/** Puts a new group with `panel` beside the group that holds `near`, sharing its space. */
function besideGroup(tree: DockNode, near: string, panel: string, side: DockParked['side']): DockNode {
  const horizontal = side === 'left' || side === 'right';
  const first = side === 'left' || side === 'above';
  const visit = (node: DockNode): DockNode => {
    if (node.type === 'tabs') {
      if (!node.panels.includes(near)) return node;
      const own: Tabs = { type: 'tabs', weight: node.weight / 2, panels: [panel], selected: panel };
      const half: Tabs = { ...node, weight: node.weight / 2 };
      return { type: horizontal ? 'row' : 'column', weight: node.weight, children: first ? [own, half] : [half, own] };
    }
    return { ...node, children: node.children.map(visit) };
  };
  // A new container of the parent's own kind is merged into the parent by normalizeDock.
  return normalizeDock(visit(tree));
}

/** Puts a group with `panel` along a whole edge of the window, about `share` of it. */
function atEdge(tree: DockNode, panel: string, side: 'left' | 'right' | 'above' | 'below', share: number): DockNode {
  const own: Tabs = { type: 'tabs', weight: 0, panels: [panel], selected: panel };
  const wanted = side === 'left' || side === 'right' ? 'row' : 'column';
  const first = side === 'left' || side === 'above';
  const total = tree.type === wanted ? tree.children.reduce((sum, child) => sum + child.weight, 0) : 100;
  own.weight = (total * share) / (1 - share);
  const rest = tree.type === wanted ? tree.children : [{ ...tree, weight: 100 }];
  return normalizeDock({ type: wanted, weight: tree.weight, children: first ? [own, ...rest] : [...rest, own] });
}

/**
 * The tree with `panel` shown: at its parked place when the panel it was next to is in the tree,
 * otherwise at its default place: the Files panel along the left edge (today's 18 %), a tool panel
 * as a tab of the group of the other tool panels or below the Output panel, a viewer as a tab of
 * the Editor panel's group. Returns the tree unchanged when the panel is in it already.
 */
export function insertPanel(tree: DockNode, mode: DockMode, panel: string, parked?: DockParked): DockNode {
  const present = panelsOf(tree);
  if (present.includes(panel)) return tree;
  if (parked && present.includes(parked.near) && parked.near !== panel) {
    return parked.side === 'tab'
      ? intoGroup(tree, parked.near, panel)
      : besideGroup(tree, parked.near, panel, parked.side);
  }
  if (isViewerId(panel) && present.includes('editor')) return intoGroup(tree, 'editor', panel);
  if (isToolPanel(panel)) {
    const other = TOOL_PANELS.find((id) => id !== panel && present.includes(id));
    if (other) return intoGroup(tree, other, panel);
    if (present.includes('output')) return besideGroup(tree, 'output', panel, 'below');
  }
  if (panel === 'files' && mode === 'editor') return atEdge(tree, panel, 'left', 0.18);
  return atEdge(tree, panel, 'right', 0.25);
}

/** The tree as it is stored: without viewers; null when nothing else is left. */
export function withoutViewers(tree: DockNode): DockNode | null {
  let result: DockNode | null = tree;
  for (const panel of panelsOf(tree).filter(isViewerId)) {
    if (result === null) break;
    result = removePanel(result, panel).tree;
  }
  return result;
}
