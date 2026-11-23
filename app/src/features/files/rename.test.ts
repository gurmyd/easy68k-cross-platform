// Rename and Undo Rename never take a change away from the current file (ARCHITECTURE-PLUS P3.2.4,
// P3.3.1 property 1; errata N5 entry 18). FS1's renameEntry copies a folder, then removes the old
// one whole: a save from another window (or a program's write) that lands during the copy was
// removed with it, and the renamed folder held the bytes from before. renameChecked (rename.ts)
// makes the copy itself and removes the old name only while every file is still the one copied.

import { describe, expect, it } from 'vitest';
import type { DialogInstance, MessageBoxRequest, Vfs, VPath } from '../../contracts';
import { createTestApplication, type TestApplication } from '../../state/testing';
import type { UndoEntry } from './bulk';
import { renamePath } from './actions';
import { feature, createFileDialogs } from './index';
import { transferItems } from './move';
import { renameChecked } from './rename';
import { changedAfterRenaming, changedWhileRenaming, gitRefusal, goneAfterRenaming } from './texts';
import { ascii, filesTestDeps, memoryStores, scriptedHistory, text } from './testing';

/** After the first write of `when`, `then` runs once (the other window's save, at that moment). */
function afterWriteOf(vfs: Vfs, when: VPath, then: () => Promise<void>): void {
  const writeFile = vfs.writeFile.bind(vfs);
  let done = false;
  vfs.writeFile = async (path, data) => {
    await writeFile(path, data);
    if (!done && path === when) {
      done = true;
      await then();
    }
  };
}

/**
 * Before the `nth` stat of `when`, `then` runs once. renameChecked looks at each source three times:
 * when it copies it, when it checks every file before removing anything, and just before it removes
 * it; the third is the moment after the last check.
 */
function beforeStat(vfs: Vfs, when: VPath, nth: number, then: () => Promise<void>): void {
  const stat = vfs.stat.bind(vfs);
  let count = 0;
  vfs.stat = async (path) => {
    if (path === when && ++count === nth) await then();
    return stat(path);
  };
}

/** Every path below `root` with its bytes ('/' for a folder). */
async function tree(vfs: Vfs, root: VPath): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: VPath) => {
    for (const entry of await vfs.list(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.kind === 'dir') {
        out[path] = '/';
        await walk(path);
      } else out[path] = text(await vfs.readFile(path));
    }
  };
  await walk(root);
  return out;
}

async function lab(vfs: Vfs): Promise<void> {
  await vfs.writeFile('/browser/lab/prog.X68', ascii('V1'));
  await vfs.writeFile('/browser/lab/sub/inc.X68', ascii('INC'));
  await vfs.mkdirp('/browser/lab/empty');
  await vfs.writeFile('/browser/other.X68', ascii('O'));
}

