// The names of the dock's splitters (ARCHITECTURE-PLUS P2.2) and the DOM touches the dock makes
// on FlexLayout's elements after each layout change. Owner: N1.
//
// FlexLayout 0.11.x gives every splitter one label (`I18nLabel.Splitter`, which the dock maps to
// `Resize`) and sets aria-valuetext itself. In the default arrangement the dock names them as
// today (`Resize the Files panel`, `Resize the Messages panel`, `Resize the two columns`,
// `Resize the tool panels`); elsewhere `Resize <panel> and <panel>` (the selected tabs on its two
// sides). React does not rewrite an attribute whose prop did not change, so a name set here stays.
//
// Two splitters are inert (not a separator, not focusable, no pointer): the one below the Registers
// group while that group is sized by its content (today it is a 1 px line, not a separator), and,
// in the default arrangement, the one above the tool group while the Output panel is collapsed
// (today there is no separator then).
//
// The same pass gives each group's content its roles (P3.1.8): a group that shows its strip is a
// tablist whose panels are tabpanels (FlexLayout's own roles); a group shown without a strip has
// neither role, so its PanelRegion is a plain `region` as today.

import type { DockNode } from '../../contracts';
import type { SplitId } from '../../state/layout';
import { groupsOf, type DockMode } from './model';
import { nodeAt, registersPlace } from './sizes';
import { SPLITTER_NAMES, resizeBetween } from './texts';

/** A default splitter's job: which stored split (or the editor's message list) it moves. */
export type SplitRole = SplitId | 'editor.messages';

export interface SplitterPlan {
  /** Accessible name; null for an inert splitter. */
  name: string | null;
  /** In the default arrangement: the split it moves. */
  role?: SplitRole;
}

/** The panel nearest to a splitter on one side of it: the selected tab of the subtree's last or first group. */
function sidePanel(node: DockNode, last: boolean): string {
  const groups = groupsOf(node);
  return (last ? groups[groups.length - 1] : groups[0])?.selected ?? '';
}

/**
 * The plan of every splitter of a tree, keyed by `<our container path>/<index>` (index 1 = the
 * splitter between children 0 and 1).
 */
export function splitterPlans(
  mode: DockMode,
  tree: DockNode | null,
  options: { isDefault: boolean; outputCollapsed: boolean; title(panel: string): string },
): Map<string, SplitterPlan> {
  const plans = new Map<string, SplitterPlan>();
  if (tree === null) return plans;
  const registers = mode === 'simulator' ? registersPlace(tree) : null;
  const visit = (node: DockNode, path: string) => {
    if (node.type === 'tabs') return;
    node.children.forEach((child, index) => {
      visit(child, `${path}.${index}`);
      if (index === 0) return;
      const key = `${path}/${index}`;
      if (registers === path && index === 1) {
        plans.set(key, { name: null });
        return;
      }
      plans.set(key, {
        name: resizeBetween(
          options.title(sidePanel(node.children[index - 1]!, true)),
          options.title(sidePanel(child, false)),
        ),
      });
    });
  };
  visit(tree, 'root');
  if (!options.isDefault) return plans;
  // The default arrangements: today's names (P2.2).
  const set = (key: string, plan: SplitterPlan) => {
    if (plans.has(key)) plans.set(key, plan);
  };
  if (mode === 'editor') {
    if (tree.type === 'row') {
      set('root/1', { name: SPLITTER_NAMES.files, role: 'editor.files' });
      set('root.1/1', { name: SPLITTER_NAMES.messages, role: 'editor.messages' });
    } else {
      set('root/1', { name: SPLITTER_NAMES.messages, role: 'editor.messages' });
    }
    return plans;
  }
  if (tree.type === 'column') {
    set('root/2', { name: SPLITTER_NAMES.messages, role: 'sim.messages' });
    set('root/3', { name: SPLITTER_NAMES.columns, role: 'sim.columns' });
    return plans;
  }
  set('root/1', { name: SPLITTER_NAMES.columns, role: 'sim.columns' });
  set('root.0/2', { name: SPLITTER_NAMES.messages, role: 'sim.messages' });
  if (nodeAt(tree, 'root.1')?.type === 'column') {
    set('root.1/1', options.outputCollapsed ? { name: null } : { name: SPLITTER_NAMES.tools, role: 'sim.tools' });
  }
  return plans;
}

const INERT = 'data-e68-inert';
/** Marks a splitter or strip that has a slot in the content layer (order.ts). */
const RELOCATED = 'data-e68-relocated';

function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Applies the splitter plans to FlexLayout's splitter elements under `root`. `flexKeyOf` turns a
 * splitter's `data-layout-path` into the plan's key. `relocated` maps the key of each splitter
 * that has a slot in the content layer (Lock Layout on, order.ts) to its id: such a splitter is
 * reached through its slot, so it leaves the Tab order here.
 */
