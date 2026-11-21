// The settings store (ARCHITECTURE.md 3.10, 3.8.6 rule 2). Owner: W3.
//
// One JSON document holds every setting of the port: the editor's, the simulator's and the
// application's own (theme, panel layout). It is kept under the localStorage key
// `easy68k.settings.v1` in both deliveries. This module never touches localStorage itself (core/
// runs without a browser, section 0 rule 5): the storage is injected as a SettingsStorage, and
// app/src/state/browser.ts supplies the real one.
//
// Rules:
//
// - Missing keys take their defaults; keys this version does not know are kept and written back,
//   at every level (a newer version of the port may have written them).
// - A value this version cannot use is treated as missing: a value of the wrong type, and, for a
//   setting that takes one of a fixed list of values, a value that is not on the list
//   (SETTING_CHOICES).
// - Several windows share the document (3.8.6). update() reads the stored document again, applies
//   the change to that, and writes the result, all in one synchronous step, so two windows never
//   overwrite each other's fields. When another window writes, the storage reports it and the copy
//   in memory is replaced: the `editor` and `sim` settings (and the theme) take effect at once.
// - The panel layout (`app.layout`) is the exception: a window that is open keeps its own layout,
//   whatever other windows store. It reads the stored layout once, at start, and writes its own
//   layout only when it changes it.
// - A storage that cannot be read or written (private browsing, quota) never breaks the
//   application: the settings then live in memory for the life of the window.

import { TabType, type Settings, type SettingsService } from '../../contracts';
import { defaultSettings } from './defaults';

/** The localStorage key of the settings document (3.10). */
export const SETTINGS_KEY = 'easy68k.settings.v1';

/** The version this code reads and writes. A stored document with a higher number keeps its number. */
export const SETTINGS_VERSION = 1;

/** Where the settings document is kept. The browser implementation is localStorage (3.10). */
export interface SettingsStorage {
  /** The stored text, or null when nothing is stored. May throw; that is treated as null. */
  read(): string | null;
  /** Stores the text. May throw (quota, private browsing); the settings then stay in memory. */
  write(text: string): void;
  /** Calls `listener` when ANOTHER window has written the document. Returns the unsubscribe. */
  onExternalChange(listener: () => void): () => void;
}

/** The service plus what only its owner (the bootstrap) uses. */
export interface SettingsStore extends SettingsService {
  /** Stops listening to the storage. */
  dispose(): void;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The settings that take one of a fixed list of values (3.10), by their path in the document,
 * each with every value it may hold. A stored value is kept when it is on the list.
 *
 * These need a list because the type of the default cannot decide for them: `outputZoom` is
 * 'fit', 1 or 2, so a stored 2 has another type than the default 'fit' and is still right; and a
 * theme 'blue' has the type of the default and is still useless.
 *
 * service.test.ts compares this table with the contract (contracts/settings.ts) when the project
 * is type-checked: a setting of this kind that is missing here, or a missing value, is an error.
 */
export const SETTING_CHOICES = {
  'editor.tabType': [TabType.Assembly, TabType.Fixed],
  'editor.colorPreset': [-1, 0, 1, 2, 3, 4, 5],
  'sim.execLogType': [0, 1, 2, 3],
  'sim.outputLogType': [0, 1],
  'sim.speed.mode': ['original', 'max', 'custom'],
  'app.theme': ['system', 'light', 'dark'],
  'app.layout.editorPanes': ['one', 'horizontal', 'vertical'],
  'app.layout.outputZoom': ['fit', 1, 2],
} as const satisfies Readonly<Record<string, readonly (string | number)[]>>;

/** Path of a setting -> the values it may hold; no entry for a setting without a fixed list. */
export type ChoiceTable = ReadonlyMap<string, readonly Json[]>;

const CHOICES: ChoiceTable = new Map(Object.entries(SETTING_CHOICES));

/** True when `value` has the type of `fallback` (an array is not an object here). */
function sameType(value: Json, fallback: Json): boolean {
  return typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback);
}

/**
 * `stored` laid over `defaults`. A key of `defaults` takes the stored value when this version can
 * use it, otherwise the default: an object is merged key by key, a setting listed in `choices`
 * must hold one of its values, and any other value must have the type of the default. Every
 * stored key that `defaults` does not have is kept as it is.
 *
 * `choices` is keyed by the path of a setting from the top of the document (`app.theme`); `path`
 * is where `defaults` itself stands in the document and is empty for the whole document.
 */
