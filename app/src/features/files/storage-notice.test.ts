// The Safari storage notice (R-10): the decision for every combination of its inputs, the engine
// test, the query parameter, the acknowledgement in the settings (per browser, survives a reload,
// heard by another window) and the store's kinds.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { FileSystemBackend } from '../../contracts';
import { engineOf as coreEngineOf } from '../../core/help/engine';
import { createSettingsService, MemorySettingsStorage } from '../../core/settings/service';
import { BrowserBackend, PendingBrowserStore, UnsavedBrowserStore } from '../../fs/browser-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import {
  STORAGE_NOTICE_DISMISS_CAPTION,
  STORAGE_NOTICE_INSTALLED_TEXT,
  STORAGE_NOTICE_LABEL,
  STORAGE_NOTICE_TAB_TEXT,
  acknowledgeStorageNotice,
  engineOf,
  forcedBy,
  markStorageNoticeSeen,
  noticeAtWrite,
  storageNoticeSeenIn,
  watchFirstWrite,
  type NoticeAtWriteInput,
  type NoticeEnvironment,
  storageNoticeAcknowledged,
  storageNoticeKind,
  storeEmptyAtStart,
  storeKindOf,
  type StorageNoticeInput,
  type StorageNoticeKind,
  type StoreKind,
} from './storage-notice';

const PLATFORMS = ['web', 'desktop'] as const;
const ENGINES = ['webkit', 'other'] as const;
const STORES: StoreKind[] = ['indexeddb', 'pending', 'memory', 'none'];
const BOOLS = [false, true];

/** The rule of the gate's decision, written out once more as a table of conditions. */
function expected(input: StorageNoticeInput): StorageNoticeKind {
  const keeps = input.store === 'indexeddb' || input.store === 'pending';
  const asForAPerson = !input.automated || input.forced;
  if (input.platform === 'web' && input.engine === 'webkit' && keeps && !input.acknowledged && asForAPerson) {
    if (!input.installed) return 'tab';
    if (input.storeEmpty) return 'installed';
  }
  return null;
}

describe('storageNoticeKind', () => {
  it('decides every one of the 512 combinations of its inputs', () => {
    let count = 0;
    let shown = 0;
    for (const platform of PLATFORMS)
      for (const engine of ENGINES)
        for (const installed of BOOLS)
          for (const store of STORES)
            for (const storeEmpty of BOOLS)
              for (const acknowledged of BOOLS)
                for (const automated of BOOLS)
                  for (const forced of BOOLS) {
                    const input = { platform, engine, installed, store, storeEmpty, acknowledged, automated, forced };
                    const kind = storageNoticeKind(input);
                    expect(kind, JSON.stringify(input)).toBe(expected(input));
                    count++;
                    if (kind) shown++;
                  }
    expect(count).toBe(512);
    // web + webkit + a store that keeps (2) + not acknowledged, as for a person (3 of 4):
    // in a tab whatever the emptiness (2 x 2 x 3 = 12), installed only when empty (2 x 3 = 6).
    expect(shown).toBe(18);
  });

  const person: StorageNoticeInput = {
    platform: 'web',
    engine: 'webkit',
    installed: false,
    store: 'indexeddb',
    storeEmpty: true,
    acknowledged: false,
    automated: false,
    forced: false,
  };

  it('a person in a Safari tab sees the tab variant from the first start, the empty store included', () => {
    expect(storageNoticeKind(person)).toBe('tab');
    expect(storageNoticeKind({ ...person, storeEmpty: false })).toBe('tab');
    expect(storageNoticeKind({ ...person, store: 'pending' })).toBe('tab');
  });

  it('the installed app shows its variant only with an empty store', () => {
    expect(storageNoticeKind({ ...person, installed: true })).toBe('installed');
    expect(storageNoticeKind({ ...person, installed: true, storeEmpty: false })).toBeNull();
  });

  it('never in the desktop app, another engine, a store that keeps nothing, or after Got it', () => {
    expect(storageNoticeKind({ ...person, platform: 'desktop' })).toBeNull();
    expect(storageNoticeKind({ ...person, engine: 'other' })).toBeNull();
    expect(storageNoticeKind({ ...person, store: 'memory' })).toBeNull();
    expect(storageNoticeKind({ ...person, store: 'none' })).toBeNull();
    expect(storageNoticeKind({ ...person, acknowledged: true })).toBeNull();
    expect(storageNoticeKind({ ...person, acknowledged: true, automated: true, forced: true })).toBeNull();
  });

  it('under automation only with storage-notice=1, and the parameter does not overrule the engine', () => {
    expect(storageNoticeKind({ ...person, automated: true })).toBeNull();
    expect(storageNoticeKind({ ...person, automated: true, forced: true })).toBe('tab');
    expect(storageNoticeKind({ ...person, automated: true, forced: true, engine: 'other' })).toBeNull();
  });
});

