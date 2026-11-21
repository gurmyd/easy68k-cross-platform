import { selectAll, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { chordsOn } from '../../commands/specs';
import { TEXT_EDITING_COMMANDS } from '../../commands/tables/keys';
import type { ClipboardEnv } from './clipboard';
import { clipboardHasNothingToTake, clipboardKeysEnv, editorKeymap } from './extensions';

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

describe('Ctrl+letter on macOS (rule K2, errata E2.md entry 13)', () => {
  // The chord table of the application, not a copy of it: a chord added there for a text-editing
  // command must get its binding here too.
  const toCodeMirror = (chord: string) =>
    chord
      .split('+')
      .map((part, i, parts) => (i === parts.length - 1 ? part.toLowerCase() : part))
      .join('-');

  it('every Ctrl chord the macOS key map gives a text-editing command is bound by the editor on macOS', () => {
    const macKeys = new Set(editorKeymap.map((binding) => binding.mac).filter(Boolean));
    const wanted = TEXT_EDITING_COMMANDS.flatMap((id) => chordsOn(id, 'mac', false)).filter((chord) =>
      /^Ctrl\+[A-Z]$/.test(chord),
    );
    expect(wanted.sort()).toEqual(['Ctrl+A', 'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z']);
    for (const chord of wanted) expect(macKeys, chord).toContain(toCodeMirror(chord));
    // Only on macOS: on Windows and Linux Ctrl is CodeMirror's Mod and the browser's own keys.
    for (const binding of editorKeymap.filter((b) => b.mac?.startsWith('Ctrl-'))) {
      expect(binding.key).toBeUndefined();
      expect(binding.preventDefault).toBe(true);
    }
  });

  function fakeView(doc: string, anchor: number, head: number, env: ClipboardEnv | null) {
    let state = EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: env ? clipboardKeysEnv.of(() => env) : [],
    });
    return {
      get state() {
        return state;
      },
      focus() {},
      dispatch(...specs: TransactionSpec[]) {
        state = state.update(...specs).state;
      },
    } as unknown as EditorView;
  }

  function fakeEnv(patch: Partial<ClipboardEnv> = {}) {
    const calls: string[] = [];
    const env: ClipboardEnv = {
      execCommand: (command) => {
        calls.push(command);
        return true;
      },
      readText: async () => 'PASTED\r\nTEXT',
      writeText: null,
      pasteIntoFocus: null,
      toast: (text) => calls.push(`toast:${text}`),
      os: 'mac',
      ...patch,
    };
    return { env, calls };
  }

  const binding = (mac: string) => editorKeymap.find((b) => b.mac === mac)!;

  it('Ctrl+C and Ctrl+X copy and cut the selection through the browser', () => {
    const { env, calls } = fakeEnv();
    expect(binding('Ctrl-c').run!(fakeView('line1\nline2', 6, 11, env))).toBe(true);
    expect(binding('Ctrl-x').run!(fakeView('line1\nline2', 6, 11, env))).toBe(true);
    expect(calls).toEqual(['copy', 'cut']);
  });

  it('Ctrl+C and Ctrl+X without a selection do nothing (§8.7)', () => {
    const { env, calls } = fakeEnv();
    binding('Ctrl-c').run!(fakeView('line1', 2, 2, env));
    binding('Ctrl-x').run!(fakeView('line1', 2, 2, env));
    expect(calls).toEqual([]);
  });

  it('Ctrl+V pastes as Paste from the menu does, and says Press Cmd+V to paste when refused', async () => {
    const { env } = fakeEnv();
    const view = fakeView('A|B', 2, 2, env);
    binding('Ctrl-v').run!(view);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.state.doc.toString()).toBe('A|PASTED\nTEXTB');

    const refused = fakeEnv({ readText: () => Promise.reject(new Error('NotAllowedError')) });
    const other = fakeView('AB', 1, 1, refused.env);
    binding('Ctrl-v').run!(other);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(other.state.doc.toString()).toBe('AB');
    expect(refused.calls).toEqual(['toast:Press Cmd+V to paste']);
  });

  it('Ctrl+Z undoes and Ctrl+A selects all', () => {
    expect(binding('Ctrl-z').run).toBe(undo);
    expect(binding('Ctrl-a').run).toBe(selectAll);
  });

  it('without the clipboard functions the clipboard keys are not taken', () => {
    expect(binding('Ctrl-c').run!(fakeView('line1', 0, 5, null))).toBe(false);
  });
});
