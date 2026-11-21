// The composition root (ARCHITECTURE.md 3.12.3) and the W3 acceptance items that need the whole
// application (9.1): no command runs while a modal dialog is open, from a key, a toolbar or
// onNativeCommand; a modal dialog of Simulator mode holds the controller; settings and layout
// persist and are shared between windows; every command without a handler is disabled.

import { describe, expect, it, vi } from 'vitest';
import type { AppContext, CommandHandler, FeatureModule, MessageBoxRequest } from './contracts';
import { bootstrap, windowTitle } from './bootstrap';
import { COMMAND_IDS } from './commands/ids';
import type { DispatchEvent } from './commands/keymap';
import { MemorySettingsStorage } from './core/settings/service';
import { FEATURES } from './features';
import { MemoryBackend } from './fs/memory-backend';
import { MemorySyncFiles } from './fs/sync/memory';
import { panelVisible, showPanel } from './state/panels';
import { setModeTitle } from './state/shell';
import { STUB_SERVICES, createFakePlatform, createTestApplication } from './state/testing';
import { withSplit } from './state/layout';

const QUESTION: MessageBoxRequest = { title: 'Caution', text: 'Sure?', icon: 'confirmation', buttons: ['Yes', 'No'] };
const Dialog = () => null;

/** A window object as far as the keyboard dispatcher needs one. */
function keyTarget() {
  const listeners: ((event: KeyboardEvent) => void)[] = [];
  return {
    addEventListener: (type: string, listener: unknown, options?: unknown) => {
      expect(type).toBe('keydown');
      expect(options).toEqual({ capture: true });
      listeners.push(listener as (event: KeyboardEvent) => void);
    },
    removeEventListener: (_type: string, listener: unknown) => {
      const index = listeners.indexOf(listener as (event: KeyboardEvent) => void);
      if (index >= 0) listeners.splice(index, 1);
    },
    listeners,
    /** Presses a key; returns whether the event was cancelled. */
    press(key: string, code: string, modifiers: Partial<DispatchEvent> = {}): boolean {
      let prevented = false;
      const event = {
        key,
        code,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        target: { tagName: 'BUTTON', closest: () => null },
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {},
        ...modifiers,
      };
      for (const listener of [...listeners]) listener(event as unknown as KeyboardEvent);
      return prevented;
    },
  };
}

describe('services (3.12.3)', () => {
  it('creates the services in the documented order and hands each factory the context so far', () => {
    const seen: Record<string, string[]> = {};
    const available = (ctx: AppContext) =>
      (
        [
          'platform',
          'settings',
          'store',
          'commands',
          'dialogs',
          'vfs',
          'fileDialogs',
          'documents',
          'asm',
          'devices',
          'sim',
        ] as const
      ).filter((key) => {
        try {
          return ctx[key] !== undefined;
        } catch {
          return false;
        }
      });
    const app = createTestApplication({
      services: {
        createFileDialogs: (ctx) => {
          seen.fileDialogs = available(ctx);
          return STUB_SERVICES.createFileDialogs(ctx);
        },
        createDocumentService: (ctx) => {
          seen.documents = available(ctx);
          return STUB_SERVICES.createDocumentService(ctx);
        },
        createAudioBackend: (ctx) => {
          seen.devices = available(ctx);
          return STUB_SERVICES.createAudioBackend(ctx);
        },
        createSimSession: (ctx, session) => {
          seen.sim = available(ctx);
          expect(typeof session.engines.create).toBe('function');
          expect(typeof session.engines.release).toBe('function');
          expect(typeof session.createCachedSyncFiles).toBe('function');
          return STUB_SERVICES.createSimSession(ctx, session);
        },
      },
    });
    const first = ['platform', 'settings', 'store', 'commands', 'dialogs', 'vfs'];
    expect(seen.fileDialogs).toEqual(first);
    expect(seen.documents).toEqual([...first, 'fileDialogs']);
    expect(seen.devices).toEqual([...first, 'fileDialogs', 'documents', 'asm']);
    expect(seen.sim).toEqual([...first, 'fileDialogs', 'documents', 'asm', 'devices']);
    expect(available(app.ctx)).toHaveLength(11);
    expect(app.ctx.clock.now()).toBe(0);
    expect(typeof app.ctx.scheduler.setTimer).toBe('function');
    expect(typeof app.ctx.editorExtensions.register).toBe('function');
  });

  it('a factory that reads a later service gets a clear error, not undefined', () => {
    expect(() =>
      createTestApplication({
        services: {
          createFileDialogs: (ctx) => {
            void ctx.sim;
            return STUB_SERVICES.createFileDialogs(ctx);
          },
        },
      }),
    ).toThrow(/AppContext\.sim does not exist yet\. Services are created in this order: platform, settings, store/);
  });

  it('a factory may keep the context and use later services afterwards', () => {
    let kept: AppContext | null = null;
    createTestApplication({
      services: {
        createFileDialogs: (ctx) => {
          kept = ctx;
          return STUB_SERVICES.createFileDialogs(ctx);
        },
      },
    });
    expect((kept as AppContext | null)?.sim.controller.phase).toBe('idle');
  });

  it('mounts the given backends and the disk of the desktop platform', () => {
    const disk = new MemoryBackend({ mount: 'disk', kind: 'disk', label: 'Disk' });
    const app = createTestApplication({ platform: createFakePlatform({ kind: 'desktop', os: 'mac', disk }) });
    expect(app.ctx.vfs.backends().map((backend) => backend.mount)).toEqual(['browser', 'disk']);
  });

  it('mirrors the settings into the store', () => {
    const app = createTestApplication();
    app.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, exceptions: true } }));
    expect(app.ctx.store.getState().settings.sim.exceptions).toBe(true);
    expect(app.ctx.store.getState().settings).toBe(app.ctx.settings.get());
  });
});

