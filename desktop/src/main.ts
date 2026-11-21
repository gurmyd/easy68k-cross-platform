// The main process of the desktop app (ARCHITECTURE.md 7.6, 3.13). It registers the app://
// protocol, creates the application windows (windows.ts) and answers the page's bridge calls:
// files on disk (fs-ipc.ts, sync-ipc.ts), the native menu (menu.ts), file associations and the
// command line (associations.ts), dialogs, printing, help, full screen, new windows.
//
// Where the page comes from:
// - app://easy68k/index.html: the built web app. Packaged, that is the app/dist copied into the
//   app (electron-builder.yml, DV3: `<resources>/app/dist`); started from the repository, the
//   repository's app/dist. EASY68K_APP_DIST names another build (tests build into build/).
// - EASY68K_DEV_SERVER_URL: the Vite dev server of `npm run desktop:dev` (tools/desktop-dev.mjs).
//
// EASY68K_DESKTOP_TEST_WINDOWS (tests only) keeps windows hidden or off-screen (windows.ts) and
// installs `globalThis.__easy68kDesktopTest`, through which tests/desktop/dev inspects the main
// process (granted roots, the menus, the windows).
//
// A packaged app (app.isPackaged) honours none of these three variables (security.ts
// developmentOverrides): it always serves its own copy of app/dist and installs no test hooks.
//
// Owner: DV2.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type WebContents,
} from 'electron';
import {
  droppedPath,
  isExistingFile,
  LaunchFiles,
  NO_STARTUP_ARGS,
  OPEN_FILES_CHANNEL,
  parseCommandLine,
} from './associations';
import { type DiskChange, FS_CHANGE_CHANNEL, registerFsIpc } from './fs-ipc';
import {
  MENU_COMMAND_CHANNEL,
  MENU_SET_CHANNEL,
  MenuDescriptionError,
  NativeMenus,
  type MenuOs,
  snapshotMenu,
  windowlessMenuTemplate,
} from './menu';
import { APP_SCHEME_PRIVILEGES, registerAppProtocol } from './protocol';
import {
  APP_INDEX_URL,
  developmentOverrides,
  GrantedRoots,
  helpLinkAction,
  isAllowedExternalUrl,
  isShortString,
  pageOrigin,
  realPathOf,
  vpathOfRealPath,
  withDefaultExtension,
} from './security';
import { registerSyncIpc } from './sync-ipc';
import { AppWindows, denyAllPermissions, printDocument } from './windows';

const STARTUP_CHANNEL = 'e68:startup';
const WINDOW_CHANNEL = 'e68:window';
const FULL_SCREEN_CHANNEL = 'e68:full-screen';
const FULL_SCREEN_CHANGE_CHANNEL = 'e68:full-screen-change';
const PRINT_CHANNEL = 'e68:print';
const DIALOG_CHANNEL = 'e68:dialog';
const DROP_CHANNEL = 'e68:drop';

// ---- before ready ----------------------------------------------------------------------------------

// 7.6: the scheme is privileged before the app is ready.
protocol.registerSchemesAsPrivileged([APP_SCHEME_PRIVILEGES]);

const os: MenuOs = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
// The three development and test variables; a packaged app ignores them (security.ts).
const overrides = developmentOverrides(process.env, app.isPackaged);
const devServerUrl = overrides.devServerUrl;
const testWindows = overrides.testWindows;
const origin = pageOrigin(devServerUrl);

/** The built web app: EASY68K_APP_DIST (not packaged), the packaged copy, or the repository's app/dist. */
function appDistDir(): string {
  const override = overrides.appDist;
  if (override) return resolve(override);
  if (app.isPackaged) {
    // Next to the archive (extraResources) or inside it (files), whichever DV3's packaging uses.
    for (const packaged of [join(process.resourcesPath, 'app', 'dist'), join(app.getAppPath(), 'app', 'dist')]) {
      if (existsSync(join(packaged, 'index.html'))) return packaged;
    }
  }
  // desktop/dist/main.js -> <repository>/app/dist
  return resolve(__dirname, '..', '..', 'app', 'dist');
}

