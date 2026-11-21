// The security posture of the desktop app (ARCHITECTURE.md 7.6): the web preferences of every
// window, the Content Security Policy it is served with, the allow list of links that may open in
// the system browser, the check of the window that sent an IPC message, and the granted roots, the
// only places on disk the page may reach (3.8.4).
//
// This module does not import Electron at run time (only its types), so its logic is unit-tested
// under plain Node (app/src/fs/disk-backend.test.ts, tests/desktop/dev/unit.spec.ts).
//
// Owner: DV2.

import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import type { WebPreferences } from 'electron';

// ---- Content Security Policy -------------------------------------------------------------------

/**
 * The policy of 7.6, sent as a response header with every file of app://. The production build
 * also carries it as a <meta> tag (tools/vite-csp-plugin.mjs). The two must stay identical;
 * tests/desktop/dev/unit.spec.ts compares them.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "frame-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// ---- Web preferences ---------------------------------------------------------------------------

/** The web preferences of an application window (7.6), apart from the preload script's path. */
export const APP_WEB_PREFERENCES: Readonly<WebPreferences> = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  // 4.5.5: a program's timers keep their pace while the window is hidden or minimised.
  backgroundThrottling: false,
  spellcheck: false,
  navigateOnDragDrop: false,
  safeDialogs: true,
});

/**
 * The web preferences of the windows that show third-party HTML (help pages) or a document to
 * print: no preload script, no JavaScript at all.
 */
export const CONTENT_WEB_PREFERENCES: Readonly<WebPreferences> = Object.freeze({
  ...APP_WEB_PREFERENCES,
  javascript: false,
});

// ---- Links to other sites ---------------------------------------------------------------------

/**
 * Hosts whose http(s) links open in the system browser (7.6: the repository and the original's
 * site). The same list as isAllowedExternalUrl() of app/src/platform/web.ts (W3); the page cannot
 * import this file nor this file the page's, so tests/desktop/dev/unit.spec.ts compares them.
 */
export const EXTERNAL_HOSTS: readonly string[] = ['github.com', 'www.easy68k.com', 'easy68k.com'];

/** True for an http(s) URL on the allow list of 7.6. */
export function isAllowedExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && EXTERNAL_HOSTS.includes(parsed.hostname);
}

// ---- Where the page comes from -----------------------------------------------------------------

/** The scheme and host the windows load (7.6). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'easy68k';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_INDEX_URL = `${APP_ORIGIN}/index.html`;

/**
 * The origin the application page is loaded from: app://easy68k, or the Vite dev server of
 * `npm run desktop:dev` (EASY68K_DEV_SERVER_URL, set only by tools/desktop-dev.mjs and the tests).
 */
export function pageOrigin(devServerUrl: string | undefined): string {
  if (devServerUrl) return new URL(devServerUrl).origin;
  return APP_ORIGIN;
}

/** True if `url` belongs to the application page's origin. */
export function isAppUrl(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url);
    // URL.origin of a non-special scheme such as app: is "null"; compare scheme and host instead.
    return `${parsed.protocol}//${parsed.host}` === origin;
  } catch {
    return false;
  }
}

// ---- Granted roots (7.6, 3.8.4) ----------------------------------------------------------------

/** The operating systems the path rules distinguish. */
export type HostPlatform = 'win32' | 'posix';

export function hostPlatform(platform: string = process.platform): HostPlatform {
  return platform === 'win32' ? 'win32' : 'posix';
}

/** One segment of a path inside the /disk mount, as a VPath allows it. */
function validSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\') && !segment.includes('\0');
}

/**
 * The real path of `rel`, a path inside the /disk mount ("/disk/Users/me/x.X68" has the rel
 * "Users/me/x.X68" and is "/Users/me/x.X68"; on Windows, where the desktop app is only run for
 * development and tests, "/disk/C:/Users/x" is "C:\Users\x"). null for anything else.
 */
