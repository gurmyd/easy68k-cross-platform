// Reading a live FlexLayout model as our tree (ARCHITECTURE-PLUS P4.2). Owner: N1.
//
// The dock's model is FlexLayout's; whenever the dock needs to reason about the arrangement (the
// stored tree, the sizes, the splitter names, the reading order) it reads the model as a DockNode
// tree together with the places of both: our paths ('root', 'root.0', 'root.0.2': the child
// indexes from the root) and FlexLayout's paths ('', '/r0', '/r0/ts2'; a splitter of a row is the
// row's path + '/s<n>', n from 0).
//
// FlexLayout's root row lays out horizontally; a root row with a single child holds our root
// (a column or a single group), as model.ts toFlexJson builds it.

import { RowNode, TabNode, TabSetNode, type Model, type Node } from 'flexlayout-react';
import type { DockNode } from '../../contracts';
import { panelOfTab } from './model';

export interface LiveIndex {
  /** The arrangement, viewers included; null for an empty model. */
  tree: DockNode | null;
  /** Our path of each container and group -> its FlexLayout node. */
  nodes: Map<string, RowNode | TabSetNode>;
  /** FlexLayout's path of each row -> our path. */
  pathOfFlex: Map<string, string>;
  /** Our path of each FlexLayout node id. */
  pathOfId: Map<string, string>;
  /** The FlexLayout path of each of our container paths. */
  flexOfPath: Map<string, string>;
}

function weightOf(node: Node): number {
  const weight = (node as RowNode | TabSetNode).getWeight();
  return typeof weight === 'number' && weight > 0 ? weight : 100;
}

export function indexModel(model: Model): LiveIndex {
  const index: LiveIndex = {
    tree: null,
    nodes: new Map(),
    pathOfFlex: new Map(),
    pathOfId: new Map(),
    flexOfPath: new Map(),
  };
  const visit = (node: Node, path: string, flexPath: string, column: boolean): DockNode | null => {
    if (node instanceof TabSetNode) {
      const panels = node.getChildren().flatMap((child) => {
        const panel = child instanceof TabNode ? panelOfTab(child.getId()) : null;
        return panel === null ? [] : [panel];
      });
      if (panels.length === 0) return null;
      const selectedNode = node.getSelectedNode();
      const selected = selectedNode ? panelOfTab(selectedNode.getId()) : null;
      index.nodes.set(path, node);
      index.pathOfId.set(node.getId(), path);
      index.flexOfPath.set(path, flexPath);
      return {
        type: 'tabs',
        weight: weightOf(node),
        panels,
        selected: selected && panels.includes(selected) ? selected : panels[0]!,
      };
    }
    if (!(node instanceof RowNode)) return null;
    index.nodes.set(path, node);
    index.pathOfId.set(node.getId(), path);
    index.pathOfFlex.set(flexPath, path);
    index.flexOfPath.set(path, flexPath);
    const children: DockNode[] = [];
    node.getChildren().forEach((child, i) => {
      const childFlex = `${flexPath}${child instanceof RowNode ? '/r' : '/ts'}${i}`;
      const converted = visit(child, `${path}.${children.length}`, childFlex, !column);
      if (converted) children.push(converted);
    });
    if (children.length === 0) return null;
    return { type: column ? 'column' : 'row', weight: weightOf(node), children };
  };
  const root = model.getRootRow();
  if (!root) return index;
  const only = root.getChildren().length === 1 ? root.getChildren()[0] : undefined;
  if (only) {
    // Our root is the root row's only child: a column, or a single group.
    index.pathOfFlex.set('', 'wrapper');
    index.tree = visit(only, 'root', only instanceof RowNode ? '/r0' : '/ts0', true);
    if (index.tree && index.tree.type !== 'tabs') index.tree = { ...index.tree, weight: weightOf(only) };
  } else {
    index.tree = visit(root, 'root', '', false);
  }
  return index;
}

/** Every tab id of a model in reading order (depth first: rows left to right, columns top to bottom). */
export function tabIdsInReadingOrder(model: Model): string[] {
  const ids: string[] = [];
  const visit = (node: Node) => {
    if (node instanceof TabSetNode) {
      for (const child of node.getChildren()) if (child instanceof TabNode) ids.push(child.getId());
      return;
    }
    for (const child of node.getChildren()) visit(child);
  };
  const root = model.getRootRow();
  if (root) visit(root);
  return ids;
}
