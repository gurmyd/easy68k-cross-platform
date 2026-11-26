// The dock of one mode: its FlexLayout model and every rule that ties it to the application
// (ARCHITECTURE-PLUS P3.1). Owner: N1.
//
// DockWorkspace.tsx renders FlexLayout's Layout with this engine's model and attaches the engine
// to the window's dock controller (state/dock.ts), which routes showPanel, hidePanel, focusPanel,
// the viewer and the layout commands here.
//
// Where the arrangement comes from:
//   - the default arrangement (nothing stored for the mode): today's tree for the visible panels
//     (model.ts defaultTree), sized in pixels from `layout.splits` and the two content-sized groups
//     (sizes.ts); a splitter drag writes `layout.splits` (or the editor's message-list override),
//     as today; the simulator's narrow default below 1100 px;
//   - a changed arrangement (`layout.dock[mode]`, P4.2): the stored tree; every change of it (a
//     move, a splitter, a hidden or shown panel) is written back.
// Visibility is the settings' (`layout.panels`, program state, P1.1 rule 4): the engine follows it
// and never changes it. A hidden panel's place goes to `parked` (park.ts).
//
// Every change of the model is one FlexLayout action (moves, selections, weights) or a new model
// made from JSON that adopts the old one's tab elements (Model.fromJson(json, previous)), so no
// panel's content is ever remounted by a move, a reset, a lock change or a mode switch.

import {
  Actions,
  BorderNode,
  DockLocation,
  Model,
  RowNode,
  TabNode,
  TabSetNode,
  type Action,
  type DropInfo,
  type Node,
} from 'flexlayout-react';
import type { AppContext, DockNode, DockParked, Settings, Store } from '../../contracts';
import {
  DEFAULT_FLOAT_SIZE,
  attachDock,
  lockedIn,
  type DockArrangement,
  type DockAttachment,
  type DockDescription,
  type DockFloating,
  type DockLive,
  type DockMoveTarget,
  type DockRect,
  type TransientSpec,
} from '../../state/dock';
import {
  DEFAULT_SPLIT_FRACTIONS,
  PANEL_TITLES,
  isPanelVisible,
  messageListOf,
  messagesPaneHeight,
  splitPixels,
  withSplit,
  type SplitId,
} from '../../state/layout';
import { focusPanel, hidePanel, type PanelRegistry } from '../../state/panels';
import type { ShellState } from '../../state/shell';
import { moveTargetsChangeNothing } from './compare';
import {
  groupOf,
  layoutRects,
  liveRects,
  moveAction,
  panelsOfGroup,
  stepAction,
  tabNodeOf,
  tabOrderAction,
  type Direction,
  type PlannedMove,
} from './actions';
import { Announcer } from './announce';
import { keptRoom, tileWindows } from '../../state/tiling';
import { pinScroll } from './pin';
import {
  boundedRect,
  firstFloatRect,
  firstSizeWithin,
  minimumSize,
  raised,
  sameRect,
  titleButtonsWidth,
  WINDOW_BORDER,
  zIndexOf,
  type Area,
  type FloatOrigin,
  type StoredWindow,
} from './floating';
import { indexModel, tabIdsInReadingOrder, type LiveIndex } from './live';
import {
  DOCK_PANELS,
  FIXED_PANELS,
  defaultTree,
  groupLabel,
  groupsOf,
  isClosablePanel,
  isToolPanel,
  isPanelOf,
  isViewerId,
  needsStrip,
  panelOfTab,
  panelsOf,
  sameShape,
  tabIdOf,
  tabJson,
  toFlexJson,
  type DockMode,
  type FlexJsonOptions,
} from './model';
import { EMPTY_RELOCATION, decorateStrips, relocationPlan, type Relocation } from './order';
import { dockInto, insertPanel, placeOf, removePanel, selectedLike, withoutViewers } from './park';
import { allowsDrop, decideAction } from './rules';
import {
  defaultDrag,
  editorMessagesPlace,
  nodeAt,
  registersPlace,
  sizeContentGroups,
  sizeDefaultTree,
  SPLITTER_SIZE,
  STRIP_HEIGHT,
  type SizeInput,
} from './sizes';
import { decorateSplitters, decorateTabPanels, splitterPlans, type SplitRole } from './splitters';
import { floatingOf, readDock, readTree, withDock } from './stored';
import { ANNOUNCE, FLOATING_REGION } from './texts';
import { TransientTabs } from './transient';

/** What a tab's content component reads from the engine (re-rendered when it changes). */
export interface EngineView {
  /** The Registers panel is sized by its content (P3.1.5). */
  registersAuto: boolean;
  /** A collapsed Output panel shows today's expand bar (not in the narrow default, where it is a tab). */
  collapseApplies: boolean;
}

/** What a floating window's title bar reads from the engine (version 1.1, P9.2). */
export interface FloatView {
  panel: string;
  title: string;
  /** The panel has an `x` today (files, the tool panels, viewers). */
  closable: boolean;
}

