// Unit tests of the main-process modules of desktop/src that need no Electron: they run under the
// Node of the test runner. (The page-side halves, DiskBackend and DiskSyncFiles, and the file
// handlers against real folders are tested by `npm test`: app/src/fs/disk-backend.test.ts,
// app/src/fs/sync/disk.test.ts, app/src/platform/desktop.test.ts.)
//
// Owner: DV2.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { isAllowedExternalUrl as pageAllows } from '../../../app/src/platform/web';
import {
  droppedPath,
  LaunchFiles,
  NO_STARTUP_ARGS,
  parseCommandLine,
  programArguments,
} from '../../../desktop/src/associations';
import {
  chordOfInput,
  isRoleChord,
  MenuDescriptionError,
  NativeMenus,
  roleChordsOf,
  toElectronAccelerator,
  toElectronTemplate,
  typedChordOfInput,
  validateMenu,
  windowlessMenuTemplate,
  type NativeMenuItem,
} from '../../../desktop/src/menu';
import { APP_SCHEME_PRIVILEGES, CONTENT_TYPES, parseRange, resolveAppRequest } from '../../../desktop/src/protocol';
import {
  APP_WEB_PREFERENCES,
  CONTENT_SECURITY_POLICY,
  developmentOverrides,
  GrantedRoots,
  isAllowedExternalUrl,
  realPathOf,
  relOfRealPath,
  vpathOfRealPath,
  withDefaultExtension,
} from '../../../desktop/src/security';
import { createDiskSyncHandlers } from '../../../desktop/src/sync-ipc';
import { REPO, startDevServer } from './harness';

