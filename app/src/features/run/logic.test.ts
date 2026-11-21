// The plain logic of the run feature: the store mirror, the status bar texts, the Execution Speed
// dialog, the alert presenter, and start-up file names.

import { describe, expect, it } from 'vitest';
import type { AppState, PendingAlert } from '../../contracts';
import { DEFAULT_SETTINGS } from '../../core/settings/defaults';
import { initialAppState } from '../../state/store';
import { presentAlerts } from './alerts';
import { mirrorSim, type SimLiveState } from './mirror';
import { displayPath } from './session';
import { MAX_CUSTOM_IPS, parseCustomRate, speedFromDialog, speedNote } from './speed';
import { isSRecordName, startupPath } from './startup';
import { runStateText, speedText, statusCells } from './status';

const sim0 = (): AppState['sim'] => initialAppState(DEFAULT_SETTINGS).sim;

const live = (overrides: Partial<SimLiveState> = {}): SimLiveState => ({
  phase: 'idle',
  program: null,
  menuState: 0,
  halted: false,
  autoTrace: false,
  keyCommands: true,
  logging: false,
  regsRevision: 0,
  viewRevision: 0,
  repaint: { listing: 0, breakpoints: 0, memory: 0, stack: 0 },
  liveRevision: 0,
  messageLines: [],
  breakpoints: [],
  output: { width: 640, height: 480, fullScreen: false, textWrap: false },
  ...overrides,
});

describe('mirrorSim', () => {
  it('returns the same object when the simulator says nothing new', () => {
    // The store starts without the per-panel repaint counters (an optional member); the first
    // mirror adds them, and from then on equal values are no news.
    const sim = mirrorSim(sim0(), live());
    expect(sim.repaint).toEqual({ listing: 0, breakpoints: 0, memory: 0, stack: 0 });
    expect(mirrorSim(sim, live())).toBe(sim);
    // Equal values in new objects are not news either.
    const program = { path: '/browser/a.S68', title: 'a.S68', hasListing: true };
    const loaded = mirrorSim(sim, live({ program, breakpoints: [0x1000], messageLines: ['x'] }));
    expect(loaded).not.toBe(sim);
    expect(mirrorSim(loaded, live({ program: { ...program }, breakpoints: [0x1000], messageLines: ['x'] }))).toBe(
      loaded,
    );
  });

  it('copies every mirrored member', () => {
    const next = mirrorSim(
      sim0(),
      live({
        phase: 'waitInput',
        program: { path: '/browser/a.S68', title: 'A', hasListing: false },
        menuState: 1,
        halted: true,
        autoTrace: true,
        keyCommands: false,
        logging: true,
        regsRevision: 3,
        viewRevision: 4,
        repaint: { listing: 4, breakpoints: 1, memory: 3, stack: 2 },
        liveRevision: 5,
        messageLines: ['one', 'two'],
        breakpoints: [0x1000, 0x1004],
        output: { width: 800, height: 600, fullScreen: true, textWrap: true },
      }),
    );
    expect(next).toEqual({
      phase: 'waitInput',
      program: { path: '/browser/a.S68', title: 'A', hasListing: false },
      menuState: 1,
      halted: true,
      autoTrace: true,
      keyCommands: false,
      logging: true,
      regsRevision: 3,
      viewRevision: 4,
      liveRevision: 5,
      selectedRow: -1,
      messageLines: ['one', 'two'],
      breakpoints: [0x1000, 0x1004],
      output: { width: 800, height: 600, fullScreen: true, textWrap: true },
      repaint: { listing: 4, breakpoints: 1, memory: 3, stack: 2 },
    });
  });

  it('carries the repaint counters by panel and keeps the object while they stand still', () => {
    const counts = { listing: 1, breakpoints: 0, memory: 1, stack: 1 };
    const first = mirrorSim(sim0(), live({ viewRevision: 1, repaint: counts }));
    expect(first.repaint).toEqual(counts);
    expect(first.repaint).not.toBe(counts); // the store never shares an object with the simulator
    const second = mirrorSim(first, live({ viewRevision: 1, repaint: { ...counts }, regsRevision: 1 }));
    expect(second.repaint).toBe(first.repaint);
    // A breakpoint toggle names the listing and the Break Points panel, not the Stack panel.
    const third = mirrorSim(second, live({ viewRevision: 2, repaint: { ...counts, listing: 2, breakpoints: 1 } }));
    expect(third.repaint).toEqual({ listing: 2, breakpoints: 1, memory: 1, stack: 1 });
  });

  it('carries stackRedraw and takes a change of it alone as news', () => {
    const counts = { listing: 1, breakpoints: 0, memory: 1, stack: 1, stackRedraw: 1 };
    const first = mirrorSim(sim0(), live({ repaint: counts }));
    expect(first.repaint).toEqual(counts);
    expect(mirrorSim(first, live({ repaint: { ...counts } }))).toBe(first);
    const clicked = mirrorSim(first, live({ repaint: { ...counts, stack: 2, stackRedraw: 2 } }));
    expect(clicked.repaint).toEqual({ ...counts, stack: 2, stackRedraw: 2 });
    expect(mirrorSim(clicked, live({ repaint: { ...counts, stack: 2, stackRedraw: 3 } })).repaint?.stackRedraw).toBe(3);
  });

  it('leaves the listing selection to the Listing panel', () => {
    const sim = { ...sim0(), selectedRow: 12 };
    expect(mirrorSim(sim, live({ regsRevision: 1 })).selectedRow).toBe(12);
  });

  it('keeps the arrays of the store when their contents are equal, and copies the live ones otherwise', () => {
    const lines = ['a'];
    const first = mirrorSim(sim0(), live({ messageLines: lines }));
    expect(first.messageLines).toEqual(['a']);
    expect(first.messageLines).not.toBe(lines); // the store never shares an array with the simulator
    const second = mirrorSim(first, live({ messageLines: ['a'], regsRevision: 1 }));
    expect(second.messageLines).toBe(first.messageLines);
    expect(second.output).toBe(first.output);
  });
});

