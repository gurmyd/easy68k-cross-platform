// The dock engine under Node (no DOM): how it follows panel visibility (P1.1 rule 4), stores a
// changed arrangement (P3.1.3, P4.2), sizes the default from layout.splits, routes FlexLayout's own
// actions (P2.2 onAction), opens viewers (P4.4) and resets (P3.1.3).

import { Actions, type Action } from 'flexlayout-react';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../contracts';
import { dockOf } from '../../state/dock';
import { SPLITS, splitFraction, withPanelVisible, withSplit } from '../../state/layout';
import { hidePanel, showPanel } from '../../state/panels';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { groupOf, tabNodeOf } from './actions';
import { DockEngine } from './engine';
import { indexModel } from './live';
import { panelsOf, type DockMode } from './model';
import { readDock } from './stored';

function setup(mode: DockMode = 'simulator', prepare?: (settings: Settings) => Settings) {
  const app = createTestApplication();
  if (prepare) app.ctx.settings.update(prepare);
  if (mode === 'simulator') void app.ctx.commands.run('app.mode.set', 'simulator');
  const engine = new DockEngine(app.ctx, app.panels, app.shell, mode);
  const stop = engine.start();
  engine.setSize(1400, 813);
  return { app, engine, stop };
}

/** What FlexLayout's Layout does with an action of its own controls. */
function fromLayout(engine: DockEngine, action: Action): void {
  const allowed = engine.onAction(action);
  if (allowed) engine.model.doAction(allowed);
}

const shape = (engine: DockEngine) => {
  const visit = (node: ReturnType<DockEngine['tree']>): string =>
    node === null
      ? 'empty'
      : node.type === 'tabs'
        ? node.panels.join('+')
        : `${node.type}(${node.children.map(visit).join(', ')})`;
  return visit(engine.tree());
};

const panelsJson = (app: TestApplication) => JSON.stringify(app.ctx.settings.get().app.layout.panels);

describe('the dock follows panel visibility and never changes it (P1.1 rule 4)', () => {
  it('a tool panel shown by showPanel is a selected tab; hidePanel takes it out', () => {
    const { app, engine } = setup();
    expect(shape(engine)).toBe('row(column(registers, listing, messages), output)');
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'hardware');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory+hardware))');
    expect(tabNodeOf(engine.model, 'simulator', 'hardware')!.isSelected()).toBe(true);
    hidePanel(app.ctx, 'hardware');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory))');
    expect(app.ctx.settings.get().app.layout.panels.hardware?.visible).toBe(false);
  });

  it('the Help drawer is not a dock panel (P3.1.7): showing it leaves the dock as it is', () => {
    const { app, engine } = setup('editor');
    const before = shape(engine);
    showPanel(app.ctx, 'help');
    expect(shape(engine)).toBe(before);
    expect(engine.has('help')).toBe(false);
  });

  it('hidePanel("output") never calls park: the Output tab stays, only collapsed', () => {
    const { app, engine } = setup();
    const park = vi.spyOn(engine, 'park');
    hidePanel(app.ctx, 'output');
    expect(park).not.toHaveBeenCalled();
    expect(engine.has('output')).toBe(true);
    expect(app.shell.getState().outputCollapsed).toBe(true);
    dockOf(app.ctx).park('output');
    expect(park).not.toHaveBeenCalled();
  });

  it('a reveal that finds the panel present and selected dispatches no action (P3.1.5)', () => {
    const { app } = setup();
    showPanel(app.ctx, 'output', { focus: false });
    const before = dockOf(app.ctx).stats().actions.simulator;
    for (let i = 0; i < 50; i++) showPanel(app.ctx, 'output', { focus: false });
    expect(dockOf(app.ctx).stats().actions.simulator).toBe(before);
  });

  it('moving, locking and resetting leave layout.panels byte-equal', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'stack');
    const before = panelsJson(app);
    dockOf(app.ctx).move('memory', { kind: 'beside', near: 'registers', side: 'right' });
    dockOf(app.ctx).setLocked(false);
    dockOf(app.ctx).move('stack', { kind: 'edge', side: 'top' });
    dockOf(app.ctx).setLocked(true);
    dockOf(app.ctx).reset();
    expect(panelsJson(app)).toBe(before);
    expect(engine.has('memory') && engine.has('stack')).toBe(true);
  });
});

