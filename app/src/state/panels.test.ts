// Showing, hiding and focusing panels (ARCHITECTURE.md 2.3, 2.4, 2.10; 1.3.5 panel cycle).

import { describe, expect, it } from 'vitest';
import type { FeatureModule, PanelSpec } from '../contracts';
import {
  createPanelRegistry,
  focusNextPanel,
  focusPanel,
  focusPanelElement,
  hidePanel,
  nextPanelInCycle,
  panelOf,
  panelVisible,
  showPanel,
  togglePanel,
} from './panels';
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

  it('reports false when the region is not rendered', () => {
    expect(focusPanelElement(root(), 'memory')).toBe(false);
    expect(focusPanelElement(root(region({ hidden: true })), 'memory')).toBe(false);
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
