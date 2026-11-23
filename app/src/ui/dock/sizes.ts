// Sizes of the default arrangements in pixels: today's proportions (ARCHITECTURE-PLUS P3.1.3,
// P3.1.5). Owner: N1.
//
// While a mode's arrangement is the default, its splitters are today's and are sized from
// `layout.splits` exactly as the shell did before the dock (ui/shell/SplitPane.tsx, useSplit):
// the sized pane gets splitPixels(...).value px of the container, the splitter 1 px, the rest the
// rest. FlexLayout sizes the children of a row by their weights (flex-grow over a basis of 0), so
// weights given in pixels reproduce those boxes exactly. Two groups are sized by their content:
//
//   - the Registers group at the top of the left column: the panel's own height (today's
//     `e68-region--auto`; the 1 px line below it is now the splitter, which the dock makes inert);
//   - the editor's Messages group directly below the group of the Editor panel: the height of the
//     original's rule (5 px, at least 87 px, 7 px; messagesPaneHeight), which a drag of the
//     splitter above it overrides until the list changes (EditorCenter of today's shell).
//
// The tool group keeps today's arithmetic: its content was `split - 31 px` (TAB_STRIP_HEIGHT of
// SimWorkspace.tsx) below a strip that is 29 px tall (28 px tabs, 1 px border), so the group is
// `split - 2 px` tall. Changing that would move today's Output panel by 2 px.

import type { DockNode, Settings } from '../../contracts';
import { MESSAGES_OPEN_MIN, splitPixels, type SplitId } from '../../state/layout';
import { isToolPanel, needsStrip, type DockMode } from './model';

/** FlexLayout's splitter: 1 px of layout (today's kit splitter is 5 px with -2 px margins). */
export const SPLITTER_SIZE = 1;
/** A group's tab strip: 28 px of tabs and a 1 px border, as the kit's tool tabs today. */
export const STRIP_HEIGHT = 29;
/** What today's shell subtracted for the tool strip (SimWorkspace.tsx, TAB_STRIP_HEIGHT). */
export const LEGACY_TOOL_STRIP = 31;
/** Height of the Output panel's expand bar while it is collapsed (today's `.e68-simws__expand`). */
export const COLLAPSED_OUTPUT_HEIGHT = 24;
/** Space the editor keeps above the message list, whatever is dragged (EditorCenter). */
export const EDITOR_MIN_HEIGHT = 80;
/** The Registers group's height before its content has been measured. */
export const REGISTERS_FALLBACK = 120;

export interface SizeInput {
  /** The dock's box. */
  width: number;
  height: number;
  settings: Settings;
  locked: boolean;
  /** Measured height of the Registers panel's content (its region), or null. */
  registers: number | null;
  /** The Output panel is collapsed (ShellState.outputCollapsed). */
  outputCollapsed: boolean;
  /** The editor's message list height by the rule, before the limit `available - 80`. */
  messages: number;
}

const strip = (panels: readonly string[], locked: boolean) => (needsStrip(panels, locked) ? STRIP_HEIGHT : 0);
const px = (settings: Settings, id: SplitId, available: number) => splitPixels(settings, id, available).value;

/** The height the editor's message list gets in a column `available` px tall (EditorCenter). */
export function editorMessagesHeight(rule: number, available: number): number {
  const max = Math.max(MESSAGES_OPEN_MIN, available - EDITOR_MIN_HEIGHT);
  return Math.min(rule, max);
}

/** The Registers group's height: its content, plus its strip when one is shown. */
export function registersGroupHeight(input: Pick<SizeInput, 'registers' | 'locked'>): number {
  return (input.registers ?? REGISTERS_FALLBACK) + strip(['registers'], input.locked);
}

const withWeights = (node: DockNode, weights: number[]): DockNode =>
  node.type === 'tabs'
    ? node
    : {
        ...node,
        children: node.children.map((child, index) => ({
          ...child,
          weight: Math.max(0.1, weights[index] ?? child.weight),
        })),
      };

/**
 * A default tree (model.ts defaultTree) with its weights in pixels for a dock of `width` x
 * `height`. Returns the tree unchanged while the dock has no size yet.
 */
