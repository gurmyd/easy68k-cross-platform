// Transaction-level tests of the editing rules (editor-ui §20.3; ARCHITECTURE.md 2.4, 1.4 notes 5, 6, 12).
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { TabType } from '../../contracts';
import {
  affectedLines,
  autoIndentAfterEnter,
  commentSelection,
  enterKey,
  indentSelection,
  normalizeLineBreaks,
  outdentSelection,
  overwriteInput,
  shiftTabKey,
  tabKey,
  uncommentSelection,
  whiteSpaceBeforeEnter,
} from './editing';

/** A state from text in which `|` marks the caret, or `[` and `]` the selection. */
function make(marked: string, withHistory = false): EditorState {
  let text = marked;
  let anchor: number;
  let head: number;
  const caret = text.indexOf('|');
  if (caret >= 0) {
    text = text.slice(0, caret) + text.slice(caret + 1);
    anchor = head = caret;
  } else {
    anchor = text.indexOf('[');
    text = text.slice(0, anchor) + text.slice(anchor + 1);
    head = text.indexOf(']');
    text = text.slice(0, head) + text.slice(head + 1);
  }
  return EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
    extensions: withHistory ? [history()] : [],
  });
}

/** The text of a state with the caret or selection marked as `make` reads it. */
function show(state: EditorState): string {
  const { from, to } = state.selection.main;
  const text = state.doc.toString();
  if (from === to) return text.slice(0, from) + '|' + text.slice(from);
  return text.slice(0, from) + '[' + text.slice(from, to) + ']' + text.slice(to);
}

const apply = (state: EditorState, spec: TransactionSpec | null) => (spec ? state.update(spec).state : state);
const fixed4 = { tabType: TabType.Fixed, tabSize: 4, realTabs: false };
const assembly = { tabType: TabType.Assembly, tabSize: 4, realTabs: false };

function runCommand(state: EditorState, command: typeof undo): EditorState {
  let next = state;
  command({ state, dispatch: (tr) => (next = tr.state) });
  return next;
}

describe('Tab, Real Tabs off', () => {
  it('Fixed tabs, size 4: Tab at columns 0, 1, 3, 4 inserts 4, 3, 1, 4 spaces (20.3)', () => {
    expect(show(apply(make('|x'), tabKey(make('|x'), fixed4)))).toBe('    |x');
    expect(show(apply(make('a|x'), tabKey(make('a|x'), fixed4)))).toBe('a   |x');
    expect(show(apply(make('abc|x'), tabKey(make('abc|x'), fixed4)))).toBe('abc |x');
    expect(show(apply(make('abcd|x'), tabKey(make('abcd|x'), fixed4)))).toBe('abcd    |x');
  });

  it('Assembly tabs: from columns 0, 5, 13, 21 to 12, 20, 20, 44 (20.3)', () => {
    for (const [column, count] of [
      [0, 12],
      [5, 7],
      [13, 7],
      [21, 23],
    ] as const) {
      const before = make('x'.repeat(column) + '|');
      const after = apply(before, tabKey(before, assembly));
      expect(after.doc.toString()).toBe('x'.repeat(column) + ' '.repeat(count));
      expect(after.selection.main.head).toBe(column + count);
    }
  });

  it('Assembly tabs at 12, 20, 44 advance to the next stop (note 12)', () => {
    for (const [column, to] of [
      [12, 20],
      [20, 44],
      [44, 48],
      [47, 48],
    ] as const) {
      const before = make('x'.repeat(column) + '|');
      expect(apply(before, tabKey(before, assembly)).doc.length).toBe(to);
    }
  });

  it('a whole typing session: label, opcode, operand, comment land on 0, 12, 20, 44', () => {
    let state = make('|');
    const type = (text: string) => {
      const at = state.selection.main.head;
      state = state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } }).state;
    };
    const tab = () => (state = apply(state, tabKey(state, assembly)));
    type('START:');
    tab();
    type('MOVE.B');
    tab();
    type('#14,D0');
    tab();
    type('* comment');
    const text = state.doc.toString();
    expect(text.indexOf('MOVE.B')).toBe(12);
    expect(text.indexOf('#14')).toBe(20);
    expect(text.indexOf('*')).toBe(44);
    expect(text).not.toContain('\t');
  });

  it('counts columns after existing tab characters with the document stops', () => {
    const before = make('\tAB|');
    // The tab displays to 12, so the caret is at column 14 -> next stop 20.
    expect(apply(before, tabKey(before, assembly)).doc.toString()).toBe('\tAB      ');
  });

  it('with a selection: blanks at the selection end, the selection is dropped, nothing is deleted', () => {
    const before = make('[ab]c');
    expect(show(apply(before, tabKey(before, fixed4)))).toBe('ab  |c');
  });

  it('Shift+Tab is not Tab (note 12): it deletes the blanks back to the previous stop', () => {
    expect(show(apply(make('ab      |x'), shiftTabKey(make('ab      |x'), fixed4)))).toBe('ab  |x');
    const at20 = make('LABEL' + ' '.repeat(15) + '|');
    expect(show(apply(at20, shiftTabKey(at20, assembly)))).toBe('LABEL       |');
    // Only blanks are deleted, never text.
    expect(shiftTabKey(make('abcdef|'), fixed4)).toBeNull();
    const short = make('abcde |');
    expect(show(apply(short, shiftTabKey(short, fixed4)))).toBe('abcde|');
  });

  it('one Tab press is one undo step', () => {
    let state = make('ab|', true);
    state = apply(state, tabKey(state, fixed4));
    state = apply(state, tabKey(state, fixed4));
    expect(undoDepth(state)).toBe(2);
    state = runCommand(state, undo);
    expect(show(state)).toBe('ab  |');
  });
});

