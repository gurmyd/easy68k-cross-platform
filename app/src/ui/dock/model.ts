// The dock's model: our stored arrangement (DockNode, P4.2) and FlexLayout's JSON model, and the
// model options of ARCHITECTURE-PLUS P2.2. Owner: N1.
//
// The stored format is our own, so that a change of the docking library never loses a student's
// layout (R1). A DockNode tree alternates rows and columns; FlexLayout's rows alternate their
// orientation by depth (the root row lays out horizontally), so a tree whose root is a column is
// given to FlexLayout as a root row with that column as its only child, and read back the same way.
//
//   toFlexJson(tree, options)     DockNode -> IJsonModel (global attributes, tab and group attributes)
//   fromFlexJson(json)            FlexLayout's layout JSON -> DockNode (also of a live model's toJson())
//   normalizeDock(tree)           one child per container is lifted, a container in a container of
//                                 the same kind is merged into it (FlexLayout cannot show either)
//   defaultTree(mode, ...)        today's arrangement of a mode, by the visible panels (P3.1.3)
//   needsStrip(panels, locked)    whether a group shows its tab strip (P3.1.4)
//
// Tab ids are `<mode>:<panel>` (`editor:files`, `simulator:messages`, `editor:viewer:3`), because
// FlexLayout gives each tab button and tab panel a DOM id made from the tab id and both docks are
// in one page.

import type {
  IGlobalAttributes,
  IJsonModel,
  IJsonRowNode,
  IJsonTabNode,
  IJsonTabSetNode,
  IKeyMap,
} from 'flexlayout-react';
import type { DockNode } from '../../contracts';
import { TOOL_PANELS } from '../../state/layout';
import type { DockMode } from '../../state/dock';
import { TOOL_GROUP_LABEL } from './texts';

export type { DockMode };

/** The panels of each mode's dock (P3.1.2), in the order of the default arrangement. */
export const DOCK_PANELS: Record<DockMode, readonly string[]> = {
  editor: ['files', 'editor', 'messages'],
  simulator: ['registers', 'listing', 'messages', 'output', ...TOOL_PANELS],
};

/** Panels that cannot be closed: every stored tree of the mode must hold them (P4.2). */
export const FIXED_PANELS: Record<DockMode, readonly string[]> = {
  editor: ['editor', 'messages'],
  simulator: ['registers', 'listing', 'messages', 'output'],
};

const TOOLS: readonly string[] = TOOL_PANELS;

export const isViewerId = (id: string): boolean => /^viewer:\d+$/.test(id);
export const isToolPanel = (id: string): boolean => TOOLS.includes(id);

/** P2.2: `enableClose: true` only for `files`, the tool panels and viewers. */
export function isClosablePanel(id: string): boolean {
  return id === 'files' || isToolPanel(id) || isViewerId(id);
}

/** Whether `id` is a panel of `mode`'s dock (viewers only in Editor mode). */
export function isPanelOf(mode: DockMode, id: string): boolean {
  return DOCK_PANELS[mode].includes(id) || (mode === 'editor' && isViewerId(id));
}

export function tabIdOf(mode: DockMode, panel: string): string {
  return `${mode}:${panel}`;
}

/** The panel id of a tab id, or null for a tab that is not one of ours. */
export function panelOfTab(tabId: string): string | null {
  const at = tabId.indexOf(':');
  if (at < 0) return null;
  const mode = tabId.slice(0, at);
  return mode === 'editor' || mode === 'simulator' ? tabId.slice(at + 1) : null;
}

/**
 * The global attributes of the model (P2.2, one row each in model.test.ts). Locked: no tab and no
 * group can be dragged. Three attributes differ from P2.2's list or are added; each is in
 * docs/porting/errata/N1.md:
 *   tabSetEnableClose: true, because FlexLayout 0.11.1 deletes an empty group only when the group
 *     "can be closed" (RowNode.tidy); no group shows a close button (tabSetEnableCloseButton) and
 *     onAction refuses DELETE_TABSET of a group that holds a panel, which is what P2.2 wanted;
 *   tabEnableScrollbars: false (each panel scrolls inside itself, as in today's regions);
 *   tabCloseType: Always (2), so a tab's x closes it also when the tab is not selected, as the
 *     kit's tool tabs do today.
 */
export function globalAttributes(locked: boolean): IGlobalAttributes {
  return {
    tabEnableRenderOnDemand: false,
    tabEnablePopout: false,
    tabEnablePopoutIcon: false,
    tabEnableFloat: false,
    tabEnableFloatIcon: false,
    tabEnableRename: false,
    tabEnablePin: false,
    tabEnableScrollbars: false,
    tabCloseType: 2,
    tabEnableDrag: !locked,
    tabSetEnableMaximize: false,
    tabSetEnableClose: true,
    tabSetEnableTabGroups: false,
    tabSetEnableActiveIcon: false,
    tabSetEnableCloseButton: false,
    tabSetEnableDeleteWhenEmpty: true,
    tabSetEnableSingleTabStretch: false,
    tabSetEnableDrag: !locked,
    enableEdgeDock: true,
  };
}

