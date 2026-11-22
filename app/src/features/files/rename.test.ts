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
import { renameChecked } from './rename';
import { changedAfterRenaming, changedWhileRenaming, gitRefusal } from './texts';
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