/** FlexLayout internals the dock uses (flexlayout-react 0.11.1; docs/porting/errata/N1.md). */
interface LayoutControllerInternals {
  _orderedTabIds?: string[];
  getOrderedTabIds?(): string[];
  redrawLayout?(): void;
}
interface ModelInternals {
  adoptedFromModel?: Model;
  getLayouts?(): Map<string, { getController?(): unknown }>;
}
interface TabNodeInternals {
  isRendered?(): boolean;
  setRendered?(rendered: boolean): void;
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export class DockEngine implements DockLive {
  readonly mode: DockMode;
  readonly announcer = new Announcer();
  readonly transients = new TransientTabs();
  model: Model;

  private readonly ctx: AppContext;
  private readonly panels: PanelRegistry;
  private readonly shell: Store<ShellState>;
  private rendered: Model | null = null;
  private attachment: DockAttachment | null = null;
  private element: HTMLElement | null = null;
  private size = { width: 0, height: 0 };
  private registersHeight: number | null = null;
  private narrow = false;
  private drag: { list: string; height: number } | null = null;
  private applied = { stored: 'null', visible: '', locked: true, narrow: false };
  private syncing = 0;
  private writing = false;
  private pendingAnnouncement: string | null = null;
  private beforeAction: { kind: 'drag'; from: string; to: string; location: string; fromGroup: string | null } | null =
    null;
  private view: EngineView = { registersAuto: false, collapseApplies: true };
  private readonly modelListeners = new Set<() => void>();
  private readonly viewListeners = new Set<() => void>();
  private disposers: (() => void)[] = [];
  private frame = 0;
  private relocation: Relocation = EMPTY_RELOCATION;
  private slotsKey = '[]';
  private readonly slotListeners = new Set<() => void>();
  /** True while the focus is put on a slot only to let Tab go on from there (DockWorkspace). */
  passingFocus = false;
  /**
   * Version 1.1 (P9.2): the floating windows in the order they were made to float, shown or hidden
   * (viewers included, never stored); the remembered rect of each panel that floated before; the
   * stacking order from the back to the front; a rect shown while a pointer or the keys move it.
   */
  private floats: StoredWindow[] = [];
  private remembered: Record<string, DockRect> = {};
  private stack: string[] = [];
  private preview = new Map<string, DockRect>();
  private floatViews = new Map<string, FloatView>();
  private readonly floatListeners = new Set<() => void>();
  /**
   * The docked arrangement the floating panels left (errata M1 11; stored with the windows), and
   * whether the store being written is a Float's or a Dock's (which moves `origin.last` on).
   */
  private origin: FloatOrigin | null = null;
  private chainWriting = false;
  /** The room at the right of the dock kept for the floating windows (P9.8 point 1), CSS px. */
  private reserve = 0;
  /** The room applied to the page now (applyReserve). */
  private reserveShown = 0;
  /** Stops pinScroll on the dock's element (P9.9 point 1). */
  private unpin: (() => void) | null = null;
  private readonly changeListener = {
    onBeforeAction: (action: Action) => this.onBeforeAction(action),
    onAfterAction: (action: Action) => this.onAfterAction(action),
  };

  constructor(ctx: AppContext, panels: PanelRegistry, shell: Store<ShellState>, mode: DockMode, narrow = false) {
    this.ctx = ctx;
    this.panels = panels;
    this.shell = shell;
    this.mode = mode;
    this.narrow = narrow;
    this.loadFloats();
    this.model = this.createModel(this.treeFromSettings(), undefined);
    this.recordApplied();
    this.updateView();
  }

  // --- React -----------------------------------------------------------------------------------

  subscribeModel = (listener: () => void) => {
    this.modelListeners.add(listener);
    return () => this.modelListeners.delete(listener);
  };
  getModel = () => this.model;
  subscribeView = (listener: () => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };
  getView = () => this.view;

  /** The Layout has rendered `model` (DockWorkspace's layout effect). */
  markRendered(model: Model): void {
    this.rendered = model;
    this.afterRender();
  }

  /** Starts following the settings, the shell and the store, and attaches to the controller. */
  start(): () => void {
    const { ctx } = this;
    this.disposers.push(ctx.settings.subscribe(() => this.reconcile()));
    let collapsed = this.shell.getState().outputCollapsed;
    this.disposers.push(
      this.shell.subscribe(() => {
        const now = this.shell.getState().outputCollapsed;
        if (now === collapsed) return;
        collapsed = now;
        this.updateView();
        this.syncSizes();
        this.decorateSoon();
      }),
    );
    let mode = ctx.store.getState().mode;
    let list = this.messageList().list;
    this.disposers.push(
      ctx.store.subscribe(() => {
        const state = ctx.store.getState();
        if (state.mode !== mode) {
          mode = state.mode;
          // P4.4: a viewer's tab goes away on a mode change.
          if (this.mode === 'editor' && mode !== 'editor') this.closeAllTransients();
        }
        if (this.mode === 'editor') {
          const next = this.messageList().list;
          if (next !== list) {
            list = next;
            this.syncSizes();
          }
        }
      }),
    );
    this.attachment = attachDock(ctx, this);
    this.reconcile();
    this.storeReconciled();
    // Development builds: the browser check reads the docks (ui/dock/check-dock.mjs).
    if (import.meta.env?.DEV && typeof window !== 'undefined') {
      const docks = ((window as unknown as { __easy68kDock?: Record<string, DockEngine> }).__easy68kDock ??= {});
      docks[this.mode] = this;
    }
    return () => {
      for (const dispose of this.disposers.splice(0)) dispose();
      this.attachment?.detach();
      this.attachment = null;
    };
  }

  /** The dock's element (null on unmount). */
  setElement(element: HTMLElement | null): void {
    if (element === this.element) return;
    this.unpin?.();
    this.unpin = null;
    this.element = element;
    // P9.9 point 1: the dock never scrolls as a whole (dock.css `overflow: clip`; pin.ts elsewhere).
    if (element) this.unpin = pinScroll(element);
  }

  setSize(width: number, height: number): void {
    if (Math.abs(width - this.size.width) < 0.25 && Math.abs(height - this.size.height) < 0.25) return;
    this.size = { width, height };
    this.syncSizes();
    this.ensureFloatsRendered();
    this.applyFloatStyles();
  }

  setNarrow(narrow: boolean): void {
    if (narrow === this.narrow) return;
    this.narrow = narrow;
    this.reconcile();
  }

  /** The measured height of the Registers panel while it is sized by its content. */
  setRegistersHeight(height: number): void {
    if (this.registersHeight !== null && Math.abs(height - this.registersHeight) < 0.25) return;
    this.registersHeight = height;
    this.syncSizes();
  }

  countMount(panel: string, instance: object): void {
    this.attachment?.countMount(panel, instance);
  }

  // --- facts -----------------------------------------------------------------------------------

  private settings(): Settings {
    return this.ctx.settings.get();
  }

  title = (panel: string): string => {
    if (isViewerId(panel)) return this.transients.get(panel)?.title ?? panel;
    return this.panels.find(this.mode, panel)?.title ?? PANEL_TITLES[panel as keyof typeof PANEL_TITLES] ?? panel;
  };

  locked(): boolean {
    return lockedIn(this.settings());
  }

  /** The arrangement is the default one (nothing stored for the mode, P3.1.3). */
  isDefault(): boolean {
    return readDock(this.settings())[this.mode] === undefined;
  }

  private visiblePanels(): string[] {
    const settings = this.settings();
    return DOCK_PANELS[this.mode].filter(
      (panel) => FIXED_PANELS[this.mode].includes(panel) || isPanelVisible(settings, panel, this.ctx.platform.kind),
    );
  }

  private messageList() {
    const state = this.ctx.store.getState();
    return messageListOf(state, state.documents.activeId);
  }

  /** The editor's message list height by the original's rule and today's drag override. */
  private messagesRule(): number {
    const { count, assembled, list } = this.messageList();
    const dragged = this.drag !== null && this.drag.list === list ? this.drag.height : null;
    return messagesPaneHeight({ messageCount: count, assembled, dragged });
  }

  sizeInput(): SizeInput {
    return {
      width: this.size.width,
      height: this.size.height,
      settings: this.settings(),
      locked: this.locked(),
      registers: this.registersHeight,
      outputCollapsed: this.shell.getState().outputCollapsed,
      messages: this.mode === 'editor' ? this.messagesRule() : 0,
    };
  }

  private jsonOptions(): FlexJsonOptions {
    return {
      mode: this.mode,
      locked: this.locked(),
      title: this.title,
      tooltip: (panel) => this.transients.get(panel)?.tooltip,
      strip: (panels) => this.stripFor(panels),
      floating: this.shownFloats(),
    };
  }

  /**
   * Whether a group shows its tab strip (P3.1.4), and in the simulator's narrow default the group
   * of the Output panel, which today is always the first tab of the tool group's strip (errata N1).
   */
  stripFor(panels: readonly string[]): boolean {
    const locked = this.locked();
    if (needsStrip(panels, locked)) return true;
    return this.narrowOutputStrip() && panels.includes('output');
  }

  /**
   * The simulator's narrow default arrangement, in which the Output panel's group always shows its
   * strip and its tab list keeps today's name `Tool panels`, also with Output alone (errata N1 6).
   */
  private narrowOutputStrip(): boolean {
    return this.mode === 'simulator' && this.narrow && this.isDefault();
  }

  has(id: string): boolean {
    return tabNodeOf(this.model, this.mode, id) !== undefined;
  }

  tree(): DockNode | null {
    return indexModel(this.model).tree;
  }

  // --- building models -------------------------------------------------------------------------

  /** The tree the settings give: the stored arrangement with the visible panels, or the default. */
  private treeFromSettings(): DockNode {
    const dock = readDock(this.settings());
    const visible = new Set(this.visiblePanels());
    const stored = dock[this.mode];
    let tree: DockNode;
    if (stored) {
      tree = this.reconcileTree(stored, visible, dock.parked).tree;
    } else {
      tree = this.defaultArrangement(visible);
    }
    for (const id of this.transients.ids()) if (!this.isFloating(id)) tree = insertPanel(tree, this.mode, id);
    return tree;
  }

  /** The mode's default arrangement (P3.1.3) for the visible panels, at the dock's width now. */
  private defaultArrangement(visible: ReadonlySet<string> = new Set(this.visiblePanels())): DockNode {
    const shell = this.shell.getState();
    return defaultTree(this.mode, {
      visible: (panel) => visible.has(panel),
      narrow: this.narrow,
      activeTool: shell.activeTool,
      outputInFront: shell.outputInFront,
    });
  }

  /** A stored tree with the hidden panels taken out (their places parked) and the shown ones put in. */
  private reconcileTree(
    stored: DockNode,
    visible: ReadonlySet<string>,
    parked: Record<string, { near: string; side: 'tab' | 'left' | 'right' | 'above' | 'below' }>,
  ): {
    tree: DockNode;
    parked: Record<string, { near: string; side: 'tab' | 'left' | 'right' | 'above' | 'below' }>;
    changed: boolean;
  } {
    let tree: DockNode = stored;
    const places = { ...parked };
    let changed = false;
    for (const panel of panelsOf(tree)) {
      if (visible.has(panel) || isViewerId(panel)) continue;
      const removed = removePanel(tree, panel);
      if (removed.tree === null) continue;
      tree = removed.tree;
      if (removed.parked) places[panel] = removed.parked;
      changed = true;
    }
    for (const panel of DOCK_PANELS[this.mode]) {
      if (!visible.has(panel) || panelsOf(tree).includes(panel) || this.isFloating(panel)) continue;
      tree = insertPanel(tree, this.mode, panel, places[panel]);
      changed = true;
    }
    return { tree, parked: places, changed };
  }

  private createModel(tree: DockNode, previous: Model | undefined): Model {
    const json = toFlexJson(tree, this.jsonOptions());
    const next = Model.fromJson(json, previous);
    // FlexLayout's Layout keeps its components only for a model adopted from the one it rendered
    // last; a model that replaces one React has not rendered yet must say so (errata N1).
    if (previous && this.rendered && previous !== this.rendered) {
      (next as unknown as ModelInternals).adoptedFromModel = this.rendered;
    }
    next.setOnAllowDrop((dragNode, dropInfo) => this.allowDrop(dragNode, dropInfo));
    next.setOnCreateTabSet(() => ({ enableTabStrip: true }));
    next.addChangeListener(this.changeListener);
    return next;
  }

  /** Replaces the model by one made from `tree` (no remount: the tab elements are adopted). */
  private rebuild(tree: DockNode): void {
    const focus = this.focusedPanel();
    const before = this.tree();
    const previous = this.model;
    const next = this.createModel(tree, previous);
    previous.removeChangeListener(this.changeListener);
    this.model = next;
    this.recordApplied();
    this.afterStructure();
    for (const listener of [...this.modelListeners]) listener();
    this.moveFocusAfterClose(focus, before);
  }

  /** The stored tree and floating windows of the mode, as one key (reconcile). */
  private storedKey(dock = readDock(this.settings())): string {
    const floating = dock.floating?.[this.mode];
    return JSON.stringify([dock[this.mode] ?? null, floating?.windows ?? [], floating?.reserve ?? 0]);
  }

  private recordApplied(): void {
    const dock = readDock(this.settings());
    this.applied = {
      stored: this.storedKey(dock),
      visible: this.visiblePanels().join(','),
      locked: dock.locked,
      narrow: this.narrow,
    };
  }

  /** Follows the settings: the stored tree, the visible panels, the lock, the narrow default. */
  reconcile(): void {
    if (this.writing) return;
    const dock = readDock(this.settings());
    const stored = this.storedKey(dock);
    const visible = this.visiblePanels().join(',');
    if (stored !== this.applied.stored) {
      this.loadFloats();
      this.rebuild(this.treeFromSettings());
      this.storeReconciled();
    } else if (visible !== this.applied.visible) {
      if (dock[this.mode] === undefined) {
        this.rebuild(this.treeFromSettings());
      } else {
        const current = this.tree();
        const result = this.reconcileTree(current ?? dock[this.mode]!, new Set(visible.split(',')), dock.parked);
        this.rebuild(result.tree);
        this.store(result.tree, result.parked);
      }
    } else if (dock.locked !== this.applied.locked) {
      const current = this.tree();
      if (current) this.rebuild(current);
    } else if (this.mode === 'simulator' && dock[this.mode] === undefined && this.narrow !== this.applied.narrow) {
      this.rebuild(this.treeFromSettings());
    }
    this.syncSizes();
  }

  /** P4.2: a hidden panel the stored tree lists is left out, and its place written to parked. */
  private storeReconciled(): void {
    const dock = readDock(this.settings());
    const saved = dock[this.mode];
    if (!saved) return;
    const result = this.reconcileTree(saved, new Set(this.visiblePanels()), dock.parked);
    if (result.changed) this.store(this.tree(), result.parked);
  }

  /** Writes the tree (without viewers) and the parked places as the mode's stored arrangement. */
  private store(
    tree: DockNode | null,
    parked?: Record<string, { near: string; side: 'tab' | 'left' | 'right' | 'above' | 'below' }>,
  ): void {
    const stored = tree === null ? null : withoutViewers(tree);
    const windows = this.floats.filter((window) => !isViewerId(window.panel));
    const valid =
      stored === null ? undefined : readTree(stored, this.mode, new Set(windows.map((window) => window.panel)));
    if (!valid) return;
    // The run of Float and Dock goes on while only they change the shape of the arrangement.
    if (this.origin) {
      if (this.chainWriting) this.origin = { ...this.origin, last: valid };
      else if (!sameShape(valid, this.origin.last)) this.origin = null;
    }
    if (windows.length === 0) {
      this.origin = null;
      this.reserve = 0;
    }
    const floating = {
      windows: windows.map((window) => ({ ...window })),
      remembered: { ...this.remembered },
      ...(this.origin ? { origin: this.origin } : {}),
      ...(this.reserve > 0 ? { reserve: this.reserve } : {}),
    };
    this.writing = true;
    try {
      this.ctx.settings.update((settings) =>
        withDock(settings, (dock) => ({
          ...dock,
          [this.mode]: valid,
          parked: { ...dock.parked, ...parked },
          floating: { ...dock.floating, [this.mode]: floating },
        })),
      );
    } finally {
      this.writing = false;
    }
    this.recordApplied();
    this.updateView();
    this.attachment?.changed();
  }

  // --- actions ---------------------------------------------------------------------------------

  /** Dispatches an action of the dock's own (never through Layout.onAction). */
  private dispatch(action: Action): void {
    this.model.doAction(action);
  }

  private onBeforeAction(action: Action): void {
    this.attachment?.countAction();
    if (action.type === Actions.MOVE_NODE && this.pendingAnnouncement === null) {
      this.beforeAction = {
        kind: 'drag',
        from: String(action.data.fromNode),
        to: String(action.data.toNode),
        location: String(action.data.location),
        fromGroup: this.model.getNodeById(String(action.data.fromNode))?.getParent()?.getId() ?? null,
      };
    }
  }

  private onAfterAction(action: Action): void {
    if (this.syncing > 0) return;
    switch (action.type) {
      case Actions.SELECT_TAB:
        this.syncShell();
        this.decorateSoon();
        this.attachment?.changed();
        return;
      case Actions.MOVE_NODE: {
        const drag = this.beforeAction;
        this.beforeAction = null;
        const announcement = this.pendingAnnouncement ?? (drag ? this.describeDrag(drag) : null);
        this.pendingAnnouncement = null;
        this.fixGroups();
        this.store(this.tree());
        this.afterStructure();
        if (announcement) this.announcer.announce(announcement);
        this.syncSizes();
        return;
      }
      case Actions.ADJUST_WEIGHTS:
        if (action.isAdjusting()) return;
        this.afterWeights(action);
        return;
      case Actions.DELETE_TAB:
      case Actions.ADD_TAB:
        this.fixGroups();
        this.afterStructure();
        this.syncSizes();
        return;
      default:
        return;
    }
  }

  /** What the live region says after a drag (P3.1.8). */
  private describeDrag(drag: { from: string; to: string; location: string; fromGroup: string | null }): string | null {
    const panel = panelOfTab(drag.from);
    if (panel === null) return null;
    const tab = this.model.getNodeById(drag.from);
    const group = tab?.getParent();
    if (drag.location === 'center' && group instanceof TabSetNode) {
      const panels = panelsOfGroup(group);
      // A reorder along its own strip, or a drop into another group.
      if (drag.fromGroup === group.getId()) return ANNOUNCE.position(this.title(panel), panels.indexOf(panel) + 1);
      const others = panels.filter((id) => id !== panel);
      if (others[0]) return ANNOUNCE.intoGroup(this.title(panel), this.title(others[0]));
    }
    const target = this.model.getNodeById(drag.to);
    const side = drag.location as 'left' | 'right' | 'top' | 'bottom';
    if (target instanceof RowNode || target === undefined) return ANNOUNCE.edge(this.title(panel), side);
    if (target instanceof TabSetNode) {
      const near = panelOfTab(target.getSelectedNode()?.getId() ?? '') ?? '';
      const beside = ({ left: 'left', right: 'right', top: 'above', bottom: 'below' } as const)[side];
      if (beside) return ANNOUNCE.beside(this.title(panel), this.title(near), beside);
    }
    return null;
  }

  /** Each group's strip and name follow its panels and the lock (P3.1.4). */
  private fixGroups(): void {
    const updates: Action[] = [];
    this.model.visitNodes((node) => {
      if (!(node instanceof TabSetNode)) return;
      const want = this.stripFor(panelsOfGroup(node));
      if (node.isEnableTabStrip() !== want) {
        updates.push(Actions.updateNodeAttributes(node.getId(), { enableTabStrip: want }));
      }
    });
    if (updates.length === 0) return;
    this.syncing++;
    try {
      for (const update of updates) this.dispatch(update);
    } finally {
      this.syncing--;
    }
  }

  /** After a structural change: the shell's tool state, the view, reading order, names, subscribers. */
  private afterStructure(): void {
    this.syncShell();
    this.updateView();
    this.orderSoon();
    this.decorateSoon();
    this.attachment?.changed();
  }

  /** A splitter was moved (keyboard or the end of a drag). */
  private afterWeights(action: Action): void {
    const index = indexModel(this.model);
    const path = index.pathOfId.get(String(action.data.nodeId));
    const row = path === undefined ? undefined : index.nodes.get(path);
    if (path === undefined || !(row instanceof RowNode) || index.tree === null) return;
    const sizes = this.sizesOf(row, action, index, path);
    const before = this.splitterIndexBefore;
    this.splitterIndexBefore = null;
    const splitter = before ?? 1;
    const messages = editorMessagesPlace(index.tree);
    if (this.mode === 'editor' && messages && messages.path === path && splitter === messages.index) {
      this.setDrag(sizes[messages.index]! - (needsStrip(['messages'], this.locked()) ? STRIP_HEIGHT : 0));
      return;
    }
    if (this.isDefault()) {
      const drag = defaultDrag(this.mode, index.tree, path, splitter, sizes, this.sizeInput());
      if (drag === null) {
        this.syncSizes();
        return;
      }
      if ('messages' in drag) {
        this.setDrag(drag.messages);
        return;
      }
      this.ctx.settings.update((settings) => withSplit(settings, drag.split, drag.fraction));
      this.syncSizes();
      return;
    }
    // A splitter the person moved ends a run of Float and Dock (its shares are theirs now).
    this.origin = null;
    this.store(this.tree());
    this.syncSizes();
  }

  private splitterIndexBefore: number | null = null;

  /** Which splitter moved: the first child whose size changed is the one before it. */
  private guessSplitter(row: RowNode, sizes: readonly number[], current: readonly number[]): number {
    const children = row.getChildren();
    for (let i = 0; i < children.length; i++) {
      if (Math.abs((current[i] ?? 0) - (sizes[i] ?? 0)) > 0.5) return Math.max(1, Math.min(i + 1, children.length - 1));
    }
    return 1;
  }

  private setDrag(height: number): void {
    this.drag = { list: this.messageList().list, height: Math.round(height) };
    this.syncSizes();
  }

  /** Layout.onAction: what FlexLayout's own controls may do (rules.ts). */
  onAction = (action: Action): Action | undefined => {
    const decision = decideAction(action, {
      locked: this.locked(),
      panelOf: (tabId) => panelOfTab(tabId),
      groupPanels: (id) => {
        const node = this.model.getNodeById(id);
        return node instanceof TabSetNode ? panelsOfGroup(node) : null;
      },
    });
    if (decision.kind === 'refuse') return undefined;
    if (decision.kind === 'hide') {
      // FlexLayout's Delete key has moved the focus to the next tab of the strip already; P3.1.8
      // wants it in the panel of the group's selected tab.
      const focusInGroup = [...decision.panels, ...decision.viewers].find((panel) => this.focusInGroupOf(panel));
      const before = this.tree();
      for (const panel of decision.panels) hidePanel(this.ctx, panel);
      for (const viewer of decision.viewers) this.closeTransient(viewer);
      if (focusInGroup !== undefined) this.moveFocusAfterClose(focusInGroup, before);
      return undefined;
    }
    if (action.type === Actions.ADJUST_WEIGHTS && !action.isAdjusting()) this.noteSplitter(action);
    return action;
  };

  /** Before a splitter's action is applied: which splitter it is (the sizes before and after). */
  noteSplitter(action: Action): void {
    const index = indexModel(this.model);
    const path = index.pathOfId.get(String(action.data.nodeId));
    const row = path === undefined ? undefined : index.nodes.get(path);
    if (path === undefined || !(row instanceof RowNode)) return;
    const current = (row.getChildren() as (RowNode | TabSetNode)[]).map((child) => child.getWeight());
    const now = this.sizesOf(row, Actions.adjustWeights(row.getId(), current), index, path);
    this.splitterIndexBefore = this.guessSplitter(row, this.sizesOf(row, action, index, path), now);
  }

  /** The children's sizes in px that an ADJUST_WEIGHTS action gives a row. */
  private sizesOf(row: RowNode, action: Action, index: LiveIndex, path: string): number[] {
    const weights = (action.data.weights as number[]) ?? [];
    const horizontal = nodeAt(index.tree, path)?.type === 'row';
    const rect = row.getRect();
    let length = horizontal ? rect.width : rect.height;
    if (!(length > 0)) {
      // Not laid out (tests under Node): the root spans the dock, its children span its other side.
      const depth = path.split('.').length - 1;
      if (depth <= 1) length = horizontal ? this.size.width : this.size.height;
    }
    const extent = length - SPLITTER_SIZE * (weights.length - 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    return weights.map((weight) => (extent * weight) / total);
  }

  /** P2.2 setOnAllowDrop: no drop while locked; the Output panel needs 160 x 120 px. */
  private allowDrop(dragNode: Node, dropInfo: DropInfo): boolean {
    const panels: string[] = [];
    const collect = (node: Node) => {
      if (node instanceof TabNode) {
        const panel = panelOfTab(node.getId());
        if (panel) panels.push(panel);
      } else for (const child of node.getChildren()) collect(child);
    };
    collect(dragNode);
    // The border that keeps the floating panels' tabs is no place to drop (version 1.1).
    if (dropInfo.node instanceof BorderNode) return false;
    // Into a group (its middle or its strip): the group's size; beside it or at an edge: the
    // place the drop would give (FlexLayout's outline). A drop on a strip outlines a 3 px marker.
    const into = dropInfo.location === DockLocation.CENTER && dropInfo.node instanceof TabSetNode;
    return allowsDrop(panels, into ? dropInfo.node.getRect() : dropInfo.rect, this.locked());
  }

  // --- sizes -----------------------------------------------------------------------------------

  /** Sets the weights the default arrangement and the content-sized groups want (no action when they hold). */
  syncSizes(): void {
    if (this.size.width <= 0 || this.size.height <= 0) return;
    const index = indexModel(this.model);
    if (index.tree === null) return;
    const input = this.sizeInput();
    const desired = this.isDefault()
      ? sizeDefaultTree(this.mode, index.tree, input)
      : sizeContentGroups(this.mode, index.tree, input, (path) => this.heightOf(index, path));
    const actions: Action[] = [];
    const visit = (want: DockNode, path: string) => {
      if (want.type === 'tabs') return;
      const row = index.nodes.get(path);
      if (row instanceof RowNode) {
        const children = row.getChildren() as (RowNode | TabSetNode)[];
        if (children.length === want.children.length) {
          const have = children.map((child) => child.getWeight());
          const haveTotal = have.reduce((sum, weight) => sum + weight, 0) || 1;
          const wantWeights = want.children.map((child) => child.weight);
          const wantTotal = wantWeights.reduce((sum, weight) => sum + weight, 0) || 1;
          const extent = Math.max(this.size.width, this.size.height);
          const differs = have.some(
            (weight, i) => Math.abs(weight / haveTotal - wantWeights[i]! / wantTotal) * extent > 0.3,
          );
          if (differs) actions.push(Actions.adjustWeights(row.getId(), wantWeights));
        }
      }
      want.children.forEach((child, i) => visit(child, `${path}.${i}`));
    };
    visit(desired, 'root');
    if (actions.length === 0) return;
    this.syncing++;
    try {
      for (const action of actions) this.dispatch(action);
    } finally {
      this.syncing--;
    }
    this.decorateSoon();
  }

  private heightOf(index: LiveIndex, path: string): number | null {
    const tree = index.tree;
    if (path === 'root' && tree?.type === 'column') return this.size.height;
    if (path === 'root.0' && tree?.type === 'row') return this.size.height;
    const node = index.nodes.get(path);
    const height = node?.getRect().height ?? 0;
    return height > 0 ? height : null;
  }

  // --- the shell's tool state, the view --------------------------------------------------------

  /** ShellState.activeTool / outputInFront follow the dock's selected tabs (P3.1.5). */
  private syncShell(): void {
    let tools: TabSetNode | undefined;
    this.model.visitNodes((node) => {
      if (!tools && node instanceof TabSetNode && panelsOfGroup(node).some(isToolPanel)) tools = node;
    });
    if (!tools) return;
    const selected = panelOfTab(tools.getSelectedNode()?.getId() ?? '');
    const withOutput = panelsOfGroup(tools).includes('output');
    this.shell.setState((state) => {
      let next = state;
      if (
        selected !== null &&
        isToolPanel(selected) &&
        (state.activeTool !== selected || (withOutput && state.outputInFront))
      ) {
        next = { ...next, activeTool: selected, outputInFront: withOutput ? false : next.outputInFront };
      } else if (selected === 'output' && withOutput && !state.outputInFront) {
        next = { ...next, outputInFront: true };
      }
      return next;
    });
  }

  private updateView(): void {
    const tree = this.tree();
    const view: EngineView = {
      registersAuto: this.mode === 'simulator' && registersPlace(tree) !== null,
      collapseApplies: !(this.mode === 'simulator' && this.isDefault() && this.narrow),
    };
    if (view.registersAuto === this.view.registersAuto && view.collapseApplies === this.view.collapseApplies) return;
    this.view = view;
    for (const listener of [...this.viewListeners]) listener();
  }

  // --- DOM: names, roles, reading order, focus -------------------------------------------------

  private afterRender(): void {
    this.ensureFloatsRendered();
    this.decorate();
    this.ensureReadingOrder();
  }

  private decorateSoon(): void {
    const view = this.element?.ownerDocument.defaultView;
    if (!view) return;
    view.cancelAnimationFrame(this.frame);
    this.frame = view.requestAnimationFrame(() => this.decorate());
  }

  private orderSoon(): void {
    const view = this.element?.ownerDocument.defaultView;
    if (!view) return;
    view.requestAnimationFrame(() => this.ensureReadingOrder());
  }

  /** Splitter names and inert splitters, the groups' roles (splitters.ts). */
  decorate(): void {
    const root = this.element;
    if (!root) return;
    // FlexLayout 0.11.1 measures its strips and splitters with an element of its own that holds
    // the text `FindBorderBarSize`, moved off the screen by CSS only: a screen reader read it in
    // every mode. It is no content (errata N1 27).
    for (const metrics of Array.from(root.querySelectorAll('.flexlayout__layout_metrics'))) {
      if (metrics.getAttribute('aria-hidden') !== 'true') metrics.setAttribute('aria-hidden', 'true');
    }
    const index = indexModel(this.model);
    const plans = splitterPlans(this.mode, index.tree, {
      isDefault: this.isDefault(),
      outputCollapsed: this.shell.getState().outputCollapsed,
      title: this.title,
    });
    const keyOf = (flexPath: string): string | null => {
      const match = /^(.*)\/s(\d+)$/.exec(flexPath);
      if (!match) return null;
      const path = index.pathOfFlex.get(match[1] ?? '');
      return path === undefined || path === 'wrapper' ? null : `${path}/${Number(match[2]) + 1}`;
    };
    // Lock Layout on: the splitters and the shown strips get their slots in the content layer, at
    // today's places in the Tab order and the reading order (order.ts, errata N1 25).
    const locked = this.locked();
    const relocation = locked
      ? relocationPlan(this.mode, index.tree, plans, (_group, path) => {
          const node = index.nodes.get(path);
          return node instanceof TabSetNode && node.isEnableTabStrip();
        })
      : EMPTY_RELOCATION;
    decorateSplitters(root, plans, keyOf, relocation.splitters);
    decorateStrips(root, relocation, index.flexOfPath);
    decorateTabPanels(
      root,
      (tabId) => {
        const parent = this.model.getNodeById(tabId)?.getParent();
        return parent instanceof TabSetNode && parent.isEnableTabStrip();
      },
      (tabId) => isViewerId(panelOfTab(tabId) ?? ''),
      locked,
      (tabId) => {
        const panel = panelOfTab(tabId);
        return panel !== null && this.isFloating(panel) ? FLOATING_REGION(this.title(panel)) : null;
      },
    );
    this.applyFloatStyles();
    this.setRelocation(relocation);
    // The tab list of the tool panels' group keeps today's name (`Tool panels`).
    const narrowOutput = this.narrowOutputStrip();
    for (const strip of Array.from(root.querySelectorAll('.flexlayout__tabset'))) {
      const list = strip.querySelector('[role="tablist"]');
      if (!list) continue;
      const panels = Array.from(list.querySelectorAll('[role="tab"][id^="flexlayout-tabbutton-"]')).map(
        (tab) => panelOfTab(tab.id.slice('flexlayout-tabbutton-'.length)) ?? '',
      );
      const label = groupLabel(panels, narrowOutput);
      if (label === undefined) list.removeAttribute('aria-label');
      else if (list.getAttribute('aria-label') !== label) list.setAttribute('aria-label', label);
    }
  }

  private setRelocation(relocation: Relocation): void {
    const key = JSON.stringify([...relocation.slots].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    this.relocation = relocation;
    if (key === this.slotsKey) return;
    this.slotsKey = key;
    for (const listener of [...this.slotListeners]) listener();
  }

  subscribeSlots = (listener: () => void) => {
    this.slotListeners.add(listener);
    return () => this.slotListeners.delete(listener);
  };

  /** The id of the block a panel's slot owns before or after its content, or null (order.ts). */
  slotOf(panel: string, side: 'before' | 'after'): string | null {
    return this.relocation.slots.get(panel)?.[side] ?? null;
  }

  /**
   * The DOM order of the groups' panels follows their position (P3.1.8): FlexLayout renders tab
   * content in one flat layer in the order the tabs were first rendered; after a change the dock
   * puts that order back to the reading order (errata N1: it sets the order FlexLayout keeps and
   * lets React move the elements). The focus is put back where it was if the move took it.
   */
  ensureReadingOrder(): void {
    const model = this.rendered;
    if (!model || model !== this.model) return;
    const layouts = (model as unknown as ModelInternals).getLayouts?.();
    const controller = layouts?.get(Model.MAIN_LAYOUT_ID)?.getController?.() as LayoutControllerInternals | undefined;
    if (!controller || !Array.isArray(controller._orderedTabIds) || typeof controller.redrawLayout !== 'function')
      return;
    const want = tabIdsInReadingOrder(model);
    const have = controller._orderedTabIds.filter((id) => want.includes(id));
    if (sameList(have, want)) return;
    const owner = this.element?.ownerDocument;
    // The element to give the focus back to is the one that held it last before the move took it:
    // a focus request that lands between this call and the redraw (a panel just shown) wins over
    // the element focused now.
    let active = owner?.activeElement as HTMLElement | null | undefined;
    const follow = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && typeof target.focus === 'function') active = target;
    };
    owner?.addEventListener('focusin', follow, true);
    // React moves the element of a tab whose place in the order changed (a panel that floats goes
    // after everything docked, version 1.1); the browser then loses the scroll positions inside it.
    // They are put back once the element is in its new place.
    const scrolled = this.scrollPositions();
    controller._orderedTabIds = [...want];
    controller.redrawLayout();
    const view = owner?.defaultView;
    if (!view) {
      owner?.removeEventListener('focusin', follow, true);
      return;
    }
    view.requestAnimationFrame(() => {
      owner?.removeEventListener('focusin', follow, true);
      for (const [element, { top, left }] of scrolled) {
        if (!element.isConnected) continue;
        if (element.scrollTop !== top) element.scrollTop = top;
        if (element.scrollLeft !== left) element.scrollLeft = left;
      }
      const document = this.element?.ownerDocument;
      if (
        active &&
        document &&
        active.isConnected &&
        document.activeElement !== active &&
        (document.activeElement === document.body || document.activeElement === null)
      ) {
        active.focus({ preventScroll: true });
      }
    });
  }

  /** The scroll positions inside the panels' elements that are not at their start. */
  private scrollPositions(): Map<Element, { top: number; left: number }> {
    const positions = new Map<Element, { top: number; left: number }>();
    const root = this.element;
    if (!root) return positions;
    for (const element of Array.from(root.querySelectorAll('.flexlayout__tab *'))) {
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
        positions.set(element, { top: element.scrollTop, left: element.scrollLeft });
      }
    }
    return positions;
  }

