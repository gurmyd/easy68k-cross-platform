// The CodeMirror view of one document (ARCHITECTURE.md 2.2, 2.4, 3.9.1). Owner: E2.
//
// The view is attached to the document's EditorState (through the document link) and adds the
// editor's configuration in `editorCompartment`. Every transaction the view makes is stored back
// through the link, so the document service always holds the text the user sees.

import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import type { DocumentState } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { editorExtensionSources, subscribeEditorExtensions } from '../../state/editor-extensions';
import { shallowEqual } from '../../state/store';
import { editorCompartment, editorConfig, type DocumentViewOptions } from './extensions';
import { fontFamilyFor, fontSizeFor } from './fonts';
import { markerMessages, setMarkers } from './markers';
import { editorSession } from './session';

export interface DocumentEditorProps {
  doc: DocumentState;
  /** The active document of the window: its text area is where focusPanel('editor') lands. */
  active: boolean;
}

/** Puts a configuration into a view's state: the first time by appending the compartment. */
function configure(view: EditorView, config: ReturnType<typeof editorConfig>) {
  const effect =
    editorCompartment.get(view.state) === undefined
      ? StateEffect.appendConfig.of(editorCompartment.of(config))
      : editorCompartment.reconfigure(config);
  view.dispatch({ effects: effect });
}

export function DocumentEditor({ doc, active }: DocumentEditorProps) {
  const ctx = useAppContext();
  const session = editorSession(ctx);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configRef = useRef<ReturnType<typeof editorConfig> | null>(null);

  const global = useAppState(
    (state) => ({
      realTabs: state.settings.editor.realTabs,
      autoIndent: state.settings.editor.autoIndent,
      lineNumbers: state.settings.editor.lineNumbers,
    }),
    shallowEqual,
  );
  const sources = useSyncExternalStore(
    (listener) => subscribeEditorExtensions(ctx, listener),
    () => editorExtensionSources(ctx),
  );
  const insertMode = useSyncExternalStore(session.link.subscribe, () => session.link.insertMode(doc.id));
  const messages = useAppState((state) => state.messages[doc.id]);

  const options = useMemo<DocumentViewOptions>(
    () => ({
      tabType: doc.tabType,
      tabSize: doc.tabSize,
      realTabs: global.realTabs,
      autoIndent: global.autoIndent,
      insertMode,
    }),
    [doc.tabType, doc.tabSize, global.realTabs, global.autoIndent, insertMode],
  );
  // The extensions of other features see the document; they are asked again when something that
  // could change their answer changes (kind, name, path, tab model, font), not on every edit.
  const docKey = `${doc.kind}|${doc.name}|${doc.path ?? ''}|${doc.tabType}|${doc.tabSize}|${doc.fontName}|${doc.fontSize}`;
  const docRef = useRef(doc);
  docRef.current = doc;
  const features = useMemo(
    () => sources.map((source) => source(docRef.current)),
    // docKey stands for the parts of `doc` that matter.
    [sources, docKey],
  );
  const config = useMemo(
    () => editorConfig({ options, lineNumbers: global.lineNumbers, label: doc.name, features }),
    [options, global.lineNumbers, doc.name, features],
  );
  configRef.current = config;

  // Create the view once per document.
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const id = doc.id;
    const view = new EditorView({
      state: session.link.state(id),
      parent,
      dispatchTransactions(transactions, target) {
        target.update(transactions);
        for (const tr of transactions) session.link.commit(id, tr);
        session.changed();
      },
    });
    viewRef.current = view;
    // Development builds: the browser check (check-editor.mjs) reaches the view from its element.
    if (import.meta.env.DEV) (parent as HTMLDivElement & { e68View?: EditorView }).e68View = view;
    if (configRef.current) configure(view, configRef.current);
    const snapshot = session.scroll.get(id);
    if (snapshot) view.dispatch({ effects: snapshot });
    else view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });

    const onFocus = () => session.focusChanged(id, true);
    const onBlur = () => session.focusChanged(id, false);
    view.contentDOM.addEventListener('focus', onFocus);
    view.contentDOM.addEventListener('blur', onBlur);
    const unregister = session.registerView(id, view);
    // A change made elsewhere (Reload replaces the state; a reconfiguration by another part): follow it.
    const stopExternal = session.link.onExternalChange(id, (tr) => {
      const next = session.link.state(id);
      if (next === view.state) return;
      if (tr && tr.startState === view.state) view.update([tr]);
      else view.setState(next);
      // A replaced or reconfigured state may have lost the editor's configuration.
      if (editorCompartment.get(view.state) === undefined && configRef.current) configure(view, configRef.current);
      session.changed();
    });
    if (view.hasFocus) session.focusChanged(id, true);
    return () => {
      session.scroll.set(id, view.scrollSnapshot());
      stopExternal();
      view.contentDOM.removeEventListener('focus', onFocus);
      view.contentDOM.removeEventListener('blur', onBlur);
      if (view.hasFocus) session.focusChanged(id, false);
      unregister();
      view.destroy();
      viewRef.current = null;
    };
  }, [doc.id, session]);

  // Reconfigure when an input changed.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view) configure(view, config);
  }, [config]);

  // Markers of the last assembly (2.2): replaced whenever the document's message list changes.
  useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: setMarkers.of(markerMessages(messages)) });
  }, [messages]);

  // Where the focus goes when the editor area is focused (state/panels.ts).
  useEffect(() => {
    const content = viewRef.current?.contentDOM;
    if (!content) return;
    if (active) content.setAttribute('data-e68-panel-focus', '');
    else content.removeAttribute('data-e68-panel-focus');
  }, [active]);

  const style: CSSProperties = { fontFamily: fontFamilyFor(doc.fontName), fontSize: fontSizeFor(doc.fontSize) };
  return <div ref={host} className="e68-editor__view" style={style} data-e68-document={doc.id} />;
}
