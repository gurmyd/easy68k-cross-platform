// The Safari storage notice of the Files panel (ARCHITECTURE.md 10.1 risk R-10, 3.8.1; the gate's
// decision of the second round before I3, docs/porting/errata/FS1.md entry 28).
//
// Safari's engine deletes a site's script-writable storage after seven days without a visit unless
// the site is installed, and a site added to the Dock (or the Home Screen) is a separate app with
// its own, empty storage. So in a WebKit browser, while the files are kept in the browser's own
// store, the Files panel shows a short notice above the tree from the first start until the person
// presses `Got it`; that is remembered for this browser (AppSettings.storageNoticeSeen).
//
//   storageNoticeKind(input)   the pure decision: 'tab', 'installed' or null (tested under Node)
//   readNoticeEnvironment()    what the decision needs from the browser (engine, installed, automated)
//   storeKindOf(backend)       what the backend at /browser keeps
//
// Under automation (navigator.webdriver) the notice is not shown, so that every other browser
// check and end-to-end test sees the panel it always saw, except when the page's address carries
// `storage-notice=1`, which shows it as for a person (STORAGE_NOTICE_PARAM).
//
// Owner: FS1.

import type { AppContext, FileSystemBackend } from '../../contracts';
import { engineOf, type BrowserEngine } from '../../core/help/engine';
import { BrowserBackend, PendingBrowserStore, UnsavedBrowserStore } from '../../fs/browser-backend';
import { BROWSER_ROOT } from './store';

/**
 * The notice in a browser tab: both facts of R-10, in plain words. Every sentence is true wherever
 * the notice is shown: in Safari on a Mac, on an iPhone or iPad (where "Add to Dock" is "Add to
 * Home Screen") and in the other browsers there, which are WebKit too but not Safari; in the Files
 * panel and in the note shown at the first write when the panel is not on the screen (errata
 * FS1.md entry 28, third round).
 */
export const STORAGE_NOTICE_TAB_TEXT =
  'This browser may delete the programs kept here after seven days without a visit to this page. ' +
  'An app made with "Add to Dock" or "Add to Home Screen" starts with its own, empty My Programs. ' +
  'Use Export... in the Files panel to save them all as a .zip, and Import... in the app to bring them over.';

/** The notice in the installed app (display-mode standalone) while its store is empty. */
export const STORAGE_NOTICE_INSTALLED_TEXT =
  "This app keeps its own programs, apart from the browser's: Import... in the Files panel brings over programs exported there.";

/** The acknowledging button of both variants. */
export const STORAGE_NOTICE_DISMISS_CAPTION = 'Got it';
/** The other button: the Files panel's own Export... (the whole store) and Import... (Files or .zip). */
export const STORAGE_NOTICE_EXPORT_CAPTION = 'Export...';
export const STORAGE_NOTICE_IMPORT_CAPTION = 'Import...';
/** The notice's accessible name (role note). */
export const STORAGE_NOTICE_LABEL = 'About keeping your programs';

/** The query parameter that shows the notice under automation as for a person. */
export const STORAGE_NOTICE_PARAM = 'storage-notice';

// The browser engine: the application's one rule (core/help/engine.ts, erratum H1 11), which the
// Help frame's sandbox uses too. Re-exported here so that the names this file always had stay.
export { engineOf };
export type { BrowserEngine };

/**
 * What keeps the files at /browser: the browser's own store (IndexedDB), a store still opening
 * (which almost always becomes IndexedDB), the memory stand-in that keeps nothing (its own message
 * says so), or no browser store at all (the desktop app).
 */
export type StoreKind = 'indexeddb' | 'pending' | 'memory' | 'none';

export interface StorageNoticeInput {
  /** ctx.platform.kind: the notice exists only in the web version. */
  platform: 'web' | 'desktop';
  engine: BrowserEngine;
  /** The page runs as an installed app (display-mode standalone, or navigator.standalone). */
  installed: boolean;
  store: StoreKind;
  /** The store had no entry when this window first listed it (only the installed variant asks). */
  storeEmpty: boolean;
  /** AppSettings.storageNoticeSeen. */
  acknowledged: boolean;
  /** navigator.webdriver: the page is driven by a test. */
  automated: boolean;
  /** The page's address carries storage-notice=1. */
  forced: boolean;
}

