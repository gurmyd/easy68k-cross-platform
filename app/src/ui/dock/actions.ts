// The moves of ARCHITECTURE-PLUS P3.1.4 as FlexLayout actions. Owner: N1.
//
// Every move a menu command or the tab menu makes is one action on the live model, the same
// action a drag makes (P2.2): Actions.moveNode with the target node and a DockLocation.
//
//   moveAction(model, mode, panel, target)     Move Panel To... (into a group, beside a panel, to
//                                              an edge of the window)
//   stepAction(model, mode, panel, direction, rects)   the tab menu's Move Left/Right/Up/Down: beside
//                                              the neighbouring group in that direction, or to the
//                                              window edge when there is none
//   tabOrderAction(model, mode, panel, delta)  Move Tab Earlier (-1) / Later (+1) within its group;
//                                              null at the first and the last place and in a group
//                                              of one panel (the menu item is then disabled)
//
// Each returns the action with what the live region announces (texts.ts ANNOUNCE).

import {
  Actions,
  DockLocation,
  RowNode,
  TabNode,
  TabSetNode,
  type Action,
  type Model,
  type Node,
} from 'flexlayout-react';
import type { DockMoveTarget } from '../../state/dock';
import { panelOfTab, tabIdOf, type DockMode } from './model';
import { ANNOUNCE, type BesideSide, type EdgeSide } from './texts';

