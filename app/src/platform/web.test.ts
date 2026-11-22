// The web platform bridge (ARCHITECTURE.md 3.13, 5.7, 7.6).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWebPlatform,
  detectOs,
  isAllowedExternalUrl,
  parseStartupArgs,
  PRINT_FALLBACK_MS,
  PRINT_POLL_MS,
  PRINT_QUIET_MS,
  PRINT_WATCH_START,
  watchPrint,
  type PrintSignal,
  type PrintWatch,
} from './web';

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
    expect(platform.deviceBridge).toBeNull(); // docs/requests/DV4-platform-device-bridge.md
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

  it('confirmBeforeUnload keeps the guard while any named party needs it', () => {
    const { win, listeners } = fakeWindow();
    const platform = createWebPlatform(win);
    platform.confirmBeforeUnload(true, 'documents');
    platform.confirmBeforeUnload(true, 'simulator');
    const guards = listeners.get('beforeunload') ?? new Set();
    expect(guards.size).toBe(1);
    platform.confirmBeforeUnload(false, 'documents');
    expect(guards.size).toBe(1);
    platform.confirmBeforeUnload(false); // the unnamed party never asked: changes nothing
    expect(guards.size).toBe(1);
    platform.confirmBeforeUnload(false, 'simulator');
    expect(guards.size).toBe(0);
  });
});

describe('watchPrint: when a print has ended (errata/W3.md entry 44)', () => {
  type Step = PrintSignal | PrintSignal['kind'];
  const run = (...steps: Step[]): PrintWatch =>
    steps.reduce<PrintWatch>(
      (state, step) => watchPrint(state, typeof step === 'string' ? ({ kind: step } as PrintSignal) : step),
      PRINT_WATCH_START,
    );
  const returned = (at: number, hasFocus = true): PrintSignal => ({ kind: 'returned', at, hasFocus });
  const poll = (at: number, hasFocus = true): PrintSignal => ({ kind: 'poll', at, hasFocus });

  it('ends on afterprint, before or after print() returned', () => {
    expect(run('afterprint').ended).toBe('afterprint');
    expect(run(returned(0), 'afterprint').ended).toBe('afterprint');
  });

  it('ends without a dialog once the page kept the focus for PRINT_QUIET_MS after print() returned', () => {
    expect(run(returned(1000), poll(1100), poll(1000 + PRINT_QUIET_MS - 1)).ended).toBeNull();
    expect(run(returned(1000), poll(1100), poll(1000 + PRINT_QUIET_MS)).ended).toBe('no dialog');
  });

  it('keeps the frame while a dialog that print() did not wait for has the focus', () => {
    // print() returned while the dialog had the focus (blur first, or no focus at the return).
    let state = run('blur', returned(0, false));
    for (let at = 100; at <= 30_000; at += 100) state = watchPrint(state, poll(at, false));
    expect(state.ended).toBeNull();
    expect(run(returned(0, false), poll(5000, false)).ended).toBeNull();
    // A dialog that takes the focus only after print() returned stops the quiet ending.
    expect(run(returned(0), poll(100, false), poll(PRINT_QUIET_MS + 500, false)).ended).toBeNull();
    expect(run(returned(0), 'blur', poll(PRINT_QUIET_MS + 500, false)).ended).toBeNull();
  });

  it('ends when the page has the focus again after the dialog took it', () => {
    expect(run('blur', returned(0, false), poll(2000, true)).ended).toBe('focus back');
    expect(run('blur', returned(0, false), 'focus').ended).toBe('focus back');
    expect(run(returned(0), poll(100, false), 'focus').ended).toBe('focus back');
    expect(run(returned(0), 'blur', poll(200, true)).ended).toBe('focus back');
    // The dialog came and went while print() waited: the focus is back when it returns.
    expect(run('blur', returned(0, true)).ended).toBe('focus back');
  });

  it('a focus event that follows no loss of the focus is not the end (the frame was just focused)', () => {
    expect(run('focus', returned(0), 'focus', poll(PRINT_QUIET_MS / 2)).ended).toBeNull();
  });

  it('ends on a pointer or key event after print() returned, not before', () => {
    expect(run('blur', returned(0, false), 'input').ended).toBe('input');
    expect(run(returned(0), 'input').ended).toBe('input');
    expect(run('input', 'blur', 'focus').ended).toBeNull();
  });

  it('nothing but afterprint ends the print before print() returned', () => {
    expect(run('blur', poll(0, false), poll(5000, true), 'focus', 'input').ended).toBeNull();
    expect(run('blur', poll(0, false), poll(5000, true), 'afterprint').ended).toBe('afterprint');
  });

  it('ends on the fallback, and an ended print stays ended', () => {
    expect(run('blur', returned(0, false), 'fallback').ended).toBe('fallback');
    const ended = run('afterprint');
    expect(watchPrint(ended, { kind: 'fallback' })).toBe(ended);
    expect(run('afterprint', 'fallback', 'input').ended).toBe('afterprint');
  });
});

type FakeFrame = EventTarget & { removed: boolean };

/**
 * A window for Platform.print under Node: EventTargets for the top window and the frame's window,
 * a document whose `hasFocus()` the test sets, and the frame the platform creates. `print` is what
 * the frame's print() does (it may dispatch events on the frame's window, as a browser does).
 */