describe('renameChecked', { timeout: 60_000 }, () => {
  it('renames a file and a folder, and changes letter case through a temporary name that is gone after', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    expect(await renameChecked(vfs, '/browser/other.X68', 'two.X68')).toBe('/browser/two.X68');
    expect(await renameChecked(vfs, '/browser/lab', 'work')).toBe('/browser/work');
    expect(await tree(vfs, '/browser')).toEqual({
      '/browser/work': '/',
      '/browser/work/prog.X68': 'V1',
      '/browser/work/sub': '/',
      '/browser/work/sub/inc.X68': 'INC',
      '/browser/work/empty': '/',
      '/browser/two.X68': 'O',
    });
    expect(await renameChecked(vfs, '/browser/work', 'Work')).toBe('/browser/Work');
    expect(await renameChecked(vfs, '/browser/two.X68', 'TWO.X68')).toBe('/browser/TWO.X68');
    expect(Object.keys(await tree(vfs, '/browser')).sort()).toEqual([
      '/browser/TWO.X68',
      '/browser/Work',
      '/browser/Work/empty',
      '/browser/Work/prog.X68',
      '/browser/Work/sub',
      '/browser/Work/sub/inc.X68',
    ]);
  });

  it('a folder: a file saved during the copy keeps its change, and nothing is renamed', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    afterWriteOf(vfs, '/browser/work/prog.X68', () => vfs.writeFile('/browser/lab/prog.X68', ascii('V2 SAVED')));
    await expect(renameChecked(vfs, '/browser/lab', 'work')).rejects.toThrow(
      changedWhileRenaming('lab', 'lab/prog.X68', true),
    );
    expect(await tree(vfs, '/browser')).toEqual({
      '/browser/lab': '/',
      '/browser/lab/prog.X68': 'V2 SAVED',
      '/browser/lab/sub': '/',
      '/browser/lab/sub/inc.X68': 'INC',
      '/browser/lab/empty': '/',
      '/browser/other.X68': 'O',
    });
    expect(changedWhileRenaming('lab', 'lab/prog.X68', true)).toBe(
      'The folder "lab" was not renamed: "lab/prog.X68" changed while it was being renamed. Rename it again to use the new name.',
    );
  });

  it('a folder: a file that appears during the copy stays, and nothing is renamed', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    afterWriteOf(vfs, '/browser/work/sub/inc.X68', () => vfs.writeFile('/browser/lab/new.X68', ascii('NEW')));
    await expect(renameChecked(vfs, '/browser/lab', 'work')).rejects.toThrow(
      changedWhileRenaming('lab', 'lab/new.X68', true),
    );
    expect(text(await vfs.readFile('/browser/lab/new.X68'))).toBe('NEW');
    expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('V1');
    expect(await vfs.stat('/browser/work')).toBeNull();
  });

  it('a change of letter case of a folder: a change during the copy leaves no temporary name behind', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const writeFile = vfs.writeFile.bind(vfs);
    let done = false;
    vfs.writeFile = async (path, data) => {
      await writeFile(path, data);
      if (!done && /\/LAB\.renaming-\d+\/prog\.X68$/.test(path)) {
        done = true;
        await writeFile('/browser/lab/prog.X68', ascii('V2'));
      }
    };
    await expect(renameChecked(vfs, '/browser/lab', 'LAB')).rejects.toThrow(
      changedWhileRenaming('lab', 'lab/prog.X68', true),
    );
    expect(done).toBe(true);
    expect((await vfs.list('/browser')).map((e) => e.name).sort()).toEqual(['lab', 'other.X68']);
    expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('V2');
  });

  it('a file: a save during the copy keeps the old name and the change', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    afterWriteOf(vfs, '/browser/lab/main.X68', () => vfs.writeFile('/browser/lab/prog.X68', ascii('V2')));
    await expect(renameChecked(vfs, '/browser/lab/prog.X68', 'main.X68')).rejects.toThrow(
      changedWhileRenaming('prog.X68', 'lab/prog.X68', false),
    );
    expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('V2');
    expect(await vfs.stat('/browser/lab/main.X68')).toBeNull();
    expect(changedWhileRenaming('prog.X68', 'lab/prog.X68', false)).toBe(
      '"prog.X68" was not renamed: it changed while it was being renamed. Rename it again to use the new name.',
    );
  });

  it('a change in the moment after the last check: that file stays under the old name, the rest is renamed', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const kept: [readonly VPath[], VPath][] = [];
    beforeStat(vfs, '/browser/lab/prog.X68', 3, () => vfs.writeFile('/browser/lab/prog.X68', ascii('V2 LATE')));
    const renamed = await renameChecked(vfs, '/browser/lab', 'work', { kept: (files, at) => kept.push([files, at]) });
    expect(renamed).toBe('/browser/work');
    expect(kept).toEqual([[['/browser/lab/prog.X68'], '/browser/work']]);
    expect(await tree(vfs, '/browser')).toEqual({
      '/browser/lab': '/',
      '/browser/lab/prog.X68': 'V2 LATE',
      '/browser/work': '/',
      '/browser/work/prog.X68': 'V1',
      '/browser/work/sub': '/',
      '/browser/work/sub/inc.X68': 'INC',
      '/browser/work/empty': '/',
      '/browser/other.X68': 'O',
    });
  });

  it('a write that fails half way takes the copies back and leaves the folder as it was', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const writeFile = vfs.writeFile.bind(vfs);
    const written: string[] = [];
    vfs.writeFile = async (path, data) => {
      // The tree's order: folders first, so sub/inc.X68 is copied before prog.X68, the last file.
      if (path === '/browser/work/prog.X68') throw new Error('The browser storage for this site is full.');
      written.push(path);
      return writeFile(path, data);
    };
    await expect(renameChecked(vfs, '/browser/lab', 'work')).rejects.toThrow('full');
    expect(written).toEqual(['/browser/work/sub/inc.X68']);
    expect(await vfs.stat('/browser/work')).toBeNull();
    expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('V1');
    expect(text(await vfs.readFile('/browser/lab/sub/inc.X68'))).toBe('INC');
  });

  it('a folder that holds .git is not renamed, also when Undo Rename meets one that appeared since', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/lab/repo/.git/HEAD', ascii('ref'));
    await expect(renameChecked(vfs, '/browser/lab', 'work')).rejects.toThrow(gitRefusal('lab', 'lab/repo', 'rename'));
    expect(await vfs.stat('/browser/work')).toBeNull();
    expect(text(await vfs.readFile('/browser/lab/repo/.git/HEAD'))).toBe('ref');
  });
});

