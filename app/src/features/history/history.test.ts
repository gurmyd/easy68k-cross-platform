// The feature `history` under Node (ARCHITECTURE-PLUS P3.3.3, P3.3.4, P3.3.7, P3.3.8; the unit list
// of P5 N4): recording from DocumentService.onWritten, the storage-tight toast, Earlier Versions'
// Restore, what the two dialogs show, the Trash's questions, the commands and the texts.
//
// The history is the real store (createMemoryHistoryService of fs/history-memory.ts, which
// createTestApplication registers); the document service is the real one (features/documents)
// where a test saves and opens, and a small fake where a test needs an event the real one cannot
// give (a time, a binary file) or a document in a particular state.

import { describe, expect, it, vi } from 'vitest';
import type {
  AppContext,
  Bytes,
  DialogService,
  DocumentService,
  DocumentState,
  HistoryService,
  HistoryState,
  MessageBoxRequest,
  SeenFile,
  Settings,
  SettingsService,
  VersionInfo,
  VPath,
} from '../../contracts';
import { formatSize } from '../../core/history/size';
import {
  DELETE_HISTORY_BUTTON,
  DELETE_HISTORY_QUESTION,
  STORAGE_TIGHT_TOAST,
  cannotKeepQuestion,
  changedWhileRestoring,
  historyNotChanged,
  historyUnreadable,
  unreadableEntries,
} from '../../core/history/texts';
import { VERSION_NO_LONGER_KEPT, unsavedChanges } from '../../core/trash-restore/texts';
import type { HistoryStore } from '../../fs/history-db';
import { createMemoryHistoryStore } from '../../fs/history-memory';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { createTestApplication } from '../../state/testing';
import { createDocumentService } from '../documents';
import { feature, versionsPathOf } from './index';
import { openAsNewDocument } from './open-as-new';
import { startRecording } from './recording';
import {
  CAUSE_SHOWN_AS,
  NOT_KEPT_GENERATED,
  NOT_KEPT_GIT,
  NOT_KEPT_LARGE_OR_BINARY,
  NO_VERSIONS_YET,
  REASON_SHOWN_AS,
  SWITCHED_OFF_LINE,
  TRASH_DIALOG_ID,
  TRASH_EMPTY,
  VERSIONS_DIALOG_ID,
  deleteForGoodQuestion,
  emptyTrashQuestion,
  versionsTitle,
} from './texts';
import { REARM_FREE_BYTES, startTightNotice } from './tight-notice';
import { deleteForGood, deleteHistoryAndTrash, describeTrash, emptyTrash, trashRow } from './trash';
import { describeVersions, loadVersions, newDocumentText, restoreVersion, type notKeptSentence } from './versions';

const SLOW = 60_000;
const MB = 1024 * 1024;
const text = (s: string): Bytes => new TextEncoder().encode(s);
const decode = (b: Bytes) => new TextDecoder().decode(b);
/** Lets queued tasks, the onWritten reaction and the store's queue finish. */
async function settle(history: HistoryService | undefined): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await (history as HistoryStore | undefined)?.settled?.();
  }
}

/* ------------------------------------------------------------------ recording (P3.3.3) */

/** A test application with the real documents and the real history, and this feature. */
function application() {
  const app = createTestApplication({ features: [feature], services: { createDocumentService } });
  const documents = app.ctx.documents as DocumentService & {
    registry: { dispatch(id: string, spec: { changes: { from: number; insert: string } }): void };
  };
  const history = app.ctx.history as HistoryService;
  const type = (id: string, insert: string) => documents.registry.dispatch(id, { changes: { from: 0, insert } });
  return { app, ctx: app.ctx, documents, history, type };
}

