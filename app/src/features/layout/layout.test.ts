// The layout commands (P3.1.4) and the choices of the dialog `layout.move`.

import { describe, expect, it } from 'vitest';
import { attachDock, dockOf, type DockLive } from '../../state/dock';
import { createTestApplication } from '../../state/testing';
import { feature, openMoveDialog } from './index';
import { initialChoice, otherPanels, resultOf, withPanel, type DescribedPanel } from './model';
import { MOVE_DIALOG_ID, MOVE_TEXTS } from './texts';

const PANELS: DescribedPanel[] = [
  { panel: 'files', title: 'Files', group: 1 },
  { panel: 'editor', title: 'Editor', group: 2 },
  { panel: 'viewer:1', title: 'report.pdf', group: 2 },
  { panel: 'messages', title: 'Messages', group: 3 },
];

describe("the dialog's choices", () => {
  it('starts on the given panel (the focused one, or the argument), else the first', () => {
    expect(initialChoice(PANELS, 'editor')).toEqual({
      panel: 'editor',
      place: 'tab',
      near: 'files',
      beside: 'left',
      edge: 'left',
    });
    expect(initialChoice(PANELS, null).panel).toBe('files');
    expect(initialChoice(PANELS, 'nothing').panel).toBe('files');
  });

  it('the second list holds the other visible panels, viewers included', () => {
    expect(otherPanels(PANELS, 'editor').map((entry) => entry.panel)).toEqual(['files', 'viewer:1', 'messages']);
    const changed = withPanel(PANELS, initialChoice(PANELS, 'editor'), 'files');
    expect(changed.near).toBe('editor');
    const kept = withPanel(PANELS, { ...initialChoice(PANELS, 'editor'), near: 'messages' }, 'files');
    expect(kept.near).toBe('messages');
  });

  it('OK gives the move of each place', () => {
    const base = initialChoice(PANELS, 'files');
    expect(resultOf({ ...base, place: 'tab', near: 'messages' })).toEqual({
      panel: 'files',
      target: { kind: 'tab', near: 'messages' },
    });
    expect(resultOf({ ...base, place: 'beside', near: 'editor', beside: 'below' })).toEqual({
      panel: 'files',
      target: { kind: 'beside', near: 'editor', side: 'below' },
    });
    expect(resultOf({ ...base, place: 'edge', edge: 'top' })).toEqual({
      panel: 'files',
      target: { kind: 'edge', side: 'top' },
    });
    expect(resultOf({ ...base, near: 'files' })).toBeNull();
  });

  it('the access keys of the two labels differ (P3.1.4 gives both &P; errata N1)', () => {
    expect(MOVE_TEXTS.panel).toBe('&Panel:');
    expect(MOVE_TEXTS.place).toBe('P&lace:');
  });
});

function fakeLive(moves: unknown[]): DockLive {
  return {
    mode: 'editor',
    has: () => true,
    reveal: () => {},
    park: () => {},
    present: () => true,
    openTransient: () => {},
    selectTransient: () => true,
    closeTransient: () => {},
    documentShown: () => {},
    closeAllTransients: () => {},
    move: (panel, target) => void moves.push({ panel, target }),
    reset: () => void moves.push('reset'),
    lockChanged: () => {},
    describe: () => PANELS,
  };
}

describe('the commands', () => {
  it('registers the three handlers, version 1.1 the six of P9.5, and the dialog', () => {
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual([
      'app.layout.dock',
      'app.layout.float',
      'app.layout.lock',
      'app.layout.move',
      'app.layout.reset',
      'sim.view.layout.classic',
      'sim.view.layout.floatingTools',
      'sim.view.layout.sideBySide',
      'sim.view.layout.wideOutput',
    ]);
    expect(Object.keys(feature.dialogs ?? {})).toEqual([MOVE_DIALOG_ID]);
  });

  it("Move Panel To... opens the dialog on the argument's panel and makes the chosen move", async () => {
    const app = createTestApplication({ features: [feature] });
    const moves: unknown[] = [];
    attachDock(app.ctx, fakeLive(moves));
    const opened = openMoveDialog(app.ctx, { panel: 'messages' });
    const dialog = app.ctx.store.getState().dialogs.stack[0]!;
    expect(dialog.id).toBe(MOVE_DIALOG_ID);
    expect((dialog.props as { initial: string }).initial).toBe('messages');
    app.dialogs.close(dialog.key, { panel: 'messages', target: { kind: 'edge', side: 'top' } });
    await opened;
    expect(moves).toEqual([{ panel: 'messages', target: { kind: 'edge', side: 'top' } }]);
  });

  it('Cancel moves nothing', async () => {
    const app = createTestApplication({ features: [feature] });
    const moves: unknown[] = [];
    attachDock(app.ctx, fakeLive(moves));
    const opened = openMoveDialog(app.ctx);
    const dialog = app.ctx.store.getState().dialogs.stack[0]!;
    app.dialogs.close(dialog.key, null);
    expect(await opened).toBeNull();
    expect(moves).toEqual([]);
  });

  it("Lock Layout is a check of the dock's lock; Reset Layout resets the mode in front", async () => {
    const app = createTestApplication({ features: [feature] });
    const moves: unknown[] = [];
    attachDock(app.ctx, fakeLive(moves));
    const lock = feature.commands!['app.layout.lock']!;
    expect(lock.checked!(app.ctx.store.getState(), app.ctx)).toBe(true);
    await app.ctx.commands.run('app.layout.lock');
    expect(dockOf(app.ctx).locked()).toBe(false);
    expect(lock.checked!(app.ctx.store.getState(), app.ctx)).toBe(false);
    await app.ctx.commands.run('app.layout.reset');
    expect(moves).toEqual(['reset']);
    // Reset keeps the lock (P3.1.3).
    expect(dockOf(app.ctx).locked()).toBe(false);
  });

  it('enabled in Editor and Simulator mode, not in EASyBIN', async () => {
    const app = createTestApplication({ features: [feature] });
    for (const id of ['app.layout.move', 'app.layout.lock', 'app.layout.reset'])
      expect(app.ctx.commands.isEnabled(id)).toBe(true);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    for (const id of ['app.layout.move', 'app.layout.lock', 'app.layout.reset'])
      expect(app.ctx.commands.isEnabled(id)).toBe(true);
    await app.ctx.commands.run('app.mode.set', 'easybin');
    for (const id of ['app.layout.move', 'app.layout.lock', 'app.layout.reset'])
      expect(app.ctx.commands.isEnabled(id)).toBe(false);
  });
});
