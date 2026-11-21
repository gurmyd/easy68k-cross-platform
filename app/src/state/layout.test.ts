// Panel layout rules (ARCHITECTURE.md 2.2-2.4, 3.10).

import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../core/settings/defaults';
import {
  MESSAGES_CLEAN,
  MESSAGES_INITIAL,
  MESSAGES_OPEN_MIN,
  PANEL_CYCLE,
  PANEL_IDS,
  PANEL_TITLES,
  SPLITS,
  TOOL_PANELS,
  defaultPanelVisible,
  isPanelVisible,
  messageListOf,
  messagesPaneHeight,
  splitFraction,
  splitPixels,
  withPanelVisible,
  withSplit,
} from './layout';

describe('panels', () => {
  it('are the eleven of section 2.4, each with a title', () => {
    expect(PANEL_IDS).toEqual([
      'registers',
      'listing',
      'messages',
      'output',
      'memory',
      'stack',
      'hardware',
      'breakpoints',
      'log',
      'files',
      'help',
    ]);
    for (const id of PANEL_IDS) expect(PANEL_TITLES[id]).toBeTruthy();
    expect(PANEL_TITLES.breakpoints).toBe('Break Points');
    expect(TOOL_PANELS).toEqual(['memory', 'stack', 'hardware', 'breakpoints', 'log']);
  });

  it('follow the window cycle of sim-ui §3.4, with Log last', () => {
    expect(PANEL_CYCLE).toEqual(['listing', 'output', 'memory', 'stack', 'hardware', 'breakpoints', 'log']);
  });

  it('visibility at start (2.4): main window and Output always; tools and Help hidden; Files in a browser only', () => {
    const settings = defaultSettings();
    for (const id of ['registers', 'listing', 'messages', 'output']) {
      expect(isPanelVisible(settings, id, 'web'), id).toBe(true);
      expect(isPanelVisible(settings, id, 'desktop'), id).toBe(true);
    }
    for (const id of ['memory', 'stack', 'hardware', 'breakpoints', 'log', 'help']) {
      expect(isPanelVisible(settings, id, 'web'), id).toBe(false);
    }
    expect(defaultPanelVisible('files', 'web')).toBe(true);
    expect(defaultPanelVisible('files', 'desktop')).toBe(false);
  });

  it('withPanelVisible stores the choice, keeps other keys, and returns the same object for no change', () => {
    const settings = defaultSettings();
    const shown = withPanelVisible(settings, 'memory', true);
    expect(isPanelVisible(shown, 'memory', 'web')).toBe(true);
    expect(isPanelVisible(shown, 'stack', 'web')).toBe(false);
    expect(settings.app.layout.panels).toEqual({});
    expect(withPanelVisible(shown, 'memory', true)).toBe(shown);

    const withExtra = {
      ...shown,
      app: { ...shown.app, layout: { ...shown.app.layout, panels: { memory: { visible: true, later: 1 } } } },
    };
    expect(withPanelVisible(withExtra, 'memory', false).app.layout.panels.memory).toEqual({ visible: false, later: 1 });

    // The Files panel can be hidden in a browser and shown in the desktop app.
    expect(isPanelVisible(withPanelVisible(settings, 'files', false), 'files', 'web')).toBe(false);
    expect(isPanelVisible(withPanelVisible(settings, 'files', true), 'files', 'desktop')).toBe(true);
  });

  it('the panels of the main window cannot be hidden', () => {
    const hidden = withPanelVisible(defaultSettings(), 'listing', false);
    expect(isPanelVisible(hidden, 'listing', 'web')).toBe(true);
  });

  it('a stored entry that is not { visible: true | false } counts as not stored', () => {
    // The settings store keeps the entries of `panels` as they were written (free keys).
    const settings = defaultSettings();
    for (const entry of [{ visible: 'no' }, { visible: 1 }, { visible: null }, {}, 'shown', 5, null]) {
      const stored = {
        ...settings,
        app: { ...settings.app, layout: { ...settings.app.layout, panels: { memory: entry, files: entry } } },
      } as unknown as typeof settings;
      expect(isPanelVisible(stored, 'memory', 'web'), JSON.stringify(entry)).toBe(false);
      expect(isPanelVisible(stored, 'files', 'web'), JSON.stringify(entry)).toBe(true);
    }
  });
});

