// Undo in the Files panel (ARCHITECTURE-PLUS P3.2.7, P3.3.9) and Rename (actions.ts) under Node.

import { describe, expect, it } from 'vitest';
import type { HistoryService, Settings, SettingsService, Vfs } from '../../contracts';
import { cannotKeepQuestion } from '../../core/history/texts';
import { createMemoryHistoryService } from '../../fs/history-memory';
import { createTestApplication } from '../../state/testing';
import { renamePath } from './actions';
import type { UndoEntry } from './bulk';
import { createFileDialogs, feature } from './index';
import { transferItems } from './move';
import { cannotMoveBackExists, cannotMoveBackGone, gitRefusal, openInEditor, undoCaption } from './texts';
import { ascii, fakeDocuments, filesTestDeps, memoryStores, scriptedDialogs, scriptedHistory, text } from './testing';
import { UNDO_LIMIT, UndoStack, undoStackOf } from './undo';

const never = { setTimer: () => () => {}, onFrame: () => () => {} };
const clock = { now: () => 0, wallTime: () => new Date(Date.UTC(2026, 10, 22, 12, 0, 0)) };
const realHistory = (vfs: Vfs): HistoryService => createMemoryHistoryService({ vfs, clock, scheduler: never });
const settled = (history: HistoryService) => (history as unknown as { settled(): Promise<void> }).settled();

async function seed(vfs: Vfs, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/')) await vfs.mkdirp(path.slice(0, -1));
    else await vfs.writeFile(path, ascii(content));
  }
}

describe('the undo stack (P3.2.7)', () => {
  it('holds the last 20 operations; a 21st drops the oldest', () => {
    const stack = new UndoStack();
    const entry = (i: number): UndoEntry => ({ kind: 'copy', copies: [`/browser/c${i}`], created: [], replaced: [] });
    for (let i = 1; i <= 21; i++) stack.push(entry(i));
    expect(UNDO_LIMIT).toBe(20);
    expect(stack.size).toBe(20);
    const taken: string[] = [];
    for (let e = stack.take(); e; e = stack.take()) taken.push((e as { copies: string[] }).copies[0] as string);
    expect(taken.at(-1)).toBe('/browser/c2');
    expect(taken[0]).toBe('/browser/c21');
  });

  it('the context menu item names the operation', () => {
    expect(undoCaption('delete')).toBe('&Undo Delete');
    expect(undoCaption('move')).toBe('&Undo Move');
    expect(undoCaption('rename')).toBe('&Undo Rename');
    expect(undoCaption('copy')).toBe('&Undo Copy');
    expect(undoCaption(null)).toBe('&Undo');
  });
});

