// The feature "additions" under Node (ARCHITECTURE-PLUS P3.5): every text, the command and its
// argument, OK and Cancel, the figures with and without an estimate and in the desktop app, and the
// two buttons against the real history store (createMemoryHistoryService, N3) and against fakes
// where a test needs a particular answer. Owner: N7.

import { describe, expect, it, vi } from 'vitest';
import type { HistoryService, HistoryUsage, MessageBoxRequest, TrashItemInfo } from '../../contracts';
import { readPlus } from '../../core/plus/settings';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { applyAdditions, changedSwitches, deleteEarlierVersions, emptyTrash, focusOf, showAdditions } from './actions';
import { countFiles, readFigures, storageLines, type StorageFigures } from './figures';
import * as T from './texts';

const encode = (text: string) => new TextEncoder().encode(text);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function application(options: Parameters<typeof createTestApplication>[0] = {}): TestApplication {
  return createTestApplication({ features: [feature], ...options });
}

/** The dialog on top of the window's stack. */
function top(app: TestApplication) {
  const stack = app.ctx.store.getState().dialogs.stack;
  const dialog = stack[stack.length - 1];
  if (!dialog) throw new Error('no dialog is open');
  return dialog;
}

/** Waits until a dialog with this id is on top (the history answers after a few turns). */
async function dialogOnTop(app: TestApplication, id: string) {
  for (let i = 0; i < 2000; i++) {
    const stack = app.ctx.store.getState().dialogs.stack;
    const last = stack[stack.length - 1];
    if (last && last.id === id) return last;
    await tick();
  }
  throw new Error(`no dialog ${id} came up`);
}

/** A HistoryService whose answers a test sets; every member is a spy. */
function fakeHistory(answers: { usage?: HistoryUsage; items?: TrashItemInfo[] } = {}): HistoryService {
  return {
    state: () => 'ready',
    untracked: () => null,
    record: vi.fn(async () => {}),
    guard: vi.fn(async () => ({ outcome: 'kept' as const })),
    versions: vi.fn(async () => []),
    read: vi.fn(async () => new Uint8Array()),
    trashItems: vi.fn(async () => answers.items ?? []),
    restoreTrash: vi.fn(async () => ({ restored: [], left: [], lost: [], gone: true })),
    dropTrash: vi.fn(async () => {}),
    moved: vi.fn(async () => {}),
    clearVersions: vi.fn(async () => {}),
    deleteAll: vi.fn(async () => {}),
    usage: vi.fn(
      async () => answers.usage ?? { versions: 0, versionBytes: 0, trashItems: 0, trashBytes: 0, budget: 64 << 20 },
    ),
    subscribe: () => () => {},
  };
}

const item = (id: string, bytes: number): TrashItemInfo => ({
  id,
  deletedAt: 0,
  cause: 'deleted',
  path: `/browser/${id}.X68`,
  kind: 'file',
  files: 1,
  bytes,
  restorableInPlace: true,
});

/** A test application whose context has `history` replaced by a fake. */
function withHistory(history: HistoryService | undefined, kind: 'web' | 'desktop' = 'web') {
  return application({
    platform: createFakePlatform({ kind }),
    // Without a history: the factory is taken away from the stub services (ctx.history is undefined).
    services: history
      ? { createHistoryService: () => history }
      : ({ createHistoryService: undefined } as unknown as { createHistoryService: () => HistoryService }),
  });
}

/* ================================================================ texts */

