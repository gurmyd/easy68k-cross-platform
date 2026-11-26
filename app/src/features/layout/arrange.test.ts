// Version 1.1 of the layout feature (ARCHITECTURE-PLUS P9.2 to P9.5; M2): the four ready-made
// arrangements as data and their commands, the fourth place of `Move Panel To...`, the tip's
// decision and its setting. What needs a page (the arrangements on screen, the tip, the toolbar's
// button) is in check-arrange.mjs.

import { describe, expect, it } from 'vitest';
import type { DockNode, Settings } from '../../contracts';
import { arrangeTipAnswered, readPlus, withArrangeTipAnswered, withPlus } from '../../core/plus/settings';
import { defaultSettings } from '../../core/settings/defaults';
import { attachDock, dockOf, type DockArrangement, type DockLive } from '../../state/dock';
import { createTestApplication } from '../../state/testing';
import {
  ARRANGEMENT_COMMANDS,
  ARRANGEMENT_IDS,
  arrangementPlan,
  floatingToolRects,
  TOOL_WINDOW_SIZES,
  type ArrangementId,
} from './arrangements';
import { answerArrangeTip } from './ArrangeTip';
import { applyArrangement, feature, openMoveDialog, runArrangement } from './index';
import { canChooseFloat, initialChoice, otherPanels, resultOf, type DescribedPanel } from './model';
import { ARRANGE_BUTTON_TEXTS, ARRANGE_TIP_PARAM, ARRANGE_TIP_TEXTS, MOVE_DIALOG_ID, MOVE_TEXTS } from './texts';
import { platformUnderTest, readTipEnvironment, tipDue, tipForcedBy } from './tip';

const SIM_PANELS = ['registers', 'listing', 'messages', 'output', 'memory', 'stack', 'hardware', 'breakpoints', 'log'];
const FIXED = ['registers', 'listing', 'messages', 'output'];

function panelsOf(node: DockNode): string[] {
  return node.type === 'tabs' ? [...node.panels] : node.children.flatMap(panelsOf);
}

function arrangementOf(id: ArrangementId): DockArrangement {
  const plan = arrangementPlan(id);
  if (plan.kind !== 'arrange') throw new Error(`${id} is not a stored arrangement`);
  return plan.arrangement;
}

/** The shape without weights: `row(column(registers,listing,...),output)`. */
function shape(node: DockNode): string {
  if (node.type === 'tabs') return node.panels.join('+');
  return `${node.type}(${node.children.map(shape).join(',')})`;
}

