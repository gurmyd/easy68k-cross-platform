// readDock: every malformed case of P4.2 gives the default; the lock is true unless false is stored.

import { describe, expect, it } from 'vitest';
import type { DockNode, Settings } from '../../contracts';
import { defaultSettings } from '../../core/settings/defaults';
import { readDock, withDock } from './stored';

const withRaw = (dock: unknown): Settings => {
  const settings = defaultSettings();
  return { ...settings, app: { ...settings.app, layout: { ...settings.app.layout, dock: dock as never } } };
};

const group = (panels: string[], selected = panels[0]!, weight = 1): DockNode => ({
  type: 'tabs',
  weight,
  panels,
  selected,
});
const EDITOR: DockNode = { type: 'row', weight: 1, children: [group(['files']), group(['editor', 'messages'])] };

describe('readDock', () => {
  it('reads a valid arrangement', () => {
    expect(readDock(withRaw({ version: 1, editor: EDITOR })).editor).toEqual(EDITOR);
  });

  it('absent, or a document of another version: the defaults, locked', () => {
    expect(readDock(defaultSettings())).toEqual({ locked: true, parked: {} });
    expect(readDock(withRaw({ version: 2, locked: false, editor: EDITOR }))).toEqual({ locked: true, parked: {} });
    expect(readDock(withRaw('nonsense'))).toEqual({ locked: true, parked: {} });
  });

  it('the lock: absent = true (D2), a stored boolean as stored, anything else = true', () => {
    expect(readDock(withRaw({ version: 1 })).locked).toBe(true);
    expect(readDock(withRaw({ version: 1, locked: false })).locked).toBe(false);
    expect(readDock(withRaw({ version: 1, locked: true })).locked).toBe(true);
    expect(readDock(withRaw({ version: 1, locked: 'no' })).locked).toBe(true);
  });

  const malformed: [string, unknown][] = [
    ['a node of an unknown type', { type: 'grid', weight: 1, children: [group(['editor']), group(['messages'])] }],
    ['a weight of zero', { ...EDITOR, weight: 0 }],
    [
      'a negative weight',
      { type: 'row', weight: 1, children: [group(['files'], 'files', -2), group(['editor', 'messages'])] },
    ],
    ['a weight that is not finite', { ...EDITOR, weight: Infinity }],
    ['a weight that is not a number', { ...EDITOR, weight: '3' }],
    [
      'a group without panels',
      {
        type: 'row',
        weight: 1,
        children: [group(['editor', 'messages']), { type: 'tabs', weight: 1, panels: [], selected: '' }],
      },
    ],
    [
      'a selected panel the group does not list',
      { type: 'row', weight: 1, children: [group(['files']), group(['editor', 'messages'], 'files')] },
    ],
    [
      'a panel of the other mode',
      { type: 'row', weight: 1, children: [group(['memory']), group(['editor', 'messages'])] },
    ],
    ['an unknown panel', { type: 'row', weight: 1, children: [group(['nonsense']), group(['editor', 'messages'])] }],
    [
      'a viewer (never stored)',
      { type: 'row', weight: 1, children: [group(['viewer:1']), group(['editor', 'messages'])] },
    ],
    ['a panel listed twice', { type: 'row', weight: 1, children: [group(['editor']), group(['editor', 'messages'])] }],
    ['a panel listed twice in one group', group(['editor', 'messages', 'editor'])],
    ['no Editor panel (it cannot be closed)', group(['files', 'messages'])],
    ['no Messages panel (it cannot be closed)', group(['files', 'editor'])],
    ['a container without children', { type: 'row', weight: 1, children: [] }],
    ['children that are not a list', { type: 'row', weight: 1, children: 'x' }],
    ['not an object', 42],
  ];
  for (const [name, tree] of malformed) {
    it(`replaces a tree with ${name} by the default arrangement`, () => {
      const read = readDock(withRaw({ version: 1, locked: false, editor: tree, simulator: tree }));
      expect(read.editor).toBeUndefined();
      expect(read.simulator).toBeUndefined();
      // The rest of the document is kept.
      expect(read.locked).toBe(false);
    });
  }

  it('a Simulator tree must hold Registers, Listing, Messages and Output', () => {
    const missing: DockNode = {
      type: 'row',
      weight: 1,
      children: [group(['registers', 'listing', 'messages']), group(['memory'])],
    };
    expect(readDock(withRaw({ version: 1, simulator: missing })).simulator).toBeUndefined();
    const complete: DockNode = {
      type: 'row',
      weight: 1,
      children: [group(['registers', 'listing', 'messages']), group(['output', 'memory'])],
    };
    expect(readDock(withRaw({ version: 1, simulator: complete })).simulator).toEqual(complete);
  });

  it('keeps only the parked places that are well formed', () => {
    const read = readDock(
      withRaw({
        version: 1,
        parked: { files: { near: 'editor', side: 'left' }, memory: { near: 'output', side: 'diagonal' }, stack: 'x' },
      }),
    );
    expect(read.parked).toEqual({ files: { near: 'editor', side: 'left' } });
  });
});

describe('withDock', () => {
  it('writes the changed dock and returns the same object when nothing changes', () => {
    const settings = defaultSettings();
    expect(withDock(settings, (dock) => dock)).toBe(settings);
    const next = withDock(settings, (dock) => ({ ...dock, editor: EDITOR }));
    expect(next.app.layout.dock).toEqual({ version: 1, editor: EDITOR });
    expect(next.app.layout.panels).toBe(settings.app.layout.panels);
    expect(withDock(next, (dock) => dock)).toBe(next);
    const unlocked = withDock(next, (dock) => ({ ...dock, locked: false }));
    expect(unlocked.app.layout.dock).toEqual({ version: 1, locked: false, editor: EDITOR });
  });
});
