import { describe, expect, it } from 'vitest';
import type { DockNode } from '../../contracts';
import { relocationPlan } from './order';
import { splitterPlans } from './splitters';

const tabs = (panels: string[], selected = panels[0]!): DockNode => ({ type: 'tabs', weight: 100, panels, selected });
const row = (...children: DockNode[]): DockNode => ({ type: 'row', weight: 100, children });
const column = (...children: DockNode[]): DockNode => ({ type: 'column', weight: 100, children });

const title = (panel: string) => panel[0]!.toUpperCase() + panel.slice(1);
const stripWhere = (rule: (panels: readonly string[]) => boolean) => (group: { panels: readonly string[] }) =>
  rule(group.panels);
const slotsOf = (relocation: ReturnType<typeof relocationPlan>) =>
  Object.fromEntries([...relocation.slots].map(([panel, slots]) => [panel, slots]));

describe('relocationPlan (Lock Layout on: the Tab order and reading order of today, errata N1 25)', () => {
  it("Editor mode: each splitter follows the group before it, as today's shell has it", () => {
    const tree = row(tabs(['files']), column(tabs(['editor']), tabs(['messages'])));
    const plans = splitterPlans('editor', tree, { isDefault: true, outputCollapsed: false, title });
    const relocation = relocationPlan(
      'editor',
      tree,
      plans,
      stripWhere(() => false),
    );
    expect(slotsOf(relocation)).toEqual({
      files: { after: 'e68-dock-split-editor-root_1' },
      editor: { after: 'e68-dock-split-editor-root-1_1' },
    });
    expect([...relocation.splitters]).toEqual([
      ['root/1', 'e68-dock-split-editor-root_1'],
      ['root.1/1', 'e68-dock-split-editor-root-1_1'],
    ]);
    expect(relocation.strips.size).toBe(0);
  });

  it('Simulator mode, wide, with a tool panel: the tool strip comes after the tool splitter, before its panel', () => {
    const tree = row(
      column(tabs(['registers']), tabs(['listing']), tabs(['messages'])),
      column(tabs(['output']), tabs(['memory', 'stack'], 'stack')),
    );
    const plans = splitterPlans('simulator', tree, { isDefault: true, outputCollapsed: false, title });
    const relocation = relocationPlan(
      'simulator',
      tree,
      plans,
      stripWhere((panels) => panels.includes('memory')),
    );
    expect(slotsOf(relocation)).toEqual({
      // The splitter below the content-sized Registers group is inert: no slot.
      listing: { after: 'e68-dock-split-simulator-root-0_2' },
      messages: { after: 'e68-dock-split-simulator-root_1' },
      output: { after: 'e68-dock-split-simulator-root-1_1' },
      // The selected panel of the group holds the strip's slot.
      stack: { before: 'e68-dock-strip-simulator-root-1-1' },
    });
    expect([...relocation.strips]).toEqual([['root.1.1', 'e68-dock-strip-simulator-root-1-1']]);
  });

  it('Simulator mode, narrow: the two columns splitter, then the strip of the Output group', () => {
    const tree = column(tabs(['registers']), tabs(['listing']), tabs(['messages']), tabs(['output', 'memory']));
    const plans = splitterPlans('simulator', tree, { isDefault: true, outputCollapsed: false, title });
    const relocation = relocationPlan(
      'simulator',
      tree,
      plans,
      stripWhere((panels) => panels.includes('output')),
    );
    expect(slotsOf(relocation)).toEqual({
      listing: { after: 'e68-dock-split-simulator-root_2' },
      messages: { after: 'e68-dock-split-simulator-root_3' },
      output: { before: 'e68-dock-strip-simulator-root-3' },
    });
  });

  it('a splitter after a nested container follows the last group of that container', () => {
    const tree = row(column(tabs(['a']), row(tabs(['b']), tabs(['c']))), tabs(['d']));
    const plans = splitterPlans('editor', tree, { isDefault: false, outputCollapsed: false, title });
    const relocation = relocationPlan(
      'editor',
      tree,
      plans,
      stripWhere(() => true),
    );
    expect(slotsOf(relocation)).toEqual({
      a: { before: 'e68-dock-strip-editor-root-0-0', after: 'e68-dock-split-editor-root-0_1' },
      b: { before: 'e68-dock-strip-editor-root-0-1-0', after: 'e68-dock-split-editor-root-0-1_1' },
      c: { before: 'e68-dock-strip-editor-root-0-1-1', after: 'e68-dock-split-editor-root_1' },
      d: { before: 'e68-dock-strip-editor-root-1' },
    });
  });

  it('nothing for an empty tree', () => {
    const relocation = relocationPlan('editor', null, new Map(), () => true);
    expect(relocation.slots.size + relocation.strips.size + relocation.splitters.size).toBe(0);
  });
});
