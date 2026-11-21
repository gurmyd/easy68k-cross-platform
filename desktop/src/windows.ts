// Application windows (ARCHITECTURE.md 3.8.6, 7.6, 2.5). Every window is a complete, independent
// instance of the web app with its own engines; a second one is created by the main process only
// (Platform.newWindow, `New Window`, Cmd+N). Each window gets the web preferences and guards of
// security.ts: navigation away from the app is cancelled, every window.open is denied (allowed
// links go to the system browser), no <webview>, keys other than the role chords never reach the
// menu (menu.ts), and a page that asks before unloading gets a native question.
//
// Also here: the help windows (Platform.showHelp: the original's help HTML, no JavaScript), the
// print window (Platform.print), window-level full screen for the Output panel (2.5).
//
// Test runs (tests/desktop/dev) set EASY68K_DESKTOP_TEST_WINDOWS: `hidden` creates every window
// without ever showing it, `inactive` shows it far off-screen without taking the focus. Nothing
// else sets it; without it windows are shown normally. A packaged app ignores it (main.ts).
//
// Owner: DV2.

import {
  BrowserWindow,
  dialog,
  shell,
  type Event,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import type { StartupArgs } from './associations';
import type { NativeMenus, MenuOs } from './menu';
import { isRoleChord } from './menu';
import {
  APP_WEB_PREFERENCES,
  CONTENT_WEB_PREFERENCES,
  helpLinkAction,
  isAllowedExternalUrl,
  isAppUrl,
} from './security';

/** How test runs want their windows (see the top of this file; security.ts developmentOverrides). */
export type TestWindowMode = 'hidden' | 'inactive' | null;

interface AppWindowEntry {
  window: BrowserWindow;
  startup: StartupArgs;
  loaded: boolean;
  help: BrowserWindow | null;
}

export interface AppWindowsOptions {
  /** Absolute path of the compiled preload script. */
  preload: string;
  /** The page every application window loads (app://easy68k/index.html or the dev server). */
  pageUrl: string;
  /** Origin of the page (security.ts pageOrigin()). */
  origin: string;
  os: MenuOs;
  menus: NativeMenus;
  testWindows: TestWindowMode;
  /** A window's page has loaded (deliver files that arrived early). */
  onLoaded?: (window: BrowserWindow) => void;
  /** A window entered or left full screen, by the page's request or the system's own means. */
  onFullScreenChange?: (window: BrowserWindow, on: boolean) => void;
}

/** Applies the navigation and window-open guards of 7.6 to any web contents. */
export function guardWebContents(contents: WebContents, allowNavigation: (url: string) => boolean): void {
  contents.on('will-navigate', (event, url) => {
    if (!allowNavigation(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!allowNavigation(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Where a test run puts windows that are shown: far outside every screen. */
const OFF_SCREEN = -32000;

export class AppWindows {
  private readonly entries = new Map<number, AppWindowEntry>();
  private lastFocused: number | null = null;

  constructor(private readonly options: AppWindowsOptions) {}

  /** A new application window with its own simulator. */
  create(startup: StartupArgs): BrowserWindow {
    const { options } = this;
    const test = options.testWindows;
    const window = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 640,
      minHeight: 400,
      show: false,
      title: 'EASy68K',
      ...(test ? { x: OFF_SCREEN, y: OFF_SCREEN, skipTaskbar: true } : {}),
      webPreferences: { ...APP_WEB_PREFERENCES, preload: options.preload },
    });
    const entry: AppWindowEntry = { window, startup, loaded: false, help: null };
    this.entries.set(window.id, entry);
    const id = window.id;

    guardWebContents(window.webContents, (url) => isAppUrl(url, options.origin));
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      // Only the chords of the role items this window's menu has reach the menu; every command
      // chord is the page's (7.6, menu.ts).
      window.webContents.setIgnoreMenuShortcuts(!isRoleChord(input, options.os, options.menus.roleChords(id)));
    });
    window.webContents.on('will-prevent-unload', (event) => {
      // The page asks before closing (Platform.confirmBeforeUnload): a program's unsaved output
      // or a modified document. Leaving is what preventDefault() allows.
      const choice = dialog.showMessageBoxSync(window, {
        type: 'question',
        buttons: ['Leave', 'Stay'],
        defaultId: 1,
        cancelId: 1,
        message: 'Leave EASy68K?',
        detail: 'Changes you made may not be saved.',
      });
      if (choice === 0) event.preventDefault();
    });
    window.webContents.on('did-finish-load', () => {
      entry.loaded = true;
      options.onLoaded?.(window);
    });
    window.on('enter-full-screen', () => options.onFullScreenChange?.(window, true));
    window.on('leave-full-screen', () => options.onFullScreenChange?.(window, false));
    window.on('focus', () => {
      this.lastFocused = id;
      options.menus.show(window);
    });
    window.on('closed', () => {
      const help = entry.help;
      if (help && !help.isDestroyed()) help.close();
      options.menus.forget(id);
      this.entries.delete(id);
      if (this.lastFocused === id) this.lastFocused = null;
    });
    window.once('ready-to-show', () => {
      if (test === 'hidden') return;
      if (test === 'inactive') window.showInactive();
      else window.show();
    });
    void window.loadURL(options.pageUrl);
    return window;
  }

  all(): BrowserWindow[] {
    return [...this.entries.values()].map((entry) => entry.window);
  }

  /** The window in front: the focused one, else the one focused last, else the newest. */
  front(): BrowserWindow | null {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && this.entries.has(focused.id)) return focused;
    if (this.lastFocused !== null) {
      const last = this.entries.get(this.lastFocused);
      if (last) return last.window;
    }
    const windows = this.all();
    return windows[windows.length - 1] ?? null;
  }

  /** The application window whose page sent an IPC message, or null. */
  windowOf(sender: WebContents): BrowserWindow | null {
    const window = BrowserWindow.fromWebContents(sender);
    return window && this.entries.get(window.id)?.window.webContents === sender ? window : null;
  }

  isLoaded(window: BrowserWindow): boolean {
    return this.entries.get(window.id)?.loaded ?? false;
  }

  startupOf(window: BrowserWindow): StartupArgs | null {
    return this.entries.get(window.id)?.startup ?? null;
  }

  /**
   * True if the message comes from the main frame of an application window that shows the app's
   * page (7.6: "Every IPC handler validates ... the window that sent them").
   */
  trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    if (this.windowOf(event.sender) === null) return false;
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null) return false;
    return isAppUrl(frame.url, this.options.origin);
  }

  /** Window-level full screen (2.5). Resolves to whether the window is in the asked state. */
  setFullScreen(window: BrowserWindow, on: boolean): Promise<boolean> {
    if (window.isFullScreen() === on) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.off('enter-full-screen', done);
        window.off('leave-full-screen', done);
        resolve(!window.isDestroyed() && window.isFullScreen() === on);
      };
      const timer = setTimeout(done, 5000);
      window.on('enter-full-screen', done);
      window.on('leave-full-screen', done);
      window.setFullScreen(on);
    });
  }

  /**
   * Shows a page of the original's help (1.4 note 10) in the help window of `owner`: the help's
   * own HTML, without JavaScript; links inside the help stay in the window, links to the allowed
   * sites open in the system browser after the user confirms (7.6).
   */
  showHelp(owner: BrowserWindow, page: string): boolean {
    if (!isHelpPage(page)) return false;
    const entry = this.entries.get(owner.id);
    if (!entry) return false;
    const helpBase = `${this.options.origin}/help/`;
    const url = new URL(page, helpBase).toString();
    let help = entry.help;
    if (!help || help.isDestroyed()) {
      const test = this.options.testWindows;
      help = new BrowserWindow({
        width: 900,
        height: 700,
        show: false,
        title: 'EASy68K Help',
        ...(test ? { x: OFF_SCREEN, y: OFF_SCREEN, skipTaskbar: true } : {}),
        webPreferences: { ...CONTENT_WEB_PREFERENCES },
      });
      const created = help;
      entry.help = created;
      guardWebContents(created.webContents, (target) => target.startsWith(helpBase));
      created.webContents.on('will-navigate', (event, target) => {
        if (target.startsWith(helpBase) || !isAllowedExternalUrl(target)) return;
        event.preventDefault();
        askToOpenExternal(created, target);
      });
      // Links with target="_blank" (H1 errata 10): replaces the handler guardWebContents set.
      created.webContents.setWindowOpenHandler(({ url: target }) => {
        this.openFromHelp(created, target);
        return { action: 'deny' };
      });
      created.once('ready-to-show', () => {
        if (test === 'hidden') return;
        if (test === 'inactive') created.showInactive();
        else created.show();
      });
      created.on('closed', () => {
        if (entry.help === created) entry.help = null;
      });
    } else if (this.options.testWindows === null) {
      help.show();
    }
    void help.loadURL(url);
    return true;
  }

  /**
   * A link of a help window asked for a new window (security.ts helpLinkAction): a file of the
   * help folder (another page, the Quick Reference PDF) is shown in the help window itself, an
   * allow-listed web address goes to the system browser after the user confirms. Returns what
   * was done.
   */
  openFromHelp(help: BrowserWindow, target: string): 'help' | 'external' | 'deny' {
    const action = helpLinkAction(target, `${this.options.origin}/help/`);
    if (action === 'help' && !help.isDestroyed()) void help.loadURL(target);
    else if (action === 'external') askToOpenExternal(help, target);
    return action;
  }

  /** The help window of `owner`, for the tests. */
  helpWindowOf(owner: BrowserWindow): BrowserWindow | null {
    const help = this.entries.get(owner.id)?.help ?? null;
    return help && !help.isDestroyed() ? help : null;
  }
}

