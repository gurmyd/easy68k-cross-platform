// The workspace of Editor mode and of Simulator mode as a dock (ARCHITECTURE-PLUS P3.1). Owner: N1.
//
//   <DockWorkspace mode="editor" />      files | editor / messages, viewers as tabs of the editor's group
//   <DockWorkspace mode="simulator" />   registers / listing / messages | output / tool panels
//
// FlexLayout's Layout draws the groups, their tab strips and the splitters; each panel is the
// PanelRegion of its PanelSpec, as before (data-e68-panel, its error boundary, its region role).
// The engine (engine.ts) owns the model and every rule; this component gives it the element, its
// size, the window's width (the narrow default below 1100 px), and the keys and clicks FlexLayout
// does not handle: the tab menu (Shift+F10, the context-menu key, a right click) and today's
// splitter keys (Shift+arrows, Home, End, Enter, a double-click) on the default splitters.
//
// No component here handles a key whose target is inside `[data-e68-keys="program"]` (P1.1 rule 5).

import { I18nLabel, Layout, TabNode, type IKeyMap, type Node } from 'flexlayout-react';
import 'flexlayout-react/style/light.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { useApplication, useShellState } from '../../state/context';
import { NARROW_WIDTH, PANEL_TITLES, type PanelId } from '../../state/layout';
import { showPanel } from '../../state/panels';
import { Icon } from '../components';
import { PanelRegion } from '../shell/PanelRegion';
import './dock.css';
import { DockEngine } from './engine';
import { DOCK_KEY_MAP, isViewerId, panelOfTab, tabIdOf, type DockMode } from './model';
import { blockOf, stopsOf } from './order';
import { FloatEdges, FloatTitleBar } from './FloatChrome';
import { innerPanelId, type SplitRole } from './splitters';
import { TabMenu, type TabMenuState } from './TabMenu';
import { CLOSE_TAB, SPLITTER_LABEL } from './texts';

const PROGRAM_KEYS = '[data-e68-keys="program"]';
const NARROW_QUERY = `(max-width: ${NARROW_WIDTH - 0.02}px)`;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** FlexLayout's labels: its one splitter label is `Resize` (P2.2), a tab's x is `Close`. */
function translate(key: string): string {
  if (key === I18nLabel.Splitter) return SPLITTER_LABEL;
  if (key === I18nLabel.Close_Tab) return CLOSE_TAB;
  return key;
}

const ICONS = { close: <Icon name="close" size={14} /> };

const matches = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

