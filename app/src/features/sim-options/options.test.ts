// The sim-options feature under Node: its rules (model.ts) and its commands in a test application
// (ARCHITECTURE.md 1.3.4, 1.4 notes 27-29; sim-ui §14.1).

import { afterEach, describe, expect, it } from 'vitest';
import { SimOption, type AppContext, type FontSpec, type SimEngine } from '../../contracts';
import { createInertSimSession } from '../../state/stub-services';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import {
  AUTO_TRACE_DIALOG_ID,
  FONT_DIALOG_ID,
  FULLSCREEN_ACTIVE_TEXT,
  FULLSCREEN_DIALOG_ID,
  FULLSCREEN_TEXT,
  clampInterval,
  fontChoices,
  fontFrom,
  initialFontName,
  measuredName,
  parseFontSize,
  screenNumberOf,
  styleNameOf,
} from './model';

describe('the rules of the option dialogs', () => {
  it('lists the measured fonts for the Output and Source fonts, any font for the printer (note 27)', () => {
    expect(fontChoices('output', 'Fixedsys')).toEqual([
      'Fixedsys',
      'Courier',
      'Courier New',
      'Lucida Console',
      'Consolas',
    ]);
    expect(fontChoices('source', 'Courier New')).toEqual(fontChoices('output', ''));
    expect(fontChoices('printer', 'Comic Sans MS')).toContain('Comic Sans MS');
    expect(measuredName('courier new')).toBe('Courier New');
    expect(measuredName('Arial')).toBeNull();
  });

  it('starts with a saved or imported name, a measured font in its listed spelling', () => {
    expect(initialFontName('output', 'lucida console')).toBe('Lucida Console');
    expect(initialFontName('source', 'FIXEDSYS')).toBe('Fixedsys');
    // An imported sim68K.dat may carry any name: it is kept, and selects nothing in the list.
    expect(initialFontName('output', 'Terminal')).toBe('Terminal');
    expect(fontChoices('output', 'Terminal')).not.toContain('Terminal');
    // The printer takes any name as it is.
    expect(initialFontName('printer', 'courier new')).toBe('courier new');
  });

  it('limits the sizes to 8..18 for the Output and Source fonts', () => {
    expect(parseFontSize('8', 'output')).toBe(8);
    expect(parseFontSize('18', 'source')).toBe(18);
    expect(parseFontSize('19', 'output')).toBeNull();
    expect(parseFontSize('7', 'output')).toBeNull();
    expect(parseFontSize('36', 'printer')).toBe(36);
    expect(parseFontSize('x', 'printer')).toBeNull();
  });

  it('maps the style list and effects to a FontSpec and back', () => {
    const font = fontFrom('Consolas', 12, 'Bold Italic', { underline: true, strikeOut: false });
    expect(font).toEqual({ name: 'Consolas', size: 12, bold: true, italic: true, underline: true, strikeOut: false });
    expect(styleNameOf(font)).toBe('Bold Italic');
    expect(styleNameOf({ bold: false, italic: true })).toBe('Italic');
  });

  it('keeps the interval in the up/down range and accepts only screen 1 (notes 28, 29)', () => {
    expect([5, 10, 200, 1000, 5000, Number.NaN].map(clampInterval)).toEqual([10, 10, 200, 1000, 1000, 200]);
    expect(screenNumberOf('1')).toBe(1);
    expect(screenNumberOf(' 1 ')).toBe(1);
    expect(screenNumberOf('2')).toBeNull();
    expect(screenNumberOf('0')).toBeNull();
    expect(screenNumberOf('')).toBeNull();
    expect(FULLSCREEN_TEXT).toBe(
      'Screen to use for fullscreen output window.  Primary screen = 1  Secondary screens = 2 and up.',
    );
  });
});