/** Which notice the Files panel shows: in a browser tab, in the installed app, or none. */
export type StorageNoticeKind = 'tab' | 'installed' | null;

/** The decision of R-10 (errata FS1.md entry 28). */
export function storageNoticeKind(input: StorageNoticeInput): StorageNoticeKind {
  if (input.platform !== 'web' || input.engine !== 'webkit') return null;
  if (input.store !== 'indexeddb' && input.store !== 'pending') return null;
  if (input.acknowledged) return null;
  if (input.automated && !input.forced) return null;
  if (!input.installed) return 'tab';
  return input.storeEmpty ? 'installed' : null;
}

/** What keeps the files of the backend mounted at /browser. */
export function storeKindOf(backend: FileSystemBackend | undefined): StoreKind {
  if (!backend) return 'none';
  if (backend instanceof PendingBrowserStore) {
    const current = backend.current;
    return current === null ? 'pending' : storeKindOf(current);
  }
  if (backend instanceof UnsavedBrowserStore) return 'memory';
  if (backend instanceof BrowserBackend) return 'indexeddb';
  return 'none';
}

/** True when the address's query (location.search) asks for the notice: storage-notice=1. */
export function forcedBy(search: string): boolean {
  try {
    return new URLSearchParams(search).get(STORAGE_NOTICE_PARAM) === '1';
  } catch {
    return false;
  }
}

/** AppSettings.storageNoticeSeen: true only once `Got it` was pressed in this browser. */
export function storageNoticeAcknowledged(ctx: Pick<AppContext, 'settings'>): boolean {
  return ctx.settings.get().app.storageNoticeSeen === true;
}

/** `Got it`: remembered for this browser (every window of it hears the change). */
export function acknowledgeStorageNotice(ctx: Pick<AppContext, 'settings'>): void {
  if (storageNoticeAcknowledged(ctx)) return;
  ctx.settings.update((settings) => ({ ...settings, app: { ...settings.app, storageNoticeSeen: true } }));
}

/** The first answer of each window's context (the panel may mount several times). */
const emptyAtStart = new WeakMap<object, Promise<boolean>>();

/**
 * Whether the browser store had no entry when this window first asked. The installed variant is
 * shown only for an empty store; once decided it stays for the window, so that importing the
 * programs does not take the notice away before `Got it` (it is not shown after a reload then).
 */
export function storeEmptyAtStart(ctx: Pick<AppContext, 'vfs'>): Promise<boolean> {
  let answer = emptyAtStart.get(ctx);
  if (!answer) {
    answer = ctx.vfs.list(BROWSER_ROOT).then(
      (entries) => entries.length === 0,
      () => false,
    );
    emptyAtStart.set(ctx, answer);
  }
  return answer;
}

export interface NoticeEnvironment {
  engine: BrowserEngine;
  installed: boolean;
  automated: boolean;
  forced: boolean;
}

/** What the decision needs from the browser; an environment without a window has no notice. */
export function readNoticeEnvironment(): NoticeEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { engine: 'other', installed: false, automated: false, forced: false };
  }
  let standalone: boolean;
  try {
    standalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    standalone = false;
  }
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return {
    engine: engineOf(navigator.vendor),
    installed: standalone || iosStandalone,
    automated: navigator.webdriver === true,
    forced: forcedBy(window.location?.search ?? ''),
  };
}

// ---- the notice at the first write when the Files panel is not on the screen ----------------------
//
// R-10: "documents are never the only copy without that notice having been shown". The notice lives
// in the Files panel, which may be hidden (its visibility is remembered) or absent (Simulator mode,
// where a first visit with ?open= starts). So, while the notice is due and this window has not had
// it on the screen, the first write into the browser's store made by this window shows the same
// text as a note where the person is looking: a toast that stays until it is answered (Got it, which
// is the panel's Got it) or closed. Nothing changes for anyone to whom the notice is not due, and
// nothing is shown twice in a window (errata FS1.md entry 28, third round).