describe('the four arrangements of P9.4, as data', () => {
  it('Classic is the default arrangement: what Reset Layout gives', () => {
    expect(arrangementPlan('classic')).toEqual({ kind: 'default' });
  });

  it.each(['wideOutput', 'sideBySide', 'floatingTools'] as const)(
    '%s names every panel of the Simulator exactly once, shown or hidden, and docks the fixed ones',
    (id) => {
      const arrangement = arrangementOf(id);
      expect(arrangement.mode).toBe('simulator');
      const all = [...panelsOf(arrangement.docked), ...arrangement.floating.map((entry) => entry.panel)];
      expect([...all].sort()).toEqual([...SIM_PANELS].sort());
      for (const panel of FIXED) expect(panelsOf(arrangement.docked), panel).toContain(panel);
    },
  );

  it('Wide Output: registers, listing, the tool group and messages in the left column; Output alone at the right', () => {
    expect(shape(arrangementOf('wideOutput').docked)).toBe(
      'row(column(registers,listing,memory+stack+hardware+breakpoints+log,messages),output)',
    );
    expect(arrangementOf('wideOutput').floating).toEqual([]);
  });

  it('Side by Side: as Classic with Hardware in a column of its own right of Output; the other tools below the listing', () => {
    expect(shape(arrangementOf('sideBySide').docked)).toBe(
      'row(column(registers,listing,memory+stack+breakpoints+log,messages),output,hardware)',
    );
  });

  it('Floating Tools: Classic for the four fixed panels, every tool panel floats from the top right at its default size', () => {
    const arrangement = arrangementOf('floatingTools');
    expect(shape(arrangement.docked)).toBe('row(column(registers,listing,messages),output)');
    // Without the dock's size (no page) the dock's own cascade places them.
    expect(arrangement.floating).toEqual(
      ['hardware', 'memory', 'stack', 'breakpoints', 'log'].map((panel) => ({ panel })),
    );
    expect(arrangement.cascade).toBe('top-right');
    // With it, each window has its own size and place.
    const plan = arrangementPlan('floatingTools', { area: { width: 1366, height: 681 } });
    expect(plan.kind === 'arrange' && plan.arrangement.floating).toEqual(
      floatingToolRects({ width: 1366, height: 681 }),
    );
  });

  it('Floating Tools at 1366 by 768 and 1920 by 1080: each window at its default size, inside the dock, cascaded from the top right', () => {
    for (const area of [
      { width: 1366, height: 681 },
      { width: 1920, height: 993 },
    ]) {
      const windows = floatingToolRects(area);
      expect(windows.map((entry) => entry.panel)).toEqual(['hardware', 'memory', 'stack', 'breakpoints', 'log']);
      windows.forEach(({ panel, rect }, index) => {
        const step = 24 * (index + 1);
        const size = TOOL_WINDOW_SIZES[panel as keyof typeof TOOL_WINDOW_SIZES];
        expect({ width: rect.width, height: rect.height }, panel).toEqual(size);
        expect(rect.x + rect.width, panel).toBe(area.width - step);
        expect(rect.y, panel).toBe(step);
        expect(rect.y + rect.height, panel).toBeLessThanOrEqual(area.height);
        expect(rect.x, panel).toBeGreaterThanOrEqual(0);
      });
    }
    // The Hardware panel needs 522 by 627 (its window, title bar included): whole at 1366 by 768.
    expect(TOOL_WINDOW_SIZES.hardware.width).toBeGreaterThanOrEqual(522);
    expect(TOOL_WINDOW_SIZES.hardware.height).toBeGreaterThanOrEqual(627);
  });

  it('Floating Tools in a small dock: the windows get smaller to stay inside it, never below 160 by 96', () => {
    const area = { width: 700, height: 400 };
    for (const { panel, rect } of floatingToolRects(area)) {
      expect(rect.x, panel).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width, panel).toBeLessThanOrEqual(area.width);
      expect(rect.y + rect.height, panel).toBeLessThanOrEqual(area.height);
      expect(rect.width, panel).toBeGreaterThanOrEqual(160);
      expect(rect.height, panel).toBeGreaterThanOrEqual(96);
    }
    for (const { rect } of floatingToolRects({ width: 100, height: 50 })) {
      expect(rect).toMatchObject({ width: 160, height: 96 });
    }
  });

  it('the tool group shows the tool in front, else the first shown one', () => {
    const selected = (input: Parameters<typeof arrangementPlan>[1]) => {
      const plan = arrangementPlan('wideOutput', input);
      if (plan.kind !== 'arrange' || plan.arrangement.docked.type === 'tabs') throw new Error('shape');
      const left = plan.arrangement.docked.children[0]!;
      if (left.type === 'tabs') throw new Error('shape');
      const group = left.children[2]!;
      return group.type === 'tabs' ? group.selected : null;
    };
    expect(selected({ front: 'hardware' })).toBe('hardware');
    expect(selected({ front: null, shown: (panel) => panel === 'stack' })).toBe('stack');
    expect(selected({})).toBe('memory');
    // Hardware is not in the tool group of Side by Side.
    const plan = arrangementPlan('sideBySide', { front: 'hardware', shown: () => true });
    expect(plan.kind === 'arrange' && JSON.stringify(plan.arrangement.docked)).toContain('"selected":"memory"');
  });

  it('every weight is positive', () => {
    const weights = (node: DockNode): number[] =>
      node.type === 'tabs' ? [node.weight] : [node.weight, ...node.children.flatMap(weights)];
    for (const id of ['wideOutput', 'sideBySide', 'floatingTools'] as const) {
      for (const weight of weights(arrangementOf(id).docked)) expect(weight, id).toBeGreaterThan(0);
    }
  });
});

