// Helpers for tests with several windows on one store (ARCHITECTURE.md 3.8.6, 3.9.4). Owner: X1.
//
// A "window" is a page of one browser context: pages of a context share the origin's storage,
// Web Locks and BroadcastChannels, as tabs of one browser profile do.

import { expect } from '@playwright/test';
import type { App } from './app';

/** The offer's text (3.9.4). */
export const DRAFTS_OFFER = 'Unsaved changes from your last session were found for';

/**
 * The number of drafts in IndexedDB `easy68k.drafts` (database and store named in
 * docs/porting/errata/E1.md entry 13). Read-only; -1 when the database cannot be read.
 */
export function draftCount(app: App): Promise<number> {
  return app.page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('easy68k.drafts');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('drafts')) {
            db.close();
            resolve(0);
            return;
          }
          const request = db.transaction('drafts', 'readonly').objectStore('drafts').count();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            resolve(-1);
          };
        };
      }),
  );
}

/** Waits until the window's modified documents are in the drafts store (written 2 s after a change). */
export async function waitForDrafts(app: App, count: number): Promise<void> {
  await expect.poll(() => draftCount(app), { timeout: 30_000 }).toBe(count);
}

/**
 * Waits until no window is checking for drafts or offering them: the offer lock
 * (`easy68k.drafts.offer`, E1 errata entry 13) is free. A window asks for that lock while the
 * application starts, before its shell is drawn (features/documents/drafts.ts runs in the feature's
 * init), so once a window is `ready()` and the lock is free, its check is over. A window that shows
 * the offer holds the lock until the offer is answered.
 */
export async function draftsCheckDone(app: App): Promise<void> {
  await expect
    .poll(
      () =>
        app.page.evaluate(() =>
          navigator.locks.request('easy68k.drafts.offer', { ifAvailable: true }, (lock) => lock !== null),
        ),
      { message: 'the drafts offer lock becomes free (no window is offering drafts)' },
    )
    .toBe(true);
}

/** Closes a window the way a crash would: no unload handlers run. */
export async function crash(app: App): Promise<void> {
  await app.page.close({ runBeforeUnload: false });
}
