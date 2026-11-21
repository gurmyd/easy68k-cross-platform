import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { DocumentRegistry, type RegistryEvent } from './registry';

describe('DocumentRegistry (3.9.1)', () => {
  it('holds one EditorState per document with "\\n" between lines and the caret at the start', () => {
    const registry = new DocumentRegistry();
    const state = registry.create('a', 'one\ntwo\n');
    expect(state.doc.lines).toBe(3);
    expect(state.selection.main.head).toBe(0);
    expect(registry.text('a')).toBe('one\ntwo\n');
    expect(registry.ids()).toEqual(['a']);
    expect(() => registry.create('a', '')).toThrow(/already exists/);
    expect(() => registry.state('b')).toThrow(/No open document/);
  });

  it('turns CR LF and lone CR in inserted text into line breaks', () => {
    const registry = new DocumentRegistry();
    registry.create('a', '');
    registry.dispatch('a', { changes: { from: 0, insert: 'x\r\ny\rz' } });
    expect(registry.text('a')).toBe('x\ny\nz');
  });

  it('is modified exactly while the text differs from the saved text', () => {
    const registry = new DocumentRegistry();
    registry.create('a', 'abc');
    expect(registry.isModified('a')).toBe(false);
    registry.dispatch('a', { changes: { from: 3, insert: 'd' } });
    expect(registry.isModified('a')).toBe(true);
    registry.dispatch('a', { changes: { from: 3, to: 4 } });
    expect(registry.isModified('a')).toBe(false);
    registry.dispatch('a', { changes: { from: 0, insert: 'X' } });
    registry.markSaved('a');
    expect(registry.isModified('a')).toBe(false);
    registry.create('b', 'draft', { modified: true });
    expect(registry.isModified('b')).toBe(true);
    registry.markSaved('b');
    expect(registry.isModified('b')).toBe(false);
  });

  it('apply refuses a transaction made from an older state', () => {
    const registry = new DocumentRegistry();
    const old = registry.create('a', 'abc');
    registry.dispatch('a', { changes: { from: 0, insert: '1' } });
    expect(() => registry.apply('a', old.update({ changes: { from: 0, insert: '2' } }))).toThrow(/current state/);
  });

  it('reports created, updated, replaced and removed', () => {
    const registry = new DocumentRegistry();
    const events: string[] = [];
    const stop = registry.subscribe((event: RegistryEvent) =>
      events.push(event.kind === 'updated' ? `updated:${event.transaction.docChanged}` : `${event.kind}`),
    );
    registry.create('a', 'x');
    registry.dispatch('a', { selection: { anchor: 1 } });
    registry.dispatch('a', { changes: { from: 0, insert: 'y' } });
    registry.replace('a', 'new');
    registry.remove('a');
    registry.remove('a');
    stop();
    registry.create('b', '');
    expect(events).toEqual(['created', 'updated:false', 'updated:true', 'replaced', 'removed']);
  });

  it('replace gives a fresh state: new text, caret at 0, counted as saved', () => {
    const registry = new DocumentRegistry();
    registry.create('a', 'abc');
    registry.dispatch('a', { changes: { from: 0, insert: 'zz' }, selection: { anchor: 2 } });
    const state = registry.replace('a', 'fresh');
    expect(state.doc.toString()).toBe('fresh');
    expect(state.selection.main.head).toBe(0);
    expect(registry.isModified('a')).toBe(false);
  });

  it('setExtensions configures new and replaced states and reconfigures existing ones', () => {
    const counter = StateField.define<number>({ create: () => 7, update: (value) => value });
    const registry = new DocumentRegistry();
    registry.create('old', 'x');
    const seen: string[] = [];
    registry.subscribe((event) => {
      if (event.kind === 'updated' && event.transaction.effects.some((e) => e.is(StateEffect.reconfigure))) {
        seen.push(event.id);
      }
    });
    registry.setExtensions(() => counter);
    expect(seen).toEqual(['old']);
    expect(registry.state('old').field(counter)).toBe(7);
    expect(registry.create('new', 'y').field(counter)).toBe(7);
    expect(registry.replace('new', 'z').field(counter)).toBe(7);
    expect(registry.state('new')).toBeInstanceOf(EditorState);
  });
});
