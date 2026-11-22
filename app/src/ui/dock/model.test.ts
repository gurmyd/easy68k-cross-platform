// The dock's model options (P2.2, one row each) and the conversion between DockNode and
// FlexLayout's JSON (P4.2): a round trip for the default trees and for 50 random valid trees.

import { Model } from 'flexlayout-react';
import { describe, expect, it } from 'vitest';
import type { DockNode } from '../../contracts';
import {
  DOCK_KEY_MAP,
  DOCK_PANELS,
  defaultTree,
  fromFlexJson,
  globalAttributes,
  isClosablePanel,
  needsStrip,
  normalizeDock,
  panelOfTab,
  panelsOf,
  tabIdOf,
  toFlexJson,
  type DockMode,
} from './model';

const options = (mode: DockMode, locked = true) => ({ mode, locked, title: (panel: string) => panel.toUpperCase() });

/** Through FlexLayout's own model and back: Model.fromJson(json).toJson().layout. */
function roundTrip(tree: DockNode, mode: DockMode): DockNode | null {
  const model = Model.fromJson(toFlexJson(tree, options(mode)));
  return fromFlexJson(model.toJson().layout);
}

describe('the model options of P2.2', () => {
  const rows: [keyof ReturnType<typeof globalAttributes>, unknown][] = [
    ['tabEnableRenderOnDemand', false],
    ['tabEnablePopout', false],
    ['tabEnableFloat', false],
    ['tabEnableRename', false],
    ['tabSetEnableMaximize', false],
    // P2.2 says false; FlexLayout 0.11.1 deletes an empty group only when the group "can be
    // closed", so it is true and the close button is off (errata N1).
    ['tabSetEnableClose', true],
    ['tabSetEnableTabGroups', false],
    ['tabSetEnableActiveIcon', false],
    ['tabSetEnableCloseButton', false],
    ['tabSetEnableDeleteWhenEmpty', true],
    ['enableEdgeDock', true],
  ];
  for (const [name, value] of rows) {
    it(`${name}: ${String(value)}`, () => {
      expect(globalAttributes(true)[name]).toBe(value);
      expect(globalAttributes(false)[name]).toBe(value);
    });
  }

  it('no borders', () => {
    expect(
      toFlexJson(defaultTree('editor', { visible: () => true, narrow: false }), options('editor')).borders,
    ).toEqual([]);
  });

  it('locked: no tab and no group can be dragged; unlocked: both can', () => {
    expect(globalAttributes(true).tabEnableDrag).toBe(false);
    expect(globalAttributes(true).tabSetEnableDrag).toBe(false);
    expect(globalAttributes(false).tabEnableDrag).toBe(true);
    expect(globalAttributes(false).tabSetEnableDrag).toBe(true);
    // ...and FlexLayout's model says so for every tab.
    const model = Model.fromJson(
      toFlexJson(defaultTree('simulator', { visible: () => true, narrow: false }), options('simulator')),
    );
    model.visitNodes((node) => {
      if (node.getType() === 'tab') expect((node as unknown as { isEnableDrag(): boolean }).isEnableDrag()).toBe(false);
    });
  });

  it('the key map: closeTab is Delete, every other binding is passed explicitly as undefined', () => {
    expect(Object.keys(DOCK_KEY_MAP).sort()).toEqual(
      [
        'closeOverlayBorder',
        'closeTab',
        'focusNextTabset',
        'focusPreviousTabset',
        'focusTabToggle',
        'renameTab',
      ].sort(),
    );
    expect(DOCK_KEY_MAP.closeTab).toBe('Delete');
    for (const key of [
      'renameTab',
      'focusTabToggle',
      'focusNextTabset',
      'focusPreviousTabset',
      'closeOverlayBorder',
    ] as const) {
      expect(key in DOCK_KEY_MAP, key).toBe(true);
      expect(DOCK_KEY_MAP[key], key).toBeUndefined();
    }
  });

  it('per tab: enableClose only for files, the tool panels and viewers', () => {
    for (const panel of ['files', 'memory', 'stack', 'hardware', 'breakpoints', 'log', 'viewer:3']) {
      expect(isClosablePanel(panel), panel).toBe(true);
    }
    for (const panel of ['editor', 'messages', 'registers', 'listing', 'output'])
      expect(isClosablePanel(panel), panel).toBe(false);
    const json = toFlexJson(
      {
        type: 'row',
        weight: 100,
        children: [
          { type: 'tabs', weight: 1, panels: ['files'], selected: 'files' },
          { type: 'tabs', weight: 1, panels: ['editor', 'messages'], selected: 'editor' },
        ],
      },
      options('editor'),
    );
    const tabs = (json.layout.children ?? []).flatMap(
      (group) => (group as { children?: { id?: string; enableClose?: boolean }[] }).children ?? [],
    );
    expect(tabs.map((tab) => [tab.id, tab.enableClose])).toEqual([
      ['editor:files', true],
      ['editor:editor', false],
      ['editor:messages', false],
    ]);
  });
});

