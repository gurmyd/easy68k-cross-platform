// The document link with its three kinds of document service, each a small test double.
import { EditorState, type Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { AppContext, DocumentState } from '../../contracts';
import { createStore } from '../../state/store';
import { createDocumentLink, editorAccessOf } from './document-link';

const doc = (id: string, patch: Partial<DocumentState> = {}): DocumentState => ({
  id,
  path: null,
  name: `${id}.x68`,
  kind: 'source',
  hasName: false,
  tabType: 1,
  tabSize: 4,
  fontName: 'Courier New',
  fontSize: 10,
  insertMode: true,
  modified: false,
  revision: 0,
  ...patch,
});

/** A context with just what the link reads: the store's documents and the document service. */
function context(documents: object, items: DocumentState[]): AppContext {
  const store = createStore({ documents: { items, activeId: items[0]?.id ?? null } });
  return { store, documents } as unknown as AppContext;
}

/** A registry of the shape E1's DocumentManager exposes (a double, not E1's code). */
function fakeRegistry(text: string) {
  type Event = { kind: string; id: string; transaction?: Transaction };
  const listeners = new Set<(event: Event) => void>();
  let state = EditorState.create({ doc: text });
  const updates: unknown[] = [];
  return {
    updates,
    registry: {
      state: () => state,
      apply(id: string, tr: Transaction) {
        if (tr.startState !== state) throw new Error('stale');
        state = tr.state;
        for (const l of [...listeners]) l({ kind: 'updated', id, transaction: tr });
      },
      subscribe(listener: (event: Event) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      /** Something other than the editor changes the state. */
      external(id: string, insert: string) {
        const tr = state.update({ changes: { from: 0, insert } });
        state = tr.state;
        for (const l of [...listeners]) l({ kind: 'updated', id, transaction: tr });
      },
      replace(id: string, next: string) {
        state = EditorState.create({ doc: next });
        for (const l of [...listeners]) l({ kind: 'replaced', id });
      },
    },
    update: (id: string, patch: unknown) => void updates.push([id, patch]),
  };
}

describe('document link', () => {
  it('without access (wave-0 stub): local states from text(id), Modified against the loaded text', () => {
    const ctx = context({ text: () => 'ABC', list: () => [] }, [doc('d1')]);
    const link = createDocumentLink(ctx);
    expect(link.shared).toBe(false);
    const state = link.state('d1');
    expect(state.doc.toString()).toBe('ABC');
    const tr = state.update({ changes: { from: 0, insert: 'x' } });
    link.commit('d1', tr);
    expect(link.state('d1').doc.toString()).toBe('xABC');
    expect(link.modified('d1')).toBe(true);
    link.commit('d1', link.state('d1').update({ changes: { from: 0, to: 1 } }));
    expect(link.modified('d1')).toBe(false);
    link.setInsertMode('d1', false);
    expect(link.insertMode('d1')).toBe(false);
  });

  it('a document the service does not know gets an empty text instead of an error', () => {
    const ctx = context(
      {
        text: () => {
          throw new Error('No open document');
        },
        list: () => [],
      },
      [],
    );
    expect(createDocumentLink(ctx).state('nope').doc.length).toBe(0);
  });

  it("with a registry of E1's shape: edits are stored there, outside changes reach the view", () => {
    const fake = fakeRegistry('ABC');
    const ctx = context({ text: () => '', list: () => [], registry: fake.registry, update: fake.update }, [
      doc('d1', { modified: true, insertMode: false }),
    ]);
    expect(editorAccessOf(ctx)).not.toBeNull();
    const link = createDocumentLink(ctx);
    expect(link.shared).toBe(true);
    const seen: (Transaction | undefined)[] = [];
    link.onExternalChange('d1', (tr) => seen.push(tr));

    // The editor's own transaction: stored, and not reported back as an outside change.
    link.commit('d1', link.state('d1').update({ changes: { from: 3, insert: 'D' } }));
    expect(fake.registry.state().doc.toString()).toBe('ABCD');
    expect(seen).toEqual([]);

    // Another part changes the state: reported with its transaction.
    fake.registry.external('d1', '>');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.state.doc.toString()).toBe('>ABCD');

    // Reload replaces the state: reported without a transaction.
    fake.registry.replace('d1', 'new');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeUndefined();
    expect(link.state('d1').doc.toString()).toBe('new');

    // Modified and Insert/Replace come from DocumentState; Insert/Replace is set through update().
    expect(link.modified('d1')).toBe(true);
    expect(link.insertMode('d1')).toBe(false);
    link.setInsertMode('d1', true);
    expect(fake.updates).toEqual([['d1', { insertMode: true }]]);
  });

  it('with the access object proposed in errata E2.md entry 2, that one is used', () => {
    const access = {
      getState: () => EditorState.create({ doc: 'P' }),
      apply: () => {},
      subscribe: () => () => {},
      setInsertMode: () => {},
    };
    const ctx = context({ text: () => '', list: () => [], editor: access }, [doc('d1')]);
    expect(editorAccessOf(ctx)).toBe(access);
    expect(createDocumentLink(ctx).state('d1').doc.toString()).toBe('P');
  });
});
