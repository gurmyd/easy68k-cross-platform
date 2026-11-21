// Tests of the service worker's logic under Node, with fake caches, clients and server (DV1).

import { describe, expect, it, vi } from 'vitest';
import {
  CLIENT_GRACE_MS,
  CLIENTS_CACHE,
  Easy68kServiceWorker,
  HASH_HEADER,
  SKIP_WAITING_MESSAGE,
  cacheNameFor,
  contentTypeFor,
  startServiceWorker,
  type BuildManifest,
  type PrecacheEntry,
  type WorkerScopeLike,
} from './sw';

const SCOPE = 'https://example.test/easy68k-mac/';

// --- fakes ------------------------------------------------------------------------------------

const keyOf = (request: Request | string) => (typeof request === 'string' ? request : request.url);

class FakeCache {
  readonly entries = new Map<string, { body: ArrayBuffer; status: number; headers: [string, string][] }>();
  async match(request: Request | string): Promise<Response | undefined> {
    const stored = this.entries.get(keyOf(request));
    return stored ? new Response(stored.body.slice(0), { status: stored.status, headers: stored.headers }) : undefined;
  }
  async put(request: Request | string, response: Response): Promise<void> {
    const body = await response.arrayBuffer();
    this.entries.set(keyOf(request), { body, status: response.status, headers: [...response.headers] });
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) this.caches.set(name, (cache = new FakeCache()));
    return cache;
  }
  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
  async has(name: string): Promise<boolean> {
    return this.caches.has(name);
  }
}

const encoder = new TextEncoder();

async function hashOf(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A web server with the files of one deployment; `online = false` makes every request fail. */
class FakeServer {
  files = new Map<string, Uint8Array>();
  online = true;
  readonly requests: string[] = [];
  deploy(files: Record<string, string>): void {
    this.files = new Map(Object.entries(files).map(([url, text]) => [new URL(url, SCOPE).href, encoder.encode(text)]));
  }
  fetch = async (input: Request | string): Promise<Response> => {
    const url = keyOf(input);
    this.requests.push(url);
    if (!this.online) throw new TypeError('Failed to fetch');
    const bytes = this.files.get(url);
    if (!bytes) return new Response('not found', { status: 404 });
    return new Response(bytes.slice(0), { status: 200, headers: { 'content-type': 'text/x-server' } });
  };
}

async function manifestOf(version: string, files: Record<string, string>): Promise<BuildManifest> {
  const entries: PrecacheEntry[] = [];
  for (const [url, text] of Object.entries(files)) {
    const bytes = encoder.encode(text);
    entries.push({ url, size: bytes.byteLength, sha256: await hashOf(bytes) });
  }
  return { version, entries };
}

function createScope(storage = new FakeCacheStorage(), server = new FakeServer()) {
  const listeners = new Map<string, (event: never) => void>();
  const open = new Set<string>();
  const scope = {
    registration: { scope: SCOPE },
    caches: storage as unknown as CacheStorage,
    clients: { matchAll: async () => [...open].map((id) => ({ id })) },
    crypto: { subtle: crypto.subtle },
    fetch: (input: Request | string) => server.fetch(input),
    skipWaiting: vi.fn(async () => {}),
    addEventListener: (type: string, listener: (event: never) => void) => void listeners.set(type, listener),
  } satisfies WorkerScopeLike;
  return { scope, storage, server, listeners, open };
}

const FILES_A = {
  'index.html': '<!doctype html><title>A</title>',
  'assets/index-a1.js': 'console.log("a")',
  'assets/sim68k-x1.wasm': 'wasm bytes',
  'help/Quick%20Reference.htm': '<p>quick</p>',
  'check/fixture.txt': 'version A',
};
const FILES_B = { ...FILES_A, 'index.html': '<!doctype html><title>B</title>', 'check/fixture.txt': 'version B' };

const navigate = (url: string) => new Request(url, { mode: 'navigate' as RequestMode });

async function text(response: Promise<Response> | null): Promise<string | null> {
  return response ? (await response).text() : null;
}

// Node's Request refuses mode 'navigate'; the worker only reads `mode`, so a stand-in will do.
function navigationRequest(url: string): Request {
  try {
    return navigate(url);
  } catch {
    const request = new Request(url);
    Object.defineProperty(request, 'mode', { value: 'navigate' });
    return request;
  }
}

// --- tests ------------------------------------------------------------------------------------

describe('install', () => {
  it('stores every file of the list with its hash and content type', async () => {
    const t = createScope();
    t.server.deploy(FILES_A);
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A));
    await worker.install();
    const cache = t.storage.caches.get(cacheNameFor('A'));
    expect(cache?.entries.size).toBe(5);
    const stored = await cache?.match(`${SCOPE}assets/sim68k-x1.wasm`);
    expect(await stored?.text()).toBe('wasm bytes');
    expect(stored?.headers.get(HASH_HEADER)).toBe(await hashOf(encoder.encode('wasm bytes')));
    expect(stored?.headers.get('content-type')).toBe('text/x-server');
    expect(t.server.requests).toHaveLength(5);
  });

  it('fails, and leaves no cache, when a file is not the one of this build', async () => {
    const t = createScope();
    t.server.deploy({ ...FILES_A, 'assets/index-a1.js': 'console.log("deployment in progress")' });
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A));
    await expect(worker.install()).rejects.toThrow(/assets\/index-a1\.js is not the file of this build/);
    expect(t.storage.caches.has(cacheNameFor('A'))).toBe(false);
  });

  it('fails when a file is missing on the server', async () => {
    const t = createScope();
    const { 'help/Quick%20Reference.htm': _gone, ...rest } = FILES_A;
    t.server.deploy(rest);
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A));
    await expect(worker.install()).rejects.toThrow(/Quick%20Reference\.htm answered 404/);
    expect(t.storage.caches.has(cacheNameFor('A'))).toBe(false);
  });

  it('copies unchanged files from an older version instead of downloading them again', async () => {
    const t = createScope();
    t.server.deploy(FILES_A);
    await new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A)).install();
    t.server.requests.length = 0;
    t.server.deploy(FILES_B);
    await new Easy68kServiceWorker(t.scope, await manifestOf('B', FILES_B)).install();
    expect(t.server.requests.sort()).toEqual([`${SCOPE}check/fixture.txt`, `${SCOPE}index.html`]);
    const cacheB = t.storage.caches.get(cacheNameFor('B'));
    expect(await (await cacheB?.match(`${SCOPE}assets/sim68k-x1.wasm`))?.text()).toBe('wasm bytes');
    expect(await (await cacheB?.match(`${SCOPE}check/fixture.txt`))?.text()).toBe('version B');
  });

  it('gives a server without content types a type from the extension', () => {
    expect(contentTypeFor('assets/sim68k-x.mjs')).toBe('text/javascript');
    expect(contentTypeFor('assets/sim68k-x.wasm')).toBe('application/wasm');
    expect(contentTypeFor('help/Quick%20Reference.htm')).toBe('text/html');
    expect(contentTypeFor('fonts/x.bin')).toBe('application/octet-stream');
  });
});

