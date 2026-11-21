import { describe, expect, it } from 'vitest';
import type { NativeMenuItem } from '../contracts';
import {
  DESKTOP_BRIDGE_KEYS,
  createDesktopPlatformWith,
  isHelpPage,
  parseStartup,
  type DesktopBridge,
} from './desktop';

interface Recorded {
  calls: [string, ...unknown[]][];
  emit: Record<string, ((...args: unknown[]) => void) | undefined>;
}

function fakeBridge(
  overrides: Partial<DesktopBridge> = {},
  startup?: unknown,
): { bridge: DesktopBridge; rec: Recorded } {
  const rec: Recorded = { calls: [], emit: {} };
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      rec.calls.push([name, ...args]);
      return result;
    };
  const subscribe = (name: string) => (listener: (...args: unknown[]) => void) => {
    rec.emit[name] = listener;
    return () => {
      rec.emit[name] = undefined;
    };
  };
  const bridge: DesktopBridge = {
    version: 1,
    startup: async () =>
      startup ?? {
        os: 'mac',
        args: { file: '/disk/Users/me/a.S68', run: true, fullScreen: false, exceptions: false, bitField: true },
        userData: '/disk/Users/me/Library/Application Support/EASy68K',
        testMode: false,
      },
    fs: async (...args) => record('fs', { ok: true, value: null })(...args),
    fsSync: record('fsSync', null),
    onFsChange: subscribe('fsChange') as DesktopBridge['onFsChange'],
    setMenu: record('setMenu'),
    onMenuCommand: subscribe('menuCommand') as DesktopBridge['onMenuCommand'],
    onOpenFiles: subscribe('openFiles') as DesktopBridge['onOpenFiles'],
    setTitle: record('setTitle'),
    openExternal: record('openExternal'),
    showHelp: record('showHelp'),
    newWindow: record('newWindow'),
    pasteIntoFocus: record('pasteIntoFocus'),
    quit: record('quit'),
    setFullScreen: async (on) => record('setFullScreen', true)(on),
    print: async (...args) => record('print')(...args),
    showOpenDialog: async () => ['/disk/Users/me/demo/a.X68'],
    showSaveDialog: async () => '/disk/Users/me/demo/b.X68',
    chooseFolder: async () => '/disk/Users/me/Examples',
    grantDroppedFile: async (...args) =>
      record('grantDroppedFile', { path: '/disk/Users/me/demo/c.X68', kind: 'file' })(...args),
    devices: { request: record('device'), on: (_channel, listener) => subscribe('device')(listener) },
    ...overrides,
  };
  return { bridge, rec };
}

function fakeWin() {
  const listeners = new Map<string, Set<unknown>>();
  return {
    listeners,
    win: {
      crypto: globalThis.crypto,
      addEventListener: (type: string, listener: unknown) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: unknown) => void listeners.get(type)?.delete(listener),
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener' | 'crypto'>,
  };
}

