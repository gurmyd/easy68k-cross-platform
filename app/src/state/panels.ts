// Showing, hiding and focusing panels (ARCHITECTURE.md 2.3, 2.4, 2.10). Owner: W3.
//
// Feature packages contribute panels as PanelSpec objects (FeatureModule.panels). The shell puts
// each one into the region that carries its id (state/layout.ts lists the ids). This module is
// what feature code calls to act on panels:
//
//   showPanel(ctx, 'memory')       View > Memory: make it visible, bring its tab to the front and
//                                  move the keyboard focus into it (2.3)
//   showPanel(ctx, 'output', { focus: false })    host.ioShow(): visible, focus unchanged (2.10)
//   hidePanel(ctx, 'memory')       the `x` of a tool tab
//   focusPanel(ctx, 'listing')     host.focusMain()
//   focusNextPanel(ctx)            F2, Ctrl+Tab, and the Output panel's release chord (1.3.5)
//
// A region is a DOM element with `data-e68-panel="<id>"`. To choose where the focus lands inside
// its panel, a feature marks one element with `data-e68-panel-focus`; otherwise the first control
// that can take the focus gets it.
//
// The workspaces of Editor and Simulator mode are docks (ARCHITECTURE-PLUS P3.1.5, N1): these
// functions keep their meaning and also tell the window's dock controller (state/dock.ts):
// showPanel asks it to put the panel's tab back and select it (`reveal`, no action when it is
// there and selected already), hidePanel asks it to take the tab out and remember its place
// (`park`, never for the Output panel, which only collapses), focusPanel and focusNextPanel select
// the panel's tab first. Moving, docking, locking or resetting the layout never changes
// `layout.panels[id].visible` (P1.1 rule 4): only these functions do.

import type { AppContext, FeatureModule, Mode, PanelSpec } from '../contracts';
import { dockOf } from './dock';
import { PANEL_CYCLE, TOOL_PANELS, isPanelVisible, withPanelVisible } from './layout';
import { shellStateOf } from './shell';

/** The panels the features contributed. */
export interface PanelRegistry {
  /** The panel for a region of a mode. The Help panel belongs to every mode (2.1). */
  find(mode: Mode, id: string): PanelSpec | undefined;
  all(): readonly PanelSpec[];
}

export function createPanelRegistry(features: readonly FeatureModule[]): PanelRegistry {
  const panels = features.flatMap((feature) => feature.panels ?? []);
  const seen = new Set<string>();
  for (const panel of panels) {
    const key = `${panel.mode}/${panel.id}`;
    if (seen.has(key)) throw new Error(`Two features contribute the panel "${panel.id}" of ${panel.mode} mode`);
    seen.add(key);
  }
  return {
    find: (mode, id) =>
      panels.find((panel) => panel.id === id && panel.mode === mode) ??
      (id === 'help' ? panels.find((panel) => panel.id === 'help') : undefined),
    all: () => panels,
  };
}

const serial = { next: 1 };

/** True if the panel is shown in this window. */
export function panelVisible(ctx: AppContext, id: string): boolean {
  if (id === 'output') return !shellStateOf(ctx).getState().outputCollapsed;
  return isPanelVisible(ctx.settings.get(), id, ctx.platform.kind);
}

/**
 * Makes a panel visible; a tool panel also comes to the front of the tool tabs. By default the
 * keyboard focus moves into it, as `View > <panel>` does (2.10).
 */
export function showPanel(ctx: AppContext, id: string, options: { focus?: boolean } = {}): void {
  const shell = shellStateOf(ctx);
  if (id === 'output') {
    // Below 1100 px the Output panel is a tab of the tool group: it comes to the front (2.3).
    shell.setState((state) =>
      state.outputCollapsed || !state.outputInFront ? { ...state, outputCollapsed: false, outputInFront: true } : state,
    );
  } else {
    ctx.settings.update((settings) => withPanelVisible(settings, id, true));
    if ((TOOL_PANELS as readonly string[]).includes(id)) {
      shell.setState((state) =>
        state.activeTool === id && !state.outputInFront ? state : { ...state, activeTool: id, outputInFront: false },
      );
    }
  }
  dockOf(ctx).reveal(id);
  if (options.focus !== false) focusPanel(ctx, id);
}

/** Hides a panel (the Output panel collapses; the panels of the main window cannot be hidden). */
export function hidePanel(ctx: AppContext, id: string): void {
  const shell = shellStateOf(ctx);
  if (id === 'output') {
    shell.setState((state) => (state.outputCollapsed ? state : { ...state, outputCollapsed: true }));
    return;
  }
  ctx.settings.update((settings) => withPanelVisible(settings, id, false));
  shell.setState((state) => (state.activeTool === id ? { ...state, activeTool: null } : state));
  dockOf(ctx).park(id);
}

export function togglePanel(ctx: AppContext, id: string): void {
  if (panelVisible(ctx, id)) hidePanel(ctx, id);
  else showPanel(ctx, id);
}

/**
 * Asks the shell to move the keyboard focus into a panel (it does so once the panel is rendered).
 * The dock selects the panel's tab first.
 */
export function focusPanel(ctx: AppContext, id: string): void {
  dockOf(ctx).present(id);
  shellStateOf(ctx).setState((state) => ({ ...state, focusRequest: { panel: id, serial: serial.next++ } }));
}

