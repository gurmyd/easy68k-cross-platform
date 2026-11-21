// Tests of the registration and the update notice (DV1). No DOM: fake worker objects.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKIP_WAITING_MESSAGE as WORKER_SKIP_WAITING } from '../../sw';
import { createFakePlatform, createTestApplication } from '../../state/testing';
import { feature } from './index';
import {
  SKIP_WAITING_MESSAGE,
  SW_META_NAME,
  UPDATE_ACTION,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_NOTICE,
  startPwa,
  type PwaDeps,
  type PwaEnvironment,
  type RegistrationLike,
  type ServiceWorkerContainerLike,
  type WorkerLike,
} from './register';
import { SW_META_NAME as BUILD_META_NAME } from './build/pwa-build.mjs';

class FakeWorker implements WorkerLike {
  state = 'installing';
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];
  postMessage(message: unknown): void {
    this.messages.push(message);
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  become(state: string): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  private readonly listeners: (() => void)[] = [];
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.listeners.push(listener);
  }
  async update(): Promise<void> {
    this.updates++;
  }
  /** A new version starts installing. */
  found(worker: FakeWorker): void {
    this.installing = worker;
    for (const listener of this.listeners) listener();
  }
}

class FakeContainer implements ServiceWorkerContainerLike {
  controller: unknown = null;
  readonly registered: { url: string; options: unknown }[] = [];
  readonly registration = new FakeRegistration();
  fail: Error | null = null;
  private readonly listeners = new Set<() => void>();
  async register(url: string, options?: unknown): Promise<RegistrationLike> {
    this.registered.push({ url, options });
    if (this.fail) throw this.fail;
    return this.registration;
  }
  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'controllerchange', listener: () => void): void {
    this.listeners.delete(listener);
  }
  changeController(next: unknown): void {
    this.controller = next;
    for (const listener of [...this.listeners]) listener();
  }
}

const SW_URL = 'https://example.test/easy68k-mac/sw.js';

function setup(options: { kind?: 'web' | 'desktop'; controlled?: boolean; scriptUrl?: string | null } = {}) {
  const container = new FakeContainer();
  if (options.controlled) container.controller = {};
  const toasts: { text: string; action: { label: string; run(): void }; options: unknown }[] = [];
  const timers: { delay: number; fn: () => void }[] = [];
  const warnings: string[] = [];
  const env: PwaEnvironment & { reloads: number } = {
    serviceWorker: container,
    scriptUrl: options.scriptUrl === undefined ? SW_URL : options.scriptUrl,
    reloads: 0,
    reload() {
      env.reloads++;
    },
  };
  const deps: PwaDeps = {
    platformKind: options.kind ?? 'web',
    toast: (text, action, toastOptions) => void toasts.push({ text, action, options: toastOptions }),
    setTimer: (delay, fn) => {
      const timer = { delay, fn };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer), 1);
    },
    warn: (message) => void warnings.push(message),
  };
  return { container, toasts, timers, warnings, env, deps, handle: startPwa(deps, env) };
}

describe('registration', () => {
  it('registers sw.js from the meta tag on the web, without the HTTP cache', async () => {
    const t = setup();
    expect(await t.handle.registration).toBe(t.container.registration);
    expect(t.container.registered).toEqual([{ url: SW_URL, options: { updateViaCache: 'none' } }]);
  });

  it('registers no worker in the desktop app', async () => {
    const t = setup({ kind: 'desktop' });
    expect(await t.handle.registration).toBeNull();
    expect(t.container.registered).toEqual([]);
  });

  it('registers no worker when the page has no meta tag (development server, unfinished build)', async () => {
    const t = setup({ scriptUrl: null });
    expect(await t.handle.registration).toBeNull();
    expect(t.container.registered).toEqual([]);
  });

  it('does nothing in a browser without service workers', async () => {
    const handle = startPwa(
      { platformKind: 'web', toast: () => {} },
      { serviceWorker: null, scriptUrl: SW_URL, reload: () => {} },
    );
    expect(await handle.registration).toBeNull();
    expect(await startPwa({ platformKind: 'web', toast: () => {} }, null).registration).toBeNull();
  });

  it('reports a failed registration as a warning, not an error', async () => {
    const container = new FakeContainer();
    container.fail = new Error('SecurityError');
    const warnings: string[] = [];
    const handle = startPwa(
      { platformKind: 'web', toast: () => {}, warn: (message) => void warnings.push(message) },
      { serviceWorker: container, scriptUrl: SW_URL, reload: () => {} },
    );
    expect(await handle.registration).toBeNull();
    expect(warnings).toEqual(['EASy68K: the service worker could not be registered; the app will not work offline.']);
  });

  it('asks for a new version once an hour', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    expect(t.timers.map((timer) => timer.delay)).toEqual([UPDATE_CHECK_INTERVAL_MS]);
    t.timers[0]?.fn();
    expect(t.container.registration.updates).toBe(1);
    expect(t.timers).toHaveLength(2);
    t.handle.dispose();
    expect(t.timers).toHaveLength(1);
  });

  it('uses the same message and meta name as the worker and the build step', () => {
    expect(SKIP_WAITING_MESSAGE).toBe(WORKER_SKIP_WAITING);
    expect(SW_META_NAME).toBe(BUILD_META_NAME);
  });
});