describe('the texts', () => {
  it('are at most three short sentences each and say what R-10 asks', () => {
    for (const text of [STORAGE_NOTICE_TAB_TEXT, STORAGE_NOTICE_INSTALLED_TEXT]) {
      const sentences = text.split(/(?<=[a-z"]\.)\s+(?=[A-Z"])/);
      expect(sentences.length).toBeLessThanOrEqual(3);
      for (const sentence of sentences) expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(22);
    }
    expect(STORAGE_NOTICE_TAB_TEXT).toContain('seven days');
    expect(STORAGE_NOTICE_TAB_TEXT).toContain('"Add to Dock"');
    expect(STORAGE_NOTICE_TAB_TEXT).toContain('empty My Programs');
    expect(STORAGE_NOTICE_TAB_TEXT).toContain('Export...');
    expect(STORAGE_NOTICE_INSTALLED_TEXT).toContain('Import...');
  });

  it('are true wherever they are shown: Mac, iPhone and iPad, Safari or another WebKit browser, panel or note', () => {
    // The exact texts (errata FS1.md entry 28, third round; quoted in USER-GUIDE and MANUAL-TEST-MAC).
    expect(STORAGE_NOTICE_TAB_TEXT).toBe(
      'This browser may delete the programs kept here after seven days without a visit to this page. ' +
        'An app made with "Add to Dock" or "Add to Home Screen" starts with its own, empty My Programs. ' +
        'Use Export... in the Files panel to save them all as a .zip, and Import... in the app to bring them over.',
    );
    expect(STORAGE_NOTICE_INSTALLED_TEXT).toBe(
      "This app keeps its own programs, apart from the browser's: Import... in the Files panel brings over programs exported there.",
    );
    expect(STORAGE_NOTICE_LABEL).toBe('About keeping your programs');
    // Every WebKit browser on an iPhone or iPad gets the notice, and only Safari is Safari; the Home
    // Screen is the iPhone's and iPad's Dock; the note at the first write may be shown where the
    // Files panel is not, so no sentence says "here" about the panel's buttons.
    for (const text of [STORAGE_NOTICE_TAB_TEXT, STORAGE_NOTICE_INSTALLED_TEXT, STORAGE_NOTICE_LABEL]) {
      expect(text).not.toMatch(/Safari/);
      expect(text).not.toMatch(/Export\.\.\. here|Import\.\.\. here/);
    }
    expect(STORAGE_NOTICE_TAB_TEXT).toContain('"Add to Home Screen"');
  });
});

