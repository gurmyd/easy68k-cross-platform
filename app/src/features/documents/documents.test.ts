// Tests of the documents feature on a whole application built from fakes (state/testing.ts):
// commands, close prompts, Exit, the start-up document, the unload guard and drafts (ARCHITECTURE.md
// 3.9, 3.8.6; editor-ui §1, §6, §20.2).

import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { FileDialogs, OpenRequest, Platform, SaveRequest, Scheduler, StartupArgs } from '../../contracts';
import type { DocumentManager } from '../../core/documents/service';
import { MemoryBackend } from '../../fs/memory-backend';
import { shellStateOf } from '../../state/shell';
import { createFakePlatform, createTestApplication, FakeLocks, type TestApplication } from '../../state/testing';
import { windowLockName } from '../../state/window-lock';
import {
  createIndexedDbDraftStore,
  createMemoryDraftStore,
  DRAFT_DELAY_MS,
  DRAFTS_DIALOG_ID,
  DRAFTS_GONE_GRACE_MS,
  DRAFTS_GONE_POLL_MS,
  DRAFTS_CHECK_LOCK_PREFIX,
  DRAFTS_OFFER_LOCK,
  type DraftStore,
} from './drafts';
import { createDocumentService, createDocumentsFeature } from './index';

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));
const latin = (data: Uint8Array) => String.fromCharCode(...data);

/** A scheduler whose timers run when the test advances time. */
function manualScheduler() {
  let now = 0;
  const timers = new Set<{ at: number; fn: () => void }>();
  const scheduler: Scheduler = {
    onFrame: () => () => {},
    setTimer(delayMs, fn) {
      const timer = { at: now + delayMs, fn };
      timers.add(timer);
      return () => void timers.delete(timer);
    },
  };
  return {
    scheduler,
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at <= now && timers.delete(timer)) timer.fn();
      }
    },
    pending: () => timers.size,
  };
}

/** File dialogs that answer from queues and record the requests. */
function scriptedFileDialogs() {
  const opens: (string[] | null)[] = [];
  const saves: (string | null)[] = [];
  const openRequests: OpenRequest[] = [];
  const saveRequests: SaveRequest[] = [];
  const dialogs: FileDialogs = {
    open: async (request) => (openRequests.push(request), opens.shift() ?? null),
    save: async (request) => (saveRequests.push(request), saves.shift() ?? null),
    chooseFolder: async () => null,
    linkFileHandle: async () => null,
    registerProvider: () => () => {},
  };
  return { dialogs, opens, saves, openRequests, saveRequests };
}

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await flushPromises();
  }
  throw new Error(`Timed out waiting for ${what}`);
}

interface WindowOptions {
  windowId?: string;
  startup?: Partial<StartupArgs>;
  platform?: Partial<Platform>;
  backend?: MemoryBackend;
  drafts?: DraftStore | null;
  locks?: FakeLocks;
  hidden?: Set<() => void>;
}