export function mergeWithDefaults(
  defaults: JsonObject,
  stored: unknown,
  choices: ChoiceTable = new Map(),
  path = '',
): JsonObject {
  const result: JsonObject = {};
  const source = isObject(stored) ? stored : {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = source[key];
    const keyPath = path === '' ? key : `${path}.${key}`;
    if (isObject(fallback)) {
      result[key] = mergeWithDefaults(fallback, value, choices, keyPath);
      continue;
    }
    const allowed = choices.get(keyPath);
    const usable = value !== undefined && (allowed ? allowed.includes(value) : sameType(value, fallback));
    result[key] = structuredClone(usable ? value : fallback);
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in defaults)) result[key] = structuredClone(value);
  }
  return result;
}

/** Steps that bring a document of an older version up to SETTINGS_VERSION; index = version it reads. */
const MIGRATIONS: ReadonlyArray<(document: JsonObject) => JsonObject> = [
  // Version 0 never existed. Add a function here when SETTINGS_VERSION becomes 2:
  // it receives a version-1 document and returns a version-2 document.
];

interface Parsed {
  settings: Settings;
  /** The version found in storage when it is newer than this code; written back unchanged. */
  storedVersion: number;
}

/** The settings in a stored text. Anything unreadable gives the defaults. */
export function parseSettings(text: string | null): Parsed {
  let raw: unknown = null;
  if (text !== null) {
    try {
      raw = JSON.parse(text);
    } catch {
      raw = null;
    }
  }
  let document: JsonObject = isObject(raw) ? raw : {};
  const found = typeof document.version === 'number' && Number.isInteger(document.version) ? document.version : 1;
  for (let version = Math.max(found, 0); version < SETTINGS_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (migrate) document = migrate(document);
  }
  const merged = mergeWithDefaults(defaultSettings() as unknown as JsonObject, document, CHOICES);
  merged.version = SETTINGS_VERSION;
  return { settings: merged as unknown as Settings, storedVersion: Math.max(found, SETTINGS_VERSION) };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Creates the settings store on `storage`. The first read happens here, so `get()` is valid at
 * once. `onStorageError` is told when the storage refuses a read or a write.
 */
export function createSettingsService(
  storage: SettingsStorage,
  onStorageError: (error: unknown) => void = () => {},
): SettingsStore {
  const listeners = new Set<() => void>();

  const readStored = (): Parsed => {
    let text: string | null = null;
    try {
      text = storage.read();
    } catch (error) {
      onStorageError(error);
    }
    return parseSettings(text);
  };

  let current: Settings = readStored().settings;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /** `stored` as this window sees it: everything from storage, the layout from this window. */
  const withOwnLayout = (stored: Settings): Settings => ({
    ...stored,
    app: { ...stored.app, layout: current.app.layout },
  });

  const stopListening = storage.onExternalChange(() => {
    const next = withOwnLayout(readStored().settings);
    if (sameJson(next, current)) return;
    current = next;
    notify();
  });

  return {
    get: () => current,

    update(change) {
      const { settings: stored, storedVersion } = readStored();
      const base = withOwnLayout(stored);
      const next = change(base);
      // The layout goes to storage only when this change touched it; otherwise the stored layout
      // (possibly another window's) stays as it is.
      const layoutChanged = !sameJson(next.app.layout, base.app.layout);
      const toStore = layoutChanged ? next : { ...next, app: { ...next.app, layout: stored.app.layout } };
      try {
        storage.write(JSON.stringify({ ...toStore, version: storedVersion }));
      } catch (error) {
        onStorageError(error);
      }
      current = { ...next, version: SETTINGS_VERSION };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      stopListening();
      listeners.clear();
    },
  };
}

/** A storage in memory. Several services created on one MemorySettingsStorage behave like several
 *  windows on one origin: a write by one is reported to the others (the `storage` event). */
export class MemorySettingsStorage {
  text: string | null;
  private readonly windows = new Set<{ listeners: Set<() => void> }>();

  constructor(initial: string | null = null) {
    this.text = initial;
  }

  /** The storage as one window sees it. */
  window(): SettingsStorage {
    const self = { listeners: new Set<() => void>() };
    this.windows.add(self);
    return {
      read: () => this.text,
      write: (text) => {
        this.text = text;
        for (const other of this.windows) {
          if (other !== self) for (const listener of [...other.listeners]) listener();
        }
      },
      onExternalChange: (listener) => {
        self.listeners.add(listener);
        return () => {
          self.listeners.delete(listener);
        };
      },
    };
  }
}