describe('the note at the first write (the Files panel not on the screen)', () => {
  const KINDS = ['tab', 'installed', null] as const;
  const PATHS = ['/browser', '/browser/prog.X68', '/browser/Examples', '/linked/a1/prog.X68', '/folder/prog.X68'];

  /** The rule written out once more. */
  function expectedAtWrite(input: NoticeAtWriteInput): StorageNoticeKind {
    const below = input.change.path.startsWith('/browser/');
    return input.due !== null &&
      !input.seen &&
      input.change.kind === 'write' &&
      input.change.origin === 'local' &&
      below
      ? input.due
      : null;
  }

  it('decides every one of the 120 combinations', () => {
    let count = 0;
    let shown = 0;
    for (const due of KINDS)
      for (const seen of BOOLS)
        for (const kind of ['write', 'remove'] as const)
          for (const origin of ['local', 'external'] as const)
            for (const path of PATHS) {
              const input = { due, seen, change: { path, kind, origin } };
              const result = noticeAtWrite(input);
              expect(result, JSON.stringify(input)).toBe(expectedAtWrite(input));
              count++;
              if (result) shown++;
            }
    expect(count).toBe(120);
    // due (2 kinds) x not seen x write x local x the two paths below /browser.
    expect(shown).toBe(4);
  });

  it('the cases of the review: panel hidden, or a first visit in Simulator mode, and the first save', () => {
    const save = { path: '/browser/only-copy.X68', kind: 'write', origin: 'local' } as const;
    // The panel was never on the screen in this window (hidden, or the mode has none): the note.
    expect(noticeAtWrite({ due: 'tab', seen: false, change: save })).toBe('tab');
    expect(noticeAtWrite({ due: 'installed', seen: false, change: save })).toBe('installed');
    // The panel showed the notice: nothing more. Got it pressed, another engine, automation: not due.
    expect(noticeAtWrite({ due: 'tab', seen: true, change: save })).toBeNull();
    expect(noticeAtWrite({ due: null, seen: false, change: save })).toBeNull();
    // Mounting the store is reported as a write of /browser: that is not a file.
    expect(noticeAtWrite({ due: 'tab', seen: false, change: { ...save, path: '/browser' } })).toBeNull();
    // Another window's write is that window's to note.
    expect(noticeAtWrite({ due: 'tab', seen: false, change: { ...save, origin: 'external' } })).toBeNull();
  });

  const person: NoticeEnvironment = { engine: 'webkit', installed: false, automated: false, forced: false };

  async function windowWith(environment: NoticeEnvironment, platform: 'web' | 'desktop' = 'web', prefill = false) {
    const store = await BrowserBackend.open({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, channel: null });
    if (prefill) await store.writeFile('old.X68', new Uint8Array([0x2a])); // a file from an earlier visit
    const vfs = createVfs();
    vfs.mount(store);
    const settings = createSettingsService(new MemorySettingsStorage().window());
    const toasts: {
      text: string;
      label: string | undefined;
      duration: number | undefined;
      run?: (() => void) | undefined;
    }[] = [];
    const ctx = {
      vfs,
      settings,
      platform: { kind: platform },
      dialogs: {
        toast: (text: string, action?: { label: string; run(): void }, options?: { duration?: number }) =>
          void toasts.push({ text, label: action?.label, duration: options?.duration, run: action?.run }),
      },
    };
    const stop = watchFirstWrite(ctx as unknown as Parameters<typeof watchFirstWrite>[0], environment);
    return { ctx, vfs, settings, toasts, stop, store };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('shows the tab text once, at the first file written by this window, with Got it, until answered', async () => {
    const w = await windowWith(person);
    expect(w.toasts).toEqual([]);
    await w.vfs.writeFile('/browser/only-copy.X68', new Uint8Array([0x2a]));
    await settle();
    expect(w.toasts.map(({ text, label, duration }) => ({ text, label, duration }))).toEqual([
      { text: STORAGE_NOTICE_TAB_TEXT, label: STORAGE_NOTICE_DISMISS_CAPTION, duration: 0 },
    ]);
    expect(storageNoticeSeenIn(w.ctx)).toBe(true);
    await w.vfs.writeFile('/browser/second.X68', new Uint8Array([0x2a]));
    await settle();
    expect(w.toasts).toHaveLength(1);
    // Got it in the note is the panel's Got it: remembered for this browser.
    w.toasts[0]?.run?.();
    expect(storageNoticeAcknowledged(w.ctx)).toBe(true);
    w.stop();
    w.settings.dispose();
  }, 30_000);

  it('shows nothing when the panel had the notice on the screen, after Got it, or where it is not due', async () => {
    const seen = await windowWith(person);
    markStorageNoticeSeen(seen.ctx);
    await seen.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const acknowledged = await windowWith(person);
    acknowledgeStorageNotice(acknowledged.ctx);
    await acknowledged.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const chromium = await windowWith({ ...person, engine: 'other' });
    await chromium.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const automated = await windowWith({ ...person, automated: true });
    await automated.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const desktop = await windowWith(person, 'desktop');
    await desktop.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    await settle();
    for (const w of [seen, acknowledged, chromium, automated, desktop]) {
      expect(w.toasts).toEqual([]);
      w.stop();
      w.settings.dispose();
    }
  }, 30_000);

  it('under automation with storage-notice=1 it is shown as for a person; the installed app only with an empty store', async () => {
    const forced = await windowWith({ ...person, automated: true, forced: true });
    await forced.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const installedEmpty = await windowWith({ ...person, installed: true });
    await settle(); // the emptiness at start is asked before the first write
    await installedEmpty.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    const installedFull = await windowWith({ ...person, installed: true }, 'web', true);
    await settle();
    await installedFull.vfs.writeFile('/browser/a.X68', new Uint8Array([0x2a]));
    await settle();
    expect(forced.toasts.map((toast) => toast.text)).toEqual([STORAGE_NOTICE_TAB_TEXT]);
    expect(installedEmpty.toasts.map((toast) => toast.text)).toEqual([STORAGE_NOTICE_INSTALLED_TEXT]);
    expect(installedFull.toasts).toEqual([]);
    for (const w of [forced, installedEmpty, installedFull]) {
      w.stop();
      w.settings.dispose();
    }
  }, 30_000);
});

describe('the environment', () => {
  it('engineOf: WebKit by navigator.vendor, not by the product name', () => {
    expect(engineOf('Apple Computer, Inc.')).toBe('webkit');
    expect(engineOf('Google Inc.')).toBe('other');
    expect(engineOf('')).toBe('other');
    expect(engineOf(undefined)).toBe('other');
  });

  it("engineOf is the application's one rule (core/help/engine.ts), which the Help frame uses too", () => {
    expect(engineOf).toBe(coreEngineOf);
  });

  it('forcedBy: storage-notice=1 in the query, nothing else', () => {
    expect(forcedBy('?storage-notice=1')).toBe(true);
    expect(forcedBy('?open=x&storage-notice=1')).toBe(true);
    expect(forcedBy('?storage-notice=0')).toBe(false);
    expect(forcedBy('?storage-notice')).toBe(false);
    expect(forcedBy('')).toBe(false);
  });
});

describe('the acknowledgement', () => {
  it('is a per-browser setting: it survives a reload and reaches another window', () => {
    const storage = new MemorySettingsStorage();
    const first = createSettingsService(storage.window());
    const other = createSettingsService(storage.window());
    expect(storageNoticeAcknowledged({ settings: first })).toBe(false);
    acknowledgeStorageNotice({ settings: first });
    expect(storageNoticeAcknowledged({ settings: first })).toBe(true);
    expect(storageNoticeAcknowledged({ settings: other })).toBe(true);
    const reloaded = createSettingsService(storage.window());
    expect(storageNoticeAcknowledged({ settings: reloaded })).toBe(true);
    expect(JSON.parse(storage.text ?? '{}').app.storageNoticeSeen).toBe(true);
    for (const service of [first, other, reloaded]) service.dispose();
  });

  it('a stored value other than true is not an acknowledgement', () => {
    const storage = new MemorySettingsStorage(JSON.stringify({ version: 1, app: { storageNoticeSeen: 'yes' } }));
    const service = createSettingsService(storage.window());
    expect(storageNoticeAcknowledged({ settings: service })).toBe(false);
    service.dispose();
  });
});

describe('the store', () => {
  it('storeKindOf tells the browser store, a pending one, the memory stand-in and none apart', async () => {
    expect(storeKindOf(undefined)).toBe('none');
    expect(storeKindOf(new UnsavedBrowserStore('blocked'))).toBe('memory');
    expect(storeKindOf(new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'x' }))).toBe('none');
    let settle: (backend: FileSystemBackend) => void = () => {};
    const pending = new PendingBrowserStore(new Promise((resolve) => (settle = resolve)));
    expect(storeKindOf(pending)).toBe('pending');
    settle(new UnsavedBrowserStore('timed out'));
    await pending.whenReady();
    expect(storeKindOf(pending)).toBe('memory');
  });

  it('storeEmptyAtStart answers once per window, also after the store has been filled', async () => {
    const vfs = createVfs();
    vfs.mount(new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' }));
    const ctx = { vfs };
    expect(await storeEmptyAtStart(ctx)).toBe(true);
    await vfs.writeFile('/browser/prog.X68', new Uint8Array([0x2a]));
    expect(await storeEmptyAtStart(ctx)).toBe(true);
    expect(await storeEmptyAtStart({ vfs })).toBe(false);
  });
});
