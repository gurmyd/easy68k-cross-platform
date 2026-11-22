// restoreWithQuestions and the texts of a restore from the Trash (ARCHITECTURE-PLUS P3.3.8, P3.3.4,
// P3.2.7, P4.4; the unit list of P5 N4). Owner: N4.
//
// Most cases run against the real store (createMemoryHistoryStore of fs/history-memory.ts, N3) over
// a memory Vfs; the cases a single window cannot produce (files `lost` to another window meanwhile)
// use a small fake of `restoreTrash`.

import { describe, expect, it, vi } from 'vitest';
import type {
  Bytes,
  DialogService,
  DocumentService,
  DocumentState,
  HistoryService,
  MessageBoxRequest,
  SeenFile,
  Settings,
  SettingsService,
  VPath,
} from '../../contracts';
import { createMemoryHistoryStore } from '../../fs/history-memory';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { cannotKeepQuestion } from '../history/texts';
import { RESTORED_FALLBACK, restoreWithQuestions, type RestoreFlowDeps } from './restore-flow';
import {
  existsQuestion,
  folderNotOpen,
  noLongerInTrash,
  partlyRestored,
  placeUnreachable,
  restoredName,
  unsavedChanges,
} from './texts';

const text = (s: string): Bytes => new TextEncoder().encode(s);
const decode = (b: Bytes) => new TextDecoder().decode(b);
const SLOW = 60_000;

/** A memory Vfs, the real store over it, the `history` switch, and scripted message boxes. */
function setup() {
  let time = Date.UTC(2026, 10, 20, 12);
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => ++time }));
  let historyOn = true;
  const listeners = new Set<() => void>();
  const settings = {
    get: () => ({ app: { plus: { viewer: true, history: historyOn } } }) as unknown as Settings,
    update: () => {},
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as SettingsService;
  const setHistory = (on: boolean) => {
    historyOn = on;
    for (const listener of listeners) listener();
  };
  const clock = { now: () => time, wallTime: () => new Date(time) };
  const scheduler = { setTimer: () => () => {}, onFrame: () => () => {} };
  const history = createMemoryHistoryStore({ vfs, clock, scheduler, settings }, { schedulePass: false });

  const boxes: MessageBoxRequest[] = [];
  const answers: string[] = [];
  const dialogs = {
    messageBox: async (request: MessageBoxRequest) => {
      boxes.push(request);
      return answers.shift() ?? (request.buttons.includes('OK') ? 'OK' : 'No');
    },
  } as unknown as DialogService;

  const open: DocumentState[] = [];
  const reloaded: string[] = [];
  const documents = {
    list: () => open,
    reload: async (id: string) => void reloaded.push(id),
  } as unknown as DocumentService;
  const openDoc = (path: VPath, modified: boolean) =>
    open.push({ id: `doc-${open.length + 1}`, path, modified } as DocumentState);

  const deps: RestoreFlowDeps = {
    history,
    dialogs,
    documents,
    placeShort: (path) => path.replace(/^\/browser/, 'My Programs'),
    vfs,
  };

  /** P3.2.2's delete through guard: the unchanged files of `seen`, then the empty folders. */
  const remove = async (path: VPath) => {
    const result = await history.guard(
      path,
      'delete',
      async (seen: readonly SeenFile[]) => {
        for (const file of seen) await vfs.remove(file.path);
        const stat = await vfs.stat(path);
        if (stat) await vfs.remove(path);
      },
      async () => false,
    );
    expect(result.outcome).toBe('kept');
    return { id: result.item as string, path };
  };
  const write = (path: VPath, data: string) => vfs.writeFile(path, text(data));
  const read = async (path: VPath) => decode(await vfs.readFile(path));
  return { vfs, history, setHistory, boxes, answers, deps, openDoc, reloaded, remove, write, read };
}

