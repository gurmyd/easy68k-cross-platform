// SettingsService (ARCHITECTURE.md 3.10, 3.8.6 rule 2; W3 acceptance: "settings survive two
// instances writing in turn, and a storage event updates a running instance; panel layout and
// settings persist").

import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../contracts';
import { DEFAULT_SETTINGS } from './defaults';
import {
  MemorySettingsStorage,
  OUTSIDE_MARK,
  OUTSIDE_WRITER_PREFIX,
  SETTINGS_KEY,
  SETTING_CHOICES,
  STAMPS_KEY,
  alignOutsideStamps,
  changedPaths,
  compareStamps,
  createSettingsService,
  mergeStamped,
  mergeWithDefaults,
  outsideWriter,
  parseSettings,
  settingPaths,
  type SettingsStorage,
  type SettingsStore,
  type Stamp,
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

// ---- Windows that see each other's writes late (errata W3 entry 26) ---------------------------

/**
 * A storage that behaves like localStorage in a browser: each window reads its own copy, and a
 * write by one window reaches the copies of the others, together with their `storage` event and
 * its `newValue`, only when the test delivers it. `text` is the shared store itself.
 */
class LateStorage {
  text: string | null = null;
  private readonly windows: {
    copy: string | null;
    queue: (string | null)[];
    listeners: Set<(text?: string | null) => void>;
  }[] = [];

  /** The storage as a new window sees it; its copy starts as the shared store is now. */
  window(): SettingsStorage {
    const self = {
      copy: this.text,
      queue: [] as (string | null)[],
      listeners: new Set<(text?: string | null) => void>(),
    };
    this.windows.push(self);
    return {
      read: () => self.copy,
      write: (text) => {
        self.copy = text;
        this.text = text;
        for (const other of this.windows) if (other !== self) other.queue.push(text);
      },
      onExternalChange: (listener) => {
        self.listeners.add(listener);
        return () => {
          self.listeners.delete(listener);
        };
      },
    };
  }

  /** Windows with writes of others not yet delivered. */
  pending(): number[] {
    return this.windows.flatMap((w, index) => (w.queue.length > 0 ? [index] : []));
  }

  /** Delivers the oldest write not yet delivered to window `index` (in the order windows were made). */
  deliverOne(index: number): void {
    const target = this.windows[index];
    if (!target || target.queue.length === 0) return;
    const text = target.queue.shift() as string | null;
    target.copy = text;
    for (const listener of [...target.listeners]) listener(text);
  }

  /** Delivers everything, including what deliveries cause; returns the number of deliveries. */
  deliverAll(limit = 10_000): number {
    let count = 0;
    for (let pending = this.pending(); pending.length > 0; pending = this.pending()) {
      for (const index of pending) {
        this.deliverOne(index);
        if (++count > limit) throw new Error('the windows keep writing');
      }
    }
    return count;
  }
}

const setBitField = (on: boolean) => (s: Settings) => ({ ...s, sim: { ...s.sim, bitField: on } });
const setRealTabs = (on: boolean) => (s: Settings) => ({ ...s, editor: { ...s.editor, realTabs: on } });

/** A clock the test moves; every window of a test shares it, as windows on one computer do. */
function testClock(start = 1_000) {
  let time = start;
  return { now: () => time, advance: (ms: number) => void (time += ms) };
}

describe('two windows that see each other late (3.8.6 rule 2; errata W3 entry 26)', () => {
  it('the interleaving of the shell check: B writes before A’s write has reached it', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });

    a.update(setFontSize(14));
    clock.advance(1);
    b.update(setBitField(true)); // B's copy does not hold the font size yet
    clock.advance(1);
    a.update(setRealTabs(true)); // nor A's the bit field
    // This is where reading again before writing used to stop: the store lacks B's change.
    expect(parseSettings(storage.text).settings.sim.bitField).toBe(false);

    storage.deliverAll();
    const stored = parseSettings(storage.text).settings;
    expect(stored.editor.fontSize).toBe(14);
    expect(stored.editor.realTabs).toBe(true);
    expect(stored.sim.bitField).toBe(true);
    for (const window of [a, b]) {
      expect(window.get().editor.fontSize).toBe(14);
      expect(window.get().editor.realTabs).toBe(true);
      expect(window.get().sim.bitField).toBe(true);
    }
  });

  it('changes to one setting end with the later change in every window and in the store', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(16));
    clock.advance(5);
    b.update(setFontSize(18)); // later, and without having seen 16
    storage.deliverAll();
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(18);
    expect(a.get().editor.fontSize).toBe(18);
    expect(b.get().editor.fontSize).toBe(18);

    // The later change wins also when its write reaches the store first.
    a.update(setFontSize(20));
    clock.advance(5);
    b.update(setFontSize(22));
    storage.deliverOne(0); // a hears 22 ...
    a.update(setRealTabs(true)); // ... and its next write keeps it
    storage.deliverAll();
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(22);
    expect(a.get().editor.fontSize).toBe(22);
    expect(b.get().editor.fontSize).toBe(22);
  });

  it('at the same millisecond every window picks the same change', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(16));
    b.update(setFontSize(18));
    storage.deliverAll();
    const stored = parseSettings(storage.text).settings.editor.fontSize;
    expect([16, 18]).toContain(stored);
    expect(a.get().editor.fontSize).toBe(stored);
    expect(b.get().editor.fontSize).toBe(stored);
  });

  it('a change made after another window’s change was seen is newer, whatever the clocks say', () => {
    const storage = new LateStorage();
    let timeA = 5_000;
    const a = createSettingsService(storage.window(), undefined, { now: () => timeA, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: () => 1_000, writerId: 'b' });
    a.update(setFontSize(16));
    storage.deliverAll();
    b.update(setFontSize(18)); // b's clock is behind, but b had seen 16
    timeA += 1;
    storage.deliverAll();
    expect(a.get().editor.fontSize).toBe(18);
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(18);
  });

  it('the window that wrote the stale document repairs it, also after the other window has closed', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(14));
    clock.advance(1);
    b.update(setBitField(true));
    a.dispose(); // a is gone; its write is still on its way to b
    storage.deliverAll();
    const stored = parseSettings(storage.text).settings;
    expect(stored.editor.fontSize).toBe(14);
    expect(stored.sim.bitField).toBe(true);
  });

  it('an open window keeps its layout, and a stale write keeps the stored layout', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setPanel('memory', true));
    clock.advance(1);
    b.update(setFontSize(12)); // b has not seen a's layout
    storage.deliverAll();
    expect(parseSettings(storage.text).settings.app.layout.panels).toEqual({ memory: { visible: true } });
    expect(b.get().app.layout.panels).toEqual({});
    expect(a.get().app.layout.panels).toEqual({ memory: { visible: true } });
    expect(a.get().editor.fontSize).toBe(12);
  });

  it('a removed document or a cleared storage puts every window back to the defaults', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window());
    const b = createSettingsService(storage.window());
    a.update(setFontSize(16));
    expect(b.get().editor.fontSize).toBe(16);
    storage.window().write(null as unknown as string); // what a `storage` event with key null reports
    expect(a.get().editor.fontSize).toBe(DEFAULT_SETTINGS.editor.fontSize);
    expect(b.get().editor.fontSize).toBe(DEFAULT_SETTINGS.editor.fontSize);
  });

  it('a storage that cannot hand on the text is read instead', () => {
    let text: string | null = null;
    let listener: (text?: string | null) => void = () => {};
    const a = createSettingsService({
      read: () => text,
      write: (next) => void (text = next),
      onExternalChange: (l) => {
        listener = l;
        return () => {};
      },
    });
    text = JSON.stringify({ version: 1, editor: { fontSize: 19 } });
    listener();
    expect(a.get().editor.fontSize).toBe(19);
  });

  it('random interleavings of three windows: nothing lost, every window and the store agree', () => {
    // A small seeded generator, so that a failure can be repeated.
    let seed = 0x5eed;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    type Path = 'editor.fontSize' | 'editor.realTabs' | 'sim.bitField' | 'app.theme';
    const paths: readonly Path[] = ['editor.fontSize', 'editor.realTabs', 'sim.bitField', 'app.theme'];
    const valueFor = (path: Path): unknown =>
      path === 'editor.fontSize'
        ? 8 + Math.floor(random() * 30)
        : path === 'app.theme'
          ? pick(['system', 'light', 'dark'])
          : random() < 0.5;

    for (let run = 0; run < 300; run++) {
      const storage = new LateStorage();
      const clock = testClock();
      const windows = ['a', 'b', 'c'].map((id) => ({
        storage: storage.window(),
        id,
      }));
      const services = windows.map((w) =>
        createSettingsService(w.storage, undefined, { now: clock.now, writerId: w.id }),
      );
      /**
       * Every change made, in the order the test made it. The clock moves on before every update,
       * so each change is later than everything stored before it, and by the rule of the service
       * the last change made to a setting is the one that must win. The oracle is the test's own
       * order of events; it does not read the stamps the service writes.
       */
      const changes: { path: Path; value: unknown }[] = [];
      for (let step = 0; step < 25; step++) {
        const roll = random();
        if (roll < 0.45) {
          const index = Math.floor(random() * services.length);
          const service = services[index] as (typeof services)[number];
          const path = pick(paths);
          const value = valueFor(path);
          clock.advance(1);
          // A value equal to the one the window shows is no change (the window has nothing to stamp).
          const isChange = !Object.is(valueAt(service.get(), path), value);
          service.update((s) => withValueAt(s, path, value));
          if (isChange) changes.push({ path, value });
        } else if (roll < 0.9) {
          const pending = storage.pending();
          if (pending.length > 0) storage.deliverOne(pick(pending));
        } else {
          clock.advance(Math.floor(random() * 3));
        }
      }
      storage.deliverAll();

      const stored = parseSettings(storage.text).settings;
      for (const path of paths) {
        const last = changes.filter((change) => change.path === path).at(-1);
        const expected = last === undefined ? valueAt(DEFAULT_SETTINGS, path) : last.value;
        expect(valueAt(stored, path), `run ${run}, ${path} in the store`).toEqual(expected);
        for (const [index, service] of services.entries()) {
          expect(valueAt(service.get(), path), `run ${run}, ${path} in window ${index}`).toEqual(expected);
        }
      }
    }
  }, 120_000);
});