/**
 * The panel after `current` in the cycle of sim-ui §3.4, over the visible ones. `current` null
 * (the focus is in no panel) counts as the main window.
 */
export function nextPanelInCycle(current: string | null, isVisible: (id: string) => boolean): string {
  const cycle: readonly string[] = PANEL_CYCLE;
  // Registers and Messages are parts of the main window, which `listing` stands for.
  const here = current !== null && cycle.includes(current) ? current : 'listing';
  const start = cycle.indexOf(here);
  for (let step = 1; step <= cycle.length; step++) {
    const candidate = cycle[(start + step) % cycle.length];
    if (candidate !== undefined && (candidate === 'listing' || isVisible(candidate))) return candidate;
  }
  return 'listing';
}

/** Selector of a panel's region in the workspace that is in front. */
export function panelSelector(id: string): string {
  return `[data-e68-panel="${id}"]`;
}

/** The id of the panel that contains `element`, or null. */
export function panelOf(element: unknown): string | null {
  const target = element as {
    closest?: (selector: string) => { getAttribute(name: string): string | null } | null;
  } | null;
  if (!target || typeof target.closest !== 'function') return null;
  return target.closest('[data-e68-panel]')?.getAttribute('data-e68-panel') ?? null;
}

/** Moves the focus to the next visible panel of the cycle and returns its id. */
export function focusNextPanel(ctx: AppContext, activeElement: unknown = globalThis.document?.activeElement): string {
  const next = nextPanelInCycle(panelOf(activeElement), (id) => panelVisible(ctx, id));
  if ((TOOL_PANELS as readonly string[]).includes(next)) {
    shellStateOf(ctx).setState((state) =>
      state.activeTool === next && !state.outputInFront ? state : { ...state, activeTool: next, outputInFront: false },
    );
  } else if (next === 'output') {
    shellStateOf(ctx).setState((state) => (state.outputInFront ? state : { ...state, outputInFront: true }));
  }
  focusPanel(ctx, next);
  return next;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The event the shell sends to the element it is about to focus (bubbles: no; cancelable: yes).
 * An element that must take the focus its own way cancels it and focuses itself: the editor's
 * content element, whose plain `focus()` lets the browser put back its own DOM caret, which
 * CodeMirror then reads as a new selection and so loses a selection made just before (a Find
 * match, a jump to a message's line). CodeMirror's `EditorView.focus()` brings the DOM selection
 * in line with the editor's state instead. Errata W3.md entry 38.
 *
 *   content.addEventListener(PANEL_FOCUS_EVENT, (event) => { event.preventDefault(); view.focus(); });
 */
export const PANEL_FOCUS_EVENT = 'e68-panel-focus';

/** The parts of an element that focusPanelElement uses; a page element has them all. */
interface FocusTarget {
  focus(options?: FocusOptions): void;
  dispatchEvent?(event: Event): boolean;
}

/** Focuses `target`, or lets it focus itself (PANEL_FOCUS_EVENT). */
function focusTarget(target: FocusTarget): void {
  if (typeof target.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    const event = new CustomEvent(PANEL_FOCUS_EVENT, { bubbles: false, cancelable: true });
    if (!target.dispatchEvent(event)) return;
  }
  target.focus({ preventScroll: true });
}

/**
 * Whether a region is rendered visible (ARCHITECTURE-PLUS P3.1.5). The workspaces of the other
 * modes stay mounted but `hidden`, and the dock hides the panels behind another tab with styles, so
 * "not inside `[hidden]`" is not enough: `checkVisibility({ visibilityProperty: true })` where the
 * browser has it, otherwise `offsetParent !== null` and a computed `visibility` that is not
 * `hidden`, or the element is the full-screen element.
 */
export function isRenderedVisible(element: HTMLElement): boolean {
  const target = element as HTMLElement & { checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean };
  const document = element.ownerDocument as Document | undefined;
  if (
    document?.fullscreenElement &&
    (document.fullscreenElement === element || document.fullscreenElement.contains(element))
  ) {
    return true;
  }
  if (typeof target.checkVisibility === 'function') return target.checkVisibility({ visibilityProperty: true });
  if (element.closest('[hidden]') !== null) return false;
  if (element.offsetParent === null) return false;
  const view = document?.defaultView;
  return !view || view.getComputedStyle(element).visibility !== 'hidden';
}

/**
 * Puts the focus into the region `id` under `root`: on the element marked data-e68-panel-focus,
 * else on the first focusable control, else on the region itself. False when the region is not
 * rendered (yet). The element may take the focus its own way (PANEL_FOCUS_EVENT).
 */
export function focusPanelElement(root: ParentNode, id: string): boolean {
  const regions = Array.from(root.querySelectorAll<HTMLElement>(panelSelector(id)));
  // Workspaces of the other modes stay mounted but hidden, and a dock hides the panels behind
  // another tab: take the region that is shown.
  const region = regions.find(isRenderedVisible);
  if (!region) return false;
  const target =
    region.querySelector<HTMLElement>('[data-e68-panel-focus]') ??
    region.querySelector<HTMLElement>(FOCUSABLE) ??
    region;
  focusTarget(target);
  return true;
}
