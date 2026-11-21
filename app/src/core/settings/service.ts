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
// - Several windows share the document (3.8.6). A browser does not promise that a window reads
//   what another window wrote a moment ago: each page keeps its own copy of localStorage and
//   learns of other pages' writes later, together with or apart from the `storage` event (errata
//   W3 entry 26). Reading the document again before a write is therefore not enough; a window may
//   write a whole document that lacks another window's latest change. So each setting the port
//   changes carries a stamp (when, and which window) in the document's `stamps` table, and every
//   document a window sees, read or reported by an event, is merged setting by setting with what
//   the window knows: the newer stamp wins. A window that finds one of its newer settings missing
//   from a document another window wrote writes the merged document back. Changes to different
//   settings are therefore never lost, and two windows that change the same setting at about the
//   same time end with the same value, the one with the later stamp. This port always writes the
//   `stamps` table (empty when nothing has been changed yet). A document WITHOUT one was written by
//   something else (an older version of the port that never saw stamps, a tool, a person in the
//   developer tools): when such a document is written while the window is open, it replaces what
//   the window knows, as every write did before stamps existed. Each window stamps what such a
//   document changed when it takes it in, and windows that took in the same write agree on the
//   earliest of their times, so that a window that hears of it late cannot undo a change made after
//   another window had it (errata W3 entry 28). The same text written twice is two writes, each
//   with a mark of its own in the stamp table (errata W3 entry 31).
// - Where the storage can run a task a little later (`defer`), a window puts a missing setting
//   back after a short pause rather than at once, and only if no window has put it back meanwhile:
//   several windows that all know the missing setting then write it once, not once each.
// - The panel layout (`app.layout`) is one setting for this purpose, and it is the exception: a
//   window that is open keeps its own layout, whatever other windows store. It reads the stored
//   layout once, at start, and writes its own layout only when it changes it.
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
  /**
   * Calls `listener` when ANOTHER window has written the document. Returns the unsubscribe.
   * `text` is what that window wrote (the event's `newValue`), null when the document was removed
   * or the storage cleared, and undefined when the storage cannot tell: the service then reads.
   * Pass the text whenever it is known: what `read()` returns at that moment may still be older.
   */
  onExternalChange(listener: (text?: string | null) => void): () => void;
  /**
   * Wall time in milliseconds, the same clock in every window, for the stamps of changed settings
   * (Date.now in a browser). Without it a change is stamped only after every change this window
   * has seen, and of two changes made at once neither counts as the later one.
   */
  now?(): number;
  /**
   * Runs `task` a little later (a few tens of milliseconds, a different pause in each window) and
   * returns what cancels it. Without it a window puts a missing setting back at once.
   */
  defer?(task: () => void): () => void;
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

/** A copy of a JSON value that shares nothing with it (a string or number is its own copy). */
function copyOf<T extends Json | undefined>(value: T): T {
  return typeof value === 'object' && value !== null ? structuredClone(value) : value;
}

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
    result[key] = copyOf(usable ? value : fallback);
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in defaults)) result[key] = copyOf(value);
  }
  return result;
}

/** Steps that bring a document of an older version up to SETTINGS_VERSION; index = version it reads. */
const MIGRATIONS: ReadonlyArray<(document: JsonObject) => JsonObject> = [
  // Version 0 never existed. Add a function here when SETTINGS_VERSION becomes 2:
  // it receives a version-1 document and returns a version-2 document.
];

// ---- Stamps: which window changed a setting last, and when ------------------------------------

/** The top-level key of the stamp table in the stored document. */
export const STAMPS_KEY = 'stamps';

/**
 * When a setting was last changed and by which window: [milliseconds, writer]. A later time wins;
 * the writer decides between equal times, so that every window picks the same one.
 */
export type Stamp = readonly [time: number, writer: string];

/** Stamps by setting path. A setting without a stamp has not been changed since stamps exist. */
export type Stamps = ReadonlyMap<string, Stamp>;