function openWindow(options: WindowOptions = {}) {
  const time = manualScheduler();
  const files = scriptedFileDialogs();
  const backend = options.backend ?? new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  /** Each Platform.confirmBeforeUnload call as [needed, who]. */
  const unload: [boolean, string | undefined][] = [];
  const quits: number[] = [];
  const startup: StartupArgs = { file: null, run: false, fullScreen: false, exceptions: false, bitField: false };
  const platform = createFakePlatform({
    windowId: options.windowId ?? 'window-a',
    startupArgs: () => ({ ...startup, ...options.startup }),
    confirmBeforeUnload: (needed, who) => void unload.push([needed, who]),
    quit: () => void quits.push(1),
    ...options.platform,
  });
  const locks = options.locks ?? new FakeLocks();
  const drafts = options.drafts === undefined ? createMemoryDraftStore() : options.drafts;
  const hidden = options.hidden ?? new Set<() => void>();
  const feature = createDocumentsFeature({
    draftStore: () => drafts,
    locks: () => locks,
    onHidden: (listener) => {
      hidden.add(listener);
      return () => void hidden.delete(listener);
    },
  });
  const app: TestApplication = createTestApplication({
    features: [feature],
    services: { createDocumentService, createFileDialogs: () => files.dialogs },
    platform,
    scheduler: time.scheduler,
    backends: [backend],
    locks,
  });
  const ctx = app.ctx;
  const manager = ctx.documents as DocumentManager;
  const stack = () => ctx.store.getState().dialogs.stack;
  const topText = () => {
    const top = stack().at(-1);
    return top ? ((top.props as { text?: string }).text ?? null) : null;
  };
  /** Waits for a dialog and answers it. */
  const answer = async (result: string, id?: string) => {
    await waitFor(() => stack().length > 0 && (id === undefined || stack().at(-1)?.id === id), `a dialog to ${result}`);
    const top = stack().at(-1)!;
    app.dialogs.close(top.key, result);
    await flushPromises();
  };
  const type = (id: string, text: string) => manager.registry.dispatch(id, { changes: { from: 0, insert: text } });
  return {
    app,
    ctx,
    manager,
    time,
    files,
    backend,
    unload,
    quits,
    locks,
    drafts,
    hidden,
    stack,
    topText,
    answer,
    type,
  };
}

describe('start-up document (editor-ui §1.1, 5.7)', () => {
  it('one new document from the template, active, not modified', () => {
    const w = openWindow();
    const { items, activeId } = w.ctx.store.getState().documents;
    expect(items.map((doc) => doc.name)).toEqual(['untitled1.x68']);
    expect(activeId).toBe(items[0]?.id);
    expect(items[0]?.modified).toBe(false);
  });

  it('a start-up file that exists is opened instead', async () => {
    const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
    await backend.writeFile('demo/p.X68', bytes('START\r\n'));
    const w = openWindow({ backend, startup: { file: '/browser/demo/p.X68' } });
    await waitFor(() => w.manager.list().length === 1, 'the start-up file');
    expect(w.manager.list().map((doc) => doc.name)).toEqual(['p.X68']);
    expect(w.manager.text(w.manager.list()[0]!.id)).toBe('START\n');
  });

  it('a start-up file that does not exist, or an .S68, gives a new document and no message', async () => {
    for (const file of ['/browser/missing.X68', '/browser/prog.S68', 'C:\\not\\a\\vpath.X68']) {
      const w = openWindow({ startup: { file } });
      await waitFor(() => w.manager.list().length === 1, 'the start-up document');
      expect(w.manager.list()[0]?.name).toBe('untitled1.x68');
      expect(w.stack()).toEqual([]);
    }
  });

  it('files handed over by the system are opened in Editor mode', async () => {
    const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
    await backend.writeFile('a.X68', bytes('A\r\n'));
    await backend.writeFile('b.L68', bytes('B\r\n'));
    let deliver: (files: string[]) => void = () => {};
    const w = openWindow({
      backend,
      platform: {
        onOpenFiles: (listener) => {
          deliver = listener;
          return () => {};
        },
      },
    });
    await w.ctx.commands.run('app.mode.set', 'simulator');
    deliver(['/browser/a.X68', '/browser/x.S68', '/browser/b.L68']);
    await waitFor(() => w.manager.list().length === 3, 'two opened files');
    expect(w.manager.list().map((doc) => [doc.name, doc.kind])).toEqual([
      ['untitled1.x68', 'source'],
      ['a.X68', 'source'],
      ['b.L68', 'list'],
    ]);
    expect(w.ctx.store.getState().mode).toBe('editor');
  });
});

