// The editor split of ARCHITECTURE-PLUS P3.1.4 (N2): the three commands as pure rules, applied to a
// pane model and the layout setting; moving a dragged document; the drag data; the tab tool-tip.
import { describe, expect, it } from 'vitest';
import { documentTabTitle, EDITOR_CONTEXT_MENU, placeLabelsOf } from './EditorPane';
import { INITIAL_PANES, PaneModel, paneViews, syncPanes, tilePanes, type PaneLayout, type PaneState } from './panes';
import {
  DOCUMENT_DRAG_TYPE,
  documentDragData,
  moveToPane,
  readDocumentDrag,
  runSplit,
  splitEditor,
  splitEnabled,
  type SplitCommand,
} from './split';

const idsOf = (n: number) => Array.from({ length: n }, (_, i) => `d${i + 1}`);

/** A pane state written short: the pane of d1, d2, ... as digits, the active pane, the shown pair. */
function st(digits: string, activePane: 0 | 1, shown: [string | null, string | null]): PaneState {
  const pane: Record<string, 0 | 1> = {};
  [...digits].forEach((digit, i) => {
    pane[`d${i + 1}`] = digit === '1' ? 1 : 0;
  });
  return { pane, activePane, shown };
}

/** The panes as they are before the command: the last document opened is the active one. */
function before(layout: PaneLayout, n: number): PaneState {
  const ids = idsOf(n);
  const active = ids[n - 1] ?? null;
  const one = syncPanes(INITIAL_PANES, ids, active);
  return layout === 'one' ? one : tilePanes(one, ids, active);
}

// Expected results, worked out from P3.1.4 by hand (the active document is always the last one).
const BEFORE_ONE: Record<number, PaneState> = {
  0: INITIAL_PANES,
  1: st('0', 0, ['d1', null]),
  2: st('00', 0, ['d2', null]),
  5: st('00000', 0, ['d5', null]),
};
const BEFORE_TWO: Record<number, PaneState> = {
  0: INITIAL_PANES,
  1: st('0', 0, ['d1', null]),
  2: st('01', 1, ['d1', 'd2']),
  5: st('00001', 1, ['d4', 'd5']),
};
/** Split from two panes: the active document moves to the other pane. */
const MOVED: Record<number, PaneState> = {
  0: INITIAL_PANES,
  1: st('1', 1, ['d1', 'd1']),
  2: st('00', 0, ['d2', 'd2']),
  5: st('00000', 0, ['d5', 'd5']),
};

interface Case {
  command: SplitCommand;
  from: PaneLayout;
  n: number;
  panes: PaneState;
  layout: PaneLayout;
}

const CASES: Case[] = [];
for (const n of [0, 1, 2, 5]) {
  // From one pane: what Tile Vertically / Tile Horizontally does; Close Split changes nothing.
  CASES.push({ command: 'splitRight', from: 'one', n, panes: BEFORE_TWO[n]!, layout: 'vertical' });
  CASES.push({ command: 'splitDown', from: 'one', n, panes: BEFORE_TWO[n]!, layout: 'horizontal' });
  CASES.push({ command: 'unsplit', from: 'one', n, panes: BEFORE_ONE[n]!, layout: 'one' });
  for (const from of ['vertical', 'horizontal'] as const) {
    // Two panes, either orientation: the active document goes across, the orientation is the command's.
    CASES.push({ command: 'splitRight', from, n, panes: MOVED[n]!, layout: 'vertical' });
    CASES.push({ command: 'splitDown', from, n, panes: MOVED[n]!, layout: 'horizontal' });
    // Close Split: Cascade, which keeps the pane of each document for the next Tile.
    CASES.push({ command: 'unsplit', from, n, panes: BEFORE_TWO[n]!, layout: 'one' });
  }
}

describe('split commands (P3.1.4): every command from every layout with 0, 1, 2 and 5 documents', () => {
  it('the table has 36 cases', () => {
    expect(CASES).toHaveLength(36);
  });

  for (const c of CASES) {
    it(`${c.command} from '${c.from}' with ${c.n} document(s) gives '${c.layout}'`, () => {
      const ids = idsOf(c.n);
      const start = before(c.from, c.n);
      expect(start).toEqual(c.from === 'one' ? BEFORE_ONE[c.n] : BEFORE_TWO[c.n]);
      const result = splitEditor(c.command, start, c.from, ids, ids[c.n - 1] ?? null);
      expect(result.layout).toBe(c.layout);
      expect(result.panes).toEqual(c.panes);
    });
  }

  it('Split Editor Right from one pane equals Tile Vertically (E2: tilePanes and the layout)', () => {
    const ids = idsOf(3);
    const start = before('one', 3);
    expect(splitEditor('splitRight', start, 'one', ids, 'd2')).toEqual({
      panes: tilePanes(start, ids, 'd2'),
      layout: 'vertical',
    });
  });

  it('two panes one above the other: Split Editor Right shows them side by side with the document across', () => {
    const ids = idsOf(5);
    const result = splitEditor('splitRight', before('horizontal', 5), 'horizontal', ids, 'd2');
    const [first, second] = paneViews(result.panes, result.layout, ids, 'd2');
    expect(result.layout).toBe('vertical');
    expect(first.ids).toEqual(['d1', 'd3', 'd4']);
    expect(second).toEqual({ ids: ['d2', 'd5'], selected: 'd2' });
  });

  it('a document the panes have not placed yet is placed before it moves', () => {
    const ids = [...idsOf(2), 'new'];
    const result = splitEditor('splitDown', before('vertical', 2), 'vertical', ids, 'new');
    // `new` opened in the active pane (1) and moved to pane 0.
    expect(result.panes.pane).toEqual({ d1: 0, d2: 1, new: 0 });
    expect(result.panes.activePane).toBe(0);
  });

  it('enabled: Split while a document is open, Close Split while there are two panes', () => {
    for (const layout of ['one', 'horizontal', 'vertical'] as const) {
      for (const open of [false, true]) {
        expect(splitEnabled('splitRight', layout, open)).toBe(open);
        expect(splitEnabled('splitDown', layout, open)).toBe(open);
        expect(splitEnabled('unsplit', layout, open)).toBe(layout !== 'one');
      }
    }
  });
});

