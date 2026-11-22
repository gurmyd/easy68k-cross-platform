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
import { BrowserBackend, PendingBrowserStore, UnsavedBrowserStore } from '../../fs/browser-backend';
import { BROWSER_ROOT } from './store';

/** The notice in a browser tab: both facts of R-10, in plain words. */
export const STORAGE_NOTICE_TAB_TEXT =
  'Safari deletes the programs kept here after seven days without a visit to this page. ' +
  '"Add to Dock" makes a separate app that starts with its own, empty My Programs. ' +
  'Use Export... here to save them all as a .zip, and Import... in the app to bring them over.';

/** The notice in the installed app (display-mode standalone) while its store is empty. */
export const STORAGE_NOTICE_INSTALLED_TEXT =
  "This app keeps its own programs, separate from Safari's: use Import... to bring over programs you exported in Safari.";

/** The acknowledging button of both variants. */
export const STORAGE_NOTICE_DISMISS_CAPTION = 'Got it';
/** The other button: the Files panel's own Export... (the whole store) and Import... (Files or .zip). */
export const STORAGE_NOTICE_EXPORT_CAPTION = 'Export...';
export const STORAGE_NOTICE_IMPORT_CAPTION = 'Import...';
/** The notice's accessible name (role note). */
export const STORAGE_NOTICE_LABEL = 'About keeping programs in Safari';

/** The query parameter that shows the notice under automation as for a person. */
export const STORAGE_NOTICE_PARAM = 'storage-notice';

/** The browser engine, as far as the notice cares: Safari's (WebKit) or any other. */
export type BrowserEngine = 'webkit' | 'other';

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

/**
 * The browser engine from navigator.vendor. Every WebKit browser reports `Apple Computer, Inc.`:
 * Safari on macOS, iOS and iPadOS, every other browser on an iPhone or iPad (Chrome, Firefox, Edge
 * there are WebKit too), WebKitGTK, and Playwright's WebKit build on every system. Chromium-based
 * browsers report `Google Inc.`, Gecko reports an empty string. The product name in the user agent
 * is not consulted.
 */
export function engineOf(vendor: string | undefined): BrowserEngine {
  return vendor === 'Apple Computer, Inc.' ? 'webkit' : 'other';
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
