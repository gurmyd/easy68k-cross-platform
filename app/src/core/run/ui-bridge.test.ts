// SimUiBridge, the `main` host part (ARCHITECTURE.md 3.3.1, 3.3.2, 4.5.2, 4.6): host calls only
// record; the controller takes what was recorded afterwards.

import { describe, expect, it } from 'vitest';
import { FontSource, FontTarget, RepaintBit, type ControllerRequest } from '../../contracts';
import { HOST_PART_DEFAULTS } from '../../engine/sim';
import { VirtualTime } from './clock';
import { TimerSet } from './timers';
import { SimUiBridge, type UiBridgeDeps } from './ui-bridge';

const bytes = (text: string) => Uint8Array.from(text, (ch) => ch.charCodeAt(0));

function make(overrides: Partial<UiBridgeDeps> = {}, start?: Date) {
  const time = new VirtualTime(start);
  const timers = new TimerSet(time);
  const posted: ControllerRequest[] = [];
  const effects: string[] = [];
  let interval = 200;
  const bridge = new SimUiBridge({
    clock: time,
    timers,
    post: (request) => posted.push(request),
    autoTraceIntervalMs: () => interval,
    optionChanged: (option, value) => effects.push(`${option}=${value}`),
    saveSettings: () => effects.push('saveSettings'),
    focusMain: () => effects.push('focusMain'),
    textFontAssign: (target, source) => effects.push(`text.fontAssign(${target},${source})`),
    printerFontChanged: () => effects.push('printer.fontChanged'),
    ...overrides,
  });
  return {
    time,
    timers,
    posted,
    effects,
    bridge,
    setInterval: (ms: number) => {
      interval = ms;
    },
    /** Moves the time, checking the timers at every frame as the controller does. */
    run(ms: number) {
      for (let t = 0; t < ms; t += 16) {
        time.advance(16);
        timers.check(time.now());
      }
    },
  };
}