describe('the texts of P3.5, exactly', () => {
  it('title, boxes, group, labels, buttons and questions', () => {
    expect(T.ADDITIONS_DIALOG_ID).toBe('plus.options');
    expect(T.ADDITIONS_COMMAND).toBe('app.additions.options');
    expect(T.ADDITIONS_TITLE).toBe('Port Additions');
    expect(T.VIEWER_CAPTION).toBe('&Show PDF files and pictures in a viewer instead of as text');
    expect(T.HISTORY_CAPTION).toBe('&Keep earlier versions of saved files and a Trash for deleted files');
    expect(T.STORAGE_GROUP_CAPTION).toBe('Storage');
    expect([T.MY_PROGRAMS_LABEL, T.EARLIER_VERSIONS_LABEL, T.TRASH_LABEL]).toEqual([
      'My Programs:',
      'Earlier versions:',
      'Trash:',
    ]);
    expect(T.CLEARING_SITE_DATA).toBe(
      "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.",
    );
    expect(T.DESKTOP_STORAGE_LINE).toBe("Earlier versions and Trash are kept in the app's own storage.");
    expect([T.EMPTY_TRASH_CAPTION, T.DELETE_VERSIONS_CAPTION, T.OK_CAPTION, T.CANCEL_CAPTION]).toEqual([
      'Empty Trash',
      'Delete Earlier Versions',
      'OK',
      'Cancel',
    ]);
    expect(T.DELETE_VERSIONS_QUESTION).toBe(
      'Delete all earlier versions of all files for good? Your current files are not affected.',
    );
    expect(T.TRASH_EMPTY_TEXT).toBe(
      'The Trash is empty. Files you delete in the Files panel stay here for up to 30 days; when the Trash is full, the oldest go first.',
    );
  });

  it('the figures as P3.5 writes them (sizes by formatSize, P3.2.6)', () => {
    expect(T.filesFigure(37, 3.4 * 1024 * 1024)).toBe('37 files, 3.4 MB');
    expect(T.versionsFigure(212, 0.9 * 1024 * 1024)).toBe('212 versions, 921.6 kB');
    expect(T.trashFigure(4, 0.3 * 1024 * 1024)).toBe('4 items, 307.2 kB');
    expect(T.siteUsageLine(7.9 * 1024 * 1024, 1.8 * 1024 ** 3)).toBe(
      'This site uses 7.9 MB in this browser, about 1.8 GB free',
    );
    expect(T.siteUsageLine(7.9 * 1024 * 1024, null)).toBe('This site uses 7.9 MB in this browser');
    expect(T.emptyTrashQuestion(12, 1.4 * 1024 * 1024)).toBe(
      'Delete everything in the Trash for good? (12 items, 1.4 MB)',
    );
  });

  it('one of a thing is singular; zero is plural', () => {
    expect(T.filesFigure(1, 1)).toBe('1 file, 1 byte');
    expect(T.versionsFigure(1, 2048)).toBe('1 version, 2.0 kB');
    expect(T.trashFigure(1, 0)).toBe('1 item, 0 bytes');
    expect(T.trashFigure(0, 0)).toBe('0 items, 0 bytes');
    expect(T.emptyTrashQuestion(1, 10)).toBe('Delete everything in the Trash for good? (1 item, 10 bytes)');
  });
});

/* ================================================================ the command */

describe('app.additions.options', () => {
  it('has a handler, is always enabled, in both modes', async () => {
    const app = application();
    expect(app.commands.hasHandler(T.ADDITIONS_COMMAND)).toBe(true);
    expect(app.ctx.commands.isEnabled(T.ADDITIONS_COMMAND)).toBe(true);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(app.ctx.commands.isEnabled(T.ADDITIONS_COMMAND)).toBe(true);
  });

  it('opens the modal dialog plus.options with the stored switches; { group: "storage" } asks for the focus there', async () => {
    const app = application();
    app.ctx.settings.update((s) => ({ ...s, app: { ...s.app, plus: { viewer: false, history: true } } }));
    void app.ctx.commands.run(T.ADDITIONS_COMMAND);
    let dialog = top(app);
    expect(dialog.id).toBe('plus.options');
    expect(dialog.modal).toBe(true);
    expect(dialog.props).toEqual({ initial: { viewer: false, history: true }, focus: null });
    app.dialogs.close(dialog.key, null);
    await tick();

    void app.ctx.commands.run(T.ADDITIONS_COMMAND, { group: 'storage' });
    dialog = top(app);
    expect(dialog.props).toEqual({ initial: { viewer: false, history: true }, focus: 'storage' });
    app.dialogs.close(dialog.key, null);
  });

  it('reads only { group: "storage" } as the storage argument', () => {
    expect(focusOf({ group: 'storage' })).toBe('storage');
    for (const other of [undefined, null, 'storage', {}, { group: 'other' }, { group: true }]) {
      expect(focusOf(other)).toBe(null);
    }
  });

  it('OK stores app.plus; Cancel stores nothing', async () => {
    const app = application();
    let done = showAdditions(app.ctx);
    app.dialogs.close(top(app).key, { viewer: true, history: false });
    await done;
    expect(app.ctx.settings.get().app.plus).toEqual({ viewer: true, history: false });

    done = showAdditions(app.ctx);
    app.dialogs.close(top(app).key, null);
    await done;
    expect(app.ctx.settings.get().app.plus).toEqual({ viewer: true, history: false });

    done = showAdditions(app.ctx);
    app.dialogs.close(top(app).key, { viewer: false, history: true });
    await done;
    expect(readPlus(app.ctx.settings.get())).toEqual({ viewer: false, history: true });
  });

  it('Cancel on a fresh window leaves app.plus absent', async () => {
    const app = application();
    const done = showAdditions(app.ctx);
    app.dialogs.close(top(app).key, null);
    await done;
    expect(app.ctx.settings.get().app.plus).toBeUndefined();
  });

  it('OK writes only the switches the student changed, so another window keeps its change of the other', () => {
    expect(changedSwitches({ viewer: true, history: true }, { viewer: true, history: true })).toEqual({});
    expect(changedSwitches({ viewer: true, history: true }, { viewer: false, history: true })).toEqual({
      viewer: false,
    });
    const app = application();
    // Another window switched history off while this dialog was open.
    app.ctx.settings.update((s) => ({ ...s, app: { ...s.app, plus: { viewer: true, history: false } } }));
    applyAdditions(app.ctx, { viewer: true, history: true }, { viewer: false, history: true });
    expect(app.ctx.settings.get().app.plus).toEqual({ viewer: false, history: false });
  });

  it('the history switch reaches the store: off makes state() "off"', async () => {
    const app = application();
    expect(app.ctx.history!.state()).toBe('ready');
    applyAdditions(app.ctx, { viewer: true, history: true }, { viewer: true, history: false });
    await tick();
    expect(app.ctx.history!.state()).toBe('off');
  });
});