const scratch = mkdtempSync(join(tmpdir(), 'easy68k-unit-'));
test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test.describe('security.ts', () => {
  test('the Content Security Policy is the one the production build puts into index.html', async () => {
    const plugin = (await import(pathToFileURL(join(REPO, 'tools', 'vite-csp-plugin.mjs')).href)) as {
      CONTENT_SECURITY_POLICY: string;
    };
    expect(CONTENT_SECURITY_POLICY).toBe(plugin.CONTENT_SECURITY_POLICY);
  });

  test('a packaged app honours none of the development and test variables', () => {
    const env = {
      EASY68K_APP_DIST: '/somewhere/else',
      EASY68K_DEV_SERVER_URL: 'http://127.0.0.1:5173/',
      EASY68K_DESKTOP_TEST_WINDOWS: 'hidden',
    };
    expect(developmentOverrides(env, true)).toEqual({ appDist: undefined, devServerUrl: undefined, testWindows: null });
    expect(developmentOverrides(env, false)).toEqual({
      appDist: '/somewhere/else',
      devServerUrl: 'http://127.0.0.1:5173/',
      testWindows: 'hidden',
    });
    expect(developmentOverrides({ EASY68K_DESKTOP_TEST_WINDOWS: 'visible', EASY68K_APP_DIST: '' }, false)).toEqual({
      appDist: undefined,
      devServerUrl: undefined,
      testWindows: null,
    });
  });

  test('the web preferences are those of 7.6', () => {
    expect(APP_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      backgroundThrottling: false,
    });
  });

  test('the external-link allow list is the page one (platform/web.ts)', () => {
    const urls = [
      'https://github.com/gurmyd/easy68k-mac',
      'http://www.easy68k.com/',
      'https://easy68k.com/x',
      'https://api.github.com/repos/x',
      'https://evil.example/github.com',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'app://easy68k/index.html',
      'not a url',
    ];
    for (const url of urls) expect(isAllowedExternalUrl(url), url).toBe(pageAllows(url));
    expect(isAllowedExternalUrl(42)).toBe(false);
  });

  test('paths of /disk map to real paths and back', () => {
    expect(realPathOf('Users/me/x.X68', 'posix')).toBe('/Users/me/x.X68');
    expect(realPathOf('', 'posix')).toBe('/');
    expect(realPathOf('C:/Users/x', 'win32')).toBe('C:\\Users\\x');
    expect(realPathOf('C:', 'win32')).toBe('C:\\');
    for (const bad of ['/abs', 'a//b', 'a/../b', 'a/./b', 'a\\b', 'trail/', 'a\0b']) {
      expect(realPathOf(bad, 'posix'), bad).toBeNull();
    }
    expect(realPathOf('Users/x', 'win32')).toBeNull(); // no drive
    expect(realPathOf('', 'win32')).toBeNull();
    expect(realPathOf('C:/a:b', 'win32')).toBeNull();
    expect(realPathOf(7, 'posix')).toBeNull();
    expect(relOfRealPath('/Users/me/x.X68', 'posix')).toBe('Users/me/x.X68');
    expect(relOfRealPath('C:\\Users\\x', 'win32')).toBe('C:/Users/x');
    expect(relOfRealPath('relative/x', 'posix')).toBeNull();
    expect(relOfRealPath('\\\\server\\share\\x', 'win32')).toBeNull();
    expect(vpathOfRealPath('/Users/me/x.X68', 'posix')).toBe('/disk/Users/me/x.X68');
  });

  test('the Save dialog appends defaultExt in all three spellings of the contract (X68, .X68, *.X68)', () => {
    const typed = join(scratch, 'prog');
    for (const ext of ['X68', '.X68', '*.X68']) expect(withDefaultExtension(typed, ext), ext).toBe(`${typed}.X68`);
    // A name with its own extension keeps it.
    expect(withDefaultExtension(`${typed}.txt`, '*.X68')).toBe(`${typed}.txt`);
    // Nothing usable: nothing appended.
    for (const bad of ['', '*.*', '*', '.', 'X/68', '*.X68;*.S68', 'A'.repeat(17), 7, undefined]) {
      expect(withDefaultExtension(typed, bad), String(bad)).toBe(typed);
    }
  });

  test('granted roots: below a root is allowed, beside it is not, a link out of it is not', () => {
    const grants = new GrantedRoots();
    const root = join(scratch, 'granted');
    const beside = join(scratch, 'granted-not');
    mkdirSync(join(root, 'sub'), { recursive: true });
    mkdirSync(beside);
    grants.add(root);
    expect(grants.allows(join(root, 'sub', 'a.X68'))).toBe(true);
    expect(grants.allows(join(root, 'new', 'deeper', 'b.X68'))).toBe(true);
    expect(grants.allows(root)).toBe(true);
    expect(grants.allows(join(beside, 'a.X68'))).toBe(false);
    expect(grants.allows(join(root, '..', 'granted-not', 'a.X68'))).toBe(false);
    expect(grants.allows('relative/path')).toBe(false);
    let linked = true;
    try {
      symlinkSync(beside, join(root, 'link'), 'junction');
    } catch {
      linked = false;
    }
    if (linked) expect(grants.allows(join(root, 'link', 'a.X68'))).toBe(false);
    // A root that contains an old one replaces it.
    grants.add(join(root, 'sub'));
    grants.add(scratch);
    expect(grants.list()).toHaveLength(1);
    expect(() => grants.add('relative')).toThrow();
  });
});

