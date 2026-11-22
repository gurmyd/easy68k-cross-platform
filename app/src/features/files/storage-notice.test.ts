// The Safari storage notice (R-10): the decision for every combination of its inputs, the engine
// test, the query parameter, the acknowledgement in the settings (per browser, survives a reload,
// heard by another window) and the store's kinds.

import { describe, expect, it } from 'vitest';
import type { FileSystemBackend } from '../../contracts';
import { createSettingsService, MemorySettingsStorage } from '../../core/settings/service';
import { PendingBrowserStore, UnsavedBrowserStore } from '../../fs/browser-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import {
  STORAGE_NOTICE_INSTALLED_TEXT,
  STORAGE_NOTICE_TAB_TEXT,
  acknowledgeStorageNotice,
  engineOf,
  forcedBy,
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
    expect(STORAGE_NOTICE_INSTALLED_TEXT).toContain('separate from Safari');
  });
});

describe('the environment', () => {
  it('engineOf: WebKit by navigator.vendor, not by the product name', () => {
    expect(engineOf('Apple Computer, Inc.')).toBe('webkit');
    expect(engineOf('Google Inc.')).toBe('other');
    expect(engineOf('')).toBe('other');
    expect(engineOf(undefined)).toBe('other');
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