describe('commands', () => {
  it('every command of E1 has a handler', () => {
    const w = openWindow();
    for (const id of [
      'ed.file.new',
      'ed.file.open',
      'ed.file.save',
      'ed.file.saveAs',
      'ed.file.close',
      'ed.file.exit',
      'ed.edit.reload',
      'ed.window.select',
    ]) {
      expect(w.app.commands.hasHandler(id), id).toBe(true);
    }
  });

  it('New adds untitled2.x68; Open opens every chosen file in order with the original filters', async () => {
    const w = openWindow();
    await w.backend.writeFile('a.X68', bytes('A\r\n'));
    await w.backend.writeFile('b.ASM', bytes('B\r\n'));
    await w.ctx.commands.run('ed.file.new');
    w.files.opens.push(['/browser/a.X68', '/browser/b.ASM']);
    await w.ctx.commands.run('ed.file.open');
    expect(w.manager.list().map((doc) => doc.name)).toEqual(['untitled1.x68', 'untitled2.x68', 'a.X68', 'b.ASM']);
    expect(w.files.openRequests[0]).toEqual({
      title: 'Open File',
      multiple: true,
      filters: [
        { label: 'EASy68K Source  [.X68]', patterns: ['*.X68'] },
        { label: '68K Source  [.ASM] [.M68]', patterns: ['*.ASM', '*.M68'] },
        { label: 'EASy68K Listing  [.L68]', patterns: ['*.L68'] },
        { label: '68K S Record  [.S68]', patterns: ['*.S68'] },
        { label: 'Any File  [*.*]', patterns: ['*.*'] },
      ],
    });
    // The next Open starts in the folder of the active document.
    await w.ctx.commands.run('ed.file.open');
    expect(w.files.openRequests[1]?.startDir).toBe('/browser');
  });

  it('Save and Save As act on the active document; a cancelled dialog changes nothing', async () => {
    const w = openWindow();
    const doc = w.manager.active()!;
    w.files.saves.push(null);
    await w.ctx.commands.run('ed.file.save');
    expect(w.manager.active()?.hasName).toBe(false);
    w.files.saves.push('/browser/t.X68');
    await w.ctx.commands.run('ed.file.saveAs');
    expect(w.manager.get(doc.id)).toMatchObject({ name: 't.X68', hasName: true });
    expect(latin(await w.ctx.vfs.readFile('/browser/t.X68')).endsWith('*~Tab size~4~\r\n')).toBe(true);
  });

  it('Save, Save As, Close and Reload are disabled without an active document; Reload needs a name', async () => {
    const w = openWindow();
    expect(w.ctx.commands.isEnabled('ed.edit.reload')).toBe(false);
    await w.ctx.commands.run('ed.file.close');
    for (const id of ['ed.file.save', 'ed.file.saveAs', 'ed.file.close', 'ed.edit.reload', 'ed.window.select']) {
      expect(w.ctx.commands.isEnabled(id), id).toBe(false);
    }
    expect(w.ctx.commands.isEnabled('ed.file.new')).toBe(true);
    expect(w.ctx.commands.isEnabled('ed.file.open')).toBe(true);
    await w.backend.writeFile('p.X68', bytes('P\r\n'));
    await w.manager.open('/browser/p.X68');
    expect(w.ctx.commands.isEnabled('ed.edit.reload')).toBe(true);
  });

  it('Close File on a modified document asks with the exact text; Cancel keeps it', async () => {
    const w = openWindow();
    w.type(w.manager.active()!.id, 'x');
    const closing = w.ctx.commands.run('ed.file.close');
    await waitFor(() => w.stack().length === 1, 'the close prompt');
    expect(w.topText()).toBe("File modified, do you wish to save 'untitled1.x68' before closing?");
    expect((w.stack()[0]?.props as { buttons: string[] }).buttons).toEqual(['Yes', 'No', 'Cancel']);
    await w.answer('Cancel');
    await closing;
    expect(w.manager.list()).toHaveLength(1);
  });

  it('a cancelled Save As cancels the close', async () => {
    const w = openWindow();
    w.type(w.manager.active()!.id, 'x');
    const closing = w.ctx.commands.run('ed.file.close');
    await w.answer('Yes');
    await closing;
    expect(w.files.saveRequests).toHaveLength(1);
    expect(w.manager.list()).toHaveLength(1);
  });

  it('Reload File on a modified, named document asks the "is modified" question', async () => {
    const w = openWindow();
    await w.backend.writeFile('p.X68', bytes('P\r\n'));
    const doc = (await w.manager.open('/browser/p.X68'))!;
    w.type(doc.id, 'x');
    const reloading = w.ctx.commands.run('ed.edit.reload');
    await waitFor(() => w.stack().length === 1, 'the reload question');
    expect(w.topText()).toBe('p.X68 is modified. Do you want to discard changes and reopen?');
    await w.answer('Yes');
    await reloading;
    expect(w.manager.text(doc.id)).toBe('P\n');
  });

  it('Window menu entries activate their document and carry the check mark', async () => {
    const w = openWindow();
    await w.ctx.commands.run('ed.file.new');
    await w.ctx.commands.run('ed.file.new');
    const [first, second] = w.manager.list();
    await w.ctx.commands.run('ed.window.select', 0);
    expect(w.ctx.store.getState().documents.activeId).toBe(first?.id);
    expect(w.ctx.commands.isChecked('ed.window.select', 0)).toBe(true);
    expect(w.ctx.commands.isChecked('ed.window.select', 1)).toBe(false);
    await w.ctx.commands.run('ed.window.select', 1);
    expect(w.ctx.store.getState().documents.activeId).toBe(second?.id);
    await w.ctx.commands.run('ed.window.select', 9);
    expect(w.ctx.store.getState().documents.activeId).toBe(second?.id);
  });
});

