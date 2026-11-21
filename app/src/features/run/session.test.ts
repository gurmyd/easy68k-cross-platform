// The run feature in a whole application (bootstrap, command registry, dialog service, store), with
// the real engine, virtual time and doubles for the devices of other packages: the store mirrors
// the simulator, commands follow the table of 4.8, the engine's boxes are shown, and a native
// command that arrives while the task 58 dialog is open is refused.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  Box,
  Reg,
  SimOption,
  type AppContext,
  type DesktopDeviceSources,
  type LogServiceApi,
  type MessageBoxRequest,
  type ProgramFilesApi,
  type SimSessionEnv,
  type StartupArgs,
} from '../../contracts';
import { VirtualTime } from '../../core/run/clock';
import { BLANK_GLYPHS } from '../../core/run/headless';
import { createDeviceDoubles, partOf, type DeviceDoubles } from '../../core/run/test-kit';
import { createSimEngine, releaseSimEngine } from '../../engine';
import { assembleProgram, bytesOf, type AssembledProgram } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { MemorySyncFiles } from '../../fs/sync/memory';
import { windowTitle } from '../../bootstrap';
import { MESSAGE_DIALOG_ID } from '../../state/dialogs';
import { panelVisible } from '../../state/panels';
import { shellStateOf } from '../../state/shell';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { beepWav } from './beep';
import { feature } from './index';
import {
  CAUTION_TEXT,
  CAUTION_TITLE,
  INPUT_TOAST,
  JOURNAL_KEY,
  createSimSession,
  runSessionOf,
  type RunSession,
  type SessionPage,
} from './session';

