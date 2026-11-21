// The store (ARCHITECTURE.md 3.12.1) and its React hook.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../core/settings/defaults';
import { createAppStore, createStore, initialAppState, shallowEqual, useStoreValue } from './store';

describe('createStore', () => {
  it('replaces the state synchronously and runs the listeners after the update', () => {
    const store = createStore({ count: 0 });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.getState().count));
    store.setState((state) => ({ count: state.count + 1 }));
    expect(store.getState().count).toBe(1);
    store.setState((state) => ({ count: state.count + 1 }));
    expect(seen).toEqual([1, 2]);
  });

  it('does not notify when the update returns the same state', () => {
    const store = createStore({ count: 0 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setState((state) => state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('lets a listener unsubscribe itself or another while listeners run', () => {
    const store = createStore(0);
    const calls: string[] = [];
    const stopB = store.subscribe(() => calls.push('b'));
    const stopA = store.subscribe(() => {
      calls.push('a');
      stopA();
      stopB();
    });
    store.setState((n) => n + 1);
    store.setState((n) => n + 1);
    // Both ran once (the list was copied before the walk), then neither.
    expect(calls).toEqual(['b', 'a']);
  });
});

describe('initialAppState', () => {
  it('starts in Editor mode with an idle simulator and the given settings', () => {
    const settings = defaultSettings();
    const state = initialAppState(settings);
    expect(state.mode).toBe('editor');
    expect(state.documents).toEqual({ items: [], activeId: null });
    expect(state.dialogs.stack).toEqual([]);
    expect(state.settings).toBe(settings);
    expect(state.sim).toMatchObject({
      program: null,
      phase: 'idle',
      menuState: 0,
      halted: false,
      keyCommands: true,
      logging: false,
      selectedRow: -1,
      output: { width: 640, height: 480, fullScreen: false, textWrap: false },
    });
    expect(createAppStore(settings, 'simulator').getState().mode).toBe('simulator');
  });
});

describe('useStoreValue', () => {
  it('gives a component the selected part of the state', () => {
    const store = createStore({ name: 'prog.X68', revision: 7 });
    function Name() {
      return <b>{useStoreValue(store, (state) => state.name)}</b>;
    }
    expect(renderToStaticMarkup(<Name />)).toBe('<b>prog.X68</b>');
  });

  it('accepts a selector that builds a new object when a comparison is given', () => {
    const store = createStore({ a: 1, b: 2 });
    function Sum() {
      const { total } = useStoreValue(store, (state) => ({ total: state.a + state.b }), shallowEqual);
      return <i>{total}</i>;
    }
    expect(renderToStaticMarkup(<Sum />)).toBe('<i>3</i>');
  });
});

describe('shallowEqual', () => {
  it('compares one level of arrays and plain objects', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual([1, 2], [2, 1])).toBe(false);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
    expect(shallowEqual(null, null)).toBe(true);
    expect(shallowEqual<unknown>([], {})).toBe(false);
  });
});
