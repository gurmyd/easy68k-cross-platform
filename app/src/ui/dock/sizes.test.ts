// The default trees sized from stored splits equal today's proportions (P3.1.3). The pixel values
// are today's boxes, measured in the shell before the dock in Chromium and WebKit at 1400 x 900
// and 1000 x 900 (the workspace is 813 px tall there): ui/dock/check-dock.mjs measures the same.

import { describe, expect, it } from 'vitest';
import type { DockNode, Settings } from '../../contracts';
import { defaultSettings } from '../../core/settings/defaults';
import { withSplit } from '../../state/layout';
import { defaultTree } from './model';
import {
  defaultDrag,
  editorMessagesHeight,
  editorMessagesPlace,
  registersPlace,
  sizeContentGroups,
  sizeDefaultTree,
  type SizeInput,
} from './sizes';

const input = (patch: Partial<SizeInput> = {}): SizeInput => ({
  width: 1400,
  height: 813,
  settings: defaultSettings(),
  locked: true,
  registers: 196.2,
  outputCollapsed: false,
  messages: 5,
  ...patch,
});

/** The pixel sizes of a sized tree: each container's children's weights (they are pixels). */
function pixels(node: DockNode): unknown {
  if (node.type === 'tabs') return node.panels.join('+');
  return node.children.map((child) => [Math.round(child.weight * 10) / 10, pixels(child)]);
}

describe("the default arrangement in pixels: today's boxes", () => {
  it('Editor at 1400 x 813: Files 252 | 1 | 1147, editor 807 | 1 | messages 5', () => {
    const tree = sizeDefaultTree('editor', defaultTree('editor', { visible: () => true, narrow: false }), input());
    expect(pixels(tree)).toEqual([
      [252, 'files'],
      [
        1147,
        [
          [807, 'editor'],
          [5, 'messages'],
        ],
      ],
    ]);
  });

  it('Editor at 1000 x 813: Files 180; messages 87 while it holds messages, 7 after a clean assembly', () => {
    const tree = (messages: number) =>
      pixels(
        sizeDefaultTree(
          'editor',
          defaultTree('editor', { visible: () => true, narrow: false }),
          input({ width: 1000, messages }),
        ),
      );
    expect(tree(87)).toEqual([
      [180, 'files'],
      [
        819,
        [
          [725, 'editor'],
          [87, 'messages'],
        ],
      ],
    ]);
    expect(tree(7)).toEqual([
      [180, 'files'],
      [
        819,
        [
          [805, 'editor'],
          [7, 'messages'],
        ],
      ],
    ]);
  });

  it('Editor without the Files panel: the column alone', () => {
    const tree = sizeDefaultTree(
      'editor',
      defaultTree('editor', { visible: (id) => id !== 'files', narrow: false }),
      input(),
    );
    expect(pixels(tree)).toEqual([
      [807, 'editor'],
      [5, 'messages'],
    ]);
  });

  it('Simulator, wide: columns 700 | 1 | 699; Registers 196.2, Listing 515.8, Messages 99; Output alone', () => {
    const tree = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: () => false, narrow: false }),
      input(),
    );
    expect(pixels(tree)).toEqual([
      [
        700,
        [
          [196.2, 'registers'],
          [515.8, 'listing'],
          [99, 'messages'],
        ],
      ],
      [699, 'output'],
    ]);
  });

  it('Simulator, wide, tool panels shown: Output 489, the tool group 323 (today: split 325 - 31 + 29)', () => {
    const tree = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: (id) => id === 'memory' || id === 'log', narrow: false }),
      input(),
    );
    expect(pixels(tree)).toEqual([
      [
        700,
        [
          [196.2, 'registers'],
          [515.8, 'listing'],
          [99, 'messages'],
        ],
      ],
      [
        699,
        [
          [489, 'output'],
          [323, 'memory+log'],
        ],
      ],
    ]);
  });

  it('Simulator, wide, Output collapsed: its 24 px bar above the tool group', () => {
    const tree = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: (id) => id === 'memory', narrow: false }),
      input({ outputCollapsed: true }),
    );
    expect(pixels(tree)).toEqual([
      [
        700,
        [
          [196.2, 'registers'],
          [515.8, 'listing'],
          [99, 'messages'],
        ],
      ],
      [
        699,
        [
          [24, 'output'],
          [788, 'memory'],
        ],
      ],
    ]);
  });

  it('Simulator, narrow at 1000 x 813: the left part 407 (registers 102, listing 254, messages 49), the tool group 405', () => {
    const tree = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: () => false, narrow: true }),
      input({ width: 1000, registers: 102 }),
    );
    expect(pixels(tree)).toEqual([
      [102, 'registers'],
      [254, 'listing'],
      [49, 'messages'],
      [405, 'output'],
    ]);
  });

  it('follows stored splits', () => {
    const settings: Settings = withSplit(withSplit(defaultSettings(), 'editor.files', 0.3), 'sim.columns', 0.4);
    const editor = sizeDefaultTree(
      'editor',
      defaultTree('editor', { visible: () => true, narrow: false }),
      input({ settings }),
    );
    expect(pixels(editor)).toEqual([
      [420, 'files'],
      [
        979,
        [
          [807, 'editor'],
          [5, 'messages'],
        ],
      ],
    ]);
    const sim = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: () => false, narrow: false }),
      input({ settings }),
    );
    expect((pixels(sim) as [number, unknown][]).map(([size]) => size)).toEqual([560, 839]);
  });

  it('unlocked: the Registers group is its content plus its strip; the groups below it share the rest', () => {
    const tree = sizeDefaultTree(
      'simulator',
      defaultTree('simulator', { visible: () => false, narrow: false }),
      input({ locked: false }),
    );
    expect(pixels(tree)).toEqual([
      [
        700,
        [
          [225.2, 'registers'],
          [491.8, 'listing'],
          [94, 'messages'],
        ],
      ],
      [699, 'output'],
    ]);
  });

  it('nothing before the dock has a size', () => {
    const tree = defaultTree('editor', { visible: () => true, narrow: false });
    expect(sizeDefaultTree('editor', tree, input({ width: 0, height: 0 }))).toBe(tree);
  });
});

