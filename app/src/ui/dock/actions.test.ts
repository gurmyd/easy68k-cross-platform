// Each move of P3.1.4 yields the expected tree; Move Tab Earlier / Later and their ends; the
// one-step moves of the tab menu; the rules of Layout.onAction (P2.2); parked places (P3.1.8).

import { Actions, Model } from 'flexlayout-react';
import { describe, expect, it } from 'vitest';
import type { DockNode } from '../../contracts';
import { layoutRects, moveAction, stepAction, tabOrderAction, groupOf, neighbourGroup } from './actions';
import { indexModel } from './live';
import { defaultTree, toFlexJson, type DockMode } from './model';
import { insertPanel, removePanel, withoutViewers } from './park';
import { allowsDrop, decideAction } from './rules';

const title = (panel: string) => panel[0]!.toUpperCase() + panel.slice(1);
const modelOf = (tree: DockNode, mode: DockMode = 'editor') =>
  Model.fromJson(toFlexJson(tree, { mode, locked: false, title }));
const g = (panels: string[], weight = 100, selected = panels[0]!): DockNode => ({
  type: 'tabs',
  weight,
  panels,
  selected,
});

/** The tree's shape: groups as 'a+b', containers as row(...) / column(...). */
function shape(tree: DockNode | null): string {
  if (tree === null) return 'empty';
  if (tree.type === 'tabs') return tree.panels.join('+');
  return `${tree.type}(${tree.children.map(shape).join(', ')})`;
}

const EDITOR = defaultTree('editor', { visible: () => true, narrow: false });
const SIM = defaultTree('simulator', { visible: (id) => id === 'memory' || id === 'stack', narrow: false });

function moved(tree: DockNode, mode: DockMode, panel: string, target: Parameters<typeof moveAction>[3]) {
  const model = modelOf(tree, mode);
  const plan = moveAction(model, mode, panel, target, title);
  expect(plan).not.toBeNull();
  model.doAction(plan!.action);
  return { tree: indexModel(model).tree, announce: plan!.announce };
}

describe('Move Panel To... (P3.1.4)', () => {
  it('into the group of a panel, as its last tab, selected', () => {
    const result = moved(EDITOR, 'editor', 'files', { kind: 'tab', near: 'messages' });
    expect(shape(result.tree)).toBe('column(editor, messages+files)');
    expect(result.announce).toBe('Files moved into the group of Messages.');
    const group = (result.tree as { children: DockNode[] }).children[1] as { selected: string };
    expect(group.selected).toBe('files');
  });

  it('beside a panel on each side', () => {
    expect(shape(moved(EDITOR, 'editor', 'files', { kind: 'beside', near: 'editor', side: 'right' }).tree)).toBe(
      'column(row(editor, files), messages)',
    );
    expect(shape(moved(EDITOR, 'editor', 'files', { kind: 'beside', near: 'editor', side: 'left' }).tree)).toBe(
      'column(row(files, editor), messages)',
    );
    expect(shape(moved(EDITOR, 'editor', 'files', { kind: 'beside', near: 'messages', side: 'below' }).tree)).toBe(
      'column(editor, messages, files)',
    );
    const above = moved(EDITOR, 'editor', 'files', { kind: 'beside', near: 'editor', side: 'above' });
    expect(shape(above.tree)).toBe('column(files, editor, messages)');
    expect(above.announce).toBe('Files moved beside Editor, above.');
  });

  it('to each edge of the window', () => {
    expect(shape(moved(EDITOR, 'editor', 'files', { kind: 'edge', side: 'right' }).tree)).toBe(
      'row(column(editor, messages), files)',
    );
    expect(shape(moved(EDITOR, 'editor', 'files', { kind: 'edge', side: 'left' }).tree)).toBe(
      'row(files, column(editor, messages))',
    );
    expect(shape(moved(EDITOR, 'editor', 'messages', { kind: 'edge', side: 'top' }).tree)).toBe(
      'column(messages, row(files, editor))',
    );
    const bottom = moved(EDITOR, 'editor', 'files', { kind: 'edge', side: 'bottom' });
    expect(shape(bottom.tree)).toBe('column(editor, messages, files)');
    expect(bottom.announce).toBe('Files moved to the bottom edge of the window.');
  });

  it('a tool panel out of its group and back', () => {
    expect(shape(moved(SIM, 'simulator', 'memory', { kind: 'beside', near: 'listing', side: 'right' }).tree)).toBe(
      'row(column(registers, row(listing, memory), messages), column(output, stack))',
    );
    expect(shape(moved(SIM, 'simulator', 'output', { kind: 'tab', near: 'stack' }).tree)).toBe(
      'row(column(registers, listing, messages), memory+stack+output)',
    );
  });

  it('a panel that is not in the dock: no move', () => {
    expect(moveAction(modelOf(EDITOR), 'editor', 'viewer:1', { kind: 'edge', side: 'left' }, title)).toBeNull();
    expect(moveAction(modelOf(EDITOR), 'editor', 'files', { kind: 'tab', near: 'nothing' }, title)).toBeNull();
  });
});