describe('Undo of Move, Rename and Copy (P3.2.7)', { timeout: 60_000 }, () => {
  it('Undo of a move moves each file back and the history follows back; an open document too', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/a.X68': 'A', '/browser/demo/e/': '', '/browser/to/': '' });
    const history = realHistory(vfs);
    await history.record('/browser/demo/a.X68', ascii('A'), 'saved', 1);
    await settled(history);
    const documents = fakeDocuments(['/browser/demo/a.X68']);
    const deps = filesTestDeps({ vfs, history, documents });
    await transferItems(deps, ['/browser/demo'], '/browser/to');
    expect(text(await vfs.readFile('/browser/to/demo/a.X68'))).toBe('A');
    // A change since the move moves back with the file.
    await vfs.writeFile('/browser/to/demo/a.X68', ascii('A2'));
    deps.dialogs.toasts[0]?.action?.run();
    for (let i = 0; i < 200 && deps.undone.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(deps.undone).toEqual([['/browser/demo/a.X68']]);
    expect(text(await vfs.readFile('/browser/demo/a.X68'))).toBe('A2');
    expect((await vfs.stat('/browser/demo/e'))?.kind).toBe('dir');
    expect(await vfs.stat('/browser/to/demo')).toBeNull(); // the folder the move created goes again
    expect((await history.versions('/browser/demo/a.X68')).length).toBe(1);
    expect(documents.calls).toEqual([
      'relocate /browser/demo/a.X68 -> /browser/to/demo/a.X68',
      'relocate /browser/to/demo/a.X68 -> /browser/demo/a.X68',
    ]);
  });

  it('a file is not moved back over something, nor when it is gone', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/prog.X68': 'P', '/browser/demo/q.X68': 'Q', '/browser/to/': '' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    await transferItems(deps, ['/browser/demo/prog.X68', '/browser/demo/q.X68'], '/browser/to');
    await vfs.writeFile('/browser/demo/prog.X68', ascii('new one'));
    await vfs.remove('/browser/to/q.X68');
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.texts()).toEqual([
      cannotMoveBackExists('prog.X68', 'demo/prog.X68'),
      cannotMoveBackGone('q.X68'),
    ]);
    expect(cannotMoveBackExists('prog.X68', 'demo/prog.X68')).toBe(
      '"prog.X68" cannot be moved back: "demo/prog.X68" exists now.',
    );
    expect(cannotMoveBackGone('prog.X68')).toBe('"prog.X68" cannot be moved back: it no longer exists.');
    expect(deps.dialogs.shown[0]).toMatchObject({ title: 'Undo', icon: 'information', buttons: ['OK'] });
    expect(text(await vfs.readFile('/browser/to/prog.X68'))).toBe('P');
  });

  it('without relocate, Undo of a move of an open file is refused', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a.X68': 'A', '/browser/to/': '' });
    const documents = fakeDocuments([], { relocate: false });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), documents });
    await transferItems(deps, ['/browser/a.X68'], '/browser/to');
    documents.docs = fakeDocuments(['/browser/to/a.X68']).docs;
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.texts()).toEqual([openInEditor('a.X68', 'move')]);
    expect(await vfs.stat('/browser/to/a.X68')).not.toBeNull();
  });

  it('Undo of a Copy puts the copies into the Trash (an edited copy can come back)', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/a.X68': 'A' });
    const history = realHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    await transferItems(deps, ['/browser/demo'], '/folder');
    await vfs.writeFile('/folder/demo/a.X68', ascii('edited copy'));
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(await vfs.stat('/folder/demo')).toBeNull();
    const trash = await history.trashItems();
    expect(trash.map((i) => [i.path, i.cause])).toEqual([['/folder/demo/a.X68', 'deleted']]);
    expect(text(await vfs.readFile('/browser/demo/a.X68'))).toBe('A');
  });

  it('Undo of a Copy asks the question of P3.3.4 when no copy can be kept; No leaves the copy', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a.X68': 'A' });
    const history = scriptedHistory(vfs, { script: () => 'cannot-keep' });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['No']) });
    await transferItems(deps, ['/browser/a.X68'], '/folder');
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.shown).toEqual([
      {
        title: 'Undo',
        text: cannotKeepQuestion('undo-copy', 'a.X68', false),
        icon: 'warning',
        buttons: ['Yes', 'No'],
        defaultButton: 'No',
      },
    ]);
    expect(cannotKeepQuestion('undo-copy', 'prog.X68', false)).toBe(
      'EASy68K cannot keep a copy of "prog.X68" in the Trash. Remove the copy anyway? This cannot be undone.',
    );
    expect(await vfs.stat('/folder/a.X68')).not.toBeNull();
  });

  it('Undo of a Copy asks before removing an edited copy when the history is not ready (off, tight, unavailable)', async () => {
    for (const state of ['off', 'tight', 'unavailable'] as const) {
      for (const answer of ['No', 'Yes']) {
        const { vfs } = memoryStores();
        await seed(vfs, { '/browser/a/p.X68': 'P', '/browser/b/': '' });
        const history = scriptedHistory(vfs, { state });
        const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs([answer]) });
        await transferItems(deps, ['/browser/a/p.X68'], '/browser/b', 'copy');
        await vfs.writeFile('/browser/b/p.X68', ascii('EDITED BY STUDENT'));
        await deps.undo.run(deps.stack.peek() as UndoEntry, false);
        expect(deps.dialogs.shown, `${state} ${answer}`).toEqual([
          {
            title: 'Undo',
            text: cannotKeepQuestion('undo-copy', 'p.X68', false),
            icon: 'warning',
            buttons: ['Yes', 'No'],
            defaultButton: 'No',
          },
        ]);
        const left = await vfs.stat('/browser/b/p.X68');
        if (answer === 'No') expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('EDITED BY STUDENT');
        else expect(left).toBeNull();
        expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('P');
      }
    }
  });

  it('Undo of a Copy with the real store switched off asks too (probe P2)', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a/p.X68': 'P', '/browser/b/': '' });
    const settingsValue = { app: { plus: { viewer: true, history: false } } } as unknown as Settings;
    const settings: SettingsService = { get: () => settingsValue, update: () => {}, subscribe: () => () => {} };
    const history = createMemoryHistoryService({ vfs, clock, scheduler: never, settings });
    await settled(history);
    expect(history.state()).toBe('off');
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['No']) });
    await transferItems(deps, ['/browser/a/p.X68'], '/browser/b', 'copy');
    await vfs.writeFile('/browser/b/p.X68', ascii('EDITED BY STUDENT'));
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.texts()).toEqual([cannotKeepQuestion('undo-copy', 'p.X68', false)]);
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('EDITED BY STUDENT');
  });

  it('Undo of a Move or Copy with Replace brings the replaced files back to the target', async () => {
    for (const across of [false, true]) {
      const { vfs } = memoryStores();
      const source = across ? '/folder/prog.X68' : '/browser/prog.X68';
      await seed(vfs, { [source]: 'new', '/browser/demo/prog.X68': 'old' });
      const history = realHistory(vfs);
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
      await transferItems(deps, [source], '/browser/demo');
      expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('new');
      await deps.undo.run(deps.stack.peek() as UndoEntry, false);
      expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('old');
      expect(text(await vfs.readFile(source))).toBe('new');
    }
  });
});

