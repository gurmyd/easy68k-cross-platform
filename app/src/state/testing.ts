// Test support: a whole application built from fakes, under Node, in a few milliseconds. Owner: W3.
//
//   const app = createTestApplication();
//   await app.ctx.commands.run('app.mode.set', 'simulator');
//
// Everything that would touch a browser is replaced: the platform (createFakePlatform), the
// settings storage (in memory), time (a clock that stands still, a scheduler that never fires),
// the file system (a memory backend at /browser), the assembler (the scripted FakeAsmEngine) and
// the simulator engines (none: creating one rejects). By default NO feature module is loaded (only
// the shell's own five commands have handlers) and the four services that features provide are
// the stubs of state/stub-services.ts, so that a test does not depend on what other feature
// packages do. A feature's own test passes its module and factory:
//
//   createTestApplication({ features: [feature], services: { createDocumentService } });
//
// This file is for unit tests only; nothing in the application imports it.

import { bootstrap, type BootstrapEnv } from '../bootstrap';
import type { CommandId, FeatureModule, NativeMenuItem, Platform } from '../contracts';
import { MemorySettingsStorage, type SettingsStorage } from '../core/settings/service';
import { FakeAsmEngine } from '../engine/fake-asm';
import { MemoryBackend } from '../fs/memory-backend';
import { MemorySyncFiles } from '../fs/sync/memory';
import type { Application } from './context';
import type { ServiceFactories } from './services';
import {
  createInertSimSession,
  createSilentAudioBackend,
  createStubDocumentService,
  createStubFileDialogs,
} from './stub-services';
import type { LockManagerLike } from './window-lock';

/** A Platform that records what the application asks of it. */
export interface FakePlatform extends Platform {
  /** Every title passed to setTitle, oldest first. */
  readonly titles: string[];
  /** Every menu passed to setNativeMenu, oldest first. */
  readonly nativeMenus: NativeMenuItem[][];
  /** How often newWindow() was called. */
  newWindows: number;
  /** Acts as the native menu of the desktop app: the user chose an item with the mouse. */
  chooseNativeCommand(id: CommandId, arg?: unknown): void;
}

export function createFakePlatform(overrides: Partial<Platform> = {}): FakePlatform {
  const nativeListeners = new Set<(id: CommandId, arg?: unknown) => void>();
  const platform: FakePlatform = {
    kind: 'web',
    os: 'windows',
    windowId: 'test-window',
    startupArgs: () => ({ file: null, run: false, fullScreen: false, exceptions: false, bitField: false }),
    onOpenFiles: () => () => {},
    setNativeMenu(menu) {
      platform.nativeMenus.push(menu);
    },
    onNativeCommand(listener) {
      nativeListeners.add(listener);
      return () => {
        nativeListeners.delete(listener);
      };
    },
    setTitle(title) {
      platform.titles.push(title);
    },
    print: async () => {},
    openExternal: () => {},
    showHelp: () => false,
    confirmBeforeUnload: () => {},
    newWindow() {
      platform.newWindows++;
    },
    setFullScreen: null,
    pasteIntoFocus: null,
    quit: () => {},
    disk: null,
    syncFiles: null,
    serial: null,
    net: null,
    ...overrides,
    titles: [],
    nativeMenus: [],
    newWindows: 0,
    chooseNativeCommand(id, arg) {
      for (const listener of [...nativeListeners]) listener(id, arg);
    },
  };
  return platform;
}

/** A lock manager that grants every lock at once and remembers which are held. */
export class FakeLocks implements LockManagerLike {
  readonly held = new Set<string>();

  async request(name: string, callback: (lock: unknown) => Promise<unknown>): Promise<unknown> {
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }

  async query(): Promise<{ held: { name: string }[] }> {
    return { held: [...this.held].map((name) => ({ name })) };
  }
}

/** The stub services of wave zero, independent of the feature folders. */
export const STUB_SERVICES: ServiceFactories = {
  createFileDialogs: () => createStubFileDialogs(),
  createDocumentService: (ctx) => createStubDocumentService(ctx),
  createAudioBackend: () => createSilentAudioBackend(),
  createSimSession: (ctx) => createInertSimSession(ctx),
};

export interface TestApplicationOptions extends Partial<Omit<BootstrapEnv, 'services' | 'features'>> {
  features?: readonly FeatureModule[];
  services?: Partial<ServiceFactories>;
  /** Shared by the windows of one test (createTestApplication twice with the same storage). */
  storage?: MemorySettingsStorage;
}

export interface TestApplication extends Application {
  readonly platform: FakePlatform;
  readonly asm: FakeAsmEngine;
  readonly locks: FakeLocks;
  readonly storage: MemorySettingsStorage;
}

export function createTestApplication(options: TestApplicationOptions = {}): TestApplication {
  const { storage = new MemorySettingsStorage(), features = [], services, ...env } = options;
  const platform = (env.platform as FakePlatform | undefined) ?? createFakePlatform();
  const asm = new FakeAsmEngine();
  const locks = new FakeLocks();
  const settingsStorage: SettingsStorage = env.settingsStorage ?? storage.window();
  const app = bootstrap({
    clock: { now: () => 0, wallTime: () => new Date(2026, 10, 20, 12, 0, 0) },
    scheduler: { onFrame: () => () => {}, setTimer: () => () => {} },
    backends: [new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' })],
    asm,
    session: {
      engines: {
        create: () => Promise.reject(new Error('The test application has no simulator engine')),
        release: () => {},
      },
      createCachedSyncFiles: () => new MemorySyncFiles(),
    },
    locks,
    keyTarget: null,
    version: '0.0.0-test',
    onError: (what, error) => {
      throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    },
    ...env,
    platform,
    settingsStorage,
    features,
    services: { ...STUB_SERVICES, ...services },
  });
  return Object.assign(app, { platform, asm, locks, storage });
}
