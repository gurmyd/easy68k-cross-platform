// The shell's components, rendered to markup under Node (ARCHITECTURE.md 2.1-2.4, 2.7). What
// needs a real browser - focus, keys, separators, the narrow layout - is in check-shell.mjs.
// The workspaces of Editor and Simulator mode are docks (ARCHITECTURE-PLUS P3.1, N1): FlexLayout
// lays out and mounts their panels only in a page, so the regions are tested here as the dock
// places them (PanelRegion, the dock's tab content and its model) and on screen by
// ui/dock/check-dock.mjs.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AppState, DialogProps, FeatureModule } from '../../contracts';
import type { ResolvedMenu } from '../../commands/menus';
import { defaultSettings } from '../../core/settings/defaults';
import { ApplicationProvider, useAppContext, useAppState } from '../../state/context';
import { showPanel } from '../../state/panels';
import { initialAppState } from '../../state/store';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { groupOf } from '../dock/actions';
import { DockContent } from '../dock/DockWorkspace';
import { DockEngine } from '../dock/engine';
import { globalAttributes, panelsOf } from '../dock/model';
import { PanelRegion } from './PanelRegion';
import { Shell } from './Shell';
import { runStateText, speedText } from './StatusBar';
import { toMenuBarMenus } from './menu-entries';

const render = (app: TestApplication) =>
  renderToStaticMarkup(
    <ApplicationProvider app={app}>
      <Shell />
    </ApplicationProvider>,
  );

describe('toMenuBarMenus', () => {
  const resolved: ResolvedMenu[] = [
    {
      id: 'simulator.options',
      caption: '&Options',
      items: [
        {
          type: 'item',
          id: 'sim.options.logOutput',
          caption: '&Log Output...',
          kind: 'action',
          enabled: true,
          checked: false,
          shortcut: null,
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'sim.options.exceptions',
          caption: '&Enable Exceptions',
          kind: 'check',
          enabled: false,
          checked: true,
          shortcut: null,
        },
        {
          type: 'submenu',
          caption: 'Output Window &Size',
          items: [
            {
              type: 'item',
              id: 'sim.options.size',
              arg: 1,
              caption: '800x600',
              kind: 'radio',
              enabled: true,
              checked: true,
              shortcut: null,
            },
          ],
        },
        {
          type: 'item',
          id: 'sim.run.run',
          caption: '&Run',
          kind: 'action',
          enabled: true,
          checked: false,
          shortcut: 'F9',
        },
      ],
    },
  ];

  it('keeps captions, kinds, check marks and shortcuts, and marks disabled entries', () => {
    const [menu] = toMenuBarMenus(resolved, () => {});
    expect(menu).toMatchObject({ id: 'simulator.options', caption: '&Options' });
    const [log, sep, exceptions, size, run] = menu?.items ?? [];
    expect(log).toMatchObject({ type: 'item', caption: '&Log Output...', disabled: false });
    expect(log && 'shortcut' in log).toBe(false);
    expect(sep?.type).toBe('separator');
    expect(exceptions).toMatchObject({ type: 'check', checked: true, disabled: true });
    expect(size).toMatchObject({ type: 'submenu', caption: 'Output Window &Size' });
    expect(size?.type === 'submenu' && size.items[0]).toMatchObject({
      type: 'radio',
      checked: true,
      caption: '800x600',
    });
    expect(run).toMatchObject({ type: 'item', shortcut: 'F9' });
  });

  it('gives every entry an id of its own and runs the command with its argument', () => {
    const run = vi.fn();
    const [menu] = toMenuBarMenus(resolved, run);
    const ids = new Set<string>();
    const walk = (items: NonNullable<typeof menu>['items']) => {
      for (const item of items) {
        ids.add(item.id ?? '');
        if (item.type === 'submenu') walk(item.items);
      }
    };
    walk(menu?.items ?? []);
    expect(ids.size).toBe(6);
    const size = menu?.items[3];
    const first = size?.type === 'submenu' ? size.items[0] : undefined;
    if (first?.type === 'radio') first.onSelect?.();
    expect(run).toHaveBeenCalledExactlyOnceWith('sim.options.size', 1);
  });
});