describe('fetch', () => {
  async function installed() {
    const t = createScope();
    t.server.deploy(FILES_A);
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A));
    await worker.install();
    await worker.activate();
    t.server.online = false; // from here on, only the cache can answer
    return { ...t, worker };
  }

  it('answers the files of the list from the cache with the network off', async () => {
    const t = await installed();
    const before = t.server.requests.length;
    expect(await text(t.worker.respond(new Request(`${SCOPE}assets/index-a1.js`), 'page', ''))).toBe(
      'console.log("a")',
    );
    expect(await text(t.worker.respond(new Request(`${SCOPE}check/fixture.txt`), 'page', ''))).toBe('version A');
    expect(t.server.requests.length).toBe(before);
  });

  it('answers a navigation to the scope, with or without a query, with index.html', async () => {
    const t = await installed();
    for (const url of [SCOPE, `${SCOPE}?open=/browser/a.X68&run=1`, `${SCOPE}index.html`]) {
      expect(await text(t.worker.respond(navigationRequest(url), '', 'new-page'))).toBe(
        '<!doctype html><title>A</title>',
      );
    }
  });

  it('matches percent-encoded and plain spellings of a name with a space', async () => {
    const t = await installed();
    expect(await text(t.worker.respond(new Request(`${SCOPE}help/Quick%20Reference.htm`), 'page', ''))).toBe(
      '<p>quick</p>',
    );
    expect(await text(t.worker.respond(navigationRequest(`${SCOPE}help/Quick Reference.htm`), '', 'frame'))).toBe(
      '<p>quick</p>',
    );
  });

  it('leaves everything else to the network', async () => {
    const t = await installed();
    const ignored = [
      new Request(`${SCOPE}sw.js`),
      new Request(`${SCOPE}assets/index-a1.js.map`),
      new Request(`${SCOPE}unknown.txt`),
      new Request('https://example.test/index.html'),
      new Request('https://example.test/other/index.html'),
      new Request('https://api.github.com/repos/x/y/releases/latest'),
      new Request(`${SCOPE}check/fixture.txt`, { method: 'POST', body: 'x' }),
      new Request(SCOPE), // the scope itself, but not as a navigation
    ];
    for (const request of ignored) expect(t.worker.respond(request, 'page', ''), request.url).toBeNull();
  });
});

