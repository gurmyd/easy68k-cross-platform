// A move copies, then removes the source; Undo of a move does the same the other way (ARCHITECTURE-
// PLUS P3.2.4, P3.2.7). When the source changes after its bytes were taken and before it is
// removed (another window saves it, a program writes it), removing it would lose that change. By
// the seven properties of P3.3.1 (property 1: no file of the student is lost) the source stays,
// with its change, and the student is told (errata N5 entry 16; verify round 2 of N5).

import { describe, expect, it } from 'vitest';
import type { Vfs, VPath } from '../../contracts';
import { createVfs } from '../../fs/vfs';
import { MemoryBackend } from '../../fs/memory-backend';
import type { UndoEntry } from './bulk';
import { transferItems, unchangedSince } from './move';
import { renameChecked } from './rename';
import { changedWhileMoving, changedWhileRenaming, goneWhileMoving, noLongerExists } from './texts';
import { ascii, filesTestDeps, memoryStores, scriptedDialogs, scriptedHistory, text } from './testing';

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

describe('a move never removes a source that changed after it was copied', { timeout: 60_000 }, () => {
  it('the source stays with its change, the copy has the bytes from before, the history stays, the student is told', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/a/p.X68', ascii('V1'));
    await vfs.writeFile('/browser/a/q.X68', ascii('Q'));
    await vfs.mkdirp('/browser/b');
    const history = scriptedHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    afterWriteOf(vfs, '/browser/b/p.X68', () => vfs.writeFile('/browser/a/p.X68', ascii('V2 SAVED BY OTHER WINDOW')));
    const outcome = await transferItems(deps, ['/browser/a/p.X68', '/browser/a/q.X68'], '/browser/b');
    expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('V2 SAVED BY OTHER WINDOW');
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('V1');
    // The other file moved as usual.
    expect(await vfs.stat('/browser/a/q.X68')).toBeNull();
    expect(text(await vfs.readFile('/browser/b/q.X68'))).toBe('Q');
    expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
      ['Move', 'information', changedWhileMoving('p.X68', 'My Programs/b', false)],
    ]);
    expect(changedWhileMoving('p.X68', 'My Programs/b', false)).toBe(
      '"p.X68" changed while it was being moved, so it stays where it was. The copy in My Programs/b holds it as it was before the change.',
    );
    // Only the file actually moved takes its history along, and only it moves back on Undo.
    expect(history.calls.filter((c) => c.startsWith('moved'))).toEqual(['moved /browser/a/q.X68 -> /browser/b/q.X68']);
    expect(outcome.written).toEqual([['/browser/a/q.X68', '/browser/b/q.X68']]);
    expect((outcome.undo as Extract<UndoEntry, { kind: 'move' | 'rename' }>).pairs).toEqual([
      ['/browser/a/q.X68', '/browser/b/q.X68'],
    ]);
  });

  it('a change of the same length within the same clock tick is seen too (the bytes are compared)', async () => {
    const vfs = createVfs();
    vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => 5 }));
    await vfs.writeFile('/browser/a/p.X68', ascii('AAAA'));
    await vfs.mkdirp('/browser/b');
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    afterWriteOf(vfs, '/browser/b/p.X68', () => vfs.writeFile('/browser/a/p.X68', ascii('BBBB')));
    await transferItems(deps, ['/browser/a/p.X68'], '/browser/b');
    expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('BBBB');
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('AAAA');
    expect(deps.dialogs.texts()).toEqual([changedWhileMoving('p.X68', 'My Programs/b', false)]);
  });

  it('a source removed meanwhile is not "unchanged" (nothing is removed twice)', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/p.X68', ascii('P'));
    const stat = await vfs.stat('/browser/p.X68');
    const seen = { mtime: stat?.mtime ?? 0, size: 1, data: ascii('P') };
    expect(await unchangedSince(vfs, '/browser/p.X68', seen)).toBe(true);
    expect(await unchangedSince(vfs, '/browser/p.X68', undefined)).toBe(false);
    await vfs.remove('/browser/p.X68');
    expect(await unchangedSince(vfs, '/browser/p.X68', seen)).toBe(false);
  });

  it('Undo of a move keeps a moved file that changed after it was copied back', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/a/p.X68', ascii('V1'));
    await vfs.mkdirp('/browser/b');
    const history = scriptedHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    await transferItems(deps, ['/browser/a/p.X68'], '/browser/b');
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('V1');
    afterWriteOf(vfs, '/browser/a/p.X68', () => vfs.writeFile('/browser/b/p.X68', ascii('V2 EDITED')));
    const back = await deps.undo.run(deps.stack.peek() as UndoEntry, false);
    expect(back).toEqual([]);
    expect(text(await vfs.readFile('/browser/b/p.X68'))).toBe('V2 EDITED');
    expect(text(await vfs.readFile('/browser/a/p.X68'))).toBe('V1');
    expect(deps.dialogs.texts()).toEqual([changedWhileMoving('p.X68', 'My Programs/a', true)]);
    expect(changedWhileMoving('p.X68', 'My Programs/a', true)).toBe(
      '"p.X68" changed while it was being moved back, so it stays where it is. The copy in My Programs/a holds it as it was before the change.',
    );
    expect(history.calls.filter((c) => c.startsWith('moved'))).toEqual(['moved /browser/a/p.X68 -> /browser/b/p.X68']);
  });

  it('a source moved elsewhere meanwhile (its folder renamed by another window): its copy goes, nothing comes back', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/A/p.X68', ascii('P'));
    await vfs.writeFile('/browser/A/q.X68', ascii('Q'));
    await vfs.mkdirp('/browser/B');
    const history = scriptedHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    // Between the move's copy and its removal the whole folder is renamed (the review's probe, the
    // other way round).
    afterWriteOf(vfs, '/browser/B/p.X68', async () => {
      expect(await renameChecked(vfs, '/browser/A', 'A2')).toBe('/browser/A2');
    });
    const outcome = await transferItems(deps, ['/browser/A/p.X68'], '/browser/B');
    expect(await vfs.stat('/browser/B/p.X68')).toBeNull();
    expect(text(await vfs.readFile('/browser/A2/p.X68'))).toBe('P');
    expect(text(await vfs.readFile('/browser/A2/q.X68'))).toBe('Q');
    expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
      ['Move', 'information', goneWhileMoving('p.X68', 'My Programs/B', false)],
    ]);
    expect(goneWhileMoving('p.X68', 'My Programs/B', false)).toBe(
      '"p.X68" was moved or deleted while it was being moved, so My Programs/B does not hold a copy of it.',
    );
    // Nothing was moved: no history follows, no toast, no Undo.
    expect(outcome.done).toBe(false);
    expect(outcome.written).toEqual([]);
    expect(history.calls.filter((c) => c.startsWith('moved'))).toEqual([]);
    expect(deps.dialogs.toasts).toEqual([]);
  });

  it('a source deleted meanwhile: its copy goes; one that replaced a file stays (that file is in the Trash)', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/a/p.X68', ascii('P'));
    await vfs.writeFile('/browser/a/r.X68', ascii('R NEW'));
    await vfs.writeFile('/browser/b/r.X68', ascii('R OLD'));
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs), dialogs: scriptedDialogs(['Yes']) });
    afterWriteOf(vfs, '/browser/b/r.X68', async () => {
      await vfs.remove('/browser/a/p.X68');
      await vfs.remove('/browser/a/r.X68');
    });
    await transferItems(deps, ['/browser/a/p.X68', '/browser/a/r.X68'], '/browser/b');
    expect(await vfs.stat('/browser/b/p.X68')).toBeNull();
    expect(text(await vfs.readFile('/browser/b/r.X68'))).toBe('R NEW');
    expect(deps.dialogs.texts().filter((t) => t.includes('was moved or deleted'))).toEqual([
      goneWhileMoving('p.X68', 'My Programs/b', false),
    ]);
    expect(deps.dialogs.texts().some((t) => t.includes('changed while'))).toBe(false);
  });

  it('Undo of a move: a file deleted at its new place meanwhile is not brought back', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/a/p.X68', ascii('V1'));
    await vfs.mkdirp('/browser/b');
    const history = scriptedHistory(vfs);
    const deps = filesTestDeps({ vfs, history });
    await transferItems(deps, ['/browser/a/p.X68'], '/browser/b');
    afterWriteOf(vfs, '/browser/a/p.X68', () => vfs.remove('/browser/b/p.X68'));
    expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual([]);
    expect(await vfs.stat('/browser/a/p.X68')).toBeNull();
    expect(await vfs.stat('/browser/b/p.X68')).toBeNull();
    expect(deps.dialogs.texts()).toEqual([goneWhileMoving('p.X68', 'My Programs/a', true)]);
    expect(goneWhileMoving('p.X68', 'My Programs/a', true)).toBe(
      '"p.X68" was moved or deleted while it was being moved back, so My Programs/a does not hold a copy of it.',
    );
    expect(history.calls.filter((c) => c.startsWith('moved'))).toEqual(['moved /browser/a/p.X68 -> /browser/b/p.X68']);
  });

  it('without a change a move still removes its source (the check costs nothing else)', async () => {
    const { vfs } = memoryStores();
    await vfs.writeFile('/browser/a/p.X68', ascii('V1'));
    await vfs.mkdirp('/browser/b');
    const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
    await transferItems(deps, ['/browser/a'], '/browser/b');
    expect(await vfs.stat('/browser/a')).toBeNull();
    expect(text(await vfs.readFile('/browser/b/a/p.X68'))).toBe('V1');
    expect(deps.dialogs.shown).toEqual([]);
  });
});

