// SettingsService (ARCHITECTURE.md 3.10, 3.8.6 rule 2; W3 acceptance: "settings survive two
// instances writing in turn, and a storage event updates a running instance; panel layout and
// settings persist").

import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../contracts';
import { DEFAULT_SETTINGS } from './defaults';
import {
  MemorySettingsStorage,
  SETTINGS_KEY,
  SETTING_CHOICES,
  createSettingsService,
  mergeWithDefaults,
  parseSettings,
  type SettingsStorage,
} from './service';

// ---- The table SETTING_CHOICES against the contract, checked by the compiler (`npm run typecheck`).

/**
 * The paths of the settings in `T` whose type is a fixed list of values, such as 'fit' | 1 | 2:
 * `app.layout.outputZoom`. A setting that is any string, any number or a boolean is not one, and
 * neither is a table with free keys (`panels`, `splits`).
 */
type ChoicePath<T, Prefix extends string = ''> = {
  [Key in keyof T & string]: string extends Key
    ? never // a Record<string, ...>: its keys are data, not settings
    : T[Key] extends string | number
      ? string extends T[Key]
        ? never // any string
        : number extends T[Key]
          ? never // any number
          : `${Prefix}${Key}`
      : T[Key] extends boolean | readonly unknown[]
        ? never
        : ChoicePath<T[Key], `${Prefix}${Key}.`>;
}[keyof T & string];

/** The type of the setting at a path: ValueAt<Settings, 'app.theme'> is 'system' | 'light' | 'dark'. */
type ValueAt<T, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ValueAt<T[Head], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ListedPath = keyof typeof SETTING_CHOICES;
/** `version` is a fixed value too, but parseSettings sets it itself. */
type ContractPath = Exclude<ChoicePath<Settings>, 'version'>;

/** For each listed setting: does the list hold exactly the values of the contract? */
type ListsAreComplete = {
  [Path in ListedPath]: Same<(typeof SETTING_CHOICES)[Path][number], ValueAt<Settings, Path>>;
}[ListedPath];

// Each line fails to compile ("Type 'true' is not assignable to type 'false'") when the table and
// the contract disagree.
const everyChoiceSettingIsListed: Same<ListedPath, ContractPath> = true;
const everyListIsComplete: Same<ListsAreComplete, true> = true;

const setFontSize = (size: number) => (s: Settings) => ({ ...s, editor: { ...s.editor, fontSize: size } });
const setExceptions = (on: boolean) => (s: Settings) => ({ ...s, sim: { ...s.sim, exceptions: on } });
const setPanel = (id: string, visible: boolean) => (s: Settings) => ({
  ...s,
  app: { ...s.app, layout: { ...s.app.layout, panels: { ...s.app.layout.panels, [id]: { visible } } } },
});