describe('the status bar', () => {
  it("names the simulator's state", () => {
    const sim = (phase: AppState['sim']['phase'], halted = false) => runStateText({ phase, halted });
    expect(sim('idle')).toBe('Stopped');
    expect(sim('idle', true)).toBe('Halted');
    // The engine's halt flag outlives Rewind and Open; once the commands are free it is 'Stopped'.
    expect(runStateText({ phase: 'idle', halted: true, menuState: 1 })).toBe('Halted');
    expect(runStateText({ phase: 'idle', halted: true, menuState: 0 })).toBe('Stopped');
    expect(sim('running')).toBe('Running');
    expect(sim('waitDelay')).toBe('Running');
    expect(sim('waitInput')).toBe('Waiting for input');
    expect(sim('loading')).toBe('Loading');
  });

  it('names the speed setting', () => {
    expect(speedText({ mode: 'original', instructionsPerSecond: 1_000_000 })).toBe('EASy68K-like');
    expect(speedText({ mode: 'max', instructionsPerSecond: 1_000_000 })).toBe('Maximum');
    expect(speedText({ mode: 'custom', instructionsPerSecond: 250_000 })).toBe('250,000 instructions/s');
  });

  it('Editor: the active document with Modified and Insert / Replace', () => {
    const app = createTestApplication();
    expect(render(app)).toMatch(/e68-statusbar.*untitled1\.x68.*Insert/s);
    app.ctx.store.setState((state) => ({
      ...state,
      documents: {
        ...state.documents,
        items: state.documents.items.map((item) => ({ ...item, modified: true, insertMode: false })),
      },
    }));
    const html = render(app);
    expect(html).toContain('>Modified</span>');
    expect(html).toContain('>Replace</span>');
  });

  it('Simulator: run state, PC, speed and the option flags of 2.3', async () => {
    const app = createTestApplication();
    await app.ctx.commands.run('app.mode.set', 'simulator');
    const bar = /<footer.*<\/footer>/s.exec(render(app))?.[0] ?? '';
    const text = bar.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Stopped PC=00000000 speed: EASy68K-like exceptions off bit field off');
  });

  it("is replaced by a feature's `status` panel for that mode", async () => {
    const features: FeatureModule[] = [
      {
        id: 'run',
        panels: [{ id: 'status', title: 'Status', mode: 'simulator', component: () => <b>custom status</b> }],
      },
    ];
    const app = createTestApplication({ features });
    expect(render(app)).not.toContain('custom status');
    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(render(app)).toContain('<b>custom status</b>');
  });
});

