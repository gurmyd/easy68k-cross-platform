// The web platform bridge (ARCHITECTURE.md 3.13, 5.7, 7.6).

import { describe, expect, it } from 'vitest';
import { createWebPlatform, detectOs, isAllowedExternalUrl, parseStartupArgs } from './web';

describe('detectOs', () => {
  it('prefers userAgentData, then navigator.platform, then the user agent', () => {
    expect(detectOs({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('mac');
    expect(detectOs({ userAgentData: { platform: 'Windows' } })).toBe('windows');
    expect(detectOs({ platform: 'MacIntel' })).toBe('mac');
    expect(detectOs({ platform: 'Win32' })).toBe('windows');
    expect(detectOs({ platform: 'Linux x86_64' })).toBe('linux');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' })).toBe('mac');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('windows');
    expect(detectOs({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
    expect(detectOs({ userAgentData: { platform: '' }, platform: 'iPad' })).toBe('mac');
    expect(detectOs({})).toBe('linux');
  });
});

describe('parseStartupArgs (5.7)', () => {
  it('reads ?open= and the four switches', () => {
    expect(parseStartupArgs('?open=/browser/demo/prog.S68&run=1&fullscreen=1&exceptions=1&bitfield=1')).toEqual({
      file: '/browser/demo/prog.S68',
      run: true,
      fullScreen: true,
      exceptions: true,
      bitField: true,
    });
  });

  it('defaults to no file and no switch', () => {
    const none = { file: null, run: false, fullScreen: false, exceptions: false, bitField: false };
    expect(parseStartupArgs('')).toEqual(none);
    expect(parseStartupArgs('?gallery')).toEqual(none);
    expect(parseStartupArgs('?open=&run=0')).toEqual(none);
  });

  it('decodes the path', () => {
    expect(parseStartupArgs('?open=%2Fbrowser%2FMy%20Programs%2Fa%2Bb.X68').file).toBe('/browser/My Programs/a+b.X68');
  });
});

describe('isAllowedExternalUrl (7.6)', () => {
  it('allows the repository host and the original site, over http(s) only', () => {
    expect(isAllowedExternalUrl('https://github.com/gurmyd/easy68k-mac/releases')).toBe(true);
    expect(isAllowedExternalUrl('http://www.easy68k.com/')).toBe(true);
    expect(isAllowedExternalUrl('https://www.easy68k.com/paulrsm/index.html')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const url of [
      'https://example.com/',
      'https://github.com.evil.example/',
      'https://evil.example/?https://github.com/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'ftp://www.easy68k.com/',
      'not a url',
      '',
    ]) {
      expect(isAllowedExternalUrl(url), url).toBe(false);
    }
  });
});

/** The parts of `window` the platform touches. */
function fakeWindow(search = '') {
  const listeners = new Map<string, Set<unknown>>();
  const opened: [string, string | undefined, string | undefined][] = [];
  const win = {
    navigator: { platform: 'MacIntel' },
    crypto: globalThis.crypto,
    location: { search, origin: 'https://example.github.io', pathname: '/easy68k-mac/', href: '' },
    document: { title: '' },
    open: (url: string, target?: string, features?: string) => void opened.push([url, target, features]),
    addEventListener: (type: string, listener: unknown) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: unknown) => void listeners.get(type)?.delete(listener),
  };
  return { win: win as unknown as Window, raw: win, listeners, opened };
}

describe('createWebPlatform', () => {
  it('is the web kind, with the OS of the browser and a window id of its own', () => {
    const a = createWebPlatform(fakeWindow().win);
    const b = createWebPlatform(fakeWindow().win);
    expect(a.kind).toBe('web');
    expect(a.os).toBe('mac');
    expect(a.windowId).toMatch(/^[0-9a-f]{24}$/);
    expect(a.windowId).not.toBe(b.windowId);
  });

  it('has none of the desktop-only parts', () => {
    const platform = createWebPlatform(fakeWindow().win);
    expect(platform.disk).toBeNull();
    expect(platform.syncFiles).toBeNull();
    expect(platform.serial).toBeNull();
    expect(platform.net).toBeNull();
    expect(platform.setFullScreen).toBeNull();
    expect(platform.pasteIntoFocus).toBeNull();
    expect(platform.showHelp('main.htm')).toBe(false);
    // No-ops that must not throw.
    platform.setNativeMenu([{ label: 'File' }]);
    platform.quit();
    platform.onNativeCommand(() => {})();
    platform.onOpenFiles(() => {})();
  });

  it('reads the start-up arguments from the address', () => {
    const platform = createWebPlatform(fakeWindow('?open=/browser/a.X68&run=1').win);
    expect(platform.startupArgs()).toMatchObject({ file: '/browser/a.X68', run: true });
  });

  it('sets the page title', () => {
    const { win, raw } = fakeWindow();
    createWebPlatform(win).setTitle('EASy68K Editor/Assembler v5.16.01 - unofficial port 0.1.0');
    expect(raw.document.title).toBe('EASy68K Editor/Assembler v5.16.01 - unofficial port 0.1.0');
  });

  it('opens allow-listed links in a new tab without an opener, and nothing else', () => {
    const { win, opened } = fakeWindow();
    const platform = createWebPlatform(win);
    platform.openExternal('https://github.com/gurmyd/easy68k-mac');
    platform.openExternal('https://example.com/');
    platform.openExternal('javascript:alert(1)');
    expect(opened).toEqual([['https://github.com/gurmyd/easy68k-mac', '_blank', 'noopener,noreferrer']]);
  });

  it('newWindow opens the same address without start-up arguments', () => {
    const { win, opened } = fakeWindow('?open=/browser/a.S68&run=1');
    createWebPlatform(win).newWindow();
    expect(opened).toEqual([['https://example.github.io/easy68k-mac/', '_blank', 'noopener']]);
  });

  it('confirmBeforeUnload adds and removes one beforeunload guard', () => {
    const { win, listeners } = fakeWindow();
    const platform = createWebPlatform(win);
    platform.confirmBeforeUnload(true);
    platform.confirmBeforeUnload(true);
    const guards = listeners.get('beforeunload') ?? new Set();
    expect(guards.size).toBe(1);
    const event = {
      prevented: false,
      returnValue: 'x',
      preventDefault() {
        this.prevented = true;
      },
    };
    ([...guards][0] as (event: unknown) => void)(event);
    expect(event.prevented).toBe(true);
    expect(event.returnValue).toBe('');
    platform.confirmBeforeUnload(false);
    expect(guards.size).toBe(0);
  });
});
