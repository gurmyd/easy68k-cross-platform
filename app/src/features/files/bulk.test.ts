// Delete and Export of a multiple selection (ARCHITECTURE-PLUS P3.2.2, P3.2.3) under Node: every
// question and message text exactly, for 1, 2, 3, 4 and 10 items, files and folders, in each store;
// the order and the stops of P3.3.4's guard with a scripted history; and the real store
// (createMemoryHistoryService) for what the Trash keeps and Undo brings back.

import { describe, expect, it } from 'vitest';
import type { HistoryService, Vfs } from '../../contracts';
import { cannotKeepQuestion } from '../../core/history/texts';
import { createMemoryHistoryService } from '../../fs/history-memory';
import { MemoryBackend } from '../../fs/memory-backend';
import { readZip } from '../../fs/zip';
import { deleteItems, exportCaption, exportItems, uniqueName } from './bulk';
import {
  CANNOT_BE_UNDONE,
  changedWhileDeleting,
  deleteAndRemoveQuestion,
  deleteQuestion,
  deletedFromFolder,
  gitRefusal,
  removeLinkedQuestion,
  restoreFromTrash,
} from './texts';
import { ascii, filesTestDeps, memoryStores, scriptedDialogs, scriptedHistory, text } from './testing';

const never = { setTimer: () => () => {}, onFrame: () => () => {} };
const clock = { now: () => 0, wallTime: () => new Date(Date.UTC(2026, 10, 22, 12, 0, 0)) };

function realHistory(vfs: Vfs): HistoryService & { settled(): Promise<void> } {
  return createMemoryHistoryService({ vfs, clock, scheduler: never }) as HistoryService & { settled(): Promise<void> };
}