describe('createDesktopPlatform', () => {
  it('describes the desktop app from the start-up information', async () => {
    const { bridge } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    expect(platform.kind).toBe('desktop');
    expect(platform.os).toBe('mac');
    expect(platform.windowId).toMatch(/^[0-9a-f]{24}$/);
    expect(platform.startupArgs()).toEqual({
      file: '/disk/Users/me/a.S68',
      run: true,
      fullScreen: false,
      exceptions: false,
      bitField: true,
    });
    expect(platform.userDataDir).toBe('/disk/Users/me/Library/Application Support/EASy68K');
    expect(platform.disk.mount).toBe('disk');
    expect(platform.disk.label).toBe('This Mac');
    expect(platform.syncFiles.unsettled).toBe(false);
    expect(platform.serial).not.toBeNull();
    expect(platform.net).not.toBeNull();
    expect(typeof platform.setFullScreen).toBe('function');
    expect(typeof platform.pasteIntoFocus).toBe('function');
  });

  it('every window gets its own id', async () => {
    const a = await createDesktopPlatformWith({ bridge: fakeBridge().bridge, win: fakeWin().win });
    const b = await createDesktopPlatformWith({ bridge: fakeBridge().bridge, win: fakeWin().win });
    expect(a.windowId).not.toBe(b.windowId);
  });

  it('refuses another bridge version and malformed start-up information', async () => {
    await expect(
      createDesktopPlatformWith({ bridge: fakeBridge({ version: 2 }).bridge, win: fakeWin().win }),
    ).rejects.toThrow(/version 2/);
    expect(() => parseStartup(null)).toThrow();
    expect(() => parseStartup({ os: 'beos', args: {}, userData: '/disk/x' })).toThrow(/unknown OS/);
    expect(() => parseStartup({ os: 'mac', args: { file: 3, run: 1 }, userData: '/disk/x' })).toThrow(
      /start-up arguments/,
    );
    expect(() =>
      parseStartup({
        os: 'mac',
        args: { file: null, run: false, fullScreen: false, exceptions: false, bitField: false },
        userData: 'C:\\x',
      }),
    ).toThrow(/user-data/);
  });

  it('passes the menu, the title and window commands to the main process', async () => {
    const { bridge, rec } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    const menu: NativeMenuItem[] = [{ type: 'submenu', label: 'File', items: [{ id: 'ed.file.new', label: 'New' }] }];
    platform.setNativeMenu(menu);
    platform.setTitle('EASy68K Editor/Assembler v5.16.01 - unofficial port 0.0.0');
    platform.newWindow();
    platform.pasteIntoFocus!();
    platform.quit();
    expect(await platform.setFullScreen!(true)).toBe(true);
    await platform.print('<p>x</p>', 'Listing');
    expect(rec.calls).toEqual([
      ['setMenu', menu],
      ['setTitle', 'EASy68K Editor/Assembler v5.16.01 - unofficial port 0.0.0'],
      ['newWindow'],
      ['pasteIntoFocus'],
      ['quit'],
      ['setFullScreen', true],
      ['print', '<p>x</p>', 'Listing'],
    ]);
  });

  it('opens only allow-listed links and only help pages inside the help folder', async () => {
    const { bridge, rec } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    platform.openExternal('https://github.com/gurmyd/easy68k-mac');
    platform.openExternal('https://example.com/');
    platform.openExternal('file:///etc/passwd');
    expect(platform.showHelp('main.htm')).toBe(true);
    expect(platform.showHelp('Simulator/sim_basic.htm#run')).toBe(true);
    expect(platform.showHelp('../secret.htm')).toBe(false);
    expect(platform.showHelp('/abs.htm')).toBe(false);
    expect(platform.showHelp('page.js')).toBe(false);
    expect(rec.calls).toEqual([
      ['openExternal', 'https://github.com/gurmyd/easy68k-mac'],
      ['showHelp', 'main.htm'],
      ['showHelp', 'Simulator/sim_basic.htm#run'],
    ]);
    expect(isHelpPage('a b/c.html')).toBe(true);
  });

  it('delivers menu commands and opened files from the main process', async () => {
    const { bridge, rec } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    const commands: unknown[] = [];
    const files: unknown[] = [];
    const stopCommands = platform.onNativeCommand((id, arg) => commands.push([id, arg]));
    const stopFiles = platform.onOpenFiles((list) => files.push(list));
    rec.emit['menuCommand']!('sim.run.run', undefined);
    rec.emit['menuCommand']!(42);
    rec.emit['openFiles']!(['/disk/Users/me/a.X68']);
    rec.emit['openFiles']!(['C:\\not-a-vpath']);
    expect(commands).toEqual([['sim.run.run', undefined]]);
    expect(files).toEqual([['/disk/Users/me/a.X68']]);
    stopCommands();
    stopFiles();
    expect(rec.emit['menuCommand']).toBeUndefined();
    expect(rec.emit['openFiles']).toBeUndefined();
  });

  it('confirmBeforeUnload adds and removes one beforeunload guard', async () => {
    const { win, listeners } = fakeWin();
    const platform = await createDesktopPlatformWith({ bridge: fakeBridge().bridge, win });
    platform.confirmBeforeUnload(true);
    platform.confirmBeforeUnload(true);
    expect(listeners.get('beforeunload')?.size).toBe(1);
    platform.confirmBeforeUnload(false);
    expect(listeners.get('beforeunload')?.size).toBe(0);
  });

  it('native file dialogs return VPaths of /disk or null', async () => {
    const platform = await createDesktopPlatformWith({ bridge: fakeBridge().bridge, win: fakeWin().win });
    const request = { title: 'Open', filters: [{ label: 'Source', patterns: ['*.X68'] }], multiple: false };
    expect(await platform.nativeFileDialogs.open(request)).toEqual(['/disk/Users/me/demo/a.X68']);
    expect(await platform.nativeFileDialogs.save({ title: 'Save', filters: [], defaultExt: 'X68' })).toBe(
      '/disk/Users/me/demo/b.X68',
    );
    expect(await platform.nativeFileDialogs.chooseFolder('Examples')).toBe('/disk/Users/me/Examples');
    const cancelled = await createDesktopPlatformWith({
      bridge: fakeBridge({ showOpenDialog: async () => null, showSaveDialog: async () => 7 }).bridge,
      win: fakeWin().win,
    });
    expect(await cancelled.nativeFileDialogs.open(request)).toBeNull();
    expect(await cancelled.nativeFileDialogs.save({ title: 'Save', filters: [], defaultExt: 'X68' })).toBeNull();
  });

  it('names a dropped file through the bridge and checks the answer', async () => {
    const { bridge, rec } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    const file = new File([new Uint8Array(1)], 'c.X68');
    expect(await platform.grantDroppedFile(file)).toEqual({ path: '/disk/Users/me/demo/c.X68', kind: 'file' });
    expect(rec.calls).toEqual([['grantDroppedFile', file]]);
    for (const answer of [null, 'x', { path: '/web/c.X68', kind: 'file' }, { path: '/disk/a', kind: 'link' }]) {
      const other = await createDesktopPlatformWith({
        bridge: fakeBridge({ grantDroppedFile: async () => answer }).bridge,
        win: fakeWin().win,
      });
      expect(await other.grantDroppedFile(file), JSON.stringify(answer)).toBeNull();
    }
  });

  it('hands the device bridge of the preload script to the device parts', async () => {
    const { bridge, rec } = fakeBridge();
    const platform = await createDesktopPlatformWith({ bridge, win: fakeWin().win });
    expect(platform.deviceBridge).toBe(bridge.devices);
    platform.deviceBridge.request('serial.open', 'COM1');
    expect(rec.calls).toEqual([['device', 'serial.open', 'COM1']]);
    platform.bindDeviceSources({ portMap: () => ({ COM1: '/dev/tty.usbserial' }), memory: () => new Uint8Array(16) });
  });

  it('the list of bridge members matches the fake (and so the documented interface)', () => {
    expect(Object.keys(fakeBridge().bridge).sort()).toEqual([...DESKTOP_BRIDGE_KEYS].sort());
  });
});