test.describe('harness.ts', () => {
  test('the test dev server watches no file of app/, so edits elsewhere in the tree cannot reload a page', async () => {
    test.setTimeout(120_000);
    const server = await startDevServer();
    try {
      const app = join(REPO, 'app');
      const watched = server.watchedPaths().filter((path) => path === app || path.startsWith(app + sep));
      expect(watched).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

test.describe('protocol.ts', () => {
  const dist = join(scratch, 'dist');
  test.beforeAll(() => {
    mkdirSync(join(dist, 'assets'), { recursive: true });
    mkdirSync(join(dist, 'help'), { recursive: true });
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    writeFileSync(join(dist, 'assets', 'sim68k-loader-abc.mjs'), 'export {}');
    writeFileSync(join(dist, 'assets', 'sim68k-abc.wasm'), Uint8Array.of(0, 0x61, 0x73, 0x6d));
    writeFileSync(join(dist, 'assets', 'index-abc.js'), '');
    writeFileSync(join(dist, 'help', 'Main Page.htm'), '<p>');
    writeFileSync(join(dist, 'tool.exe'), 'MZ');
    writeFileSync(join(scratch, 'secret.txt'), 'secret');
  });

  test('the scheme has the privileges of 7.6', () => {
    expect(APP_SCHEME_PRIVILEGES).toEqual({
      scheme: 'app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    });
  });

  test('serves files of the folder with the content type of the table', async () => {
    const ok = async (url: string) => {
      const result = await resolveAppRequest(dist, url);
      expect(result.ok, url).toBe(true);
      return result.ok ? result.contentType : '';
    };
    expect(await ok('app://easy68k/index.html')).toBe('text/html; charset=utf-8');
    expect(await ok('app://easy68k/')).toBe('text/html; charset=utf-8');
    expect(await ok('app://easy68k/assets/sim68k-loader-abc.mjs')).toMatch(/^text\/javascript/);
    expect(await ok('app://easy68k/assets/index-abc.js')).toMatch(/^text\/javascript/);
    expect(await ok('app://easy68k/assets/sim68k-abc.wasm')).toBe('application/wasm');
    expect(await ok('app://easy68k/help/Main%20Page.htm')).toBe('text/html');
    expect(await ok('app://easy68k/index.html?x=1#y')).toBe('text/html; charset=utf-8');
    expect(CONTENT_TYPES['.X68'.toLowerCase()]).toBe('application/octet-stream');
  });

  test('refuses other hosts, methods, unknown extensions, escapes and missing files', async () => {
    const refused = async (url: string, method?: string) => {
      const result = await resolveAppRequest(dist, url, method);
      expect(result.ok, url).toBe(false);
      return result.ok ? 0 : result.status;
    };
    expect(await refused('app://other/index.html')).toBe(403);
    expect(await refused('app://easy68k:81/index.html')).toBe(403);
    expect(await refused('https://easy68k/index.html')).toBe(403);
    expect(await refused('app://easy68k/index.html', 'POST')).toBe(405);
    expect(await refused('app://easy68k/tool.exe')).toBe(403);
    expect(await refused('app://easy68k/assets')).toBe(403);
    expect(await refused('app://easy68k/missing.html')).toBe(404);
    // The URL parser resolves "%2e%2e" itself; what is left names a file that is not in the folder.
    expect(await refused('app://easy68k/%2e%2e/secret.txt')).toBeGreaterThanOrEqual(403);
    expect(await refused('app://easy68k/..%2fsecret.txt')).toBe(403);
    expect(await refused('app://easy68k/a%5c..%5c..%5csecret.txt')).toBe(400);
    expect(await refused('app://easy68k/a%00.html')).toBe(400);
    expect(await refused('app://easy68k/%E0%A4%A.html')).toBe(400);
  });

  test('every file extension of the web app has a content type (app/public, as the build copies it)', () => {
    const missing = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (!CONTENT_TYPES[extname(entry.name).toLowerCase()]) missing.add(`${extname(entry.name)} (${path})`);
      }
    };
    walk(join(REPO, 'app', 'public'));
    expect([...missing]).toEqual([]);
    expect(CONTENT_TYPES['.pdf']).toBe('application/pdf');
  });

  test('Range requests: one range is served piecewise, anything else whole or 416', () => {
    expect(parseRange(null, 100)).toBe('whole');
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('whole');
    expect(parseRange('items=0-1', 100)).toBe('whole');
    expect(parseRange('bytes=9-1', 100)).toBe('whole');
    expect(parseRange('bytes=-', 100)).toBe('whole');
  });

  test('refuses a link that leads out of the folder', async () => {
    let linked = true;
    try {
      symlinkSync(join(scratch, 'secret.txt'), join(dist, 'leak.txt'));
    } catch {
      linked = false;
    }
    test.skip(!linked, 'this machine does not allow creating symbolic links');
    const result = await resolveAppRequest(dist, 'app://easy68k/leak.txt');
    expect(result.ok).toBe(false);
  });
});

test.describe('menu.ts', () => {
  test('accelerators in Electron spelling', () => {
    const cases: [string, 'mac' | 'windows', string | null][] = [
      ['Cmd+O', 'mac', 'Command+O'],
      ['Shift+Cmd+S', 'mac', 'Shift+Command+S'],
      ['Ctrl+Alt+Z', 'mac', 'Control+Alt+Z'],
      ['Ctrl+Shift+.', 'windows', 'Control+Shift+.'],
      ['Ctrl+Shift+,', 'mac', 'Control+Shift+,'],
      ['F9', 'mac', 'F9'],
      ['Shift+F2', 'mac', 'Shift+F2'],
      ['Ctrl+F4', 'windows', 'Control+F4'],
      ['Alt+Enter', 'mac', 'Alt+Return'],
      ['Esc', 'windows', 'Escape'],
      ['Ctrl+PageDown', 'windows', 'Control+PageDown'],
      ['Shift+Insert', 'windows', 'Shift+Insert'],
      ['Cmd+/', 'mac', 'Command+/'],
      ['Ctrl+Tab', 'windows', 'Control+Tab'],
      ['Hyper+X', 'mac', null],
      ['Ctrl+', 'mac', null],
      ['Ctrl+Plus', 'mac', null],
    ];
    for (const [chord, os, expected] of cases) expect(toElectronAccelerator(chord, os), chord).toBe(expected);
  });

  test('only the role chords of macOS reach the menu', () => {
    const key = (code: string, mods: Partial<Record<'control' | 'alt' | 'shift' | 'meta', boolean>>) => ({
      key: code.replace(/^Key/, '').toLowerCase(),
      code,
      control: false,
      alt: false,
      shift: false,
      meta: false,
      ...mods,
    });
    expect(chordOfInput(key('KeyC', { meta: true }))).toBe('Cmd+C');
    for (const [code, mods] of [
      ['KeyC', { meta: true }],
      ['KeyV', { meta: true }],
      ['KeyX', { meta: true }],
      ['KeyA', { meta: true }],
      ['KeyZ', { meta: true }],
      ['KeyZ', { meta: true, shift: true }],
      ['KeyH', { meta: true }],
      ['KeyM', { meta: true }],
    ] as const) {
      expect(isRoleChord(key(code, mods), 'mac'), `${code} ${JSON.stringify(mods)}`).toBe(true);
      expect(isRoleChord(key(code, mods), 'windows')).toBe(false);
    }
    for (const [code, mods] of [
      ['KeyO', { meta: true }],
      ['KeyS', { meta: true, shift: true }],
      ['KeyZ', { control: true, alt: true }],
      ['KeyN', { meta: true }],
    ] as const) {
      expect(isRoleChord(key(code, mods), 'mac'), code).toBe(false);
    }
    expect(isRoleChord({ key: 'F9', code: 'F9', control: false, alt: false, shift: false, meta: false }, 'mac')).toBe(
      false,
    );
  });

  test('role chords go by the typed character, as macOS key equivalents do (Dvorak, AZERTY)', () => {
    const input = (
      key: string,
      code: string,
      mods: Partial<Record<'control' | 'alt' | 'shift' | 'meta', boolean>>,
    ) => ({
      key,
      code,
      control: false,
      alt: false,
      shift: false,
      meta: false,
      ...mods,
    });
    // Dvorak: "c" is on KeyJ, "v" on KeyPeriod, "x" on KeyB; the key KeyC types "j".
    expect(typedChordOfInput(input('c', 'KeyJ', { meta: true }))).toBe('Cmd+C');
    expect(isRoleChord(input('c', 'KeyJ', { meta: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('v', 'Period', { meta: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('x', 'KeyB', { meta: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('j', 'KeyC', { meta: true }), 'mac')).toBe(false);
    // AZERTY: "a" on KeyQ, "z" on KeyW; the key KeyA types "q" (Cmd+Q is Quit, a command item).
    expect(isRoleChord(input('a', 'KeyQ', { meta: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('Z', 'KeyW', { meta: true, shift: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('q', 'KeyA', { meta: true }), 'mac')).toBe(false);
    // Option changes the typed character (Option+H is "˙"): then the position decides.
    expect(isRoleChord(input('˙', 'KeyH', { meta: true, alt: true }), 'mac')).toBe(true);
    // A non-Latin layout (Russian "с" on KeyC): macOS goes by position.
    expect(isRoleChord(input('с', 'KeyC', { meta: true }), 'mac')).toBe(true);
    expect(isRoleChord(input('c', 'KeyJ', { meta: true }), 'windows')).toBe(false);
  });

  test('only the chords of the role items the menu has reach it (Editor: Undo and Redo are commands)', () => {
    const meta = (key: string, shift = false) => ({
      key,
      code: `Key${key.toUpperCase()}`,
      control: false,
      alt: false,
      shift,
      meta: true,
    });
    // The Editor's Edit menu (app/src/commands/native-menu.ts): Undo and Redo are command items,
    // Cut, Copy, Paste and Select All role items; the application and Window menus add theirs.
    const editor: NativeMenuItem[] = [
      { label: 'EASy68K', role: 'appMenu', items: [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }] },
      {
        label: 'Edit',
        items: [
          { id: 'ed.edit.undo', label: 'Undo', accelerator: 'Cmd+Z' },
          { id: 'ed.edit.redo', label: 'Redo', accelerator: 'Shift+Cmd+Z' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      { label: 'Window', role: 'window', items: [{ role: 'minimize' }, { role: 'zoom' }] },
    ];
    const chords = roleChordsOf(editor);
    expect([...chords].sort()).toEqual(['Alt+Cmd+H', 'Cmd+A', 'Cmd+C', 'Cmd+H', 'Cmd+M', 'Cmd+V', 'Cmd+X'].sort());
    expect(isRoleChord(meta('z'), 'mac', chords)).toBe(false);
    expect(isRoleChord(meta('Z', true), 'mac', chords)).toBe(false);
    expect(isRoleChord(meta('c'), 'mac', chords)).toBe(true);
    // The Simulator's standard Edit menu has the undo and redo roles: there Cmd+Z goes to the menu.
    const simulator: NativeMenuItem[] = [
      { label: 'Edit', role: 'editMenu', items: [{ role: 'undo' }, { role: 'redo' }, { role: 'copy' }] },
    ];
    expect(isRoleChord(meta('z'), 'mac', roleChordsOf(simulator))).toBe(true);
    expect(isRoleChord(meta('Z', true), 'mac', roleChordsOf(simulator))).toBe(true);
    expect(isRoleChord(meta('v'), 'mac', roleChordsOf(simulator))).toBe(false);

    // NativeMenus keeps the chords of each window's own menu.
    const api = { buildFromTemplate: () => ({}) as Electron.Menu, setApplicationMenu: () => {} };
    const menus = new NativeMenus(api, 'mac', () => {});
    const fakeWindow = { id: 7, isFocused: () => true, isDestroyed: () => false } as unknown as Electron.BrowserWindow;
    expect(menus.roleChords(7)).toBeUndefined();
    menus.set(fakeWindow, editor);
    expect(menus.roleChords(7)).toEqual(chords);
    menus.forget(7);
    expect(menus.roleChords(7)).toBeUndefined();
  });

  test('macOS with no window left: the bar gets a menu whose New Window opens one', () => {
    const installed: Electron.MenuItemConstructorOptions[][] = [];
    const fakeMenu = (template: Electron.MenuItemConstructorOptions[]) => ({ template }) as unknown as Electron.Menu;
    const api = {
      buildFromTemplate: fakeMenu,
      setApplicationMenu: (menu: Electron.Menu | null) => {
        installed.push((menu as unknown as { template: Electron.MenuItemConstructorOptions[] }).template);
      },
    };
    let created = 0;
    const fakeWindow = (id: number) =>
      ({ id, isDestroyed: () => false, isFocused: () => true }) as unknown as Electron.BrowserWindow;
    const menus = new NativeMenus(
      api,
      'mac',
      () => {},
      () => windowlessMenuTemplate(() => created++),
    );
    menus.set(fakeWindow(1), sample);
    menus.set(fakeWindow(2), sample);
    expect(installed).toHaveLength(2);
    menus.forget(1);
    expect(installed).toHaveLength(2);
    menus.forget(2);
    expect(installed).toHaveLength(3);
    const bar = installed[2] as Electron.MenuItemConstructorOptions[];
    expect(bar.map((menu) => menu.role ?? menu.label)).toEqual(['appMenu', 'File', 'windowMenu', 'help']);
    const newWindow = (bar[1]?.submenu as Electron.MenuItemConstructorOptions[])[0];
    expect(newWindow).toMatchObject({ label: 'New Window', accelerator: 'Command+N' });
    newWindow?.click?.({} as never, undefined, {} as never);
    expect(created).toBe(1);
    // Windows and Linux quit with the last window; nothing is installed there.
    const others: unknown[] = [];
    const win = new NativeMenus(
      { buildFromTemplate: fakeMenu, setApplicationMenu: (menu) => others.push(menu) },
      'windows',
      () => {},
      () => windowlessMenuTemplate(() => created++),
    );
    win.forget(7);
    expect(others).toEqual([]);
  });

  const sample: NativeMenuItem[] = [
    {
      type: 'submenu',
      label: 'EASy68K',
      role: 'appMenu',
      items: [
        { id: 'ed.help.about', label: 'About EASy68K', type: 'normal', enabled: true },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { id: 'ed.file.exit', label: 'Quit EASy68K', type: 'normal', enabled: true },
      ],
    },
    {
      type: 'submenu',
      label: '&File',
      items: [
        { id: 'ed.file.save', label: '&Save', type: 'normal', enabled: false, accelerator: 'Cmd+S' },
        { id: 'app.mode.set', arg: 'simulator', label: 'Sim', type: 'radio', checked: false, enabled: true },
      ],
    },
    { type: 'submenu', label: 'Window', role: 'window', items: [{ role: 'minimize' }, { role: 'zoom' }] },
  ];

  test('a menu description is checked before it is used', () => {
    expect(validateMenu(sample)).toEqual(sample);
    const bad: unknown[] = [
      'menu',
      [{ id: 'x', label: 'no dot' }],
      [{ label: 'neither id nor role' }],
      [{ role: 'shellExecute' }],
      [{ id: 'ed.file.new', onclick: 'x' }],
      [{ id: 'ed.file.new', arg: { nested: true } }],
      [{ id: 'ed.file.new', label: 'x'.repeat(500) }],
      [{ id: 'ed.file.new', enabled: 'yes' }],
      [{ type: 'submenu', role: 'cut', items: [] }],
      [null],
    ];
    for (const value of bad) expect(() => validateMenu(value), JSON.stringify(value)).toThrow(MenuDescriptionError);
    let deep: unknown = [{ id: 'ed.file.new' }];
    for (let i = 0; i < 10; i++) deep = [{ type: 'submenu', label: 'x', items: deep }];
    expect(() => validateMenu(deep)).toThrow(/deeply/);
  });

  test('the Electron template: roles by OS, accelerators only shown, clicks reported, accelerator clicks ignored', () => {
    const clicks: unknown[] = [];
    const mac = toElectronTemplate(sample, 'mac', (id, arg) => clicks.push([id, arg]));
    expect(mac[0]?.role).toBe('appMenu');
    expect(mac[2]?.role).toBe('window');
    const appItems = mac[0]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(appItems.map((item) => item.role ?? item.label ?? item.type)).toEqual([
      'About EASy68K',
      'separator',
      'services',
      'separator',
      'hide',
      'Quit EASy68K',
    ]);
    const file = mac[1]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(file[0]).toMatchObject({
      label: '&Save',
      enabled: false,
      accelerator: 'Command+S',
      registerAccelerator: false,
    });
    expect(file[1]).toMatchObject({ type: 'radio', checked: false, id: 'app.mode.set:"simulator"' });
    file[1]?.click?.({} as never, undefined, { triggeredByAccelerator: false } as never);
    file[1]?.click?.({} as never, undefined, { triggeredByAccelerator: true } as never);
    expect(clicks).toEqual([['app.mode.set', 'simulator']]);

    const windows = toElectronTemplate(sample, 'windows', () => {});
    expect(windows[0]?.role).toBeUndefined();
    const winApp = windows[0]?.submenu as Electron.MenuItemConstructorOptions[];
    // services and hide exist only on macOS; the separators around them collapse.
    expect(winApp.map((item) => item.role ?? item.label ?? item.type)).toEqual([
      'About EASy68K',
      'separator',
      'Quit EASy68K',
    ]);
    const winWindow = windows[2]?.submenu as Electron.MenuItemConstructorOptions[];
    expect(winWindow.map((item) => item.role)).toEqual(['minimize']);
  });
});

test.describe('associations.ts', () => {
  test('the command line: file, switches from the second argument on, Chromium switches ignored', () => {
    const file = join(scratch, 'tutorial1.S68');
    writeFileSync(file, 'S0');
    const env = { defaultApp: true, cwd: scratch, isFile: (p: string) => p === file };
    expect(programArguments(['electron', '.', '--inspect=0', 'a', '-psn_0_1', '/r'], true)).toEqual(['a', '/r']);
    // Playwright's switches come before the app folder.
    expect(
      programArguments(['electron', '--inspect=0', '--remote-debugging-port=0', 'C:\\app', 'f.S68'], true),
    ).toEqual(['f.S68']);
    expect(programArguments(['EASy68K', '--remote-debugging-port=0', 'f.S68', '/r'], false)).toEqual(['f.S68', '/r']);
    expect(parseCommandLine(['electron', '.', 'tutorial1.S68', '/r', '/F', '/E', '/b', '/x'], env)).toEqual({
      args: { file: vpathOfRealPath(file), run: true, fullScreen: true, exceptions: true, bitField: true },
      realFile: file,
    });
    // Only the slash forms, as SIM68Ku.cpp compares them (sim-ui 8.1); '-f' is no switch.
    expect(parseCommandLine(['electron', '.', 'tutorial1.S68', '-r', '-f', '-E', '-b'], env).args).toEqual({
      ...NO_STARTUP_ARGS,
      file: vpathOfRealPath(file),
    });
    // A switch as the first argument is not a switch (5.7: "only from the second argument on").
    expect(parseCommandLine(['electron', '.', '/r'], env).args).toEqual(NO_STARTUP_ARGS);
    expect(parseCommandLine(['electron', '.', 'missing.X68', '/r'], env).args.file).toBeNull();
    expect(parseCommandLine(['EASy68K', file], { ...env, defaultApp: false }).realFile).toBe(file);
  });

  test('files that arrive before the first window: the first is its start-up file, the rest follow', () => {
    const grants = new GrantedRoots();
    const delivered: string[][] = [];
    let canDeliver = false;
    const launch = new LaunchFiles(grants, (vpaths) => {
      if (!canDeliver) return false;
      delivered.push(vpaths);
      return true;
    });
    const a = join(scratch, 'early', 'a.S68');
    const b = join(scratch, 'early', 'b.X68');
    mkdirSync(join(scratch, 'early'), { recursive: true });
    launch.open(a);
    launch.open(b);
    expect(grants.allows(a)).toBe(true);
    expect(launch.startupArgs(NO_STARTUP_ARGS)).toEqual({ ...NO_STARTUP_ARGS, file: vpathOfRealPath(a) });
    launch.flush();
    expect(delivered).toEqual([]);
    canDeliver = true;
    launch.flush();
    expect(delivered).toEqual([[vpathOfRealPath(b)]]);
    const c = join(scratch, 'early', 'c.X68');
    launch.open(c);
    expect(delivered).toEqual([[vpathOfRealPath(b)], [vpathOfRealPath(c)]]);
  });
});

test.describe('drops and the synchronous read', () => {
  test('a dropped path is an existing absolute file or folder, else refused', () => {
    const file = join(scratch, 'dropped.X68');
    writeFileSync(file, 'x');
    expect(droppedPath(file)).toEqual({ path: file, kind: 'file' });
    expect(droppedPath(scratch)).toEqual({ path: scratch, kind: 'dir' });
    for (const bad of ['', 'dropped.X68', join(scratch, 'missing.X68'), `${file}\0`, 7, null]) {
      expect(droppedPath(bad), String(bad)).toBeNull();
    }
  });

  test('read() allocates at most what the file holds after the position', () => {
    const dir = join(scratch, 'big-read');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'small.bin'), Uint8Array.of(1, 2, 3));
    const grants = new GrantedRoots();
    grants.add(dir);
    const rel = relOfRealPath(join(dir, 'small.bin'));
    expect(rel).not.toBeNull();
    const handlers = createDiskSyncHandlers({ grants });
    const started = performance.now();
    const all = handlers.read(rel, 0, 1e9) as Uint8Array;
    expect(performance.now() - started).toBeLessThan(200);
    expect([...all]).toEqual([1, 2, 3]);
    expect(all.buffer.byteLength).toBeLessThanOrEqual(3);
    expect([...(handlers.read(rel, 2, 1e9) as Uint8Array)]).toEqual([3]);
    expect([...(handlers.read(rel, 3, 1e9) as Uint8Array)]).toEqual([]);
    expect([...(handlers.read(rel, 100, 1e9) as Uint8Array)]).toEqual([]);
  });
});

test('every channel of the preload script has its handler in the main process', () => {
  const read = (file: string) => readFileSync(join(REPO, 'desktop', 'src', file), 'utf8');
  const preload = read('preload.ts');
  const channels = [...preload.matchAll(/'(e68:[a-z-]+)'/g)].map((match) => match[1]);
  expect(channels.length).toBeGreaterThanOrEqual(13);
  const main = ['main.ts', 'fs-ipc.ts', 'sync-ipc.ts', 'menu.ts', 'associations.ts'].map(read).join('\n');
  for (const channel of channels) expect(main, channel).toContain(`'${channel}'`);
});
