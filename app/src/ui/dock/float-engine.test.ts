// Floating panels in the dock engine under Node (ARCHITECTURE-PLUS P9.2, P9.4; M1): visibility is
// never changed (P1.1 rule 4), the windows are stored and read back, docked back where they were,
// reset, arranged, and kept after everything docked in float order.

import { describe, expect, it } from 'vitest';
import type { DockNode, Settings } from '../../contracts';
import { dockOf, type DockArrangement } from '../../state/dock';
import { rectsOverlap } from '../../state/tiling';
import { withPanelVisible } from '../../state/layout';
import { hidePanel, showPanel } from '../../state/panels';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { tabNodeOf } from './actions';
import { DockEngine } from './engine';
import { floatingTabIds, tabIdsInReadingOrder } from './live';
import { panelsOf, type DockMode } from './model';
import { dockInto, insertAtPlace, placeOf, removePanel } from './park';
import { readDock } from './stored';

function setup(
  mode: DockMode = 'simulator',
  prepare?: (settings: Settings) => Settings,
  storage?: TestApplication['storage'],
) {
  const app = createTestApplication(storage ? { storage } : {});
  if (prepare) app.ctx.settings.update(prepare);
  if (mode === 'simulator') void app.ctx.commands.run('app.mode.set', 'simulator');
  const engine = new DockEngine(app.ctx, app.panels, app.shell, mode);
  const stop = engine.start();
  engine.setSize(1400, 813);
  return { app, engine, stop };
}

const shape = (engine: DockEngine) => {
  const visit = (node: DockNode | null): string =>
    node === null
      ? 'empty'
      : node.type === 'tabs'
        ? node.panels.join('+')
        : `${node.type}(${node.children.map(visit).join(', ')})`;
  return visit(engine.tree());
};

const panelsJson = (app: ReturnType<typeof createTestApplication>) =>
  JSON.stringify(app.ctx.settings.get().app.layout.panels);