describe('restoreWithQuestions against the store (P3.3.8)', () => {
  it(
    'a free place: the file is written back, nothing is asked, and it leaves the Trash',
    async () => {
      const t = setup();
      await t.write('/browser/prog.X68', 'one');
      const item = await t.remove('/browser/prog.X68');
      const result = await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(result).toEqual({ restored: ['/browser/prog.X68'], left: [], lost: [], gone: [] });
      expect(await t.read('/browser/prog.X68')).toBe('one');
      expect(t.boxes).toEqual([]);
      expect(await t.history.trashItems()).toEqual([]);
    },
    SLOW,
  );

  it(
    'restore into an occupied place asks; Yes puts the file there into the Trash as Replaced',
    async () => {
      const t = setup();
      await t.write('/browser/demo/prog.X68', 'old');
      const item = await t.remove('/browser/demo/prog.X68');
      await t.write('/browser/demo/prog.X68', 'new');
      t.answers.push('Yes');
      const result = await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(result.restored).toEqual(['/browser/demo/prog.X68']);
      expect(t.boxes).toEqual([
        {
          title: 'Restore',
          text: existsQuestion('My Programs/demo/prog.X68', 'prog (restored).X68', true),
          icon: 'confirmation',
          buttons: ['Yes', 'No', 'Cancel'],
        },
      ]);
      expect(await t.read('/browser/demo/prog.X68')).toBe('old');
      const trash = await t.history.trashItems();
      expect(trash.map((i) => [i.path, i.cause])).toEqual([['/browser/demo/prog.X68', 'replaced']]);
    },
    SLOW,
  );

  it(
    'No keeps both: the restored file is named "(restored)", then "(restored 2)"',
    async () => {
      const t = setup();
      await t.write('/browser/prog.X68', 'old');
      const first = await t.remove('/browser/prog.X68');
      await t.write('/browser/prog.X68', 'v2');
      const second = await t.remove('/browser/prog.X68');
      await t.write('/browser/prog.X68', 'now');
      t.answers.push('No');
      await restoreWithQuestions(t.deps, [first], 'Restore');
      expect(await t.read(`/browser/${restoredName('prog.X68', 1)}`)).toBe('old');
      t.answers.push('No');
      await restoreWithQuestions(t.deps, [second], 'Restore');
      expect(t.boxes[1]?.text).toBe(existsQuestion('My Programs/prog.X68', 'prog (restored 2).X68', true));
      expect(await t.read('/browser/prog (restored 2).X68')).toBe('v2');
      expect(await t.read('/browser/prog.X68')).toBe('now');
      expect(await t.history.trashItems()).toEqual([]);
    },
    SLOW,
  );

  it(
    'Cancel stops: nothing is written, the item and every later item stay in the Trash',
    async () => {
      const t = setup();
      await t.write('/browser/a.X68', 'a');
      await t.write('/browser/b.X68', 'b');
      const a = await t.remove('/browser/a.X68');
      const b = await t.remove('/browser/b.X68');
      await t.write('/browser/a.X68', 'a now');
      t.answers.push('Cancel');
      const result = await restoreWithQuestions(t.deps, [a, b], 'Restore');
      expect(result.restored).toEqual([]);
      expect(result.left).toEqual(['/browser/a.X68']);
      expect(await t.read('/browser/a.X68')).toBe('a now');
      expect(await t.vfs.stat('/browser/b.X68')).toBeNull();
      expect((await t.history.trashItems()).length).toBe(2);
    },
    SLOW,
  );

  it(
    'a file open and modified is skipped with its message (guard does not run), one open and unmodified is reloaded',
    async () => {
      const t = setup();
      await t.write('/browser/demo/a.X68', 'a');
      await t.write('/browser/demo/b.X68', 'b');
      const item = await t.remove('/browser/demo');
      await t.write('/browser/demo/a.X68', 'a edited elsewhere');
      t.openDoc('/browser/demo/a.X68', true);
      t.openDoc('/browser/demo/b.X68', false);
      const guard = vi.spyOn(t.history, 'guard');
      const result = await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(guard).not.toHaveBeenCalled();
      expect(result.restored).toEqual(['/browser/demo/b.X68']);
      expect(result.left).toEqual(['/browser/demo/a.X68']);
      expect(t.boxes.map((box) => box.text)).toEqual([unsavedChanges('a.X68'), partlyRestored(1, 2, 0)]);
      expect(t.boxes[0]).toMatchObject({ title: 'Restore', icon: 'information', buttons: ['OK'] });
      expect(t.reloaded).toEqual(['doc-2']);
      expect(await t.read('/browser/demo/a.X68')).toBe('a edited elsewhere');
      expect((await t.history.trashItems()).map((i) => i.files)).toEqual([1]);
    },
    SLOW,
  );

  it(
    'a partial restore of 5 files ends with "2 of 5 files were restored. ..."',
    async () => {
      const t = setup();
      for (const name of ['a', 'b', 'c', 'd', 'e']) await t.write(`/browser/demo/${name}.X68`, name);
      const item = await t.remove('/browser/demo');
      for (const name of ['a', 'b', 'c']) t.openDoc(`/browser/demo/${name}.X68`, true);
      const result = await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(result.restored.length).toBe(2);
      expect(t.boxes.at(-1)?.text).toBe('2 of 5 files were restored. The others are still in the Trash.');
    },
    SLOW,
  );

  it(
    'an item that is gone shows P3.2.7 text, titled as asked',
    async () => {
      const t = setup();
      await t.write('/browser/prog.X68', 'x');
      const item = await t.remove('/browser/prog.X68');
      await t.history.dropTrash([item.id]);
      const result = await restoreWithQuestions(t.deps, [item], 'Undo');
      expect(result.gone).toEqual(['/browser/prog.X68']);
      expect(t.boxes).toEqual([
        { title: 'Undo', text: noLongerInTrash('My Programs/prog.X68'), icon: 'information', buttons: ['OK'] },
      ]);
    },
    SLOW,
  );

  it(
    'with the switch off the replace question says "This cannot be undone." and no second question follows',
    async () => {
      const t = setup();
      await t.write('/browser/prog.X68', 'old');
      const item = await t.remove('/browser/prog.X68');
      await t.write('/browser/prog.X68', 'now');
      t.setHistory(false);
      expect(t.history.state()).toBe('off');
      t.answers.push('Yes');
      const result = await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(result.restored).toEqual(['/browser/prog.X68']);
      expect(t.boxes.map((box) => box.text)).toEqual([
        existsQuestion('My Programs/prog.X68', 'prog (restored).X68', false),
      ]);
      expect(t.boxes[0]?.text).toContain('This cannot be undone.');
      // Its Yes cannot be undone: No (keep both) has the focus (decided by the architect, errata N4).
      expect(t.boxes[0]).toMatchObject({ buttons: ['Yes', 'No', 'Cancel'], defaultButton: 'No' });
      expect(await t.read('/browser/prog.X68')).toBe('old');
      // Written without a copy: nothing of the file that was there went to the Trash.
      expect(await t.history.trashItems()).toEqual([]);
    },
    SLOW,
  );

  it(
    'states other than ready, also No: the current bytes stay and the item is written beside',
    async () => {
      const t = setup();
      await t.write('/browser/prog.X68', 'old');
      const item = await t.remove('/browser/prog.X68');
      await t.write('/browser/prog.X68', 'now');
      t.setHistory(false);
      t.answers.push('No');
      await restoreWithQuestions(t.deps, [item], 'Restore');
      expect(await t.read('/browser/prog.X68')).toBe('now');
      expect(await t.read('/browser/prog (restored).X68')).toBe('old');
      expect(t.boxes.length).toBe(1);
    },
    SLOW,
  );

  it(
    'an item of a store that is not mounted offers My Programs/Restored: an opened folder, the desktop disk',
    async () => {
      const t = setup();
      for (const [mount, kind, label] of [
        ['folder', 'fsaccess', 'Lab'],
        ['disk', 'disk', 'Disk'],
      ] as const) {
        const backend = new MemoryBackend({ mount, kind, label });
        t.vfs.mount(backend);
        const path = `/${mount}/lab/prog.X68` as VPath;
        await t.write(path, mount);
        const item = await t.remove(path);
        t.vfs.unmount(mount);
        const listed = (await t.history.trashItems()).find((i) => i.id === item.id);
        expect(listed?.restorableInPlace).toBe(false);
        t.boxes.length = 0;
        t.answers.push('No');
        const declined = await restoreWithQuestions(t.deps, [item], 'Restore');
        expect(declined.restored).toEqual([]);
        expect(t.boxes[0]).toEqual({
          title: 'Restore',
          text:
            mount === 'folder'
              ? folderNotOpen('prog.X68', 'Lab') // the folder's own name, from the store (P3.3.8)
              : placeUnreachable('prog.X68', t.deps.placeShort(`/${mount}/lab` as VPath)),
          icon: 'confirmation',
          buttons: ['Yes', 'No'],
        });
        t.answers.push('Yes');
        const restored = await restoreWithQuestions(t.deps, [item], 'Restore');
        expect(restored.restored.length).toBe(1);
        expect(restored.restored[0]?.startsWith(`${RESTORED_FALLBACK}/`)).toBe(true);
        expect(await t.read(restored.restored[0] as VPath)).toBe(mount);
      }
    },
    SLOW,
  );

  it(
    'gives the same results for the dialog (Restore) and for a call as the Files panel Undo makes it',
    async () => {
      const outcomes = [];
      for (const title of ['Restore', 'Undo'] as const) {
        const t = setup();
        await t.write('/browser/demo/a.X68', 'a');
        await t.write('/browser/demo/b.X68', 'b');
        await t.write('/browser/c.X68', 'c');
        const demo = await t.remove('/browser/demo');
        const c = await t.remove('/browser/c.X68');
        t.openDoc('/browser/demo/a.X68', true);
        const result = await restoreWithQuestions(t.deps, [demo, c], title);
        outcomes.push({ result, texts: t.boxes.map((box) => box.text), titles: t.boxes.map((box) => box.title) });
      }
      expect(outcomes[0]?.result).toEqual(outcomes[1]?.result);
      expect(outcomes[0]?.texts).toEqual(outcomes[1]?.texts);
      expect(outcomes[0]?.titles.every((title) => title === 'Restore')).toBe(true);
      expect(outcomes[1]?.titles.every((title) => title === 'Undo')).toBe(true);
    },
    SLOW,
  );
});

