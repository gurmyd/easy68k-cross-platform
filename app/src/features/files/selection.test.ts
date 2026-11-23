// The selection rules of ARCHITECTURE-PLUS P3.2.1 and the keys of P1.3, as tables of clicks and
// keys, under Node.

import { describe, expect, it } from 'vitest';
import { normalizeChord } from '../../commands/chords';
import { chordsOn } from '../../commands/specs';
import {
  FilesSelection,
  focusAfterDelete,
  isToggleClick,
  ownKeysAttribute,
  selectionKeyOf,
  type SelectableRow,
} from './selection';

const ROWS: SelectableRow[] = [
  { path: '/browser', root: true },
  { path: '/browser/a', root: false },
  { path: '/browser/b', root: false },
  { path: '/browser/c', root: false },
  { path: '/browser/d', root: false },
  { path: '/folder', root: true },
  { path: '/folder/x', root: false },
];

type Step = ['click', string] | ['shift', string] | ['toggle', string] | ['focus', string] | ['all'] | ['clear'];

function run(steps: Step[]) {
  const selection = new FilesSelection((path) => ROWS.find((row) => row.path === path)?.root ?? false);
  for (const step of steps) {
    switch (step[0]) {
      case 'click':
        selection.click(step[1]);
        break;
      case 'shift':
        selection.range(step[1], ROWS);
        break;
      case 'toggle':
        selection.toggle(step[1]);
        break;
      case 'focus':
        selection.moveFocus(step[1]);
        break;
      case 'all':
        selection.all(ROWS);
        break;
      case 'clear':
        selection.clear();
        break;
    }
  }
  return { selected: selection.ordered(ROWS), anchor: selection.anchor, focus: selection.focus };
}

const p = (...names: string[]) => names.map((n) => (n.startsWith('/') ? n : `/browser/${n}`));

describe('the selection of the Files panel (P3.2.1)', () => {
  const table: [string, Step[], string[], string | null, string | null][] = [
    // name, steps, selected, anchor, focus
    ['a click selects one row', [['click', '/browser/b']], p('b'), '/browser/b', '/browser/b'],
    [
      'a second click replaces it',
      [
        ['click', '/browser/b'],
        ['click', '/browser/d'],
      ],
      p('d'),
      '/browser/d',
      '/browser/d',
    ],
    [
      'Shift+click selects the range from the anchor',
      [
        ['click', '/browser/b'],
        ['shift', '/browser/d'],
      ],
      p('b', 'c', 'd'),
      '/browser/b',
      '/browser/d',
    ],
    [
      'Shift+click upwards, then again: the anchor stays',
      [
        ['click', '/browser/c'],
        ['shift', '/browser/a'],
        ['shift', '/browser/d'],
      ],
      p('c', 'd'),
      '/browser/c',
      '/browser/d',
    ],
    [
      'Ctrl+click adds a row and makes it the anchor',
      [
        ['click', '/browser/a'],
        ['toggle', '/browser/c'],
        ['shift', '/browser/d'],
      ],
      p('c', 'd'),
      '/browser/c',
      '/browser/d',
    ],
    [
      'Ctrl+click removes a selected row',
      [
        ['click', '/browser/a'],
        ['toggle', '/browser/c'],
        ['toggle', '/browser/a'],
      ],
      p('c'),
      '/browser/a',
      '/browser/a',
    ],
    ['a root alone can be selected', [['click', '/browser']], ['/browser'], '/browser', '/browser'],
    [
      'adding a row to a root drops the root',
      [
        ['click', '/browser'],
        ['toggle', '/browser/b'],
      ],
      p('b'),
      '/browser/b',
      '/browser/b',
    ],
    [
      'adding a root to rows drops the root',
      [
        ['click', '/browser/b'],
        ['toggle', '/folder'],
      ],
      p('b'),
      '/folder',
      '/folder',
    ],
    [
      'a range over a root leaves the root out',
      [
        ['click', '/browser/d'],
        ['shift', '/folder/x'],
      ],
      ['/browser/d', '/folder/x'],
      '/browser/d',
      '/folder/x',
    ],
    [
      'Ctrl+arrows move the focus without selecting; Ctrl+Space adds the focused row',
      [
        ['click', '/browser/a'],
        ['focus', '/browser/c'],
        ['toggle', '/browser/c'],
      ],
      p('a', 'c'),
      '/browser/c',
      '/browser/c',
    ],
    [
      'Ctrl+A selects every visible row but the roots',
      [['click', '/browser/a'], ['all']],
      [...p('a', 'b', 'c', 'd'), '/folder/x'],
      '/browser/a',
      '/browser/a',
    ],
    [
      'Esc clears a multiple selection to the focused row',
      [['click', '/browser/a'], ['shift', '/browser/c'], ['clear']],
      p('c'),
      '/browser/c',
      '/browser/c',
    ],
    ['Esc with one row changes nothing', [['click', '/browser/a'], ['clear']], p('a'), '/browser/a', '/browser/a'],
  ];
  for (const [name, steps, selected, anchor, focus] of table) {
    it(name, () => {
      expect(run(steps)).toEqual({ selected, anchor, focus });
    });
  }

  it('an item that is removed leaves the selection, the others stay', () => {
    const selection = new FilesSelection(() => false);
    selection.click('/browser/a');
    selection.range('/browser/c', ROWS);
    selection.prune((path) => path !== '/browser/b');
    expect(selection.ordered(ROWS)).toEqual(p('a', 'c'));
  });

  it('the selection is given in the order of the tree, whatever the order it was made in', () => {
    const selection = new FilesSelection(() => false);
    selection.click('/browser/d');
    selection.toggle('/browser/a');
    selection.toggle('/browser/c');
    expect(selection.ordered(ROWS)).toEqual(p('a', 'c', 'd'));
  });
});

