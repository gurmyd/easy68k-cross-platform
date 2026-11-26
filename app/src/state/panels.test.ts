// Showing, hiding and focusing panels (ARCHITECTURE.md 2.3, 2.4, 2.10; 1.3.5 panel cycle).

import { describe, expect, it } from 'vitest';
import type { FeatureModule, PanelSpec } from '../contracts';
import {
  createPanelRegistry,
  focusNextPanel,
  focusPanel,
  focusPanelElement,
  hidePanel,
  isRenderedVisible,
  PANEL_FOCUS_EVENT,
  nextPanelInCycle,
  panelOf,
  panelVisible,
  showPanel,
  togglePanel,
} from './panels';
import { attachDock, type DockLive } from './dock';

/** A mounted dock that does nothing (the parts a test does not look at). */
const inertLive = (mode: 'editor' | 'simulator'): DockLive => ({
  mode,
  has: () => true,
  reveal: () => {},
  park: () => {},
  present: () => true,
  openTransient: () => {},
  selectTransient: () => false,
  closeTransient: () => {},
  documentShown: () => {},
  closeAllTransients: () => {},
  move: () => {},
  reset: () => {},
  lockChanged: () => {},
  describe: () => [],
});
import { showExitScreen } from './shell';
import { createFakePlatform, createTestApplication } from './testing';

const Nothing = () => null;
const panel = (id: string, mode: PanelSpec['mode'], title = id): PanelSpec => ({ id, mode, title, component: Nothing });

describe('the panel registry', () => {
  const features: FeatureModule[] = [
    { id: 'sim-main', panels: [panel('messages', 'simulator', 'Messages'), panel('listing', 'simulator')] },
    { id: 'assemble', panels: [panel('messages', 'editor', 'Messages')] },
    { id: 'help', panels: [panel('help', 'editor', 'Help')] },
    { id: 'nothing' },
  ];

  it('finds a panel by mode and id', () => {
    const registry = createPanelRegistry(features);
    expect(registry.find('simulator', 'messages')?.mode).toBe('simulator');
    expect(registry.find('editor', 'messages')?.mode).toBe('editor');
    expect(registry.find('easybin', 'messages')).toBeUndefined();
    expect(registry.find('editor', 'listing')).toBeUndefined();
    expect(registry.all()).toHaveLength(4);
  });

  it('gives the Help panel to every mode (2.1)', () => {
    const registry = createPanelRegistry(features);
    for (const mode of ['editor', 'simulator', 'easybin'] as const)
      expect(registry.find(mode, 'help')?.title).toBe('Help');
  });

  it('refuses two panels for one region', () => {
    expect(() => createPanelRegistry([...features, { id: 'other', panels: [panel('listing', 'simulator')] }])).toThrow(
      /Two features contribute the panel "listing" of simulator mode/,
    );
  });
});

describe('the panel cycle (sim-ui §3.4; 1.3.5)', () => {
  const all = () => true;
  const only =
    (...visible: string[]) =>
    (id: string) =>
      visible.includes(id);

  it('goes Main > Output > Memory > Stack > Hardware > Break Points > Log > Main', () => {
    const order: string[] = [];
    let current = 'listing';
    for (let i = 0; i < 7; i++) {
      current = nextPanelInCycle(current, all);
      order.push(current);
    }
    expect(order).toEqual(['output', 'memory', 'stack', 'hardware', 'breakpoints', 'log', 'listing']);
  });

  it('skips hidden panels', () => {
    expect(nextPanelInCycle('output', only('output', 'hardware'))).toBe('hardware');
    expect(nextPanelInCycle('hardware', only('output', 'hardware'))).toBe('listing');
    expect(nextPanelInCycle('listing', only())).toBe('listing');
    expect(nextPanelInCycle('listing', only('log'))).toBe('log');
  });

  it('treats Registers, Messages and "nowhere" as the main window', () => {
    expect(nextPanelInCycle('registers', all)).toBe('output');
    expect(nextPanelInCycle('messages', all)).toBe('output');
    expect(nextPanelInCycle(null, all)).toBe('output');
  });
});