/** Before the first removal of `when`, `then` runs once: the moment after the last check. */
function beforeRemoveOf(vfs: Vfs, when: VPath, then: () => Promise<void>): void {
  const remove = vfs.remove.bind(vfs);
  let done = false;
  vfs.remove = async (path) => {
    if (!done && path === when) {
      done = true;
      await then();
    }
    return remove(path);
  };
}

/** Every file below `root` with its bytes. */
async function filesOf(vfs: Vfs, root: VPath): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: VPath) => {
    for (const entry of await vfs.list(dir)) {
      const path = `${dir}/${entry.name}` as VPath;
      if (entry.kind === 'dir') await walk(path);
      else out[path] = text(await vfs.readFile(path));
    }
  };
  await walk(root);
  return out;
}

describe(
  'a source that goes between the last check and its removal is a source that is gone (errata N5 entry 18)',
  { timeout: 60_000 },
  () => {
    for (const how of ['moved out', 'deleted'] as const) {
      const away = (vfs: Vfs, path: VPath) =>
        how === 'deleted'
          ? vfs.remove(path)
          : (async () => {
              await vfs.writeFile('/browser/B/p.X68', await vfs.readFile(path));
              await vfs.remove(path);
            })();

      it(`a folder rename, p ${how} just before its removal: its copy goes, the rename goes on with q`, async () => {
        const { vfs } = memoryStores();
        await vfs.writeFile('/browser/A/p.X68', ascii('P'));
        await vfs.writeFile('/browser/A/q.X68', ascii('Q'));
        await vfs.mkdirp('/browser/B');
        const gone: VPath[] = [];
        beforeRemoveOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68'));
        const renamed = await renameChecked(vfs, '/browser/A', 'A2', { gone: (files) => void gone.push(...files) });
        expect(renamed).toBe('/browser/A2');
        expect(gone).toEqual(['/browser/A/p.X68']);
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/B/p.X68': 'P' } : {}),
          '/browser/A2/q.X68': 'Q',
        });
        expect(await vfs.stat('/browser/A')).toBeNull();
      });

      it(`a file rename, the file ${how} just before its removal: nothing is renamed, nothing is left`, async () => {
        const { vfs } = memoryStores();
        await vfs.writeFile('/browser/A/p.X68', ascii('P'));
        await vfs.mkdirp('/browser/B');
        beforeRemoveOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68'));
        await expect(renameChecked(vfs, '/browser/A/p.X68', 'r.X68')).rejects.toThrow(/./);
        expect(await filesOf(vfs, '/browser')).toEqual(how === 'moved out' ? { '/browser/B/p.X68': 'P' } : {});
      });

      it(`a move, p ${how} just before its removal: its copy goes, q is moved, the student is told`, async () => {
        const { vfs } = memoryStores();
        await vfs.writeFile('/browser/A/p.X68', ascii('P'));
        await vfs.writeFile('/browser/A/q.X68', ascii('Q'));
        await vfs.mkdirp('/browser/B');
        await vfs.mkdirp('/browser/C');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        beforeRemoveOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68'));
        const outcome = await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/C');
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/B/p.X68': 'P' } : {}),
          '/browser/C/q.X68': 'Q',
        });
        expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
          ['Move', 'information', goneWhileMoving('p.X68', 'My Programs/C', false)],
        ]);
        expect(outcome.written).toEqual([['/browser/A/q.X68', '/browser/C/q.X68']]);
      });

      it(`Undo of a move, the file ${how} at its new place just before its removal: not brought back`, async () => {
        const { vfs } = memoryStores();
        await vfs.writeFile('/browser/a/p.X68', ascii('P'));
        await vfs.mkdirp('/browser/b');
        await vfs.mkdirp('/browser/B');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        await transferItems(deps, ['/browser/a/p.X68'], '/browser/b');
        beforeRemoveOf(vfs, '/browser/b/p.X68', () => away(vfs, '/browser/b/p.X68'));
        expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual([]);
        expect(await filesOf(vfs, '/browser')).toEqual(how === 'moved out' ? { '/browser/B/p.X68': 'P' } : {});
        expect(deps.dialogs.texts()).toEqual([goneWhileMoving('p.X68', 'My Programs/a', true)]);
      });
    }
  },
);

