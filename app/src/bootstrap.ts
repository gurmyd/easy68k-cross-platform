// The composition root of the application (ARCHITECTURE.md 3.12.3). Owner: W3.
//
// bootstrap() builds everything one window needs and returns it as an `Application`: the
// AppContext of the contracts with every service on it, the command registry with the handlers of
// all features, the panels and dialogs they contribute, the keyboard dispatcher and the window
// lock. It does not render anything and touches no browser global: what comes from the
// surroundings (platform, storage, clock, backends, engines, the key event target) arrives in
// `BootstrapEnv`. main.tsx supplies the real things; tests supply fakes.
//
// Services are created in the order of 3.12.3:
//
//   platform, settings, store, commands, dialogs, vfs (+ backends), fileDialogs, history, viewer,
//   documents, asm, devices, sim
//
// (history and viewer: ARCHITECTURE-PLUS P4.4; each is undefined when its factory is absent.)
// Four of them come from features, through factories with fixed names (state/services.ts). A
// factory receives the context while it is still being filled: it may keep it, but reading a
// service that comes later in the order throws a clear error instead of returning undefined.
// After the services, every feature's commands, panels and dialogs are registered and its `init`
// runs, in the order of features/index.ts.

import type {
  AppContext,
  AppState,
  AsmEngine,
  Clock,
  CommandId,
  FeatureModule,
  FileSystemBackend,
  Mode,
  Platform,
  Scheduler,
} from './contracts';
import type { Os } from './commands/chords';
import { hasProgramKeys, installKeymap, isPlainTextField, type KeyOutcome } from './commands/keymap';
import {
  TextFieldHistory,
  browserTextEditHost,
  installTextFieldHistory,
  performTextFieldEdit,
  type PlainTextField,
  type TextEditHost,
} from './commands/text-field-edits';
import { buildNativeMenu } from './commands/native-menu';
import { createCommandRegistry } from './commands/registry';
import { shellCommands } from './commands/shell-commands';
import { createSettingsService, type SettingsStorage } from './core/settings/service';
import { FEATURES, SERVICE_FACTORIES } from './features';
import { createVfs } from './fs/vfs';
import type { Application, BuildFacts, DialogComponent } from './state/context';
import { MESSAGE_DIALOG_ID, createDialogService } from './state/dialogs';
import { createEditorExtensionRegistry } from './state/editor-extensions';
import { createPanelRegistry } from './state/panels';
import type { ServiceFactories, SimSessionEnv } from './state/services';
import { attachShellState } from './state/shell';
import { createAppStore } from './state/store';
import { holdWindowLock, type LockManagerLike } from './state/window-lock';

export interface BootstrapEnv {
  platform: Platform;
  /** Where the settings document lives (state/browser.ts: localStorage). */
  settingsStorage: SettingsStorage;
  clock: Clock;
  scheduler: Scheduler;
  /** File-system backends to mount at start (3.8.1). `platform.disk` is mounted as well. */
  backends: readonly FileSystemBackend[];
  asm: AsmEngine;
  /** What the simulator session cannot import itself: engines and the cached file view (3.1). */
  session: SimSessionEnv;
  /** navigator.locks, for the window lock of 3.8.6; null where it does not exist. */
  locks: LockManagerLike | null;
  /** Where the keyboard dispatcher listens (the window); null = no dispatcher. */
  keyTarget: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /** The port's version, for the window title (1.3.3) and AppContext.build. */
  version: string;
  /** The port's GitHub repository, "owner/name" (build-info.ts); default null = not known. */
  repository?: string | null;
  /** Default: the 24 features of features/index.ts. */
  features?: readonly FeatureModule[];
  /** Replace service factories; default: those of the features. */
  services?: Partial<ServiceFactories>;
  /** Told what the dispatcher did with each key-down (diagnostics and tests). */
  onKey?: (outcome: KeyOutcome, event: KeyboardEvent) => void;
  /** Told about a command or feature that threw; default: console.error. */
  onError?: (what: string, error: unknown) => void;
}

/** The order in which services appear on the context (3.12.3), for the error message. */
const SERVICE_ORDER =
  'platform, settings, store, commands, dialogs, vfs, fileDialogs, history, viewer, documents, asm, devices, sim';