interface Calls {
  arranged: DockArrangement[];
  reset: number;
  floated: string[];
  moved: unknown[];
}

function fakeLive(mode: 'editor' | 'simulator', calls: Calls, panels: DescribedPanel[] = []): DockLive {
  return {
    mode,
    has: () => true,
    reveal: () => {},
    park: () => {},
    present: () => true,
    openTransient: () => {},
    selectTransient: () => true,
    closeTransient: () => {},
    documentShown: () => {},
    closeAllTransients: () => {},
    move: (panel, target) => void calls.moved.push({ panel, target }),
    reset: () => void calls.reset++,
    lockChanged: () => {},
    describe: () => panels,
    float: (panel) => void calls.floated.push(panel),
    dock: () => {},
    floating: () => [],
    canFloat: (panel) => panel !== 'editor',
    arrange: (arrangement) => {
      calls.arranged.push(arrangement);
      return true;
    },
  };
}

const newCalls = (): Calls => ({ arranged: [], reset: 0, floated: [], moved: [] });

describe('the commands of View > Layouts (P9.4, P9.5)', () => {
  it('four commands, in menu order, enabled in Simulator mode only', async () => {
    expect(ARRANGEMENT_IDS.map((id) => ARRANGEMENT_COMMANDS[id])).toEqual([
      'sim.view.layout.classic',
      'sim.view.layout.wideOutput',
      'sim.view.layout.sideBySide',
      'sim.view.layout.floatingTools',
    ]);
    const app = createTestApplication({ features: [feature] });
    for (const id of Object.values(ARRANGEMENT_COMMANDS)) expect(app.ctx.commands.isEnabled(id), id).toBe(false);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    for (const id of Object.values(ARRANGEMENT_COMMANDS)) expect(app.ctx.commands.isEnabled(id), id).toBe(true);
    await app.ctx.commands.run('app.mode.set', 'easybin');
    for (const id of Object.values(ARRANGEMENT_COMMANDS)) expect(app.ctx.commands.isEnabled(id), id).toBe(false);
  });

  it('Classic resets the layout; the others arrange the Simulator dock; none shows or hides a panel, the lock is kept', async () => {
    const app = createTestApplication({ features: [feature] });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    const calls = newCalls();
    attachDock(app.ctx, fakeLive('simulator', calls));
    dockOf(app.ctx).setLocked(false);
    const panelsBefore = JSON.stringify(app.ctx.settings.get().app.layout.panels);
    await app.ctx.commands.run('sim.view.layout.classic');
    expect(calls.reset).toBe(1);
    await app.ctx.commands.run('sim.view.layout.wideOutput');
    await app.ctx.commands.run('sim.view.layout.sideBySide');
    await app.ctx.commands.run('sim.view.layout.floatingTools');
    expect(calls.arranged.map((arrangement) => shape(arrangement.docked))).toEqual([
      shape(arrangementOf('wideOutput').docked),
      shape(arrangementOf('sideBySide').docked),
      shape(arrangementOf('floatingTools').docked),
    ]);
    expect(JSON.stringify(app.ctx.settings.get().app.layout.panels)).toBe(panelsBefore);
    expect(dockOf(app.ctx).locked()).toBe(false);
    dockOf(app.ctx).setLocked(true);
    expect(applyArrangement(app.ctx, 'wideOutput')).toBe(true);
    expect(dockOf(app.ctx).locked()).toBe(true);
  });

  it('Floating Tools chosen as the window switches to the Simulator waits for the dock to be laid out', async () => {
    // The page as it is in the same moment as the switch: the Simulator's dock has no size yet; it
    // gets one at the next frame. The windows must cascade from that dock's top right, not from a
    // size of before (verify round 1 of M2: x 816 instead of 982 at 1366 px).
    const app = createTestApplication({ features: [feature] });
    await app.ctx.commands.run('app.mode.set', 'simulator');
    const calls = newCalls();
    attachDock(app.ctx, fakeLive('simulator', calls));
    let width = 0;
    const element = { getBoundingClientRect: () => ({ width, height: width === 0 ? 0 : 681 }) };
    const g = globalThis as Record<string, unknown>;
    g.document = { querySelector: (selector: string) => (selector === '[data-e68-dock="simulator"]' ? element : null) };
    g.requestAnimationFrame = (callback: () => void) =>
      setTimeout(() => {
        width = 1366;
        callback();
      }, 0);
    try {
      await expect(runArrangement(app.ctx, 'floatingTools')).resolves.toBe(true);
    } finally {
      delete g.document;
      delete g.requestAnimationFrame;
    }
    expect(calls.arranged).toHaveLength(1);
    expect(calls.arranged[0]!.floating).toEqual(floatingToolRects({ width: 1366, height: 681 }));
    expect(calls.arranged[0]!.floating[0]!.rect).toEqual({ x: 1366 - 24 - 540, y: 24, width: 540, height: 640 });
  });

  it('without the Simulator dock an arrangement does nothing', () => {
    const app = createTestApplication({ features: [feature] });
    expect(applyArrangement(app.ctx, 'wideOutput')).toBe(false);
  });

  it('the handlers of Float and Dock (M1) are registered here', async () => {
    const app = createTestApplication({ features: [feature] });
    expect(app.commands.hasHandler('app.layout.float')).toBe(true);
    expect(app.commands.hasHandler('app.layout.dock')).toBe(true);
    const calls = newCalls();
    attachDock(app.ctx, fakeLive('editor', calls));
    await app.ctx.commands.run('app.layout.float', { panel: 'files' });
    expect(calls.floated).toEqual(['files']);
  });
});