const grants = new GrantedRoots();
const menus = new NativeMenus(
  Menu,
  os,
  (window, id, arg) => window.webContents.send(MENU_COMMAND_CHANNEL, id, arg),
  () => windowlessMenuTemplate(() => windows?.create(NO_STARTUP_ARGS)),
);
let windows: AppWindows | null = null;

const launch = new LaunchFiles(grants, (vpaths) => {
  const target = windows?.front();
  if (!target || !windows?.isLoaded(target)) return false;
  target.webContents.send(OPEN_FILES_CHANNEL, vpaths);
  return true;
});

// macOS sends files of the association and of drops on the Dock icon, also before ready.
app.on('open-file', (event, path) => {
  event.preventDefault();
  launch.open(path);
  if (app.isReady() && windows && windows.all().length === 0) windows.create(launch.startupArgs(NO_STARTUP_ARGS));
});

// Every web contents of the app, whatever created it, gets the navigation and window guards.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// ---- IPC -------------------------------------------------------------------------------------------

function trusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return windows?.trusted(event) ?? false;
}

function senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  return trusted(event) ? (windows?.windowOf(event.sender) ?? null) : null;
}

/** Tells the other windows about a change on disk (3.8.6 rule 3). */
function broadcast(change: DiskChange, sender: WebContents): void {
  for (const window of windows?.all() ?? []) {
    if (window.webContents !== sender && !window.isDestroyed()) window.webContents.send(FS_CHANGE_CHANNEL, change);
  }
}

function userDataDir(): string {
  return app.getPath('userData');
}

/** Electron file filters from the page's FileFilter list (patterns like "*.X68"). */
function toFilters(filters: unknown): { name: string; extensions: string[] }[] {
  if (!Array.isArray(filters)) return [];
  const out: { name: string; extensions: string[] }[] = [];
  for (const filter of filters.slice(0, 32)) {
    const label = (filter as { label?: unknown } | null)?.label;
    const patterns = (filter as { patterns?: unknown } | null)?.patterns;
    if (!isShortString(label, 200) || !Array.isArray(patterns)) continue;
    const extensions = patterns
      .filter((pattern): pattern is string => isShortString(pattern, 64))
      .map((pattern) => (pattern === '*.*' || pattern === '*' ? '*' : pattern.replace(/^\*\./, '')))
      .filter((extension) => /^[A-Za-z0-9*]+$/.test(extension));
    if (extensions.length) out.push({ name: label, extensions });
  }
  return out;
}

/** The real path of a VPath of /disk given as a start folder or suggestion, or undefined. */
function realOfVPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/disk/')) return undefined;
  return realPathOf(value.slice('/disk/'.length)) ?? undefined;
}