/** Another window's move of `from` to `to` (a copy, then the source removed), as move.ts makes it. */
async function movedElsewhere(vfs: Vfs, from: VPath, to: VPath): Promise<void> {
  const stat = await vfs.stat(from);
  if (stat?.kind === 'dir') {
    for (const entry of await vfs.list(from)) {
      await movedElsewhere(vfs, `${from}/${entry.name}` as VPath, `${to}/${entry.name}` as VPath);
    }
  } else {
    await vfs.writeFile(to, await vfs.readFile(from));
  }
  await vfs.remove(from);
}

describe(
  'renameChecked: a file moved or deleted by someone else meanwhile (errata N5 entry 18)',
  { timeout: 60_000 },
  () => {
    it('moved out during the copy (after its own copy): nothing is renamed, the move stands, no copy is left', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      afterWriteOf(vfs, '/browser/work/sub/inc.X68', () =>
        movedElsewhere(vfs, '/browser/lab/sub/inc.X68', '/browser/B/inc.X68'),
      );
      await expect(renameChecked(vfs, '/browser/lab', 'work')).rejects.toThrow(
        changedWhileRenaming('lab', 'lab/sub/inc.X68', true),
      );
      expect(await tree(vfs, '/browser')).toEqual({
        '/browser/lab': '/',
        '/browser/lab/prog.X68': 'V1',
        '/browser/lab/sub': '/',
        '/browser/lab/empty': '/',
        '/browser/B': '/',
        '/browser/B/inc.X68': 'INC',
        '/browser/other.X68': 'O',
      });
    });

    it('moved out after the check: the rename is made, and the moved file is not copied back', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      const gone: [readonly VPath[], VPath][] = [];
      const kept: VPath[] = [];
      beforeStat(vfs, '/browser/lab/prog.X68', 3, () =>
        movedElsewhere(vfs, '/browser/lab/prog.X68', '/browser/B/prog.X68'),
      );
      const renamed = await renameChecked(vfs, '/browser/lab', 'work', {
        kept: (files) => void kept.push(...files),
        gone: (files, at) => void gone.push([files, at]),
      });
      expect(renamed).toBe('/browser/work');
      expect(gone).toEqual([[['/browser/lab/prog.X68'], '/browser/work']]);
      expect(kept).toEqual([]);
      expect(await tree(vfs, '/browser')).toEqual({
        '/browser/B': '/',
        '/browser/B/prog.X68': 'V1',
        '/browser/work': '/',
        '/browser/work/sub': '/',
        '/browser/work/sub/inc.X68': 'INC',
        '/browser/work/empty': '/',
        '/browser/other.X68': 'O',
      });
    });

    it('a subfolder moved out whole after the check: neither it nor its files come back', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      beforeStat(vfs, '/browser/lab/sub/inc.X68', 3, () => movedElsewhere(vfs, '/browser/lab/sub', '/browser/B/sub'));
      expect(await renameChecked(vfs, '/browser/lab', 'work')).toBe('/browser/work');
      expect(await tree(vfs, '/browser')).toEqual({
        '/browser/B': '/',
        '/browser/B/sub': '/',
        '/browser/B/sub/inc.X68': 'INC',
        '/browser/work': '/',
        '/browser/work/prog.X68': 'V1',
        '/browser/work/empty': '/',
        '/browser/other.X68': 'O',
      });
    });

    it('deleted after the check: the deleted file does not come back under the new name', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      const gone: VPath[] = [];
      beforeStat(vfs, '/browser/lab/prog.X68', 3, () => vfs.remove('/browser/lab/prog.X68'));
      expect(await renameChecked(vfs, '/browser/lab', 'work', { gone: (files) => void gone.push(...files) })).toBe(
        '/browser/work',
      );
      expect(gone).toEqual(['/browser/lab/prog.X68']);
      expect(await tree(vfs, '/browser')).toEqual({
        '/browser/work': '/',
        '/browser/work/sub': '/',
        '/browser/work/sub/inc.X68': 'INC',
        '/browser/work/empty': '/',
        '/browser/other.X68': 'O',
      });
    });

    it('deleted after the check in a change of letter case: the rename is finished without it', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      beforeStat(vfs, '/browser/lab/prog.X68', 3, () => vfs.remove('/browser/lab/prog.X68'));
      expect(await renameChecked(vfs, '/browser/lab', 'LAB')).toBe('/browser/LAB');
      expect(Object.keys(await tree(vfs, '/browser')).sort()).toEqual([
        '/browser/LAB',
        '/browser/LAB/empty',
        '/browser/LAB/sub',
        '/browser/LAB/sub/inc.X68',
        '/browser/other.X68',
      ]);
    });

    it('replaced by another file of the same name after the check: a change, so both stay', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      const kept: VPath[] = [];
      const gone: VPath[] = [];
      beforeStat(vfs, '/browser/lab/prog.X68', 3, async () => {
        await vfs.remove('/browser/lab/prog.X68');
        await vfs.writeFile('/browser/lab/prog.X68', ascii('ANOTHER'));
      });
      const renamed = await renameChecked(vfs, '/browser/lab', 'work', {
        kept: (files) => void kept.push(...files),
        gone: (files) => void gone.push(...files),
      });
      expect(renamed).toBe('/browser/work');
      expect(kept).toEqual(['/browser/lab/prog.X68']);
      expect(gone).toEqual([]);
      expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('ANOTHER');
      expect(text(await vfs.readFile('/browser/work/prog.X68'))).toBe('V1');
    });

    it('a copy that someone wrote to before its source went is kept (it is their save)', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      const gone: VPath[] = [];
      beforeStat(vfs, '/browser/lab/prog.X68', 3, async () => {
        await vfs.writeFile('/browser/work/prog.X68', ascii('SAVED THERE'));
        await vfs.remove('/browser/lab/prog.X68');
      });
      expect(await renameChecked(vfs, '/browser/lab', 'work', { gone: (files) => void gone.push(...files) })).toBe(
        '/browser/work',
      );
      expect(gone).toEqual([]);
      expect(text(await vfs.readFile('/browser/work/prog.X68'))).toBe('SAVED THERE');
    });

    it('a file renamed while it is deleted: nothing is renamed and no copy is left', async () => {
      const { vfs } = memoryStores();
      await lab(vfs);
      // A file is looked at once more than a folder's files: by renameChecked itself, first.
      for (const nth of [3, 4]) {
        await vfs.writeFile('/browser/lab/prog.X68', ascii('V1'));
        beforeStat(vfs, '/browser/lab/prog.X68', nth, () => vfs.remove('/browser/lab/prog.X68'));
        await expect(renameChecked(vfs, '/browser/lab/prog.X68', 'main.X68')).rejects.toThrow(
          changedWhileRenaming('prog.X68', 'prog.X68', false),
        );
        expect(await vfs.stat('/browser/lab/main.X68')).toBeNull();
        expect(await vfs.stat('/browser/lab/prog.X68')).toBeNull();
      }
    });

    it('a folder Rename and a move out of it at the same time leave each file once (the review probe)', async () => {
      for (let delay = 0; delay < 12; delay++) {
        const { vfs } = memoryStores();
        await vfs.writeFile('/browser/A/p.X68', ascii('P'));
        await vfs.writeFile('/browser/A/q.X68', ascii('Q'));
        await vfs.mkdirp('/browser/B');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        const later = async () => {
          for (let i = 0; i < delay; i++) await Promise.resolve();
          return renameChecked(vfs, '/browser/A', 'A2');
        };
        const [move, rename] = await Promise.allSettled([
          transferItems(deps, ['/browser/A/p.X68'], '/browser/B'),
          later(),
        ]);
        const files = Object.entries(await tree(vfs, '/browser')).filter(([, bytes]) => bytes !== '/');
        const where = (bytes: string) => files.filter(([, b]) => b === bytes).map(([path]) => path);
        const report = `delay ${delay}: ${move.status} ${rename.status} ${JSON.stringify(files)}`;
        expect(where('P'), report).toHaveLength(1);
        expect(where('Q'), report).toHaveLength(1);
        if (move.status === 'fulfilled' && move.value.done) expect(where('P'), report).toEqual(['/browser/B/p.X68']);
      }
    });
  },
);