  /** The focus is in `panel`, on its tab, or on another tab of its group. */
  private focusInGroupOf(panel: string): boolean {
    const focused = this.focusedPanel();
    if (focused === null) return false;
    if (focused === panel) return true;
    const group = groupOf(this.model, this.mode, panel);
    return group !== undefined && groupOf(this.model, this.mode, focused) === group && this.focusOnTabButton();
  }

  private focusOnTabButton(): boolean {
    const active = this.element?.ownerDocument.activeElement;
    return active?.closest('.flexlayout__tab_button') != null;
  }

  /** The panel that holds the focus (its content or its tab button), or null. */
  private focusedPanel(): string | null {
    const document = this.element?.ownerDocument;
    const active = document?.activeElement;
    if (!active || !this.element?.contains(active)) return null;
    const region = active.closest('[data-e68-panel]')?.getAttribute('data-e68-panel');
    if (region && this.has(region)) return region;
    // A floating window's title bar (or its buttons) is the panel's, as its tab button is (P9.2:
    // the window's Close closes the panel exactly as its x does, the focus included).
    const bar = active.closest('[data-e68-float-bar]')?.getAttribute('data-e68-float-bar');
    if (bar && this.has(bar)) return bar;
    const button = active.closest('.flexlayout__tab_button');
    const tabId = button?.id.startsWith('flexlayout-tabbutton-')
      ? button.id.slice('flexlayout-tabbutton-'.length)
      : null;
    return tabId === null ? null : panelOfTab(tabId);
  }

