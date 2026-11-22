// Moving and copying (ARCHITECTURE-PLUS P3.2.4) and rename (actions.ts) under Node: the refusals,
// the Replace question and its order, the history following a moved file, open documents, and
// the real store (createMemoryHistoryService) for what goes to the Trash.

import { describe, expect, it } from 'vitest';
import type { HistoryService, Vfs } from '../../contracts';
import { cannotKeepQuestion } from '../../core/history/texts';
import { createMemoryHistoryService } from '../../fs/history-memory';
import { moveTargets, refusedTarget, transferItems, transferModeOf } from './move';
import { moveToButton } from './MoveToDialog';
import { gitRefusal, openInEditor, replaceManyQuestion, replaceOneQuestion, unsavedReplace } from './texts';
import { ascii, fakeDocuments, filesTestDeps, memoryStores, scriptedDialogs, scriptedHistory, text } from './testing';

const never = { setTimer: () => () => {}, onFrame: () => () => {} };
const clock = { now: () => 0, wallTime: () => new Date(Date.UTC(2026, 10, 22, 12, 0, 0)) };
const realHistory = (vfs: Vfs): HistoryService => createMemoryHistoryService({ vfs, clock, scheduler: never });

async function seed(vfs: Vfs, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith('/')) await vfs.mkdirp(path.slice(0, -1));
    else await vfs.writeFile(path, ascii(content));
  }
}

describe('Move and Copy: where to (P3.2.4)', { timeout: 60_000 }, () => {
  it('within a store a move, between stores a copy', () => {
    expect(transferModeOf(['/browser/a.X68'], '/browser/demo')).toBe('move');
    expect(transferModeOf(['/browser/a.X68'], '/folder')).toBe('copy');
    expect(transferModeOf(['/folder/a.X68', '/browser/b.X68'], '/browser')).toBe('copy');
    expect(moveToButton(['/browser/a.X68'], '/folder')).toBe('Copy');
    expect(moveToButton(['/browser/a.X68'], '/browser/demo')).toBe('Move');
  });

  it('refused targets: into itself or below, "Opened from this computer", .git, its own folder', () => {
    expect(refusedTarget(['/browser/demo'], '/browser/demo')).toBe(true);
    expect(refusedTarget(['/browser/demo'], '/browser/demo/sub')).toBe(true);
    expect(refusedTarget(['/browser/a.X68'], '/linked')).toBe(true);
    expect(refusedTarget(['/browser/a.X68'], '/linked/ab12')).toBe(true);
    expect(refusedTarget(['/browser/a.X68'], '/browser/repo/.git')).toBe(true);
    expect(refusedTarget(['/browser/a.X68'], '/browser/repo/.GIT/refs')).toBe(true);
    expect(refusedTarget(['/browser/demo/a.X68'], '/browser/demo')).toBe(true);
    expect(refusedTarget(['/browser/demo/a.X68'], '/browser')).toBe(false);
    expect(refusedTarget(['/browser/demo'], '/folder')).toBe(false);
  });

  it('the Move To dialog lists the folders of every store, without .git, the items, or the linked files', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, {
      '/browser/demo/sub/x.X68': '',
      '/browser/repo/.git/HEAD': '',
      '/browser/other/': '',
      '/folder/lab/': '',
    });
    const targets = await moveTargets({ vfs }, ['/browser/demo']);
    expect(targets.map((t) => `${'  '.repeat(t.depth)}${t.label}`)).toEqual([
      'My Programs',
      '  other',
      '  repo',
      'Folder: Lab',
      '  lab',
    ]);
  });
});