describe('P9.8: the first place of a window and the room kept for the windows', () => {
  it('a second window floats at the first free place, over no other floating window', () => {
    const { app } = setup();
    for (const id of ['memory', 'hardware', 'log']) showPanel(app.ctx, id);
    dockOf(app.ctx).float('hardware', { x: 1000, y: 0, width: 400, height: 300 });
    dockOf(app.ctx).float('log');
    const [hardware, log] = dockOf(app.ctx).floating();
    expect(rectsOverlap(hardware!.rect, log!.rect)).toBe(false);
  });

  it('an arrangement keeps room at the right of the dock while one of its windows is shown; stored, read, reset', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'hardware');
    const arrangement: DockArrangement = {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [
          {
            type: 'column',
            weight: 50,
            children: [
              { type: 'tabs', weight: 20, panels: ['registers'], selected: 'registers' },
              { type: 'tabs', weight: 60, panels: ['listing'], selected: 'listing' },
              { type: 'tabs', weight: 20, panels: ['messages'], selected: 'messages' },
            ],
          },
          { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' },
        ],
      },
      floating: ['hardware', 'memory', 'stack', 'breakpoints', 'log'].map((panel) => ({ panel })),
      reserve: 540,
    };
    expect(dockOf(app.ctx).arrange(arrangement)).toBe(true);
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve).toBe(540);
    // Another window of the same profile reads it.
    const second = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    second.setSize(1400, 813);
    expect(second.isFloating('hardware')).toBe(true);
    // With nothing floating there is no room kept (the page is 1.0.0's).
    dockOf(app.ctx).reset();
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve).toBeUndefined();
    expect(engine.dockedWidth()).toBe(1400);
  });

  it('P9.9 point 4: the room shrinks to the columns that still hold a shown window, when a move, size, Dock or Close ends; kept by a reload; Reset Layout clears it', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'hardware');
    showPanel(app.ctx, 'memory');
    const hardware = { x: 860, y: 0, width: 540, height: 632 };
    const memory = { x: 760, y: 632, width: 640, height: 181 };
    const arrangement: DockArrangement = {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [
          {
            type: 'column',
            weight: 50,
            children: [
              { type: 'tabs', weight: 20, panels: ['registers'], selected: 'registers' },
              { type: 'tabs', weight: 60, panels: ['listing'], selected: 'listing' },
              { type: 'tabs', weight: 20, panels: ['messages'], selected: 'messages' },
            ],
          },
          { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' },
        ],
      },
      floating: [
        { panel: 'hardware', rect: hardware },
        { panel: 'memory', rect: memory },
        { panel: 'stack' },
        { panel: 'breakpoints' },
        { panel: 'log' },
      ],
      reserve: 640,
    };
    expect(dockOf(app.ctx).arrange(arrangement)).toBe(true);
    expect(engine.keptRoomNow()).toBe(640);
    // While a window is being dragged out (a preview), nothing changes; when the drag ends, it does.
    engine.previewRect('memory', { ...memory, x: 100 });
    expect(engine.keptRoomNow()).toBe(640);
    engine.commitRect('memory', { ...memory, x: 100 });
    expect(engine.keptRoomNow(), "Hardware's column is still held").toBe(540);
    // Kept by a reload: another engine of the same profile reads the same room.
    const second = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    second.setSize(1400, 813);
    expect(second.keptRoomNow()).toBe(540);
    // Hardware closed (its x hides it): no shown window lies in the room; it is given back whole.
    hidePanel(app.ctx, 'hardware');
    expect(engine.keptRoomNow()).toBe(0);
    // Shown again where it floated, it lies in its column again.
    showPanel(app.ctx, 'hardware');
    expect(engine.keptRoomNow()).toBe(540);
    // Hardware docked: none in the room.
    dockOf(app.ctx).dock('hardware');
    expect(engine.keptRoomNow()).toBe(0);
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve, 'stored while windows float').toBe(640);
    // Reset Layout clears it.
    dockOf(app.ctx).reset();
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve).toBeUndefined();
    expect(engine.keptRoomNow()).toBe(0);
  });

  it('P9.10 point 3: the room is given back while its windows fill less than half of its height, and comes back by the same rule', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'hardware');
    showPanel(app.ctx, 'memory');
    const hardware = { x: 860, y: 0, width: 540, height: 632 };
    const memory = { x: 760, y: 632, width: 640, height: 181 };
    const docked: DockNode = {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'column',
          weight: 50,
          children: [
            { type: 'tabs', weight: 20, panels: ['registers'], selected: 'registers' },
            { type: 'tabs', weight: 60, panels: ['listing'], selected: 'listing' },
            { type: 'tabs', weight: 20, panels: ['messages'], selected: 'messages' },
          ],
        },
        { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' },
      ],
    };
    const floating = [
      { panel: 'hardware', rect: hardware },
      { panel: 'memory', rect: memory },
      { panel: 'stack' },
      { panel: 'breakpoints' },
      { panel: 'log' },
    ];
    expect(dockOf(app.ctx).arrange({ mode: 'simulator', docked, floating, reserve: 640 })).toBe(true);
    expect(engine.keptRoomNow()).toBe(640);
    // Hardware dragged left by 400 px: Memory alone holds 181 of the dock's 813 px. While the button
    // is held nothing changes; when the drag ends the docked panels take the whole dock.
    engine.previewRect('hardware', { ...hardware, x: 460, y: 80 });
    expect(engine.keptRoomNow()).toBe(640);
    engine.commitRect('hardware', { ...hardware, x: 460, y: 80 });
    expect(engine.keptRoomNow()).toBe(0);
    expect(engine.dockedWidth()).toBe(1400);
    // A reload computes the same.
    const second = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    second.setSize(1400, 813);
    expect(second.keptRoomNow()).toBe(0);
    // Dragged back into the room: the windows in it fill more than half of its height again.
    engine.commitRect('hardware', hardware);
    expect(engine.keptRoomNow()).toBe(640);
  });

  it('the last window docked: the room is given back', () => {
    const { app } = setup();
    showPanel(app.ctx, 'hardware');
    const plan: DockArrangement = {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [
          {
            type: 'column',
            weight: 50,
            children: [
              { type: 'tabs', weight: 20, panels: ['registers'], selected: 'registers' },
              { type: 'tabs', weight: 60, panels: ['listing'], selected: 'listing' },
              { type: 'tabs', weight: 20, panels: ['messages'], selected: 'messages' },
            ],
          },
          {
            type: 'column',
            weight: 50,
            children: [
              { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' },
              { type: 'tabs', weight: 50, panels: ['memory', 'stack', 'breakpoints', 'log'], selected: 'memory' },
            ],
          },
        ],
      },
      floating: [{ panel: 'hardware' }],
      reserve: 300,
    };
    expect(dockOf(app.ctx).arrange(plan)).toBe(true);
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve).toBe(300);
    dockOf(app.ctx).dock('hardware');
    expect(readDock(app.ctx.settings.get()).floating?.simulator?.reserve).toBeUndefined();
  });
});

