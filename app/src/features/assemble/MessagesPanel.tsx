// The Messages panel of Editor mode: the original's message list under the edit window
// (editor-ui §7.3, §4.2; ARCHITECTURE.md 2.2).
//
// It shows the list of the active document (AppState.messages[activeId]): columns `Line ` and
// `Error Message`, rows in the order the assembler reported them, read-only, full-row selection,
// the tool-tip `double click error to highlight in source`. A double-click (or Enter) selects the
// row's line in the editor and gives it the focus (navigate.ts). The context menu has the one item
// `&Clear Error Messages` (ed.msg.clear). A column `File` appears only when a row belongs to
// another file than the document (an include file that could not be opened, 1.3.3).
//
// The panel only fills the region; its height (5 px, at least 87 px, 7 px) is the shell's
// (errata W3.md entry 15).
//
// Owner: E5.

import { useState } from 'react';
import type { EditorMessage } from '../../contracts';
import { foldCase } from '../../core/paths/winpath';
import { useAppContext, useAppState } from '../../state/context';
import { shallowEqual } from '../../state/store';
import { ContextMenu, DataGrid, useContextMenu, type DataGridColumn } from '../../ui/components';
import { goToMessage } from './navigate';
import {
  CLEAR_MESSAGES_CAPTION,
  FILE_HEADER,
  LINE_HEADER,
  MESSAGE_HEADER,
  MESSAGES_HINT,
  MESSAGES_LABEL,
} from './texts';
import './assemble.css';

const EMPTY: readonly EditorMessage[] = [];

/** True when a row names another file than the document's own (the File column is shown then). */
export function needsFileColumn(messages: readonly EditorMessage[], docPath: string | null): boolean {
  const own = docPath === null ? null : foldCase(docPath);
  return messages.some((message) => message.file !== null && foldCase(message.file) !== own);
}

/** The file name a row shows in the File column. */
function fileName(path: string | null): string {
  return path === null ? '' : path.slice(path.lastIndexOf('/') + 1);
}

export function MessagesPanel() {
  const ctx = useAppContext();
  const { id, path } = useAppState((state) => {
    const activeId = state.documents.activeId;
    const doc = state.documents.items.find((item) => item.id === activeId);
    return { id: activeId, path: doc?.path ?? null };
  }, shallowEqual);
  const messages = useAppState((state) => (id === null ? EMPTY : (state.messages[id] ?? EMPTY)));
  const [selection, setSelection] = useState<{ list: readonly EditorMessage[]; row: number }>({
    list: EMPTY,
    row: -1,
  });
  // A new list (another document, a new assembly, Clear) starts without a selected row.
  const selectedRow = selection.list === messages ? selection.row : -1;
  const menu = useContextMenu();

  const columns: DataGridColumn<EditorMessage>[] = [
    { id: 'line', header: LINE_HEADER, width: '50px', mono: true, render: (row) => String(row.line) },
    { id: 'text', header: MESSAGE_HEADER, width: 'minmax(0, 1fr)' },
  ];
  if (needsFileColumn(messages, path)) {
    columns.push({ id: 'file', header: FILE_HEADER, width: 'minmax(80px, 30%)', render: (row) => fileName(row.file) });
  }

  return (
    <div className="e68-asm-messages" title={MESSAGES_HINT} {...menu.triggerProps}>
      <DataGrid
        label={MESSAGES_LABEL}
        className="e68-asm-messages__grid"
        columns={columns}
        rows={messages}
        rowKey={(_row, index) => String(index)}
        selectedRow={selectedRow}
        onSelectRow={(row) => setSelection({ list: messages, row })}
        onActivate={(row) => {
          const message = messages[row];
          if (message && id !== null) goToMessage(ctx, id, message);
        }}
        rowTitle={() => MESSAGES_HINT}
        height="100%"
      />
      <ContextMenu
        label="Messages"
        items={[
          {
            type: 'item',
            id: 'ed.msg.clear',
            caption: CLEAR_MESSAGES_CAPTION,
            disabled: !ctx.commands.isEnabled('ed.msg.clear'),
            onSelect: () => void ctx.commands.run('ed.msg.clear'),
          },
        ]}
        {...menu.menuProps}
      />
    </div>
  );
}