const dist = (file: string) => fileURLToPath(new URL(`../../../../engine/dist/${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(dist(file)),
);
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
it.runIf(process.env.EASY68K_REQUIRE_ENGINES === '1' && !enginesBuilt)('engine/dist holds both engines', () => {
  expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist is incomplete: run `npm run build:engines` first.');
});

const LONG = 120_000;
/** Every test here runs the real engine; on a busy machine one can take seconds. */
const ENGINE_TEST_TIMEOUT = 60_000;
const DIR = '/browser/demo';
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const RUN_COMMANDS = [
  'sim.run.run',
  'sim.run.runToCursor',
  'sim.run.autoTrace',
  'sim.run.stepOver',
  'sim.run.traceInto',
];

const ENGINES: SimSessionEnv = {
  engines: { create: createSimEngine, release: releaseSimEngine },
  createCachedSyncFiles: () => new MemorySyncFiles(),
};

const NO_ARGS: StartupArgs = { file: null, run: false, fullScreen: false, exceptions: false, bitField: false };

/** A page as the session sees it: the listeners it added, and a storage in memory. */
function createFakePage() {
  const listeners = new Map<string, Set<() => void>>();
  const stored = new Map<string, string>();
  const page: SessionPage = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
      removeItem: (key) => void stored.delete(key),
    },
  };
  return {
    page,
    stored,
    /** The page fires an event. */
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listening: (type: string) => listeners.get(type)?.size ?? 0,
  };
}

describe.skipIf(!enginesBuilt)(
  'the run feature in an application (needs engine/dist)',
  { timeout: ENGINE_TEST_TIMEOUT },
  () => {
    let programs: Record<'counter' | 'halting' | 'dialog' | 'input' | 'task24' | 'logged', AssembledProgram>;
    let app: TestApplication;
    let time: VirtualTime;
    let session: RunSession;
    let doubles: DeviceDoubles;

    /** An application with this feature, the real engine, and doubles for the devices. */
    async function start(
      options: {
        platform?: ReturnType<typeof createFakePlatform>;
        files?: Partial<ProgramFilesApi>;
        log?: Partial<LogServiceApi>;
        page?: SessionPage;
        /** Read whenever the session asks whether bytes are not in storage yet. */
        unsaved?: { files: boolean; log: boolean };
      } = {},
    ) {
      time = new VirtualTime();
      let ctxOfApp: AppContext | null = null;
      // The files double answers task 58 as the real part does: the dialog, then the reply.
      const { unsaved } = options;
      const fileMethods: Partial<ProgramFilesApi> = {
        resetToStartup: () => {},
        exit: async () => {},
        setCurrentDir: async () => {},
        revalidateIfStale: async () => {},
        recoverJournal: async () => {},
        markStale: () => {},
        exitNow: () => {},
        fileOpen: () => 0,
        fileRead: () => null,
        fileWrite: () => -1,
        fileSeek: () => -1,
        fileClose: () => false,
        fileRemove: () => false,
        unsaved: false,
        fileDialog(mode) {
          const ctx = ctxOfApp as AppContext;
          void ctx.dialogs.open<{ mode: number }, string | null>('sim.fileDialog', { mode }).then((path) =>
            ctx.sim.controller.post({
              kind: 'fileDialogReply',
              accepted: path !== null,
              path: path ? bytesOf(path) : null,
            }),
          );
        },
        ...options.files,
      };
      if (unsaved) Object.defineProperty(fileMethods, 'unsaved', { get: () => unsaved.files });
      doubles = createDeviceDoubles({ files: partOf<ProgramFilesApi>(fileMethods) });
      if (options.log || unsaved) {
        const logMethods: Partial<LogServiceApi> = {
          resetToStartup: () => {},
          exit: async () => {},
          flush: async () => {},
          unsaved: false,
          ...options.log,
        };
        if (unsaved) Object.defineProperty(logMethods, 'unsaved', { get: () => unsaved.log });
        doubles.parts.log = partOf<LogServiceApi>(logMethods);
      }
      app = createTestApplication({
        clock: time,
        scheduler: time,
        session: ENGINES,
        ...(options.platform ? { platform: options.platform } : {}),
        features: [feature, { id: 'test', dialogs: { 'sim.fileDialog': () => null } }],
        services: {
          createSimSession: (ctx, env) =>
            createSimSession(ctx, env, {
              parts: doubles.parts,
              glyphs: BLANK_GLYPHS,
              ...(options.page ? { page: options.page } : {}),
            }),
        },
      });
      ctxOfApp = app.ctx;
      session = runSessionOf(app.ctx.sim) as RunSession;
      for (const [name, program] of Object.entries(programs)) {
        await app.ctx.vfs.writeFile(`${DIR}/${name}.S68`, program.s68);
        await app.ctx.vfs.writeFile(`${DIR}/${name}.L68`, program.l68);
      }
      await session.start();
      await app.ctx.commands.run('app.mode.set', 'simulator');
      return app;
    }

    const sim = () => app.ctx.store.getState().sim;
    const open = (name: keyof typeof programs, origin: 'open' | 'execute' | 'drop' = 'open') =>
      app.ctx.sim.controller.open(`${DIR}/${name}.S68`, origin);
    const enabled = (id: string) => app.ctx.commands.isEnabled(id);
    const boxes = () =>
      app.ctx.store
        .getState()
        .dialogs.stack.filter((dialog) => dialog.id === MESSAGE_DIALOG_ID)
        .map((dialog) => ({ key: dialog.key, request: dialog.props as MessageBoxRequest }));
    const answer = async (button: string) => {
      const box = boxes().at(-1);
      expect(box, 'a message box is open').toBeDefined();
      app.dialogs.close(box!.key, button);
      await settle();
    };

    beforeAll(async () => {
      programs = {
        counter: await assembleProgram([
          '        ORG     $1000',
          'START:  MOVEQ   #0,D0',
          'LOOP:   ADDQ.L  #1,D0',
          '        BRA     LOOP',
          '        END     START',
        ]),
        halting: await assembleProgram([
          '        ORG     $1000',
          'START:  MOVEQ   #7,D5',
          '        SIMHALT',
          '        END     START',
        ]),
        dialog: await assembleProgram([
          '        ORG     $1000',
          'START:  SUBA.L  A1,A1',
          '        SUBA.L  A2,A2',
          '        LEA     BUFFER,A3',
          '        MOVEQ   #0,D1',
          '        MOVEQ   #58,D0',
          '        TRAP    #15',
          '        MOVE.L  D1,D6',
          '        SIMHALT',
          '        ORG     $2000',
          'BUFFER: DS.B    256',
          '        END     START',
        ]),
        input: await assembleProgram([
          '        ORG     $1000',
          'START:  MOVEQ   #5,D0',
          '        TRAP    #15',
          '        SIMHALT',
          '        END     START',
        ]),
        task24: await assembleProgram([
          '        ORG     $1000',
          'START:  MOVEQ   #1,D1',
          '        MOVEQ   #24,D0',
          '        TRAP    #15',
          'LOOP:   BRA     LOOP',
          '        END     START',
        ]),
        logged: await assembleProgram([
          '        ORG     $1000',
          'START:  MOVEQ   #1,D5',
          '        SIMHALT',
          '        MOVEQ   #2,D5',
          '        SIMHALT',
          '        END     START',
        ]),
      };
    }, LONG);

    afterEach(() => app?.dispose());

    it('registers its commands, the status bar of Simulator mode and the speed dialog', async () => {
      await start();
      for (const id of [
        'sim.file.open',
        'sim.file.openData',
        'sim.file.close',
        'sim.file.exit',
        ...RUN_COMMANDS,
        'sim.run.pause',
        'sim.run.rewind',
        'sim.run.reload',
        'sim.options.speed',
      ]) {
        expect(app.commands.hasHandler(id), id).toBe(true);
      }
      expect(app.panels.find('simulator', 'status')?.component).toBeTypeOf('function');
      expect(app.panels.find('editor', 'status')).toBeUndefined();
      expect(app.dialogComponents.has('sim.speed')).toBe(true);
      // Logging and the other Options commands belong to other packages.
      expect(app.commands.hasHandler('sim.run.logStart')).toBe(false);
    });

    it('starts the simulator and mirrors its start-up state', async () => {
      await start();
      expect(sim()).toMatchObject({
        phase: 'idle',
        program: null,
        menuState: 0,
        halted: false,
        autoTrace: false,
        keyCommands: true,
        logging: false,
        messageLines: [],
        breakpoints: [],
        selectedRow: -1,
        output: { width: 640, height: 480, fullScreen: false, textWrap: false },
      });
      expect(app.ctx.sim.engine.state().hardwareEnabled).toBe(true); // a real engine, not the stand-in
      expect(app.ctx.sim.controller.snapshot.boxes[Box.SS]).toBe('01000000');
    });

    it('mirrors a load: phase, program, messages, revisions; the window title follows the program', async () => {
      await start();
      const phases: string[] = [];
      app.ctx.store.subscribe(() => {
        const phase = sim().phase;
        if (phases.at(-1) !== phase) phases.push(phase);
      });
      const before = sim();
      await open('counter');
      expect(phases).toEqual(['loading', 'idle']);
      expect(sim().program).toEqual({ path: `${DIR}/counter.S68`, title: `${DIR}/counter.S68`, hasListing: true });
      expect(sim().messageLines).toEqual(['S0 = 68KPROG   20CREATED BY EASY68K', '.S68 file read successful']);
      expect(sim().regsRevision).toBeGreaterThan(before.regsRevision);
      expect(sim().viewRevision).toBeGreaterThan(before.viewRevision);
      expect(windowTitle(app.ctx.store.getState(), '1.0')).toBe(`${DIR}/counter.S68 - unofficial port 1.0`);
      expect(app.platform.titles.at(-1)).toContain(`${DIR}/counter.S68`);
    });

    it('follows the command table of 4.8 through the registry', async () => {
      await start();
      // Start-up, nothing loaded: Run is enabled (it would halt at once), Close and Reload are not.
      for (const id of RUN_COMMANDS) expect(enabled(id), id).toBe(true);
      expect([enabled('sim.file.close'), enabled('sim.run.reload')]).toEqual([false, false]);
      expect([enabled('sim.file.open'), enabled('sim.run.pause'), enabled('sim.run.rewind')]).toEqual([
        true,
        true,
        true,
      ]);

      await open('counter');
      expect([enabled('sim.file.close'), enabled('sim.run.reload')]).toEqual([true, true]);

      // Run: busy.
      await app.ctx.commands.run('sim.run.run');
      expect(sim().phase).toBe('running');
      expect(sim().menuState).toBe(1);
      for (const id of RUN_COMMANDS) expect(enabled(id), id).toBe(false);
      expect([
        enabled('sim.run.pause'),
        enabled('sim.run.rewind'),
        enabled('sim.file.open'),
        enabled('sim.run.reload'),
      ]).toEqual([true, true, true, true]);
      time.advance(100);
      expect(app.ctx.sim.engine.getRegister(Reg.D0)).toBeGreaterThan(1000);
      // A second Run through the registry does nothing.
      const steps = app.ctx.sim.engine.stepCount;
      await app.ctx.commands.run('sim.run.run');
      expect(app.ctx.sim.engine.stepCount).toBe(steps);

      await app.ctx.commands.run('sim.run.pause');
      expect(sim().phase).toBe('idle');
      for (const id of RUN_COMMANDS) expect(enabled(id), id).toBe(true);

      await app.ctx.commands.run('sim.run.traceInto');
      expect(sim().regsRevision).toBe(app.ctx.sim.controller.snapshot.revision);

      await app.ctx.commands.run('sim.run.rewind');
      expect(app.ctx.sim.controller.snapshot.boxes[Box.PC]).toBe('00001000');

      await app.ctx.commands.run('sim.run.autoTrace');
      expect(sim().autoTrace).toBe(true);
      await app.ctx.commands.run('sim.run.pause');
      expect(sim().autoTrace).toBe(false);
      expect(sim().menuState).toBe(0);

      await app.ctx.commands.run('sim.run.reload');
      expect(sim().phase).toBe('idle');
      expect(app.ctx.sim.engine.getRegister(Reg.D0)).toBe(0);
    });

    it('keeps Run, Step and Trace disabled after a halt; Open and Reload stay available (note 22)', async () => {
      await start();
      await open('halting');
      await app.ctx.commands.run('sim.run.run');
      time.advance(16);
      expect(sim()).toMatchObject({ phase: 'idle', halted: true, menuState: 1 });
      for (const id of RUN_COMMANDS) expect(enabled(id), id).toBe(false);
      expect([
        enabled('sim.file.open'),
        enabled('sim.run.reload'),
        enabled('sim.run.pause'),
        enabled('sim.run.rewind'),
      ]).toEqual([true, true, true, true]);
    });

    it('disables every simulator command while a load is in progress', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      await start({ files: { setCurrentDir: () => gate } });
      const loading = open('counter');
      await settle();
      expect(sim().phase).toBe('loading');
      for (const id of [
        ...RUN_COMMANDS,
        'sim.run.pause',
        'sim.run.rewind',
        'sim.run.reload',
        'sim.file.open',
        'sim.file.close',
      ]) {
        expect(enabled(id), id).toBe(false);
      }
      release();
      await loading;
      expect(sim().phase).toBe('idle');
    });

    it('Run To Cursor uses the selected listing row; without one it shows the box and does not run', async () => {
      await start();
      await open('counter');
      await app.ctx.commands.run('sim.run.runToCursor'); // selectedRow is -1
      await settle();
      expect(boxes().map((box) => box.request)).toEqual([
        { title: 'Error', text: 'Invalid Run-To-Cursor Selection', icon: 'none', buttons: ['OK'] },
      ]);
      expect(sim().phase).toBe('idle');
      await answer('OK');
      expect(app.ctx.sim.controller.alerts).toEqual([]);
      // With a row selected (the Listing panel keeps it in the store) the engine gets the command.
      app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, selectedRow: 5 } }));
      await app.ctx.commands.run('sim.run.runToCursor');
      expect(sim().phase).toBe('running');
    });

    it("shows the engine's box as a modal message box and continues when it is closed", async () => {
      await start();
      await open('logged');
      app.ctx.sim.controller.invoke((engine) => {
        engine.setOption(SimOption.ExecLogType, 1);
        engine.startLog('11/20/2026 1:07:46 PM');
      });
      expect(sim().logging).toBe(true);
      await app.ctx.commands.run('sim.run.run');
      await settle();
      expect(sim().phase).toBe('waitAlert');
      expect(boxes().map((box) => box.request)).toEqual([
        { title: 'Information', text: 'Current Log Stopped.', icon: 'none', buttons: ['OK'] },
      ]);
      expect(app.ctx.dialogs.isModalOpen()).toBe(true);
      time.advance(200);
      expect(sim().halted).toBe(false); // the program stands still while the box is open
      await answer('OK');
      expect(sim()).toMatchObject({ phase: 'idle', halted: true, logging: false });
      expect(boxes()).toEqual([]);
    });

    // U4 errata entry 5 (gate I2): the original's startLog with both log types Disabled logs but
    // opens no file, and its LOGGING label stays hidden; sim.logging drives that label.
    it('shows LOGGING only when a log type was enabled at Log Start', async () => {
      // The double's state object is shared, so that the test can change the types later.
      const types = { execType: 0, outputType: 0 };
      await start({ log: { state: types as unknown as LogServiceApi['state'] } });
      await open('logged');
      app.ctx.sim.controller.invoke((engine) => engine.startLog('11/20/2026 1:07:46 PM'));
      session.sync();
      expect(app.ctx.sim.engine.state().logging).toBe(true);
      expect(sim().logging).toBe(false);
      app.ctx.sim.controller.invoke((engine) => engine.stopLog());
      session.sync();
      types.execType = 1;
      app.ctx.sim.controller.invoke((engine) => engine.startLog('11/20/2026 1:07:46 PM'));
      session.sync();
      expect(sim().logging).toBe(true);
    });

    it('refuses a native command that arrives while the task 58 dialog is open', async () => {
      const platform = createFakePlatform({ kind: 'desktop' });
      await start({ platform });
      await open('dialog');
      await app.ctx.commands.run('sim.run.run');
      await settle();
      expect(sim().phase).toBe('waitHost');
      const dialog = app.ctx.store.getState().dialogs.stack.find((entry) => entry.id === 'sim.fileDialog');
      expect(dialog?.modal).toBe(true);

      // The user picks commands from the native menu of the desktop app while the dialog is open.
      const steps = app.ctx.sim.engine.stepCount;
      for (const id of ['sim.run.pause', 'sim.run.rewind', 'sim.run.reload', 'sim.run.run', 'sim.file.close']) {
        platform.chooseNativeCommand(id);
      }
      await settle();
      time.advance(100);
      expect(sim().phase).toBe('waitHost'); // nothing changed the simulator
      expect(app.ctx.sim.engine.state().fileDialogOpen).toBe(true);
      expect(app.ctx.sim.engine.stepCount).toBe(steps);
      expect(app.ctx.sim.engine.getRegister(Reg.PC)).not.toBe(0x1000);
      expect(boxes()).toEqual([]); // not even the Caution question of Close
      // The native menu shows them disabled, too.
      const items = JSON.stringify(platform.nativeMenus.at(-1));
      expect(items).toContain('"id":"sim.run.pause"');
      expect(items).not.toMatch(/"id":"sim\.run\.pause"[^}]*"enabled":true/);

      // The dialog closes: the reply reaches the engine and the program goes on.
      app.dialogs.close(dialog!.key, '/browser/demo/data.txt');
      await settle();
      time.advance(16);
      expect(sim()).toMatchObject({ phase: 'idle', halted: true });
      expect(app.ctx.sim.engine.getRegister(Reg.D6)).toBe(1);
    });

    it('mirrors key commands switched off by task 24, for the keyboard dispatcher', async () => {
      await start();
      await open('task24');
      expect(sim().keyCommands).toBe(true);
      await app.ctx.commands.run('sim.run.run');
      time.advance(16);
      expect(sim().keyCommands).toBe(false);
      await app.ctx.commands.run('sim.run.rewind'); // a simulator reset switches them on again
      expect(sim().keyCommands).toBe(true);
    });

    it('asks the Caution question for Close, and for Open while a program runs', async () => {
      await start();
      await open('counter');
      const closing = app.ctx.commands.run('sim.file.close');
      await settle();
      expect(boxes().map((box) => box.request)).toEqual([
        { title: CAUTION_TITLE, text: CAUTION_TEXT, icon: 'none', buttons: ['OK', 'Cancel'] },
      ]);
      expect(CAUTION_TEXT).toBe('The current debug environment will be lost, click OK to continue.');
      expect(app.ctx.sim.controller.held).toBe(true);
      await answer('Cancel');
      await closing;
      expect(app.ctx.sim.engine.listingLineCount).toBeGreaterThan(0);

      const again = app.ctx.commands.run('sim.file.close');
      await settle();
      await answer('OK');
      await again;
      expect(app.ctx.sim.engine.listingLineCount).toBe(0);
      expect(sim().program?.hasListing).toBe(false);
      expect(enabled('sim.run.reload')).toBe(true);

      await app.ctx.sim.controller.reload();
      await app.ctx.commands.run('sim.run.run');
      const opening = open('halting');
      await settle();
      expect(boxes()).toHaveLength(1);
      await answer('OK');
      await opening;
      expect(sim().program?.path).toBe(`${DIR}/halting.S68`);
    });

    it('Execute gives a simulator in start-up state: new engine, selection cleared, listeners told', async () => {
      await start();
      await open('counter');
      app.ctx.store.setState((state) => ({ ...state, sim: { ...state.sim, selectedRow: 7 } }));
      const old = app.ctx.sim.engine;
      let replaced = 0;
      app.ctx.sim.onEngineReplaced(() => replaced++);
      doubles.resets.length = 0;
      await open('halting', 'execute');
      expect(replaced).toBe(1);
      expect(app.ctx.sim.engine).not.toBe(old);
      expect(sim().selectedRow).toBe(-1);
      expect(doubles.resets).toContain('surface');
      expect(sim().phase).toBe('idle'); // loaded, not started
      expect(sim().program?.path).toBe(`${DIR}/halting.S68`);
    });

    it('writes an option the engine changes into the settings at once, and applies settings at a cold start', async () => {
      await start();
      expect(app.ctx.settings.get().sim.exceptions).toBe(false);
      app.ctx.sim.controller.invoke((engine) => engine.setOption(SimOption.Exceptions, true));
      expect(app.ctx.settings.get().sim.exceptions).toBe(true);
      expect(app.ctx.store.getState().settings.sim.exceptions).toBe(true);
      await open('counter', 'execute'); // a new engine gets the saved setting
      expect(app.ctx.sim.engine.getOption(SimOption.Exceptions)).toBe(1);
    });

    it('Execution Speed: OK stores the setting, Cancel changes nothing', async () => {
      await start();
      const before = app.ctx.settings.get().sim.speed;
      const running = app.ctx.commands.run('sim.options.speed');
      await settle();
      const dialog = app.ctx.store.getState().dialogs.stack.find((entry) => entry.id === 'sim.speed');
      expect(dialog).toMatchObject({ modal: true, props: before });
      app.dialogs.close(dialog!.key, null);
      await running;
      expect(app.ctx.settings.get().sim.speed).toEqual(before);

      const again = app.ctx.commands.run('sim.options.speed');
      await settle();
      const second = app.ctx.store.getState().dialogs.stack.find((entry) => entry.id === 'sim.speed');
      app.dialogs.close(second!.key, { mode: 'custom', instructionsPerSecond: 500 });
      await again;
      expect(app.ctx.settings.get().sim.speed).toEqual({ mode: 'custom', instructionsPerSecond: 500 });

      // The controller reads the setting at every slice.
      await open('counter');
      await app.ctx.commands.run('sim.run.run');
      const steps = app.ctx.sim.engine.stepCount;
      time.advance(1000);
      const executed = app.ctx.sim.engine.stepCount - steps;
      expect(executed).toBeGreaterThanOrEqual(495);
      expect(executed).toBeLessThanOrEqual(500);
    });

    it('gives the Output panel the keyboard when a program asks for input, and says so in Editor mode', async () => {
      await start();
      const shell = shellStateOf(app.ctx);
      shell.setState((state) => ({ ...state, outputCollapsed: true, focusRequest: null }));
      // Text output only expands the panel; the focus stays where it is (2.10).
      session.ui.showOutput();
      expect(panelVisible(app.ctx, 'output')).toBe(true);
      expect(shell.getState().focusRequest).toBeNull();
      // A keyboard-input task (host.ioShow) and Run (host.ioBringToFront) give it the keyboard.
      session.ui.inputStarted();
      expect(shell.getState().focusRequest?.panel).toBe('output');
      shell.setState((state) => ({ ...state, focusRequest: null }));
      session.ui.bringOutputToFront();
      expect(shell.getState().focusRequest?.panel).toBe('output');
      // A stop in trace mode gives the focus back to the main window.
      session.ui.focusMain();
      expect(shell.getState().focusRequest?.panel).toBe('listing');

      // In Editor mode nothing steals the focus: a toast offers the way to the simulator.
      await app.ctx.commands.run('app.mode.set', 'editor');
      shell.setState((state) => ({ ...state, focusRequest: null }));
      session.ui.inputStarted();
      session.ui.bringOutputToFront();
      session.ui.focusMain();
      expect(shell.getState().focusRequest).toBeNull();
      const toasts = app.dialogs.toasts.getState();
      expect(toasts.map((toast) => [toast.text, toast.action?.label])).toEqual([[INPUT_TOAST, 'Simulator']]);
      toasts[0]?.action?.run();
      await settle();
      expect(app.ctx.store.getState().mode).toBe('simulator');
    });

    it('shows the Hardware panel for task 32/0 without taking the keyboard, and reports full screen', async () => {
      await start();
      expect(session.ui.hardwarePanelVisible()).toBe(false);
      const shell = shellStateOf(app.ctx);
      shell.setState((state) => ({ ...state, focusRequest: null }));
      session.ui.showHardwarePanel();
      expect(session.ui.hardwarePanelVisible()).toBe(true);
      expect(shell.getState().focusRequest).toBeNull();
      // host.setupWindow(true): the Output panel reads the request from the store (2.5).
      session.ui.setFullScreen(true);
      time.advance(16);
      expect(sim().output.fullScreen).toBe(true);
      // The Output panel writes the same member when full screen ends without the port asking; the
      // session does not write its old news over it.
      const setFullScreen = (on: boolean) =>
        app.ctx.store.setState((state) => ({
          ...state,
          sim: { ...state.sim, output: { ...state.sim.output, fullScreen: on } },
        }));
      setFullScreen(false);
      time.advance(100);
      expect(sim().output.fullScreen).toBe(false);
      setFullScreen(true);
      time.advance(100);
      expect(sim().output.fullScreen).toBe(true);
      session.ui.resetPanels(); // a cold start leaves full screen
      time.advance(16);
      expect(sim().output.fullScreen).toBe(false);
    });

    it('applies the two Auto Trace settings to a simulator that is running', async () => {
      await start();
      await open('counter');
      const setSim = (change: Partial<ReturnType<typeof app.ctx.settings.get>['sim']>) =>
        app.ctx.settings.update((settings) => ({ ...settings, sim: { ...settings.sim, ...change } }));
      await app.ctx.commands.run('sim.run.autoTrace');
      const traced = () => sim().messageLines.filter((line) => line.startsWith('PC=')).length;
      time.advance(1000);
      expect(traced()).toBeLessThanOrEqual(5); // 200 ms, the default
      const before = traced();
      setSim({ autoTraceIntervalMs: 20 }); // OK in the Auto Trace Options dialog
      time.advance(1000);
      expect(traced() - before).toBeGreaterThanOrEqual(25); // every second frame
      // "Disable display update" reaches the engine at once (4.6).
      expect(app.ctx.sim.engine.getOption(SimOption.DisableDisplay)).toBe(0);
      setSim({ disableDisplay: true });
      expect(app.ctx.sim.engine.getOption(SimOption.DisableDisplay)).toBe(1);
      setSim({ disableDisplay: false });
      expect(app.ctx.sim.engine.getOption(SimOption.DisableDisplay)).toBe(0);
    });

    it('plays a short tone for the bell character', async () => {
      await start();
      const audio = app.ctx.devices.audio;
      const calls: string[] = [];
      const { load, play } = audio;
      audio.load = (data) => {
        calls.push(`load:${data.length}`);
        return load.call(audio, data);
      };
      audio.play = (sound, loop) => {
        calls.push(`play:${loop}`);
        return play.call(audio, sound, loop);
      };
      session.ui.beep();
      session.ui.beep();
      expect(calls).toEqual([`load:${beepWav().length}`, 'play:false', 'play:false']); // loaded once
      const wav = beepWav();
      expect(String.fromCharCode(...wav.subarray(0, 4), ...wav.subarray(8, 16))).toBe('RIFFWAVEfmt ');
      expect(new DataView(wav.buffer).getUint32(40, true)).toBe(wav.length - 44);
    });

    it('Exit in a browser: the program stops, logs and files are written out, then the empty workspace', async () => {
      const written: string[] = [];
      await start({ files: { exit: async () => void written.push('files.exit') } });
      await open('counter');
      await app.ctx.commands.run('sim.run.run');
      doubles.resets.length = 0;
      written.length = 0;
      await app.ctx.commands.run('sim.file.exit');
      expect(sim().phase).toBe('idle');
      expect(doubles.resets).toEqual(['log.exit']);
      expect(written).toEqual(['files.exit']);
      expect(shellStateOf(app.ctx).getState().exited).toBe(true);
    });

    it('Exit in the desktop app quits', async () => {
      let quit = 0;
      const platform = createFakePlatform({ kind: 'desktop', quit: () => void quit++ });
      await start({ platform });
      await app.ctx.commands.run('sim.file.exit');
      expect(quit).toBe(1);
      expect(shellStateOf(app.ctx).getState().exited).toBe(false);
    });

    /**
     * An application started with arguments. The files of `existing` are in the browser store
     * before the application starts, as a file named on a command line is. `fullScreen` records
     * the arguments the full-screen command of the Output panel was run with.
     */
    async function launch(
      args: Partial<StartupArgs>,
      existing: Record<string, Uint8Array> = {},
      kind: 'web' | 'desktop' = 'web',
    ) {
      time = new VirtualTime();
      doubles = createDeviceDoubles();
      const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
      await backend.mkdirp('demo');
      for (const [name, bytes] of Object.entries(existing)) await backend.writeFile(`demo/${name}`, bytes);
      const fullScreen: unknown[] = [];
      app = createTestApplication({
        clock: time,
        scheduler: time,
        session: ENGINES,
        backends: [backend],
        platform: createFakePlatform({ kind, startupArgs: () => ({ ...NO_ARGS, ...args }) }),
        features: [
          feature,
          { id: 'test', commands: { 'sim.output.fullscreen': { run: (_ctx, arg) => void fullScreen.push(arg) } } },
        ],
        services: {
          createSimSession: (ctx, env) => createSimSession(ctx, env, { parts: doubles.parts, glyphs: BLANK_GLYPHS }),
        },
      });
      session = runSessionOf(app.ctx.sim) as RunSession;
      // The feature's init has looked at the arguments; the engine starts, a named program loads.
      await session.start();
      for (let i = 0; i < 20; i++) await settle();
      return { fullScreen };
    }

    it('opens an .S68 named at start-up in Simulator mode and applies the switches', async () => {
      const { fullScreen } = await launch(
        { file: `${DIR}/halting.S68`, run: true, fullScreen: true, exceptions: true },
        { 'halting.S68': programs.halting.s68 },
      );
      expect(app.ctx.store.getState().mode).toBe('simulator');
      expect(sim().program?.path).toBe(`${DIR}/halting.S68`);
      expect(app.ctx.settings.get().sim.exceptions).toBe(true); // /e
      expect(app.ctx.settings.get().sim.bitField).toBe(false);
      expect(fullScreen).toEqual([true]); // /f: full screen on, not a toggle
      time.advance(16);
      expect(sim().halted).toBe(true); // /r
      expect(app.ctx.sim.engine.getRegister(Reg.D5)).toBe(7);
      expect(INPUT_TOAST).toBe('The program is waiting for keyboard input');
    });

    it('processes the switches when argument 1 names no file (sim-ui §8.1); the mode stays', async () => {
      // The desktop app reports a first argument that names no existing file as `file: null`.
      const { fullScreen } = await launch(
        { file: null, run: true, fullScreen: true, exceptions: true, bitField: true },
        {},
        'desktop',
      );
      expect(app.ctx.store.getState().mode).toBe('editor'); // 5.7: "Otherwise a new document"
      expect(sim().program).toBeNull();
      expect(app.ctx.settings.get().sim).toMatchObject({ exceptions: true, bitField: true }); // /e /b
      expect(app.ctx.sim.engine.getOption(SimOption.Exceptions)).toBe(1);
      expect(app.ctx.sim.engine.getOption(SimOption.BitField)).toBe(1);
      expect(fullScreen).toEqual([true]); // /f
      // /r: Run with nothing loaded. Memory is all $FF, the SIMHALT pattern, so it halts at once
      // (sim-ui §3.6), and the commands are busy as after any halt.
      time.advance(16);
      expect(sim()).toMatchObject({ phase: 'idle', halted: true, menuState: 1 });
      expect(boxes()).toEqual([]); // nothing is reported
    });

    it('processes the switches when argument 1 is a file of another kind, which the editor opens', async () => {
      await launch({ file: `${DIR}/notes.X68`, exceptions: true }, { 'notes.X68': bytesOf('* notes\r\n') });
      expect(app.ctx.store.getState().mode).toBe('editor');
      expect(sim().program).toBeNull();
      expect(app.ctx.settings.get().sim).toMatchObject({ exceptions: true, bitField: false });
      expect(sim()).toMatchObject({ phase: 'idle', halted: false }); // no /r: nothing ran
      expect(app.ctx.sim.engine.stepCount).toBe(0);
    });

    it('ignores an .S68 named at start-up that does not exist, and still processes the switches', async () => {
      await launch({ file: `${DIR}/missing.S68`, bitField: true });
      expect(app.ctx.store.getState().mode).toBe('editor'); // 5.7: only a file that exists changes the mode
      expect(sim().program).toBeNull();
      expect(sim().messageLines).toEqual([]); // "silently ignored (no error message)"
      expect(app.ctx.settings.get().sim).toMatchObject({ exceptions: false, bitField: true });
    });

    it('leaves the simulator as it started when there is neither a program nor a switch', async () => {
      const { fullScreen } = await launch({ file: `${DIR}/notes.X68` }, { 'notes.X68': bytesOf('* notes\r\n') });
      expect(app.ctx.store.getState().mode).toBe('editor');
      expect(sim()).toMatchObject({ phase: 'idle', program: null, halted: false, menuState: 0 });
      expect(app.ctx.settings.get().sim).toMatchObject({ exceptions: false, bitField: false });
      expect(fullScreen).toEqual([]);
      expect(app.ctx.sim.engine.stepCount).toBe(0);
    });

    it('an .S68 opened from the system: Simulator mode, a simulator started afresh, loaded and not run', async () => {
      let openFiles: (files: string[]) => void = () => {};
      const platform = createFakePlatform({
        onOpenFiles(listener) {
          openFiles = listener;
          return () => {};
        },
      });
      await start({ platform });
      await open('counter');
      await app.ctx.commands.run('sim.run.run');
      await app.ctx.commands.run('app.mode.set', 'editor');
      const old = app.ctx.sim.engine;
      openFiles(['/browser/demo/notes.X68', `${DIR}/halting.S68`]); // the source file is the editor's business
      for (let i = 0; i < 20 && sim().program?.path !== `${DIR}/halting.S68`; i++) await settle();
      expect(app.ctx.store.getState().mode).toBe('simulator');
      expect(sim().program?.path).toBe(`${DIR}/halting.S68`);
      expect(app.ctx.sim.engine).not.toBe(old); // a cold start, as the original starts a new process
      expect(sim().phase).toBe('idle');
      time.advance(100);
      expect(app.ctx.sim.engine.getRegister(Reg.D5)).toBe(0); // loaded, not started
      expect(boxes()).toEqual([]); // no question for a file association (4.7 step 2)
    });

    it('shows a box the engine raises outside a run: Breakpoint Limit Reached! at the 101st breakpoint', async () => {
      await start();
      await open('counter');
      // What the gutter of the Listing panel does for each click (features/sim-main).
      for (let i = 0; i < 100; i++) app.ctx.sim.controller.invoke((engine) => engine.setBreakpoint(0x1000 + 2 * i));
      await settle();
      expect(boxes()).toEqual([]);
      expect(sim().breakpoints).toHaveLength(100);
      app.ctx.sim.controller.invoke((engine) => engine.setBreakpoint(0x2000));
      await settle();
      expect(boxes().map((box) => box.request)).toEqual([
        { title: 'Error', text: 'Breakpoint Limit Reached!', icon: 'none', buttons: ['OK'] },
      ]);
      expect(sim().breakpoints).toHaveLength(100);
      await answer('OK');
      expect(boxes()).toEqual([]);
      expect(app.ctx.sim.controller.alerts).toEqual([]);
      expect(app.ctx.sim.engine.state().alertOpen).toBe(false);
    });

    it('mirrors the repaints by panel, and memory changes of both writers of liveRevision', async () => {
      await start();
      await open('counter');
      expect(sim().repaint).toEqual(session.controller.repaintCounts);
      const before = sim();
      // A PC breakpoint repaints the listing: the Stack panel's counter stands still.
      app.ctx.sim.controller.invoke((engine) => engine.setBreakpoint(0x1002));
      expect(sim().viewRevision).toBe(before.viewRevision + 1);
      expect(sim().repaint).toEqual({ ...before.repaint, listing: (before.repaint?.listing ?? 0) + 1 });

      // The Memory panel types a byte: pokeMemory counts one change and no repaint ...
      app.ctx.sim.controller.pokeMemory(0x2000, 0x55);
      expect(sim().liveRevision).toBe(before.liveRevision + 1);
      expect(sim().viewRevision).toBe(before.viewRevision + 1);
      // ... and interface code that writes memory itself bumps the store's counter (Copy, Fill).
      const bump = () =>
        app.ctx.store.setState((state) => ({
          ...state,
          sim: { ...state.sim, liveRevision: state.sim.liveRevision + 1 },
        }));
      bump();
      expect(sim().liveRevision).toBe(before.liveRevision + 2);
      // The session's next looks at the simulator do not take that back.
      time.advance(48);
      session.sync();
      expect(sim().liveRevision).toBe(before.liveRevision + 2);
      app.ctx.sim.controller.pokeMemory(0x2001, 0x66);
      bump();
      time.advance(16);
      expect(sim().liveRevision).toBe(before.liveRevision + 4);
    });

    it('page events: losing the focus makes the next Run revalidate the files; closing the page writes them out', async () => {
      const fake = createFakePage();
      const calls: string[] = [];
      await start({
        page: fake.page,
        files: {
          markStale: () => void calls.push('markStale'),
          revalidateIfStale: async () => void calls.push('revalidateIfStale'),
          exitNow: () => void calls.push('exitNow'),
        },
        log: { exit: async () => void calls.push('log.exit') },
      });
      expect([fake.listening('blur'), fake.listening('pagehide')]).toEqual([1, 1]);
      await open('counter');
      calls.length = 0;

      // The window had the focus elsewhere: files may have changed behind a cached view (3.8.4).
      fake.fire('blur');
      expect(calls).toEqual(['markStale']);
      await app.ctx.commands.run('sim.run.run');
      expect(calls).toEqual(['markStale', 'revalidateIfStale']);
      await settle();
      expect(sim().phase).toBe('running');
      // Only once: without another blur the next Run asks nothing.
      await app.ctx.commands.run('sim.run.pause');
      await app.ctx.commands.run('sim.run.run');
      await settle();
      expect(calls).toEqual(['markStale', 'revalidateIfStale']);

      // The page is closing without notice: commit what can be committed, journal the rest.
      calls.length = 0;
      fake.fire('pagehide');
      expect(calls).toEqual(['exitNow', 'log.exit']);

      // The session ends with the window: it listens no more.
      app.dispose();
      expect([fake.listening('blur'), fake.listening('pagehide')]).toEqual([0, 0]);
    });

    it('keeps the journal of the program files in the storage of the page, under one key', async () => {
      const fake = createFakePage();
      await start({ page: fake.page });
      const { journal } = session.ui;
      expect(journal.read()).toBeNull();
      journal.write('{"pending":[1,2,3]}');
      expect([...fake.stored]).toEqual([[JOURNAL_KEY, '{"pending":[1,2,3]}']]);
      expect(JOURNAL_KEY).toBe('easy68k.sim.journal.v1');
      expect(journal.read()).toBe('{"pending":[1,2,3]}');
      journal.write(null);
      expect(fake.stored.size).toBe(0);
      expect(journal.read()).toBeNull();
    });

    it('a page that refuses storage loses the journal, nothing else', async () => {
      const refuse = (): never => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      };
      const errors: unknown[][] = [];
      const consoleError = console.error;
      console.error = (...args: unknown[]) => void errors.push(args);
      try {
        await start({ page: { localStorage: { getItem: refuse, setItem: refuse, removeItem: refuse } } });
        const { journal } = session.ui;
        expect(journal.read()).toBeNull();
        expect(() => journal.write('x')).not.toThrow();
        expect(() => journal.write(null)).not.toThrow();
        expect(errors.map((args) => args[0])).toEqual([
          'Simulator: the program-files journal could not be written:',
          'Simulator: the program-files journal could not be written:',
        ]);
        // A page without storage at all (and without events, as under Node) is no error either.
        app.dispose();
        errors.length = 0;
        await start({ page: {} });
        expect(session.ui.journal.read()).toBeNull();
        session.ui.journal.write('x');
        expect(errors).toEqual([]);
      } finally {
        console.error = consoleError;
      }
    });

    it('applies the journal of the program files before the first engine exists', async () => {
      const order: string[] = [];
      time = new VirtualTime();
      doubles = createDeviceDoubles();
      doubles.parts.files = partOf<ProgramFilesApi>({
        resetToStartup: () => void order.push('files.resetToStartup'),
        exit: async () => {},
        setCurrentDir: async () => {},
        unsaved: false,
        async recoverJournal() {
          order.push('recoverJournal starts');
          await settle();
          order.push('recoverJournal ends');
        },
      });
      app = createTestApplication({
        clock: time,
        scheduler: time,
        session: {
          ...ENGINES,
          engines: {
            create(host) {
              order.push('engine.create');
              return createSimEngine(host);
            },
            release: releaseSimEngine,
          },
        },
        features: [feature],
        services: {
          createSimSession: (ctx, env) => createSimSession(ctx, env, { parts: doubles.parts, glyphs: BLANK_GLYPHS }),
        },
      });
      session = runSessionOf(app.ctx.sim) as RunSession;
      // A load asked for at once (a program named on the command line) waits for the same start.
      await app.ctx.vfs.writeFile(`${DIR}/halting.S68`, programs.halting.s68);
      await app.ctx.sim.controller.open(`${DIR}/halting.S68`, 'open');
      expect(order).toEqual(['recoverJournal starts', 'recoverJournal ends', 'files.resetToStartup', 'engine.create']);
      expect(sim().program?.path).toBe(`${DIR}/halting.S68`);
    });

    it('asks for the "leave?" question while bytes of the program files or of a log are not in storage', async () => {
      const asked: [boolean, string | undefined][] = [];
      const platform = createFakePlatform({ confirmBeforeUnload: (needed, who) => void asked.push([needed, who]) });
      const unsaved = { files: false, log: false };
      await start({ platform, unsaved });
      time.advance(32);
      expect(asked).toEqual([]); // nothing to guard, nothing asked: the documents' guard is not touched
      unsaved.files = true;
      time.advance(16); // the session looks once per frame
      expect(asked).toEqual([[true, 'simulator']]);
      unsaved.log = true;
      unsaved.files = false;
      time.advance(32);
      expect(asked).toEqual([[true, 'simulator']]); // still needed: no second call
      unsaved.log = false;
      time.advance(16);
      expect(asked).toEqual([
        [true, 'simulator'],
        [false, 'simulator'],
      ]);
      // A session that ends while it needs the question withdraws it.
      unsaved.files = true;
      time.advance(16);
      app.dispose();
      expect(asked.at(-1)).toEqual([false, 'simulator']);
      expect(asked).toHaveLength(4);
    });

    it("tells the desktop app's serial and network devices where the port map and the memory are", async () => {
      const bound: DesktopDeviceSources[] = [];
      const platform = createFakePlatform({
        kind: 'desktop',
        bindDeviceSources: (sources) => void bound.push(sources),
      });
      await start({ platform });
      expect(bound).toHaveLength(1); // once, when the session is made
      const sources = bound[0] as Required<DesktopDeviceSources>;
      expect(sources.portMap()).toEqual({});
      app.ctx.settings.update((settings) => ({
        ...settings,
        app: { ...settings.app, serialPortMap: { COM4: '/dev/tty.usbserial-1' } },
      }));
      expect(sources.portMap()).toEqual({ COM4: '/dev/tty.usbserial-1' });
      // The 68000 memory is read at each use: a cold start gives the window another engine.
      await open('counter');
      // (Identity of the underlying buffer: `engine.memory` is a new view at every read.)
      const first = sources.memory().buffer;
      expect(first === app.ctx.sim.engine.memory.buffer).toBe(true);
      expect(sources.memory()[0x1000]).toBe(0x70); // MOVEQ #0,D0
      await open('halting', 'execute');
      expect(sources.memory().buffer === app.ctx.sim.engine.memory.buffer).toBe(true);
      expect(sources.memory().buffer === first).toBe(false);
      expect(sources.memory()[0x1001]).toBe(0x07); // MOVEQ #7,D5
    });
  },
);

// No engine is needed here: the session must not even ask for one.
describe('a session disposed before it starts', () => {
  it('neither subscribes to frames nor creates an engine nor reads the journal', async () => {
    const time = new VirtualTime();
    let frameSubscriptions = 0;
    const scheduler = {
      onFrame(fn: (now: number) => void) {
        frameSubscriptions++;
        const stop = time.onFrame(fn);
        return () => {
          frameSubscriptions--;
          stop();
        };
      },
      setTimer: (delayMs: number, fn: () => void) => time.setTimer(delayMs, fn),
    };
    let created = 0;
    let recovered = 0;
    const doubles = createDeviceDoubles({
      files: partOf<ProgramFilesApi>({
        resetToStartup: () => {},
        exit: async () => {},
        recoverJournal: async () => void recovered++,
        markStale: () => {},
        exitNow: () => {},
        unsaved: false,
      }),
    });
    const app = createTestApplication({
      clock: time,
      scheduler,
      session: {
        engines: {
          create: () => {
            created++;
            return Promise.reject(new Error('no engine in this test'));
          },
          release: () => {},
        },
        createCachedSyncFiles: () => new MemorySyncFiles(),
      },
      features: [feature],
      services: {
        createSimSession: (ctx, env) =>
          createSimSession(ctx, env, { parts: doubles.parts, glyphs: BLANK_GLYPHS, page: createFakePage().page }),
      },
    });
    // bootstrap's own test does this: build an application and dispose of it at once. The session
    // starts in the microtask after bootstrap, which here comes after the disposal.
    app.dispose();
    await settle();
    await settle();
    expect(created).toBe(0);
    expect(recovered).toBe(0);
    expect(frameSubscriptions).toBe(0);
    // A later start on the disposed session does nothing either.
    await (runSessionOf(app.ctx.sim) as RunSession).start();
    expect(created).toBe(0);
    expect(frameSubscriptions).toBe(0);
  });
});

// SH6's note for gate I2: CachedSyncFiles.dispose() (beyond the contract) stops a view listening
// to the Vfs. The session ends its views with it, after handing their changes to storage.
describe('the end of a session', () => {
  it('settles and disposes of the cached views it made', async () => {
    const calls: string[] = [];
    class TrackedView extends MemorySyncFiles {
      override settled(): Promise<void> {
        calls.push('settled');
        return super.settled();
      }
      dispose(): void {
        calls.push('dispose');
      }
    }
    const doubles = createDeviceDoubles();
    const app = createTestApplication({
      session: {
        engines: { create: () => Promise.reject(new Error('no engine in this test')), release: () => {} },
        createCachedSyncFiles: () => new TrackedView(),
      },
      features: [feature],
      services: {
        createSimSession: (ctx, env) =>
          createSimSession(ctx, env, {
            parts: { listing: doubles.parts.listing },
            glyphs: BLANK_GLYPHS,
            page: createFakePage().page,
            autoStart: false,
          }),
      },
    });
    const session = runSessionOf(app.ctx.sim) as RunSession;
    // The real ProgramFiles asks the session for the view of a folder of the browser store (this
    // in-memory view reaches nothing, so preparing the folder fails; the view was made).
    await session.files.setCurrentDir('/browser/demo').catch(() => {});
    expect(calls).toEqual([]);
    session.dispose();
    expect(calls).toEqual(['settled', 'dispose']);
    session.dispose(); // a second time does nothing
    expect(calls).toEqual(['settled', 'dispose']);
    app.dispose();
  });
});