export function sizeDefaultTree(mode: DockMode, tree: DockNode, input: SizeInput): DockNode {
  const { width: w, height: h, settings } = input;
  if (w <= 0 || h <= 0 || tree.type === 'tabs') return tree;
  if (mode === 'editor') {
    const sizeCenter = (center: DockNode, height: number): DockNode => {
      if (center.type !== 'column') return center;
      // Unlocked, the Messages group shows its strip above the list (errata N1).
      const messages = editorMessagesHeight(input.messages, height) + strip(['messages'], input.locked);
      return withWeights(center, [height - SPLITTER_SIZE - messages, messages]);
    };
    if (tree.type === 'column') return sizeCenter(tree, h);
    const files = px(settings, 'editor.files', w);
    const sized = withWeights(tree, [files, w - SPLITTER_SIZE - files]);
    return sized.type === 'tabs'
      ? sized
      : { ...sized, children: [sized.children[0]!, sizeCenter(sized.children[1]!, h)] };
  }
  const sizeLeft = (left: DockNode, height: number, extra: number[] = []): DockNode => {
    // registers / listing / messages [/ tool group, narrow]: `height` is the left part's height.
    const registers = registersGroupHeight(input);
    const main = height - registers - SPLITTER_SIZE;
    const messages = px(settings, 'sim.messages', main);
    return withWeights(left, [registers, main - SPLITTER_SIZE - messages, messages, ...extra]);
  };
  if (tree.type === 'column') {
    // Narrow: the left column's height is the stored share of the window's height.
    const columns = px(settings, 'sim.columns', h);
    return sizeLeft(tree, columns, [h - SPLITTER_SIZE - columns]);
  }
  const columns = px(settings, 'sim.columns', w);
  const sized = withWeights(tree, [columns, w - SPLITTER_SIZE - columns]);
  if (sized.type === 'tabs') return sized;
  const [left, right] = sized.children;
  let rightSized = right!;
  if (right!.type === 'column') {
    const group = right!.children[1]!;
    const panels = group.type === 'tabs' ? group.panels : [];
    const tools = input.outputCollapsed
      ? h - SPLITTER_SIZE - COLLAPSED_OUTPUT_HEIGHT
      : px(settings, 'sim.tools', h) - LEGACY_TOOL_STRIP + strip(panels.length > 0 ? panels : ['memory'], input.locked);
    rightSized = withWeights(right!, [h - SPLITTER_SIZE - tools, tools]);
  }
  return { ...sized, children: [sizeLeft(left!, h), rightSized] };
}

/**
 * The fraction a drag of a default splitter stores (the inverse of sizeDefaultTree): which split
 * the moved splitter belongs to and its new fraction, or the editor message list's new height.
 * `index` is the splitter's index in its container (1 = between children 0 and 1), `sizes` the
 * children's new sizes in px, `path` the container's place in the tree ('root', 'root.1', ...).
 */
export type DefaultDrag = { split: SplitId; fraction: number } | { messages: number } | null;

export function defaultDrag(
  mode: DockMode,
  tree: DockNode,
  path: string,
  index: number,
  sizes: readonly number[],
  input: SizeInput,
): DefaultDrag {
  const { width: w, height: h } = input;
  const container =
    path === 'root'
      ? tree
      : path === 'root.1' && tree.type === 'row'
        ? tree.children[1]
        : path === 'root.0' && tree.type === 'row'
          ? tree.children[0]
          : undefined;
  if (!container || container.type === 'tabs') return null;
  if (mode === 'editor') {
    if (container.type === 'row' && index === 1 && w > 0) return { split: 'editor.files', fraction: sizes[0]! / w };
    if (container.type === 'column' && index === 1) return { messages: sizes[1]! };
    return null;
  }
  if (container.type === 'row' && index === 1 && w > 0) return { split: 'sim.columns', fraction: sizes[0]! / w };
  if (container.type === 'column') {
    const left = container.children[0]?.type === 'tabs' && container.children[0].panels[0] === 'registers';
    if (left) {
      // Splitter 1 (below Registers) is inert; 2 is the Messages panel's; 3 (narrow) the columns'.
      const registers = sizes[0]!;
      if (index === 2) {
        const main = sizes[1]! + SPLITTER_SIZE + sizes[2]!;
        return main > 0 ? { split: 'sim.messages', fraction: sizes[2]! / main } : null;
      }
      if (index === 3 && h > 0) {
        const columns = registers + SPLITTER_SIZE + sizes[1]! + SPLITTER_SIZE + sizes[2]!;
        return { split: 'sim.columns', fraction: columns / h };
      }
      return null;
    }
    if (index === 1 && h > 0 && !input.outputCollapsed) {
      const group = container.children[1];
      const panels = group?.type === 'tabs' ? group.panels : ['memory'];
      const tools = sizes[1]! + LEGACY_TOOL_STRIP - strip(panels, input.locked);
      return { split: 'sim.tools', fraction: tools / h };
    }
  }
  return null;
}

