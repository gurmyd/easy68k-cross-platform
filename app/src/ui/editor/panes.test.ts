import { describe, expect, it } from 'vitest';
import { INITIAL_PANES, activatePane, moveToOtherPane, paneViews, syncPanes, tilePanes } from './panes';

describe('panes of the editor area (2.2, note 9)', () => {
  it('one pane holds every document in the order of opening; the active one is shown', () => {
    const state = syncPanes(INITIAL_PANES, ['a', 'b', 'c'], 'b');
    const [first, second] = paneViews(state, 'one', ['a', 'b', 'c'], 'b');
    expect(first).toEqual({ ids: ['a', 'b', 'c'], selected: 'b' });
    expect(second).toEqual({ ids: [], selected: null });
  });

  it('Tile with two or more documents moves the active document to the second pane', () => {
    const ids = ['a', 'b', 'c'];
    const state = tilePanes(syncPanes(INITIAL_PANES, ids, 'c'), ids, 'c');
    const [first, second] = paneViews(state, 'horizontal', ids, 'c');
    expect(first).toEqual({ ids: ['a', 'b'], selected: 'b' });
    expect(second).toEqual({ ids: ['c'], selected: 'c' });
  });

  it('Tile with one document leaves the second pane empty', () => {
    const state = tilePanes(INITIAL_PANES, ['a'], 'a');
    const [first, second] = paneViews(state, 'vertical', ['a'], 'a');
    expect(first.ids).toEqual(['a']);
    expect(second).toEqual({ ids: [], selected: null });
  });

  it('a new document opens in the active pane', () => {
    let state = tilePanes(syncPanes(INITIAL_PANES, ['a', 'b'], 'b'), ['a', 'b'], 'b');
    // b is in pane 1 and active: a new document goes there.
    state = syncPanes(state, ['a', 'b', 'n'], 'n');
    expect(paneViews(state, 'vertical', ['a', 'b', 'n'], 'n')[1].ids).toEqual(['b', 'n']);
    // Activating a document of pane 0 makes pane 0 the active pane.
    state = syncPanes(state, ['a', 'b', 'n'], 'a');
    state = syncPanes(state, ['a', 'b', 'n', 'm'], 'm');
    expect(paneViews(state, 'vertical', ['a', 'b', 'n', 'm'], 'm')[0].ids).toEqual(['a', 'm']);
  });

  it('each pane keeps showing its last document while the other pane is active', () => {
    let state = tilePanes(syncPanes(INITIAL_PANES, ['a', 'b', 'c'], 'a'), ['a', 'b', 'c'], 'a');
    // a moved to pane 1; pane 0 shows c (the last of the others).
    state = syncPanes(state, ['a', 'b', 'c'], 'b');
    state = syncPanes(state, ['a', 'b', 'c'], 'a');
    const [first, second] = paneViews(state, 'horizontal', ['a', 'b', 'c'], 'a');
    expect(first.selected).toBe('b');
    expect(second.selected).toBe('a');
  });

  it('Cascade (one pane) gathers everything again; closed documents are forgotten', () => {
    let state = tilePanes(syncPanes(INITIAL_PANES, ['a', 'b'], 'b'), ['a', 'b'], 'b');
    expect(paneViews(state, 'one', ['a', 'b'], 'b')[0].ids).toEqual(['a', 'b']);
    state = syncPanes(state, ['a'], 'a');
    expect(Object.keys(state.pane)).toEqual(['a']);
  });

  it('moving a document across and activating an empty pane', () => {
    let state = syncPanes(INITIAL_PANES, ['a', 'b'], 'a');
    state = moveToOtherPane(state, 'a');
    expect(paneViews(state, 'vertical', ['a', 'b'], 'a')[1].ids).toEqual(['a']);
    state = activatePane(state, 0);
    expect(state.activePane).toBe(0);
    expect(syncPanes(state, ['a', 'b'], null)).toBe(state);
  });
});