describe('separators', () => {
  it('use the default fraction until one is stored, and ignore a stored value that is not a fraction', () => {
    const settings = defaultSettings();
    expect(splitFraction(settings, 'sim.columns')).toBe(SPLITS['sim.columns'].fraction);
    expect(splitFraction(withSplit(settings, 'sim.columns', 0.3), 'sim.columns')).toBe(0.3);
    const broken = {
      ...settings,
      app: { ...settings.app, layout: { ...settings.app.layout, splits: { 'sim.columns': 7 } } },
    };
    expect(splitFraction(broken, 'sim.columns')).toBe(0.5);
  });

  it('withSplit keeps the fraction inside 0..1 and returns the same object for no change', () => {
    const settings = defaultSettings();
    expect(withSplit(settings, 'sim.tools', 1.5).app.layout.splits['sim.tools']).toBe(0.98);
    expect(withSplit(settings, 'sim.tools', -1).app.layout.splits['sim.tools']).toBe(0.02);
    const once = withSplit(settings, 'sim.tools', 0.25);
    expect(withSplit(once, 'sim.tools', 0.25)).toBe(once);
  });

  it('splitPixels gives the size in px and keeps both panes usable', () => {
    const settings = withSplit(defaultSettings(), 'sim.columns', 0.5);
    expect(splitPixels(settings, 'sim.columns', 1400)).toEqual({ value: 700, min: 360, max: 1080, defaultValue: 700 });
    // A stored fraction that would squeeze the other pane is clamped, the default too.
    const wide = withSplit(defaultSettings(), 'sim.columns', 0.95);
    expect(splitPixels(wide, 'sim.columns', 1400).value).toBe(1080);
    const narrow = withSplit(defaultSettings(), 'sim.columns', 0.05);
    expect(splitPixels(narrow, 'sim.columns', 1400).value).toBe(360);
    // A container smaller than both minimums: the pane keeps its minimum.
    expect(splitPixels(settings, 'sim.columns', 500)).toMatchObject({ value: 360, min: 360, max: 360 });
    expect(splitPixels(settings, 'sim.columns', 0)).toMatchObject({ value: 0, min: 0, max: 0 });
  });
});

describe('the editor message list (editor-ui §7.3)', () => {
  it('is 5 px before the first assembly', () => {
    expect(MESSAGES_INITIAL).toBe(5);
    expect(messagesPaneHeight({ messageCount: 0, assembled: false, dragged: null })).toBe(5);
  });

  it('is at least 87 px when a message arrives', () => {
    expect(MESSAGES_OPEN_MIN).toBe(87);
    expect(messagesPaneHeight({ messageCount: 1, assembled: true, dragged: null })).toBe(87);
    expect(messagesPaneHeight({ messageCount: 3, assembled: true, dragged: 40 })).toBe(87);
    expect(messagesPaneHeight({ messageCount: 3, assembled: true, dragged: 200 })).toBe(200);
  });

  it('is 7 px after a clean assembly and after Clear Error Messages', () => {
    expect(MESSAGES_CLEAN).toBe(7);
    expect(messagesPaneHeight({ messageCount: 0, assembled: true, dragged: null })).toBe(7);
  });

  it('can be dragged open while empty, down to the 5 px minimum', () => {
    expect(messagesPaneHeight({ messageCount: 0, assembled: false, dragged: 120 })).toBe(120);
    expect(messagesPaneHeight({ messageCount: 0, assembled: true, dragged: 1 })).toBe(5);
  });
});

describe('messageListOf: the list of the active document, as the height rule sees it', () => {
  const height = (state: Parameters<typeof messageListOf>[0], id: string | null) => {
    const { count, assembled } = messageListOf(state, id);
    return messagesPaneHeight({ messageCount: count, assembled, dragged: null });
  };
  const row = { line: 3, text: 'Invalid syntax', severity: 'error', file: null } as never;
  const summary = { at: 1, errors: 0, warnings: 0 } as never;

  it('5 px for a document no assembly has touched, and with no document', () => {
    expect(height({ messages: {}, assemble: {} }, 'a')).toBe(5);
    expect(height({ messages: {}, assemble: {} }, null)).toBe(5);
  });

  it('7 px for the assembled document after a clean assembly or Clear Error Messages', () => {
    expect(height({ messages: { a: [] }, assemble: { a: summary } }, 'a')).toBe(7);
  });

  it("7 px for an include file's document after Clear Error Messages, without a summary of its own (errata E5.md 8)", () => {
    expect(height({ messages: { inc: [row] }, assemble: {} }, 'inc')).toBe(87);
    expect(height({ messages: { inc: [] }, assemble: {} }, 'inc')).toBe(7);
  });

  it('names the list so that a drag applies only until the list changes', () => {
    const before = messageListOf({ messages: { a: [row] }, assemble: { a: summary } }, 'a').list;
    const cleared = messageListOf({ messages: { a: [] }, assemble: { a: summary } }, 'a').list;
    expect(before).not.toBe(cleared);
  });
});