describe('show, hide, focus', () => {
  it('showPanel makes a tool panel visible, brings its tab forward and asks for the focus', () => {
    const app = createTestApplication();
    expect(panelVisible(app.ctx, 'memory')).toBe(false);
    showPanel(app.ctx, 'memory');
    expect(panelVisible(app.ctx, 'memory')).toBe(true);
    expect(app.ctx.settings.get().app.layout.panels.memory).toEqual({ visible: true });
    expect(app.ctx.store.getState().settings.app.layout.panels.memory).toEqual({ visible: true });
    expect(app.shell.getState().activeTool).toBe('memory');
    expect(app.shell.getState().focusRequest?.panel).toBe('memory');
  });

  it('showPanel without focus leaves the focus where it is (text output shows the Output panel, 2.10)', () => {
    const app = createTestApplication();
    hidePanel(app.ctx, 'output');
    expect(panelVisible(app.ctx, 'output')).toBe(false);
    showPanel(app.ctx, 'output', { focus: false });
    expect(panelVisible(app.ctx, 'output')).toBe(true);
    expect(app.shell.getState().focusRequest).toBeNull();
  });

  it('showing the Output panel puts its tab in front below 1100 px and keeps the tool tab (SH4)', () => {
    const app = createTestApplication();
    showPanel(app.ctx, 'memory', { focus: false });
    expect(app.shell.getState()).toMatchObject({ activeTool: 'memory', outputInFront: false });
    showPanel(app.ctx, 'output');
    // The wide layout keeps Memory in front of the tools; the narrow one shows the Output tab.
    expect(app.shell.getState()).toMatchObject({ activeTool: 'memory', outputInFront: true });
    expect(app.shell.getState().focusRequest?.panel).toBe('output');
    showPanel(app.ctx, 'memory', { focus: false });
    expect(app.shell.getState()).toMatchObject({ activeTool: 'memory', outputInFront: false });
    const inside = (id: string) => ({ closest: () => ({ getAttribute: () => id }) });
    expect(focusNextPanel(app.ctx, inside('listing'))).toBe('output');
    expect(app.shell.getState().outputInFront).toBe(true);
    expect(focusNextPanel(app.ctx, inside('output'))).toBe('memory');
    expect(app.shell.getState().outputInFront).toBe(false);
  });

  it('hidePanel hides a tool panel; the Output panel only collapses, and that is not stored', () => {
    const app = createTestApplication();
    showPanel(app.ctx, 'stack');
    hidePanel(app.ctx, 'stack');
    expect(panelVisible(app.ctx, 'stack')).toBe(false);
    expect(app.shell.getState().activeTool).toBeNull();
    hidePanel(app.ctx, 'output');
    expect(app.ctx.settings.get().app.layout.panels.output).toBeUndefined();
    // Always visible at start (2.4): a new window on the same storage shows it.
    const next = createTestApplication({ storage: app.storage });
    expect(panelVisible(next.ctx, 'output')).toBe(true);
  });

  it('togglePanel flips the Files panel, whose default depends on the platform', () => {
    const web = createTestApplication();
    expect(panelVisible(web.ctx, 'files')).toBe(true);
    togglePanel(web.ctx, 'files');
    expect(panelVisible(web.ctx, 'files')).toBe(false);
    const desktop = createTestApplication({ platform: createFakePlatform({ kind: 'desktop', os: 'mac' }) });
    expect(panelVisible(desktop.ctx, 'files')).toBe(false);
    togglePanel(desktop.ctx, 'files');
    expect(panelVisible(desktop.ctx, 'files')).toBe(true);
  });

  it('every focus request is distinct, also for the same panel', () => {
    const app = createTestApplication();
    focusPanel(app.ctx, 'listing');
    const first = app.shell.getState().focusRequest;
    focusPanel(app.ctx, 'listing');
    expect(app.shell.getState().focusRequest?.serial).not.toBe(first?.serial);
  });

  it('focusNextPanel moves on from the panel that has the focus', () => {
    const app = createTestApplication();
    showPanel(app.ctx, 'hardware', { focus: false });
    const inside = (id: string) => ({ closest: () => ({ getAttribute: () => id }) });
    expect(focusNextPanel(app.ctx, inside('listing'))).toBe('output');
    expect(focusNextPanel(app.ctx, inside('output'))).toBe('hardware');
    expect(app.shell.getState().activeTool).toBe('hardware');
    expect(app.shell.getState().focusRequest?.panel).toBe('hardware');
    expect(focusNextPanel(app.ctx, inside('hardware'))).toBe('listing');
    expect(focusNextPanel(app.ctx, null)).toBe('output');
    // A collapsed Output panel is skipped like a hidden window.
    hidePanel(app.ctx, 'output');
    expect(focusNextPanel(app.ctx, inside('listing'))).toBe('hardware');
  });

  it('P9.8 point 6: the next panel floats: the focus request asks for its title bar', async () => {
    const app = createTestApplication();
    await app.ctx.commands.run('app.mode.set', 'simulator');
    showPanel(app.ctx, 'hardware', { focus: false });
    const windows = [{ panel: 'hardware', rect: { x: 0, y: 0, width: 300, height: 200 }, visible: true }];
    attachDock(app.ctx, { ...inertLive('simulator'), floating: () => windows });
    const inside = (id: string) => ({ closest: () => ({ getAttribute: () => id }) });
    expect(focusNextPanel(app.ctx, inside('output'))).toBe('hardware');
    expect(app.shell.getState().focusRequest).toMatchObject({ panel: 'hardware', at: 'title' });
    // A docked panel: the panel itself, as before.
    expect(focusNextPanel(app.ctx, inside('hardware'))).toBe('listing');
    expect(app.shell.getState().focusRequest?.at).toBeUndefined();
    // The title bar belongs to its panel for the cycle.
    const onTitle = {
      closest: (selector: string) => (selector === '[data-e68-float-bar]' ? { getAttribute: () => 'hardware' } : null),
    };
    expect(focusNextPanel(app.ctx, onTitle)).toBe('listing');
  });

  it("`sim.panel.next` is the shell's command for it", async () => {
    const app = createTestApplication();
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('sim.panel.next');
    expect(app.shell.getState().focusRequest?.panel).toBe('output');
  });

  it('panelOf finds the region an element is in', () => {
    expect(
      panelOf({
        closest: (selector: string) => (selector === '[data-e68-panel]' ? { getAttribute: () => 'memory' } : null),
      }),
    ).toBe('memory');
    expect(panelOf({ closest: () => null })).toBeNull();
    expect(panelOf(null)).toBeNull();
  });
});