describe('Move Tab Earlier / Later (P3.1.4)', () => {
  const tree: DockNode = {
    type: 'row',
    weight: 100,
    children: [g(['registers', 'listing', 'messages']), g(['output', 'memory', 'stack', 'log'])],
  };
  const order = (model: Model) => {
    const t = indexModel(model).tree as { children: { panels: string[] }[] };
    return t.children[1]!.panels.join(',');
  };
  it('moves one place along the strip and says where', () => {
    const model = modelOf(tree, 'simulator');
    const later = tabOrderAction(model, 'simulator', 'memory', 1, title)!;
    expect(later.announce).toBe('Memory moved to position 3 of its group.');
    model.doAction(later.action);
    expect(order(model)).toBe('output,stack,memory,log');
    model.doAction(tabOrderAction(model, 'simulator', 'memory', -1, title)!.action);
    expect(order(model)).toBe('output,memory,stack,log');
    model.doAction(tabOrderAction(model, 'simulator', 'memory', -1, title)!.action);
    expect(order(model)).toBe('memory,output,stack,log');
    model.doAction(tabOrderAction(model, 'simulator', 'log', -1, title)!.action);
    expect(order(model)).toBe('memory,output,log,stack');
  });
  it('is disabled at the first and the last place and in a group of one panel', () => {
    const model = modelOf(tree, 'simulator');
    expect(tabOrderAction(model, 'simulator', 'output', -1, title)).toBeNull();
    expect(tabOrderAction(model, 'simulator', 'log', 1, title)).toBeNull();
    const single = modelOf(EDITOR);
    expect(tabOrderAction(single, 'editor', 'files', -1, title)).toBeNull();
    expect(tabOrderAction(single, 'editor', 'files', 1, title)).toBeNull();
  });
});

describe("the tab menu's one-step moves (P3.1.4)", () => {
  it('beside the neighbouring group in that direction, or to the window edge', () => {
    const step = (panel: string, direction: 'left' | 'right' | 'up' | 'down') => {
      const model = modelOf(EDITOR);
      const plan = stepAction(model, 'editor', panel, direction, layoutRects(model, 1400, 813), title)!;
      model.doAction(plan.action);
      return [shape(indexModel(model).tree), plan.announce];
    };
    expect(step('editor', 'left')).toEqual(['row(editor, files, messages)', 'Editor moved beside Files, left.']);
    const [, filesLeft] = step('files', 'left');
    expect(filesLeft).toBe('Files moved to the left edge of the window.');
    const [downShape, downText] = step('editor', 'down');
    expect(downText).toBe('Editor moved beside Messages, below.');
    expect(downShape).toBe('row(files, column(messages, editor))');
    const [, upText] = step('messages', 'up');
    expect(upText).toBe('Messages moved beside Editor, above.');
  });

  it("finds the neighbour by the groups' places", () => {
    const model = modelOf(EDITOR);
    const rects = layoutRects(model, 1400, 813);
    const id = (panel: string) => groupOf(model, 'editor', panel)!.getId();
    expect(neighbourGroup(rects, id('editor'), 'left')).toBe(id('files'));
    expect(neighbourGroup(rects, id('messages'), 'left')).toBe(id('files'));
    expect(neighbourGroup(rects, id('files'), 'right')).toBe(id('editor'));
    expect(neighbourGroup(rects, id('editor'), 'down')).toBe(id('messages'));
    expect(neighbourGroup(rects, id('files'), 'up')).toBeUndefined();
  });
});