describe('SimUiBridge', () => {
  it('has exactly the methods of the main host part', () => {
    const { bridge } = make();
    for (const name of Object.keys(HOST_PART_DEFAULTS.main)) {
      expect((bridge as unknown as Record<string, unknown>)[name], name).toBeTypeOf('function');
    }
  });

  it('collects the message area, decoded from Windows-1252', () => {
    const { bridge } = make();
    expect(bridge.state.messageLines).toEqual([]);
    bridge.message(bytes('S0 = 68KPROG   20CREATED BY EASY68K'));
    bridge.message(Uint8Array.of(0x80, 0x20, 0xe9)); // euro sign, space, e acute
    expect(bridge.state.messageLines).toEqual(['S0 = 68KPROG   20CREATED BY EASY68K', '€ é']);
    bridge.messagesClear();
    expect(bridge.state.messageLines).toEqual([]);
    bridge.addMessage('a line of the port');
    expect(bridge.state.messageLines).toEqual(['a line of the port']);
  });

  it('hands out the same line array until the message area changes', () => {
    const { bridge } = make();
    bridge.message(bytes('one'));
    const first = bridge.state.messageLines;
    expect(bridge.state.messageLines).toBe(first);
    bridge.message(bytes('two'));
    expect(bridge.state.messageLines).not.toBe(first);
    expect(first).toEqual(['one']); // an array once handed out is never changed
  });

  it('records registersShown, repaint bits, live paints and boxes for the controller to take once', () => {
    const { bridge } = make();
    expect([bridge.takeRegistersShown(), bridge.takeRepaint(), bridge.takeLive(), bridge.takeAlerts()]).toEqual([
      false,
      0,
      false,
      [],
    ]);
    bridge.registersShown();
    bridge.registersShown();
    bridge.repaint(RepaintBit.Listing);
    bridge.repaint(RepaintBit.Stack | RepaintBit.Memory);
    bridge.memoryLivePaint(0x1000);
    bridge.alert(bytes('Information'), bytes('Current Log Stopped.'));
    bridge.alert(bytes('Error'), bytes('Breakpoint Limit Reached!'));
    expect(bridge.takeRegistersShown()).toBe(true);
    expect(bridge.takeRepaint()).toBe(RepaintBit.Listing | RepaintBit.Stack | RepaintBit.Memory);
    expect(bridge.takeLive()).toBe(true);
    expect(bridge.takeAlerts()).toEqual([
      { title: 'Information', text: 'Current Log Stopped.' },
      { title: 'Error', text: 'Breakpoint Limit Reached!' },
    ]);
    expect([bridge.takeRegistersShown(), bridge.takeRepaint(), bridge.takeLive(), bridge.takeAlerts()]).toEqual([
      false,
      0,
      false,
      [],
    ]);
  });

  it('mirrors the command state, key commands and the caption, and says when something changed', () => {
    const { bridge } = make();
    bridge.takeChanged();
    bridge.menuState(1);
    expect(bridge.state.menuState).toBe(1);
    expect(bridge.takeChanged()).toBe(true);
    bridge.menuState(1);
    expect(bridge.takeChanged()).toBe(false);
    bridge.forceMenuActive();
    expect(bridge.state.menuState).toBe(0);
    bridge.keyCommands(false);
    expect(bridge.state.keyCommands).toBe(false);
    bridge.caption(bytes('/browser/demo/prog.S68'));
    expect(bridge.state.caption).toBe('/browser/demo/prog.S68');
    expect(bridge.takeChanged()).toBe(true);
  });

  it('keeps effects outside the simulator back until the controller flushes them', () => {
    const { bridge, effects } = make();
    bridge.focusMain();
    bridge.optionChanged(0, 1);
    bridge.optionChanged(1, 0);
    bridge.optionChanged(7, 1); // not an option the settings hold
    bridge.saveSettings();
    expect(effects).toEqual([]);
    bridge.flushEffects();
    expect(effects).toEqual(['focusMain', 'exceptions=true', 'bitField=false', 'saveSettings']);
    bridge.flushEffects();
    expect(effects).toHaveLength(4);
  });

  it('forwards font targets 1 and 2 to the text screen and 6 to the printer, at once; 3 to 5 are CSS', () => {
    const { bridge, effects } = make();
    bridge.fontAssign(FontTarget.IoBackBuffer, FontSource.IoDialog);
    bridge.fontAssign(FontTarget.IoWindow, FontSource.IoDialog);
    bridge.fontAssign(FontTarget.Listing, FontSource.ListingDialog);
    bridge.fontAssign(FontTarget.Headings, FontSource.ListingDialog);
    bridge.fontAssign(FontTarget.Messages, FontSource.ListingDialog);
    bridge.fontAssign(FontTarget.Printer, FontSource.PrinterDialog);
    expect(effects).toEqual(['text.fontAssign(1,101)', 'text.fontAssign(2,101)', 'printer.fontChanged']);
  });

  it('tells the time of day in hundredths of a second, local time (task 8)', () => {
    const { bridge, time } = make({}, new Date(2026, 10, 20, 13, 7, 46, 129));
    expect(bridge.timeCentiseconds()).toBe(13 * 360000 + 7 * 6000 + 46 * 100 + 12);
    time.advance(1000);
    expect(bridge.timeCentiseconds()).toBe(13 * 360000 + 7 * 6000 + 47 * 100 + 12);
    const midnight = make({}, new Date(2026, 10, 20, 23, 59, 59, 990));
    midnight.time.advance(10);
    expect(midnight.bridge.timeCentiseconds()).toBe(0);
  });

  it('runs the auto-trace timer at the interval of the settings while the engine has it on', () => {
    const m = make();
    m.bridge.autoTraceTimer(true);
    expect(m.bridge.state.autoTrace).toBe(true);
    m.run(1000);
    expect(m.posted.length).toBeGreaterThanOrEqual(4);
    expect(m.posted.every((request) => request.kind === 'autoTraceTick')).toBe(true);
    m.bridge.autoTraceTimer(false);
    expect(m.bridge.state.autoTrace).toBe(false);
    const before = m.posted.length;
    m.run(1000);
    expect(m.posted).toHaveLength(before);
    // The interval is read when the timer is switched on.
    m.setInterval(10);
    m.bridge.autoTraceTimer(true);
    m.run(160);
    expect(m.posted.length - before).toBe(10); // every frame: 10 ms is below the frame time
  });

  it('resetToStartup(): message area empty, commands active, nothing pending, timer off', () => {
    const m = make();
    const { bridge } = m;
    bridge.message(bytes('line'));
    bridge.menuState(1);
    bridge.keyCommands(false);
    bridge.caption(bytes('prog.S68'));
    bridge.autoTraceTimer(true);
    bridge.registersShown();
    bridge.repaint(15);
    bridge.memoryLivePaint(0);
    bridge.alert(bytes('t'), bytes('x'));
    bridge.focusMain();
    bridge.resetToStartup();
    expect(bridge.state).toEqual({
      messageLines: [],
      menuState: 0,
      autoTrace: false,
      keyCommands: true,
      caption: null,
    });
    expect([bridge.takeRegistersShown(), bridge.takeRepaint(), bridge.takeLive(), bridge.takeAlerts()]).toEqual([
      false,
      0,
      false,
      [],
    ]);
    bridge.flushEffects();
    expect(m.effects).toEqual([]);
    m.run(1000);
    expect(m.posted).toEqual([]);
    expect(bridge.takeChanged()).toBe(true);
  });
});