describe('Float and Dock (P9.2)', () => {
  it('a panel leaves the docked arrangement; its tab stays in the model; layout.panels unchanged', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'hardware');
    const panels = panelsJson(app);
    dockOf(app.ctx).float('hardware');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory))');
    expect(engine.has('hardware')).toBe(true);
    expect(floatingTabIds(engine.model)).toEqual(['simulator:hardware']);
    // (That its content is not mounted anew is checked in the browser: check-dock.mjs, pass floating.)
    expect(panelsJson(app)).toBe(panels);
    expect(dockOf(app.ctx).floating()).toEqual([
      { panel: 'hardware', rect: expect.objectContaining({ width: expect.any(Number) }), visible: true },
    ]);
    dockOf(app.ctx).dock('hardware');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory+hardware))');
    expect(floatingTabIds(engine.model)).toEqual([]);
    expect(dockOf(app.ctx).floating()).toEqual([]);
    expect(panelsJson(app)).toBe(panels);
  });

  it('works locked and unlocked (D8); the lock does not dock a window', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'log');
    expect(dockOf(app.ctx).locked()).toBe(true);
    dockOf(app.ctx).float('log');
    dockOf(app.ctx).setLocked(false);
    expect(engine.isFloating('log')).toBe(true);
    dockOf(app.ctx).setLocked(true);
    expect(floatingTabIds(engine.model)).toEqual(['simulator:log']);
  });

  it('the last docked panel cannot float; an unknown panel cannot float', () => {
    const { app, engine } = setup('editor');
    dockOf(app.ctx).float('files');
    dockOf(app.ctx).float('messages');
    expect(dockOf(app.ctx).canFloat('editor')).toBe(false);
    dockOf(app.ctx).float('editor');
    expect(shape(engine)).toBe('editor');
    expect(dockOf(app.ctx).canFloat('nothing')).toBe(false);
  });

  it('a first float gets its docked size within three quarters of the dock; after that it remembers its own', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    dockOf(app.ctx).float('memory', { x: 40, y: 50, width: 400, height: 300 });
    engine.commitRect('memory', { x: 60, y: 70, width: 420, height: 310 });
    dockOf(app.ctx).dock('memory');
    dockOf(app.ctx).float('memory');
    expect(dockOf(app.ctx).floating()[0]!.rect).toEqual({ x: 60, y: 70, width: 420, height: 310 });
  });

  it('a panel hidden while it floats is hidden; shown, it floats again where it was', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'stack');
    dockOf(app.ctx).float('stack', { x: 10, y: 20, width: 300, height: 200 });
    hidePanel(app.ctx, 'stack');
    expect(app.ctx.settings.get().app.layout.panels.stack?.visible).toBe(false);
    expect(engine.has('stack')).toBe(false);
    expect(dockOf(app.ctx).floating()).toEqual([
      { panel: 'stack', rect: { x: 10, y: 20, width: 300, height: 200 }, visible: false },
    ]);
    showPanel(app.ctx, 'stack');
    expect(floatingTabIds(engine.model)).toEqual(['simulator:stack']);
    expect(shape(engine)).not.toContain('stack');
  });

  it('Dock: back where it was docked last; that group gone, to its default place', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    dockOf(app.ctx).move('memory', { kind: 'beside', near: 'listing', side: 'right' });
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).dock('memory');
    expect(shape(engine)).toBe('row(column(registers, row(listing, memory), messages), output)');
    // Its neighbour floats now: its place among the panels docked now (errata M1 11), and with the
    // neighbour docked again the arrangement it floated from.
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).float('listing');
    dockOf(app.ctx).dock('memory');
    expect(shape(engine)).toBe('row(column(registers, memory, messages), output)');
    dockOf(app.ctx).dock('listing');
    expect(shape(engine)).toBe('row(column(registers, row(listing, memory), messages), output)');
    // Something else changed the arrangement meanwhile (a move): the place it was docked at, while
    // the panels it was beside are there; they float too: its place in the default arrangement.
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).move('registers', { kind: 'edge', side: 'right' });
    dockOf(app.ctx).dock('memory');
    expect(shape(engine)).toBe('row(column(row(listing, memory), messages), output, registers)');
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).float('listing');
    dockOf(app.ctx).move('registers', { kind: 'beside', near: 'messages', side: 'above' });
    dockOf(app.ctx).dock('memory');
    expect(shape(engine)).toBe('row(column(registers, messages), column(output, memory))');
  });

  it('Dock: its neighbour gone, to its place in the default arrangement (P3.1.3), not an edge', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'hardware');
    const start = 'row(column(registers, listing, messages), column(output, memory+hardware))';
    expect(shape(engine)).toBe(start);
    dockOf(app.ctx).float('registers');
    dockOf(app.ctx).float('listing');
    expect(shape(engine)).toBe('row(messages, column(output, memory+hardware))');
    // Registers was docked above Listing, which floats: above Messages, its default neighbour now.
    dockOf(app.ctx).dock('registers');
    expect(shape(engine)).toBe('row(column(registers, messages), column(output, memory+hardware))');
    dockOf(app.ctx).dock('listing');
    expect(shape(engine)).toBe(start);
    // The other order gives the default arrangement as well.
    dockOf(app.ctx).float('registers');
    dockOf(app.ctx).float('listing');
    dockOf(app.ctx).dock('listing');
    dockOf(app.ctx).dock('registers');
    expect(shape(engine)).toBe(start);
    // A tab of a group whose other tabs float: back into the group's place.
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).float('hardware');
    dockOf(app.ctx).float('output');
    dockOf(app.ctx).dock('hardware');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), hardware)');
  });

  it('the Output panel may float; hidePanel still only collapses it', () => {
    const { app, engine } = setup();
    dockOf(app.ctx).float('output');
    hidePanel(app.ctx, 'output');
    expect(app.shell.getState().outputCollapsed).toBe(true);
    expect(engine.has('output')).toBe(true);
    expect(floatingTabIds(engine.model)).toEqual(['simulator:output']);
  });

  it('present (focusPanel, View > panel) brings a window to the front and selects nothing', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'log');
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).float('log');
    const actions = dockOf(app.ctx).stats().actions.simulator;
    expect(dockOf(app.ctx).present('memory')).toBe(true);
    expect(dockOf(app.ctx).stats().actions.simulator).toBe(actions);
    // The order of the windows is the order they floated in, whatever is in front.
    expect(floatingTabIds(engine.model)).toEqual(['simulator:memory', 'simulator:log']);
  });
});