describe('the sim-options feature in an application', () => {
  let app: TestApplication | null = null;
  afterEach(() => {
    app?.dispose();
    app = null;
  });

  function build() {
    const calls: string[] = [];
    const options = new Map<number, number>();
    const fonts: { font: FontSpec; color: number }[] = [];
    let printerChanges = 0;
    const engine = {
      getOption: (option: number) => options.get(option) ?? 0,
      setOption: (option: number, value: number | boolean) => {
        calls.push(`setOption(${option},${Number(value)})`);
        options.set(option, Number(value));
      },
    } as unknown as SimEngine;
    app = createTestApplication({
      features: [feature],
      services: {
        createSimSession: (ctx: AppContext) => {
          const inert = createInertSimSession(ctx);
          const text = inert.text;
          const original = text.setOptionsFont.bind(text);
          text.setOptionsFont = (font, color) => {
            fonts.push({ font, color });
            original(font, color);
          };
          const printer = inert.printer;
          printer.fontChanged = () => void printerChanges++;
          return {
            ...inert,
            engine,
            controller: { ...inert.controller, invoke: (fn: (e: SimEngine) => void) => fn(engine) },
          };
        },
      },
    });
    const a = app;
    return {
      app: a,
      calls,
      options,
      fonts,
      printerChanges: () => printerChanges,
      stack: () => a.ctx.store.getState().dialogs.stack,
    };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('Enable Exceptions and Enable Bit Field: the check follows the setting, saved at once, engine told', async () => {
    const { app, calls } = build();
    expect(app.ctx.commands.isChecked('sim.options.exceptions')).toBe(false);
    await app.ctx.commands.run('sim.options.exceptions');
    expect(app.ctx.settings.get().sim.exceptions).toBe(true);
    expect(app.ctx.commands.isChecked('sim.options.exceptions')).toBe(true);
    expect(calls).toEqual([`setOption(${SimOption.Exceptions},1)`]);
    expect(app.storage).toBeDefined();
    await app.ctx.commands.run('sim.options.bitField');
    await app.ctx.commands.run('sim.options.bitField');
    expect(app.ctx.settings.get().sim.bitField).toBe(false);
    expect(calls.slice(1)).toEqual([`setOption(${SimOption.BitField},1)`, `setOption(${SimOption.BitField},0)`]);
    // Every Options item is always enabled (sim-ui §3.6).
    for (const id of Object.keys(feature.commands ?? {})) expect(app.ctx.commands.isEnabled(id)).toBe(true);
  });

  it('Auto Trace Options: OK saves the interval and the check box; Cancel changes nothing', async () => {
    const { app, stack } = build();
    let done = app.ctx.commands.run('sim.options.autoTrace');
    await tick();
    expect(stack()[0]).toMatchObject({
      id: AUTO_TRACE_DIALOG_ID,
      modal: true,
      props: { intervalMs: 200, disableDisplay: false },
    });
    app.dialogs.close(stack()[0]?.key ?? -1, null);
    await done;
    expect(app.ctx.settings.get().sim).toMatchObject({ autoTraceIntervalMs: 200, disableDisplay: false });
    done = app.ctx.commands.run('sim.options.autoTrace');
    await tick();
    app.dialogs.close(stack()[0]?.key ?? -1, { intervalMs: 50, disableDisplay: true });
    await done;
    expect(app.ctx.settings.get().sim).toMatchObject({ autoTraceIntervalMs: 50, disableDisplay: true });
  });

  it('Fullscreen Options: the dialog with the engine value; OK sets the engine; refused in full screen', async () => {
    const { app, stack, calls } = build();
    let done = app.ctx.commands.run('sim.options.fullscreen');
    await tick();
    expect(stack()[0]).toMatchObject({ id: FULLSCREEN_DIALOG_ID, modal: true, props: { screen: 1 } });
    app.dialogs.close(stack()[0]?.key ?? -1, 1);
    await done;
    expect(calls).toEqual([`setOption(${SimOption.FullscreenMonitor},0)`]);

    app.ctx.store.setState((state) => ({
      ...state,
      sim: { ...state.sim, output: { ...state.sim.output, fullScreen: true } },
    }));
    done = app.ctx.commands.run('sim.options.fullscreen');
    await tick();
    expect(stack()[0]).toMatchObject({
      id: 'message',
      props: { title: 'Error', text: FULLSCREEN_ACTIVE_TEXT, buttons: ['OK'] },
    });
    app.dialogs.close(stack()[0]?.key ?? -1, 'OK');
    await done;
    expect(calls).toHaveLength(1);
  });

  it('Output Window Font: saves name and size, gives the text screen font, style and colour', async () => {
    const { app, stack, fonts } = build();
    const done = app.ctx.commands.run('sim.options.outputFont');
    await tick();
    expect(stack()[0]).toMatchObject({
      id: FONT_DIALOG_ID,
      modal: true,
      props: { target: 'output', font: { name: 'Fixedsys', size: 9 }, color: 0xffffff },
    });
    const font: FontSpec = {
      name: 'Consolas',
      size: 12,
      bold: true,
      italic: false,
      underline: false,
      strikeOut: false,
    };
    app.dialogs.close(stack()[0]?.key ?? -1, { font, color: 0x00ffff });
    await done;
    expect(app.ctx.settings.get().sim.outputFont).toEqual({ name: 'Consolas', size: 12 });
    expect(fonts.at(-1)).toEqual({ font, color: 0x00ffff });
    expect(app.ctx.sim.text.state.optionsFont).toMatchObject({ name: 'Consolas', size: 12, bold: true });
  });

  it('Source Window Font and Printer Font: save name and size; the printer is told', async () => {
    const { app, stack, printerChanges } = build();
    let done = app.ctx.commands.run('sim.options.sourceFont');
    await tick();
    expect(stack()[0]).toMatchObject({ props: { target: 'source', font: { name: 'Courier New', size: 10 } } });
    app.dialogs.close(stack()[0]?.key ?? -1, {
      font: { name: 'Consolas', size: 14, bold: false, italic: false, underline: false, strikeOut: false },
      color: 0,
    });
    await done;
    expect(app.ctx.settings.get().sim.listingFont).toEqual({ name: 'Consolas', size: 14 });

    done = app.ctx.commands.run('sim.options.printerFont');
    await tick();
    expect(stack()[0]).toMatchObject({ props: { target: 'printer', font: { name: 'Courier New', size: 10 } } });
    app.dialogs.close(stack()[0]?.key ?? -1, {
      font: { name: 'Arial', size: 24, bold: false, italic: false, underline: false, strikeOut: false },
      color: 0,
    });
    await done;
    expect(app.ctx.settings.get().sim.printerFont).toEqual({ name: 'Arial', size: 24 });
    expect(printerChanges()).toBe(1);
  });

  it('Cancel in a font dialog changes nothing', async () => {
    const { app, stack, fonts } = build();
    const before = app.ctx.settings.get().sim;
    const done = app.ctx.commands.run('sim.options.outputFont');
    await tick();
    app.dialogs.close(stack()[0]?.key ?? -1, null);
    await done;
    expect(app.ctx.settings.get().sim).toEqual(before);
    expect(fonts).toEqual([]);
  });
});
