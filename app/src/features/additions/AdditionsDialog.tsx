// Options > Port Additions... (dialog id `plus.options`; ARCHITECTURE-PLUS P3.5). A modal dialog
// `Port Additions` with the two switches of P1.2, the Storage group with its figures and the buttons
// `Empty Trash` and `Delete Earlier Versions` (they act at once, not on OK), and `OK`, `Cancel`.
//
// The dialog resolves to the two boxes on OK and to null on Cancel, Escape or the close button; the
// command stores them (actions.ts). The figures are read when the dialog opens and again after each
// change of the history (any window) or of My Programs (figures.ts).
//
// Owner: N7.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DialogProps as FeatureDialogProps, PlusSettings } from '../../contracts';
import { useAppContext } from '../../state/context';
import { Button, Checkbox, Dialog, GroupBox } from '../../ui/components';
import {
  deleteEarlierVersions,
  emptyTrash,
  type AdditionsDialogProps,
  type AdditionsDialogResult,
  type StorageOutcome,
} from './actions';
import { MY_PROGRAMS_MOUNT, browserEstimate, readFigures, storageLines, type StorageFigures } from './figures';
import {
  ADDITIONS_TITLE,
  CANCEL_CAPTION,
  DELETE_VERSIONS_CAPTION,
  EMPTY_TRASH_CAPTION,
  HISTORY_CAPTION,
  OK_CAPTION,
  STORAGE_GROUP_CAPTION,
  VIEWER_CAPTION,
} from './texts';
import './additions.css';

export function AdditionsDialog({ props, close }: FeatureDialogProps<AdditionsDialogProps, AdditionsDialogResult>) {
  const ctx = useAppContext();
  const [draft, setDraft] = useState<PlusSettings>(props.initial);
  const [figures, setFigures] = useState<StorageFigures | null>(null);
  const emptyTrashButton = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);

  // Reads the figures; a request that arrives while a read runs is served by one more read after it.
  const reading = useRef<{ running: boolean; again: boolean; alive: boolean }>({
    running: false,
    again: false,
    alive: true,
  });
  const refresh = useCallback(async () => {
    const state = reading.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        const next = await readFigures({
          vfs: ctx.vfs,
          history: ctx.history,
          estimate: ctx.platform.kind === 'desktop' ? null : browserEstimate(),
          platformKind: ctx.platform.kind,
        });
        if (state.alive) setFigures(next);
      } while (state.again && state.alive);
    } finally {
      state.running = false;
    }
  }, [ctx]);

  useEffect(() => {
    const state = reading.current;
    state.alive = true;
    void refresh();
    const unsubscribeHistory = ctx.history?.subscribe(() => void refresh());
    const unsubscribeFiles = ctx.vfs.subscribe(`/${MY_PROGRAMS_MOUNT}`, () => void refresh());
    return () => {
      state.alive = false;
      unsubscribeHistory?.();
      unsubscribeFiles();
    };
  }, [ctx, refresh]);

  const act = async (action: (context: typeof ctx) => Promise<StorageOutcome>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action(ctx);
    } finally {
      busy.current = false;
      void refresh();
    }
  };

  const lines = figures ? storageLines(figures) : [];
  const noHistory = ctx.history === undefined;

  return (
    <Dialog
      title={ADDITIONS_TITLE}
      width={600}
      className="e68-additions-dialog"
      {...(props.focus === 'storage' ? { initialFocus: emptyTrashButton } : {})}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption={OK_CAPTION} isDefault onClick={() => close(draft)} />
          <Button caption={CANCEL_CAPTION} onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-additions" data-e68-additions="dialog">
        <div className="e68-additions__switches">
          <Checkbox
            label={VIEWER_CAPTION}
            checked={draft.viewer}
            data-e68-additions="viewer"
            onChange={(on) => setDraft((current) => ({ ...current, viewer: on }))}
          />
          <Checkbox
            label={HISTORY_CAPTION}
            checked={draft.history}
            data-e68-additions="history"
            onChange={(on) => setDraft((current) => ({ ...current, history: on }))}
          />
        </div>
        <GroupBox caption={STORAGE_GROUP_CAPTION} className="e68-additions__storage">
          <div
            className="e68-additions__figures"
            data-e68-additions="figures"
            data-e68-ready={figures ? 'true' : 'false'}
            aria-busy={figures ? undefined : true}
          >
            {lines.map((line) =>
              line.kind === 'figure' ? (
                <div key={line.id} className="e68-additions__figure" data-e68-figure={line.id}>
                  <span className="e68-additions__label">{line.label}</span>{' '}
                  <span className="e68-additions__value">{line.value}</span>
                </div>
              ) : (
                <p key={line.id} className="e68-additions__text" data-e68-figure={line.id}>
                  {line.text}
                </p>
              ),
            )}
          </div>
          <div className="e68-additions__buttons">
            <Button
              ref={emptyTrashButton}
              caption={EMPTY_TRASH_CAPTION}
              disabled={noHistory}
              onClick={() => void act(emptyTrash)}
            />
            <Button
              caption={DELETE_VERSIONS_CAPTION}
              disabled={noHistory}
              onClick={() => void act(deleteEarlierVersions)}
            />
          </div>
        </GroupBox>
      </div>
    </Dialog>
  );
}