describe('Layout.onAction (P2.2)', () => {
  const context = (locked = false) => ({
    locked,
    panelOf: (tabId: string) => tabId.split(':').slice(1).join(':') || null,
    groupPanels: (id: string) => (id === 'empty' ? [] : id === 'full' ? ['memory'] : null),
  });
  it('turns DELETE_TAB of each closable panel into hidePanel, of a viewer into closing it, and refuses the others', () => {
    for (const panel of ['files', 'memory', 'stack', 'hardware', 'breakpoints', 'log']) {
      expect(decideAction(Actions.deleteTab(`x:${panel}`), context()), panel).toEqual({
        kind: 'hide',
        panels: [panel],
        viewers: [],
      });
    }
    expect(decideAction(Actions.deleteTab('editor:viewer:2'), context())).toEqual({
      kind: 'hide',
      panels: [],
      viewers: ['viewer:2'],
    });
    for (const panel of ['editor', 'messages', 'registers', 'listing', 'output']) {
      expect(decideAction(Actions.deleteTab(`x:${panel}`), context()), panel).toEqual({ kind: 'refuse' });
    }
  });
  it('refuses DELETE_TABSET of a group that holds a panel', () => {
    expect(decideAction(Actions.deleteTabset('full'), context())).toEqual({ kind: 'refuse' });
    expect(decideAction(Actions.deleteTabset('empty'), context())).toEqual({ kind: 'allow' });
    expect(decideAction(Actions.deleteTabset('unknown'), context())).toEqual({ kind: 'refuse' });
  });
  it('a group action: each part by the same rules, refused as a whole when one part is', () => {
    const closeAll = Actions.group([Actions.deleteTab('x:memory'), Actions.deleteTab('x:log')]);
    expect(decideAction(closeAll, context())).toEqual({ kind: 'hide', panels: ['memory', 'log'], viewers: [] });
    const withFixed = Actions.group([Actions.deleteTab('x:memory'), Actions.deleteTab('x:output')]);
    expect(decideAction(withFixed, context())).toEqual({ kind: 'refuse' });
  });
  it('refuses a drag while locked, and what would maximize, float, pop out or rename', () => {
    const drag = Actions.moveNode('x:files', 'ts', { getName: () => 'center' } as never, -1);
    expect(decideAction(drag, context(true))).toEqual({ kind: 'refuse' });
    expect(decideAction(drag, context(false))).toEqual({ kind: 'allow' });
    expect(decideAction(Actions.maximizeToggle('ts'), context())).toEqual({ kind: 'refuse' });
    expect(decideAction(Actions.popoutTab('x:files'), context())).toEqual({ kind: 'refuse' });
    expect(decideAction(Actions.renameTab('x:files', 'y'), context())).toEqual({ kind: 'refuse' });
    expect(decideAction(Actions.selectTab('x:files'), context(true))).toEqual({ kind: 'allow' });
    expect(decideAction(Actions.adjustWeights('row', [1, 2]), context(true))).toEqual({ kind: 'allow' });
  });
  it('setOnAllowDrop: the Output panel needs 160 x 120 px; nothing drops while locked', () => {
    expect(allowsDrop(['output'], { width: 159, height: 400 }, false)).toBe(false);
    expect(allowsDrop(['output'], { width: 400, height: 119 }, false)).toBe(false);
    expect(allowsDrop(['output'], { width: 160, height: 120 }, false)).toBe(true);
    expect(allowsDrop(['memory'], { width: 20, height: 20 }, false)).toBe(true);
    expect(allowsDrop(['memory'], { width: 800, height: 800 }, true)).toBe(false);
  });
});

describe('parked places (P3.1.8, P4.2)', () => {
  const tree: DockNode = {
    type: 'row',
    weight: 100,
    children: [
      { type: 'column', weight: 100, children: [g(['registers']), g(['listing']), g(['messages'])] },
      { type: 'column', weight: 100, children: [g(['output']), g(['memory'], 40), g(['stack', 'log'], 60, 'log')] },
    ],
  };
  it('a hidden-then-shown panel goes back next to its neighbour', () => {
    const removed = removePanel(tree, 'memory');
    expect(removed.parked).toEqual({ near: 'output', side: 'below' });
    expect(shape(removed.tree)).toBe('row(column(registers, listing, messages), column(output, stack+log))');
    const back = insertPanel(removed.tree!, 'simulator', 'memory', removed.parked!);
    expect(shape(back)).toBe('row(column(registers, listing, messages), column(output, memory, stack+log))');
  });
  it('a tab of a group goes back into that group', () => {
    const removed = removePanel(tree, 'log');
    expect(removed.parked).toEqual({ near: 'stack', side: 'tab' });
    expect(shape(insertPanel(removed.tree!, 'simulator', 'log', removed.parked!))).toBe(shape(tree));
  });
  it('the first of a container is parked before the next one', () => {
    const removed = removePanel(tree, 'registers');
    expect(removed.parked).toEqual({ near: 'listing', side: 'above' });
  });
  it('a remembered neighbour that is hidden: the default place', () => {
    const removed = removePanel(removePanel(tree, 'memory').tree!, 'stack');
    const withoutLog = removePanel(removed.tree!, 'log').tree!;
    expect(shape(insertPanel(withoutLog, 'simulator', 'memory', { near: 'stack', side: 'left' }))).toBe(
      'row(column(registers, listing, messages), column(output, memory))',
    );
    const editor: DockNode = { type: 'column', weight: 100, children: [g(['editor']), g(['messages'])] };
    expect(shape(insertPanel(editor, 'editor', 'files', { near: 'nothing', side: 'tab' }))).toBe(
      'row(files, column(editor, messages))',
    );
  });
  it('viewers are never stored', () => {
    const editor: DockNode = {
      type: 'column',
      weight: 100,
      children: [g(['editor', 'viewer:1']), g(['messages', 'viewer:2'])],
    };
    expect(shape(withoutViewers(editor))).toBe('column(editor, messages)');
  });
});