describe('Reset Layout (P3.1.3): a property over random layouts', () => {
  it("leaves layout.panels byte-equal, removes the mode's tree, sets the mode's splits to the defaults", () => {
    let seed = 1;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const tools = ['memory', 'stack', 'hardware', 'breakpoints', 'log'];
    for (let round = 0; round < 25; round++) {
      const { app, engine, stop } = setup();
      for (const tool of tools) if (next() < 0.5) showPanel(app.ctx, tool);
      app.ctx.settings.update((settings) =>
        withSplit(withSplit(settings, 'sim.columns', 0.2 + next() * 0.6), 'editor.files', 0.3),
      );
      const present = panelsOf(engine.tree());
      for (let i = 0; i < 4; i++) {
        const panel = present[Math.floor(next() * present.length)]!;
        const near = present[Math.floor(next() * present.length)]!;
        if (panel === near) continue;
        const kind = (['tab', 'beside', 'edge'] as const)[Math.floor(next() * 3)]!;
        const side =
          kind === 'edge'
            ? (['left', 'right', 'top', 'bottom'] as const)[Math.floor(next() * 4)]!
            : (['left', 'right', 'above', 'below'] as const)[Math.floor(next() * 4)]!;
        dockOf(app.ctx).move(panel, { kind, near, side });
      }
      const panels = panelsJson(app);
      dockOf(app.ctx).reset();
      expect(panelsJson(app), `round ${round}`).toBe(panels);
      const settings = app.ctx.settings.get();
      expect(readDock(settings).simulator).toBeUndefined();
      for (const id of ['sim.columns', 'sim.messages', 'sim.tools'] as const)
        expect(splitFraction(settings, id)).toBe(SPLITS[id].fraction);
      // The other mode's split is not this mode's to reset.
      expect(splitFraction(settings, 'editor.files')).toBe(0.3);
      stop();
    }
  });
});

describe('a changed arrangement is stored; the default one writes layout.splits (P3.1.3)', () => {
  it('a splitter drag in the default arrangement writes layout.splits and leaves layout.dock absent', () => {
    const { app, engine } = setup('editor');
    const root = indexModel(engine.model).nodes.get('root')!;
    // Files 252 -> 350 px of 1399.
    fromLayout(engine, Actions.adjustWeights(root.getId(), [350, 1049]));
    const settings = app.ctx.settings.get();
    expect(settings.app.layout.dock).toBeUndefined();
    expect(splitFraction(settings, 'editor.files')).toBeCloseTo(350 / 1400, 2);
  });

  it("the editor's message list: a drag overrides the rule and is never stored", () => {
    const { app, engine } = setup('editor');
    const column = indexModel(engine.model).nodes.get('root.1')!;
    fromLayout(engine, Actions.adjustWeights(column.getId(), [700, 112]));
    const settings = app.ctx.settings.get();
    expect(settings.app.layout.dock).toBeUndefined();
    expect(JSON.stringify(settings.app.layout.splits)).not.toContain('messages');
    const weights = (column.getChildren() as unknown as { getWeight(): number }[]).map((child) => child.getWeight());
    expect(Math.round(weights[1]!)).toBe(112);
  });

  it('a move stores the whole tree; a splitter drag then writes only there', () => {
    const { app, engine } = setup('editor');
    dockOf(app.ctx).move('files', { kind: 'edge', side: 'right' });
    const stored = readDock(app.ctx.settings.get()).editor;
    expect(stored && panelsOf(stored)).toEqual(['editor', 'messages', 'files']);
    const splits = JSON.stringify(app.ctx.settings.get().app.layout.splits);
    const root = indexModel(engine.model).nodes.get('root')!;
    fromLayout(engine, Actions.adjustWeights(root.getId(), [30, 70]));
    expect(JSON.stringify(app.ctx.settings.get().app.layout.splits)).toBe(splits);
    const after = readDock(app.ctx.settings.get()).editor!;
    expect(after.type === 'row' && after.children.map((child) => child.weight)).toEqual([30, 70]);
  });

  it('a hidden panel of a stored tree is parked, and comes back there', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'stack');
    dockOf(app.ctx).move('stack', { kind: 'beside', near: 'listing', side: 'right' });
    expect(shape(engine)).toBe('row(column(registers, row(listing, stack), messages), column(output, memory))');
    hidePanel(app.ctx, 'stack');
    expect(readDock(app.ctx.settings.get()).parked.stack).toEqual({ near: 'listing', side: 'right' });
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory))');
    showPanel(app.ctx, 'stack');
    expect(shape(engine)).toBe('row(column(registers, row(listing, stack), messages), column(output, memory))');
  });

  it('a stored tree that lists a hidden panel: the panel is left out and its place written to parked (P4.2)', () => {
    const app = createTestApplication();
    app.ctx.settings.update((settings) => ({
      ...settings,
      app: {
        ...settings.app,
        layout: {
          ...settings.app.layout,
          dock: {
            version: 1,
            editor: {
              type: 'row',
              weight: 100,
              children: [
                { type: 'tabs', weight: 30, panels: ['editor', 'messages'], selected: 'editor' },
                { type: 'tabs', weight: 70, panels: ['files'], selected: 'files' },
              ],
            },
          },
        },
      },
    }));
    app.ctx.settings.update((settings) => withPanelVisible(settings, 'files', false));
    const engine = new DockEngine(app.ctx, app.panels, app.shell, 'editor');
    engine.start();
    expect(shape(engine)).toBe('editor+messages');
    expect(readDock(app.ctx.settings.get()).parked.files).toEqual({ near: 'editor', side: 'right' });
    showPanel(app.ctx, 'files');
    expect(shape(engine)).toBe('row(editor+messages, files)');
  });

  it('a stored tree survives a new window of the same storage (a reload)', () => {
    const first = setup('editor');
    dockOf(first.app.ctx).move('messages', { kind: 'edge', side: 'top' });
    const storage = first.app.storage;
    const second = createTestApplication({ storage });
    const engine = new DockEngine(second.ctx, second.panels, second.shell, 'editor');
    expect(shape(engine)).toBe(shape(first.engine));
  });
});