  /**
   * P3.1.8: when the panel that held the focus is gone, the focus goes to the selected panel of
   * its group, or, when the group is gone, to the Editor panel or the Registers panel.
   */
  private moveFocusAfterClose(panel: string | null, before: DockNode | null): void {
    if (panel === null || this.has(panel)) return;
    const group = groupsOf(before).find((node) => node.panels.includes(panel));
    const remaining = group?.panels.filter((id) => id !== panel && this.has(id)) ?? [];
    let target = this.mode === 'editor' ? 'editor' : 'registers';
    if (remaining.length > 0) {
      const node = groupOf(this.model, this.mode, remaining[0]!);
      target = panelOfTab(node?.getSelectedNode()?.getId() ?? '') ?? remaining[0]!;
    }
    focusPanel(this.ctx, target);
  }

  // --- DockLive ---------------------------------------------------------------------------------

  reveal(id: string, select: boolean): void {
    if (!isPanelOf(this.mode, id)) return;
    if (!this.has(id)) {
      if (isViewerId(id)) return;
      this.reconcile();
      if (!this.has(id)) {
        const tree = this.tree();
        if (!tree) return;
        const dock = readDock(this.settings());
        this.rebuild(insertPanel(tree, this.mode, id, dock.parked[id]));
      }
    }
    if (select) this.select(id);
  }