describe('Exit (editor-ui §1.3, 1.4 note 4)', () => {
  it('web: runs the close prompts, then shows the exit screen', async () => {
    const w = openWindow();
    await w.ctx.commands.run('ed.file.new');
    w.type(w.manager.list()[1]!.id, 'x');
    const exiting = w.ctx.commands.run('ed.file.exit');
    await w.answer('No');
    await exiting;
    expect(w.manager.list()).toEqual([]);
    expect(shellStateOf(w.ctx).getState().exited).toBe(true);
    expect(w.quits).toEqual([]);
  });

  it('Cancel in a prompt aborts the exit', async () => {
    const w = openWindow();
    w.type(w.manager.active()!.id, 'x');
    const exiting = w.ctx.commands.run('ed.file.exit');
    await w.answer('Cancel');
    await exiting;
    expect(w.manager.list()).toHaveLength(1);
    expect(shellStateOf(w.ctx).getState().exited).toBe(false);
  });

  it('desktop: quits after the close prompts', async () => {
    const w = openWindow({ platform: { kind: 'desktop' } });
    await w.ctx.commands.run('ed.file.exit');
    expect(w.quits).toEqual([1]);
    expect(shellStateOf(w.ctx).getState().exited).toBe(false);
  });
});

describe('unload guard (1.3.3)', () => {
  // Every call names the party 'documents' (Platform.confirmBeforeUnload(needed, who), W1 errata
  // 11): an unnamed call would share one slot with any other unnamed party, so the simulator's guard
  // and this one could switch each other off.
  it('is on exactly while a document is modified, asked under the name documents', async () => {
    const w = openWindow();
    expect(w.unload).toEqual([[false, 'documents']]);
    const doc = w.manager.active()!;
    w.type(doc.id, 'x');
    w.type(doc.id, 'y');
    expect(w.unload).toEqual([
      [false, 'documents'],
      [true, 'documents'],
    ]);
    w.files.saves.push('/browser/s.X68');
    await w.manager.save(doc.id);
    expect(w.unload).toEqual([
      [false, 'documents'],
      [true, 'documents'],
      [false, 'documents'],
    ]);
  });

  it('gives the question back when the window is disposed while a document is modified', () => {
    const w = openWindow();
    w.type(w.manager.active()!.id, 'x');
    w.app.dispose();
    expect(w.unload).toEqual([
      [false, 'documents'],
      [true, 'documents'],
      [false, 'documents'],
    ]);
  });
});

