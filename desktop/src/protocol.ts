// The app:// protocol (ARCHITECTURE.md 7.6). The windows load app://easy68k/index.html; the
// handler serves only files inside the built web app (app/dist, packaged with the app) and sets
// Content-Type from a fixed extension table. An unknown extension, another host, a path that
// leaves the folder or a missing file is refused. Every response carries the Content Security
// Policy as a header.
//
// The scheme is privileged (registered before the app is ready): `standard` and `secure` give it
// an origin and a secure context, `supportFetchAPI` lets the engines' loaders fetch the .wasm
// files, the fonts and the help (docs/ENGINE-BINDING.md 2.4), `corsEnabled` lets module scripts
// and import() load from it, `stream` lets media elements read sounds from it (the handler answers
// a single `Range` with 206, so that they can seek).
//
// resolveAppRequest() is plain Node; tests/desktop/dev/unit.spec.ts tests it without Electron.
//
// Owner: DV2.

import { open, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CustomScheme, Protocol } from 'electron';
import { APP_HOST, APP_SCHEME, CONTENT_SECURITY_POLICY } from './security';

/** The scheme registration of 7.6 (protocol.registerSchemesAsPrivileged). */
export const APP_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: APP_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
};

/**
 * Content types by extension (lower case). `.wasm` must be application/wasm for streaming
 * compilation; `.mjs` and `.js` are text/javascript for module scripts and import().
 * Anything not listed is refused.
 */
export const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  // Read-me files that come with the fonts and the help.
  '.md': 'text/plain; charset=utf-8',
  // The Quick Reference that the help links to (help/EASy68KQuickRef.pdf).
  '.pdf': 'application/pdf',
  // The official examples (5.8) and the help's contents and index files: bytes for the page.
  '.x68': 'application/octet-stream',
  '.l68': 'application/octet-stream',
  '.s68': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.hhc': 'text/html',
  '.hhk': 'text/html',
});

export type AppRequestResult =
  { ok: true; file: string; contentType: string } | { ok: false; status: 400 | 403 | 404 | 405; reason: string };

/**
 * What an app:// URL names: the file inside `distDir` and its content type, or why it is refused.
 * Checks the scheme, the host, the method, the path (no NUL, no escape from the folder, also not
 * through a symbolic link), the extension and that the file exists.
 */
export async function resolveAppRequest(distDir: string, url: string, method = 'GET'): Promise<AppRequestResult> {
  if (method !== 'GET' && method !== 'HEAD') return { ok: false, status: 405, reason: `method ${method}` };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 400, reason: 'not a URL' };
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST || parsed.port !== '') {
    return { ok: false, status: 403, reason: `not ${APP_SCHEME}://${APP_HOST}` };
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return { ok: false, status: 400, reason: 'malformed escape in the path' };
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return { ok: false, status: 400, reason: 'bad character' };
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { ok: false, status: 403, reason: 'dot segment' };
  }
  const contentType = CONTENT_TYPES[extname(pathname).toLowerCase()];
  if (!contentType) return { ok: false, status: 403, reason: `extension ${extname(pathname) || '(none)'}` };

  const root = resolve(distDir);
  const file = resolve(join(root, ...segments));
  if (!isInside(file, root)) return { ok: false, status: 403, reason: 'outside the app folder' };
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(file)]);
    if (!isInside(realFile, realRoot)) return { ok: false, status: 403, reason: 'link leaves the app folder' };
    if (!(await stat(realFile)).isFile()) return { ok: false, status: 404, reason: 'not a file' };
    return { ok: true, file: realFile, contentType };
  } catch {
    return { ok: false, status: 404, reason: 'no such file' };
  }
}

function isInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && !isAbsolute(rel) && rel.split(sep)[0] !== '..';
}

/** Headers of every app:// response. */
export function responseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
    'Accept-Ranges': 'bytes',
  };
}

/**
 * The byte range a `Range` header asks for in a file of `size` bytes (RFC 9110 14.1.2), for media
 * elements that read sounds piecewise: `{ start, end }` (end inclusive), 'whole' when there is no
 * header or one this handler does not serve piecewise (several ranges, another unit, malformed:
 * the whole file is a valid answer then), or 'unsatisfiable' (416).
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'whole' | 'unsatisfiable' {
  if (header === null) return 'whole';
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return 'whole';
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return 'whole';
  if (first === '') {
    // The last N bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < start) return 'whole';
  return { start, end };
}

/** Installs the handler of app:// on `protocol` (of the default session). */
export function registerAppProtocol(protocol: Protocol, distDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const result = await resolveAppRequest(distDir, request.url, request.method);
    if (!result.ok) {
      return new Response(`${result.status}: ${result.reason}`, {
        status: result.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
      });
    }
    const headers = responseHeaders(result.contentType);
    const size = (await stat(result.file)).size;
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    if (range === 'whole') {
      const body = request.method === 'HEAD' ? null : await readFile(result.file);
      return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
    }
    const length = range.end - range.start + 1;
    let body: Uint8Array<ArrayBuffer> | null = null;
    if (request.method !== 'HEAD') {
      body = new Uint8Array(length);
      const file = await open(result.file, 'r');
      try {
        let done = 0;
        while (done < length) {
          const { bytesRead } = await file.read(body, done, length - done, range.start + done);
          if (bytesRead === 0) break;
          done += bytesRead;
        }
        body = body.subarray(0, done);
      } finally {
        await file.close();
      }
    }
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(length),
      },
    });
  });
}