describe('update notice', () => {
  it('shows nothing when the first version installs', async () => {
    const t = setup({ controlled: false });
    await t.handle.registration;
    const worker = new FakeWorker();
    t.container.registration.found(worker);
    worker.become('installed');
    worker.become('activated');
    expect(t.toasts).toEqual([]);
    expect(t.env.reloads).toBe(0);
  });

  it('shows the notice when a new version waits, and never reloads by itself', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    const worker = new FakeWorker();
    t.container.registration.found(worker);
    worker.become('installed');
    t.container.registration.waiting = worker;
    worker.become('installed'); // a second statechange report changes nothing
    expect(t.toasts.map((toast) => [toast.text, toast.action.label])).toEqual([[UPDATE_NOTICE, UPDATE_ACTION]]);
    // The notice stays until it is answered (gate I1, DV1-toast-duration.md).
    expect(t.toasts[0]?.options).toEqual({ duration: 0 });
    // An hour passes: only the update check repeats. The notice, still on screen, is not shown a
    // second time; nothing reloads and the waiting version is not told to take over.
    t.timers[0]?.fn();
    expect(t.container.registration.updates).toBe(1);
    expect(t.env.reloads).toBe(0);
    expect(worker.messages).toEqual([]);
    expect(t.toasts.map((toast) => toast.text)).toEqual([UPDATE_NOTICE]);
  });

  it('a notice for another page taking over stays too', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    t.container.changeController({});
    expect(t.toasts.map((toast) => [toast.text, toast.options])).toEqual([[UPDATE_NOTICE, { duration: 0 }]]);
  });

  it('Reload lets the waiting version take over and reloads when it has', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    const worker = new FakeWorker();
    t.container.registration.found(worker);
    worker.become('installed');
    t.container.registration.waiting = worker;
    t.toasts[0]?.action.run();
    expect(worker.messages).toEqual([{ type: SKIP_WAITING_MESSAGE }]);
    expect(t.env.reloads).toBe(0);
    t.container.changeController({});
    expect(t.env.reloads).toBe(1);
  });

  it('a page whose version was replaced from another page gets the notice and keeps running', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    t.container.changeController({});
    expect(t.toasts.map((toast) => toast.text)).toEqual([UPDATE_NOTICE]);
    expect(t.env.reloads).toBe(0);
    // Its Reload loads the new version directly: nothing is waiting any more.
    t.toasts[0]?.action.run();
    expect(t.env.reloads).toBe(1);
  });

  it('shows the notice at start when a version is already waiting', async () => {
    const container = new FakeContainer();
    container.controller = {};
    container.registration.waiting = new FakeWorker();
    const toasts: string[] = [];
    const handle = startPwa(
      { platformKind: 'web', toast: (text) => void toasts.push(text) },
      { serviceWorker: container, scriptUrl: SW_URL, reload: () => {} },
    );
    await handle.registration;
    expect(toasts).toEqual([UPDATE_NOTICE]);
  });

  it('stops listening when disposed', async () => {
    const t = setup({ controlled: true });
    await t.handle.registration;
    t.handle.dispose();
    t.container.changeController({});
    expect(t.toasts).toEqual([]);
  });
});

describe('the feature module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A page with the meta tag and a worker container, as the production build has. */
  function stubPage(container: FakeContainer) {
    vi.stubGlobal('document', {
      baseURI: 'https://example.test/easy68k-mac/?open=/browser/a.X68',
      querySelector: (selector: string) => (selector === `meta[name="${SW_META_NAME}"]` ? { content: 'sw.js' } : null),
    });
    vi.stubGlobal('navigator', { serviceWorker: container });
    vi.stubGlobal('location', { reload: () => {} });
  }

  it('registers the worker on the web platform', async () => {
    const container = new FakeContainer();
    stubPage(container);
    const app = createTestApplication({ features: [feature] });
    await Promise.resolve();
    expect(container.registered.map((entry) => entry.url)).toEqual([SW_URL]);
    app.dispose();
  });

  it('passes the lasting notice to the dialog service (duration 0)', async () => {
    const container = new FakeContainer();
    container.controller = {};
    container.registration.waiting = new FakeWorker();
    stubPage(container);
    const app = createTestApplication({ features: [feature] });
    await vi.waitFor(() => expect(app.dialogs.toasts.getState()).toHaveLength(1));
    const [entry] = app.dialogs.toasts.getState();
    expect(entry?.text).toBe(UPDATE_NOTICE);
    expect(entry?.action?.label).toBe(UPDATE_ACTION);
    expect(entry?.duration).toBe(0);
    app.dispose();
  });

  it('registers no worker when the platform is the desktop app', async () => {
    const container = new FakeContainer();
    stubPage(container);
    const app = createTestApplication({ features: [feature], platform: createFakePlatform({ kind: 'desktop' }) });
    await Promise.resolve();
    expect(container.registered).toEqual([]);
    app.dispose();
  });

  it('does nothing under Node, where there is no page', () => {
    const app = createTestApplication({ features: [feature] });
    expect(app.ctx.platform.kind).toBe('web');
    app.dispose();
  });
});