describe('restoreWithQuestions with a scripted restoreTrash', () => {
  function scripted(restoreTrash: HistoryService['restoreTrash'], state: HistoryService['state'] = () => 'ready') {
    const boxes: MessageBoxRequest[] = [];
    const answers: string[] = [];
    const deps: RestoreFlowDeps = {
      history: { restoreTrash, state } as unknown as HistoryService,
      dialogs: {
        messageBox: async (request: MessageBoxRequest) => (boxes.push(request), answers.shift() ?? 'OK'),
      } as unknown as DialogService,
      documents: { list: () => [], reload: async () => {} } as unknown as DocumentService,
      placeShort: (path) => path.replace('/browser', 'My Programs'),
    };
    return { deps, boxes, answers };
  }

  it('files lost to another window meanwhile: the sentences of P3.3.8', async () => {
    for (const [lost, sentence] of [
      [1, '1 of the others is no longer in the Trash.'],
      [2, '2 of the others are no longer in the Trash.'],
      [3, 'The others are no longer in the Trash.'],
    ] as const) {
      const left = (['/browser/x', '/browser/y', '/browser/z'] as VPath[]).slice(lost);
      const lostPaths = (['/browser/x', '/browser/y', '/browser/z'] as VPath[]).slice(0, lost);
      const t = scripted(async () => ({
        restored: ['/browser/a', '/browser/b'],
        left,
        lost: lostPaths,
        gone: false,
      }));
      const result = await restoreWithQuestions(t.deps, [{ id: '1', path: '/browser/demo' }], 'Restore');
      expect(result.lost).toEqual(lostPaths);
      expect(t.boxes.map((box) => box.text)).toEqual([`2 of 5 files were restored. ${sentence}`]);
    }
  });

  it('a failed write shows its message as an error and ends the item', async () => {
    const t = scripted(async () => ({
      restored: [],
      left: ['/browser/a'],
      lost: [],
      gone: false,
      error: 'The disk is full.',
    }));
    await restoreWithQuestions(t.deps, [{ id: '1', path: '/browser/a' }], 'Undo');
    expect(t.boxes).toEqual([{ title: 'Undo', text: 'The disk is full.', icon: 'error', buttons: ['OK'] }]);
  });

  it('confirm asks the question of P3.3.4 when the replace question promised the Trash', async () => {
    const t = scripted(async (_id, options) => {
      expect(await options.ask('/browser/prog.X68')).toBe('replace');
      expect(await options.confirm('/browser/prog.X68')).toBe(false);
      return { restored: [], left: ['/browser/prog.X68'], lost: [], gone: false };
    });
    t.answers.push('Yes', 'No');
    await restoreWithQuestions(t.deps, [{ id: '1', path: '/browser/prog.X68' }], 'Restore');
    // No has the focus (P3.3.4; MessageBoxRequest.defaultButton of docs/requests/N5-default-button.md).
    expect(t.boxes[1]).toEqual({
      title: 'Restore',
      text: cannotKeepQuestion('replace', 'prog.X68', false),
      icon: 'warning',
      buttons: ['Yes', 'No'],
      defaultButton: 'No',
    });
  });

  it('in state tight or unavailable: the replace question says it cannot be undone and confirm answers Yes', async () => {
    for (const state of ['tight', 'unavailable'] as const) {
      const t = scripted(
        async (_id, options) => {
          expect(await options.ask('/browser/prog.X68')).toBe('replace');
          expect(await options.confirm('/browser/prog.X68')).toBe(true);
          return { restored: ['/browser/prog.X68'], left: [], lost: [], gone: false };
        },
        () => state,
      );
      t.answers.push('Yes');
      await restoreWithQuestions(t.deps, [{ id: '1', path: '/browser/prog.X68' }], 'Restore');
      expect(t.boxes.map((box) => box.text)).toEqual([
        existsQuestion('My Programs/prog.X68', 'prog (restored).X68', false),
      ]);
      expect(t.boxes[0]?.defaultButton).toBe('No');
    }
  });
});

