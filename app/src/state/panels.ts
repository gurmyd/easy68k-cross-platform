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

import type { AppContext, FeatureModule, Mode, PanelSpec } from '../contracts';
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
    shell.setState((state) => (state.outputCollapsed ? { ...state, outputCollapsed: false } : state));
  } else {
    ctx.settings.update((settings) => withPanelVisible(settings, id, true));
    if ((TOOL_PANELS as readonly string[]).includes(id)) {
      shell.setState((state) => (state.activeTool === id ? state : { ...state, activeTool: id }));
    }
  }
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
}

export function togglePanel(ctx: AppContext, id: string): void {
  if (panelVisible(ctx, id)) hidePanel(ctx, id);
  else showPanel(ctx, id);
}

/** Asks the shell to move the keyboard focus into a panel (it does so once the panel is rendered). */
export function focusPanel(ctx: AppContext, id: string): void {
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
    shellStateOf(ctx).setState((state) => (state.activeTool === next ? state : { ...state, activeTool: next }));
  }
  focusPanel(ctx, next);
  return next;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Puts the focus into the region `id` under `root`: on the element marked data-e68-panel-focus,
 * else on the first focusable control, else on the region itself. False when the region is not
 * rendered (yet).
 */
export function focusPanelElement(root: ParentNode, id: string): boolean {
  const regions = Array.from(root.querySelectorAll<HTMLElement>(panelSelector(id)));
  // Workspaces of the other modes stay mounted but hidden; take the region that is shown.
  const region = regions.find((candidate) => candidate.closest('[hidden]') === null);
  if (!region) return false;
  const target =
    region.querySelector<HTMLElement>('[data-e68-panel-focus]') ??
    region.querySelector<HTMLElement>(FOCUSABLE) ??
    region;
  target.focus({ preventScroll: true });
  return true;
}
