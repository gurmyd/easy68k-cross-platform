// The service worker of the web app (ARCHITECTURE.md 1.1, 7.5). Owner: DV1.
//
// It makes the application usable offline after one visit and keeps every page on the files of
// one build:
//
//   - The build writes this file, bundled, to `sw.js` at the root of the build output, preceded by
//     one line `self.__EASY68K_BUILD__ = { version, entries }` (features/pwa/build/pwa-build.mjs).
//     `entries` is every file of the build output except `sw.js` and source maps, with its size
//     and SHA-256; `version` is a hash of that list and of this worker's code. The list is
//     produced from the build output, never written by hand.
//   - install: every entry is fetched (bypassing the HTTP cache, or copied from an older version's
//     cache when its hash is the same) and checked against its size and hash before it is stored
//     in the cache `easy68k-v-<version>`. A file that does not match (a deployment in progress, a
//     proxy) fails the installation; the browser tries again at the next visit. So a version's
//     cache is complete and from one build, or it does not exist.
//   - fetch: a GET request for a file of the list is answered from the cache of the version the
//     requesting page was loaded with (a navigation is always answered by the active version and
//     records which version the new page has). A page that is still open when a newer version
//     takes over therefore keeps receiving the files of its own build. Everything else goes to
//     the network untouched - except the navigation of a frame (the Help panel's): it is answered
//     only with a page of the help folder from the cache, judged by its decoded path, and every
//     other one gets a network error, never the network (helpFramePath; erratum H1 11).
//   - A new version waits until the page asks it to take over (message `easy68k-skip-waiting`,
//     sent when the user presses `Reload` in the update notice). It never takes over by itself,
//     and the first installation does not claim the page that registered it: that page keeps
//     the files it loaded from the network.
//   - The cache of an older version is deleted once no open page uses it.
//
// The scope is the folder of `sw.js`, so the same build works at a site's root and under a
// sub-path such as https://<account>.github.io/easy68k-cross-platform/.
//
// The logic is exported so that unit tests can run it under Node with fake caches and clients
// (sw.test.ts). It imports nothing: the bundle must be a classic script without imports.

/** One file of the build output. `url` is relative to the worker's scope and percent-encoded. */
export interface PrecacheEntry {
  url: string;
  size: number;
  sha256: string;
}

/** What the build puts in front of the bundled worker. */
export interface BuildManifest {
  version: string;
  entries: PrecacheEntry[];
}

/** Prefix of the caches of the versions. */
export const VERSION_CACHE_PREFIX = 'easy68k-v-';
/** The cache that holds the record of which page uses which version. */
export const CLIENTS_CACHE = 'easy68k-clients';
/** The message a page sends to a waiting worker to let it take over. */
export const SKIP_WAITING_MESSAGE = 'easy68k-skip-waiting';
/** Header stored with every cached file: its SHA-256, so that a later version can reuse it. */
export const HASH_HEADER = 'x-easy68k-sha256';
/** Files fetched at the same time during installation. */
const PARALLEL_FETCHES = 6;
/**
 * How long a recorded page is kept although no open page has its id (see removeUnusedVersions):
 * the time between answering a navigation from the cache and the browser creating the page.
 */
export const CLIENT_GRACE_MS = 10_000;

/** Which version a page was loaded with, and when that was recorded (ms since 1970). */
interface ClientRecord {
  version: string;
  time: number;
}

export const cacheNameFor = (version: string): string => `${VERSION_CACHE_PREFIX}${version}`;

/**
 * The folder of the help pages below the scope: the only addresses a frame is given (core/help's
 * HELP_FOLDER; this file imports nothing, so the value is repeated, and sw.test.ts compares them).
 */
export const HELP_FOLDER = 'help/';

/**
 * A navigation of a frame (an iframe, or a frame of a frameset). The worker answers it only with a
 * file of the help folder that it holds itself, never from the network; any other one gets a network
 * error (erratum H1 11, DV1 entry on the help frame), so the Help panel's frame cannot load the
 * application or any other page of the site, whatever a link in it says or a server makes of it.
 */
export function isFrameNavigation(request: Request): boolean {
  return request.mode === 'navigate' && (request.destination === 'iframe' || request.destination === 'frame');
}

/** Content types for files whose response has none (a server that sends no type). */
const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  gif: 'image/gif',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain',
};