describe('tab strips (P3.1.4)', () => {
  it('locked: only where today shows one (two or more panels, a tool panel, a viewer)', () => {
    expect(needsStrip(['files'], true)).toBe(false);
    expect(needsStrip(['editor'], true)).toBe(false);
    expect(needsStrip(['registers'], true)).toBe(false);
    expect(needsStrip(['output'], true)).toBe(false);
    expect(needsStrip(['memory'], true)).toBe(true);
    expect(needsStrip(['editor', 'viewer:1'], true)).toBe(true);
    expect(needsStrip(['listing', 'messages'], true)).toBe(true);
  });
  it('unlocked: every group', () => {
    for (const panel of DOCK_PANELS.simulator) expect(needsStrip([panel], false)).toBe(true);
  });
});

describe('tab ids', () => {
  it('carry the mode, because both docks share one page', () => {
    expect(tabIdOf('editor', 'messages')).toBe('editor:messages');
    expect(tabIdOf('simulator', 'messages')).toBe('simulator:messages');
    expect(panelOfTab('editor:viewer:12')).toBe('viewer:12');
    expect(panelOfTab('other:thing')).toBeNull();
  });
});

describe('the default trees (P3.1.3)', () => {
  it('Editor: files | editor / messages, and without the Files panel the column alone', () => {
    expect(defaultTree('editor', { visible: () => true, narrow: false })).toEqual({
      type: 'row',
      weight: 100,
      children: [
        { type: 'tabs', weight: 100, panels: ['files'], selected: 'files' },
        {
          type: 'column',
          weight: 100,
          children: [
            { type: 'tabs', weight: 100, panels: ['editor'], selected: 'editor' },
            { type: 'tabs', weight: 100, panels: ['messages'], selected: 'messages' },
          ],
        },
      ],
    });
    expect(panelsOf(defaultTree('editor', { visible: (id) => id !== 'files', narrow: false }))).toEqual([
      'editor',
      'messages',
    ]);
  });

  it('Simulator, wide: the tool group in tab order with the panel in front selected', () => {
    const tree = defaultTree('simulator', {
      visible: (id) => ['memory', 'log', 'hardware'].includes(id),
      narrow: false,
      activeTool: 'log',
    });
    expect(panelsOf(tree)).toEqual(['registers', 'listing', 'messages', 'output', 'memory', 'hardware', 'log']);
    expect(tree.type === 'row' && tree.children[1]?.type === 'column' && tree.children[1].children[1]).toEqual({
      type: 'tabs',
      weight: 100,
      panels: ['memory', 'hardware', 'log'],
      selected: 'log',
    });
    // No tool panel: the Output panel has the right column alone.
    const plain = defaultTree('simulator', { visible: () => false, narrow: false });
    expect(plain.type === 'row' && plain.children[1]).toEqual({
      type: 'tabs',
      weight: 100,
      panels: ['output'],
      selected: 'output',
    });
  });

  it('Simulator, narrow: one column, the Output panel the first tab of the tool group', () => {
    const tree = defaultTree('simulator', { visible: (id) => id === 'stack', narrow: true, outputInFront: true });
    expect(tree.type).toBe('column');
    expect(tree.type !== 'tabs' && tree.children[3]).toEqual({
      type: 'tabs',
      weight: 100,
      panels: ['output', 'stack'],
      selected: 'output',
    });
    const tools = defaultTree('simulator', { visible: (id) => id === 'stack', narrow: true, activeTool: 'stack' });
    expect(tools.type !== 'tabs' && tools.children[3]).toMatchObject({ selected: 'stack' });
  });
});