const CONTEXT_KEYS: readonly (keyof AppContext)[] = [
  'platform',
  'build',
  'clock',
  'scheduler',
  'settings',
  'store',
  'commands',
  'dialogs',
  'vfs',
  'editorExtensions',
  'fileDialogs',
  'history',
  'viewer',
  'documents',
  'asm',
  'devices',
  'sim',
];

/** An AppContext whose services are added one by one; reading one too early throws. */
function createPendingContext(): {
  ctx: AppContext;
  set<K extends keyof AppContext>(key: K, value: AppContext[K]): void;
} {
  const values = new Map<keyof AppContext, unknown>();
  const ctx = {} as AppContext;
  for (const key of CONTEXT_KEYS) {
    Object.defineProperty(ctx, key, {
      enumerable: true,
      get() {
        if (!values.has(key)) {
          throw new Error(
            `AppContext.${key} does not exist yet. Services are created in this order: ${SERVICE_ORDER}. ` +
              'A service factory may keep the context, but must not read a later service while it runs.',
          );
        }
        return values.get(key);
      },
    });
  }
  return { ctx, set: (key, value) => void values.set(key, value) };
}

/** The original programs' titles (editor-ui §1.1, sim-ui §1.1, section 1.1). */
const TITLES: Record<Mode, string> = {
  editor: 'EASy68K Editor/Assembler v5.16.01',
  simulator: 'EASy68K Simulator v5.16.1',
  easybin: 'EASyBIN v2.5.0',
};

/**
 * The window title (1.3.3): the original program's title, then the port's notice. In Simulator
 * mode the title is the name of the loaded program, as in the original (sim-ui §8.2 step 8). A
 * title a mode's feature has set with setModeTitle (`modeTitles`, state/shell.ts) comes first:
 * EASyBIN's opened file (docs/requests/B1-window-title.md).
 */
export function windowTitle(
  state: Pick<AppState, 'mode'> & { sim: Pick<AppState['sim'], 'program'> },
  version: string,
  modeTitles: Partial<Record<Mode, string>> = {},
): string {
  const title =
    modeTitles[state.mode] ??
    (state.mode === 'simulator' && state.sim.program ? state.sim.program.title : TITLES[state.mode]);
  return `${title} - unofficial port ${version}`;
}