describe('Rename (P3.2.4)', { timeout: 60_000 }, () => {
  function app() {
    return createTestApplication({ features: [feature], services: { createFileDialogs } });
  }
  function answerNames(application: ReturnType<typeof app>, names: string[]) {
    const stop = application.ctx.store.subscribe(() => {
      for (const dialog of application.ctx.store.getState().dialogs.stack) {
        if ((dialog as { answered?: boolean }).answered) continue;
        (dialog as { answered?: boolean }).answered = true;
        const result = names.shift();
        queueMicrotask(() => application.dialogs.close(dialog.key, result));
        if (names.length === 0) stop();
      }
    });
  }

  it('a change of letter case only keeps the file history; Undo Rename takes it back', async () => {
    const application = app();
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/prog.X68', ascii('P'));
    await ctx.history?.record('/browser/prog.X68', ascii('P'), 'saved', 1);
    await settled(ctx.history as HistoryService);
    answerNames(application, ['PROG.X68']);
    expect(await renamePath(ctx, '/browser/prog.X68')).toBe('/browser/PROG.X68');
    expect((await ctx.history?.versions('/browser/PROG.X68'))?.length).toBe(1);
    expect(undoStackOf(ctx).kind()).toBe('rename');
    application.dispose();
  });

  it('Undo Rename is refused when something exists at the old name, or the file is gone', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a.X68': 'A', '/browser/c.X68': 'C' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const { afterRename } = await import('./actions');
    const { renameEntry } = await import('./store');
    await afterRename(deps, '/browser/a.X68', await renameEntry(vfs, '/browser/a.X68', 'b.X68'));
    await vfs.writeFile('/browser/a.X68', ascii('new'));
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    await afterRename(deps, '/browser/c.X68', await renameEntry(vfs, '/browser/c.X68', 'd.X68'));
    await vfs.remove('/browser/d.X68');
    await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(deps.dialogs.texts()).toEqual([cannotMoveBackExists('a.X68', 'a.X68'), cannotMoveBackGone('c.X68')]);
    expect(text(await vfs.readFile('/browser/b.X68'))).toBe('A');
  });

  it('in a store that keeps letter case apart, a case-only rename (or its Undo) never writes over the other spelling', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a/r.X68': 'ONE' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const { afterRename } = await import('./actions');
    const { renameChecked } = await import('./rename');
    await afterRename(deps, '/browser/a/r.X68', await renameChecked(vfs, '/browser/a/r.X68', 'R.X68'));
    await vfs.writeFile('/browser/a/r.X68', ascii('TWO')); // a save under the old spelling: a second file
    const names = (await vfs.list('/browser/a')).map((e) => e.name).sort();
    if (names.length === 2) {
      // The memory store keeps both spellings (as a Linux disk does).
      await expect(renameChecked(vfs, '/browser/a/R.X68', 'r.X68')).rejects.toThrow('"r.X68" already exists.');
      await deps.undo.run(deps.stack.peek() as UndoEntry, false);
      expect(deps.dialogs.texts()).toEqual([cannotMoveBackExists('r.X68', 'a/r.X68')]);
      expect(text(await vfs.readFile('/browser/a/r.X68'))).toBe('TWO');
      expect(text(await vfs.readFile('/browser/a/R.X68'))).toBe('ONE');
    } else {
      expect(names).toEqual(['R.X68']);
    }
  });

  it('a folder that holds .git is not renamed; an open file is not renamed while relocate is missing', async () => {
    const application = app();
    const { ctx } = application;
    await ctx.vfs.writeFile('/browser/demo/.git/HEAD', ascii('x'));
    await ctx.vfs.writeFile('/browser/b.X68', ascii('b'));
    const shown: string[] = [];
    const real = ctx.dialogs.messageBox.bind(ctx.dialogs);
    ctx.dialogs.messageBox = async (request) => {
      shown.push(`${request.title}: ${request.text}`);
      return 'OK';
    };
    expect(await renamePath(ctx, '/browser/demo')).toBeNull();
    const documents = ctx.documents as { relocate?: unknown; list: () => unknown[] };
    const list = documents.list;
    documents.relocate = undefined;
    documents.list = () => [{ id: 'x', path: '/browser/b.X68', modified: false }];
    expect(await renamePath(ctx, '/browser/b.X68')).toBeNull();
    documents.list = list;
    expect(shown).toEqual([
      `Rename: ${gitRefusal('demo', null, 'rename')}`,
      `Rename: ${openInEditor('b.X68', 'rename')}`,
    ]);
    expect(openInEditor('prog.X68', 'rename')).toBe(
      '"prog.X68" is open in the editor. Close it first, then rename it.',
    );
    ctx.dialogs.messageBox = real;
    application.dispose();
  });
});
