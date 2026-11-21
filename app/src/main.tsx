// Entry point of the page (ARCHITECTURE.md 3.12.3, 3.13). Owner: W3.
//
// It gathers what the browser provides - the platform bridge, localStorage, time, the file-system
// backends, the two engines - hands it to bootstrap() and renders the result. `?gallery` shows the
// component kit's gallery instead of the application (work package W2).
//
// Parts that other packages deliver later are picked up by NAME, so that nobody has to edit this
// file when they arrive (docs/porting/errata/W3.md):
//
//   app/src/platform/desktop.ts   export function createDesktopPlatform(): Platform | Promise<Platform>
//       used when the Electron preload script has exposed `window.easy68kDesktop` (3.13)
//   app/src/fs/<name>-backend.ts  export function createStartupBackends(platform: Platform):
//                                     FileSystemBackend[] | Promise<FileSystemBackend[]>
//       the backends to mount at start (3.8.1: the browser store). `platform.disk` is mounted by
//       bootstrap() itself.
//
// Until a real backend exists, a memory backend stands at `/browser`, so that the paths of 3.8.2
// work; its files are gone when the page is closed.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles';
import { App } from './App';
import { bootstrap } from './bootstrap';
import { buildInfo } from './build-info';
import type { AsmEngine, FileSystemBackend, Platform, SimEngine } from './contracts';
import { MemoryBackend } from './fs/memory-backend';
import { CachedSyncFiles } from './fs/sync/cached';
import { createWebPlatform } from './platform/web';
import { browserSettingsStorage, createFrameScheduler, createRealClock } from './state/browser';
import type { Application } from './state/context';
import type { SimEngineFactory } from './state/services';
import { applyThemeSetting } from './styles';
import { galleryRequest } from './ui/components/gallery/route';

interface DesktopPlatformModule {
  createDesktopPlatform?: () => Platform | Promise<Platform>;
}
interface BackendModule {
  createStartupBackends?: (platform: Platform) => FileSystemBackend[] | Promise<FileSystemBackend[]>;
}

// Modules that may not exist yet. A glob that matches nothing is an empty object. The memory
// backend is left out: it is this file's own fallback and exports no such function.
const DESKTOP_PLATFORM = import.meta.glob<DesktopPlatformModule>('./platform/desktop.ts');
const BACKENDS = import.meta.glob<BackendModule>(['./fs/*-backend.ts', '!./fs/memory-backend.ts']);

async function createPlatform(): Promise<Platform> {
  if ('easy68kDesktop' in window) {
    const module = await DESKTOP_PLATFORM['./platform/desktop.ts']?.();
    if (module?.createDesktopPlatform) return module.createDesktopPlatform();
    console.error(
      'window.easy68kDesktop exists, but app/src/platform/desktop.ts does not export createDesktopPlatform(). ' +
        'Running with the web platform.',
    );
  }
  return createWebPlatform();
}

async function startupBackends(platform: Platform): Promise<FileSystemBackend[]> {
  const backends: FileSystemBackend[] = [];
  for (const path of Object.keys(BACKENDS).sort()) {
    const module = await BACKENDS[path]?.();
    if (module?.createStartupBackends) backends.push(...(await module.createStartupBackends(platform)));
  }
  if (!backends.some((backend) => backend.mount === 'browser')) {
    backends.push(new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' }));
  }
  return backends;
}

/**
 * The assembler: the real engine, loaded when the first assembly asks for it (it is 137 kB of
 * WebAssembly). Section 3.12.3 names the scripted assembler of engine/fake-asm.ts for wave zero;
 * that one serves unit tests (section 9), which pass it to bootstrap() themselves
 * (state/testing.ts). See docs/porting/errata/W3.md, entry 22.
 */
function lazyAsmEngine(): AsmEngine {
  let engine: Promise<AsmEngine> | null = null;
  return {
    async assemble(mainName, files, options, timestamp) {
      engine ??= import('./engine').then((binding) => binding.createAsmEngine());
      const loaded = await engine.catch((error: unknown) => {
        engine = null; // a failed load is tried again by the next assembly
        throw error;
      });
      return loaded.assemble(mainName, files, options, timestamp);
    },
  };
}

/** Simulator engines for the session of features/run, which may not import app/src/engine (3.1). */
function simEngines(): SimEngineFactory {
  let release: ((engine: SimEngine) => void) | null = null;
  return {
    async create(host) {
      const binding = await import('./engine');
      release = binding.releaseSimEngine;
      return binding.createSimEngine(host);
    },
    release: (engine) => release?.(engine),
  };
}

declare global {
  interface Window {
    /** Development builds only: the running application, for the browser console and for checks. */
    __easy68k?: Application;
  }
}

async function start(container: HTMLElement): Promise<void> {
  const gallery = galleryRequest(location.search);
  if (gallery) {
    // Dynamic import: the gallery is not part of the application bundle.
    const { mountGallery } = await import('./ui/components/gallery/mount');
    mountGallery(container, gallery);
    return;
  }

  const platform = await createPlatform();
  const app = bootstrap({
    platform,
    settingsStorage: browserSettingsStorage(window),
    clock: createRealClock(),
    scheduler: createFrameScheduler(),
    backends: await startupBackends(platform),
    asm: lazyAsmEngine(),
    session: { engines: simEngines(), createCachedSyncFiles: (deps) => new CachedSyncFiles(deps) },
    locks: 'locks' in navigator ? navigator.locks : null,
    keyTarget: window,
    version: buildInfo.version,
    repository: buildInfo.repository,
  });
  if (import.meta.env.DEV) window.__easy68k = app;

  // The stored theme before the first paint; the shell keeps it current from then on.
  applyThemeSetting(app.ctx.settings.get().app.theme)();

  createRoot(container).render(
    <StrictMode>
      <App app={app} />
    </StrictMode>,
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');
start(container).catch((error: unknown) => {
  console.error('EASy68K could not start:', error);
  container.textContent = `EASy68K could not start: ${error instanceof Error ? error.message : String(error)}`;
});
