// One pane of the editor area: tab strip, editor, status bar (ARCHITECTURE.md 2.2, 2.4; editor-ui
// §4.1, §7). Owner: E2.
//
// The stage of additions (ARCHITECTURE-PLUS P5 N2): the document tabs can be dragged (type
// `application/x-e68-document`), and a drop on the other pane's strip or body moves the document
// there (moveToOtherPane, through split.ts's moveToPane; the body's drop is EditorArea's); the
// context menu ends with `Earlier Versions...` (`ed.file.history`, N4's handler: disabled until it
// exists); the tab's tool-tip is the place text of P4.5 (`placeText`), never the internal path.

import { useSyncExternalStore } from 'react';
import type { CommandId, DocumentState, FileSystemBackend } from '../../contracts';
import { shortcutText } from '../../commands/menus';
import type { KnownCommandId } from '../../commands/ids';
import { placeText, type PlaceLabels } from '../../core/places/display';
import { useAppContext, useApplication } from '../../state/context';
import { ContextMenu, TabPanel, Tabs, useContextMenu, type MenuEntry } from '../components';
import { DocumentEditor } from './DocumentEditor';
import { EditorStatusBar } from './EditorStatusBar';
import { activatePane, moveToOtherPane, type PaneIndex, type PaneView } from './panes';
import { editorSession } from './session';
import { DOCUMENT_DRAG_TYPE, documentDragData, moveToPane, readDocumentDrag, windowTokenOf } from './split';

/** The editor's context menu (editor-ui §4.1): items 1-8 share the menu items' enabled state. */
export const EDITOR_CONTEXT_MENU: readonly (KnownCommandId | null)[] = [
  'ed.edit.undo',
  'ed.edit.redo',
  null,
  'ed.edit.cut',
  'ed.edit.copy',
  'ed.edit.paste',
  'ed.edit.selectAll',
  null,
  'ed.edit.comment',
  'ed.edit.uncomment',
  null,
  'ed.edit.reload',
  // ARCHITECTURE-PLUS P3.6 (N2 puts the item, N4 owns its handler).
  null,
  'ed.file.history',
];

/** The places of the mounted stores, as placeText reads them (P4.5). */
export function placeLabelsOf(backends: readonly FileSystemBackend[]): PlaceLabels[] {
  return backends.map(({ mount, label, kind }) => ({ mount, label, kind }));
}

/** A document tab's tool-tip (P3.2.5): the place text of its path, its name while it has none. */
export function documentTabTitle(
  doc: Pick<DocumentState, 'path' | 'name'>,
  labels: readonly PlaceLabels[],
  platformKind: 'web' | 'desktop',
): string {
  return doc.path === null ? doc.name : placeText(labels, doc.path, platformKind);
}

export interface EditorPaneProps {
  index: PaneIndex;
  pane: PaneView;
  docs: readonly DocumentState[];
  activeId: string | null;
  /** Two panes are shown (the tab menu offers to move a document across). */
  twoPanes: boolean;
  /** The document whose tab is being dragged in this window, or null. */
  dragging?: string | null;
  /** A document tab of this pane starts being dragged. */
  onDragDocument?: (id: string) => void;
  /** A document was dropped on this pane (its strip): EditorArea moves it and ends the drag. */
  onDropDocument?: (id: string) => void;
}

export function EditorPane({
  index,
  pane,
  docs,
  activeId,
  twoPanes,
  dragging = null,
  onDragDocument,
  onDropDocument,
}: EditorPaneProps) {
  const ctx = useAppContext();
  const { commands } = useApplication();
  const session = editorSession(ctx);
  const { link } = session;
  const context = useContextMenu();
  // Modified flags come from the link: from E1's DocumentState when it shares the text, otherwise
  // from the editor's own tracking.
  const modifiedKey = useSyncExternalStore(link.subscribe, () =>
    pane.ids.map((id) => (link.modified(id) ? 1 : 0)).join(''),
  );
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const selected = pane.selected === null ? undefined : byId.get(pane.selected);
  const idBase = `e68-editor-pane-${index}`;
  const labels = placeLabelsOf(ctx.vfs.backends());

  const items = pane.ids.flatMap((id, n) => {
    const doc = byId.get(id);
    if (!doc) return [];
    const title = documentTabTitle(doc, labels, ctx.platform.kind);
    return [{ id, label: doc.name, title, modified: modifiedKey[n] === '1', closable: true }];
  });

  // Dragging a tab: a drop on this strip moves the document here when it is in the other pane.
  const token = windowTokenOf(ctx);
  const accepting = twoPanes && dragging !== null && !pane.ids.includes(dragging);
  const drag = {
    type: DOCUMENT_DRAG_TYPE,
    // A dropped document takes its place by the order of opening, as `Move to the Other Pane`
    // does, not at the tab it was dropped on: the strip is outlined, no tab is marked.
    positional: false,
    data: (id: string) => {
      onDragDocument?.(id);
      return documentDragData(token, id);
    },
    ...(accepting
      ? {
          onDropAt: (_at: string | null, data: string) => {
            const id = readDocumentDrag(token, data);
            if (id === null) return;
            if (onDropDocument) onDropDocument(id);
            else session.panes.set((state) => moveToPane(state, id, index));
          },
        }
      : {}),
  };

  // The menu is built when it is drawn (it is open only briefly), from the state of that moment.
  const env = { os: ctx.platform.os, desktop: ctx.platform.kind === 'desktop', state: ctx.store.getState() };
  const run = (id: CommandId) => void commands.run(id);
  const menu: MenuEntry[] = !context.isOpen
    ? []
    : EDITOR_CONTEXT_MENU.map((id, n) =>
        id === null
          ? { type: 'separator', id: `separator-${n}` }
          : {
              type: 'item',
              id,
              caption: commands.spec(id).caption,
              disabled: !commands.isEnabled(id),
              ...(shortcutText(id, env) ? { shortcut: shortcutText(id, env) as string } : {}),
              onSelect: () => run(id),
            },
      );
  if (context.isOpen && twoPanes && selected) {
    menu.push(
      { type: 'separator', id: 'separator-pane' },
      {
        type: 'item',
        id: 'e68.editor.otherPane',
        caption: 'Move to the Other &Pane',
        onSelect: () => session.panes.set((state) => moveToOtherPane(state, selected.id)),
      },
    );
  }

  return (
    <div
      className="e68-editor__pane"
      data-pane={index}
      data-active={selected !== undefined && selected.id === activeId ? 'true' : undefined}
      onPointerDown={() => session.panes.set((state) => activatePane(state, index))}
    >
      {items.length > 0 ? (
        <Tabs
          idBase={idBase}
          items={items}
          selectedId={pane.selected}
          onSelect={(id) => ctx.documents.activate(id)}
          onClose={(id) => void ctx.documents.close(id)}
          label={twoPanes ? `Documents of the ${index === 0 ? 'first' : 'second'} pane` : 'Documents'}
          className="e68-editor__tabs"
          drag={drag}
        />
      ) : null}
      {selected ? (
        <>
          <TabPanel idBase={idBase} tabId={selected.id} className="e68-editor__panel" {...context.triggerProps}>
            <DocumentEditor key={selected.id} doc={selected} active={selected.id === activeId} />
          </TabPanel>
          <EditorStatusBar doc={selected} />
          <ContextMenu label="Editor" items={menu} {...context.menuProps} />
        </>
      ) : (
        <p className="e68-editor__empty">
          {twoPanes
            ? 'No document in this pane. New and Open put a document here after a click into it.'
            : 'No document is open.'}
        </p>
      )}
    </div>
  );
}