export function bootstrap(env: BootstrapEnv): Application {
  const onError = env.onError ?? ((what: string, error: unknown) => console.error(`${what}:`, error));
  const features = env.features ?? FEATURES;
  const factories: ServiceFactories = { ...SERVICE_FACTORIES, ...env.services };
  const disposers: (() => void)[] = [];
  const { ctx, set } = createPendingContext();
  const { platform } = env;

  // ---- services, in the order of 3.12.3
  set('platform', platform);
  set('clock', env.clock);
  set('scheduler', env.scheduler);
  // The port's version and repository for the About boxes (docs/requests/H1-build-info.md).
  const build: BuildFacts = Object.freeze({ version: env.version, repository: env.repository ?? null });
  set('build', build);

  const settings = createSettingsService(env.settingsStorage, (error) => onError('Settings storage', error));
  set('settings', settings);
  disposers.push(() => settings.dispose());

  const store = createAppStore(settings.get());
  set('store', store);
  // AppState.settings mirrors the service (3.12.1).
  disposers.push(settings.subscribe(() => store.setState((state) => ({ ...state, settings: settings.get() }))));

  let simReady = false;
  const dialogComponents = new Map<string, DialogComponent>();
  const dialogs = createDialogService({
    store,
    controller: () => (simReady ? ctx.sim.controller : null),
    hasDialog: (id) => dialogComponents.has(id),
  });
  const commands = createCommandRegistry({
    context: () => ctx,
    isModalOpen: () => dialogs.isModalOpen(),
    onError: (id, error) => onError(`Command "${id}"`, error),
  });
  set('commands', commands);
  set('dialogs', dialogs);

  const vfs = createVfs();
  for (const backend of env.backends) vfs.mount(backend);
  if (platform.disk) vfs.mount(platform.disk);
  set('vfs', vfs);
  set('editorExtensions', createEditorExtensionRegistry());

  set('fileDialogs', factories.createFileDialogs(ctx));
  // ARCHITECTURE-PLUS P4.4: before documents, whose deps take ctx.viewer when the service is built.
  set('history', factories.createHistoryService?.(ctx));
  set('viewer', factories.createViewerService?.(ctx));
  set('documents', factories.createDocumentService(ctx));
  set('asm', env.asm);
  set('devices', { audio: factories.createAudioBackend(ctx) });
  set('sim', factories.createSimSession(ctx, env.session));
  simReady = true;

  const shell = attachShellState(ctx);

  // ---- what the features contribute
  const modules = [shellCommands, ...features];
  for (const feature of modules) {
    for (const [id, handler] of Object.entries(feature.commands ?? {})) commands.register(id, handler);
    for (const [id, component] of Object.entries(feature.dialogs ?? {})) {
      if (id === MESSAGE_DIALOG_ID || dialogComponents.has(id)) {
        throw new Error(`Feature "${feature.id}" registers the dialog "${id}", which already exists`);
      }
      dialogComponents.set(id, component);
    }
  }
  const panels = createPanelRegistry(modules);

  // ---- the window among other windows (3.8.6)
  const lock = holdWindowLock(platform.windowId, env.locks);
  disposers.push(() => lock.release());

  // ---- keys and the native menu
  const menuAccess: Application['menuAccess'] = { open: null };
  /** Made on the first Ctrl editing key of macOS in a text field: it needs the page's document. */
  let textEditHost: TextEditHost | null = null;
  /** The history of the plain text fields for the Ctrl+Z of macOS (errata W3.md entry 36). */
  const textFieldHistory = platform.os === 'mac' ? new TextFieldHistory() : undefined;
  if (env.keyTarget && textFieldHistory) {
    disposers.push(
      installTextFieldHistory(
        env.keyTarget,
        textFieldHistory,
        (element) => isPlainTextField(element) && !hasProgramKeys(element),
      ),
    );
  }
  if (env.keyTarget) {
    disposers.push(
      installKeymap(
        env.keyTarget,
        {
          os: platform.os,
          desktop: platform.kind === 'desktop',
          mode: () => store.getState().mode,
          keyCommandsEnabled: () => store.getState().sim.keyCommands,
          isModalOpen: () => dialogs.isModalOpen(),
          commands,
          openMenu: (letter) => menuAccess.open?.(letter) ?? false,
          // The Ctrl editing keys of macOS in plain text fields (K2; errata W3.md entry 34).
          editTextField: (edit, target) => {
            textEditHost ??= browserTextEditHost(platform.pasteIntoFocus, (text) => dialogs.toast(text));
            void performTextFieldEdit(edit, target as PlainTextField, textEditHost, textFieldHistory);
          },
        },
        env.onKey,
      ),
    );
  }
  // Menu items chosen with the mouse in the native menu. `run` refuses while a modal dialog is open.
  disposers.push(platform.onNativeCommand((id: CommandId, arg?: unknown) => void commands.run(id, arg)));

  const os: Os = platform.os;
  let lastMenu = '';
  let lastTitle = '';
  const syncWindow = () => {
    const state = store.getState();
    const title = windowTitle(state, env.version, shell.getState().modeTitles);
    if (title !== lastTitle) {
      lastTitle = title;
      platform.setTitle(title);
    }
    if (platform.kind !== 'desktop') return;
    const menu = buildNativeMenu(state.mode, {
      os,
      desktop: true,
      state,
      commands,
      modalOpen: dialogs.isModalOpen(),
    });
    const text = JSON.stringify(menu);
    if (text !== lastMenu) {
      lastMenu = text;
      platform.setNativeMenu(menu);
    }
  };
  disposers.push(store.subscribe(syncWindow));
  disposers.push(shell.subscribe(syncWindow));

  // ---- start the features
  for (const feature of modules) {
    try {
      const dispose = feature.init?.(ctx);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      onError(`Feature "${feature.id}" failed to start`, error);
    }
  }
  syncWindow();

  let disposed = false;
  return {
    ctx,
    commands,
    dialogs,
    panels,
    dialogComponents,
    shell,
    menuAccess,
    build,
    windowLock: lock.held,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch (error) {
          onError('Shutting down', error);
        }
      }
    },
  };
}
