// The log feature under Node: its rules (model.ts) and its commands in a test application, with the
// real LogService over a small engine double (ARCHITECTURE.md 2.6, 2.7, 3.3.5; sim-ui §13).

import { afterEach, describe, expect, it } from 'vitest';
import { SimOption, type AppContext, type SimEngine } from '../../contracts';
import { asciiBytes } from '../../core/sim-host/log/format';
import { LogService } from '../../core/sim-host/log/log-service';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature, showLogOutput, startLogging } from './index';
import {
  LOG_FILE_EXISTS_DIALOG_ID,
  LOG_OUTPUT_DIALOG_ID,
  draftOf,
  fileExistsMessage,
  folderOf,
  hexValue,
  isInvalidLogAddress,
  memRangeVisible,
  openErrorText,
  valuesOf,
} from './model';

describe('the rules of the logging interface', () => {
  it('has the texts of the original', () => {
    expect(fileExistsMessage('exec')).toBe('Execution Log File exists!');
    expect(fileExistsMessage('output')).toBe('Output Log File exists!');
    expect(openErrorText('exec')).toBe("Can't open log file. Check log file name., Error number 0");
    expect(openErrorText('output')).toBe("Can't open log file, error 0");
  });

  it('turns the dialog fields into the service values and back', () => {
    const values = {
      execFileName: '/browser/w/p_RunLog.txt',
      outputFileName: '/browser/w/p_OutLog.txt',
      execType: 3 as const,
      outputType: 1 as const,
      memFrom: 0x1012,
      memBytes: 0x10,
    };
    const draft = draftOf(values);
    expect(draft.memFromText).toBe('00001012');
    expect(draft.memBytesText).toBe('10');
    expect(valuesOf(draft)).toEqual(values);
    expect(hexValue('')).toBe(0);
    expect(hexValue('00FFFFFF')).toBe(0xffffff);
  });

  it('shows the memory range for type 3 only and checks the From address', () => {
    expect([0, 1, 2, 3].map(memRangeVisible)).toEqual([false, false, false, true]);
    expect(isInvalidLogAddress('00FFFFFF')).toBe(false);
    expect(isInvalidLogAddress('01000000')).toBe(true);
    expect(isInvalidLogAddress('FFFFFFFF')).toBe(true);
  });

  it('finds the folder of a name for the Save dialog', () => {
    expect(folderOf('/browser/w/p_RunLog.txt')).toBe('/browser/w');
    expect(folderOf('p_RunLog.txt')).toBeNull();
    expect(folderOf('/browser')).toBeNull();
  });
});

/** The engine's share of logging (the shim's log.cpp), enough for the commands. */
function engineFor(log: () => LogService, calls: string[]): SimEngine {
  const options = new Map<number, number>();
  let logging = false;
  return {
    getOption: (option: number) => options.get(option) ?? 0,
    setOption: (option: number, value: number | boolean) => {
      calls.push(`setOption(${option},${Number(value)})`);
      options.set(option, Number(value));
    },
    logDialogOpened: () => calls.push('logDialogOpened'),
    startLog: (time: string) => {
      calls.push(`startLog(${time})`);
      if (options.get(SimOption.ExecLogType)) log().logWrite(asciiBytes(`EASy68K execution log file: ${time}\r\n\r\n`));
      logging = true;
      log().logState(true);
    },
    stopLog: () => {
      calls.push('stopLog');
      if (logging) {
        logging = false;
        log().logState(false);
      }
    },
  } as unknown as SimEngine;
}