function useMedia(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setValue(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return value;
}

/** Counts this mount of a panel's content (development builds and tests read the counters). */
function useMountCount(engine: DockEngine, panel: string): void {
  const [instance] = useState(() => ({}));
  useEffect(() => engine.countMount(panel, instance), [engine, panel, instance]);
}

/** The Registers panel: sized by its content while it is at the top of the left column (P3.1.5). */
function RegistersContent({ engine }: { engine: DockEngine }) {
  const view = useSyncExternalStore(engine.subscribeView, engine.getView, engine.getView);
  const wrapper = useRef<HTMLDivElement>(null);
  const auto = view.registersAuto;
  useLayoutEffect(() => {
    const region = wrapper.current?.firstElementChild as HTMLElement | null | undefined;
    if (!auto || !region || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const height = region.getBoundingClientRect().height;
      if (height > 0) engine.setRegistersHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(region);
    return () => observer.disconnect();
  }, [auto, engine]);
  return (
    <div ref={wrapper} className="e68-dock__content" data-e68-dock-content={tabIdOf('simulator', 'registers')}>
      <PanelRegion
        id="registers"
        mode="simulator"
        className={auto ? 'e68-region--auto e68-dock__auto' : 'e68-region--fill'}
      />
    </div>
  );
}

/** The Output panel with today's expand bar while it is collapsed (P3.1.5). */
function OutputContent({ engine }: { engine: DockEngine }) {
  const app = useApplication();
  const view = useSyncExternalStore(engine.subscribeView, engine.getView, engine.getView);
  const collapsed = useShellState((state) => state.outputCollapsed);
  const bar = collapsed && view.collapseApplies;
  const title = app.panels.find('simulator', 'output')?.title ?? PANEL_TITLES.output;
  return (
    <div
      className="e68-dock__content e68-dock__output"
      data-collapsed={bar ? 'true' : undefined}
      data-e68-dock-content={tabIdOf('simulator', 'output')}
    >
      {bar && (
        <button
          type="button"
          className="e68-dock__expand"
          aria-expanded={false}
          onClick={() => showPanel(app.ctx, 'output')}
        >
          {title}
        </button>
      )}
      <PanelRegion id="output" mode="simulator" className="e68-region--fill" hidden={bar} />
    </div>
  );
}

/** A viewer (a transient panel): its element is the tab panel (P3.1.2); floating, it has no tab. */
function TransientContent({ engine, panel, floating }: { engine: DockEngine; panel: string; floating: boolean }) {
  const spec = engine.transients.get(panel);
  return (
    <section
      id={innerPanelId(tabIdOf(engine.mode, panel))}
      data-e68-panel={panel}
      role={floating ? 'region' : 'tabpanel'}
      aria-label={floating ? (spec?.title ?? panel) : undefined}
      aria-labelledby={floating ? undefined : `flexlayout-tabbutton-${tabIdOf(engine.mode, panel)}`}
      tabIndex={-1}
      className="e68-region e68-region--fill e68-dock__viewer"
    >
      {spec?.render() ?? null}
    </section>
  );
}

/** The tab that is about to receive the focus by Tab or Shift+Tab, as the last Tab key said. */
const lastTab = { backward: false, at: Number.NEGATIVE_INFINITY };

/**
 * A slot of a strip or a splitter in the content layer (Lock Layout on, order.ts): it owns the
 * block for the accessibility tree and, reached by Tab, passes the focus on to the block's first
 * element (by Shift+Tab, its last).
 */
function DockSlot({ engine, panel, side }: { engine: DockEngine; panel: string; side: 'before' | 'after' }) {
  const block = useSyncExternalStore(
    engine.subscribeSlots,
    () => engine.slotOf(panel, side),
    () => engine.slotOf(panel, side),
  );
  if (block === null) return null;
  const onFocus = (event: ReactFocusEvent<HTMLSpanElement>) => {
    if (engine.passingFocus) return;
    const slot = event.currentTarget;
    const target = slot.ownerDocument.getElementById(block);
    const stops = target ? stopsOf(target) : [];
    if (stops.length === 0) return;
    let backward: boolean;
    if (performance.now() - lastTab.at < 1000) backward = lastTab.backward;
    else {
      // Without a recent Tab key: from an element after the slot means backward.
      const from = event.relatedTarget as globalThis.Node | null;
      backward =
        from !== null && (slot.compareDocumentPosition(from) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    }
    stops[backward ? stops.length - 1 : 0]!.focus();
  };
  return (
    <span
      className="e68-dock__slot"
      // A tab stop of its own: the slot hands the focus on at once.
      tabIndex={0}
      aria-owns={block}
      data-e68-dock-slot={side}
      onFocus={onFocus}
    />
  );
}

/**
 * The content of a panel's tab (exported for the shell's tests under Node), between the slots of
 * the blocks that come before and after it (Lock Layout on, order.ts). Floating (version 1.1), the
 * window's title bar comes before the content and its edges after it; the content keeps its place
 * among its siblings either way, so floating and docking never create it anew (P9.2).
 */
export function DockContent({ engine, panel }: { engine: DockEngine; panel: string }) {
  useMountCount(engine, panel);
  const app = useApplication();
  const view = useSyncExternalStore(
    engine.subscribeFloats,
    () => engine.floatViewOf(panel),
    () => engine.floatViewOf(panel),
  );
  let content: ReactNode;
  if (isViewerId(panel)) content = <TransientContent engine={engine} panel={panel} floating={view !== null} />;
  else if (engine.mode === 'simulator' && panel === 'output') content = <OutputContent engine={engine} />;
  else if (engine.mode === 'simulator' && panel === 'registers') content = <RegistersContent engine={engine} />;
  else
    content = (
      <div className="e68-dock__content" data-e68-dock-content={tabIdOf(engine.mode, panel)}>
        <PanelRegion id={panel as PanelId} mode={engine.mode} className="e68-region--fill" />
      </div>
    );
  return (
    <>
      <DockSlot engine={engine} panel={panel} side="before" />
      {view ? <FloatTitleBar ctx={app.ctx} engine={engine} view={view} /> : null}
      {content}
      {view ? <FloatEdges engine={engine} panel={panel} /> : null}
      <DockSlot engine={engine} panel={panel} side="after" />
    </>
  );
}

/**
 * Tab or Shift+Tab on an element of a relocated block (Lock Layout on): the next element of the
 * block, or, at its end, on from the block's slot. Returns whether the key was handled here.
 */
function tabFromBlock(engine: DockEngine, root: HTMLElement, target: Element, backward: boolean): boolean {
  const block = blockOf(target);
  if (!block || !block.id || !root.contains(block)) return false;
  const stops = stopsOf(block);
  let at = stops.indexOf(target as HTMLElement);
  // A tab of the strip that is not its tab stop (reached with the arrows) counts as the tab stop.
  if (at < 0 && target.closest('[role="tab"]')) at = 0;
  const next = at < 0 ? -1 : backward ? at - 1 : at + 1;
  if (at >= 0 && next >= 0 && next < stops.length) {
    stops[next]!.focus();
    return true;
  }
  const slot = Array.from(root.querySelectorAll<HTMLElement>('[data-e68-dock-slot]')).find(
    (element) => element.getAttribute('aria-owns') === block.id,
  );
  if (!slot) return false;
  // The browser's own Tab then goes on from the slot (not handled: no preventDefault).
  engine.passingFocus = true;
  try {
    slot.focus({ preventScroll: true });
  } finally {
    engine.passingFocus = false;
  }
  return false;
}

/** True for an event whose target is inside the Output panel's key field (P1.1 rule 5). */
function fromProgramKeys(event: Event): boolean {
  const target = event.target as Element | null;
  return typeof target?.closest === 'function' && target.closest(PROGRAM_KEYS) !== null;
}

function tabButtonPanel(element: Element | null): { panel: string; button: HTMLElement } | null {
  const button = element?.closest?.('.flexlayout__tab_button[id^="flexlayout-tabbutton-"]') as HTMLElement | null;
  if (!button) return null;
  const panel = panelOfTab(button.id.slice('flexlayout-tabbutton-'.length));
  return panel === null ? null : { panel, button };
}

export function DockWorkspace({ mode }: { mode: DockMode }) {
  const app = useApplication();
  const { ctx } = app;
  const [engine] = useState(
    () => new DockEngine(ctx, app.panels, app.shell, mode, mode === 'simulator' && matches(NARROW_QUERY)),
  );
  const model = useSyncExternalStore(engine.subscribeModel, engine.getModel, engine.getModel);
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<TabMenuState | null>(null);
  const menuOpenedAt = useRef(0);
  const narrow = useMedia(NARROW_QUERY);
  const reduced = useMedia(REDUCED_MOTION);

  useEffect(() => engine.start(), [engine]);
  useEffect(() => {
    if (mode === 'simulator') engine.setNarrow(narrow);
  }, [engine, mode, narrow]);

  useLayoutEffect(() => {
    engine.setElement(container.current);
    engine.announcer.attach(live.current);
    return () => {
      engine.setElement(null);
      engine.announcer.attach(null);
    };
  }, [engine]);

  // The Layout (a child) has committed `model`.
  useLayoutEffect(() => engine.markRendered(model), [engine, model]);

  // The dock's size; its splitter names and the groups' roles after every change of FlexLayout's
  // own elements (not of the panels' contents).
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      engine.setSize(box.width, box.height);
    };
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    resize?.observe(element);
    const mutations =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver((records) => {
            const ours = records.some((record) => {
              const target = record.target as Element;
              return typeof target.closest !== 'function' || target.closest('.flexlayout__tab_moveable') === null;
            });
            if (ours) engine.decorate();
          });
    mutations?.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-label', 'role', 'aria-labelledby', 'tabindex'],
    });
    return () => {
      resize?.disconnect();
      mutations?.disconnect();
    };
  }, [engine]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((panel: string, x: number, y: number) => {
    menuOpenedAt.current = Date.now();
    setMenu({ panel, at: { x, y } });
  }, []);

  // Keys FlexLayout does not handle: the tab menu's keys on a tab, today's keys on a default splitter.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (fromProgramKeys(event)) return;
      const target = event.target as Element | null;
      // Lock Layout on: Tab and Shift+Tab on a splitter or a strip go on from its slot (order.ts).
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (target && tabFromBlock(engine, element, target, event.shiftKey)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const tab = tabButtonPanel(target);
      if (
        tab &&
        (event.key === 'ContextMenu' ||
          (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey))
      ) {
        event.preventDefault();
        event.stopPropagation();
        const box = tab.button.getBoundingClientRect();
        openMenu(tab.panel, box.left, box.bottom);
        return;
      }
      // The arrows wrap around at the ends of a strip, as the kit's tab strips do (FlexLayout's
      // stop there).
      if (tab && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
        const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
        const list = tab.button.closest('[role="tablist"]');
        const tabs = list ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')) : [];
        const at = tabs.indexOf(tab.button);
        if (tabs.length > 1 && ((forward && at === tabs.length - 1) || (back && at === 0))) {
          event.preventDefault();
          event.stopPropagation();
          tabs[forward ? 0 : tabs.length - 1]?.focus();
          return;
        }
      }
      const splitter = target?.closest?.('.flexlayout__splitter[data-e68-split]');
      if (!splitter || event.ctrlKey || event.altKey || event.metaKey) return;
      const role = splitter.getAttribute('data-e68-split') as SplitRole;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        engine.restoreSplit(role);
        return;
      }
      const ours = event.shiftKey || event.key === 'Home' || event.key === 'End';
      if (ours && engine.splitterKey(role, event.key, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onDoubleClick = (event: MouseEvent) => {
      const splitter = (event.target as Element | null)?.closest?.('.flexlayout__splitter[data-e68-split]');
      if (!splitter) return;
      engine.restoreSplit(splitter.getAttribute('data-e68-split') as SplitRole);
    };
    // FlexLayout 0.11.1 keeps the last drop preview where a dragover finds no place (a refused
    // drop, P2.2 setOnAllowDrop): the browser then drops nothing, so the preview is hidden too
    // (errata N1). Runs after FlexLayout's own handler, which cancels the event when it has a place.
    const document = element.ownerDocument;
    // Version 1.1 (P9.2): a tab dragged (layout unlocked) and dropped where there is no docking
    // target, outside the dock's layout (on the toolbar, the menus, the status bar), floats there.
    // Inside the layout FlexLayout decides as in 1.0.0 (a refused place drops nothing, errata N1 22).
    let dragged: string | null = null;
    const layoutOf = () => element.querySelector('.flexlayout__layout');
    const onDragStart = (event: DragEvent) => {
      const tab = tabButtonPanel(event.target as Element | null);
      dragged = tab && element.contains(tab.button) ? tab.panel : null;
    };
    const onDragEnd = () => {
      dragged = null;
    };
    const outsideLayout = (event: DragEvent) => {
      const layout = layoutOf();
      return layout !== null && !layout.contains(event.target as globalThis.Node | null);
    };
    const onDragOverFloat = (event: DragEvent) => {
      if (dragged === null || event.defaultPrevented || !outsideLayout(event) || !engine.canFloat(dragged)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };
    const onDropFloat = (event: DragEvent) => {
      const panel = dragged;
      if (panel === null || event.defaultPrevented || !outsideLayout(event) || !engine.canFloat(panel)) return;
      event.preventDefault();
      dragged = null;
      const box = element.getBoundingClientRect();
      const size = engine.firstFloatSize(panel);
      engine.float(panel, {
        x: event.clientX - box.left - 24,
        y: event.clientY - box.top - 12,
        width: size.width,
        height: size.height,
      });
    };
    const onRaise = (event: Event) => {
      const window = (event.target as Element | null)?.closest?.('.flexlayout__tab[data-e68-float]');
      const panel = window?.getAttribute('data-e68-float');
      if (panel && element.contains(window!)) engine.raise(panel);
    };
    const onDragOver = (event: DragEvent) => {
      if (event.defaultPrevented || !element.contains(event.target as globalThis.Node | null)) return;
      for (const outline of Array.from(
        element.querySelectorAll<HTMLElement>('.flexlayout__outline_rect, .flexlayout__outline_rect_edge'),
      )) {
        outline.style.visibility = 'hidden';
      }
    };
    // The direction of the last Tab, wherever it was pressed: a slot that receives the focus hands
    // it to the first or the last element of its block.
    const onTabKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      lastTab.backward = event.shiftKey;
      lastTab.at = performance.now();
    };
    element.addEventListener('keydown', onKeyDown, true);
    element.addEventListener('dblclick', onDoubleClick);
    element.addEventListener('dragstart', onDragStart, true);
    element.addEventListener('pointerdown', onRaise, true);
    element.addEventListener('focusin', onRaise);
    document.addEventListener('dragend', onDragEnd);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragover', onDragOverFloat);
    document.addEventListener('drop', onDropFloat);
    document.addEventListener('keydown', onTabKey, true);
    return () => {
      element.removeEventListener('dragstart', onDragStart, true);
      element.removeEventListener('pointerdown', onRaise, true);
      element.removeEventListener('focusin', onRaise);
      document.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('dragover', onDragOverFloat);
      document.removeEventListener('drop', onDropFloat);
      document.removeEventListener('keydown', onTabKey, true);
      element.removeEventListener('keydown', onKeyDown, true);
      element.removeEventListener('dblclick', onDoubleClick);
      document.removeEventListener('dragover', onDragOver);
    };
  }, [engine, openMenu]);

  const onContextMenu = useCallback(
    (node: Node, event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      // The keyboard opened it already (Shift+F10 or the context-menu key).
      if (Date.now() - menuOpenedAt.current < 400) return;
      let tabNode: TabNode | undefined;
      if (node instanceof TabNode) tabNode = node;
      else {
        const selected = (node as unknown as { getSelectedNode?(): Node | undefined }).getSelectedNode?.();
        if (selected instanceof TabNode) tabNode = selected;
      }
      const panel = tabNode ? panelOfTab(tabNode.getId()) : null;
      if (panel === null) return;
      let { clientX: x, clientY: y } = event;
      if (x === 0 && y === 0) {
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        x = box.left;
        y = box.bottom;
      }
      openMenu(panel, x, y);
    },
    [openMenu],
  );

  const factory = useCallback(
    (node: TabNode) => {
      const panel = panelOfTab(node.getId());
      return panel === null ? null : <DockContent engine={engine} panel={panel} />;
    },
    [engine],
  );

  return (
    <div ref={container} className="e68-dock" data-e68-dock={mode}>
      <Layout
        model={model}
        factory={factory}
        onAction={engine.onAction}
        onContextMenu={onContextMenu}
        // Each key passed explicitly, the unbound ones as undefined (P2.2): FlexLayout merges the
        // map over its defaults, so an absent key would keep Ctrl+Delete, F2 or Escape.
        keyMap={DOCK_KEY_MAP as IKeyMap}
        i18nTranslator={translate}
        icons={ICONS}
        supportsPopout={false}
        invalidateTabContentOnParentRender={false}
        // FlexLayout 0.11.1 treats 0 as "use the default of 0.3 s" (errata N1); dock.css also
        // switches the drop preview's transition off under prefers-reduced-motion.
        {...(reduced ? { tabDragSpeed: 0.0001 } : {})}
      />
      <div ref={live} role="status" aria-live="polite" className="e68-dock__live" data-e68-dock-live={mode} />
      <TabMenu ctx={ctx} engine={engine} state={menu} onClose={closeMenu} />
    </div>
  );
}