describe('versions', () => {
  it('keeps an open page on the files of its own version after a new one took over', async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const storage = new FakeCacheStorage();
    const server = new FakeServer();
    const a = createScope(storage, server);
    server.deploy(FILES_A);
    const workerA = new Easy68kServiceWorker(a.scope, await manifestOf('A', FILES_A), now);
    await workerA.install();
    await workerA.activate();
    // Two pages are loaded. As in a browser, a page appears among the clients only after its
    // navigation has been answered: the record must survive that moment.
    for (const page of ['page1', 'page2']) {
      await text(workerA.respond(navigationRequest(SCOPE), '', page));
      a.open.add(page);
      clock += 1000;
    }
    expect(await storage.caches.get(CLIENTS_CACHE)?.match(`${SCOPE}__easy68k/clients.json`)).toBeDefined();

    // A new deployment; its worker starts afresh (the old one's memory is gone).
    server.deploy(FILES_B);
    const b = createScope(storage, server);
    b.open.add('page1').add('page2');
    const workerB = new Easy68kServiceWorker(b.scope, await manifestOf('B', FILES_B), now);
    await workerB.install();
    clock += 120_000;
    await workerB.activate();
    server.online = false;
    expect([...storage.caches.keys()].sort()).toEqual([CLIENTS_CACHE, cacheNameFor('A'), cacheNameFor('B')]);

    // The open pages keep version A; a new page gets version B.
    for (const page of ['page1', 'page2']) {
      expect(await text(workerB.respond(new Request(`${SCOPE}check/fixture.txt`), page, ''))).toBe('version A');
    }
    expect(await text(workerB.respond(navigationRequest(SCOPE), '', 'page3'))).toBe('<!doctype html><title>B</title>');
    b.open.add('page3');
    expect(await text(workerB.respond(new Request(`${SCOPE}check/fixture.txt`), 'page3', ''))).toBe('version B');
    expect(await workerB.versionOf('page1')).toBe('A');

    // The two old pages close (they were recorded more than a minute ago): the next navigation
    // frees version A.
    b.open.delete('page1');
    b.open.delete('page2');
    await text(workerB.respond(navigationRequest(SCOPE), '', 'page4'));
    expect([...storage.caches.keys()].sort()).toEqual([CLIENTS_CACHE, cacheNameFor('B')]);
    expect(await workerB.versionOf('page1')).toBe('B');
    expect(await workerB.versionOf('page4')).toBe('B');
  });

  it('forgets a page that was never opened only after the grace time', async () => {
    let clock = 5_000_000;
    const t = createScope();
    t.server.deploy(FILES_A);
    await new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A), () => clock).install();
    t.server.deploy(FILES_B);
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('B', FILES_B), () => clock);
    await worker.install();
    await worker.activate();
    await text(worker.respond(navigationRequest(SCOPE), '', 'lost'));
    await worker.removeUnusedVersions();
    expect(await worker.versionOf('lost')).toBe('B');
    const stored = async () =>
      JSON.parse(
        (await (await t.storage.caches.get(CLIENTS_CACHE)?.match(`${SCOPE}__easy68k/clients.json`))?.text()) ?? '{}',
      );
    expect(Object.keys(await stored())).toEqual(['lost']);
    clock += CLIENT_GRACE_MS + 1;
    await worker.removeUnusedVersions();
    expect(Object.keys(await stored())).toEqual([]);
  });

  it('deletes versions nobody uses when it activates', async () => {
    const t = createScope();
    t.server.deploy(FILES_A);
    await new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A)).install();
    t.server.deploy(FILES_B);
    const workerB = new Easy68kServiceWorker(t.scope, await manifestOf('B', FILES_B));
    await workerB.install();
    await workerB.activate();
    expect([...t.storage.caches.keys()].filter((name) => name !== CLIENTS_CACHE)).toEqual([cacheNameFor('B')]);
  });

  it('serves the active version to a page it has no record of', async () => {
    const t = createScope();
    t.server.deploy(FILES_A);
    const worker = new Easy68kServiceWorker(t.scope, await manifestOf('A', FILES_A));
    await worker.install();
    await worker.activate();
    expect(await worker.versionOf('unknown-page')).toBe('A');
    expect(await worker.versionOf('')).toBe('A');
  });
});

describe('events', () => {
  it('connects install, activate, fetch and message', async () => {
    const t = createScope();
    t.server.deploy(FILES_A);
    startServiceWorker(t.scope, await manifestOf('A', FILES_A));
    expect([...t.listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install', 'message']);
    const dispatch = async (type: string, event: object) => {
      const pending: Promise<unknown>[] = [];
      const listener = t.listeners.get(type) as (event: object) => void;
      listener({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.all(pending);
    };
    await dispatch('install', {});
    await dispatch('activate', {});
    let answered: Promise<Response> | null = null;
    await dispatch('fetch', {
      request: new Request(`${SCOPE}check/fixture.txt`),
      clientId: 'page',
      resultingClientId: '',
      respondWith: (response: Promise<Response>) => void (answered = response),
    });
    expect(await text(answered)).toBe('version A');
    let ignored = true;
    await dispatch('fetch', {
      request: new Request('https://elsewhere.test/'),
      clientId: 'page',
      resultingClientId: '',
      respondWith: () => void (ignored = false),
    });
    expect(ignored).toBe(true);
    await dispatch('message', { data: { type: 'something else' } });
    expect(t.scope.skipWaiting).not.toHaveBeenCalled();
    await dispatch('message', { data: { type: SKIP_WAITING_MESSAGE } });
    expect(t.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('refuses to start without the build manifest', () => {
    const t = createScope();
    expect(() => new Easy68kServiceWorker(t.scope, undefined as unknown as BuildManifest)).toThrow(/__EASY68K_BUILD__/);
  });
});