describe('the message for a file that went while its folder was renamed', { timeout: 60_000 }, () => {
  it('Rename... says which file went and that the renamed folder holds no copy of it', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    await lab(ctx.vfs);
    beforeStat(ctx.vfs, '/browser/lab/prog.X68', 3, () => ctx.vfs.remove('/browser/lab/prog.X68'));
    const seen = answer(application, ['work', 'OK']);
    expect(await renamePath(ctx, '/browser/lab')).toBe('/browser/work');
    const box = seen[1]?.props as MessageBoxRequest;
    expect([box.title, box.icon, box.text]).toEqual([
      'Rename',
      'information',
      goneAfterRenaming('prog.X68', 'My Programs/work'),
    ]);
    expect(goneAfterRenaming('prog.X68', 'My Programs/work')).toBe(
      '"prog.X68" was moved or deleted while its folder was being renamed, so My Programs/work does not hold a copy of it.',
    );
    expect(await ctx.vfs.stat('/browser/work/prog.X68')).toBeNull();
    application.dispose();
  });

  it('Undo Rename says the same, titled Undo', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    expect(await renameChecked(vfs, '/browser/lab', 'work')).toBe('/browser/work');
    deps.undo.push({
      kind: 'rename',
      pairs: [['/browser/lab', '/browser/work']],
      folders: [],
      created: [],
      replaced: [],
    });
    beforeStat(vfs, '/browser/work/prog.X68', 3, () => vfs.remove('/browser/work/prog.X68'));
    expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual(['/browser/lab']);
    expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
      ['Undo', 'information', goneAfterRenaming('prog.X68', 'My Programs/lab')],
    ]);
    expect(await vfs.stat('/browser/lab/prog.X68')).toBeNull();
    expect(await vfs.stat('/browser/work')).toBeNull();
  });
});

