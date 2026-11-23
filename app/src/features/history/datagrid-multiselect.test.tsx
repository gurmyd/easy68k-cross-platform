// The kit's DataGrid with `multiSelect` (ARCHITECTURE-PLUS P3.2.1, P1.3, P3.3.8), added by N4 for the
// Trash. The steps are a pure function; the markup is rendered on the server (no DOM). The keys in
// a real browser are checked by check-history-ui.mjs and the gallery's check.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataGrid, gridMultiSelectStep, type GridMultiState } from '../../ui/components/DataGrid';

const state = (focus: number, anchor: number, selected: number[]): GridMultiState => ({
  focus,
  anchor,
  selected: new Set(selected),
});
const sorted = (s: GridMultiState) => ({
  focus: s.focus,
  anchor: s.anchor,
  selected: [...s.selected].sort((a, b) => a - b),
});

describe('the selection rules of P3.2.1 and the keys of P1.3', () => {
  it.each([
    [
      'click selects one row and makes it the anchor',
      state(0, 0, [0, 1]),
      { kind: 'click', row: 3, shift: false, toggle: false },
      { focus: 3, anchor: 3, selected: [3] },
    ],
    [
      'Shift+click selects the range from the anchor',
      state(1, 1, [1]),
      { kind: 'click', row: 4, shift: true, toggle: false },
      { focus: 4, anchor: 1, selected: [1, 2, 3, 4] },
    ],
    [
      'Shift+click upwards',
      state(4, 4, [4]),
      { kind: 'click', row: 2, shift: true, toggle: false },
      { focus: 2, anchor: 4, selected: [2, 3, 4] },
    ],
    [
      'Ctrl+click adds a row and makes it the anchor',
      state(1, 1, [1]),
      { kind: 'click', row: 3, shift: false, toggle: true },
      { focus: 3, anchor: 3, selected: [1, 3] },
    ],
    [
      'Ctrl+click removes a row',
      state(3, 3, [1, 3]),
      { kind: 'click', row: 1, shift: false, toggle: true },
      { focus: 1, anchor: 1, selected: [3] },
    ],
    [
      'Up / Down select one row',
      state(2, 0, [0, 1, 2]),
      { kind: 'move', row: 3, extend: false, focusOnly: false },
      { focus: 3, anchor: 3, selected: [3] },
    ],
    [
      'Shift+Down extends from the anchor',
      state(2, 2, [2]),
      { kind: 'move', row: 3, extend: true, focusOnly: false },
      { focus: 3, anchor: 2, selected: [2, 3] },
    ],
    [
      'Shift+Up past the anchor',
      state(3, 2, [2, 3]),
      { kind: 'move', row: 1, extend: true, focusOnly: false },
      { focus: 1, anchor: 2, selected: [1, 2] },
    ],
    [
      'Ctrl+Down moves the focus without selecting',
      state(1, 1, [1]),
      { kind: 'move', row: 2, extend: false, focusOnly: true },
      { focus: 2, anchor: 1, selected: [1] },
    ],
    [
      'Ctrl+Space adds the focused row',
      state(2, 1, [1]),
      { kind: 'toggle' },
      { focus: 2, anchor: 2, selected: [1, 2] },
    ],
    [
      'Ctrl+Space removes the focused row',
      state(1, 1, [1, 2]),
      { kind: 'toggle' },
      { focus: 1, anchor: 1, selected: [2] },
    ],
    [
      'Ctrl+A selects every row',
      state(1, 1, [1]),
      { kind: 'all', rows: 4 },
      { focus: 1, anchor: 1, selected: [0, 1, 2, 3] },
    ],
    [
      'an anchor that is not set starts at the focused row',
      state(2, -1, [2]),
      { kind: 'click', row: 0, shift: true, toggle: false },
      { focus: 0, anchor: 2, selected: [0, 1, 2] },
    ],
  ] as const)('%s', (_name, before, step, after) => {
    expect(sorted(gridMultiSelectStep(before, step))).toEqual(after);
  });

  it('a click sequence: click, Shift+click, Ctrl+click, Shift+click from the new anchor', () => {
    let s = state(0, -1, []);
    s = gridMultiSelectStep(s, { kind: 'click', row: 1, shift: false, toggle: false });
    s = gridMultiSelectStep(s, { kind: 'click', row: 3, shift: true, toggle: false });
    expect(sorted(s).selected).toEqual([1, 2, 3]);
    s = gridMultiSelectStep(s, { kind: 'click', row: 6, shift: false, toggle: true });
    expect(sorted(s).selected).toEqual([1, 2, 3, 6]);
    s = gridMultiSelectStep(s, { kind: 'click', row: 4, shift: true, toggle: false });
    expect(sorted(s)).toEqual({ focus: 4, anchor: 6, selected: [4, 5, 6] });
  });
});

describe('markup', () => {
  const columns = [{ id: 'name', header: 'Name' }];
  const rows = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  const grid = (multi?: Set<number>) =>
    renderToStaticMarkup(
      <DataGrid
        label="Items"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.name}
        selectedRow={1}
        onSelectRow={() => {}}
        {...(multi ? { multiSelect: { selected: multi, onChange: () => {} } } : {})}
      />,
    );

  it('with multiSelect: aria-multiselectable, and each selected row is aria-selected', () => {
    const out = grid(new Set([0, 2]));
    expect(out).toContain('aria-multiselectable="true"');
    expect(out.match(/aria-selected="true"/g)?.length).toBe(2);
    expect(out).toMatch(/aria-selected="true" data-row="0"/);
    expect(out).toMatch(/aria-selected="false" data-row="1"/);
    expect(out).toMatch(/aria-selected="true" data-row="2"/);
    // The focused row is still the active descendant.
    expect(out).toMatch(/aria-activedescendant="[^"]*-r1c0"/);
  });

  it('without multiSelect the markup is what it was: one selected row, no aria-multiselectable', () => {
    const out = grid();
    expect(out).not.toContain('aria-multiselectable');
    expect(out.match(/aria-selected="true"/g)?.length).toBe(1);
    expect(out).toMatch(/aria-selected="true" data-row="1"/);
  });
});