describe('focusPanelElement', () => {
  /** A stand-in for the DOM: regions with an optional marked or focusable element. */
  function region(options: { hidden?: boolean; marked?: boolean; control?: boolean }) {
    const focused: string[] = [];
    const node = (name: string) => ({ focus: () => focused.push(name) });
    const element = {
      closest: (selector: string) => (selector === '[hidden]' && options.hidden ? {} : null),
      querySelector: (selector: string) =>
        selector === '[data-e68-panel-focus]'
          ? options.marked
            ? node('marked')
            : null
          : options.control
            ? node('control')
            : null,
      focus: () => focused.push('region'),
    };
    return { element, focused };
  }
  const root = (...regions: { element: unknown }[]) =>
    ({ querySelectorAll: () => regions.map((entry) => entry.element) }) as unknown as ParentNode;

  it('prefers the element marked data-e68-panel-focus, then the first control, then the region', () => {
    const marked = region({ marked: true, control: true });
    expect(focusPanelElement(root(marked), 'memory')).toBe(true);
    expect(marked.focused).toEqual(['marked']);
    const control = region({ control: true });
    focusPanelElement(root(control), 'memory');
    expect(control.focused).toEqual(['control']);
    const empty = region({});
    focusPanelElement(root(empty), 'memory');
    expect(empty.focused).toEqual(['region']);
  });

  it('takes the region of the workspace that is shown (both modes have a Messages panel)', () => {
    const editor = region({ hidden: true, control: true });
    const simulator = region({ control: true });
    expect(focusPanelElement(root(editor, simulator), 'messages')).toBe(true);
    expect(editor.focused).toEqual([]);
    expect(simulator.focused).toEqual(['control']);
  });

  it('lets the element take the focus its own way when it cancels PANEL_FOCUS_EVENT (the editor)', () => {
    const focused: string[] = [];
    const events: Event[] = [];
    const selfFocusing = (cancels: boolean) => ({
      focus: () => focused.push(cancels ? 'plain focus (wrong)' : 'plain focus'),
      dispatchEvent: (event: Event) => {
        events.push(event);
        if (cancels) {
          event.preventDefault();
          focused.push('its own focus');
        }
        return !event.defaultPrevented;
      },
    });
    for (const cancels of [true, false]) {
      const target = selfFocusing(cancels);
      const element = { closest: () => null, querySelector: () => target };
      expect(focusPanelElement(root({ element }), 'editor')).toBe(true);
    }
    expect(focused).toEqual(['its own focus', 'plain focus']);
    expect(events.map((event) => [event.type, event.bubbles, event.cancelable])).toEqual([
      [PANEL_FOCUS_EVENT, false, true],
      [PANEL_FOCUS_EVENT, false, true],
    ]);
    expect(PANEL_FOCUS_EVENT).toBe('e68-panel-focus');
  });

  it('reports false when the region is not rendered', () => {
    expect(focusPanelElement(root(), 'memory')).toBe(false);
    expect(focusPanelElement(root(region({ hidden: true })), 'memory')).toBe(false);
  });

  it('takes the region that is rendered visible: a dock hides the panels behind another tab with styles (ARCHITECTURE-PLUS P3.1.5)', () => {
    const behind = { ...region({ control: true }), visible: false };
    const front = { ...region({ control: true }), visible: true };
    const withVisibility = (entry: typeof behind) => ({
      ...entry,
      element: {
        ...entry.element,
        checkVisibility: (options?: { visibilityProperty?: boolean }) =>
          entry.visible && options?.visibilityProperty === true,
      },
    });
    const a = withVisibility(behind);
    const b = withVisibility(front);
    expect(focusPanelElement(root(a, b), 'messages')).toBe(true);
    expect(behind.focused).toEqual([]);
    expect(front.focused).toEqual(['control']);
    // Without checkVisibility: an element without an offsetParent is not shown.
    expect(isRenderedVisible({ closest: () => null, offsetParent: null } as unknown as HTMLElement)).toBe(false);
  });
});