// --- round trip ---------------------------------------------------------------------------------

/** A small deterministic random source (mulberry32). */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random valid tree of `mode`'s panels (normalized: alternating, no single-child containers). */
export function randomTree(mode: DockMode, next: () => number): DockNode {
  const panels = [...DOCK_PANELS[mode]].sort(() => next() - 0.5);
  const weight = () => Math.round((1 + next() * 300) * 100) / 100;
  // Groups first: one to three panels each.
  const groups: DockNode[] = [];
  while (panels.length > 0) {
    const size = Math.min(panels.length, 1 + Math.floor(next() * 3));
    const members = panels.splice(0, size);
    groups.push({
      type: 'tabs',
      weight: weight(),
      panels: members,
      selected: members[Math.floor(next() * members.length)]!,
    });
  }
  // Then nest them at random.
  const build = (items: DockNode[], type: 'row' | 'column'): DockNode => {
    if (items.length === 1) return items[0]!;
    const children: DockNode[] = [];
    let rest = [...items];
    while (rest.length > 0) {
      const take = Math.max(1, Math.min(rest.length, Math.floor(next() * 3) + 1));
      const part = rest.slice(0, take);
      rest = rest.slice(take);
      children.push(part.length === 1 ? part[0]! : build(part, type === 'row' ? 'column' : 'row'));
    }
    return children.length === 1 ? children[0]! : { type, weight: weight(), children };
  };
  return normalizeDock(build(groups, next() < 0.5 ? 'row' : 'column'));
}

describe('the conversion DockNode -> FlexLayout JSON -> DockNode', () => {
  it('keeps the default trees', () => {
    for (const narrow of [false, true]) {
      for (const visible of [() => true, () => false, (id: string) => id === 'memory' || id === 'files']) {
        for (const mode of ['editor', 'simulator'] as const) {
          const tree = defaultTree(mode, { visible, narrow, activeTool: 'memory' });
          expect(roundTrip(tree, mode)).toEqual(tree);
        }
      }
    }
  });

  it('keeps 50 random valid trees of each mode', () => {
    const next = random(68000);
    for (let i = 0; i < 50; i++) {
      for (const mode of ['editor', 'simulator'] as const) {
        const tree = randomTree(mode, next);
        expect(roundTrip(tree, mode), JSON.stringify(tree)).toEqual(tree);
      }
    }
  });

  it('normalizes: a container with one child is its child, a container in one of its kind is merged', () => {
    const group = (panel: string, weight = 1): DockNode => ({ type: 'tabs', weight, panels: [panel], selected: panel });
    expect(normalizeDock({ type: 'row', weight: 7, children: [group('editor')] })).toEqual(group('editor', 7));
    expect(
      normalizeDock({
        type: 'row',
        weight: 100,
        children: [
          group('files', 50),
          { type: 'row', weight: 50, children: [group('editor', 1), group('messages', 3)] },
        ],
      }),
    ).toEqual({
      type: 'row',
      weight: 100,
      children: [group('files', 50), group('editor', 12.5), group('messages', 37.5)],
    });
  });
});
