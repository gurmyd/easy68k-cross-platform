// The dock controller (ARCHITECTURE-PLUS P4.4) without a mounted dock, and its routing to the dock
// of each mode. The docks themselves are tested in ui/dock (engine.test.ts) and in the browser
// (ui/dock/check-dock.mjs).

import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../contracts';
import { attachDock, dockModeOf, dockOf, lockedIn, withLocked, type DockLive } from './dock';
import { createTestApplication } from './testing';

function fakeLive(mode: 'editor' | 'simulator'): DockLive & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(
        `${name}(${args.map((arg) => (typeof arg === 'object' && arg !== null && 'id' in arg ? String((arg as { id: string }).id) : JSON.stringify(arg))).join(',')})`,
      );
    };
  return {
    mode,
    calls,
    has: () => true,
    reveal: record('reveal'),
    park: record('park'),
    present: (id) => {
      calls.push(`present(${id})`);
      return true;
    },
    openTransient: record('openTransient'),
    selectTransient: () => true,
    closeTransient: record('closeTransient'),
    closeAllTransients: record('closeAllTransients'),
    move: record('move'),
    reset: record('reset'),
    lockChanged: record('lockChanged'),
    describe: () => [{ panel: 'files', title: 'Files', group: 1 }],
  };
}

describe('dockOf', () => {
  it('gives one controller per window', () => {
    const a = {} as AppContext;
    const b = {} as AppContext;
    expect(dockOf(a)).toBe(dockOf(a));
    expect(dockOf(b)).not.toBe(dockOf(a));
  });

  it('without a dock: accepts transient tabs (queued), moves nothing, describes nothing', () => {
    const app = createTestApplication();
    const dock = dockOf(app.ctx);
    expect(dock.acceptsTransient()).toBe(true);
    const onClose = vi.fn();
    expect(dock.openTransient({ id: 'viewer:1', title: 'a.pdf', tooltip: 'a.pdf', render: () => null, onClose })).toBe(
      true,
    );
    expect(dock.selectTransient('viewer:1')).toBe(true);
    expect(dock.selectTransient('viewer:2')).toBe(false);
    dock.closeTransient('viewer:1');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dock.selectTransient('viewer:1')).toBe(false);
    expect(dock.present('files')).toBe(false);
    expect(dock.describe()).toEqual([]);
    dock.reveal('files');
    dock.park('files');
    dock.move('files', { kind: 'edge', side: 'left' });
    dock.reset();
  });

  it('queued transient tabs go to the Editor dock when it attaches, in order', () => {
    const app = createTestApplication();
    const dock = dockOf(app.ctx);
    const spec = (n: number) => ({
      id: `viewer:${n}` as const,
      title: `${n}`,
      tooltip: '',
      render: () => null,
      onClose: () => {},
    });
    dock.openTransient(spec(1));
    dock.openTransient(spec(2));
    const simulator = fakeLive('simulator');
    attachDock(app.ctx, simulator);
    expect(simulator.calls).toEqual([]);
    const editor = fakeLive('editor');
    attachDock(app.ctx, editor);
    expect(editor.calls).toEqual(['openTransient(viewer:1)', 'openTransient(viewer:2)']);
    dock.openTransient(spec(3));
    expect(editor.calls).toContain('openTransient(viewer:3)');
  });

  it('routes each panel to the dock of its mode; Messages and the commands to the mode in front', async () => {
    const app = createTestApplication();
    const editor = fakeLive('editor');
    const simulator = fakeLive('simulator');
    attachDock(app.ctx, editor);
    attachDock(app.ctx, simulator);
    const dock = dockOf(app.ctx);
    dock.reveal('memory');
    dock.park('files');
    dock.park('output');
    dock.present('messages');
    dock.move('files', { kind: 'edge', side: 'right' });
    dock.reset();
    expect(editor.calls).toEqual([
      'park("files")',
      'present(messages)',
      'move("files",{"kind":"edge","side":"right"})',
      'reset()',
    ]);
    expect(simulator.calls).toEqual(['reveal("memory",true)']);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    dock.present('messages');
    expect(simulator.calls).toContain('present(messages)');
    expect(dockModeOf('viewer:4', 'simulator')).toBe('editor');
    expect(dockModeOf('messages', 'easybin')).toBeNull();
    // The Help drawer, EASyBIN and the status bars are not dock panels.
    for (const id of ['help', 'easybin', 'status', 'nothing']) expect(dockModeOf(id, 'editor'), id).toBeNull();
  });

  it('a detached dock is no longer used', () => {
    const app = createTestApplication();
    const editor = fakeLive('editor');
    const attachment = attachDock(app.ctx, editor);
    attachment.detach();
    dockOf(app.ctx).park('files');
    expect(editor.calls).toEqual([]);
  });

  it('the lock is the setting layout.dock.locked, absent = true (D2); subscribers hear it', () => {
    const app = createTestApplication();
    const dock = dockOf(app.ctx);
    expect(dock.locked()).toBe(true);
    const heard = vi.fn();
    dock.subscribe(heard);
    dock.setLocked(false);
    expect(dock.locked()).toBe(false);
    expect(app.ctx.settings.get().app.layout.dock).toEqual({ version: 1, locked: false });
    expect(heard).toHaveBeenCalledTimes(1);
    const settings = app.ctx.settings.get();
    expect(withLocked(settings, false)).toBe(settings);
    expect(lockedIn(withLocked(settings, true))).toBe(true);
    // Panel visibility is not touched by the lock.
    expect(settings.app.layout.panels).toEqual(createTestApplication().ctx.settings.get().app.layout.panels);
  });

  it('counts actions and distinct mounts of each panel', () => {
    const app = createTestApplication();
    const attachment = attachDock(app.ctx, fakeLive('editor'));
    const instance = {};
    attachment.countMount('files', instance);
    attachment.countMount('files', instance);
    attachment.countMount('files', {});
    attachment.countAction();
    expect(dockOf(app.ctx).stats()).toEqual({ actions: { editor: 1, simulator: 0 }, mounts: { 'editor:files': 2 } });
  });
});
