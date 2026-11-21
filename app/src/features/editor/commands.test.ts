// The editor's commands in a whole application built from fakes (state/testing.ts), with the wave-0
// stub document service: one untitled document holding the template.
import { describe, expect, it } from 'vitest';
import { editorSession } from '../../ui/editor/session';
import { feature } from './index';
import { editorCommands } from './commands';
import type { EditorActions } from './editor-api';
import { createTestApplication } from '../../state/testing';

function setup() {
  const app = createTestApplication({ features: [feature] });
  const session = editorSession(app.ctx);
  const id = app.ctx.store.getState().documents.activeId as string;
  const text = () => session.link.state(id).doc.toString();
  return { app, session, id, text };
}

describe('feature "editor"', () => {
  it('contributes the editor area and the status bar of Editor mode', () => {
    expect(feature.panels?.map((panel) => `${panel.mode}/${panel.id}`)).toEqual(['editor/editor', 'editor/status']);
  });

  it('owns exactly the commands of 9.7', () => {
    expect(Object.keys(feature.commands ?? {}).sort()).toEqual(
      [
        'ed.edit.undo',
        'ed.edit.redo',
        'ed.edit.cut',
        'ed.edit.copy',
        'ed.edit.paste',
        'ed.edit.selectAll',
        'ed.edit.comment',
        'ed.edit.uncomment',
        'ed.edit.indent',
        'ed.edit.outdent',
        'ed.edit.toggleInsert',
        'ed.window.arrange',
        'ed.window.cascade',
        'ed.window.tileH',
        'ed.window.tileV',
        'ed.window.minimizeAll',
      ].sort(),
    );
  });

  it('Comment / Uncomment act on the active document, one undo step each; Undo and Redo follow', async () => {
    const { app, text } = setup();
    const { commands } = app.ctx;
    const before = text();
    expect(commands.isEnabled('ed.edit.undo')).toBe(false);
    // No selection: the caret line (line 1 at column 0, note 6).
    await commands.run('ed.edit.comment');
    expect(text()).toBe(`*${before}`);
    expect(commands.isEnabled('ed.edit.undo')).toBe(true);
    await commands.run('ed.edit.uncomment');
    expect(text()).toBe(before);
    await commands.run('ed.edit.undo');
    expect(text()).toBe(`*${before}`);
    expect(commands.isEnabled('ed.edit.redo')).toBe(true);
    await commands.run('ed.edit.redo');
    expect(text()).toBe(before);
  });

  it('Modified follows the history back to the loaded text (note 5, saved state tracked)', async () => {
    const { app, session, id } = setup();
    expect(session.link.modified(id)).toBe(false);
    await app.ctx.commands.run('ed.edit.comment');
    expect(session.link.modified(id)).toBe(true);
    await app.ctx.commands.run('ed.edit.undo');
    expect(session.link.modified(id)).toBe(false);
  });

  it('Indent, Outdent and Insert/Replace are enabled only while the editor has the focus (errata W3 25)', async () => {
    const { app, session, id, text } = setup();
    const { commands } = app.ctx;
    const before = text();
    for (const command of ['ed.edit.indent', 'ed.edit.outdent', 'ed.edit.toggleInsert']) {
      expect(commands.isEnabled(command)).toBe(false);
    }
    await commands.run('ed.edit.indent');
    expect(text()).toBe(before);
    session.focusChanged(id, true);
    expect(commands.isEnabled('ed.edit.indent')).toBe(true);
    await commands.run('ed.edit.indent');
    expect(text()).toBe(` ${before}`);
    await commands.run('ed.edit.outdent');
    expect(text()).toBe(before);
    expect(session.link.insertMode(id)).toBe(true);
    await commands.run('ed.edit.toggleInsert');
    expect(session.link.insertMode(id)).toBe(false);
    await commands.run('ed.edit.toggleInsert');
    expect(session.link.insertMode(id)).toBe(true);
    session.focusChanged(id, false);
    expect(commands.isEnabled('ed.edit.toggleInsert')).toBe(false);
  });

  it('a change of what the commands depend on is announced to menus and toolbars through the store', async () => {
    const { app } = setup();
    let notified = 0;
    app.ctx.store.subscribe(() => notified++);
    await app.ctx.commands.run('ed.edit.comment');
    expect(notified).toBeGreaterThan(0);
  });

  it('Window: Cascade, Tile Horizontally, Tile Vertically choose the panes; Arrange and Minimize All are disabled', async () => {
    const { app } = setup();
    const { commands } = app.ctx;
    const panes = () => app.ctx.settings.get().app.layout.editorPanes;
    expect(panes()).toBe('one');
    expect(commands.isChecked('ed.window.cascade')).toBe(true);
    await commands.run('ed.window.tileH');
    expect(panes()).toBe('horizontal');
    expect(commands.isChecked('ed.window.tileH')).toBe(true);
    await commands.run('ed.window.tileV');
    expect(panes()).toBe('vertical');
    await commands.run('ed.window.cascade');
    expect(panes()).toBe('one');
    expect(commands.isEnabled('ed.window.arrange')).toBe(false);
    expect(commands.isEnabled('ed.window.minimizeAll')).toBe(false);
  });
});

describe('commands without a document (editor-ui §2.2 quirk: the port does nothing)', () => {
  it('are disabled and call nothing', async () => {
    const calls: string[] = [];
    const fake = new Proxy({} as EditorActions, {
      get: (_t, key: string) => {
        if (key.startsWith('can') || key.startsWith('has') || key === 'editorHasFocus') return () => false;
        return () => void calls.push(key);
      },
    });
    const handlers = editorCommands(() => fake);
    const state = { documents: { activeId: null } } as never;
    for (const id of [
      'ed.edit.paste',
      'ed.edit.selectAll',
      'ed.edit.comment',
      'ed.edit.uncomment',
      'ed.window.tileV',
    ]) {
      expect(handlers[id]?.enabled?.(state, {} as never)).toBe(false);
    }
    expect(calls).toEqual([]);
  });
});