describe('a viewer may float (never stored)', () => {
  it('floats, docks into the group it left, and a closed floating viewer leaves no window', () => {
    const { app, engine } = setup('editor');
    const spec = (n: number) => ({
      id: `viewer:${n}` as const,
      title: `${n}.pdf`,
      tooltip: '',
      render: () => null,
      onClose: () => {},
    });
    dockOf(app.ctx).openTransient(spec(1));
    expect(dockOf(app.ctx).canFloat('viewer:1')).toBe(true);
    dockOf(app.ctx).float('viewer:1');
    expect(floatingTabIds(engine.model)).toEqual(['editor:viewer:1']);
    expect(JSON.stringify(app.ctx.settings.get().app.layout.dock ?? null)).not.toContain('viewer');
    dockOf(app.ctx).dock('viewer:1');
    expect(shape(engine)).toBe('row(files, column(editor+viewer:1, messages))');
    dockOf(app.ctx).float('viewer:1');
    dockOf(app.ctx).closeTransient('viewer:1');
    expect(floatingTabIds(engine.model)).toEqual([]);
    expect(engine.model.toJson().borders).toEqual([]);
    expect(dockOf(app.ctx).floating()).toEqual([]);
  });
});

describe('the order: after everything docked, in the order they were made to float (P9.2)', () => {
  it('floating tabs come last in reading order, in float order, not stacking order', () => {
    const { app, engine } = setup();
    for (const id of ['memory', 'stack', 'hardware']) showPanel(app.ctx, id);
    dockOf(app.ctx).float('hardware');
    dockOf(app.ctx).float('memory');
    engine.raise('hardware');
    const order = tabIdsInReadingOrder(engine.model);
    expect(order.slice(-2)).toEqual(['simulator:hardware', 'simulator:memory']);
    expect(order.slice(0, -2)).toEqual(panelsOf(engine.tree()).map((panel) => `simulator:${panel}`));
  });
});

describe('persistence (P9.2)', () => {
  it('a reload finds the windows where they were, in their order', () => {
    const first = setup();
    showPanel(first.app.ctx, 'hardware');
    showPanel(first.app.ctx, 'log');
    dockOf(first.app.ctx).float('log', { x: 30, y: 40, width: 300, height: 200 });
    dockOf(first.app.ctx).float('hardware', { x: 300, y: 100, width: 320, height: 240 });
    const second = setup('simulator', undefined, first.app.storage);
    expect(dockOf(second.app.ctx).floating()).toEqual([
      { panel: 'log', rect: { x: 30, y: 40, width: 300, height: 200 }, visible: true },
      { panel: 'hardware', rect: { x: 300, y: 100, width: 320, height: 240 }, visible: true },
    ]);
    expect(floatingTabIds(second.engine.model)).toEqual(['simulator:log', 'simulator:hardware']);
    expect(shape(second.engine)).toBe(shape(first.engine));
  });

  it('a stored layout of 1.0.0 is read as it is: nothing floats', () => {
    const tree: DockNode = {
      type: 'row',
      weight: 100,
      children: [
        { type: 'tabs', weight: 50, panels: ['editor', 'messages'], selected: 'editor' },
        { type: 'tabs', weight: 50, panels: ['files'], selected: 'files' },
      ],
    };
    const { app, engine } = setup('editor', (settings) => ({
      ...settings,
      app: { ...settings.app, layout: { ...settings.app.layout, dock: { version: 1, editor: tree } } },
    }));
    expect(shape(engine)).toBe('row(editor+messages, files)');
    expect(dockOf(app.ctx).floating()).toEqual([]);
    expect(engine.model.toJson().borders).toEqual([]);
  });

  it('floating windows that cannot be read: the default arrangement, without a message', () => {
    const { app, engine } = setup('editor', (settings) => ({
      ...settings,
      app: {
        ...settings.app,
        layout: {
          ...settings.app.layout,
          dock: {
            version: 1,
            editor: { type: 'tabs', weight: 100, panels: ['editor'], selected: 'editor' },
            floating: { editor: { windows: [{ panel: 'messages', rect: 'broken' }] } },
          } as never,
        },
      },
    }));
    expect(shape(engine)).toBe('row(files, column(editor, messages))');
    expect(dockOf(app.ctx).floating()).toEqual([]);
  });

  it('a fixed panel may be missing from a stored tree only when it floats', () => {
    const dock = (floating: unknown) => ({
      version: 1,
      editor: { type: 'tabs', weight: 100, panels: ['editor', 'files'], selected: 'editor' },
      floating,
    });
    const read = (floating: unknown) => {
      const { app } = setup('editor', (settings) => ({
        ...settings,
        app: { ...settings.app, layout: { ...settings.app.layout, dock: dock(floating) as never } },
      }));
      return readDock(app.ctx.settings.get());
    };
    expect(read(undefined).editor).toBeUndefined();
    const ok = read({ editor: { windows: [{ panel: 'messages', rect: { x: 1, y: 2, width: 300, height: 200 } }] } });
    expect(ok.editor && panelsOf(ok.editor)).toEqual(['editor', 'files']);
    expect(ok.floating?.editor?.windows.map((window) => window.panel)).toEqual(['messages']);
  });

  it('Reset Layout docks every panel and leaves layout.panels byte-equal', () => {
    const { app, engine } = setup();
    for (const id of ['memory', 'stack', 'log']) showPanel(app.ctx, id);
    dockOf(app.ctx).float('memory');
    dockOf(app.ctx).float('output');
    hidePanel(app.ctx, 'log');
    const panels = panelsJson(app);
    dockOf(app.ctx).reset();
    expect(dockOf(app.ctx).floating()).toEqual([]);
    expect(floatingTabIds(engine.model)).toEqual([]);
    expect(readDock(app.ctx.settings.get()).simulator).toBeUndefined();
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, memory+stack))');
    expect(panelsJson(app)).toBe(panels);
  });
});