describe('putting a missing setting back once, not once per window (errata W3 entry 26)', () => {
  /** Tasks handed to `defer`, run when the test says so. */
  function deferQueue() {
    const tasks = new Set<() => void>();
    return {
      defer: (task: () => void) => {
        tasks.add(task);
        return () => void tasks.delete(task);
      },
      runAll: () => {
        for (const task of [...tasks]) {
          tasks.delete(task);
          task();
        }
      },
      size: () => tasks.size,
    };
  }

  /** LateStorage windows that count their writes and defer through `queue`. */
  function counted(storage: LateStorage, queue: ReturnType<typeof deferQueue>) {
    const counter = { writes: 0 };
    const base = storage.window();
    const window: SettingsStorage = {
      ...base,
      write: (text) => {
        counter.writes++;
        base.write(text);
      },
      defer: queue.defer,
    };
    return { window, counter };
  }

  it('of three windows that know a setting a stale write lacks, the first to repair writes, the others not', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const queues = [deferQueue(), deferQueue(), deferQueue(), deferQueue()];
    const made = queues.map((queue) => counted(storage, queue));
    const services = made.map((m, index) =>
      createSettingsService(m.window, undefined, { now: clock.now, writerId: `w${index}` }),
    );
    const [a, , , d] = services as [SettingsStore, SettingsStore, SettingsStore, SettingsStore];
    a.update(setFontSize(14));
    // Windows 1 and 2 hear of it; window 3 (d) does not yet.
    storage.deliverOne(1);
    storage.deliverOne(2);
    clock.advance(1);
    d.update(setBitField(true)); // lacks the font size
    // a, 1 and 2 all hear d's write and would put the font size back.
    storage.deliverOne(0);
    storage.deliverOne(1);
    storage.deliverOne(2);
    expect(queues.slice(0, 3).map((q) => q.size())).toEqual([1, 1, 1]);
    const before = made.map((m) => m.counter.writes);
    queues[1]?.runAll(); // window 1's pause ends first: it writes
    // its write reaches a and 2 before their pauses end: they have nothing left to write
    storage.deliverOne(0);
    storage.deliverOne(2);
    queues[0]?.runAll();
    queues[2]?.runAll();
    const writes = made.map((m, index) => m.counter.writes - (before[index] ?? 0));
    expect(writes).toEqual([0, 1, 0, 0]);
    storage.deliverAll();
    for (const queue of queues) queue.runAll();
    storage.deliverAll();
    const stored = parseSettings(storage.text).settings;
    expect(stored.editor.fontSize).toBe(14);
    expect(stored.sim.bitField).toBe(true);
    for (const service of services) {
      expect(service.get().editor.fontSize).toBe(14);
      expect(service.get().sim.bitField).toBe(true);
    }
  });

  it('a window that is disposed while its write-back waits makes it at once', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const queue = deferQueue();
    const a = createSettingsService(counted(storage, queue).window, undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(14));
    clock.advance(1);
    b.update(setBitField(true)); // stale
    storage.deliverOne(0); // a hears it and waits to repair
    expect(queue.size()).toBe(1);
    a.dispose();
    expect(queue.size()).toBe(0);
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(14);
    expect(parseSettings(storage.text).settings.sim.bitField).toBe(true);
  });

  it('an update made while a write-back waits writes everything at once and cancels it', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const queue = deferQueue();
    const a = createSettingsService(counted(storage, queue).window, undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(14));
    clock.advance(1);
    b.update(setBitField(true));
    storage.deliverOne(0);
    clock.advance(1);
    a.update(setRealTabs(true));
    expect(queue.size()).toBe(0);
    const stored = parseSettings(storage.text).settings;
    expect([stored.editor.fontSize, stored.sim.bitField, stored.editor.realTabs]).toEqual([14, true, true]);
  });
});