describe('regions and panels', () => {
  it("mounts a feature's panel in the region with its id and names the region by the panel's title", async () => {
    function Registers() {
      const ctx = useAppContext();
      const mode = useAppState((state) => state.mode);
      return (
        <i>
          {ctx.sim.controller.snapshot.boxes.length} boxes in {mode}
        </i>
      );
    }
    const features: FeatureModule[] = [
      {
        id: 'sim-main',
        panels: [{ id: 'registers', title: 'CPU Registers', mode: 'simulator', component: Registers }],
      },
    ];
    const app = createTestApplication({ features });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    // The dock puts each panel's PanelRegion into its tab (ui/dock/DockWorkspace.tsx).
    const region = (id: 'registers' | 'listing') =>
      renderToStaticMarkup(
        <ApplicationProvider app={app}>
          <PanelRegion id={id} mode="simulator" className="e68-region--fill" />
        </ApplicationProvider>,
      );
    expect(region('registers')).toMatch(
      /<section role="region" aria-label="CPU Registers" data-e68-panel="registers"[^>]*><i>20 boxes in simulator<\/i>/,
    );
    // A region without a panel shows its title.
    expect(region('listing')).toMatch(
      /aria-label="Listing" data-e68-panel="listing" data-empty="true"[^>]*><h2[^>]*>Listing<\/h2>/,
    );
    // ...in the dock of Simulator mode, which the shell draws.
    expect(render(app)).toContain('data-e68-dock="simulator"');
  });

  it('shows the visible tool panels as tabs of one group under the Output panel, the one in front selected', () => {
    const app = createTestApplication();
    void app.ctx.commands.run('app.mode.set', 'simulator');
    const dock = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    const stop = dock.start();
    expect(panelsOf(dock.tree())).toEqual(['registers', 'listing', 'messages', 'output']);
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'hardware');
    const tools = groupOf(dock.model, 'simulator', 'memory')!;
    const name = (node: unknown) => (node as { getName(): string }).getName();
    expect(tools.getChildren().map(name)).toEqual(['Memory', 'Hardware']);
    expect(name(tools.getSelectedNode())).toBe('Hardware');
    expect(tools.isEnableTabStrip()).toBe(true);
    expect(groupOf(dock.model, 'simulator', 'output')).not.toBe(tools);
    // Every tab stays mounted, also the one behind (P2.2: no render on demand).
    expect(globalAttributes(true).tabEnableRenderOnDemand).toBe(false);
    stop();
  });

  it('shows the Help panel as a drawer in every mode once it is visible', async () => {
    const features: FeatureModule[] = [
      { id: 'help', panels: [{ id: 'help', title: 'Help', mode: 'editor', component: () => <b>help pages</b> }] },
    ];
    const app = createTestApplication({ features });
    expect(render(app)).not.toContain('help pages');
    showPanel(app.ctx, 'help');
    expect(render(app)).toContain('help pages');
    await app.ctx.commands.run('app.mode.set', 'easybin');
    expect(render(app)).toContain('help pages');
  });

  it('collapses the Output panel to a bar that expands it again', () => {
    const app = createTestApplication();
    const dock = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    app.shell.setState((state) => ({ ...state, outputCollapsed: true }));
    const html = renderToStaticMarkup(
      <ApplicationProvider app={app}>
        <DockContent engine={dock} panel="output" />
      </ApplicationProvider>,
    );
    expect(html).toMatch(/<button[^>]*class="e68-dock__expand"[^>]*aria-expanded="false"[^>]*>Output<\/button>/);
    expect(html).toMatch(/data-e68-panel="output"[^>]*hidden=""/);
  });
});

describe('dialogs and toasts', () => {
  it("draws a message box with the original's title, text and buttons", () => {
    const app = createTestApplication();
    void app.ctx.dialogs.messageBox({
      title: 'Caution',
      text: 'A program is loaded.  Close it?',
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    const html = render(app);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('>Caution</h2>');
    // Double spaces are kept (section 0, rule 7).
    expect(html).toContain('A program is loaded.  Close it?');
    expect(html.match(/e68-button__caption/g)).toHaveLength(2);
  });

  it("draws a feature's dialog with its props, and nothing for a closed one", () => {
    function Find({ props }: DialogProps<{ text: string }, string | null>) {
      return <aside>Find what: {props.text}</aside>;
    }
    const app = createTestApplication({ features: [{ id: 'find', dialogs: { find: Find } }] });
    void app.ctx.dialogs.open('find', { text: 'START' }, { modal: false });
    expect(render(app)).toContain('<aside>Find what: START</aside>');
    app.dialogs.close(app.ctx.store.getState().dialogs.stack[0]?.key ?? -1, null);
    expect(render(app)).not.toContain('Find what');
  });

  it('draws toasts in a live region', () => {
    const app = createTestApplication();
    expect(render(app)).toContain('aria-live="polite"');
    app.ctx.dialogs.toast('The program is waiting for keyboard input', { label: 'Simulator', run: () => {} });
    const html = render(app);
    expect(html).toContain('The program is waiting for keyboard input');
    expect(html).toContain('Simulator');
  });
});

describe('the store the shell starts from', () => {
  it('is the initial state of 3.12.1 with the settings mirrored', () => {
    const app = createTestApplication();
    const state = app.ctx.store.getState();
    expect(state.mode).toBe('editor');
    expect(state.sim).toEqual(initialAppState(defaultSettings()).sim);
    expect(state.settings).toEqual(defaultSettings());
  });
});