export function decorateSplitters(
  root: ParentNode,
  plans: Map<string, SplitterPlan>,
  keyOfFlexPath: (flexPath: string) => string | null,
  relocated: ReadonlyMap<string, string> = new Map(),
): void {
  for (const element of Array.from(root.querySelectorAll('.flexlayout__splitter[data-layout-path]'))) {
    const key = keyOfFlexPath(element.getAttribute('data-layout-path') ?? '');
    const plan = key === null ? undefined : plans.get(key);
    if (!plan) continue;
    const id = key === null ? undefined : relocated.get(key);
    if (plan.name === null) {
      setAttr(element, 'role', null);
      setAttr(element, 'aria-label', null);
      setAttr(element, 'tabindex', '-1');
      setAttr(element, 'aria-hidden', 'true');
      setAttr(element, INERT, 'true');
      setAttr(element, 'data-e68-split', null);
      setAttr(element, RELOCATED, null);
    } else {
      setAttr(element, 'role', 'separator');
      setAttr(element, 'aria-label', plan.name);
      setAttr(element, 'tabindex', id === undefined ? '0' : '-1');
      setAttr(element, 'aria-hidden', null);
      setAttr(element, INERT, null);
      setAttr(element, 'data-e68-split', plan.role ?? null);
      setAttr(element, RELOCATED, id === undefined ? null : 'splitter');
      if (id !== undefined) setAttr(element, 'id', id);
    }
  }
}

/**
 * The roles of the groups' contents (P3.1.8): FlexLayout's `.flexlayout__tab` is a tabpanel only
 * where its group shows a strip, and never for a viewer, whose own element is the tabpanel.
 */
export function decorateTabPanels(
  root: ParentNode,
  hasStrip: (tabId: string) => boolean,
  isViewer: (tabId: string) => boolean,
  inner = false,
  floatingLabel: (tabId: string) => string | null = () => null,
): void {
  for (const element of Array.from(root.querySelectorAll('.flexlayout__tab[id^="flexlayout-tab-"]'))) {
    const tabId = element.id.slice('flexlayout-tab-'.length);
    // Version 1.1 (P9.2): a floating window is a region named `<panel name>, floating`, not a
    // dialog; its title bar and its panel are inside it.
    const floating = floatingLabel(tabId);
    if (floating !== null) {
      setAttr(element, 'role', 'region');
      setAttr(element, 'aria-label', floating);
      setAttr(element, 'aria-labelledby', null);
      setAttr(element, 'data-e68-dock-tab', tabId);
      const content = element.querySelector(`[data-e68-dock-content="${tabId}"]`);
      if (content) {
        setAttr(content, 'role', null);
        setAttr(content, 'aria-labelledby', null);
        setAttr(content, 'id', null);
      }
      continue;
    }
    setAttr(element, 'aria-label', null);
    const panel = hasStrip(tabId) && !isViewer(tabId);
    // With Lock Layout on, a strip's slot (order.ts) sits in the tab's element just before the
    // panel's content, so the tabpanel role goes on the content's own wrapper: the strip is then
    // read before the tab panel, not inside it.
    const content = element.querySelector(`[data-e68-dock-content="${tabId}"]`);
    const onInner = inner && content !== null;
    setAttr(element, 'role', panel && !onInner ? 'tabpanel' : null);
    setAttr(element, 'aria-labelledby', panel && !onInner ? `flexlayout-tabbutton-${tabId}` : null);
    setAttr(element, 'data-e68-dock-tab', tabId);
    if (content) {
      setAttr(content, 'role', panel && onInner ? 'tabpanel' : null);
      setAttr(content, 'aria-labelledby', panel && onInner ? `flexlayout-tabbutton-${tabId}` : null);
      setAttr(content, 'id', panel && onInner ? innerPanelId(tabId) : null);
    }
    // The tab names the element that is its tab panel (aria-controls): the content's wrapper while
    // it holds the role, a viewer's own element, else FlexLayout's own `.flexlayout__tab` again
    // (errata N1 25).
    const button = root.querySelector(`[id="flexlayout-tabbutton-${tabId}"]`);
    const controls = button?.getAttribute('aria-controls') ?? null;
    if (button && controls !== null) {
      const inner = element.querySelector(`[id="${innerPanelId(tabId)}"]`);
      setAttr(button, 'aria-controls', inner ? inner.id : element.id);
    }
  }
}

/** The id of a panel's content wrapper while it is the tab panel (Lock Layout on, a strip shown). */
export const innerPanelId = (tabId: string) => `e68-dock-tabpanel-${tabId}`;