describe('features', () => {
  it('registers the commands, panels and dialogs of every feature and runs init in order', () => {
    const order: string[] = [];
    const disposed: string[] = [];
    const run = vi.fn();
    const features: FeatureModule[] = [
      {
        id: 'first',
        commands: { 'ed.file.new': { run } },
        panels: [{ id: 'memory', title: 'Memory', mode: 'simulator', component: Dialog }],
        dialogs: { 'sim.find': Dialog },
        init: (ctx) => {
          order.push(`first:${ctx.sim.controller.phase}`);
          return () => disposed.push('first');
        },
      },
      { id: 'second', init: () => void order.push('second') },
    ];
    const app = createTestApplication({ features });
    expect(order).toEqual(['first:idle', 'second']);
    expect(app.commands.hasHandler('ed.file.new')).toBe(true);
    expect(app.panels.find('simulator', 'memory')?.title).toBe('Memory');
    expect(app.dialogComponents.get('sim.find')).toBe(Dialog);
    app.dispose();
    app.dispose();
    expect(disposed).toEqual(['first']);
  });

  it('refuses a second handler for a command and a second component for a dialog', () => {
    const handler: CommandHandler = { run: () => {} };
    expect(() =>
      createTestApplication({
        features: [
          { id: 'a', commands: { 'ed.file.new': handler } },
          { id: 'b', commands: { 'ed.file.new': handler } },
        ],
      }),
    ).toThrow(/already has a handler/);
    expect(() => createTestApplication({ features: [{ id: 'a', commands: { 'app.mode.set': handler } }] })).toThrow(
      /already has a handler/,
    );
    expect(() =>
      createTestApplication({
        features: [
          { id: 'a', dialogs: { find: Dialog } },
          { id: 'b', dialogs: { find: Dialog } },
        ],
      }),
    ).toThrow(/registers the dialog "find", which already exists/);
    expect(() => createTestApplication({ features: [{ id: 'a', dialogs: { message: Dialog } }] })).toThrow(/"message"/);
  });

  it('a feature that fails to start does not stop the others', () => {
    const errors: string[] = [];
    const started: string[] = [];
    createTestApplication({
      onError: (what) => errors.push(what),
      features: [
        {
          id: 'broken',
          init: () => {
            throw new Error('boom');
          },
        },
        { id: 'fine', init: () => void started.push('fine') },
      ],
    });
    expect(started).toEqual(['fine']);
    expect(errors).toEqual(['Feature "broken" failed to start']);
  });

  it("with the real feature list of wave zero, only the shell's five commands have handlers", () => {
    const app = createTestApplication({ features: FEATURES });
    const handled = COMMAND_IDS.filter((id) => app.commands.hasHandler(id));
    const stubsOnly = FEATURES.every((feature) => !feature.commands && !feature.panels && !feature.dialogs);
    if (stubsOnly) {
      expect(handled.sort()).toEqual([
        'app.mode.next',
        'app.mode.set',
        'app.theme.set',
        'app.window.new',
        'sim.panel.next',
      ]);
    } else {
      // Features have been delivered since: the shell's five are still there.
      expect(handled).toEqual(expect.arrayContaining(['app.mode.set', 'app.mode.next', 'app.theme.set']));
    }
  });
});