/** Positive when `a` is later than `b`. */
export function compareStamps(a: Stamp, b: Stamp): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
}

/**
 * The writer of the stamps that a document without stamps (written by something other than the
 * port) receives when a window takes it in: this prefix and a hash of the document's text, so
 * that every window gives the same document the same writer (errata W3 entry 28).
 */
export const OUTSIDE_WRITER_PREFIX = 'outside:';

/**
 * Entries of the stamp table that are not settings. Gate I1 round 1 wrote one entry under this
 * key, the stamp of the last document without stamps that the writing window took in; since
 * round 2 there is one entry per outside write, under `outsideMarkPath(writer)` (errata W3 entry
 * 31), and an entry under the bare key is still read as a mark. A mark travels with every write,
 * also after the settings that document changed have been changed again, so that every window
 * learns the earliest time any window took that write in. No path of a real setting can be
 * written like this: a `~` in a key is always written `~0` or `~1`.
 */
export const OUTSIDE_MARK = '~outside';

/** The stamp-table key of the mark of one outside write (`~outside/outside:<hash>[#n]`). */
export function outsideMarkPath(writer: string): string {
  return `${OUTSIDE_MARK}/${writer}`;
}

/** True for a key of the stamp table that is a mark, not a setting. */
export function isOutsideMark(path: string): boolean {
  return path === OUTSIDE_MARK || path.startsWith(`${OUTSIDE_MARK}/`);
}

/**
 * The writer for a document without stamps: OUTSIDE_WRITER_PREFIX and a 32-bit FNV-1a hash of its
 * text, and for the second and later write of the same text, `#` and the number of that write
 * (`generation`, counted by each window from 1; errata W3 entry 31). The same text written twice
 * (a backup restored twice) is two writes, which must not count from the same time.
 */
export function outsideWriter(text: string, generation = 1): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const base = `${OUTSIDE_WRITER_PREFIX}${hash.toString(16).padStart(8, '0')}`;
  return generation > 1 ? `${base}#${generation}` : base;
}

/**
 * The parts of an outside writer: the writer of its first write (`outside:<hash>`) and which write
 * of that text it names. Undefined for a writer that is not an outside writer.
 */
export function outsideGeneration(writer: string): { base: string; generation: number } | undefined {
  const match = /^(outside:[0-9a-f]{8})(?:#([1-9][0-9]*))?$/.exec(writer);
  if (match === null) return undefined;
  return { base: match[1] as string, generation: match[2] === undefined ? 1 : Number(match[2]) };
}

/**
 * Both stamp tables with every stamp of an outside writer moved back to the earliest time either
 * table holds for that writer. A document without stamps is stamped by each window when that
 * window receives it, and windows receive it at different times; this gives it, in every window,
 * the time of the first window that took it in, which is never later than a change made after it
 * in any window that had it. A table that needs no change is returned as it is.
 */
export function alignOutsideStamps(a: Stamps, b: Stamps): [Stamps, Stamps] {
  const earliest = new Map<string, number>();
  for (const table of [a, b]) {
    for (const [time, writer] of table.values()) {
      if (!writer.startsWith(OUTSIDE_WRITER_PREFIX)) continue;
      const seen = earliest.get(writer);
      if (seen === undefined || time < seen) earliest.set(writer, time);
    }
  }
  if (earliest.size === 0) return [a, b];
  const align = (table: Stamps): Stamps => {
    let result: Map<string, Stamp> | null = null;
    for (const [path, stamp] of table) {
      const time = earliest.get(stamp[1]);
      if (time === undefined || time >= stamp[0]) continue;
      result ??= new Map(table);
      result.set(path, [time, stamp[1]]);
    }
    return result ?? table;
  };
  return [align(a), align(b)];
}

/** Settings that are merged and stamped as a whole rather than key by key. */
const WHOLE_SETTINGS: ReadonlySet<string> = new Set(['app.layout']);

/** `~` and `.` inside a key are written `~0` and `~1`, so that a path reads back unambiguously. */
const escapeKey = (key: string) => key.replaceAll('~', '~0').replaceAll('.', '~1');
const unescapeKey = (key: string) => key.replaceAll('~1', '.').replaceAll('~0', '~');
const splitPath = (path: string) => path.split('.').map(unescapeKey);

/**
 * Every setting of a document by its path ("editor.fontSize", "app.layout"), with its value. A
 * setting is a value that is not an object (arrays included), or one of WHOLE_SETTINGS. The
 * top-level `version` and `stamps` are not settings.
 */
export function settingPaths(document: JsonObject): Map<string, Json> {
  const result = new Map<string, Json>();
  const walk = (node: JsonObject, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (prefix === '' && (key === 'version' || key === STAMPS_KEY)) continue;
      const path = prefix === '' ? escapeKey(key) : `${prefix}.${escapeKey(key)}`;
      if (isObject(value) && !WHOLE_SETTINGS.has(path)) walk(value, path);
      else result.set(path, value);
    }
  };
  walk(document, '');
  return result;
}