describe('the dock controller (ARCHITECTURE-PLUS P3.1.5)', () => {
  function withDock() {
    const app = createTestApplication();
    const calls: string[] = [];
    attachDock(app.ctx, {
      mode: 'simulator',
      has: () => true,
      reveal: (id, select) => void calls.push(`reveal ${id} ${select}`),
      park: (id) => void calls.push(`park ${id}`),
      present: (id) => {
        calls.push(`present ${id}`);
        return true;
      },
      openTransient: () => {},
      selectTransient: () => false,
      closeTransient: () => {},
      documentShown: () => {},
      closeAllTransients: () => {},
      move: () => {},
      reset: () => {},
      lockChanged: () => {},
      describe: () => [],
    });
    return { app, calls };
  }

  it('showPanel sets visible, then reveals the tab and selects it; then the focus request selects it again', () => {
    const { app, calls } = withDock();
    showPanel(app.ctx, 'memory');
    expect(app.ctx.settings.get().app.layout.panels.memory?.visible).toBe(true);
    expect(calls).toEqual(['reveal memory true', 'present memory']);
  });

  it('hidePanel sets visible false and parks the tab; the Output panel is never parked', () => {
    const { app, calls } = withDock();
    hidePanel(app.ctx, 'stack');
    hidePanel(app.ctx, 'output');
    expect(calls).toEqual(['park stack']);
    expect(app.shell.getState().outputCollapsed).toBe(true);
  });

  it("focusNextPanel selects the target's tab before it asks for the focus, in PANEL_CYCLE order", () => {
    const { app, calls } = withDock();
    showPanel(app.ctx, 'stack', { focus: false });
    calls.length = 0;
    expect(focusNextPanel(app.ctx, null)).toBe('output');
    expect(focusNextPanel(app.ctx, { closest: () => ({ getAttribute: () => 'output' }) })).toBe('stack');
    expect(calls).toEqual(['present output', 'present stack']);
  });
});

describe('Exit in a browser (1.4 note 4)', () => {
  it('showExitScreen marks the window as exited', () => {
    const app = createTestApplication();
    expect(app.shell.getState().exited).toBe(false);
    showExitScreen(app.ctx);
    expect(app.shell.getState().exited).toBe(true);
  });
});