describe("FlexLayout's own controls (P2.2 onAction)", () => {
  it('the x or Delete on a closable tab runs hidePanel; on the others nothing happens', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'hardware');
    fromLayout(engine, Actions.deleteTab('simulator:hardware'));
    expect(app.ctx.settings.get().app.layout.panels.hardware?.visible).toBe(false);
    expect(engine.has('hardware')).toBe(false);
    fromLayout(engine, Actions.deleteTab('simulator:output'));
    fromLayout(engine, Actions.deleteTab('simulator:registers'));
    expect(engine.has('output') && engine.has('registers')).toBe(true);
    const group = groupOf(engine.model, 'simulator', 'listing')!;
    fromLayout(engine, Actions.deleteTabset(group.getId()));
    expect(engine.has('listing')).toBe(true);
  });

  it('refuses a drag while locked', () => {
    const { engine } = setup('editor');
    const before = shape(engine);
    const target = groupOf(engine.model, 'editor', 'messages')!;
    fromLayout(engine, Actions.moveNode('editor:files', target.getId(), { getName: () => 'center' } as never, -1));
    expect(shape(engine)).toBe(before);
  });
});

describe('the lock (D2)', () => {
  it('locked() follows setLocked and the stored value (absent = true); subscribers hear each change', () => {
    const { app } = setup('editor');
    const dock = dockOf(app.ctx);
    expect(dock.locked()).toBe(true);
    const heard = vi.fn();
    const stop = dock.subscribe(heard);
    dock.setLocked(false);
    expect(dock.locked()).toBe(false);
    expect(app.ctx.settings.get().app.layout.dock?.locked).toBe(false);
    expect(heard).toHaveBeenCalled();
    heard.mockClear();
    dock.setLocked(true);
    expect(dock.locked()).toBe(true);
    expect(heard).toHaveBeenCalled();
    stop();
    app.ctx.settings.update((settings) => ({
      ...settings,
      app: { ...settings.app, layout: { ...settings.app.layout, dock: { version: 1, locked: false } } },
    }));
    expect(dock.locked()).toBe(false);
  });

  it("unlocked, every group shows its strip; locked, only today's", () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    const strips = () =>
      [...indexModel(engine.model).nodes.values()]
        .filter((node) => node.getType() === 'tabset')
        .map((node) => (node as unknown as { isEnableTabStrip(): boolean }).isEnableTabStrip());
    expect(strips()).toEqual([false, false, false, false, true]);
    dockOf(app.ctx).setLocked(false);
    expect(strips()).toEqual([true, true, true, true, true]);
  });
});