/* ================================================================ the figures */

const FIGURES: StorageFigures = {
  myPrograms: { files: 37, bytes: 3.4 * 1024 * 1024 },
  versions: 212,
  versionBytes: 0.9 * 1024 * 1024,
  trashItems: 4,
  trashBytes: 0.3 * 1024 * 1024,
  site: { usage: 7.9 * 1024 * 1024, free: 1.8 * 1024 ** 3 },
  desktop: false,
};
const texts = (figures: StorageFigures) =>
  storageLines(figures).map((line) => (line.kind === 'figure' ? `${line.label} ${line.value}` : line.text));

describe('the lines of the Storage group', () => {
  it('in a browser with an estimate', () => {
    expect(texts(FIGURES)).toEqual([
      'My Programs: 37 files, 3.4 MB',
      'Earlier versions: 212 versions, 921.6 kB',
      'Trash: 4 items, 307.2 kB',
      'This site uses 7.9 MB in this browser, about 1.8 GB free',
      "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.",
    ]);
  });

  it('in a browser without an estimate: the site line is left out', () => {
    expect(texts({ ...FIGURES, site: null })).toEqual([
      'My Programs: 37 files, 3.4 MB',
      'Earlier versions: 212 versions, 921.6 kB',
      'Trash: 4 items, 307.2 kB',
      "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.",
    ]);
  });

  it('in the desktop app: the last lines are the app-storage sentence; My Programs only when mounted', () => {
    expect(texts({ ...FIGURES, site: null, desktop: true })).toEqual([
      'My Programs: 37 files, 3.4 MB',
      'Earlier versions: 212 versions, 921.6 kB',
      'Trash: 4 items, 307.2 kB',
      "Earlier versions and Trash are kept in the app's own storage.",
    ]);
    expect(texts({ ...FIGURES, myPrograms: null, site: null, desktop: true })).toEqual([
      'Earlier versions: 212 versions, 921.6 kB',
      'Trash: 4 items, 307.2 kB',
      "Earlier versions and Trash are kept in the app's own storage.",
    ]);
  });
});

