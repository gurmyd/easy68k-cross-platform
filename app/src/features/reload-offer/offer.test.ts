// The reload offer of ARCHITECTURE-PLUS P3.3.10 (package N8): a toast for a changed, unmodified
// document in each store, nothing for a modified one, Reload only on its action.

import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext, Bytes, DocumentService, FileSystemBackend, VPath } from '../../contracts';
import { DocumentManager } from '../../core/documents/service';
import { MemoryBackend } from '../../fs/memory-backend';
import type { DialogServiceStore } from '../../state/dialogs';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { createReloadOfferFeature } from './index';
import { startReloadOffer, type ReloadOffer } from './offer';
import { RELOAD_ACTION, changedOutsideText } from './texts';

const bytes = (s: string): Bytes => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** The four stores of 3.8.1 and P4.3: My Programs, linked files, an opened folder, the desktop disk. */
const STORES: { mount: string; kind: FileSystemBackend['kind']; label: string; path: VPath }[] = [
  { mount: 'browser', kind: 'browser', label: 'My Programs', path: '/browser/demo/prog.X68' },
  { mount: 'linked', kind: 'fsaccess', label: 'Linked files', path: '/linked/0a1b2c3d/prog.X68' },
  { mount: 'folder', kind: 'fsaccess', label: 'Folder: Lab', path: '/folder/prog.X68' },
  { mount: 'disk', kind: 'disk', label: 'This computer', path: '/disk/Users/me/prog.X68' },
];

interface Harness {
  app: TestApplication;
  documents: DocumentManager;
  backends: Map<string, MemoryBackend>;
  toasts: () => { text: string; action?: { label: string; run(): void } }[];
  focus(): void;
  offer: ReloadOffer;
}

const harnesses: Harness[] = [];
afterEach(() => {
  for (const h of harnesses.splice(0)) {
    h.offer.stop();
    h.app.dispose();
  }
});