const PANELS: DescribedPanel[] = [
  { panel: 'files', title: 'Files', group: 1 },
  { panel: 'editor', title: 'Editor', group: 2 },
  { panel: 'messages', title: 'Messages', group: 3 },
  { panel: 'viewer:1', title: 'report.pdf', group: 0, floating: true },
];

describe('Move Panel To... As a floating window (P9.2)', () => {
  it('the text of the fourth place', () => {
    expect(MOVE_TEXTS.float).toBe('As a floating window');
  });

  it('a floating panel is no target of a move', () => {
    expect(otherPanels(PANELS, 'files').map((entry) => entry.panel)).toEqual(['editor', 'messages']);
  });

  it('OK makes the panel float when it can, or is a floating window already', () => {
    const floatable = ['files', 'messages'];
    const choice = { ...initialChoice(PANELS, 'files'), place: 'float' as const };
    expect(resultOf(choice, PANELS, floatable)).toEqual({ panel: 'files', float: true });
    expect(resultOf({ ...choice, panel: 'editor' }, PANELS, floatable)).toBeNull();
    expect(resultOf({ ...choice, panel: 'viewer:1' }, PANELS, floatable)).toEqual({ panel: 'viewer:1', float: true });
    expect(canChooseFloat(PANELS, floatable, 'editor')).toBe(false);
    expect(canChooseFloat(PANELS, floatable, 'nothing')).toBe(false);
  });

  it('the command makes the panel float; the dialog is told which panels can', async () => {
    const app = createTestApplication({ features: [feature] });
    const calls = newCalls();
    attachDock(app.ctx, fakeLive('editor', calls, PANELS));
    const opened = openMoveDialog(app.ctx, { panel: 'files' });
    const dialog = app.ctx.store.getState().dialogs.stack[0]!;
    expect(dialog.id).toBe(MOVE_DIALOG_ID);
    expect((dialog.props as { floatable: string[] }).floatable).toEqual(['files', 'messages', 'viewer:1']);
    app.dialogs.close(dialog.key, { panel: 'files', float: true });
    await opened;
    expect(calls.floated).toEqual(['files']);
    expect(calls.moved).toEqual([]);
  });
});

function state(mode: 'editor' | 'simulator' | 'easybin', phase: string, settings: Settings = defaultSettings()) {
  return { mode, sim: { phase }, settings } as unknown as Parameters<typeof tipDue>[0];
}

