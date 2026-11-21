// One pane of the editor area: tab strip, editor, status bar (ARCHITECTURE.md 2.2, 2.4; editor-ui
// §4.1, §7). Owner: E2.

import { useSyncExternalStore } from 'react';
import type { CommandId, DocumentState } from '../../contracts';
import { shortcutText } from '../../commands/menus';
import type { KnownCommandId } from '../../commands/ids';
import { useAppContext, useApplication } from '../../state/context';
import { ContextMenu, TabPanel, Tabs, useContextMenu, type MenuEntry } from '../components';
import { DocumentEditor } from './DocumentEditor';
import { EditorStatusBar } from './EditorStatusBar';
import { activatePane, moveToOtherPane, type PaneIndex, type PaneView } from './panes';
import { editorSession } from './session';

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
];

export interface EditorPaneProps {
  index: PaneIndex;
  pane: PaneView;
  docs: readonly DocumentState[];
  activeId: string | null;
  /** Two panes are shown (the tab menu offers to move a document across). */
  twoPanes: boolean;
}

export function EditorPane({ index, pane, docs, activeId, twoPanes }: EditorPaneProps) {
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

  const items = pane.ids.flatMap((id, n) => {
    const doc = byId.get(id);
    if (!doc) return [];
    return [{ id, label: doc.name, title: doc.path ?? doc.name, modified: modifiedKey[n] === '1', closable: true }];
  });

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