function harness(): Harness {
  const backends = new Map(
    STORES.map((s) => [s.mount, new MemoryBackend({ mount: s.mount, kind: s.kind, label: s.label })] as const),
  );
  const app = createTestApplication({
    backends: [...backends.values()],
    services: {
      createDocumentService: (ctx: AppContext) =>
        new DocumentManager({
          store: ctx.store,
          settings: ctx.settings,
          dialogs: ctx.dialogs,
          vfs: ctx.vfs,
          fileDialogs: ctx.fileDialogs,
        }),
    },
  });
  const documents = app.ctx.documents as DocumentManager;
  const focusListeners = new Set<() => void>();
  const offer = startReloadOffer({
    documents,
    vfs: app.ctx.vfs,
    dialogs: app.ctx.dialogs,
    onFocus(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    settle: () => Promise.resolve(),
  });
  const dialogs = app.ctx.dialogs as DialogServiceStore;
  const h: Harness = {
    app,
    documents,
    backends,
    toasts: () => [...dialogs.toasts.getState()],
    focus: () => {
      for (const listener of focusListeners) listener();
    },
    offer,
  };
  harnesses.push(h);
  return h;
}

async function openFile(h: Harness, path: VPath, text: string) {
  await h.app.ctx.vfs.writeFile(path, bytes(text));
  const doc = await h.documents.open(path);
  if (!doc) throw new Error(`${path} did not open`);
  return doc;
}

const rel = (path: VPath) => path.split('/').slice(2).join('/');
const backendOf = (h: Harness, path: VPath) => h.backends.get(path.split('/')[1] as string) as MemoryBackend;
const reloadToasts = (h: Harness) => h.toasts().filter((t) => t.action?.label === RELOAD_ACTION);

describe('the texts', () => {
  it('are those of P3.3.10', () => {
    expect(changedOutsideText('prog.X68')).toBe('"prog.X68" was changed outside this window.');
    expect(RELOAD_ACTION).toBe('Reload');
  });
});

describe('the reload offer, in each store', () => {
  for (const store of STORES) {
    it(`${store.mount}: an external change of an unmodified document offers a reload; Reload loads it`, async () => {
      const h = harness();
      const doc = await openFile(h, store.path, '* before\r\n');
      expect(reloadToasts(h)).toEqual([]);
      // Another window writes the file (as Restore does there): the Vfs reports it as external.
      await backendOf(h, store.path).externalWrite(rel(store.path), bytes('* after\r\n'));
      await h.offer.idle();
      const offered = reloadToasts(h);
      expect(offered.map((t) => t.text)).toEqual(['"prog.X68" was changed outside this window.']);
      // Nothing is reloaded before Reload is chosen.
      expect(h.documents.text(doc.id)).toBe('* before\n');
      offered[0]?.action?.run();
      await until(() => h.documents.text(doc.id) === '* after\n');
      expect(h.documents.get(doc.id)?.modified).toBe(false);
      expect(h.documents.fileTime(doc.id)).toBe((await h.app.ctx.vfs.stat(store.path))?.mtime);
      // The same change is not offered again.
      h.focus();
      await h.offer.idle();
      expect(reloadToasts(h)).toHaveLength(1);
    });

    it(`${store.mount}: a change found when the window regains the focus offers a reload`, async () => {
      const h = harness();
      await openFile(h, store.path, '* before\r\n');
      // Another program changes the file and nothing reports it (an opened folder never does).
      await backendOf(h, store.path).writeFile(rel(store.path), bytes('* git checkout\r\n'));
      await h.offer.idle();
      expect(reloadToasts(h)).toEqual([]);
      h.focus();
      await h.offer.idle();
      expect(reloadToasts(h).map((t) => t.text)).toEqual(['"prog.X68" was changed outside this window.']);
    });

    it(`${store.mount}: a modified document is left alone (its Save asks)`, async () => {
      const h = harness();
      const doc = await openFile(h, store.path, '* before\r\n');
      h.documents.registry.dispatch(doc.id, { changes: { from: 0, insert: 'X' } });
      expect(h.documents.get(doc.id)?.modified).toBe(true);
      await backendOf(h, store.path).externalWrite(rel(store.path), bytes('* after\r\n'));
      await h.offer.idle();
      h.focus();
      await h.offer.idle();
      expect(reloadToasts(h)).toEqual([]);
      expect(h.documents.text(doc.id)).toBe('X* before\n');
    });
  }
});

describe('what the offer never does', () => {
  it('does not reload a document that became modified after the toast', async () => {
    const h = harness();
    const doc = await openFile(h, '/browser/a.X68', '* one\r\n');
    await backendOf(h, '/browser/a.X68').externalWrite('a.X68', bytes('* two\r\n'));
    await h.offer.idle();
    const [toast] = reloadToasts(h);
    h.documents.registry.dispatch(doc.id, { changes: { from: 0, insert: 'Y' } });
    toast?.action?.run();
    await Promise.resolve();
    expect(h.documents.text(doc.id)).toBe('Y* one\n');
    expect(h.app.ctx.store.getState().dialogs.stack).toEqual([]); // not even the reload question
  });

  it("does not offer for the window's own Save, nor for an unchanged file", async () => {
    const h = harness();
    const doc = await openFile(h, '/browser/a.X68', '* one\r\n');
    h.documents.registry.dispatch(doc.id, { changes: { from: 0, insert: 'Z' } });
    expect(await h.documents.save(doc.id)).toBe(true);
    h.focus();
    await h.offer.idle();
    expect(reloadToasts(h)).toEqual([]);
  });

  it('does not offer for a change of another file, or for a file that is gone', async () => {
    const h = harness();
    await openFile(h, '/browser/a.X68', '* one\r\n');
    await openFile(h, '/browser/b.X68', '* b\r\n');
    await backendOf(h, '/browser/c.X68').externalWrite('c.X68', bytes('* c\r\n'));
    await backendOf(h, '/browser/b.X68').externalRemove('b.X68');
    await h.offer.idle();
    h.focus();
    await h.offer.idle();
    expect(reloadToasts(h)).toEqual([]);
  });

  it('offers again for a later change of the same file, and names each document', async () => {
    const h = harness();
    await openFile(h, '/browser/a.X68', '* one\r\n');
    await openFile(h, '/disk/Users/me/b.X68', '* b\r\n');
    await backendOf(h, '/browser/a.X68').externalWrite('a.X68', bytes('* two\r\n'));
    await h.offer.idle();
    await backendOf(h, '/browser/a.X68').externalWrite('a.X68', bytes('* three\r\n'));
    await backendOf(h, '/disk/x').writeFile('Users/me/b.X68', bytes('* b2\r\n'));
    h.focus();
    await h.offer.idle();
    expect(reloadToasts(h).map((t) => t.text)).toEqual([
      '"a.X68" was changed outside this window.',
      '"a.X68" was changed outside this window.',
      '"b.X68" was changed outside this window.',
    ]);
  });

  it('a change of a folder above the document is looked at too', async () => {
    const h = harness();
    await openFile(h, '/browser/demo/a.X68', '* one\r\n');
    const backend = backendOf(h, '/browser/demo');
    await backend.writeFile('demo/a.X68', bytes('* restored\r\n'));
    backend.emitExternal({ rel: 'demo', kind: 'write' });
    await h.offer.idle();
    expect(reloadToasts(h).map((t) => t.text)).toEqual(['"a.X68" was changed outside this window.']);
  });

  it('a document service without fileTime: nothing at all', async () => {
    const h = harness();
    const listened: string[] = [];
    const withoutFileTime: Pick<DocumentService, 'list' | 'reload'> = {
      list: () => h.documents.list(),
      reload: (id) => h.documents.reload(id),
    };
    const offer = startReloadOffer({
      documents: withoutFileTime,
      vfs: {
        stat: (path) => h.app.ctx.vfs.stat(path),
        subscribe: (prefix, listener) => {
          listened.push(prefix);
          return h.app.ctx.vfs.subscribe(prefix, listener);
        },
      },
      dialogs: h.app.ctx.dialogs,
      onFocus: () => {
        listened.push('focus');
        return () => {};
      },
      settle: () => Promise.resolve(),
    });
    expect(listened).toEqual([]);
    offer.stop();
  });
});

describe('the feature', () => {
  const apps: TestApplication[] = [];
  afterEach(() => {
    for (const app of apps.splice(0)) app.dispose();
  });

  it('connects the offer to the window: focus and external changes', async () => {
    const focus = new Set<() => void>();
    const browser = new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs' });
    const app = createTestApplication({
      backends: [browser],
      features: [
        createReloadOfferFeature({
          onFocus: (listener) => {
            focus.add(listener);
            return () => focus.delete(listener);
          },
          settle: () => Promise.resolve(),
        }),
      ],
      services: {
        createDocumentService: (ctx: AppContext) =>
          new DocumentManager({
            store: ctx.store,
            settings: ctx.settings,
            dialogs: ctx.dialogs,
            vfs: ctx.vfs,
            fileDialogs: ctx.fileDialogs,
          }),
      },
    });
    apps.push(app);
    expect(focus.size).toBe(1);
    await app.ctx.vfs.writeFile('/browser/p.X68', bytes('* p\r\n'));
    const doc = await app.ctx.documents.open('/browser/p.X68');
    await browser.writeFile('p.X68', bytes('* q\r\n'));
    for (const listener of focus) listener();
    const toasts = () => (app.ctx.dialogs as DialogServiceStore).toasts.getState();
    await until(() => toasts().some((t) => t.action?.label === 'Reload'));
    toasts()
      .find((t) => t.action?.label === 'Reload')
      ?.action?.run();
    await until(() => app.ctx.documents.text(doc?.id ?? '') === '* q\n');
    app.dispose();
    apps.splice(0);
    expect(focus.size).toBe(0);
  });
});

async function until(condition: () => boolean, limit = 200): Promise<void> {
  for (let i = 0; i < limit && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(condition()).toBe(true);
}