describe('a document without stamps, written while windows are open (errata W3 entry 26)', () => {
  it('replaces what the windows know, as a write did before stamps existed', () => {
    const storage = new MemorySettingsStorage();
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(16));
    a.update((s) => ({ ...s, app: { ...s.app, theme: 'light' } }));
    clock.advance(1);
    // Something other than the port (a tool, the developer tools) writes a document of the old shape.
    storage.window().write(JSON.stringify({ version: 1, editor: { fontSize: 21 }, app: { theme: 'dark' } }));
    expect(a.get().editor.fontSize).toBe(21);
    expect(b.get().app.theme).toBe('dark');
    clock.advance(1);
    b.update(setBitField(true));
    const stored = parseSettings(storage.text).settings;
    expect([stored.editor.fontSize, stored.app.theme, stored.sim.bitField]).toEqual([21, 'dark', true]);
    expect([a.get().editor.fontSize, a.get().app.theme, a.get().sim.bitField]).toEqual([21, 'dark', true]);
  });

  it('written in one page, it is not undone when that page hears of it only through another', () => {
    const storage = new LateStorage();
    const clock = testClock();
    const own = storage.window();
    const a = createSettingsService(own, undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    const c = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'c' });
    a.update(setFontSize(16));
    storage.deliverAll();
    clock.advance(1);
    // The developer tools of page a write; page a gets no event for it.
    own.write(JSON.stringify({ version: 1, editor: { fontSize: 21 } }));
    storage.deliverOne(1); // b hears of it, c not yet
    clock.advance(1);
    b.update(setBitField(true));
    expect(c.get().editor.fontSize).toBe(16); // c has not heard of it yet
    storage.deliverAll();
    const stored = parseSettings(storage.text).settings;
    expect([stored.editor.fontSize, stored.sim.bitField]).toEqual([21, true]);
    for (const service of [a, b, c]) {
      expect(service.get().editor.fontSize).toBe(21);
      expect(service.get().sim.bitField).toBe(true);
    }
  });

  it('written in the window itself, it is taken in by the next update', () => {
    const storage = new MemorySettingsStorage();
    const a = createSettingsService(storage.window(), undefined, { now: () => 5, writerId: 'a' });
    a.update(setFontSize(16));
    storage.text = JSON.stringify({ version: 1, editor: { fontSize: 21 } }); // no event in the writing page
    a.update(setBitField(true));
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(21);
    expect(a.get().editor.fontSize).toBe(21);
  });

  it('an old document the window has already taken in, still in its copy, does not undo a newer write', () => {
    const old = JSON.stringify({ version: 1, editor: { fontSize: 15 } });
    const storage = new LateStorage();
    storage.text = old;
    const clock = testClock();
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(17));
    clock.advance(1);
    b.update(setBitField(true)); // b's copy still holds the old document, which b found at start
    storage.deliverAll();
    const stored = parseSettings(storage.text).settings;
    expect([stored.editor.fontSize, stored.sim.bitField]).toEqual([17, true]);
    expect(b.get().editor.fontSize).toBe(17);
  });

  // docs/requests/W3-settings-followups.md, item 1 (errata W3 entry 28).
  it('a window that receives it late does not undo a change made after another window took it in', () => {
    const storage = new LateStorage();
    const clock = testClock(1_000);
    const a = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    const outside = storage.window();
    a.update(setFontSize(16));
    storage.deliverAll();
    clock.advance(1_000); // 2000: something else writes the font size 21
    outside.write(JSON.stringify({ version: 1, editor: { fontSize: 21 }, app: { theme: 'dark' } }));
    clock.advance(10); // 2010: window B receives it
    storage.deliverOne(1);
    expect(b.get().editor.fontSize).toBe(21);
    clock.advance(10); // 2020: the person sets 30 in B
    b.update(setFontSize(30));
    clock.advance(10); // 2030: window A receives the outside document, and then B's write
    storage.deliverOne(0);
    expect(a.get().editor.fontSize).toBe(21);
    storage.deliverOne(0);
    expect(a.get().editor.fontSize).toBe(30);
    storage.deliverAll();
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(30);
    for (const service of [a, b]) {
      expect(service.get().editor.fontSize).toBe(30);
      expect(service.get().app.theme).toBe('dark');
    }
  });

  it('the same holds when the late window is the page in which the document was written', () => {
    const storage = new LateStorage();
    const clock = testClock(1_000);
    const own = storage.window();
    const a = createSettingsService(own, undefined, { now: clock.now, writerId: 'a' });
    const b = createSettingsService(storage.window(), undefined, { now: clock.now, writerId: 'b' });
    a.update(setFontSize(16));
    storage.deliverAll();
    clock.advance(1_000);
    own.write(JSON.stringify({ version: 1, editor: { fontSize: 21 } })); // page a's developer tools
    clock.advance(10);
    storage.deliverOne(1); // b receives it
    clock.advance(10);
    b.update(setFontSize(30));
    clock.advance(10);
    a.update(setBitField(true)); // a reads its own copy, which still holds the outside document
    expect(a.get().editor.fontSize).toBe(21);
    storage.deliverAll();
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(30);
    expect(parseSettings(storage.text).settings.sim.bitField).toBe(true);
    for (const service of [a, b]) {
      expect(service.get().editor.fontSize).toBe(30);
      expect(service.get().sim.bitField).toBe(true);
    }
  });

  it('three windows: the third learns the earlier time from the mark after the settings changed again', () => {
    const storage = new LateStorage();
    const clock = testClock(1_000);
    const services = ['a', 'b', 'c'].map((id) =>
      createSettingsService(storage.window(), undefined, { now: clock.now, writerId: id }),
    );
    const [a, b, c] = services as [SettingsStore, SettingsStore, SettingsStore];
    const outside = storage.window();
    clock.advance(1_000);
    outside.write(JSON.stringify({ version: 1, editor: { fontSize: 21 } }));
    clock.advance(10);
    storage.deliverOne(1); // b has it
    clock.advance(10);
    b.update(setFontSize(30)); // b's write no longer stamps the font size with the outside writer
    clock.advance(10);
    storage.deliverOne(2); // c receives the outside document late
    storage.deliverOne(2); // and then b's write, which carries the mark
    storage.deliverAll();
    for (const service of [a, b, c]) expect(service.get().editor.fontSize).toBe(30);
    expect(parseSettings(storage.text).settings.editor.fontSize).toBe(30);
  });

  it('alignOutsideStamps moves the stamps of one outside writer back to its earliest time', () => {
    const writer = outsideWriter('{"version":1}');
    expect(writer).toBe(outsideWriter('{"version":1}'));
    expect(writer).not.toBe(outsideWriter('{"version":2}'));
    expect(writer.startsWith(OUTSIDE_WRITER_PREFIX)).toBe(true);
    const mine = new Map<string, Stamp>([
      ['editor.fontSize', [30, writer]],
      ['sim.bitField', [25, 'm']],
    ]);
    const theirs = new Map<string, Stamp>([[OUTSIDE_MARK, [10, writer]]]);
    const [alignedMine, alignedTheirs] = alignOutsideStamps(mine, theirs);
    expect(alignedMine.get('editor.fontSize')).toEqual([10, writer]);
    expect(alignedMine.get('sim.bitField')).toEqual([25, 'm']);
    expect(alignedTheirs).toBe(theirs);
    const plain = new Map<string, Stamp>([['a', [1, 'x']]]);
    expect(alignOutsideStamps(plain, plain)).toEqual([plain, plain]);
    // The mark is bookkeeping: merging it never writes a setting called "~outside".
    const { merged } = mergeStamped(
      { document: { a: 1 }, stamps: new Map<string, Stamp>([[OUTSIDE_MARK, [5, writer]]]) },
      { document: { a: 2 }, stamps: new Map() },
    );
    expect(merged.document).toEqual({ a: 2 });
    expect(merged.stamps.get(OUTSIDE_MARK)).toEqual([5, writer]);
  });

  it('this port always writes the stamp table, empty before any change', () => {
    const storage = new MemorySettingsStorage();
    createSettingsService(storage.window()).update((s) => s);
    expect(JSON.parse(storage.text ?? '')[STAMPS_KEY]).toEqual({});
  });
});