describe('Tab, Real Tabs on (20.3)', () => {
  it('stores one tab character, replacing the selection', () => {
    const options = { ...assembly, realTabs: true };
    expect(show(apply(make('ab|c'), tabKey(make('ab|c'), options)))).toBe('ab\t|c');
    expect(show(apply(make('a[bc]d'), tabKey(make('a[bc]d'), options)))).toBe('a\t|d');
  });
});

describe('Enter and Auto Indent (editor-ui §8.4, 20.3)', () => {
  function enter(state: EditorState, autoIndent: boolean): EditorState {
    const lead = whiteSpaceBeforeEnter(state);
    let next = apply(state, enterKey(state));
    if (autoIndent) next = apply(next, autoIndentAfterEnter(next, lead));
    return next;
  }

  it('at the end of a line that starts with four blanks: the new line starts with them', () => {
    expect(show(enter(make('    MOVE D0,D1|'), true))).toBe('    MOVE D0,D1\n    |');
  });

  it('a line that starts with a tab gives a tab', () => {
    expect(show(enter(make('\tNOP|'), true))).toBe('\tNOP\n\t|');
  });

  it('in the middle of a line: no white space is added', () => {
    expect(show(enter(make('    MOVE| D0,D1'), true))).toBe('    MOVE\n| D0,D1');
  });

  it('the whole leading white space of the line is used, wherever the caret is', () => {
    expect(show(enter(make('  | \tX\n'), true))).toBe('  \n| \tX\n');
    expect(show(enter(make(' \t x|'), true))).toBe(' \t x\n \t |');
  });

  it('off: no white space', () => {
    expect(show(enter(make('    NOP|'), false))).toBe('    NOP\n|');
  });

  it('Enter replaces a selection', () => {
    expect(show(enter(make('  a[bc]d'), true))).toBe('  a\n|d');
  });

  it('the indentation is a separate undo step', () => {
    let state = make('    NOP|', true);
    state = enter(state, true);
    expect(undoDepth(state)).toBe(2);
    state = runCommand(state, undo);
    expect(show(state)).toBe('    NOP\n|');
  });
});