describe('transient tabs (P4.4)', () => {
  const spec = (n: number, closed: string[] = []) => ({
    id: `viewer:${n}` as const,
    title: `file${n}.pdf`,
    tooltip: `My Programs/file${n}.pdf`,
    render: () => null,
    onClose: () => closed.push(`viewer:${n}`),
  });

  it('openTransient before the Editor dock attaches is queued and applied when it attaches', () => {
    const app = createTestApplication();
    const dock = dockOf(app.ctx);
    expect(dock.acceptsTransient()).toBe(true);
    expect(dock.openTransient(spec(1))).toBe(true);
    expect(dock.selectTransient('viewer:1')).toBe(true);
    const engine = new DockEngine(app.ctx, app.panels, app.shell, 'editor');
    expect(engine.has('viewer:1')).toBe(false);
    engine.start();
    expect(engine.has('viewer:1')).toBe(true);
    expect(groupOf(engine.model, 'editor', 'viewer:1')).toBe(groupOf(engine.model, 'editor', 'editor'));
    expect(tabNodeOf(engine.model, 'editor', 'viewer:1')!.isSelected()).toBe(true);
    expect(engine.announcer.last).toBe('file1.pdf opened.');
  });

  it('closes with its x (onClose runs once), with closeTransient, and on a mode change; never stored', () => {
    const closed: string[] = [];
    const { app, engine } = setup('editor');
    const dock = dockOf(app.ctx);
    dock.openTransient(spec(1, closed));
    dock.openTransient(spec(2, closed));
    dock.openTransient(spec(3, closed));
    dock.move('viewer:2', { kind: 'edge', side: 'right' });
    expect(JSON.stringify(readDock(app.ctx.settings.get()))).not.toContain('viewer');
    fromLayout(engine, Actions.deleteTab('editor:viewer:1'));
    dock.closeTransient('viewer:2');
    expect(closed).toEqual(['viewer:1', 'viewer:2']);
    void app.ctx.commands.run('app.mode.set', 'simulator');
    expect(closed).toEqual(['viewer:1', 'viewer:2', 'viewer:3']);
    expect(engine.has('viewer:3')).toBe(false);
  });

  it('a second open of the same id selects its tab', () => {
    const { app, engine } = setup('editor');
    const dock = dockOf(app.ctx);
    dock.openTransient(spec(1));
    dock.openTransient(spec(2));
    expect(tabNodeOf(engine.model, 'editor', 'viewer:1')!.isSelected()).toBe(false);
    expect(dock.selectTransient('viewer:1')).toBe(true);
    expect(tabNodeOf(engine.model, 'editor', 'viewer:1')!.isSelected()).toBe(true);
    expect(dock.selectTransient('viewer:9')).toBe(false);
  });
});

describe('describe() and the announcements (P3.1.4, P3.1.8)', () => {
  it('lists the visible panels with titles and groups, and says each move', () => {
    const { app, engine } = setup('editor');
    expect(dockOf(app.ctx).describe()).toEqual([
      { panel: 'files', title: 'Files', group: 1 },
      { panel: 'editor', title: 'Editor', group: 2 },
      { panel: 'messages', title: 'Messages', group: 3 },
    ]);
    dockOf(app.ctx).move('files', { kind: 'tab', near: 'editor' });
    expect(engine.announcer.last).toBe('Files moved into the group of Editor.');
    dockOf(app.ctx).setLocked(false);
    expect(engine.announcer.last).toBe('Layout unlocked.');
    dockOf(app.ctx).reset();
    expect(engine.announcer.last).toBe('Layout reset.');
    expect(app.ctx.settings.get().app.layout.dock?.locked).toBe(false);
  });

  it('a visible Files panel is in the default tree; hidden, it is not', () => {
    const { app, engine } = setup('editor', (settings) => withPanelVisible(settings, 'files', false));
    expect(engine.has('files')).toBe(false);
    showPanel(app.ctx, 'files');
    expect(engine.has('files')).toBe(true);
  });
});