describe('the keys of the Files tree (P1.3)', () => {
  const key = (k: string, mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({
    key: k,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  });
  const table: [string, ReturnType<typeof key> & { code?: string }, 'windows' | 'mac' | 'linux', unknown][] = [
    ['Shift+Up extends', key('ArrowUp', { shiftKey: true }), 'windows', { kind: 'extend', key: 'ArrowUp' }],
    ['Shift+Down extends', key('ArrowDown', { shiftKey: true }), 'mac', { kind: 'extend', key: 'ArrowDown' }],
    ['Shift+Home extends', key('Home', { shiftKey: true }), 'linux', { kind: 'extend', key: 'Home' }],
    ['Shift+End extends', key('End', { shiftKey: true }), 'windows', { kind: 'extend', key: 'End' }],
    [
      'Ctrl+Up moves the focus (Windows)',
      key('ArrowUp', { ctrlKey: true }),
      'windows',
      { kind: 'focus', key: 'ArrowUp' },
    ],
    [
      'Option+Down moves the focus (macOS)',
      key('ArrowDown', { altKey: true }),
      'mac',
      { kind: 'focus', key: 'ArrowDown' },
    ],
    ['Ctrl+Up on macOS is Mission Control: not ours', key('ArrowUp', { ctrlKey: true }), 'mac', null],
    ['Ctrl+Space toggles (Windows)', key(' ', { ctrlKey: true }), 'windows', { kind: 'toggle' }],
    ['Option+Space toggles (macOS)', key(' ', { altKey: true }), 'mac', { kind: 'toggle' }],
    [
      'Option+Space on a real Mac (key is a no-break space) toggles',
      { ...key('\u00a0', { altKey: true }), code: 'Space' },
      'mac',
      { kind: 'toggle' },
    ],
    [
      'Option+Space by position alone toggles',
      { ...key('Unidentified', { altKey: true }), code: 'Space' },
      'mac',
      { kind: 'toggle' },
    ],
    ['Esc clears', key('Escape'), 'mac', { kind: 'clear' }],
    ['Delete deletes', key('Delete'), 'windows', { kind: 'delete' }],
    ['Cmd+Backspace deletes on macOS', key('Backspace', { metaKey: true }), 'mac', { kind: 'delete' }],
    ['Backspace alone does nothing', key('Backspace'), 'mac', null],
    ['plain Up is the tree view rule, not a selection key', key('ArrowUp'), 'windows', null],
  ];
  for (const [name, event, os, expected] of table) {
    it(name, () => {
      expect(selectionKeyOf(event, os)).toEqual(expected);
    });
  }

  it('Ctrl+click toggles on Windows and Linux, Cmd+click on macOS', () => {
    expect(isToggleClick({ ctrlKey: true, metaKey: false }, 'windows')).toBe(true);
    expect(isToggleClick({ ctrlKey: true, metaKey: false }, 'linux')).toBe(true);
    expect(isToggleClick({ ctrlKey: false, metaKey: true }, 'mac')).toBe(true);
    expect(isToggleClick({ ctrlKey: true, metaKey: false }, 'mac')).toBe(false);
  });

  it('data-e68-own-keys is exactly the chords of Select All, Undo and Redo on each key map, normalised', () => {
    expect(ownKeysAttribute('windows')).toBe('Ctrl+A Ctrl+Z Ctrl+Alt+Z');
    expect(ownKeysAttribute('linux')).toBe('Ctrl+A Ctrl+Z Ctrl+Alt+Z');
    expect(ownKeysAttribute('mac')).toBe('Cmd+A Ctrl+A Cmd+Z Ctrl+Z Shift+Cmd+Z Ctrl+Alt+Z');
    for (const os of ['windows', 'linux', 'mac'] as const) {
      const expected = (['ed.edit.selectAll', 'ed.edit.undo', 'ed.edit.redo'] as const).flatMap((id) =>
        chordsOn(id, os, false).map(normalizeChord),
      );
      const tokens = ownKeysAttribute(os).split(' ');
      expect(tokens).toEqual(expected);
      for (const token of tokens) expect(normalizeChord(token)).toBe(token);
    }
  });
});

describe('the focus after a delete (P3.2.2)', () => {
  const rootOf = (path: string) => `/${path.split('/')[1]}`;
  it('the row after the last deleted row', () => {
    expect(focusAfterDelete(ROWS, p('a', 'b'), rootOf)).toBe('/browser/c');
  });
  it('else the row before the first', () => {
    const rows = ROWS.slice(0, 5);
    expect(focusAfterDelete(rows, p('c', 'd'), rootOf)).toBe('/browser/b');
  });
  it('else the store root', () => {
    expect(focusAfterDelete([{ path: '/browser/a', root: false }], p('a'), rootOf)).toBe('/browser');
  });
  it('rows below a deleted folder are skipped', () => {
    const rows: SelectableRow[] = [
      { path: '/browser', root: true },
      { path: '/browser/demo', root: false },
      { path: '/browser/demo/x', root: false },
      { path: '/browser/z', root: false },
    ];
    expect(focusAfterDelete(rows, ['/browser/demo'], rootOf)).toBe('/browser/z');
  });
});