  /** Selects a panel's tab; no action when it is selected already (P3.1.5). */
  private select(id: string): boolean {
    const tab = tabNodeOf(this.model, this.mode, id);
    if (!tab) return false;
    // A floating window has no tab to select (its tab is in the hidden border, where a selection
    // would open the border): it comes to the front instead (P9.2).
    if (this.isFloating(id)) {
      this.raise(id);
      return true;
    }
    if (!tab.isSelected()) this.dispatch(Actions.selectTab(tab.getId()));
    return true;
  }

  park(id: string): void {
    if (id === 'output' || !this.has(id)) return;
    if (this.isFloating(id)) {
      // Hidden while it floats: its window goes, its entry stays (it floats again when shown).
      const tree = this.tree();
      if (tree) this.rebuild(tree);
      return;
    }
    const tree = this.tree();
    if (!tree) return;
    const removed = removePanel(tree, id);
    if (removed.tree === null) return;
    this.rebuild(removed.tree);
    if (!this.isDefault()) this.store(removed.tree, removed.parked ? { [id]: removed.parked } : {});
    this.syncSizes();
  }

  present(id: string): boolean {
    return this.select(id);
  }

  openTransient(spec: TransientSpec): void {
    const known = this.transients.has(spec.id);
    this.transients.add(spec);
    if (known && this.has(spec.id)) {
      this.select(spec.id);
      return;
    }
    const target = groupOf(this.model, this.mode, 'editor');
    if (!target) return;
    this.dispatch(Actions.addTab(tabJson(spec.id, this.jsonOptions()), target.getId(), DockLocation.CENTER, -1, true));
    this.announcer.announce(ANNOUNCE.opened(spec.title));
  }

  selectTransient(id: string): boolean {
    return this.transients.has(id) && this.select(id);
  }

  /**
   * A document was made the one a person works on (opened, new, chosen, reloaded: the document
   * service's `shown`, features/documents), or an Editor command changed what the editor area shows
   * (Cascade, Tile, the split commands, Close File: features/editor and features/documents). Today
   * the editor always shows it (P1.2); here a viewer's
   * tab may be in front of the Editor's in its group, so the Editor's tab comes forward. Nothing
   * else changes: a tool panel a person put in front of the Editor stays (their own arrangement),
   * and the keyboard focus stays where it is, unless it was inside the viewer that is now hidden:
   * then it goes to the editor, as for a panel that goes away (P3.1.8). Errata N1 28.
   */
  documentShown(): void {
    if (this.mode !== 'editor') return;
    const group = groupOf(this.model, this.mode, 'editor');
    const front = panelOfTab(group?.getSelectedNode()?.getId() ?? '');
    if (front === null || !isViewerId(front)) return;
    const focusInViewer = this.focusInContentOf(front);
    this.select('editor');
    if (focusInViewer && this.ctx.store.getState().mode === 'editor') this.focusEditorOnceShown(front);
  }