describe('the tip of P9.3', () => {
  const person = { automated: false, forced: false };

  it('its texts', () => {
    expect(ARRANGE_TIP_TEXTS.text).toBe(
      'You can rearrange this window: make a panel float, dock it elsewhere or pick a ready-made layout in the View menu.',
    );
    expect(ARRANGE_TIP_TEXTS.arrange).toBe('Arrange Panels');
    expect(ARRANGE_TIP_TEXTS.dismiss).toBe('Got it');
    expect(ARRANGE_BUTTON_TEXTS.caption).toBe('Arrange Panels');
  });

  it('is due in the Simulator with no program running, until it is answered', () => {
    expect(tipDue(state('simulator', 'idle'), person)).toBe(true);
    expect(tipDue(state('editor', 'idle'), person)).toBe(false);
    expect(tipDue(state('easybin', 'idle'), person)).toBe(false);
    for (const phase of ['running', 'waitInput', 'waitDelay', 'waitHost', 'waitAlert', 'loading']) {
      expect(tipDue(state('simulator', phase), person), phase).toBe(false);
    }
    expect(tipDue(state('simulator', 'idle', withArrangeTipAnswered(defaultSettings())), person)).toBe(false);
  });

  it('a browser driven by a test sees it only with arrange-tip=1', () => {
    expect(tipDue(state('simulator', 'idle'), { automated: true, forced: false })).toBe(false);
    expect(tipDue(state('simulator', 'idle'), { automated: true, forced: true })).toBe(true);
    expect(ARRANGE_TIP_PARAM).toBe('arrange-tip');
    expect(tipForcedBy('?arrange-tip=1')).toBe(true);
    expect(tipForcedBy('?open=a.S68&arrange-tip=1')).toBe(true);
    expect(tipForcedBy('?arrange-tip=0')).toBe(false);
    expect(tipForcedBy('')).toBe(false);
  });

  it('the desktop app started by its tests counts as driven by a test (Electron sets no navigator.webdriver)', () => {
    expect(platformUnderTest({ kind: 'desktop', testMode: true })).toBe(true);
    for (const platform of [{ kind: 'desktop', testMode: false }, { kind: 'web' }, null, undefined, 'x']) {
      expect(platformUnderTest(platform), JSON.stringify(platform)).toBe(false);
    }
    // Without a page (Node) the tip is never due.
    expect(readTipEnvironment({ testMode: false })).toEqual({ automated: true, forced: false });
  });

  it('either button answers it for the profile; Arrange Panels also unlocks the layout', () => {
    const app = createTestApplication({ features: [feature] });
    expect(arrangeTipAnswered(app.ctx.settings.get())).toBe(false);
    answerArrangeTip(app.ctx, false);
    expect(arrangeTipAnswered(app.ctx.settings.get())).toBe(true);
    expect(dockOf(app.ctx).locked()).toBe(true);
    const other = createTestApplication({ features: [feature] });
    answerArrangeTip(other.ctx, true);
    expect(arrangeTipAnswered(other.ctx.settings.get())).toBe(true);
    expect(dockOf(other.ctx).locked()).toBe(false);
  });
});

describe('the setting app.plus.arrangeTipAnswered (core/plus/settings.ts)', () => {
  const stored = (plus: unknown): Settings => {
    const settings = defaultSettings();
    return { ...settings, app: { ...settings.app, plus } } as unknown as Settings;
  };

  it('only true counts as answered', () => {
    expect(arrangeTipAnswered(defaultSettings())).toBe(false);
    for (const value of [undefined, null, 1, 'true', {}, false]) {
      expect(arrangeTipAnswered(stored({ arrangeTipAnswered: value })), String(value)).toBe(false);
    }
    expect(arrangeTipAnswered(stored({ arrangeTipAnswered: true }))).toBe(true);
    expect(arrangeTipAnswered(stored('x'))).toBe(false);
  });

  it('answering keeps the two switches; changing a switch keeps the answer', () => {
    const answered = withArrangeTipAnswered(stored({ viewer: false, history: true }));
    expect(answered.app.plus).toEqual({ viewer: false, history: true, arrangeTipAnswered: true });
    expect(withArrangeTipAnswered(answered)).toBe(answered);
    const changed = withPlus(answered, { history: false });
    expect(readPlus(changed)).toEqual({ viewer: false, history: false });
    expect(arrangeTipAnswered(changed)).toBe(true);
  });
});