describe('status bar texts', () => {
  it('names the run state', () => {
    const state = (phase: AppState['sim']['phase'], halted = false, autoTrace = false) =>
      runStateText({ phase, halted, autoTrace });
    expect(state('loading')).toBe('Loading');
    expect(state('running')).toBe('Running');
    expect(state('waitDelay')).toBe('Running');
    expect(state('waitInput')).toBe('Waiting for input');
    expect(state('waitHost')).toBe('Waiting');
    expect(state('waitAlert')).toBe('Waiting');
    expect(state('idle')).toBe('Stopped');
    expect(state('idle', true)).toBe('Halted');
    expect(state('idle', false, true)).toBe('Auto trace');
    expect(state('running', false, true)).toBe('Running');
  });

  it('says Halted only while the halt keeps the commands busy (integration scenario, wave 1)', () => {
    // The engine's halt flag stays set after Rewind, Open and Pause (sim-ui §9.9), which put the
    // commands back into the active state (sim-ui §3.6): Run is enabled, so the program is not
    // halted any more as far as the user can tell.
    const text = (halted: boolean, menuState: 0 | 1) =>
      runStateText({ phase: 'idle', halted, autoTrace: false, menuState });
    expect(text(true, 1)).toBe('Halted'); // SIMHALT: everything but Pause, Rewind and Reload disabled
    expect(text(true, 0)).toBe('Stopped'); // after Rewind, Open or Pause
    expect(text(false, 0)).toBe('Stopped');
    expect(text(false, 1)).toBe('Stopped'); // busy without a halt: Running in practice, never Halted
    const state = initialAppState(DEFAULT_SETTINGS);
    expect(statusCells({ ...state, sim: { ...state.sim, halted: true, menuState: 0 } }, '00001000').run).toBe(
      'Stopped',
    );
    expect(statusCells({ ...state, sim: { ...state.sim, halted: true, menuState: 1 } }, '00001008').run).toBe('Halted');
  });

  it('names the speed setting', () => {
    expect(speedText({ mode: 'original', instructionsPerSecond: 5 })).toBe('EASy68K-like');
    expect(speedText({ mode: 'max', instructionsPerSecond: 5 })).toBe('Maximum');
    expect(speedText({ mode: 'custom', instructionsPerSecond: 250000 })).toBe('250,000 instructions/s');
  });

  it('builds the five cells of 2.3', () => {
    const state = initialAppState(DEFAULT_SETTINGS);
    expect(Object.values(statusCells(state, '00001004')).join('   ')).toBe(
      'Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off',
    );
    const changed: AppState = {
      ...state,
      sim: { ...state.sim, phase: 'running' },
      settings: {
        ...state.settings,
        sim: {
          ...state.settings.sim,
          exceptions: true,
          bitField: true,
          speed: { mode: 'max', instructionsPerSecond: 1 },
        },
      },
    };
    expect(statusCells(changed, '00002000')).toEqual({
      run: 'Running',
      pc: 'PC=00002000',
      speed: 'speed: Maximum',
      exceptions: 'exceptions on',
      bitField: 'bit field on',
    });
  });
});

