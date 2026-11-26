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
//   dockInto(tree, mode, defaults, panel, home?, origin?) -> { tree, place }: where a floating
//                                       panel docks (version 1.1, P9.2; errata M1 7 and 11)
//   placeOf(tree, panel), insertAtPlace(tree, panel, place)   a place as Float records it, and back
//   pruneTo(tree, keep)                 the tree with only the panels of `keep`
//   withoutViewers(tree)                the tree as it is stored (viewers are never stored, P4.2)

import type { DockNode, DockParked } from '../../contracts';
import { TOOL_PANELS } from '../../state/layout';
import type { DockPlace } from './floating';
import { groupsOf, isToolPanel, isViewerId, normalizeDock, panelsOf, sameShape, type DockMode } from './model';

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

/**
 * Where a floating panel docks (version 1.1, P9.2): "back to the place it was docked at last; if
 * that group is gone, to its place in the default arrangement of P3.1.3" (errata M1 7 and 11).
 *
 *   1. `origin` (the docked tree the panel floated from, while nothing but Float and Dock changed
 *      the arrangement since): that tree with every panel taken out that is not docked now. The
 *      panel goes back exactly where it was among the panels docked now, with the share it had and
 *      at its index among tabs; when every panel of `origin` is docked again, that is `origin`.
 *   2. `home.place` (the place it was docked at last: the subtree it was beside, the side, its
 *      share; or its group and its index among the tabs), while that subtree or group exists.
 *   3. Its place in `defaults` (the mode's default arrangement) by the same rule, once every panel
 *      that is not docked now is taken out of it, so that its neighbours there are panels of `tree`.
 *   4. The parked place of P3.1.8 (`home.parked`), or insertPanel's default place.
 *
 * Returns the tree and where the panel is in it (for the announcement).
 */
export function dockInto(
  tree: DockNode,
  mode: DockMode,
  defaults: DockNode,
  panel: string,
  home: { place?: DockPlace | undefined; parked?: DockParked | undefined } = {},
  origin?: DockNode,
): { tree: DockNode; place: DockParked | undefined } {
  const present = panelsOf(tree);
  if (present.includes(panel)) return { tree, place: undefined };
  const done = (next: DockNode) => ({ tree: next, place: removePanel(next, panel).parked ?? undefined });
  if (origin) {
    const restored = fromOrigin(tree, mode, origin, panel);
    if (restored) return done(restored);
  }
  if (home.place) {
    const placed = insertAtPlace(tree, panel, home.place);
    if (placed) return done(placed);
  }
  const pruned = pruneTo(defaults, new Set([...present, panel]));
  const place = pruned && panelsOf(pruned).includes(panel) ? placeOf(pruned, panel) : null;
  if (place) {
    const placed = insertAtPlace(tree, panel, place);
    if (placed) return done(placed);
  }
  return done(insertPanel(tree, mode, panel, home.parked));
}

/** `tree` with every panel taken out that `keep` does not hold; null when nothing is left. */
export function pruneTo(tree: DockNode, keep: ReadonlySet<string>): DockNode | null {
  let pruned: DockNode | null = tree;
  for (const id of panelsOf(tree)) {
    if (pruned === null) break;
    if (!keep.has(id)) pruned = removePanel(pruned, id).tree;
  }
  return pruned;
}

/**
 * Where `panel` is in `tree` (floating.ts DockPlace): a tab of a group with other tabs, or a group
 * of its own beside its neighbour in its row or column (the one before it, else the one after it).
 * Null when it is not in the tree or is all of it.
 */