export interface PlannedMove {
  action: Action;
  /** What the live region says once the move is made. */
  announce: string;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

const BESIDE: Record<BesideSide, DockLocation> = {
  left: DockLocation.LEFT,
  right: DockLocation.RIGHT,
  above: DockLocation.TOP,
  below: DockLocation.BOTTOM,
};
const EDGE: Record<EdgeSide, DockLocation> = {
  left: DockLocation.LEFT,
  right: DockLocation.RIGHT,
  top: DockLocation.TOP,
  bottom: DockLocation.BOTTOM,
};

export const BESIDE_SIDES = Object.keys(BESIDE) as BesideSide[];
export const EDGE_SIDES = Object.keys(EDGE) as EdgeSide[];

/** The tab node of a panel, or undefined. */
export function tabNodeOf(model: Model, mode: DockMode, panel: string): TabNode | undefined {
  const node = model.getNodeById(tabIdOf(mode, panel));
  return node instanceof TabNode ? node : undefined;
}

/** The group (tabset) that holds a panel, or undefined. */
export function groupOf(model: Model, mode: DockMode, panel: string): TabSetNode | undefined {
  const parent = tabNodeOf(model, mode, panel)?.getParent();
  return parent instanceof TabSetNode ? parent : undefined;
}

/** The panels of a group, in tab order. */
export function panelsOfGroup(group: TabSetNode): string[] {
  return group.getChildren().flatMap((child) => {
    const panel = child instanceof TabNode ? panelOfTab(child.getId()) : null;
    return panel === null ? [] : [panel];
  });
}

/**
 * The move of `Move Panel To...` (P3.1.4). `title` names a panel for the announcement. Null when
 * the target does not exist (a panel that is not in the dock).
 */
export function moveAction(
  model: Model,
  mode: DockMode,
  panel: string,
  target: DockMoveTarget,
  title: (panel: string) => string,
): PlannedMove | null {
  const tab = tabNodeOf(model, mode, panel);
  if (!tab) return null;
  const tabId = tab.getId();
  if (target.kind === 'edge') {
    const side = (target.side ?? 'left') as EdgeSide;
    const location = EDGE[side];
    const root = model.getRootRow();
    if (!location || !root) return null;
    return {
      action: Actions.moveNode(tabId, root.getId(), location, -1, true),
      announce: ANNOUNCE.edge(title(panel), side),
    };
  }
  const near = target.near;
  if (near === undefined) return null;
  const group = groupOf(model, mode, near);
  if (!group) return null;
  if (target.kind === 'tab') {
    return {
      action: Actions.moveNode(tabId, group.getId(), DockLocation.CENTER, -1, true),
      announce: ANNOUNCE.intoGroup(title(panel), title(near)),
    };
  }
  const side = (target.side ?? 'left') as BesideSide;
  const location = BESIDE[side];
  if (!location) return null;
  return {
    action: Actions.moveNode(tabId, group.getId(), location, -1, true),
    announce: ANNOUNCE.beside(title(panel), title(near), side),
  };
}

/** Move Tab Earlier (delta -1) and Move Tab Later (+1); null where the item is disabled. */
export function tabOrderAction(
  model: Model,
  mode: DockMode,
  panel: string,
  delta: -1 | 1,
  title: (panel: string) => string,
): PlannedMove | null {
  const tab = tabNodeOf(model, mode, panel);
  const group = groupOf(model, mode, panel);
  if (!tab || !group) return null;
  const children = group.getChildren();
  const from = children.indexOf(tab);
  const to = from + delta;
  if (children.length < 2 || to < 0 || to >= children.length) return null;
  // FlexLayout takes the index before the tab is taken out of the strip: one more when moving later.
  const index = delta > 0 ? to + 1 : to;
  return {
    action: Actions.moveNode(tab.getId(), group.getId(), DockLocation.CENTER, index, true),
    announce: ANNOUNCE.position(title(panel), to + 1),
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangles of the groups of a model laid out in `width` x `height` with 1 px splitters, from
 * the weights alone (as FlexLayout lays them out). The tab menu's one-step moves use the live
 * rectangles where FlexLayout has measured them; this is the same computation without a page.
 */
export function layoutRects(model: Model, width: number, height: number, splitter = 1): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const visit = (node: Node, rect: Rect, horizontal: boolean) => {
    if (node instanceof TabSetNode) {
      out.set(node.getId(), rect);
      return;
    }
    if (!(node instanceof RowNode)) return;
    const children = node.getChildren();
    const total = children.reduce((sum, child) => sum + ((child as RowNode | TabSetNode).getWeight?.() ?? 100), 0);
    const length = (horizontal ? rect.width : rect.height) - splitter * (children.length - 1);
    let at = horizontal ? rect.x : rect.y;
    for (const child of children) {
      const size = (length * ((child as RowNode | TabSetNode).getWeight?.() ?? 100)) / (total || 1);
      const childRect = horizontal
        ? { x: at, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: at, width: rect.width, height: size };
      visit(child, childRect, !horizontal);
      at += size + splitter;
    }
  };
  const root = model.getRootRow();
  if (root) visit(root, { x: 0, y: 0, width, height }, true);
  return out;
}

/** The live rectangles FlexLayout measured (empty before the first layout). */
export function liveRects(model: Model): Map<string, Rect> {
  const out = new Map<string, Rect>();
  model.visitNodes((node) => {
    if (node instanceof TabSetNode) {
      const rect = node.getRect();
      if (rect.width > 0 && rect.height > 0)
        out.set(node.getId(), { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
  });
  return out;
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * The group next to `from` in `direction`: the nearest group on that side whose extent overlaps
 * it across the direction (the most overlap first, then the top or left one), or undefined.
 */
export function neighbourGroup(rects: Map<string, Rect>, from: string, direction: Direction): string | undefined {
  const own = rects.get(from);
  if (!own) return undefined;
  const slack = 2;
  let best: { id: string; distance: number; overlap: number; across: number } | undefined;
  for (const [id, rect] of rects) {
    if (id === from) continue;
    let distance: number;
    let shared: number;
    let across: number;
    switch (direction) {
      case 'left':
        if (rect.x + rect.width > own.x + slack) continue;
        distance = own.x - (rect.x + rect.width);
        shared = overlap(own.y, own.y + own.height, rect.y, rect.y + rect.height);
        across = rect.y;
        break;
      case 'right':
        if (rect.x < own.x + own.width - slack) continue;
        distance = rect.x - (own.x + own.width);
        shared = overlap(own.y, own.y + own.height, rect.y, rect.y + rect.height);
        across = rect.y;
        break;
      case 'up':
        if (rect.y + rect.height > own.y + slack) continue;
        distance = own.y - (rect.y + rect.height);
        shared = overlap(own.x, own.x + own.width, rect.x, rect.x + rect.width);
        across = rect.x;
        break;
      case 'down':
        if (rect.y < own.y + own.height - slack) continue;
        distance = rect.y - (own.y + own.height);
        shared = overlap(own.x, own.x + own.width, rect.x, rect.x + rect.width);
        across = rect.x;
        break;
    }
    if (shared <= 0) continue;
    const better =
      !best ||
      distance < best.distance - 0.5 ||
      (Math.abs(distance - best.distance) <= 0.5 &&
        (shared > best.overlap + 0.5 || (Math.abs(shared - best.overlap) <= 0.5 && across < best.across)));
    if (better) best = { id, distance, overlap: shared, across };
  }
  return best?.id;
}

const STEP_BESIDE: Record<Direction, BesideSide> = { left: 'left', right: 'right', up: 'above', down: 'below' };
const STEP_EDGE: Record<Direction, EdgeSide> = { left: 'left', right: 'right', up: 'top', down: 'bottom' };

/**
 * The tab menu's Move Left/Right/Up/Down (P3.1.4): one step, beside the neighbouring group in that
 * direction (on that side of it), or to the window edge when there is none.
 */
export function stepAction(
  model: Model,
  mode: DockMode,
  panel: string,
  direction: Direction,
  rects: Map<string, Rect>,
  title: (panel: string) => string,
): PlannedMove | null {
  const group = groupOf(model, mode, panel);
  if (!group) return null;
  const neighbour = neighbourGroup(rects, group.getId(), direction);
  const node = neighbour === undefined ? undefined : model.getNodeById(neighbour);
  if (node instanceof TabSetNode) {
    const near = panelOfTab(node.getSelectedNode()?.getId() ?? node.getChildren()[0]?.getId() ?? '');
    if (near !== null)
      return moveAction(model, mode, panel, { kind: 'beside', near, side: STEP_BESIDE[direction] }, title);
  }
  return moveAction(model, mode, panel, { kind: 'edge', side: STEP_EDGE[direction] }, title);
}