describe('the stored document', () => {
  it('uses the key of 3.10', () => {
    expect(SETTINGS_KEY).toBe('easy68k.settings.v1');
  });

  it('gives the defaults when nothing is stored, and for text that is not a JSON object', () => {
    expect(parseSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json').settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]').settings).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null').settings).toEqual(DEFAULT_SETTINGS);
  });

  it('fills missing keys with defaults and keeps keys it does not know, at every level', () => {
    const stored = {
      version: 1,
      editor: { fontSize: 14, futureEditorKey: 'kept' },
      futureSection: { a: [1, 2, 3] },
      app: { layout: { panels: { memory: { visible: true, futureFlag: 7 } } } },
    };
    const { settings } = parseSettings(JSON.stringify(stored));
    expect(settings.editor.fontSize).toBe(14);
    expect(settings.editor.fontName).toBe(DEFAULT_SETTINGS.editor.fontName);
    expect(settings.sim).toEqual(DEFAULT_SETTINGS.sim);
    expect((settings.editor as unknown as Record<string, unknown>).futureEditorKey).toBe('kept');
    expect((settings as unknown as Record<string, unknown>).futureSection).toEqual({ a: [1, 2, 3] });
    expect(settings.app.layout.panels.memory).toEqual({ visible: true, futureFlag: 7 });
    expect(settings.app.layout.outputZoom).toBe('fit');
  });

  it('treats a value of the wrong type as missing', () => {
    const { settings } = parseSettings(
      JSON.stringify({ editor: { fontSize: 'big', autoIndent: 0, styles: 'none' }, sim: 5, app: { theme: 3 } }),
    );
    expect(settings.editor.fontSize).toBe(DEFAULT_SETTINGS.editor.fontSize);
    expect(settings.editor.autoIndent).toBe(DEFAULT_SETTINGS.editor.autoIndent);
    expect(settings.editor.styles).toEqual(DEFAULT_SETTINGS.editor.styles);
    expect(settings.sim).toEqual(DEFAULT_SETTINGS.sim);
    expect(settings.app.theme).toBe('system');
  });

  it('never returns the frozen defaults themselves', () => {
    const { settings } = parseSettings(null);
    expect(Object.isFrozen(settings.editor)).toBe(false);
    expect(settings.editor.styles.code).not.toBe(DEFAULT_SETTINGS.editor.styles.code);
  });

  it('mergeWithDefaults does not mistake an array for an object', () => {
    expect(mergeWithDefaults({ a: { b: 1 } }, { a: [1] })).toEqual({ a: { b: 1 } });
    expect(mergeWithDefaults({ a: 1 }, [1, 2])).toEqual({ a: 1 });
  });

  it('mergeWithDefaults keeps a listed value of any type, and only a listed value', () => {
    const defaults = { zoom: 'fit', nested: { mode: 'a' }, size: 10 };
    const choices = new Map<string, readonly (string | number)[]>([
      ['zoom', ['fit', 1, 2]],
      ['nested.mode', ['a', 'b']],
    ]);
    expect(mergeWithDefaults(defaults, { zoom: 2, nested: { mode: 'b' }, size: 12 }, choices)).toEqual({
      zoom: 2,
      nested: { mode: 'b' },
      size: 12,
    });
    expect(mergeWithDefaults(defaults, { zoom: 3, nested: { mode: 'c' }, size: '12' }, choices)).toEqual(defaults);
    // A path is the whole way from the top: `mode` at the top level is not `nested.mode`.
    expect(mergeWithDefaults({ mode: 'a' }, { mode: 'z' }, choices)).toEqual({ mode: 'z' });
  });
});

/** `settings` with `value` at a path such as `app.layout.outputZoom`. */
function withValueAt(settings: Settings, path: string, value: unknown): Settings {
  const copy = structuredClone(settings) as unknown as Record<string, unknown>;
  const keys = path.split('.');
  let node = copy;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[keys.at(-1) ?? ''] = value;
  return copy as unknown as Settings;
}

function valueAt(document: unknown, path: string): unknown {
  return path.split('.').reduce((node, key) => (node as Record<string, unknown>)[key], document);
}