/**
 * The key map (P2.2): only `closeTab` is bound, to Delete; every other binding is passed as
 * undefined explicitly, because FlexLayout merges the given map over its defaultKeyMap
 * (`closeTab: 'Ctrl+Delete'`, `renameTab: 'F2'`, `closeOverlayBorder: 'Escape'`). The same on both
 * key maps.
 */
export const DOCK_KEY_MAP: { [K in keyof Required<IKeyMap>]: string | undefined } = {
  closeTab: 'Delete',
  renameTab: undefined,
  focusTabToggle: undefined,
  focusNextTabset: undefined,
  focusPreviousTabset: undefined,
  closeOverlayBorder: undefined,
};

/**
 * Whether a group shows its tab strip (P3.1.4). Unlocked: always. Locked: only where today's
 * layout shows one: more than one panel, a tool panel (its strip carries the x), or a viewer.
 */
export function needsStrip(panels: readonly string[], locked: boolean): boolean {
  if (!locked) return true;
  return panels.length > 1 || panels.some((id) => isToolPanel(id) || isViewerId(id));
}

/**
 * The accessible name of a group's tab list: today's `Tool panels` for the group of the tool panels,
 * and, in the simulator's narrow default (`narrowOutputStrip`), for the Output panel's group even
 * when no tool panel is shown: today that strip is the tool strip, with Output as its first tab.
 */
export function groupLabel(panels: readonly string[], narrowOutputStrip = false): string | undefined {
  if (panels.some(isToolPanel)) return TOOL_GROUP_LABEL;
  return narrowOutputStrip && panels.includes('output') ? TOOL_GROUP_LABEL : undefined;
}

export interface FlexJsonOptions {
  mode: DockMode;
  locked: boolean;
  /** The tab's title (the PanelSpec's title, or a viewer's name). */
  title(panel: string): string;
  /** A viewer's tool-tip (its place text, P3.4.2). */
  tooltip?(panel: string): string | undefined;
  /** Whether a group shows its strip; default needsStrip(panels, locked). */
  strip?(panels: readonly string[]): boolean;
}

/** A tab of FlexLayout's JSON for a panel. */
export function tabJson(panel: string, options: FlexJsonOptions): IJsonTabNode {
  const tooltip = options.tooltip?.(panel);
  return {
    type: 'tab',
    id: tabIdOf(options.mode, panel),
    name: options.title(panel),
    component: panel,
    enableClose: isClosablePanel(panel),
    ...(tooltip !== undefined ? { helpText: tooltip } : {}),
  };
}

/** The attributes of a group that follow from its panels and the lock. (The tab list's name is
 *  set on the element by the dock, splitters.ts, so that it follows moves without an action.) */
export function tabSetAttributes(panels: readonly string[], locked: boolean): { enableTabStrip: boolean } {
  return { enableTabStrip: needsStrip(panels, locked) };
}

function tabSetJson(node: Extract<DockNode, { type: 'tabs' }>, options: FlexJsonOptions): IJsonTabSetNode {
  const selected = Math.max(0, node.panels.indexOf(node.selected));
  return {
    type: 'tabset',
    id: `${options.mode}:group:${node.panels[0] ?? 'empty'}`,
    weight: node.weight,
    selected,
    enableTabStrip: options.strip ? options.strip(node.panels) : needsStrip(node.panels, options.locked),
    children: node.panels.map((panel) => tabJson(panel, options)),
  };
}

function rowJson(node: DockNode, options: FlexJsonOptions, path: string): IJsonRowNode | IJsonTabSetNode {
  if (node.type === 'tabs') return tabSetJson(node, options);
  return {
    type: 'row',
    id: `${options.mode}:${path}`,
    weight: node.weight,
    children: node.children.map((child, index) => rowJson(child, options, `${path}.${index}`)),
  };
}

/** FlexLayout's model JSON for a (normalized) tree. */
export function toFlexJson(tree: DockNode, options: FlexJsonOptions): IJsonModel {
  let layout: IJsonRowNode;
  if (tree.type === 'row') {
    layout = rowJson(tree, options, 'root') as IJsonRowNode;
  } else {
    // A column (or a single group) at the root: a root row holding it, so that it lays out vertically.
    layout = { type: 'row', id: `${options.mode}:root`, weight: 100, children: [rowJson(tree, options, 'root.0')] };
  }
  return { global: globalAttributes(options.locked), borders: [], layout };
}

interface JsonNodeLike {
  type?: string;
  id?: string;
  weight?: number;
  selected?: number;
  children?: JsonNodeLike[];
  component?: string;
}

function panelOfJsonTab(tab: JsonNodeLike): string | null {
  if (typeof tab.id === 'string') {
    const panel = panelOfTab(tab.id);
    if (panel !== null) return panel;
  }
  return typeof tab.component === 'string' ? tab.component : null;
}