describe('Comment, Uncomment, Indent, Outdent (editor-ui §8.5, note 6, 20.3)', () => {
  it('Comment on three selected lines puts * in column 0 of each', () => {
    const state = make('[A\n B\nC]\nD');
    const after = apply(state, commentSelection(state));
    expect(after.doc.toString()).toBe('*A\n* B\n*C\nD');
    // Same start offset, length grown by the three characters.
    expect(show(after)).toBe('[*A\n* B\n*C]\nD');
  });

  it('a line that is already a comment gets a second *', () => {
    const state = make('[* x]');
    expect(apply(state, commentSelection(state)).doc.toString()).toBe('** x');
  });

  it('Uncomment removes one * per line only where column 0 is *', () => {
    const state = make('[**A\n B*\n *C\n;D\n*E]');
    const after = apply(state, uncommentSelection(state));
    expect(after.doc.toString()).toBe('*A\n B*\n *C\n;D\nE');
    expect(show(after)).toBe('[*A\n B*\n *C\n;D\nE]');
  });

  it('Uncomment with no * in column 0 does nothing', () => {
    expect(uncommentSelection(make('[ *A\nB]'))).toBeNull();
  });

  it('Ctrl+Shift+. adds one space, Ctrl+Shift+, removes one', () => {
    const state = make('[A\n  B]');
    const indented = apply(state, indentSelection(state));
    expect(indented.doc.toString()).toBe(' A\n   B');
    const outdented = apply(indented, outdentSelection(indented));
    expect(outdented.doc.toString()).toBe('A\n  B');
    const again = apply(outdented, outdentSelection(outdented));
    expect(again.doc.toString()).toBe('A\n B');
  });

  it('a selection that ends at the very beginning of a line leaves that line out', () => {
    const state = make('[A\nB\n]C');
    expect(affectedLines(state)).toEqual({ first: 1, last: 2 });
    expect(apply(state, commentSelection(state)).doc.toString()).toBe('*A\n*B\nC');
  });

  it('without a selection: the caret line, also at column 0 (note 6); the caret moves with its text', () => {
    const state = make('A\n|B\nC');
    const after = apply(state, commentSelection(state));
    expect(show(after)).toBe('A\n*|B\nC');
    const mid = make('A\nB|B\nC');
    expect(show(apply(mid, commentSelection(mid)))).toBe('A\n*B|B\nC');
  });

  it('each command is one undo step, and undo restores the text exactly (note 6)', () => {
    let state = make('ab\nc[d\ne]f', true);
    state = apply(state, commentSelection(state));
    expect(state.doc.toString()).toBe('ab\n*cd\n*ef');
    expect(undoDepth(state)).toBe(1);
    state = runCommand(state, undo);
    expect(state.doc.toString()).toBe('ab\ncd\nef');
    state = runCommand(state, redo);
    expect(state.doc.toString()).toBe('ab\n*cd\n*ef');
  });
});

describe('Replace mode (editor-ui §8.6)', () => {
  it('typing replaces the following characters of the line, never the line break', () => {
    const state = make('ab|cd\nef');
    const after = apply(state, overwriteInput(state, 2, 2, 'XYZ'));
    expect(show(after)).toBe('abXYZ|\nef');
  });

  it('one character over one character', () => {
    const state = make('a|bc');
    expect(show(apply(state, overwriteInput(state, 1, 1, 'X')))).toBe('aX|c');
  });

  it('at the end of a line it inserts', () => {
    const state = make('ab|');
    expect(show(apply(state, overwriteInput(state, 2, 2, 'X')))).toBe('abX|');
  });

  it('a selection, or text with a line break, is not overwrite typing', () => {
    expect(overwriteInput(make('a[b]c'), 1, 2, 'X')).toBeNull();
    expect(overwriteInput(make('a|bc'), 1, 1, 'X\nY')).toBeNull();
  });

  it('overwrite typing is undoable (note 5)', () => {
    let state = make('a|bc', true);
    state = apply(state, overwriteInput(state, 1, 1, 'X'));
    state = runCommand(state, undo);
    expect(state.doc.toString()).toBe('abc');
  });
});

describe('Undo granularity (note 5 replaces the one-record-per-keystroke stacks of §8.9)', () => {
  it('typed characters are grouped; a paste, a cut and a comment are single steps; redo works', () => {
    let state = make('|', true);
    const at = (n: number) => ({ anchor: n });
    // Three characters typed in quick succession (same time stamp): one group.
    for (const ch of 'abc') {
      const pos = state.selection.main.head;
      state = state.update({
        changes: { from: pos, insert: ch },
        selection: at(pos + 1),
        userEvent: 'input.type',
      }).state;
    }
    expect(undoDepth(state)).toBe(1);
    // A paste of two lines: one step.
    state = state.update({
      changes: { from: 3, insert: '\nX\nY' },
      selection: at(7),
      userEvent: 'input.paste',
    }).state;
    expect(undoDepth(state)).toBe(2);
    state = apply(state, commentSelection(state));
    expect(undoDepth(state)).toBe(3);
    state = runCommand(state, undo);
    expect(state.doc.toString()).toBe('abc\nX\nY');
    state = runCommand(state, undo);
    expect(state.doc.toString()).toBe('abc');
    state = runCommand(state, redo);
    expect(state.doc.toString()).toBe('abc\nX\nY');
  });
});

describe('pasted text', () => {
  it('CR LF and lone CR become line feeds; tabs stay', () => {
    expect(normalizeLineBreaks('a\r\nb\rc\n\td')).toBe('a\nb\nc\n\td');
  });
});
