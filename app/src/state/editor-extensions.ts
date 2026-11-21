// Editor extensions contributed by features (ARCHITECTURE.md 3.12.3, AppContext.editorExtensions).
// Owner: W3.
//
// Features such as the syntax highlighter and the assembler's inline markers add behaviour to the
// editor without importing it: each registers a SOURCE, a function from a document to a CodeMirror
// extension. The editor component (ui/editor, owner E2) applies every registered source to every
// document view. It reads the sources with editorExtensionSources(ctx) and re-configures its views
// when subscribeEditorExtensions(ctx, ...) fires.

import type { AppContext, DocumentState, Extension } from '../contracts';

export type EditorExtensionSource = (doc: DocumentState) => Extension;

export interface EditorExtensionRegistry {
  register(source: EditorExtensionSource): () => void;
  /** The registered sources, in registration order. */
  sources(): readonly EditorExtensionSource[];
  /** Fires when a source is registered or removed. */
  subscribe(listener: () => void): () => void;
}

export function createEditorExtensionRegistry(): EditorExtensionRegistry {
  let sources: readonly EditorExtensionSource[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    register(source) {
      sources = [...sources, source];
      notify();
      return () => {
        if (!sources.includes(source)) return;
        sources = sources.filter((other) => other !== source);
        notify();
      };
    },
    sources: () => sources,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function registryOf(ctx: AppContext): EditorExtensionRegistry {
  const registry = ctx.editorExtensions as Partial<EditorExtensionRegistry>;
  if (typeof registry.sources !== 'function' || typeof registry.subscribe !== 'function') {
    throw new Error('AppContext.editorExtensions was not created by bootstrap()');
  }
  return registry as EditorExtensionRegistry;
}

/** For the editor component: every registered source. */
export function editorExtensionSources(ctx: AppContext): readonly EditorExtensionSource[] {
  return registryOf(ctx).sources();
}

/** For the editor component: called whenever the list of sources changes. */
export function subscribeEditorExtensions(ctx: AppContext, listener: () => void): () => void {
  return registryOf(ctx).subscribe(listener);
}
