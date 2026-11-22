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
 * Waits until no window is checking for drafts or offering them. Each window holds its own lock
 * `easy68k.drafts.check.<windowId>` for its whole start-up check, the wait for a window that may
 * have just ended included, and asks for it while the application starts, before its shell is drawn
 * (features/documents/drafts.ts runs in the feature's init; E1 errata entry 21). Since that entry the
 * offer lock (`easy68k.drafts.offer`) is taken only after the wait, so it alone no longer tells that
 * a check is over (X1 errata entry 11). A window that shows the offer holds both until it is answered.
 */
export async function draftsCheckDone(app: App): Promise<void> {
  await expect
    .poll(
      () =>
        app.page.evaluate(async () => {
          const held = ((await navigator.locks.query()).held ?? []).map((lock) => lock.name ?? '');
          const checking = held.filter((name) => name.startsWith('easy68k.drafts.check.')).length;
          const offerFree = await navigator.locks.request('easy68k.drafts.offer', { ifAvailable: true }, (l) => !!l);
          return checking === 0 && offerFree;
        }),
      { message: 'no window is checking for drafts or offering them (check locks and the offer lock are free)' },
    )
    .toBe(true);
}

/**
 * Closes a window the way a crash would: no unload handlers run. The browser may still list the
 * closed window's lock for a moment afterwards (10 to 360 ms measured in Chromium on Windows); the
 * application allows for that (E1 errata entry 19), so the test need not wait for it.
 */
export async function crash(app: App): Promise<void> {
  await app.page.close({ runBeforeUnload: false });
}

/**
 * What each window sees of the drafts, for the message of a failed expectation: the window locks
 * held, whether the offer lock is free, the drafts by window, and whether the offer is shown.
 */
export async function draftsDiagnosis(windows: readonly App[]): Promise<string> {
  const lines = await Promise.all(
    windows.map(async (app, index) => {
      if (app.page.isClosed()) return `window ${index}: closed`;
      const seen = await app.page
        .evaluate(async () => {
          const held = ((await navigator.locks.query()).held ?? [])
            .map((lock) => lock.name ?? '')
            .filter((name) => name.startsWith('easy68k.window.'))
            .map((name) => name.slice('easy68k.window.'.length, 'easy68k.window.'.length + 6));
          const checking = ((await navigator.locks.query()).held ?? [])
            .map((lock) => lock.name ?? '')
            .filter((name) => name.startsWith('easy68k.drafts.check.'))
            .map((name) => name.slice('easy68k.drafts.check.'.length, 'easy68k.drafts.check.'.length + 6));
          const offerFree = await navigator.locks.request('easy68k.drafts.offer', { ifAvailable: true }, (l) => !!l);
          const drafts = await new Promise<string[]>((resolve) => {
            const open = indexedDB.open('easy68k.drafts');
            open.onerror = () => resolve(['(cannot open)']);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains('drafts')) {
                db.close();
                return resolve(['(no store)']);
              }
              const all = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
              all.onsuccess = () => {
                db.close();
                resolve(
                  (all.result as { windowId: string; state: { name: string } }[]).map(
                    (r) => `${r.windowId.slice(0, 6)}:${r.state.name}`,
                  ),
                );
              };
              all.onerror = () => resolve(['(cannot read)']);
            };
          });
          return { held, checking, offerFree, drafts };
        })
        .catch((error: unknown) => ({ error: String(error) }));
      const offers = await app.page.getByText(DRAFTS_OFFER).count();
      return `window ${index}: offer shown ${offers}; ${JSON.stringify(seen)}`;
    }),
  );
  return lines.join('\n');
}

/** Runs an expectation; when it fails, the failure says what each window saw of the drafts. */
export async function withDraftsDiagnosis(windows: readonly App[], expectation: () => Promise<void>): Promise<void> {
  try {
    await expectation();
  } catch (error) {
    const diagnosis = await draftsDiagnosis(windows).catch((e: unknown) => `(no diagnosis: ${String(e)})`);
    if (error instanceof Error) error.message += `\n\nWhat the windows saw of the drafts:\n${diagnosis}`;
    throw error;
  }
}