  /**
   * Puts the focus into the active document's text once the editor shows it. The editor takes a
   * new active document into its pane a render later (EditorArea's syncPanes), and a focus request
   * made at once would land on the text of the document it showed before, which then goes away
   * (seen in Chromium: the focus ended on the page's body). Gives up after about a second, and when
   * the focus has gone somewhere a person can see meanwhile.
   */
  private focusEditorOnceShown(viewer: string, tries = 60): void {
    const element = this.element;
    if (!element || typeof window === 'undefined') {
      focusPanel(this.ctx, 'editor');
      return;
    }
    const later = () => {
      if (tries > 0) window.setTimeout(() => this.focusEditorOnceShown(viewer, tries - 1), 16);
    };
    const document = element.ownerDocument;
    const active = document.activeElement as HTMLElement | null;
    const lost =
      !active ||
      active === document.body ||
      this.focusInContentOf(viewer) ||
      !active.checkVisibility({ visibilityProperty: true });
    if (!lost) return;
    const id = this.ctx.store.getState().documents.activeId;
    const region = element.querySelector<HTMLElement>('[data-e68-panel="editor"]');
    const text =
      id === null
        ? null
        : region?.querySelector<HTMLElement>(`[data-e68-document="${CSS.escape(id)}"] [data-e68-panel-focus]`);
    if (id === null || (text && text.checkVisibility({ visibilityProperty: true }))) {
      focusPanel(this.ctx, 'editor');
      return;
    }
    later();
  }

  /** The keyboard focus is inside the content of `panel` (not on its tab button). */
  private focusInContentOf(panel: string): boolean {
    const active = this.element?.ownerDocument.activeElement;
    if (!active || !this.element?.contains(active)) return false;
    return active.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') === panel;
  }

  closeTransient(id: string): void {
    if (!this.transients.has(id)) return;
    const focus = this.focusedPanel();
    const before = this.tree();
    const tab = tabNodeOf(this.model, this.mode, id);
    const floated = this.isFloating(id);
    if (floated) this.dropFloat(id);
    if (tab) this.dispatch(Actions.deleteTab(tab.getId()));
    this.transients.close(id);
    if (floated && tab) this.rebuild(this.tree() ?? this.treeFromSettings());
    this.moveFocusAfterClose(focus === id ? id : null, before);
  }

  closeAllTransients(): void {
    for (const id of this.transients.ids()) this.closeTransient(id);
  }

  move(panel: string, target: DockMoveTarget): void {
    // A floating panel moved by Move Panel To... is docked first, then moved (version 1.1).
    if (this.isFloating(panel)) this.dock(panel, false);
    const plan = moveAction(this.model, this.mode, panel, target, this.title);
    this.apply(plan, panel);
  }

  /** The tab menu's Move Left/Right/Up/Down. */
  step(panel: string, direction: Direction): void {
    const live = liveRects(this.model);
    const rects = live.size > 0 ? live : layoutRects(this.model, this.size.width, this.size.height, SPLITTER_SIZE);
    this.apply(stepAction(this.model, this.mode, panel, direction, rects, this.title), panel);
  }

  /** Move Tab Earlier (-1) / Later (+1); null when disabled. */
  tabOrderPlan(panel: string, delta: -1 | 1): PlannedMove | null {
    return tabOrderAction(this.model, this.mode, panel, delta, this.title);
  }

  tabOrder(panel: string, delta: -1 | 1): void {
    this.apply(this.tabOrderPlan(panel, delta), panel);
  }

  /** Makes a planned move (a choice that would change nothing is accepted and does nothing). */
  private apply(plan: PlannedMove | null, panel: string): void {
    if (!plan || moveTargetsChangeNothing(this.model, plan.action)) {
      focusPanel(this.ctx, panel);
      return;
    }
    this.pendingAnnouncement = plan.announce;
    this.dispatch(plan.action);
    this.pendingAnnouncement = null;
    focusPanel(this.ctx, panel);
  }

  reset(): void {
    const splits: SplitId[] = this.mode === 'editor' ? ['editor.files'] : ['sim.columns', 'sim.messages', 'sim.tools'];
    this.drag = null;
    // Reset Layout docks every panel (P9.2); each remembers the place it floated at.
    for (const window of this.floats) if (!isViewerId(window.panel)) this.remembered[window.panel] = window.rect;
    this.floats = [];
    this.stack = [];
    this.preview.clear();
    this.origin = null;
    this.reserve = 0;
    const remembered = { ...this.remembered };
    this.ctx.settings.update((settings) => {
      let next = withDock(settings, (dock) => {
        const copy = { ...dock };
        delete copy[this.mode];
        copy.floating = { ...dock.floating, [this.mode]: { windows: [], remembered } };
        return copy;
      });
      for (const id of splits) next = withSplit(next, id, DEFAULT_SPLIT_FRACTIONS[id]);
      return next;
    });
    this.reconcile();
    this.announcer.announce(ANNOUNCE.reset);
  }

  lockChanged(on: boolean, announce: boolean): void {
    this.reconcile();
    if (announce) this.announcer.announce(on ? ANNOUNCE.locked : ANNOUNCE.unlocked);
  }

  describe(): DockDescription[] {
    const docked: DockDescription[] = groupsOf(this.tree()).flatMap((group, index) =>
      group.panels.map((panel) => ({ panel, title: this.title(panel), group: index + 1 })),
    );
    const floating: DockDescription[] = this.shownFloats().map((panel) => ({
      panel,
      title: this.title(panel),
      group: 0,
      floating: true as const,
    }));
    return [...docked, ...floating];
  }

  /** A default splitter's double-click or Enter: back to today's default (P3.1.1, the kit's rule). */
  restoreSplit(role: SplitRole): void {
    if (role === 'editor.messages') {
      this.drag = null;
      this.syncSizes();
      return;
    }
    this.ctx.settings.update((settings) => withSplit(settings, role, DEFAULT_SPLIT_FRACTIONS[role]));
  }

  /**
   * A default splitter's Shift+arrows, Home and End (the kit's Splitter keys; FlexLayout moves a
   * splitter by 10 px with the plain arrows only). Returns true when the key was used.
   */
  splitterKey(role: SplitRole, key: string, shift: boolean): boolean {
    const input = this.sizeInput();
    const vertical =
      role === 'editor.files' ||
      (role === 'sim.columns' && !(this.mode === 'simulator' && this.isDefault() && this.narrow));
    const step = shift ? 50 : 10;
    if (role === 'editor.messages') {
      const height = this.messagesRule();
      const next = key === 'ArrowUp' ? height + step : key === 'ArrowDown' ? height - step : null;
      if (next === null) return false;
      this.setDrag(Math.max(5, next));
      return true;
    }
    const available = this.availableFor(role, input);
    if (available <= 0) return false;
    const pixels = splitPixels(input.settings, role, available);
    const grows = role === 'sim.messages' || role === 'sim.tools' ? -1 : 1;
    let value: number | null = null;
    const forward = vertical ? 'ArrowRight' : 'ArrowDown';
    const back = vertical ? 'ArrowLeft' : 'ArrowUp';
    if (key === forward) value = pixels.value + step * grows;
    else if (key === back) value = pixels.value - step * grows;
    else if (key === 'Home') value = pixels.min;
    else if (key === 'End') value = pixels.max;
    if (value === null) return false;
    const clamped = Math.min(Math.max(value, pixels.min), pixels.max);
    this.ctx.settings.update((settings) => withSplit(settings, role, clamped / available));
    return true;
  }

  private availableFor(role: SplitId, input: SizeInput): number {
    const narrow = this.mode === 'simulator' && this.isDefault() && this.narrow;
    switch (role) {
      case 'editor.files':
        return input.width;
      case 'sim.columns':
        return narrow ? input.height : input.width;
      case 'sim.tools':
        return input.height;
      case 'sim.messages': {
        const tree = this.tree();
        const registers = registersPlace(tree);
        const column = registers === null ? undefined : nodeAt(tree, registers);
        const top = column && column.type !== 'tabs' ? column.children[0]!.weight : 0;
        const left = narrow ? splitPixels(input.settings, 'sim.columns', input.height).value : input.height;
        return left - top - SPLITTER_SIZE;
      }
      default:
        return 0;
    }
  }

  // --- floating windows (version 1.1, ARCHITECTURE-PLUS P9.2; M1) ------------------------------
  //
  // A floating panel's tab stays in the model, in a border FlexLayout never shows (model.ts
  // FLOAT_BORDER), so its content is the same component in the same place of the React tree and
  // is never created anew. FlexLayout keeps positioning its element (`.flexlayout__tab`) as a
  // hidden tab; dock.css draws an element marked `data-e68-float` at the window's place instead
  // (custom properties set here), and DockContent draws the title bar and the edges inside it.

  /** The floating windows as stored for the mode; the viewers' windows (never stored) are kept. */
  private loadFloats(): void {
    const stored = floatingOf(readDock(this.settings()), this.mode);
    const viewers = this.floats.filter((window) => isViewerId(window.panel));
    this.floats = [...stored.windows.map((window) => ({ ...window })), ...viewers];
    this.remembered = { ...stored.remembered };
    this.origin = stored.origin ?? null;
    this.reserve = stored.reserve ?? 0;
    const names = this.floats.map((window) => window.panel);
    this.stack = [
      ...this.stack.filter((panel) => names.includes(panel)),
      ...names.filter((panel) => !this.stack.includes(panel)),
    ];
    for (const panel of [...this.preview.keys()]) if (!names.includes(panel)) this.preview.delete(panel);
    this.updateFloatViews();
  }

  /** The panel floats (shown or hidden). */
  isFloating(panel: string): boolean {
    return this.floats.some((window) => window.panel === panel);
  }

  private floatEntry(panel: string): StoredWindow | undefined {
    return this.floats.find((window) => window.panel === panel);
  }

  /** The floating panels that are shown (visible, or an open viewer), in the order they floated. */
  private shownFloats(): string[] {
    const visible = new Set(this.visiblePanels());
    return this.floats
      .filter((window) => (isViewerId(window.panel) ? this.transients.has(window.panel) : visible.has(window.panel)))
      .map((window) => window.panel);
  }

