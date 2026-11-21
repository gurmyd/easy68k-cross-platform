// The application store (ARCHITECTURE.md 3.12.1). Owner: W3.
//
// A store is a value, a way to replace it and a list of listeners. `AppState` (contracts/store.ts)
// is what the store of the application holds: the mode, the open documents, the simulator's
// status flags and revision counters, the open dialogs and a mirror of the settings. Large or
// fast-changing data (memory, pixels, listing rows, register values) is NOT here: components read
// it from `ctx.sim` when the matching revision counter changes.
//
// React components read the store with `useAppState` (state/context.tsx), which is built on
// `useStoreValue` below.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { AppState, Mode, Settings, Store } from '../contracts';

/** A store holding `initial`. setState is synchronous; listeners run after the update. */
export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState(update) {
      const next = update(state);
      if (Object.is(next, state)) return;
      state = next;
      // A listener may unsubscribe (or subscribe) while the list is walked.
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The state of a window that has just started: Editor mode, nothing open, the simulator idle. */
export function initialAppState(settings: Settings, mode: Mode = 'editor'): AppState {
  return {
    mode,
    documents: { items: [], activeId: null },
    messages: {},
    assemble: {},
    sim: {
      program: null,
      phase: 'idle',
      menuState: 0,
      halted: false,
      autoTrace: false,
      keyCommands: true,
      logging: false,
      regsRevision: 0,
      viewRevision: 0,
      liveRevision: 0,
      selectedRow: -1,
      messageLines: [],
      breakpoints: [],
      output: { width: 640, height: 480, fullScreen: false, textWrap: false },
    },
    dialogs: { stack: [] },
    settings,
  };
}

export function createAppStore(settings: Settings, mode: Mode = 'editor'): Store<AppState> {
  return createStore(initialAppState(settings, mode));
}

/**
 * The part of a store's state that `selector` picks, re-rendering the component only when that
 * part changes. `isEqual` decides what "changes" means (default: Object.is); pass a comparison
 * for selectors that build a new object or array on every call.
 */
export function useStoreValue<S, T>(
  store: Store<S>,
  selector: (state: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  // The selector of the latest render (components usually pass a new arrow function every time).
  const latest = useRef({ selector, isEqual });
  latest.current = { selector, isEqual };
  // useSyncExternalStore needs a snapshot that stays the same value while nothing changed.
  const cache = useRef<{ state: S; selector: (state: S) => T; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.getState();
    const { selector: select, isEqual: equal } = latest.current;
    const previous = cache.current;
    if (previous && Object.is(previous.state, state) && previous.selector === select) return previous.value;
    const selected = select(state);
    const value = previous && equal(previous.value, selected) ? previous.value : selected;
    cache.current = { state, selector: select, value };
    return value;
  }, [store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** Shallow comparison of two arrays or two plain objects, for `isEqual`. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