describe('texts of a restore (P3.3.8, P3.2.7)', () => {
  it('word for word', () => {
    expect(existsQuestion('demo/prog.X68', 'prog (restored).X68', true)).toBe(
      '"demo/prog.X68" exists. Replace it with the one from the Trash? The file there now goes to the Trash. Choose No to keep both: the restored file is named "prog (restored).X68".',
    );
    expect(existsQuestion('demo/prog.X68', 'prog (restored).X68', false)).toBe(
      '"demo/prog.X68" exists. Replace it with the one from the Trash? This cannot be undone. Choose No to keep both: the restored file is named "prog (restored).X68".',
    );
    expect(restoredName('prog.X68', 1)).toBe('prog (restored).X68');
    expect(restoredName('prog.X68', 2)).toBe('prog (restored 2).X68');
    expect(restoredName('README', 3)).toBe('README (restored 3)');
    expect(unsavedChanges('prog.X68')).toBe(
      '"prog.X68" has changes that are not saved. Save it or close it first, then restore.',
    );
    expect(folderNotOpen('prog.X68', 'Lab')).toBe(
      '"prog.X68" was in the folder "Lab", which is not open. Restore it into My Programs/Restored instead? Choose No to leave it in the Trash.',
    );
    expect(placeUnreachable('prog.X68', '/Users/me/Lab')).toBe(
      '"prog.X68" was in "/Users/me/Lab", which EASy68K cannot reach now. Restore it into My Programs/Restored instead? Choose No to leave it in the Trash.',
    );
    expect(noLongerInTrash('prog.X68')).toBe('"prog.X68" cannot be brought back: it is no longer in the Trash.');
  });

  it('a partial restore', () => {
    expect(partlyRestored(2, 5, 0)).toBe('2 of 5 files were restored. The others are still in the Trash.');
    expect(partlyRestored(2, 5, 1)).toBe('2 of 5 files were restored. 1 of the others is no longer in the Trash.');
    expect(partlyRestored(2, 5, 2)).toBe('2 of 5 files were restored. 2 of the others are no longer in the Trash.');
    expect(partlyRestored(2, 5, 3)).toBe('2 of 5 files were restored. The others are no longer in the Trash.');
  });
});