  /** The dock's size; before it is laid out, a size of a small window (the windows are bounded when shown). */
  private area(): Area {
    if (this.size.width > 0 && this.size.height > 0) return { ...this.size };
    return { width: 1200, height: 700 };
  }

  /** Where a docked panel's content is now, in the dock's coordinates (null before layout). */
  private dockedRectOf(panel: string): DockRect | null {
    const tab = tabNodeOf(this.model, this.mode, panel);
    const rect = tab?.getRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  /** The tab strip of a docked panel's group as drawn now, in the dock's coordinates (null: none shown). */
  private stripRectOf(panel: string): DockRect | null {
    const root = this.element;
    const button = root?.ownerDocument.getElementById(`flexlayout-tabbutton-${tabIdOf(this.mode, panel)}`);
    const strip = button?.closest('.flexlayout__tabset_tabbar_outer');
    if (!root || !strip || strip.getClientRects().length === 0) return null;
    const box = strip.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return null;
    return { x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height };
  }

  /**
   * The width of the buttons at the right end of a panel's title bar, with the window's right border
   * (P9.8 point 4): measured on the page where the window is drawn (fonts differ between systems),
   * else the measured figures of floating.ts.
   */
  private buttonsOf(panel: string): number {
    const bar = this.element?.querySelector<HTMLElement>(`[data-e68-float-bar="${CSS.escape(panel)}"]`);
    const title = bar?.querySelector<HTMLElement>('[data-e68-float-title]');
    if (bar && title && bar.offsetWidth > 0 && title.offsetWidth > 0) {
      return bar.offsetWidth - title.offsetWidth + WINDOW_BORDER;
    }
    return titleButtonsWidth(isClosablePanel(panel));
  }

  /** P9.2: a docked panel of this dock that is not the last docked one; a hidden one (it floats when shown). */
  canFloat(panel: string): boolean {
    if (!isPanelOf(this.mode, panel) || this.isFloating(panel)) return false;
    if (!this.has(panel)) return !isViewerId(panel);
    return panelsOf(this.tree()).length > 1;
  }

  float(panel: string, rect?: DockRect): void {
    if (this.isFloating(panel)) {
      if (rect) this.commitRect(panel, rect);
      this.raise(panel);
      return;
    }
    if (!this.canFloat(panel)) return;
    const tree = this.tree();
    const shown = this.has(panel);
    const stripBefore = shown && !rect && !this.remembered[panel] ? this.stripRectOf(panel) : null;
    let next = tree;
    let home: DockParked | undefined = readDock(this.settings()).parked[panel];
    let docked: ReturnType<typeof placeOf> = null;
    const chained = shown && !isViewerId(panel);
    if (shown && tree) {
      const removed = removePanel(tree, panel);
      if (removed.tree === null) return;
      next = removed.tree;
      home = removed.parked ?? undefined;
      docked = placeOf(tree, panel);
      // The first Float of a run remembers the arrangement it starts from (errata M1 11).
      if (chained && !this.chainIntact()) this.origin = this.originOf(tree, next);
    }
    const area = this.area();
    const min = minimumSize();
    // P9.8 point 2: the first free place of the rule of point 1, over no floating window that is
    // shown and not over the tab strip of the group the panel came from.
    const others = this.shownFloats()
      .filter((id) => id !== panel)
      .map((id) => this.shownRect(id))
      .filter((other): other is DockRect => other !== null);
    const place =
      rect ??
      this.remembered[panel] ??
      firstFloatRect(shown ? this.dockedRectOf(panel) : null, area, others, min, stripBefore);
    this.floats.push({
      panel,
      rect: atLeast(place, min),
      ...(home ? { home } : {}),
      ...(docked ? { place: docked } : {}),
    });
    this.stack = raised(this.stack, panel);
    this.updateFloatViews();
    if (next) {
      if (shown) this.rebuild(next);
      this.storeChained(next, chained);
    }
    this.syncSizes();
    if (shown) focusPanel(this.ctx, panel);
  }

  dock(panel: string, focus = true): void {
    const entry = this.floatEntry(panel);
    if (!entry) return;
    this.dropFloat(panel);
    const shown = isViewerId(panel) ? this.transients.has(panel) : this.visiblePanels().includes(panel);
    const tree = this.tree();
    if (!shown) {
      // A hidden panel docked (Reset Layout, an arrangement): it is shown where it was docked last.
      if (tree) this.store(tree, entry.home ? { [panel]: entry.home } : {});
      return;
    }
    // P9.2: where it was docked last; when that group is gone, its place in the default arrangement
    // (park.ts dockInto; errata M1 7 and 11).
    const origin = isViewerId(panel) ? null : this.originFor(panel);
    const docked = tree
      ? dockInto(
          tree,
          this.mode,
          this.defaultArrangement(),
          panel,
          { place: entry.place, parked: entry.home },
          origin?.tree,
        )
      : null;
    const home = docked?.place;
    const next: DockNode = docked ? docked.tree : { type: 'tabs', weight: 100, panels: [panel], selected: panel };
    const announcement = this.dockAnnouncement(panel, home, tree);
    const complete = origin !== null && sameShape(withoutViewers(next), origin.tree);
    if (complete && origin.wasDefault && !this.floats.some((window) => !isViewerId(window.panel))) {
      // Every panel of the run is docked again where it was, and it began in the default
      // arrangement: that is what the mode shows again, sized as it is (nothing stored).
      this.restoreDefault();
    } else {
      this.rebuild(next);
      this.storeChained(next, origin !== null);
    }
    this.syncSizes();
    if (announcement) this.announcer.announce(announcement);
    if (focus) focusPanel(this.ctx, panel);
  }

  /** The run of Float and Dock is unbroken: the stored tree has the shape the last of them stored. */
  private chainIntact(): boolean {
    const stored = readDock(this.settings())[this.mode];
    return this.origin !== null && stored !== undefined && sameShape(stored, this.origin.last);
  }

  /** The origin a panel docks back into: it floated in this unbroken run and is not docked now. */
  private originFor(panel: string): FloatOrigin | null {
    const origin = this.origin;
    if (!origin || !this.chainIntact()) return null;
    if (!panelsOf(origin.tree).includes(panel) || panelsOf(origin.last).includes(panel)) return null;
    return origin;
  }

  /**
   * The arrangement a run of Float and Dock starts from: the stored tree (its own shares; the front
   * tabs as shown), or in the default arrangement the tree as it is laid out now. `next`: the tree
   * after the first Float (the `last` until the store says otherwise).
   */
  private originOf(tree: DockNode, next: DockNode): FloatOrigin | null {
    const shown = withoutViewers(tree);
    const after = withoutViewers(next);
    if (shown === null || after === null) return null;
    const stored = readDock(this.settings())[this.mode];
    const wasDefault = stored === undefined;
    const base = stored && sameShape(stored, shown) ? selectedLike(stored, shown) : shown;
    return { tree: base, wasDefault, last: after };
  }

  /** Stores the tree; a Float's or a Dock's store moves the run of Float and Dock on. */
  private storeChained(tree: DockNode, chained: boolean): void {
    this.chainWriting = chained;
    try {
      this.store(tree);
    } finally {
      this.chainWriting = false;
    }
  }

  /** Back to the default arrangement of the mode (nothing stored), keeping the remembered rects. */
  private restoreDefault(): void {
    this.origin = null;
    this.reserve = 0;
    const remembered = { ...this.remembered };
    this.ctx.settings.update((settings) =>
      withDock(settings, (dock) => {
        const copy = { ...dock };
        delete copy[this.mode];
        copy.floating = { ...dock.floating, [this.mode]: { windows: [], remembered } };
        return copy;
      }),
    );
    this.reconcile();
  }

  /** What the live region says when a panel docks at the place it had (P3.1.8's texts). */
  private dockAnnouncement(panel: string, home: DockParked | undefined, tree: DockNode | null): string | null {
    if (!home || !panelsOf(tree).includes(home.near)) return null;
    if (home.side === 'tab') return ANNOUNCE.intoGroup(this.title(panel), this.title(home.near));
    return ANNOUNCE.beside(this.title(panel), this.title(home.near), home.side);
  }

  /** Takes a panel out of the floating windows; it remembers its rect. */
  private dropFloat(panel: string): void {
    const entry = this.floatEntry(panel);
    if (!entry) return;
    this.floats = this.floats.filter((window) => window.panel !== panel);
    this.stack = this.stack.filter((id) => id !== panel);
    this.preview.delete(panel);
    if (!isViewerId(panel)) this.remembered[panel] = entry.rect;
    this.updateFloatViews();
  }

  floating(): DockFloating[] {
    const shown = new Set(this.shownFloats());
    return this.floats.map((window) => ({
      panel: window.panel,
      rect: { ...window.rect },
      visible: shown.has(window.panel),
    }));
  }

  arrange(arrangement: DockArrangement): boolean {
    if (arrangement.mode !== this.mode) return false;
    const names = arrangement.floating.map((entry) => entry.panel);
    const all = [...panelsOf(arrangement.docked), ...names];
    const panels = DOCK_PANELS[this.mode];
    if (all.length !== panels.length || new Set(all).size !== all.length || all.some((id) => !panels.includes(id))) {
      return false;
    }
    const docked = readTree(arrangement.docked, this.mode, new Set(names));
    if (!docked) return false;
    const area = this.area();
    const min = minimumSize();
    // An entry without a rect: the default size, at the first free place of the rule of P9.8
    // point 1 (state/tiling.ts), after the entries that have their places.
    const placed = arrangement.floating.flatMap((entry) => (entry.rect ? [atLeast(entry.rect, min)] : []));
    const tiles = tileWindows(
      arrangement.floating
        .filter((entry) => entry.rect === undefined)
        .map((entry) => ({ panel: entry.panel, ...firstSizeWithin(DEFAULT_FLOAT_SIZE, area, min) })),
      { area, obstacles: placed },
    );
    const windows: StoredWindow[] = arrangement.floating.map((entry) => ({
      panel: entry.panel,
      rect: entry.rect ? atLeast(entry.rect, min) : tiles.find((tile) => tile.panel === entry.panel)!.rect,
    }));
    this.reserve = Math.max(0, Math.round(arrangement.reserve ?? 0));
    for (const window of this.floats) {
      if (!isViewerId(window.panel) && !names.includes(window.panel)) this.remembered[window.panel] = window.rect;
    }
    const viewers = this.floats.filter((window) => isViewerId(window.panel));
    this.floats = [...windows, ...viewers];
    this.stack = this.floats.map((window) => window.panel);
    this.preview.clear();
    this.origin = null;
    this.updateFloatViews();
    const result = this.reconcileTree(docked, new Set(this.visiblePanels()), readDock(this.settings()).parked);
    let tree = result.tree;
    for (const id of this.transients.ids()) if (!this.isFloating(id)) tree = insertPanel(tree, this.mode, id);
    this.rebuild(tree);
    this.store(tree, result.parked);
    this.syncSizes();
    return true;
  }

  /** Brings a floating window to the front (a click, the keyboard focus, View > panel). */
  raise(panel: string): void {
    if (!this.isFloating(panel) || this.stack[this.stack.length - 1] === panel) return;
    this.stack = raised(this.stack, panel);
    this.applyFloatStyles();
  }

  /** The rect a floating window is shown at now (moved back into the dock, P9.2), or null. */
  shownRect(panel: string): DockRect | null {
    const entry = this.floatEntry(panel);
    if (!entry) return null;
    return boundedRect(this.preview.get(panel) ?? entry.rect, this.area(), this.buttonsOf(panel));
  }

  /** A rect shown while the pointer or the keys move or size a window (null: none). Not stored. */
  previewRect(panel: string, rect: DockRect | null): void {
    if (!this.isFloating(panel)) return;
    if (rect === null) this.preview.delete(panel);
    else this.preview.set(panel, rect);
    this.applyFloatStyles();
  }

  /** The window's new place and size (the end of a move or size); stored. */
  commitRect(panel: string, rect: DockRect): void {
    const entry = this.floatEntry(panel);
    this.preview.delete(panel);
    if (!entry) return;
    const next = boundedRect(atLeast(rect, minimumSize()), this.area(), this.buttonsOf(panel));
    if (!sameRect(next, entry.rect)) {
      entry.rect = next;
      const tree = this.tree();
      if (tree) this.store(tree);
    }
    this.applyFloatStyles();
  }

  /** The size a panel gets when it floats now without a rect (remembered, else its docked size). */
  firstFloatSize(panel: string): { width: number; height: number } {
    const remembered = this.remembered[panel];
    if (remembered) return { width: remembered.width, height: remembered.height };
    const rect = firstFloatRect(this.dockedRectOf(panel), this.area(), [], minimumSize());
    return { width: rect.width, height: rect.height };
  }

  /** The minimum size of a panel's window (P9.2). */
  minimumOf(_panel: string): { width: number; height: number } {
    return minimumSize();
  }

  /** The area the windows are bounded by (the dock). */
  bounds(): Area {
    return this.area();
  }

  /** Marks the floating panels' tabs rendered once the dock is laid out (their border has no size). */
  private ensureFloatsRendered(): void {
    if (this.size.width <= 0 || this.size.height <= 0) return;
    let changed = false;
    for (const panel of this.shownFloats()) {
      const tab = tabNodeOf(this.model, this.mode, panel) as (TabNode & TabNodeInternals) | undefined;
      if (tab && typeof tab.isRendered === 'function' && !tab.isRendered()) {
        tab.setRendered?.(true);
        changed = true;
      }
    }
    if (changed) this.controller()?.redrawLayout?.();
  }

  private controller(): LayoutControllerInternals | undefined {
    const layouts = (this.model as unknown as ModelInternals).getLayouts?.();
    return layouts?.get(Model.MAIN_LAYOUT_ID)?.getController?.() as LayoutControllerInternals | undefined;
  }

  /** Puts each shown floating window at its place, size and z-order (dock.css `[data-e68-float]`). */
  applyFloatStyles(): void {
    const root = this.element;
    if (!root) return;
    const shown = this.shownFloats();
    this.applyReserve(root, shown);
    for (const element of Array.from(root.querySelectorAll<HTMLElement>('.flexlayout__tab[data-e68-float]'))) {
      if (shown.includes(element.getAttribute('data-e68-float') ?? '')) continue;
      element.removeAttribute('data-e68-float');
      for (const name of FLOAT_PROPERTIES) element.style.removeProperty(name);
    }
    const area = this.area();
    for (const panel of shown) {
      const element = root.querySelector<HTMLElement>(`[id="flexlayout-tab-${tabIdOf(this.mode, panel)}"]`);
      const entry = this.floatEntry(panel);
      if (!element || !entry) continue;
      const rect = boundedRect(this.preview.get(panel) ?? entry.rect, area, this.buttonsOf(panel));
      const values: Record<(typeof FLOAT_PROPERTIES)[number], string> = {
        '--e68-float-x': `${rect.x}px`,
        '--e68-float-y': `${rect.y}px`,
        '--e68-float-width': `${rect.width}px`,
        '--e68-float-height': `${rect.height}px`,
        '--e68-float-z': String(zIndexOf(this.stack, panel)),
      };
      for (const [name, value] of Object.entries(values)) {
        if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
      }
      if (element.getAttribute('data-e68-float') !== panel) element.setAttribute('data-e68-float', panel);
    }
  }

  /**
   * The room kept at the right of the dock for the floating windows (P9.8 point 1, P9.9 point 4,
   * P9.10 point 3): the docked panels are laid out left of it (dock.css `[data-e68-reserve]`) as far
   * as shown floating windows lie in it, and only while they fill at least half of its height
   * (state/tiling.ts `keptRoom`): by the places the windows are stored
   * at, not the place a window is being dragged or sized to, so nothing moves under a drag and the
   * room changes when it ends. With no window in it, or nothing floating, the docked panels take the
   * whole dock, so that with nothing floating the page is 1.0.0's. They keep at least 320 px.
   */
  private applyReserve(root: HTMLElement, shown: readonly string[]): void {
    const width = this.size.width;
    const wanted = this.keptRoomNow(shown);
    const reserve = width > 0 ? Math.max(0, Math.min(Math.round(wanted), Math.floor(width) - RESERVE_LEAVES)) : 0;
    if (reserve === this.reserveShown) return;
    this.reserveShown = reserve;
    if (reserve > 0) {
      root.style.setProperty('--e68-dock-reserve', `${reserve}px`);
      root.setAttribute('data-e68-reserve', String(reserve));
    } else {
      root.style.removeProperty('--e68-dock-reserve');
      root.removeAttribute('data-e68-reserve');
    }
    this.controller()?.redrawLayout?.();
  }

  /**
   * The room kept for the windows now (P9.9 point 4, P9.10 point 3), CSS px, before the 320 px the
   * docked panels keep: the arrangement's room as far as shown windows lie in it at their stored
   * places, and 0 while those fill less than half of the dock's height.
   */
  keptRoomNow(shown: readonly string[] = this.shownFloats()): number {
    const area = this.area();
    const rects = shown
      .filter((panel) => !isViewerId(panel))
      .map((panel) => this.floatEntry(panel))
      .filter((entry): entry is StoredWindow => entry !== undefined)
      .map((entry) => boundedRect(entry.rect, area, this.buttonsOf(entry.panel)));
    return keptRoom(this.reserve, this.size, rects);
  }

  /** The room the docked panels are laid out in now, CSS px (the dock less the reserve). */
  dockedWidth(): number {
    return Math.max(0, this.size.width - this.reserveShown);
  }

  subscribeFloats = (listener: () => void) => {
    this.floatListeners.add(listener);
    return () => this.floatListeners.delete(listener);
  };

  /** The title bar's facts of a floating panel, or null when it is docked. */
  floatViewOf = (panel: string): FloatView | null => this.floatViews.get(panel) ?? null;

  private updateFloatViews(): void {
    const next = new Map<string, FloatView>();
    for (const window of this.floats) {
      const old = this.floatViews.get(window.panel);
      const view: FloatView = {
        panel: window.panel,
        title: this.title(window.panel),
        closable: isClosablePanel(window.panel),
      };
      next.set(window.panel, old && old.title === view.title && old.closable === view.closable ? old : view);
    }
    const same =
      next.size === this.floatViews.size && [...next].every(([panel, view]) => this.floatViews.get(panel) === view);
    this.floatViews = next;
    if (!same) for (const listener of [...this.floatListeners]) listener();
  }
}

/** The width the docked panels keep at least when room is kept for floating windows. */
const RESERVE_LEAVES = 320;

/** The custom properties a floating window's element gets (dock.css). */
const FLOAT_PROPERTIES = [
  '--e68-float-x',
  '--e68-float-y',
  '--e68-float-width',
  '--e68-float-height',
  '--e68-float-z',
] as const;

/** A rect of at least the minimum size. */
function atLeast(rect: DockRect, min: { width: number; height: number }): DockRect {
  return { ...rect, width: Math.max(min.width, rect.width), height: Math.max(min.height, rect.height) };
}