describe('settings with a fixed list of values (3.10)', () => {
  /** Typed from ARCHITECTURE.md 3.10; `tabType` is TabType of 3.2 (0 Assembly, 1 Fixed). */
  const LEGAL_VALUES: Record<string, (string | number)[]> = {
    'editor.tabType': [0, 1],
    'editor.colorPreset': [-1, 0, 1, 2, 3, 4, 5],
    'sim.execLogType': [0, 1, 2, 3],
    'sim.outputLogType': [0, 1],
    'sim.speed.mode': ['original', 'max', 'custom'],
    'app.theme': ['system', 'light', 'dark'],
    'app.layout.editorPanes': ['one', 'horizontal', 'vertical'],
    'app.layout.outputZoom': ['fit', 1, 2],
  };
  const EVERY_LEGAL_VALUE = Object.entries(LEGAL_VALUES).flatMap(([path, values]) =>
    values.map((value) => [path, value] as const),
  );

  it('SETTING_CHOICES lists every such setting of the contract with every value', () => {
    // The two constants are checked by the compiler, at the top of this file.
    expect(everyChoiceSettingIsListed && everyListIsComplete).toBe(true);
    expect(SETTING_CHOICES).toEqual(LEGAL_VALUES);
  });

  it('every default is on its list', () => {
    for (const [path, values] of Object.entries(SETTING_CHOICES)) {
      expect(values, path).toContain(valueAt(DEFAULT_SETTINGS, path));
    }
  });

  it.each(EVERY_LEGAL_VALUE)('%s = %j is stored and read back by a new instance', (path, value) => {
    const storage = new MemorySettingsStorage();
    createSettingsService(storage.window()).update((settings) => withValueAt(settings, path, value));
    expect(valueAt(JSON.parse(storage.text ?? ''), path)).toBe(value);
    expect(valueAt(createSettingsService(storage.window()).get(), path)).toBe(value);
  });

  it('the Output zoom 1 and 2 are numbers although the default is the text "fit"', () => {
    for (const zoom of [1, 2, 'fit'] as const) {
      const storage = new MemorySettingsStorage();
      const first = createSettingsService(storage.window());
      first.update((s) => ({ ...s, app: { ...s.app, layout: { ...s.app.layout, outputZoom: zoom } } }));
      expect(first.get().app.layout.outputZoom).toBe(zoom);
      expect(createSettingsService(storage.window()).get().app.layout.outputZoom).toBe(zoom);
    }
  });

  it.each([
    ['app.layout.outputZoom', 3],
    ['app.layout.outputZoom', '2'],
    ['app.layout.outputZoom', 'fill'],
    ['app.layout.outputZoom', null],
    ['app.layout.outputZoom', { scale: 2 }],
    ['app.layout.editorPanes', 'grid'],
    ['app.theme', 'blue'],
    ['app.theme', 1],
    ['editor.tabType', 2],
    ['editor.colorPreset', 6],
    ['editor.colorPreset', 1.5],
    ['sim.execLogType', 4],
    ['sim.outputLogType', -1],
    ['sim.speed.mode', 'fast'],
  ] as const)('a stored %s = %j is not on the list: the default takes its place', (path, value) => {
    const stored = JSON.stringify(withValueAt(structuredClone(DEFAULT_SETTINGS) as Settings, path, value));
    expect(valueAt(parseSettings(stored).settings, path)).toBe(valueAt(DEFAULT_SETTINGS, path));
  });
});