/** The paths whose values differ between two documents, including keys only one of them has. */
export function changedPaths(before: JsonObject, after: JsonObject): string[] {
  const a = settingPaths(before);
  const b = settingPaths(after);
  const paths = new Set([...a.keys(), ...b.keys()]);
  return [...paths].filter((path) => !sameJson(a.get(path), b.get(path)));
}

function valueAtPath(document: JsonObject, path: string): Json | undefined {
  let node: Json | undefined = document;
  for (const key of splitPath(path)) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** Sets (or, for undefined, removes) the value at `path` in `document`, which it changes. */
function setAtPath(document: JsonObject, path: string, value: Json | undefined): void {
  const keys = splitPath(path);
  let node = document;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (!isObject(next)) {
      if (value === undefined) return;
      node[key] = {};
    }
    node = node[key] as JsonObject;
  }
  const last = keys.at(-1) ?? '';
  if (value === undefined) delete node[last];
  else node[last] = copyOf(value);
}

/** The stamp table of a stored document. Entries that are not a [number, string] are ignored. */
export function parseStamps(raw: unknown): Map<string, Stamp> {
  const result = new Map<string, Stamp>();
  if (!isObject(raw)) return result;
  for (const [path, entry] of Object.entries(raw)) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'number' &&
      Number.isFinite(entry[0]) &&
      typeof entry[1] === 'string'
    ) {
      result.set(path, [entry[0], entry[1]]);
    }
  }
  return result;
}

/** A settings document together with its stamps: what a window knows, or what a writer stored. */
export interface StampedDocument {
  /** The document as parseSettings gives it (defaults filled in, unknown keys kept). */
  readonly document: JsonObject;
  readonly stamps: Stamps;
}

/**
 * `theirs` (a document another window wrote, or the one in storage) with every setting of `mine`
 * whose stamp is later than the stamp of the same setting in `theirs`. A setting that neither
 * stamps, or that both stamp alike, comes from `theirs`. `mineWon` tells whether `mine` added
 * anything, that is, whether `theirs` lacks something `mine` knows and should be written again.
 */
export function mergeStamped(
  mine: StampedDocument,
  theirs: StampedDocument,
): { merged: StampedDocument; mineWon: boolean } {
  // A document without stamps that both sides took in counts from the earlier of their two times.
  const [mineStamps, theirStamps] = alignOutsideStamps(mine.stamps, theirs.stamps);
  const document = structuredClone(theirs.document);
  const stamps = new Map(theirStamps);
  let mineWon = false;
  for (const [path, stamp] of mineStamps) {
    const other = theirStamps.get(path);
    if (other !== undefined && compareStamps(stamp, other) <= 0) continue;
    if (!isOutsideMark(path)) setAtPath(document, path, valueAtPath(mine.document, path));
    stamps.set(path, stamp);
    mineWon = true;
  }
  return { merged: { document, stamps }, mineWon };
}