describe('runSplit: the rule applied to a pane model and the layout setting', () => {
  function target(layout: PaneLayout, n: number) {
    const panes = new PaneModel();
    const ids = idsOf(n);
    panes.set(() => before(layout, n));
    const state = { layout, writes: [] as PaneLayout[] };
    return {
      state,
      panes,
      target: {
        panes,
        layout: () => state.layout,
        setLayout: (next: PaneLayout) => {
          state.layout = next;
          state.writes.push(next);
        },
        ids: () => ids,
        activeId: () => ids[n - 1] ?? null,
      },
    };
  }

  it('writes the model and the setting, the setting only when it changes', () => {
    const t = target('one', 2);
    runSplit('splitRight', t.target);
    expect(t.panes.state).toEqual(BEFORE_TWO[2]);
    expect(t.state.writes).toEqual(['vertical']);
    runSplit('splitRight', t.target);
    expect(t.panes.state).toEqual(MOVED[2]);
    expect(t.state.writes).toEqual(['vertical']);
    runSplit('splitDown', t.target);
    expect(t.state.writes).toEqual(['vertical', 'horizontal']);
    runSplit('unsplit', t.target);
    expect(t.state.writes).toEqual(['vertical', 'horizontal', 'one']);
  });

  it('tells the model listeners only when the panes change', () => {
    const t = target('vertical', 0);
    let told = 0;
    t.panes.subscribe(() => told++);
    runSplit('splitRight', t.target);
    expect(told).toBe(0);
    const u = target('vertical', 2);
    u.panes.subscribe(() => told++);
    runSplit('splitRight', u.target);
    expect(told).toBe(1);
  });
});

describe('moving a dragged document tab (P5 N2)', () => {
  it('moveToPane moves to the given pane and changes nothing when the document is there', () => {
    const start = before('vertical', 2); // d1 in 0, d2 in 1
    expect(moveToPane(start, 'd2', 1)).toBe(start);
    const moved = moveToPane(start, 'd1', 1);
    expect(moved.pane).toEqual({ d1: 1, d2: 1 });
    expect(moved.shown[1]).toBe('d1');
    // A second drop event for the same drag (strip, then the pane around it) moves nothing more.
    expect(moveToPane(moved, 'd1', 1)).toBe(moved);
  });

  it('the drag data names the window and the document; data of another window or garbage is refused', () => {
    expect(DOCUMENT_DRAG_TYPE).toBe('application/x-e68-document');
    const data = documentDragData('w1', 'doc-3');
    expect(readDocumentDrag('w1', data)).toBe('doc-3');
    expect(readDocumentDrag('w2', data)).toBeNull();
    for (const bad of [
      '',
      'doc-3',
      '{}',
      'null',
      '[1]',
      '{"window":"w1"}',
      '{"window":"w1","id":""}',
      '{"window":"w1","id":3}',
    ]) {
      expect(readDocumentDrag('w1', bad), bad).toBeNull();
    }
  });
});

describe('the document tab (P5 N2)', () => {
  const backends = [
    { mount: 'browser', label: 'My Programs', kind: 'browser' as const },
    { mount: 'linked', label: 'Linked files', kind: 'fsaccess' as const },
    { mount: 'folder', label: 'Lab', kind: 'fsaccess' as const },
    { mount: 'disk', label: 'This computer', kind: 'disk' as const },
  ];
  const labels = placeLabelsOf(backends as never);

  it('the tool-tip is the place text of each store (P3.2.5), the name without a path', () => {
    const title = (path: string | null, kind: 'web' | 'desktop' = 'web') =>
      documentTabTitle({ path: path as never, name: 'untitled1.X68' }, labels, kind);
    expect(title('/browser/demo/prog.X68')).toBe('My Programs/demo/prog.X68');
    expect(title('/linked/k3x9/lab1.X68')).toBe('lab1.X68 - on this computer, edited in place');
    expect(title('/folder/prog.X68')).toBe('Lab/prog.X68 - in the folder "Lab" on this computer');
    expect(title('/disk/Users/me/x.X68', 'desktop')).toBe('/Users/me/x.X68');
    expect(title(null)).toBe('untitled1.X68');
    // The internal path of a linked file is never shown.
    expect(title('/linked/k3x9/lab1.X68')).not.toContain('/linked');
  });

  it('placeLabelsOf keeps mount, label and kind only', () => {
    expect(placeLabelsOf([{ ...backends[0], stat: () => null } as never])).toEqual([backends[0]]);
  });

  it('the context menu ends with Earlier Versions... below a separator after Reload File', () => {
    expect(EDITOR_CONTEXT_MENU.slice(-4)).toEqual([null, 'ed.edit.reload', null, 'ed.file.history']);
    // The original items keep their places (editor-ui §4.1).
    expect(EDITOR_CONTEXT_MENU.slice(0, 12)).toEqual([
      'ed.edit.undo',
      'ed.edit.redo',
      null,
      'ed.edit.cut',
      'ed.edit.copy',
      'ed.edit.paste',
      'ed.edit.selectAll',
      null,
      'ed.edit.comment',
      'ed.edit.uncomment',
      null,
      'ed.edit.reload',
    ]);
  });
});