describe('readFigures', () => {
  async function seeded() {
    const app = application();
    await app.ctx.vfs.writeFile('/browser/a.X68', encode('12345'));
    await app.ctx.vfs.writeFile('/browser/demo/b.X68', encode('1234567890'));
    await app.ctx.vfs.writeFile('/browser/demo/deep/c.txt', new Uint8Array(2048));
    return app;
  }

  it('counts every file below /browser with its size', async () => {
    const app = await seeded();
    expect(await countFiles(app.ctx.vfs, '/browser')).toEqual({ files: 3, bytes: 5 + 10 + 2048 });
  }, 30_000);

  it('with an estimate: usage and quota - usage; without one: no site figure', async () => {
    const app = await seeded();
    const base = { vfs: app.ctx.vfs, history: app.ctx.history, platformKind: 'web' as const };
    const withEstimate = await readFigures({ ...base, estimate: async () => ({ usage: 1000, quota: 5000 }) });
    expect(withEstimate.site).toEqual({ usage: 1000, free: 4000 });
    expect(withEstimate.myPrograms).toEqual({ files: 3, bytes: 2063 });
    expect((await readFigures({ ...base, estimate: null })).site).toBe(null);
    expect((await readFigures({ ...base, estimate: async () => ({ usage: 1000 }) })).site).toEqual({
      usage: 1000,
      free: null,
    });
    expect((await readFigures({ ...base, estimate: async () => ({}) })).site).toBe(null);
    expect((await readFigures({ ...base, estimate: () => Promise.reject(new Error('no')) })).site).toBe(null);
  }, 30_000);

  it('the desktop app never asks the estimate; without /browser there is no My Programs', async () => {
    const app = await seeded();
    const estimate = vi.fn(async () => ({ usage: 1, quota: 2 }));
    app.ctx.vfs.unmount('browser');
    const figures = await readFigures({
      vfs: app.ctx.vfs,
      history: app.ctx.history,
      estimate,
      platformKind: 'desktop',
    });
    expect(estimate).not.toHaveBeenCalled();
    expect(figures.myPrograms).toBe(null);
    expect(figures.desktop).toBe(true);
    expect(figures.site).toBe(null);
  }, 30_000);

  it('takes the two halves from history.usage() of the real store', async () => {
    const app = await seeded();
    const history = app.ctx.history!;
    await history.record('/browser/a.X68', encode('12345'), 'saved', 1000);
    await history.record('/browser/a.X68', encode('123456'), 'saved', 2000);
    await history.guard(
      '/browser/demo/b.X68',
      'delete',
      async () => app.ctx.vfs.remove('/browser/demo/b.X68'),
      async () => true,
    );
    const usage = await history.usage();
    const figures = await readFigures({ vfs: app.ctx.vfs, history, estimate: null, platformKind: 'web' });
    expect(usage.trashItems).toBe(1);
    expect(usage.versions).toBeGreaterThan(0);
    expect(figures).toMatchObject({
      versions: usage.versions,
      versionBytes: usage.versionBytes,
      trashItems: 1,
      trashBytes: usage.trashBytes,
      myPrograms: { files: 2, bytes: 5 + 2048 },
    });
  }, 60_000);

  it('without ctx.history, or when usage() rejects, both halves read as zero', async () => {
    const app = await seeded();
    const broken = fakeHistory();
    broken.usage = () => Promise.reject(new Error('gone'));
    for (const history of [undefined, broken]) {
      const figures = await readFigures({ vfs: app.ctx.vfs, history, estimate: null, platformKind: 'web' });
      expect([figures.versions, figures.versionBytes, figures.trashItems, figures.trashBytes]).toEqual([0, 0, 0, 0]);
    }
  }, 30_000);
});

/* ================================================================ the buttons */

