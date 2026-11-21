// The platform bridge of the web app (ARCHITECTURE.md 3.13). Owner: W3.
//
// `Platform` is everything the application asks of its surroundings: start-up arguments, the
// window title, printing, links to other sites, the native menu. In a browser most of it is small
// and some of it does not exist (no native menu, no disk, no serial ports); those members are
// no-ops or null, as the contract says. The desktop app has its own implementation
// (platform/desktop.ts, owner DV2); main.tsx chooses between the two.

import type { Platform, StartupArgs } from '../contracts';
import { createWindowId } from '../state/window-lock';

/** The fields of `navigator` that tell the operating system. */
export interface NavigatorLike {
  readonly userAgentData?: { readonly platform?: string } | undefined;
  readonly platform?: string | undefined;
  readonly userAgent?: string | undefined;
}

/** The operating system the browser runs on: it decides the key map (section 1.3, rule K2). */
export function detectOs(nav: NavigatorLike): Platform['os'] {
  const text = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  if (/mac|iphone|ipad|ipod/i.test(text)) return 'mac';
  if (/win/i.test(text)) return 'windows';
  return 'linux';
}

const isOn = (value: string | null) => value === '1' || value === 'true';

/**
 * The start-up arguments of a web URL (5.7): `?open=<VPath>` plus the optional switches `run=1`
 * (/r), `fullscreen=1` (/f), `exceptions=1` (/e) and `bitfield=1` (/b).
 */
export function parseStartupArgs(search: string): StartupArgs {
  const params = new URLSearchParams(search);
  const file = params.get('open');
  return {
    file: file !== null && file !== '' ? file : null,
    run: isOn(params.get('run')),
    fullScreen: isOn(params.get('fullscreen')),
    exceptions: isOn(params.get('exceptions')),
    bitField: isOn(params.get('bitfield')),
  };
}

/** Hosts that openExternal may open (7.6): the repository and the original's site. */
const EXTERNAL_HOSTS: readonly string[] = ['github.com', 'www.easy68k.com', 'easy68k.com'];

/** True for an http(s) URL on the allow list of 7.6. */
export function isAllowedExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && EXTERNAL_HOSTS.includes(parsed.hostname);
}

/**
 * Prints a prepared HTML document through the browser's print dialog (1.4 note 2). The document
 * is loaded into a hidden frame, so the page itself is not disturbed. Resolves when the dialog
 * has closed, or at once in a browser that does not report it.
 */
function printDocument(win: Window, html: string, title: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const doc = win.document;
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.title = title;
    Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', visibility: 'hidden' });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      frame.remove();
      resolve();
    };
    frame.addEventListener('load', () => {
      const target = frame.contentWindow;
      if (!target) return finish();
      target.document.title = title;
      target.addEventListener('afterprint', finish);
      try {
        target.focus();
        target.print();
      } catch {
        finish();
      }
      // Browsers that never send `afterprint` (and print() calls that return at once).
      win.setTimeout(finish, 60_000);
    });
    frame.srcdoc = html;
    doc.body.append(frame);
  });
}

export function createWebPlatform(win: Window = window): Platform {
  const openFileListeners = new Set<(files: string[]) => void>();
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    // Both forms: browsers differ in which one makes them ask "Leave site?".
    event.preventDefault();
    event.returnValue = '';
  };
  let guarding = false;

  return {
    kind: 'web',
    os: detectOs(win.navigator as NavigatorLike),
    windowId: createWindowId(win.crypto),

    startupArgs: () => parseStartupArgs(win.location.search),
    onOpenFiles(listener) {
      // Nothing opens files in a plain browser tab; the listeners are kept for symmetry.
      openFileListeners.add(listener);
      return () => {
        openFileListeners.delete(listener);
      };
    },
    setNativeMenu: () => {},
    onNativeCommand: () => () => {},
    setTitle(title) {
      win.document.title = title;
    },
    print: (html, title) => printDocument(win, html, title),
    openExternal(url) {
      if (isAllowedExternalUrl(url)) win.open(url, '_blank', 'noopener,noreferrer');
    },
    showHelp: () => false,
    confirmBeforeUnload(needed) {
      if (needed === guarding) return;
      guarding = needed;
      if (needed) win.addEventListener('beforeunload', onBeforeUnload);
      else win.removeEventListener('beforeunload', onBeforeUnload);
    },
    newWindow() {
      // The same address without start-up arguments: another independent editor and simulator (3.8.6).
      win.open(win.location.origin + win.location.pathname, '_blank', 'noopener');
    },
    setFullScreen: null,
    pasteIntoFocus: null,
    quit: () => {},
    disk: null,
    syncFiles: null,
    serial: null,
    net: null,
  };
}