describe('drafts (3.9.4, 3.8.6 rule 4)', () => {
  it('are written two seconds after the last change, and removed on save', async () => {
    const w = openWindow();
    const memory = w.drafts as ReturnType<typeof createMemoryDraftStore>;
    const doc = w.manager.active()!;
    w.type(doc.id, 'a');
    w.time.advance(1500);
    w.type(doc.id, 'b');
    w.time.advance(1500);
    await flushPromises();
    expect(memory.records.size).toBe(0);
    w.time.advance(500);
    await waitFor(() => memory.records.size === 1, 'the draft');
    const record = [...memory.records.values()][0]!;
    expect(record).toMatchObject({ key: `window-a/${doc.id}`, windowId: 'window-a', docId: doc.id, mtime: null });
    expect(record.text.startsWith('ba*----')).toBe(true);
    expect(record.state).toMatchObject({ name: 'untitled1.x68', modified: true });
    w.files.saves.push('/browser/s.X68');
    await w.manager.save(doc.id);
    await waitFor(() => memory.records.size === 0, 'the draft to go');
  });

  it('are written at once when the page is hidden, and removed on close with No', async () => {
    const w = openWindow();
    const memory = w.drafts as ReturnType<typeof createMemoryDraftStore>;
    const doc = w.manager.active()!;
    w.type(doc.id, 'x');
    for (const listener of w.hidden) listener();
    await waitFor(() => memory.records.size === 1, 'the draft');
    const closing = w.manager.close(doc.id);
    await w.answer('No');
    await closing;
    await waitFor(() => memory.records.size === 0, 'the draft to go');
  });

  it('are restored after a simulated crash, exactly once; a second live window is not offered them', async () => {
    const drafts = createMemoryDraftStore();
    const locks = new FakeLocks();
    const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
    await backend.writeFile('p.X68', bytes('P\r\n'));

    // Window A: two modified documents, drafts written.
    const a = openWindow({ windowId: 'A', drafts, locks, backend });
    const pDoc = (await a.manager.open('/browser/p.X68'))!;
    a.type(pDoc.id, 'edited ');
    a.type(a.manager.list()[0]!.id, 'new ');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => drafts.records.size === 2, "A's drafts");

    // Window B starts while A is alive: nothing is offered.
    const b = openWindow({ windowId: 'B', drafts, locks, backend });
    await flushPromises();
    await flushPromises();
    expect(b.stack()).toEqual([]);

    // A crashes: its lock is free, nothing of A runs any more.
    locks.held.delete(windowLockName('A'));
    const c = openWindow({ windowId: 'C', drafts, locks, backend });
    await waitFor(() => c.stack().length === 1, 'the drafts offer');
    expect(c.stack()[0]?.id).toBe(DRAFTS_DIALOG_ID);
    expect(c.topText()).toBe('Unsaved changes from your last session were found for untitled1.x68, p.X68.');
    await c.answer('Restore', DRAFTS_DIALOG_ID);
    await waitFor(() => c.manager.list().length === 3, 'the restored documents');
    const restored = c.manager.list().slice(1);
    expect(restored.map((doc) => [doc.name, doc.modified, doc.hasName])).toEqual([
      ['untitled2.x68', true, false],
      ['p.X68', true, true],
    ]);
    expect(c.manager.text(restored[1]!.id)).toBe('edited P\n');
    expect(c.manager.text(restored[0]!.id).startsWith('new *---')).toBe(true);
    // A's drafts are gone; the restored documents are C's drafts now.
    await waitFor(() => [...drafts.records.values()].every((record) => record.windowId === 'C'), "C's drafts");
    expect(drafts.records.size).toBe(2);

    // The restored file keeps the time recorded by A: a change in storage is still noticed.
    await backend.writeFile('p.X68', bytes('changed elsewhere\r\n'));
    const saving = c.manager.save(restored[1]!.id);
    await waitFor(() => c.stack().length === 1, 'the conflict question');
    expect(c.topText()).toBe("'p.X68' has been changed outside this window. Save anyway?");
    await c.answer('No');
    expect(await saving).toBe(false);

    // Offered exactly once: another window finds nothing of A's (C is alive, also after D has
    // waited the whole grace for C's lock).
    const d = openWindow({ windowId: 'D', drafts, locks, backend });
    for (let waited = 0; waited <= DRAFTS_GONE_GRACE_MS; waited += DRAFTS_GONE_POLL_MS) {
      await flushPromises();
      d.time.advance(DRAFTS_GONE_POLL_MS);
    }
    await flushPromises();
    expect(d.stack()).toEqual([]);
    expect(d.time.pending()).toBe(0);
    expect(drafts.records.size).toBe(2);
  });

  it('a window that starts while a crashed window is still listed as alive offers its drafts once the lock is free', async () => {
    // Playwright's page.close leaves the closed page's lock listed for 10 to 360 ms (errata E1.md
    // entry 19); a window that looked only once would offer nothing.
    const drafts = createMemoryDraftStore();
    const locks = new FakeLocks();
    const a = openWindow({ windowId: 'A', drafts, locks });
    a.type(a.manager.active()!.id, 'crashed ');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => drafts.records.size === 1, "A's draft");
    a.app.dispose(); // A ends, but its lock is still listed
    await flushPromises();
    locks.held.add(windowLockName('A'));

    const c = openWindow({ windowId: 'C', drafts, locks });
    await waitFor(() => c.time.pending() === 1, 'C to wait for A');
    c.time.advance(DRAFTS_GONE_POLL_MS);
    await waitFor(() => c.time.pending() === 1, 'C to look again');
    expect(c.stack()).toEqual([]);
    locks.held.delete(windowLockName('A'));
    c.time.advance(DRAFTS_GONE_POLL_MS);
    await waitFor(() => c.stack().length === 1, 'the drafts offer');
    expect(c.topText()).toBe('Unsaved changes from your last session were found for untitled1.x68.');
    await c.answer('Restore', DRAFTS_DIALOG_ID);
    await waitFor(() => [...drafts.records.values()].every((record) => record.windowId === 'C'), "C's drafts");
    expect(drafts.records.size).toBe(1);
  });

  it('a window that waits the grace for a live owner of drafts does not hold the offer lock meanwhile', async () => {
    // Gate I2 round 2 review: one window with unsaved work and a second one opened kept the offer
    // lock for 3 s, and a third window that started then queued behind it.
    const drafts = createMemoryDraftStore();
    const locks = new FakeLocks();
    const a = openWindow({ windowId: 'A', drafts, locks });
    a.type(a.manager.active()!.id, 'alive ');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => drafts.records.size === 1, "A's draft");

    const requested: string[] = [];
    const request = locks.request.bind(locks);
    locks.request = (name, callback) => {
      requested.push(name);
      return request(name, callback);
    };
    const b = openWindow({ windowId: 'B', drafts, locks });
    for (let waited = 0; waited < DRAFTS_GONE_GRACE_MS; waited += DRAFTS_GONE_POLL_MS) {
      await waitFor(() => b.time.pending() === 1, 'B to wait for A');
      expect(locks.held.has(DRAFTS_OFFER_LOCK)).toBe(false);
      // B's own check lock says that B is still looking (tests wait for it; nobody else asks for it).
      expect(locks.held.has(`${DRAFTS_CHECK_LOCK_PREFIX}B`)).toBe(true);
      b.time.advance(DRAFTS_GONE_POLL_MS);
    }
    await flushPromises();
    await flushPromises();
    expect(b.time.pending()).toBe(0); // the wait is over
    expect(locks.held.has(`${DRAFTS_CHECK_LOCK_PREFIX}B`)).toBe(false);
    expect(b.stack()).toEqual([]);
    // A is alive the whole time: nothing to offer, so the offer lock was never even asked for.
    expect(requested).not.toContain(DRAFTS_OFFER_LOCK);
    expect(drafts.records.size).toBe(1);
  });

  it('after Restore the old drafts are kept when the restored ones could not be written', async () => {
    const memory = createMemoryDraftStore();
    let failPuts = false;
    const drafts: DraftStore = {
      put: (records) => (failPuts ? Promise.reject(new Error('QuotaExceededError')) : memory.put(records)),
      remove: (keys) => memory.remove(keys),
      all: () => memory.all(),
    };
    const locks = new FakeLocks();
    const a = openWindow({ windowId: 'A', drafts, locks });
    a.type(a.manager.active()!.id, 'work ');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => memory.records.size === 1, "A's draft");
    locks.held.delete(windowLockName('A'));
    failPuts = true;
    const b = openWindow({ windowId: 'B', drafts, locks });
    await b.answer('Restore', DRAFTS_DIALOG_ID);
    await waitFor(() => b.manager.list().length === 2, 'the restored document');
    await flushPromises();
    await flushPromises();
    expect([...memory.records.values()].map((record) => record.windowId)).toEqual(['A']);
  });

  it('Discard removes the drafts without restoring them', async () => {
    const drafts = createMemoryDraftStore();
    const locks = new FakeLocks();
    const a = openWindow({ windowId: 'A', drafts, locks });
    a.type(a.manager.active()!.id, 'x');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => drafts.records.size === 1, "A's draft");
    locks.held.delete(windowLockName('A'));
    const b = openWindow({ windowId: 'B', drafts, locks });
    await b.answer('Discard', DRAFTS_DIALOG_ID);
    await waitFor(() => drafts.records.size === 0, 'the drafts to go');
    expect(b.manager.list().map((doc) => doc.name)).toEqual(['untitled1.x68']);
  });

  it('never touch the real file', async () => {
    const drafts = createMemoryDraftStore();
    const locks = new FakeLocks();
    const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
    await backend.writeFile('p.X68', bytes('P\r\n'));
    const a = openWindow({ windowId: 'A', drafts, locks, backend });
    const doc = (await a.manager.open('/browser/p.X68'))!;
    a.type(doc.id, 'x');
    a.time.advance(DRAFT_DELAY_MS);
    await waitFor(() => drafts.records.size === 1, 'the draft');
    expect(latin(await backend.readFile('p.X68'))).toBe('P\r\n');
  });

  it('the IndexedDB store keeps, lists and removes records', async () => {
    const store = createIndexedDbDraftStore(new IDBFactory());
    const w = openWindow();
    const state = w.manager.active()!;
    await store.put([{ key: 'w/d1', windowId: 'w', docId: 'd1', order: 0, state, text: 'T\u20ac', mtime: 5 }]);
    await store.put([{ key: 'w/d2', windowId: 'w', docId: 'd2', order: 1, state, text: '', mtime: null }]);
    expect((await store.all()).map((record) => [record.key, record.text, record.mtime])).toEqual([
      ['w/d1', 'T\u20ac', 5],
      ['w/d2', '', null],
    ]);
    await store.remove(['w/d1']);
    expect((await store.all()).map((record) => record.key)).toEqual(['w/d2']);
  });

  it('without a lock manager nothing is offered', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put([
      {
        key: 'gone/doc-1',
        windowId: 'gone',
        docId: 'doc-1',
        order: 0,
        state: openWindow().manager.active()!,
        text: 'x',
        mtime: null,
      },
    ]);
    // A lock manager that grants locks but cannot list them: which windows are alive is unknown.
    const blind = { request: async (_name: string, callback: (lock: unknown) => Promise<unknown>) => callback({}) };
    const w = openWindow({ drafts, locks: blind as unknown as FakeLocks });
    await flushPromises();
    expect(w.stack()).toEqual([]);
    expect(drafts.records.size).toBe(1);
  });
});