function nodeFromJson(json: JsonNodeLike, column: boolean): DockNode | null {
  const weight = typeof json.weight === 'number' && json.weight > 0 ? json.weight : 100;
  if (json.type === 'tabset') {
    const panels = (json.children ?? []).flatMap((child) => {
      const panel = panelOfJsonTab(child);
      return panel === null ? [] : [panel];
    });
    if (panels.length === 0) return null;
    const index = typeof json.selected === 'number' ? json.selected : 0;
    return { type: 'tabs', weight, panels, selected: panels[index] ?? panels[0]! };
  }
  const children = (json.children ?? []).flatMap((child) => {
    const node = nodeFromJson(child, !column);
    return node === null ? [] : [node];
  });
  if (children.length === 0) return null;
  return { type: column ? 'column' : 'row', weight, children };
}

/** The tree of FlexLayout's layout JSON (`model.toJson().layout`), normalized; null when empty. */
export function fromFlexJson(layout: IJsonRowNode): DockNode | null {
  const root = layout as JsonNodeLike;
  // A root row with one child holds our root (a column or a single group), with its own weight.
  const only = root.children?.length === 1 ? root.children[0]! : undefined;
  const node = only ? nodeFromJson(only, true) : nodeFromJson(root, false);
  return node === null ? null : normalizeDock(node);
}

/**
 * The same tree in the one form FlexLayout can show: a container with one child is replaced by
 * the child (which takes its weight), and a child container of the parent's own kind is merged
 * into the parent (its children's weights scaled to the child's share).
 */
export function normalizeDock(node: DockNode): DockNode {
  if (node.type === 'tabs') return node;
  const children: DockNode[] = [];
  for (const raw of node.children) {
    const child = normalizeDock(raw);
    if (child.type === node.type) {
      const total = child.children.reduce((sum, grandchild) => sum + grandchild.weight, 0);
      for (const grandchild of child.children) {
        children.push({ ...grandchild, weight: total > 0 ? (child.weight * grandchild.weight) / total : child.weight });
      }
    } else {
      children.push(child);
    }
  }
  if (children.length === 1) return { ...children[0]!, weight: node.weight };
  return { ...node, children };
}

/** Every panel of a tree, in reading order (depth first: rows left to right, columns top to bottom). */
export function panelsOf(tree: DockNode | null): string[] {
  if (tree === null) return [];
  if (tree.type === 'tabs') return [...tree.panels];
  return tree.children.flatMap(panelsOf);
}

/** The groups of a tree in reading order. */
export function groupsOf(tree: DockNode | null): Extract<DockNode, { type: 'tabs' }>[] {
  if (tree === null) return [];
  if (tree.type === 'tabs') return [tree];
  return tree.children.flatMap(groupsOf);
}

const tabs = (panels: string[], weight = 100, selected = panels[0]!): DockNode => ({
  type: 'tabs',
  weight,
  panels,
  selected,
});

export interface DefaultTreeInput {
  /** Whether a panel is visible (layout.panels; the Output panel is always in the tree). */
  visible(panel: string): boolean;
  /** Simulator mode below 1100 px of window width (P3.1.3). */
  narrow: boolean;
  /** The tool panel in front (ShellState.activeTool), and whether the Output tab is in front of
   *  the tool group in the narrow arrangement (ShellState.outputInFront). */
  activeTool?: string | null;
  outputInFront?: boolean;
}

/**
 * Today's arrangement of a mode with the visible panels, its weights 100 each (the dock sizes the
 * default arrangement in pixels, sizes.ts):
 *   Editor:              row [ files | column [ editor / messages ] ]   (files hidden: the column)
 *   Simulator, wide:     row [ column [ registers / listing / messages ] | column [ output / tools ] ]
 *   Simulator, narrow:   column [ registers / listing / messages / tabs [ output, tools ] ]
 * The tool group holds the visible tool panels in tab order, the one in front selected.
 */
export function defaultTree(mode: DockMode, input: DefaultTreeInput): DockNode {
  if (mode === 'editor') {
    const center: DockNode = { type: 'column', weight: 100, children: [tabs(['editor']), tabs(['messages'])] };
    return input.visible('files') ? { type: 'row', weight: 100, children: [tabs(['files']), center] } : center;
  }
  const tools = TOOLS.filter((id) => input.visible(id));
  const front = input.activeTool && tools.includes(input.activeTool) ? input.activeTool : tools[0];
  const left = [tabs(['registers']), tabs(['listing']), tabs(['messages'])];
  if (input.narrow) {
    const group = ['output', ...tools];
    const selected = input.outputInFront || front === undefined ? 'output' : front;
    return { type: 'column', weight: 100, children: [...left, tabs(group, 100, selected)] };
  }
  const right: DockNode =
    tools.length > 0 && front !== undefined
      ? { type: 'column', weight: 100, children: [tabs(['output']), tabs(tools, 100, front)] }
      : tabs(['output']);
  return { type: 'row', weight: 100, children: [{ type: 'column', weight: 100, children: left }, right] };
}

/** The same structure (types and panels, not weights or the selected tab). */
export function sameShape(a: DockNode | null, b: DockNode | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'tabs' && b.type === 'tabs') {
    return a.panels.length === b.panels.length && a.panels.every((panel, index) => panel === b.panels[index]);
  }
  if (a.type === 'tabs' || b.type === 'tabs') return false;
  return (
    a.children.length === b.children.length && a.children.every((child, index) => sameShape(child, b.children[index]!))
  );
}
