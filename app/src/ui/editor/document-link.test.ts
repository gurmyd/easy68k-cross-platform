// The document link with its two kinds of document service: E1's real DocumentManager and a stub.
import type { Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { AppContext, DocumentState } from '../../contracts';
import { DocumentManager, documentRegistryOf } from '../../core/documents';
import { defaultSettings } from '../../core/settings/defaults';
import { createVfs } from '../../fs/vfs';
import { createAppStore, createStore } from '../../state/store';
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

/** E1's real DocumentManager with inert file system and dialogs: the service the application has. */
function realManager() {
  const settings = defaultSettings();
  const store = createAppStore(settings);
  const manager = new DocumentManager({
    store,
    settings: { get: () => settings },
    dialogs: {
      messageBox: async () => {
        throw new Error('unexpected message box');
      },
      toast: () => {},
    },
    vfs: createVfs(),
    fileDialogs: { open: async () => null, save: async () => null },
  });
  return { store, manager, ctx: { store, documents: manager } as unknown as AppContext };
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

  it("with E1's DocumentManager: edits are stored in its registry, outside changes reach the view", () => {
    const { manager, ctx, store } = realManager();
    const id = manager.newSource().id;
    const registry = documentRegistryOf(manager);
    registry.replace(id, 'ABC');
    expect(editorAccessOf(ctx)).not.toBeNull();
    const link = createDocumentLink(ctx);
    expect(link.shared).toBe(true);
    const seen: (Transaction | undefined)[] = [];
    link.onExternalChange(id, (tr) => seen.push(tr));

    // The editor's own transaction: stored in the registry (so Save and Assemble see it), and not
    // reported back as an outside change.
    link.commit(id, link.state(id).update({ changes: { from: 3, insert: 'D' } }));
    expect(manager.text(id)).toBe('ABCD');
    expect(seen).toEqual([]);
    expect(link.modified(id)).toBe(true);

    // Another part changes the state: reported with its transaction.
    registry.dispatch(id, { changes: { from: 0, insert: '>' } });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.state.doc.toString()).toBe('>ABCD');

    // Reload replaces the state: reported without a transaction.
    registry.replace(id, 'new');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeUndefined();
    expect(link.state(id).doc.toString()).toBe('new');

    // Insert/Replace goes through the contract's update() into DocumentState.
    expect(link.insertMode(id)).toBe(true);
    link.setInsertMode(id, false);
    expect(store.getState().documents.items.find((d) => d.id === id)?.insertMode).toBe(false);
    expect(link.insertMode(id)).toBe(false);
  });

  it('a service that only implements the contract (a test double) gets the local states', () => {
    const ctx = context({ text: () => 'P', list: () => [], update: () => {} }, [doc('d1')]);
    expect(editorAccessOf(ctx)).toBeNull();
    expect(createDocumentLink(ctx).state('d1').doc.toString()).toBe('P');
  });
});