describe('arrange (P9.4): every panel placed, none shown or hidden, the lock kept', () => {
  const left: DockNode = {
    type: 'column',
    weight: 50,
    children: [
      { type: 'tabs', weight: 20, panels: ['registers'], selected: 'registers' },
      { type: 'tabs', weight: 60, panels: ['listing'], selected: 'listing' },
      { type: 'tabs', weight: 20, panels: ['messages'], selected: 'messages' },
    ],
  };
  const floatingTools: DockArrangement = {
    mode: 'simulator',
    docked: {
      type: 'row',
      weight: 100,
      children: [left, { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' }],
    },
    floating: ['memory', 'stack', 'hardware', 'breakpoints', 'log'].map((panel) => ({ panel })),
    cascade: 'top-right',
  };

  it('Floating Tools: the tools float side by side from the top right (P9.8 point 1); hidden ones stay hidden', () => {
    const { app, engine } = setup();
    showPanel(app.ctx, 'memory');
    showPanel(app.ctx, 'hardware');
    const panels = panelsJson(app);
    const locked = dockOf(app.ctx).locked();
    expect(dockOf(app.ctx).arrange(floatingTools)).toBe(true);
    expect(panelsJson(app)).toBe(panels);
    expect(dockOf(app.ctx).locked()).toBe(locked);
    expect(shape(engine)).toBe('row(column(registers, listing, messages), output)');
    const windows = dockOf(app.ctx).floating();
    expect(windows.map((window) => [window.panel, window.visible])).toEqual([
      ['memory', true],
      ['stack', false],
      ['hardware', true],
      ['breakpoints', false],
      ['log', false],
    ]);
    // Entries without a place: the default size, by the rule of state/tiling.ts in a dock that has
    // of the test's size (1400 wide): the first at the top right corner, the next below it, none
    // over another.
    expect(windows[0]!.rect).toEqual({ x: 1040, y: 0, width: 360, height: 280 });
    expect(windows[1]!.rect).toEqual({ x: 1040, y: 280, width: 360, height: 280 });
    for (const a of windows) for (const b of windows) if (a !== b) expect(rectsOverlap(a.rect, b.rect)).toBe(false);
    expect(floatingTabIds(engine.model)).toEqual(['simulator:memory', 'simulator:hardware']);
    showPanel(app.ctx, 'log');
    expect(floatingTabIds(engine.model)).toEqual(['simulator:memory', 'simulator:hardware', 'simulator:log']);
  });

  it('a hidden panel placed in the docked tree takes that place when it is shown', () => {
    const { app, engine } = setup();
    const arrangement: DockArrangement = {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [
          left,
          {
            type: 'column',
            weight: 50,
            children: [
              { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' },
              {
                type: 'tabs',
                weight: 50,
                panels: ['memory', 'stack', 'hardware', 'breakpoints', 'log'],
                selected: 'memory',
              },
            ],
          },
        ],
      },
      floating: [],
    };
    expect(dockOf(app.ctx).arrange(arrangement)).toBe(true);
    expect(shape(engine)).toBe('row(column(registers, listing, messages), output)');
    showPanel(app.ctx, 'stack');
    expect(shape(engine)).toBe('row(column(registers, listing, messages), column(output, stack))');
  });

  it('refuses an arrangement that misses a panel, names one twice, or lacks a fixed one', () => {
    const { app, engine } = setup();
    const before = shape(engine);
    expect(dockOf(app.ctx).arrange({ ...floatingTools, floating: floatingTools.floating.slice(1) })).toBe(false);
    expect(
      dockOf(app.ctx).arrange({ ...floatingTools, floating: [...floatingTools.floating, { panel: 'memory' }] }),
    ).toBe(false);
    expect(
      dockOf(app.ctx).arrange({
        ...floatingTools,
        docked: left,
        floating: [...floatingTools.floating, { panel: 'nothing' }],
      }),
    ).toBe(false);
    expect(dockOf(app.ctx).arrange({ ...floatingTools, mode: 'editor' })).toBe(false);
    expect(shape(engine)).toBe(before);
  });
});

describe('Float, then Dock: the arrangement it floated from again (P9.2; errata M1 11)', () => {
  const TOOLS = ['memory', 'stack', 'hardware', 'breakpoints', 'log'];
  const SIMULATOR = ['registers', 'listing', 'messages', 'output', ...TOOLS];
  const EDITOR = ['files', 'editor', 'messages'];

  /**
   * The tree as shown, its weights rounded (a pixel-sized default is compared to 1/1000), without
   * the front tabs: Dock gives the docked panel the focus, which brings its tab to the front (not
   * stored; the stored tree, compared as well, keeps the front tabs it had).
   */
  const exact = (engine: DockEngine) =>
    JSON.stringify(engine.tree(), (key, value: unknown) =>
      key === 'selected'
        ? undefined
        : key === 'weight' && typeof value === 'number'
          ? Math.round(value * 1000) / 1000
          : value,
    );
  /**
   * The stored tree, also without the front tabs where `fronts` is false: a panel docked into a
   * group gets the focus, which brings it to the front, and the next change of a stored arrangement
   * stores what is shown, as every change of one does.
   */
  const stored = (app: TestApplication, mode: DockMode, fronts = true) =>
    JSON.stringify(readDock(app.ctx.settings.get())[mode] ?? null, (key, value: unknown) =>
      key === 'selected' && !fronts ? undefined : value,
    );

  const permutations = <T>(items: readonly T[]): T[][] =>
    items.length <= 1
      ? [[...items]]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
        );
  const choose = <T>(items: readonly T[], count: number): T[][] =>
    count === 0
      ? [[]]
      : items.flatMap((item, i) => choose(items.slice(i + 1), count - 1).map((rest) => [item, ...rest]));

  /** Floats `panels` in their order, docks them in `order`, and says what differs afterwards. */
  function roundTrip(app: TestApplication, engine: DockEngine, mode: DockMode, panels: string[], order: string[]) {
    const fronts = panels.length === 1;
    const before = { tree: exact(engine), stored: stored(app, mode, fronts), panels: panelsJson(app) };
    for (const panel of panels) dockOf(app.ctx).float(panel);
    for (const panel of order) dockOf(app.ctx).dock(panel);
    const after = { tree: exact(engine), stored: stored(app, mode, fronts), panels: panelsJson(app) };
    const label = `float ${panels.join(', ')}; dock ${order.join(', ')}`;
    return { label, before, after, floating: dockOf(app.ctx).floating() };
  }

  function expectSame(result: ReturnType<typeof roundTrip>) {
    expect(result.after.tree, result.label).toBe(result.before.tree);
    expect(result.after.stored, result.label).toBe(result.before.stored);
    expect(result.after.panels, result.label).toBe(result.before.panels);
    expect(result.floating, result.label).toEqual([]);
  }

  it('every panel of the Editor, Files shown and hidden: the default arrangement, nothing stored', () => {
    for (const files of [true, false]) {
      const { app, engine } = setup('editor', (settings) => withPanelVisible(settings, 'files', files));
      expect(readDock(app.ctx.settings.get()).editor).toBeUndefined();
      for (const panel of EDITOR) {
        if (!dockOf(app.ctx).canFloat(panel) || !engine.has(panel)) continue;
        expectSame(roundTrip(app, engine, 'editor', [panel], [panel]));
        expect(readDock(app.ctx.settings.get()).editor).toBeUndefined();
      }
    }
    const { app, engine } = setup('editor');
    dockOf(app.ctx).float('files');
    expect(shape(engine)).toBe('column(editor, messages)');
    dockOf(app.ctx).dock('files');
    expect(shape(engine)).toBe('row(files, column(editor, messages))');
  });

  it('every panel of the Simulator, with the tools shown and with the defaults: the default again', () => {
    for (const tools of [TOOLS, []]) {
      const { app, engine } = setup('simulator', (settings) =>
        tools.reduce((next, panel) => withPanelVisible(next, panel, true), settings),
      );
      for (const panel of SIMULATOR) {
        if (!engine.has(panel)) continue;
        expectSame(roundTrip(app, engine, 'simulator', [panel], [panel]));
        expect(readDock(app.ctx.settings.get()).simulator).toBeUndefined();
      }
    }
  });

  it('a tab docks back at its index among the tabs, not as the last one', () => {
    const { app, engine } = setup('simulator', (settings) =>
      TOOLS.reduce((next, panel) => withPanelVisible(next, panel, true), settings),
    );
    dockOf(app.ctx).move('output', { kind: 'edge', side: 'right' });
    const before = shape(engine);
    expect(before).toContain('memory+stack+hardware+breakpoints+log');
    dockOf(app.ctx).float('stack');
    dockOf(app.ctx).float('memory');
    // Something else changes the arrangement (the run of Float and Dock is over): the place recorded.
    dockOf(app.ctx).move('registers', { kind: 'edge', side: 'left' });
    dockOf(app.ctx).dock('stack');
    dockOf(app.ctx).dock('memory');
    expect(shape(engine)).toContain('memory+stack+hardware+breakpoints+log');
  });

  it('the reported cases: Output, Memory, Hardware floated and docked in reverse; the left column, Messages first', () => {
    const { app, engine } = setup('simulator', (settings) =>
      ['memory', 'hardware'].reduce((next, panel) => withPanelVisible(next, panel, true), settings),
    );
    const start = shape(engine);
    expect(start).toBe('row(column(registers, listing, messages), column(output, memory+hardware))');
    expectSame(roundTrip(app, engine, 'simulator', ['output', 'memory', 'hardware'], ['hardware', 'memory', 'output']));
    expectSame(
      roundTrip(app, engine, 'simulator', ['registers', 'listing', 'messages'], ['messages', 'listing', 'registers']),
    );
    expect(shape(engine)).toBe(start);
  });

  it('every pair and every triple of Simulator panels, docked in every order: the default again', () => {
    const { app, engine } = setup('simulator', (settings) =>
      TOOLS.reduce((next, panel) => withPanelVisible(next, panel, true), settings),
    );
    let runs = 0;
    for (const count of [2, 3]) {
      for (const panels of choose(SIMULATOR, count)) {
        for (const order of permutations(panels)) {
          expectSame(roundTrip(app, engine, 'simulator', panels, order));
          runs++;
        }
      }
    }
    expect(runs).toBe(36 * 2 + 84 * 6);
  }, 120_000);

  // The three stored arrangements of P9.4 (features/layout/arrangements.ts, M2: the same shapes and
  // proportions; the dock may not import a feature, so they are written out here).
  const left = (tools: string[] | null, weights: number[]): DockNode => ({
    type: 'column',
    weight: tools ? 40 : 50,
    children: [
      { type: 'tabs', weight: weights[0]!, panels: ['registers'], selected: 'registers' },
      { type: 'tabs', weight: weights[1]!, panels: ['listing'], selected: 'listing' },
      ...(tools ? [{ type: 'tabs' as const, weight: weights[2]!, panels: tools, selected: tools[0]! }] : []),
      { type: 'tabs', weight: weights[weights.length - 1]!, panels: ['messages'], selected: 'messages' },
    ],
  });
  const ARRANGEMENTS: Record<string, DockArrangement> = {
    wideOutput: {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [left(TOOLS, [20, 38, 30, 12]), { type: 'tabs', weight: 60, panels: ['output'], selected: 'output' }],
      },
      floating: [],
    },
    sideBySide: {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [
          { ...left(['memory', 'stack', 'breakpoints', 'log'], [20, 38, 30, 12]), weight: 34 },
          { type: 'tabs', weight: 40, panels: ['output'], selected: 'output' },
          { type: 'tabs', weight: 26, panels: ['hardware'], selected: 'hardware' },
        ],
      },
      floating: [],
    },
    floatingTools: {
      mode: 'simulator',
      docked: {
        type: 'row',
        weight: 100,
        children: [left(null, [20, 67, 13]), { type: 'tabs', weight: 50, panels: ['output'], selected: 'output' }],
      },
      floating: TOOLS.map((panel) => ({ panel })),
      cascade: 'top-right',
    },
  };

  for (const [name, arrangement] of Object.entries(ARRANGEMENTS)) {
    it(`${name}: every panel, pair and triple of the docked ones, docked in every order: the arrangement again`, () => {
      const { app, engine } = setup('simulator', (settings) =>
        TOOLS.reduce((next, panel) => withPanelVisible(next, panel, true), settings),
      );
      expect(dockOf(app.ctx).arrange(arrangement)).toBe(true);
      const docked = panelsOf(engine.tree());
      for (const count of [1, 2, 3]) {
        for (const panels of choose(docked, count)) {
          if (panels.length >= docked.length) continue;
          for (const order of permutations(panels)) {
            // From the arrangement as it was picked (the front tabs of an earlier Dock are stored
            // with the next change, as every change of a stored arrangement stores what is shown).
            expect(dockOf(app.ctx).arrange(arrangement)).toBe(true);
            const result = roundTrip(app, engine, 'simulator', panels, order);
            expect(result.after.tree, result.label).toBe(result.before.tree);
            expect(result.after.stored, result.label).toBe(result.before.stored);
            expect(result.after.panels, result.label).toBe(result.before.panels);
            const still = arrangement.floating.map((entry) => entry.panel);
            expect(
              result.floating.map((window) => window.panel),
              result.label,
            ).toEqual(still);
          }
        }
      }
    }, 120_000);
  }

  it('a reload in the middle keeps the run: docked after it, the default again', () => {
    const first = setup('simulator', (settings) => withPanelVisible(settings, 'memory', true));
    const start = exact(first.engine);
    dockOf(first.app.ctx).float('output');
    dockOf(first.app.ctx).float('memory');
    const second = setup('simulator', undefined, first.app.storage);
    dockOf(second.app.ctx).dock('output');
    dockOf(second.app.ctx).dock('memory');
    expect(readDock(second.app.ctx.settings.get()).simulator).toBeUndefined();
    expect(exact(second.engine)).toBe(start);
  });
});

