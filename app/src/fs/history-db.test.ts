// N0's stub of the history store: state 'unavailable', and each member as P4.4's table of states
// gives it for 'unavailable'. N3 replaces this file with the tests of the real store.

import { describe, expect, it, vi } from 'vitest';
import type { SeenFile } from '../contracts';
import { browserHistoryDeps, createHistoryService } from './history-db';
import { createMemoryHistoryService } from './history-memory';
import { MemoryBackend } from './memory-backend';
import { createVfs } from './vfs';

const clock = { now: () => 0, wallTime: () => new Date(0) };
const scheduler = { onFrame: () => () => {}, setTimer: () => () => {} };

async function setup() {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
  vfs.mount(new MemoryBackend());
  await vfs.writeFile('/browser/demo/prog.X68', new Uint8Array([65, 66]));
  await vfs.writeFile('/browser/demo/sub/b.X68', new Uint8Array([67]));
  await vfs.mkdirp('/browser/empty');
  return { vfs, history: createMemoryHistoryService({ vfs, clock, scheduler }) };
}

describe('the stub history (state unavailable)', () => {
  it('is unavailable and keeps nothing', async () => {
    const { history } = await setup();
    expect(history.state()).toBe('unavailable');
    await expect(history.record('/browser/demo/prog.X68', new Uint8Array([1]), 'saved', 5)).resolves.toBeUndefined();
    expect(await history.versions('/browser/demo/prog.X68')).toEqual([]);
    expect(await history.trashItems()).toEqual([]);
    expect(await history.usage()).toEqual({ versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 0 });
    await expect(history.read('/browser/demo/prog.X68', 1)).rejects.toThrow(/no longer kept/);
    expect(
      await history.restoreTrash('x', {
        ask: async () => 'cancel',
        fallback: async () => null,
        confirm: async () => false,
      }),
    ).toEqual({ restored: [], left: [], lost: [], gone: true });
    for (const call of [
      history.dropTrash(['x']),
      history.moved('/browser/a', '/browser/b'),
      history.clearVersions(),
      history.deleteAll(),
    ]) {
      await expect(call).resolves.toBeUndefined();
    }
    const unsubscribe = history.subscribe(() => {});
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('untracked gives the reasons of P3.3.3', () => {
    const history = createHistoryService(browserHistoryDeps({} as never));
    const text = new Uint8Array([65, 66, 10]);
    expect(history.untracked('/browser/demo/prog.X68', 3, text)).toBeNull();
    expect(history.untracked('/memory/Examples/a.X68', 3, text)).toBe('memory');
    expect(history.untracked('/folder/.git/config', 3, text)).toBe('git');
    expect(history.untracked('/folder/sub/.GIT/x/y.X68', 3, text)).toBe('git');
    expect(history.untracked('/browser/demo/prog.L68', 3, text)).toBe('generated');
    expect(history.untracked('/browser/demo/prog.s68', 3, text)).toBe('generated');
    expect(history.untracked('/browser/big.X68', (1 << 20) + 1, text)).toBe('too-large');
    expect(history.untracked('/browser/a.bin', 3, new Uint8Array([65, 0, 66]))).toBe('not-text');
    // a folder named like .git but not .git, and a file named .git, are tracked
    expect(history.untracked('/browser/.github/a.X68', 3, text)).toBeNull();
    expect(history.untracked('/browser/.git', 3, text)).toBeNull();
  });

  it('guard: asks, then acts, and changes no record', async () => {
    const { history } = await setup();
    const acted: (readonly SeenFile[])[] = [];
    const act = async (seen: readonly SeenFile[]) => void acted.push(seen);
    expect(await history.guard('/browser/demo/prog.X68', 'delete', act, async () => false)).toEqual({
      outcome: 'declined',
    });
    expect(acted).toEqual([]);
    expect(await history.guard('/browser/demo', 'delete', act, async () => true)).toEqual({ outcome: 'not-kept' });
    expect(acted[0]?.map((file) => [file.path, file.size])).toEqual([
      ['/browser/demo/prog.X68', 2],
      ['/browser/demo/sub/b.X68', 1],
    ]);
    // An empty folder exists: the question is asked as well.
    const confirm = vi.fn(async () => true);
    expect(await history.guard('/browser/empty', 'delete', act, confirm)).toEqual({ outcome: 'not-kept' });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('guard: a path that does not exist is acted on without a question; below .git it rejects', async () => {
    const { history } = await setup();
    const confirm = vi.fn(async () => true);
    const act = vi.fn(async () => {});
    expect(await history.guard('/browser/none.X68', 'replace', act, confirm)).toEqual({ outcome: 'kept' });
    expect(act).toHaveBeenCalledWith([]);
    expect(confirm).not.toHaveBeenCalled();
    act.mockClear();
    await expect(history.guard('/browser/repo/.Git/HEAD', 'delete', act, confirm)).rejects.toThrow(/\.git/);
    expect(act).not.toHaveBeenCalled();
  });

  it('guard passes a rejection of act on', async () => {
    const { history } = await setup();
    await expect(
      history.guard(
        '/browser/demo/prog.X68',
        'replace',
        async () => {
          throw new Error('"prog.X68" changed while it was being replaced. It was not replaced.');
        },
        async () => true,
      ),
    ).rejects.toThrow(/changed while/);
  });

  it('browserHistoryDeps works under Node, where there is no IndexedDB', () => {
    const deps = browserHistoryDeps({ vfs: 1, settings: 2, clock: 3, scheduler: 4 } as never);
    expect(deps.indexedDB).toBeNull();
    expect(deps.vfs).toBe(1);
    expect(typeof deps.channel).toBe('function');
    deps.channel('easy68k.test')?.close();
  });
});