export function placeOf(tree: DockNode, panel: string): DockPlace | null {
  const visit = (node: DockNode): DockPlace | null => {
    if (node.type === 'tabs') {
      return node.panels.includes(panel) && node.panels.length > 1 ? { side: 'tab', panels: [...node.panels] } : null;
    }
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!;
      if (child.type === 'tabs' && child.panels.length === 1 && child.panels[0] === panel) {
        const before = node.children[index - 1];
        const sibling = before ?? node.children[index + 1];
        if (!sibling) return null;
        const row = node.type === 'row';
        const side = before ? (row ? 'right' : 'below') : row ? 'left' : 'above';
        const total = child.weight + sibling.weight;
        const share = total > 0 ? child.weight / total : 0.5;
        return { side, panels: panelsOf(sibling), share: Math.min(0.95, Math.max(0.05, share)) };
      }
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(tree);
}

/**
 * `tree` with `panel` at `place`: a tab at its index among the tabs of the group that holds most of
 * its old group's other panels, or a group beside the subtree that holds exactly the panels it was
 * beside. Null when no such group or subtree is in `tree`.
 */
export function insertAtPlace(tree: DockNode, panel: string, place: DockPlace): DockNode | null {
  if (place.side === 'tab') {
    const others = place.panels.filter((id) => id !== panel);
    let best: Tabs | null = null;
    let most = 0;
    for (const group of groupsOf(tree)) {
      const count = group.panels.filter((id) => others.includes(id)).length;
      if (count > most) {
        best = group;
        most = count;
      }
    }
    if (best === null) return null;
    const target = best;
    const visit = (node: DockNode): DockNode =>
      node === target
        ? { ...node, panels: withTabAt(target.panels, panel, place.panels), selected: panel }
        : node.type === 'tabs'
          ? node
          : { ...node, children: node.children.map(visit) };
    return visit(tree);
  }
  return besideSubtree(tree, new Set(place.panels), panel, place.side, place.share);
}

/**
 * `panels` with `panel` added at its place in `order` (a group's tabs as they were): after the
 * nearest tab that came before it there; with none of those, at its index there, but not after the
 * nearest one that came after it.
 */
function withTabAt(panels: readonly string[], panel: string, order: readonly string[]): string[] {
  const at = order.indexOf(panel);
  const next = [...panels];
  if (at < 0) return [...next, panel];
  for (let i = at - 1; i >= 0; i--) {
    const index = next.indexOf(order[i]!);
    if (index >= 0) {
      next.splice(index + 1, 0, panel);
      return next;
    }
  }
  let index = Math.min(at, next.length);
  for (let i = at + 1; i < order.length; i++) {
    const after = next.indexOf(order[i]!);
    if (after >= 0) {
      index = Math.min(index, after);
      break;
    }
  }
  next.splice(index, 0, panel);
  return next;
}

/**
 * Step 1 of dockInto: `origin` with every panel taken out that is not docked now, when that is
 * `tree` with `panel` (the shapes agree: nothing else changed). The viewers of `tree` are put back
 * where they are; every group keeps the tab `tree` has in front, but the group the panel docks into
 * gets the front tab it had in `origin` (the panel itself when that one is not docked; the dock then
 * brings the panel to the front as it gets the focus, without storing it). Null when the shapes do
 * not agree.
 */
function fromOrigin(tree: DockNode, mode: DockMode, origin: DockNode, panel: string): DockNode | null {
  if (!panelsOf(origin).includes(panel)) return null;
  const docked = withoutViewers(tree);
  if (docked === null) return null;
  const restored = pruneTo(origin, new Set([...panelsOf(docked), panel]));
  if (restored === null || !sameShape(removePanel(restored, panel).tree, docked)) return null;
  let next = restored;
  for (const group of groupsOf(tree)) {
    for (const viewer of group.panels.filter(isViewerId)) {
      next = insertAtPlace(next, viewer, { side: 'tab', panels: group.panels }) ?? insertPanel(next, mode, viewer);
    }
  }
  const home = groupsOf(origin).find((group) => group.panels.includes(panel));
  const visit = (node: DockNode): DockNode => {
    if (node.type !== 'tabs') return { ...node, children: node.children.map(visit) };
    if (!node.panels.includes(panel)) return node;
    return { ...node, selected: home && node.panels.includes(home.selected) ? home.selected : panel };
  };
  return visit(selectedLike(next, tree));
}

/** `next` with each group's front tab as in `before` (the group that holds `panel`, if any: `panel`). */
export function selectedLike(next: DockNode, before: DockNode, panel?: string): DockNode {
  const fronts = groupsOf(before).map((group) => group.selected);
  const visit = (node: DockNode): DockNode => {
    if (node.type !== 'tabs') return { ...node, children: node.children.map(visit) };
    if (panel !== undefined && node.panels.includes(panel)) return { ...node, selected: panel };
    const front = fronts.find((id) => node.panels.includes(id));
    return front ? { ...node, selected: front } : node;
  };
  return visit(next);
}

/**
 * Puts a group with `panel` beside the subtree of `tree` that holds exactly `panels`, taking `share`
 * of their space; null when no subtree holds exactly those panels. A run of children of one row or
 * column counts as a subtree (a column of two groups that normalizeDock merged into the column
 * around it, say).
 */
function besideSubtree(
  tree: DockNode,
  panels: ReadonlySet<string>,
  panel: string,
  side: DockParked['side'],
  share: number,
): DockNode | null {
  const horizontal = side === 'left' || side === 'right';
  const first = side === 'left' || side === 'above';
  const exactly = (own: readonly string[]) => own.length === panels.size && own.every((id) => panels.has(id));
  const beside = (node: DockNode): DockNode => {
    const mine: Tabs = { type: 'tabs', weight: node.weight * share, panels: [panel], selected: panel };
    const kept: DockNode = { ...node, weight: node.weight * (1 - share) };
    return { type: horizontal ? 'row' : 'column', weight: node.weight, children: first ? [mine, kept] : [kept, mine] };
  };
  let done = false;
  const visit = (node: DockNode): DockNode => {
    if (done) return node;
    if (exactly(panelsOf(node))) {
      done = true;
      return beside(node);
    }
    if (node.type === 'tabs') return node;
    const children = node.children;
    for (let start = 0; start < children.length && !done; start++) {
      for (let end = start + 2; end <= children.length && end - start < children.length; end++) {
        const run = children.slice(start, end);
        if (!exactly(run.flatMap(panelsOf))) continue;
        done = true;
        const weight = run.reduce((sum, child) => sum + child.weight, 0);
        const wrapped: DockNode = { type: node.type, weight, children: run };
        return { ...node, children: [...children.slice(0, start), beside(wrapped), ...children.slice(end)] };
      }
    }
    return { ...node, children: children.map(visit) };
  };
  const result = visit(tree);
  return done ? normalizeDock(result) : null;
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