describe('Execution Speed dialog', () => {
  const previous = { mode: 'original', instructionsPerSecond: 1_000_000 } as const;

  it('reads the custom rate: a whole number in range, thousands separators allowed', () => {
    expect(parseCustomRate('250000')).toBe(250000);
    expect(parseCustomRate(' 1,000,000 ')).toBe(1_000_000);
    expect(parseCustomRate('1')).toBe(1);
    expect(parseCustomRate(String(MAX_CUSTOM_IPS))).toBe(MAX_CUSTOM_IPS);
    for (const bad of ['', '0', '-5', '1.5', 'fast', '1e6', String(MAX_CUSTOM_IPS + 1), '99999999999']) {
      expect(parseCustomRate(bad), bad).toBeNull();
    }
  });

  it('returns the setting for OK, keeping the stored rate for the two fixed choices', () => {
    expect(speedFromDialog('original', 'nonsense', previous)).toEqual({
      mode: 'original',
      instructionsPerSecond: 1_000_000,
    });
    expect(speedFromDialog('max', '5', previous)).toEqual({ mode: 'max', instructionsPerSecond: 1_000_000 });
    expect(speedFromDialog('custom', '5000', previous)).toEqual({ mode: 'custom', instructionsPerSecond: 5000 });
    expect(speedFromDialog('custom', 'x', previous)).toBeNull();
  });

  it('explains each choice', () => {
    expect(speedNote('original')).toContain('1,000,000 instructions per second');
    expect(speedNote('max')).toContain('Delay loops finish almost at once');
    expect(speedNote('custom')).toContain('fixed number');
  });
});

describe('start-up file names', () => {
  it('knows an .S68 name in any letter case', () => {
    expect(isSRecordName('/browser/demo/prog.S68')).toBe(true);
    expect(isSRecordName('C:\\work\\PROG.s68')).toBe(true);
    expect(isSRecordName('prog.X68')).toBe(false);
    expect(isSRecordName('prog.S68.txt')).toBe(false);
    expect(isSRecordName('S68')).toBe(false);
  });

  it('turns a start-up file into a virtual path', () => {
    expect(startupPath('/browser/demo/prog.S68', 'web')).toBe('/browser/demo/prog.S68');
    expect(startupPath('prog.S68', 'web')).toBeNull(); // only paths of the store can be opened by URL
    expect(startupPath('/Users/me/demo/prog.S68', 'desktop')).toBe('/disk/Users/me/demo/prog.S68');
    expect(startupPath('/disk/Users/me/prog.S68', 'desktop')).toBe('/disk/Users/me/prog.S68');
    expect(startupPath('/Users/me/../prog.S68', 'desktop')).toBeNull();
  });

  it('shows a disk file by its real path and other files by their virtual path', () => {
    expect(displayPath('/disk/Users/me/demo/prog.S68')).toBe('/Users/me/demo/prog.S68');
    expect(displayPath('/browser/demo/prog.S68')).toBe('/browser/demo/prog.S68');
    expect(displayPath('/disk')).toBe('/');
    expect(displayPath('/diskette/prog.S68')).toBe('/diskette/prog.S68');
  });
});