describe('recording from DocumentService.onWritten (P3.3.3)', () => {
  it(
    'a save of an open document records once with saved, the bytes written and the event time',
    async () => {
      const { ctx, documents, history, type } = application();
      await ctx.vfs.writeFile('/browser/prog.X68', text('A\r\n'));
      const doc = (await documents.open('/browser/prog.X68')) as DocumentState;
      await settle(history);
      type(doc.id, 'B');
      expect(await documents.save(doc.id)).toBe(true);
      await settle(history);
      const written = await ctx.vfs.readFile('/browser/prog.X68');
      const versions = await history.versions('/browser/prog.X68');
      expect(versions.map((v) => v.reason)).toEqual(['saved', 'opened']);
      expect(versions[0]?.time).toBe(ctx.clock.wallTime().getTime());
      expect(decode(await history.read('/browser/prog.X68', versions[0]!.seq))).toBe(decode(written));
      expect(decode(await history.read('/browser/prog.X68', versions[1]!.seq))).toBe('A\r\n');
    },
    SLOW,
  );

  it(
    'records with the time the event gives, in a task of its own that the writer never awaits',
    async () => {
      const t = fakeDocuments();
      const history = memoryHistory(t.vfs);
      const record = vi.spyOn(history, 'record');
      const stop = startRecording({ documents: t.documents, history });
      await t.vfs.writeFile('/browser/a.X68', text('one'));
      t.emit({ path: '/browser/a.X68', bytes: text('one'), reason: 'saved', time: 12345 });
      // Nothing happens in the writer's own call stack.
      expect(record).not.toHaveBeenCalled();
      await settle(history);
      expect(record).toHaveBeenCalledTimes(1);
      const [version] = await history.versions('/browser/a.X68');
      expect(version).toMatchObject({ reason: 'saved', time: 12345, size: 3 });
      stop();
      t.emit({ path: '/browser/a.X68', bytes: text('two'), reason: 'saved', time: 2 });
      await settle(history);
      expect(record).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );

  it(
    'opening records opened only when the bytes differ from the newest version',
    async () => {
      const { ctx, documents, history } = application();
      await ctx.vfs.writeFile('/browser/p.X68', text('same\r\n'));
      const first = (await documents.open('/browser/p.X68')) as DocumentState;
      await settle(history);
      await documents.close(first.id);
      const again = (await documents.open('/browser/p.X68')) as DocumentState;
      await settle(history);
      expect((await history.versions('/browser/p.X68')).map((v) => v.reason)).toEqual(['opened']);
      await documents.close(again.id);
      await ctx.vfs.writeFile('/browser/p.X68', text('changed\r\n'));
      await documents.open('/browser/p.X68');
      await settle(history);
      expect((await history.versions('/browser/p.X68')).map((v) => v.reason)).toEqual(['opened', 'opened']);
    },
    SLOW,
  );

  it(
    "a program's write (through the Vfs) to an open file and to a file that is not open records nothing",
    async () => {
      const { ctx, documents, history } = application();
      await ctx.vfs.writeFile('/browser/open.X68', text('open\r\n'));
      await documents.open('/browser/open.X68');
      await settle(history);
      const before = await history.versions('/browser/open.X68');
      // What the cached view of a 68000 program ends in: writes to the Vfs (P3.3.3).
      await ctx.vfs.writeFile('/browser/open.X68', text('written by a program'));
      await ctx.vfs.writeFile('/browser/other.X68', text('written by a program'));
      await ctx.vfs.appendFile('/browser/other.X68', text(' and appended'));
      await settle(history);
      expect(await history.versions('/browser/open.X68')).toEqual(before);
      expect(await history.versions('/browser/other.X68')).toEqual([]);
    },
    SLOW,
  );

  it(
    '.L68, .S68 (any letter case), files above 1 MB and binary files record nothing, and are not even queued',
    async () => {
      const t = fakeDocuments();
      const history = memoryHistory(t.vfs);
      const record = vi.spyOn(history, 'record');
      startRecording({ documents: t.documents, history });
      const big = new Uint8Array(MB + 1).fill(0x41);
      const binary = text('PK\u0003\u0004');
      binary.set([0], 2);
      const cases: [VPath, Bytes][] = [
        ['/browser/prog.L68', text('listing')],
        ['/browser/prog.s68', text('S00600004844521B')],
        ['/browser/big.X68', big],
        ['/browser/pic.bin', binary],
        ['/browser/.git/config', text('[core]')],
        ['/memory/x.X68', text('x')],
      ];
      for (const [path, bytes] of cases) {
        t.emit({ path, bytes, reason: 'saved', time: 1 });
        t.emit({ path, bytes, reason: 'opened', time: 1 });
      }
      await settle(history);
      expect(record).not.toHaveBeenCalled();
      for (const [path] of cases) expect(await history.versions(path)).toEqual([]);
    },
    SLOW,
  );

  it('without onWritten nothing is recorded, and nothing fails', () => {
    const history = { record: vi.fn() } as unknown as HistoryService;
    const stop = startRecording({ documents: {} as DocumentService, history });
    stop();
    expect(history.record).not.toHaveBeenCalled();
    expect(() => startRecording({ documents: {} as DocumentService })()).not.toThrow();
  });

  it(
    'a record that throws never reaches the writer',
    async () => {
      const t = fakeDocuments();
      const history = {
        untracked: () => null,
        record: vi.fn(() => Promise.reject(new Error('broken'))),
      } as unknown as HistoryService;
      startRecording({ documents: t.documents, history });
      expect(() => t.emit({ path: '/browser/a.X68', bytes: text('a'), reason: 'saved', time: 1 })).not.toThrow();
      await settle(undefined);
      expect(history.record).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );
});

/* ------------------------------------------------------------------ the storage-tight toast (P3.3.4) */

describe('the storage-tight toast (P3.3.4)', () => {
  function fakeHistory() {
    let state: HistoryState = 'ready';
    const listeners = new Set<() => void>();
    return {
      history: {
        state: () => state,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      } as unknown as HistoryService,
      set(next: HistoryState) {
        state = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  it(
    'appears once per window when the state becomes tight, stays until dismissed, comes back only after room and a second shortage',
    async () => {
      const h = fakeHistory();
      const toasts: { text: string; duration: number | undefined }[] = [];
      const dialogs = {
        toast: (toastText: string, _action: unknown, options?: { duration?: number }) =>
          toasts.push({ text: toastText, duration: options?.duration }),
      } as unknown as DialogService;
      let free = 10 * MB;
      const estimate = async () => ({ quota: 1000 * MB, usage: 1000 * MB - free });
      const stop = startTightNotice({ history: h.history, dialogs }, estimate);
      expect(toasts).toEqual([]);
      h.set('tight');
      expect(toasts).toEqual([{ text: STORAGE_TIGHT_TOAST, duration: 0 }]);
      h.set('tight');
      // Room again, but not above 64 MB: a second shortage shows nothing.
      free = 40 * MB;
      h.set('ready');
      await settle(undefined);
      h.set('tight');
      expect(toasts.length).toBe(1);
      // Free space above 64 MB seen, then a second shortage: shown again.
      free = REARM_FREE_BYTES + MB;
      h.set('ready');
      await settle(undefined);
      h.set('tight');
      expect(toasts.length).toBe(2);
      stop();
      h.set('ready');
      h.set('tight');
      expect(toasts.length).toBe(2);
    },
    SLOW,
  );

  it('a window that starts tight shows it once; without an estimate, leaving tight re-arms it', async () => {
    const h = fakeHistory();
    h.set('tight');
    const toasts: string[] = [];
    const dialogs = { toast: (toastText: string) => toasts.push(toastText) } as unknown as DialogService;
    startTightNotice({ history: h.history, dialogs }, null);
    expect(toasts).toEqual([STORAGE_TIGHT_TOAST]);
    h.set('off');
    h.set('tight');
    expect(toasts.length).toBe(2);
  });

  it('without a history nothing is watched', () => {
    expect(() => startTightNotice({ dialogs: {} as DialogService }, null)()).not.toThrow();
  });
});

/* ------------------------------------------------------------------ Earlier Versions: Restore (P3.3.8) */

/** A memory Vfs, the real store, a `history` switch, scripted boxes and fake open documents. */
function restoreSetup() {
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
  const clock = { now: () => time, wallTime: () => new Date(time) };
  const history = createMemoryHistoryStore(
    { vfs, clock, scheduler: { setTimer: () => () => {}, onFrame: () => () => {} }, settings },
    { schedulePass: false },
  );
  const boxes: MessageBoxRequest[] = [];
  const answers: string[] = [];
  const dialogs = {
    messageBox: async (request: MessageBoxRequest) => (
      boxes.push(request),
      answers.shift() ?? (request.buttons.includes('OK') ? 'OK' : 'No')
    ),
  } as unknown as DialogService;
  const open: DocumentState[] = [];
  const reloaded: string[] = [];
  const documents = {
    list: () => open,
    reload: async (id: string) => void reloaded.push(id),
  } as unknown as DocumentService;
  const save = async (path: VPath, data: string) => {
    await vfs.writeFile(path, text(data));
    time += 600_000;
    await history.record(path, text(data), 'saved', time);
  };
  return {
    vfs,
    history,
    boxes,
    answers,
    open,
    reloaded,
    save,
    deps: { history, dialogs, documents, vfs },
    setHistory(on: boolean) {
      historyOn = on;
      for (const listener of listeners) listener();
    },
    read: async (path: VPath) => decode(await vfs.readFile(path)),
  };
}

describe("Earlier Versions' Restore (P3.3.8, P3.3.4)", () => {
  it(
    'writes the version, keeps "Before restore" first, and reloads an open, unmodified document',
    async () => {
      const t = restoreSetup();
      await t.save('/browser/p.X68', 'one');
      await t.save('/browser/p.X68', 'two');
      await t.vfs.writeFile('/browser/p.X68', text('three, not saved through the editor'));
      t.open.push({ id: 'd1', path: '/browser/p.X68', modified: false } as DocumentState);
      const [, older] = await t.history.versions('/browser/p.X68');
      expect(await restoreVersion(t.deps, '/browser/p.X68', older!.seq)).toBe('restored');
      expect(await t.read('/browser/p.X68')).toBe('one');
      const versions = await t.history.versions('/browser/p.X68');
      expect(versions[0]?.reason).toBe('before-restore');
      expect(decode(await t.history.read('/browser/p.X68', versions[0]!.seq))).toBe(
        'three, not saved through the editor',
      );
      expect(t.reloaded).toEqual(['d1']);
      expect(t.boxes).toEqual([]);
    },
    SLOW,
  );

  it(
    'of a modified document: the message, no copy is kept and nothing is written',
    async () => {
      const t = restoreSetup();
      await t.save('/browser/p.X68', 'one');
      await t.save('/browser/p.X68', 'two');
      t.open.push({ id: 'd1', path: '/browser/P.x68', modified: true } as DocumentState);
      const versions = await t.history.versions('/browser/p.X68');
      const guard = vi.spyOn(t.history, 'guard');
      expect(await restoreVersion(t.deps, '/browser/p.X68', versions[1]!.seq)).toBe('unsaved');
      expect(t.boxes).toEqual([
        { title: 'Restore', text: unsavedChanges('p.X68'), icon: 'information', buttons: ['OK'] },
      ]);
      expect(guard).not.toHaveBeenCalled();
      expect(await t.read('/browser/p.X68')).toBe('two');
      expect(await t.history.versions('/browser/p.X68')).toEqual(versions);
    },
    SLOW,
  );

  it('reads the chosen version before it calls guard', async () => {
    const calls: string[] = [];
    const history = {
      read: async () => (calls.push('read'), text('v')),
      guard: async (_p: VPath, how: string, act: (seen: SeenFile[]) => Promise<void>) => {
        calls.push(`guard ${how}`);
        await act([]);
        return { outcome: 'kept' as const };
      },
    } as unknown as HistoryService;
    const vfs = { stat: async () => null, writeFile: async () => void calls.push('write') };
    const deps = {
      history,
      vfs,
      dialogs: { messageBox: async () => 'OK' },
      documents: { list: () => [], reload: async () => {} },
    } as unknown as Parameters<typeof restoreVersion>[0];
    expect(await restoreVersion(deps, '/browser/p.X68', 1)).toBe('restored');
    expect(calls).toEqual(['read', 'guard restore', 'write']);
  });

  it(
    'a version pruned since the list was shown: "This version is no longer kept."',
    async () => {
      const t = restoreSetup();
      await t.save('/browser/p.X68', 'one');
      expect(await restoreVersion(t.deps, '/browser/p.X68', 999)).toBe('gone');
      expect(t.boxes).toEqual([
        { title: 'Restore', text: VERSION_NO_LONGER_KEPT, icon: 'information', buttons: ['OK'] },
      ]);
      expect(await t.read('/browser/p.X68')).toBe('one');
    },
    SLOW,
  );

  it(
    'with the switch off: the question of P3.3.4; No leaves the bytes, Yes writes without a copy',
    async () => {
      const t = restoreSetup();
      await t.save('/browser/p.X68', 'one');
      await t.save('/browser/p.X68', 'two');
      t.setHistory(false);
      expect(t.history.state()).toBe('off');
      const versions = await t.history.versions('/browser/p.X68');
      // The versions kept before are still listed under the switched-off line.
      const view = describeVersions({ state: 'off', unreadable: 0, detail: '', rows: versions, reason: null });
      expect(view).toEqual({ kind: 'list', lines: [SWITCHED_OFF_LINE], rows: versions, empty: null });
      // No has the focus (P3.3.4; defaultButton as docs/requests/N5-default-button.md asks for it).
      const question: MessageBoxRequest & { defaultButton: 'No' } = {
        title: 'Restore',
        text: cannotKeepQuestion('restore', 'p.X68', false),
        icon: 'warning',
        buttons: ['Yes', 'No'],
        defaultButton: 'No',
      };
      t.answers.push('No');
      expect(await restoreVersion(t.deps, '/browser/p.X68', versions[1]!.seq)).toBe('declined');
      expect(t.boxes).toEqual([question]);
      expect(await t.read('/browser/p.X68')).toBe('two');
      t.answers.push('Yes');
      expect(await restoreVersion(t.deps, '/browser/p.X68', versions[1]!.seq)).toBe('restored');
      expect(t.boxes).toEqual([question, question]);
      expect(await t.read('/browser/p.X68')).toBe('one');
      // No copy: the versions are the ones from before.
      expect(await t.history.versions('/browser/p.X68')).toEqual(versions);
    },
    SLOW,
  );

  it('in states tight and unavailable: the same question, No leaves the bytes and Yes writes', async () => {
    for (const state of ['tight', 'unavailable'] as const) {
      let written: string | null = null;
      // The table of P4.4: guard keeps nothing and asks, then act.
      const history = {
        state: () => state,
        read: async () => text('earlier'),
        guard: async (
          _p: VPath,
          _how: string,
          act: (seen: SeenFile[]) => Promise<void>,
          confirm: () => Promise<boolean>,
        ) => {
          if (!(await confirm())) return { outcome: 'declined' as const };
          await act([{ path: '/browser/p.X68', mtime: 5, size: 3 }]);
          return { outcome: 'not-kept' as const };
        },
      } as unknown as HistoryService;
      const boxes: MessageBoxRequest[] = [];
      const answers = ['No', 'Yes'];
      const deps = {
        history,
        vfs: {
          stat: async () => ({ kind: 'file', mtime: 5, size: 3, readOnly: false }),
          writeFile: async (_p: VPath, data: Bytes) => void (written = decode(data)),
        },
        dialogs: { messageBox: async (box: MessageBoxRequest) => (boxes.push(box), answers.shift()) },
        documents: { list: () => [], reload: async () => {} },
      } as unknown as Parameters<typeof restoreVersion>[0];
      expect(await restoreVersion(deps, '/browser/p.X68', 1)).toBe('declined');
      expect(written).toBeNull();
      expect(await restoreVersion(deps, '/browser/p.X68', 1)).toBe('restored');
      expect(written).toBe('earlier');
      expect(boxes.map((box) => box.text)).toEqual([
        cannotKeepQuestion('restore', 'p.X68', false),
        cannotKeepQuestion('restore', 'p.X68', false),
      ]);
    }
  });

  it('a file that changed after guard read it is not written: the changed-while text', async () => {
    const history = {
      read: async () => text('earlier'),
      guard: async (_p: VPath, _how: string, act: (seen: SeenFile[]) => Promise<void>) => {
        await act([{ path: '/browser/p.X68', mtime: 5, size: 3 }]);
        return { outcome: 'kept' as const };
      },
    } as unknown as HistoryService;
    const writeFile = vi.fn();
    const boxes: MessageBoxRequest[] = [];
    const deps = {
      history,
      vfs: { stat: async () => ({ kind: 'file', mtime: 6, size: 3, readOnly: false }), writeFile },
      dialogs: { messageBox: async (box: MessageBoxRequest) => (boxes.push(box), 'OK') },
      documents: { list: () => [], reload: async () => {} },
    } as unknown as Parameters<typeof restoreVersion>[0];
    expect(await restoreVersion(deps, '/browser/p.X68', 1)).toBe('failed');
    expect(writeFile).not.toHaveBeenCalled();
    expect(boxes).toEqual([{ title: 'Restore', text: changedWhileRestoring('p.X68'), icon: 'error', buttons: ['OK'] }]);
  });
});

/* ------------------------------------------------------------------ what the dialogs show (P3.3.7, P3.3.8) */

describe('what Earlier Versions shows (P3.3.8, P3.3.7)', () => {
  const rows: VersionInfo[] = [{ seq: 2, time: 2, size: 10, reason: 'saved' }];

  it('each empty state, by the reason of untracked, the .git one included', () => {
    const empty = (reason: Parameters<typeof notKeptSentence>[0]) =>
      describeVersions({ state: 'ready', unreadable: 0, detail: '', rows: [], reason });
    expect(empty(null)).toEqual({ kind: 'list', lines: [], rows: [], empty: NO_VERSIONS_YET });
    expect(empty('generated')).toMatchObject({ empty: NOT_KEPT_GENERATED });
    expect(empty('too-large')).toMatchObject({ empty: NOT_KEPT_LARGE_OR_BINARY });
    expect(empty('not-text')).toMatchObject({ empty: NOT_KEPT_LARGE_OR_BINARY });
    expect(empty('git')).toMatchObject({ empty: NOT_KEPT_GIT });
  });

  it('versions that get no new ones: the matching sentence above the list', () => {
    expect(describeVersions({ state: 'ready', unreadable: 0, detail: '', rows, reason: 'too-large' })).toEqual({
      kind: 'list',
      lines: [NOT_KEPT_LARGE_OR_BINARY],
      rows,
      empty: null,
    });
  });

  it('switched off: the line, with the list when versions exist and alone without', () => {
    expect(describeVersions({ state: 'off', unreadable: 0, detail: '', rows, reason: null })).toEqual({
      kind: 'list',
      lines: [SWITCHED_OFF_LINE],
      rows,
      empty: null,
    });
    expect(describeVersions({ state: 'off', unreadable: 0, detail: '', rows: [], reason: null })).toEqual({
      kind: 'list',
      lines: [SWITCHED_OFF_LINE],
      rows: [],
      empty: null,
    });
  });

  it('a record that does not parse gives the count line; an unavailable history gives the message', () => {
    expect(describeVersions({ state: 'ready', unreadable: 3, detail: '', rows, reason: null })).toMatchObject({
      lines: [unreadableEntries(3)],
    });
    expect(
      describeVersions({
        state: 'unavailable',
        unreadable: 0,
        detail: 'the database did not open',
        rows,
        reason: null,
      }),
    ).toEqual({
      kind: 'unavailable',
      text: historyUnreadable('the database did not open'),
    });
    expect(describeTrash({ state: 'tight', unreadable: 1, detail: '', items: [] })).toEqual({
      kind: 'list',
      lines: [unreadableEntries(1)],
      items: [],
      empty: TRASH_EMPTY,
    });
    expect(describeTrash({ state: 'unavailable', unreadable: 0, detail: 'x', items: [] })).toEqual({
      kind: 'unavailable',
      text: historyUnreadable('x'),
    });
  });

  it('Open as New Document takes the version text without its font and tab trailer', () => {
    const version =
      'start\tNOP\n\tEND\tstart\n\n*~Font name~Courier New~\n*~Font size~10~\n*~Tab type~1~\n*~Tab size~8~\n';
    expect(newDocumentText(version)).toBe('start\tNOP\n\tEND\tstart\n\n');
    expect(newDocumentText('no trailer\n')).toBe('no trailer\n');
  });

  it(
    'the reasons come from the store for real paths',
    async () => {
      const t = restoreSetup();
      await t.vfs.writeFile('/browser/prog.L68', text('listing'));
      await t.vfs.writeFile('/browser/.git/HEAD', text('ref'));
      const big = new Uint8Array(MB + 10).fill(0x41);
      await t.vfs.writeFile('/browser/big.X68', big);
      expect((await loadVersions(t.deps, '/browser/prog.L68')).reason).toBe('generated');
      expect((await loadVersions(t.deps, '/browser/.git/HEAD')).reason).toBe('git');
      expect((await loadVersions(t.deps, '/browser/big.X68')).reason).toBe('too-large');
      expect((await loadVersions(t.deps, '/browser/none.X68')).reason).toBeNull();
    },
    SLOW,
  );
});

describe('the Trash (P3.3.8)', () => {
  const item = (id: string, bytes: number) => ({
    id,
    deletedAt: Date.UTC(2026, 10, 21, 9, 30),
    cause: 'deleted' as const,
    path: `/browser/demo/${id}.X68` as VPath,
    kind: 'file' as const,
    files: 1,
    bytes,
    restorableInPlace: true,
  });
  const asking = (answer: string) => {
    const boxes: MessageBoxRequest[] = [];
    return {
      boxes,
      dialogs: { messageBox: async (box: MessageBoxRequest) => (boxes.push(box), answer) } as unknown as DialogService,
    };
  };

  it('a row: Name, Was in, Why, When, Size (TrashItemInfo.bytes)', () => {
    const row = trashRow(
      { ...item('prog', 1536), cause: 'replaced' },
      (path) => path.replace('/browser', 'My Programs'),
      'en-GB',
    );
    expect(row).toMatchObject({
      name: 'prog.X68',
      wasIn: 'My Programs/demo',
      why: CAUSE_SHOWN_AS.replaced,
      size: '1.5 kB',
    });
    expect(row.when).toContain('2026');
  });

  it('Delete for Good asks, then drops the selected items', async () => {
    const dropTrash = vi.fn(async () => {});
    const { boxes, dialogs } = asking('Yes');
    expect(
      await deleteForGood({ history: { dropTrash } as unknown as HistoryService, dialogs }, [
        item('a', 1),
        item('b', 2),
      ]),
    ).toBe(true);
    expect(boxes).toEqual([
      {
        title: 'Delete for Good',
        text: 'Delete the 2 selected items for good?',
        icon: 'confirmation',
        buttons: ['Yes', 'No'],
      },
    ]);
    expect(dropTrash).toHaveBeenCalledWith(['a', 'b']);
    const no = asking('No');
    expect(
      await deleteForGood({ history: { dropTrash } as unknown as HistoryService, dialogs: no.dialogs }, [item('a', 1)]),
    ).toBe(false);
    expect(dropTrash).toHaveBeenCalledTimes(1);
  });

  it('Empty Trash asks with the count and size of the items listed, then drops them', async () => {
    const dropTrash = vi.fn(async () => {});
    const { boxes, dialogs } = asking('Yes');
    const listed = Array.from({ length: 12 }, (_, i) => item(`f${i}`, 0));
    listed[0]!.bytes = Math.round(1.4 * MB);
    await emptyTrash({ history: { dropTrash } as unknown as HistoryService, dialogs }, listed);
    expect(boxes[0]?.text).toBe('Delete everything in the Trash for good? (12 items, 1.4 MB)');
    expect(dropTrash).toHaveBeenCalledWith(listed.map((i) => i.id));
  });

  it('a drop the store could not make is shown under the command, not reported as done (errata N3)', async () => {
    const reason = historyNotChanged('the transaction was aborted');
    const dropTrash = vi.fn(async () => {
      throw new Error(reason);
    });
    const history = { dropTrash } as unknown as HistoryService;
    for (const [run, title] of [
      [
        (dialogs: Parameters<typeof deleteForGood>[0]['dialogs']) =>
          deleteForGood({ history, dialogs }, [item('a', 1)]),
        'Delete for Good',
      ],
      [
        (dialogs: Parameters<typeof emptyTrash>[0]['dialogs']) => emptyTrash({ history, dialogs }, [item('a', 1)]),
        'Empty Trash',
      ],
    ] as const) {
      const { boxes, dialogs } = asking('Yes');
      expect(await run(dialogs)).toBe(false);
      expect(boxes.at(-1)).toEqual({ title, text: reason, icon: 'error', buttons: ['OK'] });
    }
  });

  it('Delete History and Trash asks its question and runs deleteAll', async () => {
    const deleteAll = vi.fn(async () => {});
    const { boxes, dialogs } = asking('Yes');
    expect(await deleteHistoryAndTrash({ history: { deleteAll } as unknown as HistoryService, dialogs })).toBe(true);
    expect(boxes).toEqual([
      { title: DELETE_HISTORY_BUTTON, text: DELETE_HISTORY_QUESTION, icon: 'confirmation', buttons: ['Yes', 'No'] },
    ]);
    expect(deleteAll).toHaveBeenCalledTimes(1);
    const no = asking('No');
    await deleteHistoryAndTrash({ history: { deleteAll } as unknown as HistoryService, dialogs: no.dialogs });
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });

  it(
    'Delete History and Trash on the real store leaves every current file as it is',
    async () => {
      const t = restoreSetup();
      await t.save('/browser/p.X68', 'one');
      const { dialogs } = asking('Yes');
      await deleteHistoryAndTrash({ history: t.history, dialogs });
      expect(await t.read('/browser/p.X68')).toBe('one');
      expect(await t.history.versions('/browser/p.X68')).toEqual([]);
    },
    SLOW,
  );
});

/* ------------------------------------------------------------------ the commands (P3.6) */

describe('the commands ed.file.history and app.files.trash (P3.6)', () => {
  it(
    'Earlier Versions... is enabled for a document with a path outside /memory and opens history.versions',
    async () => {
      const { app, ctx, documents } = application();
      expect(app.commands.hasHandler('ed.file.history')).toBe(true);
      expect(app.commands.hasHandler('app.files.trash')).toBe(true);
      documents.newSource();
      expect(ctx.commands.isEnabled('ed.file.history')).toBe(false);
      await ctx.vfs.writeFile('/browser/p.X68', text('x'));
      await documents.open('/browser/p.X68');
      expect(ctx.commands.isEnabled('ed.file.history')).toBe(true);
      void ctx.commands.run('ed.file.history');
      await settle(undefined);
      expect(ctx.store.getState().dialogs.stack).toMatchObject([
        { id: VERSIONS_DIALOG_ID, props: { path: '/browser/p.X68' }, modal: true },
      ]);
      app.dialogs.close(ctx.store.getState().dialogs.stack[0]!.key, undefined);
      expect(versionsPathOf(ctx, { path: '/browser/other.X68' })).toBe('/browser/other.X68');
      expect(versionsPathOf(ctx, { path: '/memory/x.X68' })).toBeNull();
      expect(versionsPathOf(ctx, { path: '/browser' })).toBeNull();
      expect(ctx.commands.isEnabled('app.files.trash')).toBe(true);
      void ctx.commands.run('app.files.trash');
      await settle(undefined);
      expect(ctx.store.getState().dialogs.stack).toMatchObject([{ id: TRASH_DIALOG_ID, modal: true }]);
    },
    SLOW,
  );

  it(
    'Earlier Versions... with an explicit path opens the dialog for it, also while an untitled document is active',
    async () => {
      const { ctx, documents } = application();
      documents.newSource();
      // The menus ask without an argument: the untitled active document decides (P3.6).
      expect(ctx.commands.isEnabled('ed.file.history')).toBe(false);
      // The Files panel's context menu passes the row's path (N5): that path decides.
      expect(ctx.commands.isEnabled('ed.file.history', { path: '/browser/other.X68' })).toBe(true);
      expect(ctx.commands.isEnabled('ed.file.history', { path: '/memory/x.X68' })).toBe(false);
      expect(ctx.commands.isEnabled('ed.file.history', { path: '/browser' })).toBe(false);
      void ctx.commands.run('ed.file.history', { path: '/browser/other.X68' });
      await settle(undefined);
      expect(ctx.store.getState().dialogs.stack).toMatchObject([
        { id: VERSIONS_DIALOG_ID, props: { path: '/browser/other.X68' }, modal: true },
      ]);
    },
    SLOW,
  );

  it('Open as New Document uses DocumentService.newSourceWithText when there is one, else the editor', () => {
    const made: string[] = [];
    let registered = 0;
    const editorExtensions = {
      register: () => {
        registered++;
        return () => {};
      },
    } as unknown as AppContext['editorExtensions'];
    const doc = { id: 'd1', path: null, modified: true } as unknown as DocumentState;
    const withText = {
      newSource: () => (made.push('template'), doc),
      newSourceWithText: (text: string) => (made.push(text), doc),
    } as unknown as AppContext['documents'];
    expect(openAsNewDocument({ documents: withText, editorExtensions }, 'ORG $1000\n')).toBe(doc);
    expect([made, registered]).toEqual([['ORG $1000\n'], 0]);
    made.length = 0;
    const without = { newSource: () => (made.push('template'), doc) } as unknown as AppContext['documents'];
    expect(openAsNewDocument({ documents: without, editorExtensions }, 'ORG $1000\n')).toBe(doc);
    expect([made, registered]).toEqual([['template'], 1]);
  });

  it('without ctx.history both are disabled', () => {
    const app = createTestApplication({
      features: [feature],
      services: { createDocumentService, createHistoryService: undefined as never },
    });
    expect(app.ctx.history).toBeUndefined();
    expect(app.ctx.commands.isEnabled('app.files.trash')).toBe(false);
    expect(app.ctx.commands.isEnabled('ed.file.history')).toBe(false);
  });
});

/* ------------------------------------------------------------------ texts (P3.3.3, P3.3.8) */

describe('the texts of P3.3.3 and P3.3.8, exactly', () => {
  it('word for word', () => {
    expect(versionsTitle('prog.X68')).toBe('Earlier Versions of prog.X68');
    expect(REASON_SHOWN_AS).toEqual({
      saved: 'Saved',
      opened: 'As opened',
      'before-import': 'Before import',
      'before-restore': 'Before restore',
      'before-replace': 'Before replace',
      'before-delete': 'Before delete',
    });
    expect(NO_VERSIONS_YET).toBe(
      'No earlier versions are kept for this file yet. A version is kept each time you save it.',
    );
    expect(NOT_KEPT_GENERATED).toBe(
      'Earlier versions are not kept for listing and S-record files: Assemble makes them again.',
    );
    expect(NOT_KEPT_LARGE_OR_BINARY).toBe(
      'Earlier versions are not kept for files larger than 1 MB or for files that are not text.',
    );
    expect(NOT_KEPT_GIT).toBe('Earlier versions are not kept for files in a .git folder.');
    expect(SWITCHED_OFF_LINE).toBe(
      'Keeping earlier versions is switched off (Options > Port Additions...). Versions kept before are listed below.',
    );
    expect(deleteForGoodQuestion(2)).toBe('Delete the 2 selected items for good?');
    expect(emptyTrashQuestion(12, formatSize(Math.round(1.4 * MB)))).toBe(
      'Delete everything in the Trash for good? (12 items, 1.4 MB)',
    );
    expect(TRASH_EMPTY).toBe(
      'The Trash is empty. Files you delete in the Files panel stay here for up to 30 days; when the Trash is full, the oldest go first.',
    );
    expect(CAUSE_SHOWN_AS).toEqual({ deleted: 'Deleted', replaced: 'Replaced' });
  });
});

/* ------------------------------------------------------------------ helpers */

function memoryHistory(vfs: ReturnType<typeof createVfs>): HistoryStore {
  return createMemoryHistoryStore(
    {
      vfs,
      clock: { now: () => 0, wallTime: () => new Date(0) },
      scheduler: { setTimer: () => () => {}, onFrame: () => () => {} },
    },
    { schedulePass: false },
  );
}

/** A DocumentService with nothing but onWritten, whose events the test emits. */
function fakeDocuments() {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' }));
  vfs.mount(new MemoryBackend());
  type Event = { path: VPath; bytes: Bytes; reason: 'saved' | 'opened'; time: number };
  const listeners = new Set<(event: Event) => void>();
  const documents = {
    onWritten(listener: (event: Event) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as DocumentService;
  return { vfs, documents, emit: (event: Event) => listeners.forEach((listener) => listener(event)) };
}