describe('Undo Rename with a change during the copy', { timeout: 60_000 }, () => {
  it('leaves the folder under its new name with the change, says so, and moves no history', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const history = scriptedHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    expect(await renameChecked(vfs, '/browser/lab', 'work')).toBe('/browser/work');
    deps.undo.push({
      kind: 'rename',
      pairs: [['/browser/lab', '/browser/work']],
      folders: [],
      created: [],
      replaced: [],
    });
    afterWriteOf(vfs, '/browser/lab/prog.X68', () => vfs.writeFile('/browser/work/prog.X68', ascii('V2 EDITED')));
    const back = await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(back).toEqual([]);
    expect(text(await vfs.readFile('/browser/work/prog.X68'))).toBe('V2 EDITED');
    expect(await vfs.stat('/browser/lab')).toBeNull();
    expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
      ['Undo', 'error', changedWhileRenaming('work', 'work/prog.X68', true)],
    ]);
    expect(history.calls.filter((c) => c.startsWith('moved'))).toEqual([]);
  });

  it('a change in the last moment: told which file stayed and where its earlier copy is', async () => {
    const { vfs } = memoryStores();
    await lab(vfs);
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    expect(await renameChecked(vfs, '/browser/lab', 'work')).toBe('/browser/work');
    deps.undo.push({
      kind: 'rename',
      pairs: [['/browser/lab', '/browser/work']],
      folders: [],
      created: [],
      replaced: [],
    });
    beforeStat(vfs, '/browser/work/prog.X68', 3, () => vfs.writeFile('/browser/work/prog.X68', ascii('V2 LATE')));
    expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual(['/browser/lab']);
    expect(text(await vfs.readFile('/browser/work/prog.X68'))).toBe('V2 LATE');
    expect(text(await vfs.readFile('/browser/lab/prog.X68'))).toBe('V1');
    expect(deps.dialogs.texts()).toEqual([changedAfterRenaming('prog.X68', 'My Programs/lab')]);
    expect(changedAfterRenaming('prog.X68', 'My Programs/lab')).toBe(
      '"prog.X68" changed while its folder was being renamed, so it stays where it was. The copy in My Programs/lab holds it as it was before the change.',
    );
  });
});