describe('Empty Trash', () => {
  it('asks with the number and size of the items, and No deletes nothing', async () => {
    const history = fakeHistory({ items: [item('a', 1024), item('b', 1024 * 1024)] });
    const app = withHistory(history);
    const done = emptyTrash(app.ctx);
    const box = await dialogOnTop(app, 'message');
    expect(box.props as MessageBoxRequest).toEqual({
      title: 'Empty Trash',
      text: 'Delete everything in the Trash for good? (2 items, 1.0 MB)',
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    app.dialogs.close(box.key, 'No');
    expect(await done).toBe('declined');
    expect(history.dropTrash).not.toHaveBeenCalled();
  });

  it('Yes deletes the items listed, at once', async () => {
    const history = fakeHistory({ items: [item('a', 10), item('b', 20)] });
    const app = withHistory(history);
    const done = emptyTrash(app.ctx);
    app.dialogs.close((await dialogOnTop(app, 'message')).key, 'Yes');
    expect(await done).toBe('done');
    expect(history.dropTrash).toHaveBeenCalledWith(['a', 'b']);
  });

  it('with nothing in the Trash it says so and deletes nothing', async () => {
    const history = fakeHistory();
    const app = withHistory(history);
    const done = emptyTrash(app.ctx);
    const box = await dialogOnTop(app, 'message');
    expect(box.props).toEqual({ title: 'Empty Trash', text: T.TRASH_EMPTY_TEXT, icon: 'information', buttons: ['OK'] });
    app.dialogs.close(box.key, 'OK');
    expect(await done).toBe('empty');
    expect(history.dropTrash).not.toHaveBeenCalled();
  });

  it('against the real store: the Trash is empty afterwards and the versions stay', async () => {
    const app = application();
    const history = app.ctx.history!;
    await app.ctx.vfs.writeFile('/browser/keep.X68', encode('keep'));
    await history.record('/browser/keep.X68', encode('keep'), 'saved', 1000);
    await app.ctx.vfs.writeFile('/browser/gone.X68', encode('gone'));
    await history.guard(
      '/browser/gone.X68',
      'delete',
      async () => app.ctx.vfs.remove('/browser/gone.X68'),
      async () => true,
    );
    const before = await history.usage();
    expect(before.trashItems).toBe(1);
    const done = emptyTrash(app.ctx);
    const box = await dialogOnTop(app, 'message');
    expect((box.props as MessageBoxRequest).text).toBe(
      `Delete everything in the Trash for good? (1 item, ${T.trashFigure(1, before.trashBytes).split(', ')[1]})`,
    );
    app.dialogs.close(box.key, 'Yes');
    expect(await done).toBe('done');
    const after = await history.usage();
    expect([after.trashItems, after.trashBytes]).toEqual([0, 0]);
    expect(after.versions).toBe(before.versions);
  }, 60_000);

  it('without ctx.history it does nothing', async () => {
    const app = withHistory(undefined);
    expect(app.ctx.history).toBeUndefined();
    expect(await emptyTrash(app.ctx)).toBe('unavailable');
    expect(app.ctx.store.getState().dialogs.stack).toEqual([]);
  });
});

describe('Delete Earlier Versions', () => {
  it('asks the question of P3.5; No keeps everything, Yes clears the versions at once', async () => {
    const history = fakeHistory();
    const app = withHistory(history);
    let done = deleteEarlierVersions(app.ctx);
    const box = await dialogOnTop(app, 'message');
    expect(box.props).toEqual({
      title: 'Delete Earlier Versions',
      text: 'Delete all earlier versions of all files for good? Your current files are not affected.',
      icon: 'confirmation',
      buttons: ['Yes', 'No'],
    });
    app.dialogs.close(box.key, 'No');
    expect(await done).toBe('declined');
    expect(history.clearVersions).not.toHaveBeenCalled();

    done = deleteEarlierVersions(app.ctx);
    app.dialogs.close((await dialogOnTop(app, 'message')).key, 'Yes');
    expect(await done).toBe('done');
    expect(history.clearVersions).toHaveBeenCalledTimes(1);
  });

  it('against the real store: no version is left in the versions half, the Trash stays', async () => {
    const app = application();
    const history = app.ctx.history!;
    await app.ctx.vfs.writeFile('/browser/a.X68', encode('a1'));
    await history.record('/browser/a.X68', encode('a1'), 'saved', 1000);
    await history.record('/browser/a.X68', encode('a2'), 'saved', 2000);
    await app.ctx.vfs.writeFile('/browser/gone.X68', encode('gone'));
    await history.guard(
      '/browser/gone.X68',
      'delete',
      async () => app.ctx.vfs.remove('/browser/gone.X68'),
      async () => true,
    );
    const before = await history.usage();
    expect(before.versions).toBeGreaterThan(0);
    const done = deleteEarlierVersions(app.ctx);
    app.dialogs.close((await dialogOnTop(app, 'message')).key, 'Yes');
    expect(await done).toBe('done');
    const after = await history.usage();
    expect(after.versions).toBe(0);
    expect(await history.versions('/browser/a.X68')).toEqual([]);
    expect(after.trashItems).toBe(before.trashItems);
  }, 60_000);

  it('without ctx.history it does nothing', async () => {
    const app = withHistory(undefined);
    expect(await deleteEarlierVersions(app.ctx)).toBe('unavailable');
    expect(app.ctx.store.getState().dialogs.stack).toEqual([]);
  });
});