// ---- Reading and writing the document ---------------------------------------------------------

interface Parsed {
  settings: Settings;
  /** The version found in storage when it is newer than this code; written back unchanged. */
  storedVersion: number;
  /** The stamp table of the document (empty for a document written before stamps existed). */
  stamps: Map<string, Stamp>;
  /**
   * True for a stored JSON object without a `stamps` table: written by something other than this
   * port (which always writes the table), so it is taken as it is rather than merged.
   */
  unstamped: boolean;
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
  let document: JsonObject = isObject(raw) ? { ...raw } : {};
  const unstamped = isObject(raw) && !(STAMPS_KEY in raw);
  const stamps = parseStamps(document[STAMPS_KEY]);
  delete document[STAMPS_KEY];
  const found = typeof document.version === 'number' && Number.isInteger(document.version) ? document.version : 1;
  for (let version = Math.max(found, 0); version < SETTINGS_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (migrate) document = migrate(document);
  }
  const merged = mergeWithDefaults(defaultSettings() as unknown as JsonObject, document, CHOICES);
  merged.version = SETTINGS_VERSION;
  return {
    settings: merged as unknown as Settings,
    storedVersion: Math.max(found, SETTINGS_VERSION),
    stamps,
    unstamped,
  };
}

/**
 * The text stored for a document: its settings, the version and the stamps. The stamp table is
 * written also when it is empty: a document without one is read as written by something else.
 */
