// The dialog `history.trash`, Trash (ARCHITECTURE-PLUS P3.3.8). Owner: N4.
//
// Modal. The items in the Trash (the kit's DataGrid with `multiSelect`: Name, Was in, Why, When,
// Size; newest first) and the buttons Restore, Delete for Good, Empty Trash and Close. Restore goes
// through restoreWithQuestions (core/trash-restore), as the Files panel's Undo of a delete does.
// The list follows changes from this window and others (`subscribe`).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DialogProps, TrashItemInfo } from '../../contracts';
import { restoreWithQuestions } from '../../core/trash-restore/restore-flow';
import { useAppContext } from '../../state/context';
import { Button, DataGrid, Dialog, type DataGridColumn } from '../../ui/components';
import { HistoryProblem, Lines, placeShortFor, useHistoryChanges } from './shared';
import {
  CLOSE_BUTTON,
  DELETE_FOR_GOOD_BUTTON,
  EMPTY_TRASH_BUTTON,
  RESTORE_BUTTON,
  TRASH_COLUMNS,
  TRASH_LIST_LABEL,
  TRASH_TITLE,
} from './texts';
import { deleteForGood, describeTrash, emptyTrash, trashRow, type TrashRow } from './trash';
import { problemsOf } from './versions';

const COLUMNS: DataGridColumn<TrashRow>[] = [
  { id: 'name', header: TRASH_COLUMNS.name, width: 'minmax(120px, 2fr)' },
  { id: 'wasIn', header: TRASH_COLUMNS.wasIn, width: 'minmax(120px, 2fr)' },
  { id: 'why', header: TRASH_COLUMNS.why, width: 'minmax(80px, 1fr)' },
  { id: 'when', header: TRASH_COLUMNS.when, width: 'minmax(150px, 2fr)' },
  { id: 'size', header: TRASH_COLUMNS.size, width: 'minmax(70px, 1fr)', align: 'end' },
];

export function TrashDialog({ close }: DialogProps<Record<string, never> | undefined, void>) {
  const ctx = useAppContext();
  const history = ctx.history;
  const changes = useHistoryChanges(history);
  const [items, setItems] = useState<TrashItemInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [focus, setFocus] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const placeShort = useMemo(() => placeShortFor(ctx), [ctx]);
  // The ids of the selected items, read when a new list arrives (not a reason to read it again).
  const selectedIds = useRef<string[]>([]);
  selectedIds.current = [...selected].map((index) => items[index]?.id).filter((id): id is string => id !== undefined);

  useEffect(() => {
    if (!history) return;
    let live = true;
    history.trashItems().then(
      (list) => {
        if (!live) return;
        // Keep the selection on the same items when the list changes; else the newest item.
        const ids = new Set(selectedIds.current);
        const next = new Set<number>();
        list.forEach((item, index) => {
          if (ids.has(item.id)) next.add(index);
        });
        setItems(list);
        setSelected(next.size > 0 || list.length === 0 ? next : new Set([0]));
        setFocus((current) => Math.min(current, Math.max(0, list.length - 1)));
        setLoaded(true);
      },
      () => live && setLoaded(true),
    );
    return () => {
      live = false;
    };
  }, [history, changes, reloads]);

  const state = history?.state() ?? 'unavailable';
  const problems = history ? problemsOf(history) : { unreadable: 0, detail: '' };
  const view = describeTrash({ state, unreadable: problems.unreadable, detail: problems.detail, items });
  const rows = useMemo(() => items.map((item) => trashRow(item, placeShort)), [items, placeShort]);
  const chosen = items.filter((_, index) => selected.has(index));

  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
      setReloads((n) => n + 1);
    }
  };
  const deps = history ? { history, dialogs: ctx.dialogs } : null;

  return (
    <Dialog
      title={TRASH_TITLE}
      onCancel={() => close(undefined)}
      width="min(860px, calc(100vw - 32px))"
      className="e68-history"
      footer={
        <>
          <Button
            caption={RESTORE_BUTTON}
            disabled={!deps || chosen.length === 0 || busy || view.kind !== 'list'}
            onClick={() =>
              deps &&
              void act(() =>
                restoreWithQuestions(
                  { ...deps, documents: ctx.documents, placeShort, vfs: ctx.vfs },
                  chosen.map((item) => ({ id: item.id, path: item.path })),
                  'Restore',
                ),
              )
            }
          />
          <Button
            caption={DELETE_FOR_GOOD_BUTTON}
            disabled={!deps || chosen.length === 0 || busy || view.kind !== 'list'}
            onClick={() => deps && void act(() => deleteForGood(deps, chosen))}
          />
          <Button
            caption={EMPTY_TRASH_BUTTON}
            disabled={!deps || items.length === 0 || busy || view.kind !== 'list'}
            onClick={() => deps && void act(() => emptyTrash(deps, items))}
          />
          <span className="e68-history__spacer" />
          <Button caption={CLOSE_BUTTON} isDefault onClick={() => close(undefined)} />
        </>
      }
    >
      <div className="e68-history__body" data-e68-history="trash" data-loaded={loaded ? 'true' : undefined}>
        {view.kind === 'unavailable' ? (
          <HistoryProblem ctx={ctx} text={view.text} />
        ) : (
          <>
            <Lines lines={view.lines} />
            {view.empty !== null ? (
              <p className="e68-history__empty" role="status">
                {view.empty}
              </p>
            ) : (
              <DataGrid
                label={TRASH_LIST_LABEL}
                columns={COLUMNS}
                rows={rows}
                rowKey={(row) => row.id}
                selectedRow={focus}
                onSelectRow={setFocus}
                multiSelect={{ selected, onChange: setSelected }}
                height={264}
                className="e68-history__grid"
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
