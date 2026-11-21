// Registers the service worker and shows the update notice (ARCHITECTURE.md 1.1, 7.5, 7.6).
// Owner: DV1.
//
// - Only the web platform registers a worker. The desktop app serves its files from the package
//   (`platform.kind === 'desktop'`, 7.6) and registers none.
// - Only a production build that the PWA build step finished has a worker: that step puts
//   <meta name="easy68k-service-worker" content="sw.js"> into index.html
//   (features/pwa/build/pwa-build.mjs). The development server and a build without the step have
//   no such tag, and nothing is registered.
// - When a new version has been installed and waits, the notice `A new version is available.`
//   with the action `Reload` appears and stays until it is answered (`duration: 0`, gate I1,
//   docs/requests/DV1-toast-duration.md); a dismissed notice comes again at the next start of a
//   page while the version still waits. Nothing reloads by itself: only pressing `Reload` lets the
//   new version take over (message to the waiting worker) and then reloads this page. Another
//   page of the same site that sees the new version take over gets the notice and keeps running
//   on the files of its own version (sw.ts) until it is reloaded.
//
// The browser objects are reached through the small interfaces below, so that the logic runs
// under Node with fakes (register.test.ts).

import type { ToastOptions } from '../../contracts';

/** The text of the update notice (7.5: "A new version is available. Reload"). */
export const UPDATE_NOTICE = 'A new version is available.';
export const UPDATE_ACTION = 'Reload';
/** The notice stays until it is dismissed or `Reload` is pressed (ToastOptions.duration 0). */
export const UPDATE_NOTICE_OPTIONS: Readonly<ToastOptions> = Object.freeze({ duration: 0 });
/** Must equal SKIP_WAITING_MESSAGE of app/src/sw.ts (checked by register.test.ts). */
export const SKIP_WAITING_MESSAGE = 'easy68k-skip-waiting';
/** The name of the meta tag that the build step adds (pwa-build.mjs SW_META_NAME). */
export const SW_META_NAME = 'easy68k-service-worker';
/** How often an open page asks whether a new version has been deployed. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
}

export interface ServiceWorkerContainerLike {
  readonly controller: unknown;
  register(url: string, options?: { updateViaCache?: 'imports' | 'all' | 'none' }): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
  removeEventListener(type: 'controllerchange', listener: () => void): void;
}

/** What the page offers: the worker container, the worker's URL from the meta tag, reloading. */
export interface PwaEnvironment {
  serviceWorker: ServiceWorkerContainerLike | null;
  /** Absolute URL of sw.js, or null when the page has no meta tag. */
  scriptUrl: string | null;
  reload(): void;
}

export interface PwaDeps {
  platformKind: 'web' | 'desktop';
  toast(text: string, action: { label: string; run(): void }, options: ToastOptions): void;
  setTimer?: (delayMs: number, fn: () => void) => () => void;
  /** Told about a registration that failed (default: console.warn). */
  warn?: (message: string, error: unknown) => void;
}

/** The environment of a real page, or null outside a browser (Node, tests). */
export function browserEnvironment(): PwaEnvironment | null {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return null;
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${SW_META_NAME}"]`);
  const content = meta?.content.trim();
  return {
    serviceWorker: 'serviceWorker' in navigator ? (navigator.serviceWorker as ServiceWorkerContainerLike) : null,
    scriptUrl: content ? new URL(content, document.baseURI).href : null,
    reload: () => location.reload(),
  };
}

export interface PwaHandle {
  /** The registration once it exists (null on the desktop, without a worker, or on failure). */
  readonly registration: Promise<RegistrationLike | null>;
  dispose(): void;
}

/** Starts the offline support of one page. */
export function startPwa(deps: PwaDeps, env: PwaEnvironment | null): PwaHandle {
  const none: PwaHandle = { registration: Promise.resolve(null), dispose: () => {} };
  if (deps.platformKind !== 'web' || !env?.serviceWorker || !env.scriptUrl) return none;
  const container = env.serviceWorker;
  const warn = deps.warn ?? ((message: string, error: unknown) => console.warn(message, error));

  let disposed = false;
  let reloadRequested = false;
  let noticeShown = false;
  let cancelTimer: (() => void) | null = null;
  let registration: RegistrationLike | null = null;

  const showNotice = () => {
    if (disposed || noticeShown) return;
    noticeShown = true;
    deps.toast(
      UPDATE_NOTICE,
      {
        label: UPDATE_ACTION,
        run: () => {
          noticeShown = false;
          const waiting = registration?.waiting;
          reloadRequested = true;
          if (waiting) waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
          // The new version has already taken over (another page pressed Reload): load it.
          else env.reload();
        },
      },
      UPDATE_NOTICE_OPTIONS,
    );
  };

  // The page that pressed Reload loads the new version once it has taken over. Any other page
  // only learns that a new version exists.
  const onControllerChange = () => {
    if (disposed) return;
    if (reloadRequested) env.reload();
    else showNotice();
  };
  container.addEventListener('controllerchange', onControllerChange);

  /** A worker that finished installing while a version controls this page is an update. */
  const watch = (worker: WorkerLike | null) => {
    if (!worker) return;
    const check = () => {
      if (worker.state === 'installed' && container.controller) showNotice();
    };
    worker.addEventListener('statechange', check);
    check();
  };

  const scheduleCheck = () => {
    if (!deps.setTimer || disposed) return;
    cancelTimer = deps.setTimer(UPDATE_CHECK_INTERVAL_MS, () => {
      // Only the check for a newer deployment repeats; the notice stays on screen by itself.
      registration?.update().catch(() => {});
      scheduleCheck();
    });
  };

  const registered = container
    .register(env.scriptUrl, { updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      if (disposed) return reg;
      // A version that was installed while no page had it open yet waits now.
      if (reg.waiting && container.controller) showNotice();
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      scheduleCheck();
      return reg;
    })
    .catch((error: unknown) => {
      warn('EASy68K: the service worker could not be registered; the app will not work offline.', error);
      return null;
    });

  return {
    registration: registered,
    dispose() {
      disposed = true;
      cancelTimer?.();
      container.removeEventListener('controllerchange', onControllerChange);
    },
  };
}