/** Whether a group holds only tool panels (the tool group of the default arrangement). */
export const isToolGroup = (node: DockNode): boolean => node.type === 'tabs' && node.panels.every(isToolPanel);

const aloneIn = (node: DockNode | undefined, panel: string): boolean =>
  node !== undefined && node.type === 'tabs' && node.panels.length === 1 && node.panels[0] === panel;

/**
 * Where the Registers group is sized by its content (P3.1.5): alone in its group at the top of the
 * left column (the column at the root, or the first column of the root row). Our path of that
 * column, or null.
 */
export function registersPlace(tree: DockNode | null): string | null {
  if (tree === null) return null;
  if (tree.type === 'column' && aloneIn(tree.children[0], 'registers')) return 'root';
  if (
    tree.type === 'row' &&
    tree.children[0]?.type === 'column' &&
    aloneIn(tree.children[0].children[0], 'registers')
  ) {
    return 'root.0';
  }
  return null;
}

/**
 * Where the editor's message list keeps the original's height rule (P3.1.5): the Messages panel
 * alone in its group directly below the group that holds the Editor panel. The column's path and
 * the Messages group's index in it, or null.
 */
export function editorMessagesPlace(tree: DockNode | null): { path: string; index: number } | null {
  const visit = (node: DockNode, path: string): { path: string; index: number } | null => {
    if (node.type === 'tabs') return null;
    if (node.type === 'column') {
      for (let index = 1; index < node.children.length; index++) {
        const above = node.children[index - 1]!;
        if (aloneIn(node.children[index], 'messages') && above.type === 'tabs' && above.panels.includes('editor')) {
          return { path, index };
        }
      }
    }
    for (const [index, child] of node.children.entries()) {
      const found = visit(child, `${path}.${index}`);
      if (found) return found;
    }
    return null;
  };
  return tree === null ? null : visit(tree, 'root');
}

/** The container at our path ('root', 'root.0', ...), or undefined. */
export function nodeAt(tree: DockNode | null, path: string): DockNode | undefined {
  if (tree === null) return undefined;
  let node: DockNode | undefined = tree;
  for (const part of path.split('.').slice(1)) {
    if (!node || node.type === 'tabs') return undefined;
    node = node.children[Number(part)];
  }
  return node;
}

/**
 * The content-sized groups of a changed arrangement (P3.1.5: the rules hold wherever the two
 * groups are in their default places): the tree with the weights of those columns set so that the
 * Registers group and the editor's Messages group get their pixel height, the other children of
 * the column keeping their shares of the rest. `heightOf(path)` is a column's height in px (null
 * while unknown).
 */
export function sizeContentGroups(
  mode: DockMode,
  tree: DockNode,
  input: SizeInput,
  heightOf: (path: string) => number | null,
): DockNode {
  const targets: { path: string; index: number; height: (column: number) => number }[] = [];
  if (mode === 'simulator') {
    const path = registersPlace(tree);
    if (path !== null) targets.push({ path, index: 0, height: () => registersGroupHeight(input) });
  } else {
    const place = editorMessagesPlace(tree);
    if (place !== null) {
      targets.push({
        ...place,
        height: (column) => editorMessagesHeight(input.messages, column) + strip(['messages'], input.locked),
      });
    }
  }
  let result = tree;
  for (const target of targets) {
    const column = nodeAt(result, target.path);
    const height = heightOf(target.path);
    if (!column || column.type === 'tabs' || height === null || height <= 0) continue;
    const n = column.children.length;
    const fixed = target.height(height);
    const rest = height - fixed - SPLITTER_SIZE * (n - 1);
    const others = column.children.reduce((sum, child, i) => (i === target.index ? sum : sum + child.weight), 0);
    const weights = column.children.map((child, i) =>
      i === target.index ? fixed : (rest * child.weight) / (others || 1),
    );
    result = replaceAt(result, target.path, withWeights(column, weights));
  }
  return result;
}

function replaceAt(tree: DockNode, path: string, replacement: DockNode): DockNode {
  const parts = path.split('.').slice(1).map(Number);
  const visit = (node: DockNode, depth: number): DockNode => {
    if (depth === parts.length) return replacement;
    if (node.type === 'tabs') return node;
    const at = parts[depth]!;
    return { ...node, children: node.children.map((child, i) => (i === at ? visit(child, depth + 1) : child)) };
  };
  return visit(tree, 0);
}