function printWindow(print: (frameWindow: EventTarget, page: { hasFocus: boolean }) => void = () => {}) {
  const top = new EventTarget();
  const page = { hasFocus: true, frame: null as FakeFrame | null };
  const frameWindow = Object.assign(new EventTarget(), {
    document: { title: '' },
    focused: 0,
    printed: 0,
    focus() {
      frameWindow.focused++;
    },
    print() {
      frameWindow.printed++;
      print(frameWindow, page);
    },
  });
  const document = {
    title: '',
    hasFocus: () => page.hasFocus,
    body: {
      append(frame: FakeFrame) {
        page.frame = frame;
        queueMicrotask(() => frame.dispatchEvent(new Event('load')));
      },
    },
    createElement() {
      return Object.assign(new EventTarget(), {
        style: {},
        tabIndex: 0,
        title: '',
        srcdoc: '',
        removed: false,
        contentWindow: frameWindow,
        setAttribute() {},
        remove() {
          this.removed = true;
        },
      });
    },
  };
  const win = Object.assign(top, {
    navigator: { platform: 'Win32' },
    crypto: globalThis.crypto,
    location: { search: '' },
    document,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  });
  return { win: win as unknown as Window, top, frameWindow, page };
}

describe('Platform.print in a browser (the hidden frame)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Starts a print; returns once the frame has loaded and its print() was called. */
  async function startPrint(env: ReturnType<typeof printWindow>) {
    let done = false;
    const printing = createWebPlatform(env.win)
      .print('<p>x</p>', 'EASy68K a.X68')
      .then(() => {
        done = true;
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(env.frameWindow.printed).toBe(1);
    expect(env.frameWindow.focused).toBe(1);
    return { printing, isDone: () => done };
  }

  /** A print() that returns with its dialog still open: the page lost the focus to it. */
  const dialogOpens = (frameWindow: EventTarget, page: { hasFocus: boolean }) => {
    page.hasFocus = false;
    frameWindow.dispatchEvent(new Event('blur'));
  };

  it('ends on afterprint and removes the frame', async () => {
    const env = printWindow((frameWindow) => setTimeout(() => frameWindow.dispatchEvent(new Event('afterprint')), 0));
    const { printing, isDone } = await startPrint(env);
    await vi.advanceTimersByTimeAsync(1);
    await printing;
    expect(isDone()).toBe(true);
    expect(env.page.frame?.removed).toBe(true);
    expect(env.frameWindow.document.title).toBe('EASy68K a.X68');
    expect(vi.getTimerCount()).toBe(0); // the poll and the fallback are cleared
  });

  it('without afterprint and without a dialog: ends after PRINT_QUIET_MS, not after the fallback', async () => {
    const env = printWindow();
    const { isDone } = await startPrint(env);
    await vi.advanceTimersByTimeAsync(PRINT_QUIET_MS - PRINT_POLL_MS);
    expect(isDone()).toBe(false);
    expect(env.page.frame?.removed).toBe(false);
    await vi.advanceTimersByTimeAsync(2 * PRINT_POLL_MS);
    expect(isDone()).toBe(true);
    expect(env.page.frame?.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the frame while a dialog print() did not wait for is open; ends when the top window has the focus again', async () => {
    const env = printWindow(dialogOpens);
    const { isDone } = await startPrint(env);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(isDone()).toBe(false);
    expect(env.page.frame?.removed).toBe(false);
    env.page.hasFocus = true;
    env.top.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(isDone()).toBe(true);
    expect(env.page.frame?.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends when the frame's window reports the focus, or within a poll when the page just has it again", async () => {
    for (const how of ['frame focus', 'poll'] as const) {
      const env = printWindow(dialogOpens);
      const { isDone } = await startPrint(env);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(isDone(), how).toBe(false);
      env.page.hasFocus = true;
      if (how === 'frame focus') env.frameWindow.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(how === 'poll' ? PRINT_POLL_MS : 0);
      expect(isDone(), how).toBe(true);
      expect(env.page.frame?.removed, how).toBe(true);
    }
  });

  it('ends on a pointer or key event in the top document or the frame', async () => {
    for (const [where, type] of [
      ['top', 'pointerdown'],
      ['top', 'keydown'],
      ['frame', 'keydown'],
      ['frame', 'pointerdown'],
    ] as const) {
      const env = printWindow(dialogOpens);
      const { isDone } = await startPrint(env);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(isDone()).toBe(false);
      (where === 'top' ? env.top : env.frameWindow).dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(0);
      expect(isDone(), `${type} in ${where}`).toBe(true);
      expect(env.page.frame?.removed, `${type} in ${where}`).toBe(true);
    }
  });

  it('no longer listens to the top window once the print has ended', async () => {
    const env = printWindow();
    const add = vi.spyOn(env.top, 'addEventListener');
    const remove = vi.spyOn(env.top, 'removeEventListener');
    const { isDone } = await startPrint(env);
    await vi.advanceTimersByTimeAsync(PRINT_QUIET_MS + PRINT_POLL_MS);
    expect(isDone()).toBe(true);
    const calls = (spy: typeof add) => spy.mock.calls.map(([type, listener, capture]) => [type, listener, capture]);
    expect(calls(add).map(([type]) => type)).toEqual(['focus', 'pointerdown', 'keydown']);
    expect(calls(remove)).toEqual(calls(add));
  });

  it('ends on the fallback when nothing is ever heard (the page never has the focus)', async () => {
    const env = printWindow((_frameWindow, page) => {
      page.hasFocus = false;
    });
    const { isDone } = await startPrint(env);
    await vi.advanceTimersByTimeAsync(PRINT_FALLBACK_MS - 1);
    expect(isDone()).toBe(false);
    expect(env.page.frame?.removed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isDone()).toBe(true);
    expect(env.page.frame?.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends at once when print() refuses', async () => {
    const env = printWindow(() => {
      throw new Error('print() refused');
    });
    const { isDone } = await startPrint(env);
    expect(isDone()).toBe(true);
    expect(env.page.frame?.removed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