/** Before the first read of `when`, `then` runs once: the other window acts before the bytes are taken. */
function beforeReadOf(vfs: Vfs, when: VPath, then: () => Promise<void>): void {
  const readFile = vfs.readFile.bind(vfs);
  let done = false;
  vfs.readFile = async (path) => {
    if (!done && path === when) {
      done = true;
      await then();
    }
    return readFile(path);
  };
}

/** After the first read of `when` returned, `then` runs once: between the bytes and their time. */
function afterReadOf(vfs: Vfs, when: VPath, then: () => Promise<void>): void {
  const readFile = vfs.readFile.bind(vfs);
  let done = false;
  vfs.readFile = async (path) => {
    const bytes = await readFile(path);
    if (!done && path === when) {
      done = true;
      await then();
    }
    return bytes;
  };
}

describe(
  'another window acts just before or just after the bytes of a source are taken (review of the fourth round)',
  {
    timeout: 60_000,
  },
  () => {
    async function twoFiles(): Promise<Vfs> {
      const { vfs } = memoryStores();
      await vfs.writeFile('/browser/A/p.X68', ascii('P'));
      await vfs.writeFile('/browser/A/q.X68', ascii('Q'));
      await vfs.mkdirp('/browser/B');
      return vfs;
    }

    it('a move, p saved just before it is read: the new bytes are moved, no duplicate, nothing to tell', async () => {
      const vfs = await twoFiles();
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      beforeReadOf(vfs, '/browser/A/p.X68', () => vfs.writeFile('/browser/A/p.X68', ascii('PNEW')));
      const outcome = await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
      expect(await filesOf(vfs, '/browser')).toEqual({ '/browser/B/p.X68': 'PNEW', '/browser/B/q.X68': 'Q' });
      expect(deps.dialogs.shown).toEqual([]);
      expect(outcome.written).toEqual([
        ['/browser/A/p.X68', '/browser/B/p.X68'],
        ['/browser/A/q.X68', '/browser/B/q.X68'],
      ]);
    });

    it('a move, p saved between its read and its time: it stays, and the copy truly holds the bytes from before', async () => {
      const vfs = await twoFiles();
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      afterReadOf(vfs, '/browser/A/p.X68', () => vfs.writeFile('/browser/A/p.X68', ascii('PNEW')));
      await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
      expect(await filesOf(vfs, '/browser')).toEqual({
        '/browser/A/p.X68': 'PNEW',
        '/browser/B/p.X68': 'P',
        '/browser/B/q.X68': 'Q',
      });
      expect(deps.dialogs.texts()).toEqual([changedWhileMoving('p.X68', 'My Programs/B', false)]);
    });

    it('Undo of a move, p saved at its new place just before it is read: the new bytes go back, no duplicate', async () => {
      const vfs = await twoFiles();
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
      beforeReadOf(vfs, '/browser/B/p.X68', () => vfs.writeFile('/browser/B/p.X68', ascii('PNEW')));
      expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual([
        '/browser/A/p.X68',
        '/browser/A/q.X68',
      ]);
      expect(await filesOf(vfs, '/browser')).toEqual({ '/browser/A/p.X68': 'PNEW', '/browser/A/q.X68': 'Q' });
      expect(deps.dialogs.shown).toEqual([]);
    });

    it('Undo of a move, p saved between its read and its time: it stays, and the copy truly holds the bytes from before', async () => {
      const vfs = await twoFiles();
      const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
      await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
      afterReadOf(vfs, '/browser/B/p.X68', () => vfs.writeFile('/browser/B/p.X68', ascii('PNEW')));
      expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual(['/browser/A/q.X68']);
      expect(await filesOf(vfs, '/browser')).toEqual({
        '/browser/A/p.X68': 'P',
        '/browser/A/q.X68': 'Q',
        '/browser/B/p.X68': 'PNEW',
      });
      expect(deps.dialogs.texts()).toEqual([changedWhileMoving('p.X68', 'My Programs/A', true)]);
    });

    it('a folder rename, q saved just before it is read: the rename is made with the new bytes', async () => {
      const vfs = await twoFiles();
      beforeReadOf(vfs, '/browser/A/q.X68', () => vfs.writeFile('/browser/A/q.X68', ascii('QNEW')));
      expect(await renameChecked(vfs, '/browser/A', 'A2')).toBe('/browser/A2');
      expect(await filesOf(vfs, '/browser')).toEqual({ '/browser/A2/p.X68': 'P', '/browser/A2/q.X68': 'QNEW' });
    });

    it('a folder rename, q saved between its read and its time: refused, nothing changed but the save', async () => {
      const vfs = await twoFiles();
      afterReadOf(vfs, '/browser/A/q.X68', () => vfs.writeFile('/browser/A/q.X68', ascii('QNEW')));
      await expect(renameChecked(vfs, '/browser/A', 'A2')).rejects.toThrow(changedWhileRenaming('A', 'A/q.X68', true));
      expect(await filesOf(vfs, '/browser')).toEqual({ '/browser/A/p.X68': 'P', '/browser/A/q.X68': 'QNEW' });
    });

    for (const how of ['moved out', 'deleted'] as const) {
      const away = async (vfs: Vfs, path: VPath, to: VPath) => {
        if (how === 'moved out') await vfs.writeFile(to, await vfs.readFile(path));
        await vfs.remove(path);
      };

      it(`a move, p ${how} just before it is read: the designed text, not the file system's`, async () => {
        const vfs = await twoFiles();
        await vfs.mkdirp('/browser/C');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        beforeReadOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68', '/browser/C/p.X68'));
        const outcome = await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/C/p.X68': 'P' } : {}),
          '/browser/B/q.X68': 'Q',
        });
        expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
          ['Move', 'information', goneWhileMoving('p.X68', 'My Programs/B', false)],
        ]);
        expect(outcome.written).toEqual([['/browser/A/q.X68', '/browser/B/q.X68']]);
      });

      it(`a copy, p ${how} just before it is read: the designed text, not the file system's`, async () => {
        const vfs = await twoFiles();
        await vfs.mkdirp('/browser/C');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        beforeReadOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68', '/browser/C/p.X68'));
        await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B', 'copy');
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/C/p.X68': 'P' } : {}),
          '/browser/A/q.X68': 'Q',
          '/browser/B/q.X68': 'Q',
        });
        expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
          ['Copy', 'error', noLongerExists('p.X68')],
        ]);
      });

      it(`Undo of a move, p ${how} at its new place just before it is read: the designed text`, async () => {
        const vfs = await twoFiles();
        await vfs.mkdirp('/browser/C');
        const deps = filesTestDeps({ vfs, history: scriptedHistory(vfs) });
        await transferItems(deps, ['/browser/A/p.X68', '/browser/A/q.X68'], '/browser/B');
        beforeReadOf(vfs, '/browser/B/p.X68', () => away(vfs, '/browser/B/p.X68', '/browser/C/p.X68'));
        expect(await deps.undo.run(deps.stack.peek() as UndoEntry, false)).toEqual(['/browser/A/q.X68']);
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/C/p.X68': 'P' } : {}),
          '/browser/A/q.X68': 'Q',
        });
        expect(deps.dialogs.shown.map((r) => [r.title, r.icon, r.text])).toEqual([
          ['Undo', 'information', goneWhileMoving('p.X68', 'My Programs/A', true)],
        ]);
      });

      it(`a folder rename, q ${how} just before it is read: the designed text, the folder as it was`, async () => {
        const vfs = await twoFiles();
        await vfs.mkdirp('/browser/C');
        beforeReadOf(vfs, '/browser/A/q.X68', () => away(vfs, '/browser/A/q.X68', '/browser/C/q.X68'));
        const error = await renameChecked(vfs, '/browser/A', 'A2').then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).name).toBe('Error');
        expect((error as Error).message).toBe(noLongerExists('q.X68'));
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/C/q.X68': 'Q' } : {}),
          '/browser/A/p.X68': 'P',
        });
      });

      it(`a file rename, the file ${how} just before it is read: the designed text, nothing left`, async () => {
        const vfs = await twoFiles();
        await vfs.mkdirp('/browser/C');
        beforeReadOf(vfs, '/browser/A/p.X68', () => away(vfs, '/browser/A/p.X68', '/browser/C/p.X68'));
        await expect(renameChecked(vfs, '/browser/A/p.X68', 'r.X68')).rejects.toThrow(noLongerExists('p.X68'));
        expect(await filesOf(vfs, '/browser')).toEqual({
          ...(how === 'moved out' ? { '/browser/C/p.X68': 'P' } : {}),
          '/browser/A/q.X68': 'Q',
        });
      });
    }
  },
);