describe('presentAlerts', () => {
  /** A controller with a list of boxes, and message boxes that a test closes by hand. */
  function setup() {
    let alerts: PendingAlert[] = [];
    const listeners = new Set<() => void>();
    const open: { title: string; text: string; close: () => void }[] = [];
    const dismissed: number[] = [];
    const controller = {
      get alerts() {
        return alerts;
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      dismissAlerts() {
        dismissed.push(alerts.length);
        alerts = [];
      },
    };
    const dialogs = {
      messageBox: (request: { title: string; text: string; buttons: string[]; icon: string }, options?: object) =>
        new Promise<string>((resolve) => {
          expect(request.buttons).toEqual(['OK']);
          expect(request.icon).toBe('none');
          expect(options).toEqual({ holdsProgram: false });
          open.push({ title: request.title, text: request.text, close: () => resolve('OK') });
        }),
    };
    const raise = (...boxes: PendingAlert[]) => {
      alerts = [...alerts, ...boxes];
      for (const listener of [...listeners]) listener();
    };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    return { controller, dialogs, open, dismissed, raise, settle, clear: () => (alerts = []) };
  }

  it('shows a box and dismisses when the user has closed it', async () => {
    const t = setup();
    presentAlerts(t);
    t.raise({ title: 'Information', text: 'Current Log Stopped.' });
    await t.settle();
    expect(t.open.map((box) => `${box.title}: ${box.text}`)).toEqual(['Information: Current Log Stopped.']);
    expect(t.dismissed).toEqual([]);
    t.open[0]?.close();
    await t.settle();
    expect(t.dismissed).toEqual([1]);
  });

  it('shows several boxes one after the other, oldest first, and dismisses once', async () => {
    const t = setup();
    presentAlerts(t);
    t.raise({ title: 'Error', text: 'first' }, { title: 'Error', text: 'second' });
    await t.settle();
    expect(t.open).toHaveLength(1);
    t.raise({ title: 'Error', text: 'third' }); // arrives while the first is open
    t.open[0]?.close();
    await t.settle();
    expect(t.open.map((box) => box.text)).toEqual(['first', 'second']);
    t.open[1]?.close();
    await t.settle();
    t.open[2]?.close();
    await t.settle();
    expect(t.open.map((box) => box.text)).toEqual(['first', 'second', 'third']);
    expect(t.dismissed).toEqual([3]);
  });

  it('does not dismiss a box the user has not seen', async () => {
    const t = setup();
    presentAlerts(t);
    t.raise({ title: 'Error', text: 'old' });
    await t.settle();
    // The simulator was restarted meanwhile: the old box is gone from the list, a new one came.
    t.clear();
    t.raise({ title: 'Error', text: 'new' });
    t.open[0]?.close();
    await t.settle();
    expect(t.dismissed).toEqual([]); // the new box is shown first
    expect(t.open.map((box) => box.text)).toEqual(['old', 'new']);
    t.open[1]?.close();
    await t.settle();
    expect(t.dismissed).toEqual([1]);
  });

  it('shows boxes that are already there when it starts, and stops when told', async () => {
    const t = setup();
    t.raise({ title: 'Error', text: 'early' });
    const stop = presentAlerts(t);
    await t.settle();
    expect(t.open).toHaveLength(1);
    stop();
    t.open[0]?.close();
    await t.settle();
    t.raise({ title: 'Error', text: 'late' });
    await t.settle();
    expect(t.open).toHaveLength(1);
    expect(t.dismissed).toEqual([]);
  });
});