export function realPathOf(rel: unknown, platform: HostPlatform = hostPlatform()): string | null {
  if (typeof rel !== 'string') return null;
  if (rel === '') return platform === 'win32' ? null : '/';
  if (rel.startsWith('/') || rel.endsWith('/')) return null;
  const segments = rel.split('/');
  if (!segments.every(validSegment)) return null;
  if (platform === 'win32') {
    const [drive, ...rest] = segments;
    if (drive === undefined || !/^[A-Za-z]:$/.test(drive)) return null;
    if (rest.some((segment) => /[<>:"|?*]/.test(segment))) return null;
    return win32.join(`${drive}\\`, ...rest);
  }
  return posix.join('/', ...segments);
}

/** The rel inside /disk of an absolute real path, or null (relative paths, UNC paths). */
export function relOfRealPath(real: string, platform: HostPlatform = hostPlatform()): string | null {
  if (platform === 'win32') {
    const normal = win32.normalize(real);
    const match = /^([A-Za-z]:)\\?(.*)$/.exec(normal);
    if (!match || !win32.isAbsolute(normal)) return null;
    const rest = (match[2] ?? '').split('\\').filter((segment) => segment !== '');
    return [match[1] as string, ...rest].join('/');
  }
  if (!posix.isAbsolute(real)) return null;
  return posix
    .normalize(real)
    .split('/')
    .filter((segment) => segment !== '')
    .join('/');
}

/** The VPath of an absolute real path ("/Users/me/x.X68" -> "/disk/Users/me/x.X68"), or null. */
export function vpathOfRealPath(real: string, platform: HostPlatform = hostPlatform()): string | null {
  const rel = relOfRealPath(real, platform);
  if (rel === null) return null;
  return rel === '' ? '/disk' : `/disk/${rel}`;
}

/**
 * The canonical form of an absolute path: symbolic links and, where the file system ignores
 * letter case, the stored spelling resolved for the part that exists; the part that does not
 * exist yet appended as given. A link inside a granted root that points outside it therefore
 * leaves the root.
 */
export function canonicalPath(path: string): string {
  let existing = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(existing);
      return tail.length === 0 ? real : join(real, ...tail.reverse());
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(path);
      tail.push(existing.slice(parent.length).replace(/^[\\/]+/, ''));
      existing = parent;
    }
  }
}

/**
 * The folders the page may reach (7.6): folders the user chose in a native dialog, the folder of
 * a file the user chose in a native dialog or opened through a file association, a drop or the
 * command line, and the app's own user-data folder, each with everything below it. Kept in the
 * main process only; one list for all windows of the app.
 */
export class GrantedRoots {
  private readonly roots: string[] = [];

  constructor(private readonly platform: HostPlatform = hostPlatform()) {}

  /** Grants `dir` (an absolute real path) and everything below it. */
  add(dir: string): void {
    if (!isAbsolute(dir)) throw new TypeError(`not an absolute path: ${dir}`);
    const root = canonicalPath(dir);
    if (!this.roots.some((existing) => this.within(root, existing))) {
      // A new root that contains old ones replaces them.
      for (let i = this.roots.length - 1; i >= 0; i--) {
        if (this.within(this.roots[i] as string, root)) this.roots.splice(i, 1);
      }
      this.roots.push(root);
    }
  }

  /** Grants the folder of a file (an absolute real path). */
  addFolderOf(file: string): void {
    this.add(dirname(file));
  }

  list(): readonly string[] {
    return [...this.roots];
  }

  /** True if the absolute real path lies in a granted root (after canonicalPath()). */
  allows(path: string): boolean {
    if (!isAbsolute(path)) return false;
    const canonical = canonicalPath(path);
    return this.roots.some((root) => this.within(canonical, root));
  }

  /** The real path of a /disk rel if it is inside a granted root, else null. */
  realIfAllowed(rel: unknown): string | null {
    const real = realPathOf(rel, this.platform);
    return real !== null && this.allows(real) ? real : null;
  }

  private within(path: string, root: string): boolean {
    const fold = (p: string) => (this.platform === 'win32' ? p.toLowerCase() : p);
    const a = fold(path);
    const b = fold(root);
    if (a === b) return true;
    const separator = this.platform === 'win32' ? '\\' : '/';
    return a.startsWith(b.endsWith(separator) ? b : b + separator);
  }
}

/** True if the absolute real path exists and is a folder. */
export function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ---- IPC argument checks -------------------------------------------------------------------------

/** A plain string of reasonable length (names, channels, titles). */
export function isShortString(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length <= max;
}

/** Bytes as they arrive over IPC (structured clone keeps Uint8Array). */
export function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

/** A non-negative safe integer (positions and counts). */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
