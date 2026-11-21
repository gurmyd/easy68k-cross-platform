import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { clipboardHasNothingToTake, editorKeymap } from './extensions';

describe('Cut and Copy keys without a selection (editor-ui §8.7)', () => {
  const state = (selection: EditorSelection) =>
    EditorState.create({
      doc: 'line1\nline2\nline3',
      selection,
      extensions: EditorState.allowMultipleSelections.of(true),
    });

  it('an empty selection has nothing to take, so the line-wise cut / copy is cancelled', () => {
    expect(clipboardHasNothingToTake(state(EditorSelection.single(8)))).toBe(true);
    expect(
      clipboardHasNothingToTake(state(EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(8)]))),
    ).toBe(true);
  });

  it('a selection is cut and copied as usual', () => {
    expect(clipboardHasNothingToTake(state(EditorSelection.single(6, 11)))).toBe(false);
    expect(clipboardHasNothingToTake(state(EditorSelection.single(11, 6)))).toBe(false);
  });
});

describe('Enter with any modifiers (editor-ui §5.2 rule 11)', () => {
  it('every combination of Alt, Ctrl, Meta and Shift with Enter is bound to the same command', () => {
    const enter = editorKeymap.filter((binding) => binding.key?.endsWith('Enter'));
    const keys = enter.map((binding) => binding.key);
    for (const key of [
      'Enter',
      'Alt-Enter',
      'Ctrl-Enter',
      'Meta-Enter',
      'Alt-Ctrl-Enter',
      'Alt-Meta-Enter',
      'Ctrl-Meta-Enter',
      'Alt-Ctrl-Meta-Enter',
    ]) {
      expect(keys).toContain(key);
    }
    const run = enter[0]!.run;
    for (const binding of enter) {
      expect(binding.run).toBe(run);
      expect(binding.shift).toBe(run);
    }
  });
});