export function serializeSettings(stamped: StampedDocument, version: number): string {
  const stored: JsonObject = { ...stamped.document, version };
  // Sorted, so that two windows that know the same write the same text.
  const table: JsonObject = {};
  for (const path of [...stamped.stamps.keys()].sort()) {
    const [time, writer] = stamped.stamps.get(path) as Stamp;
    table[path] = [time, writer];
  }
  stored[STAMPS_KEY] = table;
  return JSON.stringify(stored);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What createSettingsService takes besides the storage; tests pass their own. */
export interface SettingsServiceOptions {
  /** Wall time in milliseconds, for the stamps. Default: the storage's `now`. */
  now?: () => number;
  /** This window's name in the stamps. Default: a random one. */
  writerId?: string;
}

function randomWriterId(): string {
  let id = '';
  for (let i = 0; i < 12; i++) id += Math.floor(Math.random() * 36).toString(36);
  return id;
}

/**
 * Creates the settings store on `storage`. The first read happens here, so `get()` is valid at
 * once. `onStorageError` is told when the storage refuses a read or a write.
 */
export function createSettingsService(
  storage: SettingsStorage,
  onStorageError: (error: unknown) => void = () => {},
  options: SettingsServiceOptions = {},
): SettingsStore {
  const now = options.now ?? (() => storage.now?.() ?? 0);
  const writerId = options.writerId ?? randomWriterId();
  const listeners = new Set<() => void>();

  /**
   * The documents without stamps this window has already taken in (normally none, or the one it
   * found at start). Its own copy of the storage may still show one of them after a newer write
   * has reached the window by an event; only one it has not seen is a new write from outside.
   */
  const seenUnstamped = new Set<string>();

  /**
   * How many writes of each outside document (by the writer of its first write) this window has
   * taken in, so that the n-th write of a text has the same writer in every window (errata W3
   * entry 31). A window starts from the highest write named in the document it finds: it was not
   * open for those, and will not hear of them.
   */
  const outsideWrites = new Map<string, number>();

  const readText = (): string | null => {
    try {
      return storage.read();
    } catch (error) {
      onStorageError(error);
      return null;
    }
  };

  const stampedOf = (parsed: Parsed): StampedDocument => ({
    document: parsed.settings as unknown as JsonObject,
    stamps: parsed.stamps,
  });

  const firstText = readText();
  const first = parseSettings(firstText);
  if (first.unstamped && firstText !== null) seenUnstamped.add(firstText);
  for (const [, writer] of first.stamps.values()) {
    const parts = outsideGeneration(writer);
    if (parts !== undefined)
      outsideWrites.set(parts.base, Math.max(outsideWrites.get(parts.base) ?? 0, parts.generation));
  }
  /** Everything this window knows of the shared document, the stored layout included. */
  let known: StampedDocument = stampedOf(first);
  /** The highest version number seen in storage; written back unchanged. */
  let storedVersion = first.storedVersion;
  /** This window's own panel layout. */
  let ownLayout = first.settings.app.layout;

  /** The settings as this window sees them: what it knows, with its own layout. */
  const view = (): Settings => {
    const settings = known.document as unknown as Settings;
    return { ...settings, version: SETTINGS_VERSION, app: { ...settings.app, layout: ownLayout } };
  };

  let current: Settings = view();

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /** The newest document this window knows to be in storage: written by it, read, or reported. */
  let lastStored: StampedDocument = known;
  /** Cancels the write-back that is waiting, if one is. */
  let cancelRepair: (() => void) | null = null;

  const write = () => {
    cancelRepair?.();
    cancelRepair = null;
    lastStored = known;
    // The window's own copy now holds this write: a document without stamps found there later was
    // written after it, even when it has the text of one taken in before.
    seenUnstamped.clear();
    try {
      storage.write(serializeSettings(known, storedVersion));
    } catch (error) {
      onStorageError(error);
    }
  };

  /** Writes what this window knows back if the stored document (as far as it knows) lacks some of it. */
  const repair = () => {
    if (storage.defer === undefined) {
      write();
      return;
    }
    if (cancelRepair !== null) return;
    cancelRepair = storage.defer(() => {
      cancelRepair = null;
      // Another window may have put the setting back meanwhile.
      if (mergeStamped(known, lastStored).mineWon) write();
    });
  };

  /** A stamp later than every stamp this window has seen, so that its change counts as newer. */
  const nextStamp = (): Stamp => {
    let latest = 0;
    for (const [time] of known.stamps.values()) latest = Math.max(latest, time);
    return [Math.max(now(), latest + 1), writerId];
  };

  /**
   * Takes in a document written by something else than this port (`text`): it replaces what the
   * window knows. The settings it changed are stamped now, so that they count as newer than what
   * any window knew before: the page in which the document was written hears of it only through
   * the next write of another window, and a window that has not heard of it yet may still write
   * the older values. The writer of these stamps is the document's own (outsideWriter), and the
   * stamp is also kept as that write's mark (outsideMarkPath): when this window meets another window's stamps for the
   * same document, both count from the earlier time (alignOutsideStamps), so a window that
   * receives the document late cannot undo a change made after an earlier window took it in
   * (errata W3 entry 28). The writer also counts the writes of the same text (outsideWriter's
   * generation), so a second write of it is not taken for the first. When the window already
   * knows another window's stamp for this write, it heard of that window before the write itself:
   * the write counts from that earlier time at once, and a setting this window knows to have been
   * changed later keeps its value (errata W3 entry 31).
   */
  const replaceWith = (parsed: Parsed, text: string) => {
    storedVersion = Math.max(storedVersion, parsed.storedVersion);
    const base = outsideWriter(text);
    const generation = (outsideWrites.get(base) ?? 0) + 1;
    outsideWrites.set(base, generation);
    const writer = outsideWriter(text, generation);
    let time = nextStamp()[0];
    for (const [knownTime, knownWriter] of known.stamps.values()) {
      if (knownWriter === writer) time = Math.min(time, knownTime);
    }
    const stamp: Stamp = [time, writer];
    const document = structuredClone(parsed.settings as unknown as JsonObject);
    const stamps = new Map(known.stamps);
    for (const path of changedPaths(known.document, document)) {
      const previous = known.stamps.get(path);
      if (previous !== undefined && compareStamps(previous, stamp) > 0) {
        setAtPath(document, path, valueAtPath(known.document, path));
      } else {
        stamps.set(path, stamp);
      }
    }
    stamps.set(outsideMarkPath(writer), stamp);
    known = { document, stamps };
    lastStored = stampedOf(parsed);
  };

  /** Takes in a document from storage or from another window; true when it lacked something. */
  const absorb = (parsed: Parsed): boolean => {
    storedVersion = Math.max(storedVersion, parsed.storedVersion);
    const theirs = stampedOf(parsed);
    const { merged, mineWon } = mergeStamped(known, theirs);
    known = merged;
    lastStored = theirs;
    return mineWon;
  };

  /**
   * Takes in a stored text. `written` is true when another window has just written it (an event),
   * false when it was read from this window's copy, which may be older than what the window knows.
   * True when the text lacked something this window knows.
   */
  const takeIn = (text: string | null, written: boolean): boolean => {
    const parsed = parseSettings(text);
    if (parsed.unstamped && text !== null && (written || !seenUnstamped.has(text))) {
      seenUnstamped.add(text);
      replaceWith(parsed, text);
      return false;
    }
    return absorb(parsed);
  };

  const stopListening = storage.onExternalChange((text) => {
    // The common case after a repair: the other window wrote exactly what this one knows.
    if (typeof text === 'string' && text === serializeSettings(known, storedVersion)) {
      lastStored = known;
      return;
    }
    if (text === null) {
      // The document was removed (or the whole storage cleared): start again from the defaults.
      const parsed = parseSettings(null);
      known = stampedOf(parsed);
      lastStored = known;
      storedVersion = parsed.storedVersion;
      cancelRepair?.();
      cancelRepair = null;
    } else if (text === undefined ? takeIn(readText(), true) : takeIn(text, true)) {
      // The other window wrote without one of this window's newer settings: put it back.
      repair();
    }
    const next = view();
    if (sameJson(next, current)) return;
    current = next;
    notify();
  });

  return {
    get: () => current,

    update(change) {
      takeIn(readText(), false);
      const base = view();
      const next = change(structuredClone(base));
      const paths = changedPaths(base as unknown as JsonObject, next as unknown as JsonObject);
      if (paths.length > 0) {
        const stamp = nextStamp();
        const document = structuredClone(known.document);
        const stamps = new Map(known.stamps);
        for (const path of paths) {
          setAtPath(document, path, valueAtPath(next as unknown as JsonObject, path));
          stamps.set(path, stamp);
        }
        known = { document, stamps };
        // The layout goes to storage only when this change touched it; otherwise the stored layout
        // (possibly another window's) stays as it is.
        if (paths.includes('app.layout')) ownLayout = next.app.layout;
      }
      write();
      current = view();
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      // A write-back that is still waiting is made now: the window may be closing.
      if (cancelRepair !== null && mergeStamped(known, lastStored).mineWon) write();
      cancelRepair?.();
      cancelRepair = null;
      stopListening();
      listeners.clear();
    },
  };
}

/** A storage in memory. Several services created on one MemorySettingsStorage behave like several
 *  windows on one origin: a write by one is reported to the others at once, with the text written
 *  (the `storage` event and its `newValue`). */
export class MemorySettingsStorage {
  text: string | null;
  private readonly windows = new Set<{ listeners: Set<(text?: string | null) => void> }>();

  constructor(initial: string | null = null) {
    this.text = initial;
  }

  /** The storage as one window sees it. */
  window(): SettingsStorage {
    const self = { listeners: new Set<(text?: string | null) => void>() };
    this.windows.add(self);
    return {
      read: () => this.text,
      write: (text) => {
        this.text = text;
        for (const other of this.windows) {
          if (other !== self) for (const listener of [...other.listeners]) listener(text);
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