describe('every command without a handler is shown disabled (3.12.2)', () => {
  it('and running it does nothing', async () => {
    const app = createTestApplication();
    for (const id of COMMAND_IDS) {
      if (app.commands.hasHandler(id)) continue;
      expect(app.ctx.commands.isEnabled(id), id).toBe(false);
      await app.ctx.commands.run(id);
    }
    expect(app.ctx.store.getState().dialogs.stack).toEqual([]);
  });
});

describe('no command runs while a modal dialog is open (2.9.1)', () => {
  function setup() {
    const run = vi.fn();
    const target = keyTarget();
    const platform = createFakePlatform({ kind: 'desktop', os: 'windows' });
    const app = createTestApplication({
      platform,
      keyTarget: target,
      features: [
        { id: 'test', commands: { 'ed.file.save': { run }, 'sim.run.run': { run } }, dialogs: { find: Dialog } },
      ],
    });
    return { app, run, target, platform };
  }

  it('from a key', async () => {
    const { app, run, target } = setup();
    expect(target.press('s', 'KeyS', { ctrlKey: true })).toBe(true);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    const answer = app.ctx.dialogs.messageBox(QUESTION);
    // Still cancelled (the browser must not show its Save dialog), but nothing runs.
    expect(target.press('s', 'KeyS', { ctrlKey: true })).toBe(true);
    expect(target.press('F9', 'F9')).toBe(false);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    app.dialogs.close(app.ctx.store.getState().dialogs.stack[0]?.key ?? -1, 'Yes');
    await answer;
    target.press('s', 'KeyS', { ctrlKey: true });
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('from a toolbar button or a menu item (CommandRegistry.run)', async () => {
    const { app, run } = setup();
    void app.ctx.dialogs.messageBox(QUESTION);
    await app.ctx.commands.run('ed.file.save');
    expect(run).not.toHaveBeenCalled();
    // The shell's own commands are blocked as well.
    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(app.ctx.store.getState().mode).toBe('editor');
  });

  it('from the native menu of the desktop app (onNativeCommand)', async () => {
    const { app, run, platform } = setup();
    platform.chooseNativeCommand('ed.file.save');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);

    void app.ctx.dialogs.messageBox(QUESTION);
    platform.chooseNativeCommand('ed.file.save');
    platform.chooseNativeCommand('app.mode.set', 'simulator');
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(app.ctx.store.getState().mode).toBe('editor');
  });

  it('a modeless dialog does not block commands', async () => {
    const { app, run } = setup();
    void app.ctx.dialogs.open('find', {}, { modal: false });
    await app.ctx.commands.run('ed.file.save');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the dispatcher is removed when the application is disposed', () => {
    const { app, target } = setup();
    expect(target.listeners).toHaveLength(1);
    app.dispose();
    expect(target.listeners).toHaveLength(0);
  });
});

describe('a modal dialog opened in Simulator mode holds the controller and releases it (4.4.5)', () => {
  it("through the application's own services", async () => {
    const app = createTestApplication();
    const { controller } = app.ctx.sim;
    await app.ctx.commands.run('app.mode.set', 'simulator');
    const answer = app.ctx.dialogs.messageBox(QUESTION);
    expect(controller.held).toBe(true);
    app.dialogs.close(app.ctx.store.getState().dialogs.stack[0]?.key ?? -1, 'No');
    expect(await answer).toBe('No');
    expect(controller.held).toBe(false);

    await app.ctx.commands.run('app.mode.set', 'editor');
    void app.ctx.dialogs.messageBox(QUESTION);
    expect(controller.held).toBe(false);
  });
});

describe('settings and layout across windows (3.8.6, 3.10)', () => {
  it('survive two instances writing in turn', () => {
    const storage = new MemorySettingsStorage();
    const a = createTestApplication({ storage });
    const b = createTestApplication({ storage });
    a.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, fontSize: 14 } }));
    b.ctx.settings.update((s) => ({ ...s, sim: { ...s.sim, bitField: true } }));
    a.ctx.settings.update((s) => ({ ...s, editor: { ...s.editor, realTabs: true } }));
    const c = createTestApplication({ storage });
    expect(c.ctx.settings.get().editor).toMatchObject({ fontSize: 14, realTabs: true });
    expect(c.ctx.settings.get().sim.bitField).toBe(true);
  });

  it('a storage event updates a running instance, store included', async () => {
    const storage = new MemorySettingsStorage();
    const a = createTestApplication({ storage });
    const b = createTestApplication({ storage });
    await a.ctx.commands.run('app.theme.set', 'dark');
    expect(b.ctx.settings.get().app.theme).toBe('dark');
    expect(b.ctx.store.getState().settings.app.theme).toBe('dark');
    expect(b.ctx.commands.isChecked('app.theme.set', 'dark')).toBe(true);
    expect(b.ctx.commands.isChecked('app.theme.set', 'system')).toBe(false);
  });

  it('panel layout and settings persist to the next start', () => {
    const storage = new MemorySettingsStorage();
    const first = createTestApplication({ storage });
    showPanel(first.ctx, 'memory');
    showPanel(first.ctx, 'hardware');
    first.ctx.settings.update((s) => withSplit(s, 'sim.columns', 0.37));
    first.ctx.settings.update((s) => ({ ...s, app: { ...s.app, theme: 'light' } }));
    first.dispose();

    const second = createTestApplication({ storage });
    expect(panelVisible(second.ctx, 'memory')).toBe(true);
    expect(panelVisible(second.ctx, 'hardware')).toBe(true);
    expect(panelVisible(second.ctx, 'stack')).toBe(false);
    expect(second.ctx.settings.get().app.layout.splits['sim.columns']).toBe(0.37);
    expect(second.ctx.store.getState().settings.app.theme).toBe('light');
  });

  it('a window that is open keeps its panel layout when another changes its own', () => {
    const storage = new MemorySettingsStorage();
    const a = createTestApplication({ storage });
    const b = createTestApplication({ storage });
    showPanel(a.ctx, 'memory');
    expect(panelVisible(b.ctx, 'memory')).toBe(false);
    showPanel(b.ctx, 'stack');
    expect(panelVisible(a.ctx, 'stack')).toBe(false);
    expect(panelVisible(a.ctx, 'memory')).toBe(true);
  });
});