async function seed(vfs: Vfs, paths: readonly string[]) {
  for (const path of paths) {
    if (path.endsWith('/')) await vfs.mkdirp(path.slice(0, -1));
    else await vfs.writeFile(path, ascii(`* ${path}\r\n`));
  }
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}.X68`);

describe('Delete: the question (P3.2.2)', { timeout: 60_000 }, () => {
  it('one file, one folder, and several (1, 2, 3, 4 and 10 items), in My Programs', async () => {
    const cases: [string[], string][] = [
      [['/browser/prog.X68'], `Delete "prog.X68"? ${restoreFromTrash(true)}`],
      [
        ['/browser/demo'],
        `Delete the folder "demo" and everything in it (14 files)? You can restore it from the Trash.`,
      ],
      [
        ['/browser/f1.X68', '/browser/f2.X68'],
        'Delete 2 items: "f1.X68" and "f2.X68"? You can restore them from the Trash.',
      ],
      [
        ['/browser/demo', '/browser/f1.X68', '/browser/f2.X68'],
        'Delete 3 items: the folder "demo" (14 files), "f1.X68" and "f2.X68"? You can restore them from the Trash.',
      ],
      [
        ['/browser/f1.X68', '/browser/f2.X68', '/browser/demo', '/browser/f3.X68'],
        'Delete 4 items: "f1.X68", "f2.X68", the folder "demo" (14 files) and 1 more? You can restore them from the Trash.',
      ],
      [
        [...names(10).map((n) => `/browser/${n}`)],
        'Delete 10 items: "f1.X68", "f2.X68", "f3.X68" and 7 more? You can restore them from the Trash.',
      ],
    ];
    for (const [paths, expected] of cases) {
      const { vfs } = memoryStores();
      await seed(vfs, ['/browser/prog.X68', ...names(10).map((n) => `/browser/${n}`)]);
      await seed(
        vfs,
        Array.from({ length: 14 }, (_, i) => `/browser/demo/s${i}.X68`),
      );
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), dialogs: scriptedDialogs(['No']) });
      const outcome = await deleteItems(deps, paths);
      expect(deps.dialogs.texts()).toEqual([expected]);
      expect(deps.dialogs.shown[0]).toMatchObject({ title: 'Delete', icon: 'confirmation', buttons: ['Yes', 'No'] });
      expect(outcome.confirmed).toBe(false);
      for (const path of paths) expect(await vfs.stat(path)).not.toBeNull();
    }
  });

  it('a folder selected with the files inside it (Ctrl+A) counts them once, and one Trash item holds them', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/d/x.X68', '/browser/d/y.X68', '/browser/a.X68', '/browser/b.X68']);
    const history = realHistory(vfs);
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    const outcome = await deleteItems(deps, [
      '/browser',
      '/browser/d',
      '/browser/d/x.X68',
      '/browser/d/y.X68',
      '/browser/a.X68',
      '/browser/b.X68',
    ]);
    expect(deps.dialogs.texts()).toEqual([
      'Delete 3 items: the folder "d" (2 files), "a.X68" and "b.X68"? You can restore them from the Trash.',
    ]);
    expect(outcome.deleted).toEqual(['/browser/d', '/browser/a.X68', '/browser/b.X68']);
    expect((await history.trashItems()).map((i) => i.path).sort()).toEqual([
      '/browser/a.X68',
      '/browser/b.X68',
      '/browser/d',
    ]);
  });

  it('a folder of one file says "(1 file)"', () => {
    expect(deleteQuestion([{ name: 'demo', isFolder: true, files: 1 }])).toBe(
      'Delete the folder "demo" and everything in it (1 file)?',
    );
  });

  it('in an opened folder: deleted from the folder "Lab" on this computer, with a copy in the Trash', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/folder/prog.X68', '/folder/b.X68']);
    for (const [paths, one] of [
      [['/folder/prog.X68'], true],
      [['/folder/prog.X68', '/folder/b.X68'], false],
    ] as const) {
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), dialogs: scriptedDialogs(['No']) });
      await deleteItems(deps, paths);
      expect(deps.dialogs.texts()[0]).toContain(deletedFromFolder(one, 'Lab'));
    }
    expect(deletedFromFolder(true, 'Lab')).toBe(
      'It is deleted from the folder "Lab" on this computer. A copy stays in the Trash of EASy68K for up to 30 days.',
    );
    expect(deletedFromFolder(false, 'Lab')).toBe(
      'They are deleted from the folder "Lab" on this computer. A copy stays in the Trash of EASy68K for up to 30 days.',
    );
  });

  for (const state of ['off', 'tight', 'unavailable'] as const) {
    it(`history ${state}: the question ends with "This cannot be undone." and no second question follows`, async () => {
      const { vfs } = memoryStores();
      await seed(vfs, ['/browser/a.X68', '/browser/b.X68']);
      const history = scriptedHistory(vfs, { state });
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
      const outcome = await deleteItems(deps, ['/browser/a.X68', '/browser/b.X68']);
      expect(deps.dialogs.texts()).toEqual([`Delete 2 items: "a.X68" and "b.X68"? ${CANNOT_BE_UNDONE}`]);
      expect(outcome.deleted).toEqual(['/browser/a.X68', '/browser/b.X68']);
      // Deleted without the Trash: no Undo, and the toast says nothing of "for good".
      expect(deps.dialogs.toasts).toEqual([{ text: 'Deleted 2 items.' }]);
    });
  }

  it('without a history at all, the same sentence, and the items are removed as today', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/demo/a.X68']);
    const deps = filesTestDeps({ vfs, dialogs: scriptedDialogs(['Yes']) });
    await deleteItems(deps, ['/browser/demo']);
    expect(deps.dialogs.texts()).toEqual([
      `Delete the folder "demo" and everything in it (1 file)? ${CANNOT_BE_UNDONE}`,
    ]);
    expect(await vfs.stat('/browser/demo')).toBeNull();
    expect(deps.dialogs.toasts).toEqual([{ text: 'Deleted "demo".' }]);
  });
});

describe('Delete: one guard per item, in the tree order (P3.2.2, P3.3.4)', { timeout: 60_000 }, () => {
  const five = ['/browser/i1.X68', '/browser/i2.X68', '/browser/i3.X68', '/browser/i4.X68', '/browser/i5.X68'];

  it('when no copy of item 3 of 5 can be kept, the question names it; No stops with items 3 to 5 selected', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, five);
    const history = scriptedHistory(vfs, { script: (path) => (path.endsWith('i3.X68') ? 'cannot-keep' : 'kept') });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes', 'No']) });
    const outcome = await deleteItems(deps, five);
    expect(deps.dialogs.shown[1]).toEqual({
      title: 'Delete',
      text: cannotKeepQuestion('delete', 'i3.X68', false),
      icon: 'warning',
      buttons: ['Yes', 'No'],
    });
    expect(deps.dialogs.texts()[1]).toBe(
      'EASy68K cannot keep a copy of "i3.X68" in the Trash. Delete it anyway? This cannot be undone.',
    );
    expect(outcome.deleted).toEqual(five.slice(0, 2));
    expect(outcome.remaining).toEqual(five.slice(2));
    for (const path of five.slice(2)) expect(await vfs.stat(path)).not.toBeNull();
    // Items 1 and 2 are in the Trash: the toast offers Undo.
    expect(deps.dialogs.toasts.map((t) => [t.text, t.action?.label])).toEqual([['Deleted 2 items.', 'Undo']]);
  });

  it('Yes deletes it for good and goes on; the toast says so, without Undo', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, five);
    const history = scriptedHistory(vfs, { script: (path) => (path.endsWith('i3.X68') ? 'cannot-keep' : 'kept') });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes', 'Yes']) });
    const outcome = await deleteItems(deps, five);
    expect(outcome.deleted).toEqual(five);
    expect(outcome.remaining).toEqual([]);
    expect(deps.dialogs.toasts).toEqual([{ text: 'Deleted 5 items. 1 of them was deleted for good.' }]);
    expect(history.calls.filter((c) => c.startsWith('guard'))).toEqual(five.map((p) => `guard delete ${p}`));
  });

  it('one item deleted for good: Deleted "prog.X68" for good.', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/prog.X68']);
    const deps = filesTestDeps({
      vfs,
      history: scriptedHistory(vfs, { script: () => 'cannot-keep' }),
      dialogs: scriptedDialogs(['Yes', 'Yes']),
    });
    await deleteItems(deps, ['/browser/prog.X68']);
    expect(deps.dialogs.toasts).toEqual([{ text: 'Deleted "prog.X68" for good.' }]);
  });

  it('a removal failing at item 3 of 5 shows the message and leaves items 3 to 5 selected', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, five);
    const history = scriptedHistory(vfs, { script: (path) => (path.endsWith('i3.X68') ? 'fail-act' : 'kept') });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    const outcome = await deleteItems(deps, five);
    expect(deps.dialogs.shown[1]).toEqual({
      title: 'Delete',
      text: '"i3.X68" could not be removed.',
      icon: 'error',
      buttons: ['OK'],
    });
    expect(outcome.remaining).toEqual(five.slice(2));
    expect(outcome.deleted).toEqual(five.slice(0, 2));
  });
});

describe('Delete with the real store (createMemoryHistoryService)', { timeout: 60_000 }, () => {
  it('5 selected items make one Trash item each, and Undo brings all 5 back', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, [
      '/browser/a.X68',
      '/browser/b.X68',
      '/browser/demo/x.X68',
      '/browser/demo/y.X68',
      '/folder/c.X68',
    ]);
    await seed(vfs, ['/browser/z.X68']);
    const history = realHistory(vfs);
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    const items = ['/browser/demo', '/browser/a.X68', '/browser/b.X68', '/browser/z.X68', '/folder/c.X68'];
    const outcome = await deleteItems(deps, items);
    expect(outcome.deleted).toEqual(items);
    const trash = await history.trashItems();
    expect(trash.map((i) => i.path).sort()).toEqual([...items].sort());
    expect(deps.dialogs.toasts.map((t) => [t.text, t.action?.label])).toEqual([['Deleted 5 items.', 'Undo']]);
    deps.dialogs.toasts[0]?.action?.run();
    for (let i = 0; i < 100 && deps.undone.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(deps.undone[0]?.length).toBe(6); // the folder's two files and four files
    for (const path of ['/browser/a.X68', '/browser/demo/x.X68', '/browser/demo/y.X68', '/folder/c.X68'])
      expect(text(await vfs.readFile(path))).toBe(`* ${path}\r\n`);
    expect(await history.trashItems()).toEqual([]);
  });

  it('a folder with an empty subfolder comes back with it after Delete and Undo', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/demo/a.X68', '/browser/demo/empty/']);
    const history = realHistory(vfs);
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    await deleteItems(deps, ['/browser/demo']);
    expect(await vfs.stat('/browser/demo')).toBeNull();
    await deps.undo.run(deps.stack.peek() as never, false);
    expect((await vfs.stat('/browser/demo/empty'))?.kind).toBe('dir');
    expect(text(await vfs.readFile('/browser/demo/a.X68'))).toBe('* /browser/demo/a.X68\r\n');
  });

  it('a folder delete during which another window saves into the folder keeps that file and says so', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/demo/a.X68', '/browser/demo/b.X68']);
    const real = realHistory(vfs);
    const guard: HistoryService['guard'] = (path, how, act, confirm) =>
      real.guard(
        path,
        how,
        async (seen) => {
          await vfs.writeFile('/browser/demo/new.X68', ascii('saved meanwhile'));
          await act(seen);
        },
        confirm,
      );
    const history: HistoryService = Object.create(real, { guard: { value: guard } });
    const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
    await deleteItems(deps, ['/browser/demo']);
    expect(text(await vfs.readFile('/browser/demo/new.X68'))).toBe('saved meanwhile');
    expect(await vfs.stat('/browser/demo/a.X68')).toBeNull();
    expect(deps.dialogs.toasts.map((t) => t.text)).toEqual([`Deleted "demo". ${changedWhileDeleting(1)}`]);
    expect(changedWhileDeleting(1)).toBe('1 file changed while it was being deleted and was kept.');
    expect(changedWhileDeleting(3)).toBe('3 files changed while they were being deleted and were kept.');
  });

  it('a removal that fails after guard kept leaves the versions under its place and no Trash item', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/prog.X68']);
    const history = realHistory(vfs);
    const failing: Vfs = Object.create(vfs, {
      remove: {
        value: async () => {
          throw new Error('The disk refused it.');
        },
      },
    });
    const deps = filesTestDeps({ vfs: failing, history, dialogs: scriptedDialogs(['Yes']) });
    const outcome = await deleteItems(deps, ['/browser/prog.X68']);
    expect(outcome.deleted).toEqual([]);
    expect(deps.dialogs.texts()[1]).toBe('The disk refused it.');
    expect(await history.trashItems()).toEqual([]);
    expect((await history.versions('/browser/prog.X68')).map((v) => v.reason)).toEqual(['before-delete']);
    expect(deps.dialogs.toasts).toEqual([]);
  });
});

describe('Delete: Git repositories and linked files (P3.2.2)', { timeout: 60_000 }, () => {
  it('a folder that holds .git itself, or deeper, is not deleted, and nothing else is', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, ['/browser/demo/.git/HEAD', '/browser/Courses/lab3/.GIT/config', '/browser/a.X68']);
    for (const [paths, text0] of [
      [['/browser/a.X68', '/browser/demo'], gitRefusal('demo', null, 'delete')],
      [['/browser/Courses', '/browser/demo'], gitRefusal('Courses', 'Courses/lab3', 'delete')],
    ] as const) {
      const history = scriptedHistory(vfs);
      const deps = filesTestDeps({ vfs, history, dialogs: scriptedDialogs(['Yes']) });
      const outcome = await deleteItems(deps, paths);
      expect(deps.dialogs.shown).toEqual([{ title: 'Delete', text: text0, icon: 'information', buttons: ['OK'] }]);
      expect(outcome.deleted).toEqual([]);
      expect(history.calls).toEqual([]);
    }
    expect(gitRefusal('Courses', 'Courses/lab3', 'delete')).toBe(
      'The folder "Courses" holds a Git repository ("Courses/lab3"). Nothing was deleted. Delete it with your own tools if you are sure.',
    );
    expect(gitRefusal('demo', null, 'delete')).toBe(
      'The folder "demo" holds a Git repository. Nothing was deleted. Delete it with your own tools if you are sure.',
    );
    expect(await vfs.stat('/browser/a.X68')).not.toBeNull();
  });

  it('linked files are removed from the list, not deleted; a mixed selection asks one question', async () => {
    const { vfs } = memoryStores();
    vfs.mount(new MemoryBackend({ mount: 'linked', kind: 'browser', label: 'Linked files' }));
    await seed(vfs, [
      '/linked/aa/lab1.X68',
      '/linked/bb/lab2.X68',
      '/linked/cc/lab3.X68',
      '/browser/a.X68',
      '/browser/b.X68',
    ]);
    const one = filesTestDeps({ vfs, history: scriptedHistory(vfs), dialogs: scriptedDialogs(['Yes']) });
    await deleteItems(one, ['/linked/aa/lab1.X68']);
    expect(one.dialogs.shown[0]).toMatchObject({
      title: 'Remove from List',
      text: 'Remove "lab1.X68" from the Files panel? The file on this computer is not changed.',
    });
    expect(await vfs.stat('/linked/aa')).toBeNull();
    expect(removeLinkedQuestion(['a', 'b', 'c'])).toBe(
      'Remove 3 files from the Files panel? The files on this computer are not changed.',
    );
    const mixed = filesTestDeps({ vfs, history: scriptedHistory(vfs), dialogs: scriptedDialogs(['No']) });
    await deleteItems(mixed, ['/browser/a.X68', '/browser/b.X68', '/linked/bb/lab2.X68']);
    expect(mixed.dialogs.texts()).toEqual([`${deleteAndRemoveQuestion(2, 1)} You can restore them from the Trash.`]);
    expect(deleteAndRemoveQuestion(2, 1)).toBe('Delete 2 items and remove 1 linked file from the Files panel?');
  });
});

describe('Export (P3.2.3)', { timeout: 60_000 }, () => {
  it('the caption says what will be exported, for each selection', () => {
    const { vfs } = memoryStores();
    expect(exportCaption(vfs, [])).toBe('Export all of My Programs as My Programs.zip');
    expect(exportCaption(vfs, [{ path: '/folder', kind: 'root', label: 'Folder: Lab' }])).toBe(
      'Export all of Folder: Lab as Folder: Lab.zip',
    );
    expect(exportCaption(vfs, [{ path: '/browser/prog.X68', kind: 'file', label: 'prog.X68' }])).toBe(
      'Export "prog.X68"',
    );
    expect(exportCaption(vfs, [{ path: '/browser/demo', kind: 'dir', label: 'demo' }])).toBe(
      'Export the folder "demo" as demo.zip',
    );
    const five = Array.from({ length: 5 }, (_, i) => ({ path: `/browser/f${i}`, kind: 'file' as const, label: '' }));
    expect(exportCaption(vfs, five)).toBe('Export 5 items as EASy68K export.zip');
  });

  it('several items become one .zip, a second name gets " (2)" before its extension, stores mixed, .git left out', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, [
      '/browser/prog.X68',
      '/folder/prog.X68',
      '/browser/sub/prog.X68',
      '/browser/demo/a.X68',
      '/browser/demo/.git/HEAD',
      '/folder/demo/b.X68',
    ]);
    const file = await exportItems(
      vfs,
      ['/browser/prog.X68', '/folder/prog.X68', '/browser/sub/prog.X68', '/browser/demo', '/folder/demo'],
      0,
    );
    expect(file.name).toBe('EASy68K export.zip');
    expect(file.files).toBe(5);
    const { entries } = await readZip(file.bytes);
    expect(entries.map((e) => e.path)).toEqual([
      'prog.X68',
      'prog (2).X68',
      'prog (3).X68',
      'demo/',
      'demo/a.X68',
      'demo (2)/',
      'demo (2)/b.X68',
    ]);
    expect(uniqueName('Makefile', false, new Set(['makefile']))).toBe('Makefile (2)');
  });

  it('one folder exports as today, without its .git folder', async () => {
    const { vfs } = memoryStores();
    await seed(vfs, [
      '/browser/demo/a.X68',
      '/browser/demo/.git/HEAD',
      '/browser/demo/sub/.Git/x',
      '/browser/demo/.git2',
    ]);
    const file = await exportItems(vfs, ['/browser/demo'], 0);
    expect(file.name).toBe('demo.zip');
    const { entries } = await readZip(file.bytes);
    expect(entries.map((e) => e.path)).toEqual(['demo/', 'demo/sub/', 'demo/.git2', 'demo/a.X68']);
  });
});