describe('the place a panel floats from, and back (park.ts)', () => {
  const t = (panels: string[], weight = 100): DockNode => ({ type: 'tabs', weight, panels, selected: panels[0]! });
  const text = (node: DockNode | null): string =>
    node === null
      ? 'empty'
      : node.type === 'tabs'
        ? node.panels.join('+')
        : `${node.type}(${node.children.map(text).join(', ')})`;
  const editor: DockNode = {
    type: 'row',
    weight: 100,
    children: [t(['files'], 18), { type: 'column', weight: 82, children: [t(['editor']), t(['messages'])] }],
  };

  it('a whole column of its own: beside the subtree, with its share', () => {
    const place = placeOf(editor, 'files');
    expect(place).toEqual({ side: 'left', panels: ['editor', 'messages'], share: 0.18 });
    const back = insertAtPlace(removePanel(editor, 'files').tree!, 'files', place!);
    expect(text(back)).toBe('row(files, column(editor, messages))');
    expect(back?.type === 'row' && back.children.map((child) => Math.round(child.weight))).toEqual([18, 82]);
  });

  it('a subtree merged into its parent by normalizeDock counts as a run of children', () => {
    const tree: DockNode = {
      type: 'column',
      weight: 100,
      children: [
        {
          type: 'row',
          weight: 50,
          children: [t(['a']), { type: 'column', weight: 100, children: [t(['b']), t(['c'])] }],
        },
        t(['d']),
      ],
    };
    const place = placeOf(tree, 'a')!;
    const without = removePanel(tree, 'a').tree!;
    expect(text(without)).toBe('column(b, c, d)');
    expect(text(insertAtPlace(without, 'a', place))).toBe('column(row(a, column(b, c)), d)');
  });

  it('a tab: at its index among the tabs that are there', () => {
    const group = t(['m', 's', 'h', 'b', 'l']);
    const place = placeOf({ type: 'row', weight: 100, children: [t(['x']), group] }, 's')!;
    expect(place).toEqual({ side: 'tab', panels: ['m', 's', 'h', 'b', 'l'] });
    const tree: DockNode = { type: 'row', weight: 100, children: [t(['x']), t(['h', 'b', 'l'])] };
    expect(text(insertAtPlace(tree, 's', place))).toBe('row(x, s+h+b+l)');
    expect(text(insertAtPlace(tree, 'm', place))).toBe('row(x, m+h+b+l)');
    expect(insertAtPlace(t(['x']), 's', place)).toBeNull();
  });

  it('dockInto: the origin while it agrees, then the place, then the default arrangement', () => {
    const origin = editor;
    const now = removePanel(removePanel(editor, 'files').tree!, 'messages').tree!;
    const docked = dockInto(now, 'editor', origin, 'messages', {}, origin);
    expect(text(docked.tree)).toBe('column(editor, messages)');
    expect(docked.place).toEqual({ near: 'editor', side: 'below' });
    expect(text(dockInto(docked.tree, 'editor', origin, 'files', {}, origin).tree)).toBe(
      'row(files, column(editor, messages))',
    );
    // An origin that does not agree with the tree is not used.
    const moved: DockNode = { type: 'row', weight: 100, children: [t(['messages']), t(['editor'])] };
    expect(text(dockInto(moved, 'editor', origin, 'files', {}, origin).tree)).toBe('row(files, messages, editor)');
  });
});

describe('a stored floating panel is mounted only once its dock is laid out (P2.2)', () => {
  it('its tab is marked rendered at the first size, not before', () => {
    const first = setup();
    showPanel(first.app.ctx, 'hardware');
    dockOf(first.app.ctx).float('hardware');
    const app = createTestApplication({ storage: first.app.storage });
    app.ctx.settings.update((settings) => withPanelVisible(settings, 'hardware', true));
    const engine = new DockEngine(app.ctx, app.panels, app.shell, 'simulator');
    engine.start();
    const tab = () => tabNodeOf(engine.model, 'simulator', 'hardware') as unknown as { isRendered(): boolean };
    expect(tab().isRendered()).toBe(false);
    engine.setSize(1200, 700);
    expect(tab().isRendered()).toBe(true);
  });
});
