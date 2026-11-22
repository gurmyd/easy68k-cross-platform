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
import { changedWhileMoving } from './texts';
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
