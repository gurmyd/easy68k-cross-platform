// A relocated document's draft is rewritten at once, naming the new path (ARCHITECTURE-PLUS
// P3.2.4, P4.4; the hook in drafts.ts is N6's).

import { describe, expect, it } from 'vitest';
import type { AppContext, Scheduler } from '../../contracts';
import { DocumentManager } from '../../core/documents/service';
import { defaultSettings } from '../../core/settings/defaults';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { createAppStore } from '../../state/store';
import { createMemoryDraftStore, startDraftKeeper } from './drafts';

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

/** Timers that never fire: only relocate (and flush) may write drafts in these tests. */
const stillScheduler: Scheduler = { onFrame: () => () => {}, setTimer: () => () => {} };

async function setup() {
  const vfs = createVfs();
  vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' }));
  const settings = defaultSettings();
  const store = createAppStore(settings);
  const documents = new DocumentManager({
    store,
    settings: { get: () => settings },
    dialogs: { messageBox: async () => 'OK', toast: () => {} },
    vfs,
    fileDialogs: { open: async () => null, save: async () => null },
  });
  const drafts = createMemoryDraftStore();
  const ctx = {
    store,
    scheduler: stillScheduler,
    dialogs: { open: async () => 'Discard' },
    platform: { windowId: 'w1' },
  } as unknown as Pick<AppContext, 'store' | 'scheduler' | 'dialogs' | 'platform'>;
  const keeper = startDraftKeeper({ ctx, documents, drafts, locks: null });
  await vfs.writeFile('/browser/lab/p.X68', bytes('A\r\n'));
  await vfs.writeFile('/browser/lab/q.X68', bytes('Q\r\n'));
  return { vfs, documents, drafts, keeper };
}

describe('drafts follow relocate (ARCHITECTURE-PLUS P4.4)', () => {
  it('the draft of a modified document names the new path when relocate resolves', async () => {
    const t = await setup();
    const doc = (await t.documents.open('/browser/lab/p.X68'))!;
    t.documents.registry.dispatch(doc.id, { changes: { from: 0, insert: 'X' } });
    await t.keeper.flush();
    expect(t.drafts.records.get(`w1/${doc.id}`)?.state.path).toBe('/browser/lab/p.X68');

    await t.vfs.writeFile('/browser/done/p.X68', bytes('A\r\n'));
    await t.documents.relocate('/browser/lab', '/browser/done');
    const record = t.drafts.records.get(`w1/${doc.id}`);
    expect(record?.state).toMatchObject({ path: '/browser/done/p.X68', name: 'p.X68', modified: true });
    expect(record?.text).toBe('XA\n');
    expect(record?.mtime).toBe(t.documents.fileTime(doc.id));
    expect(t.drafts.records.size).toBe(1);
    t.keeper.dispose();
  });

  it('an unmodified document gets no draft by being relocated', async () => {
    const t = await setup();
    await t.documents.open('/browser/lab/q.X68');
    await t.documents.relocate('/browser/lab/q.X68', '/browser/lab/r.X68');
    expect(t.drafts.records.size).toBe(0);
    t.keeper.dispose();
  });

  it('after dispose a relocation writes no draft', async () => {
    const t = await setup();
    const doc = (await t.documents.open('/browser/lab/p.X68'))!;
    t.documents.registry.dispatch(doc.id, { changes: { from: 0, insert: 'X' } });
    t.keeper.dispose();
    await t.documents.relocate('/browser/lab/p.X68', '/browser/lab/s.X68');
    expect(t.drafts.records.size).toBe(0);
  });
});