describe('Move and Copy (P3.2.4)', { timeout: 60_000 }, () => {
  it('a move within a store keeps the history (moved) and an open document follows (relocate)', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a.X68': 'A', '/browser/demo/': '' });
    const history = scriptedHistory(vfs);
    const documents = fakeDocuments(['/browser/a.X68']);
    const deps = filesTestDeps({ vfs, history, documents });
    const outcome = await transferItems(deps, ['/browser/a.X68'], '/browser/demo');
    expect(outcome.mode).toBe('move');
    expect(text(await vfs.readFile('/browser/demo/a.X68'))).toBe('A');
    expect(await vfs.stat('/browser/a.X68')).toBeNull();
    expect(history.calls).toEqual(['moved /browser/a.X68 -> /browser/demo/a.X68']);
    expect(documents.calls).toEqual(['relocate /browser/a.X68 -> /browser/demo/a.X68']);
    expect(deps.dialogs.toasts.map((t) => [t.text, t.action?.label])).toEqual([['Moved "a.X68" to demo.', 'Undo']]);
  });

  it('the real store: the history follows a moved file', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/': '' });
    const history = realHistory(vfs);
    await vfs.writeFile('/browser/a.X68', ascii('one'));
    await history.record('/browser/a.X68', ascii('one'), 'saved', 1);
    await (history as unknown as { settled(): Promise<void> }).settled();
    const deps = filesTestDeps({ vfs, history });
    await transferItems(deps, ['/browser/a.X68'], '/browser/demo');
    expect((await history.versions('/browser/demo/a.X68')).map((v) => v.reason)).toEqual(['saved']);
    expect(await history.versions('/browser/a.X68')).toEqual([]);
  });

  it('without relocate a move of an open file is refused', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/a.X68': 'A', '/browser/other/': '' });
    const deps = filesTestDeps({
      vfs,
      history: scriptedHistory(vfs),
      documents: fakeDocuments(['/browser/demo/a.X68'], { relocate: false }),
    });
    const outcome = await transferItems(deps, ['/browser/demo'], '/browser/other');
    expect(outcome.done).toBe(false);
    expect(deps.dialogs.shown).toEqual([
      { title: 'Move', text: openInEditor('a.X68', 'move'), icon: 'information', buttons: ['OK'] },
    ]);
    expect(openInEditor('prog.X68', 'move')).toBe('"prog.X68" is open in the editor. Close it first, then move it.');
    expect(await vfs.stat('/browser/demo/a.X68')).not.toBeNull();
  });

  it('a move across stores copies, and the original stays', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/demo/a.X68': 'A', '/browser/demo/b.X68': 'B' });
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    const outcome = await transferItems(deps, ['/browser/demo'], '/folder');
    expect(outcome.mode).toBe('copy');
    expect(text(await vfs.readFile('/folder/demo/b.X68'))).toBe('B');
    expect(text(await vfs.readFile('/browser/demo/b.X68'))).toBe('B');
    expect(deps.dialogs.toasts.map((t) => t.text)).toEqual(['Copied "demo" to Folder: Lab.']);
  });

  it('a folder that holds .git is not moved, copied or merged into', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, {
      '/browser/demo/.git/HEAD': '',
      '/browser/demo/a.X68': '',
      '/browser/Courses/lab3/.git/HEAD': '',
      '/browser/target/x/.git/HEAD': '',
      '/browser/x/a.X68': '',
    });
    for (const [items, dir, expected] of [
      [['/browser/demo'], '/browser/target', gitRefusal('demo', null, 'move')],
      [['/browser/demo'], '/folder', gitRefusal('demo', null, 'copy')],
      [['/browser/Courses'], '/browser/target', gitRefusal('Courses', 'Courses/lab3', 'move')],
      [['/browser/x'], '/browser/target', gitRefusal('x', null, 'move')],
    ] as const) {
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      const outcome = await transferItems(deps, items, dir);
      expect(outcome.done).toBe(false);
      expect(deps.dialogs.texts()).toEqual([expected]);
    }
    expect(gitRefusal('demo', null, 'move')).toBe(
      'The folder "demo" holds a Git repository. Move it with your own tools.',
    );
    expect(gitRefusal('demo', null, 'copy')).toBe(
      'The folder "demo" holds a Git repository. Copy it with your own tools.',
    );
    expect(gitRefusal('demo', null, 'rename')).toBe(
      'The folder "demo" holds a Git repository. Rename it with your own tools.',
    );
    expect(await vfs.stat('/browser/target/demo')).toBeNull();
  });
});

