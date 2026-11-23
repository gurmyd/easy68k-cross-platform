// The Tab order and the reading order of the dock while Lock Layout is on (ARCHITECTURE-PLUS P1.2,
// P3.1.8; docs/porting/errata/N1.md entry 25). Owner: N1.
//
// FlexLayout 0.11.1 draws the groups' tab strips and the splitters in one layer (the tree of rows
// and groups) and every panel's content in a second layer after it. In the DOM, and so for Tab and
// for a screen reader, every splitter and every shown strip therefore came before all the panels'
// contents. Today's shell (before the dock) has them between the panels: Files, `Resize the Files
// panel`, the editor, `Resize the Messages panel`, the messages.
//
// With Lock Layout on, the dock gives each such element (a "block": one splitter, or one group's
// strip) a slot in the content layer, at the place today's shell has it:
//   - a group's strip: just before the content of the group's selected panel;
//   - a splitter: just after the content of the selected panel of the last group before it.
// The slot (DockSlot in DockWorkspace.tsx) is an empty, focusable element whose `aria-owns` names
// the block, so the accessibility tree has the block at the slot's place. The block's own elements
// leave the Tab order (tabindex -1); a slot that receives the focus by Tab passes it on to the
// block's first element (by Shift+Tab, its last); Tab and Shift+Tab on the block's elements go on
// from the slot. Nothing is moved in the DOM, so React and FlexLayout keep every node they own.
//
// Unlocked, nothing here applies: the design's own order holds (P3.1.8).

import type { DockNode } from '../../contracts';
import type { DockMode } from './model';
import type { SplitterPlan } from './splitters';

/** The slots of one panel: the ids of the blocks owned just before and just after its content. */
export interface PanelSlots {
  before?: string;
  after?: string;
}

export interface Relocation {
  /** Panel id -> its slots (only selected panels of their groups have any). */
  slots: Map<string, PanelSlots>;
  /** Our group path ('root.1.0') -> the id given to the group's strip. */
  strips: Map<string, string>;
  /** Splitter key ('root.1/1', as splitterPlans) -> the id given to the splitter. */
  splitters: Map<string, string>;
}

export const EMPTY_RELOCATION: Relocation = { slots: new Map(), strips: new Map(), splitters: new Map() };

/** A DOM id from a mode and one of our paths ('root.1/1' -> 'root-1_1': one id per path). */
const idOf = (mode: DockMode, kind: 'strip' | 'split', path: string) =>
  `e68-dock-${kind}-${mode}-${path.replace(/\./g, '-').replace(/\//g, '_')}`;

type Group = Extract<DockNode, { type: 'tabs' }>;

/** The last group (in reading order) of a subtree. */
function lastGroup(node: DockNode): Group {
  return node.type === 'tabs' ? node : lastGroup(node.children[node.children.length - 1]!);
}

/**
 * Where each block goes while the layout is locked. `hasStrip` says whether a group (at our path) shows its strip;
 * `plans` are the splitters' plans (an inert splitter, name null, is no block).
 */
export function relocationPlan(
  mode: DockMode,
  tree: DockNode | null,
  plans: ReadonlyMap<string, SplitterPlan>,
  hasStrip: (group: Group, path: string) => boolean,
): Relocation {
  const relocation: Relocation = { slots: new Map(), strips: new Map(), splitters: new Map() };
  if (tree === null) return relocation;
  const slotsOf = (panel: string) => {
    let slots = relocation.slots.get(panel);
    if (!slots) relocation.slots.set(panel, (slots = {}));
    return slots;
  };
  const visit = (node: DockNode, path: string) => {
    if (node.type === 'tabs') {
      if (!hasStrip(node, path)) return;
      const id = idOf(mode, 'strip', path);
      relocation.strips.set(path, id);
      slotsOf(node.selected).before = id;
      return;
    }
    node.children.forEach((child, index) => {
      if (index > 0) {
        const key = `${path}/${index}`;
        const plan = plans.get(key);
        if (plan && plan.name !== null) {
          const id = idOf(mode, 'split', key);
          relocation.splitters.set(key, id);
          slotsOf(lastGroup(node.children[index - 1]!).selected).after = id;
        }
      }
      visit(child, `${path}.${index}`);
    });
  };
  visit(tree, 'root');
  return relocation;
}

const RELOCATED = 'data-e68-relocated';

function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** The tab buttons of a strip and the one FlexLayout makes tabbable (the selected one, or the first). */
function tabsOf(strip: Element): { tabs: HTMLElement[]; tabbable: HTMLElement | undefined } {
  const tabs = Array.from(strip.querySelectorAll<HTMLElement>('.flexlayout__tab_button[role="tab"]'));
  return { tabs, tabbable: tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0] };
}

/** The toolbar buttons of a strip (FlexLayout's overflow button and the like). */
const toolbarButtonsOf = (strip: Element) =>
  Array.from(strip.querySelectorAll<HTMLElement>('.flexlayout__tab_toolbar button'));

/**
 * Applies the strips' part of a relocation to FlexLayout's strips under `root` (the splitters'
 * part is decorateSplitters'): a relocated strip has its id and leaves the Tab order; a strip that
 * is no longer relocated gets FlexLayout's own tab stops back. `flexOfPath` is the live index's.
 */
export function decorateStrips(
  root: ParentNode,
  relocation: Relocation,
  flexOfPath: ReadonlyMap<string, string>,
): void {
  const relocated = new Map<Element, string>();
  for (const [path, id] of relocation.strips) {
    const flex = flexOfPath.get(path);
    if (flex === undefined) continue;
    const strip = root.querySelector(`[data-layout-path="${flex}/tabstrip"]`);
    if (strip) relocated.set(strip, id);
  }
  for (const strip of Array.from(root.querySelectorAll('.flexlayout__tabset_tabbar_outer'))) {
    const id = relocated.get(strip);
    const { tabs, tabbable } = tabsOf(strip);
    if (id !== undefined) {
      setAttr(strip, 'id', id);
      setAttr(strip, RELOCATED, 'strip');
      for (const tab of tabs) setAttr(tab, 'tabindex', '-1');
      for (const button of toolbarButtonsOf(strip)) setAttr(button, 'tabindex', '-1');
    } else if (strip.hasAttribute(RELOCATED)) {
      setAttr(strip, RELOCATED, null);
      for (const tab of tabs) setAttr(tab, 'tabindex', tab === tabbable ? '0' : '-1');
      for (const button of toolbarButtonsOf(strip)) setAttr(button, 'tabindex', '0');
    }
  }
}

const visible = (element: HTMLElement) =>
  typeof element.checkVisibility === 'function' ? element.checkVisibility() : element.getClientRects().length > 0;

/** The tab stops of a block, in order: a splitter itself; a strip's tabbable tab, then its toolbar buttons. */
export function stopsOf(block: Element): HTMLElement[] {
  if (block.getAttribute(RELOCATED) !== 'strip') return [block as HTMLElement];
  const { tabbable } = tabsOf(block);
  return [...(tabbable ? [tabbable] : []), ...toolbarButtonsOf(block)].filter(visible);
}

/** The relocated block that holds `element`, or null. */
export function blockOf(element: Element | null): Element | null {
  return typeof element?.closest === 'function' ? element.closest(`[${RELOCATED}]`) : null;
}