export function contentTypeFor(url: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(url)?.[1]?.toLowerCase() ?? '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

// --- the parts of the service worker scope that are used ------------------------------------

export interface ClientLike {
  readonly id: string;
}

/** The subset of ServiceWorkerGlobalScope this worker uses (the DOM library has no worker types). */
export interface WorkerScopeLike {
  readonly registration: { readonly scope: string };
  readonly caches: CacheStorage;
  readonly clients: {
    matchAll(options: { includeUncontrolled: boolean; type: 'all' }): Promise<readonly ClientLike[]>;
  };
  readonly crypto: { readonly subtle: SubtleCrypto };
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: string, listener: (event: never) => void): void;
}

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  readonly clientId: string;
  readonly resultingClientId: string;
  respondWith(response: Promise<Response>): void;
}

export interface MessageEventLike extends ExtendableEventLike {
  readonly data: unknown;
}

// --- helpers ----------------------------------------------------------------------------------

export async function sha256Hex(subtle: SubtleCrypto, bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** A path relative to the scope with every percent-escape decoded, for comparing URLs. */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The path of a frame navigation below the help folder, decoded and checked, or null when the
 * path is not one the frame may be given: it fails to decode; an escape made a separator (`%2F`,
 * `%5C`), a dot segment, an empty segment, a `%` (double encoding), a backslash or a control
 * character; or it does not start with the help folder. `raw` is the still-encoded path relative to
 * the scope, as the URL parser left it (it has already resolved the plain `.` and `..` segments and
 * their `%2E` spellings).
 */
export function helpFramePath(raw: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const segments = path.split('/');
  if (segments.length !== raw.split('/').length) return null; // %2F made a separator
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  // eslint-disable-next-line no-control-regex -- a control character has no place in a help address
  if (/[\\%\u0000-\u001f\u007f]/.test(path)) return null;
  if (`${segments[0]}/` !== HELP_FOLDER || segments.length < 2) return null;
  return path;
}

async function mapLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// --- the worker -------------------------------------------------------------------------------

export class Easy68kServiceWorker {
  readonly version: string;
  readonly cacheName: string;
  private readonly scope: WorkerScopeLike;
  private readonly scopeUrl: URL;
  /** Decoded path relative to the scope -> entry. */
  private readonly byPath = new Map<string, PrecacheEntry>();
  /** Page (client id) -> version it was loaded with; loaded from CLIENTS_CACHE on first use. */
  private clientVersions: Map<string, ClientRecord> | null = null;
  private loadingClients: Promise<Map<string, ClientRecord>> | null = null;
  private readonly now: () => number;

  /** `now`: milliseconds since 1970 (tests pass their own clock). */
  constructor(scope: WorkerScopeLike, build: BuildManifest, now: () => number = () => Date.now()) {
    if (!build || typeof build.version !== 'string' || !Array.isArray(build.entries)) {
      throw new Error('easy68k service worker: the build manifest is missing (__EASY68K_BUILD__)');
    }
    this.now = now;
    this.scope = scope;
    this.version = build.version;
    this.cacheName = cacheNameFor(build.version);
    this.scopeUrl = new URL(scope.registration.scope);
    for (const entry of build.entries) this.byPath.set(decodedPath(entry.url), entry);
  }

  /** The absolute URL under which an entry is stored. */
  entryUrl(entry: PrecacheEntry): string {
    return new URL(entry.url, this.scopeUrl).href;
  }

  /** The entry a request asks for, or null when the request is not one this worker answers. */
  entryFor(request: Request): PrecacheEntry | null {
    if (request.method !== 'GET') return null;
    const url = new URL(request.url);
    if (url.origin !== this.scopeUrl.origin || !url.pathname.startsWith(this.scopeUrl.pathname)) return null;
    const path = decodedPath(url.pathname.slice(this.scopeUrl.pathname.length));
    // A navigation to the scope itself is the application page, whatever the query (?open=...).
    if (path === '' && request.mode === 'navigate') return this.byPath.get('index.html') ?? null;
    return this.byPath.get(path) ?? null;
  }

  /**
   * The entry of the help folder that a frame navigation asks for, judged by its decoded and
   * normalised path (helpFramePath); null for every other address, including a help address that
   * is not in the build.
   */
  helpEntryForFrame(request: Request): PrecacheEntry | null {
    if (request.method !== 'GET') return null;
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    if (url.origin !== this.scopeUrl.origin || !url.pathname.startsWith(this.scopeUrl.pathname)) return null;
    const path = helpFramePath(url.pathname.slice(this.scopeUrl.pathname.length));
    return path === null ? null : (this.byPath.get(path) ?? null);
  }

  // ---- install

  async install(): Promise<void> {
    const cache = await this.scope.caches.open(this.cacheName);
    try {
      const reusable = await this.olderCaches();
      await mapLimit([...this.byPath.values()], PARALLEL_FETCHES, (entry) => this.store(cache, entry, reusable));
    } catch (error) {
      // An incomplete cache must never be used: remove it, the browser installs again later.
      await this.scope.caches.delete(this.cacheName);
      throw error;
    }
  }

  private async olderCaches(): Promise<Cache[]> {
    const names = (await this.scope.caches.keys()).filter(
      (name) => name.startsWith(VERSION_CACHE_PREFIX) && name !== this.cacheName,
    );
    return Promise.all(names.map((name) => this.scope.caches.open(name)));
  }

  private async store(cache: Cache, entry: PrecacheEntry, reusable: readonly Cache[]): Promise<void> {
    const url = this.entryUrl(entry);
    const present = await cache.match(url);
    if (present?.headers.get(HASH_HEADER) === entry.sha256) return;
    for (const older of reusable) {
      const response = await older.match(url);
      if (response?.headers.get(HASH_HEADER) === entry.sha256) {
        await cache.put(url, response);
        return;
      }
    }
    const response = await this.scope.fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    if (!response.ok) throw new Error(`easy68k service worker: ${url} answered ${response.status}`);
    const bytes = await response.arrayBuffer();
    const hash = await sha256Hex(this.scope.crypto.subtle, bytes);
    if (bytes.byteLength !== entry.size || hash !== entry.sha256) {
      throw new Error(
        `easy68k service worker: ${url} is not the file of this build ` +
          `(${bytes.byteLength} bytes, SHA-256 ${hash}; expected ${entry.size} bytes, ${entry.sha256})`,
      );
    }
    const headers = new Headers();
    headers.set('content-type', response.headers.get('content-type') || contentTypeFor(entry.url));
    headers.set(HASH_HEADER, entry.sha256);
    await cache.put(url, new Response(bytes, { status: 200, statusText: 'OK', headers }));
  }

  // ---- activate

  async activate(): Promise<void> {
    // The previous worker may have recorded pages since this one started: read the record again.
    this.clientVersions = null;
    this.loadingClients = null;
    await this.removeUnusedVersions();
  }

  /**
   * Deletes the caches of versions that neither this worker nor any open page uses. A page that
   * is not open any more is forgotten - but only some time after it was recorded: the page a
   * navigation creates does not exist yet while its navigation is being answered.
   */
  async removeUnusedVersions(): Promise<void> {
    const versions = await this.clients();
    const open = new Set(
      (await this.scope.clients.matchAll({ includeUncontrolled: true, type: 'all' })).map((client) => client.id),
    );
    const now = this.now();
    let changed = false;
    for (const [id, record] of [...versions]) {
      if (!open.has(id) && now - record.time > CLIENT_GRACE_MS) {
        versions.delete(id);
        changed = true;
      }
    }
    const keep = new Set([this.cacheName, ...[...versions.values()].map((record) => cacheNameFor(record.version))]);
    for (const name of await this.scope.caches.keys()) {
      if (name.startsWith(VERSION_CACHE_PREFIX) && !keep.has(name)) await this.scope.caches.delete(name);
    }
    if (changed) await this.saveClients();
  }

  // ---- which page has which version

  private clientsKey(): string {
    return new URL('__easy68k/clients.json', this.scopeUrl).href;
  }

  private async clients(): Promise<Map<string, ClientRecord>> {
    if (this.clientVersions) return this.clientVersions;
    this.loadingClients ??= (async () => {
      const map = new Map<string, ClientRecord>();
      try {
        const cache = await this.scope.caches.open(CLIENTS_CACHE);
        const stored = await cache.match(this.clientsKey());
        const data: unknown = stored ? await stored.json() : null;
        if (data && typeof data === 'object') {
          for (const [id, record] of Object.entries(data as Record<string, Partial<ClientRecord>>)) {
            if (typeof record?.version === 'string' && typeof record.time === 'number') {
              map.set(id, { version: record.version, time: record.time });
            }
          }
        }
      } catch {
        // A damaged record only means that open pages are served by the active version.
      }
      this.clientVersions = map;
      return map;
    })();
    return this.loadingClients;
  }

  private async saveClients(): Promise<void> {
    const versions = await this.clients();
    const cache = await this.scope.caches.open(CLIENTS_CACHE);
    await cache.put(
      this.clientsKey(),
      new Response(JSON.stringify(Object.fromEntries(versions)), { headers: { 'content-type': 'application/json' } }),
    );
  }

  /** The version a page uses; a page this worker has no record of uses the active version. */
  async versionOf(clientId: string): Promise<string> {
    if (!clientId) return this.version;
    return (await this.clients()).get(clientId)?.version ?? this.version;
  }

  // ---- fetch

  /**
   * The answer to a request, or null when the request is left to the network. `clientId` is the
   * page that asks; `resultingClientId` the page a navigation creates.
   */
  respond(request: Request, clientId: string, resultingClientId: string): Promise<Response> | null {
    // A frame can show Help and nothing else (erratum H1 11): in WebKit the Help frame has
    // allow-scripts, so a page of this site without the help pages' policy must never load in it.
    // A frame navigation is therefore answered only from this worker's own copy of the help folder
    // and never from the network: a server that decodes `%2F` (GitHub Pages does) would answer
    // help/..%2Findex.html with the application's page.
    if (isFrameNavigation(request)) {
      const help = this.helpEntryForFrame(request);
      return help ? this.answerFrame(help, resultingClientId) : Promise.resolve(Response.error());
    }
    const entry = this.entryFor(request);
    if (!entry) return null;
    return this.answer(request, entry, request.mode === 'navigate' ? '' : clientId, resultingClientId);
  }

  private async answer(
    request: Request,
    entry: PrecacheEntry,
    clientId: string,
    resultingClientId: string,
  ): Promise<Response> {
    const version = await this.versionOf(clientId);
    if (request.mode === 'navigate' && resultingClientId) await this.recordNavigation(resultingClientId);
    const url = this.entryUrl(entry);
    const own = await (await this.scope.caches.open(cacheNameFor(version))).match(url);
    if (own) return own;
    if (version !== this.version) {
      const current = await (await this.scope.caches.open(this.cacheName)).match(url);
      if (current) return current;
    }
    return this.scope.fetch(request);
  }

  /** A help page for a frame: from the active version's cache only; an error when it is not there. */
  private async answerFrame(entry: PrecacheEntry, resultingClientId: string): Promise<Response> {
    if (resultingClientId) await this.recordNavigation(resultingClientId);
    const cached = await (await this.scope.caches.open(this.cacheName)).match(this.entryUrl(entry));
    return cached ?? Response.error();
  }

  private async recordNavigation(clientId: string): Promise<void> {
    const versions = await this.clients();
    versions.set(clientId, { version: this.version, time: this.now() });
    await this.saveClients();
    // Pages that were closed since the last navigation free their versions.
    await this.removeUnusedVersions();
  }

  // ---- messages

  async message(data: unknown): Promise<void> {
    if (data && typeof data === 'object' && (data as { type?: unknown }).type === SKIP_WAITING_MESSAGE) {
      await this.scope.skipWaiting();
    }
  }
}

/** Connects the worker to the events of its scope. */
export function startServiceWorker(scope: WorkerScopeLike, build: BuildManifest): Easy68kServiceWorker {
  const worker = new Easy68kServiceWorker(scope, build);
  scope.addEventListener('install', (event: ExtendableEventLike) => event.waitUntil(worker.install()));
  scope.addEventListener('activate', (event: ExtendableEventLike) => event.waitUntil(worker.activate()));
  scope.addEventListener('fetch', (event: FetchEventLike) => {
    const response = worker.respond(event.request, event.clientId, event.resultingClientId);
    if (response) event.respondWith(response);
  });
  scope.addEventListener('message', (event: MessageEventLike) => event.waitUntil(worker.message(event.data)));
  return worker;
}

// Inside a real service worker (not under Node, where the tests import this file): start.
declare const ServiceWorkerGlobalScope: { new (): unknown } | undefined;
if (typeof ServiceWorkerGlobalScope === 'function' && globalThis instanceof ServiceWorkerGlobalScope) {
  const scope = globalThis as unknown as WorkerScopeLike & { __EASY68K_BUILD__?: BuildManifest };
  startServiceWorker(scope, scope.__EASY68K_BUILD__ as BuildManifest);
}
