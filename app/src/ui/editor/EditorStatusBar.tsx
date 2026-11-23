// The status bar under a document (editor-ui §7.2; ARCHITECTURE.md 2.2, 1.4 note 17), and the
// status bar of Editor mode at the bottom of the window. Owner: E2 (the window status bar's place
// text: N8 in the stage of additions, ARCHITECTURE-PLUS P3.2.5).

import { useSyncExternalStore } from 'react';
import type { DocumentState, FileSystemBackend } from '../../contracts';
import { placeText } from '../../core/places/display';
import { useAppContext, useAppState } from '../../state/context';
import { editorSession } from './session';
import { statusTexts } from './status';

export function EditorStatusBar({ doc }: { doc: DocumentState }) {
  const ctx = useAppContext();
  const session = editorSession(ctx);
  const { link } = session;
  const state = useSyncExternalStore(link.subscribe, () => session.view(doc.id)?.state ?? link.state(doc.id));
  const modified = useSyncExternalStore(link.subscribe, () => link.modified(doc.id));
  const insertMode = useSyncExternalStore(link.subscribe, () => link.insertMode(doc.id));
  const texts = statusTexts(state, { tabType: doc.tabType, tabSize: doc.tabSize, modified, insertMode });

  const toggle = () => {
    link.setInsertMode(doc.id, !insertMode);
    session.view(doc.id)?.focus();
  };

  return (
    <div className="e68-editor__status" role="group" aria-label={`Status of ${doc.name}`}>
      <span className="e68-editor__cell e68-editor__cell--position" title="Line: column">
        {texts.position}
      </span>
      <span className="e68-editor__cell e68-editor__cell--modified">{texts.modified}</span>
      <button
        type="button"
        tabIndex={-1}
        className="e68-editor__cell e68-editor__cell--insert"
        title="Click to switch between Insert and Replace"
        aria-label={`${texts.insert} mode; click to switch between Insert and Replace`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        {texts.insert}
      </button>
      <span className="e68-editor__cell e68-editor__cell--empty" />
      <span className="e68-editor__cell e68-editor__cell--info">{texts.info}</span>
    </div>
  );
}

/**
 * The text of Editor mode's window status bar for a document: the place text of ARCHITECTURE-PLUS
 * P3.2.5 and P4.5 (`My Programs/demo/prog.X68`, `lab1.X68 - on this computer, edited in place`,
 * `Lab/prog.X68 - in the folder "Lab" on this computer`, the real path in the desktop app); the
 * name of a document that has no file yet. The internal path `/linked/<id>/...` is never shown.
 */
export function windowPlaceText(
  backends: readonly Pick<FileSystemBackend, 'mount' | 'label' | 'kind'>[],
  doc: Pick<DocumentState, 'path' | 'name'>,
  platformKind: 'web' | 'desktop',
): string {
  if (doc.path === null) return doc.name;
  const labels = backends.map(({ mount, label, kind }) => ({ mount, label, kind }));
  return placeText(labels, doc.path, platformKind);
}

/** Editor mode's window status bar: where the active document's file is (the tab shows the name). */
export function EditorWindowStatus() {
  const ctx = useAppContext();
  const active = useAppState((state) => {
    const doc = state.documents.items.find((item) => item.id === state.documents.activeId);
    return doc ? windowPlaceText(ctx.vfs.backends(), doc, ctx.platform.kind) : '';
  });
  return (
    <span className="e68-statusbar__cell e68-statusbar__cell--grow" data-e68-editor-status="path">
      {active}
    </span>
  );
}