describe('one instance', () => {
  it('persists every update and a new instance reads it back', () => {
    const storage = new MemorySettingsStorage();
    const first = createSettingsService(storage.window());
    first.update(setFontSize(16));
    first.update(setExceptions(true));
    first.update(setPanel('memory', true));
    first.update((s) => ({ ...s, app: { ...s.app, theme: 'dark' } }));

    const second = createSettingsService(storage.window());
    expect(second.get().editor.fontSize).toBe(16);
    expect(second.get().sim.exceptions).toBe(true);
    expect(second.get().app.layout.panels.memory).toEqual({ visible: true });
    expect(second.get().app.theme).toBe('dark');
    expect(JSON.parse(storage.text ?? '').version).toBe(1);
  });

  it('notifies subscribers after the update, and not after unsubscribing', () => {
    const service = createSettingsService(new MemorySettingsStorage().window());
    const seen: number[] = [];
    const stop = service.subscribe(() => seen.push(service.get().editor.fontSize));
    service.update(setFontSize(11));
    stop();
    service.update(setFontSize(12));
    expect(seen).toEqual([11]);
  });

  it('writes unknown keys back', () => {
    const storage = new MemorySettingsStorage(JSON.stringify({ version: 1, editor: { extra: 'x' }, later: true }));
    const service = createSettingsService(storage.window());
    service.update(setFontSize(9));
    const written = JSON.parse(storage.text ?? '');
    expect(written.editor.extra).toBe('x');
    expect(written.later).toBe(true);
    expect(written.editor.fontSize).toBe(9);
  });

  it('keeps the version number of a document written by a newer version of the port', () => {
    const storage = new MemorySettingsStorage(JSON.stringify({ version: 3, editor: { fontSize: 20 } }));
    const service = createSettingsService(storage.window());
    expect(service.get().version).toBe(1);
    expect(service.get().editor.fontSize).toBe(20);
    service.update(setExceptions(true));
    expect(JSON.parse(storage.text ?? '').version).toBe(3);
  });

  it('keeps working in memory when the storage throws', () => {
    const errors: unknown[] = [];
    const broken: SettingsStorage = {
      read: () => {
        throw new Error('SecurityError');
      },
      write: () => {
        throw new Error('QuotaExceededError');
      },
      onExternalChange: () => () => {},
    };
    const service = createSettingsService(broken, (error) => errors.push(error));
    expect(service.get()).toEqual(DEFAULT_SETTINGS);
    service.update(setFontSize(18));
    expect(service.get().editor.fontSize).toBe(18);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('two windows on one storage (3.8.6 rule 2)', () => {
  it('writing in turn never loses the other window’s field, even without a storage event', () => {
    // A storage whose change events never arrive: each window only sees the other through update().
    let text: string | null = null;
    const silent = (): SettingsStorage => ({
      read: () => text,
      write: (next) => {
        text = next;
      },
      onExternalChange: () => () => {},
    });
    const a = createSettingsService(silent());
    const b = createSettingsService(silent());
    a.update(setFontSize(16));
    b.update(setExceptions(true));
    a.update((s) => ({ ...s, sim: { ...s.sim, bitField: true } }));
    b.update((s) => ({ ...s, editor: { ...s.editor, realTabs: true } }));

    const stored = parseSettings(text).settings;
    expect(stored.editor.fontSize).toBe(16);
    expect(stored.editor.realTabs).toBe(true);
    expect(stored.sim.exceptions).toBe(true);
    expect(stored.sim.bitField).toBe(true);
    // b's last update was based on the stored document, so b has caught up with a's fields.
    expect(b.get().editor.fontSize).toBe(16);
    expect(b.get().sim.bitField).toBe(true);
  });

  it('a storage event replaces the copy in memory and notifies', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window());
    const b = createSettingsService(storage.window());
    const notified = vi.fn();
    b.subscribe(notified);

    a.update(setFontSize(16));
    expect(b.get().editor.fontSize).toBe(16);
    expect(notified).toHaveBeenCalledTimes(1);

    a.update((s) => ({ ...s, app: { ...s.app, theme: 'dark' } }));
    expect(b.get().app.theme).toBe('dark');
    expect(notified).toHaveBeenCalledTimes(2);
  });

  it('does not notify for an event that changes nothing this window sees', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window());
    const b = createSettingsService(storage.window());
    const notified = vi.fn();
    b.subscribe(notified);
    a.update(setPanel('memory', true)); // only a's layout
    expect(notified).not.toHaveBeenCalled();
  });

  it('an open window keeps its own panel layout', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window());
    const b = createSettingsService(storage.window());

    a.update(setPanel('memory', true));
    expect(b.get().app.layout.panels.memory).toBeUndefined();

    // b changes a setting that is not layout: the stored layout stays a's, b's stays its own.
    b.update(setFontSize(12));
    expect(b.get().app.layout.panels.memory).toBeUndefined();
    expect(parseSettings(storage.text).settings.app.layout.panels.memory).toEqual({ visible: true });
    expect(a.get().app.layout.panels.memory).toEqual({ visible: true });
    expect(a.get().editor.fontSize).toBe(12);

    // b changes its layout: now b's layout is the stored one, and a still keeps its own.
    b.update(setPanel('stack', true));
    expect(parseSettings(storage.text).settings.app.layout.panels).toEqual({ stack: { visible: true } });
    expect(a.get().app.layout.panels).toEqual({ memory: { visible: true } });

    // A window that starts now takes the stored layout.
    const c = createSettingsService(storage.window());
    expect(c.get().app.layout.panels).toEqual({ stack: { visible: true } });
  });

  it('stops listening after dispose()', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window());
    const b = createSettingsService(storage.window());
    b.dispose();
    a.update(setFontSize(16));
    expect(b.get().editor.fontSize).toBe(DEFAULT_SETTINGS.editor.fontSize);
  });
});