describe('Move with Replace (P3.2.4, P3.3.4)', { timeout: 60_000 }, () => {
  it('the question names one file or counts several; the second sentence follows the history', () => {
    expect(replaceOneQuestion('prog.X68', 'My Programs/demo', true)).toBe(
      '"prog.X68" already exists in My Programs/demo. Replace it? The file there now goes to the Trash. Choose No to skip this item.',
    );
    expect(replaceManyQuestion(3, 'My Programs/demo', true)).toBe(
      '3 of the items already exist in My Programs/demo. Replace them? The files there now go to the Trash. Choose No to skip them.',
    );
    expect(replaceOneQuestion('prog.X68', 'My Programs/demo', false)).toBe(
      '"prog.X68" already exists in My Programs/demo. Replace it? This cannot be undone. Choose No to skip this item.',
    );
  });

  it('Yes puts the file there into the Trash first (the real store)', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
    const history = realHistory(vfs);
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    const outcome = await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
    expect(deps.dialogs.texts()).toEqual([replaceOneQuestion('prog.X68', 'My Programs/demo', true)]);
    expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('new');
    const trash = await history.trashItems();
    expect(trash.map((i) => [i.path, i.cause])).toEqual([['/browser/demo/prog.X68', 'replaced']]);
    expect(outcome.undo).toMatchObject({
      kind: 'move',
      replaced: [{ id: trash[0]?.id, path: '/browser/demo/prog.X68' }],
    });
  });

  it('when no copy can be kept, the question of P3.3.4; its No skips the file (and its source stays)', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
    const history = scriptedHistory(vfs, { script: () => 'cannot-keep' });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes', 'No']) });
    const outcome = await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
    expect(deps.dialogs.shown[1]).toEqual({
      title: 'Move',
      text: cannotKeepQuestion('replace', 'prog.X68', false),
      icon: 'warning',
      buttons: ['Yes', 'No'],
    });
    expect(outcome.done).toBe(false);
    expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('old');
    expect(text(await vfs.readFile('/browser/prog.X68'))).toBe('new');
  });

  it('history not ready: the question says it cannot be undone, and no second question follows', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
    const history = scriptedHistory(vfs, { state: 'off' });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
    expect(deps.dialogs.texts()).toEqual([replaceOneQuestion('prog.X68', 'My Programs/demo', false)]);
    expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('new');
  });

  it('over an open document: skipped when modified (no guard), reloaded when not, closed when the own document follows', async () => {
    // Modified: the message, nothing else.
    {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
      const history = scriptedHistory(vfs);
      const documents = fakeDocuments(['/browser/demo/prog.X68'], { modified: ['/browser/demo/prog.X68'] });
      const deps = filesTestDeps({ vfs, history, documents, dialogs: scriptedDialogs([]) });
      await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
      expect(deps.dialogs.shown).toEqual([
        { title: 'Move', text: unsavedReplace('prog.X68'), icon: 'information', buttons: ['OK'] },
      ]);
      expect(unsavedReplace('prog.X68')).toBe(
        '"prog.X68" has changes that are not saved. Save it or close it first, then replace it.',
      );
      expect(history.calls).toEqual([]);
      expect(text(await vfs.readFile('/browser/demo/prog.X68'))).toBe('old');
    }
    // Not modified: reloaded after the write.
    {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
      const documents = fakeDocuments(['/browser/demo/prog.X68']);
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), documents, dialogs: scriptedDialogs(['Yes']) });
      await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
      expect(documents.calls).toEqual(['reload /browser/demo/prog.X68']);
    }
    // The moved file is open too: its document follows, and the target's is closed instead.
    {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/prog.X68': 'new', '/browser/demo/prog.X68': 'old' });
      const documents = fakeDocuments(['/browser/demo/prog.X68', '/browser/prog.X68']);
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), documents, dialogs: scriptedDialogs(['Yes']) });
      await transferItems(deps, ['/browser/prog.X68'], '/browser/demo');
      expect(documents.calls).toEqual([
        'close /browser/demo/prog.X68',
        'relocate /browser/prog.X68 -> /browser/demo/prog.X68',
      ]);
      expect(documents.docs.map((d) => d.path)).toEqual(['/browser/demo/prog.X68']);
    }
  });

  it('Move of demo/ (a, b) into a place holding demo/ (b, c): c stays, b goes to the Trash on Yes, a is added', async () => {
    for (const answer of ['Yes', 'No'] as const) {
      const { vfs } = memoryStores();
      await seed(vfs, {
        '/browser/demo/a.X68': 'a1',
        '/browser/demo/b.X68': 'b1',
        '/browser/to/demo/b.X68': 'b2',
        '/browser/to/demo/c.X68': 'c2',
      });
      const real = realHistory(vfs);
      for (const [path, content] of [
        ['/browser/demo/b.X68', 'b1'],
        ['/browser/to/demo/b.X68', 'b2'],
        ['/browser/demo/a.X68', 'a1'],
      ] as const)
        await real.record(path, ascii(content), 'saved', 1);
      await (real as unknown as { settled(): Promise<void> }).settled();
      const moved: string[] = [];
      const history: HistoryService = Object.create(real, {
        moved: {
          value: async (from: string, to: string) => {
            moved.push(`${from} -> ${to}`);
            return real.moved(from, to);
          },
        },
      });
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs([answer]) });
      await transferItems(deps, ['/browser/demo'], '/browser/to');
      expect(deps.dialogs.texts()).toEqual([replaceOneQuestion('demo/b.X68', 'My Programs/to', true)]);
      expect(text(await vfs.readFile('/browser/to/demo/c.X68'))).toBe('c2');
      expect(text(await vfs.readFile('/browser/to/demo/a.X68'))).toBe('a1');
      if (answer === 'Yes') {
        expect(text(await vfs.readFile('/browser/to/demo/b.X68'))).toBe('b1');
        expect((await real.trashItems()).map((i) => [i.path, i.cause])).toEqual([
          ['/browser/to/demo/b.X68', 'replaced'],
        ]);
        expect(await vfs.stat('/browser/demo')).toBeNull();
      } else {
        // No: b is skipped; `moved` only for a; both b files keep their own histories.
        expect(moved).toEqual(['/browser/demo/a.X68 -> /browser/to/demo/a.X68']);
        expect(text(await vfs.readFile('/browser/to/demo/b.X68'))).toBe('b2');
        expect(text(await vfs.readFile('/browser/demo/b.X68'))).toBe('b1');
        expect((await real.versions('/browser/demo/b.X68')).length).toBe(1);
        expect((await real.versions('/browser/to/demo/b.X68')).length).toBe(1);
        expect(await real.trashItems()).toEqual([]);
      }
    }
  });

  it('a Replace whose write fails leaves the target with its versions and no Replaced item', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/folder/prog.X68': 'new', '/browser/prog.X68': 'old' });
    const real = realHistory(vfs);
    await real.record('/browser/prog.X68', ascii('old'), 'saved', 1);
    await (real as unknown as { settled(): Promise<void> }).settled();
    const failing: Vfs = Object.create(vfs, {
      writeFile: {
        value: async (path: string, data: Uint8Array) => {
          if (path === '/browser/prog.X68') throw new Error('No room for it.');
          return vfs.writeFile(path, data);
        },
      },
    });
    const deps = filesTestDeps({ vfs: failing, history: real, dialogs: scriptedDialogs(['Yes']) });
    await transferItems(deps, ['/folder/prog.X68'], '/browser');
    expect(deps.dialogs.texts()[1]).toBe('No room for it.');
    expect(text(await vfs.readFile('/browser/prog.X68'))).toBe('old');
    expect(await real.trashItems()).toEqual([]);
    expect((await real.versions('/browser/prog.X68')).length).toBeGreaterThan(0);
  });
});