describe("a drag of a default splitter writes today's split", () => {
  const tree = defaultTree('simulator', { visible: (id) => id === 'memory', narrow: false });
  it('the two columns, the Messages panel, the tool panels', () => {
    expect(defaultDrag('simulator', tree, 'root', 1, [560, 839], input())).toEqual({
      split: 'sim.columns',
      fraction: 0.4,
    });
    const messages = defaultDrag('simulator', tree, 'root.0', 2, [196.2, 415.8, 199], input());
    expect(messages).toMatchObject({ split: 'sim.messages' });
    expect((messages as { fraction: number }).fraction).toBeCloseTo(199 / 615.8, 6);
    expect(defaultDrag('simulator', tree, 'root.1', 1, [512, 300], input())).toEqual({
      split: 'sim.tools',
      fraction: 302 / 813,
    });
    // The splitter below Registers is not a control.
    expect(defaultDrag('simulator', tree, 'root.0', 1, [150, 561.8, 99], input())).toBeNull();
  });
  it("the Files panel and the editor's message list (never stored)", () => {
    const editor = defaultTree('editor', { visible: () => true, narrow: false });
    expect(defaultDrag('editor', editor, 'root', 1, [350, 1049], input())).toEqual({
      split: 'editor.files',
      fraction: 0.25,
    });
    expect(defaultDrag('editor', editor, 'root.1', 1, [700, 112], input())).toEqual({ messages: 112 });
  });
  it("narrow: the third splitter is the two columns'", () => {
    const narrow = defaultTree('simulator', { visible: () => false, narrow: true });
    expect(defaultDrag('simulator', narrow, 'root', 3, [102, 254, 149, 305], input())).toEqual({
      split: 'sim.columns',
      fraction: (102 + 1 + 254 + 1 + 149) / 813,
    });
  });
});

describe('the content-sized groups (P3.1.5)', () => {
  it("the editor's message list: the rule, at most the column less 80 px", () => {
    expect(editorMessagesHeight(5, 813)).toBe(5);
    expect(editorMessagesHeight(400, 300)).toBe(220);
    expect(editorMessagesHeight(87, 100)).toBe(87);
  });

  it("Registers at the top of the left column, and Messages directly below the Editor panel's group", () => {
    const sim = defaultTree('simulator', { visible: () => false, narrow: false });
    expect(registersPlace(sim)).toBe('root.0');
    expect(registersPlace(defaultTree('simulator', { visible: () => false, narrow: true }))).toBe('root');
    const moved: DockNode = {
      type: 'row',
      weight: 1,
      children: [
        { type: 'tabs', weight: 1, panels: ['output'], selected: 'output' },
        {
          type: 'column',
          weight: 1,
          children: [
            { type: 'tabs', weight: 1, panels: ['registers', 'listing'], selected: 'registers' },
            { type: 'tabs', weight: 1, panels: ['messages'], selected: 'messages' },
          ],
        },
      ],
    };
    expect(registersPlace(moved)).toBeNull();
    expect(editorMessagesPlace(defaultTree('editor', { visible: () => true, narrow: false }))).toEqual({
      path: 'root.1',
      index: 1,
    });
  });

  it('in a changed arrangement the rule still sizes the group, the others keep their shares', () => {
    const tree: DockNode = {
      type: 'column',
      weight: 100,
      children: [
        { type: 'tabs', weight: 50, panels: ['editor', 'files'], selected: 'editor' },
        { type: 'tabs', weight: 50, panels: ['messages'], selected: 'messages' },
      ],
    };
    const sized = sizeContentGroups('editor', tree, input({ messages: 87 }), () => 813);
    expect(pixels(sized)).toEqual([
      [725, 'editor+files'],
      [87, 'messages'],
    ]);
  });
});