/** A change of the Vfs, as far as the first-write rule looks at it. */
export interface NoticeWriteChange {
  path: string;
  kind: 'write' | 'remove';
  origin: 'local' | 'external';
}

export interface NoticeAtWriteInput {
  /** storageNoticeKind() at the moment of the write. */
  due: StorageNoticeKind;
  /** The notice has been on the screen in this window (the Files panel showed it, or this note). */
  seen: boolean;
  change: NoticeWriteChange;
}

/**
 * Which notice the first write shows as a toast, or null: only a write by this window ('local') of
 * an entry below /browser (not the mount itself, which mount() reports as a write), while a notice
 * is due and this window has not shown it yet. Another window's write is that window's to note.
 */
export function noticeAtWrite(input: NoticeAtWriteInput): StorageNoticeKind {
  if (input.due === null || input.seen) return null;
  const { change } = input;
  if (change.kind !== 'write' || change.origin !== 'local') return null;
  if (!change.path.startsWith(`${BROWSER_ROOT}/`)) return null;
  return input.due;
}

/** Windows (contexts) in which the notice has been on the screen. */
const noticeSeen = new WeakMap<object, true>();

/** The Files panel showed the notice in this window. */
export function markStorageNoticeSeen(ctx: object): void {
  noticeSeen.set(ctx, true);
}

/** True once the notice has been on the screen in this window. */
export function storageNoticeSeenIn(ctx: object): boolean {
  return noticeSeen.has(ctx);
}

/** The element is rendered and visible (not inside a hidden panel or mode). */
export function onScreen(element: Element): boolean {
  const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') return check.call(element, { visibilityProperty: true });
  return element.getClientRects().length > 0;
}

/** The panel's notice is on the screen at this moment (in this window's document). */
export function storageNoticeOnScreen(): boolean {
  if (typeof document === 'undefined') return false;
  return [...document.querySelectorAll('[data-e68-storage-notice]')].some(onScreen);
}

/** The text of a notice of the given kind. */
export function storageNoticeText(kind: Exclude<StorageNoticeKind, null>): string {
  return kind === 'tab' ? STORAGE_NOTICE_TAB_TEXT : STORAGE_NOTICE_INSTALLED_TEXT;
}

/**
 * Listens for the first write into /browser (feature init). Returns the function that stops. The
 * environment is read once, as the panel reads it; the store's emptiness at start is asked at once
 * when the installed variant could be due, before any write of this window can change it.
 */
export function watchFirstWrite(
  ctx: Pick<AppContext, 'vfs' | 'settings' | 'dialogs' | 'platform'>,
  environment: NoticeEnvironment = readNoticeEnvironment(),
): () => void {
  if (ctx.platform.kind !== 'web' || environment.engine !== 'webkit') return () => {};
  let emptyAtStartNow = false;
  if (environment.installed) {
    void storeEmptyAtStart(ctx).then((empty) => {
      emptyAtStartNow = empty;
    });
  }
  let stopped = false;
  let unsubscribe: () => void = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe();
  };
  unsubscribe = ctx.vfs.subscribe(BROWSER_ROOT, (change) => {
    if (stopped) return;
    const browser = ctx.vfs.backends().find((backend) => backend.mount === 'browser');
    const due = storageNoticeKind({
      platform: ctx.platform.kind,
      ...environment,
      store: storeKindOf(browser),
      storeEmpty: emptyAtStartNow,
      acknowledged: storageNoticeAcknowledged(ctx),
    });
    const seen = storageNoticeSeenIn(ctx) || storageNoticeOnScreen();
    const kind = noticeAtWrite({ due, seen, change });
    if (kind === null) return;
    markStorageNoticeSeen(ctx);
    stop();
    ctx.dialogs.toast(
      storageNoticeText(kind),
      { label: STORAGE_NOTICE_DISMISS_CAPTION, run: () => acknowledgeStorageNotice(ctx) },
      { duration: 0 },
    );
  });
  if (stopped) unsubscribe();
  return stop;
}
