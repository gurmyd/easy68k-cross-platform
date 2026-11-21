// The editor of one window: document views, focus, panes, and the operations of the Edit and
// Window menus (ARCHITECTURE.md 2.2, 2.4; editor-ui §2.2, §2.5, §8). Owner: E2.
//
// `editorSession(ctx)` returns the one session of the window `ctx` belongs to. The React components
// of this folder register their CodeMirror views with it; the commands of features/editor call its
// operations (EditorActions). An operation works on the active document: through its view when the
// document is shown, otherwise directly on its EditorState through the document link.

import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { StateEffect, type EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { AppContext, DocumentState, Settings } from '../../contracts';
import type { EditorActions, EditorPaneLayout } from '../../features/editor/editor-api';
import {
  cutOrCopy,
  pasteFromMenu,
  selectAllIn,
  targetHasSelection,
  type ClipboardEnv,
  type ClipboardTarget,
  type TextFieldLike,
} from './clipboard';
import { createDocumentLink, type DocumentLink } from './document-link';
import { commentSelection, indentSelection, outdentSelection, uncommentSelection } from './editing';
import { editorCompartment, editorConfig } from './extensions';
import { PaneModel, tilePanes } from './panes';

export interface EditorSession extends EditorActions {
  readonly ctx: AppContext;
  readonly link: DocumentLink;
  readonly panes: PaneModel;
  /** The view of a document while it is shown. */
  registerView(id: string, view: EditorView): () => void;
  view(id: string): EditorView | undefined;
  /** A view gained or lost the focus. */
  focusChanged(id: string, focused: boolean): void;
  /** After every transaction of a view: tell menus and toolbars when their enabled state changed. */
  changed(): void;
  /** Scroll positions of documents whose view was taken down (tab switch). */
  readonly scroll: Map<string, StateEffect<unknown>>;
  /** Overrides of the page's clipboard functions (tests). */
  clipboardEnv: ClipboardEnv;
  dispose(): void;
}

const sessions = new WeakMap<AppContext, EditorSession>();

/** The editor session of the window `ctx` belongs to. */
export function editorSession(ctx: AppContext): EditorSession {
  let session = sessions.get(ctx);
  if (!session) {
    session = createEditorSession(ctx);
    sessions.set(ctx, session);
  }
  return session;
}

/** The page's clipboard functions (a browser, or the desktop app's renderer). */
export function pageClipboardEnv(ctx: AppContext): ClipboardEnv {
  const doc = globalThis.document as Document | undefined;
  const clipboard = (globalThis.navigator as Navigator | undefined)?.clipboard;
  return {
    execCommand: (command) => {
      try {
        return doc?.execCommand(command) ?? false;
      } catch {
        return false;
      }
    },
    readText: clipboard?.readText ? () => clipboard.readText() : null,
    writeText: clipboard?.writeText ? (text) => clipboard.writeText(text) : null,
    pasteIntoFocus: ctx.platform.pasteIntoFocus,
    toast: (text) => ctx.dialogs.toast(text),
    os: ctx.platform.os,
  };
}

interface ElementLike {
  tagName?: unknown;
  type?: unknown;
  isConnected?: unknown;
  closest?: (selector: string) => unknown;
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', '']);

/** A text field outside the editor: an input that takes text, or a textarea. */
function asTextField(element: unknown): TextFieldLike | null {
  const candidate = element as ElementLike | null;
  if (!candidate || typeof candidate.tagName !== 'string') return null;
  const tag = candidate.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return candidate as unknown as TextFieldLike;
  if (tag === 'INPUT' && TEXT_INPUT_TYPES.has(typeof candidate.type === 'string' ? candidate.type : '')) {
    return candidate as unknown as TextFieldLike;
  }
  return null;
}

export function createEditorSession(ctx: AppContext): EditorSession {
  const link = createDocumentLink(ctx);
  const panes = new PaneModel();
  const views = new Map<string, EditorView>();
  const scroll = new Map<string, StateEffect<unknown>>();
  let focused: string | null = null;
  /** The text field outside the editor that had the focus last, or 'editor'. */
  let lastText: TextFieldLike | 'editor' | null = null;
  let fingerprint = '';

  const doc = globalThis.document as Document | undefined;
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target as ElementLike | null;
    if (target && typeof target.closest === 'function' && target.closest('.cm-editor')) lastText = 'editor';
    else {
      const field = asTextField(target);
      if (field) lastText = field;
    }
  };
  doc?.addEventListener('focusin', onFocusIn, true);

  const activeId = (): string | null => {
    const id = ctx.store.getState().documents.activeId;
    return id ?? ctx.documents.active()?.id ?? null;
  };

  /**
   * The state of a document that has no view: with the editor's configuration (history above
   * all), which is added the first time, as a view would add it.
   */
  const configuredState = (id: string): EditorState => {
    const state = link.state(id);
    if (editorCompartment.get(state) !== undefined) return state;
    const doc = ctx.store.getState().documents.items.find((item) => item.id === id) ?? ctx.documents.active();
    const editor = ctx.settings.get().editor;
    const config = editorConfig({
      options: {
        tabType: doc?.tabType ?? editor.tabType,
        tabSize: doc?.tabSize ?? editor.fixedTabSize,
        realTabs: editor.realTabs,
        autoIndent: editor.autoIndent,
        insertMode: link.insertMode(id),
      },
      lineNumbers: editor.lineNumbers,
      label: doc?.name ?? '',
      features: [],
    });
    const tr = state.update({ effects: StateEffect.appendConfig.of(editorCompartment.of(config)) });
    link.commit(id, tr);
    return tr.state;
  };

  /** The active document's state, as it is (no side effect: the enabled checks call this). */
  const activeState = (): EditorState | null => {
    const id = activeId();
    if (id === null) return null;
    return views.get(id)?.state ?? link.state(id);
  };

  /** Applies a transaction to the active document, through its view when it has one. */
  const dispatchActive = (make: (state: EditorState) => TransactionSpec | null) => {
    const id = activeId();
    if (id === null) return;
    const view = views.get(id);
    const state = view?.state ?? configuredState(id);
    const spec = make(state);
    if (!spec) return;
    if (view) view.dispatch(spec);
    else {
      link.commit(id, state.update(spec));
      session.changed();
    }
  };

  const runHistory = (command: typeof undo) => {
    const id = activeId();
    if (id === null) return;
    const view = views.get(id);
    if (view) {
      command(view);
      return;
    }
    const state = configuredState(id);
    command({ state, dispatch: (tr) => link.commit(id, tr) });
    session.changed();
  };

  /** The text control the clipboard commands act on (editor-ui §8.7). */
  const clipboardTarget = (): ClipboardTarget => {
    const active = doc?.activeElement as ElementLike | null | undefined;
    const field = asTextField(active);
    if (field && !(typeof active?.closest === 'function' && active.closest('.cm-editor'))) {
      return { kind: 'field', field };
    }
    if (lastText !== null && lastText !== 'editor' && (lastText as ElementLike).isConnected === true) {
      const inEditorFocus = active && typeof active.closest === 'function' && active.closest('.cm-editor');
      if (!inEditorFocus) return { kind: 'field', field: lastText };
    }
    const id = activeId();
    const view = id === null ? undefined : views.get(id);
    return view ? { kind: 'editor', view } : null;
  };

  const session: EditorSession = {
    ctx,
    link,
    panes,
    scroll,
    clipboardEnv: pageClipboardEnv(ctx),

    registerView(id, view) {
      views.set(id, view);
      session.changed();
      return () => {
        if (views.get(id) === view) views.delete(id);
        if (focused === id) focused = null;
        session.changed();
      };
    },
    view: (id) => views.get(id),

    focusChanged(id, isFocused) {
      if (isFocused) {
        focused = id;
        lastText = 'editor';
        if (activeId() !== id) ctx.documents.activate(id);
      } else if (focused === id) {
        focused = null;
      }
      session.changed();
    },

    changed() {
      // Menus and toolbars re-read the enabled state of their commands whenever the store changes.
      // These facts are not in the store, so a change of any of them is announced by a new state
      // object (errata/E2.md, entry 6).
      const state = activeState();
      const next = [
        state ? undoDepth(state) > 0 : false,
        state ? redoDepth(state) > 0 : false,
        state ? !state.selection.main.empty : false,
        focused ?? '',
      ].join('/');
      if (next === fingerprint) return;
      fingerprint = next;
      ctx.store.setState((current) => ({ ...current }));
    },

    // ---- EditorActions
    undo: () => runHistory(undo),
    redo: () => runHistory(redo),
    canUndo() {
      const state = activeState();
      return state !== null && undoDepth(state) > 0;
    },
    canRedo() {
      const state = activeState();
      return state !== null && redoDepth(state) > 0;
    },
    cut: () => void cutOrCopy(clipboardTarget(), 'cut', session.clipboardEnv),
    copy: () => void cutOrCopy(clipboardTarget(), 'copy', session.clipboardEnv),
    paste: () => pasteFromMenu(clipboardTarget(), session.clipboardEnv),
    selectAll: () => selectAllIn(clipboardTarget()),
    hasSelection() {
      const target = clipboardTarget();
      // A field's selection changes without telling anyone; the command stays available there and
      // does nothing on an empty selection.
      if (target?.kind === 'field') return true;
      if (target) return targetHasSelection(target);
      const state = activeState();
      return state !== null && !state.selection.main.empty;
    },
    comment: () => dispatchActive(commentSelection),
    uncomment: () => dispatchActive(uncommentSelection),
    indent: () => dispatchActive(indentSelection),
    outdent: () => dispatchActive(outdentSelection),
    toggleInsert() {
      const id = activeId();
      if (id === null) return;
      link.setInsertMode(id, !link.insertMode(id));
    },
    editorHasFocus: () => focused !== null,
    hasDocument: () => activeId() !== null,
    setLayout(layout: EditorPaneLayout) {
      const current = ctx.settings.get().app.layout.editorPanes;
      if (current === 'one' && layout !== 'one') {
        const items = ctx.store.getState().documents.items;
        panes.set((state) =>
          tilePanes(
            state,
            items.map((d: DocumentState) => d.id),
            activeId(),
          ),
        );
      }
      if (current === layout) return;
      ctx.settings.update((settings: Settings): Settings => ({
        ...settings,
        app: { ...settings.app, layout: { ...settings.app.layout, editorPanes: layout } },
      }));
    },

    dispose() {
      doc?.removeEventListener('focusin', onFocusIn, true);
    },
  };
  return session;
}