describe('the log feature in an application', () => {
  let app: TestApplication | null = null;
  afterEach(() => {
    app?.dispose();
    app = null;
  });

  function build(options: { failWrites?: boolean } = {}) {
    const calls: string[] = [];
    let log!: LogService;
    let holds = 0;
    let held = 0;
    app = createTestApplication({
      features: [feature],
      services: {
        createSimSession: (ctx: AppContext) => {
          const inert = createInertSimSession(ctx);
          const engine = engineFor(() => log, calls);
          const vfs = options.failWrites
            ? new Proxy(ctx.vfs, {
                get(target, prop) {
                  if (prop === 'writeFile') return () => Promise.reject(new Error('read-only'));
                  const value = Reflect.get(target, prop) as unknown;
                  return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
                },
              })
            : ctx.vfs;
          log = new LogService({
            vfs,
            clock: ctx.clock,
            scheduler: ctx.scheduler,
            invoke: (fn) => fn(engine),
            askFileExists: (kind) =>
              ctx.dialogs.open(LOG_FILE_EXISTS_DIALOG_ID, { kind, fileName: '' }) as Promise<
                'Replace' | 'Append' | 'Cancel'
              >,
          });
          const controller = {
            ...inert.controller,
            hold: () => {
              holds++;
              held++;
              let done = false;
              return () => {
                if (!done) held--;
                done = true;
              };
            },
          };
          return { ...inert, engine, log, controller };
        },
      },
    });
    const a = app;
    return {
      app: a,
      calls,
      log: () => log,
      holds: () => holds,
      held: () => held,
      stack: () => a.ctx.store.getState().dialogs.stack,
    };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) await tick();
    if (!condition()) throw new Error(`timed out: ${what}`);
  }

  it('registers the three commands, the two dialogs and the Log panel', () => {
    const { app } = build();
    for (const id of ['sim.run.logStart', 'sim.run.logStop', 'sim.options.logOutput']) {
      expect(feature.commands?.[id]).toBeDefined();
    }
    expect(app.dialogComponents.has(LOG_OUTPUT_DIALOG_ID)).toBe(true);
    expect(app.dialogComponents.has(LOG_FILE_EXISTS_DIALOG_ID)).toBe(true);
    expect(app.panels.find('simulator', 'log')?.title).toBe('Log');
  });

  it('Log Start and Log Stop follow sim-ui §13.6, and the menus hear of every change', async () => {
    const { app, log } = build();
    expect(app.ctx.commands.isEnabled('sim.run.logStart')).toBe(false);
    expect(app.ctx.commands.isEnabled('sim.run.logStop')).toBe(false);
    let notified = 0;
    app.ctx.store.subscribe(() => notified++);
    log().setLogFileNames('/browser/work/prog.S68');
    log().applyDialog({ ...log().state, outputType: 1 });
    expect(notified).toBeGreaterThan(0);
    expect(app.ctx.commands.isEnabled('sim.run.logStart')).toBe(true);
    await app.ctx.commands.run('sim.run.logStart');
    expect(log().state.logging).toBe(true);
    expect(app.ctx.commands.isEnabled('sim.run.logStart')).toBe(false);
    expect(app.ctx.commands.isEnabled('sim.run.logStop')).toBe(true);
    await app.ctx.commands.run('sim.run.logStop');
    expect(log().state.logging).toBe(false);
    expect(app.ctx.commands.isEnabled('sim.run.logStart')).toBe(true);
    expect(app.ctx.commands.isEnabled('sim.run.logStop')).toBe(false);
  });

  it('Log Start holds the program from the click until logging has started, also over the question', async () => {
    const { app, log, holds, held, stack, calls } = build();
    await app.ctx.vfs.writeFile('/browser/work/prog_OutLog.txt', asciiBytes('old'));
    log().setLogFileNames('/browser/work/prog.S68');
    log().applyDialog({ ...log().state, outputType: 1 });
    const started = startLogging(app.ctx);
    expect(holds()).toBe(1);
    expect(held()).toBe(1);
    await until(() => stack().length === 1, 'the question');
    const question = stack()[0];
    expect(question).toMatchObject({ id: LOG_FILE_EXISTS_DIALOG_ID, modal: true, props: { kind: 'output' } });
    expect(held()).toBe(1); // the command's own hold (the dialog's is the dialog service's)
    expect(calls.some((call) => call.startsWith('startLog'))).toBe(false);
    app.dialogs.close(question?.key ?? -1, 'Append');
    expect(await started).toBe(true);
    expect(held()).toBe(0);
    expect(calls.filter((call) => call.startsWith('startLog'))).toHaveLength(1);
  });

  it('Cancel: engine.startLog is not called and logging stays off', async () => {
    const { app, log, stack, calls } = build();
    await app.ctx.vfs.writeFile('/browser/work/prog_RunLog.txt', asciiBytes('old'));
    log().setLogFileNames('/browser/work/prog.S68');
    log().applyDialog({ ...log().state, execType: 1 });
    const started = startLogging(app.ctx);
    await until(() => stack().length === 1, 'the question');
    app.dialogs.close(stack()[0]?.key ?? -1, 'Cancel');
    expect(await started).toBe(false);
    expect(calls.some((call) => call.startsWith('startLog'))).toBe(false);
    expect(log().state.logging).toBe(false);
    expect(stack()).toEqual([]); // no error box after Cancel
    expect(app.ctx.commands.isEnabled('sim.run.logStart')).toBe(true);
  });

  it('a file that cannot be opened: the Error box, then the Log Output dialog for the execution log', async () => {
    const { app, log, stack } = build({ failWrites: true });
    log().setLogFileNames('/browser/work/prog.S68');
    log().applyDialog({ ...log().state, execType: 1 });
    const started = startLogging(app.ctx);
    await until(() => stack().length === 1, 'the error box');
    expect(stack()[0]).toMatchObject({
      id: 'message',
      props: { title: 'Error', text: "Can't open log file. Check log file name., Error number 0", buttons: ['OK'] },
    });
    app.dialogs.close(stack()[0]?.key ?? -1, 'OK');
    expect(await started).toBe(false);
    await until(() => stack().length === 1, 'the Log Output dialog');
    expect(stack()[0]).toMatchObject({ id: LOG_OUTPUT_DIALOG_ID, modal: false });
    expect(log().state.logging).toBe(false);
  });

  it('Log Output: shown modeless with the current values; OK applies them and saves the two types', async () => {
    const { app, log, stack, calls } = build();
    log().setLogFileNames('/browser/work/prog.S68');
    calls.length = 0;
    const shown = showLogOutput(app.ctx);
    expect(calls).toEqual(['logDialogOpened']);
    const dialog = stack()[0];
    expect(dialog).toMatchObject({
      id: LOG_OUTPUT_DIALOG_ID,
      modal: false,
      props: { values: { execFileName: '/browser/work/prog_RunLog.txt', execType: 0, outputType: 0 } },
    });
    // A second Options > Log Output... while it is open shows no second dialog.
    void showLogOutput(app.ctx);
    expect(stack()).toHaveLength(1);
    app.dialogs.close(dialog?.key ?? -1, {
      execFileName: '/browser/work/mine.txt',
      outputFileName: '/browser/work/prog_OutLog.txt',
      execType: 3,
      outputType: 1,
      memFrom: 0x1012,
      memBytes: 0x10,
    });
    await shown;
    expect(log().state).toMatchObject({ execFileName: '/browser/work/mine.txt', execType: 3, startEnabled: true });
    expect(calls).toContain(`setOption(${SimOption.LogMemFrom},${0x1012})`);
    expect(calls).toContain(`setOption(${SimOption.LogMemBytes},16)`);
    expect(app.ctx.settings.get().sim).toMatchObject({ execLogType: 3, outputLogType: 1 });
  });

  it('Log Output: Cancel changes nothing', async () => {
    const { app, log, stack, calls } = build();
    log().setLogFileNames('/browser/work/prog.S68');
    calls.length = 0;
    const shown = showLogOutput(app.ctx);
    app.dialogs.close(stack()[0]?.key ?? -1, null);
    await shown;
    expect(calls).toEqual(['logDialogOpened']);
    expect(log().state.execType).toBe(0);
    expect(app.ctx.settings.get().sim).toMatchObject({ execLogType: 0, outputLogType: 0 });
  });
});