describe('the window title and the native menu', () => {
  it("title: the original program's title and the port's notice (1.3.3), following the mode", async () => {
    const app = createTestApplication({ version: '0.3.1' });
    expect(app.platform.titles).toEqual(['EASy68K Editor/Assembler v5.16.01 - unofficial port 0.3.1']);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    await app.ctx.commands.run('app.mode.set', 'easybin');
    expect(app.platform.titles.slice(1)).toEqual([
      'EASy68K Simulator v5.16.1 - unofficial port 0.3.1',
      'EASyBIN v2.5.0 - unofficial port 0.3.1',
    ]);
  });

  it("title: the loaded program replaces the simulator's title, as in the original", () => {
    const program = { path: '/browser/demo/prog.S68', title: '/browser/demo/prog.S68', hasListing: true };
    expect(windowTitle({ mode: 'simulator', sim: { program } }, '1.0.0')).toBe(
      '/browser/demo/prog.S68 - unofficial port 1.0.0',
    );
    expect(windowTitle({ mode: 'editor', sim: { program } }, '1.0.0')).toBe(
      'EASy68K Editor/Assembler v5.16.01 - unofficial port 1.0.0',
    );
  });

  it("title: a mode's feature can set its own title (EASyBIN's opened file, B1-window-title)", async () => {
    const app = createTestApplication({ version: '1.0.0' });
    setModeTitle(app.ctx, 'easybin', 'C:\\work\\demo.S68');
    expect(app.platform.titles.at(-1)).toBe('EASy68K Editor/Assembler v5.16.01 - unofficial port 1.0.0');
    await app.ctx.commands.run('app.mode.set', 'easybin');
    expect(app.platform.titles.at(-1)).toBe('C:\\work\\demo.S68 - unofficial port 1.0.0');
    setModeTitle(app.ctx, 'easybin', '/browser/b.bin');
    expect(app.platform.titles.at(-1)).toBe('/browser/b.bin - unofficial port 1.0.0');
    const count = app.platform.titles.length;
    setModeTitle(app.ctx, 'easybin', '/browser/b.bin'); // the same title: nothing to do
    expect(app.platform.titles).toHaveLength(count);
    setModeTitle(app.ctx, 'easybin', null); // New
    expect(app.platform.titles.at(-1)).toBe('EASyBIN v2.5.0 - unofficial port 1.0.0');
    expect(windowTitle({ mode: 'easybin', sim: { program: null } }, '2', { easybin: 'x.S68' })).toBe(
      'x.S68 - unofficial port 2',
    );
  });

  it('the context carries the build: version and repository (H1-build-info)', () => {
    const app = createTestApplication({ version: '1.2.3', repository: 'owner/name' });
    const build = (app.ctx as unknown as { build: unknown }).build;
    expect(build).toEqual({ version: '1.2.3', repository: 'owner/name' });
    expect(app.build).toBe(build);
    expect(Object.isFrozen(build)).toBe(true);
    expect((createTestApplication().ctx as unknown as { build: unknown }).build).toEqual({
      version: '0.0.0-test',
      repository: null,
    });
  });

  it('the native menu is sent in the desktop app only, follows the mode and a modal dialog', async () => {
    const web = createTestApplication();
    expect(web.platform.nativeMenus).toEqual([]);

    const platform = createFakePlatform({ kind: 'desktop', os: 'mac' });
    const app = createTestApplication({ platform });
    const labels = () => platform.nativeMenus[platform.nativeMenus.length - 1]?.map((item) => item.label);
    expect(platform.nativeMenus).toHaveLength(1);
    expect(labels()).toEqual(['EASy68K', 'File', 'Edit', 'Project', 'Options', 'Window', 'Help']);

    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(labels()).toEqual(['EASy68K', 'File', 'Search', 'Run', 'View', 'Options', 'Edit', 'Window', 'Help']);

    // Nothing changed: no new menu is sent.
    const count = platform.nativeMenus.length;
    app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, liveRevision: state.sim.liveRevision + 1 } }));
    expect(platform.nativeMenus).toHaveLength(count);

    // A modal dialog disables the command items.
    const quit = () =>
      platform.nativeMenus[platform.nativeMenus.length - 1]?.[0]?.items?.find((item) => item.id === 'app.window.new');
    expect(quit()?.enabled).toBe(true);
    void app.ctx.dialogs.messageBox(QUESTION);
    expect(quit()?.enabled).toBe(false);
  });
});

describe('bootstrap without the test defaults', () => {
  it('uses the features and factories of features/index.ts', () => {
    const app = bootstrap({
      platform: createFakePlatform(),
      settingsStorage: new MemorySettingsStorage().window(),
      clock: { now: () => 0, wallTime: () => new Date(0) },
      scheduler: { onFrame: () => () => {}, setTimer: () => () => {} },
      backends: [],
      asm: { assemble: () => Promise.reject(new Error('unused')) },
      session: {
        engines: { create: () => Promise.reject(new Error('unused')), release: () => {} },
        createCachedSyncFiles: () => new MemorySyncFiles(),
      },
      locks: null,
      keyTarget: null,
      version: '0.0.0',
    });
    expect(app.ctx.documents.list().length).toBeGreaterThanOrEqual(0);
    expect(app.ctx.sim.controller).toBeDefined();
    expect(app.commands.hasHandler('app.mode.set')).toBe(true);
    app.dispose();
  });
});