/** Asks whether to open an allow-listed address of a help page in the system browser (7.6). */
function askToOpenExternal(owner: BrowserWindow, target: string): void {
  void dialog
    .showMessageBox(owner, {
      type: 'question',
      buttons: ['Open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Open this page in your web browser?',
      detail: target,
    })
    .then(({ response }) => {
      if (response === 0 && isAllowedExternalUrl(target)) void shell.openExternal(target);
    });
}

/** A page name of the help folder: relative, no '..', an optional #anchor. */
export function isHelpPage(page: unknown): page is string {
  return (
    typeof page === 'string' &&
    page.length <= 200 &&
    /^[A-Za-z0-9_][A-Za-z0-9_\-. /]*\.html?(#[A-Za-z0-9_\-.:]*)?$/i.test(page) &&
    !page.split('/').includes('..')
  );
}

/**
 * Prints a prepared HTML document (Platform.print) through the system's print dialog, from a
 * hidden window without JavaScript. Resolves when the dialog has closed.
 */
export function printDocument(owner: BrowserWindow, html: string, title: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const printer = new BrowserWindow({
      show: false,
      parent: owner,
      title,
      webPreferences: { ...CONTENT_WEB_PREFERENCES },
    });
    guardWebContents(printer.webContents, () => false);
    const finish = () => {
      if (!printer.isDestroyed()) printer.close();
      resolve();
    };
    printer.webContents.once('did-finish-load', () => {
      printer.webContents.print({ silent: false, printBackground: false }, () => finish());
    });
    printer.webContents.once('did-fail-load', finish);
    void printer.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

/** Denies every permission request and check of a session's pages (7.6). */
export function denyAllPermissions(session: Electron.Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  session.on('select-serial-port', (event: Event, _ports, _contents, callback: (portId: string) => void) => {
    event.preventDefault();
    callback('');
  });
  session.on('select-hid-device', (event: Event, _details, callback: (deviceId?: string | null) => void) => {
    event.preventDefault();
    callback(null);
  });
  session.on('select-usb-device', (event: Event, _details, callback: (deviceId?: string) => void) => {
    event.preventDefault();
    callback();
  });
}