async function answerDialog(event: IpcMainInvokeEvent, kind: unknown, request: unknown): Promise<unknown> {
  const window = senderWindow(event);
  if (!window) return null;
  const req = (request ?? {}) as Record<string, unknown>;
  if (kind === 'open') {
    const options: OpenDialogOptions = {
      title: isShortString(req['title'], 200) ? req['title'] : 'Open',
      properties: req['multiple'] === true ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: toFilters(req['filters']),
    };
    const start = realOfVPath(req['startDir']);
    if (start !== undefined) options.defaultPath = start;
    const result = await dialog.showOpenDialog(window, options);
    if (result.canceled || result.filePaths.length === 0) return null;
    for (const file of result.filePaths) grants.addFolderOf(file);
    return result.filePaths.map((file) => vpathOfRealPath(file)).filter((path) => path !== null);
  }
  if (kind === 'save') {
    const options: SaveDialogOptions = {
      title: isShortString(req['title'], 200) ? req['title'] : 'Save As',
      filters: toFilters(req['filters']),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const suggested = realOfVPath(req['suggested']);
    if (suggested !== undefined) options.defaultPath = suggested;
    const result = await dialog.showSaveDialog(window, options);
    if (result.canceled || !result.filePath) return null;
    const file = withDefaultExtension(result.filePath, req['defaultExt']);
    grants.addFolderOf(file);
    return vpathOfRealPath(file);
  }
  if (kind === 'folder') {
    const result = await dialog.showOpenDialog(window, {
      title: isShortString(request, 200) ? request : 'Choose a Folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    const folder = result.filePaths[0];
    if (result.canceled || folder === undefined) return null;
    grants.add(folder);
    return vpathOfRealPath(folder);
  }
  return null;
}

function registerIpc(): void {
  registerFsIpc(ipcMain, { grants, trusted, broadcast });
  registerSyncIpc(ipcMain, { grants, trusted, broadcast });

  ipcMain.handle(STARTUP_CHANNEL, (event) => {
    const window = senderWindow(event);
    if (!window) return null;
    return {
      os,
      args: windows?.startupOf(window) ?? NO_STARTUP_ARGS,
      userData: vpathOfRealPath(userDataDir()),
      testMode: testWindows !== null,
    };
  });

  ipcMain.on(MENU_SET_CHANNEL, (event, description: unknown) => {
    const window = senderWindow(event);
    if (!window) return;
    try {
      menus.set(window, description);
    } catch (error) {
      if (error instanceof MenuDescriptionError) console.error(`refused a menu: ${error.message}`);
      else throw error;
    }
  });

  ipcMain.on(WINDOW_CHANNEL, (event, op: unknown, value: unknown) => {
    const window = senderWindow(event);
    if (!window) return;
    switch (op) {
      case 'setTitle':
        if (isShortString(value, 1000)) window.setTitle(value);
        break;
      case 'openExternal':
        if (isAllowedExternalUrl(value)) void shell.openExternal(value);
        break;
      case 'showHelp':
        if (typeof value === 'string') windows?.showHelp(window, value);
        break;
      case 'newWindow':
        windows?.create(NO_STARTUP_ARGS);
        break;
      case 'paste':
        window.webContents.paste();
        break;
      case 'quit':
        app.quit();
        break;
    }
  });

  ipcMain.handle(FULL_SCREEN_CHANNEL, async (event, on: unknown) => {
    const window = senderWindow(event);
    if (!window || typeof on !== 'boolean') return false;
    return windows?.setFullScreen(window, on) ?? false;
  });

  ipcMain.handle(PRINT_CHANNEL, async (event, html: unknown, title: unknown) => {
    const window = senderWindow(event);
    if (!window || typeof html !== 'string' || html.length > 64 << 20 || !isShortString(title, 1000)) return;
    await printDocument(window, html, title);
  });

  ipcMain.handle(DIALOG_CHANNEL, (event, kind: unknown, request: unknown) => answerDialog(event, kind, request));

  // A file dropped on the window (preload: webUtils.getPathForFile). The folder of a dropped file
  // becomes a granted root (7.6); a dropped folder is only named (3.8.5: it becomes the start folder
  // of the Open dialog, whose choice grants it), never granted itself.
  ipcMain.handle(DROP_CHANNEL, (event, path: unknown) => {
    if (!senderWindow(event)) return null;
    const dropped = droppedPath(path);
    if (dropped === null) return null;
    if (dropped.kind === 'file') grants.addFolderOf(dropped.path);
    return { path: vpathOfRealPath(dropped.path), kind: dropped.kind };
  });
}

// ---- tests -----------------------------------------------------------------------------------------

/** What tests/desktop/dev may inspect and arrange in the main process (test runs only). */
function installTestHooks(): void {
  (globalThis as Record<string, unknown>)['__easy68kDesktopTest'] = {
    grants,
    grant: (dir: string) => grants.add(dir),
    roots: () => grants.list(),
    windowIds: () => windows?.all().map((window) => window.id) ?? [],
    menuDescription: (id: number) => menus.description(id),
    menuSnapshot: (id: number) => {
      const menu = menus.menu(id);
      return menu ? snapshotMenu(menu) : null;
    },
    applicationMenuSnapshot: () => {
      const menu = Menu.getApplicationMenu();
      return menu ? snapshotMenu(menu) : null;
    },
    /** Clicks a command item of a window's menu as the mouse would. */
    clickMenuItem: (id: number, itemId: string) => {
      const item = menus.menu(id)?.getMenuItemById(itemId);
      if (!item) return false;
      item.click({ triggeredByAccelerator: false } as never);
      return true;
    },
    /** The same item activated by its key (must be ignored). */
    acceleratorMenuItem: (id: number, itemId: string) => {
      const item = menus.menu(id)?.getMenuItemById(itemId);
      if (!item) return false;
      item.click({ triggeredByAccelerator: true } as never);
      return true;
    },
    /** The chords that may reach the macOS menu from this window (menu.ts roleChordsOf). */
    menuRoleChords: (id: number) => menus.roleChords(id) ?? null,
    /**
     * Performs a role item of a window's menu (the first with `role`) as Electron does for a click
     * on Windows and Linux: the role's method on that window's web contents (copy, paste, ...).
     * On macOS the system performs role items through the first responder instead, which a hidden
     * window does not have; false there, and when the menu has no such item.
     */
    clickRoleItem: (id: number, role: string) => {
      const window = BrowserWindow.fromId(id);
      const menu = menus.menu(id);
      if (!window || !menu || os === 'mac') return false;
      const find = (items: Electron.MenuItem[]): Electron.MenuItem | null => {
        for (const item of items) {
          if (item.role?.toLowerCase() === role.toLowerCase() && !item.submenu) return item;
          const inner = item.submenu ? find(item.submenu.items) : null;
          if (inner) return inner;
        }
        return null;
      };
      const item = find(menu.items);
      if (!item) return false;
      (item.click as unknown as (event: unknown, window: BrowserWindow, contents: WebContents) => void)(
        { triggeredByAccelerator: false },
        window,
        window.webContents,
      );
      return true;
    },
    /** A target="_blank" link of the help window of `id` asks for `url` (windows.ts openFromHelp). */
    openFromHelp: (id: number, url: string) => {
      const owner = BrowserWindow.fromId(id);
      const help = owner ? windows?.helpWindowOf(owner) : null;
      if (!help || !windows) return null;
      // An allow-listed web address would show a question; the tests ask only for its verdict.
      const action = helpLinkAction(url, `${origin}/help/`);
      return action === 'external' ? action : windows.openFromHelp(help, url);
    },
    helpWindowUrl: (id: number) => {
      const owner = BrowserWindow.fromId(id);
      const help = owner ? windows?.helpWindowOf(owner) : null;
      return help ? help.webContents.getURL() : null;
    },
    appDist: appDistDir(),
    origin,
  };
}

// ---- start -----------------------------------------------------------------------------------------

async function start(): Promise<void> {
  await app.whenReady();
  denyAllPermissions(session.defaultSession);
  registerAppProtocol(protocol, appDistDir());
  grants.add(userDataDir());
  registerIpc();
  if (testWindows !== null) installTestHooks();

  windows = new AppWindows({
    preload: join(__dirname, 'preload.js'),
    pageUrl: devServerUrl ?? APP_INDEX_URL,
    origin,
    os,
    menus,
    testWindows,
    onLoaded: () => launch.flush(),
    // Platform.onFullScreenChange: the green button or the system's own shortcut, which no
    // fullscreenchange event of the page reports (2.5).
    onFullScreenChange: (window, on) => {
      if (!window.isDestroyed()) window.webContents.send(FULL_SCREEN_CHANGE_CHANNEL, on);
    },
  });

  const commandLine = parseCommandLine(process.argv, {
    defaultApp: Boolean(process.defaultApp),
    cwd: process.cwd(),
    isFile: isExistingFile,
  });
  if (commandLine.realFile !== null) grants.addFolderOf(commandLine.realFile);
  windows.create(launch.startupArgs(commandLine.args));

  app.on('activate', () => {
    // macOS: a click on the Dock icon with no window open opens one.
    if (windows && windows.all().length === 0) windows.create(NO_STARTUP_ARGS);
  });
}

app.on('window-all-closed', () => {
  // A macOS app stays running without windows; Windows and Linux quit (development and tests).
  if (os !== 'mac' || testWindows !== null) app.quit();
});

start().catch((error: unknown) => {
  console.error('EASy68K could not start:', error);
  app.exit(1);
});