/** Answers the dialogs that appear, one after another, with the given results (index.test.ts). */
function answer(application: TestApplication, results: unknown[]): DialogInstance[] {
  const seen: DialogInstance[] = [];
  const stop = application.ctx.store.subscribe(() => {
    for (const dialog of application.ctx.store.getState().dialogs.stack) {
      if (seen.includes(dialog)) continue;
      seen.push(dialog);
      const result = results.shift();
      queueMicrotask(() => application.dialogs.close(dialog.key, result));
      if (results.length === 0) stop();
    }
  });
  return seen;
}

describe('Rename... in the application', { timeout: 60_000 }, () => {
  it('a save during the copy: the error names the file, the name is asked again, nothing is lost', async () => {
    const application = createTestApplication({ features: [feature], services: { createFileDialogs } });
    const { ctx } = application;
    await lab(ctx.vfs);
    afterWriteOf(ctx.vfs, '/browser/work/prog.X68', () => ctx.vfs.writeFile('/browser/lab/prog.X68', ascii('V2')));
    const seen = answer(application, ['work', 'OK', null]);
    expect(await renamePath(ctx, '/browser/lab')).toBeNull();
    const box = seen[1]?.props as MessageBoxRequest;
    expect([box.title, box.icon, box.text]).toEqual([
      'Rename',
      'error',
      changedWhileRenaming('lab', 'lab/prog.X68', true),
    ]);
    expect((seen[2]?.props as { initial: string }).initial).toBe('work');
    expect(text(await ctx.vfs.readFile('/browser/lab/prog.X68'))).toBe('V2');
    expect(await ctx.vfs.stat('/browser/work')).toBeNull();
    application.dispose();
  });
});