describe('Move and Copy never lose a selected file (verify round 1)', { timeout: 60_000 }, () => {
  it('two selected files of the same name: the second stays where it is (probe P11)', async () => {
    for (const ready of [true, false]) {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/a/p.X68': 'FIRST', '/browser/x/P.x68': 'SECOND', '/browser/b/': '' });
      const history = ready ? realHistory(vfs) : scriptedHistory(vfs, { state: 'off' });
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
      const outcome = await transferItems(deps, ['/browser/a/p.X68', '/browser/x/P.x68'], '/browser/b');
      expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('FIRST');
      expect(text(await vfs.readFile('/browser/x/P.x68'))).toBe('SECOND');
      expect(await vfs.stat('/browser/a/p.X68')).toBeNull();
      expect(deps.dialogs.shown).toEqual([
        { title: 'Move', text: '"P.x68" already exists.', icon: 'error', buttons: ['OK'] },
      ]);
      expect(outcome.items).toEqual(['/browser/a/p.X68']);
      expect(deps.dialogs.toasts.map((t) => t.text)).toEqual(['Moved "p.X68" to b.']);
    }
  });

  it("two selected folders of the same name: the second is not merged into the first one's copy", async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a/d/p.X68': 'FIRST', '/browser/x/d/p.X68': 'SECOND', '/browser/t/': '' });
    const deps = filesTestDeps({ vfs, history: realHistory(vfs) });
    await transferItems(deps, ['/browser/a/d', '/browser/x/d'], '/folder');
    expect(text(await vfs.readFile('/folder/d/p.X68'))).toBe('FIRST');
    expect(text(await vfs.readFile('/browser/x/d/p.X68'))).toBe('SECOND');
    expect(text(await vfs.readFile('/browser/a/d/p.X68'))).toBe('FIRST');
  });

  it('an item already in the target folder stays, the others go (probes P1, P1b)', async () => {
    for (const state of ['ready', 'off'] as const) {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/a/p.X68': 'P', '/browser/b/r.X68': 'R' });
      const history = scriptedHistory(vfs, { state });
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
      const outcome = await transferItems(deps, ['/browser/a/p.X68', '/browser/b/r.X68'], '/browser/a');
      expect(deps.dialogs.shown).toEqual([]); // no Replace question about the file itself
      expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('P');
      expect(text(await vfs.readFile('/browser/a/r.X68'))).toBe('R');
      expect(await vfs.stat('/browser/b/r.X68')).toBeNull();
      expect(outcome.items).toEqual(['/browser/b/r.X68']);
      expect(history.calls.filter((c) => c.startsWith('guard'))).toEqual([]);
    }
    expect(refusedTarget(['/browser/a/p.X68', '/browser/b/r.X68'], '/browser/a')).toBe(false);
    expect(refusedTarget(['/browser/a/p.X68', '/browser/a/q.X68'], '/browser/a')).toBe(true);
  });

  it('a folder selected with a file inside it carries that file once (probes P3, P4)', async () => {
    for (const target of ['/browser/t', '/folder']) {
      const { vfs } = memoryStores();
      await seed(vfs, { '/browser/a/p.X68': 'P', '/browser/t/': '' });
      const deps = filesTestDeps({ vfs, history: realHistory(vfs) });
      const outcome = await transferItems(deps, ['/browser/a', '/browser/a/p.X68'], target);
      expect(deps.dialogs.shown).toEqual([]);
      expect(text(await vfs.readFile(`${target}/a/p.X68`))).toBe('P');
      expect(await vfs.stat(`${target}/p.X68`)).toBeNull();
      expect(outcome.items).toEqual(['/browser/a']);
    }
  });

  it('a file that appears at the target after the plan is never written over without guard', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, { '/browser/a/p.X68': 'P', '/browser/b/': '' });
    const sneaky: Vfs = Object.create(vfs, {
      readFile: {
        value: async (path: string) => {
          const data = await vfs.readFile(path);
          if (path === '/browser/a/p.X68') await vfs.writeFile('/browser/b/p.X68', ascii('APPEARED'));
          return data;
        },
      },
    });
    const deps = filesTestDeps({ vfs: sneaky, history: scriptedHistory(vfs) });
    const outcome = await transferItems(deps, ['/browser/a/p.X68'], '/browser/b');
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('APPEARED');
    expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('P');
    expect(deps.dialogs.texts()).toEqual(['"p.X68" already exists.']);
    expect(outcome.done).toBe(false);
  });
});