describe('stamps in the stored document (errata W3 entry 26)', () => {
  it('a document written before stamps existed loads as before, and only changed settings get one', () => {
    const old = JSON.stringify({ version: 1, editor: { fontSize: 15 }, app: { theme: 'dark' } });
    const storage = new MemorySettingsStorage(old);
    const service = createSettingsService(storage.window(), undefined, { now: () => 42, writerId: 'w' });
    expect(service.get().editor.fontSize).toBe(15);
    expect(service.get().app.theme).toBe('dark');
    service.update(setExceptions(true));
    const written = JSON.parse(storage.text ?? '');
    expect(written[STAMPS_KEY]).toEqual({ 'sim.exceptions': [42, 'w'] });
    expect(written.editor.fontSize).toBe(15);
    expect(written.version).toBe(1);
  });

  it('stamps take the time from the storage, and without one they only count up', () => {
    const timed = new MemorySettingsStorage();
    const storage: SettingsStorage = { ...timed.window(), now: () => 1_700_000_000_000 };
    createSettingsService(storage, undefined, { writerId: 'w' }).update(setFontSize(13));
    expect(JSON.parse(timed.text ?? '')[STAMPS_KEY]).toEqual({ 'editor.fontSize': [1_700_000_000_000, 'w'] });

    const plain = new MemorySettingsStorage();
    const service = createSettingsService(plain.window(), undefined, { writerId: 'w' });
    service.update(setFontSize(13));
    service.update(setExceptions(true));
    expect(JSON.parse(plain.text ?? '')[STAMPS_KEY]).toEqual({
      'editor.fontSize': [1, 'w'],
      'sim.exceptions': [2, 'w'],
    });
  });

  it('the stamp table is not a setting: get() does not show it, broken entries are ignored', () => {
    const text = JSON.stringify({
      version: 1,
      editor: { fontSize: 15 },
      [STAMPS_KEY]: { 'editor.fontSize': [7, 'x'], 'sim.bitField': 'soon', 'app.theme': [Number.NaN, 'y'], z: [1] },
    });
    const parsed = parseSettings(text);
    expect(STAMPS_KEY in (parsed.settings as unknown as Record<string, unknown>)).toBe(false);
    expect([...parsed.stamps]).toEqual([['editor.fontSize', [7, 'x']]]);
    expect(parseSettings(JSON.stringify({ [STAMPS_KEY]: 'nothing' })).stamps.size).toBe(0);
  });

  it('the panel layout is one setting; other settings are compared key by key', () => {
    const base = parseSettings(null).settings as unknown as Record<string, never>;
    const paths = settingPaths(base);
    expect(paths.has('app.layout')).toBe(true);
    expect([...paths.keys()].some((path) => path.startsWith('app.layout.'))).toBe(false);
    expect(paths.has('editor.styles.code.color')).toBe(true);
    expect(paths.has('version')).toBe(false);
    const changed = withValueAt(
      withValueAt(base as unknown as Settings, 'app.layout.outputZoom', 2),
      'sim.bitField',
      true,
    );
    expect(changedPaths(base, changed as unknown as Record<string, never>).sort()).toEqual([
      'app.layout',
      'sim.bitField',
    ]);
  });

  it('a key with a dot in it is a key of its own', () => {
    const before = { app: { serialPortMap: {} } };
    const after = { app: { serialPortMap: { 'tty.usb': '/dev/tty.usb' } } };
    expect(changedPaths(before, after)).toEqual(['app.serialPortMap.tty~1usb']);
    const { merged, mineWon } = mergeStamped(
      { document: after, stamps: new Map([['app.serialPortMap.tty~1usb', [2, 'a'] as Stamp]]) },
      { document: before, stamps: new Map() },
    );
    expect(mineWon).toBe(true);
    expect(merged.document).toEqual(after);
  });

  it('mergeStamped takes the later stamp of each setting, and the other side on a tie', () => {
    const mine = {
      document: { a: 1, b: 1, c: 1 },
      stamps: new Map<string, Stamp>([
        ['a', [5, 'm']],
        ['b', [1, 'm']],
        ['c', [3, 'x']],
      ]),
    };
    const theirs = {
      document: { a: 2, b: 2, c: 2 },
      stamps: new Map<string, Stamp>([
        ['b', [4, 't']],
        ['c', [3, 'x']],
      ]),
    };
    const { merged, mineWon } = mergeStamped(mine, theirs);
    expect(merged.document).toEqual({ a: 1, b: 2, c: 2 });
    expect(Object.fromEntries(merged.stamps)).toEqual({ a: [5, 'm'], b: [4, 't'], c: [3, 'x'] });
    expect(mineWon).toBe(true);
    expect(mergeStamped(theirs, merged).mineWon).toBe(false);
    expect(compareStamps([3, 'a'], [3, 'b'])).toBeLessThan(0);
    expect(compareStamps([4, 'a'], [3, 'b'])).toBeGreaterThan(0);
  });
});
